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

  function openModal(compraRow, openerEl) {
    if (!modal || !modalBody) return;
    lastLicenciasOpenerBtn =
      openerEl && openerEl.nodeType === 1 ? openerEl : null;
    modalTitle.textContent = compraRow.producto || 'Licencias';
    if (modalSub) {
      if (compraRow.is_renewal) {
        modalSub.textContent = renewalModalSubtitle(compraRow);
        modalSub.hidden = false;
      } else {
        modalSub.textContent = '';
        modalSub.hidden = true;
      }
    }

    modalBody.innerHTML = '';
    const list = compraRow.licencias && compraRow.licencias.length ? compraRow.licencias : [];

    if (compraRow.is_reversed) {
      const rev = document.createElement('p');
      rev.className = 'purchase-licencias-reversed-note';
      rev.textContent =
        'Esta compra fue revertida. Las credenciales mostradas son las que se entregaron en esa fecha (historial conservado).';
      modalBody.appendChild(rev);
    } else if (compraRow.is_archived_sale) {
      const arch = document.createElement('p');
      arch.className = 'purchase-licencias-archived-note';
      arch.textContent =
        'Compra archivada del historial. Las credenciales se conservan para consulta por fecha.';
      modalBody.appendChild(arch);
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
        copyBuf.value = list.map(historialLineaLicenciaCliente).join('\n\n');
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
      const txt = copyBuf.value;
      if (!String(txt || '').trim()) return;
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

        const totalCell = row.is_cleanup_log
          ? '—'
          : row.total_display
            ? escapeHtml(row.total_display)
            : escapeHtml(formatMoney(row.total));
        let productoCell;
        if (row.is_cleanup_log) {
          productoCell = escapeHtml(row.producto);
        } else if (row.is_recharge_event) {
          var rechargeIcon = 'fa-wallet';
          var rechargeTone = 'success';
          if (row.is_recharge_reverted) {
            rechargeIcon = 'fa-undo';
            rechargeTone = 'failed';
          } else if (row.is_recharge_rejected) {
            rechargeIcon = 'fa-times-circle';
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
            escapeHtml(row.producto) +
            '</span>';
        } else if (row.is_renewal) {
          productoCell =
            '<span class="purchase-history-product-icon-stack" title="Renovación" aria-hidden="true">' +
            '<i class="fas fa-sync-alt purchase-history-renewal-icon"></i>' +
            '<i class="fas fa-ticket-alt purchase-history-product-icon-base"></i>' +
            '</span> ' +
            escapeHtml(row.producto);
        } else {
          productoCell =
            '<i class="fas fa-ticket-alt" aria-hidden="true"></i> ' +
            escapeHtml(row.producto);
        }
        tr.innerHTML =
          '<td>' +
          escapeHtml(row.fecha) +
          '</td><td>' +
          productoCell +
          '</td><td class="text-center text-nowrap">' +
          escapeHtml(row.cantidad) +
          '</td><td>' +
          totalCell +
          '</td>';
        tr.appendChild(licBtnCell);
        if (showUserColumn) {
          const tdUser = document.createElement('td');
          tdUser.className = 'text-nowrap';
          tdUser.textContent = row.usuario != null && String(row.usuario).trim() !== '' ? String(row.usuario) : '—';
          tr.appendChild(tdUser);
        }
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.btn-ver-licencias-compra').forEach(btn => {
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
        hay.push(row.fecha, row.producto, row.cantidad, formatMoney(row.total));
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

  actualizar();
});
