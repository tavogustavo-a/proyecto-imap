(function () {
  'use strict';

  var root = document.querySelector('.admin-recargas-page');
  if (!root) return;

  var listUrl = root.dataset.listUrl;
  var reviewUrlBase = (root.dataset.reviewUrlBase || '').replace(/\/0\/review$/, '');
  var methodsUrl = root.dataset.methodsUrl;
  var userMethodsUrl = root.dataset.userMethodsUrl;
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
    users: document.getElementById('adminRecargasPanelUsers'),
  };
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-tab');
      tabs.forEach(function (b) {
        b.classList.toggle('admin-recargas-tab--active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      Object.keys(panels).forEach(function (k) {
        if (panels[k]) panels[k].hidden = k !== key;
      });
      if (key === 'methods' && !methodsLoaded) loadPaymentMethodsEditor();
      if (key === 'review') loadRecharges();
    });
  });

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
  var methodsEditor = document.getElementById('adminPaymentMethodsEditor');
  var methodsMsg = document.getElementById('adminPaymentMethodsMsg');
  var methodsLoaded = false;
  var methodsData = { COP: [], USD: [] };

  function methodRowHtml(cur, m, idx) {
    return (
      '<div class="admin-pm-row" data-currency="' +
      cur +
      '" data-idx="' +
      idx +
      '">' +
      '<label><input type="checkbox" class="admin-pm-enabled" ' +
      (m.enabled ? 'checked' : '') +
      '> Activo</label>' +
      '<input type="text" class="form-control admin-pm-label" placeholder="Nombre (ej. Nequi, USDT)" value="' +
      escapeHtml(m.label || '') +
      '">' +
      '<input type="text" class="form-control admin-pm-details" placeholder="Datos de pago (cuenta, wallet…)" value="' +
      escapeHtml(m.details || '') +
      '">' +
      '<button type="button" class="btn-panel btn-red btn-sm admin-pm-remove">Quitar</button>' +
      '</div>'
    );
  }

  function renderMethodsEditor() {
    if (!methodsEditor) return;
    var html = '';
    ['COP', 'USD'].forEach(function (cur) {
      var title = cur === 'USD' ? 'USDT (USD)' : cur;
      html += '<h3 class="admin-pm-currency-title">' + title + '</h3>';
      html += '<div class="admin-pm-list" data-currency="' + cur + '">';
      (methodsData[cur] || []).forEach(function (m, i) {
        html += methodRowHtml(cur, m, i);
      });
      html += '</div>';
      html +=
        '<button type="button" class="btn-panel btn-blue btn-sm admin-pm-add" data-currency="' +
        cur +
        '">+ Añadir medio</button>';
    });
    methodsEditor.innerHTML = html;
  }

  function loadPaymentMethodsEditor() {
    fetch(methodsUrl, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) return;
        methodsData = data.methods || { COP: [], USD: [] };
        methodsLoaded = true;
        renderMethodsEditor();
      });
  }

  function collectMethodsFromEditor() {
    var out = { COP: [], USD: [] };
    ['COP', 'USD'].forEach(function (cur) {
      var list = methodsEditor.querySelector('.admin-pm-list[data-currency="' + cur + '"]');
      if (!list) return;
      list.querySelectorAll('.admin-pm-row').forEach(function (row, i) {
        out[cur].push({
          enabled: !!row.querySelector('.admin-pm-enabled')?.checked,
          label: (row.querySelector('.admin-pm-label')?.value || '').trim(),
          details: (row.querySelector('.admin-pm-details')?.value || '').trim(),
        });
      });
    });
    return out;
  }

  methodsEditor?.addEventListener('click', function (e) {
    if (e.target.classList.contains('admin-pm-add')) {
      var cur = e.target.getAttribute('data-currency');
      methodsData[cur] = methodsData[cur] || [];
      methodsData[cur].push({ label: '', details: '', enabled: true });
      renderMethodsEditor();
    }
    if (e.target.classList.contains('admin-pm-remove')) {
      var row = e.target.closest('.admin-pm-row');
      var cur = row.getAttribute('data-currency');
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      methodsData[cur].splice(idx, 1);
      renderMethodsEditor();
    }
  });

  document.getElementById('adminPaymentMethodsSave')?.addEventListener('click', function () {
    var payload = collectMethodsFromEditor();
    fetch(methodsUrl, {
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
          methodsData = data.methods || payload;
          renderMethodsEditor();
        }
      });
  });

  /* ——— Usuarios y medios ——— */
  var userSearch = document.getElementById('adminUserPmSearch');
  var userResults = document.getElementById('adminUserPmResults');
  var userSelected = document.getElementById('adminUserPmSelected');
  var userSelectedLabel = document.getElementById('adminUserPmSelectedLabel');
  var userCheckboxes = document.getElementById('adminUserPmCheckboxes');
  var userSaveBtn = document.getElementById('adminUserPmSave');
  var userMsg = document.getElementById('adminUserPmMsg');
  var selectedUserId = null;
  var userSearchDebounce = null;

  function renderUserCheckboxes(allMethods, selectedIds) {
    if (!userCheckboxes) return;
    var sel = selectedIds == null ? null : new Set(selectedIds || []);
    if (!allMethods.length) {
      userCheckboxes.innerHTML = '<p class="text-muted">No hay medios configurados para la moneda de este usuario.</p>';
      return;
    }
    userCheckboxes.innerHTML = allMethods
      .map(function (m) {
        var checked = sel === null || sel.has(m.id);
        return (
          '<label class="admin-user-pm-check">' +
          '<input type="checkbox" class="admin-user-pm-cb" value="' +
          escapeHtml(m.id) +
          '" ' +
          (checked ? 'checked' : '') +
          '> ' +
          escapeHtml(m.label) +
          '</label>'
        );
      })
      .join('');
  }

  function loadUserPaymentMethods(username) {
    fetch(userMethodsUrl + '?username=' + encodeURIComponent(username), {
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) {
          showMsg(userMsg, data.message, true);
          return;
        }
        selectedUserId = data.user_id;
        if (userSelectedLabel) userSelectedLabel.textContent = data.username;
        if (userSelected) userSelected.hidden = false;
        if (userSaveBtn) userSaveBtn.disabled = false;
        renderUserCheckboxes(data.all_methods || [], data.payment_method_ids);
      });
  }

  userSearch?.addEventListener('input', function () {
    clearTimeout(userSearchDebounce);
    var q = userSearch.value.trim();
    if (q.length < 1) {
      if (userResults) userResults.hidden = true;
      return;
    }
    userSearchDebounce = setTimeout(function () {
      fetch(searchUsersUrl + '?query=' + encodeURIComponent(q), { credentials: 'same-origin' })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!userResults) return;
          userResults.innerHTML = '';
          if (data.status !== 'ok' || !data.users || !data.users.length) {
            userResults.innerHTML = '<p class="purchase-history-cleanup-user-empty">Sin coincidencias</p>';
          } else {
            data.users.forEach(function (u) {
              var btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'purchase-history-cleanup-user-row';
              btn.textContent = u.username;
              btn.addEventListener('click', function () {
                userResults.hidden = true;
                userSearch.value = u.username;
                loadUserPaymentMethods(u.username);
              });
              userResults.appendChild(btn);
            });
          }
          userResults.hidden = false;
        });
    }, 280);
  });

  userSaveBtn?.addEventListener('click', function () {
    if (!selectedUserId) return;
    var boxes = userCheckboxes.querySelectorAll('.admin-user-pm-cb');
    var allChecked = true;
    var ids = [];
    boxes.forEach(function (cb) {
      if (cb.checked) ids.push(cb.value);
      else allChecked = false;
    });
    var payload = {
      user_id: selectedUserId,
      payment_method_ids: allChecked && boxes.length ? null : ids,
    };
    fetch(userMethodsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        showMsg(userMsg, data.message, !data.success);
      });
  });

  loadRecharges();
})();
