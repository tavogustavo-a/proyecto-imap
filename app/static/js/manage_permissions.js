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
  
  // ============ Gestión de Precios por Usuario ============
  const userPricesTableBody = document.getElementById("userPricesTableBody");
  const saveUserPricesBtn = document.getElementById("saveUserPricesBtn");
  const saveUserPricesStatus = document.getElementById("saveUserPricesStatus");
  const searchUserPricesInput = document.getElementById("searchUserPricesInput");
  const clearUserPricesSearchBtn = document.getElementById("clearUserPricesSearchBtn");
  
  let userPricesData = {}; // { userId: { tipo_precio: 'USD'|'COP'|null } }
  let allUsersForPrices = []; // Todos los usuarios cargados
  let filteredUsersForPrices = []; // Usuarios filtrados por búsqueda
  
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
        tipo_precio: user.tipo_precio || null
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
      tipoPrecioContainer.className = 'd-flex flex-column align-items-center justify-content-center';
      tipoPrecioContainer.style.setProperty('gap', '0.25rem');
      
      // Contenedor para USD (checkbox + label juntos sin espacio) - Arriba
      const usdContainer = document.createElement('div');
      usdContainer.className = 'd-flex align-items-center';
      
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
      usdLabel.style.setProperty('margin-left', '0.25rem');
      usdLabel.style.setProperty('margin-bottom', '0');
      usdLabel.style.setProperty('cursor', 'pointer');
      
      usdContainer.appendChild(usdCheckbox);
      usdContainer.appendChild(usdLabel);
      
      // Contenedor para COP (checkbox + label juntos sin espacio) - Abajo
      const copContainer = document.createElement('div');
      copContainer.className = 'd-flex align-items-center';
      
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
      copLabel.style.setProperty('margin-left', '0.25rem');
      copLabel.style.setProperty('margin-bottom', '0');
      copLabel.style.setProperty('cursor', 'pointer');
      
      copContainer.appendChild(copCheckbox);
      copContainer.appendChild(copLabel);
      
      tipoPrecioContainer.appendChild(usdContainer);
      tipoPrecioContainer.appendChild(copContainer);
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
      
      // Botón Editar (solo si el usuario tiene tipo_precio configurado) - Abajo
      const actionStack = document.createElement('div');
      actionStack.className = 'action-stack';
      
      if (tipoPrecioSaldo) {
        const editBtn = document.createElement('a');
        editBtn.href = '#';
        editBtn.className = 'action-btn action-blue open-balance-modal';
        editBtn.textContent = 'Editar';
        editBtn.setAttribute('data-username', user.username);
        editBtn.setAttribute('data-tipo-precio', tipoPrecioSaldo);
        editBtn.setAttribute('data-user-id', userId);
        
        actionStack.appendChild(editBtn);
      }
      
      saldoContainer.appendChild(actionStack);
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
            userPricesData[userId] = {
              tipo_precio: null
            };
          }
          userPricesData[userId].tipo_precio = tipo;
        } else {
          // Si se desmarca, establecer a null
          if (userPricesData[userId]) {
            userPricesData[userId].tipo_precio = null;
          }
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
        updates.push({
          user_id: parseInt(userId),
          tipo_precio: userData.tipo_precio || null
        });
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
  
  // Abrir modal al hacer clic en botón Editar
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('open-balance-modal')) {
      e.preventDefault();
      const btn = e.target;
      const username = btn.getAttribute('data-username');
      const tipoPrecio = btn.getAttribute('data-tipo-precio');
      
      if (balanceModalOverlay && balanceModal && modalUsernameInput) {
        balanceModalOverlay.classList.remove('d-none');
        modalUsernameInput.value = username;
        if (modalBalanceUsdInput) modalBalanceUsdInput.value = '';
        if (modalBalanceCopInput) modalBalanceCopInput.value = '';
        
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
      
      if (!user || (!amountUsd && !amountCop)) {
        alert('Debes seleccionar un usuario y al menos un monto.');
        return;
      }
      
      fetch('/tienda/admin/pagos/add_balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ username: user.username, amount_usd: amountUsd, amount_cop: amountCop })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const userRow = userPricesTableBody.querySelector(`tr[data-user-id="${user.id}"]`);
          if (userRow) {
            const saldoCell = userRow.children[2];
            const saldoText = saldoCell.querySelector('span');
            const tipoPrecio = (userPricesData[user.id]?.tipo_precio ? userPricesData[user.id].tipo_precio.toLowerCase() : null);
            if (saldoText) {
              if (tipoPrecio === 'usd') {
                saldoText.textContent = `${parseInt(data.new_saldo_usd)} USD`;
              } else if (tipoPrecio === 'cop') {
                saldoText.textContent = `${parseInt(data.new_saldo_cop)} COP`;
              } else {
                saldoText.textContent = '-';
              }
            }
            // Actualizar también en allUsersForPrices
            const userIndex = allUsersForPrices.findIndex(u => u.id === user.id);
            if (userIndex !== -1) {
              allUsersForPrices[userIndex].saldo_usd = data.new_saldo_usd;
              allUsersForPrices[userIndex].saldo_cop = data.new_saldo_cop;
            }
          }
          alert('Saldo añadido correctamente');
          modalBalanceForm.reset();
          closeBalanceModal();
        } else {
          alert(data.error || 'Error al añadir saldo');
        }
      })
      .catch(() => alert('Error de red o servidor.'));
    });
  }
});
