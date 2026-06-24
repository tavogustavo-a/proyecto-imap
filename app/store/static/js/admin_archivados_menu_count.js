/**
 * Actualiza el contador «Archivados (N)» del Menú2 admin sin recargar la página.
 * SSE con fallback a sondeo ligero.
 */
(function () {
    var countMeta = document.querySelector('meta[name="archived-licenses-count-url"]');
    var listMeta = document.querySelector('meta[name="archived-licenses-list-url"]');
    var COUNT_URL = (countMeta && countMeta.getAttribute('content')) || '/tienda/api/licenses/archived/count';
    var LIST_URL = (listMeta && listMeta.getAttribute('content')) || '/tienda/api/licenses/archived';
    var ARCHIVED_SSE_URL = '/tienda/api/admin/licenses/stream?archived=1';
    var ARCHIVED_REV_URL = '/tienda/api/admin/licenses/rev?archived=1';
    var ARCHIVED_POLL_MS = 30000;

    var archivedSseHandle = null;
    var archivedPollTimer = null;
    var archivedLastRev = null;

    function updateArchivedMenuCount(count) {
        var el = document.getElementById('archivadosCount');
        if (!el) {
            return;
        }
        var n = parseInt(count, 10);
        if (isNaN(n) || n < 0) {
            n = 0;
        }
        var text = '(' + n + ')';
        if (el.textContent !== text) {
            el.textContent = text;
        }
    }

    window.updateArchivedMenuCount = updateArchivedMenuCount;

    function fetchArchivedCountFromList() {
        return fetch(LIST_URL, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then(function (r) {
                if (!r.ok) {
                    return null;
                }
                return r.json();
            })
            .then(function (data) {
                if (data && data.success && Array.isArray(data.licenses)) {
                    updateArchivedMenuCount(data.licenses.length);
                }
            })
            .catch(function () {});
    }

    function refreshArchivedMenuCount() {
        if (!document.getElementById('archivadosCount')) {
            return;
        }
        fetch(COUNT_URL, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then(function (r) {
                if (r.status === 404) {
                    return fetchArchivedCountFromList();
                }
                if (!r.ok) {
                    return null;
                }
                return r.json();
            })
            .then(function (data) {
                if (data && data.success && typeof data.count !== 'undefined') {
                    updateArchivedMenuCount(data.count);
                }
            })
            .catch(function () {
                fetchArchivedCountFromList();
            });
    }

    function onArchivedLicensesSse(data) {
        if (!data || data.type !== 'licenses_rev' || data.licenses_rev == null) return;
        var nextRev = String(data.licenses_rev);
        if (archivedLastRev === null) {
            archivedLastRev = nextRev;
            refreshArchivedMenuCount();
            return;
        }
        if (nextRev === archivedLastRev) return;
        archivedLastRev = nextRev;
        refreshArchivedMenuCount();
    }

    function pollArchivedLicensesRev() {
        if (document.visibilityState !== 'visible') return;
        fetch(ARCHIVED_REV_URL + '&_t=' + Date.now(), {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        })
            .then(function (r) {
                return r.ok ? r.json() : null;
            })
            .then(function (data) {
                if (!data || !data.success || data.licenses_rev == null) return;
                onArchivedLicensesSse({ type: 'licenses_rev', licenses_rev: data.licenses_rev });
            })
            .catch(function () {});
    }

    function stopArchivedRealtime() {
        if (archivedSseHandle) {
            archivedSseHandle.close();
            archivedSseHandle = null;
        }
        if (archivedPollTimer) {
            window.clearInterval(archivedPollTimer);
            archivedPollTimer = null;
        }
    }

    function startArchivedPollFallback() {
        if (archivedPollTimer) return;
        pollArchivedLicensesRev();
        archivedPollTimer = window.setInterval(pollArchivedLicensesRev, ARCHIVED_POLL_MS);
    }

    function startArchivedRealtime() {
        if (!document.getElementById('archivadosCount')) return;
        if (document.visibilityState !== 'visible') {
            stopArchivedRealtime();
            return;
        }
        stopArchivedRealtime();
        if (typeof window.StoreSseRealtime !== 'undefined' && typeof window.StoreSseRealtime.connectOrFallback === 'function') {
            archivedSseHandle = window.StoreSseRealtime.connectOrFallback(
                ARCHIVED_SSE_URL,
                onArchivedLicensesSse,
                startArchivedPollFallback
            );
        } else {
            startArchivedPollFallback();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.getElementById('archivadosCount')) {
            return;
        }
        refreshArchivedMenuCount();
        startArchivedRealtime();
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                refreshArchivedMenuCount();
                startArchivedRealtime();
            } else {
                stopArchivedRealtime();
            }
        });
    });
})();
