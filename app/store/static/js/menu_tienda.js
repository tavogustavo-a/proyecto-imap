document.addEventListener('DOMContentLoaded', function() {
  // Menú original (puede ser menu1ToggleBtn o menuToggleBtn dependiendo de la página)
  var menuBtn = document.getElementById('menu1ToggleBtn') || document.getElementById('menuToggleBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  var menuOverlay = document.getElementById('menuOverlay');

  // Menú 2
  var menu2Btn = document.getElementById('menu2ToggleBtn');
  var mobileMenu2 = document.getElementById('mobileMenu2');

  // Menú 3 (work_sheets: Licencias)
  var menu3Btn = document.getElementById('menu3ToggleBtn');
  var mobileMenu3 = document.getElementById('mobileMenu3');

  // Menú 4 (admin_store: Herramientas)
  var menu4Btn = document.getElementById('menu4ToggleBtn');
  var mobileMenu4 = document.getElementById('mobileMenu4');

  function syncSideMenuOpenState() {
    var anyOpen =
      (mobileMenu && !mobileMenu.classList.contains('hidden')) ||
      (mobileMenu2 && !mobileMenu2.classList.contains('hidden')) ||
      (mobileMenu3 && !mobileMenu3.classList.contains('hidden')) ||
      (mobileMenu4 && !mobileMenu4.classList.contains('hidden'));
    document.body.classList.toggle('store-side-menu-open', !!anyOpen);
  }

  function setOpenMenu(menu) {
    var menus = [mobileMenu, mobileMenu2, mobileMenu3, mobileMenu4];
    for (var i = 0; i < menus.length; i++) {
      var item = menus[i];
      if (!item) continue;
      if (menu && item === menu) item.classList.remove('hidden');
      else item.classList.add('hidden');
    }
    if (menuOverlay) menuOverlay.classList.toggle('active', !!menu);
    syncSideMenuOpenState();
  }

  function closeAllMenus() {
    setOpenMenu(null);
  }

  function bindMenuToggle(btn, menu) {
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menu.classList.contains('hidden')) setOpenMenu(menu);
      else setOpenMenu(null);
    });
  }

  bindMenuToggle(menuBtn, mobileMenu);
  bindMenuToggle(menu2Btn, mobileMenu2);
  bindMenuToggle(menu3Btn, mobileMenu3);
  bindMenuToggle(menu4Btn, mobileMenu4);

  // Overlay
  if(menuOverlay) {
    menuOverlay.addEventListener('click', function() {
      closeAllMenus();
    });
  }

  // Cerrar menús al hacer clic fuera
  document.addEventListener('mousedown', function(e) {
    const isMenuBtn = (menuBtn && menuBtn.contains(e.target)) ||
      (menu2Btn && menu2Btn.contains(e.target)) ||
      (menu3Btn && menu3Btn.contains(e.target)) ||
      (menu4Btn && menu4Btn.contains(e.target));
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
