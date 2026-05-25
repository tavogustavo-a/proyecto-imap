document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchStoreInput');
  const productCards = document.querySelectorAll('.card.product-texture-bg');

  if (searchInput && productCards.length) {
    function filterProducts() {
      const term = searchInput.value.trim().toLowerCase();
      productCards.forEach(card => {
        const name = card.querySelector('.mt-05').textContent.trim().toLowerCase();
        if (!term || name.includes(term)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    }
    searchInput.addEventListener('input', filterProducts);
    
    // Event listener para la 'x' nativa de limpiar
    searchInput.addEventListener('search', function() {
      // Se activa cuando se usa la 'x' nativa para limpiar
      filterProducts();
    });
    
    // Inicial
    filterProducts();
  }

  // Cantidad
  productCards.forEach(function(card) {
    const input = card.querySelector('.input-cantidad-licencia');
    const btnSumar = card.querySelector('.btn-sumar');
    const btnRestar = card.querySelector('.btn-restar');
    if (input && btnSumar && btnRestar) {
      btnSumar.addEventListener('click', function() {
        const pid = parseInt(card.getAttribute('data-id'), 10);
        const stock = getSellableStockForProduct(pid);
        let cur = parseInt(input.value, 10) || 1;
        if (stock !== null && cur >= stock) {
          if (stock <= 0) {
            alert('No hay existencias disponibles para este producto.');
          } else {
            alert(
              'Solo puedes pedir hasta ' + stock + ' unidad(es) (inventario disponible).'
            );
          }
          return;
        }
        cur++;
        input.value = String(cur);
      });
      btnRestar.addEventListener('click', function() {
        if (parseInt(input.value) > 1) {
          input.value = parseInt(input.value) - 1;
        }
      });
    }
  });

  // --- Tienda pública ---
  // const carrito = {}; no se usa, todo se basa en carritoPago
  
  // Variables globales para cupones
  let cuponAplicado = null;
  let descuentoCupon = 0;

  // Existencias en casi tiempo real: solo polling (1,2 s visible / 8 s oculto).
  // EventSource fallaba al cerrar el stream (~29 s) y mezclaba errores con reconexión;
  // el GET /stock ya devuelve datos frescos sin depender de SSE.
  let stockPollInterval = null;
  /** @type {Record<string, number>} snapshot completo desde /tienda/api/products/stock */
  let stockByProductId = {};
  /** Tras una respuesta de /stock, cualquier producto sin fila ya no está a la venta (se trata como 0). */
  let stockPollLoadedOnce = false;

  function hydrateProductStockFromSSR() {
    let any = false;
    document.querySelectorAll('.product-stock-info[data-product-id]').forEach(function (el) {
      const sid = String(el.getAttribute('data-product-id') || '');
      if (!sid) return;
      const raw = el.getAttribute('data-initial-stock');
      if (raw === null || raw === '') return;
      const n = Math.max(0, parseInt(raw, 10) || 0);
      stockByProductId[sid] = n;
      any = true;
    });
    if (any) {
      stockPollLoadedOnce = true;
    }
  }

  /** Lee el número desde el texto de la tarjeta ("N existencias"). */
  function parseStockNumFromBadge(productId) {
    const el = document.querySelector('.product-stock-info[data-product-id="' + productId + '"]');
    if (!el) return null;
    const m = /^\s*(\d+)\s*existencias/i.exec((el.textContent || '').trim());
    return m ? parseInt(m[1], 10) : null;
  }

  /** Stock vendible público conocido por id numérico. null = aún sin dato suficiente (antes del primer GET /stock). */
  function getSellableStockForProduct(productIdNum) {
    const k = String(productIdNum);
    if (Object.prototype.hasOwnProperty.call(stockByProductId, k)) {
      const n = Number(stockByProductId[k]);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    const fromDom = parseStockNumFromBadge(k);
    if (fromDom !== null) return Math.max(0, fromDom);
    if (stockPollLoadedOnce) return 0;
    return null;
  }

  let stockClampNotifyTimer = null;
  const pendingStockMsgs = [];

  function flushStockNotifications() {
    if (pendingStockMsgs.length === 0) return;
    alert(pendingStockMsgs.join('\n\n'));
    pendingStockMsgs.length = 0;
  }

  function queueStockMessage(msg) {
    if (!msg || pendingStockMsgs.includes(msg)) return;
    pendingStockMsgs.push(msg);
    if (stockClampNotifyTimer) clearTimeout(stockClampNotifyTimer);
    stockClampNotifyTimer = setTimeout(function () {
      stockClampNotifyTimer = null;
      flushStockNotifications();
    }, 550);
  }

  function syncCartToInventory(opts) {
    opts = opts || {};
    const suppressAlerts = !!opts.suppressAlerts;
    const msgs = [];
    let touched = false;

    carritoPago = carritoPago.filter(function (item) {
      if (item.es_renovacion) {
        return true;
      }
      let qty = parseInt(item.cantidad, 10);
      if (isNaN(qty) || qty < 1) qty = 1;
      const avail = getSellableStockForProduct(item.id);

      if (avail === null) {
        item.cantidad = qty;
        return true;
      }
      if (avail <= 0) {
        msgs.push('«' + item.nombre + '» ya no tiene existencias y se quitó del carrito.');
        touched = true;
        return false;
      }
      if (qty > avail) {
        item.cantidad = avail;
        msgs.push(
          'La cantidad de «' + item.nombre + '» se ajustó al inventario disponible: ' + avail + ' unidad(es).'
        );
        touched = true;
      } else {
        item.cantidad = qty;
      }
      return true;
    });

    if (msgs.length) {
      cuponAplicado = null;
      descuentoCupon = 0;
      if (!suppressAlerts) {
        msgs.forEach(function (m) {
          queueStockMessage(m);
        });
      }
    }

    if (touched) {
      ocultarCuponAplicado();
      actualizarDescuento();
      renderResumenPago();
      renderizarCarrito();
    }
  }

  function capCardQuantityInput(card, preferredMax) {
    const input = card.querySelector('.input-cantidad-licencia');
    if (!input) return;
    let maxVal = preferredMax != null ? preferredMax : getSellableStockForProduct(parseInt(card.getAttribute('data-id'), 10));
    if (maxVal === null) return;
    let v = parseInt(input.value, 10) || 1;
    if (maxVal <= 0) {
      input.setAttribute('max', '1');
      if (v > 1) input.value = '1';
      return;
    }
    if (v < 1) v = 1;
    if (v > maxVal) v = maxVal;
    input.setAttribute('max', String(maxVal));
    input.value = String(v);
  }

  function applyStockPayload(data) {
    if (!data || !data.success || !data.stock || typeof data.stock !== 'object') return false;
    stockPollLoadedOnce = true;
    stockByProductId = {};
    Object.keys(data.stock).forEach(function (productId) {
      const n = Math.max(0, parseInt(data.stock[productId], 10) || 0);
      stockByProductId[String(productId)] = n;
    });
    /** Toda tarjeta con badge debe verse actualizada (evita «Cargando existencias» si falta alguna id en JSON). */
    document.querySelectorAll('.product-stock-info[data-product-id]').forEach(function (stockElement) {
      const key = String(stockElement.getAttribute('data-product-id') || '');
      if (!key) return;
      if (!Object.prototype.hasOwnProperty.call(stockByProductId, key)) {
        stockByProductId[key] = 0;
      }
      stockElement.textContent = stockByProductId[key] + ' existencias';
    });
    syncCartToInventory();
    document.querySelectorAll('.card.product-texture-bg').forEach(function (card) {
      const pid = parseInt(card.getAttribute('data-id'), 10);
      if (!pid) return;
      capCardQuantityInput(card, getSellableStockForProduct(pid));
    });
    return true;
  }

  function markStockLoadFailedBriefly() {
    document.querySelectorAll('.product-stock-info[data-product-id]').forEach(function (el) {
      if ((el.textContent || '').indexOf('Cargando existencias') !== -1) {
        el.textContent = 'Sin datos · reintentando…';
      }
    });
  }

  async function updateAllProductsStock() {
    try {
      const response = await fetch('/tienda/api/products/stock', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        markStockLoadFailedBriefly();
        return;
      }
      const data = await response.json();
      if (!applyStockPayload(data)) {
        markStockLoadFailedBriefly();
      }
    } catch (error) {
      console.error('Error al actualizar stock:', error);
      markStockLoadFailedBriefly();
    }
  }

  function stopStockRealtime() {
    if (stockPollInterval) {
      clearInterval(stockPollInterval);
      stockPollInterval = null;
    }
  }

  function startStockRealtime() {
    if (!document.querySelector('.product-stock-info')) return;

    stopStockRealtime();
    updateAllProductsStock();

    const ms = document.hidden ? 8000 : 1200;
    stockPollInterval = setInterval(updateAllProductsStock, ms);
  }

  // Función para obtener el token CSRF
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function getRenovacionApiUrls() {
    const modal = document.getElementById('renovacionModal');
    const buscar = (modal && modal.getAttribute('data-buscar-url')) || '/tienda/api/renovacion/buscar';
    const base = buscar.replace(/\/buscar\/?$/, '');
    return {
      reservar:
        (modal && modal.getAttribute('data-reservar-url')) || base + '/reservar',
      liberar: (modal && modal.getAttribute('data-liberar-url')) || base + '/liberar',
    };
  }

  function recolectarIdsRenovacionCarrito() {
    const ids = [];
    carritoPago.forEach(function (p) {
      if (p.es_renovacion && p.renovacion_account_ids) {
        p.renovacion_account_ids.forEach(function (id) {
          const n = parseInt(id, 10);
          if (n && ids.indexOf(n) === -1) ids.push(n);
        });
      }
    });
    return ids;
  }

  function quitarCuentasRenovacionDelCarrito(perdidas) {
    if (!perdidas || !perdidas.length) return;
    const removeIds = perdidas
      .map(function (p) {
        return parseInt(p.account_id, 10);
      })
      .filter(function (n) {
        return !!n;
      });
    if (!removeIds.length) return;
    liberarCuentasRenovacion(removeIds);
    carritoPago.forEach(function (line) {
      if (!line.es_renovacion || !line.renovacion_account_ids) return;
      const keepIds = [];
      const keepEmails = [];
      line.renovacion_account_ids.forEach(function (aid, idx) {
        if (removeIds.indexOf(aid) === -1) {
          keepIds.push(aid);
          keepEmails.push(
            line.renovacion_emails && line.renovacion_emails[idx]
              ? line.renovacion_emails[idx]
              : ''
          );
        }
      });
      line.renovacion_account_ids = keepIds;
      line.renovacion_emails = keepEmails;
      line.cantidad = keepIds.length;
    });
    carritoPago = carritoPago.filter(function (p) {
      return !(
        p.es_renovacion &&
        (!p.renovacion_account_ids || !p.renovacion_account_ids.length)
      );
    });
    actualizarDescuento();
    renderResumenPago();
    renderizarCarrito();
  }

  function manejarErrorPagoRenovacion(data) {
    if (data && data.renovacion_perdidas && data.renovacion_perdidas.length) {
      quitarCuentasRenovacionDelCarrito(data.renovacion_perdidas);
      alert(
        data.error ||
          'Una o más cuentas de renovación ya fueron vendidas y se quitaron del carrito.'
      );
      return true;
    }
    return false;
  }

  function reservarCuentasRenovacion(accountIds) {
    const urls = getRenovacionApiUrls();
    return fetch(urls.reservar, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRFToken': getCsrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ account_ids: accountIds }),
    }).then(function (r) {
      return r.json();
    });
  }

  function liberarCuentasRenovacion(accountIds) {
    if (!accountIds || !accountIds.length) return Promise.resolve();
    const urls = getRenovacionApiUrls();
    return fetch(urls.liberar, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRFToken': getCsrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ account_ids: accountIds }),
    }).catch(function () {});
  }

  function sincronizarReservasRenovacionCarrito() {
    const ids = recolectarIdsRenovacionCarrito();
    if (!ids.length) return Promise.resolve();
    return reservarCuentasRenovacion(ids).then(function (data) {
      if (data && data.failed && data.failed.length) {
        quitarCuentasRenovacionDelCarrito(data.failed);
      }
    });
  }

  function serializarProductosPago() {
    return carritoPago.map(function (p) {
      const row = {
        id: p.id,
        cantidad: p.cantidad,
        precio_unitario: p.precio_unitario,
        moneda: p.moneda,
        nombre: p.nombre,
      };
      if (p.es_renovacion && p.renovacion_account_ids && p.renovacion_account_ids.length) {
        row.es_renovacion = true;
        row.renovacion_account_ids = p.renovacion_account_ids.slice();
      }
      return row;
    });
  }

  function cerrarModalPagoExito() {
    const m = document.getElementById('pagoExitoModal');
    const btnCopiar = document.getElementById('btnPagoExitoCopiarTodo');
    if (m) m.classList.add('modal-hidden');
    if (btnCopiar) {
      btnCopiar.classList.remove('copiado');
      btnCopiar.innerHTML = '<i class="fas fa-copy"></i> Copiar';
    }
  }

  function tiendaEscapeHtmlParaModal(str) {
    if (str == null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function tiendaEmailEsCredencialInterna(email) {
    const e = String(email || '').toLowerCase().trim();
    return e.endsWith('@store.internal') || /^inv\.l\d+\./i.test(e);
  }

  /** Contraseña vacía o placeholder (p. ej. «.» del inventario) no se muestra tras el correo. */
  function tiendaPasswordParaMostrar(pw) {
    const p = String(pw || '').trim();
    if (!p || p === '—' || p === '-' || p === '.') return '';
    return p;
  }

  /** Texto legible por fila para el cliente (sin mostrar IDs internos de inventario cuando no aportan). */
  function tiendaLineaEntregaCredencial(cuenta) {
    const em = String(cuenta.email || '').trim();
    const pw = tiendaPasswordParaMostrar(cuenta.password);
    const iden = String(cuenta.identifier || '').trim();
    if (tiendaEmailEsCredencialInterna(em)) {
      const main = pw || iden;
      return main ? main : '(credencial incompleta; revisa historial)';
    }
    if (em && pw) return em + ' · ' + pw;
    if (em) return em;
    if (pw) return pw;
    if (iden) return iden;
    return '—';
  }

  function tiendaConstruirTextoPlanoEntregaPorProductos(agr) {
    const blocks = [];
    Object.keys(agr).forEach(function (producto) {
      let b = '── ' + producto + ' ──\n';
      agr[producto].forEach(function (cuenta) {
        b += tiendaLineaEntregaCredencial(cuenta) + '\n';
      });
      blocks.push(b.replace(/\n+$/, ''));
    });
    return blocks.join('\n\n').trim();
  }

  /** @param {{ producto:string, email:string, password:string }[]} cuentasRaw */
  function tiendaAbrirModalPagoExito(cuentasRaw) {
    const modal = document.getElementById('pagoExitoModal');
    const intro = document.getElementById('pagoExitoIntro');
    const listRoot = document.getElementById('pagoExitoCredList');
    const buf = document.getElementById('pagoExitoClipboardBuffer');
    const btnCopiar = document.getElementById('btnPagoExitoCopiarTodo');
    if (!modal || !intro || !listRoot || !buf) return;
    if (!cuentasRaw || cuentasRaw.length === 0) {
      alert('¡Pago realizado con éxito!');
      return;
    }
    const agr = {};
    cuentasRaw.forEach(function (c) {
      const prod = String(c.producto || 'Producto').trim() || 'Producto';
      if (!agr[prod]) agr[prod] = [];
      agr[prod].push(c);
    });
    intro.textContent = '';
    let html = '';
    Object.keys(agr).forEach(function (prod) {
      html += '<div class="pago-exito-prod">' + tiendaEscapeHtmlParaModal(prod) + '</div>';
      agr[prod].forEach(function (cuenta) {
        html +=
          '<div class="pago-exito-line">' +
          tiendaEscapeHtmlParaModal(tiendaLineaEntregaCredencial(cuenta)) +
          '</div>';
      });
    });
    listRoot.innerHTML = html;
    buf.value = tiendaConstruirTextoPlanoEntregaPorProductos(agr);

    const btnCerrarX = document.getElementById('closePagoExitoModalBtn');
    if (btnCerrarX) btnCerrarX.onclick = cerrarModalPagoExito;
    /* Cierre solo con la X: no cerrar al pulsar el fondo (seguridad de credenciales). */

    if (btnCopiar) {
      btnCopiar.onclick = function () {
        const txt = buf.value;
        const okFeedback = function () {
          btnCopiar.classList.add('copiado');
          btnCopiar.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
          window.setTimeout(function () {
            btnCopiar.classList.remove('copiado');
            btnCopiar.innerHTML = '<i class="fas fa-copy"></i> Copiar';
          }, 2200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(okFeedback).catch(function () {
            buf.style.position = 'fixed';
            buf.style.left = '0';
            buf.style.top = '0';
            buf.style.opacity = '0';
            buf.focus();
            buf.select();
            try {
              document.execCommand('copy');
              okFeedback();
            } catch (e2) {
              alert('No se pudo copiar automáticamente. Selecciona el texto en el mensaje.');
            }
            buf.blur();
            buf.style.position = 'absolute';
            buf.style.left = '-9999px';
          });
        } else {
          buf.style.position = 'fixed';
          buf.style.left = '0';
          buf.style.top = '0';
          buf.style.opacity = '0';
          buf.focus();
          buf.select();
          try {
            document.execCommand('copy');
            okFeedback();
          } catch (e3) {
            alert('No se pudo copiar. Revisa el historial de compras.');
          }
          buf.blur();
          buf.style.position = 'absolute';
          buf.style.left = '-9999px';
        }
      };
    }

    modal.classList.remove('modal-hidden');
  }

  function actualizarCarritoContador() {
    const total = carritoPago.reduce((acc, item) => acc + item.cantidad, 0);
    const contador = document.getElementById('carritoContador');
    if (total > 0) {
      contador.textContent = total;
      contador.style.display = '';
    } else {
      contador.textContent = '0';
      contador.style.display = 'none';
    }
  }

  function renderizarCarrito() {
    const lista = document.getElementById('carritoListaProductos');
    const vacioMsg = document.getElementById('carritoVacioMsg');
    if (!lista) return;
    lista.innerHTML = '';
    let total = 0;
    if (carritoPago.length === 0) {
      if (vacioMsg) vacioMsg.style.display = '';
      return;
    }
    if (vacioMsg) vacioMsg.style.display = 'none';
    carritoPago.forEach(producto => {
      const div = document.createElement('div');
      div.className = 'carrito-producto-item';
      
      // Calcular precio total del producto
      const precioTotal = producto.cantidad * producto.precio_unitario;
      const esRen = producto.es_renovacion ? '1' : '0';
      const cantidadBtns = producto.es_renovacion
        ? '<span class="carrito-cantidad-num">' + producto.cantidad + '</span>'
        : '<button class="btn-carrito-menos" data-id="' +
          producto.id +
          '" data-es-renovacion="0">-</button>' +
          '<span class="carrito-cantidad-num">' +
          producto.cantidad +
          '</span>' +
          '<button class="btn-carrito-mas" data-id="' +
          producto.id +
          '" data-es-renovacion="0">+</button>';

      const logoBadge = producto.es_renovacion
        ? '<span class="renovacion-logo-badge" title="Renovación"><i class="fas fa-sync-alt"></i></span>'
        : '';

      div.innerHTML = `
        <button class="btn-eliminar-producto" title="Eliminar producto" data-id="${producto.id}" data-es-renovacion="${esRen}">×</button>
        <div class="carrito-producto-superior">
          <div class="carrito-producto-logo-wrap">
            <img src="${producto.logo}" alt="logo" class="carrito-producto-logo">
            ${logoBadge}
          </div>
          <span class="carrito-producto-nombre">${producto.nombre}</span>
        </div>
        <div class="carrito-producto-inferior">
          <div class="carrito-producto-cantidad-btns">
            ${cantidadBtns}
          </div>
          <div class="carrito-producto-precio">
            <div class="carrito-precio-total">$${precioTotal} ${producto.moneda}</div>
            <div class="carrito-precio-unitario">$${producto.precio_unitario} ${producto.moneda} c/u</div>
          </div>
        </div>
      `;
      
      // Mostrar descuento individual si aplica (abajo del producto)
      if (producto.descuento_aplicado && (producto.descuento_cop > 0 || producto.descuento_usd > 0)) {
        const descuentoDiv = document.createElement('div');
        descuentoDiv.className = 'carrito-descuento-individual';
        
        let descuentoTexto = '';
        if (producto.descuento_cop > 0) {
          descuentoTexto = `-$${producto.descuento_cop} COP`;
        } else if (producto.descuento_usd > 0) {
          descuentoTexto = `-$${producto.descuento_usd} USD`;
        }
        descuentoDiv.textContent = descuentoTexto;
        // Agregar el descuento abajo de todo el producto
        div.appendChild(descuentoDiv);
      }
      
      lista.appendChild(div);
      total += producto.cantidad * producto.precio_unitario;
    });
    
    // Insertar campo de cupón antes del total
    const cuponDiv = document.createElement('div');
    cuponDiv.className = 'carrito-cupon-dinamico mt-2';
    
    // Determinar si hay cupón aplicado
    const tieneCupon = cuponAplicado !== null;
    const botonTexto = tieneCupon ? 'Quitar' : 'Aplicar';
    const botonClase = tieneCupon ? 'btn-panel btn-red btn-sm' : 'btn-panel btn-blue btn-sm';
    const inputDisabled = tieneCupon ? 'disabled' : '';
    const inputValue = tieneCupon ? cuponAplicado.nombre : '';
    
    cuponDiv.innerHTML = `
      <div class="d-flex align-items-center gap-1">
        <input type="text" id="cuponInputCarritoDinamico" class="cupon-input-carrito" placeholder="Código cupón" autocomplete="off" value="${inputValue}" ${inputDisabled}>
        <button type="button" id="btnAplicarCuponCarritoDinamico" class="${botonClase}">${botonTexto}</button>
      </div>
      <div id="cuponInfoCarritoDinamico" class="cupon-info-carrito mt-1 ${tieneCupon ? '' : 'd-none'}">
        <span class="cupon-aplicado-carrito">Cupón aplicado: ${tieneCupon ? cuponAplicado.nombre : ''} - $${tieneCupon ? descuentoCupon : 0} ${tieneCupon ? (cuponAplicado.descuento_cop ? 'COP' : 'USD') : ''}</span>
      </div>
    `;
    lista.appendChild(cuponDiv);

    // Insertar sección de saldo disponible después del cupón
    const saldoDiv = document.createElement('div');
    saldoDiv.className = 'carrito-saldo-dinamico mt-2';
    
    let saldoHtml = '<div class="saldo-info-carrito">';
    saldoHtml += '<span class="saldo-label-carrito">Saldo disponible:</span>';
    saldoHtml += '<div class="saldo-amounts-carrito">';
    saldoHtml += storeFormatUserSaldoHtml();
    saldoHtml += '</div></div>';
    saldoDiv.innerHTML = saldoHtml;
    lista.appendChild(saldoDiv);

    // Event listener para el botón de cupón (aplicar/quitar)
    document.getElementById('btnAplicarCuponCarritoDinamico').addEventListener('click', function() {
      if (cuponAplicado) {
        // Si hay cupón aplicado, quitarlo
        quitarCupon();
      } else {
        // Si no hay cupón, aplicar el código
        const codigo = document.getElementById('cuponInputCarritoDinamico').value.trim();
        aplicarCupon(codigo);
      }
    });

    document.getElementById('cuponInputCarritoDinamico').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        if (cuponAplicado) {
          // Si hay cupón aplicado, quitarlo
          quitarCupon();
        } else {
          // Si no hay cupón, aplicar el código
          const codigo = this.value.trim();
          aplicarCupon(codigo);
        }
      }
    });
    
    // Actualizar descuento si hay cupón aplicado
    actualizarDescuento();
    
    // Mostrar descuento si aplica
    if (cuponAplicado && descuentoCupon > 0) {
      total -= descuentoCupon;
    }

    const totalDiv = document.createElement('div');
    totalDiv.className = 'carrito-total-div';
    totalDiv.innerHTML = `Total: $${Math.max(0, total)}`;
    lista.appendChild(totalDiv);
    // Botón procesar pago
    const btnPago = document.createElement('button');
    btnPago.id = 'btnProcesarPagoCarrito';
    btnPago.className = 'btn-panel btn-green mt-2 carrito-btn-pago';
    btnPago.textContent = 'Procesar pago';
    lista.appendChild(btnPago);
    // Fin
    const saldoDivFooter = document.createElement('div');
    saldoDivFooter.className = 'user-saldo-info mt-2 user-saldo-info-center';
    saldoDivFooter.innerHTML = 'Saldo: ' + storeFormatUserSaldoHtml('user-saldo-' + TIPO_PRECIO);
    lista.appendChild(saldoDivFooter);
    btnPago.addEventListener('click', function() {
      if (carritoPago.length === 0) {
        alert('No hay productos seleccionados para procesar el pago.');
        return;
      }

      syncCartToInventory({ suppressAlerts: true });
      if (carritoPago.length === 0) {
        alert('Tu carrito quedó vacío al validar el inventario. Revisa los productos e inténtalo de nuevo.');
        return;
      }
      
      // Calcular total por moneda
      let totalCop = 0;
      let totalUsd = 0;
      carritoPago.forEach(p => {
        if (p.moneda === 'COP') totalCop += p.cantidad * p.precio_unitario;
        if (p.moneda === 'USD') totalUsd += p.cantidad * p.precio_unitario;
      });
      
      // Aplicar descuento del cupón si existe
      if (cuponAplicado && descuentoCupon > 0) {
        if (cuponAplicado.descuento_cop && cuponAplicado.descuento_cop > 0) {
          totalCop = Math.max(0, totalCop - descuentoCupon);
        } else if (cuponAplicado.descuento_usd && cuponAplicado.descuento_usd > 0) {
          totalUsd = Math.max(0, totalUsd - descuentoCupon);
        }
      }
      
      const payBalanceErr = storePaymentBalanceError(totalCop, totalUsd);
      if (payBalanceErr) {
        alert(payBalanceErr);
        return;
      }
      
      btnPago.disabled = true;
      btnPago.textContent = 'Procesando...';
      
      // Incluir información del cupón en la petición
      const pagoData = {
        productos: serializarProductosPago(),
        cupon_aplicado: cuponAplicado ? {
          id: cuponAplicado.id,
          nombre: cuponAplicado.nombre,
          descuento_cop: cuponAplicado.descuento_cop,
          descuento_usd: cuponAplicado.descuento_usd
        } : null
      };
      
      fetch('/tienda/procesar_pago', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken(),
        },
        body: JSON.stringify(pagoData)
      })
      .then(r => r.json())
      .then(data => {
        btnPago.disabled = false;
        btnPago.textContent = 'Procesar pago';
        if (data.success) {
          SALDO_COP = data.new_saldo_cop;
          SALDO_USD = data.new_saldo_usd;
          updateResumenSaldoDom();
          carritoPago = [];
          cuponAplicado = null;
          descuentoCupon = 0;
          renderResumenPago();
          renderizarCarrito();
          if (data.cuentas_asignadas && data.cuentas_asignadas.length > 0) {
            tiendaAbrirModalPagoExito(data.cuentas_asignadas);
          } else {
            alert('¡Pago realizado con éxito!');
          }
        } else {
          if (!manejarErrorPagoRenovacion(data)) {
            alert(data.error || 'Error al procesar el pago');
          }
        }
      })
      .catch(() => {
        btnPago.disabled = false;
        btnPago.textContent = 'Procesar pago';
        alert('Error de red o servidor.');
      });
    });
    // Eventos para los botones dentro del modal
    lista.querySelectorAll('.btn-carrito-mas').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = parseInt(this.getAttribute('data-id'));
        const prod = carritoPago.find(p => p.id === id);
        if (prod) {
          const stock = getSellableStockForProduct(id);
          if (stock !== null && prod.cantidad >= stock) {
            if (stock <= 0) {
              alert('Este producto ya no tiene existencias.');
            } else {
              alert(
                'Ya tienes la cantidad máxima disponible para este producto (' + stock + ' unidad(es)).'
              );
            }
            return;
          }
          prod.cantidad++;
          // Limpiar descuentos individuales cuando se actualiza la cantidad
          delete prod.descuento_cop;
          delete prod.descuento_usd;
          delete prod.descuento_aplicado;
          
          // Si había un cupón aplicado, quitarlo cuando se actualiza la cantidad
          if (cuponAplicado) {
            cuponAplicado = null;
            descuentoCupon = 0;
            ocultarCuponAplicado();
          }
        }
        actualizarCarritoContador();
        actualizarDescuento();
        renderResumenPago();
        renderizarCarrito();
      });
    });
    lista.querySelectorAll('.btn-carrito-menos').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = parseInt(this.getAttribute('data-id'));
        const prod = carritoPago.find(p => p.id === id);
        if (prod && prod.cantidad > 1) {
          prod.cantidad--;
          // Limpiar descuentos individuales cuando se actualiza la cantidad
          delete prod.descuento_cop;
          delete prod.descuento_usd;
          delete prod.descuento_aplicado;
          
          // Si había un cupón aplicado, quitarlo cuando se actualiza la cantidad
          if (cuponAplicado) {
            cuponAplicado = null;
            descuentoCupon = 0;
            ocultarCuponAplicado();
          }
        } else {
          const esRen = prod && prod.es_renovacion;
          eliminarProductoDelCarrito(id, esRen);
          validarCuponAutomatico();
          return;
        }
        actualizarCarritoContador();
        actualizarDescuento();
        renderResumenPago();
        renderizarCarrito();
        validarCuponAutomatico();
      });
    });
    // Evento para eliminar producto con la X
    lista.querySelectorAll('.btn-eliminar-producto').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = parseInt(this.getAttribute('data-id'), 10);
        const esRen = this.getAttribute('data-es-renovacion') === '1';
        eliminarProductoDelCarrito(id, esRen).then(function () {
          validarCuponAutomatico();
        });
      });
    });
    actualizarCarritoContador();
  }

  document.querySelectorAll('.btn-anadir-producto-tienda').forEach((btn) => {
    btn.addEventListener('click', function() {
      const card = btn.closest('.card.product-texture-bg');
      const nombre = card.querySelector('.mt-05').textContent.trim();
      const input = card.querySelector('.input-cantidad-licencia');
      let cantidadPedida = parseInt(input.value, 10) || 1;
      // Obtener precios por texto
      // Obtener precios desde los atributos data (ya incluyen descuentos aplicados)
      let precioCop = parseFloat(card.getAttribute('data-price-cop')) || 0;
      let precioUsd = parseFloat(card.getAttribute('data-price-usd')) || 0;
      const id = parseInt(card.getAttribute('data-id'), 10);
      const img = card.getAttribute('data-img') || '';
      const existe = carritoPago.find(p => p.id === id);
      const yaEnCarrito = existe ? existe.cantidad : 0;
      const stock = getSellableStockForProduct(id);

      if (stock !== null) {
        if (stock <= 0) {
          alert('No hay existencias disponibles para «' + nombre + '».');
          capCardQuantityInput(card, stock);
          return;
        }
        const hueco = stock - yaEnCarrito;
        if (hueco <= 0) {
          alert(
            'No puedes sumar más de «' + nombre + '». Inventario disponible: ' +
              stock +
              ' unidad(es); ya llevas ' +
              yaEnCarrito +
              ' en el carrito.'
          );
          capCardQuantityInput(card, stock);
          return;
        }
        if (cantidadPedida > hueco) {
          alert(
            'Solo se pueden añadir ' +
              hueco +
              ' unidad(es) más de «' +
              nombre +
              '» (inventario total: ' +
              stock +
              ').'
          );
          cantidadPedida = hueco;
        }
      }

      if (cantidadPedida < 1) return;

      if (cuponAplicado) {
        cuponAplicado = null;
        descuentoCupon = 0;
        ocultarCuponAplicado();
      }

      if (existe) {
        existe.cantidad += cantidadPedida;
        delete existe.descuento_cop;
        delete existe.descuento_usd;
        delete existe.descuento_aplicado;
      } else {
        let precio_unitario = precioCop || precioUsd;
        let moneda = precioCop ? 'COP' : 'USD';
        carritoPago.push({ id, nombre, logo: img, cantidad: cantidadPedida, precio_unitario, moneda });
      }

      capCardQuantityInput(card, stock);
      renderResumenPago();
      renderizarCarrito();
      validarCuponAutomatico();
    });
  });

  // --- Modal migrado ---
  const descModal = document.getElementById('descModal');
  const descModalText = document.getElementById('descModalText');
  const closeDescModalBtn = document.getElementById('closeDescModalBtn');

  // Click en el icono
  document.querySelectorAll('.btn-show-desc').forEach(el => {
    el.addEventListener('click', function() {
      descModalText.innerHTML = el.getAttribute('data-desc');
      descModal.classList.remove('modal-hidden');
      setTimeout(() => {
        descModal.addEventListener('mousedown', closeOnOutsideClick);
      }, 10);
    });
  });

  // Click en el botón de cerrar
  if (closeDescModalBtn) {
    closeDescModalBtn.addEventListener('click', function() {
      descModal.classList.add('modal-hidden');
      descModal.removeEventListener('mousedown', closeOnOutsideClick);
    });
  }

  // Cerrar al hacer click fuera del contenido
  function closeOnOutsideClick(e) {
    if (e.target === descModal) {
      descModal.classList.add('modal-hidden');
      descModal.removeEventListener('mousedown', closeOnOutsideClick);
    }
  }

  
  const sidebarCarritoTienda = document.getElementById('sidebarCarritoTienda');
  const sidebarCarritoOverlay = document.getElementById('sidebarCarritoOverlay');
  const closeSidebarCarritoBtn = document.getElementById('closeSidebarCarritoBtn');

  document.getElementById('btnCarritoTienda').addEventListener('click', function() {
    sidebarCarritoTienda.classList.remove('sidebar-hidden');
    sidebarCarritoOverlay.classList.remove('sidebar-hidden');
    sidebarCarritoTienda.style.display = 'flex';
    sidebarCarritoOverlay.style.display = 'block';
    renderizarCarrito();
  });

  if (closeSidebarCarritoBtn) {
    closeSidebarCarritoBtn.addEventListener('click', function() {
      sidebarCarritoTienda.classList.add('sidebar-hidden');
      sidebarCarritoOverlay.classList.add('sidebar-hidden');
      sidebarCarritoTienda.style.display = 'none';
      sidebarCarritoOverlay.style.display = 'none';
    });
  }
  if (sidebarCarritoOverlay) {
    sidebarCarritoOverlay.addEventListener('mousedown', function(e) {
      sidebarCarritoTienda.classList.add('sidebar-hidden');
      sidebarCarritoOverlay.classList.add('sidebar-hidden');
      sidebarCarritoTienda.style.display = 'none';
      sidebarCarritoOverlay.style.display = 'none';
    });
  }

  // --- Resumen de pago tipo tarjeta ---

  const resumenPagoLista = document.getElementById('listaResumenPago');
  const saldoTotalGeneral = document.getElementById('saldoTotalGeneral');

  // { id, nombre, logo, cantidad, precio_unitario, moneda }
  let carritoPago = [];
  
  try {
    const guardado = localStorage.getItem('carritoPago');
    if (guardado) {
      carritoPago = JSON.parse(guardado);
      // Limpiar descuentos individuales al cargar desde localStorage
      carritoPago.forEach(producto => {
        delete producto.descuento_cop;
        delete producto.descuento_usd;
        delete producto.descuento_aplicado;
      });
    }
  } catch(e) { carritoPago = []; }

  // Saldo y «puede tener deuda»: deben estar listos antes de syncCart/stock poll (usan renderizarCarrito).
  const saldoDataDiv = document.getElementById('userSaldoData');
  let SALDO_USD = 0;
  let SALDO_COP = 0;
  let TIPO_PRECIO = 'usd';
  let STORE_TIPO_REVISION = 0;
  let PUEDE_TENER_DEUDA = false;
  let LIMITE_DEUDA_USD = null;
  let LIMITE_DEUDA_COP = null;
  if (saldoDataDiv) {
    TIPO_PRECIO = String(saldoDataDiv.getAttribute('data-tipo-precio') || 'usd')
      .trim()
      .toLowerCase();
    if (TIPO_PRECIO !== 'cop') {
      TIPO_PRECIO = 'usd';
    }
    STORE_TIPO_REVISION =
      parseInt(saldoDataDiv.getAttribute('data-tipo-precio-revision'), 10) || 0;
    SALDO_USD = parseInt(saldoDataDiv.getAttribute('data-saldo-usd'), 10) || 0;
    SALDO_COP = parseInt(saldoDataDiv.getAttribute('data-saldo-cop'), 10) || 0;
    const pdEarly = saldoDataDiv.getAttribute('data-puede-tener-deuda');
    PUEDE_TENER_DEUDA = pdEarly === '1' || pdEarly === 'true';
    const limUsdRaw = saldoDataDiv.getAttribute('data-limite-deuda-usd');
    const limCopRaw = saldoDataDiv.getAttribute('data-limite-deuda-cop');
    if (limUsdRaw != null && limUsdRaw !== '') {
      const lu = Number(limUsdRaw);
      if (Number.isFinite(lu) && lu >= 0) LIMITE_DEUDA_USD = lu;
    }
    if (limCopRaw != null && limCopRaw !== '') {
      const lc = Number(limCopRaw);
      if (Number.isFinite(lc) && lc >= 0) LIMITE_DEUDA_COP = lc;
    }
  }

  /** Saldo prepago en la moneda del cliente (misma regla que menú y admin). */
  function storeUserSaldoAmount() {
    return TIPO_PRECIO === 'cop' ? SALDO_COP : SALDO_USD;
  }

  function storeUserSaldoCurrencyLabel() {
    return TIPO_PRECIO === 'cop' ? 'COP' : 'USD';
  }

  function storeFormatUserSaldoHtml(className) {
    const amt = storeUserSaldoAmount();
    const cur = storeUserSaldoCurrencyLabel();
    const cls = className || (TIPO_PRECIO === 'cop' ? 'saldo-cop-carrito' : 'saldo-usd-carrito');
    return (
      '<span class="' +
      cls +
      '">$' +
      Number(amt).toLocaleString() +
      ' ' +
      cur +
      '</span>'
    );
  }

  function storeCartTotalForUserCurrency(totalCop, totalUsd) {
    return TIPO_PRECIO === 'cop' ? totalCop : totalUsd;
  }

  function applyStoreSaldoFromApi(data) {
    if (!data) return;
    if (data.tipo_precio) {
      const tp = String(data.tipo_precio).trim().toUpperCase();
      TIPO_PRECIO = tp === 'COP' ? 'cop' : 'usd';
    }
    if (data.tipo_precio_revision != null) {
      STORE_TIPO_REVISION = parseInt(data.tipo_precio_revision, 10) || 0;
    }
    if (data.saldo_usd != null) {
      SALDO_USD = Number(data.saldo_usd) || 0;
    }
    if (data.saldo_cop != null) {
      SALDO_COP = Number(data.saldo_cop) || 0;
    }
    if (storeTipoPrecioCambioDetectado(STORE_TIPO_REVISION)) {
      vaciarCarritoTiendaPorCambioMoneda({ notify: true });
      return;
    }
    updateResumenSaldoDom();
  }

  function updateResumenSaldoDom() {
    const box = document.getElementById('resumenSaldoAmounts');
    if (box) {
      box.innerHTML = storeFormatUserSaldoHtml(
        TIPO_PRECIO === 'cop' ? 'saldo-cop' : 'saldo-usd'
      );
    }
  }

  function refreshStoreFrontSaldoFromApi() {
    return fetch('/tienda/api/user/store-menu-balance', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.show) return data;
        applyStoreSaldoFromApi(data);
        if (typeof renderizarCarrito === 'function') {
          renderizarCarrito();
        }
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function storePaymentBalanceError(totalCop, totalUsd) {
    const totalUser = storeCartTotalForUserCurrency(totalCop, totalUsd);
    const saldoUser = storeUserSaldoAmount();
    const cur = storeUserSaldoCurrencyLabel();
    if (!PUEDE_TENER_DEUDA) {
      if (totalUser > saldoUser) {
        return 'No tienes saldo suficiente en ' + cur + ' para procesar el pago.';
      }
      return null;
    }
    return storeDebtLimitExceededMessage(totalCop, totalUsd);
  }

  function storeDebtLimitExceededMessage(totalCop, totalUsd) {
    if (!PUEDE_TENER_DEUDA) return null;
    if (TIPO_PRECIO === 'cop') {
      if (totalCop > 0 && LIMITE_DEUDA_COP != null) {
        if (SALDO_COP - totalCop < -LIMITE_DEUDA_COP) {
          return (
            'Supera tu límite de deuda COP (' +
            Math.floor(LIMITE_DEUDA_COP) +
            '). Ajusta el pedido o recarga saldo.'
          );
        }
      }
      return null;
    }
    if (totalUsd > 0 && LIMITE_DEUDA_USD != null) {
      if (SALDO_USD - totalUsd < -LIMITE_DEUDA_USD) {
        return (
          'Supera tu límite de deuda USD (' +
          LIMITE_DEUDA_USD +
          '). Ajusta el pedido o recarga saldo.'
        );
      }
    }
    return null;
  }

  // Función para renderizar el resumen
  function renderResumenPago() {
    resumenPagoLista.innerHTML = '';
    let total = 0;
    carritoPago.forEach(producto => {
      const item = document.createElement('div');
      item.className = 'resumen-pago-item';

      
      const logoDiv = document.createElement('div');
      logoDiv.className = 'resumen-pago-logo';
      const img = document.createElement('img');
      img.src = producto.logo;
      img.alt = producto.nombre;
      logoDiv.appendChild(img);
      
      if (producto.es_renovacion) {
        const iconRenWrap = document.createElement('span');
        iconRenWrap.className = 'renovacion-logo-badge';
        iconRenWrap.title = 'Renovación';
        iconRenWrap.innerHTML = '<i class="fas fa-sync-alt"></i>';
        logoDiv.appendChild(iconRenWrap);
      }
      
      item.appendChild(logoDiv);

      // Nombre
      const nombreDiv = document.createElement('div');
      nombreDiv.className = 'resumen-pago-nombre';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'resumen-pago-nombre-title';
      titleSpan.textContent = producto.nombre;
      nombreDiv.appendChild(titleSpan);

      if (producto.es_renovacion && producto.renovacion_emails && producto.renovacion_emails.length) {
        const emailsSpan = document.createElement('span');
        emailsSpan.className = 'resumen-pago-nombre-emails';
        emailsSpan.textContent = producto.renovacion_emails.join(', ');
        nombreDiv.appendChild(emailsSpan);
      }
      item.appendChild(nombreDiv);

      const cantidadDiv = document.createElement('div');
      cantidadDiv.className = 'resumen-pago-cantidad';
      const spanCantidad = document.createElement('span');
      spanCantidad.className = 'cantidad';
      spanCantidad.textContent = producto.cantidad;
      if (producto.es_renovacion) {
        spanCantidad.title = 'Renovación';
        cantidadDiv.appendChild(spanCantidad);
      } else {
        const btnRestar = document.createElement('button');
        btnRestar.className = 'btn-restar';
        btnRestar.textContent = '-';
        btnRestar.onclick = function () {
          actualizarCantidad(producto.id, -1, false);
        };
        const btnSumar = document.createElement('button');
        btnSumar.className = 'btn-sumar';
        btnSumar.textContent = '+';
        btnSumar.onclick = function () {
          actualizarCantidad(producto.id, 1, false);
        };
        cantidadDiv.appendChild(btnRestar);
        cantidadDiv.appendChild(spanCantidad);
        cantidadDiv.appendChild(btnSumar);
      }
      item.appendChild(cantidadDiv);

      // Mostrar descuento individual si aplica (arriba del precio)
      if (producto.descuento_aplicado && (producto.descuento_cop > 0 || producto.descuento_usd > 0)) {
        const descuentoDiv = document.createElement('div');
        descuentoDiv.className = 'resumen-descuento-individual';
        
        let descuentoTexto = '';
        if (producto.descuento_cop > 0) {
          descuentoTexto = `-$${producto.descuento_cop} COP`;
        } else if (producto.descuento_usd > 0) {
          descuentoTexto = `-$${producto.descuento_usd} USD`;
        }
        descuentoDiv.textContent = descuentoTexto;
        item.appendChild(descuentoDiv);
      }

      // Precio total del producto (abajo del descuento)
      const totalDiv = document.createElement('div');
      totalDiv.className = 'resumen-pago-total';
      const totalProducto = producto.cantidad * producto.precio_unitario;
      totalDiv.textContent = `${totalProducto} ${producto.moneda}`;
      item.appendChild(totalDiv);

      // Botón eliminar (X) - va después del precio y descuento
      const btnEliminar = document.createElement('button');
      btnEliminar.className = 'btn-eliminar-producto';
      btnEliminar.title = 'Eliminar producto';
      btnEliminar.textContent = '×';
      btnEliminar.onclick = function () {
        eliminarProductoDelCarrito(producto.id, producto.es_renovacion);
      };
      item.appendChild(btnEliminar);

      resumenPagoLista.appendChild(item);
      total += totalProducto;
    });

    // Actualizar descuento si hay cupón aplicado
    actualizarDescuento();
    
    // Aplicar descuento al total si hay cupón aplicado
    if (cuponAplicado && descuentoCupon > 0) {
      total = Math.max(0, total - descuentoCupon);
    }

    saldoTotalGeneral.textContent = `$${total}`;
    actualizarCarritoContador();
    // Guardar en localStorage
    try {
      localStorage.setItem('carritoPago', JSON.stringify(carritoPago));
    } catch(e) {}
  }

  // Función para actualizar cantidad
  function actualizarCantidad(id, delta, esRenovacion) {
    const prod = carritoPago.find(function (p) {
      return p.id === id && !!p.es_renovacion === !!esRenovacion;
    });
    if (!prod) return;
    if (prod.es_renovacion) return;
    if (delta > 0) {
      const stock = getSellableStockForProduct(id);
      if (stock !== null && prod.cantidad >= stock) {
        if (stock <= 0) {
          alert('Este producto ya no tiene existencias.');
        } else {
          alert(
            'Ya alcanzaste el máximo de existencias disponibles (' + stock + ' unidad(es)).'
          );
        }
        return;
      }
    }
    prod.cantidad += delta;
    if (prod.cantidad < 1) {
      carritoPago = carritoPago.filter(function (p) {
        return !(p.id === id && !!p.es_renovacion === !!esRenovacion);
      });
    } else {
      // Limpiar descuentos individuales cuando se actualiza la cantidad
      delete prod.descuento_cop;
      delete prod.descuento_usd;
      delete prod.descuento_aplicado;
    }
    
    // Si había un cupón aplicado, quitarlo cuando se actualiza la cantidad
    if (cuponAplicado) {
      cuponAplicado = null;
      descuentoCupon = 0;
      ocultarCuponAplicado();
    }
    
    actualizarDescuento();
    renderResumenPago();
    renderizarCarrito();
  }

  // Función para añadir producto al carrito (debería llamarse al hacer click en "Añadir")
  function anadirProductoAlCarrito(producto) {
    const existe = carritoPago.find(p => p.id === producto.id);
    if (existe) {
      existe.cantidad += producto.cantidad;
      // Limpiar descuentos individuales cuando se actualiza la cantidad
      delete existe.descuento_cop;
      delete existe.descuento_usd;
      delete existe.descuento_aplicado;
      
      // Si había un cupón aplicado, quitarlo cuando se actualiza la cantidad
      if (cuponAplicado) {
        cuponAplicado = null;
        descuentoCupon = 0;
        ocultarCuponAplicado();
      }
    } else {
      carritoPago.push({ ...producto });
    }
    actualizarDescuento();
    renderResumenPago();
    renderizarCarrito();
  }

  // Función para eliminar producto del carrito
  function eliminarProductoDelCarrito(id, esRenovacion) {
    let idsLiberar = [];
    if (esRenovacion) {
      const line = carritoPago.find(function (p) {
        return p.id === id && p.es_renovacion;
      });
      if (line && line.renovacion_account_ids && line.renovacion_account_ids.length) {
        idsLiberar = line.renovacion_account_ids.slice();
      }
    }
    const quitarDelCarrito = function () {
      carritoPago = carritoPago.filter(function (p) {
        return !(p.id === id && !!p.es_renovacion === !!esRenovacion);
      });
      actualizarDescuento();
      renderResumenPago();
      renderizarCarrito();
    };
    if (idsLiberar.length) {
      return liberarCuentasRenovacion(idsLiberar).then(quitarDelCarrito);
    }
    quitarDelCarrito();
    return Promise.resolve();
  }

  hydrateProductStockFromSSR();
  sincronizarReservasRenovacionCarrito();
  document.querySelectorAll('.card.product-texture-bg').forEach(function (card) {
    const pid = parseInt(card.getAttribute('data-id'), 10);
    if (!pid) return;
    capCardQuantityInput(card, getSellableStockForProduct(pid));
  });

  // Inicializar resumen: alinear cantidades guardadas al inventario (SSR / primera carga).
  syncCartToInventory();
  renderResumenPago();

  startStockRealtime();
  document.addEventListener('visibilitychange', function () {
    if (!document.querySelector('.product-stock-info')) return;
    startStockRealtime();
  });

  // --- Funciones para manejo de cupones ---
  function aplicarCupon(codigoCupon) {
    if (!codigoCupon || codigoCupon.trim() === '') {
      alert('Por favor ingresa un código de cupón válido.');
      return;
    }

    // Obtener productos del carrito
    const productosCarrito = carritoPago.map(p => p.id);
    const totalCarrito = carritoPago.reduce((acc, p) => acc + (p.cantidad * p.precio_unitario), 0);

    // Validar cupón con el backend
    fetch('/tienda/validate_coupon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: JSON.stringify({
        coupon_code: codigoCupon,
        products: productosCarrito,
        total_amount: totalCarrito
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Convertir respuesta del backend al formato esperado
        const cupon = {
          id: data.coupon.id,
          nombre: data.coupon.name,
          descuento_cop: data.coupon.discount_cop,
          descuento_usd: data.coupon.discount_usd,
          descripcion: data.coupon.description,
          min_amount: data.coupon.min_amount,
          productos_elegibles: data.eligible_products || []
        };
        
        // Aplicar descuentos individuales a cada producto elegible
        if (cupon.productos_elegibles && cupon.productos_elegibles.length > 0) {
          cupon.productos_elegibles.forEach(productoElegible => {
            const productoEnCarrito = carritoPago.find(p => p.id === productoElegible.id);
            if (productoEnCarrito) {
              // Agregar información de descuento al producto
              productoEnCarrito.descuento_cop = productoElegible.discount_cop;
              productoEnCarrito.descuento_usd = productoElegible.discount_usd;
              productoEnCarrito.descuento_aplicado = true;
            }
          });
        }
        
        cuponAplicado = cupon;
        actualizarDescuento();
        mostrarCuponAplicado();
        renderResumenPago();
        renderizarCarrito();
      } else {
        alert(data.error || 'Error al validar el cupón.');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Error de conexión al validar el cupón.');
    });
  }

  function quitarCupon() {
    // Limpiar descuentos individuales de todos los productos
    carritoPago.forEach(producto => {
      delete producto.descuento_cop;
      delete producto.descuento_usd;
      delete producto.descuento_aplicado;
    });
    
    cuponAplicado = null;
    descuentoCupon = 0;
    ocultarCuponAplicado();
    renderResumenPago();
    renderizarCarrito();
  }

  function validarCuponAutomatico() {
    if (!cuponAplicado) return;
    
    // Obtener productos del carrito actual
    const productosCarrito = carritoPago.map(p => p.id);
    const totalCarrito = carritoPago.reduce((acc, p) => acc + (p.cantidad * p.precio_unitario), 0);
    
    // Validar si el cupón sigue siendo válido
    fetch('/tienda/validate_coupon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: JSON.stringify({
        coupon_code: cuponAplicado.nombre,
        products: productosCarrito,
        total_amount: totalCarrito
      })
    })
    .then(response => response.json())
    .then(data => {
      if (!data.success) {
        // Si el cupón ya no es válido, quitarlo automáticamente
        alert(`El cupón "${cuponAplicado.nombre}" ya no es válido: ${data.error}`);
        quitarCupon();
      } else {
        // Actualizar productos elegibles y descuentos individuales
        if (data.eligible_products && data.eligible_products.length > 0) {
          // Limpiar descuentos anteriores
          carritoPago.forEach(producto => {
            delete producto.descuento_cop;
            delete producto.descuento_usd;
            delete producto.descuento_aplicado;
          });
          
          // Aplicar nuevos descuentos
          data.eligible_products.forEach(productoElegible => {
            const productoEnCarrito = carritoPago.find(p => p.id === productoElegible.id);
            if (productoEnCarrito) {
              productoEnCarrito.descuento_cop = productoElegible.discount_cop;
              productoEnCarrito.descuento_usd = productoElegible.discount_usd;
              productoEnCarrito.descuento_aplicado = true;
            }
          });
        }
        
        actualizarDescuento();
        mostrarCuponAplicado();
        renderResumenPago();
        renderizarCarrito();
      }
    })
    .catch(error => {
      console.error('Error validando cupón:', error);
    });
  }

  function actualizarDescuento() {
    if (!cuponAplicado || carritoPago.length === 0) {
      descuentoCupon = 0;
      return;
    }

    // Calcular descuento total basado en productos individuales
    let descuentoTotalCop = 0;
    let descuentoTotalUsd = 0;
    
    carritoPago.forEach(producto => {
      if (producto.descuento_aplicado) {
        if (producto.descuento_cop && producto.descuento_cop > 0) {
          descuentoTotalCop += producto.descuento_cop * producto.cantidad;
        }
        if (producto.descuento_usd && producto.descuento_usd > 0) {
          descuentoTotalUsd += producto.descuento_usd * producto.cantidad;
        }
      }
    });

    // Usar el descuento total (COP tiene prioridad)
    if (descuentoTotalCop > 0) {
      descuentoCupon = descuentoTotalCop;
    } else if (descuentoTotalUsd > 0) {
      descuentoCupon = descuentoTotalUsd;
    } else {
      descuentoCupon = 0;
    }
  }

  function mostrarCuponAplicado() {
    const cuponInfo = document.getElementById('cuponInfo');
    const cuponAplicadoSpan = cuponInfo?.querySelector('.cupon-aplicado');
    const btnAplicar = document.getElementById('btnAplicarCupon');
    const btnQuitar = document.getElementById('btnQuitarCupon');
    const cuponInput = document.getElementById('cuponInput');

    if (cuponInfo && cuponAplicadoSpan) {
      const descuentoText = (cuponAplicado.descuento_cop && cuponAplicado.descuento_cop > 0) ? 
        `$${descuentoCupon} COP` : 
        `$${descuentoCupon} USD`;
      cuponAplicadoSpan.textContent = `Cupón aplicado: ${cuponAplicado.nombre} - ${descuentoText}`;
      cuponInfo.style.display = 'block';
    }
    
    if (btnAplicar) btnAplicar.style.display = 'none';
    if (btnQuitar) btnQuitar.style.display = 'inline-block';
    if (cuponInput) {
      cuponInput.disabled = true;
      cuponInput.value = '';
    }

    // Actualizar en el carrito dinámico
    const cuponInfoCarritoDinamico = document.getElementById('cuponInfoCarritoDinamico');
    if (cuponInfoCarritoDinamico) {
      const cuponAplicadoCarritoDinamico = cuponInfoCarritoDinamico.querySelector('.cupon-aplicado-carrito');
      const btnAplicarCarritoDinamico = document.getElementById('btnAplicarCuponCarritoDinamico');
      const btnQuitarCarritoDinamico = document.getElementById('btnQuitarCuponCarritoDinamico');
      const cuponInputCarritoDinamico = document.getElementById('cuponInputCarritoDinamico');

      if (cuponAplicadoCarritoDinamico) {
        const descuentoTextCarrito = (cuponAplicado.descuento_cop && cuponAplicado.descuento_cop > 0) ? 
          `$${descuentoCupon} COP` : 
          `$${descuentoCupon} USD`;
        cuponAplicadoCarritoDinamico.textContent = `Cupón aplicado: ${cuponAplicado.nombre} - ${descuentoTextCarrito}`;
      }
      
      cuponInfoCarritoDinamico.classList.remove('d-none');
      if (btnAplicarCarritoDinamico) btnAplicarCarritoDinamico.style.display = 'none';
      if (btnQuitarCarritoDinamico) btnQuitarCarritoDinamico.style.display = 'inline-block';
      if (cuponInputCarritoDinamico) {
        cuponInputCarritoDinamico.disabled = true;
        cuponInputCarritoDinamico.value = '';
      }
    }
  }

  function ocultarCuponAplicado() {
    const cuponInfo = document.getElementById('cuponInfo');
    const btnAplicar = document.getElementById('btnAplicarCupon');
    const btnQuitar = document.getElementById('btnQuitarCupon');
    const cuponInput = document.getElementById('cuponInput');

    if (cuponInfo) cuponInfo.style.display = 'none';
    if (btnAplicar) btnAplicar.style.display = 'inline-block';
    if (btnQuitar) btnQuitar.style.display = 'none';
    if (cuponInput) cuponInput.disabled = false;

    // Actualizar en el carrito dinámico
    const cuponInfoCarritoDinamico = document.getElementById('cuponInfoCarritoDinamico');
    if (cuponInfoCarritoDinamico) {
      const btnAplicarCarritoDinamico = document.getElementById('btnAplicarCuponCarritoDinamico');
      const btnQuitarCarritoDinamico = document.getElementById('btnQuitarCuponCarritoDinamico');
      const cuponInputCarritoDinamico = document.getElementById('cuponInputCarritoDinamico');

      cuponInfoCarritoDinamico.classList.add('d-none');
      if (btnAplicarCarritoDinamico) btnAplicarCarritoDinamico.style.display = 'inline-block';
      if (btnQuitarCarritoDinamico) btnQuitarCarritoDinamico.style.display = 'none';
      if (cuponInputCarritoDinamico) cuponInputCarritoDinamico.disabled = false;
    }
  }


  const STORE_TIPO_LS_KEY = 'storeLastTipoPrecio';
  const STORE_TIPO_REV_LS_KEY = 'storeLastTipoPrecioRevision';

  function storeMonedaActivaLabel() {
    return TIPO_PRECIO === 'cop' ? 'COP' : 'USD';
  }

  function syncStoreTipoPrecioLocalStorage() {
    try {
      localStorage.setItem(STORE_TIPO_LS_KEY, TIPO_PRECIO);
      localStorage.setItem(STORE_TIPO_REV_LS_KEY, String(STORE_TIPO_REVISION || 0));
    } catch (e) {}
  }

  function storeTipoPrecioCambioDetectado(revisionActual) {
    const rev =
      revisionActual != null ? parseInt(revisionActual, 10) || 0 : STORE_TIPO_REVISION;
    let lastRev = 0;
    let lastTp = '';
    try {
      lastRev = parseInt(localStorage.getItem(STORE_TIPO_REV_LS_KEY), 10) || 0;
      lastTp = String(localStorage.getItem(STORE_TIPO_LS_KEY) || '')
        .trim()
        .toLowerCase();
    } catch (e) {}
    if (rev > 0 && rev !== lastRev) {
      return true;
    }
    if (lastTp && lastTp !== TIPO_PRECIO) {
      return true;
    }
    return false;
  }

  function vaciarCarritoTiendaPorCambioMoneda(options) {
    const opts = options || {};
    const ids = recolectarIdsRenovacionCarrito();
    if (ids.length) {
      liberarCuentasRenovacion(ids);
    }
    carritoPago = [];
    cuponAplicado = null;
    descuentoCupon = 0;
    try {
      localStorage.removeItem('carritoPago');
    } catch (e) {}
    ocultarCuponAplicado();
    actualizarDescuento();
    syncStoreTipoPrecioLocalStorage();
    renderResumenPago();
    renderizarCarrito();
    if (opts.notify) {
      alert(
        'Tu moneda en la tienda cambió (USD/COP). Se vació el carrito, el cupón y las reservas de renovación.'
      );
    }
  }

  function filtrarCarritoMonedaActiva() {
    const mon = storeMonedaActivaLabel();
    const idsAntes = recolectarIdsRenovacionCarrito();
    const antes = carritoPago.length;
    carritoPago = carritoPago.filter(function (p) {
      return String(p.moneda || '').toUpperCase() === mon;
    });
    if (carritoPago.length === antes) {
      return;
    }
    cuponAplicado = null;
    descuentoCupon = 0;
    ocultarCuponAplicado();
    const idsDespues = recolectarIdsRenovacionCarrito();
    const liberar = idsAntes.filter(function (id) {
      return idsDespues.indexOf(id) === -1;
    });
    if (liberar.length) {
      liberarCuentasRenovacion(liberar);
    }
  }


  // Event listeners para cupones en resumen
  const btnAplicarCupon = document.getElementById('btnAplicarCupon');
  const btnQuitarCupon = document.getElementById('btnQuitarCupon');
  const cuponInput = document.getElementById('cuponInput');

  if (btnAplicarCupon) {
    btnAplicarCupon.addEventListener('click', function() {
      const codigo = document.getElementById('cuponInput').value.trim();
      aplicarCupon(codigo);
    });
  }

  if (btnQuitarCupon) {
    btnQuitarCupon.addEventListener('click', function() {
      quitarCupon();
    });
  }

  // Permitir aplicar cupón con Enter en el resumen
  if (cuponInput) {
    cuponInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        const codigo = this.value.trim();
        aplicarCupon(codigo);
      }
    });
  }

  // Logout: borrar carrito en localStorage
  document.querySelectorAll("a[href$='/logout']").forEach(function(el) {
    el.addEventListener('click', function() {
      try {
        localStorage.removeItem('carritoPago');
        localStorage.removeItem(STORE_TIPO_LS_KEY);
        localStorage.removeItem(STORE_TIPO_REV_LS_KEY);
      } catch(e) {}
    });
  });

  // --- Procesar pago de productos seleccionados ---
  const btnProcesarPago = document.getElementById('btnProcesarPago');
  if (btnProcesarPago) {
    btnProcesarPago.addEventListener('click', function() {
      if (carritoPago.length === 0) {
        alert('No hay productos seleccionados para procesar el pago.');
        return;
      }
      
      // Calcular total por moneda
      let totalCop = 0;
      let totalUsd = 0;
      carritoPago.forEach(p => {
        if (p.moneda === 'COP') totalCop += p.cantidad * p.precio_unitario;
        if (p.moneda === 'USD') totalUsd += p.cantidad * p.precio_unitario;
      });
      
      // Aplicar descuento del cupón si existe
      if (cuponAplicado && descuentoCupon > 0) {
        if (cuponAplicado.descuento_cop && cuponAplicado.descuento_cop > 0) {
          totalCop = Math.max(0, totalCop - descuentoCupon);
        } else if (cuponAplicado.descuento_usd && cuponAplicado.descuento_usd > 0) {
          totalUsd = Math.max(0, totalUsd - descuentoCupon);
        }
      }
      
      const payBalanceErr = storePaymentBalanceError(totalCop, totalUsd);
      if (payBalanceErr) {
        alert(payBalanceErr);
        return;
      }
      
      btnProcesarPago.disabled = true;
      btnProcesarPago.textContent = 'Procesando...';
      
      // Incluir información del cupón en la petición
      const pagoData = {
        productos: serializarProductosPago(),
        cupon_aplicado: cuponAplicado ? {
          id: cuponAplicado.id,
          nombre: cuponAplicado.nombre,
          descuento_cop: cuponAplicado.descuento_cop,
          descuento_usd: cuponAplicado.descuento_usd
        } : null
      };
      
      fetch('/tienda/procesar_pago', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken(),
        },
        body: JSON.stringify(pagoData)
      })
      .then(r => r.json())
      .then(data => {
        btnProcesarPago.disabled = false;
        btnProcesarPago.textContent = 'Procesar pago';
        if (data.success) {
          SALDO_COP = data.new_saldo_cop;
          SALDO_USD = data.new_saldo_usd;
          updateResumenSaldoDom();
          
          carritoPago = [];
          cuponAplicado = null;
          descuentoCupon = 0;
          renderResumenPago();
          renderizarCarrito();
          
          if (data.cuentas_asignadas && data.cuentas_asignadas.length > 0) {
            tiendaAbrirModalPagoExito(data.cuentas_asignadas);
          } else {
            alert('¡Pago realizado con éxito!');
          }
        } else {
          if (!manejarErrorPagoRenovacion(data)) {
            alert(data.error || 'Error al procesar el pago');
          }
        }
      })
      .catch(() => {
        btnProcesarPago.disabled = false;
        btnProcesarPago.textContent = 'Procesar pago';
        alert('Error de red o servidor.');
      });
    });
  }
  
  // Inicialización al cargar la página
  if (storeTipoPrecioCambioDetectado(STORE_TIPO_REVISION)) {
    vaciarCarritoTiendaPorCambioMoneda({ notify: true });
  } else {
    filtrarCarritoMonedaActiva();
    syncStoreTipoPrecioLocalStorage();
  }
  cuponAplicado = null;
  descuentoCupon = 0;
  ocultarCuponAplicado();
  actualizarDescuento();
  renderResumenPago();
  renderizarCarrito();
  refreshStoreFrontSaldoFromApi();

  window.addEventListener('store-menu-balance-updated', function (ev) {
    applyStoreSaldoFromApi(ev && ev.detail ? ev.detail : null);
    if (typeof renderizarCarrito === 'function') {
      renderizarCarrito();
    }
  });

  window.TiendaRenovacion = {
    getCart: function () {
      return carritoPago;
    },
    persistAndRender: function () {
      if (cuponAplicado) {
        cuponAplicado = null;
        descuentoCupon = 0;
        ocultarCuponAplicado();
      }
      actualizarDescuento();
      renderResumenPago();
      renderizarCarrito();
      actualizarCarritoContador();
      try {
        localStorage.setItem('carritoPago', JSON.stringify(carritoPago));
      } catch (e) {}
      validarCuponAutomatico();
    },
    getCsrfToken: getCsrfToken,
    getProductPricing: function (productId) {
      const card = document.querySelector('.card.product-texture-bg[data-id="' + productId + '"]');
      if (!card) return null;
      const precioCop = parseFloat(card.getAttribute('data-price-cop')) || 0;
      const precioUsd = parseFloat(card.getAttribute('data-price-usd')) || 0;
      const precio_unitario = precioCop || precioUsd;
      const moneda = precioCop ? 'COP' : 'USD';
      const img = card.getAttribute('data-img') || '';
      const nombre =
        (card.querySelector('.product-name') || card.querySelector('.mt-05') || {}).textContent ||
        '';
      return {
        precio_unitario: precio_unitario,
        moneda: moneda,
        logo: img,
        nombre: String(nombre).trim(),
      };
    },
    addRenewalItems: function (items) {
      if (!items || !items.length) return Promise.resolve(0);
      const toReserve = [];
      items.forEach(function (it) {
        const aid = parseInt(it.account_id, 10);
        if (!aid) return;
        let exists = false;
        carritoPago.forEach(function (p) {
          if (
            p.es_renovacion &&
            p.renovacion_account_ids &&
            p.renovacion_account_ids.indexOf(aid) !== -1
          ) {
            exists = true;
          }
        });
        if (!exists) toReserve.push(it);
      });
      if (!toReserve.length) return Promise.resolve(0);
      const ids = toReserve.map(function (it) {
        return parseInt(it.account_id, 10);
      });
      return reservarCuentasRenovacion(ids).then(function (data) {
        if (!data || !data.success) {
          alert((data && data.error) || 'No se pudo reservar la cuenta.');
          return 0;
        }
        const reservedSet = {};
        (data.reserved || []).forEach(function (id) {
          reservedSet[parseInt(id, 10)] = true;
        });
        let added = 0;
        toReserve.forEach(function (it) {
          const aid = parseInt(it.account_id, 10);
          if (!reservedSet[aid]) return;
          const pricing = window.TiendaRenovacion.getProductPricing(it.product_id);
          if (!pricing) return;
          let line = carritoPago.find(function (p) {
            return p.id === it.product_id && p.es_renovacion;
          });
          if (!line) {
            line = {
              id: it.product_id,
              nombre: pricing.nombre,
              logo: pricing.logo,
              cantidad: 0,
              precio_unitario: pricing.precio_unitario,
              moneda: pricing.moneda,
              es_renovacion: true,
              renovacion_account_ids: [],
              renovacion_emails: [],
            };
            carritoPago.push(line);
          }
          if (line.renovacion_account_ids.indexOf(aid) !== -1) return;
          line.renovacion_account_ids.push(aid);
          line.renovacion_emails.push(it.email);
          line.cantidad = line.renovacion_account_ids.length;
          added += 1;
        });
        if (data.failed && data.failed.length) {
          alert(
            'Algunas cuentas ya no están disponibles: ' +
              data.failed
                .map(function (f) {
                  return f.email || f.account_id;
                })
                .join(', ')
          );
        }
        if (added > 0) {
          window.TiendaRenovacion.persistAndRender();
        }
        return added;
      });
    },
  };
}); 
