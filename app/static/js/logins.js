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

// Esperar a que el DOM esté listo para asegurar que los elementos existen
// antes de intentar inicializar los toggles.
document.addEventListener('DOMContentLoaded', function() {
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
    
    // Listener para el botón "Volver a Búsqueda" de login.html (si es diferente)
    // Asumimos que el ID es diferente, si no, el listener anterior ya lo cubre.
    // const btnVolverLogin = document.getElementById("ID_DEL_BOTON_VOLVER_EN_LOGIN.HTML");
    // if (btnVolverLogin) { ... }
}); 