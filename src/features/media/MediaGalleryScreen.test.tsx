import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

describe('MediaGalleryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('says so plainly when nothing has been captured', async () => {
    await render(<MediaGalleryScreen items={[]} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

    expect(screen.getByText(/Photos, video and voice notes appear here/)).toBeOnTheScreen();
  });

  // The whole point of the screen: a gallery of ten videos must not be ten
  // decrypted videos. Thumbnails are cheap and there are many; captures are
  // expensive and there is exactly one.
  it('opens only the capture you are looking at, however many there are', async () => {
    const items = [media(1), media(2), media(3), media(4), media(5)];

    await render(<MediaGalleryScreen items={items} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

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

    await render(<MediaGalleryScreen items={[sideways]} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

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
    await render(
      <MediaGalleryScreen
        items={[media(1, 'photo', 'landscapeLeft')]}
        tzOffsetMinutes={0}
        visible
        onOpenDetails={noop}
      />,
    );

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
    await render(<MediaGalleryScreen items={[media(1, 'video')]} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

    const video = await screen.findByLabelText('Video');
    expect(video.props.nativeControls).toBe(false);
    expect(screen.getByLabelText('Play')).toBeOnTheScreen();
    expect(screen.getByLabelText(/Playback position/)).toBeOnTheScreen();
  });

  it('starts the clip as soon as it is the page you are on', async () => {
    await render(<MediaGalleryScreen items={[media(1, 'video')]} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

    await screen.findByLabelText('Video');
    const player = (useVideoPlayer as jest.Mock).mock.results[0]?.value;
    expect(player.play).toHaveBeenCalled();
    // And the scrubber will actually move: without an update interval the
    // timeUpdate event never fires and the position is a still image of zero.
    expect(player.timeUpdateEventInterval).toBeGreaterThan(0);
  });

  it('draws a thumbnail for the neighbours it is not opening', async () => {
    const items = [media(1), media(2), media(3)];

    await render(<MediaGalleryScreen items={items} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

    await waitFor(() => expect(thumbnails).toHaveBeenCalledTimes(3));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  // Audio has no thumbnail and never will. Asking for one on every scroll would
  // be a decrypt of nothing, repeated forever.
  it('never asks for a thumbnail a voice note does not have', async () => {
    await render(<MediaGalleryScreen items={[media(1, 'audio')]} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

    await act(async () => {});
    expect(thumbnails).not.toHaveBeenCalled();
  });

  // Every tab stays mounted, so without this a video carries on playing behind
  // Settings — and a decrypted capture sits in the cache while you read it.
  it('opens nothing while another tab is showing', async () => {
    const items = [media(1), media(2)];

    const view = await render(
      <MediaGalleryScreen items={items} tzOffsetMinutes={0} visible={false} onOpenDetails={noop} />,
    );

    await act(async () => {});
    expect(opened).not.toHaveBeenCalled();

    await view.rerender(<MediaGalleryScreen items={items} tzOffsetMinutes={0} visible onOpenDetails={noop} />);
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));

    await view.rerender(<MediaGalleryScreen items={items} tzOffsetMinutes={0} visible={false} onOpenDetails={noop} />);
    await waitFor(() => expect(released).toHaveBeenCalledWith(items[1]));
  });

  // The metadata is deliberately not on the main view; this is the only way to
  // it, so it is worth pinning that it goes somewhere.
  it('offers the details of the capture on screen behind the ⋯', async () => {
    const items = [media(1), media(2)];
    const onOpenDetails = jest.fn();

    await render(<MediaGalleryScreen items={items} tzOffsetMinutes={0} visible onOpenDetails={onOpenDetails} />);

    await act(async () => fireEvent.press(screen.getByLabelText('About this capture')));

    expect(onOpenDetails).toHaveBeenCalledWith(items[1]);
  });

  it('names each thumbnail by what it is and when it was taken', async () => {
    await render(<MediaGalleryScreen items={[media(7)]} tzOffsetMinutes={0} visible onOpenDetails={noop} />);

    expect(screen.getByLabelText('photo at 09:07')).toBeOnTheScreen();
  });
});
