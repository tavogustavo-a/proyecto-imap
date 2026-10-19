/* Interruptor verde/gris compartido. enabled=true queda a la derecha y en verde. */
(function () {
  function titleFor(enabled) {
    return enabled ? "Activo. Clic para desactivar" : "Inactivo. Clic para activar";
  }

  function ensureTrack(btn) {
    var track = btn.querySelector(".user-switch-track");
    if (!track) {
      btn.textContent = "";
      track = document.createElement("span");
      track.className = "user-switch-track";
      track.setAttribute("aria-hidden", "true");
      var knob = document.createElement("span");
      knob.className = "user-switch-knob";
      track.appendChild(knob);
      btn.appendChild(track);
      return;
    }
    Array.prototype.slice.call(btn.childNodes).forEach(function (node) {
      if (node !== track) btn.removeChild(node);
    });
  }

  window.paintStateSwitch = function (btn, enabled) {
    if (!btn) return;
    var keep = [];
    Array.prototype.forEach.call(btn.classList, function (cls) {
      if (cls === "user-switch" || cls === "is-on") return;
      if (cls.indexOf("toggle") !== -1 || cls === "ml-03" || cls === "mr-05") keep.push(cls);
    });
    var on = !!enabled;
    btn.className = "user-switch" + (on ? " is-on" : "") + (keep.length ? " " + keep.join(" ") : "");
    if (!btn.getAttribute("type")) btn.type = "button";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = titleFor(on);
    btn.title = label;
    btn.setAttribute("aria-label", label);
    ensureTrack(btn);
  };

  window.paintTestButtonBusy = function (btn, busy, busyLabel) {
    if (!btn) return;
    var icon = btn.querySelector("i");
    if (busy) {
      btn.classList.add("is-testing");
      btn.disabled = true;
      var label = busyLabel || "Resolviendo host...";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      if (icon) icon.className = "fas fa-spinner fa-spin";
      return;
    }
    btn.classList.remove("is-testing");
    btn.disabled = false;
    btn.title = "Probar";
    btn.setAttribute("aria-label", "Probar");
    if (icon) icon.className = "fas fa-plug";
  };

  function showImapNotice(message, kind) {
    var old = document.getElementById("imap-test-notice");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "imap-test-notice";
    box.className = "imap-test-notice " + (kind === "ok" ? "imap-test-notice--ok" : "imap-test-notice--fail");
    box.setAttribute("role", "status");
    box.textContent = message || (kind === "ok" ? "Conexión correcta." : "No se pudo probar el servidor.");
    document.body.appendChild(box);
    setTimeout(function () {
      if (box.parentNode) box.remove();
    }, kind === "ok" ? 2800 : 4200);
  }

  window.alertImapTestResult = function (ok, message) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showImapNotice("No tienes internet. Prueba nuevamente.", "fail");
      return;
    }
    if (ok) {
      showImapNotice(message || "Conexión correcta.", "ok");
      return;
    }
    showImapNotice(message || "No se pudo probar el servidor. Prueba nuevamente.", "fail");
  };

  window.alertImapTestOffline = function () {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showImapNotice("No tienes internet. Prueba nuevamente.", "fail");
      return;
    }
    showImapNotice("Se fue la conexión. Prueba nuevamente.", "fail");
  };

  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) window.location.reload();
  });

  window.stateSwitchHtml = function (enabled, extraClass, attrs) {
    var on = !!enabled;
    var label = titleFor(on);
    var cls = "user-switch " + (extraClass || "") + (on ? " is-on" : "");
    return (
      '<button type="button" class="' + cls.trim() + '" aria-pressed="' + (on ? "true" : "false") +
      '" title="' + label + '" aria-label="' + label + '" ' + (attrs || "") +
      '><span class="user-switch-track" aria-hidden="true"><span class="user-switch-knob"></span></span></button>'
    );
  };
})();
