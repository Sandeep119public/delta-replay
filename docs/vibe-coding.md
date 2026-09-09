# Vibe Coding Workflow

## Fast loop

`edit → npm run vibe:fast → inspect → repeat`

Before pushing: `npm run vibe:check`

## Smallest useful gate

- UI contract or markup: `npm run test:ui-contracts`
- Cross-layer imports: `npm run test:architecture:graph`
- Frontend iteration: `npm run vibe:fast`
- Full frontend confidence: `npm run vibe:check`

## Context-saving rules

1. Change one concern at a time.
2. Inspect tests instead of inferring contracts from names.
3. Follow data and events, not filenames alone.
4. If composition grows, extract ownership instead of adding another callback.
5. Prefer explicit ports at UI/domain boundaries.
