import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  FlatList,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { formatClockTime, formatDayTitle, formatDuration } from '@/core/format';
import {
  displayRotationFor,
  groupMediaByDay,
  stageSizeFor,
  type CaptureOrientation,
  type MediaItem,
  type Size,
} from '@/core/media';
import type { Position } from '@/core/replay';
import { MapCanvas } from '@/components/MapCanvas';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import { ClipControls } from '@/components/ClipControls';

import { isVerticalDrag, releasedIntent } from './verticalIntent';

import { useSealedFile } from './hooks/useSealedFile';
import { useSealedImages } from './hooks/useSealedImages';

interface MediaGalleryScreenProps {
  readonly items: readonly MediaItem[];
  readonly tzOffsetMinutes: number;
  /** False while another tab is showing, so nothing plays out of sight. */
  readonly visible: boolean;
  readonly mapsEnabled: boolean;
  /** Where the day says a capture happened, or null — resolved by the shell, which holds the track. */
  readonly positionFor: (item: MediaItem) => Position | null;
  readonly onForget: (id: string) => void;
  /** Turn a photograph a quarter turn clockwise, for the sideways few from before orientation was recorded. */
  readonly onRotate: (id: string) => void;
  /**
   * A capture another screen wants looked at — the Day tab's thumbnails land
   * here. Handled once and acknowledged, so pressing the same one twice works.
   */
  readonly focusId: string | null;
  readonly onFocusHandled: () => void;
}

/**
 * The filmstrip squares are not square.
 *
 * Width is what the strip can afford — it decides how many captures are within
 * reach of a thumb — and height is free, because the strip is a single row with
 * nothing under it. A taller box shows more of a portrait photograph, which is
 * what almost every capture is.
 *
 * One ratio for all of them, whatever shape the capture is. A strip whose boxes
 * changed shape with their contents would jump as it scrolled, and the eye
 * reads a row of identical frames far faster than it reads a mosaic. The
 * picture fills the box and is cropped to fit — the thumbnail is for finding a
 * capture, not for looking at one.
 */
const STRIP_WIDTH = 60;
const STRIP_HEIGHT = 84;
const STRIP_GAP = spacing.xs;

/**
 * Everything you have captured, one at a time.
 *
 * Photos-like on purpose: the capture fills the screen, a strip of thumbnails
 * runs beneath it, and swiping moves between them. What is *not* on this screen
 * is as deliberate — no times, no sizes, no coordinates. Looking at a photo is
 * not reading about a photo, and everything the app knows is one tap away
 * behind the ⋯.
 *
 * **Only the item you are looking at is decrypted.** Two lists, both windowed,
 * are what keep that true: the pager keeps three pages alive rather than every
 * capture you own, and of those three only the centre one is opened. The others
 * draw their thumbnails, which cost a few kilobytes each — that is what
 * thumbnails are for, and it is why a fast swipe through a hundred videos costs
 * nothing until you stop on one.
 */
export function MediaGalleryScreen({
  items,
  tzOffsetMinutes,
  visible,
  mapsEnabled,
  positionFor,
  onForget,
  onRotate,
  focusId,
  onFocusHandled,
}: MediaGalleryScreenProps) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  /**
   * What is drawn over the capture: nothing, the info panel, or the grid.
   *
   * One state rather than two booleans, because they are exclusive by design —
   * an info panel over a grid is two answers to "what am I looking at".
   */
  const [panel, setPanel] = useState<'none' | 'info' | 'grid'>('none');
  const pager = useRef<FlatList<MediaItem>>(null);
  const strip = useRef<FlatList<MediaItem>>(null);

  // Newest first, like the timeline: the thing you just captured is the thing
  // you most likely opened this for.
  const ordered = useMemo(() => [...items].sort((a, b) => b.capturedAt - a.capturedAt), [items]);

  const safeIndex = Math.min(index, Math.max(0, ordered.length - 1));
  const current = ordered[safeIndex] ?? null;

  // Nothing is opened while another tab is showing. Coming back re-opens it,
  // which costs one decrypt and is the difference between a video that carries
  // on playing behind Settings and one that does not.
  const file = useSealedFile(visible ? current : null);
  const images = useSealedImages();

  // A window around where you are, plus the head of the strip, which is on
  // screen whatever page you are on.
  useEffect(() => {
    images.load(ordered.slice(0, 12));
    images.load(ordered.slice(Math.max(0, safeIndex - 4), safeIndex + 5));
  }, [images, ordered, safeIndex]);

  const show = useCallback(
    (next: number) => {
      setIndex(next);
      pager.current?.scrollToOffset({ offset: next * width, animated: false });
      strip.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0.5 });
    },
    [width],
  );

  /**
   * A capture the Day tab pointed at.
   *
   * Split the way the lint rule insists, and the rule is right: the state
   * changes are a render-time adjustment — React re-renders before committing,
   * so nothing flashes — and the effect touches only the outside world, the
   * two lists' scroll positions and the parent's acknowledgement. `handled`
   * resets when the parent clears its request, which is what lets the same
   * thumbnail work twice.
   */
  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  if (!focusId && handledFocus !== null) setHandledFocus(null);
  if (focusId && focusId !== handledFocus) {
    const wanted = ordered.findIndex((candidate) => candidate.id === focusId);
    // An id the list does not hold yet stays unhandled: the list may simply
    // not have caught up, and a capture that arrives a moment later still lands.
    if (wanted !== -1) {
      setHandledFocus(focusId);
      setIndex(wanted);
      setPanel('none');
    }
  }
  useEffect(() => {
    if (handledFocus === null) return;
    pager.current?.scrollToOffset({ offset: safeIndex * width, animated: false });
    strip.current?.scrollToIndex({ index: safeIndex, animated: false, viewPosition: 0.5 });
    onFocusHandled();
  }, [handledFocus, safeIndex, width, onFocusHandled]);

  /** The grid draws every day at once, so it wants every thumbnail. */
  useEffect(() => {
    if (panel === 'grid') images.load(ordered);
  }, [panel, images, ordered]);

  /**
   * Up for the panel, down for the grid — the Photos gestures. A decisively
   * vertical drag has no other claimant here: the pager underneath scrolls
   * horizontally, which is the structural difference between this gesture and
   * the timeline swipe that could not be made reliable.
   *
   * Rebuilt per render, deliberately — see the capture screen's wheel for why
   * both ways of memoising a responder are banned here.
   */
  const verticalGesture = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => isVerticalDrag(gesture.dx, gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      const intent = releasedIntent(gesture.dy, gesture.vy);
      if (!intent) return;
      // Pulling down over an open panel closes it; the grid only opens from a
      // clean stage. Every drag is one step, never a jump through two states.
      if (panel === 'info') {
        if (intent === 'grid') setPanel('none');
        return;
      }
      setPanel(intent === 'info' ? 'info' : 'grid');
    },
  });

  if (ordered.length === 0) {
    return (
      <View style={styles.screen}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} accessibilityRole="header">
            Media
          </Text>
          <Ionicons name="images-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>Nothing captured yet</Text>
          <Text style={styles.emptyDetail}>Photos, video and voice notes appear here.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Over the capture, not above it. A header and a subtitle cost about a
          fifth of the screen on a phone, and what this tab is for is looking at
          the picture. */}
      <View style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.counter}>
          {safeIndex + 1} of {ordered.length}
        </Text>
      </View>

      {/* The vertical gestures live on the wrapper: the pager inside claims
          horizontal drags, this claims decisively vertical ones, and the two
          sets do not overlap. */}
      <View style={StyleSheet.absoluteFill} {...verticalGesture.panHandlers}>
        <FlatList
          ref={pager}
          data={ordered}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // Fixed-width pages, so the list never has to measure one to know where
          // the next begins — which is what lets `scrollToIndex` work on an item
          // that has not been rendered yet.
          getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
          initialNumToRender={1}
          windowSize={3}
          removeClippedSubviews
          onMomentumScrollEnd={(event) => {
            const next = Math.round(event.nativeEvent.contentOffset.x / width);
            if (next === safeIndex) return;
            setIndex(next);
            strip.current?.scrollToIndex({ index: next, animated: true, viewPosition: 0.5 });
          }}
          style={StyleSheet.absoluteFill}
          renderItem={({ item, index: position }) => (
            <View style={[styles.page, { width }]}>
              <Stage
                item={item}
                live={position === safeIndex}
                uri={position === safeIndex ? file.uri : null}
                failed={position === safeIndex && file.failed}
                opening={position === safeIndex && file.uri === null && !file.failed}
                thumbUri={images.uriFor(item)}
              />
            </View>
          )}
        />
      </View>

      {/* Everything the app knows about this capture, below it rather than on
          a page of its own. This absorbed the detail screen: same fields, same
          map, same Forget — reached by a pull upward instead of a ⋯ that took
          you somewhere else. Swiping down, or the chevron, puts it away. */}
      {panel === 'info' && current ? (
        <InfoPanel
          item={current}
          at={positionFor(current)}
          tzOffsetMinutes={tzOffsetMinutes}
          mapsEnabled={mapsEnabled}
          thumbUri={images.uriFor(current)}
          onForget={onForget}
          onRotate={onRotate}
          onClose={() => setPanel('none')}
        />
      ) : null}

      {/* Every day of captures at once, pulled down over the pager. Tapping a
          thumbnail lands the pager on it, which is also how the grid closes —
          choosing something *is* leaving. */}
      {panel === 'grid' ? (
        <View style={[StyleSheet.absoluteFill, styles.grid]}>
          <View style={styles.gridHeader}>
            <Text style={styles.gridTitle} accessibilityRole="header">
              All captures
            </Text>
            <Pressable
              onPress={() => setPanel('none')}
              accessibilityRole="button"
              accessibilityLabel="Back to the capture"
              style={({ pressed }) => [styles.gridClose, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-up" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.gridBody}>
            {groupMediaByDay(ordered, tzOffsetMinutes).map((day) => (
              <View key={day.key}>
                <Text style={styles.gridDay}>{formatDayTitle(day.newestAt, tzOffsetMinutes)}</Text>
                <View style={styles.gridRow}>
                  {day.items.map((item) => {
                    const uri = images.uriFor(item);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          const wanted = ordered.findIndex((candidate) => candidate.id === item.id);
                          if (wanted !== -1) show(wanted);
                          setPanel('none');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.kind} at ${formatClockTime(item.capturedAt, tzOffsetMinutes)}`}
                        style={({ pressed }) => [styles.gridThumb, pressed && styles.pressed]}
                      >
                        {uri ? (
                          <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
                        ) : (
                          <Ionicons
                            name={item.kind === 'audio' ? 'mic-outline' : 'image-outline'}
                            size={18}
                            color={colors.textMuted}
                          />
                        )}
                        {item.kind === 'video' ? (
                          <View style={styles.thumbBadge}>
                            <Ionicons name="play" size={11} color={colors.textPrimary} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <FlatList
        ref={strip}
        data={ordered}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, position) => ({
          length: STRIP_WIDTH + STRIP_GAP,
          offset: (STRIP_WIDTH + STRIP_GAP) * position,
          index: position,
        })}
        // Jumping to a far-off item can outrun the list's own measurements;
        // waiting a beat and asking again is the documented way through it.
        onScrollToIndexFailed={({ index: wanted }) => {
          strip.current?.scrollToOffset({ offset: (STRIP_WIDTH + STRIP_GAP) * wanted, animated: false });
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          images.load(viewableItems.map((entry) => entry.item as MediaItem));
        }}
        style={styles.stripBar}
        contentContainerStyle={styles.strip}
        renderItem={({ item, index: position }) => {
          const uri = images.uriFor(item);
          return (
            <Pressable
              onPress={() => show(position)}
              accessibilityRole="button"
              accessibilityState={{ selected: position === safeIndex }}
              accessibilityLabel={`${item.kind} at ${formatClockTime(item.capturedAt, tzOffsetMinutes)}`}
              style={({ pressed }) => [
                styles.thumb,
                position === safeIndex && styles.thumbOn,
                pressed && styles.pressed,
              ]}
            >
              {uri ? (
                // A square, so no dimensions to swap: `cover` fills it either
                // way and only the picture inside needs turning.
                <Image
                  source={{ uri }}
                  style={[styles.thumbImage, { transform: [{ rotate: `${displayRotationFor(item.orientation)}deg` }] }]}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons
                  name={item.kind === 'audio' ? 'mic-outline' : 'image-outline'}
                  size={18}
                  color={colors.textMuted}
                />
              )}

              {/* A video's poster frame is a photograph until something says
                  otherwise. The badge is what tells the two apart in a strip of
                  60-point squares. */}
              {item.kind === 'video' ? (
                <View style={styles.thumbBadge}>
                  <Ionicons name="play" size={11} color={colors.textPrimary} />
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

interface StageProps {
  readonly item: MediaItem;
  readonly live: boolean;
  readonly uri: string | null;
  readonly failed: boolean;
  /** True until the file is ready — a blink now that nothing is decrypted. */
  readonly opening: boolean;
  readonly thumbUri: string | null;
}

/**
 * One capture, filling the screen.
 *
 * The thumbnail is drawn **first and underneath**, always. For the page you are
 * on that is the poster frame while the capture is being opened, so there is
 * something to look at immediately rather than a black rectangle; for the pages
 * either side of it, it is the whole story.
 */
function Stage({ item, live, uri, failed, opening, thumbUri }: StageProps) {
  return (
    <View style={styles.stage}>
      {thumbUri ? (
        <Turned orientation={item.orientation}>
          <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        </Turned>
      ) : null}

      {live && failed ? (
        <Text style={styles.failed}>
          This capture cannot be read. That happens to a file restored onto another phone — the bytes travelled and the
          key, deliberately, did not.
        </Text>
      ) : null}

      {live && uri ? <Playing item={item} uri={uri} /> : null}

      {live && opening ? (
        <View style={styles.opening}>
          <Text style={styles.openingText}>Opening…</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Turns a capture the right way up, for as long as you are looking at it.
 *
 * The file is never touched. A photograph taken with the phone on its side was
 * written the way the camera saw it — portrait-shaped, world lying down — and
 * this is the rotation that undoes that, applied to the view and thrown away
 * when the view goes.
 *
 * The box has to be given the screen's dimensions the other way round before it
 * is turned. A quarter turn happens about the centre and resizes nothing, so
 * rotating a portrait-shaped view gives a portrait-shaped view lying down: a
 * ribbon down the middle of the screen with the picture squeezed into it.
 *
 * Nothing here is animated. The rotation is a fact about the capture, settled
 * before it was ever drawn, rather than something that happens while you watch.
 */
function Turned({ orientation, children }: { readonly orientation: CaptureOrientation | null; children: ReactNode }) {
  // Measured rather than taken from the window: the stage is a page of the
  // pager, not the screen — there is a filmstrip under it — and sizing the box
  // from the window makes a turned capture overhang both.
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const degrees = displayRotationFor(orientation);

  // The common case, and now the only one on a real phone: the camera writes
  // the picture upright already. Passing the children straight through matters
  // beyond saving a view — everything drawn on the stage positions itself with
  // `absoluteFill`, so a wrapper here is a flex child that takes layout space
  // and pushes what follows it down the screen. That is exactly what it did:
  // the thumbnail underneath stopped being underneath and became a band across
  // the top with the photograph below it.
  if (degrees === 0) return <>{children}</>;

  const box = stageSizeFor(frame, degrees);
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setFrame(event.nativeEvent.layout)}
      pointerEvents="box-none"
    >
      <View style={styles.turning}>
        <View style={[box, { transform: [{ rotate: `${degrees}deg` }] }]}>{children}</View>
      </View>
    </View>
  );
}

/**
 * What was the detail page, as a panel under the capture.
 *
 * The photograph stays where it is, visible above; this covers the lower part
 * of the screen with the same facts the page carried — when, what, how big,
 * where, and the map with the capture pinned to the spot. Nothing navigates:
 * putting it away is a pull downward, and the capture never stopped being the
 * thing on screen.
 */
function InfoPanel({
  item,
  at,
  tzOffsetMinutes,
  mapsEnabled,
  thumbUri,
  onForget,
  onRotate,
  onClose,
}: {
  readonly item: MediaItem;
  readonly at: Position | null;
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  readonly thumbUri: string | null;
  readonly onForget: (id: string) => void;
  readonly onRotate: (id: string) => void;
  readonly onClose: () => void;
}) {
  const confirmForget = () =>
    Alert.alert('Forget this capture?', 'The file is deleted from this phone. There is no copy anywhere else.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => {
          onClose();
          onForget(item.id);
        },
      },
    ]);

  return (
    <View style={styles.info}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Put details away"
        style={({ pressed }) => [styles.infoHandle, pressed && styles.pressed]}
      >
        <View style={styles.infoGrip} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.infoBody}>
        <View style={styles.infoCard}>
          <InfoRow label="Captured" value={formatClockTime(item.capturedAt, tzOffsetMinutes)} />
          <InfoRow label="Kind" value={item.kind} />
          <InfoRow label="Length" value={item.durationMs === null ? '—' : formatDuration(item.durationMs)} />
          <InfoRow label="Size on disk" value={`${Math.round(item.byteLength / 1024)} kB`} />
          <InfoRow label="Position" value={at ? `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}` : 'not known'} />
        </View>

        {at ? (
          <View>
            <MapCanvas
              mapsEnabled={mapsEnabled}
              tracks={[]}
              marks={[{ id: item.id, at, label: '', kind: 'media' }]}
              height={180}
              label="Map of where this was captured"
            />
            {thumbUri ? (
              <View style={styles.pin} pointerEvents="none">
                <Image source={{ uri: thumbUri }} style={styles.pinImage} resizeMode="cover" />
                <View style={styles.pinTail} />
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={styles.infoFootnote}>
            The day has no fixes for this moment, so there is nowhere to put it on a map.
          </Text>
        )}

        {/* Only a photograph, and one press per quarter turn: the app cannot
            know which of the old pictures are sideways — only their owner can
            see it — so this is a button rather than a migration. */}
        {item.kind === 'photo' ? (
          <Pressable
            onPress={() => onRotate(item.id)}
            accessibilityRole="button"
            accessibilityLabel="Rotate this photo a quarter turn"
            style={({ pressed }) => [styles.rotate, pressed && styles.pressed]}
          >
            <Ionicons name="reload-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.rotateText}>Rotate</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={confirmForget}
          accessibilityRole="button"
          accessibilityLabel="Forget this capture"
          style={({ pressed }) => [styles.forget, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={styles.forgetText}>Forget this capture</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Playing({ item, uri }: { readonly item: MediaItem; readonly uri: string }) {
  if (item.kind === 'photo') {
    return (
      <Turned orientation={item.orientation}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Photo" />
      </Turned>
    );
  }
  if (item.kind === 'video') {
    return <VideoPlaying uri={uri} orientation={item.orientation} durationMs={item.durationMs} />;
  }
  return <AudioPlaying uri={uri} durationMs={item.durationMs} />;
}

/**
 * A video, played from the stored file.
 *
 * `useVideoPlayer` is handed the file itself, so AVFoundation reads the frames
 * it needs and no more — a ten-minute clip costs what a ten-second one does,
 * and starting it costs nothing at all. That is what dropping the at-rest
 * encryption bought: there was no way to hand Core Media a stream this app
 * decrypted as it went, so every clip had to be written out whole first.
 */
/**
 * Plays as soon as it is the page you are on.
 *
 * Only the centre page mounts this at all — the pages either side are their
 * thumbnails — so "mounted" and "chosen to look at" are the same thing here,
 * and a video you have deliberately swiped to should not need a second tap to
 * begin. Swiping away unmounts it, which stops it.
 */
function VideoPlaying({
  uri,
  orientation,
  durationMs,
}: {
  readonly uri: string;
  readonly orientation: CaptureOrientation | null;
  readonly durationMs: number | null;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    // Without this the timeUpdate event never fires and the scrubber is a
    // still image of zero. Four a second reads as live.
    instance.timeUpdateEventInterval = 0.25;
    instance.play();
  });
  /**
   * The app's own transport, in an unturned layer above the picture.
   *
   * `nativeControls` went for touch routing: AVKit consumes every drag that
   * begins on its controls, so no gesture of this screen's — swipe up for
   * details, swipe down for the grid — could start over a playing video. It
   * also rotated with a turned clip, printing the scrubber sideways; drawing
   * the controls outside `Turned` is what being in charge of them buys.
   */
  return (
    <>
      <Turned orientation={orientation}>
        <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="contain" />
      </Turned>
      <View style={styles.clipControls}>
        <ClipControls player={player} durationMs={durationMs} />
      </View>
    </>
  );
}

function AudioPlaying({ uri, durationMs }: { readonly uri: string; readonly durationMs: number | null }) {
  const player = useAudioPlayer(uri);
  const [playing, setPlaying] = useState(false);

  return (
    <Pressable
      onPress={() => {
        if (playing) player.pause();
        else player.play();
        setPlaying(!playing);
      }}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
      style={({ pressed }) => [styles.audio, pressed && styles.pressed]}
    >
      <Ionicons name={playing ? 'pause-circle' : 'play-circle'} size={72} color={colors.textPrimary} />
      <Text style={styles.audioText}>{durationMs === null ? 'Voice note' : formatDuration(durationMs)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Black, like the camera: what sits behind a picture that does not fill the
  // frame should look deliberate rather than like a missing screen.
  screen: { flex: 1, backgroundColor: '#000' },
  page: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.md,
    right: spacing.md,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    ...typography.caption,
    color: colors.textPrimary,
    backgroundColor: 'rgba(11,15,20,0.55)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  about: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  stripBar: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1, flexGrow: 0 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  turning: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  clipControls: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: 96 },
  info: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '58%',
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  infoHandle: { alignItems: 'center', paddingVertical: spacing.sm },
  infoGrip: { width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  infoBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  infoCard: { gap: spacing.xs },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  infoLabel: { ...typography.caption, color: colors.textSecondary },
  infoValue: { ...typography.caption, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  infoFootnote: { ...typography.caption, color: colors.textSecondary },
  forget: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  forgetText: { ...typography.caption, color: colors.danger },
  rotate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  rotateText: { ...typography.caption, color: colors.textPrimary },
  pin: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 10,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinImage: { width: 56, height: 56, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.textPrimary },
  pinTail: {
    width: 2,
    height: 8,
    backgroundColor: colors.textPrimary,
  },
  grid: { backgroundColor: colors.background },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  gridTitle: { ...typography.title, color: colors.textPrimary },
  gridClose: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  gridBody: { padding: spacing.md, gap: spacing.sm },
  gridDay: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  gridThumb: {
    width: 76,
    height: 100,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  opening: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(11,15,20,0.75)',
  },
  openingText: { ...typography.caption, color: colors.textPrimary },
  failed: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
  audio: { alignItems: 'center', gap: spacing.sm },
  audioText: { ...typography.body, color: colors.textSecondary },
  strip: {
    gap: STRIP_GAP,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  thumb: {
    width: STRIP_WIDTH,
    height: STRIP_HEIGHT,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbOn: { borderColor: colors.move },
  thumbImage: { width: '100%', height: '100%' },
  thumbBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.7)',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyTitle: { ...typography.title, color: colors.textPrimary },
  emptyText: { ...typography.body, color: colors.textSecondary },
  emptyDetail: { ...typography.caption, color: colors.textMuted },
  pressed: { opacity: 0.6 },
});
