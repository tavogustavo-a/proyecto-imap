(function () {
  'use strict';

  var SALDO_POLL_MS = 10000;

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
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        applyRechargeSaldoDisplay(data);
        try {
          window.dispatchEvent(new CustomEvent('store-menu-balance-updated', { detail: data }));
        } catch (_ev) {}
        return data;
      })
      .catch(function () {});
  }

  function bindRechargeSaldoPolling() {
    refreshRechargeSaldoDisplay();
    window.setInterval(function () {
      if (document.visibilityState === 'visible') {
        refreshRechargeSaldoDisplay();
      }
    }, SALDO_POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        refreshRechargeSaldoDisplay();
      }
    });
    window.addEventListener('focus', refreshRechargeSaldoDisplay);
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
    };
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
      if (st === 'pending') tallies.pending += 1;
      else if (st === 'accumulated') tallies.accumulated += 1;
      else if (st === 'approved') tallies.approved += 1;
      else if (st === 'rejected') tallies.rejected += 1;
    });
    return tallies;
  }

  function statusClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'approved' || s === 'accum_converted') return 'balance-recharge-status--approved';
    if (s === 'rejected') return 'balance-recharge-status--rejected';
    if (s === 'auto_credited') return 'balance-recharge-status--auto';
    if (s === 'accumulated') return 'balance-recharge-status--accumulated';
    return 'balance-recharge-status--pending';
  }

  function showFormMsg(text, isError) {
    var box = document.getElementById('balanceRechargeFormMsg');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || '';
    box.className = 'balance-recharge-form-msg' + (isError ? ' balance-recharge-form-msg--error' : ' balance-recharge-form-msg--ok');
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

  function renderList(items, meta) {
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    if (!items || !items.length) {
      list.innerHTML = '<p class="balance-recharge-empty text-muted">No hay solicitudes cargadas.</p>';
      return;
    }
    var html = items.map(function (it) {
      var thumbs = '';
      if (it.proof_urls && it.proof_urls.length) {
        thumbs = '<div class="balance-recharge-item-proofs">' +
          it.proof_urls.map(function (u, i) {
            var safe = escapeHtml(u);
            var label = it.proof_urls.length > 1 ? 'foto ' + (i + 1) : 'foto';
            return (
              '<button type="button" class="balance-recharge-proof-open balance-recharge-proof-link" data-proof-url="' +
              safe +
              '" title="Ver comprobante ampliado">' +
              escapeHtml(label) +
              '</button>'
            );
          }).join('') +
          '</div>';
      } else if (it.proof_missing) {
        thumbs =
          '<span class="balance-recharge-proof-missing-text" title="El comprobante ya no está disponible">Sin foto</span>';
      }
      var adminNote = it.admin_note
        ? '<p class="balance-recharge-item-admin-note"><strong>Nota del administrador:</strong> ' + escapeHtml(it.admin_note) + '</p>'
        : '';
      var userNote = it.note
        ? '<p class="balance-recharge-item-note">' + escapeHtml(it.note) + '</p>'
        : '';
      var pmRow = '';
      if (thumbs || it.payment_method_label) {
        pmRow =
          '<div class="balance-recharge-item-meta-row">' +
            thumbs +
            (it.payment_method_label
              ? '<p class="balance-recharge-item-pm"><strong>Medio:</strong> ' + escapeHtml(it.payment_method_label) + '</p>'
              : '') +
          '</div>';
      }
      var statusBadge =
        (it.status || '').toLowerCase() === 'auto_credited'
          ? ''
          : '<span class="balance-recharge-status ' +
            statusClass(it.status) +
            '">' +
            escapeHtml(it.status_label || it.status) +
            '</span>';
      return (
        '<article class="balance-recharge-item">' +
          '<div class="balance-recharge-item-head">' +
            '<span class="balance-recharge-item-amount">' + escapeHtml(fmtAmount(it.amount_claimed, it.currency)) + '</span>' +
            '<span class="balance-recharge-item-date">' + escapeHtml(it.created_at || '') + '</span>' +
            statusBadge +
          '</div>' +
          pmRow +
          userNote +
          adminNote +
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
    meta = meta || {};
    var list = document.getElementById('balanceRechargeList');
    if (!list) return;
    var listUrl = meta.listUrl || list.getAttribute('data-list-url') || '';
    if (!listUrl) {
      renderList([], meta);
      return;
    }
    var filterEl = document.getElementById('balanceRechargeListFilter');
    var st = filterEl ? filterEl.value : 'all';
    var url =
      listUrl + (listUrl.indexOf('?') >= 0 ? '&' : '?') + 'status=' + encodeURIComponent(st);
    list.innerHTML = '<p class="balance-recharge-loading text-muted">Cargando solicitudes…</p>';
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json();
      })
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
          list.innerHTML =
            '<p class="balance-recharge-empty text-muted">No hay solicitudes en este filtro.</p>';
          return;
        }
        renderList(items, meta);
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

  function bindListFilter(meta) {
    var filterEl = document.getElementById('balanceRechargeListFilter');
    if (!filterEl) return;
    filterEl.addEventListener('change', function () {
      loadList(meta);
    });
  }

  function methodAccountBlock(accountNumber, copyTitle, ariaLabel) {
    if (!accountNumber) return '';
    var title = copyTitle || 'Copiar número';
    var label = ariaLabel || title;
    return (
      '<span class="balance-recharge-method-account-wrap">' +
      '<span class="balance-recharge-method-account">' +
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
    if (m.is_breb_bancolombia || m.bre_b_llave) {
      if (m.bre_b_llave) {
        return methodAccountBlock(m.bre_b_llave, 'Copiar llave', 'Copiar llave Bre-B');
      }
      return '';
    }
    return methodAccountBlock(m.account_number);
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
    var amountEl = document.getElementById('balanceRechargeAmount');
    var currencyInput = document.getElementById('balanceRechargeCurrency');
    var targetCur = (currencyInput && currencyInput.value ? currencyInput.value : 'COP').toUpperCase();
    var cur = payCur || targetCur;
    if (currencyInput && payCur) {
      currencyInput.value = payCur;
    }
    if (amountEl) {
      var example = cur === 'USD' ? '333.64' : '50.000';
      amountEl.placeholder =
        'Monto transferido (' +
        paymentCurrencyLabel(cur) +
        ') — ej. ' +
        example +
        (cur === 'USD' ? ' (con centavos)' : ' o 50000');
      var hint = document.getElementById('balanceRechargeAmountHint');
      if (hint) {
        hint.textContent =
          cur === 'USD'
            ? 'En USDT escribe el monto exacto del comprobante, con dos decimales si aplica (ej. 333.64).'
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
        var checked = idx === 0 ? ' checked' : '';
        var accountNumber = methodPaymentAccountBlocks(m);
        var description = m.description
          ? '<span class="balance-recharge-method-details">' + escapeHtml(m.description) + '</span>'
          : '';
        var accumHint = m.is_accumulator
          ? '<span class="balance-recharge-method-accum-hint"><span>Pago en ' +
            escapeHtml(paymentCurrencyLabel(payCur)) +
            '</span><span class="balance-recharge-method-accum-sep" aria-hidden="true">·</span>' +
            '<span>se acumula hasta conversión</span></span>'
          : '';
        var methodLabel = m.label || 'Medio';
        if (m.is_accumulator && payCur) {
          methodLabel = methodLabel + ' (' + paymentCurrencyLabel(payCur) + ')';
        }
        return (
          '<label class="balance-recharge-method-option"' +
          qrAttr +
          payCurAttr +
          accumAttr +
          '>' +
          '<input type="radio" name="payment_method_id" value="' +
          escapeHtml(m.id || '') +
          '"' +
          checked +
          ' required>' +
          '<div class="balance-recharge-method-body">' +
          '<div class="balance-recharge-method-head">' +
          '<span class="balance-recharge-method-label">' +
          escapeHtml(methodLabel) +
          '</span>' +
          accountNumber +
          '</div>' +
          description +
          accumHint +
          '</div></label>'
        );
      })
      .join('');
    if (submitBtn) submitBtn.disabled = false;
    updateSelectedMethodQr();
    updateAmountFieldForMethod();
  }

  function loadPaymentMethods(meta) {
    var list = document.getElementById('balanceRechargeMethodsList');
    if (!list || !meta.methodsUrl) return Promise.resolve();
    return fetch(meta.methodsUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json();
      })
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
      }
    });
    updateSelectedMethodQr();
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
      if (submitBtn) submitBtn.disabled = true;

      var headers = { Accept: 'application/json' };
      if (csrf) {
        headers['X-CSRFToken'] = csrf;
      }

      fetch(submitUrl, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: headers,
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
          hideMethodQrBlock();
          updateSelectedMethodQr();
          updateAmountFieldForMethod();
          refreshRechargeSaldoDisplay();
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
    bindPaymentMethodQr();
    bindPaymentMethodCopy();
    bindImageLightbox();
    bindRechargeSaldoPolling();
    bindForm(meta);
    bindListFilter(meta);
    loadPaymentMethods(meta).then(function () {
      updateAmountFieldForMethod();
    });
    loadList(meta);
  });
})();
