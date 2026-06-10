/**
 * Actualiza el texto «Saldo $… COP/USD» del pie del menú cuando cambia una recarga (SSE).
 */
(function () {
    var STREAM_URL = '/tienda/api/user/balance-recharges/events';
    var menuRealtimeConn = null;

    function refreshStoreMenuSaldo() {
        var el = document.querySelector('.mobile-menu-store-saldo-line');
        if (!el) {
            return;
        }
        var footer = el.closest('.mobile-menu-store-saldo-footer');
        var req = window.StoreFetchJson && window.StoreFetchJson.fetch
            ? window.StoreFetchJson.fetch('/tienda/api/user/store-menu-balance')
            : fetch('/tienda/api/user/store-menu-balance', {
                  method: 'GET',
                  credentials: 'same-origin',
                  headers: { Accept: 'application/json' },
              }).then(function (r) {
                  if (!r.ok) throw new Error('HTTP ' + r.status);
                  return r.json();
              });
        req.then(function (data) {
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

    function connectMenuStream() {
        if (menuRealtimeConn || !window.BalanceRechargeRealtime) return;
        menuRealtimeConn = window.BalanceRechargeRealtime.connect(STREAM_URL, refreshStoreMenuSaldo);
    }

    function disconnectMenuStream() {
        if (!menuRealtimeConn) return;
        menuRealtimeConn.close();
        menuRealtimeConn = null;
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.querySelector('.mobile-menu-store-saldo-line')) {
            return;
        }
        refreshStoreMenuSaldo();
        connectMenuStream();
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                connectMenuStream();
                refreshStoreMenuSaldo();
            } else {
                disconnectMenuStream();
            }
        });
        window.addEventListener('focus', refreshStoreMenuSaldo);
    });
})();
