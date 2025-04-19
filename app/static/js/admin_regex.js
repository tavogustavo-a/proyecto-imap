// admin_regex.js

document.addEventListener("DOMContentLoaded", function() {
    // ===================================
    // REGEX
    // ===================================
  
    const regexSearchForm = document.getElementById("regexSearchForm");
    const regexSearchInput = document.getElementById("regexSearchInput");
    const regexListContainer = document.getElementById("regex-list");
  
    if (regexSearchForm && regexSearchInput && regexListContainer) {
      regexSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = regexSearchInput.value.trim();
  
        fetch(`/admin/search_regex_ajax?query=${encodeURIComponent(query)}`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "error") {
            console.error("Error fetch regex:", data.message);
            alert("Error: " + data.message);
            return;
          }
          regexListContainer.innerHTML = renderRegexItems(data.regexes);
        })
        .catch(err => console.error("Error fetch regex:", err));
      });
    }
  
    function renderRegexItems(regexes) {
      let html = "";
      regexes.forEach(r => {
        html += `
          <div class="regex-item" style="margin-bottom:0.5rem;">
            <strong>Remitente:</strong> ${r.sender || "(vacío)"}<br>
            <strong>Patrón:</strong> ${r.pattern}<br>
            <strong>Descripción:</strong> ${r.description || "(vacío)"}
            <div style="margin-top:0.5rem;">
        `;
        if (!r.protected) {
          html += `
            <button class="btn-orange"
                    style="margin-right:0.5rem;"
                    onclick="window.location.href='/admin/edit_regex/${r.id}'"
            >
              Editar
            </button>
            <button class="btn-red delete-regex"
                    data-id="${r.id}"
                    style="margin-right:0.5rem;"
            >
              Eliminar
            </button>
          `;
        }
        if (r.enabled) {
          html += `
            <button class="btn-red toggle-regex"
                    data-id="${r.id}"
                    data-enabled="true"
            >
              Off
            </button>
          `;
        } else {
          html += `
            <button class="btn-green toggle-regex"
                    data-id="${r.id}"
                    data-enabled="false"
            >
              On
            </button>
          `;
        }
        html += `</div></div>`;
      });
      return html;
    }
  
    document.addEventListener("click", (e) => {
      // Toggle regex
      if (e.target.classList.contains("toggle-regex")) {
        e.preventDefault();
        const regexId = e.target.getAttribute("data-id");
        const currentlyEnabled = (e.target.getAttribute("data-enabled") === "true");
        fetch("/admin/toggle_regex_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ regex_id: regexId, currently_enabled: currentlyEnabled })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok") {
            if (regexListContainer) {
              regexListContainer.innerHTML = renderRegexItems(data.regexes);
            }
          } else {
            console.error("Error toggling regex:", data.message);
            alert("Error: " + data.message);
          }
        })
        .catch(err => console.error("Error toggleRegex:", err));
      }
  
      // Delete regex
      if (e.target.classList.contains("delete-regex")) {
        e.preventDefault();
        const regexId = e.target.getAttribute("data-id");
        if (!confirm("¿Deseas eliminar este regex?")) return;
        fetch("/admin/delete_regex_ajax", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify({ regex_id: regexId })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "ok") {
            if (regexListContainer) {
              regexListContainer.innerHTML = renderRegexItems(data.regexes);
            }
          } else {
            console.error("Error deleting regex:", data.message);
            alert("Error: " + data.message);
          }
        })
        .catch(err => console.error("Error deleteRegex:", err));
      }
    });
  
    function getCsrfToken() {
      const meta = document.querySelector('meta[name="csrf_token"]');
      return meta ? meta.getAttribute('content') : '';
    }
  });
  