# UI Redesign: Phases 1-8

The redesign establishes a chart-first replay workstation with responsive trading interactions, focused navigation, and a final responsive safety layer, without changing replay or trading behavior.

## Phase 1: Chart-First Shell
- Chart owns the full workspace.
- Trading becomes a floating contextual dock.
- Header/status hierarchy is tightened.
- Mobile uses the existing trading drawer as a bottom sheet.

## Phase 2: Unified Replay Rail
- Timeline and transport occupy one shared bottom rail.
- Replay time, scrubber, and sparkline receive clearer hierarchy.
- Play/Pause is the primary transport action.
- Secondary controls become quieter and more compact.

## Phase 3: Contextual Trade Dock
- Order entry is prioritized inside the floating workstation.
- Account snapshot and Trade/Account navigation are easier to scan.
- Risk management is deliberately disclosed.
- Mobile keeps the bottom-sheet model with larger primary actions.

## Phase 4: Position + Activity Inspector
- Exposure is organized around size, entry, mark, and P&L.
- SL/TP state and flatten controls are explicit.
- Pending orders and fills become supporting activity surfaces.
- Narrow layouts retain usable exposure and action targets.

## Phase 5: Mobile-First Sheets
- Trading sheets use viewport-safe bottom spacing.
- Primary controls use touch-sized targets.
- Order and risk fields collapse to single-column layouts on small screens.
- Existing drawer state, accessibility, and interaction hooks remain unchanged.
- Very narrow screens stack account summary values cleanly.

## Phase 6: Focused Navigation + Command Surface
- Persistent navigation chrome is removed from the active replay shell.
- An on-demand command menu provides replay, playback, and trading shortcuts.
- Existing action handlers remain the execution path.

## Phase 7: Final UI System Cleanup
- The unused legacy Navigation module is removed from the active code path.
- A final cleanup layer neutralizes legacy navigation and dormant page containers if stale markup appears.
- Shared focus, sizing, and narrow-layout safety rules are centralized at the end of the cascade.
- The stylesheet entrypoint makes the final cleanup layer explicit.

## Phase 8: Responsive Final Audit
- Desktop preserves the chart-first canvas and bounded trade dock.
- Tablet receives explicit spacing and touch-target guardrails.
- Mobile keeps sheets and command surfaces within the viewport without width overflow.
- Core replay, trading, and drawer IDs remain regression-protected.
- Raw `100vw` width usage is guarded against in the final layer.

## Verification note

Source-level regression contracts cover the redesigned UI layers and responsive breakpoints. A browser-based visual pass is not available in this environment, so pixel-level rendering has not been manually verified here.

## Validation follow-up

The final UI test contracts were updated after CI identified stale assertions tied to the pre-Phase-7 navigation file and earlier replay-rail sizing assumptions.
