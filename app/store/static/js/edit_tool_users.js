document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchUserInput');
    const showCountSelect = document.getElementById('showUserCount');
    const usersTableBody = document.getElementById('users-table-body');
    const paginationContainer = document.querySelector('.pagination-buttons');
    const checkAllBtn = document.getElementById('checkAllBtn');
    const uncheckAllBtn = document.getElementById('uncheckAllBtn');
    const toolId = window.location.pathname.split('/').find(part => !isNaN(parseInt(part, 10)));

    let currentPage = 1;
    let currentSearch = "";
    let perPage = 'all';
    // Guardar estado de checkboxes marcados (independiente de la paginación)
    const checkedUserIds = new Set();

    function updateTable(users, linked_user_ids) {
        while (usersTableBody.firstChild) {
            usersTableBody.removeChild(usersTableBody.firstChild);
        }
        
        if (users.length === 0) {
            const noUsersRow = document.createElement('tr');
            const noUsersCell = document.createElement('td');
            noUsersCell.colSpan = 3;
            noUsersCell.className = 'text-center';
            noUsersCell.textContent = 'No hay usuarios disponibles.';
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
            nameCell.textContent = user.full_name || '';
            row.appendChild(nameCell);
            
            const checkboxCell = document.createElement("td");
            checkboxCell.className = 'text-center';
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "user_ids";
            checkbox.value = user.id;
            checkbox.setAttribute('form', 'toolForm');
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

    function updatePagination(pagination) {
        while (paginationContainer.firstChild) {
            paginationContainer.removeChild(paginationContainer.firstChild);
        }
        
        const prevButton = document.createElement('button');
        prevButton.textContent = "< Anterior";
        prevButton.type = "button";
        prevButton.className = "btn-panel btn-blue";
        prevButton.disabled = !pagination.has_prev;
        prevButton.addEventListener("click", () => {
            if (pagination.has_prev) {
                fetchUsers(pagination.prev_num);
            }
        });
        paginationContainer.appendChild(prevButton);

        const pageInfo = document.createElement("span");
        pageInfo.className = "mx-2";
        pageInfo.textContent = `Página ${pagination.page} de ${pagination.pages}`;
        paginationContainer.appendChild(pageInfo);
        
        const nextButton = document.createElement("button");
        nextButton.textContent = "Siguiente >";
        nextButton.type = "button";
        nextButton.className = "btn-panel btn-blue";
        nextButton.disabled = !pagination.has_next;
        nextButton.addEventListener("click", () => {
            if (pagination.has_next) {
                fetchUsers(pagination.next_num);
            }
        });
        paginationContainer.appendChild(nextButton);
    }

    async function fetchUsers(page = 1) {
        const searchValue = searchInput.value;
        const perPage = showCountSelect.value;
        
        // Manejar el caso cuando se selecciona "all"
        let url;
        if (perPage === 'all') {
            // Cuando se selecciona "all", no usar paginación
            url = `/tienda/admin/herramientas/${toolId}/usuarios?per_page=all&search=${encodeURIComponent(searchValue)}`;
        } else {
            url = `/tienda/admin/herramientas/${toolId}/usuarios?page=${page}&per_page=${perPage}&search=${encodeURIComponent(searchValue)}`;
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
                updatePagination(data.pagination);
            } else {
                // Ocultar paginación cuando se selecciona "all"
                while (paginationContainer.firstChild) {
                    paginationContainer.removeChild(paginationContainer.firstChild);
                }
            }
        } catch (error) {
            while (usersTableBody.firstChild) {
                usersTableBody.removeChild(usersTableBody.firstChild);
            }
            const errorRow = document.createElement('tr');
            const errorCell = document.createElement('td');
            errorCell.colSpan = 3;
            errorCell.className = 'text-center text-danger';
            errorCell.textContent = 'Error al cargar usuarios.';
            errorRow.appendChild(errorCell);
            usersTableBody.appendChild(errorRow);
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

    // Initial fetch to populate the table on page load
    fetchUsers(new URLSearchParams(window.location.search).get('page') || 1);
    
    // Interceptar el envío del formulario para incluir todos los IDs marcados
    const toolForm = document.getElementById('toolForm');
    if (toolForm) {
        toolForm.addEventListener('submit', function(e) {
            // Eliminar campos ocultos anteriores si existen
            const existingHiddenInputs = toolForm.querySelectorAll('input[type="hidden"][name="user_ids"]');
            existingHiddenInputs.forEach(input => input.remove());
            
            // Agregar campos ocultos para todos los IDs marcados
            checkedUserIds.forEach(userId => {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'user_ids';
                hiddenInput.value = userId;
                toolForm.appendChild(hiddenInput);
            });
        });
    }
}); 
