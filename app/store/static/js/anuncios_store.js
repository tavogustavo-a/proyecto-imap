/**
 * Banner de anuncios en tienda: rotación 5s, flechas, puntos; clic sostenido pausa.
 */
(function () {
  'use strict';

  var root = document.getElementById('storeAnunciosPanel');
  var stage = document.getElementById('storeAnunciosStage');
  var prevBtn = document.getElementById('storeAnunciosPrev');
  var nextBtn = document.getElementById('storeAnunciosNext');
  var dotsEl = document.getElementById('storeAnunciosDots');
  if (!root || !stage) return;

  var items = [];
  var idx = 0;
  var timer = null;
  var paused = false;
  var holdTimer = null;
  var holding = false;
  var ROTATE_MS = 5000;
  var HOLD_MS = 280;
  var STAGE_SHADOW_CSS =
    ':host{display:block;}' +
    'img{max-width:100%;height:auto;border-radius:8px;}' +
    'a{color:inherit;}';

  /** Shadow DOM: el HTML del anuncio suele traer <style> (.container, .btn, etc.) que no debe filtrarse a la tienda. */
  function setStageHtml(html) {
    var shadow = stage.shadowRoot;
    if (!shadow) {
      shadow = stage.attachShadow({ mode: 'open' });
    }
    shadow.innerHTML = '<style>' + STAGE_SHADOW_CSS + '</style>' + (html || '');
  }

  function setNavVisible(multi) {
    [prevBtn, nextBtn, dotsEl].forEach(function (el) {
      if (!el) return;
      el.hidden = !multi;
      el.classList.toggle('d-none', !multi);
    });
    root.classList.toggle('store-anuncios--multi', !!multi);
  }

  function renderDots() {
    if (!dotsEl) return;
    while (dotsEl.firstChild) dotsEl.removeChild(dotsEl.firstChild);
    if (items.length < 2) return;
    items.forEach(function (_, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'store-anuncios-dot' + (i === idx ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-label', 'Anuncio ' + (i + 1));
      btn.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      btn.setAttribute('data-index', String(i));
      dotsEl.appendChild(btn);
    });
  }

  function syncDots() {
    if (!dotsEl) return;
    var dots = dotsEl.querySelectorAll('.store-anuncios-dot');
    dots.forEach(function (dot, i) {
      var on = i === idx;
      dot.classList.toggle('is-active', on);
      dot.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function showIndex(i, opts) {
    if (!items.length) return;
    opts = opts || {};
    idx = ((i % items.length) + items.length) % items.length;
    setStageHtml(items[idx].html || '');
    syncDots();
    if (opts.resetTimer && !paused && items.length > 1) {
      startTimer();
    }
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (paused || items.length < 2) return;
    timer = setInterval(function () {
      if (!paused) showIndex(idx + 1);
    }, ROTATE_MS);
  }

  function setPaused(v) {
    paused = !!v;
    root.classList.toggle('store-anuncios--paused', paused);
    if (paused) stopTimer();
    else startTimer();
  }

  function go(delta) {
    showIndex(idx + delta, { resetTimer: true });
  }

  function onPointerDown(e) {
    if (e.target.closest && e.target.closest('.store-anuncios-arrow, .store-anuncios-dot')) {
      return;
    }
    holding = false;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      holding = true;
      setPaused(true);
    }, HOLD_MS);
  }

  function onPointerUp() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (holding) {
      holding = false;
      setPaused(false);
    }
  }

  ['pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) {
    stage.addEventListener(
      ev,
      function (e) {
        if (ev === 'mousedown' && e.button !== 0) return;
        onPointerDown(e);
      },
      { passive: true }
    );
  });
  ['pointerup', 'pointercancel', 'mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(
    function (ev) {
      stage.addEventListener(ev, onPointerUp, { passive: true });
    }
  );

  if (prevBtn) {
    prevBtn.addEventListener('click', function (e) {
      e.preventDefault();
      go(-1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function (e) {
      e.preventDefault();
      go(1);
    });
  }
  if (dotsEl) {
    dotsEl.addEventListener('click', function (e) {
      var dot = e.target.closest('.store-anuncios-dot');
      if (!dot) return;
      var i = parseInt(dot.getAttribute('data-index'), 10);
      if (isNaN(i)) return;
      showIndex(i, { resetTimer: true });
    });
  }

  fetch('/tienda/api/anuncios/active', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      items = (data && data.announcements) || [];
      if (!items.length) {
        root.hidden = true;
        root.classList.add('d-none');
        return;
      }
      root.hidden = false;
      root.classList.remove('d-none');
      setNavVisible(items.length > 1);
      renderDots();
      showIndex(0);
      startTimer();
    })
    .catch(function () {
      root.hidden = true;
    });
})();
