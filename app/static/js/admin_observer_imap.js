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
    listDiv.innerHTML = "";
    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item";
      div.style.marginBottom = "1rem";
      div.innerHTML = `
        <strong>Usuario: ${s.username}</strong><br>
        <em>Carpetas:</em> ${s.folders || "INBOX"}
        <div class="mt-05">
          <form action="/admin/observer_test_imap/${s.id}" method="POST" class="d-inline">
            <input type="hidden" name="_csrf_token" value="${getCsrfToken()}">
            <button type="submit" class="btn-blue btn-imap-action btn-imap-small">Probar</button>
          </form>
          ${
            s.enabled
              ? `<button type="button" class="btn-red toggle-observer-imap ml-03 btn-imap-action btn-imap-small" data-id="${s.id}" data-enabled="true">Off</button>`
              : `<button type="button" class="btn-green toggle-observer-imap ml-03 btn-imap-action btn-imap-small" data-id="${s.id}" data-enabled="false">On</button>`
          }
          <button type="button" class="btn-orange ml-03 edit-observer-imap btn-imap-action btn-imap-small" data-url="/admin/observer_edit_imap/${s.id}">Editar</button>
          <button type="button" class="btn-panel btn-red btn-sm delete-observer-imap ml-03" data-id="${s.id}" title="Eliminar">
            <i class="fas fa-trash"></i>
          </button>
        </div>`;
      listDiv.appendChild(div);
    });
  }

  document.addEventListener("click", function(e) {
    const t = e.target;
    if (t.classList.contains("toggle-observer-imap")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Prevenir múltiples clicks rápidos
      if (t.disabled) return;
      t.disabled = true;
      
      const id = t.dataset.id;
      const enabled = t.dataset.enabled === "true";
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
          alert("Error: " + (d.message || "Error desconocido"));
        }
      })
      .catch(err => {
        console.error("Error toggleObserverIMAP:", err);
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
      t.disabled = true;
      
      if (!confirm("¿Eliminar servidor Observador?")) {
        t.disabled = false;
        return;
      }
      
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
          // Mostrar mensaje de éxito
          alert('✅ ' + (d.message || 'Servidor eliminado correctamente'));
          renderList(d.servers);
        } else {
          alert("❌ Error: " + (d.message || "Error desconocido"));
        }
      })
      .catch(err => {
        console.error("Error deleteObserverIMAP:", err);
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

  function getCsrfToken() {
    const csrfMeta = document.querySelector('meta[name="csrf_token"]');
    return csrfMeta ? csrfMeta.getAttribute("content") : "";
  }
}); 