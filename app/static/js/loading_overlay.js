window.addEventListener('load', () => {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'none';
  // Asegurarse de que el body sea visible, por si acaso estaba oculto por CSS
  document.body.style.display = 'block'; 
}); 