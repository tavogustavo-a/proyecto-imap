// app/static/js/manage_my_page.js
// Gestión de página del usuario

(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    const saveParagraphForm = document.getElementById('saveParagraphForm');
    
    if (saveParagraphForm) {
      saveParagraphForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = new FormData(saveParagraphForm);
        const submitBtn = saveParagraphForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
        
        fetch(saveParagraphForm.action, {
          method: 'POST',
          body: formData,
          headers: {
            'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').content
          }
        })
        .then(response => {
          if (response.redirected) {
            window.location.href = response.url;
          } else {
            return response.json();
          }
        })
        .then(data => {
          if (data && data.status === 'ok') {
            alert('Párrafo guardado correctamente');
          }
        })
        .catch(err => {
          alert('Error al guardar: ' + err.message);
        })
        .finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        });
      });
    }
  });
})();
