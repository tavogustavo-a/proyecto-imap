/**
 * fetch JSON con comprobación de res.ok y manejo básico de 401.
 */
(function (global) {
  'use strict';

  function fetchJson(url, options) {
    options = options || {};
    var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    var init = {
      method: options.method || 'GET',
      credentials:
        options.credentials != null ? options.credentials : 'same-origin',
      headers: headers,
    };
    if (options.body != null) {
      init.body = options.body;
    }

    return global.fetch(url, init).then(function (res) {
      if (res.status === 401) {
        try {
          global.dispatchEvent(new CustomEvent('store-fetch-unauthorized'));
        } catch (_ev) {}
        var unauthorized = new Error('Sesión expirada o sin acceso.');
        unauthorized.status = 401;
        throw unauthorized;
      }

      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (data) {
          if (!res.ok) {
            var msg =
              (data && (data.message || data.error)) ||
              'Error HTTP ' + res.status;
            var httpErr = new Error(String(msg));
            httpErr.status = res.status;
            httpErr.data = data;
            throw httpErr;
          }
          return data;
        });
    });
  }

  global.StoreFetchJson = {
    fetch: fetchJson,
  };

  var _unauthorizedReloadPending = false;
  global.addEventListener('store-fetch-unauthorized', function () {
    if (_unauthorizedReloadPending) return;
    _unauthorizedReloadPending = true;
    try {
      var path = global.location && global.location.pathname ? global.location.pathname : '';
      if (path.indexOf('/tienda') === 0 || path.indexOf('/admin') === 0) {
        global.setTimeout(function () {
          global.location.reload();
        }, 400);
      }
    } catch (_e) {}
  });
})(window);
