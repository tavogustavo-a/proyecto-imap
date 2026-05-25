/**
 * Licencias usuario — grid por producto («Todos» + productos), barra Historial junto al menú,
 * días hasta vencimiento y flechas al bloque del día (como en admin).
 */
(function () {
    'use strict';

    var SAVE_DEBOUNCE_MS = 600;

    /** Sondeo ligero: mismo hash que el servidor (`portal_rev`) para refrescar sin F5 cuando admin cambia licencias. */
    var USER_LIC_PORTAL_POLL_MS = 2500;
    /** Vista Caducidad: solo cuentas con vencimiento en 5 días o menos (incluye «vence hoy» = 0). */
    var USER_LIC_CADUCIDAD_VIEW_MAX_DAYS = 5;
    var userLicPortalLastRev = null;
    var userLicPortalAccountsCache = [];
    /** Reloj Colombia del servidor (día 1–31 del mes) para caducidad por día de calendario. */
    var userLicPortalColombiaClock = null;
    var userLicPortalVencimientosActive = false;
    var userLicPortalPollTimer = null;
    var userLicPortalStaticWired = false;
    var userLicPortalCollapseBootstrapped = false;
    var userLicCaducidadNotifyTimer = null;
    var userLicCaducidadNotifyBarWired = false;
    var userLicCaducidadNotifyPrefsMem = { enabled: false, fromDays: 5 };
    var userLicRenewalBalanceWarningsCache = [];
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
            return;
        }
        var b = gridCardByFilterKey(gridHost, fk);
        if (b) b.classList.add('active');
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
    ];

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
        return (
            '<button type="button" class="user-lic-buena-revisada-badge license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-good" data-user-lic-prev-good="' +
            escAttr(prevGoodRestore || '') +
            '" data-user-lic-prev-bad="' +
            escAttr(prevBadRestore || '') +
            '" title="Marcada por soporte. Pulsa para quitar «Buena» y volver al estado anterior (renovación y reporte).">' +
            '<i class="fas fa-check-circle" aria-hidden="true"></i> Buena</button>'
        );
    }

    function userLicFinishRevertBuenaRevisada(row, sgRestored, sbRestored) {
        if (!row) return;
        var badShell = row.querySelector('.license-split-editor__status-select-shell--bad');
        var badge = badShell && badShell.querySelector('.user-lic-buena-revisada-badge');
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
            badge.replaceWith(sbSel);
        }
        if (goodSel) {
            goodSel.disabled = false;
            goodSel.removeAttribute('aria-disabled');
            goodSel.classList.remove('user-lic-status-good--buena-locked');
            goodSel.innerHTML = statusOptionsInnerHtml(OPT_LICENSE_GOOD, sgRestored || '');
        }
        row.removeAttribute('data-user-lic-buena-revisada');
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
        container.querySelectorAll('.user-lic-license-row-edit').forEach(function (row) {
            syncOtroShell(row);
            applyDualTierUi(row);
        });
        container.querySelectorAll('.day-section.user-lic-readonly-day').forEach(function (section) {
            userLicSyncDayBundleLineSignals(section);
        });
    }

    function wireLicenseStatusAutosave(rootEl) {
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
            var lid = Number(row.getAttribute('data-lic-row-license-id'));
            var dayNum = Number(row.getAttribute('data-lic-row-day'));
            var ordinal = Number(row.getAttribute('data-lic-row-ordinal'));
            var aidRaw = row.getAttribute('data-lic-row-account-id');
            var virt = row.getAttribute('data-lic-row-virtual') === '1';
            var sgEl = row.querySelector('select.license-split-editor__status-good');
            var sbEl = row.querySelector('select.license-split-editor__status-bad');
            var otEl = row.querySelector('.license-split-editor__otro-combined');
            var isBuenaRow = row.getAttribute('data-user-lic-buena-revisada') === '1';
            if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(dayNum) || !Number.isFinite(ordinal)) {
                return;
            }
            if (revertBuenaRevisada) {
                if (!row.querySelector('.user-lic-buena-revisada-badge')) return;
            } else if (!isBuenaRow && !sbEl) {
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
                var badgeEl = row.querySelector('.user-lic-buena-revisada-badge');
                if (!prevBadAttr && badgeEl) {
                    prevBadAttr = badgeEl.getAttribute('data-user-lic-prev-bad') || '';
                }
                if (prevBadAttr) payload.status_bad = prevBadAttr;
            } else {
                payload.status_good = statusGoodVal;
            }

            fetch(patchUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
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
                    var badgePending = row.querySelector('.user-lic-buena-revisada-badge');
                    if (badgePending) {
                        badgePending.disabled = false;
                        badgePending.classList.remove('user-lic-buena-revisada-badge--pending');
                    }
                    if (res.ok && res.data && res.data.success) {
                        if (revertBuenaRevisada || badgePending) {
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
                    var badgeErr = row.querySelector('.user-lic-buena-revisada-badge');
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

        rootEl.addEventListener(
            'click',
            function (ev) {
                var badge = ev.target.closest('.user-lic-buena-revisada-badge');
                if (!badge || badge.disabled) return;
                var row = badge.closest('.user-lic-license-row-edit');
                if (!row || !rootEl.contains(row)) return;
                ev.preventDefault();
                ev.stopPropagation();
                badge.disabled = true;
                badge.classList.add('user-lic-buena-revisada-badge--pending');
                var sgKeep =
                    userLicCanonicalPortalGood(badge.getAttribute('data-user-lic-prev-good')) ||
                    userLicCanonicalPortalGood(row.getAttribute('data-user-lic-saved-good')) ||
                    '';
                persistRow(row, {
                    revertBuenaRevisada: true,
                    statusGoodOverride: sgKeep || undefined,
                });
            },
            true
        );

        rootEl.addEventListener(
            'change',
            function (ev) {
                var row = ev.target.closest('.user-lic-license-row-edit');
                if (!row || !rootEl.contains(row)) return;
                if (
                    ev.target.classList.contains('license-split-editor__status-good') ||
                    ev.target.classList.contains('license-split-editor__status-bad')
                ) {
                    if (ev.target.classList.contains('license-split-editor__status-bad')) {
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
    }

    /** Saldo de cuenta (API billing_saldo): 0 = al día (Pagada); distinto de 0 muestra importe pendiente o a favor (no «Pagada»). */
    function formatUserLicBillingSaldoCell(lm) {
        var raw = lm && lm.billing_saldo != null ? Number(lm.billing_saldo) : 0;
        if (!Number.isFinite(raw)) raw = 0;
        if (Math.abs(raw) < 1e-9) {
            return (
                '<span class="user-lic-saldo-display user-lic-saldo-display--paid" title="Cuenta al día (sin saldo pendiente)">Pagada</span>'
            );
        }
        var txt = Math.abs(raw - Math.round(raw)) < 1e-9 ? String(Math.round(raw)) : String(Number(raw.toFixed(2)));
        var titleExtra = '';
        if (raw > 1e-9) {
            titleExtra = 'Importe pendiente en cuenta licencias.';
        } else {
            titleExtra = 'Saldo negativo / a favor (no al día como «Pagada»).';
        }
        return (
            '<span class="user-lic-saldo-display user-lic-saldo-display--due" title="' +
            escAttr(titleExtra) +
            '">' +
            escHtml(txt) +
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

        var curSg = row.status_good != null ? String(row.status_good).trim() : '';
        var curSb = row.status_bad != null ? String(row.status_bad).trim() : '';
        var curOd = row.otro_detail != null ? String(row.otro_detail).trim() : '';
        var isGarantia = normalizeStatusKey(curSg) === normalizeStatusKey('garantia');
        var isBuenaRevisada =
            !isGarantia &&
            (row.buena_revisada_readonly === true || normalizeStatusKey(curSg) === normalizeStatusKey('ok'));
        var prevGoodRestore =
            row.prev_good_restore != null ? String(row.prev_good_restore).trim() : '';
        var prevBadRestore =
            row.prev_bad_restore != null ? String(row.prev_bad_restore).trim() : '';
        var greenFromApi =
            row.green_select_value != null ? String(row.green_select_value).trim() : '';

        var goodSelectValue = isBuenaRevisada
            ? greenFromApi || prevGoodRestore
            : greenFromApi || curSg;
        var gTier = isGarantia
            ? 'good'
            : isBuenaRevisada
              ? String(goodSelectValue || '').trim()
                  ? 'good'
                  : 'neutral'
              : row.tier_good === 'good'
                ? 'good'
                : 'neutral';
        var bTier = row.tier_bad === 'bad' ? 'bad' : 'neutral';

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

        return (
            '<div class="license-split-editor__row user-lic-readonly-row user-lic-license-row-edit' +
            (userLicRowSignalClassFromRow(row) ? ' ' + userLicRowSignalClassFromRow(row) : '') +
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
            (isBuenaRevisada ? ' data-user-lic-buena-revisada="1"' : '') +
            ' data-user-lic-saved-good="' +
            escAttr(isBuenaRevisada ? prevGoodRestore : goodSelectValue || curSg) +
            '"' +
            ' data-user-lic-bad-select-id="' +
            escAttr(bid) +
            '">' +
            '<div class="license-split-editor__status-wrap' +
            (shellIsOtro ? ' license-split-editor__status-wrap--otro' : '') +
            '">' +
            '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--good">' +
            fullCredBtnHtml +
            '<button type="button" class="user-lic-warranty-history-btn" title="Historial de caídas y garantías" aria-label="Ver historial de caídas y garantías de esta fila">' +
            '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
            '</button>' +
            (isGarantia
                ? '<span class="user-lic-garantia-badge license-split-editor__status license-split-editor__status-good license-split-editor__status--tier-good" title="Cuenta repuesta por garantía (soporte).">' +
                  '<i class="fas fa-shield-alt" aria-hidden="true"></i> Garantía</span>'
                : '<select id="' +
                  gid +
                  '" name="' +
                  gid +
                  '" class="license-split-editor__status license-split-editor__status-good license-split-editor__status--tier-' +
                  gTier +
                  (isBuenaRevisada ? ' user-lic-status-good--buena-locked' : '') +
                  '" autocomplete="off" aria-label="Estado favorable (renovación)"' +
                  (isBuenaRevisada
                      ? ' disabled aria-disabled="true" title="Renovación guardada. Pulsa «Buena» en la columna de reportes para editar."'
                      : '') +
                  '>' +
                  statusOptionsInnerHtml(OPT_LICENSE_GOOD, goodSelectValue) +
                  '</select>') +
            '</div>' +
            '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--bad">' +
            (isBuenaRevisada
                ? userLicBuenaRevisadaBadgeHtml(prevGoodRestore, prevBadRestore)
                : '<select id="' +
                  bid +
                  '" name="' +
                  bid +
                  '" class="license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-' +
                  bTier +
                  '" autocomplete="off" aria-label="Reportar problema o incidencia">' +
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
            formatUserLicBillingSaldoCell(lm || {}) +
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

    /** Filtro de tarjeta «Todos»: una sola grilla día 1–31 con todas las cuentas. */
    var USER_LIC_AGGREGATE_LICENSE_ID = '__aggregate_all__';

    function licenseMetaFromAccount(acc) {
        var fkey = licenseFilterKey(acc);
        var pn = String(acc.product_name || '').trim();
        if (pn === '—' || pn === '-') pn = '';
        return {
            license_id: acc.license_id,
            account_id: acc.account_id != null ? acc.account_id : null,
            virtual: !!(acc.virtual === true || acc.is_virtual === true),
            credSlug: fkey,
            billing_saldo: acc.billing_saldo != null ? Number(acc.billing_saldo) : 0,
            product_name: pn,
        };
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
        var dim = Number(co.days_in_month);
        if (!Number.isFinite(today) || !Number.isFinite(dim) || dim < 28) return null;
        if (cal >= today) return cal - today;
        return dim - today + cal;
    }

    function accountDaysUntilExpiryUi(acc, clock) {
        if (!acc) return null;
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
                var entryLeft = daysUntilCalendarSaleDay(entries[ri].saleDay, co);
                if (entryLeft == null) entryLeft = accountDaysUntilExpiryUi(acc, co);
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

        var useBrowser = userLicCaducidadNotifyBrowserGranted();
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

            if (!delivered && document.visibilityState === 'visible') {
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
        var fromDays = USER_LIC_CADUCIDAD_NOTIFY_MAX_LEAD;
        var enabled = userLicCaducidadNotifyPrefsMem.enabled;
        try {
            var rawEnabled = localStorage.getItem(userLicCaducidadNotifyLsKey('enabled'));
            if (rawEnabled != null && rawEnabled !== '') {
                enabled = rawEnabled === '1' || rawEnabled === 'true';
            }
            var rawFrom = localStorage.getItem(userLicCaducidadNotifyLsKey('from_days'));
            if (rawFrom != null && rawFrom !== '') {
                var n = Number(rawFrom);
                if (Number.isFinite(n)) fromDays = Math.trunc(n);
            } else if (userLicCaducidadNotifyPrefsMem.fromDays != null) {
                fromDays = userLicCaducidadNotifyPrefsMem.fromDays;
            }
        } catch (_ePr) {
            enabled = userLicCaducidadNotifyPrefsMem.enabled;
            fromDays = userLicCaducidadNotifyPrefsMem.fromDays || fromDays;
        }
        fromDays = Math.max(1, Math.min(USER_LIC_CADUCIDAD_NOTIFY_MAX_LEAD, fromDays));
        userLicCaducidadNotifyPrefsMem.enabled = !!enabled;
        userLicCaducidadNotifyPrefsMem.fromDays = fromDays;
        return { enabled: enabled, fromDays: fromDays };
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
        if (!userLicCaducidadNotifyBrowserGranted()) {
            if (typeof Notification === 'undefined') {
                return {
                    text: 'Avisos en la app: alertas en pantalla con esta página abierta.',
                    kind: 'ok',
                };
            }
            if (Notification.permission === 'denied') {
                return {
                    text: 'Avisos en la app (alertas en pantalla). Notificaciones del navegador bloqueadas; usa el candado de la barra si quieres ambas.',
                    kind: 'warn',
                };
            }
            return {
                text: 'Avisos en la app. Si aceptas permiso del navegador, también avisará fuera de la página.',
                kind: 'ok',
            };
        }
        return {
            text: 'Avisos activos (navegador y app). Se revisan al cargar y cada 30 min con la pestaña abierta.',
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
            '<div class="user-lic-caducidad-alert__foot">Toca para ir a Caducidad</div>';

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
        if (!bar || !chk || !sel) return;
        var prefs = userLicCaducidadNotifyPrefsRead();
        chk.checked = prefs.enabled;
        sel.value = String(prefs.fromDays);
        sel.disabled = !prefs.enabled;
        chk.disabled = false;
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

        var useBrowser = userLicCaducidadNotifyBrowserGranted();
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

            if (!delivered && document.visibilityState === 'visible') {
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
                }
            });

            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') {
                    userLicCaducidadNotifyRunCheck();
                }
            });

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
        return '<div class="user-lic-all-accounts">' + sheetsParts.join('') + '</div>';
    }

    function rebuildUserLicPortalMainContent(outer, host, gridInner, gridHostEl, persistUi) {
        var accounts = userLicPortalAccountsCache || [];
        var effFilter =
            persistUi && persistUi.filter != null
                ? String(persistUi.filter)
                : readPersistedUserLicPortalServiceFilter(gridHostEl);
        effFilter = normalizePortalServiceFilterKey(effFilter);

        if (!accounts.length) {
            outer.innerHTML =
                '<p class="text-center user-licencias-empty py-4 mb-0" role="status">Aún no tienes cuentas asignadas. Si ya compraste, espera la asignación o contacta soporte.</p>';
        } else if (userLicPortalVencimientosActive) {
            outer.innerHTML = renderVencimientosPortalView(accounts);
            outer.dataset.userLicActiveFilter = 'vencimientos';
            delete outer.dataset.userLicCaducidadServiceFilter;
        } else {
            outer.innerHTML = buildUserLicenciasNormalSheetsHtml(accounts);
            outer.dataset.userLicActiveFilter = effFilter;
            delete outer.dataset.userLicCaducidadServiceFilter;
        }

        initEditableLicenseRowsIn(outer);
        userLicPortalApplyColumnVisibility(outer);
        userLicPortalRestoreDaySectionsAndToolbars(outer);

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
    }

    function wireUserLicVencimientosButton(outer, host, gridInner, gridHostEl) {
        var btn = document.getElementById('btnUserLicVencimientos');
        if (!btn || btn.getAttribute('data-venc-wired') === '1') return;
        btn.setAttribute('data-venc-wired', '1');
        btn.addEventListener('click', function () {
            var entering = !userLicPortalVencimientosActive;
            userLicPortalVencimientosActive = entering;
            setCaducidadToolbarActive(entering);
            rebuildUserLicPortalMainContent(
                outer,
                host,
                gridInner,
                gridHostEl,
                entering ? { filter: 'all' } : null
            );
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
        if (userLicRowIsReporte(row)) return 'user-lic-row--signal-reportes';
        return '';
    }

    function userLicRowSignalStripeColorFromRow(row) {
        if (userLicRowIsBuena(row) || userLicRowIsGarantia(row)) return 'rgba(22, 101, 52, 0.78)';
        if (userLicRowIsReporte(row)) return 'rgba(153, 27, 27, 0.78)';
        return '';
    }

    function userLicRowSignalClassFromDom(rowEl) {
        if (!rowEl) return '';
        if (rowEl.querySelector('.user-lic-buena-revisada-badge')) return 'user-lic-row--signal-buena';
        if (rowEl.querySelector('.user-lic-garantia-badge')) return 'user-lic-row--signal-garantia';
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
        if (cls === 'user-lic-row--signal-reportes') return 'rgba(153, 27, 27, 0.78)';
        return '';
    }

    function userLicSyncRowSignalClasses(rowEl, rowDataOptional) {
        if (!rowEl) return;
        rowEl.classList.remove(
            'user-lic-row--signal-reportes',
            'user-lic-row--signal-buena',
            'user-lic-row--signal-garantia'
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

    function userLicRowIsBuena(row) {
        if (!row || userLicRowIsGarantia(row)) return false;
        if (row.buena_revisada_readonly === true) return true;
        return normalizeStatusKey(row.status_good || '') === normalizeStatusKey('ok');
    }

    function userLicRowIsReporte(row) {
        if (!row || userLicRowIsBuena(row) || userLicRowIsGarantia(row)) return false;
        if (row.tier_bad === 'bad') return true;
        var sb = String(row.status_bad != null ? row.status_bad : '').trim();
        if (!sb || sb.indexOf('__prev_good:') === 0) return false;
        return normalizeStatusKey(sb) !== '';
    }

    function userLicCountDayStatusSignals(pairs) {
        var nReportes = 0;
        var nBuena = 0;
        var nGarantia = 0;
        (pairs || []).forEach(function (p) {
            var row = p && p.row;
            if (userLicRowIsBuena(row)) {
                nBuena += 1;
            } else if (userLicRowIsGarantia(row)) {
                nGarantia += 1;
            } else if (userLicRowIsReporte(row)) {
                nReportes += 1;
            }
        });
        return { reportes: nReportes, buena: nBuena, garantia: nGarantia };
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
        if (!section) return { reportes: 0, buena: 0, garantia: 0 };
        section.querySelectorAll('.user-lic-license-row-edit').forEach(function (row) {
            if (row.querySelector('.user-lic-buena-revisada-badge')) {
                nBuena += 1;
                return;
            }
            if (row.querySelector('.user-lic-garantia-badge')) {
                nGarantia += 1;
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
            if (sbVal && sbVal.indexOf('__prev_good:') !== 0) {
                nReportes += 1;
            }
        });
        return { reportes: nReportes, buena: nBuena, garantia: nGarantia };
    }

    function userLicSyncDaySectionSignalClasses(section, counts) {
        if (!section) return;
        section.classList.remove(
            'user-lic-day--signal-reportes',
            'user-lic-day--signal-buena',
            'user-lic-day--signal-garantia'
        );
        if (!counts) return;
        if (counts.reportes > 0) {
            section.classList.add('user-lic-day--signal-reportes');
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
        var badgeHtml =
            sectionOpts.caducidadMode || n > 0
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
            '<button type="button" class="admin-licencias-toggle-notes-col-btn user-lic-days-toggle-creds" title="Ocultar columna de cuentas (texto izquierdo)" aria-label="Ocultar columna de credenciales en cada día" aria-pressed="false">' +
            '<i class="fas fa-eye-slash" aria-hidden="true"></i>' +
            '</button>' +
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
            return v === '1' || v === 'true';
        } catch (e1) {
            return false;
        }
    }

    function userLicPortalHideCredsRead() {
        try {
            var v = localStorage.getItem(USER_LIC_PORTAL_HIDE_CREDS_KEY);
            return v === '1' || v === 'true';
        } catch (eCr) {
            return false;
        }
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
        var hidCr = userLicPortalHideCredsRead();
        var hidB = userLicPortalHideBadRead();
        var hidNt = userLicPortalHideNotesRead();
        outer.querySelectorAll('.user-lic-days-toggle-creds').forEach(function (b) {
            userLicPortalToggleEyeButtonUi(
                b,
                hidCr,
                'Ocultar columna de cuentas (texto izquierdo)',
                'Ocultar columna de credenciales en cada día',
                'Mostrar columna de cuentas (texto izquierdo)',
                'Mostrar columna de credenciales en cada día'
            );
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

    function userLicPortalApplyColumnVisibility(outer) {
        if (!outer) return;
        userLicPortalMigrateLegacyColumnKeys();
        try {
            localStorage.removeItem('user_lic_portal_days_hide_good_v1');
        } catch (eClrG) {
            /* ignore */
        }
        var hidCr = userLicPortalHideCredsRead();
        var hidB = userLicPortalHideBadRead();
        var hidNt = userLicPortalHideNotesRead();
        outer.querySelectorAll('.user-lic-bundle-wrap .day-license-split-root.license-split-editor--day').forEach(function (root) {
            root.classList.remove('user-lic-col-hide-good');
            root.classList.toggle('user-lic-col-hide-creds', hidCr);
            root.classList.toggle('user-lic-col-hide-bad', hidB);
            root.classList.toggle('license-split-editor--notes-hidden', hidNt);
            root.classList.remove('license-split-editor--status-hidden');
        });
        userLicPortalSyncAllColumnToolbars(outer);
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

            var crBtn = t.closest('.user-lic-days-toggle-creds');
            if (crBtn && outer.contains(crBtn)) {
                var nextCr = !userLicPortalHideCredsRead();
                try {
                    localStorage.setItem(USER_LIC_PORTAL_HIDE_CREDS_KEY, nextCr ? '1' : '0');
                } catch (eCr2) {
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
            '" data-default-scroll-day="' +
            scrollDay +
            '">' +
            '<div class="license-notepads-wrap user-lic-bundle-wrap">' +
            daysHtml +
            '</div>' +
            '</article>'
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
        if (licSel === 'vencimientos' || userLicPortalVencimientosActive) {
            container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
                var isVenc = art.classList.contains('user-lic-account-sheet--vencimientos');
                var hay = (art.getAttribute('data-search-filter') || '').trim().toLowerCase();
                var matchQ = !q || hay.indexOf(q) !== -1;
                art.style.display = isVenc && matchQ ? '' : 'none';
            });
            return;
        }
        var visibleByLic = {};
        var hasMergedView = !!container.querySelector('.user-lic-account-sheet--aggregate');
        container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
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
        var host = container.closest('.user-licencias-shell') || document.body;
        var gh = host.querySelector('#userLicenciasGridHost');
        var gi = gh ? gh.querySelector('#userLicenciasGrid') : null;
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
            if (!gridHost) return 'all';
            return gridCardByFilterKey(gridHost, s) ? s : 'all';
        } catch (_e2) {
            return 'all';
        }
    }

    function applyLicenseFilter(container, gridHost, filterRaw, skipPersist, skipRebuild) {
        var licenseIdSel = filterRaw === 'all' || filterRaw == null ? 'all' : String(filterRaw);

        if (licenseIdSel !== 'vencimientos') {
            exitCaducidadViewMode();
        }

        var licenseNorm = normalizePortalServiceFilterKey(
            licenseIdSel === 'vencimientos' ? 'all' : licenseIdSel
        );
        container.dataset.userLicActiveFilter = licenseNorm;
        delete container.dataset.userLicCaducidadServiceFilter;
        if (!skipPersist) {
            persistUserLicPortalServiceFilter(licenseNorm);
        }

        if (!skipRebuild) {
            var hostR = container.closest('.user-licencias-shell') || document.body;
            var gridHostElR = gridHost || hostR.querySelector('#userLicenciasGridHost');
            var gridInnerR = gridHostElR ? gridHostElR.querySelector('#userLicenciasGrid') : null;
            rebuildUserLicPortalMainContent(container, hostR, gridInnerR, gridHostElR, {
                filter: licenseNorm,
            });
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
                    var dAttr = section.getAttribute('data-user-day');
                    if (dAttr != null) {
                        userLicPortalPersistDayCollapsed(art, dAttr, section.classList.contains('collapsed'));
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
            var t = plain != null ? String(plain) : '';
            if (!t) return;
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(t).catch(function () {
                    try {
                        var x = document.createElement('textarea');
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

    /**
     * @param {object|null} persistUi — si no es null: filter ('all' | clave) y texto de búsqueda.
     */
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
        var accounts = apiOk && Array.isArray(data.accounts) ? data.accounts : [];
        var summaryList = groupSummariesFromAccounts(accounts);

        if (apiOk && data.portal_rev != null) {
            userLicPortalLastRev = String(data.portal_rev);
        }
        if (apiOk && data.portal_colombia_clock && typeof data.portal_colombia_clock === 'object') {
            userLicPortalColombiaClock = data.portal_colombia_clock;
        }

        if (gridInner && gridHostEl) {
            gridInner.innerHTML = renderUserLicenciasGrid(summaryList);
            setGridVisible(gridHostEl, true);
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
        rebuildUserLicPortalMainContent(outer, host, gridInner, gridHostEl, persistUi);
        userLicCaducidadNotifyRunCheck();
        userLicRenewalNotifyRunCheck();
    }

    function wireUserLicPortalStaticHost(host, outer, gridInner, gridHostEl) {
        if (userLicPortalStaticWired) return;
        userLicPortalStaticWired = true;
        if (gridInner) wireGridClick(gridInner, outer);
        wireScrollButtons(outer);
        wireSearchFilter(outer);
        wireLicenseStatusAutosave(outer);
        wireUserLicWarrantyHistoryModal(host, outer);
        wireUserLicFullCredModal(host, outer);
        wireUserLicDaysToolbar(outer);
        wireUserLicVencimientosButton(outer, host, gridInner, gridHostEl);
        wireUserLicCaducidadNotifyBar();
    }

    function bootstrapUserLicPortalCollapseOnce() {
        if (userLicPortalCollapseBootstrapped) return;
        userLicPortalCollapseBootstrapped = true;
        setupCollapseButton();
    }

    function stopUserLicPortalPoll() {
        if (userLicPortalPollTimer) {
            window.clearInterval(userLicPortalPollTimer);
            userLicPortalPollTimer = null;
        }
    }

    function startUserLicPortalPoll(revUrl, apiUrl, host, outer, gridInner, gridHostEl) {
        stopUserLicPortalPoll();
        if (!revUrl || !apiUrl) return;
        userLicPortalPollTimer = window.setInterval(function () {
            if (document.visibilityState !== 'visible') return;
            if (userLicPortalLastRev === null) return;
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
                    var nextRev = String(pd.portal_rev);
                    if (nextRev === userLicPortalLastRev) return;
                    var prevFilter = outer.dataset.userLicActiveFilter || 'all';
                    var inp0 = document.getElementById('userLicenciasSearch');
                    var prevSearch = inp0 ? inp0.value || '' : '';
                    var apiSep = apiUrl.indexOf('?') === -1 ? '?' : '&';
                    return fetchUserLicPortalJson(apiUrl + apiSep + '_t=' + Date.now()).then(function (fullRes) {
                        applyUserLicPortalFetchResult(outer, host, gridInner, gridHostEl, fullRes, {
                            filter: prevFilter,
                            search: prevSearch,
                        });
                    });
                })
                .catch(function () {
                    /* ignorar errores de sondeo */
                });
        }, USER_LIC_PORTAL_POLL_MS);
    }

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

        if (!apiUrl) return;

        setGridVisible(gridHostEl, false);

        fetchUserLicPortalJson(apiUrl)
            .then(function (res) {
                applyUserLicPortalFetchResult(outer, host, gridInner, gridHostEl, res, null);
                startUserLicPortalPoll(revUrl, apiUrl, host, outer, gridInner, gridHostEl);
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
