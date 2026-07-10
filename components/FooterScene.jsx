import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";

import { ChibiYasuoBase, ChibiYasuoRun, ChibiYasuoInteract } from "./models.jsx";

/**
 * <FooterScene />
 *
 * The 3D layer mounted (by footer-main.jsx) into the existing static
 * .site-footer as a transparent canvas strip along the footer's bottom edge.
 * The chibi character:
 *   - idles (ChibiYasuoBase) at a resting spot when the cursor is far away
 *   - runs (ChibiYasuoRun) horizontally after the cursor's X while the cursor
 *     is inside, or slightly above, the footer
 *   - plays its taunt (ChibiYasuoInteract) when clicked, then goes back to
 *     running/idling based on where the cursor is
 *
 * The wrapper is pointer-events: none so footer links always work; it flips
 * to auto only while the cursor sits directly over the character.
 */

// ---------- tuning ----------
const PROXIMITY_PX = 140; // cursor may be this many px above the footer and still wake the character
const HOVER_RADIUS_PX = 60; // horizontal px distance that counts as "hovering the character"
// Fraction of the canvas half-width; closer than this = "arrived", switch to
// idle. Relative rather than a fixed world-unit distance so the tolerance
// scales with the footer's actual width instead of drifting further off
// (in px) the wider the page gets.
const ARRIVE_EPSILON_FRACTION = 0.02;
const EDGE_MARGIN = 0.8; // world units the character keeps away from the canvas edges
// lower = floatier/slower chase, higher = snappier. damp() is exponential —
// it never mathematically reaches the target, only approaches it — so this
// value also sets how long "arrival" takes to register: at the old 0.45 the
// chase needed 10+ seconds of the cursor sitting still before it got within
// ARRIVE_EPSILON, so the run -> idle handoff below effectively never fired.
const MOVE_DAMP = 3.2;
const TURN_DAMP = 6;
const MAX_FRAME_DT = 1 / 30; // clamp useFrame's delta so a background-tab hiccup can't be misread as "arrived" in one giant step
const FACE_ANGLE = Math.PI / 2; // Y rotation when running right (model faces +Z at rest)
const REST_X_FRACTION = -0.32; // spawn spot before the cursor has ever entered the footer (fraction of canvas width, 0 = center)
const CAM_Y = 1.0;
const CAM_Z = 6.5;
// Orthographic instead of perspective: a wide-FOV perspective camera stretches
// anything away from dead-center of the frustum, which is exactly the edge
// distortion this rig was hitting as the character ran toward the sides.
// Orthographic projection has no vanishing point, so proportions stay
// identical across the full width of the strip. Zoom is picked against the
// footer canvas's fixed 150px height (see .footer-scene in style.css) to
// land on roughly the same framing the old fov/distance pairing produced.
const ORTHO_ZOOM = 36;

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

  const handleClick = (e) => {
    e.stopPropagation();
    if (modeRef.current !== "interact") setMode("interact");
  };

  // Fired by the taunt clip's mixer when it finishes; the next frame
  // promotes straight back to "run" if the cursor is still nearby.
  const handleInteractFinished = useCallback(() => setMode("idle"), []);

  useFrame((_, delta) => {
    const g = group.current;
    const wrapper = wrapperRef.current;
    const pointer = pointerRef.current;
    if (!g || !wrapper) return;

    // A backgrounded/throttled tab can hand useFrame one huge delta on the
    // frame it regains focus. Fed straight into damp(), that single step
    // finishes almost the entire chase at once, which reads as a teleport —
    // clamping it keeps every position update gradual, so the character
    // always glides from wherever it currently is rather than snapping.
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
    const moving = Math.abs(dx) > halfW * ARRIVE_EPSILON_FRACTION;

    // Horizontal-only easing; frozen in place while the taunt plays. Always
    // eases from g.position.x's current value — never reset or reassigned
    // elsewhere — so entering from any target never jumps the start point.
    if (!interacting) {
      g.position.x = THREE.MathUtils.damp(g.position.x, targetX, MOVE_DAMP, dt);
    }

    // Face the travel direction, settle back to camera-facing when stopped.
    const targetRot = !interacting && moving ? Math.sign(dx) * FACE_ANGLE : 0;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetRot, TURN_DAMP, dt);

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
  });

  return (
    <>
      <group ref={group} position={[restX, groundY, 0]} onClick={handleClick}>
        {mode === "idle" && <ChibiYasuoBase />}
        {mode === "run" && <ChibiYasuoRun />}
        {mode === "interact" && (
          <ChibiYasuoInteract onFinished={handleInteractFinished} />
        )}
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
    const handleMove = (e) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const p = pointerRef.current;
      p.x = e.clientX;
      p.y = e.clientY;
      p.near =
        e.clientY >= rect.top - PROXIMITY_PX &&
        e.clientY <= rect.bottom &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right;
    };
    const handleLeave = () => {
      pointerRef.current.near = false;
    };
    window.addEventListener("pointermove", handleMove);
    document.documentElement.addEventListener("pointerleave", handleLeave);
    return () => {
      window.removeEventListener("pointermove", handleMove);
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
        camera={{ position: [0, CAM_Y, CAM_Z], zoom: ORTHO_ZOOM, near: 0.1, far: 100 }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} />
        <Suspense fallback={null}>
          <CharacterRig pointerRef={pointerRef} wrapperRef={wrapperRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}
