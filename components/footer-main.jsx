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
const conn = navigator.connection;
const skipScene =
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
