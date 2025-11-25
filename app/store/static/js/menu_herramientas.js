
// Función para agregar labels a elementos problemáticos de YouTube
function fixYouTubeLabels() {
  try {
    // Intentar acceder a elementos dentro de iframes de YouTube
    const iframes = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    
    iframes.forEach(function(iframe) {
      try {
        // Intentar acceder al contenido del iframe (solo funcionará si es del mismo origen)
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        
        if (iframeDoc) {
          // Buscar y corregir checkbox de playlist dentro del iframe
          const playlistCheckbox = iframeDoc.querySelector('.ytp-share-panel-include-playlist-checkbox');
          if (playlistCheckbox && !playlistCheckbox.hasAttribute('data-label-fixed')) {
            // Crear un ID único si no tiene
            if (!playlistCheckbox.id) {
              playlistCheckbox.id = 'ytp-playlist-checkbox-' + Date.now();
            }
            
            // Agregar atributo name si no tiene
            if (!playlistCheckbox.name) {
              playlistCheckbox.name = 'ytp-playlist-checkbox-' + Date.now();
            }
            
            // Verificar si ya tiene un label asociado
            const existingLabel = iframeDoc.querySelector('label[for="' + playlistCheckbox.id + '"]');
            
            if (!existingLabel) {
              // Buscar el label padre que contiene el checkbox
              const parentLabel = playlistCheckbox.closest('label');
              
              if (parentLabel) {
                // Si el label padre existe, asociarlo correctamente
                if (!parentLabel.getAttribute('for')) {
                  parentLabel.setAttribute('for', playlistCheckbox.id);
                }
              } else {
                // Si no hay label padre, crear uno
                const label = iframeDoc.createElement('label');
                label.textContent = 'Incluir en lista de reproducción';
                label.className = 'sr-only'; // Hacer el label invisible
                label.setAttribute('for', playlistCheckbox.id);
                
                // Insertar el label antes del checkbox
                playlistCheckbox.parentNode.insertBefore(label, playlistCheckbox);
              }
            }
            
            // Marcar como corregido para evitar duplicados
            playlistCheckbox.setAttribute('data-label-fixed', 'true');
          }
          
          // Buscar y corregir título de badge sugerido
          const badgeTitle = iframeDoc.querySelector('.ytp-suggested-action-badge-title');
          if (badgeTitle && !badgeTitle.hasAttribute('aria-label')) {
            badgeTitle.setAttribute('aria-label', 'Acción sugerida');
            badgeTitle.setAttribute('role', 'heading');
          }
        }
      } catch (e) {
        // Ignorar errores de acceso al iframe (política de mismo origen)
        // Esto es esperado para iframes de YouTube
      }
    });
    
    // También intentar buscar elementos en el documento principal (por si acaso)
    const playlistCheckbox = document.querySelector('.ytp-share-panel-include-playlist-checkbox');
    if (playlistCheckbox && !playlistCheckbox.hasAttribute('data-label-fixed')) {
      // Crear un ID único si no tiene
      if (!playlistCheckbox.id) {
        playlistCheckbox.id = 'ytp-playlist-checkbox-' + Date.now();
      }
      
      // Agregar atributo name si no tiene
      if (!playlistCheckbox.name) {
        playlistCheckbox.name = 'ytp-playlist-checkbox-' + Date.now();
      }
      
      // Verificar si ya tiene un label asociado
      const existingLabel = document.querySelector('label[for="' + playlistCheckbox.id + '"]');
      
      if (!existingLabel) {
        // Buscar el label padre que contiene el checkbox
        const parentLabel = playlistCheckbox.closest('label');
        
        if (parentLabel) {
          // Si el label padre existe, asociarlo correctamente
          if (!parentLabel.getAttribute('for')) {
            parentLabel.setAttribute('for', playlistCheckbox.id);
          }
        } else {
          // Si no hay label padre, crear uno
          const label = document.createElement('label');
          label.textContent = 'Incluir en lista de reproducción';
          label.className = 'sr-only'; // Hacer el label invisible
          label.setAttribute('for', playlistCheckbox.id);
          
          // Insertar el label antes del checkbox
          playlistCheckbox.parentNode.insertBefore(label, playlistCheckbox);
        }
      }
      
      // Marcar como corregido para evitar duplicados
      playlistCheckbox.setAttribute('data-label-fixed', 'true');
    }
    
    // Buscar y corregir título de badge sugerido
    const badgeTitle = document.querySelector('.ytp-suggested-action-badge-title');
    if (badgeTitle && !badgeTitle.hasAttribute('aria-label')) {
      badgeTitle.setAttribute('aria-label', 'Acción sugerida');
      badgeTitle.setAttribute('role', 'heading');
    }
  } catch (e) {
    // Ignorar errores silenciosamente
  }
}

// Ejecutar la corrección periódicamente para elementos dinámicos
function startYouTubeLabelFixer() {
  // Ejecutar inmediatamente
  fixYouTubeLabels();
  
  // Ejecutar más frecuentemente para elementos que se cargan dinámicamente
  setInterval(fixYouTubeLabels, 1000);
  
  // También ejecutar cuando se detecten cambios en iframes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        // Ejecutar inmediatamente y también después de un delay
        fixYouTubeLabels();
        setTimeout(fixYouTubeLabels, 100);
        setTimeout(fixYouTubeLabels, 500);
        setTimeout(fixYouTubeLabels, 1000);
      }
      
      // También observar cambios en atributos
      if (mutation.type === 'attributes') {
        setTimeout(fixYouTubeLabels, 100);
      }
    });
  });
  
  // Observar cambios en el documento con más opciones
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'name', 'for']
  });
  
  // Observar específicamente los iframes de YouTube
  const iframeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === 'IFRAME' && (node.src && (node.src.includes('youtube.com') || node.src.includes('youtu.be')))) {
            // Cuando se agrega un iframe de YouTube, intentar corregir después de que se cargue
            node.addEventListener('load', function() {
              setTimeout(fixYouTubeLabels, 500);
              setTimeout(fixYouTubeLabels, 1500);
              setTimeout(fixYouTubeLabels, 3000);
            }, { once: true });
            
            // También intentar inmediatamente
            setTimeout(fixYouTubeLabels, 100);
          }
        });
      }
    });
  });
  
  // Observar cambios en contenedores de video
  const videoContainers = document.querySelectorAll('.video-container');
  videoContainers.forEach(container => {
    iframeObserver.observe(container, {
      childList: true,
      subtree: true
    });
  });
  
  // También observar cuando se expanden los acordeones
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', function() {
      setTimeout(fixYouTubeLabels, 300);
      setTimeout(fixYouTubeLabels, 1000);
    });
  });
}

function initMenuTienda() {
  var menuBtn = document.getElementById('menuToggleBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  var menu2Btn = document.getElementById('menu2ToggleBtn');
  var mobileMenu2 = document.getElementById('mobileMenu2');
  var menu3Btn = document.getElementById('menu3ToggleBtn');
  var mobileMenu3 = document.getElementById('mobileMenu3');
  var menuOverlay = document.getElementById('menuOverlay');

  function closeAllMenus() {
    if (mobileMenu) mobileMenu.classList.add('hidden');
    if (mobileMenu2) mobileMenu2.classList.add('hidden');
    if (mobileMenu3) mobileMenu3.classList.add('hidden');
    if (menuOverlay) menuOverlay.classList.remove('active');
  }

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', function() {
      closeAllMenus();
      mobileMenu.classList.toggle('hidden');
      if (menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  if (menu2Btn && mobileMenu2) {
    menu2Btn.addEventListener('click', function() {
      closeAllMenus();
      mobileMenu2.classList.toggle('hidden');
      if (menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  if (menu3Btn && mobileMenu3) {
    menu3Btn.addEventListener('click', function() {
      closeAllMenus();
      mobileMenu3.classList.toggle('hidden');
      if (menuOverlay) menuOverlay.classList.toggle('active');
    });
  }

  if (menuOverlay) {
    menuOverlay.addEventListener('click', function() {
      closeAllMenus();
    });
  }

  // Event listeners optimizados para mejor rendimiento
  document.addEventListener('mousedown', function(e) {
    if (!menuBtn?.contains(e.target) && !menu2Btn?.contains(e.target) && !menu3Btn?.contains(e.target) &&
        !mobileMenu?.contains(e.target) && !mobileMenu2?.contains(e.target) && !mobileMenu3?.contains(e.target)) {
      closeAllMenus();
    }
  }, { passive: true });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAllMenus();
    }
  }, { passive: true });

  // Event listeners para touchstart (móviles) - pasivos para mejor rendimiento
  document.addEventListener('touchstart', function(e) {
    if (!menuBtn?.contains(e.target) && !menu2Btn?.contains(e.target) && !menu3Btn?.contains(e.target) &&
        !mobileMenu?.contains(e.target) && !mobileMenu2?.contains(e.target) && !mobileMenu3?.contains(e.target)) {
      closeAllMenus();
    }
  }, { passive: true });
}

function initAccordionHerramientas() {
  document.querySelectorAll('.herramienta-accordion').forEach(function(card) {
    var header = card.querySelector('.accordion-header');
    var body = card.querySelector('.accordion-body');
    var arrow = card.querySelector('.accordion-arrow');

    if (header && body && arrow) {
      // Event listener optimizado para acordeones
      header.addEventListener('click', function(e) {
        // Verificación segura para event.target.closest
        if (!e || !e.target || typeof e.target.closest !== 'function') {
          return;
        }
        
        if (e.target.closest('.btn-copy-link')) {
            return;
        }

        e.preventDefault();
        
        const isHidden = body.classList.contains('hidden');
        body.classList.toggle('hidden');
        arrow.classList.toggle('active');

        // Manejar el iframe de YouTube para detener la reproducción y optimizar rendimiento
        const iframe = body.querySelector('iframe');
        if (iframe) {
            const videoSrc = iframe.getAttribute('src');
            if (isHidden) {
                // Restaurar el src original si es necesario
                const originalSrc = iframe.dataset.originalSrc;
                if (originalSrc && videoSrc !== originalSrc) {
                    iframe.setAttribute('src', originalSrc);
                }
            } else {
                // Optimizar iframe para reducir violaciones
                iframe.dataset.originalSrc = videoSrc;
                iframe.setAttribute('src', '');
                
                // Aplicar optimizaciones CSS para reducir violaciones
                iframe.style.touchAction = 'manipulation';
                iframe.style.pointerEvents = 'auto';
                iframe.style.willChange = 'auto';
            }
        }
      }, { passive: false }); // No pasivo porque necesitamos preventDefault

      // Event listener para touchstart (móviles) - pasivo para mejor rendimiento
      header.addEventListener('touchstart', function(e) {
        if (e.target.closest('.btn-copy-link')) {
            return;
        }
        // No preventDefault aquí para mantener el scroll fluido
      }, { passive: true });
    }

    var inputX = card.querySelector('.input-x');
    if (!inputX) return;

    var resultado = card.querySelector('.resultado-porcentaje');
    var label = card.querySelector('label[for="x-' + inputX.id.split('-')[1] + '"]');
    var percentText = label ? label.textContent : '';
    var percentMatch = percentText.match(/Porcentaje:\s*([\d.]+)%/);
    var percent = percentMatch ? parseFloat(percentMatch[1]) : 0;
    
    // Event listeners optimizados para inputs de cálculo
    inputX.addEventListener('input', function() {
      var x = parseFloat(inputX.value);
      if (!isNaN(x) && percent) {
        resultado.value = (x * percent / 100).toFixed(2);
      } else {
        resultado.value = '0';
      }
    }, { passive: true });

    // Event listener para touchstart en inputs (móviles)
    inputX.addEventListener('touchstart', function() {
      // Permitir que el input se enfoque normalmente
    }, { passive: true });
  });
}

function initBuscadorHerramientas() {
  var searchInput = document.getElementById('searchTools');
  var clearBtn = document.getElementById('clearSearchTools');
  var form = document.getElementById('ajax-search-form');
  var cards = Array.from(document.querySelectorAll('.herramienta-accordion'));

  function filtrar() {
    var term = searchInput.value.trim().toLowerCase();
    cards.forEach(function(card) {
      var tituloElement = card.querySelector('.accordion-header span');
      if (tituloElement){
        var titulo = tituloElement.textContent.trim().toLowerCase();
        if (!term || titulo.includes(term)) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      }
    });
  }
  
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault(); 
    }, { passive: false }); // No pasivo porque necesitamos preventDefault
  }

  if (searchInput) {
    // Event listeners optimizados para el buscador
    searchInput.addEventListener('input', filtrar, { passive: true });
    searchInput.addEventListener('touchstart', function() {
      // Permitir que el input se enfoque normalmente
    }, { passive: true });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      searchInput.value = '';
      filtrar();
      searchInput.focus();
    }, { passive: true });
    
    // Event listener para touchstart en botón limpiar (móviles)
    clearBtn.addEventListener('touchstart', function() {
      // Permitir que el botón funcione normalmente
    }, { passive: true });
  }
}

function showCopySuccess(buttonElement) {
    const originalText = buttonElement.textContent;
    buttonElement.textContent = 'Copiado!';
    buttonElement.disabled = true;
    setTimeout(() => {
        buttonElement.textContent = originalText;
        buttonElement.disabled = false;
    }, 1500);
}

function fallbackCopyTextToClipboard(text, buttonElement) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showCopySuccess(buttonElement);
        }
    } catch (err) {
        // Silently handle error
    }

    document.body.removeChild(textArea);
}

function initCopyToClipboard() {
    // Event listeners optimizados para botones de copiar
    document.body.addEventListener('click', function(e) {
        if (e.target.classList.contains('btn-copy-link')) {
            const linkToCopy = e.target.dataset.link;
            if (!linkToCopy) return;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(linkToCopy).then(() => {
                    showCopySuccess(e.target);
                }).catch(err => {
                    fallbackCopyTextToClipboard(linkToCopy, e.target);
                });
            } else {
                fallbackCopyTextToClipboard(linkToCopy, e.target);
            }
        }
    }, { passive: true });

    // Event listener para touchstart en botones de copiar (móviles)
    document.body.addEventListener('touchstart', function(e) {
        if (e.target.classList.contains('btn-copy-link')) {
            // Permitir que el botón funcione normalmente
        }
    }, { passive: true });
}

function initMediaSearch() {
    const searchForms = document.querySelectorAll('.media-search-form');

    searchForms.forEach(form => {
        // Verificación segura para closest
        if (!form || typeof form.closest !== 'function') {
            return;
        }
        const container = form.closest('.media-search-container');
        if (!container) return;
        
        const input = container.querySelector('.media-search-input');
        const resultsContainer = container.querySelector('.media-results-container');
        const searchBtn = container.querySelector('.media-search-btn');
        const countrySelect = container.querySelector('.media-country-select');

        if (!input || !resultsContainer || !searchBtn) return;

        // Event listeners optimizados para formularios de búsqueda de medios
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const query = input.value.trim();
            const country = countrySelect ? countrySelect.value : 'CO';
            if (!query) return;

            searchBtn.disabled = true;
            searchBtn.textContent = 'Buscando...';
            resultsContainer.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>';

            try {
                const response = await fetch('/tienda/tools/find-media', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ query: query, country: country })
                });

                const data = await response.json();

                // Verificar si hay un error en la respuesta (incluso si response.ok es true)
                if (!response.ok || data.error) {
                    // Simplificar mensajes de error
                    let errorMsg = data.error || 'No se encontraron resultados o esta mal escrito el nombre.';
                    // Si el mensaje contiene información sobre API key, simplificarlo
                    if (errorMsg.includes('API key') || errorMsg.includes('tmdb') || errorMsg.includes('configurada')) {
                        errorMsg = 'No se encontraron resultados o esta mal escrito el nombre.';
                    }
                    throw new Error(errorMsg);
                }

                // Solo renderizar si hay resultados
                if (data.results && data.results.length > 0) {
                    renderMediaResults(data.results, resultsContainer);
                } else {
                    resultsContainer.innerHTML = '<div class="alert alert-warning">No se encontraron resultados o esta mal escrito el nombre.</div>';
                }

            } catch (error) {
                resultsContainer.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
            } finally {
                searchBtn.disabled = false;
                searchBtn.textContent = 'Buscar';
            }
        }, { passive: false }); // No pasivo porque necesitamos preventDefault

        // Event listeners para inputs de búsqueda (móviles)
        if (input) {
            input.addEventListener('touchstart', function() {
                // Permitir que el input se enfoque normalmente
            }, { passive: true });
        }

        if (searchBtn) {
            searchBtn.addEventListener('touchstart', function() {
                // Permitir que el botón funcione normalmente
            }, { passive: true });
        }
    });

    function renderMediaResults(results, container) {
        if (!results || results.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No se encontraron resultados.</div>';
            return;
        }

        let html = '';
        
        // Información de APIs consultadas y país
        if (results.apis_consultadas && results.pais_seleccionado) {
            html += `<div class="alert alert-info mb-3">
                <strong>País:</strong> ${results.pais_seleccionado} | 
                <strong>APIs consultadas:</strong> ${results.apis_consultadas.join(', ')}
            </div>`;
        }

        results.forEach(result => {
            const poster = result.poster_path || null;
            const posterHtml = poster 
                ? `<img src="${poster}" alt="Poster" class="media-poster" style="width: 150px; height: 225px; object-fit: cover; border-radius: 8px;" data-action-error="hide-on-error">`
                : '<div class="no-image-placeholder" style="width: 150px; height: 225px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: #6c757d;">No se encontró imagen para este resultado</div>';
            
            // Restaurar estado del botón
            const providersHtml = result.providers && result.providers.length > 0
                ? `<div class="providers-list" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-end; margin-top: 6px;">
                    ${result.providers.map(provider => {
                    if (provider.logo_path) {
                            return `<div style="display: flex; flex-direction: column; align-items: center; width: 40px;">
                                <img src="${provider.logo_path}" alt="${provider.name}" title="${provider.name}" style="height:16px; max-width:35px; object-fit:contain; background:#fff; border-radius:2px; border:1px solid #eee; margin-bottom:1px;">
                                <small style="font-size:8px; color:#444; text-align:center; line-height:1.1;">${provider.name}</small>
                            </div>`;
                    } else {
                        return `<span class="provider-badge" style="display:inline-block; margin-right:3px; vertical-align:middle; background:#f1f1f1; border-radius:2px; padding:1px 3px; font-size:9px; color:#333;">${provider.name}</span>`;
                    }
                    }).join('')}
                </div>`
                : '<span class="text-muted">No hay información de proveedores</span>';

            const sourceBadge = result.source ? `<span class="badge bg-secondary ms-2">${result.source}</span>` : '';

            html += `
                <div class="media-result-card" style="display: flex; gap: 15px; margin-bottom: 20px; padding: 15px; border: 1px solid #dee2e6; border-radius: 8px; background: white;">
                    <div class="media-poster-container">
                        ${posterHtml}
                    </div>
                    <div class="media-info" style="flex: 1;">
                        <h5 class="media-title" style="margin-bottom: 10px;">${result.title}${sourceBadge}</h5>
                        <p class="media-overview" style="margin-bottom: 15px; color: #6c757d;">${result.overview || 'Sin descripción disponible'}</p>
                        <div class="media-providers">
                            <strong>Proveedores:</strong> ${providersHtml}
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }
}

function initClimaForm() {
    document.querySelectorAll('.api-clima-form').forEach(form => {
        const input = form.querySelector('.api-clima-ciudad');
        const resultado = form.parentElement.querySelector('.api-clima-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        // Event listeners optimizados para formularios de clima
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const ciudad = input.value.trim();
            if (!ciudad) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Consultando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/weather', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ city: ciudad })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const weather = data.result;
                const iconUrl = `https://openweathermap.org/img/wn/${weather.icon}@2x.png`;
                
                resultado.innerHTML = `
                    <div class='alert alert-info'>
                        <div class="d-flex align-items-center mb-3">
                            <img src="${iconUrl}" alt="Clima" style="width: 50px; height: 50px;">
                            <div class="ms-3">
                                <h5 class="mb-1">${weather.city}, ${weather.country}</h5>
                                <p class="mb-0 text-capitalize">${weather.description}</p>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="d-flex justify-content-between mb-2">
                                    <span><i class="fas fa-thermometer-half text-danger"></i> Temperatura:</span>
                                    <strong>${weather.temperature}°C</strong>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span><i class="fas fa-thermometer-quarter text-warning"></i> Sensación térmica:</span>
                                    <strong>${weather.feels_like}°C</strong>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span><i class="fas fa-tint text-primary"></i> Humedad:</span>
                                    <strong>${weather.humidity}%</strong>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="d-flex justify-content-between mb-2">
                                    <span><i class="fas fa-wind text-info"></i> Viento:</span>
                                    <strong>${weather.wind_speed} km/h</strong>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span><i class="fas fa-compress-alt text-secondary"></i> Presión:</span>
                                    <strong>${weather.pressure} hPa</strong>
                                </div>
                                <div class="d-flex justify-content-between mb-2">
                                    <span><i class="fas fa-eye text-success"></i> Visibilidad:</span>
                                    <strong>${weather.visibility} km</strong>
                                </div>
                            </div>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }, { passive: false }); // No pasivo porque necesitamos preventDefault

        // Event listeners para inputs de clima (móviles)
        if (input) {
            input.addEventListener('touchstart', function() {
                // Permitir que el input se enfoque normalmente
            }, { passive: true });
        }

        if (submitBtn) {
            submitBtn.addEventListener('touchstart', function() {
                // Permitir que el botón funcione normalmente
            }, { passive: true });
        }
    });
}

function initMonedaForm() {
    document.querySelectorAll('.api-moneda-form').forEach(form => {
        const cantidad = form.querySelector('.api-moneda-cantidad');
        const origen = form.querySelector('.api-moneda-origen');
        const destino = form.querySelector('.api-moneda-destino');
        const resultado = form.parentElement.querySelector('.api-moneda-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const cant = cantidad.value.trim();
            const from = origen.value.trim().toUpperCase();
            const to = destino.value.trim().toUpperCase();
            if (!cant || !from || !to) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Convirtiendo...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/currency', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ 
                        amount: cant, 
                        from_currency: from, 
                        to_currency: to 
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const currency = data.result;
                
                resultado.innerHTML = `
                    <div class='alert alert-success'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-exchange-alt text-success me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">Conversión de Moneda</h5>
                        </div>
                        <div class="card border-success bg-light">
                            <div class="card-body">
                                <div class="row text-center">
                                    <div class="col-md-4">
                                        <div class="mb-2">
                                            <strong class="text-primary">${currency.amount.toLocaleString()}</strong>
                                        </div>
                                        <div class="badge bg-primary">${currency.from_currency}</div>
                                    </div>
                                    <div class="col-md-4 d-flex align-items-center justify-content-center">
                                        <i class="fas fa-arrow-right text-success" style="font-size: 1.5rem;"></i>
                                    </div>
                                    <div class="col-md-4">
                                        <div class="mb-2">
                                            <strong class="text-success">${currency.converted_amount.toLocaleString()}</strong>
                                        </div>
                                        <div class="badge bg-success">${currency.to_currency}</div>
                                    </div>
                                </div>
                                <hr>
                                <div class="row text-center">
                                    <div class="col-md-6">
                                        <small class="text-muted">
                                            <i class="fas fa-chart-line"></i> Tasa de cambio:
                                        </small>
                                        <br>
                                        <strong>1 ${currency.from_currency} = ${currency.conversion_rate} ${currency.to_currency}</strong>
                                    </div>
                                    <div class="col-md-6">
                                        <small class="text-muted">
                                            <i class="fas fa-clock"></i> Última actualización:
                                        </small>
                                        <br>
                                        <strong>${new Date(currency.last_update).toLocaleString('es-ES')}</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initTraduccionForm() {
    document.querySelectorAll('.api-traduccion-form').forEach(form => {
        const texto = form.querySelector('.api-traduccion-texto');
        const idioma = form.querySelector('.api-traduccion-idioma');
        const resultado = form.parentElement.querySelector('.api-traduccion-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const txt = texto.value.trim();
            const lang = idioma.value.trim();
            if (!txt || !lang) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Traduciendo...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/translate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ 
                        text: txt, 
                        target_lang: lang 
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const translation = data.result;
                
                resultado.innerHTML = `
                    <div class='alert alert-info'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-language text-info me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">Traducción Completada</h5>
                        </div>
                        <div class="card border-info bg-light">
                            <div class="card-body">
                                <div class="row">
                                    <div class="col-md-6">
                                        <h6 class="text-info">
                                            <i class="fas fa-flag"></i> Texto Original (${translation.source_language.toUpperCase()})
                                        </h6>
                                        <div class="bg-white p-3 rounded border">
                                            <p class="mb-0">${translation.original_text}</p>
                                        </div>
                                        <small class="text-muted">
                                            <i class="fas fa-percentage"></i> Confianza de detección: ${translation.confidence}%
                                        </small>
                                    </div>
                                    <div class="col-md-6">
                                        <h6 class="text-success">
                                            <i class="fas fa-arrow-right"></i> Traducción (${translation.target_language.toUpperCase()})
                                        </h6>
                                        <div class="bg-white p-3 rounded border">
                                            <p class="mb-0">${translation.translated_text}</p>
                                        </div>
                                        <small class="text-muted">
                                            <i class="fas fa-clock"></i> Traducido con LibreTranslate
                                        </small>
                                    </div>
                                </div>
                                <hr>
                                <div class="text-center">
                                    <button class="btn btn-sm btn-outline-primary copy-to-clipboard-btn" data-action="copy-to-clipboard" data-text="${translation.translated_text.replace(/'/g, "&#39;").replace(/"/g, "&quot;")}">
                                        <i class="fas fa-copy"></i> Copiar traducción
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initGeolocalizacionForm() {
    document.querySelectorAll('.api-geoloc-form').forEach(form => {
        const direccion = form.querySelector('.api-geoloc-direccion');
        const resultado = form.parentElement.querySelector('.api-geoloc-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const dir = direccion.value.trim();
            if (!dir) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Buscando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/geolocation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ address: dir })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const location = data.result;
                const mapUrl = `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}&zoom=15`;
                
                resultado.innerHTML = `
                    <div class='alert alert-success'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-map-marker-alt text-danger me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">¡Ubicación encontrada! 🎯</h5>
                        </div>
                        <div class="card border-success bg-light">
                            <div class="card-body">
                                <div class="row">
                                    <div class="col-md-6">
                                        <h6 class="text-success">
                                            <i class="fas fa-info-circle"></i> Información de Ubicación
                                        </h6>
                                        <div class="mb-2">
                                            <strong>Dirección:</strong><br>
                                            <span class="text-muted">${location.formatted_address}</span>
                                        </div>
                                        <div class="mb-2">
                                            <strong>País:</strong> ${location.country || 'No disponible'}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Estado/Provincia:</strong> ${location.state || 'No disponible'}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Ciudad:</strong> ${location.city || 'No disponible'}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Código Postal:</strong> ${location.postcode || 'No disponible'}
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <h6 class="text-primary">
                                            <i class="fas fa-crosshairs"></i> Coordenadas
                                        </h6>
                                        <div class="mb-2">
                                            <strong>Latitud:</strong> ${location.latitude.toFixed(6)}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Longitud:</strong> ${location.longitude.toFixed(6)}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Confianza:</strong> ${Math.round(location.confidence * 100)}%
                                        </div>
                                        <div class="mb-2">
                                            <strong>Zona Horaria:</strong> ${location.timezone || 'No disponible'}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Moneda:</strong> ${location.currency || 'No disponible'}
                                        </div>
                                    </div>
                                </div>
                                <hr>
                                <div class="text-center">
                                    <a href="${mapUrl}" target="_blank" class="btn btn-sm btn-outline-primary">
                                        <i class="fas fa-map"></i> Ver en Mapa
                                    </a>
                                    <button class="btn btn-sm btn-outline-secondary ms-2 copy-to-clipboard-btn" data-action="copy-to-clipboard" data-text="${location.latitude}, ${location.longitude}">
                                        <i class="fas fa-copy"></i> Copiar Coordenadas
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initNoticiasForm() {
    document.querySelectorAll('.api-noticias-form').forEach(form => {
        const categoria = form.querySelector('.api-noticias-categoria');
        const resultado = form.parentElement.querySelector('.api-noticias-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const cat = categoria.value.trim();
            if (!cat) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Buscando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/news', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ category: cat })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const news = data.result;
                
                if (!news.articles || news.articles.length === 0) {
                    resultado.innerHTML = `<div class='alert alert-warning'>No se encontraron noticias para la categoría seleccionada.</div>`;
                    return;
                }
                
                let articlesHtml = news.articles.map(article => `
                    <div class="card mb-3 border-0 shadow-sm">
                        <div class="row g-0">
                            ${article.image_url ? `
                                <div class="col-md-3">
                                    <img src="${article.image_url}" class="img-fluid rounded-start h-100" style="object-fit: cover;" alt="Imagen de noticia" data-action-error="hide-on-error">
                                </div>
                            ` : ''}
                            <div class="col-md-${article.image_url ? '9' : '12'}">
                                <div class="card-body">
                                    <h6 class="card-title mb-2">
                                        <a href="${article.url}" target="_blank" class="text-decoration-none">
                                            ${article.title}
                                        </a>
                                    </h6>
                                    <p class="card-text small mb-2">${article.description || article.content}</p>
                                    <div class="d-flex justify-content-between align-items-center">
                                        <small class="text-muted">
                                            <i class="fas fa-newspaper"></i> ${article.source}
                                        </small>
                                        <small class="text-muted">
                                            <i class="fas fa-clock"></i> ${new Date(article.published_at).toLocaleString('es-ES')}
                                        </small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('');
                
                resultado.innerHTML = `
                    <div class='alert alert-info'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-newspaper text-primary me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">📰 Noticias de ${categoria.options[categoria.selectedIndex].text}</h5>
                        </div>
                        <div class="mb-2">
                            <small class="text-muted">
                                <i class="fas fa-info-circle"></i> Se encontraron ${news.total_results} noticias (mostrando ${news.articles.length})
                            </small>
                        </div>
                        ${articlesHtml}
                        <div class="text-center mt-3">
                            <small class="text-muted">
                                <i class="fas fa-rss"></i> Noticias de Colombia - Powered by NewsAPI
                            </small>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initCorreoForm() {
    document.querySelectorAll('.api-correo-form').forEach(form => {
        const destinatario = form.querySelector('.api-correo-destinatario');
        const asunto = form.querySelector('.api-correo-asunto');
        const mensaje = form.querySelector('.api-correo-mensaje');
        const resultado = form.parentElement.querySelector('.api-correo-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const dest = destinatario.value.trim();
            const subj = asunto.value.trim();
            const msg = mensaje.value.trim();
            if (!dest || !subj || !msg) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Enviando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/email', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ 
                        to_email: dest, 
                        subject: subj, 
                        message: msg 
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const email = data.result;
                
                resultado.innerHTML = `
                    <div class='alert alert-success'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-paper-plane text-success me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">✉️ ¡Mensaje enviado con éxito!</h5>
                        </div>
                        <div class="card border-success bg-light">
                            <div class="card-body">
                                <div class="row">
                                    <div class="col-md-6">
                                        <h6 class="text-success">
                                            <i class="fas fa-user"></i> Información del Envío
                                        </h6>
                                        <div class="mb-2">
                                            <strong>Para:</strong> ${email.to_email}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Asunto:</strong> ${email.subject}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Desde:</strong> ${email.from_email}
                                        </div>
                                        <div class="mb-2">
                                            <strong>ID del Mensaje:</strong> 
                                            <code class="small">${email.message_id}</code>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <h6 class="text-primary">
                                            <i class="fas fa-clock"></i> Detalles
                                        </h6>
                                        <div class="mb-2">
                                            <strong>Estado:</strong> 
                                            <span class="badge bg-success">Enviado</span>
                                        </div>
                                        <div class="mb-2">
                                            <strong>Enviado el:</strong> ${email.sent_at}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Vista previa:</strong><br>
                                            <small class="text-muted">${email.message_preview}</small>
                                        </div>
                                    </div>
                                </div>
                                <hr>
                                <div class="text-center">
                                    <small class="text-muted">
                                        <i class="fas fa-shield-alt"></i> Mensaje enviado de forma segura
                                    </small>
                                </div>
                            </div>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initRedesSocialesForm() {
    document.querySelectorAll('.api-social-form').forEach(form => {
        const plataforma = form.querySelector('.api-social-plataforma');
        const contenido = form.querySelector('.api-social-contenido');
        const resultado = form.parentElement.querySelector('.api-social-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const plat = plataforma.value.trim();
            const cont = contenido.value.trim();
            if (!plat || !cont) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Publicando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/social-media', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ 
                        platform: plat, 
                        content: cont 
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const social = data.result;
                
                const iconos = {
                    'Twitter': '🐦',
                    'Facebook': '📘',
                    'Instagram': '📷',
                    'LinkedIn': '💼',
                    'YouTube': '📺'
                };
                
                const icono = iconos[plat] || '📱';
                
                resultado.innerHTML = `                    <div class='alert alert-primary'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-share-alt text-primary me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">${icono} ¡Publicado en ${plat}!</h5>
                        </div>
                        <div class="card border-primary bg-light">
                            <div class="card-body">
                                <div class="row">
                                    <div class="col-md-6">
                                        <h6 class="text-primary">
                                            <i class="fas fa-info-circle"></i> Información de la Publicación
                                        </h6>
                                        <div class="mb-2">
                                            <strong>Plataforma:</strong> ${social.platform}
                                        </div>
                                        <div class="mb-2">
                                            <strong>ID del Post:</strong> 
                                            <code class="small">${social.post_id}</code>
                                        </div>
                                        <div class="mb-2">
                                            <strong>Estado:</strong> 
                                            <span class="badge bg-success">Publicado</span>
                                        </div>
                                        <div class="mb-2">
                                            <strong>Publicado el:</strong> ${social.posted_at}
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <h6 class="text-info">
                                            <i class="fas fa-chart-bar"></i> Estadísticas
                                        </h6>
                                        <div class="mb-2">
                                            <strong>Vistas:</strong> ${social.views}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Me gusta:</strong> ${social.likes}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Compartidos:</strong> ${social.shares}
                                        </div>
                                        <div class="mb-2">
                                            <strong>Contenido:</strong><br>
                                            <small class="text-muted">"${social.content.substring(0, 100)}${social.content.length > 100 ? '...' : ''}"</small>
                                        </div>
                                    </div>
                                </div>
                                <hr>
                                <div class="text-center">
                                    <a href="${social.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                                        <i class="fas fa-external-link-alt"></i> Ver Publicación
                                    </a>
                                    <button class="btn btn-sm btn-outline-secondary ms-2 copy-to-clipboard-btn" data-action="copy-to-clipboard" data-text="${social.url.replace(/'/g, "&#39;").replace(/"/g, "&quot;")}">
                                        <i class="fas fa-copy"></i> Copiar URL
                                    </button>
                                </div>
                            </div>
                        </div>
                        <p class="mb-0 mt-2"><small class="text-muted">🎉 ¡Tu contenido está conquistando las redes!</small></p>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initReconocimientoImagenesForm() {
    document.querySelectorAll('.api-ocr-form').forEach(form => {
        const url = form.querySelector('.api-ocr-url');
        const resultado = form.parentElement.querySelector('.api-ocr-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const imageUrl = url.value.trim();
            if (!imageUrl) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Analizando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/image-recognition', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ image_url: imageUrl })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const analysis = data.result;
                
                resultado.innerHTML = `                    <div class='alert alert-warning'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-eye text-warning me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">🔍 ¡Análisis de imagen completado!</h5>
                        </div>
                        <div class="card border-warning bg-light">
                            <div class="card-body">
                                <div class="row mb-3">
                                    <div class="col-md-6">
                                        <h6 class="text-warning">
                                            <i class="fas fa-image"></i> Vista Previa
                                        </h6>
                                        <img src="${analysis.image_url}" alt="Imagen analizada" class="img-fluid rounded" style="max-height: 200px; object-fit: cover;" data-action-error="hide-on-error">
                                    </div>
                                    <div class="col-md-6">
                                        <h6 class="text-info">
                                            <i class="fas fa-info-circle"></i> Propiedades
                                        </h6>
                                        <div class="mb-1"><strong>Resolución:</strong> ${analysis.image_properties.width} × ${analysis.image_properties.height}</div>
                                        <div class="mb-1"><strong>Formato:</strong> ${analysis.image_properties.format}</div>
                                        <div class="mb-1"><strong>Tamaño:</strong> ${analysis.image_properties.size_kb} KB</div>
                                        <div class="mb-1"><strong>Confianza:</strong> ${analysis.analysis_confidence}%</div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-4">
                                        <h6 class="text-success">
                                            <i class="fas fa-tags"></i> Objetos Detectados
                                        </h6>
                                        <ul class="list-unstyled">
                                            ${analysis.objects_detected.map(obj => `<li><i class="fas fa-check text-success me-1"></i>${obj}</li>`).join('')}
                                        </ul>
                                    </div>
                                    <div class="col-md-4">
                                        <h6 class="text-primary">
                                            <i class="fas fa-smile"></i> Análisis Facial
                                        </h6>
                                        <div class="mb-1"><strong>Emoción:</strong> ${analysis.emotion_analysis.emotion}</div>
                                        <div class="mb-1"><strong>Confianza:</strong> ${analysis.emotion_analysis.confidence}%</div>
                                        <h6 class="text-info mt-3">
                                            <i class="fas fa-palette"></i> Colores Principales
                                        </h6>
                                        <div class="d-flex flex-wrap gap-1">
                                            ${analysis.color_analysis.primary_colors.map(color => 
                                                `<span class="badge bg-secondary">${color}</span>`
                                            ).join('')}
                                        </div>
                                    </div>
                                    <div class="col-md-4">
                                        <h6 class="text-danger">
                                            <i class="fas fa-font"></i> Texto Detectado (OCR)
                                        </h6>
                                        ${analysis.text_detection.has_text ? 
                                            `<div class="bg-white p-2 rounded border">
                                                <code>${analysis.text_detection.detected_text}</code>
                                            </div>` : 
                                            `<div class="text-muted">No se detectó texto en la imagen</div>`
                                        }
                                    </div>
                                </div>
                                <hr>
                                <div class="text-center">
                                    <small class="text-muted">
                                        <i class="fas fa-clock"></i> Analizado el: ${analysis.processed_at}
                                    </small>
                                </div>
                            </div>
                        </div>
                        <p class="mb-0 mt-2"><small class="text-muted">🤖 ¡La IA ve todo lo que hay en tu imagen!</small></p>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initChatbotIAForm() {
    document.querySelectorAll('.api-chatbot-form').forEach(form => {
        const mensaje = form.querySelector('.api-chatbot-mensaje');
        const resultado = form.parentElement.querySelector('.api-chatbot-resultado');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const msg = mensaje.value.trim();
            if (!msg) return;
            
            // Restaurar estado del botón
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Procesando...';
            resultado.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></div>';
            
            try {
                const response = await fetch('/tienda/tools/chatbot', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ message: msg })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ocurrió un error en el servidor.');
                }

                const chat = data.result;
                
                resultado.innerHTML = `                    <div class='alert alert-info'>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fas fa-robot text-info me-2" style="font-size: 1.5rem;"></i>
                            <h5 class="mb-0">🤖 Respuesta de la IA</h5>
                        </div>
                        <div class="card border-info bg-light">
                            <div class="card-body">
                                <div class="row">
                                    <div class="col-md-6">
                                        <h6 class="text-primary">
                                            <i class="fas fa-user"></i> Tu Mensaje
                                        </h6>
                                        <div class="bg-white p-3 rounded border">
                                            <p class="mb-0 fst-italic">"${chat.user_message}"</p>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <h6 class="text-success">
                                            <i class="fas fa-robot"></i> Respuesta de la IA
                                        </h6>
                                        <div class="bg-white p-3 rounded border">
                                            <p class="mb-0">${chat.ai_response}</p>
                                        </div>
                                    </div>
                                </div>
                                <hr>
                                <div class="row text-center">
                                    <div class="col-md-3">
                                        <small class="text-muted">
                                            <i class="fas fa-clock"></i> Tiempo
                                        </small>
                                        <br>
                                        <strong>${chat.processing_time_ms}ms</strong>
                                    </div>
                                    <div class="col-md-3">
                                        <small class="text-muted">
                                            <i class="fas fa-bullseye"></i> Precisión
                                        </small>
                                        <br>
                                        <strong>${chat.accuracy_percentage}%</strong>
                                    </div>
                                    <div class="col-md-3">
                                        <small class="text-muted">
                                            <i class="fas fa-cogs"></i> Modelo
                                        </small>
                                        <br>
                                        <strong>${chat.model_used}</strong>
                                    </div>
                                    <div class="col-md-3">
                                        <small class="text-muted">
                                            <i class="fas fa-tokens"></i> Tokens
                                        </small>
                                        <br>
                                        <strong>${chat.tokens_used}</strong>
                                    </div>
                                </div>
                                <hr>
                                <div class="text-center">
                                    <small class="text-muted">
                                        <i class="fas fa-id-card"></i> ID de Conversación: <code>${chat.conversation_id}</code>
                                    </small>
                                    <br>
                                    <small class="text-muted">
                                        <i class="fas fa-clock"></i> ${chat.response_timestamp}
                                    </small>
                                </div>
                            </div>
                        </div>
                    </div>`;

            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            } finally {
                // Restaurar estado del botón
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    });
}

function initGenericaForm() {
    document.querySelectorAll('.api-generica-form').forEach(form => {
        const endpoint = form.querySelector('.api-generica-endpoint');
        const parametros = form.querySelector('.api-generica-parametros');
        const resultado = form.parentElement.querySelector('.api-generica-resultado');
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const ep = endpoint.value.trim();
            const params = parametros.value.trim();
            if (!ep) return;
            
            const statusCodes = [200, 201, 204, 400, 401, 403, 404, 500];
            const statusCode = statusCodes[Math.floor(Math.random() * statusCodes.length)];
            const isSuccess = statusCode < 400;
            
            resultado.innerHTML = `
                <div class='alert ${isSuccess ? 'alert-success' : 'alert-danger'}'>
                    <div class="d-flex align-items-center mb-2">
                        <i class="fas fa-code ${isSuccess ? 'text-success' : 'text-danger'} me-2"></i>
                        <strong>🔧 Respuesta de API Genérica</strong>
                    </div>
                    <div class="card ${isSuccess ? 'border-success' : 'border-danger'} bg-light">
                        <div class="card-body p-3">
                            <div class="row">
                                <div class="col-md-6">
                                    <p class="mb-1"><strong>Endpoint:</strong> ${ep}</p>
                                    <p class="mb-1"><strong>Método:</strong> POST</p>
                                    <p class="mb-0"><strong>Status:</strong> <span class="badge ${isSuccess ? 'bg-success' : 'bg-danger'}">${statusCode}</span></p>
                                </div>
                                <div class="col-md-6">
                                    <p class="mb-1"><strong>Parámetros:</strong></p>
                                    <code class="small">${params || 'Ninguno'}</code>
                                </div>
                            </div>
                            ${isSuccess ? `
                                <div class="mt-3">
                                    <strong>Respuesta:</strong>
                                    <pre class="bg-dark text-light p-2 rounded small">{
  "success": true,
  "data": "Operación completada exitosamente",
  "timestamp": "${new Date().toISOString()}"
}</pre>
                                </div>
                            ` : `
                                <div class="mt-3">
                                    <strong>Error:</strong>
                                    <pre class="bg-dark text-light p-2 rounded small">{
  "error": "Algo salió mal",
  "code": ${statusCode},
  "message": "Error en el servidor"
}</pre>
                                </div>
                            `}
                        </div>
                    </div>
                    <p class="mb-0 mt-2"><small class="text-muted">🔌 ¡API genérica lista para cualquier integración!</small></p>
                </div>`;
        });
    });
}

function initHttpApiForm() {
    document.querySelectorAll('.api-http-form').forEach(form => {
        const urlInput = form.querySelector('.api-http-url');
        const resultado = form.parentElement.querySelector('.api-http-resultado');
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const url = urlInput.value.trim();
            if (!url) return;
            resultado.innerHTML = `<div class='text-center'><div class='spinner-border' role='status'><span class='visually-hidden'>Cargando...</span></div></div>`;
            try {
                const response = await fetch('/tienda/tools/http-request', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ url })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Error desconocido');
                }
                const res = data.result;
                resultado.innerHTML = `
                    <div class='alert alert-success'>
                        <div class="d-flex align-items-center mb-2">
                            <i class="fas fa-globe text-success me-2"></i>
                            <strong>🌐 Respuesta HTTP real</strong>
                        </div>
                        <div class="mb-2"><strong>Status:</strong> <span class="badge bg-success">${res.status_code}</span></div>
                        <div class="mb-2"><strong>Headers:</strong>
                            <pre class="bg-light p-2 small border rounded">${Object.entries(res.headers).map(([k,v]) => k+': '+v).join('\n')}</pre>
                        </div>
                        <div><strong>Body:</strong>
                            <pre class="bg-dark text-light p-2 rounded small" style="max-height:300px;overflow:auto;">${res.body ? res.body.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</pre>
                        </div>
                    </div>`;
            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            }
        });
    });
}

function initDbApiForm() {
    document.querySelectorAll('.api-db-form').forEach(form => {
        const sqlInput = form.querySelector('.api-db-sql');
        const resultado = form.parentElement.querySelector('.api-db-resultado');
        // Obtener el api_id del acordeón
        let apiId = null;
        // Verificación segura para closest
        let card = null;
        if (form && typeof form.closest === 'function') {
            card = form.closest('.herramienta-accordion');
        }
        if (card && card.dataset && card.dataset.apiId) {
            apiId = card.dataset.apiId;
        } else if (card && card.getAttribute('data-api-id')) {
            apiId = card.getAttribute('data-api-id');
        }
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const sql = sqlInput.value.trim();
            if (!sql) return;
            resultado.innerHTML = `<div class='text-center'><div class='spinner-border' role='status'><span class='visually-hidden'>Cargando...</span></div></div>`;
            try {
                const response = await fetch('/tienda/tools/db-query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ sql, api_id: apiId })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Error desconocido');
                }
                // Crear tabla
                if (!data.rows || data.rows.length === 0) {
                    resultado.innerHTML = `<div class='alert alert-warning'>No se encontraron resultados.</div>`;
                    return;
                }
                let tableHtml = `<div class='table-responsive'><table class='table table-sm table-bordered bg-light'><thead><tr>`;
                data.columns.forEach(col => { tableHtml += `<th>${col}</th>`; });
                tableHtml += `</tr></thead><tbody>`;
                data.rows.forEach(row => {
                    tableHtml += `<tr>`;
                    data.columns.forEach(col => { tableHtml += `<td>${row[col]}</td>`; });
                    tableHtml += `</tr>`;
                });
                tableHtml += `</tbody></table></div>`;
                resultado.innerHTML = `<div class='alert alert-info'><div class="d-flex align-items-center mb-2"><i class="fas fa-database text-info me-2"></i><strong>🗄️ Resultado de consulta SQL</strong></div>${tableHtml}<p class="mb-0 mt-2"><small class="text-muted">🔍 Consulta ejecutada: <code>${sql}</code></small></p></div>`;
            } catch (error) {
                resultado.innerHTML = `<div class='alert alert-danger'>${error.message}</div>`;
            }
        });
    });
}

// Función optimizada para agregar event listeners pasivos
function addOptimizedEventListeners() {
  // Optimizar todos los inputs de la página
  const allInputs = document.querySelectorAll('input, textarea, select');
  allInputs.forEach(input => {
    // Event listener para touchstart (móviles) - pasivo para mejor rendimiento
    input.addEventListener('touchstart', function() {
      // Permitir que el input se enfoque normalmente
    }, { passive: true });
  });

  // Optimizar todos los botones de la página
  const allButtons = document.querySelectorAll('button');
  allButtons.forEach(button => {
    // Event listener para touchstart (móviles) - pasivo para mejor rendimiento
    button.addEventListener('touchstart', function() {
      // Permitir que el botón funcione normalmente
    }, { passive: true });
  });

  // Optimizar todos los acordeones de la página
  const allAccordions = document.querySelectorAll('.herramienta-accordion');
  allAccordions.forEach(accordion => {
    const header = accordion.querySelector('.accordion-header');
    if (header) {
      // Event listener para touchstart (móviles) - pasivo para mejor rendimiento
      header.addEventListener('touchstart', function(e) {
        if (e.target.closest('.btn-copy-link')) {
          return;
        }
        // No preventDefault aquí para mantener el scroll fluido
      }, { passive: true });
    }
  });

  // Optimizar todos los iframes de YouTube
  optimizeYouTubeIframes();
}

// Función específica para optimizar iframes de YouTube y reducir violaciones
function optimizeYouTubeIframes() {
  const youtubeIframes = document.querySelectorAll('iframe[src*="youtube.com"]');
  
  youtubeIframes.forEach(iframe => {
    // Aplicar optimizaciones CSS para reducir violaciones
    iframe.style.touchAction = 'manipulation';
    iframe.style.pointerEvents = 'auto';
    iframe.style.willChange = 'auto';
    iframe.style.transform = 'translateZ(0)';
    iframe.style.backfaceVisibility = 'hidden';
    iframe.style.webkitBackfaceVisibility = 'hidden';
    
    // Agregar atributos para optimizar rendimiento
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('decoding', 'async');
    
    // Event listener optimizado para touchstart en iframes
    iframe.addEventListener('touchstart', function(e) {
      // Permitir interacción normal con el video
      e.stopPropagation();
    }, { passive: true });
  });
}

// Interceptor global para optimizar event listeners de touchstart
function setupGlobalTouchInterceptor() {
  // Interceptar addEventListener para touchstart
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'touchstart') {
      // Forzar que todos los touchstart sean pasivos
      if (typeof options === 'boolean') {
        options = { passive: true, capture: options };
      } else if (typeof options === 'object' && options !== null) {
        options.passive = true;
      } else {
        options = { passive: true };
      }
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Interceptar también addEventListener en elementos específicos
  const originalElementAddEventListener = Element.prototype.addEventListener;
  Element.prototype.addEventListener = function(type, listener, options) {
    if (type === 'touchstart') {
      if (typeof options === 'boolean') {
        options = { passive: true, capture: options };
      } else if (typeof options === 'object' && options !== null) {
        options.passive = true;
      } else {
        options = { passive: true };
      }
    }
    return originalElementAddEventListener.call(this, type, listener, options);
  };
}

// Observer para optimizar iframes que se cargan dinámicamente
function setupIframeObserver() {
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) { // Element node
            // Buscar iframes de YouTube en el nodo agregado
            const iframes = node.querySelectorAll ? node.querySelectorAll('iframe[src*="youtube.com"]') : [];
            iframes.forEach(optimizeSingleIframe);
            
            // Si el nodo mismo es un iframe de YouTube
            if (node.tagName === 'IFRAME' && node.src && node.src.includes('youtube.com')) {
              optimizeSingleIframe(node);
            }
          }
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Función para optimizar un iframe individual
function optimizeSingleIframe(iframe) {
  iframe.style.touchAction = 'manipulation';
  iframe.style.pointerEvents = 'auto';
  iframe.style.willChange = 'auto';
  iframe.style.transform = 'translateZ(0)';
  iframe.style.backfaceVisibility = 'hidden';
  iframe.style.webkitBackfaceVisibility = 'hidden';
  
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('decoding', 'async');
  
  iframe.addEventListener('touchstart', function(e) {
    e.stopPropagation();
  }, { passive: true });

  // Interceptar eventos dentro del iframe cuando sea posible
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    if (iframeDoc) {
      // Interceptar addEventListener en el documento del iframe
      const originalIframeAddEventListener = iframeDoc.addEventListener;
      iframeDoc.addEventListener = function(type, listener, options) {
        if (type === 'touchstart') {
          if (typeof options === 'boolean') {
            options = { passive: true, capture: options };
          } else if (typeof options === 'object' && options !== null) {
            options.passive = true;
          } else {
            options = { passive: true };
          }
        }
        return originalIframeAddEventListener.call(this, type, listener, options);
      };
    }
  } catch (e) {
    // Ignorar errores de CORS y otros errores de YouTube
    if (e.name === 'NetworkError' || e.message.includes('CORS') || e.message.includes('cross-origin')) {
      // Silenciar errores de CORS de YouTube
      return;
    }
  }
}

// Función para interceptar scripts de YouTube y optimizar sus event listeners
function interceptYouTubeScripts() {
  // Interceptar la creación de scripts
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    const element = originalCreateElement.call(this, tagName);
    
    if (tagName.toLowerCase() === 'script') {
      // Interceptar cuando se asigna src a scripts de YouTube
      const originalSetAttribute = element.setAttribute;
      element.setAttribute = function(name, value) {
        if (name === 'src' && value && value.includes('youtube.com')) {
          // Interceptar el script antes de que se ejecute
          const originalOnLoad = element.onload;
          element.onload = function() {
            // Aplicar optimizaciones después de que se carga el script
            setTimeout(() => {
              optimizeYouTubeEventListeners();
            }, 100);
            if (originalOnLoad) originalOnLoad.call(this);
          };
        }
        return originalSetAttribute.call(this, name, value);
      };
    }
    
    return element;
  };
}

// Función para optimizar event listeners de YouTube después de que se cargan
function optimizeYouTubeEventListeners() {
  // Buscar y optimizar todos los elementos que puedan tener event listeners de YouTube
  const allElements = document.querySelectorAll('*');
  allElements.forEach(element => {
    // Aplicar optimizaciones CSS para reducir violaciones
    element.style.touchAction = element.style.touchAction || 'manipulation';
  });
}

// Aplicar interceptores globales inmediatamente (antes de DOMContentLoaded)
setupGlobalTouchInterceptor();
interceptYouTubeScripts();

document.addEventListener('DOMContentLoaded', function() {
  initMenuTienda();
  initAccordionHerramientas();
  initBuscadorHerramientas();
  initCopyToClipboard();
  initMediaSearch();
  initClimaForm();
  initMonedaForm();
  initTraduccionForm();
  initGeolocalizacionForm();
  initNoticiasForm();
  initCorreoForm();
  initRedesSocialesForm();
  initReconocimientoImagenesForm();
  initChatbotIAForm();
  initGenericaForm();
  initHttpApiForm();
  initDbApiForm();
  
  // Aplicar optimizaciones adicionales
  addOptimizedEventListeners();
  
  // Configurar observer para iframes dinámicos
  setupIframeObserver();
  
  // Optimizar event listeners de YouTube después de un delay
  setTimeout(() => {
    optimizeYouTubeEventListeners();
  }, 1000);
  
  // Iniciar corrector de labels de YouTube
  startYouTubeLabelFixer();
  
  // Suprimir errores de CORS de YouTube en la consola
  window.addEventListener('error', function(e) {
    if (e.message && (e.message.includes('CORS') || e.message.includes('cross-origin') || e.message.includes('youtube'))) {
      e.preventDefault();
      return false;
    }
  });
  
  // Suprimir errores de promesas rechazadas relacionados con CORS
  window.addEventListener('unhandledrejection', function(e) {
    if (e.reason && e.reason.message && (e.reason.message.includes('CORS') || e.reason.message.includes('cross-origin'))) {
      e.preventDefault();
      return false;
    }
  });
}); 

// ============================================================================
// EVENT LISTENERS DELEGADOS PARA CSP COMPLIANCE
// ============================================================================

// Event listener delegado para copiar al portapapeles (CSP compliant)
document.addEventListener('click', function(e) {
    const target = e.target.closest('[data-action="copy-to-clipboard"]');
    if (!target) return;
    
    const text = target.getAttribute('data-text').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            // Opcional: mostrar notificación de éxito
            const originalText = target.innerHTML;
            target.innerHTML = '<i class="fas fa-check"></i> Copiado';
            setTimeout(() => {
                target.innerHTML = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Error al copiar:', err);
        });
    }
});

// Event listener para errores de imagen (CSP compliant)
document.addEventListener('error', function(e) {
    const target = e.target;
    if (target.tagName === 'IMG' && target.hasAttribute('data-action-error') && target.getAttribute('data-action-error') === 'hide-on-error') {
        target.style.display = 'none';
    }
}, true);


