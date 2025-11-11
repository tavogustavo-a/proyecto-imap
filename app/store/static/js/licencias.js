/**
 * SISTEMA DE GESTIÓN DE LICENCIAS
 * ================================
 * Maneja la interfaz de licencias similar a la imagen de ColorNote
 * - Grid de licencias con cuentas
 * - Edición de posiciones
 * - Gestión de cuentas mensuales
 */

// Variables globales
let licenses = [];
let currentLicenseId = null;

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    // Asegurar que la página quede en la parte superior al cargar
    window.scrollTo(0, 0);
    
    initializeLicenses();
    setupEventListeners();
});

async function initializeLicenses() {
    try {
        // Primero intentar cargar licencias existentes
        await loadLicenses();
        
        // Si no hay licencias, inicializarlas automáticamente
        if (licenses.length === 0) {
            await initializeLicensesFromProducts();
        }
    } catch (error) {
        console.error('Error al inicializar licencias:', error);
        // Intentar inicializar de todas formas
        try {
            await initializeLicensesFromProducts();
        } catch (initError) {
            console.error('Error al inicializar licencias automáticamente:', initError);
        }
    }
}

function setupEventListeners() {
    // Búsqueda
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput) {
        searchInput.addEventListener('input', filterLicenses);
    }
    
    // Botón de contraer/expandir
    setupCollapseButton();
}

// Configurar botón de contraer/expandir
function setupCollapseButton() {
    const collapseBtn = document.getElementById('licensesCollapseBtn');
    const collapseIcon = document.getElementById('collapseIcon');
    const licenciasContainer = document.getElementById('licenciasContainer');
    
    if (collapseBtn && licenciasContainer && collapseIcon) {
        // Cargar estado guardado
        const savedState = localStorage.getItem('licenciasContainerCollapsed');
        if (savedState === 'true') {
            licenciasContainer.classList.add('collapsed');
            collapseIcon.classList.remove('fa-chevron-up');
            collapseIcon.classList.add('fa-chevron-down');
        } else {
            licenciasContainer.classList.remove('collapsed');
            collapseIcon.classList.remove('fa-chevron-down');
            collapseIcon.classList.add('fa-chevron-up');
        }
        
        // Remover listener anterior si existe
        const newCollapseBtn = collapseBtn.cloneNode(true);
        collapseBtn.parentNode.replaceChild(newCollapseBtn, collapseBtn);
        
        // Actualizar referencia del icono después del clone
        const newIcon = document.getElementById('collapseIcon');
        
        newCollapseBtn.addEventListener('click', function() {
            licenciasContainer.classList.toggle('collapsed');
            const icon = document.getElementById('collapseIcon');
            if (icon) {
                if (licenciasContainer.classList.contains('collapsed')) {
                    icon.classList.remove('fa-chevron-up');
                    icon.classList.add('fa-chevron-down');
                    // Guardar estado
                    localStorage.setItem('licenciasContainerCollapsed', 'true');
                } else {
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-up');
                    // Guardar estado
                    localStorage.setItem('licenciasContainerCollapsed', 'false');
                }
            }
        });
    }
}

function setupEventListeners() {
    // Búsqueda
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput) {
        searchInput.addEventListener('input', filterLicenses);
    }
    
    // Botón de contraer/expandir
    setupCollapseButton();
    
    // Cerrar menús al hacer clic fuera
    document.addEventListener('click', function(event) {
        // Cerrar menús de licencias activas
        if (!event.target.closest('.license-action-btn') && !event.target.closest('.license-menu')) {
            document.querySelectorAll('.license-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
        
        // Cerrar menús de licencias archivadas
        if (!event.target.closest('.archived-license-action-btn') && !event.target.closest('.archived-license-menu')) {
            document.querySelectorAll('.archived-license-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });
    
    // Reposicionar menús al redimensionar la ventana
    window.addEventListener('resize', function() {
        // Cerrar todos los menús al redimensionar
        document.querySelectorAll('.license-menu, .archived-license-menu').forEach(menu => {
            menu.style.display = 'none';
        });
    });
}

// Cargar licencias desde el servidor
async function loadLicenses() {
    try {
        const response = await fetch('/tienda/api/licenses');
        
        // Verificar si hay redirección (no autenticado)
        if (response.redirected || response.status === 302) {
            showError('Debes estar autenticado como administrador para acceder a las licencias');
            return;
        }
        
        // Verificar si hay error de autenticación
        if (response.status === 401 || response.status === 403) {
            showError('No tienes permisos para acceder a las licencias');
            return;
        }
        
        if (response.status === 404) {
            showError('La ruta de licencias no fue encontrada. Verifica que el servidor esté funcionando correctamente.');
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            licenses = data.licenses || [];
            renderLicensesGrid();
        } else {
            console.error('Error al cargar licencias:', data.error);
            // No mostrar error si es la primera carga
            if (licenses.length === 0) {
            } else {
                showError('Error al cargar las licencias: ' + (data.error || 'Error desconocido'));
            }
        }
    } catch (error) {
        console.error('Error de red:', error);
        showError('Error de conexión al cargar licencias: ' + error.message);
    }
}

// Renderizar el grid de licencias
function renderLicensesGrid() {
    const grid = document.getElementById('licensesGrid');
    if (!grid) return;
    
    if (licenses.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #7f8c8d;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                <p>Inicializando licencias desde productos...</p>
            </div>
        `;
        return;
    }
    
    // Separar licencias activas y archivadas
    const activeLicenses = licenses.filter(license => license.enabled);
    const archivedLicenses = licenses.filter(license => !license.enabled);

    // Ordenar por posición
    const sortedActiveLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
    const sortedArchivedLicenses = [...archivedLicenses].sort((a, b) => a.position - b.position);
    
    let licensesHtml = '';
    
    // Agregar el botón de contraer/expandir primero
    licensesHtml += `
        <button class="licenses-collapse-btn" id="licensesCollapseBtn" title="Contraer/Expandir">
            <i class="fas fa-chevron-up" id="collapseIcon"></i>
        </button>
    `;
    
    // Licencias activas - distribución automática con grid
    if (sortedActiveLicenses.length > 0) {
        licensesHtml += sortedActiveLicenses.map(license => createLicenseCard(license)).join('');
    }
    
    // Agregar el campo de entrada al final de todas las tarjetas
    licensesHtml += `
        <div class="license-accounts-input-container" id="licenseAccountsInputContainer" style="display: none;">
            <div class="license-saved-accounts" id="licenseSavedAccountsContainer" style="display: none;">
                <div class="saved-accounts-list" id="licenseSavedAccountsList"></div>
            </div>
            <div class="license-all-days-container" id="licenseAllDaysContainer" style="display: none;">
                <!-- Aquí se cargarán todos los días del 1 al 31 con sus correos vendidos -->
            </div>
        </div>
    `;
    
    grid.innerHTML = licensesHtml;
    
    // Configurar el botón después de renderizar
    setupCollapseButton();
    
    // Agregar event listeners a las tarjetas
    addLicenseCardListeners();
    
    // Restaurar tarjeta seleccionada si existe
    restoreSelectedLicense();
    
    // Actualizar contador de archivados
    updateArchivedCount(sortedArchivedLicenses.length);
}

// Crear tarjeta de licencia archivada
function createArchivedLicenseCard(license) {
    return `
        <div class="archived-license-card" data-license-id="${license.id}">
            <button class="archived-license-action-btn" onclick="showArchivedLicenseMenu(${license.id})" title="Opciones">
                <i class="fas fa-ellipsis-v"></i>
            </button>
            <div class="archived-license-card-header">
                <h3 class="archived-license-name">${license.product_name}</h3>
            </div>
            <div class="archived-license-accounts">
                <span class="archived-label">Archivado</span>
            </div>
        </div>
    `;
}

// Crear tarjeta de licencia
function createLicenseCard(license) {
    const accountsHtml = license.accounts.map(account => createAccountItem(account)).join('');
    
    const firstLetter = license.product_name.charAt(0).toUpperCase();
    
    return `
        <div class="license-card" data-license-id="${license.id}">
            <div class="license-card-header">
                <h3 class="license-name">
                    <span class="full-text">${license.product_name}</span>
                    <span class="first-letter">${firstLetter}</span>
                </h3>
                <div class="license-accounts">
                    ${accountsHtml || ''}
                </div>
            </div>
        </div>
    `;
}

// Crear item de cuenta
function createAccountItem(account) {
    const statusClass = account.status;
    const statusText = {
        'available': 'Disponible',
        'assigned': 'Asignada',
        'sold': 'Vendida'
    }[account.status] || account.status;
    
    return `
        <div class="account-item" data-account-id="${account.id}">
            <span class="account-status ${statusClass}">${statusText}</span>
            <div class="account-identifier">${account.account_identifier}</div>
            <div class="account-email">${account.email.toLowerCase()}</div>
            <div class="account-password">${account.password}</div>
            
            <div class="account-actions">
                <button class="account-action-btn" onclick="editAccount(${account.id})" title="Editar cuenta">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="account-action-btn" onclick="assignAccount(${account.id})" title="Asignar cuenta">
                    <i class="fas fa-user-plus"></i>
                </button>
                <button class="account-action-btn danger" onclick="removeAccount(${account.id})" title="Eliminar cuenta">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

// Agregar event listeners a las tarjetas
function addLicenseCardListeners() {
    // Agregar evento de clic para seleccionar tarjetas
    const cards = document.querySelectorAll('.license-card');
    
    cards.forEach(card => {
        // Evitar que el clic en el botón de acción active la selección
        const actionBtn = card.querySelector('.license-action-btn');
        if (actionBtn) {
            actionBtn.addEventListener('click', function(e) {
                e.stopPropagation();
            });
        }
        
        // Hacer que el nombre de la licencia sea clickeable para activar directamente
        const licenseName = card.querySelector('.license-name');
        if (licenseName) {
            licenseName.style.cursor = 'pointer';
            licenseName.addEventListener('click', function(e) {
                e.stopPropagation();
                const licenseId = parseInt(card.dataset.licenseId);
                const isActive = card.classList.contains('active');
                if (!isActive) {
                    activateLicenseCard(card, licenseId, true);
                }
            });
        }
        
        // Agregar evento de clic a la tarjeta
        card.addEventListener('click', function(e) {
            // No hacer nada si se hace clic en el botón de acción
            if (e.target.closest('.license-action-btn')) {
                return;
            }
            
            const licenseId = parseInt(card.dataset.licenseId);
            const license = licenses.find(l => l.id === licenseId);
            const isActive = card.classList.contains('active');
            
            // Remover clase active de todas las tarjetas
            cards.forEach(c => c.classList.remove('active'));
            
            // Obtener el contenedor
            const inputContainer = document.getElementById('licenseAccountsInputContainer');
            
            // Si la tarjeta no estaba activa, activarla y mostrar las cuentas
            if (!isActive && license) {
                activateLicenseCard(card, licenseId, true);
            } else {
                // Si estaba activa, ocultar el contenedor
                localStorage.removeItem('selectedLicenseId');
                if (inputContainer) {
                    inputContainer.style.display = 'none';
                }
            }
        });
    });
    
    // La selección se maneja en restoreSelectedLicense()
}

// Activar una tarjeta de licencia
function activateLicenseCard(card, licenseId, skipScroll = false) {
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    
    // Remover clase active de todas las tarjetas
    document.querySelectorAll('.license-card').forEach(c => c.classList.remove('active'));
    
    // Activar la tarjeta seleccionada
    card.classList.add('active');
    
    // Guardar la tarjeta seleccionada
    localStorage.setItem('selectedLicenseId', licenseId.toString());
    
    if (inputContainer) {
        inputContainer.style.display = 'block';
        
        // Cargar y mostrar las cuentas guardadas (editables)
        loadAndDisplaySavedAccounts(licenseId);
        
        // Cargar y mostrar todos los días con sus correos vendidos
        loadAllDaysSoldAccounts(licenseId);
        
        // Aplicar resaltado de búsqueda si hay un término activo
        const searchInput = document.getElementById('adminStoreSearch');
        if (searchInput && searchInput.value.trim()) {
            highlightMatchingEmails(searchInput.value.toLowerCase().trim());
        }
        
        // Solo hacer scroll si no se especifica skipScroll (cuando es un clic del usuario)
        if (!skipScroll) {
            // Hacer scroll suave hasta el contenedor (sin animación, solo scroll instantáneo)
            setTimeout(() => {
                inputContainer.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }, 100);
        }
    }
}

// Restaurar la tarjeta seleccionada desde localStorage
function restoreSelectedLicense() {
    const savedLicenseId = localStorage.getItem('selectedLicenseId');
    const cards = document.querySelectorAll('.license-card');
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    
    if (savedLicenseId && cards.length > 0) {
        const savedId = parseInt(savedLicenseId);
        const savedCard = Array.from(cards).find(card => parseInt(card.dataset.licenseId) === savedId);
        
        if (savedCard) {
            // Remover clase active de todas las tarjetas
            cards.forEach(c => c.classList.remove('active'));
            
            // Activar la tarjeta guardada sin hacer scroll (skipScroll = true)
            activateLicenseCard(savedCard, savedId, true);
            return;
        }
    }
    
    // Si no hay tarjeta guardada o no se encontró, seleccionar la primera
    const activeCard = document.querySelector('.license-card.active');
    if (!activeCard && cards.length > 0) {
        const firstCard = cards[0];
        const firstLicenseId = parseInt(firstCard.dataset.licenseId);
        const firstLicense = licenses.find(l => l.id === firstLicenseId);
        
        if (firstLicense) {
            // Activar la primera tarjeta sin hacer scroll (skipScroll = true)
            activateLicenseCard(firstCard, firstLicenseId, true);
        }
    }
}

// Configurar el campo de entrada único
function setupLicenseInputField() {
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    const inputField = document.getElementById('licenseAccountsInput');
    
    if (!inputField) return;
    
    // Evitar que el clic en el contenedor del input active/desactive la tarjeta
    if (inputContainer) {
        inputContainer.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    let saveTimeout;
    
    inputField.addEventListener('input', function() {
        highlightEmailsAndPasswords(this);
        
        // Guardar automáticamente después de 2 segundos sin escribir
        clearTimeout(saveTimeout);
        const licenseId = parseInt(this.dataset.licenseId);
        const text = this.innerText || this.textContent || '';
        
        saveTimeout = setTimeout(() => {
            if (text.trim() && licenseId) {
                saveBulkAccounts(licenseId, text);
            }
        }, 2000);
    });
    
    // Guardar al presionar Ctrl+Enter o Cmd+Enter (Enter normal agrega nueva línea)
    inputField.addEventListener('keydown', function(e) {
        // Permitir Enter normal para agregar nuevas líneas
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            // No hacer preventDefault, dejar que el comportamiento normal funcione
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(saveTimeout);
            const licenseId = parseInt(this.dataset.licenseId);
            const text = this.innerText || this.textContent || '';
            if (text.trim() && licenseId) {
                saveBulkAccounts(licenseId, text);
            }
        }
    });
    
    // Manejar placeholder
    inputField.addEventListener('focus', function() {
        if (this.textContent.trim() === '' || this.textContent === this.dataset.placeholder) {
            this.textContent = '';
        }
    });
    
    inputField.addEventListener('blur', function() {
        if (this.textContent.trim() === '') {
            this.textContent = this.dataset.placeholder || '';
            this.classList.add('empty');
        } else {
            this.classList.remove('empty');
        }
    });
    
    // Inicializar placeholder
    if (!inputField.textContent.trim()) {
        inputField.textContent = inputField.dataset.placeholder || '';
        inputField.classList.add('empty');
    }
}

// Resaltar correos en azul y contraseñas en blanco
function highlightEmailsAndPasswords(element) {
    const text = element.innerText || element.textContent;
    if (!text) return;
    
    // Determinar qué clases usar según el tipo de elemento
    const isDayItem = element.classList.contains('day-account-item');
    const emailClass = isDayItem ? 'day-account-email' : 'saved-account-email';
    const passwordClass = isDayItem ? 'day-account-password' : 'saved-account-password';
    const separatorClass = isDayItem ? 'day-account-separator' : 'saved-account-separator';
    
    const lines = text.split('\n');
    let html = '';
    let hasValidEmail = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            // Solo agregar <br> si no es el último elemento y hay más líneas
            if (i < lines.length - 1) {
                html += '<br>';
            }
            continue;
        }
        
        // Detectar formato: correo@gmail.com contraseña o correo@gmail.com:contraseña
        const colonMatch = line.match(/^([^\s:]+@[^\s:]+\.\S+):(.+)$/);
        const spaceMatch = line.match(/^([^\s]+@[^\s]+\.\S+)\s+(.+)$/);
        
        if (colonMatch) {
            const email = colonMatch[1].trim();
            const password = colonMatch[2].trim();
            // Agregar salto de línea antes de cada correo (excepto el primero)
            if (hasValidEmail) {
                html += '<br>';
            }
            html += `<span class="${emailClass}">${escapeHtml(email.toLowerCase())}</span><span class="${separatorClass}">:</span><span class="${passwordClass}">${escapeHtml(password)}</span>`;
            hasValidEmail = true;
        } else if (spaceMatch) {
            const email = spaceMatch[1].trim();
            const password = spaceMatch[2].trim();
            // Agregar salto de línea antes de cada correo (excepto el primero)
            if (hasValidEmail) {
                html += '<br>';
            }
            html += `<span class="${emailClass}">${escapeHtml(email.toLowerCase())}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(password)}</span>`;
            hasValidEmail = true;
        } else {
            // Buscar correo en la línea
            const emailMatch = line.match(/(\S+@\S+\.\S+)/);
            if (emailMatch) {
                const email = emailMatch[1].trim();
                const password = line.replace(email, '').trim().replace(/^[:;\s]+/, '');
                if (password) {
                    // Agregar salto de línea antes de cada correo (excepto el primero)
                    if (hasValidEmail) {
                        html += '<br>';
                    }
                    html += `<span class="${emailClass}">${escapeHtml(email.toLowerCase())}</span><span class="${separatorClass}"> </span><span class="${passwordClass}">${escapeHtml(password)}</span>`;
                    hasValidEmail = true;
                } else {
                    html += escapeHtml(line);
                }
            } else {
                html += escapeHtml(line);
            }
        }
    }
    
    // Guardar posición del cursor
    const selection = window.getSelection();
    let cursorPosition = 0;
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        cursorPosition = preCaretRange.toString().length;
    }
    
    element.innerHTML = html;
    
    // Restaurar posición del cursor (aproximada)
    try {
        const range = document.createRange();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let charCount = 0;
        let node;
        
        while ((node = walker.nextNode())) {
            const nodeLength = node.textContent.length;
            if (charCount + nodeLength >= cursorPosition) {
                range.setStart(node, cursorPosition - charCount);
                range.setEnd(node, cursorPosition - charCount);
                selection.removeAllRanges();
                selection.addRange(range);
                break;
            }
            charCount += nodeLength;
        }
    } catch (e) {
        // Si falla, simplemente colocar el cursor al final
    }
}

// Función auxiliar para escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Editar posición de licencia
function editLicensePosition(licenseId) {
    const license = licenses.find(l => l.id === licenseId);
    if (!license) return;
    
    currentLicenseId = licenseId;
    showPositionModal(license.position);
}

// Mostrar modal de posición
function showPositionModal(currentPosition) {
    const modal = document.createElement('div');
    modal.className = 'license-position-modal show';
    modal.innerHTML = `
        <div class="license-position-content">
            <h3>Editar Posición</h3>
            <form class="license-position-form" onsubmit="updateLicensePosition(event)">
                <label for="newPosition">Nueva posición:</label>
                <input type="number" id="newPosition" value="${currentPosition}" min="1" required>
                <div class="license-position-buttons">
                    <button type="button" class="btn-panel btn-red" onclick="closePositionModal()">Cancelar</button>
                    <button type="submit" class="btn-panel btn-green">Guardar</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closePositionModal();
        }
    });
}

// Cerrar modal de posición
function closePositionModal() {
    const modal = document.querySelector('.license-position-modal');
    if (modal) {
        modal.remove();
    }
    currentLicenseId = null;
}

// Actualizar posición de licencia
async function updateLicensePosition(event) {
    event.preventDefault();
    
    const newPosition = parseInt(document.getElementById('newPosition').value);
    if (!currentLicenseId || !newPosition) return;
    
    try {
        const response = await fetch(`/tienda/api/licenses/${currentLicenseId}/position`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({ position: newPosition })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Actualizar la licencia local
            const license = licenses.find(l => l.id === currentLicenseId);
            if (license) {
                license.position = newPosition;
            }
            
            // Re-renderizar el grid
            renderLicensesGrid();
            closePositionModal();
            showSuccess('Posición actualizada correctamente');
        } else {
            showError(data.error || 'Error al actualizar posición');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al actualizar posición');
    }
}

// Toggle visibilidad de licencia
async function toggleLicenseVisibility(licenseId) {
    const license = licenses.find(l => l.id === licenseId);
    if (!license) return;
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            license.enabled = data.enabled;
            renderLicensesGrid();
            showSuccess(`Licencia ${data.enabled ? 'habilitada' : 'deshabilitada'} correctamente`);
        } else {
            showError(data.error || 'Error al cambiar visibilidad');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al cambiar visibilidad');
    }
}

// Agregar cuenta a licencia
function addAccountToLicense(licenseId) {
    // Implementar modal para agregar cuenta
    showAddAccountModal(licenseId);
}

// Mostrar modal para agregar cuenta
function showAddAccountModal(licenseId) {
    const modal = document.createElement('div');
    modal.className = 'license-position-modal show';
    modal.innerHTML = `
        <div class="license-position-content">
            <h3>Agregar Cuenta</h3>
            <form class="license-position-form" onsubmit="addAccount(event, ${licenseId})">
                <label for="accountIdentifier">Identificador de cuenta:</label>
                <input type="text" id="accountIdentifier" placeholder="Ej: disneyprem5+0k9" required>
                
                <label for="accountEmail">Email:</label>
                <input type="email" id="accountEmail" placeholder="Ej: disneyprem5+0k9@gmail.com" required>
                
                <label for="accountPassword">Contraseña:</label>
                <input type="text" id="accountPassword" placeholder="Ej: 3dw9k65tz" required>
                
                <div class="license-position-buttons">
                    <button type="button" class="btn-panel btn-red" onclick="closeAddAccountModal()">Cancelar</button>
                    <button type="submit" class="btn-panel btn-green">Agregar</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeAddAccountModal();
        }
    });
}

// Cerrar modal de agregar cuenta
function closeAddAccountModal() {
    const modal = document.querySelector('.license-position-modal');
    if (modal) {
        modal.remove();
    }
}

// Agregar cuenta
async function addAccount(event, licenseId) {
    event.preventDefault();
    
    const identifier = document.getElementById('accountIdentifier').value;
    const email = document.getElementById('accountEmail').value;
    const password = document.getElementById('accountPassword').value;
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                account_identifier: identifier,
                email: email,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Recargar licencias para mostrar la nueva cuenta
            await loadLicenses();
            closeAddAccountModal();
            showSuccess('Cuenta agregada correctamente');
        } else {
            showError(data.error || 'Error al agregar cuenta');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al agregar cuenta');
    }
}

// Editar cuenta
function editAccount(accountId) {
    // Implementar edición de cuenta
}

// Asignar cuenta
function assignAccount(accountId) {
    // Implementar asignación de cuenta
}

// Eliminar cuenta
async function removeAccount(accountId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta cuenta?')) {
        return;
    }
    
    try {
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess('Cuenta eliminada correctamente');
        } else {
            showError(data.error || 'Error al eliminar cuenta');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al eliminar cuenta');
    }
}

// Parsear texto para extraer correos y contraseñas
function parseAccountsText(text) {
    const accounts = [];
    const lines = text.split('\n');
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // Detectar formato: correo@gmail.com contraseña o correo@gmail.com:contraseña
        const colonMatch = line.match(/^([^\s:]+@[^\s:]+\.\S+):(.+)$/);
        const spaceMatch = line.match(/^([^\s]+@[^\s]+\.\S+)\s+(.+)$/);
        
        let email = null;
        let password = null;
        
        if (colonMatch) {
            email = colonMatch[1].trim();
            password = colonMatch[2].trim();
        } else if (spaceMatch) {
            email = spaceMatch[1].trim();
            password = spaceMatch[2].trim();
        } else {
            // Buscar correo en la línea (debe tener @ y .)
            const emailMatch = line.match(/(\S+@\S+\.\S+)/);
            if (emailMatch) {
                email = emailMatch[1].trim();
                // El resto de la línea es la contraseña
                password = line.replace(email, '').trim();
            }
        }
        
        // Validar que el correo tenga @ y .
        if (email && email.includes('@') && email.includes('.')) {
            // Extraer contraseña si no se encontró antes
            if (!password) {
                const parts = line.split(email);
                if (parts.length > 1) {
                    password = parts.slice(1).join('').trim();
                    // Limpiar separadores comunes
                    password = password.replace(/^[:;\s]+/, '').trim();
                }
            }
            
            // Si aún no hay contraseña, usar un valor por defecto o saltar
            if (!password) {
                continue;
            }
            
            // Usar el correo como identificador si no hay uno específico
            const identifier = email.split('@')[0];
            
            accounts.push({
                email: email,
                password: password,
                identifier: identifier
            });
        }
    }
    
    return accounts;
}

// Guardar cuentas masivamente
async function saveBulkAccounts(licenseId, text) {
    // Si el texto viene de un elemento HTML, extraer solo el texto plano
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return; // Guardar silenciosamente, no mostrar errores
    }
    
    const accounts = parseAccountsText(text);
    
    if (accounts.length === 0) {
        return; // Guardar silenciosamente, no mostrar errores
    }
    
    // Obtener el día seleccionado desde el campo de entrada o usar el día actual
    const inputField = document.getElementById('licenseAccountsInput');
    const selectedDay = inputField && inputField.dataset.targetDay 
        ? parseInt(inputField.dataset.targetDay) 
        : new Date().getDate();
    
    // Crear la fecha con el día seleccionado
    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), selectedDay);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Guardar cada cuenta como vendida
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Primero crear la cuenta
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success && createData.account_id) {
                // Marcar como vendida con la fecha del día seleccionado
                try {
                    await fetch(`/tienda/api/accounts/${createData.account_id}/mark-sold`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({
                            sold_date: saleDate.toISOString()
                        })
                    });
                    successCount++;
                } catch (error) {
                    errorCount++;
                    console.error('Error al marcar como vendida:', error);
                }
            } else {
                errorCount++;
            }
        } catch (error) {
            errorCount++;
            console.error('Error:', error);
        }
    }
    
    // Guardar silenciosamente sin mostrar mensajes
    if (successCount > 0) {
        // Limpiar el campo de texto
        const inputField = document.getElementById('licenseAccountsInput');
        if (inputField) {
            inputField.textContent = '';
            inputField.innerHTML = '';
        }
        // Recargar licencias y actualizar las listas
        await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        loadAllDaysSoldAccounts(licenseId);
    }
}

// Función para encontrar correos duplicados
function findDuplicateEmails(accounts) {
    const emailCount = new Map();
    const duplicates = new Set();
    
    // Contar ocurrencias de cada correo
    accounts.forEach(account => {
        const email = account.email ? account.email.toLowerCase().trim() : '';
        if (email) {
            const count = emailCount.get(email) || 0;
            emailCount.set(email, count + 1);
        }
    });
    
    // Identificar correos que aparecen más de una vez
    emailCount.forEach((count, email) => {
        if (count > 1) {
            duplicates.add(email);
        }
    });
    
    return duplicates;
}

// Cargar y mostrar las cuentas guardadas para una licencia
async function loadAndDisplaySavedAccounts(licenseId) {
    const savedAccountsContainer = document.getElementById('licenseSavedAccountsContainer');
    const savedAccountsList = document.getElementById('licenseSavedAccountsList');
    
    if (!savedAccountsContainer || !savedAccountsList) return;
    
    // Buscar la licencia en el array de licencias
    const license = licenses.find(l => l.id === licenseId);
    
    // Siempre mostrar el contenedor, incluso si no hay cuentas
    savedAccountsContainer.style.display = 'block';
    
    // Filtrar solo cuentas disponibles y asignadas (no vendidas)
    const availableAccounts = license && license.accounts 
        ? license.accounts.filter(account => account.status !== 'sold')
        : [];
    
    // Obtener todas las cuentas (incluyendo vendidas) para detectar duplicados completos
    const allAccounts = license && license.accounts ? license.accounts : [];
    const duplicateEmails = findDuplicateEmails(allAccounts);
    
    // Generar HTML con todas las cuentas (editables)
    let accountsHtml = '';
    availableAccounts.forEach((account, index) => {
        const isDuplicate = duplicateEmails.has(account.email.toLowerCase());
        const duplicateClass = isDuplicate ? ' duplicate' : '';
        accountsHtml += `
            <div class="saved-account-item${duplicateClass}" contenteditable="true" data-account-id="${account.id}" data-is-editable="true" data-email="${escapeHtml(account.email.toLowerCase())}">
                <span class="saved-account-email">${escapeHtml(account.email.toLowerCase())}</span>
                <span class="saved-account-separator"> </span>
                <span class="saved-account-password">${escapeHtml(account.password)}</span>
            </div>
        `;
    });
    
    // Agregar un item vacío al final para poder agregar nuevos correos
    accountsHtml += `
        <div class="saved-account-item" contenteditable="true" data-account-id="" data-is-new="true"></div>
    `;
    
    savedAccountsList.innerHTML = accountsHtml;
    
    // Configurar event listeners para los items editables
    setupEditableAccounts(licenseId);
    
    // Aplicar resaltado de búsqueda si hay un término activo
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput && searchInput.value.trim()) {
        highlightMatchingEmails(searchInput.value.toLowerCase().trim());
    }
}

// Configurar los campos editables de cuentas
function setupEditableAccounts(licenseId) {
    const accountItems = document.querySelectorAll('.saved-account-item[contenteditable="true"]');
    
    accountItems.forEach((item, index) => {
        // Guardar automáticamente después de dejar de escribir (como Colornote)
        let saveTimeout;
        let isSaving = false;
        let lastSavedText = '';
        
        // Función para guardar
        const saveItem = async function() {
            // Obtener el texto limpio sin HTML
            const text = this.innerText || this.textContent || '';
            
            // Evitar guardar si no hay cambios o si ya se está guardando
            if (text.trim() === lastSavedText || isSaving) {
                return;
            }
            
            if (text.trim()) {
                isSaving = true;
                const accountId = this.dataset.accountId;
                const isNew = this.dataset.isNew === 'true';
                
                try {
                    if (isNew || !accountId) {
                        // Es un nuevo correo, guardarlo masivamente (cada línea es una licencia)
                        await saveBulkAccountsFromEditable(licenseId, text);
                    } else {
                        // Es un correo existente editado
                        // Buscar la cuenta original para preservar datos si es necesario
                        const originalAccount = licenses
                            .flatMap(l => l.accounts || [])
                            .find(acc => acc.id === parseInt(accountId));
                        
                        // Actualizar con mejor manejo del parseo
                        await updateExistingAccountImproved(licenseId, parseInt(accountId), text, originalAccount);
                    }
                    lastSavedText = text.trim();
                } catch (error) {
                    console.error('Error al guardar:', error);
                } finally {
                    isSaving = false;
                }
            }
        };
        
        item.addEventListener('input', function() {
            clearTimeout(saveTimeout);
            
            // Resaltar emails y passwords en tiempo real
            highlightEmailsAndPasswords(this);
            
            // Guardar automáticamente después de 500ms de inactividad (más rápido, como Colornote)
            saveTimeout = setTimeout(() => {
                saveItem.call(this);
            }, 500);
        });
        
        // Guardar inmediatamente al perder el foco (blur)
        item.addEventListener('blur', function() {
            clearTimeout(saveTimeout);
            saveItem.call(this);
            
            // Manejar placeholder (vacío)
            if (this.dataset.isNew === 'true') {
                if (this.textContent.trim() === '') {
                    this.classList.add('empty');
                } else {
                    this.classList.remove('empty');
                }
            }
        });
        
        // Guardar al presionar Ctrl+Enter
        item.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                // Permitir Enter normal para nueva línea (cada línea será una licencia)
                return;
            }
            
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(saveTimeout);
                saveItem.call(this);
            }
        });
        
        // Inicializar el texto guardado
        if (item.dataset.isNew !== 'true') {
            lastSavedText = (item.innerText || item.textContent || '').trim();
        }
    });
}

// Guardar cuentas desde campo editable
async function saveBulkAccountsFromEditable(licenseId, text) {
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
    const accounts = parseAccountsText(text);
    
    if (accounts.length === 0) {
        return;
    }
    
    let successCount = 0;
    
    // Guardar cada cuenta sin marcar como vendida (para la sección de guardadas)
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Crear la cuenta sin marcarla como vendida
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success) {
                successCount++;
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
    
    // Recargar licencias y actualizar las listas
    if (successCount > 0) {
        await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        loadAllDaysSoldAccounts(licenseId);
    }
}

// Guardar cuentas masivamente para un día específico
async function saveBulkAccountsForDay(licenseId, text, day) {
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
    const accounts = parseAccountsText(text);
    
    if (accounts.length === 0) {
        return;
    }
    
    // Crear la fecha con el día especificado
    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), day);
    
    let successCount = 0;
    
    // Guardar cada cuenta como vendida para el día especificado
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Primero crear la cuenta
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success && createData.account_id) {
                // Marcar como vendida con la fecha del día especificado
                try {
                    await fetch(`/tienda/api/accounts/${createData.account_id}/mark-sold`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({
                            sold_date: saleDate.toISOString()
                        })
                    });
                    successCount++;
                } catch (error) {
                    console.error('Error al marcar como vendida:', error);
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
    
    // Recargar licencias y actualizar las listas
    if (successCount > 0) {
        await loadLicenses();
        loadAndDisplaySavedAccounts(licenseId);
        loadAllDaysSoldAccounts(licenseId);
    }
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (para días vendidos, versión mejorada)
async function updateOrCreateMultipleAccountsImproved(licenseId, accountId, text, day, originalAccount = null) {
    if (!text || !text.trim()) {
        return;
    }
    
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        return;
    }
    
    // Procesar la primera línea (la cuenta que se está editando)
    const firstLine = lines[0];
    const parsed = parseEmailAndPassword(firstLine, originalAccount);
    
    if (!parsed.email && !originalAccount) {
        console.error('No se pudo extraer email de la línea editada');
        return;
    }
    
    try {
        // Actualizar la cuenta existente
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                email: parsed.email,
                password: parsed.password,
                account_identifier: parsed.identifier
            })
        });
        
        // Verificar el status de la respuesta primero
        if (!response.ok) {
            const textResponse = await response.text();
            console.error(`Error HTTP ${response.status}:`, textResponse);
            throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
        }
        
        // Verificar si la respuesta es JSON válido
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('Respuesta no es JSON:', textResponse);
            throw new Error('El servidor no devolvió una respuesta JSON válida');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Si hay más líneas, crear nuevas cuentas para el mismo día
            if (lines.length > 1) {
                const remainingText = lines.slice(1).join('\n');
                await saveBulkAccountsForDay(licenseId, remainingText, day);
            }
            
            // Recargar
            await loadLicenses();
            loadAndDisplaySavedAccounts(licenseId);
            loadAllDaysSoldAccounts(licenseId);
        } else {
            console.error('Error al actualizar cuenta:', data.error);
        }
    } catch (error) {
        console.error('Error al actualizar cuenta:', error);
    }
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (para días vendidos, mantener para compatibilidad)
async function updateOrCreateMultipleAccounts(licenseId, accountId, text, day) {
    // Buscar la cuenta original
    const originalAccount = licenses
        .flatMap(l => l.accounts || [])
        .find(acc => acc.id === accountId);
    
    return await updateOrCreateMultipleAccountsImproved(licenseId, accountId, text, day, originalAccount);
}

// Función mejorada para parsear email y contraseña de una línea de texto
function parseEmailAndPassword(text, originalAccount = null) {
    if (!text || !text.trim()) {
        return { email: null, password: null };
    }
    
    const line = text.trim();
    
    // Intentar detectar formato: correo@gmail.com contraseña o correo@gmail.com:contraseña
    const colonMatch = line.match(/^([^\s:]+@[^\s:]+\.\S+):(.+)$/);
    const spaceMatch = line.match(/^([^\s]+@[^\s]+\.\S+)\s+(.+)$/);
    
    let email = null;
    let password = null;
    
    if (colonMatch) {
        email = colonMatch[1].trim().toLowerCase();
        password = colonMatch[2].trim();
    } else if (spaceMatch) {
        email = spaceMatch[1].trim().toLowerCase();
        password = spaceMatch[2].trim();
    } else {
        // Buscar correo en la línea
        const emailMatch = line.match(/(\S+@\S+\.\S+)/);
        if (emailMatch) {
            email = emailMatch[1].trim().toLowerCase();
            // El resto de la línea es la contraseña
            password = line.replace(emailMatch[0], '').trim().replace(/^[:;\s]+/, '');
        }
    }
    
    // Si no se encontró email pero hay cuenta original, usar la original
    if (!email && originalAccount) {
        email = originalAccount.email.toLowerCase();
        // Si hay texto que no parece email, podría ser solo la contraseña
        if (!password && line.trim() && !line.includes('@')) {
            password = line.trim();
        }
    }
    
    // Si no se encontró contraseña pero hay cuenta original, usar la original
    if (!password && originalAccount) {
        password = originalAccount.password;
        // Si hay un email detectado diferente, usarlo
        if (email && email !== originalAccount.email.toLowerCase()) {
            // Email fue cambiado, mantener la contraseña original si no se especificó nueva
        }
    }
    
    // Validar que al menos tengamos email o datos para actualizar
    if (!email && !originalAccount) {
        return { email: null, password: null };
    }
    
    return {
        email: email || (originalAccount ? originalAccount.email.toLowerCase() : null),
        password: password || (originalAccount ? originalAccount.password : null),
        identifier: email ? email.split('@')[0] : (originalAccount ? originalAccount.account_identifier : null)
    };
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (versión mejorada)
async function updateExistingAccountImproved(licenseId, accountId, text, originalAccount = null) {
    if (!text || !text.trim()) {
        return;
    }
    
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
        return;
    }
    
    // Procesar la primera línea (la cuenta que se está editando)
    const firstLine = lines[0];
    const parsed = parseEmailAndPassword(firstLine, originalAccount);
    
    if (!parsed.email && !originalAccount) {
        console.error('No se pudo extraer email de la línea editada');
        return;
    }
    
    try {
        // Actualizar la cuenta existente con los datos parseados
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                email: parsed.email,
                password: parsed.password,
                account_identifier: parsed.identifier
            })
        });
        
        // Verificar si la respuesta es JSON válido
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('Respuesta no es JSON:', textResponse);
            throw new Error('El servidor no devolvió una respuesta JSON válida');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Si hay más líneas, crear nuevas cuentas (sin marcar como vendidas, para la sección guardada)
            if (lines.length > 1) {
                const remainingText = lines.slice(1).join('\n');
                await saveBulkAccountsFromEditable(licenseId, remainingText);
            }
            
            // Recargar
            await loadLicenses();
            loadAndDisplaySavedAccounts(licenseId);
            loadAllDaysSoldAccounts(licenseId);
        } else {
            console.error('Error al actualizar cuenta:', data.error);
        }
    } catch (error) {
        console.error('Error al actualizar cuenta:', error);
        // No mostrar error al usuario para mantener la experiencia fluida
    }
}

// Actualizar cuenta existente o crear múltiples si hay varias líneas (mantener para compatibilidad)
async function updateExistingAccount(licenseId, accountId, text) {
    // Buscar la cuenta original
    const originalAccount = licenses
        .flatMap(l => l.accounts || [])
        .find(acc => acc.id === accountId);
    
    return await updateExistingAccountImproved(licenseId, accountId, text, originalAccount);
}


// Cargar y mostrar todos los días con sus correos vendidos
async function loadAllDaysSoldAccounts(licenseId) {
    const allDaysContainer = document.getElementById('licenseAllDaysContainer');
    
    if (!allDaysContainer) return;
    
    // Buscar la licencia en el array de licencias
    const license = licenses.find(l => l.id === licenseId);
    
    if (!license || !license.accounts) {
        allDaysContainer.style.display = 'none';
        return;
    }
    
    // Filtrar solo cuentas vendidas
    const soldAccounts = license.accounts.filter(account => account.status === 'sold' && account.assigned_at);
    
    // Siempre mostrar el contenedor, incluso si no hay correos vendidos
    allDaysContainer.style.display = 'block';
    
    // Obtener todas las cuentas (guardadas y vendidas) para detectar duplicados
    const allAccounts = license && license.accounts ? license.accounts : [];
    const duplicateEmails = findDuplicateEmails(allAccounts);
    
    // Organizar cuentas por día
    const accountsByDay = {};
    soldAccounts.forEach(account => {
        const saleDate = new Date(account.assigned_at);
        const day = saleDate.getDate();
        
        if (!accountsByDay[day]) {
            accountsByDay[day] = [];
        }
        accountsByDay[day].push(account);
    });
    
    // Generar HTML para todos los días del 1 al 31 (siempre mostrar todos)
    let allDaysHtml = '';
    for (let day = 1; day <= 31; day++) {
        const dayAccounts = accountsByDay[day] || [];
        
        const accountCount = dayAccounts.length;
        const badgeText = accountCount > 0 ? `${accountCount} ${accountCount === 1 ? 'cuenta' : 'cuentas'}` : '';
        allDaysHtml += `
            <div class="day-section" data-day="${day}">
                <div class="day-section-header">
                    <div class="day-header-content">
                        <i class="fas fa-calendar-day day-icon"></i>
                        <span class="day-number">Día ${day}</span>
                        ${accountCount > 0 ? `<span class="day-account-badge" title="${badgeText}">${accountCount}</span>` : ''}
                    </div>
                </div>
                <div class="day-accounts-list">
        `;
        
        if (dayAccounts.length > 0) {
            dayAccounts.forEach((account, index) => {
                const isDuplicate = duplicateEmails.has(account.email.toLowerCase());
                const duplicateClass = isDuplicate ? ' duplicate' : '';
                allDaysHtml += `
                    <div class="day-account-item${duplicateClass}" contenteditable="false" data-account-id="${account.id}" data-day="${day}" data-is-sold="true" data-email="${escapeHtml(account.email.toLowerCase())}">
                        <span class="day-account-email">${escapeHtml(account.email.toLowerCase())}</span>
                        <span class="day-account-separator"> </span>
                        <span class="day-account-password">${escapeHtml(account.password)}</span>
                        <button class="btn-delete-day-account" data-account-id="${account.id}" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            });
        }
        
        // Agregar un item vacío al final de cada día para poder agregar nuevos correos
        allDaysHtml += `
            <div class="day-account-item" contenteditable="true" data-account-id="" data-day="${day}" data-is-new="true"></div>
        `;
        
        allDaysHtml += `
                </div>
            </div>
        `;
    }
    
    allDaysContainer.innerHTML = allDaysHtml;
    
    // Restaurar estados de días contraídos/expandidos
    restoreDaySectionsState(licenseId);
    
    // Agregar event listeners para contraer/expandir días
    setupDaySectionsToggle(licenseId);
    
    // Agregar event listeners a los botones de eliminar
    allDaysContainer.querySelectorAll('.btn-delete-day-account').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const accountId = parseInt(this.dataset.accountId);
            if (accountId) {
                await deleteAccountSilently(accountId, licenseId);
            }
        });
    });
    
    // Configurar elementos editables de los días
    setupEditableDayAccounts(licenseId);
    
    // Aplicar resaltado de búsqueda si hay un término activo
    const searchInput = document.getElementById('adminStoreSearch');
    if (searchInput && searchInput.value.trim()) {
        highlightMatchingEmails(searchInput.value.toLowerCase().trim());
    }
}

// Configurar el toggle de contraer/expandir para secciones de días
function setupDaySectionsToggle(licenseId) {
    const daySections = document.querySelectorAll('.day-section');
    
    daySections.forEach(section => {
        const header = section.querySelector('.day-section-header');
        const accountsList = section.querySelector('.day-accounts-list');
        const day = section.dataset.day;
        
        if (header && accountsList) {
            // Hacer que el header sea clickeable
            header.style.cursor = 'pointer';
            
            header.addEventListener('click', function(e) {
                // No hacer toggle si se hace clic en el badge
                if (e.target.closest('.day-account-badge')) {
                    return;
                }
                
                section.classList.toggle('collapsed');
                const isCollapsed = section.classList.contains('collapsed');
                
                if (isCollapsed) {
                    accountsList.style.display = 'none';
                } else {
                    accountsList.style.display = 'block';
                }
                
                // Guardar estado en localStorage
                const key = `daySection_${licenseId}_${day}_collapsed`;
                localStorage.setItem(key, isCollapsed ? 'true' : 'false');
            });
        }
    });
}

// Restaurar el estado de contracción/expansión de las secciones de días
function restoreDaySectionsState(licenseId) {
    const daySections = document.querySelectorAll('.day-section');
    
    daySections.forEach(section => {
        const day = section.dataset.day;
        const accountsList = section.querySelector('.day-accounts-list');
        const key = `daySection_${licenseId}_${day}_collapsed`;
        const savedState = localStorage.getItem(key);
        
        if (savedState === 'true' && accountsList) {
            section.classList.add('collapsed');
            accountsList.style.display = 'none';
        } else if (accountsList) {
            section.classList.remove('collapsed');
            accountsList.style.display = 'block';
        }
    });
}

// Configurar los campos editables de cuentas vendidas (días)
function setupEditableDayAccounts(licenseId) {
    const dayAccountItems = document.querySelectorAll('.day-account-item');
    
    dayAccountItems.forEach((item) => {
        // Hacer editable al hacer doble clic
        if (!item.dataset.isNew) {
            item.addEventListener('dblclick', function(e) {
                if (e.target.closest('.btn-delete-day-account')) return;
                
                // Hacer editable
                this.contenteditable = 'true';
                this.classList.add('editing');
                
                // Remover el botón de eliminar mientras edita
                const deleteBtn = this.querySelector('.btn-delete-day-account');
                if (deleteBtn) {
                    deleteBtn.style.display = 'none';
                }
                
                // Seleccionar todo el texto
                setTimeout(() => {
                    const range = document.createRange();
                    range.selectNodeContents(this);
                    range.collapse(false);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }, 0);
            });
        } else {
            // Si es nuevo, ya es editable
            item.contenteditable = 'true';
        }
        
        // Guardar automáticamente después de dejar de escribir (como Colornote)
        let saveTimeout;
        let isSaving = false;
        let lastSavedText = '';
        const day = parseInt(item.dataset.day) || new Date().getDate();
        
        // Función para guardar
        const saveItem = async function() {
            const text = this.innerText || this.textContent || '';
            
            // Evitar guardar si no hay cambios o si ya se está guardando
            if (text.trim() === lastSavedText || isSaving) {
                return;
            }
            
            if (text.trim()) {
                isSaving = true;
                const accountId = this.dataset.accountId;
                const isNew = this.dataset.isNew === 'true';
                const currentDay = parseInt(this.dataset.day) || day;
                
                try {
                    if (isNew || !accountId) {
                        // Es un nuevo correo, guardarlo masivamente
                        await saveBulkAccountsForDay(licenseId, text, currentDay);
                    } else {
                        // Es un correo existente editado, actualizarlo o crear múltiples
                        await updateOrCreateMultipleAccounts(licenseId, parseInt(accountId), text, currentDay);
                    }
                    lastSavedText = text.trim();
                } catch (error) {
                    console.error('Error al guardar:', error);
                } finally {
                    isSaving = false;
                }
            }
        };
        
        const handleInput = function() {
            clearTimeout(saveTimeout);
            
            // Resaltar emails y passwords en tiempo real
            highlightEmailsAndPasswords(this);
            
            // Guardar automáticamente después de 500ms de inactividad (más rápido, como Colornote)
            saveTimeout = setTimeout(() => {
                saveItem.call(this);
            }, 500);
        };
        
        item.addEventListener('input', handleInput);
        
        // Guardar al presionar Ctrl+Enter
        item.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(saveTimeout);
                saveItem.call(this);
            }
            
            // Salir del modo edición con Escape
            if (e.key === 'Escape') {
                this.contenteditable = 'false';
                this.classList.remove('editing');
                const deleteBtn = this.querySelector('.btn-delete-day-account');
                if (deleteBtn) {
                    deleteBtn.style.display = '';
                }
                // Recargar para restaurar el estado original
                loadAllDaysSoldAccounts(licenseId);
            }
        });
        
        // Guardar inmediatamente al perder el foco (blur) y manejar salida del modo edición
        item.addEventListener('blur', function() {
            clearTimeout(saveTimeout);
            saveItem.call(this);
            
            if (!this.dataset.isNew && this.classList.contains('editing')) {
                this.contenteditable = 'false';
                this.classList.remove('editing');
                const deleteBtn = this.querySelector('.btn-delete-day-account');
                if (deleteBtn) {
                    deleteBtn.style.display = '';
                }
            }
            
            // Manejar placeholder para items nuevos (vacío)
            if (this.dataset.isNew === 'true') {
                if (this.textContent.trim() === '') {
                    this.classList.add('empty');
                } else {
                    this.classList.remove('empty');
                }
            }
        });
        
        // Inicializar el texto guardado
        if (item.dataset.isNew !== 'true') {
            lastSavedText = (item.innerText || item.textContent || '').trim();
        }
    });
}

// Configurar el campo de entrada para agregar correos vendidos
function setupSoldAccountsInput(licenseId, day) {
    const soldInput = document.getElementById('soldAccountsInput');
    if (!soldInput) return;
    
    soldInput.dataset.licenseId = licenseId;
    soldInput.dataset.day = day;
    
    let saveTimeout;
    
    soldInput.addEventListener('input', function() {
        highlightEmailsAndPasswords(this);
        
        // Guardar automáticamente después de 2 segundos sin escribir
        clearTimeout(saveTimeout);
        const text = this.innerText || this.textContent || '';
        
        saveTimeout = setTimeout(async () => {
            if (text.trim() && licenseId) {
                await saveSoldAccounts(licenseId, text, day);
            }
        }, 2000);
    });
    
    // Guardar al presionar Ctrl+Enter o Cmd+Enter
    soldInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(saveTimeout);
            const text = this.innerText || this.textContent || '';
            if (text.trim() && licenseId) {
                saveSoldAccounts(licenseId, text, day);
            }
        }
    });
    
    // Manejar placeholder
    soldInput.addEventListener('focus', function() {
        if (this.textContent.trim() === '' || this.textContent === this.dataset.placeholder) {
            this.textContent = '';
        }
    });
    
    soldInput.addEventListener('blur', function() {
        if (this.textContent.trim() === '') {
            this.textContent = this.dataset.placeholder || '';
            this.classList.add('empty');
        } else {
            this.classList.remove('empty');
        }
    });
    
    // Inicializar placeholder
    if (!soldInput.textContent.trim()) {
        soldInput.textContent = soldInput.dataset.placeholder || '';
        soldInput.classList.add('empty');
    }
}

// Guardar cuentas vendidas masivamente
async function saveSoldAccounts(licenseId, text, day) {
    if (typeof text !== 'string') {
        text = text.innerText || text.textContent || '';
    }
    
    if (!text || !text.trim()) {
        return;
    }
    
    const accounts = parseAccountsText(text);
    
    if (accounts.length === 0) {
        return;
    }
    
    // Crear la fecha con el día seleccionado
    const now = new Date();
    const saleDate = new Date(now.getFullYear(), now.getMonth(), day);
    
    // Guardar cada cuenta como vendida
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
            // Primero crear la cuenta
            const createResponse = await fetch(`/tienda/api/licenses/${licenseId}/accounts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    account_identifier: account.identifier,
                    email: account.email,
                    password: account.password
                })
            });
            
            const createData = await createResponse.json();
            
            if (createData.success && createData.account_id) {
                // Marcar como vendida con la fecha
                await fetch(`/tienda/api/accounts/${createData.account_id}/mark-sold`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCSRFToken()
                    },
                    body: JSON.stringify({
                        sold_date: saleDate.toISOString()
                    })
                });
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }
    
    // Limpiar el campo y recargar
    const soldInput = document.getElementById('soldAccountsInput');
    if (soldInput) {
        soldInput.textContent = '';
        soldInput.innerHTML = '';
    }
    
    await loadLicenses();
    loadAndDisplaySavedAccounts(licenseId);
    loadAllDaysSoldAccounts(licenseId);
}

// Eliminar cuenta sin mostrar mensajes
async function deleteAccountSilently(accountId, licenseId) {
    try {
        const response = await fetch(`/tienda/api/accounts/${accountId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Recargar licencias y actualizar las listas
            await loadLicenses();
            loadAndDisplaySavedAccounts(licenseId);
            loadAllDaysSoldAccounts(licenseId);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}


// Filtrar licencias basado en correos
function filterLicenses() {
    const searchInput = document.getElementById('adminStoreSearch');
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    const cards = document.querySelectorAll('.license-card');
    
    // Si no hay término de búsqueda, mostrar todo y quitar resaltado
    if (!searchTerm) {
    cards.forEach(card => {
            card.classList.remove('hidden-by-search');
        });
        const inputContainer = document.getElementById('licenseAccountsInputContainer');
        if (inputContainer) {
            inputContainer.classList.remove('search-active');
        }
        removeEmailHighlights();
        return;
    }
    
    // Marcar que hay búsqueda activa
    const inputContainer = document.getElementById('licenseAccountsInputContainer');
    if (inputContainer) {
        inputContainer.classList.add('search-active');
    }
    
    // Buscar en correos de cada licencia
    cards.forEach(card => {
        const licenseId = parseInt(card.dataset.licenseId);
        const license = licenses.find(l => l.id === licenseId);
        
        if (!license || !license.accounts) {
            card.classList.add('hidden-by-search');
            return;
        }
        
        // Buscar si algún correo coincide con el término de búsqueda
        let hasMatchingEmail = false;
        license.accounts.forEach(account => {
            if (account.email && account.email.toLowerCase().includes(searchTerm)) {
                hasMatchingEmail = true;
            }
        });
        
        // Mostrar u ocultar la tarjeta según si tiene correos que coincidan
        if (hasMatchingEmail) {
            card.classList.remove('hidden-by-search');
        } else {
            card.classList.add('hidden-by-search');
        }
    });
    
    // Resaltar correos que coincidan
    highlightMatchingEmails(searchTerm);
}

// Resaltar correos que coincidan con el término de búsqueda
function highlightMatchingEmails(searchTerm) {
    if (!searchTerm || searchTerm.length < 1) {
        removeEmailHighlights();
        return;
    }
    
    // Resaltar en cuentas guardadas
    document.querySelectorAll('.saved-account-item').forEach(item => {
        const emailSpan = item.querySelector('.saved-account-email');
        if (emailSpan) {
            const email = emailSpan.textContent.toLowerCase();
            if (email.includes(searchTerm)) {
                item.classList.add('search-match');
                emailSpan.classList.add('search-highlight');
            } else {
                item.classList.remove('search-match');
                emailSpan.classList.remove('search-highlight');
            }
        }
    });
    
    // Resaltar en cuentas de días
    document.querySelectorAll('.day-account-item').forEach(item => {
        const emailSpan = item.querySelector('.day-account-email');
        if (emailSpan) {
            const email = emailSpan.textContent.toLowerCase();
            if (email.includes(searchTerm)) {
                item.classList.add('search-match');
                emailSpan.classList.add('search-highlight');
            } else {
                item.classList.remove('search-match');
                emailSpan.classList.remove('search-highlight');
            }
        }
    });
}

// Remover resaltado de correos
function removeEmailHighlights() {
    document.querySelectorAll('.saved-account-item, .day-account-item').forEach(item => {
        item.classList.remove('search-match');
        const emailSpan = item.querySelector('.saved-account-email, .day-account-email');
        if (emailSpan) {
            emailSpan.classList.remove('search-highlight');
        }
    });
}

// Inicializar licencias desde productos existentes
async function initializeLicensesFromProducts() {
    try {
        const response = await fetch('/tienda/api/licenses/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Recargar las licencias para mostrar las nuevas
            await loadLicenses();
        } else {
            console.error('Error al inicializar licencias:', data.error);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Verificar y corregir duplicados solo si es necesario
async function checkAndFixDuplicates() {
    try {
        // Obtener todas las licencias
        await loadLicenses();
        
        if (licenses.length === 0) {
            return;
        }
        
        // Verificar si hay duplicados
        const positions = licenses.map(license => license.position);
        const uniquePositions = [...new Set(positions)];
        
        if (positions.length === uniquePositions.length) {
            return;
        }
        await reorganizeAllLicenses();
        
    } catch (error) {
        console.error('Error al verificar duplicados:', error);
    }
}

// Reorganizar todas las licencias para eliminar duplicados
async function reorganizeAllLicenses() {
    try {
        // Obtener todas las licencias
        await loadLicenses();
        
        if (licenses.length === 0) {
            return;
        }
        
        // Reorganizar cada licencia secuencialmente
        for (let i = 0; i < licenses.length; i++) {
            const license = licenses[i];
            const newPosition = i + 1;
            
            if (license.position !== newPosition) {
                try {
                    const response = await fetch(`/tienda/api/licenses/${license.id}/position`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({ 
                            position: newPosition,
                            reorganize: false  // No reorganizar para evitar bucles
                        })
                    });
                    
                    const data = await response.json();
                    if (!data.success) {
                        console.error(`Error al reorganizar licencia ${license.id}:`, data.error);
                    }
                } catch (error) {
                    console.error(`Error al reorganizar licencia ${license.id}:`, error);
                }
            }
        }
        
        // Recargar las licencias para mostrar las posiciones actualizadas
        await loadLicenses();
        
    } catch (error) {
        console.error('Error al reorganizar licencias:', error);
    }
}

// Mostrar menú de licencia archivada
function showArchivedLicenseMenu(licenseId) {
    // Cerrar otros menús
    document.querySelectorAll('.archived-license-menu').forEach(menu => {
        menu.style.display = 'none';
    });

    // Buscar o crear el menú para esta licencia
    let menu = document.querySelector(`.archived-license-menu[data-license-id="${licenseId}"]`);
    if (!menu) {
        menu = createArchivedLicenseMenu(licenseId);
        document.body.appendChild(menu); // Agregar al body para posicionamiento fijo
    }

    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        // Posicionar el modal correctamente
        const button = document.querySelector(`.archived-license-card[data-license-id="${licenseId}"] .archived-license-action-btn`);
        if (button) {
            const rect = button.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            
            // Calcular posición centrada
            const menuWidth = 180; // Ancho del modal archivado
            const viewportWidth = window.innerWidth;
            const buttonCenterX = rect.left + rect.width / 2;
            
            let leftPosition = buttonCenterX - menuWidth / 2;
            
            // Ajustar si se sale por la izquierda
            if (leftPosition < 10) {
                leftPosition = 10;
            }
            
            // Ajustar si se sale por la derecha
            if (leftPosition + menuWidth > viewportWidth - 10) {
                leftPosition = viewportWidth - menuWidth - 10;
            }
            
            // Posicionar el modal
            menu.style.left = (leftPosition + scrollLeft) + 'px';
            menu.style.top = (rect.top + scrollTop - 10) + 'px';
        }
        menu.style.display = 'block';
    }
}

// Crear menú de licencia archivada
function createArchivedLicenseMenu(licenseId) {
    const menu = document.createElement('div');
    menu.className = 'archived-license-menu';
    menu.dataset.licenseId = licenseId;
    menu.style.display = 'none';

    menu.innerHTML = `
        <div class="archived-license-menu-content">
            <button class="archived-license-menu-item" onclick="restoreLicense(${licenseId})">
                <i class="fas fa-undo"></i> Desarchivar
            </button>
        </div>
    `;

    return menu;
}

// Restaurar licencia archivada
async function restoreLicense(licenseId) {
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
                showSuccess('Licencia restaurada correctamente');
                await loadLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al restaurar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al restaurar la licencia');
        }
    } catch (error) {
        console.error('Error al restaurar licencia:', error);
        showError('Error de conexión al restaurar la licencia');
    }
}

// Ir a la página de archivados
function goToArchivedPage() {
    window.location.href = '/tienda/admin/archivados';
}

// Eliminar licencia permanentemente
async function deleteLicense(licenseId) {
    if (!confirm('¿Estás seguro de que quieres eliminar permanentemente esta licencia? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Licencia eliminada correctamente');
                await loadLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al eliminar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al eliminar la licencia');
        }
    } catch (error) {
        console.error('Error al eliminar licencia:', error);
        showError('Error de conexión al eliminar la licencia');
    }
}

// Mostrar menú de opciones de licencia
function showLicenseMenu(licenseId) {
    // Ocultar otros menús abiertos
    document.querySelectorAll('.license-menu').forEach(menu => {
        if (menu.dataset.licenseId !== licenseId.toString()) {
            menu.style.display = 'none';
        }
    });
    
    // Buscar o crear el menú para esta licencia
    let menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    
    if (!menu) {
        // Crear el menú si no existe
        menu = createLicenseMenu(licenseId);
        document.body.appendChild(menu); // Agregar al body para posicionamiento fijo
    }
    
    // Toggle del menú
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        // Posicionar el modal correctamente
        const button = document.querySelector(`.license-card[data-license-id="${licenseId}"] .license-action-btn`);
        if (button) {
            const rect = button.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            
            // Calcular posición centrada
            const menuWidth = 200; // Ancho del modal
            const viewportWidth = window.innerWidth;
            const buttonCenterX = rect.left + rect.width / 2;
            
            let leftPosition = buttonCenterX - menuWidth / 2;
            
            // Ajustar si se sale por la izquierda
            if (leftPosition < 10) {
                leftPosition = 10;
            }
            
            // Ajustar si se sale por la derecha
            if (leftPosition + menuWidth > viewportWidth - 10) {
                leftPosition = viewportWidth - menuWidth - 10;
            }
            
            // Posicionar el modal
            menu.style.left = (leftPosition + scrollLeft) + 'px';
            menu.style.top = (rect.top + scrollTop - 10) + 'px';
        }
        menu.style.display = 'block';
    }
}

function createLicenseMenu(licenseId) {
    const menu = document.createElement('div');
    menu.className = 'license-menu';
    menu.dataset.licenseId = licenseId;
    menu.style.display = 'none';

    // Buscar la posición de la licencia
    const license = licenses.find(l => l.id === licenseId);
    const position = license ? license.position : 1;

    menu.innerHTML = `
        <div class="license-menu-content">
            <button class="license-menu-item" onclick="changeLicensePosition(${licenseId})">
                <i class="fas fa-sort"></i> ${position} Cambiar Posición
            </button>
            <button class="license-menu-item" onclick="archiveLicense(${licenseId})">
                <i class="fas fa-archive"></i> Archivar
            </button>
        </div>
    `;

    return menu;
}

// Archivar licencia
async function archiveLicense(licenseId) {
    if (!confirm('¿Estás seguro de que quieres archivar esta licencia?')) {
        return;
    }

    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/archive`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                showSuccess('Licencia archivada correctamente');
                await loadLicenses(); // Recargar para actualizar la vista
            } else {
                showError('Error al archivar la licencia: ' + (data.error || 'Error desconocido'));
            }
        } else {
            showError('Error del servidor al archivar la licencia');
        }
    } catch (error) {
        console.error('Error al archivar licencia:', error);
        showError('Error de conexión al archivar la licencia');
    }
}

// Cambiar posición de licencia
async function changeLicensePosition(licenseId) {
    const newPosition = prompt('Ingresa la nueva posición:');
    if (newPosition === null || newPosition.trim() === '') return;
    
    const position = parseInt(newPosition);
    if (isNaN(position) || position < 1) {
        showError('La posición debe ser un número mayor a 0');
        return;
    }
    
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/position`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({ 
                position: position,
                reorganize: false  // No reorganizar automáticamente
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess(`Posición actualizada a ${position}. Las otras licencias se reorganizaron automáticamente.`);
            // Actualizar el menú si está abierto
            const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
            if (menu) {
                const changePositionBtn = menu.querySelector('button[onclick*="changeLicensePosition"]');
                if (changePositionBtn) {
                    changePositionBtn.innerHTML = `<i class="fas fa-sort"></i> ${position} Cambiar Posición`;
                }
            }
        } else {
            showError(data.error || 'Error al actualizar posición');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al actualizar posición');
    }
    
    // Ocultar menú
    const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Ocultar licencia
async function toggleLicenseVisibility(licenseId) {
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess('Licencia ocultada correctamente');
        } else {
            showError(data.error || 'Error al ocultar licencia');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al ocultar licencia');
    }
    
    // Ocultar menú
    const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Mostrar licencia (restaurar)
async function restoreLicenseVisibility(licenseId) {
    try {
        const response = await fetch(`/tienda/api/licenses/${licenseId}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadLicenses();
            showSuccess('Licencia mostrada correctamente');
        } else {
            showError(data.error || 'Error al mostrar licencia');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al mostrar licencia');
    }
    
    // Ocultar menú
    const menu = document.querySelector(`.license-menu[data-license-id="${licenseId}"]`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Mostrar modal para agregar licencia
function showAddLicenseModal() {
    // Implementar modal para crear nueva licencia
}

// Utilidades
function getCSRFToken() {
    const token = document.querySelector('meta[name="csrf_token"]');
    return token ? token.getAttribute('content') : '';
}

function showSuccess(message) {
    // Implementar notificación de éxito
    alert('✓ ' + message);
}

function showError(message) {
    // Implementar notificación de error
    alert('✗ ' + message);
}

// Actualizar contador de archivados
function updateArchivedCount(count) {
    const countElement = document.getElementById('archivadosCount');
    if (countElement) {
        countElement.textContent = `(${count})`;
    }
}

// Configurar botones del menú 4
document.addEventListener('DOMContentLoaded', function() {
    // Botón de gestionar productos
    const btnGestionarProductos = document.getElementById('btnGestionarProductos');
    if (btnGestionarProductos) {
        btnGestionarProductos.addEventListener('click', function() {
            showGestionarProductosModal();
        });
    }
    
    // Botón de archivados
    const btnArchivados = document.getElementById('btnArchivados');
    if (btnArchivados) {
        btnArchivados.addEventListener('click', function() {
            window.location.href = '/tienda/admin/archivados';
        });
    }
});

// Mostrar modal de gestionar productos
function showGestionarProductosModal() {
    // Filtrar solo licencias activas
    const activeLicenses = licenses.filter(license => license.enabled);
    
    if (activeLicenses.length === 0) {
        showError('No hay productos para gestionar');
        return;
    }
    
    // Ordenar por posición
    const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
    
    // Crear HTML del modal
    const modalHtml = `
        <div class="modal-overlay" id="gestionarProductosModal">
            <div class="modal" style="max-width: 600px; width: 70%; max-height: 65vh; overflow-y: auto;">
                <div style="padding: 1rem 0.75rem 0.75rem 0.75rem;">
                    <div style="text-align: center; margin-bottom: 0.75rem;">
                        <h3 style="margin: 0; font-size: 0.85rem;"><i class="fas fa-list"></i> Gestionar Productos</h3>
                    </div>
                    <div id="productosList" style="display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.8rem;">
                        ${sortedLicenses.map((license, index) => `
                            <div class="producto-item" data-license-id="${license.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 0rem 0.5rem;">
                                <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
                                    <strong style="font-size: 0.8rem; font-weight: 600;">${license.product_name}</strong>
                                </div>
                                <div style="display: flex; gap: 0.4rem; align-items: center;">
                                    <button class="btn btn-sm" style="padding: 4px 8px; font-size: 0.7rem;" onclick="changeProductPosition(${license.id})">
                                        C. P. <span style="color: #666; font-size: 0.7rem;">${license.position}</span>
                                    </button>
                                    <button class="btn btn-sm btn-danger" style="padding: 4px 8px; font-size: 0.85rem;" onclick="archiveProductFromModal(${license.id})" title="Archivar">
                                        <i class="fas fa-archive"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Insertar modal en el DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Agregar funcionalidad para cerrar al hacer clic fuera del modal
    const modalOverlay = document.getElementById('gestionarProductosModal');
    modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) {
            closeGestionarProductosModal();
        }
    });
}

// Cerrar modal de gestionar productos
function closeGestionarProductosModal() {
    const modal = document.getElementById('gestionarProductosModal');
    if (modal) {
        modal.remove();
    }
}

// Cambiar posición de producto desde el modal
async function changeProductPosition(licenseId) {
    const newPosition = prompt('Ingresa la nueva posición (número):');
    if (!newPosition || isNaN(parseInt(newPosition))) {
        return;
    }
    
    const position = parseInt(newPosition);
    const license = licenses.find(l => l.id === licenseId);
    
    if (!license) {
        showError('Producto no encontrado');
        return;
    }
    
    const currentPosition = license.position;
    
    // Obtener todas las licencias activas ordenadas por posición
    const activeLicenses = licenses.filter(l => l.enabled);
    const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
    
    // Calcular las nuevas posiciones para todos los productos
    const updates = [];
    
    for (let i = 0; i < sortedLicenses.length; i++) {
        const lic = sortedLicenses[i];
        let newPos;
        
        if (lic.id === licenseId) {
            // El producto que movemos
            newPos = position;
        } else if (currentPosition < position) {
            // Moviendo hacia abajo
            if (lic.position > currentPosition && lic.position <= position) {
                newPos = lic.position - 1;
            } else {
                newPos = lic.position;
            }
        } else {
            // Moviendo hacia arriba
            if (lic.position >= position && lic.position < currentPosition) {
                newPos = lic.position + 1;
            } else {
                newPos = lic.position;
            }
        }
        
        if (newPos !== lic.position) {
            updates.push({ id: lic.id, position: newPos });
        }
    }
    
    try {
        // Actualizar todas las posiciones
        for (const update of updates) {
            const response = await fetch(`/tienda/api/licenses/${update.id}/position`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({ position: update.position })
            });
            
            if (!response.ok) {
                throw new Error(`Error al actualizar posición ${update.position}`);
            }
        }
        
        showSuccess('Posiciones reorganizadas correctamente');
        await loadLicenses();
        closeGestionarProductosModal();
        showGestionarProductosModal();
    } catch (error) {
        console.error('Error:', error);
        showError('Error al reorganizar posiciones');
    }
}

// Archivar producto desde el modal
async function archiveProductFromModal(licenseId) {
    if (!confirm('¿Estás seguro de que quieres archivar este producto?')) {
        return;
    }
    
    const license = licenses.find(l => l.id === licenseId);
    
    if (!license) {
        showError('Producto no encontrado');
        return;
    }
    
    try {
        // Archivar el producto
        const response = await fetch(`/tienda/api/licenses/${licenseId}/archive`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                // Recargar licencias para obtener las actualizadas
                await loadLicenses();
                
                // Reorganizar posiciones de productos activos restantes
                const activeLicenses = licenses.filter(l => l.enabled);
                const sortedLicenses = [...activeLicenses].sort((a, b) => a.position - b.position);
                
                // Reorganizar posiciones: 1, 2, 3, 4, etc.
                const updates = [];
                for (let i = 0; i < sortedLicenses.length; i++) {
                    const newPos = i + 1;
                    if (sortedLicenses[i].position !== newPos) {
                        updates.push({ id: sortedLicenses[i].id, position: newPos });
                    }
                }
                
                // Actualizar todas las posiciones
                for (const update of updates) {
                    const updateResponse = await fetch(`/tienda/api/licenses/${update.id}/position`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCSRFToken()
                        },
                        body: JSON.stringify({ position: update.position })
                    });
                    
                    if (!updateResponse.ok) {
                        console.error(`Error al actualizar posición ${update.position}`);
                    }
                }
                
                showSuccess('Producto archivado y posiciones reorganizadas correctamente');
                await loadLicenses();
                closeGestionarProductosModal();
                showGestionarProductosModal();
            } else {
                showError('Error al archivar el producto');
            }
        } else {
            showError('Error del servidor al archivar el producto');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión al archivar el producto');
    }
}
