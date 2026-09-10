// Deliberately dependency-free and tiny: this lives in the entry chunk so
// footer-main.jsx can start downloading the character before FooterScene's
// ~933KB chunk (and therefore three.js, and therefore GLTFLoader) exists.
//
// models.jsx then *consumes these same bytes* rather than issuing its own
// request. Handing the ArrayBuffer over directly — instead of warming the HTTP
// cache and hoping the second request hits it — is what makes the head start
// deterministic: it does not depend on Cache-Control, the preload cache, or
// crossorigin attributes matching between the two requests.
//
// Idempotent: whoever calls first starts the fetch, everyone else awaits it.

let pending = null;

export function preloadModel(url) {
  if (!pending) {
    pending = fetch(url, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
        return res.arrayBuffer();
      })
      .catch((err) => {
        // Don't let one failed request memoize a rejection for the page's
        // lifetime -- the mount happens later than the preload, so clearing
        // this gives the real load a fresh attempt instead of inheriting a
        // dead promise from a transient blip during the warm-up fetch.
        pending = null;
        throw err;
      });
  }
  return pending;
}
