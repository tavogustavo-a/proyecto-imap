// Paginación y cantidad a mostrar para la tabla de usuarios en pagos

document.addEventListener('DOMContentLoaded', function() {
  const tableBody = document.getElementById('users-table-body');
  if (!tableBody) return;
  const rows = Array.from(tableBody.querySelectorAll('tr[data-username]'));
  const showCountSelect = document.getElementById('showUserCount');
  const prevBtn = document.getElementById('prevUserPageBtn');
  const nextBtn = document.getElementById('nextUserPageBtn');
  const searchInput = document.getElementById('searchUserInput');
  let currentPage = 1;
  let perPage = parseInt(showCountSelect.value) || 20;

  function getFilteredRows() {
    return rows.filter(row => !row.classList.contains('filtered-out'));
  }

  function renderPage() {
    const filteredRows = getFilteredRows();
    const totalRows = filteredRows.length;
    const totalPages = showCountSelect.value === 'all' ? 1 : Math.ceil(totalRows / perPage);
    let start = showCountSelect.value === 'all' ? 0 : (currentPage - 1) * perPage;
    let end = showCountSelect.value === 'all' ? totalRows : start + perPage;
    filteredRows.forEach((row, i) => {
      if (showCountSelect.value === 'all' || (i >= start && i < end)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
    
    rows.forEach(row => {
      if (row.classList.contains('filtered-out')) {
        row.style.display = 'none';
      }
    });
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  }

  function filterRows() {
    const searchTerm = searchInput.value.toLowerCase();
    rows.forEach(row => {
      const username = row.getAttribute('data-username');
      if (!searchTerm || username.includes(searchTerm)) {
        row.classList.remove('filtered-out');
      } else {
        row.classList.add('filtered-out');
      }
    });
    currentPage = 1;
    renderPage();
  }

  if (showCountSelect) {
    showCountSelect.addEventListener('change', function() {
      perPage = this.value === 'all' ? rows.length : parseInt(this.value);
      currentPage = 1;
      renderPage();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', function() {
      if (currentPage > 1) {
        currentPage--;
        renderPage();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function() {
      const filteredRows = getFilteredRows();
      const totalPages = showCountSelect.value === 'all' ? 1 : Math.ceil(filteredRows.length / perPage);
      if (currentPage < totalPages) {
        currentPage++;
        renderPage();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', filterRows);
    searchInput.addEventListener('search', function() {
      // Se activa cuando se usa la 'x' nativa para limpiar
      filterRows();
    });
  }

  // Inicializa la paginación correctamente al cargar
  filterRows();

  
  const searchUserBalance = document.getElementById('searchUserBalance');
  const usersTableBody = document.getElementById('users-table-body');
  let userList = [];
  // Lista del autocompletado
  let adminUser = document.body.getAttribute('data-admin-user') || 'admin';
  if (usersTableBody) {
    userList = Array.from(usersTableBody.querySelectorAll('tr[data-username]')).map(row => {
      return {
        username: row.querySelector('td strong').textContent.trim(),
        full_name: row.children[1].textContent.trim(),
        tipo_precio: row.getAttribute('data-tipo-precio') ? row.getAttribute('data-tipo-precio').toLowerCase() : 'usd'
      };
    }).filter(u => u.username !== adminUser);
  }

  // Caja de sugerencias
  let suggestionBox = document.createElement('div');
  suggestionBox.className = 'autocomplete-suggestions bg-white p-05 br-8';
  suggestionBox.style.position = 'absolute';
  suggestionBox.style.zIndex = '1001';
  suggestionBox.style.maxHeight = '180px';
  suggestionBox.style.overflowY = 'auto';
  suggestionBox.style.display = 'none';
  suggestionBox.style.left = '0';
  suggestionBox.style.right = '0';
  suggestionBox.style.width = '100%';
  suggestionBox.style.minWidth = '0';
  suggestionBox.style.boxSizing = 'border-box';
  searchUserBalance.parentNode.style.position = 'relative';
  searchUserBalance.parentNode.appendChild(suggestionBox);
  searchUserBalance.setAttribute('autocomplete', 'off');

  searchUserBalance.addEventListener('input', function() {
    const value = this.value.toLowerCase();
    suggestionBox.innerHTML = '';
    if (!value) {
      suggestionBox.style.display = 'none';
      return;
    }
    const matches = userList.filter(u =>
      u.username.toLowerCase().includes(value) ||
      (u.full_name && u.full_name.toLowerCase().includes(value))
    );
    if (matches.length === 0) {
      suggestionBox.style.display = 'none';
      return;
    }
    matches.forEach(u => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item p-05';
      item.textContent = `${u.username} (${u.full_name})`;
      item.style.cursor = 'pointer';
      item.addEventListener('mousedown', function(e) {
        e.preventDefault();
        searchUserBalance.value = u.username;
        suggestionBox.style.display = 'none';
      });
      suggestionBox.appendChild(item);
    });
    suggestionBox.style.display = 'block';
  });
  document.addEventListener('click', function(e) {
    if (!suggestionBox.contains(e.target) && e.target !== searchUserBalance) {
      suggestionBox.style.display = 'none';
    }
  });

  
  const addBalanceForm = document.getElementById('add-balance-form');
  if (addBalanceForm) {
    addBalanceForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const userValue = searchUserBalance.value.trim().toLowerCase();
      const user = userList.find(u => u.username.toLowerCase() === userValue);
      if (user) {
        if (user.tipo_precio === 'usd') {
          document.getElementById('balanceAmountCop').value = '';
        } else if (user.tipo_precio === 'cop') {
          document.getElementById('balanceAmountUsd').value = '';
        }
      }
      const amountUsd = document.getElementById('balanceAmountUsd').value.trim();
      const amountCop = document.getElementById('balanceAmountCop').value.trim();
      if (!user || (!amountUsd && !amountCop)) {
        alert('Debes seleccionar un usuario y al menos un monto.');
        return;
      }
      fetch('/tienda/admin/pagos/add_balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': (document.querySelector('meta[name="csrf_token"]') || {}).content || ''
        },
        body: JSON.stringify({ username: user.username, amount_usd: amountUsd, amount_cop: amountCop })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const userRow = Array.from(usersTableBody.querySelectorAll('tr[data-username]')).find(row => {
            return row.querySelector('td strong').textContent.trim() === user.username;
          });
          if (userRow) {
            const saldoCell = userRow.children[2];
            if (user.tipo_precio === 'usd') {
              saldoCell.textContent = `${parseInt(data.new_saldo_usd)} USD`;
            } else if (user.tipo_precio === 'cop') {
              saldoCell.textContent = `${parseInt(data.new_saldo_cop)} COP`;
            } else {
              saldoCell.textContent = '-';
            }
          }
          alert('Saldo añadido correctamente');
          addBalanceForm.reset();
        } else {
          alert(data.error || 'Error al añadir saldo');
        }
      })
      .catch(() => alert('Error de red o servidor.'));
    });
  }

  const modal = document.querySelector('.modal-balance-content');
  const overlay = document.getElementById('balance-modal-overlay');
  const openBtns = document.querySelectorAll('.open-balance-modal');
  const closeBtns = document.querySelectorAll('.close-balance-modal');
  const usernameInput = document.getElementById('modal-username');
  const usdInput = document.getElementById('modal-balance-usd');
  const copInput = document.getElementById('modal-balance-cop');
  const groupUsd = document.getElementById('modal-group-usd');
  const groupCop = document.getElementById('modal-group-cop');

  openBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      modal.classList.remove('d-none');
      overlay.classList.remove('d-none');
      usernameInput.value = btn.getAttribute('data-username');
      usdInput.value = '';
      copInput.value = '';
      // Siguiente
      let tipoPrecio = btn.getAttribute('data-tipo-precio');
      if (!tipoPrecio) {
        // Buscar en userList si no está en el atributo
        const user = userList.find(u => u.username === btn.getAttribute('data-username'));
        tipoPrecio = user ? user.tipo_precio : '';
      }
      if (tipoPrecio === 'usd') {
        groupUsd.style.display = '';
        groupCop.style.display = 'none';
      } else if (tipoPrecio === 'cop') {
        groupUsd.style.display = 'none';
        groupCop.style.display = '';
      } else {
        groupUsd.style.display = '';
        groupCop.style.display = '';
      }
    });
  });

  function closeModal() {
    modal.classList.add('d-none');
    overlay.classList.add('d-none');
  }
  closeBtns.forEach(btn => btn.addEventListener('click', closeModal));
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      closeModal();
    }
  });

  // Siguiente en el formulario general ---
  const formGroupUsd = document.getElementById('form-group-usd');
  const formGroupCop = document.getElementById('form-group-cop');
  function updateFormSaldoFields() {
    const userValue = searchUserBalance.value.trim().toLowerCase();
    const user = userList.find(u => u.username.toLowerCase() === userValue);
    if (user && user.tipo_precio === 'usd') {
      formGroupUsd.style.display = '';
      formGroupCop.style.display = 'none';
    } else if (user && user.tipo_precio === 'cop') {
      formGroupUsd.style.display = 'none';
      formGroupCop.style.display = '';
    } else {
      formGroupUsd.style.display = '';
      formGroupCop.style.display = '';
    }
  }
  searchUserBalance.addEventListener('input', updateFormSaldoFields);
  // Actualizar al seleccionar del autocompletado
  suggestionBox.addEventListener('mousedown', function(e) {
    setTimeout(updateFormSaldoFields, 10);
  });

  // Frontend para solo enviar el campo correcto en el modal ---
  const modalBalanceForm = document.getElementById('modal-balance-form');
  modalBalanceForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const user = userList.find(u => u.username === username);
    let amountUsd = usdInput.value.trim();
    let amountCop = copInput.value.trim();
    if (user) {
      if (user.tipo_precio === 'usd') {
        amountCop = '';
      } else if (user.tipo_precio === 'cop') {
        amountUsd = '';
      }
    }
    if (!user || (!amountUsd && !amountCop)) {
      alert('Debes seleccionar un usuario y al menos un monto.');
      return;
    }
    fetch('/tienda/admin/pagos/add_balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (document.querySelector('meta[name="csrf_token"]') || {}).content || ''
      },
      body: JSON.stringify({ username: user.username, amount_usd: amountUsd, amount_cop: amountCop })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        const userRow = Array.from(usersTableBody.querySelectorAll('tr[data-username]')).find(row => {
          return row.querySelector('td strong').textContent.trim() === user.username;
        });
        if (userRow) {
          const saldoCell = userRow.children[2];
          if (user.tipo_precio === 'usd') {
            saldoCell.textContent = `${parseInt(data.new_saldo_usd)} USD`;
          } else if (user.tipo_precio === 'cop') {
            saldoCell.textContent = `${parseInt(data.new_saldo_cop)} COP`;
          } else {
            saldoCell.textContent = '-';
          }
        }
        alert('Saldo añadido correctamente');
        modalBalanceForm.reset();
        closeModal();
      } else {
        alert(data.error || 'Error al añadir saldo');
      }
    })
    .catch(() => alert('Error de red o servidor.'));
  });
}); 
