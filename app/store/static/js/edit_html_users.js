document.addEventListener("DOMContentLoaded", function() {
    const searchUserInput = document.getElementById("searchUserInput");
    const showUserCountSelect = document.getElementById("showUserCount");
    const usersTableBody = document.getElementById("users-table-body");
    const paginationButtons = document.querySelector(".pagination-buttons");
    const checkAllBtn = document.getElementById("checkAllBtn");
    const uncheckAllBtn = document.getElementById("uncheckAllBtn");
    
    const pathParts = window.location.pathname.split("/");
    const htmlId = pathParts[pathParts.length - 2]; // Obtiene el ID

    let currentPage = 1;
    let currentSearch = "";
    let perPage = 'all';
    // Guardar estado de checkboxes marcados (independiente de la paginación)
    const checkedUserIds = new Set();

    function fetchUsers() {
        currentSearch = searchUserInput.value;
        perPage = showUserCountSelect.value;
        
        // Manejar el caso cuando se selecciona "all"
        let url;
        if (perPage === 'all') {
            // Cuando se selecciona "all", no usar paginación
            url = `/tienda/admin/html/${htmlId}/users?per_page=all&search=${currentSearch}`;
        } else {
            url = `/tienda/admin/html/${htmlId}/users?page=${currentPage}&per_page=${perPage}&search=${currentSearch}`;
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
                    renderPagination(data.pagination);
                } else {
                    // Ocultar paginación cuando se selecciona "all"
                    while (paginationButtons.firstChild) {
                        paginationButtons.removeChild(paginationButtons.firstChild);
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
            nameCell.textContent = user.full_name || '';
            row.appendChild(nameCell);
            
            const checkboxCell = document.createElement("td");
            checkboxCell.className = 'text-center';
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "user_ids";
            checkbox.value = user.id;
            checkbox.setAttribute('form', 'htmlForm');
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

    function renderPagination(pagination) {
        while (paginationButtons.firstChild) {
            paginationButtons.removeChild(paginationButtons.firstChild);
        }
        if (pagination.pages <= 1) return;

        // Botón Anterior
        const prevButton = document.createElement("button");
        prevButton.innerText = "< Anterior";
        prevButton.type = "button";
        prevButton.className = "btn-panel btn-blue";
        prevButton.disabled = !pagination.has_prev;
        prevButton.addEventListener("click", () => {
            currentPage = pagination.prev_num;
            fetchUsers();
        });
        paginationButtons.appendChild(prevButton);

        // Indicador de página
        const pageInfo = document.createElement("span");
        pageInfo.className = "mx-2";
        pageInfo.innerText = `Página ${pagination.page} de ${pagination.pages}`;
        paginationButtons.appendChild(pageInfo);
        
        // Botón Siguiente
        const nextButton = document.createElement("button");
        nextButton.innerText = "Siguiente >";
        nextButton.type = "button";
        nextButton.className = "btn-panel btn-blue";
        nextButton.disabled = !pagination.has_next;
        nextButton.addEventListener("click", () => {
            currentPage = pagination.next_num;
            fetchUsers();
        });
        paginationButtons.appendChild(nextButton);
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

    // Event Listeners
    searchUserInput.addEventListener("input", () => {
        currentPage = 1;
        fetchUsers();
    });

    // Limpiar filtros cuando se usa la 'x' nativa del campo search
    searchUserInput.addEventListener("search", () => {
        if (searchUserInput.value === "") {
            currentPage = 1;
            currentSearch = "";
            fetchUsers();
        }
    });

    showUserCountSelect.addEventListener("change", () => {
        currentPage = 1;
        fetchUsers();
    });

    // Inicial
    fetchUsers();
    
    // Interceptar el envío del formulario para incluir todos los IDs marcados
    const htmlForm = document.getElementById('htmlForm');
    if (htmlForm) {
        htmlForm.addEventListener('submit', function(e) {
            // Eliminar campos ocultos anteriores si existen
            const existingHiddenInputs = htmlForm.querySelectorAll('input[type="hidden"][name="user_ids"]');
            existingHiddenInputs.forEach(input => input.remove());
            
            // Agregar campos ocultos para todos los IDs marcados
            checkedUserIds.forEach(userId => {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'user_ids';
                hiddenInput.value = userId;
                htmlForm.appendChild(hiddenInput);
            });
        });
    }
}); 
