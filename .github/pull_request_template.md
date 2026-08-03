## What changed

<!-- One or two sentences. What does this do, and why? -->

## Checklist

- [ ] `npm run verify` passes (typecheck, lint, format, tests)
- [ ] Engine changes (`src/core`) come with tests, including an invariant in
      `properties.test.ts` where one applies
- [ ] No credentials, Team IDs, bundle identifiers or other account-specific
      values added to committed files
- [ ] No real coordinates in fixtures — test data is synthetic
- [ ] `src/core` still imports nothing from React, React Native, Expo or
      `src/services`

## Location behaviour

<!-- Delete if this PR does not touch the segmentation engine or the location
     service.

     If it does, confirm the change holds up under:
     - the app being killed by iOS mid-walk and relaunched in the background
     - a fix arriving with 500 m accuracy from a cell tower
     - a gap of two hours with no fixes at all (indoors, aeroplane mode)
     - fixes arriving out of order, or with a timestamp older than the last one
     - crossing local midnight mid-activity -->

## Battery

<!-- Does this change how often the app wakes, or which accuracy class it asks
     for? If so, say what the new duty cycle is. -->
