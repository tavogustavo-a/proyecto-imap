/**
 * Licencias usuario — grid por producto (≥1 cuenta), Historial / Todos, días hasta vencimiento y flechas al bloque del día (como en admin).
 */
(function () {
    'use strict';

    var SAVE_DEBOUNCE_MS = 600;

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

    /** Tarjeta/grid: una entrada por cuenta inventario (a{id}) o vista mes a mes por nombre (v{licenseId}). */
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
        { v: 'ok', label: 'Buena y revisada' },
        { v: 'renovar 1 mes mas', label: 'Renovar 1 mes más' },
        { v: 'dejar mes a mes', label: 'Dejar mes a mes' },
        { v: 'no renovar', label: 'No renovar' },
        { v: 'garantia', label: 'Garantía (repuesto)' },
        { v: 'reemplazar', label: 'Reemplazar' },
        { v: 'terminado', label: 'Terminado' },
    ];

    var OPT_LICENSE_BAD = [
        { v: '', label: '—' },
        { v: 'caida o suspendida', label: 'Caída o suspendida' },
        { v: 'no reproduce', label: 'No reproduce' },
        { v: 'repetida', label: 'Repetida' },
        { v: 'otro', label: 'Otro' },
    ];

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
        var sg = row.querySelector('.license-split-editor__status-good');
        var sb = row.querySelector('.license-split-editor__status-bad');
        if (!sg || !sb) return;
        sg.classList.remove(
            'license-split-editor__status--tier-good',
            'license-split-editor__status--tier-neutral'
        );
        sg.classList.add(
            String(sg.value || '').trim()
                ? 'license-split-editor__status--tier-good'
                : 'license-split-editor__status--tier-neutral'
        );
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

    function initEditableLicenseRowsIn(container) {
        if (!container) return;
        container.querySelectorAll('.user-lic-license-row-edit').forEach(function (row) {
            syncOtroShell(row);
            applyDualTierUi(row);
        });
    }

    function wireLicenseStatusAutosave(rootEl) {
        var patchUrl =
            rootEl.getAttribute('data-day-status-url') || '/tienda/api/user/license-day-row-status';
        var timers = Object.create(null);

        function persistRow(row) {
            var sk = row.getAttribute('data-user-lic-save-key');
            if (!sk) return;
            if (timers[sk]) {
                window.clearTimeout(timers[sk]);
                delete timers[sk];
            }
            var lid = Number(row.getAttribute('data-lic-row-license-id'));
            var dayNum = Number(row.getAttribute('data-lic-row-day'));
            var ordinal = Number(row.getAttribute('data-lic-row-ordinal'));
            var aidRaw = row.getAttribute('data-lic-row-account-id');
            var virt = row.getAttribute('data-lic-row-virtual') === '1';
            var sgEl = row.querySelector('.license-split-editor__status-good');
            var sbEl = row.querySelector('.license-split-editor__status-bad');
            var otEl = row.querySelector('.license-split-editor__otro-combined');
            var unEl = row.querySelector('.user-lic-user-row-notes-inp');
            if (!sgEl || !sbEl || !Number.isFinite(lid) || lid <= 0 || !Number.isFinite(dayNum) || !Number.isFinite(ordinal)) {
                return;
            }
            var statusGoodVal = sgEl.value != null ? String(sgEl.value).trim() : '';
            var statusBadVal = sbEl.value != null ? String(sbEl.value).trim() : '';
            var otroDetailVal = otEl ? String(otEl.value || '').trim() : '';
            var userNotesVal = unEl ? String(unEl.value || '').trim() : '';

            row.classList.remove('user-lic-save-err');

            fetch(patchUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    license_id: lid,
                    calendar_day: dayNum,
                    row_ordinal: ordinal,
                    account_id:
                        aidRaw != null && String(aidRaw).trim() !== '' ? Number(String(aidRaw).trim()) : null,
                    virtual: virt,
                    status_good: statusGoodVal,
                    status_bad: statusBadVal,
                    otro_detail: otroDetailVal,
                    user_notes: userNotesVal,
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
                    if (res.ok && res.data && res.data.success) {
                        row.style.outline = '1px solid rgba(74, 222, 128, 0.55)';
                        window.setTimeout(function () {
                            row.style.outline = '';
                        }, 1200);
                    } else {
                        row.style.outline = '2px solid rgba(248, 113, 113, 0.92)';
                        window.setTimeout(function () {
                            row.style.outline = '';
                        }, 2400);
                    }
                })
                .catch(function () {
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
                if (
                    ev.target.classList.contains('license-split-editor__otro-combined') ||
                    ev.target.classList.contains('user-lic-user-row-notes-inp')
                ) {
                    schedulePersist(row);
                }
            },
            true
        );
    }

    function renderEditableLicenseRow(row, day, ordinal, lm) {
        var slug = slugForCredFieldId(lm.credSlug || 'u0');
        var ordStored = row.row_ordinal != null ? Number(row.row_ordinal) : Number(ordinal);
        if (!Number.isFinite(ordStored)) ordStored = ordinal;

        var curSg = row.status_good != null ? String(row.status_good).trim() : '';
        var curSb = row.status_bad != null ? String(row.status_bad).trim() : '';
        var curOd = row.otro_detail != null ? String(row.otro_detail).trim() : '';

        var gTier = row.tier_good === 'good' ? 'good' : 'neutral';
        var bTier = row.tier_bad === 'bad' ? 'bad' : 'neutral';

        var gid = 'user-lic-sg-' + slug + '-d' + day + '-r' + ordStored;
        var bid = 'user-lic-sb-' + slug + '-d' + day + '-r' + ordStored;
        var oid = 'user-lic-so-' + slug + '-d' + day + '-r' + ordStored;

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

        var curUn = row.user_row_note != null ? String(row.user_row_note) : '';

        var unid = 'user-lic-un-' + slug + '-d' + day + '-r' + ordStored;

        return (
            '<div class="license-split-editor__row user-lic-readonly-row user-lic-license-row-edit"' +
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
            ' data-lic-row-ordinal="' +
            escAttr(String(ordStored)) +
            '">' +
            '<div class="license-split-editor__status-wrap' +
            (shellIsOtro ? ' license-split-editor__status-wrap--otro' : '') +
            '">' +
            '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--good">' +
            '<select id="' +
            gid +
            '" name="' +
            gid +
            '" class="license-split-editor__status license-split-editor__status-good license-split-editor__status--tier-' +
            gTier +
            '" autocomplete="off" aria-label="Estado favorable">' +
            statusOptionsInnerHtml(OPT_LICENSE_GOOD, curSg) +
            '</select>' +
            '</div>' +
            '<div class="license-split-editor__status-select-shell license-split-editor__status-select-shell--bad">' +
            '<select id="' +
            bid +
            '" name="' +
            bid +
            '" class="license-split-editor__status license-split-editor__status-bad license-split-editor__status--tier-' +
            bTier +
            '" autocomplete="off" aria-label="Reportar problema o incidencia">' +
            statusOptionsInnerHtml(OPT_LICENSE_BAD, curSb) +
            '</select>' +
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
            '<input id="' +
            unid +
            '" name="' +
            unid +
            '" type="text" class="license-split-editor__note user-lic-user-row-notes-inp" maxlength="4000" autocomplete="off"' +
            ' aria-label="Tus notas en esta línea (solo vos)"' +
            ' title="Bloc de notas solo para vos; no modifica los apuntes del administrador."' +
            ' placeholder="Notas (solo vos)"' +
            ' value="' +
            escAttr(curUn) +
            '" />' +
            '</div>'
        );
    }

    /** Segmento seguro para id/name en HTML (p. ej. Issues: campos sin id/name). */
    function slugForCredFieldId(fkey) {
        return String(fkey || 'u0').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function renderDaySection(day, rows, credFieldSlug, licenseMeta) {
        var n = rows.length;
        var credParts = [];
        var i;
        for (i = 0; i < rows.length; i += 1) {
            credParts.push(rows[i].cred != null ? String(rows[i].cred) : '');
        }
        var credsJoined = credParts.join('\n');
        var rowLines =
            rows.length > 0
                ? rows
                      .map(function (r, idx) {
                          return renderEditableLicenseRow(r, day, idx, licenseMeta || {});
                      })
                      .join('')
                : '<div class="user-lic-day-empty-msg">Sin movimientos de tu cuenta este día.</div>';
        /* Una fila mínimo (vacío o placeholder); mismas líneas que credenciales reales (+ Enter). */
        var ra = Math.max(1, credParts.length || 1);

        var isCollapsed = n === 0;
        var collapsedClass = isCollapsed ? ' collapsed' : '';
        var slug = slugForCredFieldId(credFieldSlug);
        var taIdName = 'user-lic-creds-' + slug + '-d' + String(day);

        return (
            '<section class="day-section admin-licencias-bloc admin-licencias-bloc--day user-lic-readonly-day' + collapsedClass + '" data-user-day="' +
            day +
            '">' +
            '<div class="day-section-header admin-licencias-bloc-header user-lic-day-header-toggle">' +
            '<span class="admin-licencias-bloc-title">' +
            '<i class="fas fa-calendar-day" aria-hidden="true"></i> <span>Día ' +
            day +
            '</span></span></div>' +
            '<div class="day-accounts-list">' +
            '<div class="license-split-editor license-split-editor--day day-license-split-root day-account-item license-notepad--locked user-lic-days-bundle">' +
            '<div class="license-split-editor__viewport">' +
            '<div class="license-split-editor__grid">' +
            '<div class="license-split-editor__creds-cell">' +
            '<textarea id="' +
            escAttr(taIdName) +
            '" name="' +
            escAttr(taIdName) +
            '" readonly class="admin-licencias-notepad-textarea license-split-editor__creds day-license-split__creds user-lic-creds-ro" rows="' +
            ra +
            '" spellcheck="false" autocomplete="off" aria-readonly="true">' +
            escTextarea(credsJoined) +
            '</textarea>' +
            '</div>' +
            '<div class="license-split-editor__side" aria-label="Estado y notas">' +
            '<div class="license-split-editor__rows day-license-split-rows" role="region">' +
            rowLines +
            '</div></div></div></div></div>' +
            '</div></section>'
        );
    }

    function renderAccountBlock(acc) {
        var dl = acc.day_lines || {};
        var d;
        var daysHtml = '';
        var fkey = licenseFilterKey(acc);
        var credSlug = fkey;
        var licenseMeta = {
            license_id: acc.license_id,
            account_id: acc.account_id != null ? acc.account_id : null,
            virtual: !!(acc.virtual === true || acc.is_virtual === true),
            credSlug: credSlug,
        };
        for (d = 1; d <= 31; d += 1) {
            daysHtml += renderDaySection(d, dl[String(d)] || [], credSlug, licenseMeta);
        }
        var filt =
            (String(acc.product_name || '') +
                ' ' +
                String(acc.credential_preview || '') +
                ' lic' +
                fkey +
                ' ' +
                String(acc.license_id != null ? acc.license_id : ''))
                .toLowerCase()
                .replace(/"/g, '');
        var scrollDay = accountPreferredScrollDay(acc);

        var isVirtual = acc.virtual === true || acc.is_virtual === true;
        var accIdStr = acc.account_id != null ? String(acc.account_id) : '';

        var notesBlock = '';
        if (!isVirtual && acc.account_id != null) {
            notesBlock =
                '<div class="user-lic-client-notes-block">' +
                '<label class="user-lic-client-notes-label" for="userLicNotes-' +
                escAttr(acc.account_id) +
                '">Notas personales</label>' +
                '<textarea id="userLicNotes-' +
                escHtml(String(acc.account_id)) +
                '" class="form-control user-licencias-notes-ta" rows="2" maxlength="8000" data-account-id="' +
                Number(acc.account_id) +
                '" placeholder="Tu bloc de notas (solo visible para ti)">' +
                escTextarea(acc.client_notes || '') +
                '</textarea>' +
                '</div>';
        }


        return (
            '<article class="user-lic-account-sheet' +
            (isVirtual ? ' user-lic-account-sheet--virtual' : '') +
            '" data-search-filter="' +
            escHtml(filt) +
            '" data-account-id="' +
            escAttr(accIdStr) +
            '" data-license-id="' +
            escAttr(fkey) +
            '" data-default-scroll-day="' +
            scrollDay +
            '">' +
            (acc.linked_sale_day != null &&
            acc.linked_sale_day !== '' &&
            !Number.isNaN(Number(acc.linked_sale_day))
                ? '<p class="user-lic-linked-sale-hint"' +
                  (acc.assigned_at_iso
                      ? ' title="' + escHtml('Registro venta: ' + String(acc.assigned_at_iso)) + '"'
                      : '') +
                  '><i class="fas fa-calendar-check" aria-hidden="true"></i> Cuenta vinculada en la tienda al <strong>día ' +
                  escHtml(String(acc.linked_sale_day)) +
                  '</strong> del mes.</p>'
                : '') +
            notesBlock +
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
            var fk = licenseFilterKey(a);
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

    function renderUserLicenciasGrid(summaryList, historialUrl, accountsLen) {
        var parts = [];

        parts.push(
            '<button type="button" class="license-card license-card--aggregate active user-lic-license-card-btn user-lic-license-card--todos" data-user-license-filter="all">' +
            '<div class="license-card-header">' +
            '<h3 class="license-name"><span class="full-text">' +
            escHtml('Todos') +
            '</span><span class="first-letter">T</span></h3>' +
            '</div></button>'
        );

        parts.push(
            '<a href="' +
            escAttr(historialUrl || '#') +
            '" class="license-card license-card--aggregate user-lic-grid-historial">' +
            '<div class="license-card-header">' +
            '<h3 class="license-name"><span class="full-text">' +
            escHtml('Historial') +
            '</span><span class="first-letter">H</span></h3></div></a>'
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
        var visibleByLic = {};
        container.querySelectorAll('.user-lic-account-sheet').forEach(function (art) {
            var lid = art.getAttribute('data-license-id');
            var hay = (art.getAttribute('data-search-filter') || '').trim().toLowerCase();
            var matchLic = licSel === 'all' || String(lid) === licSel;
            var matchQ = !q || hay.indexOf(q) !== -1;
            var show = matchLic && matchQ;
            art.style.display = show ? '' : 'none';
            if (show && lid) visibleByLic[String(lid)] = true;
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

    function applyLicenseFilter(container, gridHost, filterRaw) {
        var licenseIdSel = filterRaw === 'all' || filterRaw == null ? 'all' : String(filterRaw);
        container.dataset.userLicActiveFilter = licenseIdSel;
        refreshSheetVisibility(container);

        if (!gridHost) return;
        gridHost.querySelectorAll('.user-lic-license-card-btn').forEach(function (el) {
            el.classList.remove('active');
        });
        if (licenseIdSel === 'all') {
            var t = gridHost.querySelector('.user-lic-license-card--todos');
            if (t) t.classList.add('active');
            return;
        }
        var b = gridCardByFilterKey(gridHost, licenseIdSel);
        if (b) b.classList.add('active');
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
            applyLicenseFilter(outer, gridHostResolved, filt);
        });
    }

    function scrollDayWithinArticle(article, dayRaw) {
        if (!article) return;
        var d = Number(dayRaw);
        if (!Number.isFinite(d)) d = 1;
        d = Math.max(1, Math.min(31, d));
        var sec = article.querySelector('.user-lic-readonly-day[data-user-day="' + String(d) + '"]');
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
                var section = headerToggle.closest('.day-section');
                if (section) {
                    section.classList.toggle('collapsed');
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

    function attachNoteHandlers(rootEl) {
        var timers = {};
        rootEl.querySelectorAll('.user-licencias-notes-ta').forEach(function (ta) {
            ta.addEventListener('input', function () {
                var id = ta.getAttribute('data-account-id');
                if (!id) return;
                if (timers[id]) window.clearTimeout(timers[id]);
                timers[id] = window.setTimeout(function () {
                    saveNotes(id, ta.value || '', ta);
                }, SAVE_DEBOUNCE_MS);
            });
        });
    }

    function setupCollapseButton() {
        var collapseBtn = document.getElementById('licensesCollapseBtn');
        var collapseIcon = document.getElementById('collapseIcon');
        var licenciasContainer = document.getElementById('userLicenciasGridHost');
        
        if (collapseBtn && licenciasContainer && collapseIcon) {
            var savedState = localStorage.getItem('userLicenciasContainerCollapsed');
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
                        localStorage.setItem('userLicenciasContainerCollapsed', 'true');
                    } else {
                        icon.classList.remove('fa-chevron-down');
                        icon.classList.add('fa-chevron-up');
                        localStorage.setItem('userLicenciasContainerCollapsed', 'false');
                    }
                }
            });
        }
    }

    function saveNotes(accountId, text, textareaEl) {
        var payload = JSON.stringify({ client_notes: text });
        fetch('/tienda/api/user/license-account/' + encodeURIComponent(accountId) + '/client-notes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            credentials: 'same-origin'
        }).catch(function () {
            textareaEl.style.borderColor = 'rgba(248,113,113,0.95)';
            window.setTimeout(function () {
                textareaEl.style.borderColor = '';
            }, 2000);
        });
    }

    function wireSearchFilter(root) {
        var inp = document.getElementById('userLicenciasSearch');
        if (!inp) return;
        inp.addEventListener('input', function () {
            refreshSheetVisibility(root);
        });
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
        var historialUrl = outer.getAttribute('data-historial-url') || '#';

        if (!apiUrl) return;

        setGridVisible(gridHostEl, false);

        fetch(apiUrl, { credentials: 'same-origin' })
            .then(function (r) {
                return r.text().then(function (t) {
                    var data = {};
                    try {
                        data = t ? JSON.parse(t) : {};
                    } catch (eParse) {
                        data = { success: false, error: 'Respuesta inválida del servidor' };
                    }
                    return { httpOk: r.ok, data: data };
                });
            })
            .then(function (res) {
                var data = res.data || {};
                var apiOk = !!(res.httpOk && data && data.success);
                var errMsg =
                    apiOk ?
                    ''
                    : String((data && (data.error || data.message)) || (!res.httpOk ? 'Sin autorización o error HTTP.' : 'No se pudieron cargar los datos.'));
                var accounts = apiOk && Array.isArray(data.accounts) ? data.accounts : [];
                var summaryList = groupSummariesFromAccounts(accounts);

                if (gridInner && gridHostEl) {
                    gridInner.innerHTML = renderUserLicenciasGrid(summaryList, historialUrl, accounts.length);
                    setGridVisible(gridHostEl, true);
                    wireGridClick(gridInner, outer);
                }

                if (!apiOk) {
                    outer.innerHTML =
                        '<div class="user-lic-load-warning mb-3" role="alert">' +
                        '<p class="text-center user-licencias-empty py-3 mb-0">' +
                        escHtml(errMsg) +
                        '</p></div>';
                } else if (!accounts.length) {
                    outer.innerHTML =
                        '<p class="text-center user-licencias-empty py-4 mb-0" role="status">Aún no tienes cuentas asignadas. Si ya compraste, espera la asignación o contacta soporte.</p>';
                } else {
                    outer.innerHTML =
                        '<div class="user-lic-all-accounts">' +
                        accounts.map(function (acc) {
                            return renderAccountBlock(acc);
                        }).join('') +
                        '</div>';
                }

                attachNoteHandlers(outer);
                initEditableLicenseRowsIn(outer);
                wireLicenseStatusAutosave(outer);
                wireSearchFilter(outer);
                wireScrollButtons(outer);
                setupCollapseButton();
                outer.dataset.userLicActiveFilter = 'all';
                applyLicenseFilter(outer, gridHostEl, 'all');
            })
            .catch(function () {
                if (gridInner && gridHostEl) {
                    gridInner.innerHTML = renderUserLicenciasGrid([], historialUrl, 0);
                    setGridVisible(gridHostEl, true);
                    wireGridClick(gridInner, outer);
                }
                outer.innerHTML =
                    '<p class="text-center user-licencias-empty py-4 mb-0">Error de red al cargar licencias.</p>';
                attachNoteHandlers(outer);
                initEditableLicenseRowsIn(outer);
                wireLicenseStatusAutosave(outer);
                wireSearchFilter(outer);
                wireScrollButtons(outer);
                setupCollapseButton();
                outer.dataset.userLicActiveFilter = 'all';
                applyLicenseFilter(outer, gridHostEl, 'all');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
