/**
 * Confirmaciones CSP-friendly (sin onsubmit inline) para la página Backup.
 * Uso: <form class="backup-form-confirm" data-backup-confirm-message="..." ...>
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form.backup-form-confirm[data-backup-confirm-message]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        var msg = form.getAttribute('data-backup-confirm-message');
        if (!msg || !window.confirm(msg)) {
          e.preventDefault();
        }
      });
    });
  });
})();
