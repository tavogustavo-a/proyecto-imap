// app/static/js/main.js

document.addEventListener("DOMContentLoaded", function () {
  // console.log("main.js loaded!");

  // --- INICIO: Lógica movida de search.html --- 

  // Aplica el color de fondo a los botones de servicio desde data-attribute
  const serviceButtonsForColor = document.querySelectorAll('.service-btn');
  serviceButtonsForColor.forEach(button => {
    const bgColor = button.dataset.bgColor; // Lee data-bg-color
    if (bgColor) {
      button.style.backgroundColor = bgColor;
    }
  });

  // --- NUEVO: Aplicar opacidad dinámica --- 
  const bodyElement = document.body;
  if (bodyElement && bodyElement.dataset.opacity) {
    const opacityValue = bodyElement.dataset.opacity;
    // Aplicar al elemento raíz (html) para que la variable esté disponible globalmente
    document.documentElement.style.setProperty('--card-opacity', opacityValue);
    // console.log(`Opacidad dinámica aplicada: ${opacityValue}`); // Para depuración
  }
  // --- FIN: Aplicar opacidad dinámica --- 

  // MODO OSCURO
  const savedTheme = localStorage.getItem("darkMode") === "true";
  if (savedTheme) {
    document.body.classList.add("dark-mode");
  }
  const toggleThemeBtn = document.getElementById("toggleThemeBtn");
  if (toggleThemeBtn) {
    toggleThemeBtn.addEventListener("click", function() {
      document.body.classList.toggle("dark-mode");
      const isDark = document.body.classList.contains("dark-mode");
      localStorage.setItem("darkMode", isDark.toString());
      toggleThemeBtn.textContent = isDark ? "Modo Claro" : "Modo Oscuro";
    });
    // Establecer texto inicial del botón
    toggleThemeBtn.textContent = document.body.classList.contains("dark-mode") ? "Modo Claro" : "Modo Oscuro";
  }

  // Mostrar GIF en el primer container (y seleccionar servicio inicial)
  const firstContainer = document.querySelector(".service-btn-container");
  const hiddenServiceId = document.getElementById("selectedServiceId");
  if (firstContainer && hiddenServiceId) {
    const firstBtn = firstContainer.querySelector(".service-btn");
    if (firstBtn) {
        const firstId = firstBtn.getAttribute("data-service-id");
        hiddenServiceId.value = firstId; // Seleccionar el primero por defecto
        firstBtn.classList.add("selected-service"); // Marcarlo como seleccionado
        const gif = firstContainer.querySelector(".gif-outside");
        if (gif) gif.style.display = "block";
    } 
  }

  // Popup alias (search.html)
  const aliasPopupSearch = document.getElementById("aliasPopup"); 
  const aliasListContainerSearch = document.getElementById("aliasListContainer");
  // Seleccionamos el botón de cerrar específico de este popup
  const aliasPopupCloseSearch = document.querySelector("#aliasPopup .alias-popup-close"); 

  // Listener global para iconos de info y cerrar popup (clic fuera)
  document.addEventListener("click", function(e) {
    // Mostrar popup al hacer clic en info-icon
    if (e.target.classList.contains("info-icon")) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest(".service-btn");
      if (!btn) return;
      const aliasesJSON = btn.getAttribute("data-service-aliases");
      if (!aliasesJSON) return;
      let aliases;
      try {
         aliases = JSON.parse(aliasesJSON);
       } catch (err) {
         console.error("Error parsing aliases JSON:", err);
         aliases = [];
       }
      if (aliases.length > 0) { // Solo mostrar si hay aliases
        showAliasPopupSearch(aliases);
      }
    }
    
    // Cerrar popup de alias haciendo clic FUERA
    if (aliasPopupSearch && aliasPopupSearch.classList.contains("popup-visible")) {
      // Si el clic NO fue dentro del popup Y NO fue en un icono de info
      if (!aliasPopupSearch.contains(e.target) && !e.target.classList.contains("info-icon")) {
        aliasPopupSearch.classList.remove("popup-visible");
      }
    }
  });

  // Listener específico para el botón CERRAR del popup de alias
  if (aliasPopupCloseSearch && aliasPopupSearch) {
    aliasPopupCloseSearch.addEventListener("click", function() {
      aliasPopupSearch.classList.remove("popup-visible");
    });
  }

  function showAliasPopupSearch(aliases) {
    const popup = document.getElementById("aliasPopup");
    const listContainer = document.getElementById("aliasListContainer");

    if (!popup || !listContainer) {
        console.error("aliasPopup o aliasListContainer no encontrados DENTRO de showAliasPopupSearch!"); 
        return;
    }

    listContainer.innerHTML = "";

    if (!aliases || aliases.length === 0) {
      listContainer.innerHTML = "<p>No hay aliases</p>";
    } else {
      aliases.forEach(al => {
        const div = document.createElement("div");
        div.classList.add("alias-popup-item");
        try {
            div.style.backgroundColor = al.alias_color || '#888';
        } catch (styleErr) {
            console.error("Error setting background color:", styleErr, "Color:", al.alias_color);
            div.style.backgroundColor = '#888';
        }
        div.style.color = "#fff";
        div.style.border = "none";
        div.style.borderRadius = "20px";
        div.style.fontSize = "1.6rem";
        div.style.margin = "0.2rem 0";
        div.style.padding = "0.5rem 1rem";
        div.style.wordWrap = "break-word";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.gap = "0.1rem";

        if (al.alias_icons && al.alias_icons.length > 0) {
          al.alias_icons.forEach(iconName => {
            const img = document.createElement("img");
            img.src = decideIconPath(iconName);
            img.style.height = "2.3rem";
            img.style.marginRight = "0.2rem";
            img.style.verticalAlign = "middle"; // Añadido para asegurar alineación
            div.appendChild(img);
          });
        }
        const textSpan = document.createElement("span");
        textSpan.textContent = al.alias_name;
        div.appendChild(textSpan);
        listContainer.appendChild(div);
      });
    }
    // Asegurar que el popup correcto se muestra
    if(popup) popup.classList.add('popup-visible');
  }

  // Botón "Volver a Búsqueda" (si existe en la página actual - login o user_login)
  const btnVolverBusquedaSearch = document.getElementById("btnVolverBusquedaSearch");
  if (btnVolverBusquedaSearch) {
    const homeUrlSearch = btnVolverBusquedaSearch.dataset.homeUrl;
    if (homeUrlSearch) {
      btnVolverBusquedaSearch.addEventListener("click", () => {
        window.location.href = homeUrlSearch;
      });
    }
  }
  
  // --- Botón "Volver al Panel" de parrafos.html --- 
  const btnVolverPanelParrafos = document.getElementById("btnVolverPanelParrafos");
  if (btnVolverPanelParrafos) {
      const dashboardUrlParrafos = btnVolverPanelParrafos.dataset.dashboardUrl;
      if (dashboardUrlParrafos) {
          btnVolverPanelParrafos.addEventListener("click", () => {
              window.location.href = dashboardUrlParrafos;
          });
      } else {
          console.error("No se encontró data-dashboard-url en #btnVolverPanelParrafos");
      }
  }
  // --- FIN Lógica movida --- 

  // --- FIN: Lógica movida de search.html ---

  const path = window.location.pathname;
  const serviceButtons = document.querySelectorAll(".service-btn");

  function selectService(button) {
    // Quitar selección y ocultar GIF en todos los .service-btn
    serviceButtons.forEach(btn => {
      btn.classList.remove("selected-service");
      const container = btn.closest(".service-btn-container");
      if (container) {
        const gif = container.querySelector(".gif-outside");
        if (gif) {
          gif.style.display = "none";
        }
      }
    });

    button.classList.add("selected-service");
    const sid = button.getAttribute("data-service-id");
    if (hiddenServiceId) hiddenServiceId.value = sid;

    const currentContainer = button.closest(".service-btn-container");
    if (currentContainer) {
      const gif = currentContainer.querySelector(".gif-outside");
      if (gif) {
        gif.style.display = "block";
      }
    }
  }

  serviceButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      selectService(btn);
    });
  });

  // ================== BÚSQUEDA AJAX ==================
  const ajaxSearchForm = document.getElementById("ajax-search-form");
  const spinner = document.getElementById("spinner");
  const resultsDiv = document.getElementById("search-results");

  const csrfMeta = document.querySelector('meta[name="csrf_token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  let isSubmitting = false; // Bandera para controlar envíos duplicados

  if (ajaxSearchForm) {
    ajaxSearchForm.addEventListener("submit", function (e) {
      e.preventDefault(); // Prevenir el envío normal
      e.stopImmediatePropagation(); // Prevenir otros listeners
      if (isSubmitting) {
        return;
      }

      const email = document.getElementById("searchEmail").value.trim();
      const serviceId = document.getElementById("selectedServiceId").value.trim();

      if (!serviceId) {
        alert("Por favor, selecciona un servicio antes de buscar.");
        return;
      }
      if (!email) {
        return;
      }

      isSubmitting = true; // Marcar como enviando
      if (spinner) spinner.style.display = "block";
      if (resultsDiv) {
        resultsDiv.style.display = "none";
        resultsDiv.innerHTML = "";
      }

      fetch("/api/search_mails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken
        },
        credentials: "same-origin",
        body: JSON.stringify({
          email_to_search: email,
          service_id: serviceId
        })
      })
      .then(response => {
        // Incorporamos la comprobación de 403 => "No tienes permiso"
        if (!response.ok) {
          if (response.status === 403) {
            // Lanzamos directamente el mensaje
            throw new Error("No tienes permiso al consultar este correo");
          }
          throw new Error(`Error HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (spinner) spinner.style.display = "none";

        if (data.error) {
          if (resultsDiv) {
            resultsDiv.style.display = "block";
            resultsDiv.innerHTML = `<div style="color:red;">Error: ${data.error}</div>`;
          }
          return;
        }

        const results = data.results || [];
        if (results.length === 0) {
          if (resultsDiv) {
            resultsDiv.style.display = "block";
            resultsDiv.innerHTML = `<p>No se encontraron resultados.</p>`;
          }
          return;
        }

        // Tomamos el primer correo
        const mail = results[0];
        const regexDict = mail.regex_matches;
        const mailDateFormatted = mail.formatted_date || "";
        const filterMatched = mail.filter_matched === true;

        let mailContentContainer = document.createElement('div');
        if (mail.html) {
          mailContentContainer.innerHTML = mail.html;
          mailContentContainer.classList.add('mail-content');
          mailContentContainer.classList.add('scaled-content');
        } else if (mail.text) {
          const pre = document.createElement('pre');
          pre.textContent = mail.text;
          mailContentContainer.appendChild(pre);
        }
        if(filterMatched) {
          mailContentContainer.classList.add('filter-match');
        }

        if (resultsDiv) {
          resultsDiv.innerHTML = ''; // Limpiar SIEMPRE antes de añadir

          // 1. Añadir el contenido principal (HTML o Texto)
          resultsDiv.appendChild(mailContentContainer);

          // 2. Determinar si se renderizará Regex
          const regexWillRender = (regexDict && Object.keys(regexDict).length > 0);

          // 3. Añadir solo la fecha SI existe Y SI NO se renderizará Regex
          if (!regexWillRender && mailDateFormatted) {
            const pDateOnly = document.createElement('p');
            pDateOnly.style.fontSize = "0.9rem";
            pDateOnly.style.color = "#666";
            pDateOnly.style.marginTop = "0.5rem"; // Mantener margen superior reducido
            pDateOnly.style.textAlign = "left";
            pDateOnly.style.clear = "both";
            pDateOnly.textContent = `Fecha: ${mailDateFormatted}`;
            resultsDiv.appendChild(pDateOnly);
          }

          // 4. Añadir los resultados de Regex (que ya incluyen su propia fecha)
          if (regexWillRender) {
            const regexElement = renderRegexMatches(regexDict, mailDateFormatted);
            if (regexElement) { // Asegurarse de que no sea null/undefined
              resultsDiv.appendChild(regexElement);
            }
          }

          // 5. Mostrar el contenedor y añadir listeners
          resultsDiv.style.display = "block";
          attachCopyButtonListener();
        }
      })
      .catch(err => {
        if (spinner) spinner.style.display = "none";
        if (resultsDiv) {
          resultsDiv.style.display = "block";
          // Ajuste => sin "Error de red:", solo el mensaje en grande
          resultsDiv.innerHTML = `
            <div style="color:red; font-size:1.2rem;">
              ${err.message}
            </div>
          `;
        }
      })
      .finally(() => {
        isSubmitting = false; // Permitir nuevos envíos
      });
    });
  }

  function renderRegexMatches(regexMatches, mailDateFormatted) {
    let allMatches = [];
    for (const rId in regexMatches) {
      allMatches = allMatches.concat(regexMatches[rId]);
    }
    
    const baseElement = document.createElement('div');

    if (allMatches.length === 0) {
      const pNoResults = document.createElement('p');
      pNoResults.textContent = "No se encontraron resultados de regex.";
      baseElement.appendChild(pNoResults);
      if (mailDateFormatted) {
          const pDateOnly = document.createElement('p');
          pDateOnly.classList.add('regex-result-date-only'); 
          pDateOnly.textContent = `Fecha: ${mailDateFormatted}`;
          baseElement.appendChild(pDateOnly);
      }
      return baseElement;
    }

    let primerCodigo = allMatches[0];
    if (Array.isArray(primerCodigo)) {
      primerCodigo = primerCodigo.join("");
    } else {
      primerCodigo = String(primerCodigo);
    }

    const isLink = /^(https?:\/\/|www\.)/i.test(primerCodigo.trim());
    const MAX_LEN = 50;
    let displayText = primerCodigo;
    if (displayText.length > MAX_LEN) {
      displayText = displayText.slice(0, MAX_LEN - 3) + "...";
    }

    // --- Construcción con DOM APIs y Clases CSS ---
    const divContainer = document.createElement('div');
    divContainer.classList.add('regex-result-container');
    divContainer.style.textAlign = 'center'; // <--- CENTRAR CONTENIDO

    const pCode = document.createElement('p');
    pCode.classList.add('regex-result-code');

    const strongCode = document.createElement('strong');
    strongCode.id = "regex-code";
    strongCode.textContent = displayText;

    pCode.appendChild(strongCode);
    divContainer.appendChild(pCode);

    // Crear contenedor para botones
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.marginTop = '0.5rem'; // Espacio entre texto y botones
    // No es necesario centrar este div, ya que divContainer ya centra

    // Botón Copiar (siempre visible)
    const copyButton = document.createElement('button');
    copyButton.classList.add('btn', 'btn-blue', 'regex-result-copy-btn'); 
    copyButton.id = "copyRegexBtn";
    copyButton.setAttribute("data-valor", primerCodigo);
    copyButton.textContent = "Copiar";
    buttonsContainer.appendChild(copyButton); // Añadir al contenedor de botones

    // Botón Abrir Enlace (solo si es link)
    if (isLink) {
      const openLinkButton = document.createElement('button');
      openLinkButton.classList.add('btn', 'btn-green', 'regex-result-open-link-btn'); 
      openLinkButton.id = "openLinkBtn";
      openLinkButton.setAttribute("data-link", primerCodigo);
      openLinkButton.textContent = "Abrir Enlace";
      buttonsContainer.appendChild(openLinkButton); // Añadir al contenedor de botones
    }
    
    divContainer.appendChild(buttonsContainer); // Añadir el contenedor de botones al principal

    // Párrafo de Fecha (si aplica)
    if (mailDateFormatted) {
      const pDate = document.createElement('p');
      pDate.classList.add('regex-result-date');
      pDate.textContent = `Fecha: ${mailDateFormatted}`;
      divContainer.appendChild(pDate);
    }

    return divContainer;
  }

  function attachCopyButtonListener() {
    const copyBtn = document.getElementById("copyRegexBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function() {
        const valorACopiar = copyBtn.getAttribute("data-valor") || "";
        copyTextToClipboard(valorACopiar)
          .then(() => {
            copyBtn.textContent = "Copiado";
            copyBtn.classList.remove('btn-blue');
            copyBtn.classList.remove('btn-red'); 
            copyBtn.classList.add('btn-green');
          })
          .catch((err) => {
            console.error("Error al copiar:", err);
            copyBtn.textContent = "Error";
            copyBtn.classList.remove('btn-blue');
            copyBtn.classList.remove('btn-green'); 
            copyBtn.classList.add('btn-red');
          });
      });
    }

    const openLinkBtn = document.getElementById("openLinkBtn");
    if (openLinkBtn) {
      openLinkBtn.addEventListener("click", function() {
        const link = openLinkBtn.getAttribute("data-link");
        if (link) {
          window.open(link, "_blank");
        }
      });
    }
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    } else {
      return new Promise((resolve, reject) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (successful) {
          resolve();
        } else {
          reject(new Error("Fallback: No se pudo copiar el texto."));
        }
      });
    }
  }

  // Función decideIconPath (movida de search.html)
  function decideIconPath(fileName){
    if (!fileName) return ''; // Añadir chequeo por si acaso
    const lower = fileName.toLowerCase();
    if (lower.startsWith("gif")) {
      return "/static/images/gifs/" + fileName;
    }
    return "/static/images/" + fileName;
  }

  // Quitar overlay de carga al terminar
  window.addEventListener("load", () => {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.style.display = "none";
    document.body.style.display = "block";
  });

  // Verificar si la función existe antes de llamarla
  if (typeof setupVolverButton === 'function') {
    const btnVolverPanelTop = document.getElementById("btnVolverPanelTop"); 
    const btnVolverPanelBottom = document.getElementById("btnVolverPanelBottom"); 
  
    if(btnVolverPanelTop) { 
        setupVolverButton(btnVolverPanelTop);
    }
    if(btnVolverPanelBottom) { 
        setupVolverButton(btnVolverPanelBottom);
    }
  } // Fin de la verificación de setupVolverButton

  // --- Reenvío Código 2FA (Página Verificar Credenciales) ---
  const resendBtnCreds = document.getElementById("resendCodeCredsBtn");
  const resendMsgCreds = document.getElementById("resendCredsMsg");
  let resendCredsTimeout;

  if (resendBtnCreds && resendMsgCreds) {
      resendBtnCreds.addEventListener("click", function() {
          // Deshabilitar botón y limpiar mensaje anterior
          resendBtnCreds.disabled = true;
          resendMsgCreds.textContent = "Enviando...";
          resendMsgCreds.style.color = "orange"; // Color de espera
          clearTimeout(resendCredsTimeout);

          fetch("/admin/resend_2fa_code_for_creds", {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
                  "X-CSRFToken": getCsrfToken()
              },
          })
          .then(response => {
              if (!response.ok) {
                  return response.json().then(errData => { throw new Error(errData.message || `Error ${response.status}`); });
              }
              return response.json();
          })
          .then(data => {
              if (data.status === "ok") {
                  resendMsgCreds.textContent = "Código reenviado.";
                  resendMsgCreds.style.color = "green";
                  // Iniciar cooldown (ej. 60 segundos)
                  let seconds = 60;
                  resendBtnCreds.textContent = `Reenviar (${seconds}s)`;
                  resendCredsTimeout = setInterval(() => {
                      seconds--;
                      if (seconds > 0) {
                          resendBtnCreds.textContent = `Reenviar (${seconds}s)`;
                      } else {
                          clearInterval(resendCredsTimeout);
                          resendBtnCreds.disabled = false;
                          resendBtnCreds.textContent = "Reenviar código";
                          resendMsgCreds.textContent = "";
                      }
                  }, 1000);
              } else {
                  throw new Error(data.message || "Error desconocido al reenviar");
              }
          })
          .catch(err => {
              console.error("Error reenviando código 2FA creds:", err);
              resendMsgCreds.textContent = `Error: ${err.message}`;
              resendMsgCreds.style.color = "red";
              resendBtnCreds.disabled = false; // Habilitar de nuevo si hay error
              resendBtnCreds.textContent = "Reenviar código";
          });
      });
  }

  // --- INICIO: Navegación genérica con data-url --- 
  document.body.addEventListener('click', function(event) {
    // Busca el botón (o enlace) más cercano que tenga data-url
    const targetButton = event.target.closest('[data-url]'); 
    
    if (targetButton && targetButton.dataset.url) {
      // Prevenir comportamiento por defecto si es un enlace <a>
      if (targetButton.tagName === 'A') {
        event.preventDefault(); 
      }
      // Navegar a la URL especificada
      window.location.href = targetButton.dataset.url;
    }
  });
  // --- FIN: Navegación genérica con data-url --- 

  // --- Manejo del botón Exportar Configuración (CON FETCH y mejor manejo de errores) ---
  const btnExportConfig = document.getElementById('btnExportConfig');
  const exportSecurityCodeInput = document.getElementById('exportSecurityCode');
  const exportUrlBase = "/admin/export_config"; 

  if (btnExportConfig && exportSecurityCodeInput) {
      btnExportConfig.addEventListener('click', function() {
          const code = exportSecurityCodeInput.value.trim();
          if (!code) {
              alert('Por favor, ingresa el código de seguridad para exportar.');
              exportSecurityCodeInput.focus();
              return;
          }
          const exportUrl = `${exportUrlBase}?security_code=${encodeURIComponent(code)}`;
          
          fetch(exportUrl, {
              method: 'GET',
              headers: { }
          })
          .then(response => {
              // Si la respuesta NO es OK (ej: 401, 500, etc.)
              if (!response.ok) {
                  // Intentamos leer el cuerpo como JSON para obtener el mensaje de error
                  return response.json().then(errData => {
                      // Lanzamos un error con el mensaje del servidor o uno genérico
                      throw new Error(errData.error || `Error del servidor (${response.status})`);
                  }).catch(() => {
                      // Si el cuerpo no era JSON (ej: redirección inesperada o error HTML)
                      throw new Error(`Error del servidor (${response.status}) o respuesta inesperada.`);
                  });
              }
              // Si la respuesta ES OK (200), procedemos a descargar
              const contentType = response.headers.get("content-type");
              if (contentType && contentType.indexOf("application/json") !== -1) {
                 // Devolvemos el blob directamente para el siguiente .then()
                 return response.blob(); 
              } else {
                 throw new Error('La respuesta recibida no es JSON.');
              }
          })
          .then(blob => {
              // Este .then() solo se ejecuta si la respuesta fue OK y es JSON/blob
              const url = URL.createObjectURL(blob);
              const tempLink = document.createElement('a');
              tempLink.href = url;
              tempLink.setAttribute('download', 'proyectoimap_config.json');
              tempLink.style.display = 'none';
              document.body.appendChild(tempLink);
              tempLink.click();
              document.body.removeChild(tempLink);
              URL.revokeObjectURL(url); 
          })
          .catch(err => {
              // Capturamos TODOS los errores (de red, de servidor, de parseo)
              console.error("Error al exportar:", err);
              // Mostramos el mensaje específico del error que lanzamos antes
              alert(`Error al exportar la configuración: ${err.message}`); 
          });
      });
  }
  // --- Fin Manejo Exportar ---

  // --- NUEVO: Listener para Limpiar Log de Activadores ---
  const btnClearLog = document.getElementById('btnClearTriggerLogBtn');
  if (btnClearLog) {
      btnClearLog.addEventListener('click', function() {
          if (!confirm('¿Estás seguro de que deseas limpiar TODO el log de activadores? Esta acción no se puede deshacer.')) {
              return;
          }
          
          const csrfToken = getCsrfToken(); 
          if (!csrfToken) {
              alert('Error: No se pudo encontrar el token CSRF.');
              return;
          }

          fetch('/admin/clear_trigger_log', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'X-CSRFToken': csrfToken
              },
              body: JSON.stringify({})
          })
          .then(response => {
              if (response.ok) {
                  return response.json(); 
              } else {
                  return response.json().then(errData => {
                      throw new Error(errData.message || `Error ${response.status}: ${response.statusText}`);
                  }).catch(() => {
                      throw new Error(`Error ${response.status}: ${response.statusText}`);
                  });
              }
          })
          .then(data => {
              if (data.status === 'ok') {
                  alert(data.message || 'Log limpiado exitosamente.'); 
                  // Opcional: redirigir para ver el flash del backend si clear_trigger_log redirige
                  // window.location.href = '{{ url_for("admin_bp.dashboard") }}'; // NO USAR JINJA AQUÍ
              } else {
                  alert('Error al limpiar log: ' + (data.message || 'Error desconocido'));
              }
          })
          .catch(error => {
              console.error('Error al limpiar el log:', error);
              alert('Error de red o del servidor al limpiar el log: ' + error.message);
          });
      });
  }
  // --- FIN: Listener para Limpiar Log ---

}); // Fin DOMContentLoaded

function getCsrfToken() {
  const csrfMeta = document.querySelector('meta[name="csrf_token"]');
  return csrfMeta ? csrfMeta.getAttribute("content") : "";
}
