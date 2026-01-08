// Búsqueda para la tabla de productos asociados en editar productos de usuario

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf_token"]');
  return meta ? meta.getAttribute('content') : '';
}

let currentUserId = null;

// Obtener todos los productos de la tabla al cargar (del DOM)
let allEditProducts = [];
let editProductSearch = '';

function getEditProductsFromDOM() {
    const rows = Array.from(document.querySelectorAll('#user-products-table tbody tr[data-product-id]'));
    return rows.map(tr => {
        return {
            tr: tr,
            name: tr.querySelector('td').textContent.trim().toLowerCase(),
            id: tr.getAttribute('data-product-id')
        };
    });
}

function renderEditProductsTable() {
    const tbody = document.querySelector('#user-products-table tbody');
    if (!tbody) return;
    
    let filtered = allEditProducts;
    if (editProductSearch) {
        filtered = filtered.filter(p => p.name.includes(editProductSearch));
    }
    
    // Mostrar todos los productos filtrados (sin paginación)
    allEditProducts.forEach(p => {
        if (filtered.includes(p)) {
            p.tr.classList.remove('d-none');
        } else {
            p.tr.classList.add('d-none');
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    // Obtener el ID del usuario desde el data attribute del formulario
    const userForm = document.getElementById('editUserProductsForm');
    if (userForm) {
        currentUserId = userForm.getAttribute('data-user-id');
    }
    
    // Obtener tipo_precio del input hidden
    const tipoPrecioDisplay = document.getElementById('tipoPrecioDisplay');
    const tipoPrecio = tipoPrecioDisplay ? tipoPrecioDisplay.value.trim() : 'USD';
    const isCop = tipoPrecio === 'COP';
    
    // Inicializar productos
    allEditProducts = getEditProductsFromDOM();
    
    const searchInput = document.getElementById('searchProductInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            editProductSearch = searchInput.value.trim().toLowerCase();
            renderEditProductsTable();
        });
        
        // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
        searchInput.addEventListener('search', function() {
            if (this.value === '') {
                editProductSearch = '';
                renderEditProductsTable();
            }
        });
    }
    
    // Actualizar tabla según tipo_precio
    function updateProductTableByTipoPrecio() {
        document.querySelectorAll('#user-products-table tbody tr[data-product-id]').forEach(tr => {
            const priceCop = tr.getAttribute('data-price-cop');
            const priceUsd = tr.getAttribute('data-price-usd');
            const tdAdicional = tr.children[2];
            const inputCop = tdAdicional.querySelector('input[name^="discount_cop_extra_"]');
            const inputUsd = tdAdicional.querySelector('input[name^="discount_usd_extra_"]');
            if (isCop) {
                if (inputCop) inputCop.classList.remove('d-none');
                if (inputUsd) { inputUsd.classList.add('d-none'); inputUsd.value = 0; }
            } else {
                if (inputUsd) inputUsd.classList.remove('d-none');
                if (inputCop) { inputCop.classList.add('d-none'); inputCop.value = 0; }
            }
            const tdFinal = tr.children[3];
            let finalCop = 0, finalUsd = 0;
            if (isCop) {
                finalCop = parseFloat(priceCop) - (parseFloat(inputCop?.value || 0));
                tdFinal.textContent = `$${Math.max(0, Math.round(finalCop * 100) / 100)} COP`;
            } else {
                finalUsd = parseFloat(priceUsd) - (parseFloat(inputUsd?.value || 0));
                tdFinal.textContent = `$${Math.max(0, Math.round(finalUsd * 100) / 100)} USD`;
            }
        });
    }
    
    function validarPreciosFinalesYErrores() {
        let hayError = false;
        
        document.querySelectorAll('#user-products-table tbody tr[data-product-id]').forEach(tr => {
            const priceCop = parseFloat(tr.getAttribute('data-price-cop'));
            const priceUsd = parseFloat(tr.getAttribute('data-price-usd'));
            const inputCop = tr.querySelector('input[name^="discount_cop_extra_"]');
            const inputUsd = tr.querySelector('input[name^="discount_usd_extra_"]');
            const tdAdicional = tr.children[2];
            
            if (isCop && inputUsd) inputUsd.value = 0;
            if (!isCop && inputCop) inputCop.value = 0;
            
            let errorMsg = tdAdicional.querySelector('.adicional-error-msg');
            if (errorMsg) errorMsg.remove();
            if (inputCop) inputCop.classList.remove('input-error');
            if (inputUsd) inputUsd.classList.remove('input-error');
            
            if (isCop) {
                let finalCop = priceCop - (parseFloat(inputCop?.value || 0));
                if (finalCop < 1) {
                    hayError = true;
                    if (inputCop) inputCop.classList.add('input-error');
                    const msg = document.createElement('div');
                    msg.className = 'adicional-error-msg';
                    msg.textContent = 'El precio final no puede\nser menor a 1 COP';
                    tdAdicional.appendChild(msg);
                }
            } else {
                let finalUsd = priceUsd - (parseFloat(inputUsd?.value || 0));
                if (finalUsd < 0.1) {
                    hayError = true;
                    if (inputUsd) inputUsd.classList.add('input-error');
                    const msg = document.createElement('div');
                    msg.className = 'adicional-error-msg';
                    msg.textContent = 'El precio final no puede\nser menor a 0.1 USD';
                    tdAdicional.appendChild(msg);
                }
            }
        });
        
        return !hayError;
    }
    
    // Función para guardar automáticamente
    function saveProductsAutomatically() {
        if (!currentUserId) return;
        
        // Enviar solo los productos con checkbox 'Ver' marcado
        const productosIds = Array.from(document.querySelectorAll('#user-products-table tbody tr[data-product-id]'))
            .filter(tr => {
                const checkbox = tr.querySelector('input[type="checkbox"]');
                return checkbox && checkbox.checked;
            })
            .map(tr => parseInt(tr.getAttribute('data-product-id')));
        
        const data = {
            productos_permitidos: productosIds,
            descuentos_productos: {}
        };
        
        // Descuentos extra de todos los productos marcados
        productosIds.forEach(prodId => {
            if (!data.descuentos_productos[prodId]) data.descuentos_productos[prodId] = {usd: 0, cop: 0};
            const copInput = document.querySelector(`input[name="discount_cop_extra_${prodId}"]`);
            const usdInput = document.querySelector(`input[name="discount_usd_extra_${prodId}"]`);
            if (copInput) {
                const copValue = parseFloat(copInput.value || 0);
                data.descuentos_productos[prodId].cop = isNaN(copValue) ? 0 : Math.max(0, copValue);
            }
            if (usdInput) {
                const usdValue = parseFloat(usdInput.value || 0);
                data.descuentos_productos[prodId].usd = isNaN(usdValue) ? 0 : Math.max(0, usdValue);
            }
        });
        
        // Limpiar descuentos de la moneda no seleccionada en los datos antes de enviar
        if (isCop) {
            productosIds.forEach(prodId => {
                data.descuentos_productos[prodId].usd = 0;
            });
        } else {
            productosIds.forEach(prodId => {
                data.descuentos_productos[prodId].cop = 0;
            });
        }
        
        const csrfToken = getCsrfToken();
        
        fetch(`/admin/users/${currentUserId}/edit_products`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'X-CSRFToken': csrfToken 
            },
            body: JSON.stringify(data)
        })
        .then(r => {
            if (!r.ok) {
                return r.text().then(text => {
                    throw new Error(`HTTP error! status: ${r.status}, body: ${text}`);
                });
            }
            return r.json();
        })
        .then(resp => {
            if (resp.status !== 'ok') {
                alert('Error al guardar: ' + (resp.message || 'Error desconocido'));
            }
        })
        .catch(err => {
            alert('Error al guardar: ' + err.message);
        });
    }
    
    // Agregar event listeners a los checkboxes para guardar automáticamente
    function addCheckboxListeners() {
        const checkboxes = document.querySelectorAll('#user-products-table tbody tr[data-product-id] input[type="checkbox"]');
        
        checkboxes.forEach((checkbox) => {
            // Remover listener anterior si existe
            const newCheckbox = checkbox.cloneNode(true);
            checkbox.parentNode.replaceChild(newCheckbox, checkbox);
            
            // Agregar listener al nuevo checkbox
            newCheckbox.addEventListener('change', function() {
                saveProductsAutomatically();
            });
        });
    }
    
    // Agregar event listeners a los inputs de descuento para guardar automáticamente (con debounce)
    let descuentoTimeout = null;
    function addDescuentoListeners() {
        document.querySelectorAll('input[name^="discount_cop_extra_"], input[name^="discount_usd_extra_"]').forEach(input => {
            input.addEventListener('input', function() {
                updateProductTableByTipoPrecio();
                validarPreciosFinalesYErrores();
                
                // Guardar automáticamente después de 1 segundo sin cambios (debounce)
                clearTimeout(descuentoTimeout);
                descuentoTimeout = setTimeout(() => {
                    saveProductsAutomatically();
                }, 1000);
            });
        });
    }
    
    // Inicializar
    updateProductTableByTipoPrecio();
    renderEditProductsTable();
    addCheckboxListeners();
    addDescuentoListeners();
});
