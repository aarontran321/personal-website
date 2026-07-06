// Run scripts safely after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  window.scrollTo(0, 0);
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
// COPY EMAIL TO CLIPBOARD
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('copyEmailBtn');
  const tooltip = copyBtn ? copyBtn.querySelector('.copy-tooltip') : null;
  if (!copyBtn || !tooltip) return;

  const defaultText = tooltip.textContent;
  let resetTimeout;

  copyBtn.addEventListener('mousemove', (e) => {
    const rect = copyBtn.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left + 16}px`;
    tooltip.style.top = `${e.clientY - rect.top + 18}px`;
  });

  copyBtn.addEventListener('click', () => {
    const email = copyBtn.dataset.email;
    navigator.clipboard.writeText(email).then(() => {
      clearTimeout(resetTimeout);
      tooltip.textContent = 'copied!';
      resetTimeout = setTimeout(() => {
        tooltip.textContent = defaultText;
      }, 1500);
    });
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

document.querySelectorAll('.project-card').forEach(card => {
  const video = card.querySelector('.thumb-video');
  if (!video) return;

  card.addEventListener('mouseenter', () => {
    video.currentTime = 0;
    video.play();
    video.classList.add('playing');
  });

  card.addEventListener('mouseleave', () => {
    video.pause();
    video.currentTime = 0;
    video.classList.remove('playing');
  });

  video.addEventListener('ended', () => {
    video.classList.remove('playing');
    video.currentTime = 0;
  });
});

// ==========================================================
// PROJECTS "THINKING" TICKER (cycles single-word status verbs)
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

  let i = 0;
  setInterval(() => {
    ticker.classList.add('is-swapping');
    setTimeout(() => {
      i = (i + 1) % words.length;
      ticker.textContent = words[i];
      ticker.classList.remove('is-swapping');
    }, 350);
  }, 2750);
});
