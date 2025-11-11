document.addEventListener('DOMContentLoaded', function() {
  // Menú original
  var menuBtn = document.getElementById('menuToggleBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  var menuOverlay = document.getElementById('menuOverlay');
  var closeMenuBtn = document.getElementById('closeMenuBtn');

  // Menú2
  var menu2Btn = document.getElementById('menu2ToggleBtn');
  var mobileMenu2 = document.getElementById('mobileMenu2');

  // Menú3
  var menu3Btn = document.getElementById('menu3ToggleBtn');
  var mobileMenu3 = document.getElementById('mobileMenu3');

  // Función para cerrar todos los menús
  function closeAllMenus() {
    if(mobileMenu) mobileMenu.classList.add('hidden');
    if(mobileMenu2) mobileMenu2.classList.add('hidden');
    if(mobileMenu3) mobileMenu3.classList.add('hidden');
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

  // Menú2
  if(menu2Btn && mobileMenu2) {
    menu2Btn.addEventListener('click', function() {
      closeAllMenus(); // Cerrar otros menús primero
      mobileMenu2.classList.toggle('hidden');
      if(menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  // Menú3
  if(menu3Btn && mobileMenu3) {
    menu3Btn.addEventListener('click', function() {
      closeAllMenus(); // Cerrar otros menús primero
      mobileMenu3.classList.toggle('hidden');
      if(menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  // Botón cerrar (si existe)
  if(closeMenuBtn && mobileMenu) {
    closeMenuBtn.addEventListener('click', function() {
      closeAllMenus();
    });
  }

  // Overlay para cerrar menús
  if(menuOverlay) {
    menuOverlay.addEventListener('click', function() {
      closeAllMenus();
    });
  }

  // Cerrar menús al hacer clic fuera
  document.addEventListener('mousedown', function(e) {
    const isMenuBtn = e.target === menuBtn || e.target === menu2Btn || e.target === menu3Btn;
    const isInAnyMenu = (mobileMenu && mobileMenu.contains(e.target)) || 
                       (mobileMenu2 && mobileMenu2.contains(e.target)) || 
                       (mobileMenu3 && mobileMenu3.contains(e.target));
    
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