document.addEventListener('DOMContentLoaded', function() {
  // Menú original (puede ser menu1ToggleBtn o menuToggleBtn dependiendo de la página)
  var menuBtn = document.getElementById('menu1ToggleBtn') || document.getElementById('menuToggleBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  var menuOverlay = document.getElementById('menuOverlay');

  // Menú 2
  var menu2Btn = document.getElementById('menu2ToggleBtn');
  var mobileMenu2 = document.getElementById('mobileMenu2');

  // Menú 3
  var menu3Btn = document.getElementById('menu3ToggleBtn');
  var mobileMenu3 = document.getElementById('mobileMenu3');

  // Menú 4
  var menu4Btn = document.getElementById('menu4ToggleBtn');
  var mobileMenu4 = document.getElementById('mobileMenu4');

  // Función para cerrar todos los menús
  function closeAllMenus() {
    if(mobileMenu) mobileMenu.classList.add('hidden');
    if(mobileMenu2) mobileMenu2.classList.add('hidden');
    if(mobileMenu3) mobileMenu3.classList.add('hidden');
    if(mobileMenu4) mobileMenu4.classList.add('hidden');
    if(menuOverlay) menuOverlay.classList.remove('active');
  }

  // Menú original
  if(menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', function() {
      closeAllMenus(); // Cerrar otros menús primero
      mobileMenu.classList.toggle('hidden');
      if(menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  // Menú 2
  if(menu2Btn && mobileMenu2) {
    menu2Btn.addEventListener('click', function() {
      closeAllMenus(); // Cerrar otros menús primero
      mobileMenu2.classList.toggle('hidden');
      if(menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  // Menú 3
  if(menu3Btn && mobileMenu3) {
    menu3Btn.addEventListener('click', function() {
      closeAllMenus(); // Cerrar otros menús primero
      mobileMenu3.classList.toggle('hidden');
      if(menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  // Menú 4
  if(menu4Btn && mobileMenu4) {
    menu4Btn.addEventListener('click', function() {
      closeAllMenus(); // Cerrar otros menús primero
      mobileMenu4.classList.toggle('hidden');
      if(menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  // Overlay
  if(menuOverlay) {
    menuOverlay.addEventListener('click', function() {
      closeAllMenus();
    });
  }

  // Cerrar menús al hacer clic fuera
  document.addEventListener('mousedown', function(e) {
    const isMenuBtn = e.target === menuBtn || e.target === menu2Btn || e.target === menu3Btn || e.target === menu4Btn;
    const isInAnyMenu = (mobileMenu && mobileMenu.contains(e.target)) || 
                       (mobileMenu2 && mobileMenu2.contains(e.target)) || 
                       (mobileMenu3 && mobileMenu3.contains(e.target)) ||
                       (mobileMenu4 && mobileMenu4.contains(e.target));
    
    if (!isMenuBtn && !isInAnyMenu) {
      closeAllMenus();
    }
  });

  // Cerrar menús con ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAllMenus();
    }
  });
}); 
