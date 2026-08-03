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

| Leak                                             | Mitigation                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| iCloud or iTunes backup                          | The encryption key is `THIS_DEVICE_ONLY`, so it is never in a backup. A restored backup contains ciphertext and no key. |
| Device sold, lent or handed on                   | Same. Also, "Erase everything" destroys the key rather than hoping every row left the flash.                            |
| Forensic extraction of the container             | Every stored value is sealed with XChaCha20-Poly1305.                                                                   |
| A bug in another app that can read the container | Same.                                                                                                                   |
| A tampered or truncated store                    | Poly1305 authenticates. A modified store fails to decrypt rather than parsing into something that looks like a day.     |
| Data sent somewhere by accident                  | The app makes no network requests of any kind. There is no endpoint to send to.                                         |

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

The app makes no HTTP request of any kind. No analytics, no telemetry, no crash
reporting upload, no remote config, no geocoder, no map tiles.
`NSAllowsArbitraryLoads` is `false` with no exception domains, because there is
nothing for App Transport Security to permit.

If you are reviewing a change and it adds a dependency that opens a socket, that
is the change to push back on.

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
