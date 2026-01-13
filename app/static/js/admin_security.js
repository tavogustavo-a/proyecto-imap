// app/static/js/admin_security.js
// JavaScript para la página de cambiar credenciales del admin

document.addEventListener('DOMContentLoaded', function() {
  const toggleBtn = document.getElementById('togglePublicAccessBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function() {
      const currentState = toggleBtn.getAttribute('data-current-state');
      const newState = currentState === 'true' ? 'false' : 'true';
      
      // Confirmar acción antes de proceder
      const actionText = newState === 'true' ? 'activar' : 'desactivar';
      const confirmMessage = newState === 'true' 
        ? '¿Estás seguro de que deseas ACTIVAR el acceso libre? Los usuarios podrán acceder sin iniciar sesión.'
        : '¿Estás seguro de que deseas DESACTIVAR el acceso libre? Los usuarios deberán iniciar sesión para acceder.';
      
      if (!confirm(confirmMessage)) {
        return; // Cancelar si el usuario no confirma
      }
      
      // Feedback visual
      toggleBtn.disabled = true;
      const originalText = toggleBtn.textContent;
      toggleBtn.textContent = 'Procesando...';
      
      // Obtener CSRF token del meta tag
      const csrfMeta = document.querySelector('meta[name="csrf_token"]');
      const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
      
      // Obtener URL del botón o construirla
      const toggleUrl = toggleBtn.getAttribute('data-toggle-url') || '/admin/toggle_public_access';
      
      fetch(toggleUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken
        },
        body: JSON.stringify({ enabled: newState })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          // Actualizar UI
          toggleBtn.setAttribute('data-current-state', newState);
          const statusEl = document.getElementById('accessControlStatus');
          if (newState === 'true') {
            toggleBtn.className = 'btn-green';
            toggleBtn.textContent = 'Desactivar Acceso Libre';
            if (statusEl) statusEl.textContent = 'Acceso libre habilitado';
          } else {
            toggleBtn.className = 'btn-red';
            toggleBtn.textContent = 'Activar Acceso Libre';
            if (statusEl) statusEl.textContent = 'Acceso libre deshabilitado (requiere login)';
          }
          alert('Configuración actualizada correctamente.');
        } else {
          alert('Error: ' + (data.message || 'Error al actualizar configuración'));
        }
      })
      .catch(err => {
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        toggleBtn.disabled = false;
      });
    });
  }
});
