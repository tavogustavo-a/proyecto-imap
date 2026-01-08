// Variables globales para el modal de ver email
let currentEmailId = null;

// Variable global para el menú contextual
let contextMenuEmailId = null;
let contextMenu = null;

// Funciones para el buzón de mensajes
function viewEmail(emailId) {
  currentEmailId = emailId;
  
  fetch(`/admin/email-buzon/view/${emailId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        const email = data.email;
        
        // Llenar los campos del modal con escape HTML seguro
        document.getElementById('emailFrom').textContent = email.from_email || '';
        document.getElementById('emailTo').textContent = email.to_email || '';
        document.getElementById('emailSubject').textContent = email.subject || '(Sin asunto)';
        document.getElementById('emailDate').textContent = email.received_at || '';
        
        // Mostrar etiquetas si las hay
        const tagsContainer = document.getElementById('emailTagsContainer');
        const tagsDiv = document.getElementById('emailTags');
        if (email.tags && email.tags.length > 0) {
          tagsDiv.innerHTML = email.tags.map(tag => {
            const tagName = escapeHtml(tag.name);
            const tagColor = escapeHtml(tag.color);
            return `<span class="email-tag" data-color="${tagColor}">${tagName}</span>`;
          }).join('');
          tagsContainer.style.display = 'block';
        } else {
          tagsContainer.style.display = 'none';
        }
        
        // Llenar contenido de texto
        const textContent = email.content_text || 'Sin contenido de texto';
        document.getElementById('emailContentText').textContent = textContent;
        
        // Mostrar pestaña HTML si hay contenido HTML
        const htmlTabBtn = document.getElementById('htmlTabBtn');
        const htmlContent = document.getElementById('emailContentHtml');
        if (email.content_html && email.content_html.trim()) {
          htmlTabBtn.style.display = 'block';
          htmlContent.innerHTML = email.content_html;
        } else {
          htmlTabBtn.style.display = 'none';
        }
        
        // Configurar botones según el estado del email
        const markProcessedBtn = document.getElementById('markProcessedBtn');
        const moveToTrashBtn = document.getElementById('moveToTrashBtn');
        
        if (email.processed) {
          markProcessedBtn.style.display = 'none';
        } else {
          markProcessedBtn.style.display = 'inline-block';
        }
        
        if (email.deleted) {
          moveToTrashBtn.innerHTML = '<i class="fas fa-undo"></i> Restaurar';
          moveToTrashBtn.onclick = () => restoreEmailFromTrash();
          
          // Mostrar botón de eliminar permanentemente
          const deletePermanentBtn = document.getElementById('deletePermanentBtn');
          deletePermanentBtn.classList.remove('hidden');
        } else {
          moveToTrashBtn.innerHTML = '<i class="fas fa-trash"></i> Mover a Papelera';
          moveToTrashBtn.onclick = () => moveEmailToTrash();
          
          // Ocultar botón de eliminar permanentemente
          const deletePermanentBtn = document.getElementById('deletePermanentBtn');
          deletePermanentBtn.classList.add('hidden');
        }
        
        // Mostrar modal
        showElement('viewEmailModal');
        
        // Aplicar colores dinámicos a las etiquetas
        applyDynamicColors();
        
        // MARCAR COMO LEÍDO AUTOMÁTICAMENTE AL ABRIR
        markEmailAsReadWhenViewed(emailId);
      } else {
        alert('Error cargando email: ' + (data.error || 'Error desconocido'));
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Error cargando email: ' + error.message);
    });
}

// Función para marcar email como leído automáticamente al verlo
function markEmailAsReadWhenViewed(emailId) {
  fetch(`/admin/email-buzon/mark-processed/${emailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // Actualizar visualmente el email como leído
      const emailItem = document.querySelector(`[data-email-id="${emailId}"]`);
      if (emailItem) {
        emailItem.classList.remove('unread');
        console.log(`Email ${emailId} marcado como leído automáticamente`);
      }
    }
  })
  .catch(error => {
    console.error('Error marcando email como leído:', error);
  });
}

// Funciones para el menú contextual
function showContextMenu(event, emailId) {
  event.preventDefault();
  
  contextMenuEmailId = emailId;
  contextMenu = document.getElementById('contextMenu');
  
  if (!contextMenu) {
    return;
  }
  
  // Posicionar el menú en la posición del cursor
  const x = event.pageX;
  const y = event.pageY;
  
  // Asegurar que el menú no se salga de la pantalla
  const menuWidth = 180;
  const menuHeight = 300; // Altura aproximada
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let finalX = x;
  let finalY = y;
  
  if (x + menuWidth > windowWidth) {
    finalX = x - menuWidth;
  }
  
  if (y + menuHeight > windowHeight) {
    finalY = y - menuHeight;
  }
  
  contextMenu.style.left = finalX + 'px';
  contextMenu.style.top = finalY + 'px';
  
  // Mostrar el menú
  contextMenu.classList.remove('hidden');
  
  // Actualizar texto del botón "Eliminar" según el contexto
  const currentUrl = window.location.pathname;
  const isInTrashPage = currentUrl.includes('/trash');
  const contextDeleteText = document.getElementById('contextDeleteText');
  const contextDeleteIcon = document.querySelector('#contextDeleteItem i');
  
  if (isInTrashPage) {
    if (contextDeleteText) contextDeleteText.textContent = 'Eliminar Permanentemente';
    if (contextDeleteIcon) contextDeleteIcon.className = 'fas fa-times-circle';
  } else {
    if (contextDeleteText) contextDeleteText.textContent = 'Eliminar';
    if (contextDeleteIcon) contextDeleteIcon.className = 'fas fa-trash';
  }
  
  // Aplicar colores dinámicos a las etiquetas del menú
  applyDynamicColors();
  
  // Agregar event listener para cerrar al hacer clic fuera
  document.addEventListener('click', hideContextMenu);
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.classList.add('hidden');
    document.removeEventListener('click', hideContextMenu);
  }
}

// Funciones para las acciones del menú contextual
function contextReply() {
  if (!contextMenuEmailId) return;
  
  // Obtener los datos del email actual
  fetch(`/admin/email-buzon/view/${contextMenuEmailId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      const email = data.email;
      
      // Llenar el modal de respuesta
      document.getElementById('replyEmailId').value = contextMenuEmailId;
      document.getElementById('replyTo').value = email.from_email;
      document.getElementById('replySubject').value = `Re: ${email.subject}`;
      
      // Limpiar campos editables
      document.getElementById('replyFrom').value = '';
      document.getElementById('replyMessage').value = '';
      
      // Mostrar modal
      showElement('replyEmailModal');
    } else {
      alert('Error cargando datos del email para responder');
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error cargando email: ' + error.message);
  });
  
  hideContextMenu();
}

// Función para cerrar el modal de respuesta
function closeReplyModal() {
  hideElement('replyEmailModal');
  // Limpiar formulario
  document.getElementById('replyEmailForm').reset();
}

// Función para cerrar el modal de reenvío
function closeForwardModal() {
  hideElement('forwardEmailModal');
  // Limpiar formulario
  document.getElementById('forwardEmailForm').reset();
}

// Función para manejar el envío de la respuesta
function handleReplySubmit(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const replyData = {
    email_id: formData.get('email_id'),
    reply_to: formData.get('reply_to'),
    reply_from: formData.get('reply_from'),
    reply_subject: formData.get('reply_subject'),
    reply_message: formData.get('reply_message')
  };
  
  // Validar campos requeridos
  if (!replyData.reply_from || !replyData.reply_message) {
    alert('Por favor completa todos los campos requeridos');
    return;
  }
  
  // Enviar respuesta
  fetch('/admin/email-buzon/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_reply').value
    },
    body: JSON.stringify(replyData)
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      alert('Respuesta enviada exitosamente');
      closeReplyModal();
    } else {
      alert('Error enviando respuesta: ' + (data.error || 'Error desconocido'));
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error enviando respuesta: ' + error.message);
  });
}

// Función para manejar el envío del reenvío
function handleForwardSubmit(event) {
  event.preventDefault();
  
  const formData = new FormData(event.target);
  const forwardData = {
    email_id: formData.get('email_id'),
    forward_to: formData.get('forward_to'),
    forward_from: formData.get('forward_from'),
    forward_subject: formData.get('forward_subject'),
    forward_message: formData.get('forward_message')
  };
  
  // Validar campos requeridos
  if (!forwardData.forward_to || !forwardData.forward_from) {
    alert('Por favor completa los campos "Para" y "De"');
    return;
  }
  
  // Enviar reenvío
  fetch('/admin/email-buzon/forward', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_forward').value
    },
    body: JSON.stringify(forwardData)
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      alert('Email reenviado exitosamente');
      closeForwardModal();
    } else {
      alert('Error reenviando email: ' + (data.error || 'Error desconocido'));
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error reenviando email: ' + error.message);
  });
}

function contextForward() {
  if (!contextMenuEmailId) return;
  
  // Obtener los datos del email actual
  fetch(`/admin/email-buzon/view/${contextMenuEmailId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      const email = data.email;
      
      // Llenar el modal de reenvío
      document.getElementById('forwardEmailId').value = contextMenuEmailId;
      document.getElementById('forwardSubject').value = `Fwd: ${email.subject}`;
      
      // Limpiar campos editables
      document.getElementById('forwardTo').value = '';
      document.getElementById('forwardFrom').value = '';
      document.getElementById('forwardMessage').value = '';
      
      // Mostrar modal
      showElement('forwardEmailModal');
    } else {
      alert('Error cargando datos del email para reenviar');
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error cargando email: ' + error.message);
  });
  
  hideContextMenu();
}

function contextMarkAsRead() {
  if (!contextMenuEmailId) return;
  
  fetch(`/admin/email-buzon/mark-processed/${contextMenuEmailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => {
    if (response.ok) {
      // Actualizar la interfaz para mostrar como leído
      const emailElement = document.querySelector(`[data-email-id="${contextMenuEmailId}"]`);
      if (emailElement) {
        emailElement.classList.remove('unread');
      }
    }
  })
  .catch(error => console.error('Error:', error));
  
  hideContextMenu();
}

function contextMoveToInbox() {
  if (!contextMenuEmailId) return;
  
  // Para mover a recibidos, necesitamos restaurar el email y quitar todas las etiquetas
  fetch(`/admin/email-buzon/restore-from-trash/${contextMenuEmailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload();
    } else {
      alert('Error al mover a recibidos: ' + data.error);
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error al mover a recibidos');
  });
  
  hideContextMenu();
}

function contextMoveToTrash() {
  if (!contextMenuEmailId) return;
  
  console.log('Intentando mover email a papelera desde menú contextual:', contextMenuEmailId);
  
  // Verificar si estamos en la página de papelera
  const currentUrl = window.location.pathname;
  const isInTrashPage = currentUrl.includes('/trash');
  
  if (isInTrashPage) {
    // Si estamos en papelera, eliminar permanentemente
    console.log('Estamos en papelera, eliminando permanentemente');
    if (confirm('⚠️ ¿Eliminar permanentemente este email?\n\n❌ Esta acción NO se puede deshacer\n\n¿Continuar?')) {
      fetch(`/admin/email-buzon/permanently-delete/${contextMenuEmailId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': document.querySelector('#csrf_token').value
        }
      })
      .then(response => {
        console.log('Respuesta eliminación permanente:', response.status, response.statusText);
        return response.json();
      })
      .then(data => {
        console.log('Datos eliminación permanente:', data);
        if (data.success) {
          location.reload();
        } else {
          alert('Error al eliminar permanentemente: ' + data.error);
        }
      })
      .catch(error => {
        console.error('Error en eliminación permanente:', error);
        alert('Error al eliminar permanentemente');
      });
    }
  } else {
    // Si no estamos en papelera, mover a papelera
    console.log('No estamos en papelera, moviendo a papelera');
    fetch(`/admin/email-buzon/move-to-trash/${contextMenuEmailId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => {
      console.log('Respuesta del menú contextual:', response.status, response.statusText);
      return response.json();
    })
    .then(data => {
      console.log('Datos del menú contextual:', data);
      if (data.success) {
        location.reload();
      } else {
        alert('Error al mover a papelera: ' + data.error);
      }
    })
    .catch(error => {
      console.error('Error en contextMoveToTrash:', error);
      alert('Error al mover a papelera');
    });
  }
  
  hideContextMenu();
}

function contextMoveToSpam() {
  if (!contextMenuEmailId) return;
  
  // Mover a spam agregando la etiqueta 'spam'
  fetch(`/admin/email-buzon/move-to-spam/${contextMenuEmailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload();
    } else {
      alert('Error al mover a spam: ' + data.error);
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error al mover a spam');
  });
  
  hideContextMenu();
}

function contextMoveToTag(tagId) {
  if (!contextMenuEmailId) return;
  
  // Mover a etiqueta específica
  fetch(`/admin/email-buzon/move-to-tag/${contextMenuEmailId}/${tagId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload();
    } else {
      alert('Error al mover a etiqueta: ' + data.error);
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error al mover a etiqueta');
  });
  
  hideContextMenu();
}

function contextDelete() {
  if (!contextMenuEmailId) return;
  
  if (confirm('¿Estás seguro de que quieres eliminar este correo?')) {
    contextMoveToTrash();
  } else {
    hideContextMenu();
  }
}

// Función para escapar HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function closeViewEmailModal() {
  hideElement('viewEmailModal');
  currentEmailId = null;
}

function showEmailTab(tabType) {
  // Remover clase active de todos los botones y contenidos
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.email-tab-content').forEach(content => {
    content.classList.remove('active');
    content.style.display = 'none';
  });
  
  // Activar el tab seleccionado
  event.target.classList.add('active');
  const contentDiv = document.getElementById(`emailContent${tabType.charAt(0).toUpperCase() + tabType.slice(1)}`);
  contentDiv.classList.add('active');
  contentDiv.style.display = 'block';
}

function markEmailAsProcessed() {
  if (!currentEmailId) return;
  
  fetch(`/admin/email-buzon/mark-processed/${currentEmailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      closeViewEmailModal();
      location.reload();
    } else {
      alert('Error: ' + data.error);
    }
  })
  .catch(error => {
    alert('Error: ' + error);
  });
}

function moveEmailToTrash() {
  if (!currentEmailId) return;
  
  console.log('Intentando mover email a papelera:', currentEmailId);
  
  // Verificar si el email ya está en papelera (botón dice "Restaurar")
  const moveToTrashBtn = document.getElementById('moveToTrashBtn');
  const isInTrash = moveToTrashBtn && moveToTrashBtn.innerHTML.includes('Restaurar');
  
  if (isInTrash) {
    // Si está en papelera, no debería usar esta función
    // Esta función es solo para mover A papelera, no para eliminar DE papelera
    console.log('Email ya está en papelera, no se puede mover a papelera nuevamente');
    return;
  }
  
  fetch(`/admin/email-buzon/move-to-trash/${currentEmailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => {
    console.log('Respuesta recibida:', response.status, response.statusText);
    return response.json();
  })
  .then(data => {
    console.log('Datos recibidos:', data);
    if (data.success) {
      closeViewEmailModal();
      location.reload();
    } else {
      alert('Error: ' + data.error);
    }
  })
  .catch(error => {
    console.error('Error en moveEmailToTrash:', error);
    alert('Error: ' + error);
  });
}

function restoreEmailFromTrash() {
  if (!currentEmailId) return;
  
  fetch(`/admin/email-buzon/restore-from-trash/${currentEmailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      closeViewEmailModal();
      location.reload();
    } else {
      alert('Error: ' + data.error);
    }
  })
  .catch(error => {
    alert('Error: ' + error);
  });
}

function deleteEmailPermanently() {
  if (!currentEmailId) return;
  
  if (confirm('⚠️ ATENCIÓN: ¿Estás seguro de que quieres eliminar permanentemente este email?\n\n❌ Esta acción NO se puede deshacer\n\nEl email será eliminado completamente de la base de datos.\n\n¿Continuar?')) {
    fetch(`/admin/email-buzon/permanently-delete/${currentEmailId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        closeViewEmailModal();
        location.reload();
      } else {
        alert('Error: ' + data.error);
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Error eliminando email permanentemente');
    });
  }
}

// Cerrar modal al hacer clic fuera (mejorado para Chrome)
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('viewEmailModal');
  
  // Función para manejar clic en modal (compatible con Chrome)
  function handleModalClick(e) {
    if (e.target === modal || e.target.id === 'viewEmailModal') {
      e.preventDefault();
      e.stopPropagation();
      closeViewEmailModal();
      return false;
    }
  }
  
  if (modal) {
    // Múltiples formas de capturar el evento para compatibilidad con Chrome
    modal.addEventListener('click', handleModalClick, true); // Capture phase
    modal.addEventListener('mousedown', function(e) {
      // También capturar mousedown para mejor compatibilidad
      if (e.target === modal || e.target.id === 'viewEmailModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal cuando se hace clic dentro
    const modalContent = modal.querySelector('.edit-modal-content, .modal-content');
    if (modalContent) {
      modalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      modalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }
});

function markAsProcessed(emailId) {
  fetch(`/admin/email-buzon/mark-processed/${emailId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload();
    } else {
      alert('Error: ' + data.error);
    }
  })
  .catch(error => {
    alert('Error: ' + error);
  });
}

function markAllAsProcessed() {
  if (confirm('¿Marcar todos los emails como procesados?')) {
    const checkboxes = document.querySelectorAll('.email-checkbox:checked');
    checkboxes.forEach(checkbox => {
      const emailId = checkbox.closest('.email-item').dataset.emailId;
      if (emailId) {
        markAsProcessed(emailId);
      }
    });
  }
}

function deleteSelected() {
  if (confirm('¿Eliminar los emails seleccionados?')) {
    const checkboxes = document.querySelectorAll('.email-checkbox:checked');
    checkboxes.forEach(checkbox => {
      const emailId = checkbox.closest('.email-item').dataset.emailId;
      if (emailId) {
        console.log('Eliminar email:', emailId);
      }
    });
  }
}


function searchEmails(query) {
  const emailItems = document.querySelectorAll('.email-item');
  emailItems.forEach(item => {
    const text = item.textContent.toLowerCase();
    const matches = text.includes(query.toLowerCase());
    item.style.display = matches ? 'flex' : 'none';
  });
}

// Funciones para el modal de edición
function openEditModal(serverId, domain, port, maxEmails, enabled) {
  document.getElementById('editDomain').value = domain;
  document.getElementById('editPort').value = port;
  document.getElementById('editMaxEmails').value = maxEmails;
  document.getElementById('editEnabled').checked = enabled;
  document.getElementById('editForm').action = `/admin/email-buzon/edit-buzon/${serverId}`;
  document.getElementById('editModal').classList.add('show');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('show');
}

// Funciones para manejo de etiquetas
let currentTagId = null;

function openEditTagModal(tagId, name, color) {
  currentTagId = tagId;
  document.getElementById('editTagName').value = name;
  document.getElementById('editTagColor').value = color;
  document.getElementById('editTagForm').action = `/admin/email-buzon/tags/update/${tagId}`;
  showElement('editTagModal');
}

function closeEditTagModal() {
  hideElement('editTagModal');
  currentTagId = null;
}

function confirmDeleteTag() {
  if (!currentTagId) {
    alert('Error: No se ha seleccionado ninguna etiqueta');
    return;
  }
  
  const tagName = document.getElementById('editTagName').value;
  
  if (confirm(`⚠️ ATENCIÓN: ¿Estás seguro de que deseas eliminar la etiqueta "${tagName}"?\n\nEsta acción ELIMINARÁ PERMANENTEMENTE:\n• La etiqueta "${tagName}"\n• TODOS los correos que tienen esta etiqueta\n• Los filtros asociados quedarán "Sin asignar"\n\n❌ Esta acción NO se puede deshacer\n\n¿Continuar con la eliminación?`)) {
    deleteTag(currentTagId);
  }
}

function deleteTag(tagId) {
  const csrfToken = document.querySelector('input[name="_csrf_token"]').value;
  
  fetch(`/admin/email-buzon/tags/delete/${tagId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // Cerrar modal
      closeEditTagModal();
      
      // Mostrar mensaje de éxito
      alert(data.message || 'Etiqueta eliminada exitosamente');
      
      // Redirigir a la página principal del buzón en lugar de recargar
      window.location.href = '/admin/email-buzon';
    } else {
      alert('Error eliminando etiqueta: ' + (data.message || 'Error desconocido'));
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error de conexión al eliminar etiqueta');
  });
}

// Funciones para el modal de filtros
function openFilterModal(tagId, tagName, filterFromEmail = '', filterToEmail = '', filterSubjectContains = '', filterContentContains = '') {
  document.getElementById('filterTagName').textContent = tagName;
  document.getElementById('filterFromEmail').value = filterFromEmail;
  document.getElementById('filterToEmail').value = filterToEmail;
  document.getElementById('filterSubjectContains').value = filterSubjectContains;
  document.getElementById('filterContentContains').value = filterContentContains;
  document.getElementById('filterForm').action = `/admin/email-buzon/tags/update-filters/${tagId}`;
  showElement('filterModal');
}

function closeFilterModal() {
  hideElement('filterModal');
}

// Funciones para el modal de crear etiqueta
function openCreateTagModal() {
  showElement('createTagModal');
}

function closeCreateTagModal() {
  hideElement('createTagModal');
}

// Event listeners para los modales
document.addEventListener('DOMContentLoaded', function() {
  // Botones de cerrar modales
  const closeCreateTagBtn = document.getElementById('closeCreateTagModal');
  const cancelCreateTagBtn = document.getElementById('cancelCreateTagModal');
  const closeEditTagBtn = document.getElementById('closeEditTagModal');
  const cancelEditTagBtn = document.getElementById('cancelEditTagModal');
  
  if (closeCreateTagBtn) {
    closeCreateTagBtn.addEventListener('click', closeCreateTagModal);
  }
  
  if (cancelCreateTagBtn) {
    cancelCreateTagBtn.addEventListener('click', closeCreateTagModal);
  }
  
  if (closeEditTagBtn) {
    closeEditTagBtn.addEventListener('click', closeEditTagModal);
  }
  
  if (cancelEditTagBtn) {
    cancelEditTagBtn.addEventListener('click', closeEditTagModal);
  }
});


function filterEmailsByTag(tagId) {
  // Cargar emails por etiqueta con AJAX
  fetch(`/admin/email-buzon/filter-by-tag/${tagId}`)
    .then(response => response.text())
    .then(html => {
      // Crear un elemento temporal para parsear el HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // Extraer solo el contenido de la lista de emails
      const newEmailList = tempDiv.querySelector('.email-list');
      
      if (newEmailList) {
        // Actualizar la lista de emails
        document.querySelector('.email-list').innerHTML = newEmailList.innerHTML;
        
        // Actualizar el sidebar para marcar la etiqueta como activa
        document.querySelectorAll('.email-folder').forEach(folder => {
          folder.classList.remove('active');
        });
        document.querySelector(`.email-folder[data-tag-id="${tagId}"]`).classList.add('active');
        
        // Actualizar la toolbar
        updateToolbarForView('tag');
      }
    })
    .catch(error => {
      console.error('Error cargando emails por etiqueta:', error);
    });
}

function filterEmailsUntagged() {
  // Filtrar emails sin etiquetas (implementar lógica local)
  const emailItems = document.querySelectorAll('.email-item');
  emailItems.forEach(item => {
    const hasTags = item.querySelector('.email-tags') && item.querySelector('.email-tags').children.length > 0;
    item.style.display = hasTags ? 'none' : 'flex';
  });
}

function showAllEmails() {
  // Mostrar todos los emails
  const emailItems = document.querySelectorAll('.email-item');
  emailItems.forEach(item => {
    item.style.display = 'flex';
  });
  updateToolbarForView('all');
}

function filterEmailsTrash() {
  // Cargar emails de papelera con AJAX
  fetch('/admin/email-buzon/trash')
    .then(response => response.text())
    .then(html => {
      // Crear un elemento temporal para parsear el HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // Extraer solo el contenido de la lista de emails
      const newEmailList = tempDiv.querySelector('.email-list');
      const newSidebar = tempDiv.querySelector('.email-sidebar');
      
      if (newEmailList && newSidebar) {
        // Actualizar la lista de emails
        document.querySelector('.email-list').innerHTML = newEmailList.innerHTML;
        
        // Actualizar el sidebar para marcar Papelera como activa
        document.querySelectorAll('.email-folder').forEach(folder => {
          folder.classList.remove('active');
        });
        document.querySelector('.email-folder[data-filter="trash"]').classList.add('active');
        
        // Actualizar la toolbar para mostrar el botón de limpiar papelera
        updateToolbarForView('trash');
      }
    })
    .catch(error => {
      console.error('Error cargando papelera:', error);
    });
}

function moveToTrash(emailId) {
  if (confirm('¿Mover este email a la papelera?')) {
    fetch(`/admin/email-buzon/move-to-trash/${emailId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        location.reload();
      } else {
        alert('Error: ' + data.error);
      }
    })
    .catch(error => {
      alert('Error: ' + error);
    });
  }
}

function restoreFromTrash(emailId) {
  if (confirm('¿Restaurar este email desde la papelera?')) {
    fetch(`/admin/email-buzon/restore-from-trash/${emailId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        location.reload();
      } else {
        alert('Error: ' + data.error);
      }
    })
    .catch(error => {
      alert('Error: ' + error);
    });
  }
}

function permanentlyDelete(emailId) {
  if (confirm('¿Eliminar permanentemente este email? Esta acción no se puede deshacer.')) {
    fetch(`/admin/email-buzon/permanently-delete/${emailId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('#csrf_token').value
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        location.reload();
      } else {
        alert('Error: ' + data.error);
      }
    })
    .catch(error => {
      alert('Error: ' + error);
    });
  }
}

function updateToolbarForView(view) {
  const cleanupBtn = document.getElementById('cleanupTrashBtn');
  if (cleanupBtn) {
    if (view === 'trash') {
      cleanupBtn.classList.add('show');
    } else {
      cleanupBtn.classList.remove('show');
    }
  }
}

function addTagToEmail(emailId, tagId) {
  fetch(`/admin/email-buzon/add-tag/${emailId}/${tagId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload();
    } else {
      alert('Error: ' + data.error);
    }
  })
  .catch(error => {
    alert('Error: ' + error);
  });
}

function removeTagFromEmail(emailId, tagId) {
  fetch(`/admin/email-buzon/remove-tag/${emailId}/${tagId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': document.querySelector('#csrf_token').value
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload();
    } else {
      alert('Error: ' + data.error);
    }
  })
  .catch(error => {
    alert('Error: ' + error);
  });
}

// Auto-refresh completamente eliminado

// Inicialización cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  // Event listeners para botones de la toolbar
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      location.reload();
    });
  }

  const markAllBtn = document.getElementById('markAllBtn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', markAllAsProcessed);
  }

  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', deleteSelected);
  }

  // Event listener para búsqueda automática
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  
  if (searchInput) {
    let searchTimeout = null;
    
    // Función de búsqueda reutilizable con debounce
    function performEmailSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchEmails(searchInput.value);
        // Mostrar/ocultar botón X según si hay texto
        if (clearSearchBtn) {
          clearSearchBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
        }
      }, 150); // Timeout reducido para mejor respuesta
    }
    
    // Múltiples listeners para compatibilidad con Chrome y otros navegadores
    searchInput.addEventListener('input', performEmailSearch);
    searchInput.addEventListener('keyup', function(e) {
      // Evitar búsqueda en teclas especiales
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
        return;
      }
      performEmailSearch();
    });
    // Para campos type="search" en Chrome
    searchInput.addEventListener('search', performEmailSearch);
  }
  
  // Event listener para botón X de limpiar búsqueda
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', function() {
      if (searchInput) {
        searchInput.value = '';
        searchEmails(''); // Mostrar todos los emails
        this.style.display = 'none'; // Ocultar botón X
        searchInput.focus(); // Mantener foco en el input
      }
    });
    
  // Inicialmente ocultar el botón X
  clearSearchBtn.style.display = 'none';
}

// Función para toggle de servidor vía AJAX
function toggleServer(serverId) {
  const toggleBtn = document.querySelector(`[data-server-id="${serverId}"].server-toggle-btn`);
  if (!toggleBtn) {
    return;
  }
  
  // Deshabilitar botón temporalmente
  toggleBtn.disabled = true;
  toggleBtn.style.opacity = '0.6';
  
  fetch(`/admin/email-buzon/toggle-buzon/${serverId}`, {
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
      const isEnabled = data.enabled;
      const icon = toggleBtn.querySelector('i');
      const span = toggleBtn.querySelector('span');
      
      if (isEnabled) {
        // Servidor ahora está activo -> mostrar OFF (rojo)
        toggleBtn.className = 'btn btn-red server-toggle-btn';
        icon.className = 'fas fa-toggle-off';
        span.textContent = 'OFF';
        toggleBtn.title = 'Desactivar servidor';
        toggleBtn.setAttribute('data-enabled', 'true');
      } else {
        // Servidor ahora está inactivo -> mostrar ON (verde)
        toggleBtn.className = 'btn btn-green server-toggle-btn';
        icon.className = 'fas fa-toggle-on';
        span.textContent = 'ON';
        toggleBtn.title = 'Activar servidor';
        toggleBtn.setAttribute('data-enabled', 'false');
      }
      
      // El estado ahora se muestra solo con el botón ON/OFF
      
    } else {
      alert('Error al cambiar estado del servidor: ' + (data.message || 'Error desconocido'));
    }
  })
  .catch(error => {
    alert('Error de conexión al cambiar estado del servidor');
  })
  .finally(() => {
    // Rehabilitar el botón
    toggleBtn.disabled = false;
    toggleBtn.style.opacity = '1';
  });
}

// Función para toggle de reenvío vía AJAX
function toggleForwarding(forwardingId) {
  const toggleBtn = document.querySelector(`[data-forwarding-id="${forwardingId}"].forwarding-toggle-btn`);
  if (!toggleBtn) {
    return;
  }
  
  // Deshabilitar botón temporalmente
  toggleBtn.disabled = true;
  toggleBtn.style.opacity = '0.6';
  
  fetch(`/admin/email-buzon/toggle-forwarding/${forwardingId}`, {
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
      const isEnabled = data.enabled;
      const icon = toggleBtn.querySelector('i');
      const span = toggleBtn.querySelector('span');
      
      if (isEnabled) {
        // Reenvío ahora está activo -> mostrar OFF (rojo)
        toggleBtn.className = 'btn btn-red forwarding-toggle-btn';
        icon.className = 'fas fa-toggle-off';
        span.textContent = 'OFF';
        toggleBtn.title = 'Desactivar reenvío';
        toggleBtn.setAttribute('data-enabled', 'true');
      } else {
        // Reenvío ahora está inactivo -> mostrar ON (verde)
        toggleBtn.className = 'btn btn-green forwarding-toggle-btn';
        icon.className = 'fas fa-toggle-on';
        span.textContent = 'ON';
        toggleBtn.title = 'Activar reenvío';
        toggleBtn.setAttribute('data-enabled', 'false');
      }
      
    } else {
      alert('Error al cambiar estado del reenvío: ' + (data.message || 'Error desconocido'));
    }
  })
  .catch(error => {
    alert('Error de conexión al cambiar estado del reenvío');
  })
  .finally(() => {
    // Rehabilitar el botón
    toggleBtn.disabled = false;
    toggleBtn.style.opacity = '1';
  });
}

  // Event listeners para emails
  const emailItems = document.querySelectorAll('.email-item');
  emailItems.forEach(item => {
    item.addEventListener('click', function() {
      const emailId = this.dataset.emailId;
      viewEmail(emailId);
    });
  });

  const emailCheckboxes = document.querySelectorAll('.email-checkbox');
  emailCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  });

  // Event listeners para botones de editar servidor - DESHABILITADO
  // const editServerBtns = document.querySelectorAll('.edit-server-btn');

// Event listeners para formularios de eliminación
const deleteServerForms = document.querySelectorAll('.delete-server-form');
deleteServerForms.forEach(form => {
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (confirm('¿Eliminar este servidor?')) {
      const formData = new FormData(form);
      const serverId = form.action.split('/').pop();
      
      fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: {
          'X-CSRFToken': formData.get('_csrf_token')
        }
      })
      .then(response => {
        if (response.ok) {
          // Remover el elemento del servidor del DOM
          const serverItem = form.closest('.server-item');
          serverItem.remove();
          
          // Mostrar mensaje de éxito
          showNotification('Servidor eliminado exitosamente', 'success');
        } else {
          showNotification('Error al eliminar el servidor', 'error');
        }
      })
      .catch(error => {
        showNotification('Error al eliminar el servidor', 'error');
      });
    }
  });
});

// Event listeners para toggle de servidores
const toggleServerForms = document.querySelectorAll('form[action*="toggle_buzon"]');
toggleServerForms.forEach(form => {
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(form);
    const serverId = form.action.split('/').pop();
    
    fetch(form.action, {
      method: 'POST',
      body: formData,
      headers: {
        'X-CSRFToken': formData.get('_csrf_token')
      }
    })
    .then(response => {
      if (response.ok) {
        // Actualizar el botón toggle
        const toggleBtn = form.querySelector('.server-toggle-btn');
        const serverStatus = form.closest('.server-item').querySelector('.server-status');
        
        // Cambiar el estado visual
        if (toggleBtn.classList.contains('btn-green')) {
          // Cambiar a OFF (rojo)
          toggleBtn.classList.remove('btn-green');
          toggleBtn.classList.add('btn-red');
          toggleBtn.innerHTML = '<i class="fas fa-toggle-off"></i><span>OFF</span>';
          toggleBtn.title = 'Activar servidor';
          serverStatus.textContent = 'Inactivo';
          serverStatus.style.color = '#e74c3c';
        } else {
          // Cambiar a ON (verde)
          toggleBtn.classList.remove('btn-red');
          toggleBtn.classList.add('btn-green');
          toggleBtn.innerHTML = '<i class="fas fa-toggle-on"></i><span>ON</span>';
          toggleBtn.title = 'Desactivar servidor';
          serverStatus.textContent = 'Activo';
          serverStatus.style.color = '#27ae60';
        }
        
        // Mostrar mensaje de éxito
        const statusText = toggleBtn.classList.contains('btn-green') ? 'activado' : 'desactivado';
        showNotification(`Servidor ${statusText} exitosamente`, 'success');
      } else {
        showNotification('Error al cambiar el estado del servidor', 'error');
      }
    })
    .catch(error => {
      showNotification('Error al cambiar el estado del servidor', 'error');
    });
  });
});

// Función para mostrar notificaciones
function showNotification(message, type) {
  // Crear elemento de notificación
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  // Estilos para la notificación
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 4px;
    color: white;
    font-weight: bold;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.3s ease;
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  // Color según el tipo
  if (type === 'success') {
    notification.style.backgroundColor = '#27ae60';
  } else if (type === 'error') {
    notification.style.backgroundColor = '#e74c3c';
  }
  
  // Agregar al DOM
  document.body.appendChild(notification);
  
  // Mostrar con animación
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 100);
  
  // Remover después de 3 segundos
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

  // Event listeners para el modal
  // Event listeners para el modal de edición (mejorado para Chrome)
  const editModal = document.getElementById('editModal');
  if (editModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleEditModalClick(e) {
      if (e.target === editModal || e.target.id === 'editModal') {
        e.preventDefault();
        e.stopPropagation();
        closeEditModal();
        return false;
      }
    }
    
    editModal.addEventListener('click', handleEditModalClick, true); // Capture phase
    editModal.addEventListener('mousedown', function(e) {
      if (e.target === editModal || e.target.id === 'editModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const editModalContent = editModal.querySelector('.edit-modal-content, .modal-content');
    if (editModalContent) {
      editModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      editModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  const closeEditModalBtn = document.getElementById('closeEditModal');
  if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', closeEditModal);
  }

  const cancelEditModalBtn = document.getElementById('cancelEditModal');
  if (cancelEditModalBtn) {
    cancelEditModalBtn.addEventListener('click', closeEditModal);
  }

  // Event listeners para filtros de etiquetas
  const emailFolders = document.querySelectorAll('.email-folder[data-filter]');
  emailFolders.forEach(folder => {
    folder.addEventListener('click', function() {
      // Remover clase active de todas las carpetas
      emailFolders.forEach(f => f.classList.remove('active'));
      // Agregar clase active a la carpeta clickeada
      this.classList.add('active');
      
      const filter = this.dataset.filter;
      if (filter === 'tag') {
        const tagId = this.dataset.tagId;
        filterEmailsByTag(tagId);
      } else if (filter === 'untagged') {
        filterEmailsUntagged();
      } else if (filter === 'trash') {
        filterEmailsTrash();
      } else if (filter === 'all') {
        showAllEmails();
      }
    });
  });

  // Event listeners para el modal de etiquetas (mejorado para Chrome)
  const editTagModal = document.getElementById('editTagModal');
  if (editTagModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleEditTagModalClick(e) {
      if (e.target === editTagModal || e.target.id === 'editTagModal') {
        e.preventDefault();
        e.stopPropagation();
        closeEditTagModal();
        return false;
      }
    }
    
    editTagModal.addEventListener('click', handleEditTagModalClick, true); // Capture phase
    editTagModal.addEventListener('mousedown', function(e) {
      if (e.target === editTagModal || e.target.id === 'editTagModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const editTagModalContent = editTagModal.querySelector('.edit-modal-content');
    if (editTagModalContent) {
      editTagModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      editTagModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  const closeEditTagModalBtn = document.getElementById('closeEditTagModal');
  if (closeEditTagModalBtn) {
    closeEditTagModalBtn.addEventListener('click', closeEditTagModal);
  }

  const cancelEditTagModalBtn = document.getElementById('cancelEditTagModal');
  if (cancelEditTagModalBtn) {
    cancelEditTagModalBtn.addEventListener('click', closeEditTagModal);
  }

  // Event listeners para el modal de filtros (mejorado para Chrome)
  const filterModal = document.getElementById('filterModal');
  if (filterModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleFilterModalClick(e) {
      if (e.target === filterModal || e.target.id === 'filterModal') {
        e.preventDefault();
        e.stopPropagation();
        closeFilterModal();
        return false;
      }
    }
    
    filterModal.addEventListener('click', handleFilterModalClick, true); // Capture phase
    filterModal.addEventListener('mousedown', function(e) {
      if (e.target === filterModal || e.target.id === 'filterModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const filterModalContent = filterModal.querySelector('.edit-modal-content');
    if (filterModalContent) {
      filterModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      filterModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  const closeFilterModalBtn = document.getElementById('closeFilterModal');
  if (closeFilterModalBtn) {
    closeFilterModalBtn.addEventListener('click', closeFilterModal);
  }

  const cancelFilterModalBtn = document.getElementById('cancelFilterModal');
  if (cancelFilterModalBtn) {
    cancelFilterModalBtn.addEventListener('click', closeFilterModal);
  }

  // Event listeners para el modal de crear etiqueta (mejorado para Chrome)
  const createTagModal = document.getElementById('createTagModal');
  if (createTagModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleCreateTagModalClick(e) {
      if (e.target === createTagModal || e.target.id === 'createTagModal') {
        e.preventDefault();
        e.stopPropagation();
        closeCreateTagModal();
        return false;
      }
    }
    
    createTagModal.addEventListener('click', handleCreateTagModalClick, true); // Capture phase
    createTagModal.addEventListener('mousedown', function(e) {
      if (e.target === createTagModal || e.target.id === 'createTagModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const createTagModalContent = createTagModal.querySelector('.edit-modal-content');
    if (createTagModalContent) {
      createTagModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      createTagModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  const closeCreateTagModalBtn = document.getElementById('closeCreateTagModal');
  if (closeCreateTagModalBtn) {
    closeCreateTagModalBtn.addEventListener('click', closeCreateTagModal);
  }

  const cancelCreateTagModalBtn = document.getElementById('cancelCreateTagModal');
  if (cancelCreateTagModalBtn) {
    cancelCreateTagModalBtn.addEventListener('click', closeCreateTagModal);
  }


  // Event listener para limpiar papelera
  const cleanupTrashBtn = document.getElementById('cleanupTrashBtn');
  if (cleanupTrashBtn) {
    cleanupTrashBtn.addEventListener('click', function() {
      if (confirm('⚠️ ¿Vaciar completamente la papelera?\n\nEsta acción eliminará PERMANENTEMENTE todos los emails de la papelera.\n\n❌ Esta acción NO se puede deshacer.\n\n¿Continuar?')) {
        console.log('Iniciando vaciado completo de papelera...');
        fetch('/admin/email-buzon/cleanup-trash', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': document.querySelector('#csrf_token').value
          }
        })
        .then(response => {
          console.log('Respuesta de vaciar papelera:', response.status, response.statusText);
          return response.json();
        })
        .then(data => {
          console.log('Resultado de vaciar papelera:', data);
          if (data.success) {
            alert(data.message || 'Papelera vaciada exitosamente');
            location.reload();
          } else {
            alert('Error: ' + data.error);
          }
        })
        .catch(error => {
          console.error('Error al vaciar papelera:', error);
          alert('Error: ' + error);
        });
      }
    });
  }

  // Detectar si estamos en la vista de papelera
  const currentPath = window.location.pathname;
  if (currentPath.includes('/trash')) {
    updateToolbarForView('trash');
  } else {
    // Por defecto, ocultar el botón de limpiar papelera
    updateToolbarForView('all');
  }

  // Event listeners para botones de toggle de servidor - DESHABILITADO
  // const serverToggleBtns = document.querySelectorAll('.server-toggle-btn');

  // Event listeners para botones de toggle de reenvío
  const forwardingToggleBtns = document.querySelectorAll('.forwarding-toggle-btn');
  forwardingToggleBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const forwardingId = this.getAttribute('data-forwarding-id');
      if (forwardingId) {
        toggleForwarding(forwardingId);
      }
    });
  });

  // Event listeners para formularios de eliminación de reenvío
  const deleteForwardingForms = document.querySelectorAll('.delete-forwarding-form');
  deleteForwardingForms.forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const sourceEmail = this.closest('.forwarding-item').querySelector('.forwarding-info strong').textContent;
      if (confirm(`¿Estás seguro de que deseas eliminar el reenvío para ${sourceEmail}?`)) {
        this.submit();
      }
    });
  });

  // Event listeners para botones de editar reenvío
  const editForwardingBtns = document.querySelectorAll('.edit-forwarding-btn');
  editForwardingBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const forwardingId = this.getAttribute('data-forwarding-id');
      const sourceEmail = this.getAttribute('data-source');
      const destinationEmail = this.getAttribute('data-destination');
      
      if (forwardingId) {
        openEditForwardingModal(forwardingId, sourceEmail, destinationEmail);
      }
    });
  });

  // Event listener para cerrar modal de forwarding al hacer clic fuera (mejorado para Chrome)
  const editForwardingModal = document.getElementById('editForwardingModal');
  if (editForwardingModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleEditForwardingModalClick(e) {
      if (e.target === editForwardingModal || e.target.id === 'editForwardingModal') {
        e.preventDefault();
        e.stopPropagation();
        closeEditForwardingModal();
        return false;
      }
    }
    
    editForwardingModal.addEventListener('click', handleEditForwardingModalClick, true); // Capture phase
    editForwardingModal.addEventListener('mousedown', function(e) {
      if (e.target === editForwardingModal || e.target.id === 'editForwardingModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const editForwardingModalContent = editForwardingModal.querySelector('.edit-modal-content');
    if (editForwardingModalContent) {
      editForwardingModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      editForwardingModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  // Event listeners para botones de limpieza automática
  const editCleanupBtns = document.querySelectorAll('.edit-cleanup-btn');
  editCleanupBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const cleanupId = this.getAttribute('data-cleanup-id');
      const cleanupTime = this.getAttribute('data-cleanup-time');
      const cleanupFolder = this.getAttribute('data-cleanup-folder');
      const cleanupTagId = this.getAttribute('data-cleanup-tag-id');
      
      if (cleanupId) {
        openEditCleanupModal(cleanupId, cleanupTime, cleanupFolder, cleanupTagId);
      }
    });
  });

  // Event listeners para botones de toggle de limpieza
  const cleanupToggleBtns = document.querySelectorAll('.cleanup-toggle-btn');
  cleanupToggleBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const cleanupId = this.getAttribute('data-cleanup-id');
      if (cleanupId) {
        toggleCleanup(cleanupId);
      }
    });
  });

  // Event listeners para formularios de eliminación de limpieza
  const deleteCleanupForms = document.querySelectorAll('.delete-cleanup-form');
  deleteCleanupForms.forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      if (confirm('¿Estás seguro de que deseas eliminar esta limpieza automática?')) {
        this.submit();
      }
    });
  });

  // Event listener para cerrar modal de cleanup al hacer clic fuera (mejorado para Chrome)
  const editCleanupModal = document.getElementById('editCleanupModal');
  if (editCleanupModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleEditCleanupModalClick(e) {
      if (e.target === editCleanupModal || e.target.id === 'editCleanupModal') {
        e.preventDefault();
        e.stopPropagation();
        closeEditCleanupModal();
        return false;
      }
    }
    
    editCleanupModal.addEventListener('click', handleEditCleanupModalClick, true); // Capture phase
    editCleanupModal.addEventListener('mousedown', function(e) {
      if (e.target === editCleanupModal || e.target.id === 'editCleanupModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const editCleanupModalContent = editCleanupModal.querySelector('.edit-modal-content');
    if (editCleanupModalContent) {
      editCleanupModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      editCleanupModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }
});

// Funciones para el modal de edición de reenvío
function openEditForwardingModal(forwardingId, sourceEmail, destinationEmail) {
  document.getElementById('editDestinationEmail').value = destinationEmail || '';
  document.getElementById('editForwardingForm').action = `/admin/email-buzon/edit-forwarding/${forwardingId}`;
  showElement('editForwardingModal');
}

function closeEditForwardingModal() {
  hideElement('editForwardingModal');
}

// Funciones para el modal de edición de limpieza automática
function openEditCleanupModal(cleanupId, cleanupTime, cleanupFolder, cleanupTagId) {
  document.getElementById('editCleanupTime').value = cleanupTime || '';
  document.getElementById('editCleanupFolder').value = cleanupFolder || 'inbox';
  document.getElementById('editCleanupForm').action = `/admin/email-buzon/cleanup/edit/${cleanupId}`;
  showElement('editCleanupModal');
}

function closeEditCleanupModal() {
  hideElement('editCleanupModal');
}

// Función para toggle de limpieza automática
function toggleCleanup(cleanupId) {
  const csrfToken = document.querySelector('input[name="_csrf_token"]').value;
  
  fetch(`/admin/email-buzon/cleanup/toggle/${cleanupId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken
    }
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // Actualizar el botón
      const toggleBtn = document.querySelector(`[data-cleanup-id="${cleanupId}"].cleanup-toggle-btn`);
      if (toggleBtn) {
        const icon = toggleBtn.querySelector('i');
        const span = toggleBtn.querySelector('span');
        
        if (data.enabled) {
          toggleBtn.className = 'btn btn-red cleanup-toggle-btn';
          icon.className = 'fas fa-toggle-off';
          span.textContent = 'OFF';
          toggleBtn.title = 'Limpieza activa - Click para desactivar';
        } else {
          toggleBtn.className = 'btn btn-green cleanup-toggle-btn';
          icon.className = 'fas fa-toggle-on';
          span.textContent = 'ON';
          toggleBtn.title = 'Limpieza inactiva - Click para activar';
        }
      }
    } else {
      alert('Error al cambiar estado de limpieza: ' + (data.message || 'Error desconocido'));
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert('Error de conexión al cambiar estado de limpieza');
  });
}

// Event listeners para manejar data attributes en lugar de onclick
document.addEventListener('DOMContentLoaded', function() {
  // Navegación de carpetas
  document.querySelectorAll('[data-action="navigate"]').forEach(element => {
    element.addEventListener('click', function() {
      const url = this.getAttribute('data-url');
      if (url) {
        location.href = url;
      }
    });
  });

  // Verificar servidor SMTP
  document.querySelectorAll('[data-action="check-smtp-server"]').forEach(element => {
    element.addEventListener('click', function() {
      checkSMTPServer();
    });
  });

  // Botón para verificar IP pública
  const btnCheckPublicIP = document.getElementById('btnCheckPublicIP');
  if (btnCheckPublicIP) {
    btnCheckPublicIP.addEventListener('click', function() {
      checkPublicIP();
    });
  }

  // Seleccionar todos los checkboxes
  document.querySelectorAll('[data-action="select-all"]').forEach(button => {
    button.addEventListener('click', function() {
      const checkboxes = document.querySelectorAll('.email-checkbox');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      
      // Si todos están seleccionados, deseleccionar todos; sino, seleccionar todos
      checkboxes.forEach(checkbox => {
        checkbox.checked = !allChecked;
      });
      
      // Cambiar el icono del botón
      const icon = this.querySelector('i');
      if (allChecked) {
        icon.className = 'fas fa-check-square';
        this.title = 'Seleccionar Todos';
        this.setAttribute('aria-label', 'Seleccionar todos los correos');
      } else {
        icon.className = 'fas fa-square';
        this.title = 'Deseleccionar Todos';
        this.setAttribute('aria-label', 'Deseleccionar todos los correos');
      }
    });
  });

  // Eliminar correos seleccionados
  document.querySelectorAll('[data-action="delete-selected"]').forEach(button => {
    button.addEventListener('click', function() {
      const selectedCheckboxes = document.querySelectorAll('.email-checkbox:checked');
      
      if (selectedCheckboxes.length === 0) {
        alert('Por favor selecciona al menos un correo para eliminar.');
        return;
      }
      
      const emailIds = Array.from(selectedCheckboxes).map(cb => cb.value);
      
      // Verificar si estamos en la página de papelera
      const currentUrl = window.location.pathname;
      const isInTrashPage = currentUrl.includes('/trash');
      
      let confirmMessage, fetchUrl;
      
      if (isInTrashPage) {
        confirmMessage = `⚠️ ¿Eliminar PERMANENTEMENTE ${emailIds.length} correo(s)?\n\n❌ Esta acción NO se puede deshacer\n\n¿Continuar?`;
        fetchUrl = '/admin/email-buzon/permanently-delete/';
      } else {
        confirmMessage = `¿Estás seguro de que quieres mover a papelera ${emailIds.length} correo(s) seleccionado(s)?`;
        fetchUrl = '/admin/email-buzon/move-to-trash/';
      }
      
      if (confirm(confirmMessage)) {
        // Procesar cada email seleccionado
        Promise.all(emailIds.map(emailId => {
          return fetch(`${fetchUrl}${emailId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': document.querySelector('#csrf_token').value
            }
          }).then(response => response.json());
        }))
        .then(responses => {
          // Verificar que todas las respuestas sean exitosas
          const allSuccessful = responses.every(response => response.success);
          if (allSuccessful) {
            // Recargar la página para mostrar los cambios
            location.reload();
          } else {
            const action = isInTrashPage ? 'eliminar permanentemente' : 'mover a papelera';
            alert(`Error al ${action} algunos correos. Por favor intenta de nuevo.`);
          }
        })
        .catch(error => {
          console.error('Error:', error);
          const action = isInTrashPage ? 'eliminar permanentemente' : 'mover a papelera';
          alert(`Error al ${action} los correos seleccionados.`);
        });
      }
    });
  });

  // Event listeners para el modal de respuesta
  document.querySelectorAll('[data-action="close-reply-modal"]').forEach(button => {
    button.addEventListener('click', closeReplyModal);
  });

  // Event listeners para el modal de reenvío
  document.querySelectorAll('[data-action="close-forward-modal"]').forEach(button => {
    button.addEventListener('click', closeForwardModal);
  });

  // Event listener para el formulario de respuesta
  const replyForm = document.getElementById('replyEmailForm');
  if (replyForm) {
    replyForm.addEventListener('submit', handleReplySubmit);
  }

  // Event listener para el formulario de reenvío
  const forwardForm = document.getElementById('forwardEmailForm');
  if (forwardForm) {
    forwardForm.addEventListener('submit', handleForwardSubmit);
  }

  // Event listener para cerrar modal de respuesta al hacer clic fuera (mejorado para Chrome)
  const replyModal = document.getElementById('replyEmailModal');
  if (replyModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleReplyModalClick(e) {
      if (e.target === replyModal || e.target.id === 'replyEmailModal') {
        e.preventDefault();
        e.stopPropagation();
        closeReplyModal();
        return false;
      }
    }
    
    replyModal.addEventListener('click', handleReplyModalClick, true); // Capture phase
    replyModal.addEventListener('mousedown', function(e) {
      if (e.target === replyModal || e.target.id === 'replyEmailModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const replyModalContent = replyModal.querySelector('.edit-modal-content, .modal-content');
    if (replyModalContent) {
      replyModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      replyModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  // Event listener para cerrar modal de reenvío al hacer clic fuera (mejorado para Chrome)
  const forwardModal = document.getElementById('forwardEmailModal');
  if (forwardModal) {
    // Función para manejar clic en modal (compatible con Chrome)
    function handleForwardModalClick(e) {
      if (e.target === forwardModal || e.target.id === 'forwardEmailModal') {
        e.preventDefault();
        e.stopPropagation();
        closeForwardModal();
        return false;
      }
    }
    
    forwardModal.addEventListener('click', handleForwardModalClick, true); // Capture phase
    forwardModal.addEventListener('mousedown', function(e) {
      if (e.target === forwardModal || e.target.id === 'forwardEmailModal') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el contenido del modal cierre el modal
    const forwardModalContent = forwardModal.querySelector('.edit-modal-content, .modal-content');
    if (forwardModalContent) {
      forwardModalContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      forwardModalContent.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }

  // Event listeners para el menú contextual
  document.querySelectorAll('[data-action="context-reply"]').forEach(item => {
    item.addEventListener('click', contextReply);
  });

  document.querySelectorAll('[data-action="context-forward"]').forEach(item => {
    item.addEventListener('click', contextForward);
  });

  document.querySelectorAll('[data-action="context-mark-read"]').forEach(item => {
    item.addEventListener('click', contextMarkAsRead);
  });

  document.querySelectorAll('[data-action="move-to-inbox"]').forEach(item => {
    item.addEventListener('click', contextMoveToInbox);
  });

  document.querySelectorAll('[data-action="move-to-trash"]').forEach(item => {
    item.addEventListener('click', contextMoveToTrash);
  });

  document.querySelectorAll('[data-action="move-to-spam"]').forEach(item => {
    item.addEventListener('click', contextMoveToSpam);
  });

  document.querySelectorAll('[data-action="move-to-tag"]').forEach(item => {
    item.addEventListener('click', function() {
      const tagId = this.getAttribute('data-tag-id');
      contextMoveToTag(tagId);
    });
  });

  document.querySelectorAll('[data-action="context-delete"]').forEach(item => {
    item.addEventListener('click', contextDelete);
  });

  // Acordeón desplegable
  document.querySelectorAll('[data-action="toggle-accordion"]').forEach(header => {
    header.addEventListener('click', function() {
      const targetId = this.getAttribute('data-target');
      const content = document.getElementById(targetId);
      
      if (content) {
        // Toggle contenido
        if (content.classList.contains('hidden')) {
          content.classList.remove('hidden');
          this.classList.add('active');
        } else {
          content.classList.add('hidden');
          this.classList.remove('active');
        }
      }
    });
  });

  // Botones de configuración de etiquetas
  document.querySelectorAll('[data-action="tag-settings"]').forEach(button => {
    button.addEventListener('click', function(event) {
      event.stopPropagation(); // Evitar que se active el click de la carpeta
      const tagId = this.getAttribute('data-tag-id');
      const tagName = this.getAttribute('data-tag-name');
      const tagColor = this.getAttribute('data-tag-color');
      openEditTagModal(tagId, tagName, tagColor);
    });
  });

  // Items de email clickeables
  document.querySelectorAll('[data-action="view-email"]').forEach(item => {
    item.addEventListener('click', function() {
      const emailId = this.getAttribute('data-email-id');
      viewEmail(emailId);
    });

    // Agregar event listener para clic derecho
    item.addEventListener('contextmenu', function(event) {
      event.preventDefault();
      const emailId = this.getAttribute('data-email-id');
      showContextMenu(event, emailId);
      return false;
    });
  });

  // Botones de acción de emails
  document.querySelectorAll('[data-action="restore"]').forEach(button => {
    button.addEventListener('click', function(event) {
      event.stopPropagation();
      const emailId = this.getAttribute('data-email-id');
      restoreFromTrash(emailId);
    });
  });

  document.querySelectorAll('[data-action="delete-permanent"]').forEach(button => {
    button.addEventListener('click', function(event) {
      event.stopPropagation();
      const emailId = this.getAttribute('data-email-id');
      permanentlyDelete(emailId);
    });
  });

  document.querySelectorAll('[data-action="move-trash"]').forEach(button => {
    button.addEventListener('click', function(event) {
      event.stopPropagation();
      const emailId = this.getAttribute('data-email-id');
      moveToTrash(emailId);
    });
  });

  // Botones de creación de etiquetas
  document.querySelectorAll('[data-action="create-tag"]').forEach(button => {
    button.addEventListener('click', function() {
      openCreateTagModal();
    });
  });

  // Checkboxes con stop propagation
  document.querySelectorAll('[data-action="stop-propagation"]').forEach(element => {
    element.addEventListener('click', function(event) {
      event.stopPropagation();
    });
  });

  // Botones de confirmación de eliminación de etiquetas
  document.querySelectorAll('[data-action="confirm-delete-tag"]').forEach(button => {
    button.addEventListener('click', function() {
      confirmDeleteTag();
    });
  });

  // Botones de cerrar modales
  document.querySelectorAll('[data-action="close-forwarding-modal"]').forEach(button => {
    button.addEventListener('click', function() {
      closeEditForwardingModal();
    });
  });

  document.querySelectorAll('[data-action="close-cleanup-modal"]').forEach(button => {
    button.addEventListener('click', function() {
      closeEditCleanupModal();
    });
  });

  document.querySelectorAll('[data-action="close-view-modal"]').forEach(button => {
    button.addEventListener('click', function() {
      closeViewEmailModal();
    });
  });

  // Botones de tabs de email
  document.querySelectorAll('[data-action="show-tab"]').forEach(button => {
    button.addEventListener('click', function() {
      const tab = this.getAttribute('data-tab');
      showEmailTab(tab);
    });
  });

  // Botones de marcar como procesado y mover a papelera
  document.querySelectorAll('[data-action="mark-processed"]').forEach(button => {
    button.addEventListener('click', function() {
      markEmailAsProcessed();
    });
  });

  document.querySelectorAll('[data-action="move-to-trash"]').forEach(button => {
    button.addEventListener('click', function() {
      moveEmailToTrash();
    });
  });

  document.querySelectorAll('[data-action="delete-permanent"]').forEach(button => {
    button.addEventListener('click', function() {
      deleteEmailPermanently();
    });
  });

  // Aplicar colores dinámicos a etiquetas
  applyDynamicColors();
});

// Funciones para Verificación de SMTP
function checkPublicIP() {
  const resultElement = document.getElementById('publicIPResult');
  resultElement.textContent = 'Verificando...';
  resultElement.className = '';
  
  fetch('https://api.ipify.org?format=json')
    .then(response => response.json())
    .then(data => {
      resultElement.textContent = data.ip;
      resultElement.className = 'success';
    })
    .catch(error => {
      resultElement.textContent = 'Error obteniendo IP: ' + error.message;
      resultElement.className = 'error';
    });
}

function checkSMTPServer() {
  const resultElement = document.getElementById('smtpServerResult');
  resultElement.textContent = 'Verificando servidor SMTP...';
  resultElement.className = '';
  
  fetch('/admin/smtp/status')
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        resultElement.textContent = `✅ Servidor SMTP activo - Puerto 25 funcionando`;
        resultElement.className = 'success';
      } else {
        resultElement.textContent = 'Servidor SMTP con errores: ' + data.message;
        resultElement.className = 'warning';
      }
    })
    .catch(error => {
      resultElement.textContent = '❌ Servidor SMTP no responde: ' + error.message;
      resultElement.className = 'error';
    });
}

// Función para aplicar colores dinámicos
function applyDynamicColors() {
  // Aplicar colores a iconos de etiquetas
  document.querySelectorAll('.email-folder.tag-folder').forEach(tagFolder => {
    const icon = tagFolder.querySelector('i.fa-tag');
    const button = tagFolder.querySelector('button[data-tag-color]');
    if (icon && button) {
      const color = button.getAttribute('data-tag-color');
      if (color) {
        icon.style.color = color;
      }
    }
  });

  // Aplicar colores a email tags
  document.querySelectorAll('.email-tag[data-color]').forEach(element => {
    const color = element.getAttribute('data-color');
    element.style.backgroundColor = color;
  });

  // Aplicar colores a iconos del menú contextual
  document.querySelectorAll('.context-menu-item i.fa-tag[data-color]').forEach(icon => {
    const color = icon.getAttribute('data-color');
    if (color) {
      icon.style.color = color;
    }
  });
}

// Funciones auxiliares para manejar visibilidad con clases CSS
function showElement(element) {
  if (typeof element === 'string') {
    element = document.getElementById(element);
  }
  if (element) {
    element.classList.remove('hidden');
    // Para modales que usan .edit-modal, agregar clase show
    if (element.classList.contains('edit-modal')) {
      element.classList.add('show');
    }
  }
}

function hideElement(element) {
  if (typeof element === 'string') {
    element = document.getElementById(element);
  }
  if (element) {
    element.classList.add('hidden');
    // Para modales que usan .edit-modal, remover clase show
    if (element.classList.contains('edit-modal')) {
      element.classList.remove('show');
    }
  }
}

function toggleElement(element) {
  if (typeof element === 'string') {
    element = document.getElementById(element);
  }
  if (element) {
    element.classList.toggle('hidden');
  }
}
