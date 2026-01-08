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
    // Guardar estado de checkboxes marcados (independiente de la paginación)
    const checkedUserIds = new Set();

    function fetchUsers() {
        const perPage = perPageSelect.value;
        const searchQuery = searchInput.value;
        
        // Si "Todos", no enviar parámetros de paginación
        let url;
        if (perPage === 'all') {
            url = `/tienda/admin/api/${apiId}/users?per_page=all&search=${searchQuery}`;
        } else {
            url = `/tienda/admin/api/${apiId}/users?page=${currentPage}&per_page=${perPage}&search=${searchQuery}`;
        }

        fetch(url)
            .then(response => response.json())
            .then(data => {
                // Inicializar checkedUserIds con los IDs del servidor si es la primera carga
                if (checkedUserIds.size === 0) {
                    data.linked_user_ids.forEach(id => checkedUserIds.add(id));
                }
                renderTable(data.users, new Set(data.linked_user_ids));
                // Solo mostrar paginación si no es "all"
                if (perPage !== 'all') {
                    restorePaginationButtons();
                    renderPagination(data.pagination);
                } else {
                    // Ocultar paginación cuando se selecciona "all"
                    if (paginationButtons) {
                        while (paginationButtons.firstChild) {
                            paginationButtons.removeChild(paginationButtons.firstChild);
                        }
                    }
                }
            })
            .catch(error => {
                while (usersTableBody.firstChild) {
                    usersTableBody.removeChild(usersTableBody.firstChild);
                }
                const errorRow = document.createElement('tr');
                const errorCell = document.createElement('td');
                errorCell.colSpan = 3;
                errorCell.className = 'text-center';
                errorCell.textContent = 'Error al cargar usuarios.';
                errorRow.appendChild(errorCell);
                usersTableBody.appendChild(errorRow);
            });
    }

    function renderTable(users, linkedUserIds) {
        while (usersTableBody.firstChild) {
            usersTableBody.removeChild(usersTableBody.firstChild);
        }
        
        if (users.length === 0) {
            const noUsersRow = document.createElement('tr');
            const noUsersCell = document.createElement('td');
            noUsersCell.colSpan = 3;
            noUsersCell.className = 'text-center';
            noUsersCell.textContent = 'No se encontraron usuarios.';
            noUsersRow.appendChild(noUsersCell);
            usersTableBody.appendChild(noUsersRow);
            return;
        }

        users.forEach(user => {
            // Verificar estado guardado primero, luego el del servidor
            const isChecked = checkedUserIds.has(user.id);
            const row = document.createElement("tr");
            
            const usernameCell = document.createElement("td");
            usernameCell.textContent = user.username;
            row.appendChild(usernameCell);
            
            const nameCell = document.createElement("td");
            nameCell.textContent = user.name || '';
            row.appendChild(nameCell);
            
            const checkboxCell = document.createElement("td");
            checkboxCell.className = 'text-center';
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "user_ids";
            checkbox.value = user.id;
            checkbox.className = "user-link-checkbox";
            if (isChecked) {
                checkbox.checked = true;
            }
            
            // Event listener para actualizar el estado guardado
            checkbox.addEventListener('change', function() {
                if (this.checked) {
                    checkedUserIds.add(user.id);
                } else {
                    checkedUserIds.delete(user.id);
                }
            });
            
            checkboxCell.appendChild(checkbox);
            row.appendChild(checkboxCell);
            
            usersTableBody.appendChild(row);
        });
    }

    function restorePaginationButtons() {
        if (!paginationButtons) return;
        
        // Solo restaurar si el contenedor está vacío
        if (paginationButtons.children.length === 0) {
            // Restaurar botón Anterior
            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'btn-panel btn-blue';
            prevBtn.textContent = '< Anterior';
            prevBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    fetchUsers();
                }
            });
            paginationButtons.appendChild(prevBtn);
            
            // Restaurar indicador de página
            const indicator = document.createElement('span');
            indicator.className = 'mx-2';
            indicator.textContent = 'Página 1 de 1';
            paginationButtons.appendChild(indicator);
            
            // Restaurar botón Siguiente
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'btn-panel btn-blue';
            nextBtn.textContent = 'Siguiente >';
            nextBtn.addEventListener('click', () => {
                currentPage++;
                fetchUsers();
            });
            paginationButtons.appendChild(nextBtn);
        }
    }
    
    function renderPagination(pagination) {
        if (!paginationButtons) return;
        
        let pageIndicatorEl = paginationButtons.querySelector('span');
        let prevPageBtnEl = paginationButtons.querySelector('button:first-child');
        let nextPageBtnEl = paginationButtons.querySelector('button:last-child');
        
        // Si los elementos no existen, restaurarlos
        if (!pageIndicatorEl || !prevPageBtnEl || !nextPageBtnEl) {
            restorePaginationButtons();
            pageIndicatorEl = paginationButtons.querySelector('span');
            prevPageBtnEl = paginationButtons.querySelector('button:first-child');
            nextPageBtnEl = paginationButtons.querySelector('button:last-child');
        }
        
        if (!pageIndicatorEl || !prevPageBtnEl || !nextPageBtnEl) {
            return;
        }
        
        pageIndicatorEl.textContent = `Página ${pagination.page} de ${pagination.pages || 1}`;
        
        // Anterior
        if (!pagination.has_prev) {
            prevPageBtnEl.disabled = true;
            prevPageBtnEl.setAttribute('disabled', 'disabled');
        } else {
            prevPageBtnEl.disabled = false;
            prevPageBtnEl.removeAttribute('disabled');
        }
        
        // Siguiente
        if (!pagination.has_next) {
            nextPageBtnEl.disabled = true;
            nextPageBtnEl.setAttribute('disabled', 'disabled');
        } else {
            nextPageBtnEl.disabled = false;
            nextPageBtnEl.removeAttribute('disabled');
        }
    }

    function setAllCheckboxes(checked) {
        const checkboxes = usersTableBody.querySelectorAll('.user-link-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            const userId = parseInt(checkbox.value);
            if (checked) {
                checkedUserIds.add(userId);
            } else {
                checkedUserIds.delete(userId);
            }
        });
    }

    if (checkAllBtn) checkAllBtn.addEventListener("click", () => setAllCheckboxes(true));
    if (uncheckAllBtn) uncheckAllBtn.addEventListener("click", () => setAllCheckboxes(false));
    
    // Interceptar el envío del formulario para incluir todos los IDs marcados
    const apiForm = document.getElementById('apiForm');
    if (apiForm) {
        apiForm.addEventListener('submit', function(e) {
            // Eliminar campos ocultos anteriores si existen
            const existingHiddenInputs = apiForm.querySelectorAll('input[type="hidden"][name="user_ids"]');
            existingHiddenInputs.forEach(input => input.remove());
            
            // Agregar campos ocultos para todos los IDs marcados
            checkedUserIds.forEach(userId => {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'user_ids';
                hiddenInput.value = userId;
                apiForm.appendChild(hiddenInput);
            });
        });
    }
    
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
            driveField.classList.remove('drive-folder-id-field');
            if(apiKeyHelp) apiKeyHelp.classList.remove('api-key-help');
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 5;
                apiKeyTextarea.placeholder = '{\n  "type": "service_account", ...\n}';
            }
            if(driveSubtitlesFields) driveSubtitlesFields.classList.remove('drive-subtitles-fields');
            if(apiKeyHelp) {
                while (apiKeyHelp.firstChild) {
                    apiKeyHelp.removeChild(apiKeyHelp.firstChild);
                }
                const text = document.createTextNode('Pega aquí el ');
                const bold = document.createElement('b');
                bold.textContent = 'JSON de credenciales';
                const text2 = document.createTextNode(' de tu cuenta de servicio de Google (Google Service Account). Puedes obtenerlo desde la consola de Google Cloud → IAM & admin → Cuentas de servicio → Crear clave.');
                apiKeyHelp.appendChild(text);
                apiKeyHelp.appendChild(bold);
                apiKeyHelp.appendChild(text2);
            }
        } else if (tipoApi.value === '' || tipoApi.value === null) {
            // API Genérica / Ninguno - permitir HTML
            driveField.classList.add('drive-folder-id-field');
            if (apiUrlInput) apiUrlInput.value = '';
            if(apiKeyHelp) apiKeyHelp.classList.remove('api-key-help');
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 10;
                apiKeyTextarea.placeholder = '';
            }
            if(driveSubtitlesFields) driveSubtitlesFields.classList.add('drive-subtitles-fields');
            if(apiKeyHelp) {
                apiKeyHelp.textContent = 'Puedes usar HTML en este campo para APIs genéricas.';
            }
        } else {
            // Búsqueda de Medios u otros
            driveField.classList.add('drive-folder-id-field');
            if (apiUrlInput) apiUrlInput.value = '';
            if(apiKeyHelp) apiKeyHelp.classList.add('api-key-help');
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 5;
                apiKeyTextarea.placeholder = '';
            }
            if(driveSubtitlesFields) driveSubtitlesFields.classList.add('drive-subtitles-fields');
            if(apiKeyHelp) {
                apiKeyHelp.textContent = '';
            }
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
                    driveSubtitlesWarning.classList.remove('drive-subtitles-warning');
                    e.preventDefault();
                    return false;
                } else {
                    driveSubtitlesWarning.textContent = '';
                    driveSubtitlesWarning.classList.add('drive-subtitles-warning');
                }
            }
        });
    }
}); 
