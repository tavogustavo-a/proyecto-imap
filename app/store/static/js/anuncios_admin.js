(function () {
  'use strict';

  var form = document.getElementById('newAnuncioForm');
  var listEl = document.getElementById('anunciosAdminList');
  if (!form || !listEl) return;

  var tiempoEl = document.getElementById('anuncioTiempo');
  var customWrap = document.getElementById('anuncioTiempoPersonalizado');
  var submitBtn = document.getElementById('anuncioSubmitBtn');
  var titleEl = document.getElementById('anuncioTitulo');
  var htmlEl = document.getElementById('anuncioHtml');
  var daysEl = document.getElementById('anuncioDias');
  var hoursEl = document.getElementById('anuncioHoras');
  var entryEl = document.getElementById('anuncioApareceAlIngresar');

  var editModal = document.getElementById('anuncioEditModal');
  var editForm = document.getElementById('editAnuncioForm');
  var editCloseBtn = document.getElementById('anuncioEditModalClose');
  var editIdEl = document.getElementById('editAnuncioId');
  var editTitleEl = document.getElementById('editAnuncioTitulo');
  var editHtmlEl = document.getElementById('editAnuncioHtml');
  var editTiempoEl = document.getElementById('editAnuncioTiempo');
  var editCustomWrap = document.getElementById('editAnuncioTiempoPersonalizado');
  var editDaysEl = document.getElementById('editAnuncioDias');
  var editHoursEl = document.getElementById('editAnuncioHoras');
  var editEntryEl = document.getElementById('editAnuncioApareceAlIngresar');
  var editSubmitBtn = document.getElementById('editAnuncioSubmitBtn');

  var cached = [];

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function syncCustom(selectEl, wrapEl) {
    if (!selectEl || !wrapEl) return;
    var isCustom = selectEl.value === 'personalizado';
    wrapEl.hidden = !isCustom;
    wrapEl.classList.toggle('d-none', !isCustom);
  }

  function resetCreateForm() {
    form.reset();
    if (tiempoEl) tiempoEl.value = 'indefinido';
    if (entryEl) entryEl.checked = false;
    if (submitBtn) submitBtn.textContent = 'Crear Anuncio';
    syncCustom(tiempoEl, customWrap);
  }

  function payloadFrom(els) {
    return {
      title: els.title ? els.title.value.trim() : '',
      html: els.html ? els.html.value.trim() : '',
      duration_preset: els.tiempo ? els.tiempo.value : 'indefinido',
      custom_days:
        els.days && els.days.value !== ''
          ? parseFloat(String(els.days.value).replace(',', '.'))
          : 0,
      custom_hours:
        els.hours && els.hours.value !== ''
          ? parseFloat(String(els.hours.value).replace(',', '.'))
          : 0,
      show_on_entry: !!(els.entry && els.entry.checked),
    };
  }

  function openEditModal(item) {
    if (!editModal || !item) return;
    if (editIdEl) editIdEl.value = String(item.id || '');
    if (editTitleEl) editTitleEl.value = item.title || '';
    if (editHtmlEl) editHtmlEl.value = item.html || '';
    if (editTiempoEl) editTiempoEl.value = item.duration_preset || 'indefinido';
    if (editDaysEl) editDaysEl.value = item.custom_days != null ? item.custom_days : '';
    if (editHoursEl) editHoursEl.value = item.custom_hours != null ? item.custom_hours : '';
    if (editEntryEl) editEntryEl.checked = !!item.show_on_entry;
    syncCustom(editTiempoEl, editCustomWrap);
    editModal.hidden = false;
    editModal.classList.remove('d-none');
    document.body.classList.add('anuncio-edit-modal-open');
  }

  function closeEditModal() {
    if (!editModal) return;
    editModal.hidden = true;
    editModal.classList.add('d-none');
    document.body.classList.remove('anuncio-edit-modal-open');
    if (editForm) editForm.reset();
    if (editIdEl) editIdEl.value = '';
    syncCustom(editTiempoEl, editCustomWrap);
  }

  function renderList(items) {
    cached = Array.isArray(items) ? items : [];
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    if (!cached.length) {
      var p = document.createElement('p');
      p.className = 'text-center text-muted mb-0';
      p.id = 'anunciosAdminEmpty';
      p.textContent = 'No hay anuncios aún.';
      listEl.appendChild(p);
      return;
    }

    cached.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'anuncios-admin-row';
      row.setAttribute('data-id', String(item.id));

      var title = document.createElement('div');
      title.className = 'anuncios-admin-row__title';
      title.textContent = item.title || 'Anuncio #' + item.id;
      row.appendChild(title);

      var actions = document.createElement('div');
      actions.className = 'anuncios-admin-row__actions';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'action-btn action-blue anuncios-admin-edit';
      editBtn.textContent = 'Editar';
      editBtn.setAttribute('data-id', String(item.id));
      actions.appendChild(editBtn);

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className =
        'action-btn anuncios-admin-toggle ' + (item.enabled ? 'action-red' : 'action-green');
      toggleBtn.textContent = item.enabled ? 'OFF' : 'ON';
      toggleBtn.setAttribute('data-id', String(item.id));
      toggleBtn.title = item.enabled ? 'Desactivar' : 'Activar';
      actions.appendChild(toggleBtn);

      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function loadList() {
    fetch('/tienda/admin/anuncios/list', {
      headers: { 'X-CSRFToken': csrfToken() },
      credentials: 'same-origin',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.success) renderList(data.announcements || []);
      })
      .catch(function (err) {
        console.error('Error al cargar anuncios:', err);
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = payloadFrom({
      title: titleEl,
      html: htmlEl,
      tiempo: tiempoEl,
      days: daysEl,
      hours: hoursEl,
      entry: entryEl,
    });
    if (!payload.title || !payload.html) {
      alert('Completa título y campo HTML.');
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creando…';
    }
    var savedOk = false;
    fetch('/tienda/admin/anuncios/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken(),
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { data: data };
        });
      })
      .then(function (res) {
        if (!res.data || !res.data.success) {
          alert((res.data && res.data.error) || 'No se pudo crear el anuncio.');
          return;
        }
        savedOk = true;
        resetCreateForm();
        loadList();
      })
      .catch(function (err) {
        console.error(err);
        alert('Error al crear el anuncio.');
      })
      .finally(function () {
        if (!submitBtn) return;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear Anuncio';
        if (!savedOk) return;
      });
  });

  if (editForm) {
    editForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = editIdEl ? String(editIdEl.value || '').trim() : '';
      if (!id) return;
      var payload = payloadFrom({
        title: editTitleEl,
        html: editHtmlEl,
        tiempo: editTiempoEl,
        days: editDaysEl,
        hours: editHoursEl,
        entry: editEntryEl,
      });
      if (!payload.title || !payload.html) {
        alert('Completa título y campo HTML.');
        return;
      }
      if (editSubmitBtn) {
        editSubmitBtn.disabled = true;
        editSubmitBtn.textContent = 'Guardando…';
      }
      fetch('/tienda/admin/anuncios/update/' + encodeURIComponent(id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken(),
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.success) {
            alert((data && data.error) || 'No se pudo guardar.');
            return;
          }
          closeEditModal();
          loadList();
        })
        .catch(function (err) {
          console.error(err);
          alert('Error al guardar el anuncio.');
        })
        .finally(function () {
          if (editSubmitBtn) {
            editSubmitBtn.disabled = false;
            editSubmitBtn.textContent = 'Guardar cambios';
          }
        });
    });
  }

  if (editCloseBtn) {
    editCloseBtn.addEventListener('click', function (e) {
      e.preventDefault();
      closeEditModal();
    });
  }
  if (editModal) {
    editModal.addEventListener('click', function (e) {
      if (e.target === editModal) closeEditModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && editModal && !editModal.classList.contains('d-none')) {
      closeEditModal();
    }
  });

  listEl.addEventListener('click', function (e) {
    var editBtn = e.target.closest('.anuncios-admin-edit');
    if (editBtn) {
      var eid = parseInt(editBtn.getAttribute('data-id'), 10);
      var found = cached.find(function (x) {
        return Number(x.id) === eid;
      });
      if (found) openEditModal(found);
      return;
    }
    var toggleBtn = e.target.closest('.anuncios-admin-toggle');
    if (!toggleBtn) return;
    var tid = toggleBtn.getAttribute('data-id');
    toggleBtn.disabled = true;
    fetch('/tienda/admin/anuncios/toggle/' + encodeURIComponent(tid), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken(),
      },
      credentials: 'same-origin',
      body: '{}',
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.success) return;
        toggleBtn.textContent = data.new_state;
        toggleBtn.classList.remove('action-green', 'action-red');
        toggleBtn.classList.add(data.new_class);
        var item = cached.find(function (x) {
          return String(x.id) === String(tid);
        });
        if (item) item.enabled = !!data.enabled;
      })
      .catch(function (err) {
        console.error(err);
      })
      .finally(function () {
        toggleBtn.disabled = false;
      });
  });

  if (tiempoEl) {
    tiempoEl.addEventListener('change', function () {
      syncCustom(tiempoEl, customWrap);
    });
  }
  if (editTiempoEl) {
    editTiempoEl.addEventListener('change', function () {
      syncCustom(editTiempoEl, editCustomWrap);
    });
  }
  syncCustom(tiempoEl, customWrap);
  loadList();
  // Refrescar lista para que los vencidos (personalizado / con días) desaparezcan solos.
  setInterval(function () {
    if (document.hidden) return;
    if (editModal && !editModal.classList.contains('d-none') && !editModal.hidden) return;
    loadList();
  }, 30000);
})();
