import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";

import { ChibiYasuo, CHARACTER_HEIGHT, SCALE_MULTIPLIER } from "./models.jsx";

/**
 * <FooterScene />
 *
 * The 3D layer mounted (by footer-main.jsx) into the existing static
 * .site-footer as a transparent canvas strip along the footer's bottom edge.
 * A single persistently-mounted <ChibiYasuo /> (see models.jsx) crossfades
 * between clips on one shared skeleton as `mode` changes:
 *   - "idle" at a resting spot when the cursor is far away
 *   - "run" horizontally after the cursor's X while the cursor is inside
 *     the footer
 *   - "interact" (a spell-cast clip) when clicked, facing whichever way it
 *     was already running, then goes back to running/idling based on where
 *     the cursor is
 *
 * The wrapper is pointer-events: none so footer links always work; it flips
 * to auto only while the cursor sits directly over the character.
 */

// ---------- tuning ----------
const HOVER_RADIUS_PX = 60; // horizontal px distance that counts as "hovering the character"
// World units per second — a fixed, constant march speed toward the target,
// independent of how far away it is. A 5px gap and a 500px gap close at the
// identical pace; only the time to arrive differs. (See the useFrame step
// below — this replaced a damp()-based ease, whose step size scales with
// remaining distance, so it used to rush when far and crawl when close.)
const MOVE_SPEED = 4;
// Screen pixels. Below this distance from the target the character is
// considered "arrived" and freezes into idle rather than continuing to
// creep — without a real deadzone, a nearly-stationary cursor's sub-pixel
// jitter kept nudging the character a hair past/under the arrive threshold
// every other frame, which read as run/idle spazzing in place. Expressed in
// screen px (converted to world units per-frame below) so it stays a
// constant, resize-proof "N pixels of slop" rather than a fraction of the
// viewport.
const DEADZONE_PX = 4;
const EDGE_MARGIN = 0.8; // world units the character keeps away from the canvas edges
const TURN_DAMP = 6; // rotation still eases smoothly — only the position march is constant-speed
const MAX_FRAME_DT = 1 / 30; // clamp useFrame's delta so a background-tab hiccup can't be misread as "arrived" in one giant step
const FACE_ANGLE = Math.PI / 2; // Y rotation when running right (model faces +Z at rest)
// Screen px either side of the character's projected X counted as part of
// its body for the text-overlap check below — roughly the model's on-screen
// footprint, a bit narrower than HOVER_RADIUS_PX since that one is padded
// for easy clicking rather than tracking actual silhouette width.
const CHAR_OVERLAP_HALF_WIDTH_PX = 45;
// z-index the .footer-scene strip is promoted to while the character
// overlaps the text above it, so it draws in front instead of tucked behind
// (see the overlap check in CharacterRig's useFrame). Must clear
// .footer-inner's z-index: 1.
const ELEVATED_Z_INDEX = "2";
// The model's actual rendered height in world units (see models.jsx's
// staticBoundingBox normalization) -- used below to find the character's
// own on-screen footprint rather than treating the whole (mostly
// transparent) canvas strip as its bounds, which would overlap the text
// almost permanently since the strip runs right up to it.
const CHAR_WORLD_HEIGHT = CHARACTER_HEIGHT * SCALE_MULTIPLIER;
const REST_X_FRACTION = 0; // spawn spot before the cursor has ever entered the footer (fraction of canvas width, 0 = center)
const CAM_Y = 1.0;
const CAM_Z = 6.5;
// Orthographic instead of perspective: a wide-FOV perspective camera stretches
// anything away from dead-center of the frustum, which is exactly the edge
// distortion this rig was hitting as the character ran toward the sides.
// Orthographic projection has no vanishing point, so proportions stay
// identical across the full width of the strip.
//
// World units of vertical space the canvas should always show, independent
// of the canvas's actual on-screen pixel height. zoom = canvas height (px) /
// this constant, recomputed live in <SyncOrthoZoom> below. A *fixed* zoom
// number (the old approach) only looks right at the one canvas height it was
// tuned against -- .footer-scene's height now scales with viewport width
// (see style.css), so a fixed zoom made the character shrink to a smaller
// and smaller fraction of that strip as the strip grew, instead of scaling
// with it the way everything else in the footer does.
const WORLD_VIEW_HEIGHT = 3.75;

// Keeps the orthographic camera's zoom locked to WORLD_VIEW_HEIGHT of
// vertical world space no matter how tall the canvas itself renders at --
// see the WORLD_VIEW_HEIGHT comment above. R3F's default camera setup only
// recomputes left/right/top/bottom from `size` on resize; it never touches
// `zoom`, so this has to be done by hand.
function SyncOrthoZoom() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = size.height / WORLD_VIEW_HEIGHT;
    camera.updateProjectionMatrix();
  }, [camera, size.height]);
  return null;
}

function CharacterRig({ pointerRef, wrapperRef }) {
  const group = useRef();
  const { viewport } = useThree();

  // "idle" | "run" | "interact"
  const [mode, setMode] = useState("idle");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const halfW = viewport.width / 2;
  const groundY = CAM_Y - viewport.height / 2 + 0.02;
  const restX = viewport.width * REST_X_FRACTION;

  // Wherever the character was last actually chasing the cursor. Updated
  // continuously while the cursor is near; once the cursor leaves, this
  // freezes at that last value instead of falling back to restX, so the
  // walk-to-idle target is "where the mouse was," not "the far-left spawn
  // spot."
  const lastTargetXRef = useRef(restX);

  // Any click within the same "near the footer" zone that wakes the
  // character to chase the cursor (see pointer.near, set in FooterScene's
  // pointermove listener below) triggers the cast — not just a click
  // landing directly on the character's own geometry. A plain window
  // listener (rather than an R3F onClick on the model) is what makes that
  // possible: it fires regardless of where in the footer the click hit,
  // including footer links, which keeps working normally alongside it.
  useEffect(() => {
    const handleWindowClick = () => {
      if (modeRef.current !== "interact" && pointerRef.current.near) {
        setMode("interact");
      }
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, [pointerRef]);

  // Fired by the taunt clip's mixer when it finishes; the next frame
  // promotes straight back to "run" if the cursor is still nearby.
  const handleInteractFinished = useCallback(() => setMode("idle"), []);

  // The footer text block (.footer-top), looked up lazily once and cached —
  // it's a static element outside React's tree here, so there's nothing to
  // re-query it for. Read in the overlap check below so the character can
  // draw in front of it while crossing.
  const textElRef = useRef(null);
  const elevatedRef = useRef(false);

  useFrame((_, delta) => {
    const g = group.current;
    const wrapper = wrapperRef.current;
    const pointer = pointerRef.current;
    if (!g || !wrapper) return;

    // A backgrounded/throttled tab can hand useFrame one huge delta on the
    // frame it regains focus. The position step below is already clamped to
    // targetX so a giant dt can't overshoot, but this still keeps the turn
    // damp() (still exponential) and the walking-animation cadence sane.
    const dt = Math.min(delta, MAX_FRAME_DT);

    const rect = wrapper.getBoundingClientRect();
    const interacting = modeRef.current === "interact";

    // Cursor clientX -> world X on the z = 0 plane of this canvas.
    const cursorWorldX =
      ((pointer.x - rect.left) / rect.width - 0.5) * viewport.width;

    const targetX = THREE.MathUtils.clamp(
      pointer.near ? cursorWorldX : lastTargetXRef.current,
      -halfW + EDGE_MARGIN,
      halfW - EDGE_MARGIN
    );
    // Only track while near; once the cursor leaves, this stops updating and
    // holds the walk-to target steady at the last tracked spot.
    if (pointer.near) lastTargetXRef.current = targetX;

    const dx = targetX - g.position.x;
    const distance = Math.abs(dx);
    // Deadzone in world units, recomputed every frame off the canvas's
    // current on-screen width so it tracks resizes instead of drifting.
    const deadzone = DEADZONE_PX * (viewport.width / rect.width);
    const moving = distance > deadzone;

    // Constant-velocity march, frozen in place while the taunt plays OR
    // while inside the deadzone — below that threshold the character holds
    // its exact current spot rather than creeping the last few pixels,
    // which is what caused the run/idle flicker. Always steps from
    // g.position.x's current value — never reset or reassigned elsewhere —
    // so entering from any target never jumps the start point. Clamped to
    // targetX (never overshoots) so a huge step — e.g. a giant dt from a
    // backgrounded tab — can't send it past the target and back.
    if (!interacting && moving) {
      const step = MOVE_SPEED * dt;
      g.position.x = distance <= step ? targetX : g.position.x + Math.sign(dx) * step;
    }

    // Face the travel direction, settle back to camera-facing when stopped.
    // Frozen entirely while interacting — a click mid-run should perform
    // the cast facing whichever way the character was already running, not
    // snap back to face the camera first.
    if (!interacting) {
      const targetRot = moving ? Math.sign(dx) * FACE_ANGLE : 0;
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetRot, TURN_DAMP, dt);
    }

    // Promote/demote run <-> idle (guarded so we don't setState every frame).
    if (!interacting) {
      const next = moving ? "run" : "idle";
      if (next !== modeRef.current) setMode(next);
    }

    // Only while the cursor is directly over the character does the wrapper
    // accept pointer events — everywhere else, footer links win.
    const charScreenX =
      (g.position.x / viewport.width + 0.5) * rect.width + rect.left;
    const hovering =
      pointer.y >= rect.top &&
      pointer.y <= rect.bottom &&
      Math.abs(pointer.x - charScreenX) < HOVER_RADIUS_PX;

    wrapper.style.pointerEvents = hovering ? "auto" : "none";
    wrapper.style.cursor = hovering ? "pointer" : "";

    // Draw the character in front of the footer text whenever it's actually
    // crossing underneath it, instead of always sitting behind it. Normally
    // .footer-scene's runway sits below the text with clearance to spare,
    // but on cramped layouts (or a character standing near the edges) the
    // two can overlap — layering it on top there reads as "walking across
    // the text" instead of "vanishing behind it."
    if (!textElRef.current) {
      textElRef.current = wrapper.closest(".site-footer")?.querySelector(".footer-top") ?? null;
    }
    const textEl = textElRef.current;
    if (textEl) {
      const textRect = textEl.getBoundingClientRect();
      // The character's own on-screen footprint, not the whole canvas
      // strip — the strip is mostly transparent and often grazes the text's
      // bottom edge even while the model itself is well clear of it, which
      // would otherwise pin this elevated almost permanently.
      const pxPerWorldUnit = rect.height / viewport.height;
      const charScreenBottom = rect.bottom;
      const charScreenTop = charScreenBottom - CHAR_WORLD_HEIGHT * pxPerWorldUnit;
      const overlapping =
        charScreenBottom > textRect.top &&
        charScreenTop < textRect.bottom &&
        charScreenX + CHAR_OVERLAP_HALF_WIDTH_PX > textRect.left &&
        charScreenX - CHAR_OVERLAP_HALF_WIDTH_PX < textRect.right;
      if (overlapping !== elevatedRef.current) {
        elevatedRef.current = overlapping;
        const strip = wrapper.parentElement;
        if (strip) strip.style.zIndex = overlapping ? ELEVATED_Z_INDEX : "";
      }
    }
  });

  return (
    <>
      <group ref={group} position={[restX, groundY, 0]}>
        {/* One persistently-mounted model whose clip crossfades on the
            shared skeleton as `mode` changes — never unmounted/remounted,
            which is what makes the transition an actual blend instead of a
            cut between three separate objects. Triggered by the window
            click listener above, not an onClick here — see that comment. */}
        <ChibiYasuo animation={mode} onFinished={handleInteractFinished} />
      </group>
      <ContactShadows
        position={[0, groundY + 0.01, 0]}
        opacity={0.4}
        scale={viewport.width}
        blur={2.2}
        far={2.5}
      />
    </>
  );
}

export default function FooterScene() {
  const wrapperRef = useRef(null);
  // Mutable pointer state shared with the R3F frame loop — no re-renders.
  const pointerRef = useRef({ x: -9999, y: -9999, near: false });

  useEffect(() => {
    // "Near" is judged against the whole dark .site-footer area, not just
    // the canvas strip (wrapperRef) — that strip only covers the footer's
    // bottom 150px (see .footer-scene in style.css), while the footer
    // itself is taller. The canvas strip's own rect is still what the
    // frame loop in CharacterRig uses for cursor-to-world-X mapping, since
    // that's the actual render surface.
    const footerEl = wrapperRef.current?.closest(".site-footer");
    const handleMove = (e) => {
      const rect = footerEl?.getBoundingClientRect();
      if (!rect) return;
      const p = pointerRef.current;
      p.x = e.clientX;
      p.y = e.clientY;
      p.near =
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right;
    };
    const handleLeave = () => {
      pointerRef.current.near = false;
    };
    window.addEventListener("pointermove", handleMove);
    // Touch devices never fire pointermove without an active drag, so a tap
    // alone would leave pointerRef.current.near stuck at its initial false
    // and never reach the character. pointerdown fires on both touch and
    // mouse, so reusing handleMove there brings the tapped spot in *before*
    // the window "click" listener in CharacterRig checks pointer.near --
    // that's what makes tap-to-walk and tap-the-character-to-cast work.
    window.addEventListener("pointerdown", handleMove);
    document.documentElement.addEventListener("pointerleave", handleLeave);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerdown", handleMove);
      document.documentElement.removeEventListener("pointerleave", handleLeave);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <Canvas
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        orthographic
        camera={{ position: [0, CAM_Y, CAM_Z], near: 0.1, far: 100 }}
      >
        <SyncOrthoZoom />
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} />
        <Suspense fallback={null}>
          <CharacterRig pointerRef={pointerRef} wrapperRef={wrapperRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}
