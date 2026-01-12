// app/static/js/edit_imap2_linked.js
// Maneja la funcionalidad de vincular/desvincular servidores IMAP en edit_imap2.html

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
      testBtn.className = 'btn-blue btn-imap-action btn-imap-small';
      testBtn.textContent = 'Probar';
      testForm.appendChild(testBtn);
      actionsDiv.appendChild(testForm);

      // Botón On/Off
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = s.enabled ? 'btn-red toggle-linked-imap-btn ml-03 btn-imap-action btn-imap-small' : 'btn-green toggle-linked-imap-btn ml-03 btn-imap-action btn-imap-small';
      toggleBtn.setAttribute('data-id', s.id);
      toggleBtn.setAttribute('data-enabled', s.enabled ? 'true' : 'false');
      toggleBtn.textContent = s.enabled ? 'Off' : 'On';
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-orange ml-03 edit-linked-imap-btn btn-imap-action btn-imap-small';
      editBtn.setAttribute('data-url', `/admin/edit_imap/${s.id}`);
      editBtn.textContent = 'Editar';
      actionsDiv.appendChild(editBtn);

      // Botón Desvincular
      const unlinkBtn = document.createElement('button');
      unlinkBtn.type = 'button';
      unlinkBtn.className = 'btn-red unlink-imap-btn ml-03 btn-imap-action btn-imap-small';
      // Obtener imap2_id del formulario de creación
      const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';
      unlinkBtn.setAttribute('data-imap2-id', imap2Id);
      unlinkBtn.setAttribute('data-imap-id', s.id);
      unlinkBtn.title = 'Desvincular';
      
      const icon = document.createElement('i');
      icon.className = 'fas fa-unlink';
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
        console.error('Error al crear servidor:', err);
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      });
    });
  }

  // Event listener para desvincular servidor IMAP
  document.addEventListener('click', function(e) {
    if (e.target.closest('.unlink-imap-btn')) {
      e.preventDefault();
      const btn = e.target.closest('.unlink-imap-btn');
      const imap2Id = btn.getAttribute('data-imap2-id');
      const imapId = btn.getAttribute('data-imap-id');
      
      if (!confirm('¿Deseas desvincular este servidor IMAP?')) {
        return;
      }

      // Feedback visual
      btn.disabled = true;
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

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
          // Recargar lista de servidores vinculados
          const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';
          if (imap2Id) {
            fetch(`/admin/imap2/${imap2Id}/linked_imap_servers`)
              .then(res => res.json())
              .then(data => {
                if (data.status === 'ok') {
                  renderLinkedImapList(data.servers);
                }
              });
          }
        } else {
          alert('Error: ' + (data.message || 'Error al desvincular servidor'));
        }
      })
      .catch(err => {
        console.error('Error al desvincular servidor:', err);
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
      });
    }

    // Toggle On/Off para servidores IMAP vinculados
    if (e.target.closest('.toggle-linked-imap-btn')) {
      e.preventDefault();
      const btn = e.target.closest('.toggle-linked-imap-btn');
      const imapId = btn.getAttribute('data-id');
      const currentlyEnabled = btn.getAttribute('data-enabled') === 'true';

      // Feedback visual
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

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
          const imap2Id = createLinkedImapForm ? createLinkedImapForm.querySelector('button[type="submit"]').getAttribute('data-imap2-id') : '';
          if (imap2Id) {
            fetch(`/admin/imap2/${imap2Id}/linked_imap_servers`)
              .then(res => res.json())
              .then(data => {
                if (data.status === 'ok') {
                  renderLinkedImapList(data.servers);
                }
              });
          }
        } else {
          alert('Error: ' + (data.message || 'Error al cambiar estado'));
        }
      })
      .catch(err => {
        console.error('Error al cambiar estado:', err);
        alert('Error de red: ' + err.message);
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      });
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
})();
