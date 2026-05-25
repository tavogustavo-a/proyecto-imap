/**
 * Historial · Licencias (tabla, búsqueda y paginación) en Historial de Compra.
 */
document.addEventListener('DOMContentLoaded', function () {
  const section = document.getElementById('purchaseHistoryLicenciasSection');
  if (!section) return;

  const searchInp = document.getElementById('userHistorialSearch');
  const pageSizeSel = document.getElementById('userHistorialPageSize');
  const metaEl = document.getElementById('userHistorialMeta');
  const prevBtn = document.getElementById('userHistorialPrev');
  const nextBtn = document.getElementById('userHistorialNext');
  const tbody = document.getElementById('userHistorialTableBody');
  if (!tbody || !searchInp || !pageSizeSel) return;

  const domRows = Array.from(tbody.querySelectorAll('tr.user-historial-row-item'));
  const emptyMsg = tbody.querySelector('.user-historial-empty-msg');

  if (domRows.length === 0) {
    if (metaEl) metaEl.textContent = '0';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  const rowData = domRows.map(function (tr) {
    const fecha = tr.querySelector('.user-historial-fecha');
    const usuario = tr.querySelector('.user-historial-usuario');
    const tipo = tr.querySelector('.user-historial-tipo');
    const resumen = tr.querySelector('.user-historial-resumen');
    const parts = [
      fecha ? fecha.textContent : '',
      usuario ? usuario.textContent : '',
      tipo ? tipo.textContent : '',
      resumen ? resumen.textContent : '',
    ];
    return { tr: tr, txt: parts.join(' ').toLowerCase() };
  });

  let page = 1;
  let searchDebounce = null;

  function getPageSize() {
    const v = pageSizeSel.value;
    if (v === 'all') return Infinity;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  function renderPanel() {
    const q = (searchInp.value || '').toLowerCase().trim();
    const filtered = q
      ? rowData.filter(function (r) {
          return r.txt.indexOf(q) !== -1;
        })
      : rowData;

    const total = filtered.length;
    const ps = getPageSize();
    const totalPages =
      ps === Infinity || total === 0 ? 1 : Math.max(1, Math.ceil(total / ps));

    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;

    let start = 0;
    let end = total;
    if (ps !== Infinity && total > 0) {
      start = (page - 1) * ps;
      end = Math.min(start + ps, total);
    }

    domRows.forEach(function (tr) {
      tr.style.display = 'none';
    });

    for (let i = start; i < end; i++) {
      if (filtered[i] && filtered[i].tr) {
        filtered[i].tr.style.display = '';
      }
    }

    if (emptyMsg) {
      if (total === 0) {
        emptyMsg.style.display = '';
        const emptyCell = emptyMsg.querySelector('td');
        if (emptyCell) {
          emptyCell.textContent = q
            ? 'Sin coincidencias'
            : 'Aún no hay actividad registrada.';
        }
      } else {
        emptyMsg.style.display = 'none';
      }
    }

    if (metaEl) {
      if (total === 0) {
        metaEl.textContent = q ? 'Sin coincidencias' : '0';
      } else if (ps === Infinity) {
        metaEl.textContent = String(total);
      } else {
        metaEl.textContent =
          start +
          1 +
          '–' +
          end +
          ' de ' +
          total +
          ' · pág. ' +
          page +
          '/' +
          totalPages;
      }
    }

    if (prevBtn) prevBtn.disabled = page <= 1 || ps === Infinity || total === 0;
    if (nextBtn) nextBtn.disabled = page >= totalPages || ps === Infinity || total === 0;
  }

  searchInp.addEventListener('input', function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      page = 1;
      renderPanel();
    }, 200);
  });

  pageSizeSel.addEventListener('change', function () {
    page = 1;
    renderPanel();
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      if (page > 1) {
        page -= 1;
        renderPanel();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      const q = (searchInp.value || '').toLowerCase().trim();
      const total = q
        ? rowData.filter(function (r) {
            return r.txt.indexOf(q) !== -1;
          }).length
        : rowData.length;
      const ps = getPageSize();
      const totalPages =
        ps === Infinity || total === 0 ? 1 : Math.max(1, Math.ceil(total / ps));
      if (page < totalPages) {
        page += 1;
        renderPanel();
      }
    });
  }

  renderPanel();

  if (window.location.hash === '#purchaseHistoryLicenciasSection') {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
