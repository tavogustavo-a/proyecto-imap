document.addEventListener('DOMContentLoaded', function() {
  const tableBody = document.getElementById('tools-table-body');
  const rows = Array.from(tableBody.querySelectorAll('tr[data-title]'));
  const showCountSelect = document.getElementById('showToolCount');
  const prevBtn = document.getElementById('prevToolPageBtn');
  const nextBtn = document.getElementById('nextToolPageBtn');
  const searchInput = document.getElementById('searchToolInput');
  let currentPage = 1;
  let perPage = parseInt(showCountSelect.value) || 5;

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
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  }

  function filterRows() {
    const searchTerm = searchInput.value.toLowerCase();
    rows.forEach(row => {
      const title = row.getAttribute('data-title');
      if (!searchTerm || title.includes(searchTerm)) {
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
    // Si el campo está vacío, limpiar filtros
    if (this.value === '') {
      filterRows();
    }
  });

  // Inicializa la paginación correctamente al cargar
  filterRows();

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // Toggle ON/OFF
  document.querySelectorAll('.btn-toggle-tool').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const id = this.getAttribute('data-id');
      fetch(`/tienda/admin/herramientas/toggle/${id}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() }
      })
      .then(r => r.ok ? location.reload() : alert('Error al cambiar estado.'));
    });
  });

  // Eliminar
  document.querySelectorAll('.btn-delete-tool').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const id = this.getAttribute('data-id');
      if (!confirm('¿Seguro que deseas eliminar esta información?')) return;
      fetch(`/tienda/admin/herramientas/delete/${id}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() }
      })
      .then(r => r.ok ? location.reload() : alert('Error al eliminar.'));
    });
  });

  // Funcionalidad para HTMLs
  const htmlTableBody = document.getElementById('html-table-body');
  const searchHtmlInput = document.getElementById('searchHtmlInput');
  const showHtmlCount = document.getElementById('showHtmlCount');
  const prevHtmlPageBtn = document.getElementById('prevHtmlPageBtn');
  const nextHtmlPageBtn = document.getElementById('nextHtmlPageBtn');
  
  let currentHtmlPage = 1;
  const htmlsPerPage = 5;
  
  function filterAndPaginateHtmls() {
    const searchValue = searchHtmlInput.value.toLowerCase();
    const showCount = showHtmlCount.value === 'all' ? 999999 : parseInt(showHtmlCount.value);
    const rows = htmlTableBody.querySelectorAll('tr[data-title]');
    
    let visibleRows = Array.from(rows).filter(row => {
      const title = row.getAttribute('data-title').toLowerCase();
      return title.includes(searchValue);
    });
    
    const totalPages = Math.ceil(visibleRows.length / showCount);
    currentHtmlPage = Math.min(currentHtmlPage, totalPages);
    
    const start = (currentHtmlPage - 1) * showCount;
    const end = start + showCount;
    
    rows.forEach(row => row.style.display = 'none');
    visibleRows.slice(start, end).forEach(row => row.style.display = '');
    
    prevHtmlPageBtn.disabled = currentHtmlPage === 1;
    nextHtmlPageBtn.disabled = currentHtmlPage >= totalPages;
  }
  
  if(searchHtmlInput) {
    searchHtmlInput.addEventListener('input', () => {
      currentHtmlPage = 1;
      filterAndPaginateHtmls();
    });
    
    // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
    searchHtmlInput.addEventListener('search', function() {
      // Si el campo está vacío, limpiar filtros
      if (this.value === '') {
        currentHtmlPage = 1;
        filterAndPaginateHtmls();
      }
    });
  }
  
  if(showHtmlCount) {
    showHtmlCount.addEventListener('change', () => {
      currentHtmlPage = 1;
      filterAndPaginateHtmls();
    });
  }
  
  if(prevHtmlPageBtn) {
    prevHtmlPageBtn.addEventListener('click', () => {
      if(currentHtmlPage > 1) {
        currentHtmlPage--;
        filterAndPaginateHtmls();
      }
    });
  }
  
  if(nextHtmlPageBtn) {
    nextHtmlPageBtn.addEventListener('click', () => {
      currentHtmlPage++;
      filterAndPaginateHtmls();
    });
  }
  
  // Botones de toggle HTML
  document.querySelectorAll('.btn-toggle-html').forEach(btn => {
    btn.addEventListener('click', function() {
      const htmlId = this.dataset.id;
      const csrfToken = document.querySelector('meta[name="csrf_token"]').content;
      
      fetch(`/tienda/admin/html/${htmlId}/toggle`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': csrfToken,
          'Content-Type': 'application/json'
        }
      })
      .then(response => response.json())
      .then(data => {
        if(data.success) {
          this.textContent = data.new_state;
          this.className = `action-btn ${data.new_class}`;
        } else {
          alert(data.error || 'Error al actualizar el estado.');
        }
      })
      .catch(error => {
        alert('Error al actualizar el estado.');
      });
    });
  });
  
  // Botones de eliminar HTML
  document.querySelectorAll('.btn-delete-html').forEach(btn => {
    btn.addEventListener('click', function() {
      if(!confirm('¿Estás seguro de que deseas eliminar este HTML?')) return;
      
      const htmlId = this.dataset.id;
      const csrfToken = document.querySelector('meta[name="csrf_token"]').content;
      // Verificación segura para closest
      const row = this && typeof this.closest === 'function' ? this.closest('tr') : null;
      
      fetch(`/tienda/admin/html/${htmlId}/delete`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': csrfToken,
          'Content-Type': 'application/json'
        }
      })
      .then(response => response.json())
      .then(data => {
        if(data.success) {
          row.remove();
          if(htmlTableBody.querySelectorAll('tr').length === 0) {
            htmlTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No hay HTML añadido aún.</td></tr>';
          }
        } else {
          alert(data.error || 'Error al eliminar el HTML.');
        }
      })
      .catch(error => {
        alert('Error al eliminar el HTML.');
      });
    });
  });
  
  // Inicializar paginación
  if(htmlTableBody) {
    filterAndPaginateHtmls();
  }
}); 
