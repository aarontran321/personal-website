// React island entry: mounts the 3D footer scene into the existing static
// .site-footer. Everything (React, three.js, the ~424KB .glb) is loaded lazily
// so it costs nothing on initial page load -- and on reduced-motion or
// metered/slow clients it is never loaded at all (see below).
//
// Loading happens in two scroll-gated stages, because the whole payload is
// ~1.1MB and downloading it all only once the footer is 600px away used to
// leave the character missing for several seconds:
//
//   PRELOAD_MARGIN  fetch the model AND import the chunks, in parallel
//   MOUNT_MARGIN    actually render (starts the WebGL render loop)
//
// Splitting the two is what keeps a render loop from spinning while the footer
// is still a screen and a half away.

import chibiYasuoUrl from "./chibi_yasuo.glb?url";
import { preloadModel } from "./model-preload.js";

// Far enough out that the ~2.5s of transfer is usually done before the footer
// is on screen. Only a URL string is imported above, so this file stays tiny.
const PRELOAD_MARGIN = "2500px";
const MOUNT_MARGIN = "600px";

const footer = document.querySelector(".site-footer");

// Touch devices have no cursor to chase, but FooterScene.jsx now also reacts
// to taps (see the pointerdown listener there) -- tap near the footer and
// the character walks to that spot, tap on the character and it casts. So
// touch/narrow viewports no longer need to skip the scene entirely; only
// keep the skip for cases where running it is a genuinely bad idea:
// reduced-motion (accessibility) and metered/slow connections.
const conn = navigator.connection;
const skipScene =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  (conn && (conn.saveData || /2g/.test(conn.effectiveType || "")));

let modulesPromise = null;

// The model download and the JS chunks are kicked off in the same tick. Left
// to itself the model can't even be *requested* until FooterScene's ~933KB
// chunk has finished downloading and evaluating -- models.jsx only asks for it
// at module scope -- which serialised two multi-second transfers back to back.
// models.jsx reads the very ArrayBuffer this starts (see model-preload.js).
function preloadScene() {
  if (modulesPromise) return modulesPromise;
  preloadModel(chibiYasuoUrl).catch(() => {});
  modulesPromise = Promise.all([
    import("react-dom/client"),
    import("./FooterScene.jsx"),
  ]);
  return modulesPromise;
}

async function mountScene() {
  const [{ createRoot }, { default: FooterScene }] = await preloadScene();
  const mount = document.createElement("div");
  mount.className = "footer-scene";
  footer.appendChild(mount);
  createRoot(mount).render(<FooterScene />);
}

function observeOnce(rootMargin, run) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        io.disconnect();
        run();
      }
    },
    { rootMargin }
  );
  io.observe(footer);
}

if (footer && !skipScene) {
  if ("IntersectionObserver" in window) {
    observeOnce(PRELOAD_MARGIN, preloadScene);
    observeOnce(MOUNT_MARGIN, mountScene);
  } else {
    mountScene();
  }
}
