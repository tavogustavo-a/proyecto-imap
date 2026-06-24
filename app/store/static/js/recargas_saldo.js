(function () {
  'use strict';

  var BINANCE_PAY_FALLBACK_POLL_MS = 12000;
  var BINANCE_PAY_POLL_MAX_MS = 15 * 60 * 1000;
  var rechargeRealtimeConn = null;
  var userRechargeItems = [];
  var userListMeta = { offset: 0, limit: 50, has_more: false, filter_total: 0, shown_count: 0 };
  var userListLoadingMore = false;
  var binancePayPollTimer = null;
  var binancePayActiveTradeNo = '';
  var binancePayPollMeta = null;
  var binancePayPollStartedAt = 0;
  var binancePayRealtimeWired = false;

  function rechargeFetchJson(url, options) {
    if (window.StoreFetchJson && window.StoreFetchJson.fetch) {
      return window.StoreFetchJson.fetch(url, options);
    }
    options = options || {};
    return fetch(url, {
      method: options.method || 'GET',
      credentials: options.credentials != null ? options.credentials : 'same-origin',
      headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
      body: options.body,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error((data && (data.message || data.error)) || 'Error HTTP ' + r.status);
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function applyRechargeSaldoDisplay(data) {
    var el = document.getElementById('balanceRechargeSaldoLine');
    if (el) {
      if (!data || !data.show || !data.line) {
        el.hidden = true;
      } else {
        el.textContent = data.line;
        el.hidden = false;
      }
    }
    var accumEl = document.getElementById('balanceRechargeAccumLine');
    if (accumEl) {
      if (!data || !data.accum_show || !data.accum_line) {
        accumEl.hidden = true;
        accumEl.textContent = '';
      } else {
        accumEl.textContent = data.accum_line;
        accumEl.hidden = false;
      }
    }
    if (!data || !data.show || !data.line) {
      return;
    }
    var menuLine = document.querySelector('.mobile-menu-store-saldo-line');
    if (menuLine) {
      menuLine.textContent = data.line;
    }
    var menuFooter = document.querySelector('.mobile-menu-store-saldo-footer');
    if (menuFooter) {
      menuFooter.hidden = false;
    }
  }

  function refreshRechargeSaldoDisplay() {
    var form = document.getElementById('balanceRechargeForm');
    var url = form ? form.getAttribute('data-saldo-url') || '' : '';
    if (!url) return Promise.resolve();
    return rechargeFetchJson(url)
      .then(function (data) {
        applyRechargeSaldoDisplay(data);
        try {
          window.dispatchEvent(new CustomEvent('store-menu-balance-updated', { detail: data }));
        } catch (_ev) {}
        return data;
      })
      .catch(function () {});
  }

  function bindRechargeRealtime(meta) {
    meta = meta || {};
    refreshRechargeSaldoDisplay();
    var streamUrl =
      meta.eventsUrl ||
      '/tienda/api/user/balance-recharges/events';

    function onRealtimeUpdate(eventData) {
      refreshRechargeSaldoDisplay();
      if (binancePayActiveTradeNo && binancePayPollMeta) {
        checkBinancePayStatusOnce(binancePayPollMeta, binancePayActiveTradeNo);
      }
      patchUserRechargeFromRealtime(eventData, meta).catch(function () {
        if (document.getElementById('balanceRechargeList')) {
          loadList(meta);
        }
      });
    }

    function connectStream() {
      if (rechargeRealtimeConn || !window.BalanceRechargeRealtime) return;
      rechargeRealtimeConn = window.BalanceRechargeRealtime.connect(streamUrl, onRealtimeUpdate);
    }

    function disconnectStream() {
      if (!rechargeRealtimeConn) return;
      rechargeRealtimeConn.close();
      rechargeRealtimeConn = null;
    }

    connectStream();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        connectStream();
        refreshRechargeSaldoDisplay();
        if (document.getElementById('balanceRechargeList')) {
          loadList(meta);
        }
      } else {
        disconnectStream();
      }
    });
  }

  function readMeta() {
    var form = document.getElementById('balanceRechargeForm');
    var currencyEl = document.getElementById('balanceRechargeCurrency');
    var list = document.getElementById('balanceRechargeList');
    return {
      currency: currencyEl ? currencyEl.value : 'COP',
      submitUrl: form ? form.getAttribute('data-submit-url') || form.getAttribute('action') || '' : '',
      listUrl: form ? form.getAttribute('data-list-url') || (list ? list.getAttribute('data-list-url') : '') || '' : '',
      methodsUrl: form ? form.getAttribute('data-methods-url') || '' : '',
      binancePayOrderUrl: form ? form.getAttribute('data-binance-pay-order-url') || '' : '',
      binancePayStatusUrlTemplate: form
        ? form.getAttribute('data-binance-pay-status-url') || ''
        : '',
      eventsUrl:
        (list ? list.getAttribute('data-events-url') : '') ||
        '/tienda/api/user/balance-recharges/events',
    };
  }

  function binancePayStatusUrl(template, tradeNo) {
    return String(template || '').replace('__TRADE__', encodeURIComponent(tradeNo || ''));
  }

  function selectedPaymentMethodOption() {
    var checked = document.querySelector('input[name="payment_method_id"]:checked');
    return checked ? checked.closest('.balance-recharge-method-option') : null;
  }

  function isBinancePaySelected() {
    var label = selectedPaymentMethodOption();
    return !!(label && label.getAttribute('data-is-binance-pay') === '1');
  }

  function stopBinancePayPolling() {
    if (binancePayPollTimer) {
      window.clearInterval(binancePayPollTimer);
      binancePayPollTimer = null;
    }
    binancePayActiveTradeNo = '';
    binancePayPollMeta = null;
  }

  function setBinancePayStatus(text, isError) {
    var el = document.getElementById('balanceRechargeBinancePayStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className =
      'balance-recharge-binance-pay-status' +
      (isError ? ' balance-recharge-binance-pay-status--error' : '');
  }

  function resetBinancePayCheckout() {
    stopBinancePayPolling();
    var checkout = document.getElementById('balanceRechargeBinancePayCheckout');
    var qrWrap = document.getElementById('balanceRechargeBinancePayQrWrap');
    var qrImg = document.getElementById('balanceRechargeBinancePayQr');
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (checkout) checkout.hidden = true;
    if (qrWrap) qrWrap.hidden = true;
    if (qrImg) qrImg.removeAttribute('src');
    if (submitBtn) submitBtn.hidden = false;
    setBinancePayStatus('', false);
  }

  function syncSubmitButtonUi() {
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (!submitBtn || submitBtn.getAttribute('aria-busy') === 'true') return;
    var isBp = isBinancePaySelected();
    var textEl = submitBtn.querySelector('.balance-recharge-submit-text');
    var iconEl = submitBtn.querySelector('.balance-recharge-submit-icon');
    var bpIconEl = submitBtn.querySelector('.balance-recharge-submit-bp-icon');
    if (textEl) {
      textEl.textContent = isBp ? 'Pagar' : 'Enviar solicitud';
    }
    if (iconEl) {
      iconEl.className = 'balance-recharge-submit-icon fas fa-paper-plane';
    }
    if (bpIconEl) {
      bpIconEl.hidden = !isBp;
    }
    submitBtn.setAttribute(
      'aria-label',
      isBp ? 'Pagar con Binance Pay' : 'Enviar solicitud de recarga'
    );
  }

  function updateBinancePayUi() {
    var panel = document.getElementById('balanceRechargeBinancePayPanel');
    var proofGroup = document.getElementById('balanceRechargeProofGroup');
    var fileInput = document.getElementById('balanceRechargeProofs');
    var isBp = isBinancePaySelected();
    if (panel) panel.hidden = !isBp;
    if (proofGroup) proofGroup.hidden = isBp;
    if (fileInput) {
      if (isBp) {
        fileInput.removeAttribute('required');
        fileInput.value = '';
        renderPreview(null);
      } else {
        fileInput.setAttribute('required', 'required');
      }
    }
    if (isBp) {
      hideMethodQrBlock();
    }
    syncSubmitButtonUi();
    if (!isBp) {
      resetBinancePayCheckout();
    }
  }

  function showBinancePayCheckout(data) {
    var checkout = document.getElementById('balanceRechargeBinancePayCheckout');
    var qrWrap = document.getElementById('balanceRechargeBinancePayQrWrap');
    var qrImg = document.getElementById('balanceRechargeBinancePayQr');
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (checkout) checkout.hidden = false;
    if (submitBtn) submitBtn.hidden = true;
    var qr = String(data.qrcode_link || '').trim();
    var checkoutUrl = String(data.checkout_url || data.universal_url || data.deeplink || '').trim();
    if (qr && qrImg && qrWrap) {
      qrImg.src = qr;
      qrWrap.hidden = false;
    }
    if (checkoutUrl) {
      try {
        window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
      } catch (err) {
        window.location.href = checkoutUrl;
      }
      setBinancePayStatus(
        'Se abrió Binance Pay en otra pestaña. Si no se abrió, escanea el QR. Esperando confirmación…',
        false
      );
      return;
    }
    setBinancePayStatus('Esperando confirmación de pago en Binance…', false);
  }

  function checkBinancePayStatusOnce(meta, tradeNo) {
    if (!tradeNo) return Promise.resolve();
    var statusUrl = binancePayStatusUrl(meta.binancePayStatusUrlTemplate, tradeNo);
    if (!statusUrl || statusUrl.indexOf('__TRADE__') >= 0) return Promise.resolve();

    if (Date.now() - binancePayPollStartedAt > BINANCE_PAY_POLL_MAX_MS) {
      stopBinancePayPolling();
      setBinancePayStatus(
        'Tiempo de espera agotado. Si ya pagaste, el saldo se acreditará en breve; revisa la lista o espera unos segundos.',
        false
      );
      return Promise.resolve();
    }

    return rechargeFetchJson(statusUrl)
      .then(function (res) {
        if (!res || !res.success) return;
        if (res.paid) {
          stopBinancePayPolling();
          setBinancePayStatus('¡Pago confirmado! Saldo acreditado.', false);
          showFormMsg('Saldo acreditado por Binance Pay.', false);
          refreshRechargeSaldoDisplay();
          loadList(meta);
          var form = document.getElementById('balanceRechargeForm');
          if (form) form.reset();
          renderPreview(null);
          resetBinancePayCheckout();
          updateSelectedMethodQr();
          updateAmountFieldForMethod();
          return;
        }
        if ((res.status || '').toLowerCase() === 'rejected') {
          stopBinancePayPolling();
          setBinancePayStatus('El pago fue rechazado o cancelado.', true);
        }
      })
      .catch(function () {});
  }

  function wireBinancePayRealtimeOnce() {
    if (binancePayRealtimeWired) return;
    binancePayRealtimeWired = true;
    window.addEventListener('balance-recharge-realtime', function (ev) {
      if (!binancePayActiveTradeNo || !binancePayPollMeta) return;
      checkBinancePayStatusOnce(binancePayPollMeta, binancePayActiveTradeNo);
    });
  }

  function startBinancePayPolling(meta, tradeNo) {
    stopBinancePayPolling();
    wireBinancePayRealtimeOnce();
    if (!tradeNo) return;
    binancePayActiveTradeNo = tradeNo;
    binancePayPollMeta = meta;
    binancePayPollStartedAt = Date.now();
    var statusUrl = binancePayStatusUrl(meta.binancePayStatusUrlTemplate, tradeNo);
    if (!statusUrl || statusUrl.indexOf('__TRADE__') >= 0) return;

    checkBinancePayStatusOnce(meta, tradeNo);
    binancePayPollTimer = window.setInterval(function () {
      checkBinancePayStatusOnce(meta, tradeNo);
    }, BINANCE_PAY_FALLBACK_POLL_MS);
  }

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function fmtAmount(n, currency) {
    if (n == null || isNaN(n)) return '—';
    var x = Number(n);
    var s = Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(2);
    return '$' + s + ' ' + (currency || '');
  }

  var USER_FILTER_LABELS = {
    all: 'Todos',
    pending: 'Pendientes',
    accumulated: 'Acumulados',
    approved: 'Aprobados',
    rejected: 'Rechazados',
  };

  function updateUserFilterOptionLabels(counts) {
    var filterEl = document.getElementById('balanceRechargeListFilter');
    if (!filterEl) return;
    counts = counts || {};
    Object.keys(USER_FILTER_LABELS).forEach(function (key) {
      var opt = filterEl.querySelector('option[value="' + key + '"]');
      if (!opt) return;
      var n = Math.max(0, parseInt(counts[key], 10) || 0);
      opt.textContent = USER_FILTER_LABELS[key] + ' (' + n + ')';
    });
  }

  function userFilterCountsFromItems(items) {
    var tallies = { all: 0, pending: 0, accumulated: 0, approved: 0, rejected: 0 };
    (items || []).forEach(function (it) {
      tallies.all += 1;
      var st = (it.status || '').toLowerCase();
      if (st === 'pending' || isPendingVerification(it)) tallies.pending += 1;
      else if (st === 'accumulated') tallies.accumulated += 1;
      else if (st === 'approved') tallies.approved += 1;
      else if (st === 'rejected') tallies.rejected += 1;
    });
    return tallies;
  }

  function isPendingVerification(it) {
    var s = (it.status || '').toLowerCase();
    if (s === 'pending_binance_pay') return true;
    return (
      (s === 'auto_credited' || s === 'auto_accumulated') &&
      (it.admin_verified === null || it.admin_verified === undefined)
    );
  }

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'approved' || s === 'accum_converted') return 'balance-recharge-status--approved';
    if (s === 'rejected') return 'balance-recharge-status--rejected';
    if (s === 'auto_credited' || s === 'auto_accumulated') return 'balance-recharge-status--auto';
    if (s === 'accumulated') return 'balance-recharge-status--accumulated';
    if (s === 'pending_binance_pay') return 'balance-recharge-status--pending';
    return 'balance-recharge-status--pending';
  }

  function displayStatusClass(it) {
    if (isPendingVerification(it)) return 'balance-recharge-status--pending';
    return statusClass(it.status);
  }

  function displayStatusLabel(it) {
    if (isPendingVerification(it)) return 'Pendiente';
    return it.status_label || it.status || '';
  }

  function showFormMsg(text, isError, opts) {
    opts = opts || {};
    var box = document.getElementById('balanceRechargeFormMsg');
    if (!box) return;
    if (!text && !opts.titleOnly) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    var detail = String(text || '').trim();
    if (isError) {
      box.className = 'balance-recharge-form-msg balance-recharge-form-msg--error';
      var errTitle = opts.title || 'No se pudo completar la operación';
      var errBody =
        '<div class="balance-recharge-form-msg-inner">' +
        '<span class="balance-recharge-form-msg-icon" aria-hidden="true">' +
        '<i class="fas fa-circle-exclamation"></i></span>' +
        '<div class="balance-recharge-form-msg-body">' +
        '<strong class="balance-recharge-form-msg-title">' +
        escapeHtml(errTitle) +
        '</strong>';
      if (!opts.titleOnly && detail) {
        errBody +=
          '<p class="balance-recharge-form-msg-text">' + escapeHtml(detail) + '</p>';
      }
      errBody += '</div></div>';
      box.innerHTML = errBody;
      return;
    }
    box.className = 'balance-recharge-form-msg balance-recharge-form-msg--ok';
    box.innerHTML =
      '<div class="balance-recharge-form-msg-inner">' +
      '<span class="balance-recharge-form-msg-icon balance-recharge-form-msg-icon--ok" aria-hidden="true">' +
      '<i class="fas fa-circle-check"></i></span>' +
      '<div class="balance-recharge-form-msg-body">' +
      '<p class="balance-recharge-form-msg-text">' +
      escapeHtml(detail) +
      '</p>' +
      '</div></div>';
  }

  function setSubmitLoading(loading, opts) {
    opts = opts || {};
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (!submitBtn) return;
    var textEl = submitBtn.querySelector('.balance-recharge-submit-text');
    var iconEl = submitBtn.querySelector('.balance-recharge-submit-icon');
    var bpIconEl = submitBtn.querySelector('.balance-recharge-submit-bp-icon');
    if (loading) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      if (textEl) textEl.textContent = opts.label || 'Analizando…';
      if (iconEl) iconEl.className = 'balance-recharge-submit-icon fas fa-spinner fa-spin';
      if (bpIconEl) bpIconEl.hidden = true;
      if (opts.message) {
        showFormMsg(opts.message, false);
      } else if (!opts.silent) {
        showFormMsg(
          'Analizando el comprobante (puede tardar hasta 1 minuto). No cierres esta página.',
          false
        );
      }
      return;
    }
    submitBtn.disabled = false;
    submitBtn.removeAttribute('aria-busy');
    syncSubmitButtonUi();
  }

  function hasProofImageFile(files) {
    if (!files || !files.length) return false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f && f.type && f.type.indexOf('image/') === 0) return true;
    }
    return false;
  }

  function renderPreview(files) {
    var wrap = document.getElementById('balanceRechargePreview');
    var emptyHint = document.getElementById('balanceRechargeProofEmpty');
    if (!wrap) return;
    wrap.querySelectorAll('img[src^="blob:"]').forEach(function (img) {
      try {
        URL.revokeObjectURL(img.src);
      } catch (e) { /* ignore */ }
    });
    wrap.innerHTML = '';
    if (!hasProofImageFile(files)) {
      wrap.hidden = true;
      if (emptyHint) emptyHint.hidden = false;
      return;
    }
    if (emptyHint) emptyHint.hidden = true;
    wrap.hidden = false;
    Array.prototype.forEach.call(files, function (file) {
      if (!file.type || file.type.indexOf('image/') !== 0) return;
      var img = document.createElement('img');
      img.className = 'balance-recharge-preview-img';
      img.alt = file.name || 'Comprobante';
      img.title = 'Clic para ampliar';
      img.setAttribute('role', 'button');
      img.tabIndex = 0;
      img.src = URL.createObjectURL(file);
      wrap.appendChild(img);
    });
  }

  function userRechargeItemUrl(meta, rechargeId) {
    var base = (meta && meta.listUrl) || '';
    if (base.indexOf('balance-recharges') >= 0) {
      return base.replace(/\/?balance-recharges\/?$/, '/balance-recharge/' + rechargeId);
    }
    return '/tienda/api/user/balance-recharge/' + rechargeId;
  }

  function userItemMatchesFilter(it, filterValue) {
    var st = (it.status || '').toLowerCase();
    if (filterValue === 'all') return true;
    if (filterValue === 'pending') {
      return st === 'pending' || isPendingVerification(it);
    }
    if (filterValue === 'accumulated') {
      return st === 'accumulated' || st === 'auto_accumulated';
    }
    return st === filterValue;
  }

  function renderUserRechargeItem(it) {
    var thumbs = '';
    if (it.proof_urls && it.proof_urls.length) {
      thumbs =
        '<div class="balance-recharge-item-proofs">' +
        it.proof_urls
          .map(function (u, i) {
            var safe = escapeHtml(u);
            var label = it.proof_urls.length > 1 ? 'foto ' + (i + 1) : 'foto';
            return (
              '<button type="button" class="balance-recharge-proof-open balance-recharge-proof-link" data-proof-url="' +
              safe +
              '" title="Ver comprobante ampliado">' +
              escapeHtml(label) +
              '</button>'
            );
          })
          .join('') +
        '</div>';
    } else if (it.proof_missing) {
      thumbs =
        '<span class="balance-recharge-proof-missing-text" title="El comprobante ya no está disponible">Sin foto</span>';
    }
    var adminNote = it.admin_note
      ? '<p class="balance-recharge-item-admin-note"><strong>Nota del administrador:</strong> ' +
        escapeHtml(it.admin_note) +
        '</p>'
      : '';
    var userNote = it.note
      ? '<p class="balance-recharge-item-note">' + escapeHtml(it.note) + '</p>'
      : '';
    var pmInline = it.payment_method_label
      ? '<span class="balance-recharge-item-pm-inline">' + escapeHtml(it.payment_method_label) + '</span>'
      : '';
    var statusLabel = displayStatusLabel(it);
    var statusBadge = statusLabel
      ? '<span class="balance-recharge-status ' +
        displayStatusClass(it) +
        '">' +
        escapeHtml(statusLabel) +
        '</span>'
      : '';
    return (
      '<article class="balance-recharge-item" data-recharge-id="' +
      escapeHtml(String(it.id)) +
      '">' +
      '<div class="balance-recharge-item-head">' +
      '<span class="balance-recharge-item-date">' +
      escapeHtml(it.created_at || '') +
      '</span>' +
      thumbs +
      pmInline +
      statusBadge +
      '</div>' +
      userNote +
      adminNote +
      '</article>'
    );
  }

  function upsertUserRechargeItem(it) {
    var idx = -1;
    for (var i = 0; i < userRechargeItems.length; i++) {
      if (userRechargeItems[i] && userRechargeItems[i].id === it.id) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) userRechargeItems[idx] = it;
    else userRechargeItems.unshift(it);
  }

  function removeUserRechargeItem(rechargeId) {
    userRechargeItems = userRechargeItems.filter(function (it) {
      return it && it.id !== rechargeId;
    });
  }

  function patchUserRechargeDom(it, meta) {
    var list = document.getElementById('balanceRechargeList');
    if (!list) return false;
    var filterEl = document.getElementById('balanceRechargeListFilter');
    var filterValue = filterEl ? filterEl.value : 'all';
    var selector = '[data-recharge-id="' + it.id + '"]';
    var existing = list.querySelector(selector);
    var matches = userItemMatchesFilter(it, filterValue);

    if (!matches) {
      if (existing) existing.remove();
      if (!list.querySelector('.balance-recharge-item')) {
        list.innerHTML =
          '<p class="balance-recharge-empty text-muted">No hay solicitudes en este filtro.</p>';
      }
      return true;
    }

    var html = renderUserRechargeItem(it);
    var emptyMsg = list.querySelector('.balance-recharge-empty, .balance-recharge-loading');
    if (existing) {
      existing.outerHTML = html;
    } else if (emptyMsg) {
      list.innerHTML = html;
    } else {
      list.insertAdjacentHTML('afterbegin', html);
    }
    return true;
  }

  function patchUserRechargeFromRealtime(eventData, meta) {
    meta = meta || {};
    var list = document.getElementById('balanceRechargeList');
    if (!list) return Promise.resolve();

    var rechargeId = eventData && eventData.recharge_id ? parseInt(eventData.recharge_id, 10) : 0;
    if (!rechargeId) {
      loadList(meta);
      return Promise.resolve();
    }

    return rechargeFetchJson(userRechargeItemUrl(meta, rechargeId))
      .then(function (data) {
        if (!data || !data.success || !data.item) {
          throw new Error('item');
        }
        if (data.filter_counts) {
          updateUserFilterOptionLabels(data.filter_counts);
        }
        upsertUserRechargeItem(data.item);
        if (!patchUserRechargeDom(data.item, meta)) {
          throw new Error('dom');
        }
      });
  }

  function removeUserListFooter(list) {
    if (!list) return;
    list.querySelectorAll('.balance-recharge-list-truncation, .balance-recharge-list-more-wrap').forEach(function (el) {
      el.remove();
    });
  }

  function mergeUserRechargeItems(newItems) {
    var seen = {};
    userRechargeItems.forEach(function (it) {
      if (it && it.id != null) seen[it.id] = true;
    });
    (newItems || []).forEach(function (it) {
      if (it && it.id != null && !seen[it.id]) {
        userRechargeItems.push(it);
        seen[it.id] = true;
      }
    });
  }

  function updateUserListMeta(data) {
    data = data || {};
    userListMeta = {
      offset: parseInt(data.offset, 10) || 0,
      limit: parseInt(data.list_limit, 10) || 50,
      has_more: !!data.has_more,
      filter_total: parseInt(data.filter_total, 10) || 0,
      shown_count: parseInt(data.shown_count, 10) || (userRechargeItems ? userRechargeItems.length : 0),
      next_offset:
        data.next_offset != null
          ? parseInt(data.next_offset, 10)
          : (parseInt(data.offset, 10) || 0) + ((data.items && data.items.length) || 0),
    };
  }

  function renderListFooter(data) {
    data = data || {};
    var parts = [];
    var shown = parseInt(data.shown_count, 10);
    if (isNaN(shown)) shown = userRechargeItems.length;
    var total = parseInt(data.filter_total, 10);
    if (!isNaN(total) && total > shown) {
      parts.push(
        '<p class="balance-recharge-list-truncation text-muted" role="status">Mostrando ' +
          shown +
          ' de ' +
          total +
          ' en este filtro.</p>'
      );
    } else if (data.has_more) {
      parts.push(
        '<p class="balance-recharge-list-truncation text-muted" role="status">Hay más solicitudes en este filtro.</p>'
      );
    }
    if (data.has_more) {
      parts.push(
        '<div class="balance-recharge-list-more-wrap">' +
          '<button type="button" class="btn-panel btn-blue balance-recharge-list-more-btn"' +
          (userListLoadingMore ? ' disabled' : '') +
          '>Cargar más solicitudes</button>' +
          '</div>'
      );
    }
    return parts.join('');
  }

  function renderList(items, meta, listMeta) {
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    userRechargeItems = items || [];
    if (!items || !items.length) {
      list.innerHTML = '<p class="balance-recharge-empty text-muted">No hay solicitudes cargadas.</p>';
      return;
    }
    updateUserListMeta(listMeta || {});
    list.innerHTML = items.map(renderUserRechargeItem).join('') + renderListFooter(listMeta || {});
  }

  function appendListItems(newItems, listMeta) {
    var list = document.getElementById('balanceRechargeList');
    if (!list || !newItems || !newItems.length) return;
    removeUserListFooter(list);
    mergeUserRechargeItems(newItems);
    updateUserListMeta(
      Object.assign({}, listMeta || {}, { shown_count: userRechargeItems.length })
    );
    list.insertAdjacentHTML('beforeend', newItems.map(renderUserRechargeItem).join(''));
    list.insertAdjacentHTML('beforeend', renderListFooter(userListMeta));
  }

  function buildUserListUrl(meta, offset) {
    meta = meta || {};
    var list = document.getElementById('balanceRechargeList');
    var listUrl = meta.listUrl || (list ? list.getAttribute('data-list-url') : '') || '';
    var filterEl = document.getElementById('balanceRechargeListFilter');
    var st = filterEl ? filterEl.value : 'all';
    var limit = userListMeta.limit || 50;
    return (
      listUrl +
      (listUrl.indexOf('?') >= 0 ? '&' : '?') +
      'status=' +
      encodeURIComponent(st) +
      '&offset=' +
      encodeURIComponent(String(offset || 0)) +
      '&limit=' +
      encodeURIComponent(String(limit))
    );
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadList(meta) {
    meta = meta || {};
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    var listUrl = meta.listUrl || list.getAttribute('data-list-url') || '';
    if (!listUrl) {
      renderList([], meta);
      return;
    }
    userListMeta.offset = 0;
    var url = buildUserListUrl(meta, 0);
    list.innerHTML = '<p class="balance-recharge-loading text-muted">Cargando solicitudes…</p>';
    rechargeFetchJson(url)
      .then(function (data) {
        if (!data || !data.success) {
          updateUserFilterOptionLabels({
            all: 0,
            pending: 0,
            accumulated: 0,
            approved: 0,
            rejected: 0,
          });
          list.innerHTML =
            '<p class="balance-recharge-empty text-muted">No se pudieron cargar las solicitudes.</p>';
          return;
        }
        updateUserFilterOptionLabels(
          data.filter_counts || userFilterCountsFromItems(data.items)
        );
        var items = data.items || [];
        if (!items.length) {
          userRechargeItems = [];
          list.innerHTML =
            '<p class="balance-recharge-empty text-muted">No hay solicitudes en este filtro.</p>';
          return;
        }
        renderList(items, meta, data);
      })
      .catch(function () {
        updateUserFilterOptionLabels({
          all: 0,
          pending: 0,
          accumulated: 0,
          approved: 0,
          rejected: 0,
        });
        list.innerHTML =
          '<p class="balance-recharge-empty text-muted">No se pudieron cargar las solicitudes.</p>';
      });
  }

  function loadMoreList(meta) {
    meta = meta || {};
    if (userListLoadingMore || !userListMeta.has_more) return;
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    var nextOffset =
      userListMeta.next_offset != null ? userListMeta.next_offset : userRechargeItems.length;
    userListLoadingMore = true;
    var btn = list.querySelector('.balance-recharge-list-more-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Cargando…';
    }
    rechargeFetchJson(buildUserListUrl(meta, nextOffset))
      .then(function (data) {
        if (!data || !data.success) {
          throw new Error('load-more');
        }
        appendListItems(data.items || [], data);
      })
      .catch(function () {
        var retryBtn = list.querySelector('.balance-recharge-list-more-btn');
        if (retryBtn) {
          retryBtn.disabled = false;
          retryBtn.textContent = 'Cargar más solicitudes';
        }
      })
      .finally(function () {
        userListLoadingMore = false;
      });
  }

  function bindListFilter(meta) {
    var filterEl = document.getElementById('balanceRechargeListFilter');
    if (!filterEl) return;
    filterEl.addEventListener('change', function () {
      loadList(meta);
    });
  }

  function bindListLoadMore(meta) {
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    list.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.balance-recharge-list-more-btn') : null;
      if (!btn || btn.disabled) return;
      loadMoreList(meta);
    });
  }

  function methodAccountBlock(accountNumber, copyTitle, ariaLabel) {
    if (!accountNumber) return '';
    var acct = String(accountNumber);
    var isEmail = acct.indexOf('@') >= 0;
    var isWallet = acct.indexOf('0x') === 0 || acct.indexOf('T') === 0;
    var title = copyTitle || (isWallet ? 'Copiar wallet' : isEmail ? 'Copiar correo' : 'Copiar número');
    var label = ariaLabel || title;
    var accountClass =
      'balance-recharge-method-account' +
      (isEmail || isWallet ? ' balance-recharge-method-account--email' : '');
    return (
      '<span class="balance-recharge-method-account-wrap">' +
      '<span class="' +
      accountClass +
      '">' +
      escapeHtml(accountNumber) +
      '</span>' +
      '<button type="button" class="balance-recharge-method-copy" data-copy="' +
      escapeHtml(accountNumber) +
      '" title="' +
      escapeHtml(title) +
      '" aria-label="' +
      escapeHtml(label) +
      '">' +
      '<i class="fas fa-copy" aria-hidden="true"></i></button></span>'
    );
  }

  function methodPaymentAccountBlocks(m) {
    m = m || {};
    if (m.is_breb_bancolombia || m.is_breb_nequi || m.bre_b_llave) {
      if (m.bre_b_llave) {
        return methodAccountBlock(m.bre_b_llave, 'Copiar llave', 'Copiar llave Bre-B');
      }
      return '';
    }
    var acct = String(m.account_number || '');
    if (m.is_crypto_wallet || acct.indexOf('0x') === 0 || acct.indexOf('T') === 0) {
      var net = m.crypto_network ? ' (' + m.crypto_network + ')' : '';
      return methodAccountBlock(acct, 'Copiar wallet' + net, 'Copiar dirección wallet' + net);
    }
    return methodAccountBlock(
      m.account_number,
      acct.indexOf('@') >= 0 ? 'Copiar correo' : 'Copiar número',
      acct.indexOf('@') >= 0 ? 'Copiar correo electrónico' : 'Copiar número de cuenta'
    );
  }

  function renderAccumHintHtml() {
    return '<span class="balance-recharge-method-accum-hint">se acumula hasta conversión</span>';
  }

  function renderMethodHeadHtml(m, methodLabel, accountHtml) {
    if (m.is_accumulator) {
      return (
        '<div class="balance-recharge-method-head balance-recharge-method-head--accum">' +
        '<span class="balance-recharge-method-label">' +
        escapeHtml(methodLabel) +
        '</span>' +
        (accountHtml
          ? '<div class="balance-recharge-method-accum-account-row">' + accountHtml + '</div>'
          : '') +
        '<div class="balance-recharge-method-accum-hint-scroll">' +
        renderAccumHintHtml() +
        '</div></div>'
      );
    }
    return (
      '<div class="balance-recharge-method-head">' +
      '<span class="balance-recharge-method-label">' +
      escapeHtml(methodLabel) +
      '</span>' +
      accountHtml +
      '</div>'
    );
  }

  function copyAccountNumber(text, btn) {
    var value = String(text || '');
    if (!value) return;
    function feedback() {
      if (!btn) return;
      btn.classList.add('is-copied');
      btn.setAttribute('title', 'Copiado');
      setTimeout(function () {
        btn.classList.remove('is-copied');
        btn.setAttribute('title', 'Copiar número');
      }, 1600);
    }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand('copy')) feedback();
      } catch (err) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(feedback).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function paymentCurrencyLabel(code) {
    return code === 'USD' ? 'USDT' : code || 'COP';
  }

  /** 539,000 · 539.000 · 539000 → número positivo o null */
  function parseRechargeAmount(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(/^\$+|\s+$/g, '').replace(/\s/g, '');
    if (!s || !/\d/.test(s)) return null;

    if (/^\d+$/.test(s)) {
      var n = Number(s);
      return n > 0 ? n : null;
    }

    if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) {
      n = Number(s.split(',')[0].replace(/\./g, ''));
      return n > 0 ? n : null;
    }

    if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) {
      n = Number(s.split('.')[0].replace(/,/g, ''));
      return n > 0 ? n : null;
    }

    if (/^\d+\.\d+$/.test(s)) {
      var dotParts = s.split('.');
      if (dotParts[1].length === 3) {
        n = Number(dotParts[0] + dotParts[1]);
        return n > 0 ? n : null;
      }
      n = Number(s);
      return n > 0 ? n : null;
    }

    if (/^\d+,\d+$/.test(s)) {
      var commaParts = s.split(',');
      if (commaParts[1].length === 3) {
        n = Number(commaParts[0] + commaParts[1]);
        return n > 0 ? n : null;
      }
      n = Number(s.replace(',', '.'));
      return n > 0 ? n : null;
    }

    var digits = s.replace(/\D/g, '');
    if (digits.length >= 3) {
      n = Number(digits);
      return n > 0 ? n : null;
    }
    return null;
  }

  function updateAmountFieldForMethod() {
    var checked = document.querySelector('input[name="payment_method_id"]:checked');
    var label = checked && checked.closest('.balance-recharge-method-option');
    var payCur = label ? String(label.getAttribute('data-payment-currency') || '').trim().toUpperCase() : '';
    var isAccum = !!(label && label.getAttribute('data-is-accumulator') === '1');
    var amountEl = document.getElementById('balanceRechargeAmount');
    var currencyInput = document.getElementById('balanceRechargeCurrency');
    var targetCur = (currencyInput && currencyInput.value ? currencyInput.value : 'COP').toUpperCase();
    var cur = payCur || targetCur;
    if (currencyInput && payCur) {
      currencyInput.value = payCur;
    }
    if (amountEl) {
      var example = cur === 'USD' ? '333.64' : '50.000';
      var amountLabel =
        amountEl.parentElement &&
        amountEl.parentElement.querySelector('label[for="balanceRechargeAmount"]');
      if (isBinancePaySelected()) {
        amountEl.placeholder = 'Monto a recargar (USDT) — ej. ' + example;
        if (amountLabel) amountLabel.textContent = 'Monto a recargar (USDT)';
      } else if (isAccum) {
        amountEl.placeholder =
          'Monto transferido — ej. ' +
          example +
          (cur === 'USD' ? ' (con centavos)' : ' o 50000');
        if (amountLabel) amountLabel.textContent = 'Monto transferido';
      } else {
        amountEl.placeholder =
          'Monto transferido (' +
          paymentCurrencyLabel(cur) +
          ') — ej. ' +
          example +
          (cur === 'USD' ? ' (con centavos)' : ' o 50000');
        if (amountLabel) {
          amountLabel.textContent = 'Monto transferido (' + paymentCurrencyLabel(cur) + ')';
        }
      }
      var hint = document.getElementById('balanceRechargeAmountHint');
      if (hint) {
        hint.textContent =
          cur === 'USD'
            ? isAccum
              ? 'Escribe el monto exacto del comprobante, con dos decimales si aplica (ej. 333.64).'
              : 'En USDT escribe el monto exacto del comprobante, con dos decimales si aplica (ej. 333.64).'
            : 'Puedes usar punto, coma o escribir el número sin separadores.';
      }
    }
  }

  function renderPaymentMethods(methods) {
    var list = document.getElementById('balanceRechargeMethodsList');
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (!list) return;
    if (!methods || !methods.length) {
      list.innerHTML =
        '<p class="balance-recharge-hint text-danger">No tienes medios de pago habilitados. Contacta al administrador.</p>';
      if (submitBtn) submitBtn.disabled = true;
      updateSelectedMethodQr();
      return;
    }
    list.innerHTML = methods
      .map(function (m, idx) {
        var payCur = (m.payment_currency || m.currency || '').toUpperCase();
        var qrAttr = m.qr_url ? ' data-qr-url="' + escapeHtml(m.qr_url) + '"' : '';
        var payCurAttr = payCur ? ' data-payment-currency="' + escapeHtml(payCur) + '"' : '';
        var accumAttr = m.is_accumulator ? ' data-is-accumulator="1"' : '';
        var binanceAttr = m.is_binance_pay ? ' data-is-binance-pay="1"' : '';
        var checked = idx === 0 ? ' checked' : '';
        var accountNumber = methodPaymentAccountBlocks(m);
        var description = m.description
          ? '<span class="balance-recharge-method-details">' + escapeHtml(m.description) + '</span>'
          : '';
        var methodLabel = m.label || 'Medio';
        if (m.is_accumulator && payCur) {
          methodLabel = methodLabel + ' (' + paymentCurrencyLabel(payCur) + ')';
        }
        var optionClass =
          'balance-recharge-method-option' +
          (m.is_accumulator ? ' balance-recharge-method-option--accum' : '');
        return (
          '<label class="' +
          optionClass +
          '"' +
          qrAttr +
          payCurAttr +
          accumAttr +
          binanceAttr +
          '>' +
          '<input type="radio" name="payment_method_id" value="' +
          escapeHtml(m.id || '') +
          '"' +
          checked +
          ' required>' +
          '<div class="balance-recharge-method-body">' +
          renderMethodHeadHtml(m, methodLabel, accountNumber) +
          description +
          '</div></label>'
        );
      })
      .join('');
    if (submitBtn) submitBtn.disabled = false;
    updateSelectedMethodQr();
    updateAmountFieldForMethod();
    updateBinancePayUi();
  }

  function loadPaymentMethods(meta) {
    var list = document.getElementById('balanceRechargeMethodsList');
    if (!list || !meta.methodsUrl) return Promise.resolve();
    return rechargeFetchJson(meta.methodsUrl)
      .then(function (data) {
        if (!data || !data.success) {
          list.innerHTML =
            '<p class="balance-recharge-hint text-danger">No se pudieron cargar los medios de pago.</p>';
          return;
        }
        renderPaymentMethods(data.methods || []);
      })
      .catch(function () {
        if (!list.querySelector('.balance-recharge-method-option')) {
          list.innerHTML =
            '<p class="balance-recharge-hint text-danger">Error al cargar medios de pago.</p>';
        }
      });
  }

  var lightboxReturnFocus = null;

  function releaseLightboxFocus(lb) {
    var active = document.activeElement;
    if (lb && active && typeof lb.contains === 'function' && lb.contains(active)) {
      if (typeof active.blur === 'function') active.blur();
    }
    if (lightboxReturnFocus && typeof lightboxReturnFocus.focus === 'function') {
      try {
        lightboxReturnFocus.focus({ preventScroll: true });
      } catch (err) {
        /* ignore */
      }
    }
    lightboxReturnFocus = null;
  }

  function closeImageLightbox() {
    var lb = document.getElementById('balanceRechargeQrLightbox');
    var lbImg = document.getElementById('balanceRechargeQrLightboxImg');
    var lbErr = document.getElementById('balanceRechargeLightboxError');
    var panel = lb ? lb.querySelector('.balance-recharge-qr-lightbox__panel') : null;
    if (!lb) return;
    releaseLightboxFocus(lb);
    lb.hidden = true;
    lb.setAttribute('aria-hidden', 'true');
    if (lbImg) {
      lbImg.onload = null;
      lbImg.onerror = null;
      lbImg.removeAttribute('src');
      lbImg.hidden = false;
    }
    if (lbErr) {
      lbErr.hidden = true;
      lbErr.textContent = '';
    }
    if (panel) {
      panel.classList.remove('balance-recharge-proof-lightbox__panel');
    }
    document.body.classList.remove('balance-recharge-qr-lightbox-open');
  }

  function openImageLightbox(src, opts) {
    var lb = document.getElementById('balanceRechargeQrLightbox');
    var lbImg = document.getElementById('balanceRechargeQrLightboxImg');
    var lbErr = document.getElementById('balanceRechargeLightboxError');
    var panel = lb ? lb.querySelector('.balance-recharge-qr-lightbox__panel') : null;
    if (!lb || !lbImg || !src) return;
    opts = opts || {};
    if (panel) {
      if (opts.isProof) {
        panel.classList.add('balance-recharge-proof-lightbox__panel');
      } else {
        panel.classList.remove('balance-recharge-proof-lightbox__panel');
      }
    }
    if (lbErr) {
      lbErr.hidden = true;
      lbErr.textContent = '';
    }
    lbImg.hidden = false;
    lbImg.alt = opts.alt || (opts.isProof ? 'Comprobante ampliado' : 'Código QR del medio de pago ampliado');
    lbImg.onload = function () {
      if (lbErr) lbErr.hidden = true;
      lbImg.hidden = false;
    };
    lbImg.onerror = function () {
      lbImg.hidden = true;
      if (lbErr) {
        lbErr.textContent = 'El comprobante no está disponible en el servidor.';
        lbErr.hidden = false;
      }
    };
    lbImg.src = src;
    lightboxReturnFocus = document.activeElement;
    lb.hidden = false;
    lb.removeAttribute('aria-hidden');
    document.body.classList.add('balance-recharge-qr-lightbox-open');
    var closeBtn = lb.querySelector('.balance-recharge-qr-lightbox__close');
    if (closeBtn) {
      window.requestAnimationFrame(function () {
        if (!lb.hidden) closeBtn.focus();
      });
    }
  }

  function bindImageLightbox() {
    var openBtn = document.getElementById('balanceRechargeMethodQrOpen');
    var lb = document.getElementById('balanceRechargeQrLightbox');
    var list = document.getElementById('balanceRechargeList');
    var preview = document.getElementById('balanceRechargePreview');
    if (!lb) return;

    function tryOpenQrLightbox() {
      if (!openBtn) return;
      var wrap = document.getElementById('balanceRechargeMethodQr');
      if (wrap && wrap.hidden) return;
      var src = String(openBtn.getAttribute('data-qr-src') || '').trim();
      if (src) openImageLightbox(src, { isProof: false });
    }

    function openProofFromEl(el) {
      if (!el) return;
      var src = String(el.getAttribute('data-proof-url') || '').trim();
      if (!src) {
        var img = el.querySelector('img');
        src = img ? String(img.getAttribute('src') || '').trim() : '';
      }
      if (src) openImageLightbox(src, { isProof: true, alt: 'Comprobante de recarga ampliado' });
    }

    if (openBtn) {
      openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        tryOpenQrLightbox();
      });
    }

    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('.balance-recharge-proof-open');
        if (!btn) return;
        e.preventDefault();
        openProofFromEl(btn);
      });
    }

    if (preview) {
      preview.addEventListener('click', function (e) {
        var img = e.target.closest('.balance-recharge-preview-img');
        if (!img || !img.src) return;
        e.preventDefault();
        openImageLightbox(img.src, { isProof: true, alt: 'Vista previa del comprobante' });
      });
      preview.addEventListener('keydown', function (e) {
        var img = e.target.closest('.balance-recharge-preview-img');
        if (!img || !img.src) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openImageLightbox(img.src, { isProof: true, alt: 'Vista previa del comprobante' });
        }
      });
    }

    lb.querySelectorAll('[data-qr-lightbox-close]').forEach(function (el) {
      el.addEventListener('click', closeImageLightbox);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lb && !lb.hidden) {
        closeImageLightbox();
      }
    });
  }

  function hideMethodQrBlock() {
    var wrap = document.getElementById('balanceRechargeMethodQr');
    var openBtn = document.getElementById('balanceRechargeMethodQrOpen');
    if (!wrap) return;
    if (openBtn) openBtn.removeAttribute('data-qr-src');
    wrap.hidden = true;
  }

  function updateSelectedMethodQr() {
    var wrap = document.getElementById('balanceRechargeMethodQr');
    var openBtn = document.getElementById('balanceRechargeMethodQrOpen');
    var checked = document.querySelector('input[name="payment_method_id"]:checked');
    if (!wrap || !openBtn) return;

    hideMethodQrBlock();
    if (isBinancePaySelected()) return;

    var label = checked && checked.closest('.balance-recharge-method-option');
    var qrUrl = label ? String(label.getAttribute('data-qr-url') || '').trim() : '';
    if (!qrUrl) return;

    var probe = new Image();
    probe.onload = function () {
      openBtn.setAttribute('data-qr-src', qrUrl);
      wrap.hidden = false;
    };
    probe.onerror = function () {
      hideMethodQrBlock();
    };
    probe.src = qrUrl;
  }

  function bindPaymentMethodCopy() {
    var list = document.getElementById('balanceRechargeMethodsList');
    if (!list) return;
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.balance-recharge-method-copy');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      copyAccountNumber(btn.getAttribute('data-copy') || '', btn);
    });
  }

  function bindPaymentMethodQr() {
    var list = document.getElementById('balanceRechargeMethodsList');
    if (!list) return;
    list.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'payment_method_id') {
        updateSelectedMethodQr();
        updateAmountFieldForMethod();
        updateBinancePayUi();
      }
    });
    updateSelectedMethodQr();
    updateBinancePayUi();
  }

  function bindForm(meta) {
    var form = document.getElementById('balanceRechargeForm');
    var fileInput = document.getElementById('balanceRechargeProofs');
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (!form) return;

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        renderPreview(fileInput.files);
      });
      renderPreview(fileInput.files);
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      showFormMsg('', false);

      var submitUrl = meta.submitUrl || form.getAttribute('data-submit-url') || form.getAttribute('action') || '';
      if (!submitUrl) {
        showFormMsg('No se pudo enviar la solicitud (configuración incompleta).', true);
        return;
      }

      var amountEl = document.getElementById('balanceRechargeAmount');
      var amountRaw = amountEl ? amountEl.value : '';
      var amountParsed = parseRechargeAmount(amountRaw);
      if (!amountParsed || amountParsed <= 0) {
        showFormMsg('Indica el monto transferido.', true);
        return;
      }
      var pmRadio = form.querySelector('input[name="payment_method_id"]:checked');
      if (!pmRadio) {
        showFormMsg('Selecciona un medio de pago.', true);
        return;
      }

      if (isBinancePaySelected()) {
        var orderUrl = meta.binancePayOrderUrl || '';
        if (!orderUrl) {
          showFormMsg('Binance Pay no está configurado en el servidor.', true);
          return;
        }
        setSubmitLoading(true, {
          label: 'Creando orden…',
          message: 'Conectando con Binance Pay…',
        });
        var csrfBp = getCsrfToken();
        var headersBp = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (csrfBp) headersBp['X-CSRFToken'] = csrfBp;
        fetch(orderUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: headersBp,
          body: JSON.stringify({
            payment_method_id: pmRadio.value,
            amount: String(amountParsed),
          }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              return { ok: r.ok, data: j };
            });
          })
          .then(function (res) {
            setSubmitLoading(false);
            if (!res.ok || !res.data || !res.data.success) {
              showFormMsg('', true, {
                title: 'Binance Pay no disponible',
                titleOnly: true,
              });
              return;
            }
            showFormMsg(res.data.message || 'Orden creada. Completa el pago en Binance.', false);
            showBinancePayCheckout(res.data);
            startBinancePayPolling(meta, res.data.merchant_trade_no || '');
            loadList(meta);
          })
          .catch(function () {
            setSubmitLoading(false);
            showFormMsg('', true, {
              title: 'Binance Pay no disponible',
              titleOnly: true,
            });
          });
        return;
      }

      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        showFormMsg('Adjunta la foto del comprobante.', true);
        return;
      }
      if (fileInput.files.length > 1) {
        showFormMsg('Solo se permite una imagen por solicitud.', true);
        return;
      }

      var fd = new FormData(form);
      var currencyInput = document.getElementById('balanceRechargeCurrency');
      var submitCur = (currencyInput && currencyInput.value ? currencyInput.value : 'COP').toUpperCase();
      fd.set(
        'amount',
        submitCur === 'USD' ? String(amountParsed) : String(Math.round(amountParsed))
      );
      var csrf = getCsrfToken();
      if (csrf) {
        fd.append('_csrf_token', csrf);
      }
      setSubmitLoading(true);

      var headers = { Accept: 'application/json' };
      if (csrf) {
        headers['X-CSRFToken'] = csrf;
      }

      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller
        ? window.setTimeout(function () {
            controller.abort();
          }, 180000)
        : null;

      fetch(submitUrl, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: headers,
        signal: controller ? controller.signal : undefined,
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, data: j };
          });
        })
        .then(function (res) {
          setSubmitLoading(false);
          if (!res.ok || !res.data || !res.data.success) {
            showFormMsg((res.data && res.data.message) || 'No se pudo enviar la solicitud.', true);
            return;
          }
          showFormMsg(res.data.message || 'Solicitud enviada.', false);
          form.reset();
          renderPreview(null);
          hideMethodQrBlock();
          updateSelectedMethodQr();
          updateAmountFieldForMethod();
          refreshRechargeSaldoDisplay();
          loadList(meta);
        })
        .catch(function (err) {
          setSubmitLoading(false);
          if (err && err.name === 'AbortError') {
            showFormMsg(
              'La verificación tardó demasiado. Intenta de nuevo con una foto más nítida o más pequeña.',
              true
            );
            return;
          }
          showFormMsg('Error de conexión. Intenta de nuevo.', true);
        })
        .finally(function () {
          if (timeoutId) window.clearTimeout(timeoutId);
        });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var meta = readMeta();
    bindPaymentMethodQr();
    bindPaymentMethodCopy();
    bindImageLightbox();
    bindRechargeRealtime(meta);
    bindForm(meta);
    bindListFilter(meta);
    bindListLoadMore(meta);
    loadPaymentMethods(meta).then(function () {
      updateAmountFieldForMethod();
      updateBinancePayUi();
    });
    loadList(meta);
  });
})();
