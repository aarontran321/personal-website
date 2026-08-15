// React island entry: mounts the 3D footer scene into the existing static
// .site-footer. Everything (React, three.js, the ~12MB of .glb models) is
// loaded lazily via dynamic import the first time the footer gets within
// 600px of the viewport, so it costs nothing on initial page load -- and
// on touch/small/metered clients it is never loaded at all (see below).

const footer = document.querySelector(".site-footer");

// The character exists to chase a cursor. A touch device has none, so the
// scene idles in place while still costing react + three.js + a 4.7MB .glb
// and a live WebGL loop -- on every page, since these are separate
// documents. Skip it there (and on metered connections) entirely.
//
// `pointer: coarse` alone isn't reliable for this: iPads report `pointer:
// fine` (trackpad/Pencil support) even when only ever touched, and their
// width (768-1024px) clears the 767px cutoff too -- so both checks below
// can pass right through a tablet that's actually touch-only. That let the
// idle character sit stranded over the footer text/links with no cursor to
// react to. `ontouchstart`/maxTouchPoints catches touch capability directly,
// independent of what the pointer media features claim.
const isTouchDevice =
  "ontouchstart" in window || navigator.maxTouchPoints > 0;
const conn = navigator.connection;
const skipScene =
  isTouchDevice ||
  window.matchMedia("(pointer: coarse)").matches ||
  window.matchMedia("(max-width: 767px)").matches ||
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
