// admin_gsheets_config.js

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('gsheets-config-form');
  const testBtn = document.getElementById('test-gsheets-connection');
  const statusDiv = document.getElementById('gsheets-status');
  const linksTableContainer = document.getElementById('gsheets-links-table-container');
  const editModal = document.getElementById('gsheets-edit-modal');
  const editForm = document.getElementById('gsheets-edit-form');
  const closeEditModalBtn = document.getElementById('close-edit-modal');

  function showStatus(msg, success=true) {
    statusDiv.innerHTML = `<div style="padding:10px;border-radius:6px;${success ? 'background:#e8f5e9;color:#256029;border:1.5px solid #43b843;' : 'background:#ffebee;color:#b71c1c;border:1.5px solid #e53935;'}">${msg}</div>`;
  }

  function showLoadingStatus(msg) {
    statusDiv.innerHTML = `<div style="padding:10px;border-radius:6px;background:#e3f2fd;color:#1565c0;border:1.5px solid #2196f3;"><i class="fas fa-spinner fa-spin"></i> ${msg}</div>`;
  }

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf_token"]').getAttribute('content');
  }

  function getTemplateDisplayName(templateType) {
    const names = {
      'hojas_de_calculo': 'Hojas de cálculo',
      'usuarios': 'Usuarios',
      'productos': 'Productos',
      'roles': 'Roles'
    };
    return names[templateType] || templateType;
  }

  function loadLinksTable() {
    showLoadingStatus('Cargando vinculaciones...');
    fetch('/tienda/admin/gsheets_links', {
      method: 'GET',
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        renderLinksTable(res.links);
        showStatus('Vinculaciones cargadas correctamente.', true);
      } else {
        showStatus(res.error || 'Error al cargar vinculaciones.', false);
      }
    })
    .catch(() => {
      showStatus('Error de red al cargar vinculaciones.', false);
    });
  }

  // Función para truncar IDs largos
  function truncateId(id, maxLength = 5) {
    if (!id || id.length <= maxLength) return id;
    return id.substring(0, maxLength) + '...';
  }

  function renderLinksTable(links) {
    if (links.length === 0) {
      linksTableContainer.innerHTML = '<p class="text-muted">No hay vinculaciones configuradas.</p>';
      return;
    }

    let tableHTML = `
      <div class="table-responsive gsheets-table-container" style="border: 1px solid #dee2e6; border-radius: 8px; overflow-x: auto; margin-bottom: 20px; max-width: 100%;">
        <table class="table table-striped table-hover mb-0" style="margin-bottom: 0; min-width: 600px;">
          <thead class="table-light">
            <tr>
              <th style="padding: 12px 15px; border-bottom: 2px solid #dee2e6;">Plantilla</th>
              <th style="padding: 12px 15px; border-bottom: 2px solid #dee2e6;">ID de Hoja</th>
              <th style="padding: 12px 15px; border-bottom: 2px solid #dee2e6;">Pestaña</th>
              <th style="padding: 12px 15px; border-bottom: 2px solid #dee2e6;">Acciones</th>
            </tr>
          </thead>
          <tbody>
    `;

    links.forEach(link => {
      tableHTML += `
        <tr data-link-id="${link.id}">
          <td style="padding: 12px 15px; vertical-align: middle;">${getTemplateDisplayName(link.template_type)}</td>
          <td style="padding: 12px 15px; vertical-align: middle;"><code style="background: #f8f9fa; padding: 4px 8px; border-radius: 4px; font-size: 0.9em;" title="${link.sheet_id}">${truncateId(link.sheet_id)}</code></td>
          <td style="padding: 12px 15px; vertical-align: middle;">${link.tab_name}</td>
          <td style="padding: 12px 15px; vertical-align: middle;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn-panel btn-blue btn-sm" onclick="testLinkConnection(${link.id})" title="Probar conexión">
                <i class="fas fa-plug"></i>
              </button>
              <button class="btn-orange" onclick="editLink(${link.id})" title="Editar">
                Editar
              </button>
              <button class="btn-panel btn-red btn-sm" onclick="deleteLink(${link.id})" title="Eliminar">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tableHTML += `
          </tbody>
        </table>
      </div>
    `;

    linksTableContainer.innerHTML = tableHTML;
  }

  // Nueva configuración
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    showLoadingStatus('Guardando nueva vinculación...');
    
    const formData = new FormData(form);
    fetch('/tienda/admin/gsheets_links', {
      method: 'POST',
      body: formData,
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        showStatus(res.message, true);
        form.reset();
        loadLinksTable(); 
      } else {
        showStatus(res.error || 'Error al guardar vinculación.', false);
      }
    })
    .catch(() => showStatus('Error de red al guardar vinculación.', false));
  });

  // Conexión general
  testBtn.addEventListener('click', function() {
    const credentialsJson = document.getElementById('gsheets-credentials-json').value;
    const sheetId = document.getElementById('gsheets-sheet-id').value;
    const tabName = document.getElementById('gsheets-tab-name').value;
    
    if (!credentialsJson.trim() || !sheetId.trim() || !tabName.trim()) {
      showStatus('Por favor completa todos los campos antes de probar la conexión.', false);
      return;
    }
    
    showLoadingStatus('Probando conexión con Google Sheets...');
    
    // Crear un objeto temporal para probar la conexión
    const testData = {
      gsheets_credentials_json: credentialsJson,
      gsheets_sheet_id: sheetId,
      gsheets_tab_name: tabName
    };
    
    fetch('/tienda/admin/gsheets_test_direct', {
      method: 'POST',
      headers: { 
        'X-CSRFToken': getCsrfToken(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        showStatus(res.message, true);
      } else {
        showStatus(res.error || 'Error al probar conexión.', false);
      }
    })
    .catch(() => showStatus('Error de red al probar conexión.', false));
  });

  // Funciones globales para los botones de la tabla
  window.testLinkConnection = function(linkId) {
    showLoadingStatus('Probando conexión de vinculación...');
    fetch(`/tienda/admin/gsheets_links/${linkId}/test`, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        showStatus(`Conexión exitosa: ${res.message}`, true);
      } else {
        showStatus(`Error de conexión: ${res.error}`, false);
      }
    })
    .catch(() => showStatus('Error de red al probar conexión.', false));
  };

  window.editLink = function(linkId) {
    // Link para editar
    fetch(`/tienda/admin/gsheets_links/${linkId}`, {
      method: 'GET',
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        const link = res.link;
        document.getElementById('edit-link-id').value = link.id;
        document.getElementById('edit-gsheets-template').value = link.template_type;
        document.getElementById('edit-gsheets-credentials-json').value = link.credentials_json;
        document.getElementById('edit-gsheets-sheet-id').value = link.sheet_id;
        document.getElementById('edit-gsheets-tab-name').value = link.tab_name;
        editModal.classList.remove('d-none');
      } else {
        showStatus(res.error || 'Error al cargar datos para editar.', false);
      }
    })
    .catch(() => showStatus('Error de red al cargar datos para editar.', false));
  };

  window.deleteLink = function(linkId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta vinculación?')) {
      return;
    }
    
    showLoadingStatus('Eliminando vinculación...');
    fetch(`/tienda/admin/gsheets_links/${linkId}`, {
      method: 'DELETE',
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        showStatus(res.message, true);
        loadLinksTable(); 
      } else {
        showStatus(res.error || 'Error al eliminar vinculación.', false);
      }
    })
    .catch(() => showStatus('Error de red al eliminar vinculación.', false));
  };

  // Cerrar modal
  closeEditModalBtn.addEventListener('click', function() {
    editModal.classList.add('d-none');
  });

  // Cerrar modal al hacer clic fuera de él
  editModal.addEventListener('click', function(e) {
    if (e.target === editModal) {
      editModal.classList.add('d-none');
    }
  });

  // En edición
  editForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const linkId = document.getElementById('edit-link-id').value;
    
    showLoadingStatus('Guardando cambios...');
    const formData = new FormData(editForm);
    
    fetch(`/tienda/admin/gsheets_links/${linkId}`, {
      method: 'PUT',
      body: formData,
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        showStatus(res.message, true);
        editModal.classList.add('d-none');
        loadLinksTable(); 
      } else {
        showStatus(res.error || 'Error al guardar cambios.', false);
      }
    })
    .catch(() => showStatus('Error de red al guardar cambios.', false));
  });

  // Botón Volver al Panel
  const btnVolverPanel = document.getElementById('btnVolverPanel');
  if (btnVolverPanel) {
    btnVolverPanel.addEventListener('click', function() {
      const url = this.getAttribute('data-url');
      if (url) {
        window.location.href = url;
      }
    });
  }

  // Inicio
  loadLinksTable();
}); 
