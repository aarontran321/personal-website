// React island entry: mounts the 3D footer scene into the existing static
// .site-footer. Everything (React, three.js, the ~12MB of .glb models) is
// loaded lazily via dynamic import the first time the footer gets within
// 600px of the viewport, so it costs nothing on initial page load.

const footer = document.querySelector(".site-footer");

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

if (footer) {
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
