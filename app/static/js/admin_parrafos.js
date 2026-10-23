// Guardar y alternar modo de párrafos sin recargar la página
document.addEventListener("DOMContentLoaded", function () {
  const shell = document.querySelector(".parrafos-page-shell");
  if (!shell) return;

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  function showFlash(message, category) {
    const container = document.querySelector(".container");
    if (!container || !message) return;
    const el = document.createElement("div");
    el.className = "flash-message " + (category || "info");
    el.textContent = message;
    container.insertBefore(el, container.firstChild);
    window.setTimeout(function () {
      el.remove();
    }, 4000);
  }

  function postFormAjax(url, formData) {
    return fetch(url, {
      method: "POST",
      body: formData,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          const err = new Error((data && data.error) || "Error en la solicitud");
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function setButtonBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    btn.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function applyCycleButtonState(btn, buttonClass, buttonText) {
    if (!btn) return;
    btn.classList.remove("btn-blue", "btn-red", "btn-green");
    if (buttonClass) btn.classList.add(buttonClass);
    btn.textContent = buttonText || btn.textContent;
  }

  ["saveMsgForm1", "saveMsgForm2"].forEach(function (formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const saveBtn = shell.querySelector(
        'button.paragraph-save-btn[form="' + formId + '"]'
      );
      setButtonBusy(saveBtn, true);
      postFormAjax(form.action, new FormData(form))
        .then(function (data) {
          showFlash(data.message || "Guardado.", "success");
        })
        .catch(function (err) {
          showFlash(
            (err.data && err.data.error) || err.message || "No se pudo guardar.",
            "error"
          );
        })
        .finally(function () {
          setButtonBusy(saveBtn, false);
        });
    });
  });

  shell.querySelectorAll(".cycle-paragraph-mode-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const url = btn.getAttribute("data-cycle-url");
      if (!url) return;
      const fd = new FormData();
      fd.append("_csrf_token", getCsrfToken());
      setButtonBusy(btn, true);
      postFormAjax(url, fd)
        .then(function (data) {
          applyCycleButtonState(btn, data.button_class, data.button_text);
        })
        .catch(function (err) {
          showFlash(
            (err.data && err.data.error) || err.message || "No se pudo cambiar el modo.",
            "error"
          );
        })
        .finally(function () {
          setButtonBusy(btn, false);
        });
    });
  });
});
