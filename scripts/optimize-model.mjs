// Rebuilds components/chibi_yasuo.glb from the pristine source in
// model-src/chibi_yasuo.source.glb.
//
// What it does, and why each step is the way it is:
//   dedup + weld + prune  — drop duplicate accessors and unreferenced data
//                           (the raw export ships ~46k naive verts for a
//                           12k-tri mesh; weld collapses that to ~7k unique)
//   resample              — losslessly de-duplicate animation keyframes
//   textureCompress webp  — 3 PNG maps (443 KB) -> WebP (~67 KB); dims are
//                           already <=512 so this is transmission-only, no
//                           visible change
//   reorder + meshopt     — EXT_meshopt_compression over geometry, morph and
//                           animation buffers; decodes in ~1ms and stacks
//                           with the CDN's brotli
//
// Deliberately NOT quantizing POSITION / NORMAL. KHR_mesh_quantization stores
// those as normalized int16 and relies on a per-mesh dequant transform on the
// node — which three.js ignores for a SkinnedMesh (skinning runs off the
// skeleton, not the mesh node), so the character loads ~120x too large. UV /
// color quantization is safe and kept. Net: 1.25 MB -> ~465 KB with byte-exact
// skinning. Draco would shave another ~70 KB but costs a ~200 KB wasm decoder
// at runtime, a bad trade here.
//
// Usage: npm run optimize:model

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import {
  dedup,
  weld,
  resample,
  prune,
  quantize,
  reorder,
  textureCompress,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const SRC = "model-src/chibi_yasuo.source.glb";
const OUT = "components/chibi_yasuo.glb";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const doc = await io.read(SRC);

await doc.transform(
  dedup(),
  weld(),
  resample(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
  reorder({ encoder: MeshoptEncoder, target: "size" }),
  // UV + vertex color only — see the header note on why POSITION/NORMAL are left alone.
  quantize({
    pattern: /^(TEXCOORD|COLOR)(_\d+)?$/,
    patternTargets: /^(TEXCOORD|COLOR)(_\d+)?$/,
  }),
);

doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });

await io.write(OUT, doc);

const { size } = await import("node:fs/promises").then((fs) => fs.stat(OUT));
console.log(`${OUT} — ${(size / 1024).toFixed(1)} KB`);
