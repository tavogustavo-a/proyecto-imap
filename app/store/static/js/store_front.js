document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchStoreInput');
  const clearBtn = document.getElementById('clearStoreSearch');
  const productCards = document.querySelectorAll('.card.product-texture-bg');

  if (searchInput && clearBtn && productCards.length) {
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
    
    clearBtn.addEventListener('click', function(e) {
      e.preventDefault();
      searchInput.value = '';
      filterProducts();
      searchInput.focus();
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
        input.value = parseInt(input.value) + 1;
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

  // Variables para actualización de stock
  let stockUpdateInterval = null;

  // Función para actualizar el stock de todos los productos
  async function updateAllProductsStock() {
    try {
      const response = await fetch('/tienda/api/products/stock');
      if (!response.ok) {
        console.error('Error al obtener stock de productos');
        return;
      }
      
      const data = await response.json();
      if (data.success && data.stock) {
        // Actualizar cada producto
        Object.keys(data.stock).forEach(productId => {
          const stockElement = document.querySelector(`.product-stock-info[data-product-id="${productId}"]`);
          if (stockElement) {
            const stock = data.stock[productId];
            stockElement.textContent = `${stock} existencias`;
          }
        });
      }
    } catch (error) {
      console.error('Error al actualizar stock:', error);
    }
  }

  // Cargar stock inicial y configurar actualización periódica
  updateAllProductsStock();
  // Actualizar cada 5 segundos
  stockUpdateInterval = setInterval(updateAllProductsStock, 5000);

  // Función para obtener el token CSRF
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
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
      
      div.innerHTML = `
        <button class="btn-eliminar-producto" title="Eliminar producto" data-id="${producto.id}">×</button>
        <div class="carrito-producto-superior">
          <img src="${producto.logo}" alt="logo" class="carrito-producto-logo">
          <span class="carrito-producto-nombre">${producto.nombre}</span>
        </div>
        <div class="carrito-producto-inferior">
          <div class="carrito-producto-cantidad-btns">
            <button class="btn-carrito-menos" data-id="${producto.id}">-</button>
            <span class="carrito-cantidad-num">${producto.cantidad}</span>
            <button class="btn-carrito-mas" data-id="${producto.id}">+</button>
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
        descuentoDiv.style.cssText = 'font-size: 0.8rem; color: #28a745; font-weight: 600; margin-top: 0.5rem; text-align: center; background: rgba(40, 167, 69, 0.1); padding: 0.3rem 0.5rem; border-radius: 6px; border: 1px solid rgba(40, 167, 69, 0.3);';
        
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
    cuponDiv.style.background = '#f8f9fa';
    cuponDiv.style.padding = '12px 16px';
    cuponDiv.style.borderRadius = '8px';
    cuponDiv.style.border = '1px solid #dee2e6';
    cuponDiv.style.marginBottom = '16px';
    
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
      <div id="cuponInfoCarritoDinamico" class="cupon-info-carrito mt-1" style="display: ${tieneCupon ? 'block' : 'none'};">
        <span class="cupon-aplicado-carrito">Cupón aplicado: ${tieneCupon ? cuponAplicado.nombre : ''} - $${tieneCupon ? descuentoCupon : 0} ${tieneCupon ? (cuponAplicado.descuento_cop ? 'COP' : 'USD') : ''}</span>
      </div>
    `;
    lista.appendChild(cuponDiv);

    // Insertar sección de saldo disponible después del cupón
    const saldoDiv = document.createElement('div');
    saldoDiv.className = 'carrito-saldo-dinamico mt-2';
    saldoDiv.style.background = '#f8f9fa';
    saldoDiv.style.padding = '12px 16px';
    saldoDiv.style.borderRadius = '8px';
    saldoDiv.style.border = '1px solid #dee2e6';
    saldoDiv.style.marginBottom = '16px';
    
    let saldoHtml = '<div class="saldo-info-carrito">';
    saldoHtml += '<span class="saldo-label-carrito" style="font-weight: 600; color: #2c3e50;">Saldo disponible:</span>';
    saldoHtml += '<div class="saldo-amounts-carrito" style="margin-top: 0.5rem;">';
    
    if (SALDO_COP && SALDO_COP > 0) {
      saldoHtml += `<span class="saldo-cop-carrito" style="color: #28a745; font-weight: 600;">$${SALDO_COP.toLocaleString()} COP</span>`;
    }
    if (SALDO_USD && SALDO_USD > 0) {
      if (SALDO_COP && SALDO_COP > 0) {
        saldoHtml += '<span class="saldo-separator-carrito" style="margin: 0 0.5rem; color: #6c757d;">|</span>';
      }
      saldoHtml += `<span class="saldo-usd-carrito" style="color: #28a745; font-weight: 600;">$${SALDO_USD.toLocaleString()} USD</span>`;
    }
    
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
    totalDiv.style = 'margin-top:1.2em; text-align:center; font-weight:bold; color:#1976d2; font-size:1.13em;';
    totalDiv.innerHTML = `Total: $${Math.max(0, total)}`;
    lista.appendChild(totalDiv);
    // Botón procesar pago
    const btnPago = document.createElement('button');
    btnPago.id = 'btnProcesarPagoCarrito';
    btnPago.className = 'btn-panel btn-green mt-2';
    btnPago.textContent = 'Procesar pago';
    btnPago.style.margin = '16px auto 0 auto';
    btnPago.style.display = 'block';
    lista.appendChild(btnPago);
    // Fin
    const saldoDataDiv = document.getElementById('userSaldoData');
    let saldoCop = saldoDataDiv ? parseInt(saldoDataDiv.getAttribute('data-saldo-cop')) : 0;
    let saldoUsd = saldoDataDiv ? parseInt(saldoDataDiv.getAttribute('data-saldo-usd')) : 0;
    if (saldoCop || saldoUsd) {
      const saldoDiv = document.createElement('div');
      saldoDiv.className = 'user-saldo-info mt-2';
      saldoDiv.style.textAlign = 'center';
      saldoDiv.style.fontWeight = 'bold';
      let saldoHtml = 'Saldo: ';
      if (saldoCop) {
        saldoHtml += `<span class="user-saldo-cop">$${saldoCop} COP</span>`;
      }
      if (saldoCop && saldoUsd) {
        saldoHtml += ' | ';
      }
      if (saldoUsd) {
        saldoHtml += `<span class="user-saldo-usd">$${saldoUsd} USD</span>`;
      }
      saldoDiv.innerHTML = saldoHtml;
      lista.appendChild(saldoDiv);
    }
    btnPago.addEventListener('click', function() {
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
      
      // Verificar saldo suficiente
      if (typeof SALDO_COP !== 'undefined' && totalCop > SALDO_COP) {
        alert('No tienes saldo suficiente en COP para procesar el pago.');
        return;
      }
      if (typeof SALDO_USD !== 'undefined' && totalUsd > SALDO_USD) {
        alert('No tienes saldo suficiente en USD para procesar el pago.');
        return;
      }
      
      btnPago.disabled = true;
      btnPago.textContent = 'Procesando...';
      
      // Incluir información del cupón en la petición
      const pagoData = {
        productos: carritoPago,
        cupon_aplicado: cuponAplicado ? {
          id: cuponAplicado.id,
          nombre: cuponAplicado.nombre,
          descuento_cop: cuponAplicado.descuento_cop,
          descuento_usd: cuponAplicado.descuento_usd
        } : null
      };
      
      fetch('/tienda/procesar_pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pagoData)
      })
      .then(r => r.json())
      .then(data => {
        btnPago.disabled = false;
        btnPago.textContent = 'Procesar pago';
        if (data.success) {
          SALDO_COP = data.new_saldo_cop;
          SALDO_USD = data.new_saldo_usd;
          carritoPago = [];
          cuponAplicado = null;
          descuentoCupon = 0;
          renderResumenPago();
          renderizarCarrito();
          alert('¡Pago realizado con éxito!');
        } else {
          alert(data.error || 'Error al procesar el pago');
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
          const idx = carritoPago.findIndex(p => p.id === id);
          if (idx !== -1) carritoPago.splice(idx, 1);
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
        const id = parseInt(this.getAttribute('data-id'));
        const idx = carritoPago.findIndex(p => p.id === id);
        if (idx !== -1) carritoPago.splice(idx, 1);
        actualizarCarritoContador();
        renderResumenPago();
        renderizarCarrito();
        validarCuponAutomatico();
      });
    });
    actualizarCarritoContador();
  }

  document.querySelectorAll('.btn-anadir-producto-tienda').forEach((btn) => {
    btn.addEventListener('click', function() {
      const card = btn.closest('.card.product-texture-bg');
      const nombre = card.querySelector('.mt-05').textContent.trim();
      const input = card.querySelector('.input-cantidad-licencia');
      const cantidad = parseInt(input.value) || 1;
      // Obtener precios por texto
      // Obtener precios desde los atributos data (ya incluyen descuentos aplicados)
      let precioCop = parseFloat(card.getAttribute('data-price-cop')) || 0;
      let precioUsd = parseFloat(card.getAttribute('data-price-usd')) || 0;
      const id = parseInt(card.getAttribute('data-id'));
      const img = card.getAttribute('data-img') || '';
      // Agregar al carrito
      const existe = carritoPago.find(p => p.id === id);
      if (existe) {
        existe.cantidad += cantidad;
      } else {
        // Moneda y precio unitario
        let precio_unitario = precioCop || precioUsd;
        let moneda = precioCop ? 'COP' : 'USD';
        carritoPago.push({ id, nombre, logo: img, cantidad, precio_unitario, moneda });
      }
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
      item.appendChild(logoDiv);

      // Nombre
      const nombreDiv = document.createElement('div');
      nombreDiv.className = 'resumen-pago-nombre';
      nombreDiv.textContent = producto.nombre;
      item.appendChild(nombreDiv);

      // Cantidad con botones
      const cantidadDiv = document.createElement('div');
      cantidadDiv.className = 'resumen-pago-cantidad';
      const btnRestar = document.createElement('button');
      btnRestar.className = 'btn-restar';
      btnRestar.textContent = '-';
      btnRestar.onclick = () => actualizarCantidad(producto.id, -1);
      const spanCantidad = document.createElement('span');
      spanCantidad.className = 'cantidad';
      spanCantidad.textContent = producto.cantidad;
      const btnSumar = document.createElement('button');
      btnSumar.className = 'btn-sumar';
      btnSumar.textContent = '+';
      btnSumar.onclick = () => actualizarCantidad(producto.id, 1);
      cantidadDiv.appendChild(btnRestar);
      cantidadDiv.appendChild(spanCantidad);
      cantidadDiv.appendChild(btnSumar);
      item.appendChild(cantidadDiv);

      // Mostrar descuento individual si aplica (arriba del precio)
      if (producto.descuento_aplicado && (producto.descuento_cop > 0 || producto.descuento_usd > 0)) {
        const descuentoDiv = document.createElement('div');
        descuentoDiv.className = 'resumen-descuento-individual';
        descuentoDiv.style.cssText = 'font-size: 0.7rem; color: #28a745; font-weight: 600; margin-bottom: 0.2rem; text-align: center; background: rgba(40, 167, 69, 0.1); padding: 0.15rem 0.3rem; border-radius: 3px; border: 1px solid rgba(40, 167, 69, 0.3);';
        
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
      btnEliminar.onclick = () => eliminarProductoDelCarrito(producto.id);
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
  function actualizarCantidad(id, delta) {
    const prod = carritoPago.find(p => p.id === id);
    if (!prod) return;
    prod.cantidad += delta;
    if (prod.cantidad < 1) {
      // Eliminar el producto del carrito si la cantidad es menor a 1
      carritoPago = carritoPago.filter(p => p.id !== id);
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
  function eliminarProductoDelCarrito(id) {
    carritoPago = carritoPago.filter(p => p.id !== id);
    actualizarDescuento();
    renderResumenPago();
    renderizarCarrito();
  }

  // Inicializar resumen vacío
  renderResumenPago();

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
      
      cuponInfoCarritoDinamico.style.display = 'flex';
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

      cuponInfoCarritoDinamico.style.display = 'none';
      if (btnAplicarCarritoDinamico) btnAplicarCarritoDinamico.style.display = 'inline-block';
      if (btnQuitarCarritoDinamico) btnQuitarCarritoDinamico.style.display = 'none';
      if (cuponInputCarritoDinamico) cuponInputCarritoDinamico.disabled = false;
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

  // --- Obtener saldo del usuario desde el HTML ---
  const saldoDataDiv = document.getElementById('userSaldoData');
  let SALDO_USD = 0;
  let SALDO_COP = 0;
  if (saldoDataDiv) {
    SALDO_USD = parseInt(saldoDataDiv.getAttribute('data-saldo-usd')) || 0;
    SALDO_COP = parseInt(saldoDataDiv.getAttribute('data-saldo-cop')) || 0;
  }

  // Logout
  document.querySelectorAll("a[href$='/logout']").forEach(function(el) {
    el.addEventListener('click', function() {
      try { localStorage.removeItem('carritoPago'); } catch(e) {}
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
      
      // Verificar saldo suficiente
      if (typeof SALDO_COP !== 'undefined' && totalCop > SALDO_COP) {
        alert('No tienes saldo suficiente en COP para procesar el pago.');
        return;
      }
      if (typeof SALDO_USD !== 'undefined' && totalUsd > SALDO_USD) {
        alert('No tienes saldo suficiente en USD para procesar el pago.');
        return;
      }
      
      btnProcesarPago.disabled = true;
      btnProcesarPago.textContent = 'Procesando...';
      
      // Incluir información del cupón en la petición
      const pagoData = {
        productos: carritoPago,
        cupon_aplicado: cuponAplicado ? {
          id: cuponAplicado.id,
          nombre: cuponAplicado.nombre,
          descuento_cop: cuponAplicado.descuento_cop,
          descuento_usd: cuponAplicado.descuento_usd
        } : null
      };
      
      fetch('/tienda/procesar_pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pagoData)
      })
      .then(r => r.json())
      .then(data => {
        btnProcesarPago.disabled = false;
        btnProcesarPago.textContent = 'Procesar pago';
        if (data.success) {
          SALDO_COP = data.new_saldo_cop;
          SALDO_USD = data.new_saldo_usd;
          
          // Mostrar información de cuentas asignadas si hay
          let mensaje = '¡Pago realizado con éxito!';
          if (data.cuentas_asignadas && data.cuentas_asignadas.length > 0) {
            mensaje += '\n\nCuentas asignadas:\n';
            const cuentasPorProducto = {};
            data.cuentas_asignadas.forEach(cuenta => {
              if (!cuentasPorProducto[cuenta.producto]) {
                cuentasPorProducto[cuenta.producto] = [];
              }
              cuentasPorProducto[cuenta.producto].push(cuenta);
            });
            
            Object.keys(cuentasPorProducto).forEach(producto => {
              mensaje += `\n${producto}:\n`;
              cuentasPorProducto[producto].forEach(cuenta => {
                mensaje += `  - ${cuenta.email} / ${cuenta.password}\n`;
              });
            });
            mensaje += '\nRevisa tu historial de compras para más detalles.';
          }
          
          carritoPago = [];
          cuponAplicado = null;
          descuentoCupon = 0;
          renderResumenPago();
          renderizarCarrito();
          alert(mensaje);
        } else {
          alert(data.error || 'Error al procesar el pago');
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
  // Resetear cupón y limpiar descuentos individuales
  cuponAplicado = null;
  descuentoCupon = 0;
  ocultarCuponAplicado();
  actualizarDescuento();
  renderResumenPago();
  renderizarCarrito();
}); 
