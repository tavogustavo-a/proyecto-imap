/**
 * Bloc de notas (admin licencias): notas personales + licencias por producto.
 * Persistencia: base de datos (PUT /tienda/api/licenses/:id/notes) + localStorage como caché/offline.
 */
(function () {
  var PERSONAL_PREFIX = 'admin_licencias_bloc_personal_';
  var PERSONAL_SUFFIX = '_v1';
  var LICENSE_PREFIX = 'admin_licencias_bloc_license_';
  var LICENSE_SUFFIX = '_v1';
  /** Borrador columna credenciales (textarea crudo); no confundir con LICENSE_PREFIX (merged pipe). */
  var LICENSE_CREDS_DRAFT_PREFIX = 'admin_licencias_license_creds_draft_';
  var LICENSE_CREDS_DRAFT_SUFFIX = '_v1';
  var SUSPENDED_PREFIX = 'admin_licencias_bloc_suspended_';
  var SUSPENDED_SUFFIX = '_v1';
  var EXPIRED_PREFIX = 'admin_licencias_bloc_expired_';
  var EXPIRED_SUFFIX = '_v1';
  var CUSTOMER_RENEWAL_PREFIX = 'admin_licencias_bloc_customer_renewal_';
  var CUSTOMER_RENEWAL_SUFFIX = '_v1';
  var CHANGES_PREFIX = 'admin_licencias_bloc_changes_';
  var CHANGES_SUFFIX = '_v1';
  var LEGACY_PERSONAL_GLOBAL = 'admin_licencias_bloc_personal_v1';
  var LEGACY_BLOC_V1 = 'admin_licencias_bloc_v1';

  var currentLicenseId = null;
  var saveNotesTimer = null;
  var saveLicenseNotesTimer = null;
  /** PUT /notes en vuelo (evita que SSE/poll pisen el bloc con datos viejos del servidor). */
  var notesSaveInFlight = false;
  var licenseNotesSaveInFlight = false;
  /* Corto: bloc licencias (incl. columna notas) debe persistir pronto si se recarga o se cambia de pestaña. */
  var SAVE_DEBOUNCE_MS = 180;
  var SAVE_LICENSE_DEBOUNCE_MS = 120;
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

  function licenseCredsDraftKey(id) {
    return LICENSE_CREDS_DRAFT_PREFIX + id + LICENSE_CREDS_DRAFT_SUFFIX;
  }

  function normalizeLicenseCredsDraft(text) {
    return String(text != null ? text : '').replace(/\r\n/g, '\n');
  }

  function saveLicenseCredsDraft(licenseId, rawTaValue) {
    if (licenseId === null || licenseId === undefined || licenseId === '' || String(licenseId) === '0') {
      return;
    }
    try {
      localStorage.setItem(licenseCredsDraftKey(licenseId), normalizeLicenseCredsDraft(rawTaValue));
    } catch (e) {}
  }

  function loadLicenseCredsDraft(licenseId) {
    try {
      var v = localStorage.getItem(licenseCredsDraftKey(licenseId));
      return v === null ? null : v;
    } catch (e) {
      return null;
    }
  }

  function clearLicenseCredsDraft(licenseId) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.removeItem(licenseCredsDraftKey(licenseId));
    } catch (e) {}
  }

  function isUserEditingMainLicenseSplit() {
    var ae = document.activeElement;
    var splitRoot = getEl('adminLicenciasLicenseSplitRoot');
    return !!(ae && splitRoot && splitRoot.contains(ae));
  }

  /** Tras aplicar merged: restaurar solo si el borrador es edición en curso (más largo / fila nueva), nunca uno más corto. */
  function restoreLicenseCredsDraftAfterApply(ta, licenseId) {
    if (!ta || ta.id !== 'adminLicenciasNotepadByLicense' || String(licenseId) === '0') return;
    var draft = loadLicenseCredsDraft(licenseId);
    if (draft === null) return;
    var draftNorm = normalizeLicenseCredsDraft(draft);
    var appliedNorm = normalizeLicenseCredsDraft(ta.value);
    if (draftNorm === appliedNorm) {
      clearLicenseCredsDraft(licenseId);
      return;
    }
    /* Borrador viejo (p. ej. keydown antes del \n): no pisar licencias ya cargadas. */
    if (draftNorm.length < appliedNorm.length) {
      clearLicenseCredsDraft(licenseId);
      return;
    }
    var appliedCore = appliedNorm.replace(/\n+$/, '');
    var draftCore = draftNorm.replace(/\n+$/, '');
    if (draftCore.length < appliedCore.length) {
      clearLicenseCredsDraft(licenseId);
      return;
    }
    if (draftCore !== appliedCore.slice(0, draftCore.length)) {
      clearLicenseCredsDraft(licenseId);
      return;
    }
    ta.value = draftNorm;
    if (typeof window.adminLicenseSplitSyncRowsToTextarea === 'function') {
      window.adminLicenseSplitSyncRowsToTextarea();
    }
  }

  function suspendedStorageKey(id) {
    return SUSPENDED_PREFIX + id + SUSPENDED_SUFFIX;
  }

  function expiredStorageKey(id) {
    return EXPIRED_PREFIX + id + EXPIRED_SUFFIX;
  }

  function customerRenewalStorageKey(id) {
    return CUSTOMER_RENEWAL_PREFIX + id + CUSTOMER_RENEWAL_SUFFIX;
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

  function saveCustomerRenewalForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(customerRenewalStorageKey(licenseId), value);
    } catch (e) {}
  }

  function saveChangesForId(licenseId, value) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    try {
      localStorage.setItem(changesStorageKey(licenseId), value);
    } catch (e) {}
  }

  function readPersonalFromLocalRaw(licenseId) {
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
      return s;
    } catch (e) {
      return null;
    }
  }

  function normalizePersonalNotesText(text) {
    return String(text != null ? text : '').replace(/\r\n/g, '\n');
  }

  function loadPersonalFromLocalOnly(licenseId, ta) {
    var s = readPersonalFromLocalRaw(licenseId);
    ta.value = s !== null ? s : '';
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
    if (
      el.id === 'adminLicenciasNotepadByCustomerRenewal' &&
      typeof window.customerRenewalLicenseSplitGetMergedText === 'function'
    ) {
      var custRoot = getEl('adminLicenciasCustomerRenewalSplitRoot');
      if (custRoot) {
        return window.customerRenewalLicenseSplitGetMergedText(custRoot);
      }
    }
    return el.tagName === 'TEXTAREA' ? el.value : el.innerText || '';
  }

  function customerRenewalMergedOrBlockText(ta) {
    if (
      ta &&
      ta.id === 'adminLicenciasNotepadByCustomerRenewal' &&
      typeof window.customerRenewalLicenseSplitGetMergedText === 'function'
    ) {
      var root = getEl('adminLicenciasCustomerRenewalSplitRoot');
      if (root) {
        return window.customerRenewalLicenseSplitGetMergedText(root);
      }
    }
    return licenseBlockText(ta);
  }

  /** Solo columna credenciales (izquierda), para comparar servidor ↔ UI sin falsos positivos. */
  function customerRenewalCredColumnKeyFromStorageText(text) {
    var lines = String(text || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter(function (line) {
        return String(line || '').trim() !== '';
      });
    var sep = '\x1f';
    var creds = lines.map(function (ln) {
      var raw = String(ln || '');
      if (raw.indexOf(sep) >= 0) {
        return raw.slice(0, raw.indexOf(sep));
      }
      return raw;
    });
    return creds.join('\n').replace(/\r\n/g, '\n').trimEnd();
  }

  function customerRenewalCredColumnKeyFromOpenBloc(taCR) {
    if (!taCR) return '';
    if (taCR.tagName === 'TEXTAREA') {
      return String(taCR.value != null ? taCR.value : '')
        .replace(/\r\n/g, '\n')
        .trimEnd();
    }
    return customerRenewalCredColumnKeyFromStorageText(customerRenewalMergedOrBlockText(taCR));
  }

  function customerRenewalSplitNeedsForcedServerSync(licenseRow, taCR) {
    if (!licenseRow || !taCR) return false;
    if (!Object.prototype.hasOwnProperty.call(licenseRow, 'customer_renewal_notes')) return false;
    var serverText = licenseRow.customer_renewal_notes != null ? String(licenseRow.customer_renewal_notes) : '';
    serverText = stripStandaloneGenericoLines(serverText);
    if (!customerRenewalCredColumnKeyFromStorageText(serverText).trim()) return false;
    return !customerRenewalCredColumnKeyFromOpenBloc(taCR).trim();
  }

  function licenseMergedOrBlockText(ta) {
    if (
      ta &&
      ta.id === 'adminLicenciasNotepadByLicense' &&
      typeof window.adminLicenseSplitMergedTextForSave === 'function'
    ) {
      return window.adminLicenseSplitMergedTextForSave();
    }
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
    window.adminLicenseSplitApplyMergedText(clean, { force: true });
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

  function refreshCustomerRenewalLineBadge() {
    if (typeof window.updateCustomerRenewalBlocLineCountBadge === 'function') {
      window.updateCustomerRenewalBlocLineCountBadge();
    }
  }

  function refreshChangesLineBadge() {
    if (typeof window.updateChangesBlocLineCountBadge === 'function') {
      window.updateChangesBlocLineCountBadge();
    }
  }

  function setLicenseBlockPlainText(el, text) {
    if (!el) return;
    if (el.id === 'adminLicenciasNotepadByLicense') {
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText(text != null ? text : '', { force: true });
      } else if (el.tagName === 'TEXTAREA') {
        el.value = text != null ? text : '';
      }
      return;
    }
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
    if (el.id === 'adminLicenciasNotepadByCustomerRenewal') {
      var custRootSet = getEl('adminLicenciasCustomerRenewalSplitRoot');
      var custRows = getEl('adminLicenciasCustomerRenewalStructuredRows');
      if (String(el.dataset.licenseId || '') === '0') {
        if (custRows) custRows.innerHTML = '';
        if (el.tagName === 'TEXTAREA') {
          el.value = text != null ? text : '';
        }
        return;
      }
      if (custRootSet && typeof window.customerRenewalLicenseSplitApplyMergedText === 'function') {
        window.customerRenewalLicenseSplitApplyMergedText(custRootSet, text != null ? text : '');
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
        window.adminLicenseSplitApplyMergedText(v, { force: true });
      } else {
        setLicenseBlockPlainText(ta, v);
      }
      restoreLicenseCredsDraftAfterApply(ta, licenseId);
    } catch (e) {
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText('', { force: true });
      } else {
        setLicenseBlockPlainText(ta, '');
      }
      restoreLicenseCredsDraftAfterApply(ta, licenseId);
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

  function loadCustomerRenewalFromLocalOnly(licenseId, el) {
    try {
      var s = localStorage.getItem(customerRenewalStorageKey(licenseId));
      var v = s !== null ? s : '';
      v = stripStandaloneGenericoLines(v);
      if (typeof window.customerRenewalLicenseSplitApplyMergedText === 'function') {
        var root = getEl('adminLicenciasCustomerRenewalSplitRoot');
        if (root) {
          window.customerRenewalLicenseSplitApplyMergedText(root, v);
        }
      } else {
        setLicenseBlockPlainText(el, v);
      }
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
   * Si hay datos del API (licenseRow), la base de datos manda salvo caché local más reciente
   * (p. ej. recarga antes de que termine el PUT o edición aún en el textarea).
   */
  function loadPersonalForId(licenseId, ta, licenseRow, opts) {
    opts = opts || {};
    var trustOpenUi = opts.trustOpenUi !== false;
    var localRaw = readPersonalFromLocalRaw(licenseId);
    var localNorm = localRaw !== null ? normalizePersonalNotesText(localRaw) : null;
    var serverNorm = null;
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'personal_notes')) {
      serverNorm = normalizePersonalNotesText(
        licenseRow.personal_notes != null ? String(licenseRow.personal_notes) : ''
      );
    }
    var openNorm =
      trustOpenUi && ta && String(currentLicenseId) === String(licenseId)
        ? normalizePersonalNotesText(ta.value)
        : null;

    if (openNorm !== null && serverNorm !== null && openNorm !== serverNorm) {
      ta.value = ta.value != null ? String(ta.value) : '';
      savePersonalForId(licenseId, ta.value);
      scheduleSaveNotes(licenseId);
      return;
    }

    if (localNorm !== null && serverNorm !== null && localNorm !== serverNorm) {
      ta.value = localRaw !== null ? localRaw : '';
      savePersonalForId(licenseId, ta.value);
      scheduleSaveNotes(licenseId);
      return;
    }

    if (serverNorm !== null) {
      var v = licenseRow.personal_notes != null ? String(licenseRow.personal_notes) : '';
      ta.value = v;
      savePersonalForId(licenseId, v);
      return;
    }
    loadPersonalFromLocalOnly(licenseId, ta);
  }

  function normalizeBlocNotesText(text) {
    return String(text != null ? text : '').replace(/\r\n/g, '\n');
  }

  /** Texto persistido en localStorage para el bloc Licencias (misma normalización que loadLicenseForId). */
  function licenseNotesLocalNormalized(licenseId) {
    var localRaw = readLocalStorageRaw(function () {
      return localStorage.getItem(licenseStorageKey(licenseId));
    });
    if (localRaw === null) return { raw: null, norm: null };
    var norm = normalizeBlocNotesText(stripStandaloneGenericoLines(localRaw));
    return { raw: localRaw, norm: norm };
  }

  function licenseNotesServerNormalized(serverText) {
    return normalizeBlocNotesText(stripStandaloneGenericoLines(serverText != null ? String(serverText) : ''));
  }

  function readLocalStorageRaw(readFn) {
    try {
      return readFn();
    } catch (_e) {
      return null;
    }
  }

  function applyLicenseBlocText(ta, text) {
    if (isUserEditingMainLicenseSplit()) {
      return;
    }
    var v = text != null ? String(text) : '';
    v = stripStandaloneGenericoLines(v);
    if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
      window.adminLicenseSplitApplyMergedText(v, { force: true });
    } else {
      setLicenseBlockPlainText(ta, v);
    }
    var lid = ta && ta.dataset.licenseId;
    if (lid) restoreLicenseCredsDraftAfterApply(ta, lid);
  }

  function loadLicenseForId(licenseId, ta, licenseRow, opts) {
    opts = opts || {};
    var trustOpenUi = opts.trustOpenUi !== false;
    var localRaw = readLocalStorageRaw(function () {
      return localStorage.getItem(licenseStorageKey(licenseId));
    });
    var localNorm = localRaw !== null ? normalizeBlocNotesText(stripStandaloneGenericoLines(localRaw)) : null;
    var credDraft = loadLicenseCredsDraft(licenseId);
    var credDraftTrim =
      credDraft !== null ? String(normalizeLicenseCredsDraft(credDraft)).replace(/\n+$/, '').trim() : '';
    var serverRaw =
      licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'license_notes')
        ? licenseRow.license_notes != null
          ? String(licenseRow.license_notes)
          : ''
        : null;
    var serverNorm =
      serverRaw !== null ? normalizeBlocNotesText(stripStandaloneGenericoLines(serverRaw)) : null;
    var openNorm =
      trustOpenUi && ta && String(currentLicenseId) === String(licenseId)
        ? normalizeBlocNotesText(stripStandaloneGenericoLines(licenseMergedOrBlockText(ta)))
        : null;

    /*
     * UI con contenido distinto al servidor: conservar UI y empujar al servidor.
     * NUNCA empujar vacío (textarea sin cargar aún) — eso borraba la BD con PUT 200.
     */
    if (openNorm !== null && serverNorm !== null && openNorm !== serverNorm && String(openNorm).trim() !== '') {
      saveCurrentLicense(ta);
      scheduleSaveLicenseNotesOnly(licenseId);
      return;
    }

    if (
      openNorm !== null &&
      serverNorm !== null &&
      String(openNorm).trim() === '' &&
      String(serverNorm).trim() !== ''
    ) {
      applyLicenseBlocText(ta, serverRaw);
      saveCurrentLicense(ta);
      return;
    }

    if (localNorm !== null && localNorm !== '' && serverNorm !== null && localNorm !== serverNorm) {
      applyLicenseBlocText(ta, localRaw);
      saveCurrentLicense(ta);
      scheduleSaveLicenseNotesOnly(licenseId);
      return;
    }
    if (
      credDraftTrim !== '' &&
      serverNorm !== null &&
      serverNorm === '' &&
      (localNorm === null || localNorm === '')
    ) {
      applyLicenseBlocText(ta, '');
      restoreLicenseCredsDraftAfterApply(ta, licenseId);
      saveCurrentLicense(ta);
      scheduleSaveLicenseNotesOnly(licenseId);
      return;
    }
    if (serverNorm !== null && serverNorm !== '') {
      applyLicenseBlocText(ta, serverRaw);
      saveCurrentLicense(ta);
      return;
    }
    if (localNorm !== null && localNorm !== '') {
      applyLicenseBlocText(ta, localRaw);
      saveCurrentLicense(ta);
      scheduleSaveLicenseNotesOnly(licenseId);
      return;
    }
    loadLicenseFromLocalOnly(licenseId, ta);
  }

  function loadSuspendedForId(licenseId, el, licenseRow, opts) {
    opts = opts || {};
    var trustOpenUi = opts.trustOpenUi !== false;
    var localRaw = readLocalStorageRaw(function () {
      return localStorage.getItem(suspendedStorageKey(licenseId));
    });
    var localNorm = localRaw !== null ? normalizeBlocNotesText(localRaw) : null;
    var serverNorm = null;
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'suspended_notes')) {
      serverNorm = normalizeBlocNotesText(
        licenseRow.suspended_notes != null ? String(licenseRow.suspended_notes) : ''
      );
    }
    var openNorm =
      trustOpenUi && el && String(currentLicenseId) === String(licenseId)
        ? normalizeBlocNotesText(licenseBlockText(el))
        : null;

    if (openNorm !== null && serverNorm !== null && openNorm !== serverNorm) {
      saveCurrentSuspended(el);
      scheduleSaveNotes(licenseId);
      return;
    }
    if (localNorm !== null && serverNorm !== null && localNorm !== serverNorm) {
      setLicenseBlockPlainText(el, localRaw);
      saveCurrentSuspended(el);
      scheduleSaveNotes(licenseId);
      return;
    }
    if (serverNorm !== null) {
      var v = licenseRow.suspended_notes != null ? String(licenseRow.suspended_notes) : '';
      setLicenseBlockPlainText(el, v);
      saveSuspendedForId(licenseId, v);
      return;
    }
    loadSuspendedFromLocalOnly(licenseId, el);
  }

  function loadExpiredForId(licenseId, el, licenseRow, opts) {
    opts = opts || {};
    var trustOpenUi = opts.trustOpenUi !== false;
    var localRaw = readLocalStorageRaw(function () {
      return localStorage.getItem(expiredStorageKey(licenseId));
    });
    var localNorm = localRaw !== null ? normalizeBlocNotesText(localRaw) : null;
    var serverNorm = null;
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'expired_notes')) {
      serverNorm = normalizeBlocNotesText(
        licenseRow.expired_notes != null ? String(licenseRow.expired_notes) : ''
      );
    }
    var openNorm =
      trustOpenUi && el && String(currentLicenseId) === String(licenseId)
        ? normalizeBlocNotesText(licenseBlockText(el))
        : null;

    if (openNorm !== null && serverNorm !== null && openNorm !== serverNorm) {
      saveCurrentExpired(el);
      scheduleSaveNotes(licenseId);
      return;
    }
    if (localNorm !== null && serverNorm !== null && localNorm !== serverNorm) {
      setLicenseBlockPlainText(el, localRaw);
      saveCurrentExpired(el);
      scheduleSaveNotes(licenseId);
      return;
    }
    if (serverNorm !== null) {
      var ve = licenseRow.expired_notes != null ? String(licenseRow.expired_notes) : '';
      setLicenseBlockPlainText(el, ve);
      saveExpiredForId(licenseId, ve);
      return;
    }
    loadExpiredFromLocalOnly(licenseId, el);
  }

  function loadCustomerRenewalForId(licenseId, el, licenseRow, opts) {
    opts = opts || {};
    var trustOpenUi = opts.trustOpenUi !== false;
    if (el && el.dataset.customerRenewalDirty === '1') {
      saveCurrentCustomerRenewal(el);
      return;
    }
    var localRaw = readLocalStorageRaw(function () {
      return localStorage.getItem(customerRenewalStorageKey(licenseId));
    });
    var localNorm = localRaw !== null ? normalizeBlocNotesText(stripStandaloneGenericoLines(localRaw)) : null;
    var serverNorm = null;
    if (licenseRow && Object.prototype.hasOwnProperty.call(licenseRow, 'customer_renewal_notes')) {
      serverNorm = normalizeBlocNotesText(
        stripStandaloneGenericoLines(
          licenseRow.customer_renewal_notes != null ? String(licenseRow.customer_renewal_notes) : ''
        )
      );
    }
    var openNorm =
      trustOpenUi && el && String(currentLicenseId) === String(licenseId)
        ? normalizeBlocNotesText(stripStandaloneGenericoLines(customerRenewalMergedOrBlockText(el)))
        : null;

    if (openNorm !== null && serverNorm !== null && openNorm !== serverNorm) {
      saveCurrentCustomerRenewal(el);
      scheduleSaveNotes(licenseId);
      return;
    }
    if (localNorm !== null && serverNorm !== null && localNorm !== serverNorm) {
      var localApply = stripStandaloneGenericoLines(localRaw);
      if (typeof window.customerRenewalLicenseSplitApplyMergedText === 'function') {
        var rootLocal = getEl('adminLicenciasCustomerRenewalSplitRoot');
        if (rootLocal) {
          window.customerRenewalLicenseSplitApplyMergedText(rootLocal, localApply);
        }
      } else {
        setLicenseBlockPlainText(el, localApply);
      }
      saveCurrentCustomerRenewal(el);
      scheduleSaveNotes(licenseId);
      return;
    }
    if (serverNorm !== null) {
      var vr = licenseRow.customer_renewal_notes != null ? String(licenseRow.customer_renewal_notes) : '';
      vr = stripStandaloneGenericoLines(vr);
      if (typeof window.customerRenewalLicenseSplitApplyMergedText === 'function') {
        var root = getEl('adminLicenciasCustomerRenewalSplitRoot');
        if (root) {
          window.customerRenewalLicenseSplitApplyMergedText(root, vr);
        }
      } else {
        setLicenseBlockPlainText(el, vr);
      }
      saveCustomerRenewalForId(licenseId, customerRenewalMergedOrBlockText(el));
      clearCustomerRenewalDirty(el);
      return;
    }
    loadCustomerRenewalFromLocalOnly(licenseId, el);
  }

  function saveCurrentPersonal(ta) {
    var lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    savePersonalForId(lid, ta.value);
  }

  function saveCurrentLicense(ta) {
    var lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    if (ta.id === 'adminLicenciasNotepadByLicense' && ta.tagName === 'TEXTAREA') {
      saveLicenseCredsDraft(lid, ta.value);
    }
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

  function saveCurrentCustomerRenewal(el) {
    var lid = el.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveCustomerRenewalForId(lid, customerRenewalMergedOrBlockText(el));
  }

  function saveCurrentChanges(el) {
    var lid = el.dataset.licenseId;
    if (lid === undefined || lid === '') return;
    saveChangesForId(lid, licenseBlockText(el));
  }

  function csrf() {
    return typeof getCSRFToken === 'function' ? getCSRFToken() : '';
  }

  function appendCustomerRenewalNotesToSaveBody(bodyObj, licenseId, taCR, opts) {
    if (!bodyObj || !taCR || String(taCR.dataset.licenseId) !== String(licenseId)) return;
    var merged = customerRenewalMergedOrBlockText(taCR);
    var allowEmpty = opts && opts.allowEmpty;
    var dirty = taCR.dataset.customerRenewalDirty === '1';
    /* Enviar vacío si el admin borró todo (dirty); si no, el servidor conserva filas antiguas. */
    if (allowEmpty || dirty || String(merged || '').trim() !== '') {
      bodyObj.customer_renewal_notes = merged != null ? merged : '';
    }
  }

  function markCustomerRenewalDirty(taCR) {
    if (taCR) taCR.dataset.customerRenewalDirty = '1';
  }

  function clearCustomerRenewalDirty(taCR) {
    if (taCR) delete taCR.dataset.customerRenewalDirty;
  }

  function licenseRowRenewCustomerAccount(licenseRow) {
    if (!licenseRow || licenseRow.renew_customer_account == null) return false;
    var v = licenseRow.renew_customer_account;
    if (v === true || v === 1) return true;
    if (typeof v === 'string') {
      var s = String(v).trim().toLowerCase();
      return s === '1' || s === 'true' || s === 'yes';
    }
    return false;
  }

  function syncCustomerRenewalBlocUiForLicense(licenseRow, taCustomerRenewal) {
    var heading = getEl('adminLicenciasCustomerRenewalHeading');
    if (heading) {
      heading.textContent = 'Cuentas para renovar';
    }
    if (taCustomerRenewal) {
      taCustomerRenewal.placeholder = 'Una por línea.';
    }
    if (taCustomerRenewal) {
      unlockCustomerRenewalSplit(taCustomerRenewal);
    }
  }

  function licenseNotesPutPayloadFromTa(taL) {
    var merged = licenseMergedOrBlockText(taL);
    var payload = { license_notes: merged };
    if (!String(stripStandaloneGenericoLines(merged)).trim()) {
      payload.license_notes_force_empty = true;
    }
    return payload;
  }

  function persistLicenseBlocNotesToServer(licenseId) {
    if (String(licenseId) === '0') return Promise.resolve({ success: false, error: 'aggregate' });
    var taL = getEl('adminLicenciasNotepadByLicense');
    if (!taL || String(taL.dataset.licenseId) !== String(licenseId)) {
      return Promise.resolve({ success: false, error: 'license_mismatch' });
    }
    saveCurrentLicense(taL);
    var notesPayload = licenseNotesPutPayloadFromTa(taL);
    var merged = notesPayload.license_notes;
    if (typeof adminLicFetchJson !== 'function') {
      return Promise.resolve({ success: false, error: 'fetch_unavailable' });
    }
    licenseNotesSaveInFlight = true;
    return adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notesPayload),
    })
      .then(function (data) {
        if (data.success && typeof window.adminLicMarkSelfLicenseNotesSaved === 'function') {
          window.adminLicMarkSelfLicenseNotesSaved(data.licenses_rev);
        }
        if (data.success && typeof window.patchLicenseNotesCache === 'function') {
          window.patchLicenseNotesCache(licenseId, undefined, merged);
        }
        if (data.success) {
          saveLicenseForId(licenseId, merged);
          var storedDraft = loadLicenseCredsDraft(licenseId);
          if (
            storedDraft === null ||
            normalizeLicenseCredsDraft(storedDraft) === normalizeLicenseCredsDraft(taL.value)
          ) {
            clearLicenseCredsDraft(licenseId);
          }
        }
        return data;
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar licencias'));
        }
        return { success: false, error: 'network' };
      })
      .finally(function () {
        licenseNotesSaveInFlight = false;
      });
  }

  function saveNotesToServer(licenseId) {
    if (String(licenseId) === '0') return;
    var taP = getEl('adminLicenciasNotepadPersonal');
    var taL = getEl('adminLicenciasNotepadByLicense');
    var taS = getEl('adminLicenciasSuspendedNotepad');
    var taE = getEl('adminLicenciasExpiredNotepad');
    var taCR = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (!taL) return;
    if (String(taL.dataset.licenseId) !== String(licenseId)) return;
    var idStr = String(licenseId);
    if (taP && String(taP.dataset.licenseId || '') !== idStr) taP.dataset.licenseId = idStr;
    if (taS && String(taS.dataset.licenseId || '') !== idStr) taS.dataset.licenseId = idStr;
    if (taE && String(taE.dataset.licenseId || '') !== idStr) taE.dataset.licenseId = idStr;
    if (!taP || !taS || !taE) return;
    saveCurrentPersonal(taP);
    saveCurrentLicense(taL);
    saveCurrentSuspended(taS);
    saveCurrentExpired(taE);
    if (taCR && String(taCR.dataset.licenseId) === String(licenseId)) {
      saveCurrentCustomerRenewal(taCR);
    }
    var licenseNotesPayload = licenseMergedOrBlockText(taL);
    var bodyObj = {
      personal_notes: taP.value,
      license_notes: licenseNotesPayload,
      suspended_notes: licenseBlockText(taS),
      expired_notes: licenseBlockText(taE),
      changes_notes: getChangesNotesMergedForLicenseId(licenseId),
    };
    if (!String(stripStandaloneGenericoLines(licenseNotesPayload)).trim()) {
      bodyObj.license_notes_force_empty = true;
    }
    if (taCR && String(taCR.dataset.licenseId) === String(licenseId)) {
      appendCustomerRenewalNotesToSaveBody(bodyObj, licenseId, taCR);
    }
    var body = JSON.stringify(bodyObj);
    if (typeof adminLicFetchJson !== 'function') return;
    notesSaveInFlight = true;
    adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
      .then(function (data) {
        if (data.success && typeof window.adminLicMarkSelfLicenseNotesSaved === 'function') {
          window.adminLicMarkSelfLicenseNotesSaved(data.licenses_rev);
        }
        if (data.success && typeof window.patchLicenseNotesCache === 'function') {
          window.patchLicenseNotesCache(
            licenseId,
            taP.value,
            licenseNotesPayload,
            licenseBlockText(taS),
            licenseBlockText(taE),
            undefined,
            getChangesNotesMergedForLicenseId(licenseId),
            taCR && String(taCR.dataset.licenseId) === String(licenseId)
              ? customerRenewalMergedOrBlockText(taCR)
              : undefined
          );
        }
        if (data.success && taCR && String(taCR.dataset.licenseId) === String(licenseId)) {
          clearCustomerRenewalDirty(taCR);
        }
        if (data.success && taP) {
          savePersonalForId(licenseId, taP.value);
        }
        if (data.success && taL && String(taL.dataset.licenseId) === String(licenseId)) {
          saveLicenseForId(licenseId, licenseMergedOrBlockText(taL));
          var storedDraft = loadLicenseCredsDraft(licenseId);
          if (
            storedDraft === null ||
            normalizeLicenseCredsDraft(storedDraft) === normalizeLicenseCredsDraft(taL.value)
          ) {
            clearLicenseCredsDraft(licenseId);
          }
        }
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar notas'));
        }
      })
      .finally(function () {
        notesSaveInFlight = false;
      });
  }

  /** Guarda notas al servidor de inmediato (p. ej. antes de syncDayNotepad tras quitar una línea). */
  function saveCurrentLicenseNotesImmediate() {
    clearTimeout(saveNotesTimer);
    var taP = getEl('adminLicenciasNotepadPersonal');
    var taL = getEl('adminLicenciasNotepadByLicense');
    var taS = getEl('adminLicenciasSuspendedNotepad');
    var taE = getEl('adminLicenciasExpiredNotepad');
    var taCR = getEl('adminLicenciasNotepadByCustomerRenewal');
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
    if (taCR && String(taCR.dataset.licenseId) === String(licenseId)) {
      saveCurrentCustomerRenewal(taCR);
    }
    var licenseNotesPayload = licenseMergedOrBlockText(taL);
    var bodyObj = {
      personal_notes: taP.value,
      license_notes: licenseNotesPayload,
      suspended_notes: licenseBlockText(taS),
      expired_notes: licenseBlockText(taE),
      changes_notes: getChangesNotesMergedForLicenseId(licenseId),
    };
    if (!String(stripStandaloneGenericoLines(licenseNotesPayload)).trim()) {
      bodyObj.license_notes_force_empty = true;
    }
    if (taCR && String(taCR.dataset.licenseId) === String(licenseId)) {
      appendCustomerRenewalNotesToSaveBody(bodyObj, licenseId, taCR);
    }
    var body = JSON.stringify(bodyObj);
    if (typeof adminLicFetchJson !== 'function') {
      return Promise.resolve({ success: false, error: 'fetch_unavailable' });
    }
    notesSaveInFlight = true;
    return adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
      .then(function (data) {
        if (data.success && typeof window.adminLicMarkSelfLicenseNotesSaved === 'function') {
          window.adminLicMarkSelfLicenseNotesSaved(data.licenses_rev);
        }
        if (data.success && typeof window.patchLicenseNotesCache === 'function') {
          window.patchLicenseNotesCache(
            licenseId,
            taP.value,
            licenseNotesPayload,
            licenseBlockText(taS),
            licenseBlockText(taE),
            undefined,
            getChangesNotesMergedForLicenseId(licenseId),
            taCR && String(taCR.dataset.licenseId) === String(licenseId)
              ? customerRenewalMergedOrBlockText(taCR)
              : undefined
          );
        }
        if (data.success && taL && String(taL.dataset.licenseId) === String(licenseId)) {
          saveLicenseForId(licenseId, licenseMergedOrBlockText(taL));
          var storedDraftImm = loadLicenseCredsDraft(licenseId);
          if (
            storedDraftImm === null ||
            normalizeLicenseCredsDraft(storedDraftImm) === normalizeLicenseCredsDraft(taL.value)
          ) {
            clearLicenseCredsDraft(licenseId);
          }
        }
        return data;
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar notas'));
        }
        return { success: false, error: 'network' };
      })
      .finally(function () {
        notesSaveInFlight = false;
      });
  }

  /** Guarda solo «Cuentas para renovar» de inmediato (p. ej. antes de pasar fila al día). */
  function saveCustomerRenewalNotesImmediate(opts) {
    clearTimeout(saveNotesTimer);
    var taCR = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (!taCR) {
      return Promise.resolve({ success: false, error: 'missing_customer_renewal' });
    }
    var licenseId = taCR.dataset.licenseId;
    if (licenseId === undefined || licenseId === '' || String(licenseId) === '0') {
      return Promise.resolve({ success: false, error: 'aggregate_or_empty' });
    }
    saveCurrentCustomerRenewal(taCR);
    var bodyObj = {};
    appendCustomerRenewalNotesToSaveBody(bodyObj, licenseId, taCR, opts);
    if (!Object.prototype.hasOwnProperty.call(bodyObj, 'customer_renewal_notes')) {
      return Promise.resolve({ success: false, error: 'empty_customer_renewal' });
    }
    if (typeof adminLicFetchJson !== 'function') {
      return Promise.resolve({ success: false, error: 'fetch_unavailable' });
    }
    return adminLicFetchJson('/tienda/api/licenses/' + licenseId + '/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    })
      .then(function (data) {
        if (data.success) {
          clearCustomerRenewalDirty(taCR);
          if (typeof window.patchLicenseNotesCache === 'function') {
            window.patchLicenseNotesCache(
              licenseId,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              customerRenewalMergedOrBlockText(taCR)
            );
          }
        }
        return data;
      })
      .catch(function (err) {
        if (typeof showError === 'function') {
          showError(adminLicFormatFetchError(err, 'Error al guardar cuentas para renovar'));
        }
        return { success: false, error: 'network' };
      });
  }

  function scheduleSaveLicenseNotesOnly(licenseId) {
    if (String(licenseId) === '0') return;
    clearTimeout(saveLicenseNotesTimer);
    saveLicenseNotesTimer = setTimeout(function () {
      saveLicenseNotesTimer = null;
      persistLicenseBlocNotesToServer(licenseId);
    }, SAVE_LICENSE_DEBOUNCE_MS);
  }

  function flushPendingLicenseNotesSave() {
    clearTimeout(saveLicenseNotesTimer);
    if (currentLicenseId !== null && String(currentLicenseId) !== '0') {
      return persistLicenseBlocNotesToServer(currentLicenseId);
    }
    return Promise.resolve({ success: false, error: 'no_license' });
  }

  function scheduleSaveNotes(licenseId) {
    if (String(licenseId) === '0') return;
    clearTimeout(saveNotesTimer);
    saveNotesTimer = setTimeout(function () {
      saveNotesTimer = null;
      saveNotesToServer(licenseId);
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPendingNotesSave() {
    flushPendingChangesNotesSaves();
    clearTimeout(saveNotesTimer);
    clearTimeout(saveLicenseNotesTimer);
    var licFlush = flushPendingLicenseNotesSave();
    if (currentLicenseId !== null && String(currentLicenseId) !== '0') {
      saveNotesToServer(currentLicenseId);
    }
    return licFlush;
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
    var taCR = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (!taP || !taL || !taS || !taE) return;

    var buP = getEl('adminUndoRedoPersonalUndo');
    var brP = getEl('adminUndoRedoPersonalRedo');
    var buL = getEl('adminUndoRedoLicenseUndo');
    var brL = getEl('adminUndoRedoLicenseRedo');
    var buS = getEl('adminUndoRedoSuspendedUndo');
    var brS = getEl('adminUndoRedoSuspendedRedo');
    var buE = getEl('adminUndoRedoExpiredUndo');
    var brE = getEl('adminUndoRedoExpiredRedo');
    var buCR = getEl('adminUndoRedoCustomerRenewalUndo');
    var brCR = getEl('adminUndoRedoCustomerRenewalRedo');

    function persistNotesFromUndoRedo() {
      saveCurrentPersonal(taP);
      saveCurrentLicense(taL);
      saveCurrentSuspended(taS);
      saveCurrentExpired(taE);
      if (taCR) saveCurrentCustomerRenewal(taCR);
      var lid = taL.dataset.licenseId;
      if (lid) scheduleSaveNotes(lid);
      refreshLicenseLineBadge();
      refreshPersonalLineBadge();
      refreshSuspendedLineBadge();
      refreshExpiredLineBadge();
      refreshCustomerRenewalLineBadge();
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

    var custRootUndo = getEl('adminLicenciasCustomerRenewalSplitRoot');
    if (
      taCR &&
      custRootUndo &&
      typeof window.customerRenewalLicenseSplitGetMergedText === 'function' &&
      typeof window.customerRenewalLicenseSplitApplyMergedText === 'function'
    ) {
      undoNotepadControllers.push(
        attach(custRootUndo, {
          listenElement: custRootUndo,
          useFocusOutDelegate: true,
          getPlainText: function () {
            return window.customerRenewalLicenseSplitGetMergedText(custRootUndo);
          },
          setPlainText: function (text) {
            window.customerRenewalLicenseSplitApplyMergedText(custRootUndo, text != null ? text : '');
          },
          undoBtn: buCR,
          redoBtn: brCR,
          onPersist: persistNotesFromUndoRedo,
          afterVisual: function () {
            if (typeof window.customerRenewalLicenseSplitSyncRowsToTextarea === 'function') {
              window.customerRenewalLicenseSplitSyncRowsToTextarea(custRootUndo);
            }
            if (typeof window.customerRenewalLicenseSplitScheduleAutosize === 'function') {
              window.customerRenewalLicenseSplitScheduleAutosize(custRootUndo);
            }
            refreshCustomerRenewalLineBadge();
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

  function lockCustomerRenewalSplit(taCustomerRenewal) {
    var root = getEl('adminLicenciasCustomerRenewalSplitRoot');
    if (root && typeof window.customerRenewalLicenseSplitLock === 'function') {
      window.customerRenewalLicenseSplitLock(root);
    } else if (taCustomerRenewal) {
      lockNotepadEditable(taCustomerRenewal);
    }
  }

  function unlockCustomerRenewalSplit(taCustomerRenewal) {
    /* No-op para mantener bloqueada la edición en Cuentas para renovar (solo admin: rechazar/aceptar) */
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
        if (typeof licenseSplitFocusElNoScroll === 'function') {
          licenseSplitFocusElNoScroll(el);
        } else {
          el.focus();
        }
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

  /** Delegación en document: sobrevive al re-render del grid (innerHTML) sin duplicar listeners. */
  function wireAdminLicenseBlocDelegatesOnce() {
    if (document.documentElement.dataset.adminLicLicenseBlocDelegated === '1') return;
    document.documentElement.dataset.adminLicLicenseBlocDelegated = '1';

    function onLicenseCredInput() {
      var ta = getEl('adminLicenciasNotepadByLicense');
      if (!ta || ta.readOnly) return;
      var lid = ta.dataset.licenseId;
      if (typeof window.adminLicMarkLicensePanelInteraction === 'function') {
        window.adminLicMarkLicensePanelInteraction(2800);
      }
      if (typeof window.adminLicenseSplitSyncRowsToTextarea === 'function') {
        window.adminLicenseSplitSyncRowsToTextarea();
      }
      saveCurrentLicense(ta);
      refreshLicenseLineBadge();
      if (lid) scheduleSaveLicenseNotesOnly(lid);
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    }

    function onLicenseSideFieldChange() {
      var ta = getEl('adminLicenciasNotepadByLicense');
      if (!ta) return;
      if (typeof window.adminLicMarkLicensePanelInteraction === 'function') {
        window.adminLicMarkLicensePanelInteraction(2800);
      }
      saveCurrentLicense(ta);
      refreshLicenseLineBadge();
      var lid = ta.dataset.licenseId;
      if (lid) scheduleSaveLicenseNotesOnly(lid);
      if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
        window.scheduleRefreshAdminDupIfActive();
      }
    }

    document.addEventListener(
      'input',
      function (e) {
        var t = e.target;
        if (!t) return;
        if (t.id === 'adminLicenciasNotepadByLicense') {
          onLicenseCredInput();
          return;
        }
        if (t.closest && t.closest('#adminLicenciasStructuredRows')) {
          onLicenseSideFieldChange();
        }
      },
      true
    );

    document.addEventListener(
      'change',
      function (e) {
        var t = e.target;
        if (t && t.closest && t.closest('#adminLicenciasStructuredRows')) {
          onLicenseSideFieldChange();
        }
      },
      true
    );

    document.addEventListener(
      'click',
      function (e) {
        var btn = e.target.closest && e.target.closest('#adminLicenciasStructuredRows .license-split-editor__sell-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var row = btn.closest('.license-split-editor__row');
        if (row && typeof window.adminLicenseSplitSellRowToDay === 'function') {
          window.adminLicenseSplitSellRowToDay(row);
        }
      },
      true
    );

    document.addEventListener(
      'blur',
      function (e) {
        if (!e.target || e.target.id !== 'adminLicenciasNotepadByLicense') return;
        if (typeof window.adminMainLicenseNormalizeCredTaTrailingRunsIfBlur === 'function') {
          window.adminMainLicenseNormalizeCredTaTrailingRunsIfBlur(e.target);
        }
        saveCurrentLicense(e.target);
      },
      true
    );
  }

  function init() {
    wireAdminLicenseBlocDelegatesOnce();
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

    var structuredRows = getEl('adminLicenciasStructuredRows');
    if (structuredRows && structuredRows.dataset.licSidePersistWired !== '1') {
      structuredRows.dataset.licSidePersistWired = '1';
      structuredRows.addEventListener('focusout', function () {
        var taL = getEl('adminLicenciasNotepadByLicense');
        if (taL) saveCurrentLicense(taL);
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
    if (typeof window.customerRenewalLicenseSplitWireScrollSync === 'function') {
      window.customerRenewalLicenseSplitWireScrollSync();
    }

    var taCustomerRenewal = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (taCustomerRenewal) {
      taCustomerRenewal.addEventListener('input', function () {
        var custRoot = getEl('adminLicenciasCustomerRenewalSplitRoot');
        if (custRoot && typeof window.customerRenewalLicenseSplitSyncRowsToTextarea === 'function') {
          window.customerRenewalLicenseSplitSyncRowsToTextarea(custRoot);
        }
        if (typeof window.customerRenewalLicenseSplitRefreshOrigCredsAfterEdit === 'function') {
          window.customerRenewalLicenseSplitRefreshOrigCredsAfterEdit(taCustomerRenewal);
        }
        markCustomerRenewalDirty(taCustomerRenewal);
        saveCurrentCustomerRenewal(taCustomerRenewal);
        refreshCustomerRenewalLineBadge();
        var lid = taCustomerRenewal.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
      });
      taCustomerRenewal.addEventListener('blur', function () {
        var custRoot = getEl('adminLicenciasCustomerRenewalSplitRoot');
        if (custRoot && typeof window.customerRenewalLicenseSplitSyncRowsToTextarea === 'function') {
          window.customerRenewalLicenseSplitSyncRowsToTextarea(custRoot);
        }
        if (typeof window.customerRenewalLicenseSplitNormalizeCredTaForRenewMode === 'function') {
          window.customerRenewalLicenseSplitNormalizeCredTaForRenewMode(taCustomerRenewal);
        }
        if (typeof window.customerRenewalLicenseSplitProcessCredResponses === 'function') {
          window.customerRenewalLicenseSplitProcessCredResponses(taCustomerRenewal);
        }
        if (typeof window.customerRenewalLicenseSplitScheduleAutosize === 'function') {
          window.customerRenewalLicenseSplitScheduleAutosize(custRoot);
        }
        saveCurrentCustomerRenewal(taCustomerRenewal);
        flushPendingNotesSave();
      });
    }

    var custRowsEl = getEl('adminLicenciasCustomerRenewalStructuredRows');
    if (custRowsEl && taCustomerRenewal) {
      custRowsEl.addEventListener('input', function () {
        markCustomerRenewalDirty(taCustomerRenewal);
        saveCurrentCustomerRenewal(taCustomerRenewal);
        refreshCustomerRenewalLineBadge();
        var lid = taCustomerRenewal.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
      });
      custRowsEl.addEventListener('change', function () {
        markCustomerRenewalDirty(taCustomerRenewal);
        saveCurrentCustomerRenewal(taCustomerRenewal);
        refreshCustomerRenewalLineBadge();
        var lid = taCustomerRenewal.dataset.licenseId;
        if (lid) scheduleSaveNotes(lid);
      });
      custRowsEl.addEventListener('click', function (e) {
        var rejectBtn = e.target.closest && e.target.closest('.license-split-editor__reject-btn');
        if (rejectBtn) {
          e.preventDefault();
          e.stopPropagation();
          var rejectRow = rejectBtn.closest('.license-split-editor__row');
          if (rejectRow && typeof window.adminCustomerRenewalSplitRejectRow === 'function') {
            window.adminCustomerRenewalSplitRejectRow(rejectRow);
          }
          return;
        }
        var btn = e.target.closest && e.target.closest('.license-split-editor__sell-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var row = btn.closest('.license-split-editor__row');
        if (row && typeof window.adminCustomerRenewalSplitSellRowToDay === 'function') {
          window.adminCustomerRenewalSplitSellRowToDay(row);
        }
      });
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
          if (typeof licenseSplitHandleLockedMousedown === 'function') {
            licenseSplitHandleLockedMousedown(e, taLicense, function () {
              unlockLicenseSplit(taLicense);
            }, splitRoot);
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
          if (typeof licenseSplitHandleLockedMousedown === 'function') {
            licenseSplitHandleLockedMousedown(e, taSuspended, function () {
              if (typeof window.suspendedLicenseSplitUnlock === 'function') {
                window.suspendedLicenseSplitUnlock(suspRoot);
              }
            }, suspRoot);
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
          if (typeof licenseSplitHandleLockedMousedown === 'function') {
            licenseSplitHandleLockedMousedown(e, taExpired, function () {
              if (typeof window.expiredLicenseSplitUnlock === 'function') {
                window.expiredLicenseSplitUnlock(expRoot);
              }
            }, expRoot);
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

    var custRoot = getEl('adminLicenciasCustomerRenewalSplitRoot');
    if (custRoot && taCustomerRenewal) {
      custRoot.addEventListener(
        'mousedown',
        function (e) {
          if (String(taCustomerRenewal.dataset.licenseId || '') === '0') return;
          if (!custRoot.classList.contains('license-notepad--locked')) return;
          if (typeof licenseSplitHandleLockedMousedown === 'function') {
            licenseSplitHandleLockedMousedown(
              e,
              taCustomerRenewal,
              function () {
                if (typeof window.customerRenewalLicenseSplitUnlock === 'function') {
                  window.customerRenewalLicenseSplitUnlock(custRoot);
                }
              },
              custRoot
            );
          }
        },
        true
      );
      custRoot.addEventListener('focusout', function () {
        if (String(taCustomerRenewal.dataset.licenseId || '') === '0') return;
        window.setTimeout(function () {
          var a = document.activeElement;
          if (a && custRoot.contains(a)) return;
          if (typeof window.customerRenewalLicenseSplitNormalizeCredTaForRenewMode === 'function') {
            window.customerRenewalLicenseSplitNormalizeCredTaForRenewMode(taCustomerRenewal);
          }
          var processPromise =
            typeof window.customerRenewalLicenseSplitProcessCredResponses === 'function'
              ? window.customerRenewalLicenseSplitProcessCredResponses(taCustomerRenewal)
              : Promise.resolve(false);
          Promise.resolve(processPromise).then(function () {
            saveCurrentCustomerRenewal(taCustomerRenewal);
            flushPendingNotesSave();
            if (String(taCustomerRenewal.dataset.renewCustomerAccount || '') === '1') {
              return;
            }
            lockCustomerRenewalSplit(taCustomerRenewal);
          });
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
      window.addEventListener('pagehide', function () {
        if (currentLicenseId !== null && String(currentLicenseId) !== '0') {
          var taL = getEl('adminLicenciasNotepadByLicense');
          var taP = getEl('adminLicenciasNotepadPersonal');
          var taS = getEl('adminLicenciasSuspendedNotepad');
          var taE = getEl('adminLicenciasExpiredNotepad');
          var taCR = getEl('adminLicenciasNotepadByCustomerRenewal');
          if (taP) savePersonalForId(currentLicenseId, taP.value);
          if (taL) {
            saveLicenseCredsDraft(currentLicenseId, taL.value);
            saveLicenseForId(currentLicenseId, licenseMergedOrBlockText(taL));
          }
          if (taS) saveSuspendedForId(currentLicenseId, licenseBlockText(taS));
          if (taE) saveExpiredForId(currentLicenseId, licenseBlockText(taE));
          if (taCR) saveCustomerRenewalForId(currentLicenseId, customerRenewalMergedOrBlockText(taCR));
        }
        flushPendingNotesSave();
      });
    }
    taPersonal.addEventListener('blur', function () {
      saveCurrentPersonal(taPersonal);
      flushPendingNotesSave();
      lockNotepadEditable(taPersonal);
    });

    lockNotepadEditable(taPersonal);
    lockLicenseSplit(taLicense);
    lockSuspendedSplit(taSuspended);
    lockExpiredSplit(taExpired);
    lockChangesSplit();
    if (taCustomerRenewal) lockCustomerRenewalSplit(taCustomerRenewal);

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
          if (typeof window.customerRenewalLicenseSplitScheduleAutosize === 'function') {
            window.customerRenewalLicenseSplitScheduleAutosize();
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
    var taCustomerRenewal = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (!taPersonal || !taLicense || !taSuspended || !taExpired) return;

    var idStr = String(licenseId);
    var wasSameLicense = currentLicenseId === idStr;
    if (currentLicenseId !== null && currentLicenseId !== idStr) {
      if (currentLicenseId !== '0') {
        savePersonalForId(currentLicenseId, taPersonal.value);
        saveLicenseForId(currentLicenseId, licenseMergedOrBlockText(taLicense));
        saveSuspendedForId(currentLicenseId, licenseBlockText(taSuspended));
        saveExpiredForId(currentLicenseId, licenseBlockText(taExpired));
        if (taCustomerRenewal) {
          saveCustomerRenewalForId(currentLicenseId, customerRenewalMergedOrBlockText(taCustomerRenewal));
        }
      }
      flushPendingNotesSave();
    }

    currentLicenseId = idStr;
    taPersonal.dataset.licenseId = idStr;
    taLicense.dataset.licenseId = idStr;
    taSuspended.dataset.licenseId = idStr;
    taExpired.dataset.licenseId = idStr;
    if (taCustomerRenewal) taCustomerRenewal.dataset.licenseId = idStr;
    if (taCustomerRenewal) {
      taCustomerRenewal.dataset.renewCustomerAccount = licenseRowRenewCustomerAccount(licenseRow) ? '1' : '0';
    }
    var suspRootBind = getEl('adminLicenciasSuspendedSplitRoot');
    if (suspRootBind) suspRootBind.dataset.licenseId = idStr;
    var expRootBind = getEl('adminLicenciasExpiredSplitRoot');
    if (expRootBind) expRootBind.dataset.licenseId = idStr;
    var custRootBind = getEl('adminLicenciasCustomerRenewalSplitRoot');
    if (custRootBind) custRootBind.dataset.licenseId = idStr;

    if (String(licenseId) === '0') {
      taPersonal.value =
        'En la vista «Todos» no hay notas por producto. Elige una plataforma en la cuadrícula para editar notas en este dispositivo.';
      if (typeof window.adminLicenseSplitApplyMergedText === 'function') {
        window.adminLicenseSplitApplyMergedText('', { force: true });
      }
      setLicenseBlockPlainText(
        taLicense,
        'En la vista «Todos» no se editan licencias aquí. Abre cada producto para el bloc de licencias.'
      );
      var splitSide = document.querySelector('#adminLicenciasLicenseSplitRoot .license-split-editor__side');
      if (splitSide) splitSide.hidden = true;
      var custSplitSide = document.querySelector(
        '#adminLicenciasCustomerRenewalSplitRoot .license-split-editor__side'
      );
      if (custSplitSide) custSplitSide.hidden = true;
      setLicenseBlockPlainText(
        taSuspended,
        'En la vista «Todos» no se editan cuentas caídas aquí. Elige una plataforma.'
      );
      setLicenseBlockPlainText(
        taExpired,
        'En la vista «Todos» no se editan cuentas vencidas aquí. Elige una plataforma.'
      );
      if (taCustomerRenewal) {
        setLicenseBlockPlainText(
          taCustomerRenewal,
          'En la vista «Todos» no se editan cuentas para renovar aquí. Elige una plataforma.'
        );
      }
      setLicenseHeading(productName || 'Todos');
      resetUndoNotepads();
      lockNotepadEditable(taPersonal);
      lockLicenseSplit(taLicense);
      lockSuspendedSplit(taSuspended);
      lockExpiredSplit(taExpired);
      if (taCustomerRenewal) lockCustomerRenewalSplit(taCustomerRenewal);
      lockChangesSplit();
      refreshLicenseLineBadge();
      refreshPersonalLineBadge();
      refreshSuspendedLineBadge();
      refreshExpiredLineBadge();
      refreshCustomerRenewalLineBadge();
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
    var custSplitSideOpen = document.querySelector(
      '#adminLicenciasCustomerRenewalSplitRoot .license-split-editor__side'
    );
    if (custSplitSideOpen) custSplitSideOpen.hidden = false;
    if (!wasSameLicense) {
      /* Tras cambiar currentLicenseId el DOM aún muestra el producto anterior: no usar openNorm. */
      var freshLoadOpts = { trustOpenUi: false };
      loadPersonalForId(licenseId, taPersonal, licenseRow, freshLoadOpts);
      loadLicenseForId(licenseId, taLicense, licenseRow, freshLoadOpts);
      loadSuspendedForId(licenseId, taSuspended, licenseRow, freshLoadOpts);
      loadExpiredForId(licenseId, taExpired, licenseRow, freshLoadOpts);
      if (taCustomerRenewal) {
        loadCustomerRenewalForId(licenseId, taCustomerRenewal, licenseRow, freshLoadOpts);
      }
    } else {
      saveCurrentPersonal(taPersonal);
      saveCurrentLicense(taLicense);
      saveCurrentSuspended(taSuspended);
      saveCurrentExpired(taExpired);
      if (taCustomerRenewal) {
        saveCurrentCustomerRenewal(taCustomerRenewal);
      }
    }
    if (taCustomerRenewal) {
      if (licenseRow && taCustomerRenewal.dataset.customerRenewalDirty !== '1') {
        refreshCustomerRenewalSplitFromApi(licenseRow);
      }
      syncCustomerRenewalBlocUiForLicense(licenseRow, taCustomerRenewal);
    }
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
    if (sanitizedLicense) scheduleSaveLicenseNotesOnly(licenseId);
    if (sanitizedSuspended || sanitizedExpired) scheduleSaveNotes(licenseId);
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
    refreshCustomerRenewalLineBadge();
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
    if (typeof window.customerRenewalLicenseSplitScheduleAutosize === 'function') {
      window.requestAnimationFrame(function () {
        window.customerRenewalLicenseSplitScheduleAutosize();
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
    var taCustomerRenewal = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (!taLicense || !taSuspended || !taExpired || currentLicenseId === null) return;
    savePersonalForId(currentLicenseId, taPersonal ? taPersonal.value : '');
    if (taLicense.tagName === 'TEXTAREA') {
      saveLicenseCredsDraft(currentLicenseId, taLicense.value);
    }
    saveLicenseForId(currentLicenseId, licenseMergedOrBlockText(taLicense));
    saveSuspendedForId(currentLicenseId, licenseBlockText(taSuspended));
    saveExpiredForId(currentLicenseId, licenseBlockText(taExpired));
    if (taCustomerRenewal) {
      saveCustomerRenewalForId(currentLicenseId, customerRenewalMergedOrBlockText(taCustomerRenewal));
    }
    flushPendingNotesSave();
    currentLicenseId = null;
    setLicenseHeading('');
  }

  function refreshCustomerRenewalSplitFromApi(licenseRow) {
    if (!licenseRow || licenseRow.id == null) return;
    var idStr = String(licenseRow.id);
    var taCR = getEl('adminLicenciasNotepadByCustomerRenewal');
    if (!taCR || String(taCR.dataset.licenseId) !== idStr) return;
    if (taCR.dataset.customerRenewalDirty === '1') return;
    if (!Object.prototype.hasOwnProperty.call(licenseRow, 'customer_renewal_notes')) return;
    var v = licenseRow.customer_renewal_notes != null ? String(licenseRow.customer_renewal_notes) : '';
    v = stripStandaloneGenericoLines(v);
    var curKey = customerRenewalCredColumnKeyFromOpenBloc(taCR);
    var nextKey = customerRenewalCredColumnKeyFromStorageText(v);
    var forceApply = nextKey.trim() !== '' && curKey.trim() === '';
    if (!forceApply && curKey === nextKey) return;
    if (typeof window.customerRenewalLicenseSplitApplyMergedText === 'function') {
      var root = getEl('adminLicenciasCustomerRenewalSplitRoot');
      if (root) {
        window.customerRenewalLicenseSplitApplyMergedText(root, v);
      }
    } else {
      setLicenseBlockPlainText(taCR, v);
    }
    saveCustomerRenewalForId(idStr, customerRenewalMergedOrBlockText(taCR));
    clearCustomerRenewalDirty(taCR);
    refreshCustomerRenewalLineBadge();
    if (typeof window.customerRenewalLicenseSplitScheduleAutosize === 'function') {
      window.requestAnimationFrame(function () {
        window.customerRenewalLicenseSplitScheduleAutosize();
      });
    }
  }

  function licenseMainSplitMergedNormFromOpenBloc(taLicense) {
    var merged = '';
    if (typeof window.adminLicenseSplitMergedTextForSave === 'function') {
      merged = window.adminLicenseSplitMergedTextForSave();
    } else if (typeof window.adminLicenseSplitGetMergedNotes === 'function') {
      merged = window.adminLicenseSplitGetMergedNotes();
    } else {
      merged = licenseMergedOrBlockText(taLicense);
    }
    return licenseNotesServerNormalized(merged);
  }

  function refreshLicenseSplitFromApi(licenseRow) {
    if (!licenseRow || licenseRow.id == null) return;
    if (saveNotesTimer || saveLicenseNotesTimer || notesSaveInFlight || licenseNotesSaveInFlight) return;
    if (isUserEditingMainLicenseSplit()) return;
    if (
      typeof window.adminLicShouldSkipLicenseNotesRealtimeRefresh === 'function' &&
      window.adminLicShouldSkipLicenseNotesRealtimeRefresh()
    ) {
      return;
    }
    var idStr = String(licenseRow.id);
    var taLicense = getEl('adminLicenciasNotepadByLicense');
    if (!taLicense || String(taLicense.dataset.licenseId) !== idStr) return;
    if (!Object.prototype.hasOwnProperty.call(licenseRow, 'license_notes')) return;
    var v = licenseRow.license_notes != null ? String(licenseRow.license_notes) : '';
    v = stripStandaloneGenericoLines(v);
    var serverNorm = licenseNotesServerNormalized(v);
    var localPack = licenseNotesLocalNormalized(idStr);
    var openNorm = licenseMainSplitMergedNormFromOpenBloc(taLicense);

    /*
     * SSE / poll / hydrate: no pisar con servidor si localStorage o la UI tienen datos más recientes
     * (p. ej. recarga F5 antes del PUT, o rev SSE mientras el guardado va en vuelo).
     */
    if (localPack.norm !== null && localPack.norm !== serverNorm) {
      applyLicenseBlocText(taLicense, localPack.raw);
      saveLicenseForId(idStr, licenseMergedOrBlockText(taLicense));
      scheduleSaveLicenseNotesOnly(idStr);
      refreshLicenseLineBadge();
      if (typeof refreshDuplicateEmailHighlights === 'function') {
        refreshDuplicateEmailHighlights(parseInt(idStr, 10));
      }
      return;
    }

    if (openNorm !== serverNorm) {
      saveLicenseForId(idStr, licenseMergedOrBlockText(taLicense));
      scheduleSaveLicenseNotesOnly(idStr);
      refreshLicenseLineBadge();
      if (typeof refreshDuplicateEmailHighlights === 'function') {
        refreshDuplicateEmailHighlights(parseInt(idStr, 10));
      }
      return;
    }

    var credDraft = loadLicenseCredsDraft(idStr);
    if (credDraft !== null && String(credDraft).trim() !== '') {
      var appliedCred = normalizeLicenseCredsDraft(taLicense.value).replace(/\n+$/, '');
      var draftCred = normalizeLicenseCredsDraft(credDraft).replace(/\n+$/, '');
      if (draftCred !== appliedCred) {
        restoreLicenseCredsDraftAfterApply(taLicense, idStr);
        saveCurrentLicense(taLicense);
        scheduleSaveLicenseNotesOnly(idStr);
        refreshLicenseLineBadge();
        return;
      }
    }

    var cur = openNorm.replace(/\r\n/g, '\n').trimEnd();
    var next = serverNorm.replace(/\r\n/g, '\n').trimEnd();
    if (cur === next) return;
    applyLicenseBlocText(taLicense, v);
    saveLicenseForId(idStr, licenseMergedOrBlockText(taLicense));
    refreshLicenseLineBadge();
    if (typeof refreshDuplicateEmailHighlights === 'function') {
      refreshDuplicateEmailHighlights(parseInt(idStr, 10));
    }
  }

  window.initAdminLicenciasNotepad = init;
  window.adminLicenciasSaveCurrentLicenseNotesImmediate = saveCurrentLicenseNotesImmediate;
  window.adminLicenciasSaveCustomerRenewalNotesImmediate = saveCustomerRenewalNotesImmediate;
  window.adminLicenciasScheduleSaveChangesNotesOnly = scheduleSaveChangesNotesOnly;
  window.adminLicenciasFlushPendingChangesNotesSaves = flushPendingChangesNotesSaves;
  window.AdminLicenciasNotepad = {
    bindLicense: bindLicense,
    flushLicense: flushLicense,
    refreshLicenseSplitFromApi: refreshLicenseSplitFromApi,
    refreshCustomerRenewalSplitFromApi: refreshCustomerRenewalSplitFromApi,
    customerRenewalSplitNeedsForcedServerSync: customerRenewalSplitNeedsForcedServerSync,
    restoreLicenseCredsDraftAfterApply: restoreLicenseCredsDraftAfterApply,
    licenseNotesSavePending: function () {
      return !!(saveNotesTimer || saveLicenseNotesTimer || notesSaveInFlight || licenseNotesSaveInFlight);
    },
    flushPendingLicenseNotesSave: flushPendingLicenseNotesSave,
    persistLicenseBlocNotesToServer: persistLicenseBlocNotesToServer
  };
})();
