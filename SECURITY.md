# Security

## Reporting a vulnerability

Open a [private security advisory](../../security/advisories/new) on this
repository. Please do not open a public issue for anything exploitable.

This is a personal project maintained by one person; expect a reply in days
rather than hours.

## What this app protects, and from what

The app stores a record of everywhere its owner has been. That is the most
sensitive thing on most people's phones, and the design treats it that way.

**The threat model is not a determined attacker holding your unlocked phone.**
Against that, nothing an app can do helps. It is the ordinary ways a file leaks:

| Leak                                             | Mitigation                                                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iCloud or iTunes backup                          | The encryption key is `THIS_DEVICE_ONLY`, so it is never in a backup. A restored backup contains ciphertext and no key. Media is not sealed, so it is excluded from the backup outright — see below. |
| Device sold, lent or handed on                   | Same. Also, "Erase everything" destroys the key rather than hoping every row left the flash.                                                                                                         |
| Forensic extraction of the container             | Every stored value is sealed with XChaCha20-Poly1305. Media files rely on the iOS container encryption alone.                                                                                        |
| A bug in another app that can read the container | Same. iOS sandboxing is what stops another app reaching the container at all.                                                                                                                        |
| A tampered or truncated store                    | Poly1305 authenticates. A modified store fails to decrypt rather than parsing into something that looks like a day.                                                                                  |
| Data sent somewhere by accident                  | The app makes one kind of request — Apple Maps tiles, off by default. Your track is never in it. See _Network posture_.                                                                              |

### Media at rest: the one place this changed

Photos, video and voice notes used to be sealed into a chunked container under the
same device key. They are now **ordinary files** under `Documents/media`.

The reasoning, in full, because it is a real reduction in guarantee and not a
tidy-up. `@noble/ciphers` is audited, pure TypeScript and has no hardware
acceleration, so opening a minute of video meant forty megabytes of AEAD on the
single thread that also draws the screen. The gallery took seconds to open and the
cost was entirely self-inflicted: **iOS already encrypts the app container** under
a key derived from the passcode, so the second pass added very little against the
threat it was named for — someone holding the phone.

What it did buy was the **backup** row above. `Documents` is backed up; the key was
not; so a restored backup held ciphertext. For one release that was simply given
up, and a media file restored as a readable photo on another device. It is now
bought back without the cipher: `Documents/media` is flagged
`NSURLIsExcludedFromBackupKey`, so the files are not copied into a backup at all.

Not being in the backup is a stronger property than being in it unreadable, and it
costs nothing on the read path — which was the entire complaint against the
container. `expo-file-system` has no API for the flag, so it is a second local
native module, `modules/file-backup`, applied from `ensureDirectory` on every
write. That repetition is deliberate: it is also the migration for a library
written before the flag existed, and the Swift reads the current value before
writing, so the repeat calls are a single `getattr`.

**The cost is real and it is the other direction.** A capture excluded from backup
does not survive a lost, stolen or replaced phone, and there is no other copy
anywhere. Everything the vault covers has the same property for the same reason —
`THIS_DEVICE_ONLY` — so this makes media consistent with the rest of the store
rather than exceptional. It is also why the S3 sync is the backlog item that
matters most.

The conclusion drawn from that, which the sync work is bound by: encryption belongs
at the boundary where data actually leaves the phone, and the bytes get sealed on
the way out rather than on the way in.

`unsealInPlace` still reads the old container so a library written by an earlier
build is not lost. Do not remove it.

### The file protection class, which is the default on purpose

Nothing in this app sets `NSFileProtection*`, so every file it writes takes iOS's
default: **`CompleteUntilFirstUserAuthentication`** — readable after the first
unlock following a boot, and unreadable before it.

That is the right class here rather than a gap, and it is the same trade the
keychain flag makes for the same reason. `Complete` would make files unreadable
whenever the phone is locked, and this app writes location fixes and captures
while the phone is locked in a pocket; a stricter class would leave a hole in
every day, which is the failure `AFTER_FIRST_UNLOCK` was chosen to avoid on the
key. Matching them means there is one story about when data is reachable, not two.

Written down because it was previously true only by accident. The "forensic
extraction" row above depends on it, and a future change that sets a protection
class explicitly should be a decision about background capture, not about files.

### Cryptography

- **XChaCha20-Poly1305**, from [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers)
  — audited, pure TypeScript, so no native crypto module in the build.
- **24-byte nonce, drawn at random for every write.** Large enough that random
  nonces carry no birthday-bound risk, which removes the mistake AES-GCM
  implementations most often make.
- **32-byte key** from the system CSPRNG (`expo-crypto`), stored in the iOS
  keychain as `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.
  - `THIS_DEVICE_ONLY` — never in a backup, never synced.
  - `AFTER_FIRST_UNLOCK` rather than `WHEN_UNLOCKED` — background location
    arrives while the phone is locked in a pocket, and a key unreadable then
    would leave a hole in every day. This is a deliberate trade: it is the
    strongest class compatible with background capture.
- Key generation is coalesced through a single in-flight promise, so a race
  between the first render and the background task cannot generate two keys and
  strand everything written under the first.

Implementation and tests: [`src/services/vault.ts`](src/services/vault.ts),
[`src/services/__tests__/vault.test.ts`](src/services/__tests__/vault.test.ts).
The tests exercise the real cipher against an in-memory keychain — tampering,
truncation and key destruction included — rather than stubbing the encryption
and leaving the interesting part untested.

### Network posture

The app makes **exactly one kind of request, and only when you ask for it**: Apple
Maps imagery, behind `settings.mapsEnabled`, which is **off on a fresh install**.
With it on, Apple learns which part of the map is on screen. It never learns your
track — the route is an overlay drawn on the device from coordinates that do not
leave it. `components/MapCanvas.tsx` is the only file permitted to import
`expo-maps`; with the switch off, every map in the app is the offline canvas drawn
from your own coordinates and nothing else.

There is no analytics, no telemetry, no crash reporting upload, no remote config
and no geocoder — which is still why a place has no name until you type one, and
why there is nothing to ask. `NSAllowsArbitraryLoads` is `false` with no exception
domains: App Transport Security stays fully enforced.

The share sheet is not a network request. `exportFile.ts` hands iOS a file and iOS
decides what happens to it, which is the user's choice and not the app's.

If you are reviewing a change and it adds a dependency that opens a socket, that
is the change to push back on. The planned S3 backup widens this rule considerably
and must rewrite the reasoning rather than slip past it.

## Credentials

**Apple credentials live only in GitHub Secrets.** Never in the repository, never
in `.env`, never on a developer machine beyond what Xcode holds in its own
keychain.

- `.gitignore` blocks `*.p8`, `*.p12`, `*.pem`, `*.key`, `*.cer`,
  `*.mobileprovision`, `.env` and friends.
- `gitleaks` runs in CI over **full history**, not just the tip — a credential
  that was committed and then "removed" is still in the objects and still
  compromised.
- A pre-commit hook runs `gitleaks protect --staged` locally when gitleaks is
  installed.

If a credential is ever committed: **rotate it first**, then worry about the
history. Revoking a key takes a minute; scrubbing a repository does not undo the
fetches that already happened.

## Location data in the repository

There is a gitleaks rule, `plausible-home-coordinates`, that fails the build on
anything shaped like a real latitude in source.

This is not paranoia about a coordinate format. A test fixture built from a real
track is a permanent, public record of where its author was on a particular
afternoon — the same class of mistake as a leaked key, and considerably harder to
rotate. All fixtures are synthetic and sit at the equator; see
[`src/core/segments/__tests__/fixtures.ts`](src/core/segments/__tests__/fixtures.ts).

## Supply chain

- Every GitHub Action is pinned to a full commit SHA, and a CI job fails the
  build if one is not. A mutable tag can be repointed at malicious code without a
  single line of this repository changing.
- `npm audit --audit-level=high` runs on every PR and weekly on a schedule — a
  dependency that is safe today can have a CVE published against it next week.
- CodeQL runs with `security-extended` queries.
- Dependabot is on, with Expo-managed packages pinned deliberately (see
  [`.github/dependabot.yml`](.github/dependabot.yml) for why each one is held).
