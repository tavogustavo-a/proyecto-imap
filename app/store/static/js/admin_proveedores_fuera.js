/* Panel «proveedores fuera»: integración API Partner Multiplataforma. */
(function () {
  'use strict';

  var root = document.getElementById('mpApiRoot');
  if (!root) return;

  var urls = {
    status: root.dataset.urlStatus,
    save: root.dataset.urlSave,
    test: root.dataset.urlTest,
    platforms: root.dataset.urlPlatforms,
    links: root.dataset.urlLinks,
    threshold: root.dataset.urlThreshold
  };

  var lowBalanceThreshold = 0;

  // Vínculos plan→producto y catálogo de productos propios.
  var mpLinks = {};    // { planId: {license_id, plan_name, platform_name, ...} }
  var mpProducts = []; // [{license_id, product_id, name}]

  var els = {
    chip: document.getElementById('mpApiStatusChip'),
    username: document.getElementById('mpApiUsername'),
    password: document.getElementById('mpApiPassword'),
    saveBtn: document.getElementById('mpApiSaveBtn'),
    testBtn: document.getElementById('mpApiTestBtn'),
    message: document.getElementById('mpApiMessage'),
    profileCard: document.getElementById('mpApiProfileCard'),
    profileUsername: document.getElementById('mpProfileUsername'),
    profileBalance: document.getElementById('mpProfileBalance'),
    profileCommission: document.getElementById('mpProfileCommission'),
    profileCurrency: document.getElementById('mpProfileCurrency'),
    lowBalanceWarn: document.getElementById('mpApiLowBalanceWarn'),
    thresholdInput: document.getElementById('mpApiThresholdInput'),
    thresholdSaveBtn: document.getElementById('mpApiThresholdSaveBtn'),
    loadPlatformsBtn: document.getElementById('mpApiLoadPlatformsBtn'),
    platformsWrap: document.getElementById('mpApiPlatformsWrap'),
    marketWrap: document.getElementById('mpApiMarketWrap'),
    marketName: document.getElementById('mpApiMarketName'),
    marketTableWrap: document.getElementById('mpApiMarketTableWrap')
  };

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    var headers = { 'X-CSRFToken': csrfToken() };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    }).then(function (resp) {
      return resp.json().catch(function () {
        return { success: false, error: 'Respuesta inválida del servidor (HTTP ' + resp.status + ').' };
      });
    });
  }

  function showMessage(text, kind) {
    els.message.textContent = text;
    els.message.className = 'mp-api-message mp-api-message--' + (kind || 'info');
  }

  function hideMessage() {
    els.message.className = 'mp-api-message hidden';
  }

  function setChip(state, label) {
    els.chip.textContent = label;
    els.chip.className = 'mp-api-chip mp-api-chip--' + state;
  }

  function setBusy(btn, busy) {
    btn.disabled = busy;
    btn.classList.toggle('mp-api-btn-busy', busy);
  }

  function fmtMoney(value, prefix) {
    if (value === null || value === undefined || value === '') return '—';
    var num = Number(value);
    if (isNaN(num)) return String(value);
    return num.toLocaleString('es-CO') + (prefix ? ' ' + prefix : '');
  }

  // Un título (Conexión API) contrae todo el proveedor, incluida
  // Plataformas y stock. Un proveedor nuevo: data-mp-collapse-key en el wrapper.
  var COLLAPSE_STORAGE = 'proveedores_fuera_cards_collapsed_v1';

  function readCollapsedMap() {
    try {
      var raw = localStorage.getItem(COLLAPSE_STORAGE);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeCollapsedMap(map) {
    try {
      localStorage.setItem(COLLAPSE_STORAGE, JSON.stringify(map));
    } catch (e) { /* quota / modo privado */ }
  }

  function applyProviderCollapsed(provider, collapsed) {
    provider.classList.toggle('is-collapsed', !!collapsed);
    var toggle = provider.querySelector(':scope > .mp-api-card > .mp-api-card-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var rest = provider.querySelector(':scope > .mp-api-provider-rest');
    if (rest) rest.hidden = !!collapsed;
    var connBody = provider.querySelector(':scope > .mp-api-card > .mp-api-card-body');
    if (connBody) connBody.hidden = !!collapsed;
  }

  function initCollapsibleCards() {
    var map = readCollapsedMap();
    var providers = root.querySelectorAll('.mp-api-provider[data-mp-collapse-key]');
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      var keyInit = (p.getAttribute('data-mp-collapse-key') || '').trim();
      if (keyInit) applyProviderCollapsed(p, !!map[keyInit]);
    }

    root.addEventListener('click', function (ev) {
      if (ev.target.closest('.mp-api-title-btn, .mp-api-actions, .mp-api-form-row, .mp-api-profile-block, a, input, select, textarea, label')) return;
      var toggle = ev.target.closest('.mp-api-card-toggle');
      if (!toggle || !root.contains(toggle)) return;
      var provider = toggle.closest('.mp-api-provider[data-mp-collapse-key]');
      if (!provider) return;
      var key = (provider.getAttribute('data-mp-collapse-key') || '').trim();
      if (!key) return;
      ev.preventDefault();
      ev.stopPropagation();
      var next = !provider.classList.contains('is-collapsed');
      applyProviderCollapsed(provider, next);
      var saved = readCollapsedMap();
      if (next) saved[key] = true;
      else delete saved[key];
      writeCollapsedMap(saved);
    });

    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var toggle = ev.target.closest && ev.target.closest('.mp-api-card-toggle');
      if (!toggle || !root.contains(toggle)) return;
      if (ev.target.closest('button, a, input, select, textarea')) return;
      ev.preventDefault();
      toggle.click();
    });
  }

  initCollapsibleCards();

  function updateLowBalanceWarn(balance) {
    if (!els.lowBalanceWarn) return;
    var num = Number(balance);
    if (!isNaN(num) && lowBalanceThreshold > 0 && num < lowBalanceThreshold) {
      els.lowBalanceWarn.textContent =
        'Saldo bajo: ' + fmtMoney(num, '') + ' (umbral ' + fmtMoney(lowBalanceThreshold, '') + '). Recarga para no perder ventas.';
      els.lowBalanceWarn.classList.remove('hidden');
    } else {
      els.lowBalanceWarn.classList.add('hidden');
    }
  }

  var lastProfileBalance = null;

  function renderProfile(profile) {
    els.profileCard.classList.remove('hidden');
    els.profileUsername.textContent = profile.username || '—';
    els.profileBalance.textContent = fmtMoney(profile.balance, profile.currency_prefix);
    els.profileCommission.textContent = fmtMoney(profile.commission, profile.currency_prefix);
    els.profileCurrency.textContent = profile.currency_prefix || '—';
    lastProfileBalance = profile.balance;
    updateLowBalanceWarn(profile.balance);
    setChip('ok', 'Conectado');
  }

  // ------------------------- estado inicial -------------------------
  apiFetch(urls.status).then(function (data) {
    if (!data.success) return;
    if (data.configured) {
      setChip('saved', 'Credenciales guardadas');
      if (data.username) els.username.value = data.username;
    }
    if (data.low_balance_threshold !== undefined && els.thresholdInput) {
      lowBalanceThreshold = Number(data.low_balance_threshold) || 0;
      els.thresholdInput.value = lowBalanceThreshold;
    }
  });

  // ------------------------- umbral de saldo bajo -------------------------
  if (els.thresholdSaveBtn) {
    els.thresholdSaveBtn.addEventListener('click', function () {
      var value = Number(els.thresholdInput.value);
      if (isNaN(value) || value < 0) {
        showMessage('Escribe un umbral válido (0 desactiva el aviso).', 'error');
        return;
      }
      hideMessage();
      setBusy(els.thresholdSaveBtn, true);
      apiFetch(urls.threshold, { method: 'POST', body: { threshold: value } })
        .then(function (data) {
          if (!data.success) {
            showMessage(data.error || 'No se pudo guardar el umbral.', 'error');
            return;
          }
          lowBalanceThreshold = Number(data.low_balance_threshold) || 0;
          els.thresholdInput.value = lowBalanceThreshold;
          updateLowBalanceWarn(lastProfileBalance);
          showMessage('Umbral de saldo bajo guardado.', 'ok');
        })
        .finally(function () { setBusy(els.thresholdSaveBtn, false); });
    });
  }

  // ------------------------- guardar y probar -------------------------
  els.saveBtn.addEventListener('click', function () {
    var username = els.username.value.trim();
    var password = els.password.value;
    if (!username || !password) {
      showMessage('Escribe usuario y contraseña.', 'error');
      return;
    }
    hideMessage();
    setBusy(els.saveBtn, true);
    apiFetch(urls.save, { method: 'POST', body: { username: username, password: password } })
      .then(function (data) {
        if (!data.success) {
          showMessage(data.error || 'No se pudo guardar.', 'error');
          return;
        }
        els.password.value = '';
        if (data.profile) {
          renderProfile(data.profile);
          showMessage('Credenciales guardadas y conexión verificada.', 'ok');
        } else {
          setChip('saved', 'Credenciales guardadas');
          showMessage('Credenciales guardadas, pero la prueba falló: ' + (data.test_error || 'error desconocido'), 'warn');
        }
      })
      .finally(function () { setBusy(els.saveBtn, false); });
  });

  // ------------------------- probar conexión -------------------------
  els.testBtn.addEventListener('click', function () {
    hideMessage();
    setBusy(els.testBtn, true);
    apiFetch(urls.test, { method: 'POST', body: {} })
      .then(function (data) {
        if (data.success && data.profile) {
          renderProfile(data.profile);
          showMessage('Conexión correcta.', 'ok');
        } else {
          setChip('err', 'Error');
          showMessage(data.error || 'No se pudo conectar.', 'error');
        }
      })
      .finally(function () { setBusy(els.testBtn, false); });
  });

  // ------------------------- plataformas y mercado -------------------------
  function extractList(data, keys) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]])) return data[keys[i]];
    }
    // Primer array que aparezca en el objeto
    var found = [];
    Object.keys(data).some(function (k) {
      if (Array.isArray(data[k])) { found = data[k]; return true; }
      return false;
    });
    return found;
  }

  function productNameByLicenseId(licenseId) {
    for (var i = 0; i < mpProducts.length; i++) {
      if (Number(mpProducts[i].license_id) === Number(licenseId)) return mpProducts[i].name;
    }
    return 'Producto ' + licenseId;
  }

  function platformLinkedSummary(platformId) {
    var names = [];
    Object.keys(mpLinks).forEach(function (planId) {
      var info = mpLinks[planId] || {};
      if (Number(info.platform_id) === Number(platformId) && info.license_id) {
        names.push(productNameByLicenseId(info.license_id));
      }
    });
    return names;
  }

  function renderPlatforms(list) {
    els.platformsWrap.innerHTML = '';
    if (!list.length) {
      els.platformsWrap.innerHTML = '<p class="text-muted mb-0">La API no devolvió plataformas.</p>';
      return;
    }
    list.forEach(function (p) {
      var id = p.id !== undefined ? p.id : p.platform_id;
      var name = p.name || p.platform_name || ('Plataforma ' + id);
      var row = document.createElement('div');
      row.className = 'mp-api-platform-row';
      row.dataset.platformId = id;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-panel btn-blue mp-api-platform-btn';
      btn.textContent = name;
      btn.addEventListener('click', function () { loadMarket(id, name, btn); });
      row.appendChild(btn);

      var linked = document.createElement('span');
      linked.className = 'mp-api-platform-linked';
      row.appendChild(linked);

      els.platformsWrap.appendChild(row);
    });
    refreshPlatformLinkedTags();
  }

  function refreshPlatformLinkedTags() {
    var rows = els.platformsWrap.querySelectorAll('.mp-api-platform-row');
    rows.forEach(function (row) {
      var span = row.querySelector('.mp-api-platform-linked');
      if (!span) return;
      var names = platformLinkedSummary(row.dataset.platformId);
      if (names.length) {
        span.textContent = '→ ' + names.join(', ');
        span.classList.add('mp-api-platform-linked--on');
      } else {
        span.textContent = 'sin vincular';
        span.classList.remove('mp-api-platform-linked--on');
      }
    });
  }

  function loadLinks() {
    if (!urls.links) return Promise.resolve();
    return apiFetch(urls.links).then(function (data) {
      if (data && data.success) {
        mpLinks = data.links || {};
        mpProducts = data.products || [];
      }
    });
  }

  els.loadPlatformsBtn.addEventListener('click', function () {
    hideMessage();
    setBusy(els.loadPlatformsBtn, true);
    els.platformsWrap.innerHTML = '<p class="text-muted mb-0">Consultando…</p>';
    Promise.all([apiFetch(urls.platforms), loadLinks()])
      .then(function (results) {
        var data = results[0];
        if (!data.success) {
          els.platformsWrap.innerHTML = '';
          showMessage(data.error || 'No se pudieron cargar las plataformas.', 'error');
          return;
        }
        renderPlatforms(extractList(data.data, ['platforms']));
      })
      .finally(function () { setBusy(els.loadPlatformsBtn, false); });
  });

  function loadMarket(platformId, name, btn) {
    hideMessage();
    setBusy(btn, true);
    var url = urls.platforms.replace(/\/?$/, '') + '/' + encodeURIComponent(platformId) + '/market';
    apiFetch(url)
      .then(function (data) {
        if (!data.success) {
          showMessage(data.error || 'No se pudo cargar el mercado.', 'error');
          return;
        }
        renderMarket(platformId, name, extractList(data.data, ['plans', 'market']));
      })
      .finally(function () { setBusy(btn, false); });
  }

  function planDays(plan, planName) {
    var d = plan.days !== undefined ? plan.days : (plan.duration_days !== undefined ? plan.duration_days : plan.duration);
    d = Number(d);
    if (d > 0) return d;
    var n = String(planName || '').toLowerCase();
    if (/\b2\s*mes/.test(n) || /60\s*d/.test(n)) return 60;
    return 30;
  }

  function licenseIdsUsedByOtherPlans(planId) {
    var used = {};
    Object.keys(mpLinks).forEach(function (pid) {
      if (String(pid) === String(planId)) return;
      var lid = (mpLinks[pid] || {}).license_id;
      if (lid) used[Number(lid)] = true;
    });
    return used;
  }

  function buildLinkSelect(planId) {
    var current = (mpLinks[String(planId)] || {}).license_id || '';
    var used = licenseIdsUsedByOtherPlans(planId);
    var sel = document.createElement('select');
    sel.className = 'mp-api-link-select';
    sel.dataset.planId = planId;

    var optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = '— Sin vincular —';
    sel.appendChild(optNone);

    mpProducts.forEach(function (prod) {
      var opt = document.createElement('option');
      opt.value = prod.license_id;
      opt.textContent = prod.name;
      if (used[Number(prod.license_id)]) {
        opt.disabled = true;
        opt.textContent = prod.name + ' (ya vinculado)';
      }
      if (Number(prod.license_id) === Number(current)) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function saveLink(sel, platformId, platformName, planName, days) {
    var planId = sel.dataset.planId;
    var licenseId = sel.value ? Number(sel.value) : null;
    sel.disabled = true;
    apiFetch(urls.links, {
      method: 'POST',
      body: {
        plan_id: Number(planId),
        license_id: licenseId,
        platform_id: Number(platformId),
        platform_name: platformName,
        plan_name: planName,
        days: days
      }
    })
      .then(function (data) {
        if (!data.success) {
          showMessage(data.error || 'No se pudo guardar el vínculo.', 'error');
          // Revertir al valor guardado
          var prev = (mpLinks[String(planId)] || {}).license_id || '';
          sel.value = prev ? String(prev) : '';
          return;
        }
        mpLinks = data.links || {};
        showMessage(licenseId
          ? ('Plan «' + planName + '» vinculado a «' + productNameByLicenseId(licenseId) + '».')
          : ('Plan «' + planName + '» desvinculado.'), 'ok');
        refreshPlatformLinkedTags();
        refreshMarketSelects();
      })
      .finally(function () { sel.disabled = false; });
  }

  function refreshMarketSelects() {
    // Rehacer estados disabled/selected según los vínculos actuales.
    var selects = els.marketTableWrap.querySelectorAll('select.mp-api-link-select');
    selects.forEach(function (sel) {
      var planId = sel.dataset.planId;
      var used = licenseIdsUsedByOtherPlans(planId);
      var current = (mpLinks[String(planId)] || {}).license_id || '';
      Array.prototype.forEach.call(sel.options, function (opt) {
        if (!opt.value) return;
        var base = opt.textContent.replace(/ \(ya vinculado\)$/, '');
        var isUsed = !!used[Number(opt.value)];
        opt.disabled = isUsed;
        opt.textContent = isUsed ? base + ' (ya vinculado)' : base;
      });
      sel.value = current ? String(current) : '';
    });
  }

  function renderMarket(platformId, platformName, plans) {
    els.marketWrap.classList.remove('hidden');
    els.marketName.textContent = 'Planes de ' + platformName;
    if (!plans.length) {
      els.marketTableWrap.innerHTML = '<p class="text-muted mb-0">Sin planes disponibles.</p>';
      return;
    }
    els.marketTableWrap.innerHTML = '';
    var table = document.createElement('table');
    table.className = 'mp-api-table';
    table.innerHTML = '<thead><tr><th>Plan</th><th>Precio</th><th>Stock</th><th>Vincular a producto</th></tr></thead>';
    var tbody = document.createElement('tbody');

    plans.forEach(function (plan) {
      var planId = plan.id !== undefined ? plan.id : plan.plan_id;
      var planName = plan.name || plan.plan_name || ('Plan ' + (planId || ''));
      var price = plan.price !== undefined ? plan.price : plan.unit_price;
      var stock = plan.stock !== undefined ? plan.stock : (plan.stock_available !== undefined ? plan.stock_available : '—');
      var days = planDays(plan, planName);

      var tr = document.createElement('tr');
      var tdName = document.createElement('td');
      tdName.textContent = String(planName);
      var tdPrice = document.createElement('td');
      tdPrice.textContent = fmtMoney(price, '');
      var tdStock = document.createElement('td');
      tdStock.textContent = String(stock);
      var tdLink = document.createElement('td');
      if (planId !== undefined && planId !== null) {
        var sel = buildLinkSelect(planId);
        sel.addEventListener('change', function () {
          saveLink(sel, platformId, platformName, String(planName), days);
        });
        tdLink.appendChild(sel);
      } else {
        tdLink.textContent = '—';
      }
      tr.appendChild(tdName);
      tr.appendChild(tdPrice);
      tr.appendChild(tdStock);
      tr.appendChild(tdLink);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    els.marketTableWrap.appendChild(table);
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
