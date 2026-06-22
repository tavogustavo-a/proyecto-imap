/**
 * Preferencias UI admin licencias — fuente única: BD (`users.admin_licencias_ui_prefs`).
 * localStorage legacy solo se importa una vez al cargar si falta valor en BD.
 */
var adminLicenciasUiPrefs = null;
var __adminLicUiPrefsSaveTimer = null;
var __adminLicUiPrefsLegacyMigrated = false;

function adminLicEnsurePrefsObject() {
  if (!adminLicenciasUiPrefs) {
    adminLicenciasUiPrefs = {
      main_grid_collapsed: null,
      admin_days: {},
      personal_collapsed: {},
      suspended_collapsed: {},
      expired_collapsed: {},
      proveedor_merged_collapsed: {},
      proveedor_merged_user_filter: {},
      proveedor_panel_user_collapsed: {},
      proveedor_panel_day_collapsed: {},
    };
  }
  return adminLicenciasUiPrefs;
}

function adminLicBootstrapUiPrefsFromDom() {
  adminLicEnsurePrefsObject();
  var el = document.getElementById('adminLicenciasUiPrefsJson');
  if (!el) return;
  var raw = String(el.textContent || '').trim();
  if (!raw) return;
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.main_grid_collapsed === true || parsed.main_grid_collapsed === false) {
      adminLicenciasUiPrefs.main_grid_collapsed = parsed.main_grid_collapsed;
    }
    if (parsed.admin_days && typeof parsed.admin_days === 'object') {
      adminLicenciasUiPrefs.admin_days = parsed.admin_days;
    }
    var blocKeys = [
      'personal_collapsed',
      'suspended_collapsed',
      'expired_collapsed',
      'proveedor_merged_collapsed',
      'proveedor_merged_user_filter',
      'proveedor_panel_user_collapsed',
      'proveedor_panel_day_collapsed',
    ];
    var bi;
    for (bi = 0; bi < blocKeys.length; bi += 1) {
      var bk = blocKeys[bi];
      if (parsed[bk] && typeof parsed[bk] === 'object') {
        adminLicenciasUiPrefs[bk] = parsed[bk];
      }
    }
  } catch (_e) {}
}

function adminLicMigrateLegacyBlocKeys(mapKey, legacyPrefix) {
  var dirty = false;
  var re = new RegExp('^' + legacyPrefix + '(\\d+)_collapsed$');
  var i;
  for (i = 0; i < localStorage.length; i += 1) {
    var k = localStorage.key(i);
    if (!k) continue;
    var m = re.exec(k);
    if (!m) continue;
    var lid = String(m[1]);
    adminLicenciasUiPrefs[mapKey] = adminLicenciasUiPrefs[mapKey] || {};
    if (Object.prototype.hasOwnProperty.call(adminLicenciasUiPrefs[mapKey], lid)) continue;
    var v = localStorage.getItem(k);
    if (v !== 'true' && v !== 'false') continue;
    adminLicenciasUiPrefs[mapKey][lid] = v === 'true';
    dirty = true;
  }
  return dirty;
}

function adminLicMigrateLegacyLocalStoragePrefsToBd() {
  if (__adminLicUiPrefsLegacyMigrated) return;
  __adminLicUiPrefsLegacyMigrated = true;
  if (typeof window !== 'undefined' && window.IS_ARCHIVED_MODE) return;
  if (!document.getElementById('adminLicenciasUiPrefsJson')) return;
  adminLicEnsurePrefsObject();
  var dirty = false;
  var slug = licenciasUiScopeSlug();
  var dayPrefix = 'licencias_ui_' + slug + '_admin_day_';
  var dayScopedRe = new RegExp(
    '^' + dayPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)_(\\d+)_collapsed$'
  );
  var legacyDayRe = /^daySection_(\d+)_(\d+)_collapsed$/;

  if (
    adminLicenciasUiPrefs.main_grid_collapsed !== true &&
    adminLicenciasUiPrefs.main_grid_collapsed !== false
  ) {
    var gridKeys = licenciasUiMainGridStorageKeys();
    var gv =
      localStorage.getItem(gridKeys.scoped) ||
      localStorage.getItem(gridKeys.legacyAdmin) ||
      localStorage.getItem(gridKeys.legacyPortal);
    if (gv === 'true' || gv === 'false') {
      adminLicenciasUiPrefs.main_grid_collapsed = gv === 'true';
      dirty = true;
    }
  }

  var di;
  for (di = 0; di < localStorage.length; di += 1) {
    var key = localStorage.key(di);
    if (!key) continue;
    var lid = null;
    var day = null;
    var scopedM = dayScopedRe.exec(key);
    var legacyM = legacyDayRe.exec(key);
    if (scopedM) {
      lid = scopedM[1];
      day = scopedM[2];
    } else if (legacyM) {
      lid = legacyM[1] === String(AGGREGATE_LICENSE_ID) ? '0' : String(legacyM[1]);
      day = legacyM[2];
    } else {
      continue;
    }
    var dv = localStorage.getItem(key);
    if (dv !== 'true' && dv !== 'false') continue;
    adminLicenciasUiPrefs.admin_days[lid] = adminLicenciasUiPrefs.admin_days[lid] || {};
    if (Object.prototype.hasOwnProperty.call(adminLicenciasUiPrefs.admin_days[lid], day)) continue;
    adminLicenciasUiPrefs.admin_days[lid][day] = dv === 'true';
    dirty = true;
  }

  if (adminLicMigrateLegacyBlocKeys('personal_collapsed', 'personalBloc_')) dirty = true;
  if (adminLicMigrateLegacyBlocKeys('suspended_collapsed', 'suspendedSection_')) dirty = true;
  if (adminLicMigrateLegacyBlocKeys('expired_collapsed', 'expiredSection_')) dirty = true;

  if (dirty) scheduleAdminLicenciasUiPrefsSave();
}

function scheduleAdminLicenciasUiPrefsSave() {
  if (!document.getElementById('adminLicenciasUiPrefsJson')) return;
  if (typeof window !== 'undefined' && window.IS_ARCHIVED_MODE) return;
  if (__adminLicUiPrefsSaveTimer) window.clearTimeout(__adminLicUiPrefsSaveTimer);
  __adminLicUiPrefsSaveTimer = window.setTimeout(function () {
    __adminLicUiPrefsSaveTimer = null;
    void flushAdminLicenciasUiPrefsSave();
  }, 420);
}

async function flushAdminLicenciasUiPrefsSave() {
  if (!document.getElementById('adminLicenciasUiPrefsJson')) return;
  adminLicEnsurePrefsObject();
  var url = '/tienda/api/admin-licencias-ui-prefs';
  try {
    await adminLicFetchJson(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: adminLicenciasUiPrefs }),
    });
    var el = document.getElementById('adminLicenciasUiPrefsJson');
    if (el) {
      try {
        el.textContent = JSON.stringify(adminLicenciasUiPrefs);
      } catch (_syncDom) {}
    }
  } catch (err) {
    adminLicLogWarn('No se pudieron guardar preferencias UI:', adminLicFormatFetchError(err));
  }
}

function adminLicGetBlocPrefCollapsed(mapKey, licenseId) {
  adminLicEnsurePrefsObject();
  var lid = String(licenseId);
  var m = adminLicenciasUiPrefs[mapKey];
  if (m && Object.prototype.hasOwnProperty.call(m, lid)) {
    return m[lid] ? 'true' : 'false';
  }
  return null;
}

function adminLicSetBlocPrefCollapsed(mapKey, licenseId, isCollapsed) {
  adminLicEnsurePrefsObject();
  var lid = String(licenseId);
  adminLicenciasUiPrefs[mapKey] = adminLicenciasUiPrefs[mapKey] || {};
  adminLicenciasUiPrefs[mapKey][lid] = !!isCollapsed;
  scheduleAdminLicenciasUiPrefsSave();
}

function licenciasUiScopeSlug() {
  try {
    var el = document.querySelector('[data-licencias-persist-scope]');
    var raw = el && el.getAttribute('data-licencias-persist-scope');
    if (raw == null || String(raw).trim() === '') return 'anon';
    var s = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    return s || 'anon';
  } catch (_e) {
    return 'anon';
  }
}

function licenciasUiAdminDayCollapsedRead(licenseId, day) {
  var lid =
    licenseId === AGGREGATE_LICENSE_ID || licenseId === '0' || licenseId === 0 ? '0' : String(licenseId);
  var d = String(day);
  adminLicEnsurePrefsObject();
  var byLic = adminLicenciasUiPrefs.admin_days[lid];
  if (byLic && Object.prototype.hasOwnProperty.call(byLic, d)) {
    return byLic[d] ? 'true' : 'false';
  }
  return null;
}

function licenciasUiAdminDayCollapsedWrite(licenseId, day, isCollapsed) {
  var lid =
    licenseId === AGGREGATE_LICENSE_ID || licenseId === '0' || licenseId === 0 ? '0' : String(licenseId);
  var d = String(day);
  adminLicEnsurePrefsObject();
  adminLicenciasUiPrefs.admin_days[lid] = adminLicenciasUiPrefs.admin_days[lid] || {};
  adminLicenciasUiPrefs.admin_days[lid][d] = !!isCollapsed;
  scheduleAdminLicenciasUiPrefsSave();
}

function licenciasUiMainGridStorageKeys() {
  var slug = licenciasUiScopeSlug();
  return {
    scoped: 'licencias_ui_' + slug + '_lic_cards_row_collapsed',
    legacyAdmin: 'licenciasContainerCollapsed',
    legacyPortal: 'userLicenciasContainerCollapsed',
  };
}

function licenciasUiMainGridCollapsedRead() {
  adminLicEnsurePrefsObject();
  if (adminLicenciasUiPrefs.main_grid_collapsed === true) return 'true';
  if (adminLicenciasUiPrefs.main_grid_collapsed === false) return 'false';
  return null;
}

function licenciasUiMainGridCollapsedWrite(isCollapsed) {
  adminLicEnsurePrefsObject();
  adminLicenciasUiPrefs.main_grid_collapsed = !!isCollapsed;
  scheduleAdminLicenciasUiPrefsSave();
}
