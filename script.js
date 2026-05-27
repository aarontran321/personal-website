// Toggle logic for the mobile menu
function toggleMenu() {
  const menu = document.getElementById('navMenu');
  menu.classList.toggle('open');
}

// Helper to close menu safely when clicking links on mobile without breaking desktop
function closeMenuOnMobile() {
  if (window.innerWidth < 768) {
    const menu = document.getElementById('navMenu');
    menu.classList.remove('open');
  }
}

// ==========================================================
// HACKER TEXT SCRAMBLE ENGINE (Hover Activated)
// ==========================================================
let scrambleInterval = null; // Tracks active intervals globally to prevent stacking

function scrambleText() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*";
  const targetElement = document.getElementById("heroName");
  
  if (!targetElement) return; 

  // Clear any existing scramble animation currently running
  clearInterval(scrambleInterval);

  let iteration = 0;
  const originalText = targetElement.dataset.value;

  scrambleInterval = setInterval(() => {
    targetElement.innerText = originalText
      .split("")
      .map((letter, index) => {
        if (index < iteration) {
          return originalText[index];
        }
        if (originalText[index] === " ") {
          return " ";
        }
        return letters[Math.floor(Math.random() * letters.length)];
      })
      .join("");
    
    if (iteration >= originalText.length) { 
      clearInterval(scrambleInterval);
    }
    
    iteration += 1 / 3; 
  }, 30); 
}

// Run scripts safely after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  window.scrollTo(0, 0);

  // 1. Run the scramble instantly on page load
  scrambleText();

  // 2. Add the listener to re-trigger it every time they hover!
  const heroName = document.getElementById("heroName");
  if (heroName) {
    heroName.addEventListener('mouseenter', scrambleText);
  }
});

/* ==========================================================
   HORIZONTAL TRACKING ENGINE (With Hoverable & Clickable Windows)
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const hoverCard = document.getElementById('universal-hover-card');
  const hoverImg = document.getElementById('universal-hover-img');
  const previewLinks = document.querySelectorAll('.preview-link');
  
  if (!hoverCard || !hoverImg) return;
  let closeTimeout; 

  previewLinks.forEach(link => {
    // 1. Mouse Enter Link: Mount the card and show it
    link.addEventListener('mouseenter', () => {
      clearTimeout(closeTimeout); 
      const imageSrc = link.getAttribute('data-preview');
      if (imageSrc) {
        hoverImg.setAttribute('src', imageSrc); 
        link.appendChild(hoverCard);
        hoverCard.getBoundingClientRect(); 
        hoverCard.classList.add('active');
      }
    });

    // 2. Mouse Move Over Link: Slide card on X-axis following cursor coordinates
    link.addEventListener('mousemove', (e) => {
      const rect = link.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      hoverCard.style.left = `${relativeX}px`;
      hoverCard.style.top = 'auto'; 
    });

    // 3. Mouse Leaves Link: Wait a tiny moment before hiding to let mouse cross the gap
    link.addEventListener('mouseleave', () => {
      closeTimeout = setTimeout(() => {
        hoverCard.classList.remove('active');
      }, 100); 
    });
  });

  // 4. Safety Trackers on the Floating Card itself
  hoverCard.addEventListener('mouseenter', () => {
    clearTimeout(closeTimeout); 
  });

  hoverCard.addEventListener('mouseleave', () => {
    hoverCard.classList.remove('active'); 
  });
});

// Toggle logic for Dark / Light mode themes
function toggleTheme() {
  const body = document.body;
  const themeBtn = document.getElementById('themeToggle');
  
  if (body.classList.contains('dark-mode')) {
    body.classList.remove('dark-mode');
    body.classList.add('light-mode');
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
  } else {
    body.classList.remove('light-mode');
    body.classList.add('dark-mode');
    themeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-moon">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    `;
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
      clickSound.play().catch(err => console.log("Audio waiting for user interaction"));

      const href = element.getAttribute('href');
      const target = element.getAttribute('target');

      // Smart Bypass: If opening in a new tab, do not intercept page routing
      if (target === '_blank') {
        return; 
      }

      // Handle internal site layouts with the standard audio transition buffer
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
    track.style.transform = `translateX(-${moveAmount}px) `;
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