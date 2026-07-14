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

/** Licencia guardada en localStorage antes de que el panel esté visible (recarga F5). */
function adminLicGetStoredSelectedLicenseId() {
  try {
    var raw = localStorage.getItem('selectedLicenseId');
    if (raw == null || raw === '') return null;
    var id = parseInt(raw, 10);
    if (!Number.isFinite(id) || id === AGGREGATE_LICENSE_ID || id <= 0) return null;
    return id;
  } catch (_eStore) {
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
  if (activeId == null) {
    activeId = adminLicGetStoredSelectedLicenseId();
  }
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

/** true mientras se recarga/cierra la pestaña (evita alertas «Failed to fetch» falsas). */
function adminLicMarkPageUnloading() {
  if (typeof window !== 'undefined') {
    window.__adminLicPageUnloading = true;
  }
}

function adminLicIsIgnorableFetchError(err) {
  if (typeof window !== 'undefined' && window.__adminLicPageUnloading) {
    return true;
  }
  if (!err) return false;
  if (typeof err === 'string') {
    err = { message: err };
  }
  if (err.name === 'AbortError') return true;
  var msg = String(err.message || '').trim().toLowerCase();
  if (
    msg === 'failed to fetch' ||
    msg === 'networkerror when attempting to fetch resource.' ||
    msg.indexOf('networkerror') === 0
  ) {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return true;
    }
  }
  return false;
}

if (typeof window !== 'undefined' && !window.__adminLicPageLifecycleHook) {
  window.__adminLicPageLifecycleHook = true;
  window.__adminLicPageUnloading = false;
  window.addEventListener('beforeunload', adminLicMarkPageUnloading);
  window.addEventListener('pagehide', adminLicMarkPageUnloading);
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

/** Enfocar sin desplazar la ventana (evita el «salto» al centro en primer clic). */
function licenseSplitFocusElNoScroll(el) {
  if (!el || typeof el.focus !== 'function') return;
  try {
    el.focus({ preventScroll: true });
  } catch (_e) {
    try {
      el.focus();
    } catch (_e2) {}
  }
}

/** Coloca el cursor en el textarea según las coordenadas del clic. */
function licenseSplitFocusTextareaAtPoint(ta, ev) {
  if (!ta) return;
  licenseSplitFocusElNoScroll(ta);
  if (typeof ta.setSelectionRange !== 'function' || !ev) return;
  try {
    var doc = ta.ownerDocument || document;
    if (typeof doc.caretPositionFromPoint === 'function') {
      var pos = doc.caretPositionFromPoint(ev.clientX, ev.clientY);
      if (pos && pos.offsetNode === ta) {
        ta.setSelectionRange(pos.offset, pos.offset);
        return;
      }
    }
    if (typeof doc.caretRangeFromPoint === 'function') {
      var range = doc.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (range && range.startContainer === ta) {
        ta.setSelectionRange(range.startOffset, range.startOffset);
        return;
      }
    }
    var value = ta.value || '';
    var rect = ta.getBoundingClientRect();
    var style = window.getComputedStyle(ta);
    var lineH = parseFloat(style.lineHeight);
    if (!Number.isFinite(lineH) || lineH <= 0) {
      lineH = (parseFloat(style.fontSize) || 14) * 1.45;
    }
    var padT = parseFloat(style.paddingTop) || 0;
    var padL = parseFloat(style.paddingLeft) || 0;
    var lineIdx = Math.floor((ev.clientY - rect.top + ta.scrollTop - padT) / lineH);
    lineIdx = Math.max(0, lineIdx);
    var lines = value.split('\n');
    var off = 0;
    var i;
    for (i = 0; i < lineIdx && i < lines.length; i++) {
      off += lines[i].length + 1;
    }
    if (lineIdx >= lines.length) {
      off = value.length;
    } else {
      var charW = (parseFloat(style.fontSize) || 14) * 0.55;
      var col = Math.floor((ev.clientX - rect.left + ta.scrollLeft - padL) / charW);
      off += Math.min(lines[lineIdx].length, Math.max(0, col));
    }
    off = Math.max(0, Math.min(value.length, off));
    ta.setSelectionRange(off, off);
  } catch (_e3) {}
}

var LICENSE_SPLIT_NATIVE_CLICK_SEL =
  '.license-split-editor__restore-to-license-btn, .license-split-editor__sell-btn, .admin-lic-admin-warranty-btn, .user-lic-expiry-countdown, .user-lic-expiry-stepper, .license-split-editor__user-suggestions';

var LICENSE_SPLIT_FIELD_SEL =
  '.license-split-editor__user, .license-split-editor__status-good, .license-split-editor__status-bad, .license-split-editor__otro-combined, .license-split-editor__note, .license-split-editor__day-num, .user-lic-note-client, .admin-lic-proveedor-service-select, .admin-lic-proveedor-extra-day-input, .admin-lic-proveedor-sold-day-input, .user-lic-proveedor-service-select';

function licenseSplitQueryCredsTa(root) {
  if (!root || !root.querySelector) return null;
  return (
    root.querySelector('.day-license-split__creds') ||
    root.querySelector('.admin-lic-proveedor-creds-ta') ||
    root.querySelector('.user-lic-proveedor-creds-ta') ||
    root.querySelector('.user-lic-proveedor-extra-creds') ||
    root.querySelector('.suspended-license-split__creds') ||
    root.querySelector('.expired-license-split__creds') ||
    root.querySelector('.license-split-editor__creds')
  );
}

function licenseSplitCredsTaIsReadonlyPortal(ta, root) {
  if (!ta) return false;
  if (ta.classList.contains('user-lic-creds-ro')) return true;
  if (ta.getAttribute('aria-readonly') === 'true') return true;
  if (root && root.id === 'adminLicenciasCustomerRenewalSplitRoot') return true;
  if (root && root.classList.contains('license-split-editor--proveedor-readonly')) return true;
  return false;
}

function licenseSplitGenericLock(root) {
  if (!root) return;
  var ta = licenseSplitQueryCredsTa(root);
  var skipCreds = licenseSplitCredsTaIsReadonlyPortal(ta, root);
  if (ta && !skipCreds) {
    ta.readOnly = true;
    ta.setAttribute('tabindex', '-1');
  }
  root.classList.add('license-notepad--locked');
  root.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
    if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
    if (x.classList.contains('user-lic-note-client')) return;
    x.readOnly = true;
    x.tabIndex = -1;
  });
  root.querySelectorAll('.license-split-editor__row select').forEach(function (x) {
    x.disabled = false;
    x.tabIndex = -1;
  });
  root.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
    b.disabled = false;
    b.tabIndex = -1;
  });
}

function licenseSplitGenericUnlock(root) {
  if (!root) return;
  var ta = licenseSplitQueryCredsTa(root);
  var skipCreds = licenseSplitCredsTaIsReadonlyPortal(ta, root);
  if (ta && !skipCreds) {
    ta.readOnly = false;
    ta.removeAttribute('tabindex');
  }
  root.classList.remove('license-notepad--locked');
  root.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
    if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
    x.readOnly = false;
    x.removeAttribute('tabindex');
  });
  root.querySelectorAll('.license-split-editor__row select').forEach(function (x) {
    x.removeAttribute('tabindex');
  });
  root.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
    b.removeAttribute('tabindex');
  });
}

function licenseSplitUnlockRoot(root) {
  if (!root) return;
  var ta = licenseSplitQueryCredsTa(root);
  if (root.id === 'adminLicenciasLicenseSplitRoot') {
    licenseSplitGenericUnlock(root);
    return;
  }
  if (root.id === 'adminLicenciasCustomerRenewalSplitRoot' && typeof customerRenewalLicenseSplitUnlock === 'function') {
    customerRenewalLicenseSplitUnlock(root);
    return;
  }
  if (
    root.classList.contains('day-license-split-root') &&
    !root.classList.contains('admin-lic-proveedor-sold-split') &&
    typeof dayLicenseSplitUnlock === 'function'
  ) {
    dayLicenseSplitUnlock(root);
    return;
  }
  if (root.classList.contains('suspended-license-split-root') && typeof suspendedLicenseSplitUnlock === 'function') {
    suspendedLicenseSplitUnlock(root);
    return;
  }
  if (root.classList.contains('expired-license-split-root') && typeof expiredLicenseSplitUnlock === 'function') {
    expiredLicenseSplitUnlock(root);
    return;
  }
  if (root.classList.contains('changes-license-split-root') && typeof changesLicenseSplitUnlock === 'function') {
    changesLicenseSplitUnlock(root);
    return;
  }
  licenseSplitGenericUnlock(root);
}

function licenseSplitLockRoot(root) {
  if (!root) return;
  if (root.id === 'adminLicenciasLicenseSplitRoot') {
    licenseSplitGenericLock(root);
    return;
  }
  if (root.id === 'adminLicenciasCustomerRenewalSplitRoot' && typeof customerRenewalLicenseSplitLock === 'function') {
    customerRenewalLicenseSplitLock(root);
    return;
  }
  if (
    root.classList.contains('day-license-split-root') &&
    !root.classList.contains('admin-lic-proveedor-sold-split') &&
    typeof dayLicenseSplitLock === 'function'
  ) {
    dayLicenseSplitLock(root);
    return;
  }
  if (root.classList.contains('suspended-license-split-root') && typeof suspendedLicenseSplitLock === 'function') {
    suspendedLicenseSplitLock(root);
    return;
  }
  if (root.classList.contains('expired-license-split-root') && typeof expiredLicenseSplitLock === 'function') {
    expiredLicenseSplitLock(root);
    return;
  }
  if (root.classList.contains('changes-license-split-root') && typeof changesLicenseSplitLock === 'function') {
    changesLicenseSplitLock(root);
    return;
  }
  licenseSplitGenericLock(root);
}

/** Resuelve el objetivo de foco tras desbloquear un split editor. */
function licenseSplitPlanLockedMousedown(e, ta, root) {
  if (!e || !e.target) return { mode: 'none' };
  var t = e.target;

  if (t.closest && t.closest(LICENSE_SPLIT_NATIVE_CLICK_SEL)) {
    return { mode: 'native' };
  }

  var cell = t.closest && t.closest(LICENSE_SPLIT_FIELD_SEL);
  if (!cell) {
    var shell = t.closest && t.closest('.license-split-editor__status-select-shell');
    if (shell) {
      var sel = shell.querySelector('select');
      if (sel) {
        return { mode: 'native', el: sel };
      }
    }
  }
  if (!cell) {
    var uw = t.closest && t.closest('.license-split-editor__user-wrap');
    if (uw) cell = uw.querySelector('.license-split-editor__user');
  }
  if (!cell) {
    var sw = t.closest && t.closest('.license-split-editor__status-wrap');
    if (sw) {
      cell =
        sw.querySelector('select.license-split-editor__status-good') ||
        sw.querySelector('select.license-split-editor__status-bad') ||
        sw.querySelector('.admin-lic-proveedor-service-select') ||
        sw.querySelector('.user-lic-proveedor-service-select') ||
        sw.querySelector('.license-split-editor__otro-combined:not([hidden])');
      if (cell && cell.tagName === 'SELECT') {
        return { mode: 'native', el: cell };
      }
    }
  }
  if (!cell) {
    var provRow = t.closest && t.closest('.admin-lic-proveedor-service-row, .admin-lic-proveedor-sold-row, .admin-lic-proveedor-extra-row');
    if (provRow) {
      cell =
        provRow.querySelector('.admin-lic-proveedor-service-select') ||
        provRow.querySelector('.admin-lic-proveedor-sold-day-input') ||
        provRow.querySelector('.admin-lic-proveedor-extra-day-input') ||
        provRow.querySelector('.license-split-editor__day-num');
    }
  }
  if (!cell) {
    var row = t.closest && t.closest('.license-split-editor__row');
    if (row && t.closest && t.closest('.license-split-editor__side')) {
      var note = row.querySelector('.license-split-editor__note');
      if (note && note.getBoundingClientRect) {
        var nr = note.getBoundingClientRect();
        if (e.clientX >= nr.left && e.clientX <= nr.right && e.clientY >= nr.top && e.clientY <= nr.bottom) {
          cell = note;
        }
      }
      if (!cell) {
        cell =
          row.querySelector('.user-lic-note-client') ||
          row.querySelector('.license-split-editor__user');
      }
    }
  }

  if (cell) {
    if (cell.tagName === 'SELECT') {
      return { mode: 'native', el: cell };
    }
    return { mode: 'focus', el: cell };
  }

  var inCreds = ta && (t === ta || (t.closest && t.closest('.license-split-editor__creds-cell')));
  if (inCreds) {
    if (licenseSplitCredsTaIsReadonlyPortal(ta, root)) {
      return { mode: 'none' };
    }
    return { mode: 'creds', el: ta };
  }

  var inSide = t.closest && t.closest('.license-split-editor__side');
  if (inSide) {
    var sideRow = t.closest && t.closest('.license-split-editor__row');
    if (sideRow) {
      var sideNote =
        sideRow.querySelector('.user-lic-note-client') || sideRow.querySelector('.license-split-editor__note');
      if (sideNote) return { mode: 'focus', el: sideNote };
    }
    return { mode: 'none' };
  }

  return { mode: 'none' };
}

/**
 * Primer clic en split bloqueado: desbloquea y enfoca el campo clicado (un solo gesto).
 * @returns {boolean} true si el evento fue manejado
 */
function licenseSplitHandleLockedMousedown(e, ta, unlockFn, root) {
  var inCreds =
    ta &&
    (e.target === ta || (e.target.closest && e.target.closest('.license-split-editor__creds-cell')));
  var inSide = e.target.closest && e.target.closest('.license-split-editor__side');
  if (!inCreds && !inSide) return false;

  var plan = licenseSplitPlanLockedMousedown(e, ta, root);
  if (typeof unlockFn === 'function') {
    unlockFn();
  }

  if (plan.mode === 'native') {
    return true;
  }
  if (plan.mode === 'none') {
    return true;
  }

  e.preventDefault();
  if (plan.mode === 'creds') {
    licenseSplitFocusTextareaAtPoint(plan.el, e);
  } else if (plan.mode === 'focus') {
    licenseSplitFocusElNoScroll(plan.el);
  }
  return true;
}

function licenseSplitInstallLockedClickDelegateOnce() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.licenseSplitLockedClickDelegate === '1') return;
  document.documentElement.dataset.licenseSplitLockedClickDelegate = '1';

  document.addEventListener(
    'mousedown',
    function (ev) {
      var root =
        ev.target.closest &&
        ev.target.closest('.license-split-editor.license-notepad--locked');
      if (!root) return;
      var ta = licenseSplitQueryCredsTa(root);
      licenseSplitHandleLockedMousedown(ev, ta, function () {
        licenseSplitUnlockRoot(root);
      }, root);
    },
    true
  );
}

function licenseSplitInstallProveedorFocusoutRelockOnce() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.licenseSplitProveedorFocusoutRelock === '1') return;
  document.documentElement.dataset.licenseSplitProveedorFocusoutRelock = '1';

  document.addEventListener(
    'focusout',
    function () {
      window.setTimeout(function () {
        var active = document.activeElement;
        document
          .querySelectorAll(
            '.admin-lic-proveedor-split, .admin-lic-proveedor-sold-split, .admin-lic-proveedor-extra-split, .user-lic-proveedor-split, .user-lic-proveedor-extra-split--editable'
          )
          .forEach(function (root) {
            if (root.classList.contains('license-notepad--locked')) return;
            if (active && root.contains(active)) return;
            licenseSplitGenericLock(root);
          });
      }, 0);
    },
    true
  );
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      licenseSplitInstallLockedClickDelegateOnce();
      licenseSplitInstallProveedorFocusoutRelockOnce();
    });
  } else {
    licenseSplitInstallLockedClickDelegateOnce();
    licenseSplitInstallProveedorFocusoutRelockOnce();
  }
}

/** Filtra la lista del modal Gestionar productos por nombre. */
function gestionProductosNormalizeSearchQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function gestionProductosFilterList(listEl, query, emptyEl) {
  if (!listEl) return;
  var norm = gestionProductosNormalizeSearchQuery(query);
  var items = listEl.querySelectorAll('.gestion-productos-item');
  var visible = 0;
  items.forEach(function (item) {
    var hay =
      item.getAttribute('data-search-name') ||
      gestionProductosNormalizeSearchQuery(
        item.querySelector('.gestion-productos-item-name strong')
          ? item.querySelector('.gestion-productos-item-name strong').textContent
          : ''
      );
    var show = !norm || hay.indexOf(norm) !== -1;
    item.hidden = !show;
    item.classList.toggle('gestion-productos-item--search-hidden', !show);
    item.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (show) visible += 1;
  });
  if (emptyEl) {
    emptyEl.hidden = visible > 0 || !norm;
  }
}

function gestionProductosWireSearch(modalOverlay) {
  if (!modalOverlay) return;
  var input = modalOverlay.querySelector('.gestion-productos-search-input');
  var list = modalOverlay.querySelector('.gestion-productos-list');
  var empty = modalOverlay.querySelector('.gestion-productos-search-empty');
  if (!input || !list) return;
  function applyFilter() {
    gestionProductosFilterList(list, input.value, empty);
  }
  input.addEventListener('input', applyFilter);
  input.addEventListener('search', applyFilter);
  input.addEventListener('keyup', applyFilter);
  window.setTimeout(function () {
    try {
      input.focus({ preventScroll: true });
    } catch (_e) {
      try {
        input.focus();
      } catch (_e2) {}
    }
  }, 60);
}

function gestionProductosWireNotifyPrefs(modalOverlay) {
  /* Compat no-op: vibrar/sonar se gestionan en showAdminLicenciasNotificacionesModal. */
  return;
}

function showAdminLicenciasNotificacionesModal() {
  var existing = document.getElementById('adminLicenciasNotificacionesModal');
  if (existing) {
    existing.remove();
  }

  var html =
    '<div class="modal-overlay" id="adminLicenciasNotificacionesModal">' +
    '  <div class="admin-lic-notify-prefs-modal-inner" role="dialog" aria-modal="true" aria-labelledby="adminLicNotifyPrefsTitulo">' +
    '    <div class="admin-lic-notify-prefs-modal-content">' +
    '      <div class="admin-lic-notify-prefs-modal-header">' +
    '        <h3 id="adminLicNotifyPrefsTitulo"><i class="fas fa-bell" aria-hidden="true"></i> Notificaciones</h3>' +
    '        <button type="button" class="admin-lic-notify-prefs-modal-close" aria-label="Cerrar">&times;</button>' +
    '      </div>' +
    '      <div class="admin-lic-notify-prefs-body">' +
    '        <p class="admin-lic-notify-prefs-section-title">Tipos de aviso</p>' +
    '        <p class="admin-lic-notify-prefs-hint">Activa o desactiva qué avisos quieres recibir (app / web). Por defecto todos activos.</p>' +
    '        <div class="admin-lic-notify-prefs-types">' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifyTypeLicenseReport" checked autocomplete="off"> <span>Reportes de clientes</span></label>' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifyTypeBalanceRecharge" checked autocomplete="off"> <span>Recargas (acreditada / rechazada)</span></label>' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifyTypeReservation" checked autocomplete="off"> <span>Reservas</span></label>' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifyTypeStockUpload" checked autocomplete="off"> <span>Cuentas subidas (stock nuevo)</span></label>' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifyTypeWaDigest" checked autocomplete="off"> <span>Fallback WhatsApp (app + correo)</span></label>' +
    '        </div>' +
    '        <p class="admin-lic-notify-prefs-section-title">Alerta al recibir</p>' +
    '        <p class="admin-lic-notify-prefs-hint">Desactivados por defecto. Puedes activarlos manualmente.</p>' +
    '        <div class="admin-lic-notify-prefs-feedback">' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifyVibrateEnabled" autocomplete="off"> <span>Vibrar</span></label>' +
    '          <label class="admin-lic-notify-prefs-check"><input type="checkbox" id="adminNotifySoundEnabled" autocomplete="off"> <span>Sonar</span></label>' +
    '        </div>' +
    '        <p id="adminLicNotifyPrefsSaveStatus" class="admin-lic-notify-prefs-status" role="status" hidden></p>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);
  var modal = document.getElementById('adminLicenciasNotificacionesModal');
  if (!modal) return;

  function closeModal() {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });
  var btnClose = modal.querySelector('.admin-lic-notify-prefs-modal-close');
  if (btnClose) {
    btnClose.addEventListener('click', function (e) {
      e.stopPropagation();
      closeModal();
    });
  }

  adminLicenciasWireNotifyPrefsModal(modal);
}

function adminLicenciasWireNotifyPrefsModal(modalOverlay) {
  if (!modalOverlay) return;
  var chkVibrate = modalOverlay.querySelector('#adminNotifyVibrateEnabled');
  var chkSound = modalOverlay.querySelector('#adminNotifySoundEnabled');
  var chkReport = modalOverlay.querySelector('#adminNotifyTypeLicenseReport');
  var chkRecharge = modalOverlay.querySelector('#adminNotifyTypeBalanceRecharge');
  var chkReservation = modalOverlay.querySelector('#adminNotifyTypeReservation');
  var chkStock = modalOverlay.querySelector('#adminNotifyTypeStockUpload');
  var chkWa = modalOverlay.querySelector('#adminNotifyTypeWaDigest');
  var statusEl = modalOverlay.querySelector('#adminLicNotifyPrefsSaveStatus');

  function setStatus(text, ok) {
    if (!statusEl) return;
    var t = String(text || '').trim();
    if (!t) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = t;
    statusEl.classList.toggle('admin-lic-notify-prefs-status--ok', !!ok);
    statusEl.classList.toggle('admin-lic-notify-prefs-status--warn', !ok);
  }

  function csrfToken() {
    if (typeof getCSRFToken === 'function') return getCSRFToken() || '';
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function applyPrefs(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    if (chkVibrate) chkVibrate.checked = !!prefs.notify_vibrate_enabled;
    if (chkSound) chkSound.checked = !!prefs.notify_sound_enabled;
    var types = prefs.notify_types || {};
    if (chkReport) chkReport.checked = types.license_report !== false;
    if (chkRecharge) chkRecharge.checked = types.balance_recharge !== false;
    if (chkReservation) chkReservation.checked = types.reservation !== false;
    if (chkStock) chkStock.checked = types.stock_upload !== false;
    if (chkWa) chkWa.checked = types.wa_digest !== false;
    try {
      window.__storeNotifyPrefs = Object.assign({}, window.__storeNotifyPrefs || {}, {
        vibrate: !!prefs.notify_vibrate_enabled,
        sound: !!prefs.notify_sound_enabled,
        email: prefs.email_notify_enabled !== false,
        push: prefs.push_notify_enabled !== false,
        inapp: prefs.inapp_notify_enabled !== false,
      });
    } catch (_w) {}
  }

  function collectPayload() {
    return {
      notify_vibrate_enabled: chkVibrate ? !!chkVibrate.checked : false,
      notify_sound_enabled: chkSound ? !!chkSound.checked : false,
      notify_types: {
        license_report: chkReport ? !!chkReport.checked : true,
        balance_recharge: chkRecharge ? !!chkRecharge.checked : true,
        reservation: chkReservation ? !!chkReservation.checked : true,
        stock_upload: chkStock ? !!chkStock.checked : true,
        wa_digest: chkWa ? !!chkWa.checked : true,
      },
    };
  }

  var saveTimer = null;
  function savePrefs() {
    var body = collectPayload();
    applyPrefs(body);
    if (saveTimer) window.clearTimeout(saveTimer);
    setStatus('Guardando…', true);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      fetch('/tienda/api/user/notify-prefs', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken(),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { success: false };
          });
        })
        .then(function (data) {
          if (data && data.success && data.prefs) {
            applyPrefs(data.prefs);
            setStatus('Guardado', true);
            window.setTimeout(function () {
              setStatus('', true);
            }, 1600);
            return;
          }
          setStatus((data && data.error) || 'No se pudo guardar', false);
        })
        .catch(function () {
          setStatus('Error de red', false);
        });
    }, 280);
  }

  fetch('/tienda/api/user/notify-prefs', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then(function (r) {
      return r.json().catch(function () {
        return { success: false };
      });
    })
    .then(function (data) {
      if (data && data.success && data.prefs) applyPrefs(data.prefs);
    })
    .catch(function () {});

  [chkVibrate, chkSound, chkReport, chkRecharge, chkReservation, chkStock, chkWa].forEach(function (el) {
    if (el) el.addEventListener('change', savePrefs);
  });
}

window.showAdminLicenciasNotificacionesModal = showAdminLicenciasNotificacionesModal;

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
