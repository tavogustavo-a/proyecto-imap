/**
 * Bloc de notas (admin licencias): notas personales + licencias por producto.
 * Persistencia: base de datos (PUT /tienda/api/licenses/:id/notes) + localStorage como caché/offline.
 */
(function () {
  var PERSONAL_PREFIX = 'admin_licencias_bloc_personal_';
  var PERSONAL_SUFFIX = '_v1';
  var LICENSE_PREFIX = 'admin_licencias_bloc_license_';
  var LICENSE_SUFFIX = '_v1';
  var LEGACY_PERSONAL_GLOBAL = 'admin_licencias_bloc_personal_v1';
  var LEGACY_BLOC_V1 = 'admin_licencias_bloc_v1';

  var currentLicenseId = null;
  var saveNotesTimer = null;
  var SAVE_DEBOUNCE_MS = 900;

  function personalStorageKey(id) {
    return PERSONAL_PREFIX + id + PERSONAL_SUFFIX;
  }

  function licenseStorageKey(id) {
    return LICENSE_PREFIX + id + LICENSE_SUFFIX;
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    var el = getEl('adminLicenciasNotepadToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove('visible');
    }, 1600);
  }

  function savePersonalForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(personalStorageKey(licenseId), value);
    } catch (e) {}
  }

  function saveLicenseForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(licenseStorageKey(licenseId), value);
    } catch (e) {}
  }

  function loadPersonalFromLocalOnly(licenseId, ta) {
    try {
      var s = localStorage.getItem(personalStorageKey(licenseId));
      if (s === null) {
        var legacyGlobal = localStorage.getItem(LEGACY_PERSONAL_GLOBAL);
        if (legacyGlobal !== null) {
          localStorage.setItem(personalStorageKey(licenseId), legacyGlobal);
          localStorage.removeItem(LEGACY_PERSONAL_GLOBAL);
          s = legacyGlobal;
        }
      }
      if (s === null) {
        var legacy = localStorage.getItem(LEGACY_BLOC_V1);
        if (legacy !== null) {
          localStorage.setItem(personalStorageKey(licenseId), legacy);
          localStorage.removeItem(LEGACY_BLOC_V1);
          s = legacy;
        }
      }
      ta.value = s !== null ? s : '';
    } catch (e) {
      ta.value = '';
    }
  }

  function loadLicenseFromLocalOnly(licenseId, ta) {
    try {
      var s = localStorage.getItem(licenseStorageKey(licenseId));
      ta.value = s !== null ? s : '';
    } catch (e) {
      ta.value = '';
    }
  }

  /**
   * Si hay datos del API (licenseRow), la base de datos manda; si no, solo localStorage.
   */
  function loadPersonalForId(licenseId, ta, licenseRow) {
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'personal_notes')) {
      var v = licenseRow.personal_notes != null ? String(licenseRow.personal_notes) : '';
      ta.value = v;
      savePersonalForId(licenseId, v);
      return;
    }
    loadPersonalFromLocalOnly(licenseId, ta);
  }

  function loadLicenseForId(licenseId, ta, licenseRow) {
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'license_notes')) {
      var v = licenseRow.license_notes != null ? String(licenseRow.license_notes) : '';
      ta.value = v;
      saveLicenseForId(licenseId, v);
      return;
    }
    loadLicenseFromLocalOnly(licenseId, ta);
  }

  function saveCurrentPersonal(ta) {
    var lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    savePersonalForId(lid, ta.value);
  }

  function saveCurrentLicense(ta) {
    var lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveLicenseForId(lid, ta.value);
  }

  function csrf() {
    return typeof getCSRFToken === 'function' ? getCSRFToken() : '';
  }

  function saveNotesToServer(licenseId) {
    var taP = getEl('adminLicenciasNotepadPersonal');
    var taL = getEl('adminLicenciasNotepadByLicense');
    if (!taP || !taL) return;
    if (String(taP.dataset.licenseId) !== String(licenseId)) return;
    var body = JSON.stringify({
      personal_notes: taP.value,
      license_notes: taL.value
    });
    fetch('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrf()
      },
      body: body
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.success && typeof window.patchLicenseNotesCache === 'function') {
          window.patchLicenseNotesCache(licenseId, taP.value, taL.value);
        }
      })
      .catch(function () {});
  }

  function scheduleSaveNotes(licenseId) {
    clearTimeout(saveNotesTimer);
    saveNotesTimer = setTimeout(function () {
      saveNotesToServer(licenseId);
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPendingNotesSave() {
    clearTimeout(saveNotesTimer);
    if (currentLicenseId !== null) {
      saveNotesToServer(currentLicenseId);
    }
  }

  function bindClipboard(ta) {
    ta.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var val = ta.value;
      var slice = start !== end ? val.substring(start, end) : val;
      var toCopy = slice.length ? slice : val;

      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        toast('Copia no disponible');
        return;
      }
      navigator.clipboard.writeText(toCopy).then(function () {
        toast(toCopy.length ? 'Copiado' : 'Vacío');
      }).catch(function () {
        toast('Error al copiar');
      });
    });
  }

  function setLicenseHeading(productName) {
    var el = getEl('adminLicenciasLicenciasHeading');
    if (!el) return;
    if (productName && String(productName).trim()) {
      el.textContent = 'Licencias / ' + String(productName).trim();
    } else {
      el.textContent = 'Licencias';
    }
  }

  function init() {
    var taPersonal = getEl('adminLicenciasNotepadPersonal');
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    if (!taPersonal || !taLicense) return;

    taPersonal.addEventListener('input', function () {
      saveCurrentPersonal(taPersonal);
      var lid = taPersonal.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
    });
    taLicense.addEventListener('input', function () {
      saveCurrentLicense(taLicense);
      var lid = taLicense.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
    });

    bindClipboard(taPersonal);
    bindClipboard(taLicense);

    currentLicenseId = null;
  }

  function bindLicense(licenseId, productName, licenseRow) {
    var taPersonal = getEl('adminLicenciasNotepadPersonal');
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    if (!taPersonal || !taLicense) return;

    var idStr = String(licenseId);
    if (currentLicenseId !== null && currentLicenseId !== idStr) {
      savePersonalForId(currentLicenseId, taPersonal.value);
      saveLicenseForId(currentLicenseId, taLicense.value);
      flushPendingNotesSave();
    }

    currentLicenseId = idStr;
    taPersonal.dataset.licenseId = idStr;
    taLicense.dataset.licenseId = idStr;

    loadPersonalForId(licenseId, taPersonal, licenseRow);
    loadLicenseForId(licenseId, taLicense, licenseRow);
    setLicenseHeading(productName || '');
  }

  function flushLicense() {
    var taPersonal = getEl('adminLicenciasNotepadPersonal');
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    if (!taLicense || currentLicenseId === null) return;
    savePersonalForId(currentLicenseId, taPersonal ? taPersonal.value : '');
    saveLicenseForId(currentLicenseId, taLicense.value);
    flushPendingNotesSave();
    currentLicenseId = null;
    setLicenseHeading('');
  }

  window.initAdminLicenciasNotepad = init;
  window.AdminLicenciasNotepad = {
    bindLicense: bindLicense,
    flushLicense: flushLicense
  };
})();
