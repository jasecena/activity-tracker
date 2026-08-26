# Contributing

## Before you start

Read [`AGENTS.md`](AGENTS.md). It is short, and it is the list of things that
were decided against a real constraint rather than by preference. If a change
contradicts one of them, that is fine — but change the reasoning in
the architecture notes with it, rather than leaving the
document describing an app that no longer exists.

## The loop

```bash
npm install
npm run verify      # typecheck, lint, format, 1,066 tests — well under a minute
```

`npm run verify` is the gate. It runs entirely on Linux and needs no simulator,
which is the whole point of the `src/core` boundary.

```bash
npm test -- --watch                    # everything
npx jest --selectProjects core         # the engine alone, ~1s
npm run lint:fix && npm run format     # fix what is fixable
```

A pre-commit hook runs lint-staged, the core suite and a gitleaks scan of staged
changes. It is deliberately fast — anything slower gets bypassed with
`--no-verify` and then protects nothing.

## Where code goes

**`src/core` is pure TypeScript.** No React, React Native, Expo or
`src/services` imports; ESLint makes it an error. It reads no clock, no timezone
and no entropy — "what time is it" and "what is the UTC offset" are parameters,
and ids are derived from data.

If you can express it as a function of data, it belongs in `core`, where it is
cheap to test and gated at 90% branches / 100% functions. `services` should stay
thin enough to be obviously correct by reading it.

**`src/services` owns the platform.** `location.ts`, `vault.ts`, `storage.ts`,
`battery.ts`, `mediaStore.ts`, `optics.ts` and `clock.ts` are the only files
importing a native module or calling `Date.now()`. `components/MapCanvas.tsx` is
the one exception outside the folder, and it may import `expo-maps` and nothing
else may.

**`modules/` holds local native modules.** `camera-optics` is one Swift file
reading what AVFoundation knows and Expo does not pass on. The pattern is
established, so binding something else native is a file in `modules/` rather than
a change of project shape — but the bar is a caller that exists, not one that
might.

## Tests

Two Jest projects:

- **`core`** — plain Node, no React Native transform, no mocks. A few hundred
  milliseconds. This is the suite that guards correctness.
- **`app`** — component tests through `jest-expo/ios`.

Engine changes need tests, including an invariant in
[`properties.test.ts`](src/core/segments/__tests__/properties.test.ts) where one
applies. The properties there are not decoration: "re-deriving is byte-identical"
is what the entire persistence design rests on, and if it ever fails, every
recovery path in `useTimeline` is unsound.

**Fixtures are synthetic and sit at the equator.** A fixture built from a real
track is a permanent public record of where its author was — the same class of
mistake as a leaked key and much harder to rotate. There is a gitleaks rule that
fails the build on anything shaped like a real latitude.

**React 19:** `act`, `render`, `renderHook` and `rerender` are all asynchronous.
Await every one. Not awaiting leaves the act scope open and the _next_ render in
the file silently never runs its effects.

## Things that will get a change sent back

- A **fourth** kind of network request. The app makes exactly three — map
  imagery, transcription, and a backup to a bucket you own — and each one is a
  press. That the list fits in a sentence is load-bearing for everything in
  [`SECURITY.md`](SECURITY.md), so widening it means rewriting that section in
  the same change rather than afterwards.
- Storing the derived timeline instead of re-deriving it.
- A generated segment id.
- Interpolating across a gap.
- Using `Fix.reportedSpeedMps` for anything displayed or decided.
- Real coordinates in a fixture.
- An action referenced by a mutable tag rather than a commit SHA.

## Pull requests

Fill in the template. The location-behaviour section matters: the failure modes
listed there — an app killed mid-walk, a 500 m cell-tower fix, two hours of
silence, fixes out of order, midnight crossed mid-journey — are the ones that
only show up on real hardware and only after you have started trusting the app.
