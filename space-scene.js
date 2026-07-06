// ==========================================================
// SPACE SCENE — hero right-pane canvas animation
// Transparent canvas: every element sits directly on the page
// background, no container box. Looping sequence: white-on-white
// intro typography → scene elements fade in → rocket launches
// from bottom-left and arcs diagonally to the top-right → slow
// vertical descent onto a minimalist moon → hold → fade out.
// Interactions: pointer parallax on the stars, click to skip
// to the next phase. Pauses when offscreen or tab hidden.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('spaceScene');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Moon is parked for now — flip this back on to bring it (and its landing
  // dust) back without having to rewrite any of the geometry/render code below.
  const SHOW_MOON = false;

  // ---- palette (flat fills, tuned for the light page background) ----
  const BODY_FILL = '#ffffff';
  const ACCENT = '#60a5fa';
  const NOZZLE_FILL = '#94a3b8';
  const GLASS_FILL = '#bfdbfe';
  const GLASS_RING = '#94a3b8';
  const FLAME_OUTER = '#fbbf24';
  const FLAME_CORE = '#fff7ed';
  const MOON_FILL = '#e2e8f0';
  const MOON_CRATER = '#cbd5e1';
  const STAR_RGB = '100,116,139';   // slate
  const STAR_ACCENT_RGB = '96,165,250';
  const SMOKE_RGB = '148,163,184';

  // ---- timeline (name, duration in seconds) ----
  const PHASES = [
    ['intro',  3.0],  // white text on the white page, nothing else
    ['reveal', 1.1],  // stars + moon fade in
    ['flight', 6.5],  // diagonal launch → arc → slow descent
    ['landed', 3.0],  // rest on the moon
    ['fade',   1.2],  // scene fades out, loop restarts
  ];

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const smoothstep = (lo, hi, v) => {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
  };

  let W = 0;
  let H = 0;
  let phaseIndex = 0;
  let phaseT = 0;
  let clock = 0;
  let sceneAlpha = 0;
  let smoke = [];
  let dust = [];
  let dustFired = false;
  let emitCarry = 0;
  let pointerTarget = 0;
  let pointerX = 0;

  // ---- sparse, hand-placed starfield (normalized coords) ----
  // Scattered along the flight path, clear of the moon's corner.
  const STARS = [
    { nx: 0.10, ny: 0.16, s: 1.00 },
    { nx: 0.44, ny: 0.10, s: 0.80 },
    { nx: 0.88, ny: 0.12, s: 0.70 },
    { nx: 0.66, ny: 0.24, s: 0.95 },
    { nx: 0.26, ny: 0.38, s: 0.70 },
    { nx: 0.06, ny: 0.46, s: 0.55 },
    { nx: 0.90, ny: 0.44, s: 0.85 },
    { nx: 0.30, ny: 0.42, s: 0.60 },
    { nx: 0.14, ny: 0.68, s: 0.65 },
    { nx: 0.38, ny: 0.62, s: 0.50 },
  ].map((st, i) => ({ ...st, accent: i === 0, twinkle: i * 1.7 }));

  // ---- scene geometry (derived from canvas size each frame) ----
  function geometry() {
    const moonR = Math.min(W * 0.17, H * 0.15);
    const moonX = W * 0.66;
    const moonY = H * 0.72;
    const landY = moonY - moonR - 43; // rocket center when its base touches the moon
    return {
      moonX, moonY, moonR, landY,
      // cubic bezier flight path: bottom-left → high top-right arc → vertical drop
      p0: { x: -70, y: H + 80 },
      c1: { x: W * 0.50, y: H * 0.08 },
      c2: { x: moonX, y: landY - H * 0.55 },
      p3: { x: moonX, y: landY },
    };
  }

  function bezPoint(g, t) {
    const u = 1 - t;
    return {
      x: u * u * u * g.p0.x + 3 * u * u * t * g.c1.x + 3 * u * t * t * g.c2.x + t * t * t * g.p3.x,
      y: u * u * u * g.p0.y + 3 * u * u * t * g.c1.y + 3 * u * t * t * g.c2.y + t * t * t * g.p3.y,
    };
  }

  function bezTangent(g, t) {
    const u = 1 - t;
    return {
      x: 3 * u * u * (g.c1.x - g.p0.x) + 6 * u * t * (g.c2.x - g.c1.x) + 3 * t * t * (g.p3.x - g.c2.x),
      y: 3 * u * u * (g.c1.y - g.p0.y) + 6 * u * t * (g.c2.y - g.c1.y) + 3 * t * t * (g.p3.y - g.c2.y),
    };
  }

  // ---- stars: 4 sharp points, elongated vertically ----
  function drawStarShape(x, y, len, alpha, rgb) {
    const w = len * 0.42;
    const inn = len * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, y - len);
    ctx.lineTo(x + inn, y - inn);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + inn, y + inn);
    ctx.lineTo(x, y + len);
    ctx.lineTo(x - inn, y + inn);
    ctx.lineTo(x - w, y);
    ctx.lineTo(x - inn, y - inn);
    ctx.closePath();
    ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
    ctx.fill();
  }

  function drawStars(rocket) {
    for (const st of STARS) {
      const x = st.nx * W + pointerX * 6 * st.s;
      const y = st.ny * H;

      // scale up, then back down, only as the rocket passes close by
      let scale = 1;
      if (rocket) {
        const d = Math.hypot(x - rocket.x, y - rocket.y);
        if (d < 130) scale += 0.85 * Math.pow(1 - d / 130, 2);
      }

      const tw = 0.8 + 0.2 * Math.sin(clock * 1.4 + st.twinkle);
      const len = lerp(8, 15, st.s) * scale;
      const alpha = (0.35 + 0.5 * st.s) * tw * sceneAlpha;
      drawStarShape(x, y, len, alpha, st.accent ? STAR_ACCENT_RGB : STAR_RGB);
    }
  }

  // ---- moon: minimalist flat disc with a few craters ----
  const CRATERS = [
    [-0.38, -0.30, 0.16],
    [ 0.22, -0.52, 0.20],
    [ 0.42,  0.18, 0.13],
    [-0.10,  0.34, 0.24],
  ];

  function drawMoon(g) {
    ctx.beginPath();
    ctx.arc(g.moonX, g.moonY, g.moonR, 0, Math.PI * 2);
    ctx.fillStyle = applyAlpha(MOON_FILL, sceneAlpha);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(15,23,42,${(0.10 * sceneAlpha).toFixed(3)})`;
    ctx.stroke();

    ctx.fillStyle = applyAlpha(MOON_CRATER, sceneAlpha);
    for (const [dx, dy, r] of CRATERS) {
      ctx.beginPath();
      ctx.arc(g.moonX + dx * g.moonR, g.moonY + dy * g.moonR, r * g.moonR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- rocket: chunky, rounded, bold (local coords, center anchor) ----
  // Overall footprint: ~76px wide, ~100px tall; base (nozzle/fins) at y = 44.
  function drawRocket(x, y, angle, thrust) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(15,23,42,${(0.16 * sceneAlpha).toFixed(3)})`;

    // flame first, so it tucks behind the nozzle
    if (thrust > 0.03) {
      const flick = 1 + Math.sin(clock * 29) * 0.12 + Math.sin(clock * 47 + 1.3) * 0.08;
      const len = (20 + 42 * thrust) * flick;
      const teardrop = (w, l, color, a) => {
        ctx.fillStyle = applyAlpha(color, a * sceneAlpha);
        ctx.beginPath();
        ctx.moveTo(-w, 42);
        ctx.quadraticCurveTo(-w * 0.7, 42 + l * 0.55, 0, 42 + l);
        ctx.quadraticCurveTo(w * 0.7, 42 + l * 0.55, w, 42);
        ctx.closePath();
        ctx.fill();
      };
      teardrop(11 * (0.6 + 0.4 * thrust), len, FLAME_OUTER, 0.95);
      teardrop(5 * (0.6 + 0.4 * thrust), len * 0.55, FLAME_CORE, 1);
    }

    // fins: stubby rounded wings, reaching the base line
    ctx.fillStyle = applyAlpha(ACCENT, sceneAlpha);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 20, 6);
      ctx.quadraticCurveTo(side * 40, 20, side * 36, 44);
      ctx.quadraticCurveTo(side * 26, 40, side * 16, 36);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // body: wide rounded capsule
    ctx.fillStyle = applyAlpha(BODY_FILL, sceneAlpha);
    ctx.beginPath();
    ctx.moveTo(-22, -22);
    ctx.lineTo(-22, 16);
    ctx.quadraticCurveTo(-22, 32, -6, 32);
    ctx.lineTo(6, 32);
    ctx.quadraticCurveTo(22, 32, 22, 16);
    ctx.lineTo(22, -22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // nose: full dome
    ctx.fillStyle = applyAlpha(ACCENT, sceneAlpha);
    ctx.beginPath();
    ctx.moveTo(-22, -22);
    ctx.quadraticCurveTo(-22, -52, 0, -56);
    ctx.quadraticCurveTo(22, -52, 22, -22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // nozzle: flared skirt
    ctx.fillStyle = applyAlpha(NOZZLE_FILL, sceneAlpha);
    ctx.beginPath();
    ctx.moveTo(-10, 32);
    ctx.lineTo(10, 32);
    ctx.lineTo(14, 44);
    ctx.lineTo(-14, 44);
    ctx.closePath();
    ctx.fill();

    // big round porthole
    ctx.beginPath();
    ctx.arc(0, -2, 11, 0, Math.PI * 2);
    ctx.fillStyle = applyAlpha(GLASS_FILL, sceneAlpha);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = applyAlpha(GLASS_RING, sceneAlpha);
    ctx.stroke();

    ctx.restore();
  }

  // ---- exhaust smoke & landing dust ----
  function emitSmoke(dt, rocket, thrust) {
    if (thrust <= 0.04) return;
    emitCarry += dt * (12 + 30 * thrust);
    const cos = Math.cos(rocket.angle);
    const sin = Math.sin(rocket.angle);
    while (emitCarry >= 1) {
      emitCarry -= 1;
      if (smoke.length >= 90) break;
      // spawn at the nozzle (local (0, 46) rotated), drift away behind the rocket
      const speed = 90 + Math.random() * 60;
      smoke.push({
        x: rocket.x - sin * 46 + (Math.random() * 10 - 5),
        y: rocket.y + cos * 46 + (Math.random() * 10 - 5),
        vx: -sin * speed + (Math.random() * 26 - 13),
        vy: cos * speed + (Math.random() * 26 - 13),
        r: 3 + Math.random() * 3,
        growth: 9 + Math.random() * 7,
        life: 0.7 + Math.random() * 0.5,
        age: 0,
      });
    }
  }

  function spawnDust(g) {
    for (let i = 0; i < 12; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      dust.push({
        x: g.moonX + dir * (14 + Math.random() * 10),
        y: g.moonY - g.moonR + 3,
        vx: dir * (36 + Math.random() * 60),
        vy: -(8 + Math.random() * 22),
        gravity: 55,
        r: 2 + Math.random() * 2.5,
        growth: 4 + Math.random() * 4,
        life: 0.6 + Math.random() * 0.5,
        age: 0,
      });
    }
  }

  function drawParticles(list, dt, baseAlpha) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) {
        list.splice(i, 1);
        continue;
      }
      if (p.gravity) p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.growth * dt;
      const k = 1 - p.age / p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${SMOKE_RGB},${(baseAlpha * k * sceneAlpha).toFixed(3)})`;
      ctx.fill();
    }
  }

  // ---- intro typography ----
  function drawIntroText(alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff'; // white on the white page, by design
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = Math.max(18, W * 0.058);
    ctx.font = `italic 500 ${size}px Georgia, 'Times New Roman', serif`;
    ctx.fillText('shoot for the stars,', W / 2, H / 2 - size * 0.75);
    ctx.fillText('aim for the moon.', W / 2, H / 2 + size * 0.75);
    ctx.restore();
  }

  // ---- color helper ----
  const hexCache = {};
  function applyAlpha(hex, alpha) {
    let rgb = hexCache[hex];
    if (!rgb) {
      rgb = hexCache[hex] = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
    }
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
  }

  // ---- phase state machine ----
  function computeState(g) {
    const [name, dur] = PHASES[phaseIndex];
    const t = clamp01(phaseT / dur);
    const s = { sceneAlpha: 1, textAlpha: 0, rocket: null, thrust: 0 };

    switch (name) {
      case 'intro':
        s.sceneAlpha = 0;
        s.textAlpha = clamp01(phaseT / 0.6) * clamp01((dur - phaseT) / 0.7);
        break;
      case 'reveal':
        s.sceneAlpha = easeInOut(t);
        break;
      case 'flight': {
        const p = 1 - Math.pow(1 - t, 2); // punchy launch, slow deceleration into the landing
        const pos = bezPoint(g, p);
        const tan = bezTangent(g, p);
        // follow the flight vector while climbing, right the ship for the descent;
        // everything below keys off p (position along the path), not raw time
        let angle = Math.atan2(tan.y, tan.x) + Math.PI / 2;
        angle *= 1 - smoothstep(0.55, 0.85, p);
        s.rocket = { x: pos.x, y: pos.y, angle };
        s.thrust = 1 - smoothstep(0.55, 0.97, p);
        if (SHOW_MOON && p > 0.96 && !dustFired) {
          dustFired = true;
          spawnDust(g);
        }
        break;
      }
      case 'landed':
        s.rocket = { x: g.p3.x, y: g.p3.y, angle: 0 };
        break;
      case 'fade':
        s.sceneAlpha = 1 - easeInOut(t);
        s.rocket = { x: g.p3.x, y: g.p3.y, angle: 0 };
        break;
    }
    return s;
  }

  function advance(dt) {
    phaseT += dt;
    while (phaseT >= PHASES[phaseIndex][1]) {
      phaseT -= PHASES[phaseIndex][1];
      phaseIndex = (phaseIndex + 1) % PHASES.length;
      if (phaseIndex === 0) {
        smoke = [];
        dust = [];
        emitCarry = 0;
        dustFired = false;
      }
    }
  }

  function render(dt) {
    const g = geometry();
    const s = computeState(g);
    sceneAlpha = s.sceneAlpha;
    pointerX += (pointerTarget - pointerX) * Math.min(1, dt * 6);

    ctx.clearRect(0, 0, W, H); // transparent canvas: the page background shows through

    if (sceneAlpha > 0.01) {
      drawStars(s.rocket);
      if (SHOW_MOON) drawMoon(g);
      if (s.rocket) emitSmoke(dt, s.rocket, s.thrust);
      drawParticles(smoke, dt, 0.35);
      drawParticles(dust, dt, 0.4);
      if (s.rocket) drawRocket(s.rocket.x, s.rocket.y, s.rocket.angle, s.thrust);
    }

    drawIntroText(s.textAlpha);
  }

  // Static fallback for prefers-reduced-motion: the landed scene
  function renderStatic() {
    sceneAlpha = 1;
    const g = geometry();
    ctx.clearRect(0, 0, W, H);
    drawStars(null);
    if (SHOW_MOON) drawMoon(g);
    drawRocket(g.p3.x, g.p3.y, 0, 0);
  }

  // ---- sizing ----
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) renderStatic();
  }

  // ---- run loop, paused when offscreen or tab hidden ----
  let rafId = null;
  let lastTs = null;
  let onScreen = false;

  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (lastTs === null) {
      lastTs = ts;
      return;
    }
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    clock += dt;
    advance(dt);
    render(dt);
  }

  function start() {
    if (rafId !== null) return;
    lastTs = null;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function syncRunning() {
    if (reduceMotion) return;
    if (onScreen && !document.hidden) start();
    else stop();
  }

  // ---- interactions ----
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointerTarget = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  });
  canvas.addEventListener('pointerleave', () => {
    pointerTarget = 0;
  });
  canvas.addEventListener('click', () => {
    if (reduceMotion) return;
    phaseT = PHASES[phaseIndex][1]; // skip to the next phase
  });

  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    syncRunning();
  }, { threshold: 0.05 }).observe(canvas);

  document.addEventListener('visibilitychange', syncRunning);
  window.addEventListener('resize', resize);

  resize();
});
