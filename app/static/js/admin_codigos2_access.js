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
    let perPage = 10;

    // Función helper para escapar HTML y prevenir XSS
    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateTable(users, linked_user_ids) {
        usersTableBody.innerHTML = '';
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
            const isChecked = linked_user_ids.includes(user.id);
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
            td3.appendChild(checkbox);
            tr.appendChild(td3);
            
            usersTableBody.appendChild(tr);
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
            updateTable(data.users, data.linked_user_ids);
            if (perPage !== 'all') {
                updatePagination(data.pagination);
            } else {
                paginationContainer.innerHTML = "";
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
    fetchUsers(1);
});

