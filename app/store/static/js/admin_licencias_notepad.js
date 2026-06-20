/**
 * Bloc de notas (admin licencias): notas personales + licencias por producto.
 * Persistencia: base de datos (PUT /tienda/api/licenses/:id/notes) + localStorage como caché/offline.
 */
(function () {
  var PERSONAL_PREFIX = 'admin_licencias_bloc_personal_';
  var PERSONAL_SUFFIX = '_v1';
  var LICENSE_PREFIX = 'admin_licencias_bloc_license_';
  var LICENSE_SUFFIX = '_v1';
  var SUSPENDED_PREFIX = 'admin_licencias_bloc_suspended_';
  var SUSPENDED_SUFFIX = '_v1';
  var EXPIRED_PREFIX = 'admin_licencias_bloc_expired_';
  var EXPIRED_SUFFIX = '_v1';
  var CHANGES_PREFIX = 'admin_licencias_bloc_changes_';
  var CHANGES_SUFFIX = '_v1';
  var LEGACY_PERSONAL_GLOBAL = 'admin_licencias_bloc_personal_v1';
  var LEGACY_BLOC_V1 = 'admin_licencias_bloc_v1';

  var currentLicenseId = null;
  var saveNotesTimer = null;
  /* Corto: bloc licencias (incl. columna notas) debe persistir pronto si se recarga o se cambia de pestaña. */
  var SAVE_DEBOUNCE_MS = 180;
  var saveChangesOnlyTimers = {};
  var undoNotepadControllers = [];

  function getChangesNotesMergedForLicenseId(licenseId) {
    var lid = String(licenseId);
    var root = document.querySelector(
      '#licenseChangesProductsContainer .changes-license-split-root[data-license-id="' + lid + '"]'
    );
    if (root && typeof window.changesLicenseSplitGetMergedText === 'function') {
      return window.changesLicenseSplitGetMergedText(root);
    }
    return '';
  }

  function saveChangesNotesImmediateForId(licenseId) {
    if (String(licenseId) === '0') return Promise.resolve({ success: false, error: 'aggregate' });
    var text = getChangesNotesMergedForLicenseId(licenseId);
    if (typeof adminLicFetchJson !== 'function') {
      return Promise.resolve({ success: false, error: 'fetch_unavailable' });
    }
    return adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes_notes: text }),
    })
      .then(function (data) {
        if (data.success && typeof window.patchLicenseChangesNotesInCacheOnly === 'function') {
          window.patchLicenseChangesNotesInCacheOnly(licenseId, text);
        }
        if (data.success && typeof window.refreshChangesProductsListing === 'function') {
          var nlines = String(text || '')
            .split(/\r?\n/)
            .filter(function (ln) {
              return String(ln).trim() !== '';
            }).length;
          if (nlines === 0) {
            window.refreshChangesProductsListing();
          }
        }
        return data;
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar Cambios'));
        }
        return { success: false, error: 'network' };
      });
  }

  function scheduleSaveChangesNotesOnly(licenseId) {
    if (String(licenseId) === '0') return;
    var lid = String(licenseId);
    clearTimeout(saveChangesOnlyTimers[lid]);
    saveChangesOnlyTimers[lid] = setTimeout(function () {
      saveChangesNotesImmediateForId(licenseId);
      delete saveChangesOnlyTimers[lid];
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPendingChangesNotesSaves() {
    Object.keys(saveChangesOnlyTimers).forEach(function (k) {
      clearTimeout(saveChangesOnlyTimers[k]);
      delete saveChangesOnlyTimers[k];
      saveChangesNotesImmediateForId(k);
    });
  }

  function personalStorageKey(id) {
    return PERSONAL_PREFIX + id + PERSONAL_SUFFIX;
  }

  function licenseStorageKey(id) {
    return LICENSE_PREFIX + id + LICENSE_SUFFIX;
  }

  function suspendedStorageKey(id) {
    return SUSPENDED_PREFIX + id + SUSPENDED_SUFFIX;
  }

  function expiredStorageKey(id) {
    return EXPIRED_PREFIX + id + EXPIRED_SUFFIX;
  }

  function changesStorageKey(id) {
    return CHANGES_PREFIX + id + CHANGES_SUFFIX;
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

  function saveSuspendedForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(suspendedStorageKey(licenseId), value);
    } catch (e) {}
  }

  function saveExpiredForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(expiredStorageKey(licenseId), value);
    } catch (e) {}
  }

  function saveChangesForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(changesStorageKey(licenseId), value);
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

  function licenseBlockText(el) {
    if (!el) return '';
    if (
      el.id === 'adminLicenciasSuspendedNotepad' &&
      typeof window.suspendedLicenseSplitGetMergedText === 'function'
    ) {
      var suspRoot = getEl('adminLicenciasSuspendedSplitRoot');
      if (suspRoot) {
        return window.suspendedLicenseSplitGetMergedText(suspRoot);
      }
    }
    if (
      el.id === 'adminLicenciasExpiredNotepad' &&
      typeof window.expiredLicenseSplitGetMergedText === 'function'
    ) {
      var expRoot = getEl('adminLicenciasExpiredSplitRoot');
      if (expRoot) {
        return window.expiredLicenseSplitGetMergedText(expRoot);
      }
    }
    return el.tagName === 'TEXTAREA' ? el.value : el.innerText || '';
  }

  function licenseMergedOrBlockText(ta) {
    if (
      ta &&
      ta.id === 'adminLicenciasNotepadByLicense' &&
      typeof window.adminLicenseSplitGetMergedNotes === 'function'
    ) {
      return window.adminLicenseSplitGetMergedNotes();
    }
    return licenseBlockText(ta);
  }

  function stripStandaloneGenericoLines(text) {
    var lines = String(text || '').split(/\r?\n/);
    var filtered = lines.filter(function (line) {
      var t = String(line || '').trim().toLowerCase();
      var genNew =
        'generico' + '\x1f' + 'anonimo' + '\x1f' + '\x1f' + '\x1f';
      var genNewAccent =
        'genérico' + '\x1f' + 'anonimo' + '\x1f' + '\x1f' + '\x1f';
      return (
        t !== 'generico' &&
        t !== 'genérico' &&
        t !== 'generico // anonimo // //' &&
        t !== 'genérico // anonimo // //' &&
        t !== genNew &&
        t !== genNewAccent
      );
    });
    return filtered.join('\n');
  }

  function sanitizeStandaloneGenericoInElement(el) {
    if (!el) return false;
    var raw = licenseBlockText(el);
    var clean = stripStandaloneGenericoLines(raw);
    if (clean === raw) return false;
    setLicenseBlockPlainText(el, clean);
    return true;
  }

  function sanitizeStandaloneGenericoInLicenseSplit(ta) {
    if (!ta) return false;
    if (typeof window.adminLicenseSplitGetMergedNotes !== 'function') {
      return sanitizeStandaloneGenericoInElement(ta);
    }
    var raw = window.adminLicenseSplitGetMergedNotes();
    var clean = stripStandaloneGenericoLines(raw);
    if (clean === raw) return false;
    window.adminLicenseSplitApplyMergedText(clean);
    return true;
  }

  function sanitizeStandaloneGenericoInSuspendedSplit(taSuspended) {
    if (!taSuspended) return false;
    var suspRoot = getEl('adminLicenciasSuspendedSplitRoot');
    if (suspRoot && typeof window.suspendedLicenseSplitGetMergedText === 'function') {
      var raw = window.suspendedLicenseSplitGetMergedText(suspRoot);
      var clean = stripStandaloneGenericoLines(raw);
      if (clean === raw) return false;
      window.suspendedLicenseSplitApplyMergedText(suspRoot, clean);
      return true;
    }
    return sanitizeStandaloneGenericoInElement(taSuspended);
  }

  function sanitizeStandaloneGenericoInExpiredSplit(taExpired) {
    if (!taExpired) return false;
    var expRoot = getEl('adminLicenciasExpiredSplitRoot');
    if (expRoot && typeof window.expiredLicenseSplitGetMergedText === 'function') {
      var raw2 = window.expiredLicenseSplitGetMergedText(expRoot);
      var clean2 = stripStandaloneGenericoLines(raw2);
      if (clean2 === raw2) return false;
      window.expiredLicenseSplitApplyMergedText(expRoot, clean2);
      return true;
    }
    return sanitizeStandaloneGenericoInElement(taExpired);
  }

  function sanitizeStandaloneGenericoInChangesSplit() {
    var any = false;
    document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(function (chRoot) {
      if (!chRoot || typeof window.changesLicenseSplitGetMergedText !== 'function') return;
      var raw3 = window.changesLicenseSplitGetMergedText(chRoot);
      var clean3 = stripStandaloneGenericoLines(raw3);
      if (clean3 !== raw3) {
        window.changesLicenseSplitApplyMergedText(chRoot, clean3);
        any = true;
      }
    });
    return any;
  }

  function refreshLicenseLineBadge() {
    if (typeof window.updateLicenseBlocLineCountBadge === 'function') {
      window.updateLicenseBlocLineCountBadge();
    }
  }

  function refreshPersonalLineBadge() {
    if (typeof window.updatePersonalBlocLineCountBadge === 'function') {
      window.updatePersonalBlocLineCountBadge();
    }
  }

  function refreshSuspendedLineBadge() {
    if (typeof window.updateSuspendedBlocLineCountBadge === 'function') {
      window.updateSuspendedBlocLineCountBadge();
    }
  }

  function refreshExpiredLineBadge() {
    if (typeof window.updateExpiredBlocLineCountBadge === 'function') {
      window.updateExpiredBlocLineCountBadge();
    }
  }

  function refreshChangesLineBadge() {
    if (typeof window.updateChangesBlocLineCountBadge === 'function') {
      window.updateChangesBlocLineCountBadge();
    }
  }

  function setLicenseBlockPlainText(el, text) {
    if (!el) return;
    if (el.id === 'adminLicenciasSuspendedNotepad') {
      var suspRoot = getEl('adminLicenciasSuspendedSplitRoot');
      var suspRows = getEl('adminLicenciasSuspendedRows');
      if (String(el.dataset.licenseId || '') === '0') {
        if (suspRows) suspRows.innerHTML = '';
        if (el.tagName === 'TEXTAREA') {
          el.value = text != null ? text : '';
        }
        return;
      }
      if (suspRoot && typeof window.suspendedLicenseSplitApplyMergedText === 'function') {
        window.suspendedLicenseSplitApplyMergedText(suspRoot, text != null ? text : '');
        return;
      }
    }
    if (el.id === 'adminLicenciasExpiredNotepad') {
      var expRootSet = getEl('adminLicenciasExpiredSplitRoot');
      var expRows = getEl('adminLicenciasExpiredRows');
      if (String(el.dataset.licenseId || '') === '0') {
        if (expRows) expRows.innerHTML = '';
        if (el.tagName === 'TEXTAREA') {
          el.value = text != null ? text : '';
        }
        return;
      }
      if (expRootSet && typeof window.expiredLicenseSplitApplyMergedText === 'function') {
        window.expiredLicenseSplitApplyMergedText(expRootSet, text != null ? text : '');
        return;
      }
    }
    if (el.tagName === 'TEXTAREA') {
      el.value = text != null ? text : '';
    } else {
      el.textContent = text != null ? text : '';
    }
  }

  function loadLicenseFromLocalOnly(licenseId, ta) {
    try {
      var s = localStorage.getItem(licenseStorageKey(licenseId));
      var v = s !== null ? s : '';
      v = stripStandaloneGenericoLines(v);
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText(v);
      } else {
        setLicenseBlockPlainText(ta, v);
      }
    } catch (e) {
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText('');
      } else {
        setLicenseBlockPlainText(ta, '');
      }
    }
  }

  function loadSuspendedFromLocalOnly(licenseId, el) {
    try {
      var s = localStorage.getItem(suspendedStorageKey(licenseId));
      setLicenseBlockPlainText(el, s !== null ? s : '');
    } catch (e) {
      setLicenseBlockPlainText(el, '');
    }
  }

  function loadExpiredFromLocalOnly(licenseId, el) {
    try {
      var s = localStorage.getItem(expiredStorageKey(licenseId));
      setLicenseBlockPlainText(el, s !== null ? s : '');
    } catch (e) {
      setLicenseBlockPlainText(el, '');
    }
  }

  function loadChangesForId(licenseId, el, licenseRow) {
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'changes_notes')) {
      var vc = licenseRow.changes_notes != null ? String(licenseRow.changes_notes) : '';
      setLicenseBlockPlainText(el, vc);
      saveChangesForId(licenseId, vc);
      return;
    }
    loadChangesFromLocalOnly(licenseId, el);
  }

  function loadChangesFromLocalOnly(licenseId, el) {
    try {
      var s = localStorage.getItem(changesStorageKey(licenseId));
      setLicenseBlockPlainText(el, s !== null ? s : '');
    } catch (e) {
      setLicenseBlockPlainText(el, '');
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
      v = stripStandaloneGenericoLines(v);
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText(v);
      } else {
        setLicenseBlockPlainText(ta, v);
      }
      saveLicenseForId(licenseId, licenseMergedOrBlockText(ta));
      return;
    }
    loadLicenseFromLocalOnly(licenseId, ta);
  }

  function loadSuspendedForId(licenseId, el, licenseRow) {
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'suspended_notes')) {
      var v = licenseRow.suspended_notes != null ? String(licenseRow.suspended_notes) : '';
      setLicenseBlockPlainText(el, v);
      saveSuspendedForId(licenseId, v);
      return;
    }
    loadSuspendedFromLocalOnly(licenseId, el);
  }

  function loadExpiredForId(licenseId, el, licenseRow) {
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'expired_notes')) {
      var ve = licenseRow.expired_notes != null ? String(licenseRow.expired_notes) : '';
      setLicenseBlockPlainText(el, ve);
      saveExpiredForId(licenseId, ve);
      return;
    }
    loadExpiredFromLocalOnly(licenseId, el);
  }

  function saveCurrentPersonal(ta) {
    var lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    savePersonalForId(lid, ta.value);
  }

  function saveCurrentLicense(ta) {
    var lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveLicenseForId(lid, licenseMergedOrBlockText(ta));
  }

  function saveCurrentSuspended(el) {
    var lid = el.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveSuspendedForId(lid, licenseBlockText(el));
  }

  function saveCurrentExpired(el) {
    var lid = el.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveExpiredForId(lid, licenseBlockText(el));
  }

  function saveCurrentChanges(el) {
    var lid = el.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveChangesForId(lid, licenseBlockText(el));
  }

  function csrf() {
    return typeof getCSRFToken === 'function' ? getCSRFToken() : '';
  }

  function saveNotesToServer(licenseId) {
    if (String(licenseId) === '0') return;
    var taP = getEl('adminLicenciasNotepadPersonal');
    var taL = getEl('adminLicenciasNotepadByLicense');
    var taS = getEl('adminLicenciasSuspendedNotepad');
    var taE = getEl('adminLicenciasExpiredNotepad');
    if (!taP || !taL || !taS || !taE) return;
    if (String(taL.dataset.licenseId) !== String(licenseId)) return;
    if (String(taS.dataset.licenseId) !== String(licenseId)) return;
    if (String(taE.dataset.licenseId) !== String(licenseId)) return;
    var body = JSON.stringify({
      personal_notes: taP.value,
      license_notes: licenseMergedOrBlockText(taL),
      suspended_notes: licenseBlockText(taS),
      expired_notes: licenseBlockText(taE),
      changes_notes: getChangesNotesMergedForLicenseId(licenseId)
    });
    if (typeof adminLicFetchJson !== 'function') return;
    adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
      .then(function (data) {
        if (data.success && typeof window.patchLicenseNotesCache === 'function') {
          window.patchLicenseNotesCache(
            licenseId,
            taP.value,
            licenseMergedOrBlockText(taL),
            licenseBlockText(taS),
            licenseBlockText(taE),
            undefined,
            getChangesNotesMergedForLicenseId(licenseId)
          );
        }
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar notas'));
        }
      });
  }

  /** Guarda notas al servidor de inmediato (p. ej. antes de syncDayNotepad tras quitar una línea). */
  function saveCurrentLicenseNotesImmediate() {
    clearTimeout(saveNotesTimer);
    var taP = getEl('adminLicenciasNotepadPersonal');
    var taL = getEl('adminLicenciasNotepadByLicense');
    var taS = getEl('adminLicenciasSuspendedNotepad');
    var taE = getEl('adminLicenciasExpiredNotepad');
    if (!taP || !taL || !taS || !taE) {
      return Promise.resolve({ success: false, error: 'missing_fields' });
    }
    var licenseId = taL.dataset.licenseId;
    if (licenseId === undefined || licenseId === '' || String(licenseId) === '0') {
      return Promise.resolve({ success: false, error: 'aggregate_or_empty' });
    }
    saveCurrentPersonal(taP);
    saveCurrentLicense(taL);
    saveCurrentSuspended(taS);
    saveCurrentExpired(taE);
    var body = JSON.stringify({
      personal_notes: taP.value,
      license_notes: licenseMergedOrBlockText(taL),
      suspended_notes: licenseBlockText(taS),
      expired_notes: licenseBlockText(taE),
      changes_notes: getChangesNotesMergedForLicenseId(licenseId)
    });
    if (typeof adminLicFetchJson !== 'function') {
      return Promise.resolve({ success: false, error: 'fetch_unavailable' });
    }
    return adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
      .then(function (data) {
        if (data.success && typeof window.patchLicenseNotesCache === 'function') {
          window.patchLicenseNotesCache(
            licenseId,
            taP.value,
            licenseMergedOrBlockText(taL),
            licenseBlockText(taS),
            licenseBlockText(taE),
            undefined,
            getChangesNotesMergedForLicenseId(licenseId)
          );
        }
        return data;
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar notas'));
        }
        return { success: false, error: 'network' };
      });
  }

  function scheduleSaveNotes(licenseId) {
    if (String(licenseId) === '0') return;
    clearTimeout(saveNotesTimer);
    saveNotesTimer = setTimeout(function () {
      saveNotesToServer(licenseId);
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPendingNotesSave() {
    flushPendingChangesNotesSaves();
    clearTimeout(saveNotesTimer);
    if (currentLicenseId !== null && String(currentLicenseId) !== '0') {
      saveNotesToServer(currentLicenseId);
    }
  }

  function destroyUndoNotepads() {
    undoNotepadControllers.forEach(function (c) {
      if (c && typeof c.destroy === 'function') c.destroy();
    });
    undoNotepadControllers = [];
  }

  function resetUndoNotepads() {
    undoNotepadControllers.forEach(function (c) {
      if (c && typeof c.reset === 'function') c.reset();
    });
  }

  function initUndoNotepads() {
    destroyUndoNotepads();
    if (!window.AdminLicenciasUndoCore || typeof window.AdminLicenciasUndoCore.attach !== 'function') {
      return;
    }
    var attach = window.AdminLicenciasUndoCore.attach;
    var taP = getEl('adminLicenciasNotepadPersonal');
    var taL = getEl('adminLicenciasNotepadByLicense');
    var taS = getEl('adminLicenciasSuspendedNotepad');
    var taE = getEl('adminLicenciasExpiredNotepad');
    if (!taP || !taL || !taS || !taE) return;

    var buP = getEl('adminUndoRedoPersonalUndo');
    var brP = getEl('adminUndoRedoPersonalRedo');
    var buL = getEl('adminUndoRedoLicenseUndo');
    var brL = getEl('adminUndoRedoLicenseRedo');
    var buS = getEl('adminUndoRedoSuspendedUndo');
    var brS = getEl('adminUndoRedoSuspendedRedo');
    var buE = getEl('adminUndoRedoExpiredUndo');
    var brE = getEl('adminUndoRedoExpiredRedo');

    function persistNotesFromUndoRedo() {
      saveCurrentPersonal(taP);
      saveCurrentLicense(taL);
      saveCurrentSuspended(taS);
      saveCurrentExpired(taE);
      var lid = taL.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
      refreshLicenseLineBadge();
      refreshPersonalLineBadge();
      refreshSuspendedLineBadge();
      refreshExpiredLineBadge();
      refreshChangesLineBadge();
    }

    function afterPersonalVisual() {
      refreshPersonalLineBadge();
    }

    function afterLicenseVisual() {
      if (typeof window.adminLicenseSplitSyncRowsToTextarea === 'function') {
        window.adminLicenseSplitSyncRowsToTextarea();
      }
      refreshLicenseLineBadge();
    }

    function afterSuspendedVisual() {
      var sr = getEl('adminLicenciasSuspendedSplitRoot');
      if (sr && typeof window.suspendedLicenseSplitSyncRowsToTextarea === 'function') {
        window.suspendedLicenseSplitSyncRowsToTextarea(sr);
      }
      if (sr && typeof window.suspendedLicenseSplitScheduleAutosize === 'function') {
        window.suspendedLicenseSplitScheduleAutosize(sr);
      }
      refreshSuspendedLineBadge();
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    }

    function afterExpiredVisual() {
      var er = getEl('adminLicenciasExpiredSplitRoot');
      if (er && typeof window.expiredLicenseSplitSyncRowsToTextarea === 'function') {
        window.expiredLicenseSplitSyncRowsToTextarea(er);
      }
      if (er && typeof window.expiredLicenseSplitScheduleAutosize === 'function') {
        window.expiredLicenseSplitScheduleAutosize(er);
      }
      refreshExpiredLineBadge();
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    }

    undoNotepadControllers.push(
      attach(taP, {
        undoBtn: buP,
        redoBtn: brP,
        onPersist: persistNotesFromUndoRedo,
        afterVisual: afterPersonalVisual
      })
    );
    undoNotepadControllers.push(
      attach(taL, {
        undoBtn: buL,
        redoBtn: brL,
        onPersist: persistNotesFromUndoRedo,
        afterVisual: afterLicenseVisual
      })
    );
    var suspRootUndo = getEl('adminLicenciasSuspendedSplitRoot');
    if (
      suspRootUndo &&
      typeof window.suspendedLicenseSplitGetMergedText === 'function' &&
      typeof window.suspendedLicenseSplitApplyMergedText === 'function'
    ) {
      undoNotepadControllers.push(
        attach(suspRootUndo, {
          listenElement: suspRootUndo,
          useFocusOutDelegate: true,
          getPlainText: function () {
            return window.suspendedLicenseSplitGetMergedText(suspRootUndo);
          },
          setPlainText: function (text) {
            window.suspendedLicenseSplitApplyMergedText(suspRootUndo, text != null ? text : '');
          },
          undoBtn: buS,
          redoBtn: brS,
          onPersist: persistNotesFromUndoRedo,
          afterVisual: afterSuspendedVisual
        })
      );
    } else {
      undoNotepadControllers.push(
        attach(taS, {
          undoBtn: buS,
          redoBtn: brS,
          onPersist: persistNotesFromUndoRedo,
          afterVisual: function () {
            refreshSuspendedLineBadge();
          }
        })
      );
    }

    var expRootUndo = getEl('adminLicenciasExpiredSplitRoot');
    if (
      expRootUndo &&
      typeof window.expiredLicenseSplitGetMergedText === 'function' &&
      typeof window.expiredLicenseSplitApplyMergedText === 'function'
    ) {
      undoNotepadControllers.push(
        attach(expRootUndo, {
          listenElement: expRootUndo,
          useFocusOutDelegate: true,
          getPlainText: function () {
            return window.expiredLicenseSplitGetMergedText(expRootUndo);
          },
          setPlainText: function (text) {
            window.expiredLicenseSplitApplyMergedText(expRootUndo, text != null ? text : '');
          },
          undoBtn: buE,
          redoBtn: brE,
          onPersist: persistNotesFromUndoRedo,
          afterVisual: afterExpiredVisual
        })
      );
    } else {
      undoNotepadControllers.push(
        attach(taE, {
          undoBtn: buE,
          redoBtn: brE,
          onPersist: persistNotesFromUndoRedo,
          afterVisual: function () {
            refreshExpiredLineBadge();
          }
        })
      );
    }

  }

  function lockNotepadEditable(el) {
    if (!el) return;
    el.classList.add('license-notepad--locked');
    el.setAttribute('tabindex', '-1');
    if (el.tagName === 'TEXTAREA') {
      el.readOnly = true;
    } else {
      el.contentEditable = 'false';
    }
  }

  function unlockNotepadEditable(el) {
    if (!el) return;
    el.classList.remove('license-notepad--locked');
    el.setAttribute('tabindex', '0');
    if (el.tagName === 'TEXTAREA') {
      el.readOnly = false;
    } else {
      el.contentEditable = 'true';
    }
  }

  function lockLicenseSplit(taLicense) {
    lockNotepadEditable(taLicense);
    var root = getEl('adminLicenciasLicenseSplitRoot');
    if (!root) return;
    root.classList.add('license-notepad--locked');
    /* disabled absorbe clics; readOnly + CSS bloquea edición pero permite un clic para desbloquear. */
    root.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
      x.disabled = false;
      x.readOnly = true;
      x.tabIndex = -1;
    });
    root.querySelectorAll('.license-split-editor__row select').forEach(function (x) {
      x.disabled = false;
      x.tabIndex = -1;
    });
  }

  function unlockLicenseSplit(taLicense) {
    unlockNotepadEditable(taLicense);
    var root = getEl('adminLicenciasLicenseSplitRoot');
    if (!root) return;
    root.classList.remove('license-notepad--locked');
    if (String(taLicense.dataset.licenseId || '') === '0') return;
    root.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
      x.readOnly = false;
      x.removeAttribute('tabindex');
    });
    root.querySelectorAll('.license-split-editor__row select').forEach(function (x) {
      x.removeAttribute('tabindex');
    });
  }

  function lockSuspendedSplit(taSuspended) {
    var root = getEl('adminLicenciasSuspendedSplitRoot');
    if (root && typeof window.suspendedLicenseSplitLock === 'function') {
      window.suspendedLicenseSplitLock(root);
    } else {
      lockNotepadEditable(taSuspended);
    }
  }

  function lockExpiredSplit(taExpired) {
    var root = getEl('adminLicenciasExpiredSplitRoot');
    if (root && typeof window.expiredLicenseSplitLock === 'function') {
      window.expiredLicenseSplitLock(root);
    } else {
      lockNotepadEditable(taExpired);
    }
  }

  function lockChangesSplit() {
    if (typeof window.changesLicenseSplitLock === 'function') {
      document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(function (r) {
        window.changesLicenseSplitLock(r);
      });
    }
  }

  function notepadIsLocked(el) {
    if (!el) return true;
    if (el.tagName === 'TEXTAREA') {
      return el.readOnly === true;
    }
    return el.getAttribute('contenteditable') !== 'true';
  }

  /** Un clic para desbloquear y editar (mousedown captura antes del manejo por defecto). */
  function bindSingleClickToUnlock(el) {
    el.addEventListener(
      'beforeinput',
      function (e) {
        if (notepadIsLocked(el)) {
          e.preventDefault();
        }
      },
      true
    );
    el.addEventListener(
      'paste',
      function (e) {
        if (notepadIsLocked(el)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    el.addEventListener(
      'mousedown',
      function (e) {
        if (String(el.dataset.licenseId || '') === '0') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (!notepadIsLocked(el)) return;
        e.preventDefault();
        e.stopPropagation();
        unlockNotepadEditable(el);
        el.focus();
      },
      true
    );
  }

  function setLicenseHeading(_productName) {
    var el = getEl('adminLicenciasLicenciasHeading');
    if (!el) return;
    el.textContent = 'Licencias';
  }

  /** Misma posición vertical al hacer scroll: línea N del textarea ↔ fila N a la derecha. */
  function wireLicenseSplitScrollSync() {
    var ta = getEl('adminLicenciasNotepadByLicense');
    var rows = getEl('adminLicenciasStructuredRows');
    if (!ta || !rows || rows.dataset.licScrollSync === '1') return;
    rows.dataset.licScrollSync = '1';
    var syncing = false;
    ta.addEventListener('scroll', function () {
      if (syncing) return;
      syncing = true;
      rows.scrollTop = ta.scrollTop;
      window.requestAnimationFrame(function () {
        syncing = false;
      });
    });
    rows.addEventListener('scroll', function () {
      if (syncing) return;
      syncing = true;
      ta.scrollTop = rows.scrollTop;
      window.requestAnimationFrame(function () {
        syncing = false;
      });
    });
  }

  function init() {
    var taPersonal = getEl('adminLicenciasNotepadPersonal');
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    var taSuspended = getEl('adminLicenciasSuspendedNotepad');
    var taExpired = getEl('adminLicenciasExpiredNotepad');
    if (!taPersonal || !taLicense || !taSuspended || !taExpired) return;

    taPersonal.addEventListener('input', function () {
      saveCurrentPersonal(taPersonal);
      refreshPersonalLineBadge();
      var lid = taPersonal.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
    });
    taLicense.addEventListener('input', function () {
      if (typeof window.adminLicenseSplitSyncRowsToTextarea === 'function') {
        window.adminLicenseSplitSyncRowsToTextarea();
      }
      saveCurrentLicense(taLicense);
      refreshLicenseLineBadge();
      var lid = taLicense.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    });

    taLicense.addEventListener('blur', function () {
      if (typeof window.adminMainLicenseNormalizeCredTaTrailingRunsIfBlur === 'function') {
        window.adminMainLicenseNormalizeCredTaTrailingRunsIfBlur(taLicense);
      }
      if (typeof window.adminLicenseSplitScheduleAutosizeCreds === 'function') {
        window.adminLicenseSplitScheduleAutosizeCreds();
      }
      var splitR = getEl('adminLicenciasLicenseSplitRoot');
      window.setTimeout(function () {
        var a = document.activeElement;
        if (splitR && a && splitR.contains(a)) return;
        flushPendingNotesSave();
        lockLicenseSplit(taLicense);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      }, 0);
    });

    var structuredRows = getEl('adminLicenciasStructuredRows');
    if (structuredRows) {
      structuredRows.addEventListener('input', function () {
        saveCurrentLicense(taLicense);
        refreshLicenseLineBadge();
        var lid = taLicense.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      });
      structuredRows.addEventListener('change', function () {
        saveCurrentLicense(taLicense);
        refreshLicenseLineBadge();
        var lid = taLicense.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      });
      structuredRows.addEventListener('focusout', function () {
        window.setTimeout(function () {
          var a = document.activeElement;
          if (a && structuredRows.contains(a)) return;
          saveCurrentLicense(taLicense);
          flushPendingNotesSave();
          if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
            window.scheduleRefreshAdminDupIfActive();
          }
        }, 0);
      });
      structuredRows.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.license-split-editor__sell-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var row = btn.closest('.license-split-editor__row');
        if (row && typeof window.adminLicenseSplitSellRowToDay === 'function') {
          window.adminLicenseSplitSellRowToDay(row);
        }
      });
    }
    wireLicenseSplitScrollSync();
    if (typeof window.wireLicenseSplitArrowNavigation === 'function') {
      window.wireLicenseSplitArrowNavigation();
    }
    if (typeof window.suspendedLicenseSplitWireScrollSync === 'function') {
      window.suspendedLicenseSplitWireScrollSync();
    }
    if (typeof window.expiredLicenseSplitWireScrollSync === 'function') {
      window.expiredLicenseSplitWireScrollSync();
    }

    taSuspended.addEventListener('input', function () {
      if (typeof window.suspendedLicenseSplitSyncRowsToTextarea === 'function') {
        window.suspendedLicenseSplitSyncRowsToTextarea();
      }
      saveCurrentSuspended(taSuspended);
      refreshSuspendedLineBadge();
      var lid = taSuspended.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    });

    var suspRowsEl = getEl('adminLicenciasSuspendedRows');
    if (suspRowsEl) {
      suspRowsEl.addEventListener('input', function () {
        if (typeof window.suspendedLicenseSplitSyncRowsToTextarea === 'function') {
          window.suspendedLicenseSplitSyncRowsToTextarea();
        }
        saveCurrentSuspended(taSuspended);
        refreshSuspendedLineBadge();
        var lid = taSuspended.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      });
      suspRowsEl.addEventListener('change', function () {
        if (typeof window.suspendedLicenseSplitSyncRowsToTextarea === 'function') {
          window.suspendedLicenseSplitSyncRowsToTextarea();
        }
        saveCurrentSuspended(taSuspended);
        refreshSuspendedLineBadge();
        var lid = taSuspended.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      });
    }

    taExpired.addEventListener('input', function () {
      if (typeof window.expiredLicenseSplitSyncRowsToTextarea === 'function') {
        window.expiredLicenseSplitSyncRowsToTextarea();
      }
      saveCurrentExpired(taExpired);
      refreshExpiredLineBadge();
      var lidE = taExpired.dataset.licenseId;
      if (lidE) scheduleSaveNotes(lidE);
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    });

    var expRowsEl = getEl('adminLicenciasExpiredRows');
    if (expRowsEl) {
      expRowsEl.addEventListener('input', function () {
        if (typeof window.expiredLicenseSplitSyncRowsToTextarea === 'function') {
          window.expiredLicenseSplitSyncRowsToTextarea();
        }
        saveCurrentExpired(taExpired);
        refreshExpiredLineBadge();
        var lidR = taExpired.dataset.licenseId;
        if (lidR) scheduleSaveNotes(lidR);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      });
      expRowsEl.addEventListener('change', function () {
        if (typeof window.expiredLicenseSplitSyncRowsToTextarea === 'function') {
          window.expiredLicenseSplitSyncRowsToTextarea();
        }
        saveCurrentExpired(taExpired);
        refreshExpiredLineBadge();
        var lidC = taExpired.dataset.licenseId;
        if (lidC) scheduleSaveNotes(lidC);
        if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
          window.scheduleRefreshAdminDupIfActive();
        }
      });
    }

    function keydownCtrlEnterSave(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        flushPendingNotesSave();
      }
    }

    taLicense.addEventListener('keydown', keydownCtrlEnterSave);
    taSuspended.addEventListener('keydown', keydownCtrlEnterSave);
    taExpired.addEventListener('keydown', keydownCtrlEnterSave);

    bindSingleClickToUnlock(taPersonal);
    taLicense.addEventListener(
      'beforeinput',
      function (e) {
        if (notepadIsLocked(taLicense)) {
          e.preventDefault();
        }
      },
      true
    );
    taLicense.addEventListener(
      'paste',
      function (e) {
        if (notepadIsLocked(taLicense)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    var splitRoot = getEl('adminLicenciasLicenseSplitRoot');
    if (splitRoot) {
      splitRoot.addEventListener(
        'mousedown',
        function (e) {
          if (String(taLicense.dataset.licenseId || '') === '0') return;
          if (!splitRoot.classList.contains('license-notepad--locked')) return;
          if (e.target.closest && e.target.closest('.license-split-editor__user-suggestions')) return;
          var inCreds =
            e.target === taLicense ||
            (e.target.closest && e.target.closest('.license-split-editor__creds-cell'));
          var inSide = e.target.closest && e.target.closest('.license-split-editor__side');
          if (!inCreds && !inSide) return;
          unlockLicenseSplit(taLicense);
          if (e.target.closest && e.target.closest('.license-split-editor__sell-btn')) {
            return;
          }
          if (e.target.closest && e.target.closest('.license-split-editor__day-num')) {
            var dayEl = e.target.closest('.license-split-editor__day-num');
            if (dayEl) {
              e.preventDefault();
              dayEl.focus();
            }
            return;
          }
          var cell =
            e.target.closest &&
            e.target.closest(
              '.license-split-editor__user, .license-split-editor__status-good, .license-split-editor__status-bad, .license-split-editor__otro-combined, .license-split-editor__note'
            );
          if (!cell && e.target.closest) {
            var uw = e.target.closest('.license-split-editor__user-wrap');
            if (uw) cell = uw.querySelector('.license-split-editor__user');
          }
          if (!cell && e.target.closest) {
            var row = e.target.closest('.license-split-editor__row');
            if (row) cell = row.querySelector('.license-split-editor__user');
          }
          if (inSide && cell) {
            e.preventDefault();
            cell.focus();
          } else if (inSide) {
            e.preventDefault();
            taLicense.focus();
          } else if (inCreds) {
            e.preventDefault();
            taLicense.focus();
          }
        },
        true
      );
      splitRoot.addEventListener('focusout', function () {
        if (String(taLicense.dataset.licenseId || '') === '0') return;
        window.setTimeout(function () {
          var a = document.activeElement;
          if (a && splitRoot.contains(a)) return;
          saveCurrentLicense(taLicense);
          flushPendingNotesSave();
          lockLicenseSplit(taLicense);
        }, 0);
      });
    }

    var suspRoot = getEl('adminLicenciasSuspendedSplitRoot');
    if (suspRoot) {
      suspRoot.addEventListener(
        'mousedown',
        function (e) {
          if (String(taSuspended.dataset.licenseId || '') === '0') return;
          if (!suspRoot.classList.contains('license-notepad--locked')) return;
          if (e.target.closest && e.target.closest('.license-split-editor__restore-to-license-btn')) return;
          var inCreds =
            e.target === taSuspended ||
            (e.target.closest && e.target.closest('.license-split-editor__creds-cell'));
          var inSide = e.target.closest && e.target.closest('.license-split-editor__side');
          if (!inCreds && !inSide) return;
          if (typeof window.suspendedLicenseSplitUnlock === 'function') {
            window.suspendedLicenseSplitUnlock(suspRoot);
          }
          var cell =
            e.target.closest &&
            e.target.closest(
              '.license-split-editor__status-bad, .license-split-editor__otro-combined, .license-split-editor__note'
            );
          if (!cell && e.target.closest) {
            var srow = e.target.closest('.license-split-editor__row');
            if (srow) {
              cell =
                srow.querySelector('.license-split-editor__status-bad') ||
                srow.querySelector('.license-split-editor__note');
            }
          }
          if (inSide && cell) {
            e.preventDefault();
            cell.focus();
          } else if (inSide) {
            e.preventDefault();
            taSuspended.focus();
          } else if (inCreds) {
            e.preventDefault();
            taSuspended.focus();
          }
        },
        true
      );
      suspRoot.addEventListener('focusout', function () {
        if (String(taSuspended.dataset.licenseId || '') === '0') return;
        window.setTimeout(function () {
          var a = document.activeElement;
          if (a && suspRoot.contains(a)) return;
          saveCurrentSuspended(taSuspended);
          flushPendingNotesSave();
          if (typeof window.suspendedLicenseSplitLock === 'function') {
            window.suspendedLicenseSplitLock(suspRoot);
          }
          if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
            window.scheduleRefreshAdminDupIfActive();
          }
        }, 0);
      });
    }

    var expRoot = getEl('adminLicenciasExpiredSplitRoot');
    if (expRoot) {
      expRoot.addEventListener(
        'mousedown',
        function (e) {
          if (String(taExpired.dataset.licenseId || '') === '0') return;
          if (!expRoot.classList.contains('license-notepad--locked')) return;
          if (e.target.closest && e.target.closest('.license-split-editor__restore-to-license-btn')) return;
          var inCredsE =
            e.target === taExpired ||
            (e.target.closest && e.target.closest('.license-split-editor__creds-cell'));
          var inSideE = e.target.closest && e.target.closest('.license-split-editor__side');
          if (!inCredsE && !inSideE) return;
          if (typeof window.expiredLicenseSplitUnlock === 'function') {
            window.expiredLicenseSplitUnlock(expRoot);
          }
          var cellE =
            e.target.closest &&
            e.target.closest(
              '.license-split-editor__status-bad, .license-split-editor__otro-combined, .license-split-editor__note'
            );
          if (!cellE && e.target.closest) {
            var erow = e.target.closest('.license-split-editor__row');
            if (erow) {
              cellE =
                erow.querySelector('.license-split-editor__status-bad') ||
                erow.querySelector('.license-split-editor__note');
            }
          }
          if (inSideE && cellE) {
            e.preventDefault();
            cellE.focus();
          } else if (inSideE) {
            e.preventDefault();
            taExpired.focus();
          } else if (inCredsE) {
            e.preventDefault();
            taExpired.focus();
          }
        },
        true
      );
      expRoot.addEventListener('focusout', function () {
        if (String(taExpired.dataset.licenseId || '') === '0') return;
        window.setTimeout(function () {
          var a = document.activeElement;
          if (a && expRoot.contains(a)) return;
          saveCurrentExpired(taExpired);
          flushPendingNotesSave();
          if (typeof window.expiredLicenseSplitLock === 'function') {
            window.expiredLicenseSplitLock(expRoot);
          }
          if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
            window.scheduleRefreshAdminDupIfActive();
          }
        }, 0);
      });
    }

    if (!window._adminLicNotesVisHook) {
      window._adminLicNotesVisHook = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          flushPendingNotesSave();
        }
      });
    }
    taPersonal.addEventListener('blur', function () {
      lockNotepadEditable(taPersonal);
    });

    lockNotepadEditable(taPersonal);
    lockLicenseSplit(taLicense);
    lockSuspendedSplit(taSuspended);
    lockExpiredSplit(taExpired);
    lockChangesSplit();

    initUndoNotepads();

    if (!window._adminLicSplitResizeWired) {
      window._adminLicSplitResizeWired = true;
      var licResizeT = null;
      window.addEventListener('resize', function () {
        clearTimeout(licResizeT);
        licResizeT = setTimeout(function () {
          if (typeof window.adminLicenseSplitScheduleAutosizeCreds === 'function') {
            window.adminLicenseSplitScheduleAutosizeCreds();
          }
          if (typeof window.suspendedLicenseSplitScheduleAutosize === 'function') {
            window.suspendedLicenseSplitScheduleAutosize();
          }
          if (typeof window.expiredLicenseSplitScheduleAutosize === 'function') {
            window.expiredLicenseSplitScheduleAutosize();
          }
          if (typeof window.changesLicenseSplitScheduleAutosize === 'function') {
            window.changesLicenseSplitScheduleAutosize();
          }
        }, 120);
      });
    }

    currentLicenseId = null;
  }

  function bindLicense(licenseId, productName, licenseRow) {
    var taPersonal = getEl('adminLicenciasNotepadPersonal');
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    var taSuspended = getEl('adminLicenciasSuspendedNotepad');
    var taExpired = getEl('adminLicenciasExpiredNotepad');
    if (!taPersonal || !taLicense || !taSuspended || !taExpired) return;

    var idStr = String(licenseId);
    if (currentLicenseId !== null && currentLicenseId !== idStr) {
      if (currentLicenseId !== '0') {
        savePersonalForId(currentLicenseId, taPersonal.value);
        saveLicenseForId(currentLicenseId, licenseMergedOrBlockText(taLicense));
        saveSuspendedForId(currentLicenseId, licenseBlockText(taSuspended));
        saveExpiredForId(currentLicenseId, licenseBlockText(taExpired));
      }
      flushPendingNotesSave();
    }

    currentLicenseId = idStr;
    taPersonal.dataset.licenseId = idStr;
    taLicense.dataset.licenseId = idStr;
    taSuspended.dataset.licenseId = idStr;
    taExpired.dataset.licenseId = idStr;
    var suspRootBind = getEl('adminLicenciasSuspendedSplitRoot');
    if (suspRootBind) suspRootBind.dataset.licenseId = idStr;
    var expRootBind = getEl('adminLicenciasExpiredSplitRoot');
    if (expRootBind) expRootBind.dataset.licenseId = idStr;

    if (String(licenseId) === '0') {
      taPersonal.value =
        'En la vista «Todos» no hay notas por producto. Elige una plataforma en la cuadrícula para editar notas en este dispositivo.';
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText('');
      }
      setLicenseBlockPlainText(
        taLicense,
        'En la vista «Todos» no se editan licencias aquí. Abre cada producto para el bloc de licencias.'
      );
      var splitSide = document.querySelector('#adminLicenciasLicenseSplitRoot .license-split-editor__side');
      if (splitSide) splitSide.hidden = true;
      setLicenseBlockPlainText(
        taSuspended,
        'En la vista «Todos» no se editan cuentas caídas aquí. Elige una plataforma.'
      );
      setLicenseBlockPlainText(
        taExpired,
        'En la vista «Todos» no se editan cuentas vencidas aquí. Elige una plataforma.'
      );
      setLicenseHeading(productName || 'Todos');
      resetUndoNotepads();
      lockNotepadEditable(taPersonal);
      lockLicenseSplit(taLicense);
      lockSuspendedSplit(taSuspended);
      lockExpiredSplit(taExpired);
      lockChangesSplit();
      refreshLicenseLineBadge();
      refreshPersonalLineBadge();
      refreshSuspendedLineBadge();
      refreshExpiredLineBadge();
      refreshChangesLineBadge();
      if (typeof window.adminLicenseSplitScheduleAutosizeCreds === 'function') {
        window.requestAnimationFrame(function () {
          window.adminLicenseSplitScheduleAutosizeCreds();
        });
      }
      if (typeof window.suspendedLicenseSplitScheduleAutosize === 'function') {
        window.requestAnimationFrame(function () {
          window.suspendedLicenseSplitScheduleAutosize();
        });
      }
      if (typeof window.expiredLicenseSplitScheduleAutosize === 'function') {
        window.requestAnimationFrame(function () {
          window.expiredLicenseSplitScheduleAutosize();
        });
      }
      if (typeof window.changesLicenseSplitScheduleAutosize === 'function') {
        window.requestAnimationFrame(function () {
          window.changesLicenseSplitScheduleAutosize();
        });
      }
      return;
    }

    taPersonal.readOnly = false;
    var splitSideOpen = document.querySelector('#adminLicenciasLicenseSplitRoot .license-split-editor__side');
    if (splitSideOpen) splitSideOpen.hidden = false;
    loadPersonalForId(licenseId, taPersonal, licenseRow);
    loadLicenseForId(licenseId, taLicense, licenseRow);
    loadSuspendedForId(licenseId, taSuspended, licenseRow);
    loadExpiredForId(licenseId, taExpired, licenseRow);
    var sanitizedLicense = sanitizeStandaloneGenericoInLicenseSplit(taLicense);
    var sanitizedSuspended = sanitizeStandaloneGenericoInSuspendedSplit(taSuspended);
    var sanitizedExpired = sanitizeStandaloneGenericoInExpiredSplit(taExpired);
    var sanitizedChanges = sanitizeStandaloneGenericoInChangesSplit();
    if (sanitizedLicense) saveCurrentLicense(taLicense);
    if (sanitizedSuspended) saveCurrentSuspended(taSuspended);
    if (sanitizedExpired) saveCurrentExpired(taExpired);
    if (sanitizedChanges) {
      document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(function (r) {
        var cid = r.dataset.licenseId;
        if (cid) scheduleSaveChangesNotesOnly(cid);
      });
    }
    if (sanitizedLicense || sanitizedSuspended || sanitizedExpired) scheduleSaveNotes(licenseId);
    setLicenseHeading(productName || '');
    resetUndoNotepads();
    lockNotepadEditable(taPersonal);
    lockLicenseSplit(taLicense);
    lockSuspendedSplit(taSuspended);
    lockExpiredSplit(taExpired);
    lockChangesSplit();
    refreshLicenseLineBadge();
    refreshPersonalLineBadge();
    refreshSuspendedLineBadge();
    refreshExpiredLineBadge();
    refreshChangesLineBadge();
    if (typeof window.refreshChangesProductsListing === 'function') {
      window.refreshChangesProductsListing();
    }
    if (typeof window.suspendedLicenseSplitScheduleAutosize === 'function') {
      window.requestAnimationFrame(function () {
        window.suspendedLicenseSplitScheduleAutosize();
      });
    }
    if (typeof window.expiredLicenseSplitScheduleAutosize === 'function') {
      window.requestAnimationFrame(function () {
        window.expiredLicenseSplitScheduleAutosize();
      });
    }
    if (typeof window.changesLicenseSplitScheduleAutosize === 'function') {
      window.requestAnimationFrame(function () {
        window.changesLicenseSplitScheduleAutosize();
      });
    }
  }

  function flushLicense() {
    var taPersonal = getEl('adminLicenciasNotepadPersonal');
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    var taSuspended = getEl('adminLicenciasSuspendedNotepad');
    var taExpired = getEl('adminLicenciasExpiredNotepad');
    if (!taLicense || !taSuspended || !taExpired || currentLicenseId === null) return;
    savePersonalForId(currentLicenseId, taPersonal ? taPersonal.value : '');
    saveLicenseForId(currentLicenseId, licenseMergedOrBlockText(taLicense));
    saveSuspendedForId(currentLicenseId, licenseBlockText(taSuspended));
    saveExpiredForId(currentLicenseId, licenseBlockText(taExpired));
    flushPendingNotesSave();
    currentLicenseId = null;
    setLicenseHeading('');
  }

  function refreshLicenseSplitFromApi(licenseRow) {
    if (!licenseRow || licenseRow.id == null) return;
    var idStr = String(licenseRow.id);
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    if (!taLicense || String(taLicense.dataset.licenseId) !== idStr) return;
    if (!Object.prototype.hasOwnProperty.call(licenseRow, 'license_notes')) return;
    var v = licenseRow.license_notes != null ? String(licenseRow.license_notes) : '';
    v = stripStandaloneGenericoLines(v);
    var cur = '';
    if (typeof window.adminLicenseSplitGetMergedNotes === 'function') {
      cur = String(window.adminLicenseSplitGetMergedNotes()).replace(/\r\n/g, '\n').trimEnd();
    } else {
      cur = licenseMergedOrBlockText(taLicense).replace(/\r\n/g, '\n').trimEnd();
    }
    var next = v.replace(/\r\n/g, '\n').trimEnd();
    if (cur === next) return;
    if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
      window.adminLicenseSplitApplyMergedText(v);
    } else {
      setLicenseBlockPlainText(taLicense, v);
    }
    saveLicenseForId(idStr, licenseMergedOrBlockText(taLicense));
    refreshLicenseLineBadge();
    if (typeof window.adminLicenseSplitScheduleAutosizeCreds === 'function') {
      window.requestAnimationFrame(function () {
        window.adminLicenseSplitScheduleAutosizeCreds();
      });
    }
    if (typeof refreshDuplicateEmailHighlights === 'function') {
      refreshDuplicateEmailHighlights(parseInt(idStr, 10));
    }
  }

  window.initAdminLicenciasNotepad = init;
  window.adminLicenciasSaveCurrentLicenseNotesImmediate = saveCurrentLicenseNotesImmediate;
  window.adminLicenciasScheduleSaveChangesNotesOnly = scheduleSaveChangesNotesOnly;
  window.adminLicenciasFlushPendingChangesNotesSaves = flushPendingChangesNotesSaves;
  window.AdminLicenciasNotepad = {
    bindLicense: bindLicense,
    flushLicense: flushLicense,
    refreshLicenseSplitFromApi: refreshLicenseSplitFromApi
  };
})();
