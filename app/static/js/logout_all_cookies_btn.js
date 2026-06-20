// Botón "Cerrar sesión y limpiar cookies" (Menú1 admin en páginas compartidas)
(function () {
  function getLogoutAllAndClearCookiesUrl() {
    const container = document.querySelector('[data-logout-all-cookies-url]');
    if (container) {
      return container.getAttribute('data-logout-all-cookies-url');
    }
    const btn = document.getElementById('btnLogoutAllAndClearCookies');
    if (btn && btn.dataset.url) {
      return btn.dataset.url;
    }
    return null;
  }

  function clearAllCookies() {
    const cookies = document.cookie.split(';');
    const knownCookies = [
      'session',
      'remember_username',
      'remember_2fa_device',
      'csrf_token'
    ];
    knownCookies.forEach(function (name) {
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname + ';';
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname + ';';
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname.split('.').slice(-2).join('.') + ';';
    });
    cookies.forEach(function (cookie) {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname + ';';
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname + ';';
      const domainParts = window.location.hostname.split('.');
      if (domainParts.length > 2) {
        const secondLevelDomain = '.' + domainParts.slice(-2).join('.');
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + secondLevelDomain + ';';
      }
    });
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('No se pudieron limpiar localStorage/sessionStorage:', e);
    }
  }

  function formatLogoutCookiesButtonLabel(btn) {
    if (!btn || btn.dataset.logoutLabelFormatted === '1') return;
    const icon = btn.querySelector('i');
    btn.dataset.logoutLabelFormatted = '1';
    btn.replaceChildren();
    if (icon) btn.appendChild(icon);
    btn.appendChild(document.createTextNode(' Cerrar sesión y '));
    const small = document.createElement('span');
    small.className = 'logout-clear-cookies-label';
    small.textContent = 'limpiar cookies';
    btn.appendChild(small);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btnLogoutAllAndClearCookies = document.getElementById('btnLogoutAllAndClearCookies');
    let isProcessingLogout = false;
    if (!btnLogoutAllAndClearCookies) return;

    formatLogoutCookiesButtonLabel(btnLogoutAllAndClearCookies);

    btnLogoutAllAndClearCookies.addEventListener('click', function (e) {
      if (isProcessingLogout) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (
        confirm(
          '¿Estás seguro de que quieres cerrar la sesión de TODOS los usuarios (admin, usuarios y sub-usuarios) y limpiar todas las cookies?\n\nEsto cerrará tu sesión y tendrás que volver a iniciar sesión.'
        )
      ) {
        isProcessingLogout = true;
        btnLogoutAllAndClearCookies.disabled = true;
        btnLogoutAllAndClearCookies.textContent = 'Procesando...';
        clearAllCookies();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = getLogoutAllAndClearCookiesUrl() || btnLogoutAllAndClearCookies.dataset.url;
        let csrfVal = null;
        const csrfMeta = document.querySelector('meta[name="csrf_token"]');
        if (csrfMeta) csrfVal = csrfMeta.getAttribute('content');
        if (!csrfVal) {
          const csrfInputEl = document.getElementById('csrf_token');
          if (csrfInputEl && csrfInputEl.value) csrfVal = csrfInputEl.value;
        }
        if (csrfVal) {
          const csrfInput = document.createElement('input');
          csrfInput.type = 'hidden';
          csrfInput.name = '_csrf_token';
          csrfInput.value = csrfVal;
          form.appendChild(csrfInput);
        }
        document.body.appendChild(form);
        form.submit();
        setTimeout(function () {
          isProcessingLogout = false;
          btnLogoutAllAndClearCookies.disabled = false;
        }, 5000);
      }
    });
  });
})();
