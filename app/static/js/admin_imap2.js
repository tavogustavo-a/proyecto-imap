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
      testBtn.className = "btn-blue row-test-btn";
      testBtn.title = "Probar";
      testBtn.setAttribute("aria-label", "Probar");
      const testIcon = document.createElement("i");
      testIcon.className = "fas fa-plug";
      testIcon.setAttribute("aria-hidden", "true");
      testBtn.appendChild(testIcon);
      testForm.appendChild(testBtn);
      actionsDiv.appendChild(testForm);

      // Botón Toggle
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "toggle-imap2-btn ml-03";
      toggleBtn.setAttribute("data-id", s.id);
      toggleBtn.setAttribute("data-enabled", s.enabled ? "true" : "false");
      paintStateSwitch(toggleBtn, !!s.enabled);
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-orange ml-03 edit-imap2-btn row-icon-btn";
      editBtn.setAttribute("data-url", `/admin/edit_imap2/${s.id}`);
      editBtn.title = "Editar";
      editBtn.setAttribute("aria-label", "Editar");
      const editIcon = document.createElement("i");
      editIcon.className = "fas fa-pen";
      editIcon.setAttribute("aria-hidden", "true");
      editBtn.appendChild(editIcon);
      actionsDiv.appendChild(editBtn);

      // Botón URL (Dominio personalizado)
      const urlBtn = document.createElement("button");
      urlBtn.type = "button";
      urlBtn.className = "btn-blue ml-03 url-imap2-btn row-test-btn";
      urlBtn.setAttribute("data-id", s.id);
      urlBtn.setAttribute("data-domain", s.custom_domain || "");
      urlBtn.title = s.custom_domain ? `Dominio: ${s.custom_domain}` : "Configurar dominio personalizado";
      urlBtn.setAttribute("aria-label", "URL");
      const urlIcon = document.createElement("i");
      urlIcon.className = "fas fa-link";
      urlIcon.setAttribute("aria-hidden", "true");
      urlBtn.appendChild(urlIcon);
      actionsDiv.appendChild(urlBtn);

      const buzonBtn = document.createElement("button");
      buzonBtn.type = "button";
      buzonBtn.className = "btn-blue ml-03 buzon-imap2-btn row-test-btn";
      buzonBtn.setAttribute("data-id", s.id);
      buzonBtn.setAttribute("data-buzon-folders", JSON.stringify(s.buzon_folders || []));
      buzonBtn.title = "Buzón";
      buzonBtn.setAttribute("aria-label", "Buzón");
      const buzonIcon = document.createElement("i");
      buzonIcon.className = "fas fa-inbox";
      buzonIcon.setAttribute("aria-hidden", "true");
      const buzonLabel = document.createElement("span");
      buzonLabel.textContent = "Buzón";
      buzonBtn.appendChild(buzonIcon);
      buzonBtn.appendChild(buzonLabel);
      actionsDiv.appendChild(buzonBtn);

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
        paintTestButtonBusy(submitBtn, true);
        
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
            alertImapTestResult(true, data.message || 'Conexión correcta.');
          } else {
            alertImapTestResult(false, data.message);
          }
        })
        .catch(err => {
          alertImapTestOffline();
        })
        .finally(() => {
          if (submitBtn) {
            paintTestButtonBusy(submitBtn, false);
          }
        });
      }
      return;
    }
  });

  document.addEventListener("click", function(e) {
    const buzonBtn = e.target.closest(".buzon-imap2-btn");
    if (buzonBtn) {
      e.preventDefault();
      e.stopPropagation();
      showImap2BuzonModal(buzonBtn);
      return;
    }
    const target = e.target.closest(".toggle-imap2-btn") || e.target.closest(".edit-imap2-btn") || e.target.closest(".url-imap2-btn") || e.target;

    // Toggle IMAP2
    if (target.classList.contains("toggle-imap2-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      const srvId = target.getAttribute("data-id");
      const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
      
      // Actualización optimista: cambiar el estado del botón inmediatamente
      const newEnabled = !currentlyEnabled;
      target.setAttribute("data-enabled", newEnabled.toString());
      paintStateSwitch(target, newEnabled);
      
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
          paintStateSwitch(target, currentlyEnabled);
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        // Revertir cambio optimista en caso de error de red
        target.setAttribute("data-enabled", currentlyEnabled.toString());
        paintStateSwitch(target, currentlyEnabled);
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

  function imap2BuzonCatalog() {
    const node = document.getElementById("imap2BuzonFolderCatalog");
    const fallback = [
      {value: "inbox", label: "Recibidos"},
      {value: "trash", label: "Papelera"},
      {value: "spam", label: "Spam"}
    ];
    if (!node) return fallback;
    try {
      const data = JSON.parse(node.textContent || "[]");
      return Array.isArray(data) && data.length ? data : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function parseBuzonFolders(raw) {
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function showImap2BuzonModal(button) {
    const serverId = button.getAttribute("data-id");
    const selected = parseBuzonFolders(button.getAttribute("data-buzon-folders"));
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "admin-card";
    const title = document.createElement("h3");
    title.className = "text-center mb-1 imap2-buzon-heading";
    title.appendChild(document.createTextNode("Carpetas del buzón"));
    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "btn-panel btn-blue admin-global-api-info-btn";
    infoBtn.title = "Información";
    infoBtn.setAttribute("aria-label", "Información sobre carpetas del buzón");
    const infoIcon = document.createElement("i");
    infoIcon.className = "fas fa-info-circle";
    infoIcon.setAttribute("aria-hidden", "true");
    infoBtn.appendChild(infoIcon);
    title.appendChild(infoBtn);
    const search = document.createElement("input");
    search.type = "search";
    search.className = "imap2-buzon-folder-search";
    search.placeholder = "Buscar carpeta...";
    search.setAttribute("aria-label", "Buscar carpeta");
    search.autocomplete = "off";
    const list = document.createElement("div");
    list.className = "imap2-buzon-folder-list";
    imap2BuzonCatalog().forEach(function(item) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.value;
      checkbox.checked = selected.indexOf(item.value) !== -1;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + item.label));
      list.appendChild(label);
    });
    const actions = document.createElement("div");
    actions.className = "d-flex justify-content-center mt-1";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-green";
    saveBtn.textContent = "Guardar";
    actions.appendChild(saveBtn);
    modal.appendChild(title);
    modal.appendChild(search);
    modal.appendChild(list);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function closeModal() {
      overlay.remove();
    }
    overlay.addEventListener("click", function(ev) {
      if (ev.target === overlay) closeModal();
    });
    search.addEventListener("input", function() {
      const query = search.value.trim().toLowerCase();
      list.querySelectorAll("label").forEach(function(label) {
        const name = label.textContent.trim().toLowerCase();
        label.hidden = !!(query && name.indexOf(query) === -1);
      });
    });
    infoBtn.addEventListener("click", function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const infoOverlay = document.createElement("div");
      infoOverlay.className = "modal-overlay imap2-buzon-info-overlay";
      const infoCard = document.createElement("div");
      infoCard.className = "admin-card";
      const infoTitle = document.createElement("h3");
      infoTitle.className = "text-center mb-1";
      infoTitle.textContent = "Carpetas del buzón";
      const infoText = document.createElement("p");
      infoText.className = "text-center mb-1";
      infoText.textContent = "Marca las carpetas que esta página puede consultar. Si guardas sin marcar ninguna, no se consulta el buzón. Si el IMAP está apagado o no responde, se usa solo el buzón.";
      const infoActions = document.createElement("div");
      infoActions.className = "d-flex justify-content-center";
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "btn-green";
      okBtn.textContent = "Entendido";
      infoActions.appendChild(okBtn);
      infoCard.appendChild(infoTitle);
      infoCard.appendChild(infoText);
      infoCard.appendChild(infoActions);
      infoOverlay.appendChild(infoCard);
      document.body.appendChild(infoOverlay);
      function closeInfo() {
        infoOverlay.remove();
      }
      okBtn.addEventListener("click", closeInfo);
      infoOverlay.addEventListener("click", function(infoEvent) {
        if (infoEvent.target === infoOverlay) closeInfo();
      });
    });
    saveBtn.addEventListener("click", function() {
      const folders = [...list.querySelectorAll("input:checked")].map(function(input) { return input.value; });
      saveBtn.disabled = true;
      fetch("/admin/imap2/" + serverId + "/buzon_folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ folders: folders })
      })
      .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
      .then(function(result) {
        if (!result.ok || !result.data || result.data.status !== "ok") {
          alert((result.data && result.data.message) || "No se pudieron guardar las carpetas.");
          saveBtn.disabled = false;
          return;
        }
        button.setAttribute("data-buzon-folders", JSON.stringify(result.data.folders || []));
        closeModal();
      })
      .catch(function() {
        alert("No se pudieron guardar las carpetas.");
        saveBtn.disabled = false;
      });
    });
  }

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

