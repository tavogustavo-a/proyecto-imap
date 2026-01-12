// JavaScript para manejar los checkboxes de filtros y regex en edit_imap2.html

document.addEventListener("DOMContentLoaded", function() {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Función para obtener la ruta base (admin o usuario)
  function getBaseRoute() {
    const path = window.location.pathname;
    if (path.includes('/manage_my_page/')) {
      return '/usuario/my_page';
    }
    return '/admin/imap2';
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

      // No mostrar vista previa, solo preparar para subir

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

      fetch(`${getBaseRoute()}/${imap2Id}/upload_background`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCsrfToken()
        },
        body: formData
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'ok') {
          // Mostrar botón de eliminar (sin vista previa de imagen)
          if (backgroundDeleteBtn) {
            backgroundDeleteBtn.classList.remove('d-none');
          }
        } else {
          alert('Error al subir el fondo: ' + (data.message || 'Error desconocido'));
          // Ocultar botón de eliminar si hay error
          if (backgroundDeleteBtn) {
            backgroundDeleteBtn.classList.add('d-none');
          }
        }
      })
      .catch(error => {
        alert('Error de red al subir el fondo: ' + error.message);
        // Ocultar botón de eliminar si hay error
        if (backgroundDeleteBtn) {
          backgroundDeleteBtn.classList.add('d-none');
        }
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

      fetch(`${getBaseRoute()}/${imap2Id}/delete_background`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'ok') {
          // Ocultar botón de eliminar
          if (backgroundDeleteBtn) {
            backgroundDeleteBtn.classList.add('d-none');
          }
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

  // Manejar búsqueda y vinculación de usuarios
  const userSearchInput = document.getElementById('imap2-user-search');
  const usersList = document.getElementById('imap2-users-list');
  let searchTimeout = null;

  if (userSearchInput) {
    const imap2Id = userSearchInput.closest('.imap2-background-section')?.previousElementSibling
      ?.querySelector('[data-imap2-id]')?.getAttribute('data-imap2-id') 
      || document.querySelector('[data-imap2-id]')?.getAttribute('data-imap2-id')
      || window.location.pathname.match(/\/edit_imap2\/(\d+)/)?.[1];

    if (imap2Id) {
      // Búsqueda con debounce
      userSearchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim();
        const resultsContainer = document.getElementById('imap2-user-search-results');
        
        clearTimeout(searchTimeout);
        
        // Ocultar dropdown si el campo está vacío
        if (query.length < 2) {
          if (resultsContainer) {
            resultsContainer.classList.add('d-none');
          }
          return;
        }
        
        searchTimeout = setTimeout(() => {
          // Solo buscar usuarios si estamos en la página de admin
          if (window.location.pathname.includes('/edit_imap2/')) {
            fetch(`/admin/imap2/${imap2Id}/search_users_ajax?query=${encodeURIComponent(query)}`, {
              headers: {
                'X-CSRFToken': getCsrfToken()
              }
            })
            .then(res => res.json())
            .then(data => {
              if (data.status === 'ok') {
                // Obtener IDs de usuarios ya vinculados
                const linkedIds = Array.from(usersList.querySelectorAll('.imap2-user-tag'))
                  .map(tag => parseInt(tag.getAttribute('data-user-id')));
                
                // Filtrar usuarios ya vinculados
                const availableUsers = data.users.filter(u => !u.is_linked && !linkedIds.includes(u.id));
                
                // Mostrar resultados en dropdown
                showUserSearchResults(availableUsers, imap2Id);
              }
            })
            .catch(err => {
              // Silenciar errores de búsqueda
            });
          }
        }, 300);
      });

      // Manejar selección de usuario al hacer clic fuera o presionar Enter
      userSearchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = e.target.value.trim();
          if (query.length >= 2 && window.location.pathname.includes('/edit_imap2/')) {
            fetch(`/admin/imap2/${imap2Id}/search_users_ajax?query=${encodeURIComponent(query)}`, {
              headers: {
                'X-CSRFToken': getCsrfToken()
              }
            })
            .then(res => res.json())
            .then(data => {
              if (data.status === 'ok' && data.users.length > 0) {
                const firstUser = data.users[0];
                if (!firstUser.is_linked) {
                  linkUserToImap2(imap2Id, firstUser.id, firstUser.username);
                  e.target.value = '';
                }
              }
            });
          }
        }
      });
    }
  }

  // Función para mostrar resultados de búsqueda con dropdown
  function showUserSearchResults(users, imap2Id) {
    const resultsContainer = document.getElementById('imap2-user-search-results');
    if (!resultsContainer) return;
    
    // Limpiar resultados anteriores
    while (resultsContainer.firstChild) {
      resultsContainer.removeChild(resultsContainer.firstChild);
    }
    
    if (users.length === 0) {
      resultsContainer.classList.add('d-none');
      return;
    }
    
    // Crear elementos de resultados
    users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'user-search-result-item';
      item.textContent = user.full_name || user.username;
      item.setAttribute('data-user-id', user.id);
      item.setAttribute('data-username', user.username);
      
      item.addEventListener('click', function() {
        linkUserToImap2(imap2Id, user.id, user.username);
        userSearchInput.value = '';
        resultsContainer.classList.add('d-none');
      });
      
      resultsContainer.appendChild(item);
    });
    
    resultsContainer.classList.remove('d-none');
  }
  
  // Ocultar dropdown al hacer clic fuera
  document.addEventListener('click', function(e) {
    const resultsContainer = document.getElementById('imap2-user-search-results');
    const searchInput = document.getElementById('imap2-user-search');
    
    if (resultsContainer && searchInput && 
        !resultsContainer.contains(e.target) && 
        e.target !== searchInput) {
      resultsContainer.classList.add('d-none');
    }
  });

  // Función para vincular usuario (solo admin)
  function linkUserToImap2(imap2Id, userId, username) {
    if (!window.location.pathname.includes('/edit_imap2/')) return;
    fetch(`/admin/imap2/${imap2Id}/link_user/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ok') {
        // Agregar tag de usuario a la lista
        const tag = document.createElement('div');
        tag.className = 'user-tag imap2-user-tag';
        tag.setAttribute('data-user-id', userId);
        tag.innerHTML = `
          <span>${escapeHtml(username)}</span>
          <button type="button" class="remove-user-btn" data-user-id="${userId}" title="Eliminar">
            <i class="fas fa-times"></i>
          </button>
        `;
        if (usersList) {
          usersList.appendChild(tag);
        }
      } else {
        alert('Error: ' + (data.message || 'Error al vincular usuario'));
      }
    })
    .catch(err => {
      alert('Error de red: ' + err.message);
    });
  }

  // Función helper para escapar HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Manejar eliminación de usuarios vinculados
  document.addEventListener('click', function(e) {
    if (e.target.closest('.remove-user-btn')) {
      const btn = e.target.closest('.remove-user-btn');
      const userId = parseInt(btn.getAttribute('data-user-id'));
      const userTag = btn.closest('.imap2-user-tag');
      const imap2Id = window.location.pathname.match(/\/edit_imap2\/(\d+)/)?.[1];
      
      if (!imap2Id || !userId || !window.location.pathname.includes('/edit_imap2/')) return;
      
      if (!confirm('¿Deseas desvincular este usuario?')) {
        return;
      }
      
      fetch(`/admin/imap2/${imap2Id}/unlink_user/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          if (userTag) {
            userTag.remove();
          }
        } else {
          alert('Error: ' + (data.message || 'Error al desvincular usuario'));
        }
      })
      .catch(err => {
        alert('Error de red: ' + err.message);
      });
    }
  });
});
