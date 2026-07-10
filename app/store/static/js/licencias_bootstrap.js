/**
 * Inicialización temprana de flags de modo (archivados / soporte restringido).
 */
(function initArchivedLicensesModeFromMeta() {
  try {
    var meta = document.querySelector('meta[name="licenses-archive-mode"]');
    if (meta && meta.getAttribute('content') === '1') {
      window.IS_ARCHIVED_MODE = true;
    }
  } catch (e) {}
})();

(function initLicenseSupportRestrictedFromDataAttribute() {
  try {
    var el = document.querySelector('.admin-licencias-shell[data-license-support-restricted="true"]');
    if (!el) return;
    window.LICENSE_SUPPORT_RESTRICTED = true;
    document.documentElement.classList.add('admin-licencias-license-support-mode');
  } catch (_eLicSupDom) {}
})();

(function initLicenseSupportViewOnlyFromDataAttribute() {
  try {
    var el = document.querySelector('.admin-licencias-shell[data-license-support-view-only="true"]');
    if (!el) return;
    window.LICENSE_SUPPORT_VIEW_ONLY = true;
    document.documentElement.classList.add('admin-licencias-view-only-mode');
    el.classList.add('admin-licencias-view-only');

    // Bloqueo client-side de mutaciones (el servidor también rechaza POST/PUT/DELETE)
    var origFetch = window.fetch;
    if (typeof origFetch === 'function' && !window.__licenseSupportViewOnlyFetchPatched) {
      window.__licenseSupportViewOnlyFetchPatched = true;
      window.fetch = function (input, init) {
        var method = ((init && init.method) || 'GET').toUpperCase();
        var url = '';
        if (typeof input === 'string') url = input;
        else if (input && typeof input.url === 'string') url = input.url;
        var isMut = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
        var isStoreApi = String(url).indexOf('/tienda/api/') !== -1;
        var isOwnUiPrefs = String(url).indexOf('admin-licencias-ui-prefs') !== -1;
        if (isMut && isStoreApi && !isOwnUiPrefs) {
          try {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  success: false,
                  error:
                    'Tu cuenta solo puede visualizar. No puedes modificar licencias del usuario principal.',
                }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
              )
            );
          } catch (_eVoFetch) {
            return Promise.reject(_eVoFetch);
          }
        }
        return origFetch.apply(this, arguments);
      };
    }

    function lockEditors(root) {
      if (!root) return;
      root.querySelectorAll('textarea, input:not([type="search"]):not([type="checkbox"]):not([type="hidden"]), select, [contenteditable="true"]').forEach(
        function (node) {
          if (!node) return;
          if (node.id === 'adminStoreSearch') return;
          if (node.closest && node.closest('.admin-lic-toolbar-soporte-row')) return;
          try {
            if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
              node.setAttribute('readonly', 'readonly');
            }
            if (node.tagName === 'SELECT' || node.tagName === 'BUTTON') {
              node.disabled = true;
            }
            if (node.getAttribute && node.getAttribute('contenteditable') === 'true') {
              node.setAttribute('contenteditable', 'false');
            }
          } catch (_eLock) {}
        }
      );
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        lockEditors(el);
      });
    } else {
      lockEditors(el);
    }
    try {
      var mo = new MutationObserver(function () {
        lockEditors(el);
      });
      mo.observe(el, { childList: true, subtree: true });
    } catch (_eMo) {}
  } catch (_eLicVo) {}
})();
