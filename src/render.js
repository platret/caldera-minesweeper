/* ============================================================
   render.js — DOM view layer.
   Builds all cell nodes ONCE into a DocumentFragment, keeps a
   parallel cells[] ref array, then mutates only changed indices.
   ============================================================ */

import {
  isRevealed, isFlagged, isQuestion, isMine, isExploded, isWrongFlag,
} from "./board.js";

const ANIM_CLASSES = [
  "reveal-anim", "num-anim", "flag-anim", "mine-anim", "exploded-anim", "win-anim",
];
const FLAG = '<span class="flag-glyph">⚑</span>';
const MINE_DOT = '<span class="mine-dot"></span>';
const DELAY_STEP = 16;
const DELAY_CAP = 280;

export class Renderer {
  constructor(boardEl) {
    this.board = boardEl;
    this.cells = [];
    this.engine = null;
    this.cursor = -1;
    // clean up one-shot animation classes when they finish
    this.board.addEventListener("animationend", (e) => {
      const t = e.target;
      if (t.classList && t.classList.contains("cell")) t.classList.remove(...ANIM_CLASSES);
    });
  }

  build(engine) {
    this.engine = engine;
    const { width, height, totalCells } = engine;
    this.board.style.setProperty("--cols", width);
    this.board.style.setProperty("--rows", height);
    this.board.setAttribute("aria-rowcount", height);
    this.board.setAttribute("aria-colcount", width);

    const frag = document.createDocumentFragment();
    this.cells = new Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      const x = i % width, y = (i / width) | 0;
      const btn = document.createElement("div");
      btn.className = "cell" + (((x + y) & 1) ? " alt" : "");
      btn.dataset.index = i;
      btn.dataset.state = "hidden";
      btn.setAttribute("role", "gridcell");
      btn.setAttribute("aria-rowindex", y + 1);
      btn.setAttribute("aria-colindex", x + 1);
      btn.setAttribute("tabindex", "-1");
      btn.setAttribute("aria-label", this.label(i));
      this.cells[i] = btn;
      frag.appendChild(btn);
    }
    this.board.replaceChildren(frag);
    this.cursor = -1;
    this.fit();
  }

  /** apply an engine result; animate based on its kind */
  apply(result, opts = {}) {
    const { changed, origin, kind } = result;
    const animate = opts.animate !== false;
    const ex = this.engine.xOf(origin), ey = this.engine.yOf(origin);
    for (let k = 0; k < changed.length; k++) {
      const i = changed[k];
      const cell = this.cells[i];
      if (!cell) continue;
      this.paint(cell, i);
      if (!animate) continue;

      if (origin >= 0 && (kind === "reveal" || kind === "win" || kind === "lose")) {
        const dist = Math.max(Math.abs(this.engine.xOf(i) - ex), Math.abs(this.engine.yOf(i) - ey));
        cell.style.setProperty("--delay", Math.min(dist * DELAY_STEP, DELAY_CAP) + "ms");
      } else {
        cell.style.setProperty("--delay", "0ms");
      }
      this.animateCell(cell, i, kind);
    }
  }

  animateCell(cell, i, kind) {
    const s = this.engine.state;
    if (kind === "flag") {
      if (isFlagged(s, i)) cell.classList.add("flag-anim");
    } else if (kind === "win") {
      cell.classList.add("win-anim");
    } else if (kind === "lose") {
      if (isExploded(s, i)) cell.classList.add("exploded-anim");
      else if (isMine(s, i)) cell.classList.add("mine-anim");
    } else if (kind === "reveal") {
      if (isRevealed(s, i)) {
        cell.classList.add("reveal-anim");
        if (this.engine.adjacency[i] > 0) cell.classList.add("num-anim");
      }
    }
  }

  /** repaint a single cell from canonical engine state */
  paint(cell, i) {
    const s = this.engine.state;
    let state, html = null, text = "";
    cell.removeAttribute("data-adj");

    if (isExploded(s, i)) { state = "exploded"; html = MINE_DOT; }
    else if (isRevealed(s, i) && isMine(s, i)) { state = "mine"; html = MINE_DOT; }
    else if (isWrongFlag(s, i)) { state = "wrong"; html = FLAG; }
    else if (isRevealed(s, i)) {
      state = "revealed";
      const a = this.engine.adjacency[i];
      if (a > 0) { text = String(a); cell.dataset.adj = a; }
    }
    else if (isFlagged(s, i)) { state = "flagged"; html = FLAG; }
    else if (isQuestion(s, i)) { state = "question"; }
    else { state = "hidden"; }

    cell.dataset.state = state;
    if (html != null) cell.innerHTML = html;
    else cell.textContent = text;
    cell.setAttribute("aria-label", this.label(i));
    cell.setAttribute("aria-disabled", state === "hidden" || state === "flagged" || state === "question" ? "false" : "true");
  }

  /** full repaint (used after restoring a saved game) */
  repaintAll() {
    for (let i = 0; i < this.cells.length; i++) this.paint(this.cells[i], i);
  }

  label(i) {
    const e = this.engine;
    const s = e.state;
    const x = e.xOf(i) + 1, y = e.yOf(i) + 1;
    const pos = `row ${y}, column ${x}`;
    if (isExploded(s, i)) return `${pos}, exploded mine`;
    if (isRevealed(s, i) && isMine(s, i)) return `${pos}, mine`;
    if (isWrongFlag(s, i)) return `${pos}, wrong flag`;
    if (isRevealed(s, i)) {
      const a = e.adjacency[i];
      return a > 0 ? `${pos}, ${a} ${a === 1 ? "mine" : "mines"} adjacent` : `${pos}, empty`;
    }
    if (isFlagged(s, i)) return `${pos}, flagged`;
    if (isQuestion(s, i)) return `${pos}, question mark`;
    return `${pos}, hidden`;
  }

  /** focus: move DOM focus to the cell. visual: show the cursor outline
      (only wanted during keyboard play, not on every mouse click). */
  setCursor(i, focus = true, visual = true) {
    if (this.cursor >= 0 && this.cells[this.cursor]) {
      this.cells[this.cursor].classList.remove("cursor");
      this.cells[this.cursor].setAttribute("tabindex", "-1");
    }
    this.cursor = i;
    const c = this.cells[i];
    if (i >= 0 && c) {
      if (visual) c.classList.add("cursor");
      c.setAttribute("tabindex", "0");
      if (focus) c.focus({ preventScroll: false });
    }
  }

  /** size cells to fit the viewport; the well scrolls if still too large */
  fit() {
    const e = this.engine;
    if (!e) return;
    const gap = 3, wellPad = 14;
    const budgetW = Math.min(window.innerWidth * 0.94, 940);
    const budgetH = Math.max(260, window.innerHeight * 0.62);
    const cw = (budgetW - gap * (e.width - 1) - wellPad * 2) / e.width;
    const ch = (budgetH - gap * (e.height - 1) - wellPad * 2) / e.height;
    const size = Math.max(16, Math.min(40, Math.floor(Math.min(cw, ch))));
    document.documentElement.style.setProperty("--cell-size", size + "px");
  }
}
