import { releaseAudioFocus, silenceAudio, takeAudioFocus } from '../audioFocus';

/**
 * One thing plays at a time.
 *
 * The module holds a single variable, so the tests that matter are about *when*
 * it changes hands — and in particular about the two orderings that a naive
 * version gets wrong: a player releasing after it has already lost the focus,
 * and a player claiming the focus it already holds.
 */

// The focus is module state, so each test starts from silence.
beforeEach(() => silenceAudio());

it('stops whatever was playing when something else starts', () => {
  const first = jest.fn();
  const second = jest.fn();

  takeAudioFocus(first);
  expect(first).not.toHaveBeenCalled();

  takeAudioFocus(second);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
});

it('does not interrupt itself when the same player plays again', () => {
  const player = jest.fn();

  takeAudioFocus(player);
  // A rewind-and-play, or a resume: the same holder asking again.
  takeAudioFocus(player);

  expect(player).not.toHaveBeenCalled();
});

/**
 * The race this is shaped around: silencing the previous holder runs *its*
 * cleanup, which calls `releaseAudioFocus` — and that arrives after the new
 * holder is already in place. Releasing by identity is what stops it clearing
 * somebody else's claim.
 */
it('lets a player release late without silencing whoever replaced it', () => {
  const second = jest.fn();
  const first: jest.Mock<void, []> = jest.fn(() => releaseAudioFocus(first));

  takeAudioFocus(first);
  takeAudioFocus(second);
  expect(first).toHaveBeenCalledTimes(1);

  // The focus must still belong to the second player, so a third claim
  // interrupts it rather than finding nothing there.
  const third = jest.fn();
  takeAudioFocus(third);
  expect(second).toHaveBeenCalledTimes(1);
});

it('ignores a release from a player that no longer holds it', () => {
  const first = jest.fn();
  const second = jest.fn();

  takeAudioFocus(first);
  takeAudioFocus(second);
  releaseAudioFocus(first);

  const third = jest.fn();
  takeAudioFocus(third);
  expect(second).toHaveBeenCalledTimes(1);
});

it('silences from outside, and leaves nothing to interrupt afterwards', () => {
  const player = jest.fn();

  takeAudioFocus(player);
  silenceAudio();
  expect(player).toHaveBeenCalledTimes(1);

  // Nothing holds it now, so silencing again reaches nobody — a recording
  // started twice must not call a stopped player's pause a second time.
  silenceAudio();
  expect(player).toHaveBeenCalledTimes(1);
});
