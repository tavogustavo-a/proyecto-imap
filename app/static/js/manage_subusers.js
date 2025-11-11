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

}); // Fin DOMContentLoaded 