/* Run:  node --test
   Pure-logic tests for the engine. No DOM, no build step. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { isMine, isFlagged, isRevealed } from "../src/board.js";
import { analyze } from "../src/solver.js";

function countMines(e) {
  let n = 0;
  for (let i = 0; i < e.totalCells; i++) if (isMine(e.state, i)) n++;
  return n;
}

test("mine count matches config after first reveal", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 1 });
  e.reveal(40);
  assert.equal(countMines(e), 10);
});

test("first click is always safe (and opens a region)", () => {
  for (let seed = 0; seed < 50; seed++) {
    const e = new Engine({ width: 9, height: 9, mines: 10, seed });
    const r = e.reveal(40);
    assert.equal(isMine(e.state, 40), false, `seed ${seed}: first cell was a mine`);
    assert.notEqual(e.status, "lost");
    assert.ok(r.changed.length >= 1);
  }
});

test("clamps mines to leave room for the safe 9-cell start", () => {
  const e = new Engine({ width: 3, height: 3, mines: 99 });
  assert.ok(e.mineCount <= 9 - 0); // 3x3 => at most cells-? but >=1
  e.reveal(4); // center
  assert.notEqual(e.status, "lost");
});

test("revealing a mine loses and exposes all mines", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 7 });
  e.reveal(0); // place mines, safe
  const mine = [...Array(e.totalCells).keys()].find((i) => isMine(e.state, i));
  const r = e.reveal(mine);
  assert.equal(e.status, "lost");
  assert.equal(r.ended, "lost");
  // all mines revealed
  for (let i = 0; i < e.totalCells; i++) {
    if (isMine(e.state, i)) assert.ok(isRevealed(e.state, i));
  }
  // revealedCount invariant holds after loss (matches actual revealed cells)
  let actualRevealed = 0;
  for (let i = 0; i < e.totalCells; i++) if (isRevealed(e.state, i)) actualRevealed++;
  assert.equal(e.revealedCount, actualRevealed, "revealedCount must match reality after loss");
});

test("revealing every safe cell wins (O(1) detection)", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 3 });
  e.reveal(40);
  for (let i = 0; i < e.totalCells; i++) {
    if (!isMine(e.state, i) && !isRevealed(e.state, i)) e.reveal(i);
  }
  assert.equal(e.status, "won");
  assert.equal(e.revealedCount, e.safeCells);
});

test("flag toggling cycles and tracks flagCount", () => {
  const e = new Engine({ width: 5, height: 5, mines: 3, allowQuestion: true });
  e.toggleFlag(0);
  assert.ok(isFlagged(e.state, 0));
  assert.equal(e.flagCount, 1);
  e.toggleFlag(0); // -> question
  assert.equal(isFlagged(e.state, 0), false);
  assert.equal(e.flagCount, 0);
  e.toggleFlag(0); // -> none
  assert.equal(e.minesRemaining, 3);
});

test("cannot reveal a flagged cell", () => {
  const e = new Engine({ width: 5, height: 5, mines: 3, seed: 5 });
  e.reveal(12);
  e.toggleFlag(0);
  const before = e.revealedCount;
  e.reveal(0);
  assert.equal(e.revealedCount, before);
});

test("chord reveals neighbors when flags satisfy the number", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 9 });
  e.reveal(40);
  // find a revealed number whose adjacent mines are all known, flag them, chord
  let done = false;
  for (let i = 0; i < e.totalCells && !done; i++) {
    if (!isRevealed(e.state, i) || e.adjacency[i] === 0) continue;
    const ns = e.neighbors(i);
    const mines = ns.filter((n) => isMine(e.state, n));
    if (mines.length !== e.adjacency[i]) continue;
    if (!ns.some((n) => !isRevealed(e.state, n) && !isMine(e.state, n))) continue;
    mines.forEach((n) => e.toggleFlag(n));
    const r = e.chord(i);
    assert.ok(r.changed.length > 0);
    done = true;
  }
  assert.ok(done, "expected to find a chordable cell");
});

test("solver only reports provably-safe cells", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 11 });
  e.reveal(40);
  const { safe } = analyze(e);
  for (const i of safe) assert.equal(isMine(e.state, i), false);
});

test("large all-zero flood reveals everything without overflow or bad indices", () => {
  // a mine-free board: the very first click must cascade to the whole grid
  const e = new Engine({ width: 30, height: 16, mines: 1, seed: 4 });
  // force a known layout: clear mines, no adjacency
  e.adjacency.fill(0);
  e.state.fill(0);
  e.firstClickDone = true;
  e.status = "playing";
  e.mineCount = 0;
  const changed = e._flood(0);
  assert.equal(changed.length, e.totalCells, "flood should open every cell");
  assert.ok(changed.every((i) => Number.isInteger(i) && i >= 0 && i < e.totalCells),
    "every changed index is a valid integer");
  assert.equal(new Set(changed).size, changed.length, "no duplicate reveals");
  assert.equal(e.revealedCount, e.totalCells);
});

test("repeated reveals never produce invalid changed indices (fuzz)", () => {
  for (let seed = 0; seed < 80; seed++) {
    const e = new Engine({ width: 16, height: 16, mines: 40, seed });
    const r = e.reveal(8 * 16 + 8);
    for (const i of r.changed) {
      assert.ok(Number.isInteger(i) && i >= 0 && i < e.totalCells, `seed ${seed}: bad index ${i}`);
    }
  }
});

test("snapshot round-trips an in-progress game", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 2 });
  e.reveal(40);
  e.toggleFlag(0);
  const snap = e.snapshot();
  const e2 = Engine.fromSnapshot(snap);
  assert.equal(e2.revealedCount, e.revealedCount);
  assert.equal(e2.flagCount, e.flagCount);
  assert.deepEqual(Array.from(e2.state), Array.from(e.state));
});
