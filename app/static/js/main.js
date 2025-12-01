// app/static/js/main.js

// Función helper para escapar HTML y prevenir XSS
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Función auxiliar para obtener el estado de login desde data-* attributes
function getIsUserLoggedIn() {
  // Buscar en el contenedor principal o en cualquier elemento con el atributo
  const container = document.querySelector('[data-is-user-logged-in]');
  if (container) {
    const value = container.getAttribute('data-is-user-logged-in');
    return value === 'true';
  }
  // Fallback: asumir que no está logueado si no se encuentra el atributo
  return false;
}

document.addEventListener("DOMContentLoaded", function () {
  // console.log("main.js loaded!");

  function getCsrfToken() {
    const csrfMeta = document.querySelector('meta[name="csrf_token"]');
    return csrfMeta ? csrfMeta.getAttribute("content") : "";
  }

  // --- INICIO: Lógica movida de search.html --- 

  // Aplica el degradado de colores a los botones de servicio desde data-attributes
  const serviceButtonsForColor = document.querySelectorAll('.service-btn');
  serviceButtonsForColor.forEach(button => {
    const bgColor = button.dataset.bgColor; // Lee data-bg-color
    const gradientColor = button.dataset.gradientColor; // Lee data-gradient-color (con fallback en template)
    
    if (bgColor && gradientColor) {
      // Aplicar degradado - gradientColor ya tiene fallback en el template
      button.style.background = `linear-gradient(135deg, ${bgColor} 0%, ${gradientColor} 100%)`;
    } else if (bgColor) {
      // Fallback a color sólido si solo hay bgColor
      button.style.backgroundColor = bgColor;
    } else {
      // Fallback completo si no hay colores definidos
      button.style.background = `linear-gradient(135deg, #764ba2 0%, #667eea 100%)`;
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
    const icon = toggleThemeBtn.querySelector("i");
    function updateThemeIcon() {
      if (document.body.classList.contains("dark-mode")) {
        icon.className = "fas fa-sun"; // Sol para modo claro
      } else {
        icon.className = "fas fa-moon"; // Luna para modo oscuro
      }
    }
    toggleThemeBtn.addEventListener("click", function() {
      document.body.classList.toggle("dark-mode");
      const isDark = document.body.classList.contains("dark-mode");
      localStorage.setItem("darkMode", isDark.toString());
      updateThemeIcon();
    });
    // Establecer icono inicial del botón
    updateThemeIcon();
  }

  // Seleccionar servicio inicial - MOVIDO DESPUÉS DE DEFINIR FUNCIONES

  // Popup alias (search.html)
  const aliasPopupSearch = document.getElementById("aliasPopup"); 
  const aliasPopupOverlay = document.getElementById("aliasPopupOverlay");
  const aliasListContainerSearch = document.getElementById("aliasListContainer");
  // Seleccionamos el botón de cerrar específico de este popup
  const aliasPopupCloseSearch = document.querySelector("#aliasPopup .alias-popup-close"); 

  // Listener global para iconos de info y cerrar popup (clic fuera)
  document.addEventListener("click", function(e) {
    // Mostrar popup al hacer clic en info-icon
    if (e.target.classList.contains("info-icon")) {
      e.preventDefault();
      e.stopPropagation();
      // ⭐ CORREGIDO: Verificación segura para event.target.closest
      if (!e || !e.target || typeof e.target.closest !== 'function') {
        return;
      }
      const btn = e.target.closest(".service-btn");
      if (!btn) return;
      const aliasesJSON = btn.getAttribute("data-service-aliases");
      if (!aliasesJSON) return;
      let aliases;
      try {
         aliases = JSON.parse(aliasesJSON);
       } catch (err) {
         aliases = [];
       }
      if (aliases.length > 0) { // Solo mostrar si hay aliases
        showAliasPopupSearch(aliases);
      }
    }
    
    // Cerrar popup de alias haciendo clic FUERA o en el overlay
    if (aliasPopupSearch && aliasPopupSearch.classList.contains("popup-visible")) {
      // Si el clic fue en el overlay O fuera del popup (pero no en icono de info)
      if (e.target === aliasPopupOverlay || (!aliasPopupSearch.contains(e.target) && !e.target.classList.contains("info-icon"))) {
        closeAliasPopup();
      }
    }
  });

  // Listener específico para el botón CERRAR del popup de alias
  if (aliasPopupCloseSearch && aliasPopupSearch) {
    aliasPopupCloseSearch.addEventListener("click", function() {
      closeAliasPopup();
    });
  }
  
  // Función para cerrar el popup de alias
  function closeAliasPopup() {
    if (aliasPopupSearch) {
      aliasPopupSearch.classList.remove("popup-visible");
    }
    if (aliasPopupOverlay) {
      aliasPopupOverlay.style.display = "none";
    }
  }

  function showAliasPopupSearch(aliases) {
    const popup = document.getElementById("aliasPopup");
    const listContainer = document.getElementById("aliasListContainer");

    if (!popup || !listContainer) {
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
            // Si hay dos colores, usar degradado; si no, usar color sólido
            if (al.alias_color2 && al.alias_color2 !== al.alias_color) {
                div.style.background = `linear-gradient(135deg, ${al.alias_color || '#888'}, ${al.alias_color2})`;
            } else {
                div.style.backgroundColor = al.alias_color || '#888';
            }
        } catch (styleErr) {
            div.style.backgroundColor = '#888';
        }
        div.style.color = "#fff";
        div.style.border = "none";
        div.style.borderRadius = "20px";
        div.style.fontSize = "1rem";
        div.style.margin = "0.2rem 0px";
        div.style.padding = "0.5rem 1rem";
        div.style.wordWrap = "break-word";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.gap = "0.1rem";

        if (al.alias_icons && al.alias_icons.length > 0) {
          al.alias_icons.forEach(iconName => {
            const img = document.createElement("img");
            img.src = decideIconPath(iconName);
            img.style.height = "1.9rem";
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
    // Mostrar el overlay y el popup
    if (aliasPopupOverlay) {
      aliasPopupOverlay.style.display = "block";
    }
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
      }
  } // --- FIN Lógica movida --- 

  // --- FIN: Lógica movida de search.html ---

  const path = window.location.pathname;
  const serviceButtons = document.querySelectorAll(".service-btn");

  function selectService(button) {
    // Quitar selección y ocultar GIF en todos los .service-btn
    serviceButtons.forEach(btn => {
      btn.classList.remove("selected-service");
      // ⭐ CORREGIDO: Verificación segura para closest
      const container = btn && typeof btn.closest === 'function' ? btn.closest(".service-btn-container") : null;
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

    // ⭐ CORREGIDO: Verificación segura para closest
    const currentContainer = button && typeof button.closest === 'function' ? button.closest(".service-btn-container") : null;
    if (currentContainer) {
      const gif = currentContainer.querySelector(".gif-outside");
      if (gif) {
        gif.style.display = "block";
      }
    }
  }

  // Variable para rastrear el botón actualmente seleccionado
  let currentSelectedButton = null;

  // Función para aplicar efecto de clic persistente
  function applyClickEffect(button) {
    const clickColor1 = button.dataset.clickColor1 || '#031faa';
    const clickColor2 = button.dataset.clickColor2 || '#031faa';
    
    // Restaurar el botón anteriormente seleccionado a su estado normal
    if (currentSelectedButton && currentSelectedButton !== button) {
      restoreButtonToNormal(currentSelectedButton);
    }
    
    // Aplicar colores de clic persistentes al botón actual
    button.style.background = `linear-gradient(135deg, ${clickColor1} 0%, ${clickColor2} 100%)`;
    button.style.transform = 'scale(0.98)';
    button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
    button.classList.add('service-btn-selected');
    
    // Actualizar el botón actualmente seleccionado
    currentSelectedButton = button;
  }
  
  // Función para restaurar un botón a su estado normal
  function restoreButtonToNormal(button) {
    const originalBgColor = button.dataset.bgColor || '#764ba2';
    const originalGradientColor = button.dataset.gradientColor || '#667eea';
    
    button.style.background = `linear-gradient(135deg, ${originalBgColor} 0%, ${originalGradientColor} 100%)`;
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '';
    button.classList.remove('service-btn-selected');
  }

  serviceButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      selectService(btn);
      
      // Aplicar efecto de clic con colores personalizados
      applyClickEffect(btn);
    });
  });

  // ✅ SELECCIONAR SERVICIO INICIAL CON EFECTO VISUAL
  const hiddenServiceId = document.getElementById("selectedServiceId");
  if (hiddenServiceId) {
    // Primero intentar seleccionar un servicio visible
    const firstVisibleContainer = document.querySelector(".service-btn-container:not([style*='display: none'])");
    
    if (firstVisibleContainer) {
      // Hay servicios visibles, seleccionar el primero
      const firstBtn = firstVisibleContainer.querySelector(".service-btn");
      if (firstBtn) {
        const firstId = firstBtn.getAttribute("data-service-id");
        hiddenServiceId.value = firstId;
        firstBtn.classList.add("selected-service");
        const gif = firstVisibleContainer.querySelector(".gif-outside");
        if (gif) gif.style.display = "block";
        
        // ✅ APLICAR EFECTO VISUAL DE SELECCIÓN
        applyClickEffect(firstBtn);
      }
    } else {
      // No hay servicios visibles
      // Buscar servicios ocultos (on-no-usuarios-no-visible o codigos-2)
      // Primero intentar con selector de estilo inline (on-no-usuarios-no-visible)
      let hiddenContainer = document.querySelector(".service-btn-container[style*='display: none'] .service-btn-hidden");
      
      // Si no se encuentra, buscar por clase .hidden (codigos-2)
      if (!hiddenContainer) {
        hiddenContainer = document.querySelector(".service-btn-container.hidden .service-btn-hidden");
      }
      
      if (hiddenContainer) {
        const hiddenId = hiddenContainer.getAttribute("data-service-id");
        hiddenServiceId.value = hiddenId;
        hiddenContainer.classList.add("selected-service");
        console.log("Servicio oculto seleccionado automáticamente:", hiddenId);
      } else {
        // No se encontró ningún servicio oculto
        console.log("No se encontraron servicios ocultos disponibles");
      }
    }
  }

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
        if (getIsUserLoggedIn()) {
          alert("No tienes servicios disponibles. Contacta al administrador para que te asigne servicios con modo 'on-usuarios'.");
        } else {
          alert("Por favor, selecciona un servicio antes de buscar.");
        }
        return;
      }
      if (!email) {
        return;
      }

      isSubmitting = true; // Marcar como enviando
      if (spinner) {
        spinner.classList.remove('d-none');
        spinner.classList.add('d-block');
      }
      if (resultsDiv) {
        resultsDiv.classList.add('d-none');
        resultsDiv.classList.remove('d-block');
        resultsDiv.innerHTML = "";
      }

      // Detectar si el formulario tiene un endpoint personalizado (para search2.html)
      const searchEndpoint = ajaxSearchForm.getAttribute("data-search-endpoint") || "/api/search_mails";

      fetch(searchEndpoint, {
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
          // Leer el cuerpo de la respuesta como texto primero (solo se puede leer una vez)
          return response.text().then(text => {
            let errorMessage = `Error HTTP ${response.status}`;
            
            // Intentar parsear como JSON
            try {
              const errData = JSON.parse(text);
              if (errData.error) {
                errorMessage = errData.error;
              }
            } catch (parseError) {
              // Si no se puede parsear, intentar extraer con regex
              const errorMatch = text.match(/"error"\s*:\s*"([^"]+)"/);
              if (errorMatch && errorMatch[1]) {
                errorMessage = errorMatch[1];
              }
            }
            
            // Mensaje especial para 403
            if (response.status === 403) {
              throw new Error("No tienes permiso al consultar este correo");
            }
            
            // Lanzar error con el mensaje extraído
            throw new Error(errorMessage);
          });
        }
        return response.json();
      })
      .then(data => {
        if (spinner) {
          spinner.classList.add('d-none');
          spinner.classList.remove('d-block');
        }

        if (data.error) {
          if (resultsDiv) {
            resultsDiv.classList.remove('d-none');
            resultsDiv.classList.add('d-block');
            const errorDiv = document.createElement('div');
            errorDiv.className = 'text-danger';
            errorDiv.textContent = `Error: ${escapeHtml(data.error)}`;
            resultsDiv.innerHTML = '';
            resultsDiv.appendChild(errorDiv);
          }
          return;
        }

        const results = data.results || [];
        if (results.length === 0) {
          if (resultsDiv) {
            resultsDiv.classList.remove('d-none');
            resultsDiv.classList.add('d-block');
            resultsDiv.innerHTML = `<p>No se encontraron resultados.</p>`;
          }
          return;
        }

        // Verificar si es resultado SMS
        const mail = results[0];
        if (mail.is_sms_result && mail.sms_messages) {
          renderSMSMessages(mail.sms_messages, mail.sms_config_phone, mail.email_searched);
          return;
        }

        // Lógica normal para correos
        const regexDict = mail.regex_matches;
        const mailDateFormatted = mail.formatted_date || "";
        const filterMatched = mail.filter_matched === true;

        let mailContentContainer = document.createElement('div');
        let hasMailContent = false;
        
        if (mail.html) {
          mailContentContainer.innerHTML = mail.html;
          mailContentContainer.classList.add('mail-content');
          mailContentContainer.classList.add('scaled-content');
          hasMailContent = true;
        } else if (mail.text) {
          const pre = document.createElement('pre');
          pre.textContent = mail.text;
          mailContentContainer.appendChild(pre);
          hasMailContent = true;
        }
        if(filterMatched) {
          mailContentContainer.classList.add('filter-match');
        }

        if (resultsDiv) {
          resultsDiv.innerHTML = ''; // Limpiar SIEMPRE antes de añadir

          // 1. Determinar si se renderizará Regex
          const regexWillRender = (regexDict && Object.keys(regexDict).length > 0);
          // 2. Determinar si hay contenido de filtro
          const hasFilterContent = hasMailContent;

          // 3. LÓGICA DE PRIORIDAD: Si hay filtro Y regex, mostrar solo filtro
          if (hasFilterContent && regexWillRender) {
            // CASO 1: Hay ambos - mostrar solo FILTRO
            const mainContainer = document.createElement('div');
            mainContainer.classList.add('regex-result-container');
            mainContainer.style.textAlign = 'center';

            // Añadir el contenido del filtro
            mainContainer.appendChild(mailContentContainer);

            // Añadir fecha para filtros
            if (mailDateFormatted) {
              const pDateOnly = document.createElement('p');
              pDateOnly.classList.add('regex-result-date-only');
              
              // Separar fecha y hora
              const parts = mailDateFormatted.split('  '); // Doble espacio para separar
              if (parts.length === 2) {
                const [datePart, timePart] = parts;
                pDateOnly.innerHTML = `Fecha: <span class="date-part">${escapeHtml(datePart)}</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class="time-part">${escapeHtml(timePart)}</span>`;
              } else {
                pDateOnly.textContent = `Fecha: ${mailDateFormatted}`;
              }
              
              mainContainer.appendChild(pDateOnly);
            }

            resultsDiv.appendChild(mainContainer);
          } else if (regexWillRender) {
            // CASO 2: Solo hay regex - mostrar REGEX
            const regexElement = renderRegexMatches(regexDict, mailDateFormatted);
            if (regexElement) { // Asegurarse de que no sea null/undefined
              resultsDiv.appendChild(regexElement);
            }
          } else if (hasFilterContent) {
            // CASO 3: Solo hay filtro - mostrar FILTRO
            const mainContainer = document.createElement('div');
            mainContainer.classList.add('regex-result-container');
            mainContainer.style.textAlign = 'center';

            // Añadir el contenido del filtro
            mainContainer.appendChild(mailContentContainer);

            // Añadir fecha para filtros
            if (mailDateFormatted) {
              const pDateOnly = document.createElement('p');
              pDateOnly.classList.add('regex-result-date-only');
              
              // Separar fecha y hora
              const parts = mailDateFormatted.split('  '); // Doble espacio para separar
              if (parts.length === 2) {
                const [datePart, timePart] = parts;
                pDateOnly.innerHTML = `Fecha: <span class="date-part">${escapeHtml(datePart)}</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class="time-part">${escapeHtml(timePart)}</span>`;
              } else {
                pDateOnly.textContent = `Fecha: ${mailDateFormatted}`;
              }
              
              mainContainer.appendChild(pDateOnly);
            }

            resultsDiv.appendChild(mainContainer);
          }

          // 4. Mostrar el contenedor y añadir listeners
          resultsDiv.classList.remove('d-none');
          resultsDiv.classList.add('d-block');
          attachCopyButtonListener();
        }
      })
      .catch(err => {
        if (spinner) {
          spinner.classList.add('d-none');
          spinner.classList.remove('d-block');
        }
        if (resultsDiv) {
          resultsDiv.classList.remove('d-none');
          resultsDiv.classList.add('d-block');
          // Ajuste => sin "Error de red:", solo el mensaje en grande
          const errorDiv = document.createElement('div');
          errorDiv.className = 'text-danger error-message-large';
          errorDiv.textContent = escapeHtml(err.message);
          resultsDiv.innerHTML = '';
          resultsDiv.appendChild(errorDiv);
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
    
    // Si no hay matches, no devolver nada (evita cards vacíos)
    if (allMatches.length === 0) {
      return null;
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
    copyButton.classList.add('btn', 'btn-search', 'btn-rounded', 'regex-result-copy-btn'); 
    copyButton.id = "copyRegexBtn";
    copyButton.setAttribute("data-valor", primerCodigo);
    copyButton.textContent = "Copiar";
    buttonsContainer.appendChild(copyButton); // Añadir al contenedor de botones

    // Botón Abrir Enlace (solo si es link)
    if (isLink) {
      const openLinkButton = document.createElement('button');
      openLinkButton.classList.add('btn', 'btn-search', 'btn-rounded', 'regex-result-open-link-btn'); 
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
      
      // Separar fecha y hora
      const parts = mailDateFormatted.split('  '); // Doble espacio para separar
      if (parts.length === 2) {
        const [datePart, timePart] = parts;
        pDate.innerHTML = `Fecha: <span class="date-part">${escapeHtml(datePart)}</span>&nbsp;&nbsp;&nbsp;&nbsp;<span class="time-part">${escapeHtml(timePart)}</span>`;
      } else {
        pDate.textContent = `Fecha: ${mailDateFormatted}`;
      }
      
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
            copyBtn.textContent = "COPIADO";
            // Mantener las clases btn-search btn-rounded y agregar estado copiado
            copyBtn.classList.add('copied-state');
            
            // Volver al estado normal después de 2 segundos
            setTimeout(() => {
              copyBtn.textContent = "COPIAR";
              copyBtn.classList.remove('copied-state');
            }, 2000);
          })
          .catch((err) => {
            copyBtn.textContent = "ERROR";
            // Agregar clase de error manteniendo btn-search btn-rounded
            copyBtn.classList.add('error-state');
            
            // Volver al estado normal después de 2 segundos
            setTimeout(() => {
              copyBtn.textContent = "COPIAR";
              copyBtn.classList.remove('error-state');
            }, 2000);
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

  function renderSMSMessages(messages, smsConfigPhone, emailSearched) {
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = '';
    resultsDiv.classList.remove('d-none');
    resultsDiv.classList.add('d-block');
    
    if (!messages || messages.length === 0) {
      const noMessages = document.createElement('p');
      noMessages.textContent = 'No se encontraron mensajes.';
      noMessages.classList.add('text-center');
      resultsDiv.appendChild(noMessages);
      return;
    }
    
    // Crear contenedor principal
    const container = document.createElement('div');
    container.classList.add('regex-result-container', 'text-center');
    
    // Si hay solo 1 código, mostrarlo como antes
    if (messages.length === 1) {
      const firstMessage = messages[0];
      const messageText = firstMessage.message_body || '';
      
      const pCode = document.createElement('p');
      pCode.classList.add('regex-result-code');
      
      const strongCode = document.createElement('strong');
      strongCode.id = "regex-code";
      strongCode.textContent = messageText;
      
      pCode.appendChild(strongCode);
      container.appendChild(pCode);
      
      // Botón Copiar
      const buttonsContainer = document.createElement('div');
      buttonsContainer.classList.add('mt-05');
      
      const copyButton = document.createElement('button');
      copyButton.classList.add('btn', 'btn-search', 'btn-rounded', 'regex-result-copy-btn');
      copyButton.id = "copyRegexBtn";
      copyButton.setAttribute("data-valor", messageText);
      copyButton.textContent = "Copiar";
      buttonsContainer.appendChild(copyButton);
      container.appendChild(buttonsContainer);
      
      // Si hay fecha, mostrarla
      if (firstMessage.created_at) {
        const pDate = document.createElement('p');
        pDate.classList.add('regex-result-date');
        // Formatear fecha: convertir "30/11/2025|01:48 AM" a "30/11/2025 01:48 AM"
        const formattedDate = firstMessage.created_at.replace('|', ' ');
        pDate.textContent = `Fecha: ${formattedDate}`;
        container.appendChild(pDate);
      }
    } else {
      // Si hay múltiples códigos (hasta 15), mostrar cada uno con código, botón copiar y fecha en la misma línea
      messages.forEach((msg, index) => {
        const messageText = msg.message_body || '';
        
        // Contenedor para cada código
        const codeContainer = document.createElement('div');
        codeContainer.classList.add('sms-code-container');
        
        // Código
        const strongCode = document.createElement('strong');
        strongCode.classList.add('regex-result-code', 'sms-code-text');
        strongCode.textContent = messageText;
        codeContainer.appendChild(strongCode);
        
        // Botón Copiar
        const copyButton = document.createElement('button');
        copyButton.classList.add('btn', 'btn-search', 'btn-rounded', 'regex-result-copy-btn', 'sms-copy-btn');
        copyButton.setAttribute("data-valor", messageText);
        copyButton.textContent = "Copiar";
        
        // Agregar listener directamente al botón usando la misma función que el botón único
        copyButton.addEventListener('click', function() {
          const valorACopiar = this.getAttribute("data-valor") || "";
          if (valorACopiar) {
            copyTextToClipboard(valorACopiar)
              .then(() => {
                const originalText = this.textContent;
                this.textContent = "COPIADO";
                this.classList.add('copied-state');
                
                setTimeout(() => {
                  this.textContent = originalText;
                  this.classList.remove('copied-state');
                }, 2000);
              })
              .catch((err) => {
                const originalText = this.textContent;
                this.textContent = "ERROR";
                this.classList.add('error-state');
                
                setTimeout(() => {
                  this.textContent = originalText;
                  this.classList.remove('error-state');
                }, 2000);
              });
          }
        });
        
        codeContainer.appendChild(copyButton);
        
        // Fecha y hora
        if (msg.created_at) {
          const spanDate = document.createElement('span');
          spanDate.classList.add('regex-result-date', 'sms-date-text');
          // Formatear fecha: convertir "30/11/2025|01:48 AM" a "30/11/2025 01:48 AM"
          const formattedDate = msg.created_at.replace('|', ' ');
          spanDate.textContent = formattedDate;
          codeContainer.appendChild(spanDate);
        }
        
        container.appendChild(codeContainer);
      });
    }
    
    resultsDiv.appendChild(container);
    
    // Si solo hay un mensaje, adjuntar listener para el botón copiar
    if (messages.length === 1) {
      attachCopyButtonListener();
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
    if (overlay) {
      overlay.classList.add('d-none');
      overlay.classList.remove('d-block');
    }
    document.body.classList.remove('d-none');
    document.body.classList.add('d-block');
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
              resendMsgCreds.textContent = `Error: ${err.message}`;
              resendMsgCreds.style.color = "red";
              resendBtnCreds.disabled = false; // Habilitar de nuevo si hay error
              resendBtnCreds.textContent = "Reenviar código";
          });
      });
  }

  // --- INICIO: Navegación genérica con data-url --- 
  document.body.addEventListener('click', function(event) {
    // ⭐ CORREGIDO: Usar verificación segura para event.target.closest
    if (!event || !event.target || typeof event.target.closest !== 'function') {
      return;
    }
    
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
              alert('Error de red o del servidor al limpiar el log: ' + error.message);
          });
      });
  }
  // --- FIN: Listener para Limpiar Log ---

}); // Fin DOMContentLoaded
