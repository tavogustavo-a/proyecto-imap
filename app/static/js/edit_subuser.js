// console.log("--- edit_subuser.js: Archivo parseado ---"); // Log 1: Fuera de todo

document.addEventListener('DOMContentLoaded', function() {
  // console.log("--- edit_subuser.js: DOMContentLoaded disparado ---"); // Log 2: Dentro del listener

  function getCsrfToken(){
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

    // Seleccionar la sección de correos dentro de la segunda tarjeta
    const emailSection = document.getElementById('email-management-section');
    
    // Obtener datos desde atributos data-*
    const subuserId = emailSection ? emailSection.dataset.subuserId : null;
    const saveUrl = emailSection ? emailSection.dataset.saveUrl : null;

    // Salir del bloque de correos si no se encuentran los elementos necesarios
    if (!emailSection || !subuserId || !saveUrl) {
        // Continúa con permisos / catálogo aunque no haya sección de correos.
    } else {

    // El resto del código original, usando las variables subuserId y saveUrl obtenidas arriba
    // ... (Buscar elementos internos: searchInput, clearSearchBtn, etc.) ...
    const searchInput = emailSection.querySelector('#email-search-input');
    const clearSearchBtn = emailSection.querySelector('#email-search-clear-btn');
    const selectAllBtn = emailSection.querySelector('.select-all-emails');
    const deselectAllBtn = emailSection.querySelector('.deselect-all-emails');
    const saveBtn = emailSection.querySelector('.save-subuser-emails');
    const statusMsgSpan = emailSection.querySelector('.save-status-msg');
    const checkboxListDiv = emailSection.querySelector('.email-checkbox-list');

    // --- DEBUGGING --- 
    // console.log("checkboxListDiv encontrado:", checkboxListDiv); // Eliminado
    // -----------------

    if (checkboxListDiv) {
        // --- DEBUGGING --- 
        // console.log("Entrando al bloque if(checkboxListDiv)..."); // Eliminado
        // -----------------
        const emailItems = checkboxListDiv.querySelectorAll('.email-item');
        // console.log("emailItems encontrados:", emailItems); // Eliminado

        // --- Filtro de Búsqueda Masiva ---
        function syncEmailSearchClearBtn() {
            if (clearSearchBtn && searchInput) {
                clearSearchBtn.classList.toggle('show', !!searchInput.value.trim());
            }
        }

        if (searchInput && emailItems.length > 0) {
            searchInput.addEventListener('input', function() {
                syncEmailSearchClearBtn();
                const searchTerms = searchInput.value
                                        .split(/[\s,;\n]+/)
                                        .map(term => term.trim().toLowerCase())
                                        .filter(term => term.length > 0);

                emailItems.forEach(item => {
                    const emailText = item.getAttribute('data-email-text') || '';
                    let matchFound = searchTerms.length === 0 || searchTerms.some(term => emailText.includes(term));
                    if (matchFound) {
                        item.classList.remove('hidden-email');
                    } else {
                        item.classList.add('hidden-email');
                    }
                });
            });
        }

        // --- Botón Limpiar Búsqueda ---
        if (clearSearchBtn && searchInput) {
            syncEmailSearchClearBtn();
            clearSearchBtn.addEventListener('click', function(e) {
                e.preventDefault();
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.focus();
            });
        }

        // --- Manejadores de Botones (Activar/Desactivar/Guardar) ---
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const visibleCheckboxes = checkboxListDiv.querySelectorAll('.email-item:not(.hidden-email) .subuser-email-checkbox');
                visibleCheckboxes.forEach(cb => cb.checked = true);
            });
        }
        if (deselectAllBtn) {
            deselectAllBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const visibleCheckboxes = checkboxListDiv.querySelectorAll('.email-item:not(.hidden-email) .subuser-email-checkbox');
                visibleCheckboxes.forEach(cb => cb.checked = false);
            });
        }
        if (saveBtn) {
             saveBtn.addEventListener('click', function(e) {
                e.preventDefault();
                const checkedCheckboxes = checkboxListDiv.querySelectorAll('.subuser-email-checkbox:checked');
                const selectedEmails = Array.from(checkedCheckboxes).map(cb => cb.getAttribute('data-email'));

                if (statusMsgSpan) {
                     statusMsgSpan.textContent = "Guardando...";
                     statusMsgSpan.style.color = "orange";
                }
                saveBtn.disabled = true;

                // Usar la URL obtenida del atributo data-save-url
                fetch(saveUrl, { 
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    },
                    body: JSON.stringify({
                        // Usar el subuserId obtenido del atributo data-subuser-id
                        subuser_id: parseInt(subuserId, 10), // Asegurar que es un número 
                        selected_emails: selectedEmails
                    })
                })
                .then(response => {
                    if (!response.ok) {
                        return response.json().then(errData => {
                            throw new Error(errData.message || `Error ${response.status}: ${response.statusText}`);
                        }).catch(() => {
                            throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.status === "ok") {
                        if (statusMsgSpan) {
                            statusMsgSpan.textContent = "¡Cambios guardados!";
                            statusMsgSpan.style.color = "green";
                            setTimeout(() => { statusMsgSpan.textContent = ""; }, 3500);
                        }
                    } else {
                        throw new Error(data.message || "Error desconocido al guardar.");
                    }
                })
                .catch(error => {
                    console.error("Error guardando correos:", error);
                    if (statusMsgSpan) {
                        statusMsgSpan.textContent = `Error: ${error.message}`;
                        statusMsgSpan.style.color = "red";
                    }
                })
                .finally(() => {
                    saveBtn.disabled = false;
                });
            });
        }
    } // Fin if (checkboxListDiv)
    } // Fin gestión de correos

    // --- Gestión de Herramientas Públicas Permitidas ---
    const toolsSection = document.getElementById('tools-management-section');
    if (toolsSection) {
      const subuserId = toolsSection.dataset.subuserId;
      const toolCheckboxes = toolsSection.querySelectorAll('.subuser-tool-checkbox');
      const selectAllToolsBtn = toolsSection.querySelector('.select-all-tools');
      const deselectAllToolsBtn = toolsSection.querySelector('.deselect-all-tools');
      const saveToolsBtn = toolsSection.querySelector('.save-subuser-tools');
      const statusMsgTools = toolsSection.querySelector('.save-status-msg-tools');

      // Seleccionar todas
      if (selectAllToolsBtn) {
        selectAllToolsBtn.addEventListener('click', function(e) {
          e.preventDefault();
          toolCheckboxes.forEach(cb => cb.checked = true);
        });
      }
      // Desmarcar todas
      if (deselectAllToolsBtn) {
        deselectAllToolsBtn.addEventListener('click', function(e) {
          e.preventDefault();
          toolCheckboxes.forEach(cb => cb.checked = false);
        });
      }
      // Guardar cambios
      if (saveToolsBtn) {
        saveToolsBtn.addEventListener('click', function(e) {
          e.preventDefault();
          const selectedResources = Array.from(toolCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => ({
              id: parseInt(cb.dataset.toolId, 10),
              type: cb.dataset.toolType
            }));
          if (statusMsgTools) {
            statusMsgTools.textContent = 'Guardando...';
            statusMsgTools.style.color = 'orange';
          }
          saveToolsBtn.disabled = true;
          fetch(`/subusers/save_tools_permissions/${subuserId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ tool_ids: selectedResources })
          })
          .then(response => {
            if (!response.ok) {
              return response.json().then(errData => {
                throw new Error(errData.message || `Error ${response.status}: ${response.statusText}`);
              }).catch(() => {
                throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
              });
            }
            return response.json();
          })
          .then(data => {
            if (data.status === 'ok') {
              if (statusMsgTools) {
                statusMsgTools.textContent = '¡Cambios guardados!';
                statusMsgTools.style.color = 'green';
                setTimeout(() => { statusMsgTools.textContent = ''; }, 3500);
              }
            } else {
              throw new Error(data.message || 'Error desconocido al guardar.');
            }
          })
          .catch(error => {
            if (statusMsgTools) {
              statusMsgTools.textContent = `Error: ${error.message}`;
              statusMsgTools.style.color = 'red';
            }
          })
          .finally(() => {
            saveToolsBtn.disabled = false;
          });
        });
      }
    }

    // --- Permiso de acceso a tienda (can_access_store) ---
    const canAccessStoreCheckbox = document.getElementById('canAccessStoreCheckbox');
    const storePermissionStatus = document.getElementById('store-permission-status');
    if (canAccessStoreCheckbox) {
      canAccessStoreCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_store_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_access_store: canAccessStoreCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (storePermissionStatus) {
              storePermissionStatus.textContent = canAccessStoreCheckbox.checked
                ? 'Permiso de tienda activado'
                : 'Permiso de tienda desactivado';
              storePermissionStatus.style.color = canAccessStoreCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { storePermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (storePermissionStatus) {
              storePermissionStatus.textContent = 'Error al guardar';
              storePermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (storePermissionStatus) {
            storePermissionStatus.textContent = 'Error de red al guardar';
            storePermissionStatus.style.color = 'red';
          }
        });
      });
    }

    // --- Permiso de uso de cupones (can_use_coupons) ---
    const canUseCouponsCheckbox = document.getElementById('canUseCouponsCheckbox');
    const couponsPermissionStatus = document.getElementById('coupons-permission-status');
    if (canUseCouponsCheckbox) {
      canUseCouponsCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_coupons_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_use_coupons: canUseCouponsCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (couponsPermissionStatus) {
              couponsPermissionStatus.textContent = canUseCouponsCheckbox.checked
                ? 'Permiso de cupones activado'
                : 'Permiso de cupones desactivado';
              couponsPermissionStatus.style.color = canUseCouponsCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { couponsPermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (couponsPermissionStatus) {
              couponsPermissionStatus.textContent = 'Error al guardar';
              couponsPermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (couponsPermissionStatus) {
            couponsPermissionStatus.textContent = 'Error de red al guardar';
            couponsPermissionStatus.style.color = 'red';
          }
        });
      });
    }


    // --- Permiso de ver anuncios (can_view_announcements) ---
    const canViewAnnouncementsCheckbox = document.getElementById('canViewAnnouncementsCheckbox');
    const announcementsPermissionStatus = document.getElementById('announcements-permission-status');
    if (canViewAnnouncementsCheckbox) {
      canViewAnnouncementsCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_announcements_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_view_announcements: canViewAnnouncementsCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (announcementsPermissionStatus) {
              announcementsPermissionStatus.textContent = canViewAnnouncementsCheckbox.checked
                ? 'Permiso de anuncios activado'
                : 'Permiso de anuncios desactivado';
              announcementsPermissionStatus.style.color = canViewAnnouncementsCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { announcementsPermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (announcementsPermissionStatus) {
              announcementsPermissionStatus.textContent = 'Error al guardar';
              announcementsPermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (announcementsPermissionStatus) {
            announcementsPermissionStatus.textContent = 'Error de red al guardar';
            announcementsPermissionStatus.style.color = 'red';
          }
        });
      });
    }

    // --- Permiso de chat (can_chat) ---
    const canChatCheckbox = document.getElementById('canChatCheckbox');
    const chatPermissionStatus = document.getElementById('chat-permission-status');
    if (canChatCheckbox) {
      canChatCheckbox.addEventListener('change', function() {
        const subuserId = document.querySelector('[data-subuser-id]')?.dataset?.subuserId || null;
        if (!subuserId) return;
        fetch('/subusers/update_subuser_chat_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(subuserId, 10),
            can_chat: canChatCheckbox.checked
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'ok') {
            if (chatPermissionStatus) {
              chatPermissionStatus.textContent = canChatCheckbox.checked
                ? 'Permiso de chat activado'
                : 'Permiso de chat desactivado';
              chatPermissionStatus.style.color = canChatCheckbox.checked ? 'green' : 'red';
              setTimeout(() => { chatPermissionStatus.textContent = ''; }, 2000);
            }
          } else {
            if (chatPermissionStatus) {
              chatPermissionStatus.textContent = 'Error al guardar';
              chatPermissionStatus.style.color = 'red';
            }
          }
        })
        .catch(err => {
          if (chatPermissionStatus) {
            chatPermissionStatus.textContent = 'Error de red al guardar';
            chatPermissionStatus.style.color = 'red';
          }
        });
      });
    }

    // ======= BOTÓN DE NAVEGACIÓN 'VOLVER' ========
    const btnVolverSubuserLista = document.getElementById("btnVolverSubuserLista");
    if (btnVolverSubuserLista) {
        btnVolverSubuserLista.addEventListener("click", function() {
            const url = this.getAttribute("data-url");
            if (url) {
                window.location.href = url;
            }
        });
    }

    // --- Modal plataformas y precios del sub-usuario ---
    (function initSubuserCatalogModal() {
      const openBtn = document.getElementById('btnSubuserCatalog');
      const modal = document.getElementById('subuserCatalogModal');
      const overlay = document.getElementById('subuserCatalogOverlay');
      const tbody = document.getElementById('subuserCatalogTableBody');
      const markupInput = document.getElementById('subuserCatalogMarkup');
      const currencyEl = document.getElementById('subuserCatalogCurrency');
      const statusEl = document.getElementById('subuserCatalogStatus');
      const saveBtn = document.getElementById('saveSubuserCatalogBtn');
      if (!openBtn || !modal || !tbody || !markupInput) return;

      const catalogUrl = openBtn.getAttribute('data-catalog-url') || '';
      let currencyLabel = 'COP';

      function formatPrice(n, cur) {
        const x = Number(n);
        if (!isFinite(x)) return '—';
        if ((cur || currencyLabel) === 'USD') {
          return '$' + (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(2));
        }
        return '$' + Math.round(x).toLocaleString('es-CO');
      }

      function roundSale(n, cur) {
        const x = Number(n);
        if (!isFinite(x) || x < 0) return 0;
        if ((cur || currencyLabel) === 'USD') return Math.round(x * 100) / 100;
        return Math.round(x);
      }

      function setStatus(text, isError) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.style.color = isError ? '#b91c1c' : '#15803d';
      }

      function showModal(show) {
        modal.hidden = !show;
        modal.style.display = show ? 'block' : 'none';
        if (overlay) {
          overlay.hidden = !show;
          overlay.style.display = show ? 'block' : 'none';
        }
      }

      function currentMarkup() {
        const n = Number(String(markupInput.value || '').replace(',', '.'));
        return isFinite(n) && n >= 0 ? n : 0;
      }

      function applyMarkupToAutoRows() {
        const markup = currentMarkup();
        tbody.querySelectorAll('tr').forEach(function (row) {
          if (row.getAttribute('data-manual') === '1') return;
          const parent = Number(row.getAttribute('data-parent-price') || 0);
          const saleInput = row.querySelector('.subuser-catalog-sale');
          if (!saleInput) return;
          const sale = roundSale(parent + markup, currencyLabel);
          saleInput.value = sale;
        });
      }

      function renderRows(products) {
        tbody.innerHTML = (products || []).map(function (p) {
          const parent = Number(p.parent_price || 0);
          const sale = Number(p.sale_price || 0);
          const manual = !!p.manual;
          const pid = String(p.id);
          const enabledId = 'subuser_catalog_enabled_' + pid;
          const saleId = 'subuser_catalog_sale_' + pid;
          const safeName = String(p.name || '').replace(/[&<>"]/g, function (c) {
              return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
            });
          const ariaName = String(p.name || 'plataforma').replace(/"/g, "'");
          return (
            '<tr data-id="' + p.id + '" data-parent-price="' + parent + '" data-manual="' + (manual ? '1' : '0') + '"' +
            (manual ? ' class="is-manual"' : '') + '>' +
            '<td class="subuser-catalog-platform-cell">' +
            '<input type="checkbox" class="subuser-catalog-enabled" id="' + enabledId + '" name="' + enabledId + '"' +
            ' aria-label="Mostrar ' + ariaName + '"' +
            (p.enabled ? ' checked' : '') + '>' +
            '<span class="subuser-catalog-platform-name">' + safeName + '</span></td>' +
            '<td>' + formatPrice(parent, currencyLabel) + '</td>' +
            '<td><input type="number" class="subuser-catalog-sale" id="' + saleId + '" name="' + saleId + '" min="' + parent + '" step="' +
            (currencyLabel === 'USD' ? '0.01' : '1') + '" value="' + sale + '"></td>' +
            '</tr>'
          );
        }).join('');
      }

      function loadCatalog() {
        if (!catalogUrl) return;
        setStatus('Cargando…', false);
        fetch(catalogUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || data.status !== 'ok') {
              throw new Error(data && data.message ? data.message : 'No se pudo cargar el catálogo.');
            }
            currencyLabel = data.currency_label || data.tipo_precio || 'COP';
            if (currencyEl) currencyEl.textContent = currencyLabel;
            markupInput.value = data.markup != null ? data.markup : data.default_markup;
            renderRows(data.products || []);
            setStatus('', false);
            showModal(true);
          })
          .catch(function (err) {
            setStatus(err.message || 'Error de red.', true);
            showModal(true);
          });
      }

      tbody.addEventListener('input', function (ev) {
        const input = ev.target.closest('.subuser-catalog-sale');
        if (!input) return;
        const row = input.closest('tr');
        if (!row) return;
        row.setAttribute('data-manual', '1');
        row.classList.add('is-manual');
      });

      markupInput.addEventListener('input', applyMarkupToAutoRows);

      openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        loadCatalog();
      });

      function closeModal() {
        showModal(false);
        setStatus('', false);
      }

      const closeBtn = document.getElementById('closeSubuserCatalogBtn');
      const cancelBtn = document.getElementById('cancelSubuserCatalogBtn');
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
      if (overlay) overlay.addEventListener('click', closeModal);

      if (saveBtn) {
        saveBtn.addEventListener('click', function (e) {
          e.preventDefault();
          const markup = currentMarkup();
          const products = [];
          let invalid = '';
          tbody.querySelectorAll('tr').forEach(function (row) {
            const parent = Number(row.getAttribute('data-parent-price') || 0);
            const saleInput = row.querySelector('.subuser-catalog-sale');
            const enabled = !!(row.querySelector('.subuser-catalog-enabled') || {}).checked;
            const sale = roundSale(saleInput ? saleInput.value : 0, currencyLabel);
            if (sale < parent) {
              invalid = 'Hay un precio menor que el precio real. Corrígelo antes de guardar.';
            }
            const isManual = row.getAttribute('data-manual') === '1';
            products.push({
              id: parseInt(row.getAttribute('data-id'), 10),
              enabled: enabled,
              manual: isManual,
              manual_price: isManual ? sale : null
            });
          });
          if (invalid) {
            setStatus(invalid, true);
            return;
          }
          setStatus('Guardando…', false);
          saveBtn.disabled = true;
          fetch(catalogUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCsrfToken(),
              Accept: 'application/json'
            },
            body: JSON.stringify({ markup: markup, products: products })
          })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
            .then(function (res) {
              if (!res.ok || !res.data || res.data.status !== 'ok') {
                throw new Error((res.data && res.data.message) || 'No se pudo guardar.');
              }
              setStatus('Catálogo guardado.', false);
              setTimeout(closeModal, 700);
            })
            .catch(function (err) {
              setStatus(err.message || 'Error de red.', true);
            })
            .finally(function () {
              saveBtn.disabled = false;
            });
        });
      }
    })();
    // ======= FIN BOTÓN 'VOLVER' =======

    const telegramBox = document.querySelector('.edit-subuser-telegram');
    const telegramCheck = document.getElementById('canUseTelegramCheckbox');
    const telegramIdBtn = document.getElementById('btnSubuserTelegramId');
    const telegramModal = document.getElementById('subuserTelegramModal');
    const telegramIdInput = document.getElementById('subuserTelegramIdInput');
    const telegramSave = document.getElementById('saveSubuserTelegramId');
    const telegramClose = document.getElementById('closeSubuserTelegramId');
    const telegramPermStatus = document.getElementById('telegram-permission-status');
    const telegramIdStatus = document.getElementById('subuserTelegramIdStatus');
    const telegramMenuList = document.getElementById('subuserTelegramMenuList');
    const telegramMenuStatus = document.getElementById('subuserTelegramMenuStatus');
    const telegramSubId = telegramBox ? telegramBox.getAttribute('data-subuser-id') : '';

    function setTelegramMenuStatus(text, bad) {
      setTelegramStatus(telegramMenuStatus, text, bad);
    }

    function renderSubuserTelegramMenuButtons(buttons) {
      if (!telegramMenuList) return;
      telegramMenuList.innerHTML = '';
      var items = Array.isArray(buttons) ? buttons : [];
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'text-small text-center';
        empty.style.margin = '0.5rem';
        empty.textContent = 'No hay botones para gestionar.';
        telegramMenuList.appendChild(empty);
        return;
      }
      items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'subuser-telegram-menu-row';
        row.setAttribute('role', 'listitem');
        row.dataset.key = item.key;

        var name = document.createElement('span');
        name.className = 'subuser-telegram-menu-name';
        name.textContent = item.label || item.default_label || item.key;

        var switchWrap = document.createElement('label');
        switchWrap.className = 'subuser-telegram-menu-switch';
        switchWrap.title = item.enabled ? 'Encendido' : 'Apagado';
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!item.enabled;
        checkbox.setAttribute('aria-label', 'Activar ' + (item.label || item.key));
        var slider = document.createElement('span');
        switchWrap.appendChild(checkbox);
        switchWrap.appendChild(slider);
        checkbox.addEventListener('change', function () {
          if (!telegramSubId) return;
          checkbox.disabled = true;
          setTelegramMenuStatus('Guardando…', false);
          fetch('/subusers/update_subuser_telegram_menu_button', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({
              subuser_id: parseInt(telegramSubId, 10),
              key: item.key,
              enabled: !!checkbox.checked
            })
          })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
            .then(function (res) {
              if (!res.ok || !res.data || res.data.status !== 'ok') {
                throw new Error((res.data && res.data.message) || 'No se pudo guardar.');
              }
              renderSubuserTelegramMenuButtons(res.data.buttons);
              setTelegramMenuStatus('Guardado.', false);
              setTimeout(function () { setTelegramMenuStatus('', false); }, 1500);
            })
            .catch(function (err) {
              checkbox.checked = !checkbox.checked;
              setTelegramMenuStatus(err.message || 'Error al guardar.', true);
            })
            .finally(function () {
              checkbox.disabled = false;
            });
        });

        row.appendChild(name);
        row.appendChild(switchWrap);
        telegramMenuList.appendChild(row);
      });
    }

    function loadSubuserTelegramMenuButtons() {
      if (!telegramMenuList || !telegramSubId) return;
      telegramMenuList.innerHTML = '';
      setTelegramMenuStatus('Cargando botones…', false);
      fetch('/subusers/subuser_telegram_menu_buttons?subuser_id=' + encodeURIComponent(telegramSubId), {
        credentials: 'same-origin'
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || data.status !== 'ok') {
            throw new Error((data && data.message) || 'No se pudo cargar.');
          }
          setTelegramMenuStatus('', false);
          renderSubuserTelegramMenuButtons(data.buttons);
        })
        .catch(function (err) {
          setTelegramMenuStatus(err.message || 'Error al cargar botones.', true);
        });
    }

    function setTelegramStatus(el, text, bad) {
      if (!el) return;
      el.textContent = text || '';
      el.style.color = bad ? '#b91c1c' : '#15803d';
    }

    if (telegramCheck && telegramSubId) {
      telegramCheck.addEventListener('change', function () {
        fetch('/subusers/update_subuser_telegram_permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(telegramSubId, 10),
            can_use_telegram_bot: telegramCheck.checked
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data || data.status !== 'ok') {
              telegramCheck.checked = !telegramCheck.checked;
              setTelegramStatus(telegramPermStatus, (data && data.message) || 'Error al guardar', true);
              return;
            }
            if (telegramIdBtn) telegramIdBtn.classList.toggle('hidden', !telegramCheck.checked);
            setTelegramStatus(
              telegramPermStatus,
              telegramCheck.checked ? 'Bot de Telegram activado' : 'Bot de Telegram desactivado',
              !telegramCheck.checked
            );
            setTimeout(function () { setTelegramStatus(telegramPermStatus, '', false); }, 2000);
          })
          .catch(function () {
            telegramCheck.checked = !telegramCheck.checked;
            setTelegramStatus(telegramPermStatus, 'Error de red al guardar', true);
          });
      });
    }

    function closeTelegramModal() {
      if (telegramModal) telegramModal.hidden = true;
    }

    if (telegramIdBtn && telegramModal) {
      telegramIdBtn.addEventListener('click', function () {
        telegramModal.hidden = false;
        loadSubuserTelegramMenuButtons();
        if (telegramIdInput) telegramIdInput.focus();
      });
    }
    if (telegramClose) telegramClose.addEventListener('click', closeTelegramModal);
    if (telegramModal) {
      telegramModal.addEventListener('click', function (e) {
        if (e.target === telegramModal) closeTelegramModal();
      });
    }
    if (telegramSave && telegramSubId) {
      telegramSave.addEventListener('click', function () {
        telegramSave.disabled = true;
        setTelegramStatus(telegramIdStatus, 'Guardando…', false);
        fetch('/subusers/update_subuser_telegram_chat_id', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify({
            subuser_id: parseInt(telegramSubId, 10),
            telegram_chat_id: telegramIdInput ? telegramIdInput.value : ''
          })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
          .then(function (res) {
            if (!res.ok || !res.data || res.data.status !== 'ok') {
              throw new Error((res.data && res.data.message) || 'No se pudo guardar.');
            }
            if (telegramIdInput) telegramIdInput.value = res.data.telegram_chat_id || '';
            setTelegramStatus(
              telegramIdStatus,
              res.data.telegram_chat_id ? 'ID guardado. El bot ya reconoce a este sub-usuario.' : 'ID borrado. El bot ya no lo reconoce.',
              !res.data.telegram_chat_id
            );
          })
          .catch(function (err) {
            setTelegramStatus(telegramIdStatus, err.message || 'Error de red.', true);
          })
          .finally(function () {
            telegramSave.disabled = false;
          });
      });
    }
}); 