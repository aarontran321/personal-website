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
// UI AUDIO ENGINE (Smart Tab Navigation Fix)
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  // The source click.wav was 1.15s of stereo PCM (200KB) for a UI blip;
  // click.mp3 is the same sound at 14KB. Still held until the page has
  // finished loading so it never competes with the first paint.
  const clickSound = new Audio();
  clickSound.preload = 'none';
  clickSound.volume = 0.4;

  const warmAudio = () => {
    if (clickSound.src) return;
    clickSound.src = 'click.mp3';
    clickSound.preload = 'auto';
    clickSound.load();
  };
  if (document.readyState === 'complete') warmAudio();
  else window.addEventListener('load', warmAudio, { once: true });
  // whichever comes first: page fully loaded, or the user reaching for something
  window.addEventListener('pointerdown', warmAudio, { once: true });

  const interactiveElements = document.querySelectorAll('a, button, .card, .food-card');

  interactiveElements.forEach(element => {
    element.addEventListener('click', (e) => {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {/* Audio engine catch */});

      if (element.classList.contains('site-nav-link')) return; // nav dot animation handles its own navigation timing

      const href = element.getAttribute('href');
      const target = element.getAttribute('target');

      if (target === '_blank') return; 

      if (href && !href.startsWith('#') && href !== '#') {
        e.preventDefault();
        setTimeout(() => {
          window.location.href = href;
        }, 60);
      }
    });
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
