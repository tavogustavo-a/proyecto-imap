// Paginación y búsqueda para la tabla de productos asociados en editar rol



let currentRoleId = null;

// Obtener todos los productos de la tabla al cargar (del DOM)
let allEditProducts = [];
let currentEditPage = 1;
let editProductsPerPage = 20;
let editProductSearch = '';

function getEditProductsFromDOM() {
    const rows = Array.from(document.querySelectorAll('#roles-products-table tbody tr[data-product-id]'));
    return rows.map(tr => {
        return {
            tr: tr,
            name: tr.querySelector('td').innerText.trim().toLowerCase(),
            id: tr.getAttribute('data-product-id')
        };
    });
}

function renderEditProductsTable() {
    const tbody = document.querySelector('#roles-products-table tbody');
    if (!tbody) return;
    
    let filtered = allEditProducts;
    if (editProductSearch) {
        filtered = filtered.filter(p => p.name.includes(editProductSearch));
    }
    // Paginación
    let total = filtered.length;
    let perPage = editProductsPerPage === 'all' ? total : parseInt(editProductsPerPage);
    let totalPages = perPage === 0 ? 1 : Math.ceil(total / perPage);
    if (currentEditPage > totalPages) currentEditPage = totalPages;
    if (currentEditPage < 1) currentEditPage = 1;
    let start = perPage === 0 ? 0 : (currentEditPage - 1) * perPage;
    let end = perPage === 0 ? total : start + perPage;
    
    allEditProducts.forEach(p => p.tr.style.display = 'none');
    // Paginación y filtro
    filtered.slice(start, end).forEach(p => p.tr.style.display = '');
    // Botones
    document.getElementById('prevPageBtn').disabled = currentEditPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentEditPage >= totalPages;
}

document.addEventListener('DOMContentLoaded', function() {
    // Obtener el ID del rol desde el data attribute del formulario
    const roleForm = document.getElementById('editRoleForm');
    if (roleForm) {
        currentRoleId = roleForm.getAttribute('data-role-id');
        // Para otros scripts
        window.currentRoleId = currentRoleId;
    }
    
    // Inicializar productos
    allEditProducts = getEditProductsFromDOM();
    
    const searchInput = document.getElementById('searchProductInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            editProductSearch = searchInput.value.trim().toLowerCase();
            currentEditPage = 1;
            renderEditProductsTable();
        });
        
        // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
        searchInput.addEventListener('search', function() {
            // Si el campo está vacío, limpiar filtros
            if (this.value === '') {
                editProductSearch = '';
                currentEditPage = 1;
                renderEditProductsTable();
            }
        });
    }
    
    const clearBtn = document.getElementById('clearProductSearch');
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', function() {
            searchInput.value = '';
            editProductSearch = '';
            currentEditPage = 1;
            renderEditProductsTable();
            searchInput.focus();
        });
    }
    // Cantidad
    const showCount = document.getElementById('showCount');
    if (showCount) {
        showCount.addEventListener('change', function() {
            editProductsPerPage = showCount.value === 'all' ? 'all' : parseInt(showCount.value);
            currentEditPage = 1;
            renderEditProductsTable();
        });
    }
    // Botones paginación
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            if (currentEditPage > 1) {
                currentEditPage--;
                renderEditProductsTable();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            let filtered = allEditProducts;
            if (editProductSearch) {
                filtered = filtered.filter(p => p.name.includes(editProductSearch));
            }
            let total = filtered.length;
            let perPage = editProductsPerPage === 'all' ? total : parseInt(editProductsPerPage);
            let totalPages = perPage === 0 ? 1 : Math.ceil(total / perPage);
            if (currentEditPage < totalPages) {
                currentEditPage++;
                renderEditProductsTable();
            }
        });
    }
    // Manejo de inputs de descuento según tipo de precio en editar rol ===
    const discountUsdEdit = document.getElementById('discountUsdEdit');
    const discountCopEdit = document.getElementById('discountCopEdit');
    const tipoUsdEdit = document.getElementById('tipoUsdEdit');
    const tipoCopEdit = document.getElementById('tipoCopEdit');

    function updateDiscountInputsEdit() {
        if (tipoUsdEdit && tipoUsdEdit.checked) {
            if (discountUsdEdit) discountUsdEdit.disabled = false;
            if (discountCopEdit) {
                discountCopEdit.disabled = true;
                discountCopEdit.value = 0;
            }
        } else if (tipoCopEdit && tipoCopEdit.checked) {
            if (discountCopEdit) discountCopEdit.disabled = false;
            if (discountUsdEdit) {
                discountUsdEdit.disabled = true;
                discountUsdEdit.value = 0;
            }
        }
    }
    if (tipoUsdEdit && tipoCopEdit) {
        tipoUsdEdit.addEventListener('change', updateDiscountInputsEdit);
        tipoCopEdit.addEventListener('change', updateDiscountInputsEdit);
        // Inicializar al cargar
        updateDiscountInputsEdit();
    }
    // Antes de enviar el formulario
    const editRoleForm = document.getElementById('editRoleForm');
    if (editRoleForm) {
        editRoleForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(editRoleForm);
            const isCop = document.getElementById('tipoCopEdit')?.checked;
            // Limpiar descuentos de la moneda no seleccionada
            if (isCop) {
                if (document.getElementById('discountUsdEdit')) document.getElementById('discountUsdEdit').value = 0;
                document.querySelectorAll('input[name^="discount_usd_extra_"]').forEach(inp => inp.value = 0);
            } else {
                if (document.getElementById('discountCopEdit')) document.getElementById('discountCopEdit').value = 0;
                document.querySelectorAll('input[name^="discount_cop_extra_"]').forEach(inp => inp.value = 0);
            }
            // Enviar solo los productos con checkbox 'Ver' marcado
            const productosIds = Array.from(document.querySelectorAll('#roles-products-table tbody tr[data-product-id]'))
                .filter(tr => tr.querySelector('input[type="checkbox"]').checked)
                .map(tr => tr.getAttribute('data-product-id'));
            const data = {
                name: formData.get('name'),
                tipo_precio: formData.get('tipo_precio'),
                descuentos: {
                    usd: formData.get('discount_usd') || undefined,
                    cop: formData.get('discount_cop') || undefined,
                    productos: {}
                },
                estado: document.getElementById('roleStatus').textContent === 'ON',
                productos: productosIds.map(id => ({ id }))
            };
            // Descuentos extra de todos los productos
            productosIds.forEach(prodId => {
                if (!data.descuentos.productos[prodId]) data.descuentos.productos[prodId] = {usd: 0, cop: 0};
                const copInput = document.querySelector(`input[name="discount_cop_extra_${prodId}"]`);
                const usdInput = document.querySelector(`input[name="discount_usd_extra_${prodId}"]`);
                data.descuentos.productos[prodId].cop = parseFloat(copInput?.value || 0);
                data.descuentos.productos[prodId].usd = parseFloat(usdInput?.value || 0);
            });
            const roleId = formData.get('role_id');
            updateDiscountInputsEdit();
            fetch(`/tienda/admin/roles/edit/${roleId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify(data)
            })
            .then(r=>r.json())
            .then(resp=>{
                if (resp.success) {
                    localStorage.setItem('rolesSuccessMsg', '¡Cambios guardados correctamente!');
                    window.location.href = '/tienda/admin/roles';
                } else {
                    alert(resp.error || 'Error al guardar los cambios.');
                }
            });
        });
    }
    // Inicial
    renderEditProductsTable();
});

function updateProductTableByTipoPrecio() {
    const isCop = tipoCopEdit && tipoCopEdit.checked;
    document.querySelectorAll('#roles-products-table tbody tr').forEach(tr => {
        // Original
        const tdOriginal = tr.children[2];
        const priceCop = tr.getAttribute('data-price-cop');
        const priceUsd = tr.getAttribute('data-price-usd');
        tdOriginal.innerHTML = isCop ? `$${parseFloat(priceCop)} COP` : `$${parseFloat(priceUsd)} USD`;
        // General
        const tdGeneral = tr.children[3];
        const descuentoCop = parseFloat(document.getElementById('discountCopEdit')?.value || 0);
        const descuentoUsd = parseFloat(document.getElementById('discountUsdEdit')?.value || 0);
        tdGeneral.innerHTML = isCop ? `-$${descuentoCop} COP` : `-$${descuentoUsd} USD`;
        // Adicional
        const tdAdicional = tr.children[4];
        const inputCop = tdAdicional.querySelector('input[name^="discount_cop_extra_"]');
        const inputUsd = tdAdicional.querySelector('input[name^="discount_usd_extra_"]');
        if (isCop) {
            if (inputCop) inputCop.style.display = '';
            if (inputUsd) { inputUsd.style.display = 'none'; inputUsd.value = ''; }
        } else {
            if (inputUsd) inputUsd.style.display = '';
            if (inputCop) { inputCop.style.display = 'none'; inputCop.value = ''; }
        }
        // Final
        const tdFinal = tr.children[5];
        let finalCop = 0, finalUsd = 0;
        if (isCop) {
            finalCop = parseFloat(priceCop) - descuentoCop - (parseFloat(inputCop?.value || 0));
            tdFinal.innerText = `$${Math.max(0, Math.round(finalCop * 100) / 100)} COP`;
        } else {
            finalUsd = parseFloat(priceUsd) - descuentoUsd - (parseFloat(inputUsd?.value || 0));
            tdFinal.innerText = `$${Math.max(0, Math.round(finalUsd * 100) / 100)} USD`;
        }
    });
}
if (tipoUsdEdit && tipoCopEdit) {
    tipoUsdEdit.addEventListener('change', updateProductTableByTipoPrecio);
    tipoCopEdit.addEventListener('change', updateProductTableByTipoPrecio);
    document.getElementById('discountUsdEdit')?.addEventListener('input', updateProductTableByTipoPrecio);
    document.getElementById('discountCopEdit')?.addEventListener('input', updateProductTableByTipoPrecio);
    // Inicializar al cargar
    updateProductTableByTipoPrecio();
}

// Listeners para inputs de D. Adicional (COP y USD) para actualizar solo la fila correspondiente
function addAdicionalListeners() {
  document.querySelectorAll('input[name^="discount_cop_extra_"], input[name^="discount_usd_extra_"]').forEach(input => {
    input.removeEventListener('input', adicionalInputHandler);
    input.addEventListener('input', adicionalInputHandler);
  });
}
function adicionalInputHandler() {
  updateProductTableByTipoPrecio();
  validarPreciosFinalesYErrores();
}
// addAdicionalListeners después de renderizar la tabla
renderEditProductsTable();
addAdicionalListeners();

function validarPreciosFinalesYErrores() {
  let hayError = false;
  const isCop = tipoCopEdit && tipoCopEdit.checked;
  const descuentoCop = parseFloat(document.getElementById('discountCopEdit')?.value || 0);
  const descuentoUsd = parseFloat(document.getElementById('discountUsdEdit')?.value || 0);
  
  document.querySelectorAll('#roles-products-table tbody tr[data-product-id]').forEach(tr => {
    const priceCop = parseFloat(tr.getAttribute('data-price-cop'));
    const priceUsd = parseFloat(tr.getAttribute('data-price-usd'));
    const inputCop = tr.querySelector('input[name^="discount_cop_extra_"]');
    const inputUsd = tr.querySelector('input[name^="discount_usd_extra_"]');
    const tdAdicional = tr.children[4];
    // Input oculto
    if (isCop && inputUsd) inputUsd.value = 0;
    if (!isCop && inputCop) inputCop.value = 0;
    // Limpiar mensaje de error previo
    let errorMsg = tdAdicional.querySelector('.adicional-error-msg');
    if (errorMsg) errorMsg.remove();
    if (inputCop) inputCop.classList.remove('input-error');
    if (inputUsd) inputUsd.classList.remove('input-error');
    if (isCop) {
      let finalCop = priceCop - descuentoCop - (parseFloat(inputCop?.value || 0));
      if (finalCop < 1) {
        hayError = true;
        if (inputCop) inputCop.classList.add('input-error');
        const msg = document.createElement('div');
        msg.className = 'adicional-error-msg';
        msg.innerText = 'El precio final no puede\nser menor a 1 COP';
        tdAdicional.appendChild(msg);
      }
    } else {
      let finalUsd = priceUsd - descuentoUsd - (parseFloat(inputUsd?.value || 0));
      if (finalUsd < 0.1) {
        hayError = true;
        if (inputUsd) inputUsd.classList.add('input-error');
        const msg = document.createElement('div');
        msg.className = 'adicional-error-msg';
        msg.innerText = 'El precio final no puede\nser menor a 0.1 USD';
        tdAdicional.appendChild(msg);
      }
    }
  });
  // Botón Guardar Cambios
  const btnGuardar = document.querySelector('.edit-role-save-btn');
  if (btnGuardar) btnGuardar.disabled = !!hayError;
}
// Al cambiar descuento general
if (document.getElementById('discountUsdEdit')) {
  document.getElementById('discountUsdEdit').addEventListener('input', validarPreciosFinalesYErrores);
}
if (document.getElementById('discountCopEdit')) {
  document.getElementById('discountCopEdit').addEventListener('input', validarPreciosFinalesYErrores);
}

// Función para mostrar mensaje de éxito
function mostrarMensajeExito(mensaje) {
  let msgDiv = document.getElementById('mensaje-exito-rol');
  if (!msgDiv) {
    msgDiv = document.createElement('div');
    msgDiv.id = 'mensaje-exito-rol';
    msgDiv.style.position = 'fixed';
    msgDiv.style.top = '30px';
    msgDiv.style.left = '50%';
    msgDiv.style.transform = 'translateX(-50%)';
    msgDiv.style.background = '#4BB543';
    msgDiv.style.color = 'white';
    msgDiv.style.padding = '12px 32px';
    msgDiv.style.borderRadius = '8px';
    msgDiv.style.fontWeight = 'bold';
    msgDiv.style.fontSize = '1.1rem';
    msgDiv.style.zIndex = '9999';
    document.body.appendChild(msgDiv);
  }
  msgDiv.innerText = mensaje;
  msgDiv.style.display = 'block';
  setTimeout(() => { msgDiv.style.display = 'none'; }, 3500);
} 
