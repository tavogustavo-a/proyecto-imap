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
    if (compraRow.is_customer_account_renewal || compraRow.renewal_kind === 'customer_account') {
      return compraRow.customer_renewal_status_label || 'Renovar tu cuenta';
    }
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

  function customerRenewalLineForCopy(compraRow) {
    if (!compraRow) return '';
    const em = String(compraRow.customer_renewal_email || '').trim();
    const pw = historialPasswordParaMostrar(compraRow.customer_renewal_password);
    if (em && pw) return em + ' · ' + pw;
    if (em) return em;
    if (pw) return pw;
    return '';
  }

  function openCustomerRenewalModal(compraRow, openerEl) {
    if (!modal || !modalBody) return;
    lastLicenciasOpenerBtn =
      openerEl && openerEl.nodeType === 1 ? openerEl : null;

    modalTitle.textContent = compraRow.producto || 'Renovar tu cuenta';
    if (modalSub) {
      const sub = renewalModalSubtitle(compraRow) || 'Renovar tu cuenta';
      modalSub.textContent = sub;
      modalSub.hidden = !sub;
    }

    modalBody.innerHTML = '';
    const status = String(compraRow.customer_renewal_status || 'pending').toLowerCase();
    const em = String(compraRow.customer_renewal_email || '').trim();
    const pw = historialPasswordParaMostrar(compraRow.customer_renewal_password);
    const copyLine = customerRenewalLineForCopy(compraRow);

    if (status === 'rejected') {
      const note = document.createElement('p');
      note.className = 'purchase-licencias-reversed-note';
      const reason = String(compraRow.customer_renewal_reason || '').trim();
      note.textContent = reason
        ? 'No se pudo renovar esta cuenta. Motivo: ' + reason
        : 'No se pudo renovar esta cuenta.';
      modalBody.appendChild(note);
    } else if (status === 'completed') {
      const note = document.createElement('p');
      note.className = 'purchase-licencias-empty';
      note.textContent =
        'Tu renovación fue procesada. Revisa tus licencias en la tienda si ya tienes acceso.';
      modalBody.appendChild(note);
    } else {
      const note = document.createElement('p');
      note.className = 'purchase-licencias-empty';
      note.textContent =
        'Recibimos tu cuenta para renovar. Te avisaremos cuando esté lista.';
      modalBody.appendChild(note);
    }

    const grid = document.createElement('div');
    grid.className = 'purchase-licencias-modal-grid';
    const card = document.createElement('div');
    card.className = 'purchase-licencia-card';
    const pre = document.createElement('pre');
    pre.className = 'lic-block';
    if (em && pw) {
      pre.textContent = em + ' · ' + pw;
    } else if (em) {
      pre.textContent = em;
    } else if (pw) {
      pre.textContent = pw;
    } else {
      pre.textContent = '—';
    }
    card.appendChild(pre);
    grid.appendChild(card);
    modalBody.appendChild(grid);

    if (copyActions) {
      if (copyLine) copyActions.removeAttribute('hidden');
      else copyActions.setAttribute('hidden', '');
    }
    if (copyBuf) copyBuf.value = copyLine;

    modal.classList.remove('modal-hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function openModal(compraRow, openerEl) {
    if (!modal || !modalBody) return;
    if (compraRow && (compraRow.is_customer_account_renewal || compraRow.has_customer_renewal_detail)) {
      openCustomerRenewalModal(compraRow, openerEl);
      return;
    }
    lastLicenciasOpenerBtn =
      openerEl && openerEl.nodeType === 1 ? openerEl : null;

    if (compraRow.is_daily_summary || compraRow.is_proveedor_daily_summary) {
      modalTitle.textContent = compraRow.producto || 'Resumen diario';
      if (modalSub) {
        modalSub.textContent = compraRow.is_proveedor_daily_summary
          ? 'Resumen ventas proveedor'
          : 'Resumen del día';
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
          tr.className = row.is_proveedor_daily_summary
            ? 'purchase-history-proveedor-daily-summary-row'
            : 'purchase-history-daily-summary-row';
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
        } else if (row.is_customer_account_renewal || row.has_customer_renewal_detail) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-panel btn-blue btn-sm btn-ver-cuenta-renovacion-compra';
          btn.setAttribute('data-row-id', String(row.id));
          btn.textContent = 'Ver cuenta';
          licBtnCell.appendChild(btn);
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
        } else if (row.is_proveedor_daily_summary) {
          productoCell =
            '<span class="purchase-history-proveedor-daily-summary-product">' +
            '<i class="fas fa-truck-loading" aria-hidden="true"></i> ' +
            escapeHtml(productoTexto) +
            '</span>';
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
          var renewalTitle = 'Renovación';
          if (row.is_customer_account_renewal || row.renewal_kind === 'customer_account') {
            renewalTitle = 'Renovar tu cuenta';
          }
          productoCell =
            '<span class="purchase-history-product-icon-stack" title="' +
            escapeHtml(renewalTitle) +
            '" aria-hidden="true">' +
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

      tbody.querySelectorAll('.btn-ver-licencias-compra, .btn-ver-resumen-compra, .btn-ver-cuenta-renovacion-compra').forEach(btn => {
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
        if (row.is_customer_account_renewal || row.has_customer_renewal_detail) {
          if (row.customer_renewal_email) hay.push(row.customer_renewal_email);
          if (row.customer_renewal_status_label) hay.push(row.customer_renewal_status_label);
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

  var storeNotifSeenIds = Object.create(null);
  var historialNotifSseHandle = null;
  var historialNotifPollInterval = null;
  var HISTORIAL_NOTIF_SSE_URL = '/tienda/api/user/store-notifications/stream';
  var HISTORIAL_NOTIF_POLL_MS = 15000;

  function historialCsrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function showHistorialStoreNotification(notif) {
    if (!notif || notif.id == null) return;
    if (storeNotifSeenIds[notif.id]) return;
    storeNotifSeenIds[notif.id] = true;
    var isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    var node = document.createElement('div');
    node.className =
      'in-page-notification push-notification store-reservation-notify ' +
      (isMobile ? 'push-notification-mobile' : 'push-notification-desktop');
    var bodyText = String(notif.body || '').trim();
    if (bodyText.length > 220) bodyText = bodyText.slice(0, 217) + '…';
    node.innerHTML =
      '<div class="push-notification-title">' +
      (notif.title ? String(notif.title) : 'Aviso de la tienda') +
      '</div>' +
      '<div class="push-notification-body">' +
      bodyText.replace(/\n/g, '<br>') +
      '</div>' +
      (isMobile ? '<div class="push-notification-hint">Toca para cerrar</div>' : '');
    node.addEventListener('click', function () {
      node.classList.add('push-notification-closing');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 280);
      fetch('/tienda/api/user/store-notifications/' + encodeURIComponent(String(notif.id)) + '/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRFToken': historialCsrfToken(),
          'X-Requested-With': 'XMLHttpRequest',
        },
      }).catch(function () {});
    });
    document.body.appendChild(node);
    window.setTimeout(function () {
      if (!node.parentNode) return;
      node.classList.add('push-notification-closing');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 280);
    }, 12000);
  }

  function pollHistorialStoreNotifications() {
    fetch('/tienda/api/user/store-notifications', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { success: false };
        });
      })
      .then(function (data) {
        if (!data || !data.success || !Array.isArray(data.notifications)) return;
        data.notifications.slice().reverse().forEach(showHistorialStoreNotification);
      })
      .catch(function () {});
  }

  function onHistorialNotifSseMessage(data) {
    if (!data || data.type !== 'notifications' || !data.success) return;
    if (Array.isArray(data.notifications)) {
      data.notifications.slice().reverse().forEach(showHistorialStoreNotification);
    }
  }

  function stopHistorialNotificationsRealtime() {
    if (historialNotifSseHandle) {
      historialNotifSseHandle.close();
      historialNotifSseHandle = null;
    }
    if (historialNotifPollInterval) {
      window.clearInterval(historialNotifPollInterval);
      historialNotifPollInterval = null;
    }
  }

  function startHistorialNotificationsPollFallback() {
    if (historialNotifPollInterval) return;
    pollHistorialStoreNotifications();
    historialNotifPollInterval = window.setInterval(pollHistorialStoreNotifications, HISTORIAL_NOTIF_POLL_MS);
  }

  function startHistorialNotificationsRealtime() {
    if (document.visibilityState !== 'visible') {
      stopHistorialNotificationsRealtime();
      return;
    }
    stopHistorialNotificationsRealtime();
    if (typeof window.StoreSseRealtime !== 'undefined' && typeof window.StoreSseRealtime.connectOrFallback === 'function') {
      historialNotifSseHandle = window.StoreSseRealtime.connectOrFallback(
        HISTORIAL_NOTIF_SSE_URL,
        onHistorialNotifSseMessage,
        startHistorialNotificationsPollFallback
      );
    } else {
      startHistorialNotificationsPollFallback();
    }
  }

  document.addEventListener('visibilitychange', function historialNotifVisibility() {
    if (document.visibilityState === 'visible') {
      startHistorialNotificationsRealtime();
    } else {
      stopHistorialNotificationsRealtime();
    }
  });

  startHistorialNotificationsRealtime();

  let proveedorResumenModalCtx = null;

  if (modalBody) {
    modalBody.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('.ph-proveedor-resumen-delete-btn');
      if (!btn || btn.disabled || !proveedorResumenModalCtx) return;
      const ctx = proveedorResumenModalCtx;
      if (!ctx.canDelete || !ctx.deleteUrl) return;
      e.preventDefault();
      const coDate = btn.getAttribute('data-co-date');
      if (!coDate) return;
      const userId =
        btn.getAttribute('data-user-id') ||
        (ctx.adminMode && ctx.defaultUserId ? String(ctx.defaultUserId) : '');
      const match = (ctx.list || []).find(function (x) {
        return String(x.co_date) === String(coDate);
      });
      const label = String((match && match.producto) || coDate);
      if (
        !window.confirm(
          '¿Borrar el resumen del día «' +
            label +
            '»?\n\nNo modifica ventas en la base de datos ni el contador Admin → Proveedores.'
        )
      ) {
        return;
      }
      btn.disabled = true;
      const payload = { co_date: coDate };
      if (ctx.adminMode && userId) payload.user_id = parseInt(userId, 10);
      fetch(ctx.deleteUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRFToken': historialCsrfToken(),
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { success: false };
          });
        })
        .then(function (data) {
          if (!data || !data.success) {
            throw new Error((data && data.error) || 'No se pudo borrar.');
          }
          ctx.list = (ctx.list || []).filter(function (x) {
            return String(x.co_date) !== String(coDate);
          });
          if (typeof ctx.render === 'function') ctx.render();
          if (typeof ctx.onDeleted === 'function') ctx.onDeleted(coDate);
        })
        .catch(function (err) {
          window.alert(err && err.message ? err.message : 'Error al borrar.');
          btn.disabled = false;
        });
    });
  }

  window.purchaseHistoryOpenProveedorResumenesModal = function (items, periodLabel, options) {
    if (!modal || !modalBody) return;
    options = options || {};
    lastLicenciasOpenerBtn = null;
    modalTitle.textContent = periodLabel || 'Resúmenes proveedor';
    const canDelete = !!options.canDelete && !!options.deleteUrl;
    if (modalSub) {
      modalSub.textContent = canDelete
        ? 'Resumen de lo vendido por día. Puedes borrar un día concreto; no afecta el contador Admin → Proveedores.'
        : 'Resumen de lo vendido por día';
      modalSub.hidden = false;
    }

    const list = Array.isArray(items) ? items.slice() : [];

    function buildCopyText(entries) {
      return entries
        .map(function (it) {
          const title = String(it.producto || '').trim();
          const body = String(it.daily_summary_text || '').trim();
          return title && body ? title + '\n' + body : title || body;
        })
        .filter(Boolean)
        .join('\n\n────────────────\n\n');
    }

    function renderResumenesList() {
      modalBody.innerHTML = '';
      if (!list.length) {
        const p = document.createElement('p');
        p.className = 'purchase-licencias-empty';
        p.textContent = 'No hay resúmenes guardados para este período.';
        modalBody.appendChild(p);
        if (copyActions) copyActions.setAttribute('hidden', '');
        if (copyBuf) copyBuf.value = '';
        return;
      }
      list.forEach(function (it) {
        const wrap = document.createElement('div');
        wrap.className = 'ph-proveedor-resumen-item';
        const head = document.createElement('div');
        head.className = 'ph-proveedor-resumen-item__head';
        const title = document.createElement('h4');
        title.className = 'ph-proveedor-resumen-item__title';
        title.textContent = String(it.producto || 'Resumen diario').trim() || 'Resumen diario';
        head.appendChild(title);
        if (canDelete && it.co_date) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className =
            'btn-panel btn-red btn-sm ph-proveedor-resumen-item__delete ph-proveedor-resumen-delete-btn';
          delBtn.setAttribute('data-co-date', String(it.co_date));
          if (it.user_id != null) {
            delBtn.setAttribute('data-user-id', String(it.user_id));
          }
          delBtn.title = 'Borrar resumen de este día';
          delBtn.innerHTML =
            '<i class="fas fa-trash-alt" aria-hidden="true"></i><span class="sr-only"> Borrar</span>';
          head.appendChild(delBtn);
        }
        wrap.appendChild(head);
        const body = String(it.daily_summary_text || '').trim();
        if (body) {
          const pre = document.createElement('pre');
          pre.className = 'ph-proveedor-resumen-item__pre purchase-daily-summary-pre lic-block';
          pre.textContent = body;
          wrap.appendChild(pre);
        }
        modalBody.appendChild(wrap);
      });
      const text = buildCopyText(list);
      if (copyActions) {
        if (text) copyActions.removeAttribute('hidden');
        else copyActions.setAttribute('hidden', '');
      }
      if (copyBuf) copyBuf.value = text;
    }

    proveedorResumenModalCtx = {
      list: list,
      canDelete: canDelete,
      deleteUrl: options.deleteUrl || '',
      adminMode: !!options.adminMode,
      defaultUserId: options.defaultUserId || null,
      onDeleted: options.onDeleted,
      render: renderResumenesList,
    };

    renderResumenesList();
    modal.classList.remove('modal-hidden');
    modal.setAttribute('aria-hidden', 'false');
  };

  window.purchaseHistoryOpenProveedorServiciosModal = function (payload, periodLabel) {
    if (!modal || !modalBody) return;
    lastLicenciasOpenerBtn = null;
    payload = payload || {};
    const servicios = Array.isArray(payload.servicios) ? payload.servicios : [];
    const totalVentas = Number(payload.total_ventas) || 0;

    modalTitle.textContent = periodLabel || 'Resúmenes proveedor';
    if (modalSub) {
      modalSub.textContent = 'Ventas del período por servicio vinculado';
      modalSub.hidden = false;
    }
    modalBody.innerHTML = '';

    if (!servicios.length) {
      if (copyActions) copyActions.setAttribute('hidden', '');
      if (copyBuf) copyBuf.value = '';
      const p = document.createElement('p');
      p.className = 'purchase-licencias-empty';
      p.textContent = 'No hay servicios vinculados o ventas en este período.';
      modalBody.appendChild(p);
    } else {
      const list = document.createElement('div');
      list.className = 'admin-lic-proveedor-ventas-list ph-proveedor-servicios-modal-list';
      list.setAttribute('role', 'list');
      const copyLines = [];
      servicios.forEach(function (svc) {
        const name = String(svc.producto || '—').trim() || '—';
        const count = Math.max(0, parseInt(svc.ventas, 10) || 0);
        copyLines.push(name + ': ' + count);
        const item = document.createElement('div');
        item.className = 'admin-lic-proveedor-ventas-item';
        item.setAttribute('role', 'listitem');
        item.innerHTML =
          '<span class="admin-lic-proveedor-ventas-item__name">' +
          name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
          '</span>' +
          '<span class="admin-lic-proveedor-ventas-item__count" aria-label="Vendidas">' +
          String(count) +
          '</span>';
        list.appendChild(item);
      });
      modalBody.appendChild(list);
      const totalRow = document.createElement('p');
      totalRow.className = 'ph-proveedor-servicios-modal-total mb-0 mt-2';
      totalRow.innerHTML = '<strong>Total:</strong> ' + String(totalVentas);
      modalBody.appendChild(totalRow);
      const copyText = copyLines.join('\n') + '\nTotal: ' + String(totalVentas);
      if (copyActions) copyActions.removeAttribute('hidden');
      if (copyBuf) copyBuf.value = copyText;
    }

    modal.classList.remove('modal-hidden');
    modal.setAttribute('aria-hidden', 'false');
  };
});
