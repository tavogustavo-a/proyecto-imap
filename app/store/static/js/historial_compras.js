document.addEventListener('DOMContentLoaded', function() {
  const inputBusqueda = document.getElementById('busquedaCompras');
  const tabla = document.getElementById('tabla-compras');
  const tbody = document.getElementById('tbody-compras');
  const paginacion = document.getElementById('paginacion-compras');

  // Obtener datos originales de la tabla
  let datos = [];
  Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length === 4) {
      datos.push({
        fecha: tds[0].innerText,
        producto: tds[1].innerText,
        cantidad: tds[2].innerText,
        total: tds[3].innerText
      });
    }
  });

  // Función
  let paginaActual = 1;
  const filasPorPagina = 10;
  let datosFiltrados = [...datos];

  function renderTabla() {
    tbody.innerHTML = '';
    const inicio = (paginaActual - 1) * filasPorPagina;
    const fin = inicio + filasPorPagina;
    const pagina = datosFiltrados.slice(inicio, fin);
    if (pagina.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No tienes compras registradas aún.</td></tr>';
    } else {
      pagina.forEach(row => {
        tbody.innerHTML += `<tr>
          <td>${row.fecha}</td>
          <td><i class='fas fa-ticket-alt'></i> ${row.producto}</td>
          <td>${row.cantidad}</td>
          <td>${row.total}</td>
        </tr>`;
      });
    }
  }

  function renderPaginacion() {
    paginacion.innerHTML = '';
    const totalPaginas = Math.ceil(datosFiltrados.length / filasPorPagina);
    if (totalPaginas <= 1) return;
    const btnAnt = document.createElement('button');
    btnAnt.textContent = 'Anterior';
    btnAnt.className = 'btn btn-sm btn-secondary mx-1';
    btnAnt.disabled = paginaActual === 1;
    btnAnt.onclick = () => { paginaActual--; actualizar(); };
    paginacion.appendChild(btnAnt);
    for (let i = 1; i <= totalPaginas; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.className = 'btn btn-sm ' + (i === paginaActual ? 'btn-primary' : 'btn-light') + ' mx-1';
      btn.onclick = () => { paginaActual = i; actualizar(); };
      paginacion.appendChild(btn);
    }
    const btnSig = document.createElement('button');
    btnSig.textContent = 'Siguiente';
    btnSig.className = 'btn btn-sm btn-secondary mx-1';
    btnSig.disabled = paginaActual === totalPaginas;
    btnSig.onclick = () => { paginaActual++; actualizar(); };
    paginacion.appendChild(btnSig);
  }

  function actualizar() {
    renderTabla();
    renderPaginacion();
  }

  function filtrar() {
    const q = inputBusqueda.value.trim().toLowerCase();
    if (!q) {
      datosFiltrados = [...datos];
    } else {
      datosFiltrados = datos.filter(row =>
        row.fecha.toLowerCase().includes(q) ||
        row.producto.toLowerCase().includes(q) ||
        row.cantidad.toLowerCase().includes(q) ||
        row.total.toLowerCase().includes(q)
      );
    }
    paginaActual = 1;
    actualizar();
  }

  inputBusqueda.addEventListener('input', filtrar);
  
  // Event listener para la 'x' nativa de limpiar
  inputBusqueda.addEventListener('search', function() {
    // Se activa cuando se usa la 'x' nativa para limpiar
    filtrar();
  });

  actualizar();
}); 
