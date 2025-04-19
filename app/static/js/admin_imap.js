// app/static/js/admin_imap.js

document.addEventListener("DOMContentLoaded", function() {
  const imapSearchForm = document.getElementById("imapSearchForm");
  const imapSearchInput = document.getElementById("imapSearchInput");
  const imapList = document.getElementById("imapList");

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
          console.error("Error searching IMAP servers:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error fetch IMAP servers:", err));
    });
  }

  function renderImapList(servers) {
    imapList.innerHTML = "";
    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item";
      div.style.marginBottom = "1rem";

      // Observa los botones con type="button"
      div.innerHTML = `
        <strong>Usuario: ${s.username}</strong><br>
        <em>Carpetas:</em> ${s.folders || "INBOX"}
        <div style="margin-top:0.5rem;">
          <form action="/admin/test_imap/${s.id}" method="POST" style="display:inline;">
            <input type="hidden" name="_csrf_token" value="${getCsrfToken()}">
            <button type="submit" class="btn-blue">Probar</button>
          </form>
          ${
            s.enabled
              ? `<button type="button" class="btn-red toggle-imap-btn" data-id="${s.id}" data-enabled="true" style="margin-left:0.3rem;">Deshabilitar</button>`
              : `<button type="button" class="btn-green toggle-imap-btn" data-id="${s.id}" data-enabled="false" style="margin-left:0.3rem;">Habilitar</button>`
          }
          <button
            type="button"
            class="btn-orange"
            style="margin-left:0.3rem;"
            onclick="window.location.href='/admin/edit_imap/${s.id}'"
          >
            Editar
          </button>
          <button
            type="button"
            class="btn-red delete-imap-btn"
            data-id="${s.id}"
            style="margin-left:0.3rem;"
          >
            Eliminar
          </button>
        </div>
      `;
      imapList.appendChild(div);
    });
  }

  document.addEventListener("click", function(e) {
    // Toggle IMAP
    if (e.target.classList.contains("toggle-imap-btn")) {
      e.preventDefault();
      const srvId = e.target.getAttribute("data-id");

      // La variable se llama "currentlyEnabled"
      const currentlyEnabled = (e.target.getAttribute("data-enabled") === "true");
      
      fetch("/admin/toggle_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ 
          server_id: parseInt(srvId),
          // <-- AQUI definimos la propiedad 'currently_enabled' usando la variable 'currentlyEnabled'
          currently_enabled: currentlyEnabled
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          renderImapList(data.servers);
        } else {
          console.error("Error toggling IMAP:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error toggleIMAP:", err));
    }

    // Delete IMAP
    if (e.target.classList.contains("delete-imap-btn")) {
      e.preventDefault();
      const srvId = e.target.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este servidor IMAP?")) return;

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
          renderImapList(data.servers);
        } else {
          console.error("Error deleting IMAP:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error deleteIMAP:", err));
    }
  });

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }
});
