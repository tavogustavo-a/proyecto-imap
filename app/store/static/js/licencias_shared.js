/**
 * Constantes y utilidades compartidas del módulo Admin Licencias.
 */
var AGGREGATE_LICENSE_ID = 0;
var MAX_HEAVY_NOTEPAD_CHARS = 200000;
var ADMIN_LICENCIAS_CHANGES_LIST_MODE_KEY = 'admin_licencias_changes_list_mode_v1';
var CHANGES_LIST_MODE_ONLY = 'only_with_lines';
var CHANGES_LIST_MODE_ALL = 'all_month_to_month';
var ADMIN_LICENCIAS_SIDEBAR_MODE_KEY = 'adminLicenciasSidebarMode';
/** Cache bust del módulo: ver LICENCIAS_STATIC_VERSION en routes.py (plantillas ?v=). */
var LICENSES_FETCH_TIMEOUT_MS = 28000;
/** Umbral orientativo: por encima conviene paginación o carga por producto. */
var LICENSES_LOAD_WARN_ACCOUNTS = 2500;
var LICENSES_INCLUDE_ACCOUNTS_ALL = 'all';
var LICENSES_INCLUDE_ACCOUNTS_NONE = 'none';
var LICENSES_INCLUDE_ACCOUNTS_SELECTED = 'selected';

function adminLicGetActiveLicenseIdForFetch() {
  try {
    var ic = document.getElementById('licenseAccountsInputContainer');
    if (!ic || ic.classList.contains('d-none')) return null;
    var raw = ic.dataset.activeLicenseId;
    if (raw == null || raw === '') return null;
    var id = parseInt(raw, 10);
    if (!Number.isFinite(id) || id === AGGREGATE_LICENSE_ID || id <= 0) return null;
    return id;
  } catch (_e) {
    return null;
  }
}

function adminLicAdminStoreSearchActive() {
  try {
    var si = document.getElementById('adminStoreSearch');
    return !!(si && String(si.value || '').trim());
  } catch (_e2) {
    return false;
  }
}

function adminLicResolveLicensesIncludeMode(options) {
  options = options || {};
  if (window.IS_ARCHIVED_MODE) {
    return { mode: LICENSES_INCLUDE_ACCOUNTS_ALL, licenseIds: [] };
  }
  if (options.includeAccounts) {
    var ids = Array.isArray(options.licenseIds) ? options.licenseIds.slice() : [];
    if (
      options.includeAccounts === LICENSES_INCLUDE_ACCOUNTS_SELECTED &&
      !ids.length
    ) {
      var activeExplicit = adminLicGetActiveLicenseIdForFetch();
      if (activeExplicit != null) ids = [activeExplicit];
    }
    return { mode: options.includeAccounts, licenseIds: ids };
  }
  if (adminLicAdminStoreSearchActive()) {
    return { mode: LICENSES_INCLUDE_ACCOUNTS_ALL, licenseIds: [] };
  }
  var activeId = adminLicGetActiveLicenseIdForFetch();
  if (activeId != null) {
    return { mode: LICENSES_INCLUDE_ACCOUNTS_SELECTED, licenseIds: [activeId] };
  }
  return { mode: LICENSES_INCLUDE_ACCOUNTS_NONE, licenseIds: [] };
}

function adminLicBuildLicensesFetchUrl(includeMode) {
  var endpoint = window.IS_ARCHIVED_MODE
    ? '/tienda/api/licenses/archived'
    : '/tienda/api/licenses';
  var params = ['_t=' + Date.now()];
  if (!window.IS_ARCHIVED_MODE && includeMode && includeMode.mode) {
    params.push('include_accounts=' + encodeURIComponent(includeMode.mode));
    if (
      includeMode.mode === LICENSES_INCLUDE_ACCOUNTS_SELECTED &&
      includeMode.licenseIds &&
      includeMode.licenseIds.length
    ) {
      var csv = includeMode.licenseIds
        .map(function (id) {
          return parseInt(id, 10);
        })
        .filter(function (id) {
          return Number.isFinite(id) && id > 0;
        })
        .join(',');
      if (csv) {
        params.push('license_ids=' + encodeURIComponent(csv));
      }
    }
  }
  var sep = endpoint.indexOf('?') === -1 ? '?' : '&';
  return endpoint + sep + params.join('&');
}

function adminLicMergeLicensesFromApi(prevList, incomingList, mode, selectedIds) {
  var prevById = {};
  (prevList || []).forEach(function (l) {
    if (l && l.id != null) prevById[l.id] = l;
  });
  var selectedSet = new Set(
    (selectedIds || [])
      .map(function (id) {
        return parseInt(id, 10);
      })
      .filter(function (id) {
        return Number.isFinite(id) && id > 0;
      })
  );
  return (incomingList || []).map(function (inc) {
    var prev = prevById[inc.id];
    var merged = Object.assign({}, inc);
    if (mode === LICENSES_INCLUDE_ACCOUNTS_ALL) {
      return merged;
    }
    if (mode === LICENSES_INCLUDE_ACCOUNTS_SELECTED) {
      if (selectedSet.has(inc.id)) {
        return merged;
      }
      if (prev && Array.isArray(prev.accounts) && prev.accounts.length > 0) {
        merged.accounts = prev.accounts.slice();
      } else {
        merged.accounts = [];
      }
      return merged;
    }
    if (prev && Array.isArray(prev.accounts) && prev.accounts.length > 0) {
      merged.accounts = prev.accounts.slice();
    } else {
      merged.accounts = [];
    }
    return merged;
  });
}

function adminLicWarnHeavyLicensePayload(data, includeMode) {
  if (!data || !includeMode || includeMode.mode !== LICENSES_INCLUDE_ACCOUNTS_ALL) return;
  var stats = data.stats || {};
  var total = parseInt(stats.total_accounts, 10);
  if (!Number.isFinite(total) || total < LICENSES_LOAD_WARN_ACCOUNTS) return;
  adminLicLogWarn(
    'Carga completa de cuentas (' +
      total +
      '). Con mucho inventario conviene mantener la búsqueda acotada o abrir un producto a la vez.'
  );
}

function adminLicDebugEnabled() {
  try {
    if (window.ADMIN_LIC_DEBUG === true) return true;
    if (
      typeof window.location !== 'undefined' &&
      window.location.search.indexOf('admin_lic_debug=1') !== -1
    ) {
      return true;
    }
  } catch (_e) {}
  return false;
}

/** Solo en depuración (?admin_lic_debug=1 o window.ADMIN_LIC_DEBUG = true). */
function adminLicLogError(context, err) {
  if (!adminLicDebugEnabled()) return;
  if (arguments.length > 1) {
    console.error('[Licencias]', context, err);
  } else {
    console.error('[Licencias]', context);
  }
}

/** Solo en depuración. */
function adminLicLogWarn(context, err) {
  if (!adminLicDebugEnabled()) return;
  if (arguments.length > 1) {
    console.warn('[Licencias]', context, err);
  } else {
    console.warn('[Licencias]', context);
  }
}

function getCSRFToken() {
  var meta = document.querySelector('meta[name="csrf_token"]');
  if (meta && meta.getAttribute('content')) {
    return meta.getAttribute('content');
  }
  var match = document.cookie ? document.cookie.match(/(?:^|;\s*)_csrf=([^;]+)/) : null;
  return match ? decodeURIComponent(match[1]) : '';
}

function adminLicMethodNeedsCsrf(method) {
  var m = String(method || 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

function adminLicNormalizeFetchError(err, fallbackMessage) {
  if (!err || typeof err !== 'object') {
    return new Error(fallbackMessage || 'Error de conexión');
  }
  if (err.csrfMissing || err.csrfFailure) {
    return err;
  }
  var status = err.status;
  var data = err.data;
  var raw = String(err.message || '');
  var serverMsg = data && (data.error || data.message || data.description);
  if (
    status === 400 &&
    (/csrf|seasurf|token/i.test(raw) ||
      (serverMsg && /csrf|seasurf|token/i.test(String(serverMsg))))
  ) {
    err.message = 'Sesión de seguridad expirada. Recarga la página (F5) e intenta guardar de nuevo.';
    err.csrfFailure = true;
    return err;
  }
  if (status === 400 && !getCSRFToken()) {
    err.message = 'No se pudo validar la sesión. Recarga la página e intenta de nuevo.';
    err.csrfMissing = true;
    return err;
  }
  if (!err.message && fallbackMessage) {
    err.message = fallbackMessage;
  }
  return err;
}

function adminLicFormatFetchError(err, fallbackMessage) {
  var normalized = adminLicNormalizeFetchError(err, fallbackMessage);
  return normalized && normalized.message
    ? String(normalized.message)
    : fallbackMessage || 'Error de conexión';
}

async function adminLicFetchJsonFallback(url, options) {
  options = options || {};
  var method = options.method || 'GET';
  var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  if (adminLicMethodNeedsCsrf(method)) {
    var csrf = getCSRFToken();
    if (csrf) {
      headers['X-CSRFToken'] = csrf;
    }
  }
  var init = {
    method: method,
    credentials: options.credentials != null ? options.credentials : 'same-origin',
    headers: headers,
  };
  if (options.body != null) {
    init.body = options.body;
  }
  if (options.signal != null) {
    init.signal = options.signal;
  }
  if (options.cache != null) {
    init.cache = options.cache;
  }
  var response = await fetch(url, init);
  if (response.status === 401) {
    try {
      window.dispatchEvent(new CustomEvent('store-fetch-unauthorized'));
    } catch (_ev) {}
    var unauthorized = new Error('Sesión expirada o sin acceso.');
    unauthorized.status = 401;
    throw unauthorized;
  }
  var data = null;
  try {
    data = await response.json();
  } catch (_json) {
    if (response.status === 400) {
      var csrfErr = new Error(
        'Sesión de seguridad expirada. Recarga la página (F5) e intenta guardar de nuevo.'
      );
      csrfErr.status = 400;
      csrfErr.csrfFailure = true;
      throw csrfErr;
    }
    var parseErr = new Error('Error de conexión con el servidor.');
    parseErr.status = response.status;
    throw parseErr;
  }
  if (!response.ok) {
    var httpErr = new Error(
      (data && (data.message || data.error)) || 'Error HTTP ' + response.status
    );
    httpErr.status = response.status;
    httpErr.data = data;
    throw adminLicNormalizeFetchError(httpErr);
  }
  return data;
}

async function adminLicFetchJson(url, options) {
  options = options || {};
  var method = String(options.method || 'GET').toUpperCase();
  if (adminLicMethodNeedsCsrf(method) && !getCSRFToken()) {
    var missing = new Error(
      'No se pudo validar la sesión (CSRF). Recarga la página (F5) e intenta de nuevo.'
    );
    missing.status = 0;
    missing.csrfMissing = true;
    throw missing;
  }
  try {
    if (window.StoreFetchJson && window.StoreFetchJson.fetch) {
      return await window.StoreFetchJson.fetch(url, options);
    }
    return await adminLicFetchJsonFallback(url, options);
  } catch (err) {
    throw adminLicNormalizeFetchError(err);
  }
}

async function adminLicSafeJson(response, fallbackMessage) {
  var data = null;
  try {
    data = await response.json();
  } catch (_json) {
    if (response.status === 400) {
      throw adminLicNormalizeFetchError(
        new Error(
          'Sesión de seguridad expirada. Recarga la página (F5) e intenta guardar de nuevo.'
        )
      );
    }
    throw new Error(fallbackMessage || 'Error de conexión');
  }
  if (!response.ok) {
    var httpErr = new Error(
      (data && (data.message || data.error)) || fallbackMessage || 'Error HTTP ' + response.status
    );
    httpErr.status = response.status;
    httpErr.data = data;
    throw adminLicNormalizeFetchError(httpErr, fallbackMessage);
  }
  return data;
}

(function adminLicInstallMutationFetchGuard() {
  if (typeof window === 'undefined' || window.__adminLicMutationFetchGuard) {
    return;
  }
  window.__adminLicMutationFetchGuard = true;
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function adminLicGuardedFetch(url, options) {
    options = options || {};
    var method = String(options.method || 'GET').toUpperCase();
    var urlStr = String(url);
    if (adminLicMethodNeedsCsrf(method) && urlStr.indexOf('/tienda/api/') !== -1) {
      var headers = Object.assign({}, options.headers || {});
      if (!headers['X-CSRFToken'] && !headers['x-csrftoken']) {
        var csrf = getCSRFToken();
        if (csrf) {
          headers['X-CSRFToken'] = csrf;
        }
      }
      options = Object.assign({}, options, { headers: headers });
    }
    return nativeFetch(url, options);
  };
})();
