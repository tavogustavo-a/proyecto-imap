// app/static/js/admin_dashboard.js
// Lógica del botón "Cerrar sesión y limpiar cookies": static/js/logout_all_cookies_btn.js

document.addEventListener('DOMContentLoaded', function() {
    // Funcionalidad del botón ON/OFF para gestión IMAP (Observador - observer_enabled)
    const toggleBtn = document.getElementById('toggleImapManagementBtn');
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const btn = this;
            if (btn.disabled) return;
            btn.disabled = true;
            const isActive = btn.getAttribute('data-enabled') === 'false'; // OFF = activo
            const newEnabled = !isActive;

            fetch('/admin/toggle_imap_management_ajax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({}),
                credentials: 'same-origin'
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    const active = data.enabled;
                    btn.setAttribute('data-enabled', active ? 'false' : 'true');
                    btn.className = active ? 'btn-green' : 'btn-red';
                    btn.innerHTML = '<i class="fas fa-power-off"></i> ' + (active ? 'OFF' : 'ON');
                    const obsCheck = document.getElementById('observerEnabled');
                    if (obsCheck) { obsCheck.checked = active; }
                }
            })
            .catch(function() { })
            .finally(function() { btn.disabled = false; });
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
