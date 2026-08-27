import { DEFAULT_WEIGHT_KG, normalizeWeightKg } from '@/core/energy';
import { DEFAULT_SEGMENT_CONFIG, normalizeSegmentConfig, type SegmentConfig } from '@/core/segments';

import { DEFAULT_PRESET, normalizePresetId, type TrackingPresetId } from './location';

export interface Settings {
  readonly preset: TrackingPresetId;
  readonly weightKg: number;
  /** Whether tracking should be running. The app's intent; `isTracking()` is the truth. */
  readonly trackingEnabled: boolean;
  /**
   * Days of history to keep, or null for all of it.
   *
   * Null by default, deliberately. This is a diary: quietly deleting last
   * year's walks because a default said so is the one behaviour it must not
   * have. A limit is something you choose.
   */
  readonly retentionDays: number | null;
  /**
   * Whether routes are drawn over Apple's map imagery.
   *
   * **False by default, and the only setting in this app that turns on a
   * network request.** With it off, every map in the app is the offline canvas
   * — the route, the stops and a scale bar, drawn from your own coordinates
   * and nothing else. With it on, MapKit fetches tiles for whatever region you
   * are looking at. Your track is never sent: it is an overlay drawn on this
   * device. But the region is a request, and a request is a thing this app
   * otherwise never makes, so it is a choice rather than a default.
   */
  readonly mapsEnabled: boolean;
  /**
   * The ElevenLabs API key, or empty.
   *
   * **Empty is the feature being off, and it is the only gate.** There is no
   * separate `transcriptionEnabled` boolean, deliberately: a switch can be left
   * on by a stored value nobody remembers setting, while a missing key cannot
   * transcribe anything by construction. A fresh install has no key, so a fresh
   * install cannot send a recording anywhere.
   *
   * It lives here because settings are sealed by the vault like every other
   * stored value — under a `THIS_DEVICE_ONLY` keychain key, so it enters no
   * backup — and **never** in the repository or a build. A key baked into the
   * binary is extractable from the IPA and costs a rebuild to rotate; a key in
   * a field is rotated by retyping it.
   *
   * Nothing prints it, nothing exports it, and it is not in any of the four
   * CSVs. `services/timing.ts` states the rule this follows.
   */
  readonly transcriptionKey: string;
  /**
   * Where the backup goes, and what may write to it.
   *
   * Four fields rather than one because an S3 bucket is genuinely four things,
   * and putting them in the vault beside the transcription key follows the same
   * reasoning: a credential in a field is rotated by retyping it, where one
   * baked into a build is extractable from the IPA and costs a release.
   *
   * The credential these hold can only **append** — the bucket policy denies the
   * phone every read of an object and every delete — so what a stolen phone
   * yields is the ability to add ciphertext to a bucket it cannot open.
   */
  readonly backupBucket: string;
  readonly backupRegion: string;
  readonly backupAccessKeyId: string;
  readonly backupSecretKey: string;
  /**
   * The key the bucket's contents are sealed under, as hex, and its salt.
   *
   * **The passphrase itself is never stored.** It is typed once, run through
   * scrypt, and thrown away — so a phone that is taken apart yields a key that
   * opens this backup and nothing else, where the phrase might be one its owner
   * has used somewhere that matters more.
   *
   * The salt is not a secret and is uploaded in the bucket's plaintext
   * manifest. Without it up there, nothing on any laptop could ever derive this
   * key again, and the backup would be a receipt.
   *
   * Both are empty until a passphrase is set, and **once set neither changes**.
   * That is the decision made when this feature was designed rather than a
   * limitation: with no restore path there is nothing to re-encrypt, so a second
   * passphrase would simply orphan everything written under the first.
   */
  readonly backupKeyHex: string;
  readonly backupSaltHex: string;
  /**
   * Where plans go — **a different bucket, under a different key, reached with
   * a different credential.**
   *
   * One way. Nothing is read back: what the machine at home makes of a plan is
   * shown on its own page and stays there, so there is one copy of a plan to
   * edit rather than two that have to be kept in step.
   *
   * This is the one place in the app where the same four-fields-and-a-key shape
   * appears twice, and the duplication is the feature. The backup holds every
   * journey this phone has ever recorded: coordinates, stops, the shape of a
   * week. The planner holds neither the credential nor the key that would open
   * any of it, and cannot be given them by mistake, because they are not the
   * ones it has.
   *
   * A single bucket split by prefix was the earlier design and it was weaker in
   * a specific way: the separation lived in a policy condition, so one careless
   * edit to that policy — or one credential reused across both halves — put
   * location data in reach of a machine that only ever needed the words of a
   * plan. Two buckets and two keys make the separation structural. There is no
   * condition to get wrong.
   *
   * `plans/` carries what `planPayload` builds: an id, an instant, a title and
   * text. No coordinates have ever been in it. That is what makes it safe to
   * send somewhere the backup's key cannot reach, and it is worth re-checking
   * if that payload ever grows.
   */
  readonly exchangeBucket: string;
  readonly exchangeRegion: string;
  readonly exchangeAccessKeyId: string;
  readonly exchangeSecretKey: string;
  /**
   * The exchange bucket's own key and salt, from its own passphrase.
   *
   * **Never the backup's.** The machine at home must hold this one in order to
   * read a plan, so anything sealed under it should be assumed readable by that
   * machine. That is exactly why the backup is not
   * sealed under it.
   *
   * Set once and never changed, for the same reason `backupKeyHex` is: there is
   * no re-encrypt path, so a second passphrase would orphan everything written
   * under the first. The salt is published in this bucket's own
   * `manifest.json`, which is how the planner derives the same key from the
   * passphrase you type at that end.
   */
  readonly exchangeKeyHex: string;
  readonly exchangeSaltHex: string;
  /**
   * The language Scribe is told to expect, as an ISO-639 code.
   *
   * **Pinned rather than detected**, and Persian by default. Declaring the
   * language stops the model hedging and is most of the distance between
   * Scribe's code-switched accuracy and its single-language accuracy — see
   * the backlog’s § 15. The cost is that an English word spoken mid-sentence
   * comes back transliterated into Persian script, which is accepted.
   *
   * A setting rather than a constant because that is the whole price of being
   * able to change languages later without a migration.
   */
  readonly transcriptionLanguage: string;
  /**
   * Where the planner's web view is, or empty.
   *
   * **Not a network destination for this app**, which is why it is not in
   * `networkNote` and why it is a plain string rather than a switch. Nothing
   * here ever fetches it: the icon on the Plans list hands the address to the
   * browser, exactly as a stay is handed to Maps, and what happens next is
   * between the browser and a machine on the VPN.
   *
   * Empty hides the control. Defaulted to the address that exists rather than
   * to nothing, because there is one planner and typing its name into a phone
   * is friction for no gain.
   */
  readonly plannerUrl: string;
  readonly segmentation: SegmentConfig;
}

/**
 * The planner's own address, on the VPN.
 *
 * A default rather than a blank field: there is one of these and it is not
 * reachable from anywhere else, so pre-filling costs nothing and saves typing a
 * hostname into a phone keyboard.
 */
export const DEFAULT_PLANNER_URL = 'https://tracker.triplec.ai';

/** Persian. The recordings this was built for are entirely in it. */
export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'fa';

export const DEFAULT_SETTINGS: Settings = {
  preset: DEFAULT_PRESET,
  weightKg: DEFAULT_WEIGHT_KG,
  trackingEnabled: false,
  retentionDays: null,
  mapsEnabled: false,
  plannerUrl: DEFAULT_PLANNER_URL,
  transcriptionKey: '',
  backupBucket: '',
  backupRegion: 'ap-southeast-2',
  backupAccessKeyId: '',
  backupSecretKey: '',
  backupKeyHex: '',
  backupSaltHex: '',
  exchangeBucket: '',
  exchangeRegion: 'ap-southeast-2',
  exchangeAccessKeyId: '',
  exchangeSecretKey: '',
  exchangeKeyHex: '',
  exchangeSaltHex: '',
  transcriptionLanguage: DEFAULT_TRANSCRIPTION_LANGUAGE,
  segmentation: DEFAULT_SEGMENT_CONFIG,
};

/**
 * An ISO-639-1 or -3 code, or the default.
 *
 * Narrow on purpose: this string is put in a request body, so "two or three
 * lowercase letters" is the whole of what it may be. Anything else falls back
 * to Persian rather than being sent.
 */
function normalizeLanguageCode(input: unknown): string {
  if (typeof input !== 'string') return DEFAULT_TRANSCRIPTION_LANGUAGE;
  const code = input.trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : DEFAULT_TRANSCRIPTION_LANGUAGE;
}

function normalizeRetentionDays(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 1) return null;
  return Math.floor(input);
}

/**
 * The trust boundary for settings.
 *
 * Field by field, never wholesale. A stored object that has lost one key is far
 * more likely than one that is unrecognisable, and falling back to every
 * default because `weightKg` came back as a string would silently turn tracking
 * off — which reads as the app having forgotten what it was doing.
 */
/** A stored string, or nothing. Never a repaired one — see `backupKeyHex`. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSettings(input: unknown): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<string, unknown>>;
  return {
    preset: normalizePresetId(source.preset),
    weightKg: normalizeWeightKg(source.weightKg),
    trackingEnabled: source.trackingEnabled === true,
    retentionDays: normalizeRetentionDays(source.retentionDays),
    // `=== true`, not truthy: anything unrecognisable in this field must fall
    // back to *off*, because the failure it guards is a network request nobody
    // asked for.
    mapsEnabled: source.mapsEnabled === true,
    // Only https survives. A stored `javascript:` or `file:` is not a website,
    // and this value is handed to `Linking` — so the check is here as well as
    // at the call site, because a normaliser is where a bad stored value is
    // supposed to stop.
    plannerUrl:
      typeof source.plannerUrl === 'string' && /^https:\/\//i.test(source.plannerUrl.trim())
        ? source.plannerUrl.trim()
        : DEFAULT_PLANNER_URL,
    // Trimmed, because a key pasted from a web page arrives with whitespace on
    // it and a leading space is an authentication failure nobody can see.
    transcriptionKey: typeof source.transcriptionKey === 'string' ? source.transcriptionKey.trim() : '',
    backupBucket: text(source.backupBucket),
    backupRegion: text(source.backupRegion) || DEFAULT_SETTINGS.backupRegion,
    backupAccessKeyId: text(source.backupAccessKeyId),
    backupSecretKey: text(source.backupSecretKey),
    // Hex or nothing. A half-written key is not repaired into a different key:
    // it would seal objects nothing can open, and silently.
    backupKeyHex: /^[0-9a-f]{64}$/.test(text(source.backupKeyHex)) ? text(source.backupKeyHex) : '',
    backupSaltHex: /^[0-9a-f]{32}$/.test(text(source.backupSaltHex)) ? text(source.backupSaltHex) : '',
    exchangeBucket: text(source.exchangeBucket),
    exchangeRegion: text(source.exchangeRegion) || DEFAULT_SETTINGS.exchangeRegion,
    exchangeAccessKeyId: text(source.exchangeAccessKeyId),
    exchangeSecretKey: text(source.exchangeSecretKey),
    // Same rule as the backup's: hex or nothing, never a repaired half-key.
    exchangeKeyHex: /^[0-9a-f]{64}$/.test(text(source.exchangeKeyHex)) ? text(source.exchangeKeyHex) : '',
    exchangeSaltHex: /^[0-9a-f]{32}$/.test(text(source.exchangeSaltHex)) ? text(source.exchangeSaltHex) : '',
    transcriptionLanguage: normalizeLanguageCode(source.transcriptionLanguage),
    segmentation: normalizeSegmentConfig(source.segmentation),
  };
}
