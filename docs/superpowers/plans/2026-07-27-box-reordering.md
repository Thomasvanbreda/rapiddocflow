# Box Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ▲/▼ buttons to every box header in the SmartAnswerPDF template builder so users can reorder boxes, with the new order persisted and reflected in the fill screen and generated PDFs.

**Architecture:** All state lives in `tpl.boxes` (array order = display order everywhere). One new `moveBox(boxId, dir)` function swaps adjacent array entries, persists via the existing `saveTemplate`, and re-renders via the existing `renderBoxes`. A small `moveBtnsHTML(boxId, bi)` helper generates the arrow markup; each of the four box-header builders embeds it.

**Tech Stack:** Vanilla JS inline in `index.html` (no build step, no test framework). Supabase persistence already handled by `saveTemplate`. Deployed by pushing to GitHub `main` (Netlify auto-deploy).

## Global Constraints

- Single-file app: all changes go in `index.html`. No new files, no libraries.
- This project has no automated test framework; verification is manual in the browser (spec §Testing). Do not introduce a test harness.
- Match existing code style: compact inline JS, template literals, `event.stopPropagation()` pattern used by `.box-del`.
- Arrow glyphs are ▲ and ▼ per the approved spec.
- Commit messages: plain, no Co-Authored-By/Anthropic lines (user preference).

---

### Task 1: moveBox core + arrow buttons in all four box headers

**Files:**
- Modify: `index.html` (CSS block near line 112, JS near `renderBoxes()` at line 1042, and the four header template literals at approx. lines 1054–1058, 1326–1333, 1440–1447, 1608–1615)

**Interfaces:**
- Consumes: existing `getTemplate()`, `saveTemplate(tpl)`, `renderBoxes()`, `tpl.boxes` (each box has unique `id`).
- Produces: global `moveBox(boxId, dir)` (dir −1 = up, +1 = down) and `moveBtnsHTML(boxId, bi)` returning header-button HTML. Used only by the four header builders.

- [ ] **Step 1: Add CSS for the arrow buttons**

In the `<style>` block, directly after the `.box-del:hover` rule (line ~113), add:

```css
  .box-move { font-size: 12px; color: var(--ink3); cursor: pointer; padding: 0 3px; opacity: 0.4; transition: all 0.2s; border-radius: 6px; }
  .box-move:hover { opacity: 1; color: var(--ink); background: var(--rule); }
  .box-move.disabled { opacity: 0.15; cursor: default; pointer-events: none; }
```

- [ ] **Step 2: Add `moveBox` and `moveBtnsHTML` functions**

Directly above `function renderBoxes(){` (line ~1042), add:

```js
function moveBox(boxId,dir){
  const tpl=getTemplate();
  const i=tpl.boxes.findIndex(b=>b.id===boxId);
  const j=i+dir;
  if(i<0||j<0||j>=tpl.boxes.length) return;
  [tpl.boxes[i],tpl.boxes[j]]=[tpl.boxes[j],tpl.boxes[i]];
  saveTemplate(tpl);
  renderBoxes();
}

function moveBtnsHTML(boxId,bi){
  const last=getTemplate().boxes.length-1;
  return `<span class="box-move ${bi===0?'disabled':''}" title="Move up" onclick="event.stopPropagation();moveBox('${boxId}',-1)">▲</span>
    <span class="box-move ${bi===last?'disabled':''}" title="Move down" onclick="event.stopPropagation();moveBox('${boxId}',1)">▼</span>`;
}
```

- [ ] **Step 3: Insert `${moveBtnsHTML(box.id,bi)}` into all four headers**

In each header template literal, insert the helper call on its own line between the chevron `<span>` and the `.box-del` `<span>`. The chevron+del pair is identical across three builders, so anchor each edit on the unique line above it:

Sentence-builder box (`buildBoxEl`, ~line 1057) — chevron line has 4-space indent:

```
    <span class="box-chevron ${isOpen?'open':''}" id="chev-${box.id}">▼</span>
    ${moveBtnsHTML(box.id,bi)}
    <span class="box-del" onclick="event.stopPropagation();deleteBox('${box.id}')">×</span>
```

Text Auto Fill (`buildAutoFillBoxEl`, ~line 1332; unique anchor: the `→ fills N PDF fields` box-field-tag line 2 lines above), Multi Check Box (`buildMultiCheckBoxEl`, ~line 1446; anchor: `→ N checkbox fields`), and Multi Text Table (`buildMultiTableBoxEl`, ~line 1614; anchor: `→ R×C table · N PDF fields`) — all three get the same insertion with 6-space indent:

```
      <span class="box-chevron ${isOpen?'open':''}" id="chev-${box.id}">▼</span>
      ${moveBtnsHTML(box.id,bi)}
      <span class="box-del" onclick="event.stopPropagation();deleteBox('${box.id}')">×</span>
```

Note: `bi` is already a parameter of all four builders, including the `replaceWith` call sites that pass `tpl.boxes.indexOf(box)`.

- [ ] **Step 4: Syntax check**

From the repo root, extract each inline `<script>` block (skip `src=` ones) and parse it with Node:

```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
let m,i=0;
while((m=re.exec(html))){ fs.writeFileSync('_check'+(i++)+'.js',m[1]); }
console.log(i+' blocks extracted');
"
for f in _check*.js; do node --check "$f" && rm "$f"; done
```

Expected: every block prints no error (`node --check` is silent on success) and all `_check*.js` files are removed. Then serve the site locally (`npx serve .` or the existing local preview), load the page, and confirm the browser console shows **zero** JavaScript errors.

- [ ] **Step 5: Manual verification in the builder (spec §Testing)**

Log in, open a template with 3+ boxes of mixed types, then verify:
1. Every box header shows ▲ ▼ left of ×, for all four box types.
2. Moving a middle box up/down swaps it and renumbers badges instantly.
3. Top box ▲ and bottom box ▼ are grayed and unclickable; a single-box template grays both.
4. Arrow clicks never collapse/expand the box.
5. Reload the page — order persists (Supabase save fired).
6. Fill screen lists boxes in the new order.

Expected: all six checks pass.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add up/down box reordering in template builder"
```

---

### Task 2: Deploy and live acceptance

**Files:**
- None (git push only)

**Interfaces:**
- Consumes: Task 1's commit on `main`.
- Produces: live feature on the Netlify site.

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

Expected: `main -> main` accepted; Netlify auto-deploys within ~2 minutes.

- [ ] **Step 2: Live acceptance check**

Hard-refresh the live site (Ctrl+Shift+R), repeat verification steps 1–6 from Task 1 Step 5 on the deployed site.
Expected: identical behavior to local.
