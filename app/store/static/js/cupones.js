// Paginación y selección de productos para cupones

// Variables de paginación y elementos
const couponTableBody = document.getElementById('coupons-table-body');
const showCouponCount = document.getElementById('showCouponCount');
const prevCouponBtn = document.getElementById('prevCouponPageBtn');
const nextCouponBtn = document.getElementById('nextCouponPageBtn');
const searchCouponInput = document.getElementById('searchCouponInput');
let couponCurrentPage = 1;
let couponPerPage = showCouponCount ? (showCouponCount.value === 'all' ? 9999 : parseInt(showCouponCount.value)) : 10;

// Paginación para cupones ---
function getCouponRows() {
  return document.getElementById('coupons-table-body') ? Array.from(document.getElementById('coupons-table-body').querySelectorAll('tr[data-coupon-name]')) : [];
}

function getFilteredCouponRows() {
  const couponRows = getCouponRows();
  if (!couponRows.length) return [];
  // Solo visibles (no .filtered-out)
  return couponRows.filter(row => !row.classList.contains('filtered-out'));
}

function filterCouponRows() {
  const couponRows = getCouponRows();
  if (!couponRows.length) return;
  const searchTerm = searchCouponInput.value.toLowerCase();
  couponRows.forEach(row => {
    const couponName = row.getAttribute('data-coupon-name');
    if (!searchTerm || (couponName && couponName.includes(searchTerm))) {
      row.classList.remove('filtered-out');
    } else {
      row.classList.add('filtered-out');
    }
  });
  couponCurrentPage = 1;
  renderCouponPage();
}

function renderCouponPage() {
  const couponRows = getCouponRows();
  if (!couponRows.length) return;
  const filteredRows = getFilteredCouponRows();
  const totalRows = filteredRows.length;
  const totalPages = showCouponCount.value === 'all' ? 1 : Math.ceil(totalRows / couponPerPage);
  let start = showCouponCount.value === 'all' ? 0 : (couponCurrentPage - 1) * couponPerPage;
  let end = showCouponCount.value === 'all' ? totalRows : start + couponPerPage;
  filteredRows.forEach((row, i) => {
    if (showCouponCount.value === 'all' || (i >= start && i < end)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
  // Los que no están en filteredRows deben ocultarse
  couponRows.forEach(row => {
    if (!filteredRows.includes(row)) {
      row.style.display = 'none';
    }
  });
  if (prevCouponBtn) prevCouponBtn.disabled = couponCurrentPage <= 1;
  if (nextCouponBtn) nextCouponBtn.disabled = couponCurrentPage >= totalPages;
}

document.addEventListener('DOMContentLoaded', function() {
  // Las declaraciones duplicadas de variables globales aquí
  // están definidas arriba

  if (showCouponCount) {
    showCouponCount.addEventListener('change', function() {
      couponPerPage = this.value === 'all' ? 9999 : parseInt(this.value);
      couponCurrentPage = 1;
      renderCouponPage();
    });
  }
  if (prevCouponBtn) {
    prevCouponBtn.addEventListener('click', function() {
      if (couponCurrentPage > 1) {
        couponCurrentPage--;
        renderCouponPage();
      }
    });
  }
  if (nextCouponBtn) {
    nextCouponBtn.addEventListener('click', function() {
      const filteredRows = getFilteredCouponRows();
      const totalPages = showCouponCount.value === 'all' ? 1 : Math.ceil(filteredRows.length / couponPerPage);
      if (couponCurrentPage < totalPages) {
        couponCurrentPage++;
        renderCouponPage();
      }
    });
  }
  if (searchCouponInput) {
    searchCouponInput.addEventListener('input', filterCouponRows);
    
    // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
    searchCouponInput.addEventListener('search', function() {
      // Si el campo está vacío, filtrar todas las filas
      if (this.value === '') {
        filterCouponRows();
      }
    });
  }
  // Inicializa la paginación correctamente al cargar
  if (document.getElementById('coupons-table-body')) {
    filterCouponRows();
  }

  // Seleccionar/deseleccionar todos ---
  const selectAllBtn = document.getElementById('selectAllProducts');
  const deselectAllBtn = document.getElementById('deselectAllProducts');
  const saveProductsBtn = document.getElementById('saveProducts');
  const closeModalBtn = document.getElementById('closeModal');
  const productsModal = document.getElementById('productsModal');
  const productsCheckboxList = document.getElementById('productsCheckboxList');
  const productsHiddenInput = document.getElementById('productsHiddenInput');

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function() {
      productsCheckboxList.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', function() {
      productsCheckboxList.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
    });
  }
  if (saveProductsBtn && productsModal) {
    saveProductsBtn.addEventListener('click', function() {
      const selected = Array.from(productsCheckboxList.querySelectorAll('.product-checkbox:checked')).map(cb => cb.value);
      productsHiddenInput.value = selected.join(',');
      productsModal.classList.add('d-none');
    });
  }
  if (closeModalBtn && productsModal) {
    closeModalBtn.addEventListener('click', function() {
      productsModal.classList.add('d-none');
    });
  }
  window.addEventListener('click', function(event) {
    if (event.target == productsModal) {
      productsModal.classList.add('d-none');
    }
  });

  // Validar antes de enviar el formulario de crear cupón
  const couponForm = document.getElementById('newCouponForm');
  if (couponForm) {
    couponForm.addEventListener('submit', function(e) {
      const productsHidden = document.getElementById('productsHiddenInput').value;
      if (!productsHidden || productsHidden.trim() === '') {
        alert('Debes seleccionar al menos un producto para el cupón.');
        e.preventDefault();
        return false;
      }
      
      const formData = new FormData(couponForm);
      if (!formData.get('discount_cop') || !formData.get('discount_usd')) {
        alert('Debes completar los campos de descuento COP y USD.');
        e.preventDefault();
        return false;
      }
      if (!formData.get('duration_days')) {
        alert('Debes completar el campo de duración (días).');
        e.preventDefault();
        return false;
      }
      // Validar
      e.preventDefault();
      let products = [];
      if (productsHidden) {
        products = productsHidden.split(',').map(Number).filter(Boolean);
      }
      const data = {
        coupon_name: formData.get('coupon_name'),
        discount_cop: formData.get('discount_cop'),
        discount_usd: formData.get('discount_usd'),
        products: products,
        duration_days: formData.get('duration_days'),
        max_uses_per_user: formData.get('max_uses_per_user') || null,
        description: formData.get('description'),
        min_amount: formData.get('min_amount')
      };
      // Mostrar indicador de carga
      const submitBtn = couponForm.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creando...';
      }

      fetch('/tienda/admin/coupons/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(data)
      })
      .then(r=>r.json())
      .then(resp=>{
        if (resp.success) {
          couponForm.reset();
          
          const searchCouponInput = document.getElementById('searchCouponInput');
          if (searchCouponInput) searchCouponInput.value = '';
          
          // Limpiar el input de productos seleccionados
          const productsHiddenInput = document.getElementById('productsHiddenInput');
          if (productsHiddenInput) productsHiddenInput.value = '';
          
          // Recargar la tabla de cupones de forma asíncrona
          setTimeout(() => {
            loadCoupons();
          }, 100);
        } else {
          alert(resp.error || 'Error al crear cupón');
        }
      })
      .catch(error => {
        console.error('Error al crear cupón:', error);
        alert('Error al crear cupón. Inténtalo de nuevo.');
      })
      .finally(() => {
        // Restaurar el botón
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      });
    }, true);
  }

  // Sincronizar productos seleccionados con el input oculto
  function updateProductsHiddenInput() {
    const productsCheckboxList = document.getElementById('productsCheckboxList');
    const productsHiddenInput = document.getElementById('productsHiddenInput');
    if (!productsCheckboxList || !productsHiddenInput) return;
    const selected = Array.from(productsCheckboxList.querySelectorAll('.product-checkbox:checked')).map(cb => cb.value);
    productsHiddenInput.value = selected.join(',');
  }

  // Inicializar, poner todos los productos seleccionados en el input oculto
  updateProductsHiddenInput();

  // Sincronizar el input oculto con los checkboxes seleccionados
  const showProductsModalBtn = document.getElementById('showProductsModal');
  if (showProductsModalBtn && productsModal) {
    showProductsModalBtn.addEventListener('click', function() {
      productsModal.classList.remove('d-none');
    });
  }
  if (closeModalBtn && productsModal) {
    closeModalBtn.addEventListener('click', function() {
      productsModal.classList.add('d-none');
    });
  }
  window.addEventListener('click', function(event) {
    if (event.target == productsModal) {
      productsModal.classList.add('d-none');
    }
  });

  // Funcionalidad para los botones de productos asociados en editar cupon
  const selectAllEditBtn = document.getElementById('selectAllEditProducts');
  const deselectAllEditBtn = document.getElementById('deselectAllEditProducts');
  const editProductsCheckboxList = document.getElementById('editProductsCheckboxList');
  if (selectAllEditBtn && editProductsCheckboxList) {
    selectAllEditBtn.addEventListener('click', function() {
      editProductsCheckboxList.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (deselectAllEditBtn && editProductsCheckboxList) {
    deselectAllEditBtn.addEventListener('click', function() {
      editProductsCheckboxList.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
    });
  }
});

// Función renderCouponsTable para que el botón Editar sea un enlace
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
        tr.setAttribute('data-coupon-name', c.name.toLowerCase());
        // Invertir lógica: si está activo, mostrar OFF (rojo); si está inactivo, mostrar ON (verde)
        const toggleText = c.enabled ? 'OFF' : 'ON';
        const toggleClass = c.enabled ? 'action-red' : 'action-green';
        tr.innerHTML = `
          <td>${c.name}</td>
          <td>$${parseInt(c.discount_cop)} COP</td>
          <td>$${parseInt(c.discount_usd)} USD</td>
          <td>${c.duration_days} días</td>
          <td>${c.max_uses_per_user ? c.max_uses_per_user : ''}</td>
          <td>
            <div class="action-stack">
              <button class="action-btn btn-coupon-toggle ${toggleClass}" data-id="${c.id}">${toggleText}</button>
              <a href="/tienda/admin/cupones/${c.id}/editar" class="action-btn action-blue">Editar</a>
              <button class="action-btn action-red btn-coupon-delete" data-id="${c.id}" title="Eliminar">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
    }
    // Asignar eventos a los nuevos botones
    document.querySelectorAll('.btn-coupon-toggle').forEach(btn => {
      btn.onclick = function() {
        const id = this.dataset.id;
        fetch(`/tienda/admin/coupons/toggle/${id}`, {method:'POST', headers: { 'X-CSRFToken': getCsrfToken() }})
          .then(r=>r.json())
          .then(resp=>{
            if (resp.success) {
              // Invertir lógica visual tras el toggle
              if (resp.new_state === 'ON') {
                this.textContent = 'OFF';
                this.classList.remove('action-green');
                this.classList.add('action-red');
              } else {
                this.textContent = 'ON';
                this.classList.remove('action-red');
                this.classList.add('action-green');
              }
            }
          });
      };
    });
    document.querySelectorAll('.btn-coupon-delete').forEach(btn => {
      btn.onclick = function() {
        if (!confirm('¿Eliminar este cupón?')) return;
        const id = this.dataset.id;
        fetch(`/tienda/admin/coupons/delete/${id}`, {method:'POST', headers: { 'X-CSRFToken': getCsrfToken() }})
          .then(r=>r.json())
          .then(resp=>{
            if (resp.success) loadCoupons();
          });
      };
    });
}

function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
}

function loadCoupons() {
    // Usar requestIdleCallback si está disponible, sino setTimeout
    const loadData = () => {
        fetch('/tienda/admin/coupons/list', {
            headers: { 'X-CSRFToken': getCsrfToken() }
        })
          .then(r=>r.json())
          .then(data=>{
              renderCouponsTable(data.coupons);
              filterCouponRows();
          })
          .catch(error => {
              console.error('Error al cargar cupones:', error);
          });
    };

    if (window.requestIdleCallback) {
        requestIdleCallback(loadData, { timeout: 1000 });
    } else {
        setTimeout(loadData, 0);
    }
}

window.addEventListener('DOMContentLoaded', loadCoupons);

const editCouponForm = document.getElementById('editCouponForm');
if (editCouponForm) {
  editCouponForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(editCouponForm);
    const products = Array.from(document.querySelectorAll('#editProductsCheckboxList input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
    
    // Calcular fecha de expiración en zona horaria de Colombia
    const durationDays = parseInt(formData.get('duration_days'));
    const now = new Date();
    // Crear fecha en zona horaria de Colombia
    const colombiaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Bogota"}));
    const expirationDate = new Date(colombiaTime.getTime() + (durationDays * 24 * 60 * 60 * 1000));
    const formattedExpirationDate = expirationDate.toLocaleString('es-CO', { 
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const data = {
      coupon_id: formData.get('coupon_id'),
      coupon_name: formData.get('coupon_name'),
      discount_cop: formData.get('discount_cop'),
      discount_usd: formData.get('discount_usd'),
      products: products,
      duration_days: durationDays,
      max_uses_per_user: formData.get('max_uses_per_user'),
      description: formData.get('description'),
      min_amount: formData.get('min_amount') || null,
      expiration_date: formattedExpirationDate,
      show_public: document.getElementById('show_public').checked
    };

    fetch('/tienda/admin/coupons/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
      body: JSON.stringify(data)
    })
    .then(r=>r.json())
    .then(resp=>{
      if (resp.success) {
        window.location.href = '/tienda/admin/cupones';
      } else {
        alert(resp.error || 'Error al actualizar cupón');
      }
    });
  });
}

// Función para calcular y mostrar el tiempo restante en editar_cupon
function updateExpirationTimeEdit() {
  const expirationSpan = document.getElementById('expiration_date');
  let createdAt = expirationSpan ? expirationSpan.dataset.created : null;
  if (!createdAt) {
    // Si no hay data-created, intenta obtener el texto del span created_at
    const createdAtSpan = document.getElementById('created_at');
    if (createdAtSpan) {
      
      const text = createdAtSpan.innerText.trim();
      if (text && text !== 'No disponible') {
        // Convertir a formato compatible con Date
        createdAt = text.replace(' ', 'T');
      }
    }
  }
  const durationDays = parseInt(document.getElementById('duration_days').value) || 0;
  if (createdAt && durationDays > 0) {
    const createdDate = new Date(createdAt);
    const expirationDate = new Date(createdDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    // Usar zona horaria de Colombia para el cálculo
    const now = new Date();
    const colombiaNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Bogota"}));
    const timeDiff = expirationDate - colombiaNow;
    if (timeDiff > 0) {
      const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      expirationSpan.innerText = `${days} días, ${hours} horas, ${minutes} minutos`;
    } else {
      expirationSpan.innerText = 'Cupón vencido';
    }
  } else {
    expirationSpan.innerText = 'No se ha especificado duración';
  }
}

// Escuchar cuando cambie la duración en editar_cupon
const durationDaysInputEdit = document.getElementById('duration_days');
if (durationDaysInputEdit && document.getElementById('expiration_date')) {
  durationDaysInputEdit.addEventListener('change', updateExpirationTimeEdit);
  durationDaysInputEdit.addEventListener('input', updateExpirationTimeEdit);
  // Inmediatamente al cargar la página
  updateExpirationTimeEdit();
  // Actualizar cada minuto
  setInterval(updateExpirationTimeEdit, 60000);
} 
