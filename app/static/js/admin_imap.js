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
        .catch(err => console.error("Error búsqueda automática IMAP:", err));
      }, 200);
    });
  }

  function renderImapList(servers) {
    imapList.innerHTML = "";
    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item mb-1";

      div.innerHTML = `
        <strong>Usuario: ${escapeHtml(s.username)}</strong><br>
        <em>Carpetas:</em> ${escapeHtml(s.folders || "INBOX")}
        <div class="mt-05">
          <form action="/admin/test_imap/${s.id}" method="POST" class="d-inline">
            <input type="hidden" name="_csrf_token" value="${getCsrfToken()}">
            <button type="submit" class="btn-blue btn-imap-action btn-imap-small">Probar</button>
          </form>
          ${
            s.enabled
              ? `<button type="button" class="btn-red toggle-imap-btn ml-03 btn-imap-action btn-imap-small" data-id="${s.id}" data-enabled="true">Off</button>`
              : `<button type="button" class="btn-green toggle-imap-btn ml-03 btn-imap-action btn-imap-small" data-id="${s.id}" data-enabled="false">On</button>`
          }
          <button
            type="button"
            class="btn-orange ml-03 edit-imap-btn btn-imap-action btn-imap-small"
            data-url="/admin/edit_imap/${s.id}"
          >
            Editar
          </button>
          <button
            type="button"
            class="btn-red delete-imap-btn ml-03 btn-imap-action btn-imap-small"
            data-id="${s.id}"
            title="Eliminar"
          >
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
      imapList.appendChild(div);
    });
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  document.addEventListener("click", function(e) {
    const target = e.target;

    // Toggle IMAP
    if (target.classList.contains("toggle-imap-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Feedback visual inmediato
      target.disabled = true;
      const originalText = target.innerHTML;
      target.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      
      const srvId = target.getAttribute("data-id");
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
      .catch(err => {
        console.error("Error toggleIMAP:", err);
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        // Restaurar botón
        target.disabled = false;
        target.innerHTML = originalText;
      });
    }

    // Delete IMAP
    if (target.classList.contains("delete-imap-btn") || target.closest(".delete-imap-btn")) {
      e.preventDefault();
      e.stopPropagation();
      const button = target.classList.contains("delete-imap-btn") ? target : target.closest(".delete-imap-btn");
      const srvId = button.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este servidor IMAP?")) return;

      // Feedback visual inmediato
      button.disabled = true;
      const originalText = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

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
      .catch(err => {
        console.error("Error deleteIMAP:", err);
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        // Restaurar botón
        button.disabled = false;
        button.innerHTML = originalText;
      });
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

  // --- Limpiar logs desde el menú lateral ---
  const btnClearTriggerLogMenu = document.getElementById('btnClearTriggerLogMenu');
  if (btnClearTriggerLogMenu) {
    btnClearTriggerLogMenu.addEventListener('click', function() {
      if (!confirm('¿Seguro que deseas limpiar todos los logs de activadores?')) return;
      fetch('/admin/clear_trigger_log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          alert('Logs limpiados correctamente.');
          // Si estamos en la vista de logs, recargar para ver el cambio
          if (window.location.pathname.includes('view_trigger_logs')) {
            window.location.reload();
          }
        } else {
          alert('Error al limpiar logs: ' + (data.message || 'Error desconocido'));
        }
      })
      .catch(err => alert('Error de red al limpiar logs: ' + err));
    });
  }

  // Manejar creación de servidor IMAP vía AJAX
  const createImapForm = document.getElementById('createImapForm');
  if (createImapForm && !createImapForm.querySelector('input[name="server_id"]')) {
    createImapForm.addEventListener("submit", function(e) {
      e.preventDefault();
      
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
      const originalText = submitButton.innerHTML;
      submitButton.disabled = true;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';

      fetch("/admin/create_imap_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
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
          // Limpiar el formulario
          createImapForm.reset();
          document.getElementById("imap_port").value = "993";
          document.getElementById("imap_folders").value = "INBOX";
          
          // Actualizar la lista
          renderImapList(data.servers);
        } else {
          alert("Error: " + (data.message || "Error desconocido"));
        }
      })
      .catch(err => {
        console.error("Error creating IMAP:", err);
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
      });
    });
  }
});
