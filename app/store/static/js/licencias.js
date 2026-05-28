/**
 * SISTEMA DE GESTIÓN DE LICENCIAS
 * ================================
 * Maneja la interfaz de licencias similar a la imagen de ColorNote
 * - Grid de licencias con cuentas
 * - Edición de posiciones
 * - Gestión de cuentas mensuales
 */

(function initArchivedLicensesModeFromMeta() {
    try {
        var meta = document.querySelector('meta[name="licenses-archive-mode"]');
        if (meta && meta.getAttribute('content') === '1') {
            window.IS_ARCHIVED_MODE = true;
        }
    } catch (e) {}
})();

/** Modo soporte restricciones: marcador en servidor en `.admin-licencias-shell` (sin script inline/CSP). */
(function initLicenseSupportRestrictedFromDataAttribute() {
    try {
        var el = document.querySelector('.admin-licencias-shell[data-license-support-restricted="true"]');
        if (!el) return;
        window.LICENSE_SUPPORT_RESTRICTED = true;
        document.documentElement.classList.add('admin-licencias-license-support-mode');
    } catch (_eLicSupDom) {}
})();

// Variables globales
let licenses = [];
let currentLicenseId = null;
const MAX_HEAVY_NOTEPAD_CHARS = 200000;

/** Mapa correo→línea del bloc Licencias (por producto); se invalida al recargar o guardar notas. */
let _licenseNotesCredentialLineCache = null;

function invalidateLicenseNotesCredentialLineCache() {
    _licenseNotesCredentialLineCache = null;
}

/** Vista global: combina cuentas vendidas por día de todas las licencias (no existe en la API). */
const AGGREGATE_LICENSE_ID = 0;

/**
 * Raíces «Día N» solo dentro de #licenseAllDaysContainer.
 * Si hay un producto activo distinto de «Todos», solo incluye filas con el mismo data-license-id
 * (evita mezclar blocs al cruzar productos / duplicados / resaltados).
 */
function adminLicCollectDaySplitRootsForActiveUi() {
    const wrap = document.getElementById('licenseAllDaysContainer');
    if (!wrap || typeof wrap.querySelectorAll !== 'function') return [];
    const roots = Array.prototype.slice.call(wrap.querySelectorAll('.day-license-split-root'));
    const ic = document.getElementById('licenseAccountsInputContainer');
    const rawActive =
        ic && ic.dataset.activeLicenseId != null && String(ic.dataset.activeLicenseId).trim() !== ''
            ? String(ic.dataset.activeLicenseId).trim()
            : '';
    if (rawActive === '' || rawActive === String(AGGREGATE_LICENSE_ID)) {
        return roots;
    }
    return roots.filter(function (r) {
        return String(r.dataset.licenseId || '') === rawActive;
    });
}

/** Listado Cambios: solo productos con líneas vs todos los «mes a mes» (añadir manualmente). */
const ADMIN_LICENCIAS_CHANGES_LIST_MODE_KEY = 'admin_licencias_changes_list_mode_v1';
const CHANGES_LIST_MODE_ONLY = 'only_with_lines';
const CHANGES_LIST_MODE_ALL = 'all_month_to_month';

/** Panel lateral en admin licencias: restaurar Reportes o Cambios tras recarga o re-render del grid. */
const ADMIN_LICENCIAS_SIDEBAR_MODE_KEY = 'adminLicenciasSidebarMode';

/** Bloque UI Admin Licencias persistido en BD (`users.admin_licencias_ui_prefs`), bootstrap `#adminLicenciasUiPrefsJson` (div oculto, CSP). */
let adminLicenciasUiPrefs = null;
let __adminLicUiPrefsSaveTimer = null;

function adminLicEnsurePrefsObject() {
    if (!adminLicenciasUiPrefs) {
        adminLicenciasUiPrefs = {
            main_grid_collapsed: null,
            admin_days: {},
            personal_collapsed: {},
            suspended_collapsed: {},
            expired_collapsed: {},
        };
    }
    return adminLicenciasUiPrefs;
}

function adminLicBootstrapUiPrefsFromDom() {
    adminLicEnsurePrefsObject();
    const el = document.getElementById('adminLicenciasUiPrefsJson');
    if (!el) return;
    const raw = String(el.textContent || '').trim();
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        if (parsed.main_grid_collapsed === true || parsed.main_grid_collapsed === false) {
            adminLicenciasUiPrefs.main_grid_collapsed = parsed.main_grid_collapsed;
        }
        if (parsed.admin_days && typeof parsed.admin_days === 'object') {
            adminLicenciasUiPrefs.admin_days = parsed.admin_days;
        }
        const blocKeys = ['personal_collapsed', 'suspended_collapsed', 'expired_collapsed'];
        let bi;
        for (bi = 0; bi < blocKeys.length; bi += 1) {
            const bk = blocKeys[bi];
            if (parsed[bk] && typeof parsed[bk] === 'object') {
                adminLicenciasUiPrefs[bk] = parsed[bk];
            }
        }
    } catch (_e) {}
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
    const url = '/tienda/api/admin-licencias-ui-prefs';
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (typeof getCSRFToken === 'function') headers['X-CSRFToken'] = getCSRFToken();
        await fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ prefs: adminLicenciasUiPrefs }),
        });
    } catch (_e) {}
}

function adminLicGetBlocPrefCollapsed(mapKey, licenseId, lsKeyFn) {
    adminLicEnsurePrefsObject();
    const lid = String(licenseId);
    const m = adminLicenciasUiPrefs[mapKey];
    if (m && Object.prototype.hasOwnProperty.call(m, lid)) {
        return m[lid] ? 'true' : 'false';
    }
    try {
        return localStorage.getItem(lsKeyFn(licenseId));
    } catch (_e) {
        return null;
    }
}

function adminLicSetBlocPrefCollapsed(mapKey, licenseId, isCollapsed, lsKeyFn) {
    adminLicEnsurePrefsObject();
    const lid = String(licenseId);
    adminLicenciasUiPrefs[mapKey] = adminLicenciasUiPrefs[mapKey] || {};
    adminLicenciasUiPrefs[mapKey][lid] = !!isCollapsed;
    scheduleAdminLicenciasUiPrefsSave();
    try {
        localStorage.setItem(lsKeyFn(licenseId), isCollapsed ? 'true' : 'false');
    } catch (_e) {}
}

/** Plegados (días / fila de tarjetas): localStorage con ámbito por usuario (`data-licencias-persist-scope`). */
function licenciasUiScopeSlug() {
    try {
        const el = document.querySelector('[data-licencias-persist-scope]');
        const raw = el && el.getAttribute('data-licencias-persist-scope');
        if (raw == null || String(raw).trim() === '') return 'anon';
        const s = String(raw)
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

function licenciasUiAdminDayStorageKeys(licenseId, day) {
    const slug = licenciasUiScopeSlug();
    const lid =
        licenseId === AGGREGATE_LICENSE_ID || licenseId === '0' || licenseId === 0 ? '0' : String(licenseId);
    const d = String(day);
    return {
        scoped: `licencias_ui_${slug}_admin_day_${lid}_${d}_collapsed`,
        legacy: `daySection_${licenseId}_${day}_collapsed`,
    };
}

function licenciasUiAdminDayCollapsedRead(licenseId, day) {
    const lid =
        licenseId === AGGREGATE_LICENSE_ID || licenseId === '0' || licenseId === 0 ? '0' : String(licenseId);
    const d = String(day);
    adminLicEnsurePrefsObject();
    const byLic = adminLicenciasUiPrefs.admin_days[lid];
    if (byLic && Object.prototype.hasOwnProperty.call(byLic, d)) {
        return byLic[d] ? 'true' : 'false';
    }
    const { scoped, legacy } = licenciasUiAdminDayStorageKeys(licenseId, day);
    try {
        let v = localStorage.getItem(scoped);
        if (v == null || v === '') v = localStorage.getItem(legacy);
        if (v !== null && v !== '') {
            try {
                localStorage.setItem(scoped, v);
            } catch (_e2) {}
        }
        return v;
    } catch (_e) {
        return null;
    }
}

function licenciasUiAdminDayCollapsedWrite(licenseId, day, isCollapsed) {
    const lid =
        licenseId === AGGREGATE_LICENSE_ID || licenseId === '0' || licenseId === 0 ? '0' : String(licenseId);
    const d = String(day);
    adminLicEnsurePrefsObject();
    adminLicenciasUiPrefs.admin_days[lid] = adminLicenciasUiPrefs.admin_days[lid] || {};
    adminLicenciasUiPrefs.admin_days[lid][d] = !!isCollapsed;
    scheduleAdminLicenciasUiPrefsSave();
    const { scoped } = licenciasUiAdminDayStorageKeys(licenseId, day);
    try {
        localStorage.setItem(scoped, isCollapsed ? 'true' : 'false');
    } catch (_e) {}
}

function licenciasUiMainGridStorageKeys() {
    const slug = licenciasUiScopeSlug();
    return {
        scoped: `licencias_ui_${slug}_lic_cards_row_collapsed`,
        legacyAdmin: 'licenciasContainerCollapsed',
        legacyPortal: 'userLicenciasContainerCollapsed',
    };
}

function licenciasUiMainGridCollapsedRead() {
    adminLicEnsurePrefsObject();
    if (adminLicenciasUiPrefs.main_grid_collapsed === true) return 'true';
    if (adminLicenciasUiPrefs.main_grid_collapsed === false) return 'false';
    const { scoped, legacyAdmin, legacyPortal } = licenciasUiMainGridStorageKeys();
    try {
        let v = localStorage.getItem(scoped);
        if (v == null || v === '') v = localStorage.getItem(legacyAdmin);
        if (v == null || v === '') v = localStorage.getItem(legacyPortal);
        if (v !== null && v !== '') {
            try {
                localStorage.setItem(scoped, v);
            } catch (_e2) {}
        }
        return v;
    } catch (_e) {
        return null;
    }
}

function licenciasUiMainGridCollapsedWrite(isCollapsed) {
    adminLicEnsurePrefsObject();
    adminLicenciasUiPrefs.main_grid_collapsed = !!isCollapsed;
    scheduleAdminLicenciasUiPrefsSave();
    const { scoped } = licenciasUiMainGridStorageKeys();
    try {
        localStorage.setItem(scoped, isCollapsed ? 'true' : 'false');
    } catch (_e) {}
}

/** Evita re-pintar el listado Cambios al activar la tarjeta del producto desde «devolver» (mantiene estable el DOM de la fila). */
let _adminLicSkipNextChangesProductsRefreshOnce = false;

/** Días aplazados mientras hay un bloc-día enfocado para no pisar texto al vuelo. */
let _pendingLoadAllDaysLicenseId = null;

/** Intervalo (~s): compras/asignaciones y notas tras pago sin recargar página. */
/** Refresco de «Días» en admin tras nuevas cuentas (compras, etc.). Menos intervalo → más cercano al “tiempo real”. */
const ADMIN_LICENCIAS_DAYS_POLL_MS = 1200;

/** Tras cerrar foco desde un día, otra pestaña puede dejar pendiente refrescar «Días» — se reintenta a menudo. */
const ADMIN_LICENCIAS_PENDING_DAYS_FLUSH_MS = 1800;

let __adminLicDaysPollTimer = null;

let __adminLicPendingDaysFlushTimer = null;

let __adminLicDaysRealtimeRefreshBusy = false;

/** Cuentas assigned/sold ya volcadas al bloc Licencias desde la API en esta sesión (evita líneas duplicadas). */
let __adminLicInjectedAssignedAccountIds = new Set();
function isAnyDayNotepadActivelyEditing() {
    const el = document.activeElement;
    if (el && el.closest && el.closest('.day-license-split-root')) {
        const root = el.closest('.day-license-split-root');
        if (root && !root.classList.contains('license-notepad--locked')) {
            return true;
        }
    }
    return (
        el &&
        el.classList &&
        el.classList.contains('day-day-notepad') &&
        el.getAttribute('contenteditable') === 'true'
    );
}

function scheduleLoadAllDaysSoldAccounts(licenseId) {
    if (licenseId == null || licenseId === '') return;
    const lid = Number(licenseId);
    if (Number.isNaN(lid)) return;
    if (isAnyDayNotepadActivelyEditing()) {
        _pendingLoadAllDaysLicenseId = lid;
        return;
    }
    _pendingLoadAllDaysLicenseId = null;
    loadAllDaysSoldAccounts(lid);
}

function flushPendingLoadAllDaysSoldAccounts() {
    if (_pendingLoadAllDaysLicenseId == null) return;
    if (isAnyDayNotepadActivelyEditing()) return;
    const lid = _pendingLoadAllDaysLicenseId;
    _pendingLoadAllDaysLicenseId = null;
    loadAllDaysSoldAccounts(lid);
}

/**
 * Panel de producto visible: tras `loadLicenses`, actualiza highlights y «Días» con los datos nuevos del servidor.
 * Usa schedule para no pisar borradores mientras el admin edita un día.
 */
function refreshExpandedDaysAndAccountsFromLatestLicenses() {
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    if (!inputContainer || inputContainer.classList.contains('d-none')) return;
    const raw = inputContainer.dataset.activeLicenseId;
    if (raw == null || raw === '') return;
    const licenseId = parseInt(raw, 10);
    if (!Number.isFinite(licenseId)) return;
    void loadAndDisplaySavedAccounts(licenseId);
    scheduleLoadAllDaysSoldAccounts(licenseId);
    /** Compras asignan cuenta en servidor pero no amplían license_notes automáticamente: alinear bloc si el admin no está editando ahí. */
    adminTryInjectNewAssignedAccountsIntoOpenBloc();
}

function startAdminLicenciasPendingDaysFlushTicker() {
    if (__adminLicPendingDaysFlushTimer != null || window.IS_ARCHIVED_MODE) return;
    __adminLicPendingDaysFlushTimer = setInterval(function () {
        try {
            flushPendingLoadAllDaysSoldAccounts();
        } catch (_eFlush) {}
    }, ADMIN_LICENCIAS_PENDING_DAYS_FLUSH_MS);
}

/** Cuentas creadas solo para inventario (sin correo real); no deben inyectarse en license_notes desde la API de admin. */
function adminAccountEmailIsInternalSynthetic(email) {
    const e = String(email != null ? email : '')
        .toLowerCase()
        .trim();
    return e.endsWith('@store.internal') || /^inv\.l\d+\./i.test(e);
}

/** Extrae correo normalizado desde el fragmento «credencial» de una línea del bloc Licencias (mesma lógica suelta que otros parsers). */
function adminMainBlocCredEmailKeyFromParsedLine(parts) {
    const c = String(parts && parts.cred != null ? parts.cred : '');
    const m = /\S+@\S+\.\S+/.exec(c);
    return m ? normalizeAccountEmailKey(m[0]) : '';
}

/**
 * Las compras públicas mueven ventas al «Día N» (Colombia); no duplicar en license_notes.
 * (Antes se inyectaban cuentas assigned aquí y se guardaba → filas multiplicadas y Día N incoherente.)
 */
function adminTryInjectNewAssignedAccountsIntoOpenBloc() {
    return;
}

function adminLicenciasUserEditingMainLicenseSplit() {
    const ae = document.activeElement;
    return !!(ae && ae.closest && ae.closest('#adminLicenciasLicenseSplitRoot'));
}

/** Tras cada fetch `/api/licenses`: alinear bloc con servidor si el admin no está editando. */
function adminPollRefreshOpenLicenseViews() {
    if (window.IS_ARCHIVED_MODE) return;
    const ic = document.getElementById('licenseAccountsInputContainer');
    if (!ic || ic.classList.contains('d-none')) {
        refreshExpandedDaysAndAccountsFromLatestLicenses();
        return;
    }
    const rawId = ic.dataset.activeLicenseId;
    if (
        rawId != null &&
        rawId !== '' &&
        rawId !== String(AGGREGATE_LICENSE_ID) &&
        !adminLicenciasUserEditingMainLicenseSplit() &&
        !isAnyDayNotepadActivelyEditing()
    ) {
        const lid = parseInt(rawId, 10);
        const L = licenses.find(function (l) {
            return l.id === lid;
        });
        if (
            L &&
            window.AdminLicenciasNotepad &&
            typeof window.AdminLicenciasNotepad.refreshLicenseSplitFromApi === 'function'
        ) {
            window.AdminLicenciasNotepad.refreshLicenseSplitFromApi(L);
        }
    }
    refreshExpandedDaysAndAccountsFromLatestLicenses();
}

function startAdminLicenciasDaysRealtimePoll() {
    if (__adminLicDaysPollTimer != null || window.IS_ARCHIVED_MODE) return;
    __adminLicDaysPollTimer = setInterval(function adminLicDaysPollTick() {
        if (__adminLicDaysRealtimeRefreshBusy) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        __adminLicDaysRealtimeRefreshBusy = true;
        loadLicenses({ skipGridRender: true }).finally(function () {
            adminPollRefreshOpenLicenseViews();
            __adminLicDaysRealtimeRefreshBusy = false;
        });
    }, ADMIN_LICENCIAS_DAYS_POLL_MS);
}

function injectAggregateLicenseEntry() {
    /* La vista «Todos» (días combinados) solo existe en el portal de usuario; el admin no añade licencia agregada. */
}

function getFirstRealLicenseId() {
    const sorted = licenses
        .filter(l => !l.isAggregate && (window.IS_ARCHIVED_MODE || l.enabled))
        .sort((a, b) => a.position - b.position);
    return sorted.length ? sorted[0].id : null;
}

/**
 * Vista «Todos»: IDs de productos cuya tarjeta está en el grid y no oculta por búsqueda.
 */
function getAggregateVisibleLicenseIdSet() {
    const s = new Set();
    document.querySelectorAll('#licensesGrid .license-card:not(.license-card--aggregate)').forEach(function (card) {
        if (card.classList.contains('hidden-by-search')) return;
        const id = parseInt(card.dataset.licenseId, 10);
        if (Number.isFinite(id)) s.add(id);
    });
    return s;
}

/** Licencias sobre las que debe impactar vaciar/editar día en vista «Todos» (fallback si el grid no aporta IDs). */
function getAggregateAffectedLicenseIds() {
    const s = getAggregateVisibleLicenseIdSet();
    if (s.size > 0) {
        return s;
    }
    const fb = new Set();
    licenses.forEach(function (lic) {
        if (!lic || lic.isAggregate) {
            return;
        }
        if (typeof window !== 'undefined' && window.IS_ARCHIVED_MODE) {
            fb.add(lic.id);
            return;
        }
        if (lic.enabled) {
            fb.add(lic.id);
        }
    });
    return fb;
}

/** Actualiza cache en memoria tras guardar notas en el servidor (bloc admin). */
function patchLicenseNotesCache(
    licenseId,
    personal_notes,
    license_notes,
    suspended_notes,
    expired_notes,
    month_to_month,
    changes_notes
) {
    const L = licenses.find(l => l.id === licenseId);
    var prevChanges = L && Object.prototype.hasOwnProperty.call(L, 'changes_notes') ? L.changes_notes : undefined;
    if (L) {
        L.personal_notes = personal_notes;
        L.license_notes = license_notes;
        if (suspended_notes !== undefined) {
            L.suspended_notes = suspended_notes;
        }
        if (expired_notes !== undefined) {
            L.expired_notes = expired_notes;
        }
        if (changes_notes !== undefined) {
            L.changes_notes = changes_notes;
        }
        if (month_to_month !== undefined) {
            L.month_to_month = month_to_month;
        }
        invalidateLicenseNotesCredentialLineCache();
    }
    if (changes_notes !== undefined && typeof refreshChangesProductsListing === 'function') {
        var prevS = prevChanges != null ? String(prevChanges).replace(/\r\n/g, '\n') : '';
        var nextS = changes_notes != null ? String(changes_notes).replace(/\r\n/g, '\n') : '';
        if (prevS !== nextS) {
            refreshChangesProductsListing();
        }
    }
}
window.patchLicenseNotesCache = patchLicenseNotesCache;

function patchLicenseChangesNotesInCacheOnly(licenseId, changes_notes) {
    const L = licenses.find((l) => l.id === licenseId);
    if (L && changes_notes !== undefined) {
        L.changes_notes = changes_notes;
        invalidateLicenseNotesCredentialLineCache();
    }
}
window.patchLicenseChangesNotesInCacheOnly = patchLicenseChangesNotesInCacheOnly;

/**
 * En contenteditable, la barra espaciadora puede desplazar la página en lugar de insertar espacio.
 * Evita el scroll y escribe el espacio en el foco (Licencias, Caídas, días).
 */
function setupContentEditableSpaceKeyFix() {
    if (document.documentElement.dataset.licenciasSpaceFixBound === '1') return;
    document.documentElement.dataset.licenciasSpaceFixBound = '1';
    document.addEventListener(
        'keydown',
        function (e) {
            if (e.key !== ' ' && e.code !== 'Space') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const host = e.target.closest(
                '#adminLicenciasNotepadByLicense, #adminLicenciasSuspendedNotepad, #adminLicenciasExpiredNotepad, #adminLicenciasChangesNotepad, .day-day-notepad'
            );
            if (!host) return;
            if (host.getAttribute('contenteditable') !== 'true') return;
            e.preventDefault();
            if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
                document.execCommand('insertText', false, ' ');
            }
        },
        true
    );
}

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    // Asegurar que la página quede en la parte superior al cargar
    window.scrollTo(0, 0);

    adminLicBootstrapUiPrefsFromDom();

    setupContentEditableSpaceKeyFix();
    initializeLicenses();
    setupAdminLicWarrantyHistoryUi();
    setupEventListeners();
    startAdminLicenciasDaysRealtimePoll();
    startAdminLicenciasPendingDaysFlushTicker();
    document.addEventListener('visibilitychange', function adminLicenciasDaysOnVisible() {
        if (typeof document.visibilityState !== 'undefined' && document.visibilityState !== 'visible') return;
        if (window.IS_ARCHIVED_MODE || __adminLicDaysRealtimeRefreshBusy) return;
        __adminLicDaysRealtimeRefreshBusy = true;
        loadLicenses({ skipGridRender: true }).finally(function () {
            adminPollRefreshOpenLicenseViews();
            __adminLicDaysRealtimeRefreshBusy = false;
        });
    });
});

const LICENSES_FETCH_TIMEOUT_MS = 28000;

async function initializeLicenses() {
    try {
        await loadLicenses();
        
        if (licenses.length === 0 && !window.IS_ARCHIVED_MODE) {
            await initializeLicensesFromProducts();
        }
    } catch (error) {
        console.error('Error al inicializar licencias:', error);
        try {
            if (!window.IS_ARCHIVED_MODE) {
            await initializeLicensesFromProducts();
            }
        } catch (initError) {
            console.error('Error al inicializar licencias automáticamente:', initError);
        }
    } finally {
        // Si la API falló o el fetch hizo abort, `licenses` sigue vacío y nunca se pintó el grid (pantalla en blanco).
        if (licenses.length === 0) {
            invalidateLicenseNotesCredentialLineCache();
            renderLicensesGrid();
        }
    }
}

// Configurar botón de contraer/expandir
function setupCollapseButton() {
    const collapseBtn = document.getElementById('licensesCollapseBtn');
    const collapseIcon = document.getElementById('collapseIcon');
    const licenciasContainer = document.getElementById('licenciasContainer');
    
    if (collapseBtn && licenciasContainer && collapseIcon) {
        // Cargar estado guardado
        const savedState = licenciasUiMainGridCollapsedRead();
        if (savedState === 'true') {
            licenciasContainer.classList.add('collapsed');
            collapseIcon.classList.remove('fa-chevron-up');
            collapseIcon.classList.add('fa-chevron-down');
        } else {
            licenciasContainer.classList.remove('collapsed');
            collapseIcon.classList.remove('fa-chevron-down');
            collapseIcon.classList.add('fa-chevron-up');
        }
        
        // Remover listener anterior si existe
        const newCollapseBtn = collapseBtn.cloneNode(true);
        collapseBtn.parentNode.replaceChild(newCollapseBtn, collapseBtn);
        
        // Actualizar referencia del icono después del clone
        const newIcon = document.getElementById('collapseIcon');
        
        newCollapseBtn.addEventListener('click', function() {
            licenciasContainer.classList.toggle('collapsed');
            const icon = document.getElementById('collapseIcon');
            if (icon) {
                if (licenciasContainer.classList.contains('collapsed')) {
                    icon.classList.remove('fa-chevron-up');
                    icon.classList.add('fa-chevron-down');
                    licenciasUiMainGridCollapsedWrite(true);
                } else {
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-up');
                    licenciasUiMainGridCollapsedWrite(false);
                }
            }
        });
    }
}

const ADMIN_LICENSE_LINE_DUPLICATE_CLASS = 'admin-license-line-duplicate';
const ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS = 'admin-license-line-duplicate-first';

/** Evita que syncRowCount (p. ej. dentro de getMergedText) dispare otro refresh mientras se calculan duplicados. */
let __markAdminDupInProgress = false;

/** Persistencia: credencial, usuario, estado, notas (ASCII Unit Separator; sin //). */
const LICENSE_LINE_FIELD_SEP = '\x1f';

/** Tras normalizar \\r\\n: cadena vacía → [] (evita una fila fantasma con split('\\n')). */
function licenseSplitCredLinesFromRaw(raw) {
    const r = String(raw != null ? raw : '').replace(/\r\n/g, '\n');
    return r.length === 0 ? [] : r.split('\n');
}

/**
 * Quita repetición de líneas vacías al final (…..\n\n\n) hasta dejar una sola nueva línea
 * de continuación si el usuario abrió otra fila con Enter — evita columnas fantasmas (~4–5 huecos sin datos).
 */
function licenseCredLinesCollapseRepeatedTrailingBlankLines(lines) {
    const arr = lines != null ? lines.slice() : [];
    while (arr.length >= 2 && String(arr[arr.length - 1]).trim() === '' && String(arr[arr.length - 2]).trim() === '') {
        arr.pop();
    }
    return arr;
}

/**
 * Líneas de credencial del bloc principal Licencias, sin “basura” trailing de saltos repetidos.
 */
function adminMainLicenseCredLinesCollapsed(raw) {
    const lines = licenseSplitCredLinesFromRaw(String(raw != null ? raw : '').replace(/\r\n/g, '\n'));
    return licenseCredLinesCollapseRepeatedTrailingBlankLines(lines);
}

/** Cuántas filas mostrar lado derecho: al menos una fila cuando el texto está vacío (para poder escribir). */
function adminMainLicenseBlocSyncRowCountFromCollapsed(collapsedLines) {
    if (!collapsedLines || collapsedLines.length === 0) return 1;
    return collapsedLines.length;
}

/**
 * Opcionalmente reescribe el textarea sólo cuando no tiene foco, para igualar modelo de datos ↔ filas DOM.
 */
function adminMainLicenseNormalizeCredTaTrailingRunsIfBlur(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA' || ta.id !== 'adminLicenciasNotepadByLicense') return;
    if (document.activeElement === ta) return;
    const prev = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const merged = licenseCredLinesCollapseRepeatedTrailingBlankLines(licenseSplitCredLinesFromRaw(prev)).join('\n');
    if (merged !== prev) {
        ta.value = merged;
    }
}

function normalizePlainLineForDuplicateParse(text) {
    if (text == null || typeof text !== 'string') return '';
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * Clave para duplicados: solo hasta el primer espacio en la credencial (primer “token”).
 * Ej.: "sadASDAS DASDF@gmail.com más" → "sadasdas".
 */
function credentialDuplicateKeyFromMergedLine(line) {
    const t = String(line || '').trim();
    if (!t) return null;
    let credPart = t;
    if (t.indexOf(LICENSE_LINE_FIELD_SEP) !== -1) {
        credPart = t.slice(0, t.indexOf(LICENSE_LINE_FIELD_SEP));
    } else if (indexOfLegacyDoubleSlashSeparatorFrom(t, 0) !== -1) {
        const sp = splitLineCredNotesUser(t);
        credPart = sp.cred != null && String(sp.cred).trim() !== '' ? String(sp.cred).trim() : t;
    }
    const norm = normalizePlainLineForDuplicateParse(credPart);
    if (!norm) return null;
    const firstTok = norm.split(/\s+/)[0] || '';
    if (!firstTok) return null;
    try {
        return 'pref:' + firstTok.toLowerCase().normalize('NFC');
    } catch (nfce) {
        return 'pref:' + firstTok.toLowerCase();
    }
}

function clearSuspendedDuplicateLineLayer() {
    const ta = document.getElementById('adminLicenciasSuspendedNotepad');
    if (!ta) return;
    if (ta._boundSuspendedDupScroll) {
        ta.removeEventListener('scroll', ta._boundSuspendedDupScroll);
        delete ta._boundSuspendedDupScroll;
    }
    if (ta._boundSuspendedDupInput) {
        ta.removeEventListener('input', ta._boundSuspendedDupInput);
        delete ta._boundSuspendedDupInput;
    }
    if (ta._suspendedDupInputT != null) {
        clearTimeout(ta._suspendedDupInputT);
        delete ta._suspendedDupInputT;
    }
    const stack = ta.closest('.admin-suspended-ta-dup-stack');
    if (stack) {
        stack.classList.remove('admin-dup-lines-active');
        const layer = stack.querySelector('.admin-suspended-dup-line-layer');
        if (layer) {
            layer.innerHTML = '';
            layer.style.transform = '';
            delete layer.dataset.firstDupLine;
        }
    }
    ta.style.background = '';
}

function adminDupHighlightSetActive(on) {
    document.documentElement.dataset.adminLicDupHighlightActive = on ? '1' : '0';
    const btn = document.getElementById('licensesDuplicatesBtn');
    if (btn) {
        btn.classList.toggle('licenses-duplicates-btn--active', !!on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

function adminDupHighlightDeactivate() {
    clearAdminDuplicateLineHighlights();
    adminDupHighlightSetActive(false);
}

/** Quita marcas visuales de duplicados sin cambiar el estado del botón (p. ej. antes de volver a calcular). */
function clearAdminDuplicateLineHighlights() {
    document.querySelectorAll(`.admin-license-line-row.${ADMIN_LICENSE_LINE_DUPLICATE_CLASS}`).forEach((el) => {
        el.classList.remove(ADMIN_LICENSE_LINE_DUPLICATE_CLASS);
    });
    document.querySelectorAll(`.license-split-editor__row.${ADMIN_LICENSE_LINE_DUPLICATE_CLASS}`).forEach((el) => {
        el.classList.remove(ADMIN_LICENSE_LINE_DUPLICATE_CLASS);
    });
    document.querySelectorAll(`.${ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS}`).forEach((el) => {
        el.classList.remove(ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS);
    });
    clearSuspendedDuplicateLineLayer();
    clearExpiredDuplicateLineLayer();
    clearChangesDuplicateLineLayer();
}

function ensureSuspendedTextareaDupStack(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return null;
    let stack = ta.closest('.admin-suspended-ta-dup-stack');
    if (stack) return stack;
    const parent = ta.parentNode;
    if (!parent) return null;
    stack = document.createElement('div');
    stack.className = 'admin-suspended-ta-dup-stack';
    const layer = document.createElement('div');
    layer.className = 'admin-suspended-dup-line-layer';
    layer.setAttribute('aria-hidden', 'true');
    parent.insertBefore(stack, ta);
    stack.appendChild(layer);
    stack.appendChild(ta);
    return stack;
}

/**
 * Capa detrás del textarea de Caídas: franjas amarillas por línea (incluye duplicados cruzados con Licencias/Días).
 */
function applySuspendedDuplicateLineLayer(ta, dupIndicesSet) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    /* Credenciales Caídas: no franjas en el textarea; el aviso duplicate va solo en celdas de la derecha (CSS fila). */
    if (ta.id === 'adminLicenciasSuspendedNotepad') {
        dupIndicesSet = new Set();
    }
    const stack = ensureSuspendedTextareaDupStack(ta);
    if (!stack) return;
    const layer = stack.querySelector('.admin-suspended-dup-line-layer');
    if (!layer) return;

    if (!dupIndicesSet || dupIndicesSet.size === 0) {
        stack.classList.remove('admin-dup-lines-active');
        layer.innerHTML = '';
        layer.style.transform = '';
        delete layer.dataset.firstDupLine;
        ta.style.background = '';
        return;
    }

    const cs = window.getComputedStyle(ta);
    const fontSize = parseFloat(cs.fontSize) || 14;
    let lineHeightPx = parseFloat(cs.lineHeight);
    if (!lineHeightPx || Number.isNaN(lineHeightPx) || cs.lineHeight === 'normal') {
        lineHeightPx = fontSize * 1.45;
    }
    const padT = parseFloat(cs.paddingTop) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const padL = parseFloat(cs.paddingLeft) || 0;

    layer.style.paddingTop = cs.paddingTop;
    layer.style.paddingRight = cs.paddingRight;
    layer.style.paddingBottom = cs.paddingBottom;
    layer.style.paddingLeft = cs.paddingLeft;
    layer.style.fontFamily = cs.fontFamily;
    layer.style.fontSize = cs.fontSize;
    layer.style.lineHeight = cs.lineHeight;
    layer.style.width = '100%';
    layer.style.boxSizing = cs.boxSizing || 'border-box';

    const raw = String(ta.value || '').replace(/\r\n/g, '\n');
    const lines = raw.length === 0 ? [] : raw.split('\n');
    layer.innerHTML = '';
    for (let i = 0; i < lines.length; i++) {
        const strip = document.createElement('div');
        strip.style.height = lineHeightPx + 'px';
        strip.style.boxSizing = 'border-box';
        strip.style.margin = '0';
        if (dupIndicesSet.has(i)) {
            strip.style.background = 'rgba(250, 204, 21, 0.35)';
            strip.style.boxShadow = 'inset 0 0 0 1px rgba(234, 179, 8, 0.75)';
        }
        layer.appendChild(strip);
    }

    try {
        layer.style.minHeight = Math.max(ta.scrollHeight, padT + lines.length * lineHeightPx + padB) + 'px';
    } catch (mhErr) {
        /* ignore */
    }

    const minLine = Math.min.apply(null, Array.from(dupIndicesSet));
    layer.dataset.firstDupLine = String(minLine);

    stack.classList.add('admin-dup-lines-active');
    ta.style.background = 'transparent';

    const syncScroll = function () {
        layer.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
    };
    syncScroll();

    if (!ta._boundSuspendedDupScroll) {
        ta._boundSuspendedDupScroll = syncScroll;
        ta.addEventListener('scroll', ta._boundSuspendedDupScroll);
    }

    if (!ta._boundSuspendedDupInput) {
        ta._boundSuspendedDupInput = function () {
            if (document.documentElement.dataset.adminLicDupHighlightActive !== '1') return;
            clearTimeout(ta._suspendedDupInputT);
            ta._suspendedDupInputT = setTimeout(function () {
                if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
                    window.refreshAdminDuplicateHighlightsIfActive();
                }
            }, 180);
        };
        ta.addEventListener('input', ta._boundSuspendedDupInput);
    }
}

function clearChangesDuplicateLineLayer() {
    document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split__creds').forEach(function (ta) {
        if (!ta || ta.tagName !== 'TEXTAREA') return;
        if (ta._boundExpiredDupScroll) {
            ta.removeEventListener('scroll', ta._boundExpiredDupScroll);
            delete ta._boundExpiredDupScroll;
        }
        if (ta._boundExpiredDupInput) {
            ta.removeEventListener('input', ta._boundExpiredDupInput);
            delete ta._boundExpiredDupInput;
        }
        if (ta._expiredDupInputT != null) {
            clearTimeout(ta._expiredDupInputT);
            delete ta._expiredDupInputT;
        }
        const stack = ta.closest('.admin-expired-ta-dup-stack');
        if (stack) {
            stack.classList.remove('admin-dup-lines-active');
            const layer = stack.querySelector('.admin-expired-dup-line-layer');
            if (layer) {
                layer.innerHTML = '';
                layer.style.transform = '';
                delete layer.dataset.firstDupLine;
            }
        }
        ta.style.background = '';
    });
}

function clearExpiredDuplicateLineLayer() {
    const ta = document.getElementById('adminLicenciasExpiredNotepad');
    if (!ta) return;
    if (ta._boundExpiredDupScroll) {
        ta.removeEventListener('scroll', ta._boundExpiredDupScroll);
        delete ta._boundExpiredDupScroll;
    }
    if (ta._boundExpiredDupInput) {
        ta.removeEventListener('input', ta._boundExpiredDupInput);
        delete ta._boundExpiredDupInput;
    }
    if (ta._expiredDupInputT != null) {
        clearTimeout(ta._expiredDupInputT);
        delete ta._expiredDupInputT;
    }
    const stack = ta.closest('.admin-expired-ta-dup-stack');
    if (stack) {
        stack.classList.remove('admin-dup-lines-active');
        const layer = stack.querySelector('.admin-expired-dup-line-layer');
        if (layer) {
            layer.innerHTML = '';
            layer.style.transform = '';
            delete layer.dataset.firstDupLine;
        }
    }
    ta.style.background = '';
}

function ensureExpiredTextareaDupStack(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return null;
    let stack = ta.closest('.admin-expired-ta-dup-stack');
    if (stack) return stack;
    const parent = ta.parentNode;
    if (!parent) return null;
    stack = document.createElement('div');
    stack.className = 'admin-expired-ta-dup-stack';
    const layer = document.createElement('div');
    layer.className = 'admin-expired-dup-line-layer';
    layer.setAttribute('aria-hidden', 'true');
    parent.insertBefore(stack, ta);
    stack.appendChild(layer);
    stack.appendChild(ta);
    return stack;
}

function applyExpiredDuplicateLineLayer(ta, dupIndicesSet) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    if (ta.id === 'adminLicenciasExpiredNotepad') {
        dupIndicesSet = new Set();
    }
    const stack = ensureExpiredTextareaDupStack(ta);
    if (!stack) return;
    const layer = stack.querySelector('.admin-expired-dup-line-layer');
    if (!layer) return;

    if (!dupIndicesSet || dupIndicesSet.size === 0) {
        stack.classList.remove('admin-dup-lines-active');
        layer.innerHTML = '';
        layer.style.transform = '';
        delete layer.dataset.firstDupLine;
        ta.style.background = '';
        return;
    }

    const cs = window.getComputedStyle(ta);
    const fontSize = parseFloat(cs.fontSize) || 14;
    let lineHeightPx = parseFloat(cs.lineHeight);
    if (!lineHeightPx || Number.isNaN(lineHeightPx) || cs.lineHeight === 'normal') {
        lineHeightPx = fontSize * 1.45;
    }
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;

    layer.style.paddingTop = cs.paddingTop;
    layer.style.paddingRight = cs.paddingRight;
    layer.style.paddingBottom = cs.paddingBottom;
    layer.style.paddingLeft = cs.paddingLeft;
    layer.style.fontFamily = cs.fontFamily;
    layer.style.fontSize = cs.fontSize;
    layer.style.lineHeight = cs.lineHeight;
    layer.style.width = '100%';
    layer.style.boxSizing = cs.boxSizing || 'border-box';

    const raw = String(ta.value || '').replace(/\r\n/g, '\n');
    const lines = raw.length === 0 ? [] : raw.split('\n');
    layer.innerHTML = '';
    for (let i = 0; i < lines.length; i++) {
        const strip = document.createElement('div');
        strip.style.height = lineHeightPx + 'px';
        strip.style.boxSizing = 'border-box';
        strip.style.margin = '0';
        if (dupIndicesSet.has(i)) {
            strip.style.background = 'rgba(250, 204, 21, 0.35)';
            strip.style.boxShadow = 'inset 0 0 0 1px rgba(234, 179, 8, 0.75)';
        }
        layer.appendChild(strip);
    }

    try {
        layer.style.minHeight = Math.max(ta.scrollHeight, padT + lines.length * lineHeightPx + padB) + 'px';
    } catch (mhErr) {
        /* ignore */
    }

    const minLine = Math.min.apply(null, Array.from(dupIndicesSet));
    layer.dataset.firstDupLine = String(minLine);

    stack.classList.add('admin-dup-lines-active');
    ta.style.background = 'transparent';

    const syncScroll = function () {
        layer.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
    };
    syncScroll();

    if (!ta._boundExpiredDupScroll) {
        ta._boundExpiredDupScroll = syncScroll;
        ta.addEventListener('scroll', ta._boundExpiredDupScroll);
    }

    if (!ta._boundExpiredDupInput) {
        ta._boundExpiredDupInput = function () {
            if (document.documentElement.dataset.adminLicDupHighlightActive !== '1') return;
            clearTimeout(ta._expiredDupInputT);
            ta._expiredDupInputT = setTimeout(function () {
                if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
                    window.refreshAdminDuplicateHighlightsIfActive();
                }
            }, 180);
        };
        ta.addEventListener('input', ta._boundExpiredDupInput);
    }
}

function collectAdminDuplicateScanRoots() {
    const roots = [];
    const lic = document.getElementById('adminLicenciasNotepadByLicense');
    if (lic) roots.push(lic);
    const suspended = document.getElementById('adminLicenciasSuspendedNotepad');
    if (suspended) roots.push(suspended);
    const expired = document.getElementById('adminLicenciasExpiredNotepad');
    if (expired) roots.push(expired);
    document
        .querySelectorAll('#licenseChangesProductsContainer .changes-license-split__creds')
        .forEach((el) => roots.push(el));
    adminLicCollectDaySplitRootsForActiveUi().forEach((el) => roots.push(el));
    const suspSplitRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (suspSplitRoot) roots.push(suspSplitRoot);
    const expSplitRoot = document.getElementById('adminLicenciasExpiredSplitRoot');
    if (expSplitRoot) roots.push(expSplitRoot);
    return roots;
}

/**
 * Duplicados = mismo primer token de la credencial (hasta el primer espacio). Se marcan todas las apariciones que comparten clave
 * (Licencias, Días, Caídas, Vencidas y Cambios). La clase *duplicate-first* sólo se aplica desde la segunda para el scroll/pulso.
 */
function markCredentialDuplicateLineRowsAcrossRoots(roots) {
    __markAdminDupInProgress = true;
    try {
    const byKey = new Map();
    function pushRow(key, rowEl) {
        if (!key || !rowEl) return;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(rowEl);
    }
    adminLicCollectDaySplitRootsForActiveUi().forEach(function (root) {
        if (typeof dayLicenseSplitGetMergedText !== 'function') return;
        const merged = String(dayLicenseSplitGetMergedText(root) || '').replace(/\r\n/g, '\n');
        const lines = merged === '' ? [] : merged.split('\n');
        const splitRows = dayLicenseSplitGetRowElements(root);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const norm = normalizePlainLineForDuplicateParse(line);
            if (!norm) continue;
            const key = credentialDuplicateKeyFromMergedLine(line);
            const domRow = splitRows[i];
            pushRow(key, domRow);
        }
    });
    roots.forEach((root) => {
        root.querySelectorAll('.admin-license-line-row').forEach((row) => {
            const line = normalizePlainLineForDuplicateParse(row.textContent || '');
            if (!line) return;
            const key = credentialDuplicateKeyFromMergedLine(line);
            pushRow(key, row);
        });
    });
    const licTa = document.getElementById('adminLicenciasNotepadByLicense');
    if (
        licTa &&
        licTa.classList &&
        licTa.classList.contains('license-split-editor__creds') &&
        typeof buildAdminLicenseStorageLine === 'function' &&
        typeof adminLicenseSplitReadRow === 'function'
    ) {
        if (typeof adminLicenseSplitSyncRowsToTextarea === 'function') {
            adminLicenseSplitSyncRowsToTextarea();
        }
        const raw = String(licTa.value != null ? licTa.value : '').replace(/\r\n/g, '\n');
        const credLines = adminMainLicenseCredLinesCollapsed(raw);
        const splitRows = adminLicenseSplitGetRowElements();
        for (let i = 0; i < credLines.length; i++) {
            const row = splitRows[i];
            const r = row
                ? adminLicenseSplitReadRow(row)
                : { user: '', statusGood: '', statusBad: '', extra: '' };
            const line = buildAdminLicenseStorageLine(
                credLines[i],
                r.user != null ? r.user : '',
                r.statusGood != null ? r.statusGood : '',
                r.statusBad != null ? r.statusBad : '',
                r.extra != null ? r.extra : ''
            );
            const norm = normalizePlainLineForDuplicateParse(line);
            if (!norm) continue;
            const key = credentialDuplicateKeyFromMergedLine(line);
            pushRow(key, row);
        }
    }

    const suspRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (
        suspRoot &&
        typeof suspendedLicenseSplitGetMergedText === 'function' &&
        typeof suspendedLicenseSplitGetRowElements === 'function'
    ) {
        const sm = String(suspendedLicenseSplitGetMergedText(suspRoot) || '').replace(/\r\n/g, '\n');
        const slines = sm === '' ? [] : sm.split('\n');
        const suspRows = suspendedLicenseSplitGetRowElements(suspRoot);
        for (let si = 0; si < slines.length; si++) {
            const line = slines[si];
            const norm = normalizePlainLineForDuplicateParse(line);
            if (!norm) continue;
            const key = credentialDuplicateKeyFromMergedLine(line);
            if (!key) continue;
            const domSr = suspRows[si];
            if (domSr) {
                pushRow(key, domSr);
            }
        }
    }

    const expRoot = document.getElementById('adminLicenciasExpiredSplitRoot');
    if (
        expRoot &&
        typeof expiredLicenseSplitGetMergedText === 'function' &&
        typeof expiredLicenseSplitGetRowElements === 'function'
    ) {
        const em = String(expiredLicenseSplitGetMergedText(expRoot) || '').replace(/\r\n/g, '\n');
        const elines = em === '' ? [] : em.split('\n');
        const expRows = expiredLicenseSplitGetRowElements(expRoot);
        for (let ei = 0; ei < elines.length; ei++) {
            const line = elines[ei];
            const norm = normalizePlainLineForDuplicateParse(line);
            if (!norm) continue;
            const key = credentialDuplicateKeyFromMergedLine(line);
            if (!key) continue;
            const domEr = expRows[ei];
            if (domEr) {
                pushRow(key, domEr);
            }
        }
    }

    document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(function (chRoot) {
        if (typeof changesLicenseSplitGetMergedText !== 'function') return;
        const merged = String(changesLicenseSplitGetMergedText(chRoot) || '').replace(/\r\n/g, '\n');
        const lines = merged === '' ? [] : merged.split('\n');
        const splitRows = changesLicenseSplitGetRowElements(chRoot);
        const ta = changesLicenseSplitQueryCredsTa(chRoot);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const norm = normalizePlainLineForDuplicateParse(line);
            if (!norm) continue;
            const key = credentialDuplicateKeyFromMergedLine(line);
            const domRow = splitRows[i];
            if (domRow) {
                pushRow(key, domRow);
            } else if (ta && ta.tagName === 'TEXTAREA') {
                pushRow(key, { _changesDupRef: true, ta: ta, lineIndex: i });
            }
        }
    });

    const suspendedDupByTa = new Map();
    const expiredDupByTa = new Map();
    const changesDupByTa = new Map();
    let firstSplitDupToPulse = null;
    byKey.forEach((list) => {
        if (list.length < 2) return;
        for (let di = 0; di < list.length; di++) {
            const item = list[di];
            if (item && item._suspendedDupRef) {
                if (!suspendedDupByTa.has(item.ta)) suspendedDupByTa.set(item.ta, new Set());
                suspendedDupByTa.get(item.ta).add(item.lineIndex);
                continue;
            }
            if (item && item._changesDupRef) {
                if (!changesDupByTa.has(item.ta)) changesDupByTa.set(item.ta, new Set());
                changesDupByTa.get(item.ta).add(item.lineIndex);
                continue;
            }
            if (item && item._expiredDupRef) {
                if (!expiredDupByTa.has(item.ta)) expiredDupByTa.set(item.ta, new Set());
                expiredDupByTa.get(item.ta).add(item.lineIndex);
                continue;
            }
            if (item && item.classList && item.classList.contains('license-split-editor__row')) {
                item.classList.add(ADMIN_LICENSE_LINE_DUPLICATE_CLASS);
                /* Pulso/ancla de scroll en la segunda+ aparición (no en la primera del grupo duplicado). */
                if (di >= 1 && !firstSplitDupToPulse) firstSplitDupToPulse = item;
                continue;
            }
            if (item && item.classList) {
                item.classList.add(ADMIN_LICENSE_LINE_DUPLICATE_CLASS);
            }
        }
    });
    if (firstSplitDupToPulse) {
        firstSplitDupToPulse.classList.add(ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS);
    }
    suspendedDupByTa.forEach(function (indices, ta) {
        applySuspendedDuplicateLineLayer(ta, indices);
    });
    expiredDupByTa.forEach(function (indices, ta) {
        applyExpiredDuplicateLineLayer(ta, indices);
    });
    changesDupByTa.forEach(function (indices, ta) {
        applyExpiredDuplicateLineLayer(ta, indices);
    });
    } finally {
        __markAdminDupInProgress = false;
    }
}

function refreshAdminDuplicateHighlightsIfActive() {
    if (document.documentElement.dataset.adminLicDupHighlightActive !== '1') return;
    clearAdminDuplicateLineHighlights();
    const roots = collectAdminDuplicateScanRoots();
    roots.forEach((root) => {
        try {
            if (root.classList && root.classList.contains('day-license-split-root')) {
                return;
            }
            /* Caídas / Vencidas (split): el root contiene textarea + filas DOM. highlightEmailsAndPasswords
               reescribe innerHTML como bloc monolítico y destruye el layout (texto de selects amontonado). */
            if (
                root.id === 'adminLicenciasSuspendedSplitRoot' ||
                root.id === 'adminLicenciasExpiredSplitRoot'
            ) {
                return;
            }
            if (typeof highlightEmailsAndPasswords === 'function') {
                highlightEmailsAndPasswords(root);
            }
        } catch (err) {
            console.error('Duplicados: error al resaltar líneas', err);
        }
    });
    try {
        markCredentialDuplicateLineRowsAcrossRoots(roots);
    } catch (err2) {
        console.error('Duplicados: error al marcar filas', err2);
    }
}

window.refreshAdminDuplicateHighlightsIfActive = refreshAdminDuplicateHighlightsIfActive;

let _refreshAdminDupDeb = null;
function scheduleRefreshAdminDupIfActive() {
    if (document.documentElement.dataset.adminLicDupHighlightActive !== '1') return;
    clearTimeout(_refreshAdminDupDeb);
    _refreshAdminDupDeb = setTimeout(function () {
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
    }, 180);
}

window.scheduleRefreshAdminDupIfActive = scheduleRefreshAdminDupIfActive;

/** Duplicados: mismo primer token entre Licencias/Días/etc. Todas las apariciones de la clave se resaltan; el scroll enfoca desde la segunda. */
function scanAdminDuplicateLines() {
    if (document.documentElement.dataset.adminLicDupHighlightActive === '1') {
        adminDupHighlightDeactivate();
        return;
    }
    clearAdminDuplicateLineHighlights();
    const roots = collectAdminDuplicateScanRoots();
    roots.forEach((root) => {
        try {
            if (root.classList && root.classList.contains('day-license-split-root')) {
                return;
            }
            if (typeof highlightEmailsAndPasswords === 'function') {
                highlightEmailsAndPasswords(root);
            }
        } catch (err) {
            console.error('Duplicados: error al resaltar líneas', err);
        }
    });
    try {
        markCredentialDuplicateLineRowsAcrossRoots(roots);
    } catch (err) {
        console.error('Duplicados: error al marcar filas', err);
        adminDupHighlightSetActive(false);
        return;
    }
    adminDupHighlightSetActive(true);

    const firstSplit =
        document.querySelector(
            `#adminLicenciasStructuredRows .license-split-editor__row.${ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS}`
        ) ||
        document.querySelector(
            `#adminLicenciasSuspendedRows .license-split-editor__row.${ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS}`
        ) ||
        document.querySelector(
            `#adminLicenciasExpiredRows .license-split-editor__row.${ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS}`
        ) ||
        document.querySelector(
            `#licenseChangesProductsContainer .license-split-editor__row.${ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS}`
        ) ||
        document.querySelector(
            `#licenseAllDaysContainer .license-split-editor__row.${ADMIN_LICENSE_LINE_DUPLICATE_FIRST_CLASS}`
        );
    if (firstSplit) {
        try {
            firstSplit.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch (e) {
            try {
                firstSplit.scrollIntoView(true);
            } catch (e2) {
                /* ignore */
            }
        }
        return;
    }
    const taChList = document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split__creds');
    for (let ci = 0; ci < taChList.length; ci++) {
        const taCh = taChList[ci];
        const stackCh = taCh && taCh.closest('.admin-expired-ta-dup-stack');
        const layerCh = stackCh && stackCh.querySelector('.admin-expired-dup-line-layer');
        if (taCh && layerCh && layerCh.dataset.firstDupLine != null && layerCh.dataset.firstDupLine !== '') {
            const lineCh = parseInt(layerCh.dataset.firstDupLine, 10);
            if (Number.isFinite(lineCh)) {
                const csC = window.getComputedStyle(taCh);
                const fsC = parseFloat(csC.fontSize) || 14;
                let lhC = parseFloat(csC.lineHeight);
                if (!lhC || Number.isNaN(lhC) || csC.lineHeight === 'normal') {
                    lhC = fsC * 1.45;
                }
                const ptC = parseFloat(csC.paddingTop) || 0;
                try {
                    taCh.scrollTop = Math.max(0, lineCh * lhC - ptC);
                } catch (e9) {
                    /* ignore */
                }
            }
            try {
                stackCh.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (e10) {
                try {
                    stackCh.scrollIntoView(true);
                } catch (e11) {
                    /* ignore */
                }
            }
            return;
        }
    }
}

function setupDuplicatesScanButton() {
    if (document.documentElement.dataset.licensesDupScanBound === '1') {
        return;
    }
    document.documentElement.dataset.licensesDupScanBound = '1';
    document.addEventListener('click', function licensesDuplicatesToolbarClick(ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest('#licensesDuplicatesBtn') : null;
        if (!btn) {
            return;
        }
        ev.preventDefault();
        scanAdminDuplicateLines();
    });
}

function adminLicenseSplitGetFocusedLicenseRow() {
    const root = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!root) return null;
    const ae = document.activeElement;
    if (ae && root.contains(ae)) {
        const row = ae.closest('.license-split-editor__row');
        if (row) return row;
    }
    return null;
}

function scrollAdminLicenciasCambiosListIntoView() {
    if (typeof refreshChangesProductsListing === 'function') {
        refreshChangesProductsListing();
    }
    scrollAdminLicenciasCambiosPanelIntoView();
}

function setupMoveToChangesToolbarButton() {
    if (document.documentElement.dataset.licensesMoveToChangesBound === '1') {
        return;
    }
    document.documentElement.dataset.licensesMoveToChangesBound = '1';
    document.addEventListener('click', function licensesMoveToChangesClick(ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest('#licensesMoveToChangesBtn') : null;
        if (!btn) {
            return;
        }
        ev.preventDefault();
        openAdminLicenciasCambiosPanelUi({ skipScroll: true });
        const row = adminLicenseSplitGetFocusedLicenseRow();
        if (row) {
            void adminLicenseSplitMoveRowToChanges(row).finally(function () {
                scrollAdminLicenciasCambiosPanelIntoView();
            });
            return;
        }
        scrollAdminLicenciasCambiosPanelIntoView();
    });
}

const ADMIN_USER_SEARCH_MIN_CHARS = 1;
let _adminUserSearchDebounce = null;

function _adminUserSearchEscHandler(e) {
    if (e.key === 'Escape') {
        closeAdminUserSearchModal();
    }
}

function closeAdminUserSearchModal() {
    const m = document.getElementById('adminLicenseUserSearchModal');
    if (m) {
        m.remove();
    }
    document.removeEventListener('keydown', _adminUserSearchEscHandler);
}

function openAdminUserSearchModal(initialQuery) {
    closeAdminUserSearchModal();
    const initial = (initialQuery || '').trim();
    const modal = document.createElement('div');
    modal.id = 'adminLicenseUserSearchModal';
    modal.className = 'admin-license-user-search-modal show';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'adminLicenseUserSearchTitle');
    modal.innerHTML = `
        <div class="admin-license-user-search-content">
            <h3 id="adminLicenseUserSearchTitle">Buscar usuario</h3>
            <p class="admin-license-user-search-hint">Por nombre o usuario (principales). Doble clic en un resultado: copia y cierra.</p>
            <label for="adminLicenseUserSearchInput" class="sr-only">Buscar usuario</label>
            <input type="search" id="adminLicenseUserSearchInput" class="admin-license-user-search-input" placeholder="Buscar por nombre o usuario…" autocomplete="off">
            <div id="adminLicenseUserSearchStatus" class="admin-license-user-search-status" aria-live="polite"></div>
            <div id="adminLicenseUserSearchResults" class="admin-license-user-search-results"></div>
            <div class="admin-license-user-search-footer">
                <button type="button" class="btn-panel btn-red" data-action="close-admin-user-search">Cerrar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const inp = modal.querySelector('#adminLicenseUserSearchInput');
    const resultsEl = modal.querySelector('#adminLicenseUserSearchResults');
    const statusEl = modal.querySelector('#adminLicenseUserSearchStatus');
    inp.value = initial;

    function renderUsers(users) {
        resultsEl.innerHTML = '';
        if (!users || !users.length) {
            const p = document.createElement('p');
            p.className = 'admin-license-user-search-empty';
            p.textContent = 'Sin resultados.';
            resultsEl.appendChild(p);
            return;
        }
        users.forEach(function (u) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'admin-license-user-search-row';
            if (u.username) {
                btn.dataset.username = u.username;
            }
            const spanUser = document.createElement('span');
            spanUser.className = 'admin-license-user-search-row-user';
            spanUser.textContent = u.username || '';
            btn.appendChild(spanUser);
            if (u.full_name && String(u.full_name).trim()) {
                const spanName = document.createElement('span');
                spanName.className = 'admin-license-user-search-row-name';
                spanName.textContent = String(u.full_name).trim();
                btn.appendChild(spanName);
            }
            if (u.email && String(u.email).trim()) {
                const spanEmail = document.createElement('span');
                spanEmail.className = 'admin-license-user-search-row-email';
                spanEmail.textContent = String(u.email).trim();
                btn.appendChild(spanEmail);
            }
            resultsEl.appendChild(btn);
        });
    }

    async function runSearch(q) {
        const t = (q || '').trim();
        if (t.length < ADMIN_USER_SEARCH_MIN_CHARS) {
            statusEl.textContent = '';
            resultsEl.innerHTML = '';
            return;
        }
        statusEl.textContent = 'Buscando…';
        try {
            const url = '/admin/search_users_ajax?query=' + encodeURIComponent(t);
            const res = await fetch(url, { credentials: 'same-origin' });
            const data = await res.json();
            if (data.status === 'ok' && Array.isArray(data.users)) {
                renderUsers(data.users);
                statusEl.textContent = data.users.length
                    ? data.users.length + ' resultado(s)'
                    : 'Sin coincidencias.';
            } else {
                statusEl.textContent = 'No se pudo cargar la búsqueda.';
                resultsEl.innerHTML = '';
            }
        } catch (err) {
            statusEl.textContent = 'Error de red.';
            resultsEl.innerHTML = '';
        }
    }

    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            closeAdminUserSearchModal();
        }
    });
    const closeBtn = modal.querySelector('[data-action="close-admin-user-search"]');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeAdminUserSearchModal);
    }
    resultsEl.addEventListener('dblclick', function (e) {
        const row = e.target.closest('.admin-license-user-search-row');
        if (!row || !row.dataset.username) return;
        e.preventDefault();
        const un = row.dataset.username;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(un).catch(function () {});
        }
        closeAdminUserSearchModal();
    });

    inp.addEventListener('input', function () {
        clearTimeout(_adminUserSearchDebounce);
        const v = inp.value;
        _adminUserSearchDebounce = setTimeout(function () {
            runSearch(v);
        }, 320);
    });

    document.addEventListener('keydown', _adminUserSearchEscHandler);
    setTimeout(function () {
        inp.focus();
        inp.select();
        if (initial.length >= ADMIN_USER_SEARCH_MIN_CHARS) {
            runSearch(initial);
        }
    }, 0);
}

function setupAdminUserLabelSearchModal() {
    document.addEventListener(
        'dblclick',
        function (e) {
            const label = e.target.closest('.day-account-user-label');
            if (!label || !document.querySelector('.admin-licencias-page')) {
                return;
            }
            if (!label.closest('.admin-licencias-page')) {
                return;
            }
            const licRoot = label.closest(
                '#adminLicenciasNotepadByLicense, #adminLicenciasSuspendedNotepad, .day-license-split-root, .day-day-notepad, .admin-licencias-license-editable, .admin-licencias-suspended-editable'
            );
            if (!licRoot) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const raw = (label.textContent || '').trim();
            const initial = raw.toLowerCase() === 'anonimo' ? '' : raw;
            openAdminUserSearchModal(initial);
        },
        true
    );
}

/** Oculta notas/licencias/días y deja solo grid + panel lateral (reportes o cambios). */
function syncAdminHistorialShellMode() {
    const rep = document.getElementById('adminLicenciasReportesPanel');
    const cam = document.getElementById('adminLicenciasCambiosPanel');
    const shell = document.querySelector('.admin-licencias-shell');
    if (!shell) {
        return;
    }
    const reportesOpen = rep && !rep.classList.contains('d-none');
    const cambiosOpen = cam && !cam.classList.contains('d-none');
    shell.classList.toggle('admin-licencias-historial-mode', reportesOpen || cambiosOpen);
}

function getAdminLicenciasCambiosToolbarBtn() {
    return document.getElementById('licensesMoveToChangesBtn');
}

function syncAdminLicenciasCambiosToolbarBtnOpen(isOpen) {
    const btn = getAdminLicenciasCambiosToolbarBtn();
    if (!btn) {
        return;
    }
    if (isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('licenses-move-to-changes-btn--active');
    } else {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('licenses-move-to-changes-btn--active');
    }
}

function closeAdminLicenciasCambiosPanelUi() {
    const panel = document.getElementById('adminLicenciasCambiosPanel');
    if (panel && !panel.classList.contains('d-none')) {
        panel.classList.add('d-none');
        panel.setAttribute('aria-hidden', 'true');
    }
    syncAdminLicenciasCambiosToolbarBtnOpen(false);
    syncAdminHistorialShellMode();
}

/**
 * Tras devolver cuenta desde Caídas o Vencidas: cierra Cambios si estaba abierto,
 * restaura .active del producto, limpia modo lateral en localStorage
 * y hace scroll al bloc Licencias. (Desde «devolver» en Cambios no se llama: se queda en Cambios.)
 */
function adminLicenciasReturnToLicenseEditorAfterRestoreUi(licenseId) {
    var licSplitFallback = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        if (licSplitFallback && typeof licSplitFallback.scrollIntoView === 'function') {
            licSplitFallback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
    }
    closeAdminLicenciasCambiosPanelUi();
    try {
        localStorage.removeItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
    } catch (_e0) {}
    var sid = String(licenseId);
    document.querySelectorAll('.license-card').forEach(function (c) {
        if (c.classList.contains('license-card--panel-toggle')) return;
        c.classList.remove('active');
    });
    var card = document.querySelector(
        '.license-card[data-license-id="' + sid + '"]:not(.license-card--aggregate)'
    );
    if (card) {
        card.classList.add('active');
    }
    window.requestAnimationFrame(function () {
        if (card && typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        var ls = document.getElementById('adminLicenciasLicenseSplitRoot');
        if (ls && typeof ls.scrollIntoView === 'function') {
            ls.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

/** Abre el panel Cambios como vista única (mismo comportamiento que Reportes). */
function openAdminLicenciasCambiosPanelUi(opts) {
    const skipScroll = opts && opts.skipScroll === true;
    const panel = document.getElementById('adminLicenciasCambiosPanel');
    closeAdminLicenciasReportesPanelUi();
    document.querySelectorAll('.license-card').forEach(function (c) {
        c.classList.remove('active');
    });
    if (panel) {
        panel.classList.remove('d-none');
        panel.setAttribute('aria-hidden', 'false');
    }
    syncAdminLicenciasCambiosToolbarBtnOpen(true);
    syncAdminHistorialShellMode();
    try {
        localStorage.setItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY, 'cambios');
    } catch (e) {}
    if (typeof refreshChangesProductsListing === 'function') {
        refreshChangesProductsListing();
    }
    if (!skipScroll && typeof scrollAdminLicenciasCambiosPanelIntoView === 'function') {
        scrollAdminLicenciasCambiosPanelIntoView();
    }
}

function scrollAdminLicenciasCambiosPanelIntoView() {
    window.requestAnimationFrame(function () {
        const panel = document.getElementById('adminLicenciasCambiosPanel');
        if (panel && !panel.classList.contains('d-none') && typeof panel.scrollIntoView === 'function') {
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
        const section = document.querySelector('.admin-licencias-bloc--changes-product');
        if (section && typeof section.scrollIntoView === 'function') {
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

function closeAdminLicenciasReportesPanelUi() {
    const panel = document.getElementById('adminLicenciasReportesPanel');
    const btn = document.getElementById('adminLicenciasReportesBtn');
    if (panel && !panel.classList.contains('d-none')) {
        panel.classList.add('d-none');
        panel.setAttribute('aria-hidden', 'true');
    }
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('admin-licencias-reportes-toggle--open');
        btn.classList.remove('active');
    }
    try {
        syncAdminHistorialShellMode();
    } catch (_repClose) {}
    window.__adminReportesSelectInteracting = false;
    window.__adminReportesRenderDeferred = false;
}

function adminLicenseReportesPanelIsOpen() {
    const panel = document.getElementById('adminLicenciasReportesPanel');
    return !!(panel && !panel.classList.contains('d-none'));
}

/** Carga la licencia del reporte sin cerrar el panel lateral Reportes. */
async function adminLicenseReportesEnsureLicenseActive(licenseId) {
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        return false;
    }
    const ic = document.getElementById('licenseAccountsInputContainer');
    const activeRaw = ic && ic.dataset.activeLicenseId;
    const active = activeRaw != null && activeRaw !== '' ? parseInt(activeRaw, 10) : NaN;
    if (active === licenseId) {
        return true;
    }
    const card = document.querySelector(
        '.license-card[data-license-id="' + String(licenseId) + '"]:not(.license-card--panel-toggle)'
    );
    if (!card) {
        return false;
    }
    await activateLicenseCard(card, licenseId, true, { preserveSidebar: true });
    return true;
}

/** Devuelve la clase .active a la tarjeta de producto guardada (no Reportes/Cambios). */
function restoreActiveProductLicenseCardFromStorage() {
    const sid = localStorage.getItem('selectedLicenseId');
    if (!sid) return;
    const c = document.querySelector('.license-card[data-license-id="' + sid + '"]');
    if (
        !c ||
        c.classList.contains('license-card--panel-toggle')
    ) {
        return;
    }
    document.querySelectorAll('.license-card').forEach(function (x) {
        x.classList.remove('active');
    });
    c.classList.add('active');
}

function adminLicenseEscapeReportesHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Filas con estado rojo (mismo criterio que el icono de reporte): Licencias + días. */
function adminLicenseCollectReportEntries() {
    const out = [];

    function credLineForRow(rowsWrap, ta, row) {
        if (!rowsWrap || !ta || !row) return '';
        const rows = rowsWrap.querySelectorAll('.license-split-editor__row');
        let idx = -1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] === row) {
                idx = i;
                break;
            }
        }
        if (idx < 0) return '';
        const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
        const credLines = licenseSplitCredLinesFromRaw(raw);
        return credLines[idx] != null ? String(credLines[idx]).trim() : '';
    }

    function addFromWrap(rowsWrap, ta, sourceLabel, licenseIdFixed, dayNum) {
        if (!rowsWrap || !ta) return;
        const rows = rowsWrap.querySelectorAll('.license-split-editor__row');
        const shells = rowsWrap.querySelectorAll('.license-split-editor__status-select-shell--report');
        shells.forEach(function (shell) {
            const row = shell.closest('.license-split-editor__row');
            if (!row) return;
            let idx = -1;
            for (let j = 0; j < rows.length; j++) {
                if (rows[j] === row) {
                    idx = j;
                    break;
                }
            }
            const cuenta = credLineForRow(rowsWrap, ta, row);
            const r = adminLicenseSplitReadRow(row);
            const selBad = row.querySelector('.license-split-editor__status-bad');
            let statusLabel = r.statusBad || '';
            if (selBad && selBad.selectedIndex >= 0) {
                statusLabel = String(selBad.options[selBad.selectedIndex].textContent || '').trim();
            }
            let licenseId = licenseIdFixed;
            if (licenseId == null) {
                const ic = document.getElementById('licenseAccountsInputContainer');
                const rawL = ic && ic.dataset.activeLicenseId;
                const n = rawL != null && rawL !== '' ? parseInt(rawL, 10) : NaN;
                licenseId = Number.isFinite(n) ? n : NaN;
            }
            out.push({
                sourceLabel: sourceLabel,
                cuenta: cuenta,
                user: String(r.user != null ? r.user : '').trim(),
                status: statusLabel,
                origin: dayNum != null ? 'day' : 'license',
                dayNum: dayNum != null ? dayNum : null,
                licenseId: licenseId,
                badRowIndex: idx
            });
        });
    }

    const licWrap = document.getElementById('adminLicenciasStructuredRows');
    const licTa = document.getElementById('adminLicenciasNotepadByLicense');
    addFromWrap(licWrap, licTa, 'Licencias', null, null);

    document.querySelectorAll('#licenseAllDaysContainer .day-license-split-rows').forEach(function (wrap) {
        const root = wrap.closest('.day-license-split-root');
        const dayRaw = root && root.dataset.day != null ? parseInt(root.dataset.day, 10) : NaN;
        const lidRaw = root && root.dataset.licenseId != null ? parseInt(root.dataset.licenseId, 10) : NaN;
        const ta = root ? dayLicenseSplitQueryCredsTa(root) : null;
        const dayNum = Number.isFinite(dayRaw) ? dayRaw : null;
        const lid = Number.isFinite(lidRaw) ? lidRaw : NaN;
        addFromWrap(wrap, ta, 'Día ' + (dayNum != null ? dayNum : '?'), lid, dayNum);
    });

    return out;
}

function adminLicenseMakeReportEntrySig(e) {
    return [
        e.licenseId,
        e.origin,
        e.dayNum != null ? e.dayNum : '',
        e.badRowIndex,
        String(e.cuenta || ''),
        String(e.user || '')
    ].join('\x1e');
}

function adminLicenseFindReportEntryBySig(sig) {
    const all = adminLicenseCollectReportEntries();
    for (let i = 0; i < all.length; i++) {
        if (adminLicenseMakeReportEntrySig(all[i]) === sig) {
            return all[i];
        }
    }
    return null;
}

function adminLicenseReportesUndoSelect(selEl, sigRaw) {
    if (selEl) {
        selEl.value = '';
    }
    if (sigRaw && window.__adminReportesMalaSelectionBySig) {
        delete window.__adminReportesMalaSelectionBySig[sigRaw];
    }
}

async function adminLicenseReportesApplyBuenaResolved(entry, selEl) {
    if (window.__adminReportesTableActionInFlight) {
        return;
    }
    if (!entry || entry.badRowIndex == null || entry.badRowIndex < 0) {
        showError('Fila no válida.');
        adminLicenseReportesUndoSelect(selEl, '');
        return;
    }
    const sigK = adminLicenseMakeReportEntrySig(entry);
    if (!Number.isFinite(entry.licenseId) || entry.licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto en el grid (no «Todos»).');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const ic = document.getElementById('licenseAccountsInputContainer');
    const activeRaw = ic && ic.dataset.activeLicenseId;
    const active = activeRaw != null && activeRaw !== '' ? parseInt(activeRaw, 10) : NaN;
    if (active !== entry.licenseId) {
        showError('Activa en el grid la misma licencia a la que pertenece este reporte.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }

    window.__adminReportesTableActionInFlight = true;
    if (selEl) {
        selEl.disabled = true;
    }
    try {
        let oldCred = '';
        const where =
            entry.origin === 'day' && entry.dayNum != null
                ? 'Licencias · Día ' + entry.dayNum
                : 'Licencias';

        if (entry.origin === 'license') {
            const licMergedStr = adminLicenseSplitGetMergedNotes();
            const lines = licMergedStr === '' ? [] : licMergedStr.split('\n');
            const bIdx = entry.badRowIndex;
            if (bIdx < 0 || bIdx >= lines.length) {
                showError('Índice de fila fuera de rango en Licencias.');
                adminLicenseReportesUndoSelect(selEl, sigK);
                return;
            }
            const rawLineLic = String(lines[bIdx] != null ? lines[bIdx] : '').trim();
            const p = parseAdminLicenseLineToSplitParts(rawLineLic);
            oldCred = String(p.cred || '').trim();
            const licWrapEl = document.getElementById('adminLicenciasStructuredRows');
            const licRows = licWrapEl ? licWrapEl.querySelectorAll('.license-split-editor__row') : [];
            const domRowLic = licRows[bIdx] || null;
            const prevLic = adminLicensePrevGoodPackForBuenaMark(p, rawLineLic, domRowLic);
            let newExtraLic = adminLicensePortalGreenEmbedInExtra(p.extra, prevLic.canon);
            newExtraLic = adminLicensePortalBadEmbedInExtra(newExtraLic, p._prevBadForBuena || p.statusBad);
            const newLine = buildAdminLicenseStorageLine(p.cred, p.user, 'ok', prevLic.pack, newExtraLic);
            const oldMerged = licMergedStr;
            lines[bIdx] = newLine;
            adminLicenseSplitApplyMergedText(lines.join('\n'));
            const saveRes =
                typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                    ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                    : { success: false };
            if (!saveRes || !saveRes.success) {
                adminLicenseSplitApplyMergedText(oldMerged);
                showError('No se pudo guardar el bloc Licencias.');
                adminLicenseReportesUndoSelect(selEl, sigK);
                return;
            }
        } else {
            const dayNum = entry.dayNum;
            if (!Number.isFinite(dayNum)) {
                showError('Día no válido.');
                adminLicenseReportesUndoSelect(selEl, sigK);
                return;
            }
            const container = document.getElementById('licenseAllDaysContainer');
            const dayRoot =
                container &&
                container.querySelector(
                    '.day-license-split-root[data-day="' +
                        dayNum +
                        '"][data-license-id="' +
                        entry.licenseId +
                        '"]'
                );
            if (!dayRoot) {
                showError('No se encontró el bloc del día ' + dayNum + '.');
                adminLicenseReportesUndoSelect(selEl, sigK);
                return;
            }
            const dayMergedStr = dayLicenseSplitGetMergedText(dayRoot);
            const dayLines = dayMergedStr === '' ? [] : dayMergedStr.split('\n');
            const bIdx = entry.badRowIndex;
            if (bIdx < 0 || bIdx >= dayLines.length) {
                showError('Índice de fila fuera de rango en el día ' + dayNum + '.');
                adminLicenseReportesUndoSelect(selEl, sigK);
                return;
            }
            const rawLineDay = String(dayLines[bIdx] != null ? dayLines[bIdx] : '').trim();
            const p = parseAdminLicenseLineToSplitParts(rawLineDay);
            oldCred = String(p.cred || '').trim();
            const dayRowsEl = dayLicenseSplitGetRowElements(dayRoot);
            const domRowDay = dayRowsEl[bIdx] || null;
            const prevDay = adminLicensePrevGoodPackForBuenaMark(p, rawLineDay, domRowDay);
            let newExtraDay = adminLicensePortalGreenEmbedInExtra(p.extra, prevDay.canon);
            newExtraDay = adminLicensePortalBadEmbedInExtra(newExtraDay, p._prevBadForBuena || p.statusBad);
            const newLine = buildAdminLicenseStorageLine(p.cred, p.user, 'ok', prevDay.pack, newExtraDay);
            const oldDay = dayMergedStr;
            dayLines[bIdx] = newLine;
            dayLicenseSplitApplyMergedText(dayRoot, dayLines.join('\n'));
            await syncDayNotepad(entry.licenseId, dayNum, dayLicenseSplitGetMergedText(dayRoot), {});
        }

        showSuccess('Fila marcada como buena y guardada.');
        if (window.__adminReportesMalaSelectionBySig) {
            delete window.__adminReportesMalaSelectionBySig[sigK];
        }
        if (typeof window.__adminReportesRenderIfVisible === 'function') {
            window.__adminReportesRenderIfVisible();
        }
        scheduleRefreshAdminLicenciasReportCounts();
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(entry.licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
    } catch (err) {
        console.error('adminLicenseReportesApplyBuenaResolved', err);
        showError('Error al marcar como buena.');
        adminLicenseReportesUndoSelect(selEl, sigK);
    } finally {
        window.__adminReportesTableActionInFlight = false;
        if (selEl) {
            selEl.disabled = false;
        }
    }
}

/**
 * Reporte con origen bloc Licencias y «caida»: quita la fila de Licencias y la añade a Caídas (sin repuesto).
 */
async function adminLicenseReportesMoveLicenseRowToSuspended(entry, selEl) {
    if (window.__adminReportesTableActionInFlight) {
        return;
    }
    if (!entry || entry.badRowIndex == null || entry.badRowIndex < 0) {
        showError('Fila no válida.');
        adminLicenseReportesUndoSelect(selEl, '');
        return;
    }
    if (entry.origin !== 'license') {
        showError('El envío a Caídas desde reportes aplica solo al bloc Licencias.');
        adminLicenseReportesUndoSelect(selEl, adminLicenseMakeReportEntrySig(entry));
        return;
    }
    const sigK = adminLicenseMakeReportEntrySig(entry);
    if (!Number.isFinite(entry.licenseId) || entry.licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto en el grid (no «Todos»).');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const ic = document.getElementById('licenseAccountsInputContainer');
    const activeRaw = ic && ic.dataset.activeLicenseId;
    const active = activeRaw != null && activeRaw !== '' ? parseInt(activeRaw, 10) : NaN;
    if (active !== entry.licenseId) {
        showError('Activa en el grid la misma licencia a la que pertenece este reporte.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const taLic = document.getElementById('adminLicenciasNotepadByLicense');
    if (!taLic || parseInt(taLic.dataset.licenseId, 10) !== entry.licenseId) {
        showError('El bloc Licencias no coincide. Abre la licencia correcta.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const taS = document.getElementById('adminLicenciasSuspendedNotepad');
    const suspRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (!taS || !suspRoot || parseInt(taS.dataset.licenseId, 10) !== entry.licenseId) {
        showError('El bloc Caídas no está abierto para esta licencia.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }

    const licMergedStr = adminLicenseSplitGetMergedNotes();
    const licLines = licMergedStr === '' ? [] : licMergedStr.split('\n');
    const bIdx = entry.badRowIndex;
    if (bIdx < 0 || bIdx >= licLines.length) {
        showError('Índice de fila fuera de rango en Licencias.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const rawLine = String(licLines[bIdx] != null ? licLines[bIdx] : '').trim();
    const p = parseAdminLicenseLineToSplitParts(rawLine);
    if (!String(p.cred || '').trim()) {
        showError('La fila no tiene credencial.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const lineToMove = rawLine;

    const newLicLines = licLines.slice();
    newLicLines.splice(bIdx, 1);
    while (newLicLines.length && newLicLines[newLicLines.length - 1] === '') {
        newLicLines.pop();
    }
    const oldLicMerged = licMergedStr;
    const newLicMerged = newLicLines.join('\n');

    const oldSuspMerged = suspendedLicenseSplitGetMergedText(suspRoot);
    const suspLines = oldSuspMerged === '' ? [] : oldSuspMerged.split('\n');
    while (suspLines.length && suspLines[suspLines.length - 1] === '') {
        suspLines.pop();
    }
    suspLines.push(lineToMove);
    const newSuspMerged = suspLines.join('\n');

    window.__adminReportesTableActionInFlight = true;
    if (selEl) {
        selEl.disabled = true;
    }
    try {
        adminLicenseSplitApplyMergedText(newLicMerged);
        suspendedLicenseSplitApplyMergedText(suspRoot, newSuspMerged);
        const saveRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false };
        if (!saveRes || !saveRes.success) {
            adminLicenseSplitApplyMergedText(oldLicMerged);
            suspendedLicenseSplitApplyMergedText(suspRoot, oldSuspMerged);
            showError('No se pudo guardar Licencias / Caídas.');
            adminLicenseReportesUndoSelect(selEl, sigK);
            return;
        }

        showSuccess('Cuenta enviada a Caídas y guardada.');
        if (window.__adminReportesMalaSelectionBySig) {
            delete window.__adminReportesMalaSelectionBySig[sigK];
        }
        if (typeof window.__adminReportesRenderIfVisible === 'function') {
            window.__adminReportesRenderIfVisible();
        }
        scheduleRefreshAdminLicenciasReportCounts();
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(entry.licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateSuspendedBlocLineCountBadge === 'function') {
            window.updateSuspendedBlocLineCountBadge();
        }
        if (suspRoot && typeof suspRoot.scrollIntoView === 'function') {
            suspRoot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (err) {
        console.error('adminLicenseReportesMoveLicenseRowToSuspended', err);
        try {
            adminLicenseSplitApplyMergedText(oldLicMerged);
        } catch (e2) {
            console.error(e2);
        }
        try {
            suspendedLicenseSplitApplyMergedText(suspRoot, oldSuspMerged);
        } catch (e3) {
            console.error(e3);
        }
        showError('Error al enviar la cuenta a Caídas.');
        adminLicenseReportesUndoSelect(selEl, sigK);
    } finally {
        window.__adminReportesTableActionInFlight = false;
        if (selEl) {
            selEl.disabled = false;
        }
    }
}

/** Línea en Caídas: credencial sin estados verde/rojo; nota indica revisión OK. */
function licenseSplitBuildStorageLineBuenaRevisadaToSuspended(p) {
    const cred = String(p.cred != null ? p.cred : '').trim();
    const prevExtra = String(p.extra != null ? p.extra : '').trim();
    const tag = 'Buena y revisada — comprobada OK';
    const extra = [prevExtra, tag].filter(Boolean).join(' · ');
    return buildAdminLicenseStorageLine(cred, '', '', '', extra).trim();
}

/**
 * Desde columna verde «Buena y revisada»: quita la fila del bloc Licencias o del día y la añade a Caídas / suspendidas.
 */
async function licenseSplitBuenaRevisadaMoveRowToSuspended(row) {
    if (!row || window.__licenseSplitBuenaRevisadaMoveInFlight) {
        return;
    }
    function revertGoodSelectAfterAbort() {
        const sg = row.querySelector('.license-split-editor__status-good');
        if (!sg) return;
        const prev = sg.getAttribute('data-lic-sel-good-prev');
        sg.value = prev != null && prev !== '' ? prev : '';
        const wrap = sg.closest('.license-split-editor__status-wrap');
        const sb = wrap ? wrap.querySelector('.license-split-editor__status-bad') : null;
        const n = row.querySelector('.license-split-editor__note');
        adminLicenseSplitApplyGoodSelectTierClass(sg);
        adminLicenseSplitApplyNotePlaceholderFromDual(sb, n);
        const oc = row.querySelector('.license-split-editor__otro-combined');
        if (sb && oc) {
            adminLicenseSplitSyncOtroDetailVisibility(sb, oc);
        }
    }
    const mainWrap = document.getElementById('adminLicenciasStructuredRows');
    const dayRoot = row.closest('.day-license-split-root');
    const inMain = mainWrap && mainWrap.contains(row);

    if (!inMain && !dayRoot) {
        return;
    }

    const ic = document.getElementById('licenseAccountsInputContainer');
    const activeRaw = ic && ic.dataset.activeLicenseId;
    const active = activeRaw != null && activeRaw !== '' ? parseInt(activeRaw, 10) : NaN;
    if (!Number.isFinite(active) || active === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto en el grid (no «Todos») para usar Caídas / suspendidas.');
        revertGoodSelectAfterAbort();
        return;
    }

    const taLic = document.getElementById('adminLicenciasNotepadByLicense');
    const taS = document.getElementById('adminLicenciasSuspendedNotepad');
    const suspRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (!taLic || !taS || !suspRoot || parseInt(taLic.dataset.licenseId, 10) !== active) {
        showError('Abre el bloc Licencias y Caídas del mismo producto en la cuadrícula.');
        revertGoodSelectAfterAbort();
        return;
    }
    if (parseInt(taS.dataset.licenseId, 10) !== active) {
        showError('El bloc Caídas no coincide con la licencia activa.');
        revertGoodSelectAfterAbort();
        return;
    }

    let licenseIdForDay = active;
    let dayNum = null;
    let oldDayMerged = '';
    let newDayMerged = '';
    let oldLicMerged = '';
    let newLicMerged = '';

    const oldSuspMerged = suspendedLicenseSplitGetMergedText(suspRoot);
    const suspLines = oldSuspMerged === '' ? [] : oldSuspMerged.split('\n');
    while (suspLines.length && suspLines[suspLines.length - 1] === '') {
        suspLines.pop();
    }

    let lineToAppend = '';
    let credForMsg = '';

    if (inMain) {
        const rows = mainWrap.querySelectorAll('.license-split-editor__row');
        const idx = Array.prototype.indexOf.call(rows, row);
        if (idx < 0) {
            showError('No se encontró la fila en Licencias.');
            revertGoodSelectAfterAbort();
            return;
        }
        const licMergedStr = adminLicenseSplitGetMergedNotes();
        const licLines = licMergedStr === '' ? [] : licMergedStr.split('\n');
        if (idx < 0 || idx >= licLines.length) {
            showError('Índice de fila fuera de rango en Licencias.');
            revertGoodSelectAfterAbort();
            return;
        }
        const rawLine = String(licLines[idx] != null ? licLines[idx] : '').trim();
        const p = parseAdminLicenseLineToSplitParts(rawLine);
        if (!String(p.cred || '').trim()) {
            showError('La fila no tiene credencial.');
            revertGoodSelectAfterAbort();
            return;
        }
        credForMsg = String(p.cred || '').trim();
        lineToAppend = licenseSplitBuildStorageLineBuenaRevisadaToSuspended(p);
        if (!lineToAppend) {
            showError('No se pudo preparar la línea para Caídas.');
            revertGoodSelectAfterAbort();
            return;
        }
        const newLicLines = licLines.slice();
        newLicLines.splice(idx, 1);
        while (newLicLines.length && newLicLines[newLicLines.length - 1] === '') {
            newLicLines.pop();
        }
        oldLicMerged = licMergedStr;
        newLicMerged = newLicLines.join('\n');
    } else {
        licenseIdForDay = parseInt(dayRoot.dataset.licenseId, 10);
        dayNum = parseInt(dayRoot.dataset.day, 10);
        if (!Number.isFinite(licenseIdForDay) || licenseIdForDay === AGGREGATE_LICENSE_ID) {
            showError('En la vista «Todos» no se puede enviar filas a Caídas así. Abre un producto.');
            revertGoodSelectAfterAbort();
            return;
        }
        if (!Number.isFinite(dayNum)) {
            showError('Día no válido.');
            revertGoodSelectAfterAbort();
            return;
        }
        if (licenseIdForDay !== active) {
            showError('El día abierto no pertenece a la licencia activa en el grid.');
            revertGoodSelectAfterAbort();
            return;
        }
        const dayRows = dayLicenseSplitGetRowElements(dayRoot);
        const idx = dayRows.indexOf(row);
        if (idx < 0) {
            showError('No se encontró la fila en el día.');
            revertGoodSelectAfterAbort();
            return;
        }
        const dayMergedStr = dayLicenseSplitGetMergedText(dayRoot);
        const dayLines = dayMergedStr === '' ? [] : dayMergedStr.split('\n');
        if (idx < 0 || idx >= dayLines.length) {
            showError('Índice de fila fuera de rango en el día ' + dayNum + '.');
            revertGoodSelectAfterAbort();
            return;
        }
        const rawLine = String(dayLines[idx] != null ? dayLines[idx] : '').trim();
        const p = parseAdminLicenseLineToSplitParts(rawLine);
        if (!String(p.cred || '').trim()) {
            showError('La fila no tiene credencial.');
            revertGoodSelectAfterAbort();
            return;
        }
        credForMsg = String(p.cred || '').trim();
        lineToAppend = licenseSplitBuildStorageLineBuenaRevisadaToSuspended(p);
        if (!lineToAppend) {
            showError('No se pudo preparar la línea para Caídas.');
            revertGoodSelectAfterAbort();
            return;
        }
        const newDayLines = dayLines.slice();
        newDayLines.splice(idx, 1);
        while (newDayLines.length && newDayLines[newDayLines.length - 1] === '') {
            newDayLines.pop();
        }
        oldDayMerged = dayMergedStr;
        newDayMerged = newDayLines.join('\n');
    }

    suspLines.push(lineToAppend);
    const newSuspMerged = suspLines.join('\n');

    window.__licenseSplitBuenaRevisadaMoveInFlight = true;
    try {
        if (inMain) {
            adminLicenseSplitApplyMergedText(newLicMerged);
        } else {
            dayLicenseSplitApplyMergedText(dayRoot, newDayMerged);
        }
        suspendedLicenseSplitApplyMergedText(suspRoot, newSuspMerged);

        const saveRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false };
        if (!saveRes || !saveRes.success) {
            if (inMain) {
                adminLicenseSplitApplyMergedText(oldLicMerged);
            } else {
                dayLicenseSplitApplyMergedText(dayRoot, oldDayMerged);
            }
            suspendedLicenseSplitApplyMergedText(suspRoot, oldSuspMerged);
            showError('No se pudo guardar. Revisa la conexión.');
            return;
        }

        if (!inMain) {
            await syncDayNotepad(licenseIdForDay, dayNum, dayLicenseSplitGetMergedText(dayRoot), {});
        }

        showSuccess('Cuenta comprobada: enviada a Caídas / suspendidas.');
        scheduleRefreshAdminLicenciasReportCounts();
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(active);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateSuspendedBlocLineCountBadge === 'function') {
            window.updateSuspendedBlocLineCountBadge();
        }
        if (suspRoot && typeof suspRoot.scrollIntoView === 'function') {
            suspRoot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (err) {
        console.error('licenseSplitBuenaRevisadaMoveRowToSuspended', err);
        try {
            if (inMain) {
                adminLicenseSplitApplyMergedText(oldLicMerged);
            } else {
                dayLicenseSplitApplyMergedText(dayRoot, oldDayMerged);
            }
        } catch (e2) {
            console.error(e2);
        }
        try {
            suspendedLicenseSplitApplyMergedText(suspRoot, oldSuspMerged);
        } catch (e3) {
            console.error(e3);
        }
        showError('No se pudo completar el traslado a Caídas.');
    } finally {
        window.__licenseSplitBuenaRevisadaMoveInFlight = false;
    }
}

/** Credencial textual de la fila del día (emparejar cuenta en servidor). */
function adminLicenseResolveBadCredentialHintForDayReport(entry) {
    if (!entry || entry.origin !== 'day' || !Number.isFinite(entry.dayNum)) {
        return '';
    }
    if (!Number.isFinite(entry.licenseId) || entry.badRowIndex == null || entry.badRowIndex < 0) {
        return '';
    }
    const container = document.getElementById('licenseAllDaysContainer');
    const root =
        container &&
        container.querySelector(
            '.day-license-split-root[data-day="' +
                entry.dayNum +
                '"][data-license-id="' +
                entry.licenseId +
                '"]'
        );
    if (!root) {
        return String(entry.cuenta || '').trim();
    }
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta) {
        return String(entry.cuenta || '').trim();
    }
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const line = credLines[entry.badRowIndex];
    return line != null ? String(line).trim() : String(entry.cuenta || '').trim();
}

/** ID de cuenta vendida/asignada en ese día mismo producto — por correo de la credencial. */
function adminLicenseResolveBadAccountIdForDayReport(entry) {
    if (!entry || entry.origin !== 'day' || !Number.isFinite(entry.dayNum)) {
        return null;
    }
    if (!Number.isFinite(entry.licenseId) || entry.badRowIndex == null || entry.badRowIndex < 0) {
        return null;
    }
    const credHint = adminLicenseResolveBadCredentialHintForDayReport(entry);
    const p = parseAdminLicenseLineToSplitParts(String(credHint || '').trim() || String(entry.cuenta || ''));
    const nested = /\S+@\S+\.\S+/.exec(String(p.cred || '').trim());
    if (!nested) {
        return null;
    }
    const needle = normalizeAccountEmailKey(nested[0]);
    if (!needle) {
        return null;
    }
    const accs = getSoldAccountsForDayNumber(entry.licenseId, entry.dayNum);
    if (!accs || !accs.length) {
        return null;
    }
    for (let i = 0; i < accs.length; i++) {
        if (normalizeAccountEmailKey(accs[i].email) === needle) {
            const sid = accs[i].id;
            return sid != null && Number.isFinite(Number(sid)) ? Number(sid) : null;
        }
    }
    return null;
}

async function adminLicenseReportesApplyWarrantyReplace(entry, selEl) {
    if (window.__adminReportesTableActionInFlight) {
        return;
    }
    if (!entry || entry.badRowIndex == null || entry.badRowIndex < 0) {
        showError('Fila no válida.');
        adminLicenseReportesUndoSelect(selEl, '');
        return;
    }
    const sigK = adminLicenseMakeReportEntrySig(entry);
    if (!Number.isFinite(entry.licenseId) || entry.licenseId === AGGREGATE_LICENSE_ID) {
        showError(
            'Para usar la garantía desde inventario (gar.), selecciona un producto concreto en el grid (no «Todos»).'
        );
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    const ic = document.getElementById('licenseAccountsInputContainer');
    const activeRaw = ic && ic.dataset.activeLicenseId;
    const active = activeRaw != null && activeRaw !== '' ? parseInt(activeRaw, 10) : NaN;
    if (active !== entry.licenseId) {
        showError('Activa en el grid la misma licencia a la que pertenece este reporte.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }
    if (entry.origin !== 'day' || !Number.isFinite(entry.dayNum)) {
        showError('El reemplazo por garantía solo aplica a cuentas en un día.');
        adminLicenseReportesUndoSelect(selEl, sigK);
        return;
    }

    window.__adminReportesTableActionInFlight = true;
    if (selEl) {
        selEl.disabled = true;
    }
    try {
        const dayNum = entry.dayNum;
        const container = document.getElementById('licenseAllDaysContainer');
        const dayRoot =
            container &&
            container.querySelector(
                '.day-license-split-root[data-day="' +
                    dayNum +
                    '"][data-license-id="' +
                    entry.licenseId +
                    '"]'
            );
        if (!dayRoot) {
            showError('No se encontró el bloc del día ' + dayNum + '.');
            adminLicenseReportesUndoSelect(selEl, sigK);
            return;
        }
        const dayMergedStr = dayLicenseSplitGetMergedText(dayRoot);
        const dayLines = dayMergedStr === '' ? [] : dayMergedStr.split('\n');
        const bIdx = entry.badRowIndex;
        if (bIdx < 0 || bIdx >= dayLines.length) {
            showError('Índice de fila fuera de rango en el día ' + dayNum + '.');
            adminLicenseReportesUndoSelect(selEl, sigK);
            return;
        }
        const badP = parseAdminLicenseLineToSplitParts(dayLines[bIdx]);
        const oldCred = String(badP.cred || '').trim();
        const credHint = adminLicenseResolveBadCredentialHintForDayReport(entry) || oldCred;
        const badAccId = adminLicenseResolveBadAccountIdForDayReport(entry);

        const resp = await fetch(
            `/tienda/api/licenses/${entry.licenseId}/deliver-warranty-replacement`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
                },
                body: JSON.stringify({
                    bad_account_id: badAccId != null ? badAccId : null,
                    credential_hint: credHint
                }),
                credentials: 'same-origin'
            }
        );
        const data = await resp.json().catch(function () {
            return {};
        });
        if (!resp.ok || !data.success) {
            showError(data.error || 'No se pudo entregar la cuenta de garantía.');
            adminLicenseReportesUndoSelect(selEl, sigK);
            return;
        }

        const newCred =
            String(data.new_cred_plain != null ? data.new_cred_plain : '')
                .replace(/\r\n/g, ' ')
                .replace(/\n/g, ' ')
                .trim();
        const reporter = String(data.reporter_username != null ? data.reporter_username : '').trim() || 'anonimo';
        const prevFromBad = adminLicensePackPrevGoodBad(badP.statusGood || badP.prevGoodRestore);
        const replacedLine = buildAdminLicenseStorageLine(newCred, reporter, 'ok', prevFromBad, badP.extra);
        const newDayLines = dayLines.slice();
        newDayLines[bIdx] = replacedLine;
        const oldDayMerged = dayMergedStr;
        dayLicenseSplitApplyMergedText(dayRoot, newDayLines.join('\n'));

        const saveRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false };
        if (!saveRes || !saveRes.success) {
            dayLicenseSplitApplyMergedText(dayRoot, oldDayMerged);
            showError('No se pudo guardar tras el reemplazo. Recarga Licencias.');
            adminLicenseReportesUndoSelect(selEl, sigK);
            return;
        }
        await syncDayNotepad(entry.licenseId, dayNum, dayLicenseSplitGetMergedText(dayRoot), {});

        await loadLicenses();

        showSuccess('Cuenta sustituida desde la reserva gar. y guardada.');
        if (window.__adminReportesMalaSelectionBySig) {
            delete window.__adminReportesMalaSelectionBySig[sigK];
        }
        if (typeof window.__adminReportesRenderIfVisible === 'function') {
            window.__adminReportesRenderIfVisible();
        }
        scheduleRefreshAdminLicenciasReportCounts();
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(entry.licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
    } catch (err) {
        console.error('adminLicenseReportesApplyWarrantyReplace', err);
        showError('Error al aplicar el reemplazo por garantía.');
        adminLicenseReportesUndoSelect(selEl, sigK);
    } finally {
        window.__adminReportesTableActionInFlight = false;
        if (selEl) {
            selEl.disabled = false;
        }
    }
}

function setupAdminLicenciasReportes() {
    const panel = document.getElementById('adminLicenciasReportesPanel');
    const searchInp = document.getElementById('adminReportesSearch');
    const metaEl = document.getElementById('adminReportesMeta');
    const tableBody = document.getElementById('adminReportesTableBody');
    if (!panel || !searchInp || !metaEl || !tableBody) {
        return;
    }
    if (document.documentElement.dataset.adminReportesInit === '1') {
        return;
    }
    document.documentElement.dataset.adminReportesInit = '1';

    /** Por fila de reporte (firma): '' | 'buena' | 'caida' */
    const reportesMalaSelectionBySig = Object.create(null);
    window.__adminReportesMalaSelectionBySig = reportesMalaSelectionBySig;

    let searchDebounce = null;

    function syncReportesToggleButtonUi(open) {
        const btn = document.getElementById('adminLicenciasReportesBtn');
        if (!btn) return;
        if (open) {
            btn.setAttribute('aria-expanded', 'true');
            btn.classList.add('admin-licencias-reportes-toggle--open');
        } else {
            btn.setAttribute('aria-expanded', 'false');
            btn.classList.remove('admin-licencias-reportes-toggle--open');
        }
        syncAdminHistorialShellMode();
    }

    function getFilteredReportesRows() {
        const q = String(searchInp.value || '')
            .toLowerCase()
            .trim();
        const all = adminLicenseCollectReportEntries();
        if (!q) return all.slice();
        return all.filter(function (row) {
            const blob = [
                row.sourceLabel,
                row.cuenta,
                row.user,
                row.status
            ]
                .join(' ')
                .toLowerCase();
            return blob.indexOf(q) !== -1;
        });
    }

    function renderReportesPanel(force) {
        if (
            !force &&
            (window.__adminReportesSelectInteracting ||
                (document.activeElement &&
                    document.activeElement.classList &&
                    document.activeElement.classList.contains('admin-licencias-reportes-mala-select')))
        ) {
            window.__adminReportesRenderDeferred = true;
            return;
        }
        window.__adminReportesRenderDeferred = false;
        const qRaw = String(searchInp.value || '').trim();
        const filtered = getFilteredReportesRows();
        const total = filtered.length;
        if (total === 0) {
            metaEl.textContent = qRaw
                ? 'Sin coincidencias'
                : '0 cuentas con estado rojo en la vista actual (Licencias y días)';
        } else {
            metaEl.textContent =
                total + (total === 1 ? ' cuenta con estado rojo / reporte' : ' cuentas con estado rojo / reporte');
        }

        const ic = document.getElementById('licenseAccountsInputContainer');
        const activeRaw = ic && ic.dataset.activeLicenseId;
        const active = activeRaw != null && activeRaw !== '' ? parseInt(activeRaw, 10) : NaN;
        const reportesOpen = !panel.classList.contains('d-none');

        tableBody.innerHTML = '';
        if (filtered.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'admin-licencias-reportes-row admin-licencias-reportes-row--empty';
            tr.innerHTML =
                '<td class="admin-licencias-reportes-col-cuenta" colspan="4">No hay cuentas con estado rojo en Licencias ni en los días (vista actual). Al marcar un estado rojo en una fila, aparecerá aquí.</td>';
            tableBody.appendChild(tr);
        } else {
            filtered.forEach(function (row, rowIdx) {
                const tr = document.createElement('tr');
                tr.className = 'admin-licencias-reportes-row';
                const canAct =
                    Number.isFinite(row.licenseId) &&
                    row.licenseId !== AGGREGATE_LICENSE_ID &&
                    row.badRowIndex >= 0 &&
                    (reportesOpen || active === row.licenseId);
                const sigRaw = adminLicenseMakeReportEntrySig(row);
                const malaSel = reportesMalaSelectionBySig[sigRaw] || '';
                const sigEnc = encodeURIComponent(sigRaw);
                const selId = 'adminReportesMalaSel-' + rowIdx;
                tr.innerHTML =
                    '<td class="admin-licencias-reportes-col-cuenta"><code class="admin-licencias-reportes-cred">' +
                    adminLicenseEscapeReportesHtml(row.cuenta || '—') +
                    '</code></td>' +
                    '<td class="admin-licencias-reportes-col-user">' +
                    adminLicenseEscapeReportesHtml(row.user || '—') +
                    '</td>' +
                    '<td class="admin-licencias-reportes-col-status">' +
                    adminLicenseEscapeReportesHtml(row.status || '—') +
                    '</td>' +
                    '<td class="admin-licencias-reportes-col-action">' +
                    '<label class="sr-only" for="' +
                    selId +
                    '">Resolver reporte: buena o caida</label>' +
                    '<select id="' +
                    selId +
                    '" class="admin-licencias-reportes-mala-select" data-report-sig="' +
                    sigEnc +
                    '" aria-label="Resolver reporte: buena o caida"' +
                    (canAct ? '' : ' disabled') +
                    ' title="' +
                    adminLicenseEscapeReportesHtml(
                        canAct
                            ? 'buena: ok en el bloc; caida en Licencias → Caídas; caida en un día → repuesto desde colchón gar. (cuentas no vendibles).'
                            : 'Activa en el grid la licencia de esta fila (no «Todos»).'
                    ) +
                    '">' +
                    '<option value=""' +
                    (malaSel === '' ? ' selected' : '') +
                    '>--</option>' +
                    '<option value="buena"' +
                    (malaSel === 'buena' ? ' selected' : '') +
                    '>buena</option>' +
                    '<option value="caida"' +
                    (malaSel === 'caida' ? ' selected' : '') +
                    '>caida</option>' +
                    '</select>' +
                    '</td>';
                tableBody.appendChild(tr);
            });
        }
    }

    panel.addEventListener('mousedown', function (ev) {
        if (ev.target.closest('.admin-licencias-reportes-mala-select')) {
            ev.stopPropagation();
        }
    });
    panel.addEventListener('click', function (ev) {
        if (ev.target.closest('.admin-licencias-reportes-mala-select')) {
            ev.stopPropagation();
        }
    });

    tableBody.addEventListener(
        'mousedown',
        function (e) {
            if (e.target.closest('.admin-licencias-reportes-mala-select')) {
                e.stopPropagation();
                window.__adminReportesSelectInteracting = true;
            }
        },
        true
    );

    tableBody.addEventListener(
        'focusout',
        function (e) {
            const sel = e.target.closest && e.target.closest('.admin-licencias-reportes-mala-select');
            if (!sel) {
                return;
            }
            window.setTimeout(function () {
                const ae = document.activeElement;
                if (ae && ae.classList && ae.classList.contains('admin-licencias-reportes-mala-select')) {
                    return;
                }
                window.__adminReportesSelectInteracting = false;
                if (window.__adminReportesRenderDeferred) {
                    renderReportesPanel(true);
                }
            }, 0);
        },
        true
    );

    tableBody.addEventListener('change', function (e) {
        const sel = e.target.closest('.admin-licencias-reportes-mala-select');
        if (!sel || sel.disabled) {
            return;
        }
        const rawEnc = sel.getAttribute('data-report-sig');
        if (!rawEnc) {
            return;
        }
        let sig = '';
        try {
            sig = decodeURIComponent(rawEnc);
        } catch (decErr) {
            adminLicenseReportesUndoSelect(sel, '');
            showError('No se pudo leer la fila del reporte.');
            return;
        }
        const entry = adminLicenseFindReportEntryBySig(sig);
        if (!entry) {
            adminLicenseReportesUndoSelect(sel, sig);
            showError('El reporte cambió; actualiza el panel Reportes.');
            return;
        }
        const v = String(sel.value || '').trim();
        if (v === '') {
            delete reportesMalaSelectionBySig[sig];
            return;
        }
        reportesMalaSelectionBySig[sig] = v;
        void (async function () {
            const licReady = await adminLicenseReportesEnsureLicenseActive(entry.licenseId);
            if (!licReady) {
                adminLicenseReportesUndoSelect(sel, sig);
                showError('No se pudo cargar la licencia de esta fila. Elige el producto en el grid e inténtalo de nuevo.');
                return;
            }
            if (v === 'buena') {
                await adminLicenseReportesApplyBuenaResolved(entry, sel);
                return;
            }
            if (v === 'caida') {
                if (entry.origin === 'license') {
                    await adminLicenseReportesMoveLicenseRowToSuspended(entry, sel);
                } else {
                    await adminLicenseReportesApplyWarrantyReplace(entry, sel);
                }
                return;
            }
            delete reportesMalaSelectionBySig[sig];
        })();
    });

    window.__adminReportesOnButtonClick = function () {
        const isHidden = panel.classList.contains('d-none');
        const reportesBtn = document.getElementById('adminLicenciasReportesBtn');
        if (isHidden) {
            closeAdminLicenciasCambiosPanelUi();
            syncAdminHistorialShellMode();
            document.querySelectorAll('.license-card').forEach(function (c) {
                c.classList.remove('active');
            });
            if (reportesBtn) reportesBtn.classList.add('active');
            panel.classList.remove('d-none');
            panel.setAttribute('aria-hidden', 'false');
            syncReportesToggleButtonUi(true);
            try {
                localStorage.setItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY, 'reportes');
            } catch (e) {}
            renderReportesPanel();
        } else {
            panel.classList.add('d-none');
            panel.setAttribute('aria-hidden', 'true');
            syncReportesToggleButtonUi(false);
            if (reportesBtn) reportesBtn.classList.remove('active');
            try {
                localStorage.removeItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
            } catch (e) {}
            restoreActiveProductLicenseCardFromStorage();
        }
    };

    searchInp.addEventListener('input', function () {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(function () {
            if (!panel.classList.contains('d-none')) {
                renderReportesPanel();
            }
        }, 200);
    });

    window.__adminReportesRenderIfVisible = function () {
        if (!panel.classList.contains('d-none')) {
            renderReportesPanel();
        }
    };
}

/** Clic en Reportes: el botón se recrea en cada render del grid; el listener debe ir en el botón, no solo en delegación del grid. */
function wireAdminLicenciasReportesButton() {
    const btn = document.getElementById('adminLicenciasReportesBtn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.__adminReportesOnButtonClick === 'function') {
            window.__adminReportesOnButtonClick();
        }
    });
}

function setupEventListeners() {
    // Búsqueda
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput) {
        searchInput.addEventListener('input', filterLicenses);
    }
    
    // Botón de contraer/expandir
    setupCollapseButton();
    setupDuplicatesScanButton();
    setupMoveToChangesToolbarButton();
    setupAdminUserLabelSearchModal();
    setupAdminLicenciasReportes();
    setupAdminLicenseBulkEditUi();
    
    // Cerrar menús al hacer clic fuera
    document.addEventListener('click', function(event) {
        // Cerrar menús de licencias activas
        if (!event.target.closest('.license-action-btn') && !event.target.closest('.license-menu')) {
            document.querySelectorAll('.license-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
        
        // Cerrar menús de licencias archivadas
        if (!event.target.closest('.archived-license-action-btn') && !event.target.closest('.archived-license-menu')) {
            document.querySelectorAll('.archived-license-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
    
    // Reposicionar menús al redimensionar la ventana
    window.addEventListener('resize', function() {
        // Cerrar todos los menús al redimensionar
        document.querySelectorAll('.license-menu, .archived-license-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    });

    // Si hay búsqueda activa, actualizar resaltados al editar notas / licencias / días
    document.addEventListener('input', function (e) {
        if (!e.target.closest('#licenseAccountsInputContainer')) return;
        const si = document.getElementById('adminStoreSearch');
        if (si && si.value.trim()) {
            highlightMatchingEmails(si.value.toLowerCase().trim());
        }
    }, true);
}

// Cargar licencias desde el servidor
// options.skipGridRender: solo actualiza `licenses` en memoria (p. ej. tras guardar varios días al cambiar de producto).
async function loadLicenses(options) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), LICENSES_FETCH_TIMEOUT_MS);
    try {
        let endpoint = window.IS_ARCHIVED_MODE ? '/tienda/api/licenses/archived' : '/tienda/api/licenses';
        const sep = endpoint.indexOf('?') === -1 ? '?' : '&';
        endpoint += sep + '_t=' + Date.now();
        const response = await fetch(endpoint, { signal: ac.signal, cache: 'no-store' });
        
        if (response.redirected || response.status === 302) {
            showError('Debes estar autenticado como administrador para acceder a las licencias');
            return;
        }
        
        if (response.status === 401 || response.status === 403) {
            showError('No tienes permisos para acceder a las licencias');
            return;
        }
        
        if (response.status === 404) {
            showError('La ruta de licencias no fue encontrada. Verifica que el servidor esté funcionando correctamente.');
            return;
        }
        
        let data;
        try {
            data = await response.json();
        } catch (parseErr) {
            console.error('Respuesta no JSON en /api/licenses:', parseErr);
            showError('El servidor devolvió una respuesta inválida al cargar licencias (no JSON). ¿Sesión caducada?');
            return;
        }
        
        if (data.success) {
            licenses = data.licenses || [];
            invalidateLicenseNotesCredentialLineCache();

            const skipGrid = options && options.skipGridRender;
            if (!skipGrid) {
                const grid = document.getElementById('licensesGrid');
                if (grid && !grid.classList.contains('d-none')) {
                    const inputContainer = document.getElementById('licenseAccountsInputContainer');
                    const isEditing = inputContainer && inputContainer.contains(document.activeElement);
                    if (!isEditing) {
                        renderLicensesGrid();
                    }
                }
                if (
                    typeof window !== 'undefined' &&
                    window.LICENSE_SUPPORT_RESTRICTED &&
                    !window.__licenseSupportCambiosOpened
                ) {
                    window.__licenseSupportCambiosOpened = true;
                    window.requestAnimationFrame(function licenseSupportAfterGrid() {
                        try {
                            if (typeof openAdminLicenciasCambiosPanelUi === 'function') {
                                openAdminLicenciasCambiosPanelUi({ skipScroll: true });
                            }
                        } catch (_eLicSup) {}
                    });
                }
            }
            refreshExpandedDaysAndAccountsFromLatestLicenses();
        } else {
            console.error('Error al cargar licencias:', data.error);
            if (licenses.length !== 0) {
                showError('Error al cargar las licencias: ' + (data.error || 'Error desconocido'));
            }
        }
    } catch (error) {
        const msg =
            error && error.name === 'AbortError'
                ? 'La petición de licencias tardó demasiado (timeout). Revisa la red o el servidor.'
                : 'Error de conexión al cargar licencias: ' + (error && error.message ? error.message : 'desconocido');
        console.error('Error de red:', error);
        showError(msg);
    } finally {
        clearTimeout(t);
    }
}

// Renderizar el grid de licencias
function renderLicensesGrid() {
    const grid = document.getElementById('licensesGrid');
    if (!grid) return;

    // Antes de innerHTML se destruyen los textareas; persistir blocs para no perder datos ni guardar vacío tras re-pintar.
    try {
        if (window.AdminLicenciasNotepad && typeof window.AdminLicenciasNotepad.flushLicense === 'function') {
            window.AdminLicenciasNotepad.flushLicense();
        }
    } catch (flushGridErr) {
        console.error('Error al guardar notas antes de re-render del grid:', flushGridErr);
    }
    
    if (licenses.length === 0) {
        if (window.IS_ARCHIVED_MODE) {
            grid.innerHTML = `
                <div class="archived-empty-state text-center mt-5">
                    <i class="fas fa-archive fa-3x mb-3 text-muted"></i>
                    <h3 class="text-muted">No hay licencias archivadas</h3>
                    <p class="text-muted">Las licencias archivadas aparecerán aquí</p>
                </div>
            `;
        } else {
        grid.innerHTML = `
            <div class="licenses-loading-state">
                <i class="fas fa-spinner fa-spin licenses-loading-spinner"></i>
                <p>Inicializando licencias desde productos...</p>
            </div>
        `;
        }
        return;
    }
    
    let sortedArchivedLicenses = [];

    try {
    // Separar licencias activas y archivadas
    const activeLicenses = window.IS_ARCHIVED_MODE ? licenses : licenses.filter(license => license.enabled);
    const archivedLicenses = window.IS_ARCHIVED_MODE ? [] : licenses.filter(license => !license.enabled);

    // Ordenar por posición (sin tarjeta «Todos» en admin)
    const sortedActiveLicenses = [...activeLicenses].sort((a, b) => {
        if (a.isAggregate) return 1;
        if (b.isAggregate) return -1;
        return a.position - b.position;
    });
    sortedArchivedLicenses = [...archivedLicenses].sort((a, b) => a.position - b.position);
    
    let licensesHtml = '';
    
    if (sortedActiveLicenses.length > 0) {
        licensesHtml += sortedActiveLicenses
            .filter(function (license) {
                return !license.isAggregate;
            })
            .map(function (license) {
                return createLicenseCard(license);
            })
            .join('');
    }
    if (!window.IS_ARCHIVED_MODE) {
        licensesHtml += createReportesGridButtonHtml();
    }
    
    // Agregar el campo de entrada al final de todas las tarjetas
    licensesHtml += `
        <div class="license-accounts-input-container d-none" id="licenseAccountsInputContainer">
            <div class="license-notepads-wrap" id="licenseNotepadsWrap">
                <section class="admin-licencias-bloc admin-licencias-bloc--personal" id="adminLicenciasBlocPersonal" aria-label="Notas del producto">
                    <div class="admin-licencias-bloc-header">
                        <span class="admin-licencias-bloc-title"><i class="fas fa-book" aria-hidden="true"></i> Notas</span>
                        <div class="admin-licencias-bloc-header-actions">
                            <div class="admin-bloc-undo-toolbar admin-bloc-undo-toolbar--in-header" role="toolbar" aria-label="Deshacer y rehacer">
                                <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoPersonalUndo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><i class="fas fa-undo" aria-hidden="true"></i></button>
                                <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoPersonalRedo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><i class="fas fa-redo" aria-hidden="true"></i></button>
                            </div>
                            <span id="adminLicenciasPersonalLineBadge" class="day-account-badge admin-licencias-notepad-line-badge" hidden></span>
                        </div>
                    </div>
                    <div class="admin-licencias-personal-body">
                    <label for="adminLicenciasNotepadPersonal" class="sr-only">Notas de este producto (solo en este navegador).</label>
                    <textarea id="adminLicenciasNotepadPersonal" name="admin_lic_personal_notes" class="admin-licencias-notepad-textarea" rows="4" spellcheck="true" autocomplete="off" readonly placeholder="Apuntes solo para este producto… se guardan en este dispositivo (sin conexión)."></textarea>
                    </div>
                </section>
                <section class="admin-licencias-bloc admin-licencias-bloc--license" id="adminLicenciasBlocLicense" aria-label="Licencias del producto">
                    <div class="admin-licencias-bloc-header">
                        <span class="admin-licencias-bloc-title"><span id="adminLicenciasLicenciasHeading">Licencias</span></span>
                        <div class="admin-licencias-bloc-header-actions">
                            <button type="button" id="adminLicenciasBulkEditBtn" class="admin-lic-bulk-toolbar-btn" title="Editar varias filas a la vez (usuario, estados, notas, día de venta)" aria-label="Edición masiva de licencias seleccionadas">
                                Masivo
                            </button>
                            <div class="admin-licencias-show-limit-wrap">
                                <select id="adminLicenciasLicenseShowSelect" class="admin-licencias-show-limit-select" title="Cuántas filas visibles a la vez (credenciales y campos)" aria-label="Filas visibles en el listado de licencias">
                                    <option value="20">20</option>
                                    <option value="50">50</option>
                                    <option value="100">100</option>
                                    <option value="300">300</option>
                                    <option value="all" selected>Todos</option>
                                </select>
                                <button type="button" id="adminLicenciasToggleStatusColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar columnas Estado (verde y rojo)" aria-label="Ocultar columnas Estado verde y rojo de cada fila" aria-pressed="false">
                                    <i class="fas fa-eye-slash" aria-hidden="true"></i>
                                </button>
                                <button type="button" id="adminLicenciasToggleNotesColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar columna Notas" aria-label="Ocultar columna Notas de cada fila" aria-pressed="false">
                                    <i class="fas fa-eye-slash" aria-hidden="true"></i>
                                </button>
                            </div>
                            <div class="admin-bloc-undo-toolbar admin-bloc-undo-toolbar--in-header" role="toolbar" aria-label="Deshacer y rehacer">
                                <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoLicenseUndo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><i class="fas fa-undo" aria-hidden="true"></i></button>
                                <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoLicenseRedo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><i class="fas fa-redo" aria-hidden="true"></i></button>
                            </div>
                            <span id="adminLicenciasLicenseReportBadge" class="admin-licencias-report-header-badge" hidden role="status" aria-live="polite" aria-label="Sin reportes pendientes en Licencias">Reportes <span class="admin-licencias-report-header-badge__num">0</span></span>
                            <span id="adminLicenciasLicenseLineBadge" class="day-account-badge admin-licencias-notepad-line-badge" hidden></span>
                        </div>
                    </div>
                    <label id="adminLicenciasNotepadByLicenseLabel" class="sr-only" for="adminLicenciasNotepadByLicense">Licencias: credenciales a la izquierda (bloc de notas); usuario, estados verde y rojo, y notas a la derecha.</label>
                    <div class="license-split-editor license-notepad--locked" id="adminLicenciasLicenseSplitRoot" data-license-viz="all">
                        <div class="license-split-editor__viewport">
                        <div class="license-split-editor__grid">
                            <div class="license-split-editor__creds-cell">
                            <textarea id="adminLicenciasNotepadByLicense" name="admin_lic_license_creds" class="admin-licencias-notepad-textarea license-split-editor__creds" rows="1" spellcheck="true" wrap="off" autocomplete="off" readonly aria-labelledby="adminLicenciasNotepadByLicenseLabel" placeholder="Correo y contraseña (una licencia por línea, Enter = nueva línea)."></textarea>
                            </div>
                            <div class="license-split-editor__side" aria-label="Usuario, estados verde y rojo, y notas por línea">
                                <div id="adminLicenciasStructuredRows" class="license-split-editor__rows" role="region" aria-label="Usuario, estados verde y rojo, y notas por cada línea de licencia"></div>
                            </div>
                        </div>
                        </div>
                    </div>
                </section>
                <div id="adminLicenciasNotepadToast" class="admin-licencias-notepad-toast" role="status" aria-live="polite"></div>
                <div class="license-all-days-container d-none" id="licenseAllDaysContainer">
                    <!-- Días 1–31: mismo patrón visual que Licencias (admin-licencias-bloc) -->
                </div>
            </div>
            <div class="license-suspended-notepad-wrap">
                <div class="day-section suspended-section" id="licenseSuspendedSection" aria-label="Caídas y cuentas suspendidas">
                    <div class="day-section-header">
                        <div class="day-header-content day-header-content--with-actions">
                            <div class="day-header-label">
                                <i class="fas fa-exclamation-triangle day-icon" aria-hidden="true"></i>
                                <span class="day-number">Caídas / suspendidas</span>
                            </div>
                            <div class="day-header-actions">
                                <button type="button" id="adminLicenciasToggleSuspendedRestoreColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar flecha subir a Licencias" aria-label="Ocultar botón subir a Licencias en caídas" aria-pressed="false">
                                    <i class="fas fa-eye-slash" aria-hidden="true"></i>
                                </button>
                                <button type="button" id="adminLicenciasToggleSuspendedNotesColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar columna Notas" aria-label="Ocultar columna Notas en caídas" aria-pressed="false">
                                    <i class="fas fa-eye-slash" aria-hidden="true"></i>
                                </button>
                                <div class="admin-bloc-undo-toolbar admin-bloc-undo-toolbar--in-header" role="toolbar" aria-label="Deshacer y rehacer">
                                    <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoSuspendedUndo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><i class="fas fa-undo" aria-hidden="true"></i></button>
                                    <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoSuspendedRedo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><i class="fas fa-redo" aria-hidden="true"></i></button>
                                </div>
                                <span id="adminLicenciasSuspendedLineBadge" class="day-account-badge admin-licencias-notepad-line-badge" hidden></span>
                            </div>
                        </div>
                    </div>
                    <div class="day-accounts-list suspended-section-body">
                        <div class="license-notepads-wrap license-notepads-wrap--suspended-inner">
                            <label id="adminLicenciasSuspendedNotepadLabel" class="sr-only" for="adminLicenciasSuspendedNotepad">Caídas: credenciales a la izquierda; estado rojo, subir a Licencias y notas a la derecha.</label>
                            <div id="adminLicenciasSuspendedSplitRoot" class="license-split-editor license-split-editor--day suspended-license-split-root admin-licencias-license-editable license-notepad--locked" data-license-viz="all" tabindex="-1" role="region" aria-label="Caídas y suspendidas: credenciales a la izquierda; estado rojo, subir a Licencias y notas a la derecha.">
                                <div class="license-split-editor__viewport">
                                    <div class="license-split-editor__grid">
                                        <div class="license-split-editor__creds-cell">
                                            <textarea id="adminLicenciasSuspendedNotepad" name="admin_lic_suspended_notes" class="admin-licencias-notepad-textarea license-split-editor__creds suspended-license-split__creds" rows="1" spellcheck="true" wrap="off" autocomplete="off" readonly aria-labelledby="adminLicenciasSuspendedNotepadLabel" placeholder="Correo y contraseña (una por línea)."></textarea>
                                        </div>
                                        <div class="license-split-editor__side" aria-label="Estado rojo, subir a Licencias y notas (caídas)">
                                            <div id="adminLicenciasSuspendedRows" class="license-split-editor__rows suspended-license-split-rows" role="region" aria-label="Filas de caídas: estado rojo y notas"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="license-expired-notepad-wrap">
                <div class="day-section expired-section" id="licenseExpiredSection" aria-label="Cuentas vencidas o sin renovación mes a mes">
                    <div class="day-section-header">
                        <div class="day-header-content day-header-content--with-actions">
                            <div class="day-header-label">
                                <i class="fas fa-calendar-times day-icon" aria-hidden="true"></i>
                                <span class="day-number">Vencidas</span>
                            </div>
                            <div class="day-header-actions">
                                <button type="button" id="adminLicenciasToggleExpiredRestoreColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar flecha subir a Licencias" aria-label="Ocultar botón subir a Licencias en vencidas" aria-pressed="false">
                                    <i class="fas fa-eye-slash" aria-hidden="true"></i>
                                </button>
                                <button type="button" id="adminLicenciasToggleExpiredNotesColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar columna Notas" aria-label="Ocultar columna Notas en vencidas" aria-pressed="false">
                                    <i class="fas fa-eye-slash" aria-hidden="true"></i>
                                </button>
                                <div class="admin-bloc-undo-toolbar admin-bloc-undo-toolbar--in-header" role="toolbar" aria-label="Deshacer y rehacer (vencidas)">
                                    <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoExpiredUndo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><i class="fas fa-undo" aria-hidden="true"></i></button>
                                    <button type="button" class="admin-bloc-undo-btn" id="adminUndoRedoExpiredRedo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><i class="fas fa-redo" aria-hidden="true"></i></button>
                                </div>
                                <span id="adminLicenciasExpiredLineBadge" class="day-account-badge admin-licencias-notepad-line-badge" hidden></span>
                            </div>
                        </div>
                    </div>
                    <div class="day-accounts-list expired-section-body">
                        <div class="license-notepads-wrap license-notepads-wrap--expired-inner">
                            <label id="adminLicenciasExpiredNotepadLabel" class="sr-only" for="adminLicenciasExpiredNotepad">Vencidas: credenciales a la izquierda; estado rojo, subir a Licencias y notas a la derecha.</label>
                            <div id="adminLicenciasExpiredSplitRoot" class="license-split-editor license-split-editor--day expired-license-split-root admin-licencias-license-editable license-notepad--locked" data-license-viz="all" tabindex="-1" role="region" aria-label="Vencidas: credenciales a la izquierda; estado rojo, subir a Licencias y notas a la derecha.">
                                <div class="license-split-editor__viewport">
                                    <div class="license-split-editor__grid">
                                        <div class="license-split-editor__creds-cell">
                                            <textarea id="adminLicenciasExpiredNotepad" name="admin_lic_expired_notes" class="admin-licencias-notepad-textarea license-split-editor__creds expired-license-split__creds" rows="1" spellcheck="true" wrap="off" autocomplete="off" readonly aria-labelledby="adminLicenciasExpiredNotepadLabel" placeholder="Correo y contraseña (una por línea)."></textarea>
                                        </div>
                                        <div class="license-split-editor__side" aria-label="Estado rojo, subir a Licencias y notas (vencidas)">
                                            <div id="adminLicenciasExpiredRows" class="license-split-editor__rows expired-license-split-rows" role="region" aria-label="Filas de vencidas: estado rojo y notas"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    grid.innerHTML = licensesHtml;
    
    // Configurar el botón después de renderizar
    setupCollapseButton();
    
    // Agregar event listeners a las tarjetas
    addLicenseCardListeners();
    wireAdminLicenciasReportesButton();
    
    try {
    if (typeof window.initAdminLicenciasNotepad === 'function') {
        window.initAdminLicenciasNotepad();
    }
    } catch (notepadErr) {
        console.error('Error al inicializar bloc de notas (admin):', notepadErr);
    }

    try {
        if (typeof window.adminLicenseShowLimitSyncUi === 'function') {
            window.adminLicenseShowLimitSyncUi();
        }
    } catch (showLimErr) {
        console.error('adminLicenseShowLimitSyncUi:', showLimErr);
    }

    try {
        if (typeof window.adminLicenseHideNotesColSyncUi === 'function') {
            window.adminLicenseHideNotesColSyncUi();
        }
    } catch (hideNotesErr) {
        console.error('adminLicenseHideNotesColSyncUi:', hideNotesErr);
    }

    try {
        if (typeof window.adminSuspendedHideNotesColSyncUi === 'function') {
            window.adminSuspendedHideNotesColSyncUi();
        }
    } catch (suspHideNotesErr) {
        console.error('adminSuspendedHideNotesColSyncUi:', suspHideNotesErr);
    }

    try {
        if (typeof window.adminSuspendedHideRestoreColSyncUi === 'function') {
            window.adminSuspendedHideRestoreColSyncUi();
        }
    } catch (suspHideRestoreErr) {
        console.error('adminSuspendedHideRestoreColSyncUi:', suspHideRestoreErr);
    }

    try {
        if (typeof window.adminExpiredHideNotesColSyncUi === 'function') {
            window.adminExpiredHideNotesColSyncUi();
        }
    } catch (expHideNotesErr) {
        console.error('adminExpiredHideNotesColSyncUi:', expHideNotesErr);
    }

    try {
        if (typeof window.adminExpiredHideRestoreColSyncUi === 'function') {
            window.adminExpiredHideRestoreColSyncUi();
        }
    } catch (expHideRestoreErr) {
        console.error('adminExpiredHideRestoreColSyncUi:', expHideRestoreErr);
    }

    try {
        if (typeof window.adminLicenseHideStatusColSyncUi === 'function') {
            window.adminLicenseHideStatusColSyncUi();
        }
    } catch (hideStatusErr) {
        console.error('adminLicenseHideStatusColSyncUi:', hideStatusErr);
    }

    try {
    setupSuspendedSectionCollapse();
    } catch (suspErr) {
        console.error('setupSuspendedSectionCollapse:', suspErr);
    }

    try {
        setupExpiredSectionCollapse();
    } catch (expCollErr) {
        console.error('setupExpiredSectionCollapse:', expCollErr);
    }

    try {
        wireLicenseChangesProductsCollapseOnce();
    } catch (chCollErr) {
        console.error('wireLicenseChangesProductsCollapseOnce:', chCollErr);
    }

    try {
        wireLicenseChangesModeToolbarOnce();
    } catch (chModeErr) {
        console.error('wireLicenseChangesModeToolbarOnce:', chModeErr);
    }

    try {
        setupPersonalBlocCollapse();
    } catch (personalCollErr) {
        console.error('setupPersonalBlocCollapse:', personalCollErr);
    }

    try {
        restoreAdminLicenciasUiAfterGridRender();
    } catch (restoreErr) {
        console.error('restoreAdminLicenciasUiAfterGridRender:', restoreErr);
    }

    const reportesBtnAfterRender = document.getElementById('adminLicenciasReportesBtn');
    const reportesPanelAfterRender = document.getElementById('adminLicenciasReportesPanel');
    if (reportesBtnAfterRender && reportesPanelAfterRender) {
        if (!reportesPanelAfterRender.classList.contains('d-none')) {
            reportesBtnAfterRender.setAttribute('aria-expanded', 'true');
            reportesBtnAfterRender.classList.add('admin-licencias-reportes-toggle--open');
        } else {
            reportesBtnAfterRender.setAttribute('aria-expanded', 'false');
            reportesBtnAfterRender.classList.remove('admin-licencias-reportes-toggle--open');
        }
    }
    const cambiosPanelAfterRender = document.getElementById('adminLicenciasCambiosPanel');
    if (cambiosPanelAfterRender) {
        syncAdminLicenciasCambiosToolbarBtnOpen(!cambiosPanelAfterRender.classList.contains('d-none'));
    }
    syncAdminHistorialShellMode();
    scheduleRefreshAdminLicenciasReportCounts();

    updateArchivedCount(sortedArchivedLicenses.length);
    } catch (renderErr) {
        console.error('Error al renderizar grid de licencias:', renderErr);
        grid.innerHTML =
            '<div class="licenses-loading-state licenses-error-state" role="alert">' +
            '<p><strong>No se pudo mostrar las licencias.</strong> Revisa la consola (F12) o recarga la página.</p>' +
            '<p class="text-muted small">' +
            String(renderErr && renderErr.message ? renderErr.message : renderErr) +
            '</p>' +
            '<button type="button" class="btn-blue mt-2" id="licenciasGridRetryBtn">Recargar página</button>' +
            '</div>';
        const retry = document.getElementById('licenciasGridRetryBtn');
        if (retry) {
            retry.addEventListener('click', function () {
                window.location.reload();
            });
        }
    }
}

// Crear tarjeta de licencia
function createLicenseCard(license) {
    if (!license || license.id == null) {
        return '';
    }
    const productNameSafe = license.product_name != null ? String(license.product_name) : '';

    if (license.isAggregate) {
        return `
        <div class="license-card license-card--aggregate" data-license-id="${license.id}">
            <div class="license-card-header">
                <h3 class="license-name">
                    <span class="full-text">${productNameSafe}</span>
                    <span class="first-letter">T</span>
                </h3>
            </div>
        </div>`;
    }

    const firstLetter = productNameSafe ? productNameSafe.charAt(0).toUpperCase() : '?';
    
    return `
        <div class="license-card" data-license-id="${license.id}">
            <div class="license-card-header">
                <h3 class="license-name">
                    <span class="full-text">${productNameSafe}</span>
                    <span class="first-letter">${firstLetter}</span>
                </h3>
            </div>
        </div>
    `;
}

/** Botón Reportes en el grid de admin (lista puede estar vacía). */
function createReportesGridButtonHtml() {
    return `
        <button type="button"
            class="license-card license-card--aggregate license-card--panel-toggle admin-licencias-reportes-toggle"
            id="adminLicenciasReportesBtn"
            title="Reportes: ver cuentas con estado rojo"
            aria-expanded="false"
            aria-controls="adminLicenciasReportesPanel"
            aria-label="Reportes: ver cuentas con estado rojo">
            <div class="license-card-header">
                <h3 class="license-name">
                    <span class="full-text">Reportes<span id="adminLicenciasReportesTotalBadge" class="license-card-report-total-badge" hidden role="status" aria-live="polite" aria-label="Sin reportes pendientes"><span class="license-card-report-total-badge__num">0</span></span></span>
                    <span class="first-letter">R</span>
                </h3>
            </div>
        </button>`;
}

// Agregar event listeners a las tarjetas
function addLicenseCardListeners() {
    // Agregar evento de clic para seleccionar tarjetas
    const cards = document.querySelectorAll('.license-card');
    
    cards.forEach(card => {
        if (card.classList.contains('license-card--panel-toggle')) {
            return;
        }
        // Evitar que el clic en el botón de acción active la selección
        const actionBtn = card.querySelector('.license-action-btn');
        if (actionBtn) {
            actionBtn.addEventListener('click', function(e) {
                e.stopPropagation();
            });
        }
        
        // Hacer que el nombre de la licencia sea clickeable para activar directamente
        const licenseName = card.querySelector('.license-name');
        if (licenseName) {
            licenseName.style.cursor = 'pointer';
            licenseName.addEventListener('click', function(e) {
                e.stopPropagation();
                const licenseId = parseInt(card.dataset.licenseId);
                const isActive = card.classList.contains('active');
                if (!isActive) {
                    void activateLicenseCard(card, licenseId, true).catch(function (err) {
                        console.error('Error al activar licencia:', err);
                    });
                }
            });
        }
        
        // Agregar evento de clic a la tarjeta
        card.addEventListener('click', function(e) {
            // No hacer nada si se hace clic en el botón de acción
            if (e.target.closest('.license-action-btn')) {
                return;
            }
            
            const licenseId = parseInt(card.dataset.licenseId);
            const license = licenses.find(l => l.id === licenseId);
            const isActive = card.classList.contains('active');
            
            // Remover clase active de todas las tarjetas
            cards.forEach(c => c.classList.remove('active'));
            
            // Obtener el contenedor
            const inputContainer = document.getElementById('licenseAccountsInputContainer');
            
            // Si la tarjeta no estaba activa, activarla y mostrar las cuentas
            if (!isActive && license) {
                void activateLicenseCard(card, licenseId, true).catch(function (err) {
                    console.error('Error al activar licencia:', err);
                });
            } else {
                const prevRaw = inputContainer && inputContainer.dataset.activeLicenseId;
                const prevId = prevRaw != null && prevRaw !== '' ? parseInt(prevRaw, 10) : NaN;
                void (async function () {
                    try {
                        if (!Number.isNaN(prevId)) {
                            await flushDayNotepadsBeforeLicenseSwitch(prevId);
                        }
                    } catch (err) {
                        console.error('Error al guardar blocs del día:', err);
                    }
                    if (window.AdminLicenciasNotepad && typeof window.AdminLicenciasNotepad.flushLicense === 'function') {
                        window.AdminLicenciasNotepad.flushLicense();
                    }
                    adminDupHighlightDeactivate();
                    localStorage.removeItem('selectedLicenseId');
                    if (inputContainer) {
                        inputContainer.classList.add('d-none');
                    }
                })();
            }
        });
    });
    
    // La selección se maneja en restoreSelectedLicense()
}

/**
 * Vista «Todos»: solo Días 1–31 (licencias combinadas de productos visibles en el grid).
 * Sin notas personales, sin bloc Licencias y sin Caídas / suspendidas.
 */
function refreshExpiredNotepadWrapVisibilityForLicense(licenseId) {
    const wrap = document.querySelector('#licenseAccountsInputContainer .license-expired-notepad-wrap');
    if (!wrap) return;
    if (licenseId === AGGREGATE_LICENSE_ID) {
        wrap.classList.add('d-none');
        return;
    }
    const lic = licenses.find((l) => l.id === licenseId);
    const hideForMonthToMonth = lic && licenseMonthToMonthUiChecked(lic);
    wrap.classList.toggle('d-none', !!hideForMonthToMonth);
}

function refreshChangesNotepadWrapVisibilityForLicense(_licenseId) {
    if (_adminLicSkipNextChangesProductsRefreshOnce) {
        _adminLicSkipNextChangesProductsRefreshOnce = false;
        return;
    }
    if (typeof refreshChangesProductsListing === 'function') {
        refreshChangesProductsListing();
    }
}

function updateNotepadsVisibilityForLicense(licenseId) {
    const hideForAggregate = licenseId === AGGREGATE_LICENSE_ID;
    const personal = document.getElementById('adminLicenciasBlocPersonal');
    const licenseBloc = document.getElementById('adminLicenciasBlocLicense');
    const toast = document.getElementById('adminLicenciasNotepadToast');
    const suspendedWrap = document.querySelector(
        '#licenseAccountsInputContainer .license-suspended-notepad-wrap'
    );
    if (personal) personal.classList.toggle('d-none', hideForAggregate);
    if (licenseBloc) licenseBloc.classList.toggle('d-none', hideForAggregate);
    if (toast) toast.classList.toggle('d-none', hideForAggregate);
    if (suspendedWrap) suspendedWrap.classList.toggle('d-none', hideForAggregate);
    refreshExpiredNotepadWrapVisibilityForLicense(licenseId);
    refreshChangesNotepadWrapVisibilityForLicense(licenseId);
}

// Activar una tarjeta de licencia
// options.preserveSidebar: al restaurar UI tras re-render, mantener Historial/Reportes/Cambios abiertos y no borrar su modo en localStorage.
async function activateLicenseCard(card, licenseId, skipScroll = false, options) {
    if (licenseId === AGGREGATE_LICENSE_ID) {
        const fallbackId = getFirstRealLicenseId();
        if (fallbackId == null) return;
        const fc = document.querySelector(
            '.license-card[data-license-id="' + String(fallbackId) + '"]:not(.license-card--panel-toggle)'
        );
        if (!fc) return;
        return activateLicenseCard(fc, fallbackId, skipScroll, options);
    }
    const preserveSidebar = options && options.preserveSidebar === true;
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    let prevId = NaN;
    if (inputContainer && inputContainer.dataset.activeLicenseId != null && inputContainer.dataset.activeLicenseId !== '') {
        prevId = parseInt(inputContainer.dataset.activeLicenseId, 10);
    }
    if (!Number.isNaN(prevId) && prevId !== licenseId) {
        adminDupHighlightDeactivate();
    }
    /* Captura inmediata + guardado en segundo plano: antes se hacía await de hasta 31× sync + loadLicencias y el cambio de tarjeta se sentía lento. */
    if (inputContainer && !Number.isNaN(prevId) && prevId !== licenseId) {
        if (typeof window.adminLicenciasFlushPendingChangesNotesSaves === 'function') {
            window.adminLicenciasFlushPendingChangesNotesSaves();
        }
        const dayTextsSnapshot = captureDayTextsForLicense(prevId);
        void flushDayNotepadsForLicenseWithTexts(prevId, dayTextsSnapshot).catch(function (e) {
            console.error('Error al guardar blocs del día antes de cambiar de licencia:', e);
        });
    }

    if (!preserveSidebar) {
        closeAdminLicenciasReportesPanelUi();
        closeAdminLicenciasCambiosPanelUi();
        syncAdminHistorialShellMode();
        try {
            localStorage.removeItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
        } catch (e) {}
    }

    /* No quitar .active de Historial/Reportes/Cambios si el lateral debe seguir abierto (recarga con panel visible). */
    document.querySelectorAll('.license-card').forEach(function (c) {
        if (preserveSidebar && c.classList.contains('license-card--panel-toggle')) {
            return;
        }
        c.classList.remove('active');
    });
    
    // Activar la tarjeta seleccionada
    card.classList.add('active');
    
    // Guardar la tarjeta seleccionada
    localStorage.setItem('selectedLicenseId', licenseId.toString());
    
    if (inputContainer) {
        inputContainer.classList.remove('d-none');
        inputContainer.dataset.activeLicenseId = String(licenseId);
        try {
            __adminLicInjectedAssignedAccountIds.clear();
        } catch (_injClear) {}

        // Cargar y mostrar las cuentas guardadas (editables)
        loadAndDisplaySavedAccounts(licenseId);
        
        // Cargar y mostrar todos los días con sus correos vendidos
        _pendingLoadAllDaysLicenseId = null;
        loadAllDaysSoldAccounts(licenseId);
        
        if (window.AdminLicenciasNotepad && typeof window.AdminLicenciasNotepad.bindLicense === 'function') {
            const lic = licenses.find(function (l) { return l.id === licenseId; });
            const pname = lic && lic.product_name ? lic.product_name : '';
            window.AdminLicenciasNotepad.bindLicense(licenseId, pname, lic || null);
        }

        if (licenseId !== AGGREGATE_LICENSE_ID && typeof restorePersonalBlocState === 'function') {
            restorePersonalBlocState(licenseId);
        }

        updateNotepadsVisibilityForLicense(licenseId);

        refreshDuplicateEmailHighlights(licenseId);
        
        // Aplicar resaltado de búsqueda si hay un término activo
        const searchInput = document.getElementById('adminStoreSearch');
        if (searchInput && searchInput.value.trim()) {
            highlightMatchingEmails(searchInput.value.toLowerCase().trim());
        }
        
        // Solo hacer scroll si no se especifica skipScroll (cuando es un clic del usuario)
        if (!skipScroll) {
            // Hacer scroll suave hasta el contenedor (sin animación, solo scroll instantáneo)
            setTimeout(() => {
                inputContainer.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }, 100);
        }
    }
}

/** Tras pintar el grid: Reportes / Cambios tienen prioridad si el usuario los dejó abiertos; si no, primera licencia. */
function restoreAdminLicenciasUiAfterGridRender() {
    let mode = null;
    try {
        mode = localStorage.getItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
    } catch (e) {
        mode = null;
    }
    if (mode === 'historial') {
        try {
            localStorage.removeItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
        } catch (eHist) {}
        window.location.href = '/tienda/historial_compras#purchaseHistoryLicenciasSection';
        return;
    } else if (mode === 'reportes') {
        const repPanel = document.getElementById('adminLicenciasReportesPanel');
        const repBtn = document.getElementById('adminLicenciasReportesBtn');
        if (repPanel && repBtn) {
            closeAdminLicenciasCambiosPanelUi();
            document.querySelectorAll('.license-card').forEach(function (c) {
                if (c.classList.contains('license-card--panel-toggle')) {
                    return;
                }
                c.classList.remove('active');
            });
            repBtn.classList.add('active');
            repPanel.classList.remove('d-none');
            repPanel.setAttribute('aria-hidden', 'false');
            repBtn.setAttribute('aria-expanded', 'true');
            repBtn.classList.add('admin-licencias-reportes-toggle--open');
            syncAdminHistorialShellMode();
            if (typeof window.__adminReportesRenderIfVisible === 'function') {
                window.__adminReportesRenderIfVisible();
            }
            /* Sin una licencia cargada no hay filas en el DOM: contadores y tabla en 0 hasta abrir un producto. */
            restoreSelectedLicense({ preserveSidebar: true });
            return;
        }
        try {
            localStorage.removeItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
        } catch (e3) {}
    } else if (mode === 'cambios') {
        const camPanel = document.getElementById('adminLicenciasCambiosPanel');
        if (camPanel) {
            closeAdminLicenciasReportesPanelUi();
            document.querySelectorAll('.license-card').forEach(function (c) {
                if (c.classList.contains('license-card--panel-toggle')) {
                    return;
                }
                c.classList.remove('active');
            });
            syncAdminLicenciasCambiosToolbarBtnOpen(true);
            camPanel.classList.remove('d-none');
            camPanel.setAttribute('aria-hidden', 'false');
            syncAdminHistorialShellMode();
            if (typeof refreshChangesProductsListing === 'function') {
                refreshChangesProductsListing();
            }
            restoreSelectedLicense({ preserveSidebar: true });
            return;
        }
        try {
            localStorage.removeItem(ADMIN_LICENCIAS_SIDEBAR_MODE_KEY);
        } catch (e4) {}
    }
    restoreSelectedLicense();
}

// Restaurar la tarjeta seleccionada desde localStorage
// options.preserveSidebar: ver activateLicenseCard.
function restoreSelectedLicense(options) {
    const opts = options || {};
    const savedLicenseId = localStorage.getItem('selectedLicenseId');
    const cards = document.querySelectorAll('.license-card');
    const inputContainer = document.getElementById('licenseAccountsInputContainer');

    function isPanelToggleCard(el) {
        return el && el.classList && el.classList.contains('license-card--panel-toggle');
    }
    
    if (savedLicenseId && cards.length > 0) {
        const savedId = parseInt(savedLicenseId, 10);
        if (savedId === AGGREGATE_LICENSE_ID) {
            try {
                localStorage.removeItem('selectedLicenseId');
            } catch (eRm) {}
        } else {
            const savedCard = Array.from(cards).find(function (card) {
                if (isPanelToggleCard(card)) return false;
                return parseInt(card.dataset.licenseId, 10) === savedId;
            });

            if (savedCard) {
                cards.forEach(function (c) {
                    if (opts.preserveSidebar && isPanelToggleCard(c)) return;
                    c.classList.remove('active');
                });

                void activateLicenseCard(savedCard, savedId, true, opts).catch(function (err) {
                    console.error('Error al restaurar licencia:', err);
                });
                return;
            }
        }
    }
    
    const activeCard = document.querySelector('.license-card.active');
    if (!activeCard && cards.length > 0) {
        const productCards = Array.prototype.filter.call(cards, function (c) {
            return !isPanelToggleCard(c);
        });
        const firstCard = productCards[0];
        if (!firstCard) return;
        const firstLicenseId = parseInt(firstCard.dataset.licenseId, 10);
        const firstLicense = licenses.find(l => l.id === firstLicenseId);
        
        if (firstLicense) {
            productCards.forEach(function (c) {
                if (opts.preserveSidebar && isPanelToggleCard(c)) return;
                c.classList.remove('active');
            });
            void activateLicenseCard(firstCard, firstLicenseId, true, opts).catch(function (err) {
                console.error('Error al seleccionar primera licencia:', err);
            });
        }
    }
}

// Configurar el campo de entrada único
function setupLicenseInputField() {
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    const inputField = document.getElementById('licenseAccountsInput');
    
    if (!inputField) return;
    
    // Evitar que el clic en el contenedor del input active/desactive la tarjeta
    if (inputContainer) {
        inputContainer.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    let saveTimeout;
    
    inputField.addEventListener('input', function() {
        // Guardar automáticamente después de 2 segundos sin escribir
        clearTimeout(saveTimeout);
        const licenseId = parseInt(this.dataset.licenseId);
        const text = this.innerText || this.textContent || '';
        
        saveTimeout = setTimeout(() => {
            if (text.trim() && licenseId) {
                saveBulkAccounts(licenseId, text);
            }
        }, 2000);
    });
    
    // Guardar al presionar Ctrl+Enter o Cmd+Enter (Enter normal agrega nueva línea)
    inputField.addEventListener('keydown', function(e) {
        // Permitir Enter normal para agregar nuevas líneas
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            // No hacer preventDefault, dejar que el comportamiento normal funcione
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(saveTimeout);
            const licenseId = parseInt(this.dataset.licenseId);
            const text = this.innerText || this.textContent || '';
            if (text.trim() && licenseId) {
                saveBulkAccounts(licenseId, text);
            }
        }
    });
    
    // Manejar placeholder
    inputField.addEventListener('focus', function() {
        if (this.textContent.trim() === '' || this.textContent === this.dataset.placeholder) {
            this.textContent = '';
        }
    });
    
    inputField.addEventListener('blur', function() {
        if (this.textContent.trim() === '') {
            this.textContent = this.dataset.placeholder || '';
            this.classList.add('empty');
        } else {
            this.classList.remove('empty');
        }
    });
    
    // Inicializar placeholder
    if (!inputField.textContent.trim()) {
        inputField.textContent = inputField.dataset.placeholder || '';
        inputField.classList.add('empty');
    }
}

/** Evita saltos de scroll al reemplazar innerHTML en contenteditable (mismo problema no afecta a textarea).
 *  Guarda también el scroll del propio host si es scrollable (bloc Día / notepad), para no resetear la vista al soltar foco.
 *  Tras restaurar, ensureCaretVisibleInScrollableEditor corrige si el caret quedó fuera del área visible. */
function getScrollSnapshot(anchorEl) {
    const snap = { x: window.scrollX, y: window.scrollY, ancestors: [], editor: null };
    if (anchorEl && anchorEl.nodeType === 1) {
        const el = anchorEl;
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
            snap.editor = { el: el, top: el.scrollTop, left: el.scrollLeft };
        }
    }
    let node = anchorEl && anchorEl.parentElement;
    while (node && node !== document.documentElement) {
        if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
            snap.ancestors.push({ el: node, top: node.scrollTop, left: node.scrollLeft });
        }
        node = node.parentElement;
    }
    return snap;
}

function restoreScrollSnapshot(snap) {
    if (!snap) return;
    window.scrollTo(snap.x, snap.y);
    snap.ancestors.forEach(function (a) {
        if (a.el && a.el.isConnected) {
            a.el.scrollTop = a.top;
            a.el.scrollLeft = a.left;
        }
    });
    if (snap.editor && snap.editor.el && snap.editor.el.isConnected) {
        const el = snap.editor.el;
        el.scrollTop = snap.editor.top;
        el.scrollLeft = snap.editor.left;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
        el.scrollTop = Math.min(Math.max(0, el.scrollTop), maxTop);
        el.scrollLeft = Math.min(Math.max(0, el.scrollLeft), maxLeft);
    }
}

function ensureCaretVisibleInScrollableEditor(hostEl) {
    if (!hostEl || hostEl.nodeType !== 1) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!hostEl.contains(range.commonAncestorContainer)) return;
    const r = range.getBoundingClientRect();
    const h = hostEl.getBoundingClientRect();
    const pad = 6;
    if (r.bottom > h.bottom - pad) {
        hostEl.scrollTop += r.bottom - h.bottom + pad;
    } else if (r.top < h.top + pad) {
        hostEl.scrollTop += r.top - h.top - pad;
    }
    if (r.right > h.right - pad) {
        hostEl.scrollLeft += r.right - h.right + pad;
    } else if (r.left < h.left + pad) {
        hostEl.scrollLeft += r.left - h.left - pad;
    }
}

/** Longitud de texto plano hasta (endNode, endOffset) dentro del contenteditable. */
function measurePlainTextOffsetToPoint(root, endNode, endOffset) {
    let total = 0;
    function visit(node) {
        if (node === endNode) {
            if (node.nodeType === Node.TEXT_NODE) {
                total += Math.min(endOffset, (node.nodeValue || '').length);
                return true;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                for (let i = 0; i < endOffset; i++) {
                    const ch = node.childNodes[i];
                    if (ch && visit(ch)) return true;
                }
                return true;
            }
            return true;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            total += (node.nodeValue || '').length;
            return false;
        }
        if (node.nodeName === 'BR') {
            total += 1;
            return false;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            for (let i = 0; i < node.childNodes.length; i++) {
                const ch = node.childNodes[i];
                if (ch && visit(ch)) return true;
            }
        }
        return false;
    }
    visit(root);
    return total;
}

/** Offset del caret en texto plano (alineado con getNotepadText). */
function getCaretPlainTextOffset(element) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return 0;
    return measurePlainTextOffsetToPoint(element, range.endContainer, range.endOffset);
}

/**
 * Coloca el caret por offset de texto plano. Los <br> cuentan como 1 carácter (como \n en innerText).
 * Sin esto, tras reescribir innerHTML el cursor salta de línea al usar solo nodos de texto.
 */
/**
 * Cuando el texto normalizado cambia de longitud por línea, el offset plano del caret
 * debe reasignarse por línea/columna; si no, el cursor salta "hacia atrás" (p. ej. tras Enter).
 */
function mapCaretOffsetAfterNormalize(raw, next, off) {
    raw = raw !== null && raw !== undefined ? String(raw) : '';
    next = next !== null && next !== undefined ? String(next) : '';
    const o = Math.max(0, Math.min(off, raw.length));
    if (!raw.length) {
        return Math.min(o, next.length);
    }
    const rLines = raw.split('\n');
    const nLines = next.split('\n');
    if (rLines.length !== nLines.length) {
        const d = next.length - raw.length;
        return Math.max(0, Math.min(o + d, next.length));
    }
    function lineStartInNext(idx) {
        let p = 0;
        for (let j = 0; j < idx; j++) {
            p += (nLines[j] || '').length + 1;
        }
        return p;
    }
    let rPos = 0;
    for (let i = 0; i < rLines.length; i++) {
        const rl = rLines[i];
        const lineStart = rPos;
        const lineEnd = rPos + rl.length;
        if (o <= lineEnd) {
            const col = o - lineStart;
            const nl = nLines[i] || '';
            const mappedCol = Math.min(Math.max(0, col), nl.length);
            return Math.min(lineStartInNext(i) + mappedCol, next.length);
        }
        if (i < rLines.length - 1) {
            if (o === lineEnd + 1) {
                return Math.min(lineStartInNext(i + 1), next.length);
            }
            rPos = lineEnd + 1;
        }
    }
    return next.length;
}

function setCaretByPlainTextOffset(element, offset) {
    if (!element) return;
    const sel = window.getSelection();
    let remaining = Math.max(0, offset);
    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const len = node.textContent.length;
            if (remaining <= len) {
                const range = document.createRange();
                range.setStart(node, Math.max(0, Math.min(remaining, len)));
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                return true;
            }
            remaining -= len;
            return false;
        }
        if (node.nodeName === 'BR') {
            if (remaining === 0) {
                const range = document.createRange();
                range.setStartBefore(node);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                return true;
            }
            remaining -= 1;
            return false;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            for (let i = 0; i < node.childNodes.length; i++) {
                if (walk(node.childNodes[i])) return true;
            }
        }
        return false;
    }
    if (walk(element)) return;
    try {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (e) {}
}

/** Licencia activa para blocs día (no tienen data-license-id en el nodo). */
function resolveLicenseIdForNotepad(element) {
    if (element && element.dataset && element.dataset.licenseId != null && String(element.dataset.licenseId) !== '') {
        return element.dataset.licenseId;
    }
    const wrap = document.getElementById('licenseAccountsInputContainer');
    return wrap && wrap.dataset.activeLicenseId != null && String(wrap.dataset.activeLicenseId) !== ''
        ? wrap.dataset.activeLicenseId
        : null;
}

/**
 * Enter: nueva línea en el bloc Licencias / Caídas / Día.
 * insertText('\\n') suele fallar en contenteditable con spans; insertLineBreak / párrafo + fallback plano.
 */
function insertLicenseNotepadNewLineWithSeparator(element) {
    if (!element || element.tagName === 'TEXTAREA') return false;
    if (!element.isContentEditable) return false;
    const ids = ['adminLicenciasNotepadByLicense', 'adminLicenciasSuspendedNotepad'];
    const isDay = element.classList && element.classList.contains('day-day-notepad');
    if (ids.indexOf(element.id) === -1 && !isDay) return false;

    try {
        element.focus({ preventScroll: true });
    } catch (e) {
        try {
            element.focus();
        } catch (e2) {}
    }

    const before = getCaretPlainTextOffset(element);
    const plain = editablePlainTextForPipeNormalize(element);
    let inserted = false;

    if (document.queryCommandSupported && document.queryCommandSupported('insertLineBreak')) {
        try {
            inserted = document.execCommand('insertLineBreak', false, null);
        } catch (e) {
            inserted = false;
        }
    }
    if (!inserted && document.queryCommandSupported && document.queryCommandSupported('insertParagraph')) {
        try {
            inserted = document.execCommand('insertParagraph', false, null);
        } catch (e) {
            inserted = false;
        }
    }
    if (!inserted && document.queryCommandSupported && document.queryCommandSupported('insertText')) {
        try {
            inserted = document.execCommand('insertText', false, '\n');
        } catch (e) {
            inserted = false;
        }
    }

    let plainAfter = editablePlainTextForPipeNormalize(element);
    if (!inserted || plainAfter.length <= plain.length) {
        const after = plain.slice(0, before) + '\n' + plain.slice(before);
        element.textContent = after;
        plainAfter = after;
    }

    const afterInsert = before + 1;
    const licenseId = resolveLicenseIdForNotepad(element);
    if (licenseId != null && typeof window.normalizePipeSeparatorsInElement === 'function') {
        window.normalizePipeSeparatorsInElement(element, licenseId, { liveTyping: false, forceNormalize: true });
    } else {
        setCaretByPlainTextOffset(element, Math.min(afterInsert, plainAfter.length));
    }

    try {
        element.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}

    return true;
}

window.insertLicenseNotepadNewLineWithSeparator = insertLicenseNotepadNewLineWithSeparator;

/**
 * Bloc admin Licencias / Caídas / Día: quita spans de correo/clave al editar y deja texto plano con saltos.
 */
function flattenLicenseNotepadForEditing(element) {
    if (!element || element.tagName === 'TEXTAREA') return;
    const id = element.id;
    const isDayNotepad = element.classList && element.classList.contains('day-day-notepad');
    if (
        id !== 'adminLicenciasNotepadByLicense' &&
        id !== 'adminLicenciasSuspendedNotepad' &&
        !isDayNotepad
    ) {
        return;
    }
    const hadRichSpans = element.querySelector(
        'span.day-account-email, span.saved-account-email, span.day-account-credential-line, span.day-account-line-fallback, span.day-account-license-prefix, span.day-account-user-label, span.day-account-status-label'
    );
    if (!hadRichSpans) {
        return;
    }
    const off = getCaretPlainTextOffset(element);
    const plain = editablePlainTextForPipeNormalize(element);
    element.innerHTML = innerHtmlFromPlainWithSlashPills(plain);
    setCaretByPlainTextOffset(element, Math.min(off, plain.length));
}

window.flattenLicenseNotepadForEditing = flattenLicenseNotepadForEditing;

/** Texto plano solo en campos legacy (sin estilos por línea). */
function licenseNotepadUsesPlainTextOnly(element) {
    if (!element) return false;
    const id = element.id;
    if (id === 'licenseAccountsInput' || id === 'soldAccountsInput') return true;
    if (id === 'adminLicenciasNotepadByLicense' || id === 'adminLicenciasSuspendedNotepad') return true;
    return false;
}

function buildCredSpansFromParsed(parsed, useColon, emailClass, passwordClass, separatorClass) {
    if (parsed.netflixSlot != null) {
        return `<span class="${emailClass}">${escapeHtml(parsed.email)}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(parsed.password)}</span>`;
    }
    if (useColon) {
        return `<span class="${emailClass}">${escapeHtml(parsed.email)}</span><span class="${separatorClass}">:</span><span class="${passwordClass}">${escapeHtml(parsed.password)}</span>`;
    }
    return `<span class="${emailClass}">${escapeHtml(parsed.email)}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(parsed.password)}</span>`;
}

/** Licencias / días / caídas: fila a partir de línea persistida (separador unitario o legado //). */
function buildAdminLicenseLineHtml(
    line,
    isNetflix,
    emailClass,
    passwordClass,
    separatorClass,
    clientClass,
    statusClass,
    extraClass
) {
    const trimmed = line.trim();
    if (!trimmed) return '';
    const clientClassFinal = clientClass || 'day-account-user-label';
    const statusClassFinal = statusClass || 'day-account-status-label';
    const extraClassFinal = extraClass || 'day-account-notes-segment2';
    const clientTitleAttr = ' title="Cliente (doble clic para buscar usuario)"';
    const statusTitleAttr = ' title="Estado o fallo (caída o suspendida, no reproduce, otro-…)"';
    const extraTitleAttr = ' title="Notas adicionales (solo admin)"';

    const p = parseAdminLicenseLineToSplitParts(trimmed);
    const credPart = String(p.cred || '').trim();
    const clientDisplay = (p.user || '').trim() || 'anonimo';
    const g = String(p.statusGood || '').trim();
    let badShow = String(p.statusBad || '').trim();
    if (adminLicenseNormalizeStatusKey(badShow) === 'otro' && p.otroDetail) {
        badShow = 'otro-' + String(p.otroDetail).trim();
    }
    const statusParts = [];
    if (g) statusParts.push(g);
    if (badShow) statusParts.push(badShow);
    const statusDisplay = statusParts.join(' · ');
    const extraDisplay = adminLicenseUserNotesFromExtra(p.extra);

    const parsedCred = parseLineAccountFieldsBest(credPart, isNetflix);
    let credInner;
    if (parsedCred) {
        const useColon = /^[^\s:]+@[^\s:]+\.\S+:/.test(credPart);
        credInner = buildCredSpansFromParsed(parsedCred, useColon, emailClass, passwordClass, separatorClass);
    } else {
        credInner = `<span class="day-account-license-prefix">${escapeHtml(credPart)}</span>`;
    }
    const tierForCss =
        badShow && String(badShow).trim()
            ? adminLicenseStatusTierFromStored(badShow)
            : g
              ? adminLicenseStatusTierFromStored(g)
              : 'neutral';
    const statusTierCls = adminLicenseStatusCssTierClass(tierForCss);
        let out = `<span class="day-account-credential-line">${credInner}</span>`;
        out += `<span class="${clientClassFinal}"${clientTitleAttr}>${escapeHtml(clientDisplay)}</span>`;
    out += `<span class="${statusClassFinal} ${statusTierCls}"${statusTitleAttr}>${escapeHtml(statusDisplay)}</span>`;
    out += `<span class="${extraClassFinal}"${extraTitleAttr}>${escapeHtml(extraDisplay)}</span>`;
    return out;
}

/**
 * Evita que innerText en contenteditable con filas display:block cree un \\n final fantasma;
 * cada blur→highlight añadía una línea vacía (p. ej. al hacer clic en el título y quitar foco).
 */
function normalizeContentEditablePlainTextForParse(text) {
    if (text == null) return '';
    return String(text)
        .replace(/\r\n/g, '\n');
}

/** Texto del bloc a partir del DOM (separador de persistencia entre columnas). */
function getNotepadText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType === 1) {
        if (node.tagName === 'BR') return '\n';

        if (node.classList && node.classList.contains('admin-license-line-row')) {
            const cred = node.querySelector('.day-account-credential-line');
            const client = node.querySelector('.day-account-user-label, .saved-account-user-label');
            const status = node.querySelector('.day-account-status-label, .saved-account-status-label');
            const extra = node.querySelector('.day-account-notes-segment2, .saved-account-notes-segment2');
            
            let text = cred ? (cred.innerText || cred.textContent).trim() : '';
            const cText = client ? (client.innerText || client.textContent).trim() : '';
            const sText = status ? (status.innerText || status.textContent).trim() : '';
            const eText = extra ? (extra.innerText || extra.textContent).trim() : '';
            
            if (cText || sText || eText || text) {
                text = [text, cText || 'anonimo', sText, eText].join(LICENSE_LINE_FIELD_SEP);
            }
            
            if (node.nextSibling) {
                text += '\n';
            }
            return text;
        }

        const isBlock = node.tagName === 'DIV' || node.tagName === 'P';
        let text = '';
        for (let i = 0; i < node.childNodes.length; i++) {
            text += getNotepadText(node.childNodes[i]);
        }
        if (isBlock && node.nextSibling) {
            text += '\n';
        }
        return text;
    }
    return '';
}

function editablePlainTextForPipeNormalize(el) {
    if (!el) return '';
    if (el.classList && el.classList.contains('day-license-split-root') && typeof dayLicenseSplitGetMergedText === 'function') {
        return String(dayLicenseSplitGetMergedText(el) || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    }
    if (el.tagName === 'TEXTAREA') {
        return String(el.value != null ? el.value : '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    }
    const hasHtml = el.firstElementChild !== null;
    const t = hasHtml ? getNotepadText(el) : (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent || '');
    return String(t)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

// Resaltar correos/contraseñas (notas solo admin; duplicados ya no se marcan en amarillo)
function highlightEmailsAndPasswords(element) {
    if (!element) return;
    if (
        element.id === 'adminLicenciasSuspendedSplitRoot' ||
        element.id === 'adminLicenciasExpiredSplitRoot'
    ) {
        return;
    }
    if (licenseNotepadUsesPlainTextOnly(element)) {
        return;
    }
    
    const isEditing = document.activeElement === element;
    const scrollSnap = isEditing ? getScrollSnapshot(element) : null;

    const hasHtml = element.firstElementChild !== null;
    const rawText = hasHtml ? getNotepadText(element) : (element.innerText !== undefined ? element.innerText : element.textContent || '');
    if (!isEditing && rawText.length > MAX_HEAVY_NOTEPAD_CHARS) {
        // Guard de rendimiento: evita congelar el hilo principal con bloques enormes.
        return;
    }
    const text = normalizeContentEditablePlainTextForParse(rawText);
    if (text === '') {
        element.innerHTML = '';
        if (isEditing) restoreScrollSnapshot(scrollSnap);
        return;
    }

    const isDayNotepad =
        element.classList && element.classList.contains('day-day-notepad');
    const isDayItem = element.classList && element.classList.contains('day-account-item');
    const isAdminLicenseNotepad =
        element.classList.contains('admin-licencias-license-editable') ||
        element.classList.contains('admin-licencias-suspended-editable');
    /* Bloc Día N: mismo HTML que Licencias (buildAdminLicenseLineHtml); no depender solo de .day-account-item */
    const useDayStyling = isAdminLicenseNotepad || isDayNotepad || isDayItem;

    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    const activeLid = inputContainer && inputContainer.dataset.activeLicenseId
        ? parseInt(inputContainer.dataset.activeLicenseId, 10)
        : NaN;

    const emailClass = useDayStyling ? 'day-account-email' : 'saved-account-email';
    const passwordClass = useDayStyling ? 'day-account-password' : 'saved-account-password';
    const separatorClass = useDayStyling ? 'day-account-separator' : 'saved-account-separator';
    const clientClass = useDayStyling ? 'day-account-user-label' : 'saved-account-user-label';
    const statusClass = useDayStyling ? 'day-account-status-label' : 'saved-account-status-label';
    const legacyNotesClass = useDayStyling ? 'day-account-private-notes' : 'saved-account-private-notes';

    function wrapCredentialLine(innerHtml) {
        if (!useDayStyling) return innerHtml;
        return `<span class="day-account-credential-line">${innerHtml}</span>`;
    }

    const licenseForActive = !Number.isNaN(activeLid) ? licenses.find(l => l.id === activeLid) : null;
    const isNetflix = licenseForActive && isNetflixProductName(licenseForActive.product_name);

    const lines = text.split('\n');
    let html = '';
    let hasValidEmail = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            if (i < lines.length - 1) {
                html += '<br>';
            } else if (lines.length > 1) {
                html += '<br>';
            }
            continue;
        }

        if (useDayStyling) {
            const lineHtml = buildAdminLicenseLineHtml(
                line,
                isNetflix,
                emailClass,
                passwordClass,
                separatorClass,
                clientClass,
                statusClass
            );
            if (lineHtml) {
                /* Sin <br> entre filas: .admin-license-line-row es display:block y ya separa líneas; <br>+block duplicaba huecos */
                html += `<span class="admin-license-line-row">${lineHtml}</span>`;
                hasValidEmail = true;
            }
            continue;
        }

        const parsed = parseLineAccountFields(line, { isNetflix });
        if (parsed) {
            if (hasValidEmail) {
                html += '<br>';
            }
            const useColon = /^[^\s:]+@[^\s:]+\.\S+:/.test(line.trim());
            let cred;
            const emailCls = emailClass;
            if (parsed.netflixSlot != null) {
                cred = `<span class="${emailCls}">${escapeHtml(parsed.email)}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(parsed.password)}</span>`;
            } else if (useColon) {
                cred = `<span class="${emailCls}">${escapeHtml(parsed.email)}</span><span class="${separatorClass}">:</span><span class="${passwordClass}">${escapeHtml(parsed.password)}</span>`;
            } else {
                cred = `<span class="${emailCls}">${escapeHtml(parsed.email)}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(parsed.password)}</span>`;
            }
            let credHtml = cred;
            if (parsed.privateNotes) {
                credHtml += `<span class="${separatorClass}"> </span><span class="${legacyNotesClass}">${escapeHtml(parsed.privateNotes)}</span>`;
            }
            html += wrapCredentialLine(credHtml);
            hasValidEmail = true;
        } else {
            const emailMatch = line.match(/(\S+@\S+\.\S+)/);
            if (emailMatch) {
                const email = emailMatch[1].trim();
                const password = line.replace(email, '').trim().replace(/^[:;\s]+/, '');
                if (password) {
                    if (hasValidEmail) {
                        html += '<br>';
                    }
                    const emLow = email.toLowerCase();
                    const emailCls = emailClass;
                    const cred = `<span class="${emailCls}">${escapeHtml(emLow)}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(password)}</span>`;
                    html += wrapCredentialLine(cred);
                    hasValidEmail = true;
                } else {
                    html += escapeHtml(line);
                }
            } else {
                html += escapeHtml(line);
            }
        }
    }

    const cursorOffset = isEditing ? getCaretPlainTextOffset(element) : 0;
    element.innerHTML = html;
    
    // Optimization: avoid innerText reflow if we don't need to restore caret
    if (isEditing && cursorOffset > 0) {
        const plainAfter = editablePlainTextForPipeNormalize(element);
    const clamped = Math.min(cursorOffset, plainAfter.length);
    setCaretByPlainTextOffset(element, clamped);
    }

    if (isEditing) {
    restoreScrollSnapshot(scrollSnap);
    ensureCaretVisibleInScrollableEditor(element);
    }
}

window.highlightEmailsAndPasswords = highlightEmailsAndPasswords;

// Función auxiliar para escapar HTML
function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function adminLicWarrantyIncidentsAdminApiUrl() {
    const shell = document.querySelector('.admin-licencias-shell[data-admin-warranty-incidents-url]');
    if (shell && shell.getAttribute('data-admin-warranty-incidents-url')) {
        return String(shell.getAttribute('data-admin-warranty-incidents-url')).trim();
    }
    return '/tienda/api/admin/license-warranty-incidents';
}

function setupAdminLicWarrantyHistoryUi() {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.adminLicWarrantyUiInit === '1') return;
    if (!document.querySelector('.admin-licencias-shell:not(.user-licencias-shell)')) return;

    const modal = document.getElementById('adminLicWarrantyModal');
    const bodyEl = document.getElementById('adminLicWarrantyModalBody');
    if (!modal || !bodyEl) return;
    document.documentElement.dataset.adminLicWarrantyUiInit = '1';

    const closeBtn = document.getElementById('adminLicWarrantyModalClose');
    const backdrop = document.getElementById('adminLicWarrantyModalBackdrop');

    function closeModal() {
        modal.classList.add('d-none');
        modal.setAttribute('aria-hidden', 'true');
        bodyEl.innerHTML = '';
    }

    function fetchAndRenderFromButton(btn) {
        const lid = Number(btn.getAttribute('data-lic-row-license-id'));
        const dayNum = Number(btn.getAttribute('data-lic-row-day'));
        const ordinal = Number(btn.getAttribute('data-lic-row-ordinal'));
        if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(dayNum) || !Number.isFinite(ordinal)) {
            return;
        }
        const qs = new URLSearchParams();
        qs.set('license_id', String(lid));
        qs.set('calendar_day', String(dayNum));
        qs.set('row_ordinal', String(ordinal));
        const aidRaw = btn.getAttribute('data-lic-row-account-id');
        if (aidRaw != null && String(aidRaw).trim() !== '') {
            qs.set('account_id', String(aidRaw).trim());
        }
        const cw = btn.getAttribute('data-warranty-client-username');
        if (
            cw != null &&
            String(cw).trim() !== '' &&
            String(cw).trim().toLowerCase() !== 'anonimo'
        ) {
            qs.set('client_username', String(cw).trim());
        }

        bodyEl.innerHTML =
            '<p class="user-lic-warranty-modal__loading mb-0">Cargando historial…</p>';
        modal.classList.remove('d-none');
        modal.setAttribute('aria-hidden', 'false');

        const baseUrl = adminLicWarrantyIncidentsAdminApiUrl();
        fetch(baseUrl + '?' + qs.toString(), { credentials: 'same-origin' })
            .then(function (r) {
                return r.json().catch(function () {
                    return { success: false };
                });
            })
            .then(function (data) {
                if (!data || !data.success || !Array.isArray(data.incidents)) {
                    bodyEl.innerHTML =
                        '<p class="user-lic-warranty-modal__empty mb-0">No se pudo cargar el historial. Intenta de nuevo.</p>';
                    return;
                }
                if (!data.incidents.length) {
                    bodyEl.innerHTML =
                        '<p class="user-lic-warranty-modal__empty mb-0">Sin registros.</p>';
                    return;
                }
                let html = '<ul class="user-lic-warranty-modal__list list-unstyled mb-0">';
                data.incidents.forEach(function (it) {
                    const det = it.detail ? String(it.detail).trim() : '';
                    html +=
                        '<li class="user-lic-warranty-modal__item">' +
                        '<span class="user-lic-warranty-modal__date">' +
                        escapeHtml(it.fecha_col || '') +
                        '</span>' +
                        ' · <span class="user-lic-warranty-modal__tipo">' +
                        escapeHtml(it.tipo_label || '') +
                        '</span>' +
                        '<div class="user-lic-warranty-modal__summary">' +
                        escapeHtml(it.summary || '') +
                        '</div>';
                    if (det) {
                        html +=
                            '<div class="user-lic-warranty-modal__detail text-muted small">' +
                            escapeHtml(det) +
                            '</div>';
                    }
                    html += '</li>';
                });
                html += '</ul>';
                bodyEl.innerHTML = html;
            })
            .catch(function () {
                bodyEl.innerHTML =
                    '<p class="user-lic-warranty-modal__empty mb-0">Error de red al cargar el historial.</p>';
            });
    }

    document.addEventListener(
        'click',
        function (ev) {
            const btn = ev.target.closest && ev.target.closest('.admin-lic-admin-warranty-btn');
            if (!btn) return;
            const shellDoc = document.querySelector('.admin-licencias-shell:not(.user-licencias-shell)');
            if (!shellDoc || !shellDoc.contains(btn)) return;
            ev.preventDefault();
            fetchAndRenderFromButton(btn);
        },
        false
    );

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    if (backdrop) {
        backdrop.addEventListener('click', closeModal);
    }
    document.addEventListener(
        'keydown',
        function (ev) {
            if (ev.key !== 'Escape') return;
            if (modal.classList.contains('d-none')) return;
            closeModal();
        },
        false
    );
}

function teardownChangesProductUndoControllers() {
    if (!window.__changesProductUndoTeardowns) {
        window.__changesProductUndoTeardowns = [];
    }
    window.__changesProductUndoTeardowns.forEach(function (fn) {
        try {
            fn();
        } catch (e) {}
    });
    window.__changesProductUndoTeardowns = [];
}

function snapshotChangesNotesFromDomToLicensesCache() {
    const c = document.getElementById('licenseChangesProductsContainer');
    if (!c) return;
    c.querySelectorAll('.changes-license-split-root[data-license-id]').forEach(function (root) {
        const id = parseInt(root.dataset.licenseId, 10);
        if (!Number.isFinite(id)) return;
        const L = licenses.find((l) => l.id === id);
        if (L && typeof changesLicenseSplitGetMergedText === 'function') {
            L.changes_notes = changesLicenseSplitGetMergedText(root);
        }
    });
}

function getAdminLicenciasChangesListMode() {
    try {
        const v = localStorage.getItem(ADMIN_LICENCIAS_CHANGES_LIST_MODE_KEY);
        if (v === CHANGES_LIST_MODE_ALL) return CHANGES_LIST_MODE_ALL;
    } catch (e) {}
    return CHANGES_LIST_MODE_ONLY;
}

function setAdminLicenciasChangesListMode(mode) {
    const next = mode === CHANGES_LIST_MODE_ALL ? CHANGES_LIST_MODE_ALL : CHANGES_LIST_MODE_ONLY;
    if (getAdminLicenciasChangesListMode() === next) return;
    try {
        localStorage.setItem(ADMIN_LICENCIAS_CHANGES_LIST_MODE_KEY, next);
    } catch (e) {}
    if (typeof refreshChangesProductsListing === 'function') {
        refreshChangesProductsListing();
    }
}

/**
 * Productos en Cambios: solo los del grid de Licencias activas (no archivados).
 * En la página Archivados no debe listarse ningún producto en Cambios.
 */
function licenseBaseEligibleForChangesPanel(lic) {
    if (!lic || lic.isAggregate || lic.id === AGGREGATE_LICENSE_ID) return false;
    if (window.IS_ARCHIVED_MODE) return false;
    if (lic.enabled === false) return false;
    return true;
}

function adminLicenciasHasAnyLicenseForChangesPanel() {
    for (let i = 0; i < licenses.length; i++) {
        if (licenseBaseEligibleForChangesPanel(licenses[i])) return true;
    }
    return false;
}

function syncLicenseChangesModeToolbar() {
    const mode = getAdminLicenciasChangesListMode();
    const wrap = document.querySelector('#adminLicenciasCambiosPanel .license-changes-notepad-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.license-changes-mode-btn').forEach(function (btn) {
        const m = btn.getAttribute('data-changes-list-mode');
        const active = m === mode;
        btn.classList.toggle('license-changes-mode-btn--active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function wireLicenseChangesModeToolbarOnce() {
    const wrap = document.querySelector('#adminLicenciasCambiosPanel .license-changes-notepad-wrap');
    if (!wrap || wrap.dataset.changesModeToolbarBound === '1') return;
    wrap.dataset.changesModeToolbarBound = '1';
    wrap.addEventListener('click', function (e) {
        const b = e.target.closest && e.target.closest('.license-changes-mode-btn');
        if (!b || !wrap.contains(b)) return;
        e.preventDefault();
        const mode = b.getAttribute('data-changes-list-mode');
        if (mode === CHANGES_LIST_MODE_ALL || mode === CHANGES_LIST_MODE_ONLY) {
            setAdminLicenciasChangesListMode(mode);
        }
    });
}

function getLicensesForChangesProductsListing() {
    const mode = getAdminLicenciasChangesListMode();
    const base = licenses.filter(licenseBaseEligibleForChangesPanel);
    /* Mismo criterio que la cuadrícula de productos (#licensesGrid): position ascendente */
    const sorted = base.slice().sort(function (a, b) {
        const pa = typeof a.position === 'number' && !Number.isNaN(a.position) ? a.position : 0;
        const pb = typeof b.position === 'number' && !Number.isNaN(b.position) ? b.position : 0;
        if (pa !== pb) return pa - pb;
        return (a.id || 0) - (b.id || 0);
    });
    if (mode === CHANGES_LIST_MODE_ALL) return sorted;
    return sorted.filter(function (l) {
        return countNonEmptyLinesInText(l.changes_notes != null ? String(l.changes_notes) : '') >= 1;
    });
}

function changesProductSectionStorageKey(licenseId) {
    return 'admin_licencias_changes_product_section_collapsed_' + licenseId + '_v1';
}

function wireLicenseChangesProductsCollapseOnce() {
    const container = document.getElementById('licenseChangesProductsContainer');
    if (!container || container.dataset.collapseDelegated === '1') return;
    container.dataset.collapseDelegated = '1';
    container.addEventListener('click', function (e) {
        const header =
            e.target.closest && e.target.closest('.admin-licencias-bloc--changes-product .day-section-header');
        if (!header || !container.contains(header)) return;
        if (e.target.closest('.day-account-badge')) return;
        if (e.target.closest('.admin-bloc-undo-toolbar')) return;
        const section = header.closest('.admin-licencias-bloc--changes-product');
        if (!section) return;
        const body = section.querySelector('.changes-product-section-body');
        if (!body) return;
        section.classList.toggle('collapsed');
        const isCollapsed = section.classList.contains('collapsed');
        body.style.display = isCollapsed ? 'none' : 'block';
        const lid = section.dataset.changesProductLicenseId;
        if (!lid) return;
        try {
            localStorage.setItem(changesProductSectionStorageKey(lid), isCollapsed ? 'true' : 'false');
        } catch (err) {}
        try {
            if (typeof adminChangesSyncExpandAllToolbarBtn === 'function') {
                adminChangesSyncExpandAllToolbarBtn();
            }
        } catch (syncErr) {}
    });
}

function restoreChangesProductSectionsState() {
    document.querySelectorAll('.admin-licencias-bloc--changes-product').forEach(function (section) {
        const lid = section.dataset.changesProductLicenseId;
        if (!lid) return;
        const body = section.querySelector('.changes-product-section-body');
        if (!body) return;
        let saved = null;
        try {
            saved = localStorage.getItem(changesProductSectionStorageKey(lid));
        } catch (e) {}
        if (saved === 'true') {
            section.classList.add('collapsed');
            body.style.display = 'none';
        } else {
            section.classList.remove('collapsed');
            body.style.display = 'block';
        }
    });
}

/** Icono flecha junto al icono de Cambios: mismo criterio que «plegar / desplegar todos los días». */
function adminChangesSyncExpandAllToolbarBtn() {
    const btn = document.getElementById('adminLicenciasToggleAllChangesSectionsBtn');
    if (!btn) return;
    const sections = document.querySelectorAll('#licenseChangesProductsContainer .admin-licencias-bloc--changes-product');
    if (!sections.length) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    let anyExpanded = false;
    sections.forEach(function (section) {
        if (!section.classList.contains('collapsed')) {
            anyExpanded = true;
        }
    });
    const icon = btn.querySelector('i');
    if (anyExpanded) {
        if (icon) {
            icon.className = 'fas fa-chevron-up';
        }
        btn.title = 'Plegar todos los productos en Cambios';
        btn.setAttribute('aria-label', 'Plegar todas las secciones de Cambios');
        btn.setAttribute('aria-expanded', 'true');
    } else {
        if (icon) {
            icon.className = 'fas fa-chevron-down';
        }
        btn.title = 'Desplegar todos los productos en Cambios';
        btn.setAttribute('aria-label', 'Desplegar todas las secciones de Cambios');
        btn.setAttribute('aria-expanded', 'false');
    }
}

function adminChangesToggleAllProductSections() {
    const sections = document.querySelectorAll('#licenseChangesProductsContainer .admin-licencias-bloc--changes-product');
    if (!sections.length) return;
    let anyExpanded = false;
    sections.forEach(function (section) {
        if (!section.classList.contains('collapsed')) {
            anyExpanded = true;
        }
    });
    const collapseAll = anyExpanded;
    sections.forEach(function (section) {
        const body = section.querySelector('.changes-product-section-body');
        const lid = section.dataset.changesProductLicenseId;
        if (!body || !lid) return;
        if (collapseAll) {
            section.classList.add('collapsed');
            body.style.display = 'none';
            try {
                localStorage.setItem(changesProductSectionStorageKey(lid), 'true');
            } catch (e) {}
        } else {
            section.classList.remove('collapsed');
            body.style.display = 'block';
            try {
                localStorage.setItem(changesProductSectionStorageKey(lid), 'false');
            } catch (e) {}
        }
    });
    adminChangesSyncExpandAllToolbarBtn();
}

window.adminChangesSyncExpandAllToolbarBtn = adminChangesSyncExpandAllToolbarBtn;
window.adminChangesToggleAllProductSections = adminChangesToggleAllProductSections;

/** Un bloc «Cambios» por producto (mes a mes), mismo patrón de desbloqueo y guardado que los días. */
function setupEditableChangesProductRoots(list) {
    list.forEach(function (lic) {
        const licenseId = lic.id;
        const root = document.querySelector(
            '#licenseChangesProductsContainer .changes-license-split-root[data-license-id="' + licenseId + '"]'
        );
        if (!root) return;
        const ta = changesLicenseSplitQueryCredsTa(root);
        const rowsWrap = changesLicenseSplitQueryRowsWrap(root);
        if (!ta || !rowsWrap) return;

        const sectionEl = root.closest('.admin-licencias-bloc--changes-product');
        const undoBtn = sectionEl ? sectionEl.querySelector('.js-ch-product-undo[data-license-id="' + licenseId + '"]') : null;
        const redoBtn = sectionEl ? sectionEl.querySelector('.js-ch-product-redo[data-license-id="' + licenseId + '"]') : null;

        if (!window.__changesProductUndoTeardowns) {
            window.__changesProductUndoTeardowns = [];
        }
        if (window.AdminLicenciasUndoCore && typeof window.AdminLicenciasUndoCore.attach === 'function') {
            const ctrl = window.AdminLicenciasUndoCore.attach(root, {
                listenElement: root,
                useFocusOutDelegate: true,
                getPlainText: function () {
                    return changesLicenseSplitGetMergedText(root);
                },
                setPlainText: function (text) {
                    changesLicenseSplitApplyMergedText(root, text != null ? text : '');
                },
                undoBtn: undoBtn,
                redoBtn: redoBtn,
                onPersist: function () {
                    if (typeof window.adminLicenciasScheduleSaveChangesNotesOnly === 'function') {
                        window.adminLicenciasScheduleSaveChangesNotesOnly(licenseId);
                    }
                    if (typeof window.updateChangesBlocLineCountBadge === 'function') {
                        window.updateChangesBlocLineCountBadge();
                    }
                },
                afterVisual: function () {
                    if (typeof refreshDuplicateEmailHighlights === 'function') {
                        refreshDuplicateEmailHighlights(licenseId);
                    }
                    changesLicenseSplitScheduleAutosize(root);
                    if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
                        window.scheduleRefreshAdminDupIfActive();
                    }
                }
            });
            if (ctrl && typeof ctrl.destroy === 'function' && window.__changesProductUndoTeardowns) {
                window.__changesProductUndoTeardowns.push(function () {
                    ctrl.destroy();
                });
            }
        }

        root.addEventListener(
            'mousedown',
            function (e) {
                if (!root.classList.contains('license-notepad--locked')) return;
                if (e.target.closest && e.target.closest('.license-split-editor__user-suggestions')) return;
                const inCreds =
                    e.target === ta || (e.target.closest && e.target.closest('.license-split-editor__creds-cell'));
                const inSide = e.target.closest && e.target.closest('.license-split-editor__side');
                if (!inCreds && !inSide) return;
                e.preventDefault();
                changesLicenseSplitUnlock(root);
                if (e.target.closest && e.target.closest('.license-split-editor__restore-to-license-btn')) {
                    return;
                }
                let cell =
                    e.target.closest &&
                    e.target.closest(
                        '.license-split-editor__user, .license-split-editor__status-good, .license-split-editor__status-bad, .license-split-editor__otro-combined, .license-split-editor__note'
                    );
                if (!cell && e.target.closest) {
                    const uw = e.target.closest('.license-split-editor__user-wrap');
                    if (uw) cell = uw.querySelector('.license-split-editor__user');
                }
                if (!cell && e.target.closest) {
                    const row = e.target.closest('.license-split-editor__row');
                    if (row) cell = row.querySelector('.license-split-editor__user');
                }
                if (inSide && cell) {
                    e.preventDefault();
                    cell.focus();
                } else if (inSide) {
                    e.preventDefault();
                    ta.focus();
                } else if (inCreds) {
                    e.preventDefault();
                    ta.focus();
                }
            },
            true
        );

        ta.addEventListener(
            'beforeinput',
            function (e) {
                if (ta.readOnly) {
                    e.preventDefault();
                }
            },
            true
        );
        ta.addEventListener(
            'paste',
            function (e) {
                if (ta.readOnly) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            true
        );

        function onFieldInput() {
            changesLicenseSplitSyncRowsToTextarea(root);
            if (typeof window.adminLicenciasScheduleSaveChangesNotesOnly === 'function') {
                window.adminLicenciasScheduleSaveChangesNotesOnly(licenseId);
            }
            if (typeof window.updateChangesBlocLineCountBadge === 'function') {
                window.updateChangesBlocLineCountBadge();
            }
            if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
                window.scheduleRefreshAdminDupIfActive();
            }
        }

        ta.addEventListener('input', onFieldInput);
        rowsWrap.addEventListener('input', onFieldInput);
        rowsWrap.addEventListener('change', onFieldInput);

        rowsWrap.addEventListener('change', function onChangesGoodAutoRestoreToLicencias(ev) {
            const targ = ev.target;
            if (!targ || !targ.classList || !targ.classList.contains('license-split-editor__status-good')) return;
            if (changesLicenseSplitCanonicalGood(targ.value) !== 'terminado') return;
            const row = targ.closest('.license-split-editor__row');
            if (!row || !row.classList.contains('license-split-editor__row--changes')) return;
            if (typeof window.changesLicenseSplitResolveOutboundRow === 'function') {
                void window.changesLicenseSplitResolveOutboundRow(row);
            }
        });

        root.addEventListener('focusout', function () {
            window.setTimeout(function () {
                const a = document.activeElement;
                if (a && root.contains(a)) return;
                if (typeof window.adminLicenciasFlushPendingChangesNotesSaves === 'function') {
                    window.adminLicenciasFlushPendingChangesNotesSaves();
                }
                changesLicenseSplitLock(root);
                if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
                    window.scheduleRefreshAdminDupIfActive();
                }
            }, 0);
        });
    });
}

function refreshChangesProductsListing() {
    const wrap = document.querySelector('#adminLicenciasCambiosPanel .license-changes-notepad-wrap');
    const container = document.getElementById('licenseChangesProductsContainer');
    if (!wrap || !container) return;

    snapshotChangesNotesFromDomToLicensesCache();

    if (!adminLicenciasHasAnyLicenseForChangesPanel()) {
        teardownChangesProductUndoControllers();
        wrap.classList.add('d-none');
        container.innerHTML = '';
        if (typeof adminChangesSyncExpandAllToolbarBtn === 'function') {
            adminChangesSyncExpandAllToolbarBtn();
        }
        return;
    }

    wrap.classList.remove('d-none');
    syncLicenseChangesModeToolbar();

    const list = getLicensesForChangesProductsListing();
    if (list.length === 0) {
        teardownChangesProductUndoControllers();
        container.innerHTML =
            '<div class="license-changes-empty-hint" role="status">En <strong>Cambios vencidos</strong> no hay ningún producto con líneas en este bloc. Pulsa <strong>Todos los productos</strong> para listar todos los servicios y añadir cuentas manualmente, o usa el botón de la barra con una fila enfocada en Licencias.</div>';
        if (typeof adminChangesSyncExpandAllToolbarBtn === 'function') {
            adminChangesSyncExpandAllToolbarBtn();
        }
        if (typeof adminChangesHideStatusColSyncUi === 'function') {
            adminChangesHideStatusColSyncUi();
        }
        if (typeof adminChangesHideNotesColSyncUi === 'function') {
            adminChangesHideNotesColSyncUi();
        }
        if (typeof adminChangesHideRestoreColSyncUi === 'function') {
            adminChangesHideRestoreColSyncUi();
        }
        return;
    }

    teardownChangesProductUndoControllers();

    let html = '';
    list.forEach(function (lic) {
        const lid = lic.id;
        const pname = lic.product_name || 'Producto';
        const lineCount = countNonEmptyLinesInText(lic.changes_notes != null ? String(lic.changes_notes) : '');
        const badgeTitle = lineCount === 1 ? '1 línea' : lineCount + ' líneas';
        const escName = escapeHtml(pname);
        html +=
            '<section class="day-section admin-licencias-bloc admin-licencias-bloc--changes-product changes-section" data-changes-product-license-id="' +
            lid +
            '" aria-label="Cambios: ' +
            escName +
            '">' +
            '<div class="day-section-header admin-licencias-bloc-header">' +
            '<span class="admin-licencias-bloc-title"><i class="fas fa-exchange-alt" aria-hidden="true"></i> <span>' +
            escName +
            '</span></span>' +
            '<div class="admin-licencias-bloc-header-actions">' +
            '<div class="admin-bloc-undo-toolbar admin-bloc-undo-toolbar--in-header" role="toolbar" aria-label="Deshacer y rehacer (cambios)">' +
            '<button type="button" class="admin-bloc-undo-btn js-ch-product-undo" data-license-id="' +
            lid +
            '" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><i class="fas fa-undo" aria-hidden="true"></i></button>' +
            '<button type="button" class="admin-bloc-undo-btn js-ch-product-redo" data-license-id="' +
            lid +
            '" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><i class="fas fa-redo" aria-hidden="true"></i></button>' +
            '</div>' +
            (lineCount > 0
                ? '<span class="day-account-badge admin-licencias-notepad-line-badge js-changes-product-line-badge" title="' +
                  escapeHtml(badgeTitle) +
                  '">' +
                  lineCount +
                  '</span>'
                : '') +
            '</div></div>' +
            '<div class="day-accounts-list changes-product-section-body">' +
            '<div class="license-split-editor license-split-editor--day changes-license-split-root admin-licencias-license-editable license-notepad--locked" data-license-id="' +
            lid +
            '" data-license-viz="all" tabindex="-1" role="region" aria-label="Cambios mes a mes: ' +
            escName +
            '">' +
            '<div class="license-split-editor__viewport">' +
            '<div class="license-split-editor__grid">' +
            '<div class="license-split-editor__creds-cell">' +
            '<textarea id="adminLicChangesCreds-' +
            lid +
            '" name="admin_lic_changes_creds_' +
            lid +
            '" class="admin-licencias-notepad-textarea license-split-editor__creds changes-license-split__creds" rows="1" spellcheck="true" wrap="off" autocomplete="off" readonly aria-label="Credenciales en Cambios (' +
            escName +
            ')" placeholder="Correo y contraseña (una por línea)."></textarea>' +
            '</div>' +
            '<div class="license-split-editor__side" aria-label="Terminado, problemas y notas (cambios)">' +
            '<div class="license-split-editor__rows changes-license-split-rows" role="region" aria-label="Filas de cambios"></div>' +
            '</div></div></div></div></div></section>';
    });

    container.innerHTML = html;

    list.forEach(function (lic) {
        const root = container.querySelector('.changes-license-split-root[data-license-id="' + lic.id + '"]');
        if (!root) return;
        const text = lic.changes_notes != null ? String(lic.changes_notes) : '';
        changesLicenseSplitApplyMergedText(root, text);
        changesLicenseSplitLock(root);
        changesLicenseSplitWireScrollSync(root);
    });

    document.querySelectorAll('.admin-licencias-bloc--changes-product .day-section-header').forEach(function (h) {
        h.style.cursor = 'pointer';
    });

    restoreChangesProductSectionsState();
    setupEditableChangesProductRoots(list);

    if (typeof adminChangesSyncExpandAllToolbarBtn === 'function') {
        adminChangesSyncExpandAllToolbarBtn();
    }
    if (typeof adminChangesHideStatusColSyncUi === 'function') {
        adminChangesHideStatusColSyncUi();
    }
    if (typeof adminChangesHideNotesColSyncUi === 'function') {
        adminChangesHideNotesColSyncUi();
    }
    if (typeof adminChangesHideRestoreColSyncUi === 'function') {
        adminChangesHideRestoreColSyncUi();
    }
    if (typeof window.updateChangesBlocLineCountBadge === 'function') {
        window.updateChangesBlocLineCountBadge();
    }
    if (
        document.documentElement.dataset.adminLicDupHighlightActive === '1' &&
        typeof scheduleRefreshAdminDupIfActive === 'function'
    ) {
        scheduleRefreshAdminDupIfActive();
    }
}

window.refreshChangesProductsListing = refreshChangesProductsListing;

function innerHtmlFromPlainWithSlashPills(raw) {
    return String(raw)
        .split('\n')
        .map(function (ln) {
            return escapeHtml(ln);
        })
        .join('<br>');
}

// applySlashSeparatorPillsInEditable is no longer needed because we don't flatten HTML
function applySlashSeparatorPillsInEditable(el) {
    return;
}

window.applySlashSeparatorPillsInEditable = applySlashSeparatorPillsInEditable;

// Editar posición de licencia
function editLicensePosition(licenseId) {
    const license = licenses.find(l => l.id === licenseId);
    if (!license) return;
    
    currentLicenseId = licenseId;
    showPositionModal(license.position);
}

// Mostrar modal de posición
function showPositionModal(currentPosition) {
    const modal = document.createElement('div');
    modal.className = 'license-position-modal show';
    modal.innerHTML = `
        <div class="license-position-content">
            <h3>Editar Posición</h3>
            <form class="license-position-form" data-action="update-license-position" data-license-id="${licenseId}">
                <label for="newPosition">Nueva posición:</label>
                <input type="number" id="newPosition" value="${currentPosition}" min="1" required>
                <div class="license-position-buttons">
                    <button type="button" class="btn-panel btn-red" data-action="close-position-modal">Cancelar</button>
                    <button type="submit" class="btn-panel btn-green">Guardar</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Configurar event listeners para formulario y botones (CSP compliant)
    const form = modal.querySelector('.license-position-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const licenseId = parseInt(form.getAttribute('data-license-id'));
            currentLicenseId = licenseId;
            updateLicensePosition(e);
        });
    }
    
    const cancelBtn = modal.querySelector('[data-action="close-position-modal"]');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closePositionModal);
    }
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closePositionModal();
        }
    });
}

// Cerrar modal de posición
function closePositionModal() {
    const modal = document.querySelector('.license-position-modal');
    if (modal) {
        modal.remove();
    }
    currentLicenseId = null;
}

// Actualizar posición de licencia
async function updateLicensePosition(event) {
    event.preventDefault();
    
    const newPosition = parseInt(document.getElementById('newPosition').value);
    if (!currentLicenseId || !newPosition) return;
    
    try {
        const response = await fetch(`/tienda/api/licenses/${currentLicenseId}/position`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({ position: newPosition })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Actualizar la licencia local
            const license = licenses.find(l => l.id === currentLicenseId);
            if (license) {
                license.position = newPosition;
            }
            
            // Re-renderizar el grid
            renderLicensesGrid();
            closePositionModal();
            showSuccess('Posición actualizada correctamente');
        } else {
            showError(data.error || 'Error al actualizar posición');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al actualizar posición');
    }
}

// Toggle visibilidad de licencia
async function toggleLicenseVisibility(licenseId) {
    const license = licenses.find(l => l.id === licenseId);
    if (!license) return;
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            license.enabled = data.enabled;
            renderLicensesGrid();
            showSuccess(`Licencia ${data.enabled ? 'habilitada' : 'deshabilitada'} correctamente`);
        } else {
            showError(data.error || 'Error al cambiar visibilidad');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al cambiar visibilidad');
    }
}

// Agregar cuenta a licencia
function addAccountToLicense(licenseId) {
    // Implementar modal para agregar cuenta
    showAddAccountModal(licenseId);
}

// Mostrar modal para agregar cuenta
function showAddAccountModal(licenseId) {
    const modal = document.createElement('div');
    modal.className = 'license-position-modal show';
    modal.innerHTML = `
        <div class="license-position-content">
            <h3>Agregar Cuenta</h3>
            <form class="license-position-form" data-action="add-account" data-license-id="${licenseId}">
                <label for="accountIdentifier">Identificador de cuenta:</label>
                <input type="text" id="accountIdentifier" placeholder="Ej: disneyprem5+0k9" required>
                
                <label for="accountEmail">Email:</label>
                <input type="email" id="accountEmail" placeholder="Ej: disneyprem5+0k9@gmail.com" required>
                
                <label for="accountPassword">Contraseña:</label>
                <input type="text" id="accountPassword" placeholder="Ej: 3dw9k65tz" required>
                
                <div class="license-position-buttons">
                    <button type="button" class="btn-panel btn-red" data-action="close-add-account-modal">Cancelar</button>
                    <button type="submit" class="btn-panel btn-green">Agregar</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Configurar event listeners para formulario y botones (CSP compliant)
    const form = modal.querySelector('.license-position-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const licenseId = parseInt(form.getAttribute('data-license-id'));
            addAccount(e, licenseId);
        });
    }
    
    const cancelBtn = modal.querySelector('[data-action="close-add-account-modal"]');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeAddAccountModal);
    }
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeAddAccountModal();
        }
    });
}

// Cerrar modal de agregar cuenta
function closeAddAccountModal() {
    const modal = document.querySelector('.license-position-modal');
    if (modal) {
        modal.remove();
    }
}

// Agregar cuenta
async function addAccount(event, licenseId) {
    event.preventDefault();
    
    const identifier = document.getElementById('accountIdentifier').value;
    const email = document.getElementById('accountEmail').value;
    const password = document.getElementById('accountPassword').value;
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                account_identifier: identifier,
                email: email,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Recargar licencias para mostrar la nueva cuenta
            await loadLicenses();
            closeAddAccountModal();
            showSuccess('Cuenta agregada correctamente');
        } else {
            showError(data.error || 'Error al agregar cuenta');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al agregar cuenta');
    }
}

// Editar cuenta
function editAccount(accountId) {
    // Implementar edición de cuenta
}

// Asignar cuenta
function assignAccount(accountId) {
    // Implementar asignación de cuenta
}

// Eliminar cuenta
async function removeAccount(accountId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta cuenta?')) {
        return;
    }
    
    try {
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess('Cuenta eliminada correctamente');
        } else {
            showError(data.error || 'Error al eliminar cuenta');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al eliminar cuenta');
    }
}

/** Productos Netflix (1 / 2 / 4 pantallas): formato especial correo (n) contraseña */
function isNetflixProductName(productName) {
    if (!productName || typeof productName !== 'string') return false;
    return /netflix/i.test(productName.trim());
}

/** Primer // que no forma parte de :// (p. ej. https://) para formato legado cred//…//… */
function indexOfLegacyDoubleSlashSeparatorFrom(s, startPos) {
    const t = String(s || '');
    let pos = startPos || 0;
    while (pos < t.length) {
        const i = t.indexOf('//', pos);
        if (i === -1) return -1;
        if (i === 0 || t[i - 1] !== ':') return i;
        pos = i + 2;
    }
    return -1;
}

/**
 * Formato legado: separadores // entre cred, cliente, estado y notas.
 * Las líneas nuevas usan LICENSE_LINE_FIELD_SEP (\\x1f) y se parten en parseAdminLicenseLineToSplitParts.
 */
function splitLineCredNotesUser(line) {
    const t = String(line || '').trim();
    if (!t) return { cred: '', notes: '', user: '', extra: '' };
    const i1 = indexOfLegacyDoubleSlashSeparatorFrom(t, 0);
    if (i1 === -1) return { cred: t, notes: '', user: '', extra: '' };
    const cred = t.slice(0, i1).trim();
    const after1 = t.slice(i1 + 2);
    const i2 = indexOfLegacyDoubleSlashSeparatorFrom(after1, 0);
    if (i2 === -1) {
        return { cred, notes: after1.trim(), user: '', extra: '' };
    }
    const notes = after1.slice(0, i2).trim();
    const after2 = after1.slice(i2 + 2);
    const i3 = indexOfLegacyDoubleSlashSeparatorFrom(after2, 0);
    if (i3 === -1) {
        return { cred, notes, user: after2.trim(), extra: '' };
    }
    return {
        cred,
        notes,
        user: after2.slice(0, i3).trim(),
        extra: after2.slice(i3 + 2).trim()
    };
}

/**
 * Intenta extraer correo/contraseña de la parte credencial para resaltado (opcional).
 * Líneas con separador de persistencia o antiguas con //: solo se usa el primer campo como cred.
 */
function parseLineAccountFields(line, options) {
    if (!options) options = {};
    const isNetflix = !!options.isNetflix;

    line = (line || '').trim();
    if (!line) {
        return null;
    }

    let forcedNotes = null;
    let work = line;
    let clientFromSegments = '';
    let statusFromSegments = '';
    if (line.indexOf(LICENSE_LINE_FIELD_SEP) !== -1) {
        const seg = line.split(LICENSE_LINE_FIELD_SEP);
        work = (seg[0] || '').trim();
        clientFromSegments = (seg[1] || '').trim();
        statusFromSegments = (seg[2] || '').trim();
        forcedNotes = (seg[3] || '').trim() || null;
    } else if (indexOfLegacyDoubleSlashSeparatorFrom(line, 0) !== -1) {
        const sp = splitLineCredNotesUser(line);
        work = sp.cred;
        clientFromSegments = (sp.notes || '').trim();
        statusFromSegments = (sp.user || '').trim();
        forcedNotes = null;
    }

    let email = null;
    let password = null;
    let privateNotes = '';

    if (isNetflix) {
        const netflix = work.match(/^(\S+@\S+\.\S+)\s+\((\d+)\)\s+(\S+)(?:\s+(.*))?$/);
        if (netflix) {
            const base = netflix[1].trim().toLowerCase();
            const slot = netflix[2];
            password = netflix[3].trim();
            privateNotes = forcedNotes !== null ? forcedNotes : (netflix[4] || '').trim();
            email = `${base} (${slot})`;
            return {
                email: email,
                emailBase: base,
                password: password,
                identifier: base.split('@')[0],
                privateNotes: privateNotes,
                netflixSlot: parseInt(slot, 10),
                userLabel: clientFromSegments,
                statusLabel: statusFromSegments
            };
        }
    }

    const colon = work.match(/^([^\s:]+@[^\s:]+\.\S+):(\S+)(?:\s+(.*))?$/);
    if (colon) {
        email = colon[1].trim().toLowerCase();
        password = colon[2].trim();
        privateNotes = (colon[3] || '').trim();
    } else {
        const space = work.match(/^([^\s]+@[^\s]+\.\S+)\s+(\S+)(?:\s+(.*))?$/);
        if (space) {
            email = space[1].trim().toLowerCase();
            password = space[2].trim();
            privateNotes = (space[3] || '').trim();
        } else {
            const emailMatch = work.match(/(\S+@\S+\.\S+)/);
            if (emailMatch) {
                const em = emailMatch[1];
                email = em.trim().toLowerCase();
                let rest = work.slice(work.indexOf(em) + em.length).trim().replace(/^[:;\s]+/, '');
                const restMatch = rest.match(/^(\S+)(?:\s+(.*))?$/);
                if (restMatch) {
                    password = restMatch[1].trim();
                    privateNotes = (restMatch[2] || '').trim();
                } else {
                    password = rest;
                }
            }
        }
    }

    if (!email || !email.includes('@') || !email.includes('.')) {
        return null;
    }
    if (password == null) password = '';
    password = String(password).trim();

    if (forcedNotes !== null) {
        privateNotes = forcedNotes;
    }

    const hasSeg =
        indexOfLegacyDoubleSlashSeparatorFrom(line, 0) !== -1 ||
        line.indexOf(LICENSE_LINE_FIELD_SEP) !== -1;
    return {
        email: email,
        password: password,
        identifier: email.split('@')[0],
        privateNotes: privateNotes,
        userLabel: hasSeg ? clientFromSegments : '',
        statusLabel: hasSeg ? statusFromSegments : ''
    };
}

/** Prueba Netflix / no Netflix cuando la vista no define producto (p. ej. «Todos»). */
function parseLineAccountFieldsBest(line, isNetflix) {
    const order = isNetflix ? [true, false] : [false, true];
    for (let i = 0; i < order.length; i++) {
        const p = parseLineAccountFields(line, { isNetflix: order[i] });
        if (p) return p;
    }
    return null;
}

/** Vista «Todos»: sin producto fijo; prioriza formato Netflix (n) si aplica. */
function parseCredentialLineForAggregateMerge(line) {
    const t = String(line || '').trim();
    if (!t) return null;
    const parts = parseAdminLicenseLineToSplitParts(t);
    const credUse = String(parts.cred || '').trim() || t;
    const pN = parseLineAccountFields(credUse, { isNetflix: true });
    const pS = parseLineAccountFields(credUse, { isNetflix: false });
    if (pN && pN.netflixSlot != null) return pN;
    if (pS) return pS;
    return pN || pS;
}

function serializeCredentialLine(parsed, useColon) {
    if (parsed.netflixSlot != null && parsed.emailBase) {
        return `${parsed.emailBase} (${parsed.netflixSlot}) ${parsed.password}`.trim();
    }
    if (useColon) {
        return `${parsed.email}:${parsed.password}`;
    }
    return `${parsed.email} ${parsed.password}`;
}

/**
 * Quita (1) / (1d) entre correo y contraseña en productos que no son Netflix (restos tipo Disney u otros).
 */
function stripNonNetflixSlotInCredPart(credPart, isNetflix) {
    if (credPart == null) return credPart;
    if (isNetflix) return credPart;
    return String(credPart)
        .replace(/^(\S+@\S+\.\S+)\s+\((\d+[a-zA-Z]*)\)\s+(\S+)/, '$1 $3')
        .trim();
}

function stripNonNetflixSlotMarkersFromLineStart(line, isNetflix) {
    if (line == null) return line;
    if (isNetflix) return line;
    return String(line).replace(/^(\S+@\S+\.\S+)\s+\((\d+[a-zA-Z]*)\)\s+(\S+)/, '$1 $3');
}

/**
 * Normaliza una línea al formato LICENSE_LINE_FIELD_SEP (sin // legado).
 * El texto de la credencial no se parte por | ni por // salvo formato legado (// no precedido de :).
 */
function normalizeLineWithDoubleSlashSeparator(line, isNetflix, opts) {
    let t = String(line || '').trim();
    if (!t) return '';
    const parts = parseAdminLicenseLineToSplitParts(t);
    let c = String(parts.cred != null ? parts.cred : '').trim();
    c = stripNonNetflixSlotMarkersFromLineStart(c, isNetflix);
    c = stripNonNetflixSlotInCredPart(c, isNetflix);
    return buildAdminLicenseStorageLine(
        c,
        parts.user,
        parts.statusGood != null ? parts.statusGood : '',
        parts.statusBad != null ? parts.statusBad : '',
        parts.extra
    );
}

function normalizePipeSeparatorsInText(text, licenseId, opts) {
    const isNetflix = (() => {
        if (licenseId == null || licenseId === '') return false;
        const lic = licenses.find(l => String(l.id) === String(licenseId));
        return lic ? isNetflixProductName(lic.product_name) : false;
    })();
    return text
        .split(/\r?\n/)
        .map(function (ln) {
            return normalizeLineWithDoubleSlashSeparator(ln, isNetflix, opts);
        })
        .join('\n');
}

function normalizePipeSeparatorsInElement(el, licenseId, opts) {
    if (!el) return;
    if (el.classList && el.classList.contains('day-license-split-root')) {
        return;
    }
    if (el.classList && el.classList.contains('day-license-split__creds')) {
        return;
    }
    if (el.tagName === 'TEXTAREA') return;
    const lid = licenseId != null && licenseId !== '' ? Number(licenseId) : NaN;
    if (Number.isNaN(lid)) return;
    if (lid === 0 && !(el.classList && el.classList.contains('day-day-notepad'))) return;
    const raw = editablePlainTextForPipeNormalize(el);
    const next = normalizePipeSeparatorsInText(raw, lid, opts);
    const editing =
        document.activeElement === el &&
        (el.getAttribute('contenteditable') === 'true' || el.isContentEditable);

    // Durante escritura en vivo, no reescribir DOM para evitar salto de cursor y pérdida de caracteres.
    if (editing && opts && opts.liveTyping) {
        return;
    }

    if (next !== raw) {
        const off = getCaretPlainTextOffset(el);
        // En lugar de asignar textContent (que destruye el HTML y borra los cuadros),
        // llamamos a highlightEmailsAndPasswords para que reconstruya el HTML con el nuevo texto.
        el.textContent = next;
        if (typeof highlightEmailsAndPasswords === 'function') {
            highlightEmailsAndPasswords(el);
        }
        const newOff = mapCaretOffsetAfterNormalize(raw, next, off);
        setCaretByPlainTextOffset(el, newOff);
        return; // highlightEmailsAndPasswords ya hizo el trabajo
    }

    /* Sin foco: resaltado completo. Con foco: no tocar estructura para evitar que "desaparezcan cuadros". */
    if (!editing || (opts && opts.forceNormalize)) {
        if (typeof highlightEmailsAndPasswords === 'function') {
            highlightEmailsAndPasswords(el);
        }
    }
}

window.normalizePipeSeparatorsInElement = normalizePipeSeparatorsInElement;
window.normalizePipeSeparatorsInText = normalizePipeSeparatorsInText;

/** Clave estable para sincronizar cuentas del día (correo o identificador sin @). */
function accountDayInventorySyncKey(accOrParsed) {
    const em = normalizeAccountEmailKey(accOrParsed && accOrParsed.email);
    if (em) return 'e:' + em;
    const id = String(
        (accOrParsed && accOrParsed.account_identifier) ||
            (accOrParsed && accOrParsed.identifier) ||
            ''
    )
        .trim()
        .toLowerCase();
    if (id) return 'i:' + id;
    return '';
}

/**
 * Líneas del bloc «Día N» → cuentas inventario (admite credencial sin correo + usuario cliente).
 * Misma semántica que el inventario del servidor para líneas estructuradas.
 */
function parseDayNotepadLinesForSync(text, licenseId) {
    const license = licenseId != null ? licenses.find(l => l.id === licenseId) : null;
    const isNetflix = license && isNetflixProductName(license.product_name);
    const out = [];
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const trimmed = String(lines[i] || '').trim();
        if (!trimmed) continue;
        const dual = parseAdminLicenseLineToSplitParts(trimmed);
        const cred = String(dual.cred || '').trim();
        if (!cred) continue;
        let email = '';
        let password = '.';
        let identifier = '';
        const parsed = parseLineAccountFieldsBest(cred, isNetflix);
        if (parsed && parsed.email) {
            email = parsed.email;
            password = String(parsed.password != null ? parsed.password : '').trim() || '.';
            identifier = String(parsed.identifier || '').trim() || email.split('@')[0];
        } else {
            const hasSep =
                trimmed.indexOf(LICENSE_LINE_FIELD_SEP) !== -1 ||
                indexOfLegacyDoubleSlashSeparatorFrom(trimmed, 0) !== -1;
            const tokens = cred.split(/\s+/).filter(Boolean);
            if (!hasSep && tokens.length < 2 && cred.length < 2) continue;
            identifier = tokens[0] ? tokens[0].slice(0, 200) : cred.slice(0, 200);
            password =
                tokens.length >= 2
                    ? cred.slice(tokens[0].length).trim().slice(0, 500)
                    : cred.slice(0, 500);
            if (!password) password = '.';
            email = '';
        }
        const assignUsername = String(dual.user || '').trim();
        const row = {
            email: email,
            password: password,
            identifier: identifier,
            assignUsername: assignUsername,
        };
        row.syncKey = accountDayInventorySyncKey(row);
        if (!row.syncKey) continue;
        out.push(row);
    }
    return out;
}

async function apiMarkAccountSoldForDay(accountId, saleDate, assignUsername) {
    const body = { sold_date: saleDate.toISOString() };
    const u = String(assignUsername || '').trim();
    if (u) body.assign_username = u;
    await fetch(`/tienda/api/accounts/${accountId}/mark-sold`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
        },
        body: JSON.stringify(body),
    });
}

/** Alinea assigned_to_user_id con la columna cliente del día (anonimo → sin asignar en manual). */
async function apiSyncAccountAssigneeFromDayLine(accountId, assignUsername) {
    const u = String(assignUsername || '').trim();
    await fetch(`/tienda/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
        },
        body: JSON.stringify({ assign_username: u || 'anonimo' }),
    });
}

// Parsear texto para extraer correos y contraseñas (notas personales al final de línea se ignoran)
function parseAccountsText(text, licenseId) {
    const license = licenseId != null ? licenses.find(l => l.id === licenseId) : null;
    const isNetflix = license && isNetflixProductName(license.product_name);
    const accounts = [];
    const lines = text.split('\n');

    for (let line of lines) {
        const parsed = parseLineAccountFields(line, { isNetflix });
        if (parsed) {
            accounts.push({
                email: parsed.email,
                password: parsed.password,
                identifier: parsed.identifier
            });
        }
    }

    return accounts;
}

// Guardar cuentas masivamente
async function saveBulkAccounts(licenseId, text) {
    // Si el texto viene de un elemento HTML, extraer solo el texto plano
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return; // Guardar silenciosamente, no mostrar errores
    }
    
    const accounts = parseAccountsText(text, licenseId);
    
    if (accounts.length === 0) {
        return; // Guardar silenciosamente, no mostrar errores
    }
    
    // Obtener el día seleccionado desde el campo de entrada o usar el día actual
    const inputField = document.getElementById('licenseAccountsInput');
    const selectedDay = inputField && inputField.dataset.targetDay 
        ? parseInt(inputField.dataset.targetDay) 
        : new Date().getDate();
    
    // Crear la fecha con el día seleccionado
    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), selectedDay);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Guardar cada cuenta como vendida
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Primero crear la cuenta
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success && createData.account_id) {
                // Marcar como vendida con la fecha del día seleccionado
                try {
                    await fetch(`/tienda/api/accounts/${createData.account_id}/mark-sold`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({
                            sold_date: saleDate.toISOString()
                        })
                    });
                    successCount++;
                } catch (error) {
                    errorCount++;
                    console.error('Error al marcar como vendida:', error);
                }
            } else {
                errorCount++;
            }
        } catch (error) {
            errorCount++;
            console.error('Error:', error);
        }
    }
    
    // Guardar silenciosamente sin mostrar mensajes
    if (successCount > 0) {
        // Limpiar el campo de texto
        const inputField = document.getElementById('licenseAccountsInput');
        if (inputField) {
            inputField.textContent = '';
            inputField.innerHTML = '';
        }
        // Recargar licencias y actualizar las listas
        await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        loadAllDaysSoldAccounts(licenseId);
    }
}

/** Cuenta correos en cada línea del bloc Licencias (misma lógica que parseAccountsText). */
function collectEmailsFromLicenseNotesText(text, licenseId) {
    const license = licenseId != null ? licenses.find(l => l.id === licenseId) : null;
    const isNetflix = license && isNetflixProductName(license.product_name);
    const emails = [];
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const parsed = parseLineAccountFields(lines[i], { isNetflix });
        if (parsed && parsed.email) {
            emails.push(parsed.email.toLowerCase().trim());
        }
    }
    return emails;
}

function refreshDuplicateEmailHighlights(licenseId, options) {
    if (licenseId === null || licenseId === undefined || licenseId === '') return;
    const skipNotepad = options && options.skipNotepad;
    const skipSuspended = options && options.skipSuspended;

    if (!skipNotepad) {
        const np = document.getElementById('adminLicenciasNotepadByLicense');
        if (np && String(np.dataset.licenseId || '') === String(licenseId)) {
            highlightEmailsAndPasswords(np);
        }
    }
    if (!skipSuspended) {
        const sp = document.getElementById('adminLicenciasSuspendedNotepad');
        if (sp && String(sp.dataset.licenseId || '') === String(licenseId)) {
            highlightEmailsAndPasswords(sp);
        }
    }
}

window.refreshDuplicateEmailHighlights = refreshDuplicateEmailHighlights;

// Lista de cuentas “guardadas” retirada de la UI: solo Notas + Licencias + Días.
async function loadAndDisplaySavedAccounts(licenseId) {
    refreshDuplicateEmailHighlights(licenseId);
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput && searchInput.value.trim()) {
        highlightMatchingEmails(searchInput.value.toLowerCase().trim());
    }
}

// Guardar cuentas desde campo editable
async function saveBulkAccountsFromEditable(licenseId, text) {
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
    const accounts = parseAccountsText(text, licenseId);
    
    if (accounts.length === 0) {
        return;
    }
    
    let successCount = 0;
    
    // Guardar cada cuenta sin marcar como vendida (para la sección de guardadas)
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Crear la cuenta sin marcarla como vendida
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success) {
                successCount++;
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
    
    // Recargar licencias y actualizar las listas
    if (successCount > 0) {
        await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        loadAllDaysSoldAccounts(licenseId);
    }
}

// Guardar cuentas masivamente para un día específico
async function saveBulkAccountsForDay(licenseId, text, day) {
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
    const accounts = parseAccountsText(text, licenseId);
    
    if (accounts.length === 0) {
        return;
    }
    
    // Crear la fecha con el día especificado
    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), day);
    
    let successCount = 0;
    
    // Guardar cada cuenta como vendida para el día especificado
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Primero crear la cuenta
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success && createData.account_id) {
                // Marcar como vendida con la fecha del día especificado
                try {
                    await fetch(`/tienda/api/accounts/${createData.account_id}/mark-sold`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({
                            sold_date: saleDate.toISOString()
                        })
                    });
                    successCount++;
                } catch (error) {
                    console.error('Error al marcar como vendida:', error);
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
    
    // Recargar licencias y actualizar las listas
    if (successCount > 0) {
        await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        loadAllDaysSoldAccounts(licenseId);
    }
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (para días vendidos, versión mejorada)
async function updateOrCreateMultipleAccountsImproved(licenseId, accountId, text, day, originalAccount = null) {
    if (!text || !text.trim()) {
        return;
    }
    
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        return;
    }
    
    // Procesar la primera línea (la cuenta que se está editando)
    const firstLine = lines[0];
    const parsed = parseEmailAndPassword(firstLine, originalAccount, licenseId);
    
    if (!parsed.email && !originalAccount) {
        console.error('No se pudo extraer email de la línea editada');
        return;
    }
    
    try {
        // Actualizar la cuenta existente
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                email: parsed.email,
                password: parsed.password,
                account_identifier: parsed.identifier
            })
        });
        
        // Verificar el status de la respuesta primero
        if (!response.ok) {
            const textResponse = await response.text();
            console.error(`Error HTTP ${response.status}:`, textResponse);
            throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
        }
        
        // Verificar si la respuesta es JSON válido
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('Respuesta no es JSON:', textResponse);
            throw new Error('El servidor no devolvió una respuesta JSON válida');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Si hay más líneas, crear nuevas cuentas para el mismo día
            if (lines.length > 1) {
                const remainingText = lines.slice(1).join('\n');
                await saveBulkAccountsForDay(licenseId, remainingText, day);
            }
            
            // Recargar
            await loadLicenses();
            loadAndDisplaySavedAccounts(licenseId);
            loadAllDaysSoldAccounts(licenseId);
        } else {
            console.error('Error al actualizar cuenta:', data.error);
        }
    } catch (error) {
        console.error('Error al actualizar cuenta:', error);
    }
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (para días vendidos, mantener para compatibilidad)
async function updateOrCreateMultipleAccounts(licenseId, accountId, text, day) {
    // Buscar la cuenta original
    const originalAccount = licenses
        .flatMap(l => l.accounts || [])
        .find(acc => acc.id === accountId);
    
    return await updateOrCreateMultipleAccountsImproved(licenseId, accountId, text, day, originalAccount);
}

// Función mejorada para parsear email y contraseña de una línea de texto (notas al final ignoradas para API)
function parseEmailAndPassword(text, originalAccount = null, licenseId) {
    if (!text || !text.trim()) {
        return { email: null, password: null };
    }

    const line = text.trim();
    const license = licenseId != null ? licenses.find(l => l.id === licenseId) : null;
    const isNetflix = license && isNetflixProductName(license.product_name);
    const parsed = parseLineAccountFields(line, { isNetflix });

    let email = parsed ? parsed.email : null;
    let password = parsed ? parsed.password : null;

    // Si no se encontró email pero hay cuenta original, usar la original
    if (!email && originalAccount) {
        email = originalAccount.email.toLowerCase();
        // Si hay texto que no parece email, podría ser solo la contraseña
        if (!password && line.trim() && !line.includes('@')) {
            password = line.trim();
        }
    }
    
    // Si no se encontró contraseña pero hay cuenta original, usar la original
    if (!password && originalAccount) {
        password = originalAccount.password;
        // Si hay un email detectado diferente, usarlo
        if (email && email !== originalAccount.email.toLowerCase()) {
            // Email fue cambiado, mantener la contraseña original si no se especificó nueva
        }
    }
    
    // Validar que al menos tengamos email o datos para actualizar
    if (!email && !originalAccount) {
        return { email: null, password: null };
    }
    
    let identifier = null;
    if (parsed && parsed.identifier != null) {
        identifier = parsed.identifier;
    } else if (email) {
        identifier = email.split('@')[0];
    } else if (originalAccount) {
        identifier = originalAccount.account_identifier;
    }

    return {
        email: email || (originalAccount ? originalAccount.email.toLowerCase() : null),
        password: password || (originalAccount ? originalAccount.password : null),
        identifier: identifier
    };
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (versión mejorada)
async function updateExistingAccountImproved(licenseId, accountId, text, originalAccount = null) {
    if (!text || !text.trim()) {
        return;
    }
    
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        return;
    }
    
    // Procesar la primera línea (la cuenta que se está editando)
    const firstLine = lines[0];
    const parsed = parseEmailAndPassword(firstLine, originalAccount, licenseId);
    
    if (!parsed.email && !originalAccount) {
        console.error('No se pudo extraer email de la línea editada');
        return;
    }
    
    try {
        // Actualizar la cuenta existente con los datos parseados
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                email: parsed.email,
                password: parsed.password,
                account_identifier: parsed.identifier
            })
        });
        
        // Verificar si la respuesta es JSON válido
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('Respuesta no es JSON:', textResponse);
            throw new Error('El servidor no devolvió una respuesta JSON válida');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Si hay más líneas, crear nuevas cuentas (sin marcar como vendidas, para la sección guardada)
            if (lines.length > 1) {
                const remainingText = lines.slice(1).join('\n');
                await saveBulkAccountsFromEditable(licenseId, remainingText);
            }
            
            // Recargar
            await loadLicenses();
            loadAndDisplaySavedAccounts(licenseId);
            loadAllDaysSoldAccounts(licenseId);
        } else {
            console.error('Error al actualizar cuenta:', data.error);
        }
    } catch (error) {
        console.error('Error al actualizar cuenta:', error);
        // No mostrar error al usuario para mantener la experiencia fluida
    }
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (mantener para compatibilidad)
async function updateExistingAccount(licenseId, accountId, text) {
    // Buscar la cuenta original
    const originalAccount = licenses
        .flatMap(l => l.accounts || [])
        .find(acc => acc.id === accountId);
    
    return await updateExistingAccountImproved(licenseId, accountId, text, originalAccount);
}

/** Entregas visibles en «Días»: manual/marca vendida (`sold`) o asignación por compra (`assigned`), con `assigned_at`. */
function isAccountCountedInAdminDaysView(account) {
    if (!account || !account.assigned_at) return false;
    const s = String(account.status || '').toLowerCase();
    return s === 'sold' || s === 'assigned';
}

/** Cuentas entregadas cuyo assigned_at cae en este día del mes (1–31). */
function getSoldAccountsForDayNumber(licenseId, day) {
    if (licenseId === AGGREGATE_LICENSE_ID) {
        const out = [];
        const accountToProduct = new Map();
        const visibleIds = getAggregateVisibleLicenseIdSet();
        for (const lic of licenses) {
            if (!lic.accounts || lic.isAggregate) continue;
            if (!visibleIds.has(lic.id)) continue;
            for (const account of lic.accounts) {
                if (!isAccountCountedInAdminDaysView(account)) continue;
                const saleDay = calendarDayOfMonthInBogota(account.assigned_at);
                if (saleDay !== day) continue;
                accountToProduct.set(account.id, lic.product_name || '');
                out.push(Object.assign({}, account, { _sourceLicenseId: lic.id }));
            }
        }
        out.sort((a, b) => {
            const pa = accountToProduct.get(a.id) || '';
            const pb = accountToProduct.get(b.id) || '';
            const c = pa.localeCompare(pb, 'es');
            if (c !== 0) return c;
            return normalizeAccountEmailKey(a.email).localeCompare(normalizeAccountEmailKey(b.email));
        });
        return out;
    }
    const license = licenses.find(l => l.id === licenseId);
    if (!license) return [];
    const accs = Array.isArray(license.accounts) ? license.accounts : [];
    return accs.filter(account => {
        if (!isAccountCountedInAdminDaysView(account)) return false;
        const saleDay = calendarDayOfMonthInBogota(account.assigned_at);
        return saleDay === day;
    });
}

function normalizeAccountEmailKey(email) {
    return String(email || '').toLowerCase().trim();
}

function adminWarrantyLookupAccountIdByCredParts(licenseId, parts) {
    const pk = adminMainBlocCredEmailKeyFromParsedLine(parts || {});
    const lidNum = Number(licenseId);
    if (!pk || !Number.isFinite(lidNum) || lidNum === AGGREGATE_LICENSE_ID) {
        return '';
    }
    const L = licenses.find(function (lic) {
        return lic.id === lidNum;
    });
    if (!L || !Array.isArray(L.accounts)) {
        return '';
    }
    for (let i = 0; i < L.accounts.length; i++) {
        const acc = L.accounts[i];
        if (!acc || acc.email == null || acc.id == null) continue;
        if (normalizeAccountEmailKey(acc.email) === pk) {
            return String(acc.id).trim();
        }
    }
    return '';
}

function scheduleAdminLicWarrantyRefreshForRow(rowEl) {
    if (!rowEl || !rowEl.closest) return;
    const tk = '__warrantyRowTm';
    if (rowEl[tk]) {
        clearTimeout(rowEl[tk]);
    }
    rowEl[tk] = setTimeout(function () {
        try {
            delete rowEl[tk];
        } catch (eDel) {
            rowEl[tk] = null;
        }
        const main = document.getElementById('adminLicenciasStructuredRows');
        if (main && main.contains(rowEl)) {
            const rows = Array.prototype.slice.call(main.querySelectorAll('.license-split-editor__row'));
            const idx = rows.indexOf(rowEl);
            if (idx >= 0) {
                adminLicWarrantyApplyAttrsToStructuredRow(rowEl, idx);
            }
            return;
        }
        const dayRoot = rowEl.closest('.day-license-split-root');
        if (!dayRoot) return;
        const dre = dayLicenseSplitGetRowElements(dayRoot);
        const di = dre.indexOf(rowEl);
        if (di >= 0) {
            adminLicWarrantyApplyAttrsToDayRow(rowEl, dayRoot, di);
        }
    }, 110);
}

function adminLicWarrantyStructuredMainLinePartsAtIdx(rowOrdinalZeroBased) {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta) return {};
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = adminMainLicenseCredLinesCollapsed(raw);
    const cred = credLines[rowOrdinalZeroBased];
    const rows = adminLicenseSplitGetRowElements();
    const rr = rows[rowOrdinalZeroBased]
        ? adminLicenseSplitReadRow(rows[rowOrdinalZeroBased])
        : { user: '', statusGood: '', statusBad: '', extra: '' };
    const mergedLn = buildAdminLicenseStorageLine(
        cred != null ? cred : '',
        rr.user,
        rr.statusGood != null ? rr.statusGood : '',
        rr.statusBad != null ? rr.statusBad : '',
        rr.extra
    );
    return parseAdminLicenseLineToSplitParts(mergedLn);
}

function adminLicWarrantyStructuredMainContext(row, rowOrdinalZeroBased) {
    const taLic = document.getElementById('adminLicenciasNotepadByLicense');
    const lid = taLic ? parseInt(taLic.dataset.licenseId, 10) : NaN;
    if (!Number.isFinite(lid) || lid === AGGREGATE_LICENSE_ID) {
        return { disabled: true };
    }
    const dayInp = row.querySelector('.license-split-editor__day-num');
    const refNow = new Date();
    let cd = dayInp ? parseInt(dayInp.value, 10) : NaN;
    if (!Number.isFinite(cd)) {
        cd = adminLicenseSplitDefaultDayOfMonth();
    }
    cd = adminLicenseSplitClampDayNumValue(cd, refNow);
    const u = row.querySelector('.license-split-editor__user');
    const clientUsername = u ? String(u.value || '').trim() : '';
    const parts = adminLicWarrantyStructuredMainLinePartsAtIdx(rowOrdinalZeroBased);
    const aid = adminWarrantyLookupAccountIdByCredParts(lid, parts);
    return {
        ok: true,
        licenseId: lid,
        calendarDay: cd,
        rowOrdinal: rowOrdinalZeroBased,
        accountIdStr: aid,
        clientUsername: clientUsername || 'anonimo'
    };
}

function adminLicWarrantyDayRowLineParts(dayRoot, rowOrdinalZeroBased) {
    const ta = dayLicenseSplitQueryCredsTa(dayRoot);
    const raw = String(ta && ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    const cred = credLines[rowOrdinalZeroBased];
    const rows = dayLicenseSplitGetRowElements(dayRoot);
    const rr = rows[rowOrdinalZeroBased]
        ? adminLicenseSplitReadRow(rows[rowOrdinalZeroBased])
        : { user: '', statusGood: '', statusBad: '', extra: '' };
    const mergedLn = buildAdminLicenseStorageLine(
        cred != null ? cred : '',
        rr.user,
        rr.statusGood != null ? rr.statusGood : '',
        rr.statusBad != null ? rr.statusBad : '',
        rr.extra
    );
    return parseAdminLicenseLineToSplitParts(mergedLn);
}

function adminLicWarrantyDayBlocContext(row, dayRoot, rowOrdinalZeroBased) {
    const lid = parseInt(dayRoot.dataset.licenseId, 10);
    const cd = parseInt(dayRoot.dataset.day, 10);
    if (!Number.isFinite(lid) || lid === AGGREGATE_LICENSE_ID || !Number.isFinite(cd)) {
        return { disabled: true };
    }
    const u = row.querySelector('.license-split-editor__user');
    const clientUsername = u ? String(u.value || '').trim() : '';
    const parts = adminLicWarrantyDayRowLineParts(dayRoot, rowOrdinalZeroBased);
    const aid = adminWarrantyLookupAccountIdByCredParts(lid, parts);
    return {
        ok: true,
        licenseId: lid,
        calendarDay: cd,
        rowOrdinal: rowOrdinalZeroBased,
        accountIdStr: aid,
        clientUsername: clientUsername || 'anonimo'
    };
}

function adminLicWarrantySetButtonAttrs(btn, ctx) {
    if (!btn) return;
    if (!ctx || ctx.disabled === true || !ctx.ok) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('data-lic-row-license-id');
        btn.removeAttribute('data-lic-row-day');
        btn.removeAttribute('data-lic-row-ordinal');
        btn.removeAttribute('data-lic-row-account-id');
        btn.removeAttribute('data-warranty-client-username');
        return;
    }
    btn.disabled = false;
    btn.removeAttribute('aria-disabled');
    btn.setAttribute('data-lic-row-license-id', String(ctx.licenseId));
    btn.setAttribute('data-lic-row-day', String(ctx.calendarDay));
    btn.setAttribute('data-lic-row-ordinal', String(ctx.rowOrdinal));
    if (ctx.accountIdStr) {
        btn.setAttribute('data-lic-row-account-id', String(ctx.accountIdStr));
    } else {
        btn.removeAttribute('data-lic-row-account-id');
    }
    const cuRaw = ctx.clientUsername != null ? String(ctx.clientUsername).trim() : '';
    const cuLow = cuRaw.toLowerCase();
    if (cuRaw && cuLow !== 'anonimo') {
        btn.setAttribute('data-warranty-client-username', cuRaw);
    } else {
        btn.removeAttribute('data-warranty-client-username');
    }
}

function adminLicWarrantyEnsureButton(row) {
    const shell = row.querySelector('.license-split-editor__status-select-shell--good');
    if (!shell) return null;
    let btn = shell.querySelector('.admin-lic-admin-warranty-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'admin-lic-admin-warranty-btn user-lic-warranty-history-btn';
        btn.title = 'Historial de caídas y garantías';
        btn.setAttribute('aria-label', 'Ver historial de caídas y garantías de esta fila');
        btn.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>';
        const selGood = shell.querySelector('.license-split-editor__status-good');
        if (selGood) {
            shell.insertBefore(btn, selGood);
        } else {
            shell.appendChild(btn);
        }
    }
    return btn;
}

function adminLicWarrantyApplyAttrsToStructuredRow(row, _rowOrdinalZeroBased) {
    const shell = row && row.querySelector ? row.querySelector('.license-split-editor__status-select-shell--good') : null;
    if (!shell) return;
    /* Historial con día ordinal solo en bloc Día N; en Licencias el icono deformaba columnas y no aplica igual el contexto. */
    const btn = shell.querySelector('.admin-lic-admin-warranty-btn');
    if (btn) btn.remove();
}

function adminLicWarrantyApplyAttrsToDayRow(row, dayRoot, rowOrdinalZeroBased) {
    const btn = adminLicWarrantyEnsureButton(row);
    if (!btn) return;
    const ctx = adminLicWarrantyDayBlocContext(row, dayRoot, rowOrdinalZeroBased);
    adminLicWarrantySetButtonAttrs(btn, ctx);
}

/** Día del mes 1–31 en America/Bogota (mismo criterio que get_colombia_datetime en el servidor). */
function calendarDayOfMonthInBogota(isoOrDate) {
    if (isoOrDate == null || isoOrDate === '') return NaN;
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return NaN;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Bogota',
            day: 'numeric'
        }).formatToParts(d);
        const dayPart = parts.find(function (p) {
            return p.type === 'day';
        });
        if (!dayPart) return NaN;
        const day = parseInt(dayPart.value, 10);
        return Number.isFinite(day) ? day : NaN;
    } catch (_e) {
        const ymd = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const segs = String(ymd || '').split('-');
        if (segs.length >= 3) {
            const dayFallback = parseInt(segs[segs.length - 1], 10);
            return Number.isFinite(dayFallback) ? dayFallback : NaN;
        }
        return NaN;
    }
}

/** Texto plano del bloc del día (una línea por cuenta), mismo formato que parseAccountsText. */
function resolveAccountAssignedUsername(acc) {
    if (!acc) return '';
    const direct = acc.assigned_username != null ? String(acc.assigned_username).trim() : '';
    if (direct) return direct;
    const uid = acc.assigned_to_user_id != null ? acc.assigned_to_user_id : acc.assignedUserId;
    if (uid != null && String(uid).trim() !== '') return String(uid).trim();
    return '';
}

/** Tokens de credencial en Cambios / Vencidas / Caídas (huella + texto en bruto). */
function collectSideBlocMatchTokens(licenseId) {
    const tokens = new Set();
    const lid = typeof licenseId === 'number' ? licenseId : NaN;
    if (!Number.isFinite(lid) || lid <= 0 || lid === AGGREGATE_LICENSE_ID) return tokens;
    const lic = licenses.find(function (l) {
        return l.id === lid;
    });
    if (!lic) return tokens;
    [lic.changes_notes, lic.expired_notes, lic.suspended_notes].forEach(function (txt) {
        String(txt || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .forEach(function (ln) {
                ln = String(ln || '').trim();
                if (!ln) return;
                const fp = dayBlocLineCredentialFinger(ln, lid);
                if (fp) tokens.add('fp:' + fp);
                const parts = parseAdminLicenseLineToSplitParts(ln);
                const cred = String(parts.cred || '').trim().toLowerCase();
                if (!cred) return;
                tokens.add('cred:' + cred);
                const firstWord = cred.split(/\s+/)[0];
                if (firstWord) tokens.add('w:' + firstWord);
            });
    });
    return tokens;
}

function accountMatchesSideBlocTokens(acc, licenseId) {
    const tokens = collectSideBlocMatchTokens(licenseId);
    if (!tokens.size || !acc) return false;
    const fp = accountCredentialFingerFromRecord(acc, licenseId);
    if (fp && tokens.has('fp:' + fp)) return true;
    const pwd = String(acc.password != null ? acc.password : '').replace(/\r?\n/g, ' ').trim();
    const ident = String(acc.account_identifier != null ? acc.account_identifier : '').trim();
    const em = normalizeAccountEmailKey(acc.email);
    const variants = [];
    if (em) variants.push((em + ' ' + pwd).trim().toLowerCase());
    if (ident) variants.push((ident + ' ' + pwd).trim().toLowerCase());
    if (pwd) variants.push(pwd.toLowerCase());
    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (tokens.has('cred:' + v)) return true;
        const w = v.split(/\s+/)[0];
        if (w && tokens.has('w:' + w)) return true;
    }
    return false;
}

/** Huella de credencial de una cuenta vendida (sin depender del usuario en la línea). */
function accountCredentialFingerFromRecord(acc, licenseIdOpt) {
    if (!acc) return '';
    const pwd = String(acc.password != null ? acc.password : '').replace(/\r?\n/g, ' ');
    const ident = String(acc.account_identifier != null ? acc.account_identifier : '').trim();
    const em = normalizeAccountEmailKey(acc.email);
    let cred = '';
    if (em) {
        cred = `${em} ${pwd}`.trim();
    } else if (ident) {
        cred = `${ident} ${pwd}`.trim();
    } else {
        cred = pwd.trim();
    }
    return dayBlocLineCredentialFinger(cred, licenseIdOpt);
}

/** Credenciales ya presentes en Cambios / Vencidas / Caídas (no re-mostrar en Día N). */
function credentialFingerprintsInLicenseSideBlocs(licenseId) {
    const seen = new Set();
    const lid = typeof licenseId === 'number' ? licenseId : NaN;
    if (!Number.isFinite(lid) || lid <= 0 || lid === AGGREGATE_LICENSE_ID) return seen;
    const lic = licenses.find(function (l) {
        return l.id === lid;
    });
    if (!lic) return seen;
    [lic.changes_notes, lic.expired_notes, lic.suspended_notes].forEach(function (txt) {
        String(txt || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .forEach(function (ln) {
                const k = dayBlocLineCredentialFinger(String(ln || '').trim(), lid);
                if (k) seen.add(k);
            });
    });
    return seen;
}

function filterDayAccountsExcludedFromSideBlocs(dayAccounts, licenseId) {
    if (!dayAccounts || !dayAccounts.length) return [];
    if (licenseId === AGGREGATE_LICENSE_ID) {
        return dayAccounts.filter(function (acc) {
            const lid = acc._sourceLicenseId || acc._licenseId || acc.license_id;
            if (!lid) return true;
            const fp = accountCredentialFingerFromRecord(acc, lid);
            const side = credentialFingerprintsInLicenseSideBlocs(lid);
            if (fp && side.has(fp)) return false;
            return !accountMatchesSideBlocTokens(acc, lid);
        });
    }
    const side = credentialFingerprintsInLicenseSideBlocs(licenseId);
    return dayAccounts.filter(function (acc) {
        const fp = accountCredentialFingerFromRecord(acc, licenseId);
        if (fp && side.has(fp)) return false;
        return !accountMatchesSideBlocTokens(acc, licenseId);
    });
}

function filterDayTextLinesExcludedFromSideBlocs(text, licenseIdOpt) {
    const lid = typeof licenseIdOpt === 'number' ? licenseIdOpt : NaN;
    if (!Number.isFinite(lid) || lid <= 0 || lid === AGGREGATE_LICENSE_ID) {
        return text != null ? String(text) : '';
    }
    const side = credentialFingerprintsInLicenseSideBlocs(lid);
    const tokens = collectSideBlocMatchTokens(lid);
    if (!side.size && !tokens.size) {
        return text != null ? String(text) : '';
    }
    const kept = [];
    String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .forEach(function (ln) {
            ln = String(ln || '').trim();
            if (!ln) return;
            const fp = dayBlocLineCredentialFinger(ln, lid);
            if (fp && side.has(fp)) return;
            const parts = parseAdminLicenseLineToSplitParts(ln);
            const cred = String(parts.cred || '').trim().toLowerCase();
            if (cred && tokens.has('cred:' + cred)) return;
            const w = cred.split(/\s+/)[0];
            if (w && tokens.has('w:' + w)) return;
            kept.push(ln);
        });
    return kept.join('\n');
}

function buildDayNotepadTextFromAccounts(dayAccounts, licenseIdOpt) {
    if (!dayAccounts || !dayAccounts.length) return '';
    return dayAccounts
        .map(acc => {
            const pwd = String(acc.password != null ? acc.password : '').replace(/\r?\n/g, ' ');
            const ident = String(acc.account_identifier != null ? acc.account_identifier : '').trim();
            const em = normalizeAccountEmailKey(acc.email);
            let cred = '';
            if (em) {
                cred = `${em} ${pwd}`.trim();
            } else if (ident) {
                cred = `${ident} ${pwd}`.trim();
            } else {
                cred = pwd.trim();
            }
            const user = resolveAccountAssignedUsername(acc) || 'anonimo';
            return buildAdminLicenseStorageLine(cred, user, '', '', '');
        })
        .join('\n');
}

/** Clave estable para deduplicar misma cuenta con distinto formato de línea (plano vs \\x1f con usuario/comprador). */
function dayBlocLineCredentialFinger(rawLine, licenseIdOpt) {
    const t = String(rawLine != null ? rawLine : '').trim();
    if (!t) return '';
    const parsedParts = parseAdminLicenseLineToSplitParts(t);
    let cred = String(parsedParts.cred != null ? parsedParts.cred : '').trim();
    if (!cred) cred = t;
    let isNetflix = false;
    const lidNum = typeof licenseIdOpt === 'number' ? licenseIdOpt : NaN;
    if (Number.isFinite(lidNum) && lidNum > 0 && lidNum !== AGGREGATE_LICENSE_ID) {
        const licLoc = licenses.find(l => l.id === lidNum);
        isNetflix = !!(licLoc && isNetflixProductName(licLoc.product_name));
    }
    const acc = parseLineAccountFields(cred, { isNetflix });
    if (acc && (acc.email || acc.identifier || acc.password)) {
        const em = normalizeAccountEmailKey(acc.email);
        if (em) return 'e:' + em;
        const ident = String(acc.identifier || '').trim().toLowerCase();
        const pw = String(acc.password || '').trim();
        return 'i:' + ident + '|' + pw;
    }
    const fw = cred.split(/\s+/)[0];
    return fw ? 'r:' + fw.toLowerCase() : '';
}

/**
 * Servidor suele tener líneas ricas (dual \\x1f con usuario comprador).
 * derivado de cuenta = solo correo/pass o ident/pass → misma cuenta, misma huella → no duplicar (evita columnas «anonimo»).
 * Si existe venta pero aún no hay línea guardada, se conserva la derivada.
 */
function mergeDayBlocWithDerivedAccounts(saved, built, licenseIdOpt) {
    const builtStr = built != null ? String(built).trim() : '';
    const savedStr = saved != null ? String(saved).trim() : '';
    const savedRawLines = savedStr ? savedStr.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
    const builtLines = builtStr ? builtStr.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];

    const seenCount = new Map();
    /** Conserva duplicados que ya existan en saved (p. ej. misma credencial vendida 2 veces). */
    const savedLines = [];
    savedRawLines.forEach(function (ln) {
        const k = dayBlocLineCredentialFinger(ln, licenseIdOpt);
        if (k) {
            seenCount.set(k, (seenCount.get(k) || 0) + 1);
        }
        savedLines.push(ln);
    });

    if (!builtLines.length) {
        return savedLines.join('\n');
    }

    const out = savedLines.slice();
    const builtCount = new Map();
    builtLines.forEach(function (ln) {
        const k = dayBlocLineCredentialFinger(ln, licenseIdOpt);
        if (k) {
            const currentBuilt = (builtCount.get(k) || 0) + 1;
            builtCount.set(k, currentBuilt);
            const currentSaved = seenCount.get(k) || 0;
            // Si hay más cuentas derivadas que las guardadas en el bloc, añadimos la diferencia.
            if (currentBuilt > currentSaved) {
                const parsedB = parseAdminLicenseLineToSplitParts(ln);
                const builtUser = String(parsedB.user || '').trim().toLowerCase();
                if (
                    (builtUser === 'anonimo' || builtUser === 'anónimo') &&
                    (seenCount.get(k) || 0) > 0
                ) {
                    return;
                }
                out.push(ln);
            }
        } else {
            out.push(ln);
        }
    });

    // Filtra las líneas para remover la huella de duplicados exacta en builtLines si ya están en savedLines
    // Para no mostrar duplicados visuales en la interfaz del admin si la credencial es idéntica
    const finalOut = [];
    const finalSeen = new Map();
    out.forEach(function(ln) {
        const k = dayBlocLineCredentialFinger(ln, licenseIdOpt);
        if (k) {
            const count = (finalSeen.get(k) || 0) + 1;
            finalSeen.set(k, count);
            const maxAllowed = Math.max(seenCount.get(k) || 0, builtCount.get(k) || 0);
            if (count <= maxAllowed) {
                finalOut.push(ln);
            }
        } else {
            finalOut.push(ln);
        }
    });

    return finalOut.join('\n');
}

/** Texto de day_notepads de licencias incluidas en onlyIds (vista «Todos» y productos visibles). */
function getDayNotepadSavedFromAllLicenses(day, onlyIds) {
    const key = String(day);
    const parts = [];
    for (const lic of licenses) {
        if (!lic || lic.isAggregate) continue;
        if (onlyIds && !onlyIds.has(lic.id)) continue;
        if (!lic.day_notepads || !Object.prototype.hasOwnProperty.call(lic.day_notepads, key)) continue;
        const raw = lic.day_notepads[key];
        const s = raw != null ? String(raw).trim() : '';
        if (s) parts.push(s);
    }
    return parts.join('\n');
}

/** Mapa correo→línea del bloc Licencias solo para los productos indicados (vista «Todos» filtrada). */
function buildLicenseNotesCredentialKeyMapForIds(onlyIds) {
    const map = new Map();
    if (onlyIds && onlyIds.size === 0) return map;
    for (const lic of licenses) {
        if (!lic || lic.isAggregate) continue;
        if (onlyIds && !onlyIds.has(lic.id)) continue;
        const notes = lic.license_notes || '';
        for (const rawLine of notes.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const parts = parseAdminLicenseLineToSplitParts(line);
            const cred = String(parts.cred || '').trim();
            const m = /\S+@\S+\.\S+/.exec(cred);
            if (!m) continue;
            map.set(normalizeAccountEmailKey(m[0]), line);
        }
    }
    return map;
}

/**
 * Índice correo(normalizado)→línea completa del bloc «Licencias / producto» (license_notes).
 * Netflix se parsea con el flag correcto por producto.
 */
function getLicenseNotesLineByCredentialKeyMap() {
    if (!_licenseNotesCredentialLineCache) {
        const map = new Map();
        for (const lic of licenses) {
            if (!lic || lic.isAggregate) continue;
            const notes = lic.license_notes || '';
            for (const rawLine of notes.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;
                const parts = parseAdminLicenseLineToSplitParts(line);
                const cred = String(parts.cred || '').trim();
                const m = /\S+@\S+\.\S+/.exec(cred);
                if (!m) continue;
                map.set(normalizeAccountEmailKey(m[0]), line);
            }
        }
        _licenseNotesCredentialLineCache = map;
    }
    return _licenseNotesCredentialLineCache;
}

/**
 * Vista «Todos»: sustituye líneas planas (email pass) por la línea del bloc Licencias del producto
 * cuando coincide el correo (incl. Netflix (n)); añade al final cuentas del día que faltaban por colisión/dedup.
 */
function enrichAggregateMergedWithLicenseNotes(mergedText, dayAccounts, onlyIds) {
    const byKey = onlyIds ? buildLicenseNotesCredentialKeyMapForIds(onlyIds) : getLicenseNotesLineByCredentialKeyMap();
    const lines = String(mergedText || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    const replaced = lines.map(function (line) {
        const p = parseCredentialLineForAggregateMerge(line);
        if (!p) return line;
        const key = normalizeAccountEmailKey(p.email);
        return byKey.has(key) ? byKey.get(key) : line;
    });
    const seen = new Set();
    for (const ln of replaced) {
        const p = parseCredentialLineForAggregateMerge(ln);
        if (p) seen.add(normalizeAccountEmailKey(p.email));
    }
    if (dayAccounts && dayAccounts.length) {
        for (const acc of dayAccounts) {
            const k = normalizeAccountEmailKey(acc.email);
            if (seen.has(k)) continue;
            seen.add(k);
            if (byKey.has(k)) {
                replaced.push(byKey.get(k));
            } else {
                const pwd = String(acc.password != null ? acc.password : '').replace(/\r?\n/g, ' ');
                replaced.push(`${k} ${pwd}`.trim());
            }
        }
    }
    return replaced.join('\n');
}

/** Texto mostrado en el bloc: guardado en servidor (day_notepads) o, si no hay, derivado de cuentas vendidas. */
function getDayNotepadDisplayText(licenseId, day, dayAccounts, aggregateVisibleIdsOpt) {
    const filteredAccounts = filterDayAccountsExcludedFromSideBlocs(dayAccounts || [], licenseId);
    const built = buildDayNotepadTextFromAccounts(filteredAccounts, licenseId);
    if (licenseId === AGGREGATE_LICENSE_ID) {
        const visibleIds = aggregateVisibleIdsOpt || getAggregateVisibleLicenseIdSet();
        const combinedSaved = getDayNotepadSavedFromAllLicenses(day, visibleIds);
        const merged = mergeDayBlocWithDerivedAccounts(combinedSaved, built, null);
        return filterDayTextLinesExcludedFromSideBlocs(
            enrichAggregateMergedWithLicenseNotes(merged, filteredAccounts, visibleIds),
            licenseId
        );
    }
    const lic = licenses.find(l => l.id === licenseId);
    if (!lic || !lic.day_notepads) {
        return filterDayTextLinesExcludedFromSideBlocs(built, licenseId);
    }
    const key = String(day);
    if (Object.prototype.hasOwnProperty.call(lic.day_notepads, key)) {
        const raw = lic.day_notepads[key];
        const saved = raw != null ? String(raw) : '';
        return filterDayTextLinesExcludedFromSideBlocs(
            mergeDayBlocWithDerivedAccounts(saved, built, licenseId),
            licenseId
        );
    }
    return filterDayTextLinesExcludedFromSideBlocs(built, licenseId);
}

/** Estados «verdes» en Licencias y Días (columna propia). «Buena y revisada» (ok) no se ofrece aquí: flujo vía Cambios / revisión en caídas. */
const ADMIN_LICENSE_STATUS_OPTIONS_GOOD = [
    { v: '', label: '—' },
    { v: 'renovar 1 mes mas', label: 'Renovar 1 mes más' },
    { v: 'dejar mes a mes', label: 'Dejar mes a mes' },
    { v: 'no renovar', label: 'No renovar' }
];

/** Estados «rojos» (columna propia). */
const ADMIN_LICENSE_STATUS_OPTIONS_BAD = [
    { v: '', label: '—' },
    { v: 'caida o suspendida', label: 'Caída o suspendida' },
    { v: 'no reproduce', label: 'No reproduce' },
    { v: 'error de contraseña', label: 'Error de contraseña' },
    { v: 'otro', label: 'Otro' }
];

/** Todas las opciones conocidas (p. ej. canonical desde texto guardado). */
const ADMIN_LICENSE_STATUS_OPTIONS = ADMIN_LICENSE_STATUS_OPTIONS_GOOD.concat(
    ADMIN_LICENSE_STATUS_OPTIONS_BAD.filter(function (o) {
        return o.v !== '';
    })
);

/** Texto normalizado para comparar estado guardado vs listas verde/rojo. */
function adminLicenseNormalizeStatusKey(s) {
    try {
        return String(s || '')
            .trim()
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .replace(/\s+/g, ' ');
    } catch (e) {
        return String(s || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }
}

const ADMIN_LICENSE_STATUS_GOOD_KEYS = new Set(
    ['ok', 'renovar 1 mes mas', 'dejar mes a mes', 'no renovar', 'garantia', 'reemplazar', 'terminado'].map(
        adminLicenseNormalizeStatusKey
    )
);
/* Incluye «repetida» solo para colorear datos viejos; ya no está en el desplegable. */
const ADMIN_LICENSE_STATUS_BAD_KEYS = new Set(
    [
        'caida o suspendida',
        'caida',
        'suspendida',
        'no reproduce',
        'error de contraseña',
        'repetida'
    ].map(adminLicenseNormalizeStatusKey)
);

function adminLicenseStatusIsKnownGoodOption(st) {
    const k = adminLicenseNormalizeStatusKey(st);
    if (k === 'ok') return true;
    return ADMIN_LICENSE_STATUS_OPTIONS_GOOD.some(function (o) {
        return o.v && adminLicenseNormalizeStatusKey(o.v) === k;
    });
}

/** Si el guardado ya tenía valor ok (legado), añade la opción para poder lectura/cambiar sin reaparecer en listas nuevas. */
function adminLicenseSplitEnsureBuenaRevisadaOptionForSelect(selGood, storedGoodRaw) {
    if (!selGood) return;
    const canon = adminLicenseSplitCanonicalGoodFromStored(storedGoodRaw != null ? String(storedGoodRaw).trim() : '');
    if (adminLicenseNormalizeStatusKey(canon) !== 'ok') return;
    for (let i = 0; i < selGood.options.length; i++) {
        if (adminLicenseNormalizeStatusKey(selGood.options[i].value) === 'ok') return;
    }
    const o = document.createElement('option');
    o.value = 'ok';
    o.textContent = 'Buena y revisada';
    selGood.appendChild(o);
}

function adminLicenseStatusIsKnownBadOption(st) {
    const k = adminLicenseNormalizeStatusKey(st);
    return ADMIN_LICENSE_STATUS_OPTIONS_BAD.some(function (o) {
        return o.v && adminLicenseNormalizeStatusKey(o.v) === k;
    });
}

/** Tier visual: buenos (verde), problemas (rojo), resto (neutro). «otro» / otro-… cuenta como problema (rojo). */
function adminLicenseStatusTierFromStored(statusText) {
    const raw = String(statusText || '').trim();
    const k = adminLicenseNormalizeStatusKey(raw);
    if (!k) return 'neutral';
    if (/^otro[-:\s]/i.test(raw) || k === 'otro') return 'bad';
    if (ADMIN_LICENSE_STATUS_GOOD_KEYS.has(k)) return 'good';
    if (ADMIN_LICENSE_STATUS_BAD_KEYS.has(k)) return 'bad';
    return 'neutral';
}

function adminLicenseStatusCssTierClass(tier) {
    if (tier === 'good') return 'day-account-status--good';
    if (tier === 'bad') return 'day-account-status--bad';
    return 'day-account-status--neutral';
}

function adminLicenseSplitEffectiveStatusForTier(sel, otroCombined) {
    if (!sel) return '';
    const sv = String(sel.value || '').trim();
    if (sv.indexOf(LICENSE_PREV_GOOD_BAD_PREFIX) === 0) return '';
    if (adminLicenseNormalizeStatusKey(sv) === 'otro') {
        const d = otroCombined ? String(otroCombined.value || '').trim() : '';
        const detail = d.replace(/^otro-?/i, '');
        return detail ? 'otro-' + detail : 'otro-';
    }
    return sv;
}

function adminLicenseSplitApplyGoodSelectTierClass(selGood) {
    if (!selGood) return;
    const v = String(selGood.value || '').trim();
    const tier = v ? 'good' : 'neutral';
    selGood.classList.remove(
        'license-split-editor__status--tier-good',
        'license-split-editor__status--tier-bad',
        'license-split-editor__status--tier-neutral'
    );
    selGood.classList.add('license-split-editor__status--tier-' + tier);
}

function adminLicenseSplitApplyBadSelectTierClass(selBad, otroCombined) {
    if (!selBad) return;
    const tier = adminLicenseStatusTierFromStored(adminLicenseSplitEffectiveStatusForTier(selBad, otroCombined));
    selBad.classList.remove(
        'license-split-editor__status--tier-good',
        'license-split-editor__status--tier-bad',
        'license-split-editor__status--tier-neutral'
    );
    selBad.classList.add('license-split-editor__status--tier-' + tier);
    if (otroCombined) {
        otroCombined.classList.remove(
            'license-split-editor__otro-combined--tier-good',
            'license-split-editor__otro-combined--tier-bad',
            'license-split-editor__otro-combined--tier-neutral'
        );
        otroCombined.classList.add('license-split-editor__otro-combined--tier-' + tier);
    }
    adminLicenseSplitSyncReportIcon(selBad, otroCombined);
}

function adminLicenseSplitApplyDualStatusTierClasses(selGood, selBad, otroCombined) {
    adminLicenseSplitApplyGoodSelectTierClass(selGood);
    adminLicenseSplitApplyBadSelectTierClass(selBad, otroCombined);
}

var __adminLicReportCountRefreshScheduled = false;
function scheduleRefreshAdminLicenciasReportCounts() {
    if (__adminLicReportCountRefreshScheduled) return;
    __adminLicReportCountRefreshScheduled = true;
    window.requestAnimationFrame(function () {
        __adminLicReportCountRefreshScheduled = false;
        refreshAdminLicenciasReportCounts();
    });
}

function adminLicenseSplitCountReportShells(scopeEl) {
    if (!scopeEl || !scopeEl.querySelectorAll) return 0;
    return scopeEl.querySelectorAll('.license-split-editor__status-select-shell--report').length;
}

function refreshAdminLicenciasReportCounts() {
    const rowsMain = document.getElementById('adminLicenciasStructuredRows');
    const nMain = rowsMain ? adminLicenseSplitCountReportShells(rowsMain) : 0;

    const badgeMain = document.getElementById('adminLicenciasLicenseReportBadge');
    if (badgeMain) {
        const numEl = badgeMain.querySelector('.admin-licencias-report-header-badge__num');
        if (nMain > 0) {
            badgeMain.hidden = false;
            if (numEl) numEl.textContent = String(nMain);
            badgeMain.setAttribute(
                'aria-label',
                nMain === 1 ? '1 reporte por cuadrar en Licencias' : nMain + ' reportes por cuadrar en Licencias'
            );
            badgeMain.title =
                nMain === 1
                    ? '1 línea con estado que requiere reporte (Licencias)'
                    : nMain + ' líneas con estado que requieren reporte (Licencias)';
        } else {
            badgeMain.hidden = true;
            if (numEl) numEl.textContent = '0';
            badgeMain.removeAttribute('title');
            badgeMain.setAttribute('aria-label', 'Sin reportes pendientes en Licencias');
        }
    }

    let nDaysSum = 0;
    document.querySelectorAll('.js-admin-day-report-badge').forEach(function (badge) {
        const day = badge.getAttribute('data-day');
        let wrap = null;
        const section = badge.closest('.day-section');
        if (section) {
            wrap = section.querySelector('.day-license-split-rows');
        }
        if (!wrap && day != null && day !== '') {
            const roots = adminLicCollectDaySplitRootsForActiveUi();
            const dayStr = String(day);
            let root = null;
            for (let ri = 0; ri < roots.length; ri++) {
                if (String(roots[ri].dataset.day || '') === dayStr) {
                    root = roots[ri];
                    break;
                }
            }
            if (root) wrap = root.querySelector('.day-license-split-rows');
        }
        const n = wrap ? adminLicenseSplitCountReportShells(wrap) : 0;
        nDaysSum += n;
        const numEl = badge.querySelector('.admin-licencias-report-header-badge__num');
        if (n > 0) {
            badge.hidden = false;
            if (numEl) numEl.textContent = String(n);
            const bt =
                n === 1
                    ? '1 reporte por cuadrar en el día ' + day
                    : n + ' reportes por cuadrar en el día ' + day;
            badge.title = bt;
            badge.setAttribute('aria-label', bt);
        } else {
            badge.hidden = true;
            if (numEl) numEl.textContent = '0';
            badge.removeAttribute('title');
            badge.setAttribute('aria-label', 'Sin reportes pendientes en el día ' + (day || ''));
        }
    });

    const nTotal = nMain + nDaysSum;
    const reportesTotalEl = document.getElementById('adminLicenciasReportesTotalBadge');
    if (reportesTotalEl) {
        const numEl = reportesTotalEl.querySelector('.license-card-report-total-badge__num');
        if (nTotal > 0) {
            reportesTotalEl.hidden = false;
            if (numEl) numEl.textContent = String(nTotal);
            const tt =
                nTotal === 1
                    ? '1 reporte por cuadrar en total (Licencias + días)'
                    : nTotal + ' reportes por cuadrar en total (Licencias + días)';
            reportesTotalEl.title = tt;
            reportesTotalEl.setAttribute('aria-label', tt);
        } else {
            reportesTotalEl.hidden = true;
            if (numEl) numEl.textContent = '0';
            reportesTotalEl.removeAttribute('title');
            reportesTotalEl.setAttribute('aria-label', 'Sin reportes pendientes');
        }
    }

    const reportesBtn = document.getElementById('adminLicenciasReportesBtn');
    if (reportesBtn) {
        reportesBtn.removeAttribute('hidden');
        const baseTitle =
            nTotal > 0
                ? nTotal === 1
                    ? 'Reportes: 1 cuenta con estado rojo — ver lista'
                    : 'Reportes: ' + nTotal + ' cuentas con estado rojo — ver lista'
                : 'Reportes: ver lista (vacía si no hay estados rojos en Licencias ni días)';
        reportesBtn.title = baseTitle;
        reportesBtn.setAttribute('aria-label', baseTitle);
    }

    try {
        if (typeof window.__adminReportesRenderIfVisible === 'function') {
            window.__adminReportesRenderIfVisible();
        }
    } catch (repLiveErr) {
        console.error('__adminReportesRenderIfVisible:', repLiveErr);
    }

    syncAdminHistorialShellMode();
}

window.scheduleRefreshAdminLicenciasReportCounts = scheduleRefreshAdminLicenciasReportCounts;

/** Marca el shell del estado rojo para contadores de Reportes (sin icono extra junto al select). */
function adminLicenseSplitSyncReportIcon(sel, otroCombined) {
    if (!sel) return;
    const shell = sel.closest('.license-split-editor__status-select-shell');
    if (!shell) return;
    shell.querySelectorAll('.license-split-editor__status-report-dismiss').forEach(function (el) {
        el.remove();
    });
    shell.querySelectorAll('.license-split-editor__status-report-flag').forEach(function (el) {
        el.remove();
    });
    const tier = adminLicenseStatusTierFromStored(adminLicenseSplitEffectiveStatusForTier(sel, otroCombined));
    const show = tier === 'bad';
    if (show) {
        shell.classList.add('license-split-editor__status-select-shell--report');
    } else {
        shell.classList.remove('license-split-editor__status-select-shell--report');
    }
    scheduleRefreshAdminLicenciasReportCounts();
}

function adminLicenseStatusIsKnownOption(st) {
    return adminLicenseStatusIsKnownGoodOption(st) || adminLicenseStatusIsKnownBadOption(st);
}

/** Alinea texto guardado al value del <select> (p. ej. caída → caida o suspendida). */
function adminLicenseSplitCanonicalStatusFromStored(st) {
    const raw = String(st != null ? st : '').trim();
    if (!raw) return '';
    const k = adminLicenseNormalizeStatusKey(raw);
    if (k === 'caida' || k === 'suspendida') {
        return 'caida o suspendida';
    }
    for (let i = 0; i < ADMIN_LICENSE_STATUS_OPTIONS.length; i++) {
        const o = ADMIN_LICENSE_STATUS_OPTIONS[i];
        if (adminLicenseNormalizeStatusKey(o.v) === k) return o.v;
    }
    return raw;
}

function adminLicenseSplitCanonicalGoodFromStored(st) {
    const raw = String(st != null ? st : '').trim();
    if (!raw) return '';
    const k = adminLicenseNormalizeStatusKey(raw);
    for (let i = 0; i < ADMIN_LICENSE_STATUS_OPTIONS_GOOD.length; i++) {
        const o = ADMIN_LICENSE_STATUS_OPTIONS_GOOD[i];
        if (o.v && adminLicenseNormalizeStatusKey(o.v) === k) return o.v;
    }
    return raw;
}

function adminLicenseSplitCanonicalBadFromStored(st) {
    const raw = String(st != null ? st : '').trim();
    if (!raw) return '';
    const k = adminLicenseNormalizeStatusKey(raw);
    if (k === 'caida' || k === 'suspendida') {
        return 'caida o suspendida';
    }
    for (let i = 0; i < ADMIN_LICENSE_STATUS_OPTIONS_BAD.length; i++) {
        const o = ADMIN_LICENSE_STATUS_OPTIONS_BAD[i];
        if (o.v && adminLicenseNormalizeStatusKey(o.v) === k) return o.v;
    }
    return raw;
}

function adminLicenseSplitStatusNeedsProblemDetail(statusVal) {
    const s = String(statusVal || '').trim().toLowerCase();
    return s === 'soporte';
}

function adminLicenseSplitNotePlaceholderForStatus(statusVal) {
    const s = String(statusVal || '').trim().toLowerCase();
    if (s === 'soporte') {
        return 'Detalle del reporte o soporte…';
    }
    return 'Notas';
}

/** Con «otro» en la columna roja: muestra el campo de detalle. */
function adminLicenseSplitSyncOtroDetailVisibility(selBad, otroCombined) {
    if (!selBad || !otroCombined) return;
    const wrap = selBad.closest('.license-split-editor__status-wrap');
    const v = String(selBad.value || '').trim().toLowerCase();
    const show = v === 'otro';
    if (show) {
        if (wrap) {
            wrap.classList.add('license-split-editor__status-wrap--otro');
        }
        otroCombined.removeAttribute('hidden');
        otroCombined.hidden = false;
        otroCombined.style.display = '';
        let cur = String(otroCombined.value || '').trim();
        if (/^otro-/i.test(cur)) {
            otroCombined.value = cur.replace(/^otro-?/i, '');
        }
    } else {
        if (wrap) {
            wrap.classList.remove('license-split-editor__status-wrap--otro');
        }
        otroCombined.hidden = true;
        otroCombined.style.display = 'none';
        otroCombined.value = '';
    }
    const selGood = wrap ? wrap.querySelector('.license-split-editor__status-good') : null;
    adminLicenseSplitApplyDualStatusTierClasses(selGood, selBad, otroCombined);
}

function adminLicenseSplitApplyNotePlaceholderFromDual(selBad, noteInput, lineNum) {
    if (!noteInput) return;
    const ph = adminLicenseSplitNotePlaceholderForStatus(selBad ? selBad.value : '');
    noteInput.placeholder = ph;
    const lineBit = lineNum != null ? ' (línea ' + lineNum + ')' : '';
    if (selBad && adminLicenseSplitStatusNeedsProblemDetail(selBad.value)) {
        const short = ph.replace(/\u2026/g, '').trim();
        noteInput.setAttribute('aria-label', short + lineBit);
    } else {
        noteInput.setAttribute('aria-label', 'Notas' + lineBit);
    }
}

/** Dos &lt;select&gt; independientes (verde / rojo) + notas + detalle «otro». */
function adminLicenseSplitWireDualStatusNoteLink(selGood, selBad, noteInput, otroCombined) {
    if (!selGood || !selBad || !noteInput) return;
    function focusOtroCombinedField() {
        if (!otroCombined) return;
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                otroCombined.focus();
                try {
                    const len = String(otroCombined.value != null ? otroCombined.value : '').length;
                    otroCombined.setSelectionRange(len, len);
                } catch (e) {
                    /* ignore */
                }
                try {
                    otroCombined.dispatchEvent(new Event('input', { bubbles: true }));
                } catch (e2) {
                    /* ignore */
                }
            });
        });
    }
    function syncFromBad() {
        if (otroCombined) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroCombined);
        } else {
            const wrap = selBad.closest('.license-split-editor__status-wrap');
            const sg = wrap ? wrap.querySelector('.license-split-editor__status-good') : null;
            adminLicenseSplitApplyDualStatusTierClasses(sg, selBad, null);
        }
        adminLicenseSplitApplyNotePlaceholderFromDual(selBad, noteInput);
    }
    selGood.addEventListener('focusin', function () {
        selGood.setAttribute('data-lic-sel-good-prev', selGood.value != null ? String(selGood.value) : '');
    });
    selGood.addEventListener('change', function () {
        const v = String(selGood.value || '').trim();
        if (v === 'ok') {
            const row = selGood.closest('.license-split-editor__row');
            const mainRows = document.getElementById('adminLicenciasStructuredRows');
            const dayR = row && row.closest ? row.closest('.day-license-split-root') : null;
            if (row && ((mainRows && mainRows.contains(row)) || dayR)) {
                void licenseSplitBuenaRevisadaMoveRowToSuspended(row);
                return;
            }
        }
        const wrap = selGood.closest('.license-split-editor__status-wrap');
        const sb = wrap ? wrap.querySelector('.license-split-editor__status-bad') : selBad;
        adminLicenseSplitApplyGoodSelectTierClass(selGood);
        adminLicenseSplitApplyNotePlaceholderFromDual(sb, noteInput);
    });
    selBad.addEventListener('change', function () {
        const v = String(selBad.value || '').trim().toLowerCase();
        if (v === 'otro' && otroCombined) {
            focusOtroCombinedField();
        } else if (v === 'soporte') {
            window.requestAnimationFrame(function () {
                noteInput.focus();
                try {
                    const len = String(noteInput.value != null ? noteInput.value : '').length;
                    noteInput.setSelectionRange(len, len);
                } catch (e) {
                    /* ignore */
                }
            });
        }
        syncFromBad();
    });
    adminLicenseSplitApplyNotePlaceholderFromDual(selBad, noteInput);
    if (otroCombined) {
        adminLicenseSplitSyncOtroDetailVisibility(selBad, otroCombined);
        otroCombined.addEventListener('input', function () {
            adminLicenseSplitApplyBadSelectTierClass(selBad, otroCombined);
        });
    } else {
        syncFromBad();
    }
}

/** Caídas / suspendidas: solo columna roja + notas + «otro» (sin verde). */
function adminLicenseSplitWireBadOnlyStatusNoteLink(selBad, noteInput, otroCombined) {
    if (!selBad || !noteInput) return;
    function focusOtroCombinedField() {
        if (!otroCombined) return;
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                otroCombined.focus();
                try {
                    const len = String(otroCombined.value != null ? otroCombined.value : '').length;
                    otroCombined.setSelectionRange(len, len);
                } catch (e) {
                    /* ignore */
                }
                try {
                    otroCombined.dispatchEvent(new Event('input', { bubbles: true }));
                } catch (e2) {
                    /* ignore */
                }
            });
        });
    }
    function syncFromBad() {
        if (otroCombined) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroCombined);
        } else {
            adminLicenseSplitApplyBadSelectTierClass(selBad, null);
        }
        adminLicenseSplitApplyNotePlaceholderFromDual(selBad, noteInput);
    }
    selBad.addEventListener('change', function () {
        const v = String(selBad.value || '').trim().toLowerCase();
        if (v === 'otro' && otroCombined) {
            focusOtroCombinedField();
        } else if (v === 'soporte') {
            window.requestAnimationFrame(function () {
                noteInput.focus();
                try {
                    const len = String(noteInput.value != null ? noteInput.value : '').length;
                    noteInput.setSelectionRange(len, len);
                } catch (e) {
                    /* ignore */
                }
            });
        }
        syncFromBad();
    });
    adminLicenseSplitApplyNotePlaceholderFromDual(selBad, noteInput);
    if (otroCombined) {
        adminLicenseSplitSyncOtroDetailVisibility(selBad, otroCombined);
        otroCombined.addEventListener('input', function () {
            adminLicenseSplitApplyBadSelectTierClass(selBad, otroCombined);
        });
    } else {
        syncFromBad();
    }
}

function adminLicenseParseRowTailFields(cred, user, seg3, seg4) {
    const c = cred != null ? String(cred) : '';
    const u = (user || '').trim();
    const s3 = (seg3 || '').trim();
    const s4 = (seg4 || '').trim();
    const mDash = s3.match(/^otro\s*-\s*(.*)$/i);
    if (mDash) {
        return { cred: c, user: u, status: 'otro', otroDetail: (mDash[1] || '').trim(), extra: s4 };
    }
    const mColon = s3.match(/^otro:\s*(.*)$/i);
    if (mColon) {
        return { cred: c, user: u, status: 'otro', otroDetail: (mColon[1] || '').trim(), extra: s4 };
    }
    if (s3.toLowerCase() === 'otro' && s4) {
        return { cred: c, user: u, status: 'otro', otroDetail: s4, extra: '' };
    }
    const normStatus =
        s3.toLowerCase() === 'otro' ? 'otro' : adminLicenseSplitCanonicalStatusFromStored(s3);
    return { cred: c, user: u, status: normStatus, otroDetail: '', extra: s4 };
}

const LICENSE_PREV_GOOD_BAD_PREFIX = '__prev_good:';
const PORTAL_GREEN_EXTRA_PREFIX = '_u_green:';
const AUTO_MES_EXTRA_PREFIX = '_auto_mes:';

function adminLicensePortalExtraSegments(extra) {
    const s = String(extra != null ? extra : '').trim();
    if (!s) return [];
    return s.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
}

function adminLicensePortalStripTagSegments(extra, prefix) {
    const pl = String(prefix || '').toLowerCase();
    const kept = adminLicensePortalExtraSegments(extra).filter((seg) => !String(seg).toLowerCase().startsWith(pl));
    return kept.join(' · ').trim();
}

function adminLicensePortalGreenFromExtra(extra) {
    const pl = PORTAL_GREEN_EXTRA_PREFIX.toLowerCase();
    const segs = adminLicensePortalExtraSegments(extra);
    for (let i = 0; i < segs.length; i += 1) {
        const seg = segs[i];
        if (String(seg).toLowerCase().indexOf(pl) !== 0) continue;
        const raw = seg.slice(PORTAL_GREEN_EXTRA_PREFIX.length).trim();
        const g = adminLicenseSplitCanonicalGoodFromStored(raw) || raw;
        if (!g || adminLicenseNormalizeStatusKey(g) === 'ok') return '';
        return g;
    }
    return '';
}

function adminLicensePortalBadFromExtra(extra) {
    const pl = PORTAL_BAD_EXTRA_PREFIX.toLowerCase();
    const segs = adminLicensePortalExtraSegments(extra);
    for (let i = 0; i < segs.length; i += 1) {
        const seg = segs[i];
        if (String(seg).toLowerCase().indexOf(pl) !== 0) continue;
        const raw = seg.slice(PORTAL_BAD_EXTRA_PREFIX.length).trim();
        if (adminLicenseNormalizeStatusKey(raw) === 'otro') return 'otro';
        return adminLicenseSplitCanonicalBadFromStored(raw) || raw;
    }
    return '';
}

function adminLicensePortalBadEmbedInExtra(extra, badVal) {
    let e = adminLicensePortalStripTagSegments(String(extra != null ? extra : '').trim(), PORTAL_BAD_EXTRA_PREFIX);
    const b = String(badVal != null ? badVal : '').trim();
    if (!b) return e;
    const tag =
        PORTAL_BAD_EXTRA_PREFIX +
        (adminLicenseNormalizeStatusKey(b) === 'otro' ? 'otro' : adminLicenseSplitCanonicalBadFromStored(b) || b);
    return e ? e + ' · ' + tag : tag;
}

function adminLicensePortalGreenEmbedInExtra(extra, greenVal) {
    let e = adminLicensePortalStripTagSegments(String(extra != null ? extra : '').trim(), PORTAL_GREEN_EXTRA_PREFIX);
    const g = String(greenVal != null ? greenVal : '').trim();
    if (!g || adminLicenseNormalizeStatusKey(g) === 'ok') return e;
    const canon = adminLicenseSplitCanonicalGoodFromStored(g) || g;
    const tag = PORTAL_GREEN_EXTRA_PREFIX + canon;
    return e ? e + ' · ' + tag : tag;
}

function adminLicenseAutoMesFromExtra(extra) {
    const pl = AUTO_MES_EXTRA_PREFIX.toLowerCase();
    const segs = adminLicensePortalExtraSegments(extra);
    for (let i = 0; i < segs.length; i += 1) {
        const seg = segs[i];
        if (String(seg).toLowerCase().indexOf(pl) === 0) {
            return seg.trim();
        }
    }
    return '';
}

function adminLicenseStripAutoMesFromExtra(extra) {
    return adminLicensePortalStripTagSegments(extra, AUTO_MES_EXTRA_PREFIX);
}

/** Notas visibles al admin (sin tags internos del sistema). */
function adminLicenseUserNotesFromExtra(extra) {
    let e = adminLicensePortalStripTagSegments(String(extra != null ? extra : '').trim(), PORTAL_GREEN_EXTRA_PREFIX);
    e = adminLicenseStripAutoMesFromExtra(e);
    return e;
}

/** Al guardar: conservar solo tags internos necesarios, separados de las notas del admin. */
function adminLicensePreserveSystemExtraTags(userNotes, originalExtra, statusGood) {
    let e = String(userNotes != null ? userNotes : '').trim();
    const orig = String(originalExtra != null ? originalExtra : '').trim();
    const autoTag = adminLicenseAutoMesFromExtra(orig);
    if (autoTag) {
        e = e ? e + ' · ' + autoTag : autoTag;
    }
    const sg = String(statusGood != null ? statusGood : '').trim();
    if (adminLicenseNormalizeStatusKey(sg) === 'ok') {
        const greenFromOrig = adminLicensePortalGreenFromExtra(orig);
        if (greenFromOrig) {
            e = adminLicensePortalGreenEmbedInExtra(e, greenFromOrig);
        }
    }
    return e;
}

function adminLicenseInitNoteField(noteEl, rowEl, initialExtra) {
    const raw = initialExtra != null ? String(initialExtra) : '';
    if (rowEl) {
        rowEl.dataset.licOrigExtra = raw;
    }
    if (noteEl) {
        noteEl.value = adminLicenseUserNotesFromExtra(raw);
    }
}

function adminLicenseUnpackPrevGoodFromBad(badRaw) {
    const s = String(badRaw || '').trim();
    if (s.indexOf(LICENSE_PREV_GOOD_BAD_PREFIX) === 0) {
        const prev = s.slice(LICENSE_PREV_GOOD_BAD_PREFIX.length).trim();
        return { visibleBad: '', prevGood: adminLicenseSplitCanonicalGoodFromStored(prev) || prev };
    }
    return { visibleBad: s, prevGood: '' };
}

function adminLicensePackPrevGoodBad(prevGood) {
    const p = String(prevGood || '').trim();
    if (!p || adminLicenseNormalizeStatusKey(p) === 'ok') return '';
    const canon = adminLicenseSplitCanonicalGoodFromStored(p) || p;
    return LICENSE_PREV_GOOD_BAD_PREFIX + canon;
}

/** Al marcar «Buena» desde reportes: no perder renovar / mes a mes guardado en la columna verde. */
function adminLicensePrevGoodPackForBuenaMark(parts, rawLine, domRowEl) {
    const p = parts || {};
    const candidates = [];
    const sg = String(p.statusGood != null ? p.statusGood : '').trim();
    const pr = String(p.prevGoodRestore != null ? p.prevGoodRestore : '').trim();
    const fromExtra = adminLicensePortalGreenFromExtra(p.extra);
    if (sg && adminLicenseNormalizeStatusKey(sg) !== 'ok') candidates.push(sg);
    if (pr && adminLicenseNormalizeStatusKey(pr) !== 'ok') candidates.push(pr);
    if (fromExtra) candidates.push(fromExtra);
    if (domRowEl) {
        try {
            const live = adminLicenseSplitReadRow(domRowEl);
            const lv = String(live.statusGood != null ? live.statusGood : '').trim();
            if (lv && adminLicenseNormalizeStatusKey(lv) !== 'ok') {
                candidates.unshift(lv);
            }
            const lb = String(live.statusBad != null ? live.statusBad : '').trim();
            if (lb) {
                p._prevBadForBuena = lb;
            }
        } catch (eDom) {
            /* ignore */
        }
    }
    const fromBadCol = String(p.statusBad != null ? p.statusBad : '').trim();
    if (fromBadCol) {
        p._prevBadForBuena = fromBadCol;
    }
    const raw = String(rawLine != null ? rawLine : '').trim();
    if (raw.indexOf(LICENSE_LINE_FIELD_SEP) !== -1) {
        const segs = raw.split(LICENSE_LINE_FIELD_SEP);
        if (segs.length >= 5) {
            const g2 = (segs[2] || '').trim();
            if (g2 && adminLicenseNormalizeStatusKey(g2) !== 'ok') candidates.push(g2);
            const un = adminLicenseUnpackPrevGoodFromBad(segs[3] || '');
            if (un.prevGood) candidates.push(un.prevGood);
        } else if (segs.length >= 4) {
            const mig = adminLicenseMigrateLegacyFourPartToDual(
                segs[0] || '',
                (segs[1] || '').trim(),
                (segs[2] || '').trim(),
                (segs[3] || '').trim()
            );
            const mg = String(mig.statusGood != null ? mig.statusGood : '').trim();
            if (mg && adminLicenseNormalizeStatusKey(mg) !== 'ok') candidates.push(mg);
        }
    }
    for (let i = 0; i < candidates.length; i += 1) {
        const c = String(candidates[i] || '').trim();
        if (!c) continue;
        const packed = adminLicensePackPrevGoodBad(c);
        if (packed) return { pack: packed, canon: adminLicenseSplitCanonicalGoodFromStored(c) || c };
    }
    return { pack: '', canon: '' };
}

function adminLicenseSplitParseBadStoredSegment(badRaw) {
    const unpacked = adminLicenseUnpackPrevGoodFromBad(badRaw);
    const s = String(unpacked.visibleBad || '').trim();
    if (!s) return { selValue: '', otroDetail: '', prevGood: unpacked.prevGood || '' };
    const m = s.match(/^otro-?\s*(.*)$/i);
    if (m) {
        return { selValue: 'otro', otroDetail: (m[1] || '').trim(), prevGood: unpacked.prevGood || '' };
    }
    return {
        selValue: adminLicenseSplitCanonicalBadFromStored(s) || s,
        otroDetail: '',
        prevGood: unpacked.prevGood || ''
    };
}

function adminLicenseDualFromStoredSegments(cred, user, goodRaw, badRaw, extra) {
    const badParsed = adminLicenseSplitParseBadStoredSegment(badRaw);
    const statusGood = goodRaw ? adminLicenseSplitCanonicalGoodFromStored(goodRaw) || goodRaw : '';
    return {
        cred: cred,
        user: user,
        statusGood: statusGood,
        statusBad: badParsed.selValue,
        otroDetail: badParsed.otroDetail,
        prevGoodRestore: badParsed.prevGood || '',
        extra: extra
    };
}

function adminLicenseMigrateLegacyFourPartToDual(cred, user, seg3, seg4) {
    const legacy = adminLicenseParseRowTailFields(cred, user, seg3, seg4);
    const st = legacy.status;
    const stForTier =
        String(st).toLowerCase() === 'otro' && legacy.otroDetail
            ? 'otro-' + String(legacy.otroDetail).trim()
            : st;
    const tier = adminLicenseStatusTierFromStored(stForTier);
    if (tier === 'good') {
        return {
            cred: legacy.cred,
            user: legacy.user,
            statusGood: adminLicenseSplitCanonicalGoodFromStored(st) || st,
            statusBad: '',
            otroDetail: '',
            extra: legacy.extra
        };
    }
    if (tier === 'bad') {
        let od = '';
        let badSel = '';
        if (String(st).toLowerCase() === 'otro') {
            badSel = 'otro';
            od = legacy.otroDetail != null ? String(legacy.otroDetail) : '';
        } else {
            badSel = adminLicenseSplitCanonicalBadFromStored(st) || st;
        }
        return {
            cred: legacy.cred,
            user: legacy.user,
            statusGood: '',
            statusBad: badSel,
            otroDetail: od,
            extra: legacy.extra
        };
    }
    if (!st) {
        return {
            cred: legacy.cred,
            user: legacy.user,
            statusGood: '',
            statusBad: '',
            otroDetail: '',
            extra: legacy.extra
        };
    }
    return {
        cred: legacy.cred,
        user: legacy.user,
        statusGood: adminLicenseSplitCanonicalGoodFromStored(st) || st,
        statusBad: '',
        otroDetail: '',
        extra: legacy.extra
    };
}

function parseAdminLicenseLineToSplitParts(line) {
    const raw = String(line != null ? line : '').replace(/\r/g, '');
    if (!raw.trim()) {
        return { cred: '', user: '', statusGood: '', statusBad: '', otroDetail: '', extra: '' };
    }
    if (raw.indexOf(LICENSE_LINE_FIELD_SEP) !== -1) {
        const parts = raw.split(LICENSE_LINE_FIELD_SEP);
        const cred = parts[0] != null ? parts[0] : '';
        const user = (parts[1] || '').trim();
        if (parts.length >= 5) {
            const good = (parts[2] || '').trim();
            const badRaw = (parts[3] || '').trim();
            const extra = (parts[4] || '').trim();
            return adminLicenseDualFromStoredSegments(cred, user, good, badRaw, extra);
        }
        const seg3 = (parts.length > 2 ? parts[2] || '' : '').trim();
        const seg4 = (parts.length > 3 ? parts[3] || '' : '').trim();
        return adminLicenseMigrateLegacyFourPartToDual(cred, user, seg3, seg4);
    }
    if (indexOfLegacyDoubleSlashSeparatorFrom(raw, 0) === -1) {
        return adminLicenseMigrateLegacyFourPartToDual(raw, '', '', '');
    }
    const sp = splitLineCredNotesUser(raw);
    const cred = sp.cred != null ? sp.cred : '';
    const user = (sp.notes || '').trim();
    const seg3 = (sp.user || '').trim();
    const seg4 = (sp.extra || '').trim();
    return adminLicenseMigrateLegacyFourPartToDual(cred, user, seg3, seg4);
}

function buildAdminLicenseStorageLine(cred, user, statusGood, statusBad, extra) {
    const c = String(cred != null ? cred : '').trim();
    const u = String(user || '').trim();
    const uu = u || 'anonimo';
    const sg = String(statusGood != null ? statusGood : '').trim();
    const sb = String(statusBad != null ? statusBad : '').trim();
    const e = String(extra != null ? extra : '').trim();
    if (!c && !sg && !sb && !e && (!u || uu === 'anonimo')) {
        return '';
    }
    return [c, uu, sg, sb, e].join(LICENSE_LINE_FIELD_SEP);
}

function adminLicenseSplitGetRowElements() {
    const wrap = document.getElementById('adminLicenciasStructuredRows');
    if (!wrap) return [];
    return Array.prototype.slice.call(wrap.querySelectorAll('.license-split-editor__row'));
}

function adminLicenseSplitReadRow(row) {
    const u = row.querySelector('.license-split-editor__user');
    const selGood = row.querySelector('.license-split-editor__status-good');
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const c = row.querySelector('.license-split-editor__otro-combined');
    const n = row.querySelector('.license-split-editor__note');
    const goodVal = selGood ? String(selGood.value || '').trim() : '';
    let statusBad = '';
    const selBadVal = selBad ? String(selBad.value || '').trim() : '';
    if (adminLicenseNormalizeStatusKey(selBadVal) === 'otro') {
        const d = c && !c.hidden ? String(c.value || '').trim() : '';
        const detail = d.replace(/^otro-?/i, '');
        statusBad = detail ? 'otro-' + detail : 'otro-';
    } else if (selBadVal) {
        statusBad = selBadVal;
    }
    return {
        user: u ? u.value : '',
        statusGood: goodVal,
        statusBad: statusBad,
        extra: adminLicensePreserveSystemExtraTags(
            n ? n.value : '',
            row.dataset.licOrigExtra || '',
            goodVal
        )
    };
}

/** Mismo usuario en todas las filas que tienen credencial (línea izquierda no vacía). */
function adminLicenseSplitApplyUserToAllLicensedRows(userName) {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta) return 0;
    const name = String(userName != null ? userName : '').trim();
    if (!name) return 0;
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    const rows = adminLicenseSplitGetRowElements();
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() === '') continue;
        const u = rows[i].querySelector('.license-split-editor__user');
        if (!u || u.readOnly) continue;
        u.value = name;
        u.classList.remove('license-split-editor__user--unknown');
        try {
            u.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
            /* ignore */
        }
        void licenseSplitValidateUserInput(u);
        count += 1;
    }
    return count;
}

window.adminLicenseSplitApplyUserToAllLicensedRows = adminLicenseSplitApplyUserToAllLicensedRows;

/** Modal de edición masiva: filas seleccionadas con casilla + mismos campos que cada línea. */
var __adminLicBulkCtx = { mode: 'main', dayRoot: null, dayNum: null };

function adminLicenseBulkFillStatusSelect(sel, optionsList) {
    if (!sel || sel.dataset.licBulkFilled === '1') return;
    sel.dataset.licBulkFilled = '1';
    sel.innerHTML = '';
    optionsList.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        sel.appendChild(o);
    });
}

function adminLicenseBulkModalEnsureSelects() {
    const g = document.getElementById('adminLicBulkSelGood');
    const b = document.getElementById('adminLicBulkSelBad');
    if (g) {
        adminLicenseBulkFillStatusSelect(g, ADMIN_LICENSE_STATUS_OPTIONS_GOOD);
    }
    if (b) {
        adminLicenseBulkFillStatusSelect(b, ADMIN_LICENSE_STATUS_OPTIONS_BAD);
    }
}

function adminLicenseBulkSyncModalOtroVisibility() {
    const sel = document.getElementById('adminLicBulkSelBad');
    const wrap = document.getElementById('adminLicBulkOtroWrap');
    if (!sel || !wrap) return;
    const isOtro = String(sel.value || '').trim().toLowerCase() === 'otro';
    wrap.hidden = !isOtro;
}

function adminLicenseBulkToggleToolbarButton() {
    const btn = document.getElementById('adminLicenciasBulkEditBtn');
    if (!btn) return;
    const ic = document.getElementById('licenseAccountsInputContainer');
    const lid = ic && ic.dataset.activeLicenseId != null ? parseInt(ic.dataset.activeLicenseId, 10) : NaN;
    const mainOk = Number.isFinite(lid) && lid !== AGGREGATE_LICENSE_ID;
    btn.disabled = !mainOk;
    btn.setAttribute('aria-disabled', mainOk ? 'false' : 'true');
}

function adminLicenseBulkApplyPatchToRow(row, patch) {
    if (!row || !patch) return;
    const u = row.querySelector('.license-split-editor__user');
    const selGood = row.querySelector('.license-split-editor__status-good');
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const otroCombined = row.querySelector('.license-split-editor__otro-combined');
    const n = row.querySelector('.license-split-editor__note');
    const dayInp = row.querySelector('.license-split-editor__day-num');

    if (patch.applyUser && u && !u.readOnly) {
        u.value = String(patch.userVal != null ? patch.userVal : '').trim();
        u.classList.remove('license-split-editor__user--unknown');
        try {
            u.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {}
        void licenseSplitValidateUserInput(u);
    }

    if (patch.applyGood && selGood) {
        const gv = String(patch.goodVal != null ? patch.goodVal : '').trim();
        selGood.value = gv;
        try {
            selGood.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e2) {}
    }

    if (patch.applyBad && selBad) {
        const selCan = String(patch.badSelectVal != null ? patch.badSelectVal : '').trim();
        selBad.value = selCan;
        if (otroCombined) {
            if (String(selBad.value || '').trim().toLowerCase() === 'otro') {
                otroCombined.value = String(patch.otroDetail != null ? patch.otroDetail : '').trim();
            } else {
                otroCombined.value = '';
            }
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroCombined);
        }
        try {
            selBad.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e3) {}
    }

    if (patch.applyNote && n) {
        n.value = String(patch.noteVal != null ? patch.noteVal : '');
        try {
            n.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e4) {}
    }

    if (patch.applyDay && dayInp) {
        const refNow = new Date();
        let d = parseInt(patch.dayNum, 10);
        if (!Number.isFinite(d)) {
            d = adminLicenseSplitDefaultDayOfMonth();
        }
        adminLicenseSplitApplyDayNumInputLimits(dayInp, refNow);
        dayInp.value = String(adminLicenseSplitClampDayNumValue(d, refNow));
        try {
            dayInp.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e5) {}
    }
}

function adminLicenseBulkListRowsWithCredentialMain() {
    const rows = adminLicenseSplitGetRowElements();
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta) return [];
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() !== '') {
            out.push(rows[i]);
        }
    }
    return out;
}

function adminLicenseBulkListRowsWithCredentialDay(root) {
    if (!root) return [];
    const rows = dayLicenseSplitGetRowElements(root);
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta) return [];
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() !== '') {
            out.push(rows[i]);
        }
    }
    return out;
}

/** Añade líneas de credencial al final del bloc Licencias o del día (edición masiva). */
function adminLicenseBulkAppendCredentialLines(lines) {
    const arr = (lines || []).map(function (ln) {
        return String(ln != null ? ln : '').trim();
    }).filter(Boolean);
    if (!arr.length) return 0;
    if (__adminLicBulkCtx.mode === 'day' && __adminLicBulkCtx.dayRoot) {
        const root = __adminLicBulkCtx.dayRoot;
        const ta = dayLicenseSplitQueryCredsTa(root);
        if (!ta || ta.tagName !== 'TEXTAREA') return 0;
        let raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
        raw = raw.replace(/\s+$/, '');
        arr.forEach(function (ln) {
            if (raw.length) raw += '\n';
            raw += ln;
        });
        ta.value = raw;
        dayLicenseSplitSyncRowsToTextarea(root);
        return arr.length;
    }
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta || ta.tagName !== 'TEXTAREA') return 0;
    let raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    raw = raw.replace(/\s+$/, '');
    arr.forEach(function (ln) {
        if (raw.length) raw += '\n';
        raw += ln;
    });
    ta.value = raw;
    adminLicenseSplitSyncRowsToTextarea();
    return arr.length;
}

function adminLicenseBulkSyncRowCountInputLimits() {
    const inp = document.getElementById('adminLicBulkRowCount');
    if (!inp) return;
    let list = [];
    if (__adminLicBulkCtx.mode === 'day' && __adminLicBulkCtx.dayRoot) {
        list = adminLicenseBulkListRowsWithCredentialDay(__adminLicBulkCtx.dayRoot);
    } else {
        list = adminLicenseBulkListRowsWithCredentialMain();
    }
    const maxC = Math.max(1, list.length);
    inp.max = String(maxC);
    let v = parseInt(inp.value, 10);
    if (!Number.isFinite(v) || v < 1) {
        v = 1;
    }
    if (v > maxC) {
        v = maxC;
    }
    inp.value = String(v);
}

function adminLicenseBulkOpenModal(ctx) {
    adminLicenseBulkModalEnsureSelects();
    const modal = document.getElementById('adminLicenciasBulkModal');
    const dayField = document.getElementById('adminLicBulkDayField');
    const dayInp = document.getElementById('adminLicBulkDay');
    const userInp = document.getElementById('adminLicBulkUser');
    if (!modal) return;
    __adminLicBulkCtx = ctx || { mode: 'main', dayRoot: null, dayNum: null };
    if (dayField) {
        dayField.style.display = __adminLicBulkCtx.mode === 'main' ? '' : 'none';
    }
    if (dayInp && __adminLicBulkCtx.mode === 'main') {
        const now = new Date();
        adminLicenseSplitApplyDayNumInputLimits(dayInp, now);
        dayInp.value = String(adminLicenseSplitClampDayNumValue(adminLicenseSplitDefaultDayOfMonth(), now));
    }
    if (userInp) {
        userInp.value = 'anonimo';
    }
    const addTa = document.getElementById('adminLicBulkAddCreds');
    if (addTa) {
        addTa.value = '';
    }
    const noteTa = document.getElementById('adminLicBulkNote');
    if (noteTa) {
        noteTa.value = '';
    }
    const sg = document.getElementById('adminLicBulkSelGood');
    const sb = document.getElementById('adminLicBulkSelBad');
    if (sg) sg.value = '';
    if (sb) sb.value = '';
    const otroInp = document.getElementById('adminLicBulkOtro');
    if (otroInp) otroInp.value = '';
    adminLicenseBulkSyncModalOtroVisibility();
    adminLicenseBulkSyncRowCountInputLimits();
    try {
        document.documentElement.classList.add('admin-lic-bulk-modal--lock');
    } catch (lockErr) {}
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    const applyBtn = document.getElementById('adminLicBulkApplyBtn');
    if (applyBtn) {
        try {
            applyBtn.focus({ preventScroll: true });
        } catch (f) {
            try {
                applyBtn.focus();
            } catch (f2) {}
        }
    }
}

function adminLicenseBulkCloseModal() {
    const modal = document.getElementById('adminLicenciasBulkModal');
    if (!modal) return;
    const opener = document.getElementById('adminLicenciasBulkEditBtn');
    if (opener && typeof opener.focus === 'function' && !opener.disabled) {
        try {
            opener.focus({ preventScroll: true });
        } catch (e1) {
            try {
                opener.focus();
            } catch (e2) {}
        }
    }
    if (document.activeElement && modal.contains(document.activeElement)) {
        try {
            document.activeElement.blur();
        } catch (e3) {}
    }
    try {
        document.documentElement.classList.remove('admin-lic-bulk-modal--lock');
    } catch (e4) {}
    window.setTimeout(function () {
        if (document.activeElement && modal.contains(document.activeElement)) {
            try {
                document.activeElement.blur();
            } catch (e5) {}
        }
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }, 0);
}

/** Cliente con nombre real (no anonimo/vacío): se puede cobrar deuda cuenta Licencias. */
function adminLicenseBillingUsernameChargeable(usernameRaw) {
    const u = String(usernameRaw != null ? usernameRaw : '')
        .trim()
        .toLowerCase();
    return !!u && u !== 'anonimo';
}

/** Tras vender desde el bloc Licencias: registra deuda en ``users.saldo`` (portal: distinto de 0 = no Pagada). */
async function adminLicenseBulkRegisterDeliveryDebt(appliedQty, billingUsernameRaw) {
    if (!Number.isFinite(appliedQty) || appliedQty < 1) {
        return { charged: false };
    }
    if (!adminLicenseBillingUsernameChargeable(billingUsernameRaw)) {
        return { charged: false, reason: 'sin_cliente_cobrable' };
    }
    let licenseId = NaN;
    if (__adminLicBulkCtx.mode === 'day' && __adminLicBulkCtx.dayRoot) {
        const lr = __adminLicBulkCtx.dayRoot.dataset.licenseId;
        licenseId = lr != null ? parseInt(lr, 10) : NaN;
        if (licenseId === AGGREGATE_LICENSE_ID && typeof getFirstRealLicenseId === 'function') {
            const fr = getFirstRealLicenseId();
            licenseId = Number.isFinite(fr) ? Number(fr) : NaN;
        }
    } else {
        const ic = document.getElementById('licenseAccountsInputContainer');
        licenseId = ic && ic.dataset.activeLicenseId != null ? parseInt(ic.dataset.activeLicenseId, 10) : NaN;
    }
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        return { charged: false, reason: 'no_license_id' };
    }
    try {
        const resp = await fetch(`/tienda/api/licenses/${licenseId}/admin-bulk-delivery-debt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                quantity: appliedQty,
                billing_username: String(billingUsernameRaw != null ? billingUsernameRaw : '').trim()
            })
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok || !j.success) {
            return { charged: false, error: j && j.error ? j.error : 'No se registró la deuda de cuenta.' };
        }
        if (j.charged) {
            return { charged: true, delta: j.delta, quantity: j.quantity, new_saldo: j.new_saldo };
        }
        return { charged: false, skipped: true, server: j };
    } catch (_e) {
        return { charged: false, error: 'Red o servidor al registrar deuda.' };
    }
}

async function adminLicenseBulkApplyFromModal() {
    const applyGoodSel = document.getElementById('adminLicBulkSelGood');
    const applyBadSel = document.getElementById('adminLicBulkSelBad');
    const applyGood =
        applyGoodSel && String(applyGoodSel.value != null ? applyGoodSel.value : '').trim() !== '';
    const applyBad =
        applyBadSel && String(applyBadSel.value != null ? applyBadSel.value : '').trim() !== '';
    const noteInp = document.getElementById('adminLicBulkNote');
    const noteTrimmed = noteInp ? String(noteInp.value != null ? noteInp.value : '').trim() : '';
    const applyNote = noteTrimmed !== '';

    const mainL = __adminLicBulkCtx.mode === 'main';
    const applyDay = mainL;
    const uInp = document.getElementById('adminLicBulkUser');
    let userVal = uInp ? String(uInp.value != null ? uInp.value : '').trim() : '';
    if (!userVal) {
        userVal = 'anonimo';
    }

    const addTa = document.getElementById('adminLicBulkAddCreds');
    const rawAdd = addTa ? String(addTa.value != null ? addTa.value : '') : '';
    const linesToAppend = rawAdd.replace(/\r\n/g, '\n').split('\n');
    const trimmedAppend = [];
    for (let ai = 0; ai < linesToAppend.length; ai++) {
        const z = String(linesToAppend[ai] != null ? linesToAppend[ai] : '').trim();
        if (z) trimmedAppend.push(z);
    }
    const addedCount = adminLicenseBulkAppendCredentialLines(trimmedAppend);

    const countInp = document.getElementById('adminLicBulkRowCount');
    const nWant = countInp ? parseInt(countInp.value, 10) : NaN;
    if (!Number.isFinite(nWant) || nWant < 1) {
        showError('Indica cuántas licencias editar (un número mayor o igual a 1).');
        return;
    }

    let withCred = [];
    if (__adminLicBulkCtx.mode === 'day' && __adminLicBulkCtx.dayRoot) {
        withCred = adminLicenseBulkListRowsWithCredentialDay(__adminLicBulkCtx.dayRoot);
    } else {
        withCred = adminLicenseBulkListRowsWithCredentialMain();
    }

    if (withCred.length === 0) {
        if (addedCount > 0) {
            adminLicenseBulkSyncRowCountInputLimits();
            if (__adminLicBulkCtx.mode === 'day' && __adminLicBulkCtx.dayRoot) {
                const root = __adminLicBulkCtx.dayRoot;
                const d = __adminLicBulkCtx.dayNum;
                const lidRaw = root.dataset.licenseId;
                const licenseId = lidRaw != null ? parseInt(lidRaw, 10) : NaN;
                const merged = dayLicenseSplitGetMergedText(root);
                if (Number.isFinite(licenseId) && licenseId !== AGGREGATE_LICENSE_ID && Number.isFinite(d)) {
                    await syncDayNotepad(licenseId, d, merged, {});
                } else if (Number.isFinite(licenseId) && licenseId === AGGREGATE_LICENSE_ID && Number.isFinite(d)) {
                    await syncAggregateDayNotepad(d, merged, {});
                }
                adminLicenseSplitValidateAllUserInputs(root);
                scheduleRefreshAdminLicenciasReportCounts();
            } else {
                scheduleRefreshAdminLicenciasReportCounts();
                if (typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function') {
                    await window.adminLicenciasSaveCurrentLicenseNotesImmediate();
                }
                const licRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
                adminLicenseSplitValidateAllUserInputs(licRoot || undefined);
            }
            if (addTa && addedCount > 0) {
                addTa.value = '';
            }
            adminLicenseBulkCloseModal();
            showSuccess(
                'Añadidas ' +
                    addedCount +
                    ' licencia(s) en el día (sin cobro automático; aparecen Pagada si el saldo cuenta es 0).'
            );
            return;
        }
        showError('No hay filas con credencial; escribe algo en «Agregar licencias» o añade cuentas al bloc antes.');
        return;
    }

    if (nWant > withCred.length) {
        showError('Faltan licencias para completar el pedido.');
        return;
    }

    if (addTa && addedCount > 0) {
        addTa.value = '';
    }

    const rows = withCred.slice(0, nWant);

    const patch = {
        applyUser: true,
        userVal: userVal,
        applyGood: applyGood,
        goodVal: document.getElementById('adminLicBulkSelGood') ? document.getElementById('adminLicBulkSelGood').value : '',
        applyBad: applyBad,
        badSelectVal: document.getElementById('adminLicBulkSelBad') ? document.getElementById('adminLicBulkSelBad').value : '',
        otroDetail: document.getElementById('adminLicBulkOtro') ? document.getElementById('adminLicBulkOtro').value : '',
        applyNote: applyNote,
        noteVal: noteTrimmed,
        applyDay: applyDay,
        dayNum: document.getElementById('adminLicBulkDay') ? document.getElementById('adminLicBulkDay').value : ''
    };

    for (let r = 0; r < rows.length; r++) {
        adminLicenseBulkApplyPatchToRow(rows[r], patch);
    }

    const applied = rows.length;
    let soldFromLicenciasCount = 0;

    let appendNote = '';
    if (addedCount > 0) {
        appendNote = ' Añadidas ' + addedCount + ' licencia(s).';
    }

    if (__adminLicBulkCtx.mode === 'day' && __adminLicBulkCtx.dayRoot) {
        const root = __adminLicBulkCtx.dayRoot;
        const d = __adminLicBulkCtx.dayNum;
        const lidRaw = root.dataset.licenseId;
        const licenseId = lidRaw != null ? parseInt(lidRaw, 10) : NaN;
        dayLicenseSplitSyncRowsToTextarea(root);
        const merged = dayLicenseSplitGetMergedText(root);
        if (Number.isFinite(licenseId) && licenseId !== AGGREGATE_LICENSE_ID && Number.isFinite(d)) {
            await syncDayNotepad(licenseId, d, merged, {});
        } else if (Number.isFinite(licenseId) && licenseId === AGGREGATE_LICENSE_ID && Number.isFinite(d)) {
            await syncAggregateDayNotepad(d, merged, {});
        }
        adminLicenseSplitValidateAllUserInputs(root);
        scheduleRefreshAdminLicenciasReportCounts();
    } else {
        const bulkMoveMainToDay =
            __adminLicBulkCtx.mode === 'main' && patch.applyDay && rows.length > 0;
        let bulkSellFailed = false;
        if (bulkMoveMainToDay) {
            /* Índices fijos antes de vender: tras el 1.er sell el DOM se recrea y las referencias a filas quedan huérfanas; hay que volver a leer por índice (de mayor a menor el índice no cambia al quitar filas superiores). */
            const orderMain0 = adminLicenseSplitGetRowElements();
            const indicesDescending = rows
                .map(function (r) {
                    return orderMain0.indexOf(r);
                })
                .filter(function (i) {
                    return i >= 0;
                })
                .sort(function (a, b) {
                    return b - a;
                });
            for (let si = 0; si < indicesDescending.length; si++) {
                const targetIdx = indicesDescending[si];
                const curRows = adminLicenseSplitGetRowElements();
                const rowNow = curRows[targetIdx];
                if (!rowNow) {
                    bulkSellFailed = true;
                    break;
                }
                const ok = await adminLicenseSplitSellRowToDay(rowNow, {
                    quiet: true,
                    suppressScroll: true,
                    skipDebtCharge: true
                });
                if (!ok) {
                    bulkSellFailed = true;
                    break;
                }
                soldFromLicenciasCount += 1;
            }
            if (!bulkSellFailed && indicesDescending.length) {
                const refScroll = new Date();
                let dNum = parseInt(patch.dayNum, 10);
                if (!Number.isFinite(dNum)) {
                    dNum = adminLicenseSplitDefaultDayOfMonth();
                }
                dNum = adminLicenseSplitClampDayNumValue(dNum, refScroll);
                const icScroll = document.getElementById('licenseAccountsInputContainer');
                const lidScroll =
                    icScroll && icScroll.dataset.activeLicenseId != null
                        ? parseInt(icScroll.dataset.activeLicenseId, 10)
                        : NaN;
                const allDaysEl = document.getElementById('licenseAllDaysContainer');
                if (allDaysEl && Number.isFinite(lidScroll)) {
                    const dr = allDaysEl.querySelector(
                        `.day-license-split-root[data-day="${dNum}"][data-license-id="${lidScroll}"]`
                    );
                    const section = dr && dr.closest('.day-section');
                    if (section && typeof section.scrollIntoView === 'function') {
                        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            }
        }
        if (bulkSellFailed) {
            adminLicenseBulkCloseModal();
            return;
        }
        if (bulkMoveMainToDay && rows.length > 0) {
            adminLicenseSplitScheduleAutosizeCreds();
            scheduleRefreshAdminLicenciasReportCounts();
            const licRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
            adminLicenseSplitValidateAllUserInputs(licRoot || undefined);
        } else {
            adminLicenseSplitSyncRowsToTextarea();
            adminLicenseSplitScheduleAutosizeCreds();
            scheduleRefreshAdminLicenciasReportCounts();
            if (typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function') {
                await window.adminLicenciasSaveCurrentLicenseNotesImmediate();
            }
            const licRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
            adminLicenseSplitValidateAllUserInputs(licRoot || undefined);
        }
    }

    let debtNote = '';
    const debtQty =
        __adminLicBulkCtx.mode === 'main' && soldFromLicenciasCount > 0 ? soldFromLicenciasCount : 0;
    if (debtQty > 0) {
        const debtEv = await adminLicenseBulkRegisterDeliveryDebt(debtQty, userVal);
        if (debtEv && debtEv.charged && debtEv.delta != null && Number(debtEv.delta) > 0) {
            const dnum = Number(debtEv.delta);
            const dn =
                Math.abs(dnum - Math.round(dnum)) < 1e-9
                    ? String(Math.round(dnum))
                    : String(Number(dnum.toFixed(2)));
            debtNote = ' Cobro cuenta +' + dn + ' (' + debtQty + ' vendida(s) desde Licencias).';
        } else if (debtEv && debtEv.error) {
            debtNote = ' · ' + debtEv.error;
        }
    } else if (__adminLicBulkCtx.mode === 'day') {
        debtNote = ' Sin cobro (entrega manual en Días).';
    }

    adminLicenseBulkCloseModal();
    showSuccess('Actualizado en ' + applied + ' fila(s).' + appendNote + debtNote);
}

function setupAdminLicenseBulkEditUi() {
    adminLicenseBulkModalEnsureSelects();
    setupAdminLicenseBulkModalFocusNoPageScroll();
    document.addEventListener(
        'click',
        function (e) {
            if (e.target.closest && e.target.closest('#adminLicenciasBulkEditBtn')) {
                e.preventDefault();
                const ic = document.getElementById('licenseAccountsInputContainer');
                const lid = ic && ic.dataset.activeLicenseId != null ? parseInt(ic.dataset.activeLicenseId, 10) : NaN;
                if (!Number.isFinite(lid) || lid === AGGREGATE_LICENSE_ID) {
                    showError('Selecciona un producto concreto (no «Todos») para edición masiva en Licencias.');
                    return;
                }
                adminLicenseBulkOpenModal({ mode: 'main', dayRoot: null, dayNum: null });
                return;
            }
            if (e.target.closest && e.target.closest('[data-admin-lic-bulk-dismiss]')) {
                adminLicenseBulkCloseModal();
            }
        },
        false
    );

    const selBadM = document.getElementById('adminLicBulkSelBad');
    if (selBadM) {
        selBadM.addEventListener('change', adminLicenseBulkSyncModalOtroVisibility);
    }

    const applyBtn = document.getElementById('adminLicBulkApplyBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            void adminLicenseBulkApplyFromModal();
        });
    }

    const icObs = document.getElementById('licenseAccountsInputContainer');
    if (icObs && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(function () {
            adminLicenseBulkToggleToolbarButton();
        });
        observer.observe(icObs, { attributes: true, attributeFilter: ['data-active-license-id'] });
    }
    adminLicenseBulkToggleToolbarButton();
}

/** Con el modal abierto, el foco en inputs puede hacer scroll la página de fondo; la fijamos. */
function setupAdminLicenseBulkModalFocusNoPageScroll() {
    const modal = document.getElementById('adminLicenciasBulkModal');
    if (!modal || modal.dataset.licBulkFocusGuard === '1') return;
    modal.dataset.licBulkFocusGuard = '1';
    modal.addEventListener(
        'focusin',
        function () {
            if (!document.documentElement.classList.contains('admin-lic-bulk-modal--lock')) {
                return;
            }
            const y = window.scrollY != null ? window.scrollY : document.documentElement.scrollTop || 0;
            const x = window.scrollX != null ? window.scrollX : document.documentElement.scrollLeft || 0;
            window.requestAnimationFrame(function () {
                window.scrollTo(x, y);
            });
        },
        true
    );
}

function mergeLicenseSplitUserSuggestions(q, namesFromApi) {
    const ql = String(q || '').trim().toLowerCase();
    const out = [];
    const seen = {};
    function add(name) {
        const k = String(name).toLowerCase();
        if (seen[k]) return;
        seen[k] = true;
        out.push(name);
    }
    if (!ql || 'anonimo'.startsWith(ql)) {
        add('anonimo');
    }
    (namesFromApi || []).forEach(function (name) {
        if (String(name).toLowerCase() !== 'anonimo') {
            add(name);
        }
    });
    return out.slice(0, 25);
}

function licenseSplitHideUserSuggestions(box) {
    if (!box) return;
    box.hidden = true;
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '';
    box.style.cssText = '';
}

/** Sube la vista para dejar la fila de usuario más arriba y ver mejor el input al abrir sugerencias. */
function licenseSplitScrollUserFieldIntoView(input) {
    if (!input || !document.body.contains(input)) return;
    const liftPx = 72;
    const anchor = input.closest('.license-split-editor__row') || input;
    try {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) {
        try {
            anchor.scrollIntoView(true);
        } catch (e2) {
            /* ignore */
        }
    }
    window.setTimeout(function () {
        try {
            window.scrollBy({ top: -liftPx, behavior: 'smooth' });
        } catch (e3) {
            window.scrollBy(0, -liftPx);
        }
    }, 160);
}

function licenseSplitPositionSuggestionsBox(box, input) {
    if (!box || !input) return;
    /* Más hueco bajo la lista y sobre el input: se ve lo que escribes sin que el panel tape la fila. */
    const clearanceBelowList = 18;
    const extraLiftPx = 36;
    const r = input.getBoundingClientRect();
    const offsetAboveInput = clearanceBelowList + extraLiftPx;
    function place() {
        const maxH = Math.min(200, Math.max(72, r.top - offsetAboveInput - 8));
        box.style.maxHeight = maxH + 'px';
        box.style.overflowY = 'auto';
        const h = Math.min(Math.max(box.scrollHeight, 1), maxH);
        const top = Math.max(8, r.top - offsetAboveInput - h);
        box.style.position = 'fixed';
        box.style.left = Math.max(6, r.left) + 'px';
        box.style.width = Math.min(r.width, window.innerWidth - 12) + 'px';
        box.style.top = top + 'px';
        box.style.bottom = 'auto';
        box.style.right = 'auto';
        box.style.zIndex = '10050';
    }
    place();
    window.requestAnimationFrame(function () {
        window.requestAnimationFrame(place);
    });
}

function ensureLicenseSplitSuggestionCloseListeners() {
    function hideAll() {
        document.querySelectorAll('.license-split-editor__user-suggestions').forEach(licenseSplitHideUserSuggestions);
    }
    if (!window._licenseSplitSuggestGlobalDone) {
        window._licenseSplitSuggestGlobalDone = true;
        window.addEventListener('scroll', hideAll, true);
        window.addEventListener('resize', hideAll);
    }
    var rows = document.getElementById('adminLicenciasStructuredRows');
    if (rows && rows.dataset.licSugScroll !== '1') {
        rows.dataset.licSugScroll = '1';
        rows.addEventListener('scroll', hideAll);
    }
}

/** Evita cientos de GET simultáneos (ERR_INSUFFICIENT_RESOURCES) al pintar todos los días. */
var LICENSE_USER_EXISTS_TTL_MS = 120000;
var licenseUserExistsCache = new Map();
var licenseUserExistsInflight = new Map();

function licenseSplitApplyExistsClassToInput(input, exists) {
    if (!input) return;
    if (exists) {
        input.classList.remove('license-split-editor__user--unknown');
    } else {
        input.classList.add('license-split-editor__user--unknown');
    }
}

/**
 * Resuelve si el usuario existe (una petición por nombre, con caché y deduplicación en vuelo).
 */
function licenseSplitResolveUserExists(usernameTrimmed) {
    const raw = String(usernameTrimmed != null ? usernameTrimmed : '').trim();
    if (!raw) {
        return Promise.resolve(true);
    }
    const k = raw.toLowerCase();
    if (k === 'anonimo') {
        return Promise.resolve(true);
    }
    const now = Date.now();
    const cached = licenseUserExistsCache.get(k);
    if (cached && now - cached.t < LICENSE_USER_EXISTS_TTL_MS) {
        return Promise.resolve(cached.exists);
    }
    let inflight = licenseUserExistsInflight.get(k);
    if (!inflight) {
        inflight = fetch('/tienda/api/users/exists?username=' + encodeURIComponent(raw))
            .then(function (r) {
                return r.json();
            })
            .then(function (j) {
                licenseUserExistsInflight.delete(k);
                if (j && j.success) {
                    licenseUserExistsCache.set(k, { exists: !!j.exists, t: Date.now() });
                    return !!j.exists;
                }
                return null;
            })
            .catch(function () {
                licenseUserExistsInflight.delete(k);
                return null;
            });
        licenseUserExistsInflight.set(k, inflight);
    }
    return inflight;
}

async function licenseSplitValidateUserInput(input) {
    if (!input || !input.classList || !input.classList.contains('license-split-editor__user')) return;
    const raw = String(input.value != null ? input.value : '').trim();
    if (!raw) {
        input.classList.remove('license-split-editor__user--unknown');
        return;
    }
    if (raw.toLowerCase() === 'anonimo') {
        input.classList.remove('license-split-editor__user--unknown');
        return;
    }
    try {
        const exists = await licenseSplitResolveUserExists(raw);
        if (exists === null) {
            input.classList.remove('license-split-editor__user--unknown');
            return;
        }
        licenseSplitApplyExistsClassToInput(input, exists);
    } catch (e) {
        input.classList.remove('license-split-editor__user--unknown');
    }
}

/** scopeRoot: solo inputs dentro de ese nodo (p. ej. un día). Si se omite, recorre todo el documento. */
function adminLicenseSplitValidateAllUserInputs(scopeRoot) {
    var nodes =
        scopeRoot && scopeRoot.querySelectorAll
            ? scopeRoot.querySelectorAll('.license-split-editor__user')
            : document.querySelectorAll('.license-split-editor__user');
    nodes.forEach(function (el) {
        void licenseSplitValidateUserInput(el);
    });
}

function adminLicenseSplitUserCaretToEnd(input) {
    if (!input || input.readOnly) return;
    const len = String(input.value != null ? input.value : '').length;
    window.requestAnimationFrame(function () {
        try {
            input.setSelectionRange(len, len);
        } catch (e) {
            /* IE / type mismatch */
        }
    });
}

function adminLicenseSplitWireUserField(input, box) {
    let fetchTimer = null;
    let hideTimer = null;
    ensureLicenseSplitSuggestionCloseListeners();

    async function fetchSuggestions() {
        const q = String(input.value != null ? input.value : '').trim();
        input._licenseUserSuggestSeq = (input._licenseUserSuggestSeq || 0) + 1;
        const seq = input._licenseUserSuggestSeq;
        try {
            const r = await fetch('/tienda/api/users/usernames?q=' + encodeURIComponent(q) + '&limit=25');
            const j = await r.json();
            if (seq !== input._licenseUserSuggestSeq) return;
            if (!j.success || !box) return;
            const merged = mergeLicenseSplitUserSuggestions(q, j.usernames || []);
            box.innerHTML = '';
            merged.forEach(function (name) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'license-split-editor__user-suggest-item';
                btn.setAttribute('aria-label', 'Usar usuario ' + name);
                btn.textContent = name;
                btn.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    input.value = name;
                    licenseSplitHideUserSuggestions(box);
                    input.classList.remove('license-split-editor__user--unknown');
                    try {
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    } catch (e2) {}
                    void licenseSplitValidateUserInput(input);
                });
                box.appendChild(btn);
            });
            if (!box.children.length) {
                licenseSplitHideUserSuggestions(box);
                return;
            }
            const suggestionsJustOpened = !!box.hidden;
            box.hidden = false;
            box.setAttribute('aria-hidden', 'false');
            licenseSplitPositionSuggestionsBox(box, input);
            if (suggestionsJustOpened) {
                licenseSplitScrollUserFieldIntoView(input);
            }
        } catch (e) {
            licenseSplitHideUserSuggestions(box);
        }
    }

    input.addEventListener('input', function () {
        clearTimeout(fetchTimer);
        fetchTimer = setTimeout(fetchSuggestions, 200);
        scheduleAdminLicWarrantyRefreshForRow(input.closest('.license-split-editor__row'));
        const t = String(input.value != null ? input.value : '').trim();
        if (!t) {
            input.classList.remove('license-split-editor__user--unknown');
        }
    });
    input.addEventListener('focus', function () {
        clearTimeout(fetchTimer);
        fetchSuggestions();
    });
    input.addEventListener('click', function () {
        window.requestAnimationFrame(function () {
            if (box && !box.hidden) {
                licenseSplitScrollUserFieldIntoView(input);
                licenseSplitPositionSuggestionsBox(box, input);
            }
        });
    });
    input.addEventListener('blur', function () {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            licenseSplitHideUserSuggestions(box);
            void licenseSplitValidateUserInput(input);
        }, 180);
    });
}

/** Panel derecho del split (día, carrito, usuario, estado, notas): flechas estilo Excel. No aplica al textarea de credenciales. */
function licenseSplitIsOtroFieldVisible(otro) {
    if (!otro) return false;
    if (otro.hidden) return false;
    try {
        const st = window.getComputedStyle(otro);
        return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
    } catch (e) {
        return false;
    }
}

function licenseSplitRowEligibleFocus(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    return true;
}

function licenseSplitBuildRowFocusSequence(row) {
    const seq = [];
    if (!row) return seq;
    const dayInp = row.querySelector('.license-split-editor__day-num');
    const sellBtn = row.querySelector('.license-split-editor__sell-btn');
    const restoreBtn = row.querySelector('.license-split-editor__restore-to-license-btn');
    const u = row.querySelector('.license-split-editor__user');
    const selGood = row.querySelector('.license-split-editor__status-good');
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const otro = row.querySelector('.license-split-editor__otro-combined');
    const n = row.querySelector('.license-split-editor__note');
    if (licenseSplitRowEligibleFocus(dayInp)) seq.push(dayInp);
    if (licenseSplitRowEligibleFocus(sellBtn)) seq.push(sellBtn);
    if (licenseSplitRowEligibleFocus(restoreBtn)) seq.push(restoreBtn);
    if (licenseSplitRowEligibleFocus(u)) seq.push(u);
    if (licenseSplitRowEligibleFocus(selGood)) seq.push(selGood);
    if (licenseSplitRowEligibleFocus(selBad)) seq.push(selBad);
    if (licenseSplitRowEligibleFocus(otro) && licenseSplitIsOtroFieldVisible(otro)) seq.push(otro);
    if (licenseSplitRowEligibleFocus(n)) seq.push(n);
    return seq;
}

function licenseSplitGetRowSiblings(row) {
    const p = row.parentElement;
    if (!p) return [];
    return Array.prototype.filter.call(p.children, function (c) {
        return c.classList && c.classList.contains('license-split-editor__row');
    });
}

function licenseSplitTextOrNumberNavBoundaryOk(input, key) {
    if (!input || input.tagName !== 'INPUT') return true;
    const t = input.type;
    if (t !== 'text' && t !== 'number' && t !== 'search' && t !== 'tel' && t !== 'email' && t !== 'url') {
        return true;
    }
    if (input.readOnly) return true;
    const len = String(input.value != null ? input.value : '').length;
    let start = 0;
    let end = 0;
    try {
        start = input.selectionStart != null ? input.selectionStart : len;
        end = input.selectionEnd != null ? input.selectionEnd : len;
    } catch (e) {
        return true;
    }
    if (t === 'number' && (input.selectionStart == null || input.selectionEnd == null)) {
        return true;
    }
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    if (key === 'ArrowLeft') return lo === 0 && hi === 0;
    if (key === 'ArrowRight') return lo === len && hi === len;
    return true;
}

function licenseSplitUserSuggestionsOpenForTarget(t) {
    const uw = t.closest && t.closest('.license-split-editor__user-wrap');
    if (!uw) return false;
    const sug = uw.querySelector('.license-split-editor__user-suggestions');
    if (!sug || sug.hidden) return false;
    return sug.getAttribute('aria-hidden') !== 'true';
}

function licenseSplitOnArrowKeydown(e) {
    const key = e.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') {
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.shiftKey) return;

    const t = e.target;
    if (!t || !t.closest) return;

    if (t.closest && t.closest('.license-split-editor__creds-cell')) return;

    const row = t.closest('.license-split-editor__row');
    if (!row) return;

    const rowsWrap = t.closest('.license-split-editor__rows');
    if (!rowsWrap) return;

    if (t.closest && t.closest('.license-split-editor__user-suggestions')) return;

    if (licenseSplitUserSuggestionsOpenForTarget(t)) return;

    const seq = licenseSplitBuildRowFocusSequence(row);
    const idx = seq.indexOf(t);
    if (idx < 0) return;

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (!licenseSplitTextOrNumberNavBoundaryOk(t, key)) {
            return;
        }
    }

    let nextEl = null;
    if (key === 'ArrowLeft') {
        if (idx > 0) nextEl = seq[idx - 1];
    } else if (key === 'ArrowRight') {
        if (idx < seq.length - 1) nextEl = seq[idx + 1];
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        const siblings = licenseSplitGetRowSiblings(row);
        const rIdx = siblings.indexOf(row);
        if (rIdx < 0) return;
        const delta = key === 'ArrowUp' ? -1 : 1;
        const rNext = siblings[rIdx + delta];
        if (!rNext) return;
        const seqN = licenseSplitBuildRowFocusSequence(rNext);
        if (!seqN.length) return;
        nextEl = seqN[Math.min(idx, seqN.length - 1)];
    }

    if (!nextEl) return;

    e.preventDefault();
    e.stopPropagation();
    nextEl.focus();
}

function wireLicenseSplitArrowNavigation() {
    if (document.documentElement.dataset.licSplitArrowNav === '1') return;
    document.documentElement.dataset.licSplitArrowNav = '1';
    const handler = licenseSplitOnArrowKeydown;
    const structured = document.getElementById('adminLicenciasStructuredRows');
    if (structured) structured.addEventListener('keydown', handler, true);
    const suspended = document.getElementById('adminLicenciasSuspendedRows');
    if (suspended) suspended.addEventListener('keydown', handler, true);
    const expiredR = document.getElementById('adminLicenciasExpiredRows');
    if (expiredR) expiredR.addEventListener('keydown', handler, true);
    const changesParent = document.getElementById('licenseChangesProductsContainer');
    if (changesParent) changesParent.addEventListener('keydown', handler, true);
    const daysParent = document.getElementById('licenseAllDaysContainer');
    if (daysParent) daysParent.addEventListener('keydown', handler, true);
}

window.wireLicenseSplitArrowNavigation = wireLicenseSplitArrowNavigation;

/** Días que tiene el mes civil de refDate (28–31); refDate por defecto = hoy (incluye bisiestos). */
function adminLicenseDaysInCalendarMonth(refDate) {
    const d =
        refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function adminLicenseSplitApplyDayNumInputLimits(dayInp, refDate) {
    if (!dayInp) return;
    const d =
        refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
    const maxD = adminLicenseDaysInCalendarMonth(d);
    dayInp.min = '1';
    dayInp.max = String(maxD);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    dayInp.title =
        'Día del mes en curso: 1–' + maxD + ' (' + y + '-' + String(m).padStart(2, '0') + ')';
    dayInp.setAttribute('aria-label', 'Día del mes (1 a ' + maxD + ') para enviar la licencia');
}

function adminLicenseSplitClampDayNumValue(raw, refDate) {
    const d =
        refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
    const maxD = adminLicenseDaysInCalendarMonth(d);
    let v = parseInt(raw, 10);
    if (!Number.isFinite(v)) {
        const today = d.getDate();
        return Math.min(maxD, Math.max(1, today >= 1 && today <= maxD ? today : 1));
    }
    return Math.min(maxD, Math.max(1, v));
}

function adminLicenseSplitWireDayNumInput(dayInp) {
    if (!dayInp || dayInp.dataset.licDayWired === '1') return;
    dayInp.dataset.licDayWired = '1';
    const onAdjust = function () {
        const now = new Date();
        adminLicenseSplitApplyDayNumInputLimits(dayInp, now);
        dayInp.value = String(adminLicenseSplitClampDayNumValue(dayInp.value, now));
        scheduleAdminLicWarrantyRefreshForRow(dayInp.closest('.license-split-editor__row'));
    };
    dayInp.addEventListener('focus', function () {
        adminLicenseSplitApplyDayNumInputLimits(dayInp, new Date());
    });
    dayInp.addEventListener('input', onAdjust);
    dayInp.addEventListener('change', onAdjust);
}

function adminLicenseSplitDefaultDayOfMonth() {
    const now = new Date();
    const maxD = adminLicenseDaysInCalendarMonth(now);
    const d = now.getDate();
    return d >= 1 && d <= maxD ? d : 1;
}

function adminLicenseSplitCreateRow(
    initialUser,
    initialStatusGood,
    initialStatusBad,
    initialExtra,
    initialOtroDetail,
    initialDay
) {
    const row = document.createElement('div');
    row.className = 'license-split-editor__row';
    const now = new Date();
    let dayVal = adminLicenseSplitDefaultDayOfMonth();
    if (initialDay != null && initialDay !== '') {
        const parsed = parseInt(initialDay, 10);
        if (Number.isFinite(parsed)) {
            dayVal = adminLicenseSplitClampDayNumValue(parsed, now);
        }
    }
    const daySellCell = document.createElement('div');
    daySellCell.className = 'license-split-editor__day-sell-cell';
    const dayInp = document.createElement('input');
    dayInp.type = 'number';
    dayInp.className = 'license-split-editor__day-num';
    dayInp.min = '1';
    dayInp.value = String(dayVal);
    adminLicenseSplitApplyDayNumInputLimits(dayInp, now);
    adminLicenseSplitWireDayNumInput(dayInp);
    const sellBtn = document.createElement('button');
    sellBtn.type = 'button';
    sellBtn.className = 'license-split-editor__sell-btn';
    sellBtn.title = 'Pasar esta licencia al día indicado (vender)';
    sellBtn.setAttribute('aria-label', 'Pasar licencia al día seleccionado');
    sellBtn.innerHTML = '<i class="fas fa-shopping-cart" aria-hidden="true"></i>';
    daySellCell.appendChild(dayInp);
    daySellCell.appendChild(sellBtn);
    const userWrap = document.createElement('div');
    userWrap.className = 'license-split-editor__user-wrap';
    const sugBox = document.createElement('div');
    sugBox.className = 'license-split-editor__user-suggestions';
    sugBox.hidden = true;
    sugBox.setAttribute('aria-hidden', 'true');
    sugBox.setAttribute('role', 'group');
    sugBox.setAttribute('aria-label', 'Sugerencias de usuario');
    const u = document.createElement('input');
    u.type = 'text';
    u.className = 'license-split-editor__user';
    u.setAttribute('autocomplete', 'off');
    u.setAttribute('aria-label', 'Usuario o cliente de la licencia');
    u.placeholder = 'anonimo';
    u.value = initialUser != null ? initialUser : '';
    userWrap.appendChild(sugBox);
    userWrap.appendChild(u);
    adminLicenseSplitWireUserField(u, sugBox);
    const statusWrap = document.createElement('div');
    statusWrap.className = 'license-split-editor__status-wrap';
    const selGood = document.createElement('select');
    selGood.className = 'license-split-editor__status license-split-editor__status-good';
    selGood.title = 'Estado favorable (al día, renovación, etc.)';
    selGood.setAttribute('aria-label', 'Estado favorable de la licencia');
    ADMIN_LICENSE_STATUS_OPTIONS_GOOD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selGood.appendChild(o);
    });
    const sg = initialStatusGood != null ? String(initialStatusGood).trim() : '';
    adminLicenseSplitEnsureBuenaRevisadaOptionForSelect(selGood, sg);
    if (sg && !adminLicenseStatusIsKnownGoodOption(sg)) {
        const o = document.createElement('option');
        o.value = sg;
        o.textContent = sg;
        selGood.appendChild(o);
    }
    selGood.value = adminLicenseSplitCanonicalGoodFromStored(sg) || '';
    const selBad = document.createElement('select');
    selBad.className = 'license-split-editor__status license-split-editor__status-bad';
    selBad.title =
        'Incidencia o problema (caída, no reproduce, otro). Con «Otro», describa el detalle a la derecha.';
    selBad.setAttribute('aria-label', 'Estado de incidencia o problema');
    ADMIN_LICENSE_STATUS_OPTIONS_BAD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selBad.appendChild(o);
    });
    const sb = initialStatusBad != null ? String(initialStatusBad).trim() : '';
    if (sb && !adminLicenseStatusIsKnownBadOption(sb)) {
        const o = document.createElement('option');
        o.value = sb;
        o.textContent = sb;
        selBad.appendChild(o);
    }
    selBad.value = adminLicenseSplitCanonicalBadFromStored(sb) || '';
    const od = initialOtroDetail != null ? String(initialOtroDetail) : '';
    const otroCombined = document.createElement('input');
    otroCombined.type = 'text';
    otroCombined.className = 'license-split-editor__otro-combined';
    otroCombined.setAttribute('autocomplete', 'off');
    otroCombined.placeholder = 'des.. problema';
    otroCombined.title =
        'Describe el problema; se guarda con el estado «Otro» de la columna roja.';
    if (String(selBad.value || '').trim().toLowerCase() === 'otro') {
        otroCombined.value = od != null ? String(od) : '';
    } else {
        otroCombined.value = '';
    }
    otroCombined.hidden = true;
    otroCombined.style.display = 'none';
    const goodShell = document.createElement('div');
    goodShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--good';
    goodShell.appendChild(selGood);
    const badShell = document.createElement('div');
    badShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--bad';
    badShell.appendChild(selBad);
    statusWrap.appendChild(goodShell);
    statusWrap.appendChild(badShell);
    statusWrap.appendChild(otroCombined);
    const n = document.createElement('input');
    n.type = 'text';
    n.className = 'license-split-editor__note';
    n.setAttribute('autocomplete', 'off');
    n.setAttribute('aria-label', 'Notas de la licencia');
    n.placeholder = 'Notas';
    adminLicenseInitNoteField(n, row, initialExtra);
    const lead = document.createElement('div');
    lead.className = 'license-split-editor__lead';
    lead.appendChild(daySellCell);
    lead.appendChild(userWrap);
    row.appendChild(lead);
    row.appendChild(statusWrap);
    row.appendChild(n);
    adminLicenseSplitWireDualStatusNoteLink(selGood, selBad, n, otroCombined);
    return row;
}

function adminLicenseSplitClearRows() {
    const wrap = document.getElementById('adminLicenciasStructuredRows');
    if (wrap) wrap.innerHTML = '';
}

/** Etiquetas ARIA + id/name únicos (Chrome Issues: form fields need id or name). */
function adminLicenseSplitRefreshRowAccessibility() {
    const wrap = document.getElementById('adminLicenciasStructuredRows');
    if (!wrap) return;
    const rows = wrap.querySelectorAll('.license-split-editor__row');
    rows.forEach(function (row, i) {
        const line = i + 1;
        const idBase = 'licSplitL' + line;
        row.setAttribute('role', 'group');
        row.setAttribute(
            'aria-label',
            'Fila ' + line + ': día, vender, usuario, estados verde y rojo, y notas de la licencia'
        );
        const dayInpEl = row.querySelector('.license-split-editor__day-num');
        const sellB = row.querySelector('.license-split-editor__sell-btn');
        const u = row.querySelector('.license-split-editor__user');
        const selGood = row.querySelector('.license-split-editor__status-good');
        const selBad = row.querySelector('.license-split-editor__status-bad');
        const otroD = row.querySelector('.license-split-editor__otro-combined');
        const n = row.querySelector('.license-split-editor__note');
        if (dayInpEl) {
            const refNow = new Date();
            const maxL = adminLicenseDaysInCalendarMonth(refNow);
            adminLicenseSplitApplyDayNumInputLimits(dayInpEl, refNow);
            dayInpEl.value = String(adminLicenseSplitClampDayNumValue(dayInpEl.value, refNow));
            adminLicenseSplitWireDayNumInput(dayInpEl);
            dayInpEl.id = idBase + 'Day';
            dayInpEl.setAttribute('name', 'lic_split_l' + line + '_day');
            dayInpEl.setAttribute('aria-label', 'Día del mes (1–' + maxL + ') en la línea ' + line);
        }
        if (sellB) {
            sellB.id = idBase + 'Sell';
            sellB.setAttribute('aria-label', 'Pasar licencia de la línea ' + line + ' al día indicado');
        }
        if (u) {
            u.id = idBase + 'User';
            u.setAttribute('name', 'lic_split_l' + line + '_user');
            u.setAttribute('aria-label', 'Usuario o cliente en la línea ' + line + ' de licencias');
        }
        if (selGood) {
            selGood.id = idBase + 'StatusGood';
            selGood.setAttribute('name', 'lic_split_l' + line + '_status_good');
            selGood.setAttribute(
                'aria-label',
                'Estado favorable en la línea ' + line + ' (buena, renovación, mes a mes, no renovar)'
            );
        }
        if (selBad) {
            selBad.id = idBase + 'StatusBad';
            selBad.setAttribute('name', 'lic_split_l' + line + '_status_bad');
            selBad.setAttribute(
                'aria-label',
                'Estado de incidencia en la línea ' + line + ' (caída, no reproduce, otro)'
            );
        }
        if (otroD) {
            otroD.id = idBase + 'OtroCombined';
            otroD.setAttribute('name', 'lic_split_l' + line + '_otro_combined');
            otroD.setAttribute(
                'aria-label',
                'Descripción del problema (estado Otro) en la línea ' + line + ' de licencias'
            );
        }
        if (n) {
            n.id = idBase + 'Note';
            n.setAttribute('name', 'lic_split_l' + line + '_note');
            if (selBad) {
                adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n, line);
            } else {
                n.setAttribute('aria-label', 'Notas (línea ' + line + ')');
            }
        }
        if (selBad && otroD) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroD);
        }
        adminLicWarrantyApplyAttrsToStructuredRow(row, line - 1);
    });
}

function adminLicenseSplitSyncRowCount(credLineCount) {
    const wrap = document.getElementById('adminLicenciasStructuredRows');
    if (!wrap) return;
    let n = Math.max(0, parseInt(credLineCount, 10) || 0);
    while (wrap.children.length < n) {
        wrap.appendChild(adminLicenseSplitCreateRow('', '', '', '', undefined, undefined));
    }
    while (wrap.children.length > n) {
        wrap.removeChild(wrap.lastChild);
    }
    adminLicenseSplitRefreshRowAccessibility();
    if (
        !__markAdminDupInProgress &&
        document.documentElement.dataset.adminLicDupHighlightActive === '1' &&
        typeof window.scheduleRefreshAdminDupIfActive === 'function'
    ) {
        window.scheduleRefreshAdminDupIfActive();
    }
    scheduleRefreshAdminLicenciasReportCounts();
}

/** Si la línea de credencial (izquierda) queda vacía, limpia usuario, estado y notas de esa fila. */
function adminLicenseSplitClearRowSideFields(row) {
    if (!row) return;
    const dayInp = row.querySelector('.license-split-editor__day-num');
    if (dayInp) {
        const refNow = new Date();
        adminLicenseSplitApplyDayNumInputLimits(dayInp, refNow);
        dayInp.value = String(adminLicenseSplitDefaultDayOfMonth());
    }
    const u = row.querySelector('.license-split-editor__user');
    const selGood = row.querySelector('.license-split-editor__status-good');
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const otro = row.querySelector('.license-split-editor__otro-combined');
    const n = row.querySelector('.license-split-editor__note');
    const sug = row.querySelector('.license-split-editor__user-suggestions');
    if (u) {
        u.value = '';
        u.classList.remove('license-split-editor__user--unknown');
    }
    if (sug) {
        licenseSplitHideUserSuggestions(sug);
    }
    if (selGood) {
        selGood.value = '';
        delete selGood.dataset.otroDraft;
    }
    if (selBad) {
        selBad.value = '';
        delete selBad.dataset.otroDraft;
    }
    if (otro) {
        otro.value = '';
    }
    if (n) {
        n.value = '';
    }
    if (selBad && otro) {
        adminLicenseSplitSyncOtroDetailVisibility(selBad, otro);
        adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n);
    } else if (selBad && n) {
        adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n);
    }
}

function adminLicenseSplitCascadeClearSidesForEmptyCredLines() {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const rows = adminLicenseSplitGetRowElements();
    let anyCleared = false;
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() === '') {
            adminLicenseSplitClearRowSideFields(rows[i]);
            anyCleared = true;
        }
    }
    if (anyCleared) {
        adminLicenseSplitRefreshRowAccessibility();
    }
}

function adminLicenseSplitGetMergedNotes() {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta || ta.tagName !== 'TEXTAREA') return '';
    adminMainLicenseNormalizeCredTaTrailingRunsIfBlur(ta);
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = adminMainLicenseCredLinesCollapsed(raw);
    adminLicenseSplitSyncRowCount(adminMainLicenseBlocSyncRowCountFromCollapsed(credLines));
    adminLicenseSplitCascadeClearSidesForEmptyCredLines();
    const rows = adminLicenseSplitGetRowElements();
    const out = [];
    for (let i = 0; i < credLines.length; i++) {
        const r = rows[i]
            ? adminLicenseSplitReadRow(rows[i])
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        const line = buildAdminLicenseStorageLine(
            credLines[i],
            r.user,
            r.statusGood != null ? r.statusGood : '',
            r.statusBad != null ? r.statusBad : '',
            r.extra
        );
        out.push(line);
    }
    while (out.length && out[out.length - 1] === '') {
        out.pop();
    }
    return out.join('\n');
}

function adminLicenseSplitApplyMergedText(text) {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    const wrap = document.getElementById('adminLicenciasStructuredRows');
    if (!ta || !wrap) return;
    let t = text != null ? String(text).replace(/\r\n/g, '\n') : '';
    /** Misma idea que Cambios/Días: no crear 4–5 filas sólo por datos guardados como \n\n\n… sin contenido útil */
    let lines = [];
    if (t.trim() !== '') {
        lines = licenseCredLinesCollapseRepeatedTrailingBlankLines(t.split('\n'));
        while (lines.length && String(lines[lines.length - 1]).trim() === '') {
            lines.pop();
        }
    }
    adminLicenseSplitClearRows();
    const credParts = [];
    lines.forEach(function (ln) {
        const p = parseAdminLicenseLineToSplitParts(ln);
        credParts.push(p.cred);
        wrap.appendChild(
            adminLicenseSplitCreateRow(
                p.user,
                p.statusGood != null ? p.statusGood : '',
                p.statusBad != null ? p.statusBad : '',
                p.extra,
                p.otroDetail != null ? p.otroDetail : '',
                undefined
            )
        );
    });
    ta.value = credParts.join('\n');
    if (lines.length === 0) {
        ta.value = '';
    }
    adminLicenseSplitRefreshRowAccessibility();
    adminLicenseSplitSyncRowsToTextarea();
    window.requestAnimationFrame(function () {
        adminLicenseSplitScheduleAutosizeCreds();
        const licRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
        adminLicenseSplitValidateAllUserInputs(licRoot || undefined);
        scheduleRefreshAdminLicenciasReportCounts();
    });
}

/**
 * Quita la fila del bloc Licencias, guarda notas y añade la línea al bloc del día indicado (sync cuentas vendidas).
 * @param {object} [opts] - opts.quiet: no mostrar toast de éxito; opts.suppressScroll: no hacer scroll al día
 * @returns {Promise<boolean>}
 */
async function adminLicenseSplitSellRowToDay(row, opts) {
    const quiet = opts && opts.quiet;
    const suppressScroll = opts && opts.suppressScroll;
    if (!row || window.__adminLicenseSplitSellInFlight) {
        return false;
    }
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta || ta.tagName !== 'TEXTAREA') {
        return false;
    }
    const licenseId = parseInt(ta.dataset.licenseId, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona una licencia concreta (no «Todos») para pasar cuentas al día.');
        return false;
    }
    const rows = adminLicenseSplitGetRowElements();
    const idx = rows.indexOf(row);
    if (idx < 0) {
        return false;
    }
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) {
        return false;
    }
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return false;
    }
    const r = adminLicenseSplitReadRow(row);
    const lineToMove = buildAdminLicenseStorageLine(
        cred,
        r.user,
        r.statusGood != null ? r.statusGood : '',
        r.statusBad != null ? r.statusBad : '',
        r.extra
    ).trim();
    if (!lineToMove) {
        showError('No hay datos válidos para mover.');
        return false;
    }
    const dayInp = row.querySelector('.license-split-editor__day-num');
    const refNow = new Date();
    let day = dayInp ? parseInt(dayInp.value, 10) : NaN;
    if (!Number.isFinite(day)) day = adminLicenseSplitDefaultDayOfMonth();
    day = adminLicenseSplitClampDayNumValue(day, refNow);
    if (dayInp) {
        adminLicenseSplitApplyDayNumInputLimits(dayInp, refNow);
        dayInp.value = String(day);
    }

    const container = document.getElementById('licenseAllDaysContainer');
    const dayRoot =
        container &&
        container.querySelector(`.day-license-split-root[data-day="${day}"][data-license-id="${licenseId}"]`);
    if (!dayRoot) {
        showError('No se encontró el bloc del día ' + day + '.');
        return false;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                rr.user,
                rr.statusGood != null ? rr.statusGood : '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newMerged = newMergedLines.join('\n');
    const oldMerged = adminLicenseSplitGetMergedNotes();

    window.__adminLicenseSplitSellInFlight = true;
    try {
        adminLicenseSplitApplyMergedText(newMerged);
        const saveRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveRes || !saveRes.success) {
            adminLicenseSplitApplyMergedText(oldMerged);
            showError('No se pudo guardar el bloc Licencias. Revisa la conexión o vuelve a intentar.');
            return false;
        }

        const rawDay = dayLicenseSplitGetMergedText(dayRoot);
        const dayPrev = String(rawDay != null ? rawDay : '').replace(/\r\n/g, '\n').trimEnd();
        const combined = dayPrev ? dayPrev + '\n' + lineToMove : lineToMove;
        dayLicenseSplitApplyMergedText(dayRoot, combined);
        const finalText = dayLicenseSplitGetMergedText(dayRoot);
        saveDayDraftLocal(licenseId, day, finalText);
        await syncDayNotepad(licenseId, day, finalText);
        let sellDebtNote = '';
        const skipDebtCharge = !!(opts && opts.skipDebtCharge);
        if (!skipDebtCharge && adminLicenseBillingUsernameChargeable(r.user)) {
            const debtSell = await adminLicenseBulkRegisterDeliveryDebt(1, r.user);
            if (debtSell && debtSell.charged && debtSell.delta != null && Number(debtSell.delta) > 0) {
                const dnum = Number(debtSell.delta);
                const dn =
                    Math.abs(dnum - Math.round(dnum)) < 1e-9
                        ? String(Math.round(dnum))
                        : String(Number(dnum.toFixed(2)));
                sellDebtNote = ' Cobro cuenta +' + dn + '.';
            } else if (debtSell && debtSell.error) {
                sellDebtNote = ' · ' + debtSell.error;
            }
        }
        if (!quiet) {
            showSuccess('Licencia pasada al día ' + day + '.' + sellDebtNote);
        }
        if (!suppressScroll) {
            const section = dayRoot.closest('.day-section');
            if (section && typeof section.scrollIntoView === 'function') {
                section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        return true;
    } catch (err) {
        console.error('adminLicenseSplitSellRowToDay', err);
        adminLicenseSplitApplyMergedText(oldMerged);
        if (typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function') {
            await window.adminLicenciasSaveCurrentLicenseNotesImmediate();
        }
        showError('No se pudo completar la venta al día. Se restauró la fila en Licencias.');
        return false;
    } finally {
        window.__adminLicenseSplitSellInFlight = false;
    }
}

window.adminLicenseSplitSellRowToDay = adminLicenseSplitSellRowToDay;

/* --- Split por día (mismo modelo que Licencias; flecha arriba devuelve al bloc principal) --- */

function dayLicenseSplitQueryCredsTa(root) {
    return root && root.querySelector ? root.querySelector('.day-license-split__creds') : null;
}

function dayLicenseSplitQueryRowsWrap(root) {
    return root && root.querySelector ? root.querySelector('.day-license-split-rows') : null;
}

function dayLicenseSplitGetRowElements(root) {
    const wrap = dayLicenseSplitQueryRowsWrap(root);
    if (!wrap) return [];
    return Array.prototype.slice.call(wrap.querySelectorAll('.license-split-editor__row'));
}

function dayLicenseSplitClearRows(root) {
    const wrap = dayLicenseSplitQueryRowsWrap(root);
    if (wrap) wrap.innerHTML = '';
}

function dayLicenseSplitCreateRow(
    initialUser,
    initialStatusGood,
    initialStatusBad,
    initialExtra,
    initialOtroDetail
) {
    const row = document.createElement('div');
    row.className = 'license-split-editor__row';
    const restoreCell = document.createElement('div');
    restoreCell.className = 'license-split-editor__day-restore-cell';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'license-split-editor__restore-to-license-btn';
    restoreBtn.title = 'Devolver esta licencia al bloc Licencias';
    restoreBtn.setAttribute('aria-label', 'Devolver licencia al bloc Licencias');
    restoreBtn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    restoreCell.appendChild(restoreBtn);
    const userWrap = document.createElement('div');
    userWrap.className = 'license-split-editor__user-wrap';
    const sugBox = document.createElement('div');
    sugBox.className = 'license-split-editor__user-suggestions';
    sugBox.hidden = true;
    sugBox.setAttribute('aria-hidden', 'true');
    sugBox.setAttribute('role', 'group');
    sugBox.setAttribute('aria-label', 'Sugerencias de usuario');
    const u = document.createElement('input');
    u.type = 'text';
    u.className = 'license-split-editor__user';
    u.setAttribute('autocomplete', 'off');
    u.setAttribute('aria-label', 'Usuario o cliente de la licencia');
    u.placeholder = 'anonimo';
    u.value = initialUser != null ? initialUser : '';
    userWrap.appendChild(sugBox);
    userWrap.appendChild(u);
    adminLicenseSplitWireUserField(u, sugBox);
    const statusWrap = document.createElement('div');
    statusWrap.className = 'license-split-editor__status-wrap';
    const selGood = document.createElement('select');
    selGood.className = 'license-split-editor__status license-split-editor__status-good';
    selGood.title = 'Estado favorable (al día, renovación, etc.)';
    selGood.setAttribute('aria-label', 'Estado favorable de la licencia');
    ADMIN_LICENSE_STATUS_OPTIONS_GOOD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selGood.appendChild(o);
    });
    const sg = initialStatusGood != null ? String(initialStatusGood).trim() : '';
    adminLicenseSplitEnsureBuenaRevisadaOptionForSelect(selGood, sg);
    if (sg && !adminLicenseStatusIsKnownGoodOption(sg)) {
        const o = document.createElement('option');
        o.value = sg;
        o.textContent = sg;
        selGood.appendChild(o);
    }
    selGood.value = adminLicenseSplitCanonicalGoodFromStored(sg) || '';
    const selBad = document.createElement('select');
    selBad.className = 'license-split-editor__status license-split-editor__status-bad';
    selBad.title =
        'Incidencia o problema (caída, no reproduce, otro). Con «Otro», describa el detalle a la derecha.';
    selBad.setAttribute('aria-label', 'Estado de incidencia o problema');
    ADMIN_LICENSE_STATUS_OPTIONS_BAD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selBad.appendChild(o);
    });
    const sb = initialStatusBad != null ? String(initialStatusBad).trim() : '';
    if (sb && !adminLicenseStatusIsKnownBadOption(sb)) {
        const o = document.createElement('option');
        o.value = sb;
        o.textContent = sb;
        selBad.appendChild(o);
    }
    selBad.value = adminLicenseSplitCanonicalBadFromStored(sb) || '';
    const od = initialOtroDetail != null ? String(initialOtroDetail) : '';
    const otroCombined = document.createElement('input');
    otroCombined.type = 'text';
    otroCombined.className = 'license-split-editor__otro-combined';
    otroCombined.setAttribute('autocomplete', 'off');
    otroCombined.placeholder = 'des.. problema';
    otroCombined.title =
        'Describe el problema; se guarda con el estado «Otro» de la columna roja.';
    if (String(selBad.value || '').trim().toLowerCase() === 'otro') {
        otroCombined.value = od != null ? String(od) : '';
    } else {
        otroCombined.value = '';
    }
    otroCombined.hidden = true;
    otroCombined.style.display = 'none';
    const goodShell = document.createElement('div');
    goodShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--good';
    goodShell.appendChild(selGood);
    const badShell = document.createElement('div');
    badShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--bad';
    badShell.appendChild(selBad);
    statusWrap.appendChild(goodShell);
    statusWrap.appendChild(badShell);
    statusWrap.appendChild(otroCombined);
    const n = document.createElement('input');
    n.type = 'text';
    n.className = 'license-split-editor__note';
    n.setAttribute('autocomplete', 'off');
    n.setAttribute('aria-label', 'Notas de la licencia');
    n.placeholder = 'Notas';
    adminLicenseInitNoteField(n, row, initialExtra);
    const lead = document.createElement('div');
    lead.className = 'license-split-editor__lead';
    lead.appendChild(restoreCell);
    lead.appendChild(userWrap);
    row.appendChild(lead);
    row.appendChild(statusWrap);
    row.appendChild(n);
    adminLicenseSplitWireDualStatusNoteLink(selGood, selBad, n, otroCombined);
    return row;
}

function dayLicenseSplitRefreshRowAccessibility(root) {
    const wrap = dayLicenseSplitQueryRowsWrap(root);
    if (!wrap || !root.dataset) return;
    const dayNum = root.dataset.day || '?';
    const rows = wrap.querySelectorAll('.license-split-editor__row');
    rows.forEach(function (row, i) {
        const line = i + 1;
        const idBase = 'daySplitD' + dayNum + 'L' + line;
        row.setAttribute('role', 'group');
        row.setAttribute(
            'aria-label',
            'Día ' + dayNum + ', fila ' + line + ': devolver, usuario, estados verde y rojo, y notas'
        );
        const restoreB = row.querySelector('.license-split-editor__restore-to-license-btn');
        const u = row.querySelector('.license-split-editor__user');
        const selGood = row.querySelector('.license-split-editor__status-good');
        const selBad = row.querySelector('.license-split-editor__status-bad');
        const otroD = row.querySelector('.license-split-editor__otro-combined');
        const n = row.querySelector('.license-split-editor__note');
        if (restoreB) {
            restoreB.id = idBase + 'Restore';
            restoreB.setAttribute('aria-label', 'Devolver licencia de la fila ' + line + ' al bloc Licencias');
        }
        if (u) {
            u.id = idBase + 'User';
            u.setAttribute('name', 'day_split_d' + dayNum + '_l' + line + '_user');
            u.setAttribute('aria-label', 'Usuario o cliente (día ' + dayNum + ', línea ' + line + ')');
        }
        if (selGood) {
            selGood.id = idBase + 'StatusGood';
            selGood.setAttribute('name', 'day_split_d' + dayNum + '_l' + line + '_status_good');
            selGood.setAttribute(
                'aria-label',
                'Estado favorable (día ' + dayNum + ', línea ' + line + ')'
            );
        }
        if (selBad) {
            selBad.id = idBase + 'StatusBad';
            selBad.setAttribute('name', 'day_split_d' + dayNum + '_l' + line + '_status_bad');
            selBad.setAttribute(
                'aria-label',
                'Estado de incidencia (día ' + dayNum + ', línea ' + line + ')'
            );
        }
        if (otroD) {
            otroD.id = idBase + 'OtroCombined';
            otroD.setAttribute('name', 'day_split_d' + dayNum + '_l' + line + '_otro_combined');
            otroD.setAttribute('aria-label', 'Descripción del problema Otro (día ' + dayNum + ', línea ' + line + ')');
        }
        if (n) {
            n.id = idBase + 'Note';
            n.setAttribute('name', 'day_split_d' + dayNum + '_l' + line + '_note');
            if (selBad) {
                adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n, line);
            } else {
                n.setAttribute('aria-label', 'Notas (día ' + dayNum + ', línea ' + line + ')');
            }
        }
        if (selBad && otroD) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroD);
        }
        adminLicWarrantyApplyAttrsToDayRow(row, root, line - 1);
    });
}

function dayLicenseSplitSyncRowCount(root, credLineCount) {
    const wrap = dayLicenseSplitQueryRowsWrap(root);
    if (!wrap) return;
    let n = Math.max(0, parseInt(credLineCount, 10) || 0);
    while (wrap.children.length < n) {
        wrap.appendChild(dayLicenseSplitCreateRow('', '', '', '', undefined));
    }
    while (wrap.children.length > n) {
        wrap.removeChild(wrap.lastChild);
    }
    dayLicenseSplitRefreshRowAccessibility(root);
    if (
        !__markAdminDupInProgress &&
        document.documentElement.dataset.adminLicDupHighlightActive === '1' &&
        typeof window.scheduleRefreshAdminDupIfActive === 'function'
    ) {
        window.scheduleRefreshAdminDupIfActive();
    }
    scheduleRefreshAdminLicenciasReportCounts();
}

function dayLicenseSplitClearRowSideFields(row) {
    if (!row) return;
    const u = row.querySelector('.license-split-editor__user');
    const selGood = row.querySelector('.license-split-editor__status-good');
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const otro = row.querySelector('.license-split-editor__otro-combined');
    const n = row.querySelector('.license-split-editor__note');
    const sug = row.querySelector('.license-split-editor__user-suggestions');
    if (u) {
        u.value = '';
        u.classList.remove('license-split-editor__user--unknown');
    }
    if (sug) {
        licenseSplitHideUserSuggestions(sug);
    }
    if (selGood) {
        selGood.value = '';
        delete selGood.dataset.otroDraft;
    }
    if (selBad) {
        selBad.value = '';
        delete selBad.dataset.otroDraft;
    }
    if (otro) {
        otro.value = '';
    }
    if (n) {
        n.value = '';
    }
    if (selBad && otro) {
        adminLicenseSplitSyncOtroDetailVisibility(selBad, otro);
        adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n);
    } else if (selBad && n) {
        adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n);
    }
}

function dayLicenseSplitCascadeClearSidesForEmptyCredLines(root) {
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const rows = dayLicenseSplitGetRowElements(root);
    let anyCleared = false;
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() === '') {
            dayLicenseSplitClearRowSideFields(rows[i]);
            anyCleared = true;
        }
    }
    if (anyCleared) {
        dayLicenseSplitRefreshRowAccessibility(root);
    }
}

function dayLicenseSplitGetMergedText(root) {
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta || ta.tagName !== 'TEXTAREA') return '';
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    dayLicenseSplitSyncRowCount(root, credLines.length);
    dayLicenseSplitCascadeClearSidesForEmptyCredLines(root);
    const rows = dayLicenseSplitGetRowElements(root);
    const out = [];
    for (let i = 0; i < credLines.length; i++) {
        const r = rows[i]
            ? adminLicenseSplitReadRow(rows[i])
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        const line = buildAdminLicenseStorageLine(
            credLines[i],
            r.user,
            r.statusGood != null ? r.statusGood : '',
            r.statusBad != null ? r.statusBad : '',
            r.extra
        );
        out.push(line);
    }
    while (out.length && out[out.length - 1] === '') {
        out.pop();
    }
    return out.join('\n');
}

function dayLicenseSplitApplyMergedText(root, text) {
    const ta = dayLicenseSplitQueryCredsTa(root);
    const wrap = dayLicenseSplitQueryRowsWrap(root);
    if (!ta || !wrap) return;
    const t = text != null ? String(text).replace(/\r\n/g, '\n') : '';
    const lines = t === '' ? [] : t.split('\n');
    dayLicenseSplitClearRows(root);
    const credParts = [];
    lines.forEach(function (ln) {
        const p = parseAdminLicenseLineToSplitParts(ln);
        credParts.push(p.cred);
        wrap.appendChild(
            dayLicenseSplitCreateRow(
                p.user,
                p.statusGood != null ? p.statusGood : '',
                p.statusBad != null ? p.statusBad : '',
                p.extra,
                p.otroDetail != null ? p.otroDetail : ''
            )
        );
    });
    ta.value = credParts.join('\n');
    if (lines.length === 0) {
        ta.value = '';
    }
    dayLicenseSplitRefreshRowAccessibility(root);
    window.requestAnimationFrame(function () {
        dayLicenseSplitScheduleAutosize(root);
        adminLicenseSplitValidateAllUserInputs(root);
        scheduleRefreshAdminLicenciasReportCounts();
    });
}

function dayLicenseSplitSyncRowsToTextarea(root) {
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    dayLicenseSplitSyncRowCount(root, credLines.length);
    dayLicenseSplitCascadeClearSidesForEmptyCredLines(root);
    dayLicenseSplitScheduleAutosize(root);
}

var __daySplitAutosizeTimers = {};

function dayLicenseSplitScheduleAutosize(root) {
    if (!root || !root.dataset) return;
    const k = root.dataset.day || '';
    dayLicenseSplitAutosizeCreds(root);
    clearTimeout(__daySplitAutosizeTimers[k]);
    __daySplitAutosizeTimers[k] = setTimeout(function () {
        dayLicenseSplitAutosizeCreds(root);
        clearTimeout(__daySplitAutosizeTimers[k]);
        __daySplitAutosizeTimers[k] = setTimeout(function () {
            dayLicenseSplitAutosizeCreds(root);
        }, 60);
    }, 30);
}

/**
 * Sin wrap: si el contenido cabe en la columna 1fr, el textarea usa 100% (llena el espacio).
 * Solo si una línea es más ancha que el hueco disponible se fija ancho en px y crece la grilla (scroll horizontal).
 */
function licenseSplitSyncCredsTaContentWidth(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;

    /* Asegurar que el textarea no haga wrap nativo para poder medir el ancho real del texto */
    if (ta.getAttribute('wrap') !== 'off') {
        ta.setAttribute('wrap', 'off');
    }

    ta.style.removeProperty('width');
    ta.style.removeProperty('min-width');
    void ta.offsetWidth;

    const cs = window.getComputedStyle(ta);
    const minWcss = parseFloat(cs.minWidth);
    const minPx = Number.isFinite(minWcss) && minWcss > 0 ? minWcss : 320;

    const avail = Math.max(minPx, ta.clientWidth);
    
    // Usar Canvas para medir el texto con precisión milimétrica sin depender del DOM/scrollWidth
    const font = (cs.fontWeight || 'normal') + ' ' + (cs.fontSize || '14px') + ' ' + (cs.fontFamily || 'sans-serif');
    const lines = (ta.value || '').split('\n');
    let maxTextW = 0;
    
    const canvas = licenseSplitSyncCredsTaContentWidth.canvas || (licenseSplitSyncCredsTaContentWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    
    for (let i = 0; i < lines.length; i++) {
        const w = context.measureText(lines[i]).width;
        if (w > maxTextW) maxTextW = w;
    }
    
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const borderX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const contentW = maxTextW + padX + borderX + 16; // 16px de margen para el cursor

    const need = Math.ceil(Math.max(minPx, contentW));

    if (need <= avail + 1) {
        ta.style.removeProperty('width');
        ta.style.removeProperty('min-width');
    } else {
        ta.style.setProperty('width', need + 'px', 'important');
        ta.style.setProperty('min-width', need + 'px', 'important');
    }
}

function dayLicenseSplitAutosizeCreds(root) {
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const hadFocus = document.activeElement === ta;
    const prevScrollTop = ta.scrollTop;
    const sel0 = ta.selectionStart;
    const sel1 = ta.selectionEnd;
    const valLenBefore = String(ta.value != null ? ta.value : '').length;

    const splitSide = root.querySelector('.license-split-editor__side');
    const rowsEl = dayLicenseSplitQueryRowsWrap(root);
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    dayLicenseSplitSyncRowCount(root, credLines.length);
    dayLicenseSplitCascadeClearSidesForEmptyCredLines(root);

    let hPx;
    if (splitSide && splitSide.hidden) {
        ta.style.minHeight = '0';
        ta.style.height = '0px';
        const ns = ta.scrollHeight;
        ta.style.minHeight = '';
        ta.style.height = '';
        const cs = window.getComputedStyle(ta);
        let minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = 20;
        hPx = Math.max(minPx, ns + 2);
    } else {
        if (rowsEl) {
            void rowsEl.offsetHeight;
        }

        const cs0 = window.getComputedStyle(ta);
        const linePx = adminLicSplitParseLineHeightPx(cs0);
        const padY = (parseFloat(cs0.paddingTop) || 0) + (parseFloat(cs0.paddingBottom) || 0);
        const estimateByLines = linePx * credLines.length + padY;

        ta.style.minHeight = '0';
        ta.style.height = '0px';
        const naturalScroll = ta.scrollHeight;
        ta.style.minHeight = '';
        ta.style.height = '';

        const cs = window.getComputedStyle(ta);
        let minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = 20;
        const contentH = Math.max(naturalScroll + 2, estimateByLines);
        /* Días: no igualar altura con la columna derecha (evita textarea/flex estirado y hueco negro). */
        hPx = Math.max(minPx, contentH);
    }

    ta.style.height = Math.ceil(hPx) + 'px';
    licenseSplitSyncCredsTaContentWidth(ta);

    /* Medir con height:0px resetea scrollTop en muchos navegadores; restaurar para que Enter no “suba” el bloc. */
    const restoreScrollAndCaret = function () {
        if (!ta.isConnected) return;
        const maxTop = Math.max(0, ta.scrollHeight - ta.clientHeight);
        const caretAtEnd = hadFocus && sel0 === sel1 && sel0 != null && sel0 >= valLenBefore;
        if (caretAtEnd) {
            ta.scrollTop = maxTop;
        } else {
            ta.scrollTop = Math.min(Math.max(0, prevScrollTop), maxTop);
        }
        if (hadFocus && document.activeElement === ta && typeof ta.setSelectionRange === 'function') {
            try {
                const len = ta.value.length;
                const a = Math.min(Math.max(0, sel0 != null ? sel0 : len), len);
                const b = Math.min(Math.max(0, sel1 != null ? sel1 : len), len);
                ta.setSelectionRange(a, b);
            } catch (err) {
                /* ignore */
            }
        }
    };
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(restoreScrollAndCaret);
    } else {
        restoreScrollAndCaret();
    }
}

function dayLicenseSplitLock(root) {
    if (!root) return;
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (ta) {
        ta.readOnly = true;
        ta.setAttribute('tabindex', '-1');
    }
    root.classList.add('license-notepad--locked');
    root.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.disabled = false;
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

function dayLicenseSplitUnlock(root) {
    if (!root) return;
    const ta = dayLicenseSplitQueryCredsTa(root);
    if (ta) {
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

function dayLicenseSplitWireScrollSync(root) {
    const ta = dayLicenseSplitQueryCredsTa(root);
    const rows = dayLicenseSplitQueryRowsWrap(root);
    if (!ta || !rows || rows.dataset.dayLicScrollSync === '1') return;
    rows.dataset.dayLicScrollSync = '1';
    let syncing = false;
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

/* --- Caídas / suspendidas: flecha arriba, solo estado rojo (+ otro), notas (sin usuario ni verde) --- */

function suspendedLicenseSplitQueryRoot() {
    return document.getElementById('adminLicenciasSuspendedSplitRoot');
}

function suspendedLicenseSplitQueryCredsTa(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    return r && r.querySelector ? r.querySelector('.suspended-license-split__creds') : null;
}

function suspendedLicenseSplitQueryRowsWrap(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    return r && r.querySelector ? r.querySelector('.suspended-license-split-rows') : null;
}

function suspendedLicenseSplitGetRowElements(root) {
    const wrap = suspendedLicenseSplitQueryRowsWrap(root);
    if (!wrap) return [];
    return Array.prototype.slice.call(wrap.querySelectorAll('.license-split-editor__row'));
}

function suspendedLicenseSplitClearRows(root) {
    const wrap = suspendedLicenseSplitQueryRowsWrap(root);
    if (wrap) wrap.innerHTML = '';
}

function suspendedLicenseSplitCreateRow(initialExtra, initialStatusBad, initialOtroDetail) {
    const row = document.createElement('div');
    row.className = 'license-split-editor__row license-split-editor__row--suspended';
    const restoreCell = document.createElement('div');
    restoreCell.className = 'license-split-editor__day-restore-cell';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'license-split-editor__restore-to-license-btn';
    restoreBtn.title = 'Devolver esta licencia al bloc Licencias';
    restoreBtn.setAttribute('aria-label', 'Devolver licencia al bloc Licencias');
    restoreBtn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    restoreCell.appendChild(restoreBtn);
    const statusWrap = document.createElement('div');
    statusWrap.className = 'license-split-editor__status-wrap';
    const selBad = document.createElement('select');
    selBad.className = 'license-split-editor__status license-split-editor__status-bad';
    selBad.title =
        'Incidencia o problema (caída, no reproduce, otro). Con «Otro», describa el detalle a la derecha.';
    selBad.setAttribute('aria-label', 'Estado de incidencia (cuenta caída o suspendida)');
    ADMIN_LICENSE_STATUS_OPTIONS_BAD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selBad.appendChild(o);
    });
    const sb = initialStatusBad != null ? String(initialStatusBad).trim() : '';
    if (sb && !adminLicenseStatusIsKnownBadOption(sb)) {
        const o = document.createElement('option');
        o.value = sb;
        o.textContent = sb;
        selBad.appendChild(o);
    }
    selBad.value = adminLicenseSplitCanonicalBadFromStored(sb) || '';
    const od = initialOtroDetail != null ? String(initialOtroDetail) : '';
    const otroCombined = document.createElement('input');
    otroCombined.type = 'text';
    otroCombined.className = 'license-split-editor__otro-combined';
    otroCombined.setAttribute('autocomplete', 'off');
    otroCombined.placeholder = 'des.. problema';
    otroCombined.title =
        'Describe el problema; se guarda con el estado «Otro» de la columna roja.';
    if (String(selBad.value || '').trim().toLowerCase() === 'otro') {
        otroCombined.value = od != null ? String(od) : '';
    } else {
        otroCombined.value = '';
    }
    otroCombined.hidden = true;
    otroCombined.style.display = 'none';
    const badShell = document.createElement('div');
    badShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--bad';
    badShell.appendChild(selBad);
    statusWrap.appendChild(badShell);
    statusWrap.appendChild(otroCombined);
    const n = document.createElement('input');
    n.type = 'text';
    n.className = 'license-split-editor__note';
    n.setAttribute('autocomplete', 'off');
    n.setAttribute('aria-label', 'Notas de la licencia');
    n.placeholder = 'Notas';
    adminLicenseInitNoteField(n, row, initialExtra);
    const lead = document.createElement('div');
    lead.className = 'license-split-editor__lead';
    lead.appendChild(restoreCell);
    row.appendChild(lead);
    row.appendChild(statusWrap);
    row.appendChild(n);
    adminLicenseSplitWireBadOnlyStatusNoteLink(selBad, n, otroCombined);
    return row;
}

function suspendedLicenseSplitRefreshRowAccessibility(root) {
    const wrap = suspendedLicenseSplitQueryRowsWrap(root);
    if (!wrap || !root || !root.dataset) return;
    const rows = wrap.querySelectorAll('.license-split-editor__row');
    rows.forEach(function (row, i) {
        const line = i + 1;
        const idBase = 'suspSplitL' + line;
        row.setAttribute('role', 'group');
        row.setAttribute(
            'aria-label',
            'Caídas, fila ' + line + ': devolver a Licencias, estado rojo y notas'
        );
        const restoreB = row.querySelector('.license-split-editor__restore-to-license-btn');
        const selBad = row.querySelector('.license-split-editor__status-bad');
        const otroD = row.querySelector('.license-split-editor__otro-combined');
        const n = row.querySelector('.license-split-editor__note');
        if (restoreB) {
            restoreB.id = idBase + 'Restore';
            restoreB.setAttribute('aria-label', 'Devolver fila ' + line + ' al bloc Licencias');
        }
        if (selBad) {
            selBad.id = idBase + 'StatusBad';
            selBad.setAttribute('name', 'susp_split_l' + line + '_status_bad');
            selBad.setAttribute(
                'aria-label',
                'Estado de incidencia en caídas (línea ' + line + ')'
            );
        }
        if (otroD) {
            otroD.id = idBase + 'OtroCombined';
            otroD.setAttribute('name', 'susp_split_l' + line + '_otro_combined');
            otroD.setAttribute(
                'aria-label',
                'Detalle «Otro» en caídas (línea ' + line + ')'
            );
        }
        if (n) {
            n.id = idBase + 'Note';
            n.setAttribute('name', 'susp_split_l' + line + '_note');
            if (selBad) {
                adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n, line);
            } else {
                n.setAttribute('aria-label', 'Notas (caídas, línea ' + line + ')');
            }
        }
        if (selBad && otroD) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroD);
        }
    });
}

function suspendedLicenseSplitSyncRowCount(root, credLineCount) {
    const wrap = suspendedLicenseSplitQueryRowsWrap(root);
    if (!wrap) return;
    let n = Math.max(0, parseInt(credLineCount, 10) || 0);
    while (wrap.children.length < n) {
        wrap.appendChild(suspendedLicenseSplitCreateRow('', '', undefined));
    }
    while (wrap.children.length > n) {
        wrap.removeChild(wrap.lastChild);
    }
    suspendedLicenseSplitRefreshRowAccessibility(root);
    if (
        !__markAdminDupInProgress &&
        document.documentElement.dataset.adminLicDupHighlightActive === '1' &&
        typeof window.scheduleRefreshAdminDupIfActive === 'function'
    ) {
        window.scheduleRefreshAdminDupIfActive();
    }
}

function suspendedLicenseSplitCascadeClearSidesForEmptyCredLines(root) {
    const ta = suspendedLicenseSplitQueryCredsTa(root);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const rows = suspendedLicenseSplitGetRowElements(root);
    let anyCleared = false;
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() === '') {
            dayLicenseSplitClearRowSideFields(rows[i]);
            anyCleared = true;
        }
    }
    if (anyCleared) {
        suspendedLicenseSplitRefreshRowAccessibility(root);
    }
}

function suspendedLicenseSplitGetMergedText(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    if (!ta || ta.tagName !== 'TEXTAREA') return '';
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    suspendedLicenseSplitSyncRowCount(r, credLines.length);
    suspendedLicenseSplitCascadeClearSidesForEmptyCredLines(r);
    const rows = suspendedLicenseSplitGetRowElements(r);
    const out = [];
    for (let i = 0; i < credLines.length; i++) {
        const rr = rows[i]
            ? adminLicenseSplitReadRow(rows[i])
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        const line = buildAdminLicenseStorageLine(
            credLines[i],
            '',
            '',
            rr.statusBad != null ? rr.statusBad : '',
            rr.extra
        );
        out.push(line);
    }
    while (out.length && out[out.length - 1] === '') {
        out.pop();
    }
    return out.join('\n');
}

function suspendedLicenseSplitApplyMergedText(root, text) {
    const r = root || suspendedLicenseSplitQueryRoot();
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    const wrap = suspendedLicenseSplitQueryRowsWrap(r);
    if (!ta || !wrap) return;
    const t = text != null ? String(text).replace(/\r\n/g, '\n') : '';
    const lines = t === '' ? [] : t.split('\n');
    suspendedLicenseSplitClearRows(r);
    const credParts = [];
    lines.forEach(function (ln) {
        const p = parseAdminLicenseLineToSplitParts(ln);
        credParts.push(p.cred);
        let note = (p.extra != null ? String(p.extra) : '').trim();
        const u = (p.user != null ? String(p.user).trim() : '');
        if (u && u.toLowerCase() !== 'anonimo') {
            note = note ? u + ' — ' + note : u;
        }
        const sg = (p.statusGood != null ? String(p.statusGood) : '').trim();
        const sb = (p.statusBad != null ? String(p.statusBad) : '').trim();
        if (sg && !sb) {
            note = note ? note + ' · ' + sg : sg;
        }
        wrap.appendChild(
            suspendedLicenseSplitCreateRow(
                note,
                sb,
                p.otroDetail != null ? p.otroDetail : ''
            )
        );
    });
    ta.value = credParts.join('\n');
    if (lines.length === 0) {
        ta.value = '';
    }
    suspendedLicenseSplitRefreshRowAccessibility(r);
    window.requestAnimationFrame(function () {
        suspendedLicenseSplitScheduleAutosize(r);
        adminLicenseSplitValidateAllUserInputs(r);
    });
}

function suspendedLicenseSplitSyncRowsToTextarea(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    if (!ta) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    suspendedLicenseSplitSyncRowCount(r, credLines.length);
    suspendedLicenseSplitCascadeClearSidesForEmptyCredLines(r);
    suspendedLicenseSplitScheduleAutosize(r);
}

var __suspSplitAutosizeTimers = {};

function suspendedLicenseSplitScheduleAutosize(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    if (!r) return;
    suspendedLicenseSplitAutosizeCreds(r);
    clearTimeout(__suspSplitAutosizeTimers._k);
    __suspSplitAutosizeTimers._k = setTimeout(function () {
        suspendedLicenseSplitAutosizeCreds(r);
        clearTimeout(__suspSplitAutosizeTimers._k2);
        __suspSplitAutosizeTimers._k2 = setTimeout(function () {
            suspendedLicenseSplitAutosizeCreds(r);
        }, 60);
    }, 30);
}

function suspendedLicenseSplitAutosizeCreds(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const splitSide = r.querySelector('.license-split-editor__side');
    const rowsEl = suspendedLicenseSplitQueryRowsWrap(r);
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    suspendedLicenseSplitSyncRowCount(r, credLines.length);
    suspendedLicenseSplitCascadeClearSidesForEmptyCredLines(r);

    if (splitSide && splitSide.hidden) {
        ta.style.minHeight = '0';
        ta.style.height = '0px';
        const ns = ta.scrollHeight;
        ta.style.minHeight = '';
        ta.style.height = '';
        const cs = window.getComputedStyle(ta);
        let minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = 20; // Adaptable, sin mínimo fijo de 112px
        ta.style.height = Math.max(minPx, ns + 2) + 'px';
        licenseSplitSyncCredsTaContentWidth(ta);
        return;
    }

    if (rowsEl) {
        void rowsEl.offsetHeight;
    }

    const cs0 = window.getComputedStyle(ta);
    const linePx = adminLicSplitParseLineHeightPx(cs0);
    const padY = (parseFloat(cs0.paddingTop) || 0) + (parseFloat(cs0.paddingBottom) || 0);
    const estimateByLines = linePx * credLines.length + padY;

    ta.style.minHeight = '0';
    ta.style.height = '0px';
    const naturalScroll = ta.scrollHeight;
    ta.style.minHeight = '';
    ta.style.height = '';

    const cs = window.getComputedStyle(ta);
    let minPx = parseFloat(cs.minHeight);
    if (Number.isNaN(minPx)) minPx = 20; // Adaptable, sin mínimo fijo de 112px
    const contentH = Math.max(naturalScroll + 2, estimateByLines);
    const h = Math.max(minPx, contentH);
    ta.style.height = Math.ceil(h) + 'px';
    licenseSplitSyncCredsTaContentWidth(ta);
}

function suspendedLicenseSplitLock(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    if (!r) return;
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    if (ta) {
        ta.readOnly = true;
        ta.setAttribute('tabindex', '-1');
    }
    r.classList.add('license-notepad--locked');
    r.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.disabled = false;
        x.readOnly = true;
        x.tabIndex = -1;
    });
    r.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
        b.disabled = false;
        b.tabIndex = -1;
    });
}

function suspendedLicenseSplitUnlock(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    if (!r) return;
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    if (String(r.dataset.licenseId || '') === '0') {
        return;
    }
    if (ta) {
        ta.readOnly = false;
        ta.removeAttribute('tabindex');
    }
    r.classList.remove('license-notepad--locked');
    r.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.readOnly = false;
        x.removeAttribute('tabindex');
    });
    r.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
        b.removeAttribute('tabindex');
    });
}

function suspendedLicenseSplitWireScrollSync(root) {
    const r = root || suspendedLicenseSplitQueryRoot();
    const ta = suspendedLicenseSplitQueryCredsTa(r);
    const rows = suspendedLicenseSplitQueryRowsWrap(r);
    if (!ta || !rows || rows.dataset.suspLicScrollSync === '1') return;
    rows.dataset.suspLicScrollSync = '1';
    let syncing = false;
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

async function suspendedLicenseSplitRestoreRowToLicense(row) {
    if (!row || window.__suspendedLicenseSplitRestoreInFlight) return;
    const root = row.closest('.suspended-license-split-root');
    if (!root) return;
    const licenseId = parseInt(root.dataset.licenseId, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto (no «Todos») para devolver licencias al bloc Licencias.');
        return;
    }
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    const activeId =
        inputContainer && inputContainer.dataset.activeLicenseId != null
            ? parseInt(inputContainer.dataset.activeLicenseId, 10)
            : NaN;
    if (!Number.isFinite(activeId) || activeId !== licenseId) {
        showError('Abre el mismo producto en la cuadrícula para devolver esta licencia al bloc Licencias.');
        return;
    }
    const taLic = document.getElementById('adminLicenciasNotepadByLicense');
    if (!taLic || parseInt(taLic.dataset.licenseId, 10) !== licenseId) {
        showError('El bloc Licencias no coincide. Abre la licencia correcta.');
        return;
    }

    const ta = suspendedLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const rows = suspendedLicenseSplitGetRowElements(root);
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) return;
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return;
    }
    const r = adminLicenseSplitReadRow(row);
    const lineToMove = buildAdminLicenseStorageLine(
        cred,
        '',
        '',
        r.statusBad != null ? r.statusBad : '',
        r.extra
    ).trim();
    if (!lineToMove) {
        showError('No hay datos válidos para mover.');
        return;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                '',
                '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newSuspendedMerged = newMergedLines.join('\n');
    const oldSuspendedMerged = suspendedLicenseSplitGetMergedText(root);
    const oldLicenseMerged = adminLicenseSplitGetMergedNotes();
    const licLines = oldLicenseMerged.replace(/\r\n/g, '\n').split('\n');
    while (licLines.length && licLines[licLines.length - 1] === '') {
        licLines.pop();
    }
    licLines.push(lineToMove);
    const newLicenseMerged = licLines.join('\n');

    window.__suspendedLicenseSplitRestoreInFlight = true;
    try {
        suspendedLicenseSplitApplyMergedText(root, newSuspendedMerged);
        adminLicenseSplitApplyMergedText(newLicenseMerged);
        const saveLicRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveLicRes || !saveLicRes.success) {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
            suspendedLicenseSplitApplyMergedText(root, oldSuspendedMerged);
            showError('No se pudo guardar. Revisa la conexión.');
            return;
        }
        showSuccess('Licencia devuelta al bloc Licencias.');
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateSuspendedBlocLineCountBadge === 'function') {
            window.updateSuspendedBlocLineCountBadge();
        }
        adminLicenciasReturnToLicenseEditorAfterRestoreUi(licenseId);
    } catch (err) {
        console.error('suspendedLicenseSplitRestoreRowToLicense', err);
        try {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
        } catch (e2) {
            console.error(e2);
        }
        try {
            suspendedLicenseSplitApplyMergedText(root, oldSuspendedMerged);
        } catch (e3) {
            console.error(e3);
        }
        showError('No se pudo completar. Revisa los blocs o recarga la página si hace falta.');
    } finally {
        window.__suspendedLicenseSplitRestoreInFlight = false;
    }
}

window.suspendedLicenseSplitGetMergedText = suspendedLicenseSplitGetMergedText;
window.suspendedLicenseSplitApplyMergedText = suspendedLicenseSplitApplyMergedText;
window.suspendedLicenseSplitSyncRowsToTextarea = suspendedLicenseSplitSyncRowsToTextarea;
window.suspendedLicenseSplitScheduleAutosize = suspendedLicenseSplitScheduleAutosize;
window.suspendedLicenseSplitLock = suspendedLicenseSplitLock;
window.suspendedLicenseSplitUnlock = suspendedLicenseSplitUnlock;
window.suspendedLicenseSplitWireScrollSync = suspendedLicenseSplitWireScrollSync;
window.suspendedLicenseSplitRestoreRowToLicense = suspendedLicenseSplitRestoreRowToLicense;
/* --- Vencidas: flecha arriba, solo estado rojo (+ otro), notas (sin usuario ni verde) --- */

function expiredLicenseSplitQueryRoot() {
    return document.getElementById('adminLicenciasExpiredSplitRoot');
}

function expiredLicenseSplitQueryCredsTa(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    return r && r.querySelector ? r.querySelector('.expired-license-split__creds') : null;
}

function expiredLicenseSplitQueryRowsWrap(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    return r && r.querySelector ? r.querySelector('.expired-license-split-rows') : null;
}

function expiredLicenseSplitGetRowElements(root) {
    const wrap = expiredLicenseSplitQueryRowsWrap(root);
    if (!wrap) return [];
    return Array.prototype.slice.call(wrap.querySelectorAll('.license-split-editor__row'));
}

function expiredLicenseSplitClearRows(root) {
    const wrap = expiredLicenseSplitQueryRowsWrap(root);
    if (wrap) wrap.innerHTML = '';
}

function expiredLicenseSplitCreateRow(initialExtra, initialStatusBad, initialOtroDetail) {
    const row = document.createElement('div');
    row.className = 'license-split-editor__row license-split-editor__row--expired';
    const restoreCell = document.createElement('div');
    restoreCell.className = 'license-split-editor__day-restore-cell';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'license-split-editor__restore-to-license-btn';
    restoreBtn.title = 'Devolver esta licencia al bloc Licencias';
    restoreBtn.setAttribute('aria-label', 'Devolver licencia al bloc Licencias');
    restoreBtn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    restoreCell.appendChild(restoreBtn);
    const statusWrap = document.createElement('div');
    statusWrap.className = 'license-split-editor__status-wrap';
    const selBad = document.createElement('select');
    selBad.className = 'license-split-editor__status license-split-editor__status-bad';
    selBad.title =
        'Incidencia o problema (vencida, no reproduce, otro). Con «Otro», describa el detalle a la derecha.';
    selBad.setAttribute('aria-label', 'Estado de incidencia (cuenta vencida o sin renovar)');
    ADMIN_LICENSE_STATUS_OPTIONS_BAD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selBad.appendChild(o);
    });
    const sb = initialStatusBad != null ? String(initialStatusBad).trim() : '';
    if (sb && !adminLicenseStatusIsKnownBadOption(sb)) {
        const o = document.createElement('option');
        o.value = sb;
        o.textContent = sb;
        selBad.appendChild(o);
    }
    selBad.value = adminLicenseSplitCanonicalBadFromStored(sb) || '';
    const od = initialOtroDetail != null ? String(initialOtroDetail) : '';
    const otroCombined = document.createElement('input');
    otroCombined.type = 'text';
    otroCombined.className = 'license-split-editor__otro-combined';
    otroCombined.setAttribute('autocomplete', 'off');
    otroCombined.placeholder = 'des.. problema';
    otroCombined.title =
        'Describe el problema; se guarda con el estado «Otro» de la columna roja.';
    if (String(selBad.value || '').trim().toLowerCase() === 'otro') {
        otroCombined.value = od != null ? String(od) : '';
    } else {
        otroCombined.value = '';
    }
    otroCombined.hidden = true;
    otroCombined.style.display = 'none';
    const badShell = document.createElement('div');
    badShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--bad';
    badShell.appendChild(selBad);
    statusWrap.appendChild(badShell);
    statusWrap.appendChild(otroCombined);
    const n = document.createElement('input');
    n.type = 'text';
    n.className = 'license-split-editor__note';
    n.setAttribute('autocomplete', 'off');
    n.setAttribute('aria-label', 'Notas de la licencia');
    n.placeholder = 'Notas';
    adminLicenseInitNoteField(n, row, initialExtra);
    const lead = document.createElement('div');
    lead.className = 'license-split-editor__lead';
    lead.appendChild(restoreCell);
    row.appendChild(lead);
    row.appendChild(statusWrap);
    row.appendChild(n);
    adminLicenseSplitWireBadOnlyStatusNoteLink(selBad, n, otroCombined);
    return row;
}

function expiredLicenseSplitRefreshRowAccessibility(root) {
    const wrap = expiredLicenseSplitQueryRowsWrap(root);
    if (!wrap || !root || !root.dataset) return;
    const rows = wrap.querySelectorAll('.license-split-editor__row');
    rows.forEach(function (row, i) {
        const line = i + 1;
        const idBase = 'expSplitL' + line;
        row.setAttribute('role', 'group');
        row.setAttribute(
            'aria-label',
            'Vencidas, fila ' + line + ': devolver a Licencias, estado rojo y notas'
        );
        const restoreB = row.querySelector('.license-split-editor__restore-to-license-btn');
        const selBad = row.querySelector('.license-split-editor__status-bad');
        const otroD = row.querySelector('.license-split-editor__otro-combined');
        const n = row.querySelector('.license-split-editor__note');
        if (restoreB) {
            restoreB.id = idBase + 'Restore';
            restoreB.setAttribute('aria-label', 'Devolver fila ' + line + ' al bloc Licencias');
        }
        if (selBad) {
            selBad.id = idBase + 'StatusBad';
            selBad.setAttribute('name', 'exp_split_l' + line + '_status_bad');
            selBad.setAttribute(
                'aria-label',
                'Estado de incidencia en vencidas (línea ' + line + ')'
            );
        }
        if (otroD) {
            otroD.id = idBase + 'OtroCombined';
            otroD.setAttribute('name', 'exp_split_l' + line + '_otro_combined');
            otroD.setAttribute(
                'aria-label',
                'Detalle «Otro» en vencidas (línea ' + line + ')'
            );
        }
        if (n) {
            n.id = idBase + 'Note';
            n.setAttribute('name', 'exp_split_l' + line + '_note');
            if (selBad) {
                adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n, line);
            } else {
                n.setAttribute('aria-label', 'Notas (vencidas, línea ' + line + ')');
            }
        }
        if (selBad && otroD) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroD);
        }
    });
}

function expiredLicenseSplitSyncRowCount(root, credLineCount) {
    const wrap = expiredLicenseSplitQueryRowsWrap(root);
    if (!wrap) return;
    let n = Math.max(0, parseInt(credLineCount, 10) || 0);
    while (wrap.children.length < n) {
        wrap.appendChild(expiredLicenseSplitCreateRow('', '', undefined));
    }
    while (wrap.children.length > n) {
        wrap.removeChild(wrap.lastChild);
    }
    expiredLicenseSplitRefreshRowAccessibility(root);
    if (
        !__markAdminDupInProgress &&
        document.documentElement.dataset.adminLicDupHighlightActive === '1' &&
        typeof window.scheduleRefreshAdminDupIfActive === 'function'
    ) {
        window.scheduleRefreshAdminDupIfActive();
    }
}

function expiredLicenseSplitCascadeClearSidesForEmptyCredLines(root) {
    const ta = expiredLicenseSplitQueryCredsTa(root);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const rows = expiredLicenseSplitGetRowElements(root);
    let anyCleared = false;
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() === '') {
            dayLicenseSplitClearRowSideFields(rows[i]);
            anyCleared = true;
        }
    }
    if (anyCleared) {
        expiredLicenseSplitRefreshRowAccessibility(root);
    }
}

function expiredLicenseSplitGetMergedText(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    const ta = expiredLicenseSplitQueryCredsTa(r);
    if (!ta || ta.tagName !== 'TEXTAREA') return '';
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    expiredLicenseSplitSyncRowCount(r, credLines.length);
    expiredLicenseSplitCascadeClearSidesForEmptyCredLines(r);
    const rows = expiredLicenseSplitGetRowElements(r);
    const out = [];
    for (let i = 0; i < credLines.length; i++) {
        const rr = rows[i]
            ? adminLicenseSplitReadRow(rows[i])
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        const line = buildAdminLicenseStorageLine(
            credLines[i],
            '',
            '',
            rr.statusBad != null ? rr.statusBad : '',
            rr.extra
        );
        out.push(line);
    }
    while (out.length && out[out.length - 1] === '') {
        out.pop();
    }
    return out.join('\n');
}

function expiredLicenseSplitApplyMergedText(root, text) {
    const r = root || expiredLicenseSplitQueryRoot();
    const ta = expiredLicenseSplitQueryCredsTa(r);
    const wrap = expiredLicenseSplitQueryRowsWrap(r);
    if (!ta || !wrap) return;
    const t = text != null ? String(text).replace(/\r\n/g, '\n') : '';
    const lines = t === '' ? [] : t.split('\n');
    expiredLicenseSplitClearRows(r);
    const credParts = [];
    lines.forEach(function (ln) {
        const p = parseAdminLicenseLineToSplitParts(ln);
        credParts.push(p.cred);
        let note = (p.extra != null ? String(p.extra) : '').trim();
        const u = (p.user != null ? String(p.user).trim() : '');
        if (u && u.toLowerCase() !== 'anonimo') {
            note = note ? u + ' — ' + note : u;
        }
        const sg = (p.statusGood != null ? String(p.statusGood) : '').trim();
        const sb = (p.statusBad != null ? String(p.statusBad) : '').trim();
        if (sg && !sb) {
            note = note ? note + ' · ' + sg : sg;
        }
        wrap.appendChild(
            expiredLicenseSplitCreateRow(
                note,
                sb,
                p.otroDetail != null ? p.otroDetail : ''
            )
        );
    });
    ta.value = credParts.join('\n');
    if (lines.length === 0) {
        ta.value = '';
    }
    expiredLicenseSplitRefreshRowAccessibility(r);
    window.requestAnimationFrame(function () {
        expiredLicenseSplitScheduleAutosize(r);
        adminLicenseSplitValidateAllUserInputs(r);
    });
}

function expiredLicenseSplitSyncRowsToTextarea(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    const ta = expiredLicenseSplitQueryCredsTa(r);
    if (!ta) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    expiredLicenseSplitSyncRowCount(r, credLines.length);
    expiredLicenseSplitCascadeClearSidesForEmptyCredLines(r);
    expiredLicenseSplitScheduleAutosize(r);
}

var __expSplitAutosizeTimers = {};

function expiredLicenseSplitScheduleAutosize(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    if (!r) return;
    expiredLicenseSplitAutosizeCreds(r);
    clearTimeout(__expSplitAutosizeTimers._k);
    __expSplitAutosizeTimers._k = setTimeout(function () {
        expiredLicenseSplitAutosizeCreds(r);
        clearTimeout(__expSplitAutosizeTimers._k2);
        __expSplitAutosizeTimers._k2 = setTimeout(function () {
            expiredLicenseSplitAutosizeCreds(r);
        }, 60);
    }, 30);
}

function expiredLicenseSplitAutosizeCreds(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    const ta = expiredLicenseSplitQueryCredsTa(r);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const splitSide = r.querySelector('.license-split-editor__side');
    const rowsEl = expiredLicenseSplitQueryRowsWrap(r);
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    expiredLicenseSplitSyncRowCount(r, credLines.length);
    expiredLicenseSplitCascadeClearSidesForEmptyCredLines(r);

    if (splitSide && splitSide.hidden) {
        ta.style.minHeight = '0';
        ta.style.height = '0px';
        const ns = ta.scrollHeight;
        ta.style.minHeight = '';
        ta.style.height = '';
        const cs = window.getComputedStyle(ta);
        let minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = 20; // Adaptable, sin mínimo fijo de 112px
        ta.style.height = Math.max(minPx, ns + 2) + 'px';
        licenseSplitSyncCredsTaContentWidth(ta);
        return;
    }

    if (rowsEl) {
        void rowsEl.offsetHeight;
    }

    const cs0 = window.getComputedStyle(ta);
    const linePx = adminLicSplitParseLineHeightPx(cs0);
    const padY = (parseFloat(cs0.paddingTop) || 0) + (parseFloat(cs0.paddingBottom) || 0);
    const estimateByLines = linePx * credLines.length + padY;

    ta.style.minHeight = '0';
    ta.style.height = '0px';
    const naturalScroll = ta.scrollHeight;
    ta.style.minHeight = '';
    ta.style.height = '';

    const cs = window.getComputedStyle(ta);
    let minPx = parseFloat(cs.minHeight);
    if (Number.isNaN(minPx)) minPx = 20; // Adaptable, sin mínimo fijo de 112px
    const contentH = Math.max(naturalScroll + 2, estimateByLines);
    const h = Math.max(minPx, contentH);
    ta.style.height = Math.ceil(h) + 'px';
    licenseSplitSyncCredsTaContentWidth(ta);
}

function expiredLicenseSplitLock(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    if (!r) return;
    const ta = expiredLicenseSplitQueryCredsTa(r);
    if (ta) {
        ta.readOnly = true;
        ta.setAttribute('tabindex', '-1');
    }
    r.classList.add('license-notepad--locked');
    r.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.disabled = false;
        x.readOnly = true;
        x.tabIndex = -1;
    });
    r.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
        b.disabled = false;
        b.tabIndex = -1;
    });
}

function expiredLicenseSplitUnlock(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    if (!r) return;
    const ta = expiredLicenseSplitQueryCredsTa(r);
    if (String(r.dataset.licenseId || '') === '0') {
        return;
    }
    if (ta) {
        ta.readOnly = false;
        ta.removeAttribute('tabindex');
    }
    r.classList.remove('license-notepad--locked');
    r.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.readOnly = false;
        x.removeAttribute('tabindex');
    });
    r.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
        b.removeAttribute('tabindex');
    });
}

function expiredLicenseSplitWireScrollSync(root) {
    const r = root || expiredLicenseSplitQueryRoot();
    const ta = expiredLicenseSplitQueryCredsTa(r);
    const rows = expiredLicenseSplitQueryRowsWrap(r);
    if (!ta || !rows || rows.dataset.expLicScrollSync === '1') return;
    rows.dataset.expLicScrollSync = '1';
    let syncing = false;
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

async function expiredLicenseSplitRestoreRowToLicense(row) {
    if (!row || window.__expiredLicenseSplitRestoreInFlight) return;
    const root = row.closest('.expired-license-split-root');
    if (!root) return;
    const licenseId = parseInt(root.dataset.licenseId, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto (no «Todos») para devolver licencias al bloc Licencias.');
        return;
    }
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    const activeId =
        inputContainer && inputContainer.dataset.activeLicenseId != null
            ? parseInt(inputContainer.dataset.activeLicenseId, 10)
            : NaN;
    if (!Number.isFinite(activeId) || activeId !== licenseId) {
        showError('Abre el mismo producto en la cuadrícula para devolver esta licencia al bloc Licencias.');
        return;
    }
    const taLic = document.getElementById('adminLicenciasNotepadByLicense');
    if (!taLic || parseInt(taLic.dataset.licenseId, 10) !== licenseId) {
        showError('El bloc Licencias no coincide. Abre la licencia correcta.');
        return;
    }

    const ta = expiredLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const rows = expiredLicenseSplitGetRowElements(root);
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) return;
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return;
    }
    const r = adminLicenseSplitReadRow(row);
    const lineToMove = buildAdminLicenseStorageLine(
        cred,
        '',
        '',
        r.statusBad != null ? r.statusBad : '',
        r.extra
    ).trim();
    if (!lineToMove) {
        showError('No hay datos válidos para mover.');
        return;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                '',
                '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newSuspendedMerged = newMergedLines.join('\n');
    const oldSuspendedMerged = expiredLicenseSplitGetMergedText(root);
    const oldLicenseMerged = adminLicenseSplitGetMergedNotes();
    const licLines = oldLicenseMerged.replace(/\r\n/g, '\n').split('\n');
    while (licLines.length && licLines[licLines.length - 1] === '') {
        licLines.pop();
    }
    licLines.push(lineToMove);
    const newLicenseMerged = licLines.join('\n');

    window.__expiredLicenseSplitRestoreInFlight = true;
    try {
        expiredLicenseSplitApplyMergedText(root, newSuspendedMerged);
        adminLicenseSplitApplyMergedText(newLicenseMerged);
        const saveLicRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveLicRes || !saveLicRes.success) {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
            expiredLicenseSplitApplyMergedText(root, oldSuspendedMerged);
            showError('No se pudo guardar. Revisa la conexión.');
            return;
        }
        showSuccess('Licencia devuelta al bloc Licencias.');
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateExpiredBlocLineCountBadge === 'function') {
            window.updateExpiredBlocLineCountBadge();
        }
        adminLicenciasReturnToLicenseEditorAfterRestoreUi(licenseId);
    } catch (err) {
        console.error('expiredLicenseSplitRestoreRowToLicense', err);
        try {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
        } catch (e2) {
            console.error(e2);
        }
        try {
            expiredLicenseSplitApplyMergedText(root, oldSuspendedMerged);
        } catch (e3) {
            console.error(e3);
        }
        showError('No se pudo completar. Revisa los blocs o recarga la página si hace falta.');
    } finally {
        window.__expiredLicenseSplitRestoreInFlight = false;
    }
}

window.expiredLicenseSplitGetMergedText = expiredLicenseSplitGetMergedText;
window.expiredLicenseSplitApplyMergedText = expiredLicenseSplitApplyMergedText;
window.expiredLicenseSplitSyncRowsToTextarea = expiredLicenseSplitSyncRowsToTextarea;
window.expiredLicenseSplitScheduleAutosize = expiredLicenseSplitScheduleAutosize;
window.expiredLicenseSplitLock = expiredLicenseSplitLock;
window.expiredLicenseSplitUnlock = expiredLicenseSplitUnlock;
window.expiredLicenseSplitWireScrollSync = expiredLicenseSplitWireScrollSync;
window.expiredLicenseSplitRestoreRowToLicense = expiredLicenseSplitRestoreRowToLicense;

/* --- Cambios (mes a mes): correo, rojo + verde «Terminado», devolver a Licencias solo si Terminado --- */
const ADMIN_LICENSE_CHANGES_STATUS_GOOD = [
    { v: '', label: '—' },
    { v: 'terminado', label: 'Terminado' }
];

function changesLicenseSplitCanonicalGood(st) {
    const k = adminLicenseNormalizeStatusKey(st);
    if (k === 'terminado') return 'terminado';
    return '';
}

function changesLicenseSplitQueryRoot() {
    return null;
}

function changesLicenseSplitForEachProductRoot(fn) {
    document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(fn);
}

function changesLicenseSplitQueryCredsTa(root) {
    const r = root || changesLicenseSplitQueryRoot();
    return r && r.querySelector ? r.querySelector('.changes-license-split__creds') : null;
}

function changesLicenseSplitQueryRowsWrap(root) {
    const r = root || changesLicenseSplitQueryRoot();
    return r && r.querySelector ? r.querySelector('.changes-license-split-rows') : null;
}

function changesLicenseSplitGetRowElements(root) {
    const wrap = changesLicenseSplitQueryRowsWrap(root);
    if (!wrap) return [];
    return Array.prototype.slice.call(wrap.querySelectorAll('.license-split-editor__row'));
}

function changesLicenseSplitClearRows(root) {
    const wrap = changesLicenseSplitQueryRowsWrap(root);
    if (wrap) wrap.innerHTML = '';
}

function changesLicenseSplitCreateRow(initialExtra, initialStatusGood, initialStatusBad, initialOtroDetail) {
    const row = document.createElement('div');
    row.className = 'license-split-editor__row license-split-editor__row--changes';
    const restoreCell = document.createElement('div');
    restoreCell.className = 'license-split-editor__day-restore-cell';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'license-split-editor__restore-to-license-btn';
    restoreBtn.title =
        'Cerrar tras «Terminado»: incidencia (caída, no reproduce, otro…) → Caídas del producto; sin incidencia → Licencias.';
    restoreBtn.setAttribute('aria-label', 'Terminar cambio: incidencia a Caídas o cuenta a Licencias');
    restoreBtn.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    restoreCell.appendChild(restoreBtn);
    const statusWrap = document.createElement('div');
    statusWrap.className = 'license-split-editor__status-wrap';
    const selGood = document.createElement('select');
    selGood.className = 'license-split-editor__status license-split-editor__status-good';
    selGood.title = 'Marcar trabajo en cambios como terminado';
    selGood.setAttribute('aria-label', 'Estado Terminado (cambios mes a mes)');
    ADMIN_LICENSE_CHANGES_STATUS_GOOD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selGood.appendChild(o);
    });
    const sgIn = initialStatusGood != null ? String(initialStatusGood).trim() : '';
    if (sgIn && !changesLicenseSplitCanonicalGood(sgIn)) {
        const o = document.createElement('option');
        o.value = sgIn;
        o.textContent = sgIn;
        selGood.appendChild(o);
    }
    selGood.value = changesLicenseSplitCanonicalGood(sgIn) || '';
    const selBad = document.createElement('select');
    selBad.className = 'license-split-editor__status license-split-editor__status-bad';
    selBad.title =
        'Incidencia o problema. Con «Otro», describa el detalle a la derecha.';
    selBad.setAttribute('aria-label', 'Estado de incidencia (cambios)');
    ADMIN_LICENSE_STATUS_OPTIONS_BAD.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        selBad.appendChild(o);
    });
    const sb = initialStatusBad != null ? String(initialStatusBad).trim() : '';
    if (sb && !adminLicenseStatusIsKnownBadOption(sb)) {
        const o = document.createElement('option');
        o.value = sb;
        o.textContent = sb;
        selBad.appendChild(o);
    }
    selBad.value = adminLicenseSplitCanonicalBadFromStored(sb) || '';
    const od = initialOtroDetail != null ? String(initialOtroDetail) : '';
    const otroCombined = document.createElement('input');
    otroCombined.type = 'text';
    otroCombined.className = 'license-split-editor__otro-combined';
    otroCombined.setAttribute('autocomplete', 'off');
    otroCombined.placeholder = 'des.. problema';
    otroCombined.title =
        'Describe el problema; se guarda con el estado «Otro» de la columna roja.';
    if (String(selBad.value || '').trim().toLowerCase() === 'otro') {
        otroCombined.value = od != null ? String(od) : '';
    } else {
        otroCombined.value = '';
    }
    otroCombined.hidden = true;
    otroCombined.style.display = 'none';
    const goodShell = document.createElement('div');
    goodShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--good';
    goodShell.appendChild(selGood);
    const badShell = document.createElement('div');
    badShell.className = 'license-split-editor__status-select-shell license-split-editor__status-select-shell--bad';
    badShell.appendChild(selBad);
    statusWrap.appendChild(goodShell);
    statusWrap.appendChild(badShell);
    statusWrap.appendChild(otroCombined);
    const n = document.createElement('input');
    n.type = 'text';
    n.className = 'license-split-editor__note';
    n.setAttribute('autocomplete', 'off');
    n.setAttribute('aria-label', 'Notas de la licencia');
    n.placeholder = 'Notas';
    adminLicenseInitNoteField(n, row, initialExtra);
    const lead = document.createElement('div');
    lead.className = 'license-split-editor__lead';
    lead.appendChild(restoreCell);
    row.appendChild(lead);
    row.appendChild(statusWrap);
    row.appendChild(n);
    adminLicenseSplitWireDualStatusNoteLink(selGood, selBad, n, otroCombined);
    return row;
}

function changesLicenseSplitRefreshRowAccessibility(root) {
    const wrap = changesLicenseSplitQueryRowsWrap(root);
    if (!wrap || !root || !root.dataset) return;
    const rows = wrap.querySelectorAll('.license-split-editor__row');
    const licSuf = root.dataset.licenseId != null ? String(root.dataset.licenseId) : 'x';
    rows.forEach(function (row, i) {
        const line = i + 1;
        const idBase = 'chSplitL' + licSuf + '_' + line;
        row.setAttribute('role', 'group');
        row.setAttribute(
            'aria-label',
            'Cambios, fila ' + line + ': devolver a Licencias, Terminado, estado rojo y notas'
        );
        const restoreB = row.querySelector('.license-split-editor__restore-to-license-btn');
        const selGood = row.querySelector('.license-split-editor__status-good');
        const selBad = row.querySelector('.license-split-editor__status-bad');
        const otroD = row.querySelector('.license-split-editor__otro-combined');
        const n = row.querySelector('.license-split-editor__note');
        if (restoreB) {
            restoreB.id = idBase + 'Restore';
            restoreB.setAttribute('aria-label', 'Devolver fila ' + line + ' al bloc Licencias');
        }
        if (selGood) {
            selGood.id = idBase + 'StatusGood';
            selGood.setAttribute('name', 'ch_split_l' + line + '_status_good');
            selGood.setAttribute(
                'aria-label',
                'Terminado (cambios, línea ' + line + ')'
            );
        }
        if (selBad) {
            selBad.id = idBase + 'StatusBad';
            selBad.setAttribute('name', 'ch_split_l' + line + '_status_bad');
            selBad.setAttribute(
                'aria-label',
                'Estado de incidencia en cambios (línea ' + line + ')'
            );
        }
        if (otroD) {
            otroD.id = idBase + 'OtroCombined';
            otroD.setAttribute('name', 'ch_split_l' + line + '_otro_combined');
            otroD.setAttribute(
                'aria-label',
                'Detalle «Otro» en cambios (línea ' + line + ')'
            );
        }
        if (n) {
            n.id = idBase + 'Note';
            n.setAttribute('name', 'ch_split_l' + line + '_note');
            if (selBad) {
                adminLicenseSplitApplyNotePlaceholderFromDual(selBad, n, line);
            } else {
                n.setAttribute('aria-label', 'Notas (cambios, línea ' + line + ')');
            }
        }
        if (selBad && otroD) {
            adminLicenseSplitSyncOtroDetailVisibility(selBad, otroD);
        }
    });
}

function changesLicenseSplitSyncRowCount(root, credLineCount) {
    const wrap = changesLicenseSplitQueryRowsWrap(root);
    if (!wrap) return;
    let n = Math.max(0, parseInt(credLineCount, 10) || 0);
    while (wrap.children.length < n) {
        wrap.appendChild(changesLicenseSplitCreateRow('', '', '', undefined));
    }
    while (wrap.children.length > n) {
        wrap.removeChild(wrap.lastChild);
    }
    changesLicenseSplitRefreshRowAccessibility(root);
    if (
        !__markAdminDupInProgress &&
        document.documentElement.dataset.adminLicDupHighlightActive === '1' &&
        typeof window.scheduleRefreshAdminDupIfActive === 'function'
    ) {
        window.scheduleRefreshAdminDupIfActive();
    }
}

function changesLicenseSplitCascadeClearSidesForEmptyCredLines(root) {
    const ta = changesLicenseSplitQueryCredsTa(root);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    const rows = changesLicenseSplitGetRowElements(root);
    let anyCleared = false;
    for (let i = 0; i < rows.length; i++) {
        const cred = credLines[i] != null ? credLines[i] : '';
        if (String(cred).trim() === '') {
            dayLicenseSplitClearRowSideFields(rows[i]);
            anyCleared = true;
        }
    }
    if (anyCleared) {
        changesLicenseSplitRefreshRowAccessibility(root);
    }
}

function changesLicenseSplitGetMergedText(root) {
    const r = root;
    if (!r) return '';
    const ta = changesLicenseSplitQueryCredsTa(r);
    if (!ta || ta.tagName !== 'TEXTAREA') return '';
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    changesLicenseSplitSyncRowCount(r, credLines.length);
    changesLicenseSplitCascadeClearSidesForEmptyCredLines(r);
    const rows = changesLicenseSplitGetRowElements(r);
    const out = [];
    for (let i = 0; i < credLines.length; i++) {
        const rr = rows[i]
            ? adminLicenseSplitReadRow(rows[i])
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        const line = buildAdminLicenseStorageLine(
            credLines[i],
            '',
            rr.statusGood != null ? rr.statusGood : '',
            rr.statusBad != null ? rr.statusBad : '',
            rr.extra
        );
        out.push(line);
    }
    while (out.length && out[out.length - 1] === '') {
        out.pop();
    }
    return out.join('\n');
}

function changesLicenseSplitApplyMergedText(root, text) {
    const r = root;
    if (!r) return;
    const ta = changesLicenseSplitQueryCredsTa(r);
    const wrap = changesLicenseSplitQueryRowsWrap(r);
    if (!ta || !wrap) return;
    const t = text != null ? String(text).replace(/\r\n/g, '\n') : '';
    const lines = t === '' ? [] : t.split('\n');
    changesLicenseSplitClearRows(r);
    const credParts = [];
    lines.forEach(function (ln) {
        const p = parseAdminLicenseLineToSplitParts(ln);
        credParts.push(p.cred);
        let note = (p.extra != null ? String(p.extra) : '').trim();
        const u = (p.user != null ? String(p.user).trim() : '');
        if (u && u.toLowerCase() !== 'anonimo') {
            note = note ? u + ' — ' + note : u;
        }
        const sg = (p.statusGood != null ? String(p.statusGood) : '').trim();
        const sb = (p.statusBad != null ? String(p.statusBad) : '').trim();
        wrap.appendChild(
            changesLicenseSplitCreateRow(
                note,
                sg,
                sb,
                p.otroDetail != null ? p.otroDetail : undefined
            )
        );
    });
    ta.value = credParts.join('\n');
    if (lines.length === 0) {
        ta.value = '';
    }
    changesLicenseSplitRefreshRowAccessibility(r);
    window.requestAnimationFrame(function () {
        changesLicenseSplitScheduleAutosize(r);
        adminLicenseSplitValidateAllUserInputs(r);
    });
}

function changesLicenseSplitSyncRowsToTextarea(root) {
    if (!root) {
        changesLicenseSplitForEachProductRoot(function (r) {
            changesLicenseSplitSyncRowsToTextarea(r);
        });
        return;
    }
    const ta = changesLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    changesLicenseSplitSyncRowCount(root, credLines.length);
    changesLicenseSplitCascadeClearSidesForEmptyCredLines(root);
    changesLicenseSplitScheduleAutosize(root);
}

var __chSplitAutosizeTimers = {};

function changesLicenseSplitScheduleAutosize(root) {
    if (!root) {
        changesLicenseSplitForEachProductRoot(function (r) {
            changesLicenseSplitScheduleAutosize(r);
        });
        return;
    }
    changesLicenseSplitAutosizeCreds(root);
    clearTimeout(__chSplitAutosizeTimers._k);
    __chSplitAutosizeTimers._k = setTimeout(function () {
        changesLicenseSplitAutosizeCreds(root);
        clearTimeout(__chSplitAutosizeTimers._k2);
        __chSplitAutosizeTimers._k2 = setTimeout(function () {
            changesLicenseSplitAutosizeCreds(root);
        }, 60);
    }, 30);
}

function changesLicenseSplitAutosizeCreds(root) {
    const r = root;
    if (!r) return;
    const ta = changesLicenseSplitQueryCredsTa(r);
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const splitSide = r.querySelector('.license-split-editor__side');
    const rowsEl = changesLicenseSplitQueryRowsWrap(r);
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = licenseSplitCredLinesFromRaw(raw);
    changesLicenseSplitSyncRowCount(r, credLines.length);
    changesLicenseSplitCascadeClearSidesForEmptyCredLines(r);

    if (splitSide && splitSide.hidden) {
        ta.style.minHeight = '0';
        ta.style.height = '0px';
        const ns = ta.scrollHeight;
        ta.style.minHeight = '';
        ta.style.height = '';
        const cs = window.getComputedStyle(ta);
        let minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = 20;
        ta.style.height = Math.max(minPx, ns + 2) + 'px';
        licenseSplitSyncCredsTaContentWidth(ta);
        return;
    }

    if (rowsEl) {
        void rowsEl.offsetHeight;
    }

    const cs0 = window.getComputedStyle(ta);
    const linePx = adminLicSplitParseLineHeightPx(cs0);
    const padY = (parseFloat(cs0.paddingTop) || 0) + (parseFloat(cs0.paddingBottom) || 0);
    const estimateByLines = linePx * credLines.length + padY;

    ta.style.minHeight = '0';
    ta.style.height = '0px';
    const naturalScroll = ta.scrollHeight;
    ta.style.minHeight = '';
    ta.style.height = '';

    const cs = window.getComputedStyle(ta);
    let minPx = parseFloat(cs.minHeight);
    if (Number.isNaN(minPx)) minPx = 20;
    const contentH = Math.max(naturalScroll + 2, estimateByLines);
    const h = Math.max(minPx, contentH);
    ta.style.height = Math.ceil(h) + 'px';
    licenseSplitSyncCredsTaContentWidth(ta);
}

function changesLicenseSplitLock(root) {
    const r = root;
    if (!r) return;
    const ta = changesLicenseSplitQueryCredsTa(r);
    if (ta) {
        ta.readOnly = true;
        ta.setAttribute('tabindex', '-1');
    }
    r.classList.add('license-notepad--locked');
    r.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.disabled = false;
        x.readOnly = true;
        x.tabIndex = -1;
    });
    r.querySelectorAll('.license-split-editor__row select').forEach(function (x) {
        x.disabled = false;
        x.tabIndex = -1;
    });
    r.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
        b.disabled = false;
        b.tabIndex = -1;
    });
}

function changesLicenseSplitUnlock(root) {
    const r = root;
    if (!r) return;
    const ta = changesLicenseSplitQueryCredsTa(r);
    if (String(r.dataset.licenseId || '') === '0') {
        return;
    }
    if (ta) {
        ta.readOnly = false;
        ta.removeAttribute('tabindex');
    }
    r.classList.remove('license-notepad--locked');
    r.querySelectorAll('.license-split-editor__row input').forEach(function (x) {
        if (x.classList.contains('license-split-editor__restore-to-license-btn')) return;
        x.readOnly = false;
        x.removeAttribute('tabindex');
    });
    r.querySelectorAll('.license-split-editor__row select').forEach(function (x) {
        x.removeAttribute('tabindex');
    });
    r.querySelectorAll('.license-split-editor__restore-to-license-btn').forEach(function (b) {
        b.removeAttribute('tabindex');
    });
}

/**
 * Cambios mes a mes: incidencia en la columna roja (caída, no reproduce, otro con texto, etc.) → puede ir a Caídas
 * con la flecha sin exigir «Terminado». «Terminado» sin incidencia → devuelve a Licencias.
 */
function changesLicenseSplitRowHasResolvableIncident(row) {
    if (!row) return false;
    const rootEarly = row.closest('.changes-license-split-root');
    if (rootEarly && typeof changesLicenseSplitSyncRowsToTextarea === 'function') {
        changesLicenseSplitSyncRowsToTextarea(rootEarly);
    }
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const oc = row.querySelector('.license-split-editor__otro-combined');
    if (!selBad) return false;
    const sv = String(selBad.value || '').trim();
    if (!sv) return false;
    if (adminLicenseNormalizeStatusKey(sv) === 'otro') {
        const d = oc ? String(oc.value || '').trim().replace(/^otro-?/i, '') : '';
        if (!d) return false;
        return true;
    }
    /** Lista explícita: mismo criterio que el desplegable rojo del admin (evita depender solo del tier). */
    if (typeof adminLicenseStatusIsKnownBadOption === 'function' && adminLicenseStatusIsKnownBadOption(sv)) {
        return true;
    }
    const eff = adminLicenseSplitEffectiveStatusForTier(selBad, oc);
    return adminLicenseStatusTierFromStored(eff) === 'bad';
}

/** @deprecated usar changesLicenseSplitRowHasResolvableIncident; se mantiene por compat */
function changesLicenseSplitRowEligibleForIncidentToSuspended(row) {
    const sg = row && row.querySelector ? row.querySelector('.license-split-editor__status-good') : null;
    const terminado = sg && changesLicenseSplitCanonicalGood(sg.value) === 'terminado';
    return terminado && changesLicenseSplitRowHasResolvableIncident(row);
}

function changesLicenseSplitRevertTerminadoSelect(row) {
    const sg = row && row.querySelector ? row.querySelector('.license-split-editor__status-good') : null;
    if (!sg) return;
    sg.value = '';
    const sb = row.querySelector('.license-split-editor__status-bad');
    const oc = row.querySelector('.license-split-editor__otro-combined');
    if (typeof adminLicenseSplitApplyDualStatusTierClasses === 'function') {
        adminLicenseSplitApplyDualStatusTierClasses(sg, sb, oc);
    } else if (typeof adminLicenseSplitApplyGoodSelectTierClass === 'function') {
        adminLicenseSplitApplyGoodSelectTierClass(sg);
    }
}

async function changesLicenseSplitFinalizeIncidentToSuspended(row) {
    if (!row || window.__changesLicenseSplitRestoreInFlight) return;
    const root = row.closest('.changes-license-split-root');
    if (!root) return;
    if (typeof changesLicenseSplitSyncRowsToTextarea === 'function') {
        changesLicenseSplitSyncRowsToTextarea(root);
    }
    const licenseId = parseInt(root.dataset.licenseId, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto (no «Todos») para enviar cuentas a Caídas / suspendidas.');
        return;
    }
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    let activeId =
        inputContainer && inputContainer.dataset.activeLicenseId != null
            ? parseInt(inputContainer.dataset.activeLicenseId, 10)
            : NaN;
    let taLicMain = document.getElementById('adminLicenciasNotepadByLicense');
    const gridMatches = Number.isFinite(activeId) && activeId === licenseId;
    const mainBlocMatches =
        taLicMain &&
        taLicMain.tagName === 'TEXTAREA' &&
        parseInt(taLicMain.dataset.licenseId, 10) === licenseId;
    if (!gridMatches || !mainBlocMatches) {
        const card = document.querySelector(
            '.license-card[data-license-id="' + licenseId + '"]:not(.license-card--aggregate)'
        );
        if (!card) {
            showError('No se encontró el producto en la cuadrícula.');
            return;
        }
        _adminLicSkipNextChangesProductsRefreshOnce = true;
        try {
            await activateLicenseCard(card, licenseId, true, { preserveSidebar: true });
        } catch (activateErr) {
            console.error('changesLicenseSplitFinalizeIncidentToSuspended: activateLicenseCard', activateErr);
            _adminLicSkipNextChangesProductsRefreshOnce = false;
            showError('No se pudo preparar los blocs de este producto.');
            return;
        } finally {
            if (_adminLicSkipNextChangesProductsRefreshOnce) {
                _adminLicSkipNextChangesProductsRefreshOnce = false;
            }
        }
        taLicMain = document.getElementById('adminLicenciasNotepadByLicense');
        activeId =
            inputContainer && inputContainer.dataset.activeLicenseId != null
                ? parseInt(inputContainer.dataset.activeLicenseId, 10)
                : NaN;
        if (!Number.isFinite(activeId) || activeId !== licenseId) {
            showError('No se pudo sincronizar el producto con la cuadrícula.');
            return;
        }
        if (!taLicMain || parseInt(taLicMain.dataset.licenseId, 10) !== licenseId) {
            showError('El bloc Licencias no coincide con este producto.');
            return;
        }
    }

    const taS = document.getElementById('adminLicenciasSuspendedNotepad');
    const suspRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (!taS || !suspRoot || parseInt(taS.dataset.licenseId, 10) !== licenseId) {
        showError('Abre este producto en el grid para cargar Caídas / suspendidas (misma licencia que en Cambios).');
        return;
    }

    const ta = changesLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const rows = changesLicenseSplitGetRowElements(root);
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) return;
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return;
    }
    const r = adminLicenseSplitReadRow(row);
    const sbPersist = String(r.statusBad != null ? r.statusBad : '').trim();
    const extra = r.extra != null ? r.extra : '';
    const lineToMove = buildAdminLicenseStorageLine(cred, '', '', sbPersist, extra).trim();
    if (!lineToMove || !sbPersist) {
        showError('No hay datos de incidencia válidos para archivar en Caídas.');
        return;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                '',
                rr.statusGood != null ? rr.statusGood : '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newChangesMerged = newMergedLines.join('\n');
    const oldChangesMerged = changesLicenseSplitGetMergedText(root);

    const oldSuspMerged = suspendedLicenseSplitGetMergedText(suspRoot);
    const suspLines = oldSuspMerged === '' ? [] : oldSuspMerged.split('\n');
    while (suspLines.length && suspLines[suspLines.length - 1] === '') {
        suspLines.pop();
    }
    suspLines.push(lineToMove);
    const newSuspMerged = suspLines.join('\n');

    window.__changesLicenseSplitRestoreInFlight = true;
    try {
        changesLicenseSplitApplyMergedText(root, newChangesMerged);
        suspendedLicenseSplitApplyMergedText(suspRoot, newSuspMerged);
        const saveRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveRes || !saveRes.success) {
            suspendedLicenseSplitApplyMergedText(suspRoot, oldSuspMerged);
            changesLicenseSplitApplyMergedText(root, oldChangesMerged);
            showError('No se pudo guardar Cambios y Caídas. Revisa la conexión.');
            return;
        }
        showSuccess('Incidencia de Cambios enviada a Caídas / suspendidas.');
        scheduleRefreshAdminLicenciasReportCounts();
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateChangesBlocLineCountBadge === 'function') {
            window.updateChangesBlocLineCountBadge();
        }
        if (typeof window.updateSuspendedBlocLineCountBadge === 'function') {
            window.updateSuspendedBlocLineCountBadge();
        }
        window.requestAnimationFrame(function () {
            if (suspRoot && typeof suspRoot.scrollIntoView === 'function') {
                suspRoot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    } catch (err) {
        console.error('changesLicenseSplitFinalizeIncidentToSuspended', err);
        try {
            suspendedLicenseSplitApplyMergedText(suspRoot, oldSuspMerged);
            changesLicenseSplitApplyMergedText(root, oldChangesMerged);
        } catch (e2) {
            console.error(e2);
        }
        showError('No se pudo completar el traslado a Caídas.');
    } finally {
        window.__changesLicenseSplitRestoreInFlight = false;
    }
}

async function changesLicenseSplitResolveOutboundRow(row) {
    if (!row) return;
    const sg = row.querySelector('.license-split-editor__status-good');
    const selBad = row.querySelector('.license-split-editor__status-bad');
    const oc = row.querySelector('.license-split-editor__otro-combined');
    const terminado = sg && changesLicenseSplitCanonicalGood(sg.value) === 'terminado';

    if (selBad && adminLicenseNormalizeStatusKey(String(selBad.value || '').trim()) === 'otro') {
        const d = oc ? String(oc.value || '').trim().replace(/^otro-?/i, '') : '';
        if (!d) {
            showError('Describe el problema en «Otro» antes de usar la flecha o marcar «Terminado».');
            if (terminado) {
                changesLicenseSplitRevertTerminadoSelect(row);
            }
            return;
        }
    }

    if (changesLicenseSplitRowHasResolvableIncident(row)) {
        await changesLicenseSplitFinalizeIncidentToSuspended(row);
        return;
    }
    if (terminado) {
        await changesLicenseSplitRestoreRowToLicense(row);
        return;
    }
    showError(
        'Elige un motivo en la columna roja (p. ej. Caída o suspendida) y pulsa la flecha para archivar en Caídas, o marca «Terminado» para devolver la cuenta a Licencias sin incidencia.'
    );
}

async function changesLicenseSplitResolveTerminadoRow(row) {
    return changesLicenseSplitResolveOutboundRow(row);
}

function changesLicenseSplitWireScrollSync(root) {
    const r = root;
    if (!r) return;
    const ta = changesLicenseSplitQueryCredsTa(r);
    const rows = changesLicenseSplitQueryRowsWrap(r);
    if (!ta || !rows || ta.dataset.chScrollSync === '1') return;
    ta.dataset.chScrollSync = '1';
    let syncing = false;
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

async function changesLicenseSplitRestoreRowToLicense(row) {
    if (!row || window.__changesLicenseSplitRestoreInFlight) return;
    const root = row.closest('.changes-license-split-root');
    if (!root) return;
    const licenseId = parseInt(root.dataset.licenseId, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto (no «Todos») para devolver licencias al bloc Licencias.');
        return;
    }
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    let activeId =
        inputContainer && inputContainer.dataset.activeLicenseId != null
            ? parseInt(inputContainer.dataset.activeLicenseId, 10)
            : NaN;
    let taLicMain = document.getElementById('adminLicenciasNotepadByLicense');
    const gridMatches = Number.isFinite(activeId) && activeId === licenseId;
    const mainBlocMatches =
        taLicMain &&
        taLicMain.tagName === 'TEXTAREA' &&
        parseInt(taLicMain.dataset.licenseId, 10) === licenseId;
    if (!gridMatches || !mainBlocMatches) {
        const card = document.querySelector(
            '.license-card[data-license-id="' + licenseId + '"]:not(.license-card--aggregate)'
        );
        if (!card) {
            showError('No se encontró el producto en la cuadrícula.');
            return;
        }
        _adminLicSkipNextChangesProductsRefreshOnce = true;
        try {
            await activateLicenseCard(card, licenseId, true, { preserveSidebar: true });
        } catch (activateErr) {
            console.error('changesLicenseSplitRestoreRowToLicense: activateLicenseCard', activateErr);
            _adminLicSkipNextChangesProductsRefreshOnce = false;
            showError('No se pudo preparar el bloc Licencias de este producto.');
            return;
        } finally {
            if (_adminLicSkipNextChangesProductsRefreshOnce) {
                _adminLicSkipNextChangesProductsRefreshOnce = false;
            }
        }
        taLicMain = document.getElementById('adminLicenciasNotepadByLicense');
        activeId =
            inputContainer && inputContainer.dataset.activeLicenseId != null
                ? parseInt(inputContainer.dataset.activeLicenseId, 10)
                : NaN;
        if (!Number.isFinite(activeId) || activeId !== licenseId) {
            showError('No se pudo sincronizar el producto con la cuadrícula.');
            return;
        }
        if (!taLicMain || parseInt(taLicMain.dataset.licenseId, 10) !== licenseId) {
            showError('El bloc Licencias no coincide con este producto.');
            return;
        }
    }

    const ta = changesLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const rows = changesLicenseSplitGetRowElements(root);
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) return;
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return;
    }
    const r = adminLicenseSplitReadRow(row);
    if (adminLicenseNormalizeStatusKey(r.statusGood) !== 'terminado') {
        showError('Marca «Terminado» en la columna verde antes de devolver la cuenta a Licencias.');
        return;
    }
    const lineToMove = buildAdminLicenseStorageLine(cred, '', '', '', '').trim();
    if (!lineToMove) {
        showError('No hay datos válidos para mover.');
        return;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                '',
                rr.statusGood != null ? rr.statusGood : '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newChangesMerged = newMergedLines.join('\n');
    const oldChangesMerged = changesLicenseSplitGetMergedText(root);
    const oldLicenseMerged = adminLicenseSplitGetMergedNotes();
    const licLines = oldLicenseMerged.replace(/\r\n/g, '\n').split('\n');
    while (licLines.length && licLines[licLines.length - 1] === '') {
        licLines.pop();
    }
    licLines.push(lineToMove);
    const newLicenseMerged = licLines.join('\n');

    window.__changesLicenseSplitRestoreInFlight = true;
    try {
        changesLicenseSplitApplyMergedText(root, newChangesMerged);
        adminLicenseSplitApplyMergedText(newLicenseMerged);
        const saveLicRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveLicRes || !saveLicRes.success) {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
            changesLicenseSplitApplyMergedText(root, oldChangesMerged);
            showError('No se pudo guardar. Revisa la conexión.');
            return;
        }
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateChangesBlocLineCountBadge === 'function') {
            window.updateChangesBlocLineCountBadge();
        }
        /* Permanecer en Cambios; no cerrar panel ni llevar foco al bloc Licencias del servicio. */
        window.requestAnimationFrame(function () {
            var sec = document.querySelector(
                '[data-changes-product-license-id="' + licenseId + '"]'
            );
            if (sec && typeof sec.scrollIntoView === 'function') {
                sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else if (typeof scrollAdminLicenciasCambiosPanelIntoView === 'function') {
                scrollAdminLicenciasCambiosPanelIntoView();
            }
        });
    } catch (err) {
        console.error('changesLicenseSplitRestoreRowToLicense', err);
        try {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
        } catch (e2) {
            console.error(e2);
        }
        try {
            changesLicenseSplitApplyMergedText(root, oldChangesMerged);
        } catch (e3) {
            console.error(e3);
        }
        showError('No se pudo completar. Revisa los blocs o recarga la página si hace falta.');
    } finally {
        window.__changesLicenseSplitRestoreInFlight = false;
    }
}

window.changesLicenseSplitGetMergedText = changesLicenseSplitGetMergedText;
window.changesLicenseSplitApplyMergedText = changesLicenseSplitApplyMergedText;
window.changesLicenseSplitSyncRowsToTextarea = changesLicenseSplitSyncRowsToTextarea;
window.changesLicenseSplitScheduleAutosize = changesLicenseSplitScheduleAutosize;
window.changesLicenseSplitLock = changesLicenseSplitLock;
window.changesLicenseSplitUnlock = changesLicenseSplitUnlock;
window.changesLicenseSplitWireScrollSync = changesLicenseSplitWireScrollSync;
window.changesLicenseSplitRestoreRowToLicense = changesLicenseSplitRestoreRowToLicense;
window.changesLicenseSplitResolveOutboundRow = changesLicenseSplitResolveOutboundRow;
window.changesLicenseSplitResolveTerminadoRow = changesLicenseSplitResolveTerminadoRow;

async function adminLicenseSplitMoveRowToChanges(row) {
    if (!row || window.__adminLicenseSplitMoveToChangesInFlight) return;
    const licRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!licRoot || !licRoot.contains(row)) {
        showError('Usa una fila del bloc Licencias.');
        return;
    }
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const licenseId = parseInt(ta.dataset.licenseId, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Abre un producto concreto (no «Todos») para enviar cuentas a Cambios.');
        return;
    }
    const lic = licenses.find(function (l) {
        return l.id === licenseId;
    });
    if (!lic || !licenseBaseEligibleForChangesPanel(lic)) {
        showError('No se puede enviar a Cambios desde este producto.');
        return;
    }
    const rows = adminLicenseSplitGetRowElements();
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) return;
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return;
    }
    const lineToMove = buildAdminLicenseStorageLine(cred, '', '', '', '').trim();
    if (!lineToMove) {
        showError('No hay datos válidos para mover.');
        return;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                rr.user,
                rr.statusGood != null ? rr.statusGood : '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newLicMerged = newMergedLines.join('\n');
    const oldLicMerged = adminLicenseSplitGetMergedNotes();
    let chRoot = document.querySelector(
        '#licenseChangesProductsContainer .changes-license-split-root[data-license-id="' + licenseId + '"]'
    );
    let oldCh = lic.changes_notes != null ? String(lic.changes_notes) : '';
    if (chRoot && typeof changesLicenseSplitGetMergedText === 'function') {
        oldCh = changesLicenseSplitGetMergedText(chRoot);
    }
    const chPrev = String(oldCh != null ? oldCh : '').replace(/\r\n/g, '\n').trimEnd();
    const combined = chPrev ? chPrev + '\n' + lineToMove : lineToMove;

    window.__adminLicenseSplitMoveToChangesInFlight = true;
    try {
        adminLicenseSplitApplyMergedText(newLicMerged);
        if (typeof patchLicenseChangesNotesInCacheOnly === 'function') {
            patchLicenseChangesNotesInCacheOnly(licenseId, combined);
        } else {
            lic.changes_notes = combined;
        }
        if (typeof refreshChangesProductsListing === 'function') {
            refreshChangesProductsListing();
        }
        chRoot = document.querySelector(
            '#licenseChangesProductsContainer .changes-license-split-root[data-license-id="' + licenseId + '"]'
        );
        if (!chRoot) {
            adminLicenseSplitApplyMergedText(oldLicMerged);
            if (typeof patchLicenseChangesNotesInCacheOnly === 'function') {
                patchLicenseChangesNotesInCacheOnly(licenseId, oldCh);
            } else {
                lic.changes_notes = oldCh;
            }
            if (typeof refreshChangesProductsListing === 'function') {
                refreshChangesProductsListing();
            }
            showError('No se pudo abrir el bloc Cambios. Recarga la página.');
            return;
        }
        changesLicenseSplitApplyMergedText(chRoot, combined);
        const saveRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveRes || !saveRes.success) {
            adminLicenseSplitApplyMergedText(oldLicMerged);
            if (typeof patchLicenseChangesNotesInCacheOnly === 'function') {
                patchLicenseChangesNotesInCacheOnly(licenseId, oldCh);
            } else {
                lic.changes_notes = oldCh;
            }
            if (typeof refreshChangesProductsListing === 'function') {
                refreshChangesProductsListing();
            }
            chRoot = document.querySelector(
                '#licenseChangesProductsContainer .changes-license-split-root[data-license-id="' + licenseId + '"]'
            );
            if (chRoot) {
                changesLicenseSplitApplyMergedText(chRoot, oldCh);
            }
            showError('No se pudo guardar. Revisa la conexión.');
            return;
        }
        showSuccess('Cuenta enviada a Cambios.');
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        if (typeof window.updateChangesBlocLineCountBadge === 'function') {
            window.updateChangesBlocLineCountBadge();
        }
        const chSection = document.querySelector(
            '.admin-licencias-bloc--changes-product[data-changes-product-license-id="' + licenseId + '"]'
        );
        if (chSection && typeof chSection.scrollIntoView === 'function') {
            chSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (err) {
        console.error('adminLicenseSplitMoveRowToChanges', err);
        adminLicenseSplitApplyMergedText(oldLicMerged);
        try {
            if (typeof patchLicenseChangesNotesInCacheOnly === 'function') {
                patchLicenseChangesNotesInCacheOnly(licenseId, oldCh);
            } else if (lic) {
                lic.changes_notes = oldCh;
            }
            if (typeof refreshChangesProductsListing === 'function') {
                refreshChangesProductsListing();
            }
            const rrb = document.querySelector(
                '#licenseChangesProductsContainer .changes-license-split-root[data-license-id="' + licenseId + '"]'
            );
            if (rrb) {
                changesLicenseSplitApplyMergedText(rrb, oldCh);
            }
        } catch (e2) {
            console.error(e2);
        }
        showError('No se pudo enviar a Cambios.');
    } finally {
        window.__adminLicenseSplitMoveToChangesInFlight = false;
    }
}

window.adminLicenseSplitMoveRowToChanges = adminLicenseSplitMoveRowToChanges;

/**
 * Sube una fila del día al bloc Licencias (misma licencia que el día; debe estar abierta en la cuadrícula).
 */
async function dayLicenseSplitRestoreRowToLicense(row) {
    if (!row || window.__dayLicenseSplitRestoreInFlight) return;
    const root = row.closest('.day-license-split-root');
    if (!root) return;
    const licenseId = parseInt(root.dataset.licenseId, 10);
    const day = parseInt(root.dataset.day, 10);
    if (!Number.isFinite(licenseId) || licenseId === AGGREGATE_LICENSE_ID) {
        showError('Selecciona un producto concreto (no «Todos») para devolver licencias al bloc Licencias.');
        return;
    }
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    const activeId =
        inputContainer && inputContainer.dataset.activeLicenseId != null
            ? parseInt(inputContainer.dataset.activeLicenseId, 10)
            : NaN;
    if (!Number.isFinite(activeId) || activeId !== licenseId) {
        showError('Abre el mismo producto en la cuadrícula para devolver esta licencia al bloc Licencias.');
        return;
    }
    const taLic = document.getElementById('adminLicenciasNotepadByLicense');
    if (!taLic || parseInt(taLic.dataset.licenseId, 10) !== licenseId) {
        showError('El bloc Licencias no coincide con este día. Abre la licencia correcta.');
        return;
    }

    const ta = dayLicenseSplitQueryCredsTa(root);
    if (!ta) return;
    const rows = dayLicenseSplitGetRowElements(root);
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const credLines = licenseSplitCredLinesFromRaw(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    if (idx >= credLines.length) return;
    const cred = credLines[idx] != null ? credLines[idx] : '';
    if (!String(cred).trim()) {
        showError('Esta fila no tiene credencial.');
        return;
    }
    const r = adminLicenseSplitReadRow(row);
    const lineToMove = buildAdminLicenseStorageLine(
        cred,
        r.user,
        r.statusGood != null ? r.statusGood : '',
        r.statusBad != null ? r.statusBad : '',
        r.extra
    ).trim();
    if (!lineToMove) {
        showError('No hay datos válidos para mover.');
        return;
    }

    const newCredLines = credLines.slice(0, idx).concat(credLines.slice(idx + 1));
    const newMergedLines = [];
    for (let i = 0; i < newCredLines.length; i++) {
        const oldRowIdx = i < idx ? i : i + 1;
        const rrow = rows[oldRowIdx];
        const rr = rrow
            ? adminLicenseSplitReadRow(rrow)
            : { user: '', statusGood: '', statusBad: '', extra: '' };
        newMergedLines.push(
            buildAdminLicenseStorageLine(
                newCredLines[i],
                rr.user,
                rr.statusGood != null ? rr.statusGood : '',
                rr.statusBad != null ? rr.statusBad : '',
                rr.extra
            )
        );
    }
    while (newMergedLines.length && newMergedLines[newMergedLines.length - 1] === '') {
        newMergedLines.pop();
    }
    const newDayMerged = newMergedLines.join('\n');
    const oldDayMerged = dayLicenseSplitGetMergedText(root);
    const oldLicenseMerged = adminLicenseSplitGetMergedNotes();
    const licLines = oldLicenseMerged.replace(/\r\n/g, '\n').split('\n');
    while (licLines.length && licLines[licLines.length - 1] === '') {
        licLines.pop();
    }
    licLines.push(lineToMove);
    const newLicenseMerged = licLines.join('\n');

    window.__dayLicenseSplitRestoreInFlight = true;
    try {
        dayLicenseSplitApplyMergedText(root, newDayMerged);
        try {
            await syncDayNotepad(licenseId, day, dayLicenseSplitGetMergedText(root));
        } catch (errDay) {
            console.error(errDay);
            dayLicenseSplitApplyMergedText(root, oldDayMerged);
            showError('No se pudo guardar el día. Revisa la conexión.');
            return;
        }

        adminLicenseSplitApplyMergedText(newLicenseMerged);
        const saveLicRes =
            typeof window.adminLicenciasSaveCurrentLicenseNotesImmediate === 'function'
                ? await window.adminLicenciasSaveCurrentLicenseNotesImmediate()
                : { success: false, error: 'no_save_fn' };
        if (!saveLicRes || !saveLicRes.success) {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
            try {
                await syncDayNotepad(licenseId, day, oldDayMerged);
            } catch (revErr) {
                console.error(revErr);
            }
            showError('No se pudo guardar el bloc Licencias. El día se restauró en el servidor.');
            return;
        }

        const dayRootAfter = document.querySelector(
            `#licenseAllDaysContainer .day-license-split-root[data-day="${day}"][data-license-id="${licenseId}"]`
        );
        saveDayDraftLocal(
            licenseId,
            day,
            dayRootAfter ? dayLicenseSplitGetMergedText(dayRootAfter) : newDayMerged
        );
        showSuccess('Licencia devuelta al bloc Licencias.');
        if (typeof refreshDuplicateEmailHighlights === 'function') {
            refreshDuplicateEmailHighlights(licenseId);
        }
        if (typeof window.refreshAdminDuplicateHighlightsIfActive === 'function') {
            window.refreshAdminDuplicateHighlightsIfActive();
        }
        const licSplit = document.getElementById('adminLicenciasLicenseSplitRoot');
        if (licSplit && typeof licSplit.scrollIntoView === 'function') {
            licSplit.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (err) {
        console.error('dayLicenseSplitRestoreRowToLicense', err);
        try {
            adminLicenseSplitApplyMergedText(oldLicenseMerged);
        } catch (e2) {
            console.error(e2);
        }
        try {
            await syncDayNotepad(licenseId, day, oldDayMerged);
        } catch (e3) {
            console.error(e3);
        }
        showError('No se pudo completar. Revisa los blocs o recarga la página si hace falta.');
    } finally {
        window.__dayLicenseSplitRestoreInFlight = false;
    }
}

window.dayLicenseSplitRestoreRowToLicense = dayLicenseSplitRestoreRowToLicense;

if (!window.__dayLicenseSplitRestoreClickWired) {
    window.__dayLicenseSplitRestoreClickWired = true;
    document.addEventListener(
        'click',
        function (e) {
            const btn = e.target.closest && e.target.closest('.license-split-editor__restore-to-license-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const row = btn.closest('.license-split-editor__row');
            if (!row) return;
            if (
                row.classList.contains('license-split-editor__row--suspended') &&
                typeof window.suspendedLicenseSplitRestoreRowToLicense === 'function'
            ) {
                window.suspendedLicenseSplitRestoreRowToLicense(row);
            } else if (
                row.classList.contains('license-split-editor__row--expired') &&
                typeof window.expiredLicenseSplitRestoreRowToLicense === 'function'
            ) {
                window.expiredLicenseSplitRestoreRowToLicense(row);
            } else if (
                row.classList.contains('license-split-editor__row--changes') &&
                typeof window.changesLicenseSplitResolveOutboundRow === 'function'
            ) {
                window.changesLicenseSplitResolveOutboundRow(row);
            } else if (typeof window.dayLicenseSplitRestoreRowToLicense === 'function') {
                window.dayLicenseSplitRestoreRowToLicense(row);
            }
        },
        false
    );
}

function adminLicenseSplitSyncRowsToTextarea() {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta) return;
    adminMainLicenseNormalizeCredTaTrailingRunsIfBlur(ta);
    const credLines = adminMainLicenseCredLinesCollapsed(String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n'));
    adminLicenseSplitSyncRowCount(adminMainLicenseBlocSyncRowCountFromCollapsed(credLines));
    adminLicenseSplitCascadeClearSidesForEmptyCredLines();
    adminLicenseSplitScheduleAutosizeCreds();
}

/** Cuando cambia la altura del panel de filas, el bloc izquierdo debe igualarla. */
function ensureAdminLicenseSplitRowsResizeObserver() {
    const rows = document.getElementById('adminLicenciasStructuredRows');
    if (!rows || rows.dataset.licSplitResizeObs === '1') return;
    if (typeof ResizeObserver === 'undefined') return;
    rows.dataset.licSplitResizeObs = '1';
    let debounceT = null;
    const ro = new ResizeObserver(function () {
        clearTimeout(debounceT);
        debounceT = setTimeout(function () {
            adminLicenseSplitAutosizeCredsTextarea();
        }, 16);
    });
    ro.observe(rows);
}

/** Refuerzo de layout: varios frames y fuentes cargadas (evita scroll interno en el textarea). */
function adminLicenseSplitScheduleAutosizeCreds() {
    ensureAdminLicenseSplitRowsResizeObserver();
    adminLicenseSplitAutosizeCredsTextarea();
    window.requestAnimationFrame(function () {
        adminLicenseSplitAutosizeCredsTextarea();
        window.requestAnimationFrame(function () {
            adminLicenseSplitAutosizeCredsTextarea();
        });
    });
    try {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                adminLicenseSplitAutosizeCredsTextarea();
            });
        }
    } catch (e) {}
}

function adminLicSplitParseLineHeightPx(cs) {
    const lh = cs.lineHeight;
    const fs = parseFloat(cs.fontSize) || 14;
    if (!lh || lh === 'normal') return fs * 1.45;
    if (String(lh).indexOf('px') !== -1) return parseFloat(lh) || fs * 1.45;
    const n = parseFloat(lh);
    return Number.isFinite(n) ? n * fs : fs * 1.45;
}

/**
 * Altura del bloc credenciales = máximo(texto, panel derecho); siempre mismo nº de filas que líneas.
 */
function adminLicenseSplitAutosizeCredsTextarea() {
    const ta = document.getElementById('adminLicenciasNotepadByLicense');
    if (!ta || ta.tagName !== 'TEXTAREA' || !ta.classList.contains('license-split-editor__creds')) return;
    adminMainLicenseNormalizeCredTaTrailingRunsIfBlur(ta);
    const splitSide = document.querySelector('#adminLicenciasLicenseSplitRoot .license-split-editor__side');
    const rowsEl = document.getElementById('adminLicenciasStructuredRows');
    const raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
    const credLines = adminMainLicenseCredLinesCollapsed(raw);
    const lineCountEff = adminMainLicenseBlocSyncRowCountFromCollapsed(credLines);
    adminLicenseSplitSyncRowCount(lineCountEff);
    adminLicenseSplitCascadeClearSidesForEmptyCredLines();

    const csEarly = window.getComputedStyle(ta);
    const linePx = adminLicSplitParseLineHeightPx(csEarly);
    const padY = (parseFloat(csEarly.paddingTop) || 0) + (parseFloat(csEarly.paddingBottom) || 0);
    const nominalOneLine = Math.ceil(linePx + padY + 4);
    const tallMin = 112;

    if (splitSide && splitSide.hidden) {
        ta.style.minHeight = '0';
        ta.style.height = '0px';
        const ns = ta.scrollHeight;
        ta.style.minHeight = '';
        ta.style.height = '';
        const cs = window.getComputedStyle(ta);
        let minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = 20;
        const floorHidden = Math.max(minPx, nominalOneLine);
        ta.style.height = Math.max(floorHidden, ns + 2) + 'px';
        licenseSplitSyncCredsTaContentWidth(ta);
        return;
    }

    if (rowsEl) {
        void rowsEl.offsetHeight;
    }

    const cs0 = window.getComputedStyle(ta);
    const padY2 = (parseFloat(cs0.paddingTop) || 0) + (parseFloat(cs0.paddingBottom) || 0);
    const nEst = credLines.length === 0 ? 1 : credLines.length;
    const estimateByLines = adminLicSplitParseLineHeightPx(cs0) * nEst + padY2;

    ta.style.minHeight = '0';
    ta.style.height = '0px';
    const naturalScroll = ta.scrollHeight;
    ta.style.minHeight = '';
    ta.style.height = '';

    let peerH = 0;
    if (rowsEl) {
        peerH = Math.max(rowsEl.scrollHeight, rowsEl.offsetHeight);
    }
    if (splitSide) {
        peerH = Math.max(peerH, splitSide.scrollHeight, splitSide.offsetHeight);
    }

    const cs = window.getComputedStyle(ta);
    let minPx = parseFloat(cs.minHeight);
    if (Number.isNaN(minPx)) minPx = 20;
    const nominalOneLine2 = Math.ceil(adminLicSplitParseLineHeightPx(cs) + padY2 + 4);
    const floorPx = Math.max(minPx, nominalOneLine2);
    const contentH = Math.max(naturalScroll + 2, estimateByLines);
    const h = Math.max(floorPx, contentH, peerH);
    ta.style.height = Math.ceil(h) + 'px';
    licenseSplitSyncCredsTaContentWidth(ta);
}

window.adminLicenseSplitApplyMergedText = adminLicenseSplitApplyMergedText;
window.adminLicenseSplitGetMergedNotes = adminLicenseSplitGetMergedNotes;
window.adminLicenseSplitSyncRowsToTextarea = adminLicenseSplitSyncRowsToTextarea;
window.adminLicenseSplitValidateAllUserInputs = adminLicenseSplitValidateAllUserInputs;
window.adminLicenseSplitAutosizeCredsTextarea = adminLicenseSplitAutosizeCredsTextarea;
window.adminLicenseSplitScheduleAutosizeCreds = adminLicenseSplitScheduleAutosizeCreds;
window.adminMainLicenseNormalizeCredTaTrailingRunsIfBlur = adminMainLicenseNormalizeCredTaTrailingRunsIfBlur;

var ADMIN_LICENSE_SHOW_LIMIT_KEY = 'admin_licencias_license_show_limit_v1';

function adminLicenseShowLimitReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_LICENSE_SHOW_LIMIT_KEY);
        if (v === '20' || v === '50' || v === '100' || v === '300' || v === 'all') {
            return v;
        }
    } catch (e) {
        /* ignore */
    }
    return 'all';
}

function adminLicenseShowLimitNormalize(val) {
    var v = String(val != null ? val : 'all').trim();
    if (v === '20' || v === '50' || v === '100' || v === '300' || v === 'all') {
        return v;
    }
    return 'all';
}

function adminLicenseShowLimitApply() {
    var sel = document.getElementById('adminLicenciasLicenseShowSelect');
    var root = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!root) return;
    var val = adminLicenseShowLimitNormalize(sel ? sel.value : adminLicenseShowLimitReadStored());
    root.setAttribute('data-license-viz', val);
    try {
        localStorage.setItem(ADMIN_LICENSE_SHOW_LIMIT_KEY, val);
    } catch (e) {
        /* ignore */
    }
}

function adminLicenseShowLimitSyncUi() {
    var sel = document.getElementById('adminLicenciasLicenseShowSelect');
    var root = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!root) return;
    var val = adminLicenseShowLimitReadStored();
    val = adminLicenseShowLimitNormalize(val);
    if (sel) {
        sel.value = val;
    }
    root.setAttribute('data-license-viz', val);
}

window.adminLicenseShowLimitApply = adminLicenseShowLimitApply;
window.adminLicenseShowLimitSyncUi = adminLicenseShowLimitSyncUi;

var ADMIN_LICENSE_HIDE_NOTES_COL_KEY = 'admin_licencias_license_hide_notes_col_v1';

function adminLicenseHideNotesColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_LICENSE_HIDE_NOTES_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminLicenseHideNotesColApply(hidden) {
    var root = document.getElementById('adminLicenciasLicenseSplitRoot');
    var btn = document.getElementById('adminLicenciasToggleNotesColBtn');
    if (!root) return;
    var hid = !!hidden;
    if (hid) {
        root.classList.add('license-split-editor--notes-hidden');
    } else {
        root.classList.remove('license-split-editor--notes-hidden');
    }
    try {
        localStorage.setItem(ADMIN_LICENSE_HIDE_NOTES_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columna Notas';
            btn.setAttribute('aria-label', 'Mostrar columna Notas de cada fila');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columna Notas';
            btn.setAttribute('aria-label', 'Ocultar columna Notas de cada fila');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    if (typeof window.adminLicenseSplitScheduleAutosizeCreds === 'function') {
        window.adminLicenseSplitScheduleAutosizeCreds();
    }
}

function adminLicenseHideNotesColToggle() {
    var root = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!root) return;
    var now = root.classList.contains('license-split-editor--notes-hidden');
    adminLicenseHideNotesColApply(!now);
}

function adminLicenseHideNotesColSyncUi() {
    adminLicenseHideNotesColApply(adminLicenseHideNotesColReadStored());
}

window.adminLicenseHideNotesColApply = adminLicenseHideNotesColApply;
window.adminLicenseHideNotesColSyncUi = adminLicenseHideNotesColSyncUi;
window.adminLicenseHideNotesColToggle = adminLicenseHideNotesColToggle;

var ADMIN_SUSPENDED_HIDE_NOTES_COL_KEY = 'admin_licencias_suspended_hide_notes_col_v1';

function adminSuspendedHideNotesColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_SUSPENDED_HIDE_NOTES_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminSuspendedHideNotesColApply(hidden) {
    var root = document.getElementById('adminLicenciasSuspendedSplitRoot');
    var btn = document.getElementById('adminLicenciasToggleSuspendedNotesColBtn');
    if (!root) return;
    var hid = !!hidden;
    if (hid) {
        root.classList.add('license-split-editor--notes-hidden');
    } else {
        root.classList.remove('license-split-editor--notes-hidden');
    }
    try {
        localStorage.setItem(ADMIN_SUSPENDED_HIDE_NOTES_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columna Notas';
            btn.setAttribute('aria-label', 'Mostrar columna Notas en caídas');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columna Notas';
            btn.setAttribute('aria-label', 'Ocultar columna Notas en caídas');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    if (typeof window.suspendedLicenseSplitScheduleAutosize === 'function') {
        window.suspendedLicenseSplitScheduleAutosize();
    }
}

function adminSuspendedHideNotesColToggle() {
    var root = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (!root) return;
    var now = root.classList.contains('license-split-editor--notes-hidden');
    adminSuspendedHideNotesColApply(!now);
}

function adminSuspendedHideNotesColSyncUi() {
    adminSuspendedHideNotesColApply(adminSuspendedHideNotesColReadStored());
}

window.adminSuspendedHideNotesColApply = adminSuspendedHideNotesColApply;
window.adminSuspendedHideNotesColSyncUi = adminSuspendedHideNotesColSyncUi;
window.adminSuspendedHideNotesColToggle = adminSuspendedHideNotesColToggle;

var ADMIN_SUSPENDED_HIDE_RESTORE_COL_KEY = 'admin_licencias_suspended_hide_restore_col_v1';

function adminSuspendedHideRestoreColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_SUSPENDED_HIDE_RESTORE_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminSuspendedHideRestoreColApply(hidden) {
    var root = document.getElementById('adminLicenciasSuspendedSplitRoot');
    var btn = document.getElementById('adminLicenciasToggleSuspendedRestoreColBtn');
    if (!root) return;
    var hid = !!hidden;
    if (hid) {
        root.classList.add('license-split-editor--suspended-restore-hidden');
    } else {
        root.classList.remove('license-split-editor--suspended-restore-hidden');
    }
    try {
        localStorage.setItem(ADMIN_SUSPENDED_HIDE_RESTORE_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar flecha subir a Licencias';
            btn.setAttribute('aria-label', 'Mostrar botón subir a Licencias en caídas');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar flecha subir a Licencias';
            btn.setAttribute('aria-label', 'Ocultar botón subir a Licencias en caídas');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    if (typeof window.suspendedLicenseSplitScheduleAutosize === 'function') {
        window.suspendedLicenseSplitScheduleAutosize();
    }
}

function adminSuspendedHideRestoreColToggle() {
    var root = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (!root) return;
    var now = root.classList.contains('license-split-editor--suspended-restore-hidden');
    adminSuspendedHideRestoreColApply(!now);
}

function adminSuspendedHideRestoreColSyncUi() {
    adminSuspendedHideRestoreColApply(adminSuspendedHideRestoreColReadStored());
}

window.adminSuspendedHideRestoreColApply = adminSuspendedHideRestoreColApply;
window.adminSuspendedHideRestoreColSyncUi = adminSuspendedHideRestoreColSyncUi;
window.adminSuspendedHideRestoreColToggle = adminSuspendedHideRestoreColToggle;

var ADMIN_EXPIRED_HIDE_NOTES_COL_KEY = 'admin_licencias_expired_hide_notes_col_v1';

function adminExpiredHideNotesColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_EXPIRED_HIDE_NOTES_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminExpiredHideNotesColApply(hidden) {
    var root = document.getElementById('adminLicenciasExpiredSplitRoot');
    var btn = document.getElementById('adminLicenciasToggleExpiredNotesColBtn');
    if (!root) return;
    var hid = !!hidden;
    if (hid) {
        root.classList.add('license-split-editor--notes-hidden');
    } else {
        root.classList.remove('license-split-editor--notes-hidden');
    }
    try {
        localStorage.setItem(ADMIN_EXPIRED_HIDE_NOTES_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columna Notas';
            btn.setAttribute('aria-label', 'Mostrar columna Notas en vencidas');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columna Notas';
            btn.setAttribute('aria-label', 'Ocultar columna Notas en vencidas');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    if (typeof window.expiredLicenseSplitScheduleAutosize === 'function') {
        window.expiredLicenseSplitScheduleAutosize();
    }
}

function adminExpiredHideNotesColToggle() {
    var root = document.getElementById('adminLicenciasExpiredSplitRoot');
    if (!root) return;
    var now = root.classList.contains('license-split-editor--notes-hidden');
    adminExpiredHideNotesColApply(!now);
}

function adminExpiredHideNotesColSyncUi() {
    adminExpiredHideNotesColApply(adminExpiredHideNotesColReadStored());
}

window.adminExpiredHideNotesColApply = adminExpiredHideNotesColApply;
window.adminExpiredHideNotesColSyncUi = adminExpiredHideNotesColSyncUi;
window.adminExpiredHideNotesColToggle = adminExpiredHideNotesColToggle;

var ADMIN_EXPIRED_HIDE_RESTORE_COL_KEY = 'admin_licencias_expired_hide_restore_col_v1';

function adminExpiredHideRestoreColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_EXPIRED_HIDE_RESTORE_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminExpiredHideRestoreColApply(hidden) {
    var root = document.getElementById('adminLicenciasExpiredSplitRoot');
    var btn = document.getElementById('adminLicenciasToggleExpiredRestoreColBtn');
    if (!root) return;
    var hid = !!hidden;
    if (hid) {
        root.classList.add('license-split-editor--expired-restore-hidden');
    } else {
        root.classList.remove('license-split-editor--expired-restore-hidden');
    }
    try {
        localStorage.setItem(ADMIN_EXPIRED_HIDE_RESTORE_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar flecha subir a Licencias';
            btn.setAttribute('aria-label', 'Mostrar botón subir a Licencias en vencidas');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar flecha subir a Licencias';
            btn.setAttribute('aria-label', 'Ocultar botón subir a Licencias en vencidas');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    if (typeof window.expiredLicenseSplitScheduleAutosize === 'function') {
        window.expiredLicenseSplitScheduleAutosize();
    }
}

function adminExpiredHideRestoreColToggle() {
    var root = document.getElementById('adminLicenciasExpiredSplitRoot');
    if (!root) return;
    var now = root.classList.contains('license-split-editor--expired-restore-hidden');
    adminExpiredHideRestoreColApply(!now);
}

function adminExpiredHideRestoreColSyncUi() {
    adminExpiredHideRestoreColApply(adminExpiredHideRestoreColReadStored());
}

window.adminExpiredHideRestoreColApply = adminExpiredHideRestoreColApply;
window.adminExpiredHideRestoreColSyncUi = adminExpiredHideRestoreColSyncUi;
window.adminExpiredHideRestoreColToggle = adminExpiredHideRestoreColToggle;

var ADMIN_DAYS_HIDE_RESTORE_COL_KEY = 'admin_licencias_days_hide_restore_col_v1';

function adminDaysHideRestoreColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_DAYS_HIDE_RESTORE_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminDaysHideRestoreColApply(hidden) {
    var container = document.getElementById('licenseAllDaysContainer');
    var btn = document.getElementById('adminLicenciasToggleDaysRestoreColBtn');
    if (!container) return;
    var roots = container.querySelectorAll('.day-license-split-root');
    var hid = !!hidden;
    roots.forEach(function (root) {
        if (hid) {
            root.classList.add('license-split-editor--day-restore-hidden');
        } else {
            root.classList.remove('license-split-editor--day-restore-hidden');
        }
    });
    try {
        localStorage.setItem(ADMIN_DAYS_HIDE_RESTORE_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar flecha subir a Licencias en días';
            btn.setAttribute('aria-label', 'Mostrar botón subir a Licencias en cada día');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar flecha subir a Licencias en días';
            btn.setAttribute('aria-label', 'Ocultar botón subir a Licencias en cada día');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    roots.forEach(function (root) {
        if (typeof dayLicenseSplitScheduleAutosize === 'function') {
            dayLicenseSplitScheduleAutosize(root);
        }
    });
}

function adminDaysHideRestoreColToggle() {
    adminDaysHideRestoreColApply(!adminDaysHideRestoreColReadStored());
}

function adminDaysHideRestoreColSyncUi() {
    adminDaysHideRestoreColApply(adminDaysHideRestoreColReadStored());
}

window.adminDaysHideRestoreColApply = adminDaysHideRestoreColApply;
window.adminDaysHideRestoreColSyncUi = adminDaysHideRestoreColSyncUi;
window.adminDaysHideRestoreColToggle = adminDaysHideRestoreColToggle;

var ADMIN_DAYS_HIDE_STATUS_COL_KEY = 'admin_licencias_days_hide_status_col_v1';

function adminDaysHideStatusColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_DAYS_HIDE_STATUS_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminDaysHideStatusColApply(hidden) {
    var container = document.getElementById('licenseAllDaysContainer');
    var btn = document.getElementById('adminLicenciasToggleDaysStatusColBtn');
    if (!container) return;
    var roots = container.querySelectorAll('.day-license-split-root');
    var hid = !!hidden;
    roots.forEach(function (root) {
        if (hid) {
            root.classList.add('license-split-editor--status-hidden');
        } else {
            root.classList.remove('license-split-editor--status-hidden');
        }
    });
    try {
        localStorage.setItem(ADMIN_DAYS_HIDE_STATUS_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columnas Estado (verde y rojo) en días';
            btn.setAttribute('aria-label', 'Mostrar columnas Estado verde y rojo en cada día');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columnas Estado (verde y rojo) en días';
            btn.setAttribute('aria-label', 'Ocultar columnas Estado verde y rojo en cada día');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    roots.forEach(function (root) {
        if (typeof dayLicenseSplitScheduleAutosize === 'function') {
            dayLicenseSplitScheduleAutosize(root);
        }
    });
}

function adminDaysHideStatusColToggle() {
    adminDaysHideStatusColApply(!adminDaysHideStatusColReadStored());
}

function adminDaysHideStatusColSyncUi() {
    adminDaysHideStatusColApply(adminDaysHideStatusColReadStored());
}

window.adminDaysHideStatusColApply = adminDaysHideStatusColApply;
window.adminDaysHideStatusColSyncUi = adminDaysHideStatusColSyncUi;
window.adminDaysHideStatusColToggle = adminDaysHideStatusColToggle;

var ADMIN_DAYS_HIDE_NOTES_COL_KEY = 'admin_licencias_days_hide_notes_col_v1';

function adminDaysHideNotesColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_DAYS_HIDE_NOTES_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminDaysHideNotesColApply(hidden) {
    var container = document.getElementById('licenseAllDaysContainer');
    var btn = document.getElementById('adminLicenciasToggleDaysNotesColBtn');
    if (!container) return;
    var roots = container.querySelectorAll('.day-license-split-root');
    var hid = !!hidden;
    roots.forEach(function (root) {
        if (hid) {
            root.classList.add('license-split-editor--notes-hidden');
        } else {
            root.classList.remove('license-split-editor--notes-hidden');
        }
    });
    try {
        localStorage.setItem(ADMIN_DAYS_HIDE_NOTES_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columna Notas en días';
            btn.setAttribute('aria-label', 'Mostrar columna Notas en cada día');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columna Notas en días';
            btn.setAttribute('aria-label', 'Ocultar columna Notas en cada día');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    roots.forEach(function (root) {
        if (typeof dayLicenseSplitScheduleAutosize === 'function') {
            dayLicenseSplitScheduleAutosize(root);
        }
    });
}

function adminDaysHideNotesColToggle() {
    adminDaysHideNotesColApply(!adminDaysHideNotesColReadStored());
}

function adminDaysHideNotesColSyncUi() {
    adminDaysHideNotesColApply(adminDaysHideNotesColReadStored());
}

window.adminDaysHideNotesColApply = adminDaysHideNotesColApply;
window.adminDaysHideNotesColSyncUi = adminDaysHideNotesColSyncUi;
window.adminDaysHideNotesColToggle = adminDaysHideNotesColToggle;

var ADMIN_CHANGES_HIDE_STATUS_COL_KEY = 'admin_licencias_changes_hide_status_col_v1';
var ADMIN_CHANGES_HIDE_NOTES_COL_KEY = 'admin_licencias_changes_hide_notes_col_v1';

function adminChangesHideStatusColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_CHANGES_HIDE_STATUS_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminChangesHideStatusColApply(hidden) {
    var container = document.getElementById('licenseChangesProductsContainer');
    var btn = document.getElementById('adminLicenciasToggleChangesStatusColBtn');
    if (!container) return;
    var roots = container.querySelectorAll('.changes-license-split-root');
    var hid = !!hidden;
    roots.forEach(function (root) {
        if (hid) {
            root.classList.add('license-split-editor--status-hidden');
        } else {
            root.classList.remove('license-split-editor--status-hidden');
        }
    });
    try {
        localStorage.setItem(ADMIN_CHANGES_HIDE_STATUS_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columnas Terminado e incidencias';
            btn.setAttribute('aria-label', 'Mostrar columnas Terminado (verde) e incidencias (rojo) en Cambios');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columnas Terminado e incidencias';
            btn.setAttribute('aria-label', 'Ocultar columnas Terminado (verde) e incidencias (rojo) en Cambios');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    roots.forEach(function (root) {
        if (typeof changesLicenseSplitScheduleAutosize === 'function') {
            changesLicenseSplitScheduleAutosize(root);
        }
    });
}

function adminChangesHideStatusColToggle() {
    adminChangesHideStatusColApply(!adminChangesHideStatusColReadStored());
}

function adminChangesHideStatusColSyncUi() {
    adminChangesHideStatusColApply(adminChangesHideStatusColReadStored());
}

window.adminChangesHideStatusColApply = adminChangesHideStatusColApply;
window.adminChangesHideStatusColSyncUi = adminChangesHideStatusColSyncUi;
window.adminChangesHideStatusColToggle = adminChangesHideStatusColToggle;

function adminChangesHideNotesColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_CHANGES_HIDE_NOTES_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminChangesHideNotesColApply(hidden) {
    var container = document.getElementById('licenseChangesProductsContainer');
    var btn = document.getElementById('adminLicenciasToggleChangesNotesColBtn');
    if (!container) return;
    var roots = container.querySelectorAll('.changes-license-split-root');
    var hid = !!hidden;
    roots.forEach(function (root) {
        if (hid) {
            root.classList.add('license-split-editor--notes-hidden');
        } else {
            root.classList.remove('license-split-editor--notes-hidden');
        }
    });
    try {
        localStorage.setItem(ADMIN_CHANGES_HIDE_NOTES_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columna Notas';
            btn.setAttribute('aria-label', 'Mostrar columna Notas en Cambios');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columna Notas';
            btn.setAttribute('aria-label', 'Ocultar columna Notas en Cambios');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    roots.forEach(function (root) {
        if (typeof changesLicenseSplitScheduleAutosize === 'function') {
            changesLicenseSplitScheduleAutosize(root);
        }
    });
}

function adminChangesHideNotesColToggle() {
    adminChangesHideNotesColApply(!adminChangesHideNotesColReadStored());
}

function adminChangesHideNotesColSyncUi() {
    adminChangesHideNotesColApply(adminChangesHideNotesColReadStored());
}

window.adminChangesHideNotesColApply = adminChangesHideNotesColApply;
window.adminChangesHideNotesColSyncUi = adminChangesHideNotesColSyncUi;
window.adminChangesHideNotesColToggle = adminChangesHideNotesColToggle;

var ADMIN_CHANGES_HIDE_RESTORE_COL_KEY = 'admin_licencias_changes_hide_restore_col_v1';

function adminChangesHideRestoreColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_CHANGES_HIDE_RESTORE_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminChangesHideRestoreColApply(hidden) {
    var container = document.getElementById('licenseChangesProductsContainer');
    var btn = document.getElementById('adminLicenciasToggleChangesRestoreColBtn');
    if (!container) return;
    var roots = container.querySelectorAll('.changes-license-split-root');
    var hid = !!hidden;
    roots.forEach(function (root) {
        if (hid) {
            root.classList.add('license-split-editor--changes-restore-hidden');
        } else {
            root.classList.remove('license-split-editor--changes-restore-hidden');
        }
    });
    try {
        localStorage.setItem(ADMIN_CHANGES_HIDE_RESTORE_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar flecha devolver a Licencias';
            btn.setAttribute('aria-label', 'Mostrar botón subir fila al bloc Licencias en Cambios');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar flecha devolver a Licencias';
            btn.setAttribute('aria-label', 'Ocultar botón subir fila al bloc Licencias en Cambios');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    roots.forEach(function (root) {
        if (typeof changesLicenseSplitScheduleAutosize === 'function') {
            changesLicenseSplitScheduleAutosize(root);
        }
    });
}

function adminChangesHideRestoreColToggle() {
    adminChangesHideRestoreColApply(!adminChangesHideRestoreColReadStored());
}

function adminChangesHideRestoreColSyncUi() {
    adminChangesHideRestoreColApply(adminChangesHideRestoreColReadStored());
}

window.adminChangesHideRestoreColApply = adminChangesHideRestoreColApply;
window.adminChangesHideRestoreColSyncUi = adminChangesHideRestoreColSyncUi;
window.adminChangesHideRestoreColToggle = adminChangesHideRestoreColToggle;

var ADMIN_LICENSE_HIDE_STATUS_COL_KEY = 'admin_licencias_license_hide_status_col_v1';

function adminLicenseHideStatusColReadStored() {
    try {
        var v = localStorage.getItem(ADMIN_LICENSE_HIDE_STATUS_COL_KEY);
        if (v === '1' || v === 'true') {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

function adminLicenseHideStatusColApply(hidden) {
    var root = document.getElementById('adminLicenciasLicenseSplitRoot');
    var btn = document.getElementById('adminLicenciasToggleStatusColBtn');
    if (!root) return;
    var hid = !!hidden;
    if (hid) {
        root.classList.add('license-split-editor--status-hidden');
    } else {
        root.classList.remove('license-split-editor--status-hidden');
    }
    try {
        localStorage.setItem(ADMIN_LICENSE_HIDE_STATUS_COL_KEY, hid ? '1' : '0');
    } catch (e) {
        /* ignore */
    }
    if (btn) {
        var icon = btn.querySelector('i');
        if (hid) {
            if (icon) {
                icon.className = 'fas fa-eye';
            }
            btn.title = 'Mostrar columnas Estado (verde y rojo)';
            btn.setAttribute('aria-label', 'Mostrar columnas Estado verde y rojo de cada fila');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (icon) {
                icon.className = 'fas fa-eye-slash';
            }
            btn.title = 'Ocultar columnas Estado (verde y rojo)';
            btn.setAttribute('aria-label', 'Ocultar columnas Estado verde y rojo de cada fila');
            btn.setAttribute('aria-pressed', 'false');
        }
    }
    if (typeof window.adminLicenseSplitScheduleAutosizeCreds === 'function') {
        window.adminLicenseSplitScheduleAutosizeCreds();
    }
}

function adminLicenseHideStatusColToggle() {
    var root = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (!root) return;
    var now = root.classList.contains('license-split-editor--status-hidden');
    adminLicenseHideStatusColApply(!now);
}

function adminLicenseHideStatusColSyncUi() {
    adminLicenseHideStatusColApply(adminLicenseHideStatusColReadStored());
}

window.adminLicenseHideStatusColApply = adminLicenseHideStatusColApply;
window.adminLicenseHideStatusColSyncUi = adminLicenseHideStatusColSyncUi;
window.adminLicenseHideStatusColToggle = adminLicenseHideStatusColToggle;

/** Cuenta líneas con contenido (mismo criterio visual que el bloc). */
function countNonEmptyLinesInText(text) {
    if (text == null || String(text).trim() === '') return 0;
    return String(text)
        .split(/\r?\n/)
        .filter(function (line) {
            return line.trim().length > 0;
        }).length;
}

/** Contador en cabecera del bloc Licencias (mismo criterio que Día N). */
function updateLicenseBlocLineCountBadge() {
    const badge = document.getElementById('adminLicenciasLicenseLineBadge');
    const pad = document.getElementById('adminLicenciasNotepadByLicense');
    if (!badge || !pad) return;
    const lid = pad.dataset.licenseId;
    if (lid === undefined || lid === '' || String(lid) === '0') {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
        return;
    }
    const raw =
        typeof window.adminLicenseSplitGetMergedNotes === 'function'
            ? window.adminLicenseSplitGetMergedNotes()
            : pad.tagName === 'TEXTAREA'
              ? pad.value
              : editablePlainTextForPipeNormalize(pad);
    const n = countNonEmptyLinesInText(raw);
    if (n > 0) {
        badge.textContent = String(n);
        badge.title = n === 1 ? '1 línea' : n + ' líneas';
        badge.hidden = false;
    } else {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
    }
}

window.updateLicenseBlocLineCountBadge = updateLicenseBlocLineCountBadge;

/** Contador en cabecera de Notas personales (mismo criterio de líneas). */
function updatePersonalBlocLineCountBadge() {
    const badge = document.getElementById('adminLicenciasPersonalLineBadge');
    const ta = document.getElementById('adminLicenciasNotepadPersonal');
    if (!badge || !ta) return;
    const lid = ta.dataset.licenseId;
    if (lid === undefined || lid === '' || String(lid) === '0') {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
        return;
    }
    const n = countNonEmptyLinesInText(ta.value);
    if (n > 0) {
        badge.textContent = String(n);
        badge.title = n === 1 ? '1 línea' : n + ' líneas';
        badge.hidden = false;
    } else {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
    }
}

window.updatePersonalBlocLineCountBadge = updatePersonalBlocLineCountBadge;

/** Contador en cabecera de Caídas / suspendidas (mismo criterio de líneas). */
function updateSuspendedBlocLineCountBadge() {
    const badge = document.getElementById('adminLicenciasSuspendedLineBadge');
    const pad = document.getElementById('adminLicenciasSuspendedNotepad');
    if (!badge || !pad) return;
    const lid = pad.dataset.licenseId;
    if (lid === undefined || lid === '' || String(lid) === '0') {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
        return;
    }
    const suspRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    let raw;
    if (suspRoot && typeof suspendedLicenseSplitGetMergedText === 'function') {
        raw = suspendedLicenseSplitGetMergedText(suspRoot);
    } else {
        raw = pad.tagName === 'TEXTAREA' ? pad.value : editablePlainTextForPipeNormalize(pad);
    }
    const n = countNonEmptyLinesInText(raw);
    if (n > 0) {
        badge.textContent = String(n);
        badge.title = n === 1 ? '1 línea' : n + ' líneas';
        badge.hidden = false;
    } else {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
    }
}

window.updateSuspendedBlocLineCountBadge = updateSuspendedBlocLineCountBadge;

/** Contador en cabecera de Vencidas (mismo criterio de líneas que Caídas). */
function updateExpiredBlocLineCountBadge() {
    const badge = document.getElementById('adminLicenciasExpiredLineBadge');
    const pad = document.getElementById('adminLicenciasExpiredNotepad');
    if (!badge || !pad) return;
    const lid = pad.dataset.licenseId;
    if (lid === undefined || lid === '' || String(lid) === '0') {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
        return;
    }
    const expRoot = document.getElementById('adminLicenciasExpiredSplitRoot');
    let raw;
    if (expRoot && typeof expiredLicenseSplitGetMergedText === 'function') {
        raw = expiredLicenseSplitGetMergedText(expRoot);
    } else {
        raw = pad.tagName === 'TEXTAREA' ? pad.value : editablePlainTextForPipeNormalize(pad);
    }
    const n = countNonEmptyLinesInText(raw);
    if (n > 0) {
        badge.textContent = String(n);
        badge.title = n === 1 ? '1 línea' : n + ' líneas';
        badge.hidden = false;
    } else {
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
    }
}

window.updateExpiredBlocLineCountBadge = updateExpiredBlocLineCountBadge;

function updateChangesBlocLineCountBadge() {
    document.querySelectorAll('.admin-licencias-bloc--changes-product').forEach(function (section) {
        const badge = section.querySelector('.js-changes-product-line-badge');
        const root = section.querySelector('.changes-license-split-root');
        if (!badge || !root || typeof changesLicenseSplitGetMergedText !== 'function') return;
        const raw = changesLicenseSplitGetMergedText(root);
        const n = countNonEmptyLinesInText(raw);
        if (n > 0) {
            badge.textContent = String(n);
            badge.title = n === 1 ? '1 línea' : n + ' líneas';
            badge.hidden = false;
        } else {
            badge.hidden = true;
            badge.textContent = '';
            badge.removeAttribute('title');
        }
    });
}

window.updateChangesBlocLineCountBadge = updateChangesBlocLineCountBadge;

/** Quita una cuenta de la caché en memoria tras DELETE (evita N× loadLicenses al volcar varios días). */
function adminLicRemoveAccountFromCache(accountId) {
    if (accountId == null) return;
    const id = Number(accountId);
    if (!Number.isFinite(id)) return;
    for (let i = 0; i < licenses.length; i++) {
        const lic = licenses[i];
        if (!lic || lic.isAggregate || !Array.isArray(lic.accounts)) continue;
        const idx = lic.accounts.findIndex(function (a) {
            return a && a.id === id;
        });
        if (idx !== -1) {
            lic.accounts.splice(idx, 1);
            invalidateLicenseNotesCredentialLineCache();
            return;
        }
    }
}

/**
 * Texto fusionado de cada día (1–31) antes de reemplazar el DOM al cambiar de producto.
 */
function captureDayTextsForLicense(licenseId) {
    const container = document.getElementById('licenseAllDaysContainer');
    const texts = {};
    const lid = String(licenseId);
    for (let d = 1; d <= 31; d++) {
        const root =
            container &&
            container.querySelector(
                '.day-license-split-root[data-day="' + d + '"][data-license-id="' + lid + '"]'
            );
        if (root && typeof dayLicenseSplitGetMergedText === 'function') {
            texts[d] = dayLicenseSplitGetMergedText(root);
        } else {
            const st = loadDayDraftLocal(licenseId, d);
            texts[d] = st !== null ? st : '';
        }
    }
    return texts;
}

/**
 * Persiste días con cambios respecto al servidor; un solo loadLicenses al final.
 */
async function flushDayNotepadsForLicenseWithTexts(fromLicenseId, dayTexts) {
    if (fromLicenseId == null || Number.isNaN(fromLicenseId)) return false;
    let any = false;
    for (let d = 1; d <= 31; d++) {
        const candidate = dayTexts[d] != null ? dayTexts[d] : '';
        const serverPlain = buildServerPlainForDay(fromLicenseId, d);
        if (normalizeDraftCompare(candidate) === normalizeDraftCompare(serverPlain)) {
            if (loadDayDraftLocal(fromLicenseId, d) !== null) {
                clearDayDraftLocal(fromLicenseId, d);
            }
            continue;
        }
        if (fromLicenseId === AGGREGATE_LICENSE_ID) {
            await syncAggregateDayNotepad(d, candidate, { skipReload: true });
        } else {
            await syncDayNotepad(fromLicenseId, d, candidate, { skipReload: true });
        }
        any = true;
    }
    if (any) {
        await loadLicenses({ skipGridRender: true });
    }
    return any;
}

/** Persiste el texto exacto del bloc del día en BD (como notas/licencias). No aplica a vista «Todos». */
async function persistDayNotepadRawText(licenseId, day, rawText) {
    if (licenseId === AGGREGATE_LICENSE_ID) return;
    const text = rawText != null ? String(rawText) : '';
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/notes`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                day_notepads: { [String(day)]: text }
            })
        });
        const data = await response.json();
        if (data.success) {
            const L = licenses.find(l => l.id === licenseId);
            if (L) {
                if (!L.day_notepads) L.day_notepads = {};
                L.day_notepads[String(day)] = text;
            }
        }
    } catch (e) {
        console.error('Error al guardar texto del bloc del día:', e);
    }
}

/**
 * Sincroniza el bloc de un día con el servidor: borrar línea = borrar cuenta;
 * mismas reglas de parseo que el bloc Licencias.
 * options.skipReload: no llama loadLicenses (el llamador hace un único refresh, p. ej. al cambiar de producto).
 */
async function syncDayNotepad(licenseId, day, rawText, options) {
    if (licenseId === AGGREGATE_LICENSE_ID) {
        return syncAggregateDayNotepad(day, rawText, options);
    }
    const skipReload = options && options.skipReload;
    const text = rawText != null ? String(rawText) : '';
    await persistDayNotepadRawText(licenseId, day, text);
    const trimmed = text.trim();

    if (!trimmed) {
        const existing = getSoldAccountsForDayNumber(licenseId, day);
        if (existing.length === 0) return;
        for (const acc of existing) {
            try {
                const response = await fetch(`/tienda/api/accounts/${acc.id}`, {
                    method: 'DELETE',
                    headers: { 'X-CSRFToken': getCSRFToken() }
                });
                await response.json();
                if (skipReload) {
                    adminLicRemoveAccountFromCache(acc.id);
                }
            } catch (e) {
                console.error('Error al eliminar cuenta del día:', e);
            }
        }
        clearDayDraftLocal(licenseId, day);
        if (!skipReload) {
            await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        scheduleLoadAllDaysSoldAccounts(licenseId);
        }
        return;
    }

    const parsedList = parseDayNotepadLinesForSync(text, licenseId);
    if (parsedList.length === 0) {
        clearDayDraftLocal(licenseId, day);
        if (!skipReload) {
        loadAndDisplaySavedAccounts(licenseId);
        scheduleLoadAllDaysSoldAccounts(licenseId);
        }
        return;
    }

    const parsedByKey = new Map();
    for (const p of parsedList) {
        parsedByKey.set(p.syncKey, p);
    }

    const toRemove = getSoldAccountsForDayNumber(licenseId, day).filter(
        acc => !parsedByKey.has(accountDayInventorySyncKey(acc))
    );
    for (const acc of toRemove) {
        try {
            const response = await fetch(`/tienda/api/accounts/${acc.id}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCSRFToken() }
            });
            await response.json();
            if (skipReload) {
                adminLicRemoveAccountFromCache(acc.id);
            }
        } catch (e) {
            console.error('Error al eliminar cuenta del día:', e);
        }
    }

    if (toRemove.length && !skipReload) {
        await loadLicenses();
    }

    const existing = getSoldAccountsForDayNumber(licenseId, day);
    const existingByKey = new Map();
    existing.forEach(a => existingByKey.set(accountDayInventorySyncKey(a), a));

    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), day);
    const L = licenses.find(l => l.id === licenseId);

    for (const [syncKey, p] of parsedByKey) {
        const match = existingByKey.get(syncKey);
        if (match) {
            const needUpdate =
                normalizeAccountEmailKey(match.email) !== normalizeAccountEmailKey(p.email) ||
                String(match.password) !== String(p.password) ||
                String(match.account_identifier || '') !== String(p.identifier || '');
            if (needUpdate) {
                try {
                    const response = await fetch(`/tienda/api/accounts/${match.id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({
                            email: p.email,
                            password: p.password,
                            account_identifier: p.identifier
                        })
                    });
                    const data = await response.json();
                    if (!data.success) {
                        console.error('Error al actualizar cuenta:', data.error);
                    } else if (skipReload && L && Array.isArray(L.accounts)) {
                        const accRow = L.accounts.find(a => a && a.id === match.id);
                        if (accRow) {
                            accRow.email = p.email;
                            accRow.password = p.password;
                            accRow.account_identifier = p.identifier;
                            invalidateLicenseNotesCredentialLineCache();
                        }
                    }
                } catch (e) {
                    console.error('Error al actualizar cuenta:', e);
                }
            }
            try {
                await apiSyncAccountAssigneeFromDayLine(match.id, p.assignUsername);
            } catch (e) {
                console.error('Error al asignar cuenta del día:', e);
            }
        } else {
            try {
                const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCSRFToken()
                    },
                    body: JSON.stringify({
                        account_identifier: p.identifier,
                        email: p.email,
                        password: p.password
                    })
                });
                const createData = await createResponse.json();
                if (createData.success && createData.account_id) {
                    await apiMarkAccountSoldForDay(
                        createData.account_id,
                        saleDate,
                        p.assignUsername
                    );
                    if (skipReload && L) {
                        if (!L.accounts) L.accounts = [];
                        L.accounts.push({
                            id: createData.account_id,
                            email: p.email,
                            password: p.password,
                            account_identifier: p.identifier,
                            status: 'sold',
                            assigned_at: saleDate.toISOString()
                        });
                        invalidateLicenseNotesCredentialLineCache();
                    }
                }
            } catch (e) {
                console.error('Error al crear cuenta del día:', e);
            }
        }
    }

    clearDayDraftLocal(licenseId, day);
    if (!skipReload) {
        await loadLicenses();
    loadAndDisplaySavedAccounts(licenseId);
    scheduleLoadAllDaysSoldAccounts(licenseId);
    }
}

/** Misma lógica que syncDayNotepad pero con cuentas de todas las licencias; nuevas cuentas → primera licencia real. */
async function syncAggregateDayNotepad(day, rawText, options) {
    const skipReload = options && options.skipReload;
    const text = rawText != null ? String(rawText) : '';
    const trimmed = text.trim();
    const targetCreateLicenseId = getFirstRealLicenseId();

    if (!trimmed) {
        /** Sin esto el PUT nunca llega (persistDayNotepadRawText ignora aggregate) y el portal sigue mostrando el bloc guardado en BD. */
        const affectedLicenses = getAggregateAffectedLicenseIds();
        await Promise.all(
            Array.from(affectedLicenses).map(lid => persistDayNotepadRawText(lid, day, ''))
        );
        const existing = getSoldAccountsForDayNumber(AGGREGATE_LICENSE_ID, day);
        if (existing.length === 0) {
            clearDayDraftLocal(AGGREGATE_LICENSE_ID, day);
            if (!skipReload) {
                await loadLicenses();
                loadAndDisplaySavedAccounts(AGGREGATE_LICENSE_ID);
                scheduleLoadAllDaysSoldAccounts(AGGREGATE_LICENSE_ID);
            }
            return;
        }
        for (const acc of existing) {
            try {
                const response = await fetch(`/tienda/api/accounts/${acc.id}`, {
                    method: 'DELETE',
                    headers: { 'X-CSRFToken': getCSRFToken() }
                });
                await response.json();
                if (skipReload) {
                    adminLicRemoveAccountFromCache(acc.id);
                }
            } catch (e) {
                console.error('Error al eliminar cuenta del día:', e);
            }
        }
        clearDayDraftLocal(AGGREGATE_LICENSE_ID, day);
        if (!skipReload) {
            await loadLicenses();
        loadAndDisplaySavedAccounts(AGGREGATE_LICENSE_ID);
        scheduleLoadAllDaysSoldAccounts(AGGREGATE_LICENSE_ID);
        }
        return;
    }

    const parseLicenseId = targetCreateLicenseId != null ? targetCreateLicenseId : AGGREGATE_LICENSE_ID;
    const parsedList = parseDayNotepadLinesForSync(text, parseLicenseId);
    if (parsedList.length === 0) {
        clearDayDraftLocal(AGGREGATE_LICENSE_ID, day);
        if (!skipReload) {
        loadAndDisplaySavedAccounts(AGGREGATE_LICENSE_ID);
        scheduleLoadAllDaysSoldAccounts(AGGREGATE_LICENSE_ID);
        }
        return;
    }

    const parsedByKey = new Map();
    for (const p of parsedList) {
        parsedByKey.set(p.syncKey, p);
    }

    const toRemove = getSoldAccountsForDayNumber(AGGREGATE_LICENSE_ID, day).filter(
        acc => !parsedByKey.has(accountDayInventorySyncKey(acc))
    );
    for (const acc of toRemove) {
        try {
            const response = await fetch(`/tienda/api/accounts/${acc.id}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCSRFToken() }
            });
            await response.json();
            if (skipReload) {
                adminLicRemoveAccountFromCache(acc.id);
            }
        } catch (e) {
            console.error('Error al eliminar cuenta del día:', e);
        }
    }

    if (toRemove.length && !skipReload) {
        await loadLicenses();
    }

    const existing = getSoldAccountsForDayNumber(AGGREGATE_LICENSE_ID, day);
    const existingByKey = new Map();
    existing.forEach(a => existingByKey.set(accountDayInventorySyncKey(a), a));

    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), day);

    for (const [syncKey, p] of parsedByKey) {
        const match = existingByKey.get(syncKey);
        if (match) {
            const needUpdate =
                normalizeAccountEmailKey(match.email) !== normalizeAccountEmailKey(p.email) ||
                String(match.password) !== String(p.password) ||
                String(match.account_identifier || '') !== String(p.identifier || '');
            if (needUpdate) {
                try {
                    const response = await fetch(`/tienda/api/accounts/${match.id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({
                            email: p.email,
                            password: p.password,
                            account_identifier: p.identifier
                        })
                    });
                    const data = await response.json();
                    if (!data.success) {
                        console.error('Error al actualizar cuenta:', data.error);
                    } else if (skipReload) {
                        const ownerId = match._sourceLicenseId;
                        const Lown = ownerId != null ? licenses.find(l => l.id === ownerId) : null;
                        if (Lown && Array.isArray(Lown.accounts)) {
                            const accRow = Lown.accounts.find(a => a && a.id === match.id);
                            if (accRow) {
                                accRow.email = p.email;
                                accRow.password = p.password;
                                accRow.account_identifier = p.identifier;
                                invalidateLicenseNotesCredentialLineCache();
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error al actualizar cuenta:', e);
                }
            }
            try {
                await apiSyncAccountAssigneeFromDayLine(match.id, p.assignUsername);
            } catch (e) {
                console.error('Error al asignar cuenta del día:', e);
            }
        } else if (targetCreateLicenseId != null) {
            try {
                const createResponse = await fetch(`/tienda/api/licenses/${targetCreateLicenseId}/accounts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCSRFToken()
                    },
                    body: JSON.stringify({
                        account_identifier: p.identifier,
                        email: p.email,
                        password: p.password
                    })
                });
                const createData = await createResponse.json();
                if (createData.success && createData.account_id) {
                    await apiMarkAccountSoldForDay(
                        createData.account_id,
                        saleDate,
                        p.assignUsername
                    );
                    if (skipReload) {
                        const Lnew = licenses.find(l => l.id === targetCreateLicenseId);
                        if (Lnew) {
                            if (!Lnew.accounts) Lnew.accounts = [];
                            Lnew.accounts.push({
                                id: createData.account_id,
                                email: p.email,
                                password: p.password,
                                account_identifier: p.identifier,
                                status: 'sold',
                                assigned_at: saleDate.toISOString()
                            });
                            invalidateLicenseNotesCredentialLineCache();
                        }
                    }
                }
            } catch (e) {
                console.error('Error al crear cuenta del día:', e);
            }
        }
    }

    clearDayDraftLocal(AGGREGATE_LICENSE_ID, day);
    if (!skipReload) {
        await loadLicenses();
    loadAndDisplaySavedAccounts(AGGREGATE_LICENSE_ID);
    scheduleLoadAllDaysSoldAccounts(AGGREGATE_LICENSE_ID);
    }
}

/** Borrador local por día (respaldo ante fallos de red). */
function dayDraftStorageKey(licenseId, day) {
    return `admin_licencias_day_draft_${licenseId}_${day}_v1`;
}

function saveDayDraftLocal(licenseId, day, text) {
    try {
        localStorage.setItem(dayDraftStorageKey(licenseId, day), text != null ? String(text) : '');
    } catch (e) {}
}

function loadDayDraftLocal(licenseId, day) {
    try {
        const v = localStorage.getItem(dayDraftStorageKey(licenseId, day));
        return v === null ? null : v;
    } catch (e) {
        return null;
    }
}

function clearDayDraftLocal(licenseId, day) {
    try {
        localStorage.removeItem(dayDraftStorageKey(licenseId, day));
    } catch (e) {}
}

/** Comparación estable entre texto del servidor y borrador local (saltos de línea / espacios). */
function normalizeDraftCompare(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function buildServerPlainForDay(licenseId, day) {
    const accounts = getSoldAccountsForDayNumber(licenseId, day);
    return getDayNotepadDisplayText(licenseId, day, accounts);
}

/** Guarda borradores de día antes de cambiar de licencia (lee el DOM actual o localStorage vía captura). */
async function flushDayNotepadsBeforeLicenseSwitch(fromLicenseId) {
    if (fromLicenseId == null || Number.isNaN(fromLicenseId)) return;
    const dayTexts = captureDayTextsForLicense(fromLicenseId);
    await flushDayNotepadsForLicenseWithTexts(fromLicenseId, dayTexts);
}


// Cargar y mostrar todos los días con sus correos vendidos
async function loadAllDaysSoldAccounts(licenseId) {
    const allDaysContainer = document.getElementById('licenseAllDaysContainer');
    
    if (!allDaysContainer) return;

    const license = licenses.find(l => l.id === licenseId);
    const accountsByDay = {};
    let aggregateVisibleIds = null;

    if (licenseId === AGGREGATE_LICENSE_ID) {
        aggregateVisibleIds = getAggregateVisibleLicenseIdSet();
        const accountToProduct = new Map();
        const visibleIds = aggregateVisibleIds;
        for (const lic of licenses) {
            if (!lic.accounts || lic.isAggregate) continue;
            if (!visibleIds.has(lic.id)) continue;
            for (const account of lic.accounts) {
                accountToProduct.set(account.id, lic.product_name || '');
                if (!isAccountCountedInAdminDaysView(account)) continue;
                const d = calendarDayOfMonthInBogota(account.assigned_at);
                if (!Number.isFinite(d) || d < 1 || d > 31) continue;
                if (!accountsByDay[d]) {
                    accountsByDay[d] = [];
                }
                accountsByDay[d].push(Object.assign({}, account, { _sourceLicenseId: lic.id }));
            }
        }
        for (let d = 1; d <= 31; d++) {
            const arr = accountsByDay[d];
            if (arr && arr.length) {
                arr.sort((a, b) => {
                    const pa = accountToProduct.get(a.id) || '';
                    const pb = accountToProduct.get(b.id) || '';
                    const c = pa.localeCompare(pb, 'es');
                    if (c !== 0) return c;
                    return normalizeAccountEmailKey(a.email).localeCompare(normalizeAccountEmailKey(b.email));
                });
            }
        }
        allDaysContainer.classList.remove('d-none');
    } else {
        if (!license) {
            allDaysContainer.classList.add('d-none');
            if (licenseId !== AGGREGATE_LICENSE_ID && typeof restorePersonalBlocState === 'function') {
                restorePersonalBlocState(licenseId);
            }
            return;
        }

        const accountsArr = Array.isArray(license.accounts) ? license.accounts : [];
        const soldAccounts = accountsArr.filter(isAccountCountedInAdminDaysView);
        allDaysContainer.classList.remove('d-none');

        soldAccounts.forEach(account => {
            const day = calendarDayOfMonthInBogota(account.assigned_at);
            if (!Number.isFinite(day) || day < 1 || day > 31) return;

            if (!accountsByDay[day]) {
                accountsByDay[day] = [];
            }
            accountsByDay[day].push(Object.assign({}, account, { _sourceLicenseId: licenseId }));
        });
    }
    
    // Generar HTML para todos los días del 1 al 31 (siempre mostrar todos)
    let allDaysHtml = '';
    for (let day = 1; day <= 31; day++) {
        const dayAccounts = accountsByDay[day] || [];
        const displayBase = getDayNotepadDisplayText(
            licenseId,
            day,
            dayAccounts,
            licenseId === AGGREGATE_LICENSE_ID ? aggregateVisibleIds : undefined
        );
        const draft = loadDayDraftLocal(licenseId, day);
        const textForBadge =
            draft !== null && normalizeDraftCompare(draft) !== normalizeDraftCompare(displayBase)
                ? draft
                : displayBase;
        const lineCount = countNonEmptyLinesInText(textForBadge);
        const badgeText =
            lineCount > 0 ? `${lineCount} ${lineCount === 1 ? 'línea' : 'líneas'}` : '';
        const toolbarD1 =
            day === 1
                ? '<div class="license-days-notes-toggle-bar license-days-notes-toggle-bar--in-day-header" role="toolbar" aria-label="Días: plegar todos; flecha subir a Licencias y columnas Estado y Notas">' +
                  '<button type="button" id="adminLicenciasToggleAllDaysSectionsBtn" class="admin-licencias-toggle-notes-col-btn admin-licencias-days-expand-all-btn" title="Plegar todos los días" aria-label="Plegar todas las secciones de días" aria-expanded="true">' +
                  '<i class="fas fa-chevron-up" aria-hidden="true"></i>' +
                  '</button>' +
                  '<button type="button" id="adminLicenciasToggleDaysRestoreColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar flecha subir a Licencias en días" aria-label="Ocultar botón subir a Licencias en cada día" aria-pressed="false">' +
                  '<i class="fas fa-eye-slash" aria-hidden="true"></i>' +
                  '</button>' +
                  '<button type="button" id="adminLicenciasToggleDaysStatusColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar columnas Estado (verde y rojo) en días" aria-label="Ocultar columnas Estado verde y rojo en cada día" aria-pressed="false">' +
                  '<i class="fas fa-eye-slash" aria-hidden="true"></i>' +
                  '</button>' +
                  '<button type="button" id="adminLicenciasToggleDaysNotesColBtn" class="admin-licencias-toggle-notes-col-btn" title="Ocultar columna Notas en días" aria-label="Ocultar columna Notas en cada día" aria-pressed="false">' +
                  '<i class="fas fa-eye-slash" aria-hidden="true"></i>' +
                  '</button>' +
                  '</div>'
                : '';
        const dayHeaderActionsClass =
            day === 1
                ? 'admin-licencias-bloc-header-actions admin-licencias-bloc-header-actions--with-d1-toolbar'
                : 'admin-licencias-bloc-header-actions';
        allDaysHtml += `
            <section class="day-section admin-licencias-bloc admin-licencias-bloc--day" data-day="${day}" aria-label="Día ${day}">
                <div class="day-section-header admin-licencias-bloc-header">
                    <span class="admin-licencias-bloc-title"><i class="fas fa-calendar-day" aria-hidden="true"></i> <span>Día ${day}</span></span>
                    <div class="${dayHeaderActionsClass}">
                        ${toolbarD1}
                        <div class="admin-bloc-undo-toolbar admin-bloc-undo-toolbar--in-header admin-bloc-undo-toolbar--day" role="toolbar" aria-label="Deshacer y rehacer (día ${day})">
                            <button type="button" class="admin-bloc-undo-btn js-day-undo" data-day="${day}" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><i class="fas fa-undo" aria-hidden="true"></i></button>
                            <button type="button" class="admin-bloc-undo-btn js-day-redo" data-day="${day}" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><i class="fas fa-redo" aria-hidden="true"></i></button>
                        </div>
                        ${lineCount > 0 ? `<span class="day-account-badge admin-licencias-notepad-line-badge" title="${badgeText}">${lineCount}</span>` : ''}
                        <span class="admin-licencias-report-header-badge js-admin-day-report-badge" data-day="${day}" hidden role="status" aria-live="polite" aria-label="Sin reportes pendientes en el día ${day}">Reportes <span class="admin-licencias-report-header-badge__num">0</span></span>
                    </div>
                </div>
                <div class="day-accounts-list">
                    <div class="license-split-editor license-split-editor--day day-license-split-root day-account-item admin-licencias-license-editable license-notepad--locked" data-day="${day}" data-license-id="${licenseId}" data-license-viz="all" tabindex="-1" role="region" aria-label="Día ${day}: credenciales a la izquierda; usuario, estados verde y rojo, y notas a la derecha.">
                        <div class="license-split-editor__viewport">
                            <div class="license-split-editor__grid">
                                <div class="license-split-editor__creds-cell">
                                    <textarea id="adminLicDayCreds-${licenseId}-${day}" name="admin_lic_day_creds_${licenseId}_${day}" class="admin-licencias-notepad-textarea license-split-editor__creds day-license-split__creds" rows="1" spellcheck="true" wrap="off" autocomplete="off" readonly data-day="${day}" aria-label="Día ${day}: una licencia por línea." placeholder="Una licencia por línea. Enter = nueva línea."></textarea>
                                </div>
                                <div class="license-split-editor__side" aria-label="Usuario, estados verde y rojo, y notas (día ${day})">
                                    <div class="license-split-editor__rows day-license-split-rows" role="region" aria-label="Filas del día ${day}: usuario, estados verde y rojo, y notas"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
    
    allDaysContainer.innerHTML = allDaysHtml;

    for (let d = 1; d <= 31; d++) {
        const dayAccounts = accountsByDay[d] || [];
        const root = allDaysContainer.querySelector(
            `.day-license-split-root[data-day="${d}"][data-license-id="${licenseId}"]`
        );
        if (root) {
            const displayBase = getDayNotepadDisplayText(
                licenseId,
                d,
                dayAccounts,
                licenseId === AGGREGATE_LICENSE_ID ? aggregateVisibleIds : undefined
            );
            const draft = loadDayDraftLocal(licenseId, d);
            let textToApply = displayBase;
            if (draft !== null && normalizeDraftCompare(draft) !== normalizeDraftCompare(displayBase)) {
                textToApply = draft;
            } else if (draft !== null) {
                    clearDayDraftLocal(licenseId, d);
                }
            dayLicenseSplitApplyMergedText(root, textToApply);
            dayLicenseSplitAutosizeCreds(root);
        }
    }

    // Restaurar estados de días contraídos/expandidos
    restoreDaySectionsState(licenseId);
    try {
        if (typeof adminDaysSyncExpandAllToolbarBtn === 'function') {
            adminDaysSyncExpandAllToolbarBtn();
        }
    } catch (expandBtnErr) {
        console.error('adminDaysSyncExpandAllToolbarBtn:', expandBtnErr);
    }
    if (licenseId !== AGGREGATE_LICENSE_ID) {
    restoreSuspendedSectionState(licenseId);
        restoreExpiredSectionState(licenseId);
        restorePersonalBlocState(licenseId);
    }
    
    // Agregar event listeners para contraer/expandir días
    setupDaySectionsToggle(licenseId);

    try {
        if (typeof adminDaysHideRestoreColSyncUi === 'function') {
            adminDaysHideRestoreColSyncUi();
        }
    } catch (daysRestoreErr) {
        console.error('adminDaysHideRestoreColSyncUi:', daysRestoreErr);
    }

    try {
        if (typeof adminDaysHideStatusColSyncUi === 'function') {
            adminDaysHideStatusColSyncUi();
        }
    } catch (daysStatusErr) {
        console.error('adminDaysHideStatusColSyncUi:', daysStatusErr);
    }

    try {
        if (typeof adminDaysHideNotesColSyncUi === 'function') {
            adminDaysHideNotesColSyncUi();
        }
    } catch (daysNotesErr) {
        console.error('adminDaysHideNotesColSyncUi:', daysNotesErr);
    }
    
    // Un bloc por día (como notas): borrar línea = borrar cuenta al guardar
    setupEditableDayAccounts(licenseId);
    
    refreshDuplicateEmailHighlights(licenseId);
    
    // Aplicar resaltado de búsqueda si hay un término activo
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput && searchInput.value.trim()) {
        highlightMatchingEmails(searchInput.value.toLowerCase().trim());
    }

    if (document.documentElement.dataset.adminLicDupHighlightActive === '1') {
        refreshAdminDuplicateHighlightsIfActive();
    }

    scheduleRefreshAdminLicenciasReportCounts();
}

// Configurar el toggle de contraer/expandir para secciones de días
function setupDaySectionsToggle(licenseId) {
    const daySections = document.querySelectorAll('#licenseAllDaysContainer .day-section');
    
    daySections.forEach(section => {
        const header = section.querySelector('.day-section-header');
        const accountsList = section.querySelector('.day-accounts-list');
        const day = section.dataset.day;
        
        if (header && accountsList) {
            // Hacer que el header sea clickeable
            header.style.cursor = 'pointer';
            
            header.addEventListener('click', function(e) {
                // No hacer toggle si se hace clic en el badge
                if (e.target.closest('.day-account-badge')) {
                    return;
                }
                if (e.target.closest('.admin-licencias-report-header-badge')) {
                    return;
                }
                if (e.target.closest('.admin-bloc-undo-toolbar')) {
                    return;
                }
                if (e.target.closest('.admin-licencias-toggle-notes-col-btn')) {
                    return;
                }
                
                section.classList.toggle('collapsed');
                const isCollapsed = section.classList.contains('collapsed');

                licenciasUiAdminDayCollapsedWrite(licenseId, day, isCollapsed);
                try {
                    if (typeof adminDaysSyncExpandAllToolbarBtn === 'function') {
                        adminDaysSyncExpandAllToolbarBtn();
                    }
                } catch (e) {
                    /* ignore */
                }
            });
        }
    });
}

// Restaurar el estado de contracción/expansión de las secciones de días
function restoreDaySectionsState(licenseId) {
    const daySections = document.querySelectorAll('#licenseAllDaysContainer .day-section');
    
    daySections.forEach(section => {
        const day = section.dataset.day;
        const accountsList = section.querySelector('.day-accounts-list');
        const savedState = licenciasUiAdminDayCollapsedRead(licenseId, day);

        if (savedState === 'true' && accountsList) {
            section.classList.add('collapsed');
        } else if (accountsList) {
            section.classList.remove('collapsed');
        }
    });
}

/** Licencia activa en la barra de Días (misma que la tarjeta seleccionada). */
function adminDaysToolbarActiveLicenseId() {
    const wrap = document.getElementById('licenseAccountsInputContainer');
    if (!wrap || wrap.dataset.activeLicenseId == null || wrap.dataset.activeLicenseId === '') {
        return null;
    }
    const n = parseInt(wrap.dataset.activeLicenseId, 10);
    return Number.isFinite(n) ? n : null;
}

/** Actualiza icono y título del botón «plegar / desplegar todos los días». */
function adminDaysSyncExpandAllToolbarBtn() {
    const btn = document.getElementById('adminLicenciasToggleAllDaysSectionsBtn');
    if (!btn) return;
    const sections = document.querySelectorAll('#licenseAllDaysContainer .day-section');
    if (!sections.length) return;
    let anyExpanded = false;
    sections.forEach(function (section) {
        if (!section.classList.contains('collapsed')) {
            anyExpanded = true;
        }
    });
    const icon = btn.querySelector('i');
    if (anyExpanded) {
        if (icon) {
            icon.className = 'fas fa-chevron-up';
        }
        btn.title = 'Plegar todos los días';
        btn.setAttribute('aria-label', 'Plegar todas las secciones de días');
        btn.setAttribute('aria-expanded', 'true');
    } else {
        if (icon) {
            icon.className = 'fas fa-chevron-down';
        }
        btn.title = 'Desplegar todos los días';
        btn.setAttribute('aria-label', 'Desplegar todas las secciones de días');
        btn.setAttribute('aria-expanded', 'false');
    }
}

/** Si hay algún día abierto → pliega los 31; si todos cerrados → despliega todos. */
function adminDaysToggleAllDaySections() {
    const licenseId = adminDaysToolbarActiveLicenseId();
    if (licenseId == null) return;
    const sections = document.querySelectorAll('#licenseAllDaysContainer .day-section');
    if (!sections.length) return;
    let anyExpanded = false;
    sections.forEach(function (section) {
        if (!section.classList.contains('collapsed')) {
            anyExpanded = true;
        }
    });
    const collapseAll = anyExpanded;
    sections.forEach(function (section) {
        const accountsList = section.querySelector('.day-accounts-list');
        const day = section.dataset.day;
        if (!accountsList || day == null || day === '') return;
        if (collapseAll) {
            section.classList.add('collapsed');
            licenciasUiAdminDayCollapsedWrite(licenseId, day, true);
        } else {
            section.classList.remove('collapsed');
            licenciasUiAdminDayCollapsedWrite(licenseId, day, false);
        }
    });
    adminDaysSyncExpandAllToolbarBtn();
}

window.adminDaysSyncExpandAllToolbarBtn = adminDaysSyncExpandAllToolbarBtn;
window.adminDaysToggleAllDaySections = adminDaysToggleAllDaySections;

function suspendedSectionStorageKey(licenseId) {
    return `suspendedSection_${licenseId}_collapsed`;
}

function expiredSectionStorageKey(licenseId) {
    return `expiredSection_${licenseId}_collapsed`;
}

function personalBlocStorageKey(licenseId) {
    return `personalBloc_${licenseId}_collapsed`;
}

/** Una sola vez tras render del grid: plegar Notas personales (mismo criterio que Día N: clic en cabecera, estado por producto). */
function setupPersonalBlocCollapse() {
    const section = document.getElementById('adminLicenciasBlocPersonal');
    if (!section || section.dataset.personalCollapseBound === '1') return;
    const header = section.querySelector('.admin-licencias-bloc-header');
    const body = section.querySelector('.admin-licencias-personal-body');
    if (!header || !body) return;
    section.dataset.personalCollapseBound = '1';
    header.style.cursor = 'pointer';
    header.addEventListener('click', function (e) {
        if (e.target.closest('.day-account-badge')) {
            return;
        }
        if (e.target.closest('.admin-bloc-undo-toolbar')) {
            return;
        }
        if (e.target.closest('.admin-licencias-toggle-notes-col-btn')) {
            return;
        }
        const inputContainer = document.getElementById('licenseAccountsInputContainer');
        const licenseId = inputContainer && inputContainer.dataset.activeLicenseId;
        if (!licenseId || String(licenseId) === String(AGGREGATE_LICENSE_ID)) return;
        section.classList.toggle('collapsed');
        const isCollapsed = section.classList.contains('collapsed');
        body.style.display = isCollapsed ? 'none' : 'block';
        adminLicSetBlocPrefCollapsed('personal_collapsed', licenseId, isCollapsed, personalBlocStorageKey);
    });
}

function restorePersonalBlocState(licenseId) {
    const section = document.getElementById('adminLicenciasBlocPersonal');
    const body = section && section.querySelector('.admin-licencias-personal-body');
    if (!section || !body) return;
    if (licenseId == null || String(licenseId) === String(AGGREGATE_LICENSE_ID)) {
        section.classList.remove('collapsed');
        body.style.display = 'block';
        return;
    }
    let saved = adminLicGetBlocPrefCollapsed('personal_collapsed', licenseId, personalBlocStorageKey);
    if (saved === 'true') {
        section.classList.add('collapsed');
        body.style.display = 'none';
    } else {
        section.classList.remove('collapsed');
        body.style.display = 'block';
    }
}

/** Una sola vez tras render del grid: cabecera tipo “Día” para plegar Caídas / suspendidas. */
function setupSuspendedSectionCollapse() {
    const section = document.getElementById('licenseSuspendedSection');
    if (!section || section.dataset.collapseBound === '1') return;
    const header = section.querySelector('.day-section-header');
    const body = section.querySelector('.suspended-section-body');
    if (!header || !body) return;
    section.dataset.collapseBound = '1';
    header.style.cursor = 'pointer';
    header.addEventListener('click', function (e) {
        if (e.target.closest('.day-account-badge')) {
            return;
        }
        if (e.target.closest('.admin-bloc-undo-toolbar')) {
            return;
        }
        if (e.target.closest('.admin-licencias-toggle-notes-col-btn')) {
            return;
        }
        const inputContainer = document.getElementById('licenseAccountsInputContainer');
        const licenseId = inputContainer && inputContainer.dataset.activeLicenseId;
        if (!licenseId) return;
        section.classList.toggle('collapsed');
        const isCollapsed = section.classList.contains('collapsed');
        body.style.display = isCollapsed ? 'none' : 'block';
        adminLicSetBlocPrefCollapsed('suspended_collapsed', licenseId, isCollapsed, suspendedSectionStorageKey);
    });
}

function restoreSuspendedSectionState(licenseId) {
    const section = document.getElementById('licenseSuspendedSection');
    const body = section && section.querySelector('.suspended-section-body');
    if (!section || !body) return;
    let saved = adminLicGetBlocPrefCollapsed('suspended_collapsed', licenseId, suspendedSectionStorageKey);
    if (saved === 'true') {
        section.classList.add('collapsed');
        body.style.display = 'none';
    } else {
        section.classList.remove('collapsed');
        body.style.display = 'block';
    }
}

/** Plegar / expandir bloc Vencidas (mismo patrón que Caídas). */
function setupExpiredSectionCollapse() {
    const section = document.getElementById('licenseExpiredSection');
    if (!section || section.dataset.collapseBound === '1') return;
    const header = section.querySelector('.day-section-header');
    const body = section.querySelector('.expired-section-body');
    if (!header || !body) return;
    section.dataset.collapseBound = '1';
    header.style.cursor = 'pointer';
    header.addEventListener('click', function (e) {
        if (e.target.closest('.day-account-badge')) {
            return;
        }
        if (e.target.closest('.admin-bloc-undo-toolbar')) {
            return;
        }
        if (e.target.closest('.admin-licencias-toggle-notes-col-btn')) {
            return;
        }
        const inputContainer = document.getElementById('licenseAccountsInputContainer');
        const licenseId = inputContainer && inputContainer.dataset.activeLicenseId;
        if (!licenseId) return;
        section.classList.toggle('collapsed');
        const isCollapsed = section.classList.contains('collapsed');
        body.style.display = isCollapsed ? 'none' : 'block';
        adminLicSetBlocPrefCollapsed('expired_collapsed', licenseId, isCollapsed, expiredSectionStorageKey);
    });
}

function restoreExpiredSectionState(licenseId) {
    const section = document.getElementById('licenseExpiredSection');
    const body = section && section.querySelector('.expired-section-body');
    if (!section || !body) return;
    let saved = adminLicGetBlocPrefCollapsed('expired_collapsed', licenseId, expiredSectionStorageKey);
    if (saved === 'true') {
        section.classList.add('collapsed');
        body.style.display = 'none';
    } else {
        section.classList.remove('collapsed');
        body.style.display = 'block';
    }
}

function isDayNotepadUnlocked(item) {
    if (!item) return false;
    if (item.classList && item.classList.contains('day-license-split-root')) {
        return !item.classList.contains('license-notepad--locked');
    }
    return item.getAttribute('contenteditable') === 'true';
}

/** Mismo modelo que Licencias (split): textarea de creds + filas; clic para desbloquear. */
function setupEditableDayAccounts(licenseId) {
    const daysWrap = document.getElementById('licenseAllDaysContainer');
    if (!daysWrap) return;
    const lidStr = String(licenseId);
    daysWrap.querySelectorAll('.day-license-split-root').forEach((root) => {
        if (String(root.dataset.licenseId || '') !== lidStr) return;
        const ta = dayLicenseSplitQueryCredsTa(root);
        const rowsWrap = dayLicenseSplitQueryRowsWrap(root);
        if (!ta || !rowsWrap) return;

        const day = parseInt(root.dataset.day, 10) || new Date().getDate();
        dayLicenseSplitWireScrollSync(root);

        let saveTimeout;
        let normalizeInputTimeout;
        let isSaving = false;
        let lastSyncedText = dayLicenseSplitGetMergedText(root).trim();

        const sectionEl = root.closest('.day-section');
        const undoBtn = sectionEl ? sectionEl.querySelector(`.js-day-undo[data-day="${day}"]`) : null;
        const redoBtn = sectionEl ? sectionEl.querySelector(`.js-day-redo[data-day="${day}"]`) : null;

        dayLicenseSplitLock(root);

        // Eliminado saveDayDraftLocal aquí: si se guarda el borrador al inicializar,
        // congela el estado y bloquea las actualizaciones en tiempo real (polling).
        
        const runSync = async function () {
            if (!root.isConnected || isSaving) return;
            const text = dayLicenseSplitGetMergedText(root);
            const t = text.trim();
            if (t === lastSyncedText) {
                clearDayDraftLocal(licenseId, day);
                return;
            }
            isSaving = true;
            try {
                await syncDayNotepad(licenseId, day, text);
                lastSyncedText = t;
            } catch (err) {
                console.error('Error al sincronizar día:', err);
            } finally {
                isSaving = false;
            }
        };

        if (window.AdminLicenciasUndoCore && typeof window.AdminLicenciasUndoCore.attach === 'function') {
            window.AdminLicenciasUndoCore.attach(root, {
                listenElement: root,
                useFocusOutDelegate: true,
                getPlainText: function () {
                    return dayLicenseSplitGetMergedText(root);
                },
                setPlainText: function (text) {
                    dayLicenseSplitApplyMergedText(root, text != null ? text : '');
                    lastSyncedText = dayLicenseSplitGetMergedText(root).trim();
                },
                undoBtn: undoBtn,
                redoBtn: redoBtn,
                onPersist: function () {
                    const text = dayLicenseSplitGetMergedText(root);
                    saveDayDraftLocal(licenseId, day, text);
                    lastSyncedText = text.trim();
                    clearTimeout(saveTimeout);
                    syncDayNotepad(licenseId, day, text).catch(function (err) {
                        console.error('Error al sincronizar día (undo/redo):', err);
                    });
                },
                afterVisual: function () {
                    if (licenseId != null && typeof window.refreshDuplicateEmailHighlights === 'function') {
                        window.refreshDuplicateEmailHighlights(licenseId);
                    }
                    dayLicenseSplitScheduleAutosize(root);
                }
            });
        }

        if (typeof ResizeObserver !== 'undefined' && rowsWrap.dataset.dayResizeObs !== '1') {
            rowsWrap.dataset.dayResizeObs = '1';
            const ro = new ResizeObserver(function () {
                dayLicenseSplitAutosizeCreds(root);
            });
            ro.observe(rowsWrap);
        }

        root.addEventListener(
            'mousedown',
            function (e) {
                if (!root.classList.contains('license-notepad--locked')) return;
                if (e.target.closest && e.target.closest('.license-split-editor__user-suggestions')) return;
                const inCreds =
                    e.target === ta || (e.target.closest && e.target.closest('.license-split-editor__creds-cell'));
                const inSide = e.target.closest && e.target.closest('.license-split-editor__side');
                if (!inCreds && !inSide) return;
                e.preventDefault();
                dayLicenseSplitUnlock(root);
                if (e.target.closest && e.target.closest('.license-split-editor__restore-to-license-btn')) {
                return;
            }
                let cell =
                    e.target.closest &&
                    e.target.closest(
                        '.license-split-editor__user, .license-split-editor__status-good, .license-split-editor__status-bad, .license-split-editor__otro-combined, .license-split-editor__note'
                    );
                if (!cell && e.target.closest) {
                    const uw = e.target.closest('.license-split-editor__user-wrap');
                    if (uw) cell = uw.querySelector('.license-split-editor__user');
                }
                if (!cell && e.target.closest) {
                    const row = e.target.closest('.license-split-editor__row');
                    if (row) cell = row.querySelector('.license-split-editor__user');
                }
                if (inSide && cell) {
                e.preventDefault();
                    cell.focus();
                } else if (inSide) {
                    e.preventDefault();
                    ta.focus();
                } else if (inCreds) {
                    e.preventDefault();
                    ta.focus();
                }
            },
            true
        );

        ta.addEventListener(
            'beforeinput',
            function (e) {
                if (ta.readOnly) {
            e.preventDefault();
                }
            },
            true
        );
        ta.addEventListener(
            'paste',
            function (e) {
                if (ta.readOnly) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            true
        );

        function onFieldInput() {
            clearTimeout(saveTimeout);
            const currentText = dayLicenseSplitGetMergedText(root);
            if (currentText.trim() === lastSyncedText) {
                clearDayDraftLocal(licenseId, day);
            } else {
                saveDayDraftLocal(licenseId, day, currentText);
            }
            saveTimeout = setTimeout(function () {
                if (!root.isConnected) return;
                runSync();
            }, 500);
            if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
                window.scheduleRefreshAdminDupIfActive();
            }
        }

        ta.addEventListener('input', function () {
            dayLicenseSplitSyncRowsToTextarea(root);
            onFieldInput();
        });
        rowsWrap.addEventListener('input', onFieldInput);
        rowsWrap.addEventListener('change', onFieldInput);

        ta.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
            clearTimeout(saveTimeout);
                runSync();
            }
        });

        root.addEventListener('focusout', function () {
            window.setTimeout(function () {
                const a = document.activeElement;
                if (a && root.contains(a)) return;
                clearTimeout(saveTimeout);
                const currentText = dayLicenseSplitGetMergedText(root);
                if (currentText.trim() === lastSyncedText) {
                    clearDayDraftLocal(licenseId, day);
                } else {
                    saveDayDraftLocal(licenseId, day, currentText);
                }
                runSync();
                dayLicenseSplitLock(root);
                flushPendingLoadAllDaysSoldAccounts();
                if (typeof window.scheduleRefreshAdminDupIfActive === 'function') {
                    window.scheduleRefreshAdminDupIfActive();
                }
            }, 0);
        });
    });
}

// Configurar el campo de entrada para agregar correos vendidos
function setupSoldAccountsInput(licenseId, day) {
    const soldInput = document.getElementById('soldAccountsInput');
    if (!soldInput) return;
    
    soldInput.dataset.licenseId = licenseId;
    soldInput.dataset.day = day;
    
    let saveTimeout;
    
    soldInput.addEventListener('input', function() {
        // Guardar automáticamente después de 2 segundos sin escribir
        clearTimeout(saveTimeout);
        const text = this.innerText || this.textContent || '';
        
        saveTimeout = setTimeout(async () => {
            if (text.trim() && licenseId) {
                await saveSoldAccounts(licenseId, text, day);
            }
        }, 2000);
    });
    
    // Guardar al presionar Ctrl+Enter o Cmd+Enter
    soldInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(saveTimeout);
            const text = this.innerText || this.textContent || '';
            if (text.trim() && licenseId) {
                saveSoldAccounts(licenseId, text, day);
            }
        }
    });
    
    // Manejar placeholder
    soldInput.addEventListener('focus', function() {
        if (this.textContent.trim() === '' || this.textContent === this.dataset.placeholder) {
            this.textContent = '';
        }
    });
    
    soldInput.addEventListener('blur', function() {
        if (this.textContent.trim() === '') {
            this.textContent = this.dataset.placeholder || '';
            this.classList.add('empty');
        } else {
            this.classList.remove('empty');
        }
    });
    
    // Inicializar placeholder
    if (!soldInput.textContent.trim()) {
        soldInput.textContent = soldInput.dataset.placeholder || '';
        soldInput.classList.add('empty');
    }
}

// Guardar cuentas vendidas masivamente
async function saveSoldAccounts(licenseId, text, day) {
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
    const accounts = parseAccountsText(text, licenseId);
    
    if (accounts.length === 0) {
        return;
    }
    
    // Crear la fecha con el día seleccionado
    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), day);
    
    // Guardar cada cuenta como vendida
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Primero crear la cuenta
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success && createData.account_id) {
                // Marcar como vendida con la fecha
                await fetch(`/tienda/api/accounts/${createData.account_id}/mark-sold`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCSRFToken()
                    },
                    body: JSON.stringify({
                        sold_date: saleDate.toISOString()
                    })
                });
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
    
    // Limpiar el campo y recargar
    const soldInput = document.getElementById('soldAccountsInput');
    if (soldInput) {
        soldInput.textContent = '';
        soldInput.innerHTML = '';
    }
    
    await loadLicenses();
    loadAndDisplaySavedAccounts(licenseId);
    loadAllDaysSoldAccounts(licenseId);
}

/** ¿Coincide el término (minúsculas) con producto, notas, caídas, cuentas o borradores locales? */
function licenseMatchesSearchTerm(license, searchTerm) {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    const inc = (s) => (s == null ? '' : String(s)).toLowerCase().includes(t);

    if (inc(license.product_name)) return true;
    if (inc(license.personal_notes)) return true;
    if (inc(license.license_notes)) return true;
    if (inc(license.suspended_notes)) return true;
    if (inc(license.expired_notes)) return true;
    if (inc(license.changes_notes)) return true;

    try {
        const id = license.id;
        const pk = 'admin_licencias_bloc_personal_' + id + '_v1';
        const lk = 'admin_licencias_bloc_license_' + id + '_v1';
        const sk = 'admin_licencias_bloc_suspended_' + id + '_v1';
        const ek = 'admin_licencias_bloc_expired_' + id + '_v1';
        const ck = 'admin_licencias_bloc_changes_' + id + '_v1';
        if (inc(localStorage.getItem(pk))) return true;
        if (inc(localStorage.getItem(lk))) return true;
        if (inc(localStorage.getItem(sk))) return true;
        if (inc(localStorage.getItem(ek))) return true;
        if (inc(localStorage.getItem(ck))) return true;
        for (let d = 1; d <= 31; d++) {
            if (inc(localStorage.getItem('admin_licencias_day_draft_' + id + '_' + d + '_v1'))) return true;
        }
    } catch (e) {}

    if (license.accounts && license.accounts.length) {
        for (let i = 0; i < license.accounts.length; i++) {
            const acc = license.accounts[i];
            if (inc(acc.email)) return true;
            if (inc(acc.password)) return true;
            if (inc(acc.account_identifier)) return true;
        }
    }
    return false;
}

// Filtrar licencias (producto, notas, licencias, caídas, días/cuentas; sin distinguir mayúsculas)
function filterLicenses() {
    const searchInput = document.getElementById('adminStoreSearch');
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    const cards = document.querySelectorAll('.license-card');
    
    // Si no hay término de búsqueda, mostrar todo y quitar resaltado
    if (!searchTerm) {
        cards.forEach(card => {
            if (
                card.classList.contains('license-card--panel-toggle')
            ) {
                card.classList.remove('hidden-by-search');
                return;
            }
            card.classList.remove('hidden-by-search');
        });
        const inputContainer = document.getElementById('licenseAccountsInputContainer');
        if (inputContainer) {
            inputContainer.classList.remove('search-active');
        }
        removeEmailHighlights();
        const ic2 = document.getElementById('licenseAccountsInputContainer');
        const aid2 =
            ic2 && ic2.dataset.activeLicenseId != null ? parseInt(ic2.dataset.activeLicenseId, 10) : NaN;
        if (aid2 === AGGREGATE_LICENSE_ID) {
            scheduleLoadAllDaysSoldAccounts(AGGREGATE_LICENSE_ID);
        }
        return;
    }
    
    // Marcar que hay búsqueda activa
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    if (inputContainer) {
        inputContainer.classList.add('search-active');
    }
    
    cards.forEach(card => {
        if (
            card.classList.contains('license-card--panel-toggle')
        ) {
            card.classList.remove('hidden-by-search');
            return;
        }
        const licenseId = parseInt(card.dataset.licenseId, 10);
        const license = licenses.find(l => l.id === licenseId);
        if (!license) {
            card.classList.add('hidden-by-search');
            return;
        }
        if (licenseMatchesSearchTerm(license, searchTerm)) {
            card.classList.remove('hidden-by-search');
        } else {
            card.classList.add('hidden-by-search');
        }
    });
    
    highlightMatchingEmails(searchTerm);

    clearTimeout(window.__aggregateDaysFilterDebounce);
    window.__aggregateDaysFilterDebounce = setTimeout(function () {
        const ic = document.getElementById('licenseAccountsInputContainer');
        const aid = ic && ic.dataset.activeLicenseId != null ? parseInt(ic.dataset.activeLicenseId, 10) : NaN;
        if (aid === AGGREGATE_LICENSE_ID) {
            scheduleLoadAllDaysSoldAccounts(AGGREGATE_LICENSE_ID);
        }
    }, 200);
}

const LIC_SEARCH_HIT_ROW_CLASS = 'license-split-editor__row--search-hit';

function clearAllLicenseSplitSearchHitVisuals() {
    document.querySelectorAll('.' + LIC_SEARCH_HIT_ROW_CLASS).forEach(function (row) {
        row.classList.remove(LIC_SEARCH_HIT_ROW_CLASS);
    });
    document
        .querySelectorAll('.admin-licencias-page textarea.license-split-editor__creds[data-lic-search-lines-active="1"]')
        .forEach(function (ta) {
            stripLicenseCredTaSearchLineDecoration(ta);
        });
}

function stripLicenseCredTaSearchLineDecoration(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    delete ta.dataset.licSearchLinesActive;
    ta.style.backgroundImage = '';
}

/**
 * Franjas azules (mismo tono que .search-highlight) en columnas de credenciales tipo split: una banda por línea con coincidencia.
 */
function applyLicenseCredTaSearchLineDecoration(ta, hitLineIndices) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    stripLicenseCredTaSearchLineDecoration(ta);
    if (!hitLineIndices || !hitLineIndices.length) return;
    const seen = Object.create(null);
    const hits = [];
    hitLineIndices.forEach(function (ii) {
        if (Number.isFinite(ii) && ii >= 0 && !seen[ii]) {
            seen[ii] = true;
            hits.push(ii);
        }
    });
    hits.sort(function (a, b) {
        return a - b;
    });
    if (!hits.length) return;

    const cs = window.getComputedStyle(ta);
    const padT = parseFloat(cs.paddingTop) || 0;
    let stridePx = parseFloat(cs.lineHeight);
    if (!stridePx || Number.isNaN(stridePx) || cs.lineHeight === 'normal') {
        const fz = parseFloat(cs.fontSize) || 14;
        stridePx = fz * 1.45;
    }
    let bw = 2;
    try {
        const host = ta.closest('.license-split-editor');
        const hcs = host ? window.getComputedStyle(host) : null;
        if (hcs) {
            const rbw = parseFloat(hcs.getPropertyValue('--lic-border-w'));
            if (Number.isFinite(rbw)) bw = rbw;
        }
    } catch (eBw) {}

    const topBarrier = bw + 2;
    const baseStripe =
        'linear-gradient(to top, #000000 0, #000000 calc(' +
        topBarrier +
        'px), transparent calc(' +
        topBarrier +
        'px)), repeating-linear-gradient(to bottom, transparent 0, transparent ' +
        (stridePx - bw) +
        'px, rgba(59, 130, 246, 0.48) ' +
        (stridePx - bw) +
        'px, rgba(59, 130, 246, 0.48) ' +
        stridePx +
        'px)';

    const blueGradients = hits.map(function (lineIdx) {
        const y0 = Math.round(padT + lineIdx * stridePx);
        const y1 = Math.max(y0 + 1, Math.round(padT + (lineIdx + 1) * stridePx - bw - 2));
        return (
            'linear-gradient(to bottom, transparent ' +
            y0 +
            'px, rgba(0, 79, 255, 0.55) ' +
            y0 +
            'px, rgba(0, 79, 255, 0.55) ' +
            y1 +
            'px, transparent ' +
            y1 +
            'px)'
        );
    });

    ta.style.backgroundImage = blueGradients.concat([baseStripe]).join(', ');
    ta.dataset.licSearchLinesActive = '1';
}

function mergedAndCredSearchHitIndices(mergedLines, credLines, searchTerm) {
    const q = String(searchTerm || '').trim().toLowerCase();
    if (!q) return [];
    const n = Math.max(mergedLines.length, credLines.length);
    const out = [];
    for (let i = 0; i < n; i++) {
        const c = String(credLines[i] != null ? credLines[i] : '').toLowerCase();
        const m = String(mergedLines[i] != null ? mergedLines[i] : '').toLowerCase();
        if (c.includes(q) || m.includes(q)) out.push(i);
    }
    return out;
}

function hitsLineArrayToKeyedSet(hitArr) {
    const o = Object.create(null);
    (hitArr || []).forEach(function (ii) {
        if (Number.isFinite(ii) && ii >= 0) o[ii] = true;
    });
    return o;
}

function paintSplitRowsSearchHits(rowEls, hitKeyed) {
    if (!rowEls || !rowEls.length) return;
    for (let i = 0; i < rowEls.length; i++) {
        const row = rowEls[i];
        if (!row || !row.classList) continue;
        if (hitKeyed && hitKeyed[i]) row.classList.add(LIC_SEARCH_HIT_ROW_CLASS);
        else row.classList.remove(LIC_SEARCH_HIT_ROW_CLASS);
    }
}

function highlightMatchingEmails(searchTerm) {
    if (!searchTerm || searchTerm.length < 1) {
        removeEmailHighlights();
        return;
    }

    clearAllLicenseSplitSearchHitVisuals();

    adminLicCollectDaySplitRootsForActiveUi().forEach(function (item) {
        const fullText = (
            typeof dayLicenseSplitGetMergedText === 'function' ? dayLicenseSplitGetMergedText(item) || '' : item.textContent || ''
        ).toLowerCase();
        const matches = fullText.includes(searchTerm);
        const emailSpan = item.querySelector('.day-account-email');
        const passwordSpan = item.querySelector('.day-account-password');

        if (matches) {
            item.classList.add('search-match');
            if (emailSpan) {
                if (emailSpan.textContent.toLowerCase().includes(searchTerm)) {
                    emailSpan.classList.add('search-highlight');
                } else {
                    emailSpan.classList.remove('search-highlight');
                }
            }
            if (passwordSpan) {
                if (passwordSpan.textContent.toLowerCase().includes(searchTerm)) {
                    passwordSpan.classList.add('search-highlight');
                } else {
                    passwordSpan.classList.remove('search-highlight');
                }
            }
        } else {
            item.classList.remove('search-match');
            if (emailSpan) emailSpan.classList.remove('search-highlight');
            if (passwordSpan) passwordSpan.classList.remove('search-highlight');
        }
    });

    const personalTa = document.getElementById('adminLicenciasNotepadPersonal');
    if (personalTa) {
        if ((personalTa.value || '').toLowerCase().includes(searchTerm)) {
            personalTa.classList.add('search-match');
        } else {
            personalTa.classList.remove('search-match');
        }
    }

    function applyNotepadBlock(el) {
        if (!el) return;
        const plain = (
            el.tagName === 'TEXTAREA' ? el.value || '' : el.textContent || ''
        ).toLowerCase();
        if (plain.includes(searchTerm)) {
            el.classList.add('search-match');
            if (el.tagName !== 'TEXTAREA') {
            el.querySelectorAll('.day-account-email, .saved-account-email').forEach(span => {
                if (span.textContent.toLowerCase().includes(searchTerm)) {
                    span.classList.add('search-highlight');
                } else {
                    span.classList.remove('search-highlight');
                }
            });
            el.querySelectorAll('.day-account-password, .saved-account-password').forEach(span => {
                if (span.textContent.toLowerCase().includes(searchTerm)) {
                    span.classList.add('search-highlight');
                } else {
                    span.classList.remove('search-highlight');
                }
            });
            }
        } else {
            el.classList.remove('search-match');
            el.querySelectorAll('.search-highlight').forEach(n => n.classList.remove('search-highlight'));
        }
    }

    const licSplitRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
    const licTa = document.getElementById('adminLicenciasNotepadByLicense');
    if (licSplitRoot && licTa && typeof window.adminLicenseSplitGetMergedNotes === 'function') {
        const mergedRaw = window.adminLicenseSplitGetMergedNotes() || '';
        const mergedLow = mergedRaw.toLowerCase();
        const mergedLinesArr = mergedRaw.length === 0 ? [] : mergedRaw.replace(/\r\n/g, '\n').split('\n');
        const rawLic = String(licTa.value != null ? licTa.value : '').replace(/\r\n/g, '\n');
        const credLinesLic = adminMainLicenseCredLinesCollapsed(rawLic);
        const hitsLic = mergedAndCredSearchHitIndices(mergedLinesArr, credLinesLic, searchTerm);
        if (mergedLow.includes(searchTerm)) {
            licSplitRoot.classList.add('search-match');
            licTa.classList.add('search-match');
        } else {
            licSplitRoot.classList.remove('search-match');
            licTa.classList.remove('search-match');
        }
        paintSplitRowsSearchHits(typeof adminLicenseSplitGetRowElements === 'function' ? adminLicenseSplitGetRowElements() : [], hitsLineArrayToKeyedSet(hitsLic));
        applyLicenseCredTaSearchLineDecoration(licTa, hitsLic);
    } else {
        applyNotepadBlock(licTa);
    }
    const suspSplitRoot = document.getElementById('adminLicenciasSuspendedSplitRoot');
    const suspTa = document.getElementById('adminLicenciasSuspendedNotepad');
    if (suspSplitRoot && suspTa && typeof window.suspendedLicenseSplitGetMergedText === 'function') {
        const suspMergedRaw = window.suspendedLicenseSplitGetMergedText(suspSplitRoot) || '';
        const suspMergedLow = suspMergedRaw.toLowerCase();
        const mergedLinesSus = suspMergedRaw.length === 0 ? [] : suspMergedRaw.replace(/\r\n/g, '\n').split('\n');
        const credLinesSus = licenseSplitCredLinesFromRaw(String(suspTa.value != null ? suspTa.value : '').replace(/\r\n/g, '\n'));
        const hitsSus = mergedAndCredSearchHitIndices(mergedLinesSus, credLinesSus, searchTerm);
        if (suspMergedLow.includes(searchTerm)) {
            suspSplitRoot.classList.add('search-match');
            suspTa.classList.add('search-match');
        } else {
            suspSplitRoot.classList.remove('search-match');
            suspTa.classList.remove('search-match');
        }
        paintSplitRowsSearchHits(suspendedLicenseSplitGetRowElements(suspSplitRoot), hitsLineArrayToKeyedSet(hitsSus));
        applyLicenseCredTaSearchLineDecoration(suspTa, hitsSus);
    } else {
        applyNotepadBlock(suspTa);
    }
    const expSplitRoot = document.getElementById('adminLicenciasExpiredSplitRoot');
    const expTa = document.getElementById('adminLicenciasExpiredNotepad');
    if (expSplitRoot && expTa && typeof window.expiredLicenseSplitGetMergedText === 'function') {
        const expMergedRaw = window.expiredLicenseSplitGetMergedText(expSplitRoot) || '';
        const expMergedLow = expMergedRaw.toLowerCase();
        const mergedLinesExp = expMergedRaw.length === 0 ? [] : expMergedRaw.replace(/\r\n/g, '\n').split('\n');
        const credLinesExp = licenseSplitCredLinesFromRaw(String(expTa.value != null ? expTa.value : '').replace(/\r\n/g, '\n'));
        const hitsExp = mergedAndCredSearchHitIndices(mergedLinesExp, credLinesExp, searchTerm);
        if (expMergedLow.includes(searchTerm)) {
            expSplitRoot.classList.add('search-match');
            expTa.classList.add('search-match');
        } else {
            expSplitRoot.classList.remove('search-match');
            expTa.classList.remove('search-match');
        }
        paintSplitRowsSearchHits(expiredLicenseSplitGetRowElements(expSplitRoot), hitsLineArrayToKeyedSet(hitsExp));
        applyLicenseCredTaSearchLineDecoration(expTa, hitsExp);
    }
    adminLicCollectDaySplitRootsForActiveUi().forEach(function (dayRoot) {
        if (typeof dayLicenseSplitQueryCredsTa !== 'function' || typeof dayLicenseSplitGetMergedText !== 'function' || typeof dayLicenseSplitGetRowElements !== 'function') {
            return;
        }
        const taDay = dayLicenseSplitQueryCredsTa(dayRoot);
        if (!taDay || taDay.tagName !== 'TEXTAREA') return;
        const mergedRawD = dayLicenseSplitGetMergedText(dayRoot) || '';
        const mergedLinesD = mergedRawD.length === 0 ? [] : mergedRawD.replace(/\r\n/g, '\n').split('\n');
        const credLinesD = licenseSplitCredLinesFromRaw(String(taDay.value != null ? taDay.value : '').replace(/\r\n/g, '\n'));
        const hitsD = mergedAndCredSearchHitIndices(mergedLinesD, credLinesD, searchTerm);
        if (mergedRawD.toLowerCase().includes(searchTerm)) {
            dayRoot.classList.add('search-match');
            taDay.classList.add('search-match');
        } else {
            dayRoot.classList.remove('search-match');
            taDay.classList.remove('search-match');
        }
        paintSplitRowsSearchHits(dayLicenseSplitGetRowElements(dayRoot), hitsLineArrayToKeyedSet(hitsD));
        applyLicenseCredTaSearchLineDecoration(taDay, hitsD);
    });
    if (typeof changesLicenseSplitGetMergedText === 'function' && typeof changesLicenseSplitGetRowElements === 'function' && typeof changesLicenseSplitQueryCredsTa === 'function') {
        document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(function (chRoot) {
            const chta = changesLicenseSplitQueryCredsTa(chRoot);
            if (!chta || chta.tagName !== 'TEXTAREA') return;
            const mergedRawCh = changesLicenseSplitGetMergedText(chRoot) || '';
            const mergedLinesCh = mergedRawCh.length === 0 ? [] : mergedRawCh.replace(/\r\n/g, '\n').split('\n');
            const credLinesCh = licenseSplitCredLinesFromRaw(String(chta.value != null ? chta.value : '').replace(/\r\n/g, '\n'));
            const hitsCh = mergedAndCredSearchHitIndices(mergedLinesCh, credLinesCh, searchTerm);
            if (mergedRawCh.toLowerCase().includes(searchTerm)) {
                chRoot.classList.add('search-match');
                chta.classList.add('search-match');
            } else {
                chRoot.classList.remove('search-match');
                chta.classList.remove('search-match');
            }
            paintSplitRowsSearchHits(changesLicenseSplitGetRowElements(chRoot), hitsLineArrayToKeyedSet(hitsCh));
            applyLicenseCredTaSearchLineDecoration(chta, hitsCh);
        });
    }

    document.querySelectorAll('.license-aggregate-product-text').forEach(function (pre) {
        const plain = (pre.textContent || '').toLowerCase();
        if (plain.includes(searchTerm)) {
            pre.classList.add('search-match');
        } else {
            pre.classList.remove('search-match');
        }
    });
}

function removeEmailHighlights() {
    clearAllLicenseSplitSearchHitVisuals();
    const licDaysClr = document.getElementById('licenseAllDaysContainer');
    if (licDaysClr) {
        licDaysClr.querySelectorAll('.day-account-item').forEach(item => {
            item.classList.remove('search-match');
            const emailSpan = item.querySelector('.day-account-email');
            if (emailSpan) emailSpan.classList.remove('search-highlight');
            const passwordSpan = item.querySelector('.day-account-password');
            if (passwordSpan) passwordSpan.classList.remove('search-highlight');
        });
    }
    const personalTa = document.getElementById('adminLicenciasNotepadPersonal');
    if (personalTa) personalTa.classList.remove('search-match');
    const licSplitRoot = document.getElementById('adminLicenciasLicenseSplitRoot');
    if (licSplitRoot) licSplitRoot.classList.remove('search-match');
    const suspSplitRootRm = document.getElementById('adminLicenciasSuspendedSplitRoot');
    if (suspSplitRootRm) suspSplitRootRm.classList.remove('search-match');
    const expSplitRootRm = document.getElementById('adminLicenciasExpiredSplitRoot');
    if (expSplitRootRm) expSplitRootRm.classList.remove('search-match');
    document.querySelectorAll('#licenseChangesProductsContainer .changes-license-split-root').forEach(function (cr) {
        cr.classList.remove('search-match');
    });
    ['adminLicenciasNotepadByLicense', 'adminLicenciasSuspendedNotepad', 'adminLicenciasExpiredNotepad'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('search-match');
            el.querySelectorAll('.search-highlight').forEach(n => n.classList.remove('search-highlight'));
        }
    });
    document.querySelectorAll('.license-aggregate-product-text').forEach(function (pre) {
        pre.classList.remove('search-match');
    });
}

// Inicializar licencias desde productos existentes
async function initializeLicensesFromProducts() {
    try {
        const response = await fetch('/tienda/api/licenses/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Recargar las licencias para mostrar las nuevas
            await loadLicenses();
        } else {
            console.error('Error al inicializar licencias:', data.error);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Verificar y corregir duplicados solo si es necesario
async function checkAndFixDuplicates() {
    try {
        // Obtener todas las licencias
        await loadLicenses();
        
        if (licenses.length === 0) {
            return;
        }
        
        // Verificar si hay duplicados
        const positions = licenses.map(license => license.position);
        const uniquePositions = [...new Set(positions)];
        
        if (positions.length === uniquePositions.length) {
            return;
        }
        await reorganizeAllLicenses();
        
    } catch (error) {
        console.error('Error al verificar duplicados:', error);
    }
}

// Reorganizar todas las licencias para eliminar duplicados
async function reorganizeAllLicenses() {
    try {
        // Obtener todas las licencias
        await loadLicenses();
        
        if (licenses.length === 0) {
            return;
        }
        
        // Reorganizar cada licencia secuencialmente
        for (let i = 0; i < licenses.length; i++) {
            const license = licenses[i];
            const newPosition = i + 1;
            
            if (license.position !== newPosition) {
                try {
                    const response = await fetch(`/tienda/api/licenses/${license.id}/position`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({ 
                            position: newPosition,
                            reorganize: false  // No reorganizar para evitar bucles
                        })
                    });
                    
                    const data = await response.json();
                    if (!data.success) {
                        console.error(`Error al reorganizar licencia ${license.id}:`, data.error);
                    }
                } catch (error) {
                    console.error(`Error al reorganizar licencia ${license.id}:`, error);
                }
            }
        }
        
        // Recargar las licencias para mostrar las posiciones actualizadas
        await loadLicenses();
        
    } catch (error) {
        console.error('Error al reorganizar licencias:', error);
    }
}

// Mostrar menú de licencia archivada
function showArchivedLicenseMenu(licenseId) {
    // Cerrar otros menús
    document.querySelectorAll('.archived-license-menu').forEach(menu => {
        menu.style.display = 'none';
    });

    // Buscar o crear el menú para esta licencia
    let menu = document.querySelector(`.archived-license-menu[data-license-id="${licenseId}"]`);
    if (!menu) {
        menu = createArchivedLicenseMenu(licenseId);
        document.body.appendChild(menu); // Agregar al body para posicionamiento fijo
    }

    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        // Posicionar el modal correctamente
        const button = document.querySelector(`.archived-license-card[data-license-id="${licenseId}"] .archived-license-action-btn`);
        if (button) {
            const rect = button.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            
            // Calcular posición centrada
            const menuWidth = 180; // Ancho del modal archivado
            const viewportWidth = window.innerWidth;
            const buttonCenterX = rect.left + rect.width / 2;
            
            let leftPosition = buttonCenterX - menuWidth / 2;
            
            // Ajustar si se sale por la izquierda
            if (leftPosition < 10) {
                leftPosition = 10;
            }
            
            // Ajustar si se sale por la derecha
            if (leftPosition + menuWidth > viewportWidth - 10) {
                leftPosition = viewportWidth - menuWidth - 10;
            }
            
            // Posicionar el modal
            menu.style.left = (leftPosition + scrollLeft) + 'px';
            menu.style.top = (rect.top + scrollTop - 10) + 'px';
        }
        menu.style.display = 'block';
    }
}

// Crear menú de licencia archivada
function createArchivedLicenseMenu(licenseId) {
    const menu = document.createElement('div');
    menu.className = 'archived-license-menu';
    menu.dataset.licenseId = licenseId;
    menu.style.display = 'none';

    menu.innerHTML = `
        <div class="archived-license-menu-content">
            <button class="archived-license-menu-item" data-action="restore-license" data-license-id="${licenseId}">
                <i class="fas fa-undo"></i> Desarchivar
            </button>
        </div>
    `;

    return menu;
}

// Restaurar licencia archivada
async function restoreLicense(licenseId) {
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/restore`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Licencia restaurada correctamente');
                await loadLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al restaurar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al restaurar la licencia');
        }
    } catch (error) {
        console.error('Error al restaurar licencia:', error);
        showError('Error de conexión al restaurar la licencia');
    }
}

// Ir a la página de archivados
function goToArchivedPage() {
    window.location.href = '/tienda/admin/archivados';
}

// Eliminar licencia permanentemente
async function deleteLicense(licenseId) {
    if (!confirm('¿Estás seguro de que quieres eliminar permanentemente esta licencia? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Licencia eliminada correctamente');
                await loadLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al eliminar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al eliminar la licencia');
        }
    } catch (error) {
        console.error('Error al eliminar licencia:', error);
        showError('Error de conexión al eliminar la licencia');
    }
}

// Mostrar menú de opciones de licencia
function showLicenseMenu(licenseId) {
    // Ocultar otros menús abiertos
    document.querySelectorAll('.license-menu').forEach(menu => {
        if (menu.dataset.licenseId !== licenseId.toString()) {
            menu.style.display = 'none';
        }
    });
    
    // Buscar o crear el menú para esta licencia
    let menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    
    if (!menu) {
        // Crear el menú si no existe
        menu = createLicenseMenu(licenseId);
        document.body.appendChild(menu); // Agregar al body para posicionamiento fijo
    }
    
    // Toggle del menú
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        // Posicionar el modal correctamente
        const button = document.querySelector(`.license-card[data-license-id="${licenseId}"] .license-action-btn`);
        if (button) {
            const rect = button.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            
            // Calcular posición centrada
            const menuWidth = 200; // Ancho del modal
            const viewportWidth = window.innerWidth;
            const buttonCenterX = rect.left + rect.width / 2;
            
            let leftPosition = buttonCenterX - menuWidth / 2;
            
            // Ajustar si se sale por la izquierda
            if (leftPosition < 10) {
                leftPosition = 10;
            }
            
            // Ajustar si se sale por la derecha
            if (leftPosition + menuWidth > viewportWidth - 10) {
                leftPosition = viewportWidth - menuWidth - 10;
            }
            
            // Posicionar el modal
            menu.style.left = (leftPosition + scrollLeft) + 'px';
            menu.style.top = (rect.top + scrollTop - 10) + 'px';
        }
        menu.style.display = 'block';
    }
}

function createLicenseMenu(licenseId) {
    const menu = document.createElement('div');
    menu.className = 'license-menu';
    menu.dataset.licenseId = licenseId;
    menu.style.display = 'none';

    // Buscar la posición de la licencia
    const license = licenses.find(l => l.id === licenseId);
    const position = license ? license.position : 1;

    menu.innerHTML = `
        <div class="license-menu-content">
            <button class="license-menu-item" data-action="change-license-position" data-license-id="${licenseId}">
                <i class="fas fa-sort"></i> ${position} Cambiar Posición
            </button>
            <button class="license-menu-item" data-action="archive-license" data-license-id="${licenseId}">
                <i class="fas fa-archive"></i> Archivar
            </button>
        </div>
    `;

    return menu;
}

// Archivar licencia
async function archiveLicense(licenseId) {
    if (!confirm('¿Estás seguro de que quieres archivar esta licencia?')) {
        return;
    }

    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/archive`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Licencia archivada correctamente');
                await loadLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al archivar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al archivar la licencia');
        }
    } catch (error) {
        console.error('Error al archivar licencia:', error);
        showError('Error de conexión al archivar la licencia');
    }
}

// Cambiar posición de licencia
async function changeLicensePosition(licenseId) {
    const newPosition = prompt('Ingresa la nueva posición:');
    if (newPosition === null || newPosition.trim() === '') return;
    
    const position = parseInt(newPosition);
    if (isNaN(position) || position < 1) {
        showError('La posición debe ser un número mayor a 0');
        return;
    }
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/position`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({ 
                position: position,
                reorganize: false  // No reorganizar automáticamente
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess(`Posición actualizada a ${position}. Las otras licencias se reorganizaron automáticamente.`);
            // Actualizar el menú si está abierto
            const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
            if (menu) {
                const changePositionBtn = menu.querySelector('button[onclick*="changeLicensePosition"]');
                if (changePositionBtn) {
                    changePositionBtn.innerHTML = `<i class="fas fa-sort"></i> ${position} Cambiar Posición`;
                }
            }
        } else {
            showError(data.error || 'Error al actualizar posición');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al actualizar posición');
    }
    
    // Ocultar menú
    const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Ocultar licencia
async function toggleLicenseVisibility(licenseId) {
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess('Licencia ocultada correctamente');
        } else {
            showError(data.error || 'Error al ocultar licencia');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al ocultar licencia');
    }
    
    // Ocultar menú
    const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Mostrar licencia (restaurar)
async function restoreLicenseVisibility(licenseId) {
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess('Licencia mostrada correctamente');
        } else {
            showError(data.error || 'Error al mostrar licencia');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al mostrar licencia');
    }
    
    // Ocultar menú
    const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Mostrar modal para agregar licencia
function showAddLicenseModal() {
    // Implementar modal para crear nueva licencia
}

// Utilidades
function getCSRFToken() {
    const token = document.querySelector('meta[name="csrf_token"]');
    return token ? token.getAttribute('content') : '';
}

var _licenseDayRenewalConfirmResolver = null;
var _licenseDayRenewalConfirmReturnFocus = null;

function adminLicenseDayRenewalConfirmClose(result, options) {
    const opts = options || {};
    const modal = document.getElementById('licenseDayRenewalConfirmModal');
    if (modal) {
        const focused = document.activeElement;
        if (focused && modal.contains(focused) && typeof focused.blur === 'function') {
            focused.blur();
        }
        modal.classList.add('d-none');
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
        if (opts.restoreFocus !== false) {
            const ret = _licenseDayRenewalConfirmReturnFocus;
            _licenseDayRenewalConfirmReturnFocus = null;
            if (ret && typeof ret.focus === 'function') {
                try {
                    ret.focus({ preventScroll: true });
                } catch (_focusErr) {
                    try {
                        ret.focus();
                    } catch (_focusErr2) {
                        /* ignore */
                    }
                }
            }
        }
    }
    const resolve = _licenseDayRenewalConfirmResolver;
    _licenseDayRenewalConfirmResolver = null;
    if (typeof resolve === 'function') {
        resolve(!!result);
    }
}

function adminLicenseDayRenewalConfirmShow(step) {
    return new Promise(function (resolve) {
        const modal = document.getElementById('licenseDayRenewalConfirmModal');
        const bodyEl = document.getElementById('licenseDayRenewalConfirmBody');
        const stepEl = document.getElementById('licenseDayRenewalConfirmStep');
        const okBtn = document.getElementById('licenseDayRenewalConfirmOk');
        const cancelBtn = document.getElementById('licenseDayRenewalConfirmCancel');
        if (!modal || !bodyEl || !okBtn || !cancelBtn) {
            resolve(false);
            return;
        }
        _licenseDayRenewalConfirmResolver = resolve;
        if (step === 1 && !_licenseDayRenewalConfirmReturnFocus) {
            const ae = document.activeElement;
            if (ae && ae !== document.body && !modal.contains(ae)) {
                _licenseDayRenewalConfirmReturnFocus = ae;
            }
        }
        if (stepEl) {
            stepEl.textContent = step === 2 ? 'Paso 2 de 2' : 'Paso 1 de 2';
        }
        if (step === 2) {
            bodyEl.innerHTML =
                '<p class="license-day-renewal-confirm-modal__lead">Segunda y última confirmación</p>' +
                '<p>Esta acción puede <strong>sumar deuda (saldo)</strong> a clientes y <strong>mover líneas</strong> entre blocs (Cambios / Vencidas).</p>' +
                '<p>Solo debes continuar si revisaste que el <strong>día del calendario</strong> en la cuadrícula es el correcto.</p>' +
                '<p class="license-day-renewal-confirm-modal__question">¿Ejecutar ahora la renovación del día?</p>';
            okBtn.textContent = 'Sí, ejecutar';
        } else {
            bodyEl.innerHTML =
                '<p class="license-day-renewal-confirm-modal__lead">Vas a ejecutar la renovación del <strong>día de hoy</strong> (hora Colombia).</p>' +
                '<ul>' +
                '<li><strong>Renovar 1 mes más:</strong> cobra 1 mes al cliente, extiende el vencimiento y deja el verde en —.</li>' +
                '<li><strong>Dejar mes a mes:</strong> cobra 1 mes (si no se cobró ya este mes) y mantiene ese modo.</li>' +
                '<li><strong>— o No renovar:</strong> las cuentas ya vencidas pasan a <strong>Cambios</strong> (producto mes a mes) o a <strong>Vencidas</strong>.</li>' +
                '<li><strong>Sin saldo / límite de deuda:</strong> no se renueva y pasa a <strong>Cambios</strong> (mes a mes) o <strong>Vencidas</strong>.</li>' +
                '</ul>' +
                '<p class="license-day-renewal-confirm-modal__question">¿Deseas continuar?</p>';
            okBtn.textContent = 'Continuar';
        }
        okBtn.onclick = function () {
            adminLicenseDayRenewalConfirmClose(true, {
                restoreFocus: step === 2,
            });
        };
        cancelBtn.onclick = function () {
            adminLicenseDayRenewalConfirmClose(false, { restoreFocus: true });
        };
        modal.classList.remove('d-none');
        modal.removeAttribute('inert');
        modal.setAttribute('aria-hidden', 'false');
        okBtn.focus();
    });
}

(function adminLicenseDayRenewalConfirmWireOnce() {
    if (typeof document === 'undefined') return;
    document.addEventListener('DOMContentLoaded', function () {
        const modal = document.getElementById('licenseDayRenewalConfirmModal');
        if (!modal || modal.getAttribute('data-renewal-confirm-wired') === '1') return;
        modal.setAttribute('data-renewal-confirm-wired', '1');
        modal.addEventListener('click', function (ev) {
            if (ev.target === modal) {
                adminLicenseDayRenewalConfirmClose(false, { restoreFocus: true });
            }
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && !modal.classList.contains('d-none')) {
                adminLicenseDayRenewalConfirmClose(false, { restoreFocus: true });
            }
        });
    });
})();

/**
 * Renovación automática del día (Colombia): cobros + mover vencidas.
 * Requiere dos confirmaciones (modal alto) antes de llamar al API.
 */
async function adminLicenseRunDayRenewalManual(btnEl) {
    const url =
        (btnEl && btnEl.getAttribute('data-renewal-url')) ||
        '/tienda/api/admin/licenses/run-day-renewal';

    if (btnEl) {
        _licenseDayRenewalConfirmReturnFocus = btnEl;
    }

    const ok1 = await adminLicenseDayRenewalConfirmShow(1);
    if (!ok1) {
        return;
    }
    const ok2 = await adminLicenseDayRenewalConfirmShow(2);
    if (!ok2) {
        return;
    }

    const prevHtml = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.setAttribute('aria-busy', 'true');
        btnEl.innerHTML =
            '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Procesando…';
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        if (typeof getCSRFToken === 'function') {
            headers['X-CSRFToken'] = getCSRFToken();
        }
        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            credentials: 'same-origin',
            body: '{}',
        });
        const data = await res.json().catch(function () {
            return {};
        });
        if (!res.ok || !data.success) {
            showError(
                (data && data.error ? String(data.error) : '') ||
                    'No se pudo ejecutar la renovación del día.'
            );
            return;
        }
        const dayNum = data.calendar_day != null ? String(data.calendar_day) : '?';
        const fechaCo = data.colombia_date ? String(data.colombia_date) : '';
        const charged = Number(data.charged) || 0;
        const moved = Number(data.lines_moved) || 0;
        const routedNoSaldo = Number(data.lines_routed_charge_failed) || 0;
        const errN = Number(data.renewal_errors) || 0;
        const otherErr = Math.max(0, errN - routedNoSaldo);
        const skipped = Number(data.skipped_mes_a_mes) || 0;
        let okMsg =
            'Renovación del día ' +
            dayNum +
            (fechaCo ? ' (' + fechaCo + ', Colombia)' : '') +
            ' completada.\n' +
            'Cobros registrados: ' +
            charged +
            '.\n' +
            'Líneas movidas a Cambios/Vencidas: ' +
            moved +
            '.';
        if (routedNoSaldo > 0) {
            okMsg += '\nSin saldo (no renovadas): ' + routedNoSaldo + '.';
        }
        if (skipped > 0) {
            okMsg +=
                '\nMes a mes ya cobrado este mes (omitidos): ' +
                skipped +
                ' (no se vuelve a cobrar hasta el próximo mes).';
        }
        if (charged === 0 && skipped === 0 && moved === 0 && otherErr === 0) {
            okMsg += '\nNo había líneas pendientes de cobrar en el día ' + dayNum + '.';
        } else if (charged > 0) {
            okMsg +=
                '\nNota: con «Puede tener deuda», el cobro suma a la cuenta Licencias del cliente (portal), no al saldo prepago USD/COP de la tienda.';
        }
        if (otherErr > 0) {
            okMsg += '\nOtras líneas sin cobrar (revisar usuario/precio/cuenta): ' + otherErr + '.';
        }
        showSuccess(okMsg);
        if (typeof loadLicenses === 'function') {
            await loadLicenses();
        }
    } catch (err) {
        showError('Error de red al ejecutar la renovación del día.');
        console.error(err);
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.removeAttribute('aria-busy');
            btnEl.innerHTML = prevHtml;
        }
    }
}

function showSuccess(message) {
    // Implementar notificación de éxito
    alert('✓ ' + message);
}

function showError(message) {
    // Implementar notificación de error
    alert('✗ ' + message);
}

// Actualizar contador de archivados (Menú2 y licencias admin)
function updateArchivedCount(count) {
    if (typeof window.updateArchivedMenuCount === 'function') {
        window.updateArchivedMenuCount(count);
        return;
    }
    const countElement = document.getElementById('archivadosCount');
    if (countElement) {
        countElement.textContent = `(${count})`;
    }
}

// Configurar botones del menú 4
document.addEventListener('DOMContentLoaded', function() {
    // Botón de gestionar productos
    const btnGestionarProductos = document.getElementById('btnGestionarProductos');
    if (btnGestionarProductos) {
        btnGestionarProductos.addEventListener('click', function() {
            showGestionarProductosModal();
        });
    }
    
    // Botón de archivados
    const btnArchivados = document.getElementById('btnArchivados');
    if (btnArchivados) {
        btnArchivados.addEventListener('click', function() {
            window.location.href = '/tienda/admin/archivados';
        });
    }

    const btnEjecutarRenovacionDia = document.getElementById('btnEjecutarRenovacionDia');
    if (btnEjecutarRenovacionDia) {
        btnEjecutarRenovacionDia.addEventListener('click', function () {
            void adminLicenseRunDayRenewalManual(btnEjecutarRenovacionDia);
        });
    }

    const btnSaldoClientes = document.getElementById('btnSaldoClientes');
    if (btnSaldoClientes) {
        btnSaldoClientes.addEventListener('click', function () {
            void showSaldoClientesModal();
        });
    }

    const btnRestaurarDesdeArchivo = document.getElementById('btnRestaurarDesdeArchivo');
    if (btnRestaurarDesdeArchivo) {
        btnRestaurarDesdeArchivo.addEventListener('click', function () {
            void showRestaurarArchivadosModal();
        });
    }

    handleAdminLicenciasMenuDeepLink();
});

/** Abre modales al llegar desde Menú2 de otras plantillas (?open=…). Historial → Historial de Compra. */
function handleAdminLicenciasMenuDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const open = (params.get('open') || '').trim().toLowerCase();
    if (!open) return;

    function stripOpenParam() {
        params.delete('open');
        const q = params.toString();
        const next = window.location.pathname + (q ? '?' + q : '') + (window.location.hash || '');
        window.history.replaceState({}, '', next);
    }

    function runAction() {
        if (open === 'historial') {
            window.location.href = '/tienda/historial_compras#purchaseHistoryLicenciasSection';
            return;
        } else if (open === 'gestionar-productos' && typeof showGestionarProductosModal === 'function') {
            showGestionarProductosModal();
        } else if (open === 'saldo-clientes' && typeof showSaldoClientesModal === 'function') {
            void showSaldoClientesModal();
        } else if (open === 'renovar-dia') {
            const renewBtn = document.getElementById('btnEjecutarRenovacionDia');
            if (renewBtn && typeof adminLicenseRunDayRenewalManual === 'function') {
                void adminLicenseRunDayRenewalManual(renewBtn);
            }
        }
        stripOpenParam();
    }

    if (open === 'historial' || open === 'gestionar-productos' || open === 'saldo-clientes' || open === 'renovar-dia') {
        window.setTimeout(runAction, 600);
    }
}

/** Cuentas con status disponible cargadas en el admin (coincide con el conteo BD del servidor). */
function licenseAvailableCountFromAccountsUi(license) {
    if (!license || !Array.isArray(license.accounts)) return 0;
    return license.accounts.filter(function (a) {
        return String(a && a.status != null ? a.status : '').toLowerCase() === 'available';
    }).length;
}

/** Tooltip: misma idea que `_sellable_license_accounts_public` / tienda (~ existencias públicas). */
function licensePublicSellablePreviewTitle(license) {
    const avail = licenseAvailableCountFromAccountsUi(license);
    const gar = licenseWarrantyDaysUi(license);
    const sell = Math.max(0, avail - gar);
    return (
        'Existencias públicas (~' +
        sell +
        '): en BD hay ' +
        avail +
        ' cuenta(s) con estado disponible; se resta la gar. (' +
        gar +
        '). Las líneas del bloc Licencias no suman inventario hasta que existan cuentas disponibles en BD.'
    );
}

function licensePublicSellableBadgeHtml(license) {
    const avail = licenseAvailableCountFromAccountsUi(license);
    const gar = licenseWarrantyDaysUi(license);
    const sell = Math.max(0, avail - gar);
    const title = escapeHtml(licensePublicSellablePreviewTitle(license));
    const aria = escapeHtml('Tienda muestra unas ' + sell + ' existencias (~disponibles menos gar.).');
    const zeroCls = sell === 0 ? ' gestion-productos-tienda-prev--zero' : '';
    return (
        '<span class="gestion-productos-tienda-prev' +
        zeroCls +
        '" title="' +
        title +
        '" tabindex="0" role="note" aria-label="' +
        aria +
        '">tienda&nbsp;~' +
        sell +
        '</span>'
    );
}

/** Reserva garantía «gar.» (# cuentas no vendibles) para UI; por defecto 5 si no hay valor. */
function licenseWarrantyDaysUi(license) {
    if (!license) return 5;
    const v = license.warranty_days;
    const n = v != null && v !== '' ? Number(v) : 5;
    return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Checkbox «mes a mes» en Gestionar productos; el backend puede enviar month_to_month más adelante. */
function licenseMonthToMonthUiChecked(license) {
    if (!license || license.month_to_month == null) return false;
    const v = license.month_to_month;
    if (v === true || v === 1) return true;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes';
    }
    return false;
}

// Mostrar modal de gestionar productos
function showGestionarProductosModal() {
    // Filtrar solo licencias activas y excluir la pseudo-licencia "Todos"
    const activeLicenses = licenses.filter(license => {
        if (license.isAggregate || license.id === 0 || license.product_name === 'Todos') return false;
        return window.IS_ARCHIVED_MODE ? true : license.enabled;
    });
    
    if (activeLicenses.length === 0) {
        showError(window.IS_ARCHIVED_MODE ? 'No hay productos archivados para gestionar' : 'No hay productos para gestionar');
        return;
    }
    
    // Ordenar por posición
    const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
    
    const title = window.IS_ARCHIVED_MODE ? 'Gestionar Productos Archivados' : 'Gestionar Productos';
    const actionBtn = window.IS_ARCHIVED_MODE 
        ? `<button type="button" class="gestion-productos-btn" data-action="restore-product-from-modal" data-license-id="\${license.id}" title="Desarchivar producto">
               <i class="fas fa-undo"></i> Restaurar
           </button>`
        : `<button type="button" class="gestion-productos-btn-archive" data-action="archive-product-from-modal" data-license-id="\${license.id}" title="Archivar producto">
               <i class="fas fa-archive"></i>
           </button>`;
    
    // Crear HTML del modal
    const modalHtml = `
        <div class="modal-overlay" id="gestionarProductosModal">
            <div class="gestion-productos-modal-inner" role="dialog" aria-modal="true" aria-labelledby="gestionProductosTitulo">
                <div class="gestion-productos-modal-content">
                    <div class="gestion-productos-modal-header">
                        <h3 id="gestionProductosTitulo"><i class="fas fa-list"></i> ${title}</h3>
                        <button type="button" class="gestion-productos-modal-close" aria-label="Cerrar">&times;</button>
                    </div>
                    <div class="gestion-productos-list" id="productosList">
                        ${sortedLicenses.map((license) => `
                            <div class="producto-item gestion-productos-item" data-license-id="${license.id}">
                                <div class="gestion-productos-item-name">
                                    <strong>${license.product_name}</strong>
                                </div>
                                <div class="gestion-productos-item-actions">
                                    <label class="gestion-productos-mes-a-mes" title="Renovación mes a mes: si lo activas, se oculta el bloc Vencidas en la cuadrícula. Lo que ya guardaste en Vencidas no se borra; al desmarcar, vuelve a verse. Solo se elimina si tú borras el contenido en ese bloc.">
                                        <span class="gestion-productos-mes-icon" aria-hidden="true"><i class="fas fa-calendar-alt"></i></span>
                                        <input type="checkbox" class="gestion-productos-mes-checkbox" data-license-id="${license.id}" aria-label="Mes a mes: oculta Vencidas sin borrar lo guardado; desmarcar lo vuelve a mostrar" ${licenseMonthToMonthUiChecked(license) ? 'checked' : ''} />
                                    </label>
                                    <button type="button" class="gestion-productos-btn" data-action="change-product-position" data-license-id="${license.id}" title="Cambiar posición">
                                        Pos. <span class="gestion-productos-position-span">${license.position}</span>
                                    </button>
                                    <button type="button" class="gestion-productos-btn" data-action="change-product-warranty" data-license-id="${license.id}" title="Cambiar reserva de garantía (gar.: cuentas no vendibles)">
                                        gar. <span class="gestion-productos-position-span">${licenseWarrantyDaysUi(license)}</span>
                                    </button>
                                    ${licensePublicSellableBadgeHtml(license)}
                                    ${actionBtn.replace(/\$\{license\.id\}/g, license.id)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Insertar modal en el DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const modalOverlay = document.getElementById('gestionarProductosModal');
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) {
            closeGestionarProductosModal();
        }
    });
    const btnClose = modalOverlay.querySelector('.gestion-productos-modal-close');
    if (btnClose) {
        btnClose.addEventListener('click', function (e) {
            e.stopPropagation();
            closeGestionarProductosModal();
        });
    }

    const productosList = document.getElementById('productosList');
    if (productosList) {
        productosList.addEventListener('change', function (e) {
            const t = e.target;
            if (!t || !t.classList || !t.classList.contains('gestion-productos-mes-checkbox')) return;
            const id = parseInt(t.getAttribute('data-license-id'), 10);
            if (!Number.isFinite(id)) return;
            const checked = !!t.checked;
            fetch('/tienda/api/licenses/' + id + '/notes', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
                },
                body: JSON.stringify({ month_to_month: checked })
            })
                .then(function (r) {
                    return r.json();
                })
                .then(function (data) {
                    if (!data.success) {
                        t.checked = !checked;
                        showError(data && data.error ? String(data.error) : 'No se pudo guardar mes a mes.');
                        return;
                    }
                    const L = licenses.find(function (l) {
                        return l.id === id;
                    });
                    if (L) L.month_to_month = checked;
                    const inputContainer = document.getElementById('licenseAccountsInputContainer');
                    const activeRaw =
                        inputContainer && inputContainer.dataset.activeLicenseId != null
                            ? inputContainer.dataset.activeLicenseId
                            : '';
                    const active = parseInt(activeRaw, 10);
                    if (Number.isFinite(active) && active === id) {
                        refreshExpiredNotepadWrapVisibilityForLicense(id);
                        refreshChangesNotepadWrapVisibilityForLicense(id);
                    }
                })
                .catch(function () {
                    t.checked = !checked;
                    showError('No se pudo guardar mes a mes.');
                });
        });
    }
}

// Cerrar modal de gestionar productos
function closeGestionarProductosModal() {
    const modal = document.getElementById('gestionarProductosModal');
    if (modal) {
        modal.remove();
    }
}

window.__saldoClientesListCache = window.__saldoClientesListCache || [];

function closeSaldoClientesModal() {
    const modal = document.getElementById('saldoClientesModal');
    if (modal) {
        modal.remove();
    }
    if (typeof window.__saldoClientesKeydownHandler === 'function') {
        document.removeEventListener('keydown', window.__saldoClientesKeydownHandler);
        window.__saldoClientesKeydownHandler = null;
    }
}

function closeSaldoClientesInfoTip() {
    const infoTip = document.getElementById('saldoClientesInfoTip');
    const btnInfo = document.getElementById('btnSaldoClientesInfo');
    const modalContent = document.querySelector('#saldoClientesModal .gestion-productos-modal-content');
    if (!infoTip || !btnInfo) return;
    infoTip.classList.add('hidden');
    btnInfo.setAttribute('aria-expanded', 'false');
    if (modalContent) modalContent.classList.remove('saldo-clientes-info-open');
}

function toggleSaldoClientesInfoTip() {
    const infoTip = document.getElementById('saldoClientesInfoTip');
    const btnInfo = document.getElementById('btnSaldoClientesInfo');
    const modalContent = document.querySelector('#saldoClientesModal .gestion-productos-modal-content');
    if (!infoTip || !btnInfo) return;
    const willOpen = infoTip.classList.contains('hidden');
    if (willOpen) {
        infoTip.classList.remove('hidden');
        btnInfo.setAttribute('aria-expanded', 'true');
        if (modalContent) modalContent.classList.add('saldo-clientes-info-open');
    } else {
        closeSaldoClientesInfoTip();
    }
}

function adminSaldoClientesFormatStoreBalance(client) {
    if (!client) return '—';
    const tp = client.tipo_precio ? String(client.tipo_precio).toLowerCase() : '';
    if (tp === 'usd') {
        return Math.floor(Number(client.saldo_usd) || 0) + ' USD';
    }
    if (tp === 'cop') {
        return Math.floor(Number(client.saldo_cop) || 0) + ' COP';
    }
    return '—';
}

function adminSaldoClientesFindCachedClient(userId) {
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return null;
    const source = Array.isArray(window.__saldoClientesListCache)
        ? window.__saldoClientesListCache
        : [];
    return (
        source.find(function (r) {
            return r && Number(r.id) === uid;
        }) || null
    );
}

async function adminSaldoClientesReloadFromApi() {
    try {
        const resp = await fetch('/tienda/api/admin/store-clients-license-saldo');
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success || !Array.isArray(data.clients)) {
            return false;
        }
        window.__saldoClientesListCache = data.clients;
        adminSaldoClientesRenderFilteredList();
        return true;
    } catch (_e) {
        return false;
    }
}

function adminSaldoClientesPromptPositiveAmount(title) {
    const raw =
        typeof window.prompt === 'function' ? window.prompt(title, '') : null;
    if (raw === null || raw === undefined) return null;
    const t = String(raw).trim().replace(',', '.');
    if (!t) return null;
    const x = Number(t);
    if (!Number.isFinite(x) || x <= 0) {
        showError('Indica un importe numérico mayor que cero.');
        return null;
    }
    return x;
}

async function adminSaldoClientesAdjust(userId, delta) {
    const client = adminSaldoClientesFindCachedClient(userId);
    if (!client) {
        showError('No se encontró el cliente en el listado.');
        return;
    }
    const tp = client.tipo_precio ? String(client.tipo_precio).toLowerCase() : '';
    if (tp !== 'usd' && tp !== 'cop') {
        showError(
            'Este usuario no tiene moneda activa (USD/COP). Configúrala en Gestión de permisos.'
        );
        return;
    }
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) return;
    const subtract = delta < 0;
    const amt = Math.abs(delta);
    const body = {
        username: client.username,
        subtract: subtract,
        amount_usd: tp === 'usd' ? amt : 0,
        amount_cop: tp === 'cop' ? amt : 0
    };
    try {
        const resp = await fetch('/tienda/admin/pagos/add_balance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': typeof getCSRFToken === 'function' ? getCSRFToken() : ''
            },
            body: JSON.stringify(body)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
            showError((data && data.error) ? String(data.error) : 'No se pudo actualizar el saldo.');
            return;
        }
        await adminSaldoClientesReloadFromApi();
    } catch (_e) {
        showError('Error de red al actualizar saldo.');
    }
}

function adminSaldoClientesRenderFilteredList() {
    const listEl = document.getElementById('saldoClientesList');
    if (!listEl) return;
    const filterInp = document.getElementById('saldoClientesFilter');
    const term = filterInp
        ? String(filterInp.value != null ? filterInp.value : '')
              .trim()
              .toLowerCase()
        : '';
    const source = Array.isArray(window.__saldoClientesListCache)
        ? window.__saldoClientesListCache
        : [];
    const rows = term
        ? source.filter(function (r) {
              return (
                  r &&
                  String(r.username != null ? r.username : '')
                      .toLowerCase()
                      .indexOf(term) !== -1
              );
          })
        : source.slice();
    rows.sort(function (a, b) {
        const ua = String(a.username || '').toLowerCase();
        const ub = String(b.username || '').toLowerCase();
        return ua.localeCompare(ub);
    });

    if (rows.length === 0) {
        var emptyMsg =
            source.length === 0 && !term
                ? 'No hay cuentas cliente (usuarios principales) en el listado.'
                : 'No hay clientes que coincidan con el filtro.';
        listEl.innerHTML =
            '<p class="gestion-productos-list-empty saldo-clientes-empty" role="status">' +
            escapeHtml(emptyMsg) +
            '</p>';
        return;
    }

    listEl.innerHTML = rows
        .map(function (client) {
            const uid = client.id;
            const un = escapeHtml(client.username || '');
            const salLabel = adminSaldoClientesFormatStoreBalance(client);
            const tp = client.tipo_precio ? String(client.tipo_precio).toLowerCase() : '';
            const hasSaldo = tp === 'usd' || tp === 'cop';
            const actionBtns = hasSaldo
                ? '<button type="button" class="saldo-clientes-icon-btn saldo-clientes-icon-btn--add" data-action="saldo-add" data-user-id="' +
                  escapeHtml(uid) +
                  '" title="Añadir saldo">' +
                  '<i class="fas fa-plus" aria-hidden="true"></i>' +
                  '<span class="sr-only">Añadir saldo</span>' +
                  '</button>' +
                  '<button type="button" class="saldo-clientes-icon-btn saldo-clientes-icon-btn--sub" data-action="saldo-sub" data-user-id="' +
                  escapeHtml(uid) +
                  '" title="Descontar saldo">' +
                  '<i class="fas fa-minus" aria-hidden="true"></i>' +
                  '<span class="sr-only">Descontar saldo</span>' +
                  '</button>'
                : '';
            return (
                '<div class="gestion-productos-item saldo-clientes-row" data-user-id="' +
                escapeHtml(uid) +
                '">' +
                '<div class="saldo-clientes-col saldo-clientes-col--user">' +
                '<strong title="' +
                un +
                '">' +
                un +
                '</strong>' +
                '</div>' +
                '<div class="saldo-clientes-col saldo-clientes-col--saldo">' +
                '<span class="saldo-clientes-saldo js-saldo-clientes-num" title="Saldo prepago (mismo que Gestión de permisos)">' +
                escapeHtml(salLabel) +
                '</span>' +
                '</div>' +
                '<div class="saldo-clientes-col saldo-clientes-col--actions saldo-clientes-actions">' +
                actionBtns +
                '</div>' +
                '</div>'
            );
        })
        .join('');
}

async function showSaldoClientesModal() {
    closeSaldoClientesModal();
    const overlayHtml =
        '<div class="modal-overlay" id="saldoClientesModal">' +
        '<div class="gestion-productos-modal-inner" role="dialog" aria-modal="true" aria-labelledby="saldoClientesTitulo">' +
        '<div class="gestion-productos-modal-content">' +
        '<div class="gestion-productos-modal-header saldo-clientes-modal-header">' +
        '<button type="button" class="gestion-productos-modal-close" aria-label="Cerrar">&times;</button>' +
        '<div class="saldo-clientes-title-row">' +
        '<h3 id="saldoClientesTitulo"><i class="fas fa-balance-scale-right" aria-hidden="true"></i> Saldo clientes</h3>' +
        '<span class="saldo-clientes-info-wrap">' +
        '<button type="button" class="saldo-clientes-info-btn" id="btnSaldoClientesInfo" aria-label="Información sobre el saldo de clientes" aria-expanded="false" aria-controls="saldoClientesInfoTip">' +
        '<i class="fas fa-info-circle" aria-hidden="true"></i>' +
        '</button>' +
        '</span>' +
        '</div>' +
        '<div id="saldoClientesInfoTip" class="saldo-clientes-info-tip hidden" role="tooltip">' +
        '<p class="saldo-clientes-info-tip__lead">Mismo saldo que en <strong>Gestión de permisos</strong> (prepago tienda en USD o COP según el tipo de precio del cliente).</p>' +
        '<ul class="saldo-clientes-info-tip__list">' +
        '<li><strong>+ Sumar</strong> — acredita saldo al cliente.</li>' +
        '<li><strong>− Restar</strong> — descuenta saldo prepago.</li>' +
        '<li>Si el usuario no tiene USD/COP configurado, edítalo primero en Gestión de permisos.</li>' +
        '</ul>' +
        '</div>' +
        '</div>' +
        '<div class="saldo-clientes-toolbar">' +
        '<label for="saldoClientesFilter" class="sr-only">Filtrar por cliente</label>' +
        '<input type="search" id="saldoClientesFilter" class="form-control" placeholder="Filtrar por usuario…" autocomplete="off">' +
        '</div>' +
        '<div class="saldo-clientes-list-wrap">' +
        '<div class="saldo-clientes-list-head" aria-hidden="true">' +
        '<span>Usuario</span>' +
        '<span class="saldo-clientes-list-head__saldo">Saldo</span>' +
        '<span class="saldo-clientes-list-head__actions">Acciones</span>' +
        '</div>' +
        '<div class="gestion-productos-list" id="saldoClientesList">' +
        '<p class="gestion-productos-list-empty" role="status">Cargando…</p>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';

    document.body.insertAdjacentHTML('beforeend', overlayHtml);
    const modalOverlay = document.getElementById('saldoClientesModal');
    if (!modalOverlay) return;

    modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) {
            closeSaldoClientesModal();
            return;
        }
        const infoTip = document.getElementById('saldoClientesInfoTip');
        if (
            infoTip &&
            !infoTip.classList.contains('hidden') &&
            !e.target.closest('.saldo-clientes-info-wrap') &&
            !e.target.closest('#saldoClientesInfoTip')
        ) {
            closeSaldoClientesInfoTip();
        }
    });
    const btnInfo = document.getElementById('btnSaldoClientesInfo');
    if (btnInfo) {
        btnInfo.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleSaldoClientesInfoTip();
        });
    }
    window.__saldoClientesKeydownHandler = function (e) {
        if (e.key !== 'Escape' || !document.getElementById('saldoClientesModal')) return;
        const infoTip = document.getElementById('saldoClientesInfoTip');
        if (infoTip && !infoTip.classList.contains('hidden')) {
            closeSaldoClientesInfoTip();
            e.preventDefault();
            return;
        }
        closeSaldoClientesModal();
    };
    document.addEventListener('keydown', window.__saldoClientesKeydownHandler);
    const btnClose = modalOverlay.querySelector('.gestion-productos-modal-close');
    if (btnClose) {
        btnClose.addEventListener('click', function (e) {
            e.stopPropagation();
            closeSaldoClientesModal();
        });
    }

    const filterEl = document.getElementById('saldoClientesFilter');
    if (filterEl) {
        filterEl.addEventListener('input', function () {
            adminSaldoClientesRenderFilteredList();
        });
    }

    const listWrap = document.getElementById('saldoClientesList');
    if (listWrap) {
        listWrap.addEventListener('click', function (e) {
            const btn =
                e.target && e.target.closest
                    ? e.target.closest('[data-action="saldo-add"], [data-action="saldo-sub"]')
                    : null;
            if (!btn || !modalOverlay.contains(btn)) return;
            e.preventDefault();
            const uidRaw = btn.getAttribute('data-user-id');
            const uid = uidRaw != null ? parseInt(uidRaw, 10) : NaN;
            const act = btn.getAttribute('data-action');
            if (!Number.isFinite(uid)) return;
            if (act === 'saldo-add') {
                const amt = adminSaldoClientesPromptPositiveAmount('Importe a AÑADIR al saldo:');
                if (amt == null) return;
                void adminSaldoClientesAdjust(uid, amt);
            } else if (act === 'saldo-sub') {
                const amt = adminSaldoClientesPromptPositiveAmount('Importe a DESCONTAR del saldo:');
                if (amt == null) return;
                void adminSaldoClientesAdjust(uid, -amt);
            }
        });
    }

    window.__saldoClientesListCache = [];
    try {
        const resp = await fetch('/tienda/api/admin/store-clients-license-saldo');
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success || !Array.isArray(data.clients)) {
            showError((data && data.error) ? String(data.error) : 'No se pudo cargar el listado.');
            closeSaldoClientesModal();
            return;
        }
        window.__saldoClientesListCache = data.clients;
        adminSaldoClientesRenderFilteredList();
        if (filterEl) {
            try {
                filterEl.focus({ preventScroll: true });
            } catch (_) {
                try {
                    filterEl.focus();
                } catch (_2) {}
            }
        }
    } catch (_e3) {
        showError('Error de red al cargar saldos.');
        closeSaldoClientesModal();
    }
}

/** Modal en plantilla Archivados: lista servicios archivados y restaurarlos en Licencias. Mismo estilo que Gestionar productos. */
async function showRestaurarArchivadosModal() {
    if (!window.IS_ARCHIVED_MODE) return;
    try {
        await loadLicenses({ skipGridRender: true });
    } catch (e) {
        console.warn('No se pudo refrescar licencias antes del modal de archivados:', e);
    }

    const archivedLicenses = licenses
        .filter(function (license) {
            return (
                license &&
                !license.isAggregate &&
                license.id &&
                license.enabled === false
            );
        })
        .sort(function (a, b) {
            return (a.position || 0) - (b.position || 0);
        });

    closeRestaurarArchivadosModal();

    const listInner =
        archivedLicenses.length === 0
            ? '<p class="gestion-productos-list-empty" id="restaurarArchivadosVacio">No hay productos archivados.</p>'
            : archivedLicenses
                  .map(function (license) {
                      const name = escapeHtml(license.product_name || 'Producto');
                      return `
                            <div class="producto-item gestion-productos-item" data-license-id="${license.id}">
                                <div class="gestion-productos-item-name">
                                    <strong>${name}</strong>
                                </div>
                                <div class="gestion-productos-item-actions">
                                    <span class="gestion-productos-position-readonly" title="Posición guardada">Pos. <span class="gestion-productos-position-span">${license.position}</span></span>
                                    <span class="gestion-productos-position-readonly" title="Reserva garantía (# cuentas no vendibles)">gar. <span class="gestion-productos-position-span">${licenseWarrantyDaysUi(license)}</span></span>
                                    <button type="button" class="gestion-productos-btn" data-action="restore-product-from-modal" data-license-id="${license.id}" title="Volver a poner en Licencias">
                                        <i class="fas fa-undo"></i> Restaurar
                                    </button>
                                </div>
                            </div>`;
                  })
                  .join('');

    const modalHtml = `
        <div class="modal-overlay" id="restaurarArchivadosModal">
            <div class="gestion-productos-modal-inner" role="dialog" aria-modal="true" aria-labelledby="restaurarArchivadosTitulo">
                <div class="gestion-productos-modal-content">
                    <div class="gestion-productos-modal-header">
                        <h3 id="restaurarArchivadosTitulo"><i class="fas fa-folder-open" aria-hidden="true"></i> Restaurar a Licencias</h3>
                        <button type="button" class="gestion-productos-modal-close" aria-label="Cerrar">&times;</button>
                    </div>
                    <div class="gestion-productos-list" id="restaurarArchivadosList">
                        ${listInner}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalOverlay = document.getElementById('restaurarArchivadosModal');
    if (!modalOverlay) return;
    modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) {
            closeRestaurarArchivadosModal();
        }
    });
    const btnClose = modalOverlay.querySelector('.gestion-productos-modal-close');
    if (btnClose) {
        btnClose.addEventListener('click', function (e) {
            e.stopPropagation();
            closeRestaurarArchivadosModal();
        });
    }
}

function closeRestaurarArchivadosModal() {
    const modal = document.getElementById('restaurarArchivadosModal');
    if (modal) modal.remove();
}

// Cambiar posición de producto desde el modal
async function changeProductPosition(licenseId) {
    const newPosition = prompt('Ingresa la nueva posición (número):');
    if (!newPosition || isNaN(parseInt(newPosition))) {
        return;
    }
    
    const position = parseInt(newPosition);
    const license = licenses.find(l => l.id === licenseId);
    
    if (!license) {
        showError('Producto no encontrado');
        return;
    }
    
    const currentPosition = license.position;
    
    // Obtener todas las licencias activas ordenadas por posición
    const activeLicenses = window.IS_ARCHIVED_MODE ? licenses : licenses.filter(l => l.enabled);
    const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
    
    // Calcular las nuevas posiciones para todos los productos
    const updates = [];
    
    for (let i = 0; i < sortedLicenses.length; i++) {
        const lic = sortedLicenses[i];
        let newPos;
        
        if (lic.id === licenseId) {
            // El producto que movemos
            newPos = position;
        } else if (currentPosition < position) {
            // Moviendo hacia abajo
            if (lic.position > currentPosition && lic.position <= position) {
                newPos = lic.position - 1;
            } else {
                newPos = lic.position;
            }
        } else {
            // Moviendo hacia arriba
            if (lic.position >= position && lic.position < currentPosition) {
                newPos = lic.position + 1;
            } else {
                newPos = lic.position;
            }
        }
        
        if (newPos !== lic.position) {
            updates.push({ id: lic.id, position: newPos });
        }
    }
    
    try {
        // Actualizar todas las posiciones
        for (const update of updates) {
            const response = await fetch(`/tienda/api/licenses/${update.id}/position`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({ position: update.position })
            });
            
            if (!response.ok) {
                throw new Error(`Error al actualizar posición ${update.position}`);
            }
        }
        
        showSuccess('Posiciones reorganizadas correctamente');
        await loadLicenses();
        closeGestionarProductosModal();
        showGestionarProductosModal();
    } catch (error) {
        console.error('Error:', error);
        showError('Error al reorganizar posiciones');
    }
}

// Cambiar reserva gar. (cuentas no vendibles) desde el modal Gestionar productos
async function changeProductWarranty(licenseId) {
    const license = licenses.find(l => l.id === licenseId);
    if (!license) {
        showError('Producto no encontrado');
        return;
    }
    const current = licenseWarrantyDaysUi(license);
    const raw = prompt('Número de cuentas en reserva garantía (gar., no vendibles):', String(current));
    if (raw === null || String(raw).trim() === '') {
        return;
    }
    const n = parseInt(String(raw).trim(), 10);
    if (Number.isNaN(n) || n < 0 || n > 3650) {
        showError('Introduce un número entre 0 y 3650 (cuentas).');
        return;
    }
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/warranty`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({ warranty_days: n })
        });
        const data = await response.json().catch(function () {
            return {};
        });
        if (response.ok && data.success) {
            license.warranty_days = n;
            showSuccess('Reserva gar. actualizada');
            await loadLicenses();
            closeGestionarProductosModal();
            showGestionarProductosModal();
        } else {
            showError(data.error || 'Error al guardar la garantía');
        }
    } catch (err) {
        console.error(err);
        showError('Error de conexión al guardar la garantía');
    }
}

// Archivar producto desde el modal
async function archiveProductFromModal(licenseId) {
    if (!confirm('¿Estás seguro de que quieres archivar este producto?')) {
        return;
    }
    
    const license = licenses.find(l => l.id === licenseId);
    
    if (!license) {
        showError('Producto no encontrado');
        return;
    }
    
    try {
        // Archivar el producto
        const response = await fetch(`/tienda/api/licenses/${licenseId}/archive`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                // Recargar licencias para obtener las actualizadas
                await loadLicenses();
                
                // Reorganizar posiciones de productos activos restantes
                const activeLicenses = window.IS_ARCHIVED_MODE ? licenses : licenses.filter(l => l.enabled);
                const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
                
                // Reorganizar posiciones: 1, 2, 3, 4, etc.
                const updates = [];
                for (let i = 0; i < sortedLicenses.length; i++) {
                    const newPos = i + 1;
                    if (sortedLicenses[i].position !== newPos) {
                        updates.push({ id: sortedLicenses[i].id, position: newPos });
                    }
                }
                
                // Actualizar todas las posiciones
                for (const update of updates) {
                    const updateResponse = await fetch(`/tienda/api/licenses/${update.id}/position`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({ position: update.position })
                    });
                    
                    if (!updateResponse.ok) {
                        console.error(`Error al actualizar posición ${update.position}`);
                    }
                }
                
                showSuccess('Producto archivado y posiciones reorganizadas correctamente');
                await loadLicenses();
                closeGestionarProductosModal();
                showGestionarProductosModal();
            } else {
                showError('Error al archivar el producto');
            }
        } else {
            showError('Error del servidor al archivar el producto');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al archivar el producto');
    }
}

// Restaurar producto desde el modal (solo en Archivados)
async function restoreProductFromModal(licenseId) {
    if (!confirm('¿Estás seguro de que quieres restaurar este producto?')) {
        return;
    }
    
    const license = licenses.find(l => l.id === licenseId);
    
    if (!license) {
        showError('Producto no encontrado');
        return;
    }
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/restore`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                // Recargar licencias para obtener las actualizadas
                await loadLicenses();
                
                // Reorganizar posiciones de productos archivados restantes
                const activeLicenses = window.IS_ARCHIVED_MODE ? licenses : licenses.filter(l => l.enabled);
                const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
                
                // Reorganizar posiciones: 1, 2, 3, 4, etc.
                const updates = [];
                for (let i = 0; i < sortedLicenses.length; i++) {
                    const newPos = i + 1;
                    if (sortedLicenses[i].position !== newPos) {
                        updates.push({ id: sortedLicenses[i].id, position: newPos });
                    }
                }
                
                // Actualizar todas las posiciones
                for (const update of updates) {
                    const updateResponse = await fetch(`/tienda/api/licenses/${update.id}/position`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({ position: update.position })
                    });
                    
                    if (!updateResponse.ok) {
                        console.error(`Error al actualizar posición ${update.position}`);
                    }
                }
                
                showSuccess('Producto restaurado y posiciones reorganizadas correctamente');
                await loadLicenses();
                if (document.getElementById('restaurarArchivadosModal')) {
                    closeRestaurarArchivadosModal();
                    void showRestaurarArchivadosModal();
                } else if (document.getElementById('gestionarProductosModal')) {
                    closeGestionarProductosModal();
                    showGestionarProductosModal();
                }
            } else {
                showError('Error al restaurar el producto');
            }
        } else {
            showError('Error del servidor al restaurar el producto');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al restaurar el producto');
    }
}

// ============================================================================
// EVENT LISTENERS DELEGADOS PARA CSP COMPLIANCE
// ============================================================================

// Event listener delegado para todos los data-actions (CSP compliant)
document.addEventListener('click', function(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.getAttribute('data-action');
    
    switch(action) {
        case 'show-archived-license-menu':
            const archivedLicenseId = parseInt(target.getAttribute('data-license-id'));
            showArchivedLicenseMenu(archivedLicenseId);
            break;
            
        case 'edit-account':
            const editAccountId = parseInt(target.getAttribute('data-account-id'));
            editAccount(editAccountId);
            break;
            
        case 'assign-account':
            const assignAccountId = parseInt(target.getAttribute('data-account-id'));
            assignAccount(assignAccountId);
            break;
            
        case 'remove-account':
            const removeAccountId = parseInt(target.getAttribute('data-account-id'));
            removeAccount(removeAccountId);
            break;
            
        case 'restore-license':
            const restoreLicenseId = parseInt(target.getAttribute('data-license-id'));
            restoreLicense(restoreLicenseId);
            break;
            
        case 'change-license-position':
            const changePosLicenseId = parseInt(target.getAttribute('data-license-id'));
            changeLicensePosition(changePosLicenseId);
            break;
            
        case 'archive-license':
            const archiveLicenseId = parseInt(target.getAttribute('data-license-id'));
            archiveLicense(archiveLicenseId);
            break;
            
        case 'change-product-position':
            const changeProductPosId = parseInt(target.getAttribute('data-license-id'));
            changeProductPosition(changeProductPosId);
            break;

        case 'change-product-warranty':
            const changeWarrantyId = parseInt(target.getAttribute('data-license-id'));
            void changeProductWarranty(changeWarrantyId);
            break;
            
        case 'archive-product-from-modal':
            const archiveProductId = parseInt(target.getAttribute('data-license-id'));
            archiveProductFromModal(archiveProductId);
            break;
            
        case 'restore-product-from-modal':
            const restoreProductId = parseInt(target.getAttribute('data-license-id'));
            restoreProductFromModal(restoreProductId);
            break;
            
        case 'close-position-modal':
            closePositionModal();
            break;
            
        case 'close-add-account-modal':
            closeAddAccountModal();
            break;
    }
});

// --- AdminLicenciasUndoCore (antes admin_licencias_undo.js): deshacer/rehacer en blocs y días ---
(function () {
    var DEBOUNCE_MS = 350;
    var MAX_HISTORY = 80;

    function getPlainText(el) {
        if (!el) return '';
        return el.tagName === 'TEXTAREA' ? el.value : el.innerText || '';
    }

    function setPlainText(el, text, runHighlight) {
        if (!el) return;
        var s = text != null ? text : '';
        if (el.tagName === 'TEXTAREA') {
            el.value = s;
        } else {
            el.textContent = s;
            if (runHighlight && typeof window.highlightEmailsAndPasswords === 'function') {
                window.highlightEmailsAndPasswords(el);
            }
        }
    }

    function attach(el, opts) {
        opts = opts || {};
        var listenEl = opts.listenElement != null ? opts.listenElement : el;

        function getText() {
            if (typeof opts.getPlainText === 'function') {
                return opts.getPlainText();
            }
            return getPlainText(el);
        }

        function applyText(text, runHighlight) {
            if (typeof opts.setPlainText === 'function') {
                opts.setPlainText(text, runHighlight);
                return;
            }
            setPlainText(el, text, runHighlight);
        }

        var history = [];
        var cursor = 0;
        var debounceTimer = null;

        function updateButtons() {
            if (opts.undoBtn) opts.undoBtn.disabled = cursor <= 0;
            if (opts.redoBtn) opts.redoBtn.disabled = cursor >= history.length - 1;
        }

        function recordNow() {
            var t = getText();
            if (history.length && history[cursor] === t) return;
            history = history.slice(0, cursor + 1);
            history.push(t);
            cursor = history.length - 1;
            while (history.length > MAX_HISTORY) {
                history.shift();
                cursor--;
            }
            updateButtons();
        }

        function reset() {
            var t = getText();
            history = [t];
            cursor = 0;
            updateButtons();
        }

        function undo() {
            if (cursor <= 0) return;
            cursor--;
            applyText(history[cursor], true);
            if (typeof opts.afterVisual === 'function') opts.afterVisual();
            opts.onPersist();
            updateButtons();
        }

        function redo() {
            if (cursor >= history.length - 1) return;
            cursor++;
            applyText(history[cursor], true);
            if (typeof opts.afterVisual === 'function') opts.afterVisual();
            opts.onPersist();
            updateButtons();
        }

        function onInputDebounced() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                if (!listenEl.isConnected) return;
                recordNow();
            }, DEBOUNCE_MS);
        }

        function onBlur() {
            clearTimeout(debounceTimer);
            if (!listenEl.isConnected) return;
            recordNow();
        }

        function onKeydown(e) {
            var mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) redo();
                else undo();
                return;
            }
            if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                e.stopPropagation();
                redo();
            }
        }

        var onFocusOutDelegate = null;
        listenEl.addEventListener('input', onInputDebounced, true);
        if (opts.useFocusOutDelegate) {
            onFocusOutDelegate = function () {
                window.setTimeout(function () {
                    if (listenEl.contains(document.activeElement)) return;
                    onBlur();
                }, 0);
            };
            listenEl.addEventListener('focusout', onFocusOutDelegate, true);
        } else {
            el.addEventListener('blur', onBlur);
        }
        listenEl.addEventListener('keydown', onKeydown, true);

        if (opts.undoBtn) {
            opts.undoBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                undo();
            });
        }
        if (opts.redoBtn) {
            opts.redoBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                redo();
            });
        }

        reset();

        return {
            reset: reset,
            destroy: function () {
                clearTimeout(debounceTimer);
                listenEl.removeEventListener('input', onInputDebounced, true);
                if (onFocusOutDelegate) {
                    listenEl.removeEventListener('focusout', onFocusOutDelegate, true);
                } else {
                    el.removeEventListener('blur', onBlur);
                }
                listenEl.removeEventListener('keydown', onKeydown, true);
            }
        };
    }

    window.AdminLicenciasUndoCore = {
        attach: attach
    };
})();

(function () {
    if (window.__adminLicenseShowLimitDelegated) return;
    window.__adminLicenseShowLimitDelegated = true;
    document.addEventListener(
        'change',
        function (e) {
            var t = e.target;
            if (!t || t.id !== 'adminLicenciasLicenseShowSelect') return;
            if (typeof adminLicenseShowLimitApply === 'function') {
                adminLicenseShowLimitApply();
            }
        },
        false
    );
})();

(function () {
    if (window.__adminLicenseHideNotesColDelegated) return;
    window.__adminLicenseHideNotesColDelegated = true;
    document.addEventListener(
        'click',
        function (e) {
            var tNotes =
                e.target && e.target.closest ? e.target.closest('#adminLicenciasToggleNotesColBtn') : null;
            var tDaysAll =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleAllDaysSectionsBtn')
                    : null;
            var tChangesAll =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleAllChangesSectionsBtn')
                    : null;
            var tChangesStatus =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleChangesStatusColBtn')
                    : null;
            var tChangesNotes =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleChangesNotesColBtn')
                    : null;
            var tChangesRestore =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleChangesRestoreColBtn')
                    : null;
            var tDaysRestore =
                e.target && e.target.closest ? e.target.closest('#adminLicenciasToggleDaysRestoreColBtn') : null;
            var tDaysStatus =
                e.target && e.target.closest ? e.target.closest('#adminLicenciasToggleDaysStatusColBtn') : null;
            var tDaysNotes =
                e.target && e.target.closest ? e.target.closest('#adminLicenciasToggleDaysNotesColBtn') : null;
            var tSuspRestore =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleSuspendedRestoreColBtn')
                    : null;
            var tSuspNotes =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleSuspendedNotesColBtn')
                    : null;
            var tExpRestore =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleExpiredRestoreColBtn')
                    : null;
            var tExpNotes =
                e.target && e.target.closest
                    ? e.target.closest('#adminLicenciasToggleExpiredNotesColBtn')
                    : null;
            var tStatus =
                e.target && e.target.closest ? e.target.closest('#adminLicenciasToggleStatusColBtn') : null;
            if (tNotes) {
                e.preventDefault();
                if (typeof adminLicenseHideNotesColToggle === 'function') {
                    adminLicenseHideNotesColToggle();
                }
                return;
            }
            if (tDaysAll) {
                e.preventDefault();
                if (typeof adminDaysToggleAllDaySections === 'function') {
                    adminDaysToggleAllDaySections();
                }
                return;
            }
            if (tChangesAll) {
                e.preventDefault();
                if (typeof adminChangesToggleAllProductSections === 'function') {
                    adminChangesToggleAllProductSections();
                }
                return;
            }
            if (tChangesStatus) {
                e.preventDefault();
                if (typeof adminChangesHideStatusColToggle === 'function') {
                    adminChangesHideStatusColToggle();
                }
                return;
            }
            if (tChangesNotes) {
                e.preventDefault();
                if (typeof adminChangesHideNotesColToggle === 'function') {
                    adminChangesHideNotesColToggle();
                }
                return;
            }
            if (tChangesRestore) {
                e.preventDefault();
                if (typeof adminChangesHideRestoreColToggle === 'function') {
                    adminChangesHideRestoreColToggle();
                }
                return;
            }
            if (tDaysRestore) {
                e.preventDefault();
                if (typeof adminDaysHideRestoreColToggle === 'function') {
                    adminDaysHideRestoreColToggle();
                }
                return;
            }
            if (tDaysStatus) {
                e.preventDefault();
                if (typeof adminDaysHideStatusColToggle === 'function') {
                    adminDaysHideStatusColToggle();
                }
                return;
            }
            if (tDaysNotes) {
                e.preventDefault();
                if (typeof adminDaysHideNotesColToggle === 'function') {
                    adminDaysHideNotesColToggle();
                }
                return;
            }
            if (tSuspRestore) {
                e.preventDefault();
                if (typeof adminSuspendedHideRestoreColToggle === 'function') {
                    adminSuspendedHideRestoreColToggle();
                }
                return;
            }
            if (tSuspNotes) {
                e.preventDefault();
                if (typeof adminSuspendedHideNotesColToggle === 'function') {
                    adminSuspendedHideNotesColToggle();
                }
                return;
            }
            if (tExpRestore) {
                e.preventDefault();
                if (typeof adminExpiredHideRestoreColToggle === 'function') {
                    adminExpiredHideRestoreColToggle();
                }
                return;
            }
            if (tExpNotes) {
                e.preventDefault();
                if (typeof adminExpiredHideNotesColToggle === 'function') {
                    adminExpiredHideNotesColToggle();
                }
                return;
            }
            if (tStatus) {
                e.preventDefault();
                if (typeof adminLicenseHideStatusColToggle === 'function') {
                    adminLicenseHideStatusColToggle();
                }
            }
        },
        false
    );
})();
