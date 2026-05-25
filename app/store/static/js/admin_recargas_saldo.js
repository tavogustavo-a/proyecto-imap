(function () {
  'use strict';

  var root = document.querySelector('.admin-recargas-page');
  if (!root) return;

  var listUrl = root.dataset.listUrl;
  var reviewUrlBase = (root.dataset.reviewUrlBase || '').replace(/\/0\/review$/, '');
  var methodsUrl = root.dataset.methodsUrl;
  var searchUsersUrl = root.dataset.searchUsersUrl || '/admin/search_users_ajax';

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function fmtAmount(n, cur) {
    if (n == null || isNaN(n)) return '—';
    var label = cur === 'USD' ? 'USDT' : cur;
    return '$' + Number(n).toLocaleString('es-CO') + ' ' + label;
  }

  function showMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mt-05 ' + (isError ? 'text-danger' : 'text-success');
  }

  /* ——— Tabs ——— */
  var tabs = root.querySelectorAll('.admin-recargas-tab');
  var panels = {
    review: document.getElementById('adminRecargasPanelReview'),
    methods: document.getElementById('adminRecargasPanelMethods'),
  };
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-tab');
      tabs.forEach(function (b) {
        var isActive = b.getAttribute('data-tab') === key;
        b.classList.toggle('admin-recargas-tab--active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      Object.keys(panels).forEach(function (k) {
        if (panels[k]) panels[k].hidden = k !== key;
      });
      if (key === 'methods' && !methodsLoaded) loadPaymentMethodsEditor();
      if (key === 'review') loadRecharges();
    });
  });

  var menuToggleReview = document.getElementById('menuToggleBtn');
  var menu2ToggleReview = document.getElementById('menu2ToggleBtn');
  var menuToggleMethods = document.getElementById('menuToggleBtnMethods');
  var menu2ToggleMethods = document.getElementById('menu2ToggleBtnMethods');
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

  /* ——— Revisión consignaciones ——— */
  var filterEl = document.getElementById('adminRecargasFilter');
  var listEl = document.getElementById('adminRecargasList');
  var pendingEl = document.getElementById('adminRecargasPendingCount');

  function reviewUrl(id) {
    return reviewUrlBase + '/' + id + '/review';
  }

  function renderRechargeCard(it) {
    var proofs = '';
    if (it.proof_urls && it.proof_urls.length) {
      proofs =
        '<div class="admin-recarga-proofs">' +
        it.proof_urls
          .map(function (u, i) {
            return (
              '<a href="' +
              u +
              '" target="_blank" rel="noopener"><img src="' +
              u +
              '" alt="" class="admin-recarga-proof-thumb" loading="lazy"></a>'
            );
          })
          .join('') +
        '</div>';
    }
    var actions =
      it.status === 'pending'
        ? '<div class="admin-recarga-actions">' +
          '<label class="form-label">Monto a acreditar</label>' +
          '<input type="number" class="form-control admin-recarga-amount-input" data-id="' +
          it.id +
          '" value="' +
          (it.amount_claimed != null ? it.amount_claimed : '') +
          '" min="1" step="1">' +
          '<label class="form-label mt-05">Nota admin (opcional)</label>' +
          '<input type="text" class="form-control admin-recarga-note-input" data-id="' +
          it.id +
          '" maxlength="500" placeholder="Motivo o referencia">' +
          '<div class="d-flex gap-2 mt-2 flex-wrap">' +
          '<button type="button" class="btn-panel btn-green btn-sm admin-recarga-approve" data-id="' +
          it.id +
          '">Aprobar y acreditar</button>' +
          '<button type="button" class="btn-panel btn-red btn-sm admin-recarga-reject" data-id="' +
          it.id +
          '">Rechazar</button>' +
          '</div></div>'
        : '<p class="admin-recarga-reviewed-note"><strong>Nota:</strong> ' +
          escapeHtml(it.admin_note || '—') +
          '</p>';

    return (
      '<article class="admin-recarga-card admin-recarga-card--' +
      escapeHtml(it.status) +
      '">' +
      '<div class="admin-recarga-card-head">' +
      '<span class="admin-recarga-user">' +
      escapeHtml(it.username || '—') +
      '</span>' +
      '<span class="admin-recarga-status">' +
      escapeHtml(it.status_label) +
      '</span>' +
      '</div>' +
      '<p class="admin-recarga-meta">' +
      escapeHtml(it.created_at) +
      ' · ' +
      escapeHtml(fmtAmount(it.amount_claimed, it.currency)) +
      ' · <strong>' +
      escapeHtml(it.payment_method_label || '—') +
      '</strong></p>' +
      proofs +
      actions +
      '</article>'
    );
  }

  function loadRecharges() {
    if (!listEl) return;
    var st = filterEl ? filterEl.value : 'pending';
    listEl.innerHTML = '<p class="text-muted">Cargando…</p>';
    fetch(listUrl + '?status=' + encodeURIComponent(st), { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          listEl.innerHTML = '<p class="text-danger">Error al cargar.</p>';
          return;
        }
        if (pendingEl) pendingEl.textContent = String(data.pending_count || 0);
        var items = data.items || [];
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

  function doReview(id, action) {
    var card = listEl && listEl.querySelector('.admin-recarga-card--pending, .admin-recarga-card');
    var amountInp = listEl.querySelector('.admin-recarga-amount-input[data-id="' + id + '"]');
    var noteInp = listEl.querySelector('.admin-recarga-note-input[data-id="' + id + '"]');
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
      });
  }

  if (listEl) {
    listEl.addEventListener('click', function (e) {
      var appr = e.target.closest('.admin-recarga-approve');
      var rej = e.target.closest('.admin-recarga-reject');
      if (appr) {
        var id = parseInt(appr.getAttribute('data-id'), 10);
        if (!window.confirm('¿Aprobar y acreditar saldo al usuario?')) return;
        doReview(id, 'approve');
      }
      if (rej) {
        var id2 = parseInt(rej.getAttribute('data-id'), 10);
        if (!window.confirm('¿Rechazar esta solicitud?')) return;
        doReview(id2, 'reject');
      }
    });
  }
  document.getElementById('adminRecargasRefresh')?.addEventListener('click', loadRecharges);
  filterEl?.addEventListener('change', loadRecharges);

  /* ——— Medios de pago ——— */
  var methodsPanel = document.getElementById('adminRecargasPanelMethods');
  var methodsMsg = document.getElementById('adminPaymentMethodsMsg');
  var methodsLoaded = false;
  var methodsData = { COP: [], USD: [] };
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

  function normalizeMethodEntry(m) {
    var ids = null;
    if (Array.isArray(m.allowed_user_ids)) {
      ids = m.allowed_user_ids.slice();
    }
    var users = Array.isArray(m.allowed_users) ? m.allowed_users.slice() : [];
    if (!users.length && ids && ids.length) {
      users = ids.map(function (id) {
        return { id: id, username: String(id) };
      });
    }
    return {
      id: m.id || '',
      enabled: m.enabled !== false,
      label: m.label || '',
      details: m.details || '',
      allowed_user_ids: ids,
      allowed_users: users,
      qr_filename: m.qr_filename || '',
      qr_url: m.qr_url || '',
      qr_base64: m.qr_base64 || '',
      qr_remove: !!m.qr_remove,
      qr_preview: m.qr_preview || '',
    };
  }

  function pmUsersButtonLabel() {
    return 'Usuarios';
  }

  function pmQrPreviewSrc(m) {
    if (m.qr_preview) return m.qr_preview;
    if (m.qr_url && !m.qr_remove) return m.qr_url;
    return '';
  }

  function pmListForCurrency(cur) {
    var wrapClass =
      cur === 'COP' ? '.admin-recargas-pm-cop-wrap' : '.admin-recargas-pm-usd-wrap';
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

  function syncMethodsFromDom() {
    ['COP', 'USD'].forEach(function (cur) {
      var list = pmListForCurrency(cur);
      if (!list) return;
      var updated = [];
      list.querySelectorAll('.admin-pm-row').forEach(function (row, i) {
        var prev = (methodsData[cur] && methodsData[cur][i]) || {};
        updated.push(
          normalizeMethodEntry({
            id: prev.id || row.getAttribute('data-id') || '',
            enabled: !!row.querySelector('.admin-pm-enabled')?.checked,
            label: (row.querySelector('.admin-pm-label')?.value || '').trim(),
            details: (row.querySelector('.admin-pm-details')?.value || '').trim(),
            allowed_user_ids: prev.allowed_user_ids,
            allowed_users: prev.allowed_users,
            qr_filename: prev.qr_filename,
            qr_url: prev.qr_url,
            qr_base64: prev.qr_base64,
            qr_remove: prev.qr_remove,
            qr_preview: prev.qr_preview,
          })
        );
      });
      methodsData[cur] = updated;
    });
  }

  function pmFieldId(cur, idx, suffix) {
    return 'admin-pm-' + cur + '-' + idx + '-' + suffix;
  }

  function methodRowHtml(cur, m, idx) {
    var fieldEnabled = pmFieldId(cur, idx, 'enabled');
    var fieldName = pmFieldId(cur, idx, 'name');
    var fieldDetails = pmFieldId(cur, idx, 'details');
    var fieldQr = pmFieldId(cur, idx, 'qr');
    var qrSrc = pmQrPreviewSrc(m);
    var qrBlock =
      '<div class="admin-pm-qr-wrap">' +
      (qrSrc
        ? '<span class="admin-pm-qr-label"><i class="fas fa-qrcode" aria-hidden="true"></i> QR</span>' +
          '<div class="admin-pm-qr-preview"><img src="' +
          escapeHtml(qrSrc) +
          '" alt="QR" class="admin-pm-qr-img"><button type="button" class="btn-panel btn-red btn-sm admin-pm-qr-remove">Quitar QR</button></div>'
        : '<label class="admin-pm-qr-label" for="' +
          fieldQr +
          '"><i class="fas fa-qrcode" aria-hidden="true"></i> QR</label>' +
          '<input type="file" id="' +
          fieldQr +
          '" name="pm_qr_' +
          cur +
          '_' +
          idx +
          '" class="form-control admin-pm-qr-file" accept="image/jpeg,image/png,image/webp,image/gif">') +
      '</div>';
    return (
      '<div class="admin-pm-row" data-currency="' +
      cur +
      '" data-idx="' +
      idx +
      '" data-id="' +
      escapeHtml(m.id || '') +
      '">' +
      '<label class="admin-pm-active" for="' +
      fieldEnabled +
      '"><input type="checkbox" id="' +
      fieldEnabled +
      '" name="pm_enabled_' +
      cur +
      '_' +
      idx +
      '" class="admin-pm-enabled" ' +
      (m.enabled ? 'checked' : '') +
      '> Activo</label>' +
      '<label class="admin-pm-field-label admin-pm-field-label--name">' +
      '<span class="sr-only">Nombre del medio</span>' +
      '<input type="text" id="' +
      fieldName +
      '" name="pm_name_' +
      cur +
      '_' +
      idx +
      '" class="form-control admin-pm-label" placeholder="Nombre (ej. Nequi, USDT)" value="' +
      escapeHtml(m.label || '') +
      '"></label>' +
      '<label class="admin-pm-field-label admin-pm-field-label--details">' +
      '<span class="sr-only">Datos de pago</span>' +
      '<input type="text" id="' +
      fieldDetails +
      '" name="pm_details_' +
      cur +
      '_' +
      idx +
      '" class="form-control admin-pm-details" placeholder="Datos de pago (cuenta, wallet…)" value="' +
      escapeHtml(m.details || '') +
      '"></label>' +
      qrBlock +
      '<div class="admin-pm-actions">' +
      '<button type="button" class="btn-panel btn-green btn-sm admin-pm-save" title="Guardar cambios">Guardar</button>' +
      '<button type="button" class="btn-panel btn-blue btn-sm admin-pm-users" title="Usuarios que pueden ver este medio">' +
      escapeHtml(pmUsersButtonLabel()) +
      '</button>' +
      '<button type="button" class="btn-panel btn-red btn-sm admin-pm-remove" title="Quitar medio" aria-label="Quitar medio"><i class="fas fa-times" aria-hidden="true"></i></button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderMethodsEditor() {
    renderCurrencyList('COP');
    renderCurrencyList('USD');
  }

  function loadPaymentMethodsEditor() {
    fetch(methodsUrl, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) return;
        var raw = data.methods || { COP: [], USD: [] };
        methodsData = { COP: [], USD: [] };
        ['COP', 'USD'].forEach(function (cur) {
          methodsData[cur] = (raw[cur] || []).map(normalizeMethodEntry);
        });
        methodsLoaded = true;
        renderMethodsEditor();
      });
  }

  function collectMethodsFromEditor() {
    syncMethodsFromDom();
    var out = { COP: [], USD: [] };
    ['COP', 'USD'].forEach(function (cur) {
      (methodsData[cur] || []).forEach(function (m) {
        var row = {
          id: m.id || undefined,
          enabled: !!m.enabled,
          label: m.label || '',
          details: m.details || '',
          allowed_user_ids: Array.isArray(m.allowed_user_ids) ? m.allowed_user_ids : null,
        };
        if (m.qr_base64) row.qr_base64 = m.qr_base64;
        if (m.qr_remove) row.qr_remove = true;
        out[cur].push(row);
      });
    });
    return out;
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

  function normalizeUserPriceType(u) {
    var raw = u.tipo_precio_rol || u.tipo_precio || '';
    raw = String(raw).trim().toUpperCase();
    if (raw === 'USD' || raw === 'USDT') return 'USD';
    if (raw === 'COP') return 'COP';
    return '';
  }

  function fetchAllUsersForModal() {
    return fetch(searchUsersUrl + '?query=', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.status !== 'ok' || !data.users) return [];
        return data.users.map(function (u) {
          return {
            id: parseInt(u.id, 10),
            username: u.username || '',
            full_name: u.full_name || '',
            price_type: normalizeUserPriceType(u),
          };
        });
      })
      .catch(function () {
        return [];
      });
  }

  function getSelectedUserIdsSet() {
    if (!pmModalTarget) return new Set();
    var m = methodsData[pmModalTarget.cur][pmModalTarget.idx];
    if (Array.isArray(m.allowed_user_ids)) {
      return new Set(
        m.allowed_user_ids.map(function (id) {
          return parseInt(id, 10);
        })
      );
    }
    if (m.allowed_users && m.allowed_users.length) {
      return new Set(
        m.allowed_users.map(function (u) {
          return parseInt(u.id, 10);
        })
      );
    }
    return new Set();
  }

  function applySelectedIdsToMethod(selectedSet) {
    if (!pmModalTarget) return;
    var m = methodsData[pmModalTarget.cur][pmModalTarget.idx];
    if (!selectedSet.size) {
      m.allowed_users = [];
      m.allowed_user_ids = null;
      return;
    }
    m.allowed_users = pmModalAllUsers.filter(function (u) {
      return selectedSet.has(u.id);
    });
    m.allowed_user_ids = m.allowed_users.map(function (u) {
      return u.id;
    });
  }

  function modalCurrencyFilter() {
    if (!pmModalTarget || !pmModalTarget.cur) return '';
    return pmModalTarget.cur === 'USD' ? 'USD' : 'COP';
  }

  function filteredModalUsers() {
    var q = (pmModalFilter?.value || '').trim().toLowerCase();
    var priceFilter = modalCurrencyFilter();
    return pmModalAllUsers.filter(function (u) {
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
      return selected.has(u.id);
    }).length;
    pmSelectAllVisible.checked = selectedVisible === visibleUsers.length;
    pmSelectAllVisible.indeterminate = selectedVisible > 0 && selectedVisible < visibleUsers.length;
  }

  function renderPmModalUsersTable() {
    if (!pmModalTableBody || !pmModalTarget) return;
    var users = filteredModalUsers();
    var selected = getSelectedUserIdsSet();
    if (!pmModalAllUsers.length) {
      pmModalTableBody.innerHTML =
        '<tr><td colspan="3" class="admin-pm-users-empty">No se pudieron cargar usuarios.</td></tr>';
      updatePmSelectAllHeader(selected, users);
      return;
    }
    if (!users.length) {
      pmModalTableBody.innerHTML =
        '<tr><td colspan="3" class="admin-pm-users-empty">Sin coincidencias.</td></tr>';
      updatePmSelectAllHeader(selected, users);
      return;
    }
    pmModalTableBody.innerHTML = users
      .map(function (u) {
        var checked = selected.has(u.id);
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
          '</tr>'
        );
      })
      .join('');
    updatePmSelectAllHeader(selected, users);
  }

  function setPmModalSelection(selectedSet) {
    applySelectedIdsToMethod(selectedSet);
    renderPmModalUsersTable();
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
    if (pmModalTitleText) {
      pmModalTitleText.textContent = 'Usuarios · ' + (m.label || 'Medio');
    }
    closePmUsersModalInfoBox();
    if (pmModalFilter) pmModalFilter.value = '';
    if (pmModalTableBody) {
      pmModalTableBody.innerHTML =
        '<tr><td colspan="3" class="admin-pm-users-empty">Cargando usuarios…</td></tr>';
    }
    if (pmModal) {
      pmModal.hidden = false;
      pmModal.classList.remove('d-none');
    }
    fetchAllUsersForModal().then(function (users) {
      if (!pmModalTarget || pmModalTarget.cur !== cur || pmModalTarget.idx !== idx) return;
      pmModalAllUsers = users;
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
    renderMethodsEditor();
    closePmUsersModalInfoBox();
    pmModalTarget = null;
    if (pmModal) {
      pmModal.hidden = true;
      pmModal.classList.add('d-none');
    }
  }

  function savePaymentMethods() {
    var payload = collectMethodsFromEditor();
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
        showMsg(methodsMsg, data.message || (data.success ? 'Guardado.' : 'Error'), !data.success);
        if (data.success) {
          loadPaymentMethodsEditor();
        }
        return data;
      });
  }

  methodsPanel?.addEventListener('click', function (e) {
    if (e.target.classList.contains('admin-pm-add')) {
      syncMethodsFromDom();
      var cur = e.target.getAttribute('data-currency');
      methodsData[cur] = methodsData[cur] || [];
      methodsData[cur].push(
        normalizeMethodEntry({ label: '', details: '', enabled: true, allowed_user_ids: null })
      );
      renderMethodsEditor();
    }
    if (e.target.closest('.admin-pm-remove')) {
      syncMethodsFromDom();
      var row = e.target.closest('.admin-pm-row');
      var cur = row.getAttribute('data-currency');
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      methodsData[cur].splice(idx, 1);
      renderMethodsEditor();
    }
    if (e.target.closest('.admin-pm-save')) {
      savePaymentMethods();
    }
    if (e.target.closest('.admin-pm-users')) {
      var rowU = e.target.closest('.admin-pm-row');
      openPmUsersModal(rowU.getAttribute('data-currency'), parseInt(rowU.getAttribute('data-idx'), 10));
    }
    if (e.target.classList.contains('admin-pm-qr-remove')) {
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

  methodsPanel?.addEventListener('change', function (e) {
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
    var uid = parseInt(e.target.getAttribute('data-user-id'), 10);
    var selected = getSelectedUserIdsSet();
    if (e.target.checked) selected.add(uid);
    else selected.delete(uid);
    setPmModalSelection(selected);
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
    pmModalFilterDebounce = setTimeout(renderPmModalUsersTable, 120);
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

  var pmMethodsInfoBtn = document.getElementById('adminPmMethodsInfoBtn');
  var pmMethodsInfoBox = document.getElementById('adminPmMethodsInfoBox');
  function closePmMethodsInfoBox() {
    if (!pmMethodsInfoBox || !pmMethodsInfoBtn) return;
    pmMethodsInfoBox.hidden = true;
    pmMethodsInfoBtn.setAttribute('aria-expanded', 'false');
  }
  function togglePmMethodsInfoBox() {
    if (!pmMethodsInfoBox || !pmMethodsInfoBtn) return;
    var open = pmMethodsInfoBox.hidden;
    pmMethodsInfoBox.hidden = !open;
    pmMethodsInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  pmMethodsInfoBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePmMethodsInfoBox();
  });
  document.addEventListener('click', function (e) {
    if (!pmMethodsInfoBox || pmMethodsInfoBox.hidden) return;
    if (pmMethodsInfoBtn?.contains(e.target) || pmMethodsInfoBox.contains(e.target)) return;
    closePmMethodsInfoBox();
  });

  loadRecharges();
})();
