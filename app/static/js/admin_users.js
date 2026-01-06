// app/static/js/admin_users.js

document.addEventListener("DOMContentLoaded", function() {

  const userSearchForm = document.getElementById("userSearchForm");
  const userSearchInput = document.getElementById("userSearchInput");
  const userListContainer = document.getElementById("userListContainer");

  const createUserBtn = document.getElementById("createUserBtn");
  const newUsername = document.getElementById("newUsername");
  const newUserPassword = document.getElementById("newUserPassword");
  const newUserColor = document.getElementById("newUserColor");
  const newUserPosition = document.getElementById("newUserPosition");
  const newUserCanSearchAny = document.getElementById("newUserCanSearchAny");
  const toggleNewPass = document.getElementById("toggleNewPass");
  const newUserFullName = document.getElementById("newUserFullName");
  const newUserPhone = document.getElementById("newUserPhone");
  const newUserEmail = document.getElementById("newUserEmail");

  // Edit Popup
  const editUserPopup = document.getElementById("editUserPopup");
  const editUserId = document.getElementById("editUserId");
  const editUserUsername = document.getElementById("editUserUsername");
  const editUserPassword = document.getElementById("editUserPassword");
  const editUserColor = document.getElementById("editUserColor");
  const editUserPosition = document.getElementById("editUserPosition");
  const editUserCanSearchAny = document.getElementById("editUserCanSearchAny");
  const editUserCanCreateSubusers = document.getElementById("editUserCanCreateSubusers");
  const editUserSaveBtn = document.getElementById("editUserSaveBtn");
  const editUserCancelBtn = document.getElementById("editUserCancelBtn");
  const toggleEditPass = document.getElementById("toggleEditPass");
  const editUserFullName = document.getElementById("editUserFullName");
  const editUserPhone = document.getElementById("editUserPhone");
  const editUserEmail = document.getElementById("editUserEmail");

  // Volver al Panel
  const btnVolverPanelTopUser = document.getElementById("btnVolverPanelTopUser");
  const btnVolverPanelBottomUser = document.getElementById("btnVolverPanelBottomUser");

  // Buscar usuarios
  if (userSearchForm && userSearchInput && userListContainer) {
    userSearchForm.addEventListener("submit", function(e) {
      e.preventDefault();
      userSearchInput.value = "";
      fetch(`/admin/search_users_ajax?query=`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Limpiar contenedor
          while(userListContainer.firstChild) {
            userListContainer.removeChild(userListContainer.firstChild);
          }
          // Agregar elementos directamente sin usar innerHTML
          const fragment = renderUserItems(data.users);
          userListContainer.appendChild(fragment);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error limpiar usuarios:", err));
    });
  }

  // --- Búsqueda instantánea de usuarios ---
  if (userSearchInput && userListContainer) {
    let searchTimeout = null;
    
    // Función de búsqueda reutilizable
    function performSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = userSearchInput.value.trim();
        fetch(`/admin/search_users_ajax?query=${encodeURIComponent(query)}`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok") {
            // Limpiar contenedor
          while(userListContainer.firstChild) {
            userListContainer.removeChild(userListContainer.firstChild);
          }
          // Agregar elementos directamente sin usar innerHTML
          const fragment = renderUserItems(data.users);
          userListContainer.appendChild(fragment);
          } else {
            alert("Error: " + data.message);
          }
        })
        .catch(err => console.error("Error searchUsers:", err));
      }, 150); // Reducido de 200ms a 150ms para mejor respuesta
    }
    
    // Múltiples listeners para compatibilidad con Chrome y otros navegadores
    userSearchInput.addEventListener('input', performSearch);
    userSearchInput.addEventListener('keyup', function(e) {
      // Evitar búsqueda en teclas especiales
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
        return;
      }
      performSearch();
    });
    // Para campos type="search" en Chrome
    userSearchInput.addEventListener('search', performSearch);
  }

  // Función para verificar si un email ya existe
  async function checkEmailExists(email) {
    try {
      const response = await fetch(`/admin/check_email_exists?email=${encodeURIComponent(email)}`);
      const data = await response.json();
      return data.exists;
    } catch (err) {
      console.error("Error checking email:", err);
      return false;
    }
  }

  // Crear usuario
  const createUserForm = document.getElementById("createUserForm");
  if (createUserForm) {
    createUserForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      const usernameVal = newUsername.value.trim();
      const passwordVal = newUserPassword.value;
      const colorVal = newUserColor.value.trim() || "#ffffff";
      const positionVal = newUserPosition.value.trim() || "1";
      const canSearch = newUserCanSearchAny.checked;
      const fullNameVal = newUserFullName.value.trim();
      const phoneVal = newUserPhone.value.trim();
      const emailVal = newUserEmail.value.trim();

      if (!usernameVal || !passwordVal) {
        alert("Usuario y contraseña son obligatorios.");
        return;
      }
      if (!emailVal) {
        alert("El correo electrónico es obligatorio.");
        return;
      }

      // Verificar si el email ya existe
      const emailExists = await checkEmailExists(emailVal);
      if (emailExists) {
        alert("El correo electrónico ya está registrado por otro usuario. Por favor, usa un correo diferente.");
        return;
      }

      const payload = {
        username: usernameVal,
        password: passwordVal,
        color: colorVal,
        position: positionVal,
        can_search_any: canSearch,
        full_name: fullNameVal,
        phone: phoneVal,
        email: emailVal
      };

      fetch("/admin/create_user_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Limpiar contenedor
          while(userListContainer.firstChild) {
            userListContainer.removeChild(userListContainer.firstChild);
          }
          // Agregar elementos directamente sin usar innerHTML
          const fragment = renderUserItems(data.users);
          userListContainer.appendChild(fragment);
          // limpiar
          newUsername.value = "";
          newUserPassword.value = "";
          newUserColor.value = "#ffffff";
          newUserPosition.value = "1";
          newUserCanSearchAny.checked = false;
          newUserFullName.value = "";
          newUserPhone.value = "";
          newUserEmail.value = "";
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        console.error("Error createUser:", err);
        alert("Error de conexión. Verifica tu conexión a internet e intenta nuevamente.");
      });
    });
  }

  // Mostrar/Ocultar pass en "Crear"
  if (toggleNewPass && newUserPassword) {
    toggleNewPass.addEventListener("click", () => {
      if (newUserPassword.type === "password") {
        newUserPassword.type = "text";
      } else {
        newUserPassword.type = "password";
      }
    });
  }

  // Editar: Mostrar/Ocultar pass
  if (toggleEditPass && editUserPassword) {
    toggleEditPass.addEventListener("click", () => {
      if (editUserPassword.type === "password") {
        editUserPassword.type = "text";
      } else {
        editUserPassword.type = "password";
      }
    });
  }

  // Guardar edición
  const editUserForm = document.getElementById("editUserForm");
  if (editUserForm) {
    editUserForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const userIdVal = editUserId.value;
      const usernameVal = editUserUsername.value.trim();
      const passwordVal = editUserPassword.value;
      const colorVal = editUserColor.value.trim() || "#ffffff";
      const positionVal = editUserPosition.value.trim() || "1";
      const canSearch = editUserCanSearchAny.checked;
      const canCreateSub = editUserCanCreateSubusers.checked;
      const editUserCanAddOwnEmails = document.getElementById("editUserCanAddOwnEmails");
      const canAddOwnEmails = editUserCanAddOwnEmails ? editUserCanAddOwnEmails.checked : false;
      const editUserCanBulkDeleteEmails = document.getElementById("editUserCanBulkDeleteEmails");
      const canBulkDeleteEmails = editUserCanBulkDeleteEmails ? editUserCanBulkDeleteEmails.checked : false;
      const editUserCanManage2FAEmails = document.getElementById("editUserCanManage2FAEmails");
      const canManage2FAEmails = editUserCanManage2FAEmails ? editUserCanManage2FAEmails.checked : false;
      const fullNameVal = editUserFullName.value.trim();
      const phoneVal = editUserPhone.value.trim();
      const emailVal = editUserEmail.value.trim();

      if (!userIdVal || !usernameVal) {
        alert("Faltan datos para editar el usuario.");
        return;
      }
      if (!emailVal) {
        alert("El correo electrónico es obligatorio.");
        return;
      }

      const payload = {
        user_id: parseInt(userIdVal),
        username: usernameVal,
        password: passwordVal,
        color: colorVal,
        position: positionVal,
        can_search_any: canSearch,
        can_create_subusers: canCreateSub,
        can_add_own_emails: canAddOwnEmails,
        can_bulk_delete_emails: canBulkDeleteEmails,
        can_manage_2fa_emails: canManage2FAEmails,
        full_name: fullNameVal,
        phone: phoneVal,
        email: emailVal
      };

      fetch("/admin/update_user_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Limpiar contenedor
          while(userListContainer.firstChild) {
            userListContainer.removeChild(userListContainer.firstChild);
          }
          // Agregar elementos directamente sin usar innerHTML
          const fragment = renderUserItems(data.users);
          userListContainer.appendChild(fragment);
          // Ocultar popup y overlay al guardar correctamente
          editUserPopup.classList.remove('popup-show');
          editUserPopup.classList.add('popup-hide');
          const overlay = document.getElementById("editUserOverlay");
          if (overlay) {
            overlay.classList.remove('overlay-show');
            overlay.classList.add('overlay-hide');
          }
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        console.error("Error updateUser:", err);
        alert("Error de conexión al actualizar usuario. Verifica tu conexión e intenta nuevamente.");
      });
    });
  }

  // Cancelar edición
  if (editUserCancelBtn) {
    editUserCancelBtn.addEventListener("click", function() {
      hideEditUserPopup();
    });
  }

  // Listener para botones "Volver al Panel"
  [btnVolverPanelTopUser, btnVolverPanelBottomUser].forEach(btn => {
    if (btn) {
      const dashboardUrl = btn.dataset.dashboardUrl;
      if (dashboardUrl) {
        btn.addEventListener("click", () => {
          window.location.href = dashboardUrl;
        });
      } else {
        console.error("No se encontró data-dashboard-url en botón Volver (usuarios)");
      }
    }
  });

  // Delegación de eventos optimizada en el contenedor de usuarios
  userListContainer.addEventListener("click", function(e) {
    const target = e.target;
    
    // Toggle user On/Off
    if (target.classList.contains("toggle-user")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (target.disabled) return;
      target.disabled = true;
      
      const userId = target.getAttribute("data-id");
      const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
      const payload = { user_id: parseInt(userId), currently_enabled: currentlyEnabled };
      
      fetch("/admin/toggle_user_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        if (data.status === "ok") {
          // Limpiar contenedor
          while(userListContainer.firstChild) {
            userListContainer.removeChild(userListContainer.firstChild);
          }
          // Agregar elementos directamente sin usar innerHTML
          const fragment = renderUserItems(data.users);
          userListContainer.appendChild(fragment);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        console.error("Error toggleUser:", err);
        if (err.message.includes("403")) {
          alert("Error: No tienes permisos para realizar esta acción. Verifica que estés logueado correctamente.");
        } else if (err.message.includes("Unexpected token")) {
          alert("Error: El servidor devolvió una respuesta inesperada. Recarga la página e intenta nuevamente.");
        } else {
          alert("Error al cambiar el estado del usuario. Intenta nuevamente.");
        }
      })
      .finally(() => {
        target.disabled = false;
      });
    }

    // Eliminar usuario
    if (target.classList.contains("delete-user") || target.closest(".delete-user")) {
      e.preventDefault();
      e.stopPropagation();
      
      const button = target.classList.contains("delete-user") ? target : target.closest(".delete-user");
      
      // Prevenir múltiples clicks rápidos
      if (button.disabled) return;
      button.disabled = true;
      
      const userId = button.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este usuario?")) {
        button.disabled = false;
        return;
      }
      
      const payload = { user_id: parseInt(userId) };
      fetch("/admin/delete_user_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Limpiar contenedor
          while(userListContainer.firstChild) {
            userListContainer.removeChild(userListContainer.firstChild);
          }
          // Agregar elementos directamente sin usar innerHTML
          const fragment = renderUserItems(data.users);
          userListContainer.appendChild(fragment);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        console.error("Error deleteUser:", err);
        alert("Error al eliminar el usuario. Intenta nuevamente.");
      })
      .finally(() => {
        button.disabled = false;
      });
    }

    // Edit user (Abrir popup)
    if (target.classList.contains("edit-user-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (target.disabled) return;
      target.disabled = true;
      
      const userId = target.getAttribute("data-id");
      const username = target.getAttribute("data-username");
      const color = target.getAttribute("data-color") || "#ffffff";
      const position = target.getAttribute("data-position") || "1";
      const canSearch = (target.getAttribute("data-cansearch") === "true");
      const canCreateSubusers = (target.getAttribute("data-cancreatesubusers") === "true");
      const canAddOwnEmails = (target.getAttribute("data-canaddownemails") === "true");
      const canBulkDeleteEmails = (target.getAttribute("data-canbulkdeleteemails") === "true");
      const canManage2FAEmailsAttr = target.getAttribute("data-canmanage2faemails");
      const canManage2FAEmails = (canManage2FAEmailsAttr === "true");
      const fullName = target.getAttribute("data-fullname") || "";
      const phone = target.getAttribute("data-phone") || "";
      const email = target.getAttribute("data-email") || "";

      editUserId.value = userId;
      editUserUsername.value = username;
      editUserPassword.value = "";
      editUserColor.value = color;
      editUserPosition.value = position;
      editUserCanSearchAny.checked = canSearch;
      editUserCanCreateSubusers.checked = canCreateSubusers;
      const editUserCanAddOwnEmailsCheckbox = document.getElementById("editUserCanAddOwnEmails");
      if (editUserCanAddOwnEmailsCheckbox) editUserCanAddOwnEmailsCheckbox.checked = canAddOwnEmails;
      const editUserCanBulkDeleteEmailsCheckbox = document.getElementById("editUserCanBulkDeleteEmails");
      if (editUserCanBulkDeleteEmailsCheckbox) editUserCanBulkDeleteEmailsCheckbox.checked = canBulkDeleteEmails;
      const editUserCanManage2FAEmailsCheckbox = document.getElementById("editUserCanManage2FAEmails");
      if (editUserCanManage2FAEmailsCheckbox) editUserCanManage2FAEmailsCheckbox.checked = canManage2FAEmails;
      editUserFullName.value = fullName;
      editUserPhone.value = phone;
      editUserEmail.value = email;

      // Mostrar popup y overlay correctamente
      showEditUserPopup();
      
      // Re-habilitar el botón después de un breve delay
      setTimeout(() => {
        target.disabled = false;
      }, 100);
    }

    // Botón "Email" -> user_emails/<user_id>
    if (target.classList.contains("email-user")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (target.disabled) return;
      target.disabled = true;
      
      const userId = target.getAttribute("data-id");
      window.location.href = `/admin/user_emails/${userId}`;
      
      // Re-habilitar el botón después de un breve delay
      setTimeout(() => {
        target.disabled = false;
      }, 100);
    }
  });

  // Al cargar la página, inicializamos la lista
  initUserList();

  function initUserList() {
    fetch("/admin/search_users_ajax", {
      method: "GET",
      headers: { "X-CSRFToken": getCsrfToken() }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "ok") {
        userListContainer.innerHTML = renderUserItems(data.users);
      } else {
        alert("Error: " + data.message);
      }
    })
    .catch(err => console.error("Error initUserList:", err));
  }

  // Función helper para escapar HTML y prevenir XSS
  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderUserItems(users) {
    const container = document.createDocumentFragment();
    
    users.forEach(u => {
      // Crear elementos DOM en lugar de usar innerHTML con interpolación
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.dataset.userColor = escapeHtml(u.color || '#ffffff');
      
      // Aplicar colores usando CSS custom properties (sin estilos inline)
      const userBgColor = u.color || "#ffffff";
      userItem.style.setProperty('--user-bg-color', userBgColor);
      userItem.style.setProperty('--user-text-color', '#333333');
      
      const usernameDiv = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = escapeHtml(u.username);
      usernameDiv.appendChild(strong);
      userItem.appendChild(usernameDiv);
      
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'user-item-actions';
      
      // Botón Off/On
      const toggleBtn = document.createElement('button');
      toggleBtn.className = u.enabled ? 'btn-red toggle-user' : 'btn-green toggle-user';
      toggleBtn.dataset.id = u.id;
      toggleBtn.dataset.enabled = u.enabled ? 'true' : 'false';
      toggleBtn.textContent = u.enabled ? 'Off' : 'On';
      actionsDiv.appendChild(toggleBtn);
      
      // Botón Email
      const emailBtn = document.createElement('button');
      emailBtn.className = 'btn-blue email-user';
      emailBtn.dataset.id = u.id;
      emailBtn.textContent = 'Email';
      actionsDiv.appendChild(emailBtn);
      
      // Botón Editar
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-orange edit-user-btn';
      editBtn.dataset.id = u.id;
      editBtn.dataset.username = escapeHtml(u.username || '');
      editBtn.dataset.color = escapeHtml(u.color || '');
      editBtn.dataset.position = escapeHtml(u.position || '');
      editBtn.dataset.cansearch = u.can_search_any ? 'true' : 'false';
      editBtn.dataset.cancreatesubusers = u.can_create_subusers ? 'true' : 'false';
      editBtn.dataset.canaddownemails = (u.can_add_own_emails === true) ? 'true' : 'false';
      editBtn.dataset.canbulkdeleteemails = (u.can_bulk_delete_emails === true) ? 'true' : 'false';
      editBtn.dataset.canmanage2faemails = (u.can_manage_2fa_emails === true) ? 'true' : 'false';
      editBtn.dataset.fullname = escapeHtml(u.full_name || '');
      editBtn.dataset.phone = escapeHtml(u.phone || '');
      editBtn.dataset.email = escapeHtml(u.email || '');
      editBtn.textContent = 'Editar';
      actionsDiv.appendChild(editBtn);
      
      // Botón Eliminar
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-panel btn-red btn-sm delete-user';
      deleteBtn.dataset.id = u.id;
      deleteBtn.title = 'Eliminar';
      const icon = document.createElement('i');
      icon.classList.add('fas', 'fa-trash');
      deleteBtn.appendChild(icon);
      actionsDiv.appendChild(deleteBtn);
      
      userItem.appendChild(actionsDiv);
      container.appendChild(userItem);
    });
    
    // Devolver el fragment directamente (más seguro que convertir a HTML string)
    return container;
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Funciones para mostrar y ocultar popup de edición de usuario
  function showEditUserPopup() {
    const overlay = document.getElementById('editUserOverlay');
    const popup = document.getElementById('editUserPopup');
    if (overlay) {
      overlay.classList.remove('overlay-hide');
      overlay.classList.add('overlay-show');
    }
    if (popup) {
      popup.classList.remove('popup-hide');
      popup.classList.add('popup-show');
    }
  }
  
  function hideEditUserPopup() {
    const overlay = document.getElementById('editUserOverlay');
    const popup = document.getElementById('editUserPopup');
    if (overlay) {
      overlay.classList.remove('overlay-show');
      overlay.classList.add('overlay-hide');
    }
    if (popup) {
      popup.classList.remove('popup-show');
      popup.classList.add('popup-hide');
    }
    // Limpiar userId cuando se cierra el modal
    editUserCurrentUserId = null;
  }

  // Event listeners para el popup
  const editUserOverlay = document.getElementById('editUserOverlay');
  
  // Función para manejar clic en overlay (compatible con Chrome)
  function handleOverlayClick(e) {
    // Verificar que el clic es directamente en el overlay
    if (e.target === editUserOverlay || e.target.id === 'editUserOverlay') {
      e.preventDefault();
      e.stopPropagation();
      hideEditUserPopup();
      return false;
    }
  }
  
  if (editUserOverlay) {
    // Múltiples formas de capturar el evento para compatibilidad con Chrome
    editUserOverlay.addEventListener('click', handleOverlayClick, true); // Capture phase
    editUserOverlay.addEventListener('mousedown', function(e) {
      // También capturar mousedown para mejor compatibilidad
      if (e.target === editUserOverlay || e.target.id === 'editUserOverlay') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Prevenir que el popup cierre cuando se hace clic dentro de él
    if (editUserPopup) {
      editUserPopup.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      
      // También prevenir mousedown dentro del popup
      editUserPopup.addEventListener('mousedown', function(e) {
        e.stopPropagation();
      });
    }
  }
  
  // También agregar listener para cerrar con ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      if (editUserPopup && editUserPopup.classList.contains('popup-show')) {
        hideEditUserPopup();
      }
    }
  });

  // Validación de entrada para campos de teléfono - solo permitir números y +
  function validatePhoneInput(input) {
    input.addEventListener('input', function(e) {
      // Remover cualquier carácter que no sea número o +
      let value = e.target.value;
      let cleanValue = value.replace(/[^0-9+]/g, '');
      
      // Asegurar que el + solo esté al inicio
      if (cleanValue.includes('+')) {
        let plusIndex = cleanValue.indexOf('+');
        if (plusIndex > 0) {
          cleanValue = '+' + cleanValue.replace(/\+/g, '');
        }
      }
      
      // Si el valor cambió, actualizarlo
      if (value !== cleanValue) {
        e.target.value = cleanValue;
      }
    });

    // Prevenir pegado de caracteres no válidos
    input.addEventListener('paste', function(e) {
      e.preventDefault();
      let paste = (e.clipboardData || window.clipboardData).getData('text');
      let cleanPaste = paste.replace(/[^0-9+]/g, '');
      
      // Asegurar que el + solo esté al inicio
      if (cleanPaste.includes('+')) {
        let plusIndex = cleanPaste.indexOf('+');
        if (plusIndex > 0) {
          cleanPaste = '+' + cleanPaste.replace(/\+/g, '');
        }
      }
      
      e.target.value = cleanPaste;
    });

    // Prevenir teclas no válidas
    input.addEventListener('keydown', function(e) {
      // Permitir teclas de control (backspace, delete, tab, escape, enter, etc.)
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab' || 
          e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowLeft' || 
          e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
          e.ctrlKey || e.metaKey) {
        return;
      }
      
      // Permitir solo números y +
      if (!/[0-9+]/.test(e.key)) {
        e.preventDefault();
      }
      
      // Si es +, solo permitir si no hay otro + o si está al inicio
      if (e.key === '+') {
        let currentValue = e.target.value;
        let cursorPos = e.target.selectionStart;
        
        // Si ya hay un + y no está al inicio del cursor, prevenir
        if (currentValue.includes('+') && cursorPos > 0) {
          e.preventDefault();
        }
      }
    });
  }

  // Aplicar validación a los campos de teléfono
  if (newUserPhone) {
    validatePhoneInput(newUserPhone);
  }
  
  if (editUserPhone) {
    validatePhoneInput(editUserPhone);
  }

  // ======= ELIMINACIÓN MASIVA DE CORREOS DE TODOS LOS USUARIOS =======
  const bulkDeleteEmailsForm = document.getElementById("bulkDeleteEmailsForm");
  const bulkDeleteEmailsInput = document.getElementById("bulkDeleteEmailsInput");
  const bulkDeleteEmailsBtn = document.getElementById("bulkDeleteEmailsBtn");
  const bulkDeleteEmailsMessage = document.getElementById("bulkDeleteEmailsMessage");

  // Función para parsear correos del texto (separados por comas, espacios o saltos de línea)
  function parseEmailsFromText(text) {
    if (!text || !text.trim()) {
      return [];
    }
    
    // Dividir por comas, espacios, saltos de línea, punto y coma, etc.
    const emails = text
      .split(/[,\s\n\r;]+/)
      .map(email => email.trim().toLowerCase())
      .filter(email => {
        // Validar formato básico de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return email && emailRegex.test(email);
      });
    
    return [...new Set(emails)]; // Eliminar duplicados
  }

  // Función para mostrar mensaje
  function showBulkDeleteMessage(message, isError = false) {
    if (!bulkDeleteEmailsMessage) return;
    
    bulkDeleteEmailsMessage.textContent = message;
    bulkDeleteEmailsMessage.className = `mt-05 text-center ${isError ? 'text-danger' : 'text-success'}`;
    bulkDeleteEmailsMessage.classList.remove('hide-element');
    bulkDeleteEmailsMessage.classList.add('show-block');
    
    // Ocultar mensaje después de 5 segundos si es éxito
    if (!isError) {
      setTimeout(() => {
        if (bulkDeleteEmailsMessage) {
          bulkDeleteEmailsMessage.classList.remove('show-block');
          bulkDeleteEmailsMessage.classList.add('hide-element');
        }
      }, 5000);
    }
  }

  // Manejar envío del formulario
  if (bulkDeleteEmailsForm && bulkDeleteEmailsInput && bulkDeleteEmailsBtn) {
    bulkDeleteEmailsForm.addEventListener("submit", function(e) {
      e.preventDefault();
      
      const text = bulkDeleteEmailsInput.value.trim();
      if (!text) {
        showBulkDeleteMessage("Por favor ingresa al menos un correo.", true);
        return;
      }

      const emailsToDelete = parseEmailsFromText(text);
      if (emailsToDelete.length === 0) {
        showBulkDeleteMessage("No se encontraron correos válidos en el texto ingresado.", true);
        return;
      }

      // Confirmar antes de eliminar
      if (!confirm(`¿Estás seguro de eliminar ${emailsToDelete.length} correo(s) de todos los usuarios?\n\nCorreos a eliminar:\n${emailsToDelete.join('\n')}`)) {
        return;
      }

      // Deshabilitar botón y mostrar estado de carga
      bulkDeleteEmailsBtn.disabled = true;
      bulkDeleteEmailsBtn.textContent = 'Eliminando...';
      bulkDeleteEmailsMessage.classList.remove('show-block');
      bulkDeleteEmailsMessage.classList.add('hide-element');

      // Enviar petición al servidor
      fetch("/admin/delete_emails_from_all_users_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ emails: emailsToDelete })
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errData => {
            throw new Error(errData.message || `Error del servidor: ${response.status}`);
          });
        }
        return response.json();
      })
      .then(data => {
        if (data.status === "ok") {
          showBulkDeleteMessage(
            data.message || `Se eliminaron ${data.deleted_count || emailsToDelete.length} instancia(s) de correo(s) de todos los usuarios.`,
            false
          );
          bulkDeleteEmailsInput.value = ""; // Limpiar el campo
        } else {
          showBulkDeleteMessage(data.message || "Error desconocido al eliminar correos.", true);
        }
      })
      .catch(err => {
        console.error("Error al eliminar correos masivamente:", err);
        showBulkDeleteMessage(`Error: ${err.message}`, true);
      })
      .finally(() => {
        bulkDeleteEmailsBtn.disabled = false;
        bulkDeleteEmailsBtn.textContent = 'Eliminar Correos de Todos los Usuarios';
      });
    });
  }

  // ======= FIN ELIMINACIÓN MASIVA DE CORREOS =======
});