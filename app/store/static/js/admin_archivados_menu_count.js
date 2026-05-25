/**
 * Actualiza el contador «Archivados (N)» del Menú2 admin sin recargar la página.
 */
(function () {
    var countMeta = document.querySelector('meta[name="archived-licenses-count-url"]');
    var listMeta = document.querySelector('meta[name="archived-licenses-list-url"]');
    var COUNT_URL = (countMeta && countMeta.getAttribute('content')) || '/tienda/api/licenses/archived/count';
    var LIST_URL = (listMeta && listMeta.getAttribute('content')) || '/tienda/api/licenses/archived';
    var POLL_MS = 30000;

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
            headers: { Accept: 'application/json' }
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
            headers: { Accept: 'application/json' }
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

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.getElementById('archivadosCount')) {
            return;
        }
        refreshArchivedMenuCount();
        window.setInterval(function () {
            if (document.visibilityState === 'visible') {
                refreshArchivedMenuCount();
            }
        }, POLL_MS);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                refreshArchivedMenuCount();
            }
        });
    });
})();
