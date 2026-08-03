import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizePlaces, placeFromStay, removePlace, upsertPlace, widenToInclude, type Place } from '@/core/places';
import type { StaySegment } from '@/core/segments';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UsePlaces {
  ready: boolean;
  places: readonly Place[];
  /** Name a stay. Every future stay within its radius is then recognised as here. */
  name: (stay: StaySegment, name: string) => void;
  /** "This stay is that place." Widens the place if the stay fell outside it. */
  link: (stay: StaySegment, place: Place) => void;
  rename: (id: string, name: string) => void;
  forget: (id: string) => void;
}

/**
 * The named places.
 *
 * There is no geocoder behind this and there never will be: asking a server
 * "what is at these coordinates" is precisely the thing this app does not do.
 * So a place gets a name because you typed one, and the list of everywhere you
 * go exists on exactly one device.
 */
export function usePlaces(): UsePlaces {
  const [places, setPlaces] = useState<readonly Place[]>([]);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizePlaces(await readJson<unknown>(STORAGE_KEYS.places));
      if (!live) return;
      if (!touched.current) setPlaces(stored);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly Place[]) => {
    touched.current = true;
    setPlaces(next);
    void writeJson(STORAGE_KEYS.places, next);
  }, []);

  const name = useCallback(
    (stay: StaySegment, label: string) => {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      persist(upsertPlace(places, placeFromStay(stay, trimmed)));
    },
    [persist, places],
  );

  const link = useCallback(
    (stay: StaySegment, place: Place) => {
      // Widening rather than creating a second place with the same name: two
      // identical rows in the timeline with the totals split between them is
      // the outcome nobody wants and everybody gets.
      persist(upsertPlace(places, widenToInclude(place, stay)));
    },
    [persist, places],
  );

  const rename = useCallback(
    (id: string, label: string) => {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      persist(places.map((place) => (place.id === id ? { ...place, name: trimmed } : place)));
    },
    [persist, places],
  );

  const forget = useCallback((id: string) => persist(removePlace(places, id)), [persist, places]);

  return { ready, places, name, link, rename, forget };
}
