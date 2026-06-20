/**
 * Configuración tienda pública (preferencias locales por usuario).
 */
(function () {
  const STORAGE_PREFIX = 'storeFrontPrefs_';
  const VIEW_GRID = 'grid';
  const VIEW_LIST = 'list';
  const VIEW_COMPACT = 'compact';
  const VIEW_TABLE = 'table';
  const VIEW_TEXT = 'text';
  const VIEW_6 = 'view6';

  function prefsStorageKey() {
    const el = document.getElementById('storeFrontPrefsScope');
    const uid = el && el.getAttribute('data-user-id');
    return STORAGE_PREFIX + (uid ? String(uid) : 'anon');
  }

  function readPrefs() {
    try {
      const raw = localStorage.getItem(prefsStorageKey());
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writePrefs(partial) {
    const next = Object.assign({}, readPrefs(), partial || {});
    localStorage.setItem(prefsStorageKey(), JSON.stringify(next));
    return next;
  }

  function migrateLegacyPrefs() {
    const prefs = readPrefs();
    let changed = false;
    const patch = {};
    if (prefs.storeView === 'table') {
      patch.storeView = VIEW_TABLE;
      changed = true;
    }
    if (changed) {
      writePrefs(patch);
    }
  }

  function normalizeStoreView(view) {
    if (view === VIEW_LIST) return VIEW_LIST;
    if (view === VIEW_COMPACT) return VIEW_COMPACT;
    if (view === VIEW_TABLE) return VIEW_TABLE;
    if (view === VIEW_TEXT) return VIEW_TEXT;
    if (view === VIEW_6) return VIEW_6;
    return VIEW_GRID;
  }

  function applyProductFiltersDeferred() {
    window.requestAnimationFrame(function () {
      if (typeof window.storeFrontApplyProductFilters === 'function') {
        window.storeFrontApplyProductFilters();
      }
    });
  }

  window.storeFrontReadPrefs = readPrefs;
  window.storeFrontWritePrefs = writePrefs;
  window.storeFrontGetHideZeroStock = function () {
    return !!readPrefs().hideZeroStock;
  };
  window.storeFrontGetShowPriceTable = function () {
    return !!readPrefs().showPriceTable;
  };
  window.storeFrontGetPriceTableCollapsed = function () {
    return !!readPrefs().priceTableCollapsed;
  };
  window.storeFrontGetStoreView = function () {
    return normalizeStoreView(readPrefs().storeView);
  };

  window.storeFrontApplyStoreView = function () {
    const wrap = document.getElementById('storeProductsWrap');
    if (!wrap) return;
    const view = window.storeFrontGetStoreView();
    wrap.classList.remove(
      'store-products-wrap--view-grid',
      'store-products-wrap--view-list',
      'store-products-wrap--view-compact',
      'store-products-wrap--view-table',
      'store-products-wrap--view-text',
      'store-products-wrap--view-view6'
    );
    wrap.classList.add('store-products-wrap--view-' + view);

    const hdr = document.getElementById('storeCatalogTableHeader');
    if (hdr) {
      const isListColumns = view === VIEW_TABLE;
      if (!isListColumns) {
        hdr.hidden = true;
        hdr.setAttribute('aria-hidden', 'true');
      }
    }

    const fullTableWrap = document.getElementById('storeCatalogFullTableWrap');
    if (fullTableWrap) {
      const isView6 = view === VIEW_6;
      fullTableWrap.hidden = !isView6;
      fullTableWrap.setAttribute('aria-hidden', isView6 ? 'false' : 'true');
    }

    document.body.classList.toggle('store-front-active-view-table', view === VIEW_TABLE);
    document.body.classList.toggle('store-front-active-view-text', view === VIEW_TEXT);
    document.body.classList.toggle('store-front-active-view-view6', view === VIEW_6);

    if (typeof window.storeFrontApplyPriceTablePanel === 'function') {
      window.storeFrontApplyPriceTablePanel();
    }

    applyProductFiltersDeferred();
  };

  window.storeFrontApplyPriceTablePanel = function () {
    const panel = document.getElementById('storePriceTablePanel');
    if (!panel) return;
    const show =
      typeof window.storeFrontGetShowPriceTable === 'function' &&
      window.storeFrontGetShowPriceTable();
    const collapsed =
      typeof window.storeFrontGetPriceTableCollapsed === 'function' &&
      window.storeFrontGetPriceTableCollapsed();
    panel.classList.toggle('is-visible', show);
    panel.hidden = !show;
    panel.setAttribute('aria-hidden', show ? 'false' : 'true');
    panel.classList.toggle('is-collapsed', show && collapsed);
    const body = document.getElementById('storePriceTableBody');
    const toggleBtn = document.getElementById('storePriceTableToggleBtn');
    if (body) {
      body.hidden = show && collapsed;
    }
    if (toggleBtn) {
      const expanded = show && !collapsed;
      toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggleBtn.title = expanded ? 'Contraer tabla' : 'Expandir tabla';
      toggleBtn.setAttribute(
        'aria-label',
        expanded ? 'Contraer tabla de precios' : 'Expandir tabla de precios'
      );
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.className = expanded ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
      }
    }
  };

  function bindPriceTableCollapseToggle() {
    const toggleBtn = document.getElementById('storePriceTableToggleBtn');
    if (!toggleBtn || toggleBtn.dataset.storePriceTableToggleBound === '1') return;
    toggleBtn.dataset.storePriceTableToggleBound = '1';
    toggleBtn.addEventListener('click', function () {
      const collapsed = !window.storeFrontGetPriceTableCollapsed();
      writePrefs({ priceTableCollapsed: collapsed });
      window.storeFrontApplyPriceTablePanel();
    });
  }

  function syncConfigControlsFromPrefs() {
    const hideZeroCheckbox = document.getElementById('storeConfigHideZeroStock');
    const showPriceTableCheckbox = document.getElementById('storeConfigShowPriceTable');
    const view = window.storeFrontGetStoreView();

    if (hideZeroCheckbox) {
      hideZeroCheckbox.checked = window.storeFrontGetHideZeroStock();
    }
    if (showPriceTableCheckbox) {
      showPriceTableCheckbox.disabled = false;
      showPriceTableCheckbox.checked = window.storeFrontGetShowPriceTable();
    }

    document.querySelectorAll('input[name="storeConfigView"]').forEach(function (radio) {
      radio.checked = radio.value === view;
    });
  }

  function bindStoreConfigModal() {
    const btnOpen = document.getElementById('btnStoreConfiguracion');
    const modal = document.getElementById('storeConfigModal');
    if (!btnOpen || !modal) return;

    const closeBtn = document.getElementById('closeStoreConfigModalBtn');
    const hideZeroCheckbox = document.getElementById('storeConfigHideZeroStock');
    const showPriceTableCheckbox = document.getElementById('storeConfigShowPriceTable');
    const viewRadios = document.querySelectorAll('input[name="storeConfigView"]');

    function openModal() {
      syncConfigControlsFromPrefs();
      modal.classList.remove('modal-hidden');
      document.body.classList.add('store-config-modal-open');
    }

    function closeModal() {
      modal.classList.add('modal-hidden');
      document.body.classList.remove('store-config-modal-open');
    }

    function onOutsideClick(e) {
      if (e.target === modal) closeModal();
    }

    btnOpen.addEventListener('click', function () {
      openModal();
      window.setTimeout(function () {
        modal.addEventListener('mousedown', onOutsideClick);
      }, 0);
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        modal.removeEventListener('mousedown', onOutsideClick);
        closeModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('modal-hidden')) {
        modal.removeEventListener('mousedown', onOutsideClick);
        closeModal();
      }
    });

    document.querySelectorAll('#storeConfigModal button[data-desc]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const desc = btn.getAttribute('data-desc') || '';
        const descModal = document.getElementById('descModal');
        const descModalText = document.getElementById('descModalText');
        if (!descModal || !descModalText || !desc) return;
        descModalText.textContent = desc;
        descModal.classList.remove('modal-hidden');
      });
    });

    if (hideZeroCheckbox) {
      hideZeroCheckbox.addEventListener('change', function () {
        writePrefs({ hideZeroStock: hideZeroCheckbox.checked });
        applyProductFiltersDeferred();
      });
    }

    if (showPriceTableCheckbox) {
      showPriceTableCheckbox.addEventListener('change', function () {
        writePrefs({ showPriceTable: showPriceTableCheckbox.checked });
        window.storeFrontApplyPriceTablePanel();
        applyProductFiltersDeferred();
      });
    }

    viewRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked || radio.disabled) return;
        const nextView = normalizeStoreView(radio.value);
        writePrefs({ storeView: nextView });
        window.storeFrontApplyStoreView();
        syncConfigControlsFromPrefs();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    migrateLegacyPrefs();
    window.storeFrontApplyStoreView();
    window.storeFrontApplyPriceTablePanel();
    bindPriceTableCollapseToggle();
    syncConfigControlsFromPrefs();
    bindStoreConfigModal();
    applyProductFiltersDeferred();
  });
})();
