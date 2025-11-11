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
    let perPage = 5;

    function updateTable(users, linked_user_ids) {
        usersTableBody.innerHTML = ''; // Render rows
        if (users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No hay usuarios disponibles.</td></tr>';
            return;
        }

        users.forEach(user => {
            const isChecked = linked_user_ids.includes(user.id);
            const row = `
                <tr>
                    <td>${user.username}</td>
                    <td>${user.full_name || ''}</td>
                    <td style="text-align:center;">
                        <input type="checkbox" name="user_ids" value="${user.id}" form="toolForm" ${isChecked ? 'checked' : ''}>
                    </td>
                </tr>
            `;
            usersTableBody.insertAdjacentHTML('beforeend', row);
        });
    }

    function updatePagination(pagination) {
        paginationContainer.innerHTML = '';
        
        const prevButton = document.createElement('button');
        prevButton.innerHTML = "&lt; Anterior";
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
        pageInfo.innerText = `Página ${pagination.page} de ${pagination.pages}`;
        paginationContainer.appendChild(pageInfo);
        
        const nextButton = document.createElement("button");
        nextButton.innerHTML = "Siguiente &gt;";
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
            updateTable(data.users, data.linked_user_ids);
            // Solo mostrar paginación si no es "all"
            if (perPage !== 'all') {
                updatePagination(data.pagination);
            } else {
                // Ocultar paginación cuando se selecciona "all"
                paginationContainer.innerHTML = "";
            }
        } catch (error) {
            usersTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: red;">Error al cargar usuarios.</td></tr>';
        }
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
}); 
