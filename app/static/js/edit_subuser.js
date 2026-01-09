// console.log("--- edit_subuser.js: Archivo parseado ---"); // Log 1: Fuera de todo

document.addEventListener('DOMContentLoaded', function() {
  // console.log("--- edit_subuser.js: DOMContentLoaded disparado ---"); // Log 2: Dentro del listener

  function getCsrfToken(){
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

    // Seleccionar la sección de correos dentro de la segunda tarjeta
    const emailSection = document.getElementById('email-management-section');
    
    // Obtener datos desde atributos data-*
    const subuserId = emailSection ? emailSection.dataset.subuserId : null;
    const saveUrl = emailSection ? emailSection.dataset.saveUrl : null;

    // Salir si no se encuentran los elementos necesarios o los datos
    if (!emailSection || !subuserId || !saveUrl) {
        // console.warn("Elementos necesarios para la gestión de correos de subusuario no encontrados."); // Eliminado
        return; 
    }

    // El resto del código original, usando las variables subuserId y saveUrl obtenidas arriba
    // ... (Buscar elementos internos: searchInput, clearSearchBtn, etc.) ...
    const searchInput = emailSection.querySelector('#email-search-input');
    const clearSearchBtn = emailSection.querySelector('#email-search-clear-btn');
    const selectAllBtn = emailSection.querySelector('.select-all-emails');
    const deselectAllBtn = emailSection.querySelector('.deselect-all-emails');
    const saveBtn = emailSection.querySelector('.save-subuser-emails');
    const statusMsgSpan = emailSection.querySelector('.save-status-msg');
    const checkboxListDiv = emailSection.querySelector('.email-checkbox-list');

    // --- DEBUGGING --- 
    // console.log("checkboxListDiv encontrado:", checkboxListDiv); // Eliminado
    // -----------------

    if (checkboxListDiv) {
        // --- DEBUGGING --- 
        // console.log("Entrando al bloque if(checkboxListDiv)..."); // Eliminado
        // -----------------
        const emailItems = checkboxListDiv.querySelectorAll('.email-item');
        // console.log("emailItems encontrados:", emailItems); // Eliminado

        // --- Filtro de Búsqueda Masiva ---
        if (searchInput && emailItems.length > 0) {
            searchInput.addEventListener('input', function() {
                const searchTerms = searchInput.value
                                        .split(/[\s,;\n]+/)
                                        .map(term => term.trim().toLowerCase())
                                        .filter(term => term.length > 0);

                emailItems.forEach(item => {
                    const emailText = item.getAttribute('data-email-text') || '';
                    let matchFound = searchTerms.length === 0 || searchTerms.some(term => emailText.includes(term));
                    if (matchFound) {
                        item.classList.remove('hidden-email');
                    } else {
                        item.classList.add('hidden-email');
                    }
                });
            });
        }

        // --- Botón Limpiar Búsqueda ---
        if (clearSearchBtn && searchInput) {
            clearSearchBtn.addEventListener('click', function(e) {
                e.preventDefault();
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        // --- Manejadores de Botones (Activar/Desactivar/Guardar) ---
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const visibleCheckboxes = checkboxListDiv.querySelectorAll('.email-item:not(.hidden-email) .subuser-email-checkbox');
                visibleCheckboxes.forEach(cb => cb.checked = true);
            });
        }
        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const visibleCheckboxes = checkboxListDiv.querySelectorAll('.email-item:not(.hidden-email) .subuser-email-checkbox');
                visibleCheckboxes.forEach(cb => cb.checked = false);
            });
        }
        if (saveBtn) {
             saveBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const checkedCheckboxes = checkboxListDiv.querySelectorAll('.subuser-email-checkbox:checked');
                const selectedEmails = Array.from(checkedCheckboxes).map(cb => cb.getAttribute('data-email'));

                if (statusMsgSpan) {
                     statusMsgSpan.textContent = "Guardando...";
                     statusMsgSpan.style.color = "orange";
                }
                saveBtn.disabled = true;

                // Usar la URL obtenida del atributo data-save-url
                fetch(saveUrl, { 
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    },
                    body: JSON.stringify({
                        // Usar el subuserId obtenido del atributo data-subuser-id
                        subuser_id: parseInt(subuserId, 10), // Asegurar que es un número 
                        selected_emails: selectedEmails
                    })
                })
                .then(response => {
                    if (!response.ok) {
                        return response.json().then(errData => {
                            throw new Error(errData.message || `Error ${response.status}: ${response.statusText}`);
                        }).catch(() => {
                            throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.status === "ok") {
                        if (statusMsgSpan) {
                            statusMsgSpan.textContent = "¡Cambios guardados!";
                            statusMsgSpan.style.color = "green";
                            setTimeout(() => { statusMsgSpan.textContent = ""; }, 3500);
                        }
                    } else {
                        throw new Error(data.message || "Error desconocido al guardar.");
                    }
                })
                .catch(error => {
                    console.error("Error guardando correos:", error);
                    if (statusMsgSpan) {
                        statusMsgSpan.textContent = `Error: ${error.message}`;
                        statusMsgSpan.style.color = "red";
                    }
                })
                .finally(() => {
                    saveBtn.disabled = false;
                });
            });
        }
    } // Fin if (checkboxListDiv)
    
    // --- Gestión de Herramientas Públicas Permitidas ---
    const toolsSection = document.getElementById('tools-management-section');
    if (toolsSection) {
      const subuserId = toolsSection.dataset.subuserId;
      const toolCheckboxes = toolsSection.querySelectorAll('.subuser-tool-checkbox');
      const selectAllToolsBtn = toolsSection.querySelector('.select-all-tools');
      const deselectAllToolsBtn = toolsSection.querySelector('.deselect-all-tools');
      const saveToolsBtn = toolsSection.querySelector('.save-subuser-tools');
      const statusMsgTools = toolsSection.querySelector('.save-status-msg-tools');

      // Seleccionar todas
      if (selectAllToolsBtn) {
        selectAllToolsBtn.addEventListener('click', function(e) {
          e.preventDefault();
          toolCheckboxes.forEach(cb => cb.checked = true);
        });
      }
      // Desmarcar todas
      if (deselectAllToolsBtn) {
        deselectAllToolsBtn.addEventListener('click', function(e) {
          e.preventDefault();
          toolCheckboxes.forEach(cb => cb.checked = false);
        });
      }
      // Guardar cambios
      if (saveToolsBtn) {
        saveToolsBtn.addEventListener('click', function(e) {
          e.preventDefault();
          const selectedResources = Array.from(toolCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => ({
              id: parseInt(cb.dataset.toolId, 10),
              type: cb.dataset.toolType
            }));
          if (statusMsgTools) {
            statusMsgTools.textContent = 'Guardando...';
            statusMsgTools.style.color = 'orange';
          }
          saveToolsBtn.disabled = true;
          fetch(`/subusers/save_tools_permissions/${subuserId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ tool_ids: selectedResources })
          })
          .then(response => {
            if (!response.ok) {
              return response.json().then(errData => {
                throw new Error(errData.message || `Error ${response.status}: ${response.statusText}`);
              }).catch(() => {
                throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
              });
            }
            return response.json();
          })
          .then(data => {
            if (data.status === 'ok') {
              if (statusMsgTools) {
                statusMsgTools.textContent = '¡Cambios guardados!';
                statusMsgTools.style.color = 'green';
                setTimeout(() => { statusMsgTools.textContent = ''; }, 3500);
              }
            } else {
              throw new Error(data.message || 'Error desconocido al guardar.');
            }
          })
          .catch(error => {
            if (statusMsgTools) {
              statusMsgTools.textContent = `Error: ${error.message}`;
              statusMsgTools.style.color = 'red';
            }
          })
          .finally(() => {
            saveToolsBtn.disabled = false;
          });
        });
      }
    }

    // --- Permiso de acceso a tienda (can_access_store) ---
    const canAccessStoreCheckbox = document.getElementById('canAccessStoreCheckbox');
    const storePermissionStatus = document.getElementById('store-permission-status');
    if (canAccessStoreCheckbox) {
      canAccessStoreCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_store_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_access_store: canAccessStoreCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (storePermissionStatus) {
              storePermissionStatus.textContent = canAccessStoreCheckbox.checked
                ? 'Permiso de tienda activado'
                : 'Permiso de tienda desactivado';
              storePermissionStatus.style.color = canAccessStoreCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { storePermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (storePermissionStatus) {
              storePermissionStatus.textContent = 'Error al guardar';
              storePermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (storePermissionStatus) {
            storePermissionStatus.textContent = 'Error de red al guardar';
            storePermissionStatus.style.color = 'red';
          }
        });
      });
    }

    // --- Permiso de uso de cupones (can_use_coupons) ---
    const canUseCouponsCheckbox = document.getElementById('canUseCouponsCheckbox');
    const couponsPermissionStatus = document.getElementById('coupons-permission-status');
    if (canUseCouponsCheckbox) {
      canUseCouponsCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_coupons_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_use_coupons: canUseCouponsCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (couponsPermissionStatus) {
              couponsPermissionStatus.textContent = canUseCouponsCheckbox.checked
                ? 'Permiso de cupones activado'
                : 'Permiso de cupones desactivado';
              couponsPermissionStatus.style.color = canUseCouponsCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { couponsPermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (couponsPermissionStatus) {
              couponsPermissionStatus.textContent = 'Error al guardar';
              couponsPermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (couponsPermissionStatus) {
            couponsPermissionStatus.textContent = 'Error de red al guardar';
            couponsPermissionStatus.style.color = 'red';
          }
        });
      });
    }


    // --- Permiso de chat (can_chat) ---
    const canChatCheckbox = document.getElementById('canChatCheckbox');
    const chatPermissionStatus = document.getElementById('chat-permission-status');
    if (canChatCheckbox) {
      canChatCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_chat_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_chat: canChatCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (chatPermissionStatus) {
              chatPermissionStatus.textContent = canChatCheckbox.checked
                ? 'Permiso de chat activado'
                : 'Permiso de chat desactivado';
              chatPermissionStatus.style.color = canChatCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { chatPermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (chatPermissionStatus) {
              chatPermissionStatus.textContent = 'Error al guardar';
              chatPermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (chatPermissionStatus) {
            chatPermissionStatus.textContent = 'Error de red al guardar';
            chatPermissionStatus.style.color = 'red';
          }
        });
      });
    }

    // ======= BOTÓN DE NAVEGACIÓN 'VOLVER' ========
    const btnVolverSubuserLista = document.getElementById("btnVolverSubuserLista");
    if (btnVolverSubuserLista) {
        btnVolverSubuserLista.addEventListener("click", function() {
            const url = this.getAttribute("data-url");
            if (url) {
                window.location.href = url;
            }
        });
    }
    // ======= FIN BOTÓN 'VOLVER' =======
}); 