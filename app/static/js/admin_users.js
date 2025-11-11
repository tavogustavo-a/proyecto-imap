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
          userListContainer.innerHTML = renderUserItems(data.users);
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
    userSearchInput.addEventListener('input', function() {
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
            userListContainer.innerHTML = renderUserItems(data.users);
          } else {
            alert("Error: " + data.message);
          }
        })
        .catch(err => console.error("Error searchUsers:", err));
      }, 200);
    });
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
          userListContainer.innerHTML = renderUserItems(data.users);
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
          userListContainer.innerHTML = renderUserItems(data.users);
          // Ocultar popup y overlay al guardar correctamente
          editUserPopup.style.display = "none";
          const overlay = document.getElementById("editUserOverlay");
          if (overlay) overlay.style.display = "none";
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
          userListContainer.innerHTML = renderUserItems(data.users);
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
          userListContainer.innerHTML = renderUserItems(data.users);
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
      deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
      actionsDiv.appendChild(deleteBtn);
      
      userItem.appendChild(actionsDiv);
      container.appendChild(userItem);
    });
    
    // Convertir fragment a HTML string para compatibilidad
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(container);
    return tempDiv.innerHTML;
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Funciones para mostrar y ocultar popup de edición de usuario
  function showEditUserPopup() {
    const overlay = document.getElementById('editUserOverlay');
    const popup = document.getElementById('editUserPopup');
    if (overlay) overlay.style.display = 'block';
    if (popup) popup.style.display = 'block';
  }
  
  function hideEditUserPopup() {
    const overlay = document.getElementById('editUserOverlay');
    const popup = document.getElementById('editUserPopup');
    if (overlay) overlay.style.display = 'none';
    if (popup) popup.style.display = 'none';
  }

  // Event listeners para el popup
  const editUserOverlay = document.getElementById('editUserOverlay');
  
  if (editUserOverlay) {
    editUserOverlay.addEventListener('click', function(e) {
      // Solo cerrar si el clic es directamente en el overlay, no en el popup
      if (e.target === editUserOverlay) {
        hideEditUserPopup();
      }
    });
  }
  
  // También agregar listener para cerrar con ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && editUserPopup.style.display === 'block') {
      hideEditUserPopup();
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
});