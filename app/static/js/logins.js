function initializePasswordToggle(passwordInputId, toggleButtonId) {
  const passField = document.getElementById(passwordInputId);
  const toggleBtn = document.getElementById(toggleButtonId);

  if (toggleBtn && passField) {
    toggleBtn.addEventListener("click", function() {
      if (passField.type === "password") {
        passField.type = "text";
        toggleBtn.textContent = "🙈"; // Ícono para ocultar
      } else {
        passField.type = "password";
        toggleBtn.textContent = "👁"; // Ícono para mostrar
      }
    });
  } else {
    // Opcional: console.warn si no se encuentran, pero puede ser normal
  }
}

/**
 * 5 toques rápidos en el título (o zona marcada) del login de usuario → /auth/login.
 * pointerup funciona mejor en WebView Android que solo "click".
 */
function wireAdminUnlockByTaps(el) {
  if (!el || el.getAttribute("data-admin-taps-wired") === "1") return;
  const url = el.getAttribute("data-admin-login-url");
  if (!url) return;
  el.setAttribute("data-admin-taps-wired", "1");

  let taps = 0;
  let started = 0;
  let lastTapAt = 0;
  const WINDOW_MS = 3000;
  const NEEDED = 5;

  function onTap() {
    const now = Date.now();
    // pointerup + click del mismo toque no deben contar dos veces
    if (now - lastTapAt < 80) return;
    lastTapAt = now;
    if (taps === 0 || now - started > WINDOW_MS) {
      taps = 1;
      started = now;
      return;
    }
    taps += 1;
    if (taps >= NEEDED) {
      taps = 0;
      window.location.href = url;
    }
  }

  el.addEventListener("pointerup", onTap);
  el.addEventListener("click", onTap);
}

function initLoginsPage() {
    // Intentar inicializar toggle para login de admin
    initializePasswordToggle("adminPasswordField", "toggleAdminPass");
    
    // Intentar inicializar toggle para login de usuario
    initializePasswordToggle("userPasswordField", "toggleUserPass");

    // Intentar inicializar toggle para nuevo usuario (usuarios.html)
    initializePasswordToggle("newUserPassword", "toggleNewPass");

    // Intentar inicializar toggle para editar usuario (usuarios.html popup)
    initializePasswordToggle("editUserPassword", "toggleEditPass");

    // Listener para el botón "Volver a Búsqueda" de user_login.html
    const btnVolverUserLogin = document.getElementById("btnVolverBusquedaUserLogin");
    if (btnVolverUserLogin) {
      const homeUrlUser = btnVolverUserLogin.dataset.homeUrl;
      if (homeUrlUser) {
        btnVolverUserLogin.addEventListener("click", () => {
          window.location.href = homeUrlUser;
        });
      } else {
         console.error("No se encontró data-home-url en #btnVolverBusquedaUserLogin");
      }
    }

    wireAdminUnlockByTaps(document.getElementById("userLoginTitle"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLoginsPage);
} else {
  initLoginsPage();
} 