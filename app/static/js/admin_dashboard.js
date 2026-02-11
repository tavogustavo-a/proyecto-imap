// app/static/js/admin_dashboard.js

// Función auxiliar para obtener URL de logout con limpieza de cookies
function getLogoutAllAndClearCookiesUrl() {
  const container = document.querySelector('[data-logout-all-cookies-url]');
  if (container) {
    return container.getAttribute('data-logout-all-cookies-url');
  }
  const btn = document.getElementById('btnLogoutAllAndClearCookies');
  if (btn && btn.dataset.url) {
    return btn.dataset.url;
  }
  return null;
}

// Función para limpiar todas las cookies del dominio
function clearAllCookies() {
  // Obtener todas las cookies
  const cookies = document.cookie.split(';');
  
  // Lista de cookies conocidas que deben eliminarse específicamente
  const knownCookies = [
    'session',
    'remember_username',
    'remember_2fa_device',
    'csrf_token'
  ];
  
  // Eliminar cookies conocidas primero
  knownCookies.forEach(function(name) {
    // Intentar eliminar con diferentes configuraciones
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname + ';';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname + ';';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname.split('.').slice(-2).join('.') + ';';
  });
  
  // Eliminar cada cookie del documento
  cookies.forEach(function(cookie) {
    const eqPos = cookie.indexOf('=');
    const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
    
    // Intentar eliminar la cookie con diferentes paths y domain
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname + ';';
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + window.location.hostname + ';';
    // Intentar con dominio de segundo nivel también
    const domainParts = window.location.hostname.split('.');
    if (domainParts.length > 2) {
      const secondLevelDomain = '.' + domainParts.slice(-2).join('.');
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + secondLevelDomain + ';';
    }
  });
  
  // También limpiar localStorage y sessionStorage
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.warn('No se pudieron limpiar localStorage/sessionStorage:', e);
  }
}

document.addEventListener('DOMContentLoaded', function() {
    // Botón para cerrar sesión de todos y limpiar cookies
    const btnLogoutAllAndClearCookies = document.getElementById('btnLogoutAllAndClearCookies');
    let isProcessingLogout = false; // Flag para prevenir ejecuciones múltiples
    
    if (btnLogoutAllAndClearCookies) {
        btnLogoutAllAndClearCookies.addEventListener('click', function(e) {
            // Prevenir ejecución múltiple
            if (isProcessingLogout) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            
            // Mostrar confirmación antes de cerrar todas las sesiones y limpiar cookies
            if (confirm('¿Estás seguro de que quieres cerrar la sesión de TODOS los usuarios (admin, usuarios y sub-usuarios) y limpiar todas las cookies?\n\nEsto cerrará tu sesión y tendrás que volver a iniciar sesión.')) {
                // Marcar como procesando para prevenir ejecuciones múltiples
                isProcessingLogout = true;
                
                // Deshabilitar el botón para prevenir clics adicionales
                btnLogoutAllAndClearCookies.disabled = true;
                btnLogoutAllAndClearCookies.textContent = 'Procesando...';
                
                // Limpiar cookies del lado del cliente primero
                clearAllCookies();
                
                // Crear formulario para enviar POST request
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = getLogoutAllAndClearCookiesUrl() || btnLogoutAllAndClearCookies.dataset.url;
                
                // Agregar token CSRF
                const csrfToken = document.querySelector('meta[name="csrf_token"]');
                if (csrfToken) {
                    const csrfInput = document.createElement('input');
                    csrfInput.type = 'hidden';
                    csrfInput.name = '_csrf_token';
                    csrfInput.value = csrfToken.getAttribute('content');
                    form.appendChild(csrfInput);
                }
                
                // Enviar formulario (esto redirigirá y evitará más ejecuciones)
                document.body.appendChild(form);
                form.submit();
                
                // Si por alguna razón el submit falla, resetear el flag después de un tiempo
                setTimeout(function() {
                    isProcessingLogout = false;
                    btnLogoutAllAndClearCookies.disabled = false;
                }, 5000);
            }
        });
    }

    // Funcionalidad del botón ON/OFF para gestión IMAP
    const toggleBtn = document.getElementById('toggleImapManagementBtn');
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const isActive = this.getAttribute('data-enabled') === 'false'; // OFF significa activa
            
            // Limpiar contenido existente
            while (this.firstChild) {
                this.removeChild(this.firstChild);
            }
            
            if (isActive) {
                // Cambiar a ON (inactiva)
                this.setAttribute('data-enabled', 'true');
                this.className = 'btn-red';
                const icon = document.createElement('i');
                icon.className = 'fas fa-power-off';
                this.appendChild(icon);
                this.appendChild(document.createTextNode(' ON'));
            } else {
                // Cambiar a OFF (activa)
                this.setAttribute('data-enabled', 'false');
                this.className = 'btn-green';
                const icon = document.createElement('i');
                icon.className = 'fas fa-power-off';
                this.appendChild(icon);
                this.appendChild(document.createTextNode(' OFF'));
            }
            
            // Aquí puedes agregar la lógica para activar/desactivar la gestión IMAP
        });
    }

    // ======= LÓGICA PARA APIs GLOBALES (ADMIN) =======
    const globalLinkedApisList = document.getElementById("globalLinkedApisList");
    const addGlobalApiBtn = document.getElementById("addGlobalApiBtn");
    const newGlobalApiName = document.getElementById("newGlobalApiName");
    const newGlobalApiUrl = document.getElementById("newGlobalApiUrl");
    const newGlobalApiToken = document.getElementById("newGlobalApiToken");
    const globalApiMsg = document.getElementById("globalApiMsg");

    const editGlobalApiModal = document.getElementById("editGlobalApiModal");
    const closeEditGlobalApiModalBtn = document.getElementById("closeEditGlobalApiModalBtn");
    const editGlobalApiId = document.getElementById("editGlobalApiId");
    const editGlobalApiName = document.getElementById("editGlobalApiName");
    const editGlobalApiUrl = document.getElementById("editGlobalApiUrl");
    const editGlobalApiToken = document.getElementById("editGlobalApiToken");
    const saveEditGlobalApiBtn = document.getElementById("saveEditGlobalApiBtn");

    function getCsrfToken() {
        const metaTag = document.querySelector('meta[name="csrf_token"]');
        return metaTag ? metaTag.getAttribute('content') : '';
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function fetchGlobalApis() {
        if (!globalLinkedApisList) return;
        fetch("/admin/global_linked_projects", {
            method: "GET",
            headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "ok") {
                renderGlobalApis(data.projects);
            } else {
                globalLinkedApisList.innerHTML = `<p class="text-danger text-center">Error: ${data.message}</p>`;
            }
        })
        .catch(err => {
            console.error("Error fetching global APIs:", err);
            globalLinkedApisList.innerHTML = `<p class="text-danger text-center">Error de red.</p>`;
        });
    }

    function renderGlobalApis(projects) {
        if (!globalLinkedApisList) return;
        globalLinkedApisList.innerHTML = "";
        if (!projects || projects.length === 0) {
            globalLinkedApisList.innerHTML = '<p class="text-muted text-center">No hay APIs globales vinculadas.</p>';
            return;
        }

        projects.forEach(p => {
            const div = document.createElement("div");
            div.className = "linked-api-item d-flex justify-content-between align-items-center mb-05 p-05 text-left";
            div.innerHTML = `
                <div class="flex-grow-1 ml-05">
                    <strong>${escapeHtml(p.name)}</strong><br>
                    <small class="text-muted">${escapeHtml(p.url)}</small>
                </div>
                <div class="d-flex gap-05 mr-05">
                    <button type="button" class="btn-panel btn-orange btn-sm edit-global-project-btn" 
                            data-id="${p.id}" data-name="${escapeHtml(p.name)}" 
                            data-api-url="${escapeHtml(p.url)}" data-token="${escapeHtml(p.token)}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="btn-panel btn-red btn-sm delete-global-project-btn" data-id="${p.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            globalLinkedApisList.appendChild(div);
        });

        // Event listeners para editar y borrar
        globalLinkedApisList.querySelectorAll(".edit-global-project-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                editGlobalApiId.value = btn.dataset.id;
                editGlobalApiName.value = btn.dataset.name;
                editGlobalApiUrl.value = btn.dataset.apiUrl;
                editGlobalApiToken.value = btn.dataset.token;
                editGlobalApiModal.classList.remove("popup-hide");
                editGlobalApiModal.classList.add("popup-show");
            });
        });

        globalLinkedApisList.querySelectorAll(".delete-global-project-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                if (!confirm("¿Seguro que quieres eliminar esta API global?")) return;
                fetch(`/admin/global_linked_projects/${btn.dataset.id}`, {
                    method: "DELETE",
                    headers: { "X-CSRFToken": getCsrfToken() }
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === "ok") fetchGlobalApis();
                    else alert("Error: " + data.message);
                });
            });
        });
    }

    if (addGlobalApiBtn) {
        addGlobalApiBtn.addEventListener("click", () => {
            const name = newGlobalApiName.value.trim();
            const url = newGlobalApiUrl.value.trim();
            const token = newGlobalApiToken.value.trim();

            if (!name || !url || !token) {
                globalApiMsg.textContent = "Faltan datos obligatorios.";
                globalApiMsg.className = "text-italic text-danger";
                return;
            }

            fetch("/admin/global_linked_projects", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
                body: JSON.stringify({ name, url, token })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === "ok") {
                    newGlobalApiName.value = "";
                    newGlobalApiUrl.value = "";
                    newGlobalApiToken.value = "";
                    fetchGlobalApis();
                } else {
                    globalApiMsg.textContent = "Error: " + data.message;
                }
            });
        });
    }

    if (closeEditGlobalApiModalBtn) {
        closeEditGlobalApiModalBtn.addEventListener("click", () => {
            editGlobalApiModal.classList.remove("popup-show");
            editGlobalApiModal.classList.add("popup-hide");
        });
    }

    if (saveEditGlobalApiBtn) {
        saveEditGlobalApiBtn.addEventListener("click", () => {
            const payload = {
                name: editGlobalApiName.value.trim(),
                url: editGlobalApiUrl.value.trim(),
                token: editGlobalApiToken.value.trim()
            };
            fetch(`/admin/global_linked_projects/${editGlobalApiId.value}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
                body: JSON.stringify(payload)
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === "ok") {
                    editGlobalApiModal.classList.remove("popup-show");
                    editGlobalApiModal.classList.add("popup-hide");
                    fetchGlobalApis();
                } else alert("Error: " + data.message);
            });
        });
    }

    // Cerrar modal al hacer clic fuera
    document.addEventListener('mousedown', function(e) {
        if (editGlobalApiModal && (editGlobalApiModal.classList.contains('popup-show'))) {
            if (!editGlobalApiModal.contains(e.target) && !e.target.closest('.edit-global-project-btn')) {
                editGlobalApiModal.classList.remove("popup-show");
                editGlobalApiModal.classList.add("popup-hide");
            }
        }
    });

    fetchGlobalApis();
    // ======= FIN LÓGICA APIs GLOBALES =======
});
