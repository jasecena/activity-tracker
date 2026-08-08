import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { MediaItem } from '@/core/media';
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

function media(index: number, kind: MediaItem['kind'] = 'photo'): MediaItem {
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
    // Newest first, so the top of the list is the last thing captured. The
    // second argument is the progress callback the open reports through.
    expect(opened).toHaveBeenCalledWith(items[4], expect.any(Function));
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
