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
          console.error("Error searching IMAP2 servers:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error fetch IMAP2 servers:", err));
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
        .catch(err => console.error("Error búsqueda automática IMAP2:", err));
      }, 200);
    });
  }

  function renderImap2List(servers) {
    imap2List.innerHTML = "";
    servers.forEach(s => {
      const div = document.createElement("div");
      div.className = "imap-item";
      div.style.marginBottom = "1rem";

      div.innerHTML = `
        <strong>Usuario: ${escapeHtml(s.username)}</strong><br>
        ${s.description ? escapeHtml(s.description) : ''}${s.route_path ? ` | <em>Ruta:</em> ${escapeHtml(s.route_path)}` : ''}
        <div class="mt-05">
          <form action="/admin/test_imap2/${s.id}" method="POST" class="d-inline">
            <input type="hidden" name="_csrf_token" value="${getCsrfToken()}">
            <button type="submit" class="btn-blue btn-imap-action btn-imap-small">Probar</button>
          </form>
          ${
            s.enabled
              ? `<button type="button" class="btn-red toggle-imap2-btn ml-03 btn-imap-action btn-imap-small" data-id="${s.id}" data-enabled="true">Off</button>`
              : `<button type="button" class="btn-green toggle-imap2-btn ml-03 btn-imap-action btn-imap-small" data-id="${s.id}" data-enabled="false">On</button>`
          }
          <button
            type="button"
            class="btn-orange ml-03 edit-imap2-btn btn-imap-action btn-imap-small"
            data-url="/admin/edit_imap2/${s.id}"
          >
            Editar
          </button>
          <button
            type="button"
            class="btn-red delete-imap2-btn ml-03 btn-imap-action btn-imap-small"
            data-id="${s.id}"
            title="Eliminar"
          >
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
      imap2List.appendChild(div);
    });
  }

  document.addEventListener("click", function(e) {
    const target = e.target;

    // Toggle IMAP2
    if (target.classList.contains("toggle-imap2-btn")) {
      e.preventDefault();
      e.stopPropagation();
      
      // Feedback visual inmediato
      target.disabled = true;
      const originalText = target.innerHTML;
      target.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      
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
          console.error("Error toggling IMAP2:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        console.error("Error toggleIMAP2:", err);
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        // Restaurar botón
        target.disabled = false;
        target.innerHTML = originalText;
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
      const originalText = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

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
          console.error("Error deleting IMAP2:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => {
        console.error("Error deleteIMAP2:", err);
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        // Restaurar botón
        button.disabled = false;
        button.innerHTML = originalText;
      });
    }

    // Editar IMAP2
    if (target.classList.contains("edit-imap2-btn")) {
      e.preventDefault();
      const url = target.dataset.url;
      if (url) {
        window.location.href = url;
      } else {
        console.error("No se encontró data-url en botón Editar IMAP2");
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
      const originalText = submitButton.innerHTML;
      submitButton.disabled = true;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';

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
        console.error("Error creating IMAP2:", err);
        alert("Error de red: " + err.message);
      })
      .finally(() => {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
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

