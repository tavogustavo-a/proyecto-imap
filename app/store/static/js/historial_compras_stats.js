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
  const userWrap = document.getElementById('phStatsUserWrap');
  const userIdInput = document.getElementById('phStatsUserId');
  const userSearchInput = document.getElementById('phStatsUserSearch');
  const userResultsEl = document.getElementById('phStatsUserResults');
  const userSelectedWrap = document.getElementById('phStatsUserSelected');
  const userSelectedLabel = document.getElementById('phStatsUserSelectedLabel');
  const userClearBtn = document.getElementById('phStatsUserClear');
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

  const ACTIVITY_LABELS = {
    caidas: 'Caídas',
    renovaciones_actividad: 'Renovaciones',
  };

  const ACTIVITY_TABLE_ORDER = ['caidas', 'renovaciones_actividad'];

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

  function toggleUserWrap() {
    if (!userWrap || !scopeSelect) return;
    userWrap.hidden = scopeSelect.value !== 'user';
    if (scopeSelect.value !== 'user') clearSelectedUser();
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

  function renderSummary(s) {
    if (!summaryCards) return;
    const cards = [
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
    summaryCards.innerHTML = '';
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
      summaryCards.appendChild(div);
    });
    removeStaleSummaryCards();
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
      tr.innerHTML =
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
      tbody.appendChild(tr);
    });
  }

  function renderSalesByProductTable(productRows) {
    if (!salesTable) return;
    const rows = productRows || [];
    fillTable(
      salesTable,
      rows.map(function (r) {
        return {
          html:
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
            '</td>',
        };
      }),
      5
    );
    appendSalesTotalsFooter(salesTable, rows);
  }

  function renderStats(data) {
    const s = data.summary || {};
    renderSummary(s);

    renderSalesByProductTable(data.ventas_por_producto || []);

    const act = data.actividad_por_tipo || {};
    const actRows = ACTIVITY_TABLE_ORDER.filter(function (k) {
      return k === 'caidas' || k === 'renovaciones_actividad';
    }).map(function (k) {
      return {
        html:
          '<td>' +
          escapeHtml(ACTIVITY_LABELS[k] || k) +
          '</td><td class="text-center">' +
          (act[k] || 0) +
          '</td>',
      };
    });
    fillTable(activityTable, actRows, 2);

    const suggestionsEl = document.getElementById('phStatsSuggestions');
    if (suggestionsEl) {
      suggestionsEl.remove();
    }
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text == null ? '' : String(text);
    return d.innerHTML;
  }

  async function loadStats() {
    if (
      !selfMode &&
      scopeSelect &&
      scopeSelect.value === 'user' &&
      !userIdInput?.value
    ) {
      showStatsError('Selecciona un usuario.');
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
      params.set('scope', scopeSelect ? scopeSelect.value : 'all');
      if (scopeSelect?.value === 'user' && userIdInput?.value) {
        params.set('user_id', userIdInput.value);
      }
    }
    updatePeriodDisplayLabel();
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
    scopeSelect?.addEventListener('change', toggleUserWrap);
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
    const picker = document.querySelector('.purchase-history-stats-period-picker');
    if (picker && !picker.contains(e.target)) {
      closePeriodPopover();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePeriodPopover();
  });

  if (!selfMode) {
    toggleUserWrap();
  }
  initPeriodDefaults();
  loadStats();
});
