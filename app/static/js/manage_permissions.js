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
        while(permissionsTableBody.firstChild) {
          permissionsTableBody.removeChild(permissionsTableBody.firstChild);
        }
        permissionsTableBody.appendChild(errorP);
      }
    })
    .catch(err => {
      console.error("Error al cargar usuarios:", err);
      const errorP = document.createElement('p');
      errorP.className = 'text-danger';
      errorP.textContent = `Error al cargar usuarios: ${err.message}`;
      while(permissionsTableBody.firstChild) {
        permissionsTableBody.removeChild(permissionsTableBody.firstChild);
      }
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
          handlePermissionChange(user.id, perm.key, this.checked, checkbox);
        });
        
        cell.appendChild(checkbox);
        row.appendChild(cell);
      });
      
      permissionsTableBody.appendChild(row);
    });
  }
  
  // Marcar cambios pendientes
  const pendingChanges = new Map();
  
  // Manejar cambios de permisos con validaciones
  function handlePermissionChange(userId, permission, value, checkboxElement) {
    // ✅ REGLA: Si se marca is_support, desmarcar can_chat y can_manage_subusers
    if (permission === 'is_support' && value === true) {
      // Desmarcar can_chat
      const chatCheckbox = document.getElementById(`perm-${userId}-can_chat`);
      if (chatCheckbox && chatCheckbox.checked) {
        chatCheckbox.checked = false;
        markAsChanged(userId, 'can_chat', false);
      }
      
      // Desmarcar can_manage_subusers
      const subusersCheckbox = document.getElementById(`perm-${userId}-can_manage_subusers`);
      if (subusersCheckbox && subusersCheckbox.checked) {
        subusersCheckbox.checked = false;
        markAsChanged(userId, 'can_manage_subusers', false);
      }
    }
    
    // ✅ REGLA: Si se marca can_chat o can_manage_subusers y el usuario tiene is_support, desmarcar is_support
    if ((permission === 'can_chat' || permission === 'can_manage_subusers') && value === true) {
      const supportCheckbox = document.getElementById(`perm-${userId}-is_support`);
      if (supportCheckbox && supportCheckbox.checked) {
        supportCheckbox.checked = false;
        markAsChanged(userId, 'is_support', false);
      }
    }
    
    // Marcar el cambio del permiso actual
    markAsChanged(userId, permission, value);
  }
  
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
  const clearUsersSearchBtn = document.getElementById('clearUsersSearchBtn');
  
  if (searchUsersInput) {
    let searchTimeout = null;
    
    // Función para mostrar/ocultar botón de limpiar
    function updateClearUsersButton() {
      if (clearUsersSearchBtn) {
        if (searchUsersInput.value.trim().length > 0) {
          clearUsersSearchBtn.classList.add('show');
        } else {
          clearUsersSearchBtn.classList.remove('show');
        }
      }
    }
    
    // Función para limpiar búsqueda de usuarios
    function clearUsersSearch() {
      searchUsersInput.value = '';
      filteredUsers = allUsers;
      renderTable();
      updateStats();
      updateClearUsersButton();
    }
    
    searchUsersInput.addEventListener('input', function() {
      updateClearUsersButton();
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
    
    // Click en el botón X para limpiar
    if (clearUsersSearchBtn) {
      clearUsersSearchBtn.addEventListener('click', function(e) {
        e.preventDefault();
        clearUsersSearch();
      });
    }
    
    // Inicializar estado del botón
    updateClearUsersButton();
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
          
          // ✅ Recargar usuarios desde el servidor para obtener el estado real
          // (incluye cambios automáticos del backend, como desactivar can_chat/can_manage_subusers cuando is_support=True)
          loadUsers();
          
          // Limpiar cambios pendientes
          pendingChanges.clear();
          updateSaveButton();
          
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
  
  // ==================== GESTIÓN DE RECURSOS DE HERRAMIENTAS ADMIN ====================
  
  const resourcesPermissionsTableBody = document.getElementById("resourcesPermissionsTableBody");
  const searchResourcesInput = document.getElementById("searchResourcesInput");
  const saveResourcesPermissionsBtn = document.getElementById("saveResourcesPermissionsBtn");
  const saveResourcesStatus = document.getElementById("saveResourcesStatus");
  const totalResourcesSpan = document.getElementById("totalResources");
  const resourcesUsersHeader = document.getElementById("resourcesUsersHeader");
  
  let allResources = [];
  let filteredResources = [];
  let allUsersForResources = [];
  let filteredUsersForResources = [];
  let resourcesPendingChanges = new Map();
  
  // Cargar recursos y usuarios
  function loadResources() {
    if (!resourcesPermissionsTableBody) return;
    
    Promise.all([
      fetch('/admin/get_tools_resources_ajax', {
        method: 'GET',
        headers: {
          'X-CSRFToken': getCsrfToken()
        }
      }).then(res => res.json()),
      fetch('/admin/search_users_ajax?query=', {
        method: 'GET',
        headers: {
          'X-CSRFToken': getCsrfToken()
        }
      }).then(res => res.json())
    ])
    .then(([resourcesData, usersData]) => {
      if (resourcesData.status === "ok" && usersData.status === "ok") {
        allResources = resourcesData.resources || [];
        filteredResources = allResources;
        allUsersForResources = usersData.users || [];
        filteredUsersForResources = allUsersForResources;
        
        // Actualizar header de recursos dinámicamente (siempre mostrar todos los recursos)
        const headerRow = document.querySelector('#resourcesPermissionsTable thead tr');
        if (headerRow) {
          // Eliminar headers de recursos existentes (excepto el primero: Usuario)
          const existingHeaders = Array.from(headerRow.querySelectorAll('th'));
          for (let i = existingHeaders.length - 1; i >= 1; i--) {
            headerRow.removeChild(existingHeaders[i]);
          }
          
          // Agregar headers para cada recurso (todos, no filtrados)
          allResources.forEach(resource => {
            const th = document.createElement('th');
            th.textContent = resource.title;
            th.title = `${resource.title} (${resource.category})`;
            th.className = 'text-center';
            th.dataset.resourceId = resource.id;
            th.dataset.resourceType = resource.type;
            headerRow.appendChild(th);
          });
        }
        
        renderResourcesTable(filteredUsersForResources);
        updateResourcesStats();
      } else {
        const errorP = document.createElement('p');
        errorP.className = 'text-danger';
        errorP.textContent = `Error: ${resourcesData.message || usersData.message || 'No se pudieron cargar los recursos'}`;
        while(resourcesPermissionsTableBody.firstChild) {
          resourcesPermissionsTableBody.removeChild(resourcesPermissionsTableBody.firstChild);
        }
        resourcesPermissionsTableBody.appendChild(errorP);
      }
    })
    .catch(err => {
      console.error("Error al cargar recursos:", err);
      const errorP = document.createElement('p');
      errorP.className = 'text-danger';
      errorP.textContent = `Error al cargar recursos: ${err.message}`;
      while(resourcesPermissionsTableBody.firstChild) {
        resourcesPermissionsTableBody.removeChild(resourcesPermissionsTableBody.firstChild);
      }
      resourcesPermissionsTableBody.appendChild(errorP);
    });
  }
  
  // Renderizar tabla de recursos (usuarios en filas, recursos en columnas)
  function renderResourcesTable(users) {
    if (!resourcesPermissionsTableBody || !users) return;
    
    // Limpiar tabla
    while(resourcesPermissionsTableBody.firstChild) {
      resourcesPermissionsTableBody.removeChild(resourcesPermissionsTableBody.firstChild);
    }
    
    if (!users || users.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      const headerRow = document.querySelector('#resourcesPermissionsTable thead tr');
      const headerCount = headerRow ? headerRow.querySelectorAll('th').length : 1;
      cell.colSpan = headerCount;
      cell.className = 'text-center text-secondary';
      cell.textContent = 'No se encontraron usuarios.';
      row.appendChild(cell);
      resourcesPermissionsTableBody.appendChild(row);
      return;
    }
    
    if (!allResources || allResources.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      const headerRow = document.querySelector('#resourcesPermissionsTable thead tr');
      const headerCount = headerRow ? headerRow.querySelectorAll('th').length : 1;
      cell.colSpan = headerCount;
      cell.className = 'text-center text-secondary';
      cell.textContent = 'No se encontraron recursos.';
      row.appendChild(cell);
      resourcesPermissionsTableBody.appendChild(row);
      return;
    }
    
    // Crear una fila por cada usuario
    users.forEach(user => {
      const row = document.createElement('tr');
      row.dataset.userId = user.id;
      
      // Celda de nombre de usuario
      const usernameCell = document.createElement('td');
      usernameCell.textContent = user.username;
      row.appendChild(usernameCell);
      
      // Checkbox para cada recurso (mostrar todos los recursos, no solo los filtrados)
      allResources.forEach(resource => {
        const cell = document.createElement('td');
        cell.className = 'text-center';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'resource-permission-checkbox';
        checkbox.dataset.resourceId = resource.id;
        checkbox.dataset.resourceType = resource.type;
        checkbox.dataset.userId = user.id;
        checkbox.id = `resource-${resource.id}-${resource.type}-user-${user.id}`;
        
        // Establecer estado del checkbox según si el usuario tiene acceso
        // Primero verificar si hay cambios pendientes para este recurso
        const key = `${resource.id}-${resource.type}`;
        let hasAccess = false;
        
        if (resourcesPendingChanges.has(key)) {
          // Si hay cambios pendientes, usar la lista de cambios pendientes
          const pendingData = resourcesPendingChanges.get(key);
          hasAccess = pendingData.user_ids && pendingData.user_ids.includes(user.id);
        } else {
          // Si no hay cambios pendientes, usar la lista original
          hasAccess = resource.user_ids && resource.user_ids.includes(user.id);
        }
        
        checkbox.checked = hasAccess;
        
        // Agregar listener para cambios
        checkbox.addEventListener('change', function() {
          handleResourcePermissionChange(resource.id, resource.type, user.id, this.checked);
        });
        
        cell.appendChild(checkbox);
        row.appendChild(cell);
      });
      
      resourcesPermissionsTableBody.appendChild(row);
    });
  }
  
  // Manejar cambios de permisos de recursos
  function handleResourcePermissionChange(resourceId, resourceType, userId, hasAccess) {
    const key = `${resourceId}-${resourceType}`;
    
    // Obtener el recurso original para tener la lista base de usuarios
    const originalResource = allResources.find(r => r.id === resourceId && r.type === resourceType);
    if (!originalResource) {
      return;
    }
    
    // Si no hay cambios pendientes para este recurso, inicializar con los usuarios actuales
    if (!resourcesPendingChanges.has(key)) {
      resourcesPendingChanges.set(key, {
        resource_id: resourceId,
        resource_type: resourceType,
        user_ids: [...(originalResource.user_ids || [])] // Copiar la lista actual
      });
    }
    
    const resourceData = resourcesPendingChanges.get(key);
    
    // Actualizar la lista de user_ids basándose en el estado actual del checkbox
    if (hasAccess) {
      // Agregar el usuario si no está en la lista
      if (!resourceData.user_ids.includes(userId)) {
        resourceData.user_ids.push(userId);
      }
    } else {
      // Remover el usuario si está en la lista
      const index = resourceData.user_ids.indexOf(userId);
      if (index > -1) {
        resourceData.user_ids.splice(index, 1);
      }
    }
    
    // Si no hay cambios respecto al original, eliminar de pendingChanges
    const originalUserIds = originalResource.user_ids || [];
    const currentUserIds = resourceData.user_ids.sort((a, b) => a - b);
    const originalUserIdsSorted = [...originalUserIds].sort((a, b) => a - b);
    
    if (JSON.stringify(currentUserIds) === JSON.stringify(originalUserIdsSorted)) {
      resourcesPendingChanges.delete(key);
    }
    
    updateResourcesSaveButton();
  }
  
  function updateResourcesSaveButton() {
    if (saveResourcesPermissionsBtn) {
      if (resourcesPendingChanges.size > 0) {
        saveResourcesPermissionsBtn.disabled = false;
        saveResourcesPermissionsBtn.classList.remove('btn-disabled');
        saveResourcesPermissionsBtn.classList.add('btn-green');
      } else {
        saveResourcesPermissionsBtn.disabled = true;
        saveResourcesPermissionsBtn.classList.add('btn-disabled');
        saveResourcesPermissionsBtn.classList.remove('btn-green');
      }
    }
  }
  
  // Actualizar estadísticas de recursos
  function updateResourcesStats() {
    if (totalResourcesSpan) {
      totalResourcesSpan.textContent = allResources.length;
    }
  }
  
  // Búsqueda de usuarios en la tabla de recursos
  const clearResourcesSearchBtn = document.getElementById('clearResourcesSearchBtn');
  
  if (searchResourcesInput) {
    let searchTimeout = null;
    
    // Función para mostrar/ocultar botón de limpiar
    function updateClearResourcesButton() {
      if (clearResourcesSearchBtn) {
        if (searchResourcesInput.value.trim().length > 0) {
          clearResourcesSearchBtn.classList.add('show');
        } else {
          clearResourcesSearchBtn.classList.remove('show');
        }
      }
    }
    
    // Función para limpiar búsqueda de recursos
    function clearResourcesSearch() {
      searchResourcesInput.value = '';
      filteredUsersForResources = allUsersForResources;
      renderResourcesTable(filteredUsersForResources);
      updateClearResourcesButton();
    }
    
    searchResourcesInput.addEventListener('input', function() {
      updateClearResourcesButton();
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = this.value.trim().toLowerCase();
        
        if (query === '') {
          filteredUsersForResources = allUsersForResources;
        } else {
          filteredUsersForResources = allUsersForResources.filter(user => 
            user.username.toLowerCase().includes(query) ||
            (user.full_name && user.full_name.toLowerCase().includes(query)) ||
            (user.email && user.email.toLowerCase().includes(query))
          );
        }
        
        // Renderizar tabla con usuarios filtrados (los recursos siempre se muestran todos)
        renderResourcesTable(filteredUsersForResources);
      }, 200);
    });
    
    // Click en el botón X para limpiar
    if (clearResourcesSearchBtn) {
      clearResourcesSearchBtn.addEventListener('click', function(e) {
        e.preventDefault();
        clearResourcesSearch();
      });
    }
    
    // Inicializar estado del botón
    updateClearResourcesButton();
  }
  
  // Guardar cambios de recursos
  if (saveResourcesPermissionsBtn) {
    saveResourcesPermissionsBtn.addEventListener('click', function() {
      if (resourcesPendingChanges.size === 0) {
        showResourcesStatus('No hay cambios para guardar.', 'text-secondary');
        return;
      }
      
      // Deshabilitar botón mientras se guarda
      this.disabled = true;
      // Guardar contenido original del botón (texto e icono)
      const saveResourcesBtn = this;
      const originalIcon = saveResourcesBtn.querySelector('i');
      const originalIconClass = originalIcon ? originalIcon.className : '';
      const originalText = saveResourcesBtn.textContent.trim();
      
      // Limpiar contenido del botón
      while(saveResourcesBtn.firstChild) {
        saveResourcesBtn.removeChild(saveResourcesBtn.firstChild);
      }
      // Crear spinner y texto
      const spinnerIcon = document.createElement('i');
      spinnerIcon.className = 'fas fa-spinner fa-spin';
      const textNode = document.createTextNode(' Guardando...');
      saveResourcesBtn.appendChild(spinnerIcon);
      saveResourcesBtn.appendChild(textNode);
      
      // Preparar datos para enviar
      const updates = [];
      resourcesPendingChanges.forEach((resourceData, key) => {
        updates.push({
          resource_id: resourceData.resource_id,
          resource_type: resourceData.resource_type,
          user_ids: resourceData.user_ids
        });
      });
      
      // Enviar actualizaciones
      fetch('/admin/update_tools_resources_permissions_ajax', {
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
          showResourcesStatus('Permisos de recursos actualizados correctamente.', 'text-success');
          
      // Recargar recursos y usuarios desde el servidor
      loadResources();
      
      // Actualizar lista de usuarios después de guardar
      fetch('/admin/search_users_ajax?query=', {
        method: 'GET',
        headers: {
          'X-CSRFToken': getCsrfToken()
        }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          allUsersForResources = data.users || [];
          filteredUsersForResources = allUsersForResources;
        }
      })
      .catch(err => {
        console.error("Error al recargar usuarios:", err);
      });
          
          // Limpiar cambios pendientes
          resourcesPendingChanges.clear();
          updateResourcesSaveButton();
          
          // Ocultar mensaje después de 3 segundos
          setTimeout(() => {
            if (saveResourcesStatus) {
              saveResourcesStatus.textContent = '';
              saveResourcesStatus.className = '';
            }
          }, 3000);
        } else {
          showResourcesStatus(`Error: ${data.message || 'No se pudieron actualizar los permisos'}`, 'text-danger');
        }
      })
      .catch(err => {
        console.error("Error al guardar permisos de recursos:", err);
        showResourcesStatus(`Error al guardar: ${err.message}`, 'text-danger');
      })
      .finally(() => {
        // Rehabilitar botón
        const saveResourcesBtn = this;
        saveResourcesBtn.disabled = false;
        // Restaurar contenido original del botón
        while(saveResourcesBtn.firstChild) {
          saveResourcesBtn.removeChild(saveResourcesBtn.firstChild);
        }
        // Restaurar icono original si existía
        if (originalIconClass && originalIconClass.includes('fa-save')) {
          const icon = document.createElement('i');
          icon.className = originalIconClass;
          saveResourcesBtn.appendChild(icon);
        }
        // Restaurar texto original
        const textNode = document.createTextNode(' Guardar Cambios de Recursos');
        saveResourcesBtn.appendChild(textNode);
      });
    });
  }
  
  // Mostrar estado de recursos
  function showResourcesStatus(message, className) {
    if (saveResourcesStatus) {
      saveResourcesStatus.textContent = message;
      saveResourcesStatus.className = className;
    }
  }
  
  // Inicializar recursos
  if (resourcesPermissionsTableBody) {
    loadResources();
    updateResourcesSaveButton();
  }
});
