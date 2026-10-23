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

    const editServiceAliasesContainer = document.getElementById("editServiceAliasesContainer");
    const editServiceDescripcionesCard = document.getElementById("editServiceDescripcionesCard");
    const editServiceConfirmOverlay = document.getElementById("editServiceConfirmOverlay");
    const editServiceConfirmPopup = document.getElementById("editServiceConfirmPopup");
    const editServiceConfirmCancelBtn = document.getElementById("editServiceConfirmCancelBtn");
    const editServiceConfirmAcceptBtn = document.getElementById("editServiceConfirmAcceptBtn");
    let pendingConfirmAction = null;
    let lastConfirmTrigger = null;

    function openEditServiceConfirm(onAccept, triggerEl) {
      pendingConfirmAction = typeof onAccept === "function" ? onAccept : null;
      lastConfirmTrigger =
        triggerEl && typeof triggerEl.focus === "function" ? triggerEl : null;
      if (editServiceConfirmOverlay) {
        editServiceConfirmOverlay.classList.remove("modal-hidden");
        editServiceConfirmOverlay.classList.add("modal-visible");
        editServiceConfirmOverlay.setAttribute("aria-hidden", "false");
        editServiceConfirmOverlay.removeAttribute("inert");
      }
      if (editServiceConfirmPopup) {
        editServiceConfirmPopup.classList.remove("modal-hidden");
        editServiceConfirmPopup.classList.add("modal-visible");
      }
      window.requestAnimationFrame(() => {
        if (editServiceConfirmCancelBtn) editServiceConfirmCancelBtn.focus();
      });
    }

    function closeEditServiceConfirm() {
      const action = pendingConfirmAction;
      const restoreFocusEl = lastConfirmTrigger;
      pendingConfirmAction = null;
      lastConfirmTrigger = null;

      const active = document.activeElement;
      if (
        active &&
        editServiceConfirmOverlay &&
        editServiceConfirmOverlay.contains(active)
      ) {
        active.blur();
      }

      if (editServiceConfirmOverlay) {
        editServiceConfirmOverlay.classList.add("modal-hidden");
        editServiceConfirmOverlay.classList.remove("modal-visible");
        editServiceConfirmOverlay.setAttribute("aria-hidden", "true");
        editServiceConfirmOverlay.setAttribute("inert", "");
      }
      if (editServiceConfirmPopup) {
        editServiceConfirmPopup.classList.add("modal-hidden");
        editServiceConfirmPopup.classList.remove("modal-visible");
      }

      if (restoreFocusEl && document.contains(restoreFocusEl)) {
        try {
          restoreFocusEl.focus({ preventScroll: true });
        } catch (err) {
          restoreFocusEl.focus();
        }
      }

      return action;
    }

    function requestEditServiceConfirm(onAccept, triggerEl) {
      openEditServiceConfirm(onAccept, triggerEl);
    }

    if (editServiceConfirmCancelBtn) {
      editServiceConfirmCancelBtn.addEventListener("click", () => {
        closeEditServiceConfirm();
      });
    }
    if (editServiceConfirmAcceptBtn) {
      editServiceConfirmAcceptBtn.addEventListener("click", () => {
        const action = closeEditServiceConfirm();
        if (action) action();
      });
    }
    if (editServiceConfirmOverlay) {
      editServiceConfirmOverlay.addEventListener("mousedown", (e) => {
        if (e.target === editServiceConfirmOverlay) closeEditServiceConfirm();
      });
    }

    function removeLinkedListItem(triggerBtn, listId, emptyMessage) {
      const li = triggerBtn && triggerBtn.closest(".edit-service-linked-item");
      if (li) li.remove();
      const list = document.getElementById(listId);
      if (list && !list.querySelector(".edit-service-linked-item")) {
        list.innerHTML = `<li>${emptyMessage}</li>`;
      }
    }

    function escapeHtml(text) {
      if (text == null) return "";
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function getCurrentEditServiceId() {
      if (editServiceDescripcionesCard && editServiceDescripcionesCard.dataset.serviceId) {
        return parseInt(editServiceDescripcionesCard.dataset.serviceId, 10);
      }
      const openBtn = document.querySelector(".open-alias-popup");
      if (openBtn && openBtn.getAttribute("data-service-id")) {
        return parseInt(openBtn.getAttribute("data-service-id"), 10);
      }
      return null;
    }

    function applyAliasBorders(root) {
      const scope = root || document;
      scope.querySelectorAll(".alias-list-item").forEach((item) => {
        const color = item.dataset.borderColor;
        if (color) {
          try {
            if (/^#[0-9A-Fa-f]{3,6}$/.test(color) || /^(rgb|rgba|hsl|hsla)\(/.test(color)) {
              item.style.setProperty("--alias-border-color", color);
            } else {
              item.style.setProperty("--alias-border-color", "#ccc");
            }
          } catch (e) {
            item.style.setProperty("--alias-border-color", "#ccc");
          }
        } else {
          item.style.setProperty("--alias-border-color", "#ccc");
        }
        item.classList.add("alias-item-border");
      });
    }

    function renderAliasIconsInline(aliasIcons) {
      if (!aliasIcons || !aliasIcons.length) return "";
      return aliasIcons
        .map(
          (ai) => `
                <span class="service-icon-wrapper">
                  <img src="${decideIconPath(ai.icon_name)}" alt="" class="service-icon-img">
                  <button type="button" class="delete-service-icon delete-service-icon-btn delete-alias-icon" data-icon-id="${ai.id}" title="Quitar icono" aria-label="Quitar icono">&times;</button>
                </span>
              `
        )
        .join("");
    }

    function renderDescriptionsList(aliases) {
      if (!editServiceAliasesContainer) return;
      if (!aliases || !aliases.length) {
        editServiceAliasesContainer.innerHTML =
          '<p class="edit-service-descripciones-empty text-center">(No hay descripciones creadas para este servicio)</p>';
        return;
      }
      let html = '<ul class="list-unstyled" id="editServiceAliasesList">';
      aliases.forEach((al) => {
        const borderColor = escapeHtml(al.alias_color || "#000000");
        const name = escapeHtml(al.alias_name || "");
        const iconsInlineHtml = renderAliasIconsInline(al.alias_icons);
        html += `
          <li class="alias-list-item alias-card" data-border-color="${borderColor}">
            <div><strong>${name}</strong></div>
            <div class="mt-075 alias-action-buttons">
              <button type="button" class="edit-alias-btn btn-small btn-edit-alias row-icon-btn btn-orange" data-alias-id="${al.id}" data-alias-name="${name}" data-alias-color="${borderColor}" title="Editar" aria-label="Editar"><i class="fas fa-pen" aria-hidden="true"></i></button>
              <button type="button" class="btn-panel btn-red btn-sm delete-alias-btn" data-alias-id="${al.id}" title="Eliminar">
                <i class="fas fa-trash"></i>
              </button>
              <button type="button" class="add-alias-icon-btn btn-small btn-add-icon" data-alias-id="${al.id}">+Icon</button>
              ${iconsInlineHtml ? `<span class="alias-attached-icons-inline">${iconsInlineHtml}</span>` : ""}
            </div>
          </li>
        `;
      });
      html += "</ul>";
      editServiceAliasesContainer.innerHTML = html;
      applyAliasBorders(editServiceAliasesContainer);
    }

    function updateDescriptionsFromServicesPayload(data) {
      if (!data || data.status !== "ok" || !Array.isArray(data.services)) return;
      const serviceId = getCurrentEditServiceId();
      if (!serviceId) return;
      const svc = data.services.find((s) => s.id === serviceId);
      renderDescriptionsList(svc ? svc.aliases || [] : []);
    }

    function closeAliasIconGrid() {
      if (aliasIconGridOverlay) aliasIconGridOverlay.classList.remove("popup-visible");
      const container = document.getElementById("aliasIconGridContainer");
      if (container) container.classList.remove("popup-visible");
      currentAliasIdForIcons = null;
    }
  
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
              if (aliasPopup) {
                aliasPopup.classList.remove("modal-visible");
                aliasPopup.classList.add("modal-hidden");
              }
              if (aliasNameInput) aliasNameInput.value = "";
              currentServiceIdForAlias=null;
              updateDescriptionsFromServicesPayload(data);
            } else {
              alert("Error: "+data.message);
            }
          })
          .catch(err=>{});
      });
      aliasCancelBtn.addEventListener("click",()=>{
        if (aliasPopup) {
          aliasPopup.classList.remove("modal-visible");
          aliasPopup.classList.add("modal-hidden");
        }
        if (aliasNameInput) aliasNameInput.value = ''; // Limpiar el campo
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
              if (editAliasPopup) {
                editAliasPopup.classList.remove("popup-visible");
                editAliasPopup.classList.add("modal-hidden");
              }
              if (editAliasName) editAliasName.value = "";
              updateDescriptionsFromServicesPayload(data);
            } else {
              alert("Error: "+data.message);
            }
          })
          .catch(err=>{});
      });
      editAliasCancelBtn.addEventListener("click",()=>{
        if (editAliasPopup) {
          editAliasPopup.classList.remove('popup-visible');
          editAliasPopup.classList.add('modal-hidden');
        }
        if (editAliasName) editAliasName.value = ''; // Limpiar el campo 
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
            updateDescriptionsFromServicesPayload(data);
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
        closeAliasIconGrid();
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
  
      for(let i=1;i<=41;i++){
        const fileName=`stream${i}.png`;
        const img=document.createElement("img");
        img.src=decideIconPath(fileName);
        img.alt=fileName;
        img.title=fileName;
        img.addEventListener("click",()=>{
          addAliasIcon(aliasId,fileName);
        });
        grid.appendChild(img);
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
            closeAliasIconGrid();
            updateDescriptionsFromServicesPayload(data);
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
            updateDescriptionsFromServicesPayload(data);
          } else {
            alert("Error: " + data.message);
          }
        })
        .catch(err=>{});
    }
  
    // UNLINK FILTER/REGEX
    function unlinkServiceFilter(serviceId, filterId, triggerBtn){
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
            removeLinkedListItem(
              triggerBtn,
              "editServiceFilterList",
              "(No hay filtros vinculados a este servicio)"
            );
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>{});
    }
    function unlinkServiceRegex(serviceId, regexId, triggerBtn){
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
            removeLinkedListItem(
              triggerBtn,
              "editServiceRegexList",
              "(No hay regex vinculados a este servicio)"
            );
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

        // Mostrar con clases CSS
        if(aliasPopup) { 
            aliasPopup.classList.remove("modal-hidden");
            aliasPopup.classList.add("modal-visible");
        }
      }
  
      // Edit alias
      if(e.target.classList.contains("edit-alias-btn") || e.target.closest(".edit-alias-btn")){
        e.preventDefault();
        const button = e.target.classList.contains("edit-alias-btn") ? e.target : e.target.closest(".edit-alias-btn");
        const aId = button.getAttribute("data-alias-id");
        const aName = button.getAttribute("data-alias-name");
        if(editAliasId) editAliasId.value=aId;
        if(editAliasName) editAliasName.value=aName;
        if(editAliasPopup) {
            editAliasPopup.classList.remove("modal-hidden");
            editAliasPopup.classList.add("popup-visible");
        }
      }
  
      // Delete alias
      if(e.target.classList.contains("delete-alias-btn") || e.target.closest(".delete-alias-btn")){
        e.preventDefault();
        const button = e.target.classList.contains("delete-alias-btn") ? e.target : e.target.closest(".delete-alias-btn");
        const aId = button.getAttribute("data-alias-id");
        requestEditServiceConfirm(() => deleteAlias(aId), button);
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
        requestEditServiceConfirm(() => deleteAliasIcon(iconId), button);
      }
  
      // Unlink filter
      if(e.target.classList.contains("unlink-filter-btn") || e.target.closest(".unlink-filter-btn")){
        e.preventDefault();
        const button = e.target.classList.contains("unlink-filter-btn") ? e.target : e.target.closest(".unlink-filter-btn");
        const sId=button.getAttribute("data-service-id");
        const fId=button.getAttribute("data-filter-id");
        requestEditServiceConfirm(() => unlinkServiceFilter(sId, fId, button), button);
      }
  
      // Unlink regex
      if(e.target.classList.contains("unlink-regex-btn") || e.target.closest(".unlink-regex-btn")){
        e.preventDefault();
        const button = e.target.classList.contains("unlink-regex-btn") ? e.target : e.target.closest(".unlink-regex-btn");
        const sId=button.getAttribute("data-service-id");
        const rId=button.getAttribute("data-regex-id");
        requestEditServiceConfirm(() => unlinkServiceRegex(sId, rId, button), button);
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

    applyAliasBorders(editServiceAliasesContainer || document);

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
      if (aliasPopup && aliasPopup.classList.contains('modal-visible') && !aliasPopup.contains(event.target) && !event.target.classList.contains('open-alias-popup')) {
        aliasPopup.classList.remove("modal-visible");
        aliasPopup.classList.add("modal-hidden");
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
  