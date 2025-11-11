// admin_regex.js

document.addEventListener("DOMContentLoaded", function() {
    // ===================================
    // REGEX
    // ===================================
  
    const regexSearchForm = document.getElementById("regexSearchForm");
    const regexSearchInput = document.getElementById("regexSearchInput");
    const regexListContainer = document.getElementById("regex-list");
    const btnVolverPanelTop = document.getElementById("btnVolverPanelTop");
    const btnVolverPanelBottom = document.getElementById("btnVolverPanelBottom");
  
    if (regexSearchForm && regexSearchInput && regexListContainer) {
      regexSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        regexSearchInput.value = "";
        fetch(`/admin/search_regex_ajax?query=`, {
          method: "GET",
          headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === "error") {
            alert("Error: " + data.message);
            return;
          }
          regexListContainer.innerHTML = renderRegexItems(data.regexes);
        })
        .catch(err => {});
      });
    }
  
    function renderRegexItems(regexes) {
      let html = "";
      if (!regexes || regexes.length === 0) {
        return "<p>No se encontraron Regex.</p>";
      }
      regexes.forEach(r => {
        html += `
          <div class="regex-item">
            <strong>Remitente:</strong> ${r.sender || "(vacío)"}<br>
            <strong>Descripción:</strong> ${r.description || "(vacío)"}<br>
            <strong>Patrón:</strong> ${r.pattern}<br>
            <div class="mt-05">
        `;
        if (!r.protected) {
          html += `
            <button
              class="btn-orange mr-05 edit-regex-btn"
              data-edit-url="/admin/edit_regex/${r.id}"
            >
              Editar
            </button>
            <button
              class="btn-panel btn-red btn-sm delete-regex mr-05"
              data-id="${r.id}"
              title="Eliminar"
            >
              <i class="fas fa-trash"></i>
            </button>
          `;
        }
        if (r.enabled) {
          html += `
            <button
              class="btn-red toggle-regex"
              data-id="${r.id}"
              data-enabled="true"
            >
              Off
            </button>
          `;
        } else {
          html += `
            <button
              class="btn-green toggle-regex"
              data-id="${r.id}"
              data-enabled="false"
            >
              On
            </button>
          `;
        }
        html += `
            </div>
          </div>
        `;
      });
      return html;
    }
  
    // EVENT LISTENER GLOBAL (Delegación) - SOLO PARA TOGGLE AHORA
    document.addEventListener("click", (e) => {
      const target = e.target;
  
      // --- Botones Toggle (Solo Regex, ya que los otros se manejan en su contenedor) --- 
      if (target.classList.contains("toggle-regex")) {
          e.preventDefault();
          const regexId = target.getAttribute("data-id");
          const currentlyEnabled = (target.getAttribute("data-enabled") === "true");
          fetch("/admin/toggle_regex_ajax", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ regex_id: parseInt(regexId), currently_enabled: currentlyEnabled })
          })
          .then(res => res.json())
          .then(data => {
            if (data.status === "ok") {
              if (regexListContainer) {
                // Recargar la lista después de toggle
                fetch("/admin/search_regex_ajax?query=", { 
                    method: "GET", 
                    headers: { "X-CSRFToken": getCsrfToken() }
                })
                .then(res => res.json())
                .then(searchData => {
                    if (searchData.status === 'ok') {
                        regexListContainer.innerHTML = renderRegexItems(searchData.regexes);
                    } else {
                        throw new Error(searchData.message || 'Error recargando lista');
                    }
                })
                .catch(reloadErr => {
                    alert("Estado Regex cambiado, pero hubo un error al recargar la lista.");
                });
              }
            } else {
              alert("Error: " + data.message);
            }
          })
          .catch(err => {});
      }
    }); // Fin Listener Global Document
  
    function getCsrfToken() {
      const csrfMeta = document.querySelector('meta[name="csrf_token"]');
      return csrfMeta ? csrfMeta.getAttribute("content") : "";
    }
  
    // Listener para botones "Volver al Panel"
    [btnVolverPanelTop, btnVolverPanelBottom].forEach(btn => {
      if (btn) {
        const dashboardUrl = btn.dataset.dashboardUrl;
        if (dashboardUrl) {
          btn.addEventListener("click", () => {
            window.location.href = dashboardUrl;
          });
        }
      }
    });
  
    // Listener para acciones en la lista (delegación)
    if (regexListContainer) {
      regexListContainer.addEventListener("click", (e) => {
        const target = e.target;
  
        // Acción Editar
        if (target.classList.contains("edit-regex-btn")) {
          e.preventDefault();
          const editUrl = target.dataset.editUrl;
          if (editUrl) {
            window.location.href = editUrl;
          }
        }
  
        // Acción Toggle
        else if (target.classList.contains("toggle-regex")) {
          e.preventDefault();
          const regexId = target.getAttribute("data-id");
          const currentEnabled = target.getAttribute("data-enabled") === 'true';
          fetch("/admin/toggle_regex_ajax", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ regex_id: parseInt(regexId), currently_enabled: currentEnabled })
          })
          .then(res => res.json())
          .then(data => {
            if (data.status === "ok") {
              if (regexListContainer) {
                regexListContainer.innerHTML = renderRegexItems(data.regexes);
              }
            } else {
              alert("Error: " + data.message);
            }
          })
          .catch(err => {});
        }
  
        // Acción Eliminar
        else if (target.classList.contains("delete-regex") || target.closest(".delete-regex")) {
          e.preventDefault();
          e.stopPropagation();
          const button = target.classList.contains("delete-regex") ? target : target.closest(".delete-regex");
          const regexId = button.getAttribute("data-id");
          if (!confirm("¿Deseas eliminar este regex?")) return;

          // Feedback visual inmediato
          button.disabled = true;
          const originalHTML = button.innerHTML;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

          fetch("/admin/delete_regex_ajax", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ regex_id: parseInt(regexId) })
          })
          .then(res => {
              if (!res.ok) {
                  return res.json().then(errData => { throw new Error(errData.message || `Error ${res.status}`); });
              }
              return res.json();
          })
          .then(data => {
            if (data.status === "ok") {
              // Recargar la lista
              fetch("/admin/search_regex_ajax?query=", { 
                  method: "GET", 
                  headers: { "X-CSRFToken": getCsrfToken() }
              })
              .then(res => res.json())
              .then(searchData => {
                  if (searchData.status === 'ok') {
                      regexListContainer.innerHTML = renderRegexItems(searchData.regexes);
                  } else {
                      throw new Error(searchData.message || 'Error recargando lista');
                  }
              })
              .catch(reloadErr => {
                  alert("Regex eliminado, pero hubo un error al recargar la lista.");
                  target.closest('.regex-item')?.remove(); 
              });
              
            } else {
              throw new Error(data.message || 'Error desconocido al eliminar');
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
        }
      });
    }
  
    // --- Búsqueda instantánea de regex ---
    if (regexSearchInput && regexListContainer) {
      let searchTimeout = null;
      regexSearchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          const query = regexSearchInput.value.trim();
          fetch(`/admin/search_regex_ajax?query=${encodeURIComponent(query)}`, {
            method: "GET",
            headers: { "X-CSRFToken": getCsrfToken() }
          })
          .then(res => res.json())
          .then(data => {
            if (data.status === "ok") {
              regexListContainer.innerHTML = renderRegexItems(data.regexes);
            } else {
              alert("Error: " + data.message);
            }
          })
          .catch(err => {});
        }, 200);
      });
    }
  
    // Carga inicial
    fetch("/admin/search_regex_ajax?query=", {
      method: "GET",
      headers: { "X-CSRFToken": getCsrfToken() }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === "ok") {
        if (regexListContainer) {
          regexListContainer.innerHTML = renderRegexItems(data.regexes);
        }
      }
    })
    .catch(err => {});
  });
  