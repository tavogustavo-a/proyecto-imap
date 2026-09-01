/* Recargas de saldo Multiplataforma (QR) en proveedores fuera. */
(function () {
  'use strict';

  var root = document.getElementById('mpApiRoot');
  if (!root) return;

  var urls = {
    config: root.dataset.urlRechargeConfig,
    attempts: root.dataset.urlRechargeAttempts,
    detailTpl: root.dataset.urlRechargeDetailTpl || '',
    checkTpl: root.dataset.urlRechargeCheckTpl || '',
    issues: root.dataset.urlRechargeIssues
  };

  var els = {
    chip: document.getElementById('mpRechargeChip'),
    hint: document.getElementById('mpRechargeHint'),
    form: document.getElementById('mpRechargeForm'),
    meta: document.getElementById('mpRechargeMeta'),
    name: document.getElementById('mpRechargeName'),
    amount: document.getElementById('mpRechargeAmount'),
    prefix: document.getElementById('mpRechargePrefix'),
    createBtn: document.getElementById('mpRechargeCreateBtn'),
    listBtn: document.getElementById('mpRechargeListBtn'),
    msg: document.getElementById('mpRechargeMsg'),
    active: document.getElementById('mpRechargeActive'),
    activeTitle: document.getElementById('mpRechargeActiveTitle'),
    activeStatus: document.getElementById('mpRechargeActiveStatus'),
    activeMeta: document.getElementById('mpRechargeActiveMeta'),
    qrOpen: document.getElementById('mpRechargeQrOpen'),
    checkBtn: document.getElementById('mpRechargeCheckBtn'),
    reportWrap: document.getElementById('mpRechargeReportWrap'),
    issueText: document.getElementById('mpRechargeIssueText'),
    issueFile: document.getElementById('mpRechargeIssueFile'),
    issueBtn: document.getElementById('mpRechargeIssueBtn'),
    listWrap: document.getElementById('mpRechargeListWrap'),
    lightbox: document.getElementById('mpRechargeQrLightbox'),
    qrImg: document.getElementById('mpRechargeQrImg')
  };

  var config = null;
  var activePayment = null;
  var pollTimer = null;
  var pollUntil = 0;

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    var headers = { 'X-CSRFToken': csrfToken() };
    var body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: body,
      credentials: 'same-origin'
    }).then(function (resp) {
      return resp.json().catch(function () {
        return { success: false, error: 'Respuesta inválida (HTTP ' + resp.status + ').' };
      });
    });
  }

  function setChip(state, label) {
    if (!els.chip) return;
    els.chip.textContent = label;
    els.chip.className = 'mp-api-chip mp-api-chip--' + state;
  }

  function showMsg(text, kind) {
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.className = 'mp-api-message mp-api-message--' + (kind || 'info');
  }

  function hideMsg() {
    if (els.msg) els.msg.className = 'mp-api-message hidden';
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    btn.classList.toggle('mp-api-btn-busy', !!busy);
  }

  function wordCount(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function checkUrl(paymentId) {
    return String(urls.checkTpl || '').replace('/0/', '/' + paymentId + '/').replace(/\/0$/, '/' + paymentId);
  }

  function detailUrl(paymentId) {
    return String(urls.detailTpl || '').replace('/0/', '/' + paymentId + '/').replace(/\/0$/, '/' + paymentId);
  }

  function fmtAmount(value, prefix) {
    var num = Number(value);
    var p = prefix || (config && config.currency_prefix) || '$';
    if (isNaN(num)) return String(value || '—');
    return p + ' ' + num.toLocaleString('es-CO');
  }

  function providerLabel() {
    var p = String((config && config.payment_provider) || '').toLowerCase();
    if (p.indexOf('binance') !== -1) return 'Binance Pay';
    if (p.indexOf('bancolombia') !== -1) return 'QR Bancolombia';
    return p || 'QR';
  }

  function isBinance() {
    return String((config && config.payment_provider) || '').toLowerCase().indexOf('binance') !== -1;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollUntil = 0;
  }

  function openQr(src) {
    if (!src || !els.lightbox || !els.qrImg) return;
    els.qrImg.src = src;
    els.lightbox.hidden = false;
    document.body.classList.add('balance-recharge-qr-lightbox-open');
  }

  function closeQr() {
    if (!els.lightbox) return;
    els.lightbox.hidden = true;
    document.body.classList.remove('balance-recharge-qr-lightbox-open');
  }

  function setActiveStatus(kind, label) {
    if (!els.activeStatus) return;
    els.activeStatus.textContent = label;
    els.activeStatus.className = 'mp-api-chip mp-api-chip--' + kind;
  }

  function renderActive(data) {
    activePayment = data || null;
    if (!els.active) return;
    if (!data) {
      els.active.classList.add('hidden');
      return;
    }
    els.active.classList.remove('hidden');
    var pid = data.payment_id || data.id;
    var amount = data.amount_requested || data.value;
    var holder = data.holder_name || data.name || '';
    els.activeTitle.textContent = 'Recarga #' + pid;
    els.activeMeta.textContent =
      (holder ? holder + ' · ' : '') + fmtAmount(amount) +
      (data.amount_usdt ? ' · ' + data.amount_usdt + ' USDT' : '');
    var verified = !!(data.validated || data.check_status === 'verified');
    var pending = data.check_status === 'pending' || (!verified && data.check_status !== 'not_found');
    if (verified) {
      setActiveStatus('ok', 'Acreditada');
      stopPoll();
    } else if (data.check_status === 'not_found') {
      setActiveStatus('off', 'No encontrada');
    } else {
      setActiveStatus('saved', pending ? 'Pendiente' : 'En revisión');
    }
    var qr = data.qr_data_url || data.qr_url || '';
    if (qr && els.qrOpen) {
      els.qrOpen.classList.remove('hidden');
      els.qrOpen.dataset.qrSrc = qr;
    } else if (els.qrOpen) {
      els.qrOpen.classList.add('hidden');
      els.qrOpen.dataset.qrSrc = '';
    }
    if (els.reportWrap) {
      var canReport = data.can_report !== false && !verified;
      els.reportWrap.classList.toggle('hidden', !canReport);
    }
  }

  function startPoll() {
    stopPoll();
    if (!activePayment) return;
    pollUntil = Date.now() + 180000;
    pollTimer = setInterval(function () {
      if (Date.now() > pollUntil) {
        stopPoll();
        return;
      }
      doCheck(true);
    }, 8000);
  }

  function applyConfig(data) {
    config = data || {};
    if (!els.form) return;
    var eligible = config.eligible !== false;
    els.form.classList.toggle('hidden', !eligible);
    if (els.hint) {
      els.hint.classList.toggle('hidden', eligible);
      if (!eligible) {
        els.hint.textContent = config.ineligible_reason || 'Este vendedor no puede recargar por este canal.';
      }
    }
    setChip(eligible ? 'ok' : 'off', eligible ? providerLabel() : 'No disponible');
    if (els.prefix) els.prefix.textContent = config.currency_prefix || '$';
    var min = config.minimum_recharge;
    if (els.amount && min) els.amount.min = String(min);
    var parts = [];
    parts.push('Proveedor: ' + providerLabel());
    if (min) parts.push('Mínimo ' + fmtAmount(min));
    if (config.fee_note) parts.push(config.fee_note);
    if (config.qr_dynamic) parts.push('El QR incluye el monto exacto.');
    if (els.meta) els.meta.textContent = parts.join(' · ');
    if (els.name) {
      els.name.placeholder = isBinance()
        ? 'Nombre del titular (opcional según el proveedor)'
        : 'Titular: nombre y dos apellidos, como en el banco';
    }
  }

  function loadConfig() {
    if (!urls.config) return;
    apiFetch(urls.config).then(function (res) {
      if (!res.success) {
        setChip('off', 'Sin conexión');
        if (els.form) els.form.classList.add('hidden');
        if (els.hint) {
          els.hint.classList.remove('hidden');
          els.hint.textContent = res.error || 'No se pudo leer la configuración de recargas.';
        }
        return;
      }
      applyConfig(res.data || {});
    });
  }

  function doCheck(silent) {
    if (!activePayment) return Promise.resolve();
    var pid = activePayment.payment_id || activePayment.id;
    if (!pid) return Promise.resolve();
    if (!silent) setBusy(els.checkBtn, true);
    return apiFetch(checkUrl(pid), { method: 'POST', body: {} })
      .then(function (res) {
        if (!res.success) {
          if (!silent) showMsg(res.error || 'No se pudo verificar.', 'error');
          return;
        }
        var data = res.data || {};
        if (activePayment) {
          Object.keys(data).forEach(function (k) { activePayment[k] = data[k]; });
        } else {
          activePayment = data;
        }
        renderActive(activePayment);
        if (data.validated || data.check_status === 'verified') {
          showMsg('Pago acreditado. El saldo del vendedor se actualizó.', 'ok');
          if (res.profile && res.profile.balance != null) {
            var balEl = document.getElementById('mpProfileBalance');
            if (balEl) {
              var pref = res.profile.currency_prefix || (config && config.currency_prefix) || '';
              var n = Number(res.profile.balance);
              balEl.textContent = isNaN(n)
                ? String(res.profile.balance)
                : n.toLocaleString('es-CO') + (pref ? ' ' + pref : '');
            }
          }
        } else if (!silent) {
          showMsg('Aún no aparece el pago. Si ya transferiste, espera un momento y vuelve a verificar.', 'info');
        }
      })
      .finally(function () {
        if (!silent) setBusy(els.checkBtn, false);
      });
  }

  function renderList(items) {
    if (!els.listWrap) return;
    els.listWrap.classList.remove('hidden');
    if (!items || !items.length) {
      els.listWrap.innerHTML = '<p class="text-muted mb-0">No hay recargas recientes.</p>';
      return;
    }
    var html = '<table class="mp-api-recharge-table"><thead><tr>' +
      '<th>Id</th><th>Titular</th><th>Monto</th><th>Estado</th><th></th>' +
      '</tr></thead><tbody>';
    items.forEach(function (row) {
      var id = row.payment_id || row.id;
      var validated = !!(row.validated || row.check_status === 'verified');
      var st = validated ? 'Acreditada' : (row.has_report ? 'Reportada' : 'Pendiente');
      html += '<tr data-mp-pay="' + String(id) + '">' +
        '<td>' + String(id) + '</td>' +
        '<td>' + escapeHtml(row.holder_name || row.name || '—') + '</td>' +
        '<td>' + escapeHtml(fmtAmount(row.amount_requested || row.value)) + '</td>' +
        '<td>' + escapeHtml(st) + '</td>' +
        '<td><button type="button" class="btn-panel btn-blue mp-api-title-btn" data-mp-open-pay="' + String(id) + '">Ver</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    els.listWrap.innerHTML = html;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  if (els.createBtn) {
    els.createBtn.addEventListener('click', function () {
      var name = (els.name && els.name.value || '').trim();
      var amount = els.amount && els.amount.value;
      if (!isBinance() && wordCount(name) < 3) {
        showMsg('El titular debe coincidir con el comprobante: nombre y dos apellidos.', 'error');
        return;
      }
      if (!name) {
        showMsg('Indica el nombre del titular.', 'error');
        return;
      }
      var min = Number(config && config.minimum_recharge) || 1;
      var value = Number(amount);
      if (!value || value < min) {
        showMsg('El monto mínimo es ' + fmtAmount(min) + '.', 'error');
        return;
      }
      hideMsg();
      setBusy(els.createBtn, true);
      apiFetch(urls.attempts, { method: 'POST', body: { name: name, value: value } })
        .then(function (res) {
          if (!res.success) {
            showMsg(res.error || 'No se pudo crear la recarga.', 'error');
            return;
          }
          renderActive(res.data || {});
          showMsg('Recarga creada. Paga el QR y luego verifica.', 'ok');
          startPoll();
          if ((res.data || {}).qr_data_url) openQr(res.data.qr_data_url);
        })
        .finally(function () { setBusy(els.createBtn, false); });
    });
  }

  if (els.listBtn) {
    els.listBtn.addEventListener('click', function () {
      setBusy(els.listBtn, true);
      apiFetch(urls.attempts)
        .then(function (res) {
          if (!res.success) {
            showMsg(res.error || 'No se pudo cargar el historial.', 'error');
            return;
          }
          var data = res.data || {};
          renderList(data.attempts || data.results || []);
        })
        .finally(function () { setBusy(els.listBtn, false); });
    });
  }

  if (els.checkBtn) {
    els.checkBtn.addEventListener('click', function () { doCheck(false); });
  }

  if (els.qrOpen) {
    els.qrOpen.addEventListener('click', function () {
      openQr(els.qrOpen.dataset.qrSrc || (activePayment && activePayment.qr_data_url));
    });
  }

  if (els.lightbox) {
    els.lightbox.addEventListener('click', function (ev) {
      if (ev.target && ev.target.getAttribute('data-mp-qr-close')) closeQr();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeQr();
    });
  }

  if (els.issueBtn) {
    els.issueBtn.addEventListener('click', function () {
      if (!activePayment) return;
      var pid = activePayment.payment_id || activePayment.id;
      var issue = (els.issueText && els.issueText.value || '').trim();
      var file = els.issueFile && els.issueFile.files && els.issueFile.files[0];
      if (!issue) {
        showMsg('Describe el problema.', 'error');
        return;
      }
      if (!file) {
        showMsg('Adjunta la foto del comprobante.', 'error');
        return;
      }
      var fd = new FormData();
      fd.append('payment_id', String(pid));
      fd.append('issue', issue);
      fd.append('image', file);
      setBusy(els.issueBtn, true);
      apiFetch(urls.issues, { method: 'POST', body: fd })
        .then(function (res) {
          if (!res.success) {
            showMsg(res.error || 'No se pudo enviar el reporte.', 'error');
            return;
          }
          showMsg('Reporte enviado. Multiplataforma lo revisará.', 'ok');
          if (els.reportWrap) els.reportWrap.classList.add('hidden');
        })
        .finally(function () { setBusy(els.issueBtn, false); });
    });
  }

  if (els.listWrap) {
    els.listWrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-mp-open-pay]');
      if (!btn) return;
      var id = btn.getAttribute('data-mp-open-pay');
      var detail = detailUrl(id);
      if (!detail) return;
      apiFetch(detail).then(function (res) {
        if (!res.success) {
          showMsg(res.error || 'No se pudo abrir esa recarga.', 'error');
          return;
        }
        renderActive(res.data || {});
        startPoll();
      });
    });
  }

  document.addEventListener('mp-api-credentials', function (ev) {
    if (ev.detail && ev.detail.configured) loadConfig();
  });
})();
