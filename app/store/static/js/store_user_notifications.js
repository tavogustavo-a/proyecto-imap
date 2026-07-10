/**
 * Avisos in-app (y navegador si hay permiso) en cualquier página de la tienda del usuario.
 * Renovaciones «tu cuenta», reservas, etc.
 */
(function (global) {
  'use strict';

  if (global.StoreUserNotifications && global.StoreUserNotifications._booted) {
    return;
  }

  var SSE_URL = '/tienda/api/user/store-notifications/stream';
  var POLL_MS = 15000;
  var seenIds = Object.create(null);
  var sseHandle = null;
  var pollInterval = null;
  var started = false;

  var RENEWAL_KINDS = {
    customer_account_renewal_batch: true,
    customer_account_renewal_completed: true,
    customer_account_renewal_rejected: true,
    customer_account_renewal_received: true,
  };

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function dedupeCredDisplayLine(line) {
    var s = String(line || '').trim();
    if (!s) return '';
    var parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts.every(function (p) { return p === parts[0]; })) {
      return parts[0];
    }
    var seen = Object.create(null);
    var unique = [];
    parts.forEach(function (p) {
      var k = p.replace(/\s+/g, '').toLowerCase();
      if (!k || seen[k]) return;
      seen[k] = true;
      unique.push(p);
    });
    if (unique.length === 1) return unique[0];
    return s;
  }

  function normLineKey(line) {
    return String(line || '')
      .replace(/\r/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function isRenewalKind(kind) {
    return !!RENEWAL_KINDS[String(kind || '')];
  }

  function buildNotifDisplay(notif) {
    var payload = notif && notif.payload && typeof notif.payload === 'object' ? notif.payload : {};
    var kind = String((notif && notif.kind) || '');
    var title = String((notif && notif.title) || 'Aviso de la tienda');
    var bodyText = String((notif && notif.body) || '').trim();
    var creds = Array.isArray(payload.credentials) ? payload.credentials.slice() : [];
    if (!creds.length && payload.credential) creds.push(String(payload.credential));

    if (isRenewalKind(kind)) {
      if (!bodyText && Array.isArray(payload.items) && payload.items.length) {
        bodyText = payload.items
          .map(function (it) {
            var em = String((it && it.account_email) || '—');
            var pn = String((it && it.product_name) || 'Producto');
            return em + ' — ' + pn;
          })
          .join('\n');
      }
      return { title: title, body: bodyText, renewal: true };
    }

    if (kind === 'product_reservation_next_day_result' || kind === 'product_reservation_fulfilled') {
      var pname = String(payload.product_name || '').trim();
      var ful = parseInt(payload.fulfilled, 10);
      var req = parseInt(payload.requested, 10);
      if (!Number.isFinite(ful)) ful = creds.length || 1;
      if (!Number.isFinite(req)) req = ful;

      if (creds.length) {
        var seen = Object.create(null);
        var uniqueCreds = [];
        creds.forEach(function (c) {
          var s = dedupeCredDisplayLine(String(c || '').trim());
          var k = normLineKey(s);
          if (!k || seen[k]) return;
          seen[k] = true;
          uniqueCreds.push(s);
        });
        var summary = pname ? '«' + pname + '»: ' + ful + ' cuenta(s) lista(s).' : '';
        bodyText =
          uniqueCreds.length === 1 && summary
            ? summary + '\n' + uniqueCreds[0]
            : [summary].concat(uniqueCreds).filter(Boolean).join('\n');
      } else if (bodyText) {
        var lines = bodyText.split(/\r?\n+/).map(function (l) {
          return l.replace(/\r/g, '').trim();
        }).filter(Boolean);
        var seenLines = Object.create(null);
        var uniqueLines = [];
        lines.forEach(function (line) {
          if (/^cuentas:?$/i.test(line)) return;
          var cleaned = dedupeCredDisplayLine(line);
          var lk = normLineKey(cleaned);
          if (!lk || seenLines[lk]) return;
          seenLines[lk] = true;
          uniqueLines.push(cleaned);
        });
        bodyText = uniqueLines.join('\n');
      }

      if (pname) {
        if (kind === 'product_reservation_next_day_result') {
          title =
            ful >= req
              ? 'Compra programada lista: ' + pname
              : 'Compra programada parcial: ' + pname;
        } else {
          title = ful >= req ? 'Reserva completada: ' + pname : 'Reserva parcial: ' + pname;
        }
      }
    }

    if (bodyText.length > 220) bodyText = bodyText.slice(0, 217) + '…';
    return { title: title, body: bodyText, renewal: false };
  }

  function acknowledge(notifId) {
    if (notifId == null) return;
    try {
      sessionStorage.setItem('storeNotifAck:' + String(notifId), '1');
    } catch (e) {}
    fetch('/tienda/api/user/store-notifications/' + encodeURIComponent(String(notifId)) + '/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-CSRFToken': csrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
    }).catch(function () {});
  }

  function wasAcknowledged(notifId) {
    try {
      return sessionStorage.getItem('storeNotifAck:' + String(notifId)) === '1';
    } catch (e) {
      return false;
    }
  }

  function dispatchReceived(notifications) {
    try {
      global.dispatchEvent(
        new CustomEvent('store-user-notifications-received', {
          detail: { notifications: notifications || [] },
        })
      );
    } catch (e) {}
  }

  function tryBrowserNotification(notif, display) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    var title = display.title || 'Aviso de la tienda';
    var body = display.body || '';
    var tag = 'store-user-notif-' + String(notif.id != null ? notif.id : Date.now());
    try {
      var n = new Notification(title, {
        body: body,
        tag: tag,
        icon: '/static/images/favicon.svg',
      });
      if (n && typeof n.close === 'function') {
        global.setTimeout(function () {
          try {
            n.close();
          } catch (e2) {}
        }, 14000);
      }
    } catch (e) {}
  }

  function maybePromptBrowserPermissionForRenewals() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    try {
      if (sessionStorage.getItem('storeRenewalBrowserPermAsked')) return;
      sessionStorage.setItem('storeRenewalBrowserPermAsked', '1');
    } catch (e) {
      return;
    }
    var isMobile =
      global.matchMedia && global.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;
    try {
      var ret = Notification.requestPermission();
      if (ret && typeof ret.catch === 'function') ret.catch(function () {});
    } catch (e) {}
  }

  function showNotification(notif) {
    if (!notif || notif.id == null) return;
    var kind = String(notif.kind || '');
    if (kind === 'product_reservation_next_day_result') {
      acknowledge(notif.id);
      return;
    }
    if (seenIds[notif.id] || wasAcknowledged(notif.id)) return;

    var payload = notif.payload && typeof notif.payload === 'object' ? notif.payload : null;
    var resId = payload && payload.reservation_id != null ? payload.reservation_id : null;
    if (resId != null) {
      var resKey = 'res-' + String(resId) + '-' + String(kind || 'fulfilled');
      if (seenIds[resKey]) return;
      seenIds[resKey] = true;
    }
    seenIds[notif.id] = true;

    var display = buildNotifDisplay(notif);
    var isMobile = global.matchMedia && global.matchMedia('(max-width: 768px)').matches;
    var node = document.createElement('div');
    node.className =
      'in-page-notification push-notification store-reservation-notify ' +
      (display.renewal ? 'store-renewal-notify ' : '') +
      (isMobile ? 'push-notification-mobile' : 'push-notification-desktop');

    var bodyText = display.body;
    node.innerHTML =
      '<div class="push-notification-title">' +
      (display.title || 'Aviso de la tienda') +
      '</div>' +
      '<div class="push-notification-body">' +
      String(bodyText || '').replace(/\n/g, '<br>') +
      '</div>' +
      (isMobile ? '<div class="push-notification-hint">Toca para cerrar</div>' : '');

    node.addEventListener('click', function () {
      node.classList.add('push-notification-closing');
      global.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 280);
      acknowledge(notif.id);
    });

    document.body.appendChild(node);
    acknowledge(notif.id);

    if (display.renewal) {
      maybePromptBrowserPermissionForRenewals();
    }
    tryBrowserNotification(notif, display);

    global.setTimeout(function () {
      if (!node.parentNode) return;
      node.classList.add('push-notification-closing');
      global.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 280);
    }, 12000);
  }

  function handleNotifications(list) {
    if (!Array.isArray(list) || !list.length) return;
    list.slice().reverse().forEach(showNotification);
    dispatchReceived(list);
  }

  function poll() {
    return fetch('/tienda/api/user/store-notifications', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { success: false };
        });
      })
      .then(function (data) {
        if (!data || !data.success || !Array.isArray(data.notifications)) return;
        handleNotifications(data.notifications);
      })
      .catch(function () {});
  }

  function onSseMessage(data) {
    if (!data || data.type !== 'notifications' || !data.success) return;
    if (Array.isArray(data.notifications)) {
      handleNotifications(data.notifications);
    }
  }

  function stop() {
    if (sseHandle) {
      sseHandle.close();
      sseHandle = null;
    }
    if (pollInterval) {
      global.clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function startPollFallback() {
    if (pollInterval) return;
    void poll();
    pollInterval = global.setInterval(poll, POLL_MS);
  }

  function syncNativePushToken() {
    try {
      if (!global.AndroidAppBridge || typeof global.AndroidAppBridge.getPushToken !== 'function') {
        return;
      }
      var token = String(global.AndroidAppBridge.getPushToken() || '').trim();
      if (!token) return;
      var last = '';
      try {
        last = localStorage.getItem('mobile_fcm_token_synced') || '';
      } catch (e) {}
      if (last === token) return;

      var headers = { 'Content-Type': 'application/json' };
      var csrf = csrfToken();
      if (csrf) headers['X-CSRFToken'] = csrf;

      fetch('/tienda/api/mobile/push-token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: JSON.stringify({
          token: token,
          platform: 'android',
          device_label: navigator.userAgent || '',
        }),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          if (data && data.success) {
            try {
              localStorage.setItem('mobile_fcm_token_synced', token);
            } catch (e) {}
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function start() {
    if (started && document.visibilityState !== 'visible') {
      stop();
      return;
    }
    if (document.visibilityState !== 'visible') {
      stop();
      return;
    }
    stop();
    started = true;
    syncNativePushToken();
    setTimeout(syncNativePushToken, 3500);
    if (
      typeof global.StoreSseRealtime !== 'undefined' &&
      typeof global.StoreSseRealtime.connectOrFallback === 'function'
    ) {
      sseHandle = global.StoreSseRealtime.connectOrFallback(
        SSE_URL,
        onSseMessage,
        startPollFallback
      );
    } else {
      startPollFallback();
    }
  }

  function boot() {
    start();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.StoreUserNotifications = {
    _booted: true,
    start: start,
    stop: stop,
    poll: poll,
    show: showNotification,
    requestBrowserPermission: function () {
      if (typeof Notification === 'undefined') {
        return Promise.resolve('unsupported');
      }
      try {
        return Notification.requestPermission();
      } catch (e) {
        return Promise.resolve('denied');
      }
    },
  };
})(window);
