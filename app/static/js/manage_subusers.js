document.addEventListener("DOMContentLoaded", function() {
  function getCsrfToken(){
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Función para parsear correos del texto (separados por comas, espacios o saltos de línea)
  function parseEmailsFromText(text) {
    if (!text || !text.trim()) {
      return [];
    }
    
    // Dividir por comas, espacios, saltos de línea, punto y coma, etc.
    const emails = text
      .split(/[,\s\n\r;]+/)
      .map(email => email.trim().toLowerCase())
      .filter(email => {
        // Validar formato básico de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return email && emailRegex.test(email);
      });
    
    return [...new Set(emails)]; // Eliminar duplicados
  }

  const createForm = document.getElementById("createSubuserForm");
  const subUsername = document.getElementById("subUsername");
  const subPassword = document.getElementById("subPassword");
  const createSubuserMsg = document.getElementById("createSubuserMsg");

  // Si quisieras manual: 
  // const subParentId = document.getElementById("subParentId");

  const searchForm = document.getElementById("searchSubusersForm");
  const searchInput = document.getElementById("searchSubusersInput");
  const subusersContainer = document.getElementById("subusersContainer");
  const btnVolverBusqueda = document.getElementById("btnVolverBusqueda");

  // Al cargar => listar sub-usuarios
  if(subusersContainer) { // Asegurarse que el contenedor existe antes de cargar
      loadAllSubusers();
  } else {
      console.error("Contenedor #subusersContainer no encontrado al cargar.");
  }

  // Listener para botón Volver a Búsqueda
  if (btnVolverBusqueda) {
    const homeUrl = btnVolverBusqueda.dataset.homeUrl;
    if (homeUrl) {
        btnVolverBusqueda.addEventListener("click", () => {
            window.location.href = homeUrl;
        });
    } else {
        console.error("No se encontró data-home-url en el botón #btnVolverBusqueda");
    }
  }

  // 1) CREAR SUB-USUARIO
  if (createForm) { // Verificar que el formulario existe
      createForm.addEventListener("submit", function(e) {
        e.preventDefault();
        const userVal = subUsername.value.trim();
        const passVal = subPassword.value.trim();
        if(!userVal || !passVal){
          createSubuserMsg.textContent = "Usuario y contraseña son obligatorios.";
          return;
        }
        const payload = {
          username: userVal,
          password: passVal
          // parent_id: parseInt(subParentId.value) || null  // si eres admin
        };

        fetch("/subusers/create_subuser_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify(payload)
        })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            subUsername.value = "";
            subPassword.value = "";
            createSubuserMsg.textContent = "";
            renderSubusers(data.subusers || []);
          } else {
            createSubuserMsg.textContent = "Error: " + data.message;
          }
        })
        .catch(err=> {
          createSubuserMsg.textContent = "Error: " + err;
        });
      });
  } // Fin if (createForm)

  // 2) BUSCAR SUB-USUARIOS
  if(searchForm) { // Verificar que el formulario existe
      // Búsqueda automática al escribir
      if(searchInput) {
        let searchTimeout = null;
        searchInput.addEventListener('input', function() {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            const q = searchInput.value.trim().toLowerCase();
            fetch(`/subusers/list_subusers_ajax?query=${encodeURIComponent(q)}`, {
              method:"GET",
              headers: { "X-CSRFToken": getCsrfToken() }
            })
            .then(r=>r.json())
            .then(data=>{
              if(data.status==="ok"){
                renderSubusers(data.subusers || []);
              } else {
                const errorP = document.createElement('p');
                errorP.classList.add('error-message-text');
                errorP.textContent = `Error: ${data.message}`;
                subusersContainer.innerHTML = '';
                subusersContainer.appendChild(errorP);
              }
            })
            .catch(err=>{
              const errorP = document.createElement('p');
              errorP.classList.add('error-message-text');
              errorP.textContent = `Error: ${err}`;
              subusersContainer.innerHTML = '';
              subusersContainer.appendChild(errorP);
            });
          }, 200);
        });
      }
      // Botón Limpiar
      const limpiarBtn = searchForm.querySelector('button[type="submit"]');
      if(limpiarBtn && searchInput) {
        limpiarBtn.type = 'button';
        limpiarBtn.textContent = 'Limpiar';
        limpiarBtn.addEventListener('click', function(e) {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
        });
      }
  } // Fin if (searchForm)

  // 3) CARGAR TODOS
  function loadAllSubusers(){
    fetch("/subusers/list_subusers_ajax", { 
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() }
    })
    .then(r=>r.json())
    .then(data=>{
      if(data.status==="ok"){
        renderSubusers(data.subusers || []);
      } else {
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error: ${data.message}`;
        subusersContainer.innerHTML = '';
        subusersContainer.appendChild(errorP);
      }
    })
    .catch(err=> { 
        console.error("Error cargando subusuarios:", err);
        const errorP = document.createElement('p');
        errorP.classList.add('error-message-text');
        errorP.textContent = `Error al cargar subusuarios: ${err}`;
        subusersContainer.innerHTML = '';
        subusersContainer.appendChild(errorP);
    });
  }

  // 4) RENDER SUB-USUARIOS
  function renderSubusers(subuserList) {
    if(!subusersContainer) return; // Salir si el contenedor no existe
    if(!subuserList.length){
      const p = document.createElement('p');
      p.textContent = "No hay sub-usuarios creados.";
      subusersContainer.innerHTML = '';
      subusersContainer.appendChild(p);
      return;
    }
    
    // Limpiar contenedor
    subusersContainer.innerHTML = '';
    
    subuserList.forEach(su => {
      const card = document.createElement('div');
      card.classList.add('subuser-card');
      
      const content = document.createElement('div');
      content.classList.add('subuser-card-content');
      
      const usernameDiv = document.createElement('div');
      usernameDiv.classList.add('subuser-card-username');
      usernameDiv.textContent = escapeHtml(su.username);
      content.appendChild(usernameDiv);
      
      const actionsDiv = document.createElement('div');
      actionsDiv.classList.add('subuser-card-actions');
      
      // Botón Editar
      const editBtn = document.createElement('button');
      editBtn.classList.add('btn-orange', 'edit-subuser-btn');
      editBtn.setAttribute('data-id', su.id);
      editBtn.textContent = 'Editar';
      actionsDiv.appendChild(editBtn);
      
      // Botón Toggle (On/Off)
      const toggleBtn = document.createElement('button');
      if(su.enabled){
        toggleBtn.classList.add('btn-red', 'toggle-subuser');
        toggleBtn.setAttribute('data-enabled', 'true');
        toggleBtn.textContent = 'Off';
      } else {
        toggleBtn.classList.add('btn-green', 'toggle-subuser');
        toggleBtn.setAttribute('data-enabled', 'false');
        toggleBtn.textContent = 'On';
      }
      toggleBtn.setAttribute('data-id', su.id);
      actionsDiv.appendChild(toggleBtn);
      
      // Botón Eliminar
      const deleteBtn = document.createElement('button');
      deleteBtn.classList.add('btn-red', 'delete-subuser');
      deleteBtn.setAttribute('data-id', su.id);
      deleteBtn.textContent = 'Eliminar';
      actionsDiv.appendChild(deleteBtn);
      
      content.appendChild(actionsDiv);
      card.appendChild(content);
      subusersContainer.appendChild(card);
    });
  }

  // 5) Delegación de eventos
  if(subusersContainer) { // Verificar que el contenedor existe
      subusersContainer.addEventListener("click", function(e) {
        const target = e.target; 

        // Toggle Subuser Enable/Disable
        if(target.classList.contains("toggle-subuser")) {
          e.preventDefault();
          const subId = target.getAttribute("data-id");
          const currEnabled = (target.getAttribute("data-enabled") === "true");
          fetch("/subusers/toggle_subuser_ajax", {
            method: "POST",
            headers: {
              "Content-Type":"application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({
              sub_id: parseInt(subId),
              currently_enabled: currEnabled
            })
          })
          .then(r => r.json())
          .then(data => {
            if(data.status === "ok") {
              renderSubusers(data.subusers || []); 
            } else {
              alert("Error al cambiar estado: " + data.message);
            }
          })
          .catch(err => {
            console.error("Error en toggle subuser:", err);
            alert("Error de red al cambiar estado.");
          });
        }

        // Delete Subuser
        if(target.classList.contains("delete-subuser")) {
          e.preventDefault();
          const subId = target.getAttribute("data-id");
          if(!confirm("¿Deseas eliminar este sub-usuario? Esta acción no se puede deshacer.")) return;

          fetch("/subusers/delete_subuser_ajax", {
            method: "POST",
            headers: {
              "Content-Type":"application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ subuser_id: parseInt(subId) })
          })
          .then(r => r.json())
          .then(data => {
            if(data.status === "ok") {
              renderSubusers(data.subusers || []);
            } else {
              alert("Error al eliminar: " + data.message);
            }
          })
          .catch(err => {
             console.error("Error en delete subuser:", err);
             alert("Error de red al eliminar.");
          });
        }

        // <<< --- AÑADIR MANEJO PARA BOTÓN EDITAR --- >>>
        if (target.classList.contains("edit-subuser-btn")) {
            e.preventDefault(); // Buena práctica, aunque aquí no es estrictamente necesario
            const subId = target.getAttribute("data-id");
            if (subId) {
                window.location.href = `/subusers/edit/${subId}`;
            } else {
                console.error("No se encontró data-id en el botón Editar");
            }
        }
        // <<< --- FIN MANEJO EDITAR --- >>>

      }); // Fin del event listener principal
  } // Fin if (subusersContainer)

  // ======= GESTIÓN DE CORREOS DEL USUARIO PRINCIPAL =======
  const subuserManagementContainer = document.getElementById("subuser-management-container");
  const currentUserId = subuserManagementContainer ? subuserManagementContainer.dataset.userId : null;

  if (!currentUserId) {
    console.warn("No se encontró user_id para gestión de correos");
  } else {
    // Variables de paginación
    let subuserCurrentPage = 1;
    let subuserCurrentPerPage = 20;

    // Elementos
    const subuserSearchEmailsForm = document.getElementById("searchSubuserEmailsForm");
    const subuserSearchEmailsInput = document.getElementById("searchSubuserEmailsInput");
    const subuserEmailsSearchResults = document.getElementById("subuserEmailsSearchResults");
    const subuserSearchStatus = document.getElementById("subuserSearchStatus");
    const subuserDeleteDisplayedBtn = document.getElementById("subuserDeleteDisplayedBtn");
    const subuserDeleteDisplayedContainer = document.getElementById("subuserDeleteDisplayedContainer");
    const subuserPerPageSelect = document.getElementById("subuserPerPageSelect");
    const subuserAllowedEmailsTextContainer = document.getElementById("subuserAllowedEmailsTextContainer");
    const subuserPaginationInfo = document.getElementById("subuserPaginationInfo");
    const subuserDeleteAllEmailsBtn = document.getElementById("subuserDeleteAllEmailsBtn");
    const subuserPrevPageBtn = document.getElementById("subuserPrevPageBtn");
    const subuserNextPageBtn = document.getElementById("subuserNextPageBtn");
    const subuserAddEmailsInput = document.getElementById("subuserAddEmailsInput");
    const subuserAddEmailsBtn = document.getElementById("subuserAddEmailsBtn");
    const subuserAddEmailsMsg = document.getElementById("subuserAddEmailsMsg");

    let subuserCurrentlyDisplayedEmails = [];

    // Función helper
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function handleFetchResponse(response) {
      if (!response.ok) {
        return response.json().then(errData => {
          throw new Error(errData.message || `Error del servidor: ${response.status}`);
        });
      }
      return response.json();
    }

    // Función para cargar correos
    function fetchSubuserAllowedEmails(page = 1, perPage = 20) {
      subuserCurrentPage = page;
      subuserCurrentPerPage = parseInt(perPage, 10) || 20;
      if (subuserCurrentPerPage === -1) {
        perPage = 999999;
      } else {
        perPage = subuserCurrentPerPage;
      }
      
      const url = `/subusers/list_current_user_emails_paginated?page=${page}&per_page=${perPage}`;
      
      if (subuserAllowedEmailsTextContainer) {
        const loadingP = document.createElement('p');
        loadingP.classList.add('text-secondary');
        loadingP.textContent = 'Cargando...';
        subuserAllowedEmailsTextContainer.innerHTML = '';
        subuserAllowedEmailsTextContainer.appendChild(loadingP);
      }
      
      fetch(url, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(handleFetchResponse)
      .then(data => {
        if (data.status === "ok") {
          if (subuserAllowedEmailsTextContainer) renderSubuserAllowedEmailsText(data.emails);
          if (subuserPaginationInfo) updateSubuserPaginationControls(data.pagination);
        } else {
          if (subuserAllowedEmailsTextContainer) {
            const errorP = document.createElement('p');
            errorP.classList.add('text-danger');
            errorP.textContent = `Error: ${data.message || 'No se pudieron cargar los correos.'}`;
            subuserAllowedEmailsTextContainer.innerHTML = '';
            subuserAllowedEmailsTextContainer.appendChild(errorP);
          }
        }
      })
      .catch(err => {
        console.error("Fetch error list emails:", err);
        if (subuserAllowedEmailsTextContainer) {
          const errorP = document.createElement('p');
          errorP.classList.add('text-danger');
          errorP.textContent = `Error al cargar correos: ${err.message}`;
          subuserAllowedEmailsTextContainer.innerHTML = '';
          subuserAllowedEmailsTextContainer.appendChild(errorP);
        }
      });
    }

    function renderSubuserAllowedEmailsText(emails) {
      if (!subuserAllowedEmailsTextContainer) return;
      if (!emails || emails.length === 0) {
        subuserAllowedEmailsTextContainer.textContent = "No hay correos permitidos asignados.";
        return;
      }
      subuserAllowedEmailsTextContainer.textContent = emails.join('\n');
    }

    function updateSubuserPaginationControls(pagination) {
      if (!pagination) return;

      if (subuserPaginationInfo) subuserPaginationInfo.textContent = `Página ${pagination.page} de ${pagination.total_pages}.`;

      if (subuserPrevPageBtn) subuserPrevPageBtn.disabled = !pagination.has_prev;
      if (subuserNextPageBtn) subuserNextPageBtn.disabled = !pagination.has_next;
      
      if (subuserDeleteAllEmailsBtn) {
        const totalItems = pagination.total_items || 0;
        if (totalItems > 0) {
          subuserDeleteAllEmailsBtn.textContent = `Eliminar Todos (${totalItems})`;
          subuserDeleteAllEmailsBtn.disabled = false;
          subuserDeleteAllEmailsBtn.classList.add('btn-inline-block');
        } else {
          subuserDeleteAllEmailsBtn.textContent = 'Eliminar Todos';
          subuserDeleteAllEmailsBtn.disabled = true;
        }
      }
      
      if (subuserPerPageSelect) {
        if (pagination.per_page >= 999999) {
          subuserPerPageSelect.value = "-1";
        } else {
          subuserPerPageSelect.value = pagination.per_page;
        }
      }
    }

    // Event listeners para paginación
    if (subuserPrevPageBtn) {
      subuserPrevPageBtn.addEventListener("click", () => {
        if (subuserCurrentPage > 1) fetchSubuserAllowedEmails(subuserCurrentPage - 1, subuserCurrentPerPage);
      });
    }
    if (subuserNextPageBtn) {
      subuserNextPageBtn.addEventListener("click", () => {
        fetchSubuserAllowedEmails(subuserCurrentPage + 1, subuserCurrentPerPage);
      });
    }
    if (subuserPerPageSelect) {
      subuserPerPageSelect.addEventListener("change", () => {
        const newPerPage = parseInt(subuserPerPageSelect.value, 10);
        fetchSubuserAllowedEmails(1, newPerPage);
      });
    }

    // Eliminar todos los correos
    if (subuserDeleteAllEmailsBtn) {
      subuserDeleteAllEmailsBtn.addEventListener("click", () => {
        if (!confirm("¿Seguro que quieres eliminar TODOS los correos permitidos para este usuario? Esta acción no se puede deshacer.")) {
          return;
        }
        
        fetch("/subusers/delete_all_current_user_emails_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({})
        })
        .then(handleFetchResponse)
        .then(data => {
          if (data.status === "ok") {
            alert(`${data.deleted_count || 0} correos eliminados.`);
            fetchSubuserAllowedEmails(1, subuserCurrentPerPage);
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

    // Búsqueda y eliminación de correos
    if (subuserSearchEmailsForm && subuserSearchEmailsInput && subuserEmailsSearchResults) {
      const clearSearchBtn = document.getElementById('clearSubuserSearchBtn');
      
      // Función para limpiar el campo de búsqueda
      function clearSearch() {
        subuserSearchEmailsInput.value = '';
        subuserSearchEmailsInput.dispatchEvent(new Event('input'));
        subuserEmailsSearchResults.innerHTML = '';
        subuserEmailsSearchResults.classList.add('hide-element');
        if (subuserSearchStatus) subuserSearchStatus.textContent = '';
        if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
        subuserCurrentlyDisplayedEmails = [];
        if (clearSearchBtn) clearSearchBtn.classList.remove('show');
      }
      
      // Mostrar/ocultar botón X según si hay texto
      if (subuserSearchEmailsInput && clearSearchBtn) {
        subuserSearchEmailsInput.addEventListener('input', function() {
          if (subuserSearchEmailsInput.value.trim()) {
            clearSearchBtn.classList.add('show');
          } else {
            clearSearchBtn.classList.remove('show');
          }
        });
        
        // Click en el botón X para limpiar
        clearSearchBtn.addEventListener('click', function(e) {
          e.preventDefault();
          clearSearch();
        });
      }

      subuserSearchEmailsForm.addEventListener("submit", function(e) {
        e.preventDefault();
        const searchText = subuserSearchEmailsInput.value.trim();
        if (!searchText) {
          renderSubuserEmailsResults([]);
          return;
        }

        fetch("/subusers/search_current_user_emails_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ search_text: searchText })
        })
        .then(handleFetchResponse)
        .then(data => {
          if (data.status === "ok") {
            subuserCurrentlyDisplayedEmails = data.emails || [];
            renderSubuserEmailsResults(subuserCurrentlyDisplayedEmails);
          } else {
            const errorP = document.createElement('p');
            errorP.classList.add('text-danger');
            errorP.textContent = `Error: ${data.message || 'Respuesta inválida'}`;
            subuserEmailsSearchResults.innerHTML = '';
            subuserEmailsSearchResults.appendChild(errorP);
            if (subuserSearchStatus) subuserSearchStatus.textContent = '';
            if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
          }
        })
        .catch(err => {
          console.error("Fetch error search:", err);
          const errorP = document.createElement('p');
          errorP.classList.add('text-danger');
          errorP.textContent = `Error al buscar: ${err.message}`;
          subuserEmailsSearchResults.innerHTML = '';
          subuserEmailsSearchResults.appendChild(errorP);
          if (subuserSearchStatus) subuserSearchStatus.textContent = '';
          if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
        });
      });
    }

    function renderSubuserEmailsResults(emails) {
      if (!subuserEmailsSearchResults) return;
      subuserEmailsSearchResults.innerHTML = '';
      if (!emails || emails.length === 0) {
        subuserEmailsSearchResults.classList.add('hide-element');
        if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
        return;
      }

      subuserEmailsSearchResults.classList.remove('hide-element');
      subuserEmailsSearchResults.classList.add('show-block');
      emails.forEach(email => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('search-result-item');
        
        const span = document.createElement('span');
        span.textContent = email;
        itemDiv.appendChild(span);
        
        const button = document.createElement('button');
        button.classList.add('delete-search-result-btn');
        button.setAttribute('data-email', email);
        button.setAttribute('title', 'Eliminar este correo');
        button.textContent = 'X';
        itemDiv.appendChild(button);
        
        subuserEmailsSearchResults.appendChild(itemDiv);
      });

      if (subuserDeleteDisplayedBtn && subuserDeleteDisplayedContainer) {
        subuserDeleteDisplayedBtn.textContent = `Eliminar ${emails.length} Mostrados`;
        subuserDeleteDisplayedContainer.classList.remove('d-none');
        subuserDeleteDisplayedBtn.disabled = false;
      }
    }

    if (subuserEmailsSearchResults) {
      subuserEmailsSearchResults.addEventListener("click", function(e) {
        if (e.target.classList.contains("delete-search-result-btn")) {
          e.preventDefault();
          const button = e.target;
          const emailToRemove = button.getAttribute("data-email");
          if (!emailToRemove || !confirm(`¿Eliminar ${emailToRemove}?`)) { return; }

          button.disabled = true;
          button.textContent = '...';

          fetch("/subusers/delete_current_user_email_ajax", {
            method: "POST",
            headers: {"Content-Type": "application/json", "X-CSRFToken": getCsrfToken()},
            body: JSON.stringify({ email: emailToRemove })
          })
          .then(handleFetchResponse)
          .then(data => {
            if (data.status === "ok") {
              button.closest('.search-result-item').remove();
              subuserCurrentlyDisplayedEmails = subuserCurrentlyDisplayedEmails.filter(email => email !== emailToRemove);
              if (subuserCurrentlyDisplayedEmails.length > 0) {
                if (subuserDeleteDisplayedBtn) subuserDeleteDisplayedBtn.textContent = `Eliminar ${subuserCurrentlyDisplayedEmails.length} Mostrados`;
                if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.remove('d-none');
              } else {
                subuserEmailsSearchResults.classList.add('hide-element');
                if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
              }
              fetchSubuserAllowedEmails(subuserCurrentPage, subuserCurrentPerPage);
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

    if (subuserDeleteDisplayedBtn) {
      subuserDeleteDisplayedBtn.addEventListener('click', function(e) {
        e.preventDefault();
        const emailsToDelete = subuserCurrentlyDisplayedEmails;

        if (!emailsToDelete || emailsToDelete.length === 0) { return; }
        if (!confirm(`¿Eliminar los ${emailsToDelete.length} correos mostrados?`)) { return; }

        subuserDeleteDisplayedBtn.disabled = true;
        subuserDeleteDisplayedBtn.textContent = 'Eliminando...';

        fetch("/subusers/delete_many_current_user_emails_ajax", {
          method: "POST",
          headers: {"Content-Type": "application/json", "X-CSRFToken": getCsrfToken()},
          body: JSON.stringify({ emails: emailsToDelete })
        })
        .then(handleFetchResponse)
        .then(data => {
          if (data.status === "ok") {
            if (subuserEmailsSearchResults) subuserEmailsSearchResults.innerHTML = "";
            if (subuserEmailsSearchResults) {
              subuserEmailsSearchResults.classList.remove('show-block');
              subuserEmailsSearchResults.classList.add('hide-element');
            }
            if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
            subuserCurrentlyDisplayedEmails = [];
            fetchSubuserAllowedEmails(subuserCurrentPage, subuserCurrentPerPage);
          } else {
            alert(`Error: ${data.message || 'Error desconocido'}`);
          }
        })
        .catch(err => {
          alert(`Error de red: ${err.message}`);
        })
        .finally(() => {
          subuserDeleteDisplayedBtn.disabled = false;
          subuserDeleteDisplayedBtn.textContent = 'Eliminar X Mostrados';
        });
      });
    }

    // Añadir correos
    if (subuserAddEmailsBtn && subuserAddEmailsInput && subuserAddEmailsMsg) {
      subuserAddEmailsBtn.addEventListener("click", function() {
        const rawText = subuserAddEmailsInput.value.trim();
        if (!rawText) {
          if (subuserAddEmailsMsg) { 
            subuserAddEmailsMsg.textContent = 'Campo vacío.'; 
            subuserAddEmailsMsg.classList.remove('text-color-green', 'text-color-red');
            subuserAddEmailsMsg.classList.add('text-color-orange'); 
          }
          return;
        }
        const emailsToAdd = rawText.split(/[\s,;\n]+/).map(e => e.trim().toLowerCase()).filter(e => e && e.includes('@'));
        if (!emailsToAdd.length) {
          if (subuserAddEmailsMsg) { 
            subuserAddEmailsMsg.textContent = 'No se encontraron correos válidos.'; 
            subuserAddEmailsMsg.classList.remove('text-color-green', 'text-color-red');
            subuserAddEmailsMsg.classList.add('text-color-orange'); 
          }
          return;
        }

        if (subuserAddEmailsMsg) { 
          subuserAddEmailsMsg.textContent = "Añadiendo..."; 
          subuserAddEmailsMsg.classList.remove('text-color-green', 'text-color-red');
          subuserAddEmailsMsg.classList.add('text-color-orange'); 
        }
        subuserAddEmailsBtn.disabled = true;

        fetch("/subusers/add_current_user_emails_ajax", {
          method: "POST",
          headers: {"Content-Type": "application/json", "X-CSRFToken": getCsrfToken()},
          body: JSON.stringify({ emails: emailsToAdd })
        })
        .then(handleFetchResponse)
        .then(data => {
          if (data.status === "ok") {
            if (subuserAddEmailsMsg) {
              subuserAddEmailsMsg.textContent = `${data.added_count || 0} añadidos, ${data.skipped_count || 0} omitidos. Recargando lista...`;
              subuserAddEmailsMsg.classList.remove('text-color-orange', 'text-color-red');
              subuserAddEmailsMsg.classList.add('text-color-green');
            }
            subuserAddEmailsInput.value = "";
            fetchSubuserAllowedEmails(1, subuserCurrentPerPage);
          } else {
            throw new Error(data.message || 'Error desconocido');
          }
        })
        .catch(err => {
          if (subuserAddEmailsMsg) { 
            subuserAddEmailsMsg.textContent = `Error: ${err.message}`; 
            subuserAddEmailsMsg.classList.remove('text-color-orange', 'text-color-green');
            subuserAddEmailsMsg.classList.add('text-color-red'); 
          }
        })
        .finally(() => {
          subuserAddEmailsBtn.disabled = false;
        });
      });
    }

    // Cargar correos al iniciar
    fetchSubuserAllowedEmails(1, subuserCurrentPerPage);
  }
  // ======= FIN GESTIÓN DE CORREOS DEL USUARIO PRINCIPAL =======

  // ======= ELIMINACIÓN MASIVA DE CORREOS DE TODOS LOS USUARIOS =======
  const bulkDeleteEmailsSubuserForm = document.getElementById("bulkDeleteEmailsSubuserForm");
  const bulkDeleteEmailsSubuserInput = document.getElementById("bulkDeleteEmailsSubuserInput");
  const bulkDeleteEmailsSubuserBtn = document.getElementById("bulkDeleteEmailsSubuserBtn");
  const bulkDeleteEmailsSubuserMessage = document.getElementById("bulkDeleteEmailsSubuserMessage");

  // Función para mostrar mensaje
  function showBulkDeleteSubuserMessage(message, isError = false) {
    if (!bulkDeleteEmailsSubuserMessage) return;
    
    bulkDeleteEmailsSubuserMessage.textContent = message;
    bulkDeleteEmailsSubuserMessage.className = `mt-05 text-center ${isError ? 'text-danger' : 'text-success'}`;
    bulkDeleteEmailsSubuserMessage.classList.remove('hide-element');
    bulkDeleteEmailsSubuserMessage.classList.add('show-block');
    
    // Ocultar mensaje después de 5 segundos si es éxito
    if (!isError) {
      setTimeout(() => {
        if (bulkDeleteEmailsSubuserMessage) {
          bulkDeleteEmailsSubuserMessage.classList.remove('show-block');
          bulkDeleteEmailsSubuserMessage.classList.add('hide-element');
        }
      }, 5000);
    }
  }

  // Manejar envío del formulario
  if (bulkDeleteEmailsSubuserForm && bulkDeleteEmailsSubuserInput && bulkDeleteEmailsSubuserBtn) {
    bulkDeleteEmailsSubuserForm.addEventListener("submit", function(e) {
      e.preventDefault();
      
      const text = bulkDeleteEmailsSubuserInput.value.trim();
      if (!text) {
        showBulkDeleteSubuserMessage("Por favor ingresa al menos un correo.", true);
        return;
      }

      const emailsToDelete = parseEmailsFromText(text);
      if (emailsToDelete.length === 0) {
        showBulkDeleteSubuserMessage("No se encontraron correos válidos en el texto ingresado.", true);
        return;
      }

      // Confirmar antes de eliminar
      if (!confirm(`¿Estás seguro de eliminar ${emailsToDelete.length} correo(s) de todos los usuarios?\n\nCorreos a eliminar:\n${emailsToDelete.join('\n')}`)) {
        return;
      }

      // Deshabilitar botón y mostrar estado de carga
      bulkDeleteEmailsSubuserBtn.disabled = true;
      bulkDeleteEmailsSubuserBtn.textContent = 'Eliminando...';
      bulkDeleteEmailsSubuserMessage.classList.remove('show-block');
      bulkDeleteEmailsSubuserMessage.classList.add('hide-element');

      // Enviar petición al servidor
      fetch("/subusers/delete_emails_from_all_users_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ emails: emailsToDelete })
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errData => {
            throw new Error(errData.message || `Error del servidor: ${response.status}`);
          });
        }
        return response.json();
      })
      .then(data => {
        if (data.status === "ok") {
          showBulkDeleteSubuserMessage(
            data.message || `Se eliminaron ${data.deleted_count || emailsToDelete.length} instancia(s) de correo(s) de todos los usuarios.`,
            false
          );
          bulkDeleteEmailsSubuserInput.value = ""; // Limpiar el campo
        } else {
          showBulkDeleteSubuserMessage(data.message || "Error desconocido al eliminar correos.", true);
        }
      })
      .catch(err => {
        console.error("Error al eliminar correos masivamente:", err);
        showBulkDeleteSubuserMessage(`Error: ${err.message}`, true);
      })
      .finally(() => {
        bulkDeleteEmailsSubuserBtn.disabled = false;
        bulkDeleteEmailsSubuserBtn.textContent = 'Eliminar Correos de Todos los Usuarios';
      });
    });
  }
  // ======= FIN ELIMINACIÓN MASIVA DE CORREOS =======

}); // Fin DOMContentLoaded 