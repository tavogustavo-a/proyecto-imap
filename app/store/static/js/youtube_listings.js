document.addEventListener('DOMContentLoaded', function() {
    const tableBody = document.getElementById('youtube-table-body');
    const searchInput = document.getElementById('searchYouTubeInput');
    const showCountSelect = document.getElementById('showYouTubeCount');
    const prevPageBtn = document.getElementById('prevYouTubePageBtn');
    const nextPageBtn = document.getElementById('nextYouTubePageBtn');
    
    let allRows = Array.from(tableBody.querySelectorAll('tr'));
    let currentPage = 1;
    let rowsPerPage = showCountSelect.value === 'all' ? 'all' : parseInt(showCountSelect.value, 10);

    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf_token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    function displayRows() {
        const query = searchInput.value.toLowerCase();
        const filteredRows = allRows.filter(row => {
            const title = row.dataset.title || '';
            return title.includes(query);
        });

        // Si se selecciona "Todos", mostrar todas las filas sin paginación
        if (rowsPerPage === 'all' || showCountSelect.value === 'all') {
            tableBody.innerHTML = '';
            filteredRows.forEach(row => tableBody.appendChild(row));
            
            // Ocultar botones de paginación cuando se muestra "Todos"
            prevPageBtn.style.display = 'none';
            nextPageBtn.style.display = 'none';
            return;
        }

        // Mostrar botones de paginación para paginación normal
        prevPageBtn.style.display = 'inline-block';
        nextPageBtn.style.display = 'inline-block';

        const totalPages = Math.ceil(filteredRows.length / rowsPerPage);
        currentPage = Math.min(currentPage, totalPages || 1);

        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;

        tableBody.innerHTML = ''; 
        filteredRows.slice(start, end).forEach(row => tableBody.appendChild(row));

        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    }

    function setupEventListeners() {
        searchInput.addEventListener('input', () => {
            currentPage = 1;
            displayRows();
        });
        
        // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
        searchInput.addEventListener('search', function() {
            // Si el campo está vacío, limpiar filtros
            if (this.value === '') {
                currentPage = 1;
                displayRows();
            }
        });

        showCountSelect.addEventListener('change', () => {
            const value = showCountSelect.value;
            if (value === 'all') {
                rowsPerPage = 'all';
            } else {
                rowsPerPage = parseInt(value, 10);
            }
            currentPage = 1;
            displayRows();
        });

        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                displayRows();
            }
        });

        nextPageBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(allRows.filter(row => (row.dataset.title || '').includes(searchInput.value.toLowerCase())).length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                displayRows();
            }
        });

        // Eventos para botones ON/OFF y Eliminar
        tableBody.addEventListener('click', function(e) {
            const target = e.target;
            
            // Buscar el botón que contiene el clic (puede ser el botón o el icono dentro)
            const toggleBtn = target.closest('.btn-toggle-youtube');
            const deleteBtn = target.closest('.btn-delete-youtube');
            
            if (toggleBtn) {
                const listingId = toggleBtn.dataset.id;
                fetch(`/tienda/admin/youtube_listing/${listingId}/toggle`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    }
                }).then(res => res.json()).then(data => {
                    if(data.success) {
                        toggleBtn.textContent = data.new_state;
                        toggleBtn.classList.remove('action-red', 'action-green');
                        toggleBtn.classList.add(data.new_class);
                    }
                });
            }

            if (deleteBtn) {
                const listingId = deleteBtn.dataset.id;
                if (confirm('¿Estás seguro de que quieres eliminar este listado?')) {
                    fetch(`/tienda/admin/youtube_listing/${listingId}/delete`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        }
                    }).then(res => res.json()).then(data => {
                        if(data.success) {
                            deleteBtn.closest('tr').remove();
                            // Reinicializar las filas y mostrar
                            allRows = Array.from(document.querySelectorAll('#youtube-table-body tr'));
                            displayRows();
                        }
                    });
                }
            }
        });
    }
    
    // Inicialización
    if(allRows.length > 0 && allRows[0].children.length > 1) { // Mensaje "No hay listados"
      setupEventListeners();
      displayRows();
    } else {
      prevPageBtn.style.display = 'none';
      nextPageBtn.style.display = 'none';
    }
}); 
