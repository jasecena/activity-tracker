import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
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

describe('coming back to the app', () => {
  /**
   * Drive AppState through the listener the hook itself registered.
   *
   * Reaching for an emitter on the mock would be testing React Native rather
   * than this hook, and the mock's internals are not a contract.
   */
  function captureAppState(): { send: (state: 'active' | 'inactive' | 'background') => Promise<void> } {
    let handler: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
      handler = listener;
      return { remove: () => undefined };
    }) as typeof AppState.addEventListener);

    return {
      send: (state) =>
        act(async () => {
          handler?.(state);
        }),
    };
  }

  it('records a position the moment the app is opened again', async () => {
    const appState = captureAppState();

    await act(async () => {
      await renderHook(() => useHeartbeat(true, () => undefined));
    });
    await tick();
    const afterLaunch = location.getCurrentPositionAsync.mock.calls.length;
    expect(afterLaunch).toBeGreaterThan(0);

    // Two minutes later — well inside the interval — so nothing on its own.
    await tick(2 * 60_000);
    expect(location.getCurrentPositionAsync).toHaveBeenCalledTimes(afterLaunch);

    await appState.send('background');
    await appState.send('active');
    await tick();

    expect(location.getCurrentPositionAsync.mock.calls.length).toBeGreaterThan(afterLaunch);
  });

  // The app switcher reports `inactive` and then `active` again without the app
  // ever having left. Waking the GPS for that would cost a fix every time the
  // phone was flicked past.
  it('ignores the app switcher passing over it', async () => {
    const appState = captureAppState();

    await act(async () => {
      await renderHook(() => useHeartbeat(true, () => undefined));
    });
    await tick();
    const afterLaunch = location.getCurrentPositionAsync.mock.calls.length;

    await appState.send('inactive');
    await appState.send('active');
    await tick();

    expect(location.getCurrentPositionAsync).toHaveBeenCalledTimes(afterLaunch);
  });
});
