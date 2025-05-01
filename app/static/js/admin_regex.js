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
              class="btn-red delete-regex mr-05"
              data-id="${r.id}"
            >
              Eliminar
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
                    console.error("Error recargando lista post-toggle:", reloadErr);
                    alert("Estado Regex cambiado, pero hubo un error al recargar la lista.");
                });
              }
            } else {
              console.error("Error toggling regex:", data.message);
              alert("Error: " + data.message);
            }
          })
          .catch(err => console.error("Error toggleRegex:", err));
      }
    }); // Fin Listener Global Document
  
    function getCsrfToken() {
      const meta = document.querySelector('meta[name="csrf_token"]');
      return meta ? meta.getAttribute('content') : '';
    }
  
    // Listener para botones "Volver al Panel"
    [btnVolverPanelTop, btnVolverPanelBottom].forEach(btn => {
      if (btn) {
        const dashboardUrl = btn.dataset.dashboardUrl;
        if (dashboardUrl) {
          btn.addEventListener("click", () => {
            window.location.href = dashboardUrl;
          });
        } else {
          console.error("No se encontró data-dashboard-url en botón Volver");
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
          } else {
            console.error("No se encontró data-edit-url en el botón Editar");
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
              console.error("Error toggling regex:", data.message);
              alert("Error: " + data.message);
            }
          })
          .catch(err => console.error("Error toggleRegex:", err));
        }
  
        // Acción Eliminar
        else if (target.classList.contains("delete-regex")) {
          e.preventDefault();
          const regexId = target.getAttribute("data-id");
          if (!confirm("¿Deseas eliminar este regex?")) return;

          // Deshabilitar botón temporalmente
          target.disabled = true;
          target.textContent = '...';

          fetch("/admin/delete_regex_ajax", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ regex_id: parseInt(regexId) })
          })
          .then(res => {
              if (!res.ok) { // Si el status no es 2xx
                  return res.json().then(errData => { throw new Error(errData.message || `Error ${res.status}`); });
              }
              return res.json(); // Esperamos {status: "ok"}
          })
          .then(data => {
            if (data.status === "ok") {
              // Éxito: Eliminar el elemento directamente o recargar la lista
              // Opción simple: Recargar toda la lista (como hace el toggle)
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
                  console.error("Error recargando lista post-delete:", reloadErr);
                  alert("Regex eliminado, pero hubo un error al recargar la lista.");
                  // Quitar el elemento viejo como fallback si falla la recarga
                  target.closest('.regex-item')?.remove(); 
              });
              
            } else {
              // Esto no debería ocurrir si el backend devuelve error con status != 2xx
              throw new Error(data.message || 'Error desconocido al eliminar');
            }
          })
          .catch(err => {
            console.error("Error deleteRegex:", err);
            alert("Error al eliminar Regex: " + err.message);
            // Rehabilitar botón si hubo error
            target.disabled = false;
            target.textContent = 'Eliminar';
          });
        }
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
    .catch(err => console.error("Error init RegexList:", err));
  });
  