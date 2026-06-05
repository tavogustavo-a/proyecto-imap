(function () {
  'use strict';

  var root = document.querySelector('.admin-recargas-page');
  if (!root) return;

  var listUrl = root.dataset.listUrl;
  var reviewUrlBase = (root.dataset.reviewUrlBase || '').replace(/\/0\/review$/, '');
  var methodsUrl = root.dataset.methodsUrl;
  var searchUsersUrl = root.dataset.searchUsersUrl || '/admin/search_users_ajax';
  var accumSummaryUrl = root.dataset.accumSummaryUrl || '';
  var accumConvertUrl = root.dataset.accumConvertUrl || '';

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function renderMetaDate(createdAt) {
    return (
      '<span class="admin-recarga-meta-date">' +
      escapeHtml(createdAt) +
      '</span>'
    );
  }

  function fmtAmount(n, cur) {
    if (n == null || isNaN(n)) return '—';
    var label = cur === 'USD' ? 'USDT' : cur;
    return '$' + Number(n).toLocaleString('es-CO') + ' ' + label;
  }

  function adminRecargaStatusClass(status, it) {
    var s = (status || '').toLowerCase();
    if (s === 'rejected') return 'admin-recarga-status--rejected';
    if (s === 'approved' || s === 'accum_converted') return 'admin-recarga-status--approved';
    if (s === 'auto_credited') {
      if (
        it &&
        (it.admin_verified === null || it.admin_verified === undefined)
      ) {
        return 'admin-recarga-status--pending';
      }
      return 'admin-recarga-status--approved';
    }
    if (s === 'accumulated') return 'admin-recarga-status--pending';
    return 'admin-recarga-status--pending';
  }

  function renderProofLink(it, wrapClass) {
    wrapClass = wrapClass || 'admin-recarga-proofs';
    var inline = String(wrapClass).indexOf('--inline') !== -1;
    var wrapTag = inline ? 'span' : 'div';
    if (it.proof_urls && it.proof_urls.length) {
      return (
        '<' +
        wrapTag +
        ' class="' +
        wrapClass +
        '">' +
        it.proof_urls
          .map(function (u, idx) {
            var safe = escapeHtml(u);
            var label = it.proof_urls.length > 1 ? 'foto ' + (idx + 1) : 'foto';
            return (
              '<button type="button" class="admin-recarga-proof-open admin-recarga-proof-link" data-proof-url="' +
              safe +
              '" title="Ver comprobante ampliado">' +
              escapeHtml(label) +
              '</button>'
            );
          })
          .join('') +
        '</' +
        wrapTag +
        '>'
      );
    }
    if (it.proof_missing) {
      return (
        '<span class="admin-recarga-proof-missing-text" title="El comprobante ya no está disponible en el servidor">Sin foto</span>'
      );
    }
    return '';
  }

  function renderProofBlock(it, thumbClass, wrapClass) {
    return renderProofLink(it, wrapClass);
  }

  function renderProofReviewField(it) {
    var link = renderProofLink(it, 'admin-recarga-proof-link-wrap');
    if (!link) return '';
    return (
      '<div class="admin-recarga-review-field admin-recarga-review-field--proof">' +
      link +
      '</div>'
    );
  }

  function renderProofNoteRow(it, noteHtml) {
    var proofs = renderProofBlock(it);
    var note = noteHtml || '';
    if (!proofs && !note) return '';
    return (
      '<div class="admin-recarga-proof-note-row">' + proofs + note + '</div>'
    );
  }

  function renderReviewedMetaRow(it, noteHtml) {
    var proof = renderProofLink(it, 'admin-recarga-meta-proof admin-recarga-meta-proof--inline');
    var note = noteHtml || '';
    var meta =
      '<p class="admin-recarga-meta">' +
      renderMetaDate(it.created_at) +
      ' · ' +
      escapeHtml(fmtAmount(it.amount_claimed, it.currency)) +
      ' · ' +
      (proof ? proof + ' · ' : '') +
      '<strong>' +
      escapeHtml(it.payment_method_label || '—') +
      '</strong>' +
      rechargeAccountMetaExtra(it) +
      '</p>';
    if (!note) {
      return '<div class="admin-recarga-meta-row">' + meta + '</div>';
    }
    return (
      '<div class="admin-recarga-meta-row">' +
      meta +
      '<div class="admin-recarga-meta-note">' +
      note +
      '</div>' +
      '</div>'
    );
  }

  var openAdminImageLightboxFn = null;

  function bindProofLightbox() {
    var lb = document.getElementById('adminRecargaProofLightbox');
    var lbImg = document.getElementById('adminRecargaProofLightboxImg');
    if (!lb || !lbImg) return;

    var proofLightboxReturnFocus = null;

    function releaseProofLightboxFocus() {
      var active = document.activeElement;
      if (active && lb.contains(active)) {
        if (typeof active.blur === 'function') active.blur();
      }
      if (proofLightboxReturnFocus && typeof proofLightboxReturnFocus.focus === 'function') {
        try {
          proofLightboxReturnFocus.focus({ preventScroll: true });
        } catch (err) {
          /* ignore */
        }
      }
      proofLightboxReturnFocus = null;
    }

    function closeProofLightbox() {
      releaseProofLightboxFocus();
      lb.hidden = true;
      lb.setAttribute('aria-hidden', 'true');
      lbImg.removeAttribute('src');
      document.body.classList.remove('balance-recharge-qr-lightbox-open');
    }

    function openProofLightbox(src, alt) {
      if (!src) return;
      lbImg.alt = alt || 'Comprobante de recarga ampliado';
      lbImg.src = src;
      proofLightboxReturnFocus = document.activeElement;
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

    openAdminImageLightboxFn = openProofLightbox;

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('.admin-recarga-proof-open');
      if (!btn || !root.contains(btn)) return;
      e.preventDefault();
      var src = btn.getAttribute('data-proof-url') || '';
      if (!src) {
        var img = btn.querySelector('img');
        src = img ? img.getAttribute('src') || '' : '';
      }
      openProofLightbox(src);
    });

    lb.querySelectorAll('[data-proof-lightbox-close]').forEach(function (el) {
      el.addEventListener('click', closeProofLightbox);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !lb.hidden) closeProofLightbox();
    });
  }

  function showMsg(el, text, isError, opts) {
    if (!el) return;
    opts = opts || {};
    el.textContent = text || '';
    el.classList.remove('text-success', 'text-danger');
    el.classList.add(isError ? 'text-danger' : 'text-success');
    var shouldScroll =
      opts.scroll === true ||
      (opts.scroll !== false && el.id !== 'adminPaymentMethodsMsg');
    if (text && shouldScroll) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        el.scrollIntoView(false);
      }
    }
  }

  function flashPmRowSaved(saveBtn) {
    var row = saveBtn && saveBtn.closest ? saveBtn.closest('.admin-pm-row') : null;
    if (!row) return;
    row.classList.add('admin-pm-row--saved');
    window.setTimeout(function () {
      row.classList.remove('admin-pm-row--saved');
    }, 2200);
  }

  /* ——— Tabs ——— */
  var TAB_STORAGE_KEY = 'admin_recargas_active_tab';
  var VALID_TABS = { review: true, auto: true, methods: true, accum: true };
  var tabs = root.querySelectorAll('.admin-recargas-tab');
  var panels = {
    review: document.getElementById('adminRecargasPanelReview'),
    auto: document.getElementById('adminRecargasPanelAuto'),
    methods: document.getElementById('adminRecargasPanelMethods'),
    accum: document.getElementById('adminRecargasPanelAccum'),
  };

  function normalizeTabKey(key) {
    return VALID_TABS[key] ? key : 'review';
  }

  function persistActiveTab(key) {
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, key);
    } catch (err) {}
    var wantHash = key === 'review' ? '' : '#' + key;
    var curHash = location.hash || '';
    if (wantHash === curHash) return;
    try {
      history.replaceState(null, '', location.pathname + location.search + wantHash);
    } catch (err2) {}
  }

  function getStoredTabKey() {
    var fromHash = (location.hash || '').replace(/^#/, '');
    if (VALID_TABS[fromHash]) return fromHash;
    try {
      var stored = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (VALID_TABS[stored]) return stored;
    } catch (err) {}
    return 'review';
  }

  function loadTabData(key) {
    if (key === 'methods' && !methodsLoaded) loadPaymentMethodsEditor();
    if (key === 'review') loadRecharges();
    if (key === 'auto') loadAutoRecharges();
    if (key === 'accum') {
      loadAccumRecharges();
      loadAccumSummary();
    }
  }

  function activateTab(key, opts) {
    opts = opts || {};
    key = normalizeTabKey(key);
    if (!opts.skipPersist) persistActiveTab(key);
    tabs.forEach(function (b) {
      var isActive = b.getAttribute('data-tab') === key;
      b.classList.toggle('admin-recargas-tab--active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (k) {
      if (panels[k]) panels[k].hidden = k !== key;
    });
    if (!opts.skipLoad) loadTabData(key);
  }

  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activateTab(btn.getAttribute('data-tab'));
    });
  });

  window.addEventListener('hashchange', function () {
    activateTab(getStoredTabKey(), { skipPersist: true });
  });

  var menuToggleReview = document.getElementById('menuToggleBtn');
  var menu2ToggleReview = document.getElementById('menu2ToggleBtn');
  var menuToggleMethods = document.getElementById('menuToggleBtnMethods');
  var menu2ToggleMethods = document.getElementById('menu2ToggleBtnMethods');
  var menuToggleAuto = document.getElementById('menuToggleBtnAuto');
  var menu2ToggleAuto = document.getElementById('menu2ToggleBtnAuto');
  var menuToggleAccum = document.getElementById('menuToggleBtnAccum');
  var menu2ToggleAccum = document.getElementById('menu2ToggleBtnAccum');
  if (menuToggleMethods && menuToggleReview) {
    menuToggleMethods.addEventListener('click', function () {
      menuToggleReview.click();
    });
  }
  if (menu2ToggleMethods && menu2ToggleReview) {
    menu2ToggleMethods.addEventListener('click', function () {
      menu2ToggleReview.click();
    });
  }
  if (menuToggleAuto && menuToggleReview) {
    menuToggleAuto.addEventListener('click', function () {
      menuToggleReview.click();
    });
  }
  if (menu2ToggleAuto && menu2ToggleReview) {
    menu2ToggleAuto.addEventListener('click', function () {
      menu2ToggleReview.click();
    });
  }
  if (menuToggleAccum && menuToggleReview) {
    menuToggleAccum.addEventListener('click', function () {
      menuToggleReview.click();
    });
  }
  if (menu2ToggleAccum && menu2ToggleReview) {
    menu2ToggleAccum.addEventListener('click', function () {
      menu2ToggleReview.click();
    });
  }

  /* ——— Revisión consignaciones ——— */
  var filterEl = document.getElementById('adminRecargasFilter');
  var listEl = document.getElementById('adminRecargasList');
  var pendingEl = document.getElementById('adminRecargasPendingCount');
  var accumFilterEl = document.getElementById('adminRecargasAccumFilter');
  var accumListEl = document.getElementById('adminRecargasAccumList');
  var accumMsg = document.getElementById('adminRecargasAccumMsg');
  var ACCUM_FILTER_LABELS = {
    pending: 'Pendientes',
    accumulated: 'Acumulados',
    rejected: 'Rechazadas',
    all: 'Todas',
  };

  function updateAccumFilterOptionLabels(counts) {
    if (!accumFilterEl) return;
    counts = counts || {};
    Object.keys(ACCUM_FILTER_LABELS).forEach(function (key) {
      var opt = accumFilterEl.querySelector('option[value="' + key + '"]');
      if (!opt) return;
      var n = Math.max(0, parseInt(counts[key], 10) || 0);
      opt.textContent = ACCUM_FILTER_LABELS[key] + ' (' + n + ')';
    });
  }

  function accumFilterCountsFromItems(items) {
    var tallies = { pending: 0, accumulated: 0, rejected: 0, all: 0 };
    (items || []).forEach(function (it) {
      if (!it.is_accumulator) return;
      tallies.all += 1;
      var st = (it.status || '').toLowerCase();
      if (st === 'pending') tallies.pending += 1;
      else if (st === 'accumulated') tallies.accumulated += 1;
      else if (st === 'rejected') tallies.rejected += 1;
    });
    return tallies;
  }

  function reviewUrl(id) {
    return reviewUrlBase + '/' + id + '/review';
  }

  function needsAutoReview(it) {
    return (
      (it.status || '').toLowerCase() === 'auto_credited' &&
      (it.admin_verified === null || it.admin_verified === undefined)
    );
  }

  function renderRechargeCard(it) {
    var proofs = '';
    var amountFieldId = 'admin-recarga-amount-' + it.id;
    var noteFieldId = 'admin-recarga-note-' + it.id;
    var actions = '';

    if (needsAutoReview(it)) {
      var credited = it.amount_credited != null ? it.amount_credited : it.amount_claimed;
      var analyzerHtml =
        typeof renderAnalyzerBlock === 'function' ? renderAnalyzerBlock(it.analyzer) : '';
      var emailVerifyHtml =
        typeof renderEmailVerifyBlock === 'function' ? renderEmailVerifyBlock(it.id) : '';
      actions =
        typeof renderAutoReviewActions === 'function' ? renderAutoReviewActions(it) : '';
      return (
        '<article class="admin-recarga-card admin-recarga-card--auto_credited">' +
        '<div class="admin-recarga-card-head">' +
        '<span class="admin-recarga-user">' +
        escapeHtml(it.username || '—') +
        '</span>' +
        '<span class="admin-recarga-status admin-recarga-status--pending">' +
        escapeHtml(it.status_label || 'Pendiente verificación') +
        '</span></div>' +
        '<p class="admin-recarga-meta">' +
        renderMetaDate(it.created_at) +
        ' · Acreditado: <strong>' +
        escapeHtml(fmtAmount(credited, it.currency)) +
        '</strong> · ' +
        escapeHtml(it.payment_method_label || '—') +
        rechargeAccountMetaExtra(it) +
        '</p>' +
        (analyzerHtml
          ? '<div class="admin-recarga-analyzer">' + analyzerHtml + '</div>'
          : '') +
        emailVerifyHtml +
        actions +
        '</article>'
      );
    }

    if (it.status === 'pending') {
      var amountAria = it.is_accumulator ? 'Monto a acumular' : 'Monto a acreditar';
      var approveLabel = it.is_accumulator ? 'Aprobar' : 'Aprobar y acreditar';
      actions =
        '<div class="admin-recarga-actions">' +
        '<div class="admin-recarga-review-fields">' +
        renderProofReviewField(it) +
        '<div class="admin-recarga-review-field admin-recarga-review-field--amount">' +
        '<input type="number" id="' +
        amountFieldId +
        '" name="amount_credited" class="form-control admin-recarga-amount-input" data-id="' +
        it.id +
        '" value="' +
        (it.amount_claimed != null ? it.amount_claimed : '') +
        '" min="1" step="1" inputmode="numeric" autocomplete="off" aria-label="' +
        escapeHtml(amountAria) +
        '">' +
        '</div>' +
        '<div class="admin-recarga-review-field admin-recarga-review-field--note">' +
        '<input type="text" id="' +
        noteFieldId +
        '" name="admin_note" class="form-control admin-recarga-note-input" data-id="' +
        it.id +
        '" maxlength="500" placeholder="Nota admin (opcional)" aria-label="Nota admin (opcional)" autocomplete="off">' +
        '</div>' +
        '<div class="admin-recarga-review-field admin-recarga-review-field--buttons">' +
        '<div class="admin-recarga-review-btns">' +
        '<button type="button" class="btn-panel btn-green btn-sm admin-recarga-approve" data-id="' +
        it.id +
        '" data-is-accumulator="' +
        (it.is_accumulator ? '1' : '0') +
        '">' +
        approveLabel +
        '</button>' +
        '<button type="button" class="btn-panel btn-red btn-sm admin-recarga-reject" data-id="' +
        it.id +
        '">Rechazar</button>' +
        '</div></div>' +
        '</div></div>';
    } else if (it.status === 'accumulated') {
      actions =
        '<div class="admin-recarga-actions">' +
        '<p class="admin-recarga-accum-hint text-muted">Este pago está en el acumulador. Conviértelo desde la sección Acumulador.</p>' +
        '<div class="admin-recarga-review-fields">' +
        renderProofReviewField(it) +
        '<div class="admin-recarga-review-field admin-recarga-review-field--note admin-recarga-review-field--full">' +
        '<input type="text" id="' +
        noteFieldId +
        '" name="admin_note" class="form-control admin-recarga-note-input" data-id="' +
        it.id +
        '" maxlength="500" placeholder="Nota admin (opcional)" aria-label="Nota admin (opcional)" autocomplete="off">' +
        '</div>' +
        '<div class="admin-recarga-review-field admin-recarga-review-field--buttons">' +
        '<div class="admin-recarga-review-btns">' +
        '<button type="button" class="btn-panel btn-red btn-sm admin-recarga-reject" data-id="' +
        it.id +
        '">Rechazar acumulación</button>' +
        '</div></div></div></div>';
    }

    var reviewedNoteHtml = '';
    if (it.status !== 'pending' && it.status !== 'accumulated') {
      reviewedNoteHtml = it.admin_note
        ? '<p class="admin-recarga-reviewed-note"><strong>Nota:</strong> ' +
          escapeHtml(it.admin_note) +
          '</p>'
        : '';
    }

    var metaHtml;
    if (it.status === 'pending' || it.status === 'accumulated') {
      metaHtml =
        '<p class="admin-recarga-meta">' +
        renderMetaDate(it.created_at) +
        ' · ' +
        escapeHtml(fmtAmount(it.amount_claimed, it.currency)) +
        ' · <strong>' +
        escapeHtml(it.payment_method_label || '—') +
        '</strong>' +
        rechargeAccountMetaExtra(it) +
        '</p>';
    } else {
      metaHtml = renderReviewedMetaRow(it, reviewedNoteHtml);
    }

    return (
      '<article class="admin-recarga-card admin-recarga-card--' +
      escapeHtml(it.status) +
      '">' +
      '<div class="admin-recarga-card-head">' +
      '<span class="admin-recarga-user">' +
      escapeHtml(it.username || '—') +
      '</span>' +
      '<span class="admin-recarga-status ' +
      adminRecargaStatusClass(it.status, it) +
      '">' +
      escapeHtml(it.status_label) +
      '</span>' +
      '</div>' +
      metaHtml +
      actions +
      '</article>'
    );
  }

  function loadRecharges() {
    if (!listEl) return;
    var st = filterEl ? filterEl.value : 'pending';
    listEl.innerHTML = '<p class="text-muted">Cargando…</p>';
    fetch(
      listUrl + '?status=' + encodeURIComponent(st) + '&accumulator=exclude',
      { credentials: 'same-origin' }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          listEl.innerHTML = '<p class="text-danger">Error al cargar.</p>';
          return;
        }
        if (pendingEl) {
          pendingEl.textContent = String(
            data.review_pending_count != null ? data.review_pending_count : data.pending_count || 0
          );
        }
        var items = data.items || [];
        items.forEach(function (it) {
          if (it && it.id && it.email_verify && typeof emailVerifyCache === 'object') {
            emailVerifyCache[String(it.id)] = it.email_verify;
          }
        });
        if (!items.length) {
          listEl.innerHTML = '<p class="text-muted">No hay solicitudes en este filtro.</p>';
          return;
        }
        listEl.innerHTML = items.map(renderRechargeCard).join('');
      })
      .catch(function () {
        listEl.innerHTML = '<p class="text-danger">Error de red.</p>';
      });
  }

  function loadAccumRecharges() {
    if (!accumListEl) return;
    var st = accumFilterEl ? accumFilterEl.value : 'all';
    accumListEl.innerHTML = '<p class="text-muted">Cargando…</p>';
    fetch(
      listUrl + '?status=' + encodeURIComponent(st) + '&accumulator=only',
      { credentials: 'same-origin' }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          accumListEl.innerHTML = '<p class="text-danger">Error al cargar.</p>';
          updateAccumFilterOptionLabels({
            pending: 0,
            accumulated: 0,
            rejected: 0,
            all: 0,
          });
          return;
        }
        if (pendingEl && data.pending_count != null) {
          pendingEl.textContent = String(data.pending_count || 0);
        }
        var accumItems = (data.items || []).filter(function (it) {
          return it.is_accumulator;
        });
        var accumCounts = data.accum_filter_counts;
        if (!accumCounts) {
          accumCounts = accumFilterCountsFromItems(accumItems);
          if (data.accum_pending_count != null) {
            accumCounts.pending = data.accum_pending_count;
          }
        }
        updateAccumFilterOptionLabels(accumCounts);
        var items = accumItems;
        if (!items.length) {
          accumListEl.innerHTML = '<p class="text-muted">No hay solicitudes del acumulador en este filtro.</p>';
          return;
        }
        accumListEl.innerHTML = items.map(renderRechargeCard).join('');
      })
      .catch(function () {
        accumListEl.innerHTML = '<p class="text-danger">Error de red.</p>';
        updateAccumFilterOptionLabels({
          pending: 0,
          accumulated: 0,
          rejected: 0,
          all: 0,
        });
      });
  }

  function doReview(id, action) {
    var amountInp = document.querySelector('.admin-recarga-amount-input[data-id="' + id + '"]');
    var noteInp = document.querySelector('.admin-recarga-note-input[data-id="' + id + '"]');
    var body = { action: action, admin_note: noteInp ? noteInp.value.trim() : '' };
    if (action === 'approve' && amountInp) {
      body.amount_approved = amountInp.value;
    }
    return fetch(reviewUrl(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          alert(data.message || 'No se pudo completar.');
          return;
        }
        loadRecharges();
        loadAccumRecharges();
        if (typeof loadAccumSummary === 'function') loadAccumSummary();
      });
  }

  function handleReviewListClick(e) {
    var verifyBtn = e.target.closest('.admin-recarga-email-verify-btn');
    if (verifyBtn) {
      var vid = parseInt(verifyBtn.getAttribute('data-id'), 10);
      if (vid && typeof verifyEmailForRecharge === 'function') {
        verifyEmailForRecharge(vid);
      }
      return;
    }
    var confirmBtn = e.target.closest('.admin-recarga-confirm-auto');
    if (confirmBtn) {
      var cid = parseInt(confirmBtn.getAttribute('data-id'), 10);
      if (!window.confirm('¿Confirmar que el comprobante es correcto?')) return;
      doAutoReview(cid, 'confirm_auto');
      return;
    }
    var rejectAutoBtn = e.target.closest('.admin-recarga-reject-auto');
    if (rejectAutoBtn) {
      var rid = parseInt(rejectAutoBtn.getAttribute('data-id'), 10);
      if (!window.confirm('¿Rechazar y descontar el saldo acreditado?')) return;
      doAutoReview(rid, 'reject_auto');
      return;
    }
    var appr = e.target.closest('.admin-recarga-approve');
    var rej = e.target.closest('.admin-recarga-reject');
    if (appr) {
      var id = parseInt(appr.getAttribute('data-id'), 10);
      var isAccum = appr.getAttribute('data-is-accumulator') === '1';
        var confirmMsg = isAccum
          ? '¿Aprobar y acumular este pago? Luego podrás convertirlo a saldo en la tabla de arriba.'
          : '¿Aprobar y acreditar saldo al usuario?';
      if (!window.confirm(confirmMsg)) return;
      doReview(id, 'approve');
    }
    if (rej) {
      var id2 = parseInt(rej.getAttribute('data-id'), 10);
      if (!window.confirm('¿Rechazar esta solicitud?')) return;
      doReview(id2, 'reject');
    }
  }

  if (listEl) {
    listEl.addEventListener('click', handleReviewListClick);
  }
  if (accumListEl) {
    accumListEl.addEventListener('click', handleReviewListClick);
  }
  document.getElementById('adminRecargasRefresh')?.addEventListener('click', loadRecharges);
  filterEl?.addEventListener('change', loadRecharges);
  document.getElementById('adminRecargasAccumRefresh')?.addEventListener('click', loadAccumRecharges);
  accumFilterEl?.addEventListener('change', loadAccumRecharges);

  /* ——— Recargas acreditadas ——— */
  var autoListEl = document.getElementById('adminRecargasAutoList');
  var autoPendingEl = document.getElementById('adminRecargasAutoPendingCount');
  var emailVerifyUrlBase = (root.dataset.emailVerifyUrlBase || '').replace(/\/0\/email-verify$/, '');
  var emailVerifyBatchUrl = root.dataset.emailVerifyBatchUrl || '';
  var emailVerifyCache = {};
  var autoRechargeItems = [];

  function emailVerifyUrl(id) {
    return emailVerifyUrlBase + '/' + id + '/email-verify';
  }

  function rechargeAccountMetaExtra(it) {
    if (it && it.account_suffix_masked) {
      return ' · <strong>Cuenta:</strong> ' + escapeHtml(it.account_suffix_masked);
    }
    var ev = (it && emailVerifyCache[String(it.id)]) || (it && it.email_verify);
    var suffixes = [];
    if (ev && ev.email && ev.email.account_suffixes && ev.email.account_suffixes.length) {
      suffixes = ev.email.account_suffixes;
    } else if (it && it.analyzer) {
      if (it.analyzer.account_suffixes_detected && it.analyzer.account_suffixes_detected.length) {
        suffixes = it.analyzer.account_suffixes_detected;
      } else if (it.analyzer.account_expected_digits) {
        var digits = String(it.analyzer.account_expected_digits).replace(/\D/g, '');
        if (digits.length >= 4) suffixes = [digits.slice(-4)];
      }
    }
    if (!suffixes.length) return '';
    var masked = suffixes
      .map(function (s) {
        var d = String(s).replace(/\D/g, '');
        return d.length >= 4 ? '****' + d.slice(-4) : '****' + d;
      })
      .join(', ');
    return ' · <strong>Cuenta:</strong> ' + escapeHtml(masked);
  }

  function renderEmailVerifyLines(rechargeId) {
    var ev = emailVerifyCache[String(rechargeId)] || null;
    if (!ev) return '';

    var lines = '<p class="admin-recarga-analyzer-meta mb-05">' + escapeHtml(ev.message || '—') + '</p>';
    if (ev.email) {
      if (ev.email.receipt_numbers && ev.email.receipt_numbers.length) {
        lines +=
          '<p class="admin-recarga-analyzer-meta mb-0"><strong>Comprobante en correo:</strong> ' +
          escapeHtml(ev.email.receipt_numbers.join(', ')) +
          '</p>';
      }
    }

    if (ev.account_match === false) {
      var acctMsg =
        ev.message && /llave\s+bre-?b/i.test(ev.message)
          ? ev.message
          : 'Cuenta o llave Bre-B no coincide; aprobación manual.';
      lines +=
        '<p class="admin-recarga-analyzer-meta mb-0 text-danger"><strong>Verificación:</strong> ' +
        escapeHtml(acctMsg) +
        '</p>';
    }

    return lines;
  }

  function renderEmailVerifyBlock(rechargeId) {
    var lines = renderEmailVerifyLines(rechargeId);
    if (!lines) return '';
    return '<div class="admin-recarga-email-verify">' + lines + '</div>';
  }

  function renderEmailVerifyButton(rechargeId) {
    return (
      '<button type="button" class="btn-panel btn-purple btn-sm admin-recarga-email-verify-btn" data-id="' +
      rechargeId +
      '"><i class="fas fa-envelope" aria-hidden="true"></i> Reverificar correo</button>'
    );
  }

  function refreshAutoRechargeCards() {
    if (!autoListEl) return;
    if (!autoRechargeItems.length) {
      autoListEl.innerHTML = '<p class="text-muted">No hay recargas automáticas pendientes de verificar.</p>';
      return;
    }
    autoListEl.innerHTML = autoRechargeItems.map(renderAutoRechargeCard).join('');
  }

  function applyEmailVerifyResults(results) {
    if (!results || typeof results !== 'object') return;
    Object.keys(results).forEach(function (key) {
      emailVerifyCache[key] = results[key];
    });
    refreshAutoRechargeCards();
  }

  function verifyEmailForRecharge(id) {
    if (!emailVerifyUrlBase) return Promise.resolve();
    var btn = autoListEl && autoListEl.querySelector('.admin-recarga-email-verify-btn[data-id="' + id + '"]');
    if (btn) btn.disabled = true;
    return fetch(emailVerifyUrl(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo verificar.');
        if (data.email_verify) {
          emailVerifyCache[String(id)] = data.email_verify;
          refreshAutoRechargeCards();
        }
        return data;
      })
      .catch(function (err) {
        alert(err.message || 'Error al verificar correo.');
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function verifyAllEmails() {
    if (!emailVerifyBatchUrl) return Promise.resolve();
    var btn = document.getElementById('adminRecargasEmailVerifyAll');
    if (btn) btn.disabled = true;
    return fetch(emailVerifyBatchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo verificar.');
        applyEmailVerifyResults(data.results || {});
        return data;
      })
      .catch(function (err) {
        alert(err.message || 'Error al verificar correos.');
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function formatTimeTextNoSeconds(text) {
    if (!text) return text;
    return String(text).replace(/(\d{1,2}:\d{2}):\d{2}(\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|AM|PM))?/gi, '$1$2');
  }

  function renderAnalyzerBlock(analyzer) {
    if (!analyzer) {
      return '<p class="admin-recarga-analyzer-note text-muted">Sin datos del analizador.</p>';
    }

    var warnBadges = [];
    if (analyzer.amount_matches_claimed === false) {
      warnBadges.push('Monto no coincide');
    }
    if (analyzer.date_matches_upload === false) {
      warnBadges.push('Fecha distinta');
    }
    if (analyzer.account_matches_configured === false) {
      warnBadges.push('Cuenta no coincide');
    }
    if (analyzer.bre_b_llave_matches_configured === false) {
      warnBadges.push('Llave Bre-B no coincide');
    }
    if (analyzer.ocr_available === false) {
      warnBadges.push('OCR no disponible');
    }

    var badgesHtml = '';
    if (warnBadges.length) {
      badgesHtml =
        '<div class="admin-recarga-analyzer-badges">' +
        warnBadges
          .map(function (label) {
            return (
              '<span class="admin-recarga-analyzer-badge admin-recarga-analyzer-badge--warn">' +
              escapeHtml(label) +
              '</span>'
            );
          })
          .join('') +
        '</div>';
    }

    var receiptLine = '';
    var hasReceipt =
      analyzer.receipt_number || analyzer.receipt_number === 0;
    var hasReceiptDate =
      analyzer.receipt_datetime_display ||
      analyzer.receipt_date_raw ||
      analyzer.receipt_date_parsed;
    var hasReceiptTime =
      analyzer.receipt_time_display ||
      analyzer.receipt_time_raw ||
      analyzer.receipt_time_parsed;
    if (hasReceipt || hasReceiptDate || hasReceiptTime) {
      var whenText = formatTimeTextNoSeconds(analyzer.receipt_datetime_display);
      if (!whenText) {
        whenText = analyzer.receipt_date_raw || analyzer.receipt_date_parsed || '';
        if (whenText && hasReceiptTime) {
          whenText +=
            ' · ' +
            formatTimeTextNoSeconds(
              analyzer.receipt_time_display ||
                analyzer.receipt_time_raw ||
                analyzer.receipt_time_parsed
            );
        } else if (!whenText && hasReceiptTime) {
          whenText = formatTimeTextNoSeconds(
            analyzer.receipt_time_display ||
              analyzer.receipt_time_raw ||
              analyzer.receipt_time_parsed
          );
        }
      }
      receiptLine =
        '<p class="admin-recarga-analyzer-meta">' +
        (hasReceipt
          ? '<strong>Comprobante:</strong> ' +
            escapeHtml(String(analyzer.receipt_number))
          : '') +
        (hasReceipt && whenText ? ' · ' : '') +
        (whenText
          ? '<strong>Fecha y hora comprobante:</strong> ' + escapeHtml(String(whenText))
          : '') +
        '</p>';
    }

    var detailLines = '';
    if (analyzer.account_matches_configured === false) {
      if (analyzer.account_expected_digits) {
        detailLines +=
          '<p class="admin-recarga-analyzer-meta"><strong>Cuenta configurada:</strong> ' +
          escapeHtml(String(analyzer.account_expected_digits)) +
          '</p>';
      }
      if (analyzer.account_numbers_detected && analyzer.account_numbers_detected.length) {
        detailLines +=
          '<p class="admin-recarga-analyzer-meta"><strong>Cuenta detectada:</strong> ' +
          escapeHtml(analyzer.account_numbers_detected.join(', ')) +
          '</p>';
      }
    }
    if (
      analyzer.amount_matches_claimed === false &&
      analyzer.amounts_detected &&
      analyzer.amounts_detected.length
    ) {
      detailLines +=
        '<p class="admin-recarga-analyzer-meta"><strong>Montos detectados:</strong> ' +
        analyzer.amounts_detected
          .map(function (n) {
            return '$' + Number(n).toLocaleString('es-CO');
          })
          .join(', ') +
        '</p>';
    }

    if (!badgesHtml && !receiptLine && !detailLines) {
      return '';
    }

    return badgesHtml + receiptLine + detailLines;
  }

  function renderAutoReviewActions(it) {
    var noteFieldId = 'admin-recarga-auto-note-' + it.id;
    return (
      '<div class="admin-recarga-actions">' +
      '<div class="admin-recarga-review-fields admin-recarga-review-fields--auto">' +
      renderProofReviewField(it) +
      '<div class="admin-recarga-review-field admin-recarga-review-field--email-btn">' +
      renderEmailVerifyButton(it.id) +
      '</div>' +
      '<div class="admin-recarga-review-field admin-recarga-review-field--note">' +
      '<input type="text" id="' +
      noteFieldId +
      '" name="admin_note" class="form-control admin-recarga-auto-note-input" data-id="' +
      it.id +
      '" maxlength="500" placeholder="Nota admin (opcional)" aria-label="Nota admin (opcional)" autocomplete="off">' +
      '</div>' +
      '<div class="admin-recarga-review-field admin-recarga-review-field--buttons">' +
      '<div class="admin-recarga-review-btns">' +
      '<button type="button" class="btn-panel btn-green btn-sm admin-recarga-confirm-auto" data-id="' +
      it.id +
      '">Confirmar comprobante</button>' +
      '<button type="button" class="btn-panel btn-red btn-sm admin-recarga-reject-auto" data-id="' +
      it.id +
      '">Rechazar y revertir saldo</button>' +
      '</div></div></div></div>'
    );
  }

  function renderAutoRechargeCard(it) {
    var credited = it.amount_credited != null ? it.amount_credited : it.amount_claimed;
    var analyzerHtml = renderAnalyzerBlock(it.analyzer);
    var emailVerifyHtml = renderEmailVerifyBlock(it.id);

    return (
      '<article class="admin-recarga-card admin-recarga-card--auto_credited">' +
      '<div class="admin-recarga-card-head">' +
      '<span class="admin-recarga-user">' +
      escapeHtml(it.username || '—') +
      '</span>' +
      '<span class="admin-recarga-status ' +
      adminRecargaStatusClass(it.status, it) +
      '">' +
      escapeHtml(it.status_label || 'Pendiente verificación') +
      '</span>' +
      '</div>' +
      '<p class="admin-recarga-meta">' +
      renderMetaDate(it.created_at) +
      ' · Acreditado: <strong>' +
      escapeHtml(fmtAmount(credited, it.currency)) +
      '</strong> · ' +
      escapeHtml(it.payment_method_label || '—') +
      rechargeAccountMetaExtra(it) +
      '</p>' +
      (analyzerHtml
        ? '<div class="admin-recarga-analyzer">' + analyzerHtml + '</div>'
        : '') +
      emailVerifyHtml +
      renderAutoReviewActions(it) +
      '</article>'
    );
  }

  function loadAutoRecharges() {
    if (!autoListEl) return;
    autoListEl.innerHTML = '<p class="text-muted">Cargando…</p>';
    fetch(listUrl + '?status=auto_pending', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          autoListEl.innerHTML = '<p class="text-danger">Error al cargar.</p>';
          return;
        }
        if (autoPendingEl) autoPendingEl.textContent = String(data.auto_pending_count || 0);
        autoRechargeItems = data.items || [];
        emailVerifyCache = {};
        autoRechargeItems.forEach(function (it) {
          if (it && it.id && it.email_verify) {
            emailVerifyCache[String(it.id)] = it.email_verify;
          }
        });
        if (!autoRechargeItems.length) {
          autoListEl.innerHTML = '<p class="text-muted">No hay recargas automáticas pendientes de verificar.</p>';
          return;
        }
        refreshAutoRechargeCards();
      })
      .catch(function () {
        autoListEl.innerHTML = '<p class="text-danger">Error de red.</p>';
      });
  }

  function doAutoReview(id, action) {
    var noteInp = document.querySelector(
      '.admin-recarga-auto-note-input[data-id="' + id + '"]'
    );
    var body = { action: action, admin_note: noteInp ? noteInp.value.trim() : '' };
    return fetch(reviewUrl(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          alert(data.message || 'No se pudo completar.');
          return;
        }
        loadAutoRecharges();
        loadRecharges();
      });
  }

  if (autoListEl) {
    autoListEl.addEventListener('click', function (e) {
      var verifyBtn = e.target.closest('.admin-recarga-email-verify-btn');
      if (verifyBtn) {
        var vid = parseInt(verifyBtn.getAttribute('data-id'), 10);
        if (vid) verifyEmailForRecharge(vid);
        return;
      }
      var confirmBtn = e.target.closest('.admin-recarga-confirm-auto');
      var rejectBtn = e.target.closest('.admin-recarga-reject-auto');
      if (confirmBtn) {
        var id = parseInt(confirmBtn.getAttribute('data-id'), 10);
        if (!window.confirm('¿Confirmar que el comprobante es correcto?')) return;
        doAutoReview(id, 'confirm_auto');
      }
      if (rejectBtn) {
        var id2 = parseInt(rejectBtn.getAttribute('data-id'), 10);
        if (!window.confirm('¿Rechazar y descontar el saldo acreditado?')) return;
        doAutoReview(id2, 'reject_auto');
      }
    });
  }
  document.getElementById('adminRecargasAutoRefresh')?.addEventListener('click', loadAutoRecharges);
  document.getElementById('adminRecargasEmailVerifyAll')?.addEventListener('click', verifyAllEmails);

  /* ——— Medios de pago ——— */
  var PM_BUCKETS = ['COP', 'USD', 'ACCUM'];
  var PM_WRAP_SELECTORS = {
    COP: '.admin-recargas-pm-cop-wrap',
    USD: '.admin-recargas-pm-usd-wrap',
    ACCUM: '.admin-recargas-pm-accum-wrap',
  };
  var methodsPanel = document.getElementById('adminRecargasPanelMethods');
  var methodsMsg = document.getElementById('adminPaymentMethodsMsg');
  var methodsLoaded = false;
  var methodsData = { COP: [], USD: [], ACCUM: [] };
  var PAYMENT_BRANDS = [
    { value: 'nequi', label: 'Nequi' },
    { value: 'bancolombia', label: 'Bancolombia' },
    { value: 'daviplata', label: 'DaviPlata' },
    { value: 'breve', label: 'Bre-B' },
    { value: 'breb_bancolombia', label: 'Bre-B Bancolombia' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'usdt', label: 'USDT' },
    { value: 'binance_pay', label: 'Binance Pay' },
    { value: 'binance', label: 'Binance' },
    { value: 'criptomoneda', label: 'Criptomoneda' },
    { value: 'generico', label: 'Genérico' },
  ];
  var paymentBrandChoicesFromApi = null;
  var pmModal = document.getElementById('adminPmUsersModal');
  var pmModalTitle = document.getElementById('adminPmUsersModalTitle');
  var pmModalTitleText = document.getElementById('adminPmUsersModalTitleText');
  var pmModalUsersInfoBtn = document.getElementById('adminPmUsersModalInfoBtn');
  var pmModalUsersInfoBox = document.getElementById('adminPmUsersModalInfoBox');
  var pmModalFilter = document.getElementById('adminPmUsersFilter');
  var pmModalTableBody = document.getElementById('adminPmUsersTableBody');
  var pmSelectAllVisible = document.getElementById('adminPmUsersSelectAllVisible');
  var pmSelectAllBtn = document.getElementById('adminPmUsersSelectAllBtn');
  var pmDeselectAllBtn = document.getElementById('adminPmUsersDeselectAllBtn');
  var pmModalTarget = null;
  var pmModalAllUsers = [];
  var pmModalFilterDebounce = null;

  function resolveAccumMultipliers(m) {
    var multUsdCop =
      m.mult_usd_to_cop != null && m.mult_usd_to_cop !== '' ? String(m.mult_usd_to_cop) : '';
    var multCopUsd =
      m.mult_cop_to_usd != null && m.mult_cop_to_usd !== '' ? String(m.mult_cop_to_usd) : '';
    if (!multUsdCop && m.exchange_rate != null && m.exchange_rate !== '') {
      multUsdCop = String(m.exchange_rate);
    }
    if (!multCopUsd && m.exchange_rate != null && m.exchange_rate !== '') {
      var ex = Number(String(m.exchange_rate).replace(',', '.'));
      if (ex > 0) {
        var factor = 1;
        if (m.conversion_percent != null && m.conversion_percent !== '') {
          factor = Number(String(m.conversion_percent).replace(',', '.')) / 100;
          if (!(factor > 0)) factor = 1;
        }
        multCopUsd = String(factor / ex);
      }
    }
    return { mult_usd_to_cop: multUsdCop, mult_cop_to_usd: multCopUsd };
  }

  function paymentBrandOptions() {
    if (paymentBrandChoicesFromApi && paymentBrandChoicesFromApi.length) {
      return paymentBrandChoicesFromApi;
    }
    return PAYMENT_BRANDS;
  }

  function normBrandText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function inferPaymentBrand(m) {
    m = m || {};
    var pb = String(m.payment_brand || '').trim().toLowerCase();
    if (pb) return pb;
    var linked = m.linked_brands;
    if (Array.isArray(linked) && linked.length) {
      var lb = String(linked[0] || '').trim().toLowerCase();
      if (lb) return lb;
    }
    var combined = normBrandText((m.id || '') + ' ' + (m.label || ''));
    if (!combined) return '';
    if (combined.indexOf('generico') >= 0 || combined.indexOf('generica') >= 0) {
      return 'generico';
    }
    if (
      (combined.indexOf('bre b') >= 0 || combined.indexOf('bre-b') >= 0) &&
      combined.indexOf('bancolombia') >= 0
    ) {
      return 'breb_bancolombia';
    }
    if (combined.indexOf('binance pay') >= 0 || combined.indexOf('binancepay') >= 0) {
      return 'binance_pay';
    }
    var i;
    for (i = 0; i < PAYMENT_BRANDS.length; i++) {
      var opt = PAYMENT_BRANDS[i];
      var key = opt.value;
      var name = normBrandText(opt.label);
      if (key === 'generico' || key === 'criptomoneda') {
        if (key === 'criptomoneda' && (combined.indexOf('criptomoneda') >= 0 || combined.indexOf('crypto') >= 0)) {
          return key;
        }
        continue;
      }
      if (
        key === 'binance' &&
        (combined.indexOf('binance pay') >= 0 || combined.indexOf('binancepay') >= 0)
      ) {
        continue;
      }
      if (combined.indexOf(key) >= 0 || (name && combined.indexOf(name) >= 0)) return key;
      if (
        key === 'breb_bancolombia' &&
        (combined.indexOf('bre b') >= 0 || combined.indexOf('bre-b') >= 0) &&
        combined.indexOf('bancolombia') >= 0
      ) {
        return key;
      }
      if (key === 'breve' && (combined.indexOf('bre b') >= 0 || combined.indexOf('bre-b') >= 0)) {
        return key;
      }
      if (key === 'binance' && combined.indexOf('binanse') >= 0) return key;
    }
    return '';
  }

  function defaultLabelForBrand(brand, cur) {
    brand = String(brand || '').trim().toLowerCase();
    if (!brand) return '';
    var i;
    var base = '';
    for (i = 0; i < PAYMENT_BRANDS.length; i++) {
      if (PAYMENT_BRANDS[i].value === brand) {
        base = PAYMENT_BRANDS[i].label;
        break;
      }
    }
    if (!base) return '';
    if (cur === 'ACCUM') {
      var low = base.toLowerCase();
      if (low.indexOf('acumulador ') === 0) return base;
      return 'Acumulador ' + base;
    }
    return base;
  }

  function ensureLabelFromBrand(m, cur) {
    m = m || {};
    if ((m.label || '').trim()) return m;
    var brand = inferPaymentBrand(m);
    if (!brand) return m;
    m.label = defaultLabelForBrand(brand, cur);
    m.payment_brand = brand;
    return m;
  }

  function brandSelectHtml(cur, m, idx) {
    var fieldBrand = pmFieldId(cur, idx, 'brand');
    var selected = inferPaymentBrand(m);
    var opts = ['<option value="">— Medio —</option>'];
    paymentBrandOptions().forEach(function (opt) {
      opts.push(
        '<option value="' +
          escapeHtml(opt.value) +
          '"' +
          (selected === opt.value ? ' selected' : '') +
          '>' +
          escapeHtml(opt.label) +
          '</option>'
      );
    });
    return (
      '<label class="admin-pm-field-label admin-pm-field-label--brand" for="' +
      fieldBrand +
      '">' +
      '<span class="sr-only">Medio de pago</span>' +
      '<select id="' +
      fieldBrand +
      '" name="pm_brand_' +
      cur +
      '_' +
      idx +
      '" class="form-control admin-pm-brand" data-prev-brand="' +
      escapeHtml(selected) +
      '" title="Medio para identificar comprobantes">' +
      opts.join('') +
      '</select></label>'
    );
  }

  function applyBrandSelectionToRow(row, cur, forceLabel) {
    if (!row) return;
    var brandEl = row.querySelector('.admin-pm-brand');
    var labelEl = row.querySelector('.admin-pm-label');
    if (!brandEl || !labelEl) return;
    var brand = String(brandEl.value || '').trim().toLowerCase();
    if (!brand) return;
    var prevBrand = String(brandEl.dataset.prevBrand || '').trim().toLowerCase();
    var prevDefault = prevBrand ? defaultLabelForBrand(prevBrand, cur) : '';
    var current = String(labelEl.value || '').trim();
    if (forceLabel || !current || current === prevDefault) {
      labelEl.value = defaultLabelForBrand(brand, cur);
    }
    brandEl.dataset.prevBrand = brand;
  }

  function normalizeMethodEntry(m) {
    var ids = null;
    if (Array.isArray(m.allowed_user_ids)) {
      ids = m.allowed_user_ids
        .map(function (id) {
          return normalizeUserId(id);
        })
        .filter(function (id) {
          return id > 0;
        });
    }
    var users = Array.isArray(m.allowed_users) ? m.allowed_users.slice() : [];
    if (!users.length && ids && ids.length) {
      users = ids.map(function (id) {
        return { id: id, username: String(id) };
      });
    }
    var accountNumber = m.account_number || '';
    var description = m.description || '';
    if (!accountNumber && !description && m.details) {
      var legacy = String(m.details || '').trim();
      var legacyDigits = legacy.replace(/\D/g, '');
      var legacyCompact = legacy.replace(/\s+/g, '');
      if (legacyDigits && (legacyDigits === legacyCompact || legacyDigits.length >= Math.max(4, legacyCompact.length * 0.5))) {
        accountNumber = legacyDigits.slice(0, 32);
      } else {
        description = legacy;
      }
    }
    var mults = resolveAccumMultipliers(m);
    var paymentBrand = inferPaymentBrand(m);
    var entry = {
      id: m.id || '',
      enabled: m.enabled !== false,
      payment_brand: paymentBrand,
      label: m.label || '',
      account_number: accountNumber,
      description: description,
      bre_b_llave: m.bre_b_llave || '',
      bre_b_account_suffix: m.bre_b_account_suffix || '',
      payment_currency: normalizeAccumPayCurrency(m.payment_currency || 'COP'),
      mult_usd_to_cop: mults.mult_usd_to_cop,
      mult_cop_to_usd: mults.mult_cop_to_usd,
      allowed_user_ids: ids,
      allowed_users: users,
      qr_filename: m.qr_filename || '',
      qr_url: m.qr_url || '',
      qr_base64: m.qr_base64 || '',
      qr_remove: !!m.qr_remove,
      qr_preview: m.qr_preview || '',
    };
    return normalizeBrebMethodFields(entry);
  }

  function pmUsersButtonLabel(m, cur, idx) {
    m = m || {};
    var rowEl = null;
    if (cur && idx != null && !isNaN(idx)) {
      rowEl = document.querySelector(
        '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
      );
    }
    var ids = resolvedAllowedUserIds(m, rowEl);
    if (ids === null) return 'Usuarios (todos)';
    var count = Array.isArray(ids) ? ids.length : 0;
    return 'Usuarios (' + count + ')';
  }

  function syncPmUsersButton(rowOrCur, idxOrM, maybeIdx) {
    var row;
    var cur;
    var idx;
    var m;
    if (rowOrCur && rowOrCur.querySelector) {
      row = rowOrCur;
      cur = row.getAttribute('data-currency');
      idx = parseInt(row.getAttribute('data-idx'), 10);
      m = methodsData[cur] && methodsData[cur][idx];
    } else {
      cur = rowOrCur;
      idx = idxOrM;
      m = maybeIdx !== undefined ? maybeIdx : methodsData[cur] && methodsData[cur][idx];
      row = document.querySelector(
        '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
      );
    }
    var btn = row && row.querySelector('.admin-pm-users');
    if (!btn || !m) return;
    var label = pmUsersButtonLabel(m, cur, idx);
    btn.title = label;
    btn.textContent = label;
  }

  function pmQrPreviewSrc(m) {
    if (m.qr_preview) return m.qr_preview;
    if (m.qr_url && !m.qr_remove) return m.qr_url;
    return '';
  }

  function pmListForCurrency(cur) {
    var wrapClass = PM_WRAP_SELECTORS[cur] || PM_WRAP_SELECTORS.COP;
    var wrap = document.querySelector(wrapClass);
    return wrap ? wrap.querySelector('.admin-pm-list[data-currency="' + cur + '"]') : null;
  }

  function renderCurrencyList(cur) {
    var list = pmListForCurrency(cur);
    if (!list) return;
    list.innerHTML = (methodsData[cur] || [])
      .map(function (m, i) {
        return methodRowHtml(cur, m, i);
      })
      .join('');
  }

  function findPrevMethodForRow(cur, rowEl) {
    var id = String(rowEl.getAttribute('data-id') || '').trim();
    var idx = parseInt(rowEl.getAttribute('data-idx'), 10);
    var list = methodsData[cur] || [];
    if (id) {
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id || '') === id) return list[i];
      }
    }
    if (!isNaN(idx) && list[idx]) return list[idx];
    return {};
  }

  function readPaymentCurrencyFromRow(rowEl, fallback) {
    if (rowEl) {
      var sel = rowEl.querySelector('.admin-pm-pay-currency');
      if (sel && sel.value) return normalizeAccumPayCurrency(sel.value);
      var attr = rowEl.getAttribute('data-payment-currency');
      if (attr) return normalizeAccumPayCurrency(attr);
    }
    return normalizeAccumPayCurrency(fallback || 'COP');
  }

  function persistAccumRowAttrs(cur, idx, m) {
    var row = document.querySelector(
      '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
    );
    if (!row || !m) return;
    row.setAttribute('data-payment-currency', normalizeAccumPayCurrency(m.payment_currency || 'COP'));
    var ids = m.allowed_user_ids;
    row.setAttribute(
      'data-allowed-user-ids',
      Array.isArray(ids) && ids.length ? ids.join(',') : ''
    );
  }

  function readMethodRowFromDom(row, prev) {
    prev = prev || {};
    var enabledEl = row.querySelector('.admin-pm-enabled');
    var labelEl = row.querySelector('.admin-pm-label');
    var accountEl = row.querySelector('.admin-pm-account');
    var brebLlaveEl = row.querySelector('.admin-pm-breb-llave');
    var brebSuffixEl = row.querySelector('.admin-pm-breb-suffix');
    var descriptionEl = row.querySelector('.admin-pm-description');
    var payCurrencyEl = row.querySelector('.admin-pm-pay-currency');
    var multUsdCopEl = row.querySelector('.admin-pm-mult-usd-cop');
    var multCopUsdEl = row.querySelector('.admin-pm-mult-cop-usd');
    var brandEl = row.querySelector('.admin-pm-brand');
    var cur = row.getAttribute('data-currency') || '';
    var entry = normalizeMethodEntry({
      id: prev.id || row.getAttribute('data-id') || '',
      enabled: enabledEl ? !!enabledEl.checked : true,
      payment_brand: brandEl ? brandEl.value : prev.payment_brand || '',
      label: (labelEl && labelEl.value ? labelEl.value : '').trim(),
      account_number: (accountEl && accountEl.value ? accountEl.value : '').trim(),
      bre_b_llave: (brebLlaveEl && brebLlaveEl.value ? brebLlaveEl.value : '').trim(),
      bre_b_account_suffix: (brebSuffixEl && brebSuffixEl.value ? brebSuffixEl.value : '').trim(),
      description: (descriptionEl && descriptionEl.value ? descriptionEl.value : '').trim(),
      payment_currency: readPaymentCurrencyFromRow(row, prev.payment_currency || 'COP'),
      mult_usd_to_cop: (multUsdCopEl && multUsdCopEl.value ? multUsdCopEl.value : '').trim(),
      mult_cop_to_usd: (multCopUsdEl && multCopUsdEl.value ? multCopUsdEl.value : '').trim(),
      allowed_user_ids: resolvedAllowedUserIds(prev, row),
      allowed_users: prev.allowed_users,
      qr_filename: prev.qr_filename,
      qr_url: prev.qr_url,
      qr_base64: prev.qr_base64,
      qr_remove: prev.qr_remove,
      qr_preview: prev.qr_preview,
    });
    return normalizeBrebMethodFields(ensureLabelFromBrand(entry, cur));
  }

  function methodRowIsEmpty(m) {
    m = m || {};
    return (
      !(m.label || '').trim() &&
      !(inferPaymentBrand(m) || '').trim() &&
      !(m.account_number || '').trim() &&
      !(m.description || '').trim() &&
      !(m.bre_b_llave || '').trim() &&
      !(m.bre_b_account_suffix || '').trim()
    );
  }

  function methodRowHasMeaningfulContent(m, cur, rowEl) {
    m = m || {};
    if ((m.label || '').trim() || (inferPaymentBrand(m) || '').trim()) return false;
    if ((m.account_number || '').trim() || (m.description || '').trim()) return true;
    if (cur === 'ACCUM') {
      if (String(m.mult_usd_to_cop || '').trim() || String(m.mult_cop_to_usd || '').trim()) return true;
      var ids = resolvedAllowedUserIds(m, rowEl);
      if (ids && ids.length) return true;
    }
    return false;
  }

  function countAccumEditorRows() {
    var list = pmListForCurrency('ACCUM');
    var labeled = 0;
    var partial = 0;
    if (!list) return { labeled: labeled, partial: partial };
    list.querySelectorAll('.admin-pm-row').forEach(function (row) {
      var m = readMethodRowFromDom(row, findPrevMethodForRow('ACCUM', row));
      if ((m.label || '').trim() || (inferPaymentBrand(m) || '').trim()) {
        labeled += 1;
      } else if (methodRowHasMeaningfulContent(m, 'ACCUM', row)) {
        partial += 1;
      }
    });
    return { labeled: labeled, partial: partial };
  }

  function methodBucketLabel(cur) {
    if (cur === 'ACCUM') return 'Acumulador';
    if (cur === 'USD') return 'USDT';
    return cur;
  }

  function readBrebFieldsFromRow(rowEl, entry) {
    entry = entry || {};
    if (!rowEl) return entry;
    var llaveEl = rowEl.querySelector('.admin-pm-breb-llave');
    var suffixEl = rowEl.querySelector('.admin-pm-breb-suffix');
    if (!llaveEl && !suffixEl) return entry;
    if (llaveEl) entry.bre_b_llave = (llaveEl.value || '').trim();
    if (suffixEl) entry.bre_b_account_suffix = (suffixEl.value || '').trim();
    return normalizeBrebMethodFields(entry);
  }

  function methodRowToPayload(cur, m, rowEl) {
    var entry = m || {};
    if (rowEl && cur === 'ACCUM') {
      entry = Object.assign({}, m, {
        payment_currency: readPaymentCurrencyFromRow(rowEl, m.payment_currency),
      });
    }
    if (rowEl) entry = readBrebFieldsFromRow(rowEl, entry);
    var allowedIds = resolvedAllowedUserIds(entry, rowEl);
    var brand = inferPaymentBrand(entry);
    entry = normalizeBrebMethodFields(entry);
    if (brand) entry.payment_brand = brand;
    var rowIdx = 0;
    if (rowEl) {
      rowIdx = parseInt(rowEl.getAttribute('data-idx'), 10);
      if (isNaN(rowIdx)) rowIdx = 0;
    }
    var row = {
      id: methodIdFromEntry(entry, rowIdx, cur),
      enabled: !!entry.enabled,
      payment_brand: brand || undefined,
      label: (entry.label || '').trim(),
      account_number: entry.account_number || '',
      bre_b_llave: entry.bre_b_llave || '',
      bre_b_account_suffix: entry.bre_b_account_suffix || '',
      description: entry.description || '',
      allowed_user_ids: allowedIds,
    };
    if (entry.qr_base64) row.qr_base64 = entry.qr_base64;
    if (entry.qr_remove) row.qr_remove = true;
    if (cur === 'ACCUM') {
      row.payment_currency = normalizeAccumPayCurrency(entry.payment_currency || 'COP');
      if (entry.mult_usd_to_cop !== '' && entry.mult_usd_to_cop != null) {
        row.mult_usd_to_cop = String(entry.mult_usd_to_cop).replace(',', '.');
      }
      if (entry.mult_cop_to_usd !== '' && entry.mult_cop_to_usd != null) {
        row.mult_cop_to_usd = String(entry.mult_cop_to_usd).replace(',', '.');
      }
    }
    return row;
  }

  function validateVisibleMethodRows() {
    var issues = [];
    PM_BUCKETS.forEach(function (cur) {
      var list = pmListForCurrency(cur);
      if (!list) return;
      list.querySelectorAll('.admin-pm-row').forEach(function (row, idx) {
        var m = readMethodRowFromDom(row, findPrevMethodForRow(cur, row));
        m = ensureLabelFromBrand(m, cur);
        if (!(m.label || '').trim() && !(inferPaymentBrand(m) || '').trim() && methodRowHasMeaningfulContent(m, cur, row)) {
          issues.push(
            'Selecciona el medio en ' + methodBucketLabel(cur) + ' (fila ' + (idx + 1) + ').'
          );
        } else if (!(m.label || '').trim() && !(inferPaymentBrand(m) || '').trim() && !methodRowIsEmpty(m)) {
          issues.push(
            'Selecciona el medio en ' + methodBucketLabel(cur) + ' (fila ' + (idx + 1) + ').'
          );
        }
      });
    });
    return issues;
  }

  function validateMethodsPayload(payload) {
    var issues = [];
    var seenIds = {};
    PM_BUCKETS.forEach(function (cur) {
      (payload[cur] || []).forEach(function (row, idx) {
        var mid = String(row.id || '').trim();
        if (mid) {
          if (seenIds[mid]) {
            issues.push(
              'ID de medio duplicado («' +
                mid +
                '» en ' +
                methodBucketLabel(cur) +
                '). Usa cuenta, llave Bre-B o datos distintos en cada fila (COP, USDT y acumulador no pueden repetir el mismo ID).'
            );
          }
          seenIds[mid] = true;
        }
        var label = (row.label || '').trim();
        var account = (row.account_number || '').trim();
        var desc = (row.description || '').trim();
        var brand = (row.payment_brand || '').trim();
        var enabled = row.enabled !== false;
        if (enabled && isBrebBancolombiaMethod(row)) {
          var llave = String(row.bre_b_llave || '').replace(/^@+/, '').trim();
          var suffix = String(row.bre_b_account_suffix || '').replace(/\D/g, '');
          if (!llave) {
            issues.push(
              'Bre-B Bancolombia (' +
                methodBucketLabel(cur) +
                ', fila ' +
                (idx + 1) +
                '): indica la llave (ej. @GUSTAVOP8514).'
            );
          }
          if (!suffix) {
            issues.push(
              'Bre-B Bancolombia (' +
                methodBucketLabel(cur) +
                ', fila ' +
                (idx + 1) +
                '): indica los 4 dígitos de cuenta (ej. 1948).'
            );
          }
        } else if (
          enabled &&
          brand &&
          brand !== 'generico' &&
          brand !== 'criptomoneda' &&
          !isBrebBancolombiaMethod(row)
        ) {
          var acctDigits = String(row.account_number || '').replace(/\D/g, '');
          if (!acctDigits) {
            issues.push(
              methodBucketLabel(cur) +
                ' (fila ' +
                (idx + 1) +
                '): indica número de cuenta o celular (cada medio del mismo banco necesita un ID distinto).'
            );
          }
        }
        if (!label && !brand && (account || desc)) {
          issues.push(
            'Selecciona el medio en ' + methodBucketLabel(cur) + ' (fila ' + (idx + 1) + ').'
          );
        } else if (enabled && label && !brand && cur !== 'ACCUM') {
          issues.push(
            'Selecciona el medio en ' +
              methodBucketLabel(cur) +
              ' (fila ' +
              (idx + 1) +
              ': «' +
              label +
              '»).'
          );
        }
      });
    });
    return issues;
  }

  function collectMethodsFromEditor() {
    var out = { COP: [], USD: [], ACCUM: [] };
    PM_BUCKETS.forEach(function (cur) {
      var list = pmListForCurrency(cur);
      if (!list) {
        (methodsData[cur] || []).forEach(function (m) {
          if (!(m.label || '').trim() || methodRowIsEmpty(m)) return;
          out[cur].push(methodRowToPayload(cur, m, null));
        });
        return;
      }
      var updated = [];
      list.querySelectorAll('.admin-pm-row').forEach(function (row, idx) {
        var prev = findPrevMethodForRow(cur, row);
        var m = readMethodRowFromDom(row, prev);
        updated.push(m);
        m = ensureLabelFromBrand(m, cur);
        if (!(m.label || '').trim() && !(inferPaymentBrand(m) || '').trim()) return;
        var payload = methodRowToPayload(cur, m, row);
        row.setAttribute('data-id', payload.id || '');
        out[cur].push(payload);
      });
      methodsData[cur] = updated;
    });
    return out;
  }

  function syncMethodsFromDom() {
    PM_BUCKETS.forEach(function (cur) {
      var list = pmListForCurrency(cur);
      if (!list) return;
      var updated = [];
      list.querySelectorAll('.admin-pm-row').forEach(function (row) {
        updated.push(readMethodRowFromDom(row, findPrevMethodForRow(cur, row)));
      });
      methodsData[cur] = updated;
    });
  }

  function pmFieldId(cur, idx, suffix) {
    return 'admin-pm-' + cur + '-' + idx + '-' + suffix;
  }

  function isBrebBancolombiaMethod(m) {
    m = m || {};
    var brand = String(m.payment_brand || inferPaymentBrand(m) || '').trim().toLowerCase();
    if (brand === 'breb_bancolombia') return true;
    var combined = normBrandText((m.id || '') + ' ' + (m.label || ''));
    return (
      (combined.indexOf('bre b') >= 0 || combined.indexOf('bre-b') >= 0) &&
      combined.indexOf('bancolombia') >= 0
    );
  }

  var BRAND_ONLY_METHOD_IDS = {
    nequi: 1,
    bancolombia: 1,
    daviplata: 1,
    breb_bancolombia: 1,
    bre_b_bancolombia: 1,
    breve: 1,
    paypal: 1,
    usdt: 1,
    binance_pay: 1,
    binance: 1,
    generico: 1,
    criptomoneda: 1,
  };

  function brebMethodIdFromLlave(llave) {
    var slug = String(llave || '')
      .replace(/^@+/, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    if (!slug) return 'bre_b_sin_llave';
    var id = 'bre_b_' + slug;
    return id.length > 48 ? id.slice(0, 48) : id;
  }

  function applyCurrencyMethodIdPrefix(id, cur) {
    id = String(id || '')
      .replace(/[^a-z0-9_\-]/gi, '')
      .toLowerCase()
      .slice(0, 48);
    if (!id) return id;
    if (cur === 'ACCUM' && id.indexOf('accum_') !== 0) {
      return ('accum_' + id).slice(0, 48);
    }
    return id;
  }

  function methodIdFromEntry(m, idx, cur) {
    m = normalizeBrebMethodFields(Object.assign({}, m || {}));
    cur = cur || m.currency || '';
    var brand = inferPaymentBrand(m);
    var id;
    if (isBrebBancolombiaMethod(m)) {
      var llave = String(m.bre_b_llave || '')
        .replace(/^@+/, '')
        .replace(/[^a-zA-Z0-9]/gi, '')
        .toLowerCase();
      if (llave) id = brebMethodIdFromLlave(llave);
    }
    if (!id) {
      var acct = String(m.account_number || '').replace(/\D/g, '');
      if (!acct && m.bre_b_account_suffix) {
        acct = String(m.bre_b_account_suffix).replace(/\D/g, '');
      }
      var tail = acct;
      if (tail.length > 8) tail = tail.slice(-8);
      if (brand && tail) id = (brand + '_' + tail).slice(0, 48);
    }
    if (!id) {
      var rawId = String(m.id || '')
        .replace(/[^a-z0-9_\-]/gi, '')
        .toLowerCase()
        .slice(0, 48);
      if (rawId && !BRAND_ONLY_METHOD_IDS[rawId] && rawId.indexOf('_') >= 0) id = rawId;
    }
    if (!id) {
      var slug = String(m.label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48);
      if (brand && (BRAND_ONLY_METHOD_IDS[slug] || slug === brand)) {
        var acct2 = String(m.account_number || '').replace(/\D/g, '');
        if (!acct2 && m.bre_b_account_suffix) {
          acct2 = String(m.bre_b_account_suffix).replace(/\D/g, '');
        }
        var tail2 = acct2;
        if (tail2.length > 8) tail2 = tail2.slice(-8);
        id = tail2
          ? (brand + '_' + tail2).slice(0, 48)
          : (brand + '_' + (idx || 0)).slice(0, 48);
      } else if (slug && String(m.account_number || '').replace(/\D/g, '')) {
        var tail3 = String(m.account_number || '').replace(/\D/g, '');
        if (tail3.length > 8) tail3 = tail3.slice(-8);
        id = (slug + '_' + tail3).slice(0, 48);
      } else {
        id = slug || 'medio_' + (idx || 0);
      }
    }
    return applyCurrencyMethodIdPrefix(id, cur);
  }

  function normalizeBrebMethodFields(m) {
    m = m || {};
    if (!isBrebBancolombiaMethod(m)) return m;
    var suffix = String(m.bre_b_account_suffix || '').replace(/\D/g, '');
    var acct = String(m.account_number || '').replace(/\D/g, '');
    if (!suffix && acct) {
      suffix = acct.length <= 4 ? acct : acct.slice(-4);
    }
    if (suffix.length > 4) suffix = suffix.slice(-4);
    m.bre_b_account_suffix = suffix;
    if (suffix) m.account_number = suffix;
    var llave = String(m.bre_b_llave || '').trim();
    if (llave) {
      m.bre_b_llave = llave.replace(/^@+/, '').toUpperCase();
      m.id = brebMethodIdFromLlave(m.bre_b_llave);
      m.label = 'Bre-B Bancolombia';
    }
    return m;
  }

  function buildPmQrBlock(m, cur, idx, fieldQr) {
    var qrSrc = pmQrPreviewSrc(m);
    var hasQr = !!qrSrc;
    var removeBtn = hasQr
      ? '<button type="button" class="btn-panel btn-red btn-sm admin-pm-qr-remove" title="Quitar QR">Quitar QR</button>'
      : '';
    return (
      '<div class="admin-pm-qr-wrap' +
      (hasQr ? ' admin-pm-qr-wrap--has' : '') +
      '">' +
      '<input type="file" id="' +
      fieldQr +
      '" name="pm_qr_' +
      cur +
      '_' +
      idx +
      '" class="admin-pm-qr-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>' +
      '<button type="button" class="admin-pm-qr-trigger' +
      (hasQr ? ' admin-pm-qr-trigger--has' : '') +
      '"' +
      (hasQr ? ' data-qr-src="' + escapeHtml(qrSrc) + '"' : '') +
      ' title="' +
      (hasQr ? 'Ver código QR ampliado' : 'Subir código QR') +
      '">' +
      '<i class="fas fa-qrcode" aria-hidden="true"></i><span>QR</span></button>' +
      removeBtn +
      '</div>'
    );
  }

  function methodRowHtml(cur, m, idx) {
    var fieldEnabled = pmFieldId(cur, idx, 'enabled');
    var fieldName = pmFieldId(cur, idx, 'name');
    var fieldAccount = pmFieldId(cur, idx, 'account');
    var fieldBrebLlave = pmFieldId(cur, idx, 'breb-llave');
    var fieldBrebSuffix = pmFieldId(cur, idx, 'breb-suffix');
    var fieldDescription = pmFieldId(cur, idx, 'description');
    var fieldPayCurrency = pmFieldId(cur, idx, 'pay-currency');
    var fieldMultUsdCop = pmFieldId(cur, idx, 'mult-usd-cop');
    var fieldMultCopUsd = pmFieldId(cur, idx, 'mult-cop-usd');
    var fieldQr = pmFieldId(cur, idx, 'qr');
    var isAccum = cur === 'ACCUM';
    m = normalizeBrebMethodFields(m);
    var isBreb = !isAccum && isBrebBancolombiaMethod(m);
    var payCur = normalizeAccumPayCurrency(m.payment_currency || 'COP');
    var showMultUsdCop = payCur === 'USD';
    var showMultCopUsd = payCur === 'COP';
    var accumConfigBlock = isAccum
      ? '<div class="admin-pm-accum-config">' +
        '<label class="admin-pm-accum-config-field admin-pm-accum-config-field--currency">' +
        '<span class="sr-only">Moneda acumulada</span>' +
        '<select id="' +
        fieldPayCurrency +
        '" name="pm_pay_currency_' +
        cur +
        '_' +
        idx +
        '" class="form-control admin-pm-pay-currency" title="Moneda en que se acumula el pago (COP o USDT)">' +
        '<option value="COP"' +
        (payCur === 'COP' ? ' selected' : '') +
        '>COP</option>' +
        '<option value="USD"' +
        (payCur === 'USD' ? ' selected' : '') +
        '>USDT</option>' +
        '</select></label>' +
        '<label class="admin-pm-accum-config-field admin-pm-accum-mult-wrap admin-pm-accum-mult-wrap--usd-cop"' +
        (showMultUsdCop ? '' : ' hidden') +
        '>' +
        '<span class="sr-only">Mult. USDT→COP</span>' +
        '<input type="number" id="' +
        fieldMultUsdCop +
        '" name="pm_mult_usd_cop_' +
        cur +
        '_' +
        idx +
        '" class="form-control admin-pm-mult-usd-cop" placeholder="3650" min="0" step="any" inputmode="decimal" autocomplete="off" value="' +
        escapeHtml(m.mult_usd_to_cop != null ? String(m.mult_usd_to_cop) : '') +
        '" title="Ej. 100 USDT × 3650 = 365.000 COP">' +
        '</label>' +
        '<label class="admin-pm-accum-config-field admin-pm-accum-mult-wrap admin-pm-accum-mult-wrap--cop-usd"' +
        (showMultCopUsd ? '' : ' hidden') +
        '>' +
        '<span class="sr-only">Mult. COP→USDT</span>' +
        '<input type="number" id="' +
        fieldMultCopUsd +
        '" name="pm_mult_cop_usd_' +
        cur +
        '_' +
        idx +
        '" class="form-control admin-pm-mult-cop-usd" placeholder="0.00026" min="0" step="any" inputmode="decimal" autocomplete="off" value="' +
        escapeHtml(m.mult_cop_to_usd != null ? String(m.mult_cop_to_usd) : '') +
        '" title="Ej. 365.000 COP × 0.00026 ≈ 94.9 USDT">' +
        '</label>' +
        '</div>'
      : '';
    var qrBlock = buildPmQrBlock(m, cur, idx, fieldQr);
    return (
      '<div class="admin-pm-row' +
      (isAccum ? ' admin-pm-row--accum' : '') +
      (isBreb ? ' admin-pm-row--breb' : '') +
      '" data-currency="' +
      cur +
      '" data-idx="' +
      idx +
      '" data-id="' +
      escapeHtml(m.id || '') +
      '" data-payment-currency="' +
      escapeHtml(payCur) +
      '" data-allowed-scope="' +
      escapeHtml(allowedUsersScopeFromMethod(m)) +
      '" data-allowed-user-ids="' +
      escapeHtml(
        Array.isArray(m.allowed_user_ids) && m.allowed_user_ids.length
          ? m.allowed_user_ids.join(',')
          : ''
      ) +
      '">' +
      '<label class="admin-pm-active" for="' +
      fieldEnabled +
      '" title="Activo"><input type="checkbox" id="' +
      fieldEnabled +
      '" name="pm_enabled_' +
      cur +
      '_' +
      idx +
      '" class="admin-pm-enabled" ' +
      (m.enabled ? 'checked' : '') +
      '><span class="sr-only">Activo</span></label>' +
      brandSelectHtml(cur, m, idx) +
      '<label class="admin-pm-field-label admin-pm-field-label--name">' +
      '<span class="sr-only">Nombre visible</span>' +
      '<input type="text" id="' +
      fieldName +
      '" name="pm_name_' +
      cur +
      '_' +
      idx +
      '" class="form-control admin-pm-label" placeholder="Nombre visible" value="' +
      escapeHtml(m.label || '') +
      '"></label>' +
      (isBreb
        ? '<label class="admin-pm-field-label admin-pm-field-label--breb-llave">' +
          '<span class="sr-only">Llave Bre-B</span>' +
          '<input type="text" id="' +
          fieldBrebLlave +
          '" name="pm_breb_llave_' +
          cur +
          '_' +
          idx +
          '" class="form-control admin-pm-breb-llave" placeholder="Llave (ej. @GUSTAVOP8514)" autocomplete="off" value="' +
          escapeHtml(m.bre_b_llave ? '@' + String(m.bre_b_llave).replace(/^@+/, '') : '') +
          '"></label>' +
          '<label class="admin-pm-field-label admin-pm-field-label--breb-suffix">' +
          '<span class="sr-only">Cuenta vinculada últimos 4 dígitos</span>' +
          '<input type="text" id="' +
          fieldBrebSuffix +
          '" name="pm_breb_suffix_' +
          cur +
          '_' +
          idx +
          '" class="form-control admin-pm-breb-suffix" placeholder="Cuenta *1948 (4 díg.)" inputmode="numeric" maxlength="4" autocomplete="off" value="' +
          escapeHtml(m.bre_b_account_suffix || '') +
          '"></label>'
        : '<label class="admin-pm-field-label admin-pm-field-label--account">' +
          '<span class="sr-only">Número de cuenta</span>' +
          '<input type="text" id="' +
          fieldAccount +
          '" name="pm_account_' +
          cur +
          '_' +
          idx +
          '" class="form-control admin-pm-account" placeholder="Número de cuenta" inputmode="numeric" autocomplete="off" value="' +
          escapeHtml(m.account_number || '') +
          '"></label>') +
      '<label class="admin-pm-field-label admin-pm-field-label--description">' +
      '<span class="sr-only">Descripción</span>' +
      '<input type="text" id="' +
      fieldDescription +
      '" name="pm_description_' +
      cur +
      '_' +
      idx +
      '" class="form-control admin-pm-description" placeholder="Descripción (opcional)" value="' +
      escapeHtml(m.description || '') +
      '"></label>' +
      accumConfigBlock +
      '<div class="admin-pm-actions">' +
      '<div class="admin-pm-actions-primary">' +
      '<button type="button" class="btn-panel btn-green btn-sm admin-pm-save" title="Guardar cambios">Guardar</button>' +
      '<button type="button" class="btn-panel btn-blue btn-sm admin-pm-users" title="' +
      escapeHtml(pmUsersButtonLabel(m, cur, idx)) +
      '">' +
      escapeHtml(pmUsersButtonLabel(m, cur, idx)) +
      '</button></div>' +
      qrBlock +
      '<button type="button" class="btn-panel btn-red btn-sm admin-pm-remove" title="Quitar medio" aria-label="Quitar medio"><i class="fas fa-times" aria-hidden="true"></i></button>' +
      '</div>' +
      '</div>'
    );
  }

  function normalizeAccumPayCurrency(val) {
    var v = String(val || 'COP').trim().toUpperCase();
    return v === 'USD' || v === 'USDT' ? 'USD' : 'COP';
  }

  function clearAccumAllowedUsers(cur, idx) {
    if (!methodsData[cur] || !methodsData[cur][idx]) return false;
    var m = methodsData[cur][idx];
    var hadUsers =
      (Array.isArray(m.allowed_user_ids) && m.allowed_user_ids.length > 0) ||
      (Array.isArray(m.allowed_users) && m.allowed_users.length > 0);
    m.allowed_users = [];
    m.allowed_user_ids = [];
    persistAllowedUsersOnRow(cur, idx, [], 'none');
    var row = document.querySelector(
      '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
    );
    if (row) {
      syncPmUsersButton(row);
    }
    if (pmModalTarget && pmModalTarget.cur === cur && pmModalTarget.idx === idx) {
      if (pmModalFilter && pmModalTarget.cur === 'ACCUM') {
        pmModalFilter.placeholder = 'Buscar clientes ' + accumModalUserPriceLabel() + '…';
      }
      if (pmModalUsersInfoBox && pmModalTarget.cur === 'ACCUM') {
        var payLabel = priceTypeLabel(accumPaymentCurrencyForModal());
        var userLabel = accumModalUserPriceLabel();
        pmModalUsersInfoBox.textContent =
          'Este medio acumula pagos en ' +
          payLabel +
          '. Solo aparecen clientes con saldo en ' +
          userLabel +
          ' (moneda opuesta). Marca a quienes podrán usarlo; si no marcas a nadie, ningún cliente verá este medio. Usa «Seleccionar todos» solo si quieres abrirlo a todos. ' +
          userLabel +
          ' con tienda activa. Cierra el modal y pulsa Guardar en la fila.';
      }
      renderPmModalUsersTable();
    }
    return hadUsers;
  }

  function onAccumPayCurrencyChanged(selectEl) {
    var accumRow = selectEl && selectEl.closest('.admin-pm-row');
    if (!accumRow || accumRow.getAttribute('data-currency') !== 'ACCUM') return;
    var idx = parseInt(accumRow.getAttribute('data-idx'), 10);
    var prevPayCur = normalizeAccumPayCurrency(
      selectEl.dataset.prevPayCurrency ||
        (methodsData.ACCUM && methodsData.ACCUM[idx] && methodsData.ACCUM[idx].payment_currency)
    );
    var newPayCur = normalizeAccumPayCurrency(selectEl.value);
    syncMethodsFromDom();
    if (methodsData.ACCUM && methodsData.ACCUM[idx]) {
      methodsData.ACCUM[idx].payment_currency = newPayCur;
    }
    accumRow.setAttribute('data-payment-currency', newPayCur);
    applyAccumMultVisibility(accumRow);
    if (prevPayCur !== newPayCur) {
      var hadUsers = clearAccumAllowedUsers('ACCUM', idx);
      if (hadUsers && methodsMsg) {
        showMsg(
          methodsMsg,
          'Moneda cambiada a ' +
            priceTypeLabel(newPayCur) +
            ': usuarios asignados desvinculados. Vuelve a marcar los clientes ' +
            accumModalUserPriceLabel() +
            ' y pulsa Guardar.',
          false
        );
      }
    }
    selectEl.dataset.prevPayCurrency = selectEl.value;
  }

  function applyAccumMultVisibility(row) {
    if (!row || row.getAttribute('data-currency') !== 'ACCUM') return;
    var sel = row.querySelector('.admin-pm-pay-currency');
    var payCur = (sel && sel.value ? sel.value : 'COP').toUpperCase() === 'USD' ? 'USD' : 'COP';
    var usdWrap = row.querySelector('.admin-pm-accum-mult-wrap--usd-cop');
    var copWrap = row.querySelector('.admin-pm-accum-mult-wrap--cop-usd');
    if (usdWrap) usdWrap.hidden = payCur !== 'USD';
    if (copWrap) copWrap.hidden = payCur !== 'COP';
  }

  function applyAllAccumMultVisibility() {
    document.querySelectorAll('.admin-pm-row--accum').forEach(function (row) {
      applyAccumMultVisibility(row);
      var sel = row.querySelector('.admin-pm-pay-currency');
      if (sel) {
        sel.dataset.prevPayCurrency = sel.value;
      }
    });
  }

  function renderMethodsEditor() {
    PM_BUCKETS.forEach(function (cur) {
      renderCurrencyList(cur);
    });
    applyAllAccumMultVisibility();
  }

  function fmtAccumAmount(n, cur) {
    if (n == null || isNaN(n)) return '—';
    var label = cur === 'USD' ? 'USDT' : cur;
    return '$' + Number(n).toLocaleString('es-CO') + ' ' + label;
  }

  function fmtMultiplier(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    var s = String(Number(n));
    if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {
      s = Number(n).toFixed(8).replace(/\.?0+$/, '');
    }
    return s;
  }

  function renderAccumSummary(items) {
    var wrap = document.getElementById('adminPmAccumSummary');
    var body = document.getElementById('adminPmAccumSummaryBody');
    if (!wrap || !body) return;
    if (!items || !items.length) {
      wrap.hidden = true;
      body.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    var rows = items
      .map(function (it) {
        var preview = it.preview_error
          ? '<span class="admin-pm-accum-error">' + escapeHtml(it.preview_error) + '</span>'
          : '<span class="admin-pm-accum-preview">' +
            escapeHtml(it.conversion_label || '') +
            ': <strong>' +
            escapeHtml(fmtAccumAmount(it.preview_credit, it.preview_credit_currency)) +
            '</strong>' +
            (it.preview_multiplier != null
              ? ' <span class="text-muted">(× ' + escapeHtml(fmtMultiplier(it.preview_multiplier)) + ')</span>'
              : '') +
            '</span>';
        var multUsdCop = fmtMultiplier(it.mult_usd_to_cop);
        var multCopUsd = fmtMultiplier(it.mult_cop_to_usd);
        var convertDisabled = it.preview_error ? ' disabled' : '';
        return (
          '<tr>' +
          '<td>' +
          escapeHtml(it.username || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(it.payment_method_label || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(fmtAccumAmount(it.total_accumulated, it.payment_currency)) +
          ' <span class="text-muted">(' +
          (it.recharge_count || 0) +
          ')</span></td>' +
          '<td>' +
          multUsdCop +
          '</td>' +
          '<td>' +
          multCopUsd +
          '</td>' +
          '<td>' +
          preview +
          '</td>' +
          '<td class="admin-pm-accum-actions">' +
          '<button type="button" class="btn-panel btn-green btn-sm admin-pm-accum-convert"' +
          convertDisabled +
          ' data-user-id="' +
          it.user_id +
          '" data-method-id="' +
          escapeHtml(it.payment_method_id || '') +
          '">Convertir</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
    body.innerHTML =
      '<div class="admin-pm-accum-summary-scroll">' +
      '<table class="admin-pm-accum-summary-table">' +
      '<thead><tr>' +
      '<th>Usuario</th><th>Medio</th><th>Acumulado</th><th>× USDT→COP</th><th>× COP→USDT</th><th>A acreditar</th><th></th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>';
  }

  function loadAccumSummary() {
    if (!accumSummaryUrl) return Promise.resolve();
    return fetch(accumSummaryUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.success) {
          renderAccumSummary([]);
          return;
        }
        renderAccumSummary(data.items || []);
      })
      .catch(function () {
        renderAccumSummary([]);
      });
  }

  function convertAccumulation(userId, methodId, btn) {
    if (!accumConvertUrl || !userId || !methodId) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Convirtiendo…';
    }
    fetch(accumConvertUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId, payment_method_id: methodId }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        showMsg(accumMsg || methodsMsg, data.message || (data.success ? 'Convertido.' : 'Error'), !data.success);
        if (data.success) {
          loadAccumSummary();
          loadAccumRecharges();
          loadRecharges();
        } else if (btn) {
          btn.disabled = false;
          btn.textContent = 'Convertir';
        }
      })
      .catch(function () {
        showMsg(accumMsg || methodsMsg, 'Error al convertir.', true);
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Convertir';
        }
      });
  }

  function applyPaymentMethodsFromApi(data, restoreScrollY) {
    if (!data || !data.success) return;
    var scrollY =
      typeof restoreScrollY === 'number' && !isNaN(restoreScrollY) ? restoreScrollY : null;
    if (data.payment_brand_choices) {
      paymentBrandChoicesFromApi = data.payment_brand_choices;
    }
    var raw = data.methods || { COP: [], USD: [], ACCUM: [] };
    methodsData = { COP: [], USD: [], ACCUM: [] };
    PM_BUCKETS.forEach(function (cur) {
      methodsData[cur] = (raw[cur] || []).map(normalizeMethodEntry);
    });
    methodsLoaded = true;
    renderMethodsEditor();
    if (scrollY != null) {
      requestAnimationFrame(function () {
        window.scrollTo(0, scrollY);
      });
    }
  }

  function loadPaymentMethodsEditor() {
    return fetch(methodsUrl, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        applyPaymentMethodsFromApi(data, null);
        return data;
      });
  }

  function readQrFile(file, cb) {
    if (!file || !/^image\//.test(file.type || '')) {
      cb(null);
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      alert('El QR no puede superar 4 MB.');
      cb(null);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      cb(reader.result);
    };
    reader.onerror = function () {
      cb(null);
    };
    reader.readAsDataURL(file);
  }

  var PM_BLOCKED_USERNAMES = { soporte: 1, soporte1: 1, soporte2: 1, soporte3: 1 };

  function normalizeUserPriceType(u) {
    var raw = u.tipo_precio_rol || u.tipo_precio || '';
    raw = String(raw).trim().toUpperCase();
    if (raw === 'USD' || raw === 'USDT') return 'USD';
    if (raw === 'COP') return 'COP';
    return '';
  }

  function isEligibleStoreRechargeUser(u) {
    if (!u || u.enabled === false) return false;
    var un = String(u.username || '').trim().toLowerCase();
    if (PM_BLOCKED_USERNAMES[un]) return false;
    return u.price_type === 'COP' || u.price_type === 'USD';
  }

  function fetchUsersForModal(query) {
    var q = String(query || '').trim();
    var url = searchUsersUrl + '?query=' + encodeURIComponent(q);
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.status !== 'ok' || !data.users) return [];
        return data.users
          .map(function (u) {
            return {
              id: parseInt(u.id, 10),
              username: u.username || '',
              full_name: u.full_name || '',
              enabled: u.enabled !== false,
              price_type: normalizeUserPriceType(u),
            };
          })
          .filter(isEligibleStoreRechargeUser);
      })
      .catch(function () {
        return [];
      });
  }

  function fetchAllUsersForModal() {
    return fetchUsersForModal('');
  }

  function isAccumUsersModal() {
    return !!(pmModalTarget && pmModalTarget.cur === 'ACCUM');
  }

  function pmModalColspan() {
    return isAccumUsersModal() ? 4 : 3;
  }

  function priceTypeLabel(code) {
    if (code === 'USD') return 'USDT';
    if (code === 'COP') return 'COP';
    return '—';
  }

  function normalizeUserId(id) {
    var n = parseInt(id, 10);
    return n > 0 ? n : 0;
  }

  function parseAllowedUserIdsFromAttr(raw, scope) {
    if (scope === 'all') return null;
    if (scope === 'none' || raw === '' || (raw != null && String(raw).trim() === '')) {
      return [];
    }
    if (raw == null) return null;
    var ids = String(raw)
      .split(',')
      .map(function (x) {
        return normalizeUserId(x);
      })
      .filter(function (id) {
        return id > 0;
      });
    return ids.length ? ids : [];
  }

  function allowedUsersScopeFromMethod(m) {
    if (!m || !Array.isArray(m.allowed_user_ids)) return 'all';
    return m.allowed_user_ids.length ? 'listed' : 'none';
  }

  function resolvedAllowedUserIds(m, rowEl) {
    var ids = null;
    if (Array.isArray(m.allowed_user_ids)) {
      ids = m.allowed_user_ids
        .map(function (id) {
          return normalizeUserId(id);
        })
        .filter(function (id) {
          return id > 0;
        });
    } else if (Array.isArray(m.allowed_users) && m.allowed_users.length) {
      ids = m.allowed_users
        .map(function (u) {
          return normalizeUserId(u.id);
        })
        .filter(function (id) {
          return id > 0;
        });
    }
    if (ids === null && rowEl) {
      ids = parseAllowedUserIdsFromAttr(
        rowEl.getAttribute('data-allowed-user-ids'),
        rowEl.getAttribute('data-allowed-scope')
      );
    }
    if (ids === null) return null;
    return ids;
  }

  function persistAllowedUsersOnRow(cur, idx, idList, scope) {
    var row = document.querySelector(
      '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
    );
    if (!row) return;
    var listed = idList && idList.length;
    if (scope === 'all' || (scope == null && !Array.isArray(idList))) {
      row.setAttribute('data-allowed-scope', 'all');
      row.setAttribute('data-allowed-user-ids', '');
    } else if (listed) {
      row.setAttribute('data-allowed-scope', 'listed');
      row.setAttribute('data-allowed-user-ids', idList.join(','));
    } else {
      row.setAttribute('data-allowed-scope', 'none');
      row.setAttribute('data-allowed-user-ids', '');
    }
  }

  function pmModalRowElement() {
    if (!pmModalTarget) return null;
    return document.querySelector(
      '.admin-pm-row[data-currency="' +
        pmModalTarget.cur +
        '"][data-idx="' +
        pmModalTarget.idx +
        '"]'
    );
  }

  function accumExpectedUserPriceType(paymentCurrency) {
    return normalizeAccumPayCurrency(paymentCurrency) === 'COP' ? 'USD' : 'COP';
  }

  function persistAccumUserState(cur, idx, m) {
    var scope = allowedUsersScopeFromMethod(m);
    persistAllowedUsersOnRow(cur, idx, m.allowed_user_ids || [], scope === 'all' ? 'all' : scope);
    persistAccumRowAttrs(cur, idx, m);
    var row = document.querySelector(
      '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
    );
    if (row) {
      syncPmUsersButton(row);
    }
  }

  function pruneAccumAllowedUsers(m, allUsers, paymentCurrency) {
    if (!m) return 0;
    var expected = accumExpectedUserPriceType(paymentCurrency);
    var ids = [];
    if (Array.isArray(m.allowed_user_ids) && m.allowed_user_ids.length) {
      ids = m.allowed_user_ids
        .map(function (id) {
          return normalizeUserId(id);
        })
        .filter(function (id) {
          return id > 0;
        });
    }
    if (!ids.length) {
      m.allowed_user_ids = [];
      m.allowed_users = [];
      return 0;
    }
    var byId = {};
    (allUsers || []).forEach(function (u) {
      byId[normalizeUserId(u.id)] = u;
    });
    var valid = ids.filter(function (uid) {
      var u = byId[uid];
      return u && u.price_type === expected;
    });
    var removed = ids.length - valid.length;
    m.allowed_user_ids = valid;
    if (valid.length) {
      m.allowed_users = valid.map(function (uid) {
        var u = byId[uid];
        return {
          id: uid,
          username: u.username || String(uid),
          full_name: u.full_name || '',
          price_type: u.price_type,
          enabled: u.enabled !== false,
        };
      });
    } else {
      m.allowed_users = [];
    }
    return removed;
  }

  function pruneAllAccumMethodsFromDomUsers(allUsers) {
    var removedTotal = 0;
    (methodsData.ACCUM || []).forEach(function (m, idx) {
      var row = document.querySelector('.admin-pm-row[data-currency="ACCUM"][data-idx="' + idx + '"]');
      var payCur = readPaymentCurrencyFromRow(row, m.payment_currency);
      var removed = pruneAccumAllowedUsers(m, allUsers, payCur);
      if (removed > 0) {
        persistAccumUserState('ACCUM', idx, m);
        removedTotal += removed;
      }
    });
    return removedTotal;
  }

  function getSelectedUserIdsSet() {
    if (!pmModalTarget) return new Set();
    var m = methodsData[pmModalTarget.cur] && methodsData[pmModalTarget.cur][pmModalTarget.idx];
    if (!m) return new Set();
    var ids = resolvedAllowedUserIds(m, pmModalRowElement()) || [];
    var out = new Set();
    ids.forEach(function (id) {
      var uid = normalizeUserId(id);
      if (uid) out.add(uid);
    });
    return out;
  }

  function applySelectedIdsToMethod(selectedSet) {
    if (!pmModalTarget) return;
    var cur = pmModalTarget.cur;
    var idx = pmModalTarget.idx;
    if (!methodsData[cur] || !methodsData[cur][idx]) return;
    var m = methodsData[cur][idx];
    if (!selectedSet || !selectedSet.size) {
      m.allowed_users = [];
      m.allowed_user_ids = [];
      persistAllowedUsersOnRow(cur, idx, [], 'none');
      if (cur === 'ACCUM') persistAccumRowAttrs(cur, idx, m);
      return;
    }
    var idList = [];
    selectedSet.forEach(function (id) {
      var uid = normalizeUserId(id);
      if (uid && idList.indexOf(uid) < 0) idList.push(uid);
    });
    var known = {};
    (pmModalAllUsers || []).forEach(function (u) {
      known[normalizeUserId(u.id)] = u;
    });
    (m.allowed_users || []).forEach(function (u) {
      var uid = normalizeUserId(u.id);
      if (uid && !known[uid]) known[uid] = u;
    });
    m.allowed_user_ids = idList;
    m.allowed_users = idList.map(function (uid) {
      return (
        known[uid] || {
          id: uid,
          username: String(uid),
          full_name: '',
          price_type: '',
          enabled: true,
        }
      );
    });
    if (cur === 'ACCUM') {
      var rowEl = document.querySelector(
        '.admin-pm-row[data-currency="' + cur + '"][data-idx="' + idx + '"]'
      );
      if (rowEl) {
        m.payment_currency = readPaymentCurrencyFromRow(rowEl, m.payment_currency);
      }
    }
    persistAllowedUsersOnRow(cur, idx, idList, 'listed');
    if (cur === 'ACCUM') {
      persistAccumRowAttrs(cur, idx, m);
    }
  }

  function readSelectedUserIdsFromModalTable() {
    var set = new Set();
    if (!pmModalTableBody) return set;
    pmModalTableBody.querySelectorAll('.admin-pm-user-check:checked').forEach(function (cb) {
      var uid = normalizeUserId(cb.getAttribute('data-user-id'));
      if (uid) set.add(uid);
    });
    return set;
  }

  function syncPmModalSelectionFromTable() {
    if (!pmModalTarget) return;
    applySelectedIdsToMethod(readSelectedUserIdsFromModalTable());
  }

  function updatePmUsersButtonInRow() {
    if (!pmModalTarget) return;
    var row = document.querySelector(
      '.admin-pm-row[data-currency="' + pmModalTarget.cur + '"][data-idx="' + pmModalTarget.idx + '"]'
    );
    if (!row) return;
    var btn = row.querySelector('.admin-pm-users');
    var m = methodsData[pmModalTarget.cur] && methodsData[pmModalTarget.cur][pmModalTarget.idx];
    if (btn && m) syncPmUsersButton(pmModalTarget.cur, pmModalTarget.idx, m);
  }

  function accumPaymentCurrencyForModal() {
    if (!pmModalTarget || pmModalTarget.cur !== 'ACCUM') return 'COP';
    var idx = pmModalTarget.idx;
    var m = methodsData.ACCUM && methodsData.ACCUM[idx];
    if (m && m.payment_currency) {
      return normalizeAccumPayCurrency(m.payment_currency);
    }
    var row = document.querySelector('.admin-pm-row[data-currency="ACCUM"][data-idx="' + idx + '"]');
    var sel = row && row.querySelector('.admin-pm-pay-currency');
    if (sel) {
      return normalizeAccumPayCurrency(sel.value);
    }
    return 'COP';
  }

  function accumEligibleUserPriceType() {
    return accumPaymentCurrencyForModal() === 'COP' ? 'USD' : 'COP';
  }

  function accumModalUserPriceLabel() {
    return priceTypeLabel(accumEligibleUserPriceType());
  }

  function modalCurrencyFilter() {
    if (!pmModalTarget || !pmModalTarget.cur) return '';
    if (pmModalTarget.cur === 'ACCUM') return accumEligibleUserPriceType();
    return pmModalTarget.cur === 'USD' ? 'USD' : 'COP';
  }

  function filteredModalUsers() {
    var q = (pmModalFilter?.value || '').trim().toLowerCase();
    var priceFilter = modalCurrencyFilter();
    return pmModalAllUsers.filter(function (u) {
      if (!isEligibleStoreRechargeUser(u)) return false;
      if (priceFilter && u.price_type !== priceFilter) return false;
      if (!q) return true;
      return (
        (u.username || '').toLowerCase().indexOf(q) !== -1 ||
        (u.full_name || '').toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function updatePmSelectAllHeader(selected, visibleUsers) {
    if (!pmSelectAllVisible) return;
    if (!visibleUsers.length) {
      pmSelectAllVisible.checked = false;
      pmSelectAllVisible.indeterminate = false;
      return;
    }
    var selectedVisible = visibleUsers.filter(function (u) {
      return selected.has(normalizeUserId(u.id));
    }).length;
    pmSelectAllVisible.checked = selectedVisible === visibleUsers.length;
    pmSelectAllVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleUsers.length;
  }

  function renderPmModalUsersTable() {
    if (!pmModalTableBody || !pmModalTarget) return;
    var users = filteredModalUsers();
    var selected = getSelectedUserIdsSet();
    var colspan = pmModalColspan();
    var showPriceType = isAccumUsersModal();
    if (!pmModalAllUsers.length) {
      pmModalTableBody.innerHTML =
        '<tr><td colspan="' +
        colspan +
        '" class="admin-pm-users-empty">No se pudieron cargar usuarios.</td></tr>';
      updatePmSelectAllHeader(selected, users);
      return;
    }
    if (!users.length) {
      var q = (pmModalFilter?.value || '').trim();
      var emptyMsg = 'Sin coincidencias.';
      if (isAccumUsersModal()) {
        emptyMsg = 'No hay clientes ' + accumModalUserPriceLabel() + ' con tienda activa.';
        if (q) emptyMsg = 'Sin coincidencias entre clientes ' + accumModalUserPriceLabel() + '.';
      }
      pmModalTableBody.innerHTML =
        '<tr><td colspan="' +
        colspan +
        '" class="admin-pm-users-empty">' +
        emptyMsg +
        '</td></tr>';
      updatePmSelectAllHeader(selected, users);
      return;
    }
    pmModalTableBody.innerHTML = users
      .map(function (u) {
        var checked = selected.has(normalizeUserId(u.id));
        var priceCol = showPriceType
          ? '<td class="admin-pm-users-table-col-price">' + escapeHtml(priceTypeLabel(u.price_type)) + '</td>'
          : '';
        return (
          '<tr class="admin-pm-users-table-row">' +
          '<td class="admin-pm-users-table-col-check">' +
          '<label class="sr-only" for="admin-pm-user-' +
          u.id +
          '">Seleccionar ' +
          escapeHtml(u.username || String(u.id)) +
          '</label>' +
          '<input type="checkbox" class="admin-pm-user-check" id="admin-pm-user-' +
          u.id +
          '" name="admin_pm_user_' +
          u.id +
          '" data-user-id="' +
          u.id +
          '"' +
          (checked ? ' checked' : '') +
          ' aria-label="Seleccionar ' +
          escapeHtml(u.username || String(u.id)) +
          '">' +
          '</td>' +
          '<td>' +
          escapeHtml(u.username || '—') +
          '</td>' +
          '<td class="admin-pm-users-table-col-name">' +
          escapeHtml(u.full_name || '—') +
          '</td>' +
          priceCol +
          '</tr>'
        );
      })
      .join('');
    updatePmSelectAllHeader(selected, users);
  }

  function setPmModalSelection(selectedSet, reRenderTable) {
    applySelectedIdsToMethod(selectedSet);
    if (reRenderTable !== false) {
      renderPmModalUsersTable();
    } else {
      updatePmSelectAllHeader(getSelectedUserIdsSet(), filteredModalUsers());
      updatePmUsersButtonInRow();
    }
  }

  function onPmUserCheckChanged(cb) {
    if (!pmModalTarget || !cb) return;
    setPmModalSelection(readSelectedUserIdsFromModalTable(), false);
  }

  function closePmUsersModalInfoBox() {
    if (!pmModalUsersInfoBox || !pmModalUsersInfoBtn) return;
    pmModalUsersInfoBox.hidden = true;
    pmModalUsersInfoBtn.setAttribute('aria-expanded', 'false');
  }

  function togglePmUsersModalInfoBox() {
    if (!pmModalUsersInfoBox || !pmModalUsersInfoBtn) return;
    var open = pmModalUsersInfoBox.hidden;
    pmModalUsersInfoBox.hidden = !open;
    pmModalUsersInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openPmUsersModal(cur, idx) {
    syncMethodsFromDom();
    pmModalTarget = { cur: cur, idx: idx };
    var m = methodsData[cur][idx];
    var colspan = cur === 'ACCUM' ? 4 : 3;
    if (pmModalTitleText) {
      pmModalTitleText.textContent = 'Usuarios · ' + (m.label || 'Medio');
    }
    closePmUsersModalInfoBox();
    if (pmModalFilter) {
      pmModalFilter.value = '';
      if (cur === 'ACCUM') {
        pmModalFilter.placeholder = 'Buscar clientes ' + accumModalUserPriceLabel() + '…';
      } else {
        pmModalFilter.placeholder = 'Filtrar por usuario o nombre…';
      }
    }
    var priceHeader = document.getElementById('adminPmUsersPriceHeader');
    if (priceHeader) {
      priceHeader.hidden = cur !== 'ACCUM';
    }
    if (pmModalUsersInfoBox && cur === 'ACCUM') {
      var payLabel = priceTypeLabel(accumPaymentCurrencyForModal());
      var userLabel = accumModalUserPriceLabel();
      pmModalUsersInfoBox.textContent =
        'Este medio acumula pagos en ' +
        payLabel +
        '. Solo aparecen clientes con saldo en ' +
        userLabel +
        ' (moneda opuesta). Marca a quienes podrán usarlo; si no marcas a nadie, queda visible para todos los clientes ' +
        userLabel +
        ' con tienda activa. Cierra el modal y pulsa Guardar en la fila.';
    } else if (pmModalUsersInfoBox) {
      pmModalUsersInfoBox.textContent =
        'Solo aparecen clientes con tienda pública y tipo de precio COP o USDT acorde al medio. Debes marcar quiénes pueden usar el medio; si no marcas a nadie, ningún cliente lo verá. «Seleccionar todos» abre el medio a todos los listados. Guarda la fila al cerrar.';
    }
    if (pmModalTableBody) {
      pmModalTableBody.innerHTML =
        '<tr><td colspan="' + colspan + '" class="admin-pm-users-empty">Cargando usuarios…</td></tr>';
    }
    if (pmModal) {
      pmModal.hidden = false;
      pmModal.classList.remove('d-none');
    }
    fetchAllUsersForModal().then(function (users) {
      if (!pmModalTarget || pmModalTarget.cur !== cur || pmModalTarget.idx !== idx) return;
      pmModalAllUsers = users;
      if (cur === 'ACCUM') {
        var rowEl = document.querySelector(
          '.admin-pm-row[data-currency="ACCUM"][data-idx="' + idx + '"]'
        );
        var payCur = readPaymentCurrencyFromRow(rowEl, m.payment_currency);
        var removed = pruneAccumAllowedUsers(m, users, payCur);
        if (removed > 0) {
          persistAccumUserState('ACCUM', idx, m);
          showMsg(
            methodsMsg,
            'Se quitaron ' +
              removed +
              ' asignación(es) inválidas (moneda distinta). Marca de nuevo los clientes ' +
              priceTypeLabel(accumExpectedUserPriceType(payCur)) +
              '.',
            false
          );
        }
      }
      renderPmModalUsersTable();
    });
    pmModalFilter?.focus();
  }

  function closePmUsersModal() {
    if (!pmModalTarget) {
      if (pmModal) {
        pmModal.hidden = true;
        pmModal.classList.add('d-none');
      }
      return;
    }
    syncPmModalSelectionFromTable();
    syncMethodsFromDom();
    renderMethodsEditor();
    closePmUsersModalInfoBox();
    pmModalTarget = null;
    if (pmModal) {
      pmModal.hidden = true;
      pmModal.classList.add('d-none');
    }
  }

  function syncAllowedUsersIntoMethodsData() {
    PM_BUCKETS.forEach(function (cur) {
      var list = pmListForCurrency(cur);
      if (!list || !methodsData[cur]) return;
      list.querySelectorAll('.admin-pm-row').forEach(function (row, i) {
        if (!methodsData[cur][i]) return;
        methodsData[cur][i].allowed_user_ids = resolvedAllowedUserIds(methodsData[cur][i], row);
        if (cur === 'ACCUM') {
          methodsData[cur][i].payment_currency = readPaymentCurrencyFromRow(
            row,
            methodsData[cur][i].payment_currency
          );
          persistAccumRowAttrs(cur, i, methodsData[cur][i]);
        }
      });
    });
  }

  function savePaymentMethods(saveBtn) {
    syncPmModalSelectionFromTable();
    syncMethodsFromDom();
    syncAllowedUsersIntoMethodsData();
    var scrollY = window.scrollY || window.pageYOffset || 0;
    var accumBeforeSave = countAccumEditorRows();
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.dataset.prevLabel = saveBtn.textContent;
      saveBtn.textContent = 'Guardando…';
    }
    return fetchAllUsersForModal()
      .then(function (users) {
        pmModalAllUsers = users;
        var pruned = pruneAllAccumMethodsFromDomUsers(users);
        if (pruned > 0) {
          showMsg(
            methodsMsg,
            'Se limpiaron ' + pruned + ' asignación(es) de acumulador con moneda incorrecta antes de guardar.',
            false,
            { scroll: false }
          );
        }
        syncMethodsFromDom();
        accumBeforeSave = countAccumEditorRows();
        var visibleIssues = validateVisibleMethodRows();
        if (visibleIssues.length) {
          showMsg(methodsMsg, visibleIssues[0], true, { scroll: true });
          return { success: false };
        }
        if (accumBeforeSave.partial > 0) {
          showMsg(
            methodsMsg,
            'El acumulador tiene datos incompletos. Selecciona el medio y pulsa Guardar.',
            true,
            { scroll: true }
          );
          return { success: false };
        }
        var payload = collectMethodsFromEditor();
        var payloadIssues = validateMethodsPayload(payload);
        if (payloadIssues.length) {
          showMsg(methodsMsg, payloadIssues[0], true, { scroll: true });
          return { success: false };
        }
        var sentAccumCount = (payload.ACCUM || []).length;
        if (accumBeforeSave.labeled > 0 && sentAccumCount === 0) {
          showMsg(
            methodsMsg,
            'No se pudo incluir el acumulador al guardar. Recarga la página, selecciona el medio y vuelve a pulsar Guardar.',
            true,
            { scroll: true }
          );
          return { success: false };
        }
        if (accumBeforeSave.labeled > sentAccumCount) {
          showMsg(
            methodsMsg,
            'Hay medios del acumulador sin medio seleccionado. Complétalos antes de guardar.',
            true,
            { scroll: true }
          );
          return { success: false };
        }
        return fetch(methodsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ methods: payload }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            if (!data || !data.success) {
              showMsg(methodsMsg, (data && data.message) || 'Error al guardar.', true, { scroll: true });
              return data;
            }
            var savedAccum = (data.methods && data.methods.ACCUM) || [];
            if (sentAccumCount > 0 && savedAccum.length < sentAccumCount) {
              showMsg(
                methodsMsg,
                'No se guardaron todos los medios del acumulador. Revisa el nombre y vuelve a pulsar Guardar.',
                true,
                { scroll: true }
              );
              return data;
            }
            showMsg(methodsMsg, data.message || 'Guardado.', false, { scroll: false });
            applyPaymentMethodsFromApi(data, scrollY);
            if (saveBtn) {
              flashPmRowSaved(saveBtn);
            }
            return data;
          });
      })
      .catch(function () {
        showMsg(methodsMsg, 'Error de red al guardar medios de pago.', true, { scroll: true });
        return { success: false };
      })
      .finally(function () {
        if (!saveBtn) return;
        saveBtn.disabled = false;
        saveBtn.textContent = saveBtn.dataset.prevLabel || 'Guardar';
        delete saveBtn.dataset.prevLabel;
      });
  }

  var accumPanel = document.getElementById('adminRecargasPanelAccum');

  methodsPanel?.addEventListener('click', function (e) {
    if (e.target.classList.contains('admin-pm-add')) {
      syncMethodsFromDom();
      var cur = e.target.getAttribute('data-currency');
      methodsData[cur] = methodsData[cur] || [];
      methodsData[cur].push(
        normalizeMethodEntry({
          label: '',
          account_number: '',
          description: '',
          enabled: true,
          allowed_user_ids: [],
        })
      );
      renderMethodsEditor();
      if (cur === 'ACCUM') {
        showMsg(
          methodsMsg,
          'Medio añadido. Elige el medio en la lista, revisa el nombre y pulsa Guardar en la fila.',
          false
        );
      }
      var list = pmListForCurrency(cur);
      if (list) {
        var rows = list.querySelectorAll('.admin-pm-row');
        var lastRow = rows[rows.length - 1];
        var brandInput = lastRow && lastRow.querySelector('.admin-pm-brand');
        if (brandInput) brandInput.focus();
      }
    }
    if (e.target.closest('.admin-pm-remove')) {
      var removeBtn = e.target.closest('.admin-pm-remove');
      var row = removeBtn && removeBtn.closest('.admin-pm-row');
      if (!row) return;
      var cur = row.getAttribute('data-currency');
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      if (!methodsData[cur] || !methodsData[cur][idx]) return;
      if (
        pmModalTarget &&
        pmModalTarget.cur === cur &&
        pmModalTarget.idx === idx
      ) {
        pmModalTarget = null;
        if (pmModal) {
          pmModal.hidden = true;
          pmModal.classList.add('d-none');
        }
      }
      syncMethodsFromDom();
      methodsData[cur].splice(idx, 1);
      renderMethodsEditor();
      savePaymentMethods().then(function (data) {
        if (data && data.success) {
          showMsg(methodsMsg, 'Medio eliminado.', false);
        }
      });
      return;
    }
    if (e.target.closest('.admin-pm-save')) {
      e.preventDefault();
      savePaymentMethods(e.target.closest('.admin-pm-save'));
    }
    if (e.target.closest('.admin-pm-users')) {
      var rowU = e.target.closest('.admin-pm-row');
      openPmUsersModal(rowU.getAttribute('data-currency'), parseInt(rowU.getAttribute('data-idx'), 10));
    }
    var qrTrigger = e.target.closest('.admin-pm-qr-trigger');
    if (qrTrigger && !e.target.classList.contains('admin-pm-qr-remove')) {
      var wrapT = qrTrigger.closest('.admin-pm-qr-wrap');
      if (qrTrigger.classList.contains('admin-pm-qr-trigger--has')) {
        e.preventDefault();
        e.stopPropagation();
        var qrSrc = String(qrTrigger.getAttribute('data-qr-src') || '').trim();
        if (qrSrc && openAdminImageLightboxFn) {
          openAdminImageLightboxFn(qrSrc, 'Código QR del medio de pago ampliado');
        }
      } else {
        var fileInp = wrapT && wrapT.querySelector('.admin-pm-qr-file');
        if (fileInp) fileInp.click();
      }
      return;
    }
    if (e.target.classList.contains('admin-pm-qr-remove')) {
      e.stopPropagation();
      syncMethodsFromDom();
      var rowQ = e.target.closest('.admin-pm-row');
      var curQ = rowQ.getAttribute('data-currency');
      var idxQ = parseInt(rowQ.getAttribute('data-idx'), 10);
      var mq = methodsData[curQ][idxQ];
      mq.qr_remove = true;
      mq.qr_base64 = '';
      mq.qr_preview = '';
      renderMethodsEditor();
    }
  });

  function handleAccumConvertClick(e) {
    var convertBtn = e.target.closest('.admin-pm-accum-convert');
    if (!convertBtn || convertBtn.disabled) return;
    var uid = parseInt(convertBtn.getAttribute('data-user-id'), 10);
    var mid = convertBtn.getAttribute('data-method-id') || '';
    if (uid && mid) {
      convertAccumulation(uid, mid, convertBtn);
    }
  }

  accumPanel?.addEventListener('click', handleAccumConvertClick);

  methodsPanel?.addEventListener('focusin', function (e) {
    if (e.target.classList.contains('admin-pm-pay-currency')) {
      e.target.dataset.prevPayCurrency = e.target.value;
    }
  });

  methodsPanel?.addEventListener('change', function (e) {
    if (e.target.classList.contains('admin-pm-pay-currency')) {
      onAccumPayCurrencyChanged(e.target);
      return;
    }
    if (e.target.classList.contains('admin-pm-brand')) {
      var rowB = e.target.closest('.admin-pm-row');
      if (rowB) {
        applyBrandSelectionToRow(rowB, rowB.getAttribute('data-currency') || '', true);
        syncMethodsFromDom();
        renderMethodsEditor();
      }
      return;
    }
    if (!e.target.classList.contains('admin-pm-qr-file')) return;
    var row = e.target.closest('.admin-pm-row');
    var cur = row.getAttribute('data-currency');
    var idx = parseInt(row.getAttribute('data-idx'), 10);
    var file = e.target.files && e.target.files[0];
    readQrFile(file, function (dataUrl) {
      if (!dataUrl) return;
      syncMethodsFromDom();
      var m = methodsData[cur][idx];
      m.qr_base64 = dataUrl;
      m.qr_preview = dataUrl;
      m.qr_remove = false;
      renderMethodsEditor();
    });
  });

  pmModal?.addEventListener('click', function (e) {
    if (e.target.getAttribute('data-pm-modal-close') === '1') {
      closePmUsersModal();
    }
  });

  pmModalTableBody?.addEventListener('change', function (e) {
    if (!e.target.classList.contains('admin-pm-user-check') || !pmModalTarget) return;
    onPmUserCheckChanged(e.target);
  });

  pmSelectAllVisible?.addEventListener('change', function () {
    if (!pmModalTarget) return;
    var selected = getSelectedUserIdsSet();
    var visible = filteredModalUsers();
    visible.forEach(function (u) {
      if (pmSelectAllVisible.checked) selected.add(u.id);
      else selected.delete(u.id);
    });
    setPmModalSelection(selected);
  });

  pmSelectAllBtn?.addEventListener('click', function () {
    if (!pmModalTarget) return;
    var selected = getSelectedUserIdsSet();
    filteredModalUsers().forEach(function (u) {
      selected.add(u.id);
    });
    setPmModalSelection(selected);
  });

  pmDeselectAllBtn?.addEventListener('click', function () {
    if (!pmModalTarget) return;
    setPmModalSelection(new Set());
  });

  pmModalFilter?.addEventListener('input', function () {
    clearTimeout(pmModalFilterDebounce);
    pmModalFilterDebounce = setTimeout(function () {
      if (!pmModalTarget) return;
      if (pmModalTarget.cur === 'ACCUM') {
        var q = (pmModalFilter?.value || '').trim();
        fetchUsersForModal(q).then(function (users) {
          if (!pmModalTarget || pmModalTarget.cur !== 'ACCUM') return;
          pmModalAllUsers = users;
          renderPmModalUsersTable();
        });
        return;
      }
      renderPmModalUsersTable();
    }, 250);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && pmModal && !pmModal.hidden) {
      closePmUsersModal();
    }
  });

  pmModalUsersInfoBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePmUsersModalInfoBox();
  });
  document.addEventListener('click', function (e) {
    if (!pmModalUsersInfoBox || pmModalUsersInfoBox.hidden) return;
    if (pmModalUsersInfoBtn?.contains(e.target) || pmModalUsersInfoBox.contains(e.target)) return;
    closePmUsersModalInfoBox();
  });

  function wirePmCurrencyInfo(btnId, boxId) {
    var btn = document.getElementById(btnId);
    var box = document.getElementById(boxId);
    if (!btn || !box) return;
    function closeBox() {
      box.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    function toggleBox() {
      var open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleBox();
    });
    document.addEventListener('click', function (e) {
      if (box.hidden) return;
      if (btn.contains(e.target) || box.contains(e.target)) return;
      closeBox();
    });
  }
  wirePmCurrencyInfo('adminPmMethodsCopInfoBtn', 'adminPmMethodsCopInfoBox');
  wirePmCurrencyInfo('adminPmMethodsUsdInfoBtn', 'adminPmMethodsUsdInfoBox');
  wirePmCurrencyInfo('adminPmMethodsAccumInfoBtn', 'adminPmMethodsAccumInfoBox');

  var autoInfoBtn = document.getElementById('adminRecargasAutoInfoBtn');
  var autoInfoBox = document.getElementById('adminRecargasAutoInfoBox');
  function closeAutoInfoBox() {
    if (!autoInfoBox || !autoInfoBtn) return;
    autoInfoBox.hidden = true;
    autoInfoBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleAutoInfoBox() {
    if (!autoInfoBox || !autoInfoBtn) return;
    var open = autoInfoBox.hidden;
    autoInfoBox.hidden = !open;
    autoInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  autoInfoBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleAutoInfoBox();
  });
  document.addEventListener('click', function (e) {
    if (!autoInfoBox || autoInfoBox.hidden) return;
    if (autoInfoBtn?.contains(e.target) || autoInfoBox.contains(e.target)) return;
    closeAutoInfoBox();
  });

  var accumInfoBtn = document.getElementById('adminRecargasAccumInfoBtn');
  var accumInfoBox = document.getElementById('adminRecargasAccumInfoBox');
  function closeAccumInfoBox() {
    if (!accumInfoBox || !accumInfoBtn) return;
    accumInfoBox.hidden = true;
    accumInfoBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleAccumInfoBox() {
    if (!accumInfoBox || !accumInfoBtn) return;
    var open = accumInfoBox.hidden;
    accumInfoBox.hidden = !open;
    accumInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  accumInfoBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleAccumInfoBox();
  });
  document.addEventListener('click', function (e) {
    if (!accumInfoBox || accumInfoBox.hidden) return;
    if (accumInfoBtn?.contains(e.target) || accumInfoBox.contains(e.target)) return;
    closeAccumInfoBox();
  });

  bindProofLightbox();

  activateTab(getStoredTabKey(), { skipPersist: true });
})();
