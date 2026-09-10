# UI Redesign: Phases 1-5

The first five UI phases establish a chart-first replay workstation with responsive trading interactions, without changing replay or trading behavior.

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

## Safety

Existing replay/trading IDs, markup hooks, accessibility state, and behavior remain unchanged. Later phases cover navigation cleanup, command palette, legacy CSS removal, and the final responsive visual regression pass.
