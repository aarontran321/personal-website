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
      }, 260);
    });
  });

  window.addEventListener('resize', () => {
    placeDotAt(nav.querySelector('.site-nav-link.active'), false);
  });
});

// ==========================================================
// FOOTER — COPY EMAIL TO CLIPBOARD (+ cursor tooltip)
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('footerCopyEmailBtn');
  if (!copyBtn) return;

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
// UI AUDIO ENGINE (Smart Tab Navigation Fix)
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const clickSound = new Audio('click.wav');
  clickSound.preload = 'auto';
  clickSound.volume = 0.4; 

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
        }, 120);
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

  if (!('IntersectionObserver' in window)) {
    // no IO support: just play everything, no scroll-based gating
    videos.forEach(video => {
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
