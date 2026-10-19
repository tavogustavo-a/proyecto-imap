// app/static/js/edit_imap2_linked.js
// Maneja la funcionalidad de vincular/eliminar servidores IMAP en edit_imap2.html

(function() {
  'use strict';

  const linkedImapList = document.getElementById('linkedImapList');
  const createLinkedImapForm = document.getElementById('createLinkedImapForm');

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

  // Función para renderizar la lista de servidores IMAP vinculados
  function renderLinkedImapList(servers) {
    if (!linkedImapList) return;
    
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
      strongHost.textContent = 'Host: ' + (s.host || '');

      const strongUser = document.createElement('strong');
      strongUser.textContent = 'Usuario: ' + (s.username || '');

      const mainText = document.createDocumentFragment();
      mainText.appendChild(strongHost);
      mainText.appendChild(document.createTextNode(' | '));
      mainText.appendChild(strongUser);

      div.appendChild(mainText);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'mt-05';

      // Botón Probar
      const testForm = document.createElement('form');
      testForm.action = `/admin/test_imap/${s.id}`;
      testForm.method = 'POST';
      testForm.className = 'd-inline';
      
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
      toggleBtn.className = 'toggle-linked-imap-btn ml-03';
      toggleBtn.setAttribute('data-id', s.id);
      toggleBtn.setAttribute('data-enabled', s.enabled ? 'true' : 'false');
      paintStateSwitch(toggleBtn, !!s.enabled);
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-orange ml-03 edit-linked-imap-btn row-icon-btn';
      editBtn.setAttribute('data-url', `/admin/edit_imap/${s.id}`);
      editBtn.title = 'Editar';
      editBtn.setAttribute('aria-label', 'Editar');
      const editIcon = document.createElement('i');
      editIcon.className = 'fas fa-pen';
      editIcon.setAttribute('aria-hidden', 'true');
      editBtn.appendChild(editIcon);
      actionsDiv.appendChild(editBtn);

      // Botón Eliminar
      const unlinkBtn = document.createElement('button');
      unlinkBtn.type = 'button';
      unlinkBtn.className = 'btn-red unlink-imap-btn ml-03 btn-imap-action btn-imap-small';
      // Obtener imap2_id del formulario de creación
      const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';
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

      // Feedback visual
      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      // Guardar contenido original usando cloneNode (más seguro que innerHTML)
      const originalContent = submitBtn.cloneNode(true);
      submitBtn.textContent = 'Creando...';

      fetch(`/admin/imap2/${imap2Id}/create_and_link_imap`, {
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
          // Limpiar formulario
          createLinkedImapForm.reset();
          document.getElementById('linked_imap_port').value = '993';
          document.getElementById('linked_imap_folders').value = 'INBOX';
          
          // Actualizar lista de servidores vinculados
          renderLinkedImapList(data.servers);
        } else {
          alert('Error: ' + (data.message || 'Error al crear servidor'));
        }
      })
      .catch(err => {
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        submitBtn.disabled = false;
        // Restaurar contenido original desde el nodo clonado
        submitBtn.textContent = originalContent.textContent;
      });
    });
  }

  // Event listener para probar servidor IMAP (interceptar formulario)
  document.addEventListener('submit', function(e) {
    if (e.target.closest('form') && e.target.closest('form').action && e.target.closest('form').action.includes('/admin/test_imap/')) {
      e.preventDefault();
      const form = e.target.closest('form');
      const actionUrl = form.action;
      const serverIdMatch = actionUrl.match(/\/admin\/test_imap\/(\d+)/);
      
      if (!serverIdMatch) {
        alert('Error: No se pudo identificar el servidor.');
        return;
      }
      
      const serverId = parseInt(serverIdMatch[1]);
      const submitBtn = form.querySelector('button[type="submit"]');
      
      // Feedback visual
      if (submitBtn) {
        paintTestButtonBusy(submitBtn, true);

        fetch('/admin/test_imap_ajax', {
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
            alertImapTestResult(true, data.message || 'Conexión correcta.');
          } else {
            alertImapTestResult(false, data.message);
          }
        })
        .catch(() => {
          alertImapTestOffline();
        })
        .finally(() => {
          if (submitBtn) {
            paintTestButtonBusy(submitBtn, false);
          }
        });
      }
      return;
    }
  });

  // Event listener para eliminar servidor IMAP
  document.addEventListener('click', function(e) {
    if (e.target.closest('.unlink-imap-btn')) {
      e.preventDefault();
      const btn = e.target.closest('.unlink-imap-btn');
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
        }, 100);
      }

      // Feedback visual mínimo
      btn.disabled = true;
      btn.style.transition = 'none';

      fetch(`/admin/imap2/${imap2Id}/unlink_imap/${imapId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          // Recargar lista de servidores vinculados para asegurar sincronización
          const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';
          if (imap2Id) {
            fetch(`/admin/imap2/${imap2Id}/linked_imap_servers`)
              .then(res => res.json())
              .then(data => {
                if (data.status === 'ok') {
                  renderLinkedImapList(data.servers);
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
            if (linkedImapList && !linkedImapList.contains(imapItem)) {
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
          if (linkedImapList && !linkedImapList.contains(imapItem)) {
            linkedImapList.appendChild(imapItem);
          }
        }
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        btn.disabled = false;
      });
    }

    // Toggle On/Off para servidores IMAP vinculados
    if (e.target.closest('.toggle-linked-imap-btn')) {
      e.preventDefault();
      const btn = e.target.closest('.toggle-linked-imap-btn');
      const imapId = btn.getAttribute('data-id');
      const currentlyEnabled = btn.getAttribute('data-enabled') === 'true';
      const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';

      // Actualización optimista: cambiar el estado del botón inmediatamente
      const newEnabled = !currentlyEnabled;
      btn.setAttribute('data-enabled', newEnabled.toString());
      paintStateSwitch(btn, newEnabled);

      // Feedback visual mínimo
      btn.disabled = true;

      fetch('/admin/toggle_imap_ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
          server_id: parseInt(imapId),
          currently_enabled: currentlyEnabled
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          // Recargar lista
          if (imap2Id) {
            fetch(`/admin/imap2/${imap2Id}/linked_imap_servers`)
              .then(res => res.json())
              .then(data => {
                if (data.status === 'ok') {
                  renderLinkedImapList(data.servers);
                }
              })
              .catch(() => {
                // Si falla, no hacer nada, el estado ya está actualizado
              });
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

    if (e.target.closest('.edit-primary-imap2-btn')) {
      e.preventDefault();
      openPrimaryImap2Modal(e.target.closest('.edit-primary-imap2-btn'));
      return;
    }

    if (e.target.closest('#closeEditPrimaryImap2Modal') || e.target.closest('#cancelEditPrimaryImap2Modal')) {
      e.preventDefault();
      closePrimaryImap2Modal();
      return;
    }

    const primaryModal = document.getElementById('editPrimaryImap2Modal');
    if (primaryModal && e.target === primaryModal) {
      closePrimaryImap2Modal();
      return;
    }

    if (e.target.closest('.toggle-primary-imap2-btn')) {
      e.preventDefault();
      togglePrimaryImap2(e.target.closest('.toggle-primary-imap2-btn'));
      return;
    }

    // Editar servidor IMAP vinculado
    if (e.target.closest('.edit-linked-imap-btn')) {
      e.preventDefault();
      const btn = e.target.closest('.edit-linked-imap-btn');
      const url = btn.getAttribute('data-url');
      if (url) {
        window.location.href = url;
      }
    }
  });

  function openPrimaryImap2Modal(btn) {
    const modal = document.getElementById('editPrimaryImap2Modal');
    const form = document.getElementById('editPrimaryImap2Form');
    if (!modal || !form || !btn) return;
    form.setAttribute('data-server-id', btn.getAttribute('data-server-id') || '');
    document.getElementById('edit_primary_description').value = btn.getAttribute('data-description') || '';
    document.getElementById('edit_primary_host').value = btn.getAttribute('data-host') || '';
    document.getElementById('edit_primary_port').value = btn.getAttribute('data-port') || '993';
    document.getElementById('edit_primary_username').value = btn.getAttribute('data-username') || '';
    document.getElementById('edit_primary_password').value = '';
    document.getElementById('edit_primary_folders').value = btn.getAttribute('data-folders') || 'INBOX';
    document.getElementById('edit_primary_route').value = btn.getAttribute('data-route-path') || '';
    modal.classList.remove('d-none');
    const hostInput = document.getElementById('edit_primary_host');
    if (hostInput) hostInput.focus();
  }

  function closePrimaryImap2Modal() {
    const modal = document.getElementById('editPrimaryImap2Modal');
    if (modal) modal.classList.add('d-none');
  }

  function applyPrimaryImap2Row(server) {
    const hostLabel = document.getElementById('primaryImapHostLabel');
    const userLabel = document.getElementById('primaryImapUserLabel');
    const item = document.getElementById('primaryImapItem');
    const editBtn = document.querySelector('.edit-primary-imap2-btn');
    if (hostLabel) hostLabel.textContent = 'Host: ' + (server.host || '');
    if (userLabel) userLabel.textContent = 'Usuario: ' + (server.username || '');
    if (item) {
      item.setAttribute('data-host', (server.host || '').toLowerCase());
      item.setAttribute('data-username', (server.username || '').toLowerCase());
    }
    if (editBtn) {
      editBtn.setAttribute('data-host', server.host || '');
      editBtn.setAttribute('data-port', server.port != null ? String(server.port) : '993');
      editBtn.setAttribute('data-username', server.username || '');
      editBtn.setAttribute('data-folders', server.folders || 'INBOX');
      editBtn.setAttribute('data-description', server.description || '');
      editBtn.setAttribute('data-route-path', server.route_path || '');
    }
  }

  function togglePrimaryImap2(btn) {
    if (!btn) return;
    const serverId = btn.getAttribute('data-id');
    const currentlyEnabled = btn.getAttribute('data-enabled') === 'true';
    const newEnabled = !currentlyEnabled;
    btn.setAttribute('data-enabled', newEnabled.toString());
    paintStateSwitch(btn, newEnabled);
    btn.disabled = true;

    fetch('/admin/toggle_imap2_ajax', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: JSON.stringify({
        server_id: parseInt(serverId, 10),
        currently_enabled: currentlyEnabled
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status !== 'ok') {
        btn.setAttribute('data-enabled', currentlyEnabled.toString());
        paintStateSwitch(btn, currentlyEnabled);
        alert('Error: ' + (data.message || 'Error al cambiar estado'));
      }
    })
    .catch(err => {
      btn.setAttribute('data-enabled', currentlyEnabled.toString());
      paintStateSwitch(btn, currentlyEnabled);
      alert('Error de red: ' + err.message);
    })
    .finally(() => {
      btn.disabled = false;
    });
  }

  const editPrimaryImap2Form = document.getElementById('editPrimaryImap2Form');
  if (editPrimaryImap2Form) {
    editPrimaryImap2Form.addEventListener('submit', function(e) {
      e.preventDefault();
      const serverId = editPrimaryImap2Form.getAttribute('data-server-id');
      const host = document.getElementById('edit_primary_host').value.trim();
      const port = parseInt(document.getElementById('edit_primary_port').value, 10) || 993;
      const username = document.getElementById('edit_primary_username').value.trim();
      const password = document.getElementById('edit_primary_password').value;
      const folders = document.getElementById('edit_primary_folders').value.trim() || 'INBOX';
      const description = document.getElementById('edit_primary_description').value.trim();
      const routePath = document.getElementById('edit_primary_route').value.trim();
      if (!host || !username) {
        alert('Host y usuario son obligatorios.');
        return;
      }
      if (!routePath) {
        alert('La ruta es obligatoria.');
        return;
      }
      const submitBtn = editPrimaryImap2Form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      fetch('/admin/imap2/' + serverId + '/update_primary_imap', {
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
          folders: folders,
          description: description,
          route_path: routePath
        })
      })
      .then(res => res.json().then(data => ({ ok: res.ok, data: data })))
      .then(result => {
        if (result.data && result.data.status === 'ok') {
          applyPrimaryImap2Row(result.data.server || {});
          closePrimaryImap2Modal();
        } else {
          alert((result.data && result.data.message) || 'No se pudo guardar el servidor.');
        }
      })
      .catch(err => {
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        if (submitBtn) submitBtn.disabled = false;
      });
    });
  }

  document.addEventListener('submit', function(e) {
    const form = e.target.closest ? e.target.closest('form') : e.target;
    if (!form || !form.classList.contains('test-primary-imap2-form')) return;
    e.preventDefault();
    const serverId = form.getAttribute('data-server-id');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!serverId || !submitBtn) return;
    paintTestButtonBusy(submitBtn, true);
    fetch('/admin/test_imap2_ajax', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: JSON.stringify({ server_id: parseInt(serverId, 10) })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ok') {
        alertImapTestResult(true, data.message || 'Conexión correcta.');
      } else {
        alertImapTestResult(false, data.message);
      }
    })
    .catch(() => {
      alertImapTestOffline();
    })
    .finally(() => {
      paintTestButtonBusy(submitBtn, false);
    });
  });
})();
