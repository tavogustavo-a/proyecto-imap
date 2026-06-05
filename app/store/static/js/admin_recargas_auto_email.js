(function () {
  'use strict';

  var root = document.querySelector('.admin-recargas-page');
  if (!root) return;

  var settingsUrl = root.dataset.emailReviewUrl || '';
  var buzonUrl = root.dataset.emailReviewBuzonUrl || '';
  var regexCreateUrl = root.dataset.emailReviewRegexUrl || '';
  var imapCreateUrl = root.dataset.emailReviewImapUrl || '';
  if (!settingsUrl) return;

  var msgEl = document.getElementById('adminRecargasEmailReviewMsg');
  var regexBtn = document.getElementById('adminRecargasEmailRegexBtn');
  var imapBtn = document.getElementById('adminRecargasEmailImapBtn');

  var regexModal = document.getElementById('adminRecargasEmailRegexModal');
  var regexEditModal = document.getElementById('adminRecargasEmailRegexEditModal');
  var imapModal = document.getElementById('adminRecargasEmailImapModal');
  var imapEditModal = document.getElementById('adminRecargasEmailImapEditModal');
  var regexListEl = document.getElementById('adminRecargasEmailRegexList');
  var imapBody = document.getElementById('adminRecargasEmailImapTableBody');
  var imapFilter = document.getElementById('adminRecargasEmailImapFilter');
  var imapModalMsg = document.getElementById('adminRecargasEmailImapModalMsg');
  var imapEditMsg = document.getElementById('adminRecargasEmailImapEditMsg');
  var createImapBtn = document.getElementById('adminRecargasCreateImapBtn');
  var newImapHost = document.getElementById('adminRecargasNewImapHost');
  var newImapPort = document.getElementById('adminRecargasNewImapPort');
  var newImapUser = document.getElementById('adminRecargasNewImapUser');
  var newImapPass = document.getElementById('adminRecargasNewImapPass');
  var newImapFolders = document.getElementById('adminRecargasNewImapFolders');
  var editImapForm = document.getElementById('adminRecargasEditImapForm');
  var editImapId = document.getElementById('adminRecargasEditImapId');
  var editImapHost = document.getElementById('adminRecargasEditImapHost');
  var editImapPort = document.getElementById('adminRecargasEditImapPort');
  var editImapUser = document.getElementById('adminRecargasEditImapUser');
  var editImapPass = document.getElementById('adminRecargasEditImapPass');
  var editImapFolders = document.getElementById('adminRecargasEditImapFolders');
  var regexModalMsg = document.getElementById('adminRecargasEmailRegexModalMsg');
  var regexEditMsg = document.getElementById('adminRecargasEmailRegexEditMsg');

  var newRegexPm = document.getElementById('adminRecargasNewRegexPm');
  var newRegexNote = document.getElementById('adminRecargasNewRegexNote');
  var newRegexSender = document.getElementById('adminRecargasNewRegexSender');
  var newRegexPattern = document.getElementById('adminRecargasNewRegexPattern');
  var createRegexBtn = document.getElementById('adminRecargasCreateRegexBtn');
  var editRegexForm = document.getElementById('adminRecargasEditRegexForm');
  var editRegexId = document.getElementById('adminRecargasEditRegexId');
  var editRegexPm = document.getElementById('adminRecargasEditRegexPm');
  var editRegexNote = document.getElementById('adminRecargasEditRegexNote');
  var editRegexSender = document.getElementById('adminRecargasEditRegexSender');
  var editRegexPattern = document.getElementById('adminRecargasEditRegexPattern');

  var state = {
    regexEntries: [],
    imapOptions: [],
    paymentMethodOptions: [],
    loaded: false,
    buzonBusy: false,
    buzonEnabled: false,
  };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function imapItemUrl(id) {
    return imapCreateUrl.replace(/\/$/, '') + '/' + id;
  }

  function regexItemUrl(id) {
    return regexCreateUrl.replace(/\/$/, '') + '/' + id;
  }

  function parseJsonResponse(r) {
    var ct = (r.headers.get('Content-Type') || '').toLowerCase();
    if (ct.indexOf('application/json') === -1) {
      return r.text().then(function () {
        if (r.status === 404) {
          throw new Error(
            'No se encontró el API (recarga la página con Ctrl+F5 e intenta de nuevo).'
          );
        }
        if (r.status === 405) {
          throw new Error(
            'El servidor rechazó la operación. Reinicia Flask y recarga con Ctrl+F5.'
          );
        }
        throw new Error('Respuesta no válida del servidor (código ' + r.status + ').');
      });
    }
    return r.json();
  }

  function regexEntryId(entry) {
    var n = Number(entry && entry.id);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function findRegexEntryById(id) {
    var n = parseInt(id, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return (
      (state.regexEntries || []).find(function (r) {
        return Number(r.id) === n;
      }) || null
    );
  }

  function entryLabel(entry) {
    return (
      entry.payment_method_label ||
      entry.description ||
      'Sin medio de pago'
    );
  }

  function escapeAttr(s) {
    return escapeHtml(s == null ? '' : String(s));
  }

  /** Etiqueta actual del medio (por id guardado), o la guardada en el regex. */
  function resolvePaymentMethodLabel(entry) {
    if (!entry) return '';
    var pmId = String(entry.payment_method_id || '').trim();
    var opts = state.paymentMethodOptions || [];
    var i;
    if (pmId) {
      for (i = 0; i < opts.length; i++) {
        if (String(opts[i].id || '') === pmId) {
          return opts[i].label || entryLabel(entry);
        }
      }
    }
    var stored = (entry.payment_method_label || entry.description || '').trim();
    if (stored) {
      for (i = 0; i < opts.length; i++) {
        if ((opts[i].label || '').trim() === stored) return opts[i].label || stored;
      }
      return stored;
    }
    return '';
  }

  function renderPaymentMethodSelect(selectEl, selectedLabelOrEntry) {
    if (!selectEl) return;
    var opts = state.paymentMethodOptions || [];
    var selectedLabel = '';
    var selectedId = '';
    if (selectedLabelOrEntry && typeof selectedLabelOrEntry === 'object') {
      selectedId = String(selectedLabelOrEntry.payment_method_id || '').trim();
      selectedLabel = resolvePaymentMethodLabel(selectedLabelOrEntry);
      if (!selectedLabel) selectedLabel = entryLabel(selectedLabelOrEntry);
    } else {
      selectedLabel = selectedLabelOrEntry || '';
    }

    var html = '<option value="">— Selecciona —</option>';
    var matchedInList = false;
    opts.forEach(function (pm) {
      var label = (pm.label || '').trim();
      if (!label) return;
      var id = String(pm.id || '');
      var cur = pm.currency ? ' (' + pm.currency + ')' : '';
      var sel =
        (selectedId && id === selectedId) || (selectedLabel && label === selectedLabel);
      if (sel) matchedInList = true;
      html +=
        '<option value="' +
        escapeAttr(label) +
        '" data-pm-id="' +
        escapeAttr(id) +
        '"' +
        (sel ? ' selected' : '') +
        '>' +
        escapeHtml(label + cur) +
        '</option>';
    });
    if (selectedLabel && !matchedInList) {
      html +=
        '<option value="' +
        escapeAttr(selectedLabel) +
        '" selected>' +
        escapeHtml(selectedLabel) +
        ' (medio no en lista)</option>';
      matchedInList = true;
    }
    selectEl.innerHTML = html;
    if (selectedId && matchedInList) {
      var optById = selectEl.querySelector(
        'option[data-pm-id="' + CSS.escape(selectedId) + '"]'
      );
      if (optById) {
        selectEl.value = optById.value;
        return;
      }
    }
    if (selectedLabel) selectEl.value = selectedLabel;
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
    closeModal(imapEditModal);
    closeModal(regexEditModal);
    closeModal(regexModal);
    closeModal(imapModal);
  }

  function renderRegexList() {
    if (!regexListEl) return;
    var rows = state.regexEntries || [];
    if (!rows.length) {
      regexListEl.innerHTML =
        '<p class="admin-pm-users-empty">No hay regex. Crea uno eligiendo el mismo Nombre que en Medios de pago.</p>';
      return;
    }
    regexListEl.innerHTML = rows
      .map(function (r) {
        var rid = regexEntryId(r);
        if (!rid) return '';
        var label = entryLabel(r);
        var noteLine = (r.note || '').trim()
          ? '<br><small class="text-muted">Nota: ' + escapeHtml(r.note) + '</small>'
          : '';
        var senderLine = r.sender
          ? '<br><small class="text-muted">Remitente: <code>' +
            escapeHtml(r.sender) +
            '</code></small>'
          : '<br><small class="text-muted">Remitente: <em>sin configurar</em></small>';
        var patternLine = (r.pattern || '').trim()
          ? '<br><small class="admin-recarga-email-regex-item__pattern"><code>' +
            escapeHtml(r.pattern) +
            '</code></small>'
          : '<br><small class="text-muted">Patrón: <em>pendiente de configurar</em></small>';
        return (
          '<div class="admin-recarga-email-regex-item">' +
          '<div class="admin-recarga-email-regex-item__body">' +
          '<strong>' +
          escapeHtml(label) +
          '</strong>' +
          noteLine +
          senderLine +
          patternLine +
          '</div>' +
          '<div class="admin-recarga-email-regex-item__actions">' +
          '<button type="button" class="btn-panel btn-orange btn-sm admin-recarga-email-regex-edit" data-regex-id="' +
          rid +
          '" title="Editar"><i class="fas fa-edit" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn-panel btn-red btn-sm admin-recarga-email-regex-delete" data-regex-id="' +
          rid +
          '" title="Eliminar"><i class="fas fa-trash" aria-hidden="true"></i></button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    regexListEl.querySelectorAll('.admin-recarga-email-regex-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-regex-id'), 10);
        var entry = findRegexEntryById(id);
        if (entry) openEditRegexModal(entry);
      });
    });

    regexListEl.querySelectorAll('.admin-recarga-email-regex-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-regex-id'), 10);
        var entry = findRegexEntryById(id);
        var label = entry ? entryLabel(entry) : 'este regex';
        if (!Number.isFinite(id) || id <= 0) {
          showInlineMsg(
            regexModalMsg,
            'No se puede eliminar: ID inválido. Cierra el modal, recarga con Ctrl+F5 y vuelve a abrir Regex.',
            true
          );
          return;
        }
        if (window.confirm('¿Eliminar regex de "' + label + '"?')) {
          deleteRegexEntry(id);
        }
      });
    });
  }

  function openEditRegexModal(entry) {
    if (!regexEditModal || !editRegexId) return;
    var rid = regexEntryId(entry);
    if (!rid) return;
    editRegexId.value = rid;
    renderPaymentMethodSelect(editRegexPm, entry);
    if (editRegexNote) editRegexNote.value = entry.note || '';
    if (editRegexSender) editRegexSender.value = entry.sender || '';
    if (editRegexPattern) editRegexPattern.value = entry.pattern || '';
    showInlineMsg(regexEditMsg, '', false);
    openModal(regexEditModal);
  }

  function openEditImapModal(server) {
    if (!imapEditModal || !editImapId) return;
    editImapId.value = server.id;
    if (editImapHost) editImapHost.value = server.host || '';
    if (editImapPort) editImapPort.value = String(server.port || 993);
    if (editImapUser) editImapUser.value = server.username || '';
    if (editImapPass) editImapPass.value = '';
    if (editImapFolders) editImapFolders.value = server.folders || 'INBOX';
    showInlineMsg(imapEditMsg, '', false);
    openModal(imapEditModal);
  }

  function buzonRowMatchesFilter(q) {
    if (!q) return true;
    return (
      'buzon de correos'.indexOf(q) !== -1 ||
      'buzon'.indexOf(q) !== -1 ||
      'correos'.indexOf(q) !== -1 ||
      'imap'.indexOf(q) !== -1
    );
  }

  function renderBuzonRowHtml() {
    var enabled = !!state.buzonEnabled;
    var off = enabled ? '' : ' admin-recarga-email-row--off';
    var toggleClass = enabled ? 'btn-red' : 'btn-green';
    var toggleTitle = enabled ? 'Apagar' : 'Encender';
    return (
      '<tr class="admin-recarga-email-row admin-recarga-email-row--buzon' +
      off +
      '">' +
      '<td>Buzón de correos</td>' +
      '<td class="text-muted">—</td>' +
      '<td class="text-muted">' +
      (enabled ? '(activo)' : '(apagado)') +
      '</td>' +
      '<td class="admin-pm-users-table-col-actions"><div class="admin-recarga-email-imap-actions">' +
      '<button type="button" class="btn-panel btn-sm btn-table-action ' +
      toggleClass +
      ' admin-recarga-buzon-toggle" data-enabled="' +
      (enabled ? '1' : '0') +
      '" title="' +
      toggleTitle +
      '" aria-label="' +
      toggleTitle +
      '"><i class="fas fa-power-off" aria-hidden="true"></i></button>' +
      '</div></td>' +
      '</tr>'
    );
  }

  function renderImapTable() {
    if (!imapBody) return;
    var q = (imapFilter && imapFilter.value ? imapFilter.value : '').trim().toLowerCase();
    var showBuzon = buzonRowMatchesFilter(q);
    var rows = state.imapOptions.filter(function (s) {
      if (!q) return true;
      var hay = [s.host, s.username, s.description, s.folders].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    var html = showBuzon ? renderBuzonRowHtml() : '';
    if (!rows.length && !showBuzon) {
      imapBody.innerHTML =
        '<tr><td colspan="4" class="admin-pm-users-empty">No hay servidores IMAP. Agrega uno arriba.</td></tr>';
      return;
    }
    if (!rows.length) {
      imapBody.innerHTML = html;
      return;
    }
    imapBody.innerHTML =
      html +
      rows
      .map(function (s) {
        var off = s.enabled ? '' : ' admin-recarga-email-row--off';
        var toggleClass = s.enabled ? 'btn-red' : 'btn-green';
        var toggleTitle = s.enabled ? 'Apagar' : 'Encender';
        return (
          '<tr class="admin-recarga-email-row' +
          off +
          '">' +
          '<td><code>' +
          escapeHtml(s.host || '—') +
          '</code></td>' +
          '<td>' +
          escapeHtml(s.username || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(s.folders || 'INBOX') +
          (s.enabled ? '' : ' <span class="text-muted">(apagado)</span>') +
          '</td>' +
          '<td class="admin-pm-users-table-col-actions"><div class="admin-recarga-email-imap-actions">' +
          '<button type="button" class="btn-panel btn-blue btn-sm btn-table-action admin-recarga-imap-test" data-imap-id="' +
          s.id +
          '" title="Probar conexión" aria-label="Probar conexión"><i class="fas fa-plug" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn-panel btn-orange btn-sm btn-table-action admin-recarga-imap-edit" data-imap-id="' +
          s.id +
          '" title="Editar" aria-label="Editar"><i class="fas fa-edit" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn-panel btn-sm btn-table-action ' +
          toggleClass +
          ' admin-recarga-imap-toggle" data-imap-id="' +
          s.id +
          '" data-enabled="' +
          (s.enabled ? '1' : '0') +
          '" title="' +
          toggleTitle +
          '" aria-label="' +
          toggleTitle +
          '"><i class="fas fa-power-off" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn-panel btn-red btn-sm btn-table-action admin-recarga-imap-delete" data-imap-id="' +
          s.id +
          '" title="Eliminar" aria-label="Eliminar"><i class="fas fa-trash" aria-hidden="true"></i></button>' +
          '</div></td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function createImapServer() {
    if (!imapCreateUrl) return;
    var host = newImapHost ? newImapHost.value.trim() : '';
    var port = newImapPort ? parseInt(newImapPort.value, 10) : 993;
    var username = newImapUser ? newImapUser.value.trim() : '';
    var password = newImapPass ? newImapPass.value : '';
    var folders = newImapFolders ? newImapFolders.value.trim() : 'INBOX';
    if (!host || !username || !password.trim()) {
      showInlineMsg(imapModalMsg, 'Host, usuario y contraseña son obligatorios.', true);
      return;
    }
    createImapBtn.disabled = true;
    fetch(imapCreateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        host: host,
        port: isNaN(port) ? 993 : port,
        username: username,
        password: password,
        folders: folders || 'INBOX',
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo agregar');
        state.imapOptions = data.imap_options || state.imapOptions;
        renderImapTable();
        if (newImapHost) newImapHost.value = '';
        if (newImapPort) newImapPort.value = '993';
        if (newImapUser) newImapUser.value = '';
        if (newImapPass) newImapPass.value = '';
        if (newImapFolders) newImapFolders.value = 'INBOX';
        showInlineMsg(imapModalMsg, data.message || 'Servidor agregado.', false);
      })
      .catch(function (err) {
        showInlineMsg(imapModalMsg, err.message || 'Error al agregar IMAP.', true);
      })
      .finally(function () {
        if (createImapBtn) createImapBtn.disabled = false;
      });
  }

  function testImapServer(id) {
    return fetch(imapItemUrl(id) + '/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'Prueba fallida.');
        showInlineMsg(imapModalMsg, data.message || 'Conexión OK.', false);
      });
  }

  function toggleImapServer(id, enabled) {
    return fetch(imapItemUrl(id) + '/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: !!enabled }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo cambiar estado.');
        state.imapOptions = data.imap_options || state.imapOptions;
        renderImapTable();
        showInlineMsg(imapModalMsg, data.message || 'Estado actualizado.', false);
      });
  }

  function deleteImapServer(id) {
    return fetch(imapItemUrl(id), {
      method: 'DELETE',
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo eliminar.');
        state.imapOptions = data.imap_options || [];
        renderImapTable();
        showInlineMsg(imapModalMsg, data.message || 'Servidor eliminado.', false);
      });
  }

  function updateImapServer(id, payload) {
    return fetch(imapItemUrl(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo actualizar.');
        state.imapOptions = data.imap_options || state.imapOptions;
        renderImapTable();
        return data;
      });
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
        state.paymentMethodOptions = data.payment_method_options || [];
        state.loaded = true;
        state.buzonEnabled = !!data.buzon_enabled;
        renderPaymentMethodSelect(newRegexPm, '');
        renderRegexList();
        renderImapTable();
      });
  }

  function createRegexEntry() {
    if (!regexCreateUrl || !newRegexPm) return;
    var paymentMethodLabel = newRegexPm.value.trim();
    var note = newRegexNote ? newRegexNote.value.trim() : '';
    var sender = newRegexSender ? newRegexSender.value.trim() : '';
    var pattern = newRegexPattern ? newRegexPattern.value.trim() : '';
    if (!paymentMethodLabel) {
      showInlineMsg(regexModalMsg, 'Selecciona el medio de pago.', true);
      return;
    }
    createRegexBtn.disabled = true;
    fetch(regexCreateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        payment_method_label: paymentMethodLabel,
        note: note,
        sender: sender,
        pattern: pattern,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo crear');
        state.regexEntries = data.regex_entries || state.regexEntries;
        renderRegexList();
        if (newRegexSender) newRegexSender.value = '';
        if (newRegexPattern) newRegexPattern.value = '';
        if (newRegexNote) newRegexNote.value = '';
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
      .then(parseJsonResponse)
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'No se pudo actualizar');
        state.regexEntries = data.regex_entries || state.regexEntries;
        renderRegexList();
        return data;
      });
  }

  function deleteRegexEntry(entryId) {
    var id = parseInt(entryId, 10);
    if (!Number.isFinite(id) || id <= 0) {
      showInlineMsg(
        regexModalMsg,
        'No se puede eliminar: ID inválido. Recarga la página (Ctrl+F5).',
        true
      );
      return;
    }
    fetch(regexItemUrl(id), {
      method: 'DELETE',
      credentials: 'same-origin',
    })
      .then(parseJsonResponse)
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

  function saveBuzon(enabled, msgElTarget) {
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
        state.buzonEnabled = !!data.buzon_enabled;
        renderImapTable();
        var target = msgElTarget || imapModalMsg || msgEl;
        showInlineMsg(target, data.message || 'Buzón IMAP actualizado.', false);
        return data;
      })
      .catch(function (err) {
        var target = msgElTarget || imapModalMsg || msgEl;
        showInlineMsg(target, err.message || 'Error al cambiar buzón.', true);
      })
      .finally(function () {
        state.buzonBusy = false;
      });
  }

  regexBtn &&
    regexBtn.addEventListener('click', function () {
      var open = function () {
        showInlineMsg(regexModalMsg, '', false);
        renderPaymentMethodSelect(newRegexPm, '');
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
      var open = function () {
        showInlineMsg(imapModalMsg, '', false);
        renderImapTable();
        openModal(imapModal);
      };
      if (!state.loaded) {
        loadSettings()
          .then(open)
          .catch(function (err) {
            showMsg(err.message || 'Error al cargar IMAP.', true);
          });
        return;
      }
      open();
    });

  imapBody &&
    imapBody.addEventListener('click', function (e) {
      var buzonToggleBtn = e.target.closest('.admin-recarga-buzon-toggle');
      var testBtn = e.target.closest('.admin-recarga-imap-test');
      var editBtn = e.target.closest('.admin-recarga-imap-edit');
      var toggleBtn = e.target.closest('.admin-recarga-imap-toggle');
      var deleteBtn = e.target.closest('.admin-recarga-imap-delete');
      if (buzonToggleBtn) {
        var buzonOn = buzonToggleBtn.getAttribute('data-enabled') === '1';
        buzonToggleBtn.disabled = true;
        saveBuzon(!buzonOn, imapModalMsg)
          .catch(function () {})
          .finally(function () {
            buzonToggleBtn.disabled = false;
          });
        return;
      }
      if (testBtn) {
        var idT = parseInt(testBtn.getAttribute('data-imap-id'), 10);
        if (!idT) return;
        testBtn.disabled = true;
        testImapServer(idT)
          .catch(function (err) {
            showInlineMsg(imapModalMsg, err.message || 'Prueba fallida.', true);
          })
          .finally(function () {
            testBtn.disabled = false;
          });
        return;
      }
      if (editBtn) {
        var idE = parseInt(editBtn.getAttribute('data-imap-id'), 10);
        if (!idE) return;
        var server = state.imapOptions.find(function (s) {
          return s.id === idE;
        });
        if (server) openEditImapModal(server);
        return;
      }
      if (toggleBtn) {
        var idG = parseInt(toggleBtn.getAttribute('data-imap-id'), 10);
        if (!idG) return;
        var currentlyOn = toggleBtn.getAttribute('data-enabled') === '1';
        toggleBtn.disabled = true;
        toggleImapServer(idG, !currentlyOn)
          .catch(function (err) {
            showInlineMsg(imapModalMsg, err.message || 'Error al cambiar estado.', true);
          })
          .finally(function () {
            toggleBtn.disabled = false;
          });
        return;
      }
      if (deleteBtn) {
        var idD = parseInt(deleteBtn.getAttribute('data-imap-id'), 10);
        if (!idD) return;
        if (!window.confirm('¿Eliminar este servidor IMAP?')) return;
        deleteBtn.disabled = true;
        deleteImapServer(idD)
          .catch(function (err) {
            showInlineMsg(imapModalMsg, err.message || 'Error al eliminar.', true);
          })
          .finally(function () {
            deleteBtn.disabled = false;
          });
      }
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

  document.querySelectorAll('[data-email-imap-edit-close]').forEach(function (el) {
    el.addEventListener('click', function () {
      closeModal(imapEditModal);
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (regexEditModal && !regexEditModal.hidden && !regexEditModal.classList.contains('d-none')) {
      closeModal(regexEditModal);
      return;
    }
    if (imapEditModal && !imapEditModal.hidden && !imapEditModal.classList.contains('d-none')) {
      closeModal(imapEditModal);
      return;
    }
    closeAllModals();
  });

  imapFilter &&
    imapFilter.addEventListener('input', function () {
      renderImapTable();
    });

  createImapBtn &&
    createImapBtn.addEventListener('click', function () {
      createImapServer();
    });

  editImapForm &&
    editImapForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!editImapId) return;
      var serverId = parseInt(editImapId.value, 10);
      if (!serverId) return;
      var host = editImapHost ? editImapHost.value.trim() : '';
      var port = editImapPort ? parseInt(editImapPort.value, 10) : 993;
      var username = editImapUser ? editImapUser.value.trim() : '';
      var password = editImapPass ? editImapPass.value : '';
      var folders = editImapFolders ? editImapFolders.value.trim() : 'INBOX';
      if (!host || !username) {
        showInlineMsg(imapEditMsg, 'Host y usuario son obligatorios.', true);
        return;
      }
      var updateBtn = document.getElementById('adminRecargasUpdateImapBtn');
      if (updateBtn) updateBtn.disabled = true;
      updateImapServer(serverId, {
        host: host,
        port: isNaN(port) ? 993 : port,
        username: username,
        password: password,
        folders: folders || 'INBOX',
      })
        .then(function (data) {
          showInlineMsg(imapEditMsg, data.message || 'Servidor actualizado.', false);
          closeModal(imapEditModal);
          showInlineMsg(imapModalMsg, data.message || 'Servidor actualizado.', false);
        })
        .catch(function (err) {
          showInlineMsg(imapEditMsg, err.message || 'Error al actualizar.', true);
        })
        .finally(function () {
          if (updateBtn) updateBtn.disabled = false;
        });
    });

  createRegexBtn &&
    createRegexBtn.addEventListener('click', function () {
      createRegexEntry();
    });

  editRegexForm &&
    editRegexForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!editRegexId || !editRegexPm) return;
      var entryId = parseInt(editRegexId.value, 10);
      if (!entryId) return;
      var payload = {
        payment_method_label: editRegexPm.value.trim(),
        note: editRegexNote ? editRegexNote.value.trim() : '',
        sender: editRegexSender ? editRegexSender.value.trim() : '',
        pattern: editRegexPattern ? editRegexPattern.value.trim() : '',
      };
      if (!payload.payment_method_label) {
        showInlineMsg(regexEditMsg, 'Selecciona el medio de pago.', true);
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

  loadSettings().catch(function () {
    /* silencioso al cargar */
  });
})();
