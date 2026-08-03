import { useCallback, useEffect, useRef, useState } from 'react';

import {
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
  setWeightKg: (weightKg: number) => void;
  setRetentionDays: (days: number | null) => void;
  askForPermission: () => void;
  eraseAll: () => Promise<void>;
}

export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<TrackingPermission>('unknown');
  const [tracking, setTrackingState] = useState(false);
  const [ready, setReady] = useState(false);

  // Guards the restore: someone who flips a switch during the first read must
  // not have it overwritten by what was on disk a moment later.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizeSettings(await readJson<unknown>(STORAGE_KEYS.settings));
      const granted = await getPermission();
      const running = await isTracking();
      if (!live) return;

      if (!touched.current) setSettings(stored);
      setPermission(granted);
      setTrackingState(running);
      setReady(true);

      // Reconcile intent with reality. iOS stops location updates on its own
      // after a crash or a forced quit, and the app would otherwise show
      // "Tracking" over a day that is quietly recording nothing.
      if (stored.trackingEnabled && !running && granted !== 'denied') {
        const started = await startTracking(stored.preset);
        if (live) setTrackingState(started);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

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

        const started = await startTracking(settings.preset);
        setTrackingState(started);
        persist({ ...settings, trackingEnabled: started });
      })();
    },
    [permission, persist, settings],
  );

  const setPreset = useCallback(
    (preset: TrackingPresetId) => {
      persist({ ...settings, preset });
      // Restart, or the change does not take effect until the next launch —
      // and someone who just chose "Battery saver" would keep paying for High.
      if (settings.trackingEnabled) void startTracking(preset).then(setTrackingState);
    },
    [persist, settings],
  );

  const setWeightKg = useCallback((weightKg: number) => persist({ ...settings, weightKg }), [persist, settings]);

  const setRetentionDays = useCallback(
    (retentionDays: number | null) => persist({ ...settings, retentionDays }),
    [persist, settings],
  );

  const askForPermission = useCallback(() => {
    void requestPermission().then(setPermission);
  }, []);

  const eraseAll = useCallback(async () => {
    await stopTracking();
    setTrackingState(false);
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
    setWeightKg,
    setRetentionDays,
    askForPermission,
    eraseAll,
  };
}
