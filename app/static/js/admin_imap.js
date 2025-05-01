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

      div.innerHTML = `
        <strong>Usuario: ${s.username}</strong><br>
        <em>Carpetas:</em> ${s.folders || "INBOX"}
        <div class="mt-05">
          <form action="/admin/test_imap/${s.id}" method="POST" class="d-inline">
            <input type="hidden" name="_csrf_token" value="${getCsrfToken()}">
            <button type="submit" class="btn-blue">Probar</button>
          </form>
          ${
            s.enabled
              ? `<button type="button" class="btn-red toggle-imap-btn ml-03" data-id="${s.id}" data-enabled="true">Deshabilitar</button>`
              : `<button type="button" class="btn-green toggle-imap-btn ml-03" data-id="${s.id}" data-enabled="false">Habilitar</button>`
          }
          <button
            type="button"
            class="btn-orange ml-03 edit-imap-btn"
            data-url="/admin/edit_imap/${s.id}"
          >
            Editar
          </button>
          <button
            type="button"
            class="btn-red delete-imap-btn ml-03"
            data-id="${s.id}"
          >
            Eliminar
          </button>
        </div>
      `;
      imapList.appendChild(div);
    });
  }

  document.addEventListener("click", function(e) {
    const target = e.target;

    // Toggle IMAP
    if (target.classList.contains("toggle-imap-btn")) {
      e.preventDefault();
      const srvId = target.getAttribute("data-id");

      // La variable se llama "currentlyEnabled"
      const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
      
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
    if (target.classList.contains("delete-imap-btn")) {
      e.preventDefault();
      const srvId = target.getAttribute("data-id");
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

    // Editar IMAP
    if (target.classList.contains("edit-imap-btn")) {
      e.preventDefault();
      const url = target.dataset.url;
      if (url) {
        window.location.href = url;
      } else {
        console.error("No se encontró data-url en botón Editar IMAP");
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
          } else {
              console.error(`No se encontró URL para el botón #${buttonId}`);
          }
      }
  }

  // --- Añadir Listeners de Navegación --- 
  addNavigationListener("btnGoToParrafos");
  addNavigationListener("btnGoToFilters");
  addNavigationListener("btnGoToRegex");
  addNavigationListener("btnGoToServices");
  addNavigationListener("btnGoToUsuarios");
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
});
