# UI Redesign: Phases 1-4

The first four UI phases establish the replay workstation hierarchy without changing replay or trading behavior.

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

## Phase 4: Position + Activity Inspector

- Open exposure is presented as a compact live inspector rather than buried supporting content.
- Size, entry, mark, and P&L form a consistent exposure grid.
- Stop loss and take profit state are visually grouped as active risk controls.
- Close-position and flatten information remain explicit.
- Pending orders and recent fills use a quieter activity treatment that supports, rather than competes with, order entry.
- Narrow screens collapse the exposure grid while retaining usable action targets.

## Safety

Existing replay/trading IDs, markup hooks, and behavior remain unchanged. Later phases cover navigation cleanup, command palette work, legacy CSS removal, and the final responsive visual regression pass.
