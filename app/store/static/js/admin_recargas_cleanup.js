/**
 * Limpieza manual y programada del historial de recargas/consignaciones (admin).
 */
document.addEventListener('DOMContentLoaded', function () {
  const panel = document.getElementById('brCleanupPanel');
  if (!panel) return;

  const settingsUrl = panel.dataset.settingsUrl;
  const purgeUrl = panel.dataset.purgeUrl;
  const previewUrl = panel.dataset.previewUrl;
  const searchUsersUrl = panel.dataset.searchUsersUrl || '/admin/search_users_ajax';

  const daysInput = document.getElementById('brCleanupDays');
  const categorySelect = document.getElementById('brCleanupCategory');
  const scopeSelect = document.getElementById('brCleanupScope');
  const userWrap = document.getElementById('brCleanupUserWrap');
  const userIdInput = document.getElementById('brCleanupUserId');
  const userSearchInput = document.getElementById('brCleanupUserSearch');
  const userResultsEl = document.getElementById('brCleanupUserResults');
  const userSelectedWrap = document.getElementById('brCleanupUserSelected');
  const userSelectedLabel = document.getElementById('brCleanupUserSelectedLabel');
  const userClearBtn = document.getElementById('brCleanupUserClear');
  let userSearchDebounce = null;
  const purgeBtn = document.getElementById('brCleanupPurgeBtn');
  const autoEnabled = document.getElementById('brCleanupAutoEnabled');
  const intervalSelect = document.getElementById('brCleanupIntervalHours');
  const saveAutoBtn = document.getElementById('brCleanupSaveAutoBtn');
  const statusEl = document.getElementById('brCleanupStatus');
  const infoBtn = document.getElementById('brCleanupInfoBtn');
  const infoBox = document.getElementById('brCleanupInfoBox');

  function cleanupFetchJson(url, options) {
    if (window.StoreFetchJson && window.StoreFetchJson.fetch) {
      return window.StoreFetchJson.fetch(url, options);
    }
    options = options || {};
    return fetch(url, {
      method: options.method || 'GET',
      credentials: options.credentials != null ? options.credentials : 'same-origin',
      headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
      body: options.body,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          const err = new Error((data && (data.error || data.message)) || 'Error HTTP ' + res.status);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function showStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'mt-05 ' + (isError ? 'text-danger' : 'text-success');
  }

  function payloadFromForm() {
    const scope = scopeSelect ? scopeSelect.value : 'all';
    const purgeCategory = categorySelect ? categorySelect.value : 'all';
    const body = {
      retention_days: parseInt(daysInput?.value || '90', 10),
      scope: scope,
      purge_category: purgeCategory,
    };
    if (scope === 'user' && userIdInput?.value) {
      body.user_id = parseInt(userIdInput.value, 10);
    }
    return body;
  }

  function clearSelectedUser() {
    if (userIdInput) userIdInput.value = '';
    if (userSearchInput) userSearchInput.value = '';
    if (userSelectedWrap) userSelectedWrap.hidden = true;
    if (userSelectedLabel) userSelectedLabel.textContent = '';
    hideUserResults();
  }

  function setSelectedUser(user) {
    if (!user || user.id == null) return;
    if (userIdInput) userIdInput.value = String(user.id);
    if (userSelectedLabel) userSelectedLabel.textContent = user.username || '';
    if (userSelectedWrap) userSelectedWrap.hidden = false;
    if (userSearchInput) userSearchInput.value = '';
    hideUserResults();
    refreshPreview();
  }

  function hideUserResults() {
    if (!userResultsEl) return;
    userResultsEl.hidden = true;
    userResultsEl.innerHTML = '';
  }

  function renderUserResults(users) {
    if (!userResultsEl) return;
    userResultsEl.innerHTML = '';
    if (!users || !users.length) {
      const empty = document.createElement('p');
      empty.className = 'purchase-history-cleanup-user-empty';
      empty.textContent = 'Sin coincidencias.';
      userResultsEl.appendChild(empty);
      userResultsEl.hidden = false;
      return;
    }
    users.forEach(function (u) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'purchase-history-cleanup-user-row';
      btn.dataset.userId = String(u.id);
      btn.dataset.username = u.username || '';
      btn.textContent = u.username || '—';
      btn.addEventListener('click', function () {
        setSelectedUser({ id: u.id, username: u.username });
      });
      userResultsEl.appendChild(btn);
    });
    userResultsEl.hidden = false;
  }

  async function searchUsers(query) {
    const q = (query || '').trim();
    if (q.length < 1) {
      hideUserResults();
      return;
    }
    try {
      const data = await cleanupFetchJson(
        searchUsersUrl + '?query=' + encodeURIComponent(q)
      );
      if (data.status === 'ok' && Array.isArray(data.users)) {
        renderUserResults(data.users);
      } else {
        hideUserResults();
      }
    } catch (_e) {
      hideUserResults();
    }
  }

  function toggleUserWrap() {
    if (!userWrap || !scopeSelect) return;
    const showUser = scopeSelect.value === 'user';
    userWrap.hidden = !showUser;
    if (!showUser) {
      clearSelectedUser();
      hideUserResults();
    }
  }

  function syncAutoIntervalControls() {
    const enabled = !!(autoEnabled && autoEnabled.checked);
    if (intervalSelect) {
      intervalSelect.disabled = !enabled;
    }
  }

  function updateOptionPreviewCounts(selectEl, count, ariaBase) {
    if (!selectEl) return;
    const display =
      count === null || count === undefined || Number.isNaN(count) ? '—' : String(count);
    Array.from(selectEl.options).forEach(function (opt) {
      const base = opt.dataset.label || opt.textContent.replace(/\s*\([^)]*\)\s*$/, '').trim();
      opt.textContent = base + ' (' + display + ')';
    });
    if (ariaBase) {
      selectEl.setAttribute('aria-label', ariaBase + ', ' + display + ' solicitud(es)');
    }
  }

  function updateScopePreviewCount(count) {
    updateOptionPreviewCounts(categorySelect, count, 'Sección a limpiar');
    updateOptionPreviewCounts(scopeSelect, count, 'Usuarios afectados');
  }

  async function refreshPreview() {
    const p = payloadFromForm();
    const params = new URLSearchParams({
      retention_days: String(p.retention_days),
      scope: p.scope,
      purge_category: p.purge_category || 'all',
    });
    if (p.user_id) params.set('user_id', String(p.user_id));
    try {
      const data = await cleanupFetchJson(previewUrl + '?' + params.toString());
      if (data.success) {
        updateScopePreviewCount(data.count);
      } else {
        updateScopePreviewCount(null);
      }
    } catch (_e) {
      updateScopePreviewCount(null);
    }
  }

  async function saveAutoSettings() {
    const p = payloadFromForm();
    p.auto_enabled = !!(autoEnabled && autoEnabled.checked);
    p.run_interval_hours = parseInt(intervalSelect?.value || '24', 10);
    try {
      const data = await cleanupFetchJson(settingsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      if (!data.success) {
        showStatus(data.error || 'Error al guardar.', true);
        return;
      }
      if (typeof data.preview_count === 'number') {
        updateScopePreviewCount(data.preview_count);
      }
      showStatus(data.message || 'Guardado.', false);
    } catch (_e) {
      showStatus('Error de red al guardar.', true);
    }
  }

  async function purgeNow() {
    const p = payloadFromForm();
    if (p.scope === 'user' && !p.user_id) {
      showStatus('Selecciona un usuario.', true);
      return;
    }
    const countData = await cleanupFetchJson(
      previewUrl +
        '?' +
        new URLSearchParams({
          retention_days: String(p.retention_days),
          scope: p.scope,
          purge_category: p.purge_category || 'all',
          ...(p.user_id ? { user_id: String(p.user_id) } : {}),
        }).toString()
    );
    const n = countData.count || 0;
    if (n === 0) {
      showStatus('No hay solicitudes que coincidan con esos criterios.', true);
      return;
    }
    const scopeLabel =
      p.scope === 'user' ? 'del usuario seleccionado' : 'de todos los usuarios';
    const daysLabel =
      p.retention_days === 0
        ? 'todas las solicitudes (sin filtro de fecha)'
        : 'más de ' + p.retention_days + ' días, ' + scopeLabel;
    if (
      !window.confirm(
        '¿Eliminar ' +
          n +
          ' solicitud(es) de recarga (' +
          daysLabel +
          ')?\n\nSe borrarán también los comprobantes. Esta acción no se puede deshacer.'
      )
    ) {
      return;
    }
    try {
      const data = await cleanupFetchJson(purgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, confirm: true }),
      });
      if (!data.success) {
        showStatus(data.error || 'No se pudo eliminar.', true);
        return;
      }
      showStatus(data.message || 'Limpieza en segundo plano.', false);
      if (purgeBtn) purgeBtn.disabled = true;
      if (data.background) {
        window.setTimeout(function () {
          window.location.reload();
        }, 4000);
      } else {
        updateScopePreviewCount(0);
        window.location.reload();
      }
    } catch (_e) {
      showStatus('Error de red al eliminar.', true);
    }
  }

  function closeInfoBox() {
    if (!infoBox || !infoBtn) return;
    infoBox.hidden = true;
    infoBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleInfoBox() {
    if (!infoBox || !infoBtn) return;
    const open = infoBox.hidden;
    infoBox.hidden = !open;
    infoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  infoBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleInfoBox();
  });

  document.addEventListener('click', function (e) {
    if (!infoBox || infoBox.hidden) return;
    if (infoBtn?.contains(e.target) || infoBox.contains(e.target)) return;
    closeInfoBox();
  });

  categorySelect?.addEventListener('change', refreshPreview);
  scopeSelect?.addEventListener('change', function () {
    toggleUserWrap();
    refreshPreview();
  });
  userSearchInput?.addEventListener('input', function () {
    clearTimeout(userSearchDebounce);
    userSearchDebounce = setTimeout(function () {
      searchUsers(userSearchInput.value);
    }, 280);
  });
  userClearBtn?.addEventListener('click', function () {
    clearSelectedUser();
    refreshPreview();
  });
  daysInput?.addEventListener('change', refreshPreview);
  purgeBtn?.addEventListener('click', purgeNow);
  saveAutoBtn?.addEventListener('click', saveAutoSettings);
  autoEnabled?.addEventListener('change', syncAutoIntervalControls);

  toggleUserWrap();
  syncAutoIntervalControls();
  refreshPreview();
});
