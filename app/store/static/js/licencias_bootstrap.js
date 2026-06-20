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
