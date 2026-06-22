/**
 * Estadísticas «Ventas como proveedor» en Mi Historial de Compras.
 */
document.addEventListener('DOMContentLoaded', function () {
  const panel = document.getElementById('purchaseHistoryProveedorStatsPanel');
  if (!panel) return;

  const statsUrl = panel.dataset.statsUrl;
  const periodToggle = document.getElementById('phProvStatsPeriodToggle');
  const periodPopover = document.getElementById('phProvStatsPeriodPopover');
  const periodDisplay = document.getElementById('phProvStatsPeriodDisplay');
  const dateFromInput = document.getElementById('phProvStatsDateFrom');
  const dateToInput = document.getElementById('phProvStatsDateTo');
  const periodApplyPopover = document.getElementById('phProvStatsPeriodApplyPopover');
  const applyBtn = document.getElementById('phProvStatsApplyBtn');
  const errorEl = document.getElementById('phProvStatsError');
  const contentEl = document.getElementById('phProvStatsContent');
  const summaryCards = document.getElementById('phProvStatsSummaryCards');
  const salesTable = document.querySelector('#phProvStatsSalesTable tbody');
  const activityTable = document.querySelector('#phProvStatsActivityTable tbody');

  const ACTIVITY_LABELS = {
    caidas: 'Caídas',
    renovaciones_actividad: 'Renovaciones',
    proveedores: 'Proveedores',
  };
  const ACTIVITY_TABLE_ORDER = ['caidas', 'renovaciones_actividad', 'proveedores'];

  function activityTableOrder() {
    return ACTIVITY_TABLE_ORDER;
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text == null ? '' : String(text);
    return d.innerHTML;
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

  function fillTable(tbody, rows, cols) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!rows || !rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = cols;
      td.className = 'text-center text-muted';
      td.textContent = 'Sin ventas en este período.';
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
      if (!byMon[moneda]) byMon[moneda] = { ventas: 0, renovaciones: 0, proveedores: 0, total: 0 };
      byMon[moneda].ventas += Number(r.ventas) || 0;
      byMon[moneda].renovaciones += Number(r.renovaciones) || 0;
      byMon[moneda].proveedores += Number(r.proveedores) || 0;
      byMon[moneda].total += Number(r.total) || 0;
    });
    ['COP', 'USD'].concat(Object.keys(byMon)).forEach(function (moneda, idx, arr) {
      if (arr.indexOf(moneda) !== idx) return;
      const t = byMon[moneda];
      if (!t) return;
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
        '<td class="text-center"><strong>' +
        t.proveedores +
        '</strong></td>' +
        '<td><strong>' +
        formatMoney(t.total, moneda) +
        '</strong></td>';
      tbody.appendChild(tr);
    });
  }

  function renderSummary(s) {
    if (!summaryCards) return;
    const cards = [
      { label: 'Ventas', value: s.ventas_total || 0, icon: 'fa-shopping-cart' },
      { label: 'Renovaciones tienda', value: s.renovaciones_tienda || 0, icon: 'fa-sync-alt' },
      { label: 'Ingresos COP', value: formatMoney(s.ingresos_cop, 'COP'), icon: 'fa-coins' },
      { label: 'Ingresos USD', value: formatMoney(s.ingresos_usd, 'USD'), icon: 'fa-dollar-sign' },
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
  }

  function renderStats(data) {
    renderSummary(data.summary || {});
    const rows = data.ventas_por_producto || [];
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
            '</td><td class="text-center">' +
            (Number(r.proveedores) || 0) +
            '</td><td>' +
            formatMoney(r.total, r.moneda) +
            '</td>',
        };
      }),
      6
    );
    appendSalesTotalsFooter(salesTable, rows);

    if (activityTable) {
      const act = data.actividad_por_tipo || {};
      fillTable(
        activityTable,
        ACTIVITY_TABLE_ORDER.map(function (k) {
          const label = ACTIVITY_LABELS[k] || k;
          const labelCell =
            k === 'proveedores'
              ? '<i class="fas fa-truck-loading purchase-history-stats-proveedor-tip" aria-hidden="true"></i> ' +
                escapeHtml(label)
              : escapeHtml(label);
          return {
            html:
              '<td>' +
              labelCell +
              '</td><td class="text-center">' +
              (act[k] || 0) +
              '</td>',
          };
        }),
        2
      );
    }
  }

  async function loadStats() {
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
      scope: 'proveedor',
    });
    updatePeriodDisplayLabel();
    showStatsError('');
    if (applyBtn) applyBtn.disabled = true;
    try {
      const res = await fetch(statsUrl + '?' + params.toString(), { credentials: 'same-origin' });
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

  applyBtn?.addEventListener('click', loadStats);
  periodToggle?.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePeriodPopover();
  });
  periodApplyPopover?.addEventListener('click', function () {
    closePeriodPopover();
    loadStats();
  });
  panel.querySelectorAll('.ph-prov-stats-preset').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPresetDays(btn.getAttribute('data-days'));
    });
  });
  dateFromInput?.addEventListener('change', updatePeriodDisplayLabel);
  dateToInput?.addEventListener('change', updatePeriodDisplayLabel);
  document.addEventListener('click', function (e) {
    const picker = panel.querySelector('.purchase-history-stats-period-picker');
    if (picker && !picker.contains(e.target)) closePeriodPopover();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePeriodPopover();
  });

  setPresetDays(30);
  loadStats();
});
