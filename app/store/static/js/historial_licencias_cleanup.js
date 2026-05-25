/**
 * Limpieza manual y programada del historial · Licencias (solo admin).
 */
document.addEventListener('DOMContentLoaded', function () {
  const panel = document.getElementById('purchaseHistoryLicenciasCleanupPanel');
  if (!panel) return;

  const settingsUrl = panel.dataset.settingsUrl;
  const purgeUrl = panel.dataset.purgeUrl;
  const previewUrl = panel.dataset.previewUrl;
  const searchUsersUrl = panel.dataset.searchUsersUrl || '/admin/search_users_ajax';

  const daysInput = document.getElementById('phLicCleanupDays');
  const scopeSelect = document.getElementById('phLicCleanupScope');
  const userWrap = document.getElementById('phLicCleanupUserWrap');
  const userIdInput = document.getElementById('phLicCleanupUserId');
  const userSearchInput = document.getElementById('phLicCleanupUserSearch');
  const userResultsEl = document.getElementById('phLicCleanupUserResults');
  const userSelectedWrap = document.getElementById('phLicCleanupUserSelected');
  const userSelectedLabel = document.getElementById('phLicCleanupUserSelectedLabel');
  const userClearBtn = document.getElementById('phLicCleanupUserClear');
  let userSearchDebounce = null;
  const USER_SEARCH_MIN_CHARS = 1;
  const USER_SEARCH_MAX_RESULTS = 40;
  const previewCount = document.getElementById('phLicCleanupPreviewCount');
  const purgeBtn = document.getElementById('phLicCleanupPurgeBtn');
  const autoEnabled = document.getElementById('phLicCleanupAutoEnabled');
  const intervalSelect = document.getElementById('phLicCleanupIntervalHours');
  const saveAutoBtn = document.getElementById('phLicCleanupSaveAutoBtn');
  const statusEl = document.getElementById('phLicCleanupStatus');
  const infoBtn = document.getElementById('phLicCleanupInfoBtn');
  const infoBox = document.getElementById('phLicCleanupInfoBox');

  function showStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'mt-05 ' + (isError ? 'text-danger' : 'text-success');
  }

  function payloadFromForm() {
    const scope = scopeSelect ? scopeSelect.value : 'all';
    const body = {
      retention_days: parseInt(daysInput?.value || '90', 10),
      scope: scope,
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
    const label = user.username || '';
    if (userSelectedLabel) userSelectedLabel.textContent = label;
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

  function showUserResults() {
    if (userResultsEl) userResultsEl.hidden = false;
  }

  function renderUserResults(users) {
    if (!userResultsEl) return;
    userResultsEl.innerHTML = '';
    if (!users || !users.length) {
      const empty = document.createElement('p');
      empty.className = 'purchase-history-cleanup-user-empty';
      empty.textContent = 'Sin coincidencias.';
      userResultsEl.appendChild(empty);
      showUserResults();
      return;
    }
    users.slice(0, USER_SEARCH_MAX_RESULTS).forEach(function (u) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'purchase-history-cleanup-user-row';
      btn.setAttribute('role', 'option');
      btn.dataset.userId = String(u.id);
      btn.dataset.username = u.username || '';
      const main = document.createElement('span');
      main.className = 'purchase-history-cleanup-user-row-main';
      main.textContent = u.username || '—';
      btn.appendChild(main);
      if (u.full_name && String(u.full_name).trim()) {
        const sub = document.createElement('span');
        sub.className = 'purchase-history-cleanup-user-row-sub';
        sub.textContent = String(u.full_name).trim();
        btn.appendChild(sub);
      }
      userResultsEl.appendChild(btn);
    });
    showUserResults();
  }

  async function searchUsers(query) {
    const q = (query || '').trim();
    if (q.length < USER_SEARCH_MIN_CHARS) {
      hideUserResults();
      return;
    }
    try {
      const res = await fetch(
        searchUsersUrl + '?query=' + encodeURIComponent(q),
        { credentials: 'same-origin' }
      );
      const data = await res.json();
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
      intervalSelect.title = enabled ? 'Ejecutar cada' : 'Marca el checkbox para elegir el intervalo';
    }
  }

  async function refreshPreview() {
    const p = payloadFromForm();
    const params = new URLSearchParams({
      retention_days: String(p.retention_days),
      scope: p.scope,
    });
    if (p.user_id) params.set('user_id', String(p.user_id));
    try {
      const res = await fetch(previewUrl + '?' + params.toString());
      const data = await res.json();
      if (data.success && previewCount) {
        previewCount.textContent = String(data.count);
      } else if (previewCount) {
        previewCount.textContent = '—';
      }
    } catch (_e) {
      if (previewCount) previewCount.textContent = '—';
    }
  }

  async function saveAutoSettings() {
    const p = payloadFromForm();
    p.auto_enabled = !!(autoEnabled && autoEnabled.checked);
    p.run_interval_hours = parseInt(intervalSelect?.value || '24', 10);
    try {
      const res = await fetch(settingsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      const data = await res.json();
      if (!data.success) {
        showStatus(data.error || 'Error al guardar.', true);
        return;
      }
      if (previewCount && typeof data.preview_count === 'number') {
        previewCount.textContent = String(data.preview_count);
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

    const countRes = await fetch(previewUrl + '?' + new URLSearchParams({
      retention_days: String(p.retention_days),
      scope: p.scope,
      ...(p.user_id ? { user_id: String(p.user_id) } : {}),
    }).toString());
    const countData = await countRes.json();
    const n = countData.count || 0;
    if (n === 0) {
      showStatus('No hay registros que coincidan con esos criterios.', true);
      return;
    }

    const scopeLabel =
      p.scope === 'user'
        ? 'del usuario seleccionado'
        : 'de todos los usuarios';
    const ok = window.confirm(
      '¿Eliminar ' +
        n +
        ' registro(s) del historial · Licencias (más de ' +
        p.retention_days +
        ' días, ' +
        scopeLabel +
        ')?\n\nSolo se borran entradas del registro portal. Las licencias en inventario no se eliminan.\n\nEsta acción no se puede deshacer.'
    );
    if (!ok) return;

    try {
      const res = await fetch(purgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, confirm: true }),
      });
      const data = await res.json();
      if (!data.success) {
        showStatus(data.error || 'No se pudo eliminar.', true);
        return;
      }
      showStatus(data.message || 'Limpieza en segundo plano.', false);
      if (purgeBtn) purgeBtn.disabled = true;
      if (data.background) {
        window.setTimeout(function () {
          const base = window.location.pathname + window.location.search;
          window.location.href = base + '#purchaseHistoryLicenciasSection';
          window.location.reload();
        }, 4000);
      } else {
        previewCount.textContent = '0';
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

  scopeSelect?.addEventListener('change', function () {
    toggleUserWrap();
    refreshPreview();
  });

  userSearchInput?.addEventListener('input', function () {
    if (userIdInput?.value) {
      userIdInput.value = '';
      if (userSelectedWrap) userSelectedWrap.hidden = true;
      if (userSelectedLabel) userSelectedLabel.textContent = '';
    }
    clearTimeout(userSearchDebounce);
    const q = userSearchInput.value;
    userSearchDebounce = setTimeout(function () {
      searchUsers(q);
    }, 280);
  });

  userSearchInput?.addEventListener('focus', function () {
    const q = (userSearchInput.value || '').trim();
    if (q.length >= USER_SEARCH_MIN_CHARS) searchUsers(q);
  });

  userResultsEl?.addEventListener('click', function (e) {
    const row = e.target.closest('.purchase-history-cleanup-user-row');
    if (!row) return;
    setSelectedUser({
      id: parseInt(row.dataset.userId, 10),
      username: row.dataset.username || '',
    });
  });

  userClearBtn?.addEventListener('click', function () {
    clearSelectedUser();
    refreshPreview();
  });

  document.addEventListener('click', function (e) {
    if (!userWrap || userWrap.hidden) return;
    if (userWrap.contains(e.target)) return;
    hideUserResults();
  });

  daysInput?.addEventListener('change', refreshPreview);
  purgeBtn?.addEventListener('click', purgeNow);
  saveAutoBtn?.addEventListener('click', saveAutoSettings);
  autoEnabled?.addEventListener('change', syncAutoIntervalControls);

  toggleUserWrap();
  syncAutoIntervalControls();
  refreshPreview();
});
