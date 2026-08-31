import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import paperAirplaneUrl from "./paper-airplane.glb?url";

/**
 * <PaperAirplaneLayer />
 *
 * A transparent R3F canvas stacked on top of HeroRoute's SVG trail. Reads
 * flight progress (0..1, driven by scroll -- see progressRef in
 * HeroRoute.jsx) each frame, samples the *same* <path> DOM element the SVG
 * trail draws with (pathRef), and flies the plane along it.
 *
 * Coordinate trick: the SVG is authored in a VIEW_W x VIEW_H user-space and
 * rendered with preserveAspectRatio="none", so it stretches 1:1 onto its
 * actual box -- meaning "x / VIEW_W, y / VIEW_H" is a resolution-independent
 * 0..1 fraction of the column regardless of viewport size. R3F's default
 * orthographic camera (zoom left at 1) makes 1 world unit = 1 canvas pixel,
 * and `viewport.width/height` (from useThree) already reports the visible
 * frustum in those same units -- so `(fraction - 0.5) * viewport.width/height`
 * lands the plane at the right screen position with no manual zoom syncing,
 * at any canvas size.
 */

const AIRPLANE_LENGTH_PX = 46; // on-screen nose-to-tail size, in canvas px
const MODEL_LENGTH_UNITS = 181; // mesh's own bounding box: z range -88..93

// Local +Z is the mesh's nose-to-tail axis (its longest bounding-box
// extent). This constant rotation brings that axis into the world XY
// (screen) plane, nose pointing toward +Y ("up the trail") at heading 0.
// If the model renders flying tail-first, flip the sign.
const NOSE_ALIGN_X = -Math.PI / 2;
// Extra constant pitch so the plane reads as viewed from slightly above and
// behind -- like scanning a map -- instead of dead side-on.
const COSMETIC_TILT_X = 0.34;
const REST_TILT_X = NOSE_ALIGN_X + COSMETIC_TILT_X;

const LOOKAHEAD_FRAC = 0.01; // fraction of path length sampled ahead, for heading/tangent
const BANK_GAIN = 2.6; // turn-rate -> roll amount
const MAX_BANK = 0.55; // radians (~31°)
const BANK_DAMP = 5; // eases the roll instead of snapping to it
const IDLE_BOB_AMPLITUDE = 2.5; // px -- keeps the plane alive even mid-glide
const IDLE_BOB_SPEED = 1.6;

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function shortestAngleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function AirplaneRig({ progressRef, pathRef, viewW, viewH }) {
  const outerRef = useRef();
  const bankRef = useRef();
  const { scene } = useGLTF(paperAirplaneUrl);
  const { viewport } = useThree();

  const model = useMemo(() => scene.clone(true), [scene]);
  const scale = AIRPLANE_LENGTH_PX / MODEL_LENGTH_UNITS;

  const prevHeadingRef = useRef(null);
  const bankValueRef = useRef(0);
  const clockRef = useRef(0);

  useFrame((_, delta) => {
    const pathEl = pathRef.current;
    const outer = outerRef.current;
    const bankGroup = bankRef.current;
    if (!pathEl || !outer || !bankGroup) return;

    const total = pathEl.getTotalLength();
    if (!total) return;

    clockRef.current += delta;

    const t = clamp01(progressRef.current);
    const p1 = pathEl.getPointAtLength(t * total);
    const p2 = pathEl.getPointAtLength(clamp01(t + LOOKAHEAD_FRAC) * total);

    const worldX1 = (p1.x / viewW - 0.5) * viewport.width;
    const worldY1 = -(p1.y / viewH - 0.5) * viewport.height;
    const worldX2 = (p2.x / viewW - 0.5) * viewport.width;
    const worldY2 = -(p2.y / viewH - 0.5) * viewport.height;

    const dx = worldX2 - worldX1;
    const dy = worldY2 - worldY1;
    const heading = Math.atan2(-dx, dy);

    const idleBob = Math.sin(clockRef.current * IDLE_BOB_SPEED) * IDLE_BOB_AMPLITUDE;
    outer.position.set(worldX1, worldY1 + idleBob, 0);
    outer.rotation.z = heading;

    let turnRate = 0;
    if (prevHeadingRef.current !== null && delta > 0) {
      turnRate = shortestAngleDelta(heading, prevHeadingRef.current) / delta;
    }
    prevHeadingRef.current = heading;

    const targetBank = THREE.MathUtils.clamp(-turnRate * BANK_GAIN, -MAX_BANK, MAX_BANK);
    bankValueRef.current = THREE.MathUtils.damp(bankValueRef.current, targetBank, BANK_DAMP, delta);
    bankGroup.rotation.z = bankValueRef.current;
  });

  return (
    <group ref={outerRef}>
      <group rotation={[REST_TILT_X, 0, 0]}>
        <group ref={bankRef}>
          <primitive object={model} scale={scale} />
        </group>
      </group>
    </group>
  );
}

export default function PaperAirplaneLayer({ progressRef, pathRef, viewW, viewH }) {
  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 0, 100], near: 0.1, far: 1000, zoom: 1 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <ambientLight intensity={1.3} />
      <directionalLight position={[2, 4, 5]} intensity={1.5} />
      <directionalLight position={[-3, -2, 2]} intensity={0.4} />
      <Suspense fallback={null}>
        <AirplaneRig progressRef={progressRef} pathRef={pathRef} viewW={viewW} viewH={viewH} />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(paperAirplaneUrl);
