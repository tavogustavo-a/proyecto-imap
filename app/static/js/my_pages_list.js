(function () {
  const searchForm = document.getElementById("searchMyPagesForm");
  const searchInput = document.getElementById("searchMyPagesInput");
  const clearBtn = document.getElementById("searchMyPagesClearBtn");
  const track = document.getElementById("myPagesListTrack");
  const noMatchMsg = document.getElementById("myPagesNoMatchMsg");

  if (!searchForm || !searchInput || !track) return;

  function syncClearBtn() {
    if (clearBtn) {
      clearBtn.classList.toggle("show", !!searchInput.value.trim());
    }
  }

  function normalizeQuery(q) {
    return (q || "").trim().toLowerCase();
  }

  function filterPages() {
    const q = normalizeQuery(searchInput.value);
    const items = track.querySelectorAll(".my-pages-item");
    let visible = 0;

    items.forEach(function (el) {
      const route = el.getAttribute("data-route") || "";
      const text = (el.textContent || "").toLowerCase();
      const match = !q || route.indexOf(q) !== -1 || text.indexOf(q) !== -1;
      el.classList.toggle("my-pages-item--hidden", !match);
      if (match) visible += 1;
    });

    if (noMatchMsg) {
      noMatchMsg.classList.toggle("hidden", visible > 0 || items.length === 0);
    }
    syncClearBtn();
  }

  let searchTimeout = null;
  searchInput.addEventListener("input", function () {
    syncClearBtn();
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(filterPages, 200);
  });
  searchInput.addEventListener("search", function () {
    filterPages();
    syncClearBtn();
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", function (e) {
      e.preventDefault();
      searchInput.value = "";
      filterPages();
      searchInput.focus();
    });
  }

  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
  });

  syncClearBtn();
})();
