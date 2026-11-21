// Footer koi: a single small koi swimming in the dark footer band, using the
// same ASCII-tile koi engine as the hero pond (components/koi.js), just
// configured smaller and without feeding.
//
// - Mouse/trackpad: the koi fades in when the cursor enters the footer and
//   swims after it, then fades back out when the cursor leaves.
// - Touch screens: no cursor to follow, so the koi is always visible and just
//   swims around the footer on its own.
//
// The canvas sits under .footer-inner (z-index 1), so the text and links are
// always drawn on top of the koi and stay clickable.
//
// (The previous 3D Yasuo footer lives in FooterScene.jsx / models.jsx and is
// no longer mounted.)

import { initPond } from "./koi.js";

const footer = document.querySelector(".site-footer");

if (footer) {
  footer.dataset.koi = JSON.stringify({
    header: false, // no fixed site header to keep clear of in here
    count: 1,
    koiScale: 0.3, // ~65px long on desktop instead of ~215px in the hero
    cell: 2, // 2px tiles keep ~32 tiles per body length: small but detailed
    seams: false, // tile gaps would eat half of a 2px tile
    ascii: false, // glyphs are unreadable at 2px; the shading carries the detail
    water: false,
    feed: false,
    follow: true,
    dark: true, // the footer is always charcoal, whatever the site theme
    rippleScale: 0.7, // slightly smaller rings to suit the short footer band
    edgeBand: 18,
    fall: 24,
    textSel: ".footer-heading, .footer-subtext",
    boxSel: ".footer-nav a, .footer-email-btn",
  });
  initPond(footer);
}
