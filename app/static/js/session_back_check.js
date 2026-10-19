/* La app móvil y el navegador pueden mostrar con Atrás una página ya cerrada,
   sin pedirla otra vez al servidor. Si vuelve del historial, se recarga para
   que el servidor compruebe si la sesión sigue válida. */
(function () {
  window.addEventListener('pageshow', function (event) {
    var nav = null;
    try {
      nav = performance.getEntriesByType('navigation')[0];
    } catch (e) {
      nav = null;
    }
    var fromHistory = event.persisted || (nav && nav.type === 'back_forward');
    if (fromHistory) {
      window.location.reload();
    }
  });
})();
