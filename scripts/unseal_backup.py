#!/usr/bin/env python3
"""Open an activity-tracker backup on a laptop.

The app writes to the bucket and never reads it back, so this script is the only
thing that can open what is up there. That makes it part of the feature rather
than a convenience: a bucket full of ciphertext that nothing can decrypt is a
receipt, not a backup.

    aws s3 sync s3://<bucket>/ ./backup --profile <admin>
    python3 scripts/unseal_backup.py ./backup ./plain

It asks for the passphrase, reads the salt and the KDF parameters out of
``manifest.json``, and writes every object out in plaintext, keeping the layout.

Dependencies are deliberately almost nothing: ``hashlib`` for scrypt and SHA-256
is the standard library, and ``cryptography`` provides IETF ChaCha20-Poly1305.
The app's own cipher was changed to this one *because* of that — XChaCha20 would
have needed PyNaCl, and hunting for ``pip`` is not what anybody should be doing
on the day they need this script.

Format, per object:

    "ATB1"            magic, 4 bytes
    version           1 byte
    chunkSize         uint32 big-endian
    fileSalt          16 bytes
    then to the end:
      length          uint32 big-endian
      ciphertext      length bytes, Poly1305 tag included

The key for the object is SHA-256(backupKey || fileSalt); the nonce for a chunk
is its index in the low 8 bytes of 12; the AAD is magic || version || index ||
isFinal. The index stops a chunk being moved and the flag stops the file being
truncated, both of which would otherwise decrypt cleanly into something that is
not what was uploaded.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import struct
import sys
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

MAGIC = b"ATB1"
VERSION = 1
SALT_BYTES = 16


class Corrupt(Exception):
    """The bytes are not what they claim to be. Never guessed at, always raised."""


def backup_key(passphrase: str, salt: bytes, kdf: dict) -> bytes:
    if kdf.get("name") != "scrypt":
        raise Corrupt(f"unknown key derivation {kdf.get('name')!r}")
    return hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=kdf["N"],
        r=kdf["r"],
        p=kdf["p"],
        dklen=kdf["dkLen"],
        maxmem=(2 * kdf["N"] * kdf["r"] * 64) + (1 << 20),
    )


def aad_for(index: int, final: bool) -> bytes:
    return MAGIC + bytes([VERSION]) + struct.pack(">Q", index) + bytes([1 if final else 0])


def nonce_for(index: int) -> bytes:
    return b"\x00" * 4 + struct.pack(">Q", index)


def unseal(sealed: bytes, key: bytes) -> bytes:
    """One object, back to plaintext. Raises rather than returning something plausible."""
    if len(sealed) < 4 + 1 + 4 + SALT_BYTES:
        raise Corrupt("too short to hold a header")
    if sealed[:4] != MAGIC:
        raise Corrupt("not an activity-tracker backup object")
    if sealed[4] != VERSION:
        raise Corrupt(f"version {sealed[4]} is newer than this script understands")

    at = 9
    file_salt = sealed[at : at + SALT_BYTES]
    at += SALT_BYTES
    file_key = hashlib.sha256(key + file_salt).digest()
    cipher = ChaCha20Poly1305(file_key)

    # Read the frames first, so "is this the last one" is known before any chunk
    # is opened — the final flag is authenticated, so it has to be right going in
    # rather than discovered on the way out.
    frames = []
    while at < len(sealed):
        if at + 4 > len(sealed):
            raise Corrupt("a chunk length runs off the end")
        (length,) = struct.unpack(">I", sealed[at : at + 4])
        at += 4
        if at + length > len(sealed):
            raise Corrupt("a chunk runs off the end — the file is truncated")
        frames.append(sealed[at : at + length])
        at += length

    if not frames:
        raise Corrupt("no chunks at all")

    out = bytearray()
    for index, frame in enumerate(frames):
        final = index == len(frames) - 1
        try:
            out += cipher.decrypt(nonce_for(index), frame, aad_for(index, final))
        except InvalidTag as exc:
            # Either the passphrase is wrong or the bytes were altered. Both are
            # worth stopping for, and neither is worth guessing between.
            raise Corrupt(
                f"chunk {index} failed to authenticate — wrong passphrase, or the object was altered"
            ) from exc
    return bytes(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Decrypt an activity-tracker backup.")
    parser.add_argument("source", type=Path, help="a directory holding manifest.json and the objects")
    parser.add_argument("destination", type=Path, help="where to write the plaintext")
    args = parser.parse_args()

    manifest_path = args.source / "manifest.json"
    if not manifest_path.exists():
        print(f"No manifest.json in {args.source}. Sync the whole prefix, not part of it.", file=sys.stderr)
        return 2

    manifest = json.loads(manifest_path.read_text())
    salt = bytes.fromhex(manifest["salt"])
    key = backup_key(getpass.getpass("Passphrase: "), salt, manifest["kdf"])

    written = failed = 0
    for path in sorted(args.source.rglob("*")):
        if not path.is_file() or path.name == "manifest.json":
            continue
        target = args.destination / path.relative_to(args.source)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_bytes(unseal(path.read_bytes(), key))
            written += 1
        except Corrupt as exc:
            # Carry on: one damaged object should not cost you the rest of the
            # backup, and the count at the end says plainly what did not open.
            print(f"{path.relative_to(args.source)}: {exc}", file=sys.stderr)
            failed += 1

    print(f"{written} opened, {failed} failed → {args.destination}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
