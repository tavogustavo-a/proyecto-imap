//

document.addEventListener("DOMContentLoaded", function() {
  const searchForm = document.getElementById("observerImapSearchForm");
  const searchInput = document.getElementById("observerImapSearchInput");
  const listDiv = document.getElementById("observerImapList");

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
            <button type="submit" class="btn-blue">Probar</button>
          </form>
          ${
            s.enabled
              ? `<button type="button" class="btn-red toggle-observer-imap ml-03" data-id="${s.id}" data-enabled="true">Deshabilitar</button>`
              : `<button type="button" class="btn-green toggle-observer-imap ml-03" data-id="${s.id}" data-enabled="false">Habilitar</button>`
          }
          <button type="button" class="btn-orange ml-03 edit-observer-imap" data-url="/admin/observer_edit_imap/${s.id}">Editar</button>
          <button type="button" class="btn-red delete-observer-imap ml-03" data-id="${s.id}">Eliminar</button>
        </div>`;
      listDiv.appendChild(div);
    });
  }

  document.addEventListener("click", function(e) {
    const t = e.target;
    if (t.classList.contains("toggle-observer-imap")) {
      const id = t.dataset.id;
      const enabled = t.dataset.enabled === "true";
      fetch("/admin/observer_toggle_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ server_id: parseInt(id), currently_enabled: enabled })
      }).then(r => r.json()).then(d => d.status === "ok" && renderList(d.servers));
    }
    if (t.classList.contains("delete-observer-imap")) {
      if (!confirm("¿Eliminar servidor Observador?")) return;
      const id = t.dataset.id;
      fetch("/admin/observer_delete_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ server_id: parseInt(id) })
      }).then(r => r.json()).then(d => d.status === "ok" && renderList(d.servers));
    }
    if (t.classList.contains("edit-observer-imap")) {
      window.location.href = t.dataset.url;
    }
  });

  function getCsrfToken() {
    const m = document.querySelector('meta[name="csrf_token"]');
    return m ? m.getAttribute('content') : '';
  }
}); 