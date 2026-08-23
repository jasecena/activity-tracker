# The backup bucket

The backup, as the AWS objects that implement it. Set
up once, from an admin profile, and then never touched by the phone.

Nothing here names a real bucket or a real account. The `.json.template` files
carry the shape with `${BUCKET}` and `${ACCOUNT_ID}` in it; rendering one writes
`*.local.json`, which is gitignored. That is the same rule that keeps
`APPLE_TEAM_ID` in `.env`: an account id is not a secret, and a repository that
is free of account-specific values is one anybody can read without learning
where its author keeps things.

```sh
export BUCKET=... ACCOUNT_ID=... PROFILE=... REGION=ap-southeast-2
for f in app-user-policy bucket-policy lifecycle; do
  envsubst < infra/$f.json.template > infra/$f.local.json
done
```

## The bucket

|                     |                                                |
| ------------------- | ---------------------------------------------- |
| Block Public Access | all four, explicitly rather than by default    |
| Object ownership    | `BucketOwnerEnforced` — ACLs disabled entirely |
| Versioning          | enabled                                        |
| Default encryption  | SSE-S3 with a bucket key                       |

**Versioning is not belt-and-braces here, it is half of the delete story.** The
phone cannot delete, so the only way an object disappears is a lifecycle rule
this file sets. With versioning on, even an overwrite leaves the previous bytes
behind, which is what makes "the phone can write and cannot destroy" true rather
than merely intended.

**SSE-S3 on top of client-side sealing is deliberate and nearly free.** It
protects nothing the passphrase does not already protect — the bytes arrive
sealed — but it costs one flag and covers the case where a future object is
uploaded by something that forgot to seal it.

## What the phone may do

`app-user-policy` grants exactly two things, both requiring TLS:

- `s3:PutObject`, restricted to the storage classes the app actually chooses —
  `STANDARD` for small objects and `GLACIER_IR` for large ones.
- `s3:ListBucket`, which is how a reinstalled app knows what is already up there
  instead of uploading a year of video again. It reads names, never contents.

`bucket-policy` then **denies** the phone `GetObject` and every delete, as a
resource-based policy. That is deliberate duplication: the identity policy
already omits them, and an explicit deny is what survives somebody later
attaching a broader policy to the same user by mistake. It also denies plain
HTTP to everybody.

The result is a credential that can add to your backup and can neither read it
nor destroy it. A stolen phone yields an append handle, and the ciphertext it
appends is unreadable without the passphrase, which is not on the phone in any
recoverable form.

Verify it rather than believing it — the four probes that matter:

```sh
aws s3api put-object  --bucket $BUCKET --key probe/x --body /dev/null   # allowed
aws s3api list-objects-v2 --bucket $BUCKET --prefix probe/              # allowed
aws s3api get-object    --bucket $BUCKET --key probe/x /tmp/x           # DENIED
aws s3api delete-object --bucket $BUCKET --key probe/x                  # DENIED
```

## What happens to the bytes over time

`lifecycle` implements the two levels, and the numbers in it are properties of
the storage classes rather than preferences:

- **Objects over 128 KB under `media/` and `note-audio/` move to
  `DEEP_ARCHIVE` at 90 days.** They land in `GLACIER_IR` from the PUT itself,
  because a lifecycle transition bills a minimum residency in Standard first and
  the point is to stop paying Standard the moment a video arrives. Ninety is the
  minimum storage duration `GLACIER_IR` charges for: a rule set at thirty pays
  for ninety anyway and buys nothing.
- **Under 128 KB, nothing transitions.** `GLACIER_IR` bills a minimum object
  size of 128 KB, so a 3 KB day of notes would be charged as forty times itself.
  The size filter in the rule is the same threshold the app applies when it
  chooses a class, and the two must be changed together.
- **Superseded versions are bounded** — the three most recent are kept, older
  ones expire after 90 days. Versioning without this is a store that only grows,
  and re-uploading a day is a normal thing to do.
- **Abandoned multipart uploads are aborted after 7 days**, which is the one
  piece of pure hygiene here: a failed upload otherwise leaves parts that are
  billed and invisible.

## Restore

There is none, by design, and the bucket is arranged to make that honest rather
than convenient: the phone cannot read what it wrote. Getting data back is
`aws s3 sync` from an admin profile onto a laptop, then `scripts/unseal_backup.py`
with the passphrase. Anything in `DEEP_ARCHIVE` has to be restored to a readable
tier first, which takes hours — the cost of the second level, paid on the day
you hope never comes.
