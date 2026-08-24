// app/static/js/admin_dashboard.js
// Lógica del botón "Cerrar sesión y limpiar cookies": static/js/logout_all_cookies_btn.js

document.addEventListener('DOMContentLoaded', function() {
    // ON/OFF global del buzón de mensajes (no afecta al observador IMAP de seguridad)
    const toggleBuzonBtn = document.getElementById('toggleEmailBuzonBtn');
    
    if (toggleBuzonBtn) {
        toggleBuzonBtn.addEventListener('click', function() {
            const btn = this;
            if (btn.disabled) return;
            btn.disabled = true;

            fetch('/admin/toggle_email_buzon_ajax', {
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

    const globalLinkedApisInfoBtn = document.getElementById("globalLinkedApisInfoBtn");
    const globalLinkedApisInfoModal = document.getElementById("globalLinkedApisInfoModal");
    const closeGlobalLinkedApisInfoBtn = document.getElementById("closeGlobalLinkedApisInfoBtn");
    const okGlobalLinkedApisInfoBtn = document.getElementById("okGlobalLinkedApisInfoBtn");

    function openGlobalLinkedApisInfo() {
        if (!globalLinkedApisInfoModal) return;
        globalLinkedApisInfoModal.removeAttribute("hidden");
        globalLinkedApisInfoModal.classList.remove("popup-hide");
        globalLinkedApisInfoModal.classList.add("popup-show");
    }

    function closeGlobalLinkedApisInfo() {
        if (!globalLinkedApisInfoModal) return;
        globalLinkedApisInfoModal.classList.remove("popup-show");
        globalLinkedApisInfoModal.classList.add("popup-hide");
        globalLinkedApisInfoModal.setAttribute("hidden", "");
    }

    if (globalLinkedApisInfoBtn) {
        globalLinkedApisInfoBtn.addEventListener("click", function (e) {
            e.preventDefault();
            openGlobalLinkedApisInfo();
        });
    }
    if (closeGlobalLinkedApisInfoBtn) {
        closeGlobalLinkedApisInfoBtn.addEventListener("click", closeGlobalLinkedApisInfo);
    }
    if (okGlobalLinkedApisInfoBtn) {
        okGlobalLinkedApisInfoBtn.addEventListener("click", closeGlobalLinkedApisInfo);
    }

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
                <div class="d-flex gap-05 mr-05 align-items-center flex-wrap">
                    <button type="button" class="btn-blue btn-imap-action btn-imap-small test-global-project-btn" data-id="${p.id}">
                        Probar
                    </button>
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

        globalLinkedApisList.querySelectorAll(".test-global-project-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const projectId = btn.dataset.id;
                if (!projectId) return;
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.textContent = "Probando...";
                fetch(`/admin/global_linked_projects/${projectId}/test`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    },
                    body: JSON.stringify({})
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === "ok") {
                        alert("✅ " + (data.message || "Conexión correcta."));
                    } else {
                        alert("❌ " + (data.message || "No se pudo probar la conexión."));
                    }
                })
                .catch(err => {
                    alert("❌ No se pudo completar la prueba. Revisa tu conexión e inténtalo de nuevo.");
                })
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = originalText;
                });
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
        if (globalLinkedApisInfoModal && globalLinkedApisInfoModal.classList.contains('popup-show')) {
            if (!globalLinkedApisInfoModal.contains(e.target) && !e.target.closest('#globalLinkedApisInfoBtn')) {
                closeGlobalLinkedApisInfo();
            }
        }
    });

    fetchGlobalApis();
    // ======= FIN LÓGICA APIs GLOBALES =======

    // ======= UI secciones API licencias (diseño; sin backend aún) =======
    function setupUiOnlyLinkedApiSection(cfg) {
        const listEl = document.getElementById(cfg.listId);
        const addBtn = document.getElementById(cfg.addBtnId);
        const nameInput = document.getElementById(cfg.nameInputId);
        const urlInput = document.getElementById(cfg.urlInputId);
        const tokenInput = document.getElementById(cfg.tokenInputId);
        const msgEl = document.getElementById(cfg.msgId);

        const editModal = document.getElementById(cfg.editModalId);
        const closeEditBtn = document.getElementById(cfg.closeEditBtnId);
        const editId = document.getElementById(cfg.editIdFieldId);
        const editName = document.getElementById(cfg.editNameId);
        const editUrl = document.getElementById(cfg.editUrlId);
        const editToken = document.getElementById(cfg.editTokenId);
        const saveEditBtn = document.getElementById(cfg.saveEditBtnId);

        const infoBtn = document.getElementById(cfg.infoBtnId);
        const infoModal = document.getElementById(cfg.infoModalId);
        const closeInfoBtn = document.getElementById(cfg.closeInfoBtnId);
        const okInfoBtn = document.getElementById(cfg.okInfoBtnId);

        let items = [];
        let nextId = 1;
        const editBtnClass = cfg.editBtnClass;
        const deleteBtnClass = cfg.deleteBtnClass;
        const testBtnClass = cfg.testBtnClass || "test-linked-api-btn";
        const enableTest = !!cfg.enableTest;
        const testUrl = cfg.testUrl || "";

        function openInfo() {
            if (!infoModal) return;
            infoModal.removeAttribute("hidden");
            infoModal.classList.remove("popup-hide");
            infoModal.classList.add("popup-show");
        }

        function closeInfo() {
            if (!infoModal) return;
            infoModal.classList.remove("popup-show");
            infoModal.classList.add("popup-hide");
            infoModal.setAttribute("hidden", "");
        }

        function closeEdit() {
            if (!editModal) return;
            editModal.classList.remove("popup-show");
            editModal.classList.add("popup-hide");
        }

        function setMsg(text, isError) {
            if (!msgEl) return;
            msgEl.textContent = text || "";
            msgEl.className = isError ? "text-italic text-danger" : "text-italic";
        }

        function render() {
            if (!listEl) return;
            listEl.innerHTML = "";
            if (!items.length) return;

            items.forEach(function (p) {
                const div = document.createElement("div");
                div.className = "linked-api-item d-flex justify-content-between align-items-center mb-05 p-05 text-left";
                const testBtnHtml = enableTest
                    ? '<button type="button" class="btn-blue btn-imap-action btn-imap-small ' +
                      testBtnClass +
                      '" data-id="' +
                      String(p.id) +
                      '">Probar</button>'
                    : "";
                div.innerHTML =
                    '<div class="flex-grow-1 ml-05">' +
                    "<strong>" +
                    escapeHtml(p.name) +
                    "</strong><br>" +
                    '<small class="text-muted">' +
                    escapeHtml(p.url) +
                    "</small>" +
                    "</div>" +
                    '<div class="d-flex gap-05 mr-05 align-items-center flex-wrap">' +
                    testBtnHtml +
                    '<button type="button" class="btn-panel btn-orange btn-sm ' +
                    editBtnClass +
                    '" data-id="' +
                    String(p.id) +
                    '"><i class="fas fa-edit"></i></button>' +
                    '<button type="button" class="btn-panel btn-red btn-sm ' +
                    deleteBtnClass +
                    '" data-id="' +
                    String(p.id) +
                    '"><i class="fas fa-trash"></i></button>' +
                    "</div>";
                listEl.appendChild(div);
            });

            listEl.querySelectorAll("." + editBtnClass).forEach(function (btn) {
                btn.addEventListener("click", function () {
                    const id = parseInt(btn.dataset.id, 10);
                    const item = items.find(function (x) {
                        return x.id === id;
                    });
                    if (!item || !editModal) return;
                    editId.value = String(item.id);
                    editName.value = item.name;
                    editUrl.value = item.url;
                    editToken.value = item.token;
                    editModal.classList.remove("popup-hide");
                    editModal.classList.add("popup-show");
                });
            });

            if (enableTest && testUrl) {
                listEl.querySelectorAll("." + testBtnClass).forEach(function (btn) {
                    btn.addEventListener("click", function () {
                        const id = parseInt(btn.dataset.id, 10);
                        const item = items.find(function (x) {
                            return x.id === id;
                        });
                        if (!item) return;
                        const originalText = btn.textContent;
                        btn.disabled = true;
                        btn.textContent = "Probando...";
                        fetch(testUrl, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "X-CSRFToken": getCsrfToken(),
                            },
                            body: JSON.stringify({
                                name: item.name,
                                url: item.url,
                                token: item.token,
                            }),
                        })
                            .then(function (res) {
                                return res.json();
                            })
                            .then(function (data) {
                                if (data.status === "ok") {
                                    alert("✅ " + (data.message || "Conexión correcta (licencias)."));
                                } else {
                                    alert("❌ " + (data.message || "No se pudo probar la API de licencias."));
                                }
                            })
                            .catch(function () {
                                alert(
                                    "❌ No se pudo completar la prueba de licencias. Revisa tu conexión e inténtalo de nuevo."
                                );
                            })
                            .finally(function () {
                                btn.disabled = false;
                                btn.textContent = originalText;
                            });
                    });
                });
            }

            listEl.querySelectorAll("." + deleteBtnClass).forEach(function (btn) {
                btn.addEventListener("click", function () {
                    if (!confirm(cfg.deleteConfirm || "¿Seguro que quieres eliminar este registro?")) return;
                    const id = parseInt(btn.dataset.id, 10);
                    items = items.filter(function (x) {
                        return x.id !== id;
                    });
                    setMsg("");
                    render();
                });
            });
        }

        if (infoBtn) {
            infoBtn.addEventListener("click", function (e) {
                e.preventDefault();
                openInfo();
            });
        }
        if (closeInfoBtn) closeInfoBtn.addEventListener("click", closeInfo);
        if (okInfoBtn) okInfoBtn.addEventListener("click", closeInfo);

        if (addBtn) {
            addBtn.addEventListener("click", function () {
                const name = (nameInput && nameInput.value.trim()) || "";
                const url = (urlInput && urlInput.value.trim()) || "";
                const token = (tokenInput && tokenInput.value.trim()) || "";
                if (!name || !url || !token) {
                    setMsg("Faltan datos obligatorios.", true);
                    return;
                }
                items.push({ id: nextId++, name: name, url: url, token: token });
                if (nameInput) nameInput.value = "";
                if (urlInput) urlInput.value = "";
                if (tokenInput) tokenInput.value = "";
                setMsg("");
                render();
            });
        }

        if (closeEditBtn) closeEditBtn.addEventListener("click", closeEdit);

        if (saveEditBtn) {
            saveEditBtn.addEventListener("click", function () {
                const id = parseInt(editId && editId.value, 10);
                const item = items.find(function (x) {
                    return x.id === id;
                });
                if (!item) return;
                const name = (editName && editName.value.trim()) || "";
                const url = (editUrl && editUrl.value.trim()) || "";
                const token = (editToken && editToken.value.trim()) || "";
                if (!name || !url || !token) {
                    alert("Faltan datos obligatorios.");
                    return;
                }
                item.name = name;
                item.url = url;
                item.token = token;
                closeEdit();
                render();
            });
        }

        document.addEventListener("mousedown", function (e) {
            if (editModal && editModal.classList.contains("popup-show")) {
                if (!editModal.contains(e.target) && !e.target.closest("." + editBtnClass)) {
                    closeEdit();
                }
            }
            if (infoModal && infoModal.classList.contains("popup-show")) {
                if (!infoModal.contains(e.target) && !(infoBtn && infoBtn.contains(e.target))) {
                    closeInfo();
                }
            }
        });

        render();
    }

    setupUiOnlyLinkedApiSection({
        listId: "licenciasApiList",
        addBtnId: "addLicenciasApiBtn",
        nameInputId: "newLicenciasApiName",
        urlInputId: "newLicenciasApiUrl",
        tokenInputId: "newLicenciasApiToken",
        msgId: "licenciasApiMsg",
        editModalId: "editLicenciasApiModal",
        closeEditBtnId: "closeEditLicenciasApiModalBtn",
        editIdFieldId: "editLicenciasApiId",
        editNameId: "editLicenciasApiName",
        editUrlId: "editLicenciasApiUrl",
        editTokenId: "editLicenciasApiToken",
        saveEditBtnId: "saveEditLicenciasApiBtn",
        infoBtnId: "licenciasApiInfoBtn",
        infoModalId: "licenciasApiInfoModal",
        closeInfoBtnId: "closeLicenciasApiInfoBtn",
        okInfoBtnId: "okLicenciasApiInfoBtn",
        editBtnClass: "edit-licencias-api-btn",
        deleteBtnClass: "delete-licencias-api-btn",
        testBtnClass: "test-licencias-api-btn",
        enableTest: true,
        testUrl: "/admin/global_licencias_linked/test",
        deleteConfirm: "¿Seguro que quieres eliminar esta API de licencias?",
    });

    // Mi API (mismo estilo que plantilla email / códigos)
    const showLicenciasMyApiBtn = document.getElementById("showLicenciasMyApiBtn");
    const licenciasMyApiModal = document.getElementById("licenciasMyApiModal");
    const closeLicenciasMyApiModalBtn = document.getElementById("closeLicenciasMyApiModalBtn");
    const licenciasMyApiUrlDisplay = document.getElementById("licenciasMyApiUrlDisplay");
    const licenciasMyApiTokenDisplay = document.getElementById("licenciasMyApiTokenDisplay");
    const regenLicenciasMasterTokenBtn = document.getElementById("regenLicenciasMasterTokenBtn");

    function openLicenciasMyApiModal() {
        if (!licenciasMyApiModal) return;
        licenciasMyApiModal.classList.remove("popup-hide");
        licenciasMyApiModal.classList.add("popup-show");
    }

    function closeLicenciasMyApiModal() {
        if (!licenciasMyApiModal) return;
        licenciasMyApiModal.classList.remove("popup-show");
        licenciasMyApiModal.classList.add("popup-hide");
    }

    if (showLicenciasMyApiBtn) {
        showLicenciasMyApiBtn.addEventListener("click", function () {
            fetch("/admin/global_licencias_api", {
                method: "GET",
                headers: { "X-CSRFToken": getCsrfToken() },
                credentials: "same-origin",
            })
                .then(function (res) {
                    return res.json();
                })
                .then(function (data) {
                    if (data.status === "ok") {
                        if (licenciasMyApiUrlDisplay) licenciasMyApiUrlDisplay.value = data.api_url || "";
                        if (licenciasMyApiTokenDisplay) licenciasMyApiTokenDisplay.value = data.token || "";
                        openLicenciasMyApiModal();
                    } else {
                        alert("Error al obtener token: " + (data.message || "desconocido"));
                    }
                })
                .catch(function (err) {
                    alert("Error de red: " + (err && err.message ? err.message : "desconocido"));
                });
        });
    }

    if (closeLicenciasMyApiModalBtn) {
        closeLicenciasMyApiModalBtn.addEventListener("click", closeLicenciasMyApiModal);
    }

    document.querySelectorAll(".copy-licencias-api-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;
            input.select();
            try {
                document.execCommand("copy");
            } catch (_e) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(input.value || "");
                }
            }
            const originalIcon = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(function () {
                btn.innerHTML = originalIcon;
            }, 2000);
        });
    });

    if (regenLicenciasMasterTokenBtn) {
        regenLicenciasMasterTokenBtn.addEventListener("click", function () {
            if (
                !confirm(
                    "¿Seguro que quieres regenerar el token de licencias? Las vinculaciones de licencias en otros proyectos dejarán de funcionar hasta que las actualices con el nuevo token."
                )
            ) {
                return;
            }
            fetch("/admin/global_licencias_api/regen_token", {
                method: "POST",
                headers: { "X-CSRFToken": getCsrfToken() },
                credentials: "same-origin",
            })
                .then(function (res) {
                    return res.json();
                })
                .then(function (data) {
                    if (data.status === "ok") {
                        if (licenciasMyApiTokenDisplay) licenciasMyApiTokenDisplay.value = data.token || "";
                        alert("Nuevo token generado.");
                    } else {
                        alert("Error: " + (data.message || "desconocido"));
                    }
                })
                .catch(function (err) {
                    alert("Error de red: " + (err && err.message ? err.message : "desconocido"));
                });
        });
    }

    document.addEventListener("mousedown", function (e) {
        if (licenciasMyApiModal && licenciasMyApiModal.classList.contains("popup-show")) {
            if (
                !licenciasMyApiModal.contains(e.target) &&
                !e.target.closest("#showLicenciasMyApiBtn")
            ) {
                closeLicenciasMyApiModal();
            }
        }
    });
    // ======= FIN UI secciones API licencias =======

});
