// admin_filters.js

document.addEventListener("DOMContentLoaded", function() {
  // ===================================
  // DOMINIOS
  // ===================================

  const domainSearchForm = document.getElementById("domainSearchForm");
  const domainSearchInput = document.getElementById("domainSearchInput");
  const domainListContainer = document.getElementById("domain-list");

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
    let html = "";
    domains.forEach(d => {
      html += `
        <div class="domain-item" style="margin-bottom:0.5rem;">
          <strong>${d.domain}</strong>
          <div style="margin-top:0.5rem;">
            <button class="btn-orange" style="margin-right:0.5rem;"
                    onclick="window.location.href='/admin/edit_domain/${d.id}'">
              Editar
            </button>
      `;
      if (d.enabled) {
        html += `
          <button class="btn-red toggle-domain"
                  data-id="${d.id}"
                  data-enabled="true"
                  style="margin-right:0.5rem;"
          >
            Off
          </button>
        `;
      } else {
        html += `
          <button class="btn-green toggle-domain"
                  data-id="${d.id}"
                  data-enabled="false"
                  style="margin-right:0.5rem;"
          >
            On
          </button>
        `;
      }
      html += `
            <button class="btn-red delete-domain"
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
    // Toggle domain
    if (e.target.classList.contains("toggle-domain")) {
      e.preventDefault();
      const domId = e.target.getAttribute("data-id");
      const currentlyEnabled = (e.target.getAttribute("data-enabled") === "true");
      fetch("/admin/toggle_domain_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ dom_id: domId, currently_enabled: currentlyEnabled })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          if (domainListContainer) {
            domainListContainer.innerHTML = renderDomainItems(data.domains);
          }
        } else {
          console.error("Error toggling domain:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error toggleDomain:", err));
    }

    // Delete domain
    if (e.target.classList.contains("delete-domain")) {
      e.preventDefault();
      const domId = e.target.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este dominio?")) return;
      fetch("/admin/delete_domain_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ dom_id: domId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          if (domainListContainer) {
            domainListContainer.innerHTML = renderDomainItems(data.domains);
          }
        } else {
          console.error("Error deleting domain:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error deleteDomain:", err));
    }
  });


  // ===================================
  // FILTROS
  // ===================================

  const filterSearchForm = document.getElementById("filterSearchForm");
  const filterSearchInput = document.getElementById("filterSearchInput");
  const filterListContainer = document.getElementById("filter-list");

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
    let html = "";
    filters.forEach(f => {
      html += `
        <div class="filter-item" style="margin-bottom:0.5rem;">
          <strong>Remitente:</strong> ${f.sender || "(vacío)"}<br>
          <strong>Palabra:</strong> ${f.keyword || "(vacío)"}<br>
          <strong>CortarHTML:</strong> ${f.cut_after_html || "(N/A)"}
          <div style="margin-top:0.5rem;">
            <button class="btn-orange" style="margin-right:0.5rem;"
                    onclick="window.location.href='/admin/edit_filter/${f.id}'">
              Editar
            </button>
      `;
      if (f.enabled) {
        html += `
          <button class="btn-red toggle-filter"
                  data-id="${f.id}"
                  data-enabled="true"
                  style="margin-right:0.5rem;"
          >
            Off
          </button>
        `;
      } else {
        html += `
          <button class="btn-green toggle-filter"
                  data-id="${f.id}"
                  data-enabled="false"
                  style="margin-right:0.5rem;"
          >
            On
          </button>
        `;
      }
      html += `
            <button class="btn-red delete-filter"
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
    // Toggle filter
    if (e.target.classList.contains("toggle-filter")) {
      e.preventDefault();
      const filterId = e.target.getAttribute("data-id");
      const currentlyEnabled = (e.target.getAttribute("data-enabled") === "true");
      fetch("/admin/toggle_filter_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ filter_id: filterId, currently_enabled: currentlyEnabled })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          if (filterListContainer) {
            filterListContainer.innerHTML = renderFilterItems(data.filters);
          }
        } else {
          console.error("Error toggling filter:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error toggleFilter:", err));
    }

    // Delete filter
    if (e.target.classList.contains("delete-filter")) {
      e.preventDefault();
      const filterId = e.target.getAttribute("data-id");
      if (!confirm("¿Deseas eliminar este filtro?")) return;
      fetch("/admin/delete_filter_ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ filter_id: filterId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          if (filterListContainer) {
            filterListContainer.innerHTML = renderFilterItems(data.filters);
          }
        } else {
          console.error("Error deleteFilter:", data.message);
          alert("Error: " + data.message);
        }
      })
      .catch(err => console.error("Error deleteFilter:", err));
    }
  });

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }
});