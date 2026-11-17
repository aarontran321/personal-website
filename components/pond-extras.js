// Add-ons for the koi pond, used by the local demo pages. Each export is a
// factory for hero.koiPond.use(): it gets the pond's api and returns
// { update(dt), drawUnder(ctx, dark), drawOver(ctx, dark) }.
// Everything is drawn on the same square tile grid as the koi.

const TAU = Math.PI * 2;

// one square tile, with the same hairline gap the koi tiles have
function tile(ctx, api, col, row, color, a) {
  if (a < 0.02 || api.isBlocked(col, row)) return;
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillRect(col * api.CELL, row * api.CELL, api.CELL - 0.5, api.CELL - 0.5);
}

// ---- a school of small fish -------------------------------------------------
// Little silver fish that swim as one group (boids) and scatter from koi.
export function minnows(api, count = 16) {
  const fish = [];
  const self = { on: true, update, drawUnder };
  let goal = null, goalT = 0;

  function spawn() {
    fish.length = 0;
    const cx = api.W * api.rand(0.3, 0.7), cy = api.rand(api.topBound + 80, api.H - 80);
    const h = api.rand(0, TAU);
    for (let i = 0; i < count; i++) {
      fish.push({
        x: cx + api.rand(-50, 50), y: cy + api.rand(-40, 40),
        vx: Math.cos(h) * 40, vy: Math.sin(h) * 40,
        ph: api.rand(0, TAU), size: api.rand(0.8, 1.15), tone: Math.random(),
      });
    }
  }

  function update(dt) {
    if (!fish.length && api.W) spawn();
    const S = api.S, W = api.W, H = api.H;
    goalT -= dt;
    if (!goal || goalT <= 0) {
      goal = { x: api.rand(W * 0.1, W * 0.9), y: api.rand(api.topBound + 60, H - 60) };
      goalT = api.rand(5, 10);
    }
    const koi = api.koi();
    for (const f of fish) {
      let ax = 0, ay = 0, cx = 0, cy = 0, avx = 0, avy = 0, n = 0;
      for (const o of fish) {
        if (o === f) continue;
        const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
        if (d > 70 * S) continue;
        n++; cx += o.x; cy += o.y; avx += o.vx; avy += o.vy;
        if (d < 14 * S && d > 0.01) { ax -= (dx / d) * (14 * S - d) * 6; ay -= (dy / d) * (14 * S - d) * 6; }
      }
      if (n) {
        ax += (cx / n - f.x) * 0.8 + (avx / n - f.vx) * 0.9;
        ay += (cy / n - f.y) * 0.8 + (avy / n - f.vy) * 0.9;
      }
      // drift toward the school's goal
      const gx = goal.x - f.x, gy = goal.y - f.y, gd = Math.hypot(gx, gy) || 1;
      ax += (gx / gd) * 18; ay += (gy / gd) * 18;
      // dart away from koi
      let scared = 0;
      for (const k of koi) {
        if (k.fade < 0.3) continue;
        const dx = f.x - k.x, dy = f.y - k.y, d = Math.hypot(dx, dy);
        const R = 120 * S;
        if (d < R && d > 0.01) {
          const s = (1 - d / R) ** 2;
          ax += (dx / d) * s * 900; ay += (dy / d) * s * 900;
          scared = Math.max(scared, s);
        }
      }
      // stay in the pond
      const m = 40 * S;
      if (f.x < m) ax += (m - f.x) * 4;
      if (f.x > W - m) ax -= (f.x - (W - m)) * 4;
      if (f.y < api.topBound + m) ay += (api.topBound + m - f.y) * 4;
      if (f.y > H - m) ay -= (f.y - (H - m)) * 4;

      f.vx += ax * dt; f.vy += ay * dt;
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const max = (55 + 120 * scared) * S, min = 22 * S;
      const k = sp > max ? max / sp : sp < min ? min / sp : 1;
      f.vx *= k; f.vy *= k;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.ph += dt * (6 + sp / (8 * S));
    }
  }

  function drawUnder(ctx, dark) {
    const C = api.CELL;
    for (const f of fish) {
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const ux = f.vx / sp, uy = f.vy / sp;
      const nx = -uy, ny = ux;
      const len = 4 * f.size; // tiles, nose to tail
      const back = dark ? [148, 163, 184] : [96, 112, 128];
      const belly = dark ? [203, 213, 225] : [168, 180, 192];
      const seen = new Set();
      for (let i = 0; i <= len; i += 0.5) {
        const t = i / len;
        const wag = Math.sin(f.ph - t * 3) * t * t * 0.9 * C;
        const x = f.x - ux * i * C + nx * wag, y = f.y - uy * i * C + ny * wag;
        const col = Math.floor(x / C), row = Math.floor(y / C);
        const key = col * 65536 + row;
        if (seen.has(key)) continue;
        seen.add(key);
        const c = t < 0.15 ? belly : t > 0.8 ? belly : (f.tone > 0.5 ? back : belly);
        tile(ctx, api, col, row, `rgb(${c[0]},${c[1]},${c[2]})`, t > 0.8 ? 0.45 : 0.85);
      }
    }
  }

  return self;
}

// ---- lily pads ----------------------------------------------------------------
// Round pads with a notch, veins in ASCII and the odd lotus flower. They drift
// slowly and turn, and the koi swim underneath.
export function lilyPads(api, count = 0) {
  // count 0 = automatic: a few on wide screens, fewer on half screens
  const pads = [];
  const self = { on: true, update, drawOver };
  let lastW = 0, lastH = 0, checkT = 0;
  // A set layout rather than random scatter: four pads in an evenly spaced,
  // loose diagonal down the right-hand side of the pond (fractions of the pond's
  // width and height), the second and fourth with a lotus. Narrower screens use
  // fewer of them; phones get none, since the text covers nearly all the water.
  const SPOTS = {
    a: [0.915, 0.24], // top right
    b: [0.77, 0.44], // middle
    c: [0.645, 0.75], // lower left of the group
    d: [0.87, 0.87], // bottom right
  };
  // by how wide the window looks on screen, so browser zoom doesn't change it
  const viewW = () => api.viewW || api.W;
  const layout = () => {
    const W = viewW();
    if (W >= 1100) return ["a", "b", "c", "d"];
    if (W >= 820) return ["a", "b", "d"];
    if (W >= 600) return ["b", "d"];
    return [];
  };
  // pads get smaller as the window narrows (on top of the pond's own scale)
  const padScale = () => api.S * Math.min(1.1, Math.max(0.72, viewW() / 1400));

  // Each pad goes at its spot, or if text is in the way, the nearest clear
  // point around it: well away from the text and the other pads.
  function findSpot(name, size, skip) {
    const S = api.S, W = api.W, H = api.H;
    const [fx, fy] = SPOTS[name];
    const r = size * padScale();
    const m = r + 18 * S;
    const ax = fx * W, ay = fy * H;
    const ok = (x, y) =>
      x > m && x < W - m && y > api.topBound + r + 40 * S && y < H - r - 30 * S &&
      api.clearance(x, y) >= r + 36 * S &&
      !pads.some((p) => p !== skip && p.zone !== name && !p.gone && p.target &&
        Math.hypot(p.target.x - x, p.target.y - y) < p.target.r + r + 50 * S);
    if (ok(ax, ay)) return { x: ax, y: ay, r };
    for (let ring = 1; ring <= 12; ring++) {
      const d = ring * 14 * S;
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * TAU;
        const x = ax + Math.cos(t) * d, y = ay + Math.sin(t) * d;
        if (ok(x, y)) return { x, y, r };
      }
    }
    return null; // no room near this spot on this screen: leave it out
  }

  function newPad(zone) {
    return {
      zone, size: api.rand(27, 33), r: 0, x: 0, y: 0, home: null, target: null,
      a: api.rand(0, TAU), spin: api.rand(-0.04, 0.04),
      notch: api.rand(0.35, 0.55), seed: api.rand(0, 100),
      flower: zone === "b" || zone === "d", hue: Math.random(), f: 0,
    };
  }

  // Work out where every pad belongs for the current window. Pads that are
  // already showing glide there and resize (so dragging the window edge moves
  // them along smoothly); new ones fade in; ones with no room fade out.
  function layoutPads() {
    const want = layout();
    for (const p of pads) if (!want.includes(p.zone)) p.gone = true;
    for (const z of want) if (!pads.some((p) => p.zone === z && !p.gone)) pads.push(newPad(z));
    for (const p of pads) {
      if (p.gone) continue;
      const spot = findSpot(p.zone, p.size, p);
      if (!spot) { p.gone = true; continue; }
      p.target = spot;
      if (!p.home) { p.home = { x: spot.x, y: spot.y }; p.r = spot.r; }
    }
    lastW = api.W; lastH = api.H;
  }

  function update(dt) {
    if (!api.W) return;
    if (api.W !== lastW || api.H !== lastH) layoutPads();
    // every so often: check the text hasn't reflowed onto a pad
    checkT -= dt;
    if (checkT <= 0) { checkT = 1; layoutPads(); }
    const t = api.time, ease = 1 - Math.exp(-dt * 6);
    for (const p of pads) {
      p.f = p.gone ? Math.max(0, p.f - dt / 0.6) : Math.min(1, p.f + dt / 1.2); // fade in / out
      if (p.target) {
        p.home.x += (p.target.x - p.home.x) * ease;
        p.home.y += (p.target.y - p.home.y) * ease;
        p.r += (p.target.r - p.r) * ease;
      }
      p.a += p.spin * dt;
      // bob gently around its spot rather than wandering off
      p.x = p.home.x + Math.sin(t * 0.13 + p.seed) * 6 * api.S;
      p.y = p.home.y + Math.cos(t * 0.11 + p.seed * 1.3) * 5 * api.S;
    }
    for (let i = pads.length - 1; i >= 0; i--) if (pads[i].gone && pads[i].f === 0) pads.splice(i, 1);
  }

  function drawOver(ctx, dark) {
    const C = api.CELL;
    const leaf = dark ? [62, 110, 62] : [104, 150, 84];
    const rim = dark ? [82, 135, 76] : [134, 178, 108];
    const vein = dark ? "#a7d18f" : "#3f6b33";
    const shadow = dark ? "#000000" : "#64748b";
    for (const p of pads) {
      if (!p.home) continue;
      const f = p.f;
      const c0 = Math.floor((p.x - p.r) / C), c1 = Math.ceil((p.x + p.r) / C);
      const r0 = Math.floor((p.y - p.r) / C), r1 = Math.ceil((p.y + p.r) / C);
      // soft shadow on the water, down and to the right
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const dx = (col + 0.5) * C - p.x, dy = (row + 0.5) * C - p.y;
          if (Math.hypot(dx, dy) < p.r) tile(ctx, api, col + 1, row + 2, shadow, (dark ? 0.22 : 0.1) * f);
        }
      }
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const dx = (col + 0.5) * C - p.x, dy = (row + 0.5) * C - p.y;
          const d = Math.hypot(dx, dy);
          if (d >= p.r) continue;
          let ang = Math.atan2(dy, dx) - p.a;
          ang = Math.atan2(Math.sin(ang), Math.cos(ang));
          if (Math.abs(ang) < p.notch * (0.25 + 0.75 * d / p.r) && d > p.r * 0.12) continue; // the notch
          const edge = d / p.r;
          const c = edge > 0.82 ? rim : leaf;
          const shade = 0.88 + 0.12 * Math.sin(ang * 3 + p.seed);
          tile(ctx, api, col, row, `rgb(${c[0] * shade | 0},${c[1] * shade | 0},${c[2] * shade | 0})`, 0.95 * f);
          // veins radiating from the centre
          const veinAng = ((ang + TAU) % (TAU / 9)) / (TAU / 9);
          const isVein = (veinAng < 0.16 || veinAng > 0.84) && d > p.r * 0.15 && edge < 0.9;
          const g = isVein ? (Math.abs(Math.cos(ang + p.a)) > 0.7 ? "-" : Math.abs(Math.sin(ang + p.a)) > 0.7 ? "|" : (Math.cos(ang + p.a) * Math.sin(ang + p.a) > 0 ? "\\" : "/")) : d < p.r * 0.12 ? "o" : null;
          if (g && !api.isBlocked(col, row)) {
            ctx.globalAlpha = 0.42 * f;
            api.stamp(g, vein, col, row);
          }
        }
      }
      if (p.flower) drawLotus(ctx, p, dark, f);
    }
  }

  // a lotus sitting on the pad: pink petals around a yellow centre
  function drawLotus(ctx, p, dark, f) {
    const C = api.CELL;
    const fx = p.x + Math.cos(p.a + Math.PI) * p.r * 0.35, fy = p.y + Math.sin(p.a + Math.PI) * p.r * 0.35;
    const R = p.r * 0.48;
    const pink = p.hue > 0.5 ? [240, 150, 180] : [246, 182, 204];
    const deep = [226, 104, 146];
    const c0 = Math.floor((fx - R) / C), c1 = Math.ceil((fx + R) / C);
    const r0 = Math.floor((fy - R) / C), r1 = Math.ceil((fy + R) / C);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dx = (col + 0.5) * C - fx, dy = (row + 0.5) * C - fy;
        const d = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx) + api.time * 0.05;
        const petal = R * (0.7 + 0.3 * Math.abs(Math.cos(ang * 4)));
        if (d >= petal) continue;
        let c;
        if (d < R * 0.22) c = [247, 211, 92];
        else c = d / petal > 0.75 ? deep : pink;
        tile(ctx, api, col, row, `rgb(${c[0]},${c[1]},${c[2]})`, 0.97 * f);
        if (d < R * 0.22 && !api.isBlocked(col, row)) { ctx.globalAlpha = 0.5 * f; api.stamp(":", "#a16207", col, row); }
      }
    }
  }

  return self;
}

// ---- cherry blossom petals ----------------------------------------------------
// Petals drift down across the pond, fluttering and spinning, cast a shadow
// that closes in as they fall, land with a little ripple, then float, slowly
// turning, until they fade. Koi swimming through push them aside.
export function petals(api, opts = {}) {
  const list = [];
  const self = { on: true, rate: opts.rate ?? 2.4, wind: opts.wind ?? 12, update, drawOver };
  let acc = 0;
  const PINKS = [[249, 196, 210], [246, 176, 196], [252, 214, 224], [240, 160, 186]];

  function spawn(atTop) {
    const S = api.S;
    list.push({
      x: api.rand(-40, api.W + 40),
      y: atTop ? api.rand(-60, -10) : api.rand(api.topBound, api.H * 0.9),
      // where it will land, as a distance it still has to fall
      fall: api.rand(0.15, 1) * api.H,
      h: 1, // height above the water, 1 = just let go, 0 = landed
      vy: api.rand(22, 40) * S, sway: api.rand(14, 30) * S, swf: api.rand(0.6, 1.3), ph: api.rand(0, TAU),
      rot: api.rand(0, TAU), spin: api.rand(-2.4, 2.4), flip: api.rand(0, TAU), flipS: api.rand(2, 4.5),
      size: api.rand(0.85, 1.25), col: PINKS[Math.floor(Math.random() * PINKS.length)],
      age: 0, life: api.rand(16, 26), landed: false,
    });
  }

  let seeded = false;
  function update(dt) {
    if (!api.W) return;
    if (!seeded) { seeded = true; for (let i = 0; i < 18; i++) spawn(false); } // some already drifting
    const S = api.S;
    acc += dt * self.rate * (api.W / 1400);
    while (acc > 1) { acc -= 1; if (list.length < 150) spawn(true); }
    const koi = api.koi();
    for (const p of list) {
      p.age += dt;
      if (!p.landed) {
        const dy = p.vy * dt;
        p.y += dy;
        p.x += (Math.sin(api.time * p.swf + p.ph) * p.sway + self.wind * S) * dt;
        p.rot += p.spin * dt;
        p.flip += p.flipS * dt;
        p.fall -= dy;
        p.h = Math.max(0, Math.min(1, p.fall / (api.H * 0.35)));
        if (p.fall <= 0) {
          p.landed = true; p.h = 0;
          api.ripple(p.x, p.y, 16 * S, 0.9, 0.35);
          p.spin *= 0.08; p.age = Math.min(p.age, 2); // floating time starts now
        }
      } else {
        // float on the current, turning slowly
        p.x += (Math.sin(api.time * 0.4 + p.ph) * 4 + self.wind * 0.25 * S) * dt;
        p.y += Math.cos(api.time * 0.33 + p.ph * 1.3) * 3 * dt;
        p.rot += p.spin * dt;
        p.flip = 0;
        for (const k of koi) {
          const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy), R = 22 * S;
          if (d < R && d > 0.01) {
            p.x += (dx / d) * (R - d) * 3 * dt + Math.cos(k.heading) * k.speed * 0.25 * dt;
            p.y += (dy / d) * (R - d) * 3 * dt + Math.sin(k.heading) * k.speed * 0.25 * dt;
          }
        }
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.age > p.life || p.y > api.H + 40 || p.x < -80 || p.x > api.W + 80) list.splice(i, 1);
    }
  }

  // a petal is a little oval with a notch at its outer tip, drawn in half-tile
  // pixels so its spin and flutter read clearly
  function drawPetal(ctx, p, x, y, color, alpha, squash) {
    const px = Math.max(2, api.CELL / 2);
    const a = 15 * p.size * api.S, b = 9.5 * p.size * api.S * Math.max(0.18, Math.abs(squash));
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const R = Math.ceil(a / px) + 1;
    const gx = Math.round(x / px), gy = Math.round(y / px);
    ctx.globalAlpha = alpha;
    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        const lx = (i * px) * c + (j * px) * s, ly = -(i * px) * s + (j * px) * c;
        const e = (lx / a) ** 2 + (ly / b) ** 2;
        if (e > 1) continue;
        if (lx > a * 0.62 && Math.abs(ly) < b * 0.28) continue; // notch at the tip
        const col = Math.floor(((gx + i) * px) / api.CELL), row = Math.floor(((gy + j) * px) / api.CELL);
        if (api.isBlocked(col, row)) continue;
        ctx.fillStyle = typeof color === "string" ? color
          : `rgb(${color[0] - (lx < -a * 0.4 ? 18 : 0)},${color[1] - (lx < -a * 0.4 ? 30 : 0)},${color[2] - (lx < -a * 0.4 ? 22 : 0)})`;
        ctx.fillRect((gx + i) * px, (gy + j) * px, px - 0.4, px - 0.4);
      }
    }
  }

  function drawOver(ctx, dark) {
    const shadow = dark ? "#000000" : "#7c8796";
    for (const p of list) {
      const fade = Math.min(1, (p.life - p.age) / 3) * Math.min(1, p.age * 2);
      const squash = Math.cos(p.flip);
      // shadow on the water: further off (and fainter) the higher the petal is
      const off = (4 + p.h * 26) * api.S;
      drawPetal(ctx, p, p.x + off * 0.6, p.y + off, shadow, (dark ? 0.3 : 0.16) * (1 - p.h * 0.6) * fade, squash);
      drawPetal(ctx, p, p.x, p.y, p.col, 0.95 * fade, squash);
    }
  }

  return self;
}
