document.addEventListener('DOMContentLoaded', function () {
    const section = document.querySelector('.container');
    if (!section) return;

    const pathParts = window.location.pathname.split("/");
    const apiId = pathParts[pathParts.length - 2]; 
    
    const searchInput = document.getElementById('searchUserInput');
    const perPageSelect = document.getElementById('showUserCount');
    const usersTableBody = document.getElementById('users-table-body');
    const paginationButtons = document.querySelector(".pagination-buttons");

    const checkAllBtn = document.getElementById('checkAllBtn');
    const uncheckAllBtn = document.getElementById('uncheckAllBtn');

    let currentPage = 1;
    let searchTimeout;

    function fetchUsers() {
        const perPage = perPageSelect.value;
        const searchQuery = searchInput.value;
        const url = `/tienda/admin/api/${apiId}/users?page=${currentPage}&per_page=${perPage}&search=${searchQuery}`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                renderTable(data.users, new Set(data.linked_user_ids));
                renderPagination(data.pagination);
            })
            .catch(error => {
                usersTableBody.innerHTML = '<tr><td colspan="3" class="text-center">Error al cargar usuarios.</td></tr>';
            });
    }

    function renderTable(users, linkedUserIds) {
        usersTableBody.innerHTML = '';
        if (users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="3" class="text-center">No se encontraron usuarios.</td></tr>';
            return;
        }

        users.forEach(user => {
            const isChecked = linkedUserIds.has(user.id);
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${user.username}</td>
                <td>${user.name || ''}</td>
                <td class="text-center">
                    <input type="checkbox" name="user_ids" value="${user.id}" class="user-link-checkbox" ${isChecked ? 'checked' : ''}>
                </td>
            `;
            usersTableBody.appendChild(row);
        });
    }

    function renderPagination(pagination) {
        paginationButtons.innerHTML = "";
        
        const prevButton = document.createElement("button");
        prevButton.innerHTML = "&lt; Anterior";
        prevButton.type = "button";
        prevButton.className = "btn-panel btn-blue";
        prevButton.disabled = !pagination.has_prev;
        prevButton.addEventListener("click", () => {
            if (pagination.has_prev) {
                currentPage--;
                fetchUsers();
            }
        });
        paginationButtons.appendChild(prevButton);

        const pageInfo = document.createElement("span");
        pageInfo.className = "mx-2";
        pageInfo.innerText = `Página ${pagination.page} de ${pagination.pages}`;
        paginationButtons.appendChild(pageInfo);
        
        const nextButton = document.createElement("button");
        nextButton.innerHTML = "Siguiente &gt;";
        nextButton.type = "button";
        nextButton.className = "btn-panel btn-blue";
        nextButton.disabled = !pagination.has_next;
        nextButton.addEventListener("click", () => {
            if (pagination.has_next) {
                currentPage++;
                fetchUsers();
            }
        });
        paginationButtons.appendChild(nextButton);
    }

    function setAllCheckboxes(checked) {
        const checkboxes = usersTableBody.querySelectorAll('.user-link-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });
    }

    if (checkAllBtn) checkAllBtn.addEventListener("click", () => setAllCheckboxes(true));
    if (uncheckAllBtn) uncheckAllBtn.addEventListener("click", () => setAllCheckboxes(false));
    
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            fetchUsers();
        }, 300);
    });

    // Event listener para la 'x' nativa del campo de búsqueda
    searchInput.addEventListener('search', () => {
        currentPage = 1;
        fetchUsers();
    });

    perPageSelect.addEventListener('change', () => {
        currentPage = 1;
        fetchUsers();
    });

    fetchUsers();
}); 

// FUNCIONES ESPECÍFICAS PARA EDIT API ==================

// Funciones para manejo de campos de Drive
document.addEventListener('DOMContentLoaded', function() {
    const tipoApi = document.getElementById('api_type');
    const driveField = document.getElementById('drive-folder-id-field');
    const apiUrlInput = document.getElementById('api_url');
    const apiKeyFieldGroup = document.getElementById('api-key-field-group');
    const apiKeyHelp = document.getElementById('api-key-help');
    const driveSubtitlesFields = document.getElementById('drive-subtitles-fields');
    const driveSubtitlePhotos = document.getElementById('drive_subtitle_photos');
    const driveSubtitleVideos = document.getElementById('drive_subtitle_videos');
    const driveSubtitlesWarning = document.getElementById('drive-subtitles-warning');
    const apiForm = document.getElementById('apiForm');

    function toggleDriveField() {
        const apiKeyTextarea = apiKeyFieldGroup ? apiKeyFieldGroup.querySelector('textarea') : null;
        
        if (tipoApi.value === 'Drive') {
            driveField.style.display = '';
            if(apiKeyHelp) apiKeyHelp.style.display = '';
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 5;
                apiKeyTextarea.placeholder = '{\n  "type": "service_account", ...\n}';
            }
            if(driveSubtitlesFields) driveSubtitlesFields.style.display = '';
            if(apiKeyHelp) apiKeyHelp.innerHTML = 'Pega aquí el <b>JSON de credenciales</b> de tu cuenta de servicio de Google (Google Service Account). Puedes obtenerlo desde la consola de Google Cloud &rarr; IAM &amp; admin &rarr; Cuentas de servicio &rarr; Crear clave.';
        } else if (tipoApi.value === '' || tipoApi.value === null) {
            // API Genérica / Ninguno - permitir HTML
            driveField.style.display = 'none';
            if (apiUrlInput) apiUrlInput.value = '';
            if(apiKeyHelp) apiKeyHelp.style.display = '';
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 10;
                apiKeyTextarea.placeholder = '';
            }
            if(driveSubtitlesFields) driveSubtitlesFields.style.display = 'none';
            if(apiKeyHelp) apiKeyHelp.innerHTML = 'Puedes usar HTML en este campo para APIs genéricas.';
        } else {
            // Búsqueda de Medios u otros
            driveField.style.display = 'none';
            if (apiUrlInput) apiUrlInput.value = '';
            if(apiKeyHelp) apiKeyHelp.style.display = 'none';
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 5;
                apiKeyTextarea.placeholder = '';
            }
            if(driveSubtitlesFields) driveSubtitlesFields.style.display = 'none';
            if(apiKeyHelp) apiKeyHelp.innerHTML = '';
        }
    }

    setTimeout(toggleDriveField, 0);
    if(tipoApi) tipoApi.addEventListener('change', toggleDriveField);

    if(apiForm) {
        apiForm.addEventListener('submit', function(e) {
            if(tipoApi.value === 'Drive') {
                const photos = driveSubtitlePhotos.value.trim();
                const videos = driveSubtitleVideos.value.trim();
                if(!photos && !videos) {
                    driveSubtitlesWarning.textContent = 'Debes ingresar al menos un subtítulo para fotos o videos.';
                    driveSubtitlesWarning.style.display = '';
                    e.preventDefault();
                    return false;
                } else {
                    driveSubtitlesWarning.textContent = '';
                    driveSubtitlesWarning.style.display = 'none';
                }
            }
        });
    }
}); 
