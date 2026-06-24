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
            var item = document.createElement('div');
            item.className = 'admin-lic-proveedor-ventas-item';
            item.setAttribute('role', 'listitem');
            item.setAttribute('data-proveedor-license-id', String(svc.license_id));
            item.innerHTML =
                '<span class="admin-lic-proveedor-ventas-item__name">' +
                escHtml(svc.name || '—') +
                '</span>' +
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
        if (meta) {
            meta.textContent =
                filtered.length +
                (filtered.length === 1 ? ' servicio' : ' servicios') +
                ' · ' +
                totalSold +
                (totalSold === 1 ? ' vendida' : ' vendidas');
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
            return;
        }
        if (controls) controls.hidden = false;
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
