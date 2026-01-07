// app/static/js/admin_codigos2_access.js

document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchUserInput');
    const showCountSelect = document.getElementById('showUserCount');
    const usersTableBody = document.getElementById('users-table-body');
    const paginationContainer = document.querySelector('.pagination-buttons');
    const checkAllBtn = document.getElementById('checkAllBtn');
    const uncheckAllBtn = document.getElementById('uncheckAllBtn');

    let currentPage = 1;
    let currentSearch = "";
    let perPage = 'all';
    // Guardar estado de checkboxes marcados (independiente de la paginación)
    const checkedUserIds = new Set();

    // Función helper para escapar HTML y prevenir XSS
    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateTable(users, linked_user_ids) {
        while (usersTableBody.firstChild) {
            usersTableBody.removeChild(usersTableBody.firstChild);
        }
        
        if (users.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3;
            td.className = 'text-center';
            td.textContent = 'No hay usuarios disponibles.';
            tr.appendChild(td);
            usersTableBody.appendChild(tr);
            return;
        }

        users.forEach(user => {
            // Verificar estado guardado primero, luego el del servidor
            const isChecked = checkedUserIds.has(user.id);
            const tr = document.createElement('tr');
            
            const td1 = document.createElement('td');
            td1.textContent = escapeHtml(user.username);
            tr.appendChild(td1);
            
            const td2 = document.createElement('td');
            td2.textContent = escapeHtml(user.full_name || '');
            tr.appendChild(td2);
            
            const td3 = document.createElement('td');
            td3.className = 'text-center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'user_ids';
            checkbox.value = user.id;
            checkbox.setAttribute('form', 'codigos2Form');
            if (isChecked) checkbox.checked = true;
            
            // Event listener para actualizar el estado guardado
            checkbox.addEventListener('change', function() {
                if (this.checked) {
                    checkedUserIds.add(user.id);
                } else {
                    checkedUserIds.delete(user.id);
                }
            });
            
            td3.appendChild(checkbox);
            tr.appendChild(td3);
            
            usersTableBody.appendChild(tr);
        });
    }

    function restorePaginationButtons() {
        if (!paginationContainer) return;
        
        // Solo restaurar si el contenedor está vacío
        if (paginationContainer.children.length === 0) {
            // Restaurar botón Anterior
            const prevBtn = document.createElement('button');
            prevBtn.type = 'button';
            prevBtn.className = 'btn-panel btn-blue';
            prevBtn.textContent = '< Anterior';
            prevBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    fetchUsers(currentPage);
                }
            });
            paginationContainer.appendChild(prevBtn);
            
            // Restaurar indicador de página
            const indicator = document.createElement('span');
            indicator.className = 'mx-2';
            indicator.textContent = 'Página 1 de 1';
            paginationContainer.appendChild(indicator);
            
            // Restaurar botón Siguiente
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'btn-panel btn-blue';
            nextBtn.textContent = 'Siguiente >';
            nextBtn.addEventListener('click', () => {
                currentPage++;
                fetchUsers(currentPage);
            });
            paginationContainer.appendChild(nextBtn);
        }
    }
    
    function updatePagination(pagination) {
        if (!paginationContainer) return;
        
        let pageIndicatorEl = paginationContainer.querySelector('span');
        let prevPageBtnEl = paginationContainer.querySelector('button:first-child');
        let nextPageBtnEl = paginationContainer.querySelector('button:last-child');
        
        // Si los elementos no existen, restaurarlos
        if (!pageIndicatorEl || !prevPageBtnEl || !nextPageBtnEl) {
            restorePaginationButtons();
            pageIndicatorEl = paginationContainer.querySelector('span');
            prevPageBtnEl = paginationContainer.querySelector('button:first-child');
            nextPageBtnEl = paginationContainer.querySelector('button:last-child');
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

    async function fetchUsers(page = 1) {
        const searchValue = searchInput.value;
        perPage = showCountSelect.value;
        
        let url;
        if (perPage === 'all') {
            url = `/admin/accesos_codigos2/usuarios?per_page=all&search=${encodeURIComponent(searchValue)}`;
        } else {
            url = `/admin/accesos_codigos2/usuarios?page=${page}&per_page=${perPage}&search=${encodeURIComponent(searchValue)}`;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            // Inicializar checkedUserIds con los IDs del servidor si es la primera carga
            if (checkedUserIds.size === 0) {
                data.linked_user_ids.forEach(id => checkedUserIds.add(id));
            }
            updateTable(data.users, data.linked_user_ids);
            // Solo mostrar paginación si no es "all"
            if (perPage !== 'all') {
                restorePaginationButtons();
                updatePagination(data.pagination);
            } else {
                // Ocultar paginación cuando se selecciona "all"
                while (paginationContainer.firstChild) {
                    paginationContainer.removeChild(paginationContainer.firstChild);
                }
            }
        } catch (error) {
            usersTableBody.innerHTML = '';
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3;
            td.className = 'text-center text-danger';
            td.textContent = 'Error al cargar usuarios.';
            tr.appendChild(td);
            usersTableBody.appendChild(tr);
        }
    }

    function setAllCheckboxes(checked) {
        const checkboxes = usersTableBody.querySelectorAll('input[type="checkbox"]');
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

    if (checkAllBtn) {
        checkAllBtn.addEventListener("click", function() {
            setAllCheckboxes(true);
        });
    }

    if (uncheckAllBtn) {
        uncheckAllBtn.addEventListener("click", function() {
            setAllCheckboxes(false);
        });
    }

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fetchUsers(1), 500);
        });
    }

    if (showCountSelect) {
        showCountSelect.addEventListener('change', () => fetchUsers(1));
    }

    // Interceptar el envío del formulario para incluir todos los IDs marcados
    const codigos2Form = document.getElementById('codigos2Form');
    if (codigos2Form) {
        codigos2Form.addEventListener('submit', function(e) {
            // Eliminar campos ocultos anteriores si existen
            const existingHiddenInputs = codigos2Form.querySelectorAll('input[type="hidden"][name="user_ids"]');
            existingHiddenInputs.forEach(input => input.remove());
            
            // Agregar campos ocultos para todos los IDs marcados
            checkedUserIds.forEach(userId => {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'user_ids';
                hiddenInput.value = userId;
                codigos2Form.appendChild(hiddenInput);
            });
        });
    }
    
    // Initial fetch to populate the table on page load
    fetchUsers(1);
});

