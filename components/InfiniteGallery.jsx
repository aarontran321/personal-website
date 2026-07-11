import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

// One repeating "tile" of scattered photos, packed onto a loose 4x3 grid and
// jittered off-axis so it reads as randomly staggered rather than a rigid
// gallery. fx/fy are fractions (0-1) of the tile's own width/height, so the
// layout stays proportional as the tile is resized to the viewport.
//
// `group` clusters 2-4 spatially-adjacent photos (roughly one column each)
// so they share one GROUP_FACTORS entry: photos in the same group always
// move together (never overlap each other), while different groups drift at
// slightly different speeds under cursor parallax for a layered feel. The
// factor spread is kept narrow enough that even the fastest and slowest
// groups never drift far enough to overlap a neighboring photo — see
// GROUP_FACTORS/BASE_PARALLAX below.
// `src` files live in public/images/gallery/ — drop a file in with the
// matching name (jpg/png/etc, just update the extension here if needed) and
// it's picked up automatically, no other wiring required. `title` is derived
// from each file's name.
const GALLERY_ITEMS = [
  { id: "canoe", title: "Canoe", aspect: "vertical", src: "canoe.jpg", fx: 0.105, fy: 0.197, group: "a" },
  { id: "beachwithfriends", title: "Beach With Friends", aspect: "wide", src: "beachwithfriends.jpg", fx: 0.165, fy: 0.52, group: "a" },
  { id: "citynight", title: "City Night", aspect: "vertical", src: "citynight.jpg", fx: 0.145, fy: 0.863, group: "a" },
  { id: "firsthackathon", title: "First Hackathon", aspect: "wide", src: "firsthackathon.jpg", fx: 0.405, fy: 0.147, group: "b" },
  { id: "fishing", title: "Fishing", aspect: "vertical", src: "fishing.jpg", fx: 0.39, fy: 0.46, group: "b" },
  { id: "gamenight", title: "Game Night", aspect: "wide", src: "gamenight.jpg", fx: 0.345, fy: 0.803, group: "b" },
  { id: "movienight", title: "Movie Night", aspect: "vertical", src: "movienight.jpg", fx: 0.615, fy: 0.207, group: "c" },
  { id: "poolparty", title: "Pool Party", aspect: "wide", src: "poolparty.jpg", fx: 0.655, fy: 0.53, group: "c" },
  { id: "pokemonripnight", title: "Pokemon Rip Night", aspect: "vertical", src: "pokemonripnight.jpg", fx: 0.665, fy: 0.853, group: "c" },
  { id: "studentcouncil", title: "Student Council", aspect: "wide", src: "studentcouncil.jpg", fx: 0.895, fy: 0.137, group: "d" },
  { id: "sleephackathon", title: "Hackathon Sleep Situation", aspect: "vertical", src: "sleephackathon.jpg", fx: 0.87, fy: 0.48, group: "d" },
];

// Narrow spread (0.8x-1.35x) so the fastest and slowest groups never drift
// far enough apart to overlap — wide enough to read as distinct depth layers.
const GROUP_FACTORS = { a: 0.8, b: 1.0, c: 1.15, d: 1.35 };

// Sizes bumped ~18% over the previous pass, aspect ratios preserved.
const ASPECT_SIZE = {
  square: { w: 225, h: 225 },
  wide: { w: 270, h: 200 },
  vertical: { w: 200, h: 285 },
};

// Tile sized just enough larger than the viewport to guarantee the 3x3 copy
// grid below always covers it, while staying as small as possible so photos
// read as tightly packed rather than spread across a wide-open field. Grown
// in step with the larger card sizes above so the tighter spacing doesn't
// tip into overcrowding.
// Shrunk ~13% from the previous pass to pull photos closer together — a
// few of the tightest-margin fx values above (fishing/movienight/
// sleephackathon) were nudged outward first so this shrink doesn't reopen
// the overlaps a plain resize would cause between those pairs.
const MIN_TILE_W = 1350;
const MIN_TILE_H = 1090;
const TILE_MULT_W = 0.97;
const TILE_MULT_H = 1.22;

// Passive cursor parallax baseline (multiplied per-card by GROUP_FACTORS
// above). Sized so that even the fastest group's max offset stays well
// inside the jitter margins between neighboring photos.
const BASE_PARALLAX = 40;
// Light and stiff: the canvas tracks the cursor/pointer almost immediately
// (snappy, responsive drag) and settles quickly with minimal overshoot.
const PAN_SPRING = { stiffness: 220, damping: 26, mass: 0.5 };
// Stiff enough to settle to 0 quickly when a drag starts (see
// handlePointerDown), so the hand-off to uniform pan motion is fast, while
// still easing smoothly during normal passive hover-follow.
const PARALLAX_SPRING = { stiffness: 60, damping: 24, mass: 1 };

// Scales raw pointer movement before it's applied to the pan target — 1.0
// means a given hand/finger movement covers exactly that much canvas
// distance (doubled from the previous 0.5, i.e. 100% more pan per drag).
const DRAG_SENSITIVITY = 1.0;
// Cap on release velocity (px per ~16ms frame): raised so a real flick can
// carry the canvas noticeably further after release.
const MAX_VELOCITY = 14;
// Per-frame velocity retention for the post-release momentum coast. Raised
// further so letting go produces a longer, more noticeable slide, while
// MAX_VELOCITY above still keeps even a hard flick from going too far.
const FRICTION = 0.93;
const VELOCITY_STOP = 0.05;
const TILE_COPIES = [-1, 0, 1];

// Wraps a value into a range centered on 0, e.g. wrap(x, 1000) stays within
// [-500, 500) — shifting by a whole tile is invisible in a repeating grid,
// so this is applied only to the rendered (post-spring) position, never to
// the raw drag target, otherwise the spring would chase the wrap seam.
function wrap(value, size) {
  const half = size / 2;
  return ((((value + half) % size) + size) % size) - half;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function GalleryCard({ item, tileW, tileH, parallaxX, parallaxY }) {
  const size = ASPECT_SIZE[item.aspect];
  const factor = GROUP_FACTORS[item.group];
  const px = useTransform(parallaxX, (v) => v * factor);
  const py = useTransform(parallaxY, (v) => v * factor);

  return (
    <motion.figure
      className="gallery-card"
      style={{ left: item.fx * tileW, top: item.fy * tileH, width: size.w, x: px, y: py }}
    >
      <div className="gallery-card-frame" style={{ height: size.h }}>
        <img
          src={`/images/gallery/${item.src}`}
          alt={item.title}
          draggable={false}
          loading="lazy"
        />
      </div>
      <figcaption className="gallery-card-caption">
        <span className="gallery-card-title">{item.title}</span>
      </figcaption>
    </motion.figure>
  );
}

export default function InfiniteGallery() {
  const containerRef = useRef(null);
  const [tile, setTile] = useState({ w: MIN_TILE_W, h: MIN_TILE_H });

  useEffect(() => {
    function recalc() {
      const el = containerRef.current;
      const w = el ? el.clientWidth : window.innerWidth;
      const h = el ? el.clientHeight : window.innerHeight;
      setTile({
        w: Math.max(MIN_TILE_W, Math.round(w * TILE_MULT_W)),
        h: Math.max(MIN_TILE_H, Math.round(h * TILE_MULT_H)),
      });
    }
    recalc();
    let raf = null;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recalc);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Raw, unwrapped drag target driven by the pointer/momentum loop. The
  // rendered pan chases this through a light, stiff spring so the canvas
  // feels snappy and responds immediately to the pointer.
  const panTargetX = useMotionValue(0);
  const panTargetY = useMotionValue(0);
  const panX = useSpring(panTargetX, PAN_SPRING);
  const panY = useSpring(panTargetY, PAN_SPRING);

  // Passive cursor parallax: springed for a gentle feel, scaled per-card by
  // GROUP_FACTORS (applied inside GalleryCard) rather than on the world
  // container, so photos follow the cursor at slightly different speeds
  // instead of all panning by one shared vector.
  const parallaxTargetX = useMotionValue(0);
  const parallaxTargetY = useMotionValue(0);
  const parallaxX = useSpring(parallaxTargetX, PARALLAX_SPRING);
  const parallaxY = useSpring(parallaxTargetY, PARALLAX_SPRING);

  const worldX = useTransform(panX, (v) => wrap(v, tile.w));
  const worldY = useTransform(panY, (v) => wrap(v, tile.h));

  // Drag/momentum bookkeeping lives in a ref so it never triggers re-renders.
  const drag = useRef({ active: false, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0 });
  const momentumRaf = useRef(null);

  const stopMomentum = () => {
    if (momentumRaf.current) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = null;
    }
  };

  const runMomentum = () => {
    stopMomentum();
    const step = () => {
      const d = drag.current;
      if (Math.abs(d.vx) < VELOCITY_STOP && Math.abs(d.vy) < VELOCITY_STOP) {
        momentumRaf.current = null;
        return;
      }
      panTargetX.set(panTargetX.get() + d.vx);
      panTargetY.set(panTargetY.get() + d.vy);
      d.vx *= FRICTION;
      d.vy *= FRICTION;
      momentumRaf.current = requestAnimationFrame(step);
    };
    momentumRaf.current = requestAnimationFrame(step);
  };

  useEffect(() => stopMomentum, []);

  const handlePointerDown = (e) => {
    // Only the primary button starts a drag — a right-click (button 2) or
    // middle-click otherwise still grabs pointer capture, and the browser's
    // context menu can swallow the matching pointerup, leaving `active`
    // stuck true so the very next mousemove (with no button held) reads as
    // an ongoing drag and pans the canvas.
    if (e.button !== 0) return;
    stopMomentum();
    const el = containerRef.current;
    el.setPointerCapture(e.pointerId);
    drag.current = { active: true, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0 };
    // Ease the passive-hover offset back to 0 (not an instant jump) so a
    // click/drag start never causes a visible snap — it just blends into
    // uniform pan over the next few frames as the spring settles.
    parallaxTargetX.set(0);
    parallaxTargetY.set(0);
  };

  // Defensive cleanup: if a context menu (or anything else) ever manages to
  // swallow the pointerup that would normally end a drag, this guarantees
  // `active` and pointer capture both get released instead of sticking.
  const handleContextMenu = () => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    d.vx = 0;
    d.vy = 0;
    stopMomentum();
  };

  const handlePointerMove = (e) => {
    const d = drag.current;
    if (!d.active) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    // Scale the raw pointer delta down so the canvas covers less ground per
    // physical movement — this is what makes dragging feel tight instead of loose.
    const dx = (e.clientX - d.lastX) * DRAG_SENSITIVITY;
    const dy = (e.clientY - d.lastY) * DRAG_SENSITIVITY;

    panTargetX.set(panTargetX.get() + dx);
    panTargetY.set(panTargetY.get() + dy);

    // Exponential smoothing, weighted toward the latest sample so a quick
    // flick registers its full velocity instead of being averaged down, then
    // capped so an extreme flick can't launch the canvas too far.
    d.vx = clamp(d.vx * 0.5 + (dx / dt) * 16 * 0.5, -MAX_VELOCITY, MAX_VELOCITY);
    d.vy = clamp(d.vy * 0.5 + (dy / dt) * 16 * 0.5, -MAX_VELOCITY, MAX_VELOCITY);
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
  };

  const handlePointerUp = (e) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    runMomentum();
  };

  const handleMouseMoveParallax = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    parallaxTargetX.set(-nx * BASE_PARALLAX * 2);
    parallaxTargetY.set(-ny * BASE_PARALLAX * 2);
  };

  const handleMouseLeave = () => {
    parallaxTargetX.set(0);
    parallaxTargetY.set(0);
  };

  const items = useMemo(() => GALLERY_ITEMS, []);

  return (
    <>
      <div className="gallery-indicator">DRAG TO EXPLORE</div>

      <div
        ref={containerRef}
        className="gallery-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => {
          // While actively dragging, pan is the only thing moving the
          // canvas — passive parallax is suspended so all photos stay
          // perfectly in sync with the drag.
          if (drag.current.active) {
            handlePointerMove(e);
          } else {
            handleMouseMoveParallax(e);
          }
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        onMouseLeave={handleMouseLeave}
      >
        <motion.div className="gallery-world" style={{ x: worldX, y: worldY }}>
          {TILE_COPIES.map((ix) =>
            TILE_COPIES.map((iy) => (
              <div
                key={`${ix}-${iy}`}
                className="gallery-tile"
                style={{ transform: `translate(${ix * tile.w}px, ${iy * tile.h}px)`, width: tile.w, height: tile.h }}
              >
                {items.map((item) => (
                  <GalleryCard
                    key={item.id}
                    item={item}
                    tileW={tile.w}
                    tileH={tile.h}
                    parallaxX={parallaxX}
                    parallaxY={parallaxY}
                  />
                ))}
              </div>
            ))
          )}
        </motion.div>
      </div>
    </>
  );
}
