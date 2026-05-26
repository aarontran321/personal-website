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

// Typing effect variables
const textToType = "AARON TRAN";
const heroHeading = document.querySelector('.hero h1');
let charIndex = 0;
let isTypingStarted = false; // 🔒 Safety lock variable

function typeAnimation() {
  if (charIndex < textToType.length) {
    heroHeading.textContent += textToType.charAt(charIndex);
    charIndex++;
    setTimeout(typeAnimation, 90);
  }
}

// Run typing script safely after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  // FIX: Forces the browser window to stay locked at the top upon refresh
  window.scrollTo(0, 0);

  // If the lock is already true, exit immediately to stop duplicate typing loops
  if (isTypingStarted) return; 
  
  isTypingStarted = true; // Set the lock to true so a second event can't pass
  heroHeading.textContent = ''; // Ensure it's absolutely blank before starting
  typeAnimation();
});

// Scroll Reveal Animations using Intersection Observer
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('show');
      // Unobserve once animation fires so it doesn't recalculate continuously
      revealObserver.unobserve(entry.target);
    }
  });
}, { 
  threshold: 0.15,
  rootMargin: "0px 0px -50px 0px" // Triggers slightly before section enters viewport
});

document.querySelectorAll('.about, .projects, .links, footer').forEach(section => {
  section.classList.add('hidden');
  revealObserver.observe(section);
});

/* ==========================================================
   HORIZONTAL TRACKING ENGINE (With Hoverable & Clickable Windows)
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const hoverCard = document.getElementById('universal-hover-card');
  const hoverImg = document.getElementById('universal-hover-img');
  const previewLinks = document.querySelectorAll('.preview-link');
  
  let closeTimeout; // Stores our safety buffer timer

  previewLinks.forEach(link => {
// 1. Mouse Enter Link: Mount the card and show it
    link.addEventListener('mouseenter', () => {
      clearTimeout(closeTimeout); // Cancel any pending close timers
      const imageSrc = link.getAttribute('data-preview');
      if (imageSrc) {
        // Fixes image paths when appended inside nested layout structures
        hoverImg.setAttribute('src', imageSrc); 
        
        link.appendChild(hoverCard);
        hoverCard.getBoundingClientRect(); // Force layout updates
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
      }, 100); // 100ms is the perfect sweet spot for a smooth crossing transition
    });
  });

  // 4. Safety Trackers on the Floating Card itself
  hoverCard.addEventListener('mouseenter', () => {
    clearTimeout(closeTimeout); // Keep it open if mouse is actively inside the window
  });

  hoverCard.addEventListener('mouseleave', () => {
    hoverCard.classList.remove('active'); // Close it immediately when leaving the window bounds
  });
});

// Toggle logic for Dark / Light mode themes
function toggleTheme() {
  const body = document.body;
  const themeBtn = document.getElementById('themeToggle');
  
  if (body.classList.contains('dark-mode')) {
    body.classList.remove('dark-mode');
    body.classList.add('light-mode');
    // Swaps the SVG icon inside the button to a Sun shape
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
    // Swaps the SVG icon inside the button back to a Moon shape
    themeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-moon">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    `;
  }
}

// ==========================================================
// UI AUDIO ENGINE 
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize the audio object with your local file
  const clickSound = new Audio('click.wav');
  
  // 2. Pre-load the audio into memory so there is zero delay when clicking
  clickSound.preload = 'auto';

  // 3. Select every functional, clickable element on your site
  const interactiveElements = document.querySelectorAll('a, button, .card');

  // 4. Loop through each element and attach the sound logic
  interactiveElements.forEach(element => {
    element.addEventListener('click', (e) => {
      
      // SAFETY CHECK: If it's a link pointing to just "#" (empty placeholder), 
      // you can optional skip it, or let it play. Right now it plays for all active items.
      
      // Reset the sound timeline to 0 in case the user rapid-clicks
      clickSound.currentTime = 0;
      
      // Lower the volume slightly so it doesn't scare users (0.0 to 1.0)
      clickSound.volume = 0.4; 
      
      // Play the sound
      clickSound.play().catch(error => {
        // Modern browsers block audio until the user interacts with the page first.
        // This catch block prevents the console from throwing errors on page load.
        console.log("Audio playback held until user interaction.");
      });
    });
  });
});