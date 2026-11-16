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
// Size and count scale with the window; with no open water (phones) it hides.

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
  // ---- tunables -----------------------------------------------------------
  const CELL = 6; // square tile size, px
  const GLYPH_PX = 6;
  const TOTAL = 1.3; // spine length incl. tail fin, in body lengths
  const N = 28; // spine segments
  const CLEAR = 14; // minimum gap kept between a koi and any text
  const TOP_BOUND = 90; // stay below the fixed site header
  const MIN_WIDTH = 820;
  const BODY_GLYPHS = " .:-=+";
  const MAX_PELLETS = 160;

  const canvas = document.createElement("canvas");
  canvas.className = "koi-canvas";
  canvas.setAttribute("aria-hidden", "true");
  hero.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let S = 1; // size scale for the current window
  let obstacles = []; // text rects, hero-local coords
  let walls = []; // obstacles + out-of-bounds slabs (physics only)
  let blocked = new Uint8Array(0); // per-tile: 1 = touches text
  let koi = [], pellets = [], ripples = [], bubbles = [], waterDots = [];
  let time = 0;
  let running = false, visible = true, raf = 0, last = 0, active = false;
  let varietyCursor = Math.floor(Math.random() * VARIETIES.length);

  // size-dependent geometry
  let KS = 1; // size of the koi currently being simulated/drawn (each koi differs)
  const bodyLen = () => 190 * S * KS;
  const maxR = () => 26 * S * KS;
  const seg = () => (bodyLen() * TOTAL) / N;

  // ---- helpers ------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixA = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const css = (a) => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
  const lum = (a) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) / 255;
  const INK = rgb("#0f172a"), PAPER = rgb("#ffffff");

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
    return R * (1 - 0.88 * Math.pow((s - 0.22) / 0.78, 1.5)); // long taper to the tail
  }

  const waveEnv = (s) => 0.12 + 0.88 * Math.min(s, TOTAL) ** 2; // head steady, tail swings

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

  function newKoi(at) {
    const v = VARIETIES[varietyCursor++ % VARIETIES.length];
    const size = rand(0.82, 1.12);
    KS = size;
    const k = {
      v, pat: makePattern(v),
      spine: [], target: { x: at.x - 40, y: at.y }, waypoint: null,
      heading: Math.PI, speed: 30 * S, beat: 0.4, glide: 0,
      phase: rand(0, 6), fade: reduceMotion ? 1 : 0, tempo: rand(0.85, 1.15),
      cramp: 0, progT: 0, progAt: { x: at.x, y: at.y }, leaving: false, eatCd: 0,
      // individuality, so koi chasing the same thing don't move in lockstep
      size, beatRate: rand(0.8, 1.2), turnR: rand(0.85, 1.25),
      wobF: rand(1.4, 2.8), wobA: rand(0.08, 0.2), notice: 0, food: null,
    };
    for (let i = 0; i <= N; i++) k.spine.push({ x: at.x + i * seg(), y: at.y });
    for (let i = 0; i <= N; i++) pushOut(k.spine[i], envelope((i / N) * TOTAL));
    k.size = size;
    KS = 1;
    k.waypoint = pickWaypoint(k.target, k);
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
    // close off the slivers beside the text block (the left margin and the lane
    // above the title): they're too narrow to swim and a koi can get pinned there
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity;
    hero.querySelectorAll(".hero-title, .edu-line, .intern-card, .hero-bullets").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1) return;
      tx0 = Math.min(tx0, r.left - hr.left);
      ty0 = Math.min(ty0, r.top - hr.top);
      tx1 = Math.max(tx1, r.right - hr.left);
    });
    const slivers = tx0 === Infinity ? [] : [
      { x0: -big, y0: -big, x1: tx0, y1: big }, // left margin
      { x0: -big, y0: -big, x1: tx1, y1: ty0 }, // lane above the title
    ];
    walls = out.concat(slivers, [
      { x0: -big, y0: -big, x1: big, y1: TOP_BOUND }, // top (header)
      { x0: -big, y0: H, x1: big, y1: big }, // bottom
      { x0: -big, y0: -big, x1: 0, y1: big }, // left
      { x0: W - 12, y0: -big, x1: big, y1: big }, // right
    ]);
    // tile mask: any tile within 4px of text is off-limits for drawing
    cols = Math.ceil(W / CELL);
    rows = Math.ceil(H / CELL);
    blocked = new Uint8Array(cols * rows);
    for (const r of out) {
      const c0 = Math.max(0, Math.floor((r.x0 - 4) / CELL)), c1 = Math.min(cols - 1, Math.floor((r.x1 + 4) / CELL));
      const r0 = Math.max(0, Math.floor((r.y0 - 4) / CELL)), r1 = Math.min(rows - 1, Math.floor((r.y1 + 4) / CELL));
      for (let y = r0; y <= r1; y++) blocked.fill(1, y * cols + c0, y * cols + c1 + 1);
    }
  }

  // Random open spot with room for a koi, preferring the right side and
  // keeping away from other koi's targets.
  function pickWaypoint(from, self, anyDist = false) {
    const need = roomNeed();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 70; i++) {
        const x = pass < 2 ? W * rand(0.45, 1) : rand(0, W);
        const y = rand(TOP_BOUND, H);
        if (clearance(x, y) < need) continue;
        if (!anyDist && Math.hypot(x - from.x, y - from.y) < 140 * S) continue;
        if (self && koi.some((o) => o !== self && Math.hypot(o.target.x - x, o.target.y - y) < 160 * S)) continue;
        if (pass === 0 && !anyDist && !lineOfSight(from, { x, y }, need * 0.7)) continue;
        return { x, y };
      }
    }
    return null;
  }

  function desiredCount() {
    if (W >= 1700) return 4;
    if (W >= 1300) return 3;
    if (W >= 1000) return 2;
    return 1;
  }

  function resize() {
    W = hero.clientWidth;
    H = hero.clientHeight;
    S = clamp(W / 1500, 0.6, 1);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    collectObstacles();
    seedWater();
    reconcile();
    syncLoop();
  }

  // Make the number of koi match the space; hide the pond if there's no room.
  function reconcile() {
    active = W >= MIN_WIDTH && !!pickWaypoint({ x: W * 0.75, y: H / 2 }, null, true);
    canvas.style.display = active ? "" : "none";
    if (!active) { koi = []; pellets = []; ripples = []; bubbles = []; return; }
    for (const k of koi) {
      const h = k.spine[0];
      if (clearance(h.x, h.y) < roomNeed() * 0.45) k.leaving = true;
    }
    const want = desiredCount();
    while (koi.length > want) koi.pop();
    while (koi.length < want) {
      const at = pickWaypoint({ x: W * 0.8, y: H / 2 }, null, true);
      if (!at) break;
      koi.push(newKoi(at));
    }
  }

  // ---- feeding ------------------------------------------------------------
  const reachable = (x, y) => clearance(x, y) >= envelope(0) * 0.9;

  // A handful of feed bursts out from the click point and scatters around it.
  function onClick(e) {
    if (!active) return;
    if (e.target.closest("a, button, input, textarea, select, label")) return;
    if (String(window.getSelection?.() || "").length) return;
    const hr = hero.getBoundingClientRect();
    const x = e.clientX - hr.left, y = e.clientY - hr.top;
    if (clearance(x, y) < 24) return; // clicked on text
    const n = 8 + Math.floor(Math.random() * 5);
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

    // the wander target must always sit in open water; if the layout moved it
    // into a corner or onto text, relocate it instead of chasing it there
    if (clearance(t.x, t.y) < roomNeed() * 0.6) {
      const p = pickWaypoint(head, k, true);
      if (p) { t.x = p.x; t.y = p.y; k.waypoint = null; }
    }
    if (!k.waypoint || dist(k.waypoint, t) < 10) k.waypoint = pickWaypoint(t, k) || k.waypoint;
    if (k.waypoint) {
      const dx = k.waypoint.x - t.x, dy = k.waypoint.y - t.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = (dist(t, head) > 120 * S ? 8 : 45) * k.tempo;
      const wob = Math.sin(time * 1.3 + k.phase) * 0.35;
      t.x += (dx / d - (dy / d) * wob) * v * dt;
      t.y += (dy / d + (dx / d) * wob) * v * dt;
      pushOut(t, roomNeed() * 0.7);
    }

    // food beats wandering
    k.eatCd = Math.max(0, (k.eatCd || 0) - dt);
    let food = null;
    const anyFood = pellets.some((p) => p.landed && p.reach && dist(p, head) < 450 * S);
    if (!anyFood) k.notice = rand(0.2, 1.4); // each koi takes its own moment to notice
    else k.notice = Math.max(0, k.notice - dt);
    if (anyFood && k.notice === 0) {
      // nearest pellet, but one another koi is already after counts as farther,
      // so they fan out instead of all tracing the same line
      let best = Infinity;
      for (const p of pellets) {
        if (!p.landed || !p.reach) continue;
        const d = dist(p, head);
        if (d > 450 * S) continue;
        const taken = koi.some((o) => o !== k && o.food === p);
        const score = d + (taken ? 140 * S : 0) + (p === k.food ? -25 * S : 0);
        if (score < best) { best = score; food = p; }
      }
    }
    k.food = food;
    const goal = food || t;
    const goalD = dist(goal, head);

    // steering: toward the goal, away from text and other koi
    const pull = food && k.eatCd > 0 ? 0.25 : 1; // just ate: drift on, don't pirouette
    let ax = ((goal.x - head.x) / (goalD || 1)) * pull;
    let ay = ((goal.y - head.y) / (goalD || 1)) * pull;
    const fx = Math.cos(k.heading), fy = Math.sin(k.heading);
    const range = 95 * S + 20;
    for (const probe of [0, 35 * S, 70 * S]) {
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
          const rr = 80 * S;
          if (d >= rr || d < 0.001) continue;
          const f = ((1 - d / rr) ** 2) * (food ? 0.5 : 1.4);
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
    }
    let diff = Math.atan2(ay, ax) - k.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // fixed turning radius: turn rate scales with speed (slow koi turn slowly)
    const maxTurn = clamp(k.speed / (38 * S * k.turnR), 0.6, 2.2) * dt;
    k.heading += clamp(diff, -maxTurn, maxTurn) + Math.sin(time * k.wobF + k.wobA * 40) * k.wobA * dt;

    // burst-and-glide: tail beats hard to speed up, then the koi coasts
    let vmax, demand;
    if (food) {
      // eager but unhurried: brake to turn toward food that's off to the side,
      // and coast for a moment after each gulp
      vmax = clamp(goalD * 0.9, 12 * S, 85 * S);
      if (Math.abs(diff) > 0.9) vmax *= 0.4;
      demand = k.eatCd > 0 ? 0.12 : 0.75;
      k.glide = 0;
    } else {
      vmax = clamp(goalD * 1.1, 22 * S, 80 * S) * k.tempo;
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

    // eat one pellet per gulp, then a pause before the next
    if (food && k.eatCd === 0 && dist(food, head) < 9 * S + 5) {
      pellets.splice(pellets.indexOf(food), 1);
      ripples.push({ x: food.x, y: food.y, age: 0, life: 0.9, maxR: 22 * S });
      const nb = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < nb; i++) {
        bubbles.push({
          x: food.x + rand(-5, 5) * S, y: food.y + rand(-5, 5) * S,
          age: -i * rand(0.12, 0.22), life: rand(0.8, 1.1), size: rand(4.5, 7.5) * S,
          vx: rand(-6, 6), vy: -rand(16, 28),
        });
      }
      k.eatCd = rand(0.7, 1.4);
      k.food = null;
    }
    // the snout bumps floating feed aside
    const bump = 16 * S;
    for (const p of pellets) {
      if (!p.landed) continue;
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

  function update(dt) {
    time += dt;
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
    // a trapped koi fades out and reappears somewhere open
    for (let i = 0; i < koi.length; i++) {
      const k = koi[i], h = k.spine[0];
      if (clearance(h.x, h.y, obstacles) < 2) k.leaving = true;
      if (k.leaving && k.fade === 0) {
        const at = pickWaypoint({ x: W * 0.8, y: H / 2 }, k, true);
        if (at) koi[i] = newKoi(at);
      }
    }
  }

  // ---- rendering ----------------------------------------------------------
  const isDark = () => document.body.classList.contains("dark-mode");

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
    const gap = 40;
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
    ctx.fillStyle = dark ? "#94a3b8" : "#64748b";
    for (const d of waterDots) {
      const col = Math.floor(d.x / CELL), row = Math.floor(d.y / CELL);
      if (isBlocked(col, row)) continue;
      const tw = 0.5 + 0.5 * Math.sin(time * d.tw + d.ph);
      ctx.globalAlpha = 0.1 + 0.26 * tw;
      ctx.fillText(tw > 0.7 ? "~" : "-", (col + 0.5) * CELL, (row + 0.5) * CELL);
    }
  }

  // Rasterise one koi into `cells` (Map key -> tile).
  function rasterKoi(k, cells, dark) {
    KS = k.size;
    const R = maxR();
    const base = rgb((dark && k.v.dark?.base) || k.v.base);
    const patch = rgb(k.v.patch);
    const spot = k.v.spot ? rgb(k.v.spot) : null;
    const fin = rgb(k.v.fin);
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
        eyeCells.add(`${Math.floor((p.x + p.nx * side * r) / CELL)},${Math.floor((p.y + p.ny * side * r) / CELL)}`);
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
    const tail = q[N - Math.round(N * (TOTAL - 1) / TOTAL)];

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const key = `${col},${row}`;
        const prev = cells.get(key);
        if (prev && prev.kind === "body") continue;
        const px = (col + 0.5) * CELL, py = (row + 0.5) * CELL;

        let best = Infinity, bs = 0, blat = 0;
        for (let j = 0; j < N; j++) {
          const A = q[j], B = q[j + 1];
          const vx = B.x - A.x, vy = B.y - A.y;
          const len2 = vx * vx + vy * vy || 1;
          const tt = clamp(((px - A.x) * vx + (py - A.y) * vy) / len2, 0, 1);
          const cx = A.x + vx * tt, cy = A.y + vy * tt;
          const d = Math.hypot(px - cx, py - cy);
          if (d < best) {
            best = d;
            bs = A.s + (B.s - A.s) * tt;
            blat = ((px - cx) * -vy + (py - cy) * vx) < 0 ? d : -d;
          }
        }

        let cell = null;
        if (bs <= 1) {
          const r = bodyR(bs);
          if (best < r) {
            const depth = 1 - best / r;
            const tn = blat / r;
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
            // round-body shading: darker toward the flanks, sheen along the back
            c = mixA(c, [60, 52, 48], (1 - depth) ** 2 * (lum(c) > 0.7 ? 0.3 : 0.4));
            if (depth > 0.7) c = mixA(c, [255, 255, 255], (depth - 0.7) * 0.4);
            cell = eyeCells.has(key)
              ? { kind: "body", fill: [24, 22, 22], glyph: "o", gcol: [240, 240, 240], ga: 1, edge: 1 }
              : {
                kind: "body", fill: c,
                glyph: ridge ? "=" : BODY_GLYPHS[Math.min(BODY_GLYPHS.length - 1, Math.floor(depth * BODY_GLYPHS.length))],
                gcol: lum(c) > 0.5 ? mixA(c, INK, 0.45) : mixA(c, PAPER, 0.4), ga: 0.4,
                edge: 0.55 + 0.45 * Math.min(1, depth / 0.18), // soften the silhouette
              };
          }
        } else {
          // long forked tail fin
          const u = (bs - 1) / (TOTAL - 1);
          const fr = R * (0.2 + 0.95 * u ** 0.8);
          const notch = u > 0.55 && Math.abs(blat) < fr * (u - 0.55) * 1.4;
          if (best < fr && !notch) {
            const ray = Math.floor(Math.atan2(py - tail.y, px - tail.x) * 9) & 1; // alternating fin rays
            cell = { kind: "fin", fill: fin, fa: (0.3 + 0.3 * (1 - best / fr)) * (ray ? 1 : 0.7), glyph: rayGlyph(px - tail.x, py - tail.y) };
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
        if (cell && (!prev || cell.kind === "body")) {
          cell.fade = k.fade;
          cells.set(key, cell);
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
    drawWater(dark);

    // ripple rings
    ctx.fillStyle = dark ? "#cbd5e1" : "#475569";
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
        ctx.globalAlpha = 0.45 * (1 - p);
        ctx.fillText("~", (col + 0.5) * CELL, (row + 0.5) * CELL);
      }
    }

    if (!koi.length) { ctx.globalAlpha = 1; return; }
    const cells = new Map();
    for (const k of koi) rasterKoi(k, cells, dark);
    KS = 1;

    // soft tile shadow, offset like light from the upper left
    ctx.fillStyle = dark ? "#000000" : "#94a3b8";
    for (const [key, c] of cells) {
      if (c.kind !== "body") continue;
      const [col, row] = key.split(",").map(Number);
      const sc = col + 1, sr = row + 2;
      if (cells.has(`${sc},${sr}`) || isBlocked(sc, sr)) continue;
      ctx.globalAlpha = (dark ? 0.28 : 0.14) * c.fade;
      ctx.fillRect(sc * CELL + 0.5, sr * CELL + 0.5, CELL - 1, CELL - 1);
    }

    // feed: little bobbing pellets, each with its own shadow
    const ps = Math.max(4, Math.round(5 * S + 1));
    for (const p of pellets) {
      const col = Math.floor(p.x / CELL), row = Math.floor(p.y / CELL);
      if (isBlocked(col, row) || cells.get(`${col},${row}`)?.kind === "body") continue;
      const fade = Math.min(1, (p.life - p.age) / 3);
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

    // koi tiles
    for (const [key, c] of cells) {
      const [col, row] = key.split(",").map(Number);
      if (isBlocked(col, row)) continue;
      const x = col * CELL, y = row * CELL;
      if (c.kind === "body") {
        ctx.globalAlpha = 0.97 * c.edge * c.fade;
        ctx.fillStyle = css(c.fill);
        ctx.fillRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        if (c.glyph !== " ") {
          ctx.globalAlpha = c.ga * c.fade;
          ctx.fillStyle = css(c.gcol);
          ctx.fillText(c.glyph, x + CELL / 2, y + CELL / 2 + 0.5);
        }
      } else {
        // fins: translucent tiles with ray glyphs
        ctx.globalAlpha = c.fa * c.fade;
        ctx.fillStyle = css(c.fill);
        ctx.fillRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        ctx.globalAlpha = 0.55 * c.fade;
        ctx.fillStyle = css(lum(c.fill) > 0.5 ? mixA(c.fill, INK, 0.5) : mixA(c.fill, PAPER, 0.5));
        ctx.fillText(c.glyph, x + CELL / 2, y + CELL / 2 + 0.5);
      }
    }
    drawBubbles(dark);
    ctx.globalAlpha = 1;
  }

  // Eating bubbles, in ASCII: `.` -> `o` -> `O` as they swell and rise, then
  // `*` as they pop, with `'` specks flying out. Snapped to the tile grid.
  function drawBubbles(dark) {
    const ink = dark ? "#e2e8f0" : "#475569";
    const at = (x, y, ch, px, alpha) => {
      const col = Math.floor(x / CELL), row = Math.floor(y / CELL);
      if (isBlocked(col, row)) return;
      ctx.font = `bold ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.globalAlpha = alpha;
      const x0 = (col + 0.5) * CELL, y0 = (row + 0.5) * CELL;
      ctx.strokeText(ch, x0, y0); // dark outline so it reads on fish and water alike
      ctx.fillText(ch, x0, y0);
    };
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
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
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    obstacleTimer += dt;
    if (obstacleTimer > 0.5) { obstacleTimer = 0; collectObstacles(); }
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
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
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; syncLoop(); }).observe(hero);
  document.addEventListener("visibilitychange", syncLoop);
  document.fonts?.ready.then(() => { collectObstacles(); });
  if (!reduceMotion) hero.addEventListener("click", onClick);
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
        return { minClear, n: koi.length, active, S, W, pellets: pellets.length, landed: pellets.filter((p) => p.landed).length, bubbles: bubbles.map((b) => [b.x | 0, b.y | 0, +b.age.toFixed(2)]) };
      },
      feed: (x, y) => onClick({ target: hero, clientX: x + hero.getBoundingClientRect().left, clientY: y + hero.getBoundingClientRect().top }),
      heads: () => koi.map((k) => [k.spine[0].x | 0, k.spine[0].y | 0, k.v.name]),
      place(i, x, y) {
        const k = koi[i];
        k.spine.forEach((p, j) => { p.x = x; p.y = y + j * seg(); });
        k.heading = -Math.PI / 2;
      },
      state: () => koi.map((k) => ({ fade: +k.fade.toFixed(2), leaving: k.leaving, speed: +(k.speed / S).toFixed(1), phase: k.phase, heading: k.heading })),
    };
  }
}

const hero = document.querySelector(".hero");
if (hero) initPond(hero);
