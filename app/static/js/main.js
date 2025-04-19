// app/static/js/main.js

document.addEventListener("DOMContentLoaded", function () {
  console.log("main.js loaded!");

  const path = window.location.pathname;

  const serviceButtons = document.querySelectorAll(".service-btn");
  const aliasButtons = document.querySelectorAll(".alias-btn");
  const hiddenServiceId = document.getElementById("selectedServiceId");

  // Función que "selecciona" un servicio (o alias) y muestra/hide GIF
  function selectService(button) {
    // Quitar selección y ocultar GIF en todos los .service-btn y .alias-btn
    serviceButtons.forEach(btn => {
      btn.classList.remove("selected-service");
      const container = btn.closest(".service-btn-container");
      if (container) {
        const gif = container.querySelector(".gif-outside");
        if (gif) {
          gif.style.display = "none";
        }
      }
    });
    aliasButtons.forEach(abtn => {
      abtn.classList.remove("selected-service");
    });

    // Marcar este como seleccionado
    button.classList.add("selected-service");

    // Obtenemos su service-id
    const sid = button.getAttribute("data-service-id");
    hiddenServiceId.value = sid;

    // Mostrar el GIF si existe en su container
    const currentContainer = button.closest(".service-btn-container");
    if (currentContainer) {
      const gif = currentContainer.querySelector(".gif-outside");
      if (gif) {
        gif.style.display = "block";
      }
    }
  }

  // Evento para cada botón principal
  serviceButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      selectService(btn);
    });
  });

  // Evento para cada alias
  aliasButtons.forEach(abtn => {
    abtn.addEventListener("click", () => {
      selectService(abtn);
    });
  });

  // ================== BÚSQUEDA AJAX ==================
  const ajaxSearchForm = document.getElementById("ajax-search-form");
  const spinner = document.getElementById("spinner");
  const resultsDiv = document.getElementById("search-results");

  const csrfMeta = document.querySelector('meta[name="csrf_token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute("content") : "";

  if (ajaxSearchForm) {
    ajaxSearchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const email = document.getElementById("searchEmail").value.trim();
      const serviceId = document.getElementById("selectedServiceId").value.trim();

      if (!serviceId) {
        alert("Por favor, selecciona un servicio antes de buscar.");
        return;
      }
      if (!email) {
        return;
      }

      if (spinner) spinner.style.display = "block";
      if (resultsDiv) {
        resultsDiv.style.display = "none";
        resultsDiv.innerHTML = "";
      }

      fetch("/api/search_mails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken
        },
        credentials: "same-origin",
        body: JSON.stringify({
          email_to_search: email,
          service_id: serviceId
        })
      })
      .then(response => {
        // Incorporamos la comprobación de 403 => "No tienes permiso"
        if (!response.ok) {
          if (response.status === 403) {
            // Lanzamos directamente el mensaje
            throw new Error("No tienes permiso al consultar este correo");
          }
          throw new Error(`Error HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (spinner) spinner.style.display = "none";

        if (data.error) {
          if (resultsDiv) {
            resultsDiv.style.display = "block";
            resultsDiv.innerHTML = `<div style="color:red;">Error: ${data.error}</div>`;
          }
          return;
        }

        const results = data.results || [];
        if (results.length === 0) {
          if (resultsDiv) {
            resultsDiv.style.display = "block";
            resultsDiv.innerHTML = `<p>No se encontraron resultados.</p>`;
          }
          return;
        }

        // Tomamos el primer correo
        const mail = results[0];
        const regexDict = mail.regex_matches;
        const mailDateFormatted = mail.formatted_date || "";
        const filterMatched = mail.filter_matched === true;

        let html = "";

        // Mostrar HTML o Texto, aplicando la clase .filter-match si hay filtro
        if (mail.html) {
          if (filterMatched) {
            html += `
              <div class="mail-content filter-match">
                ${mail.html}
              </div>
            `;
          } else {
            html += `
              <div class="mail-content">
                ${mail.html}
              </div>
            `;
          }
        } else if (mail.text) {
          if (filterMatched) {
            html += `
              <div class="mail-content filter-match">
                <pre>${mail.text}</pre>
              </div>
            `;
          } else {
            html += `
              <div class="mail-content">
                <pre>${mail.text}</pre>
              </div>
            `;
          }
        }

        // Mostrar resultados de Regex
        if (regexDict && Object.keys(regexDict).length > 0) {
          html += renderRegexMatches(regexDict, mailDateFormatted);
        } else {
          if (mailDateFormatted) {
            html += `<p style="font-size:0.9rem; color:#666;">Fecha: ${mailDateFormatted}</p>`;
          }
        }

        if (resultsDiv) {
          resultsDiv.innerHTML = html;
          resultsDiv.style.display = "block";
          attachCopyButtonListener();
        }
      })
      .catch(err => {
        if (spinner) spinner.style.display = "none";
        if (resultsDiv) {
          resultsDiv.style.display = "block";
          // Ajuste => sin "Error de red:", solo el mensaje en grande
          resultsDiv.innerHTML = `
            <div style="color:red; font-size:1.2rem;">
              ${err.message}
            </div>
          `;
        }
      });
    });
  }

  function renderRegexMatches(regexMatches, mailDateFormatted) {
    let allMatches = [];
    for (const rId in regexMatches) {
      allMatches = allMatches.concat(regexMatches[rId]);
    }
    if (allMatches.length === 0) {
      return `<p>No se encontraron resultados de regex.</p>`;
    }

    let primerCodigo = allMatches[0];
    if (Array.isArray(primerCodigo)) {
      primerCodigo = primerCodigo.join("");
    } else {
      primerCodigo = String(primerCodigo);
    }

    const isLink = /^(https?:\/\/|www\.)/i.test(primerCodigo.trim());
    const MAX_LEN = 50;
    let displayText = primerCodigo;
    if (displayText.length > MAX_LEN) {
      displayText = displayText.slice(0, MAX_LEN - 3) + "...";
    }

    let html = `
      <div style="background:#f9f9f9; padding:1rem; text-align:center; margin-top:1rem;">
        <p style="font-size:1.4rem; color:#444; margin:0; display:inline-block;">
          <strong id="regex-code">${displayText}</strong>
        </p>
        <button
          id="copyRegexBtn"
          data-valor="${primerCodigo}"
          style="
            margin-left:1rem;
            padding:0.5rem 1rem;
            font-size:1rem;
            background-color: #007bff;
            border: 2px solid #007bff;
            color: #fff;
            cursor: pointer;
            border-radius:4px;
          "
        >
          Copiar
        </button>
    `;

    if (isLink) {
      html += `
        <button
          id="openLinkBtn"
          data-link="${primerCodigo}"
          style="
            margin-left:1rem;
            padding:0.5rem 1rem;
            font-size:1rem;
            background-color: #4caf50;
            border: 2px solid #4caf50;
            color: #fff;
            cursor: pointer;
            border-radius:4px;
          "
        >
          Abrir Enlace
        </button>
      `;
    }

    if (mailDateFormatted) {
      html += `
        <p style="font-size:0.9rem; color:#666; margin-top:1rem;">
          Fecha: ${mailDateFormatted}
        </p>
      `;
    }

    html += `</div>`;
    return html;
  }

  function attachCopyButtonListener() {
    const copyBtn = document.getElementById("copyRegexBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function() {
        const valorACopiar = copyBtn.getAttribute("data-valor") || "";
        copyTextToClipboard(valorACopiar)
          .then(() => {
            copyBtn.textContent = "Copiado";
            copyBtn.style.backgroundColor = "#28a745";
            copyBtn.style.borderColor = "#28a745";
            copyBtn.style.color = "#fff";
          })
          .catch((err) => {
            console.error("Error al copiar:", err);
            copyBtn.textContent = "Error";
          });
      });
    }

    const openLinkBtn = document.getElementById("openLinkBtn");
    if (openLinkBtn) {
      openLinkBtn.addEventListener("click", function() {
        const link = openLinkBtn.getAttribute("data-link");
        if (link) {
          window.open(link, "_blank");
        }
      });
    }
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    } else {
      return new Promise((resolve, reject) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (successful) {
          resolve();
        } else {
          reject(new Error("Fallback: No se pudo copiar el texto."));
        }
      });
    }
  }

  // Quitar overlay de carga al terminar
  window.addEventListener("load", () => {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.style.display = "none";
    document.body.style.display = "block";
  });
});
