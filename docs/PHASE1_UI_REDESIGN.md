# UI Redesign: Phases 1-3

Phase 1 changes the spatial hierarchy without changing replay or trading behavior.

## Phase 1: Chart-First Shell

- The chart now owns the full workspace width.
- The trading panel becomes a floating contextual dock instead of a permanent grid column.
- The status banner keeps its DOM contract but no longer consumes visible workspace height.
- The header is tightened so the chart receives more vertical and horizontal attention.
- Timeline and transport are visually unified as a single replay rail.
- Mobile uses the existing trading drawer mechanism as a bottom sheet rather than squeezing the desktop dock.
- Existing IDs and presentation ports remain unchanged.

## Phase 2: Unified Replay Rail

- Timeline and transport occupy one shared bottom rail.
- Current replay time is visually prioritized.
- Scrubber and sparkline receive clearer hierarchy.
- Play/Pause is the primary transport action.
- Secondary actions, speed, follow, and status are visually quieter.
- Mobile gets a compact single-rail treatment with the same interaction hooks.

## Phase 3: Contextual Trade Dock

- The floating trading dock is tightened into a focused order-entry workstation.
- Account snapshot and Trade/Account navigation are visually quieter and easier to scan.
- Quantity/order controls get a clearer hierarchy before Buy/Long and Sell/Short.
- Position and risk management is contained behind a deliberate disclosure.
- Pending orders and recent fills become quieter supporting information.
- Mobile preserves the bottom-sheet model with larger primary trade actions.
- Trading IDs and behavior are unchanged.

## Deferred

- Position/activity inspector redesign
- Navigation/page routing cleanup
- Command palette
- Legacy CSS deletion
- Final responsive visual regression pass
