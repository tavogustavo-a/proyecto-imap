function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.display = 'block';
}

// El evento `load` puede tardar (imágenes, fuentes, recursos colgados) y deja la UI bloqueada bajo el overlay.
// En cuanto el DOM está listo, la página ya es usable (especialmente admin licencias con JS pesado).
document.addEventListener('DOMContentLoaded', hideLoadingOverlay);
window.addEventListener('load', hideLoadingOverlay); 