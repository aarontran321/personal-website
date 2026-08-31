import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

import PaperAirplaneLayer from "./PaperAirplaneLayer.jsx";

/**
 * <HeroRoute />
 *
 * Mounted (by hero-route-main.jsx) into the empty right-hand lane of the
 * hero section (see #heroRoute in index.html). #heroScrollTrack, a plain
 * static wrapper around the whole .hero section, is taller than 100vh on
 * desktop (see the .hero-scroll-track rule in style.css) so .hero can sit
 * position: sticky for the extra scroll distance -- that's what turns
 * scrollYProgress below into a 0->1 "flight progress" instead of a normal
 * page scroll.
 *
 * A hand-drawn ink trail (an SVG path, revealed progressively via a mask —
 * see the reveal <mask> below) winds down this column. A small 3D paper
 * airplane (PaperAirplaneLayer, a separate R3F canvas layered on top) flies
 * along the same path, and four waypoint cards fade/scale into focus as the
 * trail reaches them.
 */

// SVG user-space the trail is authored in. preserveAspectRatio="none" below
// stretches this 1:1 onto the actual rendered box, so both the 2D path and
// the 3D airplane (which reads points from the same <path> element, see
// PaperAirplaneLayer) can treat "x / VIEW_W, y / VIEW_H" as a resolution-
// independent 0..1 fraction of the column, with no letterboxing to account
// for.
const VIEW_W = 320;
const VIEW_H = 1000;

// A hand-wavy path, not a rigid one — every curve here was nudged by eye
// rather than computed, which is what keeps it reading as drawn rather than
// plotted. Runs top to bottom through four dwell points.
const PATH_D =
  "M 168,28 C 96,72 66,132 122,182 " +
  "S 258,266 186,344 " +
  "S 56,418 96,494 " +
  "S 248,552 208,632 " +
  "S 66,708 108,782 " +
  "S 218,842 176,906 " +
  "S 128,946 150,968";

const WAYPOINTS = [
  {
    id: "lasertag",
    kind: "project",
    t: 0.14,
    top: "12%",
    side: "right",
    label: "Laser Tag Now!",
    sublabel: "UWB laser tag — iOS",
    href: "https://github.com/ConnorXTan/phonegame",
    media: { type: "video", src: "/videos/lasertagnow_demo1.mp4" },
  },
  {
    id: "cursor-hackathon",
    kind: "photo",
    t: 0.4,
    top: "37%",
    side: "left",
    label: "1st place",
    sublabel: "Cursor Toronto Hackathon",
    media: { type: "image", src: "/images/gallery/firstatcursor.jpg" },
  },
  {
    id: "baam",
    kind: "project",
    t: 0.66,
    top: "62%",
    side: "right",
    label: "BAAM",
    sublabel: "Solana social betting",
    href: "https://github.com/BansonVuong/BAAM",
    media: { type: "video", src: "/videos/baamimsg.webm", poster: "/images/baamthumb.webp" },
  },
  {
    id: "first-hackathon",
    kind: "photo",
    t: 0.9,
    top: "87%",
    side: "left",
    label: "First hackathon",
    sublabel: "Where it started",
    media: { type: "image", src: "/images/gallery/firsthackathon.jpg" },
  },
];

// How far ahead of a waypoint's own t its card starts fading/scaling in.
const REVEAL_LEAD = 0.09;

function WaypointCard({ waypoint, scrollYProgress }) {
  const opacity = useTransform(
    scrollYProgress,
    [waypoint.t - REVEAL_LEAD, waypoint.t],
    [0, 1]
  );
  const scale = useTransform(
    scrollYProgress,
    [waypoint.t - REVEAL_LEAD, waypoint.t],
    [0.86, 1]
  );
  const translateY = useTransform(
    scrollYProgress,
    [waypoint.t - REVEAL_LEAD, waypoint.t],
    [18, 0]
  );

  const Wrapper = waypoint.href ? "a" : "div";
  const wrapperProps = waypoint.href
    ? { href: waypoint.href, target: "_blank", rel: "noopener noreferrer" }
    : {};

  return (
    <motion.div
      className={`hero-route-node hero-route-node--${waypoint.side}`}
      style={{ top: waypoint.top, opacity, scale, translateY, pointerEvents: "auto" }}
    >
      <span className="hero-route-node-dot" aria-hidden="true" />
      <Wrapper className="hero-route-card" {...wrapperProps}>
        <div className="hero-route-card-media">
          {waypoint.media.type === "video" ? (
            <video
              src={waypoint.media.src}
              poster={waypoint.media.poster}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : (
            <img src={waypoint.media.src} alt="" loading="lazy" />
          )}
        </div>
        <div className="hero-route-card-meta">
          <p className="hero-route-card-label">{waypoint.label}</p>
          <p className="hero-route-card-sublabel">{waypoint.sublabel}</p>
        </div>
      </Wrapper>
    </motion.div>
  );
}

export default function HeroRoute() {
  const pathRef = useRef(null);
  const progressRef = useRef(0);
  const [pathLength, setPathLength] = useState(0);

  // #heroScrollTrack is the static wrapper already sitting in the page's
  // HTML (see index.html) by the time this mounts, so grabbing it once as
  // the initial ref value is enough -- no effect/timing dance needed.
  const trackRef = useRef(
    typeof document !== "undefined" ? document.getElementById("heroScrollTrack") : null
  );

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  useEffect(() => {
    if (pathRef.current) setPathLength(pathRef.current.getTotalLength());
  }, []);

  useEffect(() => {
    return scrollYProgress.on("change", (v) => {
      progressRef.current = v;
    });
  }, [scrollYProgress]);

  const dashOffset = useTransform(scrollYProgress, [0.02, 0.96], [pathLength, 0]);

  return (
    <div className="hero-route-inner">
      <svg
        className="hero-route-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="hero-route-sketch" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <mask id="hero-route-reveal" maskUnits="userSpaceOnUse">
            <motion.path
              ref={pathRef}
              d={PATH_D}
              fill="none"
              stroke="#ffffff"
              strokeWidth="34"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: pathLength || 1,
                strokeDashoffset: pathLength ? dashOffset : pathLength,
              }}
            />
          </mask>
        </defs>

        {/* Faint full trail, always visible -- the "whole map," under the
            crisp dashed ink line that traces over it as you scroll. */}
        <path
          d={PATH_D}
          className="hero-route-ghost"
          filter="url(#hero-route-sketch)"
        />
        <path
          d={PATH_D}
          className="hero-route-ink"
          filter="url(#hero-route-sketch)"
          mask="url(#hero-route-reveal)"
        />
      </svg>

      <PaperAirplaneLayer progressRef={progressRef} pathRef={pathRef} viewW={VIEW_W} viewH={VIEW_H} />

      {WAYPOINTS.map((wp) => (
        <WaypointCard key={wp.id} waypoint={wp} scrollYProgress={scrollYProgress} />
      ))}
    </div>
  );
}
