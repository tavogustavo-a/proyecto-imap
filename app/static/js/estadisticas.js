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
    vistaResumen.classList.remove('estadisticas-vista-hidden');
    vistaResumen.classList.add('estadisticas-vista-visible');
    vistaLista.classList.remove('estadisticas-vista-visible');
    vistaLista.classList.add('estadisticas-vista-hidden');
  }
  
  function mostrarLista() {
    tabResumen.classList.remove('active');
    tabLista.classList.add('active');
    vistaResumen.classList.remove('estadisticas-vista-visible');
    vistaResumen.classList.add('estadisticas-vista-hidden');
    vistaLista.classList.remove('estadisticas-vista-hidden');
    vistaLista.classList.add('estadisticas-vista-visible');
  }
  
  tabResumen.addEventListener('click', mostrarResumen);
  tabLista.addEventListener('click', mostrarLista);
  
  // Aplicar anchos de barras usando CSS custom properties (CSP compliant)
  const barras = document.querySelectorAll('.gasto-mes-bar[data-porcentaje]');
  barras.forEach(function(barra) {
    const porcentaje = barra.getAttribute('data-porcentaje');
    if (porcentaje) {
      // Usar setProperty en lugar de style.width para cumplir CSP
      barra.style.setProperty('--bar-width', porcentaje + '%');
    }
  });
});

