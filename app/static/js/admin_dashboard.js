// app/static/js/admin_dashboard.js

// Función auxiliar para obtener URL desde data-* attributes
function getLogoutAllUsersUrl() {
  // Buscar en el contenedor principal o en cualquier elemento con el atributo
  const container = document.querySelector('[data-logout-all-users-url]');
  if (container) {
    return container.getAttribute('data-logout-all-users-url');
  }
  // Fallback: buscar en el botón si tiene data-url
  const btn = document.getElementById('btnLogoutAllUsers');
  if (btn && btn.dataset.url) {
    return btn.dataset.url;
  }
  return null;
}

// Función auxiliar para obtener URL de logout con limpieza de cookies
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

// Función para limpiar todas las cookies del dominio
function clearAllCookies() {
  // Obtener todas las cookies
  const cookies = document.cookie.split(';');
  
  // Lista de cookies conocidas que deben eliminarse específicamente
  const knownCookies = [
    'session',
    'remember_username',
    'remember_2fa_device',
    'csrf_token'
  ];
  
  // Eliminar cookies conocidas primero
  knownCookies.forEach(function(name) {
    // Intentar eliminar con diferentes configuraciones
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname + ';';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname + ';';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname.split('.').slice(-2).join('.') + ';';
  });
  
  // Eliminar cada cookie del documento
  cookies.forEach(function(cookie) {
    const eqPos = cookie.indexOf('=');
    const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
    
    // Intentar eliminar la cookie con diferentes paths y domain
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname + ';';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname + ';';
    // Intentar con dominio de segundo nivel también
    const domainParts = window.location.hostname.split('.');
    if (domainParts.length > 2) {
      const secondLevelDomain = '.' + domainParts.slice(-2).join('.');
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + secondLevelDomain + ';';
    }
  });
  
  // También limpiar localStorage y sessionStorage
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.warn('No se pudieron limpiar localStorage/sessionStorage:', e);
  }
}

document.addEventListener('DOMContentLoaded', function() {
    // Botón para cerrar sesión de todos los usuarios
    const btnLogoutAllUsers = document.getElementById('btnLogoutAllUsers');
    
    if (btnLogoutAllUsers) {
        btnLogoutAllUsers.addEventListener('click', function() {
            // Mostrar confirmación antes de cerrar todas las sesiones
            if (confirm('¿Estás seguro de que quieres cerrar la sesión de TODOS los usuarios?\n\nEsto incluye tu propia sesión y tendrás que volver a iniciar sesión.')) {
                // Crear formulario para enviar POST request
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = getLogoutAllUsersUrl() || btnLogoutAllUsers.dataset.url;
                
                // Agregar token CSRF
                const csrfToken = document.querySelector('meta[name="csrf_token"]');
                if (csrfToken) {
                    const csrfInput = document.createElement('input');
                    csrfInput.type = 'hidden';
                    csrfInput.name = '_csrf_token';
                    csrfInput.value = csrfToken.getAttribute('content');
                    form.appendChild(csrfInput);
                }
                
                // Enviar formulario
                document.body.appendChild(form);
                form.submit();
            }
        });
    }

    // Botón para cerrar sesión de todos y limpiar cookies
    const btnLogoutAllAndClearCookies = document.getElementById('btnLogoutAllAndClearCookies');
    let isProcessingLogout = false; // Flag para prevenir ejecuciones múltiples
    
    if (btnLogoutAllAndClearCookies) {
        btnLogoutAllAndClearCookies.addEventListener('click', function(e) {
            // Prevenir ejecución múltiple
            if (isProcessingLogout) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            
            // Mostrar confirmación antes de cerrar todas las sesiones y limpiar cookies
            if (confirm('¿Estás seguro de que quieres cerrar la sesión de TODOS los usuarios (admin, usuarios y sub-usuarios) y limpiar todas las cookies?\n\nEsto cerrará tu sesión y tendrás que volver a iniciar sesión.')) {
                // Marcar como procesando para prevenir ejecuciones múltiples
                isProcessingLogout = true;
                
                // Deshabilitar el botón para prevenir clics adicionales
                btnLogoutAllAndClearCookies.disabled = true;
                btnLogoutAllAndClearCookies.textContent = 'Procesando...';
                
                // Limpiar cookies del lado del cliente primero
                clearAllCookies();
                
                // Crear formulario para enviar POST request
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = getLogoutAllAndClearCookiesUrl() || btnLogoutAllAndClearCookies.dataset.url;
                
                // Agregar token CSRF
                const csrfToken = document.querySelector('meta[name="csrf_token"]');
                if (csrfToken) {
                    const csrfInput = document.createElement('input');
                    csrfInput.type = 'hidden';
                    csrfInput.name = '_csrf_token';
                    csrfInput.value = csrfToken.getAttribute('content');
                    form.appendChild(csrfInput);
                }
                
                // Enviar formulario (esto redirigirá y evitará más ejecuciones)
                document.body.appendChild(form);
                form.submit();
                
                // Si por alguna razón el submit falla, resetear el flag después de un tiempo
                setTimeout(function() {
                    isProcessingLogout = false;
                    btnLogoutAllAndClearCookies.disabled = false;
                }, 5000);
            }
        });
    }

    // Funcionalidad del botón ON/OFF para gestión IMAP
    const toggleBtn = document.getElementById('toggleImapManagementBtn');
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const isActive = this.getAttribute('data-enabled') === 'false'; // OFF significa activa
            
            if (isActive) {
                // Cambiar a ON (inactiva)
                this.setAttribute('data-enabled', 'true');
                this.className = 'btn-red';
                this.innerHTML = '<i class="fas fa-power-off"></i> ON';
            } else {
                // Cambiar a OFF (activa)
                this.setAttribute('data-enabled', 'false');
                this.className = 'btn-green';
                this.innerHTML = '<i class="fas fa-power-off"></i> OFF';
            }
            
            // Aquí puedes agregar la lógica para activar/desactivar la gestión IMAP
        });
    }
});
