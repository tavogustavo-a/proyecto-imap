// app/static/js/admin_services_edit.js

document.addEventListener("DOMContentLoaded", function() {
    // ALIAS
    let currentServiceIdForAlias=null;
    const aliasPopup=document.getElementById("aliasPopup");
    const aliasNameInput=document.getElementById("aliasNameInput");
    const aliasColorInput=document.getElementById("aliasColorInput");
    const aliasCreateBtn=document.getElementById("aliasCreateBtn");
    const aliasCancelBtn=document.getElementById("aliasCancelBtn");
  
    const editAliasPopup=document.getElementById("editAliasPopup");
    const editAliasId=document.getElementById("editAliasId");
    const editAliasName=document.getElementById("editAliasName");
    const editAliasColor=document.getElementById("editAliasColor");
    const editAliasSaveBtn=document.getElementById("editAliasSaveBtn");
    const editAliasCancelBtn=document.getElementById("editAliasCancelBtn");
  
    // Seleccionar también el input de color del servicio
    const serviceColorInput = document.getElementById("border_color_input"); 
  
    // --- Forzar formato de color correcto al cargar --- 
    if (serviceColorInput && serviceColorInput.value === "#333") {
        serviceColorInput.value = "#333333";
    }
    if (aliasColorInput && aliasColorInput.value === "#333") {
        aliasColorInput.value = "#333333";
    }
     if (editAliasColor && editAliasColor.value === "#333") {
        editAliasColor.value = "#333333";
    }
    // -------------------------------------------------
  
    if(aliasCreateBtn && aliasCancelBtn && aliasPopup){
      aliasCreateBtn.addEventListener("click",()=>{
        if(!currentServiceIdForAlias) {
            console.error("No hay currentServiceIdForAlias");
            return;
        }
        const n = aliasNameInput ? aliasNameInput.value.trim() : '';
        const c = aliasColorInput ? (aliasColorInput.value.trim()||"#333") : '#333';
        if(!n){
          alert("Alias vacío.");
          return;
        }
        const payload={
          service_id:parseInt(currentServiceIdForAlias),
          alias_name:n,
          alias_color:c
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
              alert("Alias creado.");
              if (aliasPopup) aliasPopup.style.display = 'none'; 
              currentServiceIdForAlias=null;
              location.reload();
            } else {
              alert("Error: "+data.message);
            }
          })
          .catch(err=>console.error("Error createAlias:",err));
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
        const aCol=editAliasColor.value.trim()||"#333";
        if(!aId || !aName){
          alert("Faltan datos del alias");
          return;
        }
        const payload={
          alias_id:parseInt(aId),
          alias_name:aName,
          alias_color:aCol
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
              alert("Alias actualizado.");
              if (editAliasPopup) editAliasPopup.classList.remove('popup-visible'); 
              location.reload();
            } else {
              alert("Error: "+data.message);
            }
          })
          .catch(err=>console.error("Error updateAlias:",err));
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
            alert("Alias eliminado.");
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>console.error("Error deleteAlias:",err));
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
          console.error("Error: No se encontró overlay, grid o container...");
          return;
      } 
      
      overlay.classList.add('popup-visible'); 
      container.classList.add('popup-visible'); 
      grid.innerHTML = "";
  
      for(let i=1;i<=24;i++){
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
            alert("Ícono agregado al alias.");
            aliasIconGridOverlay.classList.remove('popup-visible');
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>console.error("Error addAliasIcon:",err));
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
            alert("Ícono de alias eliminado.");
            location.reload();
          } else {
            alert("Error: " + data.message);
          }
        })
        .catch(err=>console.error("Error deleteAliasIcon:", err));
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
            alert("Filtro desvinculado.");
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>console.error("Error unlinkFilter:",err));
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
            alert("Regex desvinculado.");
            location.reload();
          } else {
            alert("Error: "+data.message);
          }
        })
        .catch(err=>console.error("Error unlinkRegex:",err));
    }
  
    document.addEventListener("click",(e)=>{
      // +Alias
      if(e.target.classList.contains("open-alias-popup")){
        e.preventDefault();
        currentServiceIdForAlias = e.target.getAttribute("data-service-id");
        if(aliasNameInput) aliasNameInput.value="";
        if(aliasColorInput) { aliasColorInput.value="#333333"; }

        // Mostrar con style.display = 'block'
        if(aliasPopup) { 
            aliasPopup.style.display = 'block'; 
        } else {
            console.error("No se encontró #aliasPopup al hacer clic");
        }
      }
  
      // Edit alias
      if(e.target.classList.contains("edit-alias-btn")){
        e.preventDefault();
        const aId=e.target.getAttribute("data-alias-id");
        const aName=e.target.getAttribute("data-alias-name");
        const aColor=e.target.getAttribute("data-alias-color")||"#333";
        if(editAliasId) editAliasId.value=aId;
        if(editAliasName) editAliasName.value=aName;
        if(editAliasColor) editAliasColor.value=aColor;
        if(editAliasPopup) { 
            editAliasPopup.classList.add('popup-visible'); 
        } else {
            console.error("No se encontró #editAliasPopup para mostrar");
        }
      }
  
      // Delete alias
      if(e.target.classList.contains("delete-alias-btn")){
        e.preventDefault();
        const aId=e.target.getAttribute("data-alias-id");
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
      if(e.target.classList.contains("delete-alias-icon")){
        e.preventDefault();
        const iconId = e.target.getAttribute("data-icon-id");
        if(!confirm("¿Eliminar este ícono del alias?")) return;
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
      if(fileName.toLowerCase().startsWith("gif")){
        return "/static/images/gifs/"+fileName;
      }
      return "/static/images/"+fileName;
    }
    function getCsrfToken(){
      const meta=document.querySelector('meta[name="csrf_token"]');
      return meta? meta.getAttribute('content'):"";
    }

    // --- Selectores Botones Navegación --- 
    const btnVolverPanel = document.getElementById("btnVolverPanelEditSrv");
    const btnVolverServicios = document.getElementById("btnVolverServiciosEditSrv");
    const btnCancelar = document.getElementById("btnCancelarEditSrv");

    // --- Helper Navegación --- 
    function navigateToUrl(button) {
        if (button) {
            const url = button.dataset.url;
            if (url) {
                window.location.href = url;
            } else {
                console.error("No data-url found for button:", button);
            }
        }
    }

    // --- Listeners Navegación --- 
    if(btnVolverPanel) btnVolverPanel.addEventListener("click", () => navigateToUrl(btnVolverPanel));
    if(btnVolverServicios) btnVolverServicios.addEventListener("click", () => navigateToUrl(btnVolverServicios));
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
                console.error("Error aplicando border-left:", e, "Color:", color);
                item.style.borderLeft = `4px solid #ccc`; // Fallback
            }
        } else {
            item.style.borderLeft = `4px solid #ccc`; // Fallback si no hay data
        }
    });
    // --- Fin aplicar borde --- 
});
  