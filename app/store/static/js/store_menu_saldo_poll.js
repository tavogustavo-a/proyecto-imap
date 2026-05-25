/**
 * Actualiza el texto «Saldo $… COP/USD» del pie del menú sin recargar (p. ej. tras abonar desde admin).
 */
(function () {
    var POLL_MS = 10000;
    var URL = '/tienda/api/user/store-menu-balance';

    function refreshStoreMenuSaldo() {
        var el = document.querySelector('.mobile-menu-store-saldo-line');
        if (!el) {
            return;
        }
        var footer = el.closest('.mobile-menu-store-saldo-footer');
        fetch(URL, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(function (r) {
                return r.json();
            })
            .then(function (data) {
                if (!data || !data.show) {
                    if (footer) {
                        footer.hidden = true;
                    }
                    return;
                }
                if (footer) {
                    footer.hidden = false;
                }
                if (data.line && el.textContent !== data.line) {
                    el.textContent = data.line;
                }
                try {
                    window.dispatchEvent(
                        new CustomEvent('store-menu-balance-updated', { detail: data })
                    );
                } catch (_ev) {}
            })
            .catch(function () {});
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.querySelector('.mobile-menu-store-saldo-line')) {
            return;
        }
        refreshStoreMenuSaldo();
        window.setInterval(function () {
            if (document.visibilityState === 'visible') {
                refreshStoreMenuSaldo();
            }
        }, POLL_MS);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                refreshStoreMenuSaldo();
            }
        });
        window.addEventListener('focus', refreshStoreMenuSaldo);
    });
})();
