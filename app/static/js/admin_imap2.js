// app/static/js/admin_imap2.js

document.addEventListener("DOMContentLoaded", function() {
  const imap2SearchForm = document.getElementById("imap2SearchForm");
  const imap2SearchInput = document.getElementById("imap2SearchInput");
  const imap2List = document.getElementById("imap2List");

  if (imap2SearchForm && imap2List) {
    imap2SearchForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const query = imap2SearchInput.value.trim();

      fetch(`/admin/search_imap2_ajax?query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          renderImap2List(data.servers);
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
  if (imap2SearchInput && imap2List) {
    let searchTimeout = null;
    imap2SearchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = imap2SearchInput.value.trim();
        fetch(`/admin/search_imap2_ajax?query=${encodeURIComponent(query)}`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok") {
            renderImap2List(data.servers);
          }
        })
        .catch(() => {
          // Error silencioso en búsqueda automática
        });
      }, 200);
    });
  }

  function renderImap2List(servers) {
    // Limpiar lista usando removeChild (CSP compliant)
    while (imap2List.firstChild) {
      imap2List.removeChild(imap2List.firstChild);
    }
    
    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item mb-1";

      // Usuario
      const strongUser = document.createElement("strong");
      strongUser.textContent = `Usuario: ${escapeHtml(s.username)}`;
      div.appendChild(strongUser);
      
      // Descripción y ruta
      if (s.description || s.route_path) {
        const br = document.createElement("br");
        div.appendChild(br);
        
        const infoText = document.createDocumentFragment();
        if (s.description) {
          const descSpan = document.createElement("span");
          descSpan.textContent = escapeHtml(s.description);
          infoText.appendChild(descSpan);
        }
        if (s.route_path) {
          if (s.description) {
            infoText.appendChild(document.createTextNode(" | "));
          }
          const routeEm = document.createElement("em");
          routeEm.textContent = "Ruta: ";
          infoText.appendChild(routeEm);
          const routeSpan = document.createElement("span");
          routeSpan.textContent = escapeHtml(s.route_path);
          infoText.appendChild(routeSpan);
        }
        div.appendChild(infoText);
      }

      // Contenedor de acciones
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "mt-05";

      // Formulario Probar
      const testForm = document.createElement("form");
      testForm.action = `/admin/test_imap2/${s.id}`;
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
      toggleBtn.className = s.enabled ? "btn-red toggle-imap2-btn ml-03 btn-imap-action btn-imap-small" : "btn-green toggle-imap2-btn ml-03 btn-imap-action btn-imap-small";
      toggleBtn.setAttribute("data-id", s.id);
      toggleBtn.setAttribute("data-enabled", s.enabled ? "true" : "false");
      toggleBtn.textContent = s.enabled ? "Off" : "On";
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-orange ml-03 edit-imap2-btn btn-imap-action btn-imap-small";
      editBtn.setAttribute("data-url", `/admin/edit_imap2/${s.id}`);
      editBtn.textContent = "Editar";
      actionsDiv.appendChild(editBtn);

      // Botón Eliminar
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-red delete-imap2-btn ml-03 btn-imap-action btn-imap-small";
      deleteBtn.setAttribute("data-id", s.id);
      deleteBtn.title = "Eliminar";
      
      const trashIcon = document.createElement("i");
      trashIcon.className = "fas fa-trash";
      deleteBtn.appendChild(trashIcon);
      actionsDiv.appendChild(deleteBtn);

      div.appendChild(actionsDiv);
      imap2List.appendChild(div);
    });
  }

  // Event listener para probar servidor IMAP2 (interceptar formulario)
  document.addEventListener('submit', function(e) {
    if (e.target.closest('form') && e.target.closest('form').action && e.target.closest('form').action.includes('/admin/test_imap2/')) {
      e.preventDefault();
      const form = e.target.closest('form');
      const actionUrl = form.action;
      const serverIdMatch = actionUrl.match(/\/admin\/test_imap2\/(\d+)/);
      
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
        
        fetch('/admin/test_imap2_ajax', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            server_id: serverId
          })
        })
        .then(res => {
          if (!res.ok) {
            // Si la respuesta no es OK, intentar parsear como JSON primero
            return res.text().then(text => {
              try {
                const jsonData = JSON.parse(text);
                throw new Error(jsonData.message || `Error ${res.status}: ${res.statusText}`);
              } catch (e) {
                if (e instanceof SyntaxError) {
                  // Si no es JSON, es HTML (página de error)
                  throw new Error(`Error ${res.status}: ${res.statusText}. El servidor puede necesitar reiniciarse.`);
                }
                throw e;
              }
            });
          }
          return res.json();
        })
        .then(data => {
          if (data.status === 'ok') {
            alert('✅ Éxito: ' + (data.message || 'Conexión exitosa'));
          } else {
            alert('❌ Error: ' + (data.message || 'Error al probar conexión'));
          }
        })
        .catch(err => {
          alert('Error: ' + err.message);
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

    // Toggle IMAP2
    if (target.classList.contains("toggle-imap2-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Feedback visual inmediato
      target.disabled = true;
      const originalContent = target.cloneNode(true);
      // Limpiar contenido
      while (target.firstChild) {
        target.removeChild(target.firstChild);
      }
      // Agregar spinner
      const spinnerIcon = document.createElement("i");
      spinnerIcon.className = "fas fa-spinner fa-spin";
      target.appendChild(spinnerIcon);
      
      const srvId = target.getAttribute("data-id");
      const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
      
      fetch("/admin/toggle_imap2_ajax", {
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
          renderImap2List(data.servers);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        // Restaurar botón
        target.disabled = false;
        // Limpiar contenido
        while (target.firstChild) {
          target.removeChild(target.firstChild);
        }
        // Restaurar contenido original
        while (originalContent.firstChild) {
          target.appendChild(originalContent.firstChild.cloneNode(true));
        }
        // Restaurar texto si existe
        if (originalContent.textContent) {
          target.textContent = originalContent.textContent;
        }
      });
    }

    // Delete IMAP2
    if (target.classList.contains("delete-imap2-btn") || target.closest(".delete-imap2-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const button = target.classList.contains("delete-imap2-btn") ? target : target.closest(".delete-imap2-btn");
      const srvId = button.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este servidor IMAP2?")) return;

      // Feedback visual inmediato
      button.disabled = true;
      const originalContent = button.cloneNode(true);
      // Limpiar contenido
      while (button.firstChild) {
        button.removeChild(button.firstChild);
      }
      // Agregar spinner
      const spinnerIcon = document.createElement("i");
      spinnerIcon.className = "fas fa-spinner fa-spin";
      button.appendChild(spinnerIcon);

      fetch("/admin/delete_imap2_ajax", {
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
          renderImap2List(data.servers);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        // Restaurar botón
        button.disabled = false;
        // Limpiar contenido
        while (button.firstChild) {
          button.removeChild(button.firstChild);
        }
        // Restaurar contenido original
        while (originalContent.firstChild) {
          button.appendChild(originalContent.firstChild.cloneNode(true));
        }
        // Restaurar texto si existe
        if (originalContent.textContent) {
          button.textContent = originalContent.textContent;
        }
      });
    }

    // Editar IMAP2
    if (target.classList.contains("edit-imap2-btn")) {
      e.preventDefault();
      const url = target.dataset.url;
      if (url) {
        window.location.href = url;
      }
    }
  });

  // Manejar creación de servidor IMAP2 vía AJAX
  const createImap2Form = document.getElementById('createImap2Form');
  if (createImap2Form && !createImap2Form.querySelector('input[name="server_id"]')) {
    createImap2Form.addEventListener("submit", function(e) {
      e.preventDefault();
      
      const description = document.getElementById("imap2_description") ? document.getElementById("imap2_description").value.trim() : "";
      const host = document.getElementById("imap2_host").value.trim();
      const port = parseInt(document.getElementById("imap2_port").value) || 993;
      const username = document.getElementById("imap2_username").value.trim();
      const password = document.getElementById("imap2_password").value.trim();
      const folders = document.getElementById("imap2_folders").value.trim() || "INBOX";
      const route_path = document.getElementById("imap2_route_path").value.trim();
      
      if (!host || !username) {
        alert("Host y usuario son obligatorios.");
        return;
      }
      
      if (!route_path) {
        alert("La ruta es obligatoria y no puede estar vacía.");
        return;
      }
      
      if (!route_path.startsWith('/')) {
        alert("La ruta debe empezar con '/' (ej: /codigos4, /pagina2).");
        return;
      }

      const submitButton = createImap2Form.querySelector('button[type="submit"]');
      const originalContent = submitButton.cloneNode(true);
      submitButton.disabled = true;
      // Limpiar contenido
      while (submitButton.firstChild) {
        submitButton.removeChild(submitButton.firstChild);
      }
      // Agregar spinner y texto
      const spinnerIcon = document.createElement("i");
      spinnerIcon.className = "fas fa-spinner fa-spin";
      submitButton.appendChild(spinnerIcon);
      submitButton.appendChild(document.createTextNode(" Creando..."));

      fetch("/admin/create_imap2_ajax", {
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
          folders: folders,
          route_path: route_path
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          // Limpiar el formulario
          createImap2Form.reset();
          document.getElementById("imap2_port").value = "993";
          document.getElementById("imap2_folders").value = "INBOX";
          if (document.getElementById("imap2_description")) {
            document.getElementById("imap2_description").value = "";
          }
          document.getElementById("imap2_route_path").value = "";
          
          // Actualizar la lista
          renderImap2List(data.servers);
        } else {
          alert("Error: " + (data.message || "Error desconocido"));
        }
      })
      .catch(err => {
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        submitButton.disabled = false;
        // Limpiar contenido
        while (submitButton.firstChild) {
          submitButton.removeChild(submitButton.firstChild);
        }
        // Restaurar contenido original
        while (originalContent.firstChild) {
          submitButton.appendChild(originalContent.firstChild.cloneNode(true));
        }
        // Restaurar texto si existe
        if (originalContent.textContent) {
          submitButton.textContent = originalContent.textContent;
        }
      });
    });
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }
});

