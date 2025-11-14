/**
 * Funcionalidad para limpiar logs de activadores
 * Refactorizado desde usuarios.html
 */

// Función auxiliar para obtener URL desde meta tags o data-* attributes (cumple con CSP)
function getClearTriggerLogUrl() {
  // Primero intentar leer desde meta tag (más seguro, cumple con CSP)
  const metaTag = document.querySelector('meta[name="clear_trigger_log_url"]');
  if (metaTag) {
    return metaTag.getAttribute('content');
  }
  // Buscar en el contenedor principal o en cualquier elemento con el atributo
  const container = document.querySelector('[data-clear-trigger-log-url]');
  if (container) {
    return container.getAttribute('data-clear-trigger-log-url');
  }
  // Fallback al valor por defecto
  return '/admin/clear_trigger_log';
}

document.addEventListener('DOMContentLoaded', function() {
  const clearLogsBtn = document.getElementById('btnClearTriggerLogMenu');
  
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', function() {
      if (confirm('¿Estás seguro de que quieres limpiar todos los logs de activadores? Esta acción no se puede deshacer.')) {
        fetch(getClearTriggerLogUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
          }
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            if (data.deleted_count > 0) {
              alert('Logs de activadores limpiados correctamente. Se eliminaron ' + data.deleted_count + ' registros.');
            } else {
              alert('Logs de activadores limpiados correctamente. No había registros para eliminar.');
            }
          } else {
            alert('Error al limpiar logs: ' + (data.message || 'Error desconocido'));
          }
        })
        .catch(error => {
          console.error('Error:', error);
          alert('Error al limpiar logs: ' + error.message);
        });
      }
    });
  }
});
