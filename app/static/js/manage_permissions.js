// app/static/js/manage_permissions.js

document.addEventListener("DOMContentLoaded", function() {
  const permissionsTableBody = document.getElementById("permissionsTableBody");
  const searchUsersInput = document.getElementById("searchUsersInput");
  const savePermissionsBtn = document.getElementById("savePermissionsBtn");
  const saveStatus = document.getElementById("saveStatus");
  const totalUsersSpan = document.getElementById("totalUsers");
  
  let allUsers = [];
  let filteredUsers = [];
  
  // Definición de permisos con sus nombres descriptivos
  const permissions = [
    { key: 'can_search_any', label: 'Consultar Sin Restricciones', group: 'emails' },
    { key: 'can_add_own_emails', label: 'Agregar Correos', group: 'emails' },
    { key: 'can_bulk_delete_emails', label: 'Borrar Masivamente', group: 'emails' },
    { key: 'can_manage_2fa_emails', label: 'Gestionar 2FA', group: 'emails' },
    { key: 'can_create_subusers', label: 'Crear Sub-usuarios', group: 'emails' },
    { key: 'can_access_store', label: 'Tienda', group: 'general' },
    { key: 'can_access_codigos2', label: 'Códigos 2', group: 'general' },
    { key: 'can_chat', label: 'Chat', group: 'general' },
    { key: 'can_manage_subusers', label: 'Gestionar Sub-usuarios', group: 'general' },
    { key: 'is_support', label: 'Soporte', group: 'general' }
  ];
  
  // Función para obtener el token CSRF
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.content : '';
  }
  
  // Cargar usuarios al iniciar
  function loadUsers() {
    fetch('/admin/search_users_ajax?query=', {
      method: 'GET',
      headers: {
        'X-CSRFToken': getCsrfToken()
      }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "ok") {
        allUsers = data.users || [];
        filteredUsers = allUsers;
        renderTable();
        updateStats();
      } else {
        const errorP = document.createElement('p');
        errorP.className = 'text-danger';
        errorP.textContent = `Error: ${data.message || 'No se pudieron cargar los usuarios'}`;
        permissionsTableBody.innerHTML = '';
        permissionsTableBody.appendChild(errorP);
      }
    })
    .catch(err => {
      console.error("Error al cargar usuarios:", err);
      const errorP = document.createElement('p');
      errorP.className = 'text-danger';
      errorP.textContent = `Error al cargar usuarios: ${err.message}`;
      permissionsTableBody.innerHTML = '';
      permissionsTableBody.appendChild(errorP);
    });
  }
  
  // Renderizar tabla de permisos
  function renderTable() {
    if (!permissionsTableBody) return;
    
    // Limpiar tabla
    while(permissionsTableBody.firstChild) {
      permissionsTableBody.removeChild(permissionsTableBody.firstChild);
    }
    
    if (!filteredUsers || filteredUsers.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 11;
      cell.className = 'text-center text-secondary';
      cell.textContent = 'No se encontraron usuarios.';
      row.appendChild(cell);
      permissionsTableBody.appendChild(row);
      return;
    }
    
    filteredUsers.forEach(user => {
      const row = document.createElement('tr');
      row.dataset.userId = user.id;
      
      // Celda de nombre de usuario
      const usernameCell = document.createElement('td');
      usernameCell.textContent = user.username;
      row.appendChild(usernameCell);
      
      // Crear checkboxes para cada permiso
      permissions.forEach(perm => {
        const cell = document.createElement('td');
        cell.className = 'text-center';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'permission-checkbox';
        checkbox.dataset.userId = user.id;
        checkbox.dataset.permission = perm.key;
        checkbox.id = `perm-${user.id}-${perm.key}`;
        
        // Establecer estado del checkbox según el permiso del usuario
        const permValue = user[perm.key];
        checkbox.checked = permValue === true || permValue === 1 || permValue === 'true';
        
        // Agregar listener para cambios
        checkbox.addEventListener('change', function() {
          markAsChanged(user.id, perm.key, this.checked);
        });
        
        cell.appendChild(checkbox);
        row.appendChild(cell);
      });
      
      permissionsTableBody.appendChild(row);
    });
  }
  
  // Marcar cambios pendientes
  const pendingChanges = new Map();
  
  function markAsChanged(userId, permission, value) {
    const key = `${userId}-${permission}`;
    if (!pendingChanges.has(userId)) {
      pendingChanges.set(userId, {});
    }
    pendingChanges.get(userId)[permission] = value;
    updateSaveButton();
  }
  
  function updateSaveButton() {
    if (savePermissionsBtn) {
      if (pendingChanges.size > 0) {
        savePermissionsBtn.disabled = false;
        savePermissionsBtn.classList.remove('btn-disabled');
        savePermissionsBtn.classList.add('btn-green');
      } else {
        savePermissionsBtn.disabled = true;
        savePermissionsBtn.classList.add('btn-disabled');
        savePermissionsBtn.classList.remove('btn-green');
      }
    }
  }
  
  // Actualizar estadísticas
  function updateStats() {
    if (totalUsersSpan) {
      totalUsersSpan.textContent = allUsers.length;
    }
  }
  
  // Búsqueda de usuarios
  if (searchUsersInput) {
    let searchTimeout = null;
    
    searchUsersInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = this.value.trim().toLowerCase();
        
        if (query === '') {
          filteredUsers = allUsers;
        } else {
          filteredUsers = allUsers.filter(user => 
            user.username.toLowerCase().includes(query) ||
            (user.full_name && user.full_name.toLowerCase().includes(query)) ||
            (user.email && user.email.toLowerCase().includes(query))
          );
        }
        
        renderTable();
        updateStats();
      }, 200);
    });
  }
  
  // Guardar cambios
  if (savePermissionsBtn) {
    savePermissionsBtn.addEventListener('click', function() {
      if (pendingChanges.size === 0) {
        showStatus('No hay cambios para guardar.', 'text-secondary');
        return;
      }
      
      // Deshabilitar botón mientras se guarda
      this.disabled = true;
      this.textContent = 'Guardando...';
      
      // Preparar datos para enviar
      const updates = [];
      pendingChanges.forEach((changes, userId) => {
        updates.push({
          user_id: parseInt(userId),
          permissions: changes
        });
      });
      
      // Enviar actualizaciones
      fetch('/admin/update_permissions_bulk_ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ updates: updates })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          showStatus('Permisos actualizados correctamente.', 'text-success');
          
          // Actualizar datos locales
          updates.forEach(update => {
            const user = allUsers.find(u => u.id === update.user_id);
            if (user) {
              Object.keys(update.permissions).forEach(perm => {
                user[perm] = update.permissions[perm];
              });
            }
          });
          
          // Limpiar cambios pendientes
          pendingChanges.clear();
          updateSaveButton();
          
          // Recargar tabla para reflejar cambios
          renderTable();
          
          // Ocultar mensaje después de 3 segundos
          setTimeout(() => {
            if (saveStatus) {
              saveStatus.textContent = '';
              saveStatus.className = '';
            }
          }, 3000);
        } else {
          showStatus(`Error: ${data.message || 'No se pudieron actualizar los permisos'}`, 'text-danger');
        }
      })
      .catch(err => {
        console.error("Error al guardar permisos:", err);
        showStatus(`Error al guardar: ${err.message}`, 'text-danger');
      })
      .finally(() => {
        // Rehabilitar botón
        this.disabled = false;
        this.textContent = 'Guardar Cambios';
      });
    });
  }
  
  // Mostrar estado
  function showStatus(message, className) {
    if (saveStatus) {
      saveStatus.textContent = message;
      saveStatus.className = className;
    }
  }
  
  // Inicializar
  loadUsers();
  updateSaveButton();
});
