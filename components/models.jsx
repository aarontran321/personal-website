import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF, useAnimations } from "@react-three/drei";

import baseUrl from "./chibi_yasuo_base.glb?url";
import runUrl from "./chibi_yasuo_run.glb?url";
import interactUrl from "./chibi_yasuo_interact.glb?url";

// The raw exports are ~226 units tall (League rig units), so every model is
// normalized at load: scaled to CHARACTER_HEIGHT world units with its feet
// sitting exactly on the group's origin (y = 0).
export const CHARACTER_HEIGHT = 1.8;
// Applied identically to all three states (see useSharedScale below) so the
// character reads as one consistently-sized figure at rest.
const SCALE_MULTIPLIER = 1.45;

// THREE.SkinnedMesh keeps its own object-level `.boundingBox`, separate from
// `geometry.boundingBox` — and its computeBoundingBox() bakes in whatever
// pose the skeleton is CURRENTLY in (via skinning), not the static bind pose.
// Box3.setFromObject() prefers that object-level box when present, so
// measuring a SkinnedMesh mid-animation (or frozen mid-animation, since a
// unmounted model's mixer stops ticking wherever it last left the bones)
// gives a different height every time. Reading geometry.boundingBox directly
// sidesteps that entirely — it's derived from the raw, un-skinned vertex
// buffer, so it's identical no matter what pose the rig happens to be in.
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

// base/run/interact are three separate .glb exports of the same rig, and
// their baked bind poses aren't pixel-identical (e.g. the run pose's stride
// changes its own bounding-box height). Measuring each file's own box and
// normalizing independently made state swaps visibly shrink/grow the
// character. Instead every state is scaled off the *base* model's box alone
// — one shared number — so switching state can never change apparent size.
// (useGLTF caches by url, so the extra useGLTF(baseUrl) call below is a
// cache hit, not a second load, for whichever state isn't the base itself.)
function useSharedScale() {
  const { scene: baseScene } = useGLTF(baseUrl);
  return useMemo(() => {
    // baseScene is drei's cached object — the SAME instance the idle state
    // renders live as its <primitive>, parented under that state's scaled
    // wrapper <group>. Measuring baseScene directly walks up its current (or,
    // once idle unmounts, last-attached-but-now-orphaned) parent chain via
    // matrixWorld, so the box comes back pre-multiplied by that wrapper's
    // scale — shrinking the measured size and inflating this result to
    // compensate. Cloning first guarantees parent === null, so the box always
    // reflects the model's own local-space size regardless of mount history.
    const size = new THREE.Vector3();
    staticBoundingBox(baseScene.clone(true)).getSize(size);
    return size.y > 0 ? (CHARACTER_HEIGHT * SCALE_MULTIPLIER) / size.y : SCALE_MULTIPLIER;
  }, [baseScene]);
}

function CharacterModel({ url, loopOnce = false, onFinished }) {
  const group = useRef();
  const { scene, animations } = useGLTF(url);
  const { actions, names, mixer } = useAnimations(animations, group);
  const scale = useSharedScale();

  // Grounding still uses this model's own lowest point (feet position
  // differs slightly per pose) — only the scale factor itself is shared.
  // Same clone-first requirement as useSharedScale above: `scene` is the
  // cached-by-url object this very state renders as its live <primitive>, so
  // measuring it in place is subject to the same stale-parent contamination
  // across remounts (e.g. idle -> run -> idle).
  const offsetY = useMemo(() => {
    const box = staticBoundingBox(scene.clone(true));
    return -box.min.y * scale;
  }, [scene, scale]);

  useEffect(() => {
    // The heavy rescale confuses the skinned mesh's precomputed bounds,
    // which makes the camera's frustum culling blink the model out.
    scene.traverse((obj) => {
      if (obj.isSkinnedMesh) obj.frustumCulled = false;
    });
  }, [scene]);

  useEffect(() => {
    const action = actions[names[0]];
    if (!action) return;

    action.reset();
    if (loopOnce) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();

    if (!onFinished) return () => action.stop();

    const handleFinished = (e) => {
      if (e.action === action) onFinished();
    };
    mixer.addEventListener("finished", handleFinished);
    return () => {
      mixer.removeEventListener("finished", handleFinished);
      action.stop();
    };
  }, [actions, names, mixer, loopOnce, onFinished]);

  return (
    <group ref={group} scale={scale} position-y={offsetY}>
      <primitive object={scene} />
    </group>
  );
}

// Named to mirror the source .glb files. JSX only invokes a component for
// tag names that start with an uppercase letter — a lowercase tag is always
// treated as a host element (and, inside a Canvas, react-three-fiber tries
// to resolve it to a THREE.* constructor and throws) — so these are
// PascalCase rather than literally `chibi_yasuo_base`.
export const ChibiYasuoBase = (props) => <CharacterModel url={baseUrl} {...props} />;
export const ChibiYasuoRun = (props) => <CharacterModel url={runUrl} {...props} />;
export const ChibiYasuoInteract = (props) => (
  <CharacterModel url={interactUrl} loopOnce {...props} />
);

useGLTF.preload(baseUrl);
useGLTF.preload(runUrl);
useGLTF.preload(interactUrl);
