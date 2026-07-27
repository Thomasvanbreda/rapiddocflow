# Box Reordering — Design

**Date:** 2026-07-27
**Feature:** Move boxes up/down in the SmartAnswerPDF template builder to change the order in which they appear (builder, fill screen, and generated output).

## Goal

Template builders currently render boxes in `tpl.boxes` array order with no way to change that order after creation. Add one-click reordering.

## UI

> **Revised 2026-07-27:** first shipped as ▲/▼ arrow buttons; replaced with drag-and-drop
> the same day because stepping a box one position at a time was too slow. Arrows removed.

- Each box header gains a ⋮⋮ drag handle as its leftmost element, before the box number.
- Applies to all four box types, each of which builds its own header markup:
  - Sentence-builder box (`buildBoxEl`)
  - Multi Text Table box (`buildMultiTableBoxEl`)
  - Multi Check Box (`buildMultiCheckBoxEl`)
  - Text Auto Fill box (`buildAutoFillBoxEl`)
- Dragging a box onto another drops it at that box's position; the dragged card dims
  (`.dragging`) and the hovered target shows a dashed outline (`.drag-over`).
- The handle calls `event.stopPropagation()` on click and mousedown so grabbing it never
  toggles the box open/closed.

## Behavior

Mirrors the existing sub-box segment drag pattern (`dragSegStart`/`dragSegOver`/`dragSegDrop`).

- `attachBoxDrag(el, boxId)` wires dragstart/dragend/dragover/dragleave/drop listeners on each
  `.box-card`; all four builders call it after creating their element.
- Cards are **not** `draggable` by default — `mousedown` on the ⋮⋮ handle sets `draggable=true`,
  and `dragend` resets it to `false`. This is what confines dragging to the handle, so text
  selection and inputs inside the card keep working normally.
- `dragBoxStart` ignores events originating inside a `.segment`, so the existing sub-box
  segment drag still works and never reorders boxes.
- `dragBoxDrop` splices the dragged box out of `tpl.boxes` and back in at the target index,
  then calls `saveTemplate(tpl)` (existing Supabase persistence path) and `renderBoxes()`,
  which renumbers the `box-num` badges automatically.

## Order propagation (no extra code)

The builder list, the fill screen (`fill-boxes` renderer), and PDF generation (`generatePDF`) all iterate `tpl.boxes` in array order, so a swap in the array reorders everything consistently.

## Safety

Fill answers are keyed by `box.id` (`fillAnswers[box.id]`), never by array index, so reordering cannot scramble previously entered answers.

## Out of scope

- Touch-device reordering. HTML5 drag-and-drop does not fire on most mobile browsers, so
  reordering is desktop-only. Revisit with pointer events if it's needed on tablets.
- Reordering on the fill screen itself (order is defined in the builder).

## Testing

- Drag a box down and up; confirm it lands at the target's position and badges renumber.
- Order persists after page reload (Supabase save fired).
- Dragging a sub-box segment inside a box reorders segments and never reorders boxes.
- Clicking or grabbing the handle does not collapse/expand the box.
- After a drag, the card's `draggable` resets to false and no `.drag-over` outlines linger.
- Fill screen shows boxes in the new order; generated PDF unaffected except for box-driven ordering.
