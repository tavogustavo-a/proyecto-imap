document.addEventListener('DOMContentLoaded', function() {
  const inputBusqueda = document.getElementById('busquedaCompras');
  const tbody = document.getElementById('tbody-compras');
  const paginacion = document.getElementById('paginacion-compras');
  const modal = document.getElementById('purchaseLicenciasModal');
  const modalBody = document.getElementById('purchaseLicenciasModalBody');
  const modalTitle = document.getElementById('purchaseLicenciasModalTitle');
  const modalSub = document.getElementById('purchaseLicenciasModalSub');
  const modalClose = document.getElementById('purchaseLicenciasModalClose');
  const copyBtn = document.getElementById('btnPurchaseLicenciasCopiar');
  const copyBuf = document.getElementById('purchaseLicenciasCopyBuffer');
  const copyActions = document.getElementById('purchaseLicenciasCopyActions');
  const selectPageSize = document.getElementById('historialComprasPageSize');

  let datos = [];
  /** Botón «Ver licencias» que abrió el modal (para devolver foco y evitar aria-hidden + foco dentro). */
  let lastLicenciasOpenerBtn = null;
  const jsonEl = document.getElementById('purchase-history-data');
  const pageRoot = document.querySelector('.purchase-history-page');
  const showUserColumn = !!(pageRoot && pageRoot.getAttribute('data-show-user-column') === 'true');
  try {
    if (jsonEl && jsonEl.textContent) {
      const parsed = JSON.parse(jsonEl.textContent.trim());
      if (Array.isArray(parsed)) datos = parsed;
    }
  } catch (e) {
    datos = [];
  }

  function historialEmailEsCredencialInterna(email) {
    const e = String(email || '').toLowerCase().trim();
    return e.endsWith('@store.internal') || /^inv\.l\d+\./i.test(e);
  }

  /** Contraseña vacía o placeholder (p. ej. «.» del inventario) no se muestra tras el correo. */
  function historialPasswordParaMostrar(pw) {
    const p = String(pw || '').trim();
    if (!p || p === '—' || p === '-' || p === '.') return '';
    return p;
  }

  function normalizeLicenseClipboardText(raw) {
    return String(raw || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(function (line) {
        return line.replace(/\s+$/g, '');
      })
      .filter(function (line) {
        return line.length > 0;
      })
      .join('\n');
  }

  function historialLineaLicenciaCliente(lic) {
    const em = String(lic.email || '').trim();
    const pw = historialPasswordParaMostrar(lic.password);
    const iden = String(lic.identifier || '').trim();
    if (historialEmailEsCredencialInterna(em)) {
      const main = pw || iden;
      return main ? main : '(credencial incompleta; revisa Licencias)';
    }
    if (em && pw) return em + ' · ' + pw;
    if (em) return em;
    if (pw) return pw;
    if (iden) return iden;
    return '—';
  }

  function formatMoney(n) {
    const x = Number(n);
    if (Number.isNaN(x)) return '$0';
    return '$' + x.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatTotalDisplayHtml(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text || text === '—') return escapeHtml(text);
    const match = text.match(/^(\$[\d.,]+)\s+(COP|USD|USDT)$/i);
    if (!match) return escapeHtml(text);
    const amount = match[1];
    let currency = match[2].toUpperCase();
    if (currency === 'USD') currency = 'USDT';
    return (
      escapeHtml(amount) +
      ' <span class="purchase-history-total-currency">' +
      escapeHtml(currency) +
      '</span>'
    );
  }

  function totalCellHtml(row) {
    if (row.is_cleanup_log) return '—';
    if (row.is_daily_summary && (!row.total || Number(row.total) === 0)) {
      return '—';
    }
    if (row.total_display) return formatTotalDisplayHtml(row.total_display);
    return escapeHtml(formatMoney(row.total));
  }

  function renewalModalSubtitle(compraRow) {
    if (!compraRow || !compraRow.is_renewal) return '';
    if (compraRow.renewal_kind_label) return compraRow.renewal_kind_label;
    if (compraRow.renewal_kind === 'renovar_1_mes') return 'Renovación: 1 mes más';
    if (compraRow.renewal_kind === 'dejar_mes_a_mes') return 'Renovación: mes a mes';
    if (compraRow.renewal_kind === 'mixto') {
      return 'Renovación mixta (1 mes más y mes a mes)';
    }
    return 'Renovación de licencia';
  }

  /** Subtítulo del modal: venta, renovación, archivada o revertida. */
  function purchaseModalSubtitle(compraRow) {
    if (!compraRow) return '';
    if (compraRow.is_renewal) {
      return renewalModalSubtitle(compraRow) || 'Renovación de licencia';
    }
    if (compraRow.is_reversed) {
      return 'Compra revertida';
    }
    if (compraRow.is_archived_sale) {
      return 'Compra archivada';
    }
    return 'Venta';
  }

  function openModal(compraRow, openerEl) {
    if (!modal || !modalBody) return;
    lastLicenciasOpenerBtn =
      openerEl && openerEl.nodeType === 1 ? openerEl : null;

    if (compraRow.is_daily_summary) {
      modalTitle.textContent = compraRow.producto || 'Resumen diario';
      if (modalSub) {
        modalSub.textContent = 'Resumen del día';
        modalSub.hidden = false;
      }
      modalBody.innerHTML = '';
      const text = String(compraRow.daily_summary_text || '').trim();
      if (copyActions) copyActions.removeAttribute('hidden');
      if (copyBuf) copyBuf.value = text;
      if (!text) {
        const p = document.createElement('p');
        p.className = 'purchase-licencias-empty';
        p.textContent = 'No hay detalle para este resumen.';
        modalBody.appendChild(p);
      } else {
        const pre = document.createElement('pre');
        pre.className = 'purchase-daily-summary-pre lic-block';
        pre.textContent = text;
        modalBody.appendChild(pre);
      }
      modal.classList.remove('modal-hidden');
      modal.setAttribute('aria-hidden', 'false');
      return;
    }

    modalTitle.textContent = compraRow.producto || 'Licencias';
    if (modalSub) {
      const sub = purchaseModalSubtitle(compraRow);
      modalSub.textContent = sub;
      modalSub.hidden = !sub;
    }

    modalBody.innerHTML = '';
    const list = compraRow.licencias && compraRow.licencias.length ? compraRow.licencias : [];

    if (compraRow.is_reversed) {
      const rev = document.createElement('p');
      rev.className = 'purchase-licencias-reversed-note';
      rev.textContent =
        'Esta compra fue revertida. Las credenciales mostradas son las que se entregaron en esa fecha (historial conservado).';
      modalBody.appendChild(rev);
    }

    if (!list.length) {
      if (copyActions) copyActions.setAttribute('hidden', '');
      if (copyBuf) copyBuf.value = '';
      const p = document.createElement('p');
      p.className = 'purchase-licencias-empty';
      p.textContent =
        'Para esta compra no hay credenciales enlazadas (suele ocurrir con compras anteriores a esta función). Tus cuentas asignadas siguen en Licencias.';
      modalBody.appendChild(p);
    } else {
      if (copyActions) copyActions.removeAttribute('hidden');
      if (copyBuf) {
        copyBuf.value = list.map(historialLineaLicenciaCliente).join('\n');
      }
      const grid = document.createElement('div');
      grid.className = 'purchase-licencias-modal-grid';
      list.forEach(function (lic) {
        const card = document.createElement('div');
        card.className = 'purchase-licencia-card';
        const pre = document.createElement('pre');
        pre.className = 'lic-block';
        pre.textContent = historialLineaLicenciaCliente(lic);
        card.appendChild(pre);
        grid.appendChild(card);
      });
      modalBody.appendChild(grid);
    }

    modal.classList.remove('modal-hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function modalEstaAbierto() {
    return !!(modal && !modal.classList.contains('modal-hidden'));
  }

  function closeModal() {
    if (!modal) return;
    const restore = lastLicenciasOpenerBtn;
    if (restore && document.body.contains(restore) && typeof restore.focus === 'function') {
      try {
        restore.focus();
      } catch (_err) {}
    } else {
      const ae = document.activeElement;
      if (ae && modal.contains(ae) && typeof ae.blur === 'function') {
        ae.blur();
      }
    }
    modal.classList.add('modal-hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (modalSub) {
      modalSub.textContent = '';
      modalSub.hidden = true;
    }
  }

  /** Clic en el backdrop (solo el overlay), no dentro del panel. */
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!modalEstaAbierto()) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      closeModal();
    }
  });

  if (modalClose) modalClose.addEventListener('click', closeModal);

  if (copyBtn && copyBuf) {
    copyBtn.addEventListener('click', function () {
      const txt = normalizeLicenseClipboardText(copyBuf.value);
      if (!txt) return;
      const btn = copyBtn;
      const okFeedback = function () {
        btn.classList.add('copiado');
        btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> ¡Copiado!';
        window.setTimeout(function () {
          btn.classList.remove('copiado');
          btn.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i> Copiar';
        }, 2200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(okFeedback).catch(function () {
          copyBuf.style.position = 'fixed';
          copyBuf.style.left = '0';
          copyBuf.style.top = '0';
          copyBuf.style.opacity = '0';
          copyBuf.focus();
          copyBuf.select();
          try {
            document.execCommand('copy');
            okFeedback();
          } catch (_e2) {
            alert('No se pudo copiar automáticamente. Selecciona el texto con el cursor.');
          }
          copyBuf.blur();
          copyBuf.style.position = 'absolute';
          copyBuf.style.left = '-9999px';
        });
      } else {
        copyBuf.style.position = 'fixed';
        copyBuf.style.left = '0';
        copyBuf.style.top = '0';
        copyBuf.style.opacity = '0';
        copyBuf.focus();
        copyBuf.select();
        try {
          document.execCommand('copy');
          okFeedback();
        } catch (_e3) {
          alert('No se pudo copiar automáticamente.');
        }
        copyBuf.blur();
        copyBuf.style.position = 'absolute';
        copyBuf.style.left = '-9999px';
      }
    });
  }

  let paginaActual = 1;
  let datosFiltrados = [...datos];

  /** Cantidad por página (`null` = mostrar todas). */
  function filasPorPaginaActual() {
    if (!selectPageSize || selectPageSize.value === 'all') return null;
    const n = parseInt(selectPageSize.value, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }

  /** Número de páginas (mínimo 1). Si «Todo», solo una página. */
  function totalPaginasCalculado() {
    const fp = filasPorPaginaActual();
    if (fp === null || datosFiltrados.length === 0) return 1;
    return Math.max(1, Math.ceil(datosFiltrados.length / fp));
  }

  function ajustarPaginaActualAcotada() {
    const tp = totalPaginasCalculado();
    if (paginaActual > tp) paginaActual = tp;
    if (paginaActual < 1) paginaActual = 1;
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text == null ? '' : String(text);
    return d.innerHTML;
  }

  function formatAccumAmount(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0';
    if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
    return String(x)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '');
  }

  function accumTailFromLegacyProducto(producto) {
    let label = String(producto || '').trim();
    const dash = label.search(/\s[—-]\s/);
    if (dash >= 0) label = label.slice(dash).replace(/^\s*[—-]\s*/, '').trim();
    if (/^acumulador\s/i.test(label)) label = label.replace(/^acumulador\s+/i, '').trim();
    label = label.split('/')[0].trim();
    const parts = label.split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (['USDT', 'USD'].includes(parts[0].toUpperCase())) {
      if (parts.length >= 2 && ['TRC20', 'ERC20'].includes(parts[1].toUpperCase())) {
        return parts[1].toUpperCase();
      }
      return parts.slice(1).join(' ');
    }
    if (parts[0].toUpperCase() === 'COP' && parts.length >= 2) {
      return parts.slice(1).join(' ');
    }
    return label;
  }

  function normalizeRechargeProductoLabel(text) {
    return String(text || '')
      .replace(/^Recarga de saldo\s*[—-]\s*/i, 'Recarga — ')
      .replace(/^Recarga automática\s*[—-]\s*/i, 'Recarga — ')
      .replace(/^Recarga rechazada\s*[—-]\s*/i, 'Rechazada — ')
      .replace(/^Recarga revertida\s*[—-]\s*/i, 'Revertida — ');
  }

  function rechargeProductoDisplay(row) {
    if (!row || !row.is_recharge_event) return row.producto || '';
    const legacy = String(row.producto || '');
    const needsAccumShort =
      row.is_recharge_conversion ||
      row.is_recharge_accumulated ||
      /^Conversión acumulador/i.test(legacy) ||
      /^Acumulado\s*[—-]/i.test(legacy) ||
      /^Acumulación rechazada/i.test(legacy);
    if (!needsAccumShort) return normalizeRechargeProductoLabel(legacy);
    if (/^Acumulador\s+\d/i.test(legacy) && !/^Conversión/i.test(legacy)) return legacy;
    const hasClaimed = row.amount_claimed != null && row.amount_claimed !== '';
    if (!hasClaimed && row.is_recharge_conversion) {
      const tailOnly = accumTailFromLegacyProducto(legacy);
      if (/^Conversión|^Acumulado/i.test(legacy)) {
        return tailOnly ? 'Acumulador ' + tailOnly : legacy.replace(/^Conversión acumulador\s*[—-]\s*/i, '').trim();
      }
    }
    const amount = hasClaimed ? row.amount_claimed : row.total;
    let cur = String(row.currency || 'USDT').trim().toUpperCase();
    if (cur === 'USD') cur = 'USDT';
    const tail = accumTailFromLegacyProducto(legacy);
    const core = 'Acumulador ' + formatAccumAmount(amount) + cur;
    return tail ? core + ' ' + tail : core;
  }

  function mergeFreshRechargeHistorial(freshItems) {
    if (!Array.isArray(freshItems) || !freshItems.length) return;
    const byId = {};
    freshItems.forEach(function (r) {
      byId[String(r.id)] = r;
    });
    datos = datos.map(function (d) {
      const fresh = byId[String(d.id)];
      if (!fresh || !d.is_recharge_event) return d;
      return Object.assign({}, d, {
        producto: fresh.producto || d.producto,
        total_display: fresh.total_display != null ? fresh.total_display : d.total_display,
        amount_claimed: fresh.amount_claimed != null ? fresh.amount_claimed : d.amount_claimed,
        currency: fresh.currency || d.currency,
        is_recharge_conversion: fresh.is_recharge_conversion,
        is_recharge_accumulated: fresh.is_recharge_accumulated,
      });
    });
  }

  function renderTabla() {
    tbody.innerHTML = '';
    const fp = filasPorPaginaActual();
    let pagina;
    if (fp === null) {
      pagina = datosFiltrados;
    } else {
      const inicio = (paginaActual - 1) * fp;
      pagina = datosFiltrados.slice(inicio, inicio + fp);
    }
    if (pagina.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = showUserColumn ? 6 : 5;
      td.className = 'text-center';
      td.textContent = showUserColumn
        ? 'No hay compras registradas.'
        : 'No tienes compras registradas aún.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      pagina.forEach(row => {
        const tr = document.createElement('tr');
        if (row.is_cleanup_log) {
          tr.className = 'purchase-history-cleanup-log-row';
        } else if (row.is_daily_summary) {
          tr.className = 'purchase-history-daily-summary-row';
        } else if (row.is_recharge_event) {
          tr.className = 'purchase-history-recharge-row';
          if (row.is_recharge_reverted || row.is_recharge_rejected) {
            tr.className += ' purchase-history-recharge-row--failed';
          } else {
            tr.className += ' purchase-history-recharge-row--success';
          }
        }
        const licBtnCell = document.createElement('td');
        if (row.is_cleanup_log) {
          const span = document.createElement('span');
          span.className = 'text-muted small';
          span.textContent = '—';
          licBtnCell.appendChild(span);
        } else if (row.is_daily_summary) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-panel btn-blue btn-sm btn-ver-resumen-compra';
          btn.setAttribute('data-row-id', String(row.id));
          btn.textContent = 'Ver resumen';
          licBtnCell.appendChild(btn);
        } else if (row.is_recharge_event) {
          const span = document.createElement('span');
          const failed = !!(row.is_recharge_reverted || row.is_recharge_rejected);
          span.className =
            'purchase-history-recharge-status purchase-history-recharge-status--' +
            (failed ? 'failed' : 'success');
          span.textContent = failed ? 'Fallido' : 'Exitoso';
          licBtnCell.appendChild(span);
        } else if (
          (row.licencias && row.licencias.length) ||
          row.has_licencias
        ) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-panel btn-blue btn-sm btn-ver-licencias-compra';
          btn.setAttribute('data-row-id', String(row.id));
          btn.textContent = 'Ver licencias';
          licBtnCell.appendChild(btn);
        } else {
          const span = document.createElement('span');
          span.className = 'text-muted small';
          span.title =
            'Compras antiguas pueden no tener enlace guardado; revisa tus cuentas en Licencias.';
          span.textContent = '—';
          licBtnCell.appendChild(span);
        }

        const totalCell = totalCellHtml(row);
        const productoTexto = rechargeProductoDisplay(row);
        let productoCell;
        if (row.is_cleanup_log) {
          productoCell = escapeHtml(productoTexto);
        } else if (row.is_daily_summary) {
          productoCell =
            '<span class="purchase-history-daily-summary-product">' +
            '<i class="fas fa-clipboard-list" aria-hidden="true"></i> ' +
            escapeHtml(productoTexto) +
            '</span>';
        } else if (row.is_recharge_event) {
          var rechargeIcon = 'fa-wallet';
          var rechargeTone = 'success';
          if (row.is_recharge_reverted || row.is_recharge_rejected) {
            rechargeIcon = 'fa-wallet';
            rechargeTone = 'failed';
          } else if (row.is_recharge_conversion) {
            rechargeIcon = 'fa-exchange-alt';
          } else if (row.is_recharge_accumulated) {
            rechargeIcon = 'fa-layer-group';
          }
          productoCell =
            '<span class="purchase-history-recharge-product purchase-history-recharge-product--' +
            rechargeTone +
            '">' +
            '<i class="fas ' +
            rechargeIcon +
            '" aria-hidden="true"></i> ' +
            escapeHtml(productoTexto) +
            '</span>';
        } else if (row.is_renewal) {
          productoCell =
            '<span class="purchase-history-product-icon-stack" title="Renovación" aria-hidden="true">' +
            '<i class="fas fa-sync-alt purchase-history-renewal-icon"></i>' +
            '<i class="fas fa-ticket-alt purchase-history-product-icon-base"></i>' +
            '</span> ' +
            escapeHtml(productoTexto);
        } else {
          productoCell =
            '<i class="fas fa-ticket-alt" aria-hidden="true"></i> ' +
            escapeHtml(productoTexto);
        }
        tr.innerHTML =
          '<td class="purchase-history-td-fecha text-nowrap">' +
          escapeHtml(row.fecha) +
          '</td><td class="purchase-history-td-producto text-nowrap">' +
          productoCell +
          '</td><td class="purchase-history-td-qty text-center text-nowrap">' +
          escapeHtml(row.cantidad) +
          '</td><td class="purchase-history-td-total text-nowrap">' +
          totalCell +
          '</td>';
        licBtnCell.className = 'purchase-history-td-licencias text-nowrap';
        tr.appendChild(licBtnCell);
        if (showUserColumn) {
          const tdUser = document.createElement('td');
          tdUser.className = 'text-nowrap';
          tdUser.textContent = row.usuario != null && String(row.usuario).trim() !== '' ? String(row.usuario) : '—';
          tr.appendChild(tdUser);
        }
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.btn-ver-licencias-compra, .btn-ver-resumen-compra').forEach(btn => {
        btn.addEventListener('click', function () {
          const rid = this.getAttribute('data-row-id');
          const row = datos.find(function (r) {
            return String(r.id) === String(rid);
          });
          if (row) openModal(row, this);
        });
      });
    }
  }

  function renderPaginacion() {
    paginacion.innerHTML = '';
    if (filasPorPaginaActual() === null) return;
    const totalPaginas = totalPaginasCalculado();
    if (totalPaginas <= 1) return;
    const btnAnt = document.createElement('button');
    btnAnt.textContent = 'Anterior';
    btnAnt.className = 'btn btn-sm btn-secondary mx-1';
    btnAnt.disabled = paginaActual === 1;
    btnAnt.addEventListener('click', () => { paginaActual--; actualizar(); });
    paginacion.appendChild(btnAnt);
    for (let i = 1; i <= totalPaginas; i++) {
      const btn = document.createElement('button');
      btn.textContent = String(i);
      btn.className = 'btn btn-sm ' + (i === paginaActual ? 'btn-primary' : 'btn-light') + ' mx-1';
      btn.addEventListener('click', () => { paginaActual = i; actualizar(); });
      paginacion.appendChild(btn);
    }
    const btnSig = document.createElement('button');
    btnSig.textContent = 'Siguiente';
    btnSig.className = 'btn btn-sm btn-secondary mx-1';
    btnSig.disabled = paginaActual === totalPaginas;
    btnSig.addEventListener('click', () => { paginaActual++; actualizar(); });
    paginacion.appendChild(btnSig);
  }

  function actualizar() {
    ajustarPaginaActualAcotada();
    renderTabla();
    renderPaginacion();
  }

  function filtrar() {
    const q = inputBusqueda.value.trim().toLowerCase();
    if (!q) {
      datosFiltrados = [...datos];
    } else {
      datosFiltrados = datos.filter(function (row) {
        const hay = [];
        hay.push(row.fecha, rechargeProductoDisplay(row), row.cantidad, formatMoney(row.total));
        if (row.total_display) hay.push(row.total_display);
        if (row.id != null) hay.push(String(row.id));
        if (row.product_id != null) hay.push(String(row.product_id));
        if (showUserColumn) {
          if (row.usuario != null) hay.push(String(row.usuario));
          if (row.user_id != null) hay.push(String(row.user_id));
        }
        if (Array.isArray(row.licencias)) {
          row.licencias.forEach(function (lic) {
            if (lic.email) hay.push(lic.email);
            if (lic.identifier) hay.push(lic.identifier);
          });
        }
        return hay.some(function (s) {
          return String(s || '')
            .toLowerCase()
            .includes(q);
        });
      });
    }
    paginaActual = 1;
    actualizar();
  }

  if (inputBusqueda) {
    inputBusqueda.addEventListener('input', filtrar);
    inputBusqueda.addEventListener('search', filtrar);
  }

  if (selectPageSize) {
    selectPageSize.addEventListener('change', function () {
      paginaActual = 1;
      actualizar();
    });
  }

  function refreshRechargeHistorialLabels() {
    const url = pageRoot && pageRoot.getAttribute('data-recharges-url');
    if (!url) {
      actualizar();
      return;
    }
    const req =
      window.StoreFetchJson && window.StoreFetchJson.fetch
        ? window.StoreFetchJson.fetch(url)
        : fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(
            function (res) {
              if (!res.ok) throw new Error('refresh_failed');
              return res.json();
            }
          );
    req
      .then(function (data) {
        if (data && data.ok && Array.isArray(data.items)) {
          mergeFreshRechargeHistorial(data.items);
        }
      })
      .catch(function () {})
      .finally(function () {
        filtrar();
      });
  }

  actualizar();
  refreshRechargeHistorialLabels();

  window.addEventListener('balance-recharge-realtime', function () {
    refreshRechargeHistorialLabels();
  });
});
