// app/static/js/estadisticas.js

document.addEventListener('DOMContentLoaded', function() {
  const tabResumen = document.getElementById('tabResumen');
  const tabLista = document.getElementById('tabLista');
  const vistaResumen = document.getElementById('vistaResumen');
  const vistaLista = document.getElementById('vistaLista');
  
  if (!tabResumen || !tabLista || !vistaResumen || !vistaLista) {
    return; // Elementos no encontrados, salir temprano
  }
  
  function mostrarResumen() {
    tabResumen.classList.add('active');
    tabLista.classList.remove('active');
    vistaResumen.style.display = 'block';
    vistaLista.classList.add('hidden');
    vistaLista.style.display = 'none';
  }
  
  function mostrarLista() {
    tabResumen.classList.remove('active');
    tabLista.classList.add('active');
    vistaResumen.style.display = 'none';
    vistaLista.classList.remove('hidden');
    vistaLista.style.display = 'block';
  }
  
  tabResumen.addEventListener('click', mostrarResumen);
  tabLista.addEventListener('click', mostrarLista);
  
  // Inicializar anchos de barras de porcentaje dinámicamente
  const barras = document.querySelectorAll('.gasto-mes-bar[data-porcentaje]');
  barras.forEach(function(barra) {
    const porcentaje = barra.getAttribute('data-porcentaje');
    if (porcentaje) {
      barra.style.width = porcentaje + '%';
    }
  });
});

