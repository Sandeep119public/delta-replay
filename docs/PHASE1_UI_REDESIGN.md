# UI Redesign: Phases 1-3

The first three UI phases establish the new replay workstation hierarchy without changing replay or trading behavior.

## Phase 1: Chart-First Shell

- The chart owns the full workspace width.
- The trading panel becomes a floating contextual dock instead of a permanent grid column.
- The status banner keeps its DOM contract but no longer consumes visible workspace height.
- The header is tightened so the chart receives more visual attention.
- Mobile uses the existing trading drawer mechanism as a bottom sheet.

## Phase 2: Unified Replay Rail

- Timeline and transport occupy one shared bottom rail.
- Current replay time is visually prioritized.
- Scrubber and sparkline receive clearer hierarchy.
- Play/Pause is the primary transport action.
- Secondary controls become quieter and more compact.
- Mobile gets a compact single-rail treatment.

## Phase 3: Contextual Trade Dock

- The floating trading dock is tightened into a focused order-entry workstation.
- Account snapshot and Trade/Account navigation are easier to scan.
- Order configuration gets a clearer hierarchy before the primary trade actions.
- Position and risk management sits behind a deliberate disclosure.
- Pending orders and recent fills become quieter supporting information.
- Mobile preserves the bottom-sheet model with larger primary trade actions.

## Safety

Existing replay/trading IDs, markup hooks, and behavior remain unchanged. Later phases cover the position/activity inspector, navigation cleanup, command palette, legacy CSS removal, and the final responsive visual regression pass.
