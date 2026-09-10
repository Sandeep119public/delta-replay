# Phase 1 UI Redesign: Chart-First Shell

Phase 1 changes the spatial hierarchy without changing replay or trading behavior.

## What changed

- The chart now owns the full workspace width.
- The trading panel becomes a floating contextual dock instead of a permanent grid column.
- The status banner keeps its DOM contract but no longer consumes visible workspace height.
- The header is tightened so the chart receives more vertical and horizontal attention.
- Timeline and transport are visually unified as a single replay rail.
- Mobile uses the existing trading drawer mechanism as a bottom sheet rather than squeezing the desktop dock.
- Existing IDs and presentation ports remain unchanged.

## Explicitly deferred

- Full Trade Dock redesign
- Position/activity inspector redesign
- Navigation/page routing cleanup
- Command palette
- Legacy CSS deletion

Those belong to later phases of the redesign.
