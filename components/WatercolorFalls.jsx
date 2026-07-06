import { useEffect, useId, useState } from "react";

/**
 * <WatercolorFalls />
 *
 * A wide (21:9) watercolor landscape — layered mountain peaks, a slender
 * waterfall dropping through a rocky gorge into a small calm pond — rendered
 * entirely with inline SVG. Five distinct hand-wobbled frames are pre-built
 * at module load and flipped through at ~6 fps with zero interpolation, so
 * the brush strokes visibly flicker like a hand-drawn flipbook.
 *
 * No external assets. Paper grain and ragged watercolor edges are generated
 * with SVG turbulence/displacement filters, masked to the painted shapes so
 * the component stays transparent and blends into any light page background.
 *
 * Usage (inline, right of a text header):
 *   <header className="flex flex-col md:flex-row items-center gap-10">
 *     <div className="md:w-1/2">…name / intro…</div>
 *     <WatercolorFalls className="md:w-1/2" />
 *   </header>
 */

const FRAME_COUNT = 5;
const FPS = 6;

/* ------------------------------------------------------------------ */
/* Deterministic per-frame randomness                                  */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jitter a polyline and smooth it into a quadratic path string. */
function wobble(points, amp, rnd, close = false) {
  const p = points.map(([x, y]) => [
    x + (rnd() - 0.5) * 2 * amp,
    y + (rnd() - 0.5) * 2 * amp,
  ]);
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length; i++) {
    const [px, py] = p[i - 1];
    const mx = (px + p[i][0]) / 2;
    const my = (py + p[i][1]) / 2;
    d += ` Q${px.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const [lx, ly] = p[p.length - 1];
  d += ` L${lx.toFixed(1)},${ly.toFixed(1)}`;
  return close ? `${d} Z` : d;
}

function ellipsePoints(cx, cy, rx, ry, n = 14) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}

/* ------------------------------------------------------------------ */
/* Scene geometry (viewBox 840 x 360, ~21:9)                           */
/* ------------------------------------------------------------------ */

const FAR_PEAKS = [
  [-30, 205], [60, 150], [140, 108], [225, 152], [305, 122], [385, 168],
  [470, 112], [560, 152], [645, 98], [725, 142], [805, 124], [870, 158],
  [870, 262], [-30, 262],
];

const MID_PEAKS = [
  [-30, 238], [70, 192], [155, 158], [240, 206], [330, 162], [430, 212],
  [520, 152], [610, 196], [700, 168], [790, 206], [870, 188],
  [870, 292], [-30, 292],
];

const LEFT_CLIFF = [
  [-30, 370], [-30, 252], [60, 238], [150, 256], [245, 242], [320, 258],
  [382, 250], [398, 268], [392, 300], [388, 332], [382, 370],
];

const RIGHT_CLIFF = [
  [870, 370], [870, 256], [790, 246], [700, 262], [612, 246], [540, 262],
  [472, 252], [454, 272], [460, 304], [464, 336], [470, 370],
];

const FALL_WASH = [
  [398, 252], [452, 252], [450, 280], [448, 312], [400, 312], [396, 280],
];

const STREAM_XS = [408, 419, 431, 442];

const ROCK_LEFT = [
  [300, 340], [318, 322], [338, 318], [352, 330], [346, 346], [312, 348],
];

const ROCK_RIGHT = [
  [510, 344], [522, 324], [544, 320], [560, 332], [554, 348], [520, 350],
];

function buildFrame(seed) {
  const rnd = mulberry32(seed);

  const streams = STREAM_XS.map((x) => {
    const pts = [];
    for (let y = 250; y <= 310; y += 12) pts.push([x, y]);
    return wobble(pts, 2.5, rnd);
  });

  const ripples = [
    { half: 118, dy: 7 },
    { half: 82, dy: 1 },
    { half: 46, dy: -4 },
  ].map(({ half, dy }) =>
    wobble(
      [
        [424 - half, 320 + dy],
        [424 - half / 2, 323 + dy],
        [424, 321 + dy],
        [424 + half / 2, 324 + dy],
        [424 + half, 320 + dy],
      ],
      2,
      rnd
    )
  );

  const splashes = Array.from({ length: 7 }, () => ({
    cx: +(424 + (rnd() - 0.5) * 46).toFixed(1),
    cy: +(306 + (rnd() - 0.5) * 10).toFixed(1),
    r: +(1.2 + rnd() * 1.6).toFixed(1),
  }));

  return {
    farPeaks: wobble(FAR_PEAKS, 4, rnd, true),
    midPeaks: wobble(MID_PEAKS, 4, rnd, true),
    leftCliff: wobble(LEFT_CLIFF, 3, rnd, true),
    rightCliff: wobble(RIGHT_CLIFF, 3, rnd, true),
    pond: wobble(ellipsePoints(424, 322, 138, 20), 3, rnd, true),
    pondInner: wobble(ellipsePoints(430, 320, 90, 11), 2.5, rnd, true),
    fallWash: wobble(FALL_WASH, 3, rnd, true),
    streams,
    ripples,
    splashes,
    mist: { rx: +(30 + rnd() * 8).toFixed(1), ry: +(8 + rnd() * 3).toFixed(1) },
    rockLeft: wobble(ROCK_LEFT, 3, rnd, true),
    rockRight: wobble(ROCK_RIGHT, 3, rnd, true),
  };
}

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) =>
  buildFrame(i * 1013 + 7)
);

/* ------------------------------------------------------------------ */
/* Palette — muted watercolor grays, soft purples, pale pastel blue    */
/* ------------------------------------------------------------------ */

const INK = {
  far: "#cbc4d4",
  mid: "#a89fb6",
  cliffL: "#8b8399",
  cliffR: "#948ba1",
  fall: "#d9e7ed",
  streamA: "#ffffff",
  streamB: "#c3dbe4",
  pond: "#b9d4dd",
  pondInner: "#dcebef",
  ripple: "#8fb7c3",
  rock: "#857e93",
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function WatercolorFalls({ className = "" }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const id = setInterval(
      () => setFrame((f) => (f + 1) % FRAME_COUNT),
      1000 / FPS
    );
    return () => clearInterval(id);
  }, []);

  const f = FRAMES[frame];

  return (
    <svg
      viewBox="0 0 840 360"
      className={`block h-auto w-full select-none ${className}`}
      role="img"
      aria-label="Watercolor illustration of misty mountains with a slender waterfall falling into a small pond"
    >
      <defs>
        {/* One watercolor filter per frame: a differently-seeded turbulence
            roughs up the stroke edges, then fine paper grain is multiplied
            in — but only where paint exists, so the background stays
            transparent and merges with the page. */}
        {FRAMES.map((_, i) => (
          <filter
            key={i}
            id={`${uid}-wc-${i}`}
            x="-15%"
            y="-15%"
            width="130%"
            height="130%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.024"
              numOctaves="3"
              seed={11 + i * 17}
              result="disp"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="disp"
              scale="10"
              result="paint"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.55"
              numOctaves="2"
              seed="99"
              result="paperNoise"
            />
            <feColorMatrix
              in="paperNoise"
              type="matrix"
              values="0 0 0 0 0.52  0 0 0 0 0.50  0 0 0 0 0.47  0 0 0 0.18 0"
              result="paperTint"
            />
            <feComposite
              in="paperTint"
              in2="paint"
              operator="in"
              result="paperOnPaint"
            />
            <feBlend in="paperOnPaint" in2="paint" mode="multiply" />
          </filter>
        ))}
        <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Only the current frame's paths are mounted — the swap is a hard
          cut with no transitions, giving the stop-motion flicker. */}
      <g filter={`url(#${uid}-wc-${frame})`}>
        {/* atmospheric mountain layers */}
        <path d={f.farPeaks} fill={INK.far} opacity="0.45" />
        <path d={f.midPeaks} fill={INK.mid} opacity="0.5" />

        {/* near ridges framing the gorge */}
        <path d={f.leftCliff} fill={INK.cliffL} opacity="0.6" />
        <path d={f.rightCliff} fill={INK.cliffR} opacity="0.6" />

        {/* pond */}
        <path d={f.pond} fill={INK.pond} opacity="0.8" />
        <path d={f.pondInner} fill={INK.pondInner} opacity="0.8" />
        {f.ripples.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={INK.ripple}
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.7"
          />
        ))}

        {/* waterfall */}
        <path d={f.fallWash} fill={INK.fall} opacity="0.95" />
        {f.streams.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={i % 2 === 0 ? INK.streamA : INK.streamB}
            strokeWidth={i % 2 === 0 ? 3 : 2.2}
            strokeLinecap="round"
            opacity="0.85"
          />
        ))}

        {/* mist and splash at the base */}
        <ellipse
          cx="424"
          cy="308"
          rx={f.mist.rx}
          ry={f.mist.ry}
          fill="#ffffff"
          opacity="0.45"
          filter={`url(#${uid}-soft)`}
        />
        {f.splashes.map((s, i) => (
          <circle
            key={i}
            cx={s.cx}
            cy={s.cy}
            r={s.r}
            fill="#ffffff"
            opacity="0.9"
          />
        ))}

        {/* foreground rocks at the pond's edge */}
        <path d={f.rockLeft} fill={INK.rock} opacity="0.85" />
        <path d={f.rockRight} fill={INK.rock} opacity="0.85" />
      </g>
    </svg>
  );
}
