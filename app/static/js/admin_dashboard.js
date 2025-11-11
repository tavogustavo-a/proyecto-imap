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
