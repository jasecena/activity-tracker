/**
 * Every name this app has ever written: `m-<instant>` or `voice-<instant>` with
 * an extension, plus `.thumb`, `.thumb.<n>` and the retired `.avm`.
 * Deliberately narrower than "what a filesystem accepts".
 */
const STORED_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A stored name must be a *name*, not a path.
 *
 * Two indexes name files that a service then opens, and in one case deletes, by
 * joining the name onto a directory: the media index and — since a note can
 * hold a recording — the diary. A name carrying `../` walks out of that
 * directory; percent-encoding does the same thing one decode later. iOS bounds
 * the damage — the URL is standardised and checked against what the app is
 * allowed to touch — but "the platform stops it going anywhere too interesting"
 * is not the same as this app having checked, and the `normalize*` functions
 * are the ones that claim to be the trust boundary.
 *
 * It matters more later than now. Today an entry can only be planted by
 * something that already holds the device key, which is game over anyway. The
 * S3 restore in `docs/BACKLOG.md` § 12 is the path that makes an index arrive
 * from somewhere other than this phone, and this is much cheaper to require
 * before that exists than to retrofit after.
 *
 * It lives on its own, importing nothing, because both `core/media` and
 * `core/day` need it and `core/media` already reads `core/day`. A leaf module
 * is how the second caller arrives without a cycle.
 */
export function isStoredFileName(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && STORED_FILE_NAME.test(candidate);
}
