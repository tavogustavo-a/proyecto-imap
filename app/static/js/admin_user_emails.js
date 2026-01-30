document.addEventListener("DOMContentLoaded", function() {
  // --- Elemento Contenedor Principal (para obtener data-user-id) ---
  // Asumimos que el div principal tiene un id="user-management-container"
  // Este ID deberá añadirse en el HTML.
  const mainContainer = document.getElementById("user-management-container");

  // --- Variables inicializadas ---
  const userId = mainContainer ? mainContainer.dataset.userId : null;

  // Salir si no se encuentra el contenedor principal o el userId
  if (!mainContainer || !userId) {
    console.error("Error: No se encontró el contenedor principal (#user-management-container) o el data-user-id.");
    return;
  }

  // --- Funciones Auxiliares ---
  function getCsrfToken(){
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  }

  function handleFetchResponse(response) {
    if (!response.ok) {
      return response.json()
        .then(errData => { 
          throw new Error(errData.message || `Error del servidor: ${response.status}`); 
        })
        .catch(() => {
           throw new Error(`Error del servidor: ${response.status}`);
        });
    }
    return response.json();
  }

  // --- Lógica Principal --- 
  // (Aquí va todo el código JS que estaba en email.html,
  //  asegurándose de usar la variable 'userId' definida arriba)

  // ======= PAGINACIÓN CORREOS PERMITIDOS =======
  const allowedEmailsTextContainer = document.getElementById("allowedEmailsTextContainer");
  const paginationInfo = document.getElementById("paginationInfo");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const perPageSelect = document.getElementById("perPageSelect");
  const deleteAllEmailsBtn = document.getElementById("deleteAllEmailsBtn");
  

  
  let currentPage = 1;
  let currentPerPage = 10;
  if (perPageSelect) perPageSelect.value = currentPerPage;

  function fetchAllowedEmails(page = 1, perPage = 10) {
    currentPage = page;
    currentPerPage = parseInt(perPage, 10) || 10;
    if (currentPerPage === -1) {
        perPage = 999999;
    } else {
         perPage = currentPerPage;
    }
    const url = `/admin/list_allowed_emails_paginated?user_id=${userId}&page=${page}&per_page=${perPage}`;
    
    if (allowedEmailsTextContainer) {
      // Limpiar contenedor
      while(allowedEmailsTextContainer.firstChild) {
        allowedEmailsTextContainer.removeChild(allowedEmailsTextContainer.firstChild);
      }
      const loadingP = document.createElement('p');
      loadingP.textContent = 'Cargando...';
      allowedEmailsTextContainer.appendChild(loadingP);
    }
    
    fetch(url, {
      method: "GET",
      headers: { "X-CSRFToken": getCsrfToken() }
    })
    .then(handleFetchResponse)
    .then(data => {
      if (data.status === "ok") {
        if (allowedEmailsTextContainer) renderAllowedEmailsText(data.emails);
        if (paginationInfo) updatePaginationControls(data.pagination);
      } else {
        if (allowedEmailsTextContainer) {
          const errorP = document.createElement('p');
          errorP.classList.add('error-message-text');
          errorP.textContent = `Error: ${data.message || 'No se pudieron cargar los correos.'}`;
          allowedEmailsTextContainer.innerHTML = '';
          allowedEmailsTextContainer.appendChild(errorP);
        }
      }
    })
    .catch(err => {
      console.error("Fetch error list emails:", err);
      if (allowedEmailsTextContainer) {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error al cargar correos: ${err.message}`;
        allowedEmailsTextContainer.innerHTML = '';
        allowedEmailsTextContainer.appendChild(errorP);
      }
    });
  }

  function renderAllowedEmailsText(emails) {
    if (!allowedEmailsTextContainer) return;
    if (!emails || emails.length === 0) {
      allowedEmailsTextContainer.textContent = "No hay correos permitidos asignados.";
      return;
    }
    allowedEmailsTextContainer.textContent = emails.join('\n'); 
  }

  function updatePaginationControls(pagination) {
    if (!pagination) return;

    if(paginationInfo) paginationInfo.textContent = `Página ${pagination.page} de ${pagination.total_pages}.`;

    if (prevPageBtn) prevPageBtn.disabled = !pagination.has_prev;
    if (nextPageBtn) nextPageBtn.disabled = !pagination.has_next;
    
    if (deleteAllEmailsBtn) {
        const totalItems = pagination.total_items || 0;
        if (totalItems > 0) {
            deleteAllEmailsBtn.textContent = `Eliminar Todos (${totalItems})`;
            deleteAllEmailsBtn.disabled = false;
            deleteAllEmailsBtn.classList.add('btn-inline-block');
        } else {
            deleteAllEmailsBtn.textContent = 'Eliminar Todos';
            deleteAllEmailsBtn.disabled = true;
        }
    }
    
    if (perPageSelect) {
       if (pagination.per_page >= 999999) {
           perPageSelect.value = "-1";
       } else {
           perPageSelect.value = pagination.per_page;
       }
    }
  }

  if(prevPageBtn) {
      prevPageBtn.addEventListener("click", () => {
          if (currentPage > 1) fetchAllowedEmails(currentPage - 1, currentPerPage);
      });
  }
  if(nextPageBtn) {
      nextPageBtn.addEventListener("click", () => {
          fetchAllowedEmails(currentPage + 1, currentPerPage);
      });
  }
  if(perPageSelect) {
      perPageSelect.addEventListener("change", () => {
          const newPerPage = parseInt(perPageSelect.value, 10);
          fetchAllowedEmails(1, newPerPage);
      });
  }

  if(deleteAllEmailsBtn) {
      deleteAllEmailsBtn.addEventListener("click", () => {
          if (!confirm("¿Seguro que quieres eliminar TODOS los correos permitidos para este usuario? Esta acción no se puede deshacer.")) {
              return;
          }
          
          fetch("/admin/delete_all_allowed_emails_ajax", {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
                  "X-CSRFToken": getCsrfToken()
              },
              body: JSON.stringify({ user_id: parseInt(userId, 10) })
          })
          .then(handleFetchResponse)
          .then(data => {
              if(data.status === "ok"){
                  alert(`${data.deleted_count_parent || 0} correos eliminados.`);
                  fetchAllowedEmails(1, currentPerPage);
              } else {
                  alert(`Error al eliminar todos: ${data.message || 'Error desconocido'}`);
              }
          })
          .catch(err => {
              console.error("Fetch error delete all:", err);
              alert(`Error de red al eliminar todos: ${err.message}`);
          });
      });
  }

  if(allowedEmailsTextContainer) fetchAllowedEmails(currentPage, currentPerPage);
  // ======= FIN PAGINACIÓN CORREOS PERMITIDOS =======

  // ======= BÚSQUEDA Y ELIMINACIÓN DE CORREOS =======
  const searchEmailsForm = document.getElementById("searchEmailsForm");
  const searchEmailsInput = document.getElementById("searchEmailsInput");
  const emailsSearchResults = document.getElementById("emailsSearchResults");
  const searchStatusDiv = document.getElementById('searchStatus');
  const deleteDisplayedBtn = document.getElementById('deleteDisplayedBtn');

  let currentlyDisplayedEmails = [];

  if(searchEmailsForm && searchEmailsInput && emailsSearchResults && deleteDisplayedBtn){
    // Cambiar el botón Limpiar para solo limpiar el campo
    const limpiarBtn = searchEmailsForm.querySelector('button[type="submit"]');
    if (limpiarBtn) {
      limpiarBtn.type = 'button';
      limpiarBtn.addEventListener('click', function(e) {
        searchEmailsInput.value = '';
        searchEmailsInput.dispatchEvent(new Event('input'));
      });
    }
    // Búsqueda automática sigue funcionando con input
    searchEmailsForm.addEventListener("submit", function(e){
      e.preventDefault();
      const searchText = searchEmailsInput.value.trim();
       if (!searchText) {
           renderEmailsResults([]);
           return;
       }

      fetch("/admin/search_allowed_emails_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ user_id: parseInt(userId, 10), search_text: searchText })
      })
      .then(handleFetchResponse)
      .then(data => {
        if(data.status === "ok"){
          currentlyDisplayedEmails = data.emails || [];
          renderEmailsResults(currentlyDisplayedEmails);
        } else {
          const errorP = document.createElement('p');
          errorP.classList.add('error-message-text');
          errorP.textContent = `Error: ${data.message || 'Respuesta inválida'}`;
          emailsSearchResults.innerHTML = '';
          emailsSearchResults.appendChild(errorP);
           if(searchStatusDiv) searchStatusDiv.textContent = '';
           if(deleteDisplayedBtn) {
             deleteDisplayedBtn.classList.remove('btn-inline-block');
             deleteDisplayedBtn.classList.add('hide-element');
           }
        }
      })
      .catch(err => {
        console.error("Fetch error search:", err);
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error al buscar: ${err.message}`;
        emailsSearchResults.innerHTML = '';
        emailsSearchResults.appendChild(errorP);
        if(searchStatusDiv) searchStatusDiv.textContent = '';
        if(deleteDisplayedBtn) {
          deleteDisplayedBtn.classList.remove('btn-inline-block');
          deleteDisplayedBtn.classList.add('hide-element');
        }
      });
    });
  }

  function renderEmailsResults(emails) {
    if (!emailsSearchResults) return;
    emailsSearchResults.innerHTML = '';
    if (!emails || emails.length === 0) {
        emailsSearchResults.classList.remove('show-block');
        emailsSearchResults.classList.add('hide-element');
        if(deleteDisplayedBtn) {
          deleteDisplayedBtn.classList.remove('btn-inline-block');
          deleteDisplayedBtn.classList.add('hide-element');
        }
        return;
    }

    emailsSearchResults.classList.remove('hide-element');
    emailsSearchResults.classList.add('show-block');
    emails.forEach(email => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('search-result-item');
        
        const span = document.createElement('span');
        span.textContent = escapeHtml(email);
        itemDiv.appendChild(span);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-search-result-btn';
        deleteBtn.setAttribute('data-email', escapeHtml(email));
        deleteBtn.title = 'Eliminar este correo';
        deleteBtn.textContent = 'X';
        itemDiv.appendChild(deleteBtn);
        
        emailsSearchResults.appendChild(itemDiv);
    });

    if(deleteDisplayedBtn) {
        deleteDisplayedBtn.textContent = `Eliminar ${emails.length} Mostrados`;
        deleteDisplayedBtn.classList.remove('hide-element');
        deleteDisplayedBtn.classList.add('btn-inline-block');
        deleteDisplayedBtn.disabled = false;
    }
  }

  if(emailsSearchResults){
    emailsSearchResults.addEventListener("click", function(e){
      if(e.target.classList.contains("delete-search-result-btn")){
        e.preventDefault();
        const button = e.target;
        const emailToRemove = button.getAttribute("data-email");
        if(!emailToRemove || !confirm(`¿Eliminar ${emailToRemove}?`)) { return; }

        button.disabled = true;
        button.textContent = '...';

        fetch("/admin/delete_allowed_email_ajax", {
          method: "POST",
          headers: {"Content-Type": "application/json", "X-CSRFToken": getCsrfToken()},
          body: JSON.stringify({ user_id: parseInt(userId, 10), email: emailToRemove })
        })
        .then(handleFetchResponse)
        .then(data => {
          if(data.status === "ok"){
            button.closest('.search-result-item').remove();
            currentlyDisplayedEmails = currentlyDisplayedEmails.filter(email => email !== emailToRemove);
            if (currentlyDisplayedEmails.length > 0) {
                 if(deleteDisplayedBtn) deleteDisplayedBtn.textContent = `Eliminar ${currentlyDisplayedEmails.length} Mostrados`;
                 if(deleteDisplayedBtn) {
                   deleteDisplayedBtn.classList.remove('hide-element');
                   deleteDisplayedBtn.classList.add('btn-inline-block');
                 }
            } else {
                 emailsSearchResults.classList.remove('show-block');
                 emailsSearchResults.classList.add('hide-element');
                 if(deleteDisplayedBtn) {
                   deleteDisplayedBtn.classList.remove('btn-inline-block');
                   deleteDisplayedBtn.classList.add('hide-element');
                 }
            }
            fetchAllowedEmails(currentPage, currentPerPage);
          } else {
            alert(`Error: ${data.message || 'Error desconocido'}`);
            button.disabled = false;
          }
        })
        .catch(err => {
          alert(`Error de red: ${err.message}`);
          button.disabled = false;
        });
      }
    });
  }

  if (deleteDisplayedBtn) {
      deleteDisplayedBtn.addEventListener('click', function(e){
         e.preventDefault();
         const emailsToDelete = currentlyDisplayedEmails;

         if (!emailsToDelete || emailsToDelete.length === 0) { return; }
         if(!confirm(`¿Eliminar los ${emailsToDelete.length} correos mostrados?`)) { return; }

         deleteDisplayedBtn.disabled = true;
         deleteDisplayedBtn.textContent = 'Eliminando...';

         fetch("/admin/delete_many_emails_ajax", {
           method: "POST",
           headers: {"Content-Type": "application/json", "X-CSRFToken": getCsrfToken()},
           body: JSON.stringify({ user_id: parseInt(userId, 10), emails: emailsToDelete })
         })
         .then(handleFetchResponse)
         .then(data => {
           if(data.status === "ok"){
             if(emailsSearchResults) emailsSearchResults.innerHTML = "";
             if(emailsSearchResults) {
               emailsSearchResults.classList.remove('show-block');
               emailsSearchResults.classList.add('hide-element');
             }
             if(deleteDisplayedBtn) {
               deleteDisplayedBtn.classList.remove('btn-inline-block');
               deleteDisplayedBtn.classList.add('hide-element');
             }
             currentlyDisplayedEmails = [];
             fetchAllowedEmails(currentPage, currentPerPage);
           } else {
             alert(`Error: ${data.message || 'Error desconocido'}`);
           }
         })
         .catch(err => {
           alert(`Error de red: ${err.message}`);
         })
         .finally(() => {
             // No restablecer el botón aquí, ya que la lista se limpia
         });
      });
  }
  // ======= FIN BÚSQUEDA Y ELIMINACIÓN =======

  // ======= AÑADIR CORREOS MASIVAMENTE =======
  const addEmailsInput = document.getElementById("addEmailsInput");
  const addEmailsBtn = document.getElementById("addEmailsBtn");
  const addEmailsMsg = document.getElementById("addEmailsMsg");

  if(addEmailsBtn && addEmailsInput && addEmailsMsg){
    addEmailsBtn.addEventListener("click", function() {
      const rawText = addEmailsInput.value.trim();
      if (!rawText) {
         if(addEmailsMsg) { 
           addEmailsMsg.textContent = 'Campo vacío.'; 
           addEmailsMsg.classList.remove('text-color-green', 'text-color-red');
           addEmailsMsg.classList.add('text-color-orange');
         }
         return;
      }
      const emailsToAdd = rawText.split(/[\s,;\n]+/).map(e => e.trim().toLowerCase()).filter(e => e && e.includes('@'));
      if (!emailsToAdd.length) {
         if(addEmailsMsg) { 
           addEmailsMsg.textContent = 'No se encontraron correos válidos.'; 
           addEmailsMsg.classList.remove('text-color-green', 'text-color-red');
           addEmailsMsg.classList.add('text-color-orange');
         }
         return;
      }

      if(addEmailsMsg) { 
        addEmailsMsg.textContent = "Añadiendo..."; 
        addEmailsMsg.classList.remove('text-color-green', 'text-color-red');
        addEmailsMsg.classList.add('text-color-orange');
      }
      addEmailsBtn.disabled = true;

      fetch("/admin/add_allowed_emails_ajax", {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-CSRFToken": getCsrfToken()},
        body: JSON.stringify({ user_id: parseInt(userId, 10), emails: emailsToAdd })
      })
      .then(handleFetchResponse)
      .then(data => {
        if (data.status === "ok") {
          if(addEmailsMsg) {
              addEmailsMsg.textContent = `${data.added_count || 0} añadidos, ${data.skipped_count || 0} omitidos. Recargando lista...`;
              addEmailsMsg.classList.remove('text-color-orange', 'text-color-red');
              addEmailsMsg.classList.add('text-color-green');
          }
          addEmailsInput.value = "";
          fetchAllowedEmails(1, currentPerPage);
        } else {
           throw new Error(data.message || 'Error desconocido');
        }
      })
      .catch(err => {
        if(addEmailsMsg) { 
          addEmailsMsg.textContent = `Error: ${err.message}`; 
          addEmailsMsg.classList.remove('text-color-orange', 'text-color-green');
          addEmailsMsg.classList.add('text-color-red');
        }
      })
      .finally(() => {
          addEmailsBtn.disabled = false;
      });
    });
  }
  // ======= FIN AÑADIR CORREOS =======

  // ======= ACCESO A REGEX (Usuario Principal) =======
  const openRegexModalBtn = document.getElementById("openRegexModalBtn");
  const regexModal = document.getElementById("regexModal");
  const regexListContainer = document.getElementById("regexListContainer");
  const saveRegexSelectionBtn = document.getElementById("saveRegexSelectionBtn");
  const closeRegexModalBtn = document.getElementById("closeRegexModalBtn");

  if(openRegexModalBtn){
    openRegexModalBtn.addEventListener("click", ()=>{
      if(regexModal) {
        regexModal.classList.remove('popup-hide');
        regexModal.classList.add('popup-show');
      }
      loadPrincipalRegex();
    });
  }
  if(closeRegexModalBtn){
    closeRegexModalBtn.addEventListener("click", ()=>{
      if(regexModal) {
        regexModal.classList.remove('popup-show');
        regexModal.classList.add('popup-hide');
      }
    });
  }

  function loadPrincipalRegex(){
    if (!regexListContainer) return;
    fetch(`/admin/list_regex_ajax?user_id=${userId}`, {
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() }
    })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderPrincipalRegexList(data.regexes);
      } else {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error: ${data.message}`;
        regexListContainer.innerHTML = '';
        regexListContainer.appendChild(errorP);
      }
    })
    .catch(err=>{
      console.error("Fetch error list regex principal:", err);
      const errorP = document.createElement('p');
      errorP.classList.add('error-message-text');
      errorP.textContent = `Error: ${err.message}`;
      regexListContainer.innerHTML = '';
      regexListContainer.appendChild(errorP);
    });
  }

  function truncateRegexDisplay(pattern, maxLen = 22) {
    if (typeof pattern !== 'string') return pattern;
    if (pattern.length <= maxLen) return pattern;
    const start = pattern.slice(0, 10);
    const end = pattern.slice(-8);
    return `${start}....${end}`;
  }

  function renderPrincipalRegexList(rxArr){
    if (!regexListContainer) return;
    
    // Limpiar contenedor
    while(regexListContainer.firstChild) {
      regexListContainer.removeChild(regexListContainer.firstChild);
    }
    
    if (!rxArr || rxArr.length === 0) {
      const p = document.createElement('p');
      p.textContent = "No hay Regex definidos en el sistema.";
      regexListContainer.appendChild(p);
      return;
    }
    
    rxArr.forEach((rx,i)=>{
      const itemDiv = document.createElement('div');
      itemDiv.className = i%2===0 ? 'modal-regex-item modal-regex-item-even' : 'modal-regex-item modal-regex-item-odd';
      
      const label = document.createElement('label');
      label.className = 'modal-regex-item-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'principal-regex-cb';
      checkbox.id = `principal-regex-cb-${rx.id}`;
      checkbox.name = `principal-regex-cb-${rx.id}`;
      checkbox.setAttribute('data-id', rx.id);
      if (rx.allowed) checkbox.checked = true;
      
      const strong = document.createElement('strong');
      strong.textContent = escapeHtml(rx.description || 'Sin descripción');
      
      label.appendChild(checkbox);
      label.appendChild(strong);
      itemDiv.appendChild(label);
      regexListContainer.appendChild(itemDiv);
    });
  }

  if(saveRegexSelectionBtn){
    saveRegexSelectionBtn.addEventListener("click", ()=>{
      const cbs = document.querySelectorAll(".principal-regex-cb");
      let allowedIds = [];
      cbs.forEach(cb=>{
        if(cb.checked) allowedIds.push(parseInt(cb.getAttribute("data-id")));
      });
      fetch("/admin/update_user_rfs_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
          user_id:parseInt(userId, 10),
          type:"regex",
          allowed_ids: allowedIds
        })
      })
      .then(handleFetchResponse)
      .then(data=>{
        if(data.status==="ok"){
          alert("Regex principal actualizados.");
          if(regexModal) {
        regexModal.classList.remove('popup-show');
        regexModal.classList.add('popup-hide');
      }
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err=>alert("Error Regex: "+err.message));
    });
  }
  // ======= FIN ACCESO REGEX PRINCIPAL =======

  // ======= ACCESO A FILTROS (Usuario Principal) =======
  const openFiltersModalBtn = document.getElementById("openFiltersModalBtn");
  const filtersModal = document.getElementById("filtersModal");
  const filtersListContainer = document.getElementById("filtersListContainer");
  const saveFiltersSelectionBtn = document.getElementById("saveFiltersSelectionBtn");
  const closeFiltersModalBtn = document.getElementById("closeFiltersModalBtn");

  if(openFiltersModalBtn){
    openFiltersModalBtn.addEventListener("click", ()=>{
      if(filtersModal) {
        filtersModal.classList.remove('popup-hide');
        filtersModal.classList.add('popup-show');
      }
      loadPrincipalFilters();
    });
  }
  if(closeFiltersModalBtn){
    closeFiltersModalBtn.addEventListener("click", ()=>{
      if(filtersModal) {
        filtersModal.classList.remove('popup-show');
        filtersModal.classList.add('popup-hide');
      }
    });
  }

  function loadPrincipalFilters(){
    if(!filtersListContainer) return;
    fetch(`/admin/list_filters_ajax?user_id=${userId}`, {
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() }
    })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderPrincipalFiltersList(data.filters);
      } else {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error: ${data.message}`;
        filtersListContainer.innerHTML = '';
        filtersListContainer.appendChild(errorP);
      }
    })
    .catch(err=>{
      console.error("Fetch error list filters principal:", err);
      const errorP = document.createElement('p');
      errorP.classList.add('error-message-text');
      errorP.textContent = `Error: ${err.message}`;
      filtersListContainer.innerHTML = '';
      filtersListContainer.appendChild(errorP);
    });
  }

  function renderPrincipalFiltersList(ftArr){
    if(!filtersListContainer) return;
    
    // Limpiar contenedor
    while(filtersListContainer.firstChild) {
      filtersListContainer.removeChild(filtersListContainer.firstChild);
    }
    
    if (!ftArr || ftArr.length === 0) {
      const p = document.createElement('p');
      p.textContent = "No hay Filtros definidos en el sistema.";
      filtersListContainer.appendChild(p);
      return;
    }
    
    ftArr.forEach((f,i)=>{
      const itemDiv = document.createElement('div');
      itemDiv.className = i%2===0 ? 'modal-filter-item modal-filter-item-even' : 'modal-filter-item modal-filter-item-odd';
      
      const label = document.createElement('label');
      label.className = 'modal-filter-item-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'principal-filter-cb';
      checkbox.id = `principal-filter-cb-${f.id}`;
      checkbox.name = `principal-filter-cb-${f.id}`;
      checkbox.setAttribute('data-id', f.id);
      if (f.allowed) checkbox.checked = true;
      
      const strong = document.createElement('strong');
      strong.textContent = `(${escapeHtml(f.sender||"?")}) - ${escapeHtml(f.keyword||"?")}`;
      
      label.appendChild(checkbox);
      label.appendChild(strong);
      itemDiv.appendChild(label);
      filtersListContainer.appendChild(itemDiv);
    });
  }

  if(saveFiltersSelectionBtn){
    saveFiltersSelectionBtn.addEventListener("click", ()=>{
      const cbs = document.querySelectorAll(".principal-filter-cb");
      let allowedIds = [];
      cbs.forEach(cb=>{
        if(cb.checked) allowedIds.push(parseInt(cb.getAttribute("data-id")));
      });
      fetch("/admin/update_user_rfs_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
          user_id:parseInt(userId, 10),
          type:"filter",
          allowed_ids: allowedIds
        })
      })
      .then(handleFetchResponse)
      .then(data=>{
        if(data.status==="ok"){
          alert("Filtros principal actualizados.");
          if(filtersModal) {
        filtersModal.classList.remove('popup-show');
        filtersModal.classList.add('popup-hide');
      }
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err=>alert("Error Filtros:"+err.message));
    });
  }
  // ======= FIN ACCESO FILTROS PRINCIPAL =======

  // ======= PERMISO SUB-USUARIOS =======
  const toggleCanCreateSubusers = document.getElementById("toggleCanCreateSubusers");
  const saveCanCreateSubusersBtn = document.getElementById("saveCanCreateSubusersBtn");

  if(saveCanCreateSubusersBtn && toggleCanCreateSubusers){
    saveCanCreateSubusersBtn.addEventListener("click", ()=>{
      const newVal = toggleCanCreateSubusers.checked;
      
      // Obtenemos los valores actuales del usuario desde el DOM (asumiendo que existen)
      const currentUsername = mainContainer.dataset.username;
      const currentColor = mainContainer.dataset.color || "#ffffff";
      const currentPosition = mainContainer.dataset.position;
      const currentCanSearchAny = mainContainer.dataset.canSearchAny === 'true';
      const currentEmail = mainContainer.dataset.email || "";
      const currentFullName = mainContainer.dataset.fullName || "";
      const currentPhone = mainContainer.dataset.phone || "";

      if (
        currentUsername === undefined ||
        currentColor === undefined ||
        currentPosition === undefined ||
        currentCanSearchAny === undefined ||
        currentEmail === undefined
      ) {
          alert("Error: Faltan datos del usuario para guardar. Añade data-* attributes al contenedor #user-management-container.");
          return;
      }

      fetch("/admin/update_user_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
          user_id: parseInt(userId, 10),
          username: currentUsername,
          color: currentColor || "#ffffff",
          position: parseInt(currentPosition, 10),
          can_search_any: currentCanSearchAny,
          password: "", // No se actualiza la contraseña aquí
          can_create_subusers: newVal,
          email: currentEmail ? currentEmail : null,
          full_name: currentFullName || "",
          phone: currentPhone || ""
        })
      })
      .then(handleFetchResponse)
      .then(data=>{
        if(data.status==="ok"){
          alert("Permiso de sub-usuarios guardado.");
          location.reload(); // Recargar para ver cambios
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err=>alert("Error:"+ err.message));
    });
  }
  // ======= FIN PERMISO SUB-USUARIOS =======

  // ======= Ver Sub-usuarios => modal =======
  const btnShowSubusers = document.getElementById("btnShowSubusers");
  const subusersModal = document.getElementById("subusersModal");
  const subusersList = document.getElementById("subusersList");
  const closeSubusersModalBtn = document.getElementById("closeSubusersModalBtn");

  if(btnShowSubusers){
    btnShowSubusers.addEventListener("click", ()=>{
      if(subusersModal) {
        subusersModal.classList.remove('popup-hide');
        subusersModal.classList.add('popup-show');
      }
      loadSubusersForModal();
    });
  }
  if(closeSubusersModalBtn){
    closeSubusersModalBtn.addEventListener("click", ()=>{
      if(subusersModal) {
        subusersModal.classList.remove('popup-show');
        subusersModal.classList.add('popup-hide');
      }
    });
  }

  function loadSubusersForModal(){
    if(!subusersList) return;
    fetch(`/subusers/list_subusers_ajax?parent_id=${userId}`, { 
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() }
    })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderSubusersForModal(data.subusers);
      } else {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error: ${data.message}`;
        subusersList.innerHTML = '';
        subusersList.appendChild(errorP);
      }
    })
    .catch(err=>{
      console.error("Fetch error list subusers for modal:", err);
      const errorP = document.createElement('p');
      errorP.classList.add('error-message-text');
      errorP.textContent = `Error: ${err.message}`;
      subusersList.innerHTML = '';
      subusersList.appendChild(errorP);
    });
  }

  function renderSubusersForModal(arr){
    if(!subusersList) return;
    
    while(subusersList.firstChild) {
      subusersList.removeChild(subusersList.firstChild);
    }
    
    if(!arr || !arr.length){
      const p = document.createElement('p');
      p.textContent = "No hay sub-usuarios creados por este usuario.";
      subusersList.appendChild(p);
      return;
    }
    
    const ul = document.createElement('ul');
    ul.className = 'modal-subuser-list';
    
    arr.forEach(su=>{
      const toggleLabel = su.enabled ? "OFF" : "ON";
      const toggleClass = su.enabled ? "btn-red" : "btn-green";
      
      const li = document.createElement('li');
      li.className = 'modal-subuser-list-item';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'modal-subuser-list-item-content';
      
      const strong = document.createElement('strong');
      strong.textContent = escapeHtml(su.username);
      contentDiv.appendChild(strong);
      
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'modal-subuser-list-item-actions';
      
      const toggleBtn = document.createElement('button');
      toggleBtn.className = `${toggleClass} btn-small modal-toggle-subuser`;
      toggleBtn.setAttribute('data-id', su.id);
      toggleBtn.setAttribute('data-enabled', su.enabled);
      toggleBtn.textContent = toggleLabel;
      actionsDiv.appendChild(toggleBtn);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-red btn-small modal-delete-subuser';
      deleteBtn.setAttribute('data-id', su.id);
      deleteBtn.textContent = 'Eliminar';
      actionsDiv.appendChild(deleteBtn);
      
      contentDiv.appendChild(actionsDiv);
      li.appendChild(contentDiv);
      ul.appendChild(li);
    });
    
    subusersList.appendChild(ul);
  }

  if(subusersModal && subusersList) {
      subusersList.addEventListener("click", function(e) {
          const target = e.target;
          if (target.classList.contains("modal-toggle-subuser")) {
              e.preventDefault();
              const subId = target.dataset.id;
              const currentState = target.dataset.enabled === 'true';
              target.disabled = true;
              target.textContent = '...';
              
              fetch("/subusers/toggle_subuser_ajax", {
                  method:"POST",
                  headers:{ "Content-Type":"application/json", "X-CSRFToken": getCsrfToken() },
                  body: JSON.stringify({ sub_id: parseInt(subId), currently_enabled: currentState })
              })
              .then(handleFetchResponse)
              .then(data => {
                  if(data.status === "ok"){
                      renderSubusersForModal(data.subusers);
                  } else {
                      alert("Error: " + data.message);
                      target.disabled = false;
                      target.textContent = currentState ? 'OFF' : 'ON'; 
                  }
              })
              .catch(err => {
                  console.error("Modal toggle error:", err);
                  alert("Error de red: " + err.message);
                  target.disabled = false;
                  target.textContent = currentState ? 'OFF' : 'ON'; 
              });
          }
          
          if (target.classList.contains("modal-delete-subuser")) {
              e.preventDefault();
              const subId = target.dataset.id;
              if(!confirm("¿Eliminar este sub-usuario?")) return;
              target.disabled = true;
              target.textContent = '...';
              
              fetch("/subusers/delete_subuser_ajax", {
                  method:"POST",
                  headers:{ "Content-Type":"application/json", "X-CSRFToken": getCsrfToken() },
                  body: JSON.stringify({ subuser_id: parseInt(subId) })
              })
              .then(handleFetchResponse)
              .then(data => {
                  if(data.status === "ok"){
                     renderSubusersForModal(data.subusers);
                  } else {
                     alert("Error: " + data.message);
                     target.disabled = false;
                     target.textContent = 'Eliminar';
                  }
              })
              .catch(err => {
                  console.error("Modal delete error:", err);
                  alert("Error de red: " + err.message);
                  target.disabled = false;
                  target.textContent = 'Eliminar';
              });
          }
      });
  }

  // ======= Regex Sub-usuario (Global) =======
  const btnSubusersRegexGlobal = document.getElementById("btnSubusersRegexGlobal");
  const subusersRegexModal = document.getElementById("subusersRegexModal");
  const subusersRegexList = document.getElementById("subusersRegexList");
  const saveSubusersRegexBtn = document.getElementById("saveSubusersRegexBtn");
  const closeSubusersRegexModalBtn = document.getElementById("closeSubusersRegexModalBtn");

  if(btnSubusersRegexGlobal){
    btnSubusersRegexGlobal.addEventListener("click", ()=>{
      if(subusersRegexModal) {
        subusersRegexModal.classList.remove('popup-hide');
        subusersRegexModal.classList.add('popup-show');
      }
      loadGlobalSubusersRegex();
    });
  }
  if(closeSubusersRegexModalBtn){
    closeSubusersRegexModalBtn.addEventListener("click", ()=>{
      if(subusersRegexModal) {
        subusersRegexModal.classList.remove('popup-show');
        subusersRegexModal.classList.add('popup-hide');
      }
    });
  }

  function loadGlobalSubusersRegex(){
    if(!subusersRegexList) return;
    fetch(`/subusers/list_subusers_regex_global?parent_id=${userId}`, {
      method:"GET"
    })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderGlobalSubusersRegex(data.items);
      } else {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error: ${data.message}`;
        subusersRegexList.innerHTML = '';
        subusersRegexList.appendChild(errorP);
      }
    })
    .catch(err=>{
      console.error("Fetch error list global sub regex:", err);
      const errorP = document.createElement('p');
      errorP.classList.add('error-message-text');
      errorP.textContent = `Error: ${err.message}`;
      subusersRegexList.innerHTML = '';
      subusersRegexList.appendChild(errorP);
    });
  }

  function renderGlobalSubusersRegex(arr){
    if (!subusersRegexList) return;
    while(subusersRegexList.firstChild) {
      subusersRegexList.removeChild(subusersRegexList.firstChild);
    }
    if (!arr || arr.length === 0) {
      const p = document.createElement('p');
      p.textContent = "No hay Regex definidos en el sistema.";
      subusersRegexList.appendChild(p);
      return;
    }
    arr.forEach((rx,i)=>{
      const itemDiv = document.createElement('div');
      itemDiv.className = i%2===0 ? 'modal-regex-item modal-regex-item-even' : 'modal-regex-item modal-regex-item-odd';
      const label = document.createElement('label');
      label.className = 'modal-regex-item-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'subusers-regex-global-cb';
      checkbox.id = `subusers-regex-global-cb-${rx.id}`;
      checkbox.name = `subusers-regex-global-cb-${rx.id}`;
      checkbox.setAttribute('data-id', rx.id);
      if (rx.enabled) checkbox.checked = true;
      if (rx.locked) checkbox.disabled = true;
      const strong = document.createElement('strong');
      strong.textContent = escapeHtml(rx.description || 'Sin descripción');
      label.appendChild(checkbox);
      label.appendChild(strong);
      if (rx.locked) {
        const em = document.createElement('em');
        em.className = 'locked-indicator';
        em.textContent = '(Bloqueado: Padre inactivo)';
        label.appendChild(em);
      }
      itemDiv.appendChild(label);
      subusersRegexList.appendChild(itemDiv);
    });
  }

  if(saveSubusersRegexBtn){
    saveSubusersRegexBtn.addEventListener("click", ()=>{
      const cbs = document.querySelectorAll(".subusers-regex-global-cb");
      let allowedIds = [];
      cbs.forEach(cb=>{
        if(cb.checked && !cb.disabled){
          allowedIds.push(parseInt(cb.getAttribute("data-id")));
        }
      });
      fetch("/subusers/save_subusers_regex_global", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ parent_id: parseInt(userId, 10), allowed_ids: allowedIds })
      })
      .then(handleFetchResponse)
      .then(data => {
        if(data.status === "ok"){
          alert("Configuración de Regex para sub-usuarios guardada.");
          if(subusersRegexModal) {
            subusersRegexModal.classList.remove('popup-show');
            subusersRegexModal.classList.add('popup-hide');
          }
        } else {
          alert("Error al guardar Regex para sub-usuarios: " + (data.message || 'Error desconocido'));
        }
      })
      .catch(err => alert("Error de red al guardar Regex para sub-usuarios: " + err.message));
    });
  }

  // ======= Filtros Sub-usuario (Global) =======
  const btnSubusersFilterGlobal = document.getElementById("btnSubusersFilterGlobal");
  const subusersFiltersModal = document.getElementById("subusersFiltersModal");
  const subusersFiltersList = document.getElementById("subusersFiltersList");
  const saveSubusersFiltersBtn = document.getElementById("saveSubusersFiltersBtn");
  const closeSubusersFiltersModalBtn = document.getElementById("closeSubusersFiltersModalBtn");

  if(btnSubusersFilterGlobal){
    btnSubusersFilterGlobal.addEventListener("click", ()=>{
      if(subusersFiltersModal) {
        subusersFiltersModal.classList.remove('popup-hide');
        subusersFiltersModal.classList.add('popup-show');
      }
      loadGlobalSubusersFilters();
    });
  }
  if(closeSubusersFiltersModalBtn){
    closeSubusersFiltersModalBtn.addEventListener("click", ()=>{
      if(subusersFiltersModal) {
        subusersFiltersModal.classList.remove('popup-show');
        subusersFiltersModal.classList.add('popup-hide');
      }
    });
  }

  function loadGlobalSubusersFilters(){
    if(!subusersFiltersList) return;
    fetch(`/subusers/list_subusers_filters_global?parent_id=${userId}`, { method:"GET" })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderGlobalSubusersFilters(data.items);
      } else {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error: ${data.message}`;
        subusersFiltersList.innerHTML = '';
        subusersFiltersList.appendChild(errorP);
      }
    })
    .catch(err=>{
      console.error("Fetch error list global sub filters:", err);
      const errorP = document.createElement('p');
      errorP.classList.add('error-message-text');
      errorP.textContent = `Error: ${err.message}`;
      subusersFiltersList.innerHTML = '';
      subusersFiltersList.appendChild(errorP);
    });
  }

  function renderGlobalSubusersFilters(arr){
    if (!subusersFiltersList) return;
    while(subusersFiltersList.firstChild) {
      subusersFiltersList.removeChild(subusersFiltersList.firstChild);
    }
    if (!arr || arr.length === 0) {
      const p = document.createElement('p');
      p.textContent = "No hay Filtros definidos en el sistema.";
      subusersFiltersList.appendChild(p);
      return;
    }
    arr.forEach((f,i)=>{
      const itemDiv = document.createElement('div');
      itemDiv.className = i%2===0 ? 'modal-filter-item modal-filter-item-even' : 'modal-filter-item modal-filter-item-odd';
      const label = document.createElement('label');
      label.className = 'modal-filter-item-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'subusers-filters-global-cb';
      checkbox.id = `subusers-filters-global-cb-${f.id}`;
      checkbox.name = `subusers-filters-global-cb-${f.id}`;
      checkbox.setAttribute('data-id', f.id);
      if (f.enabled) checkbox.checked = true;
      if (f.locked) checkbox.disabled = true;
      const strong = document.createElement('strong');
      strong.textContent = `(${escapeHtml(f.sender||"?")}) - ${escapeHtml(f.keyword||"?")}`;
      label.appendChild(checkbox);
      label.appendChild(strong);
      if (f.locked) {
        const em = document.createElement('em');
        em.className = 'locked-indicator';
        em.textContent = '(Bloqueado: Padre inactivo)';
        label.appendChild(em);
      }
      itemDiv.appendChild(label);
      subusersFiltersList.appendChild(itemDiv);
    });
  }

  if(saveSubusersFiltersBtn){
    saveSubusersFiltersBtn.addEventListener("click", ()=>{
      const cbs = document.querySelectorAll(".subusers-filters-global-cb");
      let allowedIds = [];
      cbs.forEach(cb=>{
        if(cb.checked && !cb.disabled){
          allowedIds.push(parseInt(cb.getAttribute("data-id")));
        }
      });
      fetch("/subusers/save_subusers_filters_global", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ parent_id: parseInt(userId, 10), allowed_ids: allowedIds })
      })
      .then(handleFetchResponse)
      .then(data => {
        if(data.status === "ok"){
          alert("Configuración de Filtros para sub-usuarios guardada.");
          if(subusersFiltersModal) {
            subusersFiltersModal.classList.remove('popup-show');
            subusersFiltersModal.classList.add('popup-hide');
          }
        } else {
          alert("Error al guardar Filtros para sub-usuarios: " + (data.message || 'Error desconocido'));
        }
      })
      .catch(err => alert("Error de red al guardar Filtros para sub-usuarios: " + err.message));
    });
  }

  // ======= BOTONES DE NAVEGACIÓN 'VOLVER' ========
  const btnVolverUsuarios = document.getElementById("btnVolverUsuarios");
  const btnVolverPanel = document.getElementById("btnVolverPanel");
  if (btnVolverUsuarios) {
    btnVolverUsuarios.addEventListener("click", function() {
      const url = this.getAttribute("data-url");
      if (url) window.location.href = url;
    });
  }
  if (btnVolverPanel) {
    btnVolverPanel.addEventListener("click", function() {
      const url = this.getAttribute("data-url");
      if (url) window.location.href = url;
    });
  }

  // ======= FUNCIONES DEL JAVASCRIPT INLINE =======
  const searchForm = document.getElementById('searchEmailsForm');
  const searchInput = document.getElementById('searchEmailsInput');
  if (searchForm && searchInput) {
    let searchTimeout = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => { searchForm.requestSubmit(); }, 250);
    });
  }

  // Cierre automático de popups al hacer clic fuera
  const popups = [
    'regexModal', 'filtersModal', 'subusersModal', 
    'subusersRegexModal', 'subusersFiltersModal',
    'myApiModal', 'editLinkedApiModal'
  ];
  popups.forEach(function(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
      document.addEventListener('mousedown', function(e) {
        if (popup.classList.contains('popup-show') || popup.classList.contains('popup-visible')) {
          if (!popup.contains(e.target) && !e.target.closest('.open-alias-popup') && !e.target.closest('#showMyApiBtn') && !e.target.closest('.edit-project-btn')) {
            popup.classList.remove('popup-show', 'popup-visible');
            popup.classList.add('popup-hide');
          }
        }
      });
    }
  });

  // ======= LÓGICA PARA APIs VINCULADAS =======
  const linkedApisList = document.getElementById("linkedApisList");
  const addLinkedApiBtn = document.getElementById("addLinkedApiBtn");
  const newApiNameInput = document.getElementById("newApiNameInput");
  const newApiUrlInput = document.getElementById("newApiUrlInput");
  const newApiTokenInput = document.getElementById("newApiTokenInput");
  const linkedApiMsg = document.getElementById("linkedApiMsg");

  const myApiModal = document.getElementById("myApiModal");
  const showMyApiBtn = document.getElementById("showMyApiBtn");
  const closeMyApiModalBtn = document.getElementById("closeMyApiModalBtn");
  const myApiUrlDisplay = document.getElementById("myApiUrlDisplay");
  const myApiTokenDisplay = document.getElementById("myApiTokenDisplay");
  const regenMasterTokenBtn = document.getElementById("regenMasterTokenBtn");

  const editLinkedApiModal = document.getElementById("editLinkedApiModal");
  const closeEditApiModalBtn = document.getElementById("closeEditApiModalBtn");
  const editApiId = document.getElementById("editApiId");
  const editApiName = document.getElementById("editApiName");
  const editApiUrl = document.getElementById("editApiUrl");
  const editApiToken = document.getElementById("editApiToken");
  const saveEditApiBtn = document.getElementById("saveEditApiBtn");

  function fetchLinkedProjects() {
    if (!linkedApisList) return;
    fetch(`/admin/user/${userId}/linked_projects`, {
      method: "GET",
      headers: { "X-CSRFToken": getCsrfToken() }
    })
    .then(handleFetchResponse)
    .then(data => {
      if (data.status === "ok") {
        renderLinkedProjects(data.projects);
      } else {
        linkedApisList.innerHTML = `<p class="text-danger text-center">Error: ${data.message}</p>`;
      }
    })
    .catch(err => {
      console.error("Error fetching linked projects:", err);
      linkedApisList.innerHTML = `<p class="text-danger text-center">Error de red: ${err.message}</p>`;
    });
  }

  function renderLinkedProjects(projects) {
    if (!linkedApisList) return;
    linkedApisList.innerHTML = "";
    if (!projects || projects.length === 0) {
      linkedApisList.innerHTML = '<p class="text-muted text-center">No hay APIs vinculadas.</p>';
      return;
    }

    projects.forEach(p => {
      const div = document.createElement("div");
      div.className = "linked-api-item d-flex justify-content-between align-items-center mb-05 p-05";
      div.innerHTML = `
        <div class="flex-grow-1 ml-05 text-left">
          <strong>${escapeHtml(p.name)}</strong><br>
          <small class="text-muted">${escapeHtml(p.url)}</small>
        </div>
        <div class="d-flex gap-05 mr-05">
          <button type="button" class="btn-panel btn-orange btn-sm edit-project-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-api-url="${escapeHtml(p.url)}" data-token="${escapeHtml(p.token)}">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" class="btn-panel btn-red btn-sm delete-project-btn" data-id="${p.id}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
      linkedApisList.appendChild(div);
    });

    linkedApisList.querySelectorAll(".edit-project-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        editApiId.value = btn.dataset.id;
        editApiName.value = btn.dataset.name;
        editApiUrl.value = btn.dataset.apiUrl;
        editApiToken.value = btn.dataset.token;
        editLinkedApiModal.classList.remove("popup-hide");
        editLinkedApiModal.classList.add("popup-show");
      });
    });

    linkedApisList.querySelectorAll(".delete-project-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("¿Seguro que quieres eliminar esta API vinculada?")) return;
        const projectId = btn.dataset.id;
        fetch(`/admin/user/linked_projects/${projectId}`, {
          method: "DELETE",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(handleFetchResponse)
        .then(data => {
          if (data.status === "ok") {
            fetchLinkedProjects();
          } else {
            alert("Error al eliminar: " + data.message);
          }
        })
        .catch(err => alert("Error de red: " + err.message));
      });
    });
  }

  if (addLinkedApiBtn) {
    addLinkedApiBtn.addEventListener("click", () => {
      const name = newApiNameInput.value.trim();
      const url = newApiUrlInput.value.trim();
      const token = newApiTokenInput.value.trim();
      if (!name || !url || !token) {
        linkedApiMsg.textContent = "Faltan datos obligatorios.";
        linkedApiMsg.className = "text-italic text-danger";
        return;
      }
      addLinkedApiBtn.disabled = true;
      linkedApiMsg.textContent = "Agregando...";
      linkedApiMsg.className = "text-italic text-orange";
      fetch(`/admin/user/${userId}/linked_projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ name, url, token })
      })
      .then(handleFetchResponse)
      .then(data => {
        if (data.status === "ok") {
          linkedApiMsg.textContent = "API agregada correctamente.";
          linkedApiMsg.className = "text-italic text-success";
          newApiNameInput.value = "";
          newApiUrlInput.value = "";
          newApiTokenInput.value = "";
          fetchLinkedProjects();
        } else {
          linkedApiMsg.textContent = "Error: " + data.message;
          linkedApiMsg.className = "text-italic text-danger";
        }
      })
      .catch(err => {
        linkedApiMsg.textContent = "Error de red: " + err.message;
        linkedApiMsg.className = "text-italic text-danger";
      })
      .finally(() => addLinkedApiBtn.disabled = false);
    });
  }

  if (showMyApiBtn) {
    showMyApiBtn.addEventListener("click", () => {
      fetch(`/admin/user/${userId}/master_token`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(handleFetchResponse)
      .then(data => {
        if (data.status === "ok") {
          myApiUrlDisplay.value = data.api_url;
          myApiTokenDisplay.value = data.token;
          myApiModal.classList.remove("popup-hide");
          myApiModal.classList.add("popup-show");
        } else {
          alert("Error al obtener token: " + data.message);
        }
      })
      .catch(err => alert("Error de red: " + err.message));
    });
  }

  if (closeMyApiModalBtn) {
    closeMyApiModalBtn.addEventListener("click", () => {
      myApiModal.classList.remove("popup-show");
      myApiModal.classList.add("popup-hide");
    });
  }

  // Botones de copiar API
  document.querySelectorAll(".copy-api-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.select();
        document.execCommand("copy");
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.innerHTML = originalIcon; }, 2000);
      }
    });
  });

  if (regenMasterTokenBtn) {
    regenMasterTokenBtn.addEventListener("click", () => {
      if (!confirm("¿Seguro que quieres regenerar tu token maestro? Las vinculaciones en otros proyectos dejarán de funcionar hasta que las actualices con el nuevo token.")) return;
      fetch(`/admin/user/${userId}/regen_master_token`, {
        method: "POST",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(handleFetchResponse)
      .then(data => {
        if (data.status === "ok") {
          myApiTokenDisplay.value = data.token;
          alert("Nuevo token generado.");
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err => alert("Error de red: " + err.message));
    });
  }

  if (closeEditApiModalBtn) {
    closeEditApiModalBtn.addEventListener("click", () => {
      editLinkedApiModal.classList.remove("popup-show");
      editLinkedApiModal.classList.add("popup-hide");
    });
  }

  if (saveEditApiBtn) {
    saveEditApiBtn.addEventListener("click", () => {
      const projectId = editApiId.value;
      const name = editApiName.value.trim();
      const url = editApiUrl.value.trim();
      const token = editApiToken.value.trim();
      if (!name || !url || !token) {
        alert("Faltan datos obligatorios.");
        return;
      }
      saveEditApiBtn.disabled = true;
      fetch(`/admin/user/linked_projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ name, url, token })
      })
      .then(handleFetchResponse)
      .then(data => {
        if (data.status === "ok") {
          editLinkedApiModal.classList.remove("popup-show");
          editLinkedApiModal.classList.add("popup-hide");
          fetchLinkedProjects();
        } else {
          alert("Error al actualizar: " + data.message);
        }
      })
      .catch(err => alert("Error de red: " + err.message))
      .finally(() => saveEditApiBtn.disabled = false);
    });
  }

  fetchLinkedProjects();
  // ======= FIN LÓGICA APIs VINCULADAS =======

}); // Fin DOMContentLoaded 
