import { act, render, screen, waitFor } from '@testing-library/react-native';

import type { MediaItem } from '@/core/media';
import { useVideoPlayer } from 'expo-video';

import { openForPlayback, openThumbnail, releasePlayback } from '@/services/mediaStore';

import { MediaGalleryScreen } from './MediaGalleryScreen';

jest.mock('@/services/mediaStore', () => ({
  openThumbnail: jest.fn((fileName: string) => Promise.resolve(`file:///cache/${fileName}.jpg`)),
  openForPlayback: jest.fn((item: { id: string }) => Promise.resolve(`file:///cache/${item.id}.mov`)),
  releasePlayback: jest.fn(() => Promise.resolve()),
}));

const opened = openForPlayback as jest.MockedFunction<typeof openForPlayback>;
const thumbnails = openThumbnail as jest.MockedFunction<typeof openThumbnail>;
const released = releasePlayback as jest.MockedFunction<typeof releasePlayback>;

function media(
  index: number,
  kind: MediaItem['kind'] = 'photo',
  orientation: MediaItem['orientation'] = null,
): MediaItem {
  const capturedAt = Date.UTC(2026, 7, 8, 9, index, 0);
  return {
    id: `m-${capturedAt}`,
    kind,
    capturedAt,
    durationMs: kind === 'photo' ? null : 4_000,
    fileName: `${capturedAt}.avm`,
    thumbFileName: kind === 'audio' ? null : `${capturedAt}.thumb.avm`,
    byteLength: 1_024,
    at: null,
    note: '',
    orientation,
  };
}

const noop = () => {};

/** The full prop set, with the newcomers defaulted so old tests read as before. */
function gallery(items: MediaItem[], overrides: Partial<Parameters<typeof MediaGalleryScreen>[0]> = {}) {
  return (
    <MediaGalleryScreen
      items={items}
      tzOffsetMinutes={0}
      visible
      mapsEnabled={false}
      positionFor={() => null}
      onForget={noop}
      focusId={null}
      onFocusHandled={noop}
      {...overrides}
    />
  );
}

describe('MediaGalleryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('says so plainly when nothing has been captured', async () => {
    await render(gallery([]));

    expect(screen.getByText(/Photos, video and voice notes appear here/)).toBeOnTheScreen();
  });

  // The whole point of the screen: a gallery of ten videos must not be ten
  // decrypted videos. Thumbnails are cheap and there are many; captures are
  // expensive and there is exactly one.
  it('opens only the capture you are looking at, however many there are', async () => {
    const items = [media(1), media(2), media(3), media(4), media(5)];

    await render(gallery(items));

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    // Newest first, so the top of the list is the last thing captured.
    expect(opened).toHaveBeenCalledWith(items[4]);
  });

  /**
   * A phone settled this, and the answer was "do nothing".
   *
   * `expo-camera` turns the pixels itself, so a capture taken sideways arrives
   * already upright and turning it again is what put it on its side — ninety
   * degrees off, which is the signature of one rotation too many rather than
   * one in the wrong direction. `CAMERA_WRITES_UPRIGHT_PIXELS` is the switch,
   * and this asserts the behaviour it selects rather than the constant itself.
   */
  it('leaves a sideways capture alone, because the camera already turned it', async () => {
    const sideways = media(1, 'photo', 'landscapeLeft');

    await render(gallery([sideways]));

    const photo = await screen.findByLabelText('Photo');
    expect(photo).toHaveStyle({ transform: undefined });
    // The orientation is still recorded; it is simply not acted on here.
    expect(sideways.orientation).toBe('landscapeLeft');
    // And nothing ever asked the store to rewrite the file.
    expect(openForPlayback).toHaveBeenCalledWith(sideways);
  });

  /**
   * The layout half of the same bug, and the reason it was so visible: the
   * turning wrapper was a plain sized `View`, so it stopped being an overlay
   * and became a flex child. The thumbnail drawn underneath the photograph
   * became a band across the top with the photograph pushed below it.
   */
  it('draws the thumbnail underneath the capture rather than above it', async () => {
    await render(gallery([media(1, 'photo', 'landscapeLeft')]));

    const photo = await screen.findByLabelText('Photo');
    // Same parent, both absolutely filling it: stacked, not stacked *up*.
    expect(photo).toHaveStyle({ position: 'absolute' });
  });

  /**
   * The app's own transport. AVKit's controls consumed every drag that began
   * on them, so no gesture of this screen's could start over a playing video —
   * owning the controls is what makes the swipe-up and the grid possible at
   * all. What a test can see is that the native controls are off and ours are
   * on, wired to the player.
   */
  it('plays a video with its own controls, not the system ones', async () => {
    await render(gallery([media(1, 'video')]));

    const video = await screen.findByLabelText('Video');
    expect(video.props.nativeControls).toBe(false);
    expect(screen.getByLabelText('Play')).toBeOnTheScreen();
    expect(screen.getByLabelText(/Playback position/)).toBeOnTheScreen();
  });

  it('starts the clip as soon as it is the page you are on', async () => {
    await render(gallery([media(1, 'video')]));

    await screen.findByLabelText('Video');
    const player = (useVideoPlayer as jest.Mock).mock.results[0]?.value;
    expect(player.play).toHaveBeenCalled();
    // And the scrubber will actually move: without an update interval the
    // timeUpdate event never fires and the position is a still image of zero.
    expect(player.timeUpdateEventInterval).toBeGreaterThan(0);
  });

  it('draws a thumbnail for the neighbours it is not opening', async () => {
    const items = [media(1), media(2), media(3)];

    await render(gallery(items));

    await waitFor(() => expect(thumbnails).toHaveBeenCalledTimes(3));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  // Audio has no thumbnail and never will. Asking for one on every scroll would
  // be a decrypt of nothing, repeated forever.
  it('never asks for a thumbnail a voice note does not have', async () => {
    await render(gallery([media(1, 'audio')]));

    await act(async () => {});
    expect(thumbnails).not.toHaveBeenCalled();
  });

  // Every tab stays mounted, so without this a video carries on playing behind
  // Settings — and a decrypted capture sits in the cache while you read it.
  it('opens nothing while another tab is showing', async () => {
    const items = [media(1), media(2)];

    const view = await render(gallery(items, { visible: false }));

    await act(async () => {});
    expect(opened).not.toHaveBeenCalled();

    await view.rerender(gallery(items));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));

    await view.rerender(gallery(items, { visible: false }));
    await waitFor(() => expect(released).toHaveBeenCalledWith(items[1]));
  });

  /**
   * The Day tab's thumbnails land here: a capture id arrives, the pager jumps
   * to it, and the arrival is acknowledged so the same thumbnail works twice.
   */
  it('lands on a capture another screen pointed at, and says so', async () => {
    const items = [media(1), media(2), media(3)];
    const onFocusHandled = jest.fn();

    await render(gallery(items, { focusId: items[0]!.id, onFocusHandled }));

    await waitFor(() => expect(onFocusHandled).toHaveBeenCalled());
    // Oldest capture: last page of a newest-first pager.
    expect(screen.getByText('3 of 3')).toBeOnTheScreen();
  });

  it('leaves an id it cannot find unacknowledged, for a list still catching up', async () => {
    const onFocusHandled = jest.fn();

    await render(gallery([media(1)], { focusId: 'm-nope', onFocusHandled }));

    await act(async () => {});
    expect(onFocusHandled).not.toHaveBeenCalled();
  });

  it('names each thumbnail by what it is and when it was taken', async () => {
    await render(gallery([media(7)]));

    expect(screen.getByLabelText('photo at 09:07')).toBeOnTheScreen();
  });
});
