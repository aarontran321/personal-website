// ==========================================================
// HERO FLOW — short colored dashes in the open space to the
// right of the intro. They drift on a slow current of their
// own. Moving the pointer through that space stirs a local
// wake; the field does not chase the cursor.
//
// The drawable region is measured from the text, not from a
// fixed column. Narrow the window, or open the page on a
// phone, and the region collapses — the canvas goes idle
// instead of painting over the copy or stretching the page.
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('heroFlow');
  const hero = canvas && canvas.closest('.hero');
  if (!canvas || !hero) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const contentEls = () => hero.querySelectorAll('.hero-title, .hero-meta');
  const scrollEl = hero.querySelector('.scroll-indicator');

  const COLORS = [
    [66, 133, 244],
    [234, 67, 53],
    [232, 160, 14],
    [52, 168, 83],
    [155, 81, 224],
    [255, 112, 67],
    [219, 68, 149],
  ];

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  let onScreen = true;
  let running = false;
  let rafId = 0;
  let lastTs = 0;
  let dpr = 1;
  let heroW = 0;
  let heroH = 0;
  let field = null;
  const particles = [];

  const pointer = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    inside: false,
    seen: false,
    lastMove: 0,
  };

  let scrollBox = null;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function randn() {
    const u = 1 - Math.random();
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
  }

  function kick(p) {
    if (!field) {
      p.vx = 0;
      p.vy = 0;
      return;
    }
    const x = field.x + p.nx * field.w;
    const y = field.y + p.ny * field.h;
    const flow = curl(x + p.phase * 10, y, p.phase);
    p.vx = flow.x * p.speed;
    p.vy = flow.y * p.speed;
    p.angle = Math.atan2(p.vy, p.vx);
  }

  function place(p) {
    p.nx = clamp(0.5 + randn() * 0.27, 0.05, 0.95);
    p.ny = clamp(0.48 + randn() * 0.3, 0.05, 0.95);
    if (Math.random() < 0.4) {
      p.nx = 0.06 + Math.random() * 0.88;
      p.ny = 0.06 + Math.random() * 0.88;
    }
    kick(p);
  }

  function makeParticle() {
    const p = {
      nx: 0,
      ny: 0,
      vx: 0,
      vy: 0,
      angle: Math.random() * Math.PI * 2,
      tilt: (Math.random() - 0.5) * 0.8,
      len: 2.3 + Math.random() * 3.8,
      thick: 1.35 + Math.random() * 1.2,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      alpha: 0.52 + Math.random() * 0.38,
      speed: 14 + Math.random() * 20,
      phase: Math.random() * Math.PI * 2,
    };
    place(p);
    return p;
  }

  function measure() {
    const width = hero.clientWidth;
    const height = hero.clientHeight;
    if (width < 2 || height < 2) return null;

    const heroRect = hero.getBoundingClientRect();
    let contentRight = heroRect.left;
    contentEls().forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) contentRight = Math.max(contentRight, r.right);
    });

    const x = Math.round(contentRight - heroRect.left + 44);
    const y = 78;
    const w = Math.round(width - x - 16);
    const h = Math.round(height - y - 28);
    // A few pixels of hysteresis so dragging the window across the
    // cutoff doesn't flicker the field on and off. Below this, the
    // open strip is too slim to read as its own column.
    const minW = field ? 170 : 190;
    const minH = field ? 150 : 180;
    if (w < minW || h < minH || x < 8) return null;
    return { x, y, w, h };
  }

  function resizeCanvas() {
    const width = hero.clientWidth;
    const height = hero.clientHeight;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === heroW && height === heroH && nextDpr === dpr && canvas.width > 0) return;
    heroW = width;
    heroH = height;
    dpr = nextDpr;
    canvas.width = Math.max(1, Math.round(width * nextDpr));
    canvas.height = Math.max(1, Math.round(height * nextDpr));
    ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
  }

  function syncCount() {
    const target = Math.round(Math.min(210, Math.max(42, (field.w * field.h) / 3400)));
    while (particles.length < target) particles.push(makeParticle());
    if (particles.length > target) particles.length = target;
  }

  function potential(x, y, t) {
    const s = 0.00135;
    const a = x * s;
    const b = y * s;
    return (
      Math.sin(a * 1.2 + t * 0.2) * Math.cos(b * 1.05 - t * 0.15) +
      Math.sin(a * 0.58 - b * 0.82 + t * 0.11) * 0.72 +
      Math.cos(a * 1.85 + b * 0.42 + t * 0.17) * 0.3
    );
  }

  function curl(x, y, t) {
    const e = 2.4;
    const dx = potential(x, y + e, t) - potential(x, y - e, t);
    const dy = potential(x + e, y, t) - potential(x - e, y, t);
    const mag = Math.hypot(dx, -dy) || 1;
    return { x: dx / mag, y: -dy / mag };
  }

  function cacheScrollBox() {
    scrollBox = null;
    if (!scrollEl) return;
    const heroRect = hero.getBoundingClientRect();
    const r = scrollEl.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    scrollBox = {
      cx: r.left + r.width / 2 - heroRect.left,
      cy: r.top + r.height / 2 - heroRect.top,
      rx: r.width / 2 + 28,
      ry: r.height / 2 + 22,
    };
  }

  function avoidScroll(x, y) {
    if (!scrollBox) return 1;
    const nx = (x - scrollBox.cx) / scrollBox.rx;
    const ny = (y - scrollBox.cy) / scrollBox.ry;
    const d = Math.hypot(nx, ny);
    if (d >= 1) return 1;
    return d * d;
  }

  function edgeFade(x, y) {
    const left = (x - field.x) / 56;
    const right = (field.x + field.w - x) / 26;
    const top = (y - field.y) / 36;
    const bot = (field.y + field.h - y) / 36;
    const m = Math.min(left, right, top, bot);
    return m < 0 ? 0 : m > 1 ? 1 : m;
  }

  function step(dt, t) {
    const f = field;
    const influenceR = 176;
    const influenceR2 = influenceR * influenceR;
    const decay = Math.pow(0.05, dt);
    pointer.vx *= decay;
    pointer.vy *= decay;
    const pushing = pointer.inside && (pointer.vx * pointer.vx + pointer.vy * pointer.vy) > 40;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let x = f.x + p.nx * f.w;
      let y = f.y + p.ny * f.h;
      const flow = curl(x + p.phase * 10, y, t + p.phase * 0.12);
      const settle = 1 - Math.exp(-1.55 * dt);
      p.vx += (flow.x * p.speed - p.vx) * settle;
      p.vy += (flow.y * p.speed - p.vy) * settle;

      if (pushing) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < influenceR2 && dist2 > 0.25) {
          const dist = Math.sqrt(dist2);
          const fall = (1 - dist / influenceR) ** 1.65;
          const speed = Math.min(Math.hypot(pointer.vx, pointer.vy), 900);
          p.vx += pointer.vx * 2.4 * fall * dt;
          p.vy += pointer.vy * 2.4 * fall * dt;
          const swirl = speed * 1.15 * fall * dt;
          p.vx += (-dy / dist) * swirl;
          p.vy += (dx / dist) * swirl;
        }
      }

      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 260) {
        const k = 260 / sp;
        p.vx *= k;
        p.vy *= k;
      }

      x += p.vx * dt;
      y += p.vy * dt;
      if (x < f.x) x += f.w;
      else if (x > f.x + f.w) x -= f.w;
      if (y < f.y) y += f.h;
      else if (y > f.y + f.h) y -= f.h;
      p.nx = (x - f.x) / f.w;
      p.ny = (y - f.y) / f.h;

      const desired = Math.atan2(p.vy, p.vx);
      let delta = desired - p.angle;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      p.angle += delta * Math.min(1, dt * 3.5);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, heroW, heroH);
    if (!field) return;
    const boost = document.body.classList.contains('dark-mode') ? 1.08 : 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const x = field.x + p.nx * field.w;
      const y = field.y + p.ny * field.h;
      const fade = edgeFade(x, y) * avoidScroll(x, y);
      if (fade < 0.03) continue;
      const [r, g, b] = p.color;
      const alpha = p.alpha * fade * boost;
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha > 1 ? 1 : alpha})`;
      ctx.lineWidth = p.thick;
      const ang = p.angle + p.tilt;
      const hx = Math.cos(ang) * p.len * 0.5;
      const hy = Math.sin(ang) * p.len * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - hx, y - hy);
      ctx.lineTo(x + hx, y + hy);
      ctx.stroke();
    }
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
    if (field && !reduced) {
      step(dt, ts / 1000);
      draw();
    }
    if (running) rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced || document.hidden || !onScreen || !field) return;
    running = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  let layoutQueued = false;
  function layout() {
    const next = measure();
    const had = field;
    field = next;
    if (!field) {
      canvas.classList.add('is-idle');
      particles.length = 0;
      pointer.inside = false;
      if (canvas.width !== 1 || canvas.height !== 1) {
        canvas.width = 1;
        canvas.height = 1;
      }
      heroW = 0;
      heroH = 0;
      stop();
      return;
    }
    resizeCanvas();
    canvas.classList.remove('is-idle');
    if (!had) {
      syncCount();
      particles.forEach(place);
    } else {
      syncCount();
    }
    cacheScrollBox();
    if (reduced) {
      stop();
      draw();
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
  contentEls().forEach((el) => ro.observe(el));

  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    if (onScreen) start();
    else stop();
  }, { threshold: 0 });
  io.observe(hero);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else {
      requestLayout();
      start();
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const rect = hero.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = performance.now();
    const dt = (now - pointer.lastMove) / 1000;
    pointer.lastMove = now;
    if (pointer.seen && pointer.inside && dt > 0 && dt < 0.08) {
      const ivx = (x - pointer.x) / dt;
      const ivy = (y - pointer.y) / dt;
      pointer.vx = pointer.vx * 0.35 + ivx * 0.65;
      pointer.vy = pointer.vy * 0.35 + ivy * 0.65;
    } else {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.seen = true;
    const f = field;
    pointer.inside = !!f &&
      x >= f.x - 20 && x <= f.x + f.w + 20 &&
      y >= f.y - 20 && y <= f.y + f.h + 20;
  }, { passive: true });

  window.addEventListener('blur', () => {
    pointer.inside = false;
    pointer.vx = 0;
    pointer.vy = 0;
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
