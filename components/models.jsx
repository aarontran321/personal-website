import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import chibiYasuoUrl from "./chibi_yasuo.glb?url";

// chibi_yasuo.glb is meshopt-compressed (EXT_meshopt_compression) with
// resampled animation and WebP textures — ~1.25MB of raw glTF down to ~465KB
// (see scripts/optimize-model.mjs). The meshopt decoder is therefore
// mandatory to parse it at all. We wire GLTFLoader by hand here instead of
// drei's useGLTF so the bundle doesn't also pull in DRACOLoader + KTX2Loader,
// which useGLTF registers unconditionally; the meshopt decoder is ~15KB.
//
// NB: POSITION/NORMAL are intentionally left un-quantized upstream. glTF's
// KHR_mesh_quantization stores them as normalized ints plus a per-mesh dequant
// transform on the node — which three ignores for a SkinnedMesh (skinning runs
// off the skeleton), so quantizing them makes staticBoundingBox() below read a
// ~1.9-unit box instead of ~226 and the character loads ~120x too large.
const attachMeshopt = (loader) => loader.setMeshoptDecoder(MeshoptDecoder);

// The raw export is ~226 units tall (League rig units), normalized at load
// to CHARACTER_HEIGHT world units with its feet sitting exactly on the
// group's origin (y = 0).
export const CHARACTER_HEIGHT = 1.8;
export const SCALE_MULTIPLIER = 1.45;

// Every state (idle/run/cast) now lives as a clip on this one skinned mesh,
// so there's exactly one scale and one ground offset for the whole
// character — a per-state Y pop or size mismatch is no longer possible,
// since there's nothing left that could diverge.
function staticBoundingBox(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  object.traverse((child) => {
    if (!child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
    box.union(meshBox);
  });
  return box;
}

// Maps the rig's abstract states (used throughout FooterScene.jsx) to this
// file's actual clip names.
const CLIP_NAMES = {
  idle: "Idle_Base",
  run: "Run_Base",
  interact: "Cast_Damage",
};
const ONE_SHOT_STATES = new Set(["interact"]);
// Blend duration between two clips on the shared skeleton. This is the
// whole reason transitions stop being a hard cut: fadeOut/fadeIn ramp two
// actions' weights on the *same* bones in opposite directions over this
// window, so the mesh interpolates between poses instead of an old scene
// disappearing and a new one popping in.
const CROSSFADE_SECONDS = 0.25;

export function ChibiYasuo({ animation, onFinished }) {
  const group = useRef();
  const { scene, animations } = useLoader(GLTFLoader, chibiYasuoUrl, attachMeshopt);
  const { actions, mixer } = useAnimations(animations, group);
  const currentActionRef = useRef(null);

  const { scale, offsetY } = useMemo(() => {
    const box = staticBoundingBox(scene.clone(true));
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = size.y > 0 ? (CHARACTER_HEIGHT * SCALE_MULTIPLIER) / size.y : SCALE_MULTIPLIER;
    return { scale: s, offsetY: -box.min.y * s };
  }, [scene]);

  useEffect(() => {
    // The heavy rescale confuses the skinned mesh's precomputed bounds,
    // which makes the camera's frustum culling blink the model out.
    scene.traverse((obj) => {
      if (obj.isSkinnedMesh) obj.frustumCulled = false;
    });
  }, [scene]);

  useEffect(() => {
    const action = actions[CLIP_NAMES[animation]];
    if (!action) return undefined;

    const previous = currentActionRef.current;
    action.reset();
    if (ONE_SHOT_STATES.has(animation)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }

    if (previous && previous !== action) {
      action.fadeIn(CROSSFADE_SECONDS).play();
      previous.fadeOut(CROSSFADE_SECONDS);
    } else {
      // First activation ever — nothing to blend from, so just play at
      // full weight instead of fading in from an implicit bind pose.
      action.play();
    }
    currentActionRef.current = action;

    if (!onFinished) return undefined;
    const handleFinished = (e) => {
      if (e.action === action) onFinished();
    };
    mixer.addEventListener("finished", handleFinished);
    return () => mixer.removeEventListener("finished", handleFinished);
  }, [animation, actions, mixer, onFinished]);

  return (
    <group ref={group} scale={scale} position-y={offsetY}>
      <primitive object={scene} />
    </group>
  );
}

useLoader.preload(GLTFLoader, chibiYasuoUrl, attachMeshopt);
