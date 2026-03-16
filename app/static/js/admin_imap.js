// app/static/js/admin_imap.js

document.addEventListener("DOMContentLoaded", function() {
  const imapSearchForm = document.getElementById("imapSearchForm");
  const imapSearchInput = document.getElementById("imapSearchInput");
  const imapList = document.getElementById("imapList");
  const btnGoToParrafos = document.getElementById("btnGoToParrafos");
  const btnGoToFilters = document.getElementById("btnGoToFilters");
  const btnGoToRegex = document.getElementById("btnGoToRegex");
  const btnGoToServices = document.getElementById("btnGoToServices");
  const btnGoToUsuarios = document.getElementById("btnGoToUsuarios");

  if (imapSearchForm && imapList) {
    imapSearchForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const query = imapSearchInput.value.trim();

      fetch(`/admin/search_imap_ajax?query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          renderImapList(data.servers);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        alert("Error de red: " + err.message);
      });
    });
  }

  // Búsqueda automática al escribir
  if (imapSearchInput && imapList) {
    let searchTimeout = null;
    imapSearchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = imapSearchInput.value.trim();
        fetch(`/admin/search_imap_ajax?query=${encodeURIComponent(query)}`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok") {
            renderImapList(data.servers);
          }
        })
        .catch(() => {
          // Error silencioso en búsqueda automática
        });
      }, 200);
    });
  }

  function renderImapList(servers) {
    // Limpiar lista usando removeChild (CSP compliant)
    while (imapList.firstChild) {
      imapList.removeChild(imapList.firstChild);
    }
    
    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item mb-1";

      // Usuario
      const strongUser = document.createElement("strong");
      strongUser.textContent = `Usuario: ${escapeHtml(s.username)}`;
      div.appendChild(strongUser);
      
      const br = document.createElement("br");
      div.appendChild(br);
      
      // Carpetas
      const emFolders = document.createElement("em");
      emFolders.textContent = "Carpetas: ";
      const foldersText = document.createTextNode(escapeHtml(s.folders || "INBOX"));
      emFolders.appendChild(foldersText);
      div.appendChild(emFolders);

      // Contenedor de acciones
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "mt-05";

      // Formulario Probar
      const testForm = document.createElement("form");
      testForm.action = `/admin/test_imap/${s.id}`;
      testForm.method = "POST";
      testForm.className = "d-inline";
      
      const csrfInput = document.createElement("input");
      csrfInput.type = "hidden";
      csrfInput.name = "_csrf_token";
      csrfInput.value = getCsrfToken();
      testForm.appendChild(csrfInput);
      
      const testBtn = document.createElement("button");
      testBtn.type = "submit";
      testBtn.className = "btn-blue btn-imap-action btn-imap-small";
      testBtn.textContent = "Probar";
      testForm.appendChild(testBtn);
      actionsDiv.appendChild(testForm);

      // Botón Toggle
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = s.enabled ? "btn-red toggle-imap-btn ml-03 btn-imap-action btn-imap-small" : "btn-green toggle-imap-btn ml-03 btn-imap-action btn-imap-small";
      toggleBtn.setAttribute("data-id", s.id);
      toggleBtn.setAttribute("data-enabled", s.enabled ? "true" : "false");
      toggleBtn.textContent = s.enabled ? "Off" : "On";
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-orange ml-03 edit-imap-btn btn-imap-action btn-imap-small";
      editBtn.setAttribute("data-url", `/admin/edit_imap/${s.id}`);
      editBtn.textContent = "Editar";
      actionsDiv.appendChild(editBtn);

      // Botón Eliminar
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-red delete-imap-btn ml-03 btn-imap-action btn-imap-small";
      deleteBtn.setAttribute("data-id", s.id);
      deleteBtn.title = "Eliminar";
      
      const trashIcon = document.createElement("i");
      trashIcon.className = "fas fa-trash";
      deleteBtn.appendChild(trashIcon);
      actionsDiv.appendChild(deleteBtn);

      div.appendChild(actionsDiv);
      imapList.appendChild(div);
    });
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Probando...';
        
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

  document.addEventListener("click", function(e) {
    const target = e.target;

    // Toggle IMAP
    if (target.classList.contains("toggle-imap-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      const srvId = target.getAttribute("data-id");
      const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
      
      // Actualización optimista: cambiar el estado del botón inmediatamente
      const newEnabled = !currentlyEnabled;
      target.setAttribute("data-enabled", newEnabled.toString());
      target.className = newEnabled ? "btn-red toggle-imap-btn" : "btn-green toggle-imap-btn";
      target.textContent = newEnabled ? "Off" : "On";
      
      // Feedback visual mínimo
      target.disabled = true;
      
      fetch("/admin/toggle_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ 
          server_id: parseInt(srvId),
          currently_enabled: currentlyEnabled
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          renderImapList(data.servers);
        } else {
          // Revertir cambio optimista en caso de error
          target.setAttribute("data-enabled", currentlyEnabled.toString());
          target.className = currentlyEnabled ? "btn-red toggle-imap-btn" : "btn-green toggle-imap-btn";
          target.textContent = currentlyEnabled ? "Off" : "On";
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        // Revertir cambio optimista en caso de error de red
        target.setAttribute("data-enabled", currentlyEnabled.toString());
        target.className = currentlyEnabled ? "btn-red toggle-imap-btn" : "btn-green toggle-imap-btn";
        target.textContent = currentlyEnabled ? "Off" : "On";
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        target.disabled = false;
      });
    }

    // Delete IMAP
    if (target.classList.contains("delete-imap-btn") || target.closest(".delete-imap-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const button = target.classList.contains("delete-imap-btn") ? target : target.closest(".delete-imap-btn");
      const srvId = button.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este servidor IMAP?")) return;

      // Actualización optimista: eliminar el elemento de la lista inmediatamente
      const imapItem = button.closest(".imap-item");
      if (imapItem) {
        imapItem.style.transition = "none";
        imapItem.style.opacity = "0";
        imapItem.style.height = imapItem.offsetHeight + "px";
        setTimeout(() => {
          imapItem.remove();
        }, 100);
      }

      // Feedback visual mínimo
      button.disabled = true;
      button.style.transition = "none";

      fetch("/admin/delete_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ server_id: parseInt(srvId) })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Recargar lista completa para asegurar sincronización
          renderImapList(data.servers);
        } else {
          // Revertir eliminación optimista en caso de error
          if (imapItem && imapItem.parentNode) {
            imapItem.style.opacity = "1";
            imapItem.style.height = "auto";
            if (!imapList.contains(imapItem)) {
              imapList.appendChild(imapItem);
            }
          }
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        // Revertir eliminación optimista en caso de error de red
        if (imapItem && imapItem.parentNode) {
          imapItem.style.opacity = "1";
          imapItem.style.height = "auto";
          if (!imapList.contains(imapItem)) {
            imapList.appendChild(imapItem);
          }
        }
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        button.disabled = false;
      });
    }

    // Editar IMAP
    if (target.classList.contains("edit-imap-btn")) {
      e.preventDefault();
      const url = target.dataset.url;
      if (url) {
        window.location.href = url;
      }
    }
  });

  // Listener para confirmar logout de todos
  const logoutAllForm = document.getElementById("logoutAllForm");
  if (logoutAllForm) {
    logoutAllForm.addEventListener("submit", function(event) {
      if (!confirm("¿Estás seguro de cerrar la sesión de TODOS los usuarios?")) {
        event.preventDefault(); // Detener el envío del formulario si no se confirma
      }
      // Si se confirma, el formulario se envía normalmente
    });
  }

  // --- Helper para añadir listener de navegación --- 
  function addNavigationListener(buttonId, targetUrl) {
      const button = document.getElementById(buttonId);
      if (button) {
          const url = button.dataset.url || targetUrl; // Usar data-url si existe
          if (url) {
              button.addEventListener("click", () => { window.location.href = url; });
          }
      }
  }

  // --- Añadir Listeners de Navegación --- 
  addNavigationListener("btnGoToParrafos");
  addNavigationListener("btnGoToFilters");
  addNavigationListener("btnGoToRegex");
  addNavigationListener("btnGoToServices");
  addNavigationListener("btnGoToUsuarios");
  addNavigationListener("btnGoToStore");
  // Nota: Los botones "Volver al Panel" ya se manejan en la refactorización anterior.

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Confirmación para el formulario de importación
  const importForm = document.getElementById('importConfigForm');
  if (importForm) {
    importForm.addEventListener('submit', function(event) {
      const confirmation = confirm('¿Estás seguro? Esto borrará Filtros, Regex, Servicios y Alias existentes antes de importar.');
      if (!confirmation) {
        event.preventDefault(); // Cancela el envío si el usuario dice "No"
      }
      // Si el usuario confirma, el formulario se envía normalmente.
    });
  }

  // Hacer que el botón Limpiar solo borre el campo y dispare búsqueda automática
  if (imapSearchForm && imapSearchInput) {
    const limpiarBtn = imapSearchForm.querySelector('button[type="submit"]');
    if (limpiarBtn) {
      limpiarBtn.type = 'button';
      limpiarBtn.addEventListener('click', function(e) {
        imapSearchInput.value = '';
        imapSearchInput.dispatchEvent(new Event('input'));
      });
    }
  }

  // Limpiar logs: manejado únicamente por clear_trigger_logs.js para evitar confirm duplicado

  // Manejar creación de servidor IMAP vía AJAX
  const createImapForm = document.getElementById('createImapForm');
  if (createImapForm && !createImapForm.querySelector('input[name="server_id"]')) {
    createImapForm.addEventListener("submit", function(e) {
      e.preventDefault();
      
      const description = document.getElementById("imap_description") ? document.getElementById("imap_description").value.trim() : "";
      const host = document.getElementById("imap_host").value.trim();
      const port = parseInt(document.getElementById("imap_port").value) || 993;
      const username = document.getElementById("imap_username").value.trim();
      const password = document.getElementById("imap_password").value.trim();
      const folders = document.getElementById("imap_folders").value.trim() || "INBOX";
      
      if (!host || !username) {
        alert("Host y usuario son obligatorios.");
        return;
      }

      const submitButton = createImapForm.querySelector('button[type="submit"]');
      
      // Guardar valores antes de limpiar (por si hay que revertir)
      const formData = {
        host: host,
        port: port,
        username: username,
        password: password,
        folders: folders,
        description: description
      };
      
      // Actualización optimista: limpiar formulario inmediatamente
      createImapForm.reset();
      document.getElementById("imap_port").value = "993";
      document.getElementById("imap_folders").value = "INBOX";
      
      // Feedback visual mínimo
      submitButton.disabled = true;
      submitButton.style.transition = "none";

      fetch("/admin/create_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
          description: description,
          host: host,
          port: port,
          username: username,
          password: password,
          folders: folders
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Actualizar la lista con los datos del servidor
          renderImapList(data.servers);
        } else {
          // Revertir limpieza del formulario en caso de error
          document.getElementById("imap_host").value = formData.host;
          document.getElementById("imap_port").value = formData.port.toString();
          document.getElementById("imap_username").value = formData.username;
          document.getElementById("imap_password").value = formData.password;
          document.getElementById("imap_folders").value = formData.folders;
          if (document.getElementById("imap_description")) {
            document.getElementById("imap_description").value = formData.description;
          }
          alert("Error: " + (data.message || "Error desconocido"));
        }
      })
      .catch(err => {
        // Revertir limpieza del formulario en caso de error de red
        document.getElementById("imap_host").value = formData.host;
        document.getElementById("imap_port").value = formData.port.toString();
        document.getElementById("imap_username").value = formData.username;
        document.getElementById("imap_password").value = formData.password;
        document.getElementById("imap_folders").value = formData.folders;
        if (document.getElementById("imap2_description")) {
          document.getElementById("imap2_description").value = formData.description;
        }
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        submitButton.disabled = false;
      });
    });
  }
});
