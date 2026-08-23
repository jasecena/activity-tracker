import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { appendTranscript, type DayNote, type NoteVoice } from '@/core/day';
import type { MediaItem } from '@/core/media';
import { formatDuration, formatTimecode } from '@/core/format';
import { confirmDestructive } from '@/components/confirmDestructive';
import { copyText } from '@/services/clipboard';
import { VoiceNotePlayer } from '@/components/VoiceNotePlayer';
import type { TranscriptionFailure, TranscriptionResult } from '@/services/transcribe';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import { MAX_VOICE_MS, useVoiceNote } from '../hooks/useVoiceNote';

import { RecordButton } from './RecordButton';

interface NoteSheetProps {
  /**
   * What the sheet is for, or null to close it.
   *
   * `{ kind: 'new' }` writes one about the day on screen; `{ kind: 'edit' }`
   * changes one already written. The two are one sheet because they are one
   * thing with one field, and a second component would only be the first with
   * the title swapped.
   */
  readonly target:
    | { readonly kind: 'new'; readonly mediaId?: string | null }
    | { readonly kind: 'edit'; readonly note: DayNote }
    | null;
  /**
   * When the note goes, unless it is changed here.
   *
   * Now for today, the end of the day for one already over, and the note's own
   * instant when editing. Worked out by the caller because it is the layer that
   * may read a clock — `core` takes `now` as a parameter, always.
   */
  readonly defaultAt: number;
  readonly onSave: (at: number, title: string, text: string, voice: NoteVoice | null, mediaId: string | null) => void;
  readonly onClose: () => void;
  /**
   * The capture this note is about, resolved by the caller, or null.
   *
   * Null means one of two things and the sheet tells them apart from the note's
   * own `mediaId`: no picture was ever attached, or the picture was forgotten
   * and this note outlived it. The second is worth saying out loud — a note
   * that was about a photograph is still a note about a photograph, and
   * silently drawing nothing would read as the app having lost it.
   */
  readonly attached?: MediaItem | null;
  /** Its thumbnail, once decrypted. Null until then, and for a capture with none. */
  readonly attachedThumbUri?: string | null;
  /** Go and look at the picture. Absent where there is nowhere to go. */
  readonly onOpenMedia?: (mediaId: string) => void;
  /**
   * Turn this note's recording into text, or absent when there is no API key.
   *
   * Absent rather than disabled: with no key there is no feature, and a button
   * that exists only to explain that it cannot work is worse than no button.
   * The caller owns the key — this sheet never sees it.
   */
  readonly onTranscribe?: (voice: NoteVoice) => Promise<TranscriptionResult>;
}

/** What went wrong, in the one sentence there is room for under the button. */
const TRANSCRIPTION_MESSAGES: Readonly<Record<TranscriptionFailure, string>> = {
  'no-key': 'Add an ElevenLabs key in Settings first.',
  'no-audio': 'The recording’s file is missing.',
  unauthorized: 'The key was refused. Check it in Settings.',
  'rate-limited': 'Out of credit, or too many requests. Try later.',
  // Not "nothing was sent" — see `TranscriptionFailure`. The outcome is what
  // is known; whether the bytes left the device is not.
  unreachable: 'Could not reach ElevenLabs. No text was added.',
  timeout: 'The service did not answer. Try again.',
  silent: 'Nothing was said in this recording.',
  failed: 'Transcribing did not work. Try again.',
};

/**
 * Writing something down about a day — or saying it.
 *
 * A sheet rather than a page, following `JourneyLabelSheet`: this is one field
 * over the thing it is about, and pushing a screen for it would put the day out
 * of sight at the moment you are trying to describe it.
 *
 * The field is multiline and grows, and there is no character limit. A diary
 * that stops you mid-sentence is not one.
 *
 * **The recorder lives here, under the fields.** It used to sit next to the pen
 * on the Day screen — two buttons side by side, so writing and talking looked
 * like two features you chose between before you had said anything. They are
 * one: the same entry, at the same instant, on the same day, with a title if it
 * wants one. Putting the microphone inside the sheet makes that literal —
 * record, then type under it, or type and then add a sentence aloud, and it is
 * still one note. It is also what item 15 in `docs/BACKLOG.md` needs to be
 * true: a transcript belongs *on the note*, beside what was typed, and that is
 * only a simple thing to build if the recording was never a row of its own.
 */
export function NoteSheet({
  target,
  defaultAt,
  onSave,
  onClose,
  onTranscribe,
  attached = null,
  attachedThumbUri = null,
  onOpenMedia,
}: NoteSheetProps) {
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The recording made or removed here, or null for "whatever the note has".
   *
   * Wrapped, because the value inside is itself nullable and the two nulls mean
   * different things: no draft at all, versus a draft that deliberately has no
   * recording — which is how deleting one is expressed without saving the note
   * to express it.
   */
  const [draftVoice, setDraftVoice] = useState<{ readonly value: NoteVoice | null } | null>(null);
  /**
   * The instant chosen here, or null for "whatever the caller suggested".
   *
   * Null rather than a copy of `defaultAt`, so that a sheet left open across a
   * change of day — or opened on a different note — starts from the new default
   * instead of the last one. The same reason the text field holds a nullable
   * draft rather than being seeded in an effect.
   */
  const [chosen, setChosen] = useState<number | null>(null);

  // Opened fresh from the note itself each time, so the fields start at what is
  // stored rather than at whatever was typed into them last.
  const existing = target?.kind === 'edit' ? target.note : null;
  const title = draftTitle ?? existing?.title ?? '';
  const text = draft ?? existing?.text ?? '';
  const at = chosen ?? defaultAt;
  const voice = draftVoice ? draftVoice.value : (existing?.voice ?? null);
  /**
   * The capture this note is about, carried rather than edited.
   *
   * There is no draft for it and no control to change it, because it is not a
   * field of the note so much as where the note came from: a new one gets the
   * link from the panel that opened this sheet, and an existing one keeps
   * whatever it already had. The picture is chosen by writing about a picture.
   */
  const mediaId = (target?.kind === 'edit' ? target.note.mediaId : (target?.mediaId ?? null)) ?? null;

  // Any one of the three is enough. A title alone says the day — "Moved house"
  // — and so does a paragraph nobody wanted to name, and so does half a minute
  // of talking with neither.
  const empty = title.trim().length === 0 && text.trim().length === 0 && voice === null;

  /**
   * Transcription state, local to the sheet and deliberately not persisted.
   *
   * `transcribed` only changes the button's label — it is not a record of
   * anything, because the transcript itself is the record and it is in the text
   * field where its owner can see it. Pressing the button again is allowed on
   * purpose: a second attempt at a misheard name appends a second attempt.
   */
  const [transcribing, setTranscribing] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [failure, setFailure] = useState<TranscriptionFailure | null>(null);
  /**
   * The service's own words about the last failure, shown under the sentence.
   *
   * Kept because a diary app has nowhere else to look: no server-side log, no
   * crash reporter, no telemetry. Session-only — it goes when the sheet closes
   * and is never written anywhere.
   */
  const [failureDetail, setFailureDetail] = useState<string | null>(null);
  /**
   * Shown for a moment after copying, then gone.
   *
   * A pasteboard write is completely invisible — nothing on screen changes and
   * iOS gives no confirmation — so without this the button is indistinguishable
   * from one that does nothing, and the honest response to that is to press it
   * again.
   */
  const [copied, setCopied] = useState(false);
  /**
   * Which opening of the sheet we are in, so a request in flight can be
   * abandoned when it closes.
   *
   * A ref rather than state because nothing renders it — this is the one thing
   * `react-hooks/refs` is actually for. Bumped by `close`, and compared when a
   * transcription answers.
   */
  const generation = useRef(0);

  const close = () => {
    // **Before anything else.** The keyboard is a separate window and does not
    // go with the sheet on its own; leaving it up over a closed sheet is how the
    // screen ends up with a keyboard and nothing to type into — reported from a
    // phone after backgrounding the app, with no way out but force-quitting it.
    Keyboard.dismiss();
    setDraftTitle(null);
    setDraft(null);
    setChosen(null);
    setDraftVoice(null);
    setTranscribed(false);
    setTranscribing(false);
    setFailure(null);
    setFailureDetail(null);
    // Anything still out there is answering a question this sheet no longer has.
    generation.current += 1;
    onClose();
  };

  const save = () => {
    onSave(at, title, text, voice, mediaId);
    close();
  };

  /**
   * Held in a callback so the recorder's `stop` reaches the sheet that is open
   * now rather than the render that started the recording.
   *
   * A recording made and then abandoned — this sheet closed without saving —
   * leaves a file no note refers to. That is deliberate rather than a leak:
   * `sweepNoteAudio` collects it on the next launch, which is the same bargain
   * the media store makes, and the alternative is deleting bytes somebody may
   * be about to keep.
   */
  const recorded = useCallback((made: NoteVoice) => setDraftVoice({ value: made }), []);
  const recorder = useVoiceNote(recorded);

  const runTranscription = () => {
    if (!onTranscribe || !voice || transcribing) return;
    // Which sheet asked. A request is in flight for seconds, and by the time it
    // answers this sheet may have been closed and reopened on another note —
    // where the transcript would arrive as text nobody spoke about that day.
    const askedIn = generation.current;

    setFailure(null);
    setFailureDetail(null);
    setTranscribing(true);
    void onTranscribe(voice)
      .then((result) => {
        if (generation.current !== askedIn) return;

        if (result.ok) {
          // Into the *draft*, not the store. The transcript arrives where the
          // words are, so it is read and edited before Save — which is what
          // makes Save the approval rather than a second confirmation.
          //
          // **Appended to the draft as it is now, not as it was when the button
          // was pressed.** A transcription takes seconds and typing during it is
          // the obvious thing to do, so reading `text` from this closure would
          // silently discard whatever was written while waiting — the same
          // stale-closure bug `useVoiceNote` keeps a ref to avoid, in the one
          // place where losing the value costs somebody's sentence rather than
          // a coordinate.
          setDraft((current) => appendTranscript(current ?? existing?.text ?? '', result.text));
          setTranscribed(true);
        } else {
          setFailure(result.reason);
          setFailureDetail(result.detail ?? null);
        }
      })
      .finally(() => {
        if (generation.current === askedIn) setTranscribing(false);
      });
  };

  /**
   * Take the date from one picker and the time from the other.
   *
   * Both pickers hand back a whole `Date`, so using either wholesale would
   * silently reset the half it was not asked about — pick a date and lose the
   * time you set a moment ago. Composed in local time, which is what both
   * pickers speak and what a diary means by "half past two".
   */
  const setDatePart = (picked: Date) => {
    const next = new Date(at);
    next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    setChosen(next.getTime());
  };

  const setTimePart = (picked: Date) => {
    const next = new Date(at);
    next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    setChosen(next.getTime());
  };

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close}>
      {/* **The sheet is bounded and it scrolls, and both halves of that are
          load-bearing.** This used to be a backdrop and an unstyled
          `KeyboardAvoidingView` side by side: the backdrop took `flex: 1` and
          the avoider took whatever its content needed *plus* a keyboard's
          height in bottom padding. Nothing capped that sum. Once the fields,
          the recorder and the Transcribe row were all showing, content +
          keyboard came to more than the screen, the backdrop was squeezed to
          nothing, and the sheet was laid out from y = 0 — its title over the
          status bar and its lower half spilling past a background that had
          stopped at the wrong height, with the Notes list showing through the
          gaps.

          It was reported as a glitch on coming back from the lock screen
          because that is where the arithmetic is briefly at its worst: iOS
          re-shows the keyboard and reports its frame before the window has
          settled, so the padding is momentarily too large and then corrected —
          which is the "it fixes itself after a few seconds". The correction was
          never the fix. A layout that cannot overflow does not need one.

          So: the avoider fills the screen, the backdrop shrinks inside it, and
          the sheet is capped at `maxHeight` and scrolls. `PlacePicker` has had
          this shape all along. */}
      <KeyboardAvoidingView behavior="padding" style={styles.avoider}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          {/* `keyboardShouldPersistTaps`, or Save and Transcribe would each take
              two presses while the keyboard is up: the first only dismisses it. */}
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {target ? (
              <>
                {/* **A close button that is always there.** The backdrop closes
                  the sheet too, but the keyboard covers it — and a keyboard
                  that cannot be dismissed on a sheet that cannot be reached is
                  an app you have to force-quit, which is what was reported.
                  This sits at the top of the sheet, above the fields, so it is
                  never the thing hidden behind what you are typing into. */}
                <View style={styles.header}>
                  <Text style={styles.title} accessibilityRole="header">
                    {target.kind === 'edit' ? 'Edit this note' : 'Write about this day'}
                  </Text>
                  <Pressable
                    onPress={close}
                    accessibilityRole="button"
                    accessibilityLabel="Close without saving"
                    hitSlop={12}
                    style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                  >
                    <Ionicons name="close" size={22} color={colors.textSecondary} />
                  </Pressable>
                </View>

                {/* The compact iOS style: two small fields that open a popover
                  when tapped, rather than a wheel that owns a third of the
                  sheet. They start at the sensible answer, so getting one is
                  free and changing it costs one tap. */}
                <View style={styles.when}>
                  <DateTimePicker
                    value={new Date(at)}
                    mode="date"
                    display="compact"
                    accessibilityLabel="Date this note is about"
                    themeVariant="dark"
                    onChange={(_event, picked) => picked && setDatePart(picked)}
                  />
                  <DateTimePicker
                    value={new Date(at)}
                    mode="time"
                    display="compact"
                    accessibilityLabel="Time this note is about"
                    themeVariant="dark"
                    onChange={(_event, picked) => picked && setTimePart(picked)}
                  />
                </View>

                {/* **What this note is about, above what it says.** A note
                    attached to a photograph is closer to a caption than to an
                    entry, and the picture is the context you want in front of
                    you while writing rather than a footnote under it.

                    Tapping it goes to the Media tab, focused on the capture,
                    with a way back. There is deliberately no full-size view in
                    here: a second place that draws a photograph is a second
                    place to keep in step with the gallery's gestures, its
                    orientation handling and its transport, which is exactly the
                    drift that retired `MediaScreen`. */}
                {mediaId ? (
                  <AttachedPicture
                    thumbUri={attachedThumbUri}
                    forgotten={attached === null}
                    onOpen={onOpenMedia ? () => onOpenMedia(mediaId) : undefined}
                  />
                ) : null}

                <TextInput
                  value={title}
                  onChangeText={setDraftTitle}
                  placeholder="Title"
                  placeholderTextColor={colors.textMuted}
                  style={styles.titleInput}
                  accessibilityLabel="Note title"
                  autoFocus
                  returnKeyType="next"
                />

                <View style={styles.bodyField}>
                  <TextInput
                    value={text}
                    onChangeText={(next) => {
                      setDraft(next);
                      // The tick means "this text is on the pasteboard", so it
                      // stops being true the moment the text changes. That is
                      // also why there is no timer undoing it: nothing else can
                      // make it false.
                      setCopied(false);
                    }}
                    placeholder="What happened, who you were with, what it was like…"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    accessibilityLabel="Note"
                    multiline
                    textAlignVertical="top"
                    /* No `returnKeyType: done` and no submit handler: return has to
                     put in a paragraph break. A diary entry is not a search box. */
                  />

                  {/* In the field's own top-right corner rather than in a row
                    beneath it: it acts on this text and nothing else, and the
                    corner is the one part of a multiline field that stays empty
                    however much is typed — text fills from the top left.

                    Absent while there is nothing to copy, rather than present
                    and disabled. A control that cannot act is a question the
                    reader has to answer before ignoring it. */}
                  {text.trim().length > 0 ? (
                    <Pressable
                      onPress={() => {
                        void copyText(text).then((ok) => setCopied(ok));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={copied ? 'Copied' : 'Copy this note'}
                      hitSlop={8}
                      style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
                    >
                      <Ionicons
                        name={copied ? 'checkmark' : 'copy-outline'}
                        size={16}
                        color={copied ? colors.success : colors.textMuted}
                      />
                    </Pressable>
                  ) : null}
                </View>

                {/* Under the writing, not beside it. The order is the argument:
                  a note is words, and this is another way to put words in it —
                  a second entry point on the same sheet rather than a second
                  kind of thing to make.

                  Within the row, the recorder sits on the **right** and playing
                  back on the left. The right is where the thumb is, and it is
                  the button pressed at the moment there is something to say —
                  the player is only ever reached afterwards, deliberately. */}
                <View style={styles.voice}>
                  <View style={styles.voiceState}>
                    {recorder.recording ? (
                      <>
                        <Text style={styles.recordingClock}>{formatTimecode(recorder.elapsedMs)}</Text>
                        {/* The ceiling, said while there is still time to act on
                          it. The recorder stops itself there and tells you, but
                          being told afterwards is a worse place to find out
                          than being told before you begin — and this is the
                          line that lets somebody split a long talk on purpose
                          rather than have it split for them. */}
                        <Text style={styles.hint}>Stops at {formatDuration(MAX_VOICE_MS)}</Text>
                      </>
                    ) : recorder.saving ? (
                      <Text style={styles.hint}>Saving…</Text>
                    ) : voice ? (
                      <VoiceNotePlayer
                        voice={voice}
                        // **Absent while locked, rather than present and
                        // asking.** The lock is the deliberate act; leaving a
                        // one-tap delete behind it would make the lock
                        // decorative. Absent rather than disabled, per the copy
                        // button's rule — and honest here because the padlock
                        // beside it says exactly how to get this back.
                        onForget={
                          voice.locked
                            ? undefined
                            : () =>
                                confirmDestructive({
                                  title: 'Delete this recording?',
                                  message:
                                    'The audio goes when the note is saved. Any text already transcribed from it stays.',
                                  confirmLabel: 'Delete',
                                  onConfirm: () => setDraftVoice({ value: null }),
                                })
                        }
                      />
                    ) : (
                      <Text style={styles.hint}>Or say it instead</Text>
                    )}
                  </View>

                  {/* Recording over one that already exists destroys it: the new
                    file replaces the old and the old is deleted on save. That
                    is a delete, so it asks — like every other delete. Recording
                    onto a note with nothing on it asks nothing, because there
                    is nothing to lose. */}
                  {/* **The lock, between the recording and the button that
                    would replace it.** Recording over one already here asks
                    first, and has since the feature shipped — but a dialog is
                    only ever as good as the attention paid to it, and the audio
                    is the one thing on a note that nothing can reconstruct. The
                    words survive a bad transcription; a voice survives nothing.
                    This is the stronger answer for the recording somebody is
                    not willing to lose.

                    It closes both doors: the microphone will not start and the
                    delete button is not offered. Unlocking asks nothing,
                    because the lock is what makes the destruction deliberate,
                    and a confirmation on *undoing* a guard is a dialog in front
                    of the thing the control is for. Two acts to destroy, one to
                    allow — the shape the swipe-to-delete on a note row already
                    uses. */}
                  {voice && !recorder.recording ? (
                    <Pressable
                      onPress={() => setDraftVoice({ value: { ...voice, locked: !voice.locked } })}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: voice.locked }}
                      accessibilityLabel={
                        voice.locked ? 'Unlock this recording so it can be replaced' : 'Keep this recording'
                      }
                      hitSlop={8}
                      style={({ pressed }) => [styles.lock, voice.locked && styles.locked, pressed && styles.pressed]}
                    >
                      {/* Closed and open are different *shapes*, as the record
                        button's microphone and square are: the state has to
                        survive a glance, a greyscale screen and a colourblind
                        reader. Colour moves with it and nothing depends on it. */}
                      <Ionicons
                        name={voice.locked ? 'lock-closed' : 'lock-open-outline'}
                        size={18}
                        color={voice.locked ? colors.onAccent : colors.textMuted}
                      />
                    </Pressable>
                  ) : null}

                  <RecordButton
                    recording={recorder.recording}
                    disabledReason={
                      voice?.locked ? 'This recording is locked. Unlock it to record over it.' : undefined
                    }
                    onStart={
                      voice
                        ? () =>
                            confirmDestructive({
                              title: 'Record over this one?',
                              message:
                                'The recording already on this note is replaced, and the old audio cannot be recovered. Any text transcribed from it stays.',
                              confirmLabel: 'Record again',
                              onConfirm: recorder.start,
                            })
                        : recorder.start
                    }
                    onStop={recorder.stop}
                  />
                </View>

                {/* Under the recording, because it is a thing you do *to* the
                  recording — and only when there is one to do it to and a key
                  to do it with. Never automatic: this is the press that sends
                  your voice to a third party, so it is always a press. */}
                {voice && onTranscribe ? (
                  <View style={styles.transcribe}>
                    {/* A wand, because what it does is not a thing the phone
                      obviously does — the word stays beside it, since an icon
                      alone would be a control findable only by somebody who
                      already knew it was there, which this app has been bitten
                      by once already. */}
                    <Pressable
                      onPress={runTranscription}
                      disabled={transcribing}
                      accessibilityRole="button"
                      accessibilityState={{ busy: transcribing }}
                      accessibilityLabel={transcribed ? 'Transcribe the recording again' : 'Transcribe the recording'}
                      style={({ pressed }) => [
                        styles.transcribeButton,
                        transcribing && styles.transcribeBusy,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Ionicons name="color-wand-outline" size={18} color={colors.textPrimary} />
                      <Text style={styles.transcribeText}>
                        {transcribing ? 'Transcribing…' : transcribed ? 'Transcribe again' : 'Transcribe'}
                      </Text>
                    </Pressable>

                    {/* The failure, or the standing warning. One or the other:
                      once something has gone wrong, saying what went wrong
                      matters more than repeating what the button does. */}
                    {failure ? (
                      <>
                        <Text style={styles.transcribeError}>{TRANSCRIPTION_MESSAGES[failure]}</Text>
                        {/* Exactly what the service said, untranslated. There is no
                          log to go and read afterwards, so this is the only place
                          the real cause can appear. */}
                        {failureDetail ? <Text style={styles.transcribeDetail}>{failureDetail}</Text> : null}
                      </>
                    ) : (
                      <Text style={styles.hint}>
                        Sends this recording to ElevenLabs. Text is added below what you wrote.
                      </Text>
                    )}
                  </View>
                ) : null}

                {/* Held shut while a recording is being written, which is a
                  fraction of a second and the one moment saving would lose it:
                  the note has no `voice` until the file lands, so a Save landing
                  inside that window would store the note without it. */}
                <Pressable
                  onPress={save}
                  disabled={empty || recorder.saving}
                  accessibilityRole="button"
                  accessibilityLabel="Save this note"
                  style={({ pressed }) => [
                    styles.save,
                    (empty || recorder.saving) && styles.saveDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * The capture a note is about, or the fact that it has gone.
 *
 * **A forgotten picture is said out loud rather than drawn as nothing.** The
 * two have separate lives on purpose — deleting the photograph leaves the note,
 * deleting the note leaves the photograph — so a note whose picture is gone is
 * a normal state and not a broken one. Drawing an empty square would read as
 * the app having mislaid something; a sentence says what actually happened and
 * leaves the writing alone, which is the half that could not be replaced.
 */
function AttachedPicture({
  thumbUri,
  forgotten,
  onOpen,
}: {
  readonly thumbUri: string | null;
  readonly forgotten: boolean;
  readonly onOpen?: () => void;
}) {
  if (forgotten) {
    return (
      <View style={styles.gonePicture}>
        <Ionicons name="image-outline" size={16} color={colors.textMuted} />
        <Text style={styles.hint}>The photo this note was about has been deleted. What you wrote is still here.</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      accessibilityRole="button"
      accessibilityLabel="Open the photo this note is about"
      style={({ pressed }) => [styles.picture, pressed && styles.pressed]}
    >
      {/* `cover`, like the filmstrip's squares: a fixed frame the eye can scan
          beats a box that changes shape with whatever is in it. */}
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.pictureImage} resizeMode="cover" />
      ) : (
        <View style={styles.pictureImage} />
      )}
      <View style={styles.pictureWords}>
        <Text style={styles.pictureLabel}>About this photo</Text>
        <Text style={styles.hint}>Tap to open it</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avoider: { flex: 1 },
  // Shrinks to nothing before the sheet is allowed to grow past its cap, which
  // is what keeps the sheet's top edge on the screen.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    // Of whatever the keyboard has left, not of the screen: the cap has to move
    // with the space there actually is, or it is no cap at all when it matters.
    maxHeight: '90%',
  },
  // The padding lives on the scrolling content rather than on the sheet, so the
  // bottom inset is below the last row instead of below the scroller.
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.textPrimary, flex: 1 },
  close: { padding: spacing.xs },
  when: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  titleInput: {
    ...typography.title,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  picture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  pictureImage: { width: 44, height: 60, borderRadius: radius.sm, backgroundColor: colors.surface },
  pictureWords: { flex: 1, gap: 2 },
  pictureLabel: { ...typography.body, color: colors.textPrimary },
  gonePicture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  bodyField: { position: 'relative' },
  copy: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 120,
  },
  voice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  transcribe: { gap: spacing.xs, marginTop: spacing.sm },
  transcribeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  transcribeBusy: { opacity: 0.5 },
  transcribeText: { ...typography.body, color: colors.textPrimary },
  transcribeError: { ...typography.caption, color: colors.danger },
  transcribeDetail: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  voiceState: { flex: 1 },
  lock: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  locked: { backgroundColor: colors.stay },
  recordingClock: { ...typography.clock, color: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted },
  save: {
    backgroundColor: colors.move,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  forget: { alignItems: 'center', paddingVertical: spacing.sm },
  forgetText: { ...typography.caption, color: colors.danger },
  pressed: { opacity: 0.6 },
});
