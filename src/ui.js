/* ============================================================
   ui.js — chrome: HUD, difficulty control, dialogs, theme,
   result overlay, best-time badge. Pure view + event wiring;
   game state lives in the engine (see main.js).
   ============================================================ */

import { formatClock, formatTime } from "./timer.js";

export const DIFFICULTIES = {
  beginner:     { w: 9,  h: 9,  m: 10, label: "Beginner" },
  intermediate: { w: 16, h: 16, m: 40, label: "Intermediate" },
  expert:       { w: 30, h: 16, m: 99, label: "Expert" },
};

const FACES = { idle: "🙂", playing: "🙂", surprise: "😮", won: "😎", lost: "😵" };

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      mineCount: $("mine-count"),
      timer: $("timer"),
      mineReadout: $("mine-readout"),
      timerReadout: $("timer-readout"),
      face: $("btn-reset"),
      faceGlyph: $("btn-reset").querySelector(".face-glyph"),
      segs: [...document.querySelectorAll(".seg")],
      segThumb: document.querySelector(".seg-thumb"),
      segmented: document.querySelector(".segmented"),
      flagMode: $("btn-flag-mode"),
      hint: $("btn-hint"),
      theme: $("btn-theme"),
      settingsBtn: $("btn-settings"),
      statsBtn: $("btn-stats"),
      bestTime: $("best-time"),
      // overlay
      overlay: $("overlay"),
      ovEmoji: $("overlay-emoji"),
      ovTitle: $("overlay-title"),
      ovSub: $("overlay-sub"),
      ovBest: $("overlay-best"),
      ovAgain: $("overlay-again"),
      ovDismiss: $("overlay-dismiss"),
      // custom dialog
      customDlg: $("custom-dialog"),
      inpW: $("inp-width"), outW: $("out-width"),
      inpH: $("inp-height"), outH: $("out-height"),
      inpM: $("inp-mines"), outM: $("out-mines"),
      densFill: $("density-fill"), densPct: $("density-pct"), densNote: $("density-note"),
      // stats dialog
      statsDlg: $("stats-dialog"), statsContent: $("stats-content"),
      statsReset: $("stats-reset"), statsClose: $("stats-close"),
      // settings dialog
      setDlg: $("settings-dialog"),
      setPalette: $("set-palette"), setQuestion: $("set-question"),
      setChord: $("set-chord"), setSafe: $("set-safe"),
      setAnim: $("set-anim"), setHaptics: $("set-haptics"),
      setClose: $("settings-close"),
    };
    this._cb = {};
  }

  bind(callbacks) {
    this._cb = callbacks;
    const e = this.el;

    e.face.addEventListener("click", () => this._cb.onRestart && this._cb.onRestart());

    e.segs.forEach((seg) => seg.addEventListener("click", () => {
      const diff = seg.dataset.diff;
      if (diff === "custom") this.openCustom();
      else this._cb.onDifficulty && this._cb.onDifficulty(diff);
    }));

    e.flagMode.addEventListener("click", () => {
      const next = e.flagMode.getAttribute("aria-pressed") !== "true";
      e.flagMode.setAttribute("aria-pressed", String(next));
      this._cb.onSetting && this._cb.onSetting("flagMode", next);
    });

    e.hint.addEventListener("click", () => this._cb.onHint && this._cb.onHint());
    e.theme.addEventListener("click", () => this._cb.onThemeToggle && this._cb.onThemeToggle());
    e.settingsBtn.addEventListener("click", () => this.openSettings());
    e.statsBtn.addEventListener("click", () => this._cb.onOpenStats && this._cb.onOpenStats());

    e.ovAgain.addEventListener("click", () => { this.hideResult(); this._cb.onRestart && this._cb.onRestart(); });
    e.ovDismiss.addEventListener("click", () => this.hideResult());

    // custom dialog: live density + submit
    const syncCustom = () => this._syncCustom();
    [e.inpW, e.inpH, e.inpM].forEach((inp) => inp.addEventListener("input", syncCustom));
    e.customDlg.addEventListener("close", () => {
      if (e.customDlg.returnValue === "start") {
        const cfg = {
          w: +e.inpW.value, h: +e.inpH.value,
          m: Math.min(+e.inpM.value, e.inpW.value * e.inpH.value - 9),
        };
        this._cb.onCustom && this._cb.onCustom(cfg);
      }
    });

    // stats dialog
    e.statsClose.addEventListener("click", () => e.statsDlg.close());
    e.statsReset.addEventListener("click", () => this._cb.onResetStats && this._cb.onResetStats());

    // settings dialog
    const setMap = {
      setPalette: "palette", setQuestion: "question", setChord: "chord",
      setSafe: "safeFirstClick", setAnim: "animations", setHaptics: "haptics",
    };
    Object.entries(setMap).forEach(([refKey, settingKey]) => {
      const node = e[refKey];
      node.addEventListener("change", () => {
        const val = node.type === "checkbox" ? node.checked : node.value;
        this._cb.onSetting && this._cb.onSetting(settingKey, val);
      });
    });
    e.setClose.addEventListener("click", () => e.setDlg.close());

    window.addEventListener("resize", () => this.moveSegThumb());
  }

  /* ---------- HUD ---------- */
  setMineCount(n) {
    const v = Math.max(-99, Math.min(999, n));
    const str = (v < 0 ? "-" : "") + String(Math.abs(v)).padStart(v < 0 ? 2 : 3, "0");
    this.el.mineCount.textContent = str;
    this.el.mineReadout.classList.toggle("danger", n <= 0);
  }

  setTimer(ms) { this.el.timer.textContent = formatClock(ms); }

  setFace(state) {
    this.el.face.dataset.face = state;
    this.el.faceGlyph.textContent = FACES[state] || FACES.idle;
  }

  pulseTimer() {
    this.el.timer.classList.remove("pulse");
    void this.el.timer.offsetWidth;
    this.el.timer.classList.add("pulse");
    this.el.timerReadout.classList.add("record");
  }
  clearTimerRecord() { this.el.timerReadout.classList.remove("record"); this.el.timer.classList.remove("pulse"); }

  setActiveDifficulty(diff) {
    this.el.segs.forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.diff === diff)));
    this.moveSegThumb();
  }

  moveSegThumb() {
    const active = this.el.segs.find((s) => s.getAttribute("aria-pressed") === "true") || this.el.segs[0];
    if (!active || !this.el.segThumb) return;
    this.el.segThumb.style.width = active.offsetWidth + "px";
    this.el.segThumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
  }

  setBest(ms) {
    this.el.bestTime.textContent = ms == null ? "—" : formatTime(ms);
  }

  /* ---------- result overlay ---------- */
  showResult({ won, timeMs, isBest }) {
    const e = this.el;
    e.ovEmoji.textContent = won ? "🎉" : "💥";
    e.ovTitle.textContent = won ? "You win!" : "Boom.";
    e.ovSub.textContent = won ? `Cleared in ${formatTime(timeMs)}` : "You hit a mine.";
    e.ovBest.classList.toggle("hidden", !(won && isBest));
    e.overlay.classList.remove("hidden");
  }
  hideResult() { this.el.overlay.classList.add("hidden"); }

  /* ---------- custom dialog ---------- */
  openCustom(initial) {
    const e = this.el;
    if (initial) { e.inpW.value = initial.w; e.inpH.value = initial.h; e.inpM.value = initial.m; }
    this._syncCustom();
    e.customDlg.showModal();
  }
  _syncCustom() {
    const e = this.el;
    const w = +e.inpW.value, h = +e.inpH.value;
    const maxMines = Math.max(1, w * h - 9);
    e.inpM.max = maxMines;
    if (+e.inpM.value > maxMines) e.inpM.value = maxMines;
    const m = +e.inpM.value;
    e.outW.textContent = w; e.outH.textContent = h; e.outM.textContent = m;
    const pct = Math.round((m / (w * h)) * 100);
    e.densFill.style.width = Math.min(100, pct) + "%";
    e.densPct.textContent = pct + "%";
    e.densNote.textContent = pct < 12 ? "easy" : pct < 18 ? "comfortable" : pct < 25 ? "tricky" : "brutal";
  }

  /* ---------- stats dialog ---------- */
  openStats(statsData) {
    const e = this.el;
    const rows = [];
    for (const [key, d] of Object.entries(DIFFICULTIES)) {
      const best = statsData.best[key];
      const games = statsData.games[key] || 0;
      const wins = statsData.wins[key] || 0;
      const rate = games ? Math.round((wins / games) * 100) : 0;
      rows.push(`<div class="stat-row">
        <span class="name">${d.label}</span>
        <span class="best">${best != null ? formatTime(best) : "—"}</span>
        <span class="meta">${wins}/${games} · ${rate}%</span>
      </div>`);
    }
    e.statsContent.innerHTML = rows.join("") +
      `<div class="stat-summary">Current streak: ${statsData.streak || 0} · Best streak: ${statsData.bestStreak || 0}</div>`;
    e.statsDlg.showModal();
  }
  refreshStats(statsData) { if (this.el.statsDlg.open) this.openStats(statsData); }

  /* ---------- settings dialog ---------- */
  openSettings() { this.el.setDlg.showModal(); }
  reflectSettings(s) {
    const e = this.el;
    e.setPalette.value = s.palette;
    e.setQuestion.checked = s.question;
    e.setChord.checked = s.chord;
    e.setSafe.checked = s.safeFirstClick;
    e.setAnim.checked = s.animations;
    e.setHaptics.checked = s.haptics;
    e.flagMode.setAttribute("aria-pressed", String(s.flagMode));
  }
}
