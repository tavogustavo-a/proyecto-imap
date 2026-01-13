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
        if (s.custom_domain) {
          if (s.description || s.route_path) {
            infoText.appendChild(document.createTextNode(" | "));
          }
          const domainEm = document.createElement("em");
          domainEm.textContent = "Dominio: ";
          domainEm.className = "imap-domain-label";
          infoText.appendChild(domainEm);
          const domainSpan = document.createElement("span");
          domainSpan.textContent = escapeHtml(s.custom_domain);
          domainSpan.className = "imap-domain-value";
          infoText.appendChild(domainSpan);
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

      // Botón URL (Dominio personalizado)
      const urlBtn = document.createElement("button");
      urlBtn.type = "button";
      urlBtn.className = "btn-blue ml-03 url-imap2-btn btn-imap-action btn-imap-small";
      urlBtn.setAttribute("data-id", s.id);
      urlBtn.setAttribute("data-domain", s.custom_domain || "");
      urlBtn.textContent = "URL";
      urlBtn.title = s.custom_domain ? `Dominio: ${s.custom_domain}` : "Configurar dominio personalizado";
      actionsDiv.appendChild(urlBtn);

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
      
      const srvId = target.getAttribute("data-id");
      const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
      
      // Actualización optimista: cambiar el estado del botón inmediatamente
      const newEnabled = !currentlyEnabled;
      target.setAttribute("data-enabled", newEnabled.toString());
      target.className = newEnabled ? "btn-red toggle-imap2-btn" : "btn-green toggle-imap2-btn";
      target.textContent = newEnabled ? "Off" : "On";
      
      // Feedback visual mínimo
      target.disabled = true;
      
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
          // Revertir cambio optimista en caso de error
          target.setAttribute("data-enabled", currentlyEnabled.toString());
          target.className = currentlyEnabled ? "btn-red toggle-imap2-btn" : "btn-green toggle-imap2-btn";
          target.textContent = currentlyEnabled ? "Off" : "On";
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        // Revertir cambio optimista en caso de error de red
        target.setAttribute("data-enabled", currentlyEnabled.toString());
        target.className = currentlyEnabled ? "btn-red toggle-imap2-btn" : "btn-green toggle-imap2-btn";
        target.textContent = currentlyEnabled ? "Off" : "On";
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        target.disabled = false;
      });
    }

    // Delete IMAP2
    if (target.classList.contains("delete-imap2-btn") || target.closest(".delete-imap2-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const button = target.classList.contains("delete-imap2-btn") ? target : target.closest(".delete-imap2-btn");
      const srvId = button.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este servidor IMAP2?")) return;

      // Actualización optimista: eliminar el elemento de la lista inmediatamente
      const imapItem = button.closest(".imap-item");
      if (imapItem) {
        imapItem.className = imapItem.className + " imap-item-removing";
        setTimeout(() => {
          imapItem.remove();
        }, 100);
      }

      // Feedback visual mínimo
      button.disabled = true;
      button.className = button.className + " btn-no-transition";

      fetch("/admin/delete_imap2_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ server_id: parseInt(srvId) })
      })
      .then(res => {
        if (!res.ok) {
          // Si la respuesta no es OK, intentar parsear como JSON primero
          return res.json().then(data => {
            throw new Error(data.message || `Error ${res.status}: ${res.statusText}`);
          }).catch(() => {
            throw new Error(`Error ${res.status}: ${res.statusText}`);
          });
        }
        return res.json();
      })
      .then(data => {
        if (data.status === "ok") {
          // Recargar lista completa para asegurar sincronización
          renderImap2List(data.servers);
        } else {
          // Revertir eliminación optimista en caso de error
          if (imapItem && imapItem.parentNode) {
            imapItem.className = imapItem.className.replace(" imap-item-removing", "") + " imap-item-restoring";
            if (!imap2List.contains(imapItem)) {
              imap2List.appendChild(imapItem);
            }
          }
          alert("Error: " + (data.message || "Error desconocido"));
        }
      })
      .catch(err => {
        // Revertir eliminación optimista en caso de error de red
        if (imapItem && imapItem.parentNode) {
          imapItem.className = imapItem.className.replace(" imap-item-removing", "") + " imap-item-restoring";
          if (!imap2List.contains(imapItem)) {
            imap2List.appendChild(imapItem);
          }
        }
        alert("Error: " + err.message);
      })
      .finally(() => {
        button.disabled = false;
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

    // Botón URL (Dominio personalizado)
    if (target.classList.contains("url-imap2-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      const serverId = target.getAttribute("data-id");
      const currentDomain = target.getAttribute("data-domain") || "";
      
      // Crear modal para editar dominio
      showUrlModal(serverId, currentDomain);
    }
  });

  // Función para mostrar modal de dominio personalizado
  function showUrlModal(serverId, currentDomain) {
    // Crear overlay
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    
    // Crear modal
    const modal = document.createElement("div");
    modal.className = "admin-card";
    
    modal.innerHTML = `
      <h3 class="text-center mb-1">Configurar Dominio Personalizado</h3>
      <p class="text-center text-small mb-1">
        Ingresa el dominio personalizado para esta página (ej: tudominio.com).<br>
        Deja en blanco para eliminar el dominio configurado.
      </p>
      <form id="urlImap2Form" class="d-flex flex-column gap-1">
        <div>
          <label for="customDomainInput" class="sr-only">Dominio personalizado</label>
          <input
            type="text"
            id="customDomainInput"
            placeholder="tudominio.com"
            value="${escapeHtml(currentDomain)}"
            class="form-input-block w-100"
            autocomplete="off"
          >
        </div>
        <div class="d-flex gap-1 justify-content-center">
          <button type="submit" class="btn-green">Guardar</button>
          <button type="button" class="btn-red" id="cancelUrlModal">Cancelar</button>
        </div>
      </form>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Event listener para cerrar modal
    overlay.addEventListener("click", function(e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });
    
    const cancelBtn = modal.querySelector("#cancelUrlModal");
    cancelBtn.addEventListener("click", function() {
      document.body.removeChild(overlay);
    });
    
    // Event listener para enviar formulario
    const form = modal.querySelector("#urlImap2Form");
    form.addEventListener("submit", function(e) {
      e.preventDefault();
      
      const domainInput = modal.querySelector("#customDomainInput");
      const domain = domainInput.value.trim();
      
      const submitBtn = form.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      submitBtn.className = submitBtn.className + " btn-no-transition";
      submitBtn.textContent = "Guardando...";
      
      fetch(`/admin/imap2/${serverId}/update_custom_domain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken(),
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({
          custom_domain: domain || null
        })
      })
      .then(res => {
        // Verificar si la respuesta es JSON
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          // Si no es JSON, leer como texto para ver qué devolvió
          return res.text().then(text => {
            console.error("Respuesta no JSON recibida:", text.substring(0, 200));
            throw new Error("El servidor devolvió HTML en lugar de JSON. ¿Estás autenticado?");
          });
        }
        return res.json();
      })
      .then(data => {
        if (data.status === "ok") {
          // Cerrar modal
          document.body.removeChild(overlay);
          
          // Recargar lista de servidores
          fetch("/admin/search_imap2_ajax?query=", {
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
            // Error silencioso
          });
          
          alert(data.message || "Dominio actualizado correctamente");
        } else {
          alert("Error: " + (data.message || "Error desconocido"));
          submitBtn.disabled = false;
          submitBtn.textContent = "Guardar";
        }
      })
      .catch(err => {
        alert("Error: " + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "Guardar";
      });
    });
  }

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
      
      // Guardar valores antes de limpiar (por si hay que revertir)
      const formData = {
        description: description,
        host: host,
        port: port,
        username: username,
        password: password,
        folders: folders,
        route_path: route_path
      };
      
      // Actualización optimista: limpiar formulario inmediatamente
      createImap2Form.reset();
      document.getElementById("imap2_port").value = "993";
      document.getElementById("imap2_folders").value = "INBOX";
      if (document.getElementById("imap2_description")) {
        document.getElementById("imap2_description").value = "";
      }
      document.getElementById("imap2_route_path").value = "";
      
      // Feedback visual mínimo
      submitButton.disabled = true;
      submitButton.className = submitButton.className + " btn-no-transition";

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
          // Actualizar la lista con los datos del servidor
          renderImap2List(data.servers);
        } else {
          // Revertir limpieza del formulario en caso de error
          document.getElementById("imap2_host").value = formData.host;
          document.getElementById("imap2_port").value = formData.port.toString();
          document.getElementById("imap2_username").value = formData.username;
          document.getElementById("imap2_password").value = formData.password;
          document.getElementById("imap2_folders").value = formData.folders;
          document.getElementById("imap2_route_path").value = formData.route_path;
          if (document.getElementById("imap2_description")) {
            document.getElementById("imap2_description").value = formData.description;
          }
          alert("Error: " + (data.message || "Error desconocido"));
        }
      })
      .catch(err => {
        // Revertir limpieza del formulario en caso de error de red
        document.getElementById("imap2_host").value = formData.host;
        document.getElementById("imap2_port").value = formData.port.toString();
        document.getElementById("imap2_username").value = formData.username;
        document.getElementById("imap2_password").value = formData.password;
        document.getElementById("imap2_folders").value = formData.folders;
        document.getElementById("imap2_route_path").value = formData.route_path;
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

