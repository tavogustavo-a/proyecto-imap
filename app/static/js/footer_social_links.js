(function () {
  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function wireFooterSocialLinksModal() {
    var openBtn = document.getElementById("footerSocialLinksBtn");
    var modal = document.getElementById("footerSocialLinksModal");
    var closeBtn = document.getElementById("closeFooterSocialLinksModalBtn");
    var saveBtn = document.getElementById("saveFooterSocialLinksBtn");
    var waInput = document.getElementById("footerWhatsappUrlInput");
    var tgInput = document.getElementById("footerTelegramUrlInput");
    var androidInput = document.getElementById("footerAndroidUrlInput");
    var iosInput = document.getElementById("footerIosUrlInput");
    var msgEl = document.getElementById("footerSocialLinksMsg");
    if (!openBtn || !modal || !saveBtn || !waInput || !tgInput || !androidInput || !iosInput) return;

    function setMsg(text, isError) {
      if (!msgEl) return;
      if (!text) {
        msgEl.hidden = true;
        msgEl.textContent = "";
        return;
      }
      msgEl.hidden = false;
      msgEl.textContent = text;
      msgEl.style.color = isError ? "#b91c1c" : "#166534";
    }

    function openModal() {
      setMsg("");
      modal.classList.remove("popup-hide");
      modal.classList.add("popup-show");
      modal.hidden = false;
      fetch("/admin/api/footer-social-links", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          return r.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          if (!data || !data.success) return;
          waInput.value = data.whatsapp_url || "";
          tgInput.value = data.telegram_url || "";
          androidInput.value = data.android_url || "";
          iosInput.value = data.ios_url || "";
        })
        .catch(function () {});
      try {
        tgInput.focus();
      } catch (_e) {}
    }

    function closeModal() {
      modal.classList.remove("popup-show");
      modal.classList.add("popup-hide");
      modal.hidden = true;
      setMsg("");
    }

    openBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      openModal();
    });
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    saveBtn.addEventListener("click", function () {
      saveBtn.disabled = true;
      setMsg("");
      fetch("/admin/api/footer-social-links", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify({
          whatsapp_url: waInput.value || "",
          telegram_url: tgInput.value || "",
          android_url: androidInput.value || "",
          ios_url: iosInput.value || "",
        }),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { success: false, message: "Respuesta inválida" };
          });
        })
        .then(function (data) {
          if (!data || !data.success) {
            setMsg((data && data.message) || "No se pudo guardar.", true);
            return;
          }
          waInput.value = data.whatsapp_url || "";
          tgInput.value = data.telegram_url || "";
          androidInput.value = data.android_url || "";
          iosInput.value = data.ios_url || "";
          setMsg(data.message || "Guardado.", false);
          window.setTimeout(function () {
            window.location.reload();
          }, 500);
        })
        .catch(function () {
          setMsg("Error de red al guardar.", true);
        })
        .finally(function () {
          saveBtn.disabled = false;
        });
    });

    document.addEventListener("mousedown", function (e) {
      if (!modal.classList.contains("popup-show")) return;
      if (modal.contains(e.target) || e.target.closest("#footerSocialLinksBtn")) return;
      closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("popup-show")) closeModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireFooterSocialLinksModal);
  } else {
    wireFooterSocialLinksModal();
  }
})();
