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
    
    if (allowedEmailsTextContainer) allowedEmailsTextContainer.innerHTML = "<p>Cargando...</p>";
    
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
        if (allowedEmailsTextContainer) allowedEmailsTextContainer.innerHTML = `<p style="color:red;">Error: ${data.message || 'No se pudieron cargar los correos.'}</p>`;
      }
    })
    .catch(err => {
      console.error("Fetch error list emails:", err);
      if (allowedEmailsTextContainer) allowedEmailsTextContainer.innerHTML = `<p style="color:red;">Error al cargar correos: ${err.message}</p>`;
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
            deleteAllEmailsBtn.style.display = 'inline-block';
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
          emailsSearchResults.innerHTML = `<p style="color:red;">Error: ${data.message || 'Respuesta inválida'}</p>`;
           if(searchStatusDiv) searchStatusDiv.textContent = '';
           deleteDisplayedBtn.style.display = 'none';
        }
      })
      .catch(err => {
        console.error("Fetch error search:", err);
        emailsSearchResults.innerHTML = `<p style="color:red;">Error al buscar: ${err.message}</p>`;
         if(searchStatusDiv) searchStatusDiv.textContent = '';
         deleteDisplayedBtn.style.display = 'none';
      });
    });
  }

  function renderEmailsResults(emails) {
    if (!emailsSearchResults) return;
    emailsSearchResults.innerHTML = '';
    if (!emails || emails.length === 0) {
        emailsSearchResults.style.display = 'none';
        if(deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
        return;
    }

    emailsSearchResults.style.display = 'block';
    emails.forEach(email => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('search-result-item');
        itemDiv.innerHTML = `
            <span>${escapeHtml(email)}</span>
            <button class="delete-search-result-btn" data-email="${escapeHtml(email)}" title="Eliminar este correo">X</button>
        `;
        emailsSearchResults.appendChild(itemDiv);
    });

    if(deleteDisplayedBtn) {
        deleteDisplayedBtn.textContent = `Eliminar ${emails.length} Mostrados`;
        deleteDisplayedBtn.style.display = 'inline-block';
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
                 if(deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'inline-block';
            } else {
                 emailsSearchResults.style.display = 'none';
                 if(deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
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
             if(emailsSearchResults) emailsSearchResults.style.display = 'none';
             deleteDisplayedBtn.style.display = 'none';
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
         if(addEmailsMsg) { addEmailsMsg.textContent = 'Campo vacío.'; addEmailsMsg.style.color = 'orange';}
         return;
      }
      const emailsToAdd = rawText.split(/[\s,;\n]+/).map(e => e.trim().toLowerCase()).filter(e => e && e.includes('@'));
      if (!emailsToAdd.length) {
         if(addEmailsMsg) { addEmailsMsg.textContent = 'No se encontraron correos válidos.'; addEmailsMsg.style.color = 'orange';}
         return;
      }

      if(addEmailsMsg) { addEmailsMsg.textContent = "Añadiendo..."; addEmailsMsg.style.color = "orange"; }
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
              addEmailsMsg.style.color = "green";
          }
          addEmailsInput.value = "";
          fetchAllowedEmails(1, currentPerPage);
        } else {
           throw new Error(data.message || 'Error desconocido');
        }
      })
      .catch(err => {
        if(addEmailsMsg) { addEmailsMsg.textContent = `Error: ${err.message}`; addEmailsMsg.style.color = "red"; }
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
      if(regexModal) regexModal.style.display="block";
      loadPrincipalRegex();
    });
  }
  if(closeRegexModalBtn){
    closeRegexModalBtn.addEventListener("click", ()=>{
      if(regexModal) regexModal.style.display="none";
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
        regexListContainer.innerHTML=`<p style="color:red;">Error: ${data.message}</p>`;
      }
    })
    .catch(err=>{
      console.error("Fetch error list regex principal:", err);
      regexListContainer.innerHTML=`<p style="color:red;">Error: ${err.message}</p>`;
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
    let html="";
    if (!rxArr || rxArr.length === 0) {
        html = "<p>No hay Regex definidos en el sistema.</p>"
    } else {
        rxArr.forEach((rx,i)=>{
          const bg = (i%2===0) ? "#f9f9f9" : "#fff";
          html += `
            <div style="background:${bg}; padding:6px; text-align:left;">
              <label style="display:flex; gap:0.5rem; align-items:center; text-align:left;">
                <input
                  type="checkbox"
                  class="principal-regex-cb"
                  id="principal-regex-cb-${rx.id}"
                  name="principal-regex-cb-${rx.id}"
                  data-id="${rx.id}"
                  ${rx.allowed ? "checked" : ""}
                >
                <strong style='text-align:left;'>${escapeHtml(truncateRegexDisplay(rx.pattern))}</strong>
                <small>(${escapeHtml(rx.description||"")})</small>
              </label>
            </div>
          `;
        });
    }
    regexListContainer.innerHTML = html;
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
          if(regexModal) regexModal.style.display="none";
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
      if(filtersModal) filtersModal.style.display="block";
      loadPrincipalFilters();
    });
  }
  if(closeFiltersModalBtn){
    closeFiltersModalBtn.addEventListener("click", ()=>{
      if(filtersModal) filtersModal.style.display="none";
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
        filtersListContainer.innerHTML = `<p style="color:red;">Error: ${data.message}</p>`;
      }
    })
    .catch(err=>{
      console.error("Fetch error list filters principal:", err);
      filtersListContainer.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
    });
  }

  function renderPrincipalFiltersList(ftArr){
    if(!filtersListContainer) return;
    let html="";
     if (!ftArr || ftArr.length === 0) {
        html = "<p>No hay Filtros definidos en el sistema.</p>"
    } else {
        ftArr.forEach((f,i)=>{
          const bg = (i%2===0) ? "#f9f9f9" : "#fff";
          html += `
            <div style="background:${bg}; padding:6px;">
              <label style="display:flex; gap:0.5rem; align-items:center;">
                <input
                  type="checkbox"
                  class="principal-filter-cb"
                  id="principal-filter-cb-${f.id}"
                  name="principal-filter-cb-${f.id}"
                  data-id="${f.id}"
                  ${f.allowed ? "checked" : ""}
                >
                <strong>(${escapeHtml(f.sender||"?")}) - ${escapeHtml(f.keyword||"?")}</strong>
              </label>
            </div>
          `;
        });
    }
    filtersListContainer.innerHTML = html;
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
          if(filtersModal) filtersModal.style.display="none";
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
      // OJO: Si no existen estos campos en el HTML, esto dará error. Necesitaríamos pasarlos 
      // de otra forma (ej. data attributes en el botón o contenedor)
      // Por simplicidad, dejaremos los valores hardcodeados de la plantilla original por ahora.
      // Si da problemas, habrá que refactorizar para obtenerlos del DOM o data attributes.
      const currentUsername = mainContainer.dataset.username; // Necesita data-username
      const currentColor = mainContainer.dataset.color || "#ffffff";
      const currentPosition = mainContainer.dataset.position; // Necesita data-position
      const currentCanSearchAny = mainContainer.dataset.canSearchAny === 'true'; // Necesita data-can-search-any
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
          location.reload(); // Recargar para ver cambios (ej. aparición/desaparición sección subusuarios)
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
      if(subusersModal) subusersModal.style.display="block";
      loadSubusersForModal(); // Renombrada para claridad
    });
  }
  if(closeSubusersModalBtn){
    closeSubusersModalBtn.addEventListener("click", ()=>{
      if(subusersModal) subusersModal.style.display="none";
    });
  }

  function loadSubusersForModal(){
    if(!subusersList) return;
    // La ruta ahora debe ser la de listar subusuarios de un padre específico
    fetch(`/subusers/list_subusers_ajax?parent_id=${userId}`, { 
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() } // Probablemente innecesario para GET, pero mantenido
    })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderSubusersForModal(data.subusers);
      } else {
        subusersList.innerHTML=`<p style="color:red;">Error: ${data.message}</p>`;
      }
    })
    .catch(err=>{
      console.error("Fetch error list subusers for modal:", err);
      subusersList.innerHTML=`<p style="color:red;">Error: ${err.message}</p>`;
    });
  }

  function renderSubusersForModal(arr){
    if(!subusersList) return;
    if(!arr || !arr.length){
      subusersList.innerHTML="<p>No hay sub-usuarios creados por este usuario.</p>";
      return;
    }
    let html="<ul style='list-style:none; margin:0; padding:0;'>";
    arr.forEach(su=>{
      const toggleLabel = su.enabled ? "OFF" : "ON";
      const toggleClass = su.enabled ? "btn-red" : "btn-green";
      // Usar data-* attributes para los botones en lugar de onclick global
      html += `
        <li style="margin-bottom:0.7rem; border-bottom:1px solid #ccc; padding-bottom:0.5rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <strong>${escapeHtml(su.username)}</strong>
            <div style="display:flex; gap:0.5rem;">
              <button
                class="${toggleClass} btn-small modal-toggle-subuser"
                data-id="${su.id}"
                data-enabled="${su.enabled}"
              >
                ${toggleLabel}
              </button>
              <button
                class="btn-red btn-small modal-delete-subuser"
                data-id="${su.id}"
              >
                Eliminar
              </button>
            </div>
          </div>
        </li>
      `;
    });
    html += "</ul>";
    subusersList.innerHTML = html;
  }

  // Delegación de eventos DENTRO del modal de subusuarios
  if(subusersModal && subusersList) {
      subusersList.addEventListener("click", function(e) {
          const target = e.target;
          
          // Toggle dentro del modal
          if (target.classList.contains("modal-toggle-subuser")) {
              e.preventDefault();
              const subId = target.dataset.id;
              const currentState = target.dataset.enabled === 'true';
              target.disabled = true; // Deshabilitar botón temporalmente
              target.textContent = '...';
              
              fetch("/subusers/toggle_subuser_ajax", {
                  method:"POST",
                  headers:{ "Content-Type":"application/json", "X-CSRFToken": getCsrfToken() },
                  body: JSON.stringify({ sub_id: parseInt(subId), currently_enabled: currentState })
              })
              .then(handleFetchResponse)
              .then(data => {
                  if(data.status === "ok"){
                      renderSubusersForModal(data.subusers); // Re-renderizar la lista del modal
                  } else {
                      alert("Error: " + data.message);
                      target.disabled = false; // Rehabilitar si falla
                      target.textContent = currentState ? 'OFF' : 'ON'; 
                  }
              })
              .catch(err => {
                  console.error("Modal toggle error:", err);
                  alert("Error de red: " + err.message);
                  target.disabled = false; // Rehabilitar si falla
                  target.textContent = currentState ? 'OFF' : 'ON'; 
              });
          }
          
          // Delete dentro del modal
          if (target.classList.contains("modal-delete-subuser")) {
              e.preventDefault();
              const subId = target.dataset.id;
              if(!confirm("¿Eliminar este sub-usuario?")) return;
              target.disabled = true; // Deshabilitar botón temporalmente
              target.textContent = '...';
              
              fetch("/subusers/delete_subuser_ajax", {
                  method:"POST",
                  headers:{ "Content-Type":"application/json", "X-CSRFToken": getCsrfToken() },
                  body: JSON.stringify({ subuser_id: parseInt(subId) })
              })
              .then(handleFetchResponse)
              .then(data => {
                  if(data.status === "ok"){
                     renderSubusersForModal(data.subusers); // Re-renderizar la lista del modal
                  } else {
                     alert("Error: " + data.message);
                     target.disabled = false; // Rehabilitar si falla
                     target.textContent = 'Eliminar';
                  }
              })
              .catch(err => {
                  console.error("Modal delete error:", err);
                  alert("Error de red: " + err.message);
                  target.disabled = false; // Rehabilitar si falla
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
      if(subusersRegexModal) subusersRegexModal.style.display="block";
      loadGlobalSubusersRegex();
    });
  }
  if(closeSubusersRegexModalBtn){
    closeSubusersRegexModalBtn.addEventListener("click", ()=>{
      if(subusersRegexModal) subusersRegexModal.style.display="none";
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
        subusersRegexList.innerHTML=`<p style="color:red;">Error: ${data.message}</p>`;
      }
    })
    .catch(err=>{
      console.error("Fetch error list global sub regex:", err);
      subusersRegexList.innerHTML=`<p style="color:red;">Error: ${err.message}</p>`;
    });
  }

  function renderGlobalSubusersRegex(arr){
    if (!subusersRegexList) return;
    let html="";
     if (!arr || arr.length === 0) {
        html = "<p>No hay Regex definidos en el sistema.</p>"
    } else {
        arr.forEach((rx,i)=>{
          const bg=(i%2===0)?"#f9f9f9":"#fff";
          html+=`
            <div style="background:${bg}; padding:6px; text-align:left;">
              <label style="display:flex; align-items:center; gap:0.5rem; text-align:left;">
                <input
                  type="checkbox"
                  class="subusers-regex-global-cb"
                  id="subusers-regex-global-cb-${rx.id}"
                  name="subusers-regex-global-cb-${rx.id}"
                  data-id="${rx.id}"
                  ${rx.enabled ? "checked" : ""}
                  ${rx.locked ? "disabled" : ""}
                >
                <strong style='text-align:left;'>${escapeHtml(truncateRegexDisplay(rx.pattern))}</strong>
                <small>(${escapeHtml(rx.description||"")})</small>
                ${ rx.locked
                   ? "<em style='color:#dc3545; font-size:0.8rem; margin-left: auto;'>(Bloqueado: Padre inactivo)</em>"
                   : ""
                }
              </label>
            </div>
          `
        });
    }
    subusersRegexList.innerHTML = html;
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
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
          parent_id: parseInt(userId, 10), 
          allowed_ids: allowedIds
        })
      })
      .then(handleFetchResponse)
      .then(data => {
        if(data.status === "ok"){
          alert("Configuración de Regex para sub-usuarios guardada.");
          if(subusersRegexModal) subusersRegexModal.style.display = "none";
        } else {
          alert("Error al guardar Regex para sub-usuarios: " + (data.message || 'Error desconocido'));
        }
      })
      .catch(err => alert("Error de red al guardar Regex para sub-usuarios: " + err.message));
    });
  }
  // ======= FIN REGEX SUB-USUARIO GLOBAL =======

  // ======= Filtros Sub-usuario (Global) =======
  const btnSubusersFilterGlobal = document.getElementById("btnSubusersFilterGlobal");
  const subusersFiltersModal = document.getElementById("subusersFiltersModal");
  const subusersFiltersList = document.getElementById("subusersFiltersList");
  const saveSubusersFiltersBtn = document.getElementById("saveSubusersFiltersBtn");
  const closeSubusersFiltersModalBtn = document.getElementById("closeSubusersFiltersModalBtn");

  if(btnSubusersFilterGlobal){
    btnSubusersFilterGlobal.addEventListener("click", ()=>{
      if(subusersFiltersModal) subusersFiltersModal.style.display="block";
      loadGlobalSubusersFilters();
    });
  }
  if(closeSubusersFiltersModalBtn){
    closeSubusersFiltersModalBtn.addEventListener("click", ()=>{
      if(subusersFiltersModal) subusersFiltersModal.style.display="none";
    });
  }

  function loadGlobalSubusersFilters(){
    if(!subusersFiltersList) return;
    fetch(`/subusers/list_subusers_filters_global?parent_id=${userId}`, {
      method:"GET"
    })
    .then(handleFetchResponse)
    .then(data=>{
      if(data.status==="ok"){
        renderGlobalSubusersFilters(data.items);
      } else {
        subusersFiltersList.innerHTML=`<p style="color:red;">Error: ${data.message}</p>`;
      }
    })
    .catch(err=>{
      console.error("Fetch error list global sub filters:", err);
      subusersFiltersList.innerHTML=`<p style="color:red;">Error: ${err.message}</p>`;
    });
  }

  function renderGlobalSubusersFilters(arr){
    if (!subusersFiltersList) return;
    let html="";
     if (!arr || arr.length === 0) {
        html = "<p>No hay Filtros definidos en el sistema.</p>"
    } else {
        arr.forEach((f,i)=>{
          const bg = (i%2===0) ? "#f9f9f9" : "#fff";
          html += `
            <div style="background:${bg}; padding:6px;">
              <label style="display:flex; gap:0.5rem; align-items:center;">
                <input
                  type="checkbox"
                  class="subusers-filters-global-cb"
                  id="subusers-filters-global-cb-${f.id}"
                  name="subusers-filters-global-cb-${f.id}"
                  data-id="${f.id}"
                  ${f.enabled ? "checked" : ""} 
                  ${f.locked ? "disabled" : ""}
                >
                <strong>(${escapeHtml(f.sender||"?")}) - ${escapeHtml(f.keyword||"?")}</strong>
                ${ f.locked
                   ? "<em style='color:#dc3545; font-size:0.8rem; margin-left: auto;'>(Bloqueado: Padre inactivo)</em>"
                   : ""
                }
              </label>
            </div>
          `;
        });
    }
    subusersFiltersList.innerHTML = html;
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
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({
          parent_id: parseInt(userId, 10), 
          allowed_ids: allowedIds
        })
      })
      .then(handleFetchResponse)
      .then(data => {
        if(data.status === "ok"){
          alert("Configuración de Filtros para sub-usuarios guardada.");
          if(subusersFiltersModal) subusersFiltersModal.style.display = "none";
        } else {
          alert("Error al guardar Filtros para sub-usuarios: " + (data.message || 'Error desconocido'));
        }
      })
      .catch(err => alert("Error de red al guardar Filtros para sub-usuarios: " + err.message));
    });
  }
  // ======= FIN FILTROS SUB-USUARIO GLOBAL =======

  // ======= BOTONES DE NAVEGACIÓN 'VOLVER' ========
  const btnVolverUsuarios = document.getElementById("btnVolverUsuarios");
  const btnVolverPanel = document.getElementById("btnVolverPanel");

  if (btnVolverUsuarios) {
    btnVolverUsuarios.addEventListener("click", function() {
      const url = this.getAttribute("data-url");
      if (url) {
        window.location.href = url;
      }
    });
  }

  if (btnVolverPanel) {
    btnVolverPanel.addEventListener("click", function() {
      const url = this.getAttribute("data-url");
      if (url) {
        window.location.href = url;
      }
    });
  }
  // ======= FIN BOTONES 'VOLVER' =======

  // === TRUNCAR VISUALIZACIÓN DE REGEX EN POPUPS ===
  function truncateRegexDisplay(pattern, maxLen = 22) {
    if (typeof pattern !== 'string') return pattern;
    if (pattern.length <= maxLen) return pattern;
    const start = pattern.slice(0, 10);
    const end = pattern.slice(-8);
    return `${start}....${end}`;
  }

  // Hook para popups de Regex (principal y sub-usuario)
  function patchRegexPopupDisplay() {
    // Para el popup principal
    const regexList = document.getElementById('regexListContainer');
    if (regexList) {
      regexList.querySelectorAll('.regex-item').forEach(function(item) {
        const strongs = item.querySelectorAll('strong');
        strongs.forEach(function(strong) {
          if (strong.textContent.trim().toLowerCase().startsWith('patrón:')) {
            const next = strong.nextSibling;
            if (next && next.nodeType === 3) {
              const original = next.textContent.trim();
              next.textContent = ' ' + truncateRegexDisplay(original);
            }
          }
        });
      });
    }
    // Para el popup de sub-usuario
    const subusersRegexList = document.getElementById('subusersRegexList');
    if (subusersRegexList) {
      subusersRegexList.querySelectorAll('.regex-item').forEach(function(item) {
        const strongs = item.querySelectorAll('strong');
        strongs.forEach(function(strong) {
          if (strong.textContent.trim().toLowerCase().startsWith('patrón:')) {
            const next = strong.nextSibling;
            if (next && next.nodeType === 3) {
              const original = next.textContent.trim();
              next.textContent = ' ' + truncateRegexDisplay(original);
            }
          }
        });
      });
    }
  }

  // Llamar al hook cada vez que se abre el popup
  ['openRegexModalBtn', 'btnSubusersRegexGlobal'].forEach(function(btnId) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', function() {
        setTimeout(patchRegexPopupDisplay, 200);
      });
    }
  });

  // ======= FUNCIONES DEL JAVASCRIPT INLINE =======
  
  // Búsqueda instantánea
  const searchForm = document.getElementById('searchEmailsForm');
  const searchInput = document.getElementById('searchEmailsInput');
  if (searchForm && searchInput) {
    let searchTimeout = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchForm.requestSubmit();
      }, 250);
    });
  }

  // Cierre automático de popups al hacer clic fuera
  const popups = [
    'regexModal',
    'filtersModal',
    'subusersModal',
    'subusersRegexModal',
    'subusersFiltersModal'
  ];
  popups.forEach(function(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
      document.addEventListener('mousedown', function(e) {
        if (popup.style.display === 'block' || popup.classList.contains('popup-visible')) {
          if (!popup.contains(e.target)) {
            popup.style.display = 'none';
            popup.classList.remove('popup-visible');
          }
        }
      });
    }
  });

}); // Fin DOMContentLoaded 