/**
 * The phone has one speaker, so the app plays one thing.
 *
 * Nothing here is asynchronous, nothing is stored and nothing is native — it is
 * a single variable holding "who is making a noise" and a way to take that
 * place from whoever had it. It lives beside the other services because it is
 * the same kind of thing they are: the app's one handle on a device resource,
 * in a single file so there is one place to look for what can make sound.
 *
 * **Why a registry at all, rather than each player minding itself.** The things
 * that play are deliberately unaware of each other — a recording on a note row,
 * the same recording in the sheet above it, a clip in the gallery — and they
 * are mounted in different tabs that all stay alive at once, because the shell
 * hides inactive tabs rather than unmounting them. So two of them playing
 * together is the *default* behaviour, not an edge case: press play on a note,
 * switch to Media, swipe to a clip, and both are talking. There is no common
 * ancestor to put this in that is not the whole app.
 *
 * **Only what is audible takes the focus**, which is why the caller passes its
 * own judgement rather than this file inspecting a player. A muted clip is a
 * moving picture: it starts on its own when you swipe to it, and if that
 * counted as playing, swiping through the gallery would silently stop the note
 * you were listening to. Unmuting is what makes it audio, and that is a press.
 *
 * The holder is identified by the function itself, so releasing is exact: a
 * player that has already lost the focus cannot clear somebody else's by
 * stopping late, which is otherwise a real race — pausing the previous holder
 * runs its own cleanup, and that cleanup arrives after the new holder is in
 * place.
 */

/** Stops whatever is playing. Called at most once per claim. */
type Silence = () => void;

let holder: Silence | null = null;

/**
 * Start making a noise, and stop anything else that was.
 *
 * `silence` is called if something else claims the focus later, so it must
 * pause *this* player and nothing more. Claiming twice with the same function
 * is a no-op rather than a self-interruption — a player that is already the
 * holder and plays again (a rewind, a resume) must not pause itself.
 */
export function takeAudioFocus(silence: Silence): void {
  if (holder === silence) return;

  const previous = holder;
  // Set first, so a previous holder that releases synchronously while being
  // silenced cannot clear the claim being made right now.
  holder = silence;
  previous?.();
}

/**
 * Give it up, if it was still held. Called when a clip ends, when a player is
 * paused by hand, and on unmount — a component that goes away while holding the
 * focus would otherwise leave a dead function as the thing to interrupt.
 */
export function releaseAudioFocus(silence: Silence): void {
  if (holder === silence) holder = null;
}

/**
 * Silence whatever is playing, from outside any of the players.
 *
 * Recording is the caller that matters: a note being spoken into while the last
 * one plays back records the playback, and the microphone is the one case where
 * the two cannot simply coexist at different volumes.
 */
export function silenceAudio(): void {
  const previous = holder;
  holder = null;
  previous?.();
}
