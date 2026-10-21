// app/static/js/manage_my_page.js
// Gestión de página del usuario

(function() {
  'use strict';

  const linkedImapList = document.getElementById('linkedImapList');
  const createLinkedImapForm = document.getElementById('createLinkedImapForm');
  const imapLimitInfo = document.getElementById('imapLimitInfo');
  const currentImapCountSpan = document.getElementById('currentImapCount');
  const MAX_PAGE_IMAP_SERVERS = 5;
  let pageImapCanCreate = true;

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.content : '';
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Función para actualizar el contador y estado del botón
  function updateImapLimitInfo(currentCount, canCreateMore) {
    pageImapCanCreate = !!canCreateMore;
    if (currentImapCountSpan) {
      currentImapCountSpan.textContent = currentCount;
    }

    const submitBtn = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]') : null;
    if (submitBtn) {
      if (canCreateMore) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear';
        if (imapLimitInfo) {
          imapLimitInfo.className = 'text-center mb-1';
        }
      } else {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Límite alcanzado';
        if (imapLimitInfo) {
          imapLimitInfo.className = 'text-center mb-1 text-danger';
        }
      }
    }
  }

  function openPrimaryEditModal(btn) {
    const modal = document.getElementById('editPrimaryImapModal');
    const form = document.getElementById('editPrimaryImapForm');
    if (!modal || !form || !btn) return;
    const isPrimary = btn.getAttribute('data-primary') === '1';
    form.setAttribute('data-editing-primary', isPrimary ? '1' : '0');
    form.setAttribute('data-editing-id', btn.getAttribute('data-imap-id') || '');
    const title = document.getElementById('editPrimaryImapTitle');
    if (title) title.textContent = isPrimary ? 'Editar servidor' : 'Editar servidor';
    document.getElementById('edit_primary_host').value = btn.getAttribute('data-host') || '';
    document.getElementById('edit_primary_port').value = btn.getAttribute('data-port') || '993';
    document.getElementById('edit_primary_username').value = btn.getAttribute('data-username') || '';
    document.getElementById('edit_primary_password').value = '';
    document.getElementById('edit_primary_folders').value = btn.getAttribute('data-folders') || 'INBOX';
    modal.classList.remove('d-none');
    const hostInput = document.getElementById('edit_primary_host');
    if (hostInput) hostInput.focus();
  }

  function closePrimaryEditModal() {
    const modal = document.getElementById('editPrimaryImapModal');
    if (modal) modal.classList.add('d-none');
  }

  // Función para renderizar la lista de servidores IMAP vinculados
  function renderLinkedImapList(servers) {
    if (!linkedImapList) return;
    
    // Obtener imap2_id del formulario de creación
    const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';
    
    // Limpiar contenido existente
    while (linkedImapList.firstChild) {
      linkedImapList.removeChild(linkedImapList.firstChild);
    }

    if (!servers || servers.length === 0) {
      // No mostrar mensaje, solo limpiar la lista
      return;
    }

    servers.forEach(s => {
      const div = document.createElement('div');
      div.className = 'imap-item mb-1 imap-admin-row';
      div.setAttribute('data-imap-id', s.id);
      div.setAttribute('data-host', (s.host || '').toLowerCase());
      div.setAttribute('data-username', (s.username || '').toLowerCase());

      // Solo se muestra el usuario (el host queda en data-host para el buscador)
      const strongUser = document.createElement('strong');
      strongUser.className = 'imap-admin-row__email';
      strongUser.textContent = s.username || '';
      div.appendChild(strongUser);

      const isPrimary = !!s.is_primary;
      if (isPrimary) {
        div.setAttribute('data-primary', '1');
      }

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'imap-admin-row__actions';

      // Botón Probar
      const testForm = document.createElement('form');
      testForm.method = 'POST';
      testForm.className = 'd-inline';
      if (isPrimary) {
        testForm.classList.add('test-primary-imap-form');
        testForm.setAttribute('data-imap2-id', imap2Id);
        testForm.action = '/usuario/my_page/test_imap_ajax';
      } else {
        testForm.action = `/usuario/my_page/test_imap/${s.id}`;
      }
      
      const csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = '_csrf_token';
      csrfInput.value = getCsrfToken();
      testForm.appendChild(csrfInput);
      
      const testBtn = document.createElement('button');
      testBtn.type = 'submit';
      testBtn.className = 'btn-blue row-test-btn';
      testBtn.title = 'Probar';
      testBtn.setAttribute('aria-label', 'Probar');
      const testIcon = document.createElement('i');
      testIcon.className = 'fas fa-plug';
      testIcon.setAttribute('aria-hidden', 'true');
      testBtn.appendChild(testIcon);
      testForm.appendChild(testBtn);
      actionsDiv.appendChild(testForm);

      // Botón On/Off
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'toggle-my-page-imap-btn ml-03';
      toggleBtn.setAttribute('data-id', s.id);
      toggleBtn.setAttribute('data-imap2-id', imap2Id);
      toggleBtn.setAttribute('data-enabled', s.enabled ? 'true' : 'false');
      if (isPrimary) {
        toggleBtn.setAttribute('data-primary', '1');
      }
      paintStateSwitch(toggleBtn, !!s.enabled);
      actionsDiv.appendChild(toggleBtn);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-orange ml-03 edit-page-imap-btn row-icon-btn' + (isPrimary ? ' edit-primary-imap-btn' : '');
      editBtn.title = 'Editar';
      editBtn.setAttribute('aria-label', 'Editar');
      editBtn.setAttribute('data-primary', isPrimary ? '1' : '0');
      editBtn.setAttribute('data-imap-id', s.id);
      editBtn.setAttribute('data-imap2-id', imap2Id);
      editBtn.setAttribute('data-host', s.host || '');
      editBtn.setAttribute('data-port', s.port != null ? String(s.port) : '993');
      editBtn.setAttribute('data-username', s.username || '');
      editBtn.setAttribute('data-folders', s.folders || 'INBOX');
      const pen = document.createElement('i');
      pen.className = 'fas fa-pen';
      pen.setAttribute('aria-hidden', 'true');
      editBtn.appendChild(pen);
      actionsDiv.appendChild(editBtn);

      if (!isPrimary) {
        const unlinkBtn = document.createElement('button');
        unlinkBtn.type = 'button';
        unlinkBtn.className = 'btn-red unlink-my-page-imap-btn ml-03 btn-imap-action btn-imap-small';
        unlinkBtn.setAttribute('data-imap2-id', imap2Id);
        unlinkBtn.setAttribute('data-imap-id', s.id);
        unlinkBtn.title = 'Eliminar';
        const icon = document.createElement('i');
        icon.className = 'fas fa-trash';
        unlinkBtn.appendChild(icon);
        actionsDiv.appendChild(unlinkBtn);
      }

      div.appendChild(actionsDiv);
      linkedImapList.appendChild(div);
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    const editPrimaryImapForm = document.getElementById('editPrimaryImapForm');
    if (editPrimaryImapForm) {
      editPrimaryImapForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const imap2Id = editPrimaryImapForm.getAttribute('data-imap2-id');
        const editingId = editPrimaryImapForm.getAttribute('data-editing-id');
        const isPrimary = editPrimaryImapForm.getAttribute('data-editing-primary') !== '0';
        const saveUrl = isPrimary
          ? '/usuario/my_page/' + imap2Id + '/update_primary_imap'
          : '/usuario/my_page/' + imap2Id + '/update_linked_imap/' + editingId;
        const host = document.getElementById('edit_primary_host').value.trim();
        const port = parseInt(document.getElementById('edit_primary_port').value, 10) || 993;
        const username = document.getElementById('edit_primary_username').value.trim();
        const password = document.getElementById('edit_primary_password').value;
        const folders = document.getElementById('edit_primary_folders').value.trim() || 'INBOX';
        if (!host || !username) {
          alert('Host y usuario son obligatorios.');
          return;
        }
        const submitBtn = editPrimaryImapForm.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Guardando...';
        }
        fetch(saveUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            host: host,
            port: port,
            username: username,
            password: password,
            folders: folders
          })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.status === 'ok') {
            if (data.servers) renderLinkedImapList(data.servers);
            if (data.current_count !== undefined && data.can_create_more !== undefined) {
              updateImapLimitInfo(data.current_count, data.can_create_more);
            }
            closePrimaryEditModal();
          } else {
            alert('Error: ' + (data.message || 'Error al guardar'));
          }
        })
        .catch(function(err) {
          alert('Error de red: ' + err.message);
        })
        .finally(function() {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Guardar';
          }
        });
      });
    }

    // Cargar conteo inicial de servidores IMAP vinculados
    if (createLinkedImapForm) {
      const imap2Id = createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id');
      if (imap2Id) {
        fetch(`/usuario/my_page/${imap2Id}/linked_imap_servers`)
          .then(res => res.json())
          .then(data => {
            if (data.status === 'ok') {
              if (data.servers) {
                renderLinkedImapList(data.servers);
              }
              if (data.current_count !== undefined && data.can_create_more !== undefined) {
                updateImapLimitInfo(data.current_count, data.can_create_more);
              }
            }
          })
          .catch(() => {
            // Si falla, no hacer nada
          });
      }
    }
    
    const saveParagraphForm = document.getElementById('saveParagraphForm');
    
    if (saveParagraphForm) {
      saveParagraphForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = new FormData(saveParagraphForm);
        const submitBtn = saveParagraphForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
        
        fetch(saveParagraphForm.action, {
          method: 'POST',
          body: formData,
          headers: {
            'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').content
          }
        })
        .then(response => {
          if (response.redirected) {
            window.location.href = response.url;
          } else {
            return response.json();
          }
        })
        .then(data => {
          if (data && data.status === 'ok') {
            alert('Párrafo guardado correctamente');
          }
        })
        .catch(err => {
          alert('Error al guardar: ' + err.message);
        })
        .finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        });
      });
    }

    // Event listener para crear y vincular servidor IMAP
    if (createLinkedImapForm) {
      createLinkedImapForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const submitBtn = createLinkedImapForm.querySelector('button[type="submit"]');
        const imap2Id = submitBtn.getAttribute('data-imap2-id');
        const host = document.getElementById('linked_imap_host').value.trim();
        const port = parseInt(document.getElementById('linked_imap_port').value) || 993;
        const username = document.getElementById('linked_imap_username').value.trim();
        const password = document.getElementById('linked_imap_password').value.trim();
        const folders = document.getElementById('linked_imap_folders').value.trim() || 'INBOX';

        if (!host || !username) {
          alert('Host y usuario son obligatorios.');
          return;
        }

        // Guardar valores antes de limpiar (por si hay que revertir)
        const formData = {
          host: host,
          port: port,
          username: username,
          password: password,
          folders: folders
        };
        
        // Actualización optimista: limpiar formulario inmediatamente
        createLinkedImapForm.reset();
        document.getElementById('linked_imap_port').value = '993';
        document.getElementById('linked_imap_folders').value = 'INBOX';
        
        // Feedback visual mínimo
        submitBtn.disabled = true;
        submitBtn.style.transition = 'none';

        fetch(`/usuario/my_page/${imap2Id}/create_and_link_imap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            host: host,
            port: port,
            username: username,
            password: password,
            folders: folders
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            renderLinkedImapList(data.servers);
            
            // Actualizar contador y estado del botón
            if (data.current_count !== undefined && data.can_create_more !== undefined) {
              updateImapLimitInfo(data.current_count, data.can_create_more);
            }
          } else {
            // Revertir limpieza del formulario en caso de error
            document.getElementById('linked_imap_host').value = formData.host;
            document.getElementById('linked_imap_port').value = formData.port.toString();
            document.getElementById('linked_imap_username').value = formData.username;
            document.getElementById('linked_imap_password').value = formData.password;
            document.getElementById('linked_imap_folders').value = formData.folders;
            alert('Error: ' + (data.message || 'Error al crear servidor'));
          }
        })
        .catch(err => {
          // Revertir limpieza del formulario en caso de error de red
          document.getElementById('linked_imap_host').value = formData.host;
          document.getElementById('linked_imap_port').value = formData.port.toString();
          document.getElementById('linked_imap_username').value = formData.username;
          document.getElementById('linked_imap_password').value = formData.password;
          document.getElementById('linked_imap_folders').value = formData.folders;
          alert('Error de red: ' + err.message);
        })
        .finally(() => {
          submitBtn.disabled = false;
        });
      });
    }

    // Event listener para probar servidor IMAP (interceptar formulario)
    document.addEventListener('submit', function(e) {
      const form = e.target.closest('form');
      if (!form) return;
      const isPrimaryTest = form.classList.contains('test-primary-imap-form');
      const isLinkedTest = form.action && form.action.indexOf('/usuario/my_page/test_imap/') !== -1;
      if (!isPrimaryTest && !isLinkedTest) return;

      e.preventDefault();
      let serverId = null;
      if (isPrimaryTest) {
        serverId = parseInt(form.getAttribute('data-imap2-id'), 10);
      } else {
        const serverIdMatch = form.action.match(/\/usuario\/my_page\/test_imap\/(\d+)/);
        serverId = serverIdMatch ? parseInt(serverIdMatch[1], 10) : NaN;
      }

      if (!serverId) {
        alert('Error: No se pudo identificar el servidor.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        paintTestButtonBusy(submitBtn, true);

        fetch('/usuario/my_page/test_imap_ajax', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            server_id: serverId,
            is_primary: isPrimaryTest
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            alertImapTestResult(true, data.message || 'Conexión correcta.');
          } else {
            alertImapTestResult(false, data.message);
          }
        })
        .catch(function () {
          alertImapTestOffline();
        })
        .finally(() => {
          paintTestButtonBusy(submitBtn, false);
        });
      }
    });

    // Event listeners para acciones de servidores IMAP vinculados
    document.addEventListener('click', function(e) {
      if (e.target.closest('.edit-page-imap-btn')) {
        e.preventDefault();
        openPrimaryEditModal(e.target.closest('.edit-page-imap-btn'));
        return;
      }

      if (e.target.closest('#closeEditPrimaryImapModal') || e.target.closest('#cancelEditPrimaryImapModal')) {
        e.preventDefault();
        closePrimaryEditModal();
        return;
      }

      const editModal = document.getElementById('editPrimaryImapModal');
      if (editModal && e.target === editModal) {
        closePrimaryEditModal();
        return;
      }

      // Toggle On/Off para servidores IMAP vinculados
      if (e.target.closest('.toggle-my-page-imap-btn')) {
        e.preventDefault();
        const btn = e.target.closest('.toggle-my-page-imap-btn');
        const imapId = btn.getAttribute('data-id');
        const imap2Id = btn.getAttribute('data-imap2-id') || (createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '');
        const currentlyEnabled = btn.getAttribute('data-enabled') === 'true';

        // Actualización optimista: cambiar el estado del botón inmediatamente
        const newEnabled = !currentlyEnabled;
        btn.setAttribute('data-enabled', newEnabled.toString());
        paintStateSwitch(btn, newEnabled);

        // Feedback visual mínimo
        btn.disabled = true;
        const originalContent = btn.cloneNode(true);

        fetch('/usuario/my_page/toggle_imap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            server_id: parseInt(imapId),
            imap2_id: imap2Id ? parseInt(imap2Id) : null,
            currently_enabled: currentlyEnabled,
            is_primary: btn.getAttribute('data-primary') === '1'
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            // Actualizar lista completa si viene en la respuesta
            if (data.servers) {
              renderLinkedImapList(data.servers);
            } else if (imap2Id) {
              // Si no viene, hacer fetch solo si es necesario
              fetch(`/usuario/my_page/${imap2Id}/linked_imap_servers`)
                .then(res => res.json())
                .then(data => {
                  if (data.status === 'ok') {
                    renderLinkedImapList(data.servers);
                    // Actualizar contador
                    if (data.current_count !== undefined && data.can_create_more !== undefined) {
                      updateImapLimitInfo(data.current_count, data.can_create_more);
                    }
                  }
                })
                .catch(() => {
                  // Si falla, no hacer nada, el estado ya está actualizado
                });
            }
            
            // Actualizar contador si viene en la respuesta del toggle
            if (data.current_count !== undefined && data.can_create_more !== undefined) {
              updateImapLimitInfo(data.current_count, data.can_create_more);
            }
          } else {
            // Revertir cambio optimista en caso de error
            btn.setAttribute('data-enabled', currentlyEnabled.toString());
            paintStateSwitch(btn, currentlyEnabled);
            alert('Error: ' + (data.message || 'Error al cambiar estado'));
          }
        })
        .catch(err => {
          // Revertir cambio optimista en caso de error de red
          btn.setAttribute('data-enabled', currentlyEnabled.toString());
          paintStateSwitch(btn, currentlyEnabled);
          alert('Error de red: ' + err.message);
        })
        .finally(() => {
          btn.disabled = false;
        });
      }

      // Eliminar servidor IMAP
      if (e.target.closest('.unlink-my-page-imap-btn')) {
        e.preventDefault();
        const btn = e.target.closest('.unlink-my-page-imap-btn');
        const imap2Id = btn.getAttribute('data-imap2-id');
        const imapId = btn.getAttribute('data-imap-id');
        
        if (!confirm('¿Deseas eliminar este servidor IMAP? Esta acción es irreversible.')) {
          return;
        }

        // Actualización optimista: eliminar el elemento de la lista inmediatamente
        const imapItem = btn.closest('.imap-item');
        if (imapItem) {
          imapItem.style.transition = 'none';
          imapItem.style.opacity = '0';
          imapItem.style.height = imapItem.offsetHeight + 'px';
          setTimeout(() => {
            imapItem.remove();
            // Actualizar contador optimista
            const currentCount = linkedImapList ? linkedImapList.querySelectorAll('.imap-item').length : 0;
            updateImapLimitInfo(currentCount, currentCount < MAX_PAGE_IMAP_SERVERS);
          }, 100);
        }

        // Feedback visual mínimo
        btn.disabled = true;
        btn.style.transition = 'none';

        fetch(`/usuario/my_page/${imap2Id}/unlink_imap/${imapId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ok') {
            // Recargar lista completa para asegurar sincronización
            if (imap2Id) {
              fetch(`/usuario/my_page/${imap2Id}/linked_imap_servers`)
                .then(res => res.json())
                .then(data => {
                  if (data.status === 'ok') {
                    renderLinkedImapList(data.servers);
                    // Actualizar contador desde la respuesta completa
                    if (data.current_count !== undefined && data.can_create_more !== undefined) {
                      updateImapLimitInfo(data.current_count, data.can_create_more);
                    }
                  }
                })
                .catch(() => {
                  // Si falla, el elemento ya fue eliminado optimistamente
                });
            }
          } else {
            // Revertir eliminación optimista en caso de error
            if (imapItem && imapItem.parentNode) {
              imapItem.style.opacity = '1';
              imapItem.style.height = 'auto';
              if (!linkedImapList.contains(imapItem)) {
                linkedImapList.appendChild(imapItem);
              }
            }
            alert('Error: ' + (data.message || 'Error al eliminar servidor'));
          }
        })
        .catch(err => {
          // Revertir eliminación optimista en caso de error de red
          if (imapItem && imapItem.parentNode) {
            imapItem.style.opacity = '1';
            imapItem.style.height = 'auto';
            if (!linkedImapList.contains(imapItem)) {
              linkedImapList.appendChild(imapItem);
            }
          }
          alert('Error de red: ' + err.message);
        })
        .finally(() => {
          btn.disabled = false;
        });
      }
    });
  });
})();
