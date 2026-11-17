// ASCII koi pond in the hero.
//
// - Water: evenly scattered `-` / `~` glyphs drifting and shimmering across
//   the whole hero, plus ripple rings when feed lands or a koi eats.
// - Koi: each one chases an invisible target that wanders between open spots
//   (mostly on the right). The body is a follow-the-leader spine with a
//   carangiform swim wave (head barely sways, tail does the work), burst-and-
//   glide speed, paddling pectoral fins and a trailing forked tail. It is
//   rasterised every frame onto a grid of square tiles with ASCII glyphs.
// - Feed: click open water and a handful of pellets scatters out from the
//   click, bobbing with shadows; koi nose over and gulp them one at a time.
// - Text is sacred: heads steer around every text block, spine points are
//   pushed out of them, and no tile, glyph or ripple is ever drawn over one.
//
// Size and count scale with the window, down to phone widths.

// Real koi colours.
const WHITE = "#efebe3", RED = "#e5432b", ORANGE = "#f2711c", BLACK = "#1f1d1d";

const VARIETIES = [
  { name: "kohaku", base: WHITE, patch: RED, fin: WHITE },
  { name: "ogon", base: ORANGE, patch: "#f58d45", fin: "#f7a868", solid: true },
  { name: "sanke", base: WHITE, patch: RED, spot: BLACK, fin: WHITE },
  { name: "showa", base: BLACK, patch: RED, spot: WHITE, fin: "#5b5551", dark: { base: "#57534e" } },
  { name: "tancho", base: WHITE, patch: RED, fin: WHITE, tancho: true },
  { name: "benigoi", base: "#e8562a", patch: "#d9401f", fin: "#f4b49a" },
];

function initPond(hero) {
  // Options. The homepage uses the defaults; the local demo page (koi-demo.html)
  // passes some in via data-koi and flips the rest live with hero.koiPond.set().
  const opt = {
    header: true, // leave room for the fixed site header at the top
    vivid: false, // richer, more saturated koi colours
    cell: 0, // tile size override in px (0 = automatic)
    ascii: true, // characters on the koi
    water: true, // tilde water
    count: 0, // number of koi override (0 = automatic, -1 = none)
    speed: 1, // simulation speed
    ripples: true, // moving the cursor over the water leaves rings
    ...JSON.parse(hero.dataset.koi || "{}"),
  };
  // ---- tunables -----------------------------------------------------------
  // square tile size, px. Set in resize(): smaller windows get smaller tiles so a
  // koi keeps the same number of tiles (the same detail) even as it shrinks.
  let CELL = 6;
  let GLYPH_PX = 6;
  const TOTAL = 1.42; // spine length incl. tail fin, in body lengths
  const N = 28; // spine segments
  const CLEAR = 14; // minimum gap kept between a koi and any text
  let TOP_BOUND = opt.header ? 90 : 12; // stay below the fixed site header
  const BODY_GLYPHS = " .:-=+";
  const MAX_PELLETS = 160;

  const canvas = document.createElement("canvas");
  canvas.className = "koi-canvas";
  canvas.setAttribute("aria-hidden", "true");
  hero.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const waterLayer = document.createElement("canvas"); // redrawn ~12x/s, reused between frames
  const wctx = waterLayer.getContext("2d");
  let waterDirty = true, waterAge = 1, waterDark = null;
  // Koi tiles: one pixel per tile in a tiny image, scaled up in a single draw
  // and cut into squares with a repeating gap pattern. Far cheaper than
  // thousands of fillRect calls with a colour/opacity change each.
  const tileCanvas = document.createElement("canvas");
  const tctx = tileCanvas.getContext("2d");
  const koiLayer = document.createElement("canvas");
  const kctx = koiLayer.getContext("2d");
  let tileImg = null, tileBuf = null, gapPattern = null;

  // Feeding affordance: a small "click to feed" label beside the cursor over
  // open water, shown only until the first feed. The pointer cursor over open
  // water stays after that.
  const label = document.createElement("div");
  label.className = "koi-cursor-label";
  label.setAttribute("aria-hidden", "true");
  label.innerHTML = '<span class="koi-pellet"></span> click to feed';
  hero.append(label);

  const FED_KEY = "koi-fed-count";
  let fedMemo = null;
  function fedCount() {
    if (fedMemo !== null) return fedMemo;
    try { fedMemo = Number(localStorage.getItem(FED_KEY)) || 0; } catch { fedMemo = 0; }
    return fedMemo;
  }
  function noteFed() {
    fedMemo = fedCount() + 1;
    try { localStorage.setItem(FED_KEY, String(fedMemo)); } catch { /* private mode etc. */ }
    label.classList.remove("is-on"); // one feed and the hint is gone for good
  }
  function onHover(e) {
    const spot = feedSpot(e);
    hero.style.cursor = spot ? "pointer" : "";
    if (spot && fedCount() === 0) {
      label.style.transform = `translate(${spot.x + 16}px, ${spot.y + 14}px)`;
      label.classList.add("is-on");
    } else {
      label.classList.remove("is-on");
    }
  }

  // Cursor ripples: moving over open water leaves a trail of small rings,
  // bigger the faster the cursor moves.
  let rx = null, ry = null, rt = 0;
  function onRippleMove(e) {
    if (!opt.ripples || !active) return;
    const hr = hero.getBoundingClientRect();
    const x = e.clientX - hr.left, y = e.clientY - hr.top;
    const now = performance.now();
    const d = rx === null ? 0 : Math.hypot(x - rx, y - ry);
    if (rx !== null && d < 26 * S && now - rt < 600) return;
    if (rx !== null && now - rt > 45 && clearance(x, y, obstacles) > 12) {
      const fast = Math.min(1, d / (90 * S));
      ripples.push({ x, y, age: 0, life: 0.9 + 0.4 * fast, maxR: (16 + 18 * fast) * S, a: 0.45 });
    }
    rx = x; ry = y; rt = now;
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let S = 1; // size scale for the current window
  let K = 1; // browser zoom-out factor (1 at 100%, 2 at 50%)
  let VW = 0; // window width as it looks on screen (W / K)
  let obstacles = []; // text rects, hero-local coords
  let walls = []; // obstacles + out-of-bounds slabs (physics only)
  let blocked = new Uint8Array(0); // per-tile: 1 = touches text
  let deep = new Float32Array(0); // per-tile: 0 open water .. 1 under the text
  let layoutSig = "";
  let edgeRow = new Float32Array(0); // per-row fade near the top and bottom edges
  let koi = [], pellets = [], ripples = [], bubbles = [], waterDots = [];
  const extras = []; // optional add-ons (demo pages): { update, drawUnder, drawOver }
  let time = 0;
  let running = false, visible = true, raf = 0, last = 0, active = false;
  let varietyCursor = Math.floor(Math.random() * VARIETIES.length);

  // size-dependent geometry
  let KS = 1; // size of the koi currently being simulated/drawn (each koi differs)
  const bodyLen = () => 215 * S * KS;
  const maxR = () => 29 * S * KS;
  const seg = () => (bodyLen() * TOTAL) / N;

  // ---- helpers ------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixA = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const cssCache = new Map();
  const css = (a) => {
    const r = a[0] & 0xfe, g = a[1] & 0xfe, b = a[2] & 0xfe; // 2-step quantise
    const key = (r << 16) | (g << 8) | b;
    let v = cssCache.get(key);
    if (!v) {
      if (cssCache.size > 4096) cssCache.clear();
      v = `rgb(${r},${g},${b})`;
      cssCache.set(key, v);
    }
    return v;
  };
  const lum = (a) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) / 255;

  function rectDist(px, py, r) {
    const dx = Math.max(r.x0 - px, 0, px - r.x1);
    const dy = Math.max(r.y0 - py, 0, py - r.y1);
    return Math.hypot(dx, dy);
  }

  function clearance(px, py, list = walls) {
    let m = Infinity;
    for (const r of list) m = Math.min(m, rectDist(px, py, r));
    return m;
  }

  // Push a point so it sits at least `need` px outside every rect.
  function pushOut(p, need) {
    for (const r of walls) {
      const cx = clamp(p.x, r.x0, r.x1);
      const cy = clamp(p.y, r.y0, r.y1);
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= need) continue;
      if (d > 0.001) {
        p.x = cx + (dx / d) * need;
        p.y = cy + (dy / d) * need;
      } else {
        const opts = [
          [p.x - r.x0, -1, 0], [r.x1 - p.x, 1, 0],
          [p.y - r.y0, 0, -1], [r.y1 - p.y, 0, 1],
        ].sort((a, b) => a[0] - b[0]);
        const [, ex, ey] = opts[0];
        if (ex) p.x = (ex < 0 ? r.x0 : r.x1) + ex * need;
        else p.y = (ey < 0 ? r.y0 : r.y1) + ey * need;
      }
    }
  }

  function lineOfSight(a, b, need) {
    const d = dist(a, b);
    const steps = Math.max(1, Math.ceil(d / 10));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (clearance(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) < need) return false;
    }
    return true;
  }

  const isBlocked = (col, row) =>
    col < 0 || row < 0 || col >= cols || row >= rows || blocked[row * cols + col] === 1;

  // ---- body shape ---------------------------------------------------------
  // s: 0 at the snout, 1 at the base of the tail fin.
  function bodyR(s) {
    const R = maxR();
    if (s < 0.22) return R * (0.5 + 0.5 * Math.sin((s / 0.22) * Math.PI / 2)); // blunt head
    return R * (1 - 0.74 * Math.pow((s - 0.22) / 0.78, 1.7)); // long taper to a sturdy tail root
  }

  const waveEnv = (s) => 0.12 + 0.88 * Math.min(s, 1.3) ** 2; // head steady, tail swings

  // Half-width the physics keeps clear around each spine point (fins included).
  function envelope(s) {
    const R = maxR();
    const fins = s < 0.5 ? R * 1.3 : s <= 1 ? R * 0.6 : R * 1.25;
    return Math.max(s <= 1 ? bodyR(s) : 0, fins) + 9 * S * waveEnv(s) + CLEAR;
  }

  const roomNeed = () => 115 * S;

  // ---- koi ----------------------------------------------------------------
  // Patterns are a few large, fairly clean-edged patches, like real koi.
  function makePattern(v) {
    const patches = [], spots = [];
    if (v.tancho) {
      patches.push([0.09, 0, 0.055, 0.55]); // single round mark on the head
    } else if (!v.solid) {
      patches.push([rand(0.05, 0.11), rand(-0.15, 0.15), rand(0.06, 0.09), rand(0.8, 1.2)]);
      let s = rand(0.24, 0.3);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && s < 0.85; i++) {
        const rs = rand(0.08, 0.13);
        patches.push([s + rs * 0.6, rand(-0.3, 0.3), rs, rand(0.85, 1.4)]);
        s += rs * 2 + rand(0.03, 0.09);
      }
    }
    if (v.spot === BLACK) {
      const m = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < m; i++) spots.push([rand(0.3, 0.85), rand(-0.75, 0.75), rand(0.025, 0.04), rand(0.2, 0.35)]);
    } else if (v.spot) {
      // showa: broad white areas
      for (let i = 0; i < 2; i++) spots.push([rand(0.3, 0.8), rand(-0.5, 0.5), rand(0.06, 0.09), rand(0.5, 0.8)]);
    }
    return { patches, spots, wa: rand(0, 6), wb: rand(0, 6) };
  }

  // < 0 inside a patch, > 0 outside; near 0 is the patch edge
  function blobField(blobs, s, t, pat) {
    const wobble = 0.1 * Math.sin(s * 37 + t * 4 + pat.wa) + 0.06 * Math.sin(s * 15 - t * 7 + pat.wb);
    let f = Infinity;
    for (const [s0, t0, rs, rt] of blobs) f = Math.min(f, ((s - s0) / rs) ** 2 + ((t - t0) / rt) ** 2 - 1 - wobble);
    return f;
  }

  function inBlobs(blobs, s, t, pat) {
    const wobble = 0.1 * Math.sin(s * 37 + t * 4 + pat.wa) + 0.06 * Math.sin(s * 15 - t * 7 + pat.wb);
    for (const [s0, t0, rs, rt] of blobs) {
      if (((s - s0) / rs) ** 2 + ((t - t0) / rt) ** 2 < 1 + wobble) return true;
    }
    return false;
  }

  // `heading` is the way the koi faces at birth; its body trails out behind
  // that with a slight random curl, so a fresh pond isn't a row of identical
  // straight fish all pointing the same way.
  function newKoi(at, heading = rand(-Math.PI, Math.PI)) {
    const v = VARIETIES[varietyCursor++ % VARIETIES.length];
    const size = rand(0.82, 1.12);
    KS = size;
    const k = {
      v, pat: makePattern(v),
      spine: [], target: { x: at.x + Math.cos(heading) * 40, y: at.y + Math.sin(heading) * 40 }, waypoint: null,
      heading, speed: rand(22, 40) * S, beat: rand(0.2, 0.7), glide: Math.random() < 0.3 ? rand(0.5, 1.5) : 0,
      phase: rand(0, 6), fade: reduceMotion ? 1 : 0, tempo: rand(0.85, 1.15),
      cramp: 0, progT: 0, progAt: { x: at.x, y: at.y }, leaving: false, eatCd: 0,
      // individuality, so koi chasing the same thing don't move in lockstep
      size, beatRate: rand(0.8, 1.2), turnR: rand(0.85, 1.25),
      wobF: rand(1.4, 2.8), wobA: rand(0.08, 0.2), notice: 0, food: null, z: Math.random(),
    };
    const curl = rand(-0.6, 0.6);
    let px = at.x, py = at.y;
    for (let i = 0; i <= N; i++) {
      if (i > 0) {
        const back = heading + Math.PI + curl * (i / N);
        px += Math.cos(back) * seg();
        py += Math.sin(back) * seg();
      }
      k.spine.push({ x: px, y: py });
    }
    for (let i = 0; i <= N; i++) pushOut(k.spine[i], envelope((i / N) * TOTAL));
    k.size = size;
    KS = 1;
    // first destination lies roughly ahead, so it sets off the way it faces
    k.waypoint = pickWaypoint(at, k, true, heading) || pickWaypoint(k.target, k);
    return k;
  }

  // ---- layout -------------------------------------------------------------
  function collectObstacles() {
    const hr = hero.getBoundingClientRect();
    const out = [];
    const add = (r) => {
      if (r.width < 1 || r.height < 1) return;
      out.push({ x0: r.left - hr.left, y0: r.top - hr.top, x1: r.right - hr.left, y1: r.bottom - hr.top });
    };
    hero.querySelectorAll(".hero-title, .edu-line, .hero-bullets li").forEach((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) add(r);
    });
    hero
      .querySelectorAll(".intern-card, .inline-highlight, .bullet-tag, .tag-circle, .scroll-indicator")
      .forEach((el) => add(el.getBoundingClientRect()));
    obstacles = out;
    const big = 1e5;
    // koi can swim anywhere, under the text included; only the pond's edges stop them
    // ...and the pond carries on past every edge of the screen
    const M = 380 * S;
    walls = [
      { x0: -big, y0: -big, x1: big, y1: -M }, // top
      { x0: -big, y0: H + M, x1: big, y1: big }, // bottom
      { x0: -big, y0: -big, x1: -M, y1: big }, // left
      { x0: W + M, y0: -big, x1: big, y1: big }, // right
    ];
    // the masks below only need rebuilding when the text or the size moved
    const sig = W + "x" + H + ":" + out.map((r) => `${r.x0 | 0},${r.y0 | 0},${r.x1 | 0},${r.y1 | 0}`).join(";");
    if (sig === layoutSig) return;
    layoutSig = sig;
    waterDirty = true;
    // tile mask: any tile within 4px of text is off-limits for drawing
    cols = Math.ceil(W / CELL);
    rows = Math.ceil(H / CELL);
    blocked = new Uint8Array(cols * rows);
    for (const r of out) {
      const c0 = Math.max(0, Math.floor((r.x0 - 4) / CELL)), c1 = Math.min(cols - 1, Math.floor((r.x1 + 4) / CELL));
      const r0 = Math.max(0, Math.floor((r.y0 - 4) / CELL)), r1 = Math.min(rows - 1, Math.floor((r.y1 + 4) / CELL));
      for (let y = r0; y <= r1; y++) blocked.fill(1, y * cols + c0, y * cols + c1 + 1);
    }
    // top and bottom of the pond aren't hard borders: koi fade out there
    edgeRow = new Float32Array(rows);
    const BAND = 110, top0 = opt.header ? 64 : -BAND * 0.4; // just below the fixed header
    for (let y = 0; y < rows; y++) {
      const py = (y + 0.5) * CELL;
      const a = clamp((py - top0) / BAND, 0, 1), b = clamp((H - py) / BAND, 0, 1);
      edgeRow[y] = a * a * (3 - 2 * a) * (b * b * (3 - 2 * b));
    }
    // "deep water" under and around the text: koi there sink out of view
    deep = new Float32Array(cols * rows);
    const FALL = 70;
    for (const r of out) {
      const c0 = Math.max(0, Math.floor((r.x0 - FALL) / CELL)), c1 = Math.min(cols - 1, Math.floor((r.x1 + FALL) / CELL));
      const r0 = Math.max(0, Math.floor((r.y0 - FALL) / CELL)), r1 = Math.min(rows - 1, Math.floor((r.y1 + FALL) / CELL));
      for (let y = r0; y <= r1; y++) {
        for (let x = c0; x <= c1; x++) {
          const d = rectDist((x + 0.5) * CELL, (y + 0.5) * CELL, r);
          const v = 1 - clamp((d - 6) / FALL, 0, 1);
          const i = y * cols + x;
          if (v > deep[i]) deep[i] = v;
        }
      }
    }
  }

  function setupTileLayers() {
    tileCanvas.width = cols;
    tileCanvas.height = rows;
    tileImg = tctx.createImageData(cols, rows);
    tileBuf = tileImg.data;
    koiLayer.width = Math.round(W * dpr);
    koiLayer.height = Math.round(H * dpr);
    kctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kctx.imageSmoothingEnabled = false;
    // the 1px seam between tiles (half a pixel either side of each boundary)
    const pc = document.createElement("canvas");
    const side = Math.round(CELL * dpr), seam = Math.max(1, Math.round(0.5 * dpr));
    pc.width = pc.height = side;
    const g = pc.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, side, seam);
    g.fillRect(0, side - seam, side, seam);
    g.fillRect(0, 0, seam, side);
    g.fillRect(side - seam, 0, seam, side);
    gapPattern = kctx.createPattern(pc, "repeat");
    gapPattern.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  }

  // Random open spot with room for a koi, preferring the right side and
  // keeping away from other koi's targets.
  function pickWaypoint(from, self, anyDist = false, heading = null) {
    const need = roomNeed();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 70; i++) {
        const x = rand(50, W - need * 0.8); // on-screen spots stay fully visible
        const y = rand(TOP_BOUND + 60 * S, H - 80 * S);
        if (heading !== null && pass < 2) {
          // keep going roughly the way it's facing: no U-turns to reach the next spot
          let b = Math.atan2(y - from.y, x - from.x) - heading;
          b = Math.atan2(Math.sin(b), Math.cos(b));
          if (Math.abs(b) > (pass === 0 ? 1.4 : 2.0)) continue;
        }
        if (clearance(x, y) < need) continue;
        // mostly open water, but now and then a dive under the text
        if (pass < 2 && Math.random() < 0.7 && clearance(x, y, obstacles) < need * 0.8) continue;
        if (!anyDist && Math.hypot(x - from.x, y - from.y) < 220 * S) continue; // longer swims
        if (self && koi.some((o) => o !== self && !o.away && Math.hypot(o.target.x - x, o.target.y - y) < 150 * S)) continue;
        if (pass < 2 && pellets.some((p) => Math.hypot(p.x - x, p.y - y) < 230 * S)) continue; // leave the feeding spot to the feeders
        if (pass === 0 && !anyDist && !lineOfSight(from, { x, y }, need * 0.7)) continue;
        return { x, y };
      }
    }
    return null;
  }

  // A spot just past one of the screen's edges.
  function offscreenPoint(edge) {
    const r = Math.random();
    edge = edge || (r < 0.35 ? "right" : r < 0.65 ? "bottom" : r < 0.85 ? "top" : "left");
    const out = rand(130, 250) * S;
    if (edge === "right") return { x: W + out, y: rand(TOP_BOUND, H), edge };
    if (edge === "left") return { x: -out, y: rand(TOP_BOUND, H), edge };
    if (edge === "top") return { x: rand(W * 0.3, W), y: -out, edge };
    return { x: rand(W * 0.3, W), y: H + out, edge };
  }
  const onScreen = (p, pad = 0) => p.x > -pad && p.x < W + pad && p.y > -pad && p.y < H + pad;

  function desiredCount() {
    if (opt.count) return Math.max(0, opt.count);
    // the whole pond, on screen and off; up to a quarter are away at any moment
    if (VW >= 2400) return 12;
    if (VW >= 2000) return 11;
    if (VW >= 1700) return 9;
    if (VW >= 1400) return 8;
    if (VW >= 1000) return 6;
    if (VW >= 700) return 5;
    return 4;
  }

  // Browser zoom-out, from how wide the window is on screen versus in CSS pixels
  // (outerWidth doesn't change with zoom). Zooming in needs nothing: the page
  // just behaves like a narrower window.
  // Only trusted when the pixel density moved to match (real zoom changes
  // devicePixelRatio too; a scaled-down preview or device emulation doesn't).
  function zoomOut() {
    const z = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : 1;
    if (z >= 0.9) return 1;
    const native = (window.devicePixelRatio || 1) / z;
    const real = [1, 1.25, 1.5, 1.75, 2, 2.5, 3].some((n) => Math.abs(native - n) / n < 0.08);
    return real ? Math.min(4, Math.round((1 / z) * 20) / 20) : 1;
  }

  function resize() {
    W = hero.clientWidth;
    H = hero.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Zooming the browser out makes CSS pixels physically smaller. Left alone,
    // the 6px tiles would shrink to a few screen pixels and the pond would turn
    // into a mesh of seams and unreadable glyphs. So work out the zoom and size
    // everything by how big it looks on screen instead.
    K = zoomOut();
    VW = W / K;
    // Koi shrink a little on narrower windows so they don't crowd the pond, and
    // grow on wide screens.
    S = (VW < 600 ? 0.8 : clamp(VW / 1500, 0.92, 1.35)) * K;
    // ~42 tiles per body length at every size: 6px tiles on big screens, 5px on
    // half-screen windows, 4px on phones. Snapped to whole device pixels so the
    // seams between tiles line up.
    const cell = (opt.cell || clamp(Math.round((5.1 * S) / K), 4, 6)) * K;
    CELL = GLYPH_PX = K === 1 ? cell : Math.max(1, Math.round(cell * dpr)) / dpr;
    waterLayer.width = Math.round(W * dpr);
    waterLayer.height = Math.round(H * dpr);
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    waterDirty = true;
    layoutSig = "";
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sprites.clear(); // device pixel ratio may have changed
    collectObstacles();
    setupTileLayers();
    seedWater();
    reconcile();
    syncLoop();
  }

  // Make the number of koi match the space; hide the pond if there's no room.
  function reconcile() {
    active = !!pickWaypoint({ x: W * 0.75, y: H / 2 }, null, true);
    canvas.style.display = active ? "" : "none";
    label.style.display = active ? "" : "none";
    if (!active) { koi = []; pellets = []; ripples = []; bubbles = []; return; }
    for (const k of koi) {
      const h = k.spine[0];
      if (clearance(h.x, h.y) < roomNeed() * 0.45) k.leaving = true;
    }
    const want = desiredCount();
    while (koi.length > want) koi.pop();
    const firstFill = koi.length === 0;
    const startOnScreen = Math.max(2, want - Math.floor(want * 0.25));
    // spread the opening headings around the compass (golden-angle steps plus
    // jitter) so the first thing visitors see is koi going every which way
    const base = rand(0, Math.PI * 2);
    let nth = 0;
    while (koi.length < want) {
      if (firstFill && koi.length < startOnScreen) {
        const at = pickWaypoint({ x: W * 0.8, y: H / 2 }, null, true);
        if (!at) break;
        koi.push(newKoi(at, base + nth++ * 2.39996 + rand(-0.35, 0.35)));
      } else {
        // everyone else starts out of sight and swims in, facing into the pond
        const p = offscreenPoint();
        const k = newKoi(p, Math.atan2(rand(H * 0.25, H * 0.75) - p.y, rand(W * 0.4, W * 0.9) - p.x));
        k.away = true; k.edge = p.edge; k.awayT = rand(0.5, 6); // first arrivals come in sooner, so the opening has more going on
        k.waypoint = { x: p.x, y: p.y };
        k.fade = 1;
        koi.push(k);
      }
    }
  }

  // ---- feeding ------------------------------------------------------------
  const reachable = (x, y) => clearance(x, y) >= envelope(0) * 0.9;

  // A handful of feed bursts out from the click point and scatters around it.
  // Can food be dropped here? Open water only: not on text, links or the edges.
  function feedSpot(e) {
    if (!active || e.target.closest("a, button, input, textarea, select, label")) return null;
    const hr = hero.getBoundingClientRect();
    const x = e.clientX - hr.left, y = e.clientY - hr.top;
    if (clearance(x, y, obstacles) < 24 || y < TOP_BOUND || y > H - 24 || x < 24 || x > W - 24) return null;
    return { x, y };
  }

  // a short pause between handfuls, so rapid clicking can't flood the pond
  const FEED_GAP_MS = 1200;
  let lastFeed = -Infinity;
  function onClick(e) {
    if (String(window.getSelection?.() || "").length) return;
    const spot = feedSpot(e);
    if (!spot) return;
    const now = performance.now();
    if (now - lastFeed < FEED_GAP_MS) return;
    lastFeed = now;
    const { x, y } = spot;
    noteFed();
    const n = 5 + Math.floor(Math.random() * 3); // a small handful
    for (let i = 0; i < n && pellets.length < MAX_PELLETS; i++) {
      const a = rand(0, Math.PI * 2);
      const reach = (8 + 75 * Math.random() ** 1.5) * S; // denser near the middle
      pellets.push({
        x, y, sx: x, sy: y,
        tx: x + Math.cos(a) * reach, ty: y + Math.sin(a) * reach,
        fly: 0, flyDur: rand(0.4, 0.95), landed: false, reach: false,
        age: 0, life: rand(24, 32), seed: rand(0, 100),
      });
    }
    ripples.push({ x, y, age: 0, life: 1.6, maxR: 70 * S });
  }

  function updatePellets(dt) {
    for (const p of pellets) {
      p.age += dt;
      if (!p.landed) {
        // fly outward, easing to a stop; stop early rather than land on text
        p.fly += dt;
        const t = Math.min(1, p.fly / p.flyDur);
        const e = 1 - (1 - t) ** 3;
        const nx = p.sx + (p.tx - p.sx) * e, ny = p.sy + (p.ty - p.sy) * e;
        if (clearance(nx, ny) < 10) p.fly = p.flyDur; // land where it is
        else { p.x = nx; p.y = ny; }
        if (p.fly >= p.flyDur) {
          p.landed = true;
          p.reach = reachable(p.x, p.y);
          if (Math.random() < 0.25) ripples.push({ x: p.x, y: p.y, age: 0, life: 0.6, maxR: 10 * S });
        }
      } else {
        // float: a slow drift on the current
        p.x += Math.sin(time * 0.5 + p.seed) * 4 * dt;
        p.y += Math.cos(time * 0.4 + p.seed * 1.3) * 3 * dt;
        if (clearance(p.x, p.y) < 10) pushOut(p, 10);
        // window shrank or text reflowed over it: fade away rather than sit clipped
        if (!p.dying && (p.x > W - 6 || p.y > H - 6 || clearance(p.x, p.y, obstacles) < 6)) {
          p.dying = true;
          p.life = Math.min(p.life, p.age + 0.8);
        }
        if (Math.random() < dt) p.reach = reachable(p.x, p.y);
      }
    }
    pellets = pellets.filter((p) => p.age < p.life);
  }

  // ---- simulation ---------------------------------------------------------
  function updateKoi(k, dt) {
    KS = k.size;
    k.fade = k.leaving ? Math.max(0, k.fade - dt / 0.6) : Math.min(1, k.fade + dt / 1.5);
    const head = k.spine[0];
    const t = k.target;

    // Wandering: swim straight for a destination and pick the next one, ahead
    // of the koi, before arriving. (A slow-moving target let koi catch up and
    // circle it, which is what made them spin.)
    const arrive = 90 * S;
    if (!k.waypoint || dist(k.waypoint, head) < arrive || (!k.away && clearance(k.waypoint.x, k.waypoint.y) < roomNeed() * 0.6)) {
      // Koi drift off past any edge and come back on their own schedule: one
      // leaving doesn't pull another in. Up to a quarter are away at once, but at
      // least two always stay in view.
      const awayNow = koi.filter((o) => o.away).length;
      const awayCap = Math.max(0, Math.min(Math.floor(koi.length * 0.25), koi.length - 2));
      if (k.away && k.awayT > 0) {
        k.waypoint = offscreenPoint(k.edge); // linger out of sight a while
      } else if (!k.away && Math.random() < 0.12 && awayNow < awayCap) {
        const p = offscreenPoint();
        k.waypoint = p; k.edge = p.edge;
        k.away = true;
        k.awayT = rand(2, 7);
      } else {
        const ahead = {
          x: clamp(head.x + Math.cos(k.heading) * 250 * S, 60, W - 60),
          y: clamp(head.y + Math.sin(k.heading) * 250 * S, TOP_BOUND + 60 * S, H - 80 * S),
        };
        k.waypoint = (k.away ? pickWaypoint(head, k, true) : pickWaypoint(head, k, false, k.heading))
          || pickWaypoint(head, k, true) || ahead;
        k.away = false;
      }
    }
    if (k.waypoint) { t.x = k.waypoint.x; t.y = k.waypoint.y; } // other koi read this to spread out
    if (k.away && k.awayT > 0 && !onScreen(head, 40 * S)) k.awayT -= dt; // the clock runs once it's out of sight

    // food beats wandering
    k.eatCd = Math.max(0, (k.eatCd || 0) - dt);
    let food = null;
    k.fullT = Math.max(0, (k.fullT || 0) - dt);
    const anyFood = pellets.some((p) => p.landed && p.reach && dist(p, head) < 450 * S);
    if (anyFood && !k.sawFood && Math.random() < 0.08) k.fullT = rand(4, 8); // not hungry this time
    k.sawFood = anyFood;
    if (!anyFood) k.notice = rand(0.15, 0.8); // each koi takes its own moment to notice
    else k.notice = Math.max(0, k.notice - dt);
    // most of the pond comes to eat; a few keep cruising
    const feeders = koi.filter((o) => o !== k && o.food).length;
    const seat = k.food || feeders < Math.max(1, Math.ceil(koi.length * 0.8));
    if (anyFood && k.notice === 0 && k.fullT === 0 && seat) {
      // nearest pellet, but one another koi is already after counts as farther,
      // so they fan out instead of all tracing the same line
      let best = Infinity;
      for (const p of pellets) {
        if (!p.landed || !p.reach) continue;
        const d = dist(p, head);
        if (d > 450 * S) continue;
        let b = Math.atan2(p.y - head.y, p.x - head.x) - k.heading;
        b = Math.abs(Math.atan2(Math.sin(b), Math.cos(b)));
        // only food it can reach with a gentle curve: roughly ahead, or far enough
        // away to swing round to. Anything else waits for the next pass.
        if (b > (p === k.food ? 2.2 : 1.35) && d < 120 * S) continue; // a little stickier once chosen
        const taken = koi.some((o) => o !== k && o.food === p);
        const score = d + b * 90 * S + (taken ? 140 * S : 0) + (p === k.food ? -25 * S : 0);
        if (score < best) { best = score; food = p; }
      }
    }
    k.food = food;
    // food about but none it can reach right now: keep swimming straight on and
    // come round for another pass, rather than turning back toward its old spot
    const passing = !food && anyFood && k.fullT === 0 && seat;
    const goal = food || (passing
      ? { x: head.x + Math.cos(k.heading) * 160 * S, y: head.y + Math.sin(k.heading) * 160 * S }
      : t);
    const goalD = dist(goal, head);

    // steering: toward the goal, away from text and other koi
    const pull = food && k.eatCd > 0 ? 0.6 : 1; // just ate: drift on, don't pirouette
    let ax = ((goal.x - head.x) / (goalD || 1)) * pull;
    let ay = ((goal.y - head.y) / (goalD || 1)) * pull;
    const fx = Math.cos(k.heading), fy = Math.sin(k.heading);
    const range = 130 * S + 20;
    for (const probe of [0, 50 * S, 100 * S, 150 * S]) { // look further ahead: turns are wider now
      const px = head.x + fx * probe, py = head.y + fy * probe;
      for (const r of walls) {
        const cx = clamp(px, r.x0, r.x1), cy = clamp(py, r.y0, r.y1);
        const dx = px - cx, dy = py - cy;
        const d = Math.hypot(dx, dy);
        if (d >= range || d < 0.001) continue;
        const f = ((1 - d / range) ** 2) * 2.2;
        ax += (dx / d) * f;
        ay += (dy / d) * f;
      }
      for (const o of koi) {
        if (o === k) continue;
        for (let i = 0; i <= N; i += 3) {
          const q = o.spine[i];
          const dx = px - q.x, dy = py - q.y;
          const d = Math.hypot(dx, dy);
          const rr = 160 * S;
          if (d >= rr || d < 0.001) continue;
          const f = ((1 - d / rr) ** 2) * (food ? 0.9 : 2.6);
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
    }
    // koi that aren't eating give the feeding spot a wide berth
    if (!food && pellets.length) {
      let cx = 0, cy = 0, n = 0;
      for (const p of pellets) {
        if (dist(p, head) < 220 * S) { cx += p.x; cy += p.y; n++; }
      }
      if (n) {
        cx /= n; cy /= n;
        const dx = head.x - cx, dy = head.y - cy, d = Math.hypot(dx, dy) || 1;
        const f = ((1 - Math.min(1, d / (220 * S))) ** 2) * 1.6;
        ax += (dx / d) * f;
        ay += (dy / d) * f;
      }
    }
    let diff = Math.atan2(ay, ax) - k.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // fixed turning radius: turn rate scales with speed (slow koi turn slowly)
    // wide, graceful turns: the circle is a few body-widths across, never a spin
    const near = food ? clamp(goalD / (120 * S), 0.55, 1) : 1; // tighten up on the final approach
    const maxTurn = clamp(k.speed / (70 * S * k.turnR * near), 0.35, 1.8) * dt;
    k.heading += clamp(diff, -maxTurn, maxTurn) + Math.sin(time * k.wobF + k.wobA * 40) * k.wobA * dt;

    // burst-and-glide: tail beats hard to speed up, then the koi coasts
    let vmax, demand;
    if (food) {
      // eager but unhurried: brake to turn toward food that's off to the side,
      // and coast for a moment after each gulp
      vmax = clamp(goalD * 0.7, 18 * S, 100 * S);
      demand = k.eatCd > 0 ? 0.25 : 0.75;
      k.glide = 0;
    } else if (k.dashT > 0) {
      k.dashT -= dt;
      vmax = 130 * S;
      demand = 1;
      k.glide = 0;
    } else {
      vmax = clamp(goalD * 0.8, 40 * S, 100 * S) * k.tempo;
      k.glide = Math.max(0, k.glide - dt);
      if (k.glide === 0 && Math.random() < dt * 0.15) k.glide = rand(1, 2.5);
      demand = k.glide > 0 ? 0.04 : clamp((vmax - k.speed) / (25 * S), 0, 1) * 0.8 + 0.2;
    }
    k.beat += (demand - k.beat) * Math.min(1, dt * 3);
    const accel = k.beat * vmax * 1.25 - k.speed;
    k.speed = Math.max(8 * S, k.speed + accel * dt * (accel > 0 ? 1.1 : 0.35));
    head.x += Math.cos(k.heading) * k.speed * dt;
    head.y += Math.sin(k.heading) * k.speed * dt;
    pushOut(head, envelope(0));
    k.phase += dt * (1.8 + 3.2 * Math.min(1.6, k.speed / (55 * S))) * k.beatRate;

    // trapped? (e.g. the text reflowed around it and it's pinned in a gap)
    if (clearance(head.x, head.y) < envelope(0) + 12 * S) k.cramp += dt;
    else k.cramp = Math.max(0, k.cramp - dt * 2);
    k.progT += dt;
    if (k.progT > 4) {
      const moved = dist(head, k.progAt);
      if (k.cramp > 2 && moved < 30 * S) k.leaving = true;
      k.progT = 0;
      k.progAt = { x: head.x, y: head.y };
    }

    // eat one pellet per gulp, then a pause before the next. A hungry koi takes
    // any pellet at its mouth, not only the one it was aiming for.
    if (k.eatCd === 0 && k.fullT === 0 && pellets.length) {
      const mouth = 14 * S + 6;
      let near = null, nd = mouth;
      for (const p of pellets) {
        if (!p.landed) continue;
        const d = dist(p, head);
        if (d < nd) { nd = d; near = p; }
      }
      if (near) food = near;
      else if (food && dist(food, head) >= mouth) food = null;
    } else food = null;
    if (food) {
      pellets.splice(pellets.indexOf(food), 1);
      eatenTotal++;
      ripples.push({ x: food.x, y: food.y, age: 0, life: 0.9, maxR: 22 * S });
      const nb = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < nb; i++) {
        bubbles.push({
          x: food.x + rand(-5, 5) * S, y: food.y + rand(-5, 5) * S,
          age: -i * rand(0.12, 0.22), life: rand(0.8, 1.1), size: rand(4.5, 7.5) * S,
          vx: rand(-6, 6), vy: -rand(16, 28),
        });
      }
      k.eatCd = rand(0.25, 0.55);
      // after a few bites it's had enough and swims off, making room for others
      k.bites = (k.bites || 0) + 1;
      if (k.bites >= (k.appetite ||= Math.ceil(rand(2.5, 6)))) {
        k.fullT = rand(5, 10);
        k.dashT = rand(1.2, 2); // a quick burst away from the crowd
        k.bites = 0;
        k.appetite = Math.ceil(rand(2.5, 6));
        k.waypoint = null; // head somewhere new
      }
      k.food = null;
    }
    // the snout bumps floating feed aside
    const bump = 16 * S;
    for (const p of pellets) {
      if (!p.landed || k.fullT === 0) continue; // hungry koi take it, not shove it
      const dx = p.x - head.x, dy = p.y - head.y;
      const d = Math.hypot(dx, dy);
      if (d < bump && d > 0.01) {
        p.x += (dx / d) * (bump - d) * 4 * dt + Math.cos(k.heading) * k.speed * 0.3 * dt;
        p.y += (dy / d) * (bump - d) * 4 * dt + Math.sin(k.heading) * k.speed * 0.3 * dt;
      }
    }

    // body: follow the leader with a bend limit so it can't fold over itself
    const MAX_BEND = 0.13;
    const sg = seg();
    for (let i = 1; i <= N; i++) {
      const a = k.spine[i - 1], b = k.spine[i];
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      const prevAng = i === 1 ? k.heading + Math.PI
        : Math.atan2(a.y - k.spine[i - 2].y, a.x - k.spine[i - 2].x);
      const d = Math.atan2(Math.sin(ang - prevAng), Math.cos(ang - prevAng));
      ang = prevAng + clamp(d, -MAX_BEND, MAX_BEND);
      b.x = a.x + Math.cos(ang) * sg;
      b.y = a.y + Math.sin(ang) * sg;
      pushOut(b, envelope((i / N) * TOTAL));
    }
  }

  let eatenTotal = 0; // read by the dev test hook
  function update(dt) {
    time += dt;
    waterAge += dt;
    updatePellets(dt);
    updateWater(dt);
    for (const b of bubbles) {
      b.age += dt;
      if (b.age > 0) { b.x += b.vx * dt; b.y += b.vy * dt; }
    }
    bubbles = bubbles.filter((b) => b.age < b.life);
    for (const r of ripples) r.age += dt;
    ripples = ripples.filter((r) => r.age < r.life);
    for (const k of koi) updateKoi(k, dt);
    KS = 1;
    for (const x of extras) if (x.on !== false) x.update?.(dt);
    // a trapped koi fades out and reappears somewhere open
    for (let i = 0; i < koi.length; i++) {
      const k = koi[i], h = k.spine[0];
      if (k.leaving && k.fade === 0) {
        const at = pickWaypoint({ x: W * 0.8, y: H / 2 }, k, true);
        if (at) koi[i] = newKoi(at);
      }
    }
  }

  // ---- rendering ----------------------------------------------------------
  const isDark = () => document.body.classList.contains("dark-mode");

  // Glyphs are pre-rendered once per (character, colour) and stamped with
  // drawImage, which is far cheaper than thousands of fillText calls a frame.
  const sprites = new Map();
  function glyph(ch, color) {
    const id = ch + color;
    let c = sprites.get(id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = Math.ceil(CELL * dpr);
      const g = c.getContext("2d");
      g.scale(dpr, dpr);
      g.font = `${GLYPH_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = color;
      g.fillText(ch, CELL / 2, CELL / 2 + 0.5);
      sprites.set(id, c);
    }
    return c;
  }
  const stamp = (ch, color, col, row) => ctx.drawImage(glyph(ch, color), col * CELL, row * CELL, CELL, CELL);

  // fin-ray glyph for a direction
  function rayGlyph(ux, uy) {
    let a = Math.atan2(uy, ux);
    if (a < 0) a += Math.PI;
    if (a < Math.PI / 8 || a >= (7 * Math.PI) / 8) return "-";
    if (a < (3 * Math.PI) / 8) return "\\";
    if (a < (5 * Math.PI) / 8) return "|";
    return "/";
  }

  // Tilde water: evenly scattered `-` / `~` glyphs that drift on a current and
  // shimmer. Seeded on a jittered grid so they spread out instead of clumping.
  function seedWater() {
    const gap = 36 * K;
    waterDots = [];
    for (let y = gap / 2; y < H; y += gap) {
      for (let x = gap / 2; x < W; x += gap) {
        waterDots.push({
          x: x + rand(-gap / 2, gap / 2), y: y + rand(-gap / 2, gap / 2),
          ph: rand(0, 6.28), tw: rand(1.2, 3.2), sp: rand(0.7, 1.4),
        });
      }
    }
  }

  function updateWater(dt) {
    for (const d of waterDots) {
      d.x += (14 + 9 * Math.sin(d.y * 0.012 + time * 0.35)) * d.sp * dt;
      d.y += 6 * Math.sin(d.x * 0.01 + time * 0.6 + d.ph) * dt;
      if (d.x > W) d.x -= W;
      if (d.y < 0) d.y += H; else if (d.y > H) d.y -= H;
    }
  }

  function drawWater(dark) {
    // the dashes hop a whole tile at a time, so ~12 redraws a second looks the same as 60
    if (waterDirty || waterAge >= 0.08 || dark !== waterDark) {
      waterDirty = false;
      waterAge = 0;
      waterDark = dark;
      const color = dark ? "#cbd5e1" : "#475569";
      wctx.clearRect(0, 0, W, H);
      for (const d of waterDots) {
        const col = Math.floor(d.x / CELL), row = Math.floor(d.y / CELL);
        if (isBlocked(col, row)) continue;
        const tw = 0.5 + 0.5 * Math.sin(time * d.tw + d.ph);
        wctx.globalAlpha = 0.16 + 0.34 * tw;
        wctx.drawImage(glyph(tw > 0.7 ? "~" : "-", color), col * CELL, row * CELL, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(waterLayer, 0, 0, W, H);
  }

  // A koi's pattern never changes, so its colours are worked out once into a
  // table over (along the body, across the body) instead of every frame.
  const PAT_S = 141, PAT_T = 33;
  // push a colour further from grey (whites stay white) and a touch deeper
  const vivid = (c) => {
    const l = lum(c) * 255;
    return c.map((v) => clamp(l + (v - l) * 1.55 - 8, 0, 255));
  };
  function buildPatternTable(k, dark) {
    const base = rgb((dark && k.v.dark?.base) || k.v.base);
    const patch = rgb(k.v.patch);
    const spot = k.v.spot ? rgb(k.v.spot) : null;
    const tab = new Float32Array(PAT_S * PAT_T * 5); // r, g, b, shade strength, ridge
    for (let si = 0; si < PAT_S; si++) {
      const bs = si / (PAT_S - 1);
      for (let tj = 0; tj < PAT_T; tj++) {
        const tn = (tj / (PAT_T - 1)) * 2 - 1;
        // pattern with soft edges: tiles on a patch border blend both colours
        let c = base;
        const pf = blobField(k.pat.patches, bs, tn, k.pat);
        if (pf < 0.18) c = mixA(base, patch, clamp((0.18 - pf) / 0.36, 0, 1));
        if (spot) {
          const sf = blobField(k.pat.spots, bs, tn, k.pat);
          if (sf < 0.15) c = mixA(c, spot, clamp((0.15 - sf) / 0.3, 0, 1));
        }
        // pale, slightly pink nose like real koi
        if (bs < 0.05) c = mixA(c, [246, 214, 200], (0.05 - bs) * 10);
        // scales: a faint offset-row lattice that rides along the body
        const row2 = Math.floor(bs * 70), colL = Math.floor((tn + 1) * 5 + (row2 & 1) * 0.5);
        if (bs > 0.2 && ((row2 + colL) & 1)) c = mixA(c, [255, 255, 255], 0.07);
        // dorsal fin: a thin darker ridge down the middle of the back
        const ridge = bs > 0.32 && bs < 0.72 && Math.abs(tn) < 0.1;
        if (ridge) c = mixA(c, [20, 18, 18], 0.16);
        const i = (si * PAT_T + tj) * 5;
        if (opt.vivid) c = vivid(c);
        tab[i] = c[0]; tab[i + 1] = c[1]; tab[i + 2] = c[2];
        tab[i + 3] = (lum(c) > 0.7 ? 0.3 : 0.4) * (opt.vivid ? 0.55 : 1);
        tab[i + 4] = ridge ? 1 : 0;
      }
    }
    return tab;
  }

  // One koi's tile laid over another's (koi are drawn bottom to top). Opaque
  // body covers what's under it; translucent fins and soft edges let the koi
  // below show through, so overlaps read as one fish above another.
  const alphaOf = (c) => (c.kind === "body" ? c.edge : c.fa) * c.fade;
  function layer(under, top) {
    const a = alphaOf(top);
    if (a >= 0.999) return top;
    const ua = alphaOf(under);
    const out = a + ua * (1 - a);
    const w = out > 0 ? a / out : 1;
    const fill = mixA(under.fill, top.fill, w);
    if (top.kind === "body") return { ...top, fill, edge: out, fade: 1 };
    if (under.kind === "body") {
      // a fin over another koi's body: tint the body, show the fin's rays
      return { ...under, fill, edge: out, fade: 1, glyph: top.glyph, gcol: lum(fill) > 0.5 ? "#0f172a" : "#ffffff", ga: 0.32 };
    }
    return { ...top, fill, fa: out, fade: 1 };
  }

  // Rasterise one koi into `cells` (Map key -> tile).
  function rasterKoi(k, cells, dark) {
    KS = k.size;
    const R = maxR();
    const fin = opt.vivid ? vivid(rgb(k.v.fin)) : rgb(k.v.fin);
    if (!k.tab || k.tabDark !== dark) { k.tab = buildPatternTable(k, dark); k.tabDark = dark; }
    const tab = k.tab;
    const amp = (2.5 + 3.5 * k.beat + 2.5 * Math.min(1, k.speed / (80 * S))) * S;

    const q = k.spine.map((p, i) => {
      const s = (i / N) * TOTAL;
      const a = k.spine[Math.max(0, i - 1)], b = k.spine[Math.min(N, i + 1)];
      const tx = a.x - b.x, ty = a.y - b.y;
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      const w = amp * waveEnv(s) * Math.sin(k.phase - s * 5.2);
      return { x: p.x + nx * w, y: p.y + ny * w, fx: tx / tl, fy: ty / tl, nx, ny, s };
    });

    // pectoral fins paddle when slow and fold back when fast; pelvics follow
    const slow = 1 - Math.min(1, k.speed / (70 * S));
    const fins = [];
    for (const [s, size] of [[0.19, 1], [0.55, 0.5]]) {
      const p = q[Math.round((s / TOTAL) * N)];
      for (const side of [-1, 1]) {
        const spread = 0.55 + 0.6 * slow + (0.08 + 0.3 * slow) * Math.sin(k.phase * 0.5 + side * 1.4 + s * 4);
        const ux = -p.fx * Math.cos(spread) + p.nx * side * Math.sin(spread);
        const uy = -p.fy * Math.cos(spread) + p.ny * side * Math.sin(spread);
        const a = R * 1.15 * size, b = R * 0.55 * size;
        const r0 = bodyR(s) * 0.7;
        fins.push({ cx: p.x + p.nx * side * r0 + ux * a * 0.8, cy: p.y + p.ny * side * r0 + uy * a * 0.8, ux, uy, a, b });
      }
    }

    const eyeCells = new Set();
    {
      const p = q[Math.round((0.06 / TOTAL) * N)], r = bodyR(0.06) * 0.62;
      for (const side of [-1, 1]) {
        eyeCells.add(Math.floor((p.y + p.ny * side * r) / CELL) * 65536 + Math.floor((p.x + p.nx * side * r) / CELL));
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of q) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = R * 2;
    const c0 = Math.max(0, Math.floor((minX - pad) / CELL)), c1 = Math.min(cols - 1, Math.ceil((maxX + pad) / CELL));
    const r0 = Math.max(0, Math.floor((minY - pad) / CELL)), r1 = Math.min(rows - 1, Math.ceil((maxY + pad) / CELL));
    if (c0 > c1 || r0 > r1) return; // entirely off-screen
    const tail = q[N - Math.round(N * (TOTAL - 1) / TOTAL)];
    const ti0 = (PAT_S - 1) * PAT_T + (PAT_T >> 1); // body colour where the tail joins
    const tailCol = [tab[ti0 * 5], tab[ti0 * 5 + 1], tab[ti0 * 5 + 2]];

    // For every tile near the spine: how deep inside the body it is (the deepest
    // over all body segments, so a tail swinging past a bent body can't cut a
    // notch out of it), and separately the nearest point on the tail. Each
    // segment only sweeps the tiles within reach of it.
    const gw = c1 - c0 + 1, gh = r1 - r0 + 1;
    const nD = new Float32Array(gw * gh).fill(Infinity); // tail: nearest distance
    const nS = new Float32Array(gw * gh), nL = new Float32Array(gw * gh);
    const bD = new Float32Array(gw * gh); // body: depth 0..1 (0 = outside)
    const bS = new Float32Array(gw * gh), bL = new Float32Array(gw * gh);
    const reach = R * 1.25 + CELL;
    for (let j = 0; j < N; j++) {
      const A = q[j], B = q[j + 1];
      const vx = B.x - A.x, vy = B.y - A.y;
      const len2 = vx * vx + vy * vy || 1;
      const sc0 = Math.max(c0, Math.floor((Math.min(A.x, B.x) - reach) / CELL));
      const sc1 = Math.min(c1, Math.floor((Math.max(A.x, B.x) + reach) / CELL));
      const sr0 = Math.max(r0, Math.floor((Math.min(A.y, B.y) - reach) / CELL));
      const sr1 = Math.min(r1, Math.floor((Math.max(A.y, B.y) + reach) / CELL));
      for (let row = sr0; row <= sr1; row++) {
        const py = (row + 0.5) * CELL;
        for (let col = sc0; col <= sc1; col++) {
          const px = (col + 0.5) * CELL;
          const tt = clamp(((px - A.x) * vx + (py - A.y) * vy) / len2, 0, 1);
          const cx = A.x + vx * tt, cy = A.y + vy * tt;
          const d = Math.hypot(px - cx, py - cy);
          const idx = (row - r0) * gw + (col - c0);
          const sp = A.s + (B.s - A.s) * tt;
          const lat = ((px - cx) * -vy + (py - cy) * vx) < 0 ? d : -d;
          if (sp <= 1) {
            const depth = 1 - d / bodyR(sp);
            if (depth > bD[idx]) { bD[idx] = depth; bS[idx] = sp; bL[idx] = lat; }
          } else if (d < nD[idx]) {
            nD[idx] = d; nS[idx] = sp; nL[idx] = lat;
          }
        }
      }
    }

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const key = row * 65536 + col;
        const prev = cells.get(key);
        const px = (col + 0.5) * CELL, py = (row + 0.5) * CELL;
        const idx = (row - r0) * gw + (col - c0);
        const inBody = bD[idx] > 0;
        const bs = inBody ? bS[idx] : nS[idx], blat = inBody ? bL[idx] : nL[idx];
        const best = inBody ? (1 - bD[idx]) * bodyR(bs) : nD[idx];

        let cell = null;
        if (bs <= 1) {
          const r = bodyR(bs);
          if (best < r) {
            const depth = 1 - best / r;
            const tn = blat / r;
            // pattern colour from the koi's precomputed table, then round-body
            // shading: darker toward the flanks, sheen along the back
            const ti = Math.round((bs / 1) * (PAT_S - 1)) * PAT_T + Math.round(clamp((tn + 1) / 2, 0, 1) * (PAT_T - 1));
            const sh = (1 - depth) * (1 - depth) * tab[ti * 5 + 3];
            let cr = tab[ti * 5] + (60 - tab[ti * 5]) * sh;
            let cg = tab[ti * 5 + 1] + (52 - tab[ti * 5 + 1]) * sh;
            let cb = tab[ti * 5 + 2] + (48 - tab[ti * 5 + 2]) * sh;
            if (depth > 0.7 && !opt.vivid) {
              const w = (depth - 0.7) * 0.4;
              cr += (255 - cr) * w; cg += (255 - cg) * w; cb += (255 - cb) * w;
            }
            const ridge = tab[ti * 5 + 4] === 1;
            const c = [cr, cg, cb];
            cell = eyeCells.has(key)
              ? { kind: "body", fill: [24, 22, 22], glyph: "o", gcol: "#f0f0f0", ga: 1, edge: 1 }
              : {
                kind: "body", fill: c,
                glyph: ridge ? "=" : BODY_GLYPHS[Math.min(BODY_GLYPHS.length - 1, Math.floor(depth * BODY_GLYPHS.length))],
                gcol: lum(c) > 0.5 ? "#0f172a" : "#ffffff", ga: lum(c) > 0.5 ? 0.2 : 0.18,
                edge: 0.55 + 0.45 * Math.min(1, depth / 0.18), // soften the silhouette
              };
          }
        } else {
          // tail fin seen from above: a broad, soft fan that spreads from the root,
          // with only a shallow dip in the trailing edge and rounded lobe tips
          let u = (bs - 1) / (TOTAL - 1), lat = Math.abs(blat);
          if (bs >= TOTAL - 1e-4) {
            // past the last spine point: measure along/across the tail's own line
            // so the lobes end in points instead of a rounded cap
            const e = q[N], pr = q[N - 3];
            const dx = e.x - pr.x, dy = e.y - pr.y, dl = Math.hypot(dx, dy) || 1;
            const ex = ((px - e.x) * dx + (py - e.y) * dy) / dl;
            lat = Math.abs((px - e.x) * -dy + (py - e.y) * dx) / dl;
            u = 1 + ex / (bodyLen() * (TOTAL - 1));
          }
          const half = R * (0.26 + 0.95 * Math.sin(Math.min(1, u) * Math.PI / 2) ** 1.3); // fans out, edges curve
          const t = lat / half; // 0 on the midline, 1 at the outer edge
          let trailing = 0.85 + 0.15 * t ** 1.6; // shallow dip in the middle
          if (t > 0.7) trailing -= 0.3 * ((t - 0.7) / 0.3) ** 2; // rounded lobe tips
          if (t < 1 && u < trailing && u >= 0) {
            const ray = Math.floor(Math.atan2(py - tail.y, px - tail.x) * 11) & 1; // alternating fin rays
            const rim = Math.max(t, 1 - (trailing - u) / 0.12); // lobe edges catch the light
            // the body's colour bleeds into the root of the fin, then it turns
            // translucent toward the tips
            const k2 = 0.6 * (1 - Math.min(1, u * 1.6)) ** 1.5;
            cell = {
              kind: "fin",
              fill: [fin[0] + (tailCol[0] - fin[0]) * k2, fin[1] + (tailCol[1] - fin[1]) * k2, fin[2] + (tailCol[2] - fin[2]) * k2],
              fa: (0.42 + 0.3 * (1 - u) + 0.2 * Math.max(0, rim) ** 2) * (ray ? 1 : 0.75),
              glyph: rayGlyph(px - tail.x, py - tail.y), galpha: 0.5,
            };
          }
        }
        if (!cell) {
          for (const f of fins) {
            const dx = px - f.cx, dy = py - f.cy;
            const u = dx * f.ux + dy * f.uy, v = -dx * f.uy + dy * f.ux;
            const e = (u / f.a) ** 2 + (v / f.b) ** 2;
            if (e < 1) {
              const ray = Math.floor((v / f.b + 1) * 3) & 1; // alternating fin rays
              cell = { kind: "fin", fill: fin, fa: (0.3 + 0.35 * (1 - e)) * (ray ? 1 : 0.72), glyph: rayGlyph(f.ux, f.uy) };
              break;
            }
          }
        }
        if (cell) {
          cell.fade = k.fade;
          cells.set(key, prev ? layer(prev, cell) : cell);
        }
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!active) return;
    const dark = isDark();

    ctx.font = `${GLYPH_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (opt.water) drawWater(dark);

    // ripple rings
    const rippleColor = dark ? "#cbd5e1" : "#475569";
    for (const r of ripples) {
      const p = r.age / r.life;
      const rad = r.maxR * (1 - (1 - p) ** 2);
      const seen = new Set();
      const steps = Math.max(12, Math.ceil((2 * Math.PI * rad) / (CELL * 0.8)));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const col = Math.floor((r.x + Math.cos(a) * rad) / CELL), row = Math.floor((r.y + Math.sin(a) * rad) / CELL);
        const key = col * 100003 + row;
        if (seen.has(key) || isBlocked(col, row)) continue;
        seen.add(key);
        ctx.globalAlpha = (r.a ?? 0.45) * (1 - p);
        stamp("~", rippleColor, col, row);
      }
    }

    for (const x of extras) if (x.on !== false && x.drawUnder) { ctx.globalAlpha = 1; x.drawUnder(ctx, dark); }
    const drawOver = () => {
      for (const x of extras) if (x.on !== false && x.drawOver) { ctx.globalAlpha = 1; x.drawOver(ctx, dark); }
    };
    if (!koi.length) { drawOver(); ctx.globalAlpha = 1; return; }
    const cells = new Map();
    // bottom to top; each koi keeps its own depth so overlaps are consistent
    for (const k of [...koi].sort((a, b) => a.z - b.z)) rasterKoi(k, cells, dark);
    KS = 1;

    const deepTint = dark ? [40, 52, 70] : [150, 172, 196]; // murky blue-grey
    // on narrow screens the text covers most of the pond, so "deep" koi stay
    // more visible there (they're behind the text, so it stays readable)
    const deepDim = 0.6 + 0.26 * clamp((VW - 700) / 500, 0, 1);

    // tile colours -> one pixel each
    tileBuf.fill(0);
    const put = (col, row, c, a) => {
      const i = (row * cols + col) * 4;
      tileBuf[i] = c[0]; tileBuf[i + 1] = c[1]; tileBuf[i + 2] = c[2]; tileBuf[i + 3] = a * 255;
    };
    // soft tile shadow, offset like light from the upper left
    const shadowRGB = dark ? [0, 0, 0] : [148, 163, 184];
    const shadowA = dark ? 0.28 : 0.14;
    for (const [key, c] of cells) {
      if (c.kind !== "body") continue;
      const col = key & 0xffff, row = key >>> 16;
      const sc = col + 1, sr = row + 2;
      if (cells.has(sr * 65536 + sc) || sc >= cols || sr >= rows) continue;
      const sd = deep[sr * cols + sc] || 0;
      if (sd > 0.95) continue;
      put(sc, sr, shadowRGB, shadowA * c.fade * (1 - sd) * edgeRow[sr]);
    }
    // koi tiles; deeper water near the text fades them and tints them murky
    const glyphs = [];
    for (const [key, c] of cells) {
      const col = key & 0xffff, row = key >>> 16;
      if (col >= cols || row >= rows) continue;
      const dp = deep[row * cols + col] || 0;
      const vis = (1 - deepDim * dp) * edgeRow[row];
      const fill = dp > 0 ? mixA(c.fill, deepTint, 0.55 * dp) : c.fill;
      if (c.kind === "body") {
        put(col, row, fill, 0.97 * c.edge * c.fade * vis);
        if (c.glyph !== " ") glyphs.push(col, row, c.glyph, c.gcol, c.ga * c.fade * vis);
      } else {
        put(col, row, fill, c.fa * c.fade * vis);
        glyphs.push(col, row, c.glyph, lum(c.fill) > 0.5 ? "#0f172a" : "#ffffff", (c.galpha || 0.3) * c.fade * vis);
      }
    }
    tctx.putImageData(tileImg, 0, 0);
    kctx.clearRect(0, 0, W, H);
    kctx.drawImage(tileCanvas, 0, 0, cols * CELL, rows * CELL);
    kctx.globalCompositeOperation = "destination-out";
    kctx.fillStyle = gapPattern;
    kctx.fillRect(0, 0, W, H);
    kctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(koiLayer, 0, 0, W, H);

    // glyphs on top of the tiles (opacity only changes when it has to)
    let lastA = -1;
    for (let i = 0; i < (opt.ascii ? glyphs.length : 0); i += 5) {
      const a = glyphs[i + 4];
      if (a < 0.02) continue;
      if (a !== lastA) { ctx.globalAlpha = a; lastA = a; }
      stamp(glyphs[i + 2], glyphs[i + 3], glyphs[i], glyphs[i + 1]);
    }
    drawOver(); // lily pads, petals...: on the surface, above the koi
    // feed floats on the surface, so it's drawn over the koi: a fish passing
    // underneath doesn't hide it. Each pellet bobs and casts its own shadow.
    const ps = Math.max(4, Math.round(5 * S + 1));
    for (const p of pellets) {
      const col = Math.floor(p.x / CELL), row = Math.floor(p.y / CELL);
      if (isBlocked(col, row)) continue;
      const fade = Math.min(1, (p.life - p.age) / (p.dying ? 0.8 : 3));
      const fly = p.landed ? 1 : p.fly / p.flyDur;
      const lift = p.landed ? 0 : Math.sin(fly * Math.PI) * 10 * S; // arc while airborne
      const jx = Math.sin(time * 7 + p.seed) * 0.9 + Math.sin(time * 13 + p.seed * 2) * 0.4;
      const jy = Math.cos(time * 6.3 + p.seed * 1.7) * 0.9;
      const x = p.x + jx - ps / 2, y = p.y + jy - ps / 2;
      ctx.globalAlpha = (dark ? 0.45 : 0.3) * fade;
      ctx.fillStyle = dark ? "#000000" : "#94a3b8";
      ctx.fillRect(Math.round(x + 2 + lift * 0.3), Math.round(y + 3 + lift * 0.6), ps, ps);
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#8a5520";
      ctx.fillRect(Math.round(x), Math.round(y - lift), ps, ps);
      ctx.fillStyle = "#c58a45";
      ctx.fillRect(Math.round(x), Math.round(y - lift), Math.ceil(ps / 2), Math.ceil(ps / 2));
    }

    drawBubbles(dark);
    ctx.globalAlpha = 1;
  }

  // Eating bubbles, in ASCII: `.` -> `o` -> `O` as they swell and rise, then
  // `*` as they pop, with `'` specks flying out. Snapped to the tile grid,
  // white with only a faint edge.
  function drawBubbles(dark) {
    const ink = dark ? "#e2e8f0" : "#475569";
    const at = (x, y, ch, px, alpha) => {
      const col = Math.floor(x / CELL), row = Math.floor(y / CELL);
      if (isBlocked(col, row)) return;
      ctx.font = `bold ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      const x0 = (col + 0.5) * CELL, y0 = (row + 0.5) * CELL;
      ctx.globalAlpha = alpha * 0.25;
      ctx.strokeText(ch, x0, y0); // barely-there edge so white still shows on white
      ctx.globalAlpha = alpha;
      ctx.fillText(ch, x0, y0);
    };
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.fillStyle = "#ffffff";
    for (const b of bubbles) {
      if (b.age < 0) continue;
      const p = b.age / b.life;
      const big = Math.round(b.size * 1.9); // glyph size, px
      if (p < 0.2) at(b.x, b.y, ".", big, 0.9);
      else if (p < 0.45) at(b.x, b.y, "o", big, 0.95);
      else if (p < 0.75) at(b.x, b.y, "O", big, 1);
      else {
        const q = (p - 0.75) / 0.25;
        if (q < 0.4) at(b.x, b.y, "*", big, 1);
        const rr = CELL * (1 + q * 1.5);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          at(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr, "'", big, 0.85 * (1 - q));
        }
      }
    }
    ctx.font = `${GLYPH_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  }

  // ---- loop & lifecycle ---------------------------------------------------
  let obstacleTimer = 0;
  // Everything sits on a 6px tile grid, so 30fps looks the same as 60 (or 120 on
  // ProMotion screens) at a fraction of the work.
  const FRAME_MS = 1000 / 30;
  let held = false; // dev test hook can freeze the live loop
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (held) return;
    if (now - last < FRAME_MS - 2) return;
    const dt = Math.min(0.066, (now - last) / 1000 || 0);
    last = now;
    obstacleTimer += dt;
    if (obstacleTimer > 0.5) { obstacleTimer = 0; collectObstacles(); }
    update(dt * opt.speed);
    draw();
  }

  function syncLoop() {
    const should = active && visible && !document.hidden && !reduceMotion;
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
    if (active && reduceMotion) draw(); // static pond
  }

  new ResizeObserver(resize).observe(hero);
  // live controls for the demo page
  hero.koiPond = {
    opt,
    set(key, value) {
      opt[key] = value;
      if (key === "cell" || key === "header") { TOP_BOUND = opt.header ? 90 : 12; resize(); }
      if (key === "count") reconcile();
      if (key === "vivid") for (const k of koi) k.tab = null;
      if (key === "water") waterDirty = true;
    },
    feed: (x, y) => onClick({ target: hero, clientX: x, clientY: y }),
    // Add-ons get a window into the pond. Each is a function (api) => ({ update,
    // drawUnder, drawOver }); flip its `on` to show or hide it.
    use(make) {
      const api = {
        hero, opt,
        get W() { return W; }, get H() { return H; }, get S() { return S; },
        get CELL() { return CELL; }, get time() { return time; },
        get viewW() { return VW; }, // width as it looks on screen (allows for zoom)
        get topBound() { return TOP_BOUND; },
        koi: () => koi.map((k) => ({ x: k.spine[0].x, y: k.spine[0].y, heading: k.heading, speed: k.speed, fade: k.fade })),
        ripple: (x, y, maxR, life = 0.9, a = 0.45) => ripples.push({ x, y, age: 0, life, maxR, a }),
        isBlocked, stamp, glyph, rand, clamp,
        clearance: (x, y) => clearance(x, y, obstacles), // distance to the nearest text
        // the box around all the text (null if there's none)
        textBox: () => obstacles.length ? obstacles.reduce((b, r) => ({
          x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1),
        }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : null,
      };
      const x = make(api);
      extras.push(x);
      return x;
    },
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; syncLoop(); }).observe(hero);
  document.addEventListener("visibilitychange", syncLoop);
  document.fonts?.ready.then(() => { collectObstacles(); });
  if (!reduceMotion) {
    hero.addEventListener("click", onClick);
    hero.addEventListener("pointermove", onRippleMove);
    hero.addEventListener("pointerleave", () => { rx = null; });
    hero.addEventListener("mousemove", onHover);
    hero.addEventListener("mouseleave", () => { hero.style.cursor = ""; label.classList.remove("is-on"); });
  }
  resize();

  if (import.meta.env?.DEV) {
    // dev-only hook for stepping the simulation without animation frames
    window.__koi = {
      step(n, dt = 1 / 60) {
        let minClear = Infinity;
        for (let s = 0; s < n; s++) {
          update(dt);
          for (const k of koi) for (let i = 0; i <= N; i++) {
            const ss = (i / N) * TOTAL;
            minClear = Math.min(minClear, clearance(k.spine[i].x, k.spine[i].y, obstacles) - (ss <= 1 ? bodyR(ss) : maxR()));
          }
        }
        draw();
        return { eaten: eatenTotal, ripples: ripples.length, minClear, n: koi.length, active, S, W, pellets: pellets.length, landed: pellets.filter((p) => p.landed).length, bubbles: bubbles.map((b) => [b.x | 0, b.y | 0, +b.age.toFixed(2)]) };
      },
      feed: (x, y) => onClick({ target: hero, clientX: x + hero.getBoundingClientRect().left, clientY: y + hero.getBoundingClientRect().top }),
      hold: (on) => { held = on; },
      heads: () => koi.map((k) => [k.spine[0].x | 0, k.spine[0].y | 0, k.v.name]),
      place(i, x, y, a = -Math.PI / 2) {
        const k = koi[i];
        k.spine.forEach((p, j) => { p.x = x - Math.cos(a) * j * seg(); p.y = y - Math.sin(a) * j * seg(); });
        k.heading = a;
      },
      state: () => koi.map((k) => ({ depth: +(deep[Math.floor(k.spine[0].y / CELL) * cols + Math.floor(k.spine[0].x / CELL)] || 0).toFixed(2), feeding: !!k.food, away: !!k.away, fade: +k.fade.toFixed(2), leaving: k.leaving, speed: +(k.speed / S).toFixed(1), phase: k.phase, heading: k.heading })),
    };
  }
}

const hero = document.querySelector(".hero");
if (hero) initPond(hero);
