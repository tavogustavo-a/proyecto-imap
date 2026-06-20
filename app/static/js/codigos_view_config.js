/**
 * Preferencias de vista para botones de servicios (plantilla Códigos).
 */
(function () {
  const STORAGE_PREFIX = 'codigosViewPrefs_';
  const VIEW_CARDS = 'cards';
  const VIEW_COMPACT = 'compact';
  const VIEW_GRID = 'grid';
  const VIEW_TABLE = 'table';
  const VIEW_ICONS = 'icons';

  const VIEW_CLASS_PREFIX = 'codigos-services-wrap--view-';

  function prefsStorageKey() {
    const el = document.getElementById('codigosViewPrefsScope');
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

  function normalizeView(view) {
    if (view === VIEW_COMPACT) return VIEW_COMPACT;
    if (view === VIEW_GRID) return VIEW_GRID;
    if (view === VIEW_TABLE) return VIEW_TABLE;
    if (view === VIEW_ICONS) return VIEW_ICONS;
    return VIEW_CARDS;
  }

  function wrapServiceButtonNames(wrap) {
    if (!wrap || wrap.dataset.codigosNamesWrapped === '1') return;

    wrap.querySelectorAll('.service-btn').forEach(function (btn) {
      if (btn.querySelector('.codigos-service-btn-name')) return;

      const textParts = [];
      const nodesToRemove = [];
      btn.childNodes.forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          textParts.push(node.textContent.trim());
          nodesToRemove.push(node);
        }
      });
      nodesToRemove.forEach(function (node) {
        node.remove();
      });
      if (!textParts.length) return;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'codigos-service-btn-name';
      nameSpan.textContent = textParts.join(' ');
      btn.setAttribute('title', nameSpan.textContent);

      const infoIcon = btn.querySelector('.info-icon');
      if (infoIcon) {
        btn.insertBefore(nameSpan, infoIcon);
      } else {
        btn.appendChild(nameSpan);
      }
    });

    wrap.dataset.codigosNamesWrapped = '1';
  }

  function removeTableHeader(wrap) {
    if (!wrap) return;
    const existing = wrap.querySelector('.codigos-services-table-header');
    if (existing) existing.remove();
  }

  function syncTableRowBorders(wrap, view) {
    if (!wrap) return;
    wrap.querySelectorAll('.codigos-table-row-last').forEach(function (el) {
      el.classList.remove('codigos-table-row-last');
    });
    if (view !== VIEW_TABLE) return;
    const host = wrap.querySelector('.codigos-services-layout-host');
    const scope = host || wrap;
    const containers = scope.querySelectorAll('.service-btn-container');
    if (containers.length) {
      containers[containers.length - 1].classList.add('codigos-table-row-last');
    }
  }

  function needsFlatLayout(view) {
    return view === VIEW_GRID || view === VIEW_TABLE || view === VIEW_ICONS;
  }

  function captureServicesLayoutBackup(wrap) {
    if (wrap._codigosLayoutBackup) return;
    const rows = [];
    wrap.querySelectorAll(':scope > .services-row').forEach(function (row) {
      rows.push({
        row: row,
        containers: Array.from(row.querySelectorAll(':scope > .service-btn-container'))
      });
    });
    wrap._codigosLayoutBackup = rows;
  }

  function flattenServicesLayout(wrap) {
    captureServicesLayoutBackup(wrap);
    let host = wrap.querySelector('.codigos-services-layout-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'codigos-services-layout-host';
      host.setAttribute('role', 'list');
      host.setAttribute('aria-label', 'Servicios disponibles');
      wrap.appendChild(host);
    }
    wrap._codigosLayoutBackup.forEach(function (entry) {
      entry.containers.forEach(function (container) {
        container.setAttribute('role', 'listitem');
        host.appendChild(container);
      });
      entry.row.hidden = true;
      entry.row.setAttribute('aria-hidden', 'true');
    });
  }

  function restoreServicesLayout(wrap) {
    wrap.querySelectorAll(':scope > .services-row').forEach(function (row) {
      row.hidden = false;
      row.removeAttribute('aria-hidden');
    });
    if (wrap._codigosLayoutBackup) {
      wrap._codigosLayoutBackup.forEach(function (entry) {
        entry.containers.forEach(function (container) {
          container.removeAttribute('role');
          entry.row.appendChild(container);
        });
      });
    }
    const host = wrap.querySelector('.codigos-services-layout-host');
    if (host) host.remove();
  }

  function syncServicesLayoutStructure(wrap, view) {
    if (needsFlatLayout(view)) {
      flattenServicesLayout(wrap);
    } else {
      restoreServicesLayout(wrap);
    }
  }

  window.codigosViewGetView = function () {
    return normalizeView(readPrefs().codigosView);
  };

  window.codigosViewApply = function () {
    const wrap = document.getElementById('codigosServicesWrap');
    if (!wrap) return;

    wrapServiceButtonNames(wrap);

    const view = window.codigosViewGetView();
    wrap.classList.remove(
      VIEW_CLASS_PREFIX + VIEW_CARDS,
      VIEW_CLASS_PREFIX + VIEW_COMPACT,
      VIEW_CLASS_PREFIX + VIEW_GRID,
      VIEW_CLASS_PREFIX + VIEW_TABLE,
      VIEW_CLASS_PREFIX + VIEW_ICONS
    );
    wrap.classList.add(VIEW_CLASS_PREFIX + view);
    syncServicesLayoutStructure(wrap, view);
    removeTableHeader(wrap);
    syncTableRowBorders(wrap, view);
  };

  function syncControlsFromPrefs() {
    const view = window.codigosViewGetView();
    document.querySelectorAll('input[name="codigosConfigView"]').forEach(function (radio) {
      radio.checked = radio.value === view;
    });
  }

  function bindCodigosViewModal() {
    const modal = document.getElementById('codigosViewModal');
    if (!modal) return;

    const closeBtn = document.getElementById('closeCodigosViewModalBtn');
    const openButtons = document.querySelectorAll('.btn-codigos-editar-vista');
    const viewRadios = document.querySelectorAll('input[name="codigosConfigView"]');

    function openModal() {
      syncControlsFromPrefs();
      modal.classList.remove('modal-hidden');
      document.body.classList.add('codigos-view-modal-open');
    }

    function closeModal() {
      modal.classList.add('modal-hidden');
      document.body.classList.remove('codigos-view-modal-open');
      modal.removeEventListener('mousedown', onOutsideClick);
    }

    function onOutsideClick(e) {
      if (e.target === modal) closeModal();
    }

    openButtons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
        window.setTimeout(function () {
          modal.addEventListener('mousedown', onOutsideClick);
        }, 0);
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('modal-hidden')) {
        closeModal();
      }
    });

    viewRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        const nextView = normalizeView(radio.value);
        writePrefs({ codigosView: nextView });
        window.codigosViewApply();
        syncControlsFromPrefs();
      });
    });
  }

  function enhanceAdminMenu2CodigosRow() {
    const menu2 = document.getElementById('mobileMenu2');
    if (!menu2 || !document.getElementById('codigosServicesWrap')) return;

    const links = menu2.querySelectorAll('a.mobile-menu-btn');
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (link.closest('.codigos-sidebar-codigos-row')) continue;
      const label = (link.textContent || '').replace(/\s+/g, ' ').trim();
      if (label.indexOf('Códigos') === -1) continue;

      const row = document.createElement('div');
      row.className = 'codigos-sidebar-codigos-row';
      link.parentNode.insertBefore(row, link);
      link.classList.remove('mb-04');
      row.appendChild(link);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-panel btn-blue mobile-menu-btn btn-codigos-editar-vista';
      btn.textContent = 'Editar vista';
      row.appendChild(btn);
      break;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    enhanceAdminMenu2CodigosRow();
    window.codigosViewApply();
    syncControlsFromPrefs();
    bindCodigosViewModal();
  });
})();
