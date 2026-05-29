(function () {
  'use strict';

  var root = document.querySelector('.admin-recargas-page');
  if (!root) return;

  var settingsUrl = root.dataset.emailReviewUrl || '';
  var buzonUrl = root.dataset.emailReviewBuzonUrl || '';
  var regexCreateUrl = root.dataset.emailReviewRegexUrl || '';
  if (!settingsUrl) return;

  var msgEl = document.getElementById('adminRecargasEmailReviewMsg');
  var buzonCheck = document.getElementById('adminRecargasBuzonEnabled');
  var regexBtn = document.getElementById('adminRecargasEmailRegexBtn');
  var imapBtn = document.getElementById('adminRecargasEmailImapBtn');

  var regexModal = document.getElementById('adminRecargasEmailRegexModal');
  var regexEditModal = document.getElementById('adminRecargasEmailRegexEditModal');
  var imapModal = document.getElementById('adminRecargasEmailImapModal');
  var regexListEl = document.getElementById('adminRecargasEmailRegexList');
  var imapBody = document.getElementById('adminRecargasEmailImapTableBody');
  var imapFilter = document.getElementById('adminRecargasEmailImapFilter');
  var imapSaveBtn = document.getElementById('adminRecargasEmailImapSave');
  var regexModalMsg = document.getElementById('adminRecargasEmailRegexModalMsg');
  var regexEditMsg = document.getElementById('adminRecargasEmailRegexEditMsg');

  var newRegexDesc = document.getElementById('adminRecargasNewRegexDesc');
  var newRegexSender = document.getElementById('adminRecargasNewRegexSender');
  var newRegexPattern = document.getElementById('adminRecargasNewRegexPattern');
  var createRegexBtn = document.getElementById('adminRecargasCreateRegexBtn');
  var editRegexForm = document.getElementById('adminRecargasEditRegexForm');
  var editRegexId = document.getElementById('adminRecargasEditRegexId');
  var editRegexDesc = document.getElementById('adminRecargasEditRegexDesc');
  var editRegexSender = document.getElementById('adminRecargasEditRegexSender');
  var editRegexPattern = document.getElementById('adminRecargasEditRegexPattern');

  var state = {
    regexEntries: [],
    imapOptions: [],
    imapIds: [],
    loaded: false,
    buzonBusy: false,
  };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function regexItemUrl(id) {
    return regexCreateUrl.replace(/\/$/, '') + '/' + id;
  }

  function showInlineMsg(el, text, isError) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className =
      'admin-recarga-email-regex-modal-msg mb-0 ' + (isError ? 'text-danger' : 'text-success');
  }

  function showMsg(text, isError) {
    if (!msgEl) return;
    if (!text) {
      msgEl.hidden = true;
      msgEl.textContent = '';
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = text;
    msgEl.className =
      'admin-recargas-email-review-msg mb-0 ' + (isError ? 'text-danger' : 'text-success');
  }

  function isAnyEmailModalOpen() {
    return !!document.querySelector(
      '.admin-recarga-email-modal:not(.d-none):not([hidden])'
    );
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    modal.classList.remove('d-none');
    document.body.classList.add('admin-recarga-email-modal-open');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('d-none');
    if (!isAnyEmailModalOpen()) {
      document.body.classList.remove('admin-recarga-email-modal-open');
    }
  }

  function closeAllModals() {
    closeModal(regexEditModal);
    closeModal(regexModal);
    closeModal(imapModal);
  }

  function renderRegexList() {
    if (!regexListEl) return;
    var rows = state.regexEntries || [];
    if (!rows.length) {
      regexListEl.innerHTML =
        '<p class="admin-pm-users-empty">No hay regex. Crea uno nuevo arriba.</p>';
      return;
    }
    regexListEl.innerHTML = rows
      .map(function (r) {
        var senderLine = r.sender
          ? '<br><small class="text-muted">Remitente: <code>' +
            escapeHtml(r.sender) +
            '</code></small>'
          : '';
        var pmLine =
          r.payment_method_ids && r.payment_method_ids.length
            ? '<br><small class="text-muted">Medio: <code>' +
              escapeHtml(r.payment_method_ids.join(', ')) +
              '</code></small>'
            : '';
        return (
          '<div class="admin-recarga-email-regex-item">' +
          '<div class="admin-recarga-email-regex-item__body">' +
          '<strong>' +
          escapeHtml(r.description || 'Sin descripción') +
          '</strong>' +
          senderLine +
          pmLine +
          '<br><small class="admin-recarga-email-regex-item__pattern"><code>' +
          escapeHtml(r.pattern || '') +
          '</code></small>' +
          '</div>' +
          '<div class="admin-recarga-email-regex-item__actions">' +
          '<button type="button" class="btn-panel btn-orange btn-sm admin-recarga-email-regex-edit" data-regex-id="' +
          r.id +
          '" title="Editar"><i class="fas fa-edit" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn-panel btn-red btn-sm admin-recarga-email-regex-delete" data-regex-id="' +
          r.id +
          '" title="Eliminar"><i class="fas fa-trash" aria-hidden="true"></i></button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    regexListEl.querySelectorAll('.admin-recarga-email-regex-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-regex-id'), 10);
        var entry = state.regexEntries.find(function (r) {
          return r.id === id;
        });
        if (entry) openEditRegexModal(entry);
      });
    });

    regexListEl.querySelectorAll('.admin-recarga-email-regex-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-regex-id'), 10);
        var entry = state.regexEntries.find(function (r) {
          return r.id === id;
        });
        var label = entry ? entry.description || entry.pattern : 'este regex';
        if (window.confirm('¿Eliminar "' + label + '"?')) {
          deleteRegexEntry(id);
        }
      });
    });
  }

  function openEditRegexModal(entry) {
    if (!regexEditModal || !editRegexId) return;
    editRegexId.value = entry.id;
    if (editRegexDesc) editRegexDesc.value = entry.description || '';
    if (editRegexSender) editRegexSender.value = entry.sender || '';
    if (editRegexPattern) editRegexPattern.value = entry.pattern || '';
    showInlineMsg(regexEditMsg, '', false);
    openModal(regexEditModal);
  }

  function selectedImapIds() {
    if (!imapBody) return [];
    var ids = [];
    imapBody.querySelectorAll('input[type="checkbox"][data-imap-id]:checked').forEach(function (cb) {
      ids.push(parseInt(cb.getAttribute('data-imap-id'), 10));
    });
    return ids.filter(function (n) {
      return !isNaN(n) && n > 0;
    });
  }

  function renderImapTable() {
    if (!imapBody) return;
    var q = (imapFilter && imapFilter.value ? imapFilter.value : '').trim().toLowerCase();
    var rows = state.imapOptions.filter(function (s) {
      if (!q) return true;
      var hay = [s.host, s.username, s.description, s.folders].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    if (!rows.length) {
      imapBody.innerHTML =
        '<tr><td colspan="4" class="admin-pm-users-empty">No hay servidores IMAP.</td></tr>';
      return;
    }
    imapBody.innerHTML = rows
      .map(function (s) {
        var checked = state.imapIds.indexOf(s.id) !== -1 ? ' checked' : '';
        var off = s.enabled ? '' : ' admin-recarga-email-row--off';
        return (
          '<tr class="admin-recarga-email-row' +
          off +
          '">' +
          '<td class="admin-pm-users-table-col-check">' +
          '<input type="checkbox" data-imap-id="' +
          s.id +
          '"' +
          checked +
          ' aria-label="Usar IMAP ' +
          escapeHtml(s.username) +
          '">' +
          '</td>' +
          '<td><code>' +
          escapeHtml(s.host || '—') +
          '</code></td>' +
          '<td>' +
          escapeHtml(s.username || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(s.folders || 'INBOX') +
          (s.enabled ? '' : ' <span class="text-muted">(off)</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function loadSettings() {
    return fetch(settingsUrl, { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'Error al cargar');
        state.regexEntries = data.regex_entries || (data.settings && data.settings.regex_entries) || [];
        state.imapOptions = data.imap_options || [];
        state.imapIds = (data.settings && data.settings.imap_server_ids) || [];
        state.loaded = true;
        if (buzonCheck) {
          buzonCheck.checked = !!data.buzon_enabled;
        }
        renderRegexList();
        renderImapTable();
      });
  }

  function saveSettings(partial) {
    var body = partial || {};
    return fetch(settingsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo guardar');
        if (data.settings) {
          state.imapIds = data.settings.imap_server_ids || state.imapIds;
        }
        return data;
      });
  }

  function createRegexEntry() {
    if (!regexCreateUrl || !newRegexDesc || !newRegexPattern) return;
    var description = newRegexDesc.value.trim();
    var sender = newRegexSender ? newRegexSender.value.trim() : '';
    var pattern = newRegexPattern.value.trim();
    if (!description || !pattern) {
      showInlineMsg(regexModalMsg, 'Descripción y patrón son obligatorios.', true);
      return;
    }
    createRegexBtn.disabled = true;
    fetch(regexCreateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ description: description, sender: sender, pattern: pattern }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo crear');
        state.regexEntries = data.regex_entries || state.regexEntries;
        renderRegexList();
        newRegexDesc.value = '';
        if (newRegexSender) newRegexSender.value = '';
        newRegexPattern.value = '';
        showInlineMsg(regexModalMsg, data.message || 'Regex creado.', false);
      })
      .catch(function (err) {
        showInlineMsg(regexModalMsg, err.message || 'Error al crear regex.', true);
      })
      .finally(function () {
        createRegexBtn.disabled = false;
      });
  }

  function updateRegexEntry(entryId, payload) {
    return fetch(regexItemUrl(entryId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo actualizar');
        state.regexEntries = data.regex_entries || state.regexEntries;
        renderRegexList();
        return data;
      });
  }

  function deleteRegexEntry(entryId) {
    fetch(regexItemUrl(entryId), {
      method: 'DELETE',
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo eliminar');
        state.regexEntries = data.regex_entries || [];
        renderRegexList();
        showInlineMsg(regexModalMsg, data.message || 'Regex eliminado.', false);
      })
      .catch(function (err) {
        showInlineMsg(regexModalMsg, err.message || 'Error al eliminar regex.', true);
      });
  }

  function saveBuzon(enabled) {
    if (!buzonUrl || state.buzonBusy) return Promise.resolve();
    state.buzonBusy = true;
    return fetch(buzonUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: !!enabled }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo cambiar el buzón');
        if (buzonCheck) buzonCheck.checked = !!data.buzon_enabled;
        showMsg(data.message || 'Buzón actualizado.', false);
        return data;
      })
      .catch(function (err) {
        if (buzonCheck) buzonCheck.checked = !enabled;
        showMsg(err.message || 'Error al cambiar buzón.', true);
      })
      .finally(function () {
        state.buzonBusy = false;
      });
  }

  regexBtn &&
    regexBtn.addEventListener('click', function () {
      var open = function () {
        showInlineMsg(regexModalMsg, '', false);
        renderRegexList();
        openModal(regexModal);
      };
      if (!state.loaded) {
        loadSettings()
          .then(open)
          .catch(function (err) {
            showMsg(err.message || 'Error al cargar regex.', true);
          });
        return;
      }
      open();
    });

  imapBtn &&
    imapBtn.addEventListener('click', function () {
      if (!state.loaded) {
        loadSettings()
          .then(function () {
            openModal(imapModal);
          })
          .catch(function (err) {
            showMsg(err.message || 'Error al cargar IMAP.', true);
          });
        return;
      }
      renderImapTable();
      openModal(imapModal);
    });

  document.querySelectorAll('[data-email-modal-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      closeAllModals();
    });
  });

  document.querySelectorAll('[data-email-regex-edit-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      closeModal(regexEditModal);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (regexEditModal && !regexEditModal.hidden && !regexEditModal.classList.contains('d-none')) {
      closeModal(regexEditModal);
      return;
    }
    closeAllModals();
  });

  imapFilter &&
    imapFilter.addEventListener('input', function () {
      renderImapTable();
    });

  var imapSelectAll = document.getElementById('adminRecargasEmailImapSelectAll');
  var imapDeselectAll = document.getElementById('adminRecargasEmailImapDeselectAll');
  imapSelectAll &&
    imapSelectAll.addEventListener('click', function () {
      if (!imapBody) return;
      imapBody.querySelectorAll('input[type="checkbox"][data-imap-id]').forEach(function (cb) {
        cb.checked = true;
      });
    });
  imapDeselectAll &&
    imapDeselectAll.addEventListener('click', function () {
      if (!imapBody) return;
      imapBody.querySelectorAll('input[type="checkbox"][data-imap-id]').forEach(function (cb) {
        cb.checked = false;
      });
    });

  imapSaveBtn &&
    imapSaveBtn.addEventListener('click', function () {
      var ids = selectedImapIds();
      imapSaveBtn.disabled = true;
      saveSettings({ imap_server_ids: ids })
        .then(function (data) {
          state.imapIds = ids;
          showMsg(data.message || 'IMAP guardados.', false);
          closeModal(imapModal);
        })
        .catch(function (err) {
          showMsg(err.message || 'Error al guardar IMAP.', true);
        })
        .finally(function () {
          imapSaveBtn.disabled = false;
        });
    });

  createRegexBtn &&
    createRegexBtn.addEventListener('click', function () {
      createRegexEntry();
    });

  editRegexForm &&
    editRegexForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!editRegexId || !editRegexDesc || !editRegexPattern) return;
      var entryId = parseInt(editRegexId.value, 10);
      if (!entryId) return;
      var payload = {
        description: editRegexDesc.value.trim(),
        sender: editRegexSender ? editRegexSender.value.trim() : '',
        pattern: editRegexPattern.value.trim(),
      };
      if (!payload.description || !payload.pattern) {
        showInlineMsg(regexEditMsg, 'Descripción y patrón son obligatorios.', true);
        return;
      }
      updateRegexEntry(entryId, payload)
        .then(function (data) {
          showInlineMsg(regexEditMsg, data.message || 'Regex actualizado.', false);
          closeModal(regexEditModal);
          showInlineMsg(regexModalMsg, data.message || 'Regex actualizado.', false);
        })
        .catch(function (err) {
          showInlineMsg(regexEditMsg, err.message || 'Error al actualizar.', true);
        });
    });

  buzonCheck &&
    buzonCheck.addEventListener('change', function () {
      saveBuzon(buzonCheck.checked);
    });

  loadSettings().catch(function () {
    /* silencioso al cargar */
  });
})();
