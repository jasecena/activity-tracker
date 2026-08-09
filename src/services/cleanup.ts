import { distanceM, type LatLon } from '@/core/geo';
import type { MediaItem } from '@/core/media';
import type { Place } from '@/core/places';
import type { Segment } from '@/core/segments';

import { archiveKeyFor, archivedDayKeys, readJson, removeKeys, STORAGE_KEYS, writeJson } from './storage';

/**
 * A one-off pass that deletes coordinates that cannot be real.
 *
 * **This is temporary and meant to be deleted.** It exists because two bugs put
 * impossible positions into a store that is otherwise append-only: a merged
 * stay's centre came out as the true mean scaled by (n + merges) / n, which
 * threw stops hundreds of kilometres out to sea, and `currentFix` believed
 * whatever Core Location handed it. Both are fixed at the source. Nothing new
 * can land out here, so once this has run everywhere it matters, delete the
 * file and the marker with it.
 *
 * It runs **once**, recorded by a marker key rather than by inspection: a
 * second pass over already-clean data is harmless but a pass that runs on every
 * launch is a thing nobody remembers to remove.
 *
 * The centre is a city at two decimal places — about a kilometre, against a
 * radius of five hundred. Any more precision would be a personal location in a
 * committed file, which is the class of mistake `.gitleaks.toml` exists to stop
 * and rather harder to take back than a key.
 */
const HOME: LatLon = { lat: -37.81, lon: 144.96 };

/** Far enough that nothing in an ordinary life reaches it by accident. */
const RADIUS_M = 500_000;

/** True for a coordinate that could plausibly belong to this diary. */
export function isPlausible(at: LatLon, home: LatLon = HOME, radiusM: number = RADIUS_M): boolean {
  return distanceM(home, at) <= radiusM;
}

/**
 * Repair a frozen row, or drop it if there is nothing left to repair.
 *
 * **Only the far points go.** A frozen day keeps its segments and not its
 * fixes, so there is nothing left to re-derive it from — but a walk that
 * acquired one impossible reading is still a walk, and throwing the row away
 * would delete an afternoon to fix a second of it.
 *
 * A **stay** is a centre and a radius: one averaged point, with nothing behind
 * it to recompute from. If that point is impossible the row has nothing
 * salvageable in it and goes.
 *
 * A **move** keeps the points that can be true, and its distance is recomputed
 * over them. That reverses the usual rule — distance is apportioned rather than
 * recomputed, because recomputing from a thinned path loses whatever the
 * thinning dropped — and it is the right way round here: a few metres of
 * thinning against a leg five hundred kilometres out to sea and back. Top speed
 * comes from the points that remain, which is what makes the impossible step
 * stop being the fastest thing you ever did.
 */
function repairSegment(segment: Segment): Segment | null {
  if (segment.kind === 'stay') return isPlausible(segment.center) ? segment : null;

  const path = segment.path.filter((point) => isPlausible(point));
  if (path.length === segment.path.length) return segment;
  // A route needs two points to be a route, and one surviving point is not a
  // journey anybody can look at.
  if (path.length < 2) return null;

  let distanceM = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (from && to) distanceM += distanceM_(from, to);
  }

  return {
    ...segment,
    path,
    distanceM,
    topSpeedMps: path.reduce((fastest, point) => Math.max(fastest, point.speedMps ?? 0), 0),
  };
}

/** Named apart so the local `distanceM` above cannot shadow the import. */
const distanceM_ = distanceM;

export interface CleanupReport {
  readonly fixes: number;
  readonly segments: number;
  readonly places: number;
  readonly media: number;
}

const NOTHING: CleanupReport = { fixes: 0, segments: 0, places: 0, media: 0 };

/**
 * Remove everything too far from home to be true, once.
 *
 * Resolves to what it removed, which is worth logging and worth nothing else.
 * Runs before any store is read — see `App.tsx` — so no screen ever renders a
 * position this would have deleted.
 */
export async function removeImpossiblePositions(): Promise<CleanupReport> {
  const done = await readJson<boolean>(STORAGE_KEYS.cleanedFarPositions);
  if (done === true) return NOTHING;

  const report = { fixes: 0, segments: 0, places: 0, media: 0 };

  try {
    // Raw fixes not yet frozen. The timeline is re-derived from these, so
    // removing them is what puts today right.
    const buffer = (await readJson<readonly { lat: number; lon: number }[]>(STORAGE_KEYS.fixBuffer)) ?? [];
    const keptFixes = buffer.filter((fix) => isPlausible(fix));
    report.fixes += buffer.length - keptFixes.length;
    if (keptFixes.length !== buffer.length) await writeJson(STORAGE_KEYS.fixBuffer, keptFixes);

    // The archive, a day at a time. A day left with nothing in it is removed
    // rather than kept as an empty entry nobody can account for.
    for (const dayKey of await archivedDayKeys()) {
      const key = archiveKeyFor(dayKey);
      const day = (await readJson<readonly { lat: number; lon: number }[]>(key)) ?? [];
      const kept = day.filter((fix) => isPlausible(fix));
      if (kept.length === day.length) continue;

      report.fixes += day.length - kept.length;
      if (kept.length === 0) await removeKeys([key]);
      else await writeJson(key, kept);
    }

    // Frozen days keep their segments and not their fixes, so a bad row there
    // has to be removed directly — there is nothing left to re-derive it from.
    const log = (await readJson<readonly Segment[]>(STORAGE_KEYS.dayLog)) ?? [];
    const repaired = log.map(repairSegment);
    const keptSegments = repaired.filter((segment): segment is Segment => segment !== null);
    // Counted as touched, not merely as dropped: a row that lost a point is a
    // row this changed, and the number is only ever read in a log line.
    report.segments += repaired.filter((segment, index) => segment !== log[index]).length;
    if (report.segments > 0) await writeJson(STORAGE_KEYS.dayLog, keptSegments);

    // A place made from a bad stay is a name pinned to open water.
    const places = (await readJson<readonly Place[]>(STORAGE_KEYS.places)) ?? [];
    const keptPlaces = places.filter((place) => isPlausible(place));
    report.places += places.length - keptPlaces.length;
    if (keptPlaces.length !== places.length) await writeJson(STORAGE_KEYS.places, keptPlaces);

    // The capture is kept and only its position is cleared: a photograph is
    // not wrong because the app was wrong about where it was taken.
    const media = (await readJson<readonly MediaItem[]>(STORAGE_KEYS.media)) ?? [];
    const keptMedia = media.map((item) => (item.at && !isPlausible(item.at) ? { ...item, at: null } : item));
    report.media += media.filter((item) => item.at && !isPlausible(item.at)).length;
    if (report.media > 0) await writeJson(STORAGE_KEYS.media, keptMedia);
  } catch (error) {
    // Marked done anyway. A cleanup that throws every launch and blocks the app
    // behind it is worse than one bad row left on a timeline.
    console.warn('The one-off position cleanup did not finish', error);
  }

  await writeJson(STORAGE_KEYS.cleanedFarPositions, true);
  return report;
}
