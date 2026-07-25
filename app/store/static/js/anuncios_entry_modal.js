/**
 * Modal de anuncios al ingresar (tienda / licencias / códigos / sub-usuarios).
 * Flechas + puntos si hay varios; checkbox "no volver a mostrar" por anuncio
 * (compartido en todas las plantillas del mismo usuario).
 */
(function () {
  'use strict';

  var ROTATE_MS = 5000;
  var HOLD_MS = 280;
  var STORAGE_KEY = 'anuncio_entry_dismissed_ids';
  var STAGE_SHADOW_CSS =
    ':host{display:block;}' +
    'img{max-width:100%;height:auto;border-radius:8px;}' +
    'a{color:inherit;}';

  /** Aísla <style> del HTML del anuncio para que no afecte el resto de la página. */
  function setStageHtml(host, html) {
    if (!host) return;
    var shadow = host.shadowRoot;
    if (!shadow) {
      shadow = host.attachShadow({ mode: 'open' });
    }
    shadow.innerHTML = '<style>' + STAGE_SHADOW_CSS + '</style>' + (html || '');
  }

  /** Misma clave en tienda / licencias / códigos / sub-usuarios (por usuario). */
  function resolveUserId() {
    var selectors = [
      '#anuncioEntryDismissScope[data-user-id]',
      '#storeFrontPrefsScope[data-user-id]',
      '#codigosViewPrefsScope[data-user-id]',
      '#subuser-management-container[data-user-id]',
      '[data-anuncio-user-id]',
      'body[data-user-id]',
    ];
    var i;
    var el;
    var uid;
    for (i = 0; i < selectors.length; i++) {
      el = document.querySelector(selectors[i]);
      if (!el) continue;
      uid = (
        el.getAttribute('data-user-id') ||
        el.getAttribute('data-anuncio-user-id') ||
        ''
      ).trim();
      if (uid && uid !== 'anon') return uid;
    }
    el = document.querySelector('[data-user-id]');
    if (el) {
      uid = (el.getAttribute('data-user-id') || '').trim();
      if (uid && uid !== 'anon' && /^\d+$/.test(uid)) return uid;
    }
    return '';
  }

  function storageKeys() {
    var uid = resolveUserId();
    var keys = [STORAGE_KEY];
    if (uid) keys.unshift(STORAGE_KEY + '_' + uid);
    return keys;
  }

  function readDismissed() {
    var merged = [];
    var seen = {};
    storageKeys().forEach(function (key) {
      try {
        var raw = localStorage.getItem(key);
        var arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return;
        arr.forEach(function (id) {
          var sid = String(id);
          if (!sid || seen[sid]) return;
          seen[sid] = true;
          merged.push(sid);
        });
      } catch (e) {}
    });
    return merged;
  }

  function writeDismissed(ids) {
    var payload = JSON.stringify((ids || []).map(String));
    storageKeys().forEach(function (key) {
      try {
        localStorage.setItem(key, payload);
      } catch (e) {}
    });
  }

  function isDismissed(id) {
    return readDismissed().indexOf(String(id)) !== -1;
  }

  function dismissId(id) {
    var ids = readDismissed();
    var sid = String(id);
    if (ids.indexOf(sid) === -1) {
      ids.push(sid);
      writeDismissed(ids);
    }
  }

  if (!document.getElementById('anuncioEntryFontLink')) {
    var fontLink = document.createElement('link');
    fontLink.id = 'anuncioEntryFontLink';
    fontLink.rel = 'stylesheet';
    fontLink.href =
      'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Manrope:wght@500;700;800&display=swap';
    document.head.appendChild(fontLink);
  }

  if (!document.getElementById('anuncioEntryStyles')) {
    var st = document.createElement('style');
    st.id = 'anuncioEntryStyles';
    st.textContent =
      'body.anuncio-entry-open{overflow:hidden;}' +
      '.anuncio-entry-overlay{position:fixed;inset:0;z-index:10050;background:rgba(18,24,32,.72);' +
      'display:flex;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box;' +
      'backdrop-filter:blur(3px);animation:anuncioEntryFade .28s ease;}' +
      '@keyframes anuncioEntryFade{from{opacity:0}to{opacity:1}}' +
      '@keyframes anuncioEntryPop{from{opacity:0;transform:translateY(14px) scale(.96)}' +
      'to{opacity:1;transform:translateY(0) scale(1)}}' +
      '.anuncio-entry-modal{--anuncio-ink:#121820;--anuncio-panel:#1c2433;--anuncio-panel-2:#2a3448;' +
      '--anuncio-accent:#f0a14a;--anuncio-accent-2:#ffd89a;--anuncio-soft:#f4f7fb;' +
      'position:relative;width:min(420px,94vw);max-height:min(86vh,760px);overflow:auto;' +
      'border-radius:18px;color:var(--anuncio-soft);' +
      'border:1px solid rgba(240,161,74,.28);' +
      'background:radial-gradient(120% 80% at 100% 0%,rgba(240,161,74,.16),transparent 55%),' +
      'linear-gradient(165deg,var(--anuncio-panel-2),var(--anuncio-panel) 52%,var(--anuncio-ink));' +
      'box-shadow:0 22px 50px rgba(18,24,32,.42);' +
      'animation:anuncioEntryPop .34s cubic-bezier(.2,.8,.2,1);font-family:Manrope,system-ui,sans-serif;}' +
      '.anuncio-entry-zig{height:10px;background:repeating-linear-gradient(135deg,var(--anuncio-accent) 0 11px,var(--anuncio-ink) 11px 22px);' +
      'flex-shrink:0;}' +
      '.anuncio-entry-close{position:absolute;top:.7rem;right:.7rem;z-index:3;width:2.1rem;height:2.1rem;' +
      'border:none;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;' +
      'display:inline-flex;align-items:center;justify-content:center;font-size:1rem;line-height:1;' +
      'backdrop-filter:blur(4px);}' +
      '.anuncio-entry-close:hover{background:var(--anuncio-accent);color:#1c2433;}' +
      '.anuncio-entry-hero{display:flex;align-items:center;justify-content:center;gap:.5rem;' +
      'padding:1.2rem 1.15rem .45rem;text-align:left;}' +
      '.anuncio-entry-kicker{margin:0;font-family:"Bebas Neue",Impact,sans-serif;letter-spacing:.08em;' +
      'font-size:clamp(2rem,7vw,2.85rem);line-height:.9;color:var(--anuncio-accent);' +
      'text-shadow:none;}' +
      '.anuncio-entry-icon-wrap{flex:0 0 auto;width:40px;height:40px;border-radius:50%;' +
      'display:grid;place-items:center;position:relative;' +
      'background:linear-gradient(145deg,#ffd89a,var(--anuncio-accent) 55%,#e8892a);' +
      'box-shadow:0 2px 8px rgba(18,24,32,.28);' +
      'animation:anuncioPulse 2.4s ease-in-out infinite;}' +
      '@keyframes anuncioPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}' +
      '.anuncio-entry-icon-wrap i{font-size:1rem;color:#1c2433;}' +
      '.anuncio-entry-carousel{display:flex;align-items:stretch;gap:.35rem;padding:.35rem .7rem 0;}' +
      '.anuncio-entry-stage{flex:1 1 auto;min-width:0;min-height:4.5rem;padding:.85rem .9rem;border-radius:12px;' +
      'background:rgba(255,255,255,.07);border:1px solid rgba(244,247,251,.14);color:var(--anuncio-soft);' +
      'word-break:break-word;user-select:none;-webkit-user-select:none;font-size:1rem;line-height:1.45;' +
      'text-align:center;}' +
      '.anuncio-entry-arrow{flex:0 0 auto;align-self:center;width:2.25rem;height:2.25rem;' +
      'border:1.5px solid rgba(244,247,251,.22);border-radius:999px;background:rgba(255,255,255,.08);' +
      'color:var(--anuncio-soft);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;' +
      'line-height:1;}' +
      '.anuncio-entry-arrow:hover{background:var(--anuncio-accent);border-color:var(--anuncio-accent);color:#1c2433;}' +
      '.anuncio-entry-arrow:active{transform:scale(.96);}' +
      '.anuncio-entry-dots{display:flex;justify-content:center;align-items:center;gap:.45rem;' +
      'margin:.55rem 0 .2rem;min-height:1rem;}' +
      '.anuncio-entry-dot{width:.55rem;height:.55rem;padding:0;border:none;border-radius:999px;' +
      'background:rgba(244,247,251,.28);cursor:pointer;transition:background .15s ease,transform .15s ease;}' +
      '.anuncio-entry-dot:hover{background:rgba(244,247,251,.5);}' +
      '.anuncio-entry-dot.is-active{background:var(--anuncio-accent);transform:scale(1.2);}' +
      '.anuncio-entry-dismiss{display:flex;align-items:center;justify-content:center;gap:.45rem;' +
      'margin:.45rem .85rem .55rem;padding:.45rem .55rem;border-radius:10px;' +
      'background:rgba(255,255,255,.06);border:1px solid rgba(244,247,251,.12);cursor:pointer;' +
      'user-select:none;font-size:.82rem;font-weight:600;color:rgba(244,247,251,.92);}' +
      '.anuncio-entry-dismiss:hover{background:rgba(255,255,255,.1);}' +
      '.anuncio-entry-dismiss input{width:1rem;height:1rem;margin:0;accent-color:var(--anuncio-accent);cursor:pointer;flex-shrink:0;}' +
      '.anuncio-entry-modal--paused{outline:2px dashed var(--anuncio-accent);outline-offset:3px;}' +
      '.anuncio-entry-modal--single .anuncio-entry-arrow,' +
      '.anuncio-entry-modal--single .anuncio-entry-dots{display:none!important;}';
    document.head.appendChild(st);
  }

  function createModalShell(multi) {
    var overlay = document.createElement('div');
    overlay.id = 'anuncioEntryOverlay';
    overlay.className = 'anuncio-entry-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Anuncios');

    var modal = document.createElement('div');
    modal.className = 'anuncio-entry-modal' + (multi ? '' : ' anuncio-entry-modal--single');

    var zigTop = document.createElement('div');
    zigTop.className = 'anuncio-entry-zig';
    zigTop.setAttribute('aria-hidden', 'true');

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'anuncio-entry-close';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

    var hero = document.createElement('div');
    hero.className = 'anuncio-entry-hero';
    hero.innerHTML =
      '<div class="anuncio-entry-icon-wrap" aria-hidden="true"><i class="fas fa-bullhorn"></i></div>' +
      '<p class="anuncio-entry-kicker">ANUNCIO</p>';

    var carousel = document.createElement('div');
    carousel.className = 'anuncio-entry-carousel';

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'anuncio-entry-arrow anuncio-entry-arrow--prev';
    prevBtn.setAttribute('aria-label', 'Anuncio anterior');
    prevBtn.innerHTML = '<i class="fas fa-chevron-left" aria-hidden="true"></i>';

    var stage = document.createElement('div');
    stage.className = 'anuncio-entry-stage';
    stage.id = 'anuncioEntryStage';

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'anuncio-entry-arrow anuncio-entry-arrow--next';
    nextBtn.setAttribute('aria-label', 'Anuncio siguiente');
    nextBtn.innerHTML = '<i class="fas fa-chevron-right" aria-hidden="true"></i>';

    carousel.appendChild(prevBtn);
    carousel.appendChild(stage);
    carousel.appendChild(nextBtn);

    var dots = document.createElement('div');
    dots.className = 'anuncio-entry-dots';
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', 'Anuncios');

    var dismissLabel = document.createElement('label');
    dismissLabel.className = 'anuncio-entry-dismiss';
    dismissLabel.setAttribute('for', 'anuncioEntryDismissCb');
    var dismissCb = document.createElement('input');
    dismissCb.type = 'checkbox';
    dismissCb.id = 'anuncioEntryDismissCb';
    dismissCb.autocomplete = 'off';
    var dismissText = document.createElement('span');
    dismissText.textContent = 'No volver a mostrar este anuncio';
    dismissLabel.appendChild(dismissCb);
    dismissLabel.appendChild(dismissText);

    var zigBot = document.createElement('div');
    zigBot.className = 'anuncio-entry-zig';
    zigBot.setAttribute('aria-hidden', 'true');

    modal.appendChild(zigTop);
    modal.appendChild(closeBtn);
    modal.appendChild(hero);
    modal.appendChild(carousel);
    modal.appendChild(dots);
    modal.appendChild(dismissLabel);
    modal.appendChild(zigBot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    return {
      overlay: overlay,
      modal: modal,
      closeBtn: closeBtn,
      stage: stage,
      prevBtn: prevBtn,
      nextBtn: nextBtn,
      dots: dots,
      dismissCb: dismissCb,
    };
  }

  function openWith(items) {
    if (!items || !items.length) return;

    var ui = createModalShell(items.length > 1);
    var idx = 0;
    var timer = null;
    var paused = false;
    var holdTimer = null;
    var holding = false;
    var keyHandler = null;

    function multi() {
      return items.length > 1;
    }

    function syncSingleClass() {
      ui.modal.classList.toggle('anuncio-entry-modal--single', !multi());
    }

    function renderDots() {
      while (ui.dots.firstChild) ui.dots.removeChild(ui.dots.firstChild);
      if (!multi()) return;
      items.forEach(function (_, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'anuncio-entry-dot' + (i === idx ? ' is-active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-label', 'Anuncio ' + (i + 1));
        btn.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        btn.setAttribute('data-index', String(i));
        ui.dots.appendChild(btn);
      });
    }

    function syncDots() {
      var dots = ui.dots.querySelectorAll('.anuncio-entry-dot');
      dots.forEach(function (dot, i) {
        var on = i === idx;
        dot.classList.toggle('is-active', on);
        dot.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function syncDismissCb() {
      if (!ui.dismissCb || !items[idx]) return;
      ui.dismissCb.checked = false;
    }

    function show(i, opts) {
      if (!items.length) {
        close();
        return;
      }
      opts = opts || {};
      idx = ((i % items.length) + items.length) % items.length;
      setStageHtml(ui.stage, items[idx].html || '');
      syncDots();
      syncDismissCb();
      if (opts.resetTimer && !paused && multi()) start();
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function start() {
      stop();
      if (paused || !multi()) return;
      timer = setInterval(function () {
        if (!paused) show(idx + 1);
      }, ROTATE_MS);
    }

    function close() {
      stop();
      if (holdTimer) clearTimeout(holdTimer);
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      if (ui.overlay && ui.overlay.parentNode) {
        ui.overlay.parentNode.removeChild(ui.overlay);
      }
      document.body.classList.remove('anuncio-entry-open');
    }

    function dismissCurrent() {
      var cur = items[idx];
      if (!cur || cur.id == null) return;
      dismissId(cur.id);
      items.splice(idx, 1);
      if (!items.length) {
        close();
        return;
      }
      if (idx >= items.length) idx = 0;
      syncSingleClass();
      renderDots();
      show(idx, { resetTimer: true });
    }

    ui.closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    ui.overlay.addEventListener('click', function (e) {
      if (e.target === ui.overlay) close();
    });
    ui.modal.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    keyHandler = function (e) {
      if (e.key === 'Escape') {
        close();
      } else if (multi() && e.key === 'ArrowLeft') {
        e.preventDefault();
        show(idx - 1, { resetTimer: true });
      } else if (multi() && e.key === 'ArrowRight') {
        e.preventDefault();
        show(idx + 1, { resetTimer: true });
      }
    };
    document.addEventListener('keydown', keyHandler);

    ui.prevBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (multi()) show(idx - 1, { resetTimer: true });
    });
    ui.nextBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (multi()) show(idx + 1, { resetTimer: true });
    });
    ui.dots.addEventListener('click', function (e) {
      var dot = e.target.closest('.anuncio-entry-dot');
      if (!dot) return;
      e.preventDefault();
      e.stopPropagation();
      var i = parseInt(dot.getAttribute('data-index'), 10);
      if (!isNaN(i)) show(i, { resetTimer: true });
    });

    ui.dismissCb.addEventListener('change', function () {
      if (ui.dismissCb.checked) dismissCurrent();
    });

    function onDown(e) {
      if (
        e.target.closest &&
        e.target.closest('.anuncio-entry-arrow, .anuncio-entry-dot, .anuncio-entry-dismiss')
      ) {
        return;
      }
      holding = false;
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        holding = true;
        paused = true;
        stop();
        ui.modal.classList.add('anuncio-entry-modal--paused');
      }, HOLD_MS);
    }
    function onUp() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (holding) {
        holding = false;
        paused = false;
        ui.modal.classList.remove('anuncio-entry-modal--paused');
        start();
      }
    }
    ['pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) {
      ui.stage.addEventListener(ev, onDown, { passive: true });
    });
    ['pointerup', 'pointercancel', 'mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(
      function (ev) {
        ui.stage.addEventListener(ev, onUp, { passive: true });
      }
    );

    document.body.classList.add('anuncio-entry-open');
    syncSingleClass();
    renderDots();
    show(0);
    start();
  }

  function viewerLooksLoggedIn() {
    var flagged = document.querySelector('[data-is-user-logged-in]');
    if (flagged && flagged.getAttribute('data-is-user-logged-in') === 'false') {
      return false;
    }
    var scope = document.getElementById('anuncioEntryDismissScope');
    var uid = scope && (scope.getAttribute('data-user-id') || '').trim();
    return !!(uid && uid !== 'anon' && /^\d+$/.test(uid));
  }

  if (!viewerLooksLoggedIn()) {
    return;
  }

  fetch('/tienda/api/anuncios/on-entry', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      var list = (data && data.announcements) || [];
      list = list.filter(function (a) {
        return a && a.id != null && !isDismissed(a.id);
      });
      if (list.length) openWith(list);
    })
    .catch(function () {});
})();
