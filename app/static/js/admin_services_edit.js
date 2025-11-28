// app/static/js/admin_services_edit.js

document.addEventListener("DOMContentLoaded", function() {
    // ALIAS
    let currentServiceIdForAlias=null;
    const aliasPopup=document.getElementById("aliasPopup");
    const aliasNameInput=document.getElementById("aliasNameInput");
    const aliasCreateBtn=document.getElementById("aliasCreateBtn");
    const aliasCancelBtn=document.getElementById("aliasCancelBtn");
  
    const editAliasPopup=document.getElementById("editAliasPopup");
    const editAliasId=document.getElementById("editAliasId");
    const editAliasName=document.getElementById("editAliasName");
    const editAliasSaveBtn=document.getElementById("editAliasSaveBtn");
    const editAliasCancelBtn=document.getElementById("editAliasCancelBtn");
  
    // Los colores de servicios ahora se manejan en la plantilla services.html 
  
    // Los colores de alias ahora se manejan centralmente en services.html

    // Las vistas previas de colores de servicios se manejan en services.html
  
    if(aliasCreateBtn && aliasCancelBtn && aliasPopup){
      aliasCreateBtn.addEventListener("click",()=>{
        if(!currentServiceIdForAlias) {
            return;
        }
        const n = aliasNameInput ? aliasNameInput.value.trim() : '';
        if(!n){
          alert("Alias vacío.");
          return;
        }
        const payload={
          service_id:parseInt(currentServiceIdForAlias),
          alias_name:n
          // El color se usa el predeterminado del backend (#000000)
        };
        fetch("/admin/create_alias_ajax",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "X-CSRFToken":getCsrfToken()
          },
          body:JSON.stringify(payload)
        })
          .then(r=>r.json())
          .then(data=>{
            if(data.status==="ok"){
              if (aliasPopup) aliasPopup.style.display = 'none'; 
              currentServiceIdForAlias=null;
              location.reload();
            } else {
              alert("Error: "+data.message);
            }
          })
          .catch(err=>{});
      });
      aliasCancelBtn.addEventListener("click",()=>{
        if (aliasPopup) aliasPopup.style.display = 'none'; 
        currentServiceIdForAlias=null;
      });
    }
  
    if(editAliasSaveBtn && editAliasCancelBtn && editAliasPopup){
      editAliasSaveBtn.addEventListener("click",()=>{
        const aId=editAliasId.value.trim();
        const aName=editAliasName.value.trim();
        if(!aId || !aName){
          alert("Faltan datos del alias");
          return;
        }
        const payload={
          alias_id:parseInt(aId),
          alias_name:aName
          // El color se mantiene el que ya tiene el alias
        };
        fetch("/admin/update_alias_ajax",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "X-CSRFToken":getCsrfToken()
          },
          body:JSON.stringify(payload)
        })
          .then(r=>r.json())
          .then(data=>{
            if(data.status==="ok"){
              if (editAliasPopup) editAliasPopup.classList.remove('popup-visible'); 
              location.reload();
            } else {
              alert("Error: "+data.message);
            }
          })
          .catch(err=>{});
      });
      editAliasCancelBtn.addEventListener("click",()=>{
        if (editAliasPopup) editAliasPopup.classList.remove('popup-visible'); 
      });
    }
  
    function deleteAlias(aliasId){
      const payload={ alias_id:parseInt(aliasId) };
      fetch("/admin/delete_alias_ajax",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken":getCsrfToken()
        },
        body:JSON.stringify(payload)
      })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
                  .catch(err=>{});
    }
  
    // ALIAS ICONS
    let currentAliasIdForIcons=null;
    const aliasIconGridOverlay=document.getElementById("aliasIconGridOverlay");
    const aliasIconGrid=document.getElementById("aliasIconGrid");
    const closeAliasIconGridBtn=document.getElementById("closeAliasIconGridBtn");
  
    if(closeAliasIconGridBtn){
      closeAliasIconGridBtn.addEventListener("click",()=>{
        if(aliasIconGridOverlay) aliasIconGridOverlay.classList.remove('popup-visible'); 
        const container = document.getElementById("aliasIconGridContainer");
        if (container) container.classList.remove('popup-visible'); 
        currentAliasIdForIcons=null;
      });
    }
  
    function showAliasIconGrid(aliasId){
      currentAliasIdForIcons = aliasId;
      const overlay = document.getElementById("aliasIconGridOverlay");
      const grid = document.getElementById("aliasIconGrid");
      const container = document.getElementById("aliasIconGridContainer");
  
      if(!overlay || !grid || !container) {
          return;
      } 
      
      overlay.classList.add('popup-visible'); 
      container.classList.add('popup-visible'); 
      grid.innerHTML = "";
  
      for(let i=1;i<=32;i++){
        const fileName=`stream${i}.png`;
        const div=document.createElement("div");
        div.style.width="70px";
        div.style.height="70px";
        div.style.border="2px solid #ccc";
        div.style.borderRadius="4px";
        div.style.background="#f9f9f9";
        div.style.display="flex";
        div.style.alignItems="center";
        div.style.justifyContent="center";
        div.style.cursor="pointer";
  
        const img=document.createElement("img");
        img.src=decideIconPath(fileName);
        img.style.maxWidth="60px";
        img.style.maxHeight="60px";
        div.appendChild(img);
  
        div.addEventListener("click",()=>{
          addAliasIcon(aliasId,fileName);
        });
  
        grid.appendChild(div);
      }
    }
  
    function addAliasIcon(aliasId, iconName){
      const payload={ alias_id: parseInt(aliasId), icon_name: iconName };
      fetch("/admin/create_alias_icon_ajax",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken":getCsrfToken()
        },
        body:JSON.stringify(payload)
      })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            aliasIconGridOverlay.classList.remove('popup-visible');
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>{});
    }
  
    // Eliminar ícono de alias
    function deleteAliasIcon(iconId){
      const payload = { icon_id: parseInt(iconId) };
      fetch("/admin/delete_alias_icon_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken":getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            location.reload();
          } else {
            alert("Error: " + data.message);
          }
        })
        .catch(err=>{});
    }
  
    // UNLINK FILTER/REGEX
    function unlinkServiceFilter(serviceId, filterId){
      const payload={ service_id: parseInt(serviceId), filter_id:parseInt(filterId) };
      fetch("/admin/unlink_service_ajax",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken":getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>{});
    }
    function unlinkServiceRegex(serviceId, regexId){
      const payload={ service_id: parseInt(serviceId), regex_id: parseInt(regexId) };
      fetch("/admin/unlink_service_ajax",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken":getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>{});
    }
  
    document.addEventListener("click",(e)=>{
      // +Alias
      if(e.target.classList.contains("open-alias-popup")){
        e.preventDefault();
        currentServiceIdForAlias = e.target.getAttribute("data-service-id");
        if(aliasNameInput) aliasNameInput.value="";

        // Mostrar con style.display = 'block'
        if(aliasPopup) { 
            aliasPopup.style.display = 'block'; 
        }
      }
  
      // Edit alias
      if(e.target.classList.contains("edit-alias-btn")){
        e.preventDefault();
        const aId=e.target.getAttribute("data-alias-id");
        const aName=e.target.getAttribute("data-alias-name");
        if(editAliasId) editAliasId.value=aId;
        if(editAliasName) editAliasName.value=aName;
        if(editAliasPopup) { 
            editAliasPopup.classList.add('popup-visible'); 
        }
      }
  
      // Delete alias
      if(e.target.classList.contains("delete-alias-btn") || e.target.closest(".delete-alias-btn")){
        e.preventDefault();
        const button = e.target.classList.contains("delete-alias-btn") ? e.target : e.target.closest(".delete-alias-btn");
        const aId = button.getAttribute("data-alias-id");
        if(!confirm("¿Eliminar alias?"))return;
        deleteAlias(aId);
      }
  
      // +Icon alias => mini-grid
      if(e.target.classList.contains("add-alias-icon-btn")){
        e.preventDefault();
        const aliasId = e.target.getAttribute("data-alias-id");
        showAliasIconGrid(aliasId);
      }
  
      // Eliminar ícono de alias
      if(e.target.classList.contains("delete-alias-icon") || e.target.closest(".delete-alias-icon")){
        e.preventDefault();
        const button = e.target.classList.contains("delete-alias-icon") ? e.target : e.target.closest(".delete-alias-icon");
        const iconId = button.getAttribute("data-icon-id");
        deleteAliasIcon(iconId);
      }
  
      // Unlink filter
      if(e.target.classList.contains("unlink-filter-btn")){
        e.preventDefault();
        const sId=e.target.getAttribute("data-service-id");
        const fId=e.target.getAttribute("data-filter-id");
        unlinkServiceFilter(sId,fId);
      }
  
      // Unlink regex
      if(e.target.classList.contains("unlink-regex-btn")){
        e.preventDefault();
        const sId=e.target.getAttribute("data-service-id");
        const rId=e.target.getAttribute("data-regex-id");
        unlinkServiceRegex(sId,rId);
      }
    });
  
    function decideIconPath(fileName){
      if (!fileName) return ''; // Validación adicional
      const lower = fileName.toLowerCase();
      if (lower.startsWith("gif")) {
        return "/static/images/gifs/" + fileName;
      }
      return "/static/images/" + fileName;
    }
    function getCsrfToken() {
      const csrfMeta = document.querySelector('meta[name="csrf_token"]');
      return csrfMeta ? csrfMeta.getAttribute("content") : "";
    }

    // --- Selectores Botones Navegación --- 
    const btnVolver = document.getElementById("btnVolverEditSrv");
    const btnCancelar = document.getElementById("btnCancelarEditSrv");

    // --- Helper Navegación --- 
    function navigateToUrl(button) {
        if (button) {
            const url = button.dataset.url;
            if (url) {
                window.location.href = url;
            }
        }
    }

    // --- Listeners Navegación --- 
    if(btnVolver) btnVolver.addEventListener("click", () => navigateToUrl(btnVolver));
    if(btnCancelar) btnCancelar.addEventListener("click", () => navigateToUrl(btnCancelar));

    // --- Aplicar borde de color dinámico a alias --- 
    const aliasListItems = document.querySelectorAll(".alias-list-item");
    aliasListItems.forEach(item => {
        const color = item.dataset.borderColor;
        if (color) {
            try {
                if (/^#[0-9A-Fa-f]{3,6}$/.test(color) || /^(rgb|rgba|hsl|hsla)\(/.test(color)) {
                   item.style.borderLeft = `4px solid ${color}`;
                } else {
                   item.style.borderLeft = `4px solid #ccc`; // Fallback
                }
            } catch (e) {
                item.style.borderLeft = `4px solid #ccc`; // Fallback
            }
        } else {
            item.style.borderLeft = `4px solid #ccc`; // Fallback si no hay data
        }
    });
    // --- Fin aplicar borde --- 

    // --- Cerrar popups al hacer clic fuera ---
    document.addEventListener('mousedown', function(event) {
      // Alias Icon Grid
      const aliasIconGridContainer = document.getElementById('aliasIconGridContainer');
      if (aliasIconGridOverlay && aliasIconGridOverlay.classList.contains('popup-visible') && aliasIconGridContainer && aliasIconGridContainer.classList.contains('popup-visible') && !aliasIconGridContainer.contains(event.target) && !event.target.classList.contains('add-alias-icon-btn')) {
        aliasIconGridOverlay.classList.remove('popup-visible');
        aliasIconGridContainer.classList.remove('popup-visible');
        currentAliasIdForIcons = null;
      }
      // Edit Alias Popup
      if (editAliasPopup && editAliasPopup.classList.contains('popup-visible') && !editAliasPopup.contains(event.target) && !event.target.classList.contains('edit-alias-btn')) {
        editAliasPopup.classList.remove('popup-visible');
      }
      // Alias Popup
      if (aliasPopup && aliasPopup.style.display === 'block' && !aliasPopup.contains(event.target) && !event.target.classList.contains('open-alias-popup')) {
        aliasPopup.style.display = 'none';
        currentServiceIdForAlias = null;
      }
    });

    // Validación de conflictos de visibilidad
    const visibilitySelect = document.getElementById("visibility_mode_select");
    if (visibilitySelect) {
        visibilitySelect.addEventListener("change", function() {
            const selectedValue = this.value;
            
            if (selectedValue === "on-no-usuarios-no-visible") {
                // Verificar conflictos: no puede coexistir con on-no-usuarios
                checkVisibilityConflict("on-no-usuarios", "on-no-usuarios-no-visible");
                // Verificar unicidad: solo puede haber uno con on-no-usuarios-no-visible
                checkVisibilityUniqueness("on-no-usuarios-no-visible");
            } else if (selectedValue === "on-no-usuarios") {
                // Verificar si hay servicios con on-no-usuarios-no-visible activos
                checkVisibilityConflict("on-no-usuarios-no-visible", "on-no-usuarios");
            } else if (selectedValue === "codigos-2") {
                // Verificar unicidad: solo puede haber uno con codigos-2
                checkVisibilityUniqueness("codigos-2");
            } else if (selectedValue === "sms") {
                // Verificar unicidad: solo puede haber uno con sms
                checkVisibilityUniqueness("sms");
            }
        });
    }
    
    function checkVisibilityConflict(conflictMode, currentMode) {
        fetch("/admin/check_visibility_conflict_ajax", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ 
                conflict_mode: conflictMode,
                current_service_id: window.location.pathname.split('/').pop() // Obtener ID del servicio actual
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.status === "conflict") {
                alert(`❌ Error: No puedes activar '${currentMode}' porque hay servicios con '${conflictMode}' activos.\n\nServicios en conflicto: ${data.conflicting_services.join(', ')}\n\nCambia primero esos servicios a 'off' antes de continuar.`);
                
                // Revertir la selección
                visibilitySelect.value = visibilitySelect.dataset.originalValue || "off";
            } else {
                // Guardar el valor actual como válido
                visibilitySelect.dataset.originalValue = visibilitySelect.value;
            }
        })
        .catch(err => {
            console.error("Error verificando conflicto de visibilidad:", err);
            alert("Error verificando conflicto de visibilidad. Inténtalo de nuevo.");
            visibilitySelect.value = visibilitySelect.dataset.originalValue || "off";
        });
    }
    
    function checkVisibilityUniqueness(mode) {
        fetch("/admin/check_visibility_uniqueness_ajax", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ 
                mode: mode,
                current_service_id: window.location.pathname.split('/').pop()
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.status === "duplicate") {
                alert(`❌ Error: Solo puede haber un servicio con modo '${mode}' activo.\n\nServicio existente: ${data.existing_service}\n\nCambia primero ese servicio a otro modo antes de continuar.`);
                
                // Revertir la selección
                visibilitySelect.value = visibilitySelect.dataset.originalValue || "off";
            } else {
                // Guardar el valor actual como válido
                visibilitySelect.dataset.originalValue = visibilitySelect.value;
            }
        })
        .catch(err => {
            console.error("Error verificando unicidad de visibilidad:", err);
            alert("Error verificando unicidad de visibilidad. Inténtalo de nuevo.");
            visibilitySelect.value = visibilitySelect.dataset.originalValue || "off";
        });
    }
    
    // Guardar valor inicial
    if (visibilitySelect) {
        visibilitySelect.dataset.originalValue = visibilitySelect.value;
    }

});
  