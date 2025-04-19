// app/static/js/admin_services_list.js

document.addEventListener("DOMContentLoaded", function() {

  const serviceSearchForm = document.getElementById("serviceSearchForm");
  const serviceSearchInput = document.getElementById("serviceSearchInput");
  const serviceListContainer = document.getElementById("service-list");

  // Crear
  const createServiceBtn = document.getElementById("createServiceBtn");
  const newServiceName = document.getElementById("newServiceName");
  const newServiceColor = document.getElementById("newServiceColor");

  // Regex/Filter POPUP
  const popupRegex = document.getElementById("popupRegex");
  const regexSelect = document.getElementById("regexSelect");
  const regexLinkSaveBtn = document.getElementById("regexLinkSaveBtn");
  const regexLinkCancelBtn = document.getElementById("regexLinkCancelBtn");
  let currentServiceIdForRegex = null;

  const popupFilter = document.getElementById("popupFilter");
  const filterSelect = document.getElementById("filterSelect");
  const filterLinkSaveBtn = document.getElementById("filterLinkSaveBtn");
  const filterLinkCancelBtn = document.getElementById("filterLinkCancelBtn");
  let currentServiceIdForFilter = null;

  // Variables para recordar la selección anterior
  let lastSelectedRegexId = "";
  let lastSelectedFilterId = "";

  // IconGrid
  const iconGridOverlay = document.getElementById("iconGridOverlay");
  const iconGridDiv = document.getElementById("iconGrid");
  const closeIconGridBtn = document.getElementById("closeIconGridBtn");
  let currentServiceIdForIcons = null;

  if (closeIconGridBtn) {
    closeIconGridBtn.addEventListener("click", () => {
      if (iconGridOverlay) iconGridOverlay.style.display = "none";
      currentServiceIdForIcons = null;
    });
  }

  // ------------------ Icon Grid logic ------------------------
  function showIconGridForService(serviceId) {
    currentServiceIdForIcons = serviceId;
    if (!iconGridOverlay || !iconGridDiv) return;
    iconGridOverlay.style.display = "block";
    iconGridDiv.innerHTML = "";

    for (let i=1; i<=24; i++){
      const fileName = `stream${i}.png`;
      const div = document.createElement("div");
      div.style.width = "70px";
      div.style.height = "70px";
      div.style.border = "2px solid #ccc";
      div.style.borderRadius = "4px";
      div.style.background = "#f9f9f9";
      div.style.display = "flex";
      div.style.alignItems = "center";
      div.style.justifyContent = "center";
      div.style.cursor = "pointer";

      const img = document.createElement("img");
      img.src = decideIconPath(fileName);
      img.style.maxWidth = "60px";
      img.style.maxHeight = "60px";
      div.appendChild(img);

      div.addEventListener("click", () => {
        addServiceIcon(serviceId, fileName);
      });

      iconGridDiv.appendChild(div);
    }
  }

  function addServiceIcon(serviceId, iconName){
    const payload = { service_id: parseInt(serviceId), icon_name: iconName };
    fetch("/admin/create_service_icon_ajax", {
      method:"POST",
      headers:{
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify(payload)
    })
    .then(r=>r.json())
    .then(data=>{
      if (data.status==="ok"){
        alert("Icono agregado al servicio.");
        iconGridOverlay.style.display = "none";
        initServicesList();
      } else {
        alert("Error: " + data.message);
      }
    })
    .catch(err=>console.error("Error addServiceIcon:", err));
  }

  // ------------------ Búsqueda de servicios ------------------------
  if (serviceSearchForm && serviceSearchInput){
    serviceSearchForm.addEventListener("submit",(e)=>{
      e.preventDefault();
      const q = serviceSearchInput.value.trim();
      fetch(`/admin/search_services_ajax?query=${encodeURIComponent(q)}`,{
        method:"GET",
        headers:{ "X-CSRFToken": getCsrfToken() }
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          serviceListContainer.innerHTML = renderServiceItems(data.services);
        }
      })
      .catch(err=>console.error("Error searchServices:",err));
    });
  }

  // ------------------ Crear servicio ------------------------
  if (createServiceBtn){
    createServiceBtn.addEventListener("click",()=>{
      const n = newServiceName.value.trim();
      const c = newServiceColor.value.trim() || "#333";
      if(!n){
        alert("Ingresa un nombre para el servicio.");
        return;
      }
      const payload = { name:n, border_color:c };
      fetch("/admin/create_service_ajax",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          alert(data.message);
          newServiceName.value="";
          newServiceColor.value="#333";
          initServicesList();
        } else {
          alert("Error: "+data.message);
        }
      })
      .catch(err=>console.error("Error createService:", err));
    });
  }

  // ------------------ Vincular REGEX (botones "re") ------------------------
  if (regexLinkSaveBtn && regexLinkCancelBtn){
    regexLinkSaveBtn.addEventListener("click", ()=>{
      if(!currentServiceIdForRegex) return;
      lastSelectedRegexId = regexSelect.value;

      if(!lastSelectedRegexId){
        alert("No seleccionaste Regex.");
        popupRegex.style.display="none";
        currentServiceIdForRegex=null;
        return;
      }
      const payload = {
        service_id: parseInt(currentServiceIdForRegex),
        regex_id: parseInt(lastSelectedRegexId)
      };
      fetch("/admin/link_service_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          alert(data.message);
          popupRegex.style.display="none";
          currentServiceIdForRegex=null;
          initServicesList();
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err=>console.error("Error linkRegex:", err));
    });

    regexLinkCancelBtn.addEventListener("click", ()=>{
      popupRegex.style.display="none";
      currentServiceIdForRegex=null;
    });
  }

  // ------------------ Vincular FILTRO (botones "fi") ------------------------
  if (filterLinkSaveBtn && filterLinkCancelBtn){
    filterLinkSaveBtn.addEventListener("click", ()=>{
      if(!currentServiceIdForFilter) return;
      lastSelectedFilterId = filterSelect.value;

      if(!lastSelectedFilterId){
        alert("No seleccionaste Filtro.");
        popupFilter.style.display="none";
        currentServiceIdForFilter=null;
        return;
      }
      const payload = {
        service_id: parseInt(currentServiceIdForFilter),
        filter_id: parseInt(lastSelectedFilterId)
      };
      fetch("/admin/link_service_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          alert(data.message);
          popupFilter.style.display="none";
          currentServiceIdForFilter=null;
          initServicesList();
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err=>console.error("Error linkFilter:", err));
    });

    filterLinkCancelBtn.addEventListener("click", ()=>{
      popupFilter.style.display="none";
      currentServiceIdForFilter=null;
    });
  }

  // ------------------ Delegación de eventos en la lista ------------------------
  document.addEventListener("click", (e) => {

    // --- INICIO: Click en icono de color para ABRIR POPUP ---
    if (e.target.classList.contains("service-color-icon")) {
        const spanIcon = e.target;
        const serviceId = spanIcon.dataset.serviceId;
        const colorEditorPopup = document.getElementById(`color-editor-${serviceId}`);

        closeAllColorPopups();

        if (colorEditorPopup) {
            const rect = spanIcon.getBoundingClientRect();
            colorEditorPopup.style.top = `${window.scrollY + rect.bottom + 2}px`;
            colorEditorPopup.style.left = `${window.scrollX + rect.left}px`; 
            colorEditorPopup.style.display = 'block';

            const inputColor = colorEditorPopup.querySelector('.popup-color-picker');
            if (inputColor) {
                inputColor.value = spanIcon.dataset.currentColor; 
                inputColor.focus(); // Solo poner foco en el input
            }
        }
    }
    // --- FIN: Click en icono de color para ABRIR POPUP ---

    // --- INICIO: Click en GUARDAR color del POPUP (Sin cambios) ---
    else if (e.target.classList.contains("save-color-btn")) {
        const serviceId = e.target.dataset.serviceId;
        const colorEditorPopup = document.getElementById(`color-editor-${serviceId}`);
        if (colorEditorPopup) {
            const inputColor = colorEditorPopup.querySelector('.popup-color-picker');
            if (inputColor) {
                const newColor = inputColor.value;
                updateServiceColor(serviceId, newColor); // Llama a la función AJAX
                // Actualizar el span original inmediatamente
                const spanIcon = document.querySelector(`.service-color-icon[data-service-id="${serviceId}"]`);
                if (spanIcon) {
                    spanIcon.style.backgroundColor = newColor;
                    spanIcon.dataset.currentColor = newColor;
                }
            }
            colorEditorPopup.style.display = 'none'; // Ocultar popup
        }
    }
    // --- FIN: Click en GUARDAR color del POPUP ---

    // --- INICIO: Click en CANCELAR color del POPUP (Sin cambios) ---
    else if (e.target.classList.contains("cancel-color-btn")) {
        const serviceId = e.target.dataset.serviceId;
        const colorEditorPopup = document.getElementById(`color-editor-${serviceId}`);
        if (colorEditorPopup) {
            colorEditorPopup.style.display = 'none'; // Ocultar popup
        }
    }
    // --- FIN: Click en CANCELAR color del POPUP ---

     // --- INICIO: Click FUERA de los popups para cerrar (Sin cambios) ---
     else if (!e.target.closest('.color-editor-popup') && !e.target.classList.contains('service-color-icon')) {
        closeAllColorPopups();
    }
    // --- FIN: Click FUERA de los popups para cerrar ---

    // Eliminar servicio
    if(e.target.classList.contains("delete-service")){
      e.preventDefault();
      const sId=e.target.getAttribute("data-id");
      if(!confirm("¿Eliminar este servicio?")) return;
      fetch("/admin/delete_service_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ service_id: parseInt(sId) })
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          serviceListContainer.innerHTML=renderServiceItems(data.services);
        } else {
          alert("Error: "+data.message);
        }
      })
      .catch(err=>console.error("Error deleteService:", err));
    }

    // Botón cíclico (visibilidad)
    if(e.target.classList.contains("single-visibility-btn")){
      e.preventDefault();
      const sId = e.target.getAttribute("data-id");
      const cur = e.target.getAttribute("data-current-state") || "off";
      let next;
      // off -> on-no-usuarios -> on-usuarios -> off
      if(cur==="off") next="on-no-usuarios";
      else if(cur==="on-no-usuarios") next="on-usuarios";
      else next="off";
      toggleVisibility(sId, next);
    }

    // Edit => /admin/edit_service/<id>
    if(e.target.classList.contains("edit-service")){
      e.preventDefault();
      const sId=e.target.getAttribute("data-id");
      window.location.href=`/admin/edit_service/${sId}`;
    }

    // link-regex-service => abre popupRegex
    if(e.target.classList.contains("link-regex-service")){
      e.preventDefault();
      currentServiceIdForRegex = e.target.getAttribute("data-id");
      if (lastSelectedRegexId) {
        regexSelect.value = lastSelectedRegexId;
      }
      popupRegex.style.display="block";
    }

    // link-filter-service => abre popupFilter
    if(e.target.classList.contains("link-filter-service")){
      e.preventDefault();
      currentServiceIdForFilter = e.target.getAttribute("data-id");
      if (lastSelectedFilterId) {
        filterSelect.value = lastSelectedFilterId;
      }
      popupFilter.style.display="block";
    }

    // +Icon
    if(e.target.classList.contains("add-service-icon-btn")){
      e.preventDefault();
      const sId=e.target.getAttribute("data-id");
      showIconGridForService(sId);
    }

    // Eliminar ícono
    if(e.target.classList.contains("delete-service-icon")){
      e.preventDefault();
      const iconId = e.target.getAttribute("data-icon-id");
      if(!confirm("¿Eliminar este ícono del servicio?")) return;
      fetch("/admin/delete_service_icon_ajax", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ icon_id: parseInt(iconId) })
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          alert("Ícono eliminado.");
          serviceListContainer.innerHTML=renderServiceItems(data.services);
        } else {
          alert("Error: " + data.message);
        }
      })
      .catch(err=>console.error("Error deleteServiceIcon:", err));
    }
  });

  // ------------------ Funciones ------------------------

  // --- Función para cerrar todos los popups de color (Sin cambios) ---
  function closeAllColorPopups() {
    const popups = document.querySelectorAll('.color-editor-popup');
    popups.forEach(p => p.style.display = 'none');
  }

  // ------------------ Funciones: toggleVisibility, renderServiceItems etc. ------------------------
  function toggleVisibility(serviceId, newState){
    const payload = { service_id: parseInt(serviceId), new_state: newState };
    fetch("/admin/toggle_service_visibility_ajax", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify(payload)
    })
    .then(r=>r.json())
    .then(data=>{
      if(data.status==="ok"){
        serviceListContainer.innerHTML=renderServiceItems(data.services);
      } else {
        alert("Error: "+data.message);
      }
    })
    .catch(err=>console.error("Error toggleVisibility:", err));
  }

  function getStateStyle(mode){
    if(mode==="off"){
      return { background:"#f44336", text:"off" };
    }
    if(mode==="on-no-usuarios"){
      return { background:"#2196f3", text:"on-no-usuarios" };
    }
    // De lo contrario => on-usuarios
    return { background:"#4caf50", text:"on-usuarios" };
  }

  function renderServiceItems(services){
    let html = "";
    let popupsHtml = "";

    services.forEach(s => {
      const st = getStateStyle(s.visibility_mode);

      // --- HTML principal del servicio (Estructura ORIGINAL restaurada) ---
      html += `
        <div class="admin-card service-item-container" style="margin-bottom:1rem; position: relative;">
          <strong>${s.name}</strong>
          <span
            class="service-color-icon"
            data-service-id="${s.id}"
            data-current-color="${s.border_color || '#333333'}"
            title="Haz clic para cambiar color"
            style="display:inline-block; width:16px; height:16px; background-color:${s.border_color || '#333333'}; margin-left:0.5rem; cursor:pointer; vertical-align:middle; border: 1px solid #aaa; border-radius: 3px; box-shadow: inset 0 0 2px rgba(0,0,0,0.2);"
          ></span>
          <br>
          <div style="margin:0.5rem 0;">
            <!-- Posición -->
            <span style="color:#666; margin-right:0.6rem;">
              Pos: ${s.position}
            </span>
            <!-- Botón Visibilidad -->
            <button class="single-visibility-btn" data-id="${s.id}" data-current-state="${s.visibility_mode}" style="background:${st.background}; border:2px solid ${st.background}; color:#fff; margin-right:0.3rem; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer;">
              ${st.text}
            </button>
            <!-- Iconos del servicio (AHORA AQUÍ, después del botón de estado) -->
            ${s.service_icons && s.service_icons.length>0 ? s.service_icons.map(iconObj => `
              <span style="display:inline-block; margin-right:0.4rem; vertical-align:middle;">
                <img src="${decideIconPath(iconObj.icon_name)}" style="max-height:1.3em; border:1px solid #ccc; border-radius:4px; vertical-align:middle;">
                <button class="delete-service-icon" data-icon-id="${iconObj.id}" style="background:#f44336; border:2px solid #f44336; color:#fff; margin-left:0.2rem; padding:0 5px; border-radius:4px; cursor:pointer; vertical-align:middle;">X</button>
              </span>
            `).join('') : ''}
          </div>
          <!-- Bloque final de botones -->
          <div style="margin-top:0.5rem;">
      `;
        if (s.protected && s.name === "Pais Netflix") {
             html += `<button class="edit-service" data-id="${s.id}" style="background:#ffa726; border:2px solid #ffa726; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; margin-right:0.3rem;">Editar</button>
                      <button class="add-service-icon-btn" data-id="${s.id}" style="background:#9c27b0; border:2px solid #9c27b0; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; margin-right:0.3rem;">+Icon</button>`;
        } else {
             html += `<button class="edit-service" data-id="${s.id}" style="background:#ffa726; border:2px solid #ffa726; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; margin-right:0.3rem;">Editar</button>
                      <button class="link-regex-service" data-id="${s.id}" style="background:#2196f3; border:2px solid #2196f3; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; margin-right:0.3rem;">re</button>
                      <button class="link-filter-service" data-id="${s.id}" style="background:#2196f3; border:2px solid #2196f3; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; margin-right:0.3rem;">fi</button>
                      <button class="add-service-icon-btn" data-id="${s.id}" style="background:#9c27b0; border:2px solid #9c27b0; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; margin-right:0.3rem;">+Icon</button>
                      <button class="delete-service" data-id="${s.id}" style="background:#f44336; border:2px solid #f44336; color:#fff; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer;">Eliminar</button>`;
        }
        html += `
          </div> <!-- Cierre div botones -->
        </div> <!-- Cierre admin-card -->
        `;

      // --- HTML del Popup de edición de color (SIN CAMBIOS EN SU ESTRUCTURA INTERNA) ---
      popupsHtml += `
        <div id="color-editor-${s.id}" class="color-editor-popup" 
             style="display: none; position: absolute; z-index: 1000; background: #ffffff; border: 1px solid #adb5bd; border-radius: 6px; padding: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); width: auto; min-width: 160px;">
          <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #212529; font-weight: 500;">Color:</label>
          <input type="color" class="popup-color-picker" value="${s.border_color || '#333333'}" 
                 style="width: 100%; height: 35px; margin-bottom: 12px; cursor: pointer; border: 1px solid #ced4da; padding: 2px; border-radius: 4px;">
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button class="cancel-color-btn btn-red" data-service-id="${s.id}" style="padding: 5px 12px; font-size: 13px; border-radius: 4px;">Cancelar</button>
            <button class="save-color-btn btn-green" data-service-id="${s.id}" style="padding: 5px 12px; font-size: 13px; border-radius: 4px;">Guardar</button>
          </div>
        </div>
      `;
    }); // Fin del forEach(s => ...)

    // Devolver el HTML de los servicios y añadir los popups al final
    return html + popupsHtml;
  }

  /**
   * Carga la lista de Regex y Filtros para que los selects
   * re (regexSelect) y fi (filterSelect) funcionen al hacer clic
   */
  function loadRegexesAndFilters(){
    // Cargar Regex
    if (regexSelect) {
      regexSelect.innerHTML = "";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Ninguno";
      regexSelect.appendChild(none);

      fetch("/admin/list_regex_names", {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          data.regex.forEach(rx=>{
            const opt = document.createElement("option");
            opt.value = rx.id;
            opt.textContent = rx.description || rx.pattern;
            regexSelect.appendChild(opt);
          });
        }
      })
      .catch(err=>console.error("Error list_regex_names:", err));
    }

    // Cargar Filtros
    if (filterSelect) {
      filterSelect.innerHTML = "";
      const none2 = document.createElement("option");
      none2.value = "";
      none2.textContent = "Ninguno";
      filterSelect.appendChild(none2);

      fetch("/admin/list_filter_names", {
        method:"GET",
        headers:{ "X-CSRFToken": getCsrfToken() }
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          data.filters.forEach(ft=>{
            let label = ft.keyword || "(sin keyword)";
            if(ft.sender) label += ` / ${ft.sender}`;
            const opt = document.createElement("option");
            opt.value = ft.id;
            opt.textContent = label;
            filterSelect.appendChild(opt);
          });
        }
      })
      .catch(err=>console.error("Error list_filter_names:", err));
    }
  }

  function decideIconPath(fileName){
    if(fileName.toLowerCase().startsWith("gif")){
      return "/static/images/gifs/"+fileName;
    }
    return "/static/images/"+fileName;
  }

  function getCsrfToken(){
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function initServicesList(){
    fetch("/admin/search_services_ajax?query=", {
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() }
    })
    .then(r=>r.json())
    .then(data=>{
      if(data.status==="ok"){
        serviceListContainer.innerHTML = renderServiceItems(data.services);
      }
    })
    .catch(err=>console.error("Error initServicesList:", err));

    // Cargamos regex y filtros para que los selects "re" y "fi" funcionen.
    loadRegexesAndFilters();
  }

  // --- Función para actualizar color (Sin cambios) --- 
  function updateServiceColor(serviceId, newColor) {
    console.log(`Intentando actualizar servicio ${serviceId} al color ${newColor}`);
    const payload = { service_id: parseInt(serviceId), border_color: newColor };
    fetch("/admin/update_service_color_ajax", { // NUEVA RUTA
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        console.log("Color actualizado exitosamente en backend");
        // Opcional: pequeña notificación visual si se desea
        // El color visual del span se actualiza en el 'blur' listener
      } else {
        console.error("Error al actualizar color:", data.message);
        alert("Error al actualizar el color: " + data.message);
        // Podríamos intentar revertir el color visual si falla, 
        // pero por simplicidad, dejaremos que el blur lo actualice al valor que tenía el input
      }
    })
    .catch(err => {
        console.error("Error fetch updateServiceColor:", err);
        alert("Error de red al intentar actualizar el color.");
    });
  }

  // Iniciar
  initServicesList();
});
