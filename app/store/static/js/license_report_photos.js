/* Fotos adjuntas a reportes de incidencia (bloc Días de Licencias).
 *
 * Se auto-engancha en tres superficies sin tocar los pipelines de render:
 *  - Portal cliente (/tienda/licencias): botón cámara junto al select rojo.
 *  - Admin Licencias (Días y panel Reportes) y Archivados (mismo stack).
 * Un MutationObserver decora las filas nuevas; los datos viajan por data-*.
 * La imagen se ve en un modal propio; para cuentas compradas al proveedor
 * Multiplataforma se muestra el estado del reporte enviado a su API.
 */
(function () {
    'use strict';

    var URLS = {
        userUpload: '/tienda/api/user/license-report-photo',
        userList: '/tienda/api/user/license-report-photos',
        adminUpload: '/tienda/api/admin/license-report-photo',
        adminList: '/tienda/api/admin/license-report-photos',
        file: function (id) { return '/tienda/api/license-report-photo/' + id + '/file'; },
        adminClose: function (id) { return '/tienda/api/admin/license-report-photo/' + id + '/close'; },
        deleteFile: function (id) { return '/tienda/api/license-report-photo/' + id + '/delete'; }
    };

    var CACHE_TTL_MS = 45000;
    var cache = {}; // 'lic:day' -> { ts, photos }

    function isAdminMode() {
        return !!document.querySelector('.admin-licencias-shell');
    }
    function isPortalMode() {
        return !!document.getElementById('userLicenciasTableOuter');
    }
    function portalViewOnly() {
        var outer = document.getElementById('userLicenciasTableOuter');
        return !!(outer && String(outer.getAttribute('data-licencias-view-only') || '') === '1');
    }

    if (!isAdminMode() && !isPortalMode()) return;

    function csrfToken() {
        var meta = document.querySelector('meta[name="csrf_token"]');
        if (meta && meta.content) return meta.content;
        var m = document.cookie.match(/(?:^|;\s*)_csrf=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ------------------------------------------------------------------
    // Estilos (inyectados para no depender del CSS de cada página)
    // ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('licReportPhotoStyles')) return;
        var css =
            '.lic-report-photo-btn{display:inline-flex;align-items:center;justify-content:center;' +
            'position:relative;overflow:hidden;' +
            'width:1.15rem;height:1.15rem;min-width:1.15rem;max-width:1.15rem;padding:0;margin:0;' +
            'border:1px solid rgba(148,163,184,.4);border-radius:0.2rem;background:#1e293b;color:#e2e8f0;' +
            'cursor:pointer;font-size:0.62rem;line-height:1;flex:0 0 auto;align-self:center;}' +
            '.lic-report-photo-btn i{font-size:0.62rem;line-height:1;pointer-events:none;}' +
            '.lic-report-photo-input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;' +
            'opacity:0 !important;cursor:pointer;font-size:0;color:transparent;' +
            '-webkit-appearance:none;appearance:none;border:0;background:transparent;}' +
            '.lic-report-photo-input::-webkit-file-upload-button{display:none;-webkit-appearance:none;}' +
            '.lic-report-photo-input::file-selector-button{display:none;}' +
            '.license-split-editor__status-select-shell--bad{gap:2px;}' +
            '.license-split-editor__status-select-shell--bad>.license-split-editor__status{flex:1 1 auto;min-width:0;}' +
            '.lic-report-photo-btn:hover{background:#334155;color:#fff;}' +
            '.lic-report-photo-btn.has-photo{background:#0f766e;border-color:#14b8a6;color:#ecfdf5;}' +
            '.lic-report-photo-btn.needs-photo{background:#7c2d12;border-color:#fb923c;color:#ffedd5;}' +
            '.lic-report-photo-btn.has-photo.mp-answered{background:#166534;border-color:#86efac;color:#dcfce7;}' +
            '.lic-report-photo-btn[hidden]{display:none !important;}' +
            '.lic-report-photo-overlay{position:fixed;inset:0;background:rgba(2,6,23,.78);z-index:100000;' +
            'display:flex;align-items:center;justify-content:center;padding:16px;}' +
            '.lic-report-photo-modal{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;' +
            'max-width:min(860px,96vw);max-height:92vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,.55);' +
            'padding:14px 16px 16px;}' +
            '.lic-report-photo-modal__head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}' +
            '.lic-report-photo-modal__title{font-weight:700;font-size:15px;color:#f8fafc;flex:1;}' +
            '.lic-report-photo-modal__close{border:0;background:#1e293b;border-radius:8px;width:30px;height:30px;' +
            'cursor:pointer;font-size:15px;color:#cbd5e1;}' +
            '.lic-report-photo-modal__meta{font-size:12.5px;color:#94a3b8;margin-bottom:8px;line-height:1.5;}' +
            '.lic-report-photo-modal__img{display:block;max-width:100%;max-height:62vh;margin:0 auto;' +
            'border-radius:10px;border:1px solid #334155;background:#020617;}' +
            '.lic-report-photo-modal__noimg{padding:26px 10px;text-align:center;color:#94a3b8;font-size:13px;}' +
            '.lic-report-photo-mp{margin-top:10px;padding:8px 10px;border-radius:8px;font-size:12.5px;line-height:1.5;}' +
            '.lic-report-photo-mp--sent{background:#422006;color:#fde68a;border:1px solid #a16207;}' +
            '.lic-report-photo-mp--failed{background:#450a0a;color:#fecaca;border:1px solid #b91c1c;}' +
            '.lic-report-photo-mp--answered{background:#14532d;color:#bbf7d0;border:1px solid #166534;}' +
            '.lic-report-photo-modal__actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}' +
            '.lic-report-photo-modal__actions button{border:1px solid #475569;background:#1e293b;color:#f8fafc;' +
            'border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;}' +
            '.lic-report-photo-modal__actions button:hover{background:#334155;}' +
            '.lic-report-photo-modal__actions button.danger{border-color:#7f1d1d;color:#fecaca;}' +
            '.lic-report-photo-modal__actions button.danger:hover{background:#7f1d1d;}' +
            '.lic-report-photo-modal-file{position:relative;overflow:hidden;display:inline-flex;align-items:center;' +
            'border:1px solid #475569;background:#1e293b;color:#f8fafc;border-radius:8px;padding:7px 12px;' +
            'font-size:12.5px;cursor:pointer;}' +
            '.lic-report-photo-modal-file:hover{background:#334155;}' +
            '.lic-report-photo-modal-file .lic-report-photo-input{position:absolute;inset:0;opacity:0;cursor:pointer;}';
        var style = document.createElement('style');
        style.id = 'licReportPhotoStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // API
    // ------------------------------------------------------------------
    function listUrl() {
        return isAdminMode() ? URLS.adminList : URLS.userList;
    }

    function fetchPhotos(licenseId, day, force) {
        var key = licenseId + ':' + day;
        var hit = cache[key];
        var now = Date.now();
        if (!force && hit && now - hit.ts < CACHE_TTL_MS) {
            return Promise.resolve(hit.photos);
        }
        var url = listUrl() + '?license_id=' + encodeURIComponent(licenseId) +
            '&calendar_day=' + encodeURIComponent(day);
        return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (data) {
                var photos = (data && data.success && Array.isArray(data.photos)) ? data.photos : [];
                cache[key] = { ts: Date.now(), photos: photos };
                return photos;
            })
            .catch(function () { return []; });
    }

    function invalidate(licenseId, day) {
        delete cache[licenseId + ':' + day];
    }

    function normCred(s) {
        return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function matchPhoto(photos, ctx) {
        if (!photos || !photos.length) return null;
        var credN = normCred(ctx.cred || '');
        var best = null;
        for (var i = 0; i < photos.length; i++) {
            var p = photos[i];
            if (ctx.accountId && p.account_id && Number(p.account_id) === Number(ctx.accountId)) return p;
            if (credN && p.cred_hint) {
                var ph = normCred(p.cred_hint);
                if (ph && (ph.indexOf(credN) !== -1 || credN.indexOf(ph) !== -1)) return p;
            }
            if (ctx.ordinal != null && p.row_ordinal != null &&
                Number(p.row_ordinal) === Number(ctx.ordinal)) best = best || p;
        }
        return best || (photos.length === 1 ? photos[0] : null);
    }

    function uploadPhoto(fields, file) {
        var fd = new FormData();
        Object.keys(fields).forEach(function (k) {
            if (fields[k] != null && fields[k] !== '') fd.append(k, fields[k]);
        });
        fd.append('image', file);
        var url = isAdminMode() ? URLS.adminUpload : URLS.userUpload;
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': csrfToken(), Accept: 'application/json' },
            body: fd
        }).then(function (r) {
            return r.json().catch(function () { return { success: false, error: 'Respuesta inválida.' }; });
        });
    }

    function closePhotoFile(photoId) {
        return fetch(URLS.deleteFile(photoId), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': csrfToken(), Accept: 'application/json' }
        }).then(function (r) { return r.json().catch(function () { return {}; }); });
    }

    function pickFile(cb) {
        /* No usar input.click() diferido: Chrome lo bloquea sin gestos de usuario. */
        cb(null);
    }

    var FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic';

    function fileInputHtml() {
        return '<input type="file" class="lic-report-photo-input" accept="' + FILE_ACCEPT + '" tabindex="-1" aria-hidden="true">';
    }

    // ------------------------------------------------------------------
    // Modal
    // ------------------------------------------------------------------
    function closeModal() {
        var ov = document.getElementById('licReportPhotoOverlay');
        if (ov) ov.remove();
        document.removeEventListener('keydown', onModalKeydown, true);
    }
    function onModalKeydown(ev) {
        if (ev.key === 'Escape') closeModal();
    }

    function mpBlockHtml(photo) {
        if (!photo.mp_sent && !photo.mp_status) return '';
        var cls, text;
        if (photo.mp_status === 'answered') {
            cls = 'answered';
            text = 'El reporte ya fue respondido.';
        } else if (photo.mp_status === 'failed') {
            cls = 'failed';
            text = 'No se pudo completar el reporte. Vuelve a subir la foto.';
        } else if (photo.mp_status === 'sent') {
            cls = 'sent';
            text = 'Reporte completo. Pendiente de respuesta.';
        } else {
            return '';
        }
        return '<div class="lic-report-photo-mp lic-report-photo-mp--' + cls + '">' + text + '</div>';
    }

    function openPhotoModal(photo, ctx) {
        closeModal();
        var canEdit = isAdminMode() || !portalViewOnly();
        var metaBits = [];
        if (photo.status_label) metaBits.push('<strong>' + escapeHtml(photo.status_label) + '</strong>');
        if (photo.cred_hint) metaBits.push('<code>' + escapeHtml(photo.cred_hint) + '</code>');
        if (photo.created_at) metaBits.push(escapeHtml(photo.created_at));

        var imgHtml;
        if (photo.has_file) {
            imgHtml = '<img class="lic-report-photo-modal__img" src="' + URLS.file(photo.id) +
                '" alt="Foto del reporte">';
        } else {
            imgHtml = '<div class="lic-report-photo-modal__noimg">Sube la foto de este reporte.</div>';
        }

        var actions = [];
        if (canEdit) {
            if (photo.has_file) {
                actions.push(
                    '<label class="lic-report-photo-modal-file">' +
                    'Reemplazar' + fileInputHtml() + '</label>'
                );
                actions.push('<button type="button" class="danger" data-act="delete">Eliminar foto</button>');
            } else {
                actions.push(
                    '<label class="lic-report-photo-modal-file">' +
                    'Subir foto' + fileInputHtml() + '</label>'
                );
            }
        }

        var ov = document.createElement('div');
        ov.className = 'lic-report-photo-overlay';
        ov.id = 'licReportPhotoOverlay';
        ov.innerHTML =
            '<div class="lic-report-photo-modal" role="dialog" aria-label="Foto del reporte">' +
            '<div class="lic-report-photo-modal__head">' +
            '<div class="lic-report-photo-modal__title">Foto del reporte</div>' +
            '<button type="button" class="lic-report-photo-modal__close" aria-label="Cerrar">&times;</button>' +
            '</div>' +
            (metaBits.length ? '<div class="lic-report-photo-modal__meta">' + metaBits.join(' · ') + '</div>' : '') +
            imgHtml +
            mpBlockHtml(photo) +
            (actions.length ? '<div class="lic-report-photo-modal__actions">' + actions.join('') + '</div>' : '') +
            '</div>';
        document.body.appendChild(ov);
        ov._licPhotoCtx = ctx;
        document.addEventListener('keydown', onModalKeydown, true);

        ov.addEventListener('click', function (ev) {
            if (ev.target === ov || ev.target.closest('.lic-report-photo-modal__close')) {
                closeModal();
                return;
            }
            var actBtn = ev.target.closest('button[data-act]');
            if (!actBtn) return;
            var act = actBtn.getAttribute('data-act');
            if (act === 'delete') {
                if (!window.confirm('¿Eliminar esta foto? El reporte sigue abierto: puedes subir otra.')) return;
                closePhotoFile(photo.id).then(function (res) {
                    if (res && res.success) {
                        invalidate(photo.license_id, photo.calendar_day);
                        closeModal();
                        refreshIndicatorsSoon();
                    } else {
                        window.alert((res && res.error) || 'No se pudo eliminar.');
                    }
                });
            }
        });
    }

    // ------------------------------------------------------------------
    // Flujo de subida
    // ------------------------------------------------------------------
    function startUploadFlow(ctx, file) {
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            window.alert('La imagen supera el máximo de 15 MB.');
            return;
        }
        uploadPhoto(
            {
                license_id: ctx.licenseId,
                calendar_day: ctx.day,
                row_ordinal: ctx.ordinal != null ? ctx.ordinal : '',
                account_id: ctx.accountId || '',
                cred_hint: ctx.cred || '',
                status_label: ctx.statusLabel || ''
            },
            file
        ).then(function (res) {
            if (res && res.success) {
                invalidate(ctx.licenseId, ctx.day);
                refreshIndicatorsSoon();
                closeModal();
                var msg = 'Foto del reporte subida.';
                if (res.mp_warning) msg += '\n\n' + res.mp_warning;
                else if (res.photo && res.photo.mp_status === 'sent') {
                    msg += ' El reporte ya quedó completo.';
                }
                window.alert(msg);
            } else {
                window.alert((res && res.error) || 'No se pudo subir la imagen.');
            }
        });
    }

    // ------------------------------------------------------------------
    // Contexto por superficie
    // ------------------------------------------------------------------
    var REPORTABLE_BAD = {
        'caida o suspendida': 1, 'no reproduce': 1, 'error de contraseña': 1,
        'repetida': 1, 'otro': 1, 'pendiente garantia': 1
    };

    function portalRowCred(row) {
        try {
            var root = row.closest('.day-license-split-root');
            var ta = root && root.querySelector('textarea.user-lic-creds-ro');
            if (!ta) return '';
            var li = Number(row.getAttribute('data-lic-creds-line-index'));
            if (!Number.isFinite(li) || li < 0) li = 0;
            var line = String(ta.value || '').split(/\r?\n/)[li] || '';
            var sep = line.indexOf('\x1f');
            return (sep >= 0 ? line.slice(0, sep) : line).trim();
        } catch (e) {
            return '';
        }
    }

    function portalCtxFromRow(row) {
        var sel = row.querySelector('select.license-split-editor__status-bad');
        var statusLabel = '';
        var badVal = '';
        if (sel) {
            badVal = String(sel.value || '').trim().toLowerCase();
            var opt = sel.options[sel.selectedIndex];
            statusLabel = opt ? String(opt.textContent || '').trim() : '';
        }
        return {
            licenseId: Number(row.getAttribute('data-lic-row-license-id')),
            day: Number(row.getAttribute('data-lic-row-day')),
            ordinal: Number(row.getAttribute('data-lic-row-ordinal')),
            accountId: row.getAttribute('data-lic-row-account-id') || '',
            cred: portalRowCred(row),
            statusLabel: statusLabel,
            badValue: badVal
        };
    }

    function adminCtxFromRow(row) {
        var dayRoot = row.closest('.day-license-split-root');
        if (!dayRoot) return null;
        var licenseId = parseInt(dayRoot.dataset.licenseId, 10);
        var day = parseInt(dayRoot.dataset.day, 10);
        if (!Number.isFinite(licenseId) || !Number.isFinite(day)) return null;
        var rows = Array.prototype.slice.call(
            dayRoot.querySelectorAll('.license-split-editor__row')
        );
        var ordinal = rows.indexOf(row);
        var accountId = '';
        var cred = '';
        try {
            if (typeof window.adminLicWarrantyDayBlocContext === 'function') {
                var c = window.adminLicWarrantyDayBlocContext(row, dayRoot, ordinal);
                if (c && c.ok) accountId = c.accountIdStr || '';
            }
        } catch (e) { /* opcional */ }
        try {
            if (typeof window.adminLicWarrantyDayRowLineParts === 'function') {
                var parts = window.adminLicWarrantyDayRowLineParts(dayRoot, ordinal);
                if (parts && parts.cred) cred = String(parts.cred).trim();
            }
        } catch (e) { /* opcional */ }
        var sel = row.querySelector('select.license-split-editor__status-bad');
        var statusLabel = '';
        var badVal = '';
        if (sel) {
            badVal = String(sel.value || '').trim().toLowerCase();
            var opt = sel.options[sel.selectedIndex];
            statusLabel = opt ? String(opt.textContent || '').trim() : '';
        }
        return {
            licenseId: licenseId,
            day: day,
            ordinal: ordinal >= 0 ? ordinal : null,
            accountId: accountId,
            cred: cred,
            statusLabel: statusLabel,
            badValue: badVal
        };
    }

    // ------------------------------------------------------------------
    // Botones cámara (decoración de filas)
    // ------------------------------------------------------------------
    function buttonHtml(extraClass, extraAttrs) {
        return '<label class="lic-report-photo-btn' +
            (extraClass ? ' ' + extraClass : '') +
            '" title="Foto del reporte (ver o subir)" aria-label="Foto del reporte"' +
            (extraAttrs || '') + '>' +
            '<i class="fas fa-camera" aria-hidden="true"></i>' +
            fileInputHtml() +
            '</label>';
    }

    function ensureRowButton(row) {
        var shell = row.querySelector('.license-split-editor__status-select-shell--bad');
        if (!shell || shell.querySelector('.lic-report-photo-btn')) return;
        var sel = shell.querySelector('select.license-split-editor__status-bad');
        var tmp = document.createElement('div');
        tmp.innerHTML = buttonHtml('');
        var btn = tmp.firstChild;
        var badVal = sel ? String(sel.value || '').trim().toLowerCase() : '';
        if (!REPORTABLE_BAD[badVal]) btn.hidden = true;
        if (sel) shell.insertBefore(btn, sel);
        else shell.appendChild(btn);
    }

    function rowSelector() {
        return isPortalMode()
            ? '.user-lic-license-row-edit'
            : '.day-license-split-root .license-split-editor__row';
    }

    var scanScheduled = false;
    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        setTimeout(function () {
            scanScheduled = false;
            try { scanAll(); } catch (e) { /* nunca romper la página */ }
        }, 250);
    }

    function scanAll() {
        var rows = document.querySelectorAll(rowSelector());
        var groups = {}; // 'lic:day' -> [{row, ctx}]
        rows.forEach(function (row) {
            ensureRowButton(row);
            var btn = row.querySelector('.lic-report-photo-btn');
            if (!btn || btn.hidden) return;
            var ctx = isPortalMode() ? portalCtxFromRow(row) : adminCtxFromRow(row);
            if (!ctx || !Number.isFinite(ctx.licenseId) || !Number.isFinite(ctx.day)) return;
            var key = ctx.licenseId + ':' + ctx.day;
            (groups[key] = groups[key] || []).push({ row: row, ctx: ctx });
        });
        Object.keys(groups).forEach(function (key) {
            var items = groups[key];
            var first = items[0].ctx;
            fetchPhotos(first.licenseId, first.day).then(function (photos) {
                items.forEach(function (it) {
                    var btn = it.row.querySelector('.lic-report-photo-btn');
                    if (!btn) return;
                    var photo = matchPhoto(photos, it.ctx);
                    btn.classList.toggle('has-photo', !!(photo && photo.has_file));
                    btn.classList.toggle('needs-photo', !!(photo && photo.needs_photo && !photo.has_file));
                    btn.classList.toggle('mp-answered', !!(photo && photo.mp_status === 'answered'));
                    if (photo && photo.has_file) {
                        btn.title = 'Ver foto del reporte';
                    } else if (photo && photo.needs_photo) {
                        btn.title = 'Sube la foto de este reporte';
                    } else {
                        btn.title = 'Subir foto del reporte';
                    }
                });
            });
        });
    }

    function refreshIndicatorsSoon() {
        setTimeout(scanAll, 300);
    }

    // ------------------------------------------------------------------
    // Panel Reportes (admin): botones con data-photo-*
    // ------------------------------------------------------------------
    function ctxFromCamera(btn) {
        if (btn.hasAttribute('data-photo-license-id')) return panelBtnCtx(btn);
        var row = btn.closest(rowSelector());
        if (!row) return null;
        return isPortalMode() ? portalCtxFromRow(row) : adminCtxFromRow(row);
    }

    function panelBtnCtx(btn) {
        var lid = Number(btn.getAttribute('data-photo-license-id'));
        var day = Number(btn.getAttribute('data-photo-day'));
        if (!Number.isFinite(lid) || !Number.isFinite(day)) return null;
        var ordRaw = btn.getAttribute('data-photo-ordinal');
        var cred = '';
        try {
            cred = decodeURIComponent(btn.getAttribute('data-photo-cred') || '');
        } catch (e) { cred = ''; }
        return {
            licenseId: lid,
            day: day,
            ordinal: ordRaw !== null && ordRaw !== '' ? Number(ordRaw) : null,
            accountId: '',
            cred: cred,
            statusLabel: btn.getAttribute('data-photo-status') || ''
        };
    }

    // ------------------------------------------------------------------
    // Eventos
    // ------------------------------------------------------------------
    document.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.lic-report-photo-btn');
        if (!btn) return;
        ev.stopPropagation();
        /* Si ya hay foto, no abrir el selector: mostrar el visor. */
        if (btn.classList.contains('has-photo')) {
            ev.preventDefault();
            var ctx = ctxFromCamera(btn);
            if (!ctx || !Number.isFinite(ctx.licenseId) || !Number.isFinite(ctx.day)) {
                window.alert('No se pudo identificar la fila del reporte.');
                return;
            }
            fetchPhotos(ctx.licenseId, ctx.day, true).then(function (photos) {
                var photo = matchPhoto(photos, ctx);
                if (photo && photo.has_file) openPhotoModal(photo, ctx);
            });
        }
        /* Si no hay foto, el <input type=file> nativo abre el diálogo (gesto de usuario). */
    }, true);

    document.addEventListener('change', function (ev) {
        var input = ev.target;
        if (!input || !input.classList || !input.classList.contains('lic-report-photo-input')) return;
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        var btn = input.closest('.lic-report-photo-btn') || input.closest('.lic-report-photo-modal-file');
        var ctx = null;
        if (btn && btn.classList.contains('lic-report-photo-btn')) {
            ctx = ctxFromCamera(btn);
        } else if (input.closest('.lic-report-photo-modal')) {
            var ov = document.getElementById('licReportPhotoOverlay');
            ctx = ov && ov._licPhotoCtx;
        }
        if (!ctx || !Number.isFinite(ctx.licenseId) || !Number.isFinite(ctx.day)) {
            window.alert('No se pudo identificar la fila del reporte.');
            return;
        }
        startUploadFlow(ctx, file);
    }, true);

    // Mostrar/ocultar el botón cuando cambia el estado rojo
    document.addEventListener('change', function (ev) {
        var sel = ev.target;
        if (!sel.classList || !sel.classList.contains('license-split-editor__status-bad')) return;
        var shell = sel.closest('.license-split-editor__status-select-shell--bad');
        var btn = shell && shell.querySelector('.lic-report-photo-btn');
        if (!btn) {
            scheduleScan();
            return;
        }
        var badVal = String(sel.value || '').trim().toLowerCase();
        btn.hidden = !REPORTABLE_BAD[badVal];
        if (!btn.hidden) refreshIndicatorsSoon();
    }, true);

    // ------------------------------------------------------------------
    // Observador de filas nuevas
    // ------------------------------------------------------------------
    function init() {
        injectStyles();
        scheduleScan();
        var mo = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.addedNodes && m.addedNodes.length) {
                    scheduleScan();
                    return;
                }
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
