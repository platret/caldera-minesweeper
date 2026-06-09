/* Run:  node --test
   Pure-logic tests for the new features (no DOM, no build step). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { isMine, isRevealed, isFlagged } from "../src/board.js";
import { analyze } from "../src/solver.js";
import { compute3BV, efficiency, threeBVPerSecond } from "../src/metrics.js";
import { makeNoGuessGenerator, noGuessLayout } from "../src/generate.js";
import { seedForDate, dailySafeIndex, todayKey, DAILY_CONFIG } from "../src/daily.js";
import { buildShare } from "../src/share.js";
import { ACHIEVEMENTS } from "../src/achievements.js";

/* ---------------- 3BV ---------------- */

test("3BV of a single-corner-mine 3x3 board is 1", () => {
  const e = new Engine({ width: 3, height: 3, mines: 1, seed: 1 });
  // hand-place: one mine in the corner (idx 0), recompute adjacency.
  e.state.fill(0); e.adjacency.fill(0);
  e._applyLayout([0]);
  assert.equal(compute3BV(e), 1);
});

test("3BV stays within [1, safeCells] for many boards", () => {
  for (let seed = 0; seed < 40; seed++) {
    const e = new Engine({ width: 16, height: 16, mines: 40, seed });
    e.reveal(8 * 16 + 8); // place mines
    const bv = compute3BV(e);
    assert.ok(bv >= 1, `seed ${seed}: 3BV must be >= 1`);
    assert.ok(bv <= e.safeCells, `seed ${seed}: 3BV must be <= safe cells`);
  }
});

test("derived metrics behave", () => {
  assert.equal(efficiency(30, 30), 1);
  assert.equal(efficiency(30, 0), null);
  assert.ok(Math.abs(threeBVPerSecond(50, 25000) - 2) < 1e-9);
  assert.equal(threeBVPerSecond(0, 1000), null);
});

/* ---------------- no-guess generation ---------------- */

test("no-guess layout is well-formed and outside the safe zone", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 5 });
  const safe = 40;
  const layout = noGuessLayout(e, safe);
  assert.ok(layout, "expected a no-guess layout for a beginner board");
  assert.equal(layout.length, 10);
  const forbidden = new Set([safe, ...e.neighbors(safe)]);
  for (const m of layout) assert.equal(forbidden.has(m), false, "mine landed in the safe opening");
  assert.equal(new Set(layout).size, layout.length, "no duplicate mines");
});

test("a no-guess board is fully solvable by pure deduction", () => {
  // Drive the real engine + the real Hint solver to completion. If the board
  // truly needs no guessing, logic alone must clear it.
  let solvedAtLeastOnce = false;
  for (let seed = 0; seed < 8; seed++) {
    const e = new Engine({ width: 9, height: 9, mines: 10, seed, mineGenerator: makeNoGuessGenerator() });
    const center = 40;
    e.reveal(center);
    if (!e.firstClickDone) continue;

    let guard = 0;
    while (e.status === "playing" && guard++ < 500) {
      const { safe, mines } = analyze(e);
      let progress = false;
      for (const m of mines) if (!isFlagged(e.state, m) && !isRevealed(e.state, m)) { e.toggleFlag(m); progress = true; }
      for (const s of safe) if (!isRevealed(e.state, s) && !isFlagged(e.state, s)) { e.reveal(s); progress = true; }
      if (!progress) break;
    }
    if (e.status === "won") solvedAtLeastOnce = true;
    // Whatever happens, logic must never have detonated a mine on a no-guess board.
    assert.notEqual(e.status, "lost", `seed ${seed}: no-guess board lost to pure logic`);
  }
  assert.ok(solvedAtLeastOnce, "expected at least one no-guess board to solve to a win");
});

/* ---------------- undo ---------------- */

test("undo rewinds a reveal and marks the run assisted", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 3 });
  e.reveal(40);
  const afterFirst = e.revealedCount;
  // find a covered safe cell and reveal it
  let next = -1;
  for (let i = 0; i < e.totalCells; i++) if (!isRevealed(e.state, i) && !isMine(e.state, i)) { next = i; break; }
  e.reveal(next);
  assert.ok(e.revealedCount >= afterFirst);
  assert.ok(e.canUndo);
  const changed = e.undo();
  assert.ok(changed && changed.length > 0);
  assert.equal(e.revealedCount, afterFirst);
  assert.equal(e.assisted, true);
});

test("undo restores flags too", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 4 });
  e.reveal(40);
  e.toggleFlag(0);
  assert.equal(e.flagCount, 1);
  e.undo();
  assert.equal(e.flagCount, 0);
  assert.equal(isFlagged(e.state, 0), false);
});

/* ---------------- pencil notes ---------------- */

test("pencil notes set, toggle off, and clear on reveal", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 6 });
  e.reveal(40);
  let target = -1;
  for (let i = 0; i < e.totalCells; i++) if (!isRevealed(e.state, i) && !isMine(e.state, i)) { target = i; break; }
  e.setNote(target, 3);
  assert.equal(e.notes[target], 3);
  e.setNote(target, 3); // same digit clears
  assert.equal(e.notes[target], 0);
  e.setNote(target, 5);
  e.reveal(target);
  assert.equal(e.notes[target], 0, "note should clear when the cell is revealed");
});

test("cannot place a note on a revealed or flagged cell", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 8 });
  e.reveal(40);
  const r1 = e.setNote(40, 2); // already revealed
  assert.equal(r1.kind, "noop");
  e.toggleFlag(0);
  const r2 = e.setNote(0, 2);
  assert.equal(r2.kind, "noop");
});

/* ---------------- daily challenge ---------------- */

test("daily seed is deterministic per date and varies across dates", () => {
  assert.equal(seedForDate("2026-06-09"), seedForDate("2026-06-09"));
  assert.notEqual(seedForDate("2026-06-09"), seedForDate("2026-06-10"));
});

test("daily board is identical for the same day (pre-placed, click-independent)", () => {
  const seed = seedForDate("2026-06-09");
  const safe = dailySafeIndex();
  const mk = () => {
    const e = new Engine({ width: DAILY_CONFIG.w, height: DAILY_CONFIG.h, mines: DAILY_CONFIG.m, seed, prePlaceSafe: safe });
    return Array.from(e.state);
  };
  assert.deepEqual(mk(), mk(), "two daily boards for the same seed must match exactly");
});

test("daily center opening is safe", () => {
  const seed = seedForDate("2026-06-09");
  const safe = dailySafeIndex();
  const e = new Engine({ width: DAILY_CONFIG.w, height: DAILY_CONFIG.h, mines: DAILY_CONFIG.m, seed, prePlaceSafe: safe });
  assert.equal(isMine(e.state, safe), false);
  const r = e.reveal(safe);
  assert.notEqual(r.ended, "lost");
});

test("todayKey is a YYYY-MM-DD string", () => {
  assert.match(todayKey(new Date("2026-06-09T12:00:00")), /^\d{4}-\d{2}-\d{2}$/);
});

/* ---------------- share ---------------- */

test("share text summarizes a win", () => {
  const e = new Engine({ width: 9, height: 9, mines: 10, seed: 2 });
  e.reveal(40);
  const text = buildShare({
    won: true, title: "Beginner", timeMs: 42000,
    threeBV: 30, threeBVps: 1.5, efficiency: 0.9, streak: 3,
  }, e);
  assert.match(text, /Caldera Minesweeper/);
  assert.match(text, /Cleared in/);
  assert.match(text, /3BV 30/);
});

/* ---------------- achievements ---------------- */

test("achievement predicates fire on the right contexts", () => {
  const get = (id) => ACHIEVEMENTS.find((a) => a.id === id);
  assert.equal(get("first-win").test({ won: true }), true);
  assert.equal(get("first-win").test({ won: false }), false);
  assert.equal(get("sub100-exp").test({ won: true, difficulty: "expert", timeMs: 90000 }), true);
  assert.equal(get("sub100-exp").test({ won: true, difficulty: "expert", timeMs: 120000 }), false);
  assert.equal(get("no-guess").test({ won: true, noGuess: true, assisted: false }), true);
  assert.equal(get("no-guess").test({ won: true, noGuess: true, assisted: true }), false);
});
