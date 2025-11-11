// Funciones (modal productos)

function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
}

let allRoles = [];

// Variables de paginación y elementos
const roleTableBody = document.getElementById('roles-table-body');
const showRoleCount = document.getElementById('showRoleCount');
const searchRoleInput = document.getElementById('searchRoleInput');
let roleCurrentPage = 1;
let rolePerPage = showRoleCount ? (showRoleCount.value === 'all' ? 9999 : parseInt(showRoleCount.value)) : 10;

function renderRolesTable(roles) {
    const tbody = document.getElementById('roles-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!roles.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No hay roles aún.</td></tr>';
        return;
    }
    for (const r of roles) {
        let descuentos = '';
        if (r.descuentos) {
            if (r.descuentos.usd && r.descuentos.cop) {
                descuentos += `$${r.descuentos.usd} USD<br>$${r.descuentos.cop} COP`;
            } else if (r.descuentos.usd) {
                descuentos += `$${r.descuentos.usd} USD`;
            } else if (r.descuentos.cop) {
                descuentos += `$${r.descuentos.cop} COP`;
            }
        }
        // Lógica invertida: si está activo, mostrar OFF (rojo); si está inactivo, mostrar ON (verde)
        const toggleText = r.enabled ? 'OFF' : 'ON';
        const toggleClass = r.enabled ? 'action-red' : 'action-green';
        tbody.innerHTML += `
        <tr data-role-name="${r.name}">
            <td>${r.name}</td>
            <td>${descuentos || '-'}</td>
            <td>
              <div class="action-stack">
                <button class="action-btn btn-role-toggle ${toggleClass}" data-id="${r.id}">${toggleText}</button>
                <button class="action-btn action-blue btn-role-edit" data-id="${r.id}">Editar</button>
                <button class="action-btn action-red btn-role-delete" data-id="${r.id}" title="Eliminar">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
        </tr>`;
    }
}

// Funciones de paginación para roles
function getRoleRows() {
  return document.getElementById('roles-table-body') ? Array.from(document.getElementById('roles-table-body').querySelectorAll('tr[data-role-name]')) : [];
}

function getFilteredRoleRows() {
  const roleRows = getRoleRows();
  if (!roleRows.length) return [];
  // Solo visibles (no .filtered-out)
  return roleRows.filter(row => !row.classList.contains('filtered-out'));
}

function filterRolesTable() {
    const roleRows = getRoleRows();
    if (!roleRows.length) return;
    const searchTerm = searchRoleInput.value.toLowerCase();
    roleRows.forEach(row => {
        const roleName = row.getAttribute('data-role-name');
        if (!searchTerm || (roleName && roleName.includes(searchTerm))) {
            row.classList.remove('filtered-out');
        } else {
            row.classList.add('filtered-out');
        }
    });
    roleCurrentPage = 1;
    renderRolePage();
}

function renderRolePage() {
    const roleRows = getRoleRows();
    if (!roleRows.length) return;
    const filteredRows = getFilteredRoleRows();
    const totalRows = filteredRows.length;
    const totalPages = showRoleCount.value === 'all' ? 1 : Math.ceil(totalRows / rolePerPage);
    let start = showRoleCount.value === 'all' ? 0 : (roleCurrentPage - 1) * rolePerPage;
    let end = showRoleCount.value === 'all' ? totalRows : start + rolePerPage;
    
    filteredRows.forEach((row, i) => {
        if (showRoleCount.value === 'all' || (i >= start && i < end)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    
    // Los que no están en filteredRows deben ocultarse
    roleRows.forEach(row => {
        if (!filteredRows.includes(row)) {
            row.style.display = 'none';
        }
    });
    
    // Actualizar botones de paginación
    updatePaginationButtons(totalPages);
}

function updatePaginationButtons(totalPages) {
    const prevBtn = document.getElementById('prevRolePageBtn');
    const nextBtn = document.getElementById('nextRolePageBtn');
    
    if (prevBtn) {
        prevBtn.disabled = roleCurrentPage <= 1;
        prevBtn.style.opacity = roleCurrentPage <= 1 ? '0.5' : '1';
    }
    
    if (nextBtn) {
        nextBtn.disabled = roleCurrentPage >= totalPages;
        nextBtn.style.opacity = roleCurrentPage >= totalPages ? '0.5' : '1';
    }
}

function loadRoles() {
    fetch('/tienda/admin/roles/list', {
        headers: { 'X-CSRFToken': getCsrfToken() }
    })
      .then(r=>r.json())
      .then(data=>{
        allRoles = data.roles || [];
        renderRolesTable(allRoles);
        // Inicializar la paginación después de cargar los datos
        setTimeout(() => {
            renderRolePage();
        }, 100);
      });
}

const roleForm = document.getElementById('newRoleForm');
if (roleForm) {
    roleForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const formData = new FormData(roleForm);
        let productos = [];
        const productsHidden = formData.get('products_hidden');
        if (productsHidden) {
            productos = productsHidden.split(',').map(Number).filter(Boolean);
        }
        const data = {
            name: formData.get('name'),
            tipo_precio: formData.get('tipo_precio'),
            descuentos: {
                usd: formData.get('discount_usd') || undefined,
                cop: formData.get('discount_cop') || undefined
            },
            estado: true,
            productos: productos
        };

        // Descuentos extra por producto
        document.querySelectorAll('input[name^="discount_cop_extra_"], input[name^="discount_usd_extra_"]').forEach(input => {
            const match = input.name.match(/discount_(cop|usd)_extra_(\d+)/);
            if (match) {
                const tipo = match[1];
                const prodId = match[2];
                let prod = data.productos.find(p => p.id == prodId);
                if (prod) {
                    prod[`discount_${tipo}_extra`] = input.value || 0;
                }
                // Si no está marcado, NO lo agregues al array
            }
        });

        fetch('/tienda/admin/roles/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(data)
        })
        .then(r=>r.json())
        .then(resp=>{
            if (resp.success) {
                roleForm.reset();
                loadRoles();
            } else {
                alert(resp.error || 'Error al crear rol');
            }
        });
    });
}

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('btn-role-toggle')) {
        const id = e.target.dataset.id;
        fetch(`/tienda/admin/roles/toggle/${id}`, {method:'POST', headers: { 'X-CSRFToken': getCsrfToken() }})
          .then(r=>r.json())
          .then(resp=>{
            if (resp.success) {
                // Lógica invertida visual tras el toggle
                if (resp.new_state === 'ON') {
                    e.target.textContent = 'OFF';
                    e.target.classList.remove('action-green');
                    e.target.classList.add('action-red');
                } else {
                    e.target.textContent = 'ON';
                    e.target.classList.remove('action-red');
                    e.target.classList.add('action-green');
                }
            }
          });
    }
    if (e.target.classList.contains('btn-role-delete') || e.target.closest('.btn-role-delete')) {
        if (!confirm('¿Eliminar este rol?')) return;
        const button = e.target.classList.contains('btn-role-delete') ? e.target : e.target.closest('.btn-role-delete');
        const id = button.dataset.id;
        fetch(`/tienda/admin/roles/delete/${id}`, {method:'POST', headers: { 'X-CSRFToken': getCsrfToken() }})
          .then(r=>r.json())
          .then(resp=>{
            if (resp.success) loadRoles();
          });
    }
});

window.addEventListener('DOMContentLoaded', function() {
    setAllProductsChecked(true);
    updateProductsHiddenInput();
    loadRoles();
    if (searchRoleInput) {
        searchRoleInput.addEventListener('input', filterRolesTable);
        
        // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
        searchRoleInput.addEventListener('search', function() {
            // Si el campo está vacío, filtrar todas las filas
            if (this.value === '') {
                filterRolesTable();
            }
        });
    }
    
    // Event listener para el campo "Mostrar"
    if (showRoleCount) {
        showRoleCount.addEventListener('change', function() {
            rolePerPage = this.value === 'all' ? 9999 : parseInt(this.value);
            roleCurrentPage = 1;
            renderRolePage();
        });
    }
    
    // Event listeners para botones de paginación
    const prevBtn = document.getElementById('prevRolePageBtn');
    const nextBtn = document.getElementById('nextRolePageBtn');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            if (roleCurrentPage > 1) {
                roleCurrentPage--;
                renderRolePage();
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            const roleRows = getRoleRows();
            const filteredRows = getFilteredRoleRows();
            const totalRows = filteredRows.length;
            const totalPages = showRoleCount.value === 'all' ? 1 : Math.ceil(totalRows / rolePerPage);
            
            if (roleCurrentPage < totalPages) {
                roleCurrentPage++;
                renderRolePage();
            }
        });
    }
    const msg = localStorage.getItem('rolesSuccessMsg');
    if (msg) {
        let msgDiv = document.createElement('div');
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
        msgDiv.innerText = msg;
        document.body.appendChild(msgDiv);
        setTimeout(() => { msgDiv.style.display = 'none'; }, 3500);
        localStorage.removeItem('rolesSuccessMsg');
    }
});


const showProductsModalBtn = document.getElementById('showProductsModal');
const productsModal = document.getElementById('productsModal');
const closeModalBtn = document.getElementById('closeModal');
const selectAllBtn = document.getElementById('selectAllProducts');
const deselectAllBtn = document.getElementById('deselectAllProducts');
const saveProductsBtn = document.getElementById('saveProducts');
const productsCheckboxList = document.getElementById('productsCheckboxList');
const productsHiddenInput = document.getElementById('productsHiddenInput');

// Asegurar que el modal esté oculto al cargar la página
document.addEventListener('DOMContentLoaded', function() {
    if (productsModal) {
        productsModal.classList.remove('show');
        productsModal.style.display = 'none';
    }
    
    // Inicialización específica para modal de edición de roles
    const editRoleModal = document.querySelector('.edit-role-modal');
    if (editRoleModal) {
        editRoleModal.classList.remove('show');
        editRoleModal.style.display = 'none';
    }
});

if (showProductsModalBtn && productsModal) {
    showProductsModalBtn.addEventListener('click', function() {
        document.getElementById('productsModal').classList.add('show');
        
        setAllProductsChecked(true);
        updateProductsHiddenInput();
    });
}
if (closeModalBtn && productsModal) {
    closeModalBtn.addEventListener('click', function() {
        document.getElementById('productsModal').classList.remove('show');
    });
}
if (selectAllBtn && productsCheckboxList) {
    selectAllBtn.addEventListener('click', function() {
        setAllProductsChecked(true);
        updateProductsHiddenInput();
    });
}
if (deselectAllBtn && productsCheckboxList) {
    deselectAllBtn.addEventListener('click', function() {
        setAllProductsChecked(false);
        updateProductsHiddenInput();
    });
}
if (saveProductsBtn && productsCheckboxList && productsHiddenInput && productsModal) {
    saveProductsBtn.addEventListener('click', function() {
        updateProductsHiddenInput();
        document.getElementById('productsModal').classList.remove('show');
    });
}
window.addEventListener('click', function(event) {
    if (productsModal && event.target == productsModal) {
        productsModal.classList.remove('show');
    }
});

// Edición de roles ===
const editRoleForm = document.getElementById('editRoleForm');
if (editRoleForm) {
    editRoleForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const formData = new FormData(editRoleForm);
        const data = {
            name: formData.get('name'),
            tipo_precio: formData.get('tipo_precio'),
            descuentos: {
                usd: formData.get('discount_usd') || undefined,
                cop: formData.get('discount_cop') || undefined
            },
            estado: document.getElementById('roleStatus').textContent === 'ON',
            productos: []
        };

        // Productos seleccionados (checkboxes)
        data.productos = window.__productosSeleccionadosEdit || [];
        
        window.__productosSeleccionadosEdit = undefined;

        // Descuentos extra por producto
        document.querySelectorAll('input[name^="discount_cop_extra_"], input[name^="discount_usd_extra_"]').forEach(input => {
            const match = input.name.match(/discount_(cop|usd)_extra_(\d+)/);
            if (match) {
                const tipo = match[1];
                const prodId = match[2];
                let prod = data.productos.find(p => p.id == prodId);
                if (prod) {
                    prod[`discount_${tipo}_extra`] = input.value || 0;
                }
                // Si no está marcado, NO lo agregues al array
            }
        });

        const roleId = formData.get('role_id');
        fetch(`/tienda/admin/roles/edit/${roleId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(data)
        })
        .then(r=>r.json())
        .then(resp=>{
            if (resp.success) {
                window.location.href = '/tienda/admin/roles';
            } else {
                alert(resp.error || 'Error al actualizar rol');
            }
        });
    });
    // Toggle ON/OFF
    const toggleBtn = document.getElementById('toggleRoleStatus');
    const statusSpan = document.getElementById('roleStatus');
    if (toggleBtn && statusSpan) {
        toggleBtn.addEventListener('click', function() {
            const isOn = statusSpan.textContent === 'ON';
            if (isOn) {
                statusSpan.textContent = 'OFF';
                statusSpan.className = 'badge bg-danger';
                toggleBtn.textContent = 'Activar';
            } else {
                statusSpan.textContent = 'ON';
                statusSpan.className = 'badge bg-success';
                toggleBtn.textContent = 'Desactivar';
            }
        });
    }
}

// Enlazar botón Editar de la tabla de roles para redirigir a la edición
if (document.getElementById('roles-table-body')) {
    document.getElementById('roles-table-body').addEventListener('click', function(e) {
        if (e.target.classList.contains('btn-role-edit')) {
            const id = e.target.dataset.id;
            window.location.href = `/tienda/admin/roles/edit/${id}`;
        }
    });
}

// Actualización en tiempo real de precios finales en editar rol ===
function updateRoleProductFinalPrices() {
    const discountUsd = parseFloat(document.getElementById('discountUsd')?.value) || 0;
    const discountCop = parseFloat(document.getElementById('discountCop')?.value) || 0;
    document.querySelectorAll('tr[data-product-id]').forEach(tr => {
        const priceCop = parseFloat(tr.getAttribute('data-price-cop')) || 0;
        const priceUsd = parseFloat(tr.getAttribute('data-price-usd')) || 0;
        const inputCop = tr.querySelector('input[name^="discount_cop_extra_"]');
        const inputUsd = tr.querySelector('input[name^="discount_usd_extra_"]');
        const extraCop = parseFloat(inputCop?.value) || 0;
        const extraUsd = parseFloat(inputUsd?.value) || 0;
        // Redondear a dos decimales y corregir errores de punto flotante
        let finalCop = Math.max(0, (priceCop - discountCop - extraCop));
        let finalUsd = Math.max(0, (priceUsd - discountUsd - extraUsd));
        // Redondear a dos decimales y eliminar .00 si es entero
        function formatNumber(n) {
            n = Math.round((n + Number.EPSILON) * 100) / 100;
            return n % 1 === 0 ? n.toString() : n.toFixed(2).replace(/\.00$/, '').replace(/(\.[1-9]*)0+$/, '$1');
        }
        const tdFinal = tr.querySelector('.td-final-price');
        if (tdFinal) {
            tdFinal.innerHTML = `$${formatNumber(finalCop)} COP<br>$${formatNumber(finalUsd)} USD`;
        }
    });
}

if (document.getElementById('editRoleForm')) {
    // Escuchar cambios en descuentos generales o individuales
    document.getElementById('discountUsd')?.addEventListener('input', updateRoleProductFinalPrices);
    document.getElementById('discountCop')?.addEventListener('input', updateRoleProductFinalPrices);
    document.querySelectorAll('input[name^="discount_cop_extra_"], input[name^="discount_usd_extra_"]').forEach(input => {
        input.addEventListener('input', updateRoleProductFinalPrices);
    });
    // Inicializar al cargar
    updateRoleProductFinalPrices();
}

// Seleccionar productos en el modal ===
function setAllProductsChecked(checked = true) {
    document.querySelectorAll('#productsCheckboxList .product-checkbox').forEach(cb => {
        cb.checked = checked;
    });
}

function updateProductsHiddenInput() {
    const checkedIds = Array.from(document.querySelectorAll('#productsCheckboxList .product-checkbox:checked')).map(cb => cb.value);
    const hiddenInput = document.getElementById('productsHiddenInput');
    if (hiddenInput) {
        hiddenInput.value = checkedIds.join(',');
    }
}

// Escuchar cambios en checkbox
if (productsCheckboxList) {
    productsCheckboxList.addEventListener('change', function() {
        updateProductsHiddenInput();
    });
}

// Manejo de inputs de descuento según tipo de precio ===
const discountUsdInput = document.getElementById('discountUsdCreate');
const discountCopInput = document.getElementById('discountCopCreate');
const tipoUsdRadio = document.getElementById('tipoUsdCreate');
const tipoCopRadio = document.getElementById('tipoCopCreate');

function updateDiscountInputs() {
  if (tipoUsdRadio && tipoUsdRadio.checked) {
    if (discountUsdInput) discountUsdInput.disabled = false;
    if (discountCopInput) {
      discountCopInput.disabled = true;
      discountCopInput.value = '';
    }
  } else if (tipoCopRadio && tipoCopRadio.checked) {
    if (discountCopInput) discountCopInput.disabled = false;
    if (discountUsdInput) {
      discountUsdInput.disabled = true;
      discountUsdInput.value = '';
    }
  }
}
if (tipoUsdRadio && tipoCopRadio) {
  tipoUsdRadio.addEventListener('change', updateDiscountInputs);
  tipoCopRadio.addEventListener('change', updateDiscountInputs);
  // Inicializar al cargar
  updateDiscountInputs();
}
// Antes de enviar el formulario
if (roleForm) {
  roleForm.addEventListener('submit', function(e) {
    updateDiscountInputs();
  });
}

// Inicialización final para asegurar que el modal esté oculto
window.addEventListener('load', function() {
    const modal = document.getElementById('productsModal');
    if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
    }
    
    // Inicialización específica para modal de edición de roles
    const editRoleModal = document.querySelector('.edit-role-modal');
    if (editRoleModal) {
        editRoleModal.classList.remove('show');
        editRoleModal.style.display = 'none';
    }
}); 
