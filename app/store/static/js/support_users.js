document.addEventListener('DOMContentLoaded', function() {
    // Verificar si estamos en una página con gestión de usuarios
    const usersTableBody = document.getElementById('users-table-body');
    const perPageSelect = document.getElementById('showUserCount');
    const searchInput = document.getElementById('searchUserInput');
    const paginationButtons = document.querySelector(".pagination-buttons");
    
    // Si no estamos en una página con gestión de usuarios, no ejecutar este script
    if (!usersTableBody || !perPageSelect || !searchInput || !paginationButtons) {
        return;
    }
    
    let currentPage = 1;
    let searchTimeout;
    let allUsers = [];
    let filteredUsers = [];

    // Inicio
    loadAllUsers();

    function loadAllUsers() {
        // Verificar antes de continuar
        if (!usersTableBody) {
            return;
        }
        
        // Obtener todos los usuarios de la tabla actual
        const rows = usersTableBody.querySelectorAll('tr[data-username]');
        allUsers = Array.from(rows).map(row => {
            const username = row.querySelector('td:first-child strong').textContent;
            const chatCheckbox = row.querySelector('.chat-checkbox');
            const soporteCheckbox = row.querySelector('.soporte-checkbox');
            const subusersCheckbox = row.querySelector('.subusers-checkbox');
            
            return {
                username: username,
                chatChecked: chatCheckbox.checked,
                soporteChecked: soporteCheckbox.checked,
                subusersChecked: subusersCheckbox.checked,
                element: row
            };
        });
        
        filteredUsers = [...allUsers];
        
        // Estado inicial de los checkboxes de sub-usuarios
        allUsers.forEach(user => {
            const chatCheckbox = user.element.querySelector('.chat-checkbox');
            const subusersCheckbox = user.element.querySelector('.subusers-checkbox');
            if (chatCheckbox && subusersCheckbox) {
                const userId = chatCheckbox.getAttribute('data-user-id');
                updateSubusersCheckboxState(userId, chatCheckbox.checked);
            }
        });
        
        renderPagination();
        renderTable();
        updateChatVisibility();
        
        // Event listeners después de cargar los usuarios
        addChatCheckboxListeners();
        addSubusersCheckboxListeners();
        addSoporteCheckboxListeners();
    }

    function renderTable() {
        // Verificar antes de continuar
        if (!usersTableBody) {
            return;
        }
        
        const perPageValue = perPageSelect.value;
        let pageUsers = [];

        if (perPageValue === 'all') {
            // Mostrar todos los usuarios
            pageUsers = filteredUsers;
        } else {
            const perPage = parseInt(perPageValue) || 10;
            const startIndex = (currentPage - 1) * perPage;
            const endIndex = startIndex + perPage;
            pageUsers = filteredUsers.slice(startIndex, endIndex);
        }

        // Ocultar todos los usuarios primero
        allUsers.forEach(user => {
            user.element.style.display = 'none';
        });

        // Mostrar usuarios de la página actual
        pageUsers.forEach(user => {
            user.element.style.display = '';
            
            // Estado inicial de los checkboxes de sub-usuarios
            const chatCheckbox = user.element.querySelector('.chat-checkbox');
            const subusersCheckbox = user.element.querySelector('.subusers-checkbox');
            if (chatCheckbox && subusersCheckbox) {
                const userId = chatCheckbox.getAttribute('data-user-id');
                updateSubusersCheckboxState(userId, chatCheckbox.checked);
            }
        });
    }

    function renderPagination() {
        if (!paginationButtons) return;
        
        const perPageValue = perPageSelect.value;
        let totalPages = 1;
        
        if (perPageValue === 'all') {
            paginationButtons.style.display = 'none';
            return;
        } else {
            const perPage = parseInt(perPageValue) || 10;
            totalPages = Math.ceil(filteredUsers.length / perPage);
            paginationButtons.style.display = totalPages > 1 ? 'flex' : 'none';
        }
        
        if (totalPages <= 1) return;
        
        // Limpiar botones existentes
        paginationButtons.innerHTML = '';
        
        // Botón anterior (siempre visible, deshabilitado si es página 1)
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '← Anterior';
        prevBtn.className = 'pagination-btn';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                renderTable();
                renderPagination();
            }
        };
        paginationButtons.appendChild(prevBtn);
        
        // Información de página (solo texto, no botones)
        const pageInfo = document.createElement('span');
        pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
        pageInfo.className = 'pagination-info';
        paginationButtons.appendChild(pageInfo);
        
        // Botón siguiente (siempre visible, deshabilitado si es la última página)
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Siguiente →';
        nextBtn.className = 'pagination-btn';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderTable();
                renderPagination();
            }
        };
        paginationButtons.appendChild(nextBtn);
    }

    function updateChatVisibility() {
        allUsers.forEach(user => {
            const chatColumn = user.element.querySelector('.chat-column');
            if (chatColumn) {
                chatColumn.style.display = user.chatChecked ? '' : 'none';
            }
        });
    }

    function updateSubusersCheckboxState(userId, chatEnabled) {
        const subusersCheckbox = document.querySelector(`.subusers-checkbox[data-user-id="${userId}"]`);
        if (subusersCheckbox) {
            subusersCheckbox.disabled = !chatEnabled;
            if (!chatEnabled) {
                subusersCheckbox.checked = false;
            }
        }
    }

    function addChatCheckboxListeners() {
        allUsers.forEach(user => {
            const chatCheckbox = user.element.querySelector('.chat-checkbox');
            if (chatCheckbox) {
                chatCheckbox.addEventListener('change', function() {
                    user.chatChecked = this.checked;
                    updateChatVisibility();
                    
                    // ✅ NUEVO: Si se marca chat, desmarcar soporte
                    if (this.checked) {
                        const soporteCheckbox = user.element.querySelector('.soporte-checkbox');
                        if (soporteCheckbox && soporteCheckbox.checked) {
                            soporteCheckbox.checked = false;
                            user.soporteChecked = false;
                            const userId = this.getAttribute('data-user-id');
                            updateUserSoporteStatus(userId, false);
                        }
                    }
                    
                    // Actualizar estado del checkbox de sub-usuarios
                    const userId = this.getAttribute('data-user-id');
                    updateSubusersCheckboxState(userId, this.checked);
                    
                    // Enviar actualización al servidor
                    updateUserChatPermission(userId, this.checked);
                });
            }
        });
    }

    function addSubusersCheckboxListeners() {
        allUsers.forEach(user => {
            const subusersCheckbox = user.element.querySelector('.subusers-checkbox');
            if (subusersCheckbox) {
                subusersCheckbox.addEventListener('change', function() {
                    user.subusersChecked = this.checked;
                    
                    // ✅ NUEVO: Si se marca sub-usuarios, desmarcar soporte
                    if (this.checked) {
                        const soporteCheckbox = user.element.querySelector('.soporte-checkbox');
                        if (soporteCheckbox && soporteCheckbox.checked) {
                            soporteCheckbox.checked = false;
                            user.soporteChecked = false;
                            const userId = this.getAttribute('data-user-id');
                            updateUserSoporteStatus(userId, false);
                        }
                    }
                    
                    // Enviar actualización al servidor
                    const userId = this.getAttribute('data-user-id');
                    updateUserSubusersStatus(userId, this.checked);
                });
            }
        });
    }

    function addSoporteCheckboxListeners() {
        allUsers.forEach(user => {
            const soporteCheckbox = user.element.querySelector('.soporte-checkbox');
            if (soporteCheckbox) {
                soporteCheckbox.addEventListener('change', function() {
                    user.soporteChecked = this.checked;
                    
                    // Obtener userId primero
                    const userId = this.getAttribute('data-user-id');
                    
                    // ✅ NUEVO: Si se marca soporte, desmarcar chat y sub-usuarios
                    if (this.checked) {
                        const chatCheckbox = user.element.querySelector('.chat-checkbox');
                        const subusersCheckbox = user.element.querySelector('.subusers-checkbox');
                        
                        if (chatCheckbox) {
                            chatCheckbox.checked = false;
                            user.chatChecked = false;
                            updateUserChatPermission(userId, false);
                        }
                        
                        if (subusersCheckbox) {
                            subusersCheckbox.checked = false;
                            user.subusersChecked = false;
                            updateUserSubusersStatus(userId, false);
                        }
                    }
                    
                    // Enviar actualización al servidor
                    updateUserSoporteStatus(userId, this.checked);
                });
            }
        });
    }

    // Función de búsqueda
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const searchTerm = this.value.toLowerCase();
                
                if (searchTerm === '') {
                    filteredUsers = [...allUsers];
                } else {
                    filteredUsers = allUsers.filter(user => 
                        user.username.toLowerCase().includes(searchTerm)
                    );
                }
                
                currentPage = 1;
                renderTable();
                renderPagination();
            }, 300);
        });
        
        // Event listener para la 'x' nativa de limpiar
        searchInput.addEventListener('search', function() {
            // Se activa cuando se usa la 'x' nativa para limpiar
            const searchTerm = this.value.toLowerCase();
            
            if (searchTerm === '') {
                filteredUsers = [...allUsers];
            } else {
                filteredUsers = allUsers.filter(user => 
                    user.username.toLowerCase().includes(searchTerm)
                );
            }
            
            currentPage = 1;
            renderTable();
            renderPagination();
        });
    }

    // Cambio en el selector de usuarios por página
    if (perPageSelect) {
        perPageSelect.addEventListener('change', function() {
            currentPage = 1;
            renderTable();
            renderPagination();
        });
    }

    // Funciones para actualizar en el servidor
    async function updateUserChatPermission(userId, enabled) {
        try {
            const response = await fetch('/tienda/admin/update_chat_permission', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({
                    user_id: userId,
                    can_chat: enabled
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                alert('Error al actualizar estado de chat: ' + result.message);
            } else {
            }
        } catch (error) {
            alert('Error al actualizar estado de chat: ' + error.message);
        }
    }

    async function updateUserSubusersStatus(userId, enabled) {
        try {
            const response = await fetch('/tienda/admin/update_subusers_permission', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({
                    user_id: userId,
                    can_manage_subusers: enabled
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                alert('Error al actualizar estado de sub-usuarios: ' + result.message);
            } else {
            }
        } catch (error) {
            alert('Error al actualizar estado de sub-usuarios: ' + error.message);
        }
    }

    async function updateUserSoporteStatus(userId, enabled) {
        try {
            const response = await fetch('/tienda/admin/update_soporte_permission', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({
                    user_id: userId,
                    is_support: enabled
                })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                alert('Error al actualizar estado de soporte: ' + result.message);
            } else {
            }
        } catch (error) {
            alert('Error al actualizar estado de soporte: ' + error.message);
        }
    }

    // Función para obtener el token CSRF
    function getCsrfToken() {
        const tokenElement = document.querySelector('meta[name="csrf_token"]');
        return tokenElement ? tokenElement.getAttribute('content') : '';
    }
});
