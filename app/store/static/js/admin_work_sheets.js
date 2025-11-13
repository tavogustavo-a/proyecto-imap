/***************************************************
 * ADMIN WORK SHEETS - SISTEMA DE HOJAS DE CÁLCULO
 * ================================================
 * Versión: 3.1.0 - Optimizada y refactorizada
 * 
 * ESTRUCTURA:
 * 1. Variables Globales y Configuración
 * 2. Sistema de Deshacer/Rehacer Robusto  
 * 3. Funciones de Utilidad y Helpers
 * 4. Sistema de Selección y Eventos
 * 5. Renderizado de Tablas
 * 6. Funcionalidades Avanzadas
 ***************************************************/

// CONFIGURACIÓN

// Variables principales de plantillas y datos
let selectedFields = [];
let plantillas = [];
let tablaDatos = [];
let selectedTemplateId = localStorage.getItem('selectedWorksheetTemplateId') || null;
let searchQuery = '';
let worksheetMode = localStorage.getItem('worksheetMode') || 'standard';

// NOTA: Sistema de campos fijados removido por completo

// Paginación
let currentPage = Number(localStorage.getItem('worksheetCurrentPage')) || 1;
let rowsPerPage = 300;
const rowsPerPageOptions = [300, 500, 1000, 2000, 4000, 6000, 'todos'];

// Variables para selección múltiple por drag en columna números
let isDraggingRows = false;
let dragStartRow = -1;
let selectedRowsForDrag = new Set();
let rowDragMouseDown = false;

// (Mantenidas para compatibilidad)
let filtrosActivos = false;
let filtrosConfigurados = {};
let criteriosOrden = [];
let criteriosSeleccionados = [];

// Variables de selección y portapapeles (declaradas aquí para evitar problemas)
let selectionStartCell = null;
let selectedCells = new Set();
let selectedRows = new Set();
let selectedColumns = new Set();

// Variables de configuración de sistemas (declaradas aquí para evitar errores de inicialización)
let activityDetectionSetup = false;
let copyListenersSetup = false;
let connectionLogsSystemSetup = false;
let infoAdicionalListenersSetup = false;
let globalSystemsInitialized = false;
let universalClosestProtectionSetup = false;
let closestPolyfillSetup = false;
let lastSelectedCell = null;
let keyboardEventsSetup = false;


let clipboardData = null;
let clipboardMode = null; 
let clipboardSelection = null;

// Función de debounce para optimizar actualizaciones
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Sistema de cache ULTRA-OPTIMIZADO para updateDuplicateStyles
const duplicateStylesCache = new Map();
let lastDuplicateCheck = 0;
const DUPLICATE_CHECK_INTERVAL = 25; // ms - OPTIMIZADO para máxima velocidad

// Versión optimizada de updateDuplicateStyles con cache y debounce
const debouncedUpdateDuplicateStyles = debounce(updateDuplicateStyles, 50); // Reducido de 150ms a 50ms

// Guarda página actual en localStorage con validación
function saveCurrentPage(page) {
    // Asegura que la página sea válida (mayor a 0)
    currentPage = Math.max(1, Number(page) || 1);
    localStorage.setItem('worksheetCurrentPage', currentPage);
}

// Guarda posición de celda activa
function saveActiveCellPosition(row, col) {
    const position = { row: row, col: col };
    localStorage.setItem('worksheetActiveCell', JSON.stringify(position));
}

// Obtiene posición de celda activa guardada
function getSavedActiveCellPosition() {
    try {
        const saved = localStorage.getItem('worksheetActiveCell');
        return saved ? JSON.parse(saved) : null;
    } catch (error) {
        return null;
    }
}

// Limpia posición de celda activa guardada
function clearSavedActiveCellPosition() {
    localStorage.removeItem('worksheetActiveCell');
}


function restoreActiveCellFocus() {
    // NO restaurar foco si el usuario está escribiendo en el campo de búsqueda
    const mainSearchInput = document.getElementById('mainSearchInput');
    if (mainSearchInput && document.activeElement === mainSearchInput) {
        return; // Mantener el foco en el campo de búsqueda
    }
    
    // Restaura foco en plantilla activa
    const currentPlantilla = getCurrentPlantilla();
    if (!currentPlantilla) return;
    
    const position = getSavedActiveCellPosition();
    if (position && position.row !== undefined && position.col !== undefined) {
        // Verifica que la posición sea válida para la plantilla actual
        if (position.row >= 0 && position.col >= 0 && 
            position.col < currentPlantilla.campos.length &&
            tablaDatos && position.row < tablaDatos.length) {
            
            // Espera a que termine el renderizado
            setTimeout(() => {
                // Verificar de nuevo que el usuario no esté escribiendo
                const mainSearchInput = document.getElementById('mainSearchInput');
                if (mainSearchInput && document.activeElement === mainSearchInput) {
                    return; // No quitar el foco del campo de búsqueda
                }
                
                const cellInput = getCellElement(position.row, position.col);
                if (cellInput) {
                    cellInput.focus();
                    // Selecciona la celda para feedback visual
                    clearAllSelections();
                    addCellToSelection(position.row, position.col);
                    lastSelectedCell = [position.row, position.col];
                }
            }, 100); // Optimizado para hojas de cálculo - reducido de 150ms a 100ms
        } else {
            // Si la posición no es válida, limpiarla
            clearSavedActiveCellPosition();
        }
    }
}


// UNIFICADO Y LIMPIO


// Sistema centralizado del sistema de filtros
const FiltersState = {
    active: false,
    selectedCriteria: [],
    configured: {},
    
    
    reset() {
        this.active = false;
        this.selectedCriteria = [];
        this.configured = {};
        
        // Sincronizar con sistema viejo para compatibilidad
        filtrosActivos = false;
        filtrosConfigurados = {};
        criteriosOrden = [];
        criteriosSeleccionados = [];
    },
    
    // Evitar duplicados
    addCriterion(criterion) {
        const exists = this.selectedCriteria.findIndex(c => 
            c.type === criterion.type && c.value === criterion.value
        );
        
        if (exists === -1) {
            const newCriterion = {
                ...criterion,
                id: Date.now() + Math.random(),
                displayText: this.generateDisplayText(criterion)
            };
            this.selectedCriteria.push(newCriterion);
            
            // Sincronizar con sistema viejo para compatibilidad
            criteriosSeleccionados.push(newCriterion);
            criteriosOrden.push({
                tipo: criterion.type,
                valor: criterion.value,
                textoDisplay: this.generateDisplayText(criterion)
            });
            
            return true;
        }
        return false;
    },
    
    
    removeCriterion(id) {
        const criterion = this.selectedCriteria.find(c => c.id === id);
        this.selectedCriteria = this.selectedCriteria.filter(c => c.id !== id);
        
        // Sincronizar con sistema viejo para compatibilidad
        if (criterion) {
            criteriosSeleccionados = criteriosSeleccionados.filter(c => 
                !(c.type === criterion.type && c.value === criterion.value)
            );
            criteriosOrden = criteriosOrden.filter(c => 
                !(c.tipo === criterion.type && c.valor === criterion.value)
            );
        }
    },
    
    // Generar texto de display para criterio
    generateDisplayText(criterion) {
        switch (criterion.type) {
            case 'domain':
                return `Dominio: ${criterion.value}`;
            case 'color':
                const colorNames = {
                    '': 'Sin color', '1': 'Verde (1)', '2': 'Rojo (2)', 
                    '3': 'Azul (3)', '4': 'Naranja (4)', '5': 'Morado (5)',
                    '6': 'Rosado (6)', '8': 'Negro (8)'
                };
                return `Color: ${colorNames[criterion.value] || criterion.value}`;
            case 'number':
                return `Número: ${criterion.value === '' ? 'Sin número' : criterion.value}`;
            case 'text':
                return `Texto: ${criterion.value}`;
            case 'letters':
                return `Letras: ${criterion.value}`;
            default:
                return `${criterion.type}: ${criterion.value}`;
        }
    },
    
    // Validar con la plantilla actual
    validateCriteria() {
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (!plantilla || !plantilla.datos) {
            return this.selectedCriteria; // No hay plantilla o datos válidos
        }
        
        if (!Array.isArray(this.selectedCriteria) || this.selectedCriteria.length === 0) {
            return [];
        }
        
        return this.selectedCriteria.filter(criterion => {
            if (!criterion || !criterion.type) {
                return false;
            }
            
            // Buscar campos "numero"
            if (criterion.type === 'color') {
                return Array.isArray(plantilla.campos) && plantilla.campos.length > 0 && 
                       plantilla.campos.some(campo => campo === 'numero');
            }
            
            // Verificar que el valor no esté vacío
            if (['domain', 'text', 'letters'].includes(criterion.type)) {
                return criterion.value != null && String(criterion.value).trim() !== '';
            }
            
            // Para número, permitir valores vacíos (sin número)
            if (criterion.type === 'number') {
                return criterion.value != null;
            }
            
            return true;
        });
    }
};

// Obtener elementos del DOM de filtros
function getFilterElements() {
    return {
        btnApply: document.getElementById('btnAplicarFiltros'),
        btnLimpiar: document.getElementById('btnLimpiarFiltros'),
        btnGuardar: document.getElementById('btnGuardarFiltros'),
        container: document.getElementById('filtrosOrdenados')
    };
}

// Función para aplicar
function updateApplyButtonState(enabled = true) {
    const { btnApply } = getFilterElements();
    if (btnApply) {
        btnApply.disabled = !enabled;
        btnApply.style.opacity = enabled ? '1' : '0.5';
        btnApply.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }
}

// Obtener elementos de inputs de filtros
function getFilterInputElements() {
    return {
        dominioSelect: document.getElementById('filtroDominio'),
        dominioCustom: document.getElementById('dominioCustom'),
        filtroLetras: document.getElementById('filtroLetras'),
        filtroTexto: document.getElementById('filtroTexto')
    };
}

// Generar opciones de color simplificadas (sin "sin color")
function generarOpcionesColorSimplificado() {
    const uniqueId = Date.now() + Math.random().toString(36).substr(2, 9);
    const colors = [
        { value: '1', label: 'Verde (1)' },
        { value: '2', label: 'Rojo (2)' },
        { value: '3', label: 'Azul (3)' },
        { value: '4', label: 'Naranja (4)' },
        { value: '5', label: 'Morado (5)' },
        { value: '6', label: 'Rosado (6)' },
        { value: '8', label: 'Negro (8)' }
    ];
    
    return colors.map((color, index) => 
        `<label><input type="checkbox" id="color_${uniqueId}_${index}" name="color_filter_${uniqueId}_${index}" value="${color.value}"> ${color.label}</label>`
    ).join('');
}

// Generar opciones de números con IDs únicos
function generarOpcionesNumeroSimplificado() {
    const uniqueId = Date.now() + Math.random().toString(36).substr(2, 9);
    const numbers = [
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
        { value: '5', label: '5' },
        { value: '6', label: '6' },
        { value: '8', label: '8' }
    ];
    
    return numbers.map((number, index) => 
        `<label><input type="checkbox" id="numero_${uniqueId}_${index}" name="numero_filter_${uniqueId}_${index}" value="${number.value}"> ${number.label}</label>`
    ).join('');
}

// Renderizar criterios seleccionados
function renderSelectedCriteria() {
    const { container } = getFilterElements();
    if (!container) return;

    if (FiltersState.selectedCriteria.length === 0) {
        container.innerHTML = `
            <p class="worksheet-info-message">
                Los criterios aparecerán aquí en el orden que los selecciones<br>
                <small>Ese será el orden de organización en la tabla</small><br>
                <small class="worksheet-info-tip">💡 Los criterios sin datos se ignoran automáticamente</small>
            </p>`;
        updateApplyButtonState(false);
        return;
    }

    container.innerHTML = FiltersState.selectedCriteria.map((criterion, index) => 
        `<div class="filtro-orden-item" data-id="${criterion.id}" data-index="${index}" draggable="true">
            <span class="orden-numero">${index + 1}</span>
            <span class="criterio-texto">${criterion.displayText}</span>
            <span class="remove-filter" onclick="removeCriterionById(${criterion.id})">&times;</span>
        </div>`
    ).join('');
    
    const validCriteria = FiltersState.validateCriteria();
    updateApplyButtonState(validCriteria.length > 0);
    
    // Configurar drag and drop después de renderizar
    setTimeout(() => {
        configurarDragAndDrop();
    }, 50);
}


function addCriterionToList(type, value) {
    if (!type || value === null || value === undefined) return;
    
    
    if (['domain', 'text', 'letters'].includes(type) && 
        (!value || value.trim() === '')) return;
    
    const criterion = { type, value };
    if (FiltersState.addCriterion(criterion)) {
        renderSelectedCriteria();
    }
}


function removeCriterionById(id) {
    const criterion = FiltersState.selectedCriteria.find(c => c.id === id);
    
    FiltersState.removeCriterion(id);
    renderSelectedCriteria();
    
    // Desmarcar checkbox dependiente si es necesario
    if (criterion && ['color', 'number'].includes(criterion.type)) {
        const checkbox = document.querySelector(`input[type="checkbox"][value="${criterion.value}"]`);
        if (checkbox) checkbox.checked = false;
    }
    
    // Limpiar input de texto correspondiente
    if (criterion) {
        const { dominioCustom, dominioSelect, filtroLetras, filtroTexto } = getFilterInputElements();
        
        switch (criterion.type) {
            case 'domain':
                if (dominioCustom) dominioCustom.value = '';
                if (dominioSelect) dominioSelect.value = '';
                break;
            case 'letters':
                if (filtroLetras) filtroLetras.value = '';
                break;
            case 'text':
                if (filtroTexto) filtroTexto.value = '';
                break;
        }
    }
}

// Función disponible globalmente para onclick
window.removeCriterionById = removeCriterionById;

// Configurar eventos del modal de filtros
function setupModalFilterEvents(campo, colIndex, modal) {
    
    const closeBtn = modal.querySelector('#cerrarModalFiltros');
    const cancelBtn = modal.querySelector('#btnCancelarFiltros');
    
    [closeBtn, cancelBtn].forEach(btn => {
        if (btn) {
            btn.onclick = () => modal.remove();
        }
    });
    
    // Cerrar al hacer clic en el fondo)
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Evitar que clics dentro del contenido del modal lo cierren
    const modalContent = modal.querySelector('div');
    if (modalContent) {
        modalContent.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    // Cerrar con ESC
    const handleEscKey = function(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', handleEscKey);
        }
    };
    document.addEventListener('keydown', handleEscKey);
    
    // Al aplicar filtros - verificar duplicados antes de validar criterios
    const applyBtn = modal.querySelector('#btnAplicarFiltros');
    if (applyBtn) {
        applyBtn.onclick = () => {
            // Navegación a página 1 antes de aplicar filtros
            currentPage = 1;
            saveCurrentPage(1);
            
            // Inmediatamente
            const tipoFiltroSeleccionado = document.querySelector('input[name="tipoFiltroTexto"]:checked')?.value;
            if (tipoFiltroSeleccionado === 'duplicados') {
                aplicarFiltros(campo, colIndex);
                modal.remove();
                return;
            }
            
            // Para filtros normales, verificar criterios
            const validCriteria = FiltersState.validateCriteria();
            if (validCriteria.length === 0) {
                showClipboardIndicator('⚠️ Debes seleccionar al menos un criterio de filtro');
                return;
            }
            
            // Aplicar filtros
            aplicarFiltros(campo, colIndex);
            modal.remove();
        };
    }
    
    // Configurar eventos específicos después de un breve delay
    setTimeout(() => {
        setupInputEvents(campo);
        setupRadioEvents(campo);
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
}

// Configurar eventos de radio buttons con manejo de duplicados
function setupRadioEvents(campo) {
    const radioButtons = document.querySelectorAll(`input[name^="tipoFiltro"]`);
    const sectionMap = {
        'dominio': 'seccionDominio',
        'color': 'seccionColor', 
        'texto': 'seccionTexto',
        'numeros': 'seccionNumeros'
    };
    
    radioButtons.forEach(radio => {
        radio.addEventListener('change', function() {
            // Líneas
            Object.values(sectionMap).forEach(seccionId => {
                const seccion = document.getElementById(seccionId);
                if (seccion) seccion.style.display = 'none';
            });
            
            // Mostrar sección correspondiente
            const targetSection = sectionMap[this.value];
            if (targetSection) {
                const seccion = document.getElementById(targetSection);
                if (seccion) seccion.style.display = 'block';
            }
            
            // Manejar estado del botón para duplicados
            updateApplyButtonForDuplicates(this.value);
        });
    });
}

// Función para manejar el estado del botón con duplicados
function updateApplyButtonForDuplicates(selectedType) {
    if (selectedType === 'duplicados') {
        // Habilitar inmediatamente para duplicados
        updateApplyButtonState(true);
    } else {
        // Para filtros normales
        const validCriteria = FiltersState.validateCriteria();
        updateApplyButtonState(validCriteria.length > 0);
    }
}

// Configurar eventos de inputs específicos
function setupInputEvents(campo) {
    const { dominioSelect, dominioCustom, filtroLetras, filtroTexto } = getFilterInputElements();
    
    // Input personalizado de dominio
    if (dominioCustom) {
        dominioCustom.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const valor = e.target.value.trim();
                if (valor) {
                    if (dominioSelect) dominioSelect.value = '';
                    addCriterionToList('domain', valor);
                }
            }
        });
    }
    
    // Inicio
    if (dominioSelect) {
        dominioSelect.addEventListener('change', (e) => {
            const valor = e.target.value;
            if (valor) {
                if (dominioCustom) dominioCustom.value = '';
                addCriterionToList('domain', valor);
            }
        });
    }
    
    // Input de letras
    if (filtroLetras) {
        filtroLetras.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const valor = e.target.value.trim();
                if (valor) addCriterionToList('letters', valor);
            }
        });
    }
    
    // Input de texto
    if (filtroTexto) {
        filtroTexto.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const valor = e.target.value.trim();
                if (valor) addCriterionToList('text', valor);
            }
        });
    }
    
    
    const colorCheckboxes = document.querySelectorAll('.color-filters input[type="checkbox"]');
    colorCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                addCriterionToList('color', this.value);
            } else {
                const criterion = FiltersState.selectedCriteria.find(c => 
                    c.type === 'color' && c.value === this.value
                );
                if (criterion) removeCriterionById(criterion.id);
            }
        });
    });
    
    // Números
    const numeroCheckboxes = document.querySelectorAll('.numero-filters input[type="checkbox"]');
    numeroCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                addCriterionToList('number', this.value);
            } else {
                const criterion = FiltersState.selectedCriteria.find(c => 
                    c.type === 'number' && c.value === this.value
                );
                if (criterion) removeCriterionById(criterion.id);
            }
        });
    });
}

// Funciones comunes de plantilla
function validateTemplate(template, requireData = false, requireOriginalData = false) {
    if (!template) return false;
    if (requireData && (!Array.isArray(template.datos) || template.datos.length === 0)) return false;
    if (requireOriginalData && (!Array.isArray(template.datosOriginales) || template.datosOriginales.length === 0)) return false;
    return true;
}

// FUNCIONES PARA GENERAR OPCIONES DE FILTROS

// Código duplicado eliminado

function mostrarModalFiltrosPersonalizado(campo, colIndex) {
    let filtroContent = '';
    
    // Con especificaciones: solo color, dominio, número y texto
    switch(campo) {
        case 'correo':
            filtroContent = `
                <div class="filtro-section">
                    <h6>Ordenar por (Solo uno activo)</h6>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="ninguno" checked>
                            Ninguno (sin ordenamiento)
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="dominio">
                            Ordenar por Dominio
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="color">
                            Ordenar por Color
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="texto">
                            Ordenar por Texto
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="duplicados">
                            <strong>🔍 Mostrar duplicados ordenados</strong>
                        </label>
                    </div>
                    
                    <div id="seccionDominio" style="display: none;">
                        <h6>Filtrar por Dominio</h6>
                        <select id="filtroDominio" class="form-select mb-2">
                            <option value="">Seleccionar dominio</option>
                            <option value="gmail.com">gmail.com</option>
                            <option value="hotmail.com">hotmail.com</option>
                            <option value="yahoo.com">yahoo.com</option>
                            <option value="outlook.com">outlook.com</option>
                        </select>
                        <input type="text" id="dominioCustom" class="form-control mb-2" placeholder="O escribir dominio personalizado">
                    </div>
                    
                    <div id="seccionColor" style="display: none;">
                        <h6>Filtrar por Color</h6>
                        <div class="color-filters">
                            ${generarOpcionesColorSimplificado()}
                        </div>
                    </div>
                    
                    <div id="seccionTexto" style="display: none;">
                        <h6>Filtrar por Texto</h6>
                        <input type="text" id="filtroTexto" class="form-control mb-2" placeholder="Texto a buscar" value="">
                    </div>
                </div>
                <div class="filtro-section">
                    <h6>Orden de Filtros Aplicados</h6>
                    <div id="filtrosOrdenados" class="filtros-ordenados-container">
                        <!-- Se llenarán dinámicamente según las selecciones -->
                    </div>
                </div>
            `;
            break;
        case 'numero':
            // Para número: solo color y número (simplificado)
            filtroContent = `
                <div class="filtro-section">
                    <h6>Ordenar por (Solo uno activo)</h6>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroNumero" value="ninguno" checked>
                            Ninguno (sin ordenamiento)
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroNumero" value="color">
                            Ordenar por Color
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroNumero" value="numeros">
                            Ordenar por Número
                        </label>
                    </div>
                    
                    <div id="seccionColor" style="display: none;">
                        <h6>Filtrar por Color</h6>
                        <div class="color-filters">
                            ${generarOpcionesColorSimplificado()}
                        </div>
                    </div>
                    
                    <div id="seccionNumeros" style="display: none;">
                        <h6>Filtrar por Números</h6>
                        <div class="numero-filters">
                            ${generarOpcionesNumeroSimplificado()}
                        </div>
                    </div>
                </div>
                <div class="filtro-section">
                    <h6>Orden de Filtros Aplicados</h6>
                    <div id="filtrosOrdenados" class="filtros-ordenados-container">
                        <!-- Se llenarán dinámicamente según las selecciones -->
                    </div>
                </div>
            `;
            break;
        default: // Para contraseña, links, letras, etc.
            // Mostrar "duplicados" para correo, contraseña y links
            let duplicadosOption = '';
            if (campo === 'correo' || campo === 'contraseña' || campo === 'links') {
                duplicadosOption = `
                    <label style="display: block; margin-bottom: 0.5rem;">
                        <input type="radio" name="tipoFiltroTexto" value="duplicados">
                        <strong>🔍 Mostrar duplicados ordenados</strong>
                    </label>`;
            }
            
            filtroContent = `
                <div class="filtro-section">
                    <h6>Ordenar por (Solo uno activo)</h6>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="ninguno" checked>
                            Ninguno (sin ordenamiento)
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="color">
                            Ordenar por Color
                        </label>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="radio" name="tipoFiltroTexto" value="texto">
                            Ordenar por Texto
                        </label>
                        ${duplicadosOption}
                    </div>
                    
                    <div id="seccionTexto" style="display: none;">
                        <h6>Filtrar por Texto</h6>
                        <input type="text" id="filtroTexto" class="form-control mb-2" placeholder="Buscar texto específico" value="">
                    </div>
                    
                    <div id="seccionColor" style="display: none;">
                        <h6>Filtrar por Color</h6>
                        <div class="color-filters">
                            ${generarOpcionesColorSimplificado()}
                        </div>
                    </div>
                </div>
                <div class="filtro-section">
                    <h6>Orden de Filtros Aplicados</h6>
                    <div id="filtrosOrdenados" class="filtros-ordenados-container">
                        <!-- Se llenarán dinámicamente según las selecciones -->
                    </div>
                </div>
            `;
            break;
    }

        // Remover modal anterior si existe
    document.querySelectorAll('.filtro-modal').forEach(el => el.remove());

    // Modal personalizado
    const modal = document.createElement('div');
    modal.className = 'filtro-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '3000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    modal.innerHTML = `
        <div class='modal-content-responsive' style='background:#fff;padding:20px;border-radius:10px;min-width:300px;max-width:95vw;max-height:95vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);margin:10px;'>
            <div class='modal-header-responsive' style='display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #dee2e6;padding-bottom:15px;flex-wrap:wrap;'>
                <h4 style='margin:0;color:#495057;font-size:1.1rem;'>
                    <i class="fas fa-filter worksheet-filter-icon"></i>
                    Filtros para ${optimizedFunctions.getStandardFieldNames()[campo] || campo}
                </h4>
                <button id='cerrarModalFiltros' style='background:none;border:none;font-size:24px;cursor:pointer;color:#6c757d;padding:5px;'>&times;</button>
            </div>
            <div style='margin-bottom:20px;'>
                ${filtroContent}
            </div>
            <div class='modal-buttons-responsive' style='display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #dee2e6;padding-top:15px;flex-wrap:wrap;'>
                <button id='btnCancelarFiltros' class='btn-panel btn-red' style='min-width:100px;'>Cancelar</button>
                <button id='btnAplicarFiltros' class='btn-panel btn-blue' data-campo="${campo}" data-col-index="${colIndex}" style='min-width:100px;'>
                    <i class="fas fa-check"></i> Aplicar Filtros
                </button>
            </div>
        </div>
    `;

    
    document.body.appendChild(modal);

    // Configurar event listeners para radio buttons (mostrar/ocultar secciones)
    setTimeout(() => {
        setupRadioEvents(campo);
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms

    // Crear estilos si no existen
    if (!document.getElementById('filtro-modal-styles')) {
        const styles = document.createElement('style');
        styles.id = 'filtro-modal-styles';
        styles.textContent = `
            .filtro-section {
                margin-bottom: 1.5rem;
                padding: 1rem;
                border: 1px solid #dee2e6;
                border-radius: 0.375rem;
                background-color: #f8f9fa;
            }
            .filtro-section h6 {
                margin-bottom: 0.75rem;
                color: #495057;
                font-weight: 600;
            }
            .color-filters, .numero-filters {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
            }
            .color-filters label, .numero-filters label {
                display: flex;
                align-items: center;
                gap: 0.25rem;
                padding: 0.25rem 0.5rem;
                border: 1px solid #dee2e6;
                border-radius: 0.25rem;
                background-color: white;
                cursor: pointer;
                font-size: 0.875rem;
            }
            .color-filters label:hover, .numero-filters label:hover {
                background-color: #e9ecef;
            }
            .th-filter-icon {
                color: #007bff;
                cursor: pointer;
                margin-left: 0.5rem;
            }
            .th-filter-icon:hover {
                color: #0056b3;
            }
            .worksheet-mode-filtro .th-filter-icon {
                display: inline;
            }

                            .filtro-activo {
                    background-color: #d4edda !important;
                    border-color: #c3e6cb !important;
                }
                .filtros-ordenados-container {
                    min-height: 40px;
                    border: 2px dashed #dee2e6;
                    border-radius: 0.375rem;
                    padding: 0.5rem;
                    margin-bottom: 1rem;
                }
                .filtro-orden-item {
                    display: inline-flex;
                    align-items: center;
                    background: #f8f9fa;
                    border: 1px solid #dee2e6;
                    border-radius: 0.25rem;
                    padding: 0.25rem 0.5rem;
                    margin: 0.25rem;
                    cursor: move;
                    user-select: none;
                }
                .filtro-orden-item:hover {
                    background: #e9ecef;
                }
                .filtro-orden-item .remove-filter {
                    color: #dc3545;
                    cursor: pointer;
                    margin-left: 0.5rem;
                    font-weight: bold;
                }
                .filtro-orden-item .remove-filter:hover {
                    color: #c82333;
                }
                .orden-criterio-dropdown {
                    background: white;
                    border: 1px solid #dee2e6;
                    border-radius: 0.25rem;
                    position: absolute;
                    z-index: 1000;
                    max-height: 200px;
                    overflow-y: auto;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .orden-criterio-item {
                    padding: 0.5rem;
                    cursor: pointer;
                    border-bottom: 1px solid #f8f9fa;
                }
                .orden-criterio-item:hover {
                    background: #f8f9fa;
                }
                
                /* Estilos responsive para el modal */
                @media (max-width: 768px) {
                    .modal-content-responsive {
                        margin: 5px !important;
                        padding: 15px !important;
                        min-width: 280px !important;
                        max-width: 98vw !important;
                        max-height: 98vh !important;
                    }
                    
                    .modal-header-responsive h4 {
                        font-size: 1rem !important;
                        flex: 1;
                        margin-right: 10px;
                    }
                    
                    .modal-buttons-responsive {
                        flex-direction: column !important;
                        gap: 8px !important;
                    }
                    
                    .modal-buttons-responsive button {
                        width: 100% !important;
                        min-width: auto !important;
                    }
                    
                    .filtro-section {
                        margin-bottom: 1rem !important;
                        padding: 0.75rem !important;
                    }
                    
                    .color-filters, .numero-filters {
                        gap: 0.25rem !important;
                    }
                    
                    .color-filters label, .numero-filters label {
                        font-size: 0.8rem !important;
                        padding: 0.2rem 0.4rem !important;
                    }
                }
                
                @media (max-width: 480px) {
                    .modal-content-responsive {
                        margin: 2px !important;
                        padding: 12px !important;
                        border-radius: 8px !important;
                    }
                    
                    .modal-header-responsive {
                        margin-bottom: 15px !important;
                        padding-bottom: 10px !important;
                    }
                    
                    .filtro-section h6 {
                        font-size: 0.9rem !important;
                        margin-bottom: 0.5rem !important;
                    }
                }
                
                /* Scroll horizontal para tablas - FORZAR scroll sin reducir tamaño */
                .table-responsive {
                    overflow-x: auto !important;
                    overflow-y: visible !important;
                    -webkit-overflow-scrolling: touch !important;
                    border-radius: 0.375rem !important;
                    border: 1px solid #dee2e6 !important;
                    width: 100% !important;
                    position: relative !important;
                }
                
                /* Forzar scroll horizontal en todas las pantallas pequeñas */
                @media (max-width: 1200px) {
                    .table-responsive {
                        max-width: calc(100vw - 40px) !important;
                        overflow-x: scroll !important;
                        border: 1px solid #dee2e6 !important;
                        border-radius: 0.375rem !important;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
                        margin: 0 auto !important;
                    }
                    
                    #worksheetTable {
                        min-width: 1000px !important;
                        width: auto !important;
                        table-layout: fixed !important;
                        white-space: nowrap !important;
                    }
                    
                    #worksheetTable th,
                    #worksheetTable td {
                        min-width: 120px !important;
                        max-width: 200px !important;
                        width: 150px !important;
                        padding: 8px 6px !important;
                        font-size: 13px !important;
                        word-wrap: break-word !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                    }
                    
                    #worksheetTable th.col-numeracion,
                    #worksheetTable td.col-numeracion,
                    #worksheetTable th[data-col-index]:first-child,
                    #worksheetTable td[data-row-header="true"] {
                        min-width: 60px !important;
                        max-width: 60px !important;
                        width: 60px !important;
                    }
                }
                
                @media (max-width: 768px) {
                    .table-responsive {
                        max-width: calc(100vw - 20px) !important;
                    }
                    
                    #worksheetTable {
                        min-width: 800px !important;
                    }
                    
                    #worksheetTable th,
                    #worksheetTable td {
                        min-width: 100px !important;
                        width: 120px !important;
                        font-size: 12px !important;
                    }
                }
                
                /* Mejoras para dispositivos táctiles */
                @media (hover: none) and (pointer: coarse) {
                    .copy-icon {
                        min-width: 44px !important;
                        min-height: 44px !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        padding: 8px !important;
                        margin: 2px !important;
                        border-radius: 4px !important;
                        background: rgba(0, 123, 255, 0.1) !important;
                        border: 1px solid rgba(0, 123, 255, 0.2) !important;
                    }
                    
                    .copy-icon:active {
                        background: rgba(0, 123, 255, 0.2) !important;
                        transform: scale(0.95) !important;
                    }
                    
                    .cell-copyable {
                        min-height: 44px !important;
                        padding: 8px !important;
                        border-radius: 4px !important;
                    }
                    
                    .cell-copyable:active {
                        background: rgba(0, 123, 255, 0.1) !important;
                    }
                    
                    .btn-panel {
                        min-height: 44px !important;
                        padding: 12px 16px !important;
                        font-size: 16px !important;
                    }
                    
                    /* Selección múltiple en dispositivos táctiles */
                    .cell-selected {
                        background-color: rgba(0, 123, 255, 0.2) !important;
                        border: 2px solid #007bff !important;
                    }
                    
                    .row-selected {
                        background-color: rgba(0, 123, 255, 0.1) !important;
                    }
                    

                    
                    /* Estilos para paletas de colores */
                    .color-swatch:hover {
                        transform: scale(1.1) !important;
                        border-color: #007bff !important;
                        box-shadow: 0 2px 8px rgba(0,123,255,0.3) !important;
                    }
                    
                    .format-btn:hover {
                        background-color: #f8f9fa !important;
                        border-color: #007bff !important;
                    }
                    
                    /* Clases de formato CSS */
                    .format-bold {
                        font-weight: bold !important;
                    }
                    
                    .format-underline {
                        text-decoration: underline !important;
                    }
                }
            `;
            document.head.appendChild(styles);
    }

    // Configurar todos los eventos del modal de forma centralizada
    setupModalFilterEvents(campo, colIndex, modal);

    // Configurar sistema de filtros después de mostrar el modal
    setTimeout(() => {
        configurarSistemaFiltros(campo, colIndex);
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
}

// Funcionamiento ya definidas arriba


// FUNCIONES DE LIMPIEZA Y CONFIGURACIÓN


// Funciones de limpieza (versión simplificada)
function limpiarTodosFiltros() {
    try {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (!plantilla || !plantilla.datos) {
            showClipboardIndicator(`⚠️ Error: no hay plantilla seleccionada o datos válidos`);
        return;
    }

    
    FiltersState.reset();

        // Finales
    if (Array.isArray(plantilla.datosOriginales) && plantilla.datosOriginales.length > 0) {
            plantilla.datos = JSON.parse(JSON.stringify(plantilla.datosOriginales));
            tablaDatos = plantilla.datos;
                } else {
            // Si no hay datos originales, intentar restaurar desde servidor
        restaurarDatosOriginalesEmergencia(plantilla);
        return;
                }

    // Renderizar tabla
        const container = document.getElementById('worksheetTableContainer');
        if (container && Array.isArray(plantilla.datos) && plantilla.datos.length > 0) {
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            
            // Limpiar colores de duplicados
            limpiarColoresDuplicados();
            
            showClipboardIndicator('✅ Filtros limpiados - datos restaurados');
        } else {
            showClipboardIndicator('⚠️ Error: no se pudo restaurar la tabla');
        }
    } catch (error) {
        console.error('Error en limpiarTodosFiltros:', error);
        showClipboardIndicator('⚠️ Error al limpiar filtros');
    }
}

// Funciones de emergencia en caso de emergencia
function restaurarDatosOriginalesEmergencia(plantilla) {
            fetch(`/api/store/worksheet_data/${plantilla.id}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.data && data.data.length) {
                plantilla.datos = JSON.parse(JSON.stringify(data.data));
                plantilla.datosOriginales = JSON.parse(JSON.stringify(data.data));
                tablaDatos = plantilla.datos;
                
                FiltersState.reset();
                
                const container = document.getElementById('worksheetTableContainer');
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
                showClipboardIndicator('✅ Datos restaurados desde servidor');
            } else {
                showClipboardIndicator('❌ Error: no se pudieron restaurar los datos');
            }
        })
        .catch(error => {
            showClipboardIndicator('❌ Error de conexión al restaurar datos');
        });
}

// Configurar sistema de filtros limpio
function configurarSistemaFiltros(campo, colIndex) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) {
        showClipboardIndicator(`❌ No hay plantilla seleccionada`);
        return;
    }
    
    // Inicializar datosOriginales si no existen
            if (!plantilla.datosOriginales) {
            if (Array.isArray(plantilla.datos) && plantilla.datos.length > 0) {
                plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));
            } else {
            showClipboardIndicator(`❌ Error: no hay datos válidos en la plantilla`);
            return;
        }
    }
    
    // Resetear estado anterior (ambos sistemas)
    FiltersState.reset();
    filtrosActivos = false;
    filtrosConfigurados = {};
    criteriosOrden = [];
    criteriosSeleccionados = [];
    
    // Renderizar estado inicial limpio
    renderSelectedCriteria();
    renderizarCriteriosOrden();
}





function editarCriterio(index) {
    // Funcionalidad para editar criterio (puede expandirse más adelante)
    
}

// Función para renderizar criterios ordenados
function renderizarCriteriosOrden() {
    const { container } = getFilterElements();
    if (!container) return;

    if (criteriosOrden.length === 0) {
        container.innerHTML = `
            <p class="worksheet-info-message">
                Los criterios aparecerán aquí en el orden que los selecciones<br>
                <small>Ese será el orden de organización en la tabla</small><br>
                <small class="worksheet-info-tip">💡 Los criterios sin datos se ignoran automáticamente</small>
            </p>`;
        updateApplyButtonState(false);
        return;
    }

    container.innerHTML = criteriosOrden.map((criterio, index) => 
        `<div class="filtro-orden-item" data-index="${index}" draggable="true">
            <span class="orden-numero">${index + 1}</span>
            <span class="criterio-texto">${criterio.textoDisplay || criterio.valor || 'Criterio'}</span>
            <span class="remove-filter" onclick="eliminarCriterio(${index})">&times;</span>
        </div>`
    ).join('');

    updateApplyButtonState(criteriosOrden.length > 0);
    
    // Configurar drag and drop después de renderizar
    setTimeout(() => {
    configurarDragAndDrop();
    }, 50);
}

// Función para eliminar criterio
function eliminarCriterio(index) {
    if (index >= 0 && index < criteriosOrden.length) {
    criteriosOrden.splice(index, 1);
    renderizarCriteriosOrden();
}
}

// Función disponible globalmente para onclick
window.eliminarCriterio = eliminarCriterio;

function configurarDragAndDrop() {
    try {
        const items = document.querySelectorAll('.filtro-orden-item');
        const { container } = getFilterElements();
        
        if (!container || items.length === 0) return;

        let draggedItem = null;
        let draggedIndex = null;

        items.forEach((item, index) => {
            // Asigna el atributo data-index actualizado
            item.setAttribute('data-index', index);
            
            item.addEventListener('dragstart', function(e) {
                draggedItem = this;
                draggedIndex = Number(this.getAttribute('data-index'));
                this.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', this.outerHTML);
            });

            item.addEventListener('dragend', function(e) {
                this.style.opacity = '';
                draggedItem = null;
                draggedIndex = null;
            });

            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });

            item.addEventListener('dragenter', function(e) {
                e.preventDefault();
                if (this !== draggedItem) {
                    this.style.backgroundColor = '#e3f2fd';
                }
            });

            item.addEventListener('dragleave', function(e) {
                this.style.backgroundColor = '';
            });

            item.addEventListener('drop', function(e) {
                e.preventDefault();
                this.style.backgroundColor = '';
                
                if (draggedItem && draggedItem !== this && draggedIndex !== null) {
                    const targetIndex = Number(this.getAttribute('data-index'));
                    
                    if (draggedIndex !== targetIndex) {
                        // Mover en FiltersState
                        const movedItem = FiltersState.selectedCriteria.splice(draggedIndex, 1)[0];
                        FiltersState.selectedCriteria.splice(targetIndex, 0, movedItem);
                        
                        // Sincronizar con arrays viejos
                        if (criteriosOrden.length > draggedIndex) {
                            const movedOldItem = criteriosOrden.splice(draggedIndex, 1)[0];
                            criteriosOrden.splice(targetIndex, 0, movedOldItem);
                        }
                        
                        if (criteriosSeleccionados.length > draggedIndex) {
                            const movedSelItem = criteriosSeleccionados.splice(draggedIndex, 1)[0];
                            criteriosSeleccionados.splice(targetIndex, 0, movedSelItem);
                        }
                        
                        // Re-renderizar
                        renderSelectedCriteria();
                    }
                }
            });
        });

        // Configurar drag and drop en el contenedor
        container.addEventListener('dragover', function(e) {
            e.preventDefault();
        });

        container.addEventListener('drop', function(e) {
            e.preventDefault();
        });
        
    } catch (error) {
        console.error('Error en aplicarFiltros:', error);
    }
}

// UNIFICADO LIMPIA Y SIMPLE


function aplicarFiltros(campo, colIndex) {
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!validateTemplate(plantilla, false, true)) {
        showClipboardIndicator(`⚠️ Error: plantilla inválida o sin datos originales`);
        return;
    }

    // Verificar si se seleccionó filtro de duplicados
    const tipoFiltroSeleccionado = document.querySelector('input[name="tipoFiltroTexto"]:checked')?.value;
    
    if (tipoFiltroSeleccionado === 'duplicados') {
        // Procesar filtro de duplicados
        const resultadoDuplicados = procesarFiltroDuplicados(plantilla, campo, colIndex);
        if (resultadoDuplicados) {
            aplicarResultadoFiltro(resultadoDuplicados, plantilla, campo, colIndex);
            return;
        }
    }

    // Verificar si se seleccionó filtro de números
    const tipoFiltroNumeroSeleccionado = document.querySelector('input[name="tipoFiltroNumero"]:checked')?.value;
    
    if (tipoFiltroNumeroSeleccionado && tipoFiltroNumeroSeleccionado !== 'ninguno') {
        // Procesar filtro de números especial
        const resultadoNumeros = procesarFiltroNumeros(plantilla, campo, colIndex, tipoFiltroNumeroSeleccionado);
        if (resultadoNumeros) {
            aplicarResultadoFiltro(resultadoNumeros, plantilla, campo, colIndex);
            return;
        }
    }

    // Verificar si se seleccionó filtro de texto o color para otros campos
    const tipoFiltroTextoSeleccionado = document.querySelector('input[name="tipoFiltroTexto"]:checked')?.value;
    
    if (tipoFiltroTextoSeleccionado && tipoFiltroTextoSeleccionado !== 'ninguno' && tipoFiltroTextoSeleccionado !== 'duplicados') {
        // Procesar filtro de texto
        const resultadoTexto = procesarFiltroTexto(plantilla, campo, colIndex, tipoFiltroTextoSeleccionado);
        if (resultadoTexto) {
            aplicarResultadoFiltro(resultadoTexto, plantilla, campo, colIndex);
            return;
        }
    }

    // Criterios seleccionados (para filtros normales)
    const validCriteria = FiltersState.validateCriteria();
    if (validCriteria.length === 0) {
        showClipboardIndicator(`ℹ️ Sin criterios válidos seleccionados`);
        return;
    }

    // Procesar criterios normales y aplicar filtros normales
    const datosParaFiltrar = JSON.parse(JSON.stringify(plantilla.datosOriginales));
    const resultado = procesarCriterios(datosParaFiltrar, validCriteria, plantilla, colIndex);
    
    if (!resultado.datos || resultado.datos.length === 0) {
        showClipboardIndicator(`⚠️ Error procesando filtros`);
        return;
    }

    // Activar filtros
    FiltersState.active = true;
    FiltersState.configured[colIndex] = { campo, criterios: validCriteria };
    
    // Sincronizar con sistema viejo
    filtrosActivos = true;
    filtrosConfigurados[colIndex] = { campo, config: { criteriosSeleccionados: validCriteria } };
    
    plantilla.datos = resultado.datos;
    tablaDatos = resultado.datos;
    
    // Navegación y renderizar
    saveCurrentPage(1);
    
    try {
        const container = document.getElementById('worksheetTableContainer');
        optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
        
        // Mensaje de resultado
        const efectivos = resultado.criteriosEfectivos.length;
        const ignorados = validCriteria.length - efectivos;
    
        let mensaje;
        if (ignorados === 0) {
            mensaje = `✅ Filtros aplicados: ${efectivos} criterios organizaron los datos`;
        } else if (efectivos === 0) {
            mensaje = `ℹ️ Ningún criterio encontró datos coincidentes`;
        } else {
            mensaje = `✅ Filtros parciales: ${efectivos}/${validCriteria.length} criterios aplicados (${ignorados} sin datos)`;
        }
    
        showClipboardIndicator(mensaje);
    } catch (error) {
        console.error('Error en mostrarDatosFiltrados:', error);
        showClipboardIndicator(`⚠️ Error al mostrar datos filtrados`);
    }
}

// Función simplificada para procesar criterios
function procesarCriterios(datos, criterios, plantilla, colIndex) {
    // Validaciones básicas
    if (!Array.isArray(datos) || datos.length === 0) {
        return { datos: datos || [], criteriosEfectivos: [] };
    }
    
    if (!criterios || criterios.length === 0) {
        return { datos: datos, criteriosEfectivos: [] };
    }
    
    const filasOrganizadas = [];
    const filasUsadas = new Set();
    const criteriosEfectivos = [];

    // Procesar en orden
    criterios.forEach((criterio) => {
        const filasParaEsteCriterio = [];
        
        datos.forEach((fila, filaIndex) => {
            if (filasUsadas.has(filaIndex)) return;
            
            if (cumpleCriterio(fila, criterio, plantilla, colIndex)) {
                filasParaEsteCriterio.push(fila);
                filasUsadas.add(filaIndex);
            }
        });
        
        if (filasParaEsteCriterio.length > 0) {
            filasOrganizadas.push(...filasParaEsteCriterio);
            criteriosEfectivos.push(criterio);
        }
    });
    
    // Agregar filas no procesadas al final
    datos.forEach((fila, filaIndex) => {
        if (!filasUsadas.has(filaIndex)) {
            filasOrganizadas.push(fila);
        }
    });
    
    
    const resultadoFinal = filasOrganizadas.length > 0 ? filasOrganizadas : datos;
    
    return {
        datos: resultadoFinal,
        criteriosEfectivos: criteriosEfectivos
    };
}

// Verifica si una fila cumple un criterio específico
function cumpleCriterio(fila, criterio, plantilla, colIndex) {
    if (!fila || !Array.isArray(fila) || !criterio || !plantilla) {
        return false;
    }

    switch (criterio.type) {
        case 'domain':
            // Columna específica donde se aplicó el filtro
            if (colIndex === null || colIndex === undefined || colIndex >= fila.length) {
                return false;
            }
            
            const valorDomain = String(fila[colIndex] || '').toLowerCase();
            return valorDomain.includes('@') && valorDomain.includes(criterio.value.toLowerCase());
            
        case 'color':
            // Buscar en la columna 'numero'
            const plantilla = optimizedFunctions.getCurrentPlantilla();
            if (!plantilla) return false;
            
            const numeroColIndex = plantilla.campos.findIndex(campo => campo === 'numero');
            if (numeroColIndex === -1 || numeroColIndex >= fila.length) {
                return false;
            }
            
            const colorValue = String(fila[numeroColIndex] || '').trim();
            
            // Excluir opción "sin color"
            return colorValue === criterio.value && criterio.value !== '';
            
        case 'number':
            // Columna específica donde se aplicó el filtro
            if (colIndex === null || colIndex === undefined || colIndex >= fila.length) {
                return false;
            }
            
            const valorOriginalNum = fila[colIndex];
            const valorNum = String(valorOriginalNum || '').trim();
            
            // Solo números específicos - sin opción "sin número"
            return valorNum === criterio.value && criterio.value !== '';
            
        case 'text':
        case 'letters':
            // Columna específica donde se aplicó el filtro
            if (colIndex === null || colIndex === undefined || colIndex >= fila.length) {
                return false;
            }
            
            const valorText = String(fila[colIndex] || '').toLowerCase();
            return valorText.includes(criterio.value.toLowerCase());
            
        default:
            return false;
    }
}




// Funciones de ordenamiento simplificadas (solo para compatibilidad)
function ordenarPorColor(datos, colIndex) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    const numeroColIndex = plantilla.campos.findIndex(campo => campo === 'numero');
    
    return datos.sort((a, b) => {
        const colorA = (numeroColIndex !== -1 ? a[numeroColIndex] : '') || '';
        const colorB = (numeroColIndex !== -1 ? b[numeroColIndex] : '') || '';
        
        if (!colorA && colorB) return -1;
        if (colorA && !colorB) return 1;
        if (!colorA && !colorB) return 0;
        
        return parseInt(colorA) - parseInt(colorB);
    });
}

function guardarFiltrosAplicados() {
    try {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (!plantilla) {
            showClipboardIndicator('⚠️ Error: no hay plantilla seleccionada');
        return;
    }

        if (!plantilla.datos || !Array.isArray(plantilla.datos)) {
            showClipboardIndicator('⚠️ Error: no hay datos para guardar');
        return;
    }

        // Si no hay filtros activos, al menos guardamos el estado actual
        if (!FiltersState.active && !filtrosActivos) {
            showClipboardIndicator('ℹ️ Guardando estado actual de la tabla...');
    }

    const datosParaGuardar = JSON.parse(JSON.stringify(plantilla.datos));

    saveWorksheetData(plantilla, 
        () => {
                // Actualizar datos originales con el nuevo orden
            plantilla.datosOriginales = JSON.parse(JSON.stringify(datosParaGuardar));
                
                // Resetear filtros
            FiltersState.reset();
                filtrosActivos = false;
                filtrosConfigurados = {};
                
                // Re-renderizar tabla después de guardar para evitar que las celdas desaparezcan
                const container = document.getElementById('worksheetTableContainer');
                if (container && plantilla.datosOriginales) {
                    // Usar datos originales actualizados para mostrar todo
                    const plantillaCompleta = {
                        ...plantilla,
                        datos: plantilla.datosOriginales
                    };
                    optimizedFunctions.renderTablaEditable(plantillaCompleta, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
                    
                    
                    limpiarColoresDuplicados();
                }
                
                // Actualizar interfaz del botón
                const { btnGuardar } = getFilterElements();
                if (btnGuardar) {
                    const originalText = btnGuardar.innerHTML;
                    const originalClass = btnGuardar.className;
                    
                    btnGuardar.disabled = true;
                    btnGuardar.innerHTML = '<i class="fas fa-check"></i> Guardado';
                    btnGuardar.className = 'btn-panel btn-success';
                
                setTimeout(() => {
                        btnGuardar.disabled = false;
                        btnGuardar.innerHTML = originalText;
                        btnGuardar.className = originalClass;
                    }, 2000);
                }
                
                // Cambios guardados permanentemente - tabla restaurada
            },
            (error) => {
            showClipboardIndicator('❌ Error al guardar datos');
        }
    );
    } catch (error) {
        showClipboardIndicator('❌ Error al guardar');
    }
}


// FUNCIONES DE RECOPILACIÓN Y CONFIGURACIÓN


// Función de compatibilidad para el sistema antiguo de filtros
function recopilarConfiguracionFiltro(campo) {
    return {
        tipoFiltro: 'ninguno',
        criteriosSeleccionados: [...FiltersState.selectedCriteria]
    };
}

// Funciones de filtrado específicas
function filtrarCorreo(datos, colIndex, config) {
    return datos.filter(fila => {
        const valor = fila[colIndex] || '';
        let cumple = true;
        
        // Dominio
        if (config.dominio || config.dominioCustom) {
            const dominioFiltro = config.dominioCustom || config.dominio;
            cumple = cumple && valor.toLowerCase().includes(dominioFiltro.toLowerCase());
        }
        
        // Filtro por colores (usando número asociado)
        if (config.colores.length > 0) {
            const numeroAsociado = obtenerNumeroAsociado(fila, colIndex);
            cumple = cumple && config.colores.includes(numeroAsociado);
        }
        
        return cumple;
    }).sort((a, b) => {
        if (config.orden === 'asc') {
            return (a[colIndex] || '').localeCompare(b[colIndex] || '');
        } else if (config.orden === 'desc') {
            return (b[colIndex] || '').localeCompare(a[colIndex] || '');
        }
        return 0;
    });
}

function filtrarContraseña(datos, colIndex, config) {
    return datos.filter(fila => {
        let cumple = true;
        
        // Filtrar por número asociado
        if (config.colores.length > 0) {
            const numeroAsociado = obtenerNumeroAsociado(fila, colIndex);
            cumple = cumple && config.colores.includes(numeroAsociado);
        }
        
        return cumple;
    }).sort((a, b) => {
        if (config.orden === 'asc') {
            return (a[colIndex] || '').localeCompare(b[colIndex] || '');
        } else if (config.orden === 'desc') {
            return (b[colIndex] || '').localeCompare(a[colIndex] || '');
        }
        return 0;
    });
}

function filtrarLinks(datos, colIndex, config) {
    return datos.filter(fila => {
        let cumple = true;
        
        // Filtrar por número asociado
        if (config.colores.length > 0) {
            const numeroAsociado = obtenerNumeroAsociado(fila, colIndex);
            cumple = cumple && config.colores.includes(numeroAsociado);
        }
        
        return cumple;
    });
}

function filtrarLetras(datos, colIndex, config) {
    return datos.filter(fila => {
        const valor = fila[colIndex] || '';
        let cumple = true;
        
        
        if (config.letras) {
            cumple = cumple && valor.toLowerCase().includes(config.letras.toLowerCase());
        }
        
        // Filtrar por número asociado
        if (config.colores.length > 0) {
            const numeroAsociado = obtenerNumeroAsociado(fila, colIndex);
            cumple = cumple && config.colores.includes(numeroAsociado);
        }
        
        return cumple;
    });
}

function filtrarNumero(datos, colIndex, config) {
    return datos.filter(fila => {
        const valor = fila[colIndex] || '';
        let cumple = true;
        
        // Filtrar por números específicos
        if (config.numeros.length > 0) {
            cumple = cumple && config.numeros.includes(valor);
        }
        
        // Filtrar por número asociado
        if (config.colores.length > 0) {
            const numeroAsociado = obtenerNumeroAsociado(fila, colIndex);
            cumple = cumple && config.colores.includes(numeroAsociado);
        }
        
        return cumple;
    });
}

function filtrarOtroCampo(datos, colIndex, config) {
    return datos.filter(fila => {
        const valor = fila[colIndex] || '';
        let cumple = true;
        
        
        if (config.texto) {
            cumple = cumple && valor.toLowerCase().includes(config.texto.toLowerCase());
        }
        
        // Filtrar por número asociado
        if (config.colores.length > 0) {
            const numeroAsociado = obtenerNumeroAsociado(fila, colIndex);
            cumple = cumple && config.colores.includes(numeroAsociado);
        }
        
        return cumple;
    });
}

// Obtener el número asociado a una celda (para filtros de color)
function obtenerNumeroAsociado(fila, colIndex) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return '';
    
    // Columna de números en la plantilla
    const numeroColIndex = plantilla.campos.findIndex(campo => campo === 'numero');
    if (numeroColIndex !== -1 && fila[numeroColIndex]) {
        return fila[numeroColIndex];
    }
    
    return '';
}

// Variables para manejo de elementos duplicados
let isSelecting = false;
let dragStartCell = null;
let isDragging = false;
let selectIsOpen = false;
let searchTimeout = null;


let globalSearchResults = [];
let currentGlobalSearch = '';


// FUNCIONES HELPER PARA REDUCIR CÓDIGO REPETITIVO


// Obtener plantilla actual (usado 23 veces)
function getCurrentPlantilla() {
    // Búsqueda confiable
    let plantilla = null;
    
    if (selectedTemplateId) {
        plantilla = plantillas.find(p => p.id === selectedTemplateId);
    }
    
    // Si no se encuentra por ID, intentar por datos coincidentes
    if (!plantilla) {
        plantilla = plantillas.find(p => p.datos === tablaDatos);
    }
    
    // Usar primera plantilla disponible
    if (!plantilla && plantillas.length > 0) {
        plantilla = plantillas[0];
    }
    
    return plantilla;
}

// Función para verificar si el usuario actual es admin
function isCurrentUserAdmin() {
    // Obtener el username del usuario actual desde la sesión o localStorage
    const currentUsername = sessionStorage.getItem('currentUsername') || 
                          localStorage.getItem('currentUsername') || 
                          document.querySelector('meta[name="current_user"]')?.content;
    
    // Obtener el admin user desde la meta etiqueta
    const adminUser = document.querySelector('meta[name="admin_user"]')?.content;
    
    // Comparar comparando con el admin configurado
    return currentUsername === adminUser;
}


// FUNCIONES DE UTILIDAD Y HELPERS


// Nombres estándar de campos (consolidado)
function getStandardFieldNames() {
    // Obtener el modo actual de forma segura
    const currentMode = worksheetMode || 'standard';
    
    // En modo agregar, mostrar texto normal
    if (currentMode === 'agregar') {
    return {
        'correo': 'Correo',
        'contraseña': 'Contraseña', 
        'links': 'Links',
        'letras': 'Letras',
            'informacion-adicional': 'Información adicional',
            'numero': '#',
            'let': 'Let',
            'otro-campo': 'Otro campo'
        };
    } else if (currentMode === 'filtro') {
        // En modo filtro, mostrar texto normal
        return {
            'correo': 'Correo',
            'contraseña': 'Contraseña', 
            'links': 'Links',
            'letras': 'Letras',
            'informacion-adicional': 'Información adicional',
            'numero': '#',
            'let': 'Let',
            'otro-campo': 'Otro campo'
        };
    } else {
        // En otros modos (standard, copiar), mostrar texto normal
        return {
            'correo': 'Correo',
            'contraseña': 'Contraseña', 
            'links': 'Links',
            'letras': 'Let.',
            'informacion-adicional': 'Información adicional',
            'numero': '#',
        'let': 'Let',
        'otro-campo': 'Otro campo'
    };
    }
}

// Contraseña
function isEmailField(campo) {
    return campo === 'correo';
}

function isPasswordField(campo) {
    return campo === 'contraseña';
}

function isEmailOrPasswordField(campo) {
    return isEmailField(campo) || isPasswordField(campo);
}
// Helper para dividir texto entre columnas (como Excel)
function splitTextAcrossColumns() {
    const selection = getSelectionInfo();
    
    if (selection.cells.length === 0) {
        showClipboardIndicator('⚠️ Selecciona celdas con texto para dividir');
        return;
    }
    
    // Configurar la división
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
    
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;max-width:600px;box-shadow:0 4px 20px rgba(0,0,0,0.15);position:relative;'>
            <button id='btnCerrarDivision' style='position:absolute;top:10px;right:10px;background:none;border:none;font-size:24px;color:#666;cursor:pointer;padding:5px 10px;line-height:1;border-radius:4px;transition:all 0.2s;' 
                    onmouseover='this.style.color="#dc3545";this.style.background="#f8f9fa";' 
                    onmouseout='this.style.color="#666";this.style.background="none";' 
                    title='Cerrar'>
                <i class='fas fa-times'></i>
            </button>
            <h4 style='margin-bottom:20px;color:#333;text-align:center;'>🔀 Dividir texto</h4>
            
            <div style='margin-bottom:20px;'>
                <div style='display:block;margin-bottom:8px;font-weight:bold;'>Tipo de división:</div>
                <div style='display:flex;gap:10px;flex-wrap:wrap;margin-bottom:15px;'>
                    <button class='mode-btn' data-mode='personalizado' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Personalizado</button>
                    <button class='mode-btn' data-mode='separador' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Separador</button>
                    <button class='mode-btn' data-mode='gmail' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Gmail</button>
                    <button class='mode-btn' data-mode='herramientas' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Herramientas</button>
                </div>
                
                <div id='separadorSection' style='display:none;'>
                    <div style='display:block;margin-bottom:8px;font-weight:bold;'>Separador:</div>
                <div style='display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;'>
                        <button class='separator-btn' data-sep=',' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Coma (,)</button>
                        <button class='separator-btn' data-sep=';' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Punto y coma (;)</button>
                        <button class='separator-btn' data-sep=' ' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Espacio</button>
                        <button class='separator-btn' data-sep='	' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Tab</button>
                </div>
                <input type='text' id='customSeparator' placeholder='Separador personalizado...' style='width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-top:5px;'>
            </div>
            
                <div id='personalizadoSection' style='display:none;'>
            <div style='margin-bottom:20px;'>
                        <div style='display:block;margin-bottom:8px;font-weight:bold;'>Campos a crear:</div>
                        <div style='display:flex;gap:10px;margin-bottom:10px;'>
                            <button class='field-btn' data-field='correo' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Correo</button>
                            <button class='field-btn' data-field='contraseña' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Contraseña</button>
                            <button class='field-btn' data-field='links' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Links</button>
                        </div>
                        <div id='selectedFieldsContainer' style='min-height:30px;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fff;'>
                            <div style='color:#999;font-style:italic;'>Arrastra los campos aquí para definir el orden</div>
                        </div>
                    </div>
                    
                    <div style='margin-bottom:20px;'>
                        <div style='display:block;margin-bottom:8px;font-weight:bold;'>Detectar correo y contraseña:</div>
                        <div style='display:flex;gap:15px;margin-bottom:10px;'>
                    <label style='display:flex;align-items:center;gap:8px;'>
                                <input type='radio' name='separator' id='useSpace' value='space' checked style='margin:0;'> Espacio
                    </label>
                    <label style='display:flex;align-items:center;gap:8px;'>
                                <input type='radio' name='separator' id='useColon' value='colon' style='margin:0;'> Doble puntos (:)
                    </label>
                        </div>
                        <div style='background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:10px;font-size:12px;color:#666;'>
                            <strong>Ejemplo:</strong><br>
                            dsfads6f@gmail.com:saf4erfsf4sdffs dsf4 ewdsdfsdf dsfdsf wefefwe<br>
                            dsfads6f@gmail.com saf4erfsf4sdffs dsf4 ewdsdfsdf dsfdsf wefefwe
                        </div>
                    </div>
                </div>
                
                <div id='gmailSection' style='display:none;'>
                    <div style='margin-bottom:20px;'>
                        <div style='display:block;margin-bottom:8px;font-weight:bold;'>Campos a crear:</div>
                        <div style='display:flex;gap:10px;margin-bottom:10px;'>
                            <button class='gmail-field-btn' data-field='correo' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Correo</button>
                            <button class='gmail-field-btn' data-field='numero' style='padding:8px 15px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;'>Número</button>
                        </div>
                        <div id='gmailSelectedFieldsContainer' style='min-height:30px;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fff;'>
                            <div style='color:#999;font-style:italic;'>Arrastra los campos aquí para definir el orden</div>
                        </div>
                    </div>
                    
                    <div id='gmailInputSection' style='display:none;margin-bottom:20px;'>
                        <div style='display:block;margin-bottom:8px;font-weight:bold;'>Datos a procesar:</div>
                        <textarea id='gmailInputTextarea' placeholder='Pega aquí los datos que quieres procesar...' 
                                  style='width:calc(100% - 4px);min-height:120px;padding:12px;border:2px solid #000;border-radius:4px;resize:vertical;font-family:inherit;box-sizing:border-box;'></textarea>
                    </div>
                    
                    <div id='gmailResultSection' style='display:none;margin-bottom:20px;'>
                        <div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'>
                            <div style='font-weight:bold;'>Resultado del procesamiento:</div>
                            <button id='copyAllGmailResults' style='background:#007bff;color:#fff;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;display:none;'>
                                <i class='fas fa-copy'></i> Copiar todo
                            </button>
                        </div>
                        <div id='gmailResultContainer' style='max-height:240px;border:2px solid #000;border-radius:4px;padding:12px;background:#f8f9fa;font-family:inherit;box-sizing:border-box;overflow-y:auto;'>
                            <div style='color:#999;font-style:italic;'>El resultado aparecerá aquí después de aplicar la división</div>
                        </div>
                    </div>
                </div>
                
                <div id='herramientasSection' style='display:none;'>
                    <div style='margin-bottom:20px;'>
                        <div style='display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;'>
                            <button id='btnGeneradorCodigos' class='herramienta-btn' style='padding:12px 20px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;display:flex;align-items:center;gap:8px;transition:all 0.2s;' title='Generador de códigos'>
                                Generador de <i class='fas fa-code' style='font-size:18px;'></i>
                            </button>
                            
                            <button id='btnDuplicados' class='herramienta-btn' style='padding:12px 20px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;color:#333;display:flex;align-items:center;gap:8px;transition:all 0.2s;' title='Duplicados'>
                                Duplicados <i class='fas fa-copy' style='font-size:18px;'></i>
                            </button>
                        </div>
                        
                        <!-- Panel del generador de códigos -->
                        <div id='generadorCodigosPanel' style='display:none;margin-top:15px;padding:15px;background:#f8f9fa;border-radius:8px;border:1px solid #ddd;max-height:70vh;overflow-y:auto;'>
                            <h5 style='margin-top:0;margin-bottom:12px;color:#333;font-size:16px;'>Generador de Códigos</h5>
                            
                            <div style='margin-bottom:12px;'>
                                <label for='letrasUsar' style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Letras y números a usar:</label>
                                <input type='text' id='letrasUsar' name='letrasUsar' value='qwertyuopasdfghjkzxcvbnm1234567890' 
                                       style='width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;' 
                                       placeholder='qwertyuopasdfghjkzxcvbnm1234567890' aria-label='Letras y números a usar para generar códigos'>
                            </div>
                            
                            <div style='margin-bottom:12px;'>
                                <label for='ponerAntes' style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Poner antes:</label>
                                <input type='text' id='ponerAntes' name='ponerAntes' value='netflix+' 
                                       style='width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;box-sizing:border-box;' 
                                       placeholder='netflix+' aria-label='Texto a poner antes del código generado'>
                            </div>
                            
                            <div style='margin-bottom:12px;'>
                                <label for='ponerDespues' style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Poner después:</label>
                                <input type='text' id='ponerDespues' name='ponerDespues' value='@gmail.com' 
                                       style='width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;box-sizing:border-box;' 
                                       placeholder='@gmail.com' aria-label='Texto a poner después del código generado'>
                            </div>
                            
                            <div style='margin-bottom:12px;'>
                                <label for='cantidadCodigosIntermedio' style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Cuántos códigos agregar (intermedio):</label>
                                <input type='number' id='cantidadCodigosIntermedio' name='cantidadCodigosIntermedio' value='4' min='1' 
                                       style='width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;box-sizing:border-box;' 
                                       placeholder='4' aria-label='Cantidad de caracteres intermedios aleatorios'>
                            </div>
                            
                            <div style='margin-bottom:15px;'>
                                <label for='cantidadGenerar' style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Cuántos códigos generar:</label>
                                <input type='number' id='cantidadGenerar' name='cantidadGenerar' value='4' min='1' 
                                       style='width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;box-sizing:border-box;' 
                                       placeholder='4' aria-label='Cantidad total de códigos a generar'>
                            </div>
                            
                            <button id='btnGenerarCodigos' type='button' aria-label='Generar códigos aleatorios' style='width:100%;padding:10px;background:#007bff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:14px;margin-bottom:15px;'>
                                <i class='fas fa-magic' aria-hidden='true'></i> Generar Códigos
                            </button>
                            
                            <div id='resultadoCodigos' style='margin-top:15px;display:none;' role='region' aria-live='polite' aria-label='Resultados de códigos generados'>
                                <div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'>
                                    <label for='codigosGenerados' style='font-weight:bold;color:#333;font-size:13px;'>Resultado:</label>
                                    <button id='btnCopiarTodosCodigos' type='button' aria-label='Copiar todos los códigos al portapapeles' style='padding:6px 10px;background:#28a745;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;display:none;'>
                                        <i class='fas fa-copy' aria-hidden='true'></i> Copiar todos
                                    </button>
                                </div>
                                <textarea id='codigosGenerados' name='codigosGenerados' readonly 
                                          style='width:100%;min-height:120px;max-height:200px;padding:8px;border:2px solid #000;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;resize:vertical;overflow-y:auto;' 
                                          aria-label='Códigos generados'></textarea>
                            </div>
                        </div>
                        
                        <!-- Panel de duplicados -->
                        <div id='duplicadosPanel' style='display:none;margin-top:15px;padding:15px;background:#f8f9fa;border-radius:8px;border:1px solid #ddd;max-height:70vh;overflow-y:auto;'>
                            <h5 style='margin-top:0;margin-bottom:12px;color:#333;font-size:16px;'>Duplicados</h5>
                            
                            <div style='margin-bottom:12px;'>
                                <label for='duplicadosInput' style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Datos a analizar:</label>
                                <textarea id='duplicadosInput' name='duplicadosInput' 
                                          style='width:100%;min-height:80px;max-height:120px;padding:8px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;resize:vertical;overflow-y:auto;' 
                                          placeholder='Pega aquí los datos a analizar... Ejemplo:&#10;netl2993@gmail.com:saddds&#10;netl2993@gmail.com:saddds&#10;netl2993@gmail.com:saddd'
                                          aria-label='Datos a analizar para encontrar duplicados'></textarea>
                            </div>
                            
                            <div style='margin-bottom:12px;'>
                                <div style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Tipo de separador:</div>
                                <div style='display:flex;gap:15px;margin-bottom:8px;' role='radiogroup' aria-label='Tipo de separador para analizar duplicados'>
                                    <label for='duplicadosEspacio' style='display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;'>
                                        <input type='radio' name='duplicadosSeparador' id='duplicadosEspacio' value='espacio' checked style='margin:0;' aria-label='Usar espacio como separador'>
                                        Espacio
                                    </label>
                                    <label for='duplicadosDosPuntos' style='display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;'>
                                        <input type='radio' name='duplicadosSeparador' id='duplicadosDosPuntos' value='dosPuntos' style='margin:0;' aria-label='Usar dos puntos como separador'>
                                        Dos puntos (:)
                                    </label>
                                </div>
                            </div>
                            
                            <button id='btnAnalizarDuplicados' type='button' aria-label='Analizar duplicados' style='width:100%;padding:10px;background:#007bff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:14px;margin-bottom:15px;'>
                                <i class='fas fa-search' aria-hidden='true'></i> Analizar Duplicados
                            </button>
                            
                            <div style='margin-bottom:10px;'>
                                <div style='display:block;margin-bottom:4px;font-weight:bold;color:#333;font-size:13px;'>Resultado (sin color: únicos, azul: repetido 1 vez, amarillo: más repetido):</div>
                                <div id='duplicadosResultado' 
                                     style='width:100%;min-height:120px;max-height:200px;padding:8px;border:2px solid #000;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;overflow-y:auto;background:#fff;white-space:pre-wrap;word-wrap:break-word;'
                                     role='region' aria-live='polite' aria-label='Resultados de análisis de duplicados. Sin color: únicos, azul: repetido 1 vez, amarillo: más repetido'></div>
                                <div id='duplicadosEstadisticas' style='margin-top:10px;padding:10px;background:#fff3cd;border:2px solid #ffc107;border-radius:6px;font-size:12px;display:block;min-height:40px;'>
                                    <div style='display:flex;align-items:center;gap:6px;margin-bottom:6px;'>
                                        <i class='fas fa-chart-bar' style='color:#856404;font-size:14px;'></i>
                                        <strong style='color:#856404;font-size:13px;'>Estadísticas:</strong>
                                    </div>
                                    <div style='color:#856404;font-weight:500;line-height:1.4;font-size:12px;'>
                                        <span id='contadorAmarillos'>Esperando análisis...</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div style='display:flex;gap:10px;justify-content:center;'>
                <button id='btnAplicarDivision' class='btn-panel btn-blue'>
                    <i class='fas fa-check'></i> Aplicar división
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    let selectedSeparator = ',';
    let selectedMode = 'personalizado';
    let selectedFields = [];
    
    // Event listeners para botones de modo
    modal.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Limpiar selección anterior
            modal.querySelectorAll('.mode-btn').forEach(b => {
                b.style.background = '#f8f9fa';
                b.style.color = '#333';
            });
            // Marcar seleccionado
            this.style.background = '#007bff';
            this.style.color = '#fff';
            selectedMode = this.getAttribute('data-mode');
            
            // Mostrar secciones según el modo
            const separadorSection = modal.querySelector('#separadorSection');
            const personalizadoSection = modal.querySelector('#personalizadoSection');
            const gmailSection = modal.querySelector('#gmailSection');
            const herramientasSection = modal.querySelector('#herramientasSection');
            
            // Ocultar todas las secciones primero
            separadorSection.style.display = 'none';
            personalizadoSection.style.display = 'none';
            gmailSection.style.display = 'none';
            herramientasSection.style.display = 'none';
            
            // Mostrar la sección correspondiente
            if (selectedMode === 'separador') {
                separadorSection.style.display = 'block';
            } else if (selectedMode === 'personalizado') {
                personalizadoSection.style.display = 'block';
            } else if (selectedMode === 'gmail') {
                gmailSection.style.display = 'block';
            } else if (selectedMode === 'herramientas') {
                herramientasSection.style.display = 'block';
            }
        });
    });
    
    // Event listener para botón Generador de códigos
    const btnGeneradorCodigos = modal.querySelector('#btnGeneradorCodigos');
    const generadorPanel = modal.querySelector('#generadorCodigosPanel');
    if (btnGeneradorCodigos) {
        btnGeneradorCodigos.addEventListener('click', function() {
            // Ocultar otros paneles
            const duplicadosPanel = modal.querySelector('#duplicadosPanel');
            if (duplicadosPanel) duplicadosPanel.style.display = 'none';
            
            // Deseleccionar otros botones
            const btnDuplicados = modal.querySelector('#btnDuplicados');
            if (btnDuplicados) {
                btnDuplicados.style.background = '#f8f9fa';
                btnDuplicados.style.color = '#333';
            }
            
            // Toggle selección
            if (this.style.background === 'rgb(0, 123, 255)' || this.style.background === '#007bff') {
                // Deseleccionar
                this.style.background = '#f8f9fa';
                this.style.color = '#333';
                if (generadorPanel) generadorPanel.style.display = 'none';
            } else {
                // Seleccionar
                this.style.background = '#007bff';
                this.style.color = '#fff';
                if (generadorPanel) generadorPanel.style.display = 'block';
            }
        });
    }
    
    // Event listener para botón Duplicados
    const btnDuplicados = modal.querySelector('#btnDuplicados');
    const duplicadosPanel = modal.querySelector('#duplicadosPanel');
    if (btnDuplicados) {
        btnDuplicados.addEventListener('click', function() {
            // Ocultar otros paneles
            if (generadorPanel) generadorPanel.style.display = 'none';
            
            // Deseleccionar otros botones
            if (btnGeneradorCodigos) {
                btnGeneradorCodigos.style.background = '#f8f9fa';
                btnGeneradorCodigos.style.color = '#333';
            }
            
            // Toggle selección
            if (this.style.background === 'rgb(0, 123, 255)' || this.style.background === '#007bff') {
                // Deseleccionar
                this.style.background = '#f8f9fa';
                this.style.color = '#333';
                if (duplicadosPanel) duplicadosPanel.style.display = 'none';
            } else {
                // Seleccionar
                this.style.background = '#007bff';
                this.style.color = '#fff';
                if (duplicadosPanel) duplicadosPanel.style.display = 'block';
            }
        });
    }
    
    // Event listener para generar códigos
    const btnGenerarCodigos = modal.querySelector('#btnGenerarCodigos');
    if (btnGenerarCodigos) {
        btnGenerarCodigos.addEventListener('click', function() {
            const letrasUsar = modal.querySelector('#letrasUsar').value.trim();
            const ponerAntes = modal.querySelector('#ponerAntes').value;
            const ponerDespues = modal.querySelector('#ponerDespues').value;
            const cantidadIntermedio = parseInt(modal.querySelector('#cantidadCodigosIntermedio').value) || 4;
            const cantidadGenerar = parseInt(modal.querySelector('#cantidadGenerar').value) || 4;
            
            // Validar campos
            if (!letrasUsar) {
                showClipboardIndicator('⚠️ Debes especificar las letras y números a usar');
                return;
            }
            
            if (cantidadIntermedio < 1) {
                showClipboardIndicator('⚠️ La cantidad de códigos intermedios debe ser al menos 1');
                return;
            }
            
            if (cantidadGenerar < 1) {
                showClipboardIndicator('⚠️ Debes generar al menos 1 código');
                return;
            }
            
            // Calcular combinaciones posibles
            const combinacionesPosibles = Math.pow(letrasUsar.length, cantidadIntermedio);
            
            if (combinacionesPosibles < cantidadGenerar) {
                showClipboardIndicator(`⚠️ Error: No se pueden generar ${cantidadGenerar} códigos únicos. Solo es posible generar ${combinacionesPosibles} combinaciones diferentes con ${cantidadIntermedio} caracteres usando ${letrasUsar.length} caracteres disponibles. Por favor, aumenta la cantidad de caracteres disponibles o reduce la cantidad de códigos a generar o el largo intermedio.`);
                return;
            }
            
            // Generar códigos únicos
            const codigosGenerados = new Set();
            const maxIntentos = combinacionesPosibles * 2; // Límite de seguridad
            let intentos = 0;
            
            while (codigosGenerados.size < cantidadGenerar && intentos < maxIntentos) {
                intentos++;
                let codigoIntermedio = '';
                for (let i = 0; i < cantidadIntermedio; i++) {
                    const indiceAleatorio = Math.floor(Math.random() * letrasUsar.length);
                    codigoIntermedio += letrasUsar[indiceAleatorio];
                }
                codigosGenerados.add(codigoIntermedio);
            }
            
            if (codigosGenerados.size < cantidadGenerar) {
                showClipboardIndicator(`⚠️ Error: Solo se pudieron generar ${codigosGenerados.size} códigos únicos de ${cantidadGenerar} solicitados. Es posible que haya demasiadas repeticiones. Intenta aumentar las letras disponibles o reducir la cantidad.`);
                return;
            }
            
            // Formatear códigos con antes y después
            const codigosFormateados = Array.from(codigosGenerados).map(codigo => {
                return ponerAntes + codigo + ponerDespues;
            });
            
            // Mostrar resultado
            const resultadoDiv = modal.querySelector('#resultadoCodigos');
            const codigosTextarea = modal.querySelector('#codigosGenerados');
            const btnCopiarTodos = modal.querySelector('#btnCopiarTodosCodigos');
            
            if (resultadoDiv && codigosTextarea) {
                codigosTextarea.value = codigosFormateados.join('\n');
                resultadoDiv.style.display = 'block';
                if (btnCopiarTodos) btnCopiarTodos.style.display = 'inline-block';
            }
            
            showClipboardIndicator(`✅ ${codigosGenerados.size} códigos generados exitosamente`);
        });
    }
    
    // Event listener para analizar duplicados
    const btnAnalizarDuplicados = modal.querySelector('#btnAnalizarDuplicados');
    if (btnAnalizarDuplicados) {
        btnAnalizarDuplicados.addEventListener('click', function() {
            const inputText = modal.querySelector('#duplicadosInput').value.trim();
            const separadorEspacio = modal.querySelector('#duplicadosEspacio').checked;
            const resultadoDiv = modal.querySelector('#duplicadosResultado');
            
            if (!inputText) {
                showClipboardIndicator('⚠️ Debes ingresar datos para analizar');
                return;
            }
            
            // Determinar el separador
            const separador = separadorEspacio ? ' ' : ':';
            
            // Dividir las líneas
            const lineas = inputText.split('\n').filter(linea => linea.trim() !== '');
            
            if (lineas.length === 0) {
                showClipboardIndicator('⚠️ No se encontraron líneas válidas para analizar');
                return;
            }
            
            // Analizar duplicados
            const frecuencia = new Map();
            const lineasProcesadas = [];
            
            // Primera pasada: contar frecuencia de cada línea completa
            lineas.forEach((linea, index) => {
                const lineaTrim = linea.trim();
                if (lineaTrim) {
                    const count = frecuencia.get(lineaTrim) || 0;
                    frecuencia.set(lineaTrim, count + 1);
                    lineasProcesadas.push({
                        original: linea,
                        trimmed: lineaTrim,
                        index: index
                    });
                }
            });
            
            // Segunda pasada: analizar por partes si hay separador
            const partesFrecuencia = new Map();
            const primeraAparicionParte = new Map();
            
            lineasProcesadas.forEach((item, itemIndex) => {
                if (item.trimmed.includes(separador)) {
                    const partes = item.trimmed.split(separador);
                    partes.forEach((parte, parteIndex) => {
                        const parteTrim = parte.trim();
                        if (parteTrim) {
                            const count = partesFrecuencia.get(parteTrim) || 0;
                            partesFrecuencia.set(parteTrim, count + 1);
                            
                            // Guardar primera aparición de cada parte
                            if (!primeraAparicionParte.has(parteTrim)) {
                                primeraAparicionParte.set(parteTrim, itemIndex);
                            }
                        }
                    });
                }
            });
            
            // Mapear índices de primera aparición de cada línea completa
            const primeraAparicion = new Map();
            lineasProcesadas.forEach((item, itemIndex) => {
                if (!primeraAparicion.has(item.trimmed)) {
                    primeraAparicion.set(item.trimmed, itemIndex);
                }
            });
            
            // Generar resultado HTML con colores
            let resultadoHTML = '';
            let contadorAmarillos = 0;
            
            lineasProcesadas.forEach((item, itemIndex) => {
                const frecuenciaCompleta = frecuencia.get(item.trimmed) || 0;
                const esPrimeraAparicionCompleta = primeraAparicion.get(item.trimmed) === itemIndex;
                let lineaHTML = '';
                let tieneAmarillo = false;
                
                if (item.trimmed.includes(separador)) {
                    // Si tiene separador, analizar cada parte
                    const partes = item.trimmed.split(separador);
                    const partesConSeparador = item.original.split(separador);
                    
                    partes.forEach((parte, parteIndex) => {
                        const parteTrim = parte.trim();
                        const frecuenciaParte = partesFrecuencia.get(parteTrim) || 0;
                        const esPrimeraAparicionParte = primeraAparicionParte.get(parteTrim) === itemIndex;
                        
                        // Determinar color según frecuencia y orden de aparición
                        let color = '';
                        if (frecuenciaParte > 1) {
                            // Si es repetido
                            if (esPrimeraAparicionParte) {
                                // Primera aparición = azul
                                color = 'blue';
                            } else {
                                // No es primera aparición = amarillo
                                color = 'yellow';
                                tieneAmarillo = true;
                            }
                        }
                        // Si frecuenciaParte === 1, no hay color (único)
                        
                        // Agregar la parte con color si corresponde
                        if (color) {
                            lineaHTML += `<span style='background-color:${color};color:${color === 'yellow' ? '#000' : '#fff'};padding:2px 4px;border-radius:2px;'>${partesConSeparador[parteIndex]}</span>`;
                        } else {
                            lineaHTML += partesConSeparador[parteIndex];
                        }
                        
                        // Agregar separador si no es el último
                        if (parteIndex < partes.length - 1) {
                            lineaHTML += separador;
                        }
                    });
                } else {
                    // Si no tiene separador, analizar la línea completa
                    let color = '';
                    if (frecuenciaCompleta > 1) {
                        // Si es repetido
                        if (esPrimeraAparicionCompleta) {
                            // Primera aparición = azul
                            color = 'blue';
                        } else {
                            // No es primera aparición = amarillo
                            color = 'yellow';
                            tieneAmarillo = true;
                        }
                    }
                    // Si frecuenciaCompleta === 1, no hay color (único)
                    
                    if (color) {
                        lineaHTML = `<span style='background-color:${color};color:${color === 'yellow' ? '#000' : '#fff'};padding:2px 4px;border-radius:2px;'>${item.original}</span>`;
                    } else {
                        lineaHTML = item.original;
                    }
                }
                
                // Contar si tiene amarillo
                if (tieneAmarillo) {
                    contadorAmarillos++;
                }
                
                resultadoHTML += lineaHTML + '\n';
            });
            
            // Mostrar resultado
            if (resultadoDiv) {
                resultadoDiv.innerHTML = resultadoHTML;
            }
            
            // Mostrar estadísticas
            const estadisticasDiv = modal.querySelector('#duplicadosEstadisticas');
            const contadorSpan = modal.querySelector('#contadorAmarillos');
            if (estadisticasDiv && contadorSpan) {
                // Contar también azules y únicos
                let contadorAzules = 0;
                let contadorUnicos = 0;
                
                lineasProcesadas.forEach((item, itemIndex) => {
                    const frecuenciaCompleta = frecuencia.get(item.trimmed) || 0;
                    const esPrimeraAparicionCompleta = primeraAparicion.get(item.trimmed) === itemIndex;
                    
                    if (frecuenciaCompleta === 1) {
                        contadorUnicos++;
                    } else if (frecuenciaCompleta > 1 && esPrimeraAparicionCompleta) {
                        contadorAzules++;
                    }
                });
                
                // Mostrar estadísticas completas
                let estadisticasTexto = '';
                if (contadorUnicos > 0) {
                    estadisticasTexto += `Únicos (sin color): ${contadorUnicos}`;
                }
                if (contadorAzules > 0) {
                    if (estadisticasTexto) estadisticasTexto += ' | ';
                    estadisticasTexto += `Repetidos únicos (azul): ${contadorAzules}`;
                }
                if (contadorAmarillos > 0) {
                    if (estadisticasTexto) estadisticasTexto += ' | ';
                    estadisticasTexto += `Repeticiones amarillas (más repetidas): ${contadorAmarillos}`;
                }
                
                if (estadisticasTexto) {
                    contadorSpan.textContent = estadisticasTexto;
                    estadisticasDiv.style.display = 'block';
                } else {
                    estadisticasDiv.style.display = 'none';
                }
            }
            
            showClipboardIndicator(`✅ Análisis completado. ${lineasProcesadas.length} líneas procesadas`);
        });
    }
    
    // Event listener para copiar todos los códigos
    const btnCopiarTodosCodigos = modal.querySelector('#btnCopiarTodosCodigos');
    if (btnCopiarTodosCodigos) {
        btnCopiarTodosCodigos.addEventListener('click', function() {
            const codigosTextarea = modal.querySelector('#codigosGenerados');
            if (codigosTextarea && codigosTextarea.value) {
                codigosTextarea.select();
                document.execCommand('copy');
                showClipboardIndicator('✅ Todos los códigos copiados al portapapeles');
                
                // Feedback visual
                const icon = this.querySelector('i');
                const originalClass = icon.className;
                icon.className = 'fas fa-check';
                this.style.background = '#28a745';
                
                setTimeout(() => {
                    icon.className = originalClass;
                    this.style.background = '#28a745';
                }, 1000);
            }
        });
    }
    
    // Event listeners para botones de separador
    modal.querySelectorAll('.separator-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Limpiar selección anterior
            modal.querySelectorAll('.separator-btn').forEach(b => {
                b.style.background = '#f8f9fa';
                b.style.color = '#333';
            });
            // Marcar seleccionado
            this.style.background = '#007bff';
            this.style.color = '#fff';
            selectedSeparator = this.getAttribute('data-sep');
            
            // Limpiar personalizado
            modal.querySelector('#customSeparator').value = '';
        });
    });
    
    // Event listeners para botones de campos
    modal.querySelectorAll('.field-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const field = this.getAttribute('data-field');
            if (!selectedFields.includes(field)) {
                selectedFields.push(field);
                updateCustomDivisionFieldsDisplay();
            }
        });
    });
    
    // Event listeners para botones de campos de Gmail
    modal.querySelectorAll('.gmail-field-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const field = this.getAttribute('data-field');
            if (!selectedFields.includes(field)) {
                selectedFields.push(field);
                updateGmailSelectedFieldsDisplay();
            }
        });
    });
    
    // Separador personalizado
    modal.querySelector('#customSeparator').addEventListener('input', function() {
        if (this.value) {
            selectedSeparator = this.value;
            // Limpiar separadores predefinidos
            modal.querySelectorAll('.separator-btn').forEach(b => {
                b.style.background = '#f8f9fa';
                b.style.color = '#333';
            });
        }
    });
    
    // Renombrar para evitar conflicto con función global
    function updateCustomDivisionFieldsDisplay() {
        const container = modal.querySelector('#selectedFieldsContainer');
        if (selectedFields.length === 0) {
            container.innerHTML = '<div class="worksheet-drag-container">Arrastra los campos aquí para definir el orden</div>';
        } else {
            container.innerHTML = selectedFields.map((field, index) => `
                <span class="selected-field worksheet-selected-field" data-field="${field}">
                    ${field} <i class="fas fa-times" style="margin-left:5px;cursor:pointer;" onclick="removeField('${field}')"></i>
                </span>
            `).join('');
        }
    }
    
    // Función para actualizar visualización de campos seleccionados de Gmail
    function updateGmailSelectedFieldsDisplay() {
        const container = modal.querySelector('#gmailSelectedFieldsContainer');
        const inputSection = modal.querySelector('#gmailInputSection');
        const resultSection = modal.querySelector('#gmailResultSection');
        
        if (selectedFields.length === 0) {
            container.innerHTML = '<div class="worksheet-drag-container">Arrastra los campos aquí para definir el orden</div>';
            inputSection.style.display = 'none';
            resultSection.style.display = 'none';
        } else {
            container.innerHTML = selectedFields.map((field, index) => `
                <span class="selected-field worksheet-selected-field" data-field="${field}">
                    ${field} <i class="fas fa-times" style="margin-left:5px;cursor:pointer;" onclick="removeGmailField('${field}')"></i>
                </span>
            `).join('');
            
            // Mostrar sección de entrada cuando hay campos seleccionados
            inputSection.style.display = 'block';
            resultSection.style.display = 'block';
        }
    }
    
    // Función para remover campo
    window.removeField = function(field) {
        selectedFields = selectedFields.filter(f => f !== field);
        updateCustomDivisionFieldsDisplay();
    };
    
    // Función para remover campo de Gmail
    window.removeGmailField = function(field) {
        selectedFields = selectedFields.filter(f => f !== field);
        updateGmailSelectedFieldsDisplay();
    };
    
    // Aplicar división
    modal.querySelector('#btnAplicarDivision').addEventListener('click', function() {
        const customSep = modal.querySelector('#customSeparator').value;
        const finalSeparator = customSep || selectedSeparator;
        const trimSpaces = true; 
        const skipEmpty = true; 
        const createColumns = true; 
        
        if (selectedMode === 'personalizado') {
            // Modo personalizado - Detectar correo y contraseña
            const useSpace = modal.querySelector('#useSpace').checked;
            const useColon = modal.querySelector('#useColon').checked;
            
            if (!useSpace && !useColon) {
                showClipboardIndicator('⚠️ Selecciona al menos una opción (Espacio o Doble puntos)');
                return;
            }
            
            if (selectedFields.length === 0) {
                showClipboardIndicator('⚠️ Selecciona al menos un campo (Correo, Contraseña o Links)');
                return;
            }
            
            // Validar que los campos existan en la tabla
            const plantilla = optimizedFunctions.getCurrentPlantilla();
            if (!plantilla) {
                showClipboardIndicator('❌ Error: No se pudo obtener la plantilla actual');
                return;
            }
            
            
            
            const missingFields = selectedFields.filter(field => !plantilla.campos.includes(field));
            if (missingFields.length > 0) {
                const fieldNames = missingFields.map(field => {
                    switch(field) {
                        case 'correo': return 'Correo';
                        case 'contraseña': return 'Contraseña';
                        case 'links': return 'Links';
                        default: return field;
                    }
                }).join(', ');
                
                showClipboardIndicator(`⚠️ Los campos ${fieldNames} no existen en la tabla. Primero crea las columnas necesarias en el orden correcto.`);
                return;
            }
            
            modal.remove();
            executePersonalizedSplit(selection, { useSpace, useColon, trimSpaces, skipEmpty, createColumns, selectedFields });
        } else if (selectedMode === 'gmail') {
            // Modo Gmail - Detectar correo y número
            if (selectedFields.length === 0) {
                showClipboardIndicator('⚠️ Selecciona al menos un campo (Correo o Número)');
                return;
            }
            
            // Obtener el texto del textarea
            const inputTextarea = modal.querySelector('#gmailInputTextarea');
            const inputText = inputTextarea.value.trim();
            
            if (!inputText) {
                showClipboardIndicator('⚠️ Ingresa los datos que quieres procesar');
                return;
            }
            
            
            const results = parseGmailDataMultiLine(inputText, selectedFields);
            
            if (results.length === 0) {
                showClipboardIndicator('⚠️ No se encontraron datos válidos para procesar');
                return;
            }
            
            // Mostrar en el contenedor
            const resultContainer = modal.querySelector('#gmailResultContainer');
            resultContainer.innerHTML = results.map((result, index) => {
                let resultText = '';
                
                // En una línea separada
                if (selectedFields.includes('correo') && result.email) {
                    resultText += `${result.email}<br>`;
                }
                
                // Si hay número, formatearlo correctamente
                if (selectedFields.includes('numero') && result.number) {
                    // Dividir en grupos de 8 dígitos
                    const cleanNumbers = result.number.replace(/\s+/g, '');
                    const numberGroups = [];
                    
                    // Crear grupos de 8 dígitos
                    for (let i = 0; i < cleanNumbers.length; i += 8) {
                        numberGroups.push(cleanNumbers.substring(i, i + 8));
                    }
                    
                    // Organizar en 2 líneas (5 grupos por línea)
                    const line1 = numberGroups.slice(0, 5).join(' ');
                    const line2 = numberGroups.slice(5, 10).join(' ');
                    
                    if (line1) {
                        resultText += `${line1}<br>`;
                    }
                    if (line2) {
                        resultText += `${line2}`;
                    }
                }
                
                return `<div style="margin-bottom:10px;padding:8px;background:#fff;border:1px solid #ddd;border-radius:4px;font-family:monospace;position:relative;">
                    <div style="margin-right:30px;">${resultText}</div>
                    <button class="copy-gmail-result" data-result="${resultText.replace(/<br>/g, '\n')}" style="position:absolute;top:5px;right:5px;background:#007bff;color:#fff;border:none;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:12px;">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>`;
            }).join('');
            
            // Mostrar "Copiar todo" si hay resultados
            const copyAllButton = modal.querySelector('#copyAllGmailResults');
            if (copyAllButton && results.length > 0) {
                copyAllButton.style.display = 'inline-block';
                
                // Event listener para copiar todos los resultados
                copyAllButton.addEventListener('click', function() {
                    const allResultsText = results.map(result => {
                        let resultText = '';
                        if (selectedFields.includes('correo') && result.email) {
                            resultText += `${result.email}`;
                            // Nueva línea si también hay números
                            if (selectedFields.includes('numero') && result.numberClean) {
                                resultText += '\n';
                            }
                        }
                        if (selectedFields.includes('numero') && result.numberClean) {
                            // Números sin espacios internos
                            const cleanNumbers = result.numberClean;
                            const numberGroups = [];
                            
                            // Grupos de 8 dígitos
                            for (let i = 0; i < cleanNumbers.length; i += 8) {
                                numberGroups.push(cleanNumbers.substring(i, i + 8));
                            }
                            
                            // Organizar en 2 líneas (5 grupos por línea) - SIN espacios internos
                            const line1 = numberGroups.slice(0, 5).join(' ');
                            const line2 = numberGroups.slice(5, 10).join(' ');
                            
                            if (line1) {
                                resultText += `${line1}\n`;
                            }
                            if (line2) {
                                resultText += `${line2}`;
                            }
                        }
                        return resultText;
                    }).join('\n');
                    
                    navigator.clipboard.writeText(allResultsText).then(() => {
                        // Actualizar el icono para mostrar confirmación
                        const icon = this.querySelector('i');
                        const originalClass = icon.className;
                        icon.className = 'fas fa-check';
                        this.style.background = '#28a745';
                        this.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
                        
                        setTimeout(() => {
                            icon.className = originalClass;
                            this.style.background = '#007bff';
                            this.innerHTML = '<i class="fas fa-copy"></i> Copiar todo';
                        }, 2000);
                    }).catch(err => {
                        showClipboardIndicator('Error al copiar al portapapeles');
                    });
                });
            }
            
            // Event listeners para los botones de copiar individuales
            modal.querySelectorAll('.copy-gmail-result').forEach(button => {
                button.addEventListener('click', function() {
                    const resultText = this.getAttribute('data-result');
                    navigator.clipboard.writeText(resultText).then(() => {
                        // Actualizar el icono para mostrar confirmación
                        const icon = this.querySelector('i');
                        const originalClass = icon.className;
                        icon.className = 'fas fa-check';
                        this.style.background = '#28a745';
                        
                        setTimeout(() => {
                            icon.className = originalClass;
                            this.style.background = '#007bff';
                        }, 1000);
                    }).catch(err => {
                        showClipboardIndicator('Error al copiar al portapapeles');
                    });
                });
            });
            
            showClipboardIndicator(`✅ Procesamiento completado. ${results.length} grupos encontrados.`);
        } else {
            // (Documentación actual)
            modal.remove();
            executeSplitText(selection, finalSeparator, { trimSpaces, skipEmpty, createColumns });
        }
    });
    
    // Cerrar modal con X
    modal.querySelector('#btnCerrarDivision').addEventListener('click', function() {
        modal.remove();
    });
    
    // Cerrar modal al hacer clic fuera del contenido
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Seleccionar "Personalizado" por defecto
    const personalizadoBtn = modal.querySelector('[data-mode="personalizado"]');
    if (personalizadoBtn) {
        personalizadoBtn.click();
    }
    
    // Seleccionar "Espacio" por defecto en modo personalizado
    const spaceRadio = modal.querySelector('#useSpace');
    if (spaceRadio) {
        spaceRadio.checked = true;
    }
    
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Ejecutar división personalizada (correo y contraseña)
function executePersonalizedSplit(selection, options) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    
    saveUndoState(ACTION_TYPES.TEXT_SPLIT, 'División personalizada de correo y contraseña', selection.cells);
    
    let changesMade = 0;
    
    // No crear columnas automáticamente - deben existir previamente
    // Las columnas ya fueron validadas en la función anterior
    
    // Procesar cada celda
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cellValue = tablaDatos[row] && tablaDatos[row][col] ? tablaDatos[row][col].toString() : '';
        
        if (cellValue) {
            const result = parseEmailPassword(cellValue, options);
            
            // Actualizar valores con registro detallado de cambios
            options.selectedFields.forEach((field, index) => {
                const colIndex = plantilla.campos.indexOf(field);
                
                if (colIndex !== -1) {
                    let value = '';
                    switch(field) {
                        case 'correo':
                            value = result.email;
                            break;
                        case 'contraseña':
                            value = result.password;
                            break;
                        case 'links':
                            value = result.link;
                            break;
                    }
                    
                    if (value) {
                        // Registrar cambio en historial detallado
                        const oldValue = tablaDatos[row][colIndex] || '';
                        tablaDatos[row][colIndex] = value;
                        // Registrar en historial detallado solo si la función existe
                        if (typeof recordDetailedChange === 'function') {
                            recordDetailedChange('personalized-split', { row, col: colIndex }, oldValue, value);
                        }
                        changesMade++;
                    }
                }
            });
            
            // Limpiar celda original con registro en historial
            const correoColIndex = plantilla.campos.indexOf('correo');
            if (col !== correoColIndex) {
                const oldValue = tablaDatos[row][col];
                const newValue = '';
                tablaDatos[row][col] = newValue;
                // Registrar en historial detallado solo si la función existe
                if (typeof recordDetailedChange === 'function') {
                    recordDetailedChange('personalized-split', { row, col }, oldValue, newValue);
                }
            }
        }
    });
    
    // Actualizar plantilla y guardar inmediatamente
    plantilla.datos = tablaDatos;
    
    // Verificar si la función existe
    if (typeof saveChangesHistory === 'function') {
        saveChangesHistory();
    }
    
    // Guardar para consistencia
    
    
    // GUARDADO OPTIMIZADO: Un solo guardado robusto con reintentos automáticos
    saveWorksheetDataUnified(plantilla, {
        successCallback: () => {
            reRenderTable(plantilla);
            // División personalizada completada y guardada - ${changesMade} cambios aplicados
            
            // Optimización aplicada
        },
        errorCallback: (error) => {
            showClipboardIndicator('❌ Error guardando cambios de división personalizada');
        },
        silent: false,
        showIndicator: false // Usamos nuestros propios indicadores
    });
}

// Ejecutar división Gmail (correo y número)
function executeGmailSplit(selection, options) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    
    saveUndoState(ACTION_TYPES.TEXT_SPLIT, 'División Gmail de correo y número', selection.cells);
    
    let changesMade = 0;
    
    // Procesar
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cellValue = tablaDatos[row] && tablaDatos[row][col] ? tablaDatos[row][col].toString() : '';
        
        if (cellValue) {
            const results = parseGmailDataMultiLine(cellValue, options.selectedFields);
            
            // Crear nuevas filas para cada grupo de datos
            results.forEach((result, index) => {
                const newRow = row + index;
                
                
                if (!tablaDatos[newRow]) {
                    tablaDatos[newRow] = [];
                }
                
                // Actualizar valores con registro detallado de cambios
                options.selectedFields.forEach((field, fieldIndex) => {
                    const colIndex = plantilla.campos.indexOf(field);
                    
                    if (colIndex !== -1) {
                        let value = '';
                        switch(field) {
                            case 'correo':
                                value = result.email;
                                break;
                            case 'numero':
                                value = result.number;
                                break;
                        }
                        
                        if (value) {
                            // Registrar cambio en historial detallado
                            const oldValue = tablaDatos[newRow][colIndex] || '';
                            tablaDatos[newRow][colIndex] = value;
                            // Registrar en historial detallado solo si la función existe
                            if (typeof recordDetailedChange === 'function') {
                                recordDetailedChange('gmail-split', { row: newRow, col: colIndex }, oldValue, value);
                            }
                            changesMade++;
                        }
                    }
                });
            });
            
            // Limpiar con registro en historial
            const oldValue = tablaDatos[row][col];
            const newValue = '';
            tablaDatos[row][col] = newValue;
            // Registrar en historial detallado solo si la función existe
            if (typeof recordDetailedChange === 'function') {
                recordDetailedChange('gmail-split', { row, col }, oldValue, newValue);
            }
        }
    });
    
    // Actualizar plantilla y guardar inmediatamente
    plantilla.datos = tablaDatos;
    
    // Verificar si la función existe
    if (typeof saveChangesHistory === 'function') {
        saveChangesHistory();
    }
    
    // Guardar para consistencia
    
    
    // GUARDADO OPTIMIZADO: Un solo guardado robusto con reintentos automáticos
    saveWorksheetDataUnified(plantilla, {
        successCallback: () => {
            reRenderTable(plantilla);
            // División Gmail completada y guardada - ${changesMade} cambios aplicados
            
            // Optimización aplicada
        },
        errorCallback: (error) => {
            showClipboardIndicator('❌ Error guardando cambios de división Gmail');
        },
        silent: false,
        showIndicator: false // Usamos nuestros propios indicadores
    });
}

// Función para parsear datos de Gmail (correo y número) - Multi-línea
function parseGmailDataMultiLine(text, selectedFields) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const results = [];
    
    let currentEmail = '';
    let currentNumbers = [];
    
    // Línea
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Buscar correo electrónico
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const emailMatch = line.match(emailRegex);
        
        if (emailMatch) {
            // Encontramos un correo y tenemos números acumulados, crear resultado
            if (currentEmail && currentNumbers.length > 0) {
                results.push({
                    email: currentEmail,
                    number: currentNumbers.join(' '),
                    numberClean: currentNumbers.join(''), // Sin espacios para copiar todo
                });
            } else if (currentEmail && selectedFields.includes('correo') && !selectedFields.includes('numero')) {
                // Solo "correo" y no hay números, crear grupo solo con correo
                results.push({
                    email: currentEmail,
                    number: '',
                    numberClean: ''
                });
            }
            
            // Iniciar nuevo grupo
            currentEmail = emailMatch[0];
            currentNumbers = [];
        } else {
            // Línea contiene números
            const numberRegex = /[\d\s\-\.\(\)]+/g;
            const numberMatches = line.match(numberRegex);
            
            if (numberMatches && numberMatches.length > 0) {
                // Números
                const cleanNumbers = numberMatches.map(num => 
                    num.replace(/\s+/g, '').trim()
                ).filter(num => num.length > 0);
                
                currentNumbers.push(...cleanNumbers);
            }
        }
    }
    
                
            if (currentEmail && currentNumbers.length > 0) {
                results.push({
                    email: currentEmail,
                    number: currentNumbers.join(' '),
                    numberClean: currentNumbers.join(''), // Sin espacios para copiar todo
                });
            } else if (currentEmail && selectedFields.includes('correo') && !selectedFields.includes('numero')) {
                // Solo "correo" y no hay números, crear grupo solo con correo
                results.push({
                    email: currentEmail,
                    number: '',
                    numberClean: ''
                });
            } else if (currentNumbers.length > 0 && selectedFields.includes('numero') && !selectedFields.includes('correo')) {
                // Solo "número" y no hay correo, crear grupo solo con números
                results.push({
                    email: '',
                    number: currentNumbers.join(' '),
                    numberClean: currentNumbers.join(''), // Sin espacios para copiar todo
                });
            }
    
    return results;
}
// Función para parsear correo y contraseña
function parseEmailPassword(text, options) {
    const result = { email: '', password: '', link: '' };
    
    // Buscar correo electrónico
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = text.match(emailRegex);
    
    if (emailMatch) {
        const email = emailMatch[0];
        result.email = email;
        
        // Buscar link en todo el texto (puede estar en cualquier lugar)
        const linkRegex = /(https?:\/\/[^\s]+)/;
        const linkMatch = text.match(linkRegex);
        if (linkMatch) {
            result.link = linkMatch[0];
        }
        
        // Buscar contraseña - estrategia inteligente
        if (options.useColon) {
            // Buscar después del correo o hasta el final
            let searchText = text.substring(text.indexOf(email) + email.length);
            
            // Si hay link, buscar hasta el link
            if (result.link) {
                const linkIndex = searchText.indexOf(result.link);
                if (linkIndex !== -1) {
                    searchText = searchText.substring(0, linkIndex);
                }
            }
            
            // Buscar contraseña después de dos puntos
            if (searchText.includes(':')) {
                const colonParts = searchText.split(':');
                if (colonParts.length > 1) {
                    let password = colonParts[1].trim();
                    
                    password = password.split(' ')[0];
                    if (password) {
                        result.password = password;
                    }
                }
            }
        } else if (options.useSpace) {
            // Buscar contraseña entre correo y link
            let searchText = text.substring(text.indexOf(email) + email.length);
            
            // Si hay link, buscar hasta el link
            if (result.link) {
                const linkIndex = searchText.indexOf(result.link);
                if (linkIndex !== -1) {
                    searchText = searchText.substring(0, linkIndex);
                }
            }
            
            // Buscar contraseña
            const words = searchText.trim().split(/\s+/);
            if (words.length > 0 && words[0]) {
                result.password = words[0];
            }
        }
    }
    
    return result;
}

// Ejecutar división de texto
function executeSplitText(selection, separator, options) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    
    saveUndoState(ACTION_TYPES.TEXT_SPLIT, 'División de texto entre columnas', selection.cells);
    
    let changesMade = 0;
    let columnsNeeded = 0;
    
    // Calcular cuántas columnas necesitamos
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cellValue = tablaDatos[row] && tablaDatos[row][col] ? tablaDatos[row][col].toString() : '';
        
        if (cellValue) {
            let parts = cellValue.split(separator);
            
            if (options.trimSpaces) {
                parts = parts.map(part => part.trim());
            }
            
            if (options.skipEmpty) {
                parts = parts.filter(part => part.length > 0);
            }
            
            columnsNeeded = Math.max(columnsNeeded, parts.length);
        }
    });
    
    // NO crear nuevas columnas automáticamente - solo usar las existentes
    // Las columnas deben existir previamente para que se puedan llenar
    
    // Procesar con registro detallado de cambios
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cellValue = tablaDatos[row] && tablaDatos[row][col] ? tablaDatos[row][col].toString() : '';
        
        if (cellValue) {
            let parts = cellValue.split(separator);
            
            if (options.trimSpaces) {
                parts = parts.map(part => part.trim());
            }
            
            if (options.skipEmpty) {
                parts = parts.filter(part => part.length > 0);
            }
            
            if (parts.length > 0) {
                const oldValue = tablaDatos[row][col];
                const newValue = parts[0];
                tablaDatos[row][col] = newValue;
                
                // Registrar en historial detallado solo si la función existe
                if (typeof recordDetailedChange === 'function') {
                    recordDetailedChange('split-text', { row, col }, oldValue, newValue);
                }
                changesMade++;
            }
            
            for (let i = 1; i < parts.length && col + i < tablaDatos[row].length; i++) {
                const oldValue = tablaDatos[row][col + i] || '';
                const newValue = parts[i];
                tablaDatos[row][col + i] = newValue;
                
                // Registrar en historial detallado solo si la función existe
                if (typeof recordDetailedChange === 'function') {
                    recordDetailedChange('split-text', { row, col: col + i }, oldValue, newValue);
                }
                changesMade++;
            }
        }
    });
    
    // Actualizar plantilla y guardar inmediatamente
    plantilla.datos = tablaDatos;
    
    // Verificar si la función existe
    if (typeof saveChangesHistory === 'function') {
        saveChangesHistory();
    }
    
    // Guardar inmediato con feedback detallado
    
    
        // GUARDADO OPTIMIZADO: Un solo guardado robusto con reintentos automáticos
        saveWorksheetDataUnified(plantilla, {
            successCallback: () => {
                reRenderTable(plantilla);
            // Texto dividido y guardado - ${changesMade} cambios aplicados
            
            // Optimización aplicada
        },
            errorCallback: (error) => {
            showClipboardIndicator('❌ Error guardando cambios de división de texto');
            },
            silent: false,
            showIndicator: false // Usamos nuestros propios indicadores
        });
}


function getCellElement(row, col) {
    // Input normal
    let element = document.querySelector(`#cell-${row}-${col}`);
    
    // Si no se encuentra, buscar si es un campo de información adicional
    if (!element) {
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla && plantilla.campos[col] === 'informacion-adicional') {
            element = document.querySelector(`td[data-row-index="${row}"][data-col-index="${col}"] .cell-info-adicional`);
        }
    }
    
    return element;
}

// Código obsoleto eliminado

// Función ULTRA-OPTIMIZADA de updateDuplicateStyles para velocidad máxima
function updateDuplicateStyles(plantilla, delay = 0) {
    // OPTIMIZADO: Reducir throttling para mayor velocidad
    const now = Date.now();
    if (now - lastDuplicateCheck < 25) { // Reducido de 100ms a 25ms
        return;
    }
    lastDuplicateCheck = now;
    
    // OPTIMIZADO: Cache más agresivo para velocidad
    const cacheKey = generateDuplicateCacheKey(plantilla);
    if (duplicateStylesCache.has(cacheKey)) {
        const cachedData = duplicateStylesCache.get(cacheKey);
        if (cachedData.timestamp > now - 2000) { // Reducido de 5s a 2s para mayor frescura
            applyCachedDuplicateStyles(cachedData.duplicates);
            return;
        }
    }
    
    const updateLogic = () => {
        try {
            if (!plantilla) return;
            
            // OPTIMIZADO: Detectar duplicados de forma más rápida
            const duplicates = detectDuplicatesOptimized(plantilla);
            
            // OPTIMIZADO: Cache más pequeño para velocidad
            duplicateStylesCache.set(cacheKey, {
                duplicates: duplicates,
                timestamp: now
            });
            
            // Limpiar cache más agresivamente
            if (duplicateStylesCache.size > 5) { // Reducido de 10 a 5
                const oldestKey = duplicateStylesCache.keys().next().value;
                duplicateStylesCache.delete(oldestKey);
            }
            
            // OPTIMIZADO: Aplicar estilos inmediatamente sin delay
            applyDuplicateStyles(duplicates);
            
        } catch (error) {
            console.error('Error en updateDuplicateStyles:', error);
        }
    };
    
    // OPTIMIZADO: Ejecutar inmediatamente para máxima velocidad
    if (delay > 0) {
        setTimeout(updateLogic, Math.min(delay, 10)); // Máximo 10ms de delay
    } else {
        updateLogic();
    }
}

// Función helper para generar clave de cache
function generateDuplicateCacheKey(plantilla) {
    if (!plantilla || !plantilla.datos) return 'no-data';
    
    // Hash simple basado en datos de correo, contraseña y links
    const emailData = plantilla.datos.map(row => row[0] || '').join('|');
    const passwordData = plantilla.datos.map(row => row[1] || '').join('|');
    const linksData = plantilla.datos.map(row => row[2] || '').join('|');
    
    return btoa(emailData + passwordData + linksData).substring(0, 16);
}

// Función ULTRA-OPTIMIZADA para detectar duplicados con máxima velocidad
function detectDuplicatesOptimized(plantilla) {
    const duplicates = {
        correo: new Set(),
        contraseña: new Set(),
        links: new Set()
    };
    
    if (!plantilla.datos || !Array.isArray(plantilla.datos)) {
        return duplicates;
    }
    
    // OPTIMIZADO: Usar Maps más eficientes
    const valueMap = {
        correo: new Map(),
        contraseña: new Map(),
        links: new Map()
    };
    
    // OPTIMIZADO: Pre-calcular columnas una sola vez
    const correoCols = [];
    const contraseñaCols = [];
    const linksCols = [];
    
    for (let i = 0; i < plantilla.campos.length; i++) {
        const campo = plantilla.campos[i];
        if (campo === 'correo') correoCols.push(i);
        else if (campo === 'contraseña') contraseñaCols.push(i);
        else if (campo === 'links') linksCols.push(i);
    }
    
    // OPTIMIZADO: Procesar datos de forma más eficiente
    const dataLength = plantilla.datos.length;
    for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
        const row = plantilla.datos[rowIndex];
        if (!row) continue;
        
        // OPTIMIZADO: Procesar correo
        for (let i = 0; i < correoCols.length; i++) {
            const colIdx = correoCols[i];
            const value = row[colIdx];
            if (value && value.trim()) {
                const trimmedValue = value.trim().toLowerCase();
                if (valueMap.correo.has(trimmedValue)) {
                    duplicates.correo.add(`${rowIndex}-${colIdx}`);
                    duplicates.correo.add(`${valueMap.correo.get(trimmedValue)}-${colIdx}`);
                } else {
                    valueMap.correo.set(trimmedValue, rowIndex);
                }
            }
        }
        
        // OPTIMIZADO: Procesar contraseña
        for (let i = 0; i < contraseñaCols.length; i++) {
            const colIdx = contraseñaCols[i];
            const value = row[colIdx];
            if (value && value.trim()) {
                const trimmedValue = value.trim();
                if (valueMap.contraseña.has(trimmedValue)) {
                    duplicates.contraseña.add(`${rowIndex}-${colIdx}`);
                    duplicates.contraseña.add(`${valueMap.contraseña.get(trimmedValue)}-${colIdx}`);
                } else {
                    valueMap.contraseña.set(trimmedValue, rowIndex);
                }
            }
        }
        
        // OPTIMIZADO: Procesar links
        for (let i = 0; i < linksCols.length; i++) {
            const colIdx = linksCols[i];
            const value = row[colIdx];
            if (value && value.trim()) {
                const trimmedValue = value.trim().toLowerCase();
                if (valueMap.links.has(trimmedValue)) {
                    duplicates.links.add(`${rowIndex}-${colIdx}`);
                    duplicates.links.add(`${valueMap.links.get(trimmedValue)}-${colIdx}`);
                } else {
                    valueMap.links.set(trimmedValue, rowIndex);
                }
            }
        }
    }
    
    return duplicates;
}

// Función para aplicar estilos de duplicados desde cache
function applyCachedDuplicateStyles(duplicates) {
    // Limpiar estilos anteriores
    clearDuplicateStyles();
    
    // Aplicar nuevos estilos
    applyDuplicateStyles(duplicates);
}

// Función ULTRA-OPTIMIZADA para aplicar estilos de duplicados con máxima velocidad
function applyDuplicateStyles(duplicates) {
    // OPTIMIZADO: Limpiar estilos de forma más eficiente
    clearDuplicateStyles();
    
    // OPTIMIZADO: Pre-calcular rangos de página
    const startRow = (currentPage - 1) * rowsPerPage;
    const endRow = startRow + rowsPerPage;
    
    // OPTIMIZADO: Aplicar estilos de forma más eficiente
    const allDuplicados = new Set([
        ...duplicates.correo,
        ...duplicates.contraseña,
        ...duplicates.links
    ]);
    
    // OPTIMIZADO: Procesar solo celdas visibles en la página actual
    for (const cellKey of allDuplicados) {
        if (!cellKey || typeof cellKey !== 'string') continue;
        
        const [row, col] = cellKey.split('-');
        if (!row || !col) continue;
        
        const rowIndex = parseInt(row);
        const colIndex = parseInt(col);
        
        // OPTIMIZADO: Verificar página más eficientemente
        if (rowIndex >= startRow && rowIndex < endRow) {
            // OPTIMIZADO: Usar querySelector más específico
            const td = document.querySelector(`td[data-row-index="${row}"][data-col-index="${col}"]`);
            if (!td) continue;
            
            // OPTIMIZADO: Verificar formato del usuario de forma más rápida
            if (!td.getAttribute('data-custom-bg') && 
                !td.getAttribute('data-custom-color') && 
                !td.getAttribute('data-format-bold') && 
                !td.getAttribute('data-format-underline')) {
                
                // OPTIMIZADO: Aplicar estilos de forma más eficiente
                td.style.cssText += 'background: #ffeb3b !important; color: #333 !important; border: 2px solid #ffc107 !important; font-weight: bold !important;';
                td.classList.add('duplicate-cell');
                td.setAttribute('data-duplicate-fixed', 'true');
            }
        }
    }
}

// Función para limpiar estilos de duplicados
function clearDuplicateStyles() {
    const duplicateCells = document.querySelectorAll('.duplicate-cell');
    duplicateCells.forEach(cell => {
        try {
            cell.classList.remove('duplicate-cell');
            const td = safeClosest(cell, 'td');
            
            if (td) {
                const hasUserFormat = td.getAttribute('data-custom-bg') || 
                                     td.getAttribute('data-custom-color') || 
                                     td.getAttribute('data-format-bold') || 
                                     td.getAttribute('data-format-underline');
                
                if (!hasUserFormat) {
                    // Verificar si no es un color de bloque
                    const currentBg = td.style.background || '';
                    const isBlockColor = ['#4caf50', '#e74c3c', '#2196f3', '#ff9800', '#9c27b0', '#e91e63', '#000000']
                        .some(color => currentBg.includes(color));
                    
                    if (!isBlockColor) {
                        td.style.background = '';
                        td.style.color = '';
                        td.style.border = '';
                    }
                }
            }
        } catch (error) {
            // Silently continue
        }
    });
}










function updateCellValue(row, col, value, campo) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    
    
    if (tablaDatos[row] && tablaDatos[row][col] !== undefined) {
        tablaDatos[row][col] = value;
    }
    
    // Actualizar elemento DOM
    const cellElement = getCellElement(row, col);
    if (cellElement) {
        cellElement.value = value;
        
        
        if (campo) {
            renderCellFormat(cellElement, campo, value);
        }
    }
    
    return { plantilla, cellElement };
}


// Función de guardado unificada y optimizada
function saveWorksheetDataUnified(plantilla, options = {}) {
    // Parámetros unificados con valores por defecto
    const {
        successCallback = null,
        errorCallback = null,
        silent = false,
        showIndicator = true,
        maxRetries = 2,
        retryDelay = 1000
    } = options;
    
    // Soporte para llamadas legacy con parámetros antiguos
    if (typeof options === 'function') {
        const legacySuccessCallback = options;
        const legacyErrorCallback = arguments[2];
        return saveWorksheetDataUnified(plantilla, {
            successCallback: legacySuccessCallback,
            errorCallback: legacyErrorCallback,
            silent: false,
            showIndicator: true
        });
    }
    
    // Validaciones básicas
    if (!plantilla || !plantilla.id) {
        const error = 'Plantilla no válida';
        if (errorCallback) errorCallback(error);
        return Promise.reject(error);
    }
    
    // Pausar sincronización durante el guardado para evitar conflictos
    if (typeof pauseSync === 'function') {
        pauseSync(5000);
    }
    
    // Detectar modo compartido y usar ruta correspondiente
    const isSharedMode = window.isSharedMode || false;
    const isReadonly = window.isReadonly || false;
    
    // No permitir guardado en modo readonly
    if (isSharedMode && isReadonly) {
        if (!silent && showIndicator) {
            showClipboardIndicator('ℹ️ Modo solo lectura - no se puede guardar');
        }
        return Promise.resolve();
    }
    
    // Preparar datos para guardar
    const dataToSave = {
        template_id: plantilla.id,
        data: tablaDatos,
        campos: plantilla.campos,
        formato: plantilla.formato || {}
    };
    
    // Determinar URL y headers según el modo
    const { url, headers } = getSaveConfig(plantilla, isSharedMode);
    
    // Función interna para realizar el guardado con reintentos
    const attemptSave = (attempt = 1) => {
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(dataToSave)
        }).then(response => {
            if (response.ok) {
                return handleSaveSuccess(response, successCallback, silent, showIndicator);
            } else {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }
        }).catch(error => {
            return handleSaveError(error, attempt, maxRetries, retryDelay, errorCallback, silent, showIndicator, attemptSave);
        });
    };

    return attemptSave();
}

// Obtener configuración de guardado
function getSaveConfig(plantilla, isSharedMode) {
    if (isSharedMode) {
        return {
            url: `/tienda/api/shared/worksheet/${plantilla.id}/save?token=${window.sharedToken || ''}`,
            headers: { 'Content-Type': 'application/json' }
        };
    } else {
        return {
            url: '/api/store/worksheet_data',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }
        };
    }
}

// Manejar éxito del guardado
function handleSaveSuccess(response, successCallback, silent, showIndicator) {
                return response.json().then(serverData => {
        // Actualizar timestamp del servidor
                    if (typeof updateLastKnownTime === 'function') {
                        if (serverData.timestamp) {
                            updateLastKnownTime(serverData.timestamp);
                        } else {
                            updateLastKnownTime(); 
                        }
                    }
                    
        // Notificar a otros usuarios sobre los cambios
                    if (typeof notifyRemoteUsers === 'function') {
                        notifyRemoteUsers();
                        
                        // Sincronización inmediata para propagar cambios
                        setTimeout(() => {
                            if (isSyncEnabled && !isCurrentlyUpdating) {
                                safeCheckForRemoteChanges();
                            }
                        }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms 
                    }
                    
        // Mostrar indicador de éxito
                    // Guardado silencioso - sin notificación
        
                    if (successCallback) successCallback(response);
                    return response;
                }).catch(jsonError => {
                    // Si no se puede parsear JSON pero la respuesta fue exitosa
                    if (typeof updateLastKnownTime === 'function') {
                        updateLastKnownTime();
                    }
                    
                    if (typeof notifyRemoteUsers === 'function') {
                        notifyRemoteUsers();
                    }
                    
                    // Guardado silencioso - sin notificación
        
                    if (successCallback) successCallback(response);
                    return response;
                });
            }

// Manejar errores del guardado
function handleSaveError(error, attempt, maxRetries, retryDelay, errorCallback, silent, showIndicator, attemptSave) {
            if (attempt < maxRetries) {
                // Reintentar después del delay
                if (!silent && showIndicator) {
                    showClipboardIndicator(`⚠️ Reintentando guardado... (${attempt}/${maxRetries})`);
                }
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(attemptSave(attempt + 1));
                    }, retryDelay * attempt); // Delay incremental
                });
            } else {
                // Todos los reintentos fallaron
                const errorMsg = `Error al guardar después de ${maxRetries} intentos: ${error.message}`;
                if (!silent && showIndicator) {
                    showClipboardIndicator(`❌ ${errorMsg}`);
                }
                if (errorCallback) errorCallback(error);
                throw error;
            }
}

// Función unificada de guardado
function saveWorksheetData(plantilla, successCallback = null, errorCallback = null) {
    // Soporte para llamadas legacy con parámetros antiguos
    if (typeof successCallback === 'function' || typeof errorCallback === 'function') {
        // saveWorksheetData(plantilla, successCallback, errorCallback)
        return saveWorksheetDataUnified(plantilla, {
            successCallback: successCallback,
            errorCallback: errorCallback,
            silent: false,
            showIndicator: true
        });
    }
    
    // Si se pasa un objeto de opciones, usar directamente
    if (typeof successCallback === 'object' && successCallback !== null) {
        return saveWorksheetDataUnified(plantilla, successCallback);
    }
    
    // Llamada simple sin parámetros
    return saveWorksheetDataUnified(plantilla, {
        silent: false,
        showIndicator: true
    });
}



// Con validación robusta
function formatFieldValue(value, campo) {
    if (!value && value !== 0) return '';
    
    // Convertir a string de forma segura
    const stringValue = String(value).trim();
    
    switch (campo) {
        case 'correo':
            return stringValue.toLowerCase();
        case 'let':
        case 'letras': // Nota que 'let'
            return stringValue.slice(0, 4);
        case 'numero':
            // Validación estricta para números: solo 1, 2, 3, 4, 5, 6, 8
            const validNumbers = ['1', '2', '3', '4', '5', '6', '8'];
            
            // Si está vacío, permitir
            if (!stringValue || stringValue.trim() === '') {
                return '';
            }
            
            // Si es un solo carácter válido, permitirlo
            if (validNumbers.includes(stringValue)) {
                return stringValue;
            }
            
            // Si tiene múltiples caracteres, tomar solo el último válido
            const lastChar = stringValue.slice(-1);
            if (validNumbers.includes(lastChar)) {
                return lastChar;
            }
            
            // Si no es válido, devolver vacío para forzar limpieza
            return '';
        case 'links':
            const link = stringValue;
            if (link && !link.startsWith('http://') && !link.startsWith('https://')) {
                return 'https://' + link;
            }
            return link;
        default:
            return stringValue;
    }
}



// Obtener tipo de input para un campo (usado 10+ veces) - CORREGIDO
function getInputType(campo) {
    // Usar "text" para prevenir errores de parsing con letras
    // Manejar validación en JavaScript
    return 'text';
}

// Obtener clase CSS para un campo con soporte para letras
function getFieldCssClass(campo) {
    switch (campo) {
        case 'numero':
            
            return worksheetMode === 'copiar' ? 'form-control cell-numero-pequeno' : 'form-control cell-numero';
        case 'let':
            return 'form-control cell-let';
        case 'letras': 
            return 'form-control cell-letras';
        case 'correo':
            return 'form-control cell-correo-ancho';
        case 'contraseña':
            return 'form-control cell-contraseña';
        case 'links':
            return 'form-control cell-links';
        default:
            return `form-control cell-${campo}`;
    }
}

// Generar HTML para input de celda (usado 10+ veces) - MEJORADO
function generateCellInput(campo, valor, filaIdx, colIdx, extraAttrs = '') {
    const inputType = getInputType(campo);
    const cssClass = getFieldCssClass(campo);
    
    // Sanitizar valor antes de establecerlo
    let safeValue = '';
    if (valor) {
        safeValue = formatFieldValue(valor, campo);
        // Escapar HTML
        safeValue = String(safeValue).replace(/"/g, '&quot;');
    }
    
    let attrs = `id="cell-${filaIdx}-${colIdx}" class="${cssClass}" value="${safeValue}" type="${inputType}" ${extraAttrs}`;
    
    // Agregar soporte para letras
    if (campo === 'let') {
        attrs += ' maxlength="4"';
    } else if (campo === 'letras') { 
        attrs += ' maxlength="4"'; // Mismo que 'let'
    } else if (campo === 'numero') {
        // Sin min/max que causaban problemas, usar validación en JS
        attrs += ' placeholder="#"';
    }
    
    return `<input ${attrs}>`;
}

// SISTEMA CENTRALIZADO DE GESTIÓN DE MODALES CON CLEANUP AUTOMÁTICO
const ModalManager = {
    activeModals: new Map(),
    
    // Crear modal con cleanup automático
    create(className, options = {}) {
        const {
            position = 'fixed',
            top = '0',
            left = '0',
            width = '100%',
            height = '100%',
            background = 'rgba(0,0,0,0.5)',
            zIndex = '2000',
            display = 'flex',
            alignItems = 'center',
            justifyContent = 'center',
            autoCleanup = true
        } = options;
        
        // Limpiar modales anteriores de la misma clase
        this.removeByClass(className);
        
        const modal = document.createElement('div');
        modal.className = className;
        Object.assign(modal.style, {
            position,
            top,
            left,
            width,
            height,
            background,
            zIndex,
            display,
            alignItems,
            justifyContent
        });
        
        const modalData = {
            element: modal,
            listeners: [],
            cleanup: () => {
                // Remover todos los event listeners
                modalData.listeners.forEach(({ element, event, handler }) => {
                    element.removeEventListener(event, handler);
                });
                modalData.listeners = [];
                
                // Remover del DOM
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
                
                // Remover del manager
                this.activeModals.delete(className);
            }
        };
        
        if (autoCleanup) {
            // Auto-cleanup al hacer clic fuera
            const outsideClickHandler = (e) => {
                if (e.target === modal) {
                    this.remove(className);
                }
            };
            modal.addEventListener('click', outsideClickHandler);
            modalData.listeners.push({ element: modal, event: 'click', handler: outsideClickHandler });
            
            // Auto-cleanup con ESC
            const escKeyHandler = (e) => {
                if (e.key === 'Escape') {
                    this.remove(className);
                }
            };
            document.addEventListener('keydown', escKeyHandler);
            modalData.listeners.push({ element: document, event: 'keydown', handler: escKeyHandler });
        }
        
        this.activeModals.set(className, modalData);
        return {
            element: modal,
            addListener: (element, event, handler) => {
                element.addEventListener(event, handler);
                modalData.listeners.push({ element, event, handler });
            },
            remove: () => this.remove(className),
            show: () => {
                document.body.appendChild(modal);
                return modal;
            }
        };
    },
    
    // Remover modal específico
    remove(className) {
        const modalData = this.activeModals.get(className);
        if (modalData) {
            modalData.cleanup();
        }
    },
    
    // Remover modales por clase
    removeByClass(className) {
        document.querySelectorAll(`.${className}`).forEach(el => el.remove());
        this.activeModals.delete(className);
    },
    
    // Limpiar todos los modales
    removeAll() {
        this.activeModals.forEach((modalData) => {
            modalData.cleanup();
        });
        this.activeModals.clear();
    }
};


// HELPER: Función optimizada para re-renderizar tabla con configuración estándar
function reRenderTable(plantilla) {
    const container = document.getElementById('worksheetTableContainer');
    const idx = optimizedFunctions.getPlantillaIndex(plantilla);
    if (container && idx >= 0) {
        optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, idx);
    }
}

// Paginación de datos (usado en renderTablaEditable)
function calculatePagination(data) {
    let totalRows = data.length;
    let totalPages = 1;
    let paginatedRows = data;
    
    if (rowsPerPage !== 'todos') {
        totalPages = Math.ceil(totalRows / rowsPerPage);
        let pageChanged = false;
        if (currentPage > totalPages) {
            saveCurrentPage(totalPages);
            pageChanged = true;
        }
        if (currentPage < 1) {
            saveCurrentPage(1);
            pageChanged = true;
        }
        const startIdx = (currentPage - 1) * rowsPerPage;
        const endIdx = startIdx + rowsPerPage;
        paginatedRows = data.slice(startIdx, endIdx);
    } else {
        saveCurrentPage(1);
        totalPages = 1;
        paginatedRows = data;
    }
    
    return { totalRows, totalPages, paginatedRows };
}



// Buscar en todas las plantillas (restringido en modo compartido)
function buscarEnTodasLasPlantillas(query) {
    if (!query || query.trim() === '') {
        globalSearchResults = [];
        currentGlobalSearch = '';
        updateGlobalSearchDisplay();
        return [];
    }
    
    currentGlobalSearch = query.trim().toLowerCase();
    globalSearchResults = [];
    
    // No mostrar panel de resultados globales (redundante)
    if (window.isSharedMode) {

        // En modo compartido, solo usar el filtrado directo de la tabla
        // No mostrar el panel de "Encontrado X coincidencias" ya que es obvio
        globalSearchResults = []; // No mostrar panel
        updateGlobalSearchDisplay(); // Limpiar panel
        return [];
    } else {
        // NORMAL: Buscar en todas las plantillas
        plantillas.forEach((plantilla, plantillaIdx) => {
        if (!plantilla.datos || plantilla.datos.length === 0) return;
        
        let coincidenciasEnPlantilla = 0;
        let primeraCoincidencia = null;
        
        // Buscar en los datos de la plantilla
        plantilla.datos.forEach((fila, filaIdx) => {
            fila.forEach((valor, colIdx) => {
                const valorStr = String(valor || '').toLowerCase();
                if (valorStr.includes(currentGlobalSearch)) {
                    coincidenciasEnPlantilla++;
                    
                    // Primera coincidencia
                    if (!primeraCoincidencia) {
                        primeraCoincidencia = {
                            fila: filaIdx,
                            columna: colIdx,
                            valor: valor,
                            campo: plantilla.campos[colIdx]
                        };
                    }
                }
            });
        });
        
        // Si hay coincidencias, agregar a resultados
        if (coincidenciasEnPlantilla > 0) {
            globalSearchResults.push({
                plantilla: plantilla,
                plantillaIdx: plantillaIdx,
                coincidencias: coincidenciasEnPlantilla,
                primeraCoincidencia: primeraCoincidencia,
                titulo: plantilla.titulo
            });
        }
    });
    }
    
    updateGlobalSearchDisplay();
    
    return globalSearchResults;
}

// Actualización de resultados globales
function updateGlobalSearchDisplay() {
    const container = document.getElementById('globalSearchResults');
    
    // Si no existe el contenedor, crearlo
    if (!container) {
        createGlobalSearchContainer();
        return;
    }
    
    // Limpiar contenedor
    container.innerHTML = '';
    
    // Si no hay búsqueda activa o no hay resultados, ocultar el panel
    if (!currentGlobalSearch || currentGlobalSearch.trim() === '' || globalSearchResults.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    
    const title = document.createElement('div');
    title.className = 'global-search-title';
    
    if (window.isSharedMode) {
        // En modo compartido, mostrar que se encontró en la tabla actual
        title.innerHTML = `<i class="fas fa-search"></i> Encontrado ${globalSearchResults[0]?.coincidencias || 0} coincidencia${(globalSearchResults[0]?.coincidencias || 0) > 1 ? 's' : ''} en esta tabla:`;
    } else {
        // En modo admin, mostrar plantillas como antes
        title.innerHTML = `<i class="fas fa-search"></i> Encontrado en ${globalSearchResults.length} plantilla${globalSearchResults.length > 1 ? 's' : ''}:`;
    }
    
    container.appendChild(title);
    
    // Botones para cada plantilla con coincidencias
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'global-search-buttons';
    
    globalSearchResults.forEach((resultado, idx) => {
        const button = document.createElement('button');
        button.className = 'global-search-btn';
        button.innerHTML = `
            <span class="plantilla-titulo">${resultado.titulo}</span>
            <span class="coincidencias-count">${resultado.coincidencias} coincidencia${resultado.coincidencias > 1 ? 's' : ''}</span>
        `;
        
        // Evento para ir a esta plantilla/coincidencia
        button.addEventListener('click', function() {
            // Navegar a la coincidencia (no cambiar plantilla)
            if (window.isSharedMode) {
                // Navegar a la primera coincidencia en la tabla actual
                const coincidencia = resultado.primeraCoincidencia;
                if (coincidencia) {
                    
                    const searchInput = document.getElementById('mainSearchInput');
                    if (searchInput) {
                        searchInput.value = currentGlobalSearch;
                        filtrarFilasTabla(currentGlobalSearch, resultado.plantilla, optimizedFunctions.getStandardFieldNames(), document.getElementById('worksheetTableContainer'), 0);
                    }
                    
                    // Enfocar la celda con la coincidencia
                    setTimeout(() => {
                        const cell = getCellElement(coincidencia.fila, coincidencia.columna);
                        if (cell) {
                            cell.focus();
                            cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            
                            // Resaltar con función segura
                            const td = safeClosest(cell, 'td');
                            if (td) {
                                td.style.transition = 'all 0.3s ease';
                                td.style.boxShadow = '0 0 10px #007bff';
                                setTimeout(() => {
                                    td.style.boxShadow = '';
                                }, 1000);
                            }
                        }
                    }, 200);
                }
                return;
            }
            
            // NORMAL: Cambiar a la plantilla seleccionada
            selectedTemplateId = resultado.plantilla.id;
            localStorage.setItem('selectedWorksheetTemplateId', selectedTemplateId);
            
            // Actualizar menú visual
            document.querySelectorAll('.plantilla-menu-item').forEach(item => {
                item.classList.remove('active');
            });
            const menuItem = document.querySelector(`[data-plantilla-id="${resultado.plantilla.id}"]`);
            if (menuItem) {
                menuItem.classList.add('active');
            }
            
            // Mostrar plantilla
            mostrarTablaPlantilla(resultado.plantillaIdx);
            
            // Mantener la búsqueda activa en la nueva plantilla
            setTimeout(() => {
                const searchInput = document.getElementById('mainSearchInput');
                if (searchInput) {
                    searchInput.value = currentGlobalSearch;
                    filtrarFilasTabla(currentGlobalSearch, resultado.plantilla, optimizedFunctions.getStandardFieldNames(), document.getElementById('worksheetTableContainer'), resultado.plantillaIdx);
                }
            }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
        });
        
        buttonsContainer.appendChild(button);
    });
    
    container.appendChild(buttonsContainer);
}

// Crear contenedor de resultados globales
function createGlobalSearchContainer() {
    // Evitar contenedores con el mismo ID
    const existingContainer = document.getElementById('globalSearchResults');
    if (existingContainer) {
        return; // No crear otro
    }
    
    const mainSearchInput = document.getElementById('mainSearchInput');
    if (!mainSearchInput) return;
    
    // Contenedor principal que contiene todo el área de búsqueda
    const searchAreaContainer = safeClosest(mainSearchInput, '.d-flex.flex-column.align-items-center.justify-content-center.mb-4.w-100');
    if (!searchAreaContainer) {
        return;
    }
    
    // Contenedor de resultados globales
    const globalContainer = document.createElement('div');
    globalContainer.id = 'globalSearchResults';
    globalContainer.className = 'global-search-results';
    globalContainer.style.display = 'none'; // Solo controlar visibilidad
    
    // Insertar DESPUÉS del área de búsqueda para mejor diseño
    searchAreaContainer.parentNode.insertBefore(globalContainer, searchAreaContainer.nextSibling);
}

// Verificar si SELECT está abierto
function isSelectOpen() {
    
    if (selectIsOpen) {
        return true;
    }
    
    // Verificar SELECT enfocado
    const focusedSelect = document.querySelector('select:focus');
    if (focusedSelect) {
        return true;
    }
    
    // Verificar si el elemento activo es un SELECT
    const activeElement = document.activeElement;
    if (activeElement && activeElement.tagName === 'SELECT') {
        return true;
    }
    
    // Verificar si hay un dropdown de Bootstrap abierto
    const openDropdown = document.querySelector('.dropdown-menu.show');
    if (openDropdown) {
        return true;
    }
    
    return false;
}
// Configurar eventos para detectar SELECT abierto/cerrado
function setupSelectDetection() {
    // Cuando se abre un SELECT (focus)
    document.addEventListener('focusin', function(e) {
        if (e.target.tagName === 'SELECT') {
            selectIsOpen = true;
        }
    });
    
    // Cuando se cierra un SELECT (blur)
    document.addEventListener('focusout', function(e) {
        if (e.target.tagName === 'SELECT') {
            setTimeout(() => {
                selectIsOpen = false;
            }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms // Delay
        }
    });
    
    // Cuando se hace clic en un SELECT
    document.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'SELECT') {
            selectIsOpen = true;
        }
    });
    
    // Cuando se cierra un SELECT (change)
    document.addEventListener('change', function(e) {
        if (e.target.tagName === 'SELECT') {
            setTimeout(() => {
                selectIsOpen = false;
            }, 50);
        }
    });
    
    // Cuando se hace clic fuera del SELECT
    document.addEventListener('click', function(e) {
        if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') {
            selectIsOpen = false;
        }
    });
    
    // Cuando se presiona Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && selectIsOpen) {
            selectIsOpen = false;
        }
    });
}

// Detectar TODOS los campos de correo/contraseña (mejorado) - CORREGIDO
function detectarDuplicadosEnTiposCampo(plantilla, tipoCampo) {
    try {
    const duplicados = new Set();
        
                
        if (!plantilla || !plantilla.campos || !Array.isArray(plantilla.campos)) {
            return duplicados;
        }

        if (!tipoCampo || (tipoCampo !== 'correo' && tipoCampo !== 'contraseña' && tipoCampo !== 'links')) {
            return duplicados;
        }
    
    // Encontrar TODOS los índices de columnas que sean del tipo especificado
    const columnasRelevantes = [];
        if (plantilla.campos.forEach) {
        plantilla.campos.forEach((campo, colIdx) => {
                try {
                if (tipoCampo === 'correo' && isEmailField(campo)) {
            columnasRelevantes.push(colIdx);
        } else if (tipoCampo === 'contraseña' && isPasswordField(campo)) {
            columnasRelevantes.push(colIdx);
        } else if (tipoCampo === 'links' && campo === 'links') {
            columnasRelevantes.push(colIdx);
        }
                } catch (campoError) {
                    // Silently continue
        }
    });
        }
    
    if (columnasRelevantes.length === 0) {
        return duplicados;
    }
        
        
        // CORREGIDO: Usar plantilla.datos en lugar de tablaDatos para detectar duplicados en TODAS las filas
        if (!plantilla.datos || !Array.isArray(plantilla.datos)) {
            return duplicados;
        }
    
    // Para cada columna relevante, detectar duplicados
    columnasRelevantes.forEach(colIdx => {
            try {
    const valores = new Map(); // [valor] => [índices de filas]
    
        // Procesar TODAS las filas de la plantilla (no solo las visibles)
                if (plantilla.datos.forEach) {
        plantilla.datos.forEach((fila, filaIdx) => {
                        try {
                            if (!Array.isArray(fila)) return;
                            
        const valor = String(fila[colIdx] || '').toLowerCase().trim();
        if (valor === '') return; // Ignorar valores vacíos
        
        if (!valores.has(valor)) {
            valores.set(valor, []);
        }
        valores.get(valor).push(filaIdx);
                        } catch (filaError) {
                            // Silently continue
                        }
        });
                }
                
    // Buscar valores que aparecen más de una vez
                if (valores.forEach) {
        valores.forEach((indices, valor) => {
                        try {
                            if (Array.isArray(indices) && indices.length > 1) {
            indices.forEach(filaIdx => {
                                    try {
                duplicados.add(`${filaIdx}-${colIdx}`);
                                                                         } catch (addError) {
                                         // Silently continue
                                     }
            });
                            }
                                                 } catch (indicesError) {
                             // Silently continue
        }
        });
                }
                
            } catch (colError) {
                // Silently continue
            }
    });
    
    return duplicados;
        
    } catch (error) {
        return new Set();
    }
}

// Detectar duplicados en columna específica
function detectarDuplicadosEnColumnaEspecifica(plantilla, tipoCampo, colIndex) {
    try {
        const duplicados = new Set();
        
        
        if (!plantilla || !plantilla.campos || !Array.isArray(plantilla.campos)) {
            return duplicados;
        }

        if (!tipoCampo || (tipoCampo !== 'correo' && tipoCampo !== 'contraseña' && tipoCampo !== 'links')) {
            return duplicados;
        }
        
        // Verificar que la columna especificada sea del tipo correcto
        const campo = plantilla.campos[colIndex];
        let esTipoCorrecto = false;
        
        if (tipoCampo === 'correo' && isEmailField(campo)) {
            esTipoCorrecto = true;
        } else if (tipoCampo === 'contraseña' && isPasswordField(campo)) {
            esTipoCorrecto = true;
        } else if (tipoCampo === 'links' && campo === 'links') {
            esTipoCorrecto = true;
        }
        
        if (!esTipoCorrecto) {
            return duplicados;
        }
        
        
        // CORREGIDO: Usar plantilla.datos en lugar de tablaDatos para detectar duplicados en TODAS las filas
        if (!plantilla.datos || !Array.isArray(plantilla.datos)) {
            return duplicados;
        }
        
        // Buscar duplicados en la columna especificada
        const valores = new Map(); // [valor] => [índices de filas]
        
        // Procesar TODAS las filas de la plantilla (no solo las visibles)
        plantilla.datos.forEach((fila, filaIdx) => {
            try {
                if (!Array.isArray(fila)) return;
                
                const valor = String(fila[colIndex] || '').toLowerCase().trim();
                if (valor === '') return; // Ignorar valores vacíos
                
                if (!valores.has(valor)) {
                    valores.set(valor, []);
                }
                valores.get(valor).push(filaIdx);
            } catch (filaError) {
                // Silently continue
            }
        });
        
        // Buscar valores que aparecen más de una vez
        valores.forEach((indices, valor) => {
            try {
                if (Array.isArray(indices) && indices.length > 1) {
                    indices.forEach(filaIdx => {
                        try {
                            duplicados.add(`${filaIdx}-${colIndex}`);
                        } catch (addError) {
                            // Silently continue
                        }
                    });
                }
            } catch (indicesError) {
                // Silently continue
            }
        });
        
        return duplicados;
        
    } catch (error) {
        return new Set();
    }
}


// Función legacy para compatibilidad (ahora usa la nueva lógica)
function detectarDuplicados(plantilla, campo) {
    if (campo === 'correo') {
        return detectarDuplicadosEnTiposCampo(plantilla, 'correo');
    } else if (campo === 'contraseña') {
        return detectarDuplicadosEnTiposCampo(plantilla, 'contraseña');
    } else if (campo === 'links') {
        return detectarDuplicadosEnTiposCampo(plantilla, 'links');
    }
    return new Set();
}

// Ejecución después de corte exitoso
function executeCutDeletion() {
    if (clipboardMode === 'cut' && clipboardSelection) {
        // Ejecutando el corte
        showClipboardIndicator('Ejecutando corte...');
        
        
        setTimeout(() => {
            // Si estamos en modo corte (no se canceló)
            if (clipboardMode === 'cut') {
                clearSelectionData(clipboardSelection);
                clearCutStyles();
                
                
                clipboardData = null;
                clipboardMode = null;
                clipboardSelection = null;
                
                // Confirmar que el corte se completó
                showClipboardIndicator('✂️ Corte completado');
            }
        }, 250); // Optimizado para hojas de cálculo - reducido de 500ms a 250ms
    }
}

// Funciones de selección múltiple
function clearAllSelections() {
    selectedCells.clear();
    selectedRows.clear();
    selectedColumns.clear();
    lastSelectedCell = null;
    selectionStartCell = null;
    updateSelectionDisplay();
    
    // NO limpiar la selección de filas por drag
    // Se mantiene independiente
}

function addCellToSelection(row, col) {
    const cellKey = `${row}-${col}`;
    selectedCells.add(cellKey);
    
    
    
    // Guardar celda activa para persistencia cuando seleccionas cualquier celda
    saveActiveCellPosition(row, col);
    
    updateSelectionDisplay();
}

function removeCellFromSelection(row, col) {
    const cellKey = `${row}-${col}`;
    selectedCells.delete(cellKey);
    updateSelectionDisplay();
}

function selectRange(startRow, startCol, endRow, endCol) {
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
            addCellToSelection(row, col);
        }
    }
}

function selectRow(rowIndex) {
    selectedRows.add(rowIndex);
    updateSelectionDisplay();
}

function selectColumn(colIndex) {
    selectedColumns.add(colIndex);
    
    // Agregar todas las celdas de la columna a la selección
    const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
    cells.forEach(cell => {
        const rowIndex = parseInt(cell.getAttribute('data-row-index'));
        if (rowIndex !== null && !isNaN(rowIndex)) {
            selectedCells.add(`${rowIndex}-${colIndex}`);
        }
    });
    
    updateSelectionDisplay();
}

function updateSelectionDisplay() {
    // Limpiar estilos visuales anteriores
    document.querySelectorAll('.cell-selected, .row-selected, .col-selected').forEach(el => {
        el.classList.remove('cell-selected', 'row-selected', 'col-selected');
    });
    
    // Aplicar selección de celdas con función segura
    selectedCells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cell = getCellElement(row, col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
                td.classList.add('cell-selected');
            }
        }
    });
    
    // Aplicar selección de filas
    selectedRows.forEach(rowIndex => {
        const row = document.querySelector(`#worksheetTable tr[data-row-index="${rowIndex}"]`);
        if (row) {
            row.classList.add('row-selected');
        }
    });
    
    // Aplicar selección de columnas
    selectedColumns.forEach(colIndex => {
        const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
        const header = document.querySelector(`#worksheetTable th[data-col-index="${colIndex}"]`);
        
        cells.forEach(cell => {
            cell.classList.add('col-selected');
        });
        
        if (header) {
            header.classList.add('col-selected');
        }
    });
}

function getSelectionInfo() {
    const selection = {
        cells: Array.from(selectedCells),
        rows: Array.from(selectedRows),
        columns: Array.from(selectedColumns),
        hasSelection: selectedCells.size > 0 || selectedRows.size > 0 || selectedColumns.size > 0
    };
    

    
    return selection;
}

// Funciones de teclado tipo Excel

// Manejar evento de pegado
function handlePasteEvent(event) {
    // En el contexto de la tabla
    if (!isInWorksheetContext()) {
        return;
    }
    
    // NO procesar si hay un SELECT abierto
    if (isSelectOpen()) {
        return;
    }
    
    // Elemento activo es un input dentro de la tabla
    const activeElement = document.activeElement;
    const activeInContainer = safeClosest(activeElement, '#worksheetTableContainer');
    if (activeElement && activeElement.tagName === 'INPUT' && activeInContainer) {
        
        // NO interceptar pegado en inputs - dejar que funcione normalmente
        // En inputs debe funcionar con los event listeners normales
        return; // NO prevenir default, dejar que funcione normalmente
    }
    
    // En inputs, usar sistema simplificado
    event.preventDefault();
    
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) {
        return;
    }
    
    const text = clipboardData.getData('text');
    if (!text || !text.trim()) {
        return;
    }
    
    
    setTimeout(() => {
        pasteSimpleText(text);
    }, 10);
}

// Configurar eventos de teclado SIN DUPLICACIÓN
function setupKeyboardEvents() {
    if (keyboardEventsSetup) {

        return;
    }
    keyboardEventsSetup = true;
    

    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('keydown', handleKeyboardNavigation);
    
    // Event listener para pegado (ÚNICO)
    document.addEventListener('paste', handlePasteEvent);
    
    setupSelectDetection();
    
    // Hacer que el contenedor de la tabla sea focusable
    const worksheetContainer = document.getElementById('worksheetTableContainer');
    if (worksheetContainer) {
        worksheetContainer.setAttribute('tabindex', '0');
        worksheetContainer.style.outline = 'none';
        
        // Evento para hacer focus cuando se hace clic
        worksheetContainer.addEventListener('click', function(e) {
            // Si no se hizo clic en un input o select, hacer focus al contenedor
            if (!e.target.matches('input') && !e.target.matches('select')) {
                if (worksheetContainer) worksheetContainer.focus();
            }
        });
    }
}

// Manejar atajos de teclado
function handleKeyboardShortcuts(event) {
    // NO procesar si hay un SELECT abierto
    if (isSelectOpen()) {
        return;
    }
    
    // En el contexto de la tabla
    if (!isInWorksheetContext()) {
        return;
    }
    
    // NO interceptar eventos si el usuario está escribiendo en un input
    const activeElement = document.activeElement;
    if (activeElement && activeElement.tagName === 'INPUT') {
        // Interceptar atajos específicos, no teclas normales
        const isCtrl = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        
        // Interceptar atajos muy específicos cuando hay input activo
        if (isCtrl && ['c', 'x', 'v'].includes(key)) {
            // Funcionamiento normal en inputs
            return;
        }
        
        // NO interceptar delete/backspace en inputs
        if (key === 'delete' || key === 'backspace') {
            return;
        }
        
        // NO interceptar otros atajos en inputs
        return;
    }
    
    const isCtrl = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const key = event.key.toLowerCase();
    
    // Prevenir comportamiento por defecto solo para atajos específicos
    if (isCtrl && ['z', 'y', 'a', 'f', 'h'].includes(key)) {
        event.preventDefault();
    }
    
    // Prevenir delete/backspace si NO hay input activo
    if ((key === 'delete' || key === 'backspace') && (!activeElement || activeElement.tagName !== 'INPUT')) {
        event.preventDefault();
    }
    
    // Manejar Ctrl
    if (isCtrl) {
        switch (key) {
            case 'c':
                copySelection();
                break;
            case 'x':
                cutSelection();
                break;
            case 'v':
                // Usar el sistema de eventos paste como el manual
                pasteSelection();
                break;
            case 'z':
                if (isShift) {
                    // Con debouncing
                    redoTabla();
                } else {
                    // Con debouncing
                    undoTabla();
                }
                break;
            case 'y':
                // Con debouncing
                redoTabla();
                break;
            case 'a':
                selectAll();
                break;
            case 'f':
                showSearchReplaceDialog();
                break;
            case 'h':
                showSearchReplaceDialog();
                break;
        }
    }
    
    
    switch (key) {
        case 'delete':
        case 'backspace':
            deleteSelection();
            break;
        case 'escape':
            clearAllSelections();
            hideContextMenu();
            break;
        case 'f2':
            event.preventDefault();
            editSelectedCell();
            break;
    }
}

// Determinar si debemos interceptar la navegación con flechas
function shouldInterceptArrowNavigation(activeElement, key) {
    // Si no hay elemento activo, interceptar
    if (!activeElement) return true;
    
    // Permitir navegación desde campos de información adicional
    const isInfoAdicional = safeClosest(activeElement, '.cell-info-adicional');
    if (isInfoAdicional || (activeElement && activeElement.classList && activeElement.classList.contains('cell-info-adicional'))) {
        return true;
    }
    
    // Verificación adicional para elementos con tabindex
    const isInWorksheetContainer = safeClosest(activeElement, '#worksheetTableContainer');
    if (activeElement && activeElement.hasAttribute && activeElement.hasAttribute('tabindex') && isInWorksheetContainer) {
        return true;
    }
    
    // Verificar si la celda seleccionada es de información adicional
    if (lastSelectedCell) {
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla && plantilla.campos[lastSelectedCell.col] === 'informacion-adicional') {
            return true;
        }
    }
    
    // Verificar si el elemento activo es un campo de información adicional
    if (activeElement && activeElement.classList.contains('cell-info-adicional')) {
        return true;
    }
    
    // Si el elemento activo no es un input, interceptar siempre
    if (activeElement.tagName !== 'INPUT') return true;
    
    // Si el input no está en la tabla, no interceptar
    const isInputInContainer = safeClosest(activeElement, '#worksheetTableContainer');
    if (!isInputInContainer) return false;
    
    // Para inputs en la tabla
    const inputValue = activeElement.value || '';
    const isAtStart = activeElement.selectionStart === 0;
    const isAtEnd = activeElement.selectionStart === inputValue.length;
    const isEmpty = inputValue.length === 0;
    const isNumberInput = activeElement.type === 'number';
    
    // Reglas especiales en inputs de texto
    if (key === 'ArrowLeft') {
        return isAtStart || isEmpty;
    }
    if (key === 'ArrowRight') {
        // Interceptar flecha derecha si está al final del texto
        // No navegar normalmente cuando el campo está vacío
        return isAtEnd;
    }
    
    // En campos número, NO interceptar para permitir cambio de valor
    if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (isNumberInput) {
            // En inputs number, solo interceptar si está vacío o si se mantiene presionada Ctrl
            return isEmpty || event.ctrlKey;
        }
        // En otros inputs, siempre interceptar para navegar entre filas
        return true;
    }
    
    return false;
}

// Manejar navegación con teclado
function handleKeyboardNavigation(event) {
    // NO procesar si hay un SELECT abierto
    if (isSelectOpen()) {
        return;
    }
    
    if (!isInWorksheetContext()) return;
    
    const key = event.key;
    const isCtrl = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const activeElement = document.activeElement;
    
    // Determinar si debemos interceptar la navegación con flechas
    const shouldInterceptArrows = shouldInterceptArrowNavigation(activeElement, key);
    
    // Navegación con flechas
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        if (shouldInterceptArrows) {
        event.preventDefault();
        navigateWithArrows(key, isCtrl, isShift);
        }
    }
    
    // Navegación con Tab
    if (key === 'Tab') {
        // Interceptar en contexto de tabla
        event.preventDefault();
        navigateWithTab(isShift);
    }
    
    // Navegación con Enter
    if (key === 'Enter') {
                    // Verificar si la celda actual es de información adicional
            const currentCell = getCurrentCell();
            if (currentCell) {
                const plantilla = optimizedFunctions.getCurrentPlantilla();
                if (plantilla && plantilla.campos[currentCell.col] === 'informacion-adicional') {
                    event.preventDefault();
                    const valor = plantilla.datos[currentCell.row] ? plantilla.datos[currentCell.row][currentCell.col] || '' : '';
                    showInfoModal(currentCell.row, currentCell.col, valor);
                    return;
                }
            }
        
        // Para Enter, interceptar solo si no está editando
        const isEditingInputInContainer = safeClosest(activeElement, '#worksheetTableContainer');
        const isEditingInput = activeElement && activeElement.tagName === 'INPUT' && isEditingInputInContainer;
        if (!isEditingInput) {
        event.preventDefault();
        navigateWithEnter(isShift);
        }
    }
    
    // Navegación con Page Up/Down
    if (key === 'PageUp' || key === 'PageDown') {
        event.preventDefault();
        navigateWithPageKeys(key, isShift);
    }
    
    // Navegación con Home/End
    if (key === 'Home' || key === 'End') {
        event.preventDefault();
        navigateWithHomeEnd(key, isCtrl, isShift);
    }
}

// En el contexto de la tabla
function isInWorksheetContext() {
    const activeElement = document.activeElement;
    const worksheetContainer = document.getElementById('worksheetTableContainer');
    
    // NUNCA procesar si hay un SELECT abierto
    if (isSelectOpen()) {
        return false;
    }
    
    // NUNCA procesar si el elemento activo es un INPUT que NO está en la tabla
    const activeElementInContainer = safeClosest(activeElement, '#worksheetTableContainer');
    if (activeElement && activeElement.tagName === 'INPUT' && !activeElementInContainer) {
        return false;
    }
    
    // Si estamos dentro del contenedor de la tabla
    if (worksheetContainer && (
        // El contenedor tiene focus
        activeElement === worksheetContainer ||
        // Hay un elemento dentro de la tabla con focus
        worksheetContainer.contains(activeElement) ||
        // Hay una selección activa
        selectedCells.size > 0 || selectedRows.size > 0 || selectedColumns.size > 0
    )) {
        return true;
    }
    
    // Si el contenedor existe y el elemento activo está dentro, procesar
    if (worksheetContainer && activeElement && worksheetContainer.contains(activeElement)) {
        return true;
    }
    
    // Si no hay elemento activo específico pero el contenedor existe, procesar
    if (worksheetContainer && (!activeElement || activeElement === document.body)) {
        return true;
    }
    
    return false;
}

// Funciones de portapapeles

// Función para copiar selección
function copySelection() {
    const selection = getSelectionInfo();
    if (!selection.hasSelection) return;
    
    
    const data = extractSelectionData(selection);
    
    // Guardar en portapapeles interno
    clipboardData = data;
    clipboardMode = 'copy';
    clipboardSelection = selection;
    
    // Intentar copiar al portapapeles del sistema
    if (data && data.length > 0) {
        // Convertir datos a texto para el portapapeles del sistema
        const textData = convertDataToText(data);
        
        copyToClipboardMobile(textData)
                .then(() => {
                    showClipboardIndicator('Copiado');
                })
                .catch(error => {
                    showClipboardIndicator('Copiado (solo interno)');
                });
    }
    
    // (Cancela cualquier corte pendiente)
    clearCutStyles();
    
    // Cancelar cualquier corte pendiente al hacer una copia
    if (clipboardMode === 'cut') {
        clipboardMode = 'copy'; 
        showClipboardIndicator('Corte cancelado - Copiado');
    }
}

// Función para cortar selección
function cutSelection() {
    const selection = getSelectionInfo();
    if (!selection.hasSelection) return;
    
    clipboardData = extractSelectionData(selection);
    clipboardMode = 'cut';
    clipboardSelection = selection;
    
    // Intentar copiar al portapapeles del sistema (igual que copySelection)
    if (clipboardData && clipboardData.length > 0) {
        // Convertir datos a texto para el portapapeles del sistema
        const textData = convertDataToText(clipboardData);
        
        copyToClipboardMobile(textData)
                .then(() => {
    showClipboardIndicator('Cortado');
                })
                .catch(error => {
                    showClipboardIndicator('Cortado (solo interno)');
                });
    } else {
        showClipboardIndicator('Cortado');
    }
    
    
    applyCutStyles(selection);
}
// Pegar (HÍBRIDO - interno + sistema)
function pasteSelection() {
    // Usar interno para mantener estado de corte
    if (clipboardData && clipboardData.length > 0) {
        // Usar internos que mantienen el estado
        pasteInternalClipboard();
        return;
    }
    
    // Si no hay datos internos, usar portapapeles del sistema
    if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText()
            .then(text => {
                if (text && text.trim()) {
                    pasteSimpleText(text);
                } else {
                    showClipboardIndicator('❌ Portapapeles vacío');
                }
            })
            .catch(error => {
                showClipboardIndicator('❌ Error de portapapeles');
            });
    } else {
        showClipboardIndicator('❌ Portapapeles no disponible');
    }
}

// Función de pegado simple
function pasteSimpleText(text) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) {
        showClipboardIndicator('❌ No hay plantilla');
        return;
    }
    
    // Encontrar celda objetivo
    let targetCell = null;
    const activeInput = document.querySelector('#worksheetTableContainer input:focus');
    
    if (activeInput && activeInput.id.startsWith('cell-')) {
        const match = activeInput.id.match(/cell-(\d+)-(\d+)/);
        if (match) {
            targetCell = { row: parseInt(match[1]), col: parseInt(match[2]) };
        }
    }
    
    // Si no hay celda activa, buscar la primera celda seleccionada
    if (!targetCell && selectedCells.size > 0) {
        const firstSelected = Array.from(selectedCells)[0];
        const [row, col] = firstSelected.split('-').map(Number);
        targetCell = { row, col };
    }
    
    if (!targetCell) {
        showClipboardIndicator('❌ Selecciona una celda');
        return;
    }
    
    
    if (!tablaDatos[targetCell.row]) {
        return;
    }
    
    
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    
    if (lines.length === 1) {
        // Una sola línea
        const cleanText = lines[0].trim();
        
        
        tablaDatos[targetCell.row][targetCell.col] = cleanText;
        
        // Actualizar input visual
        const input = getCellElement(targetCell.row, targetCell.col);
        if (input) {
            input.value = cleanText;
        }
        
        // Sincronizar y guardar
        plantilla.datos = tablaDatos;
        saveWorksheetData(plantilla, 
            () => {}, // Guardado silencioso
            () => showClipboardIndicator('❌ Error al guardar')
        );
        
        // Ejecutar acción después del pegado exitoso
        executeCutDeletion();
        
    } else {
        // Líneas
        let pegadosCount = 0;
        lines.forEach((line, index) => {
            const rowIndex = targetCell.row + index;
            if (rowIndex < tablaDatos.length && tablaDatos[rowIndex]) {
                const cleanText = line.trim();
                tablaDatos[rowIndex][targetCell.col] = cleanText;
                
                // Actualizar input visual
                const input = getCellElement(rowIndex, targetCell.col);
                if (input) {
                    input.value = cleanText;
                }
                pegadosCount++;
            }
        });
        
        // Sincronizar y guardar
        plantilla.datos = tablaDatos;
        saveWorksheetData(plantilla, 
            () => showClipboardIndicator(`✅ ${pegadosCount} líneas pegadas`),
            () => showClipboardIndicator('❌ Error al guardar')
        );
        
        // Notificación después del pegado exitoso
        executeCutDeletion();
    }
}


function pasteSystemClipboard(text) {
    const currentSelection = getSelectionInfo();
    let targetCell = null;
    
    // Buscar celda objetivo - priorizar input activo
    const activeInput = document.querySelector('#worksheetTableContainer input:focus');
    if (activeInput && activeInput.id.startsWith('cell-')) {
        const match = activeInput.id.match(/cell-(\d+)-(\d+)/);
        if (match) {
            const row = parseInt(match[1]);
            const col = parseInt(match[2]);
            targetCell = { row, col };
        }
    } else if (currentSelection.cells.length > 0) {
        const cellKey = currentSelection.cells[0];
        const [row, col] = cellKey.split('-').map(Number);
        targetCell = { row, col };
    } else if (lastSelectedCell) {
        targetCell = lastSelectedCell;
    }
    
    if (!targetCell) {
        showClipboardIndicator('Error: Selecciona una celda destino');
        return;
    }
    
    
    pushTablaUndo();
    
    
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    
    if (lines.length > 1) {
        // nas (datos tabulares)
        const hasMultipleColumns = lines.some(line => 
            line.includes('\t') || line.split(/\s{2,}/).length > 1
        );
        
        if (hasMultipleColumns) {
            // nas
            pasteTabularData(lines, targetCell);
        } else {
            // Líneas en una sola columna
            pasteMultipleLines(lines, targetCell);
        }
    } else {
        // Una sola línea - verificar si tiene múltiples columnas
        const singleLine = lines[0] || text.trim();
        if (singleLine.includes('\t') || singleLine.split(/\s{2,}/).length > 1) {
            // Una fila con múltiples columnas
            pasteTabularData([singleLine], targetCell);
        } else {
            // Un solo valor
            pasteSingleValue(singleLine, targetCell);
        }
    }
    
    // Indicador
    showClipboardIndicator('Pegado');
    
    // INMEDIATO después del pegado del sistema
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (plantilla) {
        // Datos actualizados
        plantilla.datos = tablaDatos;
        

        
        // Inmediatamente sin timeout
        saveWorksheetData(plantilla, 
            () => {}, // Guardado silencioso
            () => {

                showClipboardIndicator('❌ Error al guardar');
            }
        );
    }
}

// Función para pegar datos tabulares
function pasteTabularData(lines, targetCell) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();

    
    let hasEmailOrPassword = false;
    
    // Línea para extraer las columnas
    const dataRows = lines.map(line => {
        // Dividir por tabulaciones o espacios múltiples
        if (line.includes('\t')) {
            return line.split('\t');
        } else {
            // Dividir por espacios múltiples
            return line.split(/\s{2,}/);
        }
    });
    
    // Calcular dimensiones necesarias
    const maxColumns = Math.max(...dataRows.map(row => row.length));
    const totalRows = dataRows.length;
    const rowsNeeded = targetCell.row + totalRows;
    const colsNeeded = targetCell.col + maxColumns;
    
    // Crear filas adicionales si es necesario
    const filasOriginales = tablaDatos.length;
    while (tablaDatos.length < rowsNeeded) {
        const nuevaFila = plantilla.campos.map(() => '');
        tablaDatos.push(nuevaFila);
    }
    
    // Indicador de filas creadas
    const filasCreadas = tablaDatos.length - filasOriginales;
    if (filasCreadas > 0) {
        showClipboardIndicator(`✅ Se crearon ${filasCreadas} filas automáticamente`);
    }
    
    // Verificar que no excedamos el número de columnas disponibles
    if (colsNeeded > plantilla.campos.length) {
        showClipboardIndicator('Advertencia: Algunas columnas no se pegaron');
    }
    
    
    dataRows.forEach((row, rowIndex) => {
        row.forEach((cellValue, colIndex) => {
            const targetRow = targetCell.row + rowIndex;
            const targetCol = targetCell.col + colIndex;
            
            // Verificar que la celda existe
            if (targetRow < tablaDatos.length && targetCol < plantilla.campos.length) {
                let value = cellValue.trim();
                
                // Formatear valor según el campo
                const campo = plantilla.campos[targetCol];
                value = formatFieldValue(value, campo);
                
                if (isEmailOrPasswordField(campo)) {
                    hasEmailOrPassword = true;
                }
                
                // Actualizar datos
                tablaDatos[targetRow][targetCol] = value;
                
                // Actualizar input en el DOM si existe
                const targetInput = getCellElement(targetRow, targetCol);
                if (targetInput) {
                    targetInput.value = value;
                    renderCellFormat(targetInput, campo, value);
                }
            }
        });
    });
    
    // Actualizar plantilla y guardar
    if (plantilla) {
        plantilla.datos = tablaDatos;
        
        // Guardar en backend
        saveWorksheetData(plantilla, 
            (response) => {
                // Re-renderizar si se agregaron nuevas filas
                if (filasCreadas > 0) {
                    reRenderTable(plantilla);
                }
            },
                            () => {}
        );
        
        // Actualizar estilos si es necesario (optimizado)
        if (hasEmailOrPassword) {
            debouncedUpdateDuplicateStyles(plantilla, 50); // Optimizado para hojas de cálculo
        }
        
        // Notificación después del pegado exitoso
        executeCutDeletion();
    }
    
    // Resaltar el área pegada
    clearAllSelections();
    for (let rowIndex = 0; rowIndex < totalRows; rowIndex++) {
        for (let colIndex = 0; colIndex < Math.min(maxColumns, plantilla.campos.length - targetCell.col); colIndex++) {
            addCellToSelection(targetCell.row + rowIndex, targetCell.col + colIndex);
        }
    }
}

// Pegar múltiples líneas hacia abajo
function pasteMultipleLines(lines, targetCell) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();

    
    let hasEmailOrPassword = false;
    let rowsNeeded = targetCell.row + lines.length;
    
    // Agregar filas si es necesario
    const filasOriginales = tablaDatos.length;
    while (tablaDatos.length < rowsNeeded) {
        const nuevaFila = plantilla.campos.map(() => '');
        tablaDatos.push(nuevaFila);
    }
    
    // Indicador de filas creadas
    const filasCreadas = tablaDatos.length - filasOriginales;
    if (filasCreadas > 0) {
        showClipboardIndicator(`✅ Se crearon ${filasCreadas} filas automáticamente`);
    }
    
    // Línea en una fila diferente
    lines.forEach((line, index) => {
        const targetRow = targetCell.row + index;
        const targetCol = targetCell.col;
        
        // Verificar que la celda existe
        if (tablaDatos[targetRow] && tablaDatos[targetRow][targetCol] !== undefined) {
            let value = line.trim();
            
            // Formatear valor según el campo
            const campo = plantilla.campos[targetCol];
            value = formatFieldValue(value, campo);
            
            if (isEmailOrPasswordField(campo)) {
                hasEmailOrPassword = true;
            }
            
            tablaDatos[targetRow][targetCol] = value;
            
            // Actualizar input en el DOM si existe
            const targetInput = getCellElement(targetRow, targetCol);
            if (targetInput) {
                targetInput.value = value;
                renderCellFormat(targetInput, campo, value);
            }
        }
    });
    
    // Actualizar plantilla y guardar
    if (plantilla) {
        plantilla.datos = tablaDatos;
        
        // Guardar en backend
        saveWorksheetData(plantilla, 
            (response) => {
                // Re-renderizar si se agregaron nuevas filas
                if (filasCreadas > 0) {
                    reRenderTable(plantilla);
                }
            },
                            () => {}
        );
        
        // Actualizar estilos si es necesario (optimizado)
        if (hasEmailOrPassword) {
            debouncedUpdateDuplicateStyles(plantilla, 50); // Optimizado para hojas de cálculo
        }
        
        // Notificación después del pegado exitoso
        executeCutDeletion();
    }
    
    // Seleccionar el área pegada
    clearAllSelections();
    for (let i = 0; i < lines.length; i++) {
        addCellToSelection(targetCell.row + i, targetCell.col);
    }
}

// Pegar un solo valor
function pasteSingleValue(value, targetCell) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    let hasEmailOrPassword = false;
    
    // Formatear valor según el campo
    const campo = plantilla.campos[targetCell.col];
    value = formatFieldValue(value, campo);
    
    if (isEmailOrPasswordField(campo)) {
        hasEmailOrPassword = true;
    }
    
    // Actualizar datos
    if (tablaDatos[targetCell.row] && tablaDatos[targetCell.row][targetCell.col] !== undefined) {
        tablaDatos[targetCell.row][targetCell.col] = value;
        
        // Actualizar input en el DOM
        const targetInput = getCellElement(targetCell.row, targetCell.col);
        if (targetInput) {
            targetInput.value = value;
            renderCellFormat(targetInput, campo, value);
        }
        
        // Actualizar plantilla y guardar
        if (plantilla) {
            plantilla.datos = tablaDatos;
            
            // Guardar en backend
            saveWorksheetData(plantilla, 
                null, 
                () => {}
            );
            
            // Actualizar estilos si es necesario (optimizado)
            if (hasEmailOrPassword) {
                debouncedUpdateDuplicateStyles(plantilla);
            }
            
            // Notificación después del pegado exitoso
            executeCutDeletion();
        }
    }
    
    // Resaltar la celda pegada
    clearAllSelections();
    addCellToSelection(targetCell.row, targetCell.col);
}

// Función interna (funcionalidad anterior)
function pasteInternalClipboard() {
    if (!clipboardData || !clipboardSelection) {
        return;
    }
    
    const currentSelection = getSelectionInfo();
    let targetCell = null;
    
    // Buscar celda objetivo (como Excel: solo necesita una celda)
    if (currentSelection.cells.length > 0) {
        const cellKey = currentSelection.cells[0];
        const [row, col] = cellKey.split('-').map(Number);
        targetCell = { row, col };
    } else if (lastSelectedCell) {
        targetCell = lastSelectedCell;
    } else {
        // Buscar en el DOM
        const activeInput = document.querySelector('#worksheetTableContainer input:focus');
        if (activeInput && activeInput.id.startsWith('cell-')) {
            const match = activeInput.id.match(/cell-(\d+)-(\d+)/);
            if (match) {
                const row = parseInt(match[1]);
                const col = parseInt(match[2]);
                targetCell = { row, col };
            }
        }
    }
    
    if (!targetCell) {
        showClipboardIndicator('Error: Selecciona una celda destino');
        return;
    }
    
    // Pegar datos al objetivo
    pasteDataToTargetExcelStyle(clipboardData, targetCell);
    
    // INMEDIATO después del pegado
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (plantilla) {
        // Datos actualizados
        plantilla.datos = tablaDatos;
        

        
        // Inmediatamente sin timeout
        saveWorksheetData(plantilla, 
            () => {}, // Guardado silencioso
            () => {

                showClipboardIndicator('❌ Error al guardar');
            }
        );
    }
    
    // Ejecución después del pegado exitoso
    executeCutDeletion();
}



// Agregar listener de input con auto-guardado
function addInputListener(input, plantilla, row, col, campo) {
    if (!input || !plantilla) return;
    
    input.addEventListener('input', function() {
        let val = input.value;
        
        // Formatear valor
        const oldValue = tablaDatos[row][col] || '';
        val = formatFieldValue(val, campo);
            input.value = val;
        
        // Antes de actualizar
        if (oldValue !== val) {
    
            recordDetailedChange('cell-edit', { row, col, campo }, oldValue, val);
        }
        
        // Actualizar datos
        tablaDatos[row][col] = val;
        plantilla.datos = tablaDatos;
        
        // OPTIMIZADO: NO renderizar formato durante escritura para evitar re-renderizado
        // El formato se aplicará automáticamente al:
        // - Cargar la tabla
        // - Cambiar de celda (blur)
        // - Aplicar formato manualmente
        // - Pegar datos
        // Esto evita interferencia visual durante la escritura
        
        // OPTIMIZADO: NO actualizar duplicados durante escritura para máxima fluidez
        // Los duplicados se actualizarán automáticamente al:
        // - Pegar datos
        // - Cambiar de celda (blur)
        // - Guardar la plantilla
        // - Cambiar de modo
        // Esto garantiza escritura 100% fluida sin interrupciones visuales
        
        // Guardar inmediatamente
        saveWorksheetData(plantilla, 
            () => {}, // Guardado silencioso
            () => showClipboardIndicator('❌ Error al guardar')
        );
    });
}

// Convertir datos a texto para portapapeles del sistema
function convertDataToText(data) {
    if (!data || data.length === 0) return '';
    
    // Agrupar por filas
    const rows = new Map();
    
    data.forEach(item => {
        if (!rows.has(item.row)) {
            rows.set(item.row, new Map());
        }
        rows.get(item.row).set(item.col, item.value);
    });
    
    // Convertir a texto con tabulaciones
    const sortedRows = Array.from(rows.keys()).sort((a, b) => a - b);
    const textRows = [];
    
    sortedRows.forEach(rowIndex => {
        const rowData = rows.get(rowIndex);
        const sortedCols = Array.from(rowData.keys()).sort((a, b) => a - b);
        const rowValues = sortedCols.map(colIndex => rowData.get(colIndex) || '');
        textRows.push(rowValues.join('\t'));
    });
    
    return textRows.join('\n');
}

// Función para extraer datos de selección
function extractSelectionData(selection) {
    const data = [];
    
    if (selection.cells.length > 0) {
        // Extraer datos de celdas seleccionadas
        selection.cells.forEach(cellKey => {
            const [row, col] = cellKey.split('-').map(Number);
            const cell = getCellElement(row, col);
            if (cell) {
                data.push({
                    row: row,
                    col: col,
                    value: cell.value || '',
                    type: 'cell'
                });
            }
        });
    }
    
    if (selection.rows.length > 0) {
        // Extraer datos de filas seleccionadas
        selection.rows.forEach(rowIndex => {
            const row = document.querySelector(`#worksheetTable tr[data-row-index="${rowIndex}"]`);
            if (row) {
                const cells = row.querySelectorAll('input[id^="cell-"]');
                cells.forEach(cell => {
                    const match = cell.id.match(/cell-(\d+)-(\d+)/);
                    if (match) {
                        const [, r, c] = match.map(Number);
                        data.push({
                            row: r,
                            col: c,
                            value: cell.value || '',
                            type: 'row'
                        });
                    }
                });
            }
        });
    }
    
    if (selection.columns.length > 0) {
        // Extraer datos de columnas completas
        selection.columns.forEach(colIndex => {
            const cells = document.querySelectorAll(`#worksheetTable input[id^="cell-"][id$="-${colIndex}"]`);
            cells.forEach(cell => {
                const match = cell.id.match(/cell-(\d+)-(\d+)/);
                if (match) {
                    const [, r, c] = match.map(Number);
                    data.push({
                        row: r,
                        col: c,
                        value: cell.value || '',
                        type: 'column'
                    });
                }
            });
        });
    }
    
    return data;
}

// Pegar datos en la celda objetivo
function pasteDataToTarget(data, targetCell) {
    if (!data || data.length === 0) return;
    
    // Calcular la posición mínima de los datos copiados
    const minRow = Math.min(...data.map(d => d.row));
    const minCol = Math.min(...data.map(d => d.col));
    
    const rowOffset = targetCell.row - minRow;
    const colOffset = targetCell.col - minCol;
    
    // Obtener la plantilla actual
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    let hasEmailOrPassword = false;
    
    // Procesar cada elemento de datos
    data.forEach(item => {
        const newRow = item.row + rowOffset;
        const newCol = item.col + colOffset;
        
        // Formatear valor según el campo
        const campo = plantilla.campos[newCol];
        let value = formatFieldValue(item.value, campo);
        
        if (isEmailOrPasswordField(campo)) {
            hasEmailOrPassword = true;
        }
        
        // Actualizar datos si existe
        if (tablaDatos[newRow] && tablaDatos[newCol] !== undefined) {
            tablaDatos[newRow][newCol] = value;
        }
        
        const targetInput = getCellElement(newRow, newCol);
        if (targetInput) {
            targetInput.value = value;
            
            // Renderizar formato
            if (campo) {
                renderCellFormat(targetInput, campo, value);
            }
        }
    });
    
    // Actualizar plantilla, el guardado se hace en la función padre
    if (plantilla) {
        plantilla.datos = tablaDatos;

        
        // Actualizar estilos si hay datos en campos correo/contraseña
        if (hasEmailOrPassword) {
            debouncedUpdateDuplicateStyles(plantilla);
        }
    }
}

// Función para pegar datos en una celda, se expande automáticamente
function pasteDataToTargetExcelStyle(data, targetCell) {
    if (!data || data.length === 0) return;
    
    // Calcular dimensiones del área copiada
    const minRow = Math.min(...data.map(d => d.row));
    const maxRow = Math.max(...data.map(d => d.row));
    const minCol = Math.min(...data.map(d => d.col));
    const maxCol = Math.max(...data.map(d => d.col));
    
    const copyWidth = maxCol - minCol + 1;
    const copyHeight = maxRow - minRow + 1;
    
    // Crear mapa de los datos copiados para acceso rápido
    const dataMap = new Map();
    data.forEach(item => {
        const relativeRow = item.row - minRow;
        const relativeCol = item.col - minCol;
        const key = `${relativeRow}-${relativeCol}`;
        dataMap.set(key, item.value);
    });
    
    // Obtener la plantilla actual
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    let hasEmailOrPassword = false;
    
    // Pegando según las dimensiones
    let pastedCount = 0;
    for (let r = 0; r < copyHeight; r++) {
        for (let c = 0; c < copyWidth; c++) {
            const newRow = targetCell.row + r;
            const newCol = targetCell.col + c;
            
            const dataKey = `${r}-${c}`;
            let value = dataMap.get(dataKey) || '';
            
            // Formatear valor según el campo
            const campo = plantilla.campos[newCol];
            value = formatFieldValue(value, campo);
            
            if (isEmailOrPasswordField(campo)) {
                hasEmailOrPassword = true;
            }
            
            // Actualizar datos si existe
            if (tablaDatos[newRow] && tablaDatos[newRow][newCol] !== undefined) {
                tablaDatos[newRow][newCol] = value;
            }
            
            const targetInput = getCellElement(newRow, newCol);
            if (targetInput) {
                targetInput.value = value;
                
                // Renderizar formato
                if (campo) {
                    renderCellFormat(targetInput, campo, value);
                }
                
                pastedCount++;
            }
        }
    }
    
    // Actualizar plantilla, el guardado se hace en la función padre
    if (plantilla) {
        plantilla.datos = tablaDatos;

        
        // Actualizar estilos si hay datos en campos correo/contraseña
        if (hasEmailOrPassword) {
            debouncedUpdateDuplicateStyles(plantilla);
        }
    }
    
    // Resaltar el área pegada para feedback visual
    clearAllSelections();
    for (let r = 0; r < copyHeight; r++) {
        for (let c = 0; c < copyWidth; c++) {
            const newRow = targetCell.row + r;
            const newCol = targetCell.col + c;
            
            const targetInput = getCellElement(newRow, newCol);
            if (targetInput) {
                addCellToSelection(newRow, newCol);
            }
        }
    }
}

// Función para limpiar datos de selección (para corte)
function clearSelectionData(selection) {
    // Obtener la plantilla actual
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    let hasEmailOrPassword = false;
    let clearedCells = [];
    
    if (selection.cells.length > 0) {
        selection.cells.forEach(cellKey => {
            const [row, col] = cellKey.split('-').map(Number);
            
            // Limpiar datos si existe
            if (tablaDatos[row] && tablaDatos[row][col] !== undefined) {
                tablaDatos[row][col] = '';
                
                // Verificar si es campo de correo/contraseña
                const campo = plantilla.campos[col];
                if (isEmailOrPasswordField(campo)) {
                    hasEmailOrPassword = true;
                }
                
                clearedCells.push({row, col, campo});
            }
            
            // Limpiar input visual
            const cell = getCellElement(row, col);
            if (cell) {
                cell.value = '';
                // Limpiar el formato visual
                const campo = plantilla.campos[col];
                if (campo) {
                    renderCellFormat(cell, campo, '');
                }
            }
            
            // También limpiar cualquier div de contenido (modo copiar)
            const td = document.querySelector(`td[data-row-index="${row}"][data-col-index="${col}"]`);
            if (td) {
                // Limpiar contenido
                const copyDiv = td.querySelector('.cell-copyable');
                if (copyDiv) {
                    const textSpan = copyDiv.querySelector('.cell-copy-text');
                    if (textSpan) {
                        textSpan.textContent = '';
                    }
                    copyDiv.setAttribute('data-valor', '');
                }
                
                // Limpiar iconos de copia
                const copyIcon = td.querySelector('.copy-icon');
                if (copyIcon) {
                    copyIcon.setAttribute('data-valor', '');
                }
            }
        });
    }
    
    if (selection.rows.length > 0) {
        selection.rows.forEach(rowIndex => {
            const row = document.querySelector(`#worksheetTable tr[data-row-index="${rowIndex}"]`);
            if (row) {
                const cells = row.querySelectorAll('input[id^="cell-"]');
                cells.forEach(cell => {
                    const match = cell.id.match(/cell-(\d+)-(\d+)/);
                    if (match) {
                        const [, r, c] = match.map(Number);
                        
                        // Limpiar datos si existe
                        if (tablaDatos[r] && tablaDatos[r][c] !== undefined) {
                            tablaDatos[r][c] = '';
                            
                            // Verificar si es campo de correo/contraseña
                            const campo = plantilla.campos[c];
                            if (isEmailOrPasswordField(campo)) {
                                hasEmailOrPassword = true;
                            }
                            
                            
                            clearedCells.push({row: r, col: c, campo});
                    }
                    
                    cell.value = '';
                        
                        // Limpiar el formato visual
                        const campo = plantilla.campos[c];
                        if (campo) {
                            renderCellFormat(cell, campo, '');
                        }
                        
                        // También limpiar cualquier div de contenido (modo copiar)
                        const td = safeClosest(cell, 'td');
                        if (td) {
                            // Limpiar contenido
                            const copyDiv = td.querySelector('.cell-copyable');
                            if (copyDiv) {
                                const textSpan = copyDiv.querySelector('.cell-copy-text');
                                if (textSpan) {
                                    textSpan.textContent = '';
                                }
                                copyDiv.setAttribute('data-valor', '');
                            }
                            
                            // Limpiar iconos de copia
                            const copyIcon = td.querySelector('.copy-icon');
                            if (copyIcon) {
                                copyIcon.setAttribute('data-valor', '');
                            }
                        }
                    }
                });
            }
        });
    }
    
    if (selection.columns.length > 0) {
        selection.columns.forEach(colIndex => {
            const cells = document.querySelectorAll(`#worksheetTable input[id^="cell-"][id$="-${colIndex}"]`);
            cells.forEach(cell => {
                const match = cell.id.match(/cell-(\d+)-(\d+)/);
                if (match) {
                    const [, r, c] = match.map(Number);
                    
                    // Limpiar datos si existe
                    if (tablaDatos[r] && tablaDatos[r][c] !== undefined) {
                        tablaDatos[r][c] = '';
                        
                        // Verificar si es campo de correo/contraseña
                        const campo = plantilla.campos[c];
                        if (isEmailOrPasswordField(campo)) {
                            hasEmailOrPassword = true;
                        }
                        
                        // Agregar a celdas limpiadas
                        clearedCells.push({row: r, col: c, campo});
                }
                
                cell.value = '';
                    
                    // Limpiar el formato visual
                    const campo = plantilla.campos[c];
                    if (campo) {
                        renderCellFormat(cell, campo, '');
                    }
                    
                    // También limpiar cualquier div de contenido (modo copiar)
                    const td = safeClosest(cell, 'td');
                    if (td) {
                        // Limpiar contenido
                        const copyDiv = td.querySelector('.cell-copyable');
                        if (copyDiv) {
                            const textSpan = copyDiv.querySelector('.cell-copy-text');
                            if (textSpan) {
                                textSpan.textContent = '';
                            }
                            copyDiv.setAttribute('data-valor', '');
                        }
                        
                        // Limpiar iconos de copia
                        const copyIcon = td.querySelector('.copy-icon');
                        if (copyIcon) {
                            copyIcon.setAttribute('data-valor', '');
                        }
                    }
                }
            });
        });
    }
    
    // Actualizar plantilla Y sincronizar con datos originales
    if (plantilla) {
        plantilla.datos = tablaDatos;
        
        // Sincronizar eliminaciones con datos originales para que persistan al limpiar filtros
        if (plantilla.datosOriginales) {
            // Aplicar eliminaciones a los datos originales
            clearedCells.forEach(({row, col}) => {
                if (plantilla.datosOriginales[row] && plantilla.datosOriginales[row][col] !== undefined) {
                    plantilla.datosOriginales[row][col] = '';
                }
            });
        }
        
        // Guardar en backend
        saveWorksheetData(plantilla);
        
        // Actualizar estilos si hay datos en campos correo/contraseña
        if (hasEmailOrPassword) {
            debouncedUpdateDuplicateStyles(plantilla);
        }
        
        // Actualizar visual de las celdas limpiadas
        setTimeout(() => {
            clearedCells.forEach(({row, col, campo}) => {
                const cell = getCellElement(row, col);
                if (cell) {
                    // Asegurar que el input esté vacío
                    cell.value = '';
                    
                    renderCellFormat(cell, campo, '');
                    
                    // Disparar evento de cambio para asegurar sincronización
                    const event = new Event('input', { bubbles: true });
                    cell.dispatchEvent(event);
                }
            });
        }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
        
        // Mostrar indicador de limpieza solo si no es desde corte
        if (clipboardMode !== 'cut') {
            showClipboardIndicator(`✅ ${clearedCells.length} celdas limpiadas`);
        }
    }
}


function applyCutStyles(selection) {
    clearCutStyles(); 
    
    if (selection.cells.length > 0) {
        selection.cells.forEach(cellKey => {
            const [row, col] = cellKey.split('-').map(Number);
            const cell = getCellElement(row, col);
            if (cell) {
                // Función segura para evitar errores en modo compartido
                const td = safeClosest(cell, 'td');
                if (td) {
                    td.classList.add('cut-cell');
                }
            }
        });
    }
    
    if (selection.rows.length > 0) {
        selection.rows.forEach(rowIndex => {
            const row = document.querySelector(`#worksheetTable tr[data-row-index="${rowIndex}"]`);
            if (row) {
                row.classList.add('cut-row');
            }
        });
    }
    
    if (selection.columns.length > 0) {
        selection.columns.forEach(colIndex => {
            const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
            const header = document.querySelector(`#worksheetTable th[data-col-index="${colIndex}"]`);
            
            cells.forEach(cell => cell.classList.add('cut-column'));
            if (header) header.classList.add('cut-column');
        });
    }
}


function clearCutStyles() {
    document.querySelectorAll('.cut-cell, .cut-row, .cut-column').forEach(el => {
        el.classList.remove('cut-cell', 'cut-row', 'cut-column');
    });
}

// Mostrar indicador de portapapeles
function showClipboardIndicator(message) {
    // Crear indicador
    let indicator = document.getElementById('clipboard-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'clipboard-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.textContent = message;
    indicator.style.opacity = '1';
    
    setTimeout(() => {
        indicator.style.opacity = '0';
    }, 2000);
}

// Funciones de navegación

// Navegar con flechas
function navigateWithArrows(key, isCtrl, isShift) {
    const currentCell = getCurrentCell();
    if (!currentCell) return;
    
    let newRow = currentCell.row;
    let newCol = currentCell.col;
    
    switch (key) {
        case 'ArrowUp':
            newRow = Math.max(0, newRow - 1);
            break;
        case 'ArrowDown':
            newRow = newRow + 1;
            break;
        case 'ArrowLeft':
            newCol = Math.max(0, newCol - 1);
            break;
        case 'ArrowRight':
            newCol = newCol + 1;
            break;
    }
    
    // Buscar celda con datos
    if (isCtrl) {
        const jumpCell = findNextDataCell(currentCell, key);
        if (jumpCell) {
            newRow = jumpCell.row;
            newCol = jumpCell.col;
        }
    }
    
    // Navegar a la nueva celda
    navigateToCell(newRow, newCol, isShift);
}

// Navegar con Tab
function navigateWithTab(isShift) {
    const currentCell = getCurrentCell();
    if (!currentCell) return;
    
    let newRow = currentCell.row;
    let newCol = currentCell.col;
    
    if (isShift) {
        // Tab hacia atrás
        newCol = newCol - 1;
        if (newCol < 0) {
            newCol = getMaxColumnIndex();
            newRow = Math.max(0, newRow - 1);
        }
    } else {
        // Tab hacia adelante
        newCol = newCol + 1;
        if (newCol > getMaxColumnIndex()) {
            newCol = 0;
            newRow = newRow + 1;
        }
    }
    
    navigateToCell(newRow, newCol, false);
}

// Navegar con Enter
function navigateWithEnter(isShift) {
    const currentCell = getCurrentCell();
    if (!currentCell) return;
    
    let newRow = currentCell.row;
    let newCol = currentCell.col;
    
    if (isShift) {
        newRow = Math.max(0, newRow - 1);
    } else {
        newRow = newRow + 1;
    }
    
    navigateToCell(newRow, newCol, false);
}

// Navegar con Page Up/Down
function navigateWithPageKeys(key, isShift) {
    const currentCell = getCurrentCell();
    if (!currentCell) return;
    
    let newRow = currentCell.row;
    const pageSize = 10; // Número de filas por página
    
    if (key === 'PageUp') {
        newRow = Math.max(0, newRow - pageSize);
    } else {
        newRow = newRow + pageSize;
    }
    
    navigateToCell(newRow, currentCell.col, isShift);
}

// Navegar con Home/End
function navigateWithHomeEnd(key, isCtrl, isShift) {
    const currentCell = getCurrentCell();
    if (!currentCell) return;
    
    let newRow = currentCell.row;
    let newCol = currentCell.col;
    
    if (isCtrl) {
        // Ctrl + Home/End - ir al principio/final de la tabla
        if (key === 'Home') {
            newRow = 0;
            newCol = 0;
        } else {
            newRow = getMaxRowIndex();
            newCol = getMaxColumnIndex();
        }
    } else {
        // Home/End - ir al principio/final de la fila
        if (key === 'Home') {
            newCol = 0;
        } else {
            newCol = getMaxColumnIndex();
        }
    }
    
    navigateToCell(newRow, newCol, isShift);
}

// Obtener celda actual
function getCurrentCell() {
    if (selectedCells.size > 0) {
        const cellKey = Array.from(selectedCells)[0];
        const [row, col] = cellKey.split('-').map(Number);
        return { row, col };
    }
    
    if (lastSelectedCell) {
        return lastSelectedCell;
    }
    
    // Buscar en el DOM
    const activeInput = document.querySelector('#worksheetTableContainer input:focus');
    if (activeInput && activeInput.id.startsWith('cell-')) {
        const match = activeInput.id.match(/cell-(\d+)-(\d+)/);
        if (match) {
            const row = parseInt(match[1]);
            const col = parseInt(match[2]);
            return { row, col };
        }
    }
    
    return { row: 0, col: 0 };
}

// Navegar a una celda específica con verificaciones mejoradas
function navigateToCell(row, col, extendSelection = false) {
    const targetCell = getCellElement(row, col);
    if (!targetCell) {
        // Celda no existe, no hacer nada
        return;
    }
    
    // Guardar celda activa para persistencia en navegación con teclado
    saveActiveCellPosition(row, col);
    
    if (extendSelection) {
        // Extender selección
        if (selectionStartCell) {
            clearAllSelections();
            selectRange(selectionStartCell.row, selectionStartCell.col, row, col);
        }
    } else {
        // Selección simple
        clearAllSelections();
        addCellToSelection(row, col);
        lastSelectedCell = { row, col };
        selectionStartCell = { row, col };
    }
    
    // Hacer scroll a la celda
    try {
    targetCell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        // Error de scroll, continuar
    }
    
    // Enfocar la celda
    if (targetCell) {
        // Verificar si es campo de información adicional
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla && plantilla.campos[col] === 'informacion-adicional') {
            // Para información adicional, solo actualizar la selección visual
        } else {
            // Para campos normales, enfocar el elemento
            targetCell.focus();
        }
    }
}

// Encontrar siguiente celda con datos
function findNextDataCell(currentCell, direction) {
    // Implementación básica - puede mejorarse
    const maxRow = getMaxRowIndex();
    const maxCol = getMaxColumnIndex();
    
    let row = currentCell.row;
    let col = currentCell.col;
    
    switch (direction) {
        case 'ArrowUp':
            for (let r = row - 1; r >= 0; r--) {
                const cell = getCellElement(r, col);
                if (cell && cell.value.trim()) {
                    return { row: r, col: col };
                }
            }
            return { row: 0, col: col };
            
        case 'ArrowDown':
            for (let r = row + 1; r <= maxRow; r++) {
                const cell = getCellElement(r, col);
                if (cell && cell.value.trim()) {
                    return { row: r, col: col };
                }
            }
            return { row: maxRow, col: col };
            
        case 'ArrowLeft':
            for (let c = col - 1; c >= 0; c--) {
                const cell = getCellElement(row, c);
                if (cell && cell.value.trim()) {
                    return { row: row, col: c };
                }
            }
            return { row: row, col: 0 };
            
        case 'ArrowRight':
            for (let c = col + 1; c <= maxCol; c++) {
                const cell = getCellElement(row, c);
                if (cell && cell.value.trim()) {
                    return { row: row, col: c };
                }
            }
            return { row: row, col: maxCol };
    }
    
    return null;
}

// Obtener índices máximos
function getMaxRowIndex() {
    const rows = document.querySelectorAll('#worksheetTable tr[data-row-index]');
    if (rows.length === 0) return 0;
    return Math.max(...Array.from(rows).map(r => parseInt(r.dataset.rowIndex)));
}

function getMaxColumnIndex() {
    const cells = document.querySelectorAll('#worksheetTable td[data-col-index]');
    if (cells.length === 0) return 0;
    return Math.max(...Array.from(cells).map(c => parseInt(c.dataset.colIndex)));
}

// Funciones adicionales

// Seleccionar todo
function selectAll() {
    clearAllSelections();
    
    const maxRow = getMaxRowIndex();
    const maxCol = getMaxColumnIndex();
    
    for (let row = 0; row <= maxRow; row++) {
        for (let col = 0; col <= maxCol; col++) {
            addCellToSelection(row, col);
        }
    }
    
    // Actualizar selección visual
    updateSelectionVisual();
}

// Eliminar selección
function deleteSelection() {
    const selection = getSelectionInfo();
    if (!selection.hasSelection) return;
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // Cancelar cualquier corte pendiente
    if (clipboardMode === 'cut') {
        clearCutStyles();
        clipboardMode = 'copy'; // Cancelar
        showClipboardIndicator('Corte cancelado');
    }
    
    // Crear punto de restauración
    pushTablaUndo();
    
    // Limpiar datos para consistencia
    let celdasEliminadas = 0;
    
    // Contar celdas a eliminar (evita contar duplicados)
    // Usar Set para evitar contar duplicados
    const cellsToDelete = new Set();
    
    // Celdas individuales
    selection.cells.forEach(cellKey => {
        cellsToDelete.add(cellKey);
    });
    
    // Procesar filas
    selection.rows.forEach(rowIndex => {
        if (tablaDatos[rowIndex]) {
            for (let col = 0; col < plantilla.campos.length; col++) {
                cellsToDelete.add(`${rowIndex}-${col}`);
            }
        }
    });
    
    // Columnas seleccionadas
    selection.columns.forEach(colIndex => {
        for (let row = 0; row < tablaDatos.length; row++) {
            if (tablaDatos[row]) {
                cellsToDelete.add(`${row}-${colIndex}`);
            }
        }
    });
    
    celdasEliminadas = cellsToDelete.size;
    
    if (celdasEliminadas === 0) {
        showClipboardIndicator('No hay selección para eliminar');
        return;
    }
    
    // Limpiar datos para hacer la eliminación real
    clearSelectionData(selection);
    
    // No necesitamos guardar aquí porque clearSelectionData ya lo hace
    showClipboardIndicator(`✅ ${celdasEliminadas} celdas eliminadas`);
}

// Editar celda seleccionada
function editSelectedCell() {
    const currentCell = getCurrentCell();
    if (!currentCell) return;
    
    const cellInput = getCellElement(currentCell.row, currentCell.col);
    if (cellInput) {
        cellInput.focus();
        cellInput.select();
    }
}

// DOMContentLoaded #1 (con protección contra duplicación)
let firstDOMContentLoadedExecuted = false;
document.addEventListener('DOMContentLoaded', function() {
    if (firstDOMContentLoadedExecuted) {
        // Ya se ejecutó, evitar duplicación
        return;
    }
    firstDOMContentLoadedExecuted = true;
    
    // Configurar eventos de teclado
    setupKeyboardEvents();
    
    // Esperar a que cargue completamente
    setTimeout(() => {
        restoreActiveCellFocus();
    }, 500); // Optimizado para hojas de cálculo - reducido de 1000ms a 500ms

// Elementos del DOM
const modalCrearPlantilla = document.getElementById('modalCrearPlantilla');
const btnCrearPlantilla = document.getElementById('btnCrearPlantilla');
const closeModalCrearPlantilla = document.getElementById('closeModalCrearPlantilla');
const btnCancelarPlantilla = document.getElementById('btnCancelarPlantilla');
const btnGenerarPlantilla = document.getElementById('btnGenerarPlantilla');
const selectedFieldsList = document.getElementById('selectedFieldsList');
const fieldButtons = document.querySelectorAll('.worksheet-field-btn');

    // Plantillas rápidas
const btnHojasCreadas = document.getElementById('btnHojasCreadas');
const modalHojasCreadas = document.getElementById('modalHojasCreadas');
const closeModalHojasCreadas = document.getElementById('closeModalHojasCreadas');
const btnCancelarPlantillaRapida = document.getElementById('btnCancelarPlantillaRapida');
const btnCrearPlantillaRapida = document.getElementById('btnCrearPlantillaRapida');
const tituloPlantillaRapidaInput = document.getElementById('tituloPlantillaRapidaInput');
const comboPlantillaRapida = document.getElementById('comboPlantillaRapida');
    
    // Funcionalidad del menú móvil
    var menuBtn = document.getElementById('menu1ToggleBtn');
    var mobileMenu = document.getElementById('mobileMenu');
    var menuOverlay = document.getElementById('menuOverlay');

    if(menuBtn && mobileMenu) {
        menuBtn.addEventListener('click', function() {
            mobileMenu.classList.toggle('hidden');
            if(menuOverlay) menuOverlay.classList.toggle('active');
        });
    }

    if(menuOverlay && mobileMenu) {
        menuOverlay.addEventListener('click', function() {
            mobileMenu.classList.add('hidden');
            menuOverlay.classList.remove('active');
        });
    }

    // Cerrar al hacer clic fuera
    document.addEventListener('mousedown', function(e) {
        if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
            if (!mobileMenu.contains(e.target) && e.target !== menuBtn) {
                mobileMenu.classList.add('hidden');
                if(menuOverlay) menuOverlay.classList.remove('active');
            }
        }
    });

    // Funcionalidad del modal de plantillas (solo si los elementos existen)
    
    if (btnCrearPlantilla) {
        btnCrearPlantilla.addEventListener('click', openModal);
    }
    
    // Cerrar modal
    if (closeModalCrearPlantilla) {
        closeModalCrearPlantilla.addEventListener('click', closeModal);
    }
    if (btnCancelarPlantilla) {
        btnCancelarPlantilla.addEventListener('click', closeModal);
    }
    
    // Cerrar al hacer clic fuera del modal
    if (modalCrearPlantilla) {
        modalCrearPlantilla.addEventListener('click', function(e) {
            if (e.target === modalCrearPlantilla) {
                closeModal();
            }
        });
    }
    
    // Manejar selección de campos
    if (fieldButtons && fieldButtons.length > 0) {
        fieldButtons.forEach(button => {
            button.addEventListener('click', toggleFieldSelection);
        });
    }
    
    // Generar plantilla
    if (btnGenerarPlantilla) {
        btnGenerarPlantilla.addEventListener('click', generateTemplate);
    }

    // Plantillas rápidas (solo si los elementos existen)
    if(btnHojasCreadas && modalHojasCreadas) {
        btnHojasCreadas.addEventListener('click', function() {
            modalHojasCreadas.classList.remove('d-none');
        });
        if (closeModalHojasCreadas) {
            closeModalHojasCreadas.addEventListener('click', function() {
                modalHojasCreadas.classList.add('d-none');
            });
        }
        if (btnCancelarPlantillaRapida) {
            btnCancelarPlantillaRapida.addEventListener('click', function() {
                modalHojasCreadas.classList.add('d-none');
            });
        }
        if (btnCrearPlantillaRapida) {
            btnCrearPlantillaRapida.addEventListener('click', function() {
                const titulo = tituloPlantillaRapidaInput.value.trim();
                const combo = comboPlantillaRapida.value;
                if (!titulo) {
                    showClipboardIndicator('⚠️ Ingresa un título para la plantilla');
                    if (tituloPlantillaRapidaInput) tituloPlantillaRapidaInput.focus();
                    return;
                }
                const fields = combo.split(':');
                createWorksheetTemplate(titulo, fields,
                    (data) => {
                    renderPlantillasMenu();
                    modalHojasCreadas.classList.add('d-none');
                    tituloPlantillaRapidaInput.value = '';
                    },
                    (error) => {
                        showClipboardIndicator('❌ Error al crear plantilla');
                    }
                );
            });
        }
        // Cerrar al hacer clic fuera del modal
        modalHojasCreadas.addEventListener('click', function(e) {
            if (e.target === modalHojasCreadas) {
                modalHojasCreadas.classList.add('d-none');
            }
        });
    }

    // Finalmente, obtener plantillas del backend
    loadWorksheetTemplates((plantillas) => {
            renderPlantillasMenu();
            
            // Cargar plantillas para búsqueda global
            cargarDatosDeTodasLasPlantillas();
            
            // Restaurar foco después de que las plantillas se hayan cargado
            setTimeout(() => {
                restoreActiveCellFocus();
            }, 200);
        });
});

// Cargar plantillas para búsqueda global
function cargarDatosDeTodasLasPlantillas() {
    plantillas.forEach((plantilla, index) => {
        if (plantilla.datos === undefined) {
            fetch(`/api/store/worksheet_data/${plantilla.id}`)
                .then(res => res.json())
                .then(data => {
                    plantilla.datos = (data && data.data && data.data.length) ? data.data : [Array(plantilla.campos.length).fill('')];
                    // Cargar formato para búsqueda global
                    plantilla.formato = data.formato || {};
                })
                .catch(error => {
                    // Error al cargar datos
                    plantilla.datos = [Array(plantilla.campos.length).fill('')];
                });
        }
    });
}
function renderPlantillasMenu() {
    const plantillasMenuList = document.getElementById('plantillasMenuList');
    if (!plantillasMenuList) return;
    plantillasMenuList.innerHTML = '';

    // Obtener query de búsqueda
    const menuSearchInput = document.getElementById('menuSearchInput');
    let query = (menuSearchInput && menuSearchInput.value) ? menuSearchInput.value.trim().toLowerCase() : '';
    searchQuery = query;

    // Calcular el contador de plantillas y el estado vacío
    let filteredPlantillas = plantillas;
    if (query) {
        filteredPlantillas = plantillas.filter(p => p.titulo.toLowerCase().includes(query));
    }

    // Verificar permisos de administrador
    const adminUser = document.querySelector('meta[name="admin_user"]')?.getAttribute('content') || 'admin';
    const currentUser = document.querySelector('meta[name="current_user"]')?.getAttribute('content') || 'admin';
    const isAdmin = currentUser && adminUser && currentUser === adminUser;
    
    // Funciones de drag and drop
    let dragSrcIdx = null;
    function handleDragStart(e) {
        dragSrcIdx = Number(e.target.getAttribute('data-idx'));
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragSrcIdx);
        e.target.classList.add('dragging');
    }
    function handleDragOver(e) {
        if (isAdmin) e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }
    function handleDrop(e) {
        e.preventDefault();
        const fromIdx = dragSrcIdx;
        
        // Función segura para evitar errores en modo compartido
        const plantillaItem = safeEventTargetClosest(e, '.plantilla-menu-item');
        if (!plantillaItem) {
            // No se encontró el elemento, cancelar
            return;
        }
        
        const toIdx = Number(plantillaItem.getAttribute('data-idx'));
        if (fromIdx === toIdx) return;
        // Reordenar en array local
        const moved = filteredPlantillas.splice(fromIdx, 1)[0];
        filteredPlantillas.splice(toIdx, 0, moved);
        // Guardar en backend
        const ids = filteredPlantillas.map(p => p.id);
        fetch('/api/store/worksheet_templates/order', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify({ ids })
        }).then(res => {
            if (res.ok) {
                // Recargar plantillas
                loadWorksheetTemplates(() => {
                        renderPlantillasMenu();
                    });
            } else {
                showClipboardIndicator('❌ Error guardando el orden');
            }
        });
    }
    function handleDragEnd(e) {
        e.target.classList.remove('dragging');
    }
    filteredPlantillas.forEach((plantilla, idx) => {
        const btn = document.createElement('button');
        btn.className = 'plantilla-menu-item w-100 position-relative';
        btn.type = 'button';
        btn.setAttribute('data-plantilla-id', plantilla.id);
        btn.setAttribute('data-idx', idx);
        if (selectedTemplateId && plantilla.id == selectedTemplateId) {
            btn.classList.add('active');
        }
        // Contenido del botón con icono
        const btnContent = document.createElement('span');
        btnContent.innerHTML = `<i class="fas fa-file-alt me-2"></i>${plantilla.titulo}`;
        btn.appendChild(btnContent);
        // Controles dentro del botón si es admin
        if (isAdmin) {
            // Contenedor para los iconos de acción
            const iconContainer = document.createElement('span');
            iconContainer.className = 'plantilla-icon-container';
            iconContainer.style.position = 'absolute';
            iconContainer.style.right = '12px';
            iconContainer.style.top = '50%';
            iconContainer.style.transform = 'translateY(-50%';
            iconContainer.style.display = 'flex';
            iconContainer.style.alignItems = 'center';
            iconContainer.style.gap = '48px';

            // Botón de eliminar (X)
            const xBtn = document.createElement('span');
            xBtn.className = 'btn-x-eliminar-plantilla';
            xBtn.innerHTML = '&times;';
            xBtn.title = 'Eliminar plantilla';
            xBtn.removeAttribute('style');
            xBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (!confirm('¿Seguro que deseas eliminar esta plantilla?')) return;
                if (!confirm('Esta acción es irreversible. ¿Eliminar definitivamente?')) return;
                // Eliminar en backend
                fetch(`/api/store/worksheet_templates/${plantilla.id}`, {
                    method: 'DELETE',
                    headers: { 'X-CSRFToken': getCSRFToken() }
                })
                .then(res => {
                    if (res.ok) {
                        if (selectedTemplateId === plantilla.id) {
                            const next = filteredPlantillas[idx+1] || filteredPlantillas[idx-1] || null;
                            selectedTemplateId = next ? next.id : null;
                            if (selectedTemplateId) {
                                localStorage.setItem('selectedWorksheetTemplateId', selectedTemplateId);
                            } else {
                                localStorage.removeItem('selectedWorksheetTemplateId');
                            }
                        }
                        renderPlantillasMenu();
                    } else {
                        showClipboardIndicator('❌ Error al eliminar plantilla');
                    }
                });
            });
            // Botón de editar (lápiz) solo para admin
            const editBtn = document.createElement('span');
            editBtn.className = 'btn-edit-plantilla';
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Renombrar plantilla';
            editBtn.removeAttribute('style');
            editBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                // Cerrar input de edición abierto antes de abrir uno nuevo
                document.querySelectorAll('.rename-input').forEach(inp => {
                    const parent = inp.parentElement;
                    if (parent) {
                        renderPlantillasMenu();
                    }
                });
                if (btn.querySelector('.rename-input')) return;
                btnContent.innerHTML = '';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = plantilla.titulo;
                input.className = 'rename-input form-control';
                input.id = `rename-input-${plantilla.id}`;
                input.name = `rename-input-${plantilla.id}`;
                input.style.width = '120px';
                input.style.marginLeft = '8px';
                input.addEventListener('click', function(ev) { ev.stopPropagation(); });
                
                // Función para guardar el título
                function saveTitle() {
                    const nuevoTitulo = input.value.trim();
                    if (!nuevoTitulo) {
                        renderPlantillasMenu();
                        return;
                    }
                    fetch(`/api/store/worksheet_templates/${plantilla.id}/rename`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                        body: JSON.stringify({ title: nuevoTitulo })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            plantilla.titulo = nuevoTitulo;
                            renderPlantillasMenu();
                        } else {
                            showClipboardIndicator('❌ Error al renombrar plantilla');
                        }
                    });
                }
                
                input.addEventListener('keydown', function(ev) {
                    if (ev.key === 'Enter') {
                        saveTitle();
                    } else if (ev.key === 'Escape') {
                        renderPlantillasMenu();
                    }
                });
                
                // Evento blur para guardar cuando se hace clic fuera
                input.addEventListener('blur', function(ev) {
                    setTimeout(() => {
                        saveTitle();
                    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
                });
                btnContent.appendChild(input);
                if (input) input.focus();
            });
            iconContainer.innerHTML = '';
            iconContainer.appendChild(xBtn);
            iconContainer.appendChild(editBtn);
            btn.appendChild(iconContainer);
        }
        if (isAdmin) {
            btn.setAttribute('draggable', 'true');
            btn.style.cursor = 'move';
            btn.addEventListener('dragstart', handleDragStart);
            btn.addEventListener('dragover', handleDragOver);
            btn.addEventListener('drop', handleDrop);
            btn.addEventListener('dragend', handleDragEnd);
        }
        btn.addEventListener('click', function(e) {
            if (!e.target.classList.contains('btn-x-eliminar-plantilla')) {
                document.querySelectorAll('.plantilla-menu-item').forEach(item => {
                    item.classList.remove('active');
                });
                btn.classList.add('active');
                selectedTemplateId = plantilla.id;
                localStorage.setItem('selectedWorksheetTemplateId', selectedTemplateId);
                mostrarTablaPlantilla(plantillas.findIndex(p => p.id === plantilla.id));
            }
        });
        plantillasMenuList.appendChild(btn);
    });
    // Si hay una plantilla seleccionada y no se ha mostrado, mostrarla
    if (selectedTemplateId && filteredPlantillas.some(p => p.id == selectedTemplateId)) {
        const idxSel = plantillas.findIndex(p => p.id == selectedTemplateId);
        if (idxSel !== -1) mostrarTablaPlantilla(idxSel, false); // Inicial, no limpiar posición
    }
}

// Buscar en el menú
const menuSearchInput = document.getElementById('menuSearchInput');
if (menuSearchInput) {
    menuSearchInput.addEventListener('input', function() {
        renderPlantillasMenu();
    });
}

// Funciones
function openModal() {
    modalCrearPlantilla.classList.remove('d-none');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    modalCrearPlantilla.classList.add('d-none');
    document.body.style.overflow = 'auto';
    // Limpiar
    selectedFields = [];
    updateSelectedFieldsDisplay();
    btnGenerarPlantilla.disabled = true;
}

function toggleFieldSelection(e) {
    const button = e.currentTarget;
    const field = button.getAttribute('data-field');
    // Agregar nueva instancia del campo seleccionado
    selectedFields.push(field);
    updateSelectedFieldsDisplay();
    btnGenerarPlantilla.disabled = selectedFields.length === 0;
}

function updateSelectedFieldsDisplay() {
    const tituloInput = document.getElementById('tituloPlantillaInput');
    const titulo = tituloInput ? tituloInput.value.trim() : '';
    if (selectedFields.length === 0) {
        selectedFieldsList.innerHTML = '<p class="text-muted">Ningún campo seleccionado</p>';
    } else {
        const fieldNames = optimizedFunctions.getStandardFieldNames();
        const tags = selectedFields.map((field, idx) => {
            return `<span class="selected-field-tag">${fieldNames[field]}
                <button type="button" class="remove-field-btn" data-idx="${idx}" title="Quitar">&times;</button>
            </span>`;
        }).join('');
        selectedFieldsList.innerHTML = tags;
        // Agregar listeners a los botones de quitar
        const removeBtns = selectedFieldsList.querySelectorAll('.remove-field-btn');
        removeBtns.forEach(btn => {
            btn.addEventListener('click', function(ev) {
                const idx = parseInt(btn.getAttribute('data-idx'));
                selectedFields.splice(idx, 1);
                updateSelectedFieldsDisplay();
            });
        });
    }
    // Deshabilitar si no hay al menos 2 campos o el título está vacío
    btnGenerarPlantilla.disabled = selectedFields.length < 2 || !titulo;
}

// Agregar listener si el elemento existe
const tituloPlantillaInput = document.getElementById('tituloPlantillaInput');
if (tituloPlantillaInput) {
    tituloPlantillaInput.addEventListener('input', function() {
        updateSelectedFieldsDisplay();
    });
}

function getCSRFToken() {
    return document.querySelector('meta[name="csrf_token"]')?.getAttribute('content') || '';
}

// GenerateTemplate para guardar en backend
function generateTemplate() {
    const tituloInput = document.getElementById('tituloPlantillaInput');
    const titulo = tituloInput.value.trim();
    if (!titulo) {
        showClipboardIndicator('⚠️ Ingresa un título para la plantilla');
                    if (tituloInput) tituloInput.focus();
        return;
    }
    if (selectedFields.length < 2) {
        showClipboardIndicator('⚠️ Selecciona al menos 2 campos');
        return;
    }
    // Guardar en backend
    fetch('/api/store/worksheet_templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
        body: JSON.stringify({ title: titulo, fields: selectedFields })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            showClipboardIndicator('❌ Error al crear plantilla');
            return;
        }
        // Re-renderizar
        plantillas.unshift({ id: data.id, titulo: data.title, campos: data.fields, datos: undefined });
        renderPlantillasMenu();
        showClipboardIndicator(`✅ Plantilla "${titulo}" creada`);
        closeModal();
    })
    .catch(error => {
        console.error('Error al crear plantilla:', error);
        showClipboardIndicator('❌ Error de conexión al crear plantilla');
    });
}

// Función para crear plantilla rápida (similar a generateTemplate pero con parámetros)
function createWorksheetTemplate(titulo, fields, successCallback, errorCallback) {
    if (!titulo || !titulo.trim()) {
        if (errorCallback) errorCallback('Título vacío');
        return;
    }
    if (!fields || fields.length < 2) {
        if (errorCallback) errorCallback('Faltan campos');
        return;
    }
    
    // Guardar en backend
    fetch('/api/store/worksheet_templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
        body: JSON.stringify({ title: titulo.trim(), fields: fields })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            if (errorCallback) errorCallback(data.error);
            return;
        }
        // Re-renderizar
        plantillas.unshift({ id: data.id, titulo: data.title, campos: data.fields, datos: undefined });
        showClipboardIndicator(`✅ Plantilla "${titulo}" creada`);
        if (successCallback) successCallback(data);
    })
    .catch(error => {
        // Error manejado silenciosamente
        if (errorCallback) errorCallback(error);
    });
}

// Mostrar plantilla para cargar datos del backend y autoguardar
function mostrarTablaPlantilla(idx, isManualChange = true) {
    const plantilla = plantillas[idx];
    if (!plantilla) return;
    const container = document.getElementById('worksheetTableContainer');
    if (!container) return;
    
    // Limpiar celda activa si es un cambio manual de plantilla (no en carga inicial)
    if (isManualChange) {
        clearSavedActiveCellPosition();
    }
    // Nombres bonitos para los campos
    const fieldNames = optimizedFunctions.getStandardFieldNames();
    // Si no hay datos, cargar del backend
    if (plantilla.datos === undefined) {
        // Determinar URL según el modo
        const isSharedMode = window.isSharedMode || false;
        let dataUrl;
        if (isSharedMode) {
            // Con token (con prefijo /tienda)
            dataUrl = `/tienda/api/shared/worksheet/${plantilla.id}/data?token=${window.sharedToken || ''}&access=${window.accessType || 'readonly'}`;
        } else {
            // Normal: usar ruta normal
            dataUrl = `/api/store/worksheet_data/${plantilla.id}`;
        }
        
        fetch(dataUrl)
            .then(res => res.json())
            .then(data => {
                plantilla.datos = (data && data.data && data.data.length) ? data.data : [Array(plantilla.campos.length).fill('')];
                
                // Cargar formato desde el servidor
                plantilla.formato = data.formato || {};
                
                // Inicializar datos originales si NO existen (primera carga)
                if (!plantilla.datosOriginales) {
                    plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));
        
                } else {
                    // Ya existen datos originales, no hacer nada
                }
                
                tablaDatos = plantilla.datos;
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            })
            .catch(error => {
                // En caso de error, solo crear datos vacíos si no existen datos originales
                if (!plantilla.datosOriginales) {
                    plantilla.datos = [Array(plantilla.campos.length).fill('')];
                    plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));

                } else {
                    // Restaurar datos originales
                    plantilla.datos = JSON.parse(JSON.stringify(plantilla.datosOriginales));
                }
                tablaDatos = plantilla.datos;
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            });
    } else {
        // Asegurar integridad de datos originales
        if (!plantilla.datosOriginales) {
            // Crear copia de datos originales
            plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));

        }
        
        tablaDatos = plantilla.datos;
        optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
    }
}

function renderEditableCell(campo, valor, filaIdx, colIdx) {
    // Renderizar celda editable según el modo
    if (worksheetMode === 'copiar') {
        if (campo === 'numero') {
            return generateCellInput(campo, valor, filaIdx, colIdx, 'title="Número del 1 al 6 u 8"');
        }
        if (campo === 'informacion-adicional') {
            // En modo copiar, usar icono compacto con modal (igual que standard y filtro)
            if (valor && valor.trim() !== '') {
                return `<div class='cell-info-adicional' tabindex="0" onclick="showInfoModal(${filaIdx}, ${colIdx}, '${valor || ''}')" title="Editar información adicional">
                    <i class="fas fa-info-circle"></i>
                </div>`;
            } else {
                return `<div class='cell-info-adicional' tabindex="0" onclick="showInfoModal(${filaIdx}, ${colIdx}, '')" title="Agregar información adicional">
                    <i class="fas fa-plus"></i>
                </div>`;
            }
        }
        if (!valor) {
            // Si no hay valor, mostrar input editable según el tipo de campo
            const extraStyles = (campo === 'let' || campo === 'letras') ? 'style="width:48px;"' : '';
            return generateCellInput(campo, '', filaIdx, colIdx, extraStyles);
        }
        // Aplicar formato aplicado
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        let styleAttributes = '';
        
        // Aplicar formato guardado
        if (plantilla && plantilla.formato) {
            const cellId = `${filaIdx}-${colIdx}`;
            const storedFormat = plantilla.formato[cellId];
            if (storedFormat) {
                if (storedFormat.backgroundColor) {
                    styleAttributes += `background-color:${storedFormat.backgroundColor} !important;`;
                }
                if (storedFormat.color) {
                    styleAttributes += `color:${storedFormat.color} !important;`;
                }
                if (storedFormat.fontWeight === 'bold') {
                    styleAttributes += `font-weight:bold !important;`;
                }
                if (storedFormat.textDecoration === 'underline') {
                    styleAttributes += `text-decoration:underline !important;`;
                }
            }
        }
        
        return `<div class='cell-copy-flex cell-copyable' data-valor="${valor}" style='display:flex;align-items:center;gap:2px;justify-content:center;cursor:pointer;${styleAttributes}'>
            <span class='cell-copy-text' style='font-size:13px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;'>${valor}</span>
        </div>`;
    }
    if (campo === 'let' || campo === 'letras') {
        return generateCellInput(campo, valor, filaIdx, colIdx, 'style="width:48px;"');
    }
    if (campo === 'correo' || campo === 'contraseña' || campo === 'links') {
        const extraAttrs = campo === 'links' ? `title="${valor || ''}" style="width:85px;"` : '';
        const inputHtml = generateCellInput(campo, valor, filaIdx, colIdx, extraAttrs);
        
        // No mostrar icono de copiar en modo agregar, filtro ni copiar
        if (worksheetMode === 'agregar' || worksheetMode === 'filtro' || worksheetMode === 'copiar') {
            return inputHtml;
        }
        
        // En otros modos, mostrar icono de copiar
        let copyIcon = `<span class='copy-icon' id='copy-input-${filaIdx}-${colIdx}' data-valor="${valor || ''}" title="Copiar"><i class="fas fa-copy"></i></span>`;
        return `<div class='cell-copy-flex' style='display:flex;align-items:center;gap:2px;'>${inputHtml}${copyIcon}</div>`;
    }
    if (campo === 'numero') {
        return generateCellInput(campo, valor, filaIdx, colIdx, 'title="Número del 1 al 6 u 8"');
    }
    if (campo === 'informacion-adicional') {
        // SOLO en modo agregar, mostrar input normal y ancho
        if (worksheetMode === 'agregar') {
            return generateCellInput(campo, valor, filaIdx, colIdx, 'style="width:200px;"');
        }
        // En TODOS los otros modos (standard, filtro, copiar), mostrar icono de información
        if (valor && valor.trim() !== '') {
            return `<div class='cell-info-adicional' tabindex="0" onclick="showInfoModal(${filaIdx}, ${colIdx}, '${valor || ''}')" title="Editar información adicional">
                <i class="fas fa-info-circle"></i>
            </div>`;
        } else {
            // No hay valor, mostrar celda vacía pero clickeable para abrir modal
            return `<div class='cell-info-adicional' tabindex="0" onclick="showInfoModal(${filaIdx}, ${colIdx}, '')" title="Agregar información adicional">
                <i class="fas fa-plus"></i>
            </div>`;
        }
    }
    return generateCellInput(campo, valor, filaIdx, colIdx);
}

function renderCellFormat(input, campo, val) {
    // NO limpiar estilos de duplicados ni formato del usuario (función segura)
    const td = safeClosest(input, 'td');
    const isDuplicateCell = td && td.classList.contains('duplicate-cell');
    const hasUserFormat = td && (td.getAttribute('data-custom-bg') || td.getAttribute('data-custom-color') || 
                                 td.getAttribute('data-format-bold') || td.getAttribute('data-format-underline'));
    
    // Verificar si tiene formato guardado en la plantilla
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    let hasStoredFormat = false;
    if (plantilla && plantilla.formato) {
        const rowIndex = parseInt(td.getAttribute('data-row-index'));
        const colIndex = parseInt(td.getAttribute('data-col-index'));
        if (!isNaN(rowIndex) && !isNaN(colIndex)) {
            const cellId = `${rowIndex}-${colIndex}`;
            const storedFormat = plantilla.formato[cellId];
            hasStoredFormat = storedFormat && (storedFormat.backgroundColor || storedFormat.color || 
                                              storedFormat.fontWeight === 'bold' || storedFormat.textDecoration === 'underline');
        }
    }
    
    // No es duplicado Y no tiene formato del usuario Y no tiene formato guardado
    if (!isDuplicateCell && !hasUserFormat && !hasStoredFormat) {
        input.style.removeProperty('background');
        input.style.removeProperty('color');
        input.style.removeProperty('border');
    }
    
    
    if (campo === 'correo') {
        if (val && (!val.includes('@') || !val.includes('.'))) {
            input.style.border = '2px solid #e74c3c';
            input.style.background = '#fff6f6';
            input.setAttribute('style', (input.getAttribute('style') || '') + 'text-decoration:underline !important;text-decoration-color:#111 !important;');
        } else {
            // No tiene formato del usuario
            if (!hasUserFormat && !hasStoredFormat) {
                input.style.border = '';
                input.style.background = '';
                input.setAttribute('style', (input.getAttribute('style') || '').replace(/text-decoration:underline !important;?/g, '').replace(/text-decoration-color:#111 !important;?/g, ''));
            }
        }
    }
    
    // Links: acortar visualmente en input (pero mantener valor real)
    if (campo === 'links' && val && val.length > 18) {
        input.value = val.slice(0, 8) + '...' + val.slice(-7);
        input.title = val;
    }
    
    // Número: colorear celda según valor
    if (campo === 'numero') {
        // Mantener en el input
        if (val && String(val).trim() !== '') {
            input.value = val.toString();
        }
        
        // Si el valor está vacío, limpiar inmediatamente
        if (!val || String(val).trim() === '') {
            clearNumberColors(input);
            return; // No para evitar procesamiento innecesario
        }
        
        // Usar función centralizada para obtener colores
        const colors = getNumberColors(val);
        const color = colors ? colors.color : '';
        const borderColor = colors ? colors.borderColor : '';
        if (color) {
            // Mayor especificidad (función segura)
            const td = safeClosest(input, 'td');
            if (td) {
                td.style.setProperty('background-color', color, 'important');
                td.style.setProperty('color', '#fff', 'important');
                td.style.setProperty('border-color', borderColor, 'important');
            }
            input.style.setProperty('background-color', color, 'important');
            input.style.setProperty('color', '#fff', 'important');
            input.style.setProperty('border-color', borderColor, 'important');
            input.style.setProperty('font-weight', 'bold', 'important');
            input.style.setProperty('text-shadow', '0 1px 2px rgba(0,0,0,0.3)', 'important');
        } else {
            // NO limpiar estilos si es celda duplicada O tiene formato del usuario O tiene formato guardado
            const td = safeClosest(input, 'td');
            const isDuplicateCell = td && td.classList.contains('duplicate-cell');
            const hasUserFormat = td && (td.getAttribute('data-custom-bg') || td.getAttribute('data-custom-color') || 
                                         td.getAttribute('data-format-bold') || td.getAttribute('data-format-underline'));
            
            // Verificar formato guardado para campo número
            let hasStoredFormat = false;
            if (plantilla && plantilla.formato) {
                const rowIndex = parseInt(td.getAttribute('data-row-index'));
                const colIndex = parseInt(td.getAttribute('data-col-index'));
                if (!isNaN(rowIndex) && !isNaN(colIndex)) {
                    const cellId = `${rowIndex}-${colIndex}`;
                    const storedFormat = plantilla.formato[cellId];
                    hasStoredFormat = storedFormat && (storedFormat.backgroundColor || storedFormat.color || 
                                                      storedFormat.fontWeight === 'bold' || storedFormat.textDecoration === 'underline');
                }
            }
            
            if (!isDuplicateCell && !hasUserFormat && !hasStoredFormat) {
                // Función segura
                const td = safeClosest(input, 'td');
                if (td) {
                    td.style.setProperty('background-color', '#fff', 'important');
                    td.style.setProperty('color', '#111', 'important');
                    td.style.setProperty('border-color', '#d0d0d0', 'important');
                }
                input.style.setProperty('background-color', '#fff', 'important');
                input.style.setProperty('color', '#111', 'important');
                input.style.setProperty('border-color', '#d0d0d0', 'important');
            }
            input.style.setProperty('font-weight', 'normal', 'important');
            input.style.setProperty('text-shadow', 'none', 'important');
        }
    }
    
    // Restaurar formato guardado si existe
    if (plantilla && plantilla.formato && !hasUserFormat) {
        const rowIndex = parseInt(td.getAttribute('data-row-index'));
        const colIndex = parseInt(td.getAttribute('data-col-index'));
        if (!isNaN(rowIndex) && !isNaN(colIndex)) {
            const cellId = `${rowIndex}-${colIndex}`;
            const storedFormat = plantilla.formato[cellId];
            if (storedFormat) {
                // ndo
                if (storedFormat.backgroundColor) {
                    td.style.setProperty('background-color', storedFormat.backgroundColor, 'important');
                    input.style.setProperty('background-color', storedFormat.backgroundColor, 'important');
                    td.setAttribute('data-custom-bg', storedFormat.backgroundColor);
                    input.setAttribute('data-custom-bg', storedFormat.backgroundColor);
                }
                
                
                if (storedFormat.color) {
                    td.style.setProperty('color', storedFormat.color, 'important');
                    input.style.setProperty('color', storedFormat.color, 'important');
                    td.setAttribute('data-custom-color', storedFormat.color);
                    input.setAttribute('data-custom-color', storedFormat.color);
                }
                
                // negrita
                if (storedFormat.fontWeight === 'bold') {
                    td.style.setProperty('font-weight', 'bold', 'important');
                    input.style.setProperty('font-weight', 'bold', 'important');
                    td.setAttribute('data-format-bold', 'true');
                    input.setAttribute('data-format-bold', 'true');
                }
                
                
                if (storedFormat.textDecoration === 'underline') {
                    td.style.setProperty('text-decoration', 'underline', 'important');
                    input.style.setProperty('text-decoration', 'underline', 'important');
                    td.setAttribute('data-format-underline', 'true');
                    input.setAttribute('data-format-underline', 'true');
                }
            }
        }
    }
    
    // Asegurar que los formatos se mantengan consistentes
    setTimeout(() => {
        if (plantilla && plantilla.formato) {
            const rowIndex = parseInt(td.getAttribute('data-row-index'));
            const colIndex = parseInt(td.getAttribute('data-col-index'));
            if (!isNaN(rowIndex) && !isNaN(colIndex)) {
                const cellId = `${rowIndex}-${colIndex}`;
                const storedFormat = plantilla.formato[cellId];
                if (storedFormat) {
                    // Actualizar formato si es necesario
                    if (storedFormat.backgroundColor && !td.getAttribute('data-custom-bg')) {
                        td.style.setProperty('background-color', storedFormat.backgroundColor, 'important');
                        input.style.setProperty('background-color', storedFormat.backgroundColor, 'important');
                        td.setAttribute('data-custom-bg', storedFormat.backgroundColor);
                        input.setAttribute('data-custom-bg', storedFormat.backgroundColor);
                    }
                    
                    if (storedFormat.color && !td.getAttribute('data-custom-color')) {
                        td.style.setProperty('color', storedFormat.color, 'important');
                        input.style.setProperty('color', storedFormat.color, 'important');
                        td.setAttribute('data-custom-color', storedFormat.color);
                        input.setAttribute('data-custom-color', storedFormat.color);
                    }
                }
            }
        }
    }, 50);
}

// Función centralizada para obtener colores de números
function getNumberColors(numeroValue) {
    const colorMap = {
        '1': { color: '#4caf50', borderColor: '#45a049', textColor: '#fff' },
        '2': { color: '#e74c3c', borderColor: '#c0392b', textColor: '#fff' },
        '3': { color: '#2196f3', borderColor: '#1976d2', textColor: '#fff' },
        '4': { color: '#ff9800', borderColor: '#f57c00', textColor: '#111' },
        '5': { color: '#9c27b0', borderColor: '#7b1fa2', textColor: '#fff' },
        '6': { color: '#e91e63', borderColor: '#c2185b', textColor: '#fff' },
        '8': { color: '#000000', borderColor: '#333333', textColor: '#fff' }
    };
    return colorMap[numeroValue] || null;
}

// Función para aplicar coloreado correcto en tiempo real (izquierda hasta número)
function applyCorrectNumberColoring(rowIndex, colIndex, numeroValue, plantilla) {
    if (!plantilla || !plantilla.datos || !plantilla.campos) return;
    
    // Encontrar la fila en el DOM
    const row = document.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (!row) return;
    
    const fila = plantilla.datos[rowIndex];
    if (!fila) return;
    
    // Encontrar todos los índices de campos número en la fila
    const numIndices = [];
    plantilla.campos.forEach((campo, idx) => {
        if (campo === 'numero') {
            const valor = (fila[idx] || '').toString().trim();
            if (valor && getNumberColors(valor)) {
                numIndices.push(idx);
            }
        }
    });
    
    if (numIndices.length === 0) return;
    
    // Aplicar la misma lógica que updateBlockColorsInternal
    let bloqueColores = Array(fila.length).fill(null);
    
    numIndices.forEach((numIdx, bloqueIdx) => {
        let numVal = (fila[numIdx] || '').toString().trim();
        
        // Usar función centralizada para obtener colores
        const colors = getNumberColors(numVal);
        const color = colors ? colors.color : null;
        const borderColor = colors ? colors.borderColor : null;
        const textColor = colors ? colors.textColor : null;

        if (color) {
            // Desde inicio o último número hasta este número
            let start = (numIndices[bloqueIdx-1] !== undefined) ? numIndices[bloqueIdx-1]+1 : 0;
            for (let i = start; i <= numIdx; i++) {
                bloqueColores[i] = { color, textColor, borderColor };
            }
        }
    });
    
    // Aplicar colores a las celdas en el DOM
    bloqueColores.forEach((colorData, colIdx) => {
        const cellElement = row.children[colIdx + 1]; // Saltar columna de numeración
        if (cellElement && colorData) {
            cellElement.style.cssText += `background-color: ${colorData.color} !important; color: ${colorData.textColor} !important; border-color: ${colorData.borderColor} !important;`;
            
            // Aplicar también al input si existe
            const input = cellElement.querySelector('input');
            if (input) {
                input.style.cssText += `background-color: ${colorData.color} !important; color: ${colorData.textColor} !important;`;
            }
        }
    });
}

// Función para aplicar color a toda la fila en tiempo real
function applyRowColorInRealTime(rowIndex, colIndex, numeroValue, plantilla) {
    console.log('🔍 applyRowColorInRealTime llamada:', { rowIndex, colIndex, numeroValue, plantilla: !!plantilla });
    
    if (!plantilla) {
        console.log('❌ No hay plantilla');
        return;
    }
    
    // Encontrar la fila en el DOM - probar diferentes selectores
    let row = document.querySelector(`tr[data-row-index="${rowIndex}"]`);
    console.log('🔍 Fila encontrada con selector 1:', row);
    
    if (!row) {
        // Intentar con selector alternativo
        row = document.querySelector(`#worksheetTable tr[data-row-index="${rowIndex}"]`);
        console.log('🔍 Fila encontrada con selector 2:', row);
    }
    
    if (!row) {
        // Intentar buscar por índice de fila
        const allRows = document.querySelectorAll('#worksheetTable tr');
        console.log('🔍 Todas las filas encontradas:', allRows.length);
        if (allRows[rowIndex]) {
            row = allRows[rowIndex];
            console.log('🔍 Fila encontrada por índice:', row);
        }
    }
    
    if (!row) {
        console.log('❌ No se encontró la fila con ningún selector');
        return;
    }
    
    // Obtener todas las celdas de la fila
    const cells = row.querySelectorAll('td');
    console.log('🔍 Celdas encontradas:', cells.length, cells);
    if (!cells.length) {
        console.log('❌ No se encontraron celdas');
        return;
    }
    
    // Si no hay número o está vacío, limpiar colores
    if (!numeroValue || numeroValue.trim() === '') {
        cells.forEach(cell => {
            cell.style.cssText = cell.style.cssText.replace(/background-color:[^;]*!important;?/g, '');
            cell.style.cssText = cell.style.cssText.replace(/color:[^;]*!important;?/g, '');
            cell.style.cssText = cell.style.cssText.replace(/border-color:[^;]*!important;?/g, '');
            
            // Limpiar también el input si existe
            const input = cell.querySelector('input');
            if (input) {
                input.style.cssText = input.style.cssText.replace(/background-color:[^;]*!important;?/g, '');
                input.style.cssText = input.style.cssText.replace(/color:[^;]*!important;?/g, '');
            }
        });
        return;
    }
    
    // Obtener colores usando función centralizada
    const colors = getNumberColors(numeroValue);
    if (!colors) {
        // Si no es un número válido, limpiar colores
        cells.forEach(cell => {
            cell.style.cssText = cell.style.cssText.replace(/background-color:[^;]*!important;?/g, '');
            cell.style.cssText = cell.style.cssText.replace(/color:[^;]*!important;?/g, '');
            cell.style.cssText = cell.style.cssText.replace(/border-color:[^;]*!important;?/g, '');
            
            // Limpiar también el input si existe
            const input = cell.querySelector('input');
            if (input) {
                input.style.cssText = input.style.cssText.replace(/background-color:[^;]*!important;?/g, '');
                input.style.cssText = input.style.cssText.replace(/color:[^;]*!important;?/g, '');
            }
        });
        return;
    }
    
    const { color, borderColor, textColor } = colors;
    
    // Aplicar color a todas las celdas de la fila con máxima prioridad
    console.log('🔍 Aplicando colores a', cells.length, 'celdas:', { color, textColor, borderColor });
    cells.forEach((cell, index) => {
        cell.style.cssText += `background-color: ${color} !important; color: ${textColor} !important; border-color: ${borderColor} !important;`;
        console.log(`🔍 Celda ${index} coloreada:`, cell.style.cssText);
        
        // Aplicar también al input si existe
        const input = cell.querySelector('input');
        if (input) {
            input.style.cssText += `background-color: ${color} !important; color: ${textColor} !important;`;
            console.log(`🔍 Input ${index} coloreado:`, input.style.cssText);
        }
    });
}

function renderTablaEditable(plantilla, fieldNames, container, idx) {
    // Operaciones más rápidas
    if (!plantilla || !container) return;
    
    // Generar nombres de campos dinámicamente según el modo actual
    const dynamicFieldNames = optimizedFunctions.getStandardFieldNames();
    
    // Cargar los datos correctos de forma más eficiente
    if (!tablaDatos || tablaDatos.length === 0) {
        tablaDatos = plantilla.datos || [];
    }
    
    // Paginación con verificación rápida
    const { totalRows, totalPages, paginatedRows } = calculatePagination(tablaDatos);

    // No crear plantilla (si no existe ya en el DOM)
    let crearBtnHtml = '';
    if (!document.getElementById('btnCrearPlantilla')) {
        crearBtnHtml = `<div class="d-flex justify-content-center mb-2">
            <button id="btnCrearPlantilla" class="btn-panel btn-green">
                <i class="fas fa-plus"></i> Crear plantilla hojas de cálculo
            </button>
        </div>`;
    }

    // No limpiar (solo si no existe ya en el HTML principal)
    const existingSearchInput = document.getElementById('mainSearchInput');
    const searchHtml = existingSearchInput ? '' :
        `<div class="d-flex gap-05 mb-4" id="searchRowCustom" style="position: relative;">
            <input type="text" id="mainSearchInput" name="mainSearchInput" class="form-control" placeholder="Buscar...">
            <button type="button" class="search-clear-btn" id="clearMainSearch" style="display: none;"><i class="fas fa-times"></i></button>
        </div>`;

    // Elementos, centrados y más largos
    let selectorHtml = `<div class='d-flex justify-content-center align-items-center mb-4 gap-3' style='width:100%'>
        <select id="rowsPerPageSelect" class="form-select form-select-sm d-inline-block">
            <option disabled>Mostrar</option>
            ${rowsPerPageOptions.map(opt => `<option value="${opt}" ${rowsPerPage == opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
        <select id="modeSelect" class="form-select form-select-sm d-inline-block">
            <option disabled>Modo</option>
            <option value="standard" ${worksheetMode === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="copiar" ${worksheetMode === 'copiar' ? 'selected' : ''}>Copiar</option>
            ${(!window.isSharedMode) ? `<option value="agregar" ${worksheetMode === 'agregar' ? 'selected' : ''}>Agregar</option>` : ''}
            ${(!window.isSharedMode) ? `<option value="filtro" ${worksheetMode === 'filtro' ? 'selected' : ''}>Filtro</option>` : ''}
        </select>
    </div>`;

    // inicializar HTML
    let html = '';

    // Renderizar en el orden correcto: controles generales arriba, herramientas específicas abajo, título al final
    html += crearBtnHtml + searchHtml + selectorHtml;

    // Botón "Agregar campos", con nueva funcionalidad dividir texto
    if (worksheetMode === 'agregar') {
        html += `<div id="agregarTablasHeader" class="d-flex align-items-center gap-2 mb-2">
            <button id="btnAbrirAgregarTabla" class="btn-panel btn-blue" type="button">
                <i class="fas fa-plus"></i> Agregar filas
            </button>
            <button id="btnDividirTexto" class="btn-panel btn-blue" type="button">
                <i class="fas fa-columns"></i> Dividir texto
            </button>
        </div>`;
    }

    // En modo filtro, mostrar controles de filtro
    if (worksheetMode === 'filtro') {
        html += `<div id="filtroTablasHeader" class="d-flex align-items-center gap-2 mb-2">
            <button id="btnLimpiarFiltros" class="btn-panel btn-blue" type="button"><i class="fas fa-times"></i> Limpiar filtros</button>
            <button id="btnGuardarFiltros" class="btn-panel btn-blue" type="button"><i class="fas fa-save"></i> Guardar cambios</button>
        </div>`;
    }

    // Plantilla DESPUÉS de las herramientas (solo si existe título)
    if (plantilla.titulo && plantilla.titulo.trim()) {
        // Optimización aplicada
        const viewersAndLogsIcons = !window.isSharedMode ? 
            `<button id="connectionLogsBtn" class="connection-logs-btn" title="Registro de conexiones">
                <i class="fas fa-history"></i>
                <span id="logsCount">0</span>
            </button>` : '';
        
    html += `<div class="plantilla-titulo-container mb-3 text-center">
            <h4 class="plantilla-titulo-header">
                ${plantilla.titulo}
                ${viewersAndLogsIcons}
            </h4>
    </div>`;
    }

    html += `<div class='table-responsive'><table class='table table-bordered table-striped mb-0' id='worksheetTable'><thead><tr>`;
    // Columna de numeración
    html += `<th class='col-numeracion' data-row-header='true'>#</th>`;
    plantilla.campos.forEach((campo, colIdx) => {
        let thContent = dynamicFieldNames[campo] || campo;
        // NOTA: No cambiar automáticamente 'letras' por 'let'
        // Los nombres se manejan correctamente en optimizedFunctions.getStandardFieldNames()
        // En modo agregar, muestra el engranaje en todas las columnas
        if (worksheetMode === 'agregar') {
            thContent += ` <span class='th-gear-icon' id='th-gear-${colIdx}' title='Opciones'><i class='fas fa-cog'></i></span>`;
        }
        // En modo filtro, muestra el icono de filtro en todas las columnas
        if (worksheetMode === 'filtro') {
            thContent += ` <span class='th-filter-icon' id='th-filter-${colIdx}' title='Filtros'><i class='fas fa-filter'></i></span>`;
        }
        
        if (campo === 'numero') {
            html += `<th class="col-numero" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'let') {
            html += `<th class="col-let" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'letras') {
            html += `<th class="col-letras" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'contraseña') {
            html += `<th class="col-contraseña" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'links') {
            html += `<th class="col-links" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'informacion-adicional') {
            html += `<th class="col-info-adicional" data-col-index="${colIdx}">${thContent}</th>`;
        } else {
            html += `<th data-col-index="${colIdx}">${thContent}</th>`;
        }
    });
    html += `</tr></thead><tbody>`;
    
    // Contraseña y links
    const duplicadosCorreo = detectarDuplicados(plantilla, 'correo');
    const duplicadosContraseña = detectarDuplicados(plantilla, 'contraseña');
    const duplicadosLinks = detectarDuplicados(plantilla, 'links');
    
    paginatedRows.forEach((fila, filaIdx) => {
        // Índices de campos 'numero' en la fila
        let numIndices = [];
        plantilla.campos.forEach((c, i) => { if (c === 'numero') numIndices.push(i); });
        
        let bloqueColores = Array(fila.length).fill(null);
        numIndices.forEach((numIdx, bloqueIdx) => {
            let numVal = (fila[numIdx] || '').toString();
            // Usar función centralizada para obtener colores
            const colors = getNumberColors(numVal);
            const color = colors ? colors.color : null;
            const borderColor = colors ? colors.borderColor : null;
            const textColor = colors ? colors.textColor : null;
            // Inicio o desde el último número (o 0) hasta este número (incluido)
            let start = (numIndices[bloqueIdx-1] !== undefined) ? numIndices[bloqueIdx-1]+1 : 0;
            for (let i = start; i <= numIdx; i++) {
                if (color) bloqueColores[i] = { color, textColor, borderColor };
            }
        });
        const realRowIdx = (rowsPerPage === 'todos' ? filaIdx : (filaIdx + (currentPage-1)*rowsPerPage));
        html += `<tr data-row-index="${realRowIdx}">`;
        html += generateTableCells(fila, realRowIdx, plantilla, bloqueColores, duplicadosCorreo, duplicadosContraseña, duplicadosLinks);
        html += `</tr>`;
    });
    html += `</tbody></table></div>`;

    // Paginación debajo de la tabla
    html += `<div class="d-flex justify-content-between align-items-center mt-2 mb-2">
        <div>
            <button class="btn btn-sm btn-outline-secondary" id="btnPrevPage" ${currentPage <= 1 ? 'disabled' : ''}>Anterior</button>
            <span class="mx-2">Página ${currentPage} de ${totalPages}</span>
            <button class="btn btn-sm btn-outline-secondary" id="btnNextPage" ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
    </div>`;

    // CORREGIDO: Preservar elementos del lado derecho al actualizar el contenido
    const existingScrollbar = container.querySelector('.table-responsive');
    const existingRightPanel = container.querySelector('.right-panel');
    
    // Guardar elementos importantes antes de reemplazar
    const preservedElements = {
        scrollbar: existingScrollbar ? existingScrollbar.outerHTML : '',
        rightPanel: existingRightPanel ? existingRightPanel.outerHTML : ''
    };
    
    container.innerHTML = html;
    
    // Restaurar elementos importantes si no están presentes
    if (preservedElements.scrollbar && !container.querySelector('.table-responsive')) {
        container.innerHTML += preservedElements.scrollbar;
    }
    if (preservedElements.rightPanel && !container.querySelector('.right-panel')) {
        container.innerHTML += preservedElements.rightPanel;
    }
    // Asignar valor y listener al select de modo después de renderizar el HTML
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        modeSelect.value = worksheetMode || 'standard';
        modeSelect.onchange = function() {
            worksheetMode = modeSelect.value;
            localStorage.setItem('worksheetMode', worksheetMode);
            
            // Invalidar cache de nombres de campos cuando cambie el modo
            if (optimizedFunctions.invalidateAll) {
                optimizedFunctions.invalidateAll();
            }
            
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            
            // Aplicar formatos específicamente si se cambia a modo copiar
            if (worksheetMode === 'copiar') {
                setTimeout(() => {
                    const plantilla = optimizedFunctions.getCurrentPlantilla();
                    if (plantilla && plantilla.formato) {
                        applyFormatsToCopyMode(plantilla);
                    }
                }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms // Reducido de 600ms a 100ms para mayor rapidez
            }
        };
    }
    // Body según el modo
    document.body.classList.toggle('worksheet-mode-agregar', worksheetMode === 'agregar');
            document.body.classList.toggle('worksheet-mode-filtro', worksheetMode === 'filtro');
    document.body.classList.toggle('worksheet-mode-copiar', worksheetMode === 'copiar');
    // Listeners a los inputs usando funciones helper
    plantilla.campos.forEach((campo, colIdx) => {
        paginatedRows.forEach((fila, filaIdx) => {
            const realFilaIdx = (rowsPerPage === 'todos' ? filaIdx : (filaIdx + (currentPage-1)*rowsPerPage));
            const input = document.getElementById(`cell-${realFilaIdx}-${colIdx}`);
            attachCellEventListeners(input, realFilaIdx, colIdx, campo, plantilla, fieldNames, container, idx, false);
        });
    });
    
    // Event listeners con delegación para evitar duplicación
    setupInfoAdicionalDelegatedListeners();
    // Listeners de paginación
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    if (btnPrev) btnPrev.addEventListener('click', function() {
        if (currentPage > 1) {
            saveCurrentPage(currentPage - 1);
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
        }
    });
    if (btnNext) btnNext.addEventListener('click', function() {
        if (currentPage < totalPages) {
            saveCurrentPage(currentPage + 1);
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
        }
    });
    // ner para selector de filas
    const rowsSelect = document.getElementById('rowsPerPageSelect');
    if (rowsSelect) {
        rowsSelect.addEventListener('change', function() {
            const val = rowsSelect.value === 'todos' ? 'todos' : parseInt(rowsSelect.value);
            rowsPerPage = val;
            saveCurrentPage(1);
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
        });
    }
    // ner para búsqueda y limpiar
    const mainSearchInput = document.getElementById('mainSearchInput');
    const clearBtn = document.getElementById('clearMainSearch');
    if (mainSearchInput && clearBtn) {
        // Mostrar/ocultar la X según el contenido
        function toggleClearButton() {
            const hasContent = mainSearchInput.value.trim() !== '';
            clearBtn.style.display = hasContent ? 'block' : 'none';
        }
        
        // ntras escribes (con debounce)
        mainSearchInput.addEventListener('input', function() {
            const searchValue = mainSearchInput.value;
            toggleClearButton(); // Mostrar/ocultar X
            
            // nterior
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            
            if (searchValue.trim() === '') {
                // Preservar el foco cuando se limpie la búsqueda
                const activeElement = document.activeElement;
                const wasSearchInputFocused = activeElement === mainSearchInput;
                
                buscarEnTodasLasPlantillas(''); 
                filtrarFilasTabla('', plantilla, fieldNames, container, idx);
                
                // Restaurar el foco si se perdió
                if (wasSearchInputFocused) {
                    setTimeout(() => {
                        if (mainSearchInput && document.activeElement !== mainSearchInput) {
                            mainSearchInput.focus();
                        }
                    }, 50);
                }
                return;
            }
            
            // n escribir
            searchTimeout = setTimeout(() => {
                // Preservar el foco del campo de búsqueda
                const activeElement = document.activeElement;
                const wasSearchInputFocused = activeElement === mainSearchInput;
                
                // n todas las plantillas primero
                buscarEnTodasLasPlantillas(searchValue);
                
                
                filtrarFilasTabla(searchValue, plantilla, fieldNames, container, idx);
                
                // Restaurar el foco si se perdió
                if (wasSearchInputFocused) {
                    setTimeout(() => {
                        if (mainSearchInput && document.activeElement !== mainSearchInput) {
                            mainSearchInput.focus();
                        }
                    }, 50);
                }
            }, 300);
        });
        
        // nmediata al presionar Enter
        mainSearchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                
                
                if (searchTimeout) {
                    clearTimeout(searchTimeout);
                }
                
                // nmediatamente
                const searchValue = mainSearchInput.value;
                
                // n todas las plantillas
                buscarEnTodasLasPlantillas(searchValue);
                
                
                filtrarFilasTabla(searchValue, plantilla, fieldNames, container, idx);
            }
        });
        
        // n limpiar
        clearBtn.addEventListener('click', function() {
            mainSearchInput.value = '';
            toggleClearButton(); // Ocultar X
            if (mainSearchInput) mainSearchInput.focus(); // nfocar el campo después de limpiar
            
            
            buscarEnTodasLasPlantillas('');
            
            
            filtrarFilasTabla('', plantilla, fieldNames, container, idx);
        });
        
        // ntenedor de búsqueda global si no existe
        createGlobalSearchContainer();
        
        // Configurar estado inicial de la X
        toggleClearButton();
        

    }

    // nas
    if (worksheetMode === 'agregar') {
        const btnAbrirAgregarTabla = document.getElementById('btnAbrirAgregarTabla');
        if (btnAbrirAgregarTabla) {
            btnAbrirAgregarTabla.onclick = function() {
                // nar cualquier modal anterior
                document.querySelectorAll('.modal-agregar-tabla').forEach(el => el.remove());
                
                const modal = document.createElement('div');
                modal.className = 'modal-agregar-tabla';
                modal.style.position = 'fixed';
                modal.style.top = '0';
                modal.style.left = '0';
                modal.style.width = '100vw';
                modal.style.height = '100vh';
                modal.style.background = 'rgba(0,0,0,0.25)';
                modal.style.zIndex = 3000;
                modal.style.display = 'flex';
                modal.style.alignItems = 'center';
                modal.style.justifyContent = 'center';
                modal.innerHTML = `
                    <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:260px;box-shadow:0 2px 16px #0002;text-align:center;position:relative;'>
                        <h4 style='margin-bottom:18px;'>Agregar filas</h4>
                        <input id='inputCantidadColumnas' type='number' min='1' class='form-control' placeholder='Cantidad de filas' style='margin-bottom:16px;width:90%;'>
                        <div style='display:flex;gap:10px;justify-content:center;'>
                            <button id='btnGuardarTabla' class='btn-panel btn-green'>Guardar</button>
                            <button id='btnCancelarTabla' class='btn-panel btn-gray'>Cancelar</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                
                modal.addEventListener('click', function(e) {
                    if (e.target === modal) {
                        modal.remove();
                    }
                });
                // ncelar
                modal.querySelector('#btnCancelarTabla').onclick = function() {
                    modal.remove();
                };
                
                modal.querySelector('#btnGuardarTabla').onclick = function() {
                    const cantidad = parseInt(document.getElementById('inputCantidadColumnas').value);
                    if (!cantidad || cantidad < 1) {
                        const cantidadInput = document.getElementById('inputCantidadColumnas');
        if (cantidadInput) cantidadInput.focus();
                        return;
                    }
                    // Nuevas debajo, con la misma estructura de campos
                    const plantilla = optimizedFunctions.getCurrentPlantilla();
                    if (!plantilla) {
                        showClipboardIndicator('❌ No hay plantilla activa');
                        return;
                    }
                    
                    for (let i = 0; i < cantidad; i++) {
                        const nuevaFila = plantilla.campos.map(() => '');
                        tablaDatos.push(nuevaFila);
                    }
                    
                    plantilla.datos = tablaDatos;
                    
                    // n backend con logs
                    saveWorksheetData(plantilla,
                        () => {}, // Filas agregadas y guardadas silenciosamente
                        () => {
            
                            showClipboardIndicator('❌ Error al guardar filas');
                        }
                    );
                    
                    modal.remove();
                    
                    // nderizar tabla
                    reRenderTable(plantilla);
                };
            };
        }
        // NUEVO: Botón Dividir texto entre columnas
        const btnDividirTexto = document.getElementById('btnDividirTexto');
        if (btnDividirTexto) {
            btnDividirTexto.addEventListener('click', splitTextAcrossColumns);
        }
        
        // NOTA: Botón Agregar campos (funcionalidad removida según solicitud del usuario)
    }

    // Event listeners para modo filtro
    if (worksheetMode === 'filtro') {
        // Asegurar que los elementos estén en el DOM
        setTimeout(() => {
        // Botón Limpiar filtros
            const btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');
        if (btnLimpiarFiltros) {
            btnLimpiarFiltros.onclick = function() {
                limpiarTodosFiltros();
            };
        }

        // Botón Guardar cambios
        const btnGuardarFiltros = document.getElementById('btnGuardarFiltros');
        if (btnGuardarFiltros) {
            btnGuardarFiltros.onclick = function() {
                guardarFiltrosAplicados();
            };
        }
        }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
    }
    
    // OPTIMIZADO: setupSelectionEvents se llama automáticamente en initializeAllSystems
    
    // NUEVO: Agregar eventos de drag selection para filas
    setupRowDragSelection();
    
    // Inicializar sistemas después de renderizar
    setTimeout(async () => {
        
        await loadChangesHistory();
        
        // Inicializar historial de deshacer
        initializeUndoHistory();
        
        // Animaciones si no existen
        addRequiredStyles();
        
        // Persistencia de posición en plantillas
        restoreTemplatePosition();
        
        // Optimización aplicada
        if (!window.isSharedMode) {
            // PASO 6: Inicialización unificada
            initializeAllSystems();
        }
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
    
    // nderizado con delay más largo
    setTimeout(() => {
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla && plantilla.formato) {
            // ntilla
            restoreFormats(plantilla);
            
            // NUEVO: Aplicar formatos específicamente en modo copiar
            if (worksheetMode === 'copiar') {
                applyFormatsToCopyMode(plantilla);
            }
        }
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms // Reducido de 500ms a 100ms para mayor rapidez
    
    // nderizado
    restoreActiveCellFocus();
}
// Eventos globales
window.globalSelectionEventsSetup = false;
// Configurar eventos de selección múltiple
function setupSelectionEvents() {
    const table = document.getElementById('worksheetTable');
    if (!table) return;
    
    // Remover listeners anteriores para evitar duplicados
    const existingListeners = table.querySelectorAll('[data-selection-listener]');
    existingListeners.forEach(el => {
        el.removeAttribute('data-selection-listener');
    });
    
    // Configurar eventos globales solo una vez
    if (!globalSelectionEventsSetup) {
        globalSelectionEventsSetup = true;
        
        // Limpiar selección al hacer clic fuera de la tabla
        document.addEventListener('click', function(e) {
            // NO limpiar si se hace clic en un SELECT o INPUT fuera de la tabla
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') {
                return;
            }
            
            // NO limpiar si se hace clic en un INPUT fuera de la tabla
            if (e.target.tagName === 'INPUT' && !safeEventTargetClosest(e, '#worksheetTableContainer')) {
                return;
            }
            
            // NO limpiar si se hace clic en dropdown de Bootstrap
            if (safeEventTargetClosest(e, '.dropdown') || safeEventTargetClosest(e, '.dropdown-menu')) {
                return;
            }
            
            // NO limpiar si se hace clic en elementos de formulario
            if (safeEventTargetClosest(e, 'form') && !safeEventTargetClosest(e, '#worksheetTableContainer')) {                                                                                                
                return;
            }

            // Limpiar selecciones si se hace clic fuera de la tabla o menú contextual
            if (!safeEventTargetClosest(e, '#worksheetTable') && !safeEventTargetClosest(e, '.context-menu')) {                                                                                               
                clearAllSelections();
                hideContextMenu();
            }
        });

        // Finalizar arrastre (evento global)
        document.addEventListener('mouseup', function() {
            isDragging = false;
            dragStartCell = null;
        });
        
        // Eventos de teclado globales
        document.addEventListener('keydown', function(e) {
            // NO procesar si hay un SELECT abierto
            if (isSelectOpen()) {
                return;
            }
            
            // Dentro de la tabla de forma segura
            if (safeEventTargetClosest(e, '#worksheetTable')) {
                if (e.key === 'Escape') {
                    clearAllSelections();
                    hideContextMenu();
                } else if (e.ctrlKey || e.metaKey) {
                    if (e.key === 'a' || e.key === 'A') {
                        e.preventDefault();
                        // nar todo
                        clearAllSelections();
                        const rows = document.querySelectorAll('#worksheetTable tbody tr');
                        rows.forEach((row, index) => {
                            const rowIndex = parseInt(row.getAttribute('data-row-index'));
                            if (!isNaN(rowIndex)) {
                                selectRow(rowIndex);
                            }
                        });
                    }
                }
            }
        });
    }
    
    // Eventos para selección de columnas (clic en encabezado)
    table.querySelectorAll('th[data-col-index]').forEach(th => {
        if (!th.hasAttribute('data-selection-listener')) {
            th.setAttribute('data-selection-listener', 'true');
            th.addEventListener('click', function(e) {
                // Verificar si el clic fue en un icono de engranaje o filtro
                if (e.target.closest('.th-gear-icon') || e.target.closest('.th-filter-icon')) {
                    return; // No hacer nada si fue en un icono
                }
                
                e.preventDefault();
                const colIndex = parseInt(this.getAttribute('data-col-index'));
                
                if (e.ctrlKey || e.metaKey) {
                    // Selección múltiple de columnas
                    if (selectedColumns.has(colIndex)) {
                        selectedColumns.delete(colIndex);
                    } else {
                        selectColumn(colIndex);
                    }
                } else if (e.shiftKey && lastSelectedCell) {
                    // Selección de rango de columnas
                    const [lastRow, lastCol] = lastSelectedCell;
                    const minCol = Math.min(lastCol, colIndex);
                    const maxCol = Math.max(lastCol, colIndex);
                    clearAllSelections();
                    for (let col = minCol; col <= maxCol; col++) {
                        selectColumn(col);
                    }
                } else {
                    // Selección simple de columna
                    clearAllSelections();
                    selectColumn(colIndex);
                }
                lastSelectedCell = [0, colIndex];
            });
        }
    });
    
    // ntos para selección de filas (clic en numeración) con menú contextual
    table.querySelectorAll('td[data-row-header="true"]').forEach(td => {
        if (!td.hasAttribute('data-selection-listener')) {
            td.setAttribute('data-selection-listener', 'true');
            
            // n
            td.addEventListener('click', function(e) {
            e.preventDefault();
            const rowIndex = parseInt(this.getAttribute('data-row-index'));
            
            if (e.ctrlKey || e.metaKey) {
                // Selección múltiple de filas
                if (selectedRows.has(rowIndex)) {
                    selectedRows.delete(rowIndex);
                } else {
                    selectRow(rowIndex);
                }
            } else if (e.shiftKey && lastSelectedCell) {
                // seleccion de rango de filas
                const [lastRow, lastCol] = lastSelectedCell;
                const minRow = Math.min(lastRow, rowIndex);
                const maxRow = Math.max(lastRow, rowIndex);
                clearAllSelections();
                for (let row = minRow; row <= maxRow; row++) {
                    selectRow(row);
                }
            } else {
                // n simple de fila
                clearAllSelections();
                selectRow(rowIndex);
                
                // Selección de filas por drag solo cuando se hace clic en celdas de datos
                if (selectedRowsForDrag.size > 0) {
                    selectedRowsForDrag.clear();
                    clearRowSelectionStyles();
                }
            }
            lastSelectedCell = [rowIndex, 0];
            });
            
            // NUEVO: Menú contextual en numeración para eliminar filas
            td.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                const rowIndex = parseInt(this.getAttribute('data-row-index'));
                
                // Si la fila no está seleccionada, seleccionarla
                if (!selectedRows.has(rowIndex)) {
                    clearAllSelections();
                    selectRow(rowIndex);
                    lastSelectedCell = [rowIndex, 0];
                }
                
                showRowContextMenu(e.clientX, e.clientY);
            });
        }
    });
    
    // Eventos para selección de celdas
    table.querySelectorAll('td[data-row-index][data-col-index]').forEach(td => {
        if (!td.hasAttribute('data-selection-listener')) {
            td.setAttribute('data-selection-listener', 'true');
            // Selección de celda
            td.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return; 
                
                const rowIndex = parseInt(this.getAttribute('data-row-index'));
                const colIndex = parseInt(this.getAttribute('data-col-index'));
                
                if (e.ctrlKey || e.metaKey) {
                    // Selección múltiple de celdas
                    const cellKey = `${rowIndex}-${colIndex}`;
                if (selectedCells.has(cellKey)) {
                    removeCellFromSelection(rowIndex, colIndex);
                } else {
                    addCellToSelection(rowIndex, colIndex);
                }
            } else if (e.shiftKey && lastSelectedCell) {
                // Selección de rango
                const [lastRow, lastCol] = lastSelectedCell;
                clearAllSelections();
                selectRange(lastRow, lastCol, rowIndex, colIndex);
            } else {
                // Selección simple (siempre seleccionar para funciones de teclado)
                clearAllSelections();
                addCellToSelection(rowIndex, colIndex);
                
                // Guardar celda activa para persistencia
                saveActiveCellPosition(rowIndex, colIndex);
                
                
                isDragging = true;
                dragStartCell = [rowIndex, colIndex];
                
                // Selección de filas por drag solo cuando se hace clic en celdas de datos
                if (selectedRowsForDrag.size > 0) {
                    selectedRowsForDrag.clear();
                    clearRowSelectionStyles();
                }
            }
            
            lastSelectedCell = [rowIndex, colIndex];
        });
        
        // Hover y persistencia de hover
        td.addEventListener('mouseenter', function(e) {
            const rowIndex = parseInt(this.getAttribute('data-row-index'));
            const colIndex = parseInt(this.getAttribute('data-col-index'));
            
            // Celda activa para persistencia cuando haces hover sobre una celda
            saveActiveCellPosition(rowIndex, colIndex);
            
            if (isDragging && dragStartCell) {
                const [startRow, startCol] = dragStartCell;
                
                clearAllSelections();
                selectRange(startRow, startCol, rowIndex, colIndex);
            }
        });
        
        // Menú contextual
        td.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            const rowIndex = parseInt(this.getAttribute('data-row-index'));
            const colIndex = parseInt(this.getAttribute('data-col-index'));
            
            // Si la celda no está seleccionada, seleccionarla
            const cellKey = `${rowIndex}-${colIndex}`;
            if (!selectedCells.has(cellKey) && selectedRows.size === 0 && selectedColumns.size === 0) {
                clearAllSelections();
                addCellToSelection(rowIndex, colIndex);
                
                // Guardar celda activa para persistencia
                saveActiveCellPosition(rowIndex, colIndex);
            }
            
            showContextMenu(e.clientX, e.clientY);
            });
        }
    });
    
    // Event listeners para inputs dentro de celdas con sistema de historial como Excel
    table.querySelectorAll('input[id^="cell-"]').forEach(input => {
        // NUEVO: Variable local para cada input para evitar conflictos
        let cellPreviousValue = '';
        let cellInitialValue = '';
        
        input.addEventListener('focus', function() {
            const match = this.id.match(/cell-(\d+)-(\d+)/);
            if (match) {
                const rowIndex = parseInt(match[1]);
                const colIndex = parseInt(match[2]);
                
                // Guardar celda activa para persistencia
                saveActiveCellPosition(rowIndex, colIndex);
                
                // Limpiar si no hay selección múltiple activa
                if (selectedCells.size <= 1) {
                    clearAllSelections();
                    addCellToSelection(rowIndex, colIndex);
                    lastSelectedCell = [rowIndex, colIndex];
                }
                
                // Valor inicial como Excel
                const plantilla = optimizedFunctions.getCurrentPlantilla();
                if (plantilla && plantilla.campos[colIndex]) {
                    // NUEVO: Obtener el valor real de tablaDatos (como Excel)
                    const storedValue = tablaDatos[rowIndex] && tablaDatos[rowIndex][colIndex] !== undefined ? tablaDatos[rowIndex][colIndex] : '';
                    const inputValue = this.value || '';
                    
                    // NUEVO: Usar el valor almacenado como valor inicial (como Excel)
                    cellInitialValue = storedValue;
                    cellPreviousValue = storedValue;
                    
                }
            }
        });
        
        // NUEVO: Event listener para input en tiempo real
        input.addEventListener('input', function() {
            const match = this.id.match(/cell-(\d+)-(\d+)/);
            if (match) {
                const rowIndex = parseInt(match[1]);
                const colIndex = parseInt(match[2]);
                const plantilla = optimizedFunctions.getCurrentPlantilla();
                
                if (plantilla && plantilla.campos[colIndex]) {
                    const campo = plantilla.campos[colIndex];
                    const newValue = this.value || '';
                    
                    // Actualizar datos en tiempo real
                    tablaDatos[rowIndex][colIndex] = newValue;
                    plantilla.datos = tablaDatos;
                    
                    // CORREGIDO: Aplicar duplicados en tiempo real mientras escribes
                    if (isEmailOrPasswordField(campo) || campo === 'links') {
                        updateDuplicateStyles(plantilla, 0);
                    }
                }
            }
        });
        
        // NUEVO: Event listener para paste para capturar cuando pegas contenido
        input.addEventListener('paste', function() {
            const match = this.id.match(/cell-(\d+)-(\d+)/);
            if (match) {
                const rowIndex = parseInt(match[1]);
                const colIndex = parseInt(match[2]);
                const plantilla = optimizedFunctions.getCurrentPlantilla();
                
                if (plantilla && plantilla.campos[colIndex]) {
                    const campo = plantilla.campos[colIndex];
                    const oldValue = cellPreviousValue;
                    
                    // Procesar después del paste
                    setTimeout(() => {
                        const newValue = this.value;

                        // Detectar cambio real
                        if (oldValue !== newValue) {
                            recordDetailedChange('cell-paste', { row: rowIndex, col: colIndex, campo }, oldValue, newValue);
                            cellPreviousValue = newValue;
                            
                            // CORREGIDO: Aplicar duplicados en tiempo real después de pegar
                            if (isEmailOrPasswordField(campo) || campo === 'links') {
                                updateDuplicateStyles(plantilla, 0);
                            }
                        }
                    }, 5); // Optimizado para hojas de cálculo - reducido de 10ms a 5ms
                }
            }
        });
        
        // NUEVO: Event listener para clic derecho en inputs
        input.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            const match = this.id.match(/cell-(\d+)-(\d+)/);
            if (match) {
                const rowIndex = parseInt(match[1]);
                const colIndex = parseInt(match[2]);
                
                // Si la celda no está seleccionada, seleccionarla
                const cellKey = `${rowIndex}-${colIndex}`;
                if (!selectedCells.has(cellKey) && selectedRows.size === 0 && selectedColumns.size === 0) {
                    clearAllSelections();
                    addCellToSelection(rowIndex, colIndex);
                    
                    // Guardar celda activa para persistencia
                    saveActiveCellPosition(rowIndex, colIndex);
                }
                

                showContextMenu(e.clientX, e.clientY);
            }
        });
        
        // NUEVO: Event listener para blur para capturar cuando terminas de escribir (como Excel)
        input.addEventListener('blur', function() {
            const match = this.id.match(/cell-(\d+)-(\d+)/);
            if (match) {
                const rowIndex = parseInt(match[1]);
                const colIndex = parseInt(match[2]);
                const plantilla = optimizedFunctions.getCurrentPlantilla();
                
                if (plantilla && plantilla.campos[colIndex]) {
                    const campo = plantilla.campos[colIndex];
                    const finalValue = this.value || '';
                    
                    // OPTIMIZADO: Actualizar duplicados solo al terminar de escribir (blur)
                    // Esto garantiza que se detecten duplicados sin interferir con la escritura
                    if (isEmailOrPasswordField(campo) || campo === 'links') {
                        // CORREGIDO: Aplicar duplicados en tiempo real al terminar de escribir
                        updateDuplicateStyles(plantilla, 0);
                    }
                    
                    // OPTIMIZADO: Aplicar formato solo al terminar de escribir para evitar re-renderizado
                    renderCellFormat(this, campo, finalValue);
                    
                    // Procesar cambio final
                    
                    // Cambio real desde el valor inicial
                    if (cellInitialValue !== finalValue) {
                        recordDetailedChange('cell-edit', { row: rowIndex, col: colIndex, campo }, cellInitialValue, finalValue);
                        // Cambio registrado
                    } else {
                        // Sin cambios
                    }
                }
            }
        });
    });
}

// Función placeholder para mantener compatibilidad
function setupMobileEvents() {
    // Funcionalidad de selección múltiple móvil removida
}

// NUEVO: Configurar eventos de drag selection para filas
function setupRowDragSelection() {
    const table = document.getElementById('worksheetTable');
    if (!table) return;
    
    // Obtener todas las celdas de numeración de filas
    const rowHeaders = table.querySelectorAll('td[data-row-header="true"]');
    
    rowHeaders.forEach(header => {
        // Eventos anteriores
        header.removeEventListener('mousedown', handleRowMouseDown);
        header.removeEventListener('mouseenter', handleRowMouseEnter);
        header.removeEventListener('mouseleave', handleRowMouseLeave);
        
        // Nuevos eventos
        header.addEventListener('mousedown', handleRowMouseDown);
        header.addEventListener('mouseenter', handleRowMouseEnter);
        header.addEventListener('mouseleave', handleRowMouseLeave);
        header.addEventListener('contextmenu', handleRowContextMenu);
        
        // Indicar que es seleccionable
        header.style.cursor = 'pointer';
        header.style.userSelect = 'none';
        header.setAttribute('title', 'Mantén presionado y arrastra para seleccionar múltiples filas');
        
        // NUEVO: Prevenir que el clic en celdas de datos limpie la selección
        header.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevenir que el clic se propague
        });
        
        // NUEVO: Prevenir que el clic derecho en celdas de datos limpie la selección
        header.addEventListener('contextmenu', function(e) {
            e.stopPropagation(); // Prevenir que el clic se propague
        });
        
        // NUEVO: Prevenir que otros event listeners interfieran con la selección
        header.addEventListener('mousedown', function(e) {
            if (e.button === 2) { 
                e.stopPropagation();
            }
        });
        
        // NUEVO: Manejar touch en móviles para evitar conflictos
        header.addEventListener('touchstart', function(e) {
            e.stopPropagation();
        }, { passive: true });
        
        header.addEventListener('touchend', function(e) {
            e.stopPropagation();
        }, { passive: true });
    });
    
    // Event listeners globales para el drag
    document.addEventListener('mouseup', handleRowMouseUp);
    document.addEventListener('mousemove', handleRowMouseMove);
}

// NUEVO: Manejar mouse down en celdas de numeración
function handleRowMouseDown(e) {
    // nejar clic izquierdo, no clic derecho
    if (e.button !== 0) return;
    
    e.preventDefault();
    rowDragMouseDown = true;
    isDraggingRows = false;
    
    const rowIndex = parseInt(e.target.getAttribute('data-row-index'));
    dragStartRow = rowIndex;
    
    // Limpiar selección anterior
    selectedRowsForDrag.clear();
    clearRowSelectionStyles();
    
    // Selección inicial
    selectedRowsForDrag.add(rowIndex);
    updateRowSelectionStyles();
    
    // Pequeño delay
    setTimeout(() => {
        if (rowDragMouseDown) {
            isDraggingRows = true;
        }
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms // Optimizado para hojas de cálculo - reducido de 150ms a 100ms
}

// NUEVO: Manejar mouse enter durante drag
function handleRowMouseEnter(e) {
    if (!isDraggingRows || dragStartRow === -1) return;
    
    const rowIndex = parseInt(e.target.getAttribute('data-row-index'));
    
    // Limpiar y recalcular rango
    selectedRowsForDrag.clear();
    
    const startRow = Math.min(dragStartRow, rowIndex);
    const endRow = Math.max(dragStartRow, rowIndex);
    
    // Seleccionar todas las filas en el rango
    for (let i = startRow; i <= endRow; i++) {
        selectedRowsForDrag.add(i);
    }
    
    updateRowSelectionStyles();
}

// NUEVO: Manejar mouse leave (opcional)
function handleRowMouseLeave(e) {
    // No hacer nada específico al salir de una celda durante el drag
}

// NUEVO: Manejar mouse up global
function handleRowMouseUp(e) {
    // Manejar clic izquierdo
    if (e.button !== 0) return;
    
    if (rowDragMouseDown || isDraggingRows) {
        rowDragMouseDown = false;
        isDraggingRows = false;
        
        // NO mostrar menú contextual automáticamente
        // Menú contextual se mostrará solo con clic derecho
    }
}

// NUEVO: Manejar clic derecho en celdas de numeración
function handleRowContextMenu(e) {
    e.preventDefault(); // Prevenir menú contextual del navegador
    e.stopPropagation(); // Prevenir que se propague a otros event listeners
    
    // Detectar móvil
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    
    // Si no hay filas seleccionadas, seleccionar la fila actual
    if (selectedRowsForDrag.size === 0) {
        const rowIndex = parseInt(e.target.getAttribute('data-row-index'));
        selectedRowsForDrag.add(rowIndex);
        updateRowSelectionStyles();
    }
    
    // Mostrar menú contextual
    showRowSelectionContextMenu(e.clientX, e.clientY);
}

// NUEVO: Manejar mouse move global para mantener drag
function handleRowMouseMove(e) {
    if (isDraggingRows) {
        // Durante drag
        document.body.style.cursor = 'pointer';
    } else if (rowDragMouseDown) {
        document.body.style.cursor = 'default';
    }
}

// NUEVO: Actualizar estilos visuales de filas seleccionadas
function updateRowSelectionStyles() {
    // Limpiar estilos anteriores
    clearRowSelectionStyles();
    
    // Procesar filas seleccionadas
    selectedRowsForDrag.forEach(rowIndex => {
        const row = document.querySelector(`tr[data-row-index="${rowIndex}"]`);
        if (row) {
            row.style.backgroundColor = '#e3f2fd';
            row.style.border = '2px solid #2196f3';
            row.setAttribute('data-row-selected', 'true');
        }
    });
}

// NUEVO: Limpiar estilos de selección de filas
function clearRowSelectionStyles() {
    const selectedRows = document.querySelectorAll('tr[data-row-selected="true"]');
    selectedRows.forEach(row => {
        row.style.backgroundColor = '';
        row.style.border = '';
        row.removeAttribute('data-row-selected');
    });
}

// NUEVO: Mostrar menú contextual para filas seleccionadas
function showRowSelectionContextMenu(x, y) {
    // En modo readonly compartido, no mostrar el modal de herramientas
    if (window.isSharedMode && window.isReadonly) {
        return;
    }
    
    hideContextMenu(); // Ocultar menú anterior
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'rowSelectionContextMenu'; // ID único para evitar conflictos
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    const rowCount = selectedRowsForDrag.size;
    const rowText = rowCount === 1 ? 'fila seleccionada' : `${rowCount} filas seleccionadas`;
    
    // NUEVO: Generar HTML del menú según el modo
    const baseMenuHTML = `
        <div class="context-menu-item context-menu-info">
            <i class="fas fa-info-circle"></i>
            ${rowText}
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="add-row-above">
            <i class="fas fa-plus" style="color: #28a745;"></i>
            Crear fila arriba
        </div>
        <div class="context-menu-item" data-action="add-row-below">
            <i class="fas fa-plus" style="color: #28a745;"></i>
            Crear fila abajo
        </div>
    `;
    
    // NUEVO: Solo mostrar opciones de eliminación en modo admin
    const adminMenuHTML = window.isSharedMode ? '' : `
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="delete-selected-rows">
            <i class="fas fa-trash" style="color: #dc3545;"></i>
            Eliminar filas seleccionadas
        </div>
        <div class="context-menu-item" data-action="clear-selected-rows">
            <i class="fas fa-eraser"></i>
            Limpiar contenido de filas
        </div>
    `;
    
    const commonMenuHTML = `
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-selected-rows">
            <i class="fas fa-copy"></i>
            Copiar filas
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="format-rows">
            <i class="fas fa-palette"></i>
            Formato rápido
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="cancel-selection">
            <i class="fas fa-times"></i>
            Cancelar selección
        </div>
    `;
    
    menu.innerHTML = baseMenuHTML + adminMenuHTML + commonMenuHTML;
    
    document.body.appendChild(menu);
    
    // Event listeners para las acciones
    menu.addEventListener('click', function(e) {
        // Función segura para evitar errores en modo compartido
        const contextMenuItem = safeEventTargetClosest(e, '.context-menu-item');
        const action = contextMenuItem?.getAttribute('data-action');
        if (action) {
            handleRowSelectionAction(action);
            hideRowSelectionContextMenu();
        }
    });
    
    // NO cancelar la selección
    setTimeout(() => {
        document.addEventListener('click', function closeRowSelectionMenu(e) {
            // Verificar de forma segura
            if (!safeEventTargetClosest(e, '#rowSelectionContextMenu')) {
                hideRowSelectionContextMenu();
                document.removeEventListener('click', closeRowSelectionMenu);
                // NO limpiar la selección al cerrar el menú
            } else {
                // Si no está disponible, cerrar menú por seguridad
                hideRowSelectionContextMenu();
                document.removeEventListener('click', closeRowSelectionMenu);
            }
        });
    }, 10);
}

// NUEVO: Manejar acciones del menú contextual de filas
function handleRowSelectionAction(action) {
    const selectedRowsArray = Array.from(selectedRowsForDrag);
    
    // Prevenir acciones de eliminación en modo compartido
    if (window.isSharedMode && (action === 'delete-selected-rows' || action === 'clear-selected-rows')) {
        alert('Solo el administrador puede eliminar o limpiar filas.');
        return;
    }
    
    switch (action) {
        case 'add-row-above':
            addRowAbove(selectedRowsArray[0]);
            break;
        case 'add-row-below':
            addRowBelow(selectedRowsArray[0]);
            break;
        case 'delete-selected-rows':
            deleteSelectedRowsWithConfirmation(selectedRowsArray);
            break;
        case 'clear-selected-rows':
            clearSelectedRowsContent(selectedRowsArray);
            break;
        case 'copy-selected-rows':
            copySelectedRowsContent(selectedRowsArray);
            break;
        case 'format-rows':
            showFormatMenu();
            break;
        case 'cancel-selection':
            cancelRowSelection();
            break;
    }
}

// NUEVO: Crear fila arriba de la seleccionada
function addRowAbove(rowIndex) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    pushTablaUndo(); 
    
    // Crear nueva fila vacía
    const nuevaFila = plantilla.campos.map(() => '');
    
    // Insertar la fila en la posición especificada
    tablaDatos.splice(rowIndex, 0, nuevaFila);
    
    // Actualizar plantilla y guardar
    plantilla.datos = tablaDatos;
    saveWorksheetData(plantilla, 
        () => {
            showClipboardIndicator('✅ Fila creada arriba');
            reRenderTable(plantilla);
        },
        () => showClipboardIndicator('❌ Error al crear fila')
    );
}

// NUEVO: Crear fila abajo de la seleccionada
function addRowBelow(rowIndex) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    pushTablaUndo(); 
    
    // Crear nueva fila vacía
    const nuevaFila = plantilla.campos.map(() => '');
    
    // Insertar la fila después de la posición especificada
    tablaDatos.splice(rowIndex + 1, 0, nuevaFila);
    
    // Actualizar plantilla y guardar
    plantilla.datos = tablaDatos;
    saveWorksheetData(plantilla, 
        () => {
            showClipboardIndicator('✅ Fila creada abajo');
            reRenderTable(plantilla);
        },
        () => showClipboardIndicator('❌ Error al crear fila')
    );
}

// NUEVO: Eliminar filas seleccionadas con confirmación
function deleteSelectedRowsWithConfirmation(rowIndices) {
    if (rowIndices.length === 0) return;
    
    const rowCount = rowIndices.length;
    const rowText = rowCount === 1 ? 'esta fila' : `estas ${rowCount} filas`;
    
    if (confirm(`¿Estás seguro de que quieres eliminar ${rowText}? Esta acción no se puede deshacer.`)) {
        pushTablaUndo(); 
        
        // Ordenar índices de mayor a menor para eliminar desde abajo
        const sortedIndices = rowIndices.sort((a, b) => b - a);
        
        // Eliminar filas de tablaDatos
        sortedIndices.forEach(rowIndex => {
            if (tablaDatos[rowIndex]) {
                tablaDatos.splice(rowIndex, 1);
            }
        });
        
        // Actualizar plantilla y sincronizar datos originales
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla) {
            plantilla.datos = tablaDatos;
            
            // Sincronizar con datos originales
            if (plantilla.datosOriginales) {
                sortedIndices.forEach(rowIndex => {
                    if (plantilla.datosOriginales[rowIndex]) {
                        plantilla.datosOriginales.splice(rowIndex, 1);
                    }
                });
            }
            
            // Guardar en backend y re-renderizar
            saveWorksheetData(plantilla,
                () => {
                    showClipboardIndicator(`✅ ${rowCount} fila${rowCount > 1 ? 's' : ''} eliminada${rowCount > 1 ? 's' : ''}`);
                    reRenderTable(plantilla);
                    cancelRowSelection();
                },
                () => {
                    showClipboardIndicator('❌ Error al eliminar filas');
                }
            );
        }
    }
}
// NUEVO: Limpiar contenido de filas seleccionadas
function clearSelectedRowsContent(rowIndices) {
    if (rowIndices.length === 0) return;
    
    pushTablaUndo(); 
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // Limpiar contenido de todas las celdas en las filas seleccionadas
    rowIndices.forEach(rowIndex => {
        if (tablaDatos[rowIndex]) {
            for (let col = 0; col < tablaDatos[rowIndex].length; col++) {
                tablaDatos[rowIndex][col] = '';
            }
        }
    });
    
    // Actualizar plantilla y sincronizar datos originales
    plantilla.datos = tablaDatos;
    
    // Sincronizar con datos originales
    if (plantilla.datosOriginales) {
        rowIndices.forEach(rowIndex => {
            if (plantilla.datosOriginales[rowIndex]) {
                for (let col = 0; col < plantilla.datosOriginales[rowIndex].length; col++) {
                    plantilla.datosOriginales[rowIndex][col] = '';
                }
            }
        });
    }
    
    // Guardar y re-renderizar
    saveWorksheetData(plantilla,
        () => {
            showClipboardIndicator(`✅ Contenido de ${rowIndices.length} fila${rowIndices.length > 1 ? 's' : ''} limpiado`);
            reRenderTable(plantilla);
            cancelRowSelection();
        },
        () => {
            showClipboardIndicator('❌ Error al limpiar filas');
        }
    );
}

// NUEVO: Copiar contenido de filas seleccionadas
function copySelectedRowsContent(rowIndices) {
    if (rowIndices.length === 0) return;
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    let textToCopy = '';
    
    // Construir texto con el contenido de las filas
    rowIndices.sort((a, b) => a - b).forEach(rowIndex => {
        if (tablaDatos[rowIndex]) {
            const rowContent = tablaDatos[rowIndex].join('\t');
            textToCopy += rowContent + '\n';
        }
    });
    
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            showClipboardIndicator(`✅ ${rowIndices.length} fila${rowIndices.length > 1 ? 's' : ''} copiada${rowIndices.length > 1 ? 's' : ''}`);
            cancelRowSelection();
        }).catch(() => {
            showClipboardIndicator('❌ Error al copiar');
        });
    } else {
        showClipboardIndicator('❌ Portapapeles no disponible');
    }
}

// NUEVO: Cancelar selección de filas
function cancelRowSelection() {
    // Limpiar cuando se solicita explícitamente
    selectedRowsForDrag.clear();
    clearRowSelectionStyles();
    isDraggingRows = false;
    dragStartRow = -1;
    rowDragMouseDown = false;
    document.body.style.cursor = 'default';
}


function filtrarFilasTabla(query, plantilla, fieldNames, container, idx) {
    query = query.trim().toLowerCase();
    let filteredRows = tablaDatos.filter(fila => fila.some(val => (val + '').toLowerCase().includes(query)));
    
    // Generar nombres de campos dinámicamente según el modo actual
    const dynamicFieldNames = optimizedFunctions.getStandardFieldNames();
    
    // Función helper para paginación
    const { totalRows, totalPages, paginatedRows } = calculatePagination(filteredRows);
    // Mantener los selectores con el mismo estilo que en renderTablaEditable
    let html = `<div class='d-flex justify-content-center align-items-center mb-4 gap-3' style='width:100%'>
        <select id="rowsPerPageSelect" class="form-select form-select-sm d-inline-block">
            <option disabled>Mostrar</option>
            ${rowsPerPageOptions.map(opt => `<option value="${opt}" ${rowsPerPage == opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
        <select id="modeSelect" class="form-select form-select-sm d-inline-block">
            <option disabled>Modo</option>
            <option value="standard" ${worksheetMode === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="copiar" ${worksheetMode === 'copiar' ? 'selected' : ''}>Copiar</option>
            ${(!window.isSharedMode) ? `<option value="agregar" ${worksheetMode === 'agregar' ? 'selected' : ''}>Agregar</option>` : ''}
            ${(!window.isSharedMode) ? `<option value="filtro" ${worksheetMode === 'filtro' ? 'selected' : ''}>Filtro</option>` : ''}
        </select>
    </div>`;
    
    // Mostrar plantilla también durante la búsqueda (solo si existe título)
    if (plantilla.titulo && plantilla.titulo.trim()) {
        // Optimización aplicada
        const viewersAndLogsIcons = !window.isSharedMode ? 
            `<button id="connectionLogsBtn" class="connection-logs-btn" title="Registro de conexiones">
                <i class="fas fa-history"></i>
                <span id="logsCount">0</span>
            </button>` : '';
        
        html += `<div class="plantilla-titulo-container mb-3 text-center">
            <h4 class="plantilla-titulo-header">
                ${plantilla.titulo}
                ${viewersAndLogsIcons}
            </h4>
    </div>`;
    }
    
    html += `<div class='table-responsive'><table class='table table-bordered table-striped mb-0' id='worksheetTable'><thead><tr>`;
    // Columna de numeración
    html += `<th class='col-numeracion' data-row-header='true'>#</th>`;
    plantilla.campos.forEach((campo, colIdx) => {
        let thContent = dynamicFieldNames[campo] || campo;
        // NOTA: No cambiar automáticamente 'letras' por 'let'
        // Los nombres se manejan correctamente en optimizedFunctions.getStandardFieldNames()
        
        // En modo agregar, muestra el engranaje en todas las columnas
        if (worksheetMode === 'agregar') {
            thContent += ` <span class='th-gear-icon' id='th-gear-${colIdx}' title='Opciones'><i class='fas fa-cog'></i></span>`;
        }
        // En modo filtro, muestra el icono de filtro en todas las columnas
        if (worksheetMode === 'filtro') {
            thContent += ` <span class='th-filter-icon' id='th-filter-${colIdx}' title='Filtros'><i class='fas fa-filter'></i></span>`;
        }
        
        if (campo === 'numero') {
            html += `<th class="col-numero" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'let') {
            html += `<th class="col-let" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'letras') {
            html += `<th class="col-letras" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'contraseña') {
            html += `<th class="col-contraseña" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'links') {
            html += `<th class="col-links" data-col-index="${colIdx}">${thContent}</th>`;
        } else if (campo === 'informacion-adicional') {
            html += `<th class="col-info-adicional" data-col-index="${colIdx}">${thContent}</th>`;
        } else {
            html += `<th data-col-index="${colIdx}">${thContent}</th>`;
        }
    });
    html += `</tr></thead><tbody>`;
    
    // Contraseña y links
    const duplicadosCorreo = detectarDuplicados(plantilla, 'correo');
    const duplicadosContraseña = detectarDuplicados(plantilla, 'contraseña');
    const duplicadosLinks = detectarDuplicados(plantilla, 'links');
    
    paginatedRows.forEach((fila, filaIdx) => {
        const realRowIdx = (rowsPerPage === 'todos' ? filaIdx : (filaIdx + (currentPage-1)*rowsPerPage));
        
        // Índices de campos 'numero' en la fila
        let numIndices = [];
        plantilla.campos.forEach((c, i) => { if (c === 'numero') numIndices.push(i); });
        
        let bloqueColores = Array(fila.length).fill(null);
        numIndices.forEach((numIdx, bloqueIdx) => {
            let numVal = (fila[numIdx] || '').toString();
            // Usar función centralizada para obtener colores
            const colors = getNumberColors(numVal);
            const color = colors ? colors.color : null;
            const borderColor = colors ? colors.borderColor : null;
            const textColor = colors ? colors.textColor : null;
            // Inicio o desde el último número (o 0) hasta este número (incluido)
            let start = (numIndices[bloqueIdx-1] !== undefined) ? numIndices[bloqueIdx-1]+1 : 0;
            for (let i = start; i <= numIdx; i++) {
                if (color) bloqueColores[i] = { color, textColor, borderColor };
            }
        });
        
        html += `<tr data-row-index="${realRowIdx}">`;
        html += generateTableCells(fila, realRowIdx, plantilla, bloqueColores, duplicadosCorreo, duplicadosContraseña, duplicadosLinks);
        html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    html += `<div class="d-flex justify-content-between align-items-center mt-2 mb-2">
        <div>
            <button class="btn btn-sm btn-outline-secondary" id="btnPrevPage" ${currentPage <= 1 ? 'disabled' : ''}>Anterior</button>
            <span class="mx-2">Página ${currentPage} de ${totalPages}</span>
            <button class="btn btn-sm btn-outline-secondary" id="btnNextPage" ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
    </div>`;
    container.innerHTML = html;
    // Configurar listeners usando funciones helper (modo filtro)
    plantilla.campos.forEach((campo, colIdx) => {
        paginatedRows.forEach((fila, filaIdx) => {
            const realFilaIdx = (rowsPerPage === 'todos' ? filaIdx : (filaIdx + (currentPage-1)*rowsPerPage));
            const input = document.getElementById(`cell-${realFilaIdx}-${colIdx}`);
            attachCellEventListeners(input, realFilaIdx, colIdx, campo, plantilla, [], container, idx, true);
        });
    });
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    if (btnPrev) btnPrev.addEventListener('click', function() {
        if (currentPage > 1) {
            saveCurrentPage(currentPage - 1);
            filtrarFilasTabla(query, plantilla, fieldNames, container, idx);
        }
    });
    if (btnNext) btnNext.addEventListener('click', function() {
        if (currentPage < totalPages) {
            saveCurrentPage(currentPage + 1);
            filtrarFilasTabla(query, plantilla, fieldNames, container, idx);
        }
    });
    const rowsSelect = document.getElementById('rowsPerPageSelect');
    if (rowsSelect) {
        rowsSelect.addEventListener('change', function() {
            const val = rowsSelect.value === 'todos' ? 'todos' : parseInt(rowsSelect.value);
            rowsPerPage = val;
            saveCurrentPage(1);
            filtrarFilasTabla(query, plantilla, fieldNames, container, idx);
        });
    }
    
    // Listener para el selector de modo
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        modeSelect.value = worksheetMode;
        modeSelect.addEventListener('change', function() {
            // Prevenir cambio a modo filtro en modo compartido
            if (window.isSharedMode && modeSelect.value === 'filtro') {
                // Mostrar alerta
                alert('Solo el administrador puede usar el modo Filtro.');
                // Restaurar valor anterior
                modeSelect.value = worksheetMode;
                return;
            }
            
            worksheetMode = modeSelect.value;
            localStorage.setItem('worksheetMode', worksheetMode);
            
            // Invalidar cache de nombres de campos cuando cambie el modo
            if (optimizedFunctions.invalidateAll) {
                optimizedFunctions.invalidateAll();
            }
            
            // Re-renderizar la tabla completa con el nuevo modo
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            
            // Aplicar formatos específicamente si se cambia a modo copiar
            if (worksheetMode === 'copiar') {
                setTimeout(() => {
                    const plantilla = optimizedFunctions.getCurrentPlantilla();
                    if (plantilla && plantilla.formato) {
                        applyFormatsToCopyMode(plantilla);
                    }
                }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms // Reducido de 600ms a 100ms para mayor rapidez
            }
        });
    }
    
    // OPTIMIZADO: setupSelectionEvents se llama automáticamente en initializeAllSystems
    
    // NOTA: Funcionalidad de fijar campos removida según solicitud del usuario
    
    // nderizado
    restoreActiveCellFocus();
    
    // Configurar eventos de teclado después de renderizar la tabla
    setTimeout(() => {
        const worksheetContainer = document.getElementById('worksheetTableContainer');
        if (worksheetContainer) {
            worksheetContainer.setAttribute('tabindex', '0');
            worksheetContainer.style.outline = 'none';
            // Configurar eventos de teclado
        }
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
} 

// Función de copia mejorada para dispositivos móviles
function copyToClipboardMobile(text) {
    // Intentar el método moderno primero
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    
    // Para navegadores antiguos
    return new Promise((resolve, reject) => {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            textArea.style.top = '-9999px';
            textArea.style.opacity = '0';
            textArea.setAttribute('readonly', '');
            
            document.body.appendChild(textArea);
            
            // Validación de setSelectionRange
            if (navigator.userAgent.match(/ipad|iphone/i)) {
                textArea.contentEditable = true;
                textArea.readOnly = false;
                try {
                    const range = document.createRange();
                    range.selectNodeContents(textArea);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    
                    // Verificar que setSelectionRange esté disponible
                    if (typeof textArea.setSelectionRange === 'function') {
                textArea.setSelectionRange(0, 999999);
                    }
                } catch (selectionError) {
            
                    
                    try {
                        textArea.select();
                    } catch (selectError) {
                        // Error al seleccionar
                    }
                }
            } else {
                try {
                    textArea.select();
                } catch (selectError) {
                    // Error al seleccionar
                }
            }
            
            // Comando de copia
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                resolve();
            } else {
                reject(new Error('No se pudo copiar'));
            }
        } catch (err) {
            reject(err);
        }
    });
} 

// Unificado de copia SI// PREVENIR DUPLICACIÓN (variable movida al inicio)
function setupCopyListeners() {
    // Prevenir duplicación de event listeners
    if (copyListenersSetup) {
        // Ya configurado
        return;
    }
    copyListenersSetup = true;
    
    
}

// Listeners de copia ya están configurados (los existentes)
copyListenersSetup = true;

document.addEventListener('click', function(e) {
    // Función de validación unificada
    if (!isValidEventTarget(e)) return;
    
    // Copiar en el icono en cualquier modo
    const iconElem = safeEventTargetClosest(e, '.copy-icon');
    if (iconElem && iconElem.getAttribute('data-valor')) {
        const valor = iconElem.getAttribute('data-valor');
        copyToClipboardMobile(valor).then(() => {
            const icon = iconElem.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-check';
                iconElem.style.color = '#43b843';
                setTimeout(() => {
                    icon.className = 'fas fa-copy';
                    iconElem.style.color = '';
                }, 1200);
            }
        }).catch(() => {
            // Error al copiar
        });
        return;
    }
    // En modo copiar, permitir copiar al hacer clic en toda la celda
    if (worksheetMode === 'copiar') {
        // Función segura unificada
        const copyElem = safeEventTargetClosest(e, '.cell-copyable');
        if (copyElem && copyElem.getAttribute('data-valor')) {
            const valor = copyElem.getAttribute('data-valor');
            copyToClipboardMobile(valor).then(() => {
                // NUEVO: Efecto visual de copiado exitoso
                const originalBackground = copyElem.style.backgroundColor;
                const originalColor = copyElem.style.color;
                
                copyElem.style.backgroundColor = '#d4edda';
                copyElem.style.color = '#155724';
                copyElem.style.transition = 'all 0.3s ease';
                
                const textSpan = copyElem.querySelector('.cell-copy-text');
                if (textSpan) {
                    const originalText = textSpan.textContent;
                    textSpan.textContent = '¡Copiado!';
                    textSpan.style.fontWeight = 'bold';
                    
                    // Restaurar estilos originales
                    setTimeout(() => {
                        copyElem.style.backgroundColor = originalBackground;
                        copyElem.style.color = originalColor;
                        textSpan.textContent = originalText;
                        textSpan.style.fontWeight = '';
                        copyElem.style.transition = '';
                    }, 1200);
                }
            }).catch(() => {
                // Error al copiar
            });
        }
    }
}); 

document.addEventListener('dblclick', function(e) {
    if (worksheetMode === 'copiar') {
        // Función de validación unificada
        if (!isValidEventTarget(e)) return;
        
        const copyElem = safeEventTargetClosest(e, '.cell-copyable');
        if (copyElem) {
            const td = safeClosest(copyElem, 'td');
            if (!td) return;
            // Obtener info de fila y columna
            const idMatch = copyElem.querySelector('.copy-icon')?.id?.match(/copy-(?:text|input)-(\d+)-(\d+)/);
            if (!idMatch) return;
            const filaIdx = parseInt(idMatch[1]);
            const colIdx = parseInt(idMatch[2]);
            const table = safeClosest(td, 'table');
            const campo = table ? table.querySelectorAll('th')[colIdx]?.textContent?.toLowerCase() || '' : '';
            let inputType = 'text';
            let inputClass = `form-control cell-${campo}`;
            let maxLength = '';
            if (campo === 'let') maxLength = 'maxlength="4"';
            if (campo === 'numero') inputType = 'number';
            // Crear input editable
            const input = document.createElement('input');
            input.type = inputType;
            input.className = inputClass;
            input.value = copyElem.getAttribute('data-valor') || '';
            if (maxLength) input.setAttribute('maxlength', '4');
            input.style.width = '100%';
            // Reemplazar con input
            td.innerHTML = '';
            td.appendChild(input);
            if (input) input.focus();
            // Manejar Enter
            input.addEventListener('blur', function() {
                tablaDatos[filaIdx][colIdx] = input.value;
                td.innerHTML = renderEditableCell(campo, input.value, filaIdx, colIdx);
            });
            input.addEventListener('keydown', function(ev) {
                if (ev.key === 'Enter') {
                    input.blur();
                }
            });
        }
    }
}); 

// Menú contextual para engranaje de columna en modo agregar
function closeAllGearMenus() {
    document.querySelectorAll('.th-gear-popover').forEach(el => el.remove());
    document.querySelectorAll('.gear-modal-overlay').forEach(el => el.remove());
}
// Seleccionar tipo de campo y doble confirmación
function showAddFieldModal(colIdx, side) {
    closeAllGearMenus();
    
    // OPTIMIZADO: Usar ModalManager con cleanup automático
    const modalObj = ModalManager.create('add-field-modal');
    const modal = modalObj.element;
    
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:260px;box-shadow:0 2px 16px #0002;text-align:center;position:relative;border:2px solid #000;'>
            <h4>Selecciona el tipo de campo</h4>
            <div style='display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:18px 0;'>
                <button class='add-field-type-btn' data-type='correo'><i class='fas fa-envelope'></i> Correo</button>
                <button class='add-field-type-btn' data-type='contraseña'><i class='fas fa-key'></i> Contraseña</button>
                <button class='add-field-type-btn' data-type='links'><i class='fas fa-link'></i> Links</button>
                <button class='add-field-type-btn' data-type='letras'><i class='fas fa-font'></i> Letras</button>
                <button class='add-field-type-btn' data-type='informacion-adicional'><i class='fas fa-info-circle'></i> Info adicional</button>
                <button class='add-field-type-btn' data-type='numero'><i class='fas fa-hashtag'></i> Número</button>
                <button class='add-field-type-btn' data-type='otro-campo'><i class='fas fa-plus'></i> Otro campo</button>
            </div>
            <button class='cancel-btn' style='margin-top:10px;background-color:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Cancelar</button>
        </div>
    `;
    
    // Listener para seleccionar tipo (con cleanup automático)
    modal.querySelectorAll('.add-field-type-btn').forEach(btn => {
        const clickHandler = function() {
            const tipo = btn.getAttribute('data-type');
            modalObj.remove(); // Cleanup automático
            showAddFieldConfirmModal(colIdx, side, tipo);
        };
        modalObj.addListener(btn, 'click', clickHandler);
    });
    
    // Listener para cancelar (con cleanup automático)
    const cancelBtn = modal.querySelector('.cancel-btn');
    if (cancelBtn) {
        modalObj.addListener(cancelBtn, 'click', () => modalObj.remove());
    }
    
    modalObj.show();
}
function showAddFieldConfirmModal(colIdx, side, tipo) {
    // Limpiar cualquier modal anterior
    document.querySelectorAll('.add-field-confirm-modal').forEach(el => el.remove());
    // Crear modal de confirmación
    const modal = document.createElement('div');
    modal.className = 'add-field-confirm-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.25)';
    modal.style.zIndex = 2100;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:260px;box-shadow:0 2px 16px #0002;text-align:center;border:2px solid #000;'>
            <h4>¿Seguro que quieres añadir el campo <b>${tipo.replace('-', ' ')}</b> ${side === 'right' ? 'a la derecha' : 'a la izquierda'}?</h4>
            <div style='margin-top:18px;'>
                <button id='confirm-add-field-btn' style='background-color:#28a745;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Sí, añadir</button>
                <button onclick='document.querySelectorAll(".add-field-confirm-modal").forEach(el=>el.remove())' style='margin-left:10px;background-color:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // NUEVO: Listener para cerrar modal de confirmación al hacer clic fuera
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Listener para confirmar
    modal.querySelector('#confirm-add-field-btn').onclick = function() {
        modal.remove();
        
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        let insertIdx = side === 'right' ? (parseInt(colIdx) + 1) : parseInt(colIdx);
        
        // nsertar el tipo de campo en la plantilla
        plantilla.campos.splice(insertIdx, 0, tipo);
        // Insertar valor vacío en cada fila de datos
        tablaDatos.forEach(fila => fila.splice(insertIdx, 0, ''));
        plantilla.datos = tablaDatos;
        
        // GUARDAR EN BACKEND (igual que executeInsertColumn)
        // Actualizar plantilla
        fetch('/api/store/worksheet_templates', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify({ 
                id: plantilla.id, 
                title: plantilla.titulo,
                fields: plantilla.campos 
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error actualizando plantilla: ${response.status}`);
            }
            return response.json();
        })
        .then(() => {
            // Guardar datos actualizados
            return fetch('/api/store/worksheet_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
                body: JSON.stringify({ template_id: plantilla.id, data: tablaDatos })
            });
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error guardando datos: ${response.status}`);
            }
            return response.json();
        })
        .then(() => {
            // Renderizar tabla actualizada
            reRenderTable(plantilla);
            // Campo agregado y guardado silenciosamente
        })
        .catch(error => {
            // Error al guardar
            showClipboardIndicator('❌ Error al guardar campo');
            // Renderizar para mostrar el cambio local aunque falle el guardado
            reRenderTable(plantilla);
        });
    };
}
// Listener para los botones del menú contextual (tanto popover como modal)
let gearMenuJustOpened = false;
document.addEventListener('mousedown', function(e) {
    if (e.target.classList.contains('gear-menu-btn') || e.target.classList.contains('gear-modal-btn')) {
        e.stopPropagation();
        const colIdx = parseInt(e.target.getAttribute('data-col'));
        const action = e.target.getAttribute('data-action');
        
        // Prohibir acciones de administración en modo compartido
        if (window.isSharedMode && (action === 'change' || action === 'delete' || action === 'permissions')) {
            // Mostrar mensaje de error
            alert('Solo el administrador puede cambiar, eliminar campos o gestionar permisos.');
            return;
        }
        
        if (action === 'add-right') {
            showAddFieldModal(colIdx, 'right');
        } else if (action === 'add-left') {
            showAddFieldModal(colIdx, 'left');
        } else if (action === 'change') {
            showChangeFieldModal(colIdx);
        } else if (action === 'delete') {
            showDeleteFieldModal(colIdx);
        } else if (action === 'permissions') {
            showPermissionsModal();
        }
        closeAllGearMenus();
        return;
    }
});
document.addEventListener('click', function(e) {
    // Función inicial unificada
    if (!isValidEventTarget(e)) return;
    
    // En un engranaje de columna
    const gearIcon = safeEventTargetClosest(e, '.th-gear-icon');
    if (gearIcon) {
        e.stopPropagation();
        e.preventDefault();
        closeAllGearMenus();
        // Función segura unificada
        const icon = gearIcon;
        const colIdx = parseInt(icon.id.replace('th-gear-', ''));
        // Modal centrado
        const modal = document.createElement('div');
        modal.className = 'gear-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;
        
        // NUEVO: Generar opciones según el modo
        const baseOptions = `
            <button class='gear-modal-btn' data-action='add-right' data-col='${colIdx}'>
                <i class='fas fa-plus'></i> Añadir campo a la derecha
            </button>
            <button class='gear-modal-btn' data-action='add-left' data-col='${colIdx}'>
                <i class='fas fa-plus'></i> Añadir campo a la izquierda
            </button>
        `;
        
        // NUEVO: Solo mostrar opciones de administración en modo admin
        const adminOptions = window.isSharedMode ? '' : `
            <button class='gear-modal-btn' data-action='change' data-col='${colIdx}'>
                <i class='fas fa-edit'></i> Cambiar el campo
            </button>
            <button class='gear-modal-btn gear-modal-btn-danger' data-action='delete' data-col='${colIdx}'>
                <i class='fas fa-trash'></i> Eliminar este campo
            </button>
            ${isCurrentUserAdmin() ? `
                <button class='gear-modal-btn' data-action='permissions' data-col='${colIdx}'>
                    <i class='fas fa-users-cog'></i> Gestionar permisos
                </button>
            ` : ''}
        `;
        
        modal.innerHTML = `
            <div class='gear-modal-content' style='
                background: white;
                border-radius: 12px;
                padding: 24px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                max-width: 400px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
            '>
                <div class='gear-modal-header' style='
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #dee2e6;
                '>
                    <h4 style='margin: 0; color: #495057; font-size: 1.2rem;'>
                        <i class='fas fa-cog'></i> Opciones de Columna
                    </h4>
                    <button class='gear-modal-close' style='
                        background: none;
                        border: none;
                        font-size: 24px;
                        cursor: pointer;
                        color: #6c757d;
                        padding: 5px;
                    '>&times;</button>
                </div>
                <div class='gear-modal-body' style='
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                '>
                    ${baseOptions}
                    ${adminOptions}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Cerrar inmediato
        gearMenuJustOpened = true;
        setTimeout(() => { gearMenuJustOpened = false; }, 50); // Optimizado para hojas de cálculo
        
        // Event listeners para cerrar modal
        const closeModal = () => {
            document.body.removeChild(modal);
        };
        
        // Cerrar con botón X
        modal.querySelector('.gear-modal-close').addEventListener('click', closeModal);
        
        // Cerrar con clic fuera del modal
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // Cerrar con Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        return;
    }
    // En un icono de filtro de columna
    const filterIcon = safeEventTargetClosest(e, '.th-filter-icon');
    if (filterIcon) {
        e.stopPropagation();
        e.preventDefault();
        // Función segura unificada
        const icon = filterIcon;
        const colIdx = parseInt(icon.id.replace('th-filter-', ''));
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla && plantilla.campos[colIdx]) {
            const campo = plantilla.campos[colIdx];
            mostrarModalFiltrosPersonalizado(campo, colIdx);
        }
        return;
    }
    // Cerrar menús solo si no se acaba de abrir uno
    if (!gearMenuJustOpened) closeAllGearMenus();
}); 

function showDeleteFieldModal(colIdx) {
    // Prevenir eliminación de campos en modo compartido
    if (window.isSharedMode) {
        // Mostrar mensaje de error
        alert('Solo el administrador puede eliminar campos.');
        return;
    }
    
    closeAllGearMenus();
    // Limpiar cualquier modal anterior
    document.querySelectorAll('.delete-field-modal, .delete-field-confirm-modal').forEach(el => el.remove());
    // confirmación
    const modal = document.createElement('div');
    modal.className = 'delete-field-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.25)';
    modal.style.zIndex = 2200;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:260px;box-shadow:0 2px 16px #0002;text-align:center;border:2px solid #000;'>
            <h4>¿Seguro que quieres eliminar este campo?</h4>
            <div style='margin-top:18px;'>
                <button id='confirm-delete-field-btn' style='background:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Sí, eliminar</button>
                <button onclick='document.querySelectorAll(".delete-field-modal").forEach(el=>el.remove())' style='margin-left:10px;background:#6c757d;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Listener para cerrar al hacer clic fuera del modal
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Listener para confirmar
    modal.querySelector('#confirm-delete-field-btn').onclick = function() {
        modal.remove();
        showDeleteFieldFinalModal(colIdx);
    };
}

function showChangeFieldModal(colIdx) {
    // Prevenir cambio de campos en modo compartido
    if (window.isSharedMode) {
        // Mostrar mensaje de error
        alert('Solo el administrador puede cambiar campos.');
        return;
    }
    
    closeAllGearMenus();
    
    // Limpiar cualquier modal anterior
    document.querySelectorAll('.change-field-modal').forEach(el => el.remove());
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    const currentField = plantilla.campos[colIdx];
    const fieldNamesObj = optimizedFunctions.getStandardFieldNames();
    
    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'change-field-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.25)';
    modal.style.zIndex = 2200;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // Generar opciones de campos disponibles
    const fieldOptions = Object.entries(fieldNamesObj).map(([key, value]) => {
        const isSelected = key === currentField ? 'selected' : '';
        return `<option value="${key}" ${isSelected}>${value}</option>`;
    }).join('');
    
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:300px;box-shadow:0 2px 16px #0002;text-align:center;border:2px solid #000;'>
            <h4>Cambiar tipo de campo</h4>
            <p style='margin:10px 0;color:#666;'>Campo actual: <strong>${currentField}</strong></p>
            <div style='margin:20px 0;'>
                <label for='new-field-type'>Nuevo tipo de campo:</label><br>
                <select id='new-field-type' style='margin-top:8px;padding:8px;width:200px;border:1px solid #ddd;border-radius:4px;'>
                    ${fieldOptions}
                </select>
            </div>
            <div style='margin-top:18px;'>
                <button id='confirm-change-field-btn' style='background:#28a745;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:10px;'>Cambiar campo</button>
                <button onclick='document.querySelectorAll(".change-field-modal").forEach(el=>el.remove())' style='background:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Listener para cerrar al hacer clic fuera del modal
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Listener para confirmar el cambio
    modal.querySelector('#confirm-change-field-btn').onclick = function() {
        const newFieldType = modal.querySelector('#new-field-type').value;
        if (newFieldType === currentField) {
            document.querySelectorAll('.change-field-modal').forEach(el => el.remove());
            return;
        }
        
        
        changeFieldType(colIdx, currentField, newFieldType);
        document.querySelectorAll('.change-field-modal').forEach(el => el.remove());
    };
}
function changeFieldType(colIdx, oldFieldType, newFieldType) {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // Guardar estado
    saveUndoState('change_field_type', `Cambiar campo de ${oldFieldType} a ${newFieldType}`, []);
    
    // Actualizar campo
    plantilla.campos[colIdx] = newFieldType;
    
    // Actualizar plantilla en el backend
    fetch('/api/store/worksheet_templates', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        },
        body: JSON.stringify({
            id: plantilla.id,
            title: plantilla.titulo,
            fields: plantilla.campos
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Error actualizando estructura: ${response.status}`);
        }
        return response.json();
    })
    .then(() => {
        // Guardar datos
        return saveWorksheetData(plantilla);
    })
    .then(() => {
        showClipboardIndicator(`✅ Campo cambiado de ${oldFieldType} a ${newFieldType}`);
        
        // Actualizar plantillas
        const currentIdx = plantillas.findIndex(p => p.id === plantilla.id);
        if (currentIdx !== -1) {
            plantillas[currentIdx] = plantilla;
            mostrarTablaPlantilla(currentIdx, false);
        }
    })
    .catch((error) => {
        showClipboardIndicator('❌ Error al cambiar el campo');
        // Error al cambiar campo
    });
}

function showDeleteFieldFinalModal(colIdx) {
    // Limpiar cualquier modal anterior
    document.querySelectorAll('.delete-field-confirm-modal').forEach(el => el.remove());
    // Crear modal de confirmación
    const modal = document.createElement('div');
    modal.className = 'delete-field-confirm-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.25)';
    modal.style.zIndex = 2300;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:260px;box-shadow:0 2px 16px #0002;text-align:center;border:2px solid #000;'>
            <h4>Esta acción es irreversible.<br>¿Deseas continuar?</h4>
            <div style='margin-top:18px;'>
                <button id='final-delete-field-btn' style='background:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Sí, eliminar definitivamente</button>
                <button onclick='document.querySelectorAll(".delete-field-confirm-modal").forEach(el=>el.remove())' style='margin-left:10px;background:#6c757d;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Listener para cerrar al hacer clic fuera del modal
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Listener para confirmar eliminación definitiva
    modal.querySelector('#final-delete-field-btn').onclick = function() {
        modal.remove();
        // Eliminar el campo de la plantilla y de los datos
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        
        if (!plantilla || colIdx < 0 || colIdx >= plantilla.campos.length) {
            showClipboardIndicator('❌ Error: índice de campo inválido');
            return;
        }
        
        const campoEliminado = plantilla.campos[colIdx];
        
        // Eliminar campo de la plantilla
        plantilla.campos.splice(colIdx, 1);
        
        // Eliminar datos de todas las filas
        tablaDatos.forEach(fila => {
            if (fila.length > colIdx) {
                fila.splice(colIdx, 1);
            }
        });
        
        // Datos originales también
        if (plantilla.datosOriginales) {
            plantilla.datosOriginales.forEach(fila => {
                if (fila.length > colIdx) {
                    fila.splice(colIdx, 1);
                }
            });
        }
        
        plantilla.datos = tablaDatos;
        
        // NUEVO: Sincronizar con el array global de plantillas
        const plantillaIndex = plantillas.findIndex(p => p.id === plantilla.id);
        if (plantillaIndex !== -1) {
            plantillas[plantillaIndex] = plantilla;
        }
        
        // Actualizar la estructura en el backend antes de guardar datos
        // Actualizar plantilla en el backend
        fetch('/api/store/worksheet_templates', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify({ 
                id: plantilla.id, 
                title: plantilla.titulo,
                fields: plantilla.campos // Enviar campos actualizados
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error actualizando estructura: ${response.status}`);
            }
            return response.json();
        })
        .then(() => {
            // Guardar datos actualizados
            return saveWorksheetData(plantilla);
        })
        .then(() => {
            // Re-renderizar tabla completamente
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), document.getElementById('worksheetTableContainer'), plantillas.indexOf(plantilla));
            showClipboardIndicator(`✅ Campo "${campoEliminado}" eliminado completamente`);
        })
        .catch((error) => {
            // Mostrar mensaje pero re-renderizar de todos modos
            optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), document.getElementById('worksheetTableContainer'), plantillas.indexOf(plantilla));
            showClipboardIndicator(`❌ Error al eliminar campo: ${error?.message || 'Error desconocido'}`);
        });
    };
} 





// Con mejor gestión de memoria y debouncing
let undoStack = [];
let redoStack = [];
let maxUndoStates = 50;
let currentState = null;
let undoRedoDebounceTimer = null;
let lastUndoRedoTime = 0;
let renderCache = new Map();
let lastRenderTime = 0;

// Funciones para el historial
const ACTION_TYPES = {
    CELL_EDIT: 'cell-edit',
    ROW_DELETE: 'row-delete', 
    ROW_ADD: 'row-add',
    COLUMN_DELETE: 'column-delete',
    COLUMN_ADD: 'column-add',
    CELL_CLEAR: 'cell-clear',
    CELL_PASTE: 'cell-paste',
    CELL_CUT: 'cell-cut',
    BULK_EDIT: 'bulk-edit',
    TEXT_SPLIT: 'text-split'
};

// Con mejor rendimiento
function saveUndoState(actionType, description, affectedCells = []) {
    if (!tablaDatos || tablaDatos.length === 0) return;
    
    // Crear estado
    const state = {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        actionType: actionType,
        description: description,
        data: JSON.parse(JSON.stringify(tablaDatos)),
        plantillaId: getCurrentPlantilla()?.id,
        affectedCells: affectedCells,
        page: currentPage,
        mode: worksheetMode
    };
    
    // Detección más rápida de cambios
    if (currentState && JSON.stringify(state.data) === JSON.stringify(currentState.data)) {
        return;
    }
    
    // Guardar inmediatamente
    undoStack.push(state);
    if (undoStack.length > maxUndoStates) {
        undoStack.shift(); // Eliminar más antiguo
    }
    
    redoStack = []; // Limpiar redo con nueva acción
    currentState = state;
    
    // Procesar en background sin bloquear
    setTimeout(() => {
        try {
            const toSave = undoStack.slice(-10);
            localStorage.setItem('worksheetUndoHistory', JSON.stringify(toSave));
        } catch (e) {
            // ndo historial
        }
    }, 50);
}

// Función de deshacer optimizada para respuesta instantánea
function undoAction() {
    if (undoStack.length === 0) {
        showClipboardIndicator('❌ No hay acciones para deshacer');
        return;
    }
    
    // Guardar en redo antes de deshacer
    if (currentState) {
        redoStack.push(currentState);
    }
    
    // Obtener estado anterior
    const previousState = undoStack.pop();
    if (!previousState) return;
    
    try {
        // nterior inmediatamente
        tablaDatos = JSON.parse(JSON.stringify(previousState.data));
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        
        if (plantilla) {
            plantilla.datos = tablaDatos;
            
            // Asegurar que la página sea válida
            const totalRows = tablaDatos.length;
            const totalPages = rowsPerPage === 'todos' ? 1 : Math.ceil(totalRows / rowsPerPage);
            currentPage = Math.min(previousState.page || 1, totalPages);
            
            // Re-renderizar tabla usando cache para mejor rendimiento
            const container = document.getElementById('worksheetTableContainer');
            if (container) {
                // CORREGIDO: Guardar selecciones antes de re-renderizar
                const savedSelections = {
                    selectedCells: Array.from(selectedCells),
                    selectedRows: Array.from(selectedRows),
                    selectedColumns: Array.from(selectedColumns),
                    lastSelectedCell: lastSelectedCell
                };
                
                cachedRenderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, plantillas.indexOf(plantilla));
                
                // CORREGIDO: Restaurar selecciones después de re-renderizar
                setTimeout(() => {
                    selectedCells = new Set(savedSelections.selectedCells);
                    selectedRows = new Set(savedSelections.selectedRows);
                    selectedColumns = new Set(savedSelections.selectedColumns);
                    lastSelectedCell = savedSelections.lastSelectedCell;
                    updateSelectionDisplay();
                }, 50);
            }
            
            // Feedback inmediato con indicador visual
            showClipboardIndicator(`↶ Deshecho: ${previousState.description} (${undoStack.length} restantes)`);
            updateUndoRedoButtons();
            
            // Guardar en background sin bloquear la UI
            setTimeout(() => {
                saveWorksheetDataUnified(plantilla, { silent: true });
            }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
        }
        
        currentState = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    } catch (error) {
        showClipboardIndicator('❌ Error al deshacer la acción');
    }
}

// Función de rehacer optimizada para respuesta instantánea
function redoAction() {
    if (redoStack.length === 0) {
        showClipboardIndicator('❌ No hay acciones para rehacer');
        return;
    }
    
    // Obtener siguiente estado
    const nextState = redoStack.pop();
    if (!nextState) return;
    
    try {
        // Guardar en undo antes de rehacer
        if (currentState) {
            undoStack.push(currentState);
        }
        
        // nte inmediatamente
        tablaDatos = JSON.parse(JSON.stringify(nextState.data));
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        
        if (plantilla) {
            plantilla.datos = tablaDatos;
            
            // Asegurar que la página sea válida
            const totalRows = tablaDatos.length;
            const totalPages = rowsPerPage === 'todos' ? 1 : Math.ceil(totalRows / rowsPerPage);
            currentPage = Math.min(nextState.page || 1, totalPages);
            
            // Re-renderizar tabla usando cache para mejor rendimiento
            const container = document.getElementById('worksheetTableContainer');
            if (container) {
                // CORREGIDO: Guardar selecciones antes de re-renderizar
                const savedSelections = {
                    selectedCells: Array.from(selectedCells),
                    selectedRows: Array.from(selectedRows),
                    selectedColumns: Array.from(selectedColumns),
                    lastSelectedCell: lastSelectedCell
                };
                
                cachedRenderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, plantillas.indexOf(plantilla));
                
                // CORREGIDO: Restaurar selecciones después de re-renderizar
                setTimeout(() => {
                    selectedCells = new Set(savedSelections.selectedCells);
                    selectedRows = new Set(savedSelections.selectedRows);
                    selectedColumns = new Set(savedSelections.selectedColumns);
                    lastSelectedCell = savedSelections.lastSelectedCell;
                    updateSelectionDisplay();
                }, 50);
            }
            
            // Feedback inmediato con indicador visual
            showClipboardIndicator(`↷ Rehecho: ${nextState.description} (${redoStack.length} disponibles)`);
            updateUndoRedoButtons();
            
            // Guardar en background sin bloquear la UI
            setTimeout(() => {
                saveWorksheetDataUnified(plantilla, { silent: true });
            }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
        }
        
        currentState = nextState;
    } catch (error) {
        showClipboardIndicator('❌ Error al rehacer la acción');
    }
}

// NUEVO: Inicializar historial desde localStorage
function initializeUndoHistory() {
    try {
        const saved = localStorage.getItem('worksheetUndoHistory');
        if (saved) {
            const parsedHistory = JSON.parse(saved);
            if (Array.isArray(parsedHistory)) {
                undoStack = parsedHistory;
                currentState = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
            }
        }
    } catch (e) {
        // Error cargando historial
        undoStack = [];
        redoStack = [];
    }
    
    // NUEVO: Actualizar botones undo/redo al inicializar
    setTimeout(() => {
        updateUndoRedoButtons();
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
}

// saveWorksheetDataSilent - ahora se usa saveWorksheetDataUnified con { silent: true }

// Funciones legacy mejoradas para compatibilidad
function pushTablaUndo() {
    saveUndoState(ACTION_TYPES.BULK_EDIT, 'Cambio múltiple');
}

// NUEVO: Función de debouncing para undo/redo
function debouncedUndoRedo(action, minInterval = 100) {
    const now = Date.now();
    if (now - lastUndoRedoTime < minInterval) {
        // Cancelar timer anterior si existe
        if (undoRedoDebounceTimer) {
            clearTimeout(undoRedoDebounceTimer);
        }
        // Programar nueva ejecución
        undoRedoDebounceTimer = setTimeout(() => {
            action();
            lastUndoRedoTime = Date.now();
        }, minInterval - (now - lastUndoRedoTime));
        return;
    }
    
    // Ejecutar inmediatamente si ha pasado suficiente tiempo
    action();
    lastUndoRedoTime = now;
}

// NUEVO: Función para actualizar el estado visual de los botones undo/redo
function updateUndoRedoButtons() {
    // Buscar botones de undo/redo en la interfaz
    const undoButtons = document.querySelectorAll('[data-action="undo"]');
    const redoButtons = document.querySelectorAll('[data-action="redo"]');
    
    undoButtons.forEach(btn => {
        btn.disabled = undoStack.length === 0;
        btn.title = undoStack.length > 0 ? 
            `Deshacer (${undoStack.length} disponible${undoStack.length > 1 ? 's' : ''})` : 
            'No hay acciones para deshacer';
    });
    
    redoButtons.forEach(btn => {
        btn.disabled = redoStack.length === 0;
        btn.title = redoStack.length > 0 ? 
            `Rehacer (${redoStack.length} disponible${redoStack.length > 1 ? 's' : ''})` : 
            'No hay acciones para rehacer';
    });
}

// NUEVO: Función de cache para renderizado optimizado
function cachedRenderTablaEditable(plantilla, fieldNames, container, idx) {
    const cacheKey = `${plantilla.id}-${JSON.stringify(plantilla.datos)}-${worksheetMode}-${currentPage}`;
    const now = Date.now();
    
    // Cache válido por 500ms
    if (renderCache.has(cacheKey) && (now - lastRenderTime) < 500) {
        const cachedHtml = renderCache.get(cacheKey);
        
        // CORREGIDO: Preservar elementos del lado derecho al usar cache
        const existingScrollbar = container.querySelector('.table-responsive');
        const existingRightPanel = container.querySelector('.right-panel');
        
        const preservedElements = {
            scrollbar: existingScrollbar ? existingScrollbar.outerHTML : '',
            rightPanel: existingRightPanel ? existingRightPanel.outerHTML : ''
        };
        
        container.innerHTML = cachedHtml;
        
        // Restaurar elementos importantes si no están presentes
        if (preservedElements.scrollbar && !container.querySelector('.table-responsive')) {
            container.innerHTML += preservedElements.scrollbar;
        }
        if (preservedElements.rightPanel && !container.querySelector('.right-panel')) {
            container.innerHTML += preservedElements.rightPanel;
        }
        return;
    }
    
    // Renderizar normalmente y guardar en cache
    optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
    // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
    setTimeout(() => updateDuplicateStyles(plantilla), 100);
    
    // CORREGIDO: Guardar en cache incluyendo elementos preservados
    renderCache.set(cacheKey, container.innerHTML);
    lastRenderTime = now;
    
    // Limpiar cache antiguo (más de 10 entradas)
    if (renderCache.size > 10) {
        const firstKey = renderCache.keys().next().value;
        renderCache.delete(firstKey);
    }
}

function undoTabla() {
    // Con debouncing para evitar múltiples ejecuciones
    debouncedUndoRedo(() => undoAction(), 100); // Optimizado para hojas de cálculo
}

function redoTabla() {
    // Con debouncing para evitar múltiples ejecuciones
    debouncedUndoRedo(() => redoAction(), 100); // Optimizado para hojas de cálculo
}






let detailedChangesHistory = new Map(); // Historial de cambios detallado
const MAX_CHANGE_HISTORY = 10; // Mantener los últimos 10 cambios por celda

// Registrar valor anterior y usuario real (como Excel)
function recordDetailedChange(type, cellInfo, oldValue, newValue) {
    // Validar parámetros
    if (!cellInfo || !cellInfo.hasOwnProperty('row') || !cellInfo.hasOwnProperty('col')) {
        return;
    }
    
    // NUEVO: Registrar TODOS los cambios, incluyendo borrados
    // NO registrar si los valores son exactamente iguales
    if (oldValue === newValue) {
        // Sin cambios reales
        return;
    }
    
    // NUEVO: Determinar el tipo de cambio para mejor descripción
    let changeType = 'modificación';
    if (oldValue && oldValue !== '' && (newValue === '' || newValue === null || newValue === undefined)) {
        changeType = 'borrado';
    } else if ((oldValue === '' || oldValue === null || oldValue === undefined) && newValue && newValue !== '') {
        changeType = 'agregado';
    }
    
    // Obtener usuario actual con información completa (admin/usuario/anónimo+IP)
    const currentUser = getCurrentUser() || 'Usuario desconocido';
    
    // Manejar valores vacíos como Excel (sin mostrar "(vacío)")
    const displayOldValue = oldValue === '' || oldValue === null || oldValue === undefined ? '' : oldValue;
    
    const cellKey = `${cellInfo.row}-${cellInfo.col}`;
    
    const change = {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        oldValue: displayOldValue, // NUEVO: Valor vacío real, no "(vacío)"
        newValue: newValue === '' || newValue === null || newValue === undefined ? '' : newValue, // NUEVO: Valor nuevo
        changeType: changeType, // NUEVO: Tipo de cambio
        user: currentUser,
        cellKey: cellKey // Identificar la celda
    };
    
    // Procesar historial
    
    // NUEVO: Sistema de historial global combinado (máximo 10 cambios totales)
    // detailedChangesHistory es un Map (formato antiguo), convertirlo a array global
    if (detailedChangesHistory instanceof Map) {
        // Convertir Map a array
        const globalHistory = [];
        
        
        detailedChangesHistory.forEach((cellHistory, cellKey) => {
            cellHistory.forEach(change => {
                globalHistory.push({
                    ...change,
                    cellKey: cellKey
                });
            });
        });
        
        // Ordenar por timestamp (más reciente primero)
        globalHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Mantener solo los últimos 10 cambios globales
        const limitedHistory = globalHistory.slice(0, MAX_CHANGE_HISTORY);
        
        // Convertir detailedChangesHistory a array global
        detailedChangesHistory = limitedHistory;
        
        // Agregar el nuevo cambio
        detailedChangesHistory.unshift(change);
    }
    
    // Si detailedChangesHistory es un array, agregar el nuevo cambio
    if (Array.isArray(detailedChangesHistory)) {
        // Agregar nuevo cambio al inicio
        detailedChangesHistory.unshift(change);
        
        // Mantener solo los últimos 10 cambios globales
        if (detailedChangesHistory.length > MAX_CHANGE_HISTORY) {
            detailedChangesHistory.splice(MAX_CHANGE_HISTORY); // Eliminar elementos extra
        }
        
        // Guardar en localStorage
    } else {
        // Inicializar como array si no es ni Map ni array
        detailedChangesHistory = [change];
        // Guardar en localStorage
    }
    
    // Guardar en localStorage
    try {
        // Guardar historial detallado
        localStorage.setItem('worksheetDetailedHistory', JSON.stringify(detailedChangesHistory));
        // Historial guardado
    } catch (e) {
        // Error al guardar historial
    }
    
    // NUEVO: Sincronizar historial con el servidor
    syncHistoryToServer(change);
    
    // NOTA: Historial en localStorage + servidor (sincronizado)
    
}

// NUEVO: Función para sincronizar historial con el servidor
async function syncHistoryToServer(change) {
    try {
        const currentPlantilla = window.isSharedMode ? window.currentPlantilla : optimizedFunctions.getCurrentPlantilla();
        if (!currentPlantilla || !currentPlantilla.id) {
            // Sin plantilla válida
            return;
        }
        
        let url, headers = { 'Content-Type': 'application/json' };
        
        if (window.isSharedMode) {
            // Endpoint de historial con token
            if (!window.sharedToken) {
                // Sin token compartido
                return;
            }
            url = `/tienda/api/shared/worksheet/${currentPlantilla.id}/history?token=${window.sharedToken}`;
        } else {
            // Normal: usar endpoint de historial
            url = `/api/store/worksheet_history/${currentPlantilla.id}`;
            headers['X-CSRFToken'] = getCSRFToken();
        }
        
        const historyData = {
            change: change,
            full_history: detailedChangesHistory
        };
        
        // Enviar al servidor
        
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(historyData)
        });
        
        if (response.ok) {
            // Historial sincronizado
        } else {
            // Error al sincronizar historial
        }
    } catch (error) {
        // Error al sincronizar historial
    }
}

// NUEVO: Función para cargar historial desde el servidor
async function loadHistoryFromServer() {
    try {
        const currentPlantilla = window.isSharedMode ? window.currentPlantilla : optimizedFunctions.getCurrentPlantilla();
        if (!currentPlantilla || !currentPlantilla.id) {
            // Sin plantilla válida
            return;
        }
        
        let url, headers = { 'Content-Type': 'application/json' };
        
        if (window.isSharedMode) {
            // Endpoint de historial con token
            if (!window.sharedToken) {
                // Sin token compartido
                return;
            }
            url = `/tienda/api/shared/worksheet/${currentPlantilla.id}/history?token=${window.sharedToken}`;
        } else {
        // Admin: usar endpoint de historial
        url = `/api/store/worksheet_history/${currentPlantilla.id}`;
        headers['X-CSRFToken'] = getCSRFToken();
    }
    
    // Cargar historial del servidor
    
    const response = await fetch(url, {
        method: 'GET',
        headers: headers
    });
    
    if (response.ok) {
        const serverHistory = await response.json();
        
        if (serverHistory.history && Array.isArray(serverHistory.history)) {
            // Historial del servidor obtenido
            
            // Combinado
            // necesitamos combinarlo con el local para evitar duplicados
            const localHistory = detailedChangesHistory || [];
            const combinedHistory = [...localHistory, ...serverHistory.history];
                
                
                const uniqueHistory = combinedHistory.filter((change, index, self) => 
                    index === self.findIndex(c => c.id === change.id)
                );
                
                // Ordenar por timestamp (más reciente primero)
                uniqueHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                // Mantener solo los últimos 10 cambios
                detailedChangesHistory = uniqueHistory.slice(0, MAX_CHANGE_HISTORY);
                
                // Guardar en localStorage
                localStorage.setItem('worksheetDetailedHistory', JSON.stringify(detailedChangesHistory));
                
                // Historial combinado y guardado
            }
        } else {
            // Sin historial en el servidor
        }
    } catch (error) {
        // Error al cargar historial del servidor
    }
}

// Función para obtener el usuario actual (lógica unificada)
function getCurrentUser() {
    try {
        // Obtener información del usuario desde múltiples fuentes
        const isAdmin = window.isAdmin || false;
        const currentUsername = window.currentUsername || 
                               document.querySelector('meta[name="current_user"]')?.getAttribute('content') ||
                               sessionStorage.getItem('currentUsername') ||
                               localStorage.getItem('currentUsername') ||
                               'Usuario';
        
        // Formatear nombre
        if (currentUsername && currentUsername !== 'Usuario' && currentUsername !== '') {
            return isAdmin ? `admin (${currentUsername})` : currentUsername;
        }
        
        // En modo compartido y no está logueado, mostrar "Anónimo [IP]"
        if (window.isSharedMode) {
            const userIP = getUserIP();
            return `Anónimo [${userIP}]`;
        }
        
        // Para usuarios no logueados en modo normal
        return currentUsername || 'Usuario';
    } catch (e) {
        return 'Usuario';
    }
}

// NUEVO: Función para obtener la IP del usuario
function getUserIP() {
    // Intentar obtener IP almacenada por el backend
    if (window.userIP) {
        return window.userIP;
    }
    
    // Si no se puede obtener
    return 'IP no disponible';
}

// Sistema de presencia unificado
let presenceInterval = null;
let presenceSessionId = null;

// Función para inicializar el sistema de presencia (unificado para admin y compartido)
function initializePresenceSystem() {
    // Evitar inicialización múltiple
    if (presenceSessionId) {
        return;
    }
    
    // Generar session ID único
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const sessionType = window.isSharedMode ? 'shared' : 'admin';
    presenceSessionId = `${sessionType}_${timestamp}_${random}`;
    
    // Obtener worksheet_id
    const currentTemplate = getCurrentPlantilla();
    const worksheetId = currentTemplate?.id;
    
    if (!worksheetId) {
        return;
    }
    
    // Configurar endpoint y parámetros según el modo
    const endpoint = window.isSharedMode ? 
        `/api/shared/worksheet/${worksheetId}/presence` : 
        `/api/store/worksheet_presence/${worksheetId}`;
    
    const token = window.isSharedMode ? 
        new URLSearchParams(window.location.search).get('token') : null;
    
    // Presencia inicial
    updatePresence(worksheetId, endpoint, token, 'viewing');
    
    // configurar intervalo de presencia
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
    
    
    // Configurar eventos de página
    const handlerKey = window.isSharedMode ? 'sharedPresenceHandlerAdded' : 'adminPresenceHandlerAdded';
    if (!window[handlerKey]) {
        window.addEventListener('beforeunload', () => {
            updatePresence(worksheetId, endpoint, token, 'left');
        });
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                updatePresence(worksheetId, endpoint, token, 'left');
            } else {
                updatePresence(worksheetId, endpoint, token, 'viewing');
            }
        });
        
        window[handlerKey] = true;
    }
}

// Función unificada para actualizar presencia
function updatePresence(worksheetId, endpoint, token, action) {
    if (!presenceSessionId || !worksheetId) {
        return;
    }
    
    const url = token ? `${endpoint}?token=${token}` : endpoint;
    const headers = { 'Content-Type': 'application/json' };
    
    // Header CSRF para modo admin
    if (!window.isSharedMode) {
        headers['X-CSRFToken'] = getCSRFToken();
    }
    
    // Obtener el nombre del usuario actual
    const currentUser = getCurrentUser();
    
    fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            session_id: presenceSessionId,
            action: action,
            user: currentUser
        })
    })
    .then(response => response.json())
    .then(data => {
        // Silencioso
    })
    .catch(error => {
        // Silencioso
    });
}




// PRESENCIA UNIFICADO


// PASO 6: Código muerto eliminado

// PASO 6: Funciones obsoletas eliminadas para limpieza del código

// Inicialización ahora está consolidada en initializeAllSystems()
// Inicializar sistema completo al seleccionar template
const originalMostrarTablaPlantillaForActivity = mostrarTablaPlantilla;
mostrarTablaPlantilla = function(plantilla) {
    // Llamar función original
    originalMostrarTablaPlantillaForActivity(plantilla);
    
    // Inicializar sistemas adicionales
    if (plantilla && plantilla.id) {
        // Inicial
        setTimeout(() => {
            detectUserActivity('template_load');
        }, 500);
        
        // Actualización de viewers
        setTimeout(() => {
            // Optimización aplicada
        }, 1000);
    }
};

// NUEVO: SISTEMA DE DETECCIÓN DE ACTIVIDAD REAL


let lastActivityTime = 0;
let activityThrottleTimeout = null;

// Configurar prioridades
function detectUserActivity(activityType = 'interaction') {
    const currentTime = Date.now();
    
    // NUEVO: Prioridades de actividad
    const highPriorityActivities = ['page_refresh', 'page_load', 'page_visible', 'window_focus', 'tab_return'];
    const mediumPriorityActivities = ['cell_click', 'cell_edit', 'control_interaction'];
    const lowPriorityActivities = ['mouse_movement', 'page_scroll', 'table_scroll'];
    
    // Throttle inteligente basado en prioridad
    let throttleTime = 30000; // milisegundos por defecto
    
    if (highPriorityActivities.includes(activityType)) {
        throttleTime = 5000; // milisegundos para actividades de alta prioridad
    } else if (mediumPriorityActivities.includes(activityType)) {
        throttleTime = 15000; // milisegundos para actividades de prioridad media
    } else if (lowPriorityActivities.includes(activityType)) {
        throttleTime = 60000; // milisegundos para actividades de baja prioridad
    }
    
    // No enviar actividad si está dentro del throttle según la prioridad
    if (currentTime - lastActivityTime < throttleTime) {

        return;
    }
    
    const currentTemplate = getCurrentPlantilla();
    if (!currentTemplate || !currentTemplate.id) return;
    
    
    if (activityThrottleTimeout) {
        clearTimeout(activityThrottleTimeout);
    }
    
    // Debounce más rápido para actividades importantes
    const debounceTime = highPriorityActivities.includes(activityType) ? 100 : 250; // Optimizado para hojas de cálculo - reducido de 250/500 a 100/250
    
    // Debounce: esperar antes de enviar actividad
    activityThrottleTimeout = setTimeout(() => {
        sendUserActivity(currentTemplate.id, activityType);
        lastActivityTime = currentTime;

    }, debounceTime);
}

// NUEVO: Función helper para obtener prioridad de actividad
function getActivityPriority(activityType) {
    if (['page_refresh', 'page_load', 'page_visible', 'window_focus', 'tab_return'].includes(activityType)) {
        return 'alta';
    } else if (['cell_click', 'cell_edit', 'control_interaction'].includes(activityType)) {
        return 'media';
    } else {
        return 'baja';
    }
}

// Enviar actividad al backend con información adicional
function sendUserActivity(worksheetId, activityType) {
    // NUEVO: Información adicional para el backend
    const activityData = {
        activity_type: activityType,
        timestamp: Date.now(),
        user_agent: navigator.userAgent,
        url: window.location.href,
        referrer: document.referrer,
        screen_resolution: `${screen.width}x${screen.height}`,
        window_size: `${window.innerWidth}x${window.innerHeight}`,
        is_visible: !document.hidden,
        is_focused: document.hasFocus()
    };
    
    fetch(`/api/store/worksheet_activity/${worksheetId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        },
        body: JSON.stringify(activityData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {

        } else {

        }
    })
    .catch(error => {

    });
}

// Gestión de recursos (variables movidas al inicio)

// GESTIÓN DE TIMERS: Prevenir memory leaks
const timerManager = {
    timers: new Map(),
    intervals: new Map(),
    
    // setTimeout con auto-limpieza
    setTimeout(callback, delay, id = null) {
        const timerId = id || Date.now() + Math.random();
        
        // Limpiar timer anterior si existe
        if (this.timers.has(timerId)) {
            clearTimeout(this.timers.get(timerId));
        }
        
        const timer = setTimeout(() => {
            callback();
            this.timers.delete(timerId); 
        }, delay);
        
        this.timers.set(timerId, timer);
        return timerId;
    },
    
    // setInterval con auto-gestión
    setInterval(callback, delay, id = null) {
        const intervalId = id || Date.now() + Math.random();
        
        // Limpiar interval existente si existe
        if (this.intervals.has(intervalId)) {
            clearInterval(this.intervals.get(intervalId));
        }
        
        const interval = setInterval(callback, delay);
        this.intervals.set(intervalId, interval);
        return intervalId;
    },
    
    
    clearTimeout(id) {
        if (this.timers.has(id)) {
            clearTimeout(this.timers.get(id));
            this.timers.delete(id);
            return true;
        }
        return false;
    },
    
    // clearInterval específico
    clearInterval(id) {
        if (this.intervals.has(id)) {
            clearInterval(this.intervals.get(id));
            this.intervals.delete(id);
            return true;
        }
        return false;
    },
    
    // clearAll (cleanup)
    clearAll() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.intervals.forEach(interval => clearInterval(interval));
        this.timers.clear();
        this.intervals.clear();

    },
    
    
    getStatus() {
        return {
            activeTimeouts: this.timers.size,
            activeIntervals: this.intervals.size,
            timeoutIds: Array.from(this.timers.keys()),
            intervalIds: Array.from(this.intervals.keys())
        };
    }
};

// PREVENCIÓN: Prevenir llamadas duplicadas
const debounceManager = {
    debounces: new Map(),
    
    // debounce con ID específico
    debounce(func, wait, id) {
        // Cancelar debounce anterior si existe
        if (this.debounces.has(id)) {
            clearTimeout(this.debounces.get(id));
        }
        
        const timeout = setTimeout(() => {
            func();
            this.debounces.delete(id); 
        }, wait);
        
        this.debounces.set(id, timeout);
        return id;
    },
    
    // cancelar debounce específico
    cancel(id) {
        if (this.debounces.has(id)) {
            clearTimeout(this.debounces.get(id));
            this.debounces.delete(id);
            return true;
        }
        return false;
    },
    
    // limpiar todos los debounces
    clearAll() {
        this.debounces.forEach(timeout => clearTimeout(timeout));
        this.debounces.clear();

    }
};

// Funciones + Plantillas
const domCache = {
    cache: new Map(),
    
    // obtener elemento con cache
    get(id) {
        if (!this.cache.has(id)) {
            const element = document.getElementById(id);
            if (element) {
                this.cache.set(id, element);
            }
            return element;
        }
        
        // verificar que el elemento sigue en el DOM
        const cached = this.cache.get(id);
        if (cached && !document.contains(cached)) {
            this.cache.delete(id);
            return document.getElementById(id);
        }
        
        return cached;
    },
    
    // invalidar cache específico
    invalidate(id) {
        this.cache.delete(id);
    },
    
    // limpiar todo el cache
    clearAll() {
        this.cache.clear();

    },
    
    
    getStatus() {
        return {
            cachedElements: this.cache.size,
            elementIds: Array.from(this.cache.keys())
        };
    }
};

// OPTIMIZACIONES: Evitar recálculos costosos
const functionCache = {
    cache: new Map(),
    
    // set con TTL (Time To Live)
    set(key, value, ttl = 30000) { 
        this.cache.set(key, {
            value,
            expires: Date.now() + ttl
        });
        return value;
    },
    
    // obtener del cache con validación de expiración
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() > cached.expires) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.value;
    },
    
    // limpiar entradas expiradas
    cleanup() {
        const now = Date.now();
        for (const [key, cached] of this.cache.entries()) {
            if (now > cached.expires) {
                this.cache.delete(key);
            }
        }
    },
    
    
    getStatus() {
        return {
            cachedFunctions: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    },
    
    
    clearAll() {
        this.cache.clear();

    }
};

// PLANTILLAS: Optimizar getCurrentPlantilla y indexOf
const plantillaCache = {
    currentPlantilla: null,
    currentPlantillaIndex: -1,
    plantillaIndexMap: new Map(),
    lastUpdate: 0,
    
    // cuando cambie la plantilla
    updateCurrentPlantilla(plantilla) {
        this.currentPlantilla = plantilla;
        this.lastUpdate = Date.now();
        
        // actualizar índice si tenemos el array de plantillas
        if (window.plantillas && Array.isArray(window.plantillas)) {
            this.currentPlantillaIndex = window.plantillas.indexOf(plantilla);
            
            // reconstruir índices para futuras búsquedas
            this.rebuildIndexMap();
        }
        

    },
    
    // reconstruir mapa de índices para búsquedas O(1)
    rebuildIndexMap() {
        this.plantillaIndexMap.clear();
        if (window.plantillas && Array.isArray(window.plantillas)) {
            window.plantillas.forEach((plantilla, index) => {
                if (plantilla && plantilla.id) {
                    this.plantillaIndexMap.set(plantilla.id, index);
                }
            });
        }
    },
    
    // Obtener plantilla actual (optimizado)
    getCurrentPlantilla() {
        // Función original para evitar recursión
        const originalFunction = window._originalGetCurrentPlantilla || 
                               (typeof window.getCurrentPlantilla === 'function' ? window.getCurrentPlantilla : null);
        
        if (originalFunction) {
            const fresh = originalFunction();
            if (fresh !== this.currentPlantilla) {
                this.updateCurrentPlantilla(fresh);
            }
            return fresh;
        }
        
        return this.currentPlantilla;
    },
    
    // Obtener índice optimizado (O(1) en lugar de O(n))
    getPlantillaIndex(plantilla) {
        if (!plantilla) return -1;
        
        // Actualizar plantilla actual, retornar índice cacheado
        if (plantilla === this.currentPlantilla && this.currentPlantillaIndex !== -1) {
            return this.currentPlantillaIndex;
        }
        
        // Usar índices si está disponible
        if (plantilla.id && this.plantillaIndexMap.has(plantilla.id)) {
            return this.plantillaIndexMap.get(plantilla.id);
        }
        
        // indexOf solo si es necesario
        if (window.plantillas && Array.isArray(window.plantillas)) {
            const index = window.plantillas.indexOf(plantilla);
            if (index !== -1 && plantilla.id) {
                this.plantillaIndexMap.set(plantilla.id, index);
            }
            return index;
        }
        
        return -1;
    },
    
    
    clearAll() {
        this.currentPlantilla = null;
        this.currentPlantillaIndex = -1;
        this.plantillaIndexMap.clear();
        this.lastUpdate = 0;

    },
    
    
    getStatus() {
        return {
            hasCurrentPlantilla: !!this.currentPlantilla,
            currentIndex: this.currentPlantillaIndex,
            indexMapSize: this.plantillaIndexMap.size,
            lastUpdate: new Date(this.lastUpdate).toLocaleTimeString()
        };
    }
};

// FUNCIONES OPTIMIZADAS: Reemplazos con cache para funciones problemáticas
const optimizedFunctions = {
    
    // getCurrentPlantilla optimizado (80+ llamadas → cache)
    getCurrentPlantilla() {
        return plantillaCache.getCurrentPlantilla();
    },
    
    // getStandardFieldNames optimizado (23+ llamadas → cache)
    getStandardFieldNames() {
        // NUEVO: Crear clave de cache que incluya el modo actual
        const currentMode = worksheetMode || 'standard';
        const cacheKey = `standardFieldNames_${currentMode}`;
        
        const cached = functionCache.get(cacheKey);
        if (cached) return cached;
        
        // Función original para evitar recursión
        const originalFunction = window._originalGetStandardFieldNames || 
                               (typeof window.getStandardFieldNames === 'function' ? window.getStandardFieldNames : null);
        
        const result = originalFunction ? 
                      originalFunction() : 
                      {
                          'numero': 'Número',
                          'fecha': 'Fecha',
                          'informacion-adicional': 'Información adicional',
                          'observaciones': 'Observaciones'
                      };
        
        return functionCache.set(cacheKey, result, 60000); // cache por modo
    },
    
    // plantillas.indexOf optimizado (12+ llamadas → O(1))
    getPlantillaIndex(plantilla) {
        return plantillaCache.getPlantillaIndex(plantilla);
    },
    
    // renderTablaEditable con cache inteligente optimizado (PASO 1)
    renderTablaEditable(plantilla, fieldNames, container, idx) {
        // Validaciones básicas
        if (!plantilla || !container) return;
        
        // Clave única para cache basada en contenido real
        const dataHash = this._generateDataHash(plantilla);
        const cacheKey = `render_${plantilla.id || 'none'}_${dataHash}_${currentPage}_${rowsPerPage}_${worksheetMode}`;
        
        // Verificar si ya está en cache y es válido
        const cachedHtml = renderCache.get(cacheKey);
        const isValid = this._isCacheValid(plantilla, dataHash);
        
        
        if (cachedHtml && isValid) {
            container.innerHTML = cachedHtml;
            this._attachEventListeners(container, plantilla, fieldNames, idx);
            return;
        }
        
        // Si no hay cache, renderizar inmediatamente la primera vez
        if (!cachedHtml) {
            this._renderImmediately(plantilla, fieldNames, container, idx, cacheKey, dataHash);
            return;
        }
        
        // Solo usar debounce cuando NO hay cache (para evitar múltiples renders consecutivos)
        const renderFunction = () => {
            try {
                // Usar container cacheado si es posible
                const targetContainer = typeof container === 'string' ? 
                                      domCache.get(container) : 
                                      container;
                
                if (!targetContainer) return;
            
                // Función original para evitar recursión
                const originalFunction = window._originalRenderTablaEditable || 
                                       (typeof window.renderTablaEditable === 'function' ? window.renderTablaEditable : null);
                
                if (originalFunction) {
                    originalFunction(
                        plantilla, 
                        fieldNames || optimizedFunctions.getStandardFieldNames(), 
                        targetContainer, 
                        idx !== undefined ? idx : optimizedFunctions.getPlantillaIndex(plantilla)
                    );
                    
                    // Guardar en cache después del render
                    renderCache.set(cacheKey, targetContainer.innerHTML);
                    // Guardar hash para validación futura
                    renderCache.set(`hash_${plantilla.id || 'none'}`, dataHash);
                }
                
            } catch (error) {
                console.error('Error en renderTablaEditable optimizado:', error);
            }        
        };
        
        // Ejecutar inmediatamente para operaciones en tiempo real
        renderFunction();
    },
    
    // Generar hash de datos para detectar cambios
    _generateDataHash(plantilla) {
        if (!plantilla || !plantilla.datos) return 'no-data';
        
        // Hash simple basado en datos y campos
        const dataStr = JSON.stringify(plantilla.datos.slice(0, 10)); // Solo primeras 10 filas para performance
        const fieldsStr = JSON.stringify(plantilla.campos);
        return btoa(dataStr + fieldsStr).substring(0, 16);
    },
    
    // Verificar si el cache es válido
    _isCacheValid(plantilla, currentHash) {
        const lastHash = renderCache.get(`hash_${plantilla.id || 'none'}`);
        // Si no hay hash guardado, considerar válido si es la primera vez
        if (!lastHash) {
            return true;
        }
        return lastHash === currentHash;
    },
    
    // Renderizar inmediatamente sin debounce (primera vez)
    _renderImmediately(plantilla, fieldNames, container, idx, cacheKey, dataHash) {
        try {
            // Usar container cacheado si es posible
            const targetContainer = typeof container === 'string' ? 
                                  domCache.get(container) : 
                                  container;
            
            if (!targetContainer) return;
        
            // Función original para evitar recursión
                const originalFunction = window._originalRenderTablaEditable || 
                                       (typeof window.renderTablaEditable === 'function' ? window.renderTablaEditable : null);
                
                if (originalFunction) {
                    originalFunction(
                        plantilla, 
                        fieldNames || optimizedFunctions.getStandardFieldNames(), 
                        targetContainer, 
                        idx !== undefined ? idx : optimizedFunctions.getPlantillaIndex(plantilla)
                    );
                
                // Guardar en cache después del render
                renderCache.set(cacheKey, targetContainer.innerHTML);
                // Guardar hash para validación futura
                renderCache.set(`hash_${plantilla.id || 'none'}`, dataHash);
                }
                
            } catch (error) {
            console.error('Error en renderTablaEditable inmediato:', error);
        }
    },
    
    // Adjuntar event listeners después del render
    _attachEventListeners(container, plantilla, fieldNames, idx) {
        // Re-attach event listeners necesarios
        this._attachPaginationListeners(container, plantilla, fieldNames, idx);
        this._attachSearchListeners(container, plantilla, fieldNames, idx);
        this._attachModeListeners(container, plantilla, fieldNames, idx);
    },
    
    // Adjuntar listeners de paginación (PASO 5: Usando sistema de eventos unificado)
    _attachPaginationListeners(container, plantilla, fieldNames, idx) {
        const btnPrev = container.querySelector('#btnPrevPage');
        const btnNext = container.querySelector('#btnNextPage');
        const rowsSelect = container.querySelector('#rowsPerPageSelect');
        
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (currentPage > 1) {
                    saveCurrentPage(currentPage - 1);
                    optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
                }
            });
        }
        
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const { totalPages } = calculatePagination(plantilla.datos || []);
                if (currentPage < totalPages) {
                    saveCurrentPage(currentPage + 1);
                    optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
                }
            });
        }
        
        if (rowsSelect) {
            rowsSelect.addEventListener('change', () => {
                const val = rowsSelect.value === 'todos' ? 'todos' : parseInt(rowsSelect.value);
                rowsPerPage = val;
                saveCurrentPage(1);
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            });
        }
    },
    
    // Adjuntar listeners de búsqueda (PASO 5: Usando sistema de eventos unificado)
    _attachSearchListeners(container, plantilla, fieldNames, idx) {
        const searchInput = container.querySelector('#mainSearchInput');
        const clearBtn = container.querySelector('#clearMainSearch');
        
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim();
                if (query) {
                    filtrarFilasTabla(query, plantilla, fieldNames, container, idx);
                } else {
                    optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
                }
            });
        }
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            });
        }
    },
    
    // Adjuntar listeners de modo (PASO 5: Usando sistema de eventos unificado)
    _attachModeListeners(container, plantilla, fieldNames, idx) {
        const modeSelect = container.querySelector('#modeSelect');
        
        if (modeSelect) {
            modeSelect.addEventListener('change', () => {
                const newMode = modeSelect.value;
                if (newMode !== worksheetMode) {
                    worksheetMode = newMode;
                    localStorage.setItem('worksheetMode', worksheetMode);
                    
                    // Invalidar cache cuando cambie el modo
                    if (optimizedFunctions.invalidateAll) {
                        optimizedFunctions.invalidateAll();
                    }
                    
                    optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
                }
            });
        }
    },
    
    // invalidar caches cuando sea necesario
    invalidateAll() {
        functionCache.clearAll();
        plantillaCache.clearAll();
        domCache.clearAll();
        renderCache.clear();
        duplicateStylesCache.clear();
    },
    
    // obtener estadísticas
    getOptimizationStatus() {
        return {
            domCache: domCache.getStatus(),
            functionCache: functionCache.getStatus(),
            plantillaCache: plantillaCache.getStatus(),
            timerManager: timerManager.getStatus(),
            debounceManager: { active: debounceManager.debounces.size },
            renderCache: { size: renderCache.size, hits: 0, misses: 0 }
        };
    },
    
};

const optimizedLogger = {
    isProduction: true, // en producción
    logLevel: 'ERROR', // DEBUG, INFO, WARN, ERROR
    logCount: 0,
    maxLogsPerSecond: 50,
    lastSecond: 0,
    
    // configurar modo producción
    setProduction(isProduction) {
        this.isProduction = isProduction;
        if (isProduction) {
            this.logLevel = 'WARN'; // solo warnings y errores en producción
        }
    },
    
    // throttling para logs
    shouldLog() {
        const currentSecond = Math.floor(Date.now() / 1000);
        if (currentSecond !== this.lastSecond) {
            this.logCount = 0;
            this.lastSecond = currentSecond;
        }
        
        return this.logCount++ < this.maxLogsPerSecond;
    },
    
    // log por categorías
    log(message, data = null, level = 'DEBUG') {
        if (this.isProduction && level === 'DEBUG') return;
        if (!this.shouldLog()) return;
        
        const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        const currentLevel = levels[this.logLevel] || 0;
        const messageLevel = levels[level] || 0;
        
        if (messageLevel >= currentLevel) {
            const prefix = level === 'ERROR' ? '❌' : 
                          level === 'WARN' ? '⚠️' : 
                          level === 'INFO' ? 'ℹ️' : '🔍';
            
            if (data) {
                console.log(`${prefix} [${level}] ${message}`, data);
            } else {
                console.log(`${prefix} [${level}] ${message}`);
            }
        }
    },
    
    // métodos de conveniencia
    debug(message, data) { this.log(message, data, 'DEBUG'); },
    info(message, data) { this.log(message, data, 'INFO'); },
    warn(message, data) { this.log(message, data, 'WARN'); },
    error(message, data) { this.log(message, data, 'ERROR'); }
};

// INTERCEPTORES: Redirigir llamadas problemáticas a versiones optimizadas
const functionInterceptors = {
    installed: false,
    
    // instalar interceptores para optimizar automáticamente
    install() {
        if (this.installed) {
            // ya instalado
            return;
        }
        
        // guardar funciones originales PRIMERO, antes de cualquier modificación
        if (typeof window.getCurrentPlantilla === 'function') {
            window._originalGetCurrentPlantilla = window.getCurrentPlantilla;
        }
        if (typeof window.getStandardFieldNames === 'function') {
            window._originalGetStandardFieldNames = window.getStandardFieldNames;
        }
        if (typeof window.renderTablaEditable === 'function') {
            window._originalRenderTablaEditable = window.renderTablaEditable;
        }
        
        // reemplazar con versiones optimizadas
        if (window._originalGetCurrentPlantilla) {
            window.getCurrentPlantilla = () => optimizedFunctions.getCurrentPlantilla();
        }
        if (window._originalGetStandardFieldNames) {
            window.getStandardFieldNames = () => optimizedFunctions.getStandardFieldNames();
        }
        if (window._originalRenderTablaEditable) {
            window.renderTablaEditable = (plantilla, fieldNames, container, idx) => {
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
            // CORREGIDO: Aplicar estilos de duplicados después de renderizar la tabla
            setTimeout(() => updateDuplicateStyles(plantilla), 100);
            };
        }
        
        this.installed = true;

    },
    
    uninstall() {
        if (!this.installed) return;
        
        // restaurar funciones originales
        if (window._originalGetCurrentPlantilla) {
            window.getCurrentPlantilla = window._originalGetCurrentPlantilla;
        }
        if (window._originalGetStandardFieldNames) {
            window.getStandardFieldNames = window._originalGetStandardFieldNames;
        }
        if (window._originalRenderTablaEditable) {
            window.renderTablaEditable = window._originalRenderTablaEditable;
        }
        
        this.installed = false;

    },
    
    // NUEVO: Función helper para instalar interceptores de forma segura
    safeInstall() {
        try {
            // verificar que las funciones originales existen
            if (typeof window.getCurrentPlantilla !== 'function') {
                // no hay función original
                return false;
            }
            
            // instalar interceptores
            this.install();
            
            // verificar que no hay recursión haciendo una prueba
            try {
                const testResult = window.getCurrentPlantilla();
                // prueba exitosa
                return true;
            } catch (error) {
                // hay recursión, desinstalar
                this.uninstall();
                return false;
            }
            
        } catch (error) {
            // error general
            return false;
        }
    }
};

// Unificado de detección de actividad SIN DUPLICACIÓN
function setupActivityDetection() {
    // Prevenir duplicación de event listeners
    if (activityDetectionSetup) {

        return;
    }
    activityDetectionSetup = true;
    
    // CONSOLIDADO: Un solo listener para clicks (evita conflictos)
    document.addEventListener('click', function(event) {
        if (!isValidEventTarget(event)) return;
        
        // Click en celdas (prioridad alta)
        const cell = safeEventTargetClosest(event, 'td[data-row-index]');
        if (cell) {
            detectUserActivity('cell_click');
            return; // Evento manejado
        }
        
        // Interacción con controles (prioridad baja)
        const isControl = safeEventTargetClosest(event, '.btn, .form-control, select, input[type="checkbox"], input[type="radio"]');
        if (isControl) {
            detectUserActivity('control_interaction');
        }
    });
    
    // click de celdas
    document.addEventListener('mousedown', function(event) {
        if (!isValidEventTarget(event)) return;
        
        const cell = safeEventTargetClosest(event, 'td[data-row-index]');
        if (cell) {
            detectUserActivity('cell_select');
        }
    });
    
    // click de celdas
    document.addEventListener('input', function(event) {
        const input = safeEventTarget(event);
        if (!input) return;
        
        const isInTableCell = safeClosest(input, 'td[data-row-index]');
        if (isInTableCell || (input.classList && input.classList.contains('cell-input'))) {
            detectUserActivity('cell_edit');
        }
    });
    
    // Detectar actividad con teclado (incluye F5 y más teclas)
    document.addEventListener('keydown', function(event) {
        const activeElement = document.activeElement;
        if (!activeElement) return;
        
        // Detectar refresh de página
        if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
            detectUserActivity('page_refresh');
            return;
        }
        
        // navegación
        const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Escape', 'Home', 'End', 'PageUp', 'PageDown'];
        if (navigationKeys.includes(event.key)) {
                detectUserActivity('keyboard_navigation');
            }
        
        // teclas de edición
        const editKeys = ['Delete', 'Backspace', 'Insert'];
        if (editKeys.includes(event.key)) {
            detectUserActivity('keyboard_edit');
        }
    });
    
    // NUEVO: Detectar movimiento del mouse
    document.addEventListener('mousemove', debounce(function(event) {
        if (!isValidEventTarget(event)) return;
        
        // controles
        const tableContainer = safeEventTargetClosest(event, '.table-responsive, .worksheet-controls, .btn, .form-control');
        if (tableContainer) {
            detectUserActivity('mouse_movement');
        }
    }, 500)); // Optimizado para hojas de cálculo - reducido de 1000ms a 500ms
    
    // NUEVO: Detectar scroll en tabla y página
    document.addEventListener('scroll', function(event) {
        if (!isValidEventTarget(event)) return;
        
        const tableContainer = safeEventTargetClosest(event, '.table-responsive');
        if (tableContainer) {
            detectUserActivity('table_scroll');
        } else {
            // general de la página
            detectUserActivity('page_scroll');
        }
    }, { passive: true });
    
    // NUEVO: Detectar cuando la página se vuelve visible (después de F5)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            detectUserActivity('page_visible');
        }
    });
    
    // NUEVO: Detectar cuando la ventana se enfoca
    window.addEventListener('focus', function() {
        detectUserActivity('window_focus');
    });
    
    // NUEVO: Detectar cuando el usuario regresa a la pestaña
    window.addEventListener('blur', function() {
        detectUserActivity('window_blur');
    });
    
    // NUEVO: Detectar cuando el usuario regresa a la pestaña desde otra pestaña
    let lastBlurTime = 0;
    window.addEventListener('blur', function() {
        lastBlurTime = Date.now();
    });
    
    window.addEventListener('focus', function() {
        const timeSinceBlur = Date.now() - lastBlurTime;
        if (timeSinceBlur > 1000) { // Solo si ha pasado más de 1 segundo
            detectUserActivity('tab_return');
        }
    });
    
    // NUEVO: Detectar cuando la página se carga completamente
    window.addEventListener('load', function() {
        detectUserActivity('page_load');
    });
    
    // NUEVO: Detectar cuando el DOM está listo
    document.addEventListener('DOMContentLoaded', function() {
        detectUserActivity('dom_ready');
    });
    
    
}

// Información adicional SIN DUPLICACIÓN
function setupInfoAdicionalDelegatedListeners() {
    // Prevenir duplicación de event listeners
    if (infoAdicionalListenersSetup) {

        return;
    }
    infoAdicionalListenersSetup = true;
    
    // Nota: Un solo listener en el contenedor para manejar todos los campos info-adicional
    const worksheetContainer = document.getElementById('worksheetTableContainer');
    if (!worksheetContainer) {

        return;
    }
    
    // Event delegado para keydown (Enter)
    worksheetContainer.addEventListener('keydown', function(e) {
        if (!isValidEventTarget(e)) return;
        
        const target = e.target;
        if (target && target.classList && target.classList.contains('cell-info-adicional') && e.key === 'Enter') {
            e.preventDefault();
            
            // obtener índices de fila y columna del elemento
            const parentCell = safeClosest(target, 'td');
            if (parentCell) {
                const rowIndex = parseInt(parentCell.getAttribute('data-row-index'));
                const colIndex = parseInt(parentCell.getAttribute('data-col-index'));
                
                if (!isNaN(rowIndex) && !isNaN(colIndex)) {
                    const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
                    const valor = currentPlantilla && currentPlantilla.datos[rowIndex] ? 
                                  currentPlantilla.datos[rowIndex][colIndex] || '' : '';
                    showInfoModal(rowIndex, colIndex, valor);
                }
            }
        }
    });
    
    // obtener delegado para focus
    worksheetContainer.addEventListener('focus', function(e) {
        if (!isValidEventTarget(e)) return;
        
        const target = e.target;
        if (target && target.classList && target.classList.contains('cell-info-adicional')) {
            const parentCell = safeClosest(target, 'td');
            if (parentCell) {
                const rowIndex = parseInt(parentCell.getAttribute('data-row-index'));
                const colIndex = parseInt(parentCell.getAttribute('data-col-index'));
                
                if (!isNaN(rowIndex) && !isNaN(colIndex)) {
                    // navegación
                    lastSelectedCell = { row: rowIndex, col: colIndex };
                    selectionStartCell = { row: rowIndex, col: colIndex };
                    clearAllSelections();
                    addCellToSelection(rowIndex, colIndex);
                }
            }
        }
    }, true); 
    
    // obtener delegado para click
    worksheetContainer.addEventListener('click', function(e) {
        if (!isValidEventTarget(e)) return;
        
        const target = e.target;
        if (target && target.classList && target.classList.contains('cell-info-adicional')) {
            e.preventDefault();
            e.stopPropagation();
            
            
            target.focus();
            
            const parentCell = safeClosest(target, 'td');
            if (parentCell) {
                const rowIndex = parseInt(parentCell.getAttribute('data-row-index'));
                const colIndex = parseInt(parentCell.getAttribute('data-col-index'));
                
                if (!isNaN(rowIndex) && !isNaN(colIndex)) {
                    // actualizar de la celda activa inmediatamente
                    lastSelectedCell = { row: rowIndex, col: colIndex };
                    selectionStartCell = { row: rowIndex, col: colIndex };
                    clearAllSelections();
                    addCellToSelection(rowIndex, colIndex);
                    
                    // mantener el foco
                    setTimeout(() => {
                        target.focus();
                    }, 50);
                }
            }
        }
    });
    
    
}

// NUEVO: Función para reconectar el sistema de presencia en caso de problemas
function reconnectAdminPresence() {
    const currentTemplate = getCurrentPlantilla();
    if (currentTemplate && currentTemplate.id && adminSessionId) {

        
        // limpiar intervalos existentes
        if (adminPresenceInterval) {
            clearInterval(adminPresenceInterval);
            adminPresenceInterval = null;
        }
        // adminViewersUpdateInterval (código muerto)
        
        // inicializar con nueva sesión
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        adminSessionId = `admin_reconnect_${timestamp}_${random}`;
        
        // nueva presencia
        updateAdminPresence(currentTemplate.id, 'viewing');
        
        
        // adminViewersUpdateInterval (código muerto)

    }
}

// PASO 6: Optimización aplicada
window.reconnectAdminPresence = reconnectAdminPresence;

// PASO 6: Código muerto eliminado

async function loadChangesHistory() {
    
    try {
        const saved = localStorage.getItem('worksheetDetailedHistory');

        
        if (saved) {
            const parsed = JSON.parse(saved);

            
            // NUEVO: Manejar array global (formato nuevo)
            if (Array.isArray(parsed)) {
                detailedChangesHistory = parsed;
    
            } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // Convertir Map antiguo a array global

                const globalHistory = [];
                
                Object.entries(parsed).forEach(([cellKey, cellHistory]) => {
                    if (Array.isArray(cellHistory)) {
                        cellHistory.forEach(change => {
                            globalHistory.push({
                                ...change,
                                cellKey: cellKey
                            });
                        });
                    }
                });
                
                // Ordenar por timestamp (más reciente primero)
                globalHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                // Mantener solo los últimos 10 cambios
                detailedChangesHistory = globalHistory.slice(0, MAX_CHANGE_HISTORY);

            } else {

                detailedChangesHistory = [];
            }
        } else {
    
            detailedChangesHistory = [];
        }
        
        // NUEVO: Cargar historial desde el servidor para sincronizar
        await loadHistoryFromServer();
        
    } catch (e) {

        detailedChangesHistory = [];
    }
    
}

async function showChangesHistory(selection = null) {
    
    
    // Procesars
    if (!selection || !selection.cells || selection.cells.length === 0) {

        alert('Selecciona una celda para ver su historial de cambios');
        return;
    }
    
    
    await loadChangesHistory();
    
    // NOTA: Historial solo desde localStorage (sin base de datos)
    
    // configurado
    const selectedCellKeys = selection.cells;
    
    
    let changesToShow = [];
    
    // NUEVO: Filtrar historial global por celdas seleccionadas
    if (Array.isArray(detailedChangesHistory)) {
        detailedChangesHistory.forEach(change => {
            // no hay celdas seleccionadas específicas
            // Procesars si las hay
            if (selectedCellKeys.length === 0 || selectedCellKeys.includes(change.cellKey)) {
                if (change.oldValue !== '') { // Solo si tiene valor
                    changesToShow.push(change);
                }
        }
    });
    }
    
    // Ordenar por timestamp (más reciente primero)
    changesToShow.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    
    const recentChanges = changesToShow.slice(0, MAX_CHANGE_HISTORY);
    

    
    let filterInfo = `Historial global combinado (máximo 10 cambios totales)`;
    if (selectedCellKeys.length > 0) {
        filterInfo += ` • Filtrado por ${selectedCellKeys.length} celda${selectedCellKeys.length > 1 ? 's' : ''} seleccionada${selectedCellKeys.length > 1 ? 's' : ''}`;
    }
    
    // NUEVO: Crear overlay para mejor experiencia de cierre
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '1999';
    overlay.style.cursor = 'pointer';
    
    const modal = document.createElement('div');
    modal.className = 'changes-modal';
    modal.style.position = 'fixed';
    modal.style.top = '20px';
    modal.style.left = '50%';
    modal.style.transform = 'translateX(-50%)';
    modal.style.background = '#fff';
    modal.style.border = '2px solid #007bff';
    modal.style.borderRadius = '10px';
    modal.style.padding = '20px';
    modal.style.zIndex = '2000';
    modal.style.minWidth = '320px';
    modal.style.maxWidth = '95vw';
    modal.style.maxHeight = '90vh';
    modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
    modal.style.overflow = 'hidden';
    
    // NUEVO: Media queries CSS para dispositivos móviles
    const mobileStyles = `
        @media (max-width: 768px) {
            .changes-modal {
                top: 10px !important;
                left: 50% !important;
                transform: translateX(-50%) !important;
                min-width: 280px !important;
                max-width: 98vw !important;
                padding: 15px !important;
                max-height: 95vh !important;
            }
            .changes-modal h4 {
                font-size: 16px !important;
                margin-bottom: 10px !important;
            }
            .changes-modal .summary-box {
                padding: 8px !important;
                font-size: 12px !important;
            }
            .changes-modal .content-area {
                max-height: 300px !important;
            }
            .changes-modal .action-buttons {
                flex-direction: column !important;
                gap: 8px !important;
            }
            .changes-modal .action-buttons button {
                width: 100% !important;
                min-width: auto !important;
                height: 36px !important;
                font-size: 13px !important;
                padding: 8px 12px !important;
            }
        }
        
        @media (max-width: 480px) {
            .changes-modal {
                top: 5px !important;
                min-width: 260px !important;
                max-width: 99vw !important;
                padding: 12px !important;
                max-height: 98vh !important;
            }
            .changes-modal h4 {
                font-size: 15px !important;
                margin-bottom: 8px !important;
            }
            .changes-modal .summary-box {
                padding: 6px !important;
                font-size: 11px !important;
            }
            .changes-modal .content-area {
                max-height: 250px !important;
            }
            .changes-modal .action-buttons button {
                height: 32px !important;
                font-size: 12px !important;
                padding: 6px 10px !important;
            }
        }
    `;
    
    
    const styleSheet = document.createElement('style');
    styleSheet.textContent = mobileStyles;
    document.head.appendChild(styleSheet);
    

    
    // Generar HTML con información detallada de cambios
    const changesHtml = recentChanges.length === 0 ? 
        `<div style="text-align:center;padding:40px;color:#666;">📭 No hay cambios registrados en la${selectedCellKeys.length > 1 ? 's' : ''} celda${selectedCellKeys.length > 1 ? 's' : ''} seleccionada${selectedCellKeys.length > 1 ? 's' : ''}</div>` :
        recentChanges.map(change => {
            const date = new Date(change.timestamp);
            const timeStr = date.toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
            const dateStr = date.toLocaleDateString('es-ES', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
            
            // NUEVO: Determinar icono y color según el tipo de cambio
            let changeIcon = '✏️';
            let changeColor = '#333';
            let changeText = change.oldValue;
            
            if (change.changeType === 'borrado') {
                changeIcon = '🗑️';
                changeColor = '#dc3545';
                changeText = `${change.oldValue} → (borrado)`;
            } else if (change.changeType === 'agregado') {
                changeIcon = '➕';
                changeColor = '#28a745';
                changeText = `(vacío) → ${change.newValue || change.oldValue}`;
            } else if (change.newValue !== undefined) {
                changeText = `${change.oldValue} → ${change.newValue}`;
            }
            
            return `
                <div class="change-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #eee;">
                    <div style="flex:1;font-family:monospace;font-size:13px;color:${changeColor};">
                        ${changeIcon} ${changeText} <span style="color:#999;font-size:11px;">(${change.cellKey})</span>
                    </div>
                    <div style="margin-left:15px;font-size:11px;color:#666;white-space:nowrap;">
                        ${dateStr} ${timeStr} - ${change.user}
                    </div>
                </div>
            `;
        }).join('');

    modal.innerHTML = `
        <div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:8px;border-bottom:2px solid #007bff;'>
            <h4 style='margin:0;color:#007bff;font-size:18px;'>📋 Historial de cambios</h4>
            <button id='btnCerrarHistorial' style='background:none;border:none;font-size:20px;color:#999;cursor:pointer;'>✕</button>
        </div>
        
        <div class='summary-box' style='margin-bottom:15px;padding:10px;background:#f0f7ff;border-radius:6px;border:1px solid #007bff;'>
            <div style='font-size:14px;color:#0066cc;margin-bottom:5px;'><strong>Últimos 10 cambios</strong></div>
            <div style='font-size:12px;color:#666;'>
                ${filterInfo} • Incluye borrados, agregados y modificaciones
            </div>
        </div>
        
        <div class='content-area' style='max-height:400px;overflow-y:auto;border:1px solid #ddd;border-radius:6px;'>
            ${changesHtml}
        </div>
        
        <div class='action-buttons' style='margin-top:15px;text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;'>
            ${!window.isSharedMode ? `
            <button id='btnLimpiarHistorial' style='background:#dc3545;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;min-width:140px;height:40px;font-size:14px;display:inline-flex;align-items:center;justify-content:center;'>
                🗑️ Limpiar historial
            </button>
            ` : ''}
            <button id='btnCerrarHistorialFooter' style='background:#dc3545;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;min-width:140px;height:40px;font-size:14px;display:inline-flex;align-items:center;justify-content:center;'>
                Cerrar
            </button>
        </div>
    `;
    
    // sin animación
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
    
    // NUEVO: Animación de entrada
    overlay.style.opacity = '0';
    modal.style.opacity = '0';
    modal.style.transform = 'translateX(-50%) translateY(-20px)';
    
    setTimeout(() => {
        overlay.style.transition = 'opacity 0.3s ease';
        modal.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        overlay.style.opacity = '1';
        modal.style.opacity = '1';
        modal.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    // Event listeners con cierre de overlay y animación
    let closeModal = () => {
        // NUEVO: Animación de salida
        overlay.style.transition = 'opacity 0.2s ease';
        modal.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        overlay.style.opacity = '0';
        modal.style.opacity = '0';
        modal.style.transform = 'translateX(-50%) translateY(-20px)';
        
        setTimeout(() => {
            modal.remove();
            overlay.remove();
        }, 200);
    };
    
    document.getElementById('btnCerrarHistorial').onclick = closeModal;
    document.getElementById('btnCerrarHistorialFooter').onclick = closeModal;
    
    // NUEVO: Solo agregar event listener para limpiar si el botón existe (modo admin)
    const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
    if (btnLimpiarHistorial) {
        btnLimpiarHistorial.onclick = () => {
        if (confirm('¿Estás seguro de que quieres limpiar todo el historial de cambios?')) {
                clearHistoryFromServer();
        }
    };
    }
    

    
    // NUEVO: Hover effects para elementos del historial
    modal.querySelectorAll('.change-item').forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.background = '#f8f9fa';
        });
        item.addEventListener('mouseleave', function() {
            this.style.background = '';
        });
    });
    
    
    let isModalOpen = true;
    
    // Cerrar al hacer clic en el modal (solo si es el modal mismo, no su contenido)
    modal.addEventListener('click', function(e) {
        if (e.target === modal && isModalOpen) {
            closeModal();
        }
    });
    
    // Manejar Escape
    const escapeHandler = function(e) {
        if (e.key === 'Escape' && isModalOpen) {
            closeModal();
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Activar el overlay (con delay para evitar cierre inmediato)
    setTimeout(() => {
        overlay.addEventListener('click', function() {
            if (isModalOpen) {
                closeModal();
            }
        });
    }, 200);
    
    // Función closeModal para limpiar event listeners y estilos
    let originalCloseModal = closeModal;
    closeModal = () => {
        if (!isModalOpen) return; 
        isModalOpen = false;
        
        // Remover event listeners
        document.removeEventListener('keydown', escapeHandler);
        
        // Animación de salida
        overlay.style.transition = 'opacity 0.2s ease';
        modal.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        overlay.style.opacity = '0';
        modal.style.opacity = '0';
        modal.style.transform = 'translateX(-50%) translateY(-20px)';
        
        setTimeout(() => {
            modal.remove();
            overlay.remove();
            // NUEVO: Limpiar estilos CSS agregados
            if (styleSheet && styleSheet.parentNode) {
                styleSheet.parentNode.removeChild(styleSheet);
            }
        }, 200);
    };
}





// NUEVO: Agregar estilos CSS requeridos para animaciones
function addRequiredStyles() {
    if (!document.getElementById('worksheet-animations')) {
        const styles = document.createElement('style');
        styles.id = 'worksheet-animations';
        styles.textContent = `
            @keyframes pulse-highlight {
                0% { background-color: #fff; }
                50% { background-color: #ffeb3b; box-shadow: 0 0 10px rgba(255, 235, 59, 0.8); }
                100% { background-color: #fff; }
            }
            
            @keyframes pulse-restore {
                0% { background-color: #fff; }
                50% { background-color: #4caf50; box-shadow: 0 0 15px rgba(76, 175, 80, 0.8); }
                100% { background-color: #fff; }
            }
            
            .search-match-subtle {
                background-color: rgba(255, 235, 59, 0.3) !important;
                border: 1px solid rgba(255, 193, 7, 0.5) !important;
            }
            
            /* Estilos para formato rápido */
            .format-bold {
                font-weight: bold !important;
            }
            
            .format-underline {
                text-decoration: underline !important;
            }
        `;
        document.head.appendChild(styles);
    }
}

// NUEVO: Persistencia de posición en plantillas
function restoreTemplatePosition() {
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    try {
        const savedPosition = localStorage.getItem(`templatePosition_${plantilla.id}`);
        if (savedPosition) {
            const position = JSON.parse(savedPosition);
            
            // Restaurar página guardada
            if (position.page && position.page <= Math.ceil(tablaDatos.length / rowsPerPage)) {
                currentPage = position.page;
                localStorage.setItem('worksheetCurrentPage', currentPage);
            }
            
            // Restaurar posición de scroll
            const container = document.querySelector('.table-responsive');
            if (container && position.scrollTop !== undefined) {
                setTimeout(() => {
                    container.scrollTop = position.scrollTop;
                    container.scrollLeft = position.scrollLeft || 0;
                }, 200);
            }
        }
    } catch (e) {
        // guardando posición de plantilla
    }
}


function highlightCell(row, col) {
    if (row === undefined || col === undefined) return;
    
    const cell = getCellElement(row, col);
    if (cell) {
        // Función segura para evitar errores
        const td = safeClosest(cell, 'td');
        if (td) {
            
                try {
            td.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center', 
                inline: 'center' 
            });
                } catch (error) {
            
                }
            
            // nte
            td.style.animation = 'pulse-highlight 2s ease-in-out';
            setTimeout(() => {
                td.style.animation = '';
            }, 2000);
        }
    }
}
// PASO 6: Funciones restauradas
function showContextMenu(x, y) {
    hideContextMenu();
    
    const selection = getSelectionInfo();
    


    
    if (!selection.hasSelection) {

        return;
    }
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'contextMenu';
    
    let menuItems = [];
    
    // sin persistencia
    if (!window.frozenColumns) {
        window.frozenColumns = new Set();
        
        const savedFrozen = localStorage.getItem('worksheetFrozenColumns');
        if (savedFrozen) {
            try {
                const frozenArray = JSON.parse(savedFrozen);
                frozenArray.forEach(colIndex => window.frozenColumns.add(colIndex));
            } catch (e) {
        // configurar frozen columns
            }
        }
    }
    
    // determinar qué opciones mostrar según la selección
    // en modo readonly compartido, mostrar solo opciones permitidas
    const isReadonlyShared = window.isSharedMode && window.isReadonly;
    
    if (selection.columns.length > 0) {
        // Menú de columnas sin opción de fijar (funcionalidad removida)
        if (isReadonlyShared) {
            menuItems = [
                { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' }
            ];
        } else if (window.isSharedMode) {
            // NUEVO: Modo compartido - sin opciones de limpieza
            menuItems = [
                { icon: 'fas fa-palette', text: 'Formato rápido', action: 'format' },
                { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' },
                { icon: 'fas fa-columns', text: 'Dividir texto', action: 'split-text' },
                { separator: true },
                { icon: 'fas fa-undo', text: 'Deshacer', action: 'undo' },
                { icon: 'fas fa-redo', text: 'Rehacer', action: 'redo' }
            ];
        } else {
        menuItems = [
            { icon: 'fas fa-eraser', text: 'Limpiar columna', action: 'clear-column' },
            { separator: true },
            { icon: 'fas fa-palette', text: 'Formato rápido', action: 'format' },
            { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' },
            { icon: 'fas fa-columns', text: 'Dividir texto', action: 'split-text' },
            { separator: true },
            { icon: 'fas fa-undo', text: 'Deshacer', action: 'undo' },
            { icon: 'fas fa-redo', text: 'Rehacer', action: 'redo' }
        ];
        }
    } else if (selection.rows.length > 0) {
        // selección de filas
        if (isReadonlyShared) {
            menuItems = [
                { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' }
            ];
        } else if (window.isSharedMode) {
            // NUEVO: Modo compartido - sin opciones de limpieza
            menuItems = [
                { icon: 'fas fa-palette', text: 'Formato rápido', action: 'format' },
                { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' },
                { icon: 'fas fa-columns', text: 'Dividir texto', action: 'split-text' },
                { separator: true },
                { icon: 'fas fa-undo', text: 'Deshacer', action: 'undo' },
                { icon: 'fas fa-redo', text: 'Rehacer', action: 'redo' }
            ];
        } else {
        menuItems = [
            { icon: 'fas fa-eraser', text: 'Limpiar fila', action: 'clear-row' },
            { separator: true },
            { icon: 'fas fa-palette', text: 'Formato rápido', action: 'format' },
            { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' },
            { icon: 'fas fa-columns', text: 'Dividir texto', action: 'split-text' },
            { separator: true },
            { icon: 'fas fa-undo', text: 'Deshacer', action: 'undo' },
            { icon: 'fas fa-redo', text: 'Rehacer', action: 'redo' }
        ];
        }
    } else {
        // click de celdas con opción de fijar también
        const cellKeys = Array.from(selectedCells);
        let colIndex = null;
        if (cellKeys.length === 1) {
            colIndex = parseInt(cellKeys[0].split('-')[1]);
        }
        
        if (isReadonlyShared) {
            menuItems = [
                { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' }
            ];
        } else {
        menuItems = [
            { icon: 'fas fa-eraser', text: 'Limpiar celda', action: 'clear-cell' },
            { separator: true }
        ];
        
        // NOTA: Funcionalidad de fijar campos removida según solicitud del usuario
        
        menuItems.push(
            { icon: 'fas fa-palette', text: 'Formato rápido', action: 'format' },
            { icon: 'fas fa-search', text: 'Buscar y reemplazar', action: 'search-replace' },
            { icon: 'fas fa-columns', text: 'Dividir texto', action: 'split-text' },
            { separator: true },
            { icon: 'fas fa-undo', text: 'Deshacer', action: 'undo' },
            { icon: 'fas fa-redo', text: 'Rehacer', action: 'redo' },
            { separator: true },
            { icon: 'fas fa-history', text: 'Mostrar cambios', action: 'show-changes' }
        );
        }
    }
    
    // elementos del menú
    menuItems.forEach(item => {
        if (item.separator) {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        } else {
            const menuItem = document.createElement('button');
            menuItem.className = 'context-menu-item';
            menuItem.innerHTML = `<i class="${item.icon}"></i>${item.text}`;
            menuItem.addEventListener('click', () => {
                executeContextAction(item.action);
                hideContextMenu();
            });
            menu.appendChild(menuItem);
        }
    });
    
    // crear el menú
    document.body.appendChild(menu);
    
    // verificar si se sale de la pantalla
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 10;
    }
    if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 10;
    }
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    // cerrar al hacer clic fuera
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
}

function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) {
        menu.remove();
    }
}

// NUEVO: Función específica para ocultar el menú de selección de filas
function hideRowSelectionContextMenu() {
    const menu = document.getElementById('rowSelectionContextMenu');
    if (menu) {
        menu.remove();
    }
}

function executeContextAction(action) {
    const selection = getSelectionInfo();
    
    
    // definir acciones de limpieza en modo compartido
    if (window.isSharedMode && (action === 'clear-cell' || action === 'clear-row' || action === 'clear-column')) {

        alert('Solo el administrador puede limpiar contenido.');
        return;
    }
    
    switch (action) {
        case 'clear-cell':
            clearCells(selection.cells);
            break;
        case 'clear-row':
            clearRows(selection.rows);
            break;
        case 'clear-column':
            clearColumns(selection.columns);
            break;
        case 'format':
            showFormatMenu();
            break;
        case 'search-replace':
            showSearchReplaceDialog();
            break;
        case 'split-text':
            splitTextAcrossColumns();
            break;
        case 'undo':
            undoTabla();
            break;
        case 'redo':
            redoTabla();
            break;
        case 'show-changes':
            showChangesHistory(selection);
            break;

    }
}


// NUEVA: Función para limpiar historial desde el servidor (SOLO ADMIN)
async function clearHistoryFromServer() {
    // en modo admin
    if (window.isSharedMode) {

        alert('Solo el administrador puede limpiar el historial.');
        return;
    }
    
    try {
        const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
        if (!currentPlantilla || !currentPlantilla.id) {
    
            return;
        }
        
        const url = `/api/store/worksheet_history/${currentPlantilla.id}`;
        const headers = { 
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken()
        };
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: headers
        });
        
        if (response.ok) {
            const result = await response.json();
    
            
            // en el localStorage
            detailedChangesHistory = [];
            localStorage.removeItem('worksheetDetailedHistory');
            
            
            const modal = document.querySelector('.changes-modal');
            const overlay = document.querySelector('.changes-modal').previousElementSibling;
            if (modal && overlay) {
                modal.remove();
                overlay.remove();
            }
            
            showClipboardIndicator('🗑️ Historial limpiado completamente');
        } else {
    
            alert('Error al limpiar el historial. Inténtalo de nuevo.');
        }
    } catch (error) {

        alert('Error al limpiar el historial. Inténtalo de nuevo.');
    }
}



// NUEVA: Función para fijar/desfijar columnas
function toggleFreezeColumn(columnIndices) {
    if (columnIndices.length === 0) return;
    
    columnIndices.forEach(colIndex => {
        // NOTA: Lógica de fijar/desfijar campos removida
    });
    
    // NOTA: Funcionalidad de fijar campos removida por completo
}

// Funciones de acción del menú contextual
function clearCells(cellKeys) {
    pushTablaUndo();
    
    // NUEVO: Registrar cada celda borrada en el historial
    cellKeys.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const oldValue = tablaDatos[row] && tablaDatos[row][col] ? tablaDatos[row][col] : '';
        
        // contenido
        if (oldValue && oldValue !== '') {
            recordDetailedChange('clear', { row, col }, oldValue, '');
        }
        
        const input = getCellElement(row, col);
        if (input) {
            input.value = '';
            tablaDatos[row][col] = '';
        }
    });
    
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (plantilla) {
        plantilla.datos = tablaDatos;
        saveWorksheetData(plantilla);
    }
}

function clearRows(rowIndices) {
    pushTablaUndo();
    
    // NUEVO: Registrar cada celda borrada en el historial
    rowIndices.forEach(rowIndex => {
        if (tablaDatos[rowIndex]) {
            tablaDatos[rowIndex].forEach((cellValue, colIndex) => {
                // ntenido
                if (cellValue && cellValue !== '') {
                    recordDetailedChange('clear_row', { row: rowIndex, col: colIndex }, cellValue, '');
                }
            });
            tablaDatos[rowIndex] = tablaDatos[rowIndex].map(() => '');
        }
    });
    
    // inputs visibles
    rowIndices.forEach(rowIndex => {
        const row = document.querySelector(`#worksheetTable tr[data-row-index="${rowIndex}"]`);
        if (row) {
            const inputs = row.querySelectorAll('input');
            inputs.forEach(input => {
                input.value = '';
            });
        }
    });
    
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (plantilla) {
        plantilla.datos = tablaDatos;
        saveWorksheetData(plantilla);
    }
}

function clearColumns(columnIndices) {
    pushTablaUndo();
    
    // NUEVO: Registrar cada celda borrada en el historial
    columnIndices.forEach(colIndex => {
        tablaDatos.forEach((row, rowIndex) => {
            if (row[colIndex] !== undefined) {
                const oldValue = row[colIndex];
                // ntenido
                if (oldValue && oldValue !== '') {
                    recordDetailedChange('clear_column', { row: rowIndex, col: colIndex }, oldValue, '');
                }
                row[colIndex] = '';
            }
        });
    });
    
    // inputs visibles
    columnIndices.forEach(colIndex => {
        const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"] input`);
        cells.forEach(input => {
            input.value = '';
        });
    });
    
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (plantilla) {
        plantilla.datos = tablaDatos;
        saveWorksheetData(plantilla);
    }
}

function showFormatMenu() {
    const selection = getSelectionInfo();
    if (!selection.hasSelection) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '2000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // finales
    const backgroundColors = [
        { color: '#ffffff', name: 'Blanco' },
        { color: '#fff3cd', name: 'Amarillo claro' },
        { color: '#ffeaa7', name: 'Amarillo' },
        { color: '#fdcb6e', name: 'Naranja claro' },
        { color: '#e17055', name: 'Naranja' },
        { color: '#d63031', name: 'Rojo' },
        { color: '#f8d7da', name: 'Rosa claro' },
        { color: '#fd79a8', name: 'Rosa' },
        { color: '#a29bfe', name: 'Púrpura' },
        { color: '#6c5ce7', name: 'Violeta' },
        { color: '#d1ecf1', name: 'Azul claro' },
        { color: '#74b9ff', name: 'Azul' },
        { color: '#00cec9', name: 'Turquesa' },
        { color: '#d4edda', name: 'Verde claro' },
        { color: '#55a3ff', name: 'Verde' },
        { color: '#00b894', name: 'Verde oscuro' }
    ];
    
    const textColors = [
        { color: '#000000', name: 'Negro' },
        { color: '#636e72', name: 'Gris' },
        { color: '#dc3545', name: 'Rojo' },
        { color: '#e17055', name: 'Naranja' },
        { color: '#fdcb6e', name: 'Amarillo' },
        { color: '#00b894', name: 'Verde' },
        { color: '#00cec9', name: 'Turquesa' },
        { color: '#0984e3', name: 'Azul' },
        { color: '#6c5ce7', name: 'Púrpura' },
        { color: '#fd79a8', name: 'Rosa' },
        { color: '#a29bfe', name: 'Lavanda' },
        { color: '#ffffff', name: 'Blanco' }
    ];
    
    modal.innerHTML = `
        <style>
            @media (max-width: 768px) {
                .format-modal-content {
                    padding: 15px !important;
                    min-width: 280px !important;
                    max-width: 98vw !important;
                }
                .format-modal-content h4 {
                    font-size: 18px !important;
                    margin-bottom: 15px !important;
                }
                .format-modal-content h5 {
                    font-size: 13px !important;
                    margin-bottom: 8px !important;
                }
                .format-btn {
                    font-size: 13px !important;
                    padding: 6px 10px !important;
                }
                .color-swatch {
                    width: 30px !important;
                    height: 30px !important;
                }
                .custom-color-input {
                    width: 30px !important;
                    height: 22px !important;
                }
                .custom-color-btn {
                    font-size: 10px !important;
                    padding: 3px 6px !important;
                }
                .action-buttons {
                    gap: 6px !important;
                }
                .action-buttons button {
                    padding: 6px 10px !important;
                    font-size: 13px !important;
                }
            }
        </style>
        <div class="format-modal-content" style='background:#fff;padding:20px;border-radius:10px;min-width:320px;max-width:95vw;box-shadow:0 4px 20px rgba(0,0,0,0.15);max-height:90vh;overflow-y:auto;'>
            <h4 style='margin-bottom:20px;color:#333;text-align:center;'>Formato rápido</h4>
            
            <div style='margin-bottom:20px;'>
                <h5 style='margin-bottom:10px;color:#555;font-size:14px;'>Estilo de texto:</h5>
                <div style='display:flex;gap:8px;flex-wrap:wrap;'>
                    <button class='format-btn' data-format='bold' style='padding:8px 12px;border:2px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-weight:bold;transition:all 0.2s;font-size:14px;'>
                        <i class='fas fa-bold'></i> Negrita
                    </button>
                    <button class='format-btn' data-format='underline' style='padding:8px 12px;border:2px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;text-decoration:underline;transition:all 0.2s;font-size:14px;'>
                        <i class='fas fa-underline'></i> Subrayado
                    </button>
                </div>
            </div>
            
            <div style='margin-bottom:20px;'>
                <h5 style='margin-bottom:10px;color:#555;font-size:14px;'>Color de fondo:</h5>
                <div style='display:grid;grid-template-columns:repeat(auto-fit, minmax(35px, 1fr));gap:6px;max-width:100%;margin-bottom:10px;'>
                    ${backgroundColors.map(bg => `
                        <button class='format-btn color-swatch' data-format='bg-color' data-color='${bg.color}' 
                                style='width:35px;height:35px;border:2px solid #ddd;border-radius:6px;background:${bg.color};cursor:pointer;position:relative;transition:all 0.2s;'
                                title='${bg.name}'>
                            ${bg.color === '#ffffff' ? '<i class="fas fa-times" style="color:#ccc;font-size:12px;"></i>' : ''}
                        </button>
                    `).join('')}
                </div>
                <div style='display:flex;align-items:center;gap:6px;flex-wrap:wrap;'>
                    <label for='customBgColor' style='font-size:12px;color:#666;'>Color personalizado:</label>
                    <input type='color' id='customBgColor' name='customBgColor' class='custom-color-input' style='width:35px;height:25px;border:1px solid #ddd;border-radius:4px;cursor:pointer;'>
                    <button class='format-btn custom-color-btn' data-format='custom-bg' style='padding:4px 8px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;font-size:11px;' aria-label='Aplicar color de fondo personalizado'>
                        <i class='fas fa-palette'></i> Aplicar
                    </button>
                </div>
            </div>
            
            <div style='margin-bottom:20px;'>
                <h5 style='margin-bottom:10px;color:#555;font-size:14px;'>Color de texto:</h5>
                <div style='display:grid;grid-template-columns:repeat(auto-fit, minmax(35px, 1fr));gap:6px;max-width:100%;margin-bottom:10px;'>
                    ${textColors.map(txt => `
                        <button class='format-btn color-swatch' data-format='text-color' data-color='${txt.color}' 
                                style='width:35px;height:35px;border:2px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;position:relative;transition:all 0.2s;color:${txt.color};display:flex;align-items:center;justify-content:center;'
                                title='${txt.name}'>
                            <i class="fas fa-font" style="font-size:12px;"></i>
                        </button>
                    `).join('')}
                </div>
                <div style='display:flex;align-items:center;gap:6px;flex-wrap:wrap;'>
                    <label for='customTextColor' style='font-size:12px;color:#666;'>Color personalizado:</label>
                    <input type='color' id='customTextColor' name='customTextColor' class='custom-color-input' style='width:35px;height:25px;border:1px solid #ddd;border-radius:4px;cursor:pointer;'>
                    <button class='format-btn custom-color-btn' data-format='custom-text' style='padding:4px 8px;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;cursor:pointer;font-size:11px;' aria-label='Aplicar color de texto personalizado'>
                        <i class='fas fa-font'></i> Aplicar
                    </button>
                </div>
            </div>
            
            <div class='action-buttons' style='display:flex;gap:8px;justify-content:center;flex-wrap:wrap;'>
                <button id='btnLimpiarFormato' class='btn-panel btn-red' style='padding:8px 12px;font-size:14px;'>
                    <i class='fas fa-eraser'></i> Limpiar formato
                </button>
                <button id='btnCancelarFormato' class='btn-panel btn-red' style='padding:8px 12px;font-size:14px;'>Cancelar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // eventos a los botones de formato
    const formatBtns = modal.querySelectorAll('.format-btn');
    formatBtns.forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.style.borderColor = '#2196f3';
            if (!this.classList.contains('color-swatch')) {
            this.style.transform = 'scale(1.05)';
            }
        });
        btn.addEventListener('mouseleave', function() {
            this.style.borderColor = '#ddd';
            if (!this.classList.contains('color-swatch')) {
            this.style.transform = 'scale(1)';
            }
        });
        btn.addEventListener('click', function() {
            const format = this.getAttribute('data-format');
            const color = this.getAttribute('data-color');
            
            if (format === 'bg-color' && color) {
                applyBackgroundColor(color, selection);
                modal.remove();
            } else if (format === 'text-color' && color) {
                applyTextColor(color, selection);
                modal.remove();
            } else if (format === 'custom-bg') {
                const customColor = modal.querySelector('#customBgColor').value;
                applyBackgroundColor(customColor, selection);
                modal.remove();
            } else if (format === 'custom-text') {
                const customColor = modal.querySelector('#customTextColor').value;
                applyTextColor(customColor, selection);
                modal.remove();
            } else {
                applyFormat(format, selection);
                modal.remove();
            }
        });
    });
    
    
    modal.querySelector('#btnLimpiarFormato').addEventListener('click', function() {
        clearFormat(selection);
        modal.remove();
    });
    
    // cancelar
    modal.querySelector('#btnCancelarFormato').addEventListener('click', function() {
        modal.remove();
    });
    
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Borrado con persistencia y registros en historial (función segura)
function applyBackgroundColor(color, selection) {
    
    saveUndoState(ACTION_TYPES.BULK_EDIT, `Aplicar color de fondo ${color}`, selection.cells);
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // inicializar formato si no existe
    if (!plantilla.formato) {
        plantilla.formato = {};
    }
    
    // Procesars
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cell = getCellElement(row, col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
                td.style.setProperty('background-color', color, 'important');
                cell.style.setProperty('background-color', color, 'important');
                td.setAttribute('data-custom-bg', color);
                cell.setAttribute('data-custom-bg', color);
                
                // NUEVO: Guardar formato en plantilla para persistencia
                const cellId = `${row}-${col}`;
                if (!plantilla.formato[cellId]) {
                    plantilla.formato[cellId] = {};
                }
                plantilla.formato[cellId].backgroundColor = color;

            }
        }
    });
    
    // Procesars
    selection.rows.forEach(rowIndex => {
        const cells = document.querySelectorAll(`#worksheetTable tr[data-row-index="${rowIndex}"] td`);
        cells.forEach((td, colIndex) => {
            td.style.setProperty('background-color', color, 'important');
            td.setAttribute('data-custom-bg', color);
            const input = td.querySelector('input');
            if (input) {
                input.style.setProperty('background-color', color, 'important');
                input.setAttribute('data-custom-bg', color);
            }
            
            // NUEVO: Guardar formato para toda la fila
            const cellId = `${rowIndex}-${colIndex}`;
            if (!plantilla.formato[cellId]) {
                plantilla.formato[cellId] = {};
            }
            plantilla.formato[cellId].backgroundColor = color;
        });
    });
    
    // nas seleccionadas
    selection.columns.forEach(colIndex => {
        const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
        cells.forEach(td => {
            // Función segura para evitar errores en modo compartido
            const tr = safeClosest(td, 'tr');
            const rowIndex = tr ? parseInt(tr.getAttribute('data-row-index')) : -1;
            if (rowIndex >= 0) {
            td.style.setProperty('background-color', color, 'important');
            td.setAttribute('data-custom-bg', color);
            const input = td.querySelector('input');
            if (input) {
                input.style.setProperty('background-color', color, 'important');
                input.setAttribute('data-custom-bg', color);
            }
            
            // NUEVO: Guardar formato para toda la columna
            const cellId = `${rowIndex}-${colIndex}`;
            if (!plantilla.formato[cellId]) {
                plantilla.formato[cellId] = {};
            }
            plantilla.formato[cellId].backgroundColor = color;
            }
        });
    });
    
    // Guardar plantilla con formato (sin actualizar duplicados para evitar movimiento)
    const dataToSave = {
        template_id: plantilla.id,
        data: plantilla.datos,
        campos: plantilla.campos,
        formato: plantilla.formato || {}
    };
    
    fetch('/api/store/worksheet_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
        body: JSON.stringify(dataToSave)
    })
    .then(response => response.ok ? response.json() : Promise.reject(`Error ${response.status}`))
    .catch(error => {
        // Error guardando formato (silencioso)
    });
    
    showClipboardIndicator(`✅ Color de fondo aplicado: ${color}`);
}

// Con persistencia y registros en historial (función segura)
function applyTextColor(color, selection) {
    
    saveUndoState(ACTION_TYPES.BULK_EDIT, `Aplicar color de texto ${color}`, selection.cells);
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // inicializar formato si no existe
    if (!plantilla.formato) {
        plantilla.formato = {};
    }
    
    // Procesars
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cell = getCellElement(row, col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
                td.style.setProperty('color', color, 'important');
                cell.style.setProperty('color', color, 'important');
                td.setAttribute('data-custom-color', color);
                cell.setAttribute('data-custom-color', color);
                
                // NUEVO: Guardar formato en plantilla para persistencia
                const cellId = `${row}-${col}`;
                if (!plantilla.formato[cellId]) {
                    plantilla.formato[cellId] = {};
                }
                plantilla.formato[cellId].color = color;
            }
        }
    });
    
    // Procesars
    selection.rows.forEach(rowIndex => {
        const cells = document.querySelectorAll(`#worksheetTable tr[data-row-index="${rowIndex}"] td`);
        cells.forEach((td, colIndex) => {
            td.style.setProperty('color', color, 'important');
            td.setAttribute('data-custom-color', color);
            const input = td.querySelector('input');
            if (input) {
                input.style.setProperty('color', color, 'important');
                input.setAttribute('data-custom-color', color);
            }
            
            // NUEVO: Guardar formato para toda la fila
            const cellId = `${rowIndex}-${colIndex}`;
            if (!plantilla.formato[cellId]) {
                plantilla.formato[cellId] = {};
            }
            plantilla.formato[cellId].color = color;
        });
    });
    
    // nas seleccionadas
    selection.columns.forEach(colIndex => {
        const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
        cells.forEach(td => {
            // Función segura para evitar errores en modo compartido
            const tr = safeClosest(td, 'tr');
            const rowIndex = tr ? parseInt(tr.getAttribute('data-row-index')) : -1;
            if (rowIndex >= 0) {
            td.style.setProperty('color', color, 'important');
            td.setAttribute('data-custom-color', color);
            const input = td.querySelector('input');
            if (input) {
                input.style.setProperty('color', color, 'important');
                input.setAttribute('data-custom-color', color);
            }
            
            // NUEVO: Guardar formato para toda la columna
            const cellId = `${rowIndex}-${colIndex}`;
            if (!plantilla.formato[cellId]) {
                plantilla.formato[cellId] = {};
            }
            plantilla.formato[cellId].color = color;
            }
        });
    });
    
    // Guardar plantilla con color de texto (sin actualizar duplicados para evitar movimiento)
    const dataToSave = {
        template_id: plantilla.id,
        data: plantilla.datos,
        campos: plantilla.campos,
        formato: plantilla.formato || {}
    };
    
    fetch('/api/store/worksheet_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
        body: JSON.stringify(dataToSave)
    })
    .then(response => response.ok ? response.json() : Promise.reject(`Error ${response.status}`))
    .catch(error => {
        // Error guardando formato (silencioso)
    });
    
    showClipboardIndicator(`✅ Color de texto aplicado: ${color}`);
}
// Con persistencia, registros en historial y estilos CSS correctos (función segura)
function applyFormat(format, selection) {
    
    saveUndoState(ACTION_TYPES.BULK_EDIT, `Aplicar formato ${format}`, selection.cells);
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // inicializar formato si no existe
    if (!plantilla.formato) {
        plantilla.formato = {};
    }
    
    // Procesars
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cell = getCellElement(row, col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
                if (format === 'bold') {
                    td.style.setProperty('font-weight', 'bold', 'important');
                    cell.style.setProperty('font-weight', 'bold', 'important');
                } else if (format === 'underline') {
                    td.style.setProperty('text-decoration', 'underline', 'important');
                    cell.style.setProperty('text-decoration', 'underline', 'important');
                }
                td.setAttribute(`data-format-${format}`, 'true');
                cell.setAttribute(`data-format-${format}`, 'true');
                
                // NUEVO: Guardar formato en plantilla para persistencia
                const cellId = `${row}-${col}`;
                if (!plantilla.formato[cellId]) {
                    plantilla.formato[cellId] = {};
                }
                if (format === 'bold') {
                    plantilla.formato[cellId].fontWeight = 'bold';
                } else if (format === 'underline') {
                    plantilla.formato[cellId].textDecoration = 'underline';
                }
            }
        }
    });
    
    // Procesars
    selection.rows.forEach(rowIndex => {
        const cells = document.querySelectorAll(`#worksheetTable tr[data-row-index="${rowIndex}"] td`);
        cells.forEach((td, colIndex) => {
            if (format === 'bold') {
                td.style.setProperty('font-weight', 'bold', 'important');
            } else if (format === 'underline') {
                td.style.setProperty('text-decoration', 'underline', 'important');
            }
            td.setAttribute(`data-format-${format}`, 'true');
            
            const input = td.querySelector('input');
            if (input) {
                if (format === 'bold') {
                    input.style.setProperty('font-weight', 'bold', 'important');
                } else if (format === 'underline') {
                    input.style.setProperty('text-decoration', 'underline', 'important');
                }
                input.setAttribute(`data-format-${format}`, 'true');
            }
            
            // NUEVO: Guardar formato para toda la fila
            const cellId = `${rowIndex}-${colIndex}`;
            if (!plantilla.formato[cellId]) {
                plantilla.formato[cellId] = {};
            }
            if (format === 'bold') {
                plantilla.formato[cellId].fontWeight = 'bold';
            } else if (format === 'underline') {
                plantilla.formato[cellId].textDecoration = 'underline';
            }
        });
    });
    
    // nas seleccionadas
    selection.columns.forEach(colIndex => {
        const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
        cells.forEach(td => {
            // ncontrar fila padre con función segura
            const tr = safeClosest(td, 'tr');
            const rowIndex = tr ? parseInt(tr.getAttribute('data-row-index')) : -1;
            if (format === 'bold') {
                td.style.setProperty('font-weight', 'bold', 'important');
            } else if (format === 'underline') {
                td.style.setProperty('text-decoration', 'underline', 'important');
            }
            td.setAttribute(`data-format-${format}`, 'true');
            
            const input = td.querySelector('input');
            if (input) {
                if (format === 'bold') {
                    input.style.setProperty('font-weight', 'bold', 'important');
                } else if (format === 'underline') {
                    input.style.setProperty('text-decoration', 'underline', 'important');
                }
                input.setAttribute(`data-format-${format}`, 'true');
            }
            
            // NUEVO: Guardar formato para toda la columna
            const cellId = `${rowIndex}-${colIndex}`;
            if (!plantilla.formato[cellId]) {
                plantilla.formato[cellId] = {};
            }
            if (format === 'bold') {
                plantilla.formato[cellId].fontWeight = 'bold';
            } else if (format === 'underline') {
                plantilla.formato[cellId].textDecoration = 'underline';
            }
        });
    });
    
    // Guardar plantilla con formato de texto (sin actualizar duplicados para evitar movimiento)
    const dataToSave = {
        template_id: plantilla.id,
        data: plantilla.datos,
        campos: plantilla.campos,
        formato: plantilla.formato || {}
    };
    
    fetch('/api/store/worksheet_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
        body: JSON.stringify(dataToSave)
    })
    .then(response => response.ok ? response.json() : Promise.reject(`Error ${response.status}`))
    .catch(error => {
        // Error guardando formato (silencioso)
    });
    
    showClipboardIndicator(`✅ Formato ${format} aplicado`);
}
// Sin formato de campos como email/contraseña) - función segura
function clearFormat(selection) {
    
    saveUndoState(ACTION_TYPES.BULK_EDIT, 'Limpiar formato rápido', selection.cells);
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // Procesars
    selection.cells.forEach(cellKey => {
        const [row, col] = cellKey.split('-').map(Number);
        const cell = getCellElement(row, col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
                // NOTA: Solo limpiar formato rápido aplicado por el usuario
                
                // negrita/subrayado del formato rápido
                if (td.getAttribute('data-format-bold')) {
                    td.style.removeProperty('font-weight');
                    cell.style.removeProperty('font-weight');
                    td.removeAttribute('data-format-bold');
                    cell.removeAttribute('data-format-bold');
                }
                
                if (td.getAttribute('data-format-underline')) {
                    td.style.removeProperty('text-decoration');
                    cell.style.removeProperty('text-decoration');
                    td.removeAttribute('data-format-underline');
                    cell.removeAttribute('data-format-underline');
                }
                
                // Limpiar estilos del formato rápido
                if (td.getAttribute('data-custom-bg')) {
                    td.style.removeProperty('background-color');
                    cell.style.removeProperty('background-color');
                    td.removeAttribute('data-custom-bg');
                    cell.removeAttribute('data-custom-bg');
                }
                
                if (td.getAttribute('data-custom-color')) {
                    td.style.removeProperty('color');
                    cell.style.removeProperty('color');
                    td.removeAttribute('data-custom-color');
                    cell.removeAttribute('data-custom-color');
                }
                
                // NUEVO: Limpiar formato de la plantilla
                if (plantilla.formato) {
                    const cellId = `${row}-${col}`;
                    if (plantilla.formato[cellId]) {
                        delete plantilla.formato[cellId];
                    }
                }
            }
        }
    });
    
    // Procesars
    selection.rows.forEach(rowIndex => {
        const cells = document.querySelectorAll(`#worksheetTable tr[data-row-index="${rowIndex}"] td`);
        cells.forEach(td => {
            
            if (td.getAttribute('data-format-bold')) {
                td.style.removeProperty('font-weight');
                td.removeAttribute('data-format-bold');
            }
            if (td.getAttribute('data-format-underline')) {
                td.style.removeProperty('text-decoration');
                td.removeAttribute('data-format-underline');
            }
            if (td.getAttribute('data-custom-bg')) {
                td.style.removeProperty('background-color');
                td.removeAttribute('data-custom-bg');
            }
            if (td.getAttribute('data-custom-color')) {
                td.style.removeProperty('color');
                td.removeAttribute('data-custom-color');
            }
            
            const input = td.querySelector('input');
            if (input) {
                if (input.getAttribute('data-format-bold')) {
                    input.style.removeProperty('font-weight');
                    input.removeAttribute('data-format-bold');
                }
                if (input.getAttribute('data-format-underline')) {
                    input.style.removeProperty('text-decoration');
                    input.removeAttribute('data-format-underline');
                }
                if (input.getAttribute('data-custom-bg')) {
                    input.style.removeProperty('background-color');
                    input.removeAttribute('data-custom-bg');
                }
                if (input.getAttribute('data-custom-color')) {
                    input.style.removeProperty('color');
                    input.removeAttribute('data-custom-color');
                }
            }
        });
    });
    
    // nas seleccionadas
    selection.columns.forEach(colIndex => {
        const cells = document.querySelectorAll(`#worksheetTable td[data-col-index="${colIndex}"]`);
        cells.forEach(td => {
            // nas
            ['data-format-bold', 'data-format-underline', 'data-custom-bg', 'data-custom-color'].forEach(attr => {
                if (td.getAttribute(attr)) {
                    const property = attr.includes('bold') ? 'font-weight' : 
                                   attr.includes('underline') ? 'text-decoration' :
                                   attr.includes('bg') ? 'background-color' : 'color';
                    td.style.removeProperty(property);
                    td.removeAttribute(attr);
                    
                    const input = td.querySelector('input');
                    if (input && input.getAttribute(attr)) {
                        input.style.removeProperty(property);
                        input.removeAttribute(attr);
                    }
                }
            });
        });
    });
    
    // Guardar plantilla después de limpiar formato (sin actualizar duplicados para evitar movimiento)
    if (plantilla.formato) {
        const dataToSave = {
            template_id: plantilla.id,
            data: plantilla.datos,
            campos: plantilla.campos,
            formato: plantilla.formato || {}
        };
        
        fetch('/api/store/worksheet_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify(dataToSave)
        })
        .then(response => response.ok ? response.json() : Promise.reject(`Error ${response.status}`))
        .catch(error => {
            // Error guardando formato (silencioso)
        });
    }
    
    showClipboardIndicator('✅ Formato rápido limpiado');
}

// NUEVA: Función para aplicar formatos específicamente en modo copiar
function applyFormatsToCopyMode(plantilla) {
    if (!plantilla || !plantilla.formato || worksheetMode !== 'copiar') return;
    
    // aplicar formato guardado
    Object.keys(plantilla.formato).forEach(cellId => {
        const [row, col] = cellId.split('-').map(Number);
        const format = plantilla.formato[cellId];
        
        // Aplicar en modo copiar (div con clase cell-copyable)
        const cellDiv = document.querySelector(`#copy-text-${row}-${col}`);
        if (cellDiv) {
            const parentDiv = safeClosest(cellDiv, '.cell-copyable');
            if (parentDiv) {
                
                if (format.backgroundColor) {
                    parentDiv.style.setProperty('background-color', format.backgroundColor, 'important');
                }
                if (format.color) {
                    parentDiv.style.setProperty('color', format.color, 'important');
                }
                if (format.fontWeight === 'bold') {
                    parentDiv.style.setProperty('font-weight', 'bold', 'important');
                }
                if (format.textDecoration === 'underline') {
                    parentDiv.style.setProperty('text-decoration', 'underline', 'important');
                }
            }
        }
    });
}

// Función para restaurar formato guardado con verificación adicional (función segura)
function restoreFormats(plantilla) {
    if (!plantilla || !plantilla.formato) return;
    
    // aplicar formato guardado
    Object.keys(plantilla.formato).forEach(cellId => {
        const [row, col] = cellId.split('-').map(Number);
        const format = plantilla.formato[cellId];
        
        const cell = getCellElement(row, col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
                // aplicando
                if (format.backgroundColor) {
                    td.style.setProperty('background-color', format.backgroundColor, 'important');
                    cell.style.setProperty('background-color', format.backgroundColor, 'important');
                    td.setAttribute('data-custom-bg', format.backgroundColor);
                    cell.setAttribute('data-custom-bg', format.backgroundColor);
                }
                
                
                if (format.color) {
                    td.style.setProperty('color', format.color, 'important');
                    cell.style.setProperty('color', format.color, 'important');
                    td.setAttribute('data-custom-color', format.color);
                    cell.setAttribute('data-custom-color', format.color);
                }
                
                // negrita
                if (format.fontWeight === 'bold') {
                    td.style.setProperty('font-weight', 'bold', 'important');
                    cell.style.setProperty('font-weight', 'bold', 'important');
                    td.setAttribute('data-format-bold', 'true');
                    cell.setAttribute('data-format-bold', 'true');
                }
                
                
                if (format.textDecoration === 'underline') {
                    td.style.setProperty('text-decoration', 'underline', 'important');
                    cell.style.setProperty('text-decoration', 'underline', 'important');
                    td.setAttribute('data-format-underline', 'true');
                    cell.setAttribute('data-format-underline', 'true');
                }
            }
        }
    });
    
    // Verificación adicional después de restaurar formatos (función segura)
    setTimeout(() => {
        Object.keys(plantilla.formato).forEach(cellId => {
            const [row, col] = cellId.split('-').map(Number);
            const format = plantilla.formato[cellId];
            
            const cell = getCellElement(row, col);
            if (cell) {
                const td = safeClosest(cell, 'td');
                if (td) {
                    // Actualizar formato si es necesario
                    if (format.backgroundColor && !td.getAttribute('data-custom-bg')) {
                        td.style.setProperty('background-color', format.backgroundColor, 'important');
                        cell.style.setProperty('background-color', format.backgroundColor, 'important');
                        td.setAttribute('data-custom-bg', format.backgroundColor);
                        cell.setAttribute('data-custom-bg', format.backgroundColor);
                    }
                    
                    if (format.color && !td.getAttribute('data-custom-color')) {
                        td.style.setProperty('color', format.color, 'important');
                        cell.style.setProperty('color', format.color, 'important');
                        td.setAttribute('data-custom-color', format.color);
                        cell.setAttribute('data-custom-color', format.color);
                    }
                }
            }
        });
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
}



// NUEVA: Menú contextual específico para filas (columna numeración)
function showRowContextMenu(x, y) {
    // en modo readonly compartido, no mostrar el modal de herramientas
    if (window.isSharedMode && window.isReadonly) {
        return;
    }
    
    hideContextMenu();
    
    if (selectedRows.size === 0) return;
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'contextMenu';
    
    const rowCount = selectedRows.size;
    const rowText = rowCount === 1 ? 'fila seleccionada' : `${rowCount} filas seleccionadas`;
    
    // NUEVO: Menú contextual con opciones según el modo
    const baseMenuItems = [
        { icon: 'fas fa-info-circle', text: `${rowText}`, action: null, disabled: true },
        { separator: true },
        { icon: 'fas fa-plus', text: 'Crear fila arriba', action: 'add-row-above' },
        { icon: 'fas fa-plus', text: 'Crear fila abajo', action: 'add-row-below' }
    ];
    
    // NUEVO: Solo mostrar opciones de eliminación en modo admin
    const adminMenuItems = window.isSharedMode ? [] : [
        { separator: true },
        { icon: 'fas fa-trash', text: 'Eliminar filas seleccionadas', action: 'delete-rows' },
        { icon: 'fas fa-eraser', text: 'Limpiar contenido de filas', action: 'clear-rows' }
    ];
    
    const commonMenuItems = [
        { separator: true },
        { icon: 'fas fa-copy', text: 'Copiar filas', action: 'copy-rows' },
        { separator: true },
        { icon: 'fas fa-palette', text: 'Formato rápido', action: 'format-rows' },
        { separator: true },
        { icon: 'fas fa-times', text: 'Cancelar selección', action: 'cancel-selection' }
    ];
    
    const menuItems = [...baseMenuItems, ...adminMenuItems, ...commonMenuItems];
    
    // elementos del menú
    menuItems.forEach(item => {
        if (item.separator) {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        } else {
            const menuItem = document.createElement('button');
            menuItem.className = 'context-menu-item';
            if (item.disabled) {
                menuItem.className += ' context-menu-item-disabled';
                menuItem.style.color = '#999';
                menuItem.style.fontWeight = 'bold';
                menuItem.style.cursor = 'default';
            }
            menuItem.innerHTML = `<i class="${item.icon}"></i>${item.text}`;
            
            if (!item.disabled && item.action) {
                menuItem.addEventListener('click', () => {
                    executeRowContextAction(item.action);
                    hideRowSelectionContextMenu();
                });
            }
            menu.appendChild(menuItem);
        }
    });
    
    // crear el menú
    document.body.appendChild(menu);
    
    // verificar si se sale de la pantalla
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 10;
    }
    if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 10;
    }
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    // cerrar al hacer clic fuera
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
}

// NUEVA: Ejecutar acciones del menú contextual de filas
function executeRowContextAction(action) {
    const selectedRowsArray = Array.from(selectedRows);
    
    // definir acciones de eliminación en modo compartido
    if (window.isSharedMode && (action === 'delete-rows' || action === 'clear-rows')) {
        alert('Solo el administrador puede eliminar o limpiar filas.');
        return;
    }
    
    switch (action) {
        case 'add-row-above':
            if (selectedRowsArray.length > 0) {
                addRowAbove(Math.min(...selectedRowsArray));
            }
            break;
        case 'add-row-below':
            if (selectedRowsArray.length > 0) {
                addRowBelow(Math.max(...selectedRowsArray));
            }
            break;
        case 'delete-rows':
            deleteSelectedRows(selectedRowsArray);
            break;
        case 'clear-rows':
            clearRows(selectedRowsArray);
            break;
        case 'copy-rows':
            copySelectedRows(selectedRowsArray);
            break;
        case 'format-rows':
            showFormatMenu();
            break;
        case 'cancel-selection':
            cancelRowSelection();
            break;
    }
}

// NUEVA: Eliminar filas seleccionadas completamente
function deleteSelectedRows(rowIndices) {
    if (rowIndices.length === 0) return;
    
    // confirmación
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '2000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    const rowCount = rowIndices.length;
    const rowText = rowCount === 1 ? 'esta fila' : `estas ${rowCount} filas`;
    
    modal.innerHTML = `
        <div style='background:#fff;padding:24px 32px;border-radius:10px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.15);text-align:center;'>
            <h4 style='margin-bottom:20px;color:#d63031;'>⚠️ Eliminar filas</h4>
            <p style='margin-bottom:20px;color:#333;'>¿Estás seguro de que quieres eliminar ${rowText}?</p>
            <p style='margin-bottom:20px;color:#666;font-size:14px;'>Esta acción no se puede deshacer.</p>
            
            <div style='display:flex;gap:10px;justify-content:center;'>
                <button id='btnConfirmarEliminar' style='background:#d63031;color:white;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;'>
                    Sí, eliminar
                </button>
                <button id='btnCancelarEliminar' style='background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;'>
                    Cancelar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // confirmar eliminación
    document.getElementById('btnConfirmarEliminar').addEventListener('click', function() {
        pushTablaUndo(); 
        
        // ordenar índices de mayor a menor para eliminar desde abajo
        const sortedIndices = rowIndices.sort((a, b) => b - a);
        
        // nar filas de tablaDatos
        sortedIndices.forEach(rowIndex => {
            if (tablaDatos[rowIndex]) {
                tablaDatos.splice(rowIndex, 1);
            }
        });
        
        // Actualizar plantilla
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (plantilla) {
            plantilla.datos = tablaDatos;
            
            // actualizar backend
            saveWorksheetData(plantilla,
                () => {
                    showClipboardIndicator(`✅ ${rowCount} fila${rowCount > 1 ? 's' : ''} eliminada${rowCount > 1 ? 's' : ''}`);
                    // renderizar tabla
                    reRenderTable(plantilla);
                    clearAllSelections();
                },
                (error) => {
                    showClipboardIndicator(`❌ Error al eliminar filas: ${error?.message || 'Error desconocido'}`);
                }
            );
        }
        
        modal.remove();
    });
    
    // cancelar
    document.getElementById('btnCancelarEliminar').addEventListener('click', function() {
        modal.remove();
    });
    
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// NUEVA: Copiar filas seleccionadas
function copySelectedRows(rowIndices) {
    if (rowIndices.length === 0) return;
    
    const plantilla = optimizedFunctions.getCurrentPlantilla();
    if (!plantilla) return;
    
    // obtener datos de las filas seleccionadas
    const copiedData = rowIndices.map(rowIndex => {
        if (tablaDatos[rowIndex]) {
            return tablaDatos[rowIndex].join('\t');
        }
        return '';
    }).filter(row => row.length > 0);
    
    const textToCopy = copiedData.join('\n');
    
    if (textToCopy) {
        // Función de copia apropiada
        const isTouchDevice = window.navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
        
        if (isTouchDevice) {
            copyToClipboardMobile(textToCopy).then(() => {
                showClipboardIndicator(`✅ ${rowIndices.length} fila${rowIndices.length > 1 ? 's' : ''} copiada${rowIndices.length > 1 ? 's' : ''}`);
            });
        } else {
            navigator.clipboard.writeText(textToCopy).then(() => {
                showClipboardIndicator(`✅ ${rowIndices.length} fila${rowIndices.length > 1 ? 's' : ''} copiada${rowIndices.length > 1 ? 's' : ''}`);
            }).catch(() => {
                showClipboardIndicator('❌ Error al copiar');
            });
        }
    }
}

// COMPLETAMENTE REESCRITO: Procesar filtro de duplicados que incluye TODAS las filas
function procesarFiltroDuplicados(plantilla, campo, colIndex) {
    try {
        
        // validaciones robustas
        if (!plantilla) {
            return null;
        }
        
        // Finales exista y sea válido
        if (!plantilla.datosOriginales || !Array.isArray(plantilla.datosOriginales)) {
            // no existen datosOriginales, usar los datos actuales
            if (Array.isArray(plantilla.datos) && plantilla.datos.length > 0) {
                plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));
            } else {
                return null;
            }
        }
        
        if (campo !== 'correo' && campo !== 'contraseña' && campo !== 'links') {
            return null;
        }
        
        const datosOriginales = JSON.parse(JSON.stringify(plantilla.datosOriginales));
        
        // NUEVA LÓGICA MEJORADA: Incluir TODAS las filas (incluso vacías)
        // Contar apariciones de cada valor repetido (2+ veces)
        // validaciones adicionales de esos valores repetidos  
        // SIN COLOR abajo: Valores únicos + filas vacías
        
        // Incluir todas las filas (incluso vacías/nulas)
        const todasLasFilas = datosOriginales.map((fila, indiceOriginal) => ({
            fila: fila,
            indiceOriginal: indiceOriginal,
            valor: (fila && fila[colIndex] ? fila[colIndex].toString().trim() : ''),
            esVacia: !fila || !fila[colIndex] || fila[colIndex].toString().trim() === ''
        }));
        
        // contar frecuencias solo de valores NO vacíos
        const frecuencias = new Map();
        todasLasFilas.forEach(item => {
            if (!item.esVacia) {
                if (!frecuencias.has(item.valor)) {
                    frecuencias.set(item.valor, []);
                }
                frecuencias.get(item.valor).push(item);
            }
        });
        
        // en la nueva lógica
        const primerasApariciones = []; // primeras apariciones de repetidos
        const aparicionesAdicionales = []; // apariciones adicionales de repetidos
        const unicosYVacios = []; // SIN COLOR - Únicos reales + filas vacías
        
        // procesar datos
        frecuencias.forEach((apariciones, valor) => {
            if (apariciones.length === 1) {
                // único real → Sin color al final
                unicosYVacios.push(...apariciones);
            } else if (apariciones.length >= 2) {
                // primera en amarillo, resto en verde
                apariciones.forEach((item, index) => {
                    if (index === 0) {
                        primerasApariciones.push({ ...item, colorTipo: 'amarillo' });
                    } else {
                        aparicionesAdicionales.push({ ...item, colorTipo: 'verde' });
                    }
                });
            }
        });
        
        // final
        const filasVacias = todasLasFilas.filter(item => item.esVacia);
        unicosYVacios.push(...filasVacias);
        
        // ordenar cada categoría manteniendo orden original
        primerasApariciones.sort((a, b) => a.indiceOriginal - b.indiceOriginal);
        aparicionesAdicionales.sort((a, b) => a.indiceOriginal - b.indiceOriginal);
        unicosYVacios.sort((a, b) => a.indiceOriginal - b.indiceOriginal);
        
        // CONSTRUIR RESULTADO: TODAS las filas organizadas
        const filasOrdenadas = [
            ...primerasApariciones.map(item => item.fila),
            ...aparicionesAdicionales.map(item => item.fila),
            ...unicosYVacios.map(item => item.fila)
        ];
        
        // nderizado
        const indiceColores = new Map();
        let indiceActual = 0;
        
        
        primerasApariciones.forEach(() => {
            indiceColores.set(indiceActual, 'amarillo');
            indiceActual++;
        });
        
        
        aparicionesAdicionales.forEach(() => {
            indiceColores.set(indiceActual, 'verde');
            indiceActual++;
        });
        
        // Únicos y vacíos SIN COLOR (no marcamos nada)
        unicosYVacios.forEach(() => {
            indiceActual++; // Incrementar índice, sin color
        });
        
        // NUEVO: Crear mapa de colores cruzados solo para la columna específica
        const coloresCruzados = new Map();
        if (campo === 'correo' || campo === 'contraseña') {
            // nas del mismo tipo
            plantilla.campos.forEach((campoCol, colIdx) => {
                if (colIdx !== colIndex) { // No aplicar a la columna que se está filtrando
                    const esMismoTipo = 
                        (campo === 'correo' && isEmailField(campoCol)) ||
                        (campo === 'contraseña' && isPasswordField(campoCol));
                    
                    if (esMismoTipo) {
                        // Detectar duplicados específica
                        const duplicadosCruzados = detectarDuplicadosEnColumnaEspecifica(plantilla, campo, colIdx);
                        if (duplicadosCruzados.size > 0) {
                            coloresCruzados.set(colIdx, duplicadosCruzados);
                        }
                    }
                }
            });
        }
        
        // antes de retornar
        const resultado = {
            datos: filasOrdenadas,
            colores: indiceColores,
            coloresCruzados: coloresCruzados,
            campoFiltrado: campo,
            colIndexFiltrado: colIndex, // NUEVO: Agregar índice de columna filtrada
            estadisticas: {
                totalUnicos: primerasApariciones.length,
                totalRepetidos: aparicionesAdicionales.length,
                valoresUnicos: frecuencias.size,
                unicosReales: unicosYVacios.length,
                totalFilas: filasOrdenadas.length
            }
        };
        

        
        return resultado;
        
    } catch (error) {
        return null;
    }
}
// Números por columna específica
function procesarFiltroNumeros(plantilla, campo, colIndex, tipoFiltro) {
    try {
        // validaciones robustas
        if (!plantilla) {
            return null;
        }
        
        // Finales exista y sea válido
        if (!plantilla.datosOriginales || !Array.isArray(plantilla.datosOriginales)) {
            // no existen datosOriginales, usar los datos actuales
            if (Array.isArray(plantilla.datos) && plantilla.datos.length > 0) {
                plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));
            } else {
                return null;
            }
        }
        
        // usar index proporcionado en lugar de validar campo
        if (colIndex < 0 || colIndex >= plantilla.campos.length) {
    
            return null;
        }
        
        const datosOriginales = JSON.parse(JSON.stringify(plantilla.datosOriginales));
        

        
        // obtener sus valores en la columna específica
        const todasLasFilas = datosOriginales.map((fila, indiceOriginal) => ({
            fila: fila,
            indiceOriginal: indiceOriginal,
            valor: (fila && fila[colIndex] ? fila[colIndex].toString().trim() : ''),
            esVacia: !fila || !fila[colIndex] || fila[colIndex].toString().trim() === ''
        }));
        

        
        let filasOrdenadas = [];
        const indiceColores = new Map();
        
        if (tipoFiltro === 'color') {
            // Ordenar por color: 1(verde), 2(rojo), 3(azul), 4(naranja), 5(morado), 6(rosa), 8(negro)
            const ordenColores = ['1', '2', '3', '4', '5', '6', '8'];
            

            
            
            const filasPorColor = new Map();
            ordenColores.forEach(color => {
                filasPorColor.set(color, []);
            });
            
            // Comentario
            const filasVacias = [];
            
            todasLasFilas.forEach(item => {
                if (item.esVacia) {
                    filasVacias.push(item);
                } else if (ordenColores.includes(item.valor)) {
                    filasPorColor.get(item.valor).push(item);
                } else {
                    filasVacias.push(item); // Valores no válidos van al final
                }
            });
            

            
            // construir resultado ordenado por color
            let indiceActual = 0;
            ordenColores.forEach(color => {
                const filasDeEsteColor = filasPorColor.get(color);
                filasDeEsteColor.forEach(item => {
                    filasOrdenadas.push(item.fila);
                    indiceColores.set(indiceActual, 'color');
                    indiceActual++;
                });
            });
            
            // Comentario
            filasVacias.forEach(item => {
                filasOrdenadas.push(item.fila);
                // Sin color para filas vacías
            });
            
        } else if (tipoFiltro === 'numeros') {
            // Ordenar por número: 1, 2, 3, 4, 5, 6, 8
            const ordenNumeros = ['1', '2', '3', '4', '5', '6', '8'];
            
            // Agrupar por número
            const filasPorNumero = new Map();
            ordenNumeros.forEach(numero => {
                filasPorNumero.set(numero, []);
            });
            
            // Comentario
            const filasVacias = [];
            
            todasLasFilas.forEach(item => {
                if (item.esVacia) {
                    filasVacias.push(item);
                } else if (ordenNumeros.includes(item.valor)) {
                    filasPorNumero.get(item.valor).push(item);
                } else {
                    filasVacias.push(item); // Valores no válidos van al final
                }
            });
            
            // construir resultado ordenado por número
            let indiceActual = 0;
            ordenNumeros.forEach(numero => {
                const filasDeEsteNumero = filasPorNumero.get(numero);
                filasDeEsteNumero.forEach(item => {
                    filasOrdenadas.push(item.fila);
                    indiceColores.set(indiceActual, 'numero');
                    indiceActual++;
                });
            });
            
            // Comentario
            filasVacias.forEach(item => {
                filasOrdenadas.push(item.fila);
                // Sin color para filas vacías
            });
        }
        
        const resultado = {
            datos: filasOrdenadas,
            colores: indiceColores,
            coloresCruzados: new Map(),
            campoFiltrado: campo,
            colIndexFiltrado: colIndex,
            estadisticas: {
                totalFilas: filasOrdenadas.length,
                filasConColor: indiceColores.size,
                tipoFiltro: tipoFiltro
            }
        };
        

        
        return resultado;
        
    } catch (error) {

        return null;
    }
}
// NUEVA: Procesar filtro de texto y color por columna específica
function procesarFiltroTexto(plantilla, campo, colIndex, tipoFiltro) {
    try {
        // validaciones robustas
        if (!plantilla) {
            return null;
        }
        
        // Finales exista y sea válido
        if (!plantilla.datosOriginales || !Array.isArray(plantilla.datosOriginales)) {
            // no existen datosOriginales, usar los datos actuales
            if (Array.isArray(plantilla.datos) && plantilla.datos.length > 0) {
                plantilla.datosOriginales = JSON.parse(JSON.stringify(plantilla.datos));
            } else {
                return null;
            }
        }
        
        // Solo procesar si no es 'numero' (ya tiene su propia función)
        if (campo === 'numero') {
            return null;
        }
        
        const datosOriginales = JSON.parse(JSON.stringify(plantilla.datosOriginales));
        
        // obtener sus valores en la columna específica
        const todasLasFilas = datosOriginales.map((fila, indiceOriginal) => ({
            fila: fila,
            indiceOriginal: indiceOriginal,
            valor: (fila && fila[colIndex] ? fila[colIndex].toString().trim() : ''),
            esVacia: !fila || !fila[colIndex] || fila[colIndex].toString().trim() === ''
        }));
        
        let filasOrdenadas = [];
        const indiceColores = new Map();
        
        if (tipoFiltro === 'texto') {
            // obtener el texto de búsqueda
            const textoBusqueda = document.getElementById('filtroTexto')?.value?.trim() || '';
            
            if (textoBusqueda) {
                
                const filasCoincidentes = [];
                const filasNoCoincidentes = [];
                
                todasLasFilas.forEach(item => {
                    if (item.esVacia) {
                        filasNoCoincidentes.push(item);
                    } else if (item.valor.toLowerCase().includes(textoBusqueda.toLowerCase())) {
                        filasCoincidentes.push(item);
                    } else {
                        filasNoCoincidentes.push(item);
                    }
                });
                
                // construir resultado: coincidencias primero, luego el resto
                let indiceActual = 0;
                filasCoincidentes.forEach(item => {
                    filasOrdenadas.push(item.fila);
                    indiceColores.set(indiceActual, 'texto');
                    indiceActual++;
                });
                
                filasNoCoincidentes.forEach(item => {
                    filasOrdenadas.push(item.fila);
                    // Sin color para filas no coincidentes
                });
            } else {
                // no hay texto de búsqueda, mantener orden original
                filasOrdenadas = todasLasFilas.map(item => item.fila);
            }
            
        } else if (tipoFiltro === 'color') {
            // Ordenar por valores específicos de color: 1, 2, 3, 4, 5, 6, 8
            const ordenColores = ['1', '2', '3', '4', '5', '6', '8'];
            
            
            const filasPorColor = new Map();
            ordenColores.forEach(color => {
                filasPorColor.set(color, []);
            });
            
            // Comentario
            const filasVacias = [];
            
            todasLasFilas.forEach(item => {
                if (item.esVacia) {
                    filasVacias.push(item);
                } else if (ordenColores.includes(item.valor)) {
                    filasPorColor.get(item.valor).push(item);
                } else {
                    filasVacias.push(item); // Valores no válidos van al final
                }
            });
            
            // construir resultado ordenado por color
            let indiceActual = 0;
            ordenColores.forEach(color => {
                const filasDeEsteColor = filasPorColor.get(color);
                filasDeEsteColor.forEach(item => {
                filasOrdenadas.push(item.fila);
                indiceColores.set(indiceActual, 'color');
                indiceActual++;
                });
            });
            
            // Comentario
            filasVacias.forEach(item => {
                filasOrdenadas.push(item.fila);
                // Sin color para filas vacías
            });
        }
        
        const resultado = {
            datos: filasOrdenadas,
            colores: indiceColores,
            coloresCruzados: new Map(),
            campoFiltrado: campo,
            colIndexFiltrado: colIndex,
            estadisticas: {
                totalFilas: filasOrdenadas.length,
                filasConColor: indiceColores.size,
                tipoFiltro: tipoFiltro
            }
        };
        
        return resultado;
        
    } catch (error) {
        return null;
    }
}

// NUEVA: Función auxiliar para colores cruzados
function agregarColoresCruzados(fila, plantilla, tipoCampo, indiceFilaResultado, coloresCruzados) {
    try {
        if (!Array.isArray(fila) || !plantilla || !plantilla.campos || !Array.isArray(plantilla.campos)) {
            return;
        }
        
        // nas del tipo especificado (correo, contraseña o links)
        plantilla.campos.forEach((campo, colIdx) => {
            const esCampoRelevante = 
                (tipoCampo === 'correo' && isEmailField(campo)) ||
                (tipoCampo === 'contraseña' && isPasswordField(campo)) ||
                (tipoCampo === 'links' && campo === 'links');
                
            if (esCampoRelevante) {
                const valorEnColumna = (fila[colIdx] || '').toString().trim();
                if (valorEnColumna) {
                    // Ordenar si este valor aparece 1 vez (amarillo) o múltiples veces (verde)
                    const frecuenciaEnColumna = contarFrecuenciaValorEnColumna(valorEnColumna, colIdx, plantilla.datosOriginales);
                    
                    const colorCruzado = frecuenciaEnColumna === 1 ? 'amarillo' : 'verde';
                    
                    if (!coloresCruzados.has(indiceFilaResultado)) {
                        coloresCruzados.set(indiceFilaResultado, {});
                    }
                    
                    coloresCruzados.get(indiceFilaResultado)[colIdx] = colorCruzado;
                }
            }
        });
    } catch (error) {
        // silently handle error
    }
}

// NUEVA: Función auxiliar para contar frecuencia de un valor en una columna
function contarFrecuenciaValorEnColumna(valor, colIndex, datosOriginales) {
    try {
        if (!Array.isArray(datosOriginales) || !valor) return 0;
        
        let count = 0;
        datosOriginales.forEach(fila => {
            if (Array.isArray(fila)) {
                const valorFila = (fila[colIndex] || '').toString().trim();
                if (valorFila === valor) {
                    count++;
                }
            }
        });
        
        return count;
    } catch (error) {
        return 0;
    }
}

// NUEVO: Aplicar resultado de filtro (común para duplicados y normales)
function aplicarResultadoFiltro(resultado, plantilla, campo, colIndex) {
    if (!resultado || !resultado.datos) return;
    

    
    
    FiltersState.active = true;
    FiltersState.configured[colIndex] = { 
        campo, 
        tipo: resultado.estadisticas?.tipoFiltro || 'duplicados',
        colores: resultado.colores || new Map(),
        estadisticas: resultado.estadisticas
    };
    
    // sincronizar con sistema viejo
    filtrosActivos = true;
    filtrosConfigurados[colIndex] = { 
        campo, 
        config: { 
            tipo: resultado.estadisticas?.tipoFiltro || 'duplicados',
            colores: resultado.colores || new Map(),
            estadisticas: resultado.estadisticas
        } 
    };
    
    plantilla.datos = resultado.datos;
    tablaDatos = resultado.datos;
    
    // configuración y renderizar
    saveCurrentPage(1);
    
    try {
        const container = document.getElementById('worksheetTableContainer');
        
        // NUEVO: Invalidar cache antes de renderizar para evitar interferencias
        if (optimizedFunctions.invalidateAll) {
            optimizedFunctions.invalidateAll();
        }
        
        optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, optimizedFunctions.getPlantillaIndex(plantilla));
        

        
        // nderizado
        if (resultado.colores && resultado.colores.size > 0) {
            // NUEVO: Agregar delay para asegurar que el DOM esté listo
            setTimeout(() => {
                if (resultado.estadisticas?.tipoFiltro === 'color' || resultado.estadisticas?.tipoFiltro === 'numeros') {
                    // NUEVO: Limpiar colores de filtro antes de aplicar nuevos
                    limpiarColoresFiltro();
                    // Función específica para colores de filtros
                    aplicarColoresFiltro(
                        resultado.colores, 
                        resultado.colIndexFiltrado,
                        resultado.estadisticas.tipoFiltro
                    );
                } else {
                    // Función para duplicados
            aplicarColoresDuplicados(
                resultado.colores, 
                resultado.coloresCruzados || null, 
                resultado.campoFiltrado || null,
                resultado.colIndexFiltrado ?? null
            );
                }
            }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
        }
        
        // mensaje de resultado para duplicados y números
        if (resultado.estadisticas) {
            const stats = resultado.estadisticas;
            
            if (stats.tipoFiltro === 'color' || stats.tipoFiltro === 'numeros') {
                // mensaje para filtros de números
                const tipoTexto = stats.tipoFiltro === 'color' ? 'colores' : 'números';
                const filasConColor = stats.filasConColor || 0;
                const totalFilas = stats.totalFilas || 0;
                showClipboardIndicator(`✅ Filtro de ${tipoTexto} aplicado: ${filasConColor} filas organizadas de ${totalFilas} total`);
            } else {
                // mensaje para filtros de duplicados
                let mensaje = `🔍 Duplicados organizados: `;
                
                if (stats.totalUnicos > 0) {
                    mensaje += `${stats.totalUnicos} primeras apariciones (amarillo) arriba`;
                }
                
                if (stats.totalRepetidos > 0) {
                    if (stats.totalUnicos > 0) mensaje += ', ';
                    mensaje += `${stats.totalRepetidos} apariciones adicionales (verde) medio`;
                }
                
                if (stats.unicosReales > 0) {
                    if (stats.totalUnicos > 0 || stats.totalRepetidos > 0) mensaje += ', ';
                    mensaje += `${stats.unicosReales} únicos reales (sin color) abajo`;
                }
                
                showClipboardIndicator(mensaje);
            }
        } else {
            showClipboardIndicator('✅ Filtro aplicado');
        }
        
    } catch (error) {
        showClipboardIndicator(`⚠️ Error al mostrar duplicados filtrados`);
    }
}

// Aplicar colores según filtro (color/numeros)
function aplicarColoresFiltro(indiceColores, colIndexFiltrado, tipoFiltro) {
    try {
        const table = document.getElementById('worksheetTable');
        if (!table) return;
        
        const filas = table.querySelectorAll('tbody tr');
        if (!filas || filas.length === 0) return;
        
        
        if (!indiceColores || typeof indiceColores.get !== 'function') return;
        
        // NUEVO: Mapa de colores específicos para filtros
        const coloresFiltro = {
            '1': { bg: '#4caf50', color: '#fff', border: '#2e7d32' }, 
            '2': { bg: '#f44336', color: '#fff', border: '#c62828' }, 
            '3': { bg: '#2196f3', color: '#fff', border: '#1565c0' }, 
            '4': { bg: '#ff9800', color: '#fff', border: '#e65100' }, // Naranja
            '5': { bg: '#9c27b0', color: '#fff', border: '#6a1b9a' }, 
            '6': { bg: '#e91e63', color: '#fff', border: '#ad1457' }, 
            '8': { bg: '#424242', color: '#fff', border: '#212121' } // Negro
        };
        
        // índice para considerar la columna de numeración
        const colIndexAjustado = colIndexFiltrado >= 0 ? colIndexFiltrado + 1 : -1;
        
        // NUEVO: Primero limpiar TODOS los colores de filtro de la columna específica
        filas.forEach((fila) => {
            if (colIndexAjustado >= 0) {
                const celda = fila.querySelectorAll('td')[colIndexAjustado];
                if (celda && celda.getAttribute('data-color-filtro')) {
                    celda.style.removeProperty('background-color');
                    celda.style.removeProperty('color');
                    celda.style.removeProperty('font-weight');
                    celda.style.removeProperty('border');
                    celda.removeAttribute('data-color-filtro');
                }
            }
        });
        
        // NUEVO: Ahora aplicar colores SOLO a las filas que realmente tienen el tipo de color correcto
        filas.forEach((fila, indice) => {
            try {
                const colorTipo = indiceColores.get(indice);
                
                // Aplicar color según tipo: 'color' o 'numero'
                if ((colorTipo === 'color' || colorTipo === 'numero') && colIndexAjustado >= 0) {
                    const celda = fila.querySelectorAll('td')[colIndexAjustado];
                    if (celda) {
                        // obtener el valor del input, no del textContent
                        const input = celda.querySelector('input');
                        const valorCelda = input ? input.value?.trim() : celda.textContent?.trim() || '';
                        
                        // en el mapa de colores
                        if (valorCelda && coloresFiltro[valorCelda]) {
                            const color = coloresFiltro[valorCelda];
                            celda.style.setProperty('background-color', color.bg, 'important');
                            celda.style.setProperty('color', color.color, 'important');
                            celda.style.setProperty('font-weight', 'bold', 'important');
                            celda.style.setProperty('border', `2px solid ${color.border}`, 'important');
                            celda.setAttribute('data-color-filtro', valorCelda);
                        }
                        // NOTA: NO limpiar colores si no tiene valor válido - mantener el estado actual
                    }
                }
                
                // NOTA: NO tocar otras columnas - mantener sus colores existentes
                
            } catch (filaError) {
                // silently handle error
            }
        });
        
    } catch (error) {
        // silently handle error
    }
}

// fila filtrada + colores cruzados
function aplicarColoresDuplicados(indiceColores, coloresCruzados = null, campoFiltrado = null, colIndexFiltrado = null) {
    try {
        
        const table = document.getElementById('worksheetTable');
        if (!table) return;
        
        const filas = table.querySelectorAll('tbody tr');
        if (!filas || filas.length === 0) return;
        
        
        if (!indiceColores || typeof indiceColores.get !== 'function') return;
        
        // USAR ÍNDICE DE COLUMNA ESPECÍFICO SI SE PROPORCIONA
        let colIndexFiltrada = colIndexFiltrado !== null ? colIndexFiltrado : -1;
        
        // nombre si NO se proporciona el índice específico
        if (colIndexFiltrada === -1 && campoFiltrado) {
            const headers = table.querySelectorAll('thead th');
            if (headers) {
                headers.forEach((header, idx) => {
                    const headerText = header.textContent?.toLowerCase() || '';
                    if (headerText.includes(campoFiltrado.toLowerCase())) {
                        colIndexFiltrada = idx;
                        return; // NOTA: Salir después de encontrar la primera coincidencia
                    }
                });
            }
        }
        
        // índice para considerar la columna de numeración
        // colIndexFiltrado viene de plantilla.campos, pero en el DOM la primera columna es numeración
        if (colIndexFiltrada >= 0) {
            colIndexFiltrada = colIndexFiltrada + 1; // Columna 0 (índice 0) es numeración
        }
        
        // NUEVO: Primero limpiar TODOS los colores de duplicados de la columna específica
        filas.forEach((fila) => {
            if (colIndexFiltrada >= 0) {
                const celda = fila.querySelectorAll('td')[colIndexFiltrada];
                if (celda && celda.getAttribute('data-color-especial')) {
                    celda.style.removeProperty('background-color');
                    celda.style.removeProperty('color');
                    celda.style.removeProperty('font-weight');
                    celda.style.removeProperty('border');
                    celda.removeAttribute('data-color-especial');
                }
            }
        });
        
        // NUEVO: Ahora aplicar colores SOLO a las filas que realmente tienen el tipo correcto
        filas.forEach((fila, indice) => {
            try {
                const colorTipo = indiceColores.get(indice);
                
                
                if (colorTipo === 'amarillo' && colIndexFiltrada >= 0) {
                        const celda = fila.querySelectorAll('td')[colIndexFiltrada];
                        if (celda) {
                            // Aplicar con máxima especificidad CSS
                            celda.style.setProperty('background-color', '#ffeb3b', 'important');
                            celda.style.setProperty('color', '#333', 'important');
                            celda.style.setProperty('font-weight', 'bold', 'important');
                            celda.style.setProperty('border', '2px solid #f57f17', 'important');
                            // Sin color especial para evitar conflictos
                            celda.setAttribute('data-color-especial', 'amarillo');
                        }
                } else if (colorTipo === 'verde' && colIndexFiltrada >= 0) {
                        const celda = fila.querySelectorAll('td')[colIndexFiltrada];
                        if (celda) {
                            // Aplicar con máxima especificidad CSS
                            celda.style.setProperty('background-color', '#c8e6c9', 'important');
                            celda.style.setProperty('color', '#2e7d32', 'important');
                            celda.style.setProperty('font-weight', 'bold', 'important');
                            celda.style.setProperty('border', '2px solid #66bb6a', 'important');
                            // Sin color especial para evitar conflictos
                            celda.setAttribute('data-color-especial', 'verde');
                    }
                }
                // NOTA: NO procesar 'color' o 'numero' aquí - eso se maneja en aplicarColoresFiltro
                
            } catch (filaError) {
                // silently continue
            }
        });
        
    } catch (error) {
        // silently handle error
    }
}



// Sin afectar los datos
function limpiarColoresDuplicados() {
    const table = document.getElementById('worksheetTable');
    if (!table) return;
    
    const filas = table.querySelectorAll('tbody tr');
    
    filas.forEach((fila) => {
        const celdas = fila.querySelectorAll('td');
        celdas.forEach(celda => {
            // ne colores especiales para evitar borrar otros estilos
            const tieneColorEspecial = celda.getAttribute('data-color-especial');
            const tieneColorCruzado = celda.getAttribute('data-color-cruzado');
            const tieneColorFiltro = celda.getAttribute('data-color-filtro');
            
            if (tieneColorEspecial || tieneColorCruzado || tieneColorFiltro) {
                // NUEVO: Limpiar solo los estilos específicos que aplicamos
                celda.style.removeProperty('background-color');
                celda.style.removeProperty('color');
                celda.style.removeProperty('font-weight');
                celda.style.removeProperty('border');
                
                // NUEVO: Remover solo los atributos que agregamos
                if (tieneColorEspecial) celda.removeAttribute('data-color-especial');
                if (tieneColorCruzado) celda.removeAttribute('data-color-cruzado');
                if (tieneColorFiltro) celda.removeAttribute('data-color-filtro');
                
                // NOTA: NO tocar el contenido de la celda, solo los estilos
                // necesario
                if (celda.hasAttribute('style') && !celda.getAttribute('style').trim()) {
                    celda.removeAttribute('style');
                }
                        }
                    });
                });
            }

// NUEVA: Función específica para limpiar solo colores de filtro
function limpiarColoresFiltro() {
    const table = document.getElementById('worksheetTable');
    if (!table) return;
    
    const filas = table.querySelectorAll('tbody tr');
    
    filas.forEach((fila) => {
        const celdas = fila.querySelectorAll('td');
        celdas.forEach(celda => {
            // no tocar otros
            if (celda.getAttribute('data-color-filtro')) {
                celda.style.removeProperty('background-color');
                celda.style.removeProperty('color');
                celda.style.removeProperty('font-weight');
                celda.style.removeProperty('border');
                celda.removeAttribute('data-color-filtro');
                
                
                if (celda.hasAttribute('style') && !celda.getAttribute('style').trim()) {
                    celda.removeAttribute('style');
                }
            }
        });
    });
}

// NUEVA: Función para copiar selección múltiple en móviles

// DOMContentLoaded #2 (con protección contra duplicación)
let secondDOMContentLoadedExecuted = false;
document.addEventListener('DOMContentLoaded', async function() {
    if (secondDOMContentLoadedExecuted) {

        return;
    }
    secondDOMContentLoadedExecuted = true;
    
    
    initializeUndoHistory();
    await loadChangesHistory();
});
// Función placeholder para mantener compatibilidad
function copySelectedCellsMobile() {
    // funcionalidad de copia móvil removida
}
// COMPLETAMENTE REESCRITO: Modal de búsqueda estilo Bloc de Notas
function showSearchReplaceDialog() {
    // eliminar modal anterior si existe
    const existingModal = document.querySelector('.search-replace-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'search-replace-modal';
    modal.style.cssText = `
        position: fixed;
        top: 80px;
        right: 30px;
        background: #f0f0f0;
        border: 2px solid #333;
        border-radius: 0;
        padding: 0;
        z-index: 2500;
        width: 380px;
        max-width: calc(100vw - 40px);
        box-shadow: 2px 2px 8px rgba(0,0,0,0.3);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        font-size: 11px;
        user-select: none;
    `;
    
    // NUEVO: Responsividad móvil
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        modal.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            right: 20px;
            width: auto;
            max-width: none;
            background: #f0f0f0;
            border: 2px solid #333;
            border-radius: 0;
            padding: 0;
            z-index: 2500;
            box-shadow: 2px 2px 8px rgba(0,0,0,0.3);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 11px;
            user-select: none;
        `;
    }
    
    modal.innerHTML = `
        <!-- Estilos CSS para evitar infracciones -->
        <style>
            .search-field-container {
                margin-bottom: 12px;
            }
            .search-label {
                display: block;
                margin-bottom: 4px;
                font-weight: bold;
                color: #333;
                font-size: 12px;
            }
            .search-input-group {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .search-input-field {
                flex: 1;
                padding: 6px 8px;
                border: 1px solid #999;
                font-size: 12px;
                background: white;
                box-sizing: border-box;
            }
            .search-replace-input {
                width: 100%;
                flex: none;
            }
            .search-arrow-btn {
                background: #e1e1e1;
                border: 1px solid #999;
                width: 26px;
                height: 26px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
            }
            .search-arrow-btn:hover {
                background: #d0d0d0;
            }
            .search-global-btn {
                background: #28a745;
                color: white;
                border: 1px solid #1e7e34;
                padding: 6px 12px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
            }
            .search-global-btn:hover {
                background: #218838;
            }
            @media (max-width: 768px) {
                .search-input-group {
                    gap: 2px;
                }
                .search-arrow-btn {
                    width: 30px;
                    height: 30px;
                    font-size: 12px;
                }
                .search-global-btn {
                    padding: 8px 12px;
                }
            }
        </style>
        
        <!-- Barra de título estilo Windows -->
        <div style='background: #0078d4; color: white; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: move;' class='modal-titlebar'>
            <div style='display: flex; align-items: center; gap: 8px;'>
                <span style='font-size: 14px;'>🔍</span>
                <span style='font-weight: bold; font-size: 12px;'>Buscar y reemplazar</span>
            </div>
            <button id='btnCerrarModal' style='background: none; border: none; color: white; font-size: 16px; cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;' title='Cerrar'>✕</button>
        </div>
        
        <!-- Contenido principal -->
        <div style='padding: 15px; background: #f0f0f0;'>
            <!-- Campo de búsqueda con flechas -->
            <div class='search-field-container'>
                <div class='search-label'>Buscar:</div>
                <div class='search-input-group'>
                    <input type='text' id='searchInput' placeholder='Escribir texto a buscar' class='search-input-field'>
                    <button id='btnSearchUp' class='search-arrow-btn' title='Buscar anterior'>▲</button>
                    <button id='btnSearchDown' class='search-arrow-btn' title='Buscar siguiente'>▼</button>
                </div>
            </div>
            
            <!-- Campo de reemplazo -->
            <div class='search-field-container'>
                <div class='search-label'>Reemplazar con:</div>
                <input type='text' id='replaceInput' placeholder='Escribir texto de reemplazo' class='search-input-field search-replace-input'>
            </div>
            
            <!-- Botón de reemplazar todo -->
            <div style='margin-bottom: 15px;'>
                <button id='btnReemplazarTodos' style='background: #0078d4; color: white; border: 1px solid #005a9e; padding: 8px 16px; cursor: pointer; font-size: 12px; width: 100%;'>Reemplazar todo</button>
            </div>
            
            <!-- Separador -->
            <hr style='border: none; border-top: 1px solid #ccc; margin: 15px 0;'>
            
            <!-- Búsqueda global en todas las plantillas -->
            <div class='search-field-container'>
                <div class='search-label'>Buscar en todas las plantillas:</div>
                <div class='search-input-group'>
                    <input type='text' id='globalSearchInput' placeholder='Buscar en todas las hojas...' class='search-input-field'>
                    <button id='btnGlobalSearch' class='search-global-btn'>Buscar</button>
                </div>
            </div>
            
            <!-- Resultados de búsqueda global -->
            <div id='modalGlobalSearchResults' style='display: none; max-height: 150px; overflow-y: auto; border: 1px solid #999; background: white; margin-bottom: 12px; font-size: 11px;'>
                <div id='globalResultsList' style='padding: 8px;'></div>
            </div>
            
            <!-- Información de estado -->
            <div id='searchStatus' style='font-size: 11px; color: #666; text-align: center; padding: 5px;'>
                Use las flechas ▲▼ para buscar
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // nueva funcionalidad
    let searchResults = [];
    let currentResultIndex = -1;
    let isDraggingModal = false;
    
    // Funcionalidad estilo Bloc de Notas (solo buscar con flechas)
    function performSearch(direction = 0) {
        const searchTerm = document.getElementById('searchInput').value;
        const statusDiv = document.getElementById('searchStatus');
        
        if (!searchTerm.trim()) {
            clearSearchHighlights();
            statusDiv.textContent = 'Escriba el texto a buscar';
            searchResults = [];
            currentResultIndex = -1;
            return;
        }
        
        // Solo buscar cuando se presionen las flechas (direction !== 0)
        if (direction === 0) {
            statusDiv.textContent = 'Use las flechas ▲▼ para buscar';
            return;
        }
        
        // con flechas, recopilar todos los resultados
        if (searchResults.length === 0) {
            searchResults = [];
            currentResultIndex = -1;
            clearSearchHighlights();
            
            const searchValue = searchTerm.toLowerCase();
            
            // buscar en todas las celdas
            if (tablaDatos && Array.isArray(tablaDatos)) {
                tablaDatos.forEach((row, rowIndex) => {
                    if (Array.isArray(row)) {
                        row.forEach((cellValue, colIndex) => {
                            const compareValue = (cellValue || '').toString().toLowerCase();
                                        if (compareValue.includes(searchValue)) {
                                searchResults.push({ row: rowIndex, col: colIndex, value: cellValue });
                                
                                // Resaltar sin afectar colores (función segura)
                                const cell = getCellElement(rowIndex, colIndex);
                                if (cell) {
                                    const td = safeClosest(cell, 'td');
                                    if (td) {
                                    td.classList.add('search-match-subtle');
                                    }
                                }
                            }
        });
                    }
                });
            }
        
                    if (searchResults.length > 0) {
                currentResultIndex = direction === 1 ? 0 : searchResults.length - 1;
                navigateToResult(currentResultIndex);
                statusDiv.textContent = `📍 Resultado ${currentResultIndex + 1} de ${searchResults.length} - Haga clic en la celda azul para editar`;
            } else {
                statusDiv.textContent = 'No se encontraron coincidencias';
            }
        } else {
            // Navegar entre resultados existentes
            if (searchResults.length > 0) {
                if (direction === 1) { // Siguiente
                    currentResultIndex = (currentResultIndex + 1) % searchResults.length;
                } else if (direction === -1) { // Anterior
                    currentResultIndex = currentResultIndex <= 0 ? searchResults.length - 1 : currentResultIndex - 1;
                }
                navigateToResult(currentResultIndex);
                statusDiv.textContent = `📍 Resultado ${currentResultIndex + 1} de ${searchResults.length} - Haga clic en la celda azul para editar`;
            }
        }
    }
    
    // Limpiar resaltados de búsqueda (nuevas clases no intrusivas)
    function clearSearchHighlights() {
        // nuevas clases de búsqueda no intrusivas
        document.querySelectorAll('.search-highlight-active, .search-match-subtle').forEach(el => {
            el.classList.remove('search-highlight-active', 'search-match-subtle');
            el.style.outline = '';
            el.style.outlineOffset = '';
        });
        
        // Limpiar clases antiguas (por compatibilidad)
        document.querySelectorAll('.search-highlight, .search-current').forEach(el => {
            el.classList.remove('search-highlight', 'search-current');
        });
        document.querySelectorAll('input.search-current, input.search-highlight').forEach(el => {
            el.classList.remove('search-highlight', 'search-current');
        });
        
        // MANTENER: Solo limpiar estilos directos de búsqueda, NO colores de formato
        document.querySelectorAll('td').forEach(td => {
            // sin búsqueda, mantener colores de formato existentes
            if (td.style.outline && td.style.outline.includes('#0078d4')) {
                td.style.outline = '';
                td.style.outlineOffset = '';
            }
            if (td.style.outline && td.style.outline.includes('#ffc107')) {
                td.style.outline = '';
                td.style.outlineOffset = '';
            }
        });
    }
    
    // Navegar a resultado específico (igual que búsqueda global, SIN afectar colores)
    function navigateToResult(index) {
        if (index < 0 || index >= searchResults.length) return;
        
        // NO limpiar resaltados para mantener colores existentes
        
        
        // Limpiar estilos anteriores de búsqueda (no colores de formato)
        document.querySelectorAll('.search-highlight-active').forEach(el => {
            el.classList.remove('search-highlight-active');
            el.style.outline = '';
        });
        
        // función segura
        const result = searchResults[index];
        const cell = getCellElement(result.row, result.col);
        if (cell) {
            const td = safeClosest(cell, 'td');
            if (td) {
            // Solo outline, NO cambiar colores de fondo existentes
            td.classList.add('search-highlight-active');
            td.style.outline = '3px solid #0078d4';
            td.style.outlineOffset = '-2px';
            
            
                    try {
            td.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center', 
                inline: 'center' 
            });
                } catch (error) {
            
                }
            }
            
            // NO hacer focus automático, solo al hacer clic
            
            
            
            // NUEVO: Focus solo al hacer clic en la celda resaltada
            const focusOnClick = (e) => {
                if (e.target === cell || e.target === td) {
                    e.stopPropagation();
                    cell.focus();
                    // NO seleccionar texto automáticamente
                    
                    
                    // activa solo al hacer clic
                    saveActiveCellPosition(result.row, result.col);
                }
            };
            
            // obtener para focus al clic
            td.addEventListener('click', focusOnClick);
            cell.addEventListener('click', focusOnClick);
            
            // NUEVO: Quitar outline al navegar a otro resultado o hacer clic fuera
            const removeHighlight = () => {
                td.classList.remove('search-highlight-active');
                td.style.outline = '';
                td.style.outlineOffset = '';
                td.removeEventListener('click', focusOnClick);
                cell.removeEventListener('click', focusOnClick);
                document.removeEventListener('click', removeHighlight);
            };
            
            // eventos o al hacer clic fuera
            setTimeout(removeHighlight, 8000);
            setTimeout(() => {
                document.addEventListener('click', (e) => {
                    if (!td.contains(e.target)) {
                        removeHighlight();
                    }
                }, { once: true });
            }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
        }
        
        currentResultIndex = index;
    }
    
    // Reemplazar todas las ocurrencias (Notas)
    function performReplaceAll() {
        const searchTerm = document.getElementById('searchInput').value;
        const replaceTerm = document.getElementById('replaceInput').value;
        const statusDiv = document.getElementById('searchStatus');
        
        if (!searchTerm.trim()) {
            statusDiv.textContent = 'Escriba el texto a buscar';
            return;
        }
        
        // antes de reemplazar
        searchResults = [];
        currentResultIndex = -1;
        clearSearchHighlights();
        
        const searchValue = searchTerm.toLowerCase();
        
        // Buscar en todas las celdas para obtener resultados actualizados
        if (tablaDatos && Array.isArray(tablaDatos)) {
            tablaDatos.forEach((row, rowIndex) => {
                if (Array.isArray(row)) {
                    row.forEach((cellValue, colIndex) => {
                        const compareValue = (cellValue || '').toString().toLowerCase();
                        if (compareValue.includes(searchValue)) {
                            searchResults.push({ row: rowIndex, col: colIndex, value: cellValue });
                        }
                    });
                }
            });
        }
        
        if (searchResults.length === 0) {
            statusDiv.textContent = 'No hay coincidencias para reemplazar';
            return;
        }
        
        pushTablaUndo(); 
        
        let replacedCount = 0;
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (!plantilla) return;
        
        // en orden inverso para evitar problemas de índices
        [...searchResults].reverse().forEach(result => {
                const { row, col, value } = result;
            
            // sin distinción de mayúsculas
            const searchRegex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const newValue = value.toString().replace(searchRegex, replaceTerm);
                
                if (newValue !== value) {
                    tablaDatos[row][col] = newValue;
                plantilla.datos = tablaDatos;
                
                // Actualizar input visual si existe
                    const input = getCellElement(row, col);
                    if (input) {
                        input.value = newValue;
                    // Actualizar formato si es necesario
                    const campo = plantilla.campos[col];
                    if (campo) {
                        renderCellFormat(input, campo, newValue);
                    }
                    }
                    replacedCount++;
                }
            });
        
        if (replacedCount > 0) {
            // Sincronizar con datos originales
            if (plantilla.datosOriginales) {
                plantilla.datosOriginales = JSON.parse(JSON.stringify(tablaDatos));
            }
            
            
            saveWorksheetData(plantilla);
            
            showClipboardIndicator(`✅ ${replacedCount} reemplazo${replacedCount > 1 ? 's' : ''} realizado${replacedCount > 1 ? 's' : ''}`);
            statusDiv.textContent = `${replacedCount} reemplazos realizados`;
            
            
            clearSearchHighlights();
            searchResults = [];
            currentResultIndex = -1;
                } else {
            statusDiv.textContent = 'No se realizaron reemplazos';
        }
    }
    
    // NUEVO: Búsqueda global - adaptada para modo compartido
    function performGlobalSearch() {
        const searchTerm = document.getElementById('globalSearchInput').value;
        const resultsDiv = document.getElementById('modalGlobalSearchResults');
        const resultsList = document.getElementById('globalResultsList');
        
        if (!searchTerm.trim()) {
            resultsDiv.style.display = 'none';
            return;
        }
        
        const searchValue = searchTerm.toLowerCase();
        let globalResults = [];
        
        // en modo compartido, buscar solo en la plantilla actual
        if (window.isSharedMode) {
            const plantilla = window.currentPlantilla;
            if (plantilla && plantilla.datos && Array.isArray(plantilla.datos)) {
                plantilla.datos.forEach((row, rowIndex) => {
                    if (!Array.isArray(row)) return;
                    
                    row.forEach((cellValue, colIndex) => {
                        const compareValue = (cellValue || '').toString().toLowerCase();
                        if (compareValue.includes(searchValue)) {
                            globalResults.push({
                                plantillaIndex: 0,
                                plantillaTitulo: plantilla.title || plantilla.titulo || 'Plantilla Compartida',
                                row: rowIndex,
                                col: colIndex,
                                value: cellValue,
                                campo: plantilla.campos[colIndex] || 'Campo'
                            });
                        }
                    });
                });
            }
        } else {
            // modo normal: buscar en todas las plantillas
        plantillas.forEach((plantilla, plantillaIndex) => {
            if (!plantilla.datos || !Array.isArray(plantilla.datos)) return;
            
            plantilla.datos.forEach((row, rowIndex) => {
                if (!Array.isArray(row)) return;
                
                row.forEach((cellValue, colIndex) => {
                    const compareValue = (cellValue || '').toString().toLowerCase();
                    if (compareValue.includes(searchValue)) {
                        globalResults.push({
                            plantillaIndex,
                            plantillaTitulo: plantilla.titulo || `Plantilla ${plantillaIndex + 1}`,
                            row: rowIndex,
                            col: colIndex,
                            value: cellValue,
                            campo: plantilla.campos[colIndex] || 'Campo'
                        });
                    }
                });
            });
        });
        }
        
        
        if (globalResults.length > 0) {
            let html = `<div style="font-weight: bold; margin-bottom: 8px;">${globalResults.length} coincidencias en ${new Set(globalResults.map(r => r.plantillaIndex)).size} plantillas:</div>`;
            
            globalResults.slice(0, 20).forEach((result, index) => { 
                html += `
                    <div style="padding: 4px; border-bottom: 1px solid #eee; cursor: pointer; hover: background-color: #f0f0f0;" 
                         onclick="jumpToGlobalResult(${result.plantillaIndex}, ${result.row}, ${result.col})" 
                         title="Hacer clic para ir a este resultado">
                        <div style="font-weight: bold; color: #0078d4;">${result.plantillaTitulo}</div>
                        <div style="font-size: 10px; color: #666;">Fila ${result.row + 1}, ${result.campo}: "${result.value}"</div>
                    </div>
                `;
            });
            
            if (globalResults.length > 20) {
                html += `<div style="padding: 4px; font-style: italic; color: #666;">... y ${globalResults.length - 20} más</div>`;
            }
            
            resultsList.innerHTML = html;
            resultsDiv.style.display = 'block';
        } else {
            resultsList.innerHTML = '<div style="padding: 8px; color: #666;">No se encontraron coincidencias en ninguna plantilla</div>';
            resultsDiv.style.display = 'block';
        }
    }
    
    // NUEVO: Función global para saltar a resultado (debe estar en scope global)
    window.jumpToGlobalResult = function(plantillaIndex, row, col) {
        if (plantillaIndex < 0 || plantillaIndex >= plantillas.length) return;
        
        // Actualizar plantilla correspondiente
        selectedTemplateId = plantillas[plantillaIndex].id;
        localStorage.setItem('selectedWorksheetTemplateId', selectedTemplateId);
        
        // renderizar con la nueva plantilla
        const container = document.getElementById('worksheetTableContainer');
        if (container) {
            reRenderTable(plantillas[plantillaIndex]);
        }
        
        // Esperar un momento y luego destacar la celda
        setTimeout(() => {
            const cell = getCellElement(row, col);
            if (cell) {
                // Función segura para evitar errores en modo compartido
                const td = safeClosest(cell, 'td');
                if (td) {
                td.style.backgroundColor = '#ffeb3b';
                td.style.border = '3px solid #ff6b35';
                    
                    try {
                td.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                    } catch (error) {
                
                    }
                
                // Quitar resaltado después de 3 segundos
            setTimeout(() => {
                    td.style.backgroundColor = '';
                    td.style.border = '';
                }, 3000);
                }
                
                // enfocar la celda
                cell.focus();
            }
        }, 300);
        
        showClipboardIndicator(`✅ Navegado a ${plantillas[plantillaIndex].titulo || 'Plantilla'} - Fila ${row + 1}`);
    };
    
    // Event listeners estilo Bloc de Notas (sin búsqueda automática)
    
    // No buscar automáticamente
    document.getElementById('searchInput').addEventListener('input', function() {
        // Limpiar resultados anteriores cuando se cambia el texto
        searchResults = [];
        currentResultIndex = -1;
        clearSearchHighlights();
        
        
        if (this.value.trim() === '') {
            document.getElementById('searchStatus').textContent = 'Escriba texto y use las flechas ▲▼ para buscar';
        } else {
            document.getElementById('searchStatus').textContent = 'Use las flechas ▲▼ para buscar';
        }
    });
    
    // navegación
    document.getElementById('btnSearchUp').addEventListener('click', () => performSearch(-1));
    document.getElementById('btnSearchDown').addEventListener('click', () => performSearch(1));
    
    // enter en campo de búsqueda = buscar siguiente
    document.getElementById('searchInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            performSearch(e.shiftKey ? -1 : 1); // Shift+Enter = anterior, Enter = siguiente
        } else if (e.key === 'Escape') {
            // Cerrar con Escape
            closeModal();
        }
    });
    
    // reemplazar todo
    document.getElementById('btnReemplazarTodos').addEventListener('click', performReplaceAll);
    
    // enter en campo de reemplazo = reemplazar todo
    document.getElementById('replaceInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            performReplaceAll();
        } else if (e.key === 'Escape') {
            closeModal();
        }
    });
    
    
    document.getElementById('globalSearchInput').addEventListener('input', performGlobalSearch);
    document.getElementById('btnGlobalSearch').addEventListener('click', performGlobalSearch);
    
    // enter en búsqueda global
    document.getElementById('globalSearchInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            performGlobalSearch();
        } else if (e.key === 'Escape') {
            closeModal();
        }
    });
    
    // NUEVO: Función para cerrar modal
    function closeModal() {
        clearSearchHighlights();
        modal.remove();
    }
    
    
    document.getElementById('btnCerrarModal').addEventListener('click', closeModal);
    
    
    const titleBar = modal.querySelector('.modal-titlebar');
    let isDragging = false;
    let currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;
    
    titleBar.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        titleBar.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            modal.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    });
    
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            titleBar.style.cursor = 'move';
        }
    });
    
    
    setTimeout(() => {
        document.addEventListener('click', function handleOutsideClick(e) {
            if (e.target === modal) {
                closeModal();
                document.removeEventListener('click', handleOutsideClick);
            }
        });
    }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
    
}

// NUEVO: Event listener global para Ctrl+B (abrir buscar y reemplazar)
document.addEventListener('keydown', function(e) {
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        showSearchReplaceDialog();
    }
});

// FUNCIÓN GLOBAL: Detectar si una celda tiene color de bloque
function hasBlockColor(celda) {
    try {
        if (!celda || !celda.style) return false;
        
        const bgStyle = celda.style.background || celda.style.backgroundColor || '';
        const coloresBloque = ['#4caf50', '#e74c3c', '#2196f3', '#ff9800', '#9c27b0', '#e91e63', '#000000'];
        return coloresBloque.some(color => bgStyle.includes(color));
    } catch (error) {
        return false;
    }
}

// Generar HTML de celdas de tabla (elimina 30+ líneas duplicadas)
function generateTableCells(fila, realRowIdx, plantilla, bloqueColores, duplicadosCorreo, duplicadosContraseña, duplicadosLinks) {
    let html = '';
    const numeroFila = realRowIdx + 1;
    
    // numeración
    html += `<td class='col-numeracion' data-row-header='true' data-row-index="${realRowIdx}">${numeroFila}</td>`;
    
    
    fila.forEach((valor, colIdx) => {
        const campo = plantilla.campos[colIdx];
        let styleStr = '';
        
        // OPTIMIZADO: Duplicados amarillos tienen PRIORIDAD ABSOLUTA sobre cualquier color
        const cellKey = `${realRowIdx}-${colIdx}`;
        let isDuplicado = false;
        
        // Verificar duplicados sin importar filtros (los duplicados son más importantes)
            isDuplicado = duplicadosCorreo.has(cellKey) || duplicadosContraseña.has(cellKey) || duplicadosLinks.has(cellKey);
        
        if (isDuplicado) {
            // PRIORIDAD ABSOLUTA: Duplicados amarillos SIEMPRE se muestran, incluso sobre colores de bloque
            styleStr = 'background: #ffeb3b !important; color: #333 !important; border: 2px solid #ffc107 !important; font-weight: bold !important;';
        } else if (bloqueColores[colIdx]) {
            // Solo aplicar colores de bloque si NO es duplicado
            styleStr = `background:${bloqueColores[colIdx].color} !important;color:${bloqueColores[colIdx].textColor} !important;border-color:${bloqueColores[colIdx].borderColor} !important;`;
        }
        
        // NUEVO: Aplicar formato guardado en modo copiar
        if (worksheetMode === 'copiar' && plantilla.formato) {
            const cellId = `${realRowIdx}-${colIdx}`;
            const storedFormat = plantilla.formato[cellId];
            if (storedFormat) {
                if (storedFormat.backgroundColor) {
                    styleStr += `background-color:${storedFormat.backgroundColor} !important;`;
                }
                if (storedFormat.color) {
                    styleStr += `color:${storedFormat.color} !important;`;
                }
                if (storedFormat.fontWeight === 'bold') {
                    styleStr += `font-weight:bold !important;`;
                }
                if (storedFormat.textDecoration === 'underline') {
                    styleStr += `text-decoration:underline !important;`;
                }
            }
        }
        
        // NUEVO: Agregar clase duplicate-cell si es duplicado
        const duplicateClass = isDuplicado ? 'duplicate-cell' : '';
        
        if (campo === 'numero') {
            html += `<td class="col-numero ${duplicateClass}" style="${styleStr}" data-row-index="${realRowIdx}" data-col-index="${colIdx}">${renderEditableCell(campo, valor, realRowIdx, colIdx)}</td>`;
        } else if (campo === 'let') {
            html += `<td class="col-let ${duplicateClass}" style="${styleStr}" data-row-index="${realRowIdx}" data-col-index="${colIdx}">${renderEditableCell(campo, valor, realRowIdx, colIdx)}</td>`;
        } else if (campo === 'letras') {
            html += `<td class="col-letras ${duplicateClass}" style="${styleStr}" data-row-index="${realRowIdx}" data-col-index="${colIdx}">${renderEditableCell(campo, valor, realRowIdx, colIdx)}</td>`;
        } else if (campo === 'contraseña') {
            html += `<td class="col-contraseña ${duplicateClass}" style="${styleStr}" data-row-index="${realRowIdx}" data-col-index="${colIdx}">${renderEditableCell(campo, valor, realRowIdx, colIdx)}</td>`;
        } else if (campo === 'links') {
            html += `<td class="col-links ${duplicateClass}" style="${styleStr}" data-row-index="${realRowIdx}" data-col-index="${colIdx}">${renderEditableCell(campo, valor, realRowIdx, colIdx)}</td>`;
        } else {
            html += `<td class="${duplicateClass}" style="${styleStr}" data-row-index="${realRowIdx}" data-col-index="${colIdx}">${renderEditableCell(campo, valor, realRowIdx, colIdx)}</td>`;
        }
    });
    
    return html;
}
// Manejar event listener para campo número (elimina 15+ líneas duplicadas)
function handleNumeroFieldInput(input, realFilaIdx, colIdx, plantilla, fieldNames, container, idx) {
    input.addEventListener('keydown', function(e) {
        // Guardar posición activa para persistencia cuando escribes en campo número
        saveActiveCellPosition(realFilaIdx, colIdx);
        
        if ((e.key >= '1' && e.key <= '6') || e.key === '8') {
            e.preventDefault();
            input.value = e.key;
            tablaDatos[realFilaIdx][colIdx] = e.key;
            plantilla.datos = tablaDatos;
            
            // OPTIMIZADO: Aplicar color inmediatamente al presionar número
            renderCellFormat(input, 'numero', e.key);
            
            // NUEVO: Aplicar coloreado correcto en tiempo real (izquierda hasta número)
            const td = safeClosest(input, 'td');
            if (td) {
                const rowIndex = parseInt(td.getAttribute('data-row-index'));
                const colIndex = parseInt(td.getAttribute('data-col-index'));
                const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
                if (rowIndex !== null && colIndex !== null && currentPlantilla) {
                    applyCorrectNumberColoring(rowIndex, colIndex, e.key, currentPlantilla);
                }
            }
            
            // OPTIMIZADO: Guardar inmediatamente sin interferir con navegación
            saveWorksheetData(plantilla);
        } else if (e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Enter' && e.key !== 'F5' && e.key !== 'F12') {
            // ignorar teclas no válidas, pero no borrar el valor existente
            e.preventDefault();
            // No borrar el valor, solo prevenir entrada no válida
        }
    });
    
    // NUEVO: Agregar listener de input para móviles
    input.addEventListener('input', function(e) {
        const value = e.target.value;
        const lastChar = value.slice(-1);
        
        // Guardar posición activa para persistencia en móviles
        saveActiveCellPosition(realFilaIdx, colIdx);
        
        // Permitir no solo números válidos
        if (value !== '') {
            // Mantener el valor tal como está, sin validación restrictiva
            tablaDatos[realFilaIdx][colIdx] = value;
            plantilla.datos = tablaDatos;
            
            // OPTIMIZADO: NO renderizar formato durante escritura para evitar re-renderizado
            // El formato se aplicará automáticamente al cambiar de celda
            
            // El color se aplica automáticamente en renderCellFormat
            
            // OPTIMIZADO: Coloreado inmediato sin delay para evitar parpadeo
            forceUpdateAllNumberColors();
            
            // Guardar inmediatamente con callback de confirmación
            saveWorksheetData(plantilla, () => {
                // OPTIMIZADO: Debounce para duplicados en callback de guardado
                if (window.duplicateStylesTimeout) {
                    clearTimeout(window.duplicateStylesTimeout);
                }
                window.duplicateStylesTimeout = setTimeout(() => {
                updateDuplicateStyles(plantilla, 0);
                    window.duplicateStylesTimeout = null;
                }, 200);
                
                // NUEVO: Actualizar colores de bloque en tiempo real
                updateBlockColors(realFilaIdx, plantilla);
            }, (error) => {
                showClipboardIndicator('❌ Error guardando número');
            });
        } else {
            
            tablaDatos[realFilaIdx][colIdx] = '';
            plantilla.datos = tablaDatos;
            renderCellFormat(input, 'numero', '');
            // OPTIMIZADO: Limpiar colores inmediatamente sin delay para evitar parpadeo
            forceUpdateAllNumberColors();
            saveWorksheetData(plantilla, () => {
                updateDuplicateStyles(plantilla, 0);
                // NUEVO: Actualizar colores de bloque en tiempo real
                updateBlockColors(realFilaIdx, plantilla);
            }, (error) => {
                showClipboardIndicator('❌ Error limpiando número');
            });
        }
    });
    
    // NUEVO: Listener para blur (cuando el campo pierde foco) en móviles
    input.addEventListener('blur', function(e) {
        const value = e.target.value;
        
        // Permitir no solo números válidos
        if (value !== '') {
            // cuando el campo pierde foco
            if (tablaDatos[realFilaIdx][colIdx] !== value) {
                tablaDatos[realFilaIdx][colIdx] = value;
                plantilla.datos = tablaDatos;
                
                saveWorksheetData(plantilla, () => {
                    updateDuplicateStyles(plantilla, 0);
                    updateBlockColors(realFilaIdx, plantilla);
                }, (error) => {
                    showClipboardIndicator('❌ Error guardando número');
                });
            }
        }
    });
    
    renderCellFormat(input, 'numero', input.value);
}

// Manejar event listener estándar de input para cualquier campo (elimina 20+ líneas duplicadas)
function handleStandardFieldInput(input, realFilaIdx, colIdx, campo, plantilla) {
    // CORREGIDO: Sistema de guardado robusto para evitar pérdida de datos
    let saveTimeout;
    let isSaving = false;
    
    input.addEventListener('input', function() {
        // Guardar posición activa para persistencia cuando escribes en cualquier campo
        saveActiveCellPosition(realFilaIdx, colIdx);
        
        let val = formatFieldValue(input.value, campo);
        input.value = val;
        tablaDatos[realFilaIdx][colIdx] = val;
        plantilla.datos = tablaDatos;
        
        // Aplicar formato en tiempo real solo para números
        if (campo === 'numero') {
            renderCellFormat(input, campo, val);
            // Aplicar color a toda la fila en tiempo real
            applyRowColorInRealTime(realFilaIdx, colIdx, val, plantilla);
        }
        
        // OPTIMIZADO: NO actualizar duplicados durante escritura para máxima fluidez
        // Los duplicados se actualizarán automáticamente al:
        // - Pegar datos
        // - Cambiar de celda (blur)
        // - Guardar la plantilla
        // - Cambiar de modo
        // Esto garantiza escritura 100% fluida sin interrupciones visuales
        
        // CORREGIDO: Guardado inmediato para datos críticos, debounce para optimización
        if (isSaving) {
            // Si ya está guardando, cancelar el timeout anterior y programar uno nuevo
            clearTimeout(saveTimeout);
        }
        
        saveTimeout = setTimeout(() => {
            if (!isSaving) {
                isSaving = true;
                saveWorksheetDataUnified(plantilla, { silent: true })
                    .finally(() => {
                        isSaving = false;
                    });
            }
        }, 200); // Reducido de 500ms a 200ms para mayor responsividad
    });
    
    // CORREGIDO: Guardar inmediatamente al salir del campo (blur) sin mensaje
    input.addEventListener('blur', function() {
        clearTimeout(saveTimeout);
        if (!isSaving) {
            isSaving = true;
            saveWorksheetDataUnified(plantilla, { silent: true })
                .finally(() => {
                    isSaving = false;
                });
        }
    });
}

// Event listeners a una celda
function attachCellEventListeners(input, realFilaIdx, colIdx, campo, plantilla, fieldNames, container, idx, isFilterMode = false) {
    if (!input) return;
    
    if (campo === 'numero' && !isFilterMode) {
        // Manejar números solo en modo estándar
        handleNumeroFieldInput(input, realFilaIdx, colIdx, plantilla, fieldNames, container, idx);
    } else {
        // manejar input estándar
        handleStandardFieldInput(input, realFilaIdx, colIdx, campo, plantilla);
        
        // listener de paste solo si no estamos en modo filtro simple
        if (!isFilterMode) {
            addPasteListener(input, realFilaIdx, colIdx, campo, plantilla);
        } else {
            addSimplePasteListener(input, realFilaIdx, colIdx, campo, plantilla);
        }
    }
}

// PASO 6: Listener restaurado
function addPasteListener(input, realFilaIdx, colIdx, campo, plantilla) {
    input.addEventListener('paste', function(e) {
        const paste = (e.clipboardData || window.clipboardData).getData('text');
        // sin saltos de línea ni tabs), dejar que el input lo maneje
        if (!paste.includes('\n') && !paste.includes('\t')) {
            // No prevenir el evento, dejar que el input lo maneje normalmente
            
            setTimeout(() => {
                let val = formatFieldValue(input.value, campo);
                input.value = val;
                
                tablaDatos[realFilaIdx][colIdx] = val;
                plantilla.datos = tablaDatos;
                renderCellFormat(input, campo, val);
                
                // actualizar backend
                saveWorksheetData(plantilla);
                
                // Actualizar duplicados si es necesario - INMEDIATO
                if (isEmailOrPasswordField(campo)) {
                    updateDuplicateStyles(plantilla, 0);
                }
            }, 5); // Optimizado para hojas de cálculo - reducido de 10ms a 5ms
            return;
        }
        
        // sin saltos de línea o tabs), usar nuestro sistema mejorado
        e.preventDefault();
        
        // nuestro sistema mejorado de pegado
        const targetCell = { row: realFilaIdx, col: colIdx };
        pasteSystemClipboard(paste);
    });
}

// Función faltante para paste listener simple
function addSimplePasteListener(input, realFilaIdx, colIdx, campo, plantilla) {
    input.addEventListener('paste', function(e) {
        const paste = (e.clipboardData || window.clipboardData).getData('text');
        
        
        if (!paste.includes('\n') && !paste.includes('\t')) {
            // No prevenir el evento, dejar que el input lo maneje normalmente
            setTimeout(() => {
                let val = formatFieldValue(input.value, campo);
                input.value = val;
                
                tablaDatos[realFilaIdx][colIdx] = val;
                plantilla.datos = tablaDatos;
                renderCellFormat(input, campo, val);
                
                // actualizar backend
                saveWorksheetData(plantilla);
                
                // Actualizar duplicados si es necesario - INMEDIATO
                if (isEmailOrPasswordField(campo) || campo === 'links') {
                    updateDuplicateStyles(plantilla, 0);
                }
            }, 5); // Optimizado para hojas de cálculo - reducido de 10ms a 5ms
        } else {
            // Contenido complejo, prevenir el evento y mostrar mensaje
            e.preventDefault();
    
        }
    });
}

// Plantillas desde API (elimina 3 llamadas duplicadas)
function loadWorksheetTemplates(successCallback, errorCallback) {
    fetch('/api/store/worksheet_templates')
        .then(res => {
            // Verificar antes de procesar
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return res.json();
        })
        .then(plantillasApi => {
            plantillas = plantillasApi.map(p => ({
                id: p.id,
                titulo: p.title,
                campos: p.fields,
                datos: undefined // Se cargará al seleccionar
            }));
            if (successCallback) successCallback(plantillas);
        })
        .catch(error => {
            // Actualizar plantillas
            if (errorCallback) errorCallback(error);
        });
}
// Nueva plantilla (elimina 2 llamadas duplicadas)
// NUEVO: Modal de gestión de permisos de acceso a hojas de cálculo
function showPermissionsModal() {
    // Verificar gestión de permisos en modo compartido
    if (window.isSharedMode) {

        alert('Solo el administrador puede gestionar permisos.');
        return;
    }
    
    // Eliminar modal anterior si existe
    const existingModal = document.querySelector('.permissions-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.className = 'permissions-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0,0,0,0.5);
        z-index: 2600;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    modal.innerHTML = `
        <div style='background: white; border-radius: 8px; width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);'>
            <!-- Header -->
            <div style='background: #28a745; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;'>
                <h3 style='margin: 0; font-size: 18px;'><i class="fas fa-users-cog"></i> Gestionar Permisos de Acceso</h3>
                <button id='btnCerrarPermisos' style='background: none; border: none; color: white; font-size: 20px; cursor: pointer;'>✕</button>
            </div>
            
            <!-- Contenido -->
            <div style='padding: 20px;'>
                <!-- Opciones de permisos -->
                <div style='margin-bottom: 20px;'>
                    <h4 style='margin-bottom: 12px; color: #333;'>Tipo de acceso:</h4>
                    <div style='display: flex; flex-direction: column; gap: 12px;'>
                        <label style='display: flex; align-items: center; cursor: pointer; padding: 8px; border: 1px solid #ddd; border-radius: 4px; transition: background 0.2s;' class='permission-option' data-type='general'>
                            <input type='radio' name='permissionType' value='general' checked style='margin-right: 10px;'>
                            <i class='fas fa-globe' style='margin-right: 8px; color: #007bff;'></i>
                            <div>
                                <strong>Configuración General</strong>
                                <div style='font-size: 12px; color: #666;'>Privado, público solo lectura o público editable</div>
                            </div>
                        </label>
                        <label style='display: flex; align-items: center; cursor: pointer; padding: 8px; border: 1px solid #ddd; border-radius: 4px; transition: background 0.2s;' class='permission-option' data-type='users'>
                            <input type='radio' name='permissionType' value='users' style='margin-right: 10px;'>
                            <i class='fas fa-users' style='margin-right: 8px; color: #28a745;'></i>
                            <div>
                                <strong>Gestionar Usuarios Específicos</strong>
                                <div style='font-size: 12px; color: #666;'>Dar o revocar acceso a usuarios específicos</div>
                            </div>
                        </label>
                    </div>
                </div>
                
                <!-- Panel de configuración general -->
                <div id='generalPanel' style='border: 1px solid #ddd; border-radius: 4px; padding: 16px; background: #f8f9fa; margin-bottom: 16px;'>
                    <h5 style='margin-bottom: 12px; color: #333;'>Seleccionar nivel de acceso:</h5>
                    <div style='display: flex; flex-direction: column; gap: 8px;'>
                        <label style='display: flex; align-items: center; cursor: pointer; padding: 6px;'>
                            <input type='radio' name='generalAccessType' value='private' checked style='margin-right: 8px;'>
                            <i class='fas fa-lock' style='margin-right: 6px; color: #dc3545;'></i>
                            <span>Solo yo (Privado)</span>
                        </label>
                        <label style='display: flex; align-items: center; cursor: pointer; padding: 6px;'>
                            <input type='radio' name='generalAccessType' value='view' style='margin-right: 8px;'>
                            <i class='fas fa-eye' style='margin-right: 6px; color: #ffc107;'></i>
                            <span>Compartir para todos - Solo ver</span>
                        </label>
                        <label style='display: flex; align-items: center; cursor: pointer; padding: 6px;'>
                            <input type='radio' name='generalAccessType' value='edit' style='margin-right: 8px;'>
                            <i class='fas fa-edit' style='margin-right: 6px; color: #007bff;'></i>
                            <span>Compartir para todos - Ver y editar</span>
                        </label>
                    </div>
                </div>
                
                <!-- Panel de usuarios específicos (oculto inicialmente) -->
                <div id='usersPanel' style='display: none; border: 1px solid #ddd; border-radius: 4px; padding: 16px; background: #f8f9fa;'>
                    
                    <!-- Gestionar accesos de usuarios -->
                    <div id='addUsersSection'>
                        <h6 style='margin-bottom: 8px; color: #007bff;'><i class='fas fa-users'></i> Gestionar accesos de usuarios:</h6>
                    
                    <!-- Buscador de usuarios -->
                        <div style='margin-bottom: 12px; position: relative'>
                            <input type='text' id='userSearchInput' placeholder='Buscar usuarios...' class='form-control' style='padding-right: 30px;'>
                        <button id='clearUserSearch' class='search-clear-btn' style='position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #999; cursor: pointer; font-size: 16px; display: none;'><i class='fas fa-times'></i></button>
                    </div>
                    
                        <!-- Lista unificada de usuarios -->
                        <div id='unifiedUsersList' style='max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; background: white; padding: 8px;'>
                        <div style='text-align: center; padding: 20px; color: #666;'>
                            <i class='fas fa-spinner fa-spin'></i> Cargando usuarios...
                        </div>
                        </div>
                    </div>
                </div>
                
                <!-- Panel de enlaces generados -->
                <div id='linksPanel' style='display: none; border: 1px solid #ddd; border-radius: 4px; padding: 16px; background: #f8f9fa; margin-top: 16px;'>
                    <h5 style='margin-bottom: 12px; color: #333;'><i class='fas fa-link'></i> Enlace generado:</h5>
                    <div style='display: flex; align-items: center; gap: 8px;'>
                        <input type='text' id='generatedLink' readonly style='flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font-family: monospace; font-size: 12px;'>
                        <button id='copyLinkBtn' style='background: #007bff; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;'><i class='fas fa-copy'></i></button>
                    </div>
                    <div style='font-size: 12px; color: #666; margin-top: 8px;'>
                        Este enlace permite acceso sin necesidad de login
                    </div>
                </div>
                
                <!-- Botones de acción -->
                <div style='margin-top: 20px; display: flex; justify-content: space-between; gap: 12px;'>
                    <button id='btnGuardarPermisos' style='background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; flex: 1;'>
                        <i class='fas fa-save'></i> Guardar permisos
                    </button>
                    <button id='btnCancelarPermisos' style='background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;'>
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Inicialización
    let allUsers = [];
    let selectedUsers = new Set();
    
    // NUEVO: Limpiar estado inicial del modal
    function initializeModal() {
        // Asegurar que el panel de enlaces esté oculto
        const linksPanel = document.getElementById('linksPanel');
        if (linksPanel) {
            linksPanel.style.display = 'none';
        }
        
        // Limpiar el campo de enlace
        const linkInput = document.getElementById('generatedLink');
        if (linkInput) {
            linkInput.value = '';
            linkInput.style.color = '';
            linkInput.style.fontStyle = '';
        }
        
    }
    
    // Llamar inicialización inmediatamente
    initializeModal();
    
    // Event listeners para opciones de permisos
    const permissionOptions = document.querySelectorAll('.permission-option');
    const usersPanel = document.getElementById('usersPanel');
    const linksPanel = document.getElementById('linksPanel');
    const generalPanel = document.getElementById('generalPanel');
    
    permissionOptions.forEach(option => {
        option.addEventListener('click', function() {
            const type = this.dataset.type;
            
            // Limpiar estilos de todas las opciones
            permissionOptions.forEach(opt => {
                opt.style.background = '';
                opt.style.borderColor = '#ddd';
            });
            
            // Opción seleccionada
            this.style.background = '#e3f2fd';
            this.style.borderColor = '#2196f3';
            
            // Mostrar/ocultar paneles según tipo
            if (type === 'general') {
                generalPanel.style.display = 'block';
                usersPanel.style.display = 'none';
                
                // CORREGIDO: No ocultar automáticamente el panel de enlaces
                // Verificar si hay una opción de compartir seleccionada
                setTimeout(() => {
                    const selectedAccessType = document.querySelector('input[name="generalAccessType"]:checked');
                    if (selectedAccessType && (selectedAccessType.value === 'view' || selectedAccessType.value === 'edit')) {
                        linksPanel.style.display = 'block';
                    } else {
                        linksPanel.style.display = 'none';
                    }
                }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
                
                // Configurar listeners para opciones generales
                setupGeneralAccessListeners();
            } else if (type === 'users') {
                generalPanel.style.display = 'none';
                usersPanel.style.display = 'block';
                
                // CORREGIDO: No ocultar automáticamente el panel de enlaces
                // Solo ocultarlo si no hay configuración general activa
                setTimeout(() => {
                    const selectedAccessType = document.querySelector('input[name="generalAccessType"]:checked');
                    if (!selectedAccessType || selectedAccessType.value === 'private') {
                        linksPanel.style.display = 'none';
                    } else {
                        // Mantener visible si hay configuración de compartir
                    }
                }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
                
                loadUsers();
                loadCurrentUsers(); // Nueva función para cargar usuarios con acceso
            }
        });
    });
    
    // Función para configurar listeners de acceso general
    function setupGeneralAccessListeners() {
        const generalAccessOptions = document.querySelectorAll('input[name="generalAccessType"]');
        generalAccessOptions.forEach(option => {
            option.addEventListener('change', function() {
                const accessType = this.value;
                
                // CORREGIDO: Mostrar panel inmediatamente cuando se selecciona compartir
                if (accessType === 'view' || accessType === 'edit') {
                    const linksPanel = document.getElementById('linksPanel');
                    const linkInput = document.getElementById('generatedLink');
                    
                    if (linksPanel) {
                        linksPanel.style.display = 'block';
                    }
                    
                    if (linkInput) {
                        // Mostrar mensaje indicativo hasta que se guarde
                        linkInput.value = 'Presiona "Guardar permisos" para generar el enlace';
                        linkInput.style.color = '#999';
                        linkInput.style.fontStyle = 'italic';
                    }
                } else {
                    // Ocultar panel si se selecciona "Solo yo"
                    const linksPanel = document.getElementById('linksPanel');
                    if (linksPanel) {
                        linksPanel.style.display = 'none';
                    }
                    
                    // Limpiar el enlace
                    const linkInput = document.getElementById('generatedLink');
                    if (linkInput) {
                        linkInput.value = '';
                    }
                }
            });
        });
    }
    
    // Inicializar listeners para configuración general por defecto
    setupGeneralAccessListeners();
    
    // Event listeners para búsqueda de usuarios
    const userSearchInput = document.getElementById('userSearchInput');
    const clearSearchBtn = document.getElementById('clearUserSearch');
    
    userSearchInput.addEventListener('input', function() {
        const query = this.value.trim();
        clearSearchBtn.style.display = query ? 'block' : 'none';
        filterUsers(query);
    });
    
    clearSearchBtn.addEventListener('click', function() {
        userSearchInput.value = '';
        this.style.display = 'none';
        filterUsers('');
    });
    
    // Event listener para copiar enlace
    document.getElementById('copyLinkBtn').addEventListener('click', function() {
        const linkInput = document.getElementById('generatedLink');
        linkInput.select();
        navigator.clipboard.writeText(linkInput.value).then(() => {
            this.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => {
                this.innerHTML = '<i class="fas fa-copy"></i>';
            }, 2000);
        });
    });
    
    // Event listeners para botones de acción
    document.getElementById('btnGuardarPermisos').addEventListener('click', savePermissions);
    document.getElementById('btnCancelarPermisos').addEventListener('click', () => modal.remove());
    document.getElementById('btnCerrarPermisos').addEventListener('click', () => modal.remove());
    
    // NUEVO: Agregar botón "Cerrar" después de guardar exitosamente
    function addCloseButtonAfterSave() {
        const buttonsContainer = document.querySelector('.permissions-modal .modal-content > div:last-child');
        if (buttonsContainer && !document.getElementById('btnCerrarDespuesGuardar')) {
            const closeBtn = document.createElement('button');
            closeBtn.id = 'btnCerrarDespuesGuardar';
            closeBtn.style.cssText = 'background: #17a2b8; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-left: 8px;';
            closeBtn.innerHTML = '<i class="fas fa-times"></i> Cerrar';
            closeBtn.addEventListener('click', () => modal.remove());
            buttonsContainer.appendChild(closeBtn);
        }
    }
    
    // Cargar permisos existentes si los hay
    loadExistingPermissions();
    
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Función para cargar permisos existentes
    async function loadExistingPermissions() {
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        if (!plantilla) return;
        
        
        try {
            // Obteniendo permisos existentes para plantilla
            
            const response = await fetch(`/api/store/worksheet_permissions/${plantilla.id}`);
            
            if (response.ok) {
                const data = await response.json();
                
                // CORREGIDO: Manejar múltiples permisos independientes
                if (data.permissions && Object.keys(data.permissions).length > 0) {
                    const permissions = data.permissions;
                    
                    // Determinar qué pestaña activar basado en prioridad
                    let generalPermission = null;
                    let hasUsersPermission = false;
                    
                    // Verificar permisos generales - PRIORIDAD: Solo debe haber uno
                    
                    // CORREGIDO: Dar prioridad a edit sobre view
                    if (permissions.edit) {
                        generalPermission = permissions.edit;
                    } else if (permissions.view) {
                        generalPermission = permissions.view;
                    } else if (permissions.private) {
                        generalPermission = permissions.private;
                    }
                    
                    // Verificar permisos de usuarios
                    if (permissions.users) hasUsersPermission = true;
                    
                    
                    // CORREGIDO: Sistema independiente - mostrar permisos generales si existen
                    if (generalPermission) {
                        
                        // Seleccionar "Configuración General"
                        const generalRadio = document.querySelector(`input[name="permissionType"][value="general"]`);
                        if (generalRadio) {
                            generalRadio.checked = true;
                            const permissionOption = safeClosest(generalRadio, '.permission-option');
                        if (permissionOption) {
                            permissionOption.click();
                        }
                    }
                    
                        // CORREGIDO: Función mejorada para seleccionar el radio correcto
                        function selectSpecificRadio(attempts = 0) {
                            const maxAttempts = 15;
                            const specificRadio = document.querySelector(`input[name="generalAccessType"][value="${generalPermission.access_type}"]`);
                            
                            
                            if (specificRadio) {
                                // Limpiar cualquier selección previa
                                document.querySelectorAll('input[name="generalAccessType"]').forEach(r => r.checked = false);
                                
                                // Seleccionar el correcto
                                specificRadio.checked = true;
                                
                                // NUEVO: Forzar el evento change para asegurar que se mantenga
                                specificRadio.dispatchEvent(new Event('change', { bubbles: true }));
                                
                                // Verificar que realmente se seleccionó y se mantuvo
                                setTimeout(() => {
                                    const isChecked = document.querySelector(`input[name="generalAccessType"][value="${generalPermission.access_type}"]:checked`);
                                    if (!isChecked && attempts < maxAttempts) {
                                        selectSpecificRadio(attempts + 1);
                                    } else if (isChecked) {
                                        // NUEVO: Actualizar la UI basada en la selección
                                        const accessType = generalPermission.access_type;
                                        if (accessType === 'view' || accessType === 'edit') {
                                        }
                                    } else {
                                    }
                                }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
                                
                            } else if (attempts < maxAttempts) {
                                setTimeout(() => selectSpecificRadio(attempts + 1), 150);
                            } else {
                                const allRadios = document.querySelectorAll('input[name="generalAccessType"]');
                            }
                        }
                        
                        // Iniciar selección con delay mayor
                        setTimeout(() => selectSpecificRadio(), 200);
                        
                        // Mostrar panel de enlaces si es view/edit (con o sin token)
                        if (generalPermission.access_type === 'view' || generalPermission.access_type === 'edit') {
                            setTimeout(() => {
                                const linksPanel = document.getElementById('linksPanel');
                                const linkInput = document.getElementById('generatedLink');
                                
                                if (linksPanel) {
                                    linksPanel.style.display = 'block';
                                }
                                
                                if (linkInput) {
                                    if (generalPermission.public_token) {
                                        // Si tiene token, mostrar el enlace real
                                        const baseUrl = window.location.origin;
                                        const accessType = generalPermission.access_type === 'view' ? 'readonly' : 'edit';
                                        const link = `${baseUrl}/tienda/share/worksheet/${plantilla.id}?access=${accessType}&token=${generalPermission.public_token}`;
                                        linkInput.value = link;
                                        linkInput.style.color = '';
                                        linkInput.style.fontStyle = '';
                                    } else {
                                        // Si no tiene token, mostrar mensaje indicativo
                                        linkInput.value = 'Presiona "Guardar permisos" para generar el enlace';
                                        linkInput.style.color = '#999';
                                        linkInput.style.fontStyle = 'italic';
                                    }
                                }
                            }, 300);
                        }
                    }
                    
                    // NUEVO: Manejar usuarios específicos independientemente
                    if (hasUsersPermission) {
                        
                        // Cargar usuarios específicos (siempre, independiente de la pestaña activa)
                        if (permissions.users) {
                            selectedUsers.clear();
                            if (permissions.users.users && permissions.users.users.length > 0) {
                                permissions.users.users.forEach(user => {
                                selectedUsers.add(user.id);
                            });
                            renderUnifiedUsers(allUsers);
                            }
                        }
                        
                        // Solo activar la pestaña de usuarios si NO hay permisos generales
                        if (!generalPermission) {
                            const usersRadio = document.querySelector(`input[name="permissionType"][value="users"]`);
                            if (usersRadio) {
                                usersRadio.checked = true;
                                const permissionOption = safeClosest(usersRadio, '.permission-option');
                                if (permissionOption) {
                                    permissionOption.click(); // Esto activará el panel de usuarios
                                }
                            }
                        }
                    }
                } else {
                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
        } catch (error) {
            // Error manejado silenciosamente
        }
    }
    
    // Funciones auxiliares
    async function loadCurrentUsers() {
        try {
            const plantilla = optimizedFunctions.getCurrentPlantilla();
            
            if (!plantilla) {
                // Mostrar mensaje en la lista unificada
                const unifiedList = document.getElementById('unifiedUsersList');
                if (unifiedList) {
                    unifiedList.innerHTML = `
                        <div style='text-align: center; padding: 10px; color: #666; font-style: italic;'>
                            Selecciona una plantilla primero
                        </div>
                    `;
                }
                return;
            }
            
            // Cargar permisos existentes desde el backend
            const response = await fetch(`/api/store/worksheet_permissions/${plantilla.id}`);
            
            if (!response.ok) {
                throw new Error('Error al cargar permisos');
            }
            
            const permissionsData = await response.json();
            
            // CORREGIDO: Buscar en la nueva estructura de permisos
            let currentUsers = [];
            if (permissionsData.permissions && permissionsData.permissions.users) {
                currentUsers = permissionsData.permissions.users.users || [];
            }
            
            // Actualizar selectedUsers con los usuarios actuales
            selectedUsers.clear();
            currentUsers.forEach(user => selectedUsers.add(user.id));
            
            // Usar la interfaz unificada en lugar de la antigua
            renderUnifiedUsers(allUsers);
            
        } catch (error) {
            // Error manejado silenciosamente
            const unifiedList = document.getElementById('unifiedUsersList');
            if (unifiedList) {
                unifiedList.innerHTML = `
                    <div style="text-align: center; padding: 10px; color: #dc3545;">
                        Error al cargar usuarios con acceso
                    </div>
                `;
            }
        }
    }
    
    async function loadUsers() {
        try {
            // Cargando usuarios...
            
            const response = await fetch('/api/store/usuarios');
            
            
            if (!response.ok) {
                const errorText = await response.text();
                
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const users = await response.json();
            // Usuarios obtenidos
            allUsers = users;
            renderUnifiedUsers(users);
        } catch (error) {
            
            document.getElementById('unifiedUsersList').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #dc3545;">
                    <i class="fas fa-exclamation-triangle"></i><br>
                    Error al cargar usuarios:<br>
                    <small>${error.message}</small>
                </div>
            `;
        }
    }
    
    function renderUnifiedUsers(users) {
        const unifiedList = document.getElementById('unifiedUsersList');
        
        if (!users || users.length === 0) {
            unifiedList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No hay usuarios disponibles</div>';
            return;
        }
        
        // Separar usuarios con acceso y sin acceso
        const usersWithAccess = users.filter(user => selectedUsers.has(user.id));
        const usersWithoutAccess = users.filter(user => !selectedUsers.has(user.id));
        
        let html = '';
        
        // Usuarios con acceso (arriba con botón revocar)
        if (usersWithAccess.length > 0) {
            html += '<div style="margin-bottom: 12px; padding: 8px; background: #e8f5e8; border-radius: 4px; border-left: 4px solid #28a745;">';
            html += '<div style="font-weight: bold; color: #28a745; margin-bottom: 8px;"><i class="fas fa-check-circle"></i> Con acceso:</div>';
            
            usersWithAccess.forEach(user => {
                html += `
                    <div style='display: flex; align-items: center; justify-content: space-between; padding: 8px; margin-bottom: 4px; border: 1px solid #c3e6cb; border-radius: 4px; background: white; transition: background 0.2s;' 
                         class='user-item-with-access' data-user-id='${user.id}' onmouseover='this.style.background="#f8fff8"' onmouseout='this.style.background="white"'>
                        <div>
                            <div style='font-weight: 500; color: #28a745;'>${user.username || user.name || 'Usuario'}</div>
                        </div>
                        <button onclick='revokeUserAccess(${user.id})' 
                                style='background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s;'
                                onmouseover='this.style.background="#c82333"' onmouseout='this.style.background="#dc3545"'>
                            <i class='fas fa-times'></i> Revocar
                        </button>
                    </div>
                `;
            });
            html += '</div>';
        }
        
        // Usuarios sin acceso (abajo con botón agregar)
        if (usersWithoutAccess.length > 0) {
            html += '<div style="padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #007bff;">';
            html += '<div style="font-weight: bold; color: #007bff; margin-bottom: 8px;"><i class="fas fa-user-plus"></i> Disponibles:</div>';
            
            usersWithoutAccess.forEach(user => {
                html += `
                    <div style='display: flex; align-items: center; justify-content: space-between; padding: 8px; margin-bottom: 4px; border: 1px solid #dee2e6; border-radius: 4px; background: white; transition: background 0.2s;' 
                         class='user-item-available' data-user-id='${user.id}' onmouseover='this.style.background="#f8f9fa"' onmouseout='this.style.background="white"'>
                        <div>
                    <div style='font-weight: 500;'>${user.username || user.name || 'Usuario'}</div>
                </div>
                        <button onclick='grantUserAccess(${user.id}, "${(user.username || user.name || 'Usuario').replace(/'/g, "\\'")}","${(user.email || '').replace(/'/g, "\\'")}")' 
                                style='background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s;'
                                onmouseover='this.style.background="#218838"' onmouseout='this.style.background="#28a745"'>
                            <i class='fas fa-plus'></i> Agregar
                        </button>
                    </div>
                `;
            });
            html += '</div>';
        }
        
        // Si no hay usuarios sin acceso, mostrar mensaje
        if (usersWithoutAccess.length === 0 && usersWithAccess.length > 0) {
            html += '<div style="text-align: center; padding: 12px; color: #666; font-style: italic;">Todos los usuarios disponibles tienen acceso</div>';
        }
        
        unifiedList.innerHTML = html;
    }
    
    // Funciones para gestionar accesos de usuarios
    window.grantUserAccess = async function(userId, username, email) {
        try {
            const plantilla = optimizedFunctions.getCurrentPlantilla();
            if (!plantilla) {
                showNotification('No hay plantilla seleccionada', 'error');
                return;
            }
            
            // Otorgando acceso a usuario
            
            // Agregar usuario a la lista de seleccionados
                    selectedUsers.add(userId);
            
            // Guardar permisos inmediatamente
            const permissionData = {
                worksheet_id: plantilla.id,
                type: 'users',
                users: Array.from(selectedUsers)
            };
            
            const response = await fetch('/api/store/worksheet_permissions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify(permissionData)
            });
            
            if (!response.ok) {
                throw new Error('Error al guardar permisos');
            }
            
            showNotification(`Acceso otorgado a ${username}`, 'success');
            // Actualizar la lista unificada
            renderUnifiedUsers(allUsers);
            
        } catch (error) {
            // Error manejado silenciosamente
            showNotification('Error al otorgar acceso', 'error');
        }
    }
    
    window.revokeUserAccess = async function(userId) {
        try {
            const plantilla = optimizedFunctions.getCurrentPlantilla();
            if (!plantilla) {
                showNotification('No hay plantilla seleccionada', 'error');
                return;
            }
            
            // Revocando acceso a usuario
            
            // Remover usuario de la lista de seleccionados
            selectedUsers.delete(userId);
            
            // Guardar permisos inmediatamente
            const permissionData = {
                worksheet_id: plantilla.id,
                type: 'users',
                users: Array.from(selectedUsers)
            };
            
            const response = await fetch('/api/store/worksheet_permissions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify(permissionData)
            });
            
            if (!response.ok) {
                throw new Error('Error al guardar permisos');
            }
            
            showNotification('Acceso revocado exitosamente', 'success');
            // Actualizar la lista unificada
            renderUnifiedUsers(allUsers);
            
        } catch (error) {
            // Error manejado silenciosamente
            showNotification('Error al revocar acceso', 'error');
        }
    }
    
    // Función auxiliar para mostrar notificaciones
    function showNotification(message, type = 'info') {
        // Implementación simple de notificación
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        switch(type) {
            case 'success':
                notification.style.background = '#28a745';
                break;
            case 'error':
                notification.style.background = '#dc3545';
                break;
            default:
                notification.style.background = '#007bff';
        }
        
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    function filterUsers(query) {
        if (!query) {
            renderUnifiedUsers(allUsers);
            return;
        }
        
        const filteredUsers = allUsers.filter(user => 
            (user.username && user.username.toLowerCase().includes(query.toLowerCase())) ||
            (user.name && user.name.toLowerCase().includes(query.toLowerCase())) ||
            (user.email && user.email.toLowerCase().includes(query.toLowerCase()))
        );
        
        renderUnifiedUsers(filteredUsers);
    }
    
    // DESACTIVADA: No generar enlaces automáticamente al seleccionar
    // function generatePublicLink(type) {
    //     const plantilla = optimizedFunctions.getCurrentPlantilla();
    //     if (!plantilla) return;
    //     
    //     const baseUrl = window.location.origin;
    //     const accessType = type === 'view' ? 'readonly' : 'edit';
    //     // No generar token aquí - esperar el del backend
    //     const link = `${baseUrl}/store/share/worksheet/${plantilla.id}?access=${accessType}&token=GENERANDO...`;
    //     document.getElementById('generatedLink').style.color = '#999';
    //     document.getElementById('generatedLink').style.fontStyle = 'italic';
    // }
    
    function generateToken() {
        // Generar un token más largo y seguro
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    async function savePermissions() {
        const selectedType = document.querySelector('input[name="permissionType"]:checked').value;
        const plantilla = optimizedFunctions.getCurrentPlantilla();
        
        if (!plantilla) {
            return;
        }
        
        // CORREGIDO: Determinar el tipo correcto de permiso
        let actualType = selectedType;
        if (selectedType === 'general') {
            // Si es configuración general, obtener el tipo específico
            const generalType = document.querySelector('input[name="generalAccessType"]:checked');
            if (generalType) {
                actualType = generalType.value;
            }
        }
        
        const debugInfo = {
            selectedType: selectedType,
            actualType: actualType,
            plantillaId: plantilla.id,
            selectedUsers: Array.from(selectedUsers)
        };
        
        // Guardando permisos para plantilla
        const permissionData = {
            worksheet_id: plantilla.id,
            type: actualType,
            users: actualType === 'users' ? Array.from(selectedUsers) : []
        };
        
        
        try {
            // Enviando datos de permisos
            
            const response = await fetch('/api/store/worksheet_permissions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify(permissionData)
            });
            
            
            if (response.ok) {
                const result = await response.json();
                
                            if (result.success) {
                // Permisos guardados exitosamente
                
                // Actualizar enlace con el token del backend
                if (actualType === 'view' || actualType === 'edit') {
                    const permission = result.permission;
                    if (permission && permission.public_token) {
                        const baseUrl = window.location.origin;
                        // ⭐ CORREGIDO: Usar el actualType directamente para mantener consistencia
                        // 'view' -> 'readonly', 'edit' -> 'edit'
                        const accessType = actualType === 'view' ? 'readonly' : 'edit';
                        
                        // Construir la URL del enlace - CORREGIDO: con /tienda prefix
                        const link = `${baseUrl}/tienda/share/worksheet/${plantilla.id}?access=${accessType}&token=${permission.public_token}`;
                        const linkInput = document.getElementById('generatedLink');
                        linkInput.value = link;
                        // Estilo normal
                        linkInput.style.color = '';
                        linkInput.style.fontStyle = '';
                
                        // CORREGIDO: Mostrar el panel de enlaces después de guardar
                        document.getElementById('linksPanel').style.display = 'block';
                    }
                }
                
                // Guardar en localStorage como respaldo
                const permissions = JSON.parse(localStorage.getItem('worksheet_permissions') || '{}');
                permissions[plantilla.id] = {
                    type: actualType,
                    users: actualType === 'users' ? Array.from(selectedUsers) : [],
                    timestamp: Date.now()
                };
                localStorage.setItem('worksheet_permissions', JSON.stringify(permissions));
                
                // CORREGIDO: No cerrar el modal automáticamente después de guardar
                // para permitir al usuario copiar el enlace
                // modal.remove();
                
                // Agregar botón para cerrar manualmente después de guardar
                addCloseButtonAfterSave();
            } else {
                throw new Error(result.error || 'Error desconocido');
            }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
        } catch (error) {
            // Error manejado silenciosamente
        }
    }
}


// FUNCIONES PARA MODAL DE INFORMACIÓN ADICIONAL


// Información
let currentInfoRow = -1;
let currentInfoCol = -1;

// Función para mostrar el modal de información
function showInfoModal(row, col, currentValue) {
    currentInfoRow = row;
    currentInfoCol = col;
    
    // Crear modal si no existe
    let modal = document.getElementById('infoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'infoModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'position:fixed;top:0;left:0 !important;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:2000;display:none;align-items:center;justify-content:center;';
        
        modal.innerHTML = `
            <div style='background:#fff;padding:20px 20px;border-radius:10px;min-width:250px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.15);margin:0;position:relative;left:-20px;transform:none;'>
                <div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;'>
                    <h4 style='margin:0;color:#333;'>Información Adicional</h4>
                    <span onclick="closeInfoModal()" style='cursor:pointer;font-size:24px;color:#666;'>&times;</span>
                </div>
                <div style='margin-bottom:20px;'>
                    <textarea id="infoModalTextarea" placeholder="Escribe la información adicional aquí..." 
                              style='width:calc(100% - 4px);min-height:120px;padding:12px;border:2px solid #000;border-radius:4px;resize:vertical;font-family:inherit;box-sizing:border-box;'></textarea>
                </div>
                <div style='display:flex;gap:10px;justify-content:center;'>
                    <button onclick="closeInfoModal()" style='background:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Cancelar</button>
                    <button onclick="saveInfoModal()" style='background:#28a745;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;'>Guardar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    const textarea = document.getElementById('infoModalTextarea');
    textarea.value = currentValue || '';
    modal.style.display = 'flex';
    
    // No auto-enfocar el textarea para evitar que se abra el teclado en móviles
}

// Función para cerrar el modal de información
function closeInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentInfoRow = -1;
    currentInfoCol = -1;
}

// Función para guardar la información del modal
function saveInfoModal() {
    const textarea = document.getElementById('infoModalTextarea');
    const newValue = textarea.value;
    
    if (currentInfoRow >= 0 && currentInfoCol >= 0) {
        // Actualizar tablaDatos
        if (!tablaDatos[currentInfoRow]) {
            tablaDatos[currentInfoRow] = [];
        }
        tablaDatos[currentInfoRow][currentInfoCol] = newValue;
        
        // Actualizar plantilla actual con funciones compatibles
        try {
    
            
            // Funciones compatibles con modo compartido
            const plantilla = window.isSharedMode ? window.currentPlantilla : (optimizedFunctions.getCurrentPlantilla ? optimizedFunctions.getCurrentPlantilla() : null);
            
    
            
        if (plantilla) {
            plantilla.datos = tablaDatos;
            
            // Renderizar la tabla para mostrar los cambios
                const container = document.getElementById('worksheetTableContainer');
                const currentPlantillaIndex = window.isSharedMode ? 0 : (optimizedFunctions.getPlantillaIndex ? optimizedFunctions.getPlantillaIndex(plantilla) : 0);
                
        
        
                
            if (container && currentPlantillaIndex >= 0) {
                    // Funciones compatibles
                    const fieldNames = window.isSharedMode ? 
                        (window.fields || []) : 
                        (typeof getStandardFieldNames === 'function' ? getStandardFieldNames() : []);
                    
            
            
                    
                    if (typeof renderTablaEditable === 'function') {
                        renderTablaEditable(plantilla, fieldNames, container, currentPlantillaIndex);
                
                    } else {
                
                    }
            }
            
            
                if (window.isSharedMode) {
                    // En modo compartido, usar saveWorksheetData
            
                    if (typeof saveWorksheetData === 'function') {
                        saveWorksheetData(plantilla);
                
                    } else {
                
                    }
                } else {
                    // En modo admin, usar saveWorksheetDataSilent si está disponible
            
                if (typeof saveWorksheetDataSilent === 'function') {
            saveWorksheetDataSilent(plantilla);
                
                    } else {
                
                    }
                }
                
                // Actualización de colores con debounce (solo en modo admin)
                if (!window.isSharedMode && typeof debounceManager !== 'undefined' && debounceManager.debounce) {
                debounceManager.debounce(() => {
                    if (typeof forceUpdateAllNumberColors === 'function') {
                        forceUpdateAllNumberColors();
                    }
                }, 100, 'infoModalColorUpdate');
                }
            }
        } catch (error) {
    
        }
    }
    
    closeInfoModal();
}


document.addEventListener('click', function(event) {
    const modal = document.getElementById('infoModal');
    if (modal && event.target === modal) {
        closeInfoModal();
        }
});

// Con la tecla Escape
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeInfoModal();
    }
});
// NUEVO: Verificar si el usuario está editando activamente
function isActivelyEditing() {
    // Verificar si hay input/textarea enfocado
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return true;
    }
    
    // Verificar modo edición
    const editingCell = document.querySelector('.editing');
    return editingCell !== null;
}

function pauseSync(duration = 5000) {
    isSyncEnabled = false;
    
    
    setTimeout(() => {
        isSyncEnabled = true;

    }, duration);
}


function updateLastKnownTime(explicitTimestamp = null) {
    const previousTime = lastKnownEditTime;
    
    if (explicitTimestamp) {
        lastKnownEditTime = explicitTimestamp;


    } else {
        lastKnownEditTime = new Date().toISOString();


    }
}

// Inicializar sincronización en AMBOS modos cuando se carga una plantilla
const originalMostrarTablaPlantilla = mostrarTablaPlantilla;
mostrarTablaPlantilla = function(index, resetSelection = true) {
    const result = originalMostrarTablaPlantilla.call(this, index, resetSelection);
    
    // Tanto admin como compartido necesitan sincronización bidireccional
    
    initializeRealTimeSync();
    
    return result;
};


// NUEVO: VARIABLES DE SINCRONIZACIÓN EN TIEMPO REAL


let isSyncEnabled = true;
let lastKnownEditTime = null;
let syncInterval = null;
let isCurrentlyUpdating = false;
let fastSyncMode = false; // NUEVO: Modo de sincronización rápida después de cambios
let fastSyncTimeout = null;

// Inicializar sincronización en AMBOS modos (bidireccional)
function initializeRealTimeSync() {
    // También debe escuchar cambios de usuarios compartidos
    if (window.isSharedMode) {

    } else {

    }
    
    
    
    // Limpiar interval anterior si existe
    if (syncInterval) {
        clearInterval(syncInterval);
    }
    
    // Tiempo inicial
    lastKnownEditTime = new Date().toISOString();
}

// Función segura para llamar checkForRemoteChanges
function safeCheckForRemoteChanges() {
    checkForRemoteChanges().catch(error => {
        // Error silencioso para evitar spam en consola
    });
}

// UNIVERSAL DE CONVERSIÓN: Convertir TODAS las instancias problemáticas
function initializeUniversalClosestProtection() {
    if (universalClosestProtectionSetup) {
        // Ya configurado
        return;
    }
    universalClosestProtectionSetup = true;
    
    let conversionsCount = 0;
    
    // Funciones problemáticas en tiempo real
    const originalFunctions = [];
    
    // Función para interceptar y proteger cualquier uso de closest
    function protectElementClosest() {
        if (typeof Element !== 'undefined' && Element.prototype && !Element.prototype._closestProtected) {
            const originalClosest = Element.prototype.closest;
            
            Element.prototype.closest = function(selector) {
                try {
                    if (typeof originalClosest === 'function') {
                        return originalClosest.call(this, selector);
                    } else {
                        // Implementación manual si closest no está disponible
                        let element = this;
                        while (element && element !== document) {
                            if (element.matches && element.matches(selector)) {
                                return element;
                            }
                            element = element.parentElement;
                        }
                        return null;
                    }
                } catch (error) {
                    // Error silencioso
                    return null;
                }
            };
            
            Element.prototype._closestProtected = true;
            conversionsCount++;
    
        }
    }
    
    // Protección robusta de event.target.closest 
    function protectEventTargetClosest() {
        // Interceptar solo document.addEventListener que es más seguro
        const originalDocumentAddEventListener = document.addEventListener;
        
        document.addEventListener = function(type, listener, options) {
            const protectedListener = function(event) {
                // NUEVA: Protección defensiva para event.target
                if (event && event.target) {
                    const originalTarget = event.target;
                    if (!originalTarget.closest || typeof originalTarget.closest !== 'function') {
                        try {
                            Object.defineProperty(originalTarget, 'closest', {
                                value: function(selector) {
                                    return safeClosest(this, selector);
                                },
                                configurable: true
                            });
                        } catch (e) {
                            // No se puede definir, no importa - usaremos safeClosest directamente
                        }
                    }
                }
                
                return listener.call(this, event);
            };
            
            return originalDocumentAddEventListener.call(this, type, protectedListener, options);
        };
        
        conversionsCount++;

    }
    
    // Estas funciones causan recursión infinita
    // protectClosest(); // RECURSION INFINITA con safeClosest  
    // protectTargetClosest(); // protectTargetClosest
    
    return conversionsCount;
}

// Verificar cambios remotos en AMBOS modos (bidireccional)
async function checkForRemoteChanges() {
    let currentPlantilla;
    
    try {
        // Función optimizada para evitar recursión
        currentPlantilla = optimizedFunctions.getCurrentPlantilla();
        if (!currentPlantilla || !currentPlantilla.id) {
    
            return;
        }
        
        // NUEVO: No verificar cambios si se está guardando localmente
        if (isCurrentlyUpdating) {
            // Evitar conflictos durante actualizaciones
            return;
        }
        
        // NUEVO: Verificar si el usuario tiene permisos para esta plantilla
        // Solo verificar si es admin o si tiene permisos específicos
        if (!window.isAdmin && !window.hasWorksheetAccess) {
            // Sin permisos para verificar cambios
            return;
        }
        

    } catch (initialError) {

        return;
    }
    
    try {
        // NUEVO: Incrementar contador de verificaciones
        syncStats.totalChecks++;
        
        // Endpoints diferentes según el modo
        let url, headers = { 'Content-Type': 'application/json' };
        
        if (window.isSharedMode) {
            // Endpoint de changes con token
            if (!window.sharedToken) {
                // Sin token compartido
                return;
            }
            url = `/tienda/api/shared/worksheet/${currentPlantilla.id}/changes?token=${window.sharedToken}&last_time=${lastKnownEditTime || ''}`;
        } else {
            // Admin: usar endpoint de cambios con timestamp
            url = `/api/store/worksheet_changes/${currentPlantilla.id}?last_time=${lastKnownEditTime || ''}`;
            headers['X-CSRFToken'] = getCSRFToken();
        }
        


        
        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });
        
        if (response.ok) {
            const result = await response.json();
            
            // Ambos endpoints devuelven el mismo formato
            const processedResult = result;
            

            
            if (processedResult.has_changes && processedResult.data) {
                // NUEVO: Incrementar contador de cambios detectados
                syncStats.changesDetected++;
                syncStats.lastSyncTime = new Date().toLocaleTimeString();
                
                // NUEVO: Agregar información de paginación a las estadísticas
                if (rowsPerPage !== 'todos') {
                    syncStats.currentPage = currentPage;
                    syncStats.rowsPerPage = rowsPerPage;
                    syncStats.totalRows = tablaDatos ? tablaDatos.length : 0;
                }
                


                
                await applyRemoteChanges(processedResult);
                lastKnownEditTime = processedResult.last_edit_time;
                
                // NUEVO: Activar modo rápido cuando detectamos cambios remotos
                activateFastSyncMode();
            } else {
                // No hay cambios
            }
        } else if (response.status === 403 || response.status === 404) {
            // Sin permisos o plantilla no encontrada - no mostrar error
            // Silencioso
            return;
        } else {
            // Error de servidor
        }
    } catch (error) {
        // NUEVO: Manejo elegante de errores de conexión
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            // No mostrar en consola para evitar spam
            return;
        } else {
            // Ignorar errores 500 de permisos
            if (error.message && !error.message.includes('403') && !error.message.includes('404')) {
                // Error en verificación de cambios
            }
        }
    }
}

// Con soporte completo para paginación
async function applyRemoteChanges(newData) {
    // Evitar actualizaciones concurrentes
    
    if (isCurrentlyUpdating) {
        // Ya hay una actualización en curso
        return;
    }
    
    isCurrentlyUpdating = true;

    
    // NUEVO: Mostrar indicador discreto con velocidad
    const speedIndicator = fastSyncMode ? '⚡' : '🔄';
    showSyncIndicator(`${speedIndicator} Sincronizando cambios de ${newData.last_editor || 'otro usuario'}...`);
    
    try {
        // Guardar configuración actual
        const savedCurrentPage = currentPage;
        const savedRowsPerPage = rowsPerPage;
        
        // Guardar estado actual del cursor
        const activeElement = document.activeElement;
        const parentRow = safeClosest(activeElement, 'tr');
        const parentCell = safeClosest(activeElement, 'td');
        const currentRowIndex = activeElement && parentRow ? parseInt(parentRow.getAttribute('data-row-index')) : -1;
        const currentColIndex = activeElement && parentCell ? parseInt(parentCell.getAttribute('data-col-index')) : -1;
        const currentValue = activeElement ? activeElement.value : '';
        const currentSelectionStart = activeElement ? activeElement.selectionStart : 0;
        
        // NUEVO: Detectar si hay búsqueda activa
        const searchInput = document.getElementById('mainSearchInput');
        const hasActiveSearch = searchInput && searchInput.value.trim() !== '';
        const activeSearchValue = hasActiveSearch ? searchInput.value.trim() : '';
        
        
        // Obtener plantilla actual
        const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
        if (currentPlantilla) {
            const oldData = [...tablaDatos]; // Datos anteriores
            tablaDatos = newData.data || newData;
            currentPlantilla.datos = tablaDatos;
            
            // NUEVO: Detectar qué páginas fueron afectadas por los cambios
            const changeInfo = detectChangesInPages(oldData, tablaDatos);
            
    

            
            // NUEVO: Verificar si necesitamos ajustar la paginación
            let needsPageAdjustment = false;
            if (rowsPerPage !== 'todos') {
                const totalPages = Math.ceil(tablaDatos.length / rowsPerPage);
                if (savedCurrentPage > totalPages && totalPages > 0) {
                    currentPage = totalPages;
                    needsPageAdjustment = true;

                }
            }
            
            // Renderizar tabla preservando estado de búsqueda y paginación
            const container = document.getElementById('worksheetTableContainer');
            const currentPlantillaIndex = plantillas.indexOf(currentPlantilla);
            if (container && currentPlantillaIndex >= 0) {
                
                if (hasActiveSearch) {
                    // Filtrar datos actualizados
                    filtrarFilasTabla(activeSearchValue, currentPlantilla, optimizedFunctions.getStandardFieldNames(), container, currentPlantillaIndex);
                } else {
                    // NORMAL: Re-renderizar con paginación
                    optimizedFunctions.renderTablaEditable(currentPlantilla, optimizedFunctions.getStandardFieldNames(), container, currentPlantillaIndex);
                }
                
                // IMPORTANTE: Aplicar colores después del re-render
                setTimeout(() => {
                    forceUpdateAllNumberColors();
                }, 50); // Optimizado para hojas de cálculo - reducido de 100ms a 50ms
                
                // NUEVO: Mostrar notificación si hay cambios en otras páginas
                if (!hasActiveSearch && changeInfo.hasChanges) {
                    setTimeout(() => {
                        showPageChangeNotification(changeInfo.affectedPages, changeInfo.currentPageAffected);
                    }, 200);
                }
            }
            
            // Restaurar posición del cursor de forma más robusta
            if (currentRowIndex >= 0 && currentColIndex >= 0) {
                setTimeout(() => {
                    // ntentar encontrar la celda en la página actual
                    let restoredElement = getCellElement(currentRowIndex, currentColIndex);
                    
                    if (!restoredElement && rowsPerPage !== 'todos') {
                        // Está en otra página debido a la paginación
                        // Verificar si está en la página actual después de los cambios
                        const startIdx = (currentPage - 1) * rowsPerPage;
                        const endIdx = startIdx + rowsPerPage;
                        
                        if (currentRowIndex >= startIdx && currentRowIndex < endIdx) {
                            // Intentar nuevamente
                            restoredElement = getCellElement(currentRowIndex, currentColIndex);
                        } else {
                            // No está en la página actual
                        }
                    }
                    
                    if (restoredElement) {
                        // Restaurar valor y posición del cursor
                        try {
                            restoredElement.focus();
                        } catch (focusError) {
    
                        }
                        
                        // setSelectionRange solo en elementos que lo soporten
                        if (restoredElement.value === currentValue) {
                            try {
                                // Verificar soporte setSelectionRange
                                if (typeof restoredElement.setSelectionRange === 'function' && 
                                    (restoredElement.tagName === 'INPUT' || restoredElement.tagName === 'TEXTAREA') &&
                                    typeof currentSelectionStart === 'number') {
                                    restoredElement.setSelectionRange(currentSelectionStart, currentSelectionStart);
                                } else {
                                    // No soporta setSelectionRange
                                }
                            } catch (selectionError) {
                                // Error al restaurar selección
                            }
                        }

                    } else {
                        // No se pudo restaurar el elemento
                    }
                }, 150);
            }
            
            // NUEVO: Guardar estado de paginación actualizado
            if (needsPageAdjustment) {
                saveCurrentPage(currentPage);
            }
        }
        
    } catch (error) {
        // Error al aplicar cambios remotos
    } finally {
        isCurrentlyUpdating = false;
    
        // NUEVO: Ocultar indicador después de completar
        hideSyncIndicator();
    }
}

// Notificar cambios en AMBOS modos (bidireccional)
function notifyRemoteUsers() {
    if (!isSyncEnabled) return;
    
    // Funciona en AMBOS modos (admin y compartido)

    
    
    updateLastKnownTime();
    
    // NUEVO: Activar modo de sincronización rápida para otros usuarios
    activateFastSyncMode();
    
    // Sincronización SÚPER rápido (100ms + 500ms-1s)
    
}

function detectChangesInPages(oldData, newData) {
    // Detectar cambios en páginas específicas

    
    if (!oldData || !newData || rowsPerPage === 'todos') {
        // Sin paginación o datos inválidos
        return { hasChanges: true, affectedPages: [], currentPageAffected: true };
    }
    
    const totalPages = Math.ceil(newData.length / rowsPerPage);
    const affectedPages = new Set();
    let currentPageAffected = false;
    let totalChanges = 0;
    
    // Comparar filas
    const maxRows = Math.max(oldData.length, newData.length);

    // Iterar por todas las filas
    for (let i = 0; i < maxRows; i++) {
        const oldRow = oldData[i] || [];
        const newRow = newData[i] || [];
        
        // Detección más robusta de cambios
        let rowChanged = false;
        
        // Longitud diferente
        if (oldRow.length !== newRow.length) {
            rowChanged = true;
        } else {
            // Comparar celdas
            for (let colIdx = 0; colIdx < Math.max(oldRow.length, newRow.length); colIdx++) {
                const oldCell = oldRow[colIdx];
                const newCell = newRow[colIdx];
                
                // Normalizar valores para comparación
                const oldValue = (oldCell === null || oldCell === undefined) ? '' : String(oldCell);
                const newValue = (newCell === null || newCell === undefined) ? '' : String(newCell);
                
                if (oldValue !== newValue) {
                    rowChanged = true;

                    break;
                }
            }
        }
        
        if (rowChanged) {
            totalChanges++;
            const pageNumber = Math.floor(i / rowsPerPage) + 1;
            affectedPages.add(pageNumber);
            
            // Verificar si la página actual fue afectada
            
            if (pageNumber === currentPage) {
                currentPageAffected = true;
                // Página actual afectada
            }
        }
    }
    
    const result = {
        hasChanges: affectedPages.size > 0,
        affectedPages: Array.from(affectedPages),
        currentPageAffected,
        totalPagesAffected: affectedPages.size,
        totalChanges
    };
    
    // Devolver resultado
    return result;
}

// NUEVO: Mostrar notificación discreta de cambios en otras páginas
function showPageChangeNotification(affectedPages, currentPageAffected) {
    if (!affectedPages.length || currentPageAffected) return;
    
    // Filtrar otras páginas
    const otherPages = affectedPages.filter(page => page !== currentPage);
    if (otherPages.length === 0) return;
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #17a2b8;
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s ease;
        cursor: pointer;
    `;
    
    if (otherPages.length === 1) {
        notification.innerHTML = `📄 Cambios en página ${otherPages[0]} • Clic para ir`;
        notification.onclick = () => {
            currentPage = otherPages[0];
            saveCurrentPage(currentPage);
            const container = document.getElementById('worksheetTableContainer');
            const plantilla = optimizedFunctions.getCurrentPlantilla();
            if (container && plantilla) {
                optimizedFunctions.renderTablaEditable(plantilla, optimizedFunctions.getStandardFieldNames(), container, 0);
                setTimeout(() => forceUpdateAllNumberColors(), 100);
            }
            notification.remove();
        };
    } else {
        notification.innerHTML = `📄 Cambios en ${otherPages.length} páginas`;
        notification.onclick = () => notification.remove();
    }
    
    document.body.appendChild(notification);
    
    // Animar entrada
    setTimeout(() => notification.style.opacity = '1', 10);
    
    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }
    }, 4000);
}

// NUEVO: Activar modo de sincronización rápida por 10 segundos
function activateFastSyncMode() {
    if (!fastSyncMode) {
        fastSyncMode = true;
        // NUEVO: Incrementar contador de activaciones de modo rápido
        syncStats.fastModeActivations++;
    
        
        // DESACTIVADO: Interval rápido - genera demasiados logs
    }
    
    // Limpiar timeout anterior
    clearTimeout(fastSyncTimeout);
    
    // Volver a velocidad normal después de 10 segundos
    fastSyncTimeout = setTimeout(() => {
        deactivateFastSyncMode();
    }, 10000);
}

// NUEVO: Desactivar modo de sincronización rápida
function deactivateFastSyncMode() {
    if (fastSyncMode) {
        fastSyncMode = false;
    
    }
}

// NUEVO: Indicador discreto de sincronización
let syncIndicatorTimeout;
function showSyncIndicator(message) {
    // Solo en modo compartido
    if (!window.isSharedMode) return;
    
    // Limpiar timeout anterior
    clearTimeout(syncIndicatorTimeout);
    
    // Crear indicador
    let indicator = document.getElementById('sync-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'sync-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #2196f3;
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10000;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.textContent = message;
    indicator.style.opacity = '1';
    indicator.style.transform = 'translateY(0)';
}

function hideSyncIndicator() {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) {
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-10px)';
        
        // Después de la animación
        syncIndicatorTimeout = setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 300);
    }
}




// NUEVO: Inicializar sincronización automáticamente al cargar la página en modo compartido
if (window.isSharedMode) {
    // Esperar a que la página esté completamente cargada
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initializeRealTimeSync();
        }, 1000);
    });
}





// Funcionalidad para closest() SIN DUPLICACIÓN
(function addClosestPolyfill() {
    if (closestPolyfillSetup) {
        // Ya configurado
        return;
    }
    closestPolyfillSetup = true;
    
    try {
        // Verificar si closest no está disponible
        if (!Element.prototype.closest) {
            // Implementar closest
            Element.prototype.closest = function(selector) {
                let el = this;
                while (el && el.nodeType === 1) {
                    if (el.matches(selector)) {
                        return el;
                    }
                    el = el.parentElement || el.parentNode;
                }
                return null;
            };
        }
        
        // NUEVO: Testear closest exhaustivamente
        const testDiv = document.createElement('div');
        if (typeof testDiv.closest !== 'function') {
            // closest no funciona
        } else {
            // closest funciona
            
            // NUEVO: Test adicional de robustez
            try {
                testDiv.closest('body'); 
                // Test exitoso
            } catch (testError) {
                // Test falló
            }
    
    
        }
            
            // NUEVO: Verificar configuración de listeners

            const criticalListeners = [
                'handleEscKey', 'handleKeyboardShortcuts', 'handleKeyboardNavigation', 
                'escapeHandler'
            ];
            let duplicateCount = 0;
            criticalListeners.forEach(listenerName => {
                if (typeof window[listenerName] === 'function') {
                    duplicateCount++;
                }
            });
            
            if (duplicateCount > 0) {
            }
            
            // Limpieza de recursos y optimizaciones

            // Detección de memory leaks más precisa
            const totalResources = timerManager.getStatus().activeTimeouts + 
                                 timerManager.getStatus().activeIntervals + 
                                 debounceManager.debounces.size;
            
            const totalCaches = domCache.getStatus().cachedElements + 
                               functionCache.getStatus().cachedFunctions + 
                               plantillaCache.getStatus().indexMapSize;
            
            // Verificar recursos

            
            if (totalResources > 50) {
                // Muchos recursos activos


            } else {
                // Recursos normales
            }
            
            // Interceptores opcionales - sin advertencias molestas
            if (!functionInterceptors.installed) {
            }
    } catch (error) {
        // Error en configuración de closest
    }
})();

// NUEVO: Función utilitaria para getElementById con verificación
function safeGetElementById(id) {
    const element = document.getElementById(id);
    if (!element) {
        // Elemento no encontrado
    }
    return element;
}

// NUEVO: Función utilitaria para addEventListener con verificación
function safeAddEventListener(element, event, handler) {
    if (element && typeof element.addEventListener === 'function') {
        element.addEventListener(event, handler);
        return true;
    } else {
        // Elemento no válido
        return false;
    }
}

// Función absolutamente segura sin recursión
function safeClosest(element, selector) {
    // VERIFICACIÓN BÁSICA: Verificaciones rápidas
    if (!element || !selector || typeof selector !== 'string') {
        return null;
    }
    
    if (typeof element !== 'object' || !element.nodeType || element.nodeType !== 1) {
        return null;
    }
    
    try {
        // MANUAL DIRECTO: Sin depender de closest interceptado
        let currentElement = element;
        let iterations = 0;
        const maxIterations = 50; // Evitar loops infinitos
        
        while (currentElement && currentElement.nodeType === 1 && iterations < maxIterations) {
            iterations++;
            
            try {
                // Verificar coincidencia
                if (currentElement.matches && typeof currentElement.matches === 'function') {
                    if (currentElement.matches(selector)) {
                        return currentElement;
                    }
                }
            } catch (matchError) {
                // Continuar con el padre si matches falla
            }
            
            // Elemento padre
            currentElement = currentElement.parentElement;
            
            // Llegar a document o html
            if (!currentElement || currentElement === document || currentElement === document.documentElement) {
                break;
            }
        }
        
        return null;
    } catch (error) {
        // No usar sistemas complejos
        // Error silencioso
        return null;
    }
}

// Sistema robusto para event.target.closest
function safeEventTargetClosest(event, selector) {
    // NIVEL 1: Verificaciones de evento extremas
    if (!event) {
        return null;
    }
    
    // NIVEL 2: Verificaciones de target robustas
    if (!event.target) {
        return null;
    }
    
    // NIVEL 3: Verificar que target es un elemento DOM válido
    const target = event.target;
    if (typeof target !== 'object' || !target.nodeType || target.nodeType !== 1) {
        return null;
    }
    
    // NIVEL 4: Usar safeClosest súper reforzado
    return safeClosest(target, selector);
}

// NUEVO: Verificar si event.target es válido para usar closest
function isValidEventTarget(event) {
    return event && 
           event.target && 
           typeof event.target === 'object' &&
           event.target.closest && 
           typeof event.target.closest === 'function';
}

// NUEVO: Función utilitaria para verificar event.target de manera segura
function safeEventTarget(event) {
    return event && event.target && typeof event.target === 'object' ? event.target : null;
}

// Manejador global de errores con detección específica de closest
window.addEventListener('error', function(e) {
    const isClosestError = e.message && e.message.includes('closest is not a function');
    
    if (isClosestError) {
        // Error de event.target.closest
    } else {
        // Otro error
    }
});

// NUEVO: Manejador para promesas rechazadas
window.addEventListener('unhandledrejection', function(e) {
    // Promesa no manejada
    // Evitar que aparezca en la consola como error no manejado
    e.preventDefault();
});


// NUEVO: SISTEMA DE REGISTROS DE CONEXIÓN


let connectionLogsModal = null;
let connectionLogsData = [];
let filteredConnectionLogs = [];

// PREVENIR DUPLICACIÓN (variable movida al inicio)
function initializeConnectionLogsSystem() {
    // Evitar duplicación de event listeners
    if (connectionLogsSystemSetup) {
        // Ya configurado
        return;
    }
    connectionLogsSystemSetup = true;
    
    // Event listener consolidado para el botón de registros
    document.addEventListener('click', function(event) {
        if (!isValidEventTarget(event)) return;
        
        const isConnectionLogsBtn = event.target && event.target.id === 'connectionLogsBtn';
        const isInsideConnectionLogsBtn = safeEventTargetClosest(event, '#connectionLogsBtn');
        
        if (isConnectionLogsBtn || isInsideConnectionLogsBtn) {
            event.preventDefault();
            showConnectionLogsModal();
        }
    });
    
    // Sistema inicializado
}
// NUEVO: Actualizar contador de registros de conexión
function updateConnectionLogsCount(worksheetId) {
    if (!worksheetId) return;
    
    fetch(`/api/store/worksheet_connection_logs/${worksheetId}?limit=100`, {  // Quitar límite para obtener todos los logs
        headers: { 'X-CSRFToken': getCSRFToken() }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const logsBtn = document.getElementById('connectionLogsBtn');
            const logsCount = document.getElementById('logsCount');
            
            if (logsBtn && logsCount) {
                // Contar usuarios únicos en lugar del total de logs
                const groupedSessions = groupConnectionSessions(data.logs || []);
                const count = groupedSessions.length;  // Número de usuarios únicos
                const previousCount = parseInt(logsCount.textContent) || 0;
                
                // Actualizar contador si cambió
                if (count !== previousCount) {
                    logsCount.textContent = count > 99 ? '99+' : count;
            
                    // Animación cuando cambia el contador
                    logsBtn.style.transform = 'scale(1.1)';
                    setTimeout(() => {
                        logsBtn.style.transform = 'scale(1)';
                    }, 200);
                }
                
                // Mostrar cantidad de registros
                if (count > 0) {
                    logsBtn.style.background = 'linear-gradient(135deg, #6f42c1, #5a37a3)';
            } else {
                    logsBtn.style.background = 'linear-gradient(135deg, #6c757d, #495057)';
                }
            }
        }
    })
    .catch(error => {
        // Error al obtener logs
    });
}

// NUEVO: Mostrar modal de registros de conexión
function showConnectionLogsModal() {
    const currentTemplate = getCurrentPlantilla();
    if (!currentTemplate || !currentTemplate.id) {
        showClipboardIndicator('❌ No hay plantilla seleccionada');
        return;
    }
    
    
    
    // Obtener registros completos
    fetch(`/api/store/worksheet_connection_logs/${currentTemplate.id}?limit=100`, {
        headers: { 'X-CSRFToken': getCSRFToken() }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            connectionLogsData = data.logs || [];
            filteredConnectionLogs = [...connectionLogsData];
            createConnectionLogsModal(currentTemplate.title || 'Plantilla');
        } else {
            showClipboardIndicator('❌ Error obteniendo registros de conexión');
        }
    })
    .catch(error => {
        // Error al obtener registros
        showClipboardIndicator('❌ Error obteniendo registros de conexión');
    });
}

// NUEVO: Crear modal de registros de conexión
function createConnectionLogsModal(templateTitle) {
    // Remover modal anterior si hay uno
    if (connectionLogsModal) {
        connectionLogsModal.remove();
    }
    
    connectionLogsModal = document.createElement('div');
    connectionLogsModal.className = 'connection-logs-modal';
    
    connectionLogsModal.innerHTML = `
        <div class="connection-logs-modal-content">
            <div class="connection-logs-modal-header">
                <div class="connection-logs-modal-title">
                    <i class="fas fa-history"></i>
                    Registro de Conexiones - ${templateTitle}
                </div>
                <button class="connection-logs-modal-close">&times;</button>
            </div>
            
            <div class="connection-logs-controls">
                <div class="connection-logs-search-container">
                    <input type="text" class="connection-logs-search" placeholder="Buscar por usuario, IP o acción..." id="connectionLogsSearch">
                    <button class="connection-logs-search-clear" id="connectionLogsSearchClear">&times;</button>
                </div>
                <div class="connection-logs-actions">
                    ${window.isAdmin ? `
                        <button class="connection-logs-cleanup" id="connectionLogsCleanup" title="Limpiar registros antiguos (28+ días)">
                            <i class="fas fa-broom"></i> Limpiar
                        </button>
                        <button class="connection-logs-clear-all" id="connectionLogsClearAll">
                            <i class="fas fa-trash"></i> Borrar todos
                        </button>
                    ` : ''}
                </div>
            </div>
            
            <div id="connectionLogsContainer"></div>
        </div>
    `;
    
    document.body.appendChild(connectionLogsModal);
    
    // Event listeners
    connectionLogsModal.querySelector('.connection-logs-modal-close').addEventListener('click', closeConnectionLogsModal);
    connectionLogsModal.addEventListener('click', function(e) {
        // Cerrar en el overlay del modal
        if (e.target === connectionLogsModal) {
            closeConnectionLogsModal();
        }
    });
    
    // Búsqueda en tiempo real
    const searchInput = connectionLogsModal.querySelector('#connectionLogsSearch');
    const searchClear = connectionLogsModal.querySelector('#connectionLogsSearchClear');
    
    searchInput.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        filterConnectionLogs(query);
        searchClear.style.display = query ? 'block' : 'none';
    });
    
    searchClear.addEventListener('click', function() {
        searchInput.value = '';
        filterConnectionLogs('');
        this.style.display = 'none';
        searchInput.focus();
    });
    
    // Botón limpiar registros antiguos
    if (window.isAdmin) {
        connectionLogsModal.querySelector('#connectionLogsCleanup').addEventListener('click', cleanupOldConnectionLogs);
    }
    
    // Botón limpiar todos
    connectionLogsModal.querySelector('#connectionLogsClearAll').addEventListener('click', clearAllConnectionLogs);
    
    // Renderizar logs iniciales
    renderConnectionLogs();
    
    // Enfocar búsqueda
    setTimeout(() => searchInput.focus(), 100);
}

// NUEVO: Filtrar registros de conexión
function filterConnectionLogs(query) {
    if (!query) {
        filteredConnectionLogs = [...connectionLogsData];
    } else {
        filteredConnectionLogs = connectionLogsData.filter(log => 
            log.display_name.toLowerCase().includes(query) ||
            log.user_identifier.toLowerCase().includes(query) ||
            log.ip_address.toLowerCase().includes(query) ||
            log.action.toLowerCase().includes(query)
        );
    }
    renderConnectionLogs();
}

// Agrupar registro por usuario (estado más reciente)
function groupConnectionSessions(logs) {
    const userLatestStatus = {};
    
    // Obtener el estado más reciente de cada usuario
    logs.forEach(log => {
        const userKey = `${log.user_identifier}_${log.user_type}`;
        const logTime = new Date(log.connection_time);
        
        // Si no tenemos registro de este usuario o este log es más reciente
        if (!userLatestStatus[userKey] || logTime > new Date(userLatestStatus[userKey].connection_time)) {
            userLatestStatus[userKey] = {
                user_type: log.user_type,
                user_identifier: log.user_identifier,
                display_name: log.display_name,
                action: log.action, // 'connected' o 'disconnected'
                formatted_time: log.formatted_time,
                formatted_time_range: log.formatted_time_range,  // NUEVO: Rango de tiempo
                ip_address: log.ip_address,
                connection_time: log.connection_time,
                session_type: log.action === 'connected' ? 'active' : 'disconnected'
            };
        }
    });
    
    // Convertir a array y ordenar por tiempo (más reciente primero)
    const sessions = Object.values(userLatestStatus).sort((a, b) => 
        new Date(b.connection_time) - new Date(a.connection_time)
    );
    
    return sessions;
}

// NUEVO: Renderizar lista de registros
function renderConnectionLogs() {
    const container = connectionLogsModal.querySelector('#connectionLogsContainer');
    
    if (filteredConnectionLogs.length === 0) {
        container.innerHTML = '<div class="no-connection-logs">📭 No se encontraron registros de conexión</div>';
        return;
    }
    
    const sessions = groupConnectionSessions(filteredConnectionLogs);
    
    
    
    
    const logsHtml = sessions.map(session => {
        let icon, cssClass;
        
        if (session.user_type === 'admin') {
            icon = '👑';
            cssClass = 'connection-log-admin';
        } else if (session.user_type === 'user') {
            icon = '👤';
            cssClass = 'connection-log-user-type';
        } else {
            icon = '👥';
            cssClass = 'connection-log-anonymous';
        }
        
        // Conectado o desconectado
        let actionIcon, actionText, actionClass;
        
        if (session.action === 'connected') {
            actionIcon = '🟢';
            actionText = 'Conectado';
            actionClass = 'connection-log-connected';
        } else {
            actionIcon = '🔴';
            actionText = 'Desconectado';
            actionClass = 'connection-log-disconnected';
        }
        
        return `
            <div class="connection-log-item ${actionClass} ${cssClass}">
                <div class="connection-log-main-info">
                    <div class="connection-log-icon">${icon}</div>
                    <div class="connection-log-details">
                        <div class="connection-log-user">${session.display_name}</div>
                        <div class="connection-log-action">${actionIcon} ${actionText}</div>
                    </div>
                </div>
                <div class="connection-log-time-info">
                    <div class="connection-log-time">${session.formatted_time_range || session.formatted_time}</div>
                    <div class="connection-log-duration">${session.action === 'connected' ? 'Sesión activa' : 'Última actividad'}</div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = logsHtml;
}

// NUEVO: Cerrar modal de registros
function closeConnectionLogsModal() {
    if (connectionLogsModal) {
        connectionLogsModal.remove();
        connectionLogsModal = null;
    }
}

// NUEVO: Limpiar registros antiguos (28+ días)
function cleanupOldConnectionLogs() {
    if (!confirm('¿Estás seguro de que quieres limpiar los registros antiguos (más de 28 días)? Esta acción eliminará registros obsoletos.')) {
        return;
    }
    
    fetch('/api/store/worksheet_connection_logs/cleanup', {
        method: 'POST',
        headers: { 'X-CSRFToken': getCSRFToken() }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Recargar modal
            showConnectionLogsModal();
            showClipboardIndicator(`✅ ${data.message}`);
        } else {
            showClipboardIndicator(`❌ Error: ${data.error}`);
        }
    })
    .catch(error => {
        showClipboardIndicator('❌ Error ejecutando limpieza');
    });
}

// NUEVO: Limpiar todos los registros
function clearAllConnectionLogs() {
    const currentTemplate = getCurrentPlantilla();
    if (!currentTemplate || !currentTemplate.id) return;
    
    if (!confirm('¿Estás seguro de que quieres eliminar TODOS los registros de conexión? Esta acción no se puede deshacer.')) {
        return;
    }
    
    fetch(`/api/store/worksheet_connection_logs/${currentTemplate.id}/clear`, {
        method: 'DELETE',
        headers: { 'X-CSRFToken': getCSRFToken() }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            connectionLogsData = [];
            filteredConnectionLogs = [];
            renderConnectionLogs();
            updateConnectionLogsCount(currentTemplate.id);
            showClipboardIndicator(`✅ ${data.deleted_count} registros eliminados`);
        } else {
            showClipboardIndicator('❌ Error eliminando registros');
        }
    })
    .catch(error => {
        // Error al eliminar registros
        showClipboardIndicator('❌ Error eliminando registros');
    });
}

// ELIMINADO: Wrapper de updateAdminViewersCount (código muerto)

// Sistema unificado de inicialización (variable movida al inicio)

function initializeAllSystems() {
    if (globalSystemsInitialized) {
        // Ya inicializado
        return;
    }
    globalSystemsInitialized = true;
    
    // Inicializar sistemas
    
    // Sistema universal de closest ANTES que todo
    initializeUniversalClosestProtection();
    
    // Sistema de actividad
    setupActivityDetection();
    
    // Sistema de información adicional
    setupInfoAdicionalDelegatedListeners();
    
    // Sistema de conexión
    initializeConnectionLogsSystem();
    
    // Sistema de selección de columnas y celdas
    setupSelectionEvents();
    
    // Plantilla actual para logs
    const currentTemplate = getCurrentPlantilla();
    if (currentTemplate && currentTemplate.id) {
        updateConnectionLogsCount(currentTemplate.id);
    }
    
    // Elementos DOM críticos en cache
    const criticalElements = [
        'worksheetTableContainer', 
        'worksheetTable', 
        'mainSearchInput',
        'searchInput',
        'replaceInput',
        'globalSearchInput'
    ];
    
    criticalElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            domCache.cache.set(elementId, element);
        }
    });
    
    // Sistemas inicializados
    
}

// NUEVO: Función de diagnóstico para sincronización en paginación
function diagnosePaginationSync() {
    // Diagnóstico de sincronización en paginación
    
    // Plantilla
    const currentPlantilla = getCurrentPlantilla();

    
    // Indicadores de sincronización  
    
    // Detección de cambios
    if (window.isSharedMode && window.sharedToken) {
        // Verificar cambios en modo compartido
        safeCheckForRemoteChanges();
    } else {
        // Modo admin
    }
}

// NUEVO: Función para reiniciar sincronización si hay problemas
function resetSyncSystem() {
    // Reiniciar sistema de sincronización
    isCurrentlyUpdating = false;
    lastKnownEditTime = null;
    fastSyncMode = false;
    
    // Inicializar estadísticas
    syncStats = {
        totalChecks: 0,
        changesDetected: 0,
        lastSyncTime: 'Nunca',
        isActive: isSyncEnabled,
        syncSpeed: fastSyncMode ? 'Rápido' : 'Normal',
        currentPage: currentPage || 1,
        rowsPerPage: rowsPerPage || 'todos',
        totalRows: tablaDatos ? tablaDatos.length : 0
    };
    
    // Nueva inicialización de sincronización
    if (window.isSharedMode && window.sharedToken) {
        // Reinicializar sincronización
        initializeRealTimeSync();
        
        // Verificar inmediatamente
        setTimeout(() => {
            safeCheckForRemoteChanges();
        }, 500);
    }
}

// NUEVO: Función de limpieza completa para prevenir memory leaks
function cleanupAllResources() {
    // Desinstalar interceptores PRIMERO para evitar recursión
    if (functionInterceptors && functionInterceptors.installed) {
        // Desinstalar interceptores
        functionInterceptors.uninstall();
    }
    
    
    timerManager.clearAll();
    
    // Debounces
    debounceManager.clearAll();
    
    
    domCache.clearAll();
    functionCache.clearAll();
    plantillaCache.clearAll();
    
    // Variables de inicialización
    activityDetectionSetup = false;
    infoAdicionalListenersSetup = false;
    connectionLogsSystemSetup = false;
    globalSystemsInitialized = false;
    
    // Sincronización
    if (typeof syncInterval !== 'undefined' && syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    
    if (typeof adminPresenceInterval !== 'undefined' && adminPresenceInterval) {
        clearInterval(adminPresenceInterval);
        adminPresenceInterval = null;
    }
    
    // ELIMINADO: adminViewersUpdateInterval (código muerto)
    
    // Variables de sincronización
    if (typeof isCurrentlyUpdating !== 'undefined') {
        isCurrentlyUpdating = false;
    }
    
    if (typeof lastKnownEditTime !== 'undefined') {
        lastKnownEditTime = null;
    }
}

// NUEVO: Auto-limpieza en eventos críticos
window.addEventListener('beforeunload', () => {
    cleanupAllResources();
});

// NUEVO: Limpieza cuando se cambia de página/plantilla
const originalSetCurrentPlantilla = window.setCurrentPlantilla;
if (typeof originalSetCurrentPlantilla === 'function') {
    window.setCurrentPlantilla = function(...args) {
        // Antes de cambiar plantilla
        cleanupAllResources();
        
        // Ejecutar función original
        return originalSetCurrentPlantilla.apply(this, args);
    };
}

// DOMContentLoaded #3 (con protección contra duplicación)
let thirdDOMContentLoadedExecuted = false;
document.addEventListener('DOMContentLoaded', function() {
    if (thirdDOMContentLoadedExecuted) {

        return;
    }
    thirdDOMContentLoadedExecuted = true;
    
    // Inicializar sistemas
    setTimeout(() => {
        initializeAllSystems();
        
        // Hacer disponibles todas las funciones de gestión globalmente
        window.diagnosePaginationSync = diagnosePaginationSync;
        window.resetSyncSystem = resetSyncSystem;
        window.cleanupAllResources = cleanupAllResources;
        window.timerManager = timerManager;
        window.debounceManager = debounceManager;
        window.domCache = domCache;
        window.functionCache = functionCache;
        window.plantillaCache = plantillaCache;
        window.optimizedFunctions = optimizedFunctions;
        window.optimizedLogger = optimizedLogger;
        window.functionInterceptors = functionInterceptors;
        
        // INTERCEPTORES DISPONIBLES: No instalar automáticamente para evitar recursión
        // functionInterceptors.install() cuando sea seguro
        
        // CONFIGURAR AUTO-LIMPIEZA DE CACHES
        timerManager.setInterval(() => {
            functionCache.cleanup(); 
        }, 60000, 'autoCleanupCaches');
        
        optimizedLogger.setProduction(true);

    }, 500); // Optimizado para hojas de cálculo - reducido de 1000ms a 500ms
});

// Función para actualizar colores de bloque en tiempo real (optimizada)
let updateBlockColorsTimeout;
function updateBlockColors(changedRowIdx, plantilla) {
    // DEBOUNCE: Evitar múltiples ejecuciones
    clearTimeout(updateBlockColorsTimeout);
    updateBlockColorsTimeout = setTimeout(() => {
        updateBlockColorsInternal(changedRowIdx, plantilla);
    }, 10); // Optimizado para hojas de cálculo - reducido de 25ms a 10ms 
}

function updateBlockColorsInternal(changedRowIdx, plantilla) {
    if (!plantilla || !plantilla.datos || !plantilla.campos) {
        return;
    }
    
    try {
        // Buscar columnas tipo 'numero'
        const numIndices = [];
        plantilla.campos.forEach((campo, i) => {
            if (campo === 'numero' || (campo && typeof campo === 'object' && campo.tipo === 'numero')) {
                numIndices.push(i);
            }
        });
        
        if (numIndices.length === 0) {
            return; // No hay columnas de número
        }
        
        // Obtener tabla
        const worksheetTable = document.getElementById('worksheetTable');
        if (!worksheetTable) {
            // Tabla no encontrada
            return;
        }
        
        const tableBody = worksheetTable.querySelector('tbody');
        if (!tableBody) {
            // Tbody no encontrado
            return;
        }
        
        const rows = tableBody.querySelectorAll('tr[data-row-index]');

        
        
        rows.forEach(rowElement => {
            const realRowIdx = parseInt(rowElement.getAttribute('data-row-index'));
            const fila = plantilla.datos[realRowIdx];
            
            if (fila) {
                // NUEVA: Usar la MISMA lógica de bloques que el sistema estático
                let bloqueColores = Array(fila.length).fill(null);
                
                numIndices.forEach((numIdx, bloqueIdx) => {
                    let numVal = (fila[numIdx] || '').toString().trim();
                    
                    // Usar función centralizada para obtener colores
                    const colors = getNumberColors(numVal);
                    const color = colors ? colors.color : null;
                    const borderColor = colors ? colors.borderColor : null;
                    const textColor = colors ? colors.textColor : null;
        
                    if (color) {
                        // Desde inicio o último número hasta este número
                        let start = (numIndices[bloqueIdx-1] !== undefined) ? numIndices[bloqueIdx-1]+1 : 0;
                        for (let i = start; i <= numIdx; i++) {
                            bloqueColores[i] = { color, textColor, borderColor };
                        }
                    }
                });
                
                
                bloqueColores.forEach((colorData, colIdx) => {
                    const cellElement = rowElement.children[colIdx + 1]; // Saltar columna de numeración
                    if (cellElement) {
                        const input = cellElement.querySelector('input');
                        const infoElement = cellElement.querySelector('.cell-info-adicional');
                        const element = input || infoElement;
                        
                        if (element) {
                            if (colorData) {
                                // Aplicar color de bloque
                                applyBlockColorDirect(element, cellElement, colorData);
                            } else {
                                // NUEVO: Limpiar colores donde no debería haber
                                clearNumberColors(element);
                            }
                        }
                    }
                });
            }
        });
        

        
    } catch (error) {
        // Error al actualizar colores
    }
}

// Función para aplicar colores de bloque directamente sin disparar eventos
function applyBlockColorDirect(element, cellElement, colorData) {
    if (!element || !cellElement || !colorData) return;
    
    const { color, textColor, borderColor } = colorData;
    
    if (color) {
        // Aplicar estilos de color
        cellElement.style.setProperty('background-color', color, 'important');
        cellElement.style.setProperty('color', textColor, 'important');
        cellElement.style.setProperty('border-color', borderColor, 'important');
        
        // Elemento (input o div información adicional)
        element.style.setProperty('background-color', color, 'important');
        element.style.setProperty('color', textColor, 'important');
        element.style.setProperty('border-color', borderColor, 'important');
        element.style.setProperty('font-weight', 'bold', 'important');
        
        // NUEVO: Estilos específicos según el tipo de elemento
        if (element.tagName === 'INPUT') {
            element.style.setProperty('text-shadow', '0 1px 2px rgba(0,0,0,0.3)', 'important');
        } else if (element.classList.contains('cell-info-adicional')) {
            element.style.setProperty('border-radius', '4px', 'important');
            element.style.setProperty('text-shadow', '0 1px 2px rgba(0,0,0,0.3)', 'important');
        }
    }
}

// Función para limpiar colores de número
function clearNumberColors(element) {
    if (!element) return;
    
    // Función segura para evitar errores en modo compartido
    const td = safeClosest(element, 'td');
    
    // Elemento
    element.style.removeProperty('background-color');
    element.style.removeProperty('color');
    element.style.removeProperty('border-color');
    element.style.removeProperty('font-weight');
    element.style.removeProperty('text-shadow');
    element.style.removeProperty('border-radius');
    
    
    if (td) {
        td.style.removeProperty('background-color');
        td.style.removeProperty('color');
        td.style.removeProperty('border-color');
    }
}

// Mantener función anterior para compatibilidad
function applyNumberColorDirect(input, value) {
    let color = '';
    let borderColor = '';
    let textColor = '#fff';
    
    // Usar función centralizada para obtener colores
    const colors = getNumberColors(value);
    if (colors) {
        color = colors.color;
        borderColor = colors.borderColor;
        textColor = colors.textColor;
    }
    
    if (color) {
        // Función segura para evitar errores en modo compartido
        const td = safeClosest(input, 'td');
        if (td) {
            // Aplicar estilos con máxima prioridad
            td.style.cssText += `background-color: ${color} !important; color: ${textColor} !important; border-color: ${borderColor} !important;`;
        }
        input.style.cssText += `background-color: ${color} !important; color: ${textColor} !important; border-color: ${borderColor} !important; font-weight: bold !important; text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;`;
    }
}



// Función para coloreado en tiempo real (sin debounce para respuesta inmediata)
function forceUpdateAllNumberColors() {
    try {
        const worksheetTable = document.getElementById('worksheetTable');
        if (!worksheetTable) {
            return;
        }
        
        // Buscar inputs número
        const numberInputs = worksheetTable.querySelectorAll('input[data-campo="numero"]');
        
        // Procesar inputs número de forma eficiente
        numberInputs.forEach((input) => {
            const value = input.value.toString().trim();
            if (value) {
                applyNumberColorDirect(input, value);
                
                // Aplicar color a toda la fila en tiempo real
                const td = safeClosest(input, 'td');
                if (td) {
                    const rowIndex = parseInt(td.getAttribute('data-row-index'));
                    const colIndex = parseInt(td.getAttribute('data-col-index'));
                    const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
                    if (rowIndex !== null && colIndex !== null && currentPlantilla) {
                        applyRowColorInRealTime(rowIndex, colIndex, value, currentPlantilla);
                    }
                }
            } else {
                // Cuando el campo está vacío
                clearNumberColors(input);
                
                // Limpiar colores de toda la fila
                const td = safeClosest(input, 'td');
                if (td) {
                    const rowIndex = parseInt(td.getAttribute('data-row-index'));
                    const colIndex = parseInt(td.getAttribute('data-col-index'));
                    const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
                    if (rowIndex !== null && colIndex !== null && currentPlantilla) {
                        applyRowColorInRealTime(rowIndex, colIndex, '', currentPlantilla);
                    }
                }
            }
        });
        
        // Procesar información adicional
        const currentPlantilla = optimizedFunctions.getCurrentPlantilla();
        if (currentPlantilla && currentPlantilla.datos) {
            // Manejar bloques correctamente
            const processedRows = new Set();
            
            // Agrupar elementos por fila
            const elementsByRow = new Map();
            
            [...numberInputs].forEach(element => {
                // Función segura para evitar errores en modo compartido
                const td = safeClosest(element, 'td');
                if (td) {
                    const rowIndex = parseInt(td.getAttribute('data-row-index'));
                    if (!elementsByRow.has(rowIndex)) {
                        elementsByRow.set(rowIndex, []);
                    }
                    elementsByRow.get(rowIndex).push({
                        element,
                        td,
                        colIndex: parseInt(td.getAttribute('data-col-index'))
                    });
                }
            });
            
            // Aplicar lógica de bloques completa
            elementsByRow.forEach((elements, rowIndex) => {
                if (currentPlantilla.datos[rowIndex]) {
                    const fila = currentPlantilla.datos[rowIndex];
                    
                    
                    const numIndices = [];
                    currentPlantilla.campos.forEach((campo, i) => {
                        if (campo === 'numero' || (campo && typeof campo === 'object' && campo.tipo === 'numero')) {
                            numIndices.push(i);
                        }
                    });
                    
                    if (numIndices.length > 0) {
                        let bloqueColores = Array(fila.length).fill(null);
                        
                        numIndices.forEach((numIdx, bloqueIdx) => {
                            let numVal = (fila[numIdx] || '').toString().trim();
                            let color = '', textColor = '#fff', borderColor = '';
                            
                            if (numVal === '1') { color = '#4caf50'; borderColor = '#45a049'; textColor = '#fff'; }
                            else if (numVal === '2') { color = '#e74c3c'; borderColor = '#c0392b'; textColor = '#fff'; }
                            else if (numVal === '3') { color = '#2196f3'; borderColor = '#1976d2'; textColor = '#fff'; }
                            else if (numVal === '4') { color = '#ff9800'; borderColor = '#f57c00'; textColor = '#111'; }
                            else if (numVal === '5') { color = '#9c27b0'; borderColor = '#7b1fa2'; textColor = '#fff'; }
                            else if (numVal === '6') { color = '#e91e63'; borderColor = '#c2185b'; textColor = '#fff'; }
                            else if (numVal === '8') { color = '#000000'; borderColor = '#333333'; textColor = '#fff'; }
                            
                            if (color) {
                                let start = (numIndices[bloqueIdx-1] !== undefined) ? numIndices[bloqueIdx-1]+1 : 0;
                                for (let i = start; i <= numIdx; i++) {
                                    bloqueColores[i] = { color, textColor, borderColor };
                                }
                            }
                        });
                        
                        // Aplicar colores según corresponda
                        elements.forEach(({ element, td, colIndex }) => {
                            if (bloqueColores[colIndex]) {
                                applyBlockColorDirect(element, td, bloqueColores[colIndex]);
                            } else {
                                clearNumberColors(element);
                            }
                        });
                    }
                }
            });
        }
        
    } catch (error) {
        console.error('Error al actualizar colores:', error);
    }
}

// ===============================================
// VERIFICACIÓN DE CARGA DE PLANTILLAS
// ===============================================

/**
 * Verificar si las plantillas se cargan correctamente
 * Refactorizado desde work_sheets.html
 */
document.addEventListener('DOMContentLoaded', function() {
    // Verificar si las plantillas se cargan correctamente
    setTimeout(function() {
        fetch('/api/store/worksheet_templates')
            .then(response => response.json())
            .then(data => {
                if (data.length === 0) {
                    // No hay plantillas para mostrar
                }
            })
            .catch(error => {
                // Error manejado silenciosamente
            });
    }, 500); // Optimizado para hojas de cálculo - reducido de 1000ms a 500ms
});

// ===============================================
// CONFIGURACIÓN DE SHARED_WORKSHEET
// ===============================================

/**
 * Configuración específica para shared_worksheet.html
 * Refactorizado desde shared_worksheet.html
 */

// ⭐ NUEVO: Configurar variables globales para el usuario INMEDIATAMENTE
// IMPORTANTE: Solo establecer isSharedMode = true si realmente estamos en modo compartido
// Verificar la ruta para determinar si estamos en shared_worksheet
// NO sobrescribir si ya está definido explícitamente en el template
if (typeof window.isSharedMode === 'undefined') {
    // Verificar si estamos en una ruta de worksheet compartida
    const path = window.location.pathname.toLowerCase();
    const isSharedWorksheetPath = path.includes('/shared_worksheet') || path.includes('/shared-worksheet') || path.includes('/worksheet/shared');
    // Solo establecer como true si estamos en una ruta compartida
    window.isSharedMode = isSharedWorksheetPath;
} else if (window.isSharedMode === false) {
    // Si ya está definido como false (desde work_sheets.html), mantenerlo así
    // No hacer nada, solo asegurarse de que no se sobrescriba
    // Esto previene problemas de timing en producción
}
if (typeof window.currentUsername === 'undefined') {
    window.currentUsername = window.currentUsername || 'Usuario';
}
if (typeof window.isAdmin === 'undefined') {
    window.isAdmin = window.isAdmin || false;
}
if (typeof window.isLoggedIn === 'undefined') {
    window.isLoggedIn = window.isLoggedIn || false;
}
if (typeof window.adminUser === 'undefined') {
    window.adminUser = window.adminUser || '';
}
if (typeof window.userIP === 'undefined') {
    window.userIP = window.userIP || '';
}

// Inicializar sistema de presencia cuando el DOM esté listo
function initializePresenceAfterDOM() {
    if (typeof initializePresenceSystem === 'function') {
        initializePresenceSystem();
    } else {
        setTimeout(initializePresenceAfterDOM, 100);
    }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePresenceAfterDOM);
} else {
    initializePresenceAfterDOM();
}
