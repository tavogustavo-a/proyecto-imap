/**
 * Modal de renovación en tienda pública (cuentas en licencias para venta).
 */
document.addEventListener('DOMContentLoaded', function () {
  const btnOpen = document.getElementById('btnStoreRenovacion');
  const modal = document.getElementById('renovacionModal');
  if (!btnOpen || !modal) return;

  const closeBtn = document.getElementById('closeRenovacionModalBtn');
  const input = document.getElementById('renovacionCuentasInput');
  const searchForm = document.getElementById('renovacionSearchForm');
  const btnBuscar = document.getElementById('btnRenovacionBuscar');
  const renewableWrap = document.getElementById('renovacionRenewableWrap');
  const renewableList = document.getElementById('renovacionRenewableList');
  const rejectedWrap = document.getElementById('renovacionRejectedWrap');
  const rejectedList = document.getElementById('renovacionRejectedList');
  const msgEl = document.getElementById('renovacionModalMsg');
  const btnInfo = document.getElementById('btnRenovacionInfo');
  const infoTip = document.getElementById('renovacionInfoTip');
  const infoWrap = btnInfo && btnInfo.closest('.renovacion-title-info-wrap');
  const modalPanel = modal && modal.querySelector('.renovacion-modal-panel');
  const buscarUrl = (modal && modal.getAttribute('data-buscar-url')) || '/tienda/api/renovacion/buscar';

  let lastRenewable = [];
  let lastRejected = [];
  let searchSeq = 0;

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function setMsg(text, isError) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.classList.toggle('renovacion-modal-msg--error', !!isError);
  }

  function ensureModalInBody() {
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
  }

  function openModal() {
    ensureModalInBody();
    modal.classList.remove('modal-hidden');
    lastRenewable = [];
    lastRejected = [];
    renderResults();
    setMsg('', false);
    if (input) {
      input.focus();
    }
  }

  function closeRenovacionInfoTip() {
    if (!infoTip || !btnInfo) return;
    infoTip.classList.add('hidden');
    btnInfo.setAttribute('aria-expanded', 'false');
    if (infoWrap) infoWrap.classList.remove('is-open');
    if (modalPanel) modalPanel.classList.remove('renovacion-info-open');
  }

  function openRenovacionInfoTip() {
    if (!infoTip || !btnInfo) return;
    infoTip.classList.remove('hidden');
    btnInfo.setAttribute('aria-expanded', 'true');
    if (infoWrap) infoWrap.classList.add('is-open');
    if (modalPanel) modalPanel.classList.add('renovacion-info-open');
  }

  function toggleRenovacionInfoTip() {
    if (!infoTip || !btnInfo) return;
    if (infoTip.classList.contains('hidden')) {
      openRenovacionInfoTip();
    } else {
      closeRenovacionInfoTip();
    }
  }

  function closeModal() {
    closeRenovacionInfoTip();
    modal.classList.add('modal-hidden');
  }

  function renderResults() {
    if (renewableList) {
      renewableList.innerHTML = '';
      lastRenewable.forEach(function (row) {
        const li = document.createElement('li');
        li.className = 'renovacion-result-row';
        li.innerHTML =
          '<span class="renovacion-result-email">' +
          escapeHtml(row.email) +
          '</span>' +
          '<button type="button" class="btn-renovacion-agregar-one" data-account-id="' +
          escapeHtml(String(row.account_id)) +
          '" title="Agregar al carrito" aria-label="Agregar al carrito">' +
          '<i class="fas fa-shopping-cart" aria-hidden="true"></i></button>';
        renewableList.appendChild(li);
      });
    }
    if (renewableWrap) {
      renewableWrap.classList.toggle('hidden', lastRenewable.length === 0);
    }
    if (rejectedList) {
      rejectedList.innerHTML = '';
      lastRejected.forEach(function (row) {
        const li = document.createElement('li');
        li.className = 'renovacion-result-row renovacion-result-row--rejected';
        li.innerHTML =
          '<span class="renovacion-result-email">' +
          escapeHtml(row.email) +
          '</span>' +
          '<span class="renovacion-result-reason">' +
          escapeHtml(row.message || 'No disponible') +
          '</span>';
        rejectedList.appendChild(li);
      });
    }
    if (rejectedWrap) {
      rejectedWrap.classList.toggle('hidden', lastRejected.length === 0);
    }
  }

  function getTiendaApi() {
    return window.TiendaRenovacion || null;
  }

  function addItems(items) {
    const api = getTiendaApi();
    if (!api || !api.addRenewalItems) {
      alert('La tienda aún está cargando. Espera un momento e inténtalo de nuevo.');
      return Promise.resolve(0);
    }
    return Promise.resolve(api.addRenewalItems(items));
  }

  function rowFromButton(btn) {
    const aid = parseInt(btn.getAttribute('data-account-id'), 10);
    return lastRenewable.find(function (r) {
      return r.account_id === aid;
    });
  }

  async function buscar() {
    const raw = (input && input.value) || '';
    if (!raw.trim()) {
      lastRenewable = [];
      lastRejected = [];
      renderResults();
      setMsg('', false);
      return;
    }
    const api = getTiendaApi();
    const csrf = api && api.getCsrfToken ? api.getCsrfToken() : '';
    const seq = ++searchSeq;
    setMsg('Buscando…', false);
    if (btnBuscar) btnBuscar.disabled = true;

    try {
      const res = await fetch(buscarUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRFToken': csrf,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ cuentas: raw }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch (parseErr) {
        if (res.status === 405) {
          setMsg('El servidor no acepta la búsqueda. Reinicia la aplicación Flask e inténtalo de nuevo.', true);
          return;
        }
        setMsg('No se pudo leer la respuesta del servidor.', true);
        return;
      }
      if (seq !== searchSeq) return;

      if (!res.ok || !data.success) {
        setMsg((data && data.error) || 'No se pudo buscar.', true);
        lastRenewable = [];
        lastRejected = [];
        renderResults();
        return;
      }
      lastRenewable = data.renewable || [];
      lastRejected = data.rejected || [];
      renderResults();
      if (lastRenewable.length === 0 && lastRejected.length === 0) {
        setMsg('No se encontraron resultados.', true);
      } else {
        setMsg('', false);
      }
    } catch (e) {
      if (seq !== searchSeq) return;
      setMsg('Error de red al buscar.', true);
    } finally {
      if (btnBuscar && seq === searchSeq) btnBuscar.disabled = false;
    }
  }

  btnOpen.addEventListener('click', function () {
    openModal();
  });

  function onCloseClick(e) {
    e.preventDefault();
    e.stopPropagation();
    closeModal();
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', onCloseClick);
  }

  modal.addEventListener('click', function (e) {
    if (e.target.closest('#closeRenovacionModalBtn')) {
      onCloseClick(e);
      return;
    }
    if (e.target === modal) {
      closeModal();
    }
  });

  if (btnInfo && infoTip) {
    btnInfo.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleRenovacionInfoTip();
    });
  }

  document.addEventListener('click', function (e) {
    if (!infoTip || infoTip.classList.contains('hidden')) return;
    if (e.target.closest('.renovacion-title-info-wrap') || e.target.closest('#renovacionInfoTip')) {
      return;
    }
    closeRenovacionInfoTip();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !modal || modal.classList.contains('modal-hidden')) return;
    if (infoTip && !infoTip.classList.contains('hidden')) {
      closeRenovacionInfoTip();
      return;
    }
    closeModal();
  });

  if (searchForm) {
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      buscar();
    });
  }

  if (btnBuscar) {
    btnBuscar.addEventListener('click', buscar);
  }

  if (renewableList) {
    renewableList.addEventListener('click', function (e) {
      const btn = e.target.closest('.btn-renovacion-agregar-one');
      if (!btn) return;
      const row = rowFromButton(btn);
      if (!row) return;
      addItems([row]).then(function (n) {
        if (n > 0) {
          btn.disabled = true;
          btn.classList.add('renovacion-agregada');
          btn.setAttribute('aria-label', 'Agregada al carrito');
          btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
          setMsg('Cuenta agregada al resumen.', false);
        }
      });
    });
  }

  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        buscar();
      }
    });
  }
});
