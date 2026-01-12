// app/static/js/search_imap2_dynamic.js
// Validación para páginas dinámicas de IMAP2

(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    const ajaxSearchForm = document.getElementById('ajax-search-form');
    
    if (!ajaxSearchForm) {
      return;
    }
    
    const imapServerId = ajaxSearchForm.getAttribute("data-imap-server-id");
    
    // Validar que imapServerId existe y es válido
    if (!imapServerId || imapServerId === "0" || imapServerId === "" || isNaN(parseInt(imapServerId))) {
      alert("Error: No se pudo identificar el servidor IMAP. Por favor, recarga la página.");
      return;
    }
    
    // main.js detectará automáticamente el atributo y usará el endpoint correcto
  });
})();
