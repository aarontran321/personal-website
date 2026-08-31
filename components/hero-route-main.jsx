// React island entry: mounts the scroll-driven paper-airplane route into the
// static #heroRoute lane (see index.html). Unlike the footer scene, this
// sits above the fold, so it mounts immediately on load rather than waiting
// for an IntersectionObserver -- there's no "off screen" state to defer to.
//
// Still skipped entirely for reduced-motion and metered/slow connections,
// same reasoning as footer-main.jsx: the payload is a live R3F canvas plus a
// scroll-linked layout (extra page height on desktop), neither of which is
// something those clients should pay for. The #hero-route lane simply stays
// empty in that case, and .hero-scroll-track's CSS collapses to no extra
// height below 1024px regardless (see style.css), so mobile is unaffected
// either way.

const mount = document.getElementById("heroRoute");

const conn = navigator.connection;
const skip =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  (conn && (conn.saveData || /2g/.test(conn.effectiveType || ""))) ||
  !window.matchMedia("(min-width: 1024px)").matches;

async function mountRoute() {
  const [{ createRoot }, { default: HeroRoute }] = await Promise.all([
    import("react-dom/client"),
    import("./HeroRoute.jsx"),
  ]);
  createRoot(mount).render(<HeroRoute />);
}

if (mount && !skip) {
  mountRoute();
}
