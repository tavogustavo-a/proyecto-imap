document.addEventListener('DOMContentLoaded', function() {
  const tableBody = document.getElementById('tools-table-body');
  function toolRows() {
    return Array.from(tableBody.querySelectorAll('tr[data-title]'));
  }
  const showCountSelect = document.getElementById('showToolCount');
  const prevBtn = document.getElementById('prevToolPageBtn');
  const nextBtn = document.getElementById('nextToolPageBtn');
  const searchInput = document.getElementById('searchToolInput');
  let currentPage = 1;
  let perPage = parseInt(showCountSelect.value) || 20;

  function getFilteredRows() {
    return toolRows().filter(row => !row.classList.contains('filtered-out'));
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
    
    toolRows().forEach(row => {
      if (row.classList.contains('filtered-out')) {
        row.style.display = 'none';
      }
    });
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  }

  function filterRows() {
    const searchTerm = searchInput.value.toLowerCase();
    toolRows().forEach(row => {
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
    perPage = this.value === 'all' ? toolRows().length : parseInt(this.value);
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

  tableBody.addEventListener('click', function(e) {
    const toggleBtn = e.target.closest('.btn-toggle-tool');
    const deleteBtn = e.target.closest('.btn-delete-tool');
    if (toggleBtn) {
      e.preventDefault();
      const id = toggleBtn.getAttribute('data-id');
      fetch(`/tienda/admin/herramientas/toggle/${id}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() }
      })
      .then(r => r.ok ? location.reload() : alert('Error al cambiar estado.'));
    }
    if (deleteBtn) {
      e.preventDefault();
      const id = deleteBtn.getAttribute('data-id');
      if (!confirm('¿Seguro que deseas eliminar esta información?')) return;
      fetch(`/tienda/admin/herramientas/delete/${id}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() }
      })
      .then(r => r.ok ? location.reload() : alert('Error al eliminar.'));
    }
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
  
  if (htmlTableBody) htmlTableBody.addEventListener('click', function(e) {
    const toggleBtn = e.target.closest('.btn-toggle-html');
    const deleteBtn = e.target.closest('.btn-delete-html');
    if (toggleBtn) {
      const htmlId = toggleBtn.dataset.id;
      fetch(`/tienda/admin/html/${htmlId}/toggle`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCsrfToken(),
          'Content-Type': 'application/json'
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          paintStateSwitch(toggleBtn, data.new_state === 'OFF');
        } else {
          alert(data.error || 'Error al actualizar el estado.');
        }
      })
      .catch(function() {
        alert('Error al actualizar el estado.');
      });
    }
    if (deleteBtn) {
      if (!confirm('¿Estás seguro de que deseas eliminar este HTML?')) return;
      const htmlId = deleteBtn.dataset.id;
      const row = deleteBtn.closest('tr');
      fetch(`/tienda/admin/html/${htmlId}/delete`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCsrfToken(),
          'Content-Type': 'application/json'
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          if (row) row.remove();
          if (htmlTableBody.querySelectorAll('tr[data-title]').length === 0) {
            htmlTableBody.innerHTML = '<tr><td colspan="3" class="text-center">No hay HTML añadido aún.</td></tr>';
          }
        } else {
          alert(data.error || 'Error al eliminar el HTML.');
        }
      })
      .catch(function() {
        alert('Error al eliminar el HTML.');
      });
    }
  });

  function setCreateStatus(form, message, ok) {
    let status = form.querySelector('[data-create-status]');
    if (!status) {
      status = document.createElement('p');
      status.setAttribute('data-create-status', '');
      status.className = 'mb-05';
      const button = form.querySelector('[type="submit"]');
      if (button && button.parentNode) {
        button.parentNode.insertBefore(status, button);
      } else {
        form.appendChild(status);
      }
    }
    status.textContent = message || '';
    status.style.color = ok ? '#1b7f3a' : '#c62828';
  }

  function driveSubtitlesReady(form) {
    const tipo = form.querySelector('#api_type');
    if (!tipo || tipo.value !== 'Drive') return true;
    const photos = form.querySelector('#drive_subtitle_photos');
    const videos = form.querySelector('#drive_subtitle_videos');
    const photosValue = photos ? photos.value.trim() : '';
    const videosValue = videos ? videos.value.trim() : '';
    return !!(photosValue || videosValue);
  }

  function placeCreatedRow(kind, rowHtml) {
    const holder = document.createElement('tbody');
    holder.innerHTML = (rowHtml || '').trim();
    const row = holder.firstElementChild;
    if (!row) return;
    if (kind === 'tool') {
      const empty = tableBody.querySelector('tr:not([data-title])');
      if (empty) empty.remove();
      tableBody.prepend(row);
      currentPage = 1;
      filterRows();
      return;
    }
    if (kind === 'html') {
      const empty = htmlTableBody.querySelector('tr:not([data-title])');
      if (empty) empty.remove();
      htmlTableBody.prepend(row);
      currentHtmlPage = 1;
      filterAndPaginateHtmls();
      return;
    }
    if (kind === 'youtube' && typeof window.herramientasAddYoutubeRow === 'function') {
      window.herramientasAddYoutubeRow(row);
      return;
    }
    if (kind === 'api' && typeof window.herramientasAddApiRow === 'function') {
      window.herramientasAddApiRow(row);
    }
  }

  document.querySelectorAll('form[data-create-kind]').forEach(function(form) {
    form.addEventListener('submit', function(ev) {
      ev.preventDefault();
      if (form.getAttribute('data-create-kind') === 'api' && !driveSubtitlesReady(form)) {
        return;
      }
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      setCreateStatus(form, '', true);
      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: {
          'X-CSRFToken': getCsrfToken(),
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        }
      })
      .then(function(response) {
        return response.json().then(function(data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function(result) {
        const data = result.data || {};
        if (!result.ok || !data.ok) {
          setCreateStatus(form, data.message || 'No se pudo crear.', false);
          return;
        }
        placeCreatedRow(form.getAttribute('data-create-kind'), data.row_html);
        form.reset();
        const preset = form.querySelector('[data-html-preset-select]');
        if (preset) preset.dispatchEvent(new Event('change'));
        const apiType = form.querySelector('#api_type');
        if (apiType) apiType.dispatchEvent(new Event('change'));
        setCreateStatus(form, data.message || 'Creado.', true);
      })
      .catch(function() {
        setCreateStatus(form, 'No se pudo crear.', false);
      })
      .finally(function() {
        if (button) button.disabled = false;
      });
    });
  });
  
  // Inicializar paginación
  if(htmlTableBody) {
    filterAndPaginateHtmls();
  }
}); 
