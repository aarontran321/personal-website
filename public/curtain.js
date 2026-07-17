// ==========================================================
// HANGING CURTAIN TAPESTRY — Verlet cloth simulation rendered
// entirely from auspicious Chinese idioms (成语).
//
// No external physics/rendering libraries: a small Vec2 utility,
// a Particle + Constraint cloth solver, and a canvas renderer that
// stamps pre-rendered glyph bitmaps instead of calling fillText()
// per character per frame (the expensive part of canvas text).
// ==========================================================
(() => {
  'use strict';

  // ----------------------------------------------------------
  // Idiom pool — positive, hopeful idioms about bright futures,
  // resilience and prosperity. Concatenated (idioms have no
  // spaces) and looped over the grid, column by column, so each
  // vertical strand of the curtain reads top-to-bottom like
  // traditional vertical Chinese text.
  // ----------------------------------------------------------
  const IDIOMS = [
    '前程似锦', // future like beautiful brocade
    '一帆风顺', // smooth sailing
    '欣欣向荣', // thriving and flourishing
    '否极泰来', // out of adversity comes prosperity
    '万事如意', // may all your wishes be fulfilled
    '心想事成', // may your heart's desires come true
    '迎风破浪', // cleaving the waves, brave against the wind
    '东山再起', // rising again with renewed vigor
    '金玉满堂', // abundance of wealth and knowledge
  ];
  const CHAR_POOL = IDIOMS.join('').replace(/\s/g, '').split('');

  const CONFIG = {
    targetSpacing: 24,       // desired px between columns, drives responsive gridW
    targetRowSpacing: 30,    // desired px between rows, drives responsive gridH
    minGridW: 20, maxGridW: 38,
    minGridH: 14, maxGridH: 24,
    gravity: 1600,           // px/s^2
    damping: 0.986,          // velocity retained per step (air resistance)
    constraintIterations: 6, // solver passes/frame — more = stiffer, more stable cloth
    mouseSize: 110,          // px radius of cursor repulsion
    mouseStrength: 2600,     // px/s^2 push at the cursor's center
    grabRadius: 28,          // px hit-radius for click/tap-to-drag
    restEpsilon: 0.6,        // px^2 total drift below which the cloth is "settled"
    settleFrames: 40,        // consecutive settled frames before we pause the loop
    heightFill: 0.78,        // fraction of the container the rest grid spans vertically —
                             // leaves headroom for gravity to stretch into without
                             // the bottom row overshooting the floor and getting clamped
    windStrength: 340,       // px/s^2, a gentle intro breeze that decays away
    windDuration: 3.2,       // seconds the breeze takes to fade to nothing
    fontFamily: '"Noto Serif SC", serif',
    vertical: { compressFactor: 0.82, stretchFactor: 1.28, stiffness: 1 },
    horizontal: { compressFactor: 0.45, stretchFactor: 1.9, stiffness: 0.55 },
  };

  // ----------------------------------------------------------
  // Vec2 — minimal chainable 2D vector. Mutating methods return
  // `this`; clone() is the escape hatch when a fresh copy is needed.
  // ----------------------------------------------------------
  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) { this.x = x; this.y = y; return this; }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    subtract(v) { this.x -= v.x; this.y -= v.y; return this; }
    multiply(v) {
      if (typeof v === 'number') { this.x *= v; this.y *= v; }
      else { this.x *= v.x; this.y *= v.y; }
      return this;
    }
    scale(s) { this.x *= s; this.y *= s; return this; }
    length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    lengthSquared() { return this.x * this.x + this.y * this.y; }
    angle() { return Math.atan2(this.y, this.x); }
    clone() { return new Vec2(this.x, this.y); }
  }

  // ----------------------------------------------------------
  // Particle — one grid intersection / one Hanzi glyph.
  // Position is never set directly by physics for pinned particles;
  // pinning is either the permanent top-row anchor, or the temporary
  // "this particle is being dragged" state used by pointer input.
  // ----------------------------------------------------------
  class Particle {
    constructor(x, y, col, row, char) {
      this.pos = new Vec2(x, y);
      this.oldPos = new Vec2(x, y);
      this.velocity = new Vec2(0, 0);
      this.acceleration = new Vec2(0, 0);
      this.pinned = false;
      this.pinPos = new Vec2(x, y); // anchor to snap back to if this is a top-row particle
      this.col = col;
      this.row = row;
      this.char = char;
      this.mass = 1;
    }

    applyForce(force) {
      // a = F / m
      this.acceleration.add(force.clone().scale(1 / this.mass));
    }

    update(dt) {
      if (this.pinned) {
        // Position is owned externally (fixed anchor, or a live drag)
        this.acceleration.set(0, 0);
        return;
      }
      // Verlet integration: velocity is implicit in the pos/oldPos delta.
      this.velocity = this.pos.clone().subtract(this.oldPos).scale(CONFIG.damping);
      const next = this.pos.clone()
        .add(this.velocity)
        .add(this.acceleration.clone().scale(dt * dt));
      this.oldPos = this.pos;
      this.pos = next;
      this.acceleration.set(0, 0);
    }

    contain(bounds) {
      if (this.pos.x < bounds.left) { this.pos.x = bounds.left; this.oldPos.x = this.pos.x; }
      else if (this.pos.x > bounds.right) { this.pos.x = bounds.right; this.oldPos.x = this.pos.x; }
      if (this.pos.y < bounds.top) { this.pos.y = bounds.top; this.oldPos.y = this.pos.y; }
      else if (this.pos.y > bounds.bottom) { this.pos.y = bounds.bottom; this.oldPos.y = this.pos.y; }
    }
  }

  // ----------------------------------------------------------
  // Constraint — a distance constraint with a soft "slack band"
  // between minLength/maxLength. Inside the band nothing happens,
  // which is what lets the fabric drape instead of snapping back
  // to a rigid grid every frame.
  // ----------------------------------------------------------
  class Constraint {
    constructor(p1, p2, length, compressFactor, stretchFactor, stiffness) {
      this.p1 = p1;
      this.p2 = p2;
      this.length = length;
      this.compressFactor = compressFactor;
      this.stretchFactor = stretchFactor;
      this.stiffness = stiffness;
    }

    solve() {
      const { p1, p2 } = this;
      if (p1.pinned && p2.pinned) return;

      const delta = p2.pos.clone().subtract(p1.pos);
      // Floor the distance well above zero: two coincident particles would
      // otherwise send `diff` toward infinity and explode the whole sheet.
      const dist = Math.max(delta.length(), this.length * 0.05);
      const minLength = this.length * this.compressFactor;
      const maxLength = this.length * this.stretchFactor;

      let target = dist;
      if (dist < minLength) target = minLength;
      else if (dist > maxLength) target = maxLength;
      else return; // within the slack band — no correction needed

      const diff = ((dist - target) / dist) * this.stiffness;
      const offset = delta.scale(diff * 0.5);

      // Never move a particle more than half its rest length in one pass —
      // keeps a single bad frame (e.g. a fast drag) from ever going unstable.
      const maxStep = this.length * 0.5;
      const offsetLen = offset.length();
      if (offsetLen > maxStep) offset.scale(maxStep / offsetLen);

      if (p1.pinned) {
        p2.pos.subtract(offset).subtract(offset);
      } else if (p2.pinned) {
        p1.pos.add(offset).add(offset);
      } else {
        p1.pos.add(offset);
        p2.pos.subtract(offset);
      }
    }
  }

  // ----------------------------------------------------------
  // Tapestry — owns the grid, the glyph atlas, the render loop
  // and all pointer interaction.
  // ----------------------------------------------------------
  class Tapestry {
    constructor(canvas, container) {
      this.canvas = canvas;
      this.container = container;
      this.ctx = canvas.getContext('2d');

      this.particles = [];
      this.constraints = [];
      this.grid = [];
      this.charCanvases = new Map();

      this.mouse = { pos: new Vec2(-9999, -9999), active: false };
      this.dragged = null;

      this.running = false;
      this.ready = false; // grid/atlas aren't built until the first rebuild() completes
      this.rafId = null;
      this.lastTime = null;
      this.settledFrames = 0;

      this.loop = this.loop.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
      this.onPointerLeave = this.onPointerLeave.bind(this);

      this.bindEvents();

      this.resizeObserver = new ResizeObserver(() => this.scheduleRebuild());
      this.resizeObserver.observe(this.container);

      this.intersectionObserver = new IntersectionObserver(
        ([entry]) => (entry.isIntersecting ? this.wake() : this.pause()),
        { threshold: 0 }
      );
      this.intersectionObserver.observe(this.container);

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.pause();
        else this.wake();
      });
    }

    // -- setup ------------------------------------------------

    scheduleRebuild() {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => this.rebuild(), 150);
    }

    rebuild() {
      const rect = this.container.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;

      this.width = rect.width;
      this.height = rect.height;
      this.bounds = { left: 0, right: this.width, top: 0, bottom: this.height };

      // High-DPI backing store, capped to protect fill rate on large panels.
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Responsive grid density: keep characters legibly spaced whether
      // the panel is a slim sidebar or a full-width mobile strip.
      this.gridW = Math.min(CONFIG.maxGridW, Math.max(CONFIG.minGridW,
        Math.round(this.width / CONFIG.targetSpacing)));
      this.gridH = Math.min(CONFIG.maxGridH, Math.max(CONFIG.minGridH,
        Math.round(this.height / CONFIG.targetRowSpacing)));
      this.spacingX = this.width / (this.gridW - 1);
      this.spacingY = (this.height * CONFIG.heightFill) / (this.gridH - 1);

      this.buildGrid();
      this.buildGlyphAtlas();
      this.age = 0;
      this.settledFrames = 0;
      this.ready = true;
      this.wake();
    }

    buildGrid() {
      this.particles = [];
      this.constraints = [];
      this.grid = [];

      let charIndex = 0;
      for (let i = 0; i < this.gridW; i++) {
        const column = [];
        for (let j = 0; j < this.gridH; j++) {
          const x = i * this.spacingX;
          const y = j * this.spacingY;
          const char = CHAR_POOL[charIndex % CHAR_POOL.length];
          charIndex++;

          const particle = new Particle(x, y, i, j, char);
          if (j === 0) {
            particle.pinned = true; // top row hangs the curtain
          }
          column.push(particle);
          this.particles.push(particle);
        }
        this.grid.push(column);
      }

      // Vertical constraints carry the weight of the fabric.
      for (let i = 0; i < this.gridW; i++) {
        for (let j = 0; j < this.gridH - 1; j++) {
          const a = this.grid[i][j];
          const b = this.grid[i][j + 1];
          const len = a.pos.clone().subtract(b.pos).length();
          this.constraints.push(new Constraint(
            a, b, len, CONFIG.vertical.compressFactor,
            CONFIG.vertical.stretchFactor, CONFIG.vertical.stiffness
          ));
        }
      }

      // Horizontal constraints are loose "spacers" that keep the sheet
      // cohesive without fighting the vertical drape.
      for (let j = 0; j < this.gridH; j++) {
        for (let i = 0; i < this.gridW - 1; i++) {
          const a = this.grid[i][j];
          const b = this.grid[i + 1][j];
          const len = a.pos.clone().subtract(b.pos).length();
          this.constraints.push(new Constraint(
            a, b, len, CONFIG.horizontal.compressFactor,
            CONFIG.horizontal.stretchFactor, CONFIG.horizontal.stiffness
          ));
        }
      }

      // A fixed relaxation order biases correction along one diagonal,
      // reading as a diagonal "shear" instead of a natural sway. Solving
      // in the reverse order every other iteration cancels that bias out.
      this.constraintsReversed = [...this.constraints].reverse();
    }

    buildGlyphAtlas() {
      const dpr = this.dpr;
      const glyphSize = Math.max(this.spacingX, this.spacingY) * 1.5;
      const canvasPx = Math.max(2, Math.ceil(glyphSize * dpr));
      const color = getComputedStyle(this.container).getPropertyValue('--curtain-char-color').trim() || '#2C2C2E';

      this.glyphSize = glyphSize;
      this.charCanvases = new Map();

      for (const ch of new Set(CHAR_POOL)) {
        const off = document.createElement('canvas');
        off.width = canvasPx;
        off.height = canvasPx;
        const octx = off.getContext('2d');
        octx.scale(dpr, dpr);
        octx.font = `600 ${glyphSize * 0.6}px ${CONFIG.fontFamily}`;
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillStyle = color;
        octx.fillText(ch, glyphSize / 2, glyphSize / 2 + glyphSize * 0.03);
        this.charCanvases.set(ch, off);
      }
    }

    // -- input --------------------------------------------------

    bindEvents() {
      this.canvas.addEventListener('pointermove', this.onPointerMove);
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      this.canvas.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('pointercancel', this.onPointerUp);
      this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    }

    pointerPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return new Vec2(e.clientX - rect.left, e.clientY - rect.top);
    }

    onPointerMove(e) {
      const pos = this.pointerPos(e);
      this.mouse.pos.set(pos.x, pos.y);
      this.mouse.active = true;
      this.wake();

      if (this.dragged) {
        // Carry the previous position into oldPos so the drag imparts a
        // real velocity (a gentle "fling") once the particle is released.
        this.dragged.oldPos.set(this.dragged.pos.x, this.dragged.pos.y);
        this.dragged.pos.set(pos.x, pos.y);
      }
    }

    onPointerDown(e) {
      const pos = this.pointerPos(e);
      let closest = null;
      let closestDistSq = CONFIG.grabRadius * CONFIG.grabRadius;

      for (const p of this.particles) {
        const dSq = p.pos.clone().subtract(pos).lengthSquared();
        if (dSq < closestDistSq) {
          closestDistSq = dSq;
          closest = p;
        }
      }

      if (closest) {
        this.dragged = closest;
        this.dragged.wasPinned = closest.pinned;
        closest.pinned = true;
        closest.pos.set(pos.x, pos.y);
        closest.oldPos.set(pos.x, pos.y);
        this.canvas.setPointerCapture(e.pointerId);
        this.wake();
      }
    }

    onPointerUp() {
      if (this.dragged) {
        const p = this.dragged;
        if (p.wasPinned) {
          // Permanent anchors snap back to their original hanging point.
          p.pos.set(p.pinPos.x, p.pinPos.y);
          p.oldPos.set(p.pinPos.x, p.pinPos.y);
        }
        p.pinned = p.wasPinned;
        this.dragged = null;
        this.wake();
      }
    }

    onPointerLeave() {
      this.mouse.active = false;
    }

    applyMouseForces() {
      if (!this.mouse.active) return;
      const r = CONFIG.mouseSize;
      const rSq = r * r;

      for (const p of this.particles) {
        if (p.pinned) continue;
        const d = p.pos.clone().subtract(this.mouse.pos);
        const distSq = d.lengthSquared();
        if (distSq > rSq || distSq < 1) continue;

        // Smoothstep falloff so the push fades gracefully at the radius edge.
        const t = 1 - distSq / rSq;
        const falloff = t * t * (3 - 2 * t);
        const dist = Math.sqrt(distSq);
        d.scale(1 / dist); // normalize
        p.applyForce(d.scale(CONFIG.mouseStrength * falloff));
      }
    }

    // -- simulation ----------------------------------------------

    applyWind() {
      // A uniform grid under uniform gravity has no asymmetry to sway with —
      // every column pulls identically straight down. This decaying, per-column
      // phase-shifted breeze breaks that symmetry just long enough for the
      // curtain to settle into an organic, rippled drape instead of a rigid one.
      const decay = 1 - Math.min(this.age / CONFIG.windDuration, 1);
      if (decay <= 0) return;
      const strength = CONFIG.windStrength * decay * decay;
      for (const column of this.grid) {
        const phase = column[0].col * 0.6;
        const gust = Math.sin(this.age * 1.6 + phase) * strength;
        for (const p of column) {
          if (!p.pinned) p.applyForce(new Vec2(gust, 0));
        }
      }
    }

    step(dt) {
      this.age += dt;
      const gravity = new Vec2(0, CONFIG.gravity);
      for (const p of this.particles) {
        if (!p.pinned) p.applyForce(gravity);
      }
      this.applyWind();
      this.applyMouseForces();

      for (const p of this.particles) p.update(dt);

      let drift = 0;
      for (let iter = 0; iter < CONFIG.constraintIterations; iter++) {
        const list = iter % 2 === 0 ? this.constraints : this.constraintsReversed;
        for (const c of list) c.solve();
      }
      for (const p of this.particles) {
        if (!p.pinned) {
          p.contain(this.bounds);
          drift += p.pos.clone().subtract(p.oldPos).lengthSquared();
        }
      }

      // Once the cloth has stopped moving, stop paying for frames until
      // something (pointer, resize) disturbs it again.
      if (drift < CONFIG.restEpsilon && !this.mouse.active && !this.dragged) {
        this.settledFrames++;
      } else {
        this.settledFrames = 0;
      }
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      for (let i = 0; i < this.gridW; i++) {
        for (let j = 0; j < this.gridH; j++) {
          const particle = this.grid[i][j];
          const glyph = this.charCanvases.get(particle.char);
          if (!glyph) continue;

          // Orient each glyph along the strand it hangs from so the
          // fabric visibly bends and twists as it sways.
          let angle = 0;
          const below = this.grid[i][j + 1];
          const above = this.grid[i][j - 1];
          if (below) {
            angle = below.pos.clone().subtract(particle.pos).angle() - Math.PI / 2;
          } else if (above) {
            angle = particle.pos.clone().subtract(above.pos).angle() - Math.PI / 2;
          }

          ctx.save();
          ctx.translate(particle.pos.x, particle.pos.y);
          ctx.rotate(angle);
          const size = this.glyphSize;
          ctx.drawImage(glyph, -size / 2, -size / 2, size, size);
          ctx.restore();
        }
      }
    }

    // -- lifecycle -------------------------------------------------

    loop(now) {
      if (!this.running) return;
      if (this.lastTime == null) this.lastTime = now;
      const dt = Math.min((now - this.lastTime) / 1000, 1 / 30);
      this.lastTime = now;

      this.step(dt);
      this.render();

      if (this.settledFrames > CONFIG.settleFrames) {
        this.pause();
        return;
      }
      this.rafId = requestAnimationFrame(this.loop);
    }

    wake() {
      if (!this.ready || this.running) return;
      this.running = true;
      this.lastTime = null;
      this.rafId = requestAnimationFrame(this.loop);
    }

    pause() {
      this.running = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ----------------------------------------------------------
  // Boot once the DOM and the Hanzi-capable webfont are ready —
  // building the glyph atlas before the font loads would bake in
  // fallback tofu boxes until the next resize.
  // ----------------------------------------------------------
  function init() {
    const canvas = document.getElementById('curtainCanvas');
    const container = document.getElementById('heroTapestry');
    if (!canvas || !container) return;

    const tapestry = new Tapestry(canvas, container);
    const start = () => tapestry.rebuild();

    if (document.fonts && document.fonts.load) {
      document.fonts.load('600 64px "Noto Serif SC"').then(start).catch(start);
    } else {
      start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
