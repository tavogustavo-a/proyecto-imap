// Variables globales
let archivedLicenses = [];

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    initializeArchivedLicenses();
    setupEventListeners();
});

// Inicializar licencias archivadas
async function initializeArchivedLicenses() {
    try {
        await loadArchivedLicenses();
    } catch (error) {
        console.error('Error al inicializar licencias archivadas:', error);
    }
}

// Configurar event listeners
function setupEventListeners() {
    // Búsqueda
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput) {
        searchInput.addEventListener('input', filterArchivedLicenses);
    }
    
    // Botón gestionar productos
    const btnGestionar = document.getElementById('btnGestionarProductosArchivados');
    if (btnGestionar) {
        btnGestionar.addEventListener('click', abrirModalGestionProductos);
    }
    
    // Cerrar modal
    const closeModal = document.getElementById('closeGestionProductos');
    if (closeModal) {
        closeModal.addEventListener('click', cerrarModalGestionProductos);
    }
    
    const cancelarBtn = document.getElementById('btnCancelarGestion');
    if (cancelarBtn) {
        cancelarBtn.addEventListener('click', cerrarModalGestionProductos);
    }
    
    // Guardar cambios
    const guardarBtn = document.getElementById('btnGuardarCambios');
    if (guardarBtn) {
        guardarBtn.addEventListener('click', guardarCambiosProductos);
    }
    
    // Configurar botón de contraer/expandir
    setupCollapseButton();
}

// Cargar licencias archivadas desde el servidor
async function loadArchivedLicenses() {
    try {
        const response = await fetch('/tienda/api/licenses/archived');
        
        if (response.status === 302 || response.status === 401 || response.status === 403) {
            showError('Sesión expirada. Por favor, inicia sesión nuevamente.');
            setTimeout(() => {
                window.location.href = '/auth/login';
            }, 2000);
            return;
        }
        
        if (response.status === 404) {
            showError('Endpoint no encontrado. Verifica la configuración del servidor.');
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            archivedLicenses = data.licenses || [];
            renderArchivedLicensesGrid();
        } else {
            console.error('Error al cargar licencias archivadas:', data.error);
            showError('Error al cargar las licencias archivadas: ' + (data.error || 'Error desconocido'));
        }
    } catch (error) {
        console.error('Error de red:', error);
        showError('Error de conexión al cargar licencias archivadas: ' + error.message);
    }
}

// Renderizar el grid de licencias archivadas
function renderArchivedLicensesGrid() {
    const grid = document.getElementById('archivedLicensesGrid');
    if (!grid) return;

    if (archivedLicenses.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: rgba(255,255,255,0.7);">
                <i class="fas fa-archive" style="font-size: 3rem; margin-bottom: 1rem; color: #f39c12;"></i>
                <h3>No hay licencias archivadas</h3>
                <p>Las licencias archivadas aparecerán aquí</p>
            </div>
        `;
        return;
    }

    // Ordenar por posición
    const sortedLicenses = [...archivedLicenses].sort((a, b) => a.position - b.position);
    
    // Agregar botón de contraer/expandir
    const collapseButton = `
        <button class="licenses-collapse-btn" id="archivedCollapseBtn">
            <i class="fas fa-chevron-up" id="archivedCollapseIcon"></i>
        </button>
    `;
    
    const licensesHtml = sortedLicenses.map(license => createArchivedLicenseCard(license)).join('');
    grid.innerHTML = collapseButton + licensesHtml;
    
    // Configurar el botón de contraer/expandir
    setupCollapseButton();
}

// Crear tarjeta de licencia archivada
function createArchivedLicenseCard(license) {
    const firstLetter = license.product_name.charAt(0).toUpperCase();
    return `
        <div class="license-card" data-license-id="${license.id}">
            <div class="license-name">
                <span class="full-text">${license.product_name}</span>
                <span class="first-letter">${firstLetter}</span>
            </div>
        </div>
    `;
}

// Filtrar licencias archivadas
function filterArchivedLicenses() {
    const searchTerm = document.getElementById('adminStoreSearch').value.toLowerCase();
    const cards = document.querySelectorAll('.license-card');
    
    cards.forEach(card => {
        const licenseName = card.querySelector('.license-name .full-text').textContent.toLowerCase();
        if (licenseName.includes(searchTerm)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

// Restaurar licencia archivada (función conservada para compatibilidad)
async function restoreLicense(licenseId) {
    if (!confirm('¿Estás seguro de que quieres desarchivar esta licencia?')) {
        return;
    }

    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/restore`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Licencia desarchivada correctamente');
                await loadArchivedLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al desarchivar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al desarchivar la licencia');
        }
    } catch (error) {
        console.error('Error al desarchivar licencia:', error);
        showError('Error de conexión al desarchivar la licencia');
    }
}

// Utilidades
function getCSRFToken() {
    const token = document.querySelector('meta[name="csrf_token"]');
    return token ? token.getAttribute('content') : '';
}

function showSuccess(message) {
    // Implementar notificación de éxito
    alert('✅ ' + message);
}

function showError(message) {
    // Implementar notificación de error
    alert('❌ ' + message);
}

// Abrir modal de gestión de productos
function abrirModalGestionProductos() {
    const modal = document.getElementById('modalGestionProductos');
    if (modal) {
        modal.classList.remove('d-none');
        cargarProductosParaGestion();
        
        // Agregar event listener para cerrar al hacer clic fuera del modal
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                cerrarModalGestionProductos();
            }
        });
    }
}

// Cerrar modal de gestión de productos
function cerrarModalGestionProductos() {
    const modal = document.getElementById('modalGestionProductos');
    if (modal) {
        modal.classList.add('d-none');
    }
}

// Cargar productos para gestión
function cargarProductosParaGestion() {
    const lista = document.getElementById('gestionProductosLista');
    if (!lista) return;
    
    if (archivedLicenses.length === 0) {
        lista.innerHTML = '<p class="text-muted">No hay productos archivados</p>';
        return;
    }
    
    let html = '';
    archivedLicenses.forEach(license => {
        html += `
            <div class="gestion-producto-item" data-license-id="${license.id}">
                <span>Producto: </span>
                <strong>${license.product_name}</strong>
                <div class="form-group mt-2">
                    <label for="posicion-${license.id}">Posición:</label>
                    <input type="number" id="posicion-${license.id}" class="form-control gestion-posicion" value="${license.position}" min="1">
                </div>
                <button class="btn-panel btn-blue btn-restaurar" data-license-id="${license.id}">
                    <i class="fas fa-undo"></i> Desarchivar
                </button>
            </div>
        `;
    });
    
    lista.innerHTML = html;
    
    // Agregar event listeners a los botones restaurar
    lista.querySelectorAll('.btn-restaurar').forEach(btn => {
        btn.addEventListener('click', function() {
            const licenseId = parseInt(this.dataset.licenseId);
            restaurarProductoDesdeGestion(licenseId);
        });
    });
}

// Restaurar producto desde modal de gestión
async function restaurarProductoDesdeGestion(licenseId) {
    if (!confirm('¿Estás seguro de que quieres desarchivar este producto?')) {
        return;
    }

    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/restore`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Producto desarchivado correctamente');
                // Recargar productos y licencias
                await loadArchivedLicenses();
                cargarProductosParaGestion();
            } else {
                showError('Error al desarchivar el producto: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al desarchivar el producto');
        }
    } catch (error) {
        console.error('Error al desarchivar producto:', error);
        showError('Error de conexión al desarchivar el producto');
    }
}

// Guardar cambios de posición
async function guardarCambiosProductos() {
    const items = document.querySelectorAll('.gestion-producto-item');
    const cambios = [];
    
    items.forEach(item => {
        const licenseId = parseInt(item.dataset.licenseId);
        const posicionInput = item.querySelector('input[type="number"]');
        const nuevaPosicion = parseInt(posicionInput.value);
        
        if (posicionInput) {
            const productoOriginal = archivedLicenses.find(l => l.id === licenseId);
            if (productoOriginal && productoOriginal.position !== nuevaPosicion) {
                cambios.push({
                    licenseId: licenseId,
                    position: nuevaPosicion
                });
            }
        }
    });
    
    if (cambios.length === 0) {
        showError('No hay cambios que guardar');
        return;
    }
    
    if (!confirm(`¿Guardar cambios de posición para ${cambios.length} producto(s)?`)) {
        return;
    }
    
    try {
        for (const cambio of cambios) {
            const response = await fetch(`/tienda/api/licenses/${cambio.licenseId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    position: cambio.position
                })
            });
            
            if (!response.ok) {
                throw new Error(`Error al actualizar producto ${cambio.licenseId}`);
            }
        }
        
        showSuccess('Cambios guardados correctamente');
        await loadArchivedLicenses();
        cargarProductosParaGestion();
    } catch (error) {
        console.error('Error al guardar cambios:', error);
        showError('Error al guardar los cambios: ' + error.message);
    }
}

// Configurar botón de contraer/expandir
function setupCollapseButton() {
    const collapseBtn = document.getElementById('archivedCollapseBtn');
    const collapseIcon = document.getElementById('archivedCollapseIcon');
    const licenciasContainer = document.getElementById('licenciasContainer');
    
    if (!collapseBtn || !collapseIcon || !licenciasContainer) return;
    
    // Clonar el botón para reemplazar el anterior y mantener los event listeners
    const newCollapseBtn = collapseBtn.cloneNode(true);
    const newCollapseIcon = newCollapseBtn.querySelector('#archivedCollapseIcon');
    
    collapseBtn.parentNode.replaceChild(newCollapseBtn, collapseBtn);
    
    newCollapseBtn.addEventListener('click', function() {
        licenciasContainer.classList.toggle('collapsed');
        
        if (licenciasContainer.classList.contains('collapsed')) {
            newCollapseIcon.className = 'fas fa-chevron-down';
        } else {
            newCollapseIcon.className = 'fas fa-chevron-up';
        }
    });
}
