// Control bar for the local koi demo pages (koi-demo.html, blossom-demo.html).
// Buttons: data-k flips a pond option, data-x flips an add-on from
// pond-extras.js. The page lists which add-ons start on in <body data-extras>.
import { minnows, lilyPads, petals } from "./pond-extras.js";

const hero = document.querySelector(".hero");
const pond = hero.koiPond;
const bar = document.getElementById("controls");

// add-ons
const startOn = (document.body.dataset.extras || "").split(/\s+/);
const extras = {
  school: pond.use((api) => minnows(api)),
  lilies: pond.use((api) => lilyPads(api)),
  petals: pond.use((api) => petals(api)),
};
for (const [name, x] of Object.entries(extras)) x.on = startOn.includes(name);
for (const b of bar.querySelectorAll("button[data-x]")) {
  const x = extras[b.dataset.x];
  const paint = () => b.classList.toggle("on", x.on);
  b.addEventListener("click", () => { x.on = !x.on; paint(); });
  paint();
}
// petal amount: light / medium / heavy
const RATES = [["petals: light", 1], ["petals: medium", 2.4], ["petals: heavy", 5]];
const rateBtn = document.getElementById("petal-rate");
if (rateBtn) {
  let ri = Number(document.body.dataset.petalRate ?? 1);
  const paintRate = () => { rateBtn.textContent = RATES[ri][0]; extras.petals.rate = RATES[ri][1]; };
  rateBtn.addEventListener("click", () => { ri = (ri + 1) % RATES.length; paintRate(); });
  paintRate();
}

for (const b of bar.querySelectorAll("button[data-k]")) {
  const k = b.dataset.k;
  const cycle = b.dataset.cycle?.split(",").map(Number);
  const labels = b.dataset.labels?.split(",");
  const paint = () => {
    if (cycle) {
      const i = Math.max(0, cycle.indexOf(pond.opt[k]));
      b.textContent = labels[i];
      b.classList.toggle("on", i !== 0);
    } else b.classList.toggle("on", !!pond.opt[k]);
  };
  b.addEventListener("click", () => {
    if (cycle) {
      const i = cycle.indexOf(pond.opt[k]);
      pond.set(k, cycle[(i + 1) % cycle.length]);
    } else pond.set(k, !pond.opt[k]);
    paint();
  });
  paint();
}

// light, warm backgrounds to try instead of plain white (the first is the
// homepage's current colour)
const BGS = [
  ["white", null],
  ["cream", "#f6f1e6"],
  ["rice paper", "#efe7d6"],
  ["sand", "#e8dcc4"],
  ["sage", "#e4e9dd"],
  ["mist", "#e3eaee"],
];
const bgBtn = document.getElementById("bg");
let bgI = 1; // start on cream
const paintBg = () => {
  const [name, color] = BGS[bgI];
  if (color) document.body.style.setProperty("--bg-color", color);
  else document.body.style.removeProperty("--bg-color");
  bgBtn.textContent = "bg: " + name;
  bgBtn.classList.toggle("on", bgI !== 0);
};
bgBtn.addEventListener("click", () => {
  bgI = (bgI + 1) % BGS.length;
  document.body.classList.remove("dark-mode"); paintDark();
  paintBg();
});

const dark = document.getElementById("dark");
const paintDark = () => dark.classList.toggle("on", document.body.classList.contains("dark-mode"));
dark.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  if (document.body.classList.contains("dark-mode")) document.body.style.removeProperty("--bg-color");
  else paintBg();
  paintDark();
});
if (document.body.classList.contains("dark-mode")) bgI = 0;
paintBg();
paintDark();

// a handful near the middle, nudged so repeated presses land in new spots
document.getElementById("feed").addEventListener("click", () => {
  pond.feed(innerWidth * (0.35 + Math.random() * 0.3), innerHeight * (0.3 + Math.random() * 0.35));
});

addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") bar.classList.toggle("hidden");
});
