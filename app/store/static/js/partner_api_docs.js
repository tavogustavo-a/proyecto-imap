/* Panel admin de /api/partner/v1/docs/ — archivo externo por CSP (sin script inline). */
(function () {
  'use strict';

  var cache = [];

  function getCsrf() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return (meta && meta.getAttribute('content')) || '';
  }

  function mergeUsers(list) {
    var byId = {};
    cache.forEach(function (u) {
      byId[String(u.id)] = u;
    });
    (list || []).forEach(function (u) {
      if (!u || u.id == null) {
        return;
      }
      byId[String(u.id)] = {
        id: u.id,
        username: u.username || '',
        full_name: u.full_name || u.fullName || ''
      };
    });
    cache = Object.keys(byId).map(function (k) {
      return byId[k];
    });
    cache.sort(function (a, b) {
      return String(a.username).localeCompare(String(b.username), 'es', { sensitivity: 'base' });
    });
    return cache;
  }

  function searchLocal(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) {
      return cache.slice(0, 100);
    }
    return cache.filter(function (u) {
      var name = String(u.full_name || '').toLowerCase();
      var user = String(u.username || '').toLowerCase();
      return user.indexOf(q) !== -1 || name.indexOf(q) !== -1;
    }).slice(0, 100);
  }

  function fetchUsers(q) {
    var url = '/admin/search_users_ajax?query=' + encodeURIComponent(q || '') + '&per_page=all';
    return fetch(url, {
      credentials: 'same-origin',
      headers: { 'X-CSRFToken': getCsrf(), Accept: 'application/json' }
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.status === 'ok' && Array.isArray(data.users)) {
          return mergeUsers(data.users);
        }
        return cache;
      })
      .catch(function () {
        return cache;
      });
  }

  var PLACEHOLDER = 'Buscar usuario dueño…';
  var overlay = null;
  var overlayInput = null;
  var overlayResults = null;
  var overlayClose = null;
  var activeWrap = null;
  var timer = null;

  function triggerBtn(wrap) {
    return wrap && wrap.querySelector('.pd-owner-picker-btn');
  }

  function triggerLabel(wrap) {
    return wrap && wrap.querySelector('.pd-owner-picker-btn-label');
  }

  function placeholderOf(wrap) {
    var btn = triggerBtn(wrap);
    return (btn && btn.getAttribute('data-placeholder')) || PLACEHOLDER;
  }

  function setTriggerText(wrap, username) {
    var label = triggerLabel(wrap);
    var text = String(username || '').trim();
    if (!label) {
      return;
    }
    label.textContent = text || placeholderOf(wrap);
    wrap.classList.toggle('has-value', !!text);
  }

  function getTriggerText(wrap) {
    if (!wrap || !wrap.classList.contains('has-value')) {
      return '';
    }
    var label = triggerLabel(wrap);
    return (label && label.textContent.trim()) || '';
  }

  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.className = 'pd-owner-picker-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="pd-owner-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="pdOwnerPickerTitle">' +
        '<div class="pd-owner-picker-dialog-head">' +
          '<h4 id="pdOwnerPickerTitle">Usuario dueño</h4>' +
          '<button type="button" class="pd-owner-picker-dialog-close" aria-label="Cerrar">×</button>' +
        '</div>' +
        '<input type="search" id="pdOwnerPickerSearch" name="pdOwnerPickerSearch" class="pd-owner-picker-input" placeholder="Buscar usuario…" autocomplete="off" aria-label="Buscar usuario">' +
        '<div class="pd-owner-picker-results" role="listbox"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlayInput = overlay.querySelector('.pd-owner-picker-input');
    overlayResults = overlay.querySelector('.pd-owner-picker-results');
    overlayClose = overlay.querySelector('.pd-owner-picker-dialog-close');

    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) {
        closeOverlay();
      }
    });
    if (overlayClose) {
      overlayClose.addEventListener('click', closeOverlay);
    }
    overlayInput.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        run(overlayInput.value);
      }, 180);
    });
    overlayInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeOverlay();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = overlayResults && overlayResults.querySelector('.pd-owner-picker-row');
        if (first) {
          first.click();
        }
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) {
        closeOverlay();
      }
    });
    return overlay;
  }

  function closeOverlay() {
    if (!overlay) {
      return;
    }
    overlay.hidden = true;
    document.body.classList.remove('pd-owner-picker-open');
    overlayResults.innerHTML = '';
    if (overlayInput) {
      overlayInput.value = '';
    }
    activeWrap = null;
  }

  function hideResultsEmpty() {
    overlayResults.innerHTML = '';
    var empty = document.createElement('p');
    empty.className = 'pd-owner-picker-empty';
    empty.textContent = cache.length ? 'Sin resultados.' : 'Escribe para buscar un usuario.';
    overlayResults.appendChild(empty);
  }

  function render(list) {
    if (!overlayResults) {
      return;
    }
    overlayResults.innerHTML = '';
    if (!list.length) {
      hideResultsEmpty();
      return;
    }
    list.forEach(function (u) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pd-owner-picker-row';
      btn.setAttribute('role', 'option');
      btn.textContent = u.username || '';
      btn.addEventListener('click', function () {
        if (!activeWrap) {
          return;
        }
        var hidden = activeWrap.querySelector('input[type="hidden"]');
        if (hidden) {
          hidden.value = String(u.id);
        }
        setTriggerText(activeWrap, u.username || '');
        closeOverlay();
      });
      overlayResults.appendChild(btn);
    });
  }

  function run(q) {
    var local = searchLocal(q);
    if (local.length) {
      render(local);
    } else {
      hideResultsEmpty();
    }
    fetchUsers(q).then(function () {
      render(searchLocal(q));
    });
  }

  function openOverlay(wrap) {
    ensureOverlay();
    activeWrap = wrap;
    overlay.hidden = false;
    document.body.classList.add('pd-owner-picker-open');
    overlayInput.value = '';
    run('');
    setTimeout(function () {
      overlayInput.focus();
    }, 30);
  }

  function bindPicker(wrap) {
    if (!wrap || wrap.getAttribute('data-bound') === '1') {
      return;
    }
    var hidden = wrap.querySelector('input[type="hidden"]');
    var btn = triggerBtn(wrap);
    if (!hidden || !btn) {
      return;
    }
    wrap.setAttribute('data-bound', '1');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openOverlay(wrap);
    });
  }

  function bindAll() {
    document.querySelectorAll('[data-owner-picker]').forEach(bindPicker);
    fetchUsers('');
  }

  window.PartnerOwnerPicker = {
    mergeUsers: mergeUsers,
    bindAll: bindAll,
    setValue: function (hiddenEl, id, username) {
      if (!hiddenEl) {
        return;
      }
      hiddenEl.value = id ? String(id) : '';
      var wrap = hiddenEl.closest('[data-owner-picker]');
      if (wrap) {
        setTriggerText(wrap, username || '');
      }
    },
    clear: function (hiddenEl) {
      this.setValue(hiddenEl, '', '');
    },
    getUsername: function (hiddenEl) {
      if (!hiddenEl) {
        return '';
      }
      return getTriggerText(hiddenEl.closest('[data-owner-picker]'));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll);
  } else {
    bindAll();
  }
})();

(function () {
  'use strict';

  function initPartnerApiDocsAdmin() {
    var csrfMeta = document.querySelector('meta[name="csrf_token"]');
    var csrf = (csrfMeta && csrfMeta.getAttribute('content')) || '';
    var baseEl = document.getElementById('baseUrl');
    var base = baseEl ? baseEl.textContent.trim() : '';
    var chk = document.getElementById('apiEnabledChk');
    var listEl = document.getElementById('ipList');
    var input = document.getElementById('ipInput');
    var userSel = document.getElementById('ipUserSelect');
    var addBtn = document.getElementById('ipAddBtn');
    var msg = document.getElementById('saveMsg');
    var ips = [];
    var users = [];
    var saving = false;
    if (!chk || !listEl || !input || !addBtn || !userSel) {
      return;
    }

    function asEntry(item) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return {
          ip: String(item.ip || '').trim(),
          user_id: item.user_id || null,
          username: String(item.username || '').trim(),
          owner_enabled: item.owner_enabled !== false
        };
      }
      return { ip: String(item || '').trim(), user_id: null, username: '' };
    }

    function fillUsers(list) {
      users = Array.isArray(list) ? list : [];
      if (window.PartnerOwnerPicker) {
        window.PartnerOwnerPicker.mergeUsers(users);
      }
    }

    function ownerLabel(entry) {
      if (entry.username) {
        return entry.username;
      }
      if (entry.user_id) {
        var found = users.filter(function (u) {
          return String(u.id) === String(entry.user_id);
        })[0];
        if (found) {
          return found.username;
        }
        return 'id ' + entry.user_id;
      }
      return '';
    }

    function renderIps() {
      listEl.innerHTML = '';
      if (!ips.length) {
        var empty = document.createElement('span');
        empty.className = 'mut';
        empty.textContent = 'Debes añadir al menos una IP vinculada a un usuario. Sin eso la API no acepta conexiones.';
        listEl.appendChild(empty);
        return;
      }
      ips.forEach(function (raw, i) {
        var entry = asEntry(raw);
        var span = document.createElement('span');
        span.className = 'ip-item' + (entry.owner_enabled === false ? ' is-off' : '');
        var owner = document.createElement('span');
        owner.className = 'ip-owner' + (ownerLabel(entry) ? '' : ' is-missing');
        owner.textContent = ownerLabel(entry)
          ? (entry.owner_enabled === false ? ownerLabel(entry) + ' (off)' : ownerLabel(entry))
          : 'sin usuario';
        var txt = document.createElement('span');
        txt.textContent = '· ' + entry.ip;
        var del = document.createElement('button');
        del.type = 'button';
        del.textContent = '×';
        del.title = 'Quitar ' + entry.ip;
        del.addEventListener('click', function () {
          if (ips.length <= 1) {
            setMsg('No puedes dejar la lista vacía. Añade otra IP con usuario antes de quitar esta.', false);
            return;
          }
          var prev = ips.slice();
          ips.splice(i, 1);
          persist('IP quitada.').then(function (ok) {
            if (!ok) {
              ips = prev;
              renderIps();
            }
          });
        });
        span.appendChild(owner);
        span.appendChild(txt);
        span.appendChild(del);
        listEl.appendChild(span);
      });
    }

    function setMsg(text, ok) {
      if (!msg) {
        return;
      }
      msg.textContent = text;
      msg.style.color = ok ? '#86efac' : '#fca5a5';
      if (text) {
        setTimeout(function () {
          msg.textContent = '';
        }, 4000);
      }
    }

    function selectedUser() {
      var id = userSel.value;
      if (!id) {
        return null;
      }
      var found = users.filter(function (u) {
        return String(u.id) === String(id);
      })[0];
      if (found) {
        return found;
      }
      var wrap = userSel.closest('[data-owner-picker]');
      var username = '';
      if (window.PartnerOwnerPicker && typeof window.PartnerOwnerPicker.getUsername === 'function') {
        username = window.PartnerOwnerPicker.getUsername(userSel);
      } else if (wrap && wrap.classList.contains('has-value')) {
        var lab = wrap.querySelector('.pd-owner-picker-btn-label');
        username = (lab && lab.textContent.trim()) || '';
      }
      return { id: parseInt(id, 10), username: username };
    }

    function persist(okText) {
      var missing = ips.filter(function (item) {
        var e = asEntry(item);
        return !e.ip || !e.user_id;
      });
      if (!ips.length) {
        setMsg('Añade al menos una IP vinculada a un usuario.', false);
        return Promise.resolve(false);
      }
      if (missing.length) {
        setMsg('Todas las IPs deben tener usuario dueño.', false);
        return Promise.resolve(false);
      }
      if (saving) {
        return Promise.resolve(false);
      }
      saving = true;
      addBtn.disabled = true;
      return fetch(base + '/admin/settings/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ enabled: chk.checked, ip_whitelist: ips }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, j: j };
          });
        })
        .then(function (res) {
          if (res.ok && res.j.data) {
            fillUsers(res.j.data.users || users);
            ips = (res.j.data.ip_whitelist || []).map(asEntry);
            renderIps();
            setMsg(okText || 'Guardado', true);
            return true;
          }
          setMsg((res.j.error && res.j.error.message) || 'Error al guardar', false);
          return false;
        })
        .catch(function () {
          setMsg('Error de conexión', false);
          return false;
        })
        .then(function (ok) {
          saving = false;
          addBtn.disabled = false;
          return ok;
        });
    }

    function load() {
      fetch(base + '/admin/settings/', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          var d = (j && j.data) || {};
          fillUsers(d.users || []);
          ips = (d.ip_whitelist || []).map(asEntry);
          chk.checked = !!d.enabled;
          var ipEl = document.getElementById('clientIp');
          if (ipEl) {
            ipEl.textContent = d.client_ip || '?';
          }
          renderIps();
        })
        .catch(function () {
          setMsg('No se pudo cargar la configuración', false);
        });
    }

    addBtn.addEventListener('click', function () {
      var v = (input.value || '').trim();
      var owner = selectedUser();
      if (!v) {
        setMsg('Escribe la IP o el rango CIDR.', false);
        return;
      }
      if (!owner) {
        setMsg('Elige el usuario dueño de esa IP.', false);
        return;
      }
      var next = { ip: v, user_id: owner.id, username: owner.username };
      var prev = ips.slice();
      var idx = -1;
      ips.forEach(function (item, i) {
        if (asEntry(item).ip === v) {
          idx = i;
        }
      });
      if (idx === -1) {
        ips.push(next);
      } else {
        ips[idx] = next;
      }
      persist('IP añadida.').then(function (ok) {
        if (ok) {
          input.value = '';
          userSel.value = '';
          if (window.PartnerOwnerPicker) {
            window.PartnerOwnerPicker.clear(userSel);
          }
        } else {
          ips = prev;
          renderIps();
        }
      });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });
    chk.addEventListener('change', function () {
      if (!ips.length) {
        return;
      }
      persist(chk.checked ? 'API activa.' : 'API desactivada.');
    });

    renderIps();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPartnerApiDocsAdmin);
  } else {
    initPartnerApiDocsAdmin();
  }
})();
