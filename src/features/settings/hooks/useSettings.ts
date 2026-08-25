import { bytesToHex } from '@noble/ciphers/utils.js';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { backupKeyFrom } from '@/services/backup';
import { AppState } from 'react-native';

import { shouldSaveBattery, type PowerReading } from '@/core/power';
import { readPower, watchPower } from '@/services/battery';
import {
  effectivePreset,
  getPermission,
  isTracking,
  requestPermission,
  startTracking,
  stopTracking,
  type TrackingPermission,
  type TrackingPresetId,
} from '@/services/location';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@/services/settings';
import { eraseEverything, readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseSettings {
  ready: boolean;
  settings: Settings;
  permission: TrackingPermission;
  /** What Core Location is actually doing, which is not always what the setting says. */
  tracking: boolean;
  setTracking: (enabled: boolean) => void;
  setPreset: (preset: TrackingPresetId) => void;
  setRetentionDays: (days: number | null) => void;
  /** Map imagery — one of the two things here that permit a network request. Off until you say otherwise. */
  setMapsEnabled: (enabled: boolean) => void;
  /**
   * The ElevenLabs key, or empty to turn transcription off.
   *
   * Empty is the off state and the only gate: with no key the Transcribe button
   * does not exist. Clearing this field is how the feature is withdrawn.
   */
  setBackupTarget: (target: { bucket: string; region: string; accessKeyId: string; secretKey: string }) => void;
  /** Returns false when one is already set, which is the whole rule made structural. */
  setBackupPassphrase: (passphrase: string) => boolean;
  setExchangeTarget: (target: { bucket: string; region: string; accessKeyId: string; secretKey: string }) => void;
  /** False if one is already set. It cannot be changed — see the implementation. */
  setExchangePassphrase: (passphrase: string) => boolean;
  setTranscriptionKey: (key: string) => void;
  setTranscriptionLanguage: (code: string) => void;
  /**
   * Whether a nearly-flat battery has temporarily coarsened tracking.
   *
   * Not a setting and never stored: `settings.preset` still holds what you
   * chose. This says what is running instead, and the UI says so out loud
   * rather than letting the app quietly record less than you asked for.
   */
  savingBattery: boolean;
  /** The preset Core Location is actually running — `settings.preset` unless the battery is low. */
  runningPreset: TrackingPresetId;
  askForPermission: () => void;
  eraseAll: () => Promise<void>;
}

export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<TrackingPermission>('unknown');
  const [tracking, setTrackingState] = useState(false);
  const [ready, setReady] = useState(false);
  const [savingBattery, setSavingBattery] = useState(false);
  // What Core Location was last actually started with. Null until something
  // starts it. Without this the reconciling effect below cannot tell "the
  // preset changed" from "the preset is the same and already running", and
  // would restart location updates on every render.
  const [appliedPreset, setAppliedPreset] = useState<TrackingPresetId | null>(null);

  // Guards the restore: someone who flips a switch during the first read must
  // not have it overwritten by what was on disk a moment later.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizeSettings(await readJson<unknown>(STORAGE_KEYS.settings));
      const granted = await getPermission();
      const alreadyRunning = await isTracking();
      if (!live) return;

      if (!touched.current) setSettings(stored);
      setPermission(granted);
      setTrackingState(alreadyRunning);
      setReady(true);

      // Reconcile intent with reality. iOS stops location updates on its own
      // after a crash or a forced quit, and the app would otherwise show
      // "Tracking" over a day that is quietly recording nothing.
      if (stored.trackingEnabled && !alreadyRunning && granted !== 'denied') {
        // The restore uses the stored preset rather than the effective one: the
        // first battery reading has not arrived yet, and the reconciling effect
        // above coarsens it a moment later if the charge turns out to be low.
        const started = await startTracking(stored.preset);
        if (live) {
          setTrackingState(started);
          if (started) setAppliedPreset(stored.preset);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const running = effectivePreset(settings.preset, savingBattery);

  /**
   * Watch the charge, while the app is open.
   *
   * Only while it is open, deliberately. The listeners do not survive being
   * suspended, and re-reading on every return to the foreground is both cheaper
   * and more honest than pretending to know what the battery did meanwhile.
   *
   * What is already applied *does* survive backgrounding: a phone that hit 15%
   * while you were looking at it is still at 15% in your pocket, and putting
   * full detail back the moment the app is hidden would undo the saving at
   * exactly the point it starts to matter.
   */
  useEffect(() => {
    let live = true;

    // Functional update rather than reading `savingBattery`: the hysteresis in
    // `shouldSaveBattery` needs the *current* answer, and a listener installed
    // once would otherwise keep comparing against the value from mount.
    const apply = (reading: PowerReading) => {
      if (live) setSavingBattery((was) => shouldSaveBattery(reading, was));
    };

    void readPower().then(apply);
    const unwatch = watchPower(apply);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readPower().then(apply);
    });

    return () => {
      live = false;
      unwatch();
      subscription.remove();
    };
  }, []);

  /**
   * Bring Core Location into line with the preset that should be running.
   *
   * The one place a battery change turns into a restart, and it fires only when
   * the effective preset genuinely differs from what is applied — restarting
   * location updates is itself expensive, and doing it on a flicker would spend
   * more battery than the coarser preset saves.
   */
  useEffect(() => {
    if (!ready || !tracking || appliedPreset === running) return;
    void startTracking(running).then((started) => {
      if (started) setAppliedPreset(running);
    });
  }, [ready, tracking, running, appliedPreset]);

  const persist = useCallback((next: Settings) => {
    touched.current = true;
    setSettings(next);
    void writeJson(STORAGE_KEYS.settings, next);
  }, []);

  const setTracking = useCallback(
    (enabled: boolean) => {
      void (async () => {
        if (!enabled) {
          await stopTracking();
          setTrackingState(false);
          // Forgotten deliberately: leaving it set would make the reconciling
          // effect treat a later restart at the same preset as already done.
          setAppliedPreset(null);
          persist({ ...settings, trackingEnabled: false });
          return;
        }

        // Asking here rather than at launch: a permission dialog on first open,
        // before anything has been explained, is the one most people decline.
        const granted = permission === 'unknown' ? await requestPermission() : permission;
        setPermission(granted);
        if (granted === 'denied') {
          persist({ ...settings, trackingEnabled: false });
          return;
        }

        const started = await startTracking(running);
        setTrackingState(started);
        if (started) setAppliedPreset(running);
        persist({ ...settings, trackingEnabled: started });
      })();
    },
    [permission, persist, running, settings],
  );

  const setPreset = useCallback(
    (preset: TrackingPresetId) => {
      persist({ ...settings, preset });
      // Restart, or the change does not take effect until the next launch —
      // and someone who just chose "Battery saver" would keep paying for High.
      //
      // Through `effectivePreset`, so choosing "Detailed" on a nearly-flat
      // phone stores the choice and still runs the coarse preset until there is
      // charge to honour it. The Settings screen says which is which.
      if (settings.trackingEnabled) {
        const next = effectivePreset(preset, savingBattery);
        void startTracking(next).then((started) => {
          setTrackingState(started);
          if (started) setAppliedPreset(next);
        });
      }
    },
    [persist, savingBattery, settings],
  );

  /**
   * Where the backup goes. Four fields, all rotatable by retyping.
   */
  const setBackupTarget = useCallback(
    (target: { bucket: string; region: string; accessKeyId: string; secretKey: string }) =>
      persist({
        ...settings,
        backupBucket: target.bucket.trim(),
        backupRegion: target.region.trim(),
        backupAccessKeyId: target.accessKeyId.trim(),
        backupSecretKey: target.secretKey.trim(),
      }),
    [persist, settings],
  );

  /**
   * Set the passphrase, once and for ever.
   *
   * **Refuses if one is already set**, which is the decision made when this was
   * designed rather than a limitation of it: there is no restore path, so
   * nothing could re-encrypt what is already in the bucket, and a second
   * passphrase would silently orphan everything written under the first. The
   * caller cannot get this wrong because the answer is no.
   *
   * The phrase is not kept. scrypt turns it into a key here and what is stored
   * is that key and its salt — so a phone taken apart yields something that
   * opens this backup and nothing else.
   */
  const setBackupPassphrase = useCallback(
    (passphrase: string) => {
      if (settings.backupKeyHex.length > 0) return false;
      const salt = Crypto.getRandomBytes(16);
      const key = backupKeyFrom(passphrase, salt);
      persist({ ...settings, backupKeyHex: bytesToHex(key), backupSaltHex: bytesToHex(salt) });
      return true;
    },
    [persist, settings],
  );

  /**
   * Where plans go. Four fields, all rotatable by retyping — and deliberately
   * not the backup's four. See `Settings.exchangeBucket` for why this is a
   * second set rather than a reuse of the first.
   */
  const setExchangeTarget = useCallback(
    (target: { bucket: string; region: string; accessKeyId: string; secretKey: string }) =>
      persist({
        ...settings,
        exchangeBucket: target.bucket.trim(),
        exchangeRegion: target.region.trim(),
        exchangeAccessKeyId: target.accessKeyId.trim(),
        exchangeSecretKey: target.secretKey.trim(),
      }),
    [persist, settings],
  );

  /**
   * Set the plans passphrase, once and for ever.
   *
   * **A different phrase from the backup's, and the app does not check that.**
   * Typing the same one in both places would hand the machine at home a key
   * that opens every journey in the backup, which is the single thing this
   * split exists to prevent — but refusing a match here would mean holding the
   * backup passphrase in a form that could be compared against, and the backup
   * passphrase is deliberately not kept in any such form. The screen says so
   * instead; the honest place for this rule is the sentence you read before you
   * type, not a check that would cost the property it protects.
   */
  const setExchangePassphrase = useCallback(
    (passphrase: string) => {
      if (settings.exchangeKeyHex.length > 0) return false;
      const salt = Crypto.getRandomBytes(16);
      const key = backupKeyFrom(passphrase, salt);
      persist({ ...settings, exchangeKeyHex: bytesToHex(key), exchangeSaltHex: bytesToHex(salt) });
      return true;
    },
    [persist, settings],
  );

  const setTranscriptionKey = useCallback(
    (transcriptionKey: string) => persist({ ...settings, transcriptionKey: transcriptionKey.trim() }),
    [persist, settings],
  );

  const setTranscriptionLanguage = useCallback(
    (transcriptionLanguage: string) => persist({ ...settings, transcriptionLanguage }),
    [persist, settings],
  );

  const setRetentionDays = useCallback(
    (retentionDays: number | null) => persist({ ...settings, retentionDays }),
    [persist, settings],
  );

  const setMapsEnabled = useCallback(
    (mapsEnabled: boolean) => persist({ ...settings, mapsEnabled }),
    [persist, settings],
  );

  const askForPermission = useCallback(() => {
    void requestPermission().then(setPermission);
  }, []);

  const eraseAll = useCallback(async () => {
    await stopTracking();
    setTrackingState(false);
    setAppliedPreset(null);
    await eraseEverything();
    touched.current = true;
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    ready,
    settings,
    permission,
    tracking,
    setTracking,
    setPreset,
    setRetentionDays,
    setMapsEnabled,
    setBackupTarget,
    setBackupPassphrase,
    setExchangeTarget,
    setExchangePassphrase,
    setTranscriptionKey,
    setTranscriptionLanguage,
    savingBattery,
    runningPreset: running,
    askForPermission,
    eraseAll,
  };
}
