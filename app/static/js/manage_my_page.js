// app/static/js/manage_my_page.js
// Gestión de página del usuario

(function() {
  'use strict';

  const linkedImapList = document.getElementById('linkedImapList');
  const createLinkedImapForm = document.getElementById('createLinkedImapForm');
  const imapLimitInfo = document.getElementById('imapLimitInfo');
  const currentImapCountSpan = document.getElementById('currentImapCount');
  const MAX_LINKED_IMAP_FOR_USERS = 4;

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
    if (currentImapCountSpan) {
      currentImapCountSpan.textContent = currentCount;
    }
    
    const submitBtn = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]') : null;
    if (submitBtn) {
      if (canCreateMore) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear';
        if (imapLimitInfo) {
          imapLimitInfo.className = 'text-center mb-05 text-small';
        }
      } else {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Límite alcanzado';
        if (imapLimitInfo) {
          imapLimitInfo.className = 'text-center mb-05 text-small text-danger';
        }
      }
    }
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
      div.className = 'imap-item mb-1';
      div.setAttribute('data-imap-id', s.id);
      div.setAttribute('data-host', (s.host || '').toLowerCase());
      div.setAttribute('data-username', (s.username || '').toLowerCase());

      const strongHost = document.createElement('strong');
      strongHost.textContent = `Host: ${escapeHtml(s.host)}`;
      
      const strongUser = document.createElement('strong');
      strongUser.textContent = `Usuario: ${escapeHtml(s.username)}`;
      
      const strongPort = document.createElement('strong');
      strongPort.textContent = `Puerto: ${s.port}`;

      const mainText = document.createDocumentFragment();
      mainText.appendChild(strongHost);
      mainText.appendChild(document.createTextNode(' | '));
      mainText.appendChild(strongUser);
      mainText.appendChild(document.createTextNode(' | '));
      mainText.appendChild(strongPort);

      div.appendChild(mainText);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'mt-05';

      // Botón Probar
      const testForm = document.createElement('form');
      testForm.action = `/usuario/my_page/test_imap/${s.id}`;
      testForm.method = 'POST';
      testForm.className = 'd-inline';
      
      const csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = '_csrf_token';
      csrfInput.value = getCsrfToken();
      testForm.appendChild(csrfInput);
      
      const testBtn = document.createElement('button');
      testBtn.type = 'submit';
      testBtn.className = 'btn-blue btn-imap-action btn-imap-small';
      testBtn.textContent = 'Probar';
      testForm.appendChild(testBtn);
      actionsDiv.appendChild(testForm);

      // Botón On/Off
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = s.enabled ? 'btn-red toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small' : 'btn-green toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small';
      toggleBtn.setAttribute('data-id', s.id);
      toggleBtn.setAttribute('data-imap2-id', imap2Id);
      toggleBtn.setAttribute('data-enabled', s.enabled ? 'true' : 'false');
      toggleBtn.textContent = s.enabled ? 'Off' : 'On';
      actionsDiv.appendChild(toggleBtn);

      // Botón Eliminar
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

      div.appendChild(actionsDiv);
      linkedImapList.appendChild(div);
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    // Cargar conteo inicial de servidores IMAP vinculados
    if (createLinkedImapForm) {
      const imap2Id = createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id');
      if (imap2Id) {
        fetch(`/usuario/my_page/${imap2Id}/linked_imap_servers`)
          .then(res => res.json())
          .then(data => {
            if (data.status === 'ok' && data.current_count !== undefined && data.can_create_more !== undefined) {
              updateImapLimitInfo(data.current_count, data.can_create_more);
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
            // Actualizar lista de servidores vinculados
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
      if (e.target.closest('form') && e.target.closest('form').action && e.target.closest('form').action.includes('/usuario/my_page/test_imap/')) {
        e.preventDefault();
        const form = e.target.closest('form');
        const actionUrl = form.action;
        const serverIdMatch = actionUrl.match(/\/usuario\/my_page\/test_imap\/(\d+)/);
        
        if (!serverIdMatch) {
          alert('Error: No se pudo identificar el servidor.');
          return;
        }
        
        const serverId = parseInt(serverIdMatch[1]);
        const submitBtn = form.querySelector('button[type="submit"]');
        
        // Feedback visual
        if (submitBtn) {
          submitBtn.disabled = true;
          const originalText = submitBtn.textContent;
          submitBtn.textContent = 'Probando...';
          
          fetch('/usuario/my_page/test_imap_ajax', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({
              server_id: serverId
            })
          })
          .then(res => res.json())
          .then(data => {
            if (data.status === 'ok') {
              alert('✅ Éxito: ' + (data.message || 'Conexión exitosa'));
            } else {
              alert('❌ Error: ' + (data.message || 'Error al probar conexión'));
            }
          })
          .catch(err => {
            alert('Error de red: ' + err.message);
          })
          .finally(() => {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = originalText;
            }
          });
        }
        return;
      }
    });

    // Event listeners para acciones de servidores IMAP vinculados
    document.addEventListener('click', function(e) {
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
        btn.className = newEnabled ? 'btn-red toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small' : 'btn-green toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small';
        btn.textContent = newEnabled ? 'Off' : 'On';

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
            currently_enabled: currentlyEnabled
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
            btn.className = currentlyEnabled ? 'btn-red toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small' : 'btn-green toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small';
            btn.textContent = currentlyEnabled ? 'Off' : 'On';
            alert('Error: ' + (data.message || 'Error al cambiar estado'));
          }
        })
        .catch(err => {
          // Revertir cambio optimista en caso de error de red
          btn.setAttribute('data-enabled', currentlyEnabled.toString());
          btn.className = currentlyEnabled ? 'btn-red toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small' : 'btn-green toggle-my-page-imap-btn ml-03 btn-imap-action btn-imap-small';
          btn.textContent = currentlyEnabled ? 'Off' : 'On';
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
            updateImapLimitInfo(currentCount, currentCount < MAX_LINKED_IMAP_FOR_USERS);
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
