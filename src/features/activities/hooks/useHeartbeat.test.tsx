import { act, renderHook } from '@testing-library/react-native';
import * as LocationModule from 'expo-location';

import { readBuffer } from '@/services/fixBuffer';
import { STORAGE_KEYS, writeJson } from '@/services/storage';

import { HEARTBEAT_MS, useHeartbeat } from './useHeartbeat';

/**
 * A phone that does not move produces no fixes — that is what makes tracking
 * cheap, and it is why sitting still for an afternoon could leave a day with
 * nothing in it. The heartbeat fills that gap while the app is open.
 *
 * `renderHook` is awaited, like every render in this suite: in React 19 it is
 * asynchronous, and not awaiting one leaves the act scope open so the *next*
 * test silently never runs its effects.
 */

const location = LocationModule as unknown as typeof import('../../../../__mocks__/expo-location');

beforeEach(async () => {
  // The store and the mock's call log both outlive a test in this file, and
  // every assertion here counts one or the other.
  await writeJson(STORAGE_KEYS.fixBuffer, []);
  jest.clearAllMocks();
  jest.useFakeTimers();
});

/**
 * Advance the clock and let the promises the timer started settle.
 *
 * The first heartbeat is scheduled with `setTimeout(0)` rather than run
 * inline, so under fake timers nothing happens until the clock moves — and the
 * work it starts is asynchronous, so the act scope has to drain after it.
 */
async function tick(ms = 1) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  jest.useRealTimers();
});

it('records a position as soon as the app is open', async () => {
  await act(async () => {
    await renderHook(() => useHeartbeat(true, () => undefined));
  });

  await tick();

  expect(location.getCurrentPositionAsync).toHaveBeenCalled();
  expect(await readBuffer()).toHaveLength(1);
});

// Not a throttle but a rule. The switch being off means the app records
// nowhere you go, and a heartbeat that ignored it would write down your
// position after you asked it not to.
it('records nothing at all while tracking is off', async () => {
  await act(async () => {
    await renderHook(() => useHeartbeat(false, () => undefined));
  });

  await tick(HEARTBEAT_MS * 2);

  expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(await readBuffer()).toHaveLength(0);
});

it('takes the next one only after the interval has passed', async () => {
  await act(async () => {
    await renderHook(() => useHeartbeat(true, () => undefined));
  });
  await tick();
  const afterFirst = location.getCurrentPositionAsync.mock.calls.length;
  expect(afterFirst).toBeGreaterThan(0);

  await tick(HEARTBEAT_MS / 2);
  expect(location.getCurrentPositionAsync).toHaveBeenCalledTimes(afterFirst);

  await tick(HEARTBEAT_MS);
  expect(location.getCurrentPositionAsync.mock.calls.length).toBeGreaterThan(afterFirst);
});

it('tells the timeline to re-read once a fix has landed', async () => {
  const onRecorded = jest.fn();
  await act(async () => {
    await renderHook(() => useHeartbeat(true, onRecorded));
  });

  await tick();

  expect(onRecorded).toHaveBeenCalled();
});
