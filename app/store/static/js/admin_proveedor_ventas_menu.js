/**
 * Modal «Proveedores — ventas por servicio» (Menú2 en todas las plantillas admin).
 * SSE con fallback a sondeo ligero mientras el modal está abierto.
 */
(function () {
    'use strict';

    var __cache = null;
    var __activeUserId = null;
    var __infoOpener = null;
    var __modalOpener = null;
    var __sseHandle = null;
    var __pollTimer = null;
    var __lastStatsRev = null;
    var POLL_MS = 4000;
    var PROVEEDOR_STATS_SSE_URL = '/tienda/api/admin/proveedor-sales-stats/stream';
    var PROVEEDOR_STATS_REV_URL = '/tienda/api/admin/proveedor-sales-stats/rev';

    function logError(context, err) {
        if (typeof adminLicLogError === 'function') {
            adminLicLogError(context, err);
        } else {
            console.error(context, err);
        }
    }

    function escHtml(str) {
        return String(str != null ? str : '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function metaUrl(name, fallback) {
        var el = document.querySelector('meta[name="' + name + '"]');
        return (el && el.getAttribute('content')) || fallback;
    }

    function apiUrl() {
        var shell = document.querySelector('.admin-licencias-shell');
        return (
            (shell && shell.getAttribute('data-admin-proveedor-sales-url')) ||
            metaUrl('admin-proveedor-sales-url', '/tienda/api/admin/proveedor-sales-stats')
        );
    }

    function resetApiUrl() {
        var shell = document.querySelector('.admin-licencias-shell');
        return (
            (shell && shell.getAttribute('data-admin-proveedor-sales-reset-url')) ||
            metaUrl('admin-proveedor-sales-reset-url', '/tienda/api/admin/proveedor-sales-stats/reset')
        );
    }

    function dayApiUrl() {
        return metaUrl('admin-proveedor-sales-day-url', '/tienda/api/admin/proveedor-sales-stats/day');
    }

    function colombiaTodayIso() {
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Bogota',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date());
        } catch (_err) {
            var d = new Date();
            var m = String(d.getMonth() + 1).padStart(2, '0');
            var day = String(d.getDate()).padStart(2, '0');
            return d.getFullYear() + '-' + m + '-' + day;
        }
    }

    function formatMoneyPlain(n, cur) {
        var x = Number(n) || 0;
        var abs = Math.abs(x - Math.round(x)) < 0.005;
        var s = abs
            ? String(Math.round(x))
            : x.toFixed(2).replace('.', ',');
        if (abs) {
            s = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        } else {
            var parts = s.split(',');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            s = parts.join(',');
        }
        return '$' + s + ' ' + (cur || 'COP');
    }

    function ensureDayDateDefault() {
        var inp = document.getElementById('adminLicProveedorVentasDayDate');
        if (!inp) return '';
        if (!inp.value) inp.value = colombiaTodayIso();
        return inp.value;
    }

    var __dayAbort = null;

    function renderDayReview(data) {
        var body = document.getElementById('adminLicProveedorVentasDayBody');
        if (!body) return;
        if (!data) {
            body.innerHTML = '<p class="admin-lic-proveedor-ventas-day__empty">Elige un proveedor y una fecha.</p>';
            return;
        }
        var chips = [];
        chips.push(
            '<span class="admin-lic-proveedor-ventas-day__chip">' +
                escHtml(String(data.ventas || 0)) +
                ' vendida' +
                (Number(data.ventas) === 1 ? '' : 's') +
                '</span>'
        );
        if (Number(data.renovaciones) > 0) {
            chips.push(
                '<span class="admin-lic-proveedor-ventas-day__chip admin-lic-proveedor-ventas-day__chip--ok">' +
                    escHtml(String(data.renovaciones)) +
                    ' renovada' +
                    (Number(data.renovaciones) === 1 ? '' : 's') +
                    '</span>'
            );
        }
        chips.push(
            '<span class="admin-lic-proveedor-ventas-day__chip admin-lic-proveedor-ventas-day__chip--warn">' +
                escHtml(String(data.garantias || 0)) +
                ' garantía' +
                (Number(data.garantias) === 1 ? '' : 's') +
                '</span>'
        );
        chips.push(
            '<span class="admin-lic-proveedor-ventas-day__chip admin-lic-proveedor-ventas-day__chip--refund">' +
                escHtml(String(data.reembolsos || 0)) +
                ' reembolso' +
                (Number(data.reembolsos) === 1 ? '' : 's') +
                '</span>'
        );
        var ingresos = data.ingresos || {};
        ['COP', 'USD'].forEach(function (cur) {
            if (Number(ingresos[cur]) > 0) {
                chips.push(
                    '<span class="admin-lic-proveedor-ventas-day__chip admin-lic-proveedor-ventas-day__chip--money">' +
                        escHtml(formatMoneyPlain(ingresos[cur], cur)) +
                        '</span>'
                );
            }
        });
        var refundAmt = data.reembolsos_monto || {};
        ['COP', 'USD'].forEach(function (cur) {
            if (Number(refundAmt[cur]) > 0) {
                chips.push(
                    '<span class="admin-lic-proveedor-ventas-day__chip admin-lic-proveedor-ventas-day__chip--refund">Dev. ' +
                        escHtml(formatMoneyPlain(refundAmt[cur], cur)) +
                        '</span>'
                );
            }
        });

        var html = '<div class="admin-lic-proveedor-ventas-day__chips">' + chips.join('') + '</div>';
        var productos = Array.isArray(data.productos) ? data.productos : [];
        if (productos.length) {
            html +=
                '<div class="admin-lic-proveedor-ventas-day__block"><p class="admin-lic-proveedor-ventas-day__block-title">Vendidas</p>';
            productos.forEach(function (p) {
                html +=
                    '<p class="admin-lic-proveedor-ventas-day__row">' +
                    escHtml(p.producto || '—') +
                    ' · ' +
                    escHtml(String(p.ventas || 0)) +
                    (Number(p.renovaciones) > 0 ? ' (' + escHtml(String(p.renovaciones)) + ' ren.)' : '') +
                    ' · ' +
                    escHtml(formatMoneyPlain(p.total, p.moneda)) +
                    '</p>';
            });
            html += '</div>';
        }
        var gdet = Array.isArray(data.garantias_detalle) ? data.garantias_detalle : [];
        if (gdet.length) {
            html +=
                '<div class="admin-lic-proveedor-ventas-day__block"><p class="admin-lic-proveedor-ventas-day__block-title">Garantías</p>';
            gdet.forEach(function (g) {
                html +=
                    '<p class="admin-lic-proveedor-ventas-day__row"><strong>' +
                    escHtml(g.producto || 'Producto') +
                    '</strong> · ' +
                    escHtml(g.cuenta || '—') +
                    ' <span class="admin-lic-proveedor-ventas-day__muted">→</span> ' +
                    escHtml(g.repuesto || '—') +
                    '</p>';
            });
            html += '</div>';
        }
        var rdet = Array.isArray(data.reembolsos_detalle) ? data.reembolsos_detalle : [];
        if (rdet.length) {
            html +=
                '<div class="admin-lic-proveedor-ventas-day__block"><p class="admin-lic-proveedor-ventas-day__block-title">Reembolsos</p>';
            rdet.forEach(function (r) {
                html +=
                    '<p class="admin-lic-proveedor-ventas-day__row"><strong>' +
                    escHtml(r.producto || 'Licencia') +
                    '</strong>' +
                    (r.cuenta ? ' · ' + escHtml(r.cuenta) : '') +
                    (Number(r.dias) > 0 ? ' · ' + escHtml(String(r.dias)) + ' d' : '') +
                    ' · ' +
                    escHtml(formatMoneyPlain(r.total, r.moneda)) +
                    '</p>';
            });
            html += '</div>';
        }
        if (
            !productos.length &&
            !gdet.length &&
            !rdet.length &&
            !Number(data.ventas) &&
            !Number(data.garantias) &&
            !Number(data.reembolsos)
        ) {
            html +=
                '<p class="admin-lic-proveedor-ventas-day__empty">Sin movimiento ese día en el historial de este proveedor.</p>';
        }
        body.innerHTML = html;
    }

    function loadDayReview() {
        var body = document.getElementById('adminLicProveedorVentasDayBody');
        var provider = getActiveProvider();
        var dateIso = ensureDayDateDefault();
        if (!body) return;
        if (!provider || !provider.user_id || !dateIso) {
            renderDayReview(null);
            return;
        }
        if (__dayAbort && typeof __dayAbort.abort === 'function') {
            try {
                __dayAbort.abort();
            } catch (_e) {}
        }
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        __dayAbort = ctrl;
        body.innerHTML = '<p class="admin-lic-proveedor-ventas-day__loading">Cargando el día…</p>';
        var url =
            dayApiUrl() +
            '?user_id=' +
            encodeURIComponent(String(provider.user_id)) +
            '&date=' +
            encodeURIComponent(dateIso) +
            '&_t=' +
            Date.now();
        fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: ctrl ? ctrl.signal : undefined,
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (pack) {
                if (ctrl && __dayAbort !== ctrl) return;
                if (!pack.ok || !pack.data || !pack.data.success) {
                    throw new Error(
                        (pack.data && (pack.data.error || pack.data.message)) ||
                            'No se pudo cargar el día.'
                    );
                }
                renderDayReview(pack.data.review);
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                if (ctrl && __dayAbort !== ctrl) return;
                body.innerHTML =
                    '<p class="admin-lic-proveedor-ventas-day__error">' +
                    escHtml((err && err.message) || 'No se pudo cargar el día.') +
                    '</p>';
            });
    }

    function getActiveProvider() {
        if (!__cache || !__cache.length) return null;
        var uid = __activeUserId;
        if (uid != null) {
            var hit = __cache.find(function (p) {
                return String(p.user_id) === String(uid);
            });
            if (hit) return hit;
        }
        return __cache[0];
    }

    function renderList() {
        var listEl = document.getElementById('adminLicProveedorVentasList');
        var meta = document.getElementById('adminLicProveedorVentasMeta');
        var searchInp = document.getElementById('adminLicProveedorVentasSearch');
        if (!listEl) return;
        if (!__cache || !__cache.length) {
            listEl.innerHTML =
                '<p class="admin-lic-proveedor-ventas-list__empty">No hay usuarios con permiso de proveedor. Actívalo en la gestión de permisos de usuario.</p>';
            if (meta) meta.textContent = '';
            return;
        }
        var provider = getActiveProvider();
        var q = searchInp ? String(searchInp.value || '').toLowerCase().trim() : '';
        listEl.innerHTML = '';
        if (!provider || !provider.services || !provider.services.length) {
            listEl.innerHTML =
                '<p class="admin-lic-proveedor-ventas-list__empty">No hay servicios configurados para este proveedor. Márcalos en permisos de usuario → Proveedor.</p>';
            if (meta) meta.textContent = '';
            return;
        }
        var filtered = provider.services.filter(function (svc) {
            if (!q) return true;
            return String(svc.name || '')
                .toLowerCase()
                .includes(q);
        });
        if (!filtered.length) {
            listEl.innerHTML =
                '<p class="admin-lic-proveedor-ventas-list__empty">Ningún servicio coincide con la búsqueda.</p>';
            if (meta) meta.textContent = '0 servicios (filtrado)';
            return;
        }
        filtered.forEach(function (svc) {
            var count = Math.max(0, parseInt(svc.sales_count, 10) || 0);
            var renewCount = Math.max(0, parseInt(svc.renewals_count, 10) || 0);
            var showRenew = !!svc.renew_customer || renewCount > 0;
            var item = document.createElement('div');
            item.className = 'admin-lic-proveedor-ventas-item';
            item.setAttribute('role', 'listitem');
            item.setAttribute('data-proveedor-license-id', String(svc.license_id));
            item.innerHTML =
                '<span class="admin-lic-proveedor-ventas-item__name">' +
                escHtml(svc.name || '—') +
                '</span>' +
                (showRenew
                    ? '<span class="admin-lic-proveedor-ventas-item__count admin-lic-proveedor-ventas-item__count--renew" aria-live="polite" aria-atomic="true" title="Renovadas (renovar tu cuenta)">🔄 ' +
                      escHtml(String(renewCount)) +
                      '</span>'
                    : '') +
                '<span class="admin-lic-proveedor-ventas-item__count" aria-live="polite" aria-atomic="true" title="Vendidas">' +
                escHtml(String(count)) +
                '</span>' +
                '<button type="button" class="admin-lic-proveedor-ventas-reset-btn" data-proveedor-user-id="' +
                escHtml(String(provider.user_id)) +
                '" data-proveedor-license-id="' +
                escHtml(String(svc.license_id)) +
                '" data-proveedor-service-name="' +
                escHtml(svc.name || '') +
                '" title="Resetear contador a 0" aria-label="Resetear contador de ' +
                escHtml(svc.name || 'servicio') +
                ' a 0"><i class="fas fa-undo" aria-hidden="true"></i></button>';
            listEl.appendChild(item);
        });
        var totalSold = filtered.reduce(function (acc, svc) {
            return acc + Math.max(0, parseInt(svc.sales_count, 10) || 0);
        }, 0);
        var totalRenewed = filtered.reduce(function (acc, svc) {
            return acc + Math.max(0, parseInt(svc.renewals_count, 10) || 0);
        }, 0);
        if (meta) {
            meta.textContent =
                filtered.length +
                (filtered.length === 1 ? ' servicio' : ' servicios') +
                ' · ' +
                totalSold +
                (totalSold === 1 ? ' vendida' : ' vendidas') +
                (totalRenewed > 0
                    ? ' · ' + totalRenewed + (totalRenewed === 1 ? ' renovada' : ' renovadas')
                    : '');
        }
    }

    function isModalOpen() {
        var modal = document.getElementById('adminLicProveedorVentasModal');
        return !!(modal && !modal.hidden);
    }

    async function refreshFromStatsSignal() {
        if (!isModalOpen()) {
            stopRealtime();
            return;
        }
        try {
            await load(true);
            syncProviderSelect();
            renderList();
        } catch (err) {
            logError('adminLicProveedorVentasRefresh:', err);
        }
    }

    function onProveedorStatsSse(data) {
        if (!data || data.type !== 'proveedor_stats_rev' || data.stats_rev == null) return;
        var nextRev = String(data.stats_rev);
        if (__lastStatsRev === null) {
            __lastStatsRev = nextRev;
            return;
        }
        if (nextRev === __lastStatsRev) return;
        __lastStatsRev = nextRev;
        void refreshFromStatsSignal();
    }

    function stopRealtime() {
        if (__sseHandle) {
            __sseHandle.close();
            __sseHandle = null;
        }
        if (__pollTimer != null) {
            clearInterval(__pollTimer);
            __pollTimer = null;
        }
    }

    async function pollStatsRev() {
        if (!isModalOpen()) {
            stopRealtime();
            return;
        }
        try {
            var res = await fetch(PROVEEDOR_STATS_REV_URL + '?_t=' + Date.now(), {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
            var data = await res.json().catch(function () {
                return null;
            });
            if (!res.ok || !data || !data.success || data.stats_rev == null) return;
            onProveedorStatsSse({ type: 'proveedor_stats_rev', stats_rev: data.stats_rev });
        } catch (_err) {}
    }

    function startPollFallback() {
        if (__pollTimer != null) return;
        void pollStatsRev();
        __pollTimer = window.setInterval(function () {
            void pollStatsRev();
        }, POLL_MS);
    }

    function startRealtime() {
        if (!isModalOpen()) return;
        stopRealtime();
        if (typeof window.StoreSseRealtime !== 'undefined' && typeof window.StoreSseRealtime.connectOrFallback === 'function') {
            __sseHandle = window.StoreSseRealtime.connectOrFallback(
                PROVEEDOR_STATS_SSE_URL,
                onProveedorStatsSse,
                startPollFallback
            );
        } else {
            startPollFallback();
        }
    }

    function syncProviderSelect() {
        var sel = document.getElementById('adminLicProveedorVentasProviderSelect');
        var searchInp = document.getElementById('adminLicProveedorVentasSearch');
        var controls = document.querySelector('.admin-lic-proveedor-ventas-modal__controls');
        if (!sel) return;
        var prev = __activeUserId;
        sel.innerHTML = '';
        if (!__cache || !__cache.length) {
            sel.disabled = true;
            var opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Sin proveedores';
            sel.appendChild(opt);
            if (searchInp) {
                searchInp.disabled = true;
                searchInp.value = '';
            }
            if (controls) controls.hidden = true;
            var dayWrap = document.getElementById('adminLicProveedorVentasDay');
            if (dayWrap) dayWrap.hidden = true;
            return;
        }
        if (controls) controls.hidden = false;
        var dayWrapShow = document.getElementById('adminLicProveedorVentasDay');
        if (dayWrapShow) dayWrapShow.hidden = false;
        sel.disabled = false;
        if (searchInp) searchInp.disabled = false;
        __cache.forEach(function (p) {
            var o = document.createElement('option');
            o.value = String(p.user_id);
            o.textContent = p.username || String(p.user_id);
            sel.appendChild(o);
        });
        if (
            prev != null &&
            __cache.some(function (p) {
                return String(p.user_id) === String(prev);
            })
        ) {
            sel.value = String(prev);
            __activeUserId = prev;
        } else {
            __activeUserId = __cache[0].user_id;
            sel.value = String(__activeUserId);
        }
    }

    async function load(force) {
        if (__cache && !force) {
            return __cache;
        }
        var res = await fetch(apiUrl(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        var data = await res.json().catch(function () {
            return { success: false };
        });
        if (!res.ok || !data || !data.success) {
            throw new Error((data && (data.error || data.message)) || 'No se pudieron cargar las ventas.');
        }
        __cache = Array.isArray(data.providers) ? data.providers : [];
        if (data.stats_rev != null) {
            __lastStatsRev = String(data.stats_rev);
        }
        return __cache;
    }

    function closeAdminMenu2() {
        var mobileMenu2 = document.getElementById('mobileMenu2');
        var menuOverlay = document.getElementById('menuOverlay');
        if (mobileMenu2) mobileMenu2.classList.add('hidden');
        if (menuOverlay) menuOverlay.classList.remove('active');
    }

    function openModal(openerEl) {
        var modal = document.getElementById('adminLicProveedorVentasModal');
        if (!modal) {
            window.location.href = '/tienda/admin?open=proveedores-ventas';
            return;
        }
        if (openerEl && typeof openerEl.focus === 'function') {
            __modalOpener = openerEl;
        } else {
            var menuBtn = document.getElementById('btnAdminProveedorVentas');
            __modalOpener =
                document.activeElement && document.activeElement !== document.body
                    ? document.activeElement
                    : menuBtn || null;
        }
        closeAdminMenu2();
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        var meta = document.getElementById('adminLicProveedorVentasMeta');
        if (meta) meta.textContent = 'Cargando…';
        load(true)
            .then(function () {
                syncProviderSelect();
                renderList();
                ensureDayDateDefault();
                loadDayReview();
                startRealtime();
            })
            .catch(function (err) {
                if (meta) {
                    meta.textContent = err && err.message ? err.message : 'Error al cargar.';
                }
                logError('adminLicProveedorVentasLoad:', err);
            });
    }

    function closeModal() {
        var modal = document.getElementById('adminLicProveedorVentasModal');
        if (!modal || modal.hidden) return;
        stopRealtime();
        closeInfoModal();
        var opener = __modalOpener;
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
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
        __modalOpener = null;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    function openInfoModal(openerEl) {
        var modal = document.getElementById('adminLicProveedorVentasInfoModal');
        if (!modal) return;
        __infoOpener = openerEl || null;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        var okBtn = document.getElementById('adminLicProveedorVentasInfoOkBtn');
        if (okBtn) {
            try {
                okBtn.focus({ preventScroll: true });
            } catch (e1) {
                try {
                    okBtn.focus();
                } catch (e2) {}
            }
        }
    }

    function closeInfoModal() {
        var modal = document.getElementById('adminLicProveedorVentasInfoModal');
        if (!modal || modal.hidden) return;
        var opener = __infoOpener;
        if (opener && typeof opener.focus === 'function') {
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
        __infoOpener = null;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    async function resetCount(userId, licenseId, serviceName, resetBtn) {
        var label = serviceName || 'este servicio';
        var ok = window.confirm(
            '¿Resetear a 0 el contador de ventas de «' + label + '»?\n\nEsta acción no se puede deshacer.'
        );
        if (!ok) return;
        if (resetBtn) resetBtn.disabled = true;
        try {
            var res = await fetch(resetApiUrl(), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ user_id: userId, license_id: licenseId }),
            });
            var data = await res.json().catch(function () {
                return { success: false };
            });
            if (!res.ok || !data || !data.success) {
                throw new Error((data && (data.error || data.message)) || 'No se pudo resetear.');
            }
            if (__cache) {
                var provider = __cache.find(function (p) {
                    return String(p.user_id) === String(userId);
                });
                if (provider && Array.isArray(data.services)) {
                    provider.services = data.services;
                }
            }
            renderList();
        } catch (err) {
            window.alert(err && err.message ? err.message : 'Error al resetear.');
            logError('adminLicProveedorVentasReset:', err);
        } finally {
            if (resetBtn) resetBtn.disabled = false;
        }
    }

    function setupUi() {
        if (document.documentElement.dataset.adminLicProveedorVentasUi === '1') return;
        document.documentElement.dataset.adminLicProveedorVentasUi = '1';

        document.addEventListener(
            'click',
            function (e) {
                var infoBtn = e.target.closest && e.target.closest('.admin-lic-proveedor-ventas-info-btn');
                if (infoBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    openInfoModal(infoBtn);
                    return;
                }
                if (e.target.closest && e.target.closest('[data-admin-lic-proveedor-ventas-info-dismiss]')) {
                    e.preventDefault();
                    closeInfoModal();
                    return;
                }
                if (e.target.closest && e.target.closest('[data-admin-lic-proveedor-ventas-dismiss]')) {
                    e.preventDefault();
                    closeModal();
                    return;
                }
                var resetBtn = e.target.closest && e.target.closest('.admin-lic-proveedor-ventas-reset-btn');
                if (resetBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    var uid = resetBtn.getAttribute('data-proveedor-user-id');
                    var lid = resetBtn.getAttribute('data-proveedor-license-id');
                    var sname = resetBtn.getAttribute('data-proveedor-service-name') || '';
                    if (!uid || !lid) return;
                    void resetCount(uid, lid, sname, resetBtn);
                }
            },
            false
        );

        document.addEventListener(
            'change',
            function (e) {
                if (e.target && e.target.id === 'adminLicProveedorVentasProviderSelect') {
                    __activeUserId = e.target.value;
                    renderList();
                    loadDayReview();
                }
                if (e.target && e.target.id === 'adminLicProveedorVentasDayDate') {
                    loadDayReview();
                }
            },
            false
        );

        document.addEventListener(
            'input',
            function (e) {
                if (e.target && e.target.id === 'adminLicProveedorVentasSearch') {
                    renderList();
                }
            },
            false
        );

        var btn = document.getElementById('btnAdminProveedorVentas');
        if (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                openModal(btn);
            });
        }
    }

    window.adminLicProveedorVentasOpenModal = openModal;
    window.adminLicProveedorVentasCloseModal = closeModal;
    window.adminLicCloseAdminMenu2 = closeAdminMenu2;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupUi);
    } else {
        setupUi();
    }
})();
