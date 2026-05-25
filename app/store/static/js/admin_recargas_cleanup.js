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
  const scopeSelect = document.getElementById('brCleanupScope');
  const userWrap = document.getElementById('brCleanupUserWrap');
  const userIdInput = document.getElementById('brCleanupUserId');
  const userSearchInput = document.getElementById('brCleanupUserSearch');
  const userResultsEl = document.getElementById('brCleanupUserResults');
  const userSelectedWrap = document.getElementById('brCleanupUserSelected');
  const userSelectedLabel = document.getElementById('brCleanupUserSelectedLabel');
  const userClearBtn = document.getElementById('brCleanupUserClear');
  let userSearchDebounce = null;
  const previewCount = document.getElementById('brCleanupPreviewCount');
  const purgeBtn = document.getElementById('brCleanupPurgeBtn');
  const autoEnabled = document.getElementById('brCleanupAutoEnabled');
  const intervalSelect = document.getElementById('brCleanupIntervalHours');
  const saveAutoBtn = document.getElementById('brCleanupSaveAutoBtn');
  const statusEl = document.getElementById('brCleanupStatus');
  const infoBtn = document.getElementById('brCleanupInfoBtn');
  const infoBox = document.getElementById('brCleanupInfoBox');

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
      const res = await fetch(previewUrl + '?' + params.toString(), {
        credentials: 'same-origin',
      });
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
        credentials: 'same-origin',
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
    const countRes = await fetch(
      previewUrl +
        '?' +
        new URLSearchParams({
          retention_days: String(p.retention_days),
          scope: p.scope,
          ...(p.user_id ? { user_id: String(p.user_id) } : {}),
        }).toString(),
      { credentials: 'same-origin' }
    );
    const countData = await countRes.json();
    const n = countData.count || 0;
    if (n === 0) {
      showStatus('No hay solicitudes que coincidan con esos criterios.', true);
      return;
    }
    const scopeLabel =
      p.scope === 'user' ? 'del usuario seleccionado' : 'de todos los usuarios';
    if (
      !window.confirm(
        '¿Eliminar ' +
          n +
          ' solicitud(es) de recarga (más de ' +
          p.retention_days +
          ' días, ' +
          scopeLabel +
          ')?\n\nSe borrarán también los comprobantes. Esta acción no se puede deshacer.'
      )
    ) {
      return;
    }
    try {
      const res = await fetch(purgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
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
          window.location.reload();
        }, 4000);
      } else {
        if (previewCount) previewCount.textContent = '0';
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
