import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { appendFixes } from './fixBuffer';
import { LOCATION_TASK_NAME, toFix } from './location';

/**
 * The background handler. Imported for its side effect by `index.ts`, first.
 *
 * iOS relaunches this app into the background, with no UI, whenever the
 * distance filter trips. `TaskManager` looks for a handler registered under the
 * task name at that moment; if the bundle has not yet executed this
 * `defineTask` call, the launch is wasted and that stretch of the day is gone.
 * Module scope of a file imported at the top of the entry point is what
 * guarantees it is present within the first tick of every launch.
 *
 * It does one thing — write the fixes down — and it does it in as few
 * statements as possible. Everything else the app knows how to do can be done
 * later, in the foreground, from these same fixes. Nothing can recover a fix
 * that was never written because the handler was busy segmenting the last one
 * when iOS suspended it.
 */

interface LocationTaskData {
  readonly locations?: Location.LocationObject[];
}

TaskManager.defineTask<LocationTaskData>(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    // Nothing to do but note it. Throwing here gets the task killed by iOS, and
    // a killed task is not restarted until the app is opened again.
    console.warn('Background location task error', error.message);
    return;
  }

  const locations = data?.locations ?? [];
  if (locations.length === 0) return;

  try {
    await appendFixes(locations.map(toFix));
  } catch (writeError) {
    console.warn('Could not append background fixes', writeError);
  }
});
