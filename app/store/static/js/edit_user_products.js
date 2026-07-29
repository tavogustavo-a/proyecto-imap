function formatEditMoneyAmount(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) v = 0;
    v = Math.round(v * 100) / 100;
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return String(v);
}

function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf_token"]');
    return meta ? meta.getAttribute('content') : '';
}

let currentUserId = null;
let allEditProducts = [];
let editProductSearch = '';
let saveInFlight = null;
let saveQueued = false;

function getEditProductsFromDOM() {
    const rows = Array.from(
        document.querySelectorAll('#user-products-table tbody tr[data-product-id]')
    );
    return rows.map(function (tr) {
        return {
            tr: tr,
            name: (tr.querySelector('td')?.textContent || '').trim().toLowerCase(),
            id: tr.getAttribute('data-product-id'),
        };
    });
}

function renderEditProductsTable() {
    let filtered = allEditProducts;
    if (editProductSearch) {
        filtered = filtered.filter(function (p) {
            return p.name.includes(editProductSearch);
        });
    }
    allEditProducts.forEach(function (p) {
        if (filtered.includes(p)) {
            p.tr.classList.remove('d-none');
        } else {
            p.tr.classList.add('d-none');
        }
    });
}

function collectVisibleProductIds() {
    return Array.from(
        document.querySelectorAll('#user-products-table tbody tr[data-product-id]')
    )
        .filter(function (tr) {
            const checkbox = tr.querySelector('input[name^="visible_"]');
            return !!(checkbox && checkbox.checked);
        })
        .map(function (tr) {
            return parseInt(tr.getAttribute('data-product-id'), 10);
        })
        .filter(function (id) {
            return Number.isFinite(id) && id > 0;
        });
}

function collectDescuentosProductos(isCop) {
    const out = {};
    document
        .querySelectorAll('#user-products-table tbody tr[data-product-id]')
        .forEach(function (tr) {
            const prodId = parseInt(tr.getAttribute('data-product-id'), 10);
            if (!Number.isFinite(prodId) || prodId <= 0) return;
            const copInput = tr.querySelector('input[name^="discount_cop_extra_"]');
            const usdInput = tr.querySelector('input[name^="discount_usd_extra_"]');
            let cop = 0;
            let usd = 0;
            if (copInput) {
                const n = parseFloat(copInput.value || 0);
                cop = isNaN(n) ? 0 : Math.max(0, n);
            }
            if (usdInput) {
                const n = parseFloat(usdInput.value || 0);
                usd = isNaN(n) ? 0 : Math.max(0, Math.round(n * 100) / 100);
            }
            if (isCop) usd = 0;
            else cop = 0;
            out[String(prodId)] = { cop: cop, usd: usd };
        });
    return out;
}

document.addEventListener('DOMContentLoaded', function () {
    const userForm = document.getElementById('editUserProductsForm');
    if (userForm) {
        currentUserId = userForm.getAttribute('data-user-id');
        // Evita que Enter en búsqueda recargue la página sin guardar.
        userForm.addEventListener('submit', function (e) {
            e.preventDefault();
            saveProductsAutomatically();
        });
    }

    const tipoPrecioDisplay = document.getElementById('tipoPrecioDisplay');
    const tipoPrecio = tipoPrecioDisplay ? tipoPrecioDisplay.value.trim() : 'USD';
    const isCop = tipoPrecio === 'COP';

    allEditProducts = getEditProductsFromDOM();

    const searchInput = document.getElementById('searchProductInput');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            editProductSearch = searchInput.value.trim().toLowerCase();
            renderEditProductsTable();
        });
        searchInput.addEventListener('search', function () {
            if (this.value === '') {
                editProductSearch = '';
                renderEditProductsTable();
            }
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
        });
    }

    function updateProductTableByTipoPrecio() {
        document
            .querySelectorAll('#user-products-table tbody tr[data-product-id]')
            .forEach(function (tr) {
                const priceCop = tr.getAttribute('data-price-cop');
                const priceUsd = tr.getAttribute('data-price-usd');
                const tdAdicional = tr.children[2];
                const inputCop = tdAdicional.querySelector(
                    'input[name^="discount_cop_extra_"]'
                );
                const inputUsd = tdAdicional.querySelector(
                    'input[name^="discount_usd_extra_"]'
                );
                if (isCop) {
                    if (inputCop) inputCop.classList.remove('d-none');
                    if (inputUsd) {
                        inputUsd.classList.add('d-none');
                        inputUsd.value = 0;
                    }
                } else {
                    if (inputUsd) inputUsd.classList.remove('d-none');
                    if (inputCop) {
                        inputCop.classList.add('d-none');
                        inputCop.value = 0;
                    }
                }
                const tdFinal = tr.children[3];
                if (isCop) {
                    const finalCop =
                        parseFloat(priceCop) - parseFloat(inputCop?.value || 0);
                    tdFinal.textContent =
                        '$' +
                        formatEditMoneyAmount(Math.max(0, finalCop)) +
                        ' COP';
                } else {
                    const finalUsd =
                        parseFloat(priceUsd) - parseFloat(inputUsd?.value || 0);
                    tdFinal.textContent =
                        '$' +
                        formatEditMoneyAmount(Math.max(0, finalUsd)) +
                        ' USD';
                }
            });
    }

    function validarPreciosFinalesYErrores() {
        let hayError = false;
        document
            .querySelectorAll('#user-products-table tbody tr[data-product-id]')
            .forEach(function (tr) {
                const priceCop = parseFloat(tr.getAttribute('data-price-cop'));
                const priceUsd = parseFloat(tr.getAttribute('data-price-usd'));
                const inputCop = tr.querySelector(
                    'input[name^="discount_cop_extra_"]'
                );
                const inputUsd = tr.querySelector(
                    'input[name^="discount_usd_extra_"]'
                );
                const tdAdicional = tr.children[2];

                if (isCop && inputUsd) inputUsd.value = 0;
                if (!isCop && inputCop) inputCop.value = 0;

                const errorMsg = tdAdicional.querySelector('.adicional-error-msg');
                if (errorMsg) errorMsg.remove();
                if (inputCop) inputCop.classList.remove('input-error');
                if (inputUsd) inputUsd.classList.remove('input-error');

                if (isCop) {
                    const finalCop = priceCop - parseFloat(inputCop?.value || 0);
                    if (finalCop < 1) {
                        hayError = true;
                        if (inputCop) inputCop.classList.add('input-error');
                        const msg = document.createElement('div');
                        msg.className = 'adicional-error-msg';
                        msg.textContent = 'El precio final no puede\nser menor a 1 COP';
                        tdAdicional.appendChild(msg);
                    }
                } else {
                    const finalUsd = priceUsd - parseFloat(inputUsd?.value || 0);
                    if (finalUsd < 0.1) {
                        hayError = true;
                        if (inputUsd) inputUsd.classList.add('input-error');
                        const msg = document.createElement('div');
                        msg.className = 'adicional-error-msg';
                        msg.textContent =
                            'El precio final no puede\nser menor a 0.1 USD';
                        tdAdicional.appendChild(msg);
                    }
                }
            });
        return !hayError;
    }

    function saveProductsAutomatically() {
        if (!currentUserId) return;
        if (saveInFlight) {
            saveQueued = true;
            return;
        }
        if (!validarPreciosFinalesYErrores()) {
            return;
        }

        const productosIds = collectVisibleProductIds();
        const data = {
            productos_permitidos: productosIds,
            descuentos_productos: collectDescuentosProductos(isCop),
        };
        const csrfToken = getCsrfToken();

        saveInFlight = fetch('/admin/users/' + currentUserId + '/edit_products', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify(data),
        })
            .then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (text) {
                        throw new Error(
                            'HTTP error! status: ' + r.status + ', body: ' + text
                        );
                    });
                }
                return r.json();
            })
            .then(function (resp) {
                if (resp.status !== 'ok') {
                    alert('Error al guardar: ' + (resp.message || 'Error desconocido'));
                    return;
                }
                const statusEl = document.getElementById('editUserProductsSaveStatus');
                if (statusEl) {
                    statusEl.textContent = 'Guardado (' + productosIds.length + ' productos)';
                    statusEl.hidden = false;
                    clearTimeout(statusEl._hideTimer);
                    statusEl._hideTimer = setTimeout(function () {
                        statusEl.hidden = true;
                    }, 2000);
                }
                try {
                    window.dispatchEvent(
                        new CustomEvent('store-catalog-permissions-saved', {
                            detail: {
                                catalog_revision: resp.catalog_revision,
                                productos_permitidos: resp.productos_permitidos || productosIds,
                            },
                        })
                    );
                } catch (_ev) {}
            })
            .catch(function (err) {
                alert(
                    'Error al guardar: ' +
                        (err && err.message ? err.message : 'desconocido')
                );
            })
            .finally(function () {
                saveInFlight = null;
                if (saveQueued) {
                    saveQueued = false;
                    saveProductsAutomatically();
                }
            });
    }

    function addCheckboxListeners() {
        document
            .querySelectorAll(
                '#user-products-table tbody tr[data-product-id] input[name^="visible_"]'
            )
            .forEach(function (checkbox) {
                checkbox.addEventListener('change', function () {
                    saveProductsAutomatically();
                });
            });
    }

    let descuentoTimeout = null;
    function addDescuentoListeners() {
        document
            .querySelectorAll(
                'input[name^="discount_cop_extra_"], input[name^="discount_usd_extra_"]'
            )
            .forEach(function (input) {
                input.addEventListener('input', function () {
                    updateProductTableByTipoPrecio();
                    validarPreciosFinalesYErrores();
                    clearTimeout(descuentoTimeout);
                    descuentoTimeout = setTimeout(function () {
                        saveProductsAutomatically();
                    }, 1000);
                });
            });
    }

    updateProductTableByTipoPrecio();
    renderEditProductsTable();
    addCheckboxListeners();
    addDescuentoListeners();
});
