(function () {
  'use strict';

  function readMeta() {
    var el = document.getElementById('balance-recharge-meta');
    if (!el) return {};
    var raw = el.getAttribute('data-balance-recharge-meta');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  function fmtAmount(n, currency) {
    if (n == null || isNaN(n)) return '—';
    var x = Number(n);
    var s = Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(2);
    return '$' + s + ' ' + (currency || '');
  }

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'approved') return 'balance-recharge-status--approved';
    if (s === 'rejected') return 'balance-recharge-status--rejected';
    return 'balance-recharge-status--pending';
  }

  function showFormMsg(text, isError) {
    var box = document.getElementById('balanceRechargeFormMsg');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || '';
    box.className = 'balance-recharge-form-msg' + (isError ? ' balance-recharge-form-msg--error' : ' balance-recharge-form-msg--ok');
  }

  function renderPreview(files) {
    var wrap = document.getElementById('balanceRechargePreview');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!files || !files.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    Array.prototype.forEach.call(files, function (file) {
      if (!file.type || file.type.indexOf('image/') !== 0) return;
      var img = document.createElement('img');
      img.className = 'balance-recharge-preview-img';
      img.alt = file.name || 'Comprobante';
      img.src = URL.createObjectURL(file);
      wrap.appendChild(img);
    });
  }

  function renderList(items, meta) {
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    if (!items || !items.length) {
      list.innerHTML = '<p class="balance-recharge-empty">Aún no has enviado solicitudes de recarga.</p>';
      return;
    }
    var html = items.map(function (it) {
      var thumbs = '';
      if (it.proof_urls && it.proof_urls.length) {
        thumbs = '<div class="balance-recharge-item-proofs">' +
          it.proof_urls.map(function (u, i) {
            return '<a href="' + u + '" target="_blank" rel="noopener" class="balance-recharge-proof-link" title="Ver comprobante ' + (i + 1) + '"><img src="' + u + '" alt="" class="balance-recharge-proof-thumb" loading="lazy"></a>';
          }).join('') +
          '</div>';
      }
      var adminNote = it.admin_note
        ? '<p class="balance-recharge-item-admin-note"><strong>Nota del administrador:</strong> ' + escapeHtml(it.admin_note) + '</p>'
        : '';
      var userNote = it.note
        ? '<p class="balance-recharge-item-note">' + escapeHtml(it.note) + '</p>'
        : '';
      return (
        '<article class="balance-recharge-item">' +
          '<div class="balance-recharge-item-head">' +
            '<span class="balance-recharge-item-amount">' + escapeHtml(fmtAmount(it.amount_claimed, it.currency)) + '</span>' +
            '<span class="balance-recharge-status ' + statusClass(it.status) + '">' + escapeHtml(it.status_label || it.status) + '</span>' +
          '</div>' +
          '<p class="balance-recharge-item-date">' + escapeHtml(it.created_at || '') + '</p>' +
          (it.payment_method_label ? '<p class="balance-recharge-item-pm"><strong>Medio:</strong> ' + escapeHtml(it.payment_method_label) + '</p>' : '') +
          userNote +
          adminNote +
          thumbs +
        '</article>'
      );
    }).join('');
    list.innerHTML = html;
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
    var list = document.getElementById('balanceRechargeList');
    if (!list || !meta.listUrl) return;
    fetch(meta.listUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) {
          list.innerHTML = '<p class="balance-recharge-empty text-danger">No se pudo cargar el historial.</p>';
          return;
        }
        renderList(data.items || [], meta);
      })
      .catch(function () {
        list.innerHTML = '<p class="balance-recharge-empty text-danger">Error de conexión.</p>';
      });
  }

  function bindForm(meta) {
    var form = document.getElementById('balanceRechargeForm');
    var fileInput = document.getElementById('balanceRechargeProofs');
    var submitBtn = document.getElementById('balanceRechargeSubmit');
    if (!form || !meta.submitUrl) return;

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        renderPreview(fileInput.files);
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      showFormMsg('', false);
      var amountEl = document.getElementById('balanceRechargeAmount');
      var amount = amountEl ? amountEl.value : '';
      if (!amount || Number(amount) <= 0) {
        showFormMsg('Indica el monto transferido.', true);
        return;
      }
      var pmRadio = form.querySelector('input[name="payment_method_id"]:checked');
      if (!pmRadio) {
        showFormMsg('Selecciona un medio de pago.', true);
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
      if (submitBtn) submitBtn.disabled = true;

      fetch(meta.submitUrl, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); })
        .then(function (res) {
          if (submitBtn) submitBtn.disabled = false;
          if (!res.ok || !res.data || !res.data.success) {
            showFormMsg((res.data && res.data.message) || 'No se pudo enviar la solicitud.', true);
            return;
          }
          showFormMsg(res.data.message || 'Solicitud enviada.', false);
          form.reset();
          renderPreview(null);
          loadList(meta);
        })
        .catch(function () {
          if (submitBtn) submitBtn.disabled = false;
          showFormMsg('Error de conexión. Intenta de nuevo.', true);
        });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var meta = readMeta();
    bindForm(meta);
    loadList(meta);
  });
})();
