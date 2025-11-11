// app/static/js/admin_services_list.js

document.addEventListener("DOMContentLoaded", function() {

  const serviceSearchForm = document.getElementById("serviceSearchForm");
  const serviceSearchInput = document.getElementById("serviceSearchInput");
  const serviceListContainer = document.getElementById("service-list");

  // Crear
  const createServiceBtn = document.getElementById("createServiceBtn");
  const newServiceName = document.getElementById("newServiceName");
  
  // Campos de clic
  const newClickColor1 = document.getElementById("newClickColor1");
  const newClickColor2 = document.getElementById("newClickColor2");
  const clickGradientPreview = document.getElementById("clickGradientPreview");
  
  // Campos sin darle clic (normales)
  const newNormalColor1 = document.getElementById("newNormalColor1");
  const newNormalColor2 = document.getElementById("newNormalColor2");
  const normalGradientPreview = document.getElementById("normalGradientPreview");
  
  // Campos de alias
  const newAliasColor1 = document.getElementById("newAliasColor1");
  const newAliasColor2 = document.getElementById("newAliasColor2");
  const aliasGradientPreview = document.getElementById("aliasGradientPreview");
  
  // Botones de restablecer
  const resetClickColorsBtn = document.getElementById("resetClickColorsBtn");
  const resetNormalColorsBtn = document.getElementById("resetNormalColorsBtn");
  const resetAliasColorsBtn = document.getElementById("resetAliasColorsBtn");
  
  // Botones de guardar y cancelar
  const saveAliasColorsBtn = document.getElementById("saveAliasColorsBtn");
  const cancelAliasColorsBtn = document.getElementById("cancelAliasColorsBtn");
  const saveClickColorsBtn = document.getElementById("saveClickColorsBtn");
  const cancelClickColorsBtn = document.getElementById("cancelClickColorsBtn");
  const saveNormalColorsBtn = document.getElementById("saveNormalColorsBtn");
  const cancelNormalColorsBtn = document.getElementById("cancelNormalColorsBtn");

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
  
  // Variables para almacenar colores originales (para cancelar)
  let originalAliasColors = { color1: "#000000", color2: "#000000" };
  let originalClickColors = { color1: "#031faa", color2: "#031faa" };
  let originalNormalColors = { color1: "#764ba2", color2: "#667eea" };

  // Función para actualizar la vista previa del degradado (ya no se usa en crear servicio)
  function updateGradientPreview() {
    // Esta función ya no es necesaria para crear servicios
    // Los colores se manejan en las secciones superiores
  }

  // Función para actualizar la vista previa del degradado de clic
  function updateClickGradientPreview() {
    if (clickGradientPreview && newClickColor1 && newClickColor2) {
      const color1 = newClickColor1.value || "#031faa";
      const color2 = newClickColor2.value || "#031faa";
      clickGradientPreview.style.background = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;
      
      // Sincronizar automáticamente con Pais Netflix
      syncNetflixColors();
    }
  }

  // Función para actualizar la vista previa del degradado normal
  function updateNormalGradientPreview() {
    if (normalGradientPreview && newNormalColor1 && newNormalColor2) {
      const color1 = newNormalColor1.value || "#764ba2";
      const color2 = newNormalColor2.value || "#667eea";
      normalGradientPreview.style.background = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;
      
      // Sincronizar automáticamente con Pais Netflix
      syncNetflixColors();
    }
  }

  // Función para actualizar la vista previa del degradado de alias
  function updateAliasGradientPreview() {
    if (aliasGradientPreview && newAliasColor1 && newAliasColor2) {
      const color1 = newAliasColor1.value || "#000000";
      const color2 = newAliasColor2.value || "#000000";
      aliasGradientPreview.style.background = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;
    }
  }

  // Event listeners para actualizar la vista previa en tiempo real (ya no necesarios para crear servicio)
  if (newClickColor1) {
    newClickColor1.addEventListener("input", updateClickGradientPreview);
  }
  if (newClickColor2) {
    newClickColor2.addEventListener("input", updateClickGradientPreview);
  }
  if (newNormalColor1) {
    newNormalColor1.addEventListener("input", updateNormalGradientPreview);
  }
  if (newNormalColor2) {
    newNormalColor2.addEventListener("input", updateNormalGradientPreview);
  }
  if (newAliasColor1) {
    newAliasColor1.addEventListener("input", updateAliasGradientPreview);
  }
  if (newAliasColor2) {
    newAliasColor2.addEventListener("input", updateAliasGradientPreview);
  }

  // Funciones para restablecer colores predeterminados
  function resetClickColors() {
    if (newClickColor1) newClickColor1.value = "#031faa";
    if (newClickColor2) newClickColor2.value = "#031faa";
    updateClickGradientPreview();
    // La sincronización se hace automáticamente en updateClickGradientPreview()
  }

  function resetNormalColors() {
    if (newNormalColor1) newNormalColor1.value = "#764ba2";
    if (newNormalColor2) newNormalColor2.value = "#667eea";
    updateNormalGradientPreview();
    // La sincronización se hace automáticamente en updateNormalGradientPreview()
  }

  function resetAliasColors() {
    if (newAliasColor1) newAliasColor1.value = "#000000";
    if (newAliasColor2) newAliasColor2.value = "#000000";
    updateAliasGradientPreview();
  }

  // Event listeners para botones de restablecer
  if (resetClickColorsBtn) {
    resetClickColorsBtn.addEventListener("click", resetClickColors);
  }
  if (resetNormalColorsBtn) {
    resetNormalColorsBtn.addEventListener("click", resetNormalColors);
  }
  if (resetAliasColorsBtn) {
    resetAliasColorsBtn.addEventListener("click", resetAliasColors);
  }

  // Función para cargar colores actuales desde la base de datos
  function loadCurrentColors() {
    fetch("/admin/get_global_colors_ajax", {
      method: "GET",
      headers: {
        "X-CSRFToken": getCsrfToken()
      }
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        // Actualizar colores de alias
        newAliasColor1.value = data.alias_colors.color1;
        newAliasColor2.value = data.alias_colors.color2;
        originalAliasColors.color1 = data.alias_colors.color1;
        originalAliasColors.color2 = data.alias_colors.color2;
        
        // Actualizar colores de clic
        newClickColor1.value = data.click_colors.color1;
        newClickColor2.value = data.click_colors.color2;
        originalClickColors.color1 = data.click_colors.color1;
        originalClickColors.color2 = data.click_colors.color2;
        
        // Actualizar colores normales
        newNormalColor1.value = data.normal_colors.color1;
        newNormalColor2.value = data.normal_colors.color2;
        originalNormalColors.color1 = data.normal_colors.color1;
        originalNormalColors.color2 = data.normal_colors.color2;
        
        // Actualizar vistas previas
        updateClickGradientPreview();
        updateNormalGradientPreview();
        updateAliasGradientPreview();
      }
    })
    .catch(err => {
      console.error("Error cargando colores actuales:", err);
      // Si hay error, usar valores por defecto y actualizar vistas previas
      updateClickGradientPreview();
      updateNormalGradientPreview();
      updateAliasGradientPreview();
    });
  }
  
  // Cargar colores actuales al inicializar
  loadCurrentColors();
  
  // Inicializar vistas previas al cargar la página
  setTimeout(() => {
    updateClickGradientPreview();
    updateNormalGradientPreview();
    updateAliasGradientPreview();
  }, 100);
  
  // Funciones para guardar colores globales
  function saveAliasColors() {
    const color1 = newAliasColor1.value;
    const color2 = newAliasColor2.value;
    
    fetch("/admin/save_global_alias_colors_ajax", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify({ color1, color2 })
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        alert("✅ " + data.message);
        // Actualizar colores originales
        originalAliasColors.color1 = color1;
        originalAliasColors.color2 = color2;
        // Recargar colores para confirmar que se guardaron
        setTimeout(() => loadCurrentColors(), 500);
      } else {
        alert("❌ Error: " + data.message);
      }
    })
    .catch(err => {
      console.error("Error guardando colores de alias:", err);
      alert("❌ Error de conexión al guardar colores de alias");
    });
  }
  
  function saveClickColors() {
    const color1 = newClickColor1.value;
    const color2 = newClickColor2.value;
    
    fetch("/admin/save_global_click_colors_ajax", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify({ color1, color2 })
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        alert("✅ " + data.message);
        // Actualizar colores originales
        originalClickColors.color1 = color1;
        originalClickColors.color2 = color2;
        // Recargar colores para confirmar que se guardaron
        setTimeout(() => loadCurrentColors(), 500);
      } else {
        alert("❌ Error: " + data.message);
      }
    })
    .catch(err => {
      console.error("Error guardando colores de clic:", err);
      alert("❌ Error de conexión al guardar colores de clic");
    });
  }
  
  function saveNormalColors() {
    const color1 = newNormalColor1.value;
    const color2 = newNormalColor2.value;
    
    fetch("/admin/save_global_normal_colors_ajax", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify({ color1, color2 })
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        alert("✅ " + data.message);
        // Actualizar colores originales
        originalNormalColors.color1 = color1;
        originalNormalColors.color2 = color2;
        // Recargar colores para confirmar que se guardaron
        setTimeout(() => loadCurrentColors(), 500);
      } else {
        alert("❌ Error: " + data.message);
      }
    })
    .catch(err => {
      console.error("Error guardando colores normales:", err);
      alert("❌ Error de conexión al guardar colores normales");
    });
  }
  
  // Funciones para cancelar cambios
  function cancelAliasColors() {
    newAliasColor1.value = originalAliasColors.color1;
    newAliasColor2.value = originalAliasColors.color2;
    updateAliasGradientPreview();
  }
  
  function cancelClickColors() {
    newClickColor1.value = originalClickColors.color1;
    newClickColor2.value = originalClickColors.color2;
    updateClickGradientPreview();
  }
  
  function cancelNormalColors() {
    newNormalColor1.value = originalNormalColors.color1;
    newNormalColor2.value = originalNormalColors.color2;
    updateNormalGradientPreview();
  }
  
  // Event listeners para botones de guardar y cancelar
  if (saveAliasColorsBtn) {
    saveAliasColorsBtn.addEventListener("click", saveAliasColors);
  }
  if (cancelAliasColorsBtn) {
    cancelAliasColorsBtn.addEventListener("click", cancelAliasColors);
  }
  if (saveClickColorsBtn) {
    saveClickColorsBtn.addEventListener("click", saveClickColors);
  }
  if (cancelClickColorsBtn) {
    cancelClickColorsBtn.addEventListener("click", cancelClickColors);
  }
  if (saveNormalColorsBtn) {
    saveNormalColorsBtn.addEventListener("click", saveNormalColors);
  }
  if (cancelNormalColorsBtn) {
    cancelNormalColorsBtn.addEventListener("click", cancelNormalColors);
  }

  // IconGrid
  const iconGridOverlay = document.getElementById("iconGridOverlay");
  const iconGridDiv = document.getElementById("iconGrid");
  const closeIconGridBtn = document.getElementById("closeIconGridBtn");
  const btnVolverPanel = document.getElementById("btnVolverPanelServices");
  let currentServiceIdForIcons = null;

  // Listener para botón Volver al Panel
  if (btnVolverPanel) {
    const dashboardUrl = btnVolverPanel.dataset.dashboardUrl;
    if (dashboardUrl) {
      btnVolverPanel.addEventListener("click", () => {
        window.location.href = dashboardUrl;
      });
    }
  }

  if (closeIconGridBtn) {
    closeIconGridBtn.addEventListener("click", () => {
      if (iconGridOverlay) iconGridOverlay.style.display = "none";
      currentServiceIdForIcons = null;
    });
  }

  // ------------------ Icon Grid logic ------------------------
  function showIconGridForService(serviceId) {
    currentServiceIdForIcons = serviceId;
    const overlay = document.getElementById("iconGridOverlay");
    const grid = document.getElementById("iconGrid");
    const container = document.getElementById("iconGridContainer");

    if (!iconGridOverlay || !grid || !container) {
      return;
    } 

    overlay.style.display = "block";
    container.style.display = "block";
    grid.innerHTML = "";

    for (let i=1; i<=32; i++){
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

      grid.appendChild(div);
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
        iconGridOverlay.style.display = "none";
        initServicesList();
      } else {
        alert("Error: " + data.message);
      }
    });
  }

  // ------------------ Búsqueda de servicios ------------------------
  if (serviceSearchForm && serviceSearchInput && serviceListContainer) {
    serviceSearchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      serviceSearchInput.value = "";
      fetch(`/admin/search_services_ajax?query=`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(r => r.json())
      .then(data => {
        if (data.status === "ok") {
          serviceListContainer.innerHTML = renderServiceItems(data.services);
        }
      });
    });
  }

  // Búsqueda automática al escribir
  if (serviceSearchInput && serviceListContainer) {
    let searchTimeout = null;
    serviceSearchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const q = serviceSearchInput.value.trim();
        fetch(`/admin/search_services_ajax?query=${encodeURIComponent(q)}` ,{
          method:"GET",
          headers:{ "X-CSRFToken": getCsrfToken() }
        })
        .then(r=>r.json())
        .then(data=>{
          if(data.status==="ok"){
            serviceListContainer.innerHTML = renderServiceItems(data.services);
          }
        });
      }, 200); // Espera 200ms para evitar demasiadas peticiones
    });
  }

  // ------------------ Crear servicio ------------------------
  if (createServiceBtn){
    createServiceBtn.addEventListener("click",()=>{
      const n = newServiceName.value.trim();
      const c1 = newNormalColor1.value.trim() || "#764ba2";
      const c2 = newNormalColor2.value.trim() || "#667eea";
      const click1 = newClickColor1.value.trim() || "#031faa";
      const click2 = newClickColor2.value.trim() || "#031faa";
      if(!n){
        alert("Ingresa un nombre para el servicio.");
        return;
      }
      const payload = { 
        name: n, 
        border_color: c1,
        gradient_color: c2,
        click_color1: click1,
        click_color2: click2
      };
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
          newServiceName.value="";
          // Los colores se mantienen en sus secciones respectivas
          // No necesitamos resetearlos al crear un servicio
          initServicesList();
        } else {
          alert("Error: "+data.message);
        }
      });
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
          popupRegex.style.display="none";
          currentServiceIdForRegex=null;
          initServicesList();
        } else {
          alert("Error: " + data.message);
        }
      });
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
          popupFilter.style.display="none";
          currentServiceIdForFilter=null;
          initServicesList();
        } else {
          alert("Error: " + data.message);
        }
      });
    });

    filterLinkCancelBtn.addEventListener("click", ()=>{
      popupFilter.style.display="none";
      currentServiceIdForFilter=null;
    });
  }

  // ------------------ Delegación de eventos en la lista ------------------------
  document.addEventListener("click", (e) => {
    const target = e.target;


    // --- Acciones de Servicio --- 
    if(target.classList.contains("delete-service") || target.closest(".delete-service")){
      e.preventDefault();
      const button = target.classList.contains("delete-service") ? target : target.closest(".delete-service");
      const sId=button.getAttribute("data-id");
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
      });
    }
    if(target.classList.contains("single-visibility-btn")){
      e.preventDefault();
      const sId = target.getAttribute("data-id");
      const cur = target.getAttribute("data-current-state") || "off";
      let next = getNextAvailableState(cur, sId);
      performToggleVisibility(sId, next);
    }
    if(target.classList.contains("edit-service")){
      e.preventDefault();
      const sId=target.getAttribute("data-id");
      const editUrl = `/admin/edit_service/${sId}`;
      if (editUrl) {
        window.location.href = editUrl;
      }
    }
    if(target.classList.contains("link-regex-service")){
      e.preventDefault();
      currentServiceIdForRegex = target.getAttribute("data-id");
      if (lastSelectedRegexId) {
        regexSelect.value = lastSelectedRegexId;
      }
      popupRegex.style.display="block";
    }
    if(target.classList.contains("link-filter-service")){
      e.preventDefault();
      currentServiceIdForFilter = target.getAttribute("data-id");
      if (lastSelectedFilterId) {
        filterSelect.value = lastSelectedFilterId;
      }
      popupFilter.style.display="block";
    }
    if(target.classList.contains("add-service-icon-btn")){
      e.preventDefault();
      const sId=target.getAttribute("data-id");
      showIconGridForService(sId);
    }
    if(target.classList.contains("delete-service-icon") || target.closest(".delete-service-icon")){
      e.preventDefault();
      const button = target.classList.contains("delete-service-icon") ? target : target.closest(".delete-service-icon");
      const iconId = button.getAttribute("data-icon-id");
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
          serviceListContainer.innerHTML=renderServiceItems(data.services);
        } else {
          alert("Error: " + data.message);
        }
      });
    }
  });

  // --- Cerrar popups al hacer clic fuera ---
  document.addEventListener('mousedown', function(event) {
    // Regex
    if (popupRegex && popupRegex.style.display === 'block' && !popupRegex.contains(event.target) && !event.target.classList.contains('link-regex-service')) {
      popupRegex.style.display = 'none';
      currentServiceIdForRegex = null;
    }
    // Filtro
    if (popupFilter && popupFilter.style.display === 'block' && !popupFilter.contains(event.target) && !event.target.classList.contains('link-filter-service')) {
      popupFilter.style.display = 'none';
      currentServiceIdForFilter = null;
    }
    // Iconos
    const iconGridContainer = document.getElementById('iconGridContainer');
    if (iconGridOverlay && iconGridOverlay.style.display === 'block' && iconGridContainer && iconGridContainer.style.display === 'block' && !iconGridContainer.contains(event.target) && !event.target.classList.contains('add-service-icon-btn')) {
      iconGridOverlay.style.display = 'none';
      iconGridContainer.style.display = 'none';
      currentServiceIdForIcons = null;
    }
  });

  // ------------------ Funciones ------------------------


  // ------------------ Funciones: toggleVisibility, renderServiceItems etc. ------------------------
  
  function getNextAvailableState(currentState, serviceId) {
    // Ciclo base: off -> on-no-usuarios -> on-usuarios -> on-no-usuarios-no-visible -> codigos-2 -> off
    const baseCycle = ["off", "on-no-usuarios", "on-usuarios", "on-no-usuarios-no-visible", "codigos-2"];
    
    const currentIndex = baseCycle.indexOf(currentState);
    
    // Si el estado actual no está en el ciclo, empezar desde off
    if (currentIndex === -1) {
      return "on-no-usuarios";
    }
    
    // Buscar el siguiente estado disponible
    for (let i = 1; i <= baseCycle.length; i++) {
      const nextIndex = (currentIndex + i) % baseCycle.length;
      const candidateState = baseCycle[nextIndex];
      
      if (isStateAvailable(candidateState, serviceId)) {
        return candidateState;
      }
    }
    
    // Si no hay estados disponibles, volver a off
    return "off";
  }
  
  function isStateAvailable(state, serviceId) {
    // off siempre está disponible
    if (state === "off") {
      return true;
    }
    
    // Para on-no-usuarios-no-visible, verificar que no haya otro servicio con este modo
    if (state === "on-no-usuarios-no-visible") {
      // Buscar en los servicios actuales si hay otro con este modo
      const serviceElements = document.querySelectorAll('.single-visibility-btn');
      for (let element of serviceElements) {
        const elementServiceId = element.getAttribute('data-id');
        const elementState = element.getAttribute('data-current-state');
        
        // Si hay otro servicio (no el actual) con on-no-usuarios-no-visible, no está disponible
        if (elementServiceId !== serviceId && elementState === 'on-no-usuarios-no-visible') {
          return false;
        }
      }
    }
    
    // Para codigos-2, verificar que no haya otro servicio con este modo
    if (state === "codigos-2") {
      const serviceElements = document.querySelectorAll('.single-visibility-btn');
      for (let element of serviceElements) {
        const elementServiceId = element.getAttribute('data-id');
        const elementState = element.getAttribute('data-current-state');
        
        // Si hay otro servicio (no el actual) con codigos-2, no está disponible
        if (elementServiceId !== serviceId && elementState === 'codigos-2') {
          return false;
        }
      }
    }
    
    // Para on-no-usuarios, verificar que no haya conflicto con on-no-usuarios-no-visible
    if (state === "on-no-usuarios") {
      const serviceElements = document.querySelectorAll('.single-visibility-btn');
      for (let element of serviceElements) {
        const elementServiceId = element.getAttribute('data-id');
        const elementState = element.getAttribute('data-current-state');
        
        // Si hay otro servicio con on-no-usuarios-no-visible, on-no-usuarios no está disponible
        if (elementServiceId !== serviceId && elementState === 'on-no-usuarios-no-visible') {
          return false;
        }
      }
    }
    
    // Para on-no-usuarios-no-visible, verificar que no haya conflicto con on-no-usuarios
    if (state === "on-no-usuarios-no-visible") {
      const serviceElements = document.querySelectorAll('.single-visibility-btn');
      for (let element of serviceElements) {
        const elementServiceId = element.getAttribute('data-id');
        const elementState = element.getAttribute('data-current-state');
        
        // Si hay otro servicio con on-no-usuarios, on-no-usuarios-no-visible no está disponible
        if (elementServiceId !== serviceId && elementState === 'on-no-usuarios') {
          return false;
        }
      }
    }
    
    // on-usuarios siempre está disponible (no tiene restricciones)
    return true;
  }
  
  function toggleVisibility(serviceId, newState){
    // En la lista de servicios, la validación ya se hizo en getNextAvailableState
    // Solo cambiar el estado directamente
    performToggleVisibility(serviceId, newState);
  }
  
  function validateVisibilityChange(serviceId, newState, callback) {
    const validationPromises = [];
    
    if (newState === "on-no-usuarios-no-visible") {
      // Verificar conflictos con on-no-usuarios
      validationPromises.push(
        fetch("/admin/check_visibility_conflict_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ 
            conflict_mode: "on-no-usuarios",
            current_service_id: serviceId
          })
        }).then(r => r.json())
      );
      
      // Verificar unicidad
      validationPromises.push(
        fetch("/admin/check_visibility_uniqueness_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ 
            mode: "on-no-usuarios-no-visible",
            current_service_id: serviceId
          })
        }).then(r => r.json())
      );
    } else if (newState === "on-no-usuarios") {
      // Verificar conflictos con on-no-usuarios-no-visible
      validationPromises.push(
        fetch("/admin/check_visibility_conflict_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ 
            conflict_mode: "on-no-usuarios-no-visible",
            current_service_id: serviceId
          })
        }).then(r => r.json())
      );
    } else if (newState === "codigos-2") {
      // Verificar unicidad para codigos-2
      validationPromises.push(
        fetch("/admin/check_visibility_uniqueness_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ 
            mode: "codigos-2",
            current_service_id: serviceId
          })
        }).then(r => r.json())
      );
    }
    
    Promise.all(validationPromises)
      .then(results => {
        // Verificar si hay errores
        for (let result of results) {
          if (result.status === "conflict") {
            alert(`❌ Error: No puedes activar '${newState}' porque hay servicios conflictivos activos.\n\nServicios en conflicto: ${result.conflicting_services.join(', ')}\n\nCambia primero esos servicios a 'off' antes de continuar.`);
            return;
          }
          if (result.status === "duplicate") {
            alert(`❌ Error: Solo puede haber un servicio con modo '${newState}' activo.\n\nServicio existente: ${result.existing_service}\n\nCambia primero ese servicio a otro modo antes de continuar.`);
            return;
          }
        }
        
        // Si no hay errores, proceder con el cambio
        callback();
      })
      .catch(err => {
        console.error("Error validando cambio de visibilidad:", err);
        alert("Error validando cambio de visibilidad. Inténtalo de nuevo.");
      });
  }
  
  function performToggleVisibility(serviceId, newState){
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
    });
  }

  function getStateStyle(mode){
    if(mode==="off"){
      return { background:"#f44336", text:"off" };
    }
    if(mode==="on-no-usuarios"){
      return { background:"#2196f3", text:"on-no-usuarios" };
    }
    if(mode==="on-usuarios"){
      return { background:"#4caf50", text:"on-usuarios" };
    }
    if(mode==="on-no-usuarios-no-visible"){
      return { background:"#9c27b0", text:"on-no-usuarios-no-visible" };
    }
    // Fallback por defecto
    return { background:"#666666", text:mode };
  }

  function renderServiceItems(services){
    let html = "";
    let popupsHtml = "";

    services.forEach(s => {
      // Determinar la clase CSS para el botón de visibilidad
      let visibilityBtnClass = 'visibility-btn-off'; // Default to off
      if (s.visibility_mode === 'on-no-usuarios') {
        visibilityBtnClass = 'visibility-btn-on-no-usuarios';
      } else if (s.visibility_mode === 'on-usuarios') {
        visibilityBtnClass = 'visibility-btn-on-usuarios';
      } else if (s.visibility_mode === 'on-no-usuarios-no-visible') {
        visibilityBtnClass = 'visibility-btn-on-no-usuarios-no-visible';
      } else if (s.visibility_mode === 'codigos-2') {
        visibilityBtnClass = 'visibility-btn-codigos-2';
      }
      const visibilityBtnText = s.visibility_mode || 'off'; // Texto del botón

      // --- HTML principal del servicio (MODIFICADO para usar degradados) ---
      const gradientStyle = s.gradient_color ? 
        `background: linear-gradient(135deg, ${s.border_color || '#764ba2'} 0%, ${s.gradient_color} 100%);` :
        `background-color: ${s.border_color || '#333333'};`;
      
        html += `
          <div class="admin-card service-item-container" style="margin-bottom:1rem; position: relative;">
            <strong>${s.name}</strong>
            <br>
          <div style="margin:0.5rem 0;">
            <!-- Posición -->
            <span style="color:#666; margin-right:0.6rem;">
              Pos: ${s.position}
            </span>
            <!-- Botón Visibilidad (AHORA CON CLASES) -->
            <button class="single-visibility-btn visibility-btn ${visibilityBtnClass}" data-id="${s.id}" data-current-state="${s.visibility_mode}">
              ${visibilityBtnText}
            </button>
            <!-- Iconos del servicio (AHORA CON CLASES) -->
            ${s.service_icons && s.service_icons.length>0 ? s.service_icons.map(iconObj => `
              <span style="display:inline-block; margin-right:0.4rem; vertical-align:middle;">
                <img src="${decideIconPath(iconObj.icon_name)}" class="service-icon-img">
                <button class="delete-service-icon delete-service-icon-btn" data-icon-id="${iconObj.id}">X</button>
              </span>
            `).join('') : ''}
          </div>
          <!-- Bloque final de botones -->
          <div class="mt-05">
      `;
        // Restaurar botones para servicios NO protegidos
        if (!(s.protected && s.name === "Pais Netflix")) {
            html += `
                <button class="edit-service btn-orange" data-id="${s.id}">Editar</button>
                <button class="link-regex-service btn-blue" data-id="${s.id}">re</button>
                <button class="link-filter-service btn-blue" data-id="${s.id}">fi</button>
                <button class="add-service-icon-btn btn-blue" data-id="${s.id}">+Icon</button>
                <button class="btn-panel btn-red btn-sm delete-service" data-id="${s.id}" title="Eliminar">
                  <i class="fas fa-trash"></i>
                </button>
            `;
        } else { // Para servicio protegido, solo Editar e Icono
             html += `
                <button class="edit-service btn-orange" data-id="${s.id}">Editar</button>
                <button class="add-service-icon-btn btn-blue" data-id="${s.id}">+Icon</button>
            `;
        }
        html += `
          </div> <!-- Cierre div botones -->
        </div> <!-- Cierre admin-card -->
        `;

    }); // Fin del forEach(s => ...)

    // Devolver el HTML de los servicios y añadir los popups al final
    const finalHtml = html + popupsHtml;
    
    
    return finalHtml;
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
      });

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
      });

    }
  }

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
    });

    // Cargamos regex y filtros para que los selects "re" y "fi" funcionen.
    loadRegexesAndFilters();
  }

  // --- Función para actualizar color (Sin cambios) --- 
  function updateServiceColor(serviceId, newColor) {
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
        // Opcional: pequeña notificación visual si se desea
        // El color visual del span se actualiza en el 'blur' listener
      } else {
        alert("Error al actualizar el color: " + data.message);
        // Podríamos intentar revertir el color visual si falla, 
        // pero por simplicidad, dejaremos que el blur lo actualice al valor que tenía el input
      }
    })
    .catch(err => {
        alert("Error de red al intentar actualizar el color.");
    });
  }

  // Función para sincronizar colores globales con Pais Netflix
  function syncNetflixColors() {
    // Usar debounce para evitar múltiples llamadas
    if (syncNetflixColors.timeout) {
      clearTimeout(syncNetflixColors.timeout);
    }
    
    syncNetflixColors.timeout = setTimeout(() => {
      const normalColor1 = newNormalColor1 ? newNormalColor1.value || "#764ba2" : "#764ba2";
      const normalColor2 = newNormalColor2 ? newNormalColor2.value || "#667eea" : "#667eea";
      const clickColor1 = newClickColor1 ? newClickColor1.value || "#031faa" : "#031faa";
      const clickColor2 = newClickColor2 ? newClickColor2.value || "#031faa" : "#031faa";

      const payload = {
        normal_color1: normalColor1,
        normal_color2: normalColor2,
        click_color1: clickColor1,
        click_color2: clickColor2
      };

      fetch("/admin/sync_netflix_colors_ajax", {
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
          // Sincronización exitosa
        } else {
          // Error en sincronización
        }
      })
      .catch(err => {
        // Error de red en sincronización
      });
    }, 500); // Debounce de 500ms
  }


  // Iniciar
  initServicesList();
}); // Fin DOMContentLoaded
