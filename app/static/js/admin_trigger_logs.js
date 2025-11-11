document.addEventListener('DOMContentLoaded', function () {
    const csrfToken = document.querySelector('meta[name="csrf_token"]')?.getAttribute('content');
    const logListContainer = document.getElementById('log-list');
    const searchInput = document.getElementById('logSearchInput');
    const paginationContainer = document.getElementById('pagination-controls');

    let currentQuery = searchInput ? searchInput.value : "";
    let currentPage = 1;

    function renderLogs(logs) {
        if (!logListContainer) return;
        if (!logs || logs.length === 0) {
            logListContainer.innerHTML = '<p>No hay entradas en el log que coincidan.</p>';
            return;
        }

        let html = '';
        logs.forEach(log => {
            const searchedEmailText = log.searched_email || '(No guardado)';
            
            html += `
            <div class="regex-item mb-1">
                <div>
                    <strong>Fecha y Hora:</strong> ${log.timestamp}
                </div>
                <div>
                    <strong>Usuario:</strong>
                    ${escapeHTML(log.username)}
                    ${log.parent_username ? ` (Sub-usuario de: ${escapeHTML(log.parent_username)})` : ''}
                </div>
                <div>
                    <strong>Correo:</strong>
                    <span title="${searchedEmailText}" style="display: inline-block; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;">
                        ${escapeHTML(searchedEmailText)}
                    </span>
                </div>
            </div>
            `;
        });
        
        logListContainer.innerHTML = html;
    }

    function renderPagination(pagination) {
         if (!paginationContainer || !pagination || pagination.total_pages <= 1) {
            if(paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        let paginationHTML = '<div class="mt-2 d-flex justify-content-center gap-1">';

        if (pagination.has_prev) {
            paginationHTML += `<button class="btn btn-blue pagination-link" data-page="${pagination.prev_num}">&laquo; Anterior</button>`;
        } else {
            paginationHTML += `<button class="btn btn-gray" disabled>&laquo; Anterior</button>`;
        }

        paginationHTML += `<span>Página ${pagination.page} de ${pagination.total_pages}</span>`;

        if (pagination.has_next) {
            paginationHTML += `<button class="btn btn-blue pagination-link" data-page="${pagination.next_num}">Siguiente &raquo;</button>`;
        } else {
            paginationHTML += `<button class="btn btn-gray" disabled>Siguiente &raquo;</button>`;
        }

        paginationHTML += '</div>';
        paginationContainer.innerHTML = paginationHTML;
    }

    function fetchLogs(query = "", page = 1) {
        if (!logListContainer) return;
        logListContainer.innerHTML = '<p>Cargando logs...</p>';
        if(paginationContainer) paginationContainer.innerHTML = '';

        currentQuery = query;
        currentPage = page;

        const url = `/admin/view_trigger_logs?search_query=${encodeURIComponent(query)}&page=${page}`;

        fetch(url, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrfToken
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'ok') {
                renderLogs(data.logs);
                renderPagination(data.pagination);
            } else {
                logListContainer.innerHTML = `<p style="color:red;">Error: ${data.message || 'No se pudieron cargar los logs.'}</p>`;
            }
        })
        .catch(error => {
            logListContainer.innerHTML = `<p style="color:red;">Error de red al cargar los logs.</p>`;
        });
    }

    fetchLogs(currentQuery, currentPage);

    // Búsqueda automática al escribir (con debounce)
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const query = searchInput.value.trim();
                fetchLogs(query, 1);
            }, 500); // Esperar 500ms después de que el usuario deje de escribir
        });
    }

    if (paginationContainer) {
        paginationContainer.addEventListener('click', function(event) {
            const target = event.target;
            if (target.classList.contains('pagination-link') && target.dataset.page) {
                event.preventDefault();
                const page = parseInt(target.dataset.page, 10);
                fetchLogs(currentQuery, page);
            }
        });
    }

    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"\']/g, function (match) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[match];
        });
    }
});