// admin_filters.js

document.addEventListener("DOMContentLoaded", function() {
  const filterSearchForm = document.getElementById("filterSearchForm");
  const filterSearchInput = document.getElementById("filterSearchInput");
  const filterListContainer = document.getElementById("filter-list");

  // Botones Volver al Panel (podrían existir ambos)
  const btnVolverPanelTop = document.getElementById("btnVolverPanelTopFilter");
  const btnVolverPanelBottom = document.getElementById("btnVolverPanelBottomFilter");

  // ===================================
  // FILTROS
  // ===================================

  if (filterSearchForm && filterSearchInput && filterListContainer) {
    filterSearchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      filterSearchInput.value = "";
      fetch(`/admin/search_filters_ajax?query=`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "error") {
          alert("Error: " + data.message);
          return;
        }
        filterListContainer.innerHTML = renderFilterItems(data.filters);
      })
      .catch(err => {});
    });
  }

  // --- Búsqueda instantánea de filtros ---
  if (filterSearchInput && filterListContainer) {
    let searchTimeout = null;
    filterSearchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = filterSearchInput.value.trim();
        fetch(`/admin/search_filters_ajax?query=${encodeURIComponent(query)}`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "error") {
            alert("Error: " + data.message);
            return;
          }
          filterListContainer.innerHTML = renderFilterItems(data.filters);
        })
        .catch(err => {});
      }, 200);
    });
  }

  function renderFilterItems(filters) {
    if (!filters || filters.length === 0) {
        return '<p>No se encontraron filtros.</p>';
    }
    let html = "";
    filters.forEach(f => {
      const toggleClass = f.enabled ? 'btn-red' : 'btn-green';
      const toggleText = f.enabled ? 'Off' : 'On';
      const editUrl = `/admin/edit_filter/${f.id}`;

      html += `
        <div class="filter-item">
          <strong>Remitente:</strong> ${f.sender || "(vacío)"}<br>
          <strong>Palabra Clave:</strong> ${f.keyword || "(vacío)"}<br>
          <strong>Descripción:</strong> ${f.description || "(vacío)"}<br>
          <strong>Cortar DESDE ARRIBA:</strong> ${f.cut_after_html || "(N/A)"}<br>
          <strong>Cortar DESDE ABAJO:</strong> ${f.cut_before_html || "(N/A)"}<br>
          <div class="mt-05"> 
            <button
              type="button"
              class="btn-orange mr-05 edit-filter-btn"
              data-url="${editUrl}" 
            >
              Editar
            </button>
            <button
              type="button"
              class="${toggleClass} toggle-filter mr-05"
              data-id="${f.id}"
              data-enabled="${f.enabled}"
            >
              ${toggleText}
            </button>
            <button
              type="button"
              class="btn-panel btn-red btn-sm delete-filter"
              data-id="${f.id}"
              title="Eliminar"
            >
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    });
    return html;
  }

  document.addEventListener("click", (e) => {
    const target = e.target;

    // --- Botones Editar --- 
    if (target.classList.contains("edit-filter-btn")) {
        e.preventDefault();
        const url = target.getAttribute("data-url");
        if (url) {
            window.location.href = url;
        }
        return; // Detener procesamiento si es un botón de editar
    }

    // --- Botones Toggle (Filtro) --- 
    let isToggle = false;
    let toggleUrl = "";
    let toggleId = "";
    let currentlyEnabled = false;

    if (target.classList.contains("toggle-filter")) {
        isToggle = true;
        toggleUrl = "/admin/toggle_filter_ajax";
        toggleId = target.getAttribute("data-id");
        currentlyEnabled = (target.getAttribute("data-enabled") === "true");
    }

    if (isToggle) {
        e.preventDefault();
        const body = {};
        body.filter_id = toggleId;
        body.currently_enabled = currentlyEnabled;

        fetch(toggleUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify(body)
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "ok") {
                if (filterListContainer) {
                    filterListContainer.innerHTML = renderFilterItems(data.filters);
                }
            } else {
                alert("Error: " + data.message);
            }
        })
        .catch(err => {});
        return; // Detener procesamiento
    }

    // --- Botones Delete (Filtro) --- 
    if (target.classList.contains("delete-filter") || target.closest(".delete-filter")) {
        e.preventDefault();
        e.stopPropagation();
        const button = target.classList.contains("delete-filter") ? target : target.closest(".delete-filter");
        const deleteId = button.getAttribute("data-id");
        
        if (!confirm("¿Deseas eliminar este filtro?")) return;
        
        // Feedback visual inmediato
        button.disabled = true;
        const originalHTML = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        fetch("/admin/delete_filter_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ filter_id: deleteId })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok") {
             if (filterListContainer) {
                  filterListContainer.innerHTML = renderFilterItems(data.filters);
              }
          } else {
            alert("Error: " + data.message);
          }
        })
        .catch(err => {
          alert("Error de red: " + err.message);
        })
        .finally(() => {
          // Restaurar botón
          button.disabled = false;
          button.innerHTML = originalHTML;
        });
        return; // Detener procesamiento
    }
  });

  function getCsrfToken() {
    const csrfMeta = document.querySelector('meta[name="csrf_token"]');
    return csrfMeta ? csrfMeta.getAttribute("content") : "";
  }

  // --- Cargar filtros inicialmente ---
  function loadInitialFilters() {
    if (filterListContainer) {
      fetch(`/admin/search_filters_ajax?query=`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "error") {
          console.error("Error loading filters:", data.message);
          return;
        }
        filterListContainer.innerHTML = renderFilterItems(data.filters);
      })
      .catch(err => {
        console.error("Error loading filters:", err);
      });
    }
  }

  // Cargar filtros al inicio
  loadInitialFilters();

  // --- Botones "Volver al Panel" --- 
  function setupVolverButton(buttonElement) {
    if (buttonElement) {
        const url = buttonElement.getAttribute('data-dashboard-url');
        if (url) {
            buttonElement.addEventListener('click', () => {
                window.location.href = url;
            });
        }
    }
  }
  setupVolverButton(btnVolverPanelTop);
  setupVolverButton(btnVolverPanelBottom);
});