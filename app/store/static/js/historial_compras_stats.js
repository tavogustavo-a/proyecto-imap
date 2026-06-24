/**
 * Panel de estadísticas en historial de compras (admin o usuario propio).
 */
document.addEventListener('DOMContentLoaded', function () {
  const panel = document.getElementById('purchaseHistoryStatsPanel');
  if (!panel) return;

  const selfMode = panel.dataset.statsSelf === '1';
  const statsUrl = panel.dataset.statsUrl;
  const searchUsersUrl = panel.dataset.searchUsersUrl || '/admin/search_users_ajax';
  const scopeSelect = document.getElementById('phStatsScope');
  const proveedorScopeWrap = document.getElementById('phStatsProveedorScopeWrap');
  const proveedorScopeSelect = document.getElementById('phStatsProveedorScope');
  const userWrap = document.getElementById('phStatsUserWrap');
  const userIdInput = document.getElementById('phStatsUserId');
  const userSearchInput = document.getElementById('phStatsUserSearch');
  const userResultsEl = document.getElementById('phStatsUserResults');
  const userSelectedWrap = document.getElementById('phStatsUserSelected');
  const userSelectedLabel = document.getElementById('phStatsUserSelectedLabel');
  const userClearBtn = document.getElementById('phStatsUserClear');
  const proveedorUserWrap = document.getElementById('phStatsProveedorUserWrap');
  const proveedorUserIdInput = document.getElementById('phStatsProveedorUserId');
  const proveedorUserSearchInput = document.getElementById('phStatsProveedorUserSearch');
  const proveedorUserResultsEl = document.getElementById('phStatsProveedorUserResults');
  const proveedorUserSelectedWrap = document.getElementById('phStatsProveedorUserSelected');
  const proveedorUserSelectedLabel = document.getElementById('phStatsProveedorUserSelectedLabel');
  const proveedorUserClearBtn = document.getElementById('phStatsProveedorUserClear');
  const periodToggle = document.getElementById('phStatsPeriodToggle');
  const periodPopover = document.getElementById('phStatsPeriodPopover');
  const periodDisplay = document.getElementById('phStatsPeriodDisplay');
  const dateFromInput = document.getElementById('phStatsDateFrom');
  const dateToInput = document.getElementById('phStatsDateTo');
  const periodApplyPopover = document.getElementById('phStatsPeriodApplyPopover');
  const applyBtn = document.getElementById('phStatsApplyBtn');
  const errorEl = document.getElementById('phStatsError');
  const contentEl = document.getElementById('phStatsContent');
  const summaryCards = document.getElementById('phStatsSummaryCards');
  const salesTable = document.querySelector('#phStatsSalesTable tbody');
  const activityTable = document.querySelector('#phStatsActivityTable tbody');

  let lastProveedorServiciosPayload = null;

  function initStatsSalesHeaderTips() {
    const salesHead = document.getElementById('phStatsSalesTable');
    if (!salesHead) return;
    const tips = salesHead.querySelectorAll('.purchase-history-stats-th-tip');
    if (!tips.length) return;

    let floater = document.getElementById('phStatsHeaderTipFloater');
    if (!floater) {
      floater = document.createElement('div');
      floater.id = 'phStatsHeaderTipFloater';
      floater.className = 'purchase-history-stats-th-floater';
      floater.hidden = true;
      document.body.appendChild(floater);
    }

    function hideFloater() {
      floater.hidden = true;
    }

    function showFloater(el) {
      const text = (el.getAttribute('data-tip') || el.getAttribute('title') || '').trim();
      if (!text) return;
      floater.textContent = text;
      floater.hidden = false;
      const rect = el.getBoundingClientRect();
      floater.style.left = rect.left + rect.width / 2 + 'px';
      floater.style.top = rect.bottom + 6 + 'px';
    }

    tips.forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        showFloater(el);
      });
      el.addEventListener('mouseleave', hideFloater);
      el.addEventListener('focus', function () {
        showFloater(el);
      });
      el.addEventListener('blur', hideFloater);
    });
  }

  initStatsSalesHeaderTips();

  let userSearchDebounce = null;
  let proveedorUserSearchDebounce = null;

  const ACTIVITY_LABELS = {
    caidas: 'Caídas',
    renovaciones_actividad: 'Renovaciones',
    proveedores: 'Resúmenes proveedor',
  };

  const ACTIVITY_TABLE_ORDER = ['caidas', 'renovaciones_actividad', 'proveedores'];

  function viewerIsProveedor() {
    return panel && panel.dataset.viewerIsProveedor === '1';
  }

  function statsScopeValue() {
    if (selfMode) return 'user';
    return scopeSelect ? scopeSelect.value : 'all';
  }

  function isSingleProveedorScope() {
    if (selfMode) return false;
    if (statsScopeValue() !== 'proveedor') return false;
    return !!(
      proveedorScopeSelect &&
      proveedorScopeSelect.value === 'user' &&
      proveedorUserIdInput &&
      proveedorUserIdInput.value
    );
  }

  function isUnifiedProveedorView() {
    return selfMode && viewerIsProveedor();
  }

  function showProveedorStatsUi() {
    if (isUnifiedProveedorView()) return false;
    if (selfMode) return viewerIsProveedor();
    const scopeVal = statsScopeValue();
    return scopeVal === 'proveedor' || scopeVal === 'all';
  }

  function activityTableOrder() {
    if (isSingleProveedorScope()) return ['proveedores'];
    if (isUnifiedProveedorView()) return ['caidas', 'renovaciones_actividad', 'proveedores'];
    if (!showProveedorStatsUi()) {
      return ['caidas', 'renovaciones_actividad'];
    }
    return ACTIVITY_TABLE_ORDER;
  }

  function updateSalesSubtitle() {
    const el = document.getElementById('phStatsSalesSubtitle');
    if (!el) return;
    if (isSingleProveedorScope()) {
      el.textContent = 'Servicios proveedor';
      return;
    }
    if (selfMode) {
      el.textContent = 'Ventas por servicio';
      return;
    }
    el.textContent =
      statsScopeValue() === 'proveedor'
        ? 'Ventas por servicio proveedor'
        : 'Ventas por servicio';
  }

  function toggleStatsViewMode() {
    const singleProv = isSingleProveedorScope();
    if (contentEl) {
      contentEl.classList.toggle('purchase-history-stats-content--single-proveedor', singleProv);
    }
    panel.querySelectorAll('#phStatsSalesTable .ph-stats-col-general').forEach(function (th) {
      th.hidden = singleProv;
    });
    updateSalesSubtitle();
  }

  function salesTableColCount() {
    if (isSingleProveedorScope()) return 2;
    return 5;
  }

  function salesRowHtml(r) {
    if (isSingleProveedorScope()) {
      return (
        '<td>' +
        escapeHtml(r.producto) +
        '</td><td class="text-center">' +
        (Number(r.proveedores) || 0) +
        '</td>'
      );
    }
    let html =
      '<td>' +
      escapeHtml(r.producto) +
      '</td><td class="text-center">' +
      escapeHtml(r.moneda || 'COP') +
      '</td><td class="text-center">' +
      r.ventas +
      '</td><td class="text-center">' +
      r.renovaciones +
      '</td><td>' +
      formatMoney(r.total, r.moneda) +
      '</td>';
    return html;
  }

  function formatMoney(n, currency) {
    const x = Number(n);
    if (Number.isNaN(x)) return '$0';
    const cur = String(currency || 'COP').toUpperCase();
    const suffix = cur === 'USD' ? ' USD' : ' COP';
    return (
      '$' +
      x.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) +
      suffix
    );
  }

  function toInputDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatDisplayDate(iso) {
    if (!iso) return '—';
    const parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function updatePeriodDisplayLabel() {
    if (!periodDisplay || !dateFromInput || !dateToInput) return;
    const from = dateFromInput.value;
    const to = dateToInput.value;
    if (from && to) {
      periodDisplay.textContent = formatDisplayDate(from) + ' — ' + formatDisplayDate(to);
    } else {
      periodDisplay.textContent = 'Selecciona fechas';
    }
  }

  function setPresetDays(days) {
    const today = new Date();
    const to = toInputDate(today);
    if (String(days) === 'all') {
      if (dateFromInput) dateFromInput.value = '2020-01-01';
      if (dateToInput) dateToInput.value = to;
      updatePeriodDisplayLabel();
      return;
    }
    const n = parseInt(days, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const start = new Date(today);
    start.setDate(start.getDate() - n);
    if (dateFromInput) dateFromInput.value = toInputDate(start);
    if (dateToInput) dateToInput.value = to;
    updatePeriodDisplayLabel();
  }

  function openPeriodPopover() {
    if (!periodPopover || !periodToggle) return;
    periodPopover.hidden = false;
    periodToggle.setAttribute('aria-expanded', 'true');
  }

  function closePeriodPopover() {
    if (!periodPopover || !periodToggle) return;
    periodPopover.hidden = true;
    periodToggle.setAttribute('aria-expanded', 'false');
  }

  function togglePeriodPopover() {
    if (!periodPopover) return;
    if (periodPopover.hidden) openPeriodPopover();
    else closePeriodPopover();
  }

  function initPeriodDefaults() {
    setPresetDays(30);
  }

  function showStatsError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }

  function toggleScopeWraps() {
    const scope = scopeSelect ? scopeSelect.value : 'all';
    if (userWrap) userWrap.hidden = scope !== 'user';
    if (proveedorScopeWrap) proveedorScopeWrap.hidden = scope !== 'proveedor';
    if (scope !== 'user') clearSelectedUser();
    if (scope !== 'proveedor') {
      clearSelectedProveedorUser();
      if (proveedorUserWrap) proveedorUserWrap.hidden = true;
    } else {
      toggleProveedorUserWrap();
    }
  }

  function toggleProveedorUserWrap() {
    if (!proveedorUserWrap || !proveedorScopeSelect) return;
    proveedorUserWrap.hidden = proveedorScopeSelect.value !== 'user';
    if (proveedorScopeSelect.value !== 'user') clearSelectedProveedorUser();
  }

  function toggleUserWrap() {
    toggleScopeWraps();
  }

  function clearSelectedUser() {
    if (userIdInput) userIdInput.value = '';
    if (userSearchInput) userSearchInput.value = '';
    if (userSelectedWrap) userSelectedWrap.hidden = true;
    if (userSelectedLabel) userSelectedLabel.textContent = '';
    hideUserResults();
  }

  function hideUserResults() {
    if (!userResultsEl) return;
    userResultsEl.hidden = true;
    userResultsEl.innerHTML = '';
  }

  function setSelectedUser(user) {
    if (!user || user.id == null) return;
    if (userIdInput) userIdInput.value = String(user.id);
    if (userSelectedLabel) userSelectedLabel.textContent = user.username || '';
    if (userSelectedWrap) userSelectedWrap.hidden = false;
    if (userSearchInput) userSearchInput.value = '';
    hideUserResults();
  }

  function clearSelectedProveedorUser() {
    if (proveedorUserIdInput) proveedorUserIdInput.value = '';
    if (proveedorUserSearchInput) proveedorUserSearchInput.value = '';
    if (proveedorUserSelectedWrap) proveedorUserSelectedWrap.hidden = true;
    if (proveedorUserSelectedLabel) proveedorUserSelectedLabel.textContent = '';
    hideProveedorUserResults();
    toggleStatsViewMode();
  }

  function hideProveedorUserResults() {
    if (!proveedorUserResultsEl) return;
    proveedorUserResultsEl.hidden = true;
    proveedorUserResultsEl.innerHTML = '';
  }

  function setSelectedProveedorUser(user) {
    if (!user || user.id == null) return;
    if (proveedorUserIdInput) proveedorUserIdInput.value = String(user.id);
    if (proveedorUserSelectedLabel) proveedorUserSelectedLabel.textContent = user.username || '';
    if (proveedorUserSelectedWrap) proveedorUserSelectedWrap.hidden = false;
    if (proveedorUserSearchInput) proveedorUserSearchInput.value = '';
    hideProveedorUserResults();
    toggleStatsViewMode();
  }

  async function searchProveedorUsers(query) {
    const q = (query || '').trim();
    if (q.length < 1) {
      hideProveedorUserResults();
      return;
    }
    try {
      const res = await fetch(searchUsersUrl + '?query=' + encodeURIComponent(q), {
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!proveedorUserResultsEl) return;
      proveedorUserResultsEl.innerHTML = '';
      const users = (data.status === 'ok' && data.users ? data.users : []).filter(function (u) {
        return u && u.proveedor;
      });
      if (!users.length) {
        proveedorUserResultsEl.innerHTML =
          '<p class="purchase-history-cleanup-user-empty">Sin proveedores con ese nombre.</p>';
        proveedorUserResultsEl.hidden = false;
        return;
      }
      users.slice(0, 40).forEach(function (u) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'purchase-history-cleanup-user-row';
        btn.dataset.userId = String(u.id);
        btn.dataset.username = u.username || '';
        const main = document.createElement('span');
        main.className = 'purchase-history-cleanup-user-row-main';
        main.textContent = u.username || '—';
        btn.appendChild(main);
        proveedorUserResultsEl.appendChild(btn);
      });
      proveedorUserResultsEl.hidden = false;
    } catch (_e) {
      hideProveedorUserResults();
    }
  }

  async function searchUsers(query) {
    const q = (query || '').trim();
    if (q.length < 1) {
      hideUserResults();
      return;
    }
    try {
      const res = await fetch(searchUsersUrl + '?query=' + encodeURIComponent(q), {
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!userResultsEl) return;
      userResultsEl.innerHTML = '';
      if (data.status !== 'ok' || !data.users || !data.users.length) {
        userResultsEl.innerHTML = '<p class="purchase-history-cleanup-user-empty">Sin coincidencias.</p>';
        userResultsEl.hidden = false;
        return;
      }
      data.users.slice(0, 40).forEach(function (u) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'purchase-history-cleanup-user-row';
        btn.dataset.userId = String(u.id);
        btn.dataset.username = u.username || '';
        const main = document.createElement('span');
        main.className = 'purchase-history-cleanup-user-row-main';
        main.textContent = u.username || '—';
        btn.appendChild(main);
        userResultsEl.appendChild(btn);
      });
      userResultsEl.hidden = false;
    } catch (_e) {
      hideUserResults();
    }
  }

  function formatCardValue(v) {
    if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) {
      return 0;
    }
    return v;
  }

  function removeStaleSummaryCards() {
    if (!summaryCards) return;
    summaryCards.querySelectorAll('.purchase-history-stats-card-label').forEach(function (el) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (
        t === 'reportes' ||
        t === 'incidencias' ||
        t === 'reportes y incidencias' ||
        t === 'compras nuevas'
      ) {
        const card = el.closest('.purchase-history-stats-card');
        if (card) card.remove();
      }
    });
  }

  function fullSummaryCardDefs(s) {
    return [
      { label: 'Ventas', value: formatCardValue(s.ventas_total), icon: 'fa-shopping-cart' },
      {
        label: 'Renovaciones tienda',
        value: formatCardValue(s.renovaciones_tienda),
        icon: 'fa-sync-alt',
      },
      {
        label: 'Ingresos COP',
        value: formatMoney(formatCardValue(s.ingresos_cop), 'COP'),
        icon: 'fa-coins',
      },
      {
        label: 'Ingresos USD',
        value: formatMoney(formatCardValue(s.ingresos_usd), 'USD'),
        icon: 'fa-dollar-sign',
      },
      {
        label: 'Caídas',
        value: formatCardValue(s.caidas_reportadas),
        icon: 'fa-exclamation-triangle',
      },
      { label: 'Garantías', value: formatCardValue(s.garantias), icon: 'fa-shield-alt' },
    ];
  }

  function renderSummaryCards(targetEl, cards) {
    if (!targetEl) return;
    targetEl.innerHTML = '';
    cards.forEach(function (c) {
      const div = document.createElement('div');
      div.className = 'purchase-history-stats-card';
      div.innerHTML =
        '<i class="fas ' +
        c.icon +
        '" aria-hidden="true"></i><span class="purchase-history-stats-card-value">' +
        c.value +
        '</span><span class="purchase-history-stats-card-label">' +
        escapeHtml(c.label) +
        '</span>';
      targetEl.appendChild(div);
    });
    if (targetEl === summaryCards) removeStaleSummaryCards();
  }

  function renderSummary(s) {
    if (isSingleProveedorScope()) {
      renderSummaryCards(summaryCards, [
        {
          label: 'Proveedores',
          value: formatCardValue(s.proveedores_ventas),
          icon: 'fa-truck-loading',
        },
      ]);
      return;
    }
    renderSummaryCards(summaryCards, fullSummaryCardDefs(s));
  }

  function fillTable(tbody, rows, cols) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!rows || !rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = cols;
      td.className = 'text-center text-muted';
      td.textContent = 'Sin datos en este período.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach(function (row) {
      const tr = document.createElement('tr');
      tr.innerHTML = row.html;
      tbody.appendChild(tr);
    });
  }

  function appendSalesTotalsFooter(tbody, productRows) {
    if (!tbody || !productRows || !productRows.length) return;
    if (isSingleProveedorScope()) {
      let totalProv = 0;
      productRows.forEach(function (r) {
        totalProv += Number(r.proveedores) || 0;
      });
      const tr = document.createElement('tr');
      tr.className = 'purchase-history-stats-table-total-row';
      tr.innerHTML =
        '<td><strong>Todo</strong></td>' +
        '<td class="text-center"><strong>' +
        totalProv +
        '</strong></td>';
      tbody.appendChild(tr);
      return;
    }
    const byMon = {};
    productRows.forEach(function (r) {
      const moneda = String(r.moneda || 'COP').toUpperCase();
      if (!byMon[moneda]) {
        byMon[moneda] = { ventas: 0, renovaciones: 0, total: 0 };
      }
      byMon[moneda].ventas += Number(r.ventas) || 0;
      byMon[moneda].renovaciones += Number(r.renovaciones) || 0;
      byMon[moneda].total += Number(r.total) || 0;
    });
    const order = ['COP', 'USD'];
    const monedas = Object.keys(byMon).sort(function (a, b) {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    monedas.forEach(function (moneda) {
      const t = byMon[moneda];
      const tr = document.createElement('tr');
      tr.className = 'purchase-history-stats-table-total-row';
      let html =
        '<td><strong>Todo</strong></td>' +
        '<td class="text-center"><strong>' +
        escapeHtml(moneda) +
        '</strong></td>' +
        '<td class="text-center"><strong>' +
        t.ventas +
        '</strong></td>' +
        '<td class="text-center"><strong>' +
        t.renovaciones +
        '</strong></td>' +
        '<td><strong>' +
        formatMoney(t.total, moneda) +
        '</strong></td>';
      tr.innerHTML = html;
      tbody.appendChild(tr);
    });
  }

  function proveedorActivityCount(act, proveedorPayload) {
    const payload = proveedorPayload || {};
    if (payload.total_ventas != null) return Number(payload.total_ventas) || 0;
    return Number((act && act.proveedores) || 0);
  }

  function renderActivityTable(tbody, act, orderKeys, proveedorPayload) {
    if (!tbody) return;
    const actRows = (orderKeys || []).map(function (k) {
      const label = ACTIVITY_LABELS[k] || k;
      const labelCell =
        k === 'proveedores' ? proveedorActLabelHtml(label) : escapeHtml(label);
      const qty =
        k === 'proveedores' ? proveedorActivityCount(act, proveedorPayload) : act[k] || 0;
      return {
        html:
          '<td>' +
          labelCell +
          '</td><td class="text-center">' +
          qty +
          '</td>',
      };
    });
    fillTable(tbody, actRows, 2);
    if (orderKeys.indexOf('proveedores') >= 0) {
      bindProveedorActivityModal(tbody, proveedorPayload);
    }
  }

  function renderSalesByProductTable(productRows) {
    if (!salesTable) return;
    toggleStatsViewMode();
    const rows = productRows || [];
    fillTable(
      salesTable,
      rows.map(function (r) {
        return { html: salesRowHtml(r) };
      }),
      salesTableColCount()
    );
    appendSalesTotalsFooter(salesTable, rows);
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text == null ? '' : String(text);
    return d.innerHTML;
  }

  function proveedorActLabelHtml(label) {
    return (
      '<button type="button" class="ph-stats-proveedor-act-btn" title="Ver ventas por servicio vinculado">' +
      '<i class="fas fa-truck-loading purchase-history-stats-proveedor-tip" aria-hidden="true"></i>' +
      '<span class="ph-stats-proveedor-act-label">' +
      escapeHtml(label) +
      '</span></button>'
    );
  }

  function statsPeriodModalTitle(prefix) {
    const from = dateFromInput?.value || '';
    const to = dateToInput?.value || '';
    if (from && to) {
      return (
        (prefix || 'Resúmenes proveedor') +
        ' — ' +
        formatDisplayDate(from) +
        ' — ' +
        formatDisplayDate(to)
      );
    }
    return prefix || 'Resúmenes proveedor';
  }

  function openProveedorServiciosModal(proveedorPayload) {
    if (typeof window.purchaseHistoryOpenProveedorServiciosModal !== 'function') return;
    lastProveedorServiciosPayload = proveedorPayload || { servicios: [], total_ventas: 0 };
    window.purchaseHistoryOpenProveedorServiciosModal(
      lastProveedorServiciosPayload,
      statsPeriodModalTitle('Resúmenes proveedor')
    );
  }

  function bindProveedorActivityModal(tableBody, proveedorPayload) {
    if (!tableBody) return;
    const btn = tableBody.querySelector('.ph-stats-proveedor-act-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      openProveedorServiciosModal(proveedorPayload);
    });
  }

  function renderUnifiedProveedorStats(data) {
    const compras = data.mis_compras || {};
    const ventas = data.ventas_proveedor || {};
    const actMerged = Object.assign({}, compras.actividad_por_tipo || {});
    const proveedorPayload =
      ventas.proveedor_servicios_resumen || { servicios: [], total_ventas: 0 };
    actMerged.proveedores = proveedorActivityCount(
      ventas.actividad_por_tipo || {},
      proveedorPayload
    );

    renderSummaryCards(summaryCards, fullSummaryCardDefs(compras.summary || {}));
    renderSalesByProductTable(compras.ventas_por_producto || []);
    renderActivityTable(
      activityTable,
      actMerged,
      ['caidas', 'renovaciones_actividad', 'proveedores'],
      proveedorPayload
    );
  }

  function renderStats(data) {
    if (data.unified) {
      renderUnifiedProveedorStats(data);
      const suggestionsEl = document.getElementById('phStatsSuggestions');
      if (suggestionsEl) suggestionsEl.remove();
      return;
    }

    const s = data.summary || {};
    const proveedorPayload =
      data.proveedor_servicios_resumen || { servicios: [], total_ventas: 0 };

    renderSummary(s);
    renderSalesByProductTable(data.ventas_por_producto || []);

    const act = data.actividad_por_tipo || {};
    renderActivityTable(activityTable, act, activityTableOrder(), proveedorPayload);

    const suggestionsEl = document.getElementById('phStatsSuggestions');
    if (suggestionsEl) {
      suggestionsEl.remove();
    }
  }

  async function loadStats() {
    const scopeVal = scopeSelect ? scopeSelect.value : 'all';
    if (!selfMode && scopeVal === 'user' && !userIdInput?.value) {
      showStatsError('Selecciona un usuario.');
      return;
    }
    if (
      !selfMode &&
      scopeVal === 'proveedor' &&
      proveedorScopeSelect &&
      proveedorScopeSelect.value === 'user' &&
      !proveedorUserIdInput?.value
    ) {
      showStatsError('Selecciona un proveedor.');
      return;
    }
    const from = dateFromInput?.value || '';
    const to = dateToInput?.value || '';
    if (!from || !to) {
      showStatsError('Selecciona fecha desde y hasta.');
      return;
    }
    if (from > to) {
      showStatsError('La fecha «desde» no puede ser posterior a «hasta».');
      return;
    }

    const params = new URLSearchParams({
      date_from: from,
      date_to: to,
    });
    if (!selfMode) {
      params.set('scope', scopeVal);
      if (scopeVal === 'user' && userIdInput?.value) {
        params.set('user_id', userIdInput.value);
      }
      if (
        scopeVal === 'proveedor' &&
        proveedorScopeSelect &&
        proveedorScopeSelect.value === 'user' &&
        proveedorUserIdInput?.value
      ) {
        params.set('user_id', proveedorUserIdInput.value);
      }
    } else if (isUnifiedProveedorView()) {
      params.set('scope', 'unified');
    }
    updatePeriodDisplayLabel();
    updateSalesSubtitle();
    showStatsError('');
    if (applyBtn) applyBtn.disabled = true;
    try {
      const res = await fetch(statsUrl + '?' + params.toString(), {
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!data.success) {
        showStatsError(data.error || 'Error al cargar.');
        if (contentEl) contentEl.hidden = true;
        return;
      }
      showStatsError('');
      if (contentEl) contentEl.hidden = false;
      renderStats(data);
    } catch (_e) {
      showStatsError('Error de red.');
      if (contentEl) contentEl.hidden = true;
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  if (!selfMode) {
    scopeSelect?.addEventListener('change', function () {
      toggleUserWrap();
      toggleStatsViewMode();
    });
    proveedorScopeSelect?.addEventListener('change', function () {
      toggleProveedorUserWrap();
      toggleStatsViewMode();
    });
  }
  userSearchInput?.addEventListener('input', function () {
    clearTimeout(userSearchDebounce);
    userSearchDebounce = setTimeout(function () {
      searchUsers(userSearchInput.value);
    }, 280);
  });
  userResultsEl?.addEventListener('click', function (e) {
    const row = e.target.closest('.purchase-history-cleanup-user-row');
    if (!row) return;
    setSelectedUser({
      id: parseInt(row.dataset.userId, 10),
      username: row.dataset.username || '',
    });
  });
  userClearBtn?.addEventListener('click', clearSelectedUser);
  proveedorUserSearchInput?.addEventListener('input', function () {
    clearTimeout(proveedorUserSearchDebounce);
    proveedorUserSearchDebounce = setTimeout(function () {
      searchProveedorUsers(proveedorUserSearchInput.value);
    }, 280);
  });
  proveedorUserResultsEl?.addEventListener('click', function (e) {
    const row = e.target.closest('.purchase-history-cleanup-user-row');
    if (!row) return;
    setSelectedProveedorUser({
      id: parseInt(row.dataset.userId, 10),
      username: row.dataset.username || '',
    });
  });
  proveedorUserClearBtn?.addEventListener('click', clearSelectedProveedorUser);
  applyBtn?.addEventListener('click', loadStats);

  periodToggle?.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePeriodPopover();
  });

  periodApplyPopover?.addEventListener('click', function () {
    closePeriodPopover();
    loadStats();
  });

  panel.querySelectorAll('.ph-stats-preset').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPresetDays(btn.getAttribute('data-days'));
    });
  });

  dateFromInput?.addEventListener('change', updatePeriodDisplayLabel);
  dateToInput?.addEventListener('change', updatePeriodDisplayLabel);

  document.addEventListener('click', function (e) {
    if (userWrap && !userWrap.hidden && !userWrap.contains(e.target)) {
      hideUserResults();
    }
    if (proveedorUserWrap && !proveedorUserWrap.hidden && !proveedorUserWrap.contains(e.target)) {
      hideProveedorUserResults();
    }
    const picker = document.querySelector('.purchase-history-stats-period-picker');
    if (picker && !picker.contains(e.target)) {
      closePeriodPopover();
    }
    const proveedorInfoBox = document.getElementById('phStatsProveedorInfoBox');
    const proveedorInfoBtn = document.getElementById('phStatsProveedorInfoBtn');
    if (proveedorInfoBox && !proveedorInfoBox.hidden) {
      if (
        proveedorInfoBtn &&
        !proveedorInfoBtn.contains(e.target) &&
        !proveedorInfoBox.contains(e.target)
      ) {
        proveedorInfoBox.hidden = true;
        proveedorInfoBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

  (function initProveedorCoherenceInfo() {
    const infoBtn = document.getElementById('phStatsProveedorInfoBtn');
    const infoBox = document.getElementById('phStatsProveedorInfoBox');
    if (!infoBtn || !infoBox) return;
    infoBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const open = infoBox.hidden;
      infoBox.hidden = !open;
      infoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  })();

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closePeriodPopover();
      const proveedorInfoBox = document.getElementById('phStatsProveedorInfoBox');
      const proveedorInfoBtn = document.getElementById('phStatsProveedorInfoBtn');
      if (proveedorInfoBox && !proveedorInfoBox.hidden) {
        proveedorInfoBox.hidden = true;
        if (proveedorInfoBtn) proveedorInfoBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

  if (!selfMode) {
    toggleUserWrap();
    toggleStatsViewMode();
  } else {
    updateSalesSubtitle();
  }
  initPeriodDefaults();
  loadStats();
});
