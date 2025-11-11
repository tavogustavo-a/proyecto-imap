// admin_filters.js

document.addEventListener("DOMContentLoaded", function() {
  // ===================================
  // DOMINIOS
  // ===================================

  const domainSearchForm = document.getElementById("domainSearchForm");
  const domainSearchInput = document.getElementById("domainSearchInput");
  const domainListContainer = document.getElementById("domain-list");

  const filterSearchForm = document.getElementById("filterSearchForm");
  const filterSearchInput = document.getElementById("filterSearchInput");
  const filterListContainer = document.getElementById("filter-list");

  // Botones Volver al Panel (podrían existir ambos)
  const btnVolverPanelTop = document.getElementById("btnVolverPanelTopFilter");
  const btnVolverPanelBottom = document.getElementById("btnVolverPanelBottomFilter");

  // ===================================
  // DOMINIOS
  // ===================================

  if (domainSearchForm && domainSearchInput && domainListContainer) {
    domainSearchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      domainSearchInput.value = "";
      fetch(`/admin/search_domains_ajax?query=`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "error") {
          alert("Error: " + data.message);
          return;
        }
        domainListContainer.innerHTML = renderDomainItems(data.domains);
      })
      .catch(err => {});
    });
  }

  // --- Búsqueda instantánea de dominios ---
  if (domainSearchInput && domainListContainer) {
    let searchTimeout = null;
    domainSearchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = domainSearchInput.value.trim();
        fetch(`/admin/search_domains_ajax?query=${encodeURIComponent(query)}`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "error") {
            alert("Error: " + data.message);
            return;
          }
          domainListContainer.innerHTML = renderDomainItems(data.domains);
        })
        .catch(err => {});
      }, 200);
    });
  }

  function renderDomainItems(domains) {
    if (!domains || domains.length === 0) {
      return '<p>No se encontraron dominios.</p>';
    }
    let html = "";
    domains.forEach(d => {
      const toggleClass = d.enabled ? 'btn-red' : 'btn-green';
      const toggleText = d.enabled ? 'Off' : 'On';
      const editUrl = `/admin/edit_domain/${d.id}`;

      html += `
        <div class="domain-item">
          <strong>${d.domain}</strong>
          <div class="mt-05"> 
            <button
              type="button"
              class="btn-orange mr-05 edit-domain-btn"
              data-url="${editUrl}" 
            >
              Editar
            </button>
            <button
              type="button"
              class="${toggleClass} toggle-domain mr-05"
              data-id="${d.id}"
              data-enabled="${d.enabled}"
            >
              ${toggleText}
            </button>
            <button
              type="button"
              class="btn-panel btn-red btn-sm delete-domain"
              data-id="${d.id}"
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
    if (target.classList.contains("edit-domain-btn")) {
        e.preventDefault();
        const url = target.getAttribute("data-url");
        if (url) {
            window.location.href = url;
        }
        return; // Detener procesamiento si es un botón de editar
    }

    // --- Botones Toggle (Dominio y Filtro) --- 
    let isToggle = false;
    let toggleUrl = "";
    let toggleId = "";
    let currentlyEnabled = false;
    let entityType = ""; // 'domain' or 'filter'

    if (target.classList.contains("toggle-domain")) {
        isToggle = true;
        toggleUrl = "/admin/toggle_domain_ajax";
        toggleId = target.getAttribute("data-id");
        currentlyEnabled = (target.getAttribute("data-enabled") === "true");
        entityType = 'domain';
    }

    if (isToggle) {
        e.preventDefault();
        const body = {};
        body.dom_id = toggleId;
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
                if (entityType === 'domain' && domainListContainer) {
                    domainListContainer.innerHTML = renderDomainItems(data.domains);
                }
            } else {
                alert("Error: " + data.message);
            }
        })
        .catch(err => {});
        return; // Detener procesamiento
    }

    // --- Botones Delete (Dominio y Filtro) --- 
    let isDelete = false;
    let deleteUrl = "";
    let deleteId = "";
    entityType = ""; // Reset entityType

    if (target.classList.contains("delete-domain") || target.closest(".delete-domain")) {
        e.preventDefault();
        e.stopPropagation();
        isDelete = true;
        const button = target.classList.contains("delete-domain") ? target : target.closest(".delete-domain");
        deleteUrl = "/admin/delete_domain_ajax";
        deleteId = button.getAttribute("data-id");
        entityType = 'domain';
        if (!confirm("¿Deseas eliminar este dominio?")) return;
    }

    if (isDelete) {
      e.preventDefault();
      
      // Feedback visual inmediato
      target.disabled = true;
      const originalHTML = target.innerHTML;
      target.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      
      const body = {};
       if (entityType === 'domain') {
            body.dom_id = deleteId;
        }

      fetch(deleteUrl, {
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
           if (entityType === 'domain' && domainListContainer) {
                domainListContainer.innerHTML = renderDomainItems(data.domains);
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
        target.disabled = false;
        target.innerHTML = originalHTML;
      });
      return; // Detener procesamiento
    }
  });

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

    // --- Botones Toggle (Dominio y Filtro) --- 
    let isToggle = false;
    let toggleUrl = "";
    let toggleId = "";
    let currentlyEnabled = false;
    let entityType = ""; // 'domain' or 'filter'

    if (target.classList.contains("toggle-filter")) {
        isToggle = true;
        toggleUrl = "/admin/toggle_filter_ajax";
        toggleId = target.getAttribute("data-id");
        currentlyEnabled = (target.getAttribute("data-enabled") === "true");
        entityType = 'filter';
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
                if (entityType === 'filter' && filterListContainer) {
                    filterListContainer.innerHTML = renderFilterItems(data.filters);
                }
            } else {
                alert("Error: " + data.message);
            }
        })
        .catch(err => {});
        return; // Detener procesamiento
    }

    // --- Botones Delete (Dominio y Filtro) --- 
    let isDelete = false;
    let deleteUrl = "";
    let deleteId = "";
    entityType = ""; // Reset entityType

    if (target.classList.contains("delete-filter") || target.closest(".delete-filter")) {
        e.preventDefault();
        e.stopPropagation();
        isDelete = true;
        const button = target.classList.contains("delete-filter") ? target : target.closest(".delete-filter");
        deleteUrl = "/admin/delete_filter_ajax";
        deleteId = button.getAttribute("data-id");
        entityType = 'filter';
        if (!confirm("¿Deseas eliminar este filtro?")) return;
    }

    if (isDelete) {
      e.preventDefault();
      
      // Feedback visual inmediato
      target.disabled = true;
      const originalHTML = target.innerHTML;
      target.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      
      const body = {};
       if (entityType === 'filter') {
            body.filter_id = deleteId;
        }

      fetch(deleteUrl, {
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
           if (entityType === 'filter' && filterListContainer) {
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
        target.disabled = false;
        target.innerHTML = originalHTML;
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