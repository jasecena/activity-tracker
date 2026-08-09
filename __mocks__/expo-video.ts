/**
 * Video playback, off-device. A `View` and a player object with the methods the
 * media screen calls, which is all a component test can observe.
 */
import { createElement } from 'react';
import { View } from 'react-native';

export const VideoView = jest.fn((props: Record<string, unknown>) =>
  createElement(View, { accessibilityLabel: 'Video', ...props }, null),
);

export const useVideoPlayer = jest.fn((_source: unknown, setup?: (player: unknown) => void) => {
  const player = {
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    release: jest.fn(),
    seekBy: jest.fn(),
    loop: false,
    muted: false,
    playing: false,
    duration: 0,
    currentTime: 0,
    timeUpdateEventInterval: 0,
    // Enough of an event emitter for `useEvent` to subscribe and unsubscribe.
    // Nothing is ever emitted: a test drives the controls through presses,
    // and what they do to the player is what the spies above record.
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
  };
  setup?.(player);
  return player;
});
