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
    { key: 'can_chat', label: 'Chat', group: 'general' },
    { key: 'can_manage_subusers', label: 'Gestionar Sub-usuarios', group: 'general' },
    { key: 'is_support', label: 'Soporte', group: 'general' }
  ];
  
  // Función para obtener el token CSRF (meta + cookie _csrf de SeaSurf)
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    if (meta && meta.content) return meta.content;
    const match = document.cookie.match(/(?:^|;\s*)_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function permFetchJson(url, options) {
    options = options || {};
    const headers = Object.assign({ 'X-CSRFToken': getCsrfToken() }, options.headers || {});
    const init = Object.assign({}, options, { headers });
    if (window.StoreFetchJson && window.StoreFetchJson.fetch) {
      return window.StoreFetchJson.fetch(url, init);
    }
    return fetch(url, {
      method: init.method || 'GET',
      credentials: init.credentials != null ? init.credentials : 'same-origin',
      headers: headers,
      body: init.body,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          const err = new Error((data && (data.message || data.error)) || 'Error HTTP ' + res.status);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
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
        checkbox.name = `perm_${user.id}_${perm.key}`;
        
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
        checkbox.name = `resource_${resource.id}_${resource.type}_user_${user.id}`;
        
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
  
  // ============ Gestión de Precios por Usuario ============
  const userPricesTableBody = document.getElementById("userPricesTableBody");
  const saveUserPricesBtn = document.getElementById("saveUserPricesBtn");
  const saveUserPricesStatus = document.getElementById("saveUserPricesStatus");
  const searchUserPricesInput = document.getElementById("searchUserPricesInput");
  const clearUserPricesSearchBtn = document.getElementById("clearUserPricesSearchBtn");
  
  let userPricesData = {}; // { userId: { tipo_precio, soporte_licencias, puede_tener_deuda, recarga_automatica, limite_deuda_usd, limite_deuda_cop } }
  let allUsersForPrices = []; // Todos los usuarios cargados
  let filteredUsersForPrices = []; // Usuarios filtrados por búsqueda

  function debtLimitForUserData(userData, tipoPrecioLower) {
    if (!userData || !tipoPrecioLower) return null;
    const tp = String(tipoPrecioLower).toLowerCase();
    if (tp === 'usd') {
      const v = userData.limite_deuda_usd;
      return v != null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : null;
    }
    if (tp === 'cop') {
      const v = userData.limite_deuda_cop;
      return v != null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : null;
    }
    return null;
  }

  function formatDebtLimitBtnLabel(limite, tipoPrecioLower) {
    const cur = String(tipoPrecioLower || '').toUpperCase();
    if (limite == null || !Number.isFinite(Number(limite))) {
      return 'Límite deuda';
    }
    return `Límite: ${Math.floor(Number(limite))} ${cur}`;
  }

  function syncUserDebtLimitButton(btn, userId, userData, tipoPrecioLower) {
    if (!btn) return;
    const puede = !!(userData && userData.puede_tener_deuda);
    const tp = tipoPrecioLower ? String(tipoPrecioLower).toLowerCase() : null;
    btn.disabled = !puede || !tp;
    if (!puede || !tp) {
      btn.textContent = 'Límite deuda';
      btn.classList.remove('user-debt-limit-btn--set');
      btn.setAttribute('title', 'Activa «Puede tener deuda» para configurar el límite');
      return;
    }
    const lim = debtLimitForUserData(userData, tp);
    btn.textContent = formatDebtLimitBtnLabel(lim, tp);
    btn.classList.toggle('user-debt-limit-btn--set', lim != null);
    btn.setAttribute(
      'title',
      lim != null
        ? `Máximo préstamo: ${Math.floor(lim)} ${tp.toUpperCase()}`
        : 'Definir monto máximo de deuda (préstamo)'
    );
    btn.setAttribute('data-user-id', String(userId));
    btn.setAttribute('data-tipo-precio', tp);
  }

  /** Línea secundaria: el saldo en la moneda no activa sigue en BD al cambiar USD↔COP. */
  function syncSaldoInactivoLine(container, tipoPrecioLower, saldoUsd, saldoCop) {
    if (!container) return;
    const main = container.querySelector('.user-saldo-principal');
    if (!main) return;
    let inactive = container.querySelector('.user-saldo-inactivo');
    const cop = Math.floor(Number(saldoCop) || 0);
    const usd = Math.floor(Number(saldoUsd) || 0);
    const tp = (tipoPrecioLower || '').toLowerCase();
    let text = '';
    if (tp === 'usd' && cop !== 0) {
      text = `COP guardado: ${cop.toLocaleString('es-CO')}`;
    } else if (tp === 'cop' && usd !== 0) {
      text = `USD guardado: ${usd}`;
    }
    if (text) {
      if (!inactive) {
        inactive = document.createElement('div');
        inactive.className = 'user-saldo-inactivo';
        inactive.setAttribute(
          'title',
          'Este saldo no se borra al cambiar entre USD y COP; solo cambia cuál moneda está activa en la tienda.'
        );
        main.insertAdjacentElement('afterend', inactive);
      }
      inactive.textContent = text;
    } else if (inactive) {
      inactive.remove();
    }
  }
  
  // Cargar usuarios para la tabla de precios
  function loadUsersForPrices() {
    if (!userPricesTableBody) return;
    
    fetch('/admin/search_users_ajax?query=', {
      method: 'GET',
      headers: {
        'X-CSRFToken': getCsrfToken()
      }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "ok") {
        allUsersForPrices = data.users || [];
        filterUsersForPrices();
      } else {
        while (userPricesTableBody.firstChild) {
          userPricesTableBody.removeChild(userPricesTableBody.firstChild);
        }
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.className = 'text-center text-danger';
        td.textContent = 'Error al cargar usuarios';
        tr.appendChild(td);
        userPricesTableBody.appendChild(tr);
      }
    })
    .catch(err => {
      console.error('Error:', err);
      while (userPricesTableBody.firstChild) {
        userPricesTableBody.removeChild(userPricesTableBody.firstChild);
      }
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'text-center text-danger';
      td.textContent = 'Error al cargar usuarios';
      tr.appendChild(td);
      userPricesTableBody.appendChild(tr);
    });
  }
  
  // Filtrar usuarios por búsqueda
  function filterUsersForPrices() {
    if (!searchUserPricesInput) {
      filteredUsersForPrices = allUsersForPrices;
      renderUserPricesTable(filteredUsersForPrices);
      return;
    }
    
    const query = searchUserPricesInput.value.trim().toLowerCase();
    
    if (query === '') {
      filteredUsersForPrices = allUsersForPrices;
      if (clearUserPricesSearchBtn) {
        clearUserPricesSearchBtn.classList.remove('show');
      }
    } else {
      filteredUsersForPrices = allUsersForPrices.filter(user => 
        user.username.toLowerCase().includes(query)
      );
      if (clearUserPricesSearchBtn) {
        clearUserPricesSearchBtn.classList.add('show');
      }
    }
    
    renderUserPricesTable(filteredUsersForPrices);
  }
  
  // Renderizar tabla de precios por usuario
  function renderUserPricesTable(users) {
    if (!userPricesTableBody) return;
    
    if (users.length === 0) {
      while (userPricesTableBody.firstChild) {
        userPricesTableBody.removeChild(userPricesTableBody.firstChild);
      }
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'text-center text-secondary';
      td.textContent = 'No hay usuarios';
      tr.appendChild(td);
      userPricesTableBody.appendChild(tr);
      return;
    }
    
    const fragment = document.createDocumentFragment();
    
    users.forEach(user => {
      const userId = user.id;
      // Cargar datos de precios desde el usuario si existen, sino usar valores por defecto
      const userData = userPricesData[userId] || {
        tipo_precio: user.tipo_precio || null,
        soporte_licencias: !!user.soporte_licencias,
        puede_tener_deuda: !!user.puede_tener_deuda,
        recarga_automatica: !!user.recarga_automatica,
        limite_deuda_usd:
          user.limite_deuda_usd != null && user.limite_deuda_usd !== ''
            ? Number(user.limite_deuda_usd)
            : null,
        limite_deuda_cop:
          user.limite_deuda_cop != null && user.limite_deuda_cop !== ''
            ? Number(user.limite_deuda_cop)
            : null
      };
      
      const tr = document.createElement('tr');
      tr.setAttribute('data-user-id', userId);
      
      // Usuario
      const tdUsuario = document.createElement('td');
      tdUsuario.className = 'edit-role-product-cell';
      tdUsuario.textContent = user.username;
      tr.appendChild(tdUsuario);
      
      // Tipo Precio (USD/COP checkboxes) - Vertical
      const tdTipoPrecio = document.createElement('td');
      tdTipoPrecio.className = 'text-center';
      
      const tipoPrecioContainer = document.createElement('div');
      tipoPrecioContainer.className = 'user-prices-tipo-stack';
      
      // Contenedor para USD (checkbox + label juntos sin espacio) - Arriba
      const usdContainer = document.createElement('div');
      usdContainer.className = 'user-prices-tipo-row';
      
      const usdCheckbox = document.createElement('input');
      usdCheckbox.type = 'checkbox';
      usdCheckbox.id = `tipo_usd_${userId}`;
      usdCheckbox.name = `tipo_precio_${userId}`;
      usdCheckbox.value = 'USD';
      usdCheckbox.checked = userData.tipo_precio === 'USD';
      usdCheckbox.className = 'user-price-type-checkbox';
      usdCheckbox.setAttribute('data-user-id', userId);
      usdCheckbox.setAttribute('data-tipo', 'USD');
      
      const usdLabel = document.createElement('label');
      usdLabel.setAttribute('for', `tipo_usd_${userId}`);
      usdLabel.textContent = 'USD';
      usdLabel.className = 'user-price-label';
      usdLabel.style.setProperty('cursor', 'pointer');
      
      usdContainer.appendChild(usdCheckbox);
      usdContainer.appendChild(usdLabel);
      
      // Contenedor para COP (checkbox + label juntos sin espacio) - Abajo
      const copContainer = document.createElement('div');
      copContainer.className = 'user-prices-tipo-row';
      
      const copCheckbox = document.createElement('input');
      copCheckbox.type = 'checkbox';
      copCheckbox.id = `tipo_cop_${userId}`;
      copCheckbox.name = `tipo_precio_${userId}`;
      copCheckbox.value = 'COP';
      copCheckbox.checked = userData.tipo_precio === 'COP';
      copCheckbox.className = 'user-price-type-checkbox';
      copCheckbox.setAttribute('data-user-id', userId);
      copCheckbox.setAttribute('data-tipo', 'COP');
      
      const copLabel = document.createElement('label');
      copLabel.setAttribute('for', `tipo_cop_${userId}`);
      copLabel.textContent = 'COP';
      copLabel.className = 'user-price-label';
      copLabel.style.setProperty('cursor', 'pointer');
      
      copContainer.appendChild(copCheckbox);
      copContainer.appendChild(copLabel);

      const soporteContainer = document.createElement('div');
      soporteContainer.className = 'user-prices-tipo-row';

      const soporteCheckbox = document.createElement('input');
      soporteCheckbox.type = 'checkbox';
      soporteCheckbox.id = `soporte_lic_${userId}`;
      soporteCheckbox.name = `soporte_licencias_${userId}`;
      soporteCheckbox.className = 'user-soporte-licencias-checkbox';
      soporteCheckbox.checked = !!userData.soporte_licencias;
      soporteCheckbox.setAttribute('data-user-id', userId);

      const soporteLabel = document.createElement('label');
      soporteLabel.setAttribute('for', `soporte_lic_${userId}`);
      soporteLabel.textContent = 'Soporte licencias';
      soporteLabel.className = 'user-price-label';
      soporteLabel.style.setProperty('cursor', 'pointer');

      soporteContainer.appendChild(soporteCheckbox);
      soporteContainer.appendChild(soporteLabel);

      const deudaContainer = document.createElement('div');
      deudaContainer.className = 'user-prices-tipo-row';

      const deudaCheckbox = document.createElement('input');
      deudaCheckbox.type = 'checkbox';
      deudaCheckbox.id = `puede_deuda_${userId}`;
      deudaCheckbox.name = `puede_deuda_${userId}`;
      deudaCheckbox.className = 'user-puede-deuda-checkbox';
      deudaCheckbox.checked = !!userData.puede_tener_deuda;
      deudaCheckbox.setAttribute('data-user-id', userId);

      const deudaLabel = document.createElement('label');
      deudaLabel.setAttribute('for', `puede_deuda_${userId}`);
      deudaLabel.textContent = 'Puede tener deuda';
      deudaLabel.className = 'user-price-label';
      deudaLabel.style.setProperty('cursor', 'pointer');

      deudaContainer.appendChild(deudaCheckbox);
      deudaContainer.appendChild(deudaLabel);

      const autoRecargaContainer = document.createElement('div');
      autoRecargaContainer.className = 'user-prices-tipo-row';

      const autoRecargaCheckbox = document.createElement('input');
      autoRecargaCheckbox.type = 'checkbox';
      autoRecargaCheckbox.id = `recarga_auto_${userId}`;
      autoRecargaCheckbox.name = `recarga_automatica_${userId}`;
      autoRecargaCheckbox.className = 'user-recarga-automatica-checkbox';
      autoRecargaCheckbox.checked = !!userData.recarga_automatica;
      autoRecargaCheckbox.setAttribute('data-user-id', userId);

      const autoRecargaLabel = document.createElement('label');
      autoRecargaLabel.setAttribute('for', `recarga_auto_${userId}`);
      autoRecargaLabel.textContent = 'Recarga en automático';
      autoRecargaLabel.className = 'user-price-label';
      autoRecargaLabel.style.setProperty('cursor', 'pointer');
      autoRecargaLabel.setAttribute(
        'title',
        'Al subir comprobante se acredita el saldo al instante; tú revisas después.'
      );

      autoRecargaContainer.appendChild(autoRecargaCheckbox);
      autoRecargaContainer.appendChild(autoRecargaLabel);

      tipoPrecioContainer.appendChild(usdContainer);
      tipoPrecioContainer.appendChild(copContainer);
      tipoPrecioContainer.appendChild(soporteContainer);
      tipoPrecioContainer.appendChild(deudaContainer);
      tipoPrecioContainer.appendChild(autoRecargaContainer);
      tdTipoPrecio.appendChild(tipoPrecioContainer);
      tr.appendChild(tdTipoPrecio);
      
      // Saldo (mostrar saldo actual arriba y botón Editar abajo) - Vertical
      const tdSaldo = document.createElement('td');
      tdSaldo.className = 'text-center';
      
      const saldoContainer = document.createElement('div');
      saldoContainer.className = 'd-flex flex-column align-items-center justify-content-center';
      saldoContainer.style.setProperty('gap', '0.5rem');
      
      // Determinar tipo de precio: solo de user_prices (ya no depende de roles)
      let tipoPrecioSaldo = null;
      if (userData.tipo_precio) {
        tipoPrecioSaldo = userData.tipo_precio.toLowerCase();
      }
      
      // Mostrar saldo solo si el usuario tiene tipo_precio configurado (tiene acceso a la tienda) - Arriba
      const saldoText = document.createElement('span');
      saldoText.className = 'user-saldo-principal';
      if (tipoPrecioSaldo) {
        // Usuario tiene tipo_precio configurado, mostrar saldo según tipo de precio
        if (tipoPrecioSaldo === 'usd') {
          saldoText.textContent = `${Math.floor(user.saldo_usd || 0)} USD`;
        } else if (tipoPrecioSaldo === 'cop') {
          saldoText.textContent = `${Math.floor(user.saldo_cop || 0)} COP`;
        } else {
          saldoText.textContent = '-';
        }
      } else {
        // Usuario no tiene tipo_precio configurado, no puede tener saldo
        saldoText.textContent = '-';
      }
      saldoContainer.appendChild(saldoText);
      if (tipoPrecioSaldo) {
        syncSaldoInactivoLine(saldoContainer, tipoPrecioSaldo, user.saldo_usd, user.saldo_cop);
      }
      
      const saldoActionsWrap = document.createElement('div');
      saldoActionsWrap.className = 'saldo-actions-wrap';

      const actionStack = document.createElement('div');
      actionStack.className = 'action-stack action-stack--balance';

      if (tipoPrecioSaldo) {
        const addBalBtn = document.createElement('button');
        addBalBtn.type = 'button';
        addBalBtn.id = `balance_add_${userId}`;
        addBalBtn.name = `balance_add_${userId}`;
        addBalBtn.className = 'action-btn action-btn-icon action-green-balance open-balance-modal';
        addBalBtn.setAttribute('title', 'Añadir saldo');
        addBalBtn.setAttribute('data-balance-mode', 'add');
        addBalBtn.setAttribute('data-username', user.username);
        addBalBtn.setAttribute('data-tipo-precio', tipoPrecioSaldo);
        addBalBtn.setAttribute('data-user-id', String(userId));
        addBalBtn.innerHTML = '<i class="fas fa-plus"></i>';

        const subBalBtn = document.createElement('button');
        subBalBtn.type = 'button';
        subBalBtn.id = `balance_sub_${userId}`;
        subBalBtn.name = `balance_sub_${userId}`;
        subBalBtn.className = 'action-btn action-btn-icon action-amber-balance open-balance-modal';
        subBalBtn.setAttribute('title', 'Descontar saldo');
        subBalBtn.setAttribute('data-balance-mode', 'subtract');
        subBalBtn.setAttribute('data-username', user.username);
        subBalBtn.setAttribute('data-tipo-precio', tipoPrecioSaldo);
        subBalBtn.setAttribute('data-user-id', String(userId));
        subBalBtn.innerHTML = '<i class="fas fa-minus"></i>';

        actionStack.appendChild(addBalBtn);
        actionStack.appendChild(subBalBtn);

        const debtLimitBtn = document.createElement('button');
        debtLimitBtn.type = 'button';
        debtLimitBtn.id = `debt_limit_btn_${userId}`;
        debtLimitBtn.name = `debt_limit_btn_${userId}`;
        debtLimitBtn.className = 'user-debt-limit-btn open-debt-limit-modal';
        debtLimitBtn.setAttribute('data-user-id', String(userId));
        debtLimitBtn.setAttribute('data-username', user.username);
        debtLimitBtn.setAttribute('data-tipo-precio', tipoPrecioSaldo);
        syncUserDebtLimitButton(debtLimitBtn, userId, userData, tipoPrecioSaldo);
        saldoActionsWrap.appendChild(actionStack);
        saldoActionsWrap.appendChild(debtLimitBtn);
      } else {
        saldoActionsWrap.appendChild(actionStack);
      }

      saldoContainer.appendChild(saldoActionsWrap);
      tdSaldo.appendChild(saldoContainer);
      tr.appendChild(tdSaldo);
      
      // Productos Asociados (botón Editar que dirige a editar productos del usuario)
      const tdProductosAsociados = document.createElement('td');
      tdProductosAsociados.className = 'text-center';
      
      // Mostrar botón si el usuario tiene tipo_precio configurado
      if (tipoPrecioSaldo) {
        const editProductsBtn = document.createElement('a');
        editProductsBtn.href = `/admin/users/${userId}/edit_products`;
        editProductsBtn.className = 'action-btn action-blue';
        editProductsBtn.textContent = 'Editar';
        tdProductosAsociados.appendChild(editProductsBtn);
      } else {
        tdProductosAsociados.textContent = '-';
      }
      
      tr.appendChild(tdProductosAsociados);
      
      userData.soporte_licencias = !!userData.soporte_licencias;
      userData.puede_tener_deuda = !!userData.puede_tener_deuda;
      userData.recarga_automatica = !!userData.recarga_automatica;
      userData.tipo_precio = userData.tipo_precio || null;
      if (userData.limite_deuda_usd == null && user.limite_deuda_usd != null) {
        userData.limite_deuda_usd = Number(user.limite_deuda_usd);
      }
      if (userData.limite_deuda_cop == null && user.limite_deuda_cop != null) {
        userData.limite_deuda_cop = Number(user.limite_deuda_cop);
      }
      // Guardar datos iniciales
      userPricesData[userId] = userData;
      
      fragment.appendChild(tr);
    });
    
    while (userPricesTableBody.firstChild) {
      userPricesTableBody.removeChild(userPricesTableBody.firstChild);
    }
    userPricesTableBody.appendChild(fragment);
    
    // Agregar event listeners para checkboxes mutuamente excluyentes
      document.querySelectorAll('.user-price-type-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', function() {
        const userId = this.getAttribute('data-user-id');
        const tipo = this.getAttribute('data-tipo');
        
        if (this.checked) {
          // Desmarcar el otro checkbox
          const otherCheckbox = document.querySelector(`input[name="tipo_precio_${userId}"][data-tipo="${tipo === 'USD' ? 'COP' : 'USD'}"]`);
          if (otherCheckbox) {
            otherCheckbox.checked = false;
          }
          
          // Actualizar datos
          if (!userPricesData[userId]) {
            const sl = document.getElementById(`soporte_lic_${userId}`);
            const pd = document.getElementById(`puede_deuda_${userId}`);
            const ra = document.getElementById(`recarga_auto_${userId}`);
            userPricesData[userId] = {
              tipo_precio: null,
              soporte_licencias: sl ? !!sl.checked : false,
              puede_tener_deuda: pd ? !!pd.checked : false,
              recarga_automatica: ra ? !!ra.checked : false
            };
          }
          userPricesData[userId].tipo_precio = tipo;
        } else {
          // Si se desmarca, establecer a null
          if (userPricesData[userId]) {
            userPricesData[userId].tipo_precio = null;
          }
        }
        const debtBtnTp = document.getElementById(`debt_limit_btn_${userId}`);
        const tpSync = userPricesData[userId] && userPricesData[userId].tipo_precio
          ? userPricesData[userId].tipo_precio.toLowerCase()
          : null;
        if (debtBtnTp) {
          if (tpSync) debtBtnTp.setAttribute('data-tipo-precio', tpSync);
          syncUserDebtLimitButton(debtBtnTp, userId, userPricesData[userId], tpSync);
        }
      });
    });

    document.querySelectorAll('.user-soporte-licencias-checkbox').forEach(cb => {
      cb.addEventListener('change', function() {
        const userId = this.getAttribute('data-user-id');
        if (!userPricesData[userId]) {
          const pd = document.getElementById(`puede_deuda_${userId}`);
          const ra = document.getElementById(`recarga_auto_${userId}`);
          userPricesData[userId] = {
            tipo_precio: null,
            soporte_licencias: !!this.checked,
            puede_tener_deuda: pd ? !!pd.checked : false,
            recarga_automatica: ra ? !!ra.checked : false
          };
        } else {
          userPricesData[userId].soporte_licencias = !!this.checked;
        }
      });
    });

    document.querySelectorAll('.user-puede-deuda-checkbox').forEach(cb => {
      cb.addEventListener('change', function() {
        const userId = this.getAttribute('data-user-id');
        if (!userPricesData[userId]) {
          const sl = document.getElementById(`soporte_lic_${userId}`);
          const ra = document.getElementById(`recarga_auto_${userId}`);
          userPricesData[userId] = {
            tipo_precio: null,
            soporte_licencias: sl ? !!sl.checked : false,
            puede_tener_deuda: !!this.checked,
            recarga_automatica: ra ? !!ra.checked : false,
            limite_deuda_usd: null,
            limite_deuda_cop: null
          };
        } else {
          userPricesData[userId].puede_tener_deuda = !!this.checked;
          if (!this.checked) {
            userPricesData[userId].limite_deuda_usd = null;
            userPricesData[userId].limite_deuda_cop = null;
          }
        }
        const debtBtn = document.getElementById(`debt_limit_btn_${userId}`);
        const usdCb = document.querySelector(
          `input[name="tipo_precio_${userId}"][data-tipo="USD"]`
        );
        const copCb = document.querySelector(
          `input[name="tipo_precio_${userId}"][data-tipo="COP"]`
        );
        let tp = null;
        if (usdCb && usdCb.checked) tp = 'usd';
        else if (copCb && copCb.checked) tp = 'cop';
        syncUserDebtLimitButton(debtBtn, userId, userPricesData[userId], tp);
      });
    });

    document.querySelectorAll('.user-recarga-automatica-checkbox').forEach(cb => {
      cb.addEventListener('change', function() {
        const userId = this.getAttribute('data-user-id');
        if (!userPricesData[userId]) {
          const sl = document.getElementById(`soporte_lic_${userId}`);
          const pd = document.getElementById(`puede_deuda_${userId}`);
          userPricesData[userId] = {
            tipo_precio: null,
            soporte_licencias: sl ? !!sl.checked : false,
            puede_tener_deuda: pd ? !!pd.checked : false,
            recarga_automatica: !!this.checked
          };
        } else {
          userPricesData[userId].recarga_automatica = !!this.checked;
        }
      });
    });
  }
  
  // Guardar cambios de precios
  if (saveUserPricesBtn) {
    saveUserPricesBtn.addEventListener('click', function() {
      if (!userPricesTableBody) return;
      
      const updates = [];
      
      // Recopilar todos los datos de la tabla
      Object.keys(userPricesData).forEach(userId => {
        const userData = userPricesData[userId];
        const upd = {
          user_id: parseInt(userId),
          tipo_precio: userData.tipo_precio || null,
          soporte_licencias: !!userData.soporte_licencias,
          puede_tener_deuda: !!userData.puede_tener_deuda,
          recarga_automatica: !!userData.recarga_automatica
        };
        if (userData.puede_tener_deuda) {
          upd.limite_deuda_usd = userData.limite_deuda_usd;
          upd.limite_deuda_cop = userData.limite_deuda_cop;
        }
        updates.push(upd);
      });
      
      if (updates.length === 0) {
        showUserPricesStatus('No hay cambios para guardar', 'text-warning');
        return;
      }
      
      // Deshabilitar botón mientras se guarda
      saveUserPricesBtn.disabled = true;
      saveUserPricesBtn.textContent = 'Guardando...';
      showUserPricesStatus('Guardando cambios...', 'text-info');
      
      fetch('/admin/update_user_prices_ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ updates: updates })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') {
          userPricesData = {};
          showUserPricesStatus(data.message || 'Cambios guardados correctamente', 'text-success');
          // Recargar datos después de guardar
          setTimeout(() => {
            loadUsersForPrices();
          }, 1000);
        } else {
          showUserPricesStatus(data.message || 'Error al guardar cambios', 'text-danger');
        }
      })
      .catch(err => {
        console.error('Error al guardar precios:', err);
        showUserPricesStatus('Error al guardar cambios', 'text-danger');
      })
      .finally(() => {
        saveUserPricesBtn.disabled = false;
        while (saveUserPricesBtn.firstChild) {
          saveUserPricesBtn.removeChild(saveUserPricesBtn.firstChild);
        }
        const icon = document.createElement('i');
        icon.className = 'fas fa-save';
        saveUserPricesBtn.appendChild(icon);
        saveUserPricesBtn.appendChild(document.createTextNode(' Guardar Cambios de Precios'));
      });
    });
  }
  
  function showUserPricesStatus(message, className) {
    if (saveUserPricesStatus) {
      saveUserPricesStatus.textContent = message;
      saveUserPricesStatus.className = className;
    }
  }
  
  // Búsqueda automática para precios por usuario
  if (searchUserPricesInput) {
    let searchUserPricesTimeout = null;
    
    // Función para mostrar/ocultar botón de limpiar
    function updateClearUserPricesButton() {
      if (clearUserPricesSearchBtn) {
        if (searchUserPricesInput.value.trim().length > 0) {
          clearUserPricesSearchBtn.classList.add('show');
        } else {
          clearUserPricesSearchBtn.classList.remove('show');
        }
      }
    }
    
    // Función para limpiar búsqueda
    function clearUserPricesSearch() {
      searchUserPricesInput.value = '';
      filterUsersForPrices();
      updateClearUserPricesButton();
    }
    
    // Event listener para búsqueda automática
    searchUserPricesInput.addEventListener('input', function() {
      updateClearUserPricesButton();
      clearTimeout(searchUserPricesTimeout);
      searchUserPricesTimeout = setTimeout(() => {
        filterUsersForPrices();
      }, 200);
    });
    
    // Click en el botón X para limpiar
    if (clearUserPricesSearchBtn) {
      clearUserPricesSearchBtn.addEventListener('click', function(e) {
        e.preventDefault();
        clearUserPricesSearch();
      });
    }
    
    // Inicializar estado del botón
    updateClearUserPricesButton();
  }
  
  // Inicializar tabla de precios por usuario
  if (userPricesTableBody) {
    loadUsersForPrices();
  }
  
  // Modal para añadir saldo
  const balanceModalOverlay = document.getElementById('balance-modal-overlay');
  const balanceModal = balanceModalOverlay ? balanceModalOverlay.querySelector('.modal-balance-content') : null;
  const modalUsernameInput = document.getElementById('modal-username');
  const modalBalanceUsdInput = document.getElementById('modal-balance-usd');
  const modalBalanceCopInput = document.getElementById('modal-balance-cop');
  const modalGroupUsd = document.getElementById('modal-group-usd');
  const modalGroupCop = document.getElementById('modal-group-cop');
  const modalBalanceForm = document.getElementById('modal-balance-form');
  const closeBalanceModalBtns = document.querySelectorAll('.close-balance-modal');
  const balanceModalTitle = document.getElementById('balance-modal-title');
  const balanceModalCurrentEl = document.getElementById('balance-modal-current');
  const modalBalanceSubmitBtn = document.getElementById('modal-balance-submit');
  let currentBalanceModalMode = 'add';

  function balanceModalCurrencySuffix(tipoPrecio) {
    const t = (tipoPrecio || '').toLowerCase();
    if (t === 'usd') return ' USD';
    if (t === 'cop') return ' COP';
    return '';
  }

  function setBalanceModalUi(mode, ctx) {
    currentBalanceModalMode = mode === 'subtract' ? 'subtract' : 'add';
    const isSub = currentBalanceModalMode === 'subtract';
    const tp = ctx && ctx.tipoPrecio
      ? String(ctx.tipoPrecio).toLowerCase()
      : null;
    const suf = balanceModalCurrencySuffix(tp);
    if (balanceModalTitle) {
      balanceModalTitle.textContent = isSub
        ? (suf ? `Descontar saldo${suf}` : 'Descontar saldo')
        : (suf ? `Añadir saldo${suf}` : 'Añadir saldo');
    }
    if (modalBalanceSubmitBtn) {
      modalBalanceSubmitBtn.textContent = isSub ? 'Descontar saldo' : 'Añadir saldo';
    }
    if (balanceModalCurrentEl) {
      const c = ctx || {};
      if (tp === 'usd') {
        balanceModalCurrentEl.textContent = `Saldo actual: ${Math.floor(Number(c.saldoUsd) || 0)} USD`;
      } else if (tp === 'cop') {
        balanceModalCurrentEl.textContent = `Saldo actual: ${Math.floor(Number(c.saldoCop) || 0)} COP`;
      } else {
        balanceModalCurrentEl.textContent = '';
      }
    }
    if (modalBalanceUsdInput) {
      modalBalanceUsdInput.removeAttribute('max');
      modalBalanceUsdInput.placeholder = isSub
        ? 'Monto a descontar (puede quedar en negativo)'
        : 'Monto (negativo = deuda)';
    }
    if (modalBalanceCopInput) {
      modalBalanceCopInput.removeAttribute('max');
      modalBalanceCopInput.placeholder = isSub
        ? 'Monto a descontar (puede quedar en negativo)'
        : 'Monto (negativo = deuda)';
    }
  }

  // Abrir modal al hacer clic en + / −
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.open-balance-modal');
    if (!btn) return;
    e.preventDefault();
    const username = btn.getAttribute('data-username');
    const tipoPrecio = btn.getAttribute('data-tipo-precio');
    const mode = btn.getAttribute('data-balance-mode') || 'add';
    const uid = btn.getAttribute('data-user-id');
    const userRow = uid != null ? allUsersForPrices.find(u => String(u.id) === String(uid)) : null;

    if (balanceModalOverlay && balanceModal && modalUsernameInput) {
      balanceModalOverlay.classList.remove('d-none');
      modalUsernameInput.value = username;
      if (modalBalanceUsdInput) modalBalanceUsdInput.value = '';
      if (modalBalanceCopInput) modalBalanceCopInput.value = '';
      setBalanceModalUi(mode, userRow ? {
        tipoPrecio,
        saldoUsd: userRow.saldo_usd,
        saldoCop: userRow.saldo_cop
      } : { tipoPrecio });

      // Mostrar/ocultar campos según tipo de precio
      if (tipoPrecio === 'usd') {
        if (modalGroupUsd) modalGroupUsd.classList.remove('d-none');
        if (modalGroupCop) modalGroupCop.classList.add('d-none');
      } else if (tipoPrecio === 'cop') {
        if (modalGroupUsd) modalGroupUsd.classList.add('d-none');
        if (modalGroupCop) modalGroupCop.classList.remove('d-none');
      } else {
        if (modalGroupUsd) modalGroupUsd.classList.remove('d-none');
        if (modalGroupCop) modalGroupCop.classList.remove('d-none');
      }
    }
  });
  
  // Cerrar modal
  function closeBalanceModal() {
    if (balanceModalOverlay) {
      balanceModalOverlay.classList.add('d-none');
    }
  }
  
  closeBalanceModalBtns.forEach(btn => {
    btn.addEventListener('click', closeBalanceModal);
  });
  
  if (balanceModalOverlay) {
    balanceModalOverlay.addEventListener('click', function(e) {
      if (e.target === balanceModalOverlay) {
        closeBalanceModal();
      }
    });
  }
  
  // Enviar formulario de añadir saldo
  if (modalBalanceForm) {
    modalBalanceForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const username = modalUsernameInput ? modalUsernameInput.value.trim() : '';
      const user = allUsersForPrices.find(u => u.username === username);
      let amountUsd = modalBalanceUsdInput ? modalBalanceUsdInput.value.trim() : '';
      let amountCop = modalBalanceCopInput ? modalBalanceCopInput.value.trim() : '';
      
      if (user) {
        const tipoPrecio = (userPricesData[user.id]?.tipo_precio ? userPricesData[user.id].tipo_precio.toLowerCase() : null);
        if (tipoPrecio === 'usd') {
          amountCop = '';
        } else if (tipoPrecio === 'cop') {
          amountUsd = '';
        }
      }
      
      const parsedUsd = amountUsd !== '' ? Number(String(amountUsd).replace(',', '.')) : 0;
      const parsedCop = amountCop !== '' ? Number(String(amountCop).replace(',', '.')) : 0;
      if (!user || (amountUsd === '' && amountCop === '') || (!Number.isFinite(parsedUsd) || !Number.isFinite(parsedCop))) {
        alert('Debes seleccionar un usuario y un monto numérico válido.');
        return;
      }
      if (parsedUsd === 0 && parsedCop === 0) {
        alert('El monto no puede ser cero.');
        return;
      }

      const subtract = currentBalanceModalMode === 'subtract';
      if (subtract && parsedUsd <= 0 && parsedCop <= 0) {
        alert('Al descontar, indica un monto mayor que cero.');
        return;
      }

      const balanceReq = fetch('/tienda/admin/pagos/add_balance', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken(),
        },
        body: JSON.stringify({
          username: user.username,
          amount_usd: subtract ? Math.abs(parsedUsd) : parsedUsd,
          amount_cop: subtract ? Math.abs(parsedCop) : parsedCop,
          subtract: subtract,
        }),
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            const err = new Error((data && (data.message || data.error)) || 'Error HTTP ' + res.status);
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      });

      balanceReq
      .then(data => {
        if (data.success) {
          const userRow = userPricesTableBody.querySelector(`tr[data-user-id="${user.id}"]`);
          if (userRow) {
            const saldoCell = userRow.children[2];
            const saldoWrap = saldoCell && saldoCell.firstElementChild;
            const tipoPrecio = (userPricesData[user.id]?.tipo_precio ? userPricesData[user.id].tipo_precio.toLowerCase() : null);
            const main = saldoWrap && saldoWrap.querySelector('.user-saldo-principal');
            if (main) {
              if (tipoPrecio === 'usd') {
                main.textContent = `${parseInt(data.new_saldo_usd, 10)} USD`;
              } else if (tipoPrecio === 'cop') {
                main.textContent = `${parseInt(data.new_saldo_cop, 10)} COP`;
              } else {
                main.textContent = '-';
              }
            }
            if (saldoWrap && tipoPrecio) {
              syncSaldoInactivoLine(saldoWrap, tipoPrecio, data.new_saldo_usd, data.new_saldo_cop);
            }
            // Actualizar también en allUsersForPrices
            const userIndex = allUsersForPrices.findIndex(u => u.id === user.id);
            if (userIndex !== -1) {
              allUsersForPrices[userIndex].saldo_usd = data.new_saldo_usd;
              allUsersForPrices[userIndex].saldo_cop = data.new_saldo_cop;
            }
          }
          modalBalanceForm.reset();
          closeBalanceModal();
        } else {
          alert(data.error || (subtract ? 'Error al descontar saldo' : 'Error al añadir saldo'));
        }
      })
      .catch(() => alert('Error de red o servidor.'));
    });
  }

  // Modal límite de deuda
  const debtLimitModalOverlay = document.getElementById('debt-limit-modal-overlay');
  const modalDebtLimitForm = document.getElementById('modal-debt-limit-form');
  const modalDebtLimitUserId = document.getElementById('modal-debt-limit-user-id');
  const modalDebtLimitCurrency = document.getElementById('modal-debt-limit-currency');
  const modalDebtLimitAmount = document.getElementById('modal-debt-limit-amount');
  const debtLimitModalUserEl = document.getElementById('debt-limit-modal-user');
  const debtLimitModalLabel = document.getElementById('modal-debt-limit-label');
  const closeDebtLimitModalBtns = document.querySelectorAll('.close-debt-limit-modal');

  function closeDebtLimitModal() {
    if (debtLimitModalOverlay) debtLimitModalOverlay.classList.add('d-none');
  }

  closeDebtLimitModalBtns.forEach(function (btn) {
    btn.addEventListener('click', closeDebtLimitModal);
  });

  if (debtLimitModalOverlay) {
    debtLimitModalOverlay.addEventListener('click', function (e) {
      if (e.target === debtLimitModalOverlay) closeDebtLimitModal();
    });
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.open-debt-limit-modal');
    if (!btn || btn.disabled) return;
    const userId = btn.getAttribute('data-user-id');
    const tp = (btn.getAttribute('data-tipo-precio') || '').toLowerCase();
    const username = btn.getAttribute('data-username') || '';
    if (!userId || (tp !== 'usd' && tp !== 'cop')) return;
    const ud = userPricesData[userId] || {};
    if (!ud.puede_tener_deuda) return;

    if (modalDebtLimitUserId) modalDebtLimitUserId.value = userId;
    if (modalDebtLimitCurrency) modalDebtLimitCurrency.value = tp.toUpperCase();
    if (debtLimitModalUserEl) {
      debtLimitModalUserEl.textContent = username ? `Usuario: ${username}` : '';
    }
    const curLabel = tp.toUpperCase();
    if (debtLimitModalLabel) {
      debtLimitModalLabel.textContent = `Monto máximo de deuda (${curLabel})`;
    }
    if (modalDebtLimitAmount) {
      modalDebtLimitAmount.step = tp === 'usd' ? '0.01' : '1';
      const lim = debtLimitForUserData(ud, tp);
      modalDebtLimitAmount.value = lim != null ? String(Math.floor(lim)) : '';
    }
    if (debtLimitModalOverlay) debtLimitModalOverlay.classList.remove('d-none');
  });

  if (modalDebtLimitForm) {
    modalDebtLimitForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const userId = modalDebtLimitUserId ? modalDebtLimitUserId.value : '';
      const currency = modalDebtLimitCurrency ? modalDebtLimitCurrency.value : '';
      const raw = modalDebtLimitAmount ? modalDebtLimitAmount.value.trim() : '';
      if (!userId || !currency) return;

      const payload = {
        user_id: parseInt(userId, 10),
        currency: currency,
        limite_deuda: raw === '' ? null : raw
      };

      fetch('/admin/update_user_debt_limit_ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (data.status !== 'ok') {
            alert(data.message || 'No se pudo guardar el límite.');
            return;
          }
          if (!userPricesData[userId]) {
            userPricesData[userId] = { puede_tener_deuda: true };
          }
          userPricesData[userId].limite_deuda_usd =
            data.limite_deuda_usd != null ? Number(data.limite_deuda_usd) : null;
          userPricesData[userId].limite_deuda_cop =
            data.limite_deuda_cop != null ? Number(data.limite_deuda_cop) : null;

          const uRow = allUsersForPrices.find(function (u) {
            return String(u.id) === String(userId);
          });
          if (uRow) {
            uRow.limite_deuda_usd = userPricesData[userId].limite_deuda_usd;
            uRow.limite_deuda_cop = userPricesData[userId].limite_deuda_cop;
          }

          const debtBtn = document.getElementById(`debt_limit_btn_${userId}`);
          const tp = currency.toLowerCase();
          syncUserDebtLimitButton(debtBtn, userId, userPricesData[userId], tp);
          closeDebtLimitModal();
          showUserPricesStatus('Límite de deuda guardado', 'text-success');
        })
        .catch(function () {
          alert('Error de red o servidor.');
        });
    });
  }

  /** SSE admin: actualiza columnas de saldo sin recargar la página (p. ej. recarga acreditada en otra pestaña). */
  (function bindAdminBalanceRealtime() {
    if (!userPricesTableBody || typeof window.BalanceRechargeRealtime === 'undefined') {
      return;
    }

    var ADMIN_EVENTS_URL = '/tienda/api/admin/balance-recharges/events';
    var adminBalanceRealtimeConn = null;

    function patchUserPricesSaldoRow(user) {
      if (!user || user.id == null) return;
      var row = userPricesTableBody.querySelector('tr[data-user-id="' + user.id + '"]');
      if (!row || !row.children[2]) return;
      var saldoWrap = row.children[2].firstElementChild;
      var tipoPrecio = userPricesData[user.id] && userPricesData[user.id].tipo_precio
        ? String(userPricesData[user.id].tipo_precio).toLowerCase()
        : (user.tipo_precio ? String(user.tipo_precio).toLowerCase() : null);
      var main = saldoWrap && saldoWrap.querySelector('.user-saldo-principal');
      if (main) {
        if (tipoPrecio === 'usd') {
          main.textContent = Math.floor(Number(user.saldo_usd) || 0) + ' USD';
        } else if (tipoPrecio === 'cop') {
          main.textContent = Math.floor(Number(user.saldo_cop) || 0) + ' COP';
        } else {
          main.textContent = '-';
        }
      }
      if (saldoWrap && tipoPrecio) {
        syncSaldoInactivoLine(saldoWrap, tipoPrecio, user.saldo_usd, user.saldo_cop);
      }
    }

    function refreshUserPricesSaldos(eventData) {
      var uid =
        eventData && eventData.user_id != null ? Number(eventData.user_id) : NaN;
      if (Number.isFinite(uid)) {
        var singleUrl = '/tienda/api/admin/users/' + uid + '/store-prepaid-saldo';
        permFetchJson(singleUrl)
          .then(function (data) {
            if (!data || !data.success) return;
            var idx = allUsersForPrices.findIndex(function (u) {
              return u && String(u.id) === String(uid);
            });
            if (idx < 0) return;
            allUsersForPrices[idx].saldo_usd = data.saldo_usd;
            allUsersForPrices[idx].saldo_cop = data.saldo_cop;
            if (data.tipo_precio && !userPricesData[uid]) {
              userPricesData[uid] = { tipo_precio: data.tipo_precio };
            }
            patchUserPricesSaldoRow(allUsersForPrices[idx]);
          })
          .catch(function () {
            refreshUserPricesSaldosAll();
          });
        return;
      }
      refreshUserPricesSaldosAll();
    }

    function refreshUserPricesSaldosAll() {
      permFetchJson('/admin/search_users_ajax?query=')
        .then(function (data) {
          if (!data || data.status !== 'ok' || !Array.isArray(data.users)) return;
          var byId = {};
          data.users.forEach(function (u) {
            if (u && u.id != null) byId[u.id] = u;
          });
          allUsersForPrices.forEach(function (u, idx) {
            var fresh = byId[u.id];
            if (!fresh) return;
            allUsersForPrices[idx].saldo_usd = fresh.saldo_usd;
            allUsersForPrices[idx].saldo_cop = fresh.saldo_cop;
            patchUserPricesSaldoRow(allUsersForPrices[idx]);
          });
        })
        .catch(function () {});
    }

    function onAdminBalanceRealtime(eventData) {
      refreshUserPricesSaldos(eventData);
    }

    function connectAdminBalanceStream() {
      if (adminBalanceRealtimeConn) return;
      adminBalanceRealtimeConn = window.BalanceRechargeRealtime.connect(
        ADMIN_EVENTS_URL,
        onAdminBalanceRealtime
      );
    }

    function disconnectAdminBalanceStream() {
      if (!adminBalanceRealtimeConn) return;
      adminBalanceRealtimeConn.close();
      adminBalanceRealtimeConn = null;
    }

    connectAdminBalanceStream();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        connectAdminBalanceStream();
        refreshUserPricesSaldosAll();
      } else {
        disconnectAdminBalanceStream();
      }
    });
    window.addEventListener('focus', refreshUserPricesSaldosAll);
  })();
});
