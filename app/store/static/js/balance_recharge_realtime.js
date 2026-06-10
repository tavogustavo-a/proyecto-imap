/**
 * SSE para recargas de saldo: el servidor empuja solo cuando hay cambios (sin polling).
 * Una sola conexión EventSource por URL (varios listeners comparten el stream).
 * En error cierra el stream y reconecta con backoff (evita ERR_CONNECTION_RESET en bucle).
 */
(function (global) {
  'use strict';

  var pools = Object.create(null);
  var MIN_RECONNECT_MS = 3000;
  var MAX_RECONNECT_MS = 60000;

  function dispatchUpdate(data) {
    if (!data || data.type === 'connected') return;
    try {
      global.dispatchEvent(
        new global.CustomEvent('balance-recharge-realtime', { detail: data })
      );
    } catch (_e) {}
  }

  function nextBackoffMs(pool) {
    var attempt = Math.max(0, pool.reconnectAttempt || 0);
    var delay = Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * Math.pow(2, attempt));
    return delay;
  }

  function clearReconnectTimer(pool) {
    if (!pool || !pool.reconnectTimer) return;
    try {
      global.clearTimeout(pool.reconnectTimer);
    } catch (_t) {}
    pool.reconnectTimer = null;
  }

  function openStream(url, pool, opts) {
    if (!url || typeof global.EventSource === 'undefined') return;
    clearReconnectTimer(pool);
    if (pool.es) {
      try {
        pool.es.close();
      } catch (_c) {}
      pool.es = null;
    }

    var es = new global.EventSource(url, { withCredentials: true });
    pool.es = es;
    pool.closed = false;

    es.onopen = function () {
      pool.reconnectAttempt = 0;
    };

    es.onmessage = function (ev) {
      if (!ev || !ev.data) return;
      try {
        var data = JSON.parse(ev.data);
        if (!data || data.type === 'connected') return;
        pool.reconnectAttempt = 0;
        dispatchUpdate(data);
        pool.listeners.slice().forEach(function (fn) {
          try {
            fn(data);
          } catch (_cb) {}
        });
      } catch (_parse) {}
    };

    es.onerror = function () {
      if (pool.closed || pool.closing) return;
      try {
        es.close();
      } catch (_close) {}
      pool.es = null;
      if (typeof opts.onError === 'function') {
        try {
          opts.onError(pool);
        } catch (_errCb) {}
      }
      if (pool.closed || pool.listeners.length === 0) return;
      pool.reconnectAttempt = (pool.reconnectAttempt || 0) + 1;
      var delay = nextBackoffMs(pool);
      clearReconnectTimer(pool);
      pool.reconnectTimer = global.setTimeout(function () {
        if (pool.closed || pool.listeners.length === 0) return;
        openStream(url, pool, opts);
      }, delay);
    };
  }

  function connect(url, onUpdate, opts) {
    opts = opts || {};
    if (!url || typeof global.EventSource === 'undefined') {
      return null;
    }

    var pool = pools[url];
    if (!pool) {
      pool = {
        es: null,
        listeners: [],
        closed: false,
        closing: false,
        reconnectAttempt: 0,
        reconnectTimer: null,
      };
      pools[url] = pool;
      openStream(url, pool, opts);
    } else if (!pool.es && !pool.reconnectTimer && !pool.closed) {
      openStream(url, pool, opts);
    }

    if (typeof onUpdate === 'function' && pool.listeners.indexOf(onUpdate) < 0) {
      pool.listeners.push(onUpdate);
    }

    var handle = {
      close: function () {
        if (!pool || pool.closing) return;
        if (typeof onUpdate === 'function') {
          var idx = pool.listeners.indexOf(onUpdate);
          if (idx >= 0) pool.listeners.splice(idx, 1);
        }
        if (pool.listeners.length > 0) return;
        pool.closing = true;
        pool.closed = true;
        clearReconnectTimer(pool);
        if (pool.es) {
          try {
            pool.es.close();
          } catch (_c) {}
          pool.es = null;
        }
        delete pools[url];
      },
    };

    return handle;
  }

  global.BalanceRechargeRealtime = {
    connect: connect,
  };
})(window);
