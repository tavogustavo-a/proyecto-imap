document.addEventListener("DOMContentLoaded", function() {
  function getCsrfToken(){
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
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
                subusersContainer.innerHTML = `<p style="color:red;">Error: ${data.message}</p>`;
              }
            })
            .catch(err=>{
              subusersContainer.innerHTML = `<p style=\"color:red;\">Error: ${err}</p>`;
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
        subusersContainer.innerHTML = `<p style="color:red;">Error: ${data.message}</p>`;
      }
    })
    .catch(err=> { 
        console.error("Error cargando subusuarios:", err);
        subusersContainer.innerHTML = `<p style="color:red;">Error al cargar subusuarios: ${err}</p>`;
    });
  }

  // 4) RENDER SUB-USUARIOS
  function renderSubusers(subuserList) {
    if(!subusersContainer) return; // Salir si el contenedor no existe
    if(!subuserList.length){
      subusersContainer.innerHTML = "<p>No hay sub-usuarios creados.</p>";
      return;
    }
    let html = "";
    
    subuserList.forEach(su => {
      html += `
        <div class="subuser-card">
          <div class="subuser-card-content">
            <div class="subuser-card-username">${su.username}</div>
            <div class="subuser-card-actions">
              <button
                class="btn-orange edit-subuser-btn"
                data-id="${su.id}"
              >
                Editar
              </button>
              `;
      if(su.enabled){
        html += `
              <button
                class="btn-red toggle-subuser"
                data-id="${su.id}"
                data-enabled="true"
              >
                Off
              </button>
        `;
      } else {
        html += `
              <button
                class="btn-green toggle-subuser"
                data-id="${su.id}"
                data-enabled="false"
              >
                On
              </button>
        `;
      }
      html += `
              <button
                class="btn-red delete-subuser"
                data-id="${su.id}"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      `;
    });
    subusersContainer.innerHTML = html;
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
      
      if (subuserAllowedEmailsTextContainer) subuserAllowedEmailsTextContainer.innerHTML = "<p class='text-secondary'>Cargando...</p>";
      
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
          if (subuserAllowedEmailsTextContainer) subuserAllowedEmailsTextContainer.innerHTML = `<p class='text-danger'>Error: ${data.message || 'No se pudieron cargar los correos.'}</p>`;
        }
      })
      .catch(err => {
        console.error("Fetch error list emails:", err);
        if (subuserAllowedEmailsTextContainer) subuserAllowedEmailsTextContainer.innerHTML = `<p class='text-danger'>Error al cargar correos: ${err.message}</p>`;
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
          subuserDeleteAllEmailsBtn.style.display = 'inline-block';
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
      const limpiarBtn = subuserSearchEmailsForm.querySelector('button[type="submit"]');
      if (limpiarBtn) {
        limpiarBtn.type = 'button';
        limpiarBtn.addEventListener('click', function(e) {
          subuserSearchEmailsInput.value = '';
          subuserEmailsSearchResults.innerHTML = '';
          subuserEmailsSearchResults.style.display = 'none';
          if (subuserSearchStatus) subuserSearchStatus.textContent = '';
          if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
          subuserCurrentlyDisplayedEmails = [];
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
            subuserEmailsSearchResults.innerHTML = `<p class='text-danger'>Error: ${data.message || 'Respuesta inválida'}</p>`;
            if (subuserSearchStatus) subuserSearchStatus.textContent = '';
            if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
          }
        })
        .catch(err => {
          console.error("Fetch error search:", err);
          subuserEmailsSearchResults.innerHTML = `<p class='text-danger'>Error al buscar: ${err.message}</p>`;
          if (subuserSearchStatus) subuserSearchStatus.textContent = '';
          if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
        });
      });
    }

    function renderSubuserEmailsResults(emails) {
      if (!subuserEmailsSearchResults) return;
      subuserEmailsSearchResults.innerHTML = '';
      if (!emails || emails.length === 0) {
        subuserEmailsSearchResults.style.display = 'none';
        if (subuserDeleteDisplayedContainer) subuserDeleteDisplayedContainer.classList.add('d-none');
        return;
      }

      subuserEmailsSearchResults.style.display = 'block';
      emails.forEach(email => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('search-result-item');
        itemDiv.innerHTML = `
          <span>${escapeHtml(email)}</span>
          <button class="delete-search-result-btn" data-email="${escapeHtml(email)}" title="Eliminar este correo">X</button>
        `;
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
                subuserEmailsSearchResults.style.display = 'none';
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
            if (subuserEmailsSearchResults) subuserEmailsSearchResults.style.display = 'none';
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
          if (subuserAddEmailsMsg) { subuserAddEmailsMsg.textContent = 'Campo vacío.'; subuserAddEmailsMsg.style.color = 'orange'; }
          return;
        }
        const emailsToAdd = rawText.split(/[\s,;\n]+/).map(e => e.trim().toLowerCase()).filter(e => e && e.includes('@'));
        if (!emailsToAdd.length) {
          if (subuserAddEmailsMsg) { subuserAddEmailsMsg.textContent = 'No se encontraron correos válidos.'; subuserAddEmailsMsg.style.color = 'orange'; }
          return;
        }

        if (subuserAddEmailsMsg) { subuserAddEmailsMsg.textContent = "Añadiendo..."; subuserAddEmailsMsg.style.color = "orange"; }
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
              subuserAddEmailsMsg.style.color = "green";
            }
            subuserAddEmailsInput.value = "";
            fetchSubuserAllowedEmails(1, subuserCurrentPerPage);
          } else {
            throw new Error(data.message || 'Error desconocido');
          }
        })
        .catch(err => {
          if (subuserAddEmailsMsg) { subuserAddEmailsMsg.textContent = `Error: ${err.message}`; subuserAddEmailsMsg.style.color = "red"; }
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

}); // Fin DOMContentLoaded 