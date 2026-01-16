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
    // Limpiar lista usando removeChild (CSP compliant)
    while (listDiv.firstChild) {
      listDiv.removeChild(listDiv.firstChild);
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
      
      // Host
      const emHost = document.createElement("em");
      emHost.textContent = "Host: ";
      div.appendChild(emHost);
      div.appendChild(document.createTextNode(escapeHtml(s.host || "")));
      
      // Puerto
      div.appendChild(document.createTextNode(" | "));
      const emPort = document.createElement("em");
      emPort.textContent = "Puerto: ";
      div.appendChild(emPort);
      div.appendChild(document.createTextNode(escapeHtml(s.port || "993")));
      
      // Carpetas
      div.appendChild(document.createTextNode(" | "));
      const emFolders = document.createElement("em");
      emFolders.textContent = "Carpetas: ";
      const foldersText = document.createTextNode(escapeHtml(s.folders || "INBOX"));
      emFolders.appendChild(foldersText);
      div.appendChild(emFolders);
      
      // Descripción (si existe) al lado de Carpetas
      if (s.description) {
        div.appendChild(document.createTextNode(" | "));
        const emDesc = document.createElement("em");
        emDesc.textContent = "Descripción: ";
        div.appendChild(emDesc);
        div.appendChild(document.createTextNode(escapeHtml(s.description)));
      }

      // Contenedor de acciones
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "mt-05";

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
      testBtn.className = "btn-blue btn-imap-action btn-imap-small";
      testBtn.textContent = "Probar";
      testForm.appendChild(testBtn);
      actionsDiv.appendChild(testForm);

      // Botón Toggle
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = s.enabled ? "btn-red toggle-observer-imap ml-03 btn-imap-action btn-imap-small" : "btn-green toggle-observer-imap ml-03 btn-imap-action btn-imap-small";
      toggleBtn.setAttribute("data-id", s.id);
      toggleBtn.setAttribute("data-enabled", s.enabled ? "true" : "false");
      toggleBtn.textContent = s.enabled ? "Off" : "On";
      actionsDiv.appendChild(toggleBtn);

      // Botón Editar
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-orange ml-03 edit-observer-imap btn-imap-action btn-imap-small";
      editBtn.setAttribute("data-url", `/admin/observer_edit_imap/${s.id}`);
      editBtn.textContent = "Editar";
      actionsDiv.appendChild(editBtn);

      // Botón Eliminar
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-panel btn-red btn-sm delete-observer-imap ml-03";
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
        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Probando...';
        
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
    const t = e.target;
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
      t.className = newEnabled ? "btn-red toggle-observer-imap" : "btn-green toggle-observer-imap";
      t.textContent = newEnabled ? "Off" : "On";
      
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
          t.className = enabled ? "btn-red toggle-observer-imap" : "btn-green toggle-observer-imap";
          t.textContent = enabled ? "Off" : "On";
          alert("Error: " + (d.message || "Error desconocido"));
        }
      })
      .catch(err => {
        // Revertir cambio optimista en caso de error
        t.dataset.enabled = enabled.toString();
        t.className = enabled ? "btn-red toggle-observer-imap" : "btn-green toggle-observer-imap";
        t.textContent = enabled ? "Off" : "On";
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
}); 