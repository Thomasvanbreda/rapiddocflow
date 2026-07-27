# Box Reordering — Design

**Date:** 2026-07-27
**Feature:** Move boxes up/down in the SmartAnswerPDF template builder to change the order in which they appear (builder, fill screen, and generated output).

## Goal

Template builders currently render boxes in `tpl.boxes` array order with no way to change that order after creation. Add one-click reordering.

## UI

- Each box header gains two arrow buttons, ▲ (move up) and ▼ (move down), placed immediately left of the existing × delete button.
- Applies to all four box types, each of which builds its own header markup:
  - Sentence-builder box (`buildBoxEl`)
  - Multi Text Table box (`buildMultiTableBoxEl`)
  - Multi Check Box (`buildMultiCheckBoxEl`)
  - Text Auto Fill box (`buildAutoFillBoxEl`)
- The first box's ▲ and the last box's ▼ are visually grayed (reduced opacity, `cursor:default`) and do nothing when clicked.
- Arrow clicks call `event.stopPropagation()` so they never toggle the box open/closed (same pattern as the delete button).

## Behavior

One shared function:

```js
function moveBox(boxId, dir){        // dir = -1 (up) or +1 (down)
  const tpl = getTemplate();
  const i = tpl.boxes.findIndex(b => b.id === boxId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tpl.boxes.length) return;
  [tpl.boxes[i], tpl.boxes[j]] = [tpl.boxes[j], tpl.boxes[i]];
  saveTemplate(tpl);
  renderBoxes();
}
```

- `saveTemplate` is the existing persistence path (Supabase upsert of `boxes` JSON), so order survives reload.
- `renderBoxes()` rebuilds the list, which renumbers the `box-num` badges automatically.

## Order propagation (no extra code)

The builder list, the fill screen (`fill-boxes` renderer), and PDF generation (`generatePDF`) all iterate `tpl.boxes` in array order, so a swap in the array reorders everything consistently.

## Safety

Fill answers are keyed by `box.id` (`fillAnswers[box.id]`), never by array index, so reordering cannot scramble previously entered answers.

## Out of scope

- Drag-and-drop of boxes (arrows only, per user choice).
- Reordering on the fill screen itself (order is defined in the builder).

## Testing

- In the builder: move a middle box up and down; confirm numbering updates and order persists after page reload.
- Boundaries: top box ▲ and bottom box ▼ do nothing; single-box template shows both arrows grayed.
- Arrow clicks do not collapse/expand the box.
- Fill screen shows boxes in the new order; generated PDF unaffected except for box-driven ordering.
