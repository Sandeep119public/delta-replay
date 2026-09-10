# UI Redesign: Phases 1-5

The first five UI phases establish a chart-first replay workstation with responsive trading interactions, without changing replay or trading behavior.

## Phase 1: Chart-First Shell
- The chart owns the full workspace width.
- The trading panel becomes a floating contextual dock.
- The status banner keeps its DOM contract without consuming visible workspace height.
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
- Order configuration gets a clearer hierarchy before primary trade actions.
- Position and risk management sits behind deliberate disclosure.
- Pending orders and recent fills become quieter supporting information.
- Mobile preserves the bottom-sheet model with larger primary actions.

## Phase 4: Position + Activity Inspector
- Exposure is organized around size, entry, mark, and P&L.
- SL/TP state and flatten controls are explicit.
- Pending orders and fills become supporting activity surfaces.
- Narrow layouts retain usable exposure and action targets.

## Phase 5: Mobile-First Sheets
- Trading sheets use viewport-safe bottom spacing.
- Primary controls meet touch-sized minimums.
- Order and risk fields collapse to single-column layouts on small screens.
- Existing drawer state, accessibility, and interaction hooks remain unchanged.
- Mobile account summaries stack cleanly at very narrow widths.

## Safety

Existing replay/trading IDs, markup hooks, and behavior remain unchanged. Later phases cover navigation cleanup, command palette, legacy CSS removal, and the final responsive visual regression pass.
