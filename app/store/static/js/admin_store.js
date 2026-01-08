document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('imageSelect');
    const prev = document.getElementById('imgPreview');
    const grid = document.getElementById('imageGrid');
    const triggerBtn = document.getElementById('imageSelectTrigger');
    const defaultTriggerText = 'Seleccionar Imagen';
    
    const staticImagesPath = (window.STATIC_IMAGES_PATH || '/static/images/');
    const defaultFormPreviewImg = `${staticImagesPath}stream1.png`; 
    const overlay = document.getElementById('imageGridOverlay');

    if (sel && prev) {
        sel.addEventListener('change', () => {
            const file = sel.value;
            if (file && file !== 'none') {
                prev.src = `${staticImagesPath}${file}`;
            } else {
                prev.src = defaultFormPreviewImg; // Si se selecciona 'none'
            }
            if(triggerBtn) triggerBtn.textContent = defaultTriggerText;
        });

        // Inicializar preview al cargar la página para el formulario
        if (sel.value && sel.value !== 'none') {
            prev.src = `${staticImagesPath}${sel.value}`;
        } else {
            prev.src = defaultFormPreviewImg;
        }
        if(triggerBtn) triggerBtn.textContent = defaultTriggerText;
    }

    // Selección de imagen en cualquier tamaño de pantalla
    if (sel && grid && triggerBtn) { 
        triggerBtn.addEventListener('click', (event) => { 
            event.stopPropagation(); 
            if (grid.style.display === 'grid') {
                grid.style.display = 'none';
                if (overlay) overlay.style.display = 'none';
                return;
            }
            grid.innerHTML = ''; 
            for (let i = 1; i <= 37; i++) {
                const imgEl = document.createElement('img');
                imgEl.src = `${staticImagesPath}stream${i}.png`;
                imgEl.alt = `stream${i}.png`;
                imgEl.title = `stream${i}.png`;
                imgEl.onclick = (e) => {
                    e.stopPropagation();
                    sel.value = `stream${i}.png`;
                    sel.dispatchEvent(new Event('change'));
                    grid.style.display = 'none';
                    if (overlay) overlay.style.display = 'none';
                };
                grid.appendChild(imgEl);
            }
            grid.style.display = 'grid';
            if (overlay) overlay.style.display = 'block';
        });
        if (overlay) {
            overlay.addEventListener('click', function() {
                grid.style.display = 'none';
                overlay.style.display = 'none';
            });
        }
        document.addEventListener('click', function(event) {
            if (grid.style.display === 'grid' && !triggerBtn.contains(event.target) && !grid.contains(event.target)) {
                grid.style.display = 'none';
                if (overlay) overlay.style.display = 'none';
            }
        });
    }

    // Botones ON/OFF y Eliminar
    const csrfToken = document.querySelector('meta[name="csrf_token"]') ? document.querySelector('meta[name="csrf_token"]').getAttribute('content') : null;
    const flashContainer = document.getElementById('flash-ajax-messages');

    function showAjaxFlash(message, category) {
        if (!flashContainer) return;
        const flashDiv = document.createElement('div');
        flashDiv.className = `flash-message ${category}`;
        flashDiv.textContent = message;
        flashContainer.appendChild(flashDiv);
        setTimeout(() => { 
            flashDiv.style.opacity = '0';
            setTimeout(() => {flashDiv.remove();}, 300);
        }, 3700);
    }

    document.querySelectorAll('.toggle-product-form').forEach(form => {
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            if (!csrfToken) {
                showAjaxFlash('Error de seguridad (Falta CSRF token).', 'error');
                return;
            }
            const button = this.querySelector('.action-btn');
            button.disabled = true; // Deshabilitar mientras se procesa
            fetch(this.dataset.action, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            .then(response => {
                if (!response.ok) { 
                    return response.json().then(errData => { 
                        throw new Error(errData.error || `HTTP error! status: ${response.status}`); 
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    button.textContent = data.new_state;
                    button.classList.remove('action-green', 'action-red');
                    button.classList.add(data.new_class);
                    button.setAttribute('data-enabled', data.new_state === 'ON' ? 'true' : 'false');
                    showAjaxFlash(data.message || 'Estado actualizado.', 'success');
                } else {
                    showAjaxFlash(data.error || 'Error al actualizar.', 'error');
                }
            })
            .catch(error => {
                showAjaxFlash(error.message || 'Error de red o del servidor al actualizar.', 'error');
            })
            .finally(() => {
                button.disabled = false; // Rehabilitar al finalizar
            });
        });
    });

    document.querySelectorAll('.delete-product-form').forEach(form => {
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            if (!confirm('¿Estás seguro de que deseas eliminar este producto?')) {
                return;
            }
            if (!csrfToken) {
                showAjaxFlash('Error de seguridad (Falta CSRF token).', 'error');
                return;
            }
            // Verificación segura para closest
            const row = this && typeof this.closest === 'function' ? this.closest('tr') : null;
            const rowId = row ? row.id : null;
            fetch(this.dataset.action, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            .then(response => {
                if (!response.ok) { 
                     return response.json().then(errData => { 
                        throw new Error(errData.error || `HTTP error! status: ${response.status}`); 
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    document.getElementById(rowId)?.remove();
                    showAjaxFlash(data.message || 'Producto eliminado.', 'success');
                    const tbody = document.getElementById('products-table-body');
                    if (tbody && tbody.children.length === 0) {
                        // Verificación segura para closest
                        const table = tbody && typeof tbody.closest === 'function' ? tbody.closest('table') : null;
                        const colspan = table ? table.querySelector('thead th').length || 6 : 6;
                        tbody.innerHTML = `<tr><td colspan="${colspan}">No hay productos todavía.</td></tr>`;
                    }
                } else {
                    showAjaxFlash(data.error || 'Error al eliminar.', 'error');
                }
            })
            .catch(error => {
                showAjaxFlash(error.message || 'Error de red o del servidor al eliminar.', 'error');
            });
        });
    });

    
    const searchInput = document.getElementById('searchProductInput');
    const searchBtn = document.getElementById('searchProductBtn');
    const productsTableBody = document.getElementById('products-table-body');
    if (searchInput && searchBtn && productsTableBody) {
        function filterProducts() {
            const value = searchInput.value.trim().toLowerCase();
            const rows = productsTableBody.querySelectorAll('tr[data-product-name]');
            let anyVisible = false;
            rows.forEach(row => {
                const name = row.getAttribute('data-product-name');
                if (!value || name.includes(value)) {
                    row.style.display = '';
                    anyVisible = true;
                } else {
                    row.style.display = 'none';
                }
            });
            // Si no hay resultados, muestra mensaje
            const noRows = productsTableBody.querySelectorAll('tr[data-product-name]:not([style*="display: none"])').length === 0;
            let noResultRow = productsTableBody.querySelector('.no-result-row');
            if (noRows) {
                if (!noResultRow) {
                    noResultRow = document.createElement('tr');
                    noResultRow.className = 'no-result-row';
                    noResultRow.innerHTML = '<td colspan="6">No hay productos que coincidan.</td>';
                    productsTableBody.appendChild(noResultRow);
                }
            } else if (noResultRow) {
                noResultRow.remove();
            }
        }
        searchInput.addEventListener('input', filterProducts);
        searchBtn.addEventListener('click', filterProducts);
    }

    // Funciones ---
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf_token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    function renderCouponsTable(coupons) {
        const tbody = document.getElementById('coupons-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!coupons.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No hay cupones aún.</td></tr>';
            return;
        }
        for (const c of coupons) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${c.name}</td>
              <td>$${parseInt(c.discount_cop)} COP</td>
              <td>$${parseInt(c.discount_usd)} USD</td>
              <td>${c.products.map(p=>p.name).join(', ')}</td>
              <td>${c.duration_days} días</td>
              <td>${c.max_uses_per_user}</td>
              <td>
                <button class="action-btn ${c.enabled ? 'action-green' : 'action-red'} btn-coupon-toggle" data-id="${c.id}">${c.enabled ? 'ON' : 'OFF'}</button>
                <button class="action-btn action-blue btn-coupon-edit" data-id="${c.id}">Editar</button>
                <button class="btn-panel btn-red btn-sm btn-coupon-delete" data-id="${c.id}" title="Eliminar">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            `;
            tbody.appendChild(tr);
        }
    }

    function loadCoupons() {
        fetch('/tienda/admin/coupons/list', {
            headers: { 'X-CSRFToken': getCsrfToken() }
        })
          .then(r=>r.json())
          .then(data=>renderCouponsTable(data.coupons));
    }

    const couponForm = document.getElementById('newCouponForm');
    if (couponForm) {
        couponForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(couponForm);
            // Obtener input oculto
            let products = [];
            const productsHidden = formData.get('products_hidden');
            if (productsHidden) {
                products = productsHidden.split(',').map(Number).filter(Boolean);
            }
            const data = {
                coupon_name: formData.get('coupon_name'),
                discount_cop: formData.get('discount_cop'),
                discount_usd: formData.get('discount_usd'),
                products: products,
                duration_days: formData.get('duration_days'),
                max_uses_per_user: formData.get('max_uses_per_user')
            };
            fetch('/tienda/admin/coupons/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify(data)
            })
            .then(r=>r.json())
            .then(resp=>{
                if (resp.success) {
                    couponForm.reset();
                    loadCoupons();
                } else {
                    alert(resp.error || 'Error al crear cupón');
                }
            });
        });
    }

    // Manejar formularios de toggle de cupones usando la misma lógica que productos
    const csrfTokenForCoupons = getCsrfToken();
    document.querySelectorAll('.toggle-coupon-form').forEach(form => {
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            if (!csrfTokenForCoupons) {
                return;
            }
            const button = this.querySelector('.action-btn');
            button.disabled = true; // Deshabilitar mientras se procesa
            fetch(this.dataset.action, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfTokenForCoupons, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
            .then(response => {
                if (!response.ok) { 
                    return response.json().then(errData => { 
                        throw new Error(errData.error || `HTTP error! status: ${response.status}`); 
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    button.textContent = data.new_state;
                    button.classList.remove('action-green', 'action-red');
                    button.classList.add(data.new_class);
                }
            })
            .catch(error => {
                console.error('Error al cambiar estado del cupón:', error);
            })
            .finally(() => {
                button.disabled = false; // Rehabilitar al finalizar
            });
        });
    });
    
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('btn-coupon-delete')) {
            if (!confirm('¿Eliminar este cupón?')) return;
            const id = e.target.dataset.id;
            fetch(`/tienda/admin/coupons/delete/${id}`, {method:'POST', headers: { 'X-CSRFToken': getCsrfToken() }})
              .then(r=>r.json())
              .then(resp=>{
                if (resp.success) loadCoupons();
              });
        }
        if (e.target.classList.contains('btn-coupon-edit')) {
            alert('Edición de cupones próximamente.');
        }
    });

    window.addEventListener('DOMContentLoaded', loadCoupons);
}); 
