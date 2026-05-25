// Gestión de filtros automáticos de correo

// Función auxiliar para actualizar texto de ayuda
function updateHelperText(selectElement, helperElement) {
  if (!selectElement || !helperElement) return;
  
  const filterType = selectElement.value;
  let helpText = 'Los correos que coincidan con este criterio se procesarán automáticamente';
  
  switch(filterType) {
    case 'from_email':
      helpText = '📧 Ejemplo: "spam@", "noreply", "marketing" - Filtra por dirección del remitente';
      break;
    case 'to_email':
      helpText = '📨 Ejemplo: "info@", "support@" - Filtra por dirección del destinatario';
      break;
    case 'subject':
      helpText = '📝 Ejemplo: "PROMOCIÓN", "Factura", "Newsletter" - Filtra por palabras en el asunto';
      break;
    case 'content':
      helpText = '📄 Ejemplo: "descuento", "oferta", "click aquí" - Filtra por palabras en el contenido';
      break;
  }
  
  helperElement.textContent = helpText;
}

// Funciones para el modal de crear filtro
function openCreateFilterModal() {
  document.getElementById('createFilterModal').style.display = 'flex';
}

function closeCreateFilterModal() {
  document.getElementById('createFilterModal').style.display = 'none';
  // Limpiar formulario
  document.getElementById('createFilterForm').reset();
}

// Funciones para el modal de editar filtro
function openEditFilterModal(filterId, name, tagId, fromEmail, toEmail, subject, content) {
  const modal = document.getElementById('editFilterModal');
  const form = document.getElementById('editFilterForm');
  
  // Configurar la acción del formulario
  form.action = `/admin/email-buzon/update-filter/${filterId}`;
  
  // Determinar qué tipo de filtro es y su valor
  let filterType = '';
  let filterValue = '';
  
  if (fromEmail) {
    filterType = 'from_email';
    filterValue = fromEmail;
  } else if (toEmail) {
    filterType = 'to_email';
    filterValue = toEmail;
  } else if (subject) {
    filterType = 'subject';
    filterValue = subject;
  } else if (content) {
    filterType = 'content';
    filterValue = content;
  }
  
  // Llenar los campos con los datos actuales
  document.getElementById('editFilterName').value = name;
  
  // Para filtros huérfanos (sin etiqueta), no seleccionar nada
  const tagSelect = document.getElementById('editFilterTag');
  if (tagId && tagId !== '' && tagId !== 'null' && tagId !== 'None') {
    tagSelect.value = tagId;
  } else {
    tagSelect.value = ''; // Sin selección para filtros huérfanos
  }
  
  document.getElementById('editFilterType').value = filterType;
  document.getElementById('editFilterValue').value = filterValue;
  
  // Actualizar el texto de ayuda
  const editFilterHelperText = document.getElementById('editFilterHelperText');
  if (editFilterHelperText && filterType) {
    updateHelperText(document.getElementById('editFilterType'), editFilterHelperText);
  }
  
  modal.style.display = 'flex';
}

function closeEditFilterModal() {
  document.getElementById('editFilterModal').style.display = 'none';
}

function purgeOrphanFilters() {
  if (!confirm('¿Eliminar todos los filtros sin etiqueta válida (huérfanos)?')) {
    return;
  }
  const btn = document.getElementById('purgeOrphanFiltersBtn');
  if (btn) btn.disabled = true;

  fetch('/admin/email-buzon/purge-orphan-filters', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
    .then(response => response.json())
    .then(data => {
      if (btn) btn.disabled = false;
      alert(data.message || (data.success ? 'Listo' : 'Error'));
      if (data.success && data.deleted > 0) {
        location.reload();
      }
    })
    .catch(err => {
      if (btn) btn.disabled = false;
      console.error(err);
      alert('Error al limpiar filtros huérfanos');
    });
}

// Función para eliminar filtro vía AJAX
function deleteFilter(filterId) {
  if (confirm('¿Estás seguro de que quieres eliminar este filtro?')) {
    const filterRow = document.querySelector(`tr[data-filter-id="${filterId}"]`);
    
    fetch(`/admin/email-buzon/delete-filter/${filterId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Animar y remover la fila
        if (filterRow) {
          filterRow.style.transition = 'all 0.3s ease';
          filterRow.style.opacity = '0';
          filterRow.style.transform = 'translateX(-100%)';
          
          setTimeout(() => {
            filterRow.remove();
            
            // Verificar si quedan filtros
            const remainingRows = document.querySelectorAll('.filter-row');
            if (remainingRows.length === 0) {
              showNoFiltersMessage();
            }
          }, 300);
        }
      } else {
        showNotification('Error al eliminar el filtro: ' + data.message, 'error');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      showNotification('Error al eliminar el filtro', 'error');
    });
  }
}

// Función para activar/desactivar filtro vía AJAX
function toggleFilter(filterId) {
  const filterRow = document.querySelector(`tr[data-filter-id="${filterId}"]`);
  if (!filterRow) {
    return;
  }
  
  const toggleBtn = filterRow.querySelector('.btn-toggle');
  if (!toggleBtn) {
    return;
  }
  
  // Deshabilitar botón temporalmente
  toggleBtn.disabled = true;
  toggleBtn.style.opacity = '0.6';
  
  fetch(`/admin/email-buzon/toggle-filter/${filterId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // Actualizar el botón según el nuevo estado
      if (data.enabled) {
        // Filtro ahora está activo -> mostrar OFF (rojo)
        toggleBtn.className = 'btn btn-toggle btn-off btn-sm toggle-filter-btn';
        toggleBtn.textContent = 'OFF';
        toggleBtn.title = 'Filtro activo - Click para desactivar';
        toggleBtn.setAttribute('aria-label', `Desactivar filtro`);
        toggleBtn.dataset.filterId = filterId;
      } else {
        // Filtro ahora está inactivo -> mostrar ON (verde)
        toggleBtn.className = 'btn btn-toggle btn-on btn-sm toggle-filter-btn';
        toggleBtn.textContent = 'ON';
        toggleBtn.title = 'Filtro inactivo - Click para activar';
        toggleBtn.setAttribute('aria-label', `Activar filtro`);
        toggleBtn.dataset.filterId = filterId;
      }
      
    } else {
      alert('Error al cambiar estado del filtro: ' + data.message);
    }
  })
  .catch(error => {
    alert('Error de conexión al cambiar estado del filtro');
  })
  .finally(() => {
    // Rehabilitar el botón
    toggleBtn.disabled = false;
    toggleBtn.style.opacity = '1';
  });
}

// Función para mostrar mensaje cuando no hay filtros
function showNoFiltersMessage() {
  const tableContainer = document.querySelector('.filters-table-container');
  if (tableContainer) {
    tableContainer.innerHTML = `
      <div class="no-filters-message">
        <p><i class="fas fa-info-circle"></i> No hay filtros configurados</p>
        <p>Los filtros automáticos permiten que los correos se clasifiquen automáticamente en etiquetas según criterios específicos.</p>
      </div>
    `;
  }
}

// Función para mostrar notificaciones
function showNotification(message, type) {
  // Crear elemento de notificación
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
    ${message}
  `;
  
  // Agregar estilos
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#2ecc71' : '#e74c3c'};
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  // Agregar al DOM
  document.body.appendChild(notification);
  
  // Remover después de 3 segundos
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

// Validación del formulario de crear filtro
function validateCreateFilterForm() {
  const fromEmail = document.getElementById('createFilterFromEmail').value.trim();
  const toEmail = document.getElementById('createFilterToEmail').value.trim();
  const subject = document.getElementById('createFilterSubject').value.trim();
  const content = document.getElementById('createFilterContent').value.trim();
  
  if (!fromEmail && !toEmail && !subject && !content) {
    alert('Debes especificar al menos una condición para el filtro.');
    return false;
  }
  
  return true;
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Aplicar colores dinámicos a las etiquetas de filtros
  document.querySelectorAll('.filter-tag[data-tag-color]').forEach(function(tag) {
    const color = tag.getAttribute('data-tag-color');
    if (color) {
      tag.style.backgroundColor = color;
    }
  });
  // Botones de cerrar modales
  const closeCreateFilterBtn = document.getElementById('closeCreateFilterModal');
  const cancelCreateFilterBtn = document.getElementById('cancelCreateFilterModal');
  const closeEditFilterBtn = document.getElementById('closeEditFilterModal');
  
  if (closeCreateFilterBtn) {
    closeCreateFilterBtn.addEventListener('click', closeCreateFilterModal);
  }
  
  if (cancelCreateFilterBtn) {
    cancelCreateFilterBtn.addEventListener('click', closeCreateFilterModal);
  }
  
  if (closeEditFilterBtn) {
    closeEditFilterBtn.addEventListener('click', closeEditFilterModal);
  }
  
  
  // Cambio dinámico del texto de ayuda según el tipo de filtro
  const createFilterType = document.getElementById('createFilterType');
  const editFilterType = document.getElementById('editFilterType');
  const createHelperText = document.getElementById('createHelperText');
  const editHelperText = document.getElementById('editHelperText');
  
  
  if (createFilterType) {
    createFilterType.addEventListener('change', function() {
      updateHelperText(this, createHelperText);
    });
    // Inicializar texto de ayuda
    updateHelperText(createFilterType, createHelperText);
  }
  
  if (editFilterType) {
    editFilterType.addEventListener('change', function() {
      updateHelperText(this, editHelperText);
    });
  }
  
  // Validación del formulario de crear filtro
  const createFilterForm = document.getElementById('createFilterForm');
  if (createFilterForm) {
    createFilterForm.addEventListener('submit', function(e) {
      if (!validateCreateFilterForm()) {
        e.preventDefault();
      }
    });
  }
  
  // Cerrar modales al hacer clic fuera de ellos
  const modals = document.querySelectorAll('.edit-modal');
  modals.forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  });
  
  // Event listeners para remitentes bloqueados
  const closeCreateBlockedSenderBtn = document.getElementById('closeCreateBlockedSenderModal');
  const closeEditBlockedSenderBtn = document.getElementById('closeEditBlockedSenderModal');
  
  if (closeCreateBlockedSenderBtn) {
    closeCreateBlockedSenderBtn.addEventListener('click', closeCreateBlockedSenderModal);
  }
  if (closeEditBlockedSenderBtn) {
    closeEditBlockedSenderBtn.addEventListener('click', closeEditBlockedSenderModal);
  }
  
  // Event listeners para botones con data attributes
  document.addEventListener('click', function(e) {
    if (e.target.closest('.edit-filter-btn')) {
      const btn = e.target.closest('.edit-filter-btn');
      const filterId = btn.dataset.filterId;
      const name = btn.dataset.filterName;
      const tagId = btn.dataset.filterTagId;
      const fromEmail = btn.dataset.filterFromEmail;
      const toEmail = btn.dataset.filterToEmail;
      const subject = btn.dataset.filterSubject;
      const content = btn.dataset.filterContent;
      
      openEditFilterModal(filterId, name, tagId, fromEmail, toEmail, subject, content);
    }
    
    if (e.target.closest('.toggle-filter-btn')) {
      const btn = e.target.closest('.toggle-filter-btn');
      const filterId = btn.dataset.filterId;
      toggleFilter(filterId);
    }
    
    if (e.target.closest('.delete-filter-btn')) {
      const btn = e.target.closest('.delete-filter-btn');
      const filterId = btn.dataset.filterId;
      deleteFilter(filterId);
    }
    
    if (e.target.closest('.edit-blocked-sender-btn')) {
      const btn = e.target.closest('.edit-blocked-sender-btn');
      const senderId = btn.dataset.senderId;
      const senderEmail = btn.dataset.senderEmail;
      const senderDomain = btn.dataset.senderDomain;
      
      openEditBlockedSenderModal(senderId, senderEmail, senderDomain);
    }
    
    if (e.target.closest('.toggle-blocked-sender-btn')) {
      const btn = e.target.closest('.toggle-blocked-sender-btn');
      const senderId = btn.dataset.senderId;
      toggleBlockedSender(senderId);
    }
    
    if (e.target.closest('.delete-blocked-sender-btn')) {
      const btn = e.target.closest('.delete-blocked-sender-btn');
      const senderId = btn.dataset.senderId;
      deleteBlockedSender(senderId);
    }
  });
});

// =============== FUNCIONES PARA REMITENTES BLOQUEADOS ===============

function openCreateBlockedSenderModal() {
  const modal = document.getElementById('createBlockedSenderModal');
  
  // Mostrar modal y actualizar aria-hidden
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  
  // Focus en el primer campo después de un pequeño delay
  setTimeout(() => {
    document.getElementById('createSenderEmail').focus();
  }, 100);
  
  // Configurar validación de campos mutuamente excluyentes
  setupMutuallyExclusiveFields('createSenderEmail', 'createSenderDomain');
}

function closeCreateBlockedSenderModal() {
  const modal = document.getElementById('createBlockedSenderModal');
  
  // Ocultar modal y actualizar aria-hidden
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  
  // Resetear formulario
  document.getElementById('createBlockedSenderForm').reset();
}

function openEditBlockedSenderModal(senderId, senderEmail, senderDomain) {
  const modal = document.getElementById('editBlockedSenderModal');
  const form = document.getElementById('editBlockedSenderForm');
  const emailInput = document.getElementById('editSenderEmail');
  const domainInput = document.getElementById('editSenderDomain');
  const emailGroup = emailInput.closest('.edit-form-group');
  const domainGroup = domainInput.closest('.edit-form-group');
  
  // Configurar la acción del formulario
  form.action = `/admin/email-buzon/update-blocked-sender/${senderId}`;
  
  // Limpiar campos
  emailInput.value = '';
  domainInput.value = '';
  
  // Mostrar solo el campo relevante según el tipo guardado
  if (senderEmail && senderEmail.trim() !== '') {
    // Es un email específico
    emailInput.value = senderEmail;
    emailGroup.style.display = 'block';
    domainGroup.style.display = 'none';
  } else if (senderDomain && senderDomain.trim() !== '') {
    // Es un dominio
    domainInput.value = senderDomain;
    emailGroup.style.display = 'none';
    domainGroup.style.display = 'block';
  } else {
    // Caso por defecto: mostrar ambos
    emailGroup.style.display = 'block';
    domainGroup.style.display = 'block';
  }
  
  // Mostrar modal y actualizar aria-hidden
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  
  // Focus después de un pequeño delay en el campo visible
  setTimeout(() => {
    if (senderEmail && senderEmail.trim() !== '') {
      emailInput.focus();
    } else if (senderDomain && senderDomain.trim() !== '') {
      domainInput.focus();
    } else {
      emailInput.focus();
    }
  }, 100);
  
  // Configurar validación de campos mutuamente excluyentes solo si ambos están visibles
  if (emailGroup.style.display === 'block' && domainGroup.style.display === 'block') {
    setupMutuallyExclusiveFields('editSenderEmail', 'editSenderDomain');
  }
}

function closeEditBlockedSenderModal() {
  const modal = document.getElementById('editBlockedSenderModal');
  const emailGroup = document.getElementById('editSenderEmail').closest('.edit-form-group');
  const domainGroup = document.getElementById('editSenderDomain').closest('.edit-form-group');
  
  // Ocultar modal y actualizar aria-hidden
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  
  // Restaurar visibilidad de ambos campos para el próximo uso
  emailGroup.style.display = 'block';
  domainGroup.style.display = 'block';
  
  // Resetear formulario
  document.getElementById('editBlockedSenderForm').reset();
}

function deleteBlockedSender(senderId) {
  if (confirm('¿Estás seguro de que quieres desbloquear este remitente?')) {
    const senderRow = document.querySelector(`tr[data-sender-id="${senderId}"]`);
    
    fetch(`/admin/email-buzon/delete-blocked-sender/${senderId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Animar y remover la fila
        if (senderRow) {
          senderRow.style.transition = 'all 0.3s ease';
          senderRow.style.opacity = '0';
          senderRow.style.transform = 'translateX(-100%)';
          
          setTimeout(() => {
            senderRow.remove();
            
            // Verificar si quedan remitentes bloqueados
            const remainingRows = document.querySelectorAll('tr[data-sender-id]');
            if (remainingRows.length === 0) {
              showNoBlockedSendersMessage();
            }
          }, 300);
        }
      } else {
        showNotification('Error al desbloquear remitente: ' + data.message, 'error');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      showNotification('Error al desbloquear remitente', 'error');
    });
  }
}

function toggleBlockedSender(senderId) {
  const senderRow = document.querySelector(`tr[data-sender-id="${senderId}"]`);
  if (!senderRow) {
    return;
  }
  
  const toggleBtn = senderRow.querySelector('.btn-toggle');
  if (!toggleBtn) {
    return;
  }
  
  // Deshabilitar el botón temporalmente
  toggleBtn.disabled = true;
  toggleBtn.style.opacity = '0.6';
  
  fetch(`/admin/email-buzon/toggle-blocked-sender/${senderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // Actualizar el botón según el nuevo estado
      if (data.enabled) {
        toggleBtn.className = 'btn btn-toggle btn-off toggle-blocked-sender-btn';
        toggleBtn.textContent = 'OFF';
        toggleBtn.title = 'Remitente bloqueado - Click para desbloquear';
        toggleBtn.setAttribute('aria-label', `Desbloquear remitente`);
        toggleBtn.dataset.senderId = senderId;
      } else {
        toggleBtn.className = 'btn btn-toggle btn-on toggle-blocked-sender-btn';
        toggleBtn.textContent = 'ON';
        toggleBtn.title = 'Remitente desbloqueado - Click para bloquear';
        toggleBtn.setAttribute('aria-label', `Bloquear remitente`);
        toggleBtn.dataset.senderId = senderId;
      }
      
    } else {
      alert('Error al cambiar estado del remitente: ' + data.message);
    }
  })
  .catch(error => {
    alert('Error de conexión al cambiar estado del remitente');
  })
  .finally(() => {
    // Rehabilitar el botón
    toggleBtn.disabled = false;
    toggleBtn.style.opacity = '1';
  });
}

function showNoBlockedSendersMessage() {
  const tableContainer = document.querySelector('.blocked-senders-section .filters-table-container');
  if (tableContainer) {
    tableContainer.innerHTML = `
      <div class="no-filters-message">
        <p><i class="fas fa-info-circle"></i> No hay remitentes bloqueados</p>
        <p>Los remitentes bloqueados no podrán enviar correos que lleguen a tu buzón.</p>
      </div>
    `;
  }
}

// =============== VALIDACIÓN DE CAMPOS MUTUAMENTE EXCLUYENTES ===============

function setupMutuallyExclusiveFields(emailFieldId, domainFieldId) {
  const emailField = document.getElementById(emailFieldId);
  const domainField = document.getElementById(domainFieldId);
  
  if (!emailField || !domainField) return;
  
  // Función para limpiar el otro campo cuando se escribe en uno
  function clearOtherField(activeField, otherField) {
    activeField.addEventListener('input', function() {
      if (this.value.trim() !== '') {
        otherField.value = '';
        otherField.style.backgroundColor = '#f5f5f5';
        otherField.disabled = true;
        otherField.placeholder = 'Deshabilitado (ya seleccionaste ' + (activeField === emailField ? 'email' : 'dominio') + ')';
      } else {
        otherField.disabled = false;
        otherField.style.backgroundColor = '';
        otherField.placeholder = activeField === emailField ? 'yahoo.com' : 'ejemplo@dominio.com';
      }
    });
  }
  
  // Configurar ambos campos
  clearOtherField(emailField, domainField);
  clearOtherField(domainField, emailField);
  
  // Validación al enviar el formulario
  const form = emailField.closest('form');
  if (form) {
    form.addEventListener('submit', function(e) {
      const emailValue = emailField.value.trim();
      const domainValue = domainField.value.trim();
      
      // Verificar que al menos uno esté lleno
      if (!emailValue && !domainValue) {
        e.preventDefault();
        alert('Debe especificar al menos un email específico o un dominio completo');
        return false;
      }
      
      // Verificar que no estén ambos llenos (por seguridad)
      if (emailValue && domainValue) {
        e.preventDefault();
        alert('Solo puede especificar un email específico O un dominio completo, no ambos');
        return false;
      }
      
      return true;
    });
  }
}

// =============== FUNCIONALIDAD DE BÚSQUEDA Y PAGINACIÓN ===============

// Variables globales para paginación
let currentFilterPage = 1;
let currentBlockedPage = 1;
let filtersPerPage = 10;
let blockedPerPage = 10;

// Función para filtrar tabla de filtros
function filterFiltersTable() {
  const searchTerm = document.getElementById('searchFilterInput').value.toLowerCase();
  const table = document.getElementById('filters-table');
  if (!table) return;
  
  const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');
  let visibleRows = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const filterName = row.querySelector('.filter-name strong').textContent.toLowerCase();
    const conditionElement = row.querySelector('.condition-badge');
    const conditionText = conditionElement ? conditionElement.textContent.toLowerCase() : '';
    
    // Buscar en cualquier elemento de destino (filter-tag, filter-tag-trash, filter-tag-orphan)
    const destinationElement = row.querySelector('.filter-destination span');
    const destinationText = destinationElement ? destinationElement.textContent.toLowerCase() : '';
    
    if (filterName.includes(searchTerm) || 
        conditionText.includes(searchTerm) || 
        destinationText.includes(searchTerm)) {
      visibleRows.push(row);
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  }
  
  // Aplicar paginación a las filas visibles
  paginateFilterRows(visibleRows);
}

// Función para filtrar tabla de remitentes bloqueados
function filterBlockedSendersTable() {
  const searchTerm = document.getElementById('searchBlockedInput').value.toLowerCase();
  const table = document.getElementById('blocked-senders-table');
  if (!table) return;
  
  const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');
  let visibleRows = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const senderText = row.querySelector('.sender-email strong').textContent.toLowerCase();
    
    if (senderText.includes(searchTerm)) {
      visibleRows.push(row);
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  }
  
  // Aplicar paginación a las filas visibles
  paginateBlockedRows(visibleRows);
}

// Función para paginar filas de filtros
function paginateFilterRows(visibleRows) {
  const showCount = document.getElementById('showFilterCount').value;
  
  if (showCount === 'all') {
    visibleRows.forEach(row => row.style.display = '');
    updateFilterPaginationButtons(1, 1);
    return;
  }
  
  filtersPerPage = parseInt(showCount);
  const totalPages = Math.ceil(visibleRows.length / filtersPerPage);
  
  // Ajustar página actual si es necesario
  if (currentFilterPage > totalPages) {
    currentFilterPage = Math.max(1, totalPages);
  }
  
  const startIndex = (currentFilterPage - 1) * filtersPerPage;
  const endIndex = startIndex + filtersPerPage;
  
  visibleRows.forEach((row, index) => {
    if (index >= startIndex && index < endIndex) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
  
  updateFilterPaginationButtons(currentFilterPage, totalPages);
}

// Función para paginar filas de remitentes bloqueados
function paginateBlockedRows(visibleRows) {
  const showCount = document.getElementById('showBlockedCount').value;
  
  if (showCount === 'all') {
    visibleRows.forEach(row => row.style.display = '');
    updateBlockedPaginationButtons(1, 1);
    return;
  }
  
  blockedPerPage = parseInt(showCount);
  const totalPages = Math.ceil(visibleRows.length / blockedPerPage);
  
  // Ajustar página actual si es necesario
  if (currentBlockedPage > totalPages) {
    currentBlockedPage = Math.max(1, totalPages);
  }
  
  const startIndex = (currentBlockedPage - 1) * blockedPerPage;
  const endIndex = startIndex + blockedPerPage;
  
  visibleRows.forEach((row, index) => {
    if (index >= startIndex && index < endIndex) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
  
  updateBlockedPaginationButtons(currentBlockedPage, totalPages);
}

// Función para limpiar búsqueda de filtros
function clearFilterSearch() {
  document.getElementById('searchFilterInput').value = '';
  filterFiltersTable();
}

// Función para limpiar búsqueda de remitentes bloqueados
function clearBlockedSearch() {
  document.getElementById('searchBlockedInput').value = '';
  filterBlockedSendersTable();
}

// Función para actualizar botones de paginación de filtros
function updateFilterPaginationButtons(currentPage, totalPages) {
  const prevBtn = document.getElementById('prevFilterPageBtn');
  const nextBtn = document.getElementById('nextFilterPageBtn');
  
  if (prevBtn && nextBtn) {
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages || totalPages === 0;
    
    // Mostrar/ocultar botones según si hay más de una página
    const paginationContainer = prevBtn.parentElement;
    if (totalPages <= 1) {
      paginationContainer.style.display = 'none';
    } else {
      paginationContainer.style.display = 'flex';
    }
  }
}

// Función para actualizar botones de paginación de remitentes bloqueados
function updateBlockedPaginationButtons(currentPage, totalPages) {
  const prevBtn = document.getElementById('prevBlockedPageBtn');
  const nextBtn = document.getElementById('nextBlockedPageBtn');
  
  if (prevBtn && nextBtn) {
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages || totalPages === 0;
    
    // Mostrar/ocultar botones según si hay más de una página
    const paginationContainer = prevBtn.parentElement;
    if (totalPages <= 1) {
      paginationContainer.style.display = 'none';
    } else {
      paginationContainer.style.display = 'flex';
    }
  }
}

// Event listeners para búsqueda y paginación
document.addEventListener('DOMContentLoaded', function() {
  // Búsqueda de filtros
  const searchFilterInput = document.getElementById('searchFilterInput');
  if (searchFilterInput) {
    searchFilterInput.addEventListener('input', filterFiltersTable);
    
    // Agregar botón X para limpiar
    searchFilterInput.addEventListener('input', function() {
      const container = this.parentElement;
      let clearBtn = container.querySelector('.search-clear-btn');
      
      if (this.value.length > 0 && !clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'search-clear-btn';
        clearBtn.innerHTML = '×';
        clearBtn.title = 'Limpiar búsqueda';
        clearBtn.addEventListener('click', clearFilterSearch);
        container.appendChild(clearBtn);
      } else if (this.value.length === 0 && clearBtn) {
        clearBtn.remove();
      }
    });
  }
  
  // Búsqueda de remitentes bloqueados
  const searchBlockedInput = document.getElementById('searchBlockedInput');
  if (searchBlockedInput) {
    searchBlockedInput.addEventListener('input', filterBlockedSendersTable);
    
    // Agregar botón X para limpiar
    searchBlockedInput.addEventListener('input', function() {
      const container = this.parentElement;
      let clearBtn = container.querySelector('.search-clear-btn');
      
      if (this.value.length > 0 && !clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'search-clear-btn';
        clearBtn.innerHTML = '×';
        clearBtn.title = 'Limpiar búsqueda';
        clearBtn.addEventListener('click', clearBlockedSearch);
        container.appendChild(clearBtn);
      } else if (this.value.length === 0 && clearBtn) {
        clearBtn.remove();
      }
    });
  }
  
  // Selector de cantidad de filtros
  const showFilterCount = document.getElementById('showFilterCount');
  if (showFilterCount) {
    showFilterCount.addEventListener('change', function() {
      currentFilterPage = 1; // Resetear a la primera página
      filterFiltersTable();
    });
  }
  
  // Selector de cantidad de remitentes bloqueados
  const showBlockedCount = document.getElementById('showBlockedCount');
  if (showBlockedCount) {
    showBlockedCount.addEventListener('change', function() {
      currentBlockedPage = 1; // Resetear a la primera página
      filterBlockedSendersTable();
    });
  }
  
  // Botones de paginación para filtros
  const prevFilterPageBtn = document.getElementById('prevFilterPageBtn');
  const nextFilterPageBtn = document.getElementById('nextFilterPageBtn');
  
  if (prevFilterPageBtn) {
    prevFilterPageBtn.addEventListener('click', function() {
      if (currentFilterPage > 1) {
        currentFilterPage--;
        filterFiltersTable();
      }
    });
  }
  
  if (nextFilterPageBtn) {
    nextFilterPageBtn.addEventListener('click', function() {
      const searchTerm = document.getElementById('searchFilterInput').value.toLowerCase();
      const table = document.getElementById('filters-table');
      if (!table) return;
      
      const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');
      let visibleRows = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const filterName = row.querySelector('.filter-name strong').textContent.toLowerCase();
        const conditionElement = row.querySelector('.condition-badge');
        const conditionText = conditionElement ? conditionElement.textContent.toLowerCase() : '';
        
        // Buscar en cualquier elemento de destino (filter-tag, filter-tag-trash, filter-tag-orphan)
        const destinationElement = row.querySelector('.filter-destination span');
        const destinationText = destinationElement ? destinationElement.textContent.toLowerCase() : '';
        
        if (filterName.includes(searchTerm) || 
            conditionText.includes(searchTerm) || 
            destinationText.includes(searchTerm)) {
          visibleRows.push(row);
        }
      }
      
      const showCount = document.getElementById('showFilterCount').value;
      if (showCount !== 'all') {
        const totalPages = Math.ceil(visibleRows.length / parseInt(showCount));
        if (currentFilterPage < totalPages) {
          currentFilterPage++;
          filterFiltersTable();
        }
      }
    });
  }
  
  // Botones de paginación para remitentes bloqueados
  const prevBlockedPageBtn = document.getElementById('prevBlockedPageBtn');
  const nextBlockedPageBtn = document.getElementById('nextBlockedPageBtn');
  
  if (prevBlockedPageBtn) {
    prevBlockedPageBtn.addEventListener('click', function() {
      if (currentBlockedPage > 1) {
        currentBlockedPage--;
        filterBlockedSendersTable();
      }
    });
  }
  
  if (nextBlockedPageBtn) {
    nextBlockedPageBtn.addEventListener('click', function() {
      const searchTerm = document.getElementById('searchBlockedInput').value.toLowerCase();
      const table = document.getElementById('blocked-senders-table');
      if (!table) return;
      
      const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');
      let visibleRows = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const senderText = row.querySelector('.sender-email strong').textContent.toLowerCase();
        
        if (senderText.includes(searchTerm)) {
          visibleRows.push(row);
        }
      }
      
      const showCount = document.getElementById('showBlockedCount').value;
      if (showCount !== 'all') {
        const totalPages = Math.ceil(visibleRows.length / parseInt(showCount));
        if (currentBlockedPage < totalPages) {
          currentBlockedPage++;
          filterBlockedSendersTable();
        }
      }
    });
  }
  
  // Aplicar filtros iniciales
  setTimeout(() => {
    filterFiltersTable();
    filterBlockedSendersTable();
  }, 100);

  // Event listeners para data attributes
  const purgeOrphanBtn = document.getElementById('purgeOrphanFiltersBtn');
  if (purgeOrphanBtn) {
    purgeOrphanBtn.addEventListener('click', purgeOrphanFilters);
  }

  // Botón de crear filtro
  document.querySelectorAll('[data-action="create-filter"]').forEach(button => {
    button.addEventListener('click', function() {
      openCreateFilterModal();
    });
  });

  // Botón de crear remitente bloqueado
  document.querySelectorAll('[data-action="create-blocked-sender"]').forEach(button => {
    button.addEventListener('click', function() {
      openCreateBlockedSenderModal();
    });
  });
});
