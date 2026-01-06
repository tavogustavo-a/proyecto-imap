// Paginación y búsqueda mejoradas para productos

document.addEventListener('DOMContentLoaded', function() {
  const tableBody = document.getElementById('products-table-body');
  const rows = Array.from(tableBody.querySelectorAll('tr[data-product-name]'));
  const showCountSelect = document.getElementById('showCount');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  const searchInput = document.getElementById('searchProductInput');
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
    let idx = 0;
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
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  }

  function filterRows() {
    const searchTerm = searchInput.value.toLowerCase();
    rows.forEach(row => {
      const productName = row.getAttribute('data-product-name');
      if (!searchTerm || productName.includes(searchTerm)) {
        row.classList.remove('filtered-out');
      } else {
        row.classList.add('filtered-out');
      }
    });
    currentPage = 1;
    renderPage();
  }

  showCountSelect.addEventListener('change', function() {
    perPage = this.value === 'all' ? rows.length : parseInt(this.value);
    currentPage = 1;
    renderPage();
  });

  prevBtn.addEventListener('click', function() {
    if (currentPage > 1) {
      currentPage--;
      renderPage();
    }
  });

  nextBtn.addEventListener('click', function() {
    const filteredRows = getFilteredRows();
    const totalPages = showCountSelect.value === 'all' ? 1 : Math.ceil(filteredRows.length / perPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderPage();
    }
  });

  searchInput.addEventListener('input', filterRows);
  
  // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
  searchInput.addEventListener('search', function() {
    // Si el campo está vacío, filtrar todas las filas
    if (this.value === '') {
      filterRows();
    }
  });

  // Inicializa la paginación correctamente al cargar
  filterRows();
});

function createProduct() {
  const form = document.getElementById('newProductForm');
  const formData = new FormData(form);

  fetch('/admin/productos', {
    method: 'POST',
    body: formData
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      alert('Producto creado exitosamente');
      form.reset();
      loadProducts(); // Recargar la lista
    } else {
      alert('Error al crear el producto: ' + data.error);
    }
  })
  .catch(error => {
    alert('Error al crear el producto');
  });
} 
