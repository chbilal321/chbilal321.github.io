/* Live figures: molecular dynamics, reverse diffusion, classifier training,
   multi-omics target discovery and blood–brain barrier permeation.
   Each figure only animates while it is on screen. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var rand = Math.random;
  function gauss() { var u = 1 - rand(), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // ---- theme colours, refreshed when the theme changes ----
  var C = {};
  function readColors() {
    var s = getComputedStyle(document.documentElement);
    var light = document.documentElement.dataset.theme === "light";
    C = {
      light: light,
      bg: s.getPropertyValue("--bg-2").trim(),
      ink: s.getPropertyValue("--ink").trim(),
      ink2: s.getPropertyValue("--ink-2").trim(),
      line: s.getPropertyValue("--line").trim(),
      green: light ? "#275D38" : "#6FBF86",
      greenDeep: "#275D38",
      gold: light ? "#C9A800" : "#F2CD00",
      goldSoft: light ? "rgba(201,168,0,.18)" : "rgba(242,205,0,.16)",
      solvent: light ? "rgba(39,93,56,.28)" : "rgba(111,191,134,.30)",
      N: light ? "#2F5FD0" : "#7FA6FF",
      O: light ? "#C8412E" : "#FF7A66",
      Cl: light ? "#2E9E4F" : "#8BE09C",
      F: light ? "#0E8A9A" : "#7FE3EF",
      blood: light ? "#F6E4E1" : "#2A1A1C",
      rbc: light ? "rgba(190,70,70,.55)" : "rgba(214,94,94,.55)",
      brain: light ? "#EEF3EE" : "#10261A"
    };
  }
  readColors();
  var figures = [];
  document.addEventListener("themechange", function () { readColors(); figures.forEach(function (f) { f.redraw(); }); });

  // ---- figure scaffolding: hi-dpi canvas, resize, visibility-gated loop ----
  function Figure(canvas, impl) {
    var ctx = canvas.getContext("2d");
    var self = { canvas: canvas, ctx: ctx, w: 0, h: 0, visible: false, running: false, last: 0 };
    function resize() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!r.width) return;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      self.w = r.width; self.h = r.height;
      if (impl.resize) impl.resize(self);
      impl.draw(self);
    }
    function frame(ts) {
      if (!self.visible) { self.running = false; return; }
      var dt = Math.min(0.05, (ts - (self.last || ts)) / 1000);
      self.last = ts;
      impl.step(self, dt);
      impl.draw(self);
      requestAnimationFrame(frame);
    }
    self.start = function () {
      if (reduceMotion || self.running) return;
      self.running = true; self.last = 0;
      requestAnimationFrame(frame);
    };
    self.redraw = function () { if (self.w) impl.draw(self); };
    impl.init(self);
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(function (es) {
      self.visible = es[0].isIntersecting;
      if (self.visible) self.start();
    }, { threshold: 0.05 }).observe(canvas);
    if (reduceMotion && impl.settle) impl.settle(self);
    figures.push(self);
    return self;
  }

  function label(ctx, text, x, y, color, size, align, weight) {
    ctx.fillStyle = color;
    ctx.font = (weight || 500) + " " + (size || 12) + "px 'Public Sans', system-ui, sans-serif";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
  }

  /* =====================================================================
     Fig. 1 — Lennard-Jones molecular dynamics with a bonded ligand
     ===================================================================== */
  var MD = (function () {
    var LX = 32, LY = 20, RC = 2.5, RC2 = RC * RC, DT = 0.004;
    var s = {};
    function init() {
      var P = [];
      // binding pocket: fixed U-shaped arc of atoms near bottom centre
      for (var i = 0; i <= 12; i++) {
        var a = Math.PI * (0.05 + 0.9 * i / 12);
        P.push({ x: 16 + Math.cos(a) * 4.2, y: 14.2 + Math.sin(a) * 3.6 - 0.2, vx: 0, vy: 0, fx: 0, fy: 0, k: "pocket" });
      }
      // ligand: 5 bonded atoms, starts upper left
      var lig0 = P.length;
      for (i = 0; i < 5; i++) P.push({ x: 6 + i * 1.05, y: 4 + (i % 2) * 0.4, vx: gauss() * 0.5, vy: gauss() * 0.5, fx: 0, fy: 0, k: "lig" });
      // solvent on a jittered lattice, skipping occupied spots
      for (var gx = 0.8; gx < LX; gx += 1.75) for (var gy = 0.8; gy < LY; gy += 1.75) {
        var ok = true;
        for (var j = 0; j < P.length; j++) { var dx = P[j].x - gx, dy = P[j].y - gy; if (dx * dx + dy * dy < 1.9) { ok = false; break; } }
        if (Math.abs(gx - 16) < 3.4 && gy > 11.2 && gy < 17) ok = false;
        if (ok && rand() < 0.62) P.push({ x: gx, y: gy, vx: gauss(), vy: gauss(), fx: 0, fy: 0, k: "sol" });
      }
      s = { P: P, lig0: lig0, T: 1, target: 1, heatUntil: 0, time: 0, pe: 0, trPE: [], trT: [] };
      forces();
    }
    function forces() {
      var P = s.P, n = P.length, pe = 0, i, j;
      for (i = 0; i < n; i++) { P[i].fx = 0; P[i].fy = 0; }
      for (i = 0; i < n; i++) {
        var pi = P[i];
        for (j = i + 1; j < n; j++) {
          var pj = P[j];
          if (pi.k === "pocket" && pj.k === "pocket") continue;
          var dx = pi.x - pj.x, dy = pi.y - pj.y;
          dx -= LX * Math.round(dx / LX); dy -= LY * Math.round(dy / LY);
          var r2 = dx * dx + dy * dy;
          if (r2 > RC2) continue;
          var eps = 1;
          if ((pi.k === "lig" && pj.k === "pocket") || (pj.k === "lig" && pi.k === "pocket")) eps = 1.9;
          if (pi.k === "lig" && pj.k === "lig") continue; // bonded below
          r2 = Math.max(r2, 0.64);
          var ir2 = 1 / r2, ir6 = ir2 * ir2 * ir2;
          var f = clamp(24 * eps * ir2 * ir6 * (2 * ir6 - 1), -60, 60);
          pi.fx += f * dx; pi.fy += f * dy; pj.fx -= f * dx; pj.fy -= f * dy;
          pe += 4 * eps * ir6 * (ir6 - 1);
        }
      }
      // harmonic bonds + weak angle stiffness along the ligand chain
      for (i = s.lig0; i < s.lig0 + 4; i++) {
        var a = P[i], b = P[i + 1];
        var bx = b.x - a.x, by = b.y - a.y, r = Math.sqrt(bx * bx + by * by) || 1e-6;
        var k = 180 * (r - 1.05);
        a.fx += k * bx / r; a.fy += k * by / r; b.fx -= k * bx / r; b.fy -= k * by / r;
        pe += 90 * (r - 1.05) * (r - 1.05);
        if (i < s.lig0 + 3) {
          var c = P[i + 2];
          var cx = c.x - a.x, cy = c.y - a.y, rc = Math.sqrt(cx * cx + cy * cy) || 1e-6, kc = 12 * (rc - 1.9);
          a.fx += kc * cx / rc; a.fy += kc * cy / rc; c.fx -= kc * cx / rc; c.fy -= kc * cy / rc;
        }
      }
      s.pe = pe;
    }
    function step(dt) {
      var P = s.P, n = P.length, i, sub = 5;
      for (var it = 0; it < sub; it++) {
        for (i = 0; i < n; i++) { var p = P[i]; if (p.k === "pocket") continue; p.vx += 0.5 * DT * p.fx; p.vy += 0.5 * DT * p.fy; p.x += DT * p.vx; p.y += DT * p.vy; p.x = (p.x + LX) % LX; p.y = (p.y + LY) % LY; }
        forces();
        var ke = 0, m = 0;
        for (i = 0; i < n; i++) { p = P[i]; if (p.k === "pocket") continue; p.vx += 0.5 * DT * p.fx; p.vy += 0.5 * DT * p.fy; ke += 0.5 * (p.vx * p.vx + p.vy * p.vy); m++; }
        s.T = ke / m; // 2D: kT = KE per particle
        var lam = Math.sqrt(1 + 0.02 * (s.target / Math.max(s.T, 1e-3) - 1));
        for (i = 0; i < n; i++) { p = P[i]; if (p.k !== "pocket") { p.vx *= lam; p.vy *= lam; } }
        s.time += DT;
      }
      if (s.heatUntil && s.time > s.heatUntil) { s.target = 1; s.heatUntil = 0; }
      s.trPE.push(s.pe / n); s.trT.push(s.T);
      if (s.trPE.length > 240) { s.trPE.shift(); s.trT.shift(); }
    }
    function trace(ctx, arr, x, y, w, h, color) {
      if (arr.length < 2) return;
      var lo = Infinity, hi = -Infinity;
      arr.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      var pad = (hi - lo) * 0.2 + 1e-3; lo -= pad; hi += pad;
      ctx.beginPath();
      arr.forEach(function (v, i) {
        var px = x + (i / 239) * w, py = y + h - ((v - lo) / (hi - lo)) * h;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    }
    return {
      init: function () { init(); },
      settle: function () { for (var i = 0; i < 400; i++) step(0.016); },
      step: function (f, dt) { step(dt); },
      heat: function () { s.target = 1.5; s.heatUntil = s.time + 6; },
      draw: function (f) {
        var ctx = f.ctx, w = f.w, h = f.h, sc = Math.min(w / LX, h / LY);
        var ox = (w - LX * sc) / 2, oy = (h - LY * sc) / 2;
        ctx.clearRect(0, 0, w, h);
        var P = s.P, i, p;
        // pocket surface glow
        ctx.fillStyle = C.light ? "rgba(39,93,56,.08)" : "rgba(111,191,134,.08)";
        ctx.beginPath(); ctx.arc(ox + 16 * sc, oy + 14 * sc, 5.2 * sc, 0, Math.PI * 2); ctx.fill();
        for (i = 0; i < P.length; i++) {
          p = P[i]; if (p.k !== "sol") continue;
          ctx.fillStyle = C.solvent;
          ctx.beginPath(); ctx.arc(ox + p.x * sc, oy + p.y * sc, 0.42 * sc, 0, Math.PI * 2); ctx.fill();
        }
        for (i = 0; i < P.length; i++) {
          p = P[i]; if (p.k !== "pocket") continue;
          ctx.fillStyle = C.green;
          ctx.beginPath(); ctx.arc(ox + p.x * sc, oy + p.y * sc, 0.5 * sc, 0, Math.PI * 2); ctx.fill();
        }
        // ligand bonds (skip bonds that wrap across the periodic boundary)
        ctx.strokeStyle = C.gold; ctx.lineWidth = Math.max(2, 0.22 * sc); ctx.lineCap = "round";
        for (i = s.lig0; i < s.lig0 + 4; i++) {
          var a = P[i], b = P[i + 1];
          if (Math.abs(a.x - b.x) > LX / 2 || Math.abs(a.y - b.y) > LY / 2) continue;
          ctx.beginPath(); ctx.moveTo(ox + a.x * sc, oy + a.y * sc); ctx.lineTo(ox + b.x * sc, oy + b.y * sc); ctx.stroke();
        }
        for (i = s.lig0; i < s.lig0 + 5; i++) {
          p = P[i];
          ctx.fillStyle = C.goldSoft; ctx.beginPath(); ctx.arc(ox + p.x * sc, oy + p.y * sc, 0.9 * sc, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(ox + p.x * sc, oy + p.y * sc, 0.46 * sc, 0, Math.PI * 2); ctx.fill();
        }
        // readouts
        var px = 14, py = 14, pw = Math.min(170, w * 0.32), ph = 34;
        ctx.fillStyle = C.light ? "rgba(255,255,255,.85)" : "rgba(13,33,23,.8)";
        ctx.fillRect(px - 6, py - 6, pw + 12, ph * 2 + 34);
        label(ctx, "Potential energy", px, py + 8, C.ink2, 11);
        trace(ctx, s.trPE, px, py + 12, pw, ph - 12, C.green);
        label(ctx, "Temperature  " + Math.round(s.T * 300) + " K", px, py + ph + 18, C.ink2, 11);
        trace(ctx, s.trT, px, py + ph + 22, pw, ph - 12, C.gold);
        label(ctx, "t = " + (s.time * 2.15).toFixed(1) + " ps", w - 14, h - 14, C.ink2, 11, "right");
      }
    };
  })();

  /* =====================================================================
     Fig. 2 — reverse diffusion: noise → molecule
     ===================================================================== */
  var GEN = (function () {
    var mols = window.MOLECULES || [], mi = 0, phase = 0, t = 0, pts = [], nameEl = document.getElementById("genName");
    var DUR = [0.8, 2.8, 3.2, 0.9]; // noise, denoise, hold, dissolve
    function load() {
      var m = mols[mi];
      pts = m.atoms.map(function () { return { nx: gauss(), ny: gauss(), jx: 0, jy: 0 }; });
      if (nameEl) nameEl.textContent = "";
    }
    function alpha() { // 0 = pure noise, 1 = clean molecule
      if (phase === 0) return 0;
      if (phase === 1) return ease(clamp(t / DUR[1], 0, 1));
      if (phase === 2) return 1;
      return 1 - ease(clamp(t / DUR[3], 0, 1));
    }
    return {
      init: function () { if (mols.length) load(); },
      settle: function () { phase = 2; t = 0; if (nameEl && mols[mi]) nameEl.textContent = mols[mi].name + " · " + mols[mi].smiles; },
      step: function (f, dt) {
        if (!mols.length) return;
        t += dt;
        var jitter = 1 - alpha();
        pts.forEach(function (p) { p.nx += gauss() * 0.06 * jitter; p.ny += gauss() * 0.06 * jitter; p.nx *= 0.995; p.ny *= 0.995; });
        if (t > DUR[phase]) {
          t = 0; phase = (phase + 1) % 4;
          if (phase === 2 && nameEl) nameEl.textContent = mols[mi].name + " · " + mols[mi].smiles;
          if (phase === 0) { mi = (mi + 1) % mols.length; load(); }
        }
      },
      draw: function (f) {
        var ctx = f.ctx, w = f.w, h = f.h;
        ctx.clearRect(0, 0, w, h);
        if (!mols.length) return;
        var m = mols[mi], a = alpha();
        var xs = m.atoms.map(function (q) { return q[1]; }), ys = m.atoms.map(function (q) { return q[2]; });
        var span = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 1.6, 1);
        var sc = Math.min(w * 0.72 / span, h * 0.11);
        var cx = w / 2, cy = h / 2 - 6;
        var noiseR = Math.min(w, h) * 0.3;
        var P = m.atoms.map(function (q, i) {
          var tx = cx + q[1] * sc, ty = cy - q[2] * sc;
          var nx = cx + pts[i].nx * noiseR, ny = cy + pts[i].ny * noiseR * 0.7;
          var k = Math.sqrt(a);
          return { x: lerp(nx, tx, a), y: lerp(ny, ty, a), el: q[0], k: k };
        });
        // bonds fade in during the last part of denoising
        var ba = clamp((a - 0.55) / 0.4, 0, 1);
        if (ba > 0) {
          ctx.lineCap = "round";
          m.bonds.forEach(function (b) {
            var p = P[b[0]], q = P[b[1]];
            ctx.globalAlpha = ba;
            ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            if (b[2] !== 1) {
              var dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1, ox = -dy / L * 4, oy = dx / L * 4;
              ctx.setLineDash(b[2] === 1.5 ? [3, 3] : []);
              ctx.beginPath(); ctx.moveTo(p.x + ox + dx * 0.15, p.y + oy + dy * 0.15); ctx.lineTo(q.x + ox - dx * 0.15, q.y + oy - dy * 0.15); ctx.stroke();
              ctx.setLineDash([]);
            }
          });
          ctx.globalAlpha = 1;
        }
        P.forEach(function (p) {
          var hetero = p.el !== "C";
          var col = hetero ? (C[p.el] || C.ink) : C.ink;
          var r = lerp(4, hetero ? 9 : 3.2, a);
          ctx.fillStyle = a < 0.5 ? C.ink2 : col;
          ctx.globalAlpha = lerp(0.55, 1, a);
          if (hetero && a > 0.8) {
            ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
            label(ctx, p.el, p.x, p.y + 5, col, 14, "center", 700);
          } else {
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        });
        var stepN = Math.round((1 - a) * 1000);
        label(ctx, "denoising step  " + stepN + " / 1000", 16, 26, C.ink2, 12);
        ctx.fillStyle = C.line; ctx.fillRect(16, 34, 150, 3);
        ctx.fillStyle = C.gold; ctx.fillRect(16, 34, 150 * a, 3);
        if (a === 1) label(ctx, m.name, w - 16, h - 16, C.ink, 15, "right", 600);
      }
    };
  })();

  /* =====================================================================
     Fig. 3 — a 2-12-1 neural network learning BBB+ / BBB−
     ===================================================================== */
  var CLF = (function () {
    var H = 12, data = [], W1, b1, W2, b2, M, V, tstep, epoch, loss, acc, pause;
    var TPSA = [0, 160], LOGP = [-2, 6];
    function sample() {
      data = [];
      for (var i = 0; i < 70; i++) data.push({ tpsa: clamp(48 + gauss() * 20, 5, 150), logp: clamp(2.7 + gauss() * 1.1, -1.8, 5.8), y: 1 });
      for (i = 0; i < 70; i++) data.push({ tpsa: clamp(108 + gauss() * 26, 20, 158), logp: clamp(0.9 + gauss() * 1.5, -1.9, 5.8), y: 0 });
      data.forEach(function (d) { d.a = (d.tpsa - 80) / 80; d.b = (d.logp - 2) / 4; });
    }
    function reset() {
      sample();
      W1 = []; b1 = []; W2 = []; b2 = 0;
      for (var j = 0; j < H; j++) { W1.push([gauss() * 0.9, gauss() * 0.9]); b1.push(gauss() * 0.3); W2.push(gauss() * 0.5); }
      M = new Float64Array(H * 4 + 1); V = new Float64Array(H * 4 + 1); tstep = 0; epoch = 0; loss = 0.69; acc = 0.5; pause = 0;
    }
    function fwd(a, b, hid) {
      var z = b2;
      for (var j = 0; j < H; j++) { var hj = Math.tanh(W1[j][0] * a + W1[j][1] * b + b1[j]); if (hid) hid[j] = hj; z += W2[j] * hj; }
      return 1 / (1 + Math.exp(-z));
    }
    function train() {
      var g = new Float64Array(H * 4 + 1), hid = new Array(H), L = 0, correct = 0, n = data.length;
      data.forEach(function (d) {
        var p = fwd(d.a, d.b, hid), e = p - d.y;
        L += -(d.y ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9));
        if ((p > 0.5) === (d.y === 1)) correct++;
        g[H * 4] += e;
        for (var j = 0; j < H; j++) {
          g[j] += e * hid[j];
          var dh = e * W2[j] * (1 - hid[j] * hid[j]);
          g[H + j * 3] += dh * d.a; g[H + j * 3 + 1] += dh * d.b; g[H + j * 3 + 2] += dh;
        }
      });
      tstep++;
      var lr = 0.03, b1m = 0.9, b2m = 0.999;
      function upd(i) {
        var gi = g[i] / n; M[i] = b1m * M[i] + (1 - b1m) * gi; V[i] = b2m * V[i] + (1 - b2m) * gi * gi;
        return lr * (M[i] / (1 - Math.pow(b1m, tstep))) / (Math.sqrt(V[i] / (1 - Math.pow(b2m, tstep))) + 1e-8);
      }
      for (var j = 0; j < H; j++) {
        W2[j] -= upd(j); W1[j][0] -= upd(H + j * 3); W1[j][1] -= upd(H + j * 3 + 1); b1[j] -= upd(H + j * 3 + 2);
      }
      b2 -= upd(H * 4);
      loss = L / n; acc = correct / n; epoch++;
    }
    return {
      init: reset,
      reset: reset,
      settle: function () { for (var i = 0; i < 500; i++) train(); },
      step: function (f, dt) {
        if (epoch < 500) { for (var i = 0; i < 2; i++) train(); }
        else if ((pause += dt) > 5) reset();
      },
      draw: function (f) {
        var ctx = f.ctx, w = f.w, h = f.h;
        var L = 46, R = 16, T = 16, B = 38, pw = w - L - R, ph = h - T - B;
        ctx.clearRect(0, 0, w, h);
        var nx = 64, ny = Math.round(nx * ph / pw), cw = pw / nx, ch = ph / ny;
        var pos = C.light ? [201, 168, 0] : [242, 205, 0], neg = C.light ? [39, 93, 56] : [111, 191, 134];
        // probabilities on grid corners, so cells can be shaded and contoured
        var G = [];
        for (var gi = 0; gi <= nx; gi++) {
          G.push([]);
          for (var gj = 0; gj <= ny; gj++) {
            var tp0 = TPSA[0] + gi / nx * (TPSA[1] - TPSA[0]), lp0 = LOGP[1] - gj / ny * (LOGP[1] - LOGP[0]);
            G[gi].push(fwd((tp0 - 80) / 80, (lp0 - 2) / 4));
          }
        }
        for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
          var p = (G[i][j] + G[i + 1][j] + G[i][j + 1] + G[i + 1][j + 1]) / 4;
          var c = p > 0.5 ? pos : neg, strength = Math.abs(p - 0.5) * 2;
          var x0 = Math.floor(L + i * cw), x1 = Math.floor(L + (i + 1) * cw), y0 = Math.floor(T + j * ch), y1 = Math.floor(T + (j + 1) * ch);
          ctx.fillStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (0.07 + 0.2 * strength).toFixed(3) + ")";
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
        // decision boundary (p = 0.5) by marching squares
        ctx.beginPath();
        function cross(a, b) { return (0.5 - a) / (b - a); }
        for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) {
          var q = [G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]];
          var cx0 = L + i * cw, cy0 = T + j * ch, pts2 = [];
          if ((q[0] > 0.5) !== (q[1] > 0.5)) pts2.push([cx0 + cross(q[0], q[1]) * cw, cy0]);
          if ((q[1] > 0.5) !== (q[2] > 0.5)) pts2.push([cx0 + cw, cy0 + cross(q[1], q[2]) * ch]);
          if ((q[3] > 0.5) !== (q[2] > 0.5)) pts2.push([cx0 + cross(q[3], q[2]) * cw, cy0 + ch]);
          if ((q[0] > 0.5) !== (q[3] > 0.5)) pts2.push([cx0, cy0 + cross(q[0], q[3]) * ch]);
          if (pts2.length >= 2) { ctx.moveTo(pts2[0][0], pts2[0][1]); ctx.lineTo(pts2[1][0], pts2[1][1]); }
          if (pts2.length === 4) { ctx.moveTo(pts2[2][0], pts2[2][1]); ctx.lineTo(pts2[3][0], pts2[3][1]); }
        }
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
        data.forEach(function (d) {
          var x = L + (d.tpsa - TPSA[0]) / (TPSA[1] - TPSA[0]) * pw, y = T + (LOGP[1] - d.logp) / (LOGP[1] - LOGP[0]) * ph;
          ctx.beginPath();
          if (d.y) { ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill(); }
          else { ctx.rect(x - 3.5, y - 3.5, 7, 7); ctx.fillStyle = C.green; ctx.fill(); }
          ctx.strokeStyle = C.bg; ctx.lineWidth = 1; ctx.stroke();
        });
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
        label(ctx, "Topological polar surface area (Å²)", L + pw / 2, h - 10, C.ink2, 11, "center");
        [0, 40, 80, 120, 160].forEach(function (v) { label(ctx, String(v), L + v / 160 * pw, T + ph + 14, C.ink2, 10, "center"); });
        [-2, 0, 2, 4, 6].forEach(function (v) { label(ctx, String(v), L - 8, T + (6 - v) / 8 * ph + 4, C.ink2, 10, "right"); });
        ctx.save(); ctx.translate(14, T + ph / 2); ctx.rotate(-Math.PI / 2); label(ctx, "logP", 0, 0, C.ink2, 11, "center"); ctx.restore();
        var bx = L + pw - 150, by = T + 10;
        ctx.fillStyle = C.light ? "rgba(255,255,255,.88)" : "rgba(13,33,23,.82)"; ctx.fillRect(bx, by, 140, 62);
        label(ctx, "epoch " + Math.min(epoch, 500), bx + 10, by + 18, C.ink, 12, "left", 600);
        label(ctx, "loss " + loss.toFixed(3) + "   acc " + Math.round(acc * 100) + "%", bx + 10, by + 34, C.ink2, 11);
        ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(bx + 14, by + 49, 4, 0, 7); ctx.fill();
        label(ctx, "BBB+", bx + 22, by + 53, C.ink2, 11);
        ctx.fillStyle = C.green; ctx.fillRect(bx + 66, by + 45.5, 7, 7);
        label(ctx, "BBB−", bx + 78, by + 53, C.ink2, 11);
      }
    };
  })();

  /* =====================================================================
     Fig. 4 — multi-omics evidence converging on targets in a PPI network
     ===================================================================== */
  var OMX = (function () {
    var nodes = [], edges = [], pulses = [], t = 0, cycle = 9, sources, top = [];
    function build() {
      nodes = []; edges = []; pulses = []; t = 0; top = [];
      // jittered grid keeps the network evenly spread
      var cols = 7, rows = 5, i;
      for (var gx = 0; gx < cols; gx++) for (var gy = 0; gy < rows; gy++) {
        if (rand() < 0.12) continue;
        nodes.push({ x: 0.42 + (gx + 0.5 + (rand() - 0.5) * 0.7) / cols * 0.54, y: 0.08 + (gy + 0.5 + (rand() - 0.5) * 0.7) / rows * 0.84, s: 0, w: 0.4 + rand() * 1.4 });
      }
      var n = nodes.length;
      for (i = 0; i < n; i++) {
        var d = nodes.map(function (q, k) { return { k: k, d: Math.hypot(q.x - nodes[i].x, q.y - nodes[i].y) }; }).sort(function (a, b) { return a.d - b.d; });
        for (var m = 1; m <= 2 + (rand() < 0.4 ? 1 : 0); m++) if (d[m].d < 0.28) edges.push([i, d[m].k]);
      }
      sources = [{ name: "Genomics", y: 0.24 }, { name: "Transcriptomics", y: 0.5 }, { name: "Proteomics", y: 0.76 }];
    }
    return {
      init: build,
      settle: function () { for (var i = 0; i < 480; i++) this.step(null, 1 / 60); },
      step: function (f, dt) {
        t += dt;
        if (t < cycle - 2.5 && rand() < dt * 9) {
          var s = Math.floor(rand() * 3), target = Math.floor(rand() * nodes.length);
          pulses.push({ from: null, s: s, to: target, p: 0, amt: nodes[target].w, hop: 0 });
        }
        pulses.forEach(function (p) {
          p.p += dt * (p.from === null ? 0.9 : 2.2);
          if (p.p >= 1 && !p.done) {
            p.done = true;
            var nd = nodes[p.to]; nd.s += p.amt;
            if (p.hop < 2) edges.forEach(function (e) {
              var nb = e[0] === p.to ? e[1] : e[1] === p.to ? e[0] : -1;
              if (nb >= 0 && rand() < 0.5) pulses.push({ from: p.to, to: nb, p: 0, amt: p.amt * 0.45, hop: p.hop + 1 });
            });
          }
        });
        pulses = pulses.filter(function (p) { return !p.done; });
        if (t > cycle - 2.5 && !top.length) top = nodes.map(function (n, i) { return i; }).sort(function (a, b) { return nodes[b].s - nodes[a].s; }).slice(0, 3);
        if (t > cycle) { build(); }
      },
      draw: function (f) {
        var ctx = f.ctx, w = f.w, h = f.h;
        ctx.clearRect(0, 0, w, h);
        var maxS = Math.max.apply(null, nodes.map(function (n) { return n.s; }).concat([1]));
        ctx.strokeStyle = C.line; ctx.lineWidth = 1.2;
        edges.forEach(function (e) { var a = nodes[e[0]], b = nodes[e[1]]; ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke(); });
        var sx = 0.13 * w;
        sources.forEach(function (s, i) {
          var col = [C.N, C.green, C.O][i];
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, s.y * h, 7, 0, Math.PI * 2); ctx.fill();
          label(ctx, s.name, sx, s.y * h + 24, C.ink2, 11, "center");
        });
        pulses.forEach(function (p) {
          var ax, ay, col;
          if (p.from === null) { ax = sx; ay = sources[p.s].y * h; col = [C.N, C.green, C.O][p.s]; }
          else { ax = nodes[p.from].x * w; ay = nodes[p.from].y * h; col = C.gold; }
          var b = nodes[p.to], x = lerp(ax, b.x * w, p.p), y = lerp(ay, b.y * h, p.p);
          ctx.fillStyle = col; ctx.globalAlpha = p.from === null ? 0.9 : 0.6;
          ctx.beginPath(); ctx.arc(x, y, p.from === null ? 2.6 : 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        });
        nodes.forEach(function (n, i) {
          var r = 3.5 + 7 * Math.sqrt(n.s / maxS);
          var isTop = top.indexOf(i) >= 0;
          ctx.fillStyle = isTop ? C.gold : C.green;
          ctx.globalAlpha = isTop ? 1 : 0.35 + 0.65 * (n.s / maxS);
          ctx.beginPath(); ctx.arc(n.x * w, n.y * h, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          if (isTop) {
            ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(n.x * w, n.y * h, r + 6 + 2 * Math.sin(t * 4), 0, Math.PI * 2); ctx.stroke();
          }
        });
        // target labels on top, flipped left near the right edge
        top.forEach(function (i, rank) {
          var n = nodes[i], txt = "target " + (rank + 1), left = n.x > 0.82;
          ctx.font = "600 11px 'Public Sans', system-ui, sans-serif";
          var tw = ctx.measureText(txt).width, x = left ? n.x * w - 18 - tw : n.x * w + 18, y = n.y * h - 16;
          ctx.fillStyle = C.bg; ctx.fillRect(x - 4, y - 11, tw + 8, 16);
          label(ctx, txt, x, y + 1, C.ink, 11, "left", 600);
        });
      }
    };
  })();

  /* =====================================================================
     Blood–brain barrier permeation (Tools section)
     ===================================================================== */
  var BBB = (function () {
    var mols = [], rbcs = [], crossed = 0, blocked = 0, t = 0;
    var Y1 = 0.36, Y2 = 0.56; // barrier band as fraction of height
    function spawn(x) {
      var lipo = rand() < 0.5;
      return { x: x !== undefined ? x : -0.03, y: 0.06 + rand() * 0.24, vx: 0.05 + rand() * 0.05, vy: 0, lipo: lipo, state: "blood", r: lipo ? 4 : 6, rot: rand() * 6, flash: 0 };
    }
    return {
      init: function () {
        for (var i = 0; i < 14; i++) mols.push(spawn(rand()));
        for (i = 0; i < 12; i++) rbcs.push({ x: rand(), y: 0.05 + rand() * 0.26, v: 0.04 + rand() * 0.03, a: rand() * 6 });
      },
      settle: function () { for (var i = 0; i < 600; i++) this.step(null, 1 / 60); },
      step: function (f, dt) {
        t += dt;
        rbcs.forEach(function (r) { r.x += r.v * dt; r.a += dt * 0.6; if (r.x > 1.05) { r.x = -0.05; r.y = 0.05 + rand() * 0.26; } });
        mols.forEach(function (m) {
          m.rot += dt * (m.lipo ? 1.4 : 0.8);
          if (m.state === "blood") {
            m.x += m.vx * dt;
            if (rand() < dt * 0.35 && m.x > 0.08 && m.x < 0.9) { m.state = "dive"; m.vy = 0.12; }
          } else if (m.state === "dive") {
            m.y += m.vy * dt; m.x += m.vx * 0.3 * dt;
            if (m.y > Y1 - 0.02) {
              if (m.lipo) { m.state = "cross"; m.vy = 0.05; }
              else { m.state = "bounce"; m.vy = -0.16; m.flash = 1; blocked++; }
            }
          } else if (m.state === "cross") {
            m.y += m.vy * dt;
            if (m.y > Y2 + 0.02) { m.state = "brain"; m.vy = 0.05; crossed++; m.flash = 1; }
          } else if (m.state === "bounce") {
            m.y += m.vy * dt; m.x += m.vx * dt; m.vy *= 0.985;
            if (m.y < 0.2) { m.state = "blood"; }
          } else if (m.state === "brain") {
            m.y += m.vy * dt; m.x += (rand() - 0.5) * 0.02 * dt; m.vy *= 0.99; m.fade = (m.fade || 1) - dt * 0.25;
          }
          m.flash = Math.max(0, m.flash - dt * 1.5);
        });
        mols = mols.filter(function (m) { return m.x < 1.05 && !(m.fade !== undefined && m.fade <= 0); });
        while (mols.length < 14) mols.push(spawn());
      },
      draw: function (f) {
        var ctx = f.ctx, w = f.w, h = f.h;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = C.blood; ctx.fillRect(0, 0, w, Y1 * h);
        ctx.fillStyle = C.brain; ctx.fillRect(0, Y2 * h, w, h - Y2 * h);
        // neurons in the brain compartment
        ctx.strokeStyle = C.light ? "rgba(39,93,56,.16)" : "rgba(111,191,134,.14)"; ctx.lineWidth = 1.2;
        for (var i = 0; i < 7; i++) {
          var nx = (i + 0.5) / 7 * w, ny = (0.76 + 0.1 * Math.sin(i * 2.3)) * h;
          for (var k = 0; k < 5; k++) { var an = k * 1.25 + i; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.quadraticCurveTo(nx + Math.cos(an) * 30, ny + Math.sin(an) * 18, nx + Math.cos(an + .4) * 60, ny + Math.sin(an + .4) * 34); ctx.stroke(); }
          ctx.fillStyle = C.light ? "rgba(39,93,56,.22)" : "rgba(111,191,134,.2)"; ctx.beginPath(); ctx.arc(nx, ny, 6, 0, 7); ctx.fill();
        }
        rbcs.forEach(function (r) {
          ctx.save(); ctx.translate(r.x * w, r.y * h); ctx.rotate(r.a); ctx.fillStyle = C.rbc;
          ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        });
        // endothelial cells with tight junctions
        var cells = Math.max(5, Math.round(w / 120)), cw = w / cells;
        for (i = 0; i < cells; i++) {
          ctx.fillStyle = C.light ? "#8FB89A" : "#275D38";
          var x0 = i * cw + 3, y0 = Y1 * h, ch = (Y2 - Y1) * h;
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, cw - 6, ch, 12) : ctx.rect(x0, y0, cw - 6, ch); ctx.fill();
          ctx.fillStyle = C.light ? "rgba(16,40,26,.25)" : "rgba(233,240,234,.18)";
          ctx.beginPath(); ctx.ellipse(x0 + cw / 2, y0 + ch / 2, cw * 0.16, ch * 0.2, 0, 0, 7); ctx.fill();
          if (i > 0) for (var j = 0; j < 3; j++) { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(i * cw, y0 + ch * (0.25 + j * 0.25), 2.2, 0, 7); ctx.fill(); }
        }
        var k = clamp(w / 640, 0.8, 1.8);
        mols.forEach(function (m) {
          var x = m.x * w, y = m.y * h;
          ctx.save(); ctx.translate(x, y); ctx.rotate(m.rot); ctx.scale(k, k);
          ctx.globalAlpha = m.fade !== undefined ? clamp(m.fade, 0, 1) : 1;
          ctx.beginPath();
          for (var k = 0; k < 6; k++) { var a = k * Math.PI / 3; ctx[k ? "lineTo" : "moveTo"](Math.cos(a) * m.r, Math.sin(a) * m.r); }
          ctx.closePath();
          ctx.fillStyle = m.lipo ? C.gold : (C.light ? "#6E86A8" : "#9FB6D6"); ctx.fill();
          if (!m.lipo) { // polar groups
            ctx.fillStyle = C.O;
            ctx.beginPath(); ctx.arc(m.r + 3, 0, 2.6, 0, 7); ctx.fill();
            ctx.beginPath(); ctx.arc(-m.r - 3, 0, 2.6, 0, 7); ctx.fill();
          }
          ctx.restore(); ctx.globalAlpha = 1;
          if (m.flash > 0) {
            ctx.strokeStyle = m.lipo ? C.gold : C.O; ctx.globalAlpha = m.flash; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(x, y, (m.r + 12 * (1 - m.flash) + 4) * k, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
          }
        });
        var sm = w < 520;
        label(ctx, "Blood", 12, 20, C.ink, sm ? 11 : 12, "left", 600);
        label(ctx, "Brain", 12, h - 12, C.ink, sm ? 11 : 12, "left", 600);
        var bx = w - 12;
        label(ctx, "crossed " + crossed + "   blocked " + blocked, bx, 20, C.ink, sm ? 11 : 12, "right", 600);
        if (!sm) {
          label(ctx, "polar, blocked", bx, h - 12, C.ink2, 11, "right");
          var pw1 = ctx.measureText("polar, blocked").width;
          ctx.fillStyle = C.light ? "#6E86A8" : "#9FB6D6"; ctx.beginPath(); ctx.arc(bx - pw1 - 10, h - 16, 4.5, 0, 7); ctx.fill();
          label(ctx, "lipophilic, crosses", bx - pw1 - 26, h - 12, C.ink2, 11, "right");
          var pw2 = ctx.measureText("lipophilic, crosses").width;
          ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(bx - pw1 - pw2 - 36, h - 16, 4.5, 0, 7); ctx.fill();
        }
      }
    };
  })();

  /* ---- mount ---- */
  function mount(id, impl) { var c = document.getElementById(id); return c ? Figure(c, impl) : null; }
  mount("figMD", MD);
  mount("figGen", GEN);
  mount("figClf", CLF);
  mount("figOmics", OMX);
  mount("figBBB", BBB);

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action]");
    if (!b) return;
    if (b.dataset.action === "md-heat") { MD.heat(); b.textContent = "Heating… watch the temperature trace"; setTimeout(function () { b.textContent = "Heat to 450 K"; }, 6000); }
    if (b.dataset.action === "clf-reset") { CLF.reset(); figures.forEach(function (f) { f.redraw(); }); }
  });

  // hero fallback: rotating ball-and-stick carazolol, used if 3Dmol cannot load
  window.drawHeroFallback = function (canvas) {
    var m = (window.MOLECULES || []).filter(function (x) { return x.name === "Carazolol"; })[0];
    if (!m) return;
    var ctx = canvas.getContext("2d"), ang = 0;
    function frame() {
      if (!canvas.isConnected || canvas.offsetParent === null) return;
      var r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var w = r.width, h = r.height, sc = w / 16;
      ctx.clearRect(0, 0, w, h);
      var P = m.atoms.map(function (a) { var x = a[1] * Math.cos(ang), z = a[1] * Math.sin(ang); return { x: w / 2 + x * sc, y: h / 2 - a[2] * sc, z: z, el: a[0] }; });
      ctx.strokeStyle = C.ink2; ctx.lineWidth = 2;
      m.bonds.forEach(function (b) { ctx.beginPath(); ctx.moveTo(P[b[0]].x, P[b[0]].y); ctx.lineTo(P[b[1]].x, P[b[1]].y); ctx.stroke(); });
      P.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (p) {
        ctx.fillStyle = p.el === "C" ? C.gold : (C[p.el] || C.ink);
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 + p.z * 0.6, 0, 7); ctx.fill();
      });
      if (!reduceMotion) { ang += 0.01; requestAnimationFrame(frame); }
    }
    frame();
  };
})();
