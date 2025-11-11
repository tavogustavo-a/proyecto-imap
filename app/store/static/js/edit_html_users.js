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
    let perPage = 5;

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
                renderTable(data.users, data.linked_user_ids);
                // Solo mostrar paginación si no es "all"
                if (perPage !== 'all') {
                    renderPagination(data.pagination);
                } else {
                    // Ocultar paginación cuando se selecciona "all"
                    paginationButtons.innerHTML = "";
                }
            })
            .catch(error => {
                usersTableBody.innerHTML = `<tr><td colspan="3" class="text-center">Error al cargar usuarios.</td></tr>`;
            });
    }

    function renderTable(users, linkedUserIds) {
        usersTableBody.innerHTML = "";
        if (users.length === 0) {
            usersTableBody.innerHTML = `<tr><td colspan="3" class="text-center">No se encontraron usuarios.</td></tr>`;
            return;
        }

        users.forEach(user => {
            const isChecked = linkedUserIds.includes(user.id);
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${user.username}</td>
                <td>${user.full_name || ''}</td>
                <td class="text-center">
                    <input type="checkbox" name="user_ids" value="${user.id}" form="htmlForm" ${isChecked ? 'checked' : ''}>
                </td>
            `;
            usersTableBody.appendChild(row);
        });
    }

    function renderPagination(pagination) {
        paginationButtons.innerHTML = "";
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
}); 
