(function () {
  "use strict";
  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---- theme ---- */
  var themeBtn = document.getElementById("themeBtn");
  function syncThemeLabel() {
    themeBtn.setAttribute("aria-label", root.dataset.theme === "light" ? "Switch to dark theme" : "Switch to light theme");
  }
  syncThemeLabel();
  themeBtn.addEventListener("click", function () {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
    syncThemeLabel();
    document.dispatchEvent(new Event("themechange"));
  });

  /* ---- nav ---- */
  var nav = document.querySelector(".nav"), menuBtn = document.querySelector(".menu-btn"), links = document.getElementById("nav-links");
  window.addEventListener("scroll", function () { nav.classList.toggle("scrolled", window.scrollY > 8); }, { passive: true });
  menuBtn.addEventListener("click", function () {
    var open = links.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", open);
  });
  links.addEventListener("click", function (e) { if (e.target.tagName === "A") { links.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); } });
  var navLinks = Array.prototype.slice.call(links.querySelectorAll("a"));
  var spy = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      navLinks.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id); });
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s) spy.observe(s); });

  /* ---- hero counters: one orchestrated count-up on load ---- */
  if (!reduceMotion) {
    var dds = document.querySelectorAll(".hero-facts dd[data-count]");
    var t0 = performance.now(), D = 1600;
    (function tick(now) {
      var p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
      dds.forEach(function (dd) {
        var v = Math.round(+dd.dataset.count * e);
        dd.textContent = v.toLocaleString("en-US") + (p === 1 ? (dd.dataset.suffix || "") : "");
      });
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* ---- publications ---- */
  var pubs = window.PUBS || [];
  var list = document.getElementById("pubList"), empty = document.getElementById("pubEmpty"), search = document.getElementById("pubSearch");
  var filter = "all";
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function render() {
    var q = search.value.trim().toLowerCase();
    var shown = pubs.filter(function (p) {
      if (filter !== "all" && p.tags.indexOf(filter) < 0) return false;
      if (q && (p.t + " " + p.j + " " + p.a + " " + p.y).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    list.innerHTML = shown.map(function (p) {
      var authors = esc(p.a).replace("Shaker, B.", "<b>Shaker, B.</b>");
      var title = p.doi ? '<a class="pub-title" href="https://doi.org/' + esc(p.doi) + '" target="_blank" rel="noopener">' + esc(p.t) + "</a>" : '<span class="pub-title">' + esc(p.t) + "</span>";
      var badge = p.star ? '<span class="pub-badge">Highly cited</span>' : "";
      if (p.t.indexOf("LightBBB") === 0 || p.t.indexOf("(LogBB_Pred)") > 0) badge = '<span class="pub-badge">Web server</span>';
      return '<li class="pub"><span class="pub-year">' + p.y + "</span><div>" + title + badge +
        '<p class="pub-auth">' + authors + '</p><p class="pub-venue"><em>' + esc(p.j) + "</em> " + esc(p.v) + (p.if ? " · IF " + p.if : "") + "</p></div>" +
        '<div class="pub-cites"><strong>' + p.c + "</strong><span>citations</span></div></li>";
    }).join("");
    empty.hidden = shown.length > 0;
  }
  document.querySelectorAll(".chip").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.filter;
      document.querySelectorAll(".chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      render();
    });
  });
  search.addEventListener("input", render);
  render();

  /* ---- citations chart: one bar per paper, oldest to newest ---- */
  var chart = document.getElementById("citeChart");
  var sorted = pubs.slice().sort(function (a, b) { return a.y - b.y; });
  var maxC = Math.max.apply(null, sorted.map(function (p) { return p.c; }));
  var tip = document.createElement("div"); tip.className = "cite-tip"; chart.appendChild(tip);
  var lastYear = null;
  sorted.forEach(function (p) {
    var bar = document.createElement("button");
    bar.className = "bar" + (p.tags.indexOf("first") >= 0 ? " first" : "");
    bar.setAttribute("aria-label", p.t + ", " + p.y + ": " + p.c + " citations");
    // square-root scale keeps the 760-citation review from flattening everything else
    bar.dataset.h = Math.max(2, Math.sqrt(p.c / maxC) * 100);
    if (p.y !== lastYear) { if (lastYear !== null) bar.classList.add("ystart"); var yl = document.createElement("span"); yl.className = "yr-label"; yl.innerHTML = '<span class="yl-full">' + p.y + '</span><span class="yl-short">’' + String(p.y).slice(2) + "</span>"; bar.appendChild(yl); lastYear = p.y; }
    function show() {
      tip.innerHTML = "<strong>" + p.c + " citations</strong><br>" + esc(p.t.length > 90 ? p.t.slice(0, 88) + "…" : p.t);
      var r = bar.getBoundingClientRect(), cr = chart.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(r.left - cr.left + r.width / 2, 140), cr.width - 140) + "px";
      tip.style.top = (r.top - cr.top - 8) + "px";
      tip.style.opacity = 1;
    }
    bar.addEventListener("mouseenter", show); bar.addEventListener("focus", show);
    bar.addEventListener("mouseleave", function () { tip.style.opacity = 0; }); bar.addEventListener("blur", function () { tip.style.opacity = 0; });
    bar.addEventListener("click", function () {
      search.value = p.t.split(" ").slice(0, 5).join(" ");
      render();
      document.getElementById("pubList").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
    chart.appendChild(bar);
  });
  var legend = document.createElement("div"); legend.className = "cite-legend";
  legend.innerHTML = '<span><i style="background:var(--ua-gold)"></i>First author</span><span><i style="background:#3C7E51"></i>Co-author</span><span>Bar height on a square-root scale · click a bar to find the paper</span>';
  chart.after(legend);
  new IntersectionObserver(function (es, obs) {
    if (!es[0].isIntersecting) return;
    chart.querySelectorAll(".bar").forEach(function (b) { b.style.height = b.dataset.h + "%"; });
    obs.disconnect();
  }, { threshold: 0.3 }).observe(chart);

  /* ---- hero: 3D GPCR with 3Dmol.js, falling back to a 2D rotating ligand ---- */
  var viewerEl = document.getElementById("viewer");
  function fallback() { if (window.drawHeroFallback) window.drawHeroFallback(document.getElementById("viewerFallback")); }
  function styleViewer(v) {
    var light = root.dataset.theme === "light";
    var cartoon = light ? "#275D38" : "#6FBF86";
    v.setStyle({}, { cartoon: { color: cartoon, opacity: 0.92, thickness: 0.35 } });
    v.setStyle({ within: { distance: 4.5, sel: { resn: "CAU" } }, not: { resn: "CAU" } },
      { cartoon: { color: cartoon, opacity: 0.92 }, stick: { radius: 0.12, colorscheme: light ? "greenCarbon" : "whiteCarbon" } });
    v.setStyle({ resn: "CAU" }, { stick: { radius: 0.28, colorscheme: { prop: "elem", map: { C: "#F2CD00", N: "#6F9CFF", O: "#FF6B57" } } }, sphere: { scale: 0.28, colorscheme: { prop: "elem", map: { C: "#F2CD00", N: "#6F9CFF", O: "#FF6B57" } } } });
    v.render();
  }
  // keep page scrolling working over the viewer: block wheel zoom and touch rotation
  ["wheel", "touchstart", "touchmove", "touchend"].forEach(function (t) {
    viewerEl.addEventListener(t, function (e) { e.stopPropagation(); }, { capture: true, passive: true });
  });
  function initViewer() {
    if (!window.$3Dmol) { fallback(); return; }
    fetch("assets/2rh1_receptor.pdb").then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (pdb) {
      var v = $3Dmol.createViewer(viewerEl, { backgroundAlpha: 0, antialias: true, id: "gpcr" });
      v.addModel(pdb, "pdb");
      styleViewer(v);
      v.zoomTo();
      v.rotate(-90, "x");
      v.zoom(1.15);
      v.render();
      viewerEl.classList.add("loaded");
      document.addEventListener("themechange", function () { styleViewer(v); });
      if (!reduceMotion) {
        var spinning = false;
        new IntersectionObserver(function (es) {
          var vis = es[0].isIntersecting;
          if (vis !== spinning) { v.spin(vis ? "y" : false, 0.5); spinning = vis; }
        }).observe(viewerEl);
      }
      window.addEventListener("resize", function () { v.resize(); });
    }).catch(fallback);
  }
  if (document.readyState === "complete") initViewer(); else window.addEventListener("load", initViewer);
})();
