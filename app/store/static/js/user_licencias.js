/**
 * Licencias usuario — grid por producto («Todos» + productos), barra Historial junto al menú,
 * días hasta vencimiento y flechas al bloque del día (como en admin).
 */
(function () {
    'use strict';

    var SAVE_DEBOUNCE_MS = 600;

    /** Actualización casi en tiempo real vía SSE (`portal_rev`); fallback a sondeo ligero. */
    var USER_LIC_PORTAL_POLL_MS = 2500;
    /** Vista Caducidad: solo cuentas con vencimiento en 5 días o menos (incluye «vence hoy» = 0). */
    var USER_LIC_CADUCIDAD_VIEW_MAX_DAYS = 5;
    var userLicPortalLastRev = null;
    var userLicPortalAccountsCache = [];
    /** Reloj Colombia del servidor (día 1–31 del mes) para caducidad por día de calendario. */
    var userLicPortalColombiaClock = null;
    var userLicPortalVencimientosActive = false;
    var userLicPortalPollTimer = null;
    var userLicPortalSseHandle = null;
    var userLicPortalPollContext = null;
    var userLicPortalStaticWired = false;
    var userLicPortalCollapseBootstrapped = false;
    var userLicPortalDeferredRev = null;
    var userLicPortalRowAutosaveFlush = null;
    var userLicPortalRowAutosaveHasPending = null;
    /* PUTs de fila en vuelo: mientras haya alguno, no aplicar re-render por portal_rev
       (evita que un refresh SSE pise la edición cuyo guardado aún no confirmó el servidor). */
    var userLicPortalRowSavesInFlight = 0;

    function userLicPortalRowSaveFinished() {
        userLicPortalRowSavesInFlight = Math.max(0, userLicPortalRowSavesInFlight - 1);
        if (!userLicPortalRowSavesInFlight) {
            window.setTimeout(function () {
                try {
                    userLicPortalTryCatchUpRevRefresh();
                } catch (e) {
                    /* noop */
                }
            }, 350);
        }
    }
    var userLicCaducidadNotifyTimer = null;
    var userLicCaducidadNotifyBarWired = false;
    var userLicCaducidadNotifyPrefsMem = {
        enabled: false,
        fromDays: 5,
        email: true,
        push: true,
        inapp: true,
        vibrate: false,
        sound: false,
    };
    var userLicNotifyPrefsSaveTimer = null;
    var userLicRenewalBalanceWarningsCache = [];
    var USER_LIC_PORTAL_PROVEEDOR_FILTER = 'proveedor';
    var USER_LIC_PORTAL_REPORTES_FILTER = 'reportes';
    var USER_LIC_PORTAL_VERIFICAR_FILTER = 'verificar';
    var userLicPortalProveedorEnabled = false;
    /* Permiso soporte_licencias: habilita el bloc compartido Verificar/Arreglar. */
    var userLicPortalSoporteLicenciasEnabled = false;
    var userLicPortalProveedorCache = {
        license_notes: '',
        day_notepads: {},
        license_lines: [],
        day_lines: {},
        expired_lines: [],
        suspended_lines: [],
        services_catalog: [{ id: 'anonimo', name: 'Anónimo' }],
    };
    var PROVEEDOR_SERVICE_ANONIMO = 'anonimo';
    var userLicPortalProveedorSaveTimer = null;
    var userLicPortalProveedorEditorWired = false;
    var userLicPortalProveedorDirty = false;
    var userLicPortalProveedorSaveInFlight = false;

    function userLicPortalMarkProveedorDirty() {
        userLicPortalProveedorDirty = true;
    }

    function userLicPortalClearProveedorDirty() {
        userLicPortalProveedorDirty = false;
    }

    function userLicPortalIsProveedorDirty() {
        return userLicPortalProveedorDirty || userLicPortalProveedorSaveInFlight;
    }
    var USER_LIC_CADUCIDAD_NOTIFY_CHECK_MS = 30 * 60 * 1000;
    var USER_LIC_CADUCIDAD_NOTIFY_MAX_LEAD = 5;
    var USER_LIC_CADUCIDAD_INAPP_ALERT_MS = 9000;
    var USER_LIC_CADUCIDAD_INAPP_ALERT_MAX = 4;

    function escHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function escAttr(s) {
        return escHtml(s).replace(/"/g, '&quot;');
    }

    function escTextarea(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    function userLicGetCsrfToken() {
        var meta = document.querySelector('meta[name="csrf_token"]');
        if (meta && meta.getAttribute('content')) {
            return meta.getAttribute('content');
        }
        var match = document.cookie ? document.cookie.match(/(?:^|;\s*)_csrf=([^;]+)/) : null;
        return match ? decodeURIComponent(match[1]) : '';
    }

    function userLicJsonHeaders(extra) {
        var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        var csrf = userLicGetCsrfToken();
        if (csrf) headers['X-CSRFToken'] = csrf;
        if (extra && typeof extra === 'object') {
            Object.keys(extra).forEach(function (k) {
                headers[k] = extra[k];
            });
        }
        return headers;
    }

    function userLicPortalIsViewOnly(rootEl) {
        var el =
            rootEl ||
            document.getElementById('userLicenciasTableOuter') ||
            document.querySelector('[data-licencias-view-only]');
        if (!el) return false;
        return String(el.getAttribute('data-licencias-view-only') || '') === '1';
    }

    function userLicPortalApplyViewOnlyUi(rootEl) {
        if (!rootEl || !userLicPortalIsViewOnly(rootEl)) return;
        rootEl.classList.add('user-licencias-view-only');
        rootEl.querySelectorAll('select, textarea, input:not([type="search"]):not([type="checkbox"])').forEach(
            function (node) {
                if (!node || node.disabled) return;
                if (node.closest('.user-lic-caducidad-notify-bar')) return;
                if (node.id === 'userLicenciasSearch' || node.id === 'userLicReportesSearch') return;
                node.disabled = true;
                node.setAttribute('aria-disabled', 'true');
                if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
                    node.setAttribute('readonly', 'readonly');
                }
            }
        );
    }

    /** Al copiar licencias: una línea por credencial, sin huecos por filas vacías del editor. */
    function normalizeLicenseClipboardText(raw) {
        return String(raw || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(function (line) {
                return line.replace(/\s+$/g, '');
            })
            .filter(function (line) {
                return line.length > 0;
            })
            .join('\n');
    }

    /** Slugs internos: una combinación única por cuenta/virtual (textarea, scope DOM). No usar para la grilla visible. */
    function licenseFilterKey(acc) {
        if (acc.account_id != null && acc.account_id !== '') {
            return 'a' + String(acc.account_id);
        }
        if (acc.virtual === true || acc.is_virtual === true) {
            return 'v' + String(acc.license_id != null ? acc.license_id : '0');
        }
        var lid = acc.license_id;
        if (lid != null && lid !== '') return String(lid);
        return 'u0';
    }

    /** Una tarjeta en la grilla = un servicio (`p{product_id}`); varias cuentas mismo producto comparten filtro/data-license-id. */
    function userLicPortalGridFilterKey(acc) {
        var pid = acc.product_id;
        if (pid != null && pid !== '') {
            var n = Number(pid);
            if (!Number.isNaN(n) && n > 0) {
                return 'p' + String(Math.trunc(n));
            }
        }
        return licenseFilterKey(acc);
    }

    function normalizePortalServiceFilterKey(filterRaw) {
        if (filterRaw === USER_LIC_PORTAL_PROVEEDOR_FILTER) return USER_LIC_PORTAL_PROVEEDOR_FILTER;
        if (filterRaw === USER_LIC_PORTAL_REPORTES_FILTER) return USER_LIC_PORTAL_REPORTES_FILTER;
        if (filterRaw === USER_LIC_PORTAL_VERIFICAR_FILTER) return USER_LIC_PORTAL_VERIFICAR_FILTER;
        if (filterRaw === 'all' || filterRaw == null || filterRaw === 'vencimientos') return 'all';
        return String(filterRaw);
    }

    function filterAccountsByServiceFilter(accounts, filterKey) {
        var fk = normalizePortalServiceFilterKey(filterKey);
        if (fk === 'all') return accounts;
        var out = [];
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            if (userLicPortalGridFilterKey(accounts[i]) === fk) out.push(accounts[i]);
        }
        return out;
    }

    function syncServiceFilterGridCards(gridHost, serviceFilter, clearAllOnly) {
        if (!gridHost) return;
        gridHost.querySelectorAll('.user-lic-license-card-btn').forEach(function (el) {
            el.classList.remove('active');
        });
        if (clearAllOnly) return;
        var fk = normalizePortalServiceFilterKey(serviceFilter);
        if (fk === 'all') {
            var t = gridHost.querySelector('.user-lic-license-card--todos');
            if (t) t.classList.add('active');
        } else if (fk === USER_LIC_PORTAL_PROVEEDOR_FILTER) {
            var provCard = gridHost.querySelector('.user-lic-license-card--proveedor');
            if (provCard) provCard.classList.add('active');
        } else if (fk === USER_LIC_PORTAL_REPORTES_FILTER) {
            var repCard = gridHost.querySelector('.user-lic-license-card--reportes');
            if (repCard) repCard.classList.add('active');
        } else if (fk === USER_LIC_PORTAL_VERIFICAR_FILTER) {
            var verCard = gridHost.querySelector('.user-lic-license-card--verificar');
            if (verCard) verCard.classList.add('active');
        } else {
            var b = gridCardByFilterKey(gridHost, fk);
            if (b) b.classList.add('active');
        }
        /* Mantener amarillo/verde del botón Verificar/Arreglar con cualquier filtro. */
        try {
            userLicVerificarSyncCardState();
        } catch (_eVaActMark) {}
    }

    function setCaducidadToolbarActive(active) {
        var btn = document.getElementById('btnUserLicVencimientos');
        if (!btn) return;
        btn.classList.toggle('user-lic-vencimientos-btn--active', !!active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function exitCaducidadViewMode() {
        if (!userLicPortalVencimientosActive) return;
        userLicPortalVencimientosActive = false;
        setCaducidadToolbarActive(false);
        userLicCaducidadNotifySyncBarVisibility();
    }

    function accountPreferredScrollDay(acc) {
        var ld = acc.linked_sale_day;
        if (ld != null && ld !== '' && !Number.isNaN(Number(ld))) {
            var n = Number(ld);
            if (n >= 1 && n <= 31) return n;
        }
        var dl = acc.day_lines || {};
        var d;
        for (d = 1; d <= 31; d += 1) {
            var rows = dl[String(d)];
            if (rows && rows.length) return d;
        }
        return 1;
    }

    function normalizeStatusKey(s) {
        try {
            return String(s || '')
                .trim()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/\s+/g, ' ');
        } catch (e0) {
            return String(s || '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ');
        }
    }

    /** Mismos valores permitidos que admin / user_license_line_parse.validate_portal_user_status_values */
    var OPT_LICENSE_GOOD = [
        { v: '', label: '—' },
        { v: 'renovar 1 mes mas', label: 'Renovar 1 mes más' },
        { v: 'dejar mes a mes', label: 'Dejar mes a mes' },
        { v: 'no renovar', label: 'No renovar' },
    ];

    var OPT_LICENSE_BAD = [
        { v: '', label: '—' },
        { v: 'caida o suspendida', label: 'Caída o suspendida' },
        { v: 'no reproduce', label: 'No reproduce' },
        { v: 'error de contraseña', label: 'Error de contraseña' },
        { v: 'repetida', label: 'Repetida' },
        { v: 'otro', label: 'Otro' },
        /* Solo badge cuando soporte marcó solucionada (no se ofrece al cliente). */
        { v: 'solucionada', label: 'Solucionada', hidden: true },
        /* Oculto: solo se muestra el badge cuando no hay stock de garantía. */
        { v: 'pendiente garantia', label: 'Garantía', hidden: true },
    ];

    var USER_LICENSE_DAY_BAD_ACTION_NUEVA_CONTRASENA = '__user_nueva_contrasena__';

    function userLicIsBadSelectActionValue(v) {
        var k = String(v || '').trim();
        return k === USER_LICENSE_DAY_BAD_ACTION_NUEVA_CONTRASENA;
    }

    function userLicAppendBadSelectActionOptions(selBad) {
        if (!selBad) return;
        var opt = selBad.querySelector('option[value="' + USER_LICENSE_DAY_BAD_ACTION_NUEVA_CONTRASENA + '"]');
        if (opt) return;
        var o = document.createElement('option');
        o.value = USER_LICENSE_DAY_BAD_ACTION_NUEVA_CONTRASENA;
        o.textContent = 'Nueva contraseña';
        o.className = 'user-lic-day-bad-action-option';
        selBad.appendChild(o);
    }

    function userLicEnsureBadSelectActions(row) {
        if (!row) return;
        var selBad = row.querySelector('select.license-split-editor__status-bad');
        if (selBad) userLicAppendBadSelectActionOptions(selBad);
    }

    function userLicGetRowStorageLine(row) {
        var root = row.closest('.day-license-split-root');
        var ta = root && root.querySelector('textarea.user-lic-creds-ro');
        if (!ta) return '';
        var li = Number(row.getAttribute('data-lic-creds-line-index'));
        if (!Number.isFinite(li) || li < 0) li = 0;
        var lines = String(ta.value || '').split(/\r?\n/);
        return lines[li] !== undefined ? String(lines[li]) : '';
    }

    function userLicGetRowCredPlain(row) {
        var line = userLicGetRowStorageLine(row);
        var sepIdx = line.indexOf('\x1f');
        return sepIdx >= 0 ? line.slice(0, sepIdx).trim() : line.trim();
    }

    function userLicCredentialPlainHasPasswordPart(credPlain) {
        var line = String(credPlain || '').trim();
        if (!line) return false;
        var emailMatch = line.match(/\S+@\S+\.\S+/);
        if (!emailMatch) return false;
        var emailOnly = emailMatch[0].trim().toLowerCase();
        var credNorm = line.replace(/\s+/g, ' ').trim().toLowerCase();
        if (credNorm === emailOnly) return false;
        if (/\(\d+\)\s+\S+/.test(line)) return true;
        var emailIdx = line.toLowerCase().indexOf(emailOnly);
        if (emailIdx < 0) return true;
        return line.slice(emailIdx + emailMatch[0].length).trim().length > 0;
    }

    function userLicUpdateRowStorageCred(row, newCredPlain) {
        var root = row.closest('.day-license-split-root');
        var ta = root && root.querySelector('textarea.user-lic-creds-ro');
        if (!ta) return;
        var li = Number(row.getAttribute('data-lic-creds-line-index'));
        if (!Number.isFinite(li) || li < 0) li = 0;
        var lines = String(ta.value || '').split(/\r?\n/);
        var oldLine = lines[li] !== undefined ? String(lines[li]) : '';
        var sepIdx = oldLine.indexOf('\x1f');
        lines[li] = sepIdx >= 0 ? newCredPlain + oldLine.slice(sepIdx) : newCredPlain;
        ta.value = lines.join('\n');
        userLicSyncDayBundleCredsStripes(root);
    }

    function userLicPromptAndApplyNewPassword(row) {
        if (!row || window.__userLicDayPasswordInFlight) return;
        if (userLicPortalIsViewOnly(row.closest('#userLicenciasTableOuter'))) {
            window.alert(
                'Tu cuenta solo puede visualizar licencias. No puedes cambiar contraseñas.'
            );
            return;
        }
        var cred = userLicGetRowCredPlain(row);
        if (!userLicCredentialPlainHasPasswordPart(cred)) {
            window.alert('Esta fila solo tiene correo en el bloc; no se puede cambiar la contraseña aquí.');
            return;
        }
        var pwd = window.prompt('Nueva contraseña:', '');
        if (pwd == null) return;
        var trimmed = String(pwd).trim();
        if (!trimmed) {
            window.alert('Indica la nueva contraseña.');
            return;
        }

        var lid = Number(row.getAttribute('data-lic-row-license-id'));
        var dayNum = Number(row.getAttribute('data-lic-row-day'));
        var ordinal = Number(row.getAttribute('data-lic-row-ordinal'));
        var aidRaw = row.getAttribute('data-lic-row-account-id');
        var virt = row.getAttribute('data-lic-row-virtual') === '1';
        if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(dayNum) || !Number.isFinite(ordinal)) {
            return;
        }

        var patchUrl =
            (row.closest('[data-day-status-url]') &&
                row.closest('[data-day-status-url]').getAttribute('data-day-status-url')) ||
            '/tienda/api/user/license-day-row-status';

        window.__userLicDayPasswordInFlight = true;
        row.classList.remove('user-lic-save-err');

        fetch(patchUrl, {
            method: 'PUT',
            headers: userLicJsonHeaders(),
            credentials: 'same-origin',
            body: JSON.stringify({
                license_id: lid,
                calendar_day: dayNum,
                row_ordinal: ordinal,
                account_id:
                    aidRaw != null && String(aidRaw).trim() !== '' ? Number(String(aidRaw).trim()) : null,
                virtual: virt,
                new_password: trimmed,
            }),
        })
            .then(function (r) {
                return r
                    .text()
                    .then(function (txt) {
                        var data = {};
                        try {
                            data = txt ? JSON.parse(txt) : {};
                        } catch (eJ) {
                            data = {};
                        }
                        return { ok: r.ok, data: data };
                    })
                    .catch(function () {
                        return { ok: false, data: {} };
                    });
            })
            .then(function (res) {
                if (res.ok && res.data && res.data.success && res.data.new_cred) {
                    userLicUpdateRowStorageCred(row, String(res.data.new_cred));
                    row.style.outline = '1px solid rgba(74, 222, 128, 0.55)';
                    window.setTimeout(function () {
                        row.style.outline = '';
                    }, 1200);
                } else {
                    var errMsg =
                        (res.data && res.data.error) ||
                        'No se pudo actualizar la contraseña. Intenta de nuevo.';
                    window.alert(errMsg);
                    row.classList.add('user-lic-save-err');
                    row.style.outline = '2px solid rgba(248, 113, 113, 0.92)';
                    window.setTimeout(function () {
                        row.style.outline = '';
                    }, 2400);
                }
            })
            .catch(function () {
                row.classList.add('user-lic-save-err');
                row.style.outline = '2px solid rgba(248, 113, 113, 0.92)';
                window.alert('Error de conexión al actualizar la contraseña.');
            })
            .finally(function () {
                window.__userLicDayPasswordInFlight = false;
            });
    }

    function userLicPortalMonthToMonthChecked(lm) {
        if (!lm) return false;
        var v = lm.month_to_month;
        if (v === true || v === 1) return true;
        if (typeof v === 'string') {
            var s = String(v).trim().toLowerCase();
            return s === '1' || s === 'true' || s === 'yes';
        }
        return false;
    }

    /** Columna verde (renovación): solo si el producto tiene «mes a mes» activo en admin. */
    function userLicPortalShouldShowGoodCol(lm) {
        return userLicPortalMonthToMonthChecked(lm);
    }

    function userLicPortalGoodOptionsForLicense(lm) {
        if (userLicPortalShouldShowGoodCol(lm)) return OPT_LICENSE_GOOD;
        return OPT_LICENSE_GOOD.filter(function (opt) {
            var k = normalizeStatusKey(opt.v);
            return (
                k !== normalizeStatusKey('renovar 1 mes mas') &&
                k !== normalizeStatusKey('dejar mes a mes') &&
                k !== normalizeStatusKey('no renovar')
            );
        });
    }

    /** Texto junto a «Día N» en el modal de credencial, según el estado verde de la fila. */
    function userLicPortalGoodHintForModal(rawSg) {
        var k = normalizeStatusKey(rawSg != null ? String(rawSg).trim() : '');
        if (!k) return '';
        if (k === normalizeStatusKey('renovar 1 mes mas')) return 'Mensual renovable';
        if (k === normalizeStatusKey('dejar mes a mes')) return 'Dejar mes a mes';
        if (k === normalizeStatusKey('no renovar')) return 'No renovar';
        if (k === normalizeStatusKey('ok')) return 'Buena';
        if (k === normalizeStatusKey('garantia')) return 'Garantía';
        return String(rawSg || '').trim();
    }

    function userLicCanonicalPortalGood(raw) {
        var s = raw != null ? String(raw).trim() : '';
        if (!s) return '';
        var k = normalizeStatusKey(s);
        if (!k) return '';
        var matches = [];
        var i;
        for (i = 0; i < OPT_LICENSE_GOOD.length; i += 1) {
            var ov = OPT_LICENSE_GOOD[i].v != null ? String(OPT_LICENSE_GOOD[i].v) : '';
            if (!ov) continue;
            if (normalizeStatusKey(ov) === k) return ov;
            if (normalizeStatusKey(ov).indexOf(k) === 0) matches.push(ov);
        }
        return matches.length === 1 ? matches[0] : '';
    }

    function statusOptionsInnerHtml(optionDefs, currentValue) {
        var cur = currentValue != null ? String(currentValue).trim() : '';
        var curKey = normalizeStatusKey(cur);
        var chunks = '';
        optionDefs.forEach(function (opt) {
            var ov = opt.v != null ? String(opt.v) : '';
            var nk = normalizeStatusKey(ov);
            var sel = false;
            if (opt.hidden === true) {
                /* Campo oculto (p. ej. pendiente garantía): solo si ya es el valor actual. */
                if (!(cur !== '' && (ov === cur || (nk === curKey && nk !== '')))) {
                    return;
                }
            }
            if (cur === '' && ov === '') {
                sel = true;
            } else if (cur !== '') {
                if (ov === cur || (nk === curKey && nk !== '')) {
                    sel = true;
                }
            }
            chunks +=
                '<option value="' +
                escAttr(ov) +
                '"' +
                (sel ? ' selected' : '') +
                '>' +
                escHtml(opt.label) +
                '</option>';
        });
        var matched = false;
        if (cur) {
            for (var oi = 0; oi < optionDefs.length; oi += 1) {
                var xv = optionDefs[oi].v != null ? String(optionDefs[oi].v) : '';
                if (xv === cur || normalizeStatusKey(xv) === curKey) {
                    matched = true;
                    break;
                }
            }
        }
        if (cur !== '' && !matched && curKey !== '') {
            chunks +=
                '<option value="' +
                escAttr(cur) +
                '" selected>' +
                escHtml(cur) +
                '</option>';
        }
        return chunks;
    }

    function syncOtroShell(row) {
        var wb = row.querySelector('.license-split-editor__status-bad');
        var ot = row.querySelector('.license-split-editor__otro-combined');
        var shell = row.querySelector('.license-split-editor__status-wrap');
        if (!wb || !ot || !shell) return;
        var otOn = normalizeStatusKey(wb.value || '') === 'otro';
        shell.classList.toggle('license-split-editor__status-wrap--otro', otOn);
        ot.hidden = !otOn;
        ot.style.display = otOn ? 'block' : 'none';
    }

    function applyDualTierUi(row) {
        var sg = row.querySelector('select.license-split-editor__status-good');
        var sb = row.querySelector('select.license-split-editor__status-bad');
        if (sg) {
            sg.classList.remove(
                'license-split-editor__status--tier-good',
                'license-split-editor__status--tier-neutral'
            );
            sg.classList.add(
                String(sg.value || '').trim()
                    ? 'license-split-editor__status--tier-good'
                    : 'license-split-editor__status--tier-neutral'
            );
        }
        if (sb) {
            sb.classList.remove(
                'license-split-editor__status--tier-bad',
                'license-split-editor__status--tier-neutral'
            );
            sb.classList.add(
                String(sb.value || '').trim()
                    ? 'license-split-editor__status--tier-bad'
                    : 'license-split-editor__status--tier-neutral'
            );
        }
    }

    function userLicBuenaRevisadaBadgeHtml(prevGoodRestore, prevBadRestore) {
        /* Badge Buena: clic → vuelve a — (neutro), mismo flujo que Entregada. */
        return (
            '<span class="user-lic-buena-revisada-badge user-lic-buena-revisada-badge--clickable license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-good" data-user-lic-buena-badge="1" data-user-lic-prev-good="' +
            escAttr(prevGoodRestore || '') +
            '" data-user-lic-prev-bad="' +
            escAttr(prevBadRestore || '') +
            '" role="button" tabindex="0" title="Clic para volver a — (neutro).">' +
            '<i class="fas fa-check-circle" aria-hidden="true"></i> Buena</span>'
        );
    }

    function userLicGarantiaEntregadaBadgeHtml(prevGoodRestore, prevBadRestore) {
        return (
            '<span class="user-lic-garantia-entregada-badge user-lic-garantia-entregada-badge--clickable license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-good" data-user-lic-entregada-badge="1" data-user-lic-prev-good="' +
            escAttr(prevGoodRestore || '') +
            '" data-user-lic-prev-bad="' +
            escAttr(prevBadRestore || '') +
            '" role="button" tabindex="0" title="Garantía entregada. Clic para volver a — (neutro).">' +
            '<i class="fas fa-shield-alt" aria-hidden="true"></i> Entregada</span>'
        );
    }

    function userLicSolucionadaBadgeHtml() {
        return (
            '<span class="user-lic-solucionada-badge user-lic-solucionada-badge--portal user-lic-solucionada-badge--clickable license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-good" data-user-lic-solucionada-badge="1" role="button" tabindex="0" title="Solucionada. Clic para volver a — (neutro).">' +
            '<i class="fas fa-check" aria-hidden="true"></i> Solucionada</span>'
        );
    }

    function userLicFinishRevertSolucionada(row) {
        if (!row) return;
        var badShell = row.querySelector('.license-split-editor__status-select-shell--bad');
        var badge = badShell && badShell.querySelector('.user-lic-solucionada-badge');
        if (badge && badShell) {
            var bid =
                row.getAttribute('data-user-lic-bad-select-id') ||
                'user-lic-sb-' + Date.now();
            var sbSel = document.createElement('select');
            sbSel.id = bid;
            sbSel.name = bid;
            sbSel.className =
                'license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-neutral';
            sbSel.setAttribute('autocomplete', 'off');
            sbSel.setAttribute('aria-label', 'Reportar problema o incidencia');
            sbSel.innerHTML = statusOptionsInnerHtml(OPT_LICENSE_BAD, '');
            userLicAppendBadSelectActionOptions(sbSel);
            badge.replaceWith(sbSel);
        }
        row.removeAttribute('data-user-lic-solucionada');
        syncOtroShell(row);
        applyDualTierUi(row);
        userLicSyncRowSignalClasses(row);
        var splitRoot = row.closest('.day-license-split-root');
        if (splitRoot) userLicSyncDayBundleCredsStripes(splitRoot);
    }

    function userLicFinishRevertBuenaRevisada(row, sgRestored, sbRestored) {
        if (!row) return;
        var badShell = row.querySelector('.license-split-editor__status-select-shell--bad');
        var badge =
            badShell &&
            badShell.querySelector(
                '.user-lic-buena-revisada-badge, .user-lic-garantia-entregada-badge'
            );
        var goodSel = row.querySelector('select.license-split-editor__status-good');
        if (badge && badShell) {
            var bid =
                row.getAttribute('data-user-lic-bad-select-id') ||
                (goodSel && goodSel.id ? goodSel.id.replace(/^user-lic-sg-/, 'user-lic-sb-') : '') ||
                'user-lic-sb-' + Date.now();
            var sbSel = document.createElement('select');
            sbSel.id = bid;
            sbSel.name = bid;
            sbSel.className =
                'license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-neutral';
            sbSel.setAttribute('autocomplete', 'off');
            sbSel.setAttribute('aria-label', 'Reportar problema o incidencia');
            sbSel.innerHTML = statusOptionsInnerHtml(OPT_LICENSE_BAD, sbRestored || '');
            userLicAppendBadSelectActionOptions(sbSel);
            badge.replaceWith(sbSel);
        }
        if (goodSel) {
            goodSel.disabled = false;
            goodSel.removeAttribute('aria-disabled');
            goodSel.classList.remove('user-lic-status-good--buena-locked');
            goodSel.innerHTML = statusOptionsInnerHtml(OPT_LICENSE_GOOD, sgRestored || '');
        }
        row.removeAttribute('data-user-lic-buena-revisada');
        row.removeAttribute('data-user-lic-warranty-entregada');
        if (sgRestored) {
            row.setAttribute('data-user-lic-saved-good', sgRestored);
        }
        syncOtroShell(row);
        applyDualTierUi(row);
        userLicSyncRowSignalClasses(row);
        var splitRoot = row.closest('.day-license-split-root');
        if (splitRoot) userLicSyncDayBundleCredsStripes(splitRoot);
    }

    function initEditableLicenseRowsIn(container) {
        if (!container) return;
        userLicEnsureFormFieldIdName(container);
        container.querySelectorAll('.user-lic-license-row-edit').forEach(function (row) {
            syncOtroShell(row);
            applyDualTierUi(row);
            userLicEnsureBadSelectActions(row);
        });
        container.querySelectorAll('.day-section.user-lic-readonly-day').forEach(function (section) {
            userLicSyncDayBundleLineSignals(section);
        });
    }

    function wireLicenseStatusAutosave(rootEl) {
        if (userLicPortalIsViewOnly(rootEl)) {
            userLicPortalApplyViewOnlyUi(rootEl);
            return;
        }
        var patchUrl =
            rootEl.getAttribute('data-day-status-url') || '/tienda/api/user/license-day-row-status';
        var timers = Object.create(null);

        function persistRow(row, persistOpts) {
            var sk = row.getAttribute('data-user-lic-save-key');
            if (!sk) return;
            if (timers[sk]) {
                window.clearTimeout(timers[sk]);
                delete timers[sk];
            }
            var opts =
                persistOpts && typeof persistOpts === 'object'
                    ? persistOpts
                    : { statusGoodOverride: persistOpts };
            var revertBuenaRevisada = opts.revertBuenaRevisada === true;
            var revertSolucionada = opts.revertSolucionada === true;
            var lid = Number(row.getAttribute('data-lic-row-license-id'));
            var dayNum = Number(row.getAttribute('data-lic-row-day'));
            var ordinal = Number(row.getAttribute('data-lic-row-ordinal'));
            var aidRaw = row.getAttribute('data-lic-row-account-id');
            var virt = row.getAttribute('data-lic-row-virtual') === '1';
            var sgEl = row.querySelector('select.license-split-editor__status-good');
            var sbEl = row.querySelector('select.license-split-editor__status-bad');
            var otEl = row.querySelector('.license-split-editor__otro-combined');
            var isBuenaRow = row.getAttribute('data-user-lic-buena-revisada') === '1';
            var isSolucionadaRow = row.getAttribute('data-user-lic-solucionada') === '1';
            if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(dayNum) || !Number.isFinite(ordinal)) {
                return;
            }
            if (revertBuenaRevisada) {
                if (
                    !row.querySelector(
                        '.user-lic-buena-revisada-badge, .user-lic-garantia-entregada-badge'
                    )
                )
                    return;
            } else if (revertSolucionada) {
                if (!row.querySelector('.user-lic-solucionada-badge')) return;
            } else if (!isBuenaRow && !isSolucionadaRow && !sbEl) {
                return;
            }
            var statusGoodVal = '';
            if (revertBuenaRevisada) {
                statusGoodVal =
                    opts.statusGoodOverride != null ? String(opts.statusGoodOverride).trim() : '';
            } else if (opts.statusGoodOverride !== undefined && opts.statusGoodOverride !== null) {
                statusGoodVal = String(opts.statusGoodOverride).trim();
            } else if (sgEl && sgEl.tagName === 'SELECT') {
                statusGoodVal = String(sgEl.value != null ? sgEl.value : '').trim();
            }
            if (
                !revertBuenaRevisada &&
                !isBuenaRow &&
                !statusGoodVal &&
                row.getAttribute('data-user-lic-saved-good')
            ) {
                statusGoodVal = String(row.getAttribute('data-user-lic-saved-good') || '').trim();
            }
            var statusBadVal = sbEl && sbEl.value != null ? String(sbEl.value).trim() : '';
            var otroDetailVal = otEl ? String(otEl.value || '').trim() : '';
            var noteClientEl = row.querySelector('.user-lic-note-client');
            var noteClientVal = noteClientEl ? String(noteClientEl.value != null ? noteClientEl.value : '') : '';

            row.classList.remove('user-lic-save-err');

            var payload = {
                license_id: lid,
                calendar_day: dayNum,
                row_ordinal: ordinal,
                account_id:
                    aidRaw != null && String(aidRaw).trim() !== '' ? Number(String(aidRaw).trim()) : null,
                virtual: virt,
                status_bad: statusBadVal,
                otro_detail: otroDetailVal,
                client_note: noteClientVal,
            };
            if (isBuenaRow && !revertBuenaRevisada) {
                payload.preserve_buena_revisada = true;
            } else if (isSolucionadaRow && !revertSolucionada) {
                payload.preserve_solucionada = true;
                if (
                    statusGoodVal &&
                    normalizeStatusKey(statusGoodVal) !== normalizeStatusKey('ok')
                ) {
                    payload.status_good = statusGoodVal;
                }
            } else if (revertSolucionada) {
                payload.revert_solucionada = true;
                payload.status_bad = '';
                if (
                    statusGoodVal &&
                    normalizeStatusKey(statusGoodVal) !== normalizeStatusKey('ok')
                ) {
                    payload.status_good = statusGoodVal;
                }
            } else if (
                !revertBuenaRevisada &&
                statusGoodVal &&
                normalizeStatusKey(statusGoodVal) !== normalizeStatusKey('ok')
            ) {
                payload.status_good = statusGoodVal;
            } else if (revertBuenaRevisada) {
                payload.revert_buena_revisada = true;
                var canonRevertGood = userLicCanonicalPortalGood(statusGoodVal);
                if (canonRevertGood) payload.status_good = canonRevertGood;
                var prevBadAttr = row.getAttribute('data-user-lic-prev-bad') || '';
                var badgeEl = row.querySelector(
                    '.user-lic-buena-revisada-badge, .user-lic-garantia-entregada-badge'
                );
                if (!prevBadAttr && badgeEl) {
                    prevBadAttr = badgeEl.getAttribute('data-user-lic-prev-bad') || '';
                }
                if (prevBadAttr) payload.status_bad = prevBadAttr;
            } else if (row.getAttribute('data-user-lic-hide-good') === '1') {
                /* Sin columna verde (producto no mes a mes): no enviar renovación. */
            } else {
                payload.status_good = statusGoodVal;
            }

            userLicPortalRowSavesInFlight += 1;
            fetch(patchUrl, {
                method: 'PUT',
                headers: userLicJsonHeaders(),
                credentials: 'same-origin',
                body: JSON.stringify(payload),
            })
                .then(function (r) {
                    return r
                        .text()
                        .then(function (txt) {
                            var data = {};
                            try {
                                data = txt ? JSON.parse(txt) : {};
                            } catch (eJ) {
                                data = {};
                            }
                            return { ok: r.ok, data: data };
                        })
                        .catch(function () {
                            return { ok: false, data: {} };
                        });
                })
                .then(function (res) {
                    userLicPortalRowSaveFinished();
                    var badgePending = row.querySelector(
                        '.user-lic-buena-revisada-badge, .user-lic-garantia-entregada-badge'
                    );
                    if (badgePending) {
                        badgePending.disabled = false;
                        badgePending.classList.remove('user-lic-buena-revisada-badge--pending');
                    }
                    if (res.ok && res.data && res.data.success) {
                        if (revertBuenaRevisada) {
                            var sgRestored =
                                (res.data && res.data.green_select_value
                                    ? String(res.data.green_select_value).trim()
                                    : '') ||
                                (res.data && res.data.status_good != null
                                    ? String(res.data.status_good).trim()
                                    : '') ||
                                statusGoodVal ||
                                (row.getAttribute('data-user-lic-saved-good') || '').trim();
                            var sbRestored =
                                res.data && res.data.status_bad != null
                                    ? String(res.data.status_bad).trim()
                                    : '';
                            if (!sbRestored && badgePending) {
                                sbRestored =
                                    badgePending.getAttribute('data-user-lic-prev-bad') || '';
                            }
                            userLicFinishRevertBuenaRevisada(row, sgRestored, sbRestored);
                        } else if (revertSolucionada) {
                            userLicFinishRevertSolucionada(row);
                        } else {
                            var greenSaved =
                                res.data && res.data.green_select_value != null
                                    ? String(res.data.green_select_value).trim()
                                    : '';
                            if (!greenSaved && res.data && res.data.status_good != null) {
                                greenSaved = String(res.data.status_good).trim();
                            }
                            if (
                                greenSaved &&
                                normalizeStatusKey(greenSaved) !== normalizeStatusKey('ok')
                            ) {
                                row.setAttribute('data-user-lic-saved-good', greenSaved);
                            }
                        }
                        userLicSyncRowSignalClasses(row);
                        var daySec = row.closest('.day-section.user-lic-readonly-day');
                        if (daySec) {
                            userLicRefreshDayHeaderStatusBadgesFromSection(daySec);
                        } else {
                            var splitRoot = row.closest('.day-license-split-root');
                            if (splitRoot) userLicSyncDayBundleCredsStripes(splitRoot);
                        }
                        row.style.outline = '1px solid rgba(74, 222, 128, 0.55)';
                        window.setTimeout(function () {
                            row.style.outline = '';
                        }, 1200);
                        userLicRefreshReportesUi(rootEl);
                        userLicPortalTryCatchUpRevRefresh();
                    } else {
                        if (badgePending) {
                            badgePending.disabled = false;
                            badgePending.classList.remove('user-lic-buena-revisada-badge--pending');
                        }
                        row.style.outline = '2px solid rgba(248, 113, 113, 0.92)';
                        window.setTimeout(function () {
                            row.style.outline = '';
                        }, 2400);
                    }
                })
                .catch(function () {
                    userLicPortalRowSaveFinished();
                    var badgeErr = row.querySelector(
                        '.user-lic-buena-revisada-badge, .user-lic-garantia-entregada-badge'
                    );
                    if (badgeErr) {
                        badgeErr.disabled = false;
                        badgeErr.classList.remove('user-lic-buena-revisada-badge--pending');
                    }
                    row.classList.add('user-lic-save-err');
                    row.style.outline = '2px solid rgba(248, 113, 113, 0.92)';
                });
        }

        function schedulePersist(row) {
            var sk = row.getAttribute('data-user-lic-save-key');
            if (!sk || !patchUrl) return;
            if (timers[sk]) window.clearTimeout(timers[sk]);
            timers[sk] = window.setTimeout(function () {
                persistRow(row);
                delete timers[sk];
            }, SAVE_DEBOUNCE_MS);
        }

        function flushAllPendingRowSaves() {
            var keys = Object.keys(timers);
            var i;
            for (i = 0; i < keys.length; i += 1) {
                var sk = keys[i];
                window.clearTimeout(timers[sk]);
                delete timers[sk];
                var row = rootEl.querySelector('[data-user-lic-save-key="' + sk + '"]');
                if (row) persistRow(row);
            }
        }

        function hasPendingRowSaves() {
            return Object.keys(timers).length > 0;
        }

        userLicPortalRowAutosaveFlush = flushAllPendingRowSaves;
        userLicPortalRowAutosaveHasPending = hasPendingRowSaves;

        if (!window._userLicRowAutosavePageHook) {
            window._userLicRowAutosavePageHook = true;
            window.addEventListener('pagehide', function () {
                if (userLicPortalRowAutosaveFlush) userLicPortalRowAutosaveFlush();
            });
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'hidden' && userLicPortalRowAutosaveFlush) {
                    userLicPortalRowAutosaveFlush();
                }
            });
        }

        rootEl.addEventListener(
            'change',
            function (ev) {
                var row = ev.target.closest('.user-lic-license-row-edit');
                if (!row || !rootEl.contains(row)) return;
                if (
                    ev.target.classList.contains('license-split-editor__status-good') ||
                    ev.target.classList.contains('license-split-editor__status-bad')
                ) {
                    if (row.getAttribute('data-user-lic-renewal-pending') === '1') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                    }
                    if (ev.target.classList.contains('license-split-editor__status-bad')) {
                        var badActionVal = String(ev.target.value || '').trim();
                        if (userLicIsBadSelectActionValue(badActionVal)) {
                            ev.target.value = '';
                            if (badActionVal === USER_LICENSE_DAY_BAD_ACTION_NUEVA_CONTRASENA) {
                                userLicPromptAndApplyNewPassword(row);
                            }
                            return;
                        }
                        syncOtroShell(row);
                    }
                    applyDualTierUi(row);
                    userLicSyncRowSignalClasses(row);
                    var splitRootCh = row.closest('.day-license-split-root');
                    if (splitRootCh) userLicSyncDayBundleCredsStripes(splitRootCh);
                    var daySecCh = row.closest('.day-section.user-lic-readonly-day');
                    if (daySecCh) {
                        userLicRefreshDayHeaderStatusBadgesFromSection(daySecCh);
                    }
                    userLicRefreshReportesUi(rootEl);
                    schedulePersist(row);
                }
            },
            true
        );

        rootEl.addEventListener(
            'input',
            function (ev) {
                var row = ev.target.closest('.user-lic-license-row-edit');
                if (!row || !rootEl.contains(row)) return;
                if (ev.target.classList.contains('license-split-editor__otro-combined')) {
                    schedulePersist(row);
                    return;
                }
                if (ev.target.classList.contains('user-lic-note-client')) {
                    schedulePersist(row);
                }
            },
            true
        );

        rootEl.addEventListener(
            'click',
            function (ev) {
                var badgeSol = ev.target.closest('.user-lic-solucionada-badge--clickable');
                if (badgeSol && rootEl.contains(badgeSol)) {
                    var rowSol = badgeSol.closest('.user-lic-license-row-edit');
                    if (!rowSol) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    persistRow(rowSol, { revertSolucionada: true });
                    return;
                }
                var badge = ev.target.closest(
                    '.user-lic-buena-revisada-badge--clickable, .user-lic-garantia-entregada-badge--clickable'
                );
                if (!badge || !rootEl.contains(badge)) return;
                var row = badge.closest('.user-lic-license-row-edit');
                if (!row) return;
                ev.preventDefault();
                ev.stopPropagation();
                var prevGood =
                    badge.getAttribute('data-user-lic-prev-good') ||
                    row.getAttribute('data-user-lic-saved-good') ||
                    '';
                persistRow(row, {
                    revertBuenaRevisada: true,
                    statusGoodOverride: prevGood,
                });
            },
            true
        );

        rootEl.addEventListener(
            'keydown',
            function (ev) {
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                var badge =
                    ev.target.closest('.user-lic-solucionada-badge--clickable') ||
                    ev.target.closest(
                        '.user-lic-buena-revisada-badge--clickable, .user-lic-garantia-entregada-badge--clickable'
                    );
                if (!badge || !rootEl.contains(badge)) return;
                ev.preventDefault();
                badge.click();
            },
            true
        );
    }

    function userLicRowCustomerRenewalPending(row) {
        if (!row || typeof row !== 'object') return false;
        return String(row.customer_renewal_status || '').trim().toLowerCase() === 'pending';
    }

    /** Saldo de cuenta (API billing_saldo): 0 = al día (Pagada); distinto de 0 muestra importe pendiente o a favor (no «Pagada»). */
    function formatUserLicBillingSaldoCell(lm, row) {
        if (userLicRowCustomerRenewalPending(row)) {
            return (
                '<span class="user-lic-saldo-display user-lic-saldo-display--due user-lic-saldo-display--renewal-pending" title="Tu renovación fue comprada y está en cola; soporte la confirmará pronto.">Pendiente</span>'
            );
        }
        /* Pendiente de ESTA cuenta (deuda repartida de la compra más vieja a la más nueva);
           el saldo total ya se ve en el menú. Sin dato por cuenta se usa el saldo global. */
        if (lm && lm.billing_account_due != null && Number.isFinite(Number(lm.billing_account_due))) {
            var due = Number(lm.billing_account_due);
            if (due > 1e-9) {
                var dueTxt =
                    Math.abs(due - Math.round(due)) < 1e-9
                        ? String(Math.round(due))
                        : String(Number(due.toFixed(2)));
                return (
                    '<span class="user-lic-saldo-display user-lic-saldo-display--due" title="Pendiente de esta cuenta; los pagos se aplican de la compra más vieja a la más nueva.">Debe ' +
                    escHtml(dueTxt) +
                    '</span>'
                );
            }
            return (
                '<span class="user-lic-saldo-display user-lic-saldo-display--paid" title="Esta cuenta ya está pagada.">Pagada</span>'
            );
        }
        var raw = lm && lm.billing_saldo != null ? Number(lm.billing_saldo) : 0;
        if (!Number.isFinite(raw)) raw = 0;
        if (Math.abs(raw) < 1e-9) {
            return (
                '<span class="user-lic-saldo-display user-lic-saldo-display--paid" title="Cuenta al día (sin saldo pendiente)">Pagada</span>'
            );
        }
        var absVal = Math.abs(raw);
        var txt = Math.abs(absVal - Math.round(absVal)) < 1e-9 ? String(Math.round(absVal)) : String(Number(absVal.toFixed(2)));
        var label;
        var titleExtra;
        if (raw > 1e-9) {
            label = 'Debe ' + txt;
            titleExtra = 'Importe pendiente en cuenta licencias.';
        } else {
            label = 'A favor ' + txt;
            titleExtra = 'Saldo negativo / a favor (no al día como «Pagada»).';
        }
        return (
            '<span class="user-lic-saldo-display user-lic-saldo-display--due" title="' +
            escAttr(titleExtra) +
            '">' +
            escHtml(label) +
            '</span>'
        );
    }

    /** Ámbito DOM único por <article> para evitar ids duplicados (vista «Todos» + hojas por cuenta). */
    function userLicSheetDomScopeMerged() {
        return 'agg';
    }

    function userLicSheetDomScopeAccount(fkey) {
        return 'd' + slugForCredFieldId(fkey);
    }

    function renderEditableLicenseRow(row, day, ordinal, lm, credLineIndex, domScopeSeg, showFullCredTrigger) {
        var slug = slugForCredFieldId(lm.credSlug || 'u0');
        var ordStored = row.row_ordinal != null ? Number(row.row_ordinal) : Number(ordinal);
        if (!Number.isFinite(ordStored)) ordStored = ordinal;
        var renewalPending = userLicRowCustomerRenewalPending(row);
        var renewalPendingLockAttrs = renewalPending
            ? ' disabled aria-disabled="true" title="Renovación en proceso; esperá confirmación de soporte."'
            : '';

        var curSg = row.status_good != null ? String(row.status_good).trim() : '';
        var curSb = row.status_bad != null ? String(row.status_bad).trim() : '';
        var curOd = row.otro_detail != null ? String(row.otro_detail).trim() : '';
        var isGarantia = normalizeStatusKey(curSg) === normalizeStatusKey('garantia');
        var isWarrantyPending = row.warranty_pending === true;
        var isWarrantyEntregada =
            !isGarantia &&
            !isWarrantyPending &&
            row.warranty_entregada === true;
        var isSolucionada =
            !isGarantia &&
            !isWarrantyPending &&
            !isWarrantyEntregada &&
            (row.solucionada === true ||
                normalizeStatusKey(curSb) === normalizeStatusKey('solucionada'));
        var isBuenaRevisada =
            !isGarantia &&
            !isWarrantyPending &&
            !isWarrantyEntregada &&
            !isSolucionada &&
            (row.buena_revisada_readonly === true || normalizeStatusKey(curSg) === normalizeStatusKey('ok'));
        var isOkBadgeRow = isBuenaRevisada || isWarrantyEntregada;
        var prevGoodRestore =
            row.prev_good_restore != null ? String(row.prev_good_restore).trim() : '';
        var prevBadRestore =
            row.prev_bad_restore != null ? String(row.prev_bad_restore).trim() : '';
        var greenFromApi =
            row.green_select_value != null ? String(row.green_select_value).trim() : '';

        var goodSelectValue = isOkBadgeRow
            ? greenFromApi || prevGoodRestore
            : greenFromApi || curSg;
        var gTier = isGarantia
            ? 'good'
            : isOkBadgeRow
              ? String(goodSelectValue || '').trim()
                  ? 'good'
                  : 'neutral'
              : row.tier_good === 'good'
                ? 'good'
                : 'neutral';
        var bTier = isWarrantyPending ? 'neutral' : row.tier_bad === 'bad' ? 'bad' : 'neutral';

        var scopeSeg = slugForCredFieldId(domScopeSeg || 'x');
        var gid = 'user-lic-sg-' + scopeSeg + '-' + slug + '-d' + day + '-r' + ordStored;
        var bid = 'user-lic-sb-' + scopeSeg + '-' + slug + '-d' + day + '-r' + ordStored;
        var oid = 'user-lic-so-' + scopeSeg + '-' + slug + '-d' + day + '-r' + ordStored;

        var licIdSafe = lm.license_id != null ? Number(lm.license_id) : 0;
        var accHtml =
            lm.account_id != null && lm.account_id !== '' ? escAttr(String(lm.account_id)) : '';
        var saveKeyParts = [
            String(licIdSafe),
            lm.virtual ? 'v' : 'a',
            accHtml || '-',
            String(day),
            String(ordStored),
        ].join(':');

        var shellIsOtro = normalizeStatusKey(curSb) === 'otro';

        var clientNoteRaw = row.notes_client != null ? String(row.notes_client) : '';
        var nid = 'user-lic-cn-' + scopeSeg + '-' + slug + '-d' + day + '-r' + ordStored;

        var pnameRow = lm.product_name && String(lm.product_name).trim() ? String(lm.product_name).trim() : '';

        var credIdx = Number(credLineIndex);
        if (!Number.isFinite(credIdx) || credIdx < 0) credIdx = 0;

        var fullCredBtnHtml =
            showFullCredTrigger
                ? '<button type="button" class="user-lic-full-cred-trigger" title="Ver texto completo de esta línea de cuenta" aria-label="Ver texto completo de la línea de cuenta">' +
                  '<i class="fas fa-align-justify" aria-hidden="true"></i>' +
                  '</button>'
                : '';

        var showGoodCol = userLicPortalShouldShowGoodCol(lm);
        var goodShellClass =
            'license-split-editor__status-select-shell license-split-editor__status-select-shell--good' +
            (showGoodCol ? '' : ' user-lic-good-shell--tools-only');
        var goodSelectOrBadgeHtml = '';
        if (showGoodCol) {
            goodSelectOrBadgeHtml = isGarantia
                ? '<span class="user-lic-garantia-badge license-split-editor__status license-split-editor__status-good license-split-editor__status--tier-good" title="Cuenta repuesta por garantía (soporte).">' +
                  '<i class="fas fa-shield-alt" aria-hidden="true"></i> Garantía</span>'
                : '<select id="' +
                  gid +
                  '" name="' +
                  gid +
                  '" class="license-split-editor__status license-split-editor__status-good license-split-editor__status--tier-' +
                  gTier +
                  (isOkBadgeRow ? ' user-lic-status-good--buena-locked' : '') +
                  '" autocomplete="off" aria-label="Estado favorable (renovación)"' +
                  (isOkBadgeRow
                      ? ' disabled aria-disabled="true" title="Renovación guardada. Soporte confirmó el estado (Buena / Entregada)."'
                      : renewalPendingLockAttrs) +
                  '>' +
                  statusOptionsInnerHtml(userLicPortalGoodOptionsForLicense(lm), goodSelectValue) +
                  '</select>';
        } else if (isGarantia) {
            goodSelectOrBadgeHtml =
                '<span class="user-lic-garantia-badge license-split-editor__status license-split-editor__status-good license-split-editor__status--tier-good" title="Cuenta repuesta por garantía (soporte).">' +
                '<i class="fas fa-shield-alt" aria-hidden="true"></i> Garantía</span>';
        }

        return (
            '<div class="license-split-editor__row user-lic-readonly-row user-lic-license-row-edit' +
            (userLicRowSignalClassFromRow(row) ? ' ' + userLicRowSignalClassFromRow(row) : '') +
            (showGoodCol ? '' : ' user-lic-row-hide-good-select') +
            (renewalPending ? ' user-lic-row--renewal-pending' : '') +
            '"' +
            ' data-user-lic-save-key="' +
            escAttr(saveKeyParts) +
            '"' +
            ' data-lic-row-license-id="' +
            escAttr(String(licIdSafe || 0)) +
            '"' +
            ' data-lic-row-account-id="' +
            accHtml +
            '"' +
            ' data-lic-row-virtual="' +
            (lm.virtual ? '1' : '0') +
            '"' +
            ' data-lic-row-day="' +
            escAttr(String(day)) +
            '"' +
            ' data-lic-product-label="' +
            escAttr(pnameRow) +
            '"' +
            ' data-lic-creds-line-index="' +
            escAttr(String(credIdx)) +
            '"' +
            ' data-lic-row-ordinal="' +
            escAttr(String(ordStored)) +
            '"' +
            (isBuenaRevisada || isWarrantyEntregada ? ' data-user-lic-buena-revisada="1"' : '') +
            (isWarrantyEntregada ? ' data-user-lic-warranty-entregada="1"' : '') +
            (isSolucionada ? ' data-user-lic-solucionada="1"' : '') +
            (renewalPending ? ' data-user-lic-renewal-pending="1"' : '') +
            ' data-user-lic-saved-good="' +
            escAttr(isOkBadgeRow ? prevGoodRestore : goodSelectValue || curSg) +
            '"' +
            ' data-user-lic-bad-select-id="' +
            escAttr(bid) +
            '"' +
            (showGoodCol ? '' : ' data-user-lic-hide-good="1"') +
            '>' +
            '<div class="license-split-editor__status-wrap' +
            (shellIsOtro ? ' license-split-editor__status-wrap--otro' : '') +
            '">' +
            '<div class="' +
            goodShellClass +
            '">' +
            fullCredBtnHtml +
            '<button type="button" class="user-lic-warranty-history-btn" title="Historial de caídas y garantías" aria-label="Ver historial de caídas y garantías de esta fila">' +
            '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
            '</button>' +
            (renewalPending ? '' : userLicExpiryCountdownHtml(lm)) +
            goodSelectOrBadgeHtml +
            '</div>' +
            '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--bad' +
            (isWarrantyPending ? ' license-split-editor__status-select-shell--warranty-pending' : '') +
            '">' +
            (isWarrantyPending
                ? '<span class="user-lic-warranty-pending-badge" data-lic-pendiente-garantia="1" title="Soporte recibió tu reporte: pendiente de stock de garantía.">' +
                  '<i class="fas fa-hourglass-half" aria-hidden="true"></i> Garantía</span>'
                : isWarrantyEntregada
                ? userLicGarantiaEntregadaBadgeHtml(prevGoodRestore, prevBadRestore)
                : isSolucionada
                ? userLicSolucionadaBadgeHtml()
                : isBuenaRevisada
                ? userLicBuenaRevisadaBadgeHtml(prevGoodRestore, prevBadRestore)
                : '<select id="' +
                  bid +
                  '" name="' +
                  bid +
                  '" class="license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-' +
                  bTier +
                  '" autocomplete="off" aria-label="Reportar problema o incidencia"' +
                  renewalPendingLockAttrs +
                  '>' +
                  statusOptionsInnerHtml(OPT_LICENSE_BAD, curSb) +
                  '</select>') +
            '</div>' +
            '<input id="' +
            oid +
            '" name="' +
            oid +
            '" type="text" class="license-split-editor__otro-combined"' +
            (shellIsOtro ? '' : ' hidden="hidden" style="display:none"') +
            ' value="' +
            escAttr(curOd) +
            '" placeholder="Describe el problema" autocomplete="off"' +
            ' aria-label="Detalle del problema cuando eliges Otro"' +
            ' title="Cuando seleccionás Otro en incidencias, describí aquí el detalle."' +
            '/>' +
            '</div>' +
            '<div class="license-split-editor__saldo-cell"' +
            ' role="gridcell"' +
            ' aria-label="Saldo de cuenta">' +
            formatUserLicBillingSaldoCell(lm || {}, row) +
            '</div>' +
            '<input id="' +
            escAttr(nid) +
            '" name="' +
            escAttr(nid) +
            '" type="text" class="license-split-editor__note user-lic-note-client" autocomplete="off" spellcheck="true"' +
            ' value="' +
            escAttr(clientNoteRaw) +
            '" placeholder="Notas" aria-label="Notas"' +
            ' title="Notas privadas solo para vos; las notas que escribe soporte están en otro lado."' +
            '/>' +
            '</div>'
        );
    }

    /** Segmento seguro para id/name en HTML (p. ej. Issues: campos sin id/name). */
    function slugForCredFieldId(fkey) {
        return String(fkey || 'u0').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /** Chrome Issues: todo input/select/textarea debe tener id o name (autofill). */
    function userLicEnsureFormFieldIdName(root) {
        if (!root || !root.querySelectorAll) return;
        var seq = 0;
        root.querySelectorAll('input, select, textarea').forEach(function (el) {
            if (el.id && el.name) return;
            var base = el.id || el.name;
            if (!base) {
                var hint =
                    el.getAttribute('data-proveedor-extra-kind') ||
                    el.getAttribute('data-proveedor-block') ||
                    el.getAttribute('data-proveedor-day') ||
                    el.className ||
                    el.tagName;
                base = 'user-lic-field-' + slugForCredFieldId(hint) + '-' + String(seq);
                seq += 1;
                while (document.getElementById(base)) {
                    base = 'user-lic-field-' + slugForCredFieldId(hint) + '-' + String(seq);
                    seq += 1;
                }
            }
            if (!el.id) el.id = base;
            if (!el.name) el.name = base;
        });
    }

    /** Filtro de tarjeta «Todos»: una sola grilla día 1–31 con todas las cuentas. */
    var USER_LIC_AGGREGATE_LICENSE_ID = '__aggregate_all__';

    function licenseMetaFromAccount(acc) {
        var fkey = licenseFilterKey(acc);
        var pn = String(acc.product_name || '').trim();
        if (pn === '—' || pn === '-') pn = '';
        var daysLeft = accountDaysUntilExpiryUi(acc);
        return {
            license_id: acc.license_id,
            account_id: acc.account_id != null ? acc.account_id : null,
            virtual: !!(acc.virtual === true || acc.is_virtual === true),
            credSlug: fkey,
            billing_saldo: acc.billing_saldo != null ? Number(acc.billing_saldo) : 0,
            billing_account_due:
                acc.billing_account_due != null && acc.billing_account_due !== ''
                    ? Number(acc.billing_account_due)
                    : null,
            product_name: pn,
            month_to_month: userLicPortalMonthToMonthChecked(acc),
            days_until_expiry: daysLeft,
            expires_at_iso: acc.expires_at_iso || null,
            assigned_at_iso: acc.assigned_at_iso || null,
            license_term_days:
                acc.license_term_days != null && acc.license_term_days !== ''
                    ? Number(acc.license_term_days)
                    : null,
        };
    }

    function userLicDaysRemainingFromExpiresIso(iso) {
        if (!iso) return null;
        try {
            var exp = new Date(String(iso));
            if (Number.isNaN(exp.getTime())) return null;
            var msDay = 24 * 60 * 60 * 1000;
            return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / msDay));
        } catch (_eExp) {
            return null;
        }
    }

    function userLicDaysRemainingFromAssignedTerm(assignedIso, termDays) {
        if (!assignedIso || termDays == null || termDays === '') return null;
        try {
            var term = Number(termDays);
            if (!Number.isFinite(term) || term < 1) return null;
            var start = new Date(String(assignedIso));
            if (Number.isNaN(start.getTime())) return null;
            var expMs = start.getTime() + term * 24 * 60 * 60 * 1000;
            var msDay = 24 * 60 * 60 * 1000;
            return Math.max(0, Math.ceil((expMs - Date.now()) / msDay));
        } catch (_eAsg) {
            return null;
        }
    }

    function userLicExpiryCountdownHtml(lm) {
        if (!lm) return '';
        var daysLeft = lm.days_until_expiry;
        if (lm.expires_at_iso) {
            var computed = userLicDaysRemainingFromExpiresIso(lm.expires_at_iso);
            if (computed != null) daysLeft = computed;
        }
        if ((daysLeft == null || daysLeft === '') && lm.assigned_at_iso && lm.license_term_days) {
            var fromAssigned = userLicDaysRemainingFromAssignedTerm(
                lm.assigned_at_iso,
                lm.license_term_days
            );
            if (fromAssigned != null) daysLeft = fromAssigned;
        }
        if (daysLeft == null || daysLeft === '') return '';
        var n = Number(daysLeft);
        if (!Number.isFinite(n) || n < 0) return '';
        var title;
        var label;
        if (n === 0) {
            title = 'Vence hoy';
            label = '0d';
        } else if (n === 1) {
            title = 'Queda 1 día';
            label = '1d';
        } else {
            title = 'Quedan ' + n + ' días';
            label = String(n) + 'd';
        }
        if (lm.license_term_days != null && Number.isFinite(Number(lm.license_term_days))) {
            title += ' (periodo ' + lm.license_term_days + ' días)';
        }
        var urgent = n <= 5;
        return (
            '<span class="user-lic-expiry-countdown' +
            (urgent ? ' user-lic-expiry-countdown--urgent' : '') +
            '" title="' +
            escAttr(title) +
            '" aria-label="' +
            escAttr(title) +
            '">' +
            escHtml(label) +
            '</span>'
        );
    }

    function portalDayRowDedupeKey(row, day) {
        if (!row || typeof row !== 'object') return '';
        var cred = String(row.cred != null ? row.cred : '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
        var phys =
            row.phys_line_index != null && row.phys_line_index !== ''
                ? String(row.phys_line_index)
                : '';
        var vd = row.vinculo_dia != null && row.vinculo_dia !== '' ? String(row.vinculo_dia) : String(day);
        return vd + '|' + phys + '|' + cred;
    }

    function pairsForMergedDay(accounts, day) {
        var pairs = [];
        var seen = {};
        var ai;
        for (ai = 0; ai < accounts.length; ai += 1) {
            var acc = accounts[ai];
            var lm = licenseMetaFromAccount(acc);
            var rows = (acc.day_lines || {})[String(day)] || [];
            var ri;
            for (ri = 0; ri < rows.length; ri += 1) {
                var row = rows[ri];
                var dk = portalDayRowDedupeKey(row, day);
                if (dk && seen[dk]) continue;
                if (dk) seen[dk] = true;
                pairs.push({ row: row, lm: lm });
            }
        }
        return pairs;
    }

    function userLicPortalColombiaClockFromBrowser() {
        try {
            var parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Bogota',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
            }).formatToParts(new Date());
            var y = NaN;
            var m = NaN;
            var d = NaN;
            var pi;
            for (pi = 0; pi < parts.length; pi += 1) {
                if (parts[pi].type === 'year') y = parseInt(parts[pi].value, 10);
                if (parts[pi].type === 'month') m = parseInt(parts[pi].value, 10);
                if (parts[pi].type === 'day') d = parseInt(parts[pi].value, 10);
            }
            if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
            var dim = new Date(y, m, 0).getDate();
            return { day: d, days_in_month: dim, year: y, month: m };
        } catch (_eBrowser) {
            return null;
        }
    }

    /** Días hasta el próximo «Día N» del mes (renovación mes a mes), hora Colombia. */
    function daysUntilCalendarSaleDay(saleDay, clock) {
        var cal = Number(saleDay);
        if (!Number.isFinite(cal) || cal < 1 || cal > 31) return null;
        var co = clock || userLicPortalColombiaClock || userLicPortalColombiaClockFromBrowser();
        if (!co || co.day == null) return null;
        var today = Number(co.day);
        var y = Number(co.year);
        var m = Number(co.month);
        var dim = Number(co.days_in_month);
        if (!Number.isFinite(today) || !Number.isFinite(dim) || dim < 28) return null;
        if (!Number.isFinite(y) || !Number.isFinite(m)) return null;

        function prevMonthDays(year, month) {
            var pm = month - 1;
            var py = year;
            if (pm < 1) {
                pm = 12;
                py -= 1;
            }
            return new Date(py, pm, 0).getDate();
        }

        function dateKey(dObj) {
            return (
                dObj.getFullYear() +
                '-' +
                String(dObj.getMonth() + 1).padStart(2, '0') +
                '-' +
                String(dObj.getDate()).padStart(2, '0')
            );
        }

        var todayDate = new Date(y, m - 1, today);
        var candidates = [];

        if (cal <= dim && cal >= today) {
            candidates.push(new Date(y, m - 1, cal));
        }
        if (today === 1) {
            var prevDim = prevMonthDays(y, m);
            if (cal > prevDim) {
                candidates.push(new Date(y, m - 1, 1));
            }
        }
        var nm = m + 1;
        var ny = y;
        if (nm > 12) {
            nm = 1;
            ny += 1;
        }
        var ndim = new Date(ny, nm, 0).getDate();
        if (cal > dim) {
            candidates.push(new Date(ny, nm - 1, 1));
        } else if (cal <= ndim) {
            candidates.push(new Date(ny, nm - 1, cal));
        } else {
            var nnm = nm + 1;
            var nny = ny;
            if (nnm > 12) {
                nnm = 1;
                nny += 1;
            }
            candidates.push(new Date(nny, nnm - 1, 1));
        }

        var todayKey = dateKey(todayDate);
        var best = null;
        var ci;
        for (ci = 0; ci < candidates.length; ci += 1) {
            var c = candidates[ci];
            if (dateKey(c) < todayKey) continue;
            if (!best || dateKey(c) < dateKey(best)) best = c;
        }
        if (!best) return null;
        var msDay = 24 * 60 * 60 * 1000;
        return Math.max(0, Math.round((best.getTime() - todayDate.getTime()) / msDay));
    }

    function accountDaysUntilExpiryUi(acc, clock) {
        if (!acc) return null;
        if (acc.days_until_expiry != null && acc.days_until_expiry !== '') {
            var expSrv = Number(acc.days_until_expiry);
            if (Number.isFinite(expSrv) && expSrv >= 0) return Math.trunc(expSrv);
        }
        if (acc.days_until_calendar_sale != null && acc.days_until_calendar_sale !== '') {
            var calSrv = Number(acc.days_until_calendar_sale);
            if (Number.isFinite(calSrv) && calSrv >= 0) return Math.trunc(calSrv);
        }
        if (acc.linked_sale_day != null && acc.linked_sale_day !== '') {
            var fromLinked = daysUntilCalendarSaleDay(acc.linked_sale_day, clock);
            if (fromLinked != null) return fromLinked;
        }
        var entriesCad = portalRowEntriesAllDays(acc);
        var minLeft = null;
        var ei;
        for (ei = 0; ei < entriesCad.length; ei += 1) {
            var entryLeft = daysUntilCalendarSaleDay(entriesCad[ei].saleDay, clock);
            if (entryLeft == null) continue;
            if (minLeft == null || entryLeft < minLeft) minLeft = entryLeft;
        }
        if (minLeft != null) return minLeft;
        if (acc.days_until_expiry != null && acc.days_until_expiry !== '') {
            var n = Number(acc.days_until_expiry);
            if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
        }
        if (acc.account_expired === true) return 0;
        return null;
    }

    /** Todas las filas del bloc por día de calendario (para caducidad y mínimo de días). */
    function portalRowEntriesAllDays(acc) {
        var dl = acc.day_lines || {};
        var entries = [];
        var d;
        for (d = 1; d <= 31; d += 1) {
            var rs = dl[String(d)] || [];
            var ri;
            for (ri = 0; ri < rs.length; ri += 1) {
                entries.push({ row: rs[ri], saleDay: d });
            }
        }
        return entries;
    }

    /** Filas visibles del portal con el día de calendario (1–31) para guardar estado. */
    function portalRowEntriesForAccount(acc) {
        var dl = acc.day_lines || {};
        var linked = acc.linked_sale_day;
        if (linked != null && linked !== '') {
            var ld = Number(linked);
            if (Number.isFinite(ld) && ld >= 1 && ld <= 31) {
                var onLinked = dl[String(ld)] || [];
                if (onLinked.length) {
                    var outLinked = [];
                    var li;
                    for (li = 0; li < onLinked.length; li += 1) {
                        outLinked.push({ row: onLinked[li], saleDay: ld });
                    }
                    return outLinked;
                }
            }
        }
        return portalRowEntriesAllDays(acc);
    }

    function vencimientoSectionTitleHtml(daysLeft) {
        var n = Number(daysLeft);
        var label;
        if (n === 1) {
            label = 'Falta 1 día';
        } else {
            label = 'Faltan ' + n + ' días';
        }
        return (
            '<i class="fas fa-hourglass-half" aria-hidden="true"></i> <span>' +
            escHtml(label) +
            '</span>'
        );
    }

    function buildVencimientoBuckets(accounts, maxDays, clock) {
        var buckets = {};
        var maxD = Number(maxDays);
        if (!Number.isFinite(maxD) || maxD < 0) maxD = USER_LIC_CADUCIDAD_VIEW_MAX_DAYS;
        var co = clock || userLicPortalColombiaClock || userLicPortalColombiaClockFromBrowser();
        var ai;
        for (ai = 0; ai < accounts.length; ai += 1) {
            var acc = accounts[ai];
            var entries = portalRowEntriesAllDays(acc);
            if (!entries.length) continue;
            var lm = licenseMetaFromAccount(acc);
            var ri;
            for (ri = 0; ri < entries.length; ri += 1) {
                var entryLeft = accountDaysUntilExpiryUi(acc, co);
                if (entryLeft == null) {
                    entryLeft = daysUntilCalendarSaleDay(entries[ri].saleDay, co);
                }
                if (entryLeft == null || entryLeft > maxD) continue;
                if (!buckets[entryLeft]) buckets[entryLeft] = [];
                buckets[entryLeft].push({
                    row: entries[ri].row,
                    lm: lm,
                    daysLeft: entryLeft,
                    saleDay: entries[ri].saleDay,
                });
            }
        }
        return buckets;
    }

    function userLicRenewalNotifyLsKey(suffix) {
        return 'user_lic_renewal_notify_' + suffix;
    }

    function userLicRenewalNotifySentRead() {
        try {
            var raw = localStorage.getItem(userLicRenewalNotifyLsKey('sent'));
            return raw ? JSON.parse(raw) : {};
        } catch (_eR) {
            return {};
        }
    }

    function userLicRenewalNotifySentWrite(map) {
        try {
            localStorage.setItem(userLicRenewalNotifyLsKey('sent'), JSON.stringify(map || {}));
        } catch (_eW) {}
    }

    function userLicRenewalNotifyShowInAppAlert(title, body, urgent) {
        if (document.visibilityState !== 'visible') return false;
        var stack = userLicCaducidadNotifyEnsureAlertStack();
        while (stack.children.length >= USER_LIC_CADUCIDAD_INAPP_ALERT_MAX) {
            userLicCaducidadNotifyDismissInAppAlert(stack.firstElementChild);
        }
        stack.hidden = false;
        stack.removeAttribute('hidden');

        var card = document.createElement('div');
        card.className =
            'user-lic-caducidad-alert' + (urgent ? ' user-lic-caducidad-alert--urgent' : '');
        card.setAttribute('role', 'alert');
        card.innerHTML =
            '<div class="user-lic-caducidad-alert__head">' +
            '<div class="user-lic-caducidad-alert__title">' +
            escHtml(title) +
            '</div>' +
            '<button type="button" class="user-lic-caducidad-alert__close" aria-label="Cerrar aviso">&times;</button>' +
            '</div>' +
            '<div class="user-lic-caducidad-alert__body">' +
            escHtml(body) +
            '</div>' +
            '<div class="user-lic-caducidad-alert__foot">Toca para ver en Licencias</div>';

        var closeBtn = card.querySelector('.user-lic-caducidad-alert__close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                userLicCaducidadNotifyDismissInAppAlert(card);
            });
        }
        card.addEventListener('click', function () {
            userLicCaducidadNotifyDismissInAppAlert(card);
            var host = document.querySelector('.admin-licencias-page.user-licencias-shell');
            if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        stack.appendChild(card);
        try {
            if (
                window.StoreUserNotifications &&
                typeof window.StoreUserNotifications.playAlertFeedback === 'function'
            ) {
                window.StoreUserNotifications.playAlertFeedback();
            }
        } catch (_fbR) {}
        window.setTimeout(function () {
            userLicCaducidadNotifyDismissInAppAlert(card);
        }, USER_LIC_CADUCIDAD_INAPP_ALERT_MS);
        return true;
    }

    function userLicRenewalNotifyRunCheck() {
        var prefs = userLicCaducidadNotifyPrefsRead();
        if (!prefs.enabled) return;
        var warnings = userLicRenewalBalanceWarningsCache || [];
        if (!warnings.length) return;

        var useBrowser = !!prefs.push && userLicCaducidadNotifyBrowserGranted();
        var useInapp = prefs.inapp !== false;
        if (!useBrowser && !useInapp) return;
        if (!useBrowser && document.visibilityState !== 'visible') return;

        var today = userLicCaducidadNotifyTodayStamp();
        var sent = userLicRenewalNotifySentRead();
        var dirty = false;
        var wi;
        var shownInApp = 0;

        for (wi = 0; wi < warnings.length; wi += 1) {
            var w = warnings[wi];
            if (!w || !w.key) continue;
            var notifyKey = 'ren:' + String(w.key);
            if (sent[notifyKey] === today) continue;

            var label = String(w.credential_preview || 'Cuenta').trim();
            var title = 'Renovación sin saldo';
            var body =
                label +
                (w.days_left === 0
                    ? ' — renovación hoy'
                    : w.days_left != null
                      ? ' — en ' + userLicCaducidadNotifyDaysLabel(w.days_left)
                      : '') +
                '. ' +
                String(w.message || 'No hay saldo suficiente; pasará a vencidas.');
            var urgent = !!(w.urgent || w.days_left <= 1);
            var delivered = false;

            if (useBrowser) {
                try {
                    var notifRen = new Notification(title, {
                        body: body,
                        tag: notifyKey,
                        renotify: false,
                    });
                    notifRen.onclick = function () {
                        window.focus();
                    };
                    delivered = true;
                } catch (_eRn) {
                    delivered = false;
                }
            }

            if (!delivered && useInapp && document.visibilityState === 'visible') {
                if (shownInApp >= USER_LIC_CADUCIDAD_INAPP_ALERT_MAX) continue;
                if (userLicRenewalNotifyShowInAppAlert(title, body, urgent)) {
                    shownInApp += 1;
                    delivered = true;
                }
            }

            if (!delivered) continue;
            sent[notifyKey] = today;
            dirty = true;
        }

        if (dirty) {
            var pruneKeys = Object.keys(sent);
            var pk;
            for (pk = 0; pk < pruneKeys.length; pk += 1) {
                if (sent[pruneKeys[pk]] !== today) {
                    delete sent[pruneKeys[pk]];
                }
            }
            userLicRenewalNotifySentWrite(sent);
        }
    }

    function userLicCaducidadNotifyLsKey(suffix) {
        return 'user_lic_' + portalUiPersistScopeSlug() + '_caducidad_notify_' + suffix;
    }

    function userLicNotifyPrefsFromEmbedded() {
        var el = document.getElementById('userLicNotifyPrefsJson');
        if (!el) return null;
        try {
            var raw = (el.textContent || '').trim();
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_e) {
            return null;
        }
    }

    function userLicNotifyPrefsApplyServer(prefs) {
        if (!prefs || typeof prefs !== 'object') return;
        userLicCaducidadNotifyPrefsMem.enabled = !!prefs.caducidad_notify_enabled;
        var fd = parseInt(prefs.caducidad_notify_from_days, 10);
        userLicCaducidadNotifyPrefsMem.fromDays =
            Number.isFinite(fd) && fd >= 1 && fd <= 5 ? fd : 5;
        userLicCaducidadNotifyPrefsMem.email = prefs.email_notify_enabled !== false;
        userLicCaducidadNotifyPrefsMem.push = prefs.push_notify_enabled !== false;
        userLicCaducidadNotifyPrefsMem.inapp = prefs.inapp_notify_enabled !== false;
        userLicCaducidadNotifyPrefsMem.vibrate = !!prefs.notify_vibrate_enabled;
        userLicCaducidadNotifyPrefsMem.sound = !!prefs.notify_sound_enabled;
        try {
            window.__storeNotifyPrefs = {
                email: userLicCaducidadNotifyPrefsMem.email,
                push: userLicCaducidadNotifyPrefsMem.push,
                inapp: userLicCaducidadNotifyPrefsMem.inapp,
                vibrate: userLicCaducidadNotifyPrefsMem.vibrate,
                sound: userLicCaducidadNotifyPrefsMem.sound,
            };
        } catch (_w) {}
    }

    function userLicNotifyPrefsCsrf() {
        var meta = document.querySelector('meta[name="csrf_token"]');
        return meta ? meta.getAttribute('content') || '' : '';
    }

    function userLicNotifyPrefsSetSaveStatus(text, kind) {
        var el = document.getElementById('userLicNotifyPrefsSaveStatus');
        if (!el) return;
        var t = String(text || '').trim();
        if (!t) {
            el.hidden = true;
            el.textContent = '';
            el.className = 'user-lic-caducidad-notify-bar__hint mb-0';
            return;
        }
        el.hidden = false;
        el.textContent = t;
        el.className =
            'user-lic-caducidad-notify-bar__hint mb-0' +
            (kind === 'ok'
                ? ' user-lic-caducidad-notify-bar__hint--ok'
                : kind === 'warn'
                  ? ' user-lic-caducidad-notify-bar__hint--warn'
                  : '');
    }

    function userLicNotifyPrefsCollectFromDom() {
        var chkCad = document.getElementById('userLicCaducidadNotifyEnabled');
        var sel = document.getElementById('userLicCaducidadNotifyFromDays');
        var chkEmail = document.getElementById('userLicNotifyEmailEnabled');
        var chkPush = document.getElementById('userLicNotifyPushEnabled');
        var chkInapp = document.getElementById('userLicNotifyInappEnabled');
        var chkVibrate = document.getElementById('userLicNotifyVibrateEnabled');
        var chkSound = document.getElementById('userLicNotifySoundEnabled');
        return {
            email_notify_enabled: chkEmail ? !!chkEmail.checked : userLicCaducidadNotifyPrefsMem.email,
            push_notify_enabled: chkPush ? !!chkPush.checked : userLicCaducidadNotifyPrefsMem.push,
            inapp_notify_enabled: chkInapp ? !!chkInapp.checked : userLicCaducidadNotifyPrefsMem.inapp,
            notify_vibrate_enabled: chkVibrate
                ? !!chkVibrate.checked
                : !!userLicCaducidadNotifyPrefsMem.vibrate,
            notify_sound_enabled: chkSound
                ? !!chkSound.checked
                : !!userLicCaducidadNotifyPrefsMem.sound,
            caducidad_notify_enabled: chkCad
                ? !!chkCad.checked
                : userLicCaducidadNotifyPrefsMem.enabled,
            caducidad_notify_from_days: sel
                ? Number(sel.value) || 5
                : userLicCaducidadNotifyPrefsMem.fromDays || 5,
        };
    }

    function userLicNotifyPrefsSaveToServer(payload) {
        var body = payload || userLicNotifyPrefsCollectFromDom();
        userLicNotifyPrefsApplyServer({
            email_notify_enabled: body.email_notify_enabled,
            push_notify_enabled: body.push_notify_enabled,
            inapp_notify_enabled: body.inapp_notify_enabled,
            notify_vibrate_enabled: body.notify_vibrate_enabled,
            notify_sound_enabled: body.notify_sound_enabled,
            caducidad_notify_enabled: body.caducidad_notify_enabled,
            caducidad_notify_from_days: body.caducidad_notify_from_days,
        });
        if (userLicNotifyPrefsSaveTimer) {
            window.clearTimeout(userLicNotifyPrefsSaveTimer);
            userLicNotifyPrefsSaveTimer = null;
        }
        userLicNotifyPrefsSaveTimer = window.setTimeout(function () {
            userLicNotifyPrefsSaveTimer = null;
            userLicNotifyPrefsSetSaveStatus('Guardando…', '');
            fetch('/tienda/api/user/notify-prefs', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': userLicNotifyPrefsCsrf(),
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
                        userLicNotifyPrefsApplyServer(data.prefs);
                        userLicNotifyPrefsSetSaveStatus('Guardado', 'ok');
                        window.setTimeout(function () {
                            userLicNotifyPrefsSetSaveStatus('', '');
                        }, 1800);
                        return;
                    }
                    userLicNotifyPrefsSetSaveStatus(
                        (data && data.error) || 'No se pudo guardar',
                        'warn'
                    );
                })
                .catch(function () {
                    userLicNotifyPrefsSetSaveStatus('Error de red al guardar', 'warn');
                });
        }, 350);
    }

    function userLicCaducidadNotifyTodayStamp() {
        var d = new Date();
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return (
            String(d.getFullYear()) +
            '-' +
            (m < 10 ? '0' : '') +
            m +
            '-' +
            (day < 10 ? '0' : '') +
            day
        );
    }

    function userLicCaducidadNotifyPrefsRead() {
        var fromDays = Math.max(
            1,
            Math.min(
                USER_LIC_CADUCIDAD_NOTIFY_MAX_LEAD,
                Number(userLicCaducidadNotifyPrefsMem.fromDays) || 5
            )
        );
        return {
            enabled: !!userLicCaducidadNotifyPrefsMem.enabled,
            fromDays: fromDays,
            email: userLicCaducidadNotifyPrefsMem.email !== false,
            push: userLicCaducidadNotifyPrefsMem.push !== false,
            inapp: userLicCaducidadNotifyPrefsMem.inapp !== false,
            vibrate: !!userLicCaducidadNotifyPrefsMem.vibrate,
            sound: !!userLicCaducidadNotifyPrefsMem.sound,
        };
    }

    function userLicCaducidadNotifyPrefsWrite(enabled, fromDays) {
        var fd = Math.max(
            1,
            Math.min(USER_LIC_CADUCIDAD_NOTIFY_MAX_LEAD, Number(fromDays) || 5)
        );
        userLicCaducidadNotifyPrefsMem.enabled = !!enabled;
        userLicCaducidadNotifyPrefsMem.fromDays = fd;
        try {
            localStorage.setItem(userLicCaducidadNotifyLsKey('enabled'), enabled ? '1' : '0');
            localStorage.setItem(userLicCaducidadNotifyLsKey('from_days'), String(fd));
        } catch (_ePw) {
            /* ignore */
        }
        userLicNotifyPrefsSaveToServer({
            email_notify_enabled: userLicCaducidadNotifyPrefsMem.email !== false,
            push_notify_enabled: userLicCaducidadNotifyPrefsMem.push !== false,
            inapp_notify_enabled: userLicCaducidadNotifyPrefsMem.inapp !== false,
            notify_vibrate_enabled: !!userLicCaducidadNotifyPrefsMem.vibrate,
            notify_sound_enabled: !!userLicCaducidadNotifyPrefsMem.sound,
            caducidad_notify_enabled: !!enabled,
            caducidad_notify_from_days: fd,
        });
    }

    function userLicCaducidadNotifySentRead() {
        try {
            var raw = localStorage.getItem(userLicCaducidadNotifyLsKey('sent'));
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_eSr) {
            return {};
        }
    }

    function userLicCaducidadNotifySentWrite(map) {
        try {
            localStorage.setItem(userLicCaducidadNotifyLsKey('sent'), JSON.stringify(map || {}));
        } catch (_eSw) {
            /* ignore */
        }
    }

    function userLicCaducidadNotifyDaysLabel(n) {
        var left = Number(n);
        if (left === 0) return 'vence hoy';
        if (left === 1) return 'vence en 1 día';
        return 'vence en ' + left + ' días';
    }

    function userLicCaducidadNotifyAccountLabel(acc) {
        var entries = portalRowEntriesForAccount(acc);
        var cred = '';
        if (entries.length && entries[0].row && entries[0].row.cred != null) {
            cred = String(entries[0].row.cred).trim().split('\n')[0];
        }
        var pn = String(acc.product_name || '').trim();
        if (pn === '—' || pn === '-') pn = '';
        if (pn && cred) return pn + ' — ' + cred;
        return pn || cred || 'Cuenta';
    }

    function userLicCaducidadNotifyAccountKey(acc, daysLeft) {
        var lm = licenseMetaFromAccount(acc);
        return (
            String(lm.license_id != null ? lm.license_id : 0) +
            ':' +
            (lm.account_id != null ? lm.account_id : '-') +
            ':' +
            (lm.virtual ? 'v' : 'a') +
            ':' +
            String(daysLeft)
        );
    }

    function userLicCaducidadNotifyBrowserGranted() {
        return typeof Notification !== 'undefined' && Notification.permission === 'granted';
    }

    function userLicCaducidadNotifyEnabledHint() {
        var prefs = userLicCaducidadNotifyPrefsRead();
        var bits = [];
        if (prefs.inapp) bits.push('app');
        if (prefs.push) {
            if (userLicCaducidadNotifyBrowserGranted()) {
                bits.push('navegador');
            } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
                bits.push('navegador bloqueado');
            } else if (typeof Notification !== 'undefined') {
                bits.push('navegador (pide permiso)');
            }
        }
        if (!bits.length) {
            return {
                text: 'Caducidad activa, pero sin canales: activa «Avisos en la app» o «Push / navegador» arriba.',
                kind: 'warn',
            };
        }
        if (prefs.push && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            return {
                text: 'Avisos por: ' + bits.join(' · ') + '. Puedes desbloquear el navegador en el candado de la barra.',
                kind: 'warn',
            };
        }
        return {
            text:
                'Avisos de caducidad por: ' +
                bits.join(' · ') +
                '. Se revisan al cargar y cada 30 min con la pestaña abierta.',
            kind: 'ok',
        };
    }

    function userLicCaducidadNotifyEnsureAlertStack() {
        var stack = document.getElementById('userLicCaducidadAlertStack');
        if (stack) return stack;
        stack = document.createElement('div');
        stack.id = 'userLicCaducidadAlertStack';
        stack.className = 'user-lic-caducidad-alert-stack';
        stack.setAttribute('aria-live', 'polite');
        stack.setAttribute('aria-label', 'Alertas de caducidad');
        stack.hidden = true;
        document.body.appendChild(stack);
        return stack;
    }

    function userLicCaducidadNotifyDismissInAppAlert(el) {
        if (!el || el._userLicCaducidadAlertClosing) return;
        el._userLicCaducidadAlertClosing = true;
        el.classList.add('user-lic-caducidad-alert--closing');
        window.setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
            var stack = document.getElementById('userLicCaducidadAlertStack');
            if (stack && !stack.children.length) {
                stack.hidden = true;
                stack.setAttribute('hidden', 'hidden');
            }
        }, 220);
    }

    function userLicCaducidadNotifyShowInAppAlert(title, body, urgent) {
        if (document.visibilityState !== 'visible') return false;
        var stack = userLicCaducidadNotifyEnsureAlertStack();
        while (stack.children.length >= USER_LIC_CADUCIDAD_INAPP_ALERT_MAX) {
            userLicCaducidadNotifyDismissInAppAlert(stack.firstElementChild);
        }
        stack.hidden = false;
        stack.removeAttribute('hidden');

        var card = document.createElement('div');
        card.className =
            'user-lic-caducidad-alert' + (urgent ? ' user-lic-caducidad-alert--urgent' : '');
        card.setAttribute('role', 'alert');
        card.innerHTML =
            '<div class="user-lic-caducidad-alert__head">' +
            '<div class="user-lic-caducidad-alert__title">' +
            escHtml(title) +
            '</div>' +
            '<button type="button" class="user-lic-caducidad-alert__close" aria-label="Cerrar aviso">&times;</button>' +
            '</div>' +
            '<div class="user-lic-caducidad-alert__body">' +
            escHtml(body) +
            '</div>' +
                '<div class="user-lic-caducidad-alert__foot">Toca para ir a Notificación</div>';

        var closeBtn = card.querySelector('.user-lic-caducidad-alert__close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                userLicCaducidadNotifyDismissInAppAlert(card);
            });
        }
        card.addEventListener('click', function () {
            userLicCaducidadNotifyDismissInAppAlert(card);
            userLicCaducidadNotifyOpenCaducidadView();
        });

        stack.appendChild(card);
        try {
            if (
                window.StoreUserNotifications &&
                typeof window.StoreUserNotifications.playAlertFeedback === 'function'
            ) {
                window.StoreUserNotifications.playAlertFeedback();
            }
        } catch (_fb) {}
        window.setTimeout(function () {
            userLicCaducidadNotifyDismissInAppAlert(card);
        }, USER_LIC_CADUCIDAD_INAPP_ALERT_MS);
        return true;
    }

    function userLicCaducidadNotifySetHint(text, kind) {
        var hint = document.getElementById('userLicCaducidadNotifyHint');
        if (!hint) return;
        var msg = text != null ? String(text).trim() : '';
        hint.textContent = msg;
        hint.classList.remove('user-lic-caducidad-notify-bar__hint--warn', 'user-lic-caducidad-notify-bar__hint--ok');
        if (kind === 'warn') hint.classList.add('user-lic-caducidad-notify-bar__hint--warn');
        if (kind === 'ok') hint.classList.add('user-lic-caducidad-notify-bar__hint--ok');
        if (msg) {
            hint.hidden = false;
            hint.removeAttribute('hidden');
        } else {
            hint.hidden = true;
            hint.setAttribute('hidden', 'hidden');
        }
    }

    function userLicCaducidadNotifySyncBarUi() {
        var bar = document.getElementById('userLicCaducidadNotifyBar');
        var chk = document.getElementById('userLicCaducidadNotifyEnabled');
        var sel = document.getElementById('userLicCaducidadNotifyFromDays');
        var chkEmail = document.getElementById('userLicNotifyEmailEnabled');
        var chkPush = document.getElementById('userLicNotifyPushEnabled');
        var chkInapp = document.getElementById('userLicNotifyInappEnabled');
        var chkVibrate = document.getElementById('userLicNotifyVibrateEnabled');
        var chkSound = document.getElementById('userLicNotifySoundEnabled');
        if (!bar) return;
        var prefs = userLicCaducidadNotifyPrefsRead();
        if (chk) {
            chk.checked = !!prefs.enabled;
            chk.disabled = false;
        }
        if (sel) {
            sel.value = String(prefs.fromDays || 5);
            sel.disabled = !prefs.enabled;
        }
        if (chkEmail) chkEmail.checked = prefs.email !== false;
        if (chkPush) chkPush.checked = prefs.push !== false;
        if (chkInapp) chkInapp.checked = prefs.inapp !== false;
        if (chkVibrate) chkVibrate.checked = !!prefs.vibrate;
        if (chkSound) chkSound.checked = !!prefs.sound;
        if (!prefs.enabled) {
            userLicCaducidadNotifySetHint('', '');
            return;
        }
        var hint = userLicCaducidadNotifyEnabledHint();
        userLicCaducidadNotifySetHint(hint.text, hint.kind);
    }

    function userLicCaducidadSyncShellLayoutClass() {
        var shell = document.querySelector('.admin-licencias-page.user-licencias-shell');
        if (!shell) return;
        shell.classList.toggle('user-licencias-shell--caducidad', userLicPortalVencimientosActive);
    }

    function userLicCaducidadNotifySyncBarVisibility() {
        var bar = document.getElementById('userLicCaducidadNotifyBar');
        if (!bar) return;
        var show = userLicPortalVencimientosActive;
        userLicCaducidadSyncShellLayoutClass();
        if (show) {
            bar.classList.remove('d-none');
            bar.hidden = false;
            bar.setAttribute('aria-hidden', 'false');
            bar.removeAttribute('inert');
            userLicCaducidadNotifySyncBarUi();
        } else {
            bar.classList.add('d-none');
            bar.hidden = true;
            bar.setAttribute('aria-hidden', 'true');
        }
    }

    function userLicCaducidadNotifyStopTimer() {
        if (userLicCaducidadNotifyTimer) {
            window.clearInterval(userLicCaducidadNotifyTimer);
            userLicCaducidadNotifyTimer = null;
        }
    }

    function userLicCaducidadNotifyStartTimer() {
        userLicCaducidadNotifyStopTimer();
        var prefs = userLicCaducidadNotifyPrefsRead();
        if (!prefs.enabled) return;
        userLicCaducidadNotifyTimer = window.setInterval(function () {
            if (document.visibilityState === 'visible') {
                userLicCaducidadNotifyRunCheck();
            }
        }, USER_LIC_CADUCIDAD_NOTIFY_CHECK_MS);
    }

    function userLicCaducidadNotifyOpenCaducidadView() {
        if (userLicPortalVencimientosActive) return;
        var btn = document.getElementById('btnUserLicVencimientos');
        if (btn) btn.click();
    }

    function userLicCaducidadNotifyRunCheck() {
        var prefs = userLicCaducidadNotifyPrefsRead();
        if (!prefs.enabled) return;
        var accounts = userLicPortalAccountsCache || [];
        if (!accounts.length) return;

        var useBrowser = !!prefs.push && userLicCaducidadNotifyBrowserGranted();
        var useInapp = prefs.inapp !== false;
        if (!useBrowser && !useInapp) return;
        if (!useBrowser && document.visibilityState !== 'visible') return;

        var fromDays = prefs.fromDays;
        var today = userLicCaducidadNotifyTodayStamp();
        var sent = userLicCaducidadNotifySentRead();
        var dirty = false;
        var ai;
        var shownInApp = 0;

        for (ai = 0; ai < accounts.length; ai += 1) {
            var acc = accounts[ai];
            var left = accountDaysUntilExpiryUi(acc);
            if (left == null || left < 0 || left > fromDays) continue;
            var notifyKey = userLicCaducidadNotifyAccountKey(acc, left);
            if (sent[notifyKey] === today) continue;

            var title = left === 0 ? 'Licencia vence hoy' : 'Licencia por vencer';
            var body =
                userLicCaducidadNotifyAccountLabel(acc) +
                ' — ' +
                userLicCaducidadNotifyDaysLabel(left);
            var delivered = false;

            if (useBrowser) {
                try {
                    var notif = new Notification(title, {
                        body: body,
                        tag: notifyKey,
                        renotify: false,
                    });
                    notif.onclick = function () {
                        window.focus();
                        userLicCaducidadNotifyOpenCaducidadView();
                    };
                    delivered = true;
                } catch (_eN) {
                    delivered = false;
                }
            }

            if (!delivered && useInapp && document.visibilityState === 'visible') {
                if (shownInApp >= USER_LIC_CADUCIDAD_INAPP_ALERT_MAX) continue;
                if (userLicCaducidadNotifyShowInAppAlert(title, body, left <= 1)) {
                    shownInApp += 1;
                    delivered = true;
                }
            }

            if (!delivered) continue;
            sent[notifyKey] = today;
            dirty = true;
        }

        if (dirty) {
            var pruneKeys = Object.keys(sent);
            var pk;
            for (pk = 0; pk < pruneKeys.length; pk += 1) {
                if (sent[pruneKeys[pk]] !== today) {
                    delete sent[pruneKeys[pk]];
                }
            }
            userLicCaducidadNotifySentWrite(sent);
        }
        userLicRenewalNotifyRunCheck();
    }

    function userLicCaducidadNotifyRequestPermission() {
        if (typeof Notification === 'undefined') {
            return Promise.resolve('unsupported');
        }
        if (Notification.permission === 'granted') return Promise.resolve('granted');
        if (Notification.permission === 'denied') return Promise.resolve('denied');
        try {
            var ret = Notification.requestPermission();
            if (ret && typeof ret.then === 'function') {
                return ret;
            }
            return new Promise(function (resolve) {
                try {
                    Notification.requestPermission(function (state) {
                        resolve(state || Notification.permission || 'denied');
                    });
                } catch (_eCb) {
                    resolve(Notification.permission || 'denied');
                }
            });
        } catch (_eRp) {
            return Promise.resolve('denied');
        }
    }

    function userLicCaducidadNotifyOnEnabledChange(wantOn) {
        var chk = document.getElementById('userLicCaducidadNotifyEnabled');
        var sel = document.getElementById('userLicCaducidadNotifyFromDays');
        if (!chk || !sel) return;

        if (!wantOn) {
            userLicCaducidadNotifyPrefsWrite(false, Number(sel.value) || 5);
            chk.checked = false;
            userLicCaducidadNotifyStopTimer();
            sel.disabled = true;
            userLicCaducidadNotifySyncBarUi();
            return;
        }

        userLicCaducidadNotifyPrefsWrite(true, Number(sel.value) || 5);
        chk.checked = true;
        sel.disabled = false;
        userLicCaducidadNotifyStartTimer();
        userLicCaducidadNotifyRunCheck();

        var hintOn = userLicCaducidadNotifyEnabledHint();
        userLicCaducidadNotifySetHint(hintOn.text, hintOn.kind);

        if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
            return;
        }
        if (!userLicCaducidadNotifyPrefsRead().push) {
            return;
        }

        userLicCaducidadNotifyRequestPermission()
            .then(function () {
                var hintAfter = userLicCaducidadNotifyEnabledHint();
                userLicCaducidadNotifySetHint(hintAfter.text, hintAfter.kind);
                userLicCaducidadNotifyRunCheck();
            })
            .catch(function () {
                var hintErr = userLicCaducidadNotifyEnabledHint();
                userLicCaducidadNotifySetHint(hintErr.text, hintErr.kind);
            });
    }

    function wireUserLicCaducidadNotifyBar() {
        var bar = document.getElementById('userLicCaducidadNotifyBar');
        if (!bar) return;

        if (!userLicCaducidadNotifyBarWired) {
            userLicCaducidadNotifyBarWired = true;

            var embedded = userLicNotifyPrefsFromEmbedded();
            if (embedded) {
                userLicNotifyPrefsApplyServer(embedded);
            } else {
                // Migrar localStorage → BD una sola vez si no hay JSON embebido
                try {
                    var rawEnabled = localStorage.getItem(userLicCaducidadNotifyLsKey('enabled'));
                    var rawFrom = localStorage.getItem(userLicCaducidadNotifyLsKey('from_days'));
                    if (rawEnabled === '1' || rawEnabled === 'true') {
                        userLicCaducidadNotifyPrefsMem.enabled = true;
                    }
                    var nFrom = rawFrom != null ? Number(rawFrom) : NaN;
                    if (Number.isFinite(nFrom) && nFrom >= 1 && nFrom <= 5) {
                        userLicCaducidadNotifyPrefsMem.fromDays = Math.trunc(nFrom);
                    }
                } catch (_mig) {}
            }

            var chkWire = document.getElementById('userLicCaducidadNotifyEnabled');
            if (chkWire) {
                chkWire.addEventListener('change', function () {
                    userLicCaducidadNotifyOnEnabledChange(!!chkWire.checked);
                });
            }

            bar.addEventListener('change', function (ev) {
                var t = ev.target;
                if (!t || !bar.contains(t)) return;
                if (t.id === 'userLicCaducidadNotifyEnabled') {
                    return;
                }
                if (t.id === 'userLicCaducidadNotifyFromDays') {
                    var prefs = userLicCaducidadNotifyPrefsRead();
                    userLicCaducidadNotifyPrefsWrite(prefs.enabled, Number(t.value) || 5);
                    if (prefs.enabled) userLicCaducidadNotifyRunCheck();
                    return;
                }
                if (
                    t.id === 'userLicNotifyEmailEnabled' ||
                    t.id === 'userLicNotifyPushEnabled' ||
                    t.id === 'userLicNotifyInappEnabled' ||
                    t.id === 'userLicNotifyVibrateEnabled' ||
                    t.id === 'userLicNotifySoundEnabled'
                ) {
                    if (t.id === 'userLicNotifyEmailEnabled') {
                        userLicCaducidadNotifyPrefsMem.email = !!t.checked;
                    } else if (t.id === 'userLicNotifyPushEnabled') {
                        userLicCaducidadNotifyPrefsMem.push = !!t.checked;
                    } else if (t.id === 'userLicNotifyInappEnabled') {
                        userLicCaducidadNotifyPrefsMem.inapp = !!t.checked;
                    } else if (t.id === 'userLicNotifyVibrateEnabled') {
                        userLicCaducidadNotifyPrefsMem.vibrate = !!t.checked;
                    } else {
                        userLicCaducidadNotifyPrefsMem.sound = !!t.checked;
                    }
                    userLicNotifyPrefsSaveToServer(userLicNotifyPrefsCollectFromDom());
                    userLicCaducidadNotifySyncBarUi();
                }
            });

            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') {
                    userLicCaducidadNotifyRunCheck();
                }
            });

            // Refrescar prefs desde API (sincroniza con admin)
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
                    if (data && data.success && data.prefs) {
                        userLicNotifyPrefsApplyServer(data.prefs);
                        userLicCaducidadNotifySyncBarUi();
                        var prefsBoot = userLicCaducidadNotifyPrefsRead();
                        if (prefsBoot.enabled) {
                            userLicCaducidadNotifyStartTimer();
                            userLicCaducidadNotifyRunCheck();
                        } else {
                            userLicCaducidadNotifyStopTimer();
                        }
                    }
                })
                .catch(function () {});

            var prefsBoot = userLicCaducidadNotifyPrefsRead();
            if (prefsBoot.enabled) {
                userLicCaducidadNotifyStartTimer();
                userLicCaducidadNotifyRunCheck();
            }
        }

        userLicCaducidadNotifySyncBarUi();
    }

    function renderVencimientosPortalView(accounts) {
        var buckets = buildVencimientoBuckets(
            accounts,
            USER_LIC_CADUCIDAD_VIEW_MAX_DAYS,
            userLicPortalColombiaClock
        );
        var sectionsHtml = '';
        var firstOpenDay = null;
        var dleft;

        for (dleft = USER_LIC_CADUCIDAD_VIEW_MAX_DAYS; dleft >= 1; dleft -= 1) {
            var pairs = buckets[dleft] ? buckets[dleft].slice() : [];
            if (dleft === 1 && buckets[0] && buckets[0].length) {
                pairs = pairs.concat(buckets[0]);
            }
            if (pairs.length && firstOpenDay == null) {
                firstOpenDay = dleft;
            }
            sectionsHtml += renderDaySectionPairs(
                dleft,
                pairs,
                'venc_d' + dleft,
                'venc',
                false,
                {
                    extraSectionClass: 'user-lic-vencimiento-day',
                    dataUserDay: 'venc-' + dleft,
                    titleInnerHtml: vencimientoSectionTitleHtml(dleft),
                    showDaysToolbar: dleft === USER_LIC_CADUCIDAD_VIEW_MAX_DAYS,
                    caducidadMode: true,
                }
            );
        }

        var filt = aggregateSearchFilterTokens(accounts);
        var scrollDay = firstOpenDay != null ? firstOpenDay : USER_LIC_CADUCIDAD_VIEW_MAX_DAYS;

        return (
            '<article class="user-lic-account-sheet user-lic-account-sheet--vencimientos"' +
            ' data-search-filter="' +
            escHtml(filt) +
            '"' +
            ' data-license-id="vencimientos"' +
            ' data-default-scroll-day="venc-' +
            scrollDay +
            '">' +
            '<div class="license-notepads-wrap user-lic-bundle-wrap user-lic-vencimientos-wrap">' +
            sectionsHtml +
            '</div></article>'
        );
    }

    function buildUserLicenciasNormalSheetsHtml(accounts) {
        if (!accounts.length) {
            return (
                '<p class="text-center user-licencias-empty py-4 mb-0" role="status">Aún no tienes cuentas asignadas. Si ya compraste, espera la asignación o contacta soporte.</p>'
            );
        }
        var buckets = partitionAccountsByGridFilterKey(accounts);
        var gridKeys = sortedGridKeysFromBuckets(buckets);
        var sheetsParts = [];
        sheetsParts.push(renderMergedAllAccountsSheet(accounts));
        var gi;
        for (gi = 0; gi < gridKeys.length; gi += 1) {
            var gk = gridKeys[gi];
            var grp = buckets[gk];
            if (grp.length === 1) {
                sheetsParts.push(renderAccountBlock(grp[0]));
            } else {
                sheetsParts.push(renderMergedProductGroupSheet(grp, gk));
            }
        }
        if (userLicPortalProveedorEnabled) {
            sheetsParts.push(renderProveedorInventorySheet());
        }
        return '<div class="user-lic-all-accounts">' + sheetsParts.join('') + '</div>';
    }

    function buildUserLicenciasPortalSheetsHtml(accounts) {
        if (!accounts.length && !userLicPortalProveedorEnabled) {
            return (
                '<p class="text-center user-licencias-empty py-4 mb-0" role="status">Aún no tienes cuentas asignadas. Si ya compraste, espera la asignación o contacta soporte.</p>'
            );
        }
        if (!accounts.length && userLicPortalProveedorEnabled) {
            return renderProveedorInventorySheet();
        }
        return buildUserLicenciasNormalSheetsHtml(accounts);
    }

    function userLicPortalCaptureDaySectionsFromDom(outer) {
        if (!outer) return;
        outer.querySelectorAll('.user-lic-account-sheet').forEach(function (article) {
            article.querySelectorAll('.user-lic-readonly-day[data-user-day]').forEach(function (sec) {
                var day = sec.getAttribute('data-user-day');
                if (day == null || day === '') return;
                userLicPortalPersistDayCollapsed(article, day, sec.classList.contains('collapsed'));
            });
        });
    }

    function userLicPortalCanApplyPortalRevRefresh() {
        if (userLicPortalIsProveedorDirty()) return false;
        if (userLicPortalRowSavesInFlight > 0) return false;
        if (userLicPortalRowAutosaveHasPending && userLicPortalRowAutosaveHasPending()) return false;
        var ae = document.activeElement;
        if (ae && ae.closest && ae.closest('.user-lic-license-row-edit')) return false;
        return true;
    }

    function userLicPortalTryCatchUpRevRefresh() {
        if (!userLicPortalDeferredRev || !userLicPortalPollContext) return;
        if (!userLicPortalCanApplyPortalRevRefresh()) return;
        var rev = userLicPortalDeferredRev;
        var ctx = userLicPortalPollContext;
        userLicPortalDeferredRev = null;
        refreshUserLicPortalIfRevChanged(rev, ctx);
    }

    function rebuildUserLicPortalMainContent(outer, host, gridInner, gridHostEl, persistUi, forceRebuild) {
        if (!forceRebuild && userLicPortalIsProveedorDirty()) return;
        if (userLicPortalRowAutosaveFlush) userLicPortalRowAutosaveFlush();
        userLicPortalCaptureDaySectionsFromDom(outer);
        var accounts = userLicPortalAccountsCache || [];
        var effFilter =
            persistUi && persistUi.filter != null
                ? String(persistUi.filter)
                : readPersistedUserLicPortalServiceFilter(gridHostEl);
        effFilter = normalizePortalServiceFilterKey(effFilter);

        if (!accounts.length && !userLicPortalProveedorEnabled) {
            outer.innerHTML =
                '<p class="text-center user-licencias-empty py-4 mb-0" role="status">Aún no tienes cuentas asignadas. Si ya compraste, espera la asignación o contacta soporte.</p>';
        } else if (userLicPortalVencimientosActive) {
            outer.innerHTML = renderVencimientosPortalView(accounts);
            outer.dataset.userLicActiveFilter = 'vencimientos';
            delete outer.dataset.userLicCaducidadServiceFilter;
        } else {
            outer.innerHTML = buildUserLicenciasPortalSheetsHtml(accounts);
            outer.dataset.userLicActiveFilter = effFilter;
            delete outer.dataset.userLicCaducidadServiceFilter;
        }

        initEditableLicenseRowsIn(outer);
        userLicPortalApplyColumnVisibility(outer);
        userLicPortalRestoreDaySectionsAndToolbars(outer);
        userLicPortalWireProveedorEditors(outer);
        userLicPortalApplyViewOnlyUi(outer);

        if (userLicPortalVencimientosActive) {
            syncServiceFilterGridCards(gridHostEl, null, true);
        } else {
            applyLicenseFilter(outer, gridHostEl, effFilter, false, true);
        }
        if (persistUi && persistUi.search != null) {
            var inpS = document.getElementById('userLicenciasSearch');
            if (inpS) inpS.value = persistUi.search;
        }
        refreshSheetVisibility(outer);
        userLicCaducidadSyncShellLayoutClass();
        userLicCaducidadNotifySyncBarVisibility();
        userLicCaducidadNotifyRunCheck();
        if (effFilter === USER_LIC_PORTAL_REPORTES_FILTER) {
            userLicPortalSetReportesMode(true, outer);
            userLicRenderReportesPanel(outer);
        } else {
            userLicPortalSetReportesMode(false, outer);
        }
        if (userLicPortalSoporteLicenciasEnabled) {
            wireUserLicVerificarPanel(outer);
            userLicVerificarSyncCardState();
        }
        if (effFilter === USER_LIC_PORTAL_VERIFICAR_FILTER) {
            userLicPortalSetVerificarMode(true, outer);
            void userLicVerificarFetchFromServer();
        } else {
            userLicPortalSetVerificarMode(false, outer);
            if (userLicPortalSoporteLicenciasEnabled) {
                void userLicVerificarFetchFromServer();
            }
        }
        userLicRefreshReportesUi(outer);
    }

    function wireUserLicVencimientosButton(outer, host, gridInner, gridHostEl) {
        var btn = document.getElementById('btnUserLicVencimientos');
        if (!btn || btn.getAttribute('data-venc-wired') === '1') return;
        btn.setAttribute('data-venc-wired', '1');
        btn.addEventListener('click', function () {
            var entering = !userLicPortalVencimientosActive;
            userLicPortalVencimientosActive = entering;
            setCaducidadToolbarActive(entering);
            var doRebuild = function (forceRebuild) {
                rebuildUserLicPortalMainContent(
                    outer,
                    host,
                    gridInner,
                    gridHostEl,
                    entering ? { filter: 'all' } : null,
                    forceRebuild
                );
            };
            if (userLicPortalProveedorDirty) {
                userLicPortalFlushProveedorSave(outer, outer.getAttribute('data-proveedor-url') || '').finally(
                    function () {
                        doRebuild(true);
                    }
                );
            } else {
                doRebuild(false);
            }
            userLicCaducidadNotifySyncBarVisibility();
        });
    }

    function aggregatePreferredScrollDay(accounts) {
        var best = 31;
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            var d = accountPreferredScrollDay(accounts[i]);
            if (d < best) best = d;
        }
        return best >= 1 && best <= 31 ? best : 1;
    }

    function userLicRowSignalClassFromRow(row) {
        if (userLicRowIsBuena(row)) return 'user-lic-row--signal-buena';
        if (userLicRowIsGarantia(row)) return 'user-lic-row--signal-garantia';
        if (userLicRowIsWarrantyPending(row)) return 'user-lic-row--signal-pendiente-garantia';
        if (userLicRowIsReporte(row)) return 'user-lic-row--signal-reportes';
        return '';
    }

    function userLicRowSignalStripeColorFromRow(row) {
        if (userLicRowIsBuena(row) || userLicRowIsGarantia(row)) return 'rgba(22, 101, 52, 0.78)';
        if (userLicRowIsWarrantyPending(row)) return 'rgba(180, 83, 9, 0.85)';
        if (userLicRowIsReporte(row)) return 'rgba(153, 27, 27, 0.78)';
        return '';
    }

    function userLicRowSignalClassFromDom(rowEl) {
        if (!rowEl) return '';
        if (
            rowEl.querySelector(
                '.user-lic-buena-revisada-badge, .user-lic-garantia-entregada-badge'
            )
        ) {
            return 'user-lic-row--signal-buena';
        }
        if (rowEl.querySelector('.user-lic-garantia-badge')) return 'user-lic-row--signal-garantia';
        if (rowEl.querySelector('.user-lic-warranty-pending-badge')) {
            return 'user-lic-row--signal-pendiente-garantia';
        }
        var sgEl = rowEl.querySelector('select.license-split-editor__status-good');
        var sgVal = sgEl ? String(sgEl.value != null ? sgEl.value : '').trim() : '';
        if (sgVal && normalizeStatusKey(sgVal) === normalizeStatusKey('garantia')) {
            return 'user-lic-row--signal-garantia';
        }
        var sbEl = rowEl.querySelector('select.license-split-editor__status-bad');
        var sbVal = sbEl ? String(sbEl.value != null ? sbEl.value : '').trim() : '';
        if (sbVal && sbVal.indexOf('__prev_good:') !== 0) return 'user-lic-row--signal-reportes';
        return '';
    }

    function userLicRowSignalStripeColorFromDom(rowEl) {
        var cls = userLicRowSignalClassFromDom(rowEl);
        if (cls === 'user-lic-row--signal-buena' || cls === 'user-lic-row--signal-garantia') {
            return 'rgba(22, 101, 52, 0.78)';
        }
        if (cls === 'user-lic-row--signal-pendiente-garantia') return 'rgba(180, 83, 9, 0.85)';
        if (cls === 'user-lic-row--signal-reportes') return 'rgba(153, 27, 27, 0.78)';
        return '';
    }

    function userLicSyncRowSignalClasses(rowEl, rowDataOptional) {
        if (!rowEl) return;
        rowEl.classList.remove(
            'user-lic-row--signal-reportes',
            'user-lic-row--signal-buena',
            'user-lic-row--signal-garantia',
            'user-lic-row--signal-pendiente-garantia'
        );
        var cls = rowDataOptional
            ? userLicRowSignalClassFromRow(rowDataOptional)
            : userLicRowSignalClassFromDom(rowEl);
        if (cls) rowEl.classList.add(cls);
    }

    function userLicSyncDayBundleCredsStripes(splitRoot) {
        var ta = splitRoot && splitRoot.querySelector('.user-lic-creds-ro');
        if (!ta) return;
        var base =
            'linear-gradient(to top, #000000 0, #000000 calc(var(--lic-border-w) + 2px), transparent calc(var(--lic-border-w) + 2px))';
        var repeat =
            'repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--lic-row-stride) - var(--lic-border-w)), rgba(59, 130, 246, 0.48) calc(var(--lic-row-stride) - var(--lic-border-w)), rgba(59, 130, 246, 0.48) var(--lic-row-stride))';
        var layers = [];
        var rows = splitRoot.querySelectorAll('.user-lic-license-row-edit');
        var i;
        for (i = 0; i < rows.length; i += 1) {
            var col = userLicRowSignalStripeColorFromDom(rows[i]);
            if (!col) continue;
            layers.push(
                'linear-gradient(to bottom, transparent calc(' +
                    i +
                    ' * var(--lic-row-stride)), ' +
                    col +
                    ' calc(' +
                    i +
                    ' * var(--lic-row-stride)), ' +
                    col +
                    ' calc((' +
                    i +
                    ' + 1) * var(--lic-row-stride)), transparent calc((' +
                    i +
                    ' + 1) * var(--lic-row-stride)))'
            );
        }
        layers.push(base, repeat);
        ta.style.backgroundImage = layers.join(', ');
    }

    function userLicSyncDayBundleLineSignals(section) {
        if (!section) return;
        var splitRoot = section.querySelector('.day-license-split-root');
        section.querySelectorAll('.user-lic-license-row-edit').forEach(function (rowEl) {
            userLicSyncRowSignalClasses(rowEl);
        });
        userLicSyncDayBundleCredsStripes(splitRoot);
    }

    function userLicRowIsGarantia(row) {
        if (!row) return false;
        return normalizeStatusKey(row.status_good || '') === normalizeStatusKey('garantia');
    }

    function userLicRowIsWarrantyPending(row) {
        return !!(row && row.warranty_pending === true);
    }

    function userLicRowIsBuena(row) {
        if (!row || userLicRowIsGarantia(row) || userLicRowIsWarrantyPending(row)) return false;
        if (row.warranty_entregada === true) return true;
        if (row.buena_revisada_readonly === true) return true;
        return normalizeStatusKey(row.status_good || '') === normalizeStatusKey('ok');
    }

    function userLicRowIsReporte(row) {
        if (
            !row ||
            userLicRowIsBuena(row) ||
            userLicRowIsGarantia(row) ||
            userLicRowIsWarrantyPending(row) ||
            row.solucionada === true
        ) {
            return false;
        }
        if (row.tier_bad === 'bad') return true;
        var sb = String(row.status_bad != null ? row.status_bad : '').trim();
        if (
            !sb ||
            sb.indexOf('__prev_good:') === 0 ||
            sb.indexOf('__') === 0 ||
            normalizeStatusKey(sb) === normalizeStatusKey('solucionada')
        ) {
            return false;
        }
        return normalizeStatusKey(sb) !== '';
    }

    function userLicCountDayStatusSignals(pairs) {
        var nReportes = 0;
        var nBuena = 0;
        var nGarantia = 0;
        var nPendGar = 0;
        (pairs || []).forEach(function (p) {
            var row = p && p.row;
            if (userLicRowIsBuena(row)) {
                nBuena += 1;
            } else if (userLicRowIsGarantia(row)) {
                nGarantia += 1;
            } else if (userLicRowIsWarrantyPending(row)) {
                nPendGar += 1;
            } else if (userLicRowIsReporte(row)) {
                nReportes += 1;
            }
        });
        return { reportes: nReportes, buena: nBuena, garantia: nGarantia, pendienteGarantia: nPendGar };
    }

    function userLicDayStatusBadgesHtml(counts) {
        if (!counts) return '';
        var parts = [];
        if (counts.reportes > 0) {
            parts.push(
                '<span class="user-lic-day-cnt-badge user-lic-day-cnt-badge--reportes" role="status" aria-live="polite">reportes ' +
                    String(counts.reportes) +
                    '</span>'
            );
        }
        if (counts.pendienteGarantia > 0) {
            parts.push(
                '<span class="user-lic-day-cnt-badge user-lic-day-cnt-badge--pendiente-garantia" role="status" aria-live="polite">pendiente ' +
                    String(counts.pendienteGarantia) +
                    '</span>'
            );
        }
        if (counts.garantia > 0) {
            parts.push(
                '<span class="user-lic-day-cnt-badge user-lic-day-cnt-badge--garantia" role="status" aria-live="polite">garantía ' +
                    String(counts.garantia) +
                    '</span>'
            );
        }
        if (counts.buena > 0) {
            parts.push(
                '<span class="user-lic-day-cnt-badge user-lic-day-cnt-badge--buena" role="status" aria-live="polite">buena ' +
                    String(counts.buena) +
                    '</span>'
            );
        }
        if (!parts.length) return '';
        return '<span class="user-lic-day-status-cnt-wrap">' + parts.join('') + '</span>';
    }

    function userLicCountFromDaySectionEl(section) {
        var nReportes = 0;
        var nBuena = 0;
        var nGarantia = 0;
        var nPendGar = 0;
        if (!section) return { reportes: 0, buena: 0, garantia: 0, pendienteGarantia: 0 };
        section.querySelectorAll('.user-lic-license-row-edit').forEach(function (row) {
            if (row.querySelector('.user-lic-buena-revisada-badge')) {
                nBuena += 1;
                return;
            }
            if (row.querySelector('.user-lic-garantia-badge')) {
                nGarantia += 1;
                return;
            }
            if (row.querySelector('.user-lic-warranty-pending-badge')) {
                nPendGar += 1;
                return;
            }
            var sgEl = row.querySelector('select.license-split-editor__status-good');
            var sgVal = sgEl ? String(sgEl.value != null ? sgEl.value : '').trim() : '';
            if (sgVal && normalizeStatusKey(sgVal) === normalizeStatusKey('garantia')) {
                nGarantia += 1;
                return;
            }
            var sbEl = row.querySelector('select.license-split-editor__status-bad');
            var sbVal = sbEl ? String(sbEl.value != null ? sbEl.value : '').trim() : '';
            if (sbVal && sbVal.indexOf('__') !== 0) {
                nReportes += 1;
            }
        });
        return {
            reportes: nReportes,
            buena: nBuena,
            garantia: nGarantia,
            pendienteGarantia: nPendGar,
        };
    }

    function userLicSyncDaySectionSignalClasses(section, counts) {
        if (!section) return;
        section.classList.remove(
            'user-lic-day--signal-reportes',
            'user-lic-day--signal-buena',
            'user-lic-day--signal-garantia',
            'user-lic-day--signal-pendiente-garantia'
        );
        if (!counts) return;
        if (counts.reportes > 0) {
            section.classList.add('user-lic-day--signal-reportes');
        } else if (counts.pendienteGarantia > 0) {
            section.classList.add('user-lic-day--signal-pendiente-garantia');
        } else if (counts.garantia > 0 || counts.buena > 0) {
            section.classList.add('user-lic-day--signal-buena');
        }
    }

    function userLicRefreshDayHeaderStatusBadgesFromSection(section) {
        if (!section) return;
        var header = section.querySelector('.user-lic-day-header-actions');
        if (!header) return;
        var counts = userLicCountFromDaySectionEl(section);
        userLicSyncDaySectionSignalClasses(section, counts);
        userLicSyncDayBundleLineSignals(section);
        var existing = header.querySelector('.user-lic-day-status-cnt-wrap');
        var html = userLicDayStatusBadgesHtml(counts);
        if (!html) {
            if (existing) existing.remove();
            return;
        }
        if (existing) {
            existing.outerHTML = html;
            return;
        }
        var acctBadge = header.querySelector('.day-account-badge');
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var wrap = tmp.firstElementChild;
        if (!wrap) return;
        if (acctBadge) {
            header.insertBefore(wrap, acctBadge);
        } else {
            header.appendChild(wrap);
        }
    }

    function userLicRefreshAllDayHeaderStatusBadges(rootEl) {
        if (!rootEl || !rootEl.querySelectorAll) return;
        rootEl.querySelectorAll('.day-section.user-lic-readonly-day').forEach(function (sec) {
            userLicRefreshDayHeaderStatusBadgesFromSection(sec);
        });
    }

    /** Pares { row, lm } por fila; credFieldSlug fija el id del textarea de credenciales del día. */
    function renderDaySectionPairs(day, pairs, credFieldSlug, domScopeSeg, showFullCredTrigger, sectionOpts) {
        sectionOpts = sectionOpts && typeof sectionOpts === 'object' ? sectionOpts : {};
        var list = pairs || [];
        var n = list.length;
        var credParts = [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            credParts.push(list[i].row.cred != null ? String(list[i].row.cred) : '');
        }
        var credsJoined = credParts.join('\n');
        var rowLines =
            n > 0
                ? list
                      .map(function (p, idx) {
                          var rowDay =
                              p.saleDay != null && Number.isFinite(Number(p.saleDay))
                                  ? Number(p.saleDay)
                                  : day;
                          return renderEditableLicenseRow(
                              p.row,
                              rowDay,
                              idx,
                              p.lm || {},
                              idx,
                              domScopeSeg,
                              !!showFullCredTrigger
                          );
                      })
                      .join('')
                : '';
        var ra = Math.max(1, credParts.length || 1);

        var isCollapsed = n === 0;
        var collapsedClass = isCollapsed ? ' collapsed' : '';
        var slug = slugForCredFieldId(credFieldSlug);
        var scopeSeg = slugForCredFieldId(domScopeSeg || 'x');
        var taIdName = 'user-lic-creds-' + slug + '-' + scopeSeg + '-d' + String(day);
        var badgeTitle = n === 1 ? '1 cuenta' : n + ' cuentas';
        /* Portal usuario: el contador solo se muestra cuando el día tiene licencias (en admin sí sale siempre). */
        var badgeHtml =
            n > 0
                ? '<span class="day-account-badge admin-licencias-notepad-line-badge" title="' +
                  escAttr(badgeTitle) +
                  '">' +
                  String(n) +
                  '</span>'
                : '';

        var daySignals = userLicCountDayStatusSignals(list);
        var statusBadgesHtml = sectionOpts.caducidadMode ? '' : userLicDayStatusBadgesHtml(daySignals);
        var daySignalClass = sectionOpts.caducidadMode
            ? ''
            : daySignals.reportes > 0
              ? ' user-lic-day--signal-reportes'
              : daySignals.pendienteGarantia > 0
                ? ' user-lic-day--signal-pendiente-garantia'
                : daySignals.garantia > 0 || daySignals.buena > 0
                  ? ' user-lic-day--signal-buena'
                  : '';

        var caducidadToolbar = !!sectionOpts.caducidadMode;
        var toolbarHtml = sectionOpts.showDaysToolbar
            ? renderUserLicDaysToolbarHtml(caducidadToolbar)
            : day === 1
              ? renderUserLicDaysToolbarHtml(caducidadToolbar)
              : '';

        var extraSectionClass = sectionOpts.extraSectionClass
            ? ' ' + String(sectionOpts.extraSectionClass)
            : '';
        var dataUserDay =
            sectionOpts.dataUserDay != null && sectionOpts.dataUserDay !== ''
                ? String(sectionOpts.dataUserDay)
                : String(day);
        var titleInner =
            sectionOpts.titleInnerHtml != null
                ? sectionOpts.titleInnerHtml
                : '<i class="fas fa-calendar-day" aria-hidden="true"></i> <span>Día ' + day + '</span>';

        var headerActions;
        if (sectionOpts.caducidadMode) {
            var cadEndLeading = toolbarHtml;
            if (!cadEndLeading) {
                cadEndLeading =
                    '<span class="user-lic-day-section-chevron" aria-hidden="true">' +
                    '<i class="fas fa-chevron-up"></i></span>';
            }
            headerActions =
                '<div class="admin-licencias-bloc-header-actions user-lic-day-header-actions user-lic-day-header-actions--caducidad">' +
                '<div class="user-lic-caducidad-header-end">' +
                cadEndLeading +
                badgeHtml +
                '</div></div>';
        } else {
            headerActions =
                '<div class="admin-licencias-bloc-header-actions user-lic-day-header-actions">' +
                toolbarHtml +
                statusBadgesHtml +
                badgeHtml +
                '</div>';
        }

        return (
            '<section class="day-section admin-licencias-bloc admin-licencias-bloc--day user-lic-readonly-day' +
            extraSectionClass +
            collapsedClass +
            daySignalClass +
            '" data-user-day="' +
            escAttr(dataUserDay) +
            '">' +
            '<div class="day-section-header admin-licencias-bloc-header user-lic-day-header-toggle">' +
            '<span class="admin-licencias-bloc-title">' +
            titleInner +
            '</span>' +
            headerActions +
            '</div>' +
            '<div class="day-accounts-list">' +
            '<div class="license-split-editor license-split-editor--day day-license-split-root day-account-item license-notepad--locked user-lic-days-bundle' +
            (sectionOpts.caducidadMode ? ' user-lic-caducidad-split' : '') +
            '">' +
            '<div class="license-split-editor__viewport">' +
            '<div class="license-split-editor__grid">' +
            '<div class="license-split-editor__creds-cell' +
            (sectionOpts.caducidadMode ? ' user-lic-caducidad-creds-cell' : '') +
            '">' +
            (sectionOpts.caducidadMode
                ? '<div class="user-lic-caducidad-creds-lines" aria-hidden="true"></div>'
                : '') +
            '<textarea id="' +
            escAttr(taIdName) +
            '" name="' +
            escAttr(taIdName) +
            '" readonly class="admin-licencias-notepad-textarea license-split-editor__creds day-license-split__creds user-lic-creds-ro" rows="' +
            ra +
            '" spellcheck="false" wrap="off" autocomplete="off" aria-readonly="true">' +
            escTextarea(credsJoined) +
            '</textarea>' +
            '</div>' +
            '<div class="license-split-editor__side" aria-label="Estado, saldo y notas">' +
            '<div class="license-split-editor__rows day-license-split-rows" role="region">' +
            rowLines +
            '</div></div></div></div></div>' +
            '</div></section>'
        );
    }

    function renderDaySection(day, rows, credFieldSlug, licenseMeta, domScopeSeg) {
        var lm = licenseMeta || {};
        var pairs = (rows || []).map(function (r) {
            return { row: r, lm: lm };
        });
        return renderDaySectionPairs(day, pairs, credFieldSlug, domScopeSeg, false);
    }

    /** Barra: plegar todos + ojos (credenciales, incidencias+Otro, notas). Caducidad: solo flecha de plegar. */
    function renderUserLicDaysToolbarHtml(caducidadOnly) {
        var expandBtn =
            '<button type="button" class="admin-licencias-toggle-notes-col-btn admin-licencias-days-expand-all-btn user-lic-days-expand-all" title="Plegar todos los días" aria-label="Plegar todas las secciones de días" aria-expanded="true">' +
            '<i class="fas fa-chevron-up" aria-hidden="true"></i>' +
            '</button>';
        if (caducidadOnly) {
            return expandBtn;
        }
        return (
            expandBtn +
            '<button type="button" class="admin-licencias-toggle-notes-col-btn user-lic-days-toggle-bad" title="Ocultar columna incidencias (roja) y «Otro»" aria-label="Ocultar columna incidencias (roja) y detalle Otro" aria-pressed="false">' +
            '<i class="fas fa-eye-slash" aria-hidden="true"></i>' +
            '</button>' +
            '<button type="button" class="admin-licencias-toggle-notes-col-btn user-lic-days-toggle-notes" title="Ocultar columna Notas" aria-label="Ocultar columna Notas en cada día" aria-pressed="false">' +
            '<i class="fas fa-eye-slash" aria-hidden="true"></i>' +
            '</button>'
        );
    }

    var USER_LIC_PORTAL_HIDE_BAD_KEY = 'user_lic_portal_days_hide_bad_v1';
    var USER_LIC_PORTAL_HIDE_NOTES_KEY = 'user_lic_portal_days_hide_notes_v1';
    var USER_LIC_PORTAL_HIDE_CREDS_KEY = 'user_lic_portal_days_hide_creds_v1';
    var USER_LIC_PORTAL_HIDE_STATUS_LEGACY_KEY = 'user_lic_portal_days_hide_status_v1';
    /** Tarjeta activa («Todos», «p{id}», etc.) tras F5 / sondeo — misma idea que Producto seleccionado en admin. */
    var USER_LIC_PORTAL_SERVICE_FILTER_KEY = 'user_lic_portal_service_filter_v1';

    function userLicPortalMigrateLegacyColumnKeys() {
        try {
            var leg = localStorage.getItem(USER_LIC_PORTAL_HIDE_STATUS_LEGACY_KEY);
            if (leg === '1' || leg === 'true') {
                localStorage.setItem(USER_LIC_PORTAL_HIDE_BAD_KEY, '1');
                try {
                    localStorage.removeItem('user_lic_portal_days_hide_good_v1');
                } catch (eLegacyG) {
                    /* ignore */
                }
                localStorage.removeItem(USER_LIC_PORTAL_HIDE_STATUS_LEGACY_KEY);
            }
        } catch (eM) {
            /* ignore */
        }
    }

    function userLicPortalSheetStorageKey(articleEl) {
        if (!articleEl) return 'u0';
        var raw = articleEl.getAttribute('data-license-id');
        return raw != null && String(raw).trim() !== '' ? String(raw).trim() : 'u0';
    }

    /** Ámbito de persistencia (`data-licencias-persist-scope`); mismo criterio que en `licencias.js`. */
    function portalUiPersistScopeSlug() {
        try {
            var pel = document.querySelector('[data-licencias-persist-scope]');
            var praw = pel && pel.getAttribute('data-licencias-persist-scope');
            if (praw == null || String(praw).trim() === '') return 'anon';
            var ps = String(praw)
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 48);
            return ps || 'anon';
        } catch (_eSc) {
            return 'anon';
        }
    }

    function portalMainGridCollapsedStorageKeys() {
        var slug = portalUiPersistScopeSlug();
        return {
            scoped: 'licencias_ui_' + slug + '_lic_cards_row_collapsed',
            legacyAdmin: 'licenciasContainerCollapsed',
            legacyPortal: 'userLicenciasContainerCollapsed',
        };
    }

    function portalMainGridCollapsedRead() {
        var ks = portalMainGridCollapsedStorageKeys();
        try {
            var v = localStorage.getItem(ks.scoped);
            if (v == null || v === '') v = localStorage.getItem(ks.legacyAdmin);
            if (v == null || v === '') v = localStorage.getItem(ks.legacyPortal);
            if (v !== null && v !== '') {
                try {
                    localStorage.setItem(ks.scoped, v);
                } catch (_eMw) {}
            }
            return v;
        } catch (_eMr) {
            return null;
        }
    }

    function portalMainGridCollapsedWrite(collapsedBool) {
        var ks = portalMainGridCollapsedStorageKeys();
        try {
            localStorage.setItem(ks.scoped, collapsedBool ? 'true' : 'false');
        } catch (_eW) {}
    }

    function portalDayCollapsedStorageKeys(sheetKey, dayStr) {
        var slug = portalUiPersistScopeSlug();
        var enc =
            sheetKey == null ? 'x' : String(sheetKey).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 96);
        return {
            scoped: 'licencias_ui_' + slug + '_portal_day_' + enc + '_' + String(dayStr) + '_collapsed',
            legacy: 'userLicPortalDay_' + String(sheetKey).trim() + '_' + String(dayStr) + '_collapsed',
        };
    }

    function portalDayCollapsedRead(sheetKey, dayStr) {
        var kk = portalDayCollapsedStorageKeys(sheetKey, dayStr);
        try {
            var v2 = localStorage.getItem(kk.scoped);
            if (v2 == null || v2 === '') v2 = localStorage.getItem(kk.legacy);
            if (v2 !== null && v2 !== '') {
                try {
                    localStorage.setItem(kk.scoped, v2);
                } catch (_eM2) {}
            }
            return v2;
        } catch (_eR2) {
            return null;
        }
    }

    function userLicPortalHideBadRead() {
        try {
            var v = localStorage.getItem(USER_LIC_PORTAL_HIDE_BAD_KEY);
            return v === '1' || v === 'true';
        } catch (e0b) {
            return false;
        }
    }

    function userLicPortalHideNotesRead() {
        try {
            var v = localStorage.getItem(USER_LIC_PORTAL_HIDE_NOTES_KEY);
            if (v === '1' || v === 'true') return true;
            if (v === '0' || v === 'false') return false;
        } catch (e1) {
            /* ignore */
        }
        return true;
    }

    function userLicPortalToggleEyeButtonUi(btn, hidden, titleWhenHidden, labelWhenHidden, titleWhenShown, labelWhenShown) {
        if (!btn) return;
        var ic = btn.querySelector('i');
        if (hidden) {
            if (ic) ic.className = 'fas fa-eye';
            btn.title = titleWhenShown;
            btn.setAttribute('aria-label', labelWhenShown);
            btn.setAttribute('aria-pressed', 'true');
        } else {
            if (ic) ic.className = 'fas fa-eye-slash';
            btn.title = titleWhenHidden;
            btn.setAttribute('aria-label', labelWhenHidden);
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    function userLicPortalSyncAllColumnToolbars(outer) {
        if (!outer) return;
        var hidB = userLicPortalHideBadRead();
        var hidNt = userLicPortalHideNotesRead();
        /* El ojo de credenciales se retiró: la columna Licencias nunca se oculta. */
        outer.querySelectorAll('.user-lic-days-toggle-creds').forEach(function (b) {
            b.remove();
        });
        outer.querySelectorAll('.user-lic-days-toggle-bad').forEach(function (b) {
            userLicPortalToggleEyeButtonUi(
                b,
                hidB,
                'Ocultar columna incidencias (roja) y «Otro»',
                'Ocultar columna incidencias (roja) y detalle Otro',
                'Mostrar columna incidencias (roja) y «Otro»',
                'Mostrar columna incidencias (roja) y detalle Otro'
            );
        });
        outer.querySelectorAll('.user-lic-days-toggle-notes').forEach(function (b) {
            userLicPortalToggleEyeButtonUi(
                b,
                hidNt,
                'Ocultar columna Notas',
                'Ocultar columna Notas en cada día',
                'Mostrar columna Notas',
                'Mostrar columna Notas en cada día'
            );
        });
    }

    /** Igual que en admin: ancho en px de la línea más larga del textarea de credenciales. */
    function userLicMeasureCredsTaContentWidthPx(ta) {
        if (!ta || ta.tagName !== 'TEXTAREA') return 0;
        var cs = window.getComputedStyle(ta);
        var font =
            (cs.fontWeight || 'normal') + ' ' + (cs.fontSize || '14px') + ' ' + (cs.fontFamily || 'sans-serif');
        var raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
        var lines = raw.split('\n');
        var canvas =
            userLicMeasureCredsTaContentWidthPx.canvas ||
            (userLicMeasureCredsTaContentWidthPx.canvas = document.createElement('canvas'));
        var context = canvas.getContext('2d');
        context.font = font;
        var maxTextW = 0;
        var i;
        for (i = 0; i < lines.length; i += 1) {
            var line = String(lines[i]);
            if (line.trim() === '') continue;
            var w = context.measureText(line).width;
            if (w > maxTextW) maxTextW = w;
        }
        if (maxTextW <= 0) return 0;
        var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        var borderX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
        return Math.ceil(maxTextW + padX + borderX + 16);
    }

    /** Mismo diseño que el bloc Licencias de admin: la columna de credenciales queda fija al
        ancho de su contenido (px) y la columna derecha absorbe el hueco (CSS minmax(0,1fr));
        scroll horizontal solo cuando el contenido realmente no cabe. Solo blocs de licencias
        del portal (excluye editor de proveedor). */
    function userLicSyncCredsColumnWidthsFromContent() {
        document
            .querySelectorAll('.user-lic-bundle-wrap .day-license-split-root')
            .forEach(function (root) {
                if (root.closest('.user-lic-proveedor-wrap')) return;
                var grid = root.querySelector('.license-split-editor__grid');
                var cell = root.querySelector('.license-split-editor__creds-cell');
                var ta = root.querySelector('.license-split-editor__creds');
                if (cell) {
                    cell.style.removeProperty('min-width');
                    cell.style.removeProperty('width');
                    cell.style.removeProperty('max-width');
                }
                if (ta) {
                    ta.style.removeProperty('min-width');
                    ta.style.removeProperty('width');
                    ta.style.removeProperty('max-width');
                }
                if (!grid) return;
                if (!ta || root.classList.contains('user-lic-col-hide-creds')) {
                    grid.style.removeProperty('--lic-split-creds-col');
                    return;
                }
                var w = Math.max(72, userLicMeasureCredsTaContentWidthPx(ta) || 0);
                grid.style.setProperty('--lic-split-creds-col', w + 'px');
                if (cell) {
                    cell.style.setProperty('min-width', w + 'px', 'important');
                    cell.style.setProperty('width', '100%', 'important');
                }
                if (ta.getAttribute('wrap') !== 'off') {
                    ta.setAttribute('wrap', 'off');
                }
                ta.style.setProperty('min-width', w + 'px', 'important');
                ta.style.setProperty('width', '100%', 'important');
            });
        userLicSyncSaldoColumnWidthFromContent();
    }

    /** Columna Saldo uniforme en todos los blocs: ancho de la etiqueta más larga
        («Pagada», «Debe 92000», «A favor 5.5»…) medida con canvas. */
    function userLicSyncSaldoColumnWidthFromContent() {
        var spans = document.querySelectorAll(
            '.user-lic-bundle-wrap .license-split-editor__row.user-lic-readonly-row .license-split-editor__saldo-cell .user-lic-saldo-display'
        );
        var canvas =
            userLicMeasureCredsTaContentWidthPx.canvas ||
            (userLicMeasureCredsTaContentWidthPx.canvas = document.createElement('canvas'));
        var context = canvas.getContext('2d');
        var maxW = 0;
        spans.forEach(function (span) {
            var txt = String(span.textContent || '').trim();
            if (!txt) return;
            var cs = window.getComputedStyle(span);
            context.font =
                (cs.fontWeight || '700') + ' ' + (cs.fontSize || '12.5px') + ' ' + (cs.fontFamily || 'sans-serif');
            var w = context.measureText(txt).width;
            if (w > maxW) maxW = w;
        });
        var roots = document.querySelectorAll('.user-lic-bundle-wrap .day-license-split-root');
        if (maxW <= 0) {
            roots.forEach(function (root) {
                root.style.removeProperty('--user-lic-saldo-col');
            });
            return;
        }
        /* + padding lateral de la celda (0.16rem×2) + borde derecho + margen de seguridad */
        var colW = Math.ceil(maxW + 12);
        roots.forEach(function (root) {
            root.style.setProperty('--user-lic-saldo-col', colW + 'px');
        });
    }

    function userLicPortalApplyColumnVisibility(outer) {
        if (!outer) return;
        userLicPortalMigrateLegacyColumnKeys();
        try {
            localStorage.removeItem('user_lic_portal_days_hide_good_v1');
            /* El ojo de credenciales se retiró: limpiar preferencia guardada para que nunca oculte la columna. */
            localStorage.removeItem(USER_LIC_PORTAL_HIDE_CREDS_KEY);
        } catch (eClrG) {
            /* ignore */
        }
        var hidB = userLicPortalHideBadRead();
        var hidNt = userLicPortalHideNotesRead();
        outer.querySelectorAll('.user-lic-bundle-wrap .day-license-split-root.license-split-editor--day').forEach(function (root) {
            root.classList.remove('user-lic-col-hide-good');
            root.classList.remove('user-lic-col-hide-creds');
            root.classList.toggle('user-lic-col-hide-bad', hidB);
            root.classList.toggle('license-split-editor--notes-hidden', hidNt);
            root.classList.remove('license-split-editor--status-hidden');
        });
        userLicPortalSyncAllColumnToolbars(outer);
        userLicSyncCredsColumnWidthsFromContent();
    }

    function userLicPortalSyncExpandAllToolbar(bundleWrap) {
        var btn = bundleWrap ? bundleWrap.querySelector('.user-lic-days-expand-all') : null;
        if (!btn || !bundleWrap) return;
        var sections = bundleWrap.querySelectorAll('.user-lic-readonly-day[data-user-day]');
        if (!sections.length) return;
        var anyExpanded = false;
        var i;
        for (i = 0; i < sections.length; i += 1) {
            if (!sections[i].classList.contains('collapsed')) {
                anyExpanded = true;
                break;
            }
        }
        var icon = btn.querySelector('i');
        if (anyExpanded) {
            if (icon) icon.className = 'fas fa-chevron-up';
            btn.title = 'Plegar todos los días';
            btn.setAttribute('aria-label', 'Plegar todas las secciones de días');
            btn.setAttribute('aria-expanded', 'true');
        } else {
            if (icon) icon.className = 'fas fa-chevron-down';
            btn.title = 'Desplegar todos los días';
            btn.setAttribute('aria-label', 'Desplegar todas las secciones de días');
            btn.setAttribute('aria-expanded', 'false');
        }
    }

    function userLicPortalPersistDayCollapsed(article, dayStr, isCollapsed) {
        var sk = userLicPortalSheetStorageKey(article);
        var dk = portalDayCollapsedStorageKeys(sk, dayStr);
        try {
            localStorage.setItem(dk.scoped, isCollapsed ? 'true' : 'false');
        } catch (e2) {
            /* ignore */
        }
    }

    function userLicPortalToggleAllDaysInBundle(bundleWrap) {
        var article = bundleWrap ? bundleWrap.closest('.user-lic-account-sheet') : null;
        if (!bundleWrap || !article) return;
        var sections = bundleWrap.querySelectorAll('.user-lic-readonly-day[data-user-day]');
        if (!sections.length) return;
        var anyExpanded = false;
        var i;
        for (i = 0; i < sections.length; i += 1) {
            if (!sections[i].classList.contains('collapsed')) {
                anyExpanded = true;
                break;
            }
        }
        var collapseAll = anyExpanded;
        for (i = 0; i < sections.length; i += 1) {
            var sec = sections[i];
            var day = sec.getAttribute('data-user-day');
            if (day == null) continue;
            if (collapseAll) {
                sec.classList.add('collapsed');
            } else {
                sec.classList.remove('collapsed');
            }
            userLicPortalPersistDayCollapsed(article, day, collapseAll);
        }
        userLicPortalSyncExpandAllToolbar(bundleWrap);
    }

    function userLicPortalRestoreDaySectionsAndToolbars(outer) {
        if (!outer) return;
        outer.querySelectorAll('.user-lic-account-sheet').forEach(function (article) {
            var sk = userLicPortalSheetStorageKey(article);
            var bundleWrap = article.querySelector('.user-lic-bundle-wrap');
            if (!bundleWrap) return;
            bundleWrap.querySelectorAll('.user-lic-readonly-day[data-user-day]').forEach(function (sec) {
                var day = sec.getAttribute('data-user-day');
                if (day == null) return;
                var sv = portalDayCollapsedRead(sk, day);
                if (sv === 'true') sec.classList.add('collapsed');
                else if (sv === 'false') sec.classList.remove('collapsed');
                var hdr = sec.querySelector('.user-lic-day-header-toggle');
                if (hdr) {
                    hdr.setAttribute(
                        'aria-expanded',
                        sec.classList.contains('collapsed') ? 'false' : 'true'
                    );
                }
            });
            userLicPortalSyncExpandAllToolbar(bundleWrap);
        });
    }

    function wireUserLicDaysToolbar(outer) {
        if (!outer || outer.getAttribute('data-user-lic-days-toolbar') === '1') return;
        outer.setAttribute('data-user-lic-days-toolbar', '1');
        outer.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;

            var exp = t.closest('.user-lic-days-expand-all');
            if (exp && outer.contains(exp)) {
                var bw = exp.closest('.user-lic-bundle-wrap');
                if (bw && outer.contains(bw)) {
                    userLicPortalToggleAllDaysInBundle(bw);
                }
                return;
            }

            var bBtn = t.closest('.user-lic-days-toggle-bad');
            if (bBtn && outer.contains(bBtn)) {
                var nb = !userLicPortalHideBadRead();
                try {
                    localStorage.setItem(USER_LIC_PORTAL_HIDE_BAD_KEY, nb ? '1' : '0');
                } catch (eB) {
                    /* ignore */
                }
                userLicPortalApplyColumnVisibility(outer);
                return;
            }

            var ntBtn = t.closest('.user-lic-days-toggle-notes');
            if (ntBtn && outer.contains(ntBtn)) {
                var nextN = !userLicPortalHideNotesRead();
                try {
                    localStorage.setItem(USER_LIC_PORTAL_HIDE_NOTES_KEY, nextN ? '1' : '0');
                } catch (e4) {
                    /* ignore */
                }
                userLicPortalApplyColumnVisibility(outer);
            }
        });
    }

    function aggregateSearchFilterTokens(accounts) {
        var chunks = [];
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            var acc = accounts[i];
            var fk = licenseFilterKey(acc);
            var gfk = userLicPortalGridFilterKey(acc);
            chunks.push(
                (String(acc.product_name || '') +
                    ' ' +
                    String(acc.credential_preview || '') +
                    ' lic' +
                    fk +
                    ' gr' +
                    gfk +
                    ' ' +
                    String(acc.license_id != null ? acc.license_id : ''))
                    .toLowerCase()
                    .replace(/"/g, '')
            );
        }
        return chunks.join(' ');
    }

    /**
     * Vista «Todos»: un solo bloque Día 1–31 mezclando filas de todas las cuentas (misma moneda día = mismo encabezado).
     */
    function renderMergedAllAccountsSheet(accounts) {
        if (!accounts || accounts.length < 2) return '';

        var daysHtml = '';
        var d;
        for (d = 1; d <= 31; d += 1) {
            daysHtml += renderDaySectionPairs(
                d,
                pairsForMergedDay(accounts, d),
                'merged_all',
                userLicSheetDomScopeMerged(),
                true
            );
        }

        var filt = aggregateSearchFilterTokens(accounts);
        var scrollDayAgg = aggregatePreferredScrollDay(accounts);

        return (
            '<article class="user-lic-account-sheet user-lic-account-sheet--aggregate"' +
            ' data-search-filter="' +
            escHtml(filt) +
            '"' +
            ' data-account-id=""' +
            ' data-license-id="' +
            escAttr(USER_LIC_AGGREGATE_LICENSE_ID) +
            '" data-default-scroll-day="' +
            scrollDayAgg +
            '">' +
            '<div class="license-notepads-wrap user-lic-bundle-wrap">' +
            daysHtml +
            '</div>' +
            '</article>'
        );
    }

    /**
     * Varias cuentas del mismo servicio (`gridKey`): un solo bloque Día 1–31 con todas las filas.
     */
    function renderMergedProductGroupSheet(groupAccounts, gridKey) {
        if (!groupAccounts || groupAccounts.length < 2) return '';

        var slugGk = slugForCredFieldId(gridKey);
        var scopeCred = 'merged_prod_' + slugGk;
        var domScope = 'pm_' + slugGk;

        var daysHtml = '';
        var d;
        for (d = 1; d <= 31; d += 1) {
            daysHtml += renderDaySectionPairs(
                d,
                pairsForMergedDay(groupAccounts, d),
                scopeCred,
                domScope,
                true
            );
        }

        var filt = aggregateSearchFilterTokens(groupAccounts);
        var scrollDayAgg = aggregatePreferredScrollDay(groupAccounts);

        return (
            '<article class="user-lic-account-sheet user-lic-account-sheet--product-merge"' +
            ' data-search-filter="' +
            escHtml(filt) +
            '"' +
            ' data-account-id=""' +
            ' data-license-id="' +
            escAttr(gridKey) +
            '" data-default-scroll-day="' +
            scrollDayAgg +
            '">' +
            '<div class="license-notepads-wrap user-lic-bundle-wrap">' +
            daysHtml +
            '</div>' +
            '</article>'
        );
    }

    function partitionAccountsByGridFilterKey(accounts) {
        var buckets = {};
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            var acc = accounts[i];
            var k = userLicPortalGridFilterKey(acc);
            if (!buckets[k]) buckets[k] = [];
            buckets[k].push(acc);
        }
        return buckets;
    }

    function sortedGridKeysFromBuckets(buckets) {
        var keys = Object.keys(buckets);
        keys.sort(function (ka, kb) {
            var a0 = buckets[ka][0];
            var b0 = buckets[kb][0];
            var cmp = String(a0.product_name || '').toLowerCase().localeCompare(String(b0.product_name || '').toLowerCase());
            if (cmp !== 0) return cmp;
            return String(ka).localeCompare(String(kb));
        });
        return keys;
    }

    function renderAccountBlock(acc) {
        var dl = acc.day_lines || {};
        var d;
        var daysHtml = '';
        var gridFkey = userLicPortalGridFilterKey(acc);
        var fkey = licenseFilterKey(acc);
        var credSlug = fkey;
        var licenseMeta = licenseMetaFromAccount(acc);
        var sheetDomScope = userLicSheetDomScopeAccount(fkey);
        for (d = 1; d <= 31; d += 1) {
            daysHtml += renderDaySection(d, dl[String(d)] || [], credSlug, licenseMeta, sheetDomScope);
        }
        var filt =
            (String(acc.product_name || '') +
                ' ' +
                String(acc.credential_preview || '') +
                ' lic' +
                credSlug +
                ' gr' +
                gridFkey +
                ' ' +
                String(acc.license_id != null ? acc.license_id : ''))
                .toLowerCase()
                .replace(/"/g, '');
        var scrollDay = accountPreferredScrollDay(acc);

        var isVirtual = acc.virtual === true || acc.is_virtual === true;
        var accIdStr = acc.account_id != null ? String(acc.account_id) : '';

        return (
            '<article class="user-lic-account-sheet' +
            (isVirtual ? ' user-lic-account-sheet--virtual' : '') +
            '" data-search-filter="' +
            escHtml(filt) +
            '" data-account-id="' +
            escAttr(accIdStr) +
            '" data-license-id="' +
            escAttr(gridFkey) +
            '" data-month-to-month="' +
            (userLicPortalMonthToMonthChecked(acc) ? '1' : '0') +
            '" data-default-scroll-day="' +
            scrollDay +
            '">' +
            '<div class="license-notepads-wrap user-lic-bundle-wrap">' +
            daysHtml +
            '</div>' +
            '</article>'
        );
    }

    function userLicProveedorCountLines(text) {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter(function (ln) {
                return String(ln).trim() !== '';
            }).length;
    }

    function userLicProveedorCountStructuredLines(lines) {
        if (!Array.isArray(lines)) return 0;
        var n = 0;
        lines.forEach(function (entry) {
            if (entry && String(entry.cred || '').trim()) n += 1;
        });
        return n;
    }

    function userLicProveedorNormalizeServiceId(raw) {
        var s = String(raw != null ? raw : '')
            .trim()
            .toLowerCase();
        if (!s || s === PROVEEDOR_SERVICE_ANONIMO || s === 'anónimo' || s === 'anonymous') {
            return PROVEEDOR_SERVICE_ANONIMO;
        }
        return s;
    }

    function userLicProveedorDefaultCatalog() {
        return [{ id: PROVEEDOR_SERVICE_ANONIMO, name: 'Anónimo' }];
    }

    function userLicProveedorNormalizeExtraLineEntries(rawLines, legacyText) {
        if (Array.isArray(rawLines)) {
            var out = [];
            rawLines.forEach(function (item) {
                if (!item || typeof item !== 'object') return;
                var cred = String(item.cred || item.line || '').trim();
                if (!cred) return;
                var entry = {
                    service: userLicProveedorNormalizeServiceId(
                        item.service != null ? item.service : item.license_id
                    ),
                    cred: cred,
                };
                var rawDay = item.sale_day != null ? item.sale_day : item.day;
                if (rawDay != null && String(rawDay).trim() !== '' && String(rawDay).trim() !== '—') {
                    var d = parseInt(rawDay, 10);
                    if (Number.isFinite(d) && d >= 1 && d <= 31) entry.sale_day = d;
                }
                out.push(entry);
            });
            return out;
        }
        if (legacyText != null && String(legacyText).trim()) {
            return userLicProveedorLinesFromLegacyText(legacyText);
        }
        return [];
    }

    function userLicProveedorExtraRowsFromPersistedLines(lines, rowKind) {
        return (lines || []).map(function (entry) {
            return {
                product: userLicProveedorProductNameForService(entry && entry.service),
                cuenta: String((entry && entry.cred) || '—').trim() || '—',
                day: entry && entry.sale_day != null ? entry.sale_day : '—',
                status: rowKind === 'suspended' ? 'Caída' : 'Vencida',
                filterKey: USER_LIC_PORTAL_PROVEEDOR_FILTER,
                licenseId: entry && entry.service != null ? entry.service : '',
            };
        });
    }

    function userLicProveedorLinesFromLegacyText(text) {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter(function (ln) {
                return String(ln).trim() !== '';
            })
            .map(function (cred) {
                return { service: PROVEEDOR_SERVICE_ANONIMO, cred: cred };
            });
    }

    function userLicProveedorNormalizeLineEntries(rawLines, legacyText) {
        if (Array.isArray(rawLines)) {
            var out = [];
            rawLines.forEach(function (item) {
                if (!item || typeof item !== 'object') return;
                var cred = String(item.cred != null ? item.cred : item.line || '');
                if (!cred.trim()) return;
                out.push({
                    service: userLicProveedorNormalizeServiceId(
                        item.service != null ? item.service : item.license_id
                    ),
                    cred: cred,
                });
            });
            return out;
        }
        return userLicProveedorLinesFromLegacyText(legacyText);
    }

    function userLicProveedorNormalizeDayLinesMap(rawDayLines, legacyDayNotepads) {
        var out = {};
        var legacy = legacyDayNotepads && typeof legacyDayNotepads === 'object' ? legacyDayNotepads : {};
        var raw = rawDayLines && typeof rawDayLines === 'object' ? rawDayLines : {};
        var d;
        for (d = 1; d <= 31; d += 1) {
            var k = String(d);
            if (raw[k] != null) {
                out[k] = userLicProveedorNormalizeLineEntries(raw[k]);
            } else {
                out[k] = userLicProveedorLinesFromLegacyText(legacy[k]);
            }
        }
        return out;
    }

    function userLicProveedorLinesToCredsText(lines) {
        return (lines || [])
            .map(function (entry) {
                return String((entry && entry.cred) || '');
            })
            .join('\n');
    }

    function userLicProveedorIsAnonimoService(serviceId) {
        return userLicProveedorNormalizeServiceId(serviceId) === PROVEEDOR_SERVICE_ANONIMO;
    }

    function userLicProveedorProductNameForService(serviceId) {
        var catalog = userLicPortalProveedorCache.services_catalog || userLicProveedorDefaultCatalog();
        var sel = userLicProveedorNormalizeServiceId(serviceId);
        var i;
        for (i = 0; i < catalog.length; i += 1) {
            var item = catalog[i];
            if (!item) continue;
            if (String(item.id != null ? item.id : '') === sel) {
                return String(item.name != null ? item.name : item.id);
            }
        }
        return sel === PROVEEDOR_SERVICE_ANONIMO ? '—' : sel;
    }

    /** Texto de solo lectura (portal proveedor): producto · credencial, como en admin. */
    function userLicProveedorFormatLinesForDisplay(lines) {
        return (lines || [])
            .map(function (entry) {
                var cred = String((entry && entry.cred) || '').trim();
                if (!cred) return '';
                var svc = entry && entry.service;
                if (svc == null || svc === '' || userLicProveedorIsAnonimoService(svc)) {
                    return cred;
                }
                return userLicProveedorProductNameForService(svc) + ' · ' + cred;
            })
            .filter(Boolean)
            .join('\n');
    }

    function userLicProveedorBuildServiceSelectHtml(selectedId, rowIndex, blockKey, dayNum) {
        var catalog = userLicPortalProveedorCache.services_catalog || userLicProveedorDefaultCatalog();
        var sel = userLicProveedorNormalizeServiceId(selectedId);
        var opts = '';
        var i;
        for (i = 0; i < catalog.length; i += 1) {
            var item = catalog[i];
            if (!item) continue;
            var id = String(item.id != null ? item.id : '');
            var name = String(item.name != null ? item.name : id);
            opts +=
                '<option value="' +
                escAttr(id) +
                '"' +
                (id === sel ? ' selected' : '') +
                '>' +
                escHtml(name) +
                '</option>';
        }
        return (
            '<select id="userLicProvSvc_' +
            escAttr(blockKey) +
            '_' +
            escAttr(dayNum != null ? dayNum : 'lic') +
            '_' +
            String(rowIndex) +
            '" name="userLicProvSvc_' +
            escAttr(blockKey) +
            '_' +
            escAttr(dayNum != null ? dayNum : 'lic') +
            '_' +
            String(rowIndex) +
            '" class="license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-neutral user-lic-proveedor-service-select" data-proveedor-block="' +
            escAttr(blockKey) +
            '"' +
            (dayNum != null ? ' data-proveedor-day="' + escAttr(String(dayNum)) + '"' : '') +
            ' title="Servicio de esta licencia" aria-label="Servicio de la licencia">' +
            opts +
            '</select>'
        );
    }

    /** Colchón gar. oculto en UI; se reinyecta al guardar. */
    var userLicProveedorHiddenGarLines = [];

    function userLicProveedorPartitionLinesByGar(lines) {
        var list = Array.isArray(lines) ? lines.slice() : [];
        var bySvc = {};
        list.forEach(function (entry, idx) {
            if (!entry || !String(entry.cred || '').trim()) return;
            var svc = userLicProveedorNormalizeServiceId(
                entry.service != null ? entry.service : PROVEEDOR_SERVICE_ANONIMO
            );
            if (!bySvc[svc]) bySvc[svc] = [];
            bySvc[svc].push(idx);
        });
        var hide = Object.create(null);
        Object.keys(bySvc).forEach(function (svc) {
            if (svc === PROVEEDOR_SERVICE_ANONIMO || svc === 'anónimo' || svc === 'anonymous') {
                return;
            }
            var gar = 0;
            var item = (userLicProveedorProductsCache || []).find(function (p) {
                return String(p.license_id) === String(svc);
            });
            if (item) {
                gar = parseInt(userLicProveedorWarrantyUi(item.warranty_days), 10) || 0;
            }
            if (gar <= 0) return;
            var idxs = bySvc[svc];
            var hideN = Math.min(gar, idxs.length);
            var i;
            for (i = 0; i < hideN; i += 1) {
                hide[idxs[idxs.length - 1 - i]] = true;
            }
        });
        var visible = [];
        var hidden = [];
        list.forEach(function (entry, idx) {
            if (!entry || !String(entry.cred || '').trim()) return;
            var copy = {
                service: userLicProveedorNormalizeServiceId(
                    entry.service != null ? entry.service : PROVEEDOR_SERVICE_ANONIMO
                ),
                cred: entry.cred,
            };
            if (hide[idx]) hidden.push(copy);
            else visible.push(copy);
        });
        return { visible: visible, hidden: hidden };
    }

    function userLicProveedorLinesForBlock(blockKey, dayNum) {
        if (blockKey === 'license') {
            var all = userLicPortalProveedorCache.license_lines || [];
            var part = userLicProveedorPartitionLinesByGar(all);
            userLicProveedorHiddenGarLines = part.hidden;
            return part.visible;
        }
        var dl = userLicPortalProveedorCache.day_lines || {};
        var arr = dl[String(dayNum)];
        return Array.isArray(arr) ? arr : [];
    }

    function userLicProveedorParseLineHeightPx(cs) {
        var lh = cs.lineHeight;
        var fs = parseFloat(cs.fontSize) || 14;
        if (!lh || lh === 'normal') return fs * 1.45;
        if (String(lh).indexOf('px') !== -1) return parseFloat(lh) || fs * 1.45;
        var n = parseFloat(lh);
        return Number.isFinite(n) ? n * fs : fs * 1.45;
    }

    /** Iguala altura del textarea de credenciales con el panel de servicios (como admin Licencias). */
    function userLicProveedorAutosizeCredsForBlock(block) {
        if (!block) return;
        var ta = block.querySelector('.user-lic-proveedor-creds-ta');
        var rowsEl = block.querySelector('.user-lic-proveedor-service-rows');
        if (!ta || ta.tagName !== 'TEXTAREA' || !rowsEl) return;
        var raw = String(ta.value != null ? ta.value : '').replace(/\r\n/g, '\n');
        var credLines = raw.split('\n');
        var nEst = credLines.length === 0 ? 1 : credLines.length;
        var cs = window.getComputedStyle(ta);
        var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        var stridePx = userLicProveedorParseLineHeightPx(cs);
        var exactByLines = Math.ceil(stridePx * nEst + padY);

        void rowsEl.offsetHeight;
        var peerH = Math.max(rowsEl.offsetHeight, rowsEl.scrollHeight);
        var minPx = parseFloat(cs.minHeight);
        if (Number.isNaN(minPx)) minPx = stridePx;
        var h = Math.max(minPx, exactByLines, peerH);
        ta.style.height = Math.ceil(h) + 'px';
    }

    function userLicProveedorScheduleAutosizeCredsForBlock(block) {
        if (!block) return;
        userLicProveedorAutosizeCredsForBlock(block);
        window.requestAnimationFrame(function () {
            userLicProveedorAutosizeCredsForBlock(block);
            window.requestAnimationFrame(function () {
                userLicProveedorAutosizeCredsForBlock(block);
            });
        });
    }

    function userLicProveedorSyncServiceRowsForBlock(outer, blockKey, dayNum) {
        if (!outer) return;
        var blockSel =
            blockKey === 'license'
                ? '.user-lic-proveedor-split[data-proveedor-block="license"]'
                : '.user-lic-proveedor-split[data-proveedor-block="day"][data-proveedor-day="' +
                  String(dayNum) +
                  '"]';
        var block = outer.querySelector(blockSel);
        if (!block) return;
        var ta = block.querySelector('.user-lic-proveedor-creds-ta');
        var rowsWrap = block.querySelector('.user-lic-proveedor-service-rows');
        if (!ta || !rowsWrap) return;
        var credLines = String(ta.value || '')
            .replace(/\r\n/g, '\n')
            .split('\n');
        if (blockKey === 'day') {
            credLines = credLines.filter(function (ln) {
                return String(ln).trim() !== '';
            });
            if (credLines.length === 0) {
                rowsWrap.innerHTML = '';
                block.classList.add('user-lic-proveedor-day-empty');
                ta.style.height = '';
                return;
            }
            block.classList.remove('user-lic-proveedor-day-empty');
        }
        var cached = userLicProveedorLinesForBlock(blockKey, dayNum);
        var existing = [];
        rowsWrap.querySelectorAll('.user-lic-proveedor-service-select').forEach(function (sel, idx) {
            existing[idx] = sel.value;
        });
        var html = '';
        var idx;
        for (idx = 0; idx < credLines.length; idx += 1) {
            var svc =
                existing[idx] != null
                    ? existing[idx]
                    : cached[idx] && cached[idx].service != null
                      ? cached[idx].service
                      : PROVEEDOR_SERVICE_ANONIMO;
            html +=
                '<div class="license-split-editor__row user-lic-readonly-row user-lic-proveedor-service-row">' +
                '<div class="license-split-editor__status-wrap user-lic-proveedor-status-wrap">' +
                '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--bad user-lic-proveedor-service-shell">' +
                userLicProveedorBuildServiceSelectHtml(svc, idx, blockKey, dayNum) +
                '</div></div></div>';
        }
        rowsWrap.innerHTML = html;
        userLicEnsureFormFieldIdName(rowsWrap);
        userLicProveedorScheduleAutosizeCredsForBlock(block);
    }

    function userLicProveedorCollectLinesFromBlock(outer, blockKey, dayNum) {
        var blockSel =
            blockKey === 'license'
                ? '.user-lic-proveedor-split[data-proveedor-block="license"]'
                : '.user-lic-proveedor-split[data-proveedor-block="day"][data-proveedor-day="' +
                  String(dayNum) +
                  '"]';
        var block = outer ? outer.querySelector(blockSel) : null;
        if (!block) return [];
        var ta = block.querySelector('.user-lic-proveedor-creds-ta');
        var credLines = String((ta && ta.value) || '')
            .replace(/\r\n/g, '\n')
            .split('\n');
        var out = [];
        credLines.forEach(function (cred, idx) {
            var trimmed = String(cred).replace(/\s+$/g, '');
            if (!String(trimmed).trim()) return;
            var sel = block.querySelectorAll('.user-lic-proveedor-service-select')[idx];
            var service =
                sel && sel.value != null ? sel.value : PROVEEDOR_SERVICE_ANONIMO;
            out.push({
                service: userLicProveedorNormalizeServiceId(service),
                cred: trimmed,
            });
        });
        return out;
    }

    function userLicProveedorRenderEmptyDayBodyHtml(day) {
        var taId = 'userLicProvEmptyTa-d' + String(day);
        return (
            '<div class="user-lic-proveedor-day-empty-state license-split-editor license-split-editor--proveedor-readonly license-notepad--locked license-split-editor--day">' +
            '<div class="license-split-editor__viewport">' +
            '<div class="license-split-editor__grid user-lic-proveedor-readonly-grid--creds-only">' +
            '<div class="license-split-editor__creds-cell">' +
            '<textarea id="' +
            escAttr(taId) +
            '" name="' +
            escAttr(taId) +
            '" class="admin-licencias-notepad-textarea license-split-editor__creds user-lic-proveedor-readonly-creds user-lic-proveedor-day-empty-creds user-lic-creds-ro" readonly tabindex="-1" rows="1" wrap="off" spellcheck="false" aria-readonly="true" aria-label="Día ' +
            escAttr(String(day)) +
            ' sin licencias"></textarea>' +
            '</div></div></div></div>'
        );
    }

    function userLicProveedorRenderEditableSplitBlockHtml(blockKey, dayNum) {
        var lines = userLicProveedorLinesForBlock(blockKey, dayNum);
        var credText = userLicProveedorLinesToCredsText(lines);
        var nLines = Math.max(1, credText ? credText.split('\n').length : 1);
        var ariaLabel = blockKey === 'license' ? 'Licencias del proveedor' : 'Día ' + String(dayNum);
        var taId =
            'userLicProvCreds-' +
            slugForCredFieldId(blockKey) +
            '-' +
            (dayNum != null ? String(dayNum) : 'lic');
        return (
            '<div class="license-split-editor user-lic-proveedor-split user-lic-proveedor-split--editable" data-proveedor-block="' +
            escAttr(blockKey) +
            '"' +
            (blockKey === 'license' ? '' : ' data-proveedor-day="' + escAttr(String(dayNum)) + '"') +
            '>' +
            '<div class="license-split-editor__viewport">' +
            '<div class="license-split-editor__grid">' +
            '<div class="license-split-editor__creds-cell">' +
            '<textarea id="' +
            escAttr(taId) +
            '" name="' +
            escAttr(taId) +
            '" class="admin-licencias-notepad-textarea license-split-editor__creds user-lic-proveedor-creds-ta" rows="' +
            String(nLines) +
            '" spellcheck="true" wrap="off" autocomplete="off" aria-label="' +
            escAttr(ariaLabel) +
            '" placeholder="Correo y contraseña, una por línea.">' +
            escTextarea(credText) +
            '</textarea></div>' +
            '<div class="license-split-editor__side user-lic-proveedor-side" aria-label="Servicio por línea">' +
            '<div class="license-split-editor__rows user-lic-proveedor-service-rows"></div>' +
            '</div></div></div></div>'
        );
    }

    function userLicProveedorRenderSplitBlockHtml(blockKey, dayNum) {
        if (blockKey === 'license') {
            return userLicProveedorRenderEditableSplitBlockHtml('license', null);
        }
        var lines = userLicProveedorLinesForBlock(blockKey, dayNum);
        var nLines = userLicProveedorCountStructuredLines(lines);
        if (!nLines) {
            return '';
        }
        var credText = userLicProveedorFormatLinesForDisplay(lines);
        var ariaLabel = 'Día ' + String(dayNum) + ' del proveedor';
        var taId = 'userLicProvRo-' + slugForCredFieldId(blockKey) + '-d' + String(dayNum);
        return (
            '<div class="license-split-editor user-lic-proveedor-split license-split-editor--proveedor-readonly license-notepad--locked license-split-editor--day" data-proveedor-block="' +
            escAttr(blockKey) +
            '" data-proveedor-day="' +
            escAttr(String(dayNum)) +
            '">' +
            '<div class="license-split-editor__viewport">' +
            '<div class="license-split-editor__grid user-lic-proveedor-readonly-grid--creds-only">' +
            '<div class="license-split-editor__creds-cell">' +
            '<textarea id="' +
            escAttr(taId) +
            '" name="' +
            escAttr(taId) +
            '" class="admin-licencias-notepad-textarea license-split-editor__creds user-lic-proveedor-readonly-creds user-lic-creds-ro" readonly tabindex="-1" rows="' +
            String(Math.max(1, nLines)) +
            '" wrap="off" spellcheck="false" aria-readonly="true" aria-label="' +
            escAttr(ariaLabel) +
            '">' +
            escTextarea(credText) +
            '</textarea></div></div></div></div>'
        );
    }

    function userLicProveedorInitEditableBlocks(outer) {
        if (!outer) return;
        userLicProveedorSyncServiceRowsForBlock(outer, 'license', null);
        var licBlock = outer.querySelector('.user-lic-proveedor-split[data-proveedor-block="license"]');
        if (licBlock) userLicProveedorScheduleAutosizeCredsForBlock(licBlock);
        if (typeof licenseSplitGenericLock === 'function') {
            outer
                .querySelectorAll(
                    '.user-lic-proveedor-split:not(.license-split-editor--proveedor-readonly), .user-lic-proveedor-extra-split--editable'
                )
                .forEach(function (root) {
                    licenseSplitGenericLock(root);
                });
        }
    }

    function userLicProveedorInitSplitBlocks(outer) {
        if (!outer) return;
        outer.querySelectorAll('.user-lic-proveedor-readonly-creds, .user-lic-proveedor-day-empty-creds').forEach(function (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.max(ta.scrollHeight, ta.offsetHeight) + 'px';
        });
    }

    function userLicProveedorDayTextFromCache(day) {
        var days = userLicPortalProveedorCache.day_notepads || {};
        var v = days[String(day)];
        return v != null ? String(v) : '';
    }

    function renderProveedorDaySection(day, sheetKey) {
        var dayLines = userLicProveedorLinesForBlock('day', day);
        var nLines = userLicProveedorCountStructuredLines(dayLines);
        var collapsedClass = '';
        if (sheetKey != null) {
            var sv = portalDayCollapsedRead(sheetKey, String(day));
            if (sv === 'true') collapsedClass = ' collapsed';
            else if (sv === 'false') collapsedClass = '';
            else collapsedClass = nLines === 0 ? ' collapsed' : '';
        } else {
            collapsedClass = nLines === 0 ? ' collapsed' : '';
        }
        var badgeHtml =
            '<span class="day-account-badge admin-licencias-notepad-line-badge"' +
            (nLines > 0 ? ' title="' + escAttr(nLines === 1 ? '1 línea' : nLines + ' líneas') + '"' : '') +
            '>' +
            String(nLines) +
            '</span>';
        var day1LeadingHtml =
            day === 1
                ? '<div class="admin-licencias-day-header-leading">' +
                  '<button type="button" class="admin-licencias-toggle-notes-col-btn admin-licencias-days-expand-all-btn admin-licencias-days-expand-all-btn--leading user-lic-days-expand-all user-lic-proveedor-days-expand-all" title="Plegar todos los días" aria-label="Plegar todas las secciones de días" aria-expanded="true">' +
                  '<i class="fas fa-chevron-up" aria-hidden="true"></i></button></div>'
                : '';
        var dayHeaderExtraClass = day === 1 ? ' admin-licencias-bloc-header--day-toolbar' : '';
        var headerActions =
            '<div class="admin-licencias-bloc-header-actions user-lic-day-header-actions">' + badgeHtml + '</div>';
        var bodyHtml =
            nLines > 0
                ? userLicProveedorRenderSplitBlockHtml('day', day)
                : userLicProveedorRenderEmptyDayBodyHtml(day);
        return (
            '<section class="day-section admin-licencias-bloc admin-licencias-bloc--day user-lic-readonly-day user-lic-proveedor-day' +
            collapsedClass +
            '" data-user-day="' +
            String(day) +
            '">' +
            '<div class="day-section-header admin-licencias-bloc-header user-lic-day-header-toggle' +
            dayHeaderExtraClass +
            '">' +
            day1LeadingHtml +
            '<span class="admin-licencias-bloc-title">' +
            '<i class="fas fa-calendar-day" aria-hidden="true"></i> <span>Día ' +
            String(day) +
            '</span></span>' +
            headerActions +
            '</div>' +
            '<div class="day-accounts-list">' +
            bodyHtml +
            '</div></section>'
        );
    }

    function userLicProveedorExtraNotepadLine(row) {
        return String(row.cuenta || '—').trim() || '—';
    }

    function userLicProveedorExtraBlankMeta() {
        return {
            product: '—',
            cuenta: '—',
            day: '—',
            status: '',
            filterKey: '',
            licenseId: '',
        };
    }

    function userLicProveedorExtraCredLinesFromTa(ta) {
        return String((ta && ta.value) || '')
            .replace(/\r\n/g, '\n')
            .split('\n');
    }

    function userLicProveedorExtraFindRemovedLineIndex(oldLines, newLines) {
        var i = 0;
        var j = 0;
        while (i < oldLines.length && j < newLines.length) {
            if (oldLines[i] === newLines[j]) {
                i += 1;
                j += 1;
                continue;
            }
            return i;
        }
        if (j === newLines.length && i < oldLines.length) return i;
        return Math.max(0, oldLines.length - 1);
    }

    function userLicProveedorExtraFindAddedLineIndex(oldLines, newLines) {
        var i = 0;
        var j = 0;
        while (i < oldLines.length && j < newLines.length) {
            if (oldLines[i] === newLines[j]) {
                i += 1;
                j += 1;
                continue;
            }
            return j;
        }
        return newLines.length - 1;
    }

    function userLicProveedorExtraEditableRowHtml(entry, rowKind, rowIndex) {
        var svc =
            entry && entry.service != null ? entry.service : PROVEEDOR_SERVICE_ANONIMO;
        var saleDay =
            entry && entry.sale_day != null && entry.sale_day !== '—' ? String(entry.sale_day) : '';
        var rowClass =
            rowKind === 'suspended'
                ? 'license-split-editor__row license-split-editor__row--suspended user-lic-proveedor-extra-row'
                : 'license-split-editor__row license-split-editor__row--expired user-lic-proveedor-extra-row';
        var dayInpId = 'userLicProvExtraDay-' + slugForCredFieldId(rowKind) + '-r' + String(rowIndex);
        return (
            '<div class="' +
            rowClass +
            '" data-prov-extra-row-index="' +
            String(rowIndex) +
            '">' +
            '<div class="license-split-editor__lead"></div>' +
            '<div class="license-split-editor__status-wrap user-lic-proveedor-extra-side-row">' +
            '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--bad user-lic-proveedor-service-shell">' +
            userLicProveedorBuildServiceSelectHtml(svc, rowIndex, rowKind, null) +
            '</div>' +
            '<div class="user-lic-proveedor-extra-day-wrap">' +
            '<input type="number" id="' +
            escAttr(dayInpId) +
            '" name="' +
            escAttr(dayInpId) +
            '" min="1" max="31" step="1" class="user-lic-proveedor-extra-day-input form-control form-control-sm" data-proveedor-extra-kind="' +
            escAttr(rowKind) +
            '" data-proveedor-row-index="' +
            String(rowIndex) +
            '" value="' +
            escAttr(saleDay) +
            '" placeholder="Día" aria-label="Día de venta" />' +
            '</div></div></div>'
        );
    }

    function userLicProveedorExtraSyncEditableRows(section, rowKind, cachedLines) {
        var ta = section ? section.querySelector('.user-lic-proveedor-extra-creds') : null;
        var rowsWrap = section ? section.querySelector('.user-lic-proveedor-extra-rows') : null;
        var block = section ? section.querySelector('.user-lic-proveedor-extra-split') : null;
        if (!ta || !rowsWrap) return;
        var credLines = userLicProveedorExtraCredLinesFromTa(ta)
            .map(function (ln) {
                return String(ln).replace(/\s+$/g, '');
            })
            .filter(function (ln) {
                return String(ln).trim() !== '';
            });
        var cached = Array.isArray(cachedLines) ? cachedLines : [];
        var existingSvc = [];
        var existingDay = [];
        rowsWrap.querySelectorAll('.user-lic-proveedor-extra-row').forEach(function (rowEl, idx) {
            var sel = rowEl.querySelector('.user-lic-proveedor-service-select');
            var dayInp = rowEl.querySelector('.user-lic-proveedor-extra-day-input');
            existingSvc[idx] = sel ? sel.value : PROVEEDOR_SERVICE_ANONIMO;
            existingDay[idx] = dayInp ? dayInp.value : '';
        });
        var html = '';
        credLines.forEach(function (cred, idx) {
            var entry = {
                service:
                    existingSvc[idx] != null
                        ? existingSvc[idx]
                        : cached[idx] && cached[idx].service != null
                          ? cached[idx].service
                          : PROVEEDOR_SERVICE_ANONIMO,
                cred: cred,
                sale_day:
                    existingDay[idx] != null && existingDay[idx] !== ''
                        ? existingDay[idx]
                        : cached[idx] && cached[idx].sale_day != null
                          ? cached[idx].sale_day
                          : null,
            };
            html += userLicProveedorExtraEditableRowHtml(entry, rowKind, idx);
        });
        rowsWrap.innerHTML = html;
        userLicEnsureFormFieldIdName(rowsWrap);
        if (block) userLicProveedorScheduleAutosizeCredsForBlock(block);
        userLicProveedorExtraUpdateBadge(section);
    }

    function userLicProveedorExtraRebuildDayRows(section, rowKind) {
        var cached =
            rowKind === 'suspended'
                ? userLicPortalProveedorCache.suspended_lines || []
                : userLicPortalProveedorCache.expired_lines || [];
        userLicProveedorExtraSyncEditableRows(section, rowKind, cached);
    }

    function userLicProveedorExtraUpdateBadge(section) {
        var badge = section ? section.querySelector('.user-lic-proveedor-lic-extra-badge') : null;
        var ta = section ? section.querySelector('.user-lic-proveedor-extra-creds') : null;
        if (!badge || !ta) return;
        var n = userLicProveedorExtraCredLinesFromTa(ta).filter(function (ln) {
            return String(ln).trim() !== '';
        }).length;
        badge.textContent = String(n);
        badge.hidden = false;
        badge.title = n === 1 ? '1 línea' : n + ' líneas';
        if (section.classList.contains('user-lic-proveedor-lic-extra')) {
            return;
        }
        section.classList.toggle('collapsed', n <= 0);
    }

    function userLicProveedorExtraSyncRowsToCredLines(section, rowKind) {
        var cached =
            rowKind === 'suspended'
                ? userLicPortalProveedorCache.suspended_lines || []
                : userLicPortalProveedorCache.expired_lines || [];
        userLicProveedorExtraSyncEditableRows(section, rowKind, cached);
    }

    function userLicProveedorExtraWireCredsEditor(section, outer, rowKind) {
        if (!section || section.getAttribute('data-prov-extra-editor-wired') === '1') return;
        section.setAttribute('data-prov-extra-editor-wired', '1');
    }

    function userLicProveedorExtraAutosizeCreds(section) {
        var credTa = section ? section.querySelector('.user-lic-proveedor-extra-creds') : null;
        if (!credTa) return;
        var n = Math.max(1, userLicProveedorExtraCredLinesFromTa(credTa).length);
        credTa.rows = n;
        credTa.style.height = 'auto';
        credTa.style.height = credTa.scrollHeight + 'px';
    }

    function userLicRenderProveedorLicenciasExtraSection(outer, sectionSel, lines, emptyMsg, splitKind) {
        var section = outer ? outer.querySelector(sectionSel) : null;
        if (!section) return;
        var splitWrap = section.querySelector('.user-lic-proveedor-extra-split-wrap');
        var ta = section.querySelector('.user-lic-proveedor-extra-creds');
        var rowsWrap = section.querySelector('.user-lic-proveedor-extra-rows');
        var hint = section.querySelector('.user-lic-proveedor-lic-extra-hint');
        var badge = section.querySelector('.user-lic-proveedor-lic-extra-badge');
        var persistedLines = Array.isArray(lines) ? lines : [];
        var n = persistedLines.filter(function (entry) {
            return entry && String(entry.cred || '').trim();
        }).length;
        var rowKind = splitKind === 'suspended' ? 'suspended' : 'expired';
        section.removeAttribute('data-prov-extra-editor-wired');
        if (badge) {
            badge.textContent = String(n);
            badge.hidden = false;
            badge.title = n === 1 ? '1 línea' : n + ' líneas';
        }
        var art = outer ? outer.querySelector('.user-lic-account-sheet--proveedor') : null;
        var dayKey = section.getAttribute('data-user-day');
        if (section.classList.contains('user-lic-proveedor-lic-extra')) {
            if (art && dayKey != null) {
                var skExtra = userLicPortalSheetStorageKey(art);
                var svExtra = portalDayCollapsedRead(skExtra, dayKey);
                if (svExtra === 'true') section.classList.add('collapsed');
                else if (svExtra === 'false') section.classList.remove('collapsed');
                else section.classList.remove('collapsed');
            }
        } else if (n <= 0) {
            section.classList.add('collapsed');
        } else if (art && dayKey != null) {
            var sk = userLicPortalSheetStorageKey(art);
            var sv = portalDayCollapsedRead(sk, dayKey);
            if (sv === 'true') section.classList.add('collapsed');
            else if (sv === 'false') section.classList.remove('collapsed');
            else section.classList.remove('collapsed');
        } else {
            section.classList.remove('collapsed');
        }
        if (!ta || !rowsWrap) return;
        if (splitWrap) splitWrap.classList.toggle('user-lic-proveedor-extra-split-wrap--empty', n <= 0);
        if (hint) {
            hint.textContent = emptyMsg;
            hint.hidden = n > 0 || !emptyMsg;
        }
        ta.value = userLicProveedorLinesToCredsText(persistedLines);
        ta.rows = Math.max(1, n || 1);
        userLicProveedorExtraSyncEditableRows(section, rowKind, persistedLines);
        userLicProveedorExtraWireCredsEditor(section, outer, rowKind);
        if (typeof licenseSplitGenericLock === 'function') {
            var extraRoot = section.querySelector('.user-lic-proveedor-extra-split--editable');
            if (extraRoot) licenseSplitGenericLock(extraRoot);
        }
    }

    function userLicProveedorLicExtrasSearchQuery() {
        var inp = document.getElementById('userLicenciasSearch');
        return inp ? String(inp.value || '').toLowerCase().trim() : '';
    }

    function userLicRefreshProveedorLicenciasExtras(outer) {
        if (!outer || !userLicPortalProveedorEnabled || userLicPortalIsProveedorDirty()) return;
        userLicRenderProveedorLicenciasExtraSection(
            outer,
            '.user-lic-proveedor-vencidas',
            userLicPortalProveedorCache.expired_lines || [],
            '',
            'expired'
        );
        userLicRenderProveedorLicenciasExtraSection(
            outer,
            '.user-lic-proveedor-caidas',
            userLicPortalProveedorCache.suspended_lines || [],
            'Añade aquí caídas (una por línea). Los cambios se guardan solos.',
            'suspended'
        );
    }

    function userLicProveedorLicExtraSectionHtml(title, iconClass, sectionClass, wrapClass, splitKind, emptyHint) {
        var isExpired = splitKind === 'expired';
        var sectionBodyClass = isExpired ? ' expired-section-body' : ' suspended-section-body';
        var sectionExtraClass = isExpired ? ' expired-section' : ' suspended-section';
        var innerWrapClass = isExpired
            ? 'license-notepads-wrap--expired-inner'
            : 'license-notepads-wrap--suspended-inner';
        var credTaClass = isExpired ? 'expired-license-split__creds' : 'suspended-license-split__creds';
        var rowsClass = isExpired ? 'expired-license-split-rows' : 'suspended-license-split-rows';
        var rootRestoreHidden = isExpired
            ? 'license-split-editor--expired-restore-hidden'
            : 'license-split-editor--suspended-restore-hidden';
        var rootKindClass = isExpired ? 'expired-license-split-root' : 'suspended-license-split-root';
        var fieldPrefix = isExpired ? 'userLicProvExtraVenc' : 'userLicProvExtraCaid';
        var credFieldId = fieldPrefix + 'Creds';
        return (
            '<div class="' +
            escAttr(wrapClass) +
            '">' +
            '<section class="day-section admin-licencias-bloc admin-licencias-bloc--day user-lic-readonly-day user-lic-proveedor-lic-extra ' +
            sectionClass +
            sectionExtraClass +
            '" data-user-day="' +
            escAttr(splitKind === 'suspended' ? 'caidas' : 'vencidas') +
            '" aria-label="' +
            escAttr(title) +
            '">' +
            '<div class="day-section-header admin-licencias-bloc-header user-lic-day-header-toggle">' +
            '<span class="admin-licencias-bloc-title">' +
            '<i class="' +
            escAttr(iconClass) +
            '" aria-hidden="true"></i> <span>' +
            escHtml(title) +
            '</span></span>' +
            '<div class="admin-licencias-bloc-header-actions user-lic-day-header-actions">' +
            '<span class="day-account-badge admin-licencias-notepad-line-badge user-lic-proveedor-lic-extra-badge" role="status">0</span>' +
            '</div></div>' +
            '<div class="day-accounts-list' +
            sectionBodyClass +
            '">' +
            '<div class="license-notepads-wrap ' +
            innerWrapClass +
            ' user-lic-proveedor-extra-split-wrap user-lic-proveedor-extra-split-wrap--empty">' +
            '<div class="license-split-editor license-split-editor--day ' +
            rootKindClass +
            ' user-lic-proveedor-extra-split user-lic-proveedor-extra-split--editable license-split-editor--notes-hidden ' +
            rootRestoreHidden +
            ' user-lic-days-bundle" tabindex="-1" role="region" aria-label="' +
            escAttr(title) +
            ': servicio, licencia editable y día">' +
            '<div class="license-split-editor__viewport user-lic-proveedor-extra-viewport">' +
            '<div class="license-split-editor__grid">' +
            '<div class="license-split-editor__creds-cell user-lic-proveedor-extra-creds-cell">' +
            '<textarea id="' +
            escAttr(credFieldId) +
            '" name="' +
            escAttr(credFieldId) +
            '" class="admin-licencias-notepad-textarea license-split-editor__creds ' +
            credTaClass +
            ' user-lic-proveedor-extra-creds user-lic-proveedor-creds-ta" rows="1" spellcheck="true" wrap="off" autocomplete="off" aria-label="Licencia o cuenta, una por línea" placeholder="Correo y contraseña, una por línea."></textarea>' +
            '</div>' +
            '<div class="license-split-editor__side user-lic-proveedor-extra-side" aria-label="Día de venta">' +
            '<div class="license-split-editor__rows ' +
            rowsClass +
            ' user-lic-proveedor-extra-rows" role="region"></div>' +
            '</div></div></div></div></div>' +
            (emptyHint
                ? '<p class="user-lic-proveedor-lic-extra-hint mb-0" hidden>' +
                  escHtml(emptyHint) +
                  '</p>'
                : '') +
            '</div></section></div>'
        );
    }

    function renderProveedorInventorySheet() {
        var licLines = userLicProveedorLinesForBlock('license', null);
        var licCount = userLicProveedorSellableLicenseCount(licLines);
        var licRaw = licCount + (userLicProveedorHiddenGarLines || []).length;
        var licTitle =
            licCount === 1
                ? '1 vendible (igual que tienda)'
                : licCount +
                  ' vendibles (igual que tienda)' +
                  (licRaw > licCount ? ' · ' + licRaw + ' en inventario (resto en gar. ocultas)' : '');
        var licBadge =
            '<span class="day-account-badge admin-licencias-notepad-line-badge"' +
            (licCount > 0 || licRaw > 0 ? ' title="' + escAttr(licTitle) + '"' : '') +
            '>' +
            String(licCount) +
            '</span>';
        var proveedorSheetKey = USER_LIC_PORTAL_PROVEEDOR_FILTER;
        var licCollapsedClass = '';
        var licSv = portalDayCollapsedRead(proveedorSheetKey, 'licencias');
        if (licSv === 'true') licCollapsedClass = ' collapsed';
        else if (licSv === 'false') licCollapsedClass = '';
        else licCollapsedClass = licCount === 0 ? ' collapsed' : '';
        var daysHtml = '';
        var d;
        for (d = 1; d <= 31; d += 1) {
            daysHtml += renderProveedorDaySection(d, proveedorSheetKey);
        }
        return (
            '<article class="user-lic-account-sheet user-lic-account-sheet--proveedor"' +
            ' data-search-filter="proveedor inventario licencias"' +
            ' data-license-id="' +
            USER_LIC_PORTAL_PROVEEDOR_FILTER +
            '" data-default-scroll-day="1">' +
            '<div class="license-notepads-wrap user-lic-bundle-wrap user-lic-proveedor-wrap">' +
            '<section class="day-section admin-licencias-bloc admin-licencias-bloc--license user-lic-readonly-day user-lic-proveedor-lic-bloc' +
            licCollapsedClass +
            '" data-user-day="licencias" aria-label="Licencias del proveedor">' +
            '<div class="day-section-header admin-licencias-bloc-header user-lic-day-header-toggle user-lic-proveedor-lic-header" role="button" tabindex="0" aria-expanded="' +
            (licCollapsedClass ? 'false' : 'true') +
            '" title="Plegar o desplegar Licencias">' +
            '<span class="admin-licencias-bloc-title">Licencias</span>' +
            '<div class="admin-licencias-bloc-header-actions user-lic-day-header-actions">' +
            licBadge +
            '</div></div>' +
            '<div class="day-accounts-list user-lic-proveedor-lic-body">' +
            userLicProveedorRenderSplitBlockHtml('license', null) +
            '</div></section>' +
            '<div id="userLicProveedorDaysContainer" class="license-all-days-container user-lic-proveedor-days">' +
            daysHtml +
            '</div>' +
            userLicProveedorLicExtraSectionHtml(
                'Vencidas',
                'fas fa-calendar-times',
                'user-lic-proveedor-vencidas',
                'license-expired-notepad-wrap',
                'expired',
                ''
            ) +
            userLicProveedorLicExtraSectionHtml(
                'Caídas',
                'fas fa-exclamation-triangle',
                'user-lic-proveedor-caidas',
                'license-suspended-notepad-wrap',
                'suspended',
                ''
            ) +
            '</div></article>'
        );
    }

    function firstLetter(name) {
        var s = String(name || '').trim();
        return s ? s.charAt(0).toUpperCase() : '?';
    }

    function groupSummariesFromAccounts(accounts) {
        var byKey = {};
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            var a = accounts[i];
            var fk = userLicPortalGridFilterKey(a);
            if (!byKey[fk]) {
                byKey[fk] = {
                    filterKey: fk,
                    license_id: a.license_id,
                    product_name: a.product_name || '—',
                    account_count: 0,
                    product_image_url: a.product_image_url || ''
                };
            }
            byKey[fk].account_count += 1;
            if (!byKey[fk].product_image_url && a.product_image_url) {
                byKey[fk].product_image_url = a.product_image_url;
            }
        }
        var out = [];
        Object.keys(byKey).forEach(function (k) {
            out.push(byKey[k]);
        });
        out.sort(function (x, y) {
            var cmp = String(x.product_name || '').toLowerCase().localeCompare(String(y.product_name || '').toLowerCase());
            if (cmp !== 0) return cmp;
            return String(x.filterKey).localeCompare(String(y.filterKey));
        });
        return out;
    }

    function userLicFilterKeyForLicenseId(licenseId) {
        var accounts = userLicPortalAccountsCache || [];
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            if (String(accounts[i].license_id) === String(licenseId)) {
                return userLicPortalGridFilterKey(accounts[i]);
            }
        }
        return 'all';
    }

    function userLicPortalAccountFromIds(licenseId, accountIdOptional) {
        var accounts = userLicPortalAccountsCache || [];
        var i;
        for (i = 0; i < accounts.length; i += 1) {
            var a = accounts[i];
            if (String(a.license_id) !== String(licenseId)) continue;
            if (
                accountIdOptional != null &&
                accountIdOptional !== '' &&
                a.account_id != null &&
                String(a.account_id) !== String(accountIdOptional)
            ) {
                continue;
            }
            return a;
        }
        return null;
    }

    function userLicReportEntryCredFromRow(row, acc) {
        if (row && row.cred != null && String(row.cred).trim()) {
            return String(row.cred).trim();
        }
        if (acc && acc.credential_preview) {
            return String(acc.credential_preview).trim();
        }
        return '';
    }

    function userLicFilterReportRows(all, q) {
        if (!q) return all.slice();
        return all.filter(function (row) {
            var blob = [row.product, row.cuenta, row.status, 'día ' + row.day].join(' ').toLowerCase();
            return blob.indexOf(q) !== -1;
        });
    }

    function userLicReportMetaText(total, q, emptyLabel, oneLabel, manyLabel) {
        if (total === 0) {
            return q ? 'Sin coincidencias' : emptyLabel;
        }
        return total + (total === 1 ? oneLabel : manyLabel);
    }

    function userLicCollectReportEntriesFromCache(accounts) {
        var out = [];
        (accounts || []).forEach(function (acc) {
            var productName = String(acc.product_name || '—').trim() || '—';
            var filterKey = userLicPortalGridFilterKey(acc);
            var dl = acc.day_lines || {};
            var d;
            for (d = 1; d <= 31; d += 1) {
                var rows = dl[String(d)] || [];
                var ri;
                for (ri = 0; ri < rows.length; ri += 1) {
                    var row = rows[ri];
                    if (!userLicRowIsReporte(row)) continue;
                    var cuenta =
                        row.cred != null
                            ? String(row.cred).trim()
                            : String(acc.credential_preview || '').trim();
                    var statusCode = row.status_bad != null ? String(row.status_bad).trim() : '';
                    var statusLabel = statusCode;
                    var bi;
                    for (bi = 0; bi < OPT_LICENSE_BAD.length; bi += 1) {
                        if (
                            normalizeStatusKey(OPT_LICENSE_BAD[bi].v) === normalizeStatusKey(statusCode)
                        ) {
                            statusLabel = OPT_LICENSE_BAD[bi].label;
                            break;
                        }
                    }
                    out.push({
                        product: productName,
                        cuenta: cuenta || '—',
                        day: d,
                        status: statusLabel || '—',
                        filterKey: filterKey,
                        licenseId: acc.license_id,
                    });
                }
            }
        });
        return out;
    }

    function userLicCollectVencidasEntriesFromCache(accounts) {
        var out = [];
        (accounts || []).forEach(function (acc) {
            if (acc.account_expired !== true) return;
            var productName = String(acc.product_name || '—').trim() || '—';
            var filterKey = userLicPortalGridFilterKey(acc);
            var entries = portalRowEntriesForAccount(acc);
            if (!entries.length) {
                out.push({
                    product: productName,
                    cuenta: String(acc.credential_preview || '—').trim() || '—',
                    day: acc.linked_sale_day != null ? acc.linked_sale_day : '—',
                    status: 'Vencida',
                    filterKey: filterKey,
                    licenseId: acc.license_id,
                });
                return;
            }
            var ei;
            for (ei = 0; ei < entries.length; ei += 1) {
                var entry = entries[ei];
                var row = entry.row;
                var cuenta = userLicReportEntryCredFromRow(row, acc) || '—';
                out.push({
                    product: productName,
                    cuenta: cuenta,
                    day: entry.saleDay,
                    status: 'Vencida',
                    filterKey: filterKey,
                    licenseId: acc.license_id,
                });
            }
        });
        return out;
    }

    function userLicCollectCaidasEntriesFromCache(accounts) {
        var out = [];
        (accounts || []).forEach(function (acc) {
            var productName = String(acc.product_name || '—').trim() || '—';
            var filterKey = userLicPortalGridFilterKey(acc);
            var dl = acc.day_lines || {};
            var d;
            for (d = 1; d <= 31; d += 1) {
                var rows = dl[String(d)] || [];
                var ri;
                for (ri = 0; ri < rows.length; ri += 1) {
                    var row = rows[ri];
                    if (!userLicRowIsGarantia(row)) continue;
                    var cuenta = userLicReportEntryCredFromRow(row, acc) || '—';
                    out.push({
                        product: productName,
                        cuenta: cuenta,
                        day: d,
                        status: 'Caída (repuesta)',
                        filterKey: filterKey,
                        licenseId: acc.license_id,
                    });
                }
            }
        });
        return out;
    }

    function userLicCollectReportEntriesFromDom(root) {
        var out = [];
        if (!root) return out;
        root
            .querySelectorAll(
                '.user-lic-account-sheet:not(.user-lic-account-sheet--proveedor):not(.user-lic-account-sheet--vencimientos):not(.user-lic-account-sheet--aggregate)'
            )
            .forEach(function (art) {
                art.querySelectorAll('.day-section.user-lic-readonly-day[data-user-day]').forEach(function (sec) {
                    var day = Number(sec.getAttribute('data-user-day'));
                    if (!Number.isFinite(day)) return;
                    var ta = sec.querySelector('.user-lic-creds-ro');
                    sec.querySelectorAll('.user-lic-license-row-edit').forEach(function (rowEl) {
                        if (userLicRowSignalClassFromDom(rowEl) !== 'user-lic-row--signal-reportes') return;
                        var idx = Number(rowEl.getAttribute('data-lic-creds-line-index'));
                        if (!Number.isFinite(idx)) idx = 0;
                        var cuenta = '';
                        if (ta) {
                            var raw = String(ta.value || '').replace(/\r\n/g, '\n');
                            var lines = raw.split('\n');
                            cuenta = lines[idx] != null ? String(lines[idx]).trim() : '';
                        }
                        var sbEl = rowEl.querySelector('select.license-split-editor__status-bad');
                        var statusLabel = '—';
                        if (sbEl && sbEl.selectedIndex >= 0) {
                            statusLabel = String(sbEl.options[sbEl.selectedIndex].textContent || '').trim() || '—';
                        }
                        var lid = rowEl.getAttribute('data-lic-row-license-id');
                        out.push({
                            product:
                                String(rowEl.getAttribute('data-lic-product-label') || '').trim() || '—',
                            cuenta: cuenta || '—',
                            day: day,
                            status: statusLabel,
                            filterKey: userLicFilterKeyForLicenseId(lid),
                            licenseId: lid,
                        });
                    });
                });
            });
        return out;
    }

    function userLicCollectVencidasEntriesFromDom(root) {
        var out = [];
        if (!root) return out;
        root
            .querySelectorAll(
                '.user-lic-account-sheet:not(.user-lic-account-sheet--proveedor):not(.user-lic-account-sheet--vencimientos):not(.user-lic-account-sheet--aggregate)'
            )
            .forEach(function (art) {
                art.querySelectorAll('.day-section.user-lic-readonly-day[data-user-day]').forEach(function (sec) {
                    var day = Number(sec.getAttribute('data-user-day'));
                    if (!Number.isFinite(day)) return;
                    var ta = sec.querySelector('.user-lic-creds-ro');
                    sec.querySelectorAll('.user-lic-license-row-edit').forEach(function (rowEl) {
                        var lid = rowEl.getAttribute('data-lic-row-license-id');
                        var aid = rowEl.getAttribute('data-lic-row-account-id');
                        var acc = userLicPortalAccountFromIds(lid, aid);
                        if (!acc || acc.account_expired !== true) return;
                        var idx = Number(rowEl.getAttribute('data-lic-creds-line-index'));
                        if (!Number.isFinite(idx)) idx = 0;
                        var cuenta = '';
                        if (ta) {
                            var raw = String(ta.value || '').replace(/\r\n/g, '\n');
                            var lines = raw.split('\n');
                            cuenta = lines[idx] != null ? String(lines[idx]).trim() : '';
                        }
                        if (!cuenta && acc.credential_preview) {
                            cuenta = String(acc.credential_preview).trim();
                        }
                        out.push({
                            product:
                                String(rowEl.getAttribute('data-lic-product-label') || acc.product_name || '').trim() ||
                                '—',
                            cuenta: cuenta || '—',
                            day: day,
                            status: 'Vencida',
                            filterKey: userLicFilterKeyForLicenseId(lid),
                            licenseId: lid,
                        });
                    });
                });
            });
        return out;
    }

    function userLicCollectCaidasEntriesFromDom(root) {
        var out = [];
        if (!root) return out;
        root
            .querySelectorAll(
                '.user-lic-account-sheet:not(.user-lic-account-sheet--proveedor):not(.user-lic-account-sheet--vencimientos):not(.user-lic-account-sheet--aggregate)'
            )
            .forEach(function (art) {
                art.querySelectorAll('.day-section.user-lic-readonly-day[data-user-day]').forEach(function (sec) {
                    var day = Number(sec.getAttribute('data-user-day'));
                    if (!Number.isFinite(day)) return;
                    var ta = sec.querySelector('.user-lic-creds-ro');
                    sec.querySelectorAll('.user-lic-license-row-edit').forEach(function (rowEl) {
                        if (!rowEl.querySelector('.user-lic-garantia-badge')) {
                            var sgEl = rowEl.querySelector('select.license-split-editor__status-good');
                            var sgVal = sgEl ? String(sgEl.value != null ? sgEl.value : '').trim() : '';
                            if (normalizeStatusKey(sgVal) !== normalizeStatusKey('garantia')) return;
                        }
                        var idx = Number(rowEl.getAttribute('data-lic-creds-line-index'));
                        if (!Number.isFinite(idx)) idx = 0;
                        var cuenta = '';
                        if (ta) {
                            var raw = String(ta.value || '').replace(/\r\n/g, '\n');
                            var lines = raw.split('\n');
                            cuenta = lines[idx] != null ? String(lines[idx]).trim() : '';
                        }
                        var lid = rowEl.getAttribute('data-lic-row-license-id');
                        out.push({
                            product:
                                String(rowEl.getAttribute('data-lic-product-label') || '').trim() || '—',
                            cuenta: cuenta || '—',
                            day: day,
                            status: 'Caída (repuesta)',
                            filterKey: userLicFilterKeyForLicenseId(lid),
                            licenseId: lid,
                        });
                    });
                });
            });
        return out;
    }

    function userLicCollectReportEntries(root, preferCache) {
        var outer = root || document.getElementById('userLicenciasTableOuter');
        if (!preferCache && outer && outer.querySelector('.user-lic-account-sheet')) {
            return userLicCollectReportEntriesFromDom(outer);
        }
        return userLicCollectReportEntriesFromCache(userLicPortalAccountsCache);
    }

    function userLicCollectVencidasEntries(root) {
        var outer = root || document.getElementById('userLicenciasTableOuter');
        if (outer && outer.querySelector('.user-lic-account-sheet')) {
            return userLicCollectVencidasEntriesFromDom(outer);
        }
        return userLicCollectVencidasEntriesFromCache(userLicPortalAccountsCache);
    }

    function userLicCollectCaidasEntries(root) {
        var outer = root || document.getElementById('userLicenciasTableOuter');
        if (outer && outer.querySelector('.user-lic-account-sheet')) {
            return userLicCollectCaidasEntriesFromDom(outer);
        }
        return userLicCollectCaidasEntriesFromCache(userLicPortalAccountsCache);
    }

    function userLicPortalReportNavigateToRow(outer, row) {
        var host = outer.closest('.user-licencias-shell') || document.body;
        var gridHost = host.querySelector('#userLicenciasGridHost');
        var fk = String(row.filterKey || 'all');
        var dayRaw = row.day != null ? String(row.day) : '1';
        userLicPortalSetReportesMode(false, outer);
        applyLicenseFilter(outer, gridHost, fk, false, true);
        window.setTimeout(function () {
            var art = null;
            outer.querySelectorAll('.user-lic-account-sheet').forEach(function (a) {
                if (art) return;
                if (a.classList.contains('user-lic-account-sheet--aggregate')) return;
                if (a.classList.contains('user-lic-account-sheet--proveedor')) return;
                if (a.classList.contains('user-lic-account-sheet--vencimientos')) return;
                if (a.style.display === 'none') return;
                art = a;
            });
            if (art) scrollDayWithinArticle(art, dayRaw);
        }, 60);
    }

    function userLicPortalReportesModeActive(outer) {
        var shell = outer && outer.closest ? outer.closest('.user-licencias-shell') : null;
        return !!(shell && shell.classList.contains('user-lic-reportes-mode'));
    }

    function userLicPortalSetReportesMode(on, outer) {
        var shell = outer && outer.closest ? outer.closest('.user-licencias-shell') : null;
        var panel = document.getElementById('userLicReportesPanel');
        var btn = document.querySelector('.user-lic-license-card--reportes');
        if (shell) shell.classList.toggle('user-lic-reportes-mode', !!on);
        if (panel) {
            panel.classList.toggle('d-none', !on);
            panel.hidden = !on;
            panel.setAttribute('aria-hidden', on ? 'false' : 'true');
        }
        if (btn) {
            btn.classList.toggle('active', !!on);
            btn.classList.toggle('user-lic-reportes-toggle--open', !!on);
            btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        }
    }

    /* ============================================================
       Bloc compartido «Verificar/Arreglar» (portal soporte ↔ admin).
       ============================================================ */
    var USER_LIC_VERIFICAR_SAVE_DEBOUNCE_MS = 800;
    var userLicVerificarLastRev = null;
    var userLicVerificarDirty = false;
    var userLicVerificarSaveTimer = null;
    var userLicVerificarSaving = false;
    var userLicVerificarPendingServer = null;
    var userLicVerificarStatusTimer = null;
    var userLicVerificarReadOnly = false;
    var userLicVerificarVerified = false;
    var userLicVerificarPending = false;
    var userLicVerificarFlagsSaving = false;

    function userLicVerificarTextarea() {
        return document.getElementById('userLicVerificarTextarea');
    }

    function userLicVerificarApiUrl() {
        var outer = document.getElementById('userLicenciasTableOuter');
        return (outer && outer.getAttribute('data-verificar-url')) || '/tienda/api/licencias/verificar-arreglar';
    }

    function userLicVerificarSetStatus(text, transient) {
        var el = document.getElementById('userLicVerificarStatus');
        if (!el) return;
        el.textContent = text || '';
        if (userLicVerificarStatusTimer) {
            window.clearTimeout(userLicVerificarStatusTimer);
            userLicVerificarStatusTimer = null;
        }
        if (text && transient) {
            userLicVerificarStatusTimer = window.setTimeout(function () {
                if (el.textContent === text) el.textContent = '';
            }, 2500);
        }
    }

    function userLicVerificarMarkReadOnly() {
        userLicVerificarReadOnly = true;
        var ta = userLicVerificarTextarea();
        if (ta) ta.readOnly = true;
        var chkV = document.getElementById('userLicVerificarCheck');
        var chkP = document.getElementById('userLicVerificarPendingCheck');
        if (chkV) chkV.disabled = true;
        if (chkP) chkP.disabled = true;
        userLicVerificarSetStatus('Solo lectura');
    }

    function userLicVerificarSyncCardState() {
        var verified = !!userLicVerificarVerified;
        var pending = !verified && !!userLicVerificarPending;
        var state = verified ? 'verified' : pending ? 'pending' : 'normal';
        try {
            document.documentElement.setAttribute('data-user-va-state', state);
            var shell = document.querySelector('.user-licencias-shell');
            if (shell) shell.setAttribute('data-va-state', state);
            sessionStorage.setItem('user_va_card_state', state);
        } catch (_eVaShellU) {}
        var btn = document.querySelector('.user-lic-license-card--verificar');
        if (!btn) return;
        btn.classList.toggle('is-verified', verified);
        btn.classList.toggle('is-pending', pending);
        btn.setAttribute('data-va-state', state);
    }

    function userLicVerificarSyncCheckboxUi() {
        var chkV = document.getElementById('userLicVerificarCheck');
        var chkP = document.getElementById('userLicVerificarPendingCheck');
        var pendingOn = !userLicVerificarVerified && !!userLicVerificarPending;
        var verifiedOn = !!userLicVerificarVerified;
        if (chkV) {
            if (document.activeElement !== chkV) {
                chkV.checked = verifiedOn;
            }
            /* Con Verificar/Arreglar activo, Verificado queda deshabilitado. */
            chkV.disabled = !!userLicVerificarReadOnly || pendingOn;
        }
        if (chkP) {
            if (document.activeElement !== chkP) {
                chkP.checked = pendingOn;
            }
            /* Con Verificado activo, Verificar/Arreglar queda deshabilitado. */
            chkP.disabled = !!userLicVerificarReadOnly || verifiedOn;
        }
        userLicVerificarSyncCardState();
    }

    function userLicVerificarApplyServerPayload(payload) {
        var text = String((payload && payload.text) || '');
        var rev = payload && payload.rev != null ? String(payload.rev) : null;
        var verified = !!(payload && payload.verified);
        var pending = !!(payload && payload.pending);
        var ta = userLicVerificarTextarea();
        var focused = ta && document.activeElement === ta;
        if (userLicVerificarDirty || userLicVerificarSaving || focused) {
            userLicVerificarPendingServer = {
                text: text,
                rev: rev,
                verified: verified,
                pending: pending,
            };
            if (!userLicVerificarFlagsSaving) {
                userLicVerificarVerified = verified;
                userLicVerificarPending = pending;
                userLicVerificarSyncCheckboxUi();
            }
            return;
        }
        userLicVerificarPendingServer = null;
        userLicVerificarLastRev = rev;
        userLicVerificarVerified = verified;
        userLicVerificarPending = pending;
        if (ta && ta.value !== text) {
            ta.value = text;
        }
        userLicVerificarSyncCheckboxUi();
    }

    function userLicVerificarFetchFromServer() {
        var url = userLicVerificarApiUrl();
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        return fetch(url + sep + '_t=' + Date.now(), {
            credentials: 'same-origin',
            cache: 'no-store',
        })
            .then(function (r) {
                return r.json().then(
                    function (d) {
                        return { httpOk: r.ok, data: d };
                    },
                    function () {
                        return { httpOk: r.ok, data: null };
                    }
                );
            })
            .then(function (res) {
                var data = res.data;
                if (!res.httpOk || !data || !data.success) return;
                var rev = data.rev != null ? String(data.rev) : '';
                if (rev !== userLicVerificarLastRev || userLicVerificarLastRev === null) {
                    userLicVerificarApplyServerPayload(data);
                } else {
                    userLicVerificarVerified = !!data.verified;
                    userLicVerificarPending = !!data.pending;
                    userLicVerificarSyncCheckboxUi();
                }
            })
            .catch(function () {});
    }

    function userLicVerificarRealtimeRefresh() {
        if (!userLicPortalSoporteLicenciasEnabled) return;
        void userLicVerificarFetchFromServer();
    }

    function userLicVerificarPutFlags(body) {
        if (userLicVerificarReadOnly) return;
        userLicVerificarFlagsSaving = true;
        userLicVerificarSetStatus('Guardando…');
        return fetch(userLicVerificarApiUrl(), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: userLicJsonHeaders(),
            body: JSON.stringify(body),
        })
            .then(function (r) {
                return r.json().then(
                    function (d) {
                        return { status: r.status, httpOk: r.ok, data: d };
                    },
                    function () {
                        return { status: r.status, httpOk: r.ok, data: null };
                    }
                );
            })
            .then(function (res) {
                if (res.status === 403) {
                    userLicVerificarMarkReadOnly();
                    return;
                }
                if (!res.httpOk || !res.data || !res.data.success) {
                    userLicVerificarSetStatus('No se pudo guardar');
                    userLicVerificarSyncCheckboxUi();
                    return;
                }
                userLicVerificarLastRev = res.data.rev != null ? String(res.data.rev) : null;
                userLicVerificarVerified = !!res.data.verified;
                userLicVerificarPending = !!res.data.pending;
                userLicVerificarSyncCheckboxUi();
                userLicVerificarSetStatus('Guardado ✓', true);
            })
            .catch(function () {
                userLicVerificarSetStatus('Sin conexión');
                userLicVerificarSyncCheckboxUi();
            })
            .finally(function () {
                userLicVerificarFlagsSaving = false;
            });
    }

    function userLicVerificarSaveNow() {
        var ta = userLicVerificarTextarea();
        if (!ta || userLicVerificarReadOnly || userLicVerificarSaving) return;
        userLicVerificarSaving = true;
        var snapshot = ta.value;
        userLicVerificarSetStatus('Guardando…');
        fetch(userLicVerificarApiUrl(), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: userLicJsonHeaders(),
            body: JSON.stringify({ text: snapshot }),
        })
            .then(function (r) {
                return r.json().then(
                    function (d) {
                        return { status: r.status, httpOk: r.ok, data: d };
                    },
                    function () {
                        return { status: r.status, httpOk: r.ok, data: null };
                    }
                );
            })
            .then(function (res) {
                if (res.status === 403) {
                    userLicVerificarMarkReadOnly();
                    return;
                }
                if (!res.httpOk || !res.data || !res.data.success) {
                    userLicVerificarSetStatus('No se pudo guardar');
                    return;
                }
                userLicVerificarLastRev = res.data.rev != null ? String(res.data.rev) : null;
                if (res.data.verified != null) userLicVerificarVerified = !!res.data.verified;
                if (res.data.pending != null) userLicVerificarPending = !!res.data.pending;
                userLicVerificarSyncCheckboxUi();
                if (ta.value === snapshot) {
                    userLicVerificarDirty = false;
                    userLicVerificarSetStatus('Guardado ✓', true);
                } else {
                    userLicVerificarScheduleSave();
                }
            })
            .catch(function () {
                userLicVerificarSetStatus('Sin conexión: reintentando…');
                userLicVerificarScheduleSave();
            })
            .finally(function () {
                userLicVerificarSaving = false;
                if (!userLicVerificarDirty && userLicVerificarPendingServer) {
                    var pend = userLicVerificarPendingServer;
                    userLicVerificarPendingServer = null;
                    userLicVerificarApplyServerPayload(pend);
                }
            });
    }

    function userLicVerificarScheduleSave() {
        if (userLicVerificarReadOnly) return;
        if (userLicVerificarSaveTimer) window.clearTimeout(userLicVerificarSaveTimer);
        userLicVerificarSaveTimer = window.setTimeout(function () {
            userLicVerificarSaveTimer = null;
            userLicVerificarSaveNow();
        }, USER_LIC_VERIFICAR_SAVE_DEBOUNCE_MS);
    }

    function userLicVerificarFlushSave() {
        if (!userLicVerificarDirty || userLicVerificarReadOnly) return;
        if (userLicVerificarSaveTimer) {
            window.clearTimeout(userLicVerificarSaveTimer);
            userLicVerificarSaveTimer = null;
        }
        userLicVerificarSaveNow();
    }

    function wireUserLicVerificarPanel(outer) {
        var ta = userLicVerificarTextarea();
        if (ta && ta.getAttribute('data-verificar-wired') !== '1') {
            ta.setAttribute('data-verificar-wired', '1');
            if (outer && outer.getAttribute('data-licencias-view-only') === '1') {
                userLicVerificarMarkReadOnly();
            }
            ta.addEventListener('input', function () {
                userLicVerificarDirty = true;
                userLicVerificarScheduleSave();
            });
            ta.addEventListener('blur', function () {
                userLicVerificarFlushSave();
                if (!userLicVerificarDirty && userLicVerificarPendingServer) {
                    var pend = userLicVerificarPendingServer;
                    userLicVerificarPendingServer = null;
                    userLicVerificarApplyServerPayload(pend);
                }
            });
        }

        var chkV = document.getElementById('userLicVerificarCheck');
        if (chkV && chkV.getAttribute('data-verificar-wired') !== '1') {
            chkV.setAttribute('data-verificar-wired', '1');
            chkV.addEventListener('change', function () {
                userLicVerificarVerified = !!chkV.checked;
                if (userLicVerificarVerified) userLicVerificarPending = false;
                userLicVerificarSyncCheckboxUi();
                void userLicVerificarPutFlags({ verified: !!chkV.checked });
            });
        }

        var chkP = document.getElementById('userLicVerificarPendingCheck');
        if (chkP && chkP.getAttribute('data-verificar-wired') !== '1') {
            chkP.setAttribute('data-verificar-wired', '1');
            chkP.addEventListener('change', function () {
                userLicVerificarPending = !!chkP.checked;
                if (userLicVerificarPending) userLicVerificarVerified = false;
                userLicVerificarSyncCheckboxUi();
                void userLicVerificarPutFlags({ pending: !!chkP.checked });
            });
        }

        userLicVerificarSyncCheckboxUi();
        if (userLicPortalSoporteLicenciasEnabled) {
            void userLicVerificarFetchFromServer();
        }
    }

    function userLicPortalSetVerificarMode(on, outer) {
        var shell = outer && outer.closest ? outer.closest('.user-licencias-shell') : null;
        var panel = document.getElementById('userLicVerificarPanel');
        var btn = document.querySelector('.user-lic-license-card--verificar');
        if (shell) shell.classList.toggle('user-lic-verificar-mode', !!on);
        if (panel) {
            panel.classList.toggle('d-none', !on);
            panel.hidden = !on;
            panel.setAttribute('aria-hidden', on ? 'false' : 'true');
        }
        if (btn) {
            btn.classList.toggle('active', !!on);
            btn.classList.toggle('user-lic-verificar-toggle--open', !!on);
            btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        }
        /* Color de estado del botón (verde/amarillo) se mantiene aunque cierres el panel. */
        userLicVerificarSyncCardState();
        if (!on) {
            userLicVerificarFlushSave();
        }
    }


    function userLicSyncReportesBadge(preferCache) {
        var n = userLicCollectReportEntries(null, preferCache).length;
        var badge = document.getElementById('userLicReportesTotalBadge');
        var numEl = badge ? badge.querySelector('.license-card-report-total-badge__num') : null;
        if (numEl) numEl.textContent = String(n);
        if (badge) {
            badge.hidden = n <= 0;
            if (n > 0) {
                var tt =
                    n === 1
                        ? '1 reporte pendiente'
                        : n + ' reportes pendientes';
                badge.title = tt;
                badge.setAttribute('aria-label', tt);
            } else {
                badge.removeAttribute('title');
                badge.setAttribute('aria-label', 'Sin reportes pendientes');
            }
        }
        var btn = document.querySelector('.user-lic-license-card--reportes');
        if (btn) {
            var base =
                n > 0
                    ? n === 1
                        ? 'Reportes: 1 incidencia — ver lista'
                        : 'Reportes: ' + n + ' incidencias — ver lista'
                    : 'Reportes: incidencias en tus licencias asignadas';
            btn.title = base;
            btn.setAttribute('aria-label', base);
        }
    }

    function userLicRenderReportesTableSection(outer, tableBody, metaEl, rows, q, emptyLabel, oneLabel, manyLabel, emptyRowHtml) {
        var filtered = userLicFilterReportRows(rows, q);
        var total = filtered.length;
        metaEl.textContent = userLicReportMetaText(total, q, emptyLabel, oneLabel, manyLabel);
        tableBody.innerHTML = '';
        if (filtered.length === 0) {
            var trEmpty = document.createElement('tr');
            trEmpty.className = 'admin-licencias-reportes-row admin-licencias-reportes-row--empty';
            trEmpty.innerHTML =
                '<td class="admin-licencias-reportes-col-cuenta" colspan="4">' + emptyRowHtml + '</td>';
            tableBody.appendChild(trEmpty);
            return;
        }
        filtered.forEach(function (row) {
            var tr = document.createElement('tr');
            tr.className = 'admin-licencias-reportes-row admin-licencias-reportes-row--link';
            tr.setAttribute('data-user-lic-report-filter', String(row.filterKey || 'all'));
            tr.setAttribute('data-user-lic-report-day', String(row.day != null ? row.day : ''));
            tr.innerHTML =
                '<td class="admin-licencias-reportes-col-cuenta"><code class="admin-licencias-reportes-cred">' +
                escHtml(row.cuenta || '—') +
                '</code></td>' +
                '<td class="admin-licencias-reportes-col-user">' +
                escHtml(row.product || '—') +
                '</td>' +
                '<td class="admin-licencias-reportes-col-status">' +
                escHtml(String(row.day != null ? row.day : '—')) +
                '</td>' +
                '<td class="admin-licencias-reportes-col-action">' +
                escHtml(row.status || '—') +
                '</td>';
            tr.addEventListener('click', function () {
                userLicPortalReportNavigateToRow(outer, row);
            });
            tableBody.appendChild(tr);
        });
    }

    function userLicRenderReportesPanel(outer, preferCache) {
        var panel = document.getElementById('userLicReportesPanel');
        var searchInp = document.getElementById('userLicReportesSearch');
        var metaEl = document.getElementById('userLicReportesMeta');
        var tableBody = document.getElementById('userLicReportesTableBody');
        if (!panel || !searchInp || !metaEl || !tableBody) return;

        var q = String(searchInp.value || '')
            .toLowerCase()
            .trim();

        userLicRenderReportesTableSection(
            outer,
            tableBody,
            metaEl,
            userLicCollectReportEntries(outer, preferCache),
            q,
            '0 incidencias en tus licencias asignadas',
            ' incidencia en tus licencias asignadas',
            ' incidencias en tus licencias asignadas',
            'No hay cuentas con incidencia en tus licencias. Al marcar un estado rojo en una fila, aparecerá aquí.'
        );
        userLicSyncReportesBadge(preferCache);
    }

    function userLicRefreshReportesUi(outer) {
        userLicSyncReportesBadge();
        userLicRefreshProveedorLicenciasExtras(outer);
        if (userLicPortalReportesModeActive(outer)) {
            userLicRenderReportesPanel(outer);
        }
    }

    var userLicReportesPanelWired = false;

    function wireUserLicReportesPanel(outer) {
        if (userLicReportesPanelWired) return;
        var searchInp = document.getElementById('userLicReportesSearch');
        if (!searchInp) return;
        userLicReportesPanelWired = true;
        var debounce = null;
        searchInp.addEventListener('input', function () {
            if (debounce) window.clearTimeout(debounce);
            debounce = window.setTimeout(function () {
                userLicRenderReportesPanel(outer);
            }, 180);
        });
    }

    function renderUserLicenciasGrid(summaryList) {
        var parts = [];

        parts.push(
            '<button type="button" class="license-card license-card--aggregate user-lic-license-card-btn user-lic-license-card--todos" data-user-license-filter="all">' +
            '<div class="license-card-header">' +
            '<h3 class="license-name"><span class="full-text">' +
            escHtml('Todos') +
            '</span><span class="first-letter">T</span></h3>' +
            '</div></button>'
        );

        var idx;
        for (idx = 0; idx < summaryList.length; idx += 1) {
            var s = summaryList[idx];
            var name = s.product_name || '—';

            parts.push(
                '<button type="button" class="license-card user-lic-license-card-btn" data-user-license-filter="' +
                escAttr(s.filterKey) +
                '">' +
                '<div class="license-card-header">' +
                '<h3 class="license-name"><span class="full-text">' +
                escHtml(name) +
                '</span><span class="first-letter">' +
                escHtml(firstLetter(name)) +
                '</span></h3>' +
                '</div></button>'
            );
        }

        if (userLicPortalProveedorEnabled) {
            parts.push(
                '<button type="button" class="license-card user-lic-license-card-btn user-lic-license-card--proveedor" data-user-license-filter="' +
                    USER_LIC_PORTAL_PROVEEDOR_FILTER +
                    '">' +
                    '<div class="license-card-header">' +
                    '<h3 class="license-name"><span class="full-text">' +
                    escHtml('Proveedor') +
                    '</span><span class="first-letter">P</span></h3>' +
                    '</div></button>'
            );
        }

        if (summaryList.length > 0) {
            parts.push(
                '<button type="button" class="license-card license-card--aggregate license-card--panel-toggle user-lic-license-card-btn user-lic-license-card--reportes user-lic-reportes-toggle"' +
                    ' data-user-license-filter="' +
                    USER_LIC_PORTAL_REPORTES_FILTER +
                    '" title="Reportes: incidencias en tus licencias asignadas"' +
                    ' aria-expanded="false" aria-controls="userLicReportesPanel"' +
                    ' aria-label="Reportes: incidencias en tus licencias asignadas">' +
                    '<div class="license-card-header">' +
                    '<h3 class="license-name"><span class="full-text">Reportes</span>' +
                    '<span class="first-letter">R</span>' +
                    '<span id="userLicReportesTotalBadge" class="license-card-report-total-badge" hidden role="status" aria-live="polite">' +
                    '<span class="license-card-report-total-badge__num">0</span></span></h3>' +
                    '</div></button>'
            );
        }

        if (userLicPortalSoporteLicenciasEnabled) {
            var vaVerified = !!userLicVerificarVerified;
            var vaPending = !vaVerified && !!userLicVerificarPending;
            var vaState = vaVerified ? 'verified' : vaPending ? 'pending' : 'normal';
            var vaClass = vaVerified ? ' is-verified' : vaPending ? ' is-pending' : '';
            parts.push(
                '<button type="button" class="license-card license-card--aggregate license-card--panel-toggle user-lic-license-card-btn user-lic-license-card--verificar user-lic-verificar-toggle' +
                    vaClass +
                    '"' +
                    ' data-va-state="' +
                    vaState +
                    '"' +
                    ' data-user-license-filter="' +
                    USER_LIC_PORTAL_VERIFICAR_FILTER +
                    '" title="Verificar/Arreglar: bloc compartido con el administrador"' +
                    ' aria-expanded="false" aria-controls="userLicVerificarPanel"' +
                    ' aria-label="Verificar/Arreglar: bloc compartido con el administrador">' +
                    '<div class="license-card-header">' +
                    '<h3 class="license-name"><span class="full-text">Verificar/Arreglar</span>' +
                    '<span class="first-letter">V</span></h3>' +
                    '</div></button>'
            );
        }

        return parts.join('');
    }

    function setGridVisible(gridHost, show) {
        if (!gridHost) return;
        if (show) {
            gridHost.classList.remove('d-none');
            gridHost.hidden = false;
            gridHost.setAttribute('aria-hidden', 'false');
        } else {
            gridHost.classList.add('d-none');
            gridHost.hidden = true;
            gridHost.setAttribute('aria-hidden', 'true');
        }
    }

    function refreshSheetVisibility(container) {
        var licSel = (container && container.dataset && container.dataset.userLicActiveFilter) || 'all';
        var inp = document.getElementById('userLicenciasSearch');
        var q = inp ? (inp.value || '').trim().toLowerCase() : '';
        var host = container.closest('.user-licencias-shell') || document.body;
        var gh = host.querySelector('#userLicenciasGridHost');
        var gi = gh ? gh.querySelector('#userLicenciasGrid') : null;
        if (licSel === 'vencimientos' || userLicPortalVencimientosActive) {
            container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
                var isVenc = art.classList.contains('user-lic-account-sheet--vencimientos');
                var hay = (art.getAttribute('data-search-filter') || '').trim().toLowerCase();
                var matchQ = !q || hay.indexOf(q) !== -1;
                art.style.display = isVenc && matchQ ? '' : 'none';
            });
            return;
        }
        if (licSel === USER_LIC_PORTAL_REPORTES_FILTER || licSel === USER_LIC_PORTAL_VERIFICAR_FILTER) {
            container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
                art.style.display = 'none';
            });
            if (gi) {
                gi.querySelectorAll('.user-lic-license-card-btn[data-user-license-filter]').forEach(function (card) {
                    card.classList.remove('user-lic-grid-no-match');
                });
            }
            return;
        }
        if (licSel === USER_LIC_PORTAL_PROVEEDOR_FILTER) {
            container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
                var isProv = art.classList.contains('user-lic-account-sheet--proveedor');
                var hay = (art.getAttribute('data-search-filter') || '').trim().toLowerCase();
                var matchQ = !q || hay.indexOf(q) !== -1;
                art.style.display = isProv && matchQ ? '' : 'none';
            });
            if (gi) {
                gi.querySelectorAll('.user-lic-license-card-btn[data-user-license-filter]').forEach(function (card) {
                    card.classList.remove('user-lic-grid-no-match');
                });
            }
            return;
        }
        var visibleByLic = {};
        var hasMergedView = !!container.querySelector('.user-lic-account-sheet--aggregate');
        container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
            if (art.classList.contains('user-lic-account-sheet--proveedor')) {
                art.style.display = 'none';
                return;
            }
            var isAgg = art.classList.contains('user-lic-account-sheet--aggregate');
            var lid = art.getAttribute('data-license-id');
            var hay = (art.getAttribute('data-search-filter') || '').trim().toLowerCase();
            var matchLic = licSel === 'all' || String(lid) === licSel;
            var matchQ = !q || hay.indexOf(q) !== -1;
            var show;
            if (isAgg) {
                show = licSel === 'all' && !q;
            } else if (licSel === 'all' && !q && hasMergedView) {
                show = false;
            } else {
                show = matchLic && matchQ;
            }
            art.style.display = show ? '' : 'none';
            if (show && lid && !isAgg) {
                visibleByLic[String(lid)] = true;
            }
        });

        /* Opacidad en tarjetas de producto sin resultados visibles durante la búsqueda */
        if (!gi || !gh) return;
        gi.querySelectorAll('.user-lic-license-card-btn[data-user-license-filter]').forEach(function (card) {
            var fr = card.getAttribute('data-user-license-filter');
            if (fr === 'all') {
                card.classList.remove('user-lic-grid-no-match');
                return;
            }
            if (!q) {
                card.classList.remove('user-lic-grid-no-match');
                return;
            }
            card.classList.toggle('user-lic-grid-no-match', !visibleByLic[String(fr)]);
        });
    }

    function gridCardByFilterKey(gridHost, key) {
        if (!gridHost || key == null) return null;
        var want = String(key);
        var nodes = gridHost.querySelectorAll('#userLicenciasGrid .user-lic-license-card-btn[data-user-license-filter]');
        var i;
        for (i = 0; i < nodes.length; i += 1) {
            if (nodes[i].getAttribute('data-user-license-filter') === want) {
                return nodes[i];
            }
        }
        return null;
    }

    function persistUserLicPortalServiceFilter(licenseIdSel) {
        try {
            localStorage.setItem(
                USER_LIC_PORTAL_SERVICE_FILTER_KEY,
                licenseIdSel === 'all' || licenseIdSel == null ? 'all' : String(licenseIdSel)
            );
        } catch (_e) {}
    }

    function readPersistedUserLicPortalServiceFilter(gridHost) {
        try {
            var raw = localStorage.getItem(USER_LIC_PORTAL_SERVICE_FILTER_KEY);
            if (raw == null || String(raw).trim() === '') return 'all';
            var s = String(raw).trim();
            if (s === 'all') return 'all';
            if (s === USER_LIC_PORTAL_PROVEEDOR_FILTER) {
                return gridCardByFilterKey(gridHost, USER_LIC_PORTAL_PROVEEDOR_FILTER)
                    ? USER_LIC_PORTAL_PROVEEDOR_FILTER
                    : 'all';
            }
            if (s === USER_LIC_PORTAL_REPORTES_FILTER) {
                return gridCardByFilterKey(gridHost, USER_LIC_PORTAL_REPORTES_FILTER)
                    ? USER_LIC_PORTAL_REPORTES_FILTER
                    : 'all';
            }
            if (s === USER_LIC_PORTAL_VERIFICAR_FILTER) {
                return gridCardByFilterKey(gridHost, USER_LIC_PORTAL_VERIFICAR_FILTER)
                    ? USER_LIC_PORTAL_VERIFICAR_FILTER
                    : 'all';
            }
            if (!gridHost) return 'all';
            return gridCardByFilterKey(gridHost, s) ? s : 'all';
        } catch (_e2) {
            return 'all';
        }
    }

    function applyLicenseFilter(container, gridHost, filterRaw, skipPersist, skipRebuild, skipProveedorFlush) {
        var licenseIdSel = filterRaw === 'all' || filterRaw == null ? 'all' : String(filterRaw);

        if (licenseIdSel !== 'vencimientos') {
            exitCaducidadViewMode();
        }

        var licenseNorm = normalizePortalServiceFilterKey(
            licenseIdSel === 'vencimientos' ? 'all' : licenseIdSel
        );

        function portalRebuildAfterProveedorFlush(rebuildFn) {
            if (!skipRebuild) {
                if (userLicPortalProveedorDirty && !skipProveedorFlush) {
                    var proveedorUrlFlush = container.getAttribute('data-proveedor-url') || '';
                    userLicPortalFlushProveedorSave(container, proveedorUrlFlush).finally(function () {
                        applyLicenseFilter(container, gridHost, filterRaw, skipPersist, skipRebuild, true);
                    });
                    return;
                }
                rebuildFn(!!skipProveedorFlush);
                return;
            }
        }

        if (licenseNorm === USER_LIC_PORTAL_REPORTES_FILTER) {
            container.dataset.userLicActiveFilter = USER_LIC_PORTAL_REPORTES_FILTER;
            if (!skipPersist) {
                persistUserLicPortalServiceFilter(USER_LIC_PORTAL_REPORTES_FILTER);
            }
            if (portalRebuildAfterProveedorFlush(function (forceRebuild) {
                var hostR = container.closest('.user-licencias-shell') || document.body;
                var gridHostElR = gridHost || hostR.querySelector('#userLicenciasGridHost');
                var gridInnerR = gridHostElR ? gridHostElR.querySelector('#userLicenciasGrid') : null;
                rebuildUserLicPortalMainContent(
                    container,
                    hostR,
                    gridInnerR,
                    gridHostElR,
                    { filter: USER_LIC_PORTAL_REPORTES_FILTER },
                    forceRebuild
                );
            })) {
                return;
            }
            userLicPortalSetVerificarMode(false, container);
            userLicPortalSetReportesMode(true, container);
            userLicRenderReportesPanel(container);
            syncServiceFilterGridCards(gridHost, USER_LIC_PORTAL_REPORTES_FILTER);
            userLicCaducidadSyncShellLayoutClass();
            return;
        }

        if (licenseNorm === USER_LIC_PORTAL_VERIFICAR_FILTER) {
            container.dataset.userLicActiveFilter = USER_LIC_PORTAL_VERIFICAR_FILTER;
            if (!skipPersist) {
                persistUserLicPortalServiceFilter(USER_LIC_PORTAL_VERIFICAR_FILTER);
            }
            if (portalRebuildAfterProveedorFlush(function (forceRebuild) {
                var hostV = container.closest('.user-licencias-shell') || document.body;
                var gridHostElV = gridHost || hostV.querySelector('#userLicenciasGridHost');
                var gridInnerV = gridHostElV ? gridHostElV.querySelector('#userLicenciasGrid') : null;
                rebuildUserLicPortalMainContent(
                    container,
                    hostV,
                    gridInnerV,
                    gridHostElV,
                    { filter: USER_LIC_PORTAL_VERIFICAR_FILTER },
                    forceRebuild
                );
            })) {
                return;
            }
            userLicPortalSetReportesMode(false, container);
            userLicPortalSetVerificarMode(true, container);
            wireUserLicVerificarPanel(container);
            void userLicVerificarFetchFromServer();
            syncServiceFilterGridCards(gridHost, USER_LIC_PORTAL_VERIFICAR_FILTER);
            userLicCaducidadSyncShellLayoutClass();
            return;
        }

        userLicPortalSetReportesMode(false, container);
        userLicPortalSetVerificarMode(false, container);

        container.dataset.userLicActiveFilter = licenseNorm;
        delete container.dataset.userLicCaducidadServiceFilter;
        if (!skipPersist) {
            persistUserLicPortalServiceFilter(licenseNorm);
        }

        if (portalRebuildAfterProveedorFlush(function (forceRebuild) {
            var hostR = container.closest('.user-licencias-shell') || document.body;
            var gridHostElR = gridHost || hostR.querySelector('#userLicenciasGridHost');
            var gridInnerR = gridHostElR ? gridHostElR.querySelector('#userLicenciasGrid') : null;
            rebuildUserLicPortalMainContent(
                container,
                hostR,
                gridInnerR,
                gridHostElR,
                { filter: licenseNorm },
                forceRebuild
            );
        })) {
            return;
        }

        refreshSheetVisibility(container);
        syncServiceFilterGridCards(gridHost, licenseNorm);
        userLicCaducidadSyncShellLayoutClass();
    }

    function wireGridClick(gridInner, outer) {
        if (!gridInner || !outer) return;
        gridInner.addEventListener('click', function (e) {
            var btn = e.target.closest('.user-lic-license-card-btn');
            if (!btn || !gridInner.contains(btn)) return;
            var filt = btn.getAttribute('data-user-license-filter');
            if (filt == null) return;
            var host = outer.closest('.user-licencias-shell') || document.body;
            var gridHostResolved = host.querySelector('#userLicenciasGridHost');
            var norm = filt === 'all' || filt == null ? 'all' : String(filt);
            applyLicenseFilter(outer, gridHostResolved, norm);
        });
    }

    function scrollDayWithinArticle(article, dayRaw) {
        if (!article) return;
        var target = String(dayRaw == null ? '' : dayRaw).trim();
        if (!target) target = '1';
        var sections = article.querySelectorAll('.user-lic-readonly-day[data-user-day]');
        var sec = null;
        var i;
        for (i = 0; i < sections.length; i += 1) {
            if (sections[i].getAttribute('data-user-day') === target) {
                sec = sections[i];
                break;
            }
        }
        if (!sec && /^\d+$/.test(target)) {
            var d = Math.max(1, Math.min(31, Number(target)));
            for (i = 0; i < sections.length; i += 1) {
                if (sections[i].getAttribute('data-user-day') === String(d)) {
                    sec = sections[i];
                    break;
                }
            }
        }
        if (sec && typeof sec.scrollIntoView === 'function') {
            try {
                sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (err) {
                try {
                    sec.scrollIntoView(true);
                } catch (err2) {
                    /* ignore */
                }
            }
        }
    }

    function wireScrollButtons(outer) {
        outer.addEventListener('click', function (e) {
            var headerToggle = e.target.closest('.user-lic-day-header-toggle');
            if (headerToggle && outer.contains(headerToggle)) {
                if (e.target.closest('.day-account-badge') || e.target.closest('.admin-licencias-toggle-notes-col-btn')) return;
                var section = headerToggle.closest('.day-section');
                var bundle = headerToggle.closest('.user-lic-bundle-wrap');
                var art = headerToggle.closest('.user-lic-account-sheet');
                if (section && bundle && art) {
                    section.classList.toggle('collapsed');
                    var isCollapsedNow = section.classList.contains('collapsed');
                    var dAttr = section.getAttribute('data-user-day');
                    if (dAttr != null) {
                        userLicPortalPersistDayCollapsed(art, dAttr, isCollapsedNow);
                    }
                    headerToggle.setAttribute('aria-expanded', isCollapsedNow ? 'false' : 'true');
                    if (
                        (section.classList.contains('user-lic-proveedor-day') ||
                            section.classList.contains('user-lic-proveedor-lic-bloc')) &&
                        !isCollapsedNow
                    ) {
                        userLicProveedorInitSplitBlocks(outer);
                    }
                    userLicPortalSyncExpandAllToolbar(bundle);
                }
                return;
            }

            var headBtn = e.target.closest('.user-lic-inv-scrolltop');
            var rowBtn = e.target.closest('.user-lic-row-to-day-btn');
            var tgt = headBtn || rowBtn;
            if (!tgt || !outer.contains(tgt)) return;

            var art = tgt.closest('.user-lic-account-sheet');
            if (!art) return;

            var day = tgt.getAttribute('data-scroll-day');
            if (day == null) {
                day = art.getAttribute('data-default-scroll-day') || '1';
            }
            scrollDayWithinArticle(art, day);
        });
    }

    function setupCollapseButton() {
        var collapseBtn = document.getElementById('licensesCollapseBtn');
        var collapseIcon = document.getElementById('collapseIcon');
        var licenciasContainer = document.getElementById('userLicenciasGridHost');
        
        if (collapseBtn && licenciasContainer && collapseIcon) {
            var savedState = portalMainGridCollapsedRead();
            if (savedState === 'true') {
                licenciasContainer.classList.add('collapsed');
                collapseIcon.classList.remove('fa-chevron-up');
                collapseIcon.classList.add('fa-chevron-down');
            } else {
                licenciasContainer.classList.remove('collapsed');
                collapseIcon.classList.remove('fa-chevron-down');
                collapseIcon.classList.add('fa-chevron-up');
            }
            
            var newCollapseBtn = collapseBtn.cloneNode(true);
            if (collapseBtn.parentNode) {
                collapseBtn.parentNode.replaceChild(newCollapseBtn, collapseBtn);
            }
            
            newCollapseBtn.addEventListener('click', function() {
                licenciasContainer.classList.toggle('collapsed');
                var icon = document.getElementById('collapseIcon');
                if (icon) {
                    if (licenciasContainer.classList.contains('collapsed')) {
                        icon.classList.remove('fa-chevron-up');
                        icon.classList.add('fa-chevron-down');
                        portalMainGridCollapsedWrite(true);
                    } else {
                        icon.classList.remove('fa-chevron-down');
                        icon.classList.add('fa-chevron-up');
                        portalMainGridCollapsedWrite(false);
                    }
                }
            });
        }
    }

    function wireSearchFilter(root) {
        var inp = document.getElementById('userLicenciasSearch');
        if (!inp) return;
        inp.addEventListener('input', function () {
            refreshSheetVisibility(root);
            userLicRefreshProveedorLicenciasExtras(root);
        });
    }

    function wireUserLicWarrantyHistoryModal(shellEl, dataOuterEl) {
        if (!shellEl || !dataOuterEl) return;
        var modal = document.getElementById('userLicWarrantyModal');
        var bodyEl = document.getElementById('userLicWarrantyModalBody');
        var closeBtn = document.getElementById('userLicWarrantyModalClose');
        var backdrop = document.getElementById('userLicWarrantyModalBackdrop');
        if (!modal || !bodyEl) return;

        var baseUrl =
            dataOuterEl.getAttribute('data-warranty-incidents-url') ||
            '/tienda/api/user/license-warranty-incidents';

        function closeModal() {
            modal.classList.add('d-none');
            modal.setAttribute('aria-hidden', 'true');
            bodyEl.innerHTML = '';
        }

        function openModal(row) {
            if (!row) return;
            var lid = Number(row.getAttribute('data-lic-row-license-id'));
            var dayNum = Number(row.getAttribute('data-lic-row-day'));
            var ordinal = Number(row.getAttribute('data-lic-row-ordinal'));
            var aidRaw = row.getAttribute('data-lic-row-account-id');
            if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(dayNum) || !Number.isFinite(ordinal)) {
                return;
            }
            var qs = new URLSearchParams();
            qs.set('license_id', String(lid));
            qs.set('calendar_day', String(dayNum));
            qs.set('row_ordinal', String(ordinal));
            if (aidRaw != null && String(aidRaw).trim() !== '') {
                qs.set('account_id', String(aidRaw).trim());
            }

            bodyEl.innerHTML =
                '<p class="user-lic-warranty-modal__loading mb-0">Cargando historial…</p>';
            modal.classList.remove('d-none');
            modal.setAttribute('aria-hidden', 'false');

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
                    var html =
                        '<ul class="user-lic-warranty-modal__list list-unstyled mb-0">';
                    data.incidents.forEach(function (it) {
                        var det = it.detail ? String(it.detail).trim() : '';
                        html +=
                            '<li class="user-lic-warranty-modal__item">' +
                            '<span class="user-lic-warranty-modal__date">' +
                            escHtml(it.fecha_col || '') +
                            '</span>' +
                            ' · <span class="user-lic-warranty-modal__tipo">' +
                            escHtml(it.tipo_label || '') +
                            '</span>' +
                            '<div class="user-lic-warranty-modal__summary">' +
                            escHtml(it.summary || '') +
                            '</div>';
                        if (det) {
                            html +=
                                '<div class="user-lic-warranty-modal__detail text-muted small">' +
                                escHtml(det) +
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

        shellEl.addEventListener(
            'click',
            function (ev) {
                var btn = ev.target.closest('.user-lic-warranty-history-btn');
                if (!btn || !dataOuterEl.contains(btn)) return;
                ev.preventDefault();
                openModal(btn.closest('.user-lic-license-row-edit'));
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

    function wireUserLicFullCredModal(shellEl, dataOuterEl) {
        if (!shellEl || !dataOuterEl) return;
        var modal = document.getElementById('userLicFullCredModal');
        var dialog = document.getElementById('userLicFullCredModalDialog');
        var pre = document.getElementById('userLicFullCredModalPre');
        var productLine = document.getElementById('userLicFullCredModalProductLine');
        var dayNumEl = document.getElementById('userLicFullCredModalDayNum');
        var goodHintEl = document.getElementById('userLicFullCredModalGoodHint');
        var copyBtn = document.getElementById('userLicFullCredModalCopyBtn');
        var closeBtn = document.getElementById('userLicFullCredModalClose');
        var backdrop = document.getElementById('userLicFullCredModalBackdrop');
        if (!modal || !pre) return;

        function copyPlainToClipboard(plain) {
            var t = normalizeLicenseClipboardText(plain != null ? String(plain) : '');
            if (!t) return;
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(t).catch(function () {
                    try {
                        var x = document.createElement('textarea');
                        x.id = 'userLicClipboardFallback';
                        x.name = 'userLicClipboardFallback';
                        x.value = t;
                        x.setAttribute('readonly', '');
                        x.style.position = 'fixed';
                        x.style.left = '-9999px';
                        document.body.appendChild(x);
                        x.select();
                        document.execCommand('copy');
                        document.body.removeChild(x);
                    } catch (eC) {
                        /* ignore */
                    }
                });
            } else {
                try {
                    var x2 = document.createElement('textarea');
                    x2.id = 'userLicClipboardFallback';
                    x2.name = 'userLicClipboardFallback';
                    x2.value = t;
                    x2.setAttribute('readonly', '');
                    x2.style.position = 'fixed';
                    x2.style.left = '-9999px';
                    document.body.appendChild(x2);
                    x2.select();
                    document.execCommand('copy');
                    document.body.removeChild(x2);
                } catch (eC2) {
                    /* ignore */
                }
            }
        }

        if (copyBtn && !copyBtn.getAttribute('data-user-lic-copy-wired')) {
            copyBtn.setAttribute('data-user-lic-copy-wired', '1');
            copyBtn.addEventListener('click', function () {
                var plain = pre.getAttribute('data-lic-plain') || '';
                copyPlainToClipboard(plain);
            });
        }

        function closeModal() {
            modal.classList.add('d-none');
            modal.setAttribute('aria-hidden', 'true');
            pre.textContent = '';
            pre.removeAttribute('data-lic-plain');
            if (productLine) productLine.textContent = '';
            if (dayNumEl) dayNumEl.textContent = '';
            if (goodHintEl) goodHintEl.textContent = '';
            if (dialog) dialog.removeAttribute('aria-label');
        }

        function openModal(row) {
            if (!row) return;
            var root = row.closest('.day-license-split-root');
            var ta = root ? root.querySelector('textarea.user-lic-creds-ro') : null;
            if (!ta) return;
            var li = Number(row.getAttribute('data-lic-creds-line-index'));
            if (!Number.isFinite(li) || li < 0) li = 0;
            var lines = String(ta.value || '').split(/\r?\n/);
            var text = lines[li] !== undefined ? lines[li] : '';
            var dayAttr = row.getAttribute('data-lic-row-day');
            var dayNum = Number(dayAttr);
            var dayLabel =
                dayAttr != null && String(dayAttr).trim() !== '' && Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 31
                    ? 'Día ' + String(dayNum)
                    : dayAttr != null && String(dayAttr).trim() !== ''
                      ? 'Día ' + String(dayAttr).trim()
                      : '';

            var sgSel = row.querySelector('.license-split-editor__status-good');
            var sgVal = sgSel ? String(sgSel.value || '').trim() : '';
            var goodHint = userLicPortalGoodHintForModal(sgVal);

            var pnameFromData = row.getAttribute('data-lic-product-label');
            var productShown =
                pnameFromData != null && String(pnameFromData).trim() !== '' ? String(pnameFromData).trim() : '';
            if (!productShown) {
                var chip = row.querySelector('.user-lic-row-product-name');
                productShown = chip ? String(chip.textContent || '').trim() : '';
            }

            if (productLine) productLine.textContent = productShown || '—';
            if (dayNumEl) dayNumEl.textContent = dayLabel;
            if (goodHintEl) goodHintEl.textContent = goodHint ? ' · ' + goodHint : '';

            if (dialog) {
                var a11y =
                    (productShown ? productShown : 'Cuenta') +
                    (dayLabel ? ', ' + dayLabel : '') +
                    (goodHint ? ', ' + goodHint : '');
                dialog.setAttribute('aria-label', a11y);
            }

            var displayText = text.length ? text : '(Sin texto en esta línea)';
            pre.textContent = displayText;
            if (text.length) {
                pre.setAttribute('data-lic-plain', text);
            } else {
                pre.removeAttribute('data-lic-plain');
            }
            modal.classList.remove('d-none');
            modal.setAttribute('aria-hidden', 'false');
            try {
                pre.focus();
            } catch (eFc) {
                /* ignore */
            }
        }

        shellEl.addEventListener(
            'click',
            function (ev) {
                var btn = ev.target.closest('.user-lic-full-cred-trigger');
                if (!btn || !dataOuterEl.contains(btn)) return;
                ev.preventDefault();
                openModal(btn.closest('.user-lic-license-row-edit'));
            },
            false
        );

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (backdrop) backdrop.addEventListener('click', closeModal);

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

    function fetchUserLicPortalJson(apiUrl) {
        return fetch(apiUrl, {
            credentials: 'same-origin',
            cache: 'no-store',
        }).then(function (r) {
            return r.text().then(function (t) {
                var data = {};
                try {
                    data = t ? JSON.parse(t) : {};
                } catch (eParse) {
                    data = { success: false, error: 'Respuesta inválida del servidor' };
                }
                return { httpOk: r.ok, data: data };
            });
        });
    }

    function userLicProveedorCollectExtraFromSection(outer, kind) {
        var sel =
            kind === 'suspended' ? '.user-lic-proveedor-caidas' : '.user-lic-proveedor-vencidas';
        var section = outer ? outer.querySelector(sel) : null;
        var block = section ? section.querySelector('.user-lic-proveedor-extra-split') : null;
        if (!block) return [];
        var ta = block.querySelector('.user-lic-proveedor-extra-creds');
        if (!ta) return [];
        var credLines = String(ta.value || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter(function (ln) {
                return String(ln).trim() !== '';
            });
        var out = [];
        credLines.forEach(function (cred, idx) {
            var rowEl = block.querySelectorAll('.user-lic-proveedor-extra-row')[idx];
            var selEl = rowEl ? rowEl.querySelector('.user-lic-proveedor-service-select') : null;
            var dayInp = rowEl ? rowEl.querySelector('.user-lic-proveedor-extra-day-input') : null;
            var entry = {
                service: userLicProveedorNormalizeServiceId(
                    selEl && selEl.value != null ? selEl.value : PROVEEDOR_SERVICE_ANONIMO
                ),
                cred: String(cred).trim(),
            };
            if (dayInp && String(dayInp.value || '').trim() !== '') {
                var d = parseInt(dayInp.value, 10);
                if (Number.isFinite(d) && d >= 1 && d <= 31) entry.sale_day = d;
            }
            out.push(entry);
        });
        return out;
    }

    function userLicPortalCollectProveedorFromDom(outer) {
        var out = {
            license_lines: [],
            expired_lines: [],
            suspended_lines: [],
            day_lines: userLicPortalProveedorCache.day_lines || {},
        };
        if (!outer) return out;
        var visibleLic = userLicProveedorCollectLinesFromBlock(outer, 'license', null);
        var hiddenGar = Array.isArray(userLicProveedorHiddenGarLines)
            ? userLicProveedorHiddenGarLines
            : [];
        out.license_lines = visibleLic.concat(hiddenGar);
        out.expired_lines = userLicProveedorCollectExtraFromSection(outer, 'expired');
        out.suspended_lines = userLicProveedorCollectExtraFromSection(outer, 'suspended');
        out.license_notes = userLicProveedorLinesToCredsText(out.license_lines);
        return out;
    }

    function userLicPortalMergeProveedorCache(payload) {
        if (!payload || typeof payload !== 'object') return;
        if (Array.isArray(payload.services_catalog) && payload.services_catalog.length) {
            userLicPortalProveedorCache.services_catalog = payload.services_catalog;
        } else if (!userLicPortalProveedorCache.services_catalog.length) {
            userLicPortalProveedorCache.services_catalog = userLicProveedorDefaultCatalog();
        }
        userLicPortalProveedorCache.license_lines = userLicProveedorNormalizeLineEntries(
            payload.license_lines,
            payload.license_notes
        );
        userLicPortalProveedorCache.day_lines = userLicProveedorNormalizeDayLinesMap(
            payload.day_lines,
            payload.day_notepads
        );
        userLicPortalProveedorCache.license_notes = userLicProveedorLinesToCredsText(
            userLicPortalProveedorCache.license_lines
        );
        var outDays = {};
        var d;
        for (d = 1; d <= 31; d += 1) {
            var k = String(d);
            outDays[k] = userLicProveedorLinesToCredsText(
                userLicPortalProveedorCache.day_lines[k] || []
            );
        }
        userLicPortalProveedorCache.day_notepads = outDays;
        userLicPortalProveedorCache.expired_lines = userLicProveedorNormalizeExtraLineEntries(
            payload.expired_lines,
            payload.expired_notes
        );
        userLicPortalProveedorCache.suspended_lines = userLicProveedorNormalizeExtraLineEntries(
            payload.suspended_lines,
            payload.suspended_notes
        );
    }

    function userLicPortalSaveProveedorNow(outer, proveedorUrl) {
        if (!proveedorUrl || !userLicPortalProveedorEnabled || !outer) {
            return Promise.resolve(false);
        }
        var body = userLicPortalCollectProveedorFromDom(outer);
        userLicPortalProveedorSaveInFlight = true;
        return fetch(proveedorUrl, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: userLicJsonHeaders(),
            body: JSON.stringify({
                license_lines: body.license_lines,
                license_notes: body.license_notes,
                expired_lines: body.expired_lines,
                suspended_lines: body.suspended_lines,
            }),
        })
            .then(function (r) {
                return r.json().catch(function () {
                    return { success: false };
                });
            })
            .then(function (data) {
                userLicPortalProveedorSaveInFlight = false;
                if (data && data.success) {
                    userLicPortalMergeProveedorCache(data);
                    userLicPortalClearProveedorDirty();
                    userLicRefreshProveedorLicenciasExtras(outer);
                    return true;
                }
                return false;
            })
            .catch(function () {
                userLicPortalProveedorSaveInFlight = false;
                return false;
            });
    }

    function userLicPortalFlushProveedorSave(outer, proveedorUrl) {
        clearTimeout(userLicPortalProveedorSaveTimer);
        userLicPortalProveedorSaveTimer = null;
        if (!userLicPortalProveedorDirty) return Promise.resolve(true);
        return userLicPortalSaveProveedorNow(outer, proveedorUrl);
    }

    function userLicPortalScheduleProveedorSave(outer, proveedorUrl) {
        if (!proveedorUrl || !userLicPortalProveedorEnabled) return;
        userLicPortalMarkProveedorDirty();
        clearTimeout(userLicPortalProveedorSaveTimer);
        userLicPortalProveedorSaveTimer = window.setTimeout(function () {
            userLicPortalSaveProveedorNow(outer, proveedorUrl);
        }, SAVE_DEBOUNCE_MS);
    }

    function userLicPortalWireProveedorEditors(outer) {
        if (!outer || !userLicPortalProveedorEnabled) return;
        if (userLicPortalIsViewOnly(outer)) {
            userLicPortalApplyViewOnlyUi(outer);
            return;
        }
        userLicProveedorInitSplitBlocks(outer);
        userLicProveedorInitEditableBlocks(outer);
        userLicRefreshProveedorLicenciasExtras(outer);
        if (!userLicPortalProveedorEditorWired) {
            userLicPortalProveedorEditorWired = true;
            document.addEventListener(
                'input',
                function (ev) {
                    var ta = ev.target;
                    if (!ta || ta.tagName !== 'TEXTAREA') return;
                    var sheet = ta.closest('.user-lic-account-sheet--proveedor');
                    if (!sheet) return;
                    var tableOuter = sheet.closest('#userLicenciasTableOuter');
                    if (!tableOuter || !userLicPortalProveedorEnabled) return;
                    var proveedorUrl = tableOuter.getAttribute('data-proveedor-url') || '';
                    if (ta.classList.contains('user-lic-proveedor-creds-ta')) {
                        var block = ta.closest('.user-lic-proveedor-split, .user-lic-proveedor-extra-split');
                        if (block && block.dataset.proveedorBlock === 'license') {
                            userLicProveedorSyncServiceRowsForBlock(tableOuter, 'license', null);
                            userLicPortalScheduleProveedorSave(tableOuter, proveedorUrl);
                        } else if (block && block.classList.contains('user-lic-proveedor-extra-split')) {
                            var kind = block.closest('.user-lic-proveedor-vencidas')
                                ? 'expired'
                                : block.closest('.user-lic-proveedor-caidas')
                                  ? 'suspended'
                                  : null;
                            var section =
                                kind === 'expired'
                                    ? tableOuter.querySelector('.user-lic-proveedor-vencidas')
                                    : kind === 'suspended'
                                      ? tableOuter.querySelector('.user-lic-proveedor-caidas')
                                      : null;
                            if (section && kind) {
                                userLicProveedorExtraSyncRowsToCredLines(section, kind);
                                userLicPortalScheduleProveedorSave(tableOuter, proveedorUrl);
                            }
                        }
                    }
                },
                false
            );
            document.addEventListener(
                'change',
                function (ev) {
                    var el = ev.target;
                    if (!el || !el.classList) return;
                    var sheet = el.closest('.user-lic-account-sheet--proveedor');
                    if (!sheet) return;
                    var tableOuter = sheet.closest('#userLicenciasTableOuter');
                    if (!tableOuter || !userLicPortalProveedorEnabled) return;
                    if (
                        el.classList.contains('user-lic-proveedor-service-select') ||
                        el.classList.contains('user-lic-proveedor-extra-day-input')
                    ) {
                        userLicPortalScheduleProveedorSave(
                            tableOuter,
                            tableOuter.getAttribute('data-proveedor-url') || ''
                        );
                    }
                },
                false
            );
            document.addEventListener(
                'focusout',
                function (ev) {
                    var ta = ev.target;
                    if (!ta || ta.tagName !== 'TEXTAREA') return;
                    if (
                        !ta.classList.contains('user-lic-proveedor-creds-ta') &&
                        !ta.classList.contains('user-lic-proveedor-extra-creds')
                    ) {
                        return;
                    }
                    var sheet = ta.closest('.user-lic-account-sheet--proveedor');
                    if (!sheet) return;
                    var tableOuter = sheet.closest('#userLicenciasTableOuter');
                    if (!tableOuter || !userLicPortalProveedorEnabled) return;
                    window.setTimeout(function () {
                        var active = document.activeElement;
                        if (active && sheet.contains(active)) return;
                        if (!userLicPortalProveedorDirty) return;
                        userLicPortalFlushProveedorSave(
                            tableOuter,
                            tableOuter.getAttribute('data-proveedor-url') || ''
                        );
                    }, 0);
                },
                false
            );
        }
        var expandBtn = outer.querySelector('.user-lic-proveedor-days-expand-all');
        if (expandBtn && expandBtn.getAttribute('data-prov-expand-wired') !== '1') {
            expandBtn.setAttribute('data-prov-expand-wired', '1');
            expandBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var wrap = outer.querySelector('.user-lic-proveedor-wrap');
                if (!wrap) return;
                var art = outer.querySelector('.user-lic-account-sheet--proveedor');
                var sections = wrap.querySelectorAll('.user-lic-proveedor-day[data-user-day]');
                var anyOpen = false;
                sections.forEach(function (sec) {
                    if (!sec.classList.contains('collapsed')) anyOpen = true;
                });
                sections.forEach(function (sec) {
                    if (anyOpen) sec.classList.add('collapsed');
                    else sec.classList.remove('collapsed');
                    var day = sec.getAttribute('data-user-day');
                    if (day != null && art) {
                        userLicPortalPersistDayCollapsed(art, day, sec.classList.contains('collapsed'));
                    }
                });
                if (!anyOpen) userLicProveedorInitSplitBlocks(outer);
                userLicPortalSyncExpandAllToolbar(wrap);
            });
        }
    }

    function userLicPortalLoadProveedorInventory(proveedorUrl) {
        if (!proveedorUrl) return Promise.resolve(false);
        return fetchUserLicPortalJson(proveedorUrl).then(function (res) {
            if (!res.httpOk || !res.data || !res.data.success) return false;
            userLicPortalMergeProveedorCache(res.data);
            return true;
        });
    }

    var userLicProveedorProductsCache = [];

    function userLicSyncProveedorGestionarProductosBtn(visible) {
        var btn = document.getElementById('btnUserProveedorGestionarProductos');
        if (!btn) return;
        if (visible) {
            btn.classList.remove('d-none');
            btn.hidden = false;
        } else {
            btn.classList.add('d-none');
            btn.hidden = true;
        }
    }

    function userLicCloseProveedorGestionarProductosModal() {
        var modal = document.getElementById('userProveedorGestionarProductosModal');
        if (modal) modal.remove();
    }

    function userLicProveedorWarrantyUi(wd) {
        var n = parseInt(wd, 10);
        return Number.isFinite(n) && n >= 0 ? String(n) : '0';
    }

    /**
     * Contador de badge Licencias del proveedor: vendibles (líneas − gar. por servicio),
     * igual criterio que tienda pública. Anónimo no resta gar.
     */
    function userLicProveedorSellableLicenseCount(licLines) {
        // licLines ya viene filtrado (sin colchón); el badge es su longitud.
        return userLicProveedorCountStructuredLines(licLines);
    }

    function userLicProveedorRefreshLicBlocBadge() {
        var sheet = document.querySelector('.user-lic-account-sheet--proveedor');
        if (!sheet) return;
        var badge = sheet.querySelector('.user-lic-proveedor-lic-bloc .admin-licencias-notepad-line-badge');
        if (!badge) return;
        var licLines = userLicProveedorLinesForBlock('license', null);
        var sellable = userLicProveedorSellableLicenseCount(licLines);
        var rawN = sellable + (userLicProveedorHiddenGarLines || []).length;
        badge.textContent = String(sellable);
        badge.title =
            sellable === 1
                ? '1 vendible (igual que tienda)'
                : sellable +
                  ' vendibles (igual que tienda)' +
                  (rawN > sellable ? ' · ' + rawN + ' en inventario (resto en gar. ocultas)' : '');
    }

    function userLicProveedorRerenderLicenseBlock() {
        var outer = document.getElementById('userLicenciasTableOuter');
        if (!outer) return;
        var section = outer.querySelector('.user-lic-proveedor-lic-bloc');
        if (!section) return;
        var body =
            section.querySelector('.user-lic-proveedor-lic-body') ||
            section.querySelector('.day-accounts-list');
        var header = section.querySelector('.admin-licencias-bloc-header');
        var html = userLicProveedorRenderSplitBlockHtml('license', null);
        if (body) {
            body.innerHTML = html;
        } else {
            var oldSplit = section.querySelector('.user-lic-proveedor-split');
            if (oldSplit) oldSplit.remove();
            if (header) {
                header.insertAdjacentHTML('afterend', html);
            } else {
                section.insertAdjacentHTML('beforeend', html);
            }
        }
        userLicProveedorSyncServiceRowsForBlock(outer, 'license', null);
        var block = section.querySelector('.user-lic-proveedor-split');
        if (block) userLicProveedorScheduleAutosizeCredsForBlock(block);
        userLicProveedorRefreshLicBlocBadge();
    }

    function userLicRenderProveedorGestionarProductosModal(products) {
        userLicCloseProveedorGestionarProductosModal();
        var list = Array.isArray(products) ? products.slice() : [];
        if (!list.length) {
            window.alert('No tienes productos asignados como proveedor.');
            return;
        }
        var rowsHtml = list
            .map(function (p) {
                var name = escHtml(String(p.product_name || 'Producto'));
                var searchName = escAttr(
                    typeof gestionProductosNormalizeSearchQuery === 'function'
                        ? gestionProductosNormalizeSearchQuery(p.product_name || 'Producto')
                        : String(p.product_name || 'Producto')
                              .trim()
                              .toLowerCase()
                );
                var lid = escAttr(String(p.license_id != null ? p.license_id : ''));
                var gar = userLicProveedorWarrantyUi(p.warranty_days);
                return (
                    '<div class="producto-item gestion-productos-item user-proveedor-gestion-productos-item" data-license-id="' +
                    lid +
                    '" data-search-name="' +
                    searchName +
                    '">' +
                    '<div class="gestion-productos-item-name">' +
                    '<strong title="' +
                    name +
                    '">' +
                    name +
                    '</strong>' +
                    '</div>' +
                    '<div class="gestion-productos-item-actions">' +
                    '<button type="button" class="gestion-productos-btn user-proveedor-gestion-gar-btn" data-action="change-proveedor-product-warranty" data-license-id="' +
                    lid +
                    '" title="Cambiar reserva de garantía (gar.: cuentas no vendibles)">' +
                    'gar. <span class="gestion-productos-position-span">' +
                    escHtml(gar) +
                    '</span></button>' +
                    '</div></div>'
                );
            })
            .join('');
        var modalHtml =
            '<div class="modal-overlay" id="userProveedorGestionarProductosModal">' +
            '<div class="gestion-productos-modal-inner" role="dialog" aria-modal="true" aria-labelledby="userProveedorGestionProductosTitulo">' +
            '<div class="gestion-productos-modal-content">' +
            '<div class="gestion-productos-modal-header">' +
            '<h3 id="userProveedorGestionProductosTitulo"><i class="fas fa-list"></i> Gestionar productos</h3>' +
            '<button type="button" class="gestion-productos-modal-close user-proveedor-gestion-productos-close" aria-label="Cerrar">&times;</button>' +
            '</div>' +
            '<div class="gestion-productos-search-wrap">' +
            '<label class="sr-only" for="userProveedorGestionProductosSearch">Buscar producto</label>' +
            '<input type="search" id="userProveedorGestionProductosSearch" class="gestion-productos-search-input" placeholder="Buscar producto…" autocomplete="off" spellcheck="false" aria-label="Buscar producto en la lista" />' +
            '</div>' +
            '<p class="gestion-productos-search-empty" hidden role="status">No hay productos que coincidan con la búsqueda.</p>' +
            '<p class="admin-licencias-reportes-hint user-proveedor-gestion-productos-hint mb-2">Reserva gar.: cuentas de tu inventario que quedan apartadas como garantía (no vendibles).</p>' +
            '<div class="gestion-productos-list" id="userProveedorGestionProductosList">' +
            rowsHtml +
            '</div></div></div></div>';
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        var overlay = document.getElementById('userProveedorGestionarProductosModal');
        if (!overlay) return;
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) userLicCloseProveedorGestionarProductosModal();
        });
        var closeBtn = overlay.querySelector('.user-proveedor-gestion-productos-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                userLicCloseProveedorGestionarProductosModal();
            });
        }
        if (typeof gestionProductosWireSearch === 'function') {
            gestionProductosWireSearch(overlay);
        }
        var listEl = document.getElementById('userProveedorGestionProductosList');
        if (listEl) {
            listEl.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-action="change-proveedor-product-warranty"]');
                if (!btn) return;
                e.preventDefault();
                userLicChangeProveedorProductWarranty(btn, overlay);
            });
        }
    }

    function userLicFetchProveedorProducts(productsUrl) {
        return fetchUserLicPortalJson(productsUrl).then(function (res) {
            if (!res.httpOk || !res.data || !res.data.success) {
                throw new Error(
                    (res.data && (res.data.error || res.data.message)) ||
                        'No se pudieron cargar los productos.'
                );
            }
            userLicProveedorProductsCache = Array.isArray(res.data.products) ? res.data.products : [];
            return userLicProveedorProductsCache;
        });
    }

    function userLicOpenProveedorGestionarProductosModal(productsUrl) {
        if (!productsUrl) {
            window.alert('No hay URL de productos configurada.');
            return;
        }
        userLicFetchProveedorProducts(productsUrl)
            .then(function (products) {
                userLicRenderProveedorGestionarProductosModal(products);
            })
            .catch(function (err) {
                window.alert(err && err.message ? err.message : 'Error al cargar productos.');
            });
    }

    function userLicChangeProveedorProductWarranty(btn, overlay) {
        var lid = parseInt(btn.getAttribute('data-license-id'), 10);
        if (!Number.isFinite(lid) || lid <= 0) return;
        var item = userLicProveedorProductsCache.find(function (p) {
            return Number(p.license_id) === lid;
        });
        var current = item ? userLicProveedorWarrantyUi(item.warranty_days) : '0';
        var raw = window.prompt(
            'Número de cuentas en reserva garantía (gar., no vendibles):',
            String(current)
        );
        if (raw === null || String(raw).trim() === '') return;
        var n = parseInt(String(raw).trim(), 10);
        if (Number.isNaN(n) || n < 0 || n > 3650) {
            window.alert('Introduce un número entre 0 y 3650 (cuentas).');
            return;
        }
        var outer = document.getElementById('userLicenciasTableOuter');
        var base =
            (outer && outer.getAttribute('data-proveedor-products-url')) ||
            '/tienda/api/user/proveedor-products';
        var url = base.replace(/\/$/, '') + '/' + encodeURIComponent(String(lid)) + '/warranty';
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: userLicJsonHeaders(),
            body: JSON.stringify({ warranty_days: n }),
        })
            .then(function (r) {
                return r.json().catch(function () {
                    return { success: false };
                });
            })
            .then(function (data) {
                if (!data || !data.success) {
                    window.alert(
                        (data && data.error) || 'Error al guardar la reserva gar.'
                    );
                    return;
                }
                if (item) item.warranty_days = n;
                var span = btn.querySelector('.gestion-productos-position-span');
                if (span) span.textContent = String(n);
                userLicProveedorRerenderLicenseBlock();
            })
            .catch(function () {
                window.alert('Error de conexión al guardar la reserva gar.');
            });
    }

    function wireUserLicProveedorGestionarProductos(outer) {
        var btn = document.getElementById('btnUserProveedorGestionarProductos');
        if (!btn || btn.getAttribute('data-prov-gestion-wired') === '1') return;
        btn.setAttribute('data-prov-gestion-wired', '1');
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var productsUrl =
                (outer && outer.getAttribute('data-proveedor-products-url')) ||
                '/tienda/api/user/proveedor-products';
            userLicOpenProveedorGestionarProductosModal(productsUrl);
            var menu = document.getElementById('mobileMenu');
            var overlayMenu = document.getElementById('menuOverlay');
            if (menu) menu.classList.add('hidden');
            if (overlayMenu) overlayMenu.classList.remove('active');
        });
    }

    /**
     * @param {object|null} persistUi — si no es null: filter ('all' | clave) y texto de búsqueda.
     */
    /** ¿La cuenta tiene al menos una línea visible en algún día? Sin líneas no hay nada
        que mostrar (cuenta vieja o retirada de los blocs): el producto no debe salir. */
    function userLicAccountHasAnyDayLine(acc) {
        var dl = acc && acc.day_lines;
        if (!dl || typeof dl !== 'object') return false;
        for (var d = 1; d <= 31; d += 1) {
            var rows = dl[String(d)];
            if (rows && rows.length) return true;
        }
        return false;
    }

    function applyUserLicPortalFetchResult(outer, host, gridInner, gridHostEl, res, persistUi) {
        var data = res.data || {};
        var apiOk = !!(res.httpOk && data && data.success);
        var errMsg =
            apiOk
                ? ''
                : String(
                      (data && (data.error || data.message)) ||
                          (!res.httpOk ? 'Sin autorización o error HTTP.' : 'No se pudieron cargar los datos.')
                  );
        var accounts =
            apiOk && Array.isArray(data.accounts)
                ? data.accounts.filter(userLicAccountHasAnyDayLine)
                : [];
        var summaryList = groupSummariesFromAccounts(accounts);

        if (apiOk && data.portal_rev != null) {
            userLicPortalLastRev = String(data.portal_rev);
        }
        if (apiOk && data.portal_colombia_clock && typeof data.portal_colombia_clock === 'object') {
            userLicPortalColombiaClock = data.portal_colombia_clock;
        }
        userLicPortalProveedorEnabled = !!(apiOk && data.proveedor);
        if (apiOk && data.soporte_licencias != null) {
            userLicPortalSoporteLicenciasEnabled = !!data.soporte_licencias;
        } else if (outer && outer.getAttribute('data-soporte-licencias') === '1') {
            userLicPortalSoporteLicenciasEnabled = true;
        }
        userLicSyncProveedorGestionarProductosBtn(userLicPortalProveedorEnabled);

        if (gridInner && gridHostEl) {
            gridInner.innerHTML = renderUserLicenciasGrid(summaryList);
            setGridVisible(
                gridHostEl,
                accounts.length > 0 || userLicPortalProveedorEnabled || userLicPortalSoporteLicenciasEnabled
            );
            if (userLicPortalSoporteLicenciasEnabled) {
                wireUserLicVerificarPanel(outer);
                userLicVerificarSyncCardState();
                void userLicVerificarFetchFromServer();
            }
        }

        userLicPortalAccountsCache = accounts;
        userLicRenewalBalanceWarningsCache =
            apiOk && Array.isArray(data.renewal_balance_warnings)
                ? data.renewal_balance_warnings
                : [];

        if (!apiOk) {
            outer.innerHTML =
                '<div class="user-lic-load-warning mb-3" role="alert">' +
                '<p class="text-center user-licencias-empty py-3 mb-0">' +
                escHtml(errMsg) +
                '</p></div>';
            initEditableLicenseRowsIn(outer);
            wireUserLicPortalStaticHost(host, outer, gridInner, gridHostEl);
            return;
        }

        wireUserLicPortalStaticHost(host, outer, gridInner, gridHostEl);
        bootstrapUserLicPortalCollapseOnce();
        var proveedorUrl = outer.getAttribute('data-proveedor-url') || '';
        var boot = function () {
            rebuildUserLicPortalMainContent(outer, host, gridInner, gridHostEl, persistUi);
            userLicCaducidadNotifyRunCheck();
            userLicRenewalNotifyRunCheck();
        };
        if (userLicPortalProveedorEnabled && proveedorUrl) {
            var productsUrl =
                outer.getAttribute('data-proveedor-products-url') ||
                '/tienda/api/user/proveedor-products';
            Promise.all([
                userLicPortalLoadProveedorInventory(proveedorUrl),
                userLicFetchProveedorProducts(productsUrl).catch(function () {
                    return userLicProveedorProductsCache || [];
                }),
            ]).then(boot);
        } else {
            boot();
        }
        userLicRefreshReportesUi(outer);
    }

    function wireUserLicCredsCopyNormalize(outer) {
        if (!outer || outer.getAttribute('data-lic-copy-normalize-wired') === '1') return;
        outer.setAttribute('data-lic-copy-normalize-wired', '1');
        outer.addEventListener(
            'copy',
            function (ev) {
                var ta = ev.target;
                if (!ta || !ta.classList || !ta.classList.contains('user-lic-creds-ro')) return;
                var start = typeof ta.selectionStart === 'number' ? ta.selectionStart : 0;
                var end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : 0;
                var chunk =
                    start !== end
                        ? String(ta.value || '').slice(start, end)
                        : String(ta.value || '');
                var norm = normalizeLicenseClipboardText(chunk);
                if (!norm) return;
                ev.preventDefault();
                if (ev.clipboardData) {
                    ev.clipboardData.setData('text/plain', norm);
                }
            },
            true
        );
    }

    function wireUserLicPortalStaticHost(host, outer, gridInner, gridHostEl) {
        if (userLicPortalStaticWired) return;
        userLicPortalStaticWired = true;
        if (gridInner) wireGridClick(gridInner, outer);
        wireScrollButtons(outer);
        wireSearchFilter(outer);
        wireLicenseStatusAutosave(outer);
        wireUserLicCredsCopyNormalize(outer);
        wireUserLicVerificarPanel(outer);
        wireUserLicWarrantyHistoryModal(host, outer);
        wireUserLicFullCredModal(host, outer);
        wireUserLicDaysToolbar(outer);
        wireUserLicVencimientosButton(outer, host, gridInner, gridHostEl);
        wireUserLicCaducidadNotifyBar();
        wireUserLicReportesPanel(outer);
        wireUserLicProveedorGestionarProductos(outer);
        var credsColResizeTimer = null;
        window.addEventListener('resize', function () {
            if (credsColResizeTimer) clearTimeout(credsColResizeTimer);
            credsColResizeTimer = setTimeout(function () {
                credsColResizeTimer = null;
                userLicSyncCredsColumnWidthsFromContent();
            }, 160);
        });
    }

    function bootstrapUserLicPortalCollapseOnce() {
        if (userLicPortalCollapseBootstrapped) return;
        userLicPortalCollapseBootstrapped = true;
        setupCollapseButton();
    }

    /** Reportes en tiempo real: aun cuando la reconstrucción completa se difiere (usuario editando),
        se refresca la tabla/badge de Reportes desde el caché recién descargado (panel solo lectura). */
    function userLicReportesLightRealtimeRefresh(ctx) {
        var apiUrl = ctx && ctx.apiUrl;
        if (!apiUrl) return;
        var apiSep = apiUrl.indexOf('?') === -1 ? '?' : '&';
        fetchUserLicPortalJson(apiUrl + apiSep + '_t=' + Date.now())
            .then(function (res) {
                var data = res && res.data ? res.data : {};
                if (!res.httpOk || !data.success || !Array.isArray(data.accounts)) return;
                userLicPortalAccountsCache = data.accounts.filter(userLicAccountHasAnyDayLine);
                userLicSyncReportesBadge(true);
                if (userLicPortalReportesModeActive(ctx.outer)) {
                    userLicRenderReportesPanel(ctx.outer, true);
                }
            })
            .catch(function () {
                /* ignorar; el catch-up diferido lo reintentará */
            });
    }

    function refreshUserLicPortalIfRevChanged(nextRev, ctx) {
        if (!ctx || !ctx.apiUrl) return;
        var rev = String(nextRev);
        if (userLicPortalLastRev === null) {
            userLicPortalLastRev = rev;
            return;
        }
        if (rev === userLicPortalLastRev) return;
        userLicVerificarRealtimeRefresh();
        if (!userLicPortalCanApplyPortalRevRefresh()) {
            userLicPortalDeferredRev = rev;
            userLicReportesLightRealtimeRefresh(ctx);
            return;
        }
        var prevRev = userLicPortalLastRev;
        userLicPortalLastRev = rev;
        userLicPortalDeferredRev = null;
        var outer = ctx.outer;
        var host = ctx.host;
        var gridInner = ctx.gridInner;
        var gridHostEl = ctx.gridHostEl;
        var apiUrl = ctx.apiUrl;
        var prevFilter = outer.dataset.userLicActiveFilter || 'all';
        var inp0 = document.getElementById('userLicenciasSearch');
        var prevSearch = inp0 ? inp0.value || '' : '';
        var apiSep = apiUrl.indexOf('?') === -1 ? '?' : '&';
        return fetchUserLicPortalJson(apiUrl + apiSep + '_t=' + Date.now())
            .then(function (fullRes) {
                applyUserLicPortalFetchResult(outer, host, gridInner, gridHostEl, fullRes, {
                    filter: prevFilter,
                    search: prevSearch,
                });
            })
            .catch(function () {
                userLicPortalLastRev = prevRev;
            });
    }

    function onUserLicPortalSseMessage(data) {
        var ctx = userLicPortalPollContext;
        if (!ctx || !data || data.type !== 'portal_rev' || data.portal_rev == null) return;
        refreshUserLicPortalIfRevChanged(data.portal_rev, ctx);
    }

    function stopUserLicPortalPoll() {
        if (userLicPortalSseHandle) {
            userLicPortalSseHandle.close();
            userLicPortalSseHandle = null;
        }
        if (userLicPortalPollTimer) {
            window.clearInterval(userLicPortalPollTimer);
            userLicPortalPollTimer = null;
        }
    }

    function startUserLicPortalPollFallback(revUrl) {
        if (userLicPortalPollTimer) return;
        userLicPortalPollTimer = window.setInterval(function () {
            if (document.visibilityState !== 'visible') {
                stopUserLicPortalPoll();
                return;
            }
            if (userLicPortalLastRev === null) return;
            var ctx = userLicPortalPollContext;
            if (!ctx || !revUrl) return;
            var sep = revUrl.indexOf('?') === -1 ? '?' : '&';
            fetch(revUrl + sep + '_t=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
                .then(function (r) {
                    return r.text().then(function (t) {
                        var d = {};
                        try {
                            d = t ? JSON.parse(t) : {};
                        } catch (eR) {
                            d = {};
                        }
                        return { httpOk: r.ok, data: d };
                    });
                })
                .then(function (rv) {
                    var pd = rv.data || {};
                    if (!rv.httpOk || !pd.success || pd.portal_rev == null) return;
                    return refreshUserLicPortalIfRevChanged(pd.portal_rev, ctx);
                })
                .catch(function () {
                    /* ignorar errores de sondeo */
                });
        }, USER_LIC_PORTAL_POLL_MS);
    }

    function startUserLicPortalPoll(revUrl, streamUrl, apiUrl, host, outer, gridInner, gridHostEl) {
        stopUserLicPortalPoll();
        if (!apiUrl) return;
        userLicPortalPollContext = {
            revUrl: revUrl,
            streamUrl: streamUrl,
            apiUrl: apiUrl,
            host: host,
            outer: outer,
            gridInner: gridInner,
            gridHostEl: gridHostEl,
        };
        if (document.visibilityState !== 'visible') return;

        if (
            streamUrl &&
            typeof window.StoreSseRealtime !== 'undefined' &&
            typeof window.StoreSseRealtime.connectOrFallback === 'function'
        ) {
            userLicPortalSseHandle = window.StoreSseRealtime.connectOrFallback(
                streamUrl,
                onUserLicPortalSseMessage,
                function () {
                    startUserLicPortalPollFallback(revUrl);
                }
            );
        } else if (revUrl) {
            startUserLicPortalPollFallback(revUrl);
        }
    }

    function resumeUserLicPortalPollIfNeeded() {
        var ctx = userLicPortalPollContext;
        if (!ctx || userLicPortalPollTimer || userLicPortalSseHandle) return;
        startUserLicPortalPoll(
            ctx.revUrl,
            ctx.streamUrl,
            ctx.apiUrl,
            ctx.host,
            ctx.outer,
            ctx.gridInner,
            ctx.gridHostEl
        );
    }

    document.addEventListener('visibilitychange', function userLicPortalPollVisibility() {
        if (document.visibilityState === 'visible') {
            resumeUserLicPortalPollIfNeeded();
            return;
        }
        stopUserLicPortalPoll();
    });

    function init() {
        var outer = document.getElementById('userLicenciasTableOuter');
        if (!outer || outer.getAttribute('data-user-lic-init') === '1') return;
        outer.setAttribute('data-user-lic-init', '1');

        var host = outer.closest('.user-licencias-shell') || document.body;
        var gridHostEl = host.querySelector('#userLicenciasGridHost');
        var gridInner = gridHostEl ? gridHostEl.querySelector('#userLicenciasGrid') : null;

        var apiUrl =
            outer.getAttribute('data-api-url') ||
            (typeof window.USER_LICENCIAS_API_URL === 'string' ? window.USER_LICENCIAS_API_URL : '');
        var revUrl = outer.getAttribute('data-rev-url') || '';
        var streamUrl = outer.getAttribute('data-stream-url') || '';

        if (!apiUrl) return;

        setGridVisible(gridHostEl, false);

        fetchUserLicPortalJson(apiUrl)
            .then(function (res) {
                applyUserLicPortalFetchResult(outer, host, gridInner, gridHostEl, res, null);
                startUserLicPortalPoll(revUrl, streamUrl, apiUrl, host, outer, gridInner, gridHostEl);
            })
            .catch(function () {
                if (gridInner && gridHostEl) {
                    gridInner.innerHTML = renderUserLicenciasGrid([]);
                    setGridVisible(gridHostEl, true);
                }
                outer.innerHTML =
                    '<p class="text-center user-licencias-empty py-4 mb-0">Error de red al cargar licencias.</p>';
                userLicPortalLastRev = null;
                initEditableLicenseRowsIn(outer);
                wireUserLicPortalStaticHost(host, outer, gridInner, gridHostEl);
                userLicPortalApplyColumnVisibility(outer);
                userLicPortalRestoreDaySectionsAndToolbars(outer);
                bootstrapUserLicPortalCollapseOnce();
                var effErr = readPersistedUserLicPortalServiceFilter(gridHostEl);
                outer.dataset.userLicActiveFilter = effErr;
                applyLicenseFilter(outer, gridHostEl, effErr, true);
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
