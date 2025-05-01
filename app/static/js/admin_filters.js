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
      const query = domainSearchInput.value.trim();

      fetch(`/admin/search_domains_ajax?query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "error") {
          console.error("Error de búsqueda dominios:", data.message);
          alert("Error: " + data.message);
          return;
        }
        domainListContainer.innerHTML = renderDomainItems(data.domains);
      })
      .catch(err => console.error("Error fetch DOMAINS:", err));
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
              class="btn-red delete-domain"
              data-id="${d.id}"
            >
              Eliminar
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
        } else {
            console.error("No data-url found on edit button:", target);
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
                console.error(`Error toggling ${entityType}:`, data.message);
                alert("Error: " + data.message);
            }
        })
        .catch(err => console.error(`Error toggle ${entityType}:`, err));
        return; // Detener procesamiento
    }

    // --- Botones Delete (Dominio y Filtro) --- 
    let isDelete = false;
    let deleteUrl = "";
    let deleteId = "";
    entityType = ""; // Reset entityType

    if (target.classList.contains("delete-domain")) {
        isDelete = true;
        deleteUrl = "/admin/delete_domain_ajax";
        deleteId = target.getAttribute("data-id");
        entityType = 'domain';
        if (!confirm("¿Deseas eliminar este dominio?")) return;
    }

    if (isDelete) {
      e.preventDefault();
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
          console.error(`Error deleting ${entityType}:`, data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error(`Error delete ${entityType}:`, err));
      return; // Detener procesamiento
    }
  });

  // ===================================
  // FILTROS
  // ===================================

  if (filterSearchForm && filterSearchInput && filterListContainer) {
    filterSearchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const query = filterSearchInput.value.trim();

      fetch(`/admin/search_filters_ajax?query=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { "X-CSRFToken": getCsrfToken() }
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "error") {
          console.error("Error fetch filters:", data.message);
          alert("Error: " + data.message);
          return;
        }
        filterListContainer.innerHTML = renderFilterItems(data.filters);
      })
      .catch(err => console.error("Error fetch filters:", err));
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
          <strong>Palabra:</strong> ${f.keyword || "(vacío)"}<br>
          <strong>CortarHTML:</strong> ${f.cut_after_html || "(N/A)"}
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
              class="btn-red delete-filter"
              data-id="${f.id}"
            >
              Eliminar
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
        } else {
            console.error("No data-url found on edit button:", target);
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
                console.error(`Error toggling ${entityType}:`, data.message);
                alert("Error: " + data.message);
            }
        })
        .catch(err => console.error(`Error toggle ${entityType}:`, err));
        return; // Detener procesamiento
    }

    // --- Botones Delete (Dominio y Filtro) --- 
    let isDelete = false;
    let deleteUrl = "";
    let deleteId = "";
    entityType = ""; // Reset entityType

    if (target.classList.contains("delete-filter")) {
        isDelete = true;
        deleteUrl = "/admin/delete_filter_ajax";
        deleteId = target.getAttribute("data-id");
        entityType = 'filter';
        if (!confirm("¿Deseas eliminar este filtro?")) return;
    }

    if (isDelete) {
      e.preventDefault();
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
          console.error(`Error deleting ${entityType}:`, data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error(`Error delete ${entityType}:`, err));
      return; // Detener procesamiento
    }
  });

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // --- Botones "Volver al Panel" --- 
  function setupVolverButton(buttonElement) {
    if (buttonElement) {
        const url = buttonElement.getAttribute('data-dashboard-url');
        if (url) {
            buttonElement.addEventListener('click', () => {
                window.location.href = url;
            });
        } else {
            console.warn('Botón Volver sin data-dashboard-url:', buttonElement.id);
        }
    }
  }
  setupVolverButton(btnVolverPanelTop);
  setupVolverButton(btnVolverPanelBottom);
});