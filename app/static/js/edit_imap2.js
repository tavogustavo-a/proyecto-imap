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

  // ======= VINCULAR USUARIOS A PÁGINA DINÁMICA IMAP2 =======
  const imap2UserSearch = document.getElementById('imap2-user-search');
  const imap2UserSearchResults = document.getElementById('imap2-user-search-results');
  const imap2UsersList = document.getElementById('imap2-users-list');

  let allUsersForImap2 = [];
  let linkedUserIds = new Set();
  let searchTimeoutImap2 = null;

  // Obtener ID del servidor IMAP2
  const imap2Id = window.location.pathname.match(/\/edit_imap2\/(\d+)/)?.[1];

  if (imap2UserSearch && imap2Id) {
    // Cargar usuarios vinculados al inicio
    function loadLinkedUsers() {
      // Obtener usuarios vinculados desde el HTML inicial
      const initialLinkedUsers = imap2UsersList.querySelectorAll('[data-user-id]');
      initialLinkedUsers.forEach(tag => {
        const userId = parseInt(tag.getAttribute('data-user-id'));
        if (userId) {
          linkedUserIds.add(userId);
        }
      });
      renderLinkedUsers();
    }

    // Cargar todos los usuarios al iniciar
    fetch(`/admin/imap2/${imap2Id}/search_users_ajax?query=`, {
      method: 'GET',
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ok') {
        allUsersForImap2 = data.users || [];
        loadLinkedUsers();
        renderUserSearchResults([]);
      }
    })
    .catch(err => {
      // Error silencioso
    });

    // Búsqueda de usuarios
    imap2UserSearch.addEventListener('search', function() {
      if (this.value === '') {
        renderUserSearchResults([]);
      }
    });

    imap2UserSearch.addEventListener('input', function() {
      const query = this.value.trim().toLowerCase();

      clearTimeout(searchTimeoutImap2);
      searchTimeoutImap2 = setTimeout(() => {
        if (query) {
          fetch(`/admin/imap2/${imap2Id}/search_users_ajax?query=${encodeURIComponent(query)}`, {
            method: 'GET',
            headers: { 'X-CSRFToken': getCsrfToken() }
          })
          .then(res => res.json())
          .then(data => {
            if (data.status === 'ok') {
              renderUserSearchResults(data.users || []);
            }
          })
          .catch(err => {
            // Error silencioso
          });
        } else {
          renderUserSearchResults([]);
        }
      }, 200);
    });
  }

  // Renderizar resultados de búsqueda
  function renderUserSearchResults(users) {
    if (!imap2UserSearchResults) return;

    imap2UserSearchResults.textContent = '';

    if (users.length === 0 && imap2UserSearch && imap2UserSearch.value.trim()) {
      const noResults = document.createElement('p');
      noResults.className = 'text-secondary text-small';
      noResults.textContent = 'No se encontraron usuarios.';
      imap2UserSearchResults.appendChild(noResults);
      return;
    }

    users.forEach(user => {
      if (linkedUserIds.has(user.id)) return; // Ya está vinculado

      const userItem = document.createElement('div');
      userItem.className = 'bulk-add-emails-user-item';

      const userInfo = document.createElement('span');
      userInfo.textContent = `${user.username}${user.full_name ? ` (${user.full_name})` : ''}`;

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-blue btn-small';
      addBtn.textContent = 'Seleccionar';
      addBtn.addEventListener('click', function() {
        linkUserToImap2(imap2Id, user.id, user.username, user.full_name);
        // Mantener el texto de búsqueda y actualizar los resultados
        if (imap2UserSearch && imap2UserSearch.value.trim()) {
          imap2UserSearch.dispatchEvent(new Event('input'));
        }
      });

      userItem.appendChild(userInfo);
      userItem.appendChild(addBtn);
      imap2UserSearchResults.appendChild(userItem);
    });
  }

  // Renderizar usuarios vinculados
  function renderLinkedUsers() {
    if (!imap2UsersList) return;

    imap2UsersList.textContent = '';

    if (linkedUserIds.size === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'text-secondary text-small';
      emptyMsg.textContent = 'No hay usuarios vinculados.';
      imap2UsersList.appendChild(emptyMsg);
      return;
    }

    const linkedUsersList = Array.from(linkedUserIds).map(id => {
      return allUsersForImap2.find(u => u.id === id);
    }).filter(Boolean);

    linkedUsersList.forEach(user => {
      const userTag = document.createElement('div');
      userTag.className = 'bulk-add-emails-selected-user-tag';

      const userName = document.createElement('span');
      userName.textContent = `${user.username}${user.full_name ? ` (${user.full_name})` : ''}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-small bg-transparent text-white border-none p-0';
      const removeIcon = document.createElement('i');
      removeIcon.className = 'fas fa-times';
      removeBtn.appendChild(removeIcon);
      removeBtn.addEventListener('click', function() {
        unlinkUserFromImap2(imap2Id, user.id);
      });

      userTag.appendChild(userName);
      userTag.appendChild(removeBtn);
      imap2UsersList.appendChild(userTag);
    });
  }

  // Función para vincular usuario
  function linkUserToImap2(imap2Id, userId, username, fullName) {
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
        linkedUserIds.add(userId);
        // Actualizar allUsersForImap2 si es necesario
        if (!allUsersForImap2.find(u => u.id === userId)) {
          allUsersForImap2.push({
            id: userId,
            username: username,
            full_name: fullName || ''
          });
        }
        renderLinkedUsers();
      } else {
        alert('Error: ' + (data.message || 'Error al vincular usuario'));
      }
    })
    .catch(err => {
      alert('Error de red: ' + err.message);
    });
  }

  // Función para desvincular usuario
  function unlinkUserFromImap2(imap2Id, userId) {
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
        linkedUserIds.delete(userId);
        renderLinkedUsers();
        // Actualizar resultados de búsqueda si hay una búsqueda activa
        if (imap2UserSearch && imap2UserSearch.value.trim()) {
          imap2UserSearch.dispatchEvent(new Event('input'));
        }
      } else {
        alert('Error: ' + (data.message || 'Error al desvincular usuario'));
      }
    })
    .catch(err => {
      alert('Error de red: ' + err.message);
    });
  }

  // Event listener delegado para manejar clics en botones de eliminar (incluye HTML inicial)
  if (imap2UsersList) {
    imap2UsersList.addEventListener('click', function(e) {
      const button = e.target.closest('button');
      if (button && button.querySelector('.fa-times')) {
        const userTag = button.closest('[data-user-id]');
        if (userTag) {
          const userId = parseInt(userTag.getAttribute('data-user-id'));
          if (userId && imap2Id) {
            unlinkUserFromImap2(imap2Id, userId);
          }
        }
      }
    });
  }
});
