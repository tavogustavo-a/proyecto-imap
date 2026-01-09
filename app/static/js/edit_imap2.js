// JavaScript para manejar los checkboxes de filtros y regex en edit_imap2.html

document.addEventListener("DOMContentLoaded", function() {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Manejar cambios en checkboxes de filtros
  const filterCheckboxes = document.querySelectorAll('.filter-checkbox');
  filterCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const serverId = this.dataset.serverId;
      const filterId = this.dataset.filterId;
      const isChecked = this.checked;

      // Deshabilitar el checkbox mientras se procesa
      this.disabled = true;

      fetch('/admin/update_imap2_filter_association_ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
          server_id: parseInt(serverId),
          filter_id: parseInt(filterId),
          checked: isChecked
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'ok') {
          // Éxito, el checkbox ya está en el estado correcto
        } else {
          // Revertir el estado del checkbox si hay error
          this.checked = !isChecked;
          console.error('Error al actualizar asociación de filtro:', data.message);
        }
      })
      .catch(error => {
        // Revertir el estado del checkbox si hay error
        this.checked = !isChecked;
        console.error('Error al actualizar asociación de filtro:', error);
      })
      .finally(() => {
        // Rehabilitar el checkbox
        this.disabled = false;
      });
    });
  });

  // Manejar cambios en checkboxes de regex
  const regexCheckboxes = document.querySelectorAll('.regex-checkbox');
  regexCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const serverId = this.dataset.serverId;
      const regexId = this.dataset.regexId;
      const isChecked = this.checked;

      // Deshabilitar el checkbox mientras se procesa
      this.disabled = true;

      fetch('/admin/update_imap2_regex_association_ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
          server_id: parseInt(serverId),
          regex_id: parseInt(regexId),
          checked: isChecked
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'ok') {
          // Éxito, el checkbox ya está en el estado correcto
        } else {
          // Revertir el estado del checkbox si hay error
          this.checked = !isChecked;
          console.error('Error al actualizar asociación de regex:', data.message);
        }
      })
      .catch(error => {
        // Revertir el estado del checkbox si hay error
        this.checked = !isChecked;
        console.error('Error al actualizar asociación de regex:', error);
      })
      .finally(() => {
        // Rehabilitar el checkbox
        this.disabled = false;
      });
    });
  });
});
