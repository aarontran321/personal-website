// React island entry: mounts the infinite image gallery into the
// #about-gallery-root placeholder on the About page. React + Framer Motion
// are loaded lazily via dynamic import the first time the gallery gets
// within 600px of the viewport, so they cost nothing on initial page load.

const root = document.getElementById("about-gallery-root");

async function mountGallery() {
  const [{ createRoot }, { default: InfiniteGallery }] = await Promise.all([
    import("react-dom/client"),
    import("./InfiniteGallery.jsx"),
  ]);
  createRoot(root).render(<InfiniteGallery />);
}

if (root) {
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          mountGallery();
        }
      },
      { rootMargin: "600px" }
    );
    io.observe(root);
  } else {
    mountGallery();
  }
}
