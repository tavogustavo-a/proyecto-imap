//

document.addEventListener("DOMContentLoaded", function() {
  const searchForm = document.getElementById("observerImapSearchForm");
  const searchInput = document.getElementById("observerImapSearchInput");
  const listDiv = document.getElementById("observerImapList");
  const clearBtn = document.getElementById('clearObserverImapSearchBtn');

  if (searchForm && listDiv) {
    searchForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const query = searchInput.value.trim();
      fetch(`/admin/observer_search_imap_ajax?query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
        .then(r => r.json())
        .then(d => d.status === "ok" && renderList(d.servers));
    });
    // Búsqueda automática al escribir
    searchInput.addEventListener("input", function() {
      const query = searchInput.value.trim();
      fetch(`/admin/observer_search_imap_ajax?query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
        .then(r => r.json())
        .then(d => d.status === "ok" && renderList(d.servers));
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener('click', function() {
      searchInput.value = '';
      fetch(`/admin/observer_search_imap_ajax?query=`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
        .then(r => r.json())
        .then(d => d.status === "ok" && renderList(d.servers));
    });
  }

  function renderList(servers) {
    const buzonRow = document.getElementById("observerBuzonAdminRow");
    while (listDiv.firstChild) {
      listDiv.removeChild(listDiv.firstChild);
    }
    if (buzonRow) {
      listDiv.appendChild(buzonRow);
    }

    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item mb-1 imap-admin-row";

      const emailSpan = document.createElement("span");
      emailSpan.className = "imap-admin-row__email";
      emailSpan.textContent = s.username || "";
      div.appendChild(emailSpan);

      const foldersSpan = document.createElement("span");
      foldersSpan.className = "imap-admin-row__folders";
      const foldersEm = document.createElement("em");
      foldersEm.textContent = "Carpetas: ";
      foldersSpan.appendChild(foldersEm);
      foldersSpan.appendChild(document.createTextNode(s.folders || "INBOX"));
      div.appendChild(foldersSpan);

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "imap-admin-row__actions";

      // Formulario Probar
      const testForm = document.createElement("form");
      testForm.action = `/admin/observer_test_imap/${s.id}`;
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
      toggleBtn.className = "toggle-observer-imap ml-03";
      toggleBtn.setAttribute("data-id", s.id);
      toggleBtn.setAttribute("data-enabled", s.enabled ? "true" : "false");
      paintStateSwitch(toggleBtn, !!s.enabled);
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-orange ml-03 edit-observer-imap row-icon-btn";
      editBtn.setAttribute("data-url", `/admin/observer_edit_imap/${s.id}`);
      editBtn.title = "Editar";
      editBtn.setAttribute("aria-label", "Editar");
      const editIcon = document.createElement("i");
      editIcon.className = "fas fa-pen";
      editIcon.setAttribute("aria-hidden", "true");
      editBtn.appendChild(editIcon);
      actionsDiv.appendChild(editBtn);

      // Botón Eliminar
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-red delete-observer-imap ml-03 btn-imap-action btn-imap-small";
      deleteBtn.setAttribute("data-id", s.id);
      deleteBtn.title = "Eliminar";
      
      const trashIcon = document.createElement("i");
      trashIcon.className = "fas fa-trash";
      deleteBtn.appendChild(trashIcon);
      actionsDiv.appendChild(deleteBtn);

      div.appendChild(actionsDiv);
      listDiv.appendChild(div);
    });
  }

  // Event listener para probar servidor IMAP Observador (interceptar formulario)
  document.addEventListener('submit', function(e) {
    if (e.target.closest('form') && e.target.closest('form').action && e.target.closest('form').action.includes('/admin/observer_test_imap/')) {
      e.preventDefault();
      const form = e.target.closest('form');
      const actionUrl = form.action;
      const serverIdMatch = actionUrl.match(/\/admin\/observer_test_imap\/(\d+)/);
      
      if (!serverIdMatch) {
        alert('Error: No se pudo identificar el servidor.');
        return;
      }
      
      const serverId = parseInt(serverIdMatch[1]);
      const submitBtn = form.querySelector('button[type="submit"]');
      
      // Feedback visual
      if (submitBtn) {
        paintTestButtonBusy(submitBtn, true);
        
        fetch('/admin/observer_test_imap_ajax', {
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
            alertImapTestResult(true, data.message || 'Conexión correcta.');
          } else {
            alertImapTestResult(false, data.message);
          }
        })
        .catch(() => {
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
    const t = e.target.closest(".toggle-observer-imap") || e.target;
    if (t.classList.contains("toggle-observer-imap")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (t.disabled) return;
      
      const id = t.dataset.id;
      const enabled = t.dataset.enabled === "true";
      
      // Actualización optimista: cambiar el estado del botón inmediatamente
      const newEnabled = !enabled;
      t.dataset.enabled = newEnabled.toString();
      paintStateSwitch(t, newEnabled);
      
      // Feedback visual mínimo
      t.disabled = true;
      
      fetch("/admin/observer_toggle_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ server_id: parseInt(id), currently_enabled: enabled })
      })
      .then(r => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        return r.json();
      })
      .then(d => {
        if (d.status === "ok") {
          renderList(d.servers);
        } else {
          // Revertir cambio optimista en caso de error
          t.dataset.enabled = enabled.toString();
          paintStateSwitch(t, enabled);
          alert("Error: " + (d.message || "Error desconocido"));
        }
      })
      .catch(err => {
        // Revertir cambio optimista en caso de error
        t.dataset.enabled = enabled.toString();
        paintStateSwitch(t, enabled);
        if (err.message.includes("Unexpected token")) {
          alert("Error: El servidor devolvió una respuesta inesperada. Recarga la página e intenta nuevamente.");
        } else {
          alert("Error al cambiar el estado: " + err.message);
        }
      })
      .finally(() => {
        t.disabled = false;
      });
    }
    if (t.classList.contains("delete-observer-imap")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (t.disabled) return;
      
      if (!confirm("¿Eliminar servidor Observador?")) {
        return;
      }
      
      // Actualización optimista: eliminar el elemento de la lista inmediatamente
      const imapItem = t.closest(".imap-item");
      if (imapItem) {
        imapItem.style.transition = "none";
        imapItem.style.opacity = "0";
        imapItem.style.height = imapItem.offsetHeight + "px";
        setTimeout(() => {
          imapItem.remove();
        }, 100);
      }

      // Feedback visual mínimo
      t.disabled = true;
      t.style.transition = "none";
      
      const id = t.dataset.id;
      fetch("/admin/observer_delete_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ server_id: parseInt(id) })
      })
      .then(r => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        return r.json();
      })
      .then(d => {
        if (d.status === "ok") {
          // Recargar lista completa para asegurar sincronización
          renderList(d.servers);
        } else {
          // Revertir eliminación optimista en caso de error
          if (imapItem && imapItem.parentNode) {
            imapItem.style.opacity = "1";
            imapItem.style.height = "auto";
            if (!listDiv.contains(imapItem)) {
              listDiv.appendChild(imapItem);
            }
          }
          alert("❌ Error: " + (d.message || "Error desconocido"));
        }
      })
      .catch(err => {
        // Revertir eliminación optimista en caso de error
        if (imapItem && imapItem.parentNode) {
          imapItem.style.opacity = "1";
          imapItem.style.height = "auto";
          if (!listDiv.contains(imapItem)) {
            listDiv.appendChild(imapItem);
          }
        }
        if (err.message.includes("Unexpected token")) {
          alert("Error: El servidor devolvió una respuesta inesperada. Recarga la página e intenta nuevamente.");
        } else {
          alert("Error al eliminar: " + err.message);
        }
      })
      .finally(() => {
        t.disabled = false;
      });
    }
    if (t.classList.contains("edit-observer-imap")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (t.disabled) return;
      t.disabled = true;
      
      window.location.href = t.dataset.url;
      
      // Re-habilitar después de un breve delay
      setTimeout(() => {
        t.disabled = false;
      }, 100);
    }
  });

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getCsrfToken() {
    const csrfMeta = document.querySelector('meta[name="csrf_token"]');
    return csrfMeta ? csrfMeta.getAttribute("content") : "";
  }

  // Detección automática de host IMAP basado en el email
  const usernameInput = document.getElementById("imapUsername");
  const hostInput = document.getElementById("imapHost");
  
  if (usernameInput && hostInput) {
    function detectImapHostFromEmail(email) {
      if (!email || !email.includes("@")) {
        return null;
      }
      
      const emailLower = email.toLowerCase().trim();
      const domain = emailLower.split("@")[1].split("+")[0].trim();
      
      const domainToHost = {
        "gmail.com": "imap.gmail.com",
        "outlook.com": "outlook.office365.com",
        "hotmail.com": "outlook.office365.com",
        "live.com": "outlook.office365.com",
        "yahoo.com": "imap.mail.yahoo.com",
        "yahoo.es": "imap.mail.yahoo.com",
        "icloud.com": "imap.mail.me.com",
        "me.com": "imap.mail.me.com",
        "mac.com": "imap.mail.me.com"
      };
      
      return domainToHost[domain] || null;
    }
    
    usernameInput.addEventListener("blur", function() {
      const email = this.value.trim();
      if (email && !hostInput.value.trim()) {
        const detectedHost = detectImapHostFromEmail(email);
        if (detectedHost) {
          hostInput.value = detectedHost;
          hostInput.placeholder = "Host (detectado automáticamente)";
        }
      }
    });
    
    usernameInput.addEventListener("input", function() {
      const email = this.value.trim();
      if (email && !hostInput.value.trim()) {
        const detectedHost = detectImapHostFromEmail(email);
        if (detectedHost) {
          hostInput.value = detectedHost;
          hostInput.placeholder = "Host (detectado automáticamente)";
        }
      }
    });
  }

  document.addEventListener("click", function(e) {
    const infoBtn = e.target.closest("#observerBuzonInfoBtn");
    if (infoBtn) {
      e.preventDefault();
      e.stopPropagation();
      showObserverBuzonInfo();
      return;
    }
    const buzonBtn = e.target.closest(".buzon-observer-btn");
    if (!buzonBtn) return;
    e.preventDefault();
    e.stopPropagation();
    showObserverBuzonModal(buzonBtn);
  });

  function showObserverBuzonInfo() {
    const infoOverlay = document.createElement("div");
    infoOverlay.className = "modal-overlay imap2-buzon-info-overlay";
    const infoCard = document.createElement("div");
    infoCard.className = "admin-card";
    const infoTitle = document.createElement("h3");
    infoTitle.className = "text-center mb-1";
    infoTitle.textContent = "Buzón del observador";
    const infoText = document.createElement("p");
    infoText.className = "text-center mb-1";
    infoText.textContent = "Es aparte de los servidores IMAP. Abre las carpetas del buzón (Recibidos, Papelera, Spam o una etiqueta). Las que marques se revisan con las mismas reglas: si coinciden, se toma la acción y al terminar se elimina el correo. Si no marcas ninguna, el buzón no se consulta. Funciona aunque no haya un servidor IMAP configurado.";
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
  }

  function observerBuzonCatalog() {
    const node = document.getElementById("observerBuzonFolderCatalog");
    const fallback = [
      {value: "inbox", label: "Recibidos"},
      {value: "trash", label: "Papelera"},
      {value: "spam", label: "Spam"}
    ];
    if (!node) return fallback;
    try {
      const data = JSON.parse(node.textContent || "[]");
      return Array.isArray(data) && data.length ? data : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function parseObserverBuzonFolders(raw) {
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return [];
    }
  }

  function showObserverBuzonModal(button) {
    const selected = parseObserverBuzonFolders(button.getAttribute("data-buzon-folders"));
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
    observerBuzonCatalog().forEach(function(item) {
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
      infoText.textContent = "El buzón es aparte de los servidores IMAP. Marca las carpetas que el observador revisa. Si guardas sin marcar ninguna, no se consulta el buzón. Al terminar la revisión se elimina el correo.";
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
      fetch("/admin/observer_buzon_folders", {
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
}); 