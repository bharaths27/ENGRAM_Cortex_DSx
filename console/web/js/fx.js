/* Visual + sound effects. All sounds are synthesized with WebAudio: no files,
   no copyright issues, works offline. iOS needs a user tap first (ENGAGE). */
(function () {
  const FX = {};
  let ctx = null, master = null;
  FX.muted = false;

  FX.unlock = function () {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  };
  FX.ctx = () => ctx;

  function tone(freq, dur, type, vol, when, slideTo) {
    if (!ctx || FX.muted) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, when, hp) {
    if (!ctx || FX.muted) return;
    const t = ctx.currentTime + (when || 0);
    const n = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = hp || 1500;
    s.buffer = n; g.gain.value = vol || 0.2;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }

  FX.sfx = {
    blip: () => tone(1400, 0.06, "square", 0.15),
    tick: () => tone(2200, 0.03, "square", 0.08),
    key: () => tone(900 + Math.random() * 500, 0.02, "square", 0.04),
    boot: () => { tone(80, 1.4, "sawtooth", 0.25, 0, 640); noise(0.6, 0.1, 0.9, 3000); [0, .12, .24].forEach((w, i) => tone(660 * (i + 1), .25, "sine", .3, 1.3 + w)); },
    plan: () => { tone(520, .12, "triangle", .35); tone(780, .16, "triangle", .3, .09); },
    approve: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, .22, "triangle", .3, i * .06)); },
    reject: () => { tone(330, .18, "sawtooth", .25); tone(220, .3, "sawtooth", .25, .12); },
    abstain: () => { tone(440, .12, "square", .2); tone(300, .25, "square", .2, .12); },
    success: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, .3, "sine", .3, i * .08)); },
    warn: () => { tone(880, .12, "square", .2); tone(880, .12, "square", .2, .2); },
    stop: () => { tone(160, .9, "sawtooth", .5, 0, 60); noise(.4, .3, 0, 400); tone(1200, .1, "square", .3); tone(1200, .1, "square", .3, .25); tone(1200, .1, "square", .3, .5); },
    veto: () => { for (let i = 0; i < 4; i++) tone(1000, .08, "square", .25, i * .14); },
    rule: () => { tone(300, .5, "sine", .3, 0, 1200); tone(1200, .3, "triangle", .2, .45); },
    skill: () => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, .18, "triangle", .22, i * .05)); },
    step: () => tone(1800, .05, "sine", .2),
    rec: () => tone(1046, .08, "sine", .3),
  };
  FX.play = (n) => { try { FX.sfx[n] && FX.sfx[n](); } catch (e) {} };

  // Neutralized: signatures and class-toggle bodies kept, but the CSS no longer
  // animates #fx-flash.go or body.glitch, so these produce no visible full-screen
  // effect. Guarded so neither ever throws (Reqs 18.1, 18.2, 18.3, 18.4, 18.5).
  FX.flash = function (color) {
    try {
      const el = document.getElementById("fx-flash");
      if (!el) return;
      el.className = ""; void el.offsetWidth;
      el.className = "go " + (color || "");
    } catch (e) {}
  };
  FX.glitch = function () {
    try {
      document.body.classList.remove("glitch"); void document.body.offsetWidth;
      document.body.classList.add("glitch");
      setTimeout(() => { try { document.body.classList.remove("glitch"); } catch (e) {} }, 800);
    } catch (e) {}
  };
  // Toast/banner variants in the redesign palette. The three defined variant
  // classes map to semantic tokens in CSS: green->sage (success),
  // amber->orange (attention), red->soft-red (stop/abstain). Any kind outside
  // this set falls back to the default (no variant class), rendering on the
  // plain --panel surface without throwing (Reqs 13.3, 13.4, 13.5).
  // Null-prototype map so a kind that collides with an inherited Object member
  // (e.g. "valueOf", "toString", "constructor") is NOT mistaken for a defined
  // variant; any value outside {green, amber, red} falls back to the default
  // (empty) variant class (Req 13.5).
  const TOAST_VARIANTS = Object.assign(Object.create(null), { green: 1, amber: 1, red: 1 });
  function toastVariant(kind) {
    return (typeof kind === "string" && TOAST_VARIANTS[kind]) ? kind : "";
  }

  FX.banner = function (text, sub, color) {
    try {
      const el = document.getElementById("banner");
      if (!el) return;
      el.innerHTML = (text == null ? "" : text) + (sub ? "<small>" + sub + "</small>" : "");
      // color is an optional caller-supplied accent string; any non-string or
      // empty value degrades to the default (inherit --text) rather than being
      // assigned verbatim (Req 13.5 graceful default).
      el.style.color = (typeof color === "string" && color) ? color : "";
      el.className = "banner"; void el.offsetWidth; el.className = "banner go";
    } catch (e) {}
  };
  let toastT;
  FX.toast = function (text, kind) {
    try {
      const el = document.getElementById("toast");
      if (!el) return;
      const v = toastVariant(kind);
      el.textContent = (text == null ? "" : text);
      el.className = "toast on " + v;
      clearTimeout(toastT);
      toastT = setTimeout(() => { try { el.className = "toast " + v; } catch (e) {} }, 3200);
    } catch (e) {}
  };
  FX.typewrite = function (el, text, speed) {
    el.classList.add("typing");
    el.textContent = "";
    let i = 0;
    clearInterval(el._tw);
    el._tw = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i % 2) FX.play("key");
      if (i >= text.length) { clearInterval(el._tw); el.classList.remove("typing"); }
    }, speed || 18);
  };
  FX.scramble = function (el, text) {
    const chars = "▓▒░<>/\\|=+*#01";
    let f = 0;
    clearInterval(el._sc);
    el._sc = setInterval(() => {
      f++;
      el.textContent = text.split("").map((c, i) => (i < f / 2 ? c : chars[(Math.random() * chars.length) | 0])).join("");
      if (f / 2 >= text.length) { clearInterval(el._sc); el.textContent = text; }
    }, 22);
  };
  window.FX = FX;
})();
