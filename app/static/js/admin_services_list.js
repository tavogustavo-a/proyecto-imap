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
  const newClickColorDark = document.getElementById("newClickColorDark");
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
  
  // Botones de guardar colores
  const saveAliasColorsBtn = document.getElementById("saveAliasColorsBtn");
  const saveClickColorsBtn = document.getElementById("saveClickColorsBtn");
  const saveNormalColorsBtn = document.getElementById("saveNormalColorsBtn");

  // Regex/Filter POPUP
  const popupRegex = document.getElementById("popupRegex");
  const regexSelectList = document.getElementById("regexSelectList");
  const regexLinkSaveBtn = document.getElementById("regexLinkSaveBtn");
  const regexLinkCancelBtn = document.getElementById("regexLinkCancelBtn");
  let currentServiceIdForRegex = null;

  const popupFilter = document.getElementById("popupFilter");
  const filterSelectList = document.getElementById("filterSelectList");
  const filterLinkSaveBtn = document.getElementById("filterLinkSaveBtn");
  const filterLinkCancelBtn = document.getElementById("filterLinkCancelBtn");
  let currentServiceIdForFilter = null;

  let allRegexOptions = [];
  let allFilterOptions = [];
  let selectedRegexIdsPending = new Set();
  let selectedFilterIdsPending = new Set();
  let lockedRegexIds = new Set();
  let lockedFilterIds = new Set();
  let servicesById = new Map();

  function renderRegexSelectList() {
    if (!regexSelectList) return;
    regexSelectList.innerHTML = "";
    if (!allRegexOptions.length) {
      regexSelectList.innerHTML =
        '<p class="service-link-popup-list-empty">No hay regex disponibles.</p>';
      return;
    }
    allRegexOptions.forEach((rx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-link-popup-list-item";
      btn.dataset.id = String(rx.id);
      btn.textContent = rx.description || "(sin descripción)";
      btn.setAttribute("role", "option");
      const selected = selectedRegexIdsPending.has(rx.id);
      const locked = lockedRegexIds.has(rx.id);
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) btn.classList.add("is-selected");
      if (locked) {
        btn.classList.add("is-locked");
        btn.title = "Ya vinculado. Solo se quita desde Editar.";
      }
      regexSelectList.appendChild(btn);
    });
  }

  function renderFilterSelectList() {
    if (!filterSelectList) return;
    filterSelectList.innerHTML = "";
    if (!allFilterOptions.length) {
      filterSelectList.innerHTML =
        '<p class="service-link-popup-list-empty">No hay filtros disponibles.</p>';
      return;
    }
    allFilterOptions.forEach((ft) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-link-popup-list-item";
      btn.dataset.id = String(ft.id);
      btn.textContent = ft.description || "(sin descripción)";
      btn.setAttribute("role", "option");
      const selected = selectedFilterIdsPending.has(ft.id);
      const locked = lockedFilterIds.has(ft.id);
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) btn.classList.add("is-selected");
      if (locked) {
        btn.classList.add("is-locked");
        btn.title = "Ya vinculado. Solo se quita desde Editar.";
      }
      filterSelectList.appendChild(btn);
    });
  }
  
  // Variables para almacenar colores originales (para cancelar)
  // Colores plantilla códigos (mismos que botones públicos)
  const CODIGOS_NORMAL_1 = "#1e3a8a";
  const CODIGOS_NORMAL_2 = "#2563eb";
  const CODIGOS_CLICK_1 = "#172554";
  const CODIGOS_CLICK_2 = "#1e40af";
  const CODIGOS_ALIAS_1 = "#1e293b";
  const CODIGOS_ALIAS_2 = "#334155";

  let originalAliasColors = { color1: CODIGOS_ALIAS_1, color2: CODIGOS_ALIAS_2 };
  let originalClickColors = { color1: CODIGOS_CLICK_1, color2: CODIGOS_CLICK_2, colorDark: "#0f172a" };
  let originalNormalColors = { color1: CODIGOS_NORMAL_1, color2: CODIGOS_NORMAL_2 };

  // Función para actualizar la vista previa del degradado (ya no se usa en crear servicio)
  function updateGradientPreview() {
    // Esta función ya no es necesaria para crear servicios
    // Los colores se manejan en las secciones superiores
  }

  // Función para actualizar la vista previa del degradado de clic
  function updateClickGradientPreview() {
    if (clickGradientPreview && newClickColor1 && newClickColor2) {
      const color1 = newClickColor1.value || "#172554";
      const color2 = newClickColor2.value || "#1e40af";
      const colorDark = (newClickColorDark && newClickColorDark.value) || "#0f172a";
      clickGradientPreview.style.background = `linear-gradient(135deg, ${colorDark} 0%, ${color1} 46%, ${color2} 100%)`;
    }
  }

  // Función para actualizar la vista previa del degradado normal
  function updateNormalGradientPreview() {
    if (normalGradientPreview && newNormalColor1 && newNormalColor2) {
      const color1 = newNormalColor1.value || "#1e3a8a";
      const color2 = newNormalColor2.value || "#2563eb";
      normalGradientPreview.style.background = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;
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
  if (newClickColorDark) {
    newClickColorDark.addEventListener("input", updateClickGradientPreview);
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
    if (newClickColor1) newClickColor1.value = CODIGOS_CLICK_1;
    if (newClickColor2) newClickColor2.value = CODIGOS_CLICK_2;
    if (newClickColorDark) newClickColorDark.value = "#0f172a";
    updateClickGradientPreview();
  }

  function resetNormalColors() {
    if (newNormalColor1) newNormalColor1.value = CODIGOS_NORMAL_1;
    if (newNormalColor2) newNormalColor2.value = CODIGOS_NORMAL_2;
    updateNormalGradientPreview();
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
        if (newClickColorDark) newClickColorDark.value = data.click_colors.color_dark || "#0f172a";
        originalClickColors.color1 = data.click_colors.color1;
        originalClickColors.color2 = data.click_colors.color2;
        originalClickColors.colorDark = data.click_colors.color_dark || "#0f172a";
        
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
  
  function paintSavedChrome(partial) {
    const root = document.documentElement;
    Object.keys(partial).forEach((name) => {
      if (partial[name]) root.style.setProperty(name, partial[name]);
    });
    if (typeof window.applyUiChromeGradients === "function") {
      window.applyUiChromeGradients();
    }
  }

  function saveClickColors() {
    const color1 = newClickColor1.value;
    const color2 = newClickColor2.value;
    const colorDark = newClickColorDark ? newClickColorDark.value : "#0f172a";
    
    fetch("/admin/save_global_click_colors_ajax", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken()
      },
      body: JSON.stringify({ color1, color2, color_dark: colorDark })
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        alert("✅ " + data.message);
        originalClickColors.color1 = color1;
        originalClickColors.color2 = color2;
        originalClickColors.colorDark = colorDark;
        paintSavedChrome({
          "--ui-click-1": color1,
          "--ui-click-2": color2,
          "--ui-click-dark": colorDark
        });
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
        paintSavedChrome({
          "--ui-static-1": color1,
          "--ui-static-2": color2
        });
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
  
  if (saveAliasColorsBtn) {
    saveAliasColorsBtn.addEventListener("click", saveAliasColors);
  }
  if (saveClickColorsBtn) {
    saveClickColorsBtn.addEventListener("click", saveClickColors);
  }
  if (saveNormalColorsBtn) {
    saveNormalColorsBtn.addEventListener("click", saveNormalColors);
  }

  // IconGrid
  const iconGridOverlay = document.getElementById("iconGridOverlay");
  const iconGridDiv = document.getElementById("iconGrid");
  const closeIconGridBtn = document.getElementById("closeIconGridBtn");
  let currentServiceIdForIcons = null;

  if (closeIconGridBtn) {
    closeIconGridBtn.addEventListener("click", () => {
      if (iconGridOverlay) {
        iconGridOverlay.classList.remove("modal-visible");
        iconGridOverlay.classList.add("modal-hidden");
      }
      if (iconGridContainer) {
        iconGridContainer.classList.remove("modal-visible");
        iconGridContainer.classList.add("modal-hidden");
      }
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

    overlay.classList.remove("modal-hidden");
    overlay.classList.add("modal-visible");
    container.classList.remove("modal-hidden");
    container.classList.add("modal-visible");
    grid.innerHTML = "";
    fillStreamIconGrid(grid, (fileName) => addServiceIcon(serviceId, fileName));
  }

  function streamIconNames(files) {
    return files
      .filter((name) => /^stream\d+\.png$/i.test(name))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  }

  function fillStreamIconGrid(grid, onPick) {
    const paint = (files) => {
      grid.innerHTML = "";
      files.forEach((fileName) => {
        const img = document.createElement("img");
        img.src = decideIconPath(fileName);
        img.alt = fileName;
        img.title = fileName;
        img.addEventListener("click", () => onPick(fileName));
        grid.appendChild(img);
      });
    };
    fetch("/admin/list_icons_ajax")
      .then((r) => r.json())
      .then((data) => {
        const files = data && data.status === "ok" && Array.isArray(data.icons)
          ? streamIconNames(data.icons)
          : [];
        paint(files);
      })
      .catch(() => paint([]));
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
        iconGridOverlay.classList.remove("modal-visible");
        iconGridOverlay.classList.add("modal-hidden");
        if (iconGridContainer) {
          iconGridContainer.classList.remove("modal-visible");
          iconGridContainer.classList.add("modal-hidden");
        }
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
      if (!newServiceName) {
        alert("Error: Campo de nombre no encontrado.");
        return;
      }
      
      const n = newServiceName.value.trim();
      const c1 = (newNormalColor1 && newNormalColor1.value.trim()) || CODIGOS_NORMAL_1;
      const c2 = (newNormalColor2 && newNormalColor2.value.trim()) || CODIGOS_NORMAL_2;
      const click1 = (newClickColor1 && newClickColor1.value.trim()) || CODIGOS_CLICK_1;
      const click2 = (newClickColor2 && newClickColor2.value.trim()) || CODIGOS_CLICK_2;
      
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
      })
      .catch(err => {
        console.error("Error al crear servicio:", err);
        alert("Error de red al crear servicio.");
      });
    });
  } else {
    console.error("createServiceBtn no encontrado");
  }

  if (regexSelectList) {
    regexSelectList.addEventListener("click", (e) => {
      const item = e.target.closest(".service-link-popup-list-item");
      if (!item || !item.dataset.id) return;
      e.stopPropagation();
      const id = parseInt(item.dataset.id, 10);
      if (Number.isNaN(id)) return;
      if (lockedRegexIds.has(id)) return;
      if (selectedRegexIdsPending.has(id)) selectedRegexIdsPending.delete(id);
      else selectedRegexIdsPending.add(id);
      renderRegexSelectList();
    });
  }

  if (filterSelectList) {
    filterSelectList.addEventListener("click", (e) => {
      const item = e.target.closest(".service-link-popup-list-item");
      if (!item || !item.dataset.id) return;
      e.stopPropagation();
      const id = parseInt(item.dataset.id, 10);
      if (Number.isNaN(id)) return;
      if (lockedFilterIds.has(id)) return;
      if (selectedFilterIdsPending.has(id)) selectedFilterIdsPending.delete(id);
      else selectedFilterIdsPending.add(id);
      renderFilterSelectList();
    });
  }

  // ------------------ Vincular REGEX (botones "re") ------------------------
  if (regexLinkSaveBtn && regexLinkCancelBtn){
    regexLinkSaveBtn.addEventListener("click", ()=>{
      if(!currentServiceIdForRegex) return;
      const regexIds = Array.from(selectedRegexIdsPending);

      if(!regexIds.length){
        alert("Marca al menos un regex (azul) y pulsa Vincular.");
        return;
      }
      const payload = {
        service_id: parseInt(currentServiceIdForRegex, 10),
        regex_ids: regexIds
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
          popupRegex.classList.remove("modal-visible");
          popupRegex.classList.add("modal-hidden");
          currentServiceIdForRegex=null;
          selectedRegexIdsPending = new Set();
          lockedRegexIds = new Set();
          initServicesList();
        } else {
          alert("Error: " + data.message);
        }
      });
    });

    regexLinkCancelBtn.addEventListener("click", ()=>{
      popupRegex.classList.remove("modal-visible");
      popupRegex.classList.add("modal-hidden");
      currentServiceIdForRegex=null;
      selectedRegexIdsPending = new Set();
      lockedRegexIds = new Set();
    });
  }

  // ------------------ Vincular FILTRO (botones "fi") ------------------------
  if (filterLinkSaveBtn && filterLinkCancelBtn){
    filterLinkSaveBtn.addEventListener("click", ()=>{
      if(!currentServiceIdForFilter) return;
      const filterIds = Array.from(selectedFilterIdsPending);

      if(!filterIds.length){
        alert("Marca al menos un filtro (azul) y pulsa Vincular.");
        return;
      }
      const payload = {
        service_id: parseInt(currentServiceIdForFilter, 10),
        filter_ids: filterIds
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
          popupFilter.classList.remove("modal-visible");
          popupFilter.classList.add("modal-hidden");
          currentServiceIdForFilter=null;
          selectedFilterIdsPending = new Set();
          lockedFilterIds = new Set();
          initServicesList();
        } else {
          alert("Error: " + data.message);
        }
      });
    });

    filterLinkCancelBtn.addEventListener("click", ()=>{
      popupFilter.classList.remove("modal-visible");
      popupFilter.classList.add("modal-hidden");
      currentServiceIdForFilter=null;
      selectedFilterIdsPending = new Set();
      lockedFilterIds = new Set();
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
      const linkedRegex = linkedIdsForService(currentServiceIdForRegex, "regex_ids");
      lockedRegexIds = linkedRegex;
      selectedRegexIdsPending = new Set(linkedRegex);
      renderRegexSelectList();
      popupRegex.classList.remove("modal-hidden");
      popupRegex.classList.add("modal-visible");
    }
    if(target.classList.contains("link-filter-service")){
      e.preventDefault();
      currentServiceIdForFilter = target.getAttribute("data-id");
      const linkedFilters = linkedIdsForService(currentServiceIdForFilter, "filter_ids");
      lockedFilterIds = linkedFilters;
      selectedFilterIdsPending = new Set(linkedFilters);
      renderFilterSelectList();
      popupFilter.classList.remove("modal-hidden");
      popupFilter.classList.add("modal-visible");
    }
    if(target.classList.contains("add-service-icon-btn")){
      e.preventDefault();
      const sId=target.getAttribute("data-id");
      const row = target.closest(".service-item-container");
      if (row && row.querySelector(".service-item-icons-inline .service-icon-wrapper")) {
        alert("Cada botón principal solo puede tener un icono. Quítalo para cambiarlo.");
        return;
      }
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
    if (popupRegex && popupRegex.classList.contains('modal-visible') && !popupRegex.contains(event.target) && !event.target.classList.contains('link-regex-service')) {
      popupRegex.classList.remove("modal-visible");
      popupRegex.classList.add("modal-hidden");
      currentServiceIdForRegex = null;
      selectedRegexIdsPending = new Set();
      lockedRegexIds = new Set();
    }
    // Filtro
    if (popupFilter && popupFilter.classList.contains('modal-visible') && !popupFilter.contains(event.target) && !event.target.classList.contains('link-filter-service')) {
      popupFilter.classList.remove("modal-visible");
      popupFilter.classList.add("modal-hidden");
      currentServiceIdForFilter = null;
      selectedFilterIdsPending = new Set();
      lockedFilterIds = new Set();
    }
    // Iconos
    const iconGridContainer = document.getElementById('iconGridContainer');
    if (iconGridOverlay && iconGridOverlay.classList.contains('modal-visible') && iconGridContainer && iconGridContainer.classList.contains('modal-visible') && !iconGridContainer.contains(event.target) && !event.target.classList.contains('add-service-icon-btn')) {
      iconGridOverlay.classList.remove("modal-visible");
      iconGridOverlay.classList.add("modal-hidden");
      iconGridContainer.classList.remove("modal-visible");
      iconGridContainer.classList.add("modal-hidden");
      currentServiceIdForIcons = null;
    }
  });

  // ------------------ Funciones ------------------------


  // ------------------ Funciones: toggleVisibility, renderServiceItems etc. ------------------------

  const VISIBILITY_MODE_LABELS = {
    off: "apagado",
    "on-no-usuarios": "no logueados boton visible",
    "on-usuarios": "usuarios logueados",
    "on-no-usuarios-no-visible": "no logueados boton no visible",
    sms: "sms usuarios logueados",
  };

  function visibilityModeLabel(mode) {
    const key = mode || "off";
    return VISIBILITY_MODE_LABELS[key] || key;
  }

  function getNextAvailableState(currentState, serviceId) {
    // Ciclo base: off -> on-no-usuarios -> on-usuarios -> on-no-usuarios-no-visible -> sms -> off
    const baseCycle = ["off", "on-no-usuarios", "on-usuarios", "on-no-usuarios-no-visible", "sms"];
    
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
    const text = visibilityModeLabel(mode);
    if(mode==="off"){
      return { background:"#f44336", text };
    }
    if(mode==="on-no-usuarios"){
      return { background:"#2196f3", text };
    }
    if(mode==="on-usuarios"){
      return { background:"#4caf50", text };
    }
    if(mode==="on-no-usuarios-no-visible"){
      return { background:"#9c27b0", text };
    }
    if(mode==="sms"){
      return { background:"#00bcd4", text };
    }
    return { background:"#666666", text };
  }

  function renderAttachedServiceIcons(serviceIcons) {
    if (!serviceIcons || !serviceIcons.length) return "";
    const items = serviceIcons
      .map(
        (iconObj) => `
                <span class="service-icon-wrapper">
                  <img src="${decideIconPath(iconObj.icon_name)}" class="service-icon-img" alt="">
                  <button type="button" class="delete-service-icon delete-service-icon-btn" data-icon-id="${iconObj.id}" title="Quitar icono" aria-label="Quitar icono">&times;</button>
                </span>
              `
      )
      .join("");
    return `<span class="service-item-icons-inline" aria-label="Iconos del servicio">${items}</span>`;
  }

  function serviceHasMainIcon(service) {
    return Boolean(service && service.service_icons && service.service_icons.length >= 1);
  }

  function linkedIdsForService(serviceId, key) {
    const svc = servicesById.get(String(serviceId));
    const raw = svc && Array.isArray(svc[key]) ? svc[key] : [];
    const ids = new Set();
    raw.forEach((value) => {
      const id = parseInt(value, 10);
      if (!Number.isNaN(id)) ids.add(id);
    });
    return ids;
  }

  function renderServiceItems(services){
    servicesById = new Map((services || []).map((s) => [String(s.id), s]));
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
      } else if (s.visibility_mode === 'sms') {
        visibilityBtnClass = 'visibility-btn-sms';
      }
      const visibilityBtnText = visibilityModeLabel(s.visibility_mode);

      // --- HTML principal del servicio (MODIFICADO para usar degradados) ---
      const gradientStyle = s.gradient_color ? 
        `background: linear-gradient(135deg, ${s.border_color || CODIGOS_NORMAL_1} 0%, ${s.gradient_color || CODIGOS_NORMAL_2} 100%);` :
        `background-color: ${s.border_color || '#333333'};`;
      
        html += `
          <div class="admin-card service-item-container">
            <div class="service-item-head">
              <strong class="service-item-name">${s.name}</strong>
              <span class="service-position-label">Pos: ${s.position}</span>
              <button type="button" class="single-visibility-btn visibility-btn ${visibilityBtnClass}" data-id="${s.id}" data-current-state="${s.visibility_mode}">
                ${visibilityBtnText}
              </button>
            </div>
            <div class="service-item-actions" aria-label="Acciones del servicio">
      `;
        const attachedIconsHtml = renderAttachedServiceIcons(s.service_icons);
        const editBtnHtml = `
                <button type="button" class="edit-service btn-orange row-icon-btn" data-id="${s.id}" title="Editar" aria-label="Editar"><i class="fas fa-pen" aria-hidden="true"></i></button>`;
        const deleteBtnHtml = `
                <button type="button" class="btn-panel btn-red btn-sm delete-service" data-id="${s.id}" title="Eliminar" aria-label="Eliminar">
                  <i class="fas fa-trash" aria-hidden="true"></i>
                </button>`;
        const addIconBtnHtml = serviceHasMainIcon(s)
          ? ""
          : `<button type="button" class="add-service-icon-btn btn-blue service-row-icon-btn" data-id="${s.id}" title="Añadir icono">+Icon</button>`;
        // Botones para servicios no protegidos
        if (!s.protected) {
            if (s.visibility_mode === 'sms') {
                html += `
                    ${editBtnHtml}
                    <button type="button" class="btn-blue service-row-btn service-row-btn-inert" disabled title="Regex no disponible en servicios SMS" aria-label="Regex no disponible">regex</button>
                    <button type="button" class="btn-blue service-row-btn service-row-btn-inert" disabled title="Filtro no disponible en servicios SMS" aria-label="Filtro no disponible">filtro</button>
                    ${deleteBtnHtml}
                    ${addIconBtnHtml}
                    ${attachedIconsHtml}
                `;
            } else {
                html += `
                    ${editBtnHtml}
                    <button type="button" class="link-regex-service btn-blue service-row-btn" data-id="${s.id}" title="Regex">regex</button>
                    <button type="button" class="link-filter-service btn-blue service-row-btn" data-id="${s.id}" title="Filtro">filtro</button>
                    ${deleteBtnHtml}
                    ${addIconBtnHtml}
                    ${attachedIconsHtml}
                `;
            }
        } else {
             html += `
                ${editBtnHtml}
                ${addIconBtnHtml}
                ${attachedIconsHtml}
            `;
        }
        html += `
            </div>
          </div>
        `;

    }); // Fin del forEach(s => ...)

    // Devolver el HTML de los servicios y añadir los popups al final
    const finalHtml = html + popupsHtml;
    
    
    return finalHtml;
  }

  /** Carga regex y filtros para los modales de vincular (multiselección). */
  function loadRegexesAndFilters(){
    if (regexSelectList) {
      fetch("/admin/list_regex_names", {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          allRegexOptions = data.regex || [];
          renderRegexSelectList();
        }
      })
      .catch(err => {
        console.error("Error al cargar regexes:", err);
      });
    }

    if (filterSelectList) {
      fetch("/admin/list_filter_names", {
        method:"GET",
        headers:{ "X-CSRFToken": getCsrfToken() }
      })
      .then(r=>r.json())
      .then(data=>{
        if(data.status==="ok"){
          allFilterOptions = (data.filters || []).map((ft) => {
            const label =
              ft.description && ft.description.trim && ft.description.trim()
                ? ft.description
                : "(sin descripción)";
            return { id: ft.id, description: label };
          });
          renderFilterSelectList();
        }
      })
      .catch(err => {
        console.error("Error al cargar filtros:", err);
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
    if (!serviceListContainer) {
      console.error("serviceListContainer no encontrado");
      return;
    }
    
    fetch("/admin/search_services_ajax?query=", {
      method:"GET",
      headers:{ "X-CSRFToken": getCsrfToken() }
    })
    .then(r=>r.json())
    .then(data=>{
      if(data.status==="ok"){
        serviceListContainer.innerHTML = renderServiceItems(data.services);
      } else {
        console.error("Error al cargar servicios:", data.message || "Error desconocido");
      }
    })
    .catch(err => {
      console.error("Error de red al cargar servicios:", err);
    });

    // Cargamos regex y filtros para que los selects "re" y "fi" funcionen.
    if (typeof loadRegexesAndFilters === 'function') {
      loadRegexesAndFilters();
    }
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

  // Iniciar
  initServicesList();
}); // Fin DOMContentLoaded

