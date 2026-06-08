/* ============================================================
   main.js — composition root.
   Instantiates engine + renderer + input + timer + ui, wires the
   event flow, restores settings / in-progress game, and registers
   the service worker for offline play.
   ============================================================ */

import { Engine } from "./engine.js";
import { Renderer } from "./render.js";
import { Input } from "./input.js";
import { Timer } from "./timer.js";
import { UI, DIFFICULTIES } from "./ui.js";
import * as settingsStore from "./settings.js";
import * as stats from "./stats.js";
import * as storage from "./storage.js";
import * as solver from "./solver.js";
import { burst } from "./confetti.js";
import { formatTime } from "./timer.js";
import * as leaderboard from "./leaderboard.js";

const live = document.getElementById("live");
const wellEl = document.querySelector(".well");
const boardEl = document.getElementById("board");
const confettiEl = document.getElementById("confetti");

const settings = settingsStore.load();
const ui = new UI();
const renderer = new Renderer(boardEl);
let engine = new Engine({ ...presetConfig("beginner"), safeFirstClick: settings.safeFirstClick, allowQuestion: settings.question });
const timer = new Timer((ms) => ui.setTimer(ms));

let currentDiff = storage.get("lastDiff", "beginner");
let customConfig = storage.get("customConfig", { w: 16, h: 16, m: 40 });
let _pendingWin = null; // {difficulty, timeMs} awaiting a name before submit
if (!DIFFICULTIES[currentDiff] && currentDiff !== "custom") currentDiff = "beginner";

function presetConfig(diff) {
  const d = DIFFICULTIES[diff] || DIFFICULTIES.beginner;
  return { width: d.w, height: d.h, mines: d.m };
}

function reducedMotion() {
  return !settings.animations ||
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/* ---------- theme ---------- */
function prefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolveTheme() {
  const mode = settings.theme === "system" ? (prefersDark() ? "dark" : "light") : settings.theme;
  if (mode === "dark") return settings.palette === "slate" ? "slate" : "dark";
  return settings.palette === "classic" ? "classic" : "caldera";
}
function applyTheme() {
  document.documentElement.setAttribute("data-theme", resolveTheme());
  document.documentElement.setAttribute("data-anim", settings.animations ? "on" : "off");
}

/* ---------- difficulty key (for stats/best) ---------- */
function diffKey() {
  if (currentDiff === "custom") return `custom-${engine.width}x${engine.height}-${engine.mineCount}`;
  return currentDiff;
}

/* ---------- new game ---------- */
function newGame() {
  const cfg = currentDiff === "custom"
    ? { width: customConfig.w, height: customConfig.h, mines: customConfig.m }
    : presetConfig(currentDiff);
  engine.reset({ ...cfg, safeFirstClick: settings.safeFirstClick, allowQuestion: settings.question });
  renderer.build(engine);
  timer.reset();
  ui.setMineCount(engine.minesRemaining);
  ui.setFace("idle");
  ui.setTimer(0);
  ui.hideResult();
  ui.clearTimerRecord();
  ui.setActiveDifficulty(currentDiff);
  ui.setBest(stats.bestFor(diffKey()));
  wellEl.classList.remove("lost", "win-glow");
  clearSavedGame();
  storage.set("lastDiff", currentDiff);
}

/* ---------- the action funnel ---------- */
function handle(result) {
  if (!result || result.kind === "noop") return;
  renderer.apply(result, { animate: !reducedMotion() });
  ui.setMineCount(engine.minesRemaining);

  if (result.started) {
    ui.setFace("playing");
    timer.start(() => engine.elapsedMs());
  }
  if (result.ended === "won") return onWin();
  if (result.ended === "lost") return onLose(result.origin);
  if (engine.status === "playing") saveGame();
}

function onWin() {
  timer.stop();
  ui.setMineCount(0);
  ui.setFace("won");
  const timeMs = engine.elapsedMs();
  const dk = diffKey();
  const isBest = stats.record(dk, { won: true, timeMs, assisted: engine.assisted });
  ui.setBest(stats.bestFor(dk));
  if (!reducedMotion()) {
    wellEl.classList.add("win-glow");
    burst(confettiEl, { reduced: false, colors: themedConfetti() });
  }
  if (isBest && !engine.assisted) ui.pulseTimer();
  announce(`You win! Cleared in ${formatTime(timeMs)}.` + (isBest ? " New best time." : ""));
  clearSavedGame();
  ui.refreshStats(stats.all());

  // Online leaderboard: only ranked presets, never assisted runs.
  const eligible = leaderboard.isConfigured() && !!DIFFICULTIES[currentDiff] && !engine.assisted;
  const lbDiff = currentDiff;
  setTimeout(() => {
    ui.showResult({ won: true, timeMs, isBest: isBest && !engine.assisted });
    if (!eligible) return;
    if (settings.name) submitWin(lbDiff, timeMs, settings.name);
    else { _pendingWin = { difficulty: lbDiff, timeMs }; ui.showOverlaySubmit(""); }
  }, 650);
}

async function submitWin(difficulty, timeMs, name) {
  const res = await leaderboard.submitScore({ name, difficulty, timeMs });
  if (!res.ok) {
    ui.setOverlayRank(res.offline ? "" : "Couldn't reach the leaderboard.");
    return;
  }
  const rank = await leaderboard.rankFor(difficulty, timeMs);
  const label = (DIFFICULTIES[difficulty] || {}).label || difficulty;
  ui.setOverlayRank(rank ? `#${rank} on the ${label} leaderboard 🏆` : `Submitted to the ${label} leaderboard 🏆`);
}

async function loadLeaderboard(diff) {
  if (!leaderboard.isConfigured()) { ui.renderLeaderboard({ offline: true }); return; }
  ui.renderLeaderboardLoading();
  ui.renderLeaderboard(await leaderboard.topScores(diff, 10));
}

function onLose() {
  timer.stop();
  ui.setFace("lost");
  if (!reducedMotion()) wellEl.classList.add("lost");
  else wellEl.classList.add("lost");
  stats.record(diffKey(), { won: false, timeMs: engine.elapsedMs(), assisted: engine.assisted });
  announce("You hit a mine. Game over.");
  setTimeout(() => ui.showResult({ won: false }), 600);
  clearSavedGame();
  ui.refreshStats(stats.all());
}

function themedConfetti() {
  const cs = getComputedStyle(document.documentElement);
  return ["--accent", "--accent-soft", "--win", "--n1"].map((v) => cs.getPropertyValue(v).trim() || "#FF7A1A");
}

/* ---------- input handlers ---------- */
const handlers = {
  reveal(i) { handle(engine.reveal(i)); },
  flag(i) {
    const r = engine.toggleFlag(i);
    if (r.kind !== "noop") { handle(r); maybeAnnounceFlag(i); }
  },
  chord(i) {
    if (!settings.chord) return;
    handle(engine.chord(i));
  },
  restart() { newGame(); },
};

function maybeAnnounceFlag(i) {
  // light, throttled SR feedback
  announce(`${engine.minesRemaining} mines remaining`);
}

const input = new Input(boardEl, renderer, handlers, settings);

/* surprise face while pressing a covered cell */
boardEl.addEventListener("pointerdown", (e) => {
  if (engine.status === "lost" || engine.status === "won") return;
  const c = e.target.closest && e.target.closest(".cell");
  if (c && c.dataset.state === "hidden") ui.setFace("surprise");
});
window.addEventListener("pointerup", () => {
  if (engine.status === "playing") ui.setFace("playing");
  else if (engine.status === "idle") ui.setFace("idle");
});

/* ---------- hint ---------- */
function doHint() {
  if (engine.status === "won" || engine.status === "lost") return;
  if (!engine.firstClickDone) {
    // free safe start: open the center
    const center = engine.idx((engine.width / 2) | 0, (engine.height / 2) | 0);
    engine.assisted = true;
    handle(engine.reveal(center));
    return;
  }
  const safe = solver.hint(engine);
  if (safe == null) {
    announce("No certain move — you may need to guess.");
    flashHintEmpty();
    return;
  }
  engine.assisted = true;
  const cell = renderer.cells[safe];
  cell.classList.add("cursor");
  handle(engine.reveal(safe));
}
function flashHintEmpty() {
  ui.el.hint.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
    { duration: 240 }
  );
}

/* ---------- persistence of in-progress game ---------- */
function saveGame() {
  storage.set("savedGame", { snap: engine.snapshot(), diff: currentDiff, custom: customConfig });
}
function clearSavedGame() { storage.set("savedGame", null); }

function tryRestore() {
  const saved = storage.get("savedGame", null);
  if (!saved || !saved.snap || saved.snap.status !== "playing") return false;
  try {
    engine = Engine.fromSnapshot(saved.snap);
    currentDiff = saved.diff;
    customConfig = saved.custom || customConfig;
    renderer.build(engine);
    renderer.repaintAll();
    ui.setMineCount(engine.minesRemaining);
    ui.setActiveDifficulty(currentDiff);
    ui.setBest(stats.bestFor(diffKey()));
    ui.setFace("playing");
    timer.start(() => engine.elapsedMs());
    // input/handlers close over the original `engine` binding via module scope:
    rebindEngineRefs();
    return true;
  } catch {
    return false;
  }
}
// handlers/input read `engine` from module scope through the funcs above,
// but `input` captured `renderer` (stable). engine is referenced live in
// closures via the module-level `let engine`, so no rebinding needed for
// handlers. This hook exists for clarity/future use.
function rebindEngineRefs() { /* engine is module-scoped; closures see updates */ }

/* ---------- live region ---------- */
let announceTimer = 0;
function announce(msg) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { live.textContent = msg; }, 120);
}

/* ---------- wire UI ---------- */
ui.bind({
  onRestart: () => newGame(),
  onDifficulty: (diff) => { currentDiff = diff; newGame(); },
  onCustom: (cfg) => {
    customConfig = cfg;
    storage.set("customConfig", cfg);
    currentDiff = "custom";
    newGame();
  },
  onHint: doHint,
  onThemeToggle: () => {
    // cycle system → dark → light → system so OS-follow stays reachable
    settings.theme = settings.theme === "system" ? "dark"
      : settings.theme === "dark" ? "light" : "system";
    applyTheme();
    settingsStore.save(settings);
    announce(`Theme: ${settings.theme}`);
  },
  onOpenStats: () => ui.openStats(stats.all()),
  onResetStats: () => { stats.reset(); ui.refreshStats(stats.all()); ui.setBest(stats.bestFor(diffKey())); },
  onOpenLeaderboard: () => {
    const d = DIFFICULTIES[currentDiff] ? currentDiff : "beginner";
    ui.openLeaderboard(d);
    loadLeaderboard(d);
  },
  onLbDifficulty: (d) => loadLeaderboard(d),
  onSubmitScore: (name) => {
    const clean = (name || "").trim().slice(0, 20);
    if (clean) { settings.name = clean; settingsStore.save(settings); ui.reflectSettings(settings); }
    if (_pendingWin) {
      submitWin(_pendingWin.difficulty, _pendingWin.timeMs, clean || "Anonymous");
      _pendingWin = null;
    }
  },
  onSetting: (key, val) => {
    settings[key] = val;
    settingsStore.save(settings);
    if (key === "palette" || key === "animations") applyTheme();
    if (key === "safeFirstClick") { ui.safeFirstClick = val; if (!engine.firstClickDone) engine.safeFirstClick = val; }
    if (key === "question") engine.allowQuestion = val;
  },
});

/* react to OS theme changes while in system mode */
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "system") applyTheme();
  });
}
window.addEventListener("resize", () => renderer.fit());

/* ---------- boot ---------- */
applyTheme();
ui.reflectSettings(settings);
if (!tryRestore()) newGame();

/* service worker (offline) — relative scope, GitHub-Pages friendly */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
