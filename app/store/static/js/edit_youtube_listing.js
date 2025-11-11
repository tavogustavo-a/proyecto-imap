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
                renderTable(data.users, data.linked_user_ids);
                renderPagination(data.pagination);
            })
            .catch(error => {
                // Error loading users
            });
    }

    function renderTable(users, linked_user_ids) {
        usersTableBody.innerHTML = '';
        if (users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="3" class="text-center">No se encontraron usuarios.</td></tr>';
            return;
        }

        users.forEach(user => {
            const isChecked = linked_user_ids.includes(user.id);
            const row = `
                <tr>
                    <td>${user.username}</td>
                    <td>${user.full_name}</td>
                    <td class="text-center">
                        <input type="checkbox" name="user_ids" value="${user.id}" class="form-check-input" ${isChecked ? 'checked' : ''}>
                    </td>
                </tr>
            `;
            usersTableBody.insertAdjacentHTML('beforeend', row);
        });
    }

    function renderPagination(pagination) {
        // Si "Todos", ocultar la paginación
        if (perPageSelect.value === 'all') {
            pageIndicator.textContent = 'Mostrando todos los usuarios';
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
            prevPageBtn.setAttribute('disabled', 'disabled');
            nextPageBtn.setAttribute('disabled', 'disabled');
            return;
        }
        
        pageIndicator.textContent = `Página ${pagination.page} de ${pagination.pages || 1}`;
        
        // Anterior
        if (!pagination.has_prev) {
            prevPageBtn.disabled = true;
            prevPageBtn.setAttribute('disabled', 'disabled');
        } else {
            prevPageBtn.disabled = false;
            prevPageBtn.removeAttribute('disabled');
        }
        
        if (!pagination.has_next) {
            nextPageBtn.disabled = true;
            nextPageBtn.setAttribute('disabled', 'disabled');
        } else {
            nextPageBtn.disabled = false;
            nextPageBtn.removeAttribute('disabled');
        }
    }

    // Event Listeners
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            fetchUsers();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        currentPage++;
        fetchUsers();
    });

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
        usersTableBody.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = true;
        });
    });

    deselectAllBtn.addEventListener('click', () => {
        usersTableBody.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
        });
    });

    // Links de Producción ---

    function createLinkRow(link) {
        const div = document.createElement('div');
        div.className = 'production-link-item d-flex align-items-center justify-content-between gap-2 mb-1';
        div.dataset.linkId = link.id;

        const titleDisplay = link.title ? `<div class="link-title"><strong>${link.title}</strong></div>` : '';
        const truncatedUrl = link.url.length > 15 ? link.url.substring(0, 15) + '...' : link.url;

        div.innerHTML = `
            <div class="link-info flex-grow-1">
                ${titleDisplay}
                <div class="link-url" title="${link.url}">${truncatedUrl}</div>
            </div>
            <div class="link-actions">
                <button type="button" class="btn-panel btn-blue btn-small edit-link-btn" data-link-id="${link.id}" data-link-url="${link.url}" data-link-title="${link.title || ''}">Editar</button>
                <button type="button" class="btn-panel btn-red btn-small remove-link-btn" data-link-id="${link.id}">-</button>
            </div>
        `;
        return div;
    }

    async function fetchLinks() {
        const response = await fetch(`/tienda/admin/youtube_listing/${listingId}/links`);
        const links = await response.json();
        productionLinksContainer.innerHTML = '';
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
            linkRow.style.opacity = '0.5';
        }

        try {
            const response = await fetch(`/tienda/admin/youtube_listing/link/${linkId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': csrfToken }
            });

            if (!response.ok) throw new Error('Error al eliminar el link.');

            if (linkRow) linkRow.remove();

        } catch (error) {
            if (linkRow) linkRow.style.opacity = '1';
            alert('No se pudo eliminar el link.');
        }
    }

    function openModal(linkId, currentUrl, currentTitle) {
        editLinkIdInput.value = linkId;
        editLinkInput.value = currentUrl;
        editLinkTitleInput.value = currentTitle;
        modal.style.display = 'flex';
    }

    function closeModal() {
        modal.style.display = 'none';
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
