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

  // Manejar subida de fondo personalizado
  const backgroundUploadInput = document.getElementById('imap2-background-upload');
  const backgroundPreview = document.getElementById('imap2-background-preview');
  const backgroundDeleteBtn = document.getElementById('imap2-background-delete');
  const backgroundPreviewContainer = document.getElementById('imap2-background-preview-container');

  if (backgroundUploadInput) {
    backgroundUploadInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;

      // Validar que sea una imagen
      if (!file.type.startsWith('image/')) {
        alert('Solo se permiten archivos de imagen');
        e.target.value = '';
        return;
      }

      // Mostrar vista previa inmediata
      const reader = new FileReader();
      reader.onload = function(e) {
        backgroundPreview.src = e.target.result;
        backgroundPreview.classList.remove('d-none');
        backgroundDeleteBtn.classList.remove('d-none');
      };
      reader.readAsDataURL(file);

      // Subir el archivo
      const formData = new FormData();
      formData.append('background', file);

      const imap2Id = backgroundDeleteBtn ? backgroundDeleteBtn.getAttribute('data-imap2-id') : null;
      if (!imap2Id) {
        alert('Error: No se pudo identificar el servidor IMAP2');
        return;
      }

      // Deshabilitar el input mientras se sube
      backgroundUploadInput.disabled = true;
      const uploadLabel = document.querySelector('.imap2-background-upload-label');
      const originalLabelContent = uploadLabel ? uploadLabel.innerHTML : '';
      if (uploadLabel) {
        uploadLabel.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';
      }

      fetch(`/admin/imap2/${imap2Id}/upload_background`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCsrfToken()
        },
        body: formData
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'ok') {
          // Actualizar la vista previa con la URL del servidor
          backgroundPreview.src = data.background_url;
          backgroundPreview.classList.remove('d-none');
          backgroundDeleteBtn.classList.remove('d-none');
        } else {
          alert('Error al subir el fondo: ' + (data.message || 'Error desconocido'));
          // Ocultar vista previa si hay error
          backgroundPreview.classList.add('d-none');
          backgroundDeleteBtn.classList.add('d-none');
        }
      })
      .catch(error => {
        alert('Error de red al subir el fondo: ' + error.message);
        // Ocultar vista previa si hay error
        backgroundPreview.classList.add('d-none');
        backgroundDeleteBtn.classList.add('d-none');
      })
      .finally(() => {
        backgroundUploadInput.disabled = false;
        backgroundUploadInput.value = '';
        if (uploadLabel) {
          uploadLabel.innerHTML = originalLabelContent;
        }
      });
    });
  }

  // Manejar eliminación de fondo personalizado
  if (backgroundDeleteBtn) {
    backgroundDeleteBtn.addEventListener('click', function(e) {
      e.preventDefault();
      
      if (!confirm('¿Deseas eliminar el fondo personalizado? Se usará el fondo original.')) {
        return;
      }

      const imap2Id = this.getAttribute('data-imap2-id');
      if (!imap2Id) {
        alert('Error: No se pudo identificar el servidor IMAP2');
        return;
      }

      // Deshabilitar el botón mientras se elimina
      this.disabled = true;
      const originalContent = this.innerHTML;
      this.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

      fetch(`/admin/imap2/${imap2Id}/delete_background`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'ok') {
          // Ocultar vista previa y botón de eliminar
          backgroundPreview.classList.add('d-none');
          backgroundDeleteBtn.classList.add('d-none');
          backgroundPreview.src = '';
        } else {
          alert('Error al eliminar el fondo: ' + (data.message || 'Error desconocido'));
        }
      })
      .catch(error => {
        alert('Error de red al eliminar el fondo: ' + error.message);
      })
      .finally(() => {
        this.disabled = false;
        this.innerHTML = originalContent;
      });
    });
  }
});
