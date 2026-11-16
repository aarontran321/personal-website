// ASCII koi that swims through the hero's empty space.
//
// A small "lead pixel" wanders between open spots (mostly on the right side);
// the koi chases it. The koi's body is a follow-the-leader spine with a
// travelling swim wave, rasterised every frame onto a monospace character grid.
// Every text block in the hero is an obstacle: the head steers away from them,
// each spine point is pushed out of them, and as a last guarantee no character
// is ever drawn inside one.

const hero = document.querySelector(".hero");
if (hero) initKoi(hero);

function initKoi(hero) {
  // ---- tunables -----------------------------------------------------------
  const FONT_PX = 10;
  const CELL_H = 9;
  const BODY_LEN = 170; // head to base of tail fin, px
  const TOTAL = 1.22; // spine length incl. tail fin, in body lengths
  const N = 30; // spine segments
  const SEG = (BODY_LEN * TOTAL) / N;
  const MAX_R = 27; // half-width at the widest point
  const CLEAR = 14; // minimum gap kept between the koi and any text
  const TOP_BOUND = 90; // stay below the fixed site header
  const MIN_WIDTH = 900; // below this there's no real whitespace to swim in
  const RAMP = ".:-=+*#%@";
  const FIN_RAMP = ".-~=";

  const canvas = document.createElement("canvas");
  canvas.className = "koi-canvas";
  canvas.setAttribute("aria-hidden", "true");
  hero.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, cellW = 6;
  let obstacles = []; // text rects, hero-local coords
  let walls = []; // obstacles + out-of-bounds slabs (physics only)
  let spine = [];
  let lead = null, waypoint = null;
  let heading = Math.PI; // facing left
  let speed = 40, phase = 0, time = 0, fade = 0;
  let trail = [], trailTimer = 0;
  let running = false, visible = true, raf = 0, last = 0, active = false;

  // ---- geometry helpers ---------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
        // inside: leave by the nearest edge
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
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 10));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (clearance(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) < need) return false;
    }
    return true;
  }

  // ---- body shape ---------------------------------------------------------
  // s: 0 at the snout, 1 at the base of the tail fin.
  function bodyR(s) {
    if (s < 0.25) return MAX_R * (0.55 + 0.45 * Math.sin((s / 0.25) * Math.PI / 2));
    return MAX_R * (1 - 0.85 * Math.pow((s - 0.25) / 0.75, 1.3));
  }

  // Half-width the physics keeps clear around each spine point (fins included).
  function envelope(s) {
    const wave = 7 * Math.pow(Math.min(s, 1), 1.4);
    const fins = s < 0.75 ? MAX_R * 0.9 : s <= 1 ? 0 : MAX_R * 1.2;
    return Math.max(s <= 1 ? bodyR(s) : 0, fins) + wave + CLEAR;
  }

  const ORANGE = [
    [0.06, 0, 0.07, 0.9], [0.3, 0.4, 0.08, 0.5], [0.44, -0.35, 0.07, 0.55],
    [0.66, 0.15, 0.08, 0.6],
  ];
  const BLACK = [[0.5, 0.55, 0.035, 0.35], [0.72, -0.6, 0.03, 0.3], [0.24, -0.65, 0.03, 0.3]];

  function inBlobs(blobs, s, t) {
    const wobble = 0.22 * Math.sin(s * 41 + t * 5) + 0.12 * Math.sin(s * 17 - t * 9);
    for (const [s0, t0, rs, rt] of blobs) {
      const v = ((s - s0) / rs) ** 2 + ((t - t0) / rt) ** 2;
      if (v < 1 + wobble) return true;
    }
    return false;
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
    walls = out.concat([
      { x0: -big, y0: -big, x1: big, y1: TOP_BOUND }, // top (header)
      { x0: -big, y0: H, x1: big, y1: big }, // bottom
      { x0: -big, y0: -big, x1: 0, y1: big }, // left
      { x0: W - 12, y0: -big, x1: big, y1: big }, // right
    ]);
  }

  function resize() {
    W = hero.clientWidth;
    H = hero.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT_PX}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = "top";
    cellW = Math.ceil(ctx.measureText("M").width);
    collectObstacles();
    const wasActive = active;
    active = W >= MIN_WIDTH && !!pickWaypoint({ x: W * 0.75, y: H / 2 }, true);
    canvas.style.display = active ? "" : "none";
    if (active && (!wasActive || !spine.length)) spawn();
    syncLoop();
  }

  function pickWaypoint(from, anyDist = false) {
    for (let pass = 0; pass < 2; pass++) {
      const need = pass === 0 ? 100 : 80;
      for (let i = 0; i < 80; i++) {
        const x = W * (0.45 + Math.random() * 0.55); // home turf: right side
        const y = TOP_BOUND + Math.random() * (H - TOP_BOUND);
        const p = { x, y };
        if (clearance(x, y) < need) continue;
        if (!anyDist && Math.hypot(x - from.x, y - from.y) < 160) continue;
        if (pass === 0 && !anyDist && !lineOfSight(from, p, 70)) continue;
        return p;
      }
    }
    return null;
  }

  function spawn() {
    const p = pickWaypoint({ x: W * 0.8, y: H / 2 }, true);
    if (!p) return;
    lead = { x: p.x - 40, y: p.y };
    heading = Math.PI;
    spine = [];
    for (let i = 0; i <= N; i++) spine.push({ x: p.x + i * SEG, y: p.y });
    for (let i = 0; i <= N; i++) pushOut(spine[i], envelope((i / N) * TOTAL));
    waypoint = pickWaypoint(lead);
    trail = [];
    fade = reduceMotion ? 1 : 0;
  }

  // ---- simulation ---------------------------------------------------------
  function update(dt) {
    time += dt;
    fade = Math.min(1, fade + dt / 1.5);
    const head = spine[0];
    const distLead = Math.hypot(lead.x - head.x, lead.y - head.y);

    // lead pixel: glides toward its waypoint, waits if the koi falls behind
    if (!waypoint || Math.hypot(waypoint.x - lead.x, waypoint.y - lead.y) < 10) {
      waypoint = pickWaypoint(lead) || waypoint;
    }
    if (waypoint) {
      const dx = waypoint.x - lead.x, dy = waypoint.y - lead.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = distLead > 120 ? 8 : 52;
      const wob = Math.sin(time * 1.3) * 0.35;
      const ux = dx / d, uy = dy / d;
      lead.x += (ux - uy * wob) * v * dt;
      lead.y += (uy + ux * wob) * v * dt;
      pushOut(lead, 70);
    }
    trailTimer += dt;
    if (trailTimer > 0.09) {
      trailTimer = 0;
      trail.unshift({ x: lead.x, y: lead.y });
      trail.length = Math.min(trail.length, 5);
    }

    // head: chase the lead, steer around text
    let ax = (lead.x - head.x) / (distLead || 1);
    let ay = (lead.y - head.y) / (distLead || 1);
    const fx = Math.cos(heading), fy = Math.sin(heading);
    for (const probe of [0, 35, 70]) {
      const px = head.x + fx * probe, py = head.y + fy * probe;
      for (const r of walls) {
        const cx = clamp(px, r.x0, r.x1), cy = clamp(py, r.y0, r.y1);
        const dx = px - cx, dy = py - cy;
        const d = Math.hypot(dx, dy);
        const range = 95;
        if (d >= range || d < 0.001) continue;
        const k = ((1 - d / range) ** 2) * 2.2;
        ax += (dx / d) * k;
        ay += (dy / d) * k;
      }
    }
    const want = Math.atan2(ay, ax);
    let diff = want - heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // turning radius grows with speed so the body can't fold into a U
    const maxTurn = Math.max(1.1, speed / 40) * dt;
    heading += clamp(diff, -maxTurn, maxTurn) + Math.sin(time * 2.1) * 0.15 * dt;

    const targetSpeed = clamp(distLead * 1.1, 22, 95);
    speed += (targetSpeed - speed) * Math.min(1, dt * 2);
    head.x += Math.cos(heading) * speed * dt;
    head.y += Math.sin(heading) * speed * dt;
    pushOut(head, envelope(0));
    phase += dt * (3 + speed * 0.05);

    // body: follow the leader with a bend limit so it can't fold over itself
    const MAX_BEND = 0.12;
    for (let i = 1; i <= N; i++) {
      const a = spine[i - 1], b = spine[i];
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      const prevAng = i === 1 ? heading + Math.PI
        : Math.atan2(a.y - spine[i - 2].y, a.x - spine[i - 2].x);
      let d = Math.atan2(Math.sin(ang - prevAng), Math.cos(ang - prevAng));
      ang = prevAng + clamp(d, -MAX_BEND, MAX_BEND);
      b.x = a.x + Math.cos(ang) * SEG;
      b.y = a.y + Math.sin(ang) * SEG;
      pushOut(b, envelope((i / N) * TOTAL));
    }

    // stuck somewhere it can't get out of (e.g. layout shifted under it)
    if (clearance(head.x, head.y, obstacles) < 2) spawn();
  }

  // ---- rendering ----------------------------------------------------------
  function palette() {
    const dark = document.body.classList.contains("dark-mode");
    return dark
      ? { white: "#e2e8f0", orange: "#fb923c", black: "#64748b", fin: "#94a3b8", eye: "#0f172a", lead: "#60a5fa" }
      : { white: "#94a3b8", orange: "#f97316", black: "#1e293b", fin: "#94a3b8", eye: "#0f172a", lead: "#2563eb" };
  }

  function cellBlocked(col, row) {
    const x0 = col * cellW - 4, y0 = row * CELL_H - 4;
    const x1 = x0 + cellW + 8, y1 = y0 + CELL_H + 8;
    for (const r of obstacles) {
      if (x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0) return true;
    }
    return false;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!spine.length) return;
    const pal = palette();

    // rendered spine = physics spine + travelling swim wave
    const amp = 3 + Math.min(speed, 95) * 0.045;
    const q = spine.map((p, i) => {
      const s = (i / N) * TOTAL;
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(N, i + 1)];
      const tx = a.x - b.x, ty = a.y - b.y;
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      const w = amp * Math.pow(Math.min(s, 1.1), 1.4) * Math.sin(phase - s * 5.5);
      return { x: p.x + nx * w, y: p.y + ny * w, fx: tx / tl, fy: ty / tl, nx, ny, s };
    });

    // fins: [s, size] — pectoral then pelvic
    const fins = [];
    for (const [s, size] of [[0.2, 1], [0.58, 0.55]]) {
      const idx = Math.round((s / TOTAL) * N);
      const p = q[idx];
      for (const side of [-1, 1]) {
        const flap = 0.95 + 0.3 * Math.sin(phase * 0.6 + side * 1.3 + s * 4);
        // backward direction rotated outward by `flap`
        const axx = -p.fx * Math.cos(flap) + p.nx * side * Math.sin(flap);
        const axy = -p.fy * Math.cos(flap) + p.ny * side * Math.sin(flap);
        const a = MAX_R * 1.0 * size, bb = MAX_R * 0.38 * size;
        const r0 = bodyR(s) * 0.75;
        fins.push({
          cx: p.x + p.nx * side * r0 + axx * a * 0.85,
          cy: p.y + p.ny * side * r0 + axy * a * 0.85,
          ux: axx, uy: axy, a, b: bb,
        });
      }
    }

    // eyes
    const eyes = [];
    {
      const idx = Math.round((0.07 / TOTAL) * N);
      const p = q[idx], r = bodyR(0.07) * 0.6;
      for (const side of [-1, 1]) eyes.push({ x: p.x + p.nx * side * r, y: p.y + p.ny * side * r });
    }

    // bounding box in cells
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of q) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = MAX_R * 1.8;
    const c0 = Math.max(0, Math.floor((minX - pad) / cellW)), c1 = Math.ceil((maxX + pad) / cellW);
    const r0 = Math.max(0, Math.floor((minY - pad) / CELL_H)), r1 = Math.ceil((maxY + pad) / CELL_H);

    const eyeCells = new Set(eyes.map((e) => `${Math.floor(e.x / cellW)},${Math.floor(e.y / CELL_H)}`));

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const px = (col + 0.5) * cellW, py = (row + 0.5) * CELL_H;

        // nearest point on the spine polyline
        let best = Infinity, bs = 0, blat = 0;
        for (let j = 0; j < N; j++) {
          const A = q[j], B = q[j + 1];
          const vx = B.x - A.x, vy = B.y - A.y;
          const len2 = vx * vx + vy * vy || 1;
          const t = clamp(((px - A.x) * vx + (py - A.y) * vy) / len2, 0, 1);
          const cx = A.x + vx * t, cy = A.y + vy * t;
          const d = Math.hypot(px - cx, py - cy);
          if (d < best) {
            best = d;
            bs = A.s + (B.s - A.s) * t;
            // signed lateral: + on the left of the swim direction
            blat = ((px - cx) * -vy + (py - cy) * vx) < 0 ? d : -d;
          }
        }

        let ch = null, color = null, alpha = 1;

        if (bs <= 1) {
          const r = bodyR(bs);
          if (best < r) {
            const depth = 1 - best / r;
            const t = blat / r;
            if (eyeCells.has(`${col},${row}`)) {
              ch = "o"; color = pal.eye;
            } else {
              ch = RAMP[Math.min(RAMP.length - 1, Math.floor(depth * RAMP.length))];
              color = inBlobs(BLACK, bs, t) ? pal.black : inBlobs(ORANGE, bs, t) ? pal.orange : pal.white;
              alpha = 0.55 + 0.45 * depth;
            }
          }
        } else {
          // forked tail fin
          const u = (bs - 1) / (TOTAL - 1);
          const fr = MAX_R * (0.25 + 0.7 * u);
          const notch = u > 0.65 && Math.abs(blat) < fr * (u - 0.65) * 1.6;
          if (best < fr && !notch) {
            ch = FIN_RAMP[Math.min(FIN_RAMP.length - 1, Math.floor((1 - best / fr) * FIN_RAMP.length))];
            color = pal.fin; alpha = 0.75;
          }
        }

        if (!ch) {
          for (const f of fins) {
            const dx = px - f.cx, dy = py - f.cy;
            const u = dx * f.ux + dy * f.uy, v = -dx * f.uy + dy * f.ux;
            const e = (u / f.a) ** 2 + (v / f.b) ** 2;
            if (e < 1) {
              ch = FIN_RAMP[Math.min(FIN_RAMP.length - 1, Math.floor((1 - e) * FIN_RAMP.length))];
              color = pal.fin; alpha = 0.7;
              break;
            }
          }
        }

        if (!ch || cellBlocked(col, row)) continue;
        ctx.globalAlpha = alpha * fade;
        ctx.fillStyle = color;
        ctx.fillText(ch, col * cellW, row * CELL_H);
      }
    }

    // lead pixel and its little wake
    ctx.fillStyle = pal.lead;
    trail.forEach((p, i) => {
      const col = Math.floor(p.x / cellW), row = Math.floor(p.y / CELL_H);
      if (cellBlocked(col, row)) return;
      ctx.globalAlpha = (0.45 - i * 0.08) * fade;
      ctx.fillText(".", col * cellW, row * CELL_H);
    });
    const lc = Math.floor(lead.x / cellW), lr = Math.floor(lead.y / CELL_H);
    if (!cellBlocked(lc, lr)) {
      ctx.globalAlpha = (0.75 + 0.25 * Math.sin(time * 4)) * fade;
      ctx.fillText("*", lc * cellW, lr * CELL_H);
    }
    ctx.globalAlpha = 1;
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
    if (active && reduceMotion) draw(); // static koi
  }

  new ResizeObserver(resize).observe(hero);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; syncLoop(); }).observe(hero);
  document.addEventListener("visibilitychange", syncLoop);
  document.fonts?.ready.then(() => { collectObstacles(); });
  resize();
}
