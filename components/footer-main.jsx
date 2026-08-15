// React island entry: mounts the 3D footer scene into the existing static
// .site-footer. Everything (React, three.js, the ~12MB of .glb models) is
// loaded lazily via dynamic import the first time the footer gets within
// 600px of the viewport, so it costs nothing on initial page load -- and
// on touch/small/metered clients it is never loaded at all (see below).

const footer = document.querySelector(".site-footer");

// Touch devices have no cursor to chase, but FooterScene.jsx now also reacts
// to taps (see the pointerdown listener there) -- tap near the footer and
// the character walks to that spot, tap on the character and it casts. So
// touch/narrow viewports no longer need to skip the scene entirely; only
// keep the skip for cases where running it is a genuinely bad idea:
// reduced-motion (accessibility) and metered/slow connections (a 4.7MB .glb
// isn't worth loading there).
const conn = navigator.connection;
const skipScene =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  (conn && (conn.saveData || /2g/.test(conn.effectiveType || "")));

async function mountScene() {
  const [{ createRoot }, { default: FooterScene }] = await Promise.all([
    import("react-dom/client"),
    import("./FooterScene.jsx"),
  ]);
  const mount = document.createElement("div");
  mount.className = "footer-scene";
  footer.appendChild(mount);
  createRoot(mount).render(<FooterScene />);
}

if (footer && !skipScene) {
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          mountScene();
        }
      },
      { rootMargin: "600px" }
    );
    io.observe(footer);
  } else {
    mountScene();
  }
}
