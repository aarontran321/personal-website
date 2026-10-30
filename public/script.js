// ==========================================================
// HERO SHARKS — two or three small overhead sharks in the
// open area to the right of the intro. They cruise left and
// right on a slow glide. Each one is drawn with its own mix
// of characters, in a muted gray-blue.
//
// The swim area matches the open blob beside the copy. A
// narrow window or a phone has no room for it, and the canvas
// goes idle instead of covering the text.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('heroSharks');
  const hero = canvas && canvas.closest('.hero');
  if (!canvas || !hero) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  // Normalized to the hero. Traced from the open region on the
  // right: a cap near the top corner, a wide middle, and a
  // rounded bottom that stops above the scroll hint.
  const REGION = [
    [0.90, 0.17],
    [0.84, 0.21],
    [0.74, 0.26],
    [0.64, 0.33],
    [0.58, 0.42],
    [0.555, 0.55],
    [0.54, 0.68],
    [0.51, 0.78],
    [0.495, 0.84],
    [0.53, 0.895],
    [0.66, 0.91],
    [0.82, 0.90],
    [0.91, 0.85],
    [0.945, 0.70],
    [0.95, 0.48],
    [0.945, 0.32],
    [0.92, 0.22],
  ];

  const MIRROR = {
    '<': '>', '>': '<',
    '(': ')', ')': '(',
    '/': '\\', '\\': '/',
    '{': '}', '}': '{',
  };

  // Each profile is (left pad, body length, snout). The short rows
  // sit at the rear, so the tail is on the left and the point is
  // the snout on the right. A palette fills the body so neighboring
  // cells are different characters.
  function carve(profile, palette) {
    return profile.map(([pad, n, snout], y) => {
      let line = '';
      for (let x = 0; x < pad + n; x++) {
        line += x < pad ? ' ' : palette[(x * 3 + y * 5) % palette.length];
      }
      return snout ? line + '>' : line;
    });
  }

  const KINDS = [
    {
      lines: carve([
        [0, 2, false],
        [1, 6, false],
        [3, 12, false],
        [4, 18, false],
        [5, 22, true],
        [4, 18, false],
        [3, 12, false],
        [1, 6, false],
        [0, 2, false],
      ], '#%@&=+*'),
      color: '#6d8498',
      dark: '#b7c4d1',
      size: 12,
      speed: 20,
      lane: 0.24,
      freq: 0.58,
      amp: 11,
      phase: 0.4,
      nx: 0.72,
      dir: 1,
    },
    {
      lines: carve([
        [0, 3, false],
        [2, 7, false],
        [3, 13, false],
        [2, 19, false],
        [4, 21, true],
        [2, 19, false],
        [3, 13, false],
        [2, 7, false],
        [0, 3, false],
      ], 'XH8#%@*o'),
      color: '#7a90a4',
      dark: '#c3ced8',
      size: 11,
      speed: 15,
      lane: 0.46,
      freq: 0.46,
      amp: 14,
      phase: 2.2,
      nx: 0.82,
      dir: -1,
    },
    {
      lines: carve([
        [0, 2, false],
        [1, 5, false],
        [2, 10, false],
        [3, 15, true],
        [2, 10, false],
        [1, 5, false],
        [0, 2, false],
      ], '@#*+=%&'),
      color: '#61798d',
      dark: '#aebccc',
      size: 11,
      speed: 24,
      lane: 0.68,
      freq: 0.7,
      amp: 9,
      phase: 4.1,
      nx: 0.76,
      dir: 1,
    },
  ];

  const sharks = KINDS.map((kind) => ({
    ...kind,
    vx: kind.dir * kind.speed,
    facing: kind.dir,
    y: 0,
    halfW: 0,
    halfH: 0,
    placed: false,
  }));

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  let onScreen = true;
  let running = false;
  let rafId = 0;
  let lastTs = 0;
  let dpr = 1;
  let heroW = 0;
  let heroH = 0;
  let active = false;
  let obstacles = [];

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function mirrorLine(line) {
    return [...line].reverse().map((ch) => MIRROR[ch] || ch).join('');
  }

  function inside(nx, ny) {
    let hits = false;
    for (let i = 0, j = REGION.length - 1; i < REGION.length; j = i++) {
      const [xi, yi] = REGION[i];
      const [xj, yj] = REGION[j];
      if ((yi > ny) !== (yj > ny) && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi) {
        hits = !hits;
      }
    }
    return hits;
  }

  function spanAt(nx) {
    const ys = [];
    for (let i = 0, j = REGION.length - 1; i < REGION.length; j = i++) {
      const [xi, yi] = REGION[i];
      const [xj, yj] = REGION[j];
      if ((xi <= nx && xj > nx) || (xj <= nx && xi > nx)) {
        const t = (nx - xi) / (xj - xi);
        ys.push(yi + t * (yj - yi));
      }
    }
    if (ys.length < 2) return null;
    ys.sort((a, b) => a - b);
    return { top: ys[0], bottom: ys[ys.length - 1] };
  }

  function measureSharks() {
    sharks.forEach((shark) => {
      ctx.font = `${shark.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      let max = 0;
      shark.lines.forEach((line) => {
        max = Math.max(max, ctx.measureText(line).width);
      });
      shark.halfW = max / 2;
      shark.lineH = shark.size + 2;
      shark.halfH = (shark.lines.length * shark.lineH) / 2;
    });
  }

  function readObstacles() {
    const origin = hero.getBoundingClientRect();
    const pad = 18;
    obstacles = [];
    hero.querySelectorAll('.hero-title, .hero-meta, .scroll-indicator').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      obstacles.push({
        l: r.left - origin.left - pad,
        r: r.right - origin.left + pad,
        t: r.top - origin.top - pad,
        b: r.bottom - origin.top + pad,
      });
    });
  }

  function bodyRect(shark, x, y) {
    return {
      l: x - shark.halfW - 4,
      r: x + shark.halfW + 4,
      t: y - shark.halfH - 2,
      b: y + shark.halfH + 2,
    };
  }

  function hitsObstacle(rect) {
    return obstacles.some((obs) => rect.l < obs.r && rect.r > obs.l && rect.t < obs.b && rect.b > obs.t);
  }

  function rectInside(rect) {
    const pts = [
      [rect.l, rect.t],
      [rect.r, rect.t],
      [rect.l, rect.b],
      [rect.r, rect.b],
    ];
    return pts.every(([x, y]) => inside(x / heroW, y / heroH));
  }

  function placeY(shark, nx, t) {
    const span = spanAt(nx);
    if (!span) return null;
    const top = span.top * heroH + shark.halfH + 8;
    const bot = span.bottom * heroH - shark.halfH - 8;
    if (bot - top < 10) return null;
    const drift = Math.sin(t * 0.17 + shark.phase) * 0.05;
    const lane = clamp(shark.lane + drift, 0.16, 0.84);
    const bob = reduced ? 0 : Math.sin(t * shark.freq + shark.phase) * Math.min(shark.amp, (bot - top) * 0.2);
    return clamp(top + (bot - top) * lane + bob, top, bot);
  }

  function canBe(shark, nx, t) {
    if (nx <= 0 || nx >= 1 || heroW < 2 || heroH < 2) return null;
    const y = placeY(shark, nx, t);
    if (y == null) return null;
    const rect = bodyRect(shark, nx * heroW, y);
    if (!rectInside(rect) || hitsObstacle(rect)) return null;
    return y;
  }

  function park(shark, t) {
    const start = shark.nx;
    for (let i = 0; i <= 36; i++) {
      const nx = clamp(start + (i / 36) * 0.34, 0.5, 0.94);
      const y = canBe(shark, nx, t);
      if (y != null) {
        shark.nx = nx;
        shark.y = y;
        shark.placed = true;
        return;
      }
      const nx2 = clamp(start - (i / 36) * 0.34, 0.5, 0.94);
      const y2 = canBe(shark, nx2, t);
      if (y2 != null) {
        shark.nx = nx2;
        shark.y = y2;
        shark.placed = true;
        return;
      }
    }
    shark.placed = false;
  }

  function resizeCanvas() {
    const width = hero.clientWidth;
    const height = hero.clientHeight;
    const next = Math.min(window.devicePixelRatio || 1, 2);
    if (width === heroW && height === heroH && next === dpr && canvas.width > 1) return;
    heroW = width;
    heroH = height;
    dpr = next;
    canvas.width = Math.max(1, Math.round(width * next));
    canvas.height = Math.max(1, Math.round(height * next));
    ctx.setTransform(next, 0, 0, next, 0, 0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, heroW, heroH);
    const dark = document.body.classList.contains('dark-mode');
    sharks.forEach((shark) => {
      if (!shark.placed) return;
      const lines = shark.facing < 0 ? shark.lines.map(mirrorLine) : shark.lines;
      ctx.font = `${shark.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillStyle = dark ? shark.dark : shark.color;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const originX = shark.nx * heroW - shark.halfW;
      const originY = shark.y - shark.halfH;
      lines.forEach((line, i) => {
        const wave = reduced ? 0 : Math.sin(t * 2.1 + shark.phase + i * 0.72) * 1.15;
        ctx.fillText(line, originX + wave, originY + i * shark.lineH);
      });
    });
  }

  function step(dt, t) {
    sharks.forEach((shark) => {
      if (!shark.placed) return;
      const reach = Math.max(12, shark.halfW * 0.55) / heroW;
      const look = shark.nx + shark.dir * reach;
      if (canBe(shark, look, t) == null && canBe(shark, shark.nx - shark.dir * reach, t) != null) {
        shark.dir *= -1;
      }
      shark.vx += (shark.dir * shark.speed - shark.vx) * (1 - Math.exp(-1.05 * dt));
      const nx = shark.nx + (shark.vx * dt) / heroW;
      const y = canBe(shark, nx, t);
      if (y != null) {
        shark.nx = nx;
        shark.y = y;
      } else {
        const hold = canBe(shark, shark.nx, t);
        if (hold != null) shark.y = hold;
        shark.vx *= 0.5;
      }
      if (shark.vx < -5) shark.facing = -1;
      else if (shark.vx > 5) shark.facing = 1;
    });
  }

  function stop() {
    running = false;
    lastTs = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(ts) {
    rafId = 0;
    if (!running) return;
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    if (active && !reduced) {
      const t = ts / 1000;
      step(dt, t);
      draw(t);
    }
    if (running) rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced || document.hidden || !onScreen || !active) return;
    running = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  let layoutQueued = false;
  function layout() {
    const t = performance.now() / 1000;
    readObstacles();
    const width = hero.clientWidth;
    const height = hero.clientHeight;
    if (width < 2 || height < 2) {
      active = false;
    } else {
      resizeCanvas();
      measureSharks();
      sharks.forEach((shark) => {
        park(shark, t);
        if (!shark.placed) return;
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i <= 28; i++) {
          const nx = 0.46 + (0.5 * i) / 28;
          if (canBe(shark, nx, t) != null) {
            const x = nx * heroW;
            if (x < min) min = x;
            if (x > max) max = x;
          }
        }
        const room = max > min ? max - min : 0;
        if (room < shark.halfW + 72) shark.placed = false;
      });
      active = sharks.filter((shark) => shark.placed).length >= 2;
    }
    if (!active) {
      canvas.classList.add('is-idle');
      sharks.forEach((shark) => { shark.placed = false; });
      if (canvas.width !== 1 || canvas.height !== 1) {
        canvas.width = 1;
        canvas.height = 1;
      }
      heroW = 0;
      heroH = 0;
      stop();
      return;
    }
    canvas.classList.remove('is-idle');
    if (reduced) {
      stop();
      draw(t);
      return;
    }
    start();
  }

  function requestLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layout();
    });
  }

  const ro = new ResizeObserver(requestLayout);
  ro.observe(hero);
  hero.querySelectorAll('.hero-title, .hero-meta').forEach((el) => ro.observe(el));

  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    if (onScreen) start();
    else stop();
  }, { threshold: 0 });
  io.observe(hero);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else requestLayout();
  });

  if (typeof reducedQuery.addEventListener === 'function') {
    reducedQuery.addEventListener('change', () => {
      reduced = reducedQuery.matches;
      requestLayout();
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(requestLayout).catch(() => {});
  }

  const viewport = window.visualViewport;
  if (viewport) viewport.addEventListener('resize', requestLayout, { passive: true });

  requestLayout();
});

// Run scripts safely after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash) {
    window.scrollTo(0, 0);
  }
});

// ==========================================================
// NAV DOT — slides to the tab you're navigating to before
// the page actually changes
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('siteNav');
  const dot = document.getElementById('navDot');
  if (!nav || !dot) return;

  const links = Array.from(nav.querySelectorAll('.site-nav-link'));

  function placeDotAt(link, animate) {
    if (!link) return;
    if (!animate) {
      dot.style.transition = 'none';
    }
    dot.style.left = `${link.offsetLeft}px`;
    if (!animate) {
      void dot.offsetWidth; // force reflow before restoring the transition
      dot.style.transition = '';
    }
  }

  placeDotAt(nav.querySelector('.site-nav-link.active'), false);

  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      if (link.classList.contains('active')) return;
      e.preventDefault();
      placeDotAt(link, true);
      setTimeout(() => {
        window.location.href = link.href;
      }, 170);
    });
  });

  window.addEventListener('resize', () => {
    placeDotAt(nav.querySelector('.site-nav-link.active'), false);
  });
});

// ==========================================================
// FOOTER-STYLE EMAIL BUTTON — COPY TO CLIPBOARD (+ cursor tooltip)
// Same widget appears in the site footer and, on the about page, a
// second time at the bottom of the hero text — both share this class
// and the one floating tooltip.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const copyBtns = document.querySelectorAll('.footer-email-btn[data-email]');
  if (!copyBtns.length) return;

  let resetTimeout;

  // Tooltip element is created once and reused — it lives on <body> so it
  // can be positioned with `position: fixed` relative to the viewport.
  const tooltip = document.createElement('div');
  tooltip.className = 'cursor-tooltip';
  tooltip.textContent = 'Copy email';
  document.body.appendChild(tooltip);

  function moveTooltipTo(x, y) {
    tooltip.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
  }

  copyBtns.forEach((copyBtn) => {
    copyBtn.addEventListener('mouseenter', (e) => {
      tooltip.classList.remove('copied');
      tooltip.textContent = 'Copy email';
      moveTooltipTo(e.clientX, e.clientY);
      tooltip.classList.add('active');
    });

    copyBtn.addEventListener('mousemove', (e) => {
      moveTooltipTo(e.clientX, e.clientY);
    });

    copyBtn.addEventListener('mouseleave', () => {
      tooltip.classList.remove('active');
    });

    copyBtn.addEventListener('click', () => {
      // The button itself never changes — only the floating tooltip reflects
      // the copied state. Updated immediately rather than waiting on the
      // clipboard promise, since that promise can fail to resolve (e.g. an
      // insecure context) and would otherwise leave the tooltip stuck.
      clearTimeout(resetTimeout);
      tooltip.textContent = 'Copied!';
      tooltip.classList.add('copied');

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(copyBtn.dataset.email).catch(() => {});
      }

      resetTimeout = setTimeout(() => {
        tooltip.textContent = 'Copy email';
        tooltip.classList.remove('copied');
      }, 2000);
    });
  });
});

// ==========================================================
// ABOUT PAGE — rotating "outside of..." activity phrase
// The lead-in text is followed by a hard line break, and this phrase
// always renders on that second line — never inline with the lead-in —
// so the cross-fade every 2.5s doesn't reflow the paragraph.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const rotator = document.getElementById('aboutRotator');
  if (!rotator) return;

  const phrases = [
    'playing volleyball with friends.',
    'fishing in unique places.',
    'exploring new coffee shops around the city.',
    'tinkering with side projects and exploring new tech stacks.',
  ];
  let index = 0;

  setInterval(() => {
    rotator.classList.add('is-fading');
    setTimeout(() => {
      index = (index + 1) % phrases.length;
      rotator.textContent = phrases[index];
      rotator.classList.remove('is-fading');
    }, 250);
  }, 2500);
});

// ==========================================================
// SLIDING IMAGE PREVIEW (trails the cursor with a slight delay)
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const hoverCard = document.getElementById('universal-hover-card');
  const hoverImg = document.getElementById('universal-hover-img');
  const previewLinks = document.querySelectorAll('.preview-trigger');

  if (!hoverCard || !hoverImg || previewLinks.length === 0) return;

  const followSpeed = 0.12; // lower = more lag behind the cursor
  let targetX = 0;
  let currentX = 0;
  let rafId = null;
  let closeTimeout;

  function followCursor() {
    currentX += (targetX - currentX) * followSpeed;
    hoverCard.style.left = `${currentX}px`;
    rafId = requestAnimationFrame(followCursor);
  }

  previewLinks.forEach(link => {
    link.addEventListener('mouseenter', () => {
      clearTimeout(closeTimeout);
      const imageSrc = link.getAttribute('data-preview');
      if (!imageSrc) return;

      hoverImg.setAttribute('src', imageSrc);
      link.appendChild(hoverCard);

      const rect = link.getBoundingClientRect();
      currentX = rect.width / 2;
      targetX = currentX;
      hoverCard.style.left = `${currentX}px`;

      hoverCard.classList.add('active');
      if (rafId === null) rafId = requestAnimationFrame(followCursor);
    });

    link.addEventListener('mousemove', (e) => {
      const rect = link.getBoundingClientRect();
      targetX = e.clientX - rect.left;
    });

    link.addEventListener('mouseleave', () => {
      closeTimeout = setTimeout(() => {
        hoverCard.classList.remove('active');
        cancelAnimationFrame(rafId);
        rafId = null;
      }, 100);
    });
  });

  hoverCard.addEventListener('mouseenter', () => {
    clearTimeout(closeTimeout);
  });

  hoverCard.addEventListener('mouseleave', () => {
    hoverCard.classList.remove('active');
    cancelAnimationFrame(rafId);
    rafId = null;
  });
});


// ==========================================================
// PAGE PREFETCH — these are separate .html documents, so every
// nav is a full load. Warm the destination the moment a link is
// hovered (desktop) or first touched (mobile): that's typically
// 100-300ms of head start before the click even resolves, and on
// touch it overlaps the tap's own delay, so the next page is
// usually already in cache by the time we navigate.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const conn = navigator.connection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;

  const prefetched = new Set();

  function prefetch(link) {
    const url = link.href;
    if (!url || prefetched.has(url)) return;
    if (link.target === '_blank' || link.origin !== window.location.origin) return;
    if (url.split('#')[0] === window.location.href.split('#')[0]) return;
    prefetched.add(url);
    const tag = document.createElement('link');
    tag.rel = 'prefetch';
    tag.as = 'document';
    tag.href = url;
    document.head.appendChild(tag);
  }

  const links = document.querySelectorAll('a[href]');
  links.forEach((link) => {
    link.addEventListener('pointerenter', () => prefetch(link));
    link.addEventListener('touchstart', () => prefetch(link), { passive: true });
  });
});

// ==========================================================
// INFINITE FOOD GALLERY SLIDER ENGINE
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('sliderTrack');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  if (!track || !prevBtn || !nextBtn) return; 

  const originalCards = Array.from(track.children);
  const totalOriginals = originalCards.length;
  if (totalOriginals === 0) return;

  originalCards.forEach(card => {
    const cloneLast = card.cloneNode(true);
    const cloneFirst = card.cloneNode(true);
    track.appendChild(cloneLast);
    track.insertBefore(cloneFirst, track.firstChild);
  });

  let currentIndex = totalOriginals;
  const gap = 24;

  function getCardWidth() {
    return track.children[0].getBoundingClientRect().width;
  }

  function positionSlider(smooth = true) {
    if (smooth) {
      track.classList.add('smooth-transition');
    } else {
      track.classList.remove('smooth-transition');
    }
    
    const cardWidth = getCardWidth();
    const moveAmount = currentIndex * (cardWidth + gap);
    track.style.transform = `translateX(-${moveAmount}px)`;
  }

  setTimeout(() => {
    positionSlider(false);
  }, 50);

  nextBtn.addEventListener('click', () => {
    currentIndex++;
    positionSlider(true);

    if (currentIndex >= totalOriginals * 2) {
      setTimeout(() => {
        currentIndex = totalOriginals;
        positionSlider(false);
      }, 400); 
    }
  });

  prevBtn.addEventListener('click', () => {
    currentIndex--;
    positionSlider(true);

    if (currentIndex < totalOriginals) {
      setTimeout(() => {
        currentIndex = (totalOriginals * 2) - 1;
        positionSlider(false);
      }, 400);
    }
  });

  window.addEventListener('resize', () => {
    currentIndex = totalOriginals;
    positionSlider(false);
  });
});

// ==========================================================
// PROJECT VIDEO AUTOPLAY (Intersection Observer)
// Videos only play while their card is actually on screen —
// they pause the instant they scroll out of frame so we're not
// burning CPU/memory on offscreen decode work.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const videos = Array.from(document.querySelectorAll('.thumb-video'));
  if (videos.length === 0) return;

  // Every clip is a couple of MB, so on a metered or slow connection the
  // static .webp poster underneath is the whole experience — never fetch.
  const conn = navigator.connection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;

  if (!('IntersectionObserver' in window)) {
    // no IO support: just play everything, no scroll-based gating
    videos.forEach(video => {
      if (!video.src && video.dataset.src) video.src = video.dataset.src;
      video.play().catch(() => {});
      video.classList.add('playing');
    });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const video = entry.target;
      if (entry.isIntersecting) {
        // lazily attach the source the first time it comes into view
        if (!video.src && video.dataset.src) {
          video.src = video.dataset.src;
        }
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.then(() => video.classList.add('playing')).catch(() => {});
        } else {
          video.classList.add('playing');
        }
      } else {
        video.pause();
        video.classList.remove('playing');
      }
    });
  }, { threshold: 0.25 });

  videos.forEach(video => observer.observe(video));
});

// ==========================================================
// PROJECT VIDEO SEQUENCE PLAYER (Laser Tag Now!)
// Some cards hold multiple clips that should play back to back
// (first clip first) instead of looping a single one. Clips
// stack in the same box and cross-fade via the .is-active class
// as each one ends; the whole sequence only plays while its
// card is on screen, same gating as the single-clip autoplay.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const sequences = Array.from(document.querySelectorAll('[data-sequence]'));
  if (sequences.length === 0) return;

  const conn = navigator.connection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) return;

  sequences.forEach(container => {
    const clips = Array.from(container.querySelectorAll('.seq-video'));
    if (clips.length === 0) return;

    let index = clips.findIndex(clip => clip.classList.contains('is-active'));
    if (index < 0) index = 0;
    let inView = false;

    // `reset` starts the clip over (used when the sequence advances);
    // omit it to just resume the current clip in place. Without this
    // split, a stray IntersectionObserver re-fire while already in view
    // (e.g. from a layout shift elsewhere on the page) would rewind the
    // active clip to 0 every time, and it would never reach 'ended' —
    // so the sequence looked stuck on the first clip forever.
    function activateClip(i, reset) {
      index = i;
      clips.forEach((clip, ci) => clip.classList.toggle('is-active', ci === i));
      const clip = clips[i];
      if (!clip.src && clip.dataset.src) clip.src = clip.dataset.src;
      if (reset) clip.currentTime = 0;
      clip.play().catch(() => {});
    }

    function pauseAll() {
      clips.forEach(clip => clip.pause());
    }

    clips.forEach(clip => {
      clip.addEventListener('ended', () => {
        activateClip((index + 1) % clips.length, true);
      });
    });

    if (!('IntersectionObserver' in window)) {
      activateClip(index, true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (!inView) {
            inView = true;
            activateClip(index, false);
          }
        } else {
          inView = false;
          pauseAll();
        }
      });
    }, { threshold: 0.25 });

    observer.observe(container);
  });
});

// ==========================================================
// PROJECTS "THINKING" TICKER — typewriter effect
// types each status phrase out, holds, deletes it, then moves
// on to the next phrase in the cycle
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const ticker = document.getElementById('projectsTicker');
  if (!ticker) return;

  const words = [
    "building...",
    "Frolicking...",
    "prototyping...",
    "Flibbertigibbeting...",
    "refactoring...",
    "exploring...",
    "optimizing...",
    "architecting...",
  ];

  const TYPE_SPEED = 55;
  const HOLD_DURATION = 2400;

  let wordIndex = 0;
  let charIndex = 0;

  // Lock the ticker to a fixed width covering the longest phrase so
  // typing/clearing never resizes the box — an unstable width here
  // forces a reflow of everything below it (the project grid), and
  // that reflow was jittering the autoplay videos' IntersectionObserver
  // entries across their visibility threshold, causing them to flicker.
  function lockTickerWidth() {
    const probe = document.createElement('span');
    probe.className = 'status-ticker';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.width = 'auto';
    probe.style.minWidth = '0';
    document.body.appendChild(probe);

    let maxWidth = 0;
    words.forEach(word => {
      probe.textContent = word;
      maxWidth = Math.max(maxWidth, probe.getBoundingClientRect().width);
    });

    document.body.removeChild(probe);
    ticker.style.width = `${Math.ceil(maxWidth)}px`;
  }

  lockTickerWidth();

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(lockTickerWidth, 200);
  });

  function tick() {
    const currentWord = words[wordIndex];

    if (charIndex <= currentWord.length) {
      // typing forward
      ticker.textContent = currentWord.slice(0, charIndex);
      charIndex++;
      setTimeout(tick, TYPE_SPEED);
    } else {
      // finished typing — hold, then snap straight to empty and
      // start typing the next phrase (no backspacing animation)
      setTimeout(() => {
        ticker.textContent = '';
        wordIndex = (wordIndex + 1) % words.length;
        charIndex = 0;
        tick();
      }, HOLD_DURATION);
    }
  }

  tick();
});

// ==========================================================
// PROJECT CARD CLICK-THROUGH
// Clicking anywhere on a project card opens its Live Demo link if
// it has one, else its GitHub link, else nothing. Only cards with
// a destination get the pointer cursor / hover overlay treatment.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.bento-card').forEach((card) => {
    const demoLink = card.querySelector('a[aria-label="Live Demo"]');
    const githubLink = card.querySelector('a[aria-label="GitHub"]');
    const target = demoLink || githubLink;
    if (!target) return;

    card.classList.add('bento-card--clickable');
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // the card's own links keep their own destinations
      window.open(target.href, '_blank', 'noopener');
    });
  });
});
