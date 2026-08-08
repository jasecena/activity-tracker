import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { formatClockTime, formatDuration } from '@/core/format';
import type { MediaItem } from '@/core/media';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import { useSealedFile } from './hooks/useSealedFile';
import { useSealedImages } from './hooks/useSealedImages';

interface MediaGalleryScreenProps {
  readonly items: readonly MediaItem[];
  readonly tzOffsetMinutes: number;
  /** False while another tab is showing, so nothing plays out of sight. */
  readonly visible: boolean;
  /** Opens the details page — deliberately the only route to the metadata. */
  readonly onOpenDetails: (item: MediaItem) => void;
}

const STRIP_SIZE = 60;
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
export function MediaGalleryScreen({ items, tzOffsetMinutes, visible, onOpenDetails }: MediaGalleryScreenProps) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const pager = useRef<FlatList<MediaItem>>(null);
  const strip = useRef<FlatList<MediaItem>>(null);

  // Newest first, like the timeline: the thing you just captured is the thing
  // you most likely opened this for.
  const ordered = useMemo(() => [...items].sort((a, b) => b.capturedAt - a.capturedAt), [items]);

  const safeIndex = Math.min(index, Math.max(0, ordered.length - 1));
  const current = ordered[safeIndex] ?? null;

  /**
   * The capture you have asked to play, if you have asked.
   *
   * A photo opens the moment you land on it — it is a few hundred kilobytes and
   * waiting for a tap would be pointless ceremony. **A video does not.** Opening
   * one means decrypting forty megabytes, and doing that on arrival meant a
   * swipe through a dozen clips paid for every one of them, whether or not you
   * ever pressed play. The thumbnail is already on screen; the bytes can wait
   * until they are wanted.
   */
  const [asked, setAsked] = useState<string | null>(null);
  if (asked !== null && asked !== current?.id) setAsked(null);

  const wanted = current && (current.kind !== 'video' || asked === current.id) ? current : null;

  // Nothing is opened while another tab is showing. Coming back re-opens it,
  // which costs one decrypt and is the difference between a video that carries
  // on playing behind Settings and one that does not.
  const file = useSealedFile(visible ? wanted : null);
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

  if (ordered.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Media" subtitle="Nothing captured yet" />
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>Photos, video and voice notes appear here.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Media"
        subtitle={`${safeIndex + 1} of ${ordered.length}`}
        actions={
          current
            ? [{ label: 'About this capture', icon: 'ellipsis-horizontal', onPress: () => onOpenDetails(current) }]
            : undefined
        }
      />

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
        style={styles.pager}
        renderItem={({ item, index: position }) => (
          <View style={[styles.page, { width }]}>
            <Stage
              item={item}
              live={position === safeIndex}
              uri={position === safeIndex ? file.uri : null}
              failed={position === safeIndex && file.failed}
              opening={position === safeIndex && wanted !== null && file.uri === null && !file.failed}
              progress={file.progress}
              thumbUri={images.uriFor(item)}
              onPlay={() => setAsked(item.id)}
            />
          </View>
        )}
      />

      <FlatList
        ref={strip}
        data={ordered}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, position) => ({
          length: STRIP_SIZE + STRIP_GAP,
          offset: (STRIP_SIZE + STRIP_GAP) * position,
          index: position,
        })}
        // Jumping to a far-off item can outrun the list's own measurements;
        // waiting a beat and asking again is the documented way through it.
        onScrollToIndexFailed={({ index: wanted }) => {
          strip.current?.scrollToOffset({ offset: (STRIP_SIZE + STRIP_GAP) * wanted, animated: false });
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          images.load(viewableItems.map((entry) => entry.item as MediaItem));
        }}
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
                <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
              ) : (
                <Ionicons
                  name={item.kind === 'audio' ? 'mic-outline' : 'image-outline'}
                  size={18}
                  color={colors.textMuted}
                />
              )}
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
  /** True while its bytes are being decrypted, which for a video is worth showing. */
  readonly opening: boolean;
  readonly progress: number;
  readonly thumbUri: string | null;
  readonly onPlay: () => void;
}

/**
 * One capture, filling the screen.
 *
 * The thumbnail is drawn **first and underneath**, always. For the page you are
 * on that is the poster frame while the capture is being opened, so there is
 * something to look at immediately rather than a black rectangle; for the pages
 * either side of it, it is the whole story.
 */
function Stage({ item, live, uri, failed, opening, progress, thumbUri, onPlay }: StageProps) {
  return (
    <View style={styles.stage}>
      {thumbUri ? <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}

      {live && failed ? (
        <Text style={styles.failed}>
          This capture cannot be read. That happens to a file restored onto another phone — the bytes travelled and the
          key, deliberately, did not.
        </Text>
      ) : null}

      {live && uri ? <Playing item={item} uri={uri} /> : null}

      {/* The tap that spends the forty megabytes. Over the poster frame, so
          what you are choosing to open is what you can already see. */}
      {live && !uri && !failed && !opening && item.kind === 'video' ? (
        <Pressable
          onPress={onPlay}
          accessibilityRole="button"
          accessibilityLabel="Play video"
          style={({ pressed }) => [styles.play, pressed && styles.pressed]}
        >
          <Ionicons name="play" size={38} color={colors.textPrimary} />
        </Pressable>
      ) : null}

      {live && opening ? (
        <View style={styles.opening} accessible accessibilityLabel={`Opening, ${Math.round(progress * 100)}%`}>
          <Text style={styles.openingText}>Opening… {Math.round(progress * 100)}%</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Playing({ item, uri }: { readonly item: MediaItem; readonly uri: string }) {
  if (item.kind === 'photo') {
    return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Photo" />;
  }
  if (item.kind === 'video') return <VideoPlaying uri={uri} />;
  return <AudioPlaying uri={uri} durationMs={item.durationMs} />;
}

/**
 * A video, played from disk rather than held in memory.
 *
 * `useVideoPlayer` is handed a file URI, so AVFoundation reads the frames it
 * needs and no more — a ten-minute clip costs the same as a ten-second one. It
 * is also why the file has to exist decrypted on disk for the length of the
 * playback: there is no way to hand Core Media a stream this app decrypts as it
 * goes, and reading the whole clip into a JavaScript string to avoid that would
 * be the very thing being avoided.
 */
function VideoPlaying({ uri }: { readonly uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  return <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls contentFit="contain" />;
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
  screen: { flex: 1 },
  pager: { flex: 1 },
  page: { flex: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  play: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.6)',
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
  progressTrack: {
    width: 140,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: colors.move },
  failed: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
  audio: { alignItems: 'center', gap: spacing.sm },
  audioText: { ...typography.body, color: colors.textSecondary },
  strip: { gap: STRIP_GAP, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  thumb: {
    width: STRIP_SIZE,
    height: STRIP_SIZE,
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textMuted },
  pressed: { opacity: 0.6 },
});
