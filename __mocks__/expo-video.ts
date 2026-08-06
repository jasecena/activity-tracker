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
    loop: false,
    muted: false,
    playing: false,
    duration: 0,
    currentTime: 0,
  };
  setup?.(player);
  return player;
});
