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

  // Buscar usuarios
  if (userSearchForm && userSearchInput && userListContainer) {
    userSearchForm.addEventListener("submit", function(e) {
      e.preventDefault();
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
    });
  }

  // Crear usuario
  if (createUserBtn) {
    createUserBtn.addEventListener("click", function() {
      const usernameVal = newUsername.value.trim();
      const passwordVal = newUserPassword.value;
      const colorVal = newUserColor.value.trim() || "#ffffff";
      const positionVal = newUserPosition.value.trim() || "1";
      const canSearch = newUserCanSearchAny.checked;

      if (!usernameVal || !passwordVal) {
        alert("Usuario y contraseña son obligatorios.");
        return;
      }

      const payload = {
        username: usernameVal,
        password: passwordVal,
        color: colorVal,
        position: positionVal,
        can_search_any: canSearch
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
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error createUser:", err));
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
  if (editUserSaveBtn) {
    editUserSaveBtn.addEventListener("click", function() {
      const userIdVal = editUserId.value;
      const usernameVal = editUserUsername.value.trim();
      const passwordVal = editUserPassword.value;
      const colorVal = editUserColor.value.trim() || "#ffffff";
      const positionVal = editUserPosition.value.trim() || "1";
      const canSearch = editUserCanSearchAny.checked;
      const canCreateSub = editUserCanCreateSubusers.checked;

      if (!userIdVal || !usernameVal) {
        alert("Faltan datos para editar el usuario.");
        return;
      }

      const payload = {
        user_id: parseInt(userIdVal),
        username: usernameVal,
        password: passwordVal,
        color: colorVal,
        position: positionVal,
        can_search_any: canSearch,
        can_create_subusers: canCreateSub
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
          editUserPopup.style.display = "none";
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error updateUser:", err));
    });
  }

  // Cancelar edición
  if (editUserCancelBtn) {
    editUserCancelBtn.addEventListener("click", function() {
      editUserPopup.style.display = "none";
    });
  }

  // Delegación de eventos en la lista
  document.addEventListener("click", function(e) {
    // Toggle user On/Off
    if (e.target.classList.contains("toggle-user")) {
      e.preventDefault();
      const userId = e.target.getAttribute("data-id");
      const currentlyEnabled = (e.target.getAttribute("data-enabled") === "true");
      const payload = { user_id: parseInt(userId), currently_enabled: currentlyEnabled };
      fetch("/admin/toggle_user_ajax", {
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
      .catch(err => console.error("Error toggleUser:", err));
    }

    // Eliminar usuario
    if (e.target.classList.contains("delete-user")) {
      e.preventDefault();
      const userId = e.target.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este usuario?")) return;
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
      .catch(err => console.error("Error deleteUser:", err));
    }

    // Edit user (Abrir popup)
    if (e.target.classList.contains("edit-user-btn")) {
      e.preventDefault();
      const userId = e.target.getAttribute("data-id");
      const username = e.target.getAttribute("data-username");
      const color = e.target.getAttribute("data-color") || "#ffffff";
      const position = e.target.getAttribute("data-position") || "1";
      const canSearch = (e.target.getAttribute("data-cansearch") === "true");
      const canCreateSubusers = (e.target.getAttribute("data-cancreatesubusers") === "true");

      editUserId.value = userId;
      editUserUsername.value = username;
      editUserPassword.value = "";
      editUserColor.value = color;
      editUserPosition.value = position;
      editUserCanSearchAny.checked = canSearch;
      editUserCanCreateSubusers.checked = canCreateSubusers;

      editUserPopup.style.display = "block";
    }

    // Botón "Email" -> user_emails/<user_id>
    if (e.target.classList.contains("email-user")) {
      e.preventDefault();
      const userId = e.target.getAttribute("data-id");
      window.location.href = `/admin/user_emails/${userId}`;
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

  function renderUserItems(users) {
    let html = "";
    users.forEach(u => {
      const userBg = u.color || "#ffffff";
      const textColor = "#000";
      html += `
        <div
          class="filter-item"
          style="
            margin-bottom:0.5rem;
            background-color:${userBg};
            color:${textColor};
            display:flex;
            justify-content:space-between;
            align-items:center;
            padding:0.5rem;
            border-radius:5px;
          "
        >
          <div>
            <strong>${u.username}</strong>
          </div>
          <div style="display:flex; gap:0.5rem;">
      `;

      // Off / On
      if (u.enabled) {
        html += `
          <button
            class="btn-red toggle-user"
            data-id="${u.id}"
            data-enabled="true"
          >
            Off
          </button>
        `;
      } else {
        html += `
          <button
            class="btn-green toggle-user"
            data-id="${u.id}"
            data-enabled="false"
          >
            On
          </button>
        `;
      }

      // Botón Email
      html += `
        <button
          class="btn-blue email-user"
          data-id="${u.id}"
        >
          Email
        </button>
      `;

      // Edit
      html += `
        <button
          class="btn-orange edit-user-btn"
          data-id="${u.id}"
          data-username="${u.username}"
          data-color="${u.color}"
          data-position="${u.position}"
          data-cansearch="${u.can_search_any}"
          data-cancreatesubusers="${u.can_create_subusers}"
        >
          Editar
        </button>
      `;

      // Delete
      html += `
        <button
          class="btn-red delete-user"
          data-id="${u.id}"
        >
          Eliminar
        </button>
      `;

      html += `
          </div>
        </div>
      `;
    });
    return html;
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }
});