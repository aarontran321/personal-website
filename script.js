// Toggle logic for the mobile menu
function toggleMenu() {
  const menu = document.getElementById('navMenu');
  if (menu) menu.classList.toggle('open');
}

// Helper to close menu safely when clicking links on mobile without breaking desktop
function closeMenuOnMobile() {
  if (window.innerWidth < 768) {
    const menu = document.getElementById('navMenu');
    if (menu) menu.classList.remove('open');
  }
}

// Run scripts safely after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  window.scrollTo(0, 0);
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


// Toggle logic for Dark / Light mode themes
function toggleTheme() {
  const body = document.body;
  const themeBtn = document.getElementById('themeToggle');
  if (!body) return;
  
  if (body.classList.contains('dark-mode')) {
    body.classList.remove('dark-mode');
    body.classList.add('light-mode');
    if (themeBtn) {
      themeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-sun">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      `;
    }
  } else {
    body.classList.remove('light-mode');
    body.classList.add('dark-mode');
    if (themeBtn) {
      themeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-moon">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;
    }
  }
}

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
