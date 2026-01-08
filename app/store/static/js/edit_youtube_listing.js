document.addEventListener('DOMContentLoaded', function () {
    const section = document.querySelector('.user-linking-section');
    if (!section) return;

    const listingId = section.dataset.listingId;
    const searchInput = document.getElementById('searchInput');
    const perPageSelect = document.getElementById('perPageSelect');
    const usersTableBody = document.getElementById('users-table-body');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageIndicator = document.getElementById('pageIndicator');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');
    const productionLinksContainer = document.getElementById('production-links-container');
    const addLinkBtn = document.getElementById('add-link-btn');
    const newLinkUrlInput = document.getElementById('new-link-url');
    const newLinkTitleInput = document.getElementById('new-link-title');
    const csrfToken = document.querySelector('input[name="_csrf_token"]').value;

    // Elementos del Modal
    const modal = document.getElementById('edit-link-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const saveEditBtn = document.getElementById('save-edit-btn');
    const editLinkInput = document.getElementById('edit-link-input');
    const editLinkTitleInput = document.getElementById('edit-link-title-input');
    const editLinkIdInput = document.getElementById('edit-link-id-input');

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
            url = `/tienda/admin/youtube_listing/${listingId}/users?per_page=all&search=${searchQuery}`;
        } else {
            url = `/tienda/admin/youtube_listing/${listingId}/users?page=${currentPage}&per_page=${perPage}&search=${searchQuery}`;
        }

        fetch(url)
            .then(response => response.json())
            .then(data => {
                // Inicializar checkedUserIds con los IDs del servidor si es la primera carga
                if (checkedUserIds.size === 0) {
                    data.linked_user_ids.forEach(id => checkedUserIds.add(id));
                }
                renderTable(data.users, data.linked_user_ids);
                // Solo mostrar paginación si no es "all"
                if (perPage !== 'all') {
                    // Restaurar los botones de paginación si fueron eliminados
                    restorePaginationButtons();
                    renderPagination(data.pagination);
                } else {
                    // Ocultar paginación cuando se selecciona "all"
                    const paginationContainer = document.querySelector('.pagination-buttons');
                    if (paginationContainer) {
                        while (paginationContainer.firstChild) {
                            paginationContainer.removeChild(paginationContainer.firstChild);
                        }
                    }
                }
            })
            .catch(error => {
                // Error loading users
            });
    }

    function renderTable(users, linked_user_ids) {
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
            nameCell.textContent = user.full_name;
            row.appendChild(nameCell);
            
            const checkboxCell = document.createElement("td");
            checkboxCell.className = 'text-center';
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "user_ids";
            checkbox.value = user.id;
            checkbox.className = "form-check-input";
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
        const paginationContainer = document.querySelector('.pagination-buttons');
        if (!paginationContainer) return;
        
        // Solo restaurar si el contenedor está vacío
        if (paginationContainer.children.length === 0) {
            // Restaurar botón Anterior
            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.id = 'prevPageBtn';
            prevBtn.className = 'btn-panel btn-blue';
            prevBtn.textContent = '< Anterior';
            prevBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    fetchUsers();
                }
            });
            paginationContainer.appendChild(prevBtn);
            
            // Restaurar indicador de página
            const indicator = document.createElement('span');
            indicator.id = 'pageIndicator';
            indicator.textContent = 'Página 1 de 1';
            paginationContainer.appendChild(indicator);
            
            // Restaurar botón Siguiente
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.id = 'nextPageBtn';
            nextBtn.className = 'btn-panel btn-blue';
            nextBtn.textContent = 'Siguiente >';
            nextBtn.addEventListener('click', () => {
                currentPage++;
                fetchUsers();
            });
            paginationContainer.appendChild(nextBtn);
        }
    }
    
    function renderPagination(pagination) {
        let pageIndicatorEl = document.getElementById('pageIndicator');
        let prevPageBtnEl = document.getElementById('prevPageBtn');
        let nextPageBtnEl = document.getElementById('nextPageBtn');
        
        // Si los elementos no existen, restaurarlos
        if (!pageIndicatorEl || !prevPageBtnEl || !nextPageBtnEl) {
            restorePaginationButtons();
            pageIndicatorEl = document.getElementById('pageIndicator');
            prevPageBtnEl = document.getElementById('prevPageBtn');
            nextPageBtnEl = document.getElementById('nextPageBtn');
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
        
        if (!pagination.has_next) {
            nextPageBtnEl.disabled = true;
            nextPageBtnEl.setAttribute('disabled', 'disabled');
        } else {
            nextPageBtnEl.disabled = false;
            nextPageBtnEl.removeAttribute('disabled');
        }
    }

    // Event Listeners iniciales
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                fetchUsers();
            }
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            currentPage++;
            fetchUsers();
        });
    }

    perPageSelect.addEventListener('change', () => {
        currentPage = 1;
        fetchUsers();
    });

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

    selectAllBtn.addEventListener('click', () => {
        const checkboxes = usersTableBody.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = true;
            const userId = parseInt(checkbox.value);
            checkedUserIds.add(userId);
        });
    });

    deselectAllBtn.addEventListener('click', () => {
        const checkboxes = usersTableBody.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
            const userId = parseInt(checkbox.value);
            checkedUserIds.delete(userId);
        });
    });
    
    // Interceptar el envío del formulario para incluir todos los IDs marcados
    const form = document.querySelector('.edit-youtube-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            // Eliminar campos ocultos anteriores si existen
            const existingHiddenInputs = form.querySelectorAll('input[type="hidden"][name="user_ids"]');
            existingHiddenInputs.forEach(input => input.remove());
            
            // Agregar campos ocultos para todos los IDs marcados
            checkedUserIds.forEach(userId => {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'user_ids';
                hiddenInput.value = userId;
                form.appendChild(hiddenInput);
            });
        });
    }

    // Links de Producción ---

    function createLinkRow(link) {
        const div = document.createElement('div');
        div.className = 'production-link-item d-flex align-items-center justify-content-between gap-2 mb-1';
        div.dataset.linkId = link.id;

        const linkInfo = document.createElement('div');
        linkInfo.className = 'link-info flex-grow-1';
        
        if (link.title) {
            const titleDiv = document.createElement('div');
            titleDiv.className = 'link-title';
            const strong = document.createElement('strong');
            strong.textContent = link.title;
            titleDiv.appendChild(strong);
            linkInfo.appendChild(titleDiv);
        }
        
        const urlDiv = document.createElement('div');
        urlDiv.className = 'link-url';
        urlDiv.title = link.url;
        const truncatedUrl = link.url.length > 15 ? link.url.substring(0, 15) + '...' : link.url;
        urlDiv.textContent = truncatedUrl;
        linkInfo.appendChild(urlDiv);
        
        const linkActions = document.createElement('div');
        linkActions.className = 'link-actions';
        
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-panel btn-blue btn-small edit-link-btn';
        editBtn.setAttribute('data-link-id', link.id);
        editBtn.setAttribute('data-link-url', link.url);
        editBtn.setAttribute('data-link-title', link.title || '');
        editBtn.textContent = 'Editar';
        linkActions.appendChild(editBtn);
        
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-panel btn-red btn-small remove-link-btn';
        removeBtn.setAttribute('data-link-id', link.id);
        removeBtn.textContent = '-';
        linkActions.appendChild(removeBtn);
        
        div.appendChild(linkInfo);
        div.appendChild(linkActions);
        return div;
    }

    async function fetchLinks() {
        const response = await fetch(`/tienda/admin/youtube_listing/${listingId}/links`);
        const links = await response.json();
        while (productionLinksContainer.firstChild) {
            productionLinksContainer.removeChild(productionLinksContainer.firstChild);
        }
        links.forEach(link => {
            productionLinksContainer.appendChild(createLinkRow(link));
        });
    }
    
    async function addLink() {
        const url = newLinkUrlInput.value.trim();
        const title = newLinkTitleInput.value.trim();
        if (!url) return;

        // Validar formatos de YouTube: múltiples variantes
        const isValidYouTube = url.includes('www.youtube.com') || 
                               url.includes('youtube.com/shorts/') || 
                               url.includes('youtube.com/embed/') ||
                               url.includes('youtube.com/v/') ||
                               url.includes('m.youtube.com') ||
                               url.includes('youtu.be/') ||
                               url.includes('youtube-nocookie.com');
        
        if (!isValidYouTube) {
            alert('La URL debe ser un enlace válido de YouTube (videos normales o Shorts).');
            return;
        }

        if (!title) {
            alert('El título es obligatorio.');
            return;
        }

        // No es necesario deshabilitar los botones si la operación es rápida
        newLinkUrlInput.value = '';
        newLinkTitleInput.value = '';

        try {
            const response = await fetch(`/tienda/admin/youtube_listing/${listingId}/add_link`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ url: url, title: title })
            });

            if (!response.ok) throw new Error('Error al añadir el link.');
            
            // Recargar links para mostrar el nuevo
            await fetchLinks();

        } catch (error) {
            alert('No se pudo añadir el link. Por favor, inténtalo de nuevo.');
        }
    }

    async function saveLink() {
        const linkId = editLinkIdInput.value;
        const newUrl = editLinkInput.value.trim();
        const newTitle = editLinkTitleInput.value.trim();
        if (!newUrl) return;

        // Validar formatos de YouTube: múltiples variantes
        const isValidYouTube = newUrl.includes('www.youtube.com') || 
                               newUrl.includes('youtube.com/shorts/') || 
                               newUrl.includes('youtube.com/embed/') ||
                               newUrl.includes('youtube.com/v/') ||
                               newUrl.includes('m.youtube.com') ||
                               newUrl.includes('youtu.be/') ||
                               newUrl.includes('youtube-nocookie.com');
        
        if (!isValidYouTube) {
            alert('La URL debe ser un enlace válido de YouTube (videos normales o Shorts).');
            return;
        }

        if (!newTitle) {
            alert('El título es obligatorio.');
            return;
        }

        try {
            const response = await fetch(`/tienda/admin/youtube_listing/link/${linkId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ url: newUrl, title: newTitle })
            });

            if (!response.ok) throw new Error('Error al guardar el link.');
            
            closeModal();
            await fetchLinks();

        } catch (error) {
            alert('No se pudo guardar el link.');
        }
    }

    async function removeLink(linkId) {
        if (!confirm('¿Estás seguro de que quieres eliminar este link?')) return;
        
        const linkRow = productionLinksContainer.querySelector(`[data-link-id="${linkId}"]`);
        if (linkRow) {
            linkRow.classList.add('opacity-50');
        }

        try {
            const response = await fetch(`/tienda/admin/youtube_listing/link/${linkId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': csrfToken }
            });

            if (!response.ok) throw new Error('Error al eliminar el link.');

            if (linkRow) linkRow.remove();

        } catch (error) {
            if (linkRow) linkRow.classList.remove('opacity-50');
            alert('No se pudo eliminar el link.');
        }
    }

    function openModal(linkId, currentUrl, currentTitle) {
        editLinkIdInput.value = linkId;
        editLinkInput.value = currentUrl;
        editLinkTitleInput.value = currentTitle;
        modal.classList.remove('modal-hidden');
        modal.classList.add('modal-visible');
    }

    function closeModal() {
        modal.classList.add('modal-hidden');
        modal.classList.remove('modal-visible');
    }
    
    addLinkBtn.addEventListener('click', addLink);
    
    newLinkUrlInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLink();
        }
    });

    productionLinksContainer.addEventListener('click', function(e) {
        // Verificación segura para event.target.closest
        if (!e || !e.target || typeof e.target.closest !== 'function') {
            return;
        }
        
        const removeBtn = e.target.closest('.remove-link-btn');
        const editBtn = e.target.closest('.edit-link-btn');

        if (removeBtn) {
            const linkId = removeBtn.dataset.linkId;
            if (linkId) removeLink(linkId);
        } else if (editBtn) {
            const linkId = editBtn.dataset.linkId;
            const linkUrl = editBtn.dataset.linkUrl;
            const linkTitle = editBtn.dataset.linkTitle;
            if (linkId) openModal(linkId, linkUrl, linkTitle);
        }
    });
    
    // Listeners del Modal
    closeModalBtn.addEventListener('click', closeModal);
    cancelEditBtn.addEventListener('click', closeModal);
    saveEditBtn.addEventListener('click', saveLink);
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Fin de Lógica para Links de Producción ---

    // Initial fetches
    fetchUsers();
    fetchLinks();
}); 
