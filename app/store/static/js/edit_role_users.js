// Funciones principales en la edición de roles

let allUsers = [];
let currentUserPage = 1;
let usersPerPage = 20;
let userSearch = '';

function fetchAndRenderUsers() {
    fetch(`/admin/search_users_ajax?query=${encodeURIComponent(userSearch)}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                allUsers = data.users || [];
                renderUsersTable();
            } else {
                renderUsersTable([]);
            }
        });
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    let filtered = allUsers;
    // Paginación
    let total = filtered.length;
    let perPage = usersPerPage === 'all' ? total : parseInt(usersPerPage);
    let totalPages = perPage === 0 ? 1 : Math.ceil(total / perPage);
    if (currentUserPage > totalPages) currentUserPage = totalPages;
    if (currentUserPage < 1) currentUserPage = 1;
    let start = perPage === 0 ? 0 : (currentUserPage - 1) * perPage;
    let end = perPage === 0 ? total : start + perPage;
    let pageUsers = filtered.slice(start, end);
    tbody.innerHTML = '';
    if (!pageUsers.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay usuarios.</td></tr>';
        return;
    }
    for (const u of pageUsers) {
        let vinculadoEsteRol = u.rol_actual == window.currentRoleId;
        let vinculadoOtroRol = u.rol_actual && u.rol_actual != window.currentRoleId;
        let yaVinculadoHtml = '';
        if (vinculadoEsteRol) {
            yaVinculadoHtml = `<span style='color:green;font-weight:bold;'>✔️ ${u.rol_nombre || ''}</span>`;
        } else if (vinculadoOtroRol) {
            yaVinculadoHtml = `<span style='color:#c00;'>${u.rol_nombre || ''}</span>`;
        }
        tbody.innerHTML += `<tr>
            <td>${u.username}</td>
            <td>${u.full_name || ''}</td>
            <td style="text-align:center;">
                ${vinculadoOtroRol ? '<span style=\'color:#c00;font-size:12px;\'>Desvincúlate del otro rol para vincularte aquí</span>' : `<input type='checkbox' class='vincular-user-checkbox' data-user-id='${u.id}' name='vincular_user_${u.id}' ${vinculadoEsteRol ? 'checked' : ''}>`}
            </td>
            <td style="text-align:center;">${yaVinculadoHtml}</td>
        </tr>`;
    }
    document.getElementById('prevUserPageBtn').disabled = currentUserPage <= 1;
    document.getElementById('nextUserPageBtn').disabled = currentUserPage >= totalPages;
}

document.addEventListener('DOMContentLoaded', function() {
    
    const searchInput = document.getElementById('searchUserInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            userSearch = searchInput.value.trim();
            currentUserPage = 1;
            fetchAndRenderUsers();
        });
        
        // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
        searchInput.addEventListener('search', function() {
            // Si el campo está vacío, limpiar filtros
            if (this.value === '') {
                userSearch = '';
                currentUserPage = 1;
                fetchAndRenderUsers();
            }
        });
    }
    
    const clearBtn = document.getElementById('clearUserSearch');
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', function() {
            searchInput.value = '';
            userSearch = '';
            currentUserPage = 1;
            fetchAndRenderUsers();
            searchInput.focus();
        });
    }
    // Cantidad
    const showCount = document.getElementById('showUserCount');
    if (showCount) {
        showCount.addEventListener('change', function() {
            usersPerPage = showCount.value === 'all' ? 'all' : parseInt(showCount.value);
            currentUserPage = 1;
            renderUsersTable();
        });
    }
    // Botones paginación
    const prevBtn = document.getElementById('prevUserPageBtn');
    const nextBtn = document.getElementById('nextUserPageBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            if (currentUserPage > 1) {
                currentUserPage--;
                renderUsersTable();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            let total = allUsers.length;
            let perPage = usersPerPage === 'all' ? total : parseInt(usersPerPage);
            let totalPages = perPage === 0 ? 1 : Math.ceil(total / perPage);
            if (currentUserPage < totalPages) {
                currentUserPage++;
                renderUsersTable();
            }
        });
    }
    // Vincular/desvincular usuario con AJAX
    document.getElementById('users-table-body').addEventListener('change', function(e) {
        if (e.target.classList.contains('vincular-user-checkbox')) {
            const userId = e.target.getAttribute('data-user-id');
            const vincular = e.target.checked;
            fetch('/tienda/admin/roles/vincular_usuario_ajax', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': (typeof getCsrfToken === 'function') ? getCsrfToken() : ''
                },
                body: JSON.stringify({ user_id: userId, role_id: window.currentRoleId, vincular: vincular })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    fetchAndRenderUsers();
                } else {
                    alert(data.error || 'Error al actualizar vinculación');
                    fetchAndRenderUsers();
                }
            })
            .catch(() => {
                alert('Error de red al actualizar vinculación');
                fetchAndRenderUsers();
            });
        }
    });
    // Inicial
    fetchAndRenderUsers();
}); 
