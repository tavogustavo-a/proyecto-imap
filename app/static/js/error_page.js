(function () {
  function retryNow() {
    var url = window.location.href.split('#')[0];
    // Quitar un _retry previo y forzar navegación de red (evita quedarse en la vista offline del SW).
    url = url.replace(/([?&])_retry=\d+/g, '$1').replace(/[?&]$/, '');
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    window.location.replace(url + sep + '_retry=' + Date.now());
  }

  var retry = document.getElementById('errRetryBtn');
  if (!retry) return;

  retry.addEventListener('click', function (e) {
    // Si es un <a> o <button> dentro de form, igual forzamos recarga con bypass de caché.
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    retryNow();
  });
})();
