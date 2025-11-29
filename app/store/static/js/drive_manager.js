/**
 * Drive Manager - JavaScript consolidado para Drive Transfer
 * Incluye: configuración, galería y utilidades
 */

// ==================== CONFIGURACIÓN DE DRIVE TRANSFER ====================

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('drive-transfer-form');
    const testBtn = document.getElementById('test-drive-connection');
    const statusDiv = document.getElementById('drive-status');
    
    if (!form || !testBtn || !statusDiv) {
        // Elementos no encontrados - probablemente no estamos en la página de Drive Transfer
        return;
    }
    
    // Manejar envío del formulario
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Obtener valores directamente de los campos
        const credentialsJson = document.getElementById('drive-credentials-json').value;
        const originalId = document.getElementById('drive-original-id').value;
        const destinationId = document.getElementById('drive-destination').value;
        const processingTime = document.getElementById('drive-processing-time').value;
        
        const data = {
            drive_credentials_json: credentialsJson,
            drive_original_id: originalId,
            drive_destination: destinationId,
            drive_processing_time: processingTime
        };
        
        
        // Validar campos requeridos
        if (!data.drive_credentials_json?.trim()) {
            showStatus('Por favor ingresa las credenciales JSON', false);
            return;
        }
        
        if (!data.drive_original_id?.trim()) {
            showStatus('Por favor ingresa el ID del Drive original', false);
            return;
        }
        
        if (!data.drive_destination?.trim()) {
            showStatus('Por favor ingresa el ID del Drive procesado', false);
            return;
        }
        
        if (!data.drive_processing_time?.trim()) {
            showStatus('Por favor selecciona la hora de procesamiento', false);
            return;
        }
        
        // Validar JSON de credenciales
        try {
            JSON.parse(data.drive_credentials_json);
        } catch (e) {
            showStatus('El JSON de credenciales no es válido. Verifica el formato.', false);
            return;
        }
        
        try {
            showLoadingStatus('Guardando configuración...');
            
            // Obtener token CSRF
            const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
            
            // Crear FormData con los datos
            const formData = new FormData();
            formData.append('drive_credentials_json', data.drive_credentials_json);
            formData.append('drive_original_id', data.drive_original_id);
            formData.append('drive_destination', data.drive_destination);
            formData.append('drive_deleted', data.drive_deleted);
            formData.append('drive_processing_time', data.drive_processing_time);
            
            
            const response = await fetch('/tienda/admin/drive_transfers', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showStatus(result.message, true);
                form.reset();
                // Recargar la tabla después de crear una nueva configuración
                window.loadDriveTransfersTable();
            } else {
                showStatus(result.error || 'Error desconocido', false);
            }
            
        } catch (error) {
            console.error('Error:', error);
            showStatus('Error de conexión', false);
        }
    });
    
    // Manejar prueba de conexión
    testBtn.addEventListener('click', async function() {
        const credentialsJson = document.getElementById('drive-credentials-json').value;
        
        if (!credentialsJson.trim()) {
            showStatus('Por favor ingresa las credenciales JSON', false);
            return;
        }
        
        // Validar que sea JSON válido
        try {
            JSON.parse(credentialsJson);
        } catch (e) {
            showStatus('El JSON de credenciales no es válido. Verifica el formato.', false);
            return;
        }
        
        try {
            showLoadingStatus('Probando conexión con Google Drive...');
            
            // Obtener token CSRF
            const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
            
            const formData = new FormData();
            formData.append('drive_credentials_json', credentialsJson);
            
            const response = await fetch('/tienda/admin/drive_transfers/test', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showStatus(result.message, true);
            } else {
                showStatus(result.error || 'Error de conexión', false);
            }
            
        } catch (error) {
            console.error('Error:', error);
            showStatus('Error de conexión', false);
        }
    });
    
    // Función para mostrar estado (igual que Google Sheets)
    function showStatus(message, success = true) {
        const statusDivEl = document.createElement('div');
        statusDivEl.className = success ? 'drive-status-message drive-status-success' : 'drive-status-message drive-status-error';
        statusDivEl.textContent = escapeHtml(message);
        statusDiv.innerHTML = '';
        statusDiv.appendChild(statusDivEl);
        
        // Auto-ocultar después de 5 segundos para mensajes de éxito
        if (success) {
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }
    }

    // Función para mostrar estado de carga (igual que Google Sheets)
    function showLoadingStatus(message) {
        const statusDivEl = document.createElement('div');
        statusDivEl.className = 'drive-status-message drive-status-loading';
        const spinner = document.createElement('i');
        spinner.className = 'fas fa-spinner fa-spin';
        statusDivEl.appendChild(spinner);
        statusDivEl.appendChild(document.createTextNode(' ' + escapeHtml(message)));
        statusDiv.innerHTML = '';
        statusDiv.appendChild(statusDivEl);
    }
    
    // Cargar configuraciones existentes al cargar la página
    loadExistingConfigurations();
    loadDriveTransfersTable();
    
    async function loadExistingConfigurations() {
        try {
            const response = await fetch('/tienda/admin/drive_transfers');
            const result = await response.json();
            
            if (result.transfers && result.transfers.length > 0) {
                // Ya no llenamos el formulario automáticamente
                // La tabla mostrará todas las configuraciones
                showStatus('Configuraciones cargadas correctamente', true);
            }
            
        } catch (error) {
            console.error('Error cargando configuraciones:', error);
        }
    }
});

// ==================== FUNCIONES GLOBALES PARA DRIVE TRANSFER ====================

// Función para truncar IDs largos
function truncateId(id, maxLength = 5) {
    if (!id || id.length <= maxLength) return id;
    return id.substring(0, maxLength) + '...';
}

// Función para convertir hora de formato 12h a 24h
function convert12hTo24h(time12h) {
    if (!time12h) return '';
    
    // Si ya está en formato 24h (HH:MM), devolverlo tal como está
    if (/^\d{1,2}:\d{2}$/.test(time12h)) {
        return time12h;
    }
    
    // Convertir de formato 12h (H:MM AM/PM) a 24h (HH:MM)
    const [time, period] = time12h.split(' ');
    if (!time || !period) return '';
    
    let [hours, minutes] = time.split(':');
    hours = parseInt(hours, 10);
    
    if (period.toUpperCase() === 'PM' && hours !== 12) {
        hours += 12;
    } else if (period.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

// Función helper para escapar HTML y prevenir XSS
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Función global para cargar la tabla de Drive Transfers
async function loadDriveTransfersTable() {
        try {
            const response = await fetch('/tienda/admin/drive_transfers');
            const result = await response.json();
            
            const tableContainer = document.getElementById('drive-transfers-table-container');
            
            if (result.transfers && result.transfers.length > 0) {
                // Crear elementos DOM en lugar de usar innerHTML con interpolación
                const containerDiv = document.createElement('div');
                containerDiv.className = 'table-responsive gsheets-table-container drive-transfers-table';
                
                const table = document.createElement('table');
                table.className = 'table table-striped table-hover mb-0 drive-transfers-table-inner';
                
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                ['Drive Original', 'Drive Procesado', 'Hora', 'Estado', 'Acciones'].forEach(headerText => {
                    const th = document.createElement('th');
                    th.textContent = headerText;
                    headerRow.appendChild(th);
                });
                thead.appendChild(headerRow);
                table.appendChild(thead);
                
                const tbody = document.createElement('tbody');
                
                result.transfers.forEach(transfer => {
                    const tr = document.createElement('tr');
                    
                    // Drive Original
                    const td1 = document.createElement('td');
                    const code1 = document.createElement('code');
                    code1.className = 'drive-id-code';
                    code1.textContent = truncateId(transfer.drive_original_id);
                    code1.title = escapeHtml(transfer.drive_original_id);
                    td1.appendChild(code1);
                    tr.appendChild(td1);
                    
                    // Drive Procesado
                    const td2 = document.createElement('td');
                    const code2 = document.createElement('code');
                    code2.className = 'drive-id-code';
                    code2.textContent = truncateId(transfer.drive_processed_id);
                    code2.title = escapeHtml(transfer.drive_processed_id);
                    td2.appendChild(code2);
                    tr.appendChild(td2);
                    
                    // Hora
                    const td3 = document.createElement('td');
                    td3.textContent = transfer.processing_time || '--:-- --';
                    tr.appendChild(td3);
                    
                    // Estado
                    const td4 = document.createElement('td');
                    const toggleBtn = document.createElement('button');
                    toggleBtn.className = `action-btn ${transfer.is_active ? 'action-red' : 'action-green'} drive-transfer-toggle`;
                    toggleBtn.textContent = transfer.is_active ? 'OFF' : 'ON';
                    toggleBtn.dataset.transferId = transfer.id;
                    td4.appendChild(toggleBtn);
                    tr.appendChild(td4);
                    
                    // Acciones
                    const td5 = document.createElement('td');
                    
                    const testBtn = document.createElement('button');
                    testBtn.className = 'btn-panel btn-blue btn-table-action drive-transfer-test';
                    testBtn.dataset.transferId = transfer.id;
                    testBtn.title = 'Probar conexión';
                    testBtn.innerHTML = '<i class="fas fa-plug"></i>';
                    td5.appendChild(testBtn);
                    
                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn-panel btn-orange btn-table-action drive-transfer-edit';
                    editBtn.dataset.transferId = transfer.id;
                    editBtn.title = 'Editar';
                    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                    td5.appendChild(editBtn);
                    
                    const cleanupBtn = document.createElement('button');
                    cleanupBtn.className = 'btn-panel btn-purple btn-table-action drive-transfer-cleanup';
                    cleanupBtn.dataset.transferId = transfer.id;
                    cleanupBtn.title = 'Limpiar archivos antiguos';
                    cleanupBtn.innerHTML = '<i class="fas fa-broom"></i>';
                    td5.appendChild(cleanupBtn);
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn-panel btn-red btn-table-action drive-transfer-delete';
                    deleteBtn.dataset.transferId = transfer.id;
                    deleteBtn.title = 'Eliminar';
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    td5.appendChild(deleteBtn);
                    
                    // Botón para ejecutar transferencia manualmente
                    const executeBtn = document.createElement('button');
                    executeBtn.className = 'btn-panel btn-green btn-table-action drive-transfer-execute';
                    executeBtn.dataset.transferId = transfer.id;
                    executeBtn.title = 'Ejecutar transferencia ahora';
                    executeBtn.innerHTML = '<i class="fas fa-play"></i>';
                    td5.appendChild(executeBtn);
                    
                    tr.appendChild(td5);
                    tbody.appendChild(tr);
                });
                
                table.appendChild(tbody);
                containerDiv.appendChild(table);
                tableContainer.innerHTML = '';
                tableContainer.appendChild(containerDiv);
                
                // Agregar event listeners después de crear los elementos
                tableContainer.querySelectorAll('.drive-transfer-toggle').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const transferId = parseInt(this.dataset.transferId);
                        toggleDriveTransfer(transferId);
                    });
                });
                
                tableContainer.querySelectorAll('.drive-transfer-test').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const transferId = parseInt(this.dataset.transferId);
                        testDriveTransferConnection(transferId);
                    });
                });
                
                tableContainer.querySelectorAll('.drive-transfer-edit').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const transferId = parseInt(this.dataset.transferId);
                        editDriveTransfer(transferId);
                    });
                });
                
                tableContainer.querySelectorAll('.drive-transfer-cleanup').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const transferId = parseInt(this.dataset.transferId);
                        openCleanupModal(transferId);
                    });
                });
                
                tableContainer.querySelectorAll('.drive-transfer-delete').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const transferId = parseInt(this.dataset.transferId);
                        deleteDriveTransfer(transferId);
                    });
                });
                
                tableContainer.querySelectorAll('.drive-transfer-execute').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const transferId = parseInt(this.dataset.transferId);
                        executeDriveTransferNow(transferId);
                    });
                });
            } else {
                tableContainer.innerHTML = '<div class="text-center my-3">No hay configuraciones de Drive Transfer.</div>';
            }
            
        } catch (error) {
            console.error('Error cargando tabla de Drive Transfer:', error);
            document.getElementById('drive-transfers-table-container').innerHTML = 
                '<div class="text-danger text-center my-3">Error al cargar las configuraciones.</div>';
        }
}

// ==================== CONFIGURACIÓN DE VALIDACIÓN ====================

document.addEventListener('DOMContentLoaded', function() {
    // Validación de campos
    const requiredFields = ['drive-credentials-json', 'drive-original-id', 'drive-destination', 'drive-processing-time'];
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('blur', function() {
                validateField(this);
            });
        }
    });
    
    function validateField(field) {
        const value = field.value.trim();
        const isValid = value.length > 0;
        
        if (isValid) {
            field.classList.remove('is-invalid');
            field.classList.add('is-valid');
        } else {
            field.classList.remove('is-valid');
            field.classList.add('is-invalid');
        }
        
        return isValid;
    }
    
    // Validar formulario antes del envío
    const form = document.getElementById('drive-transfer-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            let isValid = true;
            
            requiredFields.forEach(fieldId => {
                const field = document.getElementById(fieldId);
                if (field && !validateField(field)) {
                    isValid = false;
                }
            });
            
            if (!isValid) {
                e.preventDefault();
                showStatus('Por favor completa todos los campos requeridos', 'error');
            }
        });
    }
    
    // Configurar modales
    setupDriveEditModal();
    setupCleanupModal();
});

// ==================== FUNCIONES GLOBALES PARA DRIVE TRANSFER ====================

// Función para alternar ON/OFF
// Función global para alternar estado de Drive Transfer
window.toggleDriveTransfer = async function(transferId) {
    try {
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const response = await fetch(`/tienda/admin/drive_transfers/${transferId}/toggle`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showDriveStatus(result.message, true);
            // Recargar la tabla
            window.loadDriveTransfersTable();
        } else {
            showDriveStatus(result.error || 'Error al cambiar estado', false);
        }
        
    } catch (error) {
        console.error('Error:', error);
        showDriveStatus('Error de conexión', false);
    }
}

// Función para probar conexión de una configuración específica
// Función global para probar conexión de Drive Transfer
window.testDriveTransferConnection = async function(transferId) {
    try {
        showDriveStatus('Probando conexión...', true);
        
        // Primero obtener la configuración
        const response = await fetch(`/tienda/admin/drive_transfers`);
        const result = await response.json();
        
        const transfer = result.transfers.find(t => t.id === transferId);
        if (!transfer) {
            showDriveStatus('Configuración no encontrada', false);
            return;
        }
        
        // Probar conexión
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const testFormData = new FormData();
        testFormData.append('drive_credentials_json', transfer.credentials_json);
        
        const testResponse = await fetch('/tienda/admin/drive_transfers/test', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            },
            body: testFormData
        });
        
        const testResult = await testResponse.json();
        
        if (testResult.success) {
            showDriveStatus(`Conexión exitosa para Drive ${transferId}`, true);
        } else {
            showDriveStatus(`Error de conexión para Drive ${transferId}: ${testResult.error}`, false);
        }
        
    } catch (error) {
        console.error('Error:', error);
        showDriveStatus('Error de conexión', false);
    }
}

// Función para editar configuración
// Función global para editar Drive Transfer
window.editDriveTransfer = async function(transferId) {
    try {
        
        // Obtener datos de la configuración
        const response = await fetch(`/tienda/admin/drive_transfers`);
        const result = await response.json();
        
        
        const transfer = result.transfers.find(t => t.id === transferId);
        if (!transfer) {
            showDriveStatus('Configuración no encontrada', false);
            return;
        }
        
        // Llenar el modal
        document.getElementById('edit-drive-id').value = transfer.id;
        document.getElementById('edit-drive-credentials-json').value = transfer.credentials_json || '';
        document.getElementById('edit-drive-original-id').value = transfer.drive_original_id || '';
        document.getElementById('edit-drive-destination').value = transfer.drive_processed_id || '';
        document.getElementById('edit-drive-deleted').value = transfer.drive_deleted_id || '';
        
        // Convertir hora de formato 12h a 24h para el input time
        const timeValue = convert12hTo24h(transfer.processing_time);
        document.getElementById('edit-drive-processing-time').value = timeValue;
        
        
        // Mostrar modal
        document.getElementById('drive-edit-modal').classList.remove('d-none');
        
    } catch (error) {
        console.error('Error:', error);
        showDriveStatus('Error al cargar configuración', false);
    }
}

// Función para eliminar configuración
// Función global para ejecutar transferencia manualmente
window.executeDriveTransferNow = async function(transferId) {
    if (!confirm('¿Ejecutar la transferencia de Drive ahora? Esto moverá los archivos del Drive original al Drive procesado.')) {
        return;
    }
    
    try {
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        
        showDriveStatus('Ejecutando transferencia...', true);
        console.log(`[DRIVE_TRANSFER] Iniciando ejecución manual para transfer ${transferId}`);
        
        const response = await fetch(`/tienda/admin/drive_transfers/${transferId}/execute_now`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`[DRIVE_TRANSFER] Respuesta recibida. Status: ${response.status}`);
        
        if (!response.ok) {
            // Intentar parsear el error
            try {
                const errorResult = await response.json();
                console.error('[DRIVE_TRANSFER] Error en respuesta:', errorResult);
                showDriveStatus(`Error ${response.status}: ${errorResult.error || 'Error desconocido'}`, false);
            } catch (e) {
                console.error('[DRIVE_TRANSFER] Error parseando respuesta:', e);
                showDriveStatus(`Error ${response.status}: No se pudo obtener detalles del error`, false);
            }
            return;
        }
        
        const result = await response.json();
        console.log('[DRIVE_TRANSFER] Resultado:', result);
        
        if (result.success) {
            let message = result.message || 'Transferencia ejecutada exitosamente';
            if (result.result) {
                const r = result.result;
                message += ` | Archivos movidos: ${r.files_moved || 0}, Fallidos: ${r.files_failed || 0}`;
            }
            showDriveStatus(message, true);
            // Recargar la tabla para mostrar la última ejecución actualizada
            setTimeout(() => {
                window.loadDriveTransfersTable();
            }, 1000);
        } else {
            console.error('[DRIVE_TRANSFER] Error en resultado:', result);
            showDriveStatus(`Error: ${result.error || 'Error desconocido'}`, false);
        }
    } catch (error) {
        console.error('[DRIVE_TRANSFER] Error ejecutando transferencia:', error);
        showDriveStatus(`Error de conexión: ${error.message}. Verifica la consola para más detalles.`, false);
    }
};

// Función global para eliminar Drive Transfer
window.deleteDriveTransfer = async function(transferId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta configuración?')) {
        return;
    }
    
    try {
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const response = await fetch(`/tienda/admin/drive_transfers/${transferId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });
        
        const result = await response.json();
        
            if (result.success) {
                showDriveStatus(result.message, true);
                // Recargar la tabla
                window.loadDriveTransfersTable();
            } else {
                showDriveStatus(result.error || 'Error al eliminar', false);
            }
        
    } catch (error) {
        console.error('Error:', error);
        showDriveStatus('Error de conexión', false);
    }
}

// Función para mostrar estado (específica para Drive - igual que Google Sheets)
function showDriveStatus(message, success = true) {
    const statusDiv = document.getElementById('drive-status');
    if (statusDiv) {
        const statusDivEl = document.createElement('div');
        statusDivEl.className = success ? 'drive-status-message drive-status-success' : 'drive-status-message drive-status-error';
        statusDivEl.textContent = escapeHtml(message);
        statusDiv.innerHTML = '';
        statusDiv.appendChild(statusDivEl);
        
        // Auto-ocultar después de 5 segundos para mensajes de éxito
        if (success) {
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }
    }
}

// Configurar modal de edición
function setupDriveEditModal() {
    const modal = document.getElementById('drive-edit-modal');
    const closeBtn = document.getElementById('close-drive-edit-modal');
    const editForm = document.getElementById('drive-edit-form');
    
    // Verificar que los elementos existan antes de agregar listeners
    if (!modal || !closeBtn || !editForm) {
        return; // Elementos no encontrados - probablemente no estamos en la página correcta
    }
    
    // Cerrar modal
    closeBtn.addEventListener('click', () => {
        modal.classList.add('d-none');
    });
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('d-none');
        }
    });
    
    // Manejar envío del formulario de edición
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(editForm);
        const data = Object.fromEntries(formData.entries());
        const transferId = data.edit_drive_id;
        
        
        try {
            showDriveStatus('Actualizando configuración...', true);
            
            const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
            const formData = new FormData();
            formData.append('drive_credentials_json', data.drive_credentials_json);
            formData.append('drive_original_id', data.drive_original_id);
            formData.append('drive_destination', data.drive_destination);
            formData.append('drive_deleted', data.drive_deleted);
            formData.append('drive_processing_time', data.drive_processing_time);
            
            
            const response = await fetch(`/tienda/admin/drive_transfers/${transferId}`, {
                method: 'PUT',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showDriveStatus(result.message, true);
                modal.classList.add('d-none');
                // Recargar la tabla
                window.loadDriveTransfersTable();
            } else {
                showDriveStatus(result.error || 'Error al actualizar', false);
            }
            
        } catch (error) {
            console.error('Error:', error);
            showDriveStatus('Error de conexión', false);
        }
    });
}

// Variables globales para el control de limpieza
let cleanupController = null;
let cleanupInProgress = false;

// Configurar modal de limpieza
function setupCleanupModal() {
    const modal = document.getElementById('drive-cleanup-modal');
    const closeBtn = document.getElementById('close-cleanup-modal');
    const cleanupForm = document.getElementById('drive-cleanup-form');
    const executeBtn = document.getElementById('execute-cleanup-btn');
    const stopBtn = document.getElementById('stop-cleanup-btn');
    const progressSection = document.getElementById('cleanup-progress-section');
    
    // Verificar que los elementos existan antes de agregar listeners
    if (!modal || !closeBtn || !cleanupForm || !executeBtn || !stopBtn || !progressSection) {
        return; // Elementos no encontrados - probablemente no estamos en la página correcta
    }
    
    // Cerrar modal
    closeBtn.addEventListener('click', () => {
        if (cleanupInProgress) {
            if (!confirm('La limpieza está en progreso. ¿Estás seguro de que quieres cerrar el modal?')) {
                return;
            }
            stopCleanup();
        }
        modal.classList.add('d-none');
        resetCleanupModal();
    });
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            if (cleanupInProgress) {
                if (!confirm('La limpieza está en progreso. ¿Estás seguro de que quieres cerrar el modal?')) {
                    return;
                }
                stopCleanup();
            }
            modal.classList.add('d-none');
            resetCleanupModal();
        }
    });
    
    // Botón de detener limpieza
    stopBtn.addEventListener('click', () => {
        if (confirm('¿Estás seguro de que quieres detener la limpieza?')) {
            stopCleanup();
        }
    });
    
    // Manejar envío del formulario de limpieza
    cleanupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (cleanupInProgress) {
            showDriveStatus('Ya hay una limpieza en progreso', false);
            return;
        }
        
        const formData = new FormData(cleanupForm);
        const data = Object.fromEntries(formData.entries());
        const transferId = data.cleanup_drive_id;
        const daysOld = data.cleanup_days;
        const scheduleTime = data.cleanup_schedule_time;
        
        if (!daysOld || daysOld === '') {
            showDriveStatus('Por favor selecciona los días', false);
            return;
        }
        
        // Confirmar acción
        const daysText = daysOld == 0 ? 'TODOS los archivos (sin importar antigüedad)' : `${daysOld} días`;
        const actionText = scheduleTime ? 
            `¿Estás seguro de que quieres programar la eliminación de archivos más antiguos que ${daysText} para las ${scheduleTime}?` :
            `¿Estás seguro de que quieres eliminar archivos más antiguos que ${daysText} AHORA?`;
            
        if (!confirm(actionText)) {
            return;
        }
        
        // Iniciar limpieza
        await startCleanup(transferId, daysOld, scheduleTime);
    });
}

// Función para iniciar la limpieza con progreso
async function startCleanup(transferId, daysOld, scheduleTime) {
    try {
        // Mostrar sección de progreso
        document.getElementById('cleanup-progress-section').classList.remove('d-none');
        document.getElementById('execute-cleanup-btn').disabled = true;
        cleanupInProgress = true;
        
        // Resetear progreso
        updateCleanupProgress(0, 0, 0);
        showDriveStatus('Iniciando limpieza...', true);
        
        // Crear AbortController para poder cancelar
        cleanupController = new AbortController();
        
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const formData = new FormData();
        formData.append('cleanup_days', daysOld);
        if (scheduleTime) {
            formData.append('cleanup_schedule_time', scheduleTime);
        }
        
        // Simular progreso mientras se ejecuta la limpieza
        const progressInterval = setInterval(() => {
            if (cleanupInProgress) {
                // Simular progreso incremental
                const currentProgress = Math.min(95, Math.random() * 20 + 10);
                updateCleanupProgress(currentProgress, 
                    Math.floor(Math.random() * 50), 
                    Math.floor(Math.random() * 30));
            }
        }, 1000);
        
        const response = await fetch(`/tienda/admin/drive_transfers/${transferId}/cleanup`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            },
            body: formData,
            signal: cleanupController.signal
        });
        
        clearInterval(progressInterval);
        
        if (response.ok) {
            const result = await response.json();
            
            if (result.success) {
                // Completar progreso
                updateCleanupProgress(100, result.files_processed || 0, result.files_deleted || 0);
                
                const message = result.files_deleted > 0 ? 
                    `✅ Limpieza completada: ${result.message}` : 
                    `ℹ️ Limpieza completada: ${result.message}`;
                showDriveStatus(message, true);
                
                // Cerrar modal después de 3 segundos
                setTimeout(() => {
                    document.getElementById('drive-cleanup-modal').classList.add('d-none');
                    resetCleanupModal();
                }, 3000);
            } else {
                showDriveStatus(result.error || 'Error en limpieza', false);
                resetCleanupModal();
            }
        } else {
            throw new Error('Error en la respuesta del servidor');
        }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            showDriveStatus('Limpieza detenida por el usuario', false);
        } else {
            console.error('Error:', error);
            showDriveStatus('Error de conexión', false);
        }
        resetCleanupModal();
    }
}

// Función para detener la limpieza
function stopCleanup() {
    if (cleanupController) {
        cleanupController.abort();
    }
    cleanupInProgress = false;
    showDriveStatus('Deteniendo limpieza...', false);
    
    setTimeout(() => {
        resetCleanupModal();
    }, 1000);
}

// Función para actualizar el progreso
function updateCleanupProgress(percentage, filesProcessed, filesDeleted) {
    const progressBar = document.getElementById('cleanup-progress-bar');
    const progressText = document.getElementById('cleanup-progress-text');
    const filesProcessedSpan = document.getElementById('cleanup-files-processed');
    const filesDeletedSpan = document.getElementById('cleanup-files-deleted');
    
    progressBar.style.width = `${percentage}%`;
    progressBar.setAttribute('aria-valuenow', percentage);
    progressText.textContent = `${Math.round(percentage)}%`;
    filesProcessedSpan.textContent = filesProcessed;
    filesDeletedSpan.textContent = filesDeleted;
}

// Función para resetear el modal de limpieza
function resetCleanupModal() {
    const progressSection = document.getElementById('cleanup-progress-section');
    const executeBtn = document.getElementById('execute-cleanup-btn');
    const cleanupForm = document.getElementById('drive-cleanup-form');
    
    progressSection.classList.add('d-none');
    executeBtn.disabled = false;
    cleanupInProgress = false;
    cleanupController = null;
    
    updateCleanupProgress(0, 0, 0);
    cleanupForm.reset();
}

// Función para abrir modal de limpieza
// Función global para abrir modal de limpieza
window.openCleanupModal = function(transferId) {
    // Resetear modal antes de abrir
    resetCleanupModal();
    
    document.getElementById('cleanup-drive-id').value = transferId;
    document.getElementById('drive-cleanup-modal').classList.remove('d-none');
}

// ==================== GALERÍA DE DRIVE ====================

class DriveGallery {
    constructor() {
        this.galleries = {};
        this.init();
    }

    init() {
        // Configurar botones de cargar fotos y videos
        document.querySelectorAll('[id^="loadPhotosBtn-"]').forEach(btn => {
            const apiId = btn.id.split('-')[1];
            btn.addEventListener('click', () => this.loadPhotos(apiId));
        });
        document.querySelectorAll('[id^="loadVideosBtn-"]').forEach(btn => {
            const apiId = btn.id.split('-')[1];
            btn.addEventListener('click', () => this.loadVideos(apiId));
        });
    }

    async loadPhotos(apiId) {
        const galleryEl = document.getElementById(`photosGallery-${apiId}`);
        const paginationEl = document.getElementById(`photosPagination-${apiId}`);
        const paginationTopEl = document.getElementById(`photosPaginationTop-${apiId}`);
        const btn = document.getElementById(`loadPhotosBtn-${apiId}`);
        galleryEl.innerHTML = '<div class="text-center my-3"><i class="fas fa-spinner fa-spin"></i> Cargando fotos...</div>';
        paginationEl.innerHTML = '';
        paginationTopEl.innerHTML = '';
        btn.disabled = true;
        try {
            const response = await fetch(`/tienda/api/drive-files?id=${apiId}`);
            if (!response.ok) throw new Error('Error al cargar archivos');
            const files = await response.json();
            this.galleries[apiId] = this.galleries[apiId] || { photos: [], videos: [], currentPhotoPage: 0, currentVideoPage: 0 };
            this.galleries[apiId].photos = files.filter(file => file.mimeType.startsWith('image/'));
            this.galleries[apiId].currentPhotoPage = 0;
            this.renderPhotos(apiId);
        } catch (error) {
            galleryEl.innerHTML = `<div class='text-danger text-center my-3'>Error al cargar las fotos: ${error.message}</div>`;
        } finally {
            btn.disabled = false;
        }
    }

    async loadVideos(apiId) {
        const galleryEl = document.getElementById(`videosGallery-${apiId}`);
        const paginationEl = document.getElementById(`videosPagination-${apiId}`);
        const paginationTopEl = document.getElementById(`videosPaginationTop-${apiId}`);
        const btn = document.getElementById(`loadVideosBtn-${apiId}`);
        galleryEl.innerHTML = '<div class="text-center my-3"><i class="fas fa-spinner fa-spin"></i> Cargando videos...</div>';
        paginationEl.innerHTML = '';
        paginationTopEl.innerHTML = '';
        btn.disabled = true;
        try {
            const response = await fetch(`/tienda/api/drive-files?id=${apiId}`);
            if (!response.ok) throw new Error('Error al cargar archivos');
            const files = await response.json();
            this.galleries[apiId] = this.galleries[apiId] || { photos: [], videos: [], currentPhotoPage: 0, currentVideoPage: 0 };
            this.galleries[apiId].videos = files.filter(file => file.mimeType.startsWith('video/'));
            this.galleries[apiId].currentVideoPage = 0;
            this.renderVideos(apiId);
        } catch (error) {
            galleryEl.innerHTML = `<div class='text-danger text-center my-3'>Error al cargar los videos: ${error.message}</div>`;
        } finally {
            btn.disabled = false;
        }
    }

    renderPhotos(apiId) {
        const galleryEl = document.getElementById(`photosGallery-${apiId}`);
        const paginationEl = document.getElementById(`photosPagination-${apiId}`);
        const paginationTopEl = document.getElementById(`photosPaginationTop-${apiId}`);
        const gallery = this.galleries[apiId];
        const start = gallery.currentPhotoPage * 12;
        const end = start + 12;
        const pagePhotos = gallery.photos.slice(start, end);
        if (gallery.photos.length === 0) {
            galleryEl.innerHTML = '<div class="text-center my-3">No hay fotos disponibles.</div>';
            if (paginationEl) paginationEl.innerHTML = '';
            if (paginationTopEl) paginationTopEl.innerHTML = '';
            return;
        }
        galleryEl.innerHTML = `<div class='photos-grid'>${pagePhotos.map((photo, idx) => this.createPhotoItem(photo, start + idx, apiId)).join('')}</div>`;
        const pagHtml = this.renderPagination(gallery.currentPhotoPage, gallery.photos.length, 12, 'photo', apiId, false);
        const pagHtmlTop = this.renderPagination(gallery.currentPhotoPage, gallery.photos.length, 12, 'photo', apiId, true);
        if (paginationEl) paginationEl.innerHTML = pagHtml;
        if (paginationTopEl) paginationTopEl.innerHTML = pagHtmlTop;
        this.addPaginationListeners('photo', apiId);
        // Agregar event listeners para botón de descargar fotos
        galleryEl.querySelectorAll('.drive-photo-download').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                const photoItem = this.closest('.photo-item');
                const fileId = this.dataset.fileId || (photoItem ? photoItem.dataset.fileId : null);
                const apiId = photoItem ? photoItem.dataset.apiId : null;
                // Usar proxy del backend para descarga directa
                const proxyUrl = fileId && apiId ? `/tienda/drive/proxy?file_id=${fileId}&api_id=${apiId}&type=image` : null;
                if (proxyUrl) {
                    driveGallery.downloadFile(proxyUrl, this.dataset.name, 'image', fileId, apiId);
                } else {
                    console.error('No se pudo obtener fileId o apiId para descargar');
                }
            });
        });
        
        // Agregar event listeners para botón de compartir fotos
        this.addShareAndDownloadListeners(galleryEl);
        
        // Agregar event listeners para abrir visor al hacer clic en las fotos
        galleryEl.querySelectorAll('.photo-item').forEach(item => {
            item.addEventListener('click', function(e) {
                // No abrir si se hizo clic en los botones
                if (e.target.closest('.photo-actions')) return;
                const index = parseInt(this.dataset.index);
                const apiId = this.dataset.apiId;
                driveGallery.openViewer('photo', apiId, index);
            });
        });
    }

    renderVideos(apiId) {
        const galleryEl = document.getElementById(`videosGallery-${apiId}`);
        const paginationEl = document.getElementById(`videosPagination-${apiId}`);
        const paginationTopEl = document.getElementById(`videosPaginationTop-${apiId}`);
        const gallery = this.galleries[apiId];
        const start = gallery.currentVideoPage * 12;
        const end = start + 12;
        const pageVideos = gallery.videos.slice(start, end);
        if (gallery.videos.length === 0) {
            galleryEl.innerHTML = '<div class="text-center my-3">No hay videos disponibles.</div>';
            if (paginationEl) paginationEl.innerHTML = '';
            if (paginationTopEl) paginationTopEl.innerHTML = '';
            return;
        }
        galleryEl.innerHTML = `<div class='videos-grid'>${pageVideos.map((video, idx) => this.createVideoItem(video, start + idx, apiId)).join('')}</div>`;
        const pagHtml = this.renderPagination(gallery.currentVideoPage, gallery.videos.length, 12, 'video', apiId, false);
        const pagHtmlTop = this.renderPagination(gallery.currentVideoPage, gallery.videos.length, 12, 'video', apiId, true);
        if (paginationEl) paginationEl.innerHTML = pagHtml;
        if (paginationTopEl) paginationTopEl.innerHTML = pagHtmlTop;
        this.addPaginationListeners('video', apiId);
        // Agregar event listeners para botón de descargar videos
        galleryEl.querySelectorAll('.drive-video-download').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                const videoItem = this.closest('.video-item');
                const fileId = this.dataset.fileId || (videoItem ? videoItem.dataset.fileId : null);
                const apiId = videoItem ? videoItem.dataset.apiId : null;
                // Usar proxy del backend para descarga directa
                const proxyUrl = fileId && apiId ? `/tienda/drive/proxy?file_id=${fileId}&api_id=${apiId}&type=video` : null;
                if (proxyUrl) {
                    driveGallery.downloadFile(proxyUrl, this.dataset.name, 'video', fileId, apiId);
                } else {
                    console.error('No se pudo obtener fileId o apiId para descargar');
                }
            });
        });
        
        // Agregar event listeners para botón de compartir videos
        this.addShareAndDownloadListeners(galleryEl);
        
        // Agregar event listeners para abrir visor al hacer clic en los videos
        galleryEl.querySelectorAll('.video-item').forEach(item => {
            item.addEventListener('click', function(e) {
                // No abrir si se hizo clic en los botones
                if (e.target.closest('.video-actions')) return;
                const index = parseInt(this.dataset.index);
                const apiId = this.dataset.apiId;
                driveGallery.openViewer('video', apiId, index);
            });
        });
    }

    renderPagination(currentPage, totalItems, itemsPerPage, type, apiId, isTop) {
        const maxPage = Math.ceil(totalItems / itemsPerPage) - 1;
        if (maxPage <= 0) return '';
        const topSuffix = isTop ? 'Top' : '';
        return `
            <div class="pagination-block">
                <div class="d-flex justify-content-center align-items-center my-1">
                    <span class="pagination-page-text">Página ${currentPage + 1} de ${maxPage + 1}</span>
                </div>
                <div class="d-flex justify-content-center align-items-center gap-2 my-2 pagination-btns">
                    <button type="button" class="btn-panel btn-blue" id="prev${type.charAt(0).toUpperCase() + type.slice(1)}PageBtn${topSuffix}-${apiId}" ${currentPage === 0 ? 'disabled' : ''}>&lt; Anterior</button>
                    <button type="button" class="btn-panel btn-blue" id="next${type.charAt(0).toUpperCase() + type.slice(1)}PageBtn${topSuffix}-${apiId}" ${currentPage === maxPage ? 'disabled' : ''}>Siguiente &gt;</button>
                </div>
            </div>
        `;
    }

    addPaginationListeners(type, apiId) {
        const prevBtn = document.getElementById(`prev${type.charAt(0).toUpperCase() + type.slice(1)}PageBtn-${apiId}`);
        const nextBtn = document.getElementById(`next${type.charAt(0).toUpperCase() + type.slice(1)}PageBtn-${apiId}`);
        
        const prevBtnTop = document.getElementById(`prev${type.charAt(0).toUpperCase() + type.slice(1)}PageBtnTop-${apiId}`);
        const nextBtnTop = document.getElementById(`next${type.charAt(0).toUpperCase() + type.slice(1)}PageBtnTop-${apiId}`);
        const self = this;
        function goPrev() {
            if (type === 'photo') {
                self.galleries[apiId].currentPhotoPage--;
                self.renderPhotos(apiId);
            } else {
                self.galleries[apiId].currentVideoPage--;
                self.renderVideos(apiId);
            }
        }
        function goNext() {
            if (type === 'photo') {
                self.galleries[apiId].currentPhotoPage++;
                self.renderPhotos(apiId);
            } else {
                self.galleries[apiId].currentVideoPage++;
                self.renderVideos(apiId);
            }
        }
        if (prevBtn) prevBtn.addEventListener('click', goPrev);
        if (nextBtn) nextBtn.addEventListener('click', goNext);
        if (prevBtnTop) prevBtnTop.addEventListener('click', goPrev);
        if (nextBtnTop) nextBtnTop.addEventListener('click', goNext);
    }

    createPhotoItem(photo, index, apiId) {
        const thumbnailUrl = `https://drive.google.com/thumbnail?id=${photo.id}&sz=w400`;
        const fullUrl = `https://drive.google.com/uc?export=view&id=${photo.id}`;
        const proxyUrl = `/tienda/drive/proxy?file_id=${photo.id}&api_id=${apiId}&type=image`;
        const escapedName = escapeHtml(photo.name);
        return `
            <div class="photo-item drive-media-item" data-type="photo" data-index="${index}" data-api-id="${apiId}" data-file-id="${photo.id}" data-full-url="${escapeHtml(fullUrl)}" data-name="${escapedName}">
                <img src="${escapeHtml(thumbnailUrl)}" alt="${escapedName}" loading="lazy" class="drive-photo-thumbnail">
                    <div class="photo-actions">
                    <button class="btn-download-icon drive-photo-download" data-file-id="${photo.id}" data-name="${escapedName}" title="Descargar">
                        <i class="fas fa-download"></i>
                        </button>
                </div>
            </div>
        `;
    }

    createVideoItem(video, index, apiId) {
        const thumbnailUrl = `https://drive.google.com/thumbnail?id=${video.id}&sz=w400`;
        const fullUrl = `https://drive.google.com/uc?export=download&id=${video.id}`;
        const proxyUrl = `/tienda/drive/proxy?file_id=${video.id}&api_id=${apiId}&type=video`;
        const escapedName = escapeHtml(video.name);
        return `
            <div class="video-item drive-media-item" data-type="video" data-index="${index}" data-api-id="${apiId}" data-file-id="${video.id}" data-full-url="${escapeHtml(fullUrl)}" data-name="${escapedName}">
                <video src="${escapeHtml(fullUrl)}" poster="${escapeHtml(thumbnailUrl)}" preload="none" class="drive-video-thumbnail"></video>
                    <div class="video-actions">
                    <button class="btn-download-icon drive-video-download" data-file-id="${video.id}" data-name="${escapedName}" title="Descargar">
                        <i class="fas fa-download"></i>
                        </button>
                </div>
            </div>
        `;
    }

    addShareAndDownloadListeners(galleryEl) {
        // Esta función ya no es necesaria ya que eliminamos el icono de compartir
        // Se mantiene por compatibilidad pero no hace nada
    }

    downloadFile(url, filename, mediaType = null, fileId = null, apiId = null) {
        // Determinar si es imagen o video
        const isImage = mediaType === 'image' || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
        const isVideo = mediaType === 'video' || /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i.test(filename);
        
        // Detectar si es móvil
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Siempre usar proxy del backend si está disponible (evita problemas de CORS y pestañas nuevas)
        const downloadUrl = (fileId && apiId) ? `/tienda/drive/proxy?file_id=${fileId}&api_id=${apiId}&type=${mediaType || (isImage ? 'image' : 'video')}` : url;
        
        // Para imágenes y videos, usar fetch y blob para descarga directa
        if (isImage || isVideo) {
            // Mostrar indicador de carga
            const loadingMsg = document.createElement('div');
            loadingMsg.className = 'drive-download-loading';
            loadingMsg.textContent = 'Descargando...';
            document.body.appendChild(loadingMsg);
            
            // Usar fetch con el proxy del backend
            fetch(downloadUrl, {
                method: 'GET',
                headers: {
                    'Accept': isImage ? 'image/*' : 'video/*'
                },
                // Evitar que se abra en nueva pestaña
                credentials: 'same-origin'
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Error ${response.status}: ${response.statusText}`);
                    }
                    return response.blob();
                })
                .then(blob => {
                    // Determinar tipo MIME correcto
                    let mimeType = blob.type;
                    if (!mimeType || mimeType === 'application/octet-stream') {
                        if (isImage) {
                            // Detectar tipo de imagen por extensión
                            const ext = filename.toLowerCase().split('.').pop();
                            mimeType = {
                                'jpg': 'image/jpeg',
                                'jpeg': 'image/jpeg',
                                'png': 'image/png',
                                'gif': 'image/gif',
                                'webp': 'image/webp',
                                'bmp': 'image/bmp'
                            }[ext] || 'image/jpeg';
                        } else if (isVideo) {
                            const ext = filename.toLowerCase().split('.').pop();
                            mimeType = {
                                'mp4': 'video/mp4',
                                'avi': 'video/x-msvideo',
                                'mov': 'video/quicktime',
                                'wmv': 'video/x-ms-wmv',
                                'flv': 'video/x-flv',
                                'webm': 'video/webm',
                                'mkv': 'video/x-matroska'
                            }[ext] || 'video/mp4';
                        }
                    }
                    
                    // Crear blob con tipo MIME correcto
                    const typedBlob = new Blob([blob], { type: mimeType });
                    const blobUrl = window.URL.createObjectURL(typedBlob);
                    
                    // Crear link de descarga
        const a = document.createElement('a');
                    a.href = blobUrl;
        a.download = filename;
                    a.setAttribute('download', filename);
                    a.className = 'drive-download-link-hidden';
                    
                    // Para móviles, asegurar que se guarde en galería
                    if (isMobile) {
                        // Agregar atributos adicionales para móviles
                        a.setAttribute('download', filename);
                    }
                    
        document.body.appendChild(a);
                    
                    // Intentar descargar
                    try {
        a.click();
                    } catch (err) {
                        console.error('Error al hacer clic en link de descarga:', err);
                        // Fallback: intentar con Web Share API en móviles
                        if (isMobile && navigator.share && navigator.canShare) {
                            const file = new File([typedBlob], filename, { type: mimeType });
                            if (navigator.canShare({ files: [file] })) {
                                navigator.share({
                                    files: [file],
                                    title: filename
                                }).catch(shareErr => {
                                    console.error('Error compartiendo:', shareErr);
                                });
                            }
                        }
                    }
                    
                    // Limpiar después de un tiempo
                    setTimeout(() => {
                        if (a.parentNode) document.body.removeChild(a);
                        window.URL.revokeObjectURL(blobUrl);
                        if (loadingMsg.parentNode) document.body.removeChild(loadingMsg);
                    }, 2000);
                })
                .catch(error => {
                    console.error('Error descargando archivo:', error);
                    if (loadingMsg.parentNode) document.body.removeChild(loadingMsg);
                    
                    // Mostrar mensaje de error al usuario
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'drive-download-loading drive-download-error';
                    errorMsg.textContent = 'Error al descargar. Intenta nuevamente.';
                    document.body.appendChild(errorMsg);
                    setTimeout(() => {
                        if (errorMsg.parentNode) document.body.removeChild(errorMsg);
                    }, 3000);
                });
        } else {
            // Para otros tipos de archivo, usar método tradicional con proxy
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            a.className = 'drive-download-link-hidden';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                if (a.parentNode) document.body.removeChild(a);
            }, 100);
        }
    }
    
    shareFile(shareUrl, fileName, platform) {
        const encodedUrl = encodeURIComponent(shareUrl);
        const encodedText = encodeURIComponent(`Mira esto: ${fileName}`);
        
        switch(platform) {
            case 'whatsapp':
                // WhatsApp Web/App
                window.open(`https://wa.me/?text=${encodedText}%20${encodedUrl}`, '_blank');
                break;
            case 'telegram':
                // Telegram Web/App
                window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, '_blank');
                break;
            case 'native':
                // Web Share API (nativo del dispositivo)
                if (navigator.share) {
                    navigator.share({
                        title: fileName,
                        text: `Mira esto: ${fileName}`,
                        url: shareUrl
                    }).catch(err => {
                        console.log('Error compartiendo:', err);
                        // Fallback: copiar al portapapeles
                        this.copyToClipboard(shareUrl);
                    });
                } else {
                    // Fallback: copiar al portapapeles
                    this.copyToClipboard(shareUrl);
                }
                break;
        }
    }
    
    async shareMediaFile(mediaUrl, fileName, platform, mediaType, fileId = null, apiId = null) {
        // Mostrar indicador de carga
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'drive-download-loading';
        loadingMsg.textContent = 'Preparando archivo para compartir...';
        document.body.appendChild(loadingMsg);
        
        try {
            // Descargar el archivo como blob usando el proxy del backend
            const response = await fetch(mediaUrl, {
                method: 'GET',
                headers: {
                    'Accept': mediaType === 'photo' ? 'image/*' : 'video/*'
                },
                credentials: 'same-origin'
            });
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }
            
            const blob = await response.blob();
            
            // Determinar tipo MIME correcto
            let mimeType = blob.type;
            if (!mimeType || mimeType === 'application/octet-stream') {
                const ext = fileName.toLowerCase().split('.').pop();
                if (mediaType === 'photo') {
                    mimeType = {
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'png': 'image/png',
                        'gif': 'image/gif',
                        'webp': 'image/webp',
                        'bmp': 'image/bmp'
                    }[ext] || 'image/jpeg';
                } else {
                    mimeType = {
                        'mp4': 'video/mp4',
                        'avi': 'video/x-msvideo',
                        'mov': 'video/quicktime',
                        'wmv': 'video/x-ms-wmv',
                        'flv': 'video/x-flv',
                        'webm': 'video/webm',
                        'mkv': 'video/x-matroska'
                    }[ext] || 'video/mp4';
                }
            }
            
            // Crear File object con el tipo MIME correcto
            const file = new File([blob], fileName, { type: mimeType });
            
            // Ocultar loading
            if (loadingMsg.parentNode) document.body.removeChild(loadingMsg);
            
            // Intentar usar Web Share API con el archivo real
            if (navigator.share && navigator.canShare) {
                try {
                    // Verificar si podemos compartir archivos
                    if (navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            title: fileName,
                            text: fileName,
                            files: [file]
                        });
                        return; // Éxito, salir
                    }
                } catch (shareError) {
                    console.log('Error compartiendo con Web Share API:', shareError);
                    // Continuar con métodos específicos de plataforma
                }
            }
            
            // Si Web Share API no está disponible o falló, usar métodos específicos
            if (platform === 'whatsapp') {
                // Para WhatsApp, intentar compartir el archivo directamente
                if (navigator.share && navigator.canShare) {
                    try {
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: fileName
                            });
                            return;
                        }
                    } catch (e) {
                        console.log('Error compartiendo a WhatsApp:', e);
                    }
                }
                // Fallback: abrir WhatsApp Web (pero esto compartirá el link, no el archivo)
                // Mejor mostrar mensaje al usuario
                alert('Por favor, usa la opción de compartir nativa de tu dispositivo para compartir el archivo en WhatsApp.');
            } else if (platform === 'telegram') {
                // Para Telegram, intentar compartir el archivo directamente
                if (navigator.share && navigator.canShare) {
                    try {
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: fileName
                            });
                            return;
                        }
                    } catch (e) {
                        console.log('Error compartiendo a Telegram:', e);
                    }
                }
                // Fallback: mostrar mensaje
                alert('Por favor, usa la opción de compartir nativa de tu dispositivo para compartir el archivo en Telegram.');
            } else {
                // Para compartir nativo, usar Web Share API
                if (navigator.share) {
                    try {
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: fileName
                            });
                            return;
                        }
                    } catch (e) {
                        console.log('Error compartiendo:', e);
                    }
                }
                alert('La función de compartir no está disponible en este navegador.');
            }
            
        } catch (error) {
            console.error('Error compartiendo archivo:', error);
            if (loadingMsg.parentNode) document.body.removeChild(loadingMsg);
            
            // Mostrar mensaje de error
            const errorMsg = document.createElement('div');
            errorMsg.className = 'drive-download-loading drive-download-error';
            errorMsg.textContent = 'Error al preparar el archivo. Intenta nuevamente.';
            document.body.appendChild(errorMsg);
            setTimeout(() => {
                if (errorMsg.parentNode) document.body.removeChild(errorMsg);
            }, 3000);
        }
    }
    
    copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                alert('Enlace copiado al portapapeles');
            }).catch(err => {
                console.error('Error copiando:', err);
            });
        } else {
            // Fallback para navegadores antiguos
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.className = 'drive-clipboard-textarea-hidden';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                alert('Enlace copiado al portapapeles');
            } catch (err) {
                console.error('Error copiando:', err);
            }
            document.body.removeChild(textarea);
        }
    }
    
    openViewer(type, apiId, currentIndex) {
        const gallery = this.galleries[apiId];
        if (!gallery) return;
        
        const items = type === 'photo' ? gallery.photos : gallery.videos;
        if (!items || items.length === 0) return;
        
        // Crear o reutilizar el visor
        let viewer = document.getElementById('drive-media-viewer');
        if (!viewer) {
            viewer = this.createViewer();
            document.body.appendChild(viewer);
        }
        
        // Guardar información del visor
        this.currentViewer = {
            type: type,
            apiId: apiId,
            currentIndex: currentIndex,
            items: items
        };
        
        // Mostrar el visor
        viewer.classList.add('viewer-open');
        document.body.classList.add('viewer-body-overflow-hidden');
        // Pequeño delay para asegurar que el DOM esté listo
        setTimeout(() => {
            this.showViewerItem(currentIndex);
        }, 10);
    }
    
    createViewer() {
        const viewer = document.createElement('div');
        viewer.id = 'drive-media-viewer';
        viewer.className = 'drive-media-viewer';
        viewer.innerHTML = `
            <div class="viewer-overlay"></div>
            <button class="viewer-close" aria-label="Cerrar visor">
                <i class="fas fa-times"></i>
            </button>
            <button class="viewer-nav viewer-nav-prev" aria-label="Anterior">
                <i class="fas fa-chevron-left"></i>
            </button>
            <button class="viewer-nav viewer-nav-next" aria-label="Siguiente">
                <i class="fas fa-chevron-right"></i>
            </button>
            <div class="viewer-content">
                <div class="viewer-media-container">
                    <img class="viewer-image" alt="">
                    <video class="viewer-video" controls></video>
                </div>
                <div class="viewer-info">
                    <span class="viewer-counter"></span>
                    <span class="viewer-name"></span>
                </div>
            </div>
        `;
        
        // Event listeners
        viewer.querySelector('.viewer-overlay').addEventListener('click', () => this.closeViewer());
        viewer.querySelector('.viewer-close').addEventListener('click', () => this.closeViewer());
        viewer.querySelector('.viewer-nav-prev').addEventListener('click', () => this.navigateViewer(-1));
        viewer.querySelector('.viewer-nav-next').addEventListener('click', () => this.navigateViewer(1));
        
        // Navegación con teclado
        const keyboardHandler = (e) => {
            if (viewer.classList.contains('viewer-open')) {
                if (e.key === 'Escape') {
                    this.closeViewer();
                } else if (e.key === 'ArrowLeft') {
                    this.navigateViewer(-1);
                } else if (e.key === 'ArrowRight') {
                    this.navigateViewer(1);
                }
            }
        };
        document.addEventListener('keydown', keyboardHandler);
        
        // Soporte para gestos táctiles (swipe) en móviles
        let touchStartX = 0;
        let touchEndX = 0;
        
        viewer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        viewer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
        
        const handleSwipe = () => {
            const swipeThreshold = 50;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > swipeThreshold) {
                if (diff > 0) {
                    // Swipe izquierda - siguiente
                    this.navigateViewer(1);
                } else {
                    // Swipe derecha - anterior
                    this.navigateViewer(-1);
                }
            }
        };
        
        return viewer;
    }
    
    showViewerItem(index) {
        if (!this.currentViewer) return;
        
        const { type, items, apiId } = this.currentViewer;
        if (index < 0 || index >= items.length) return;
        
        this.currentViewer.currentIndex = index;
        const item = items[index];
        const viewer = document.getElementById('drive-media-viewer');
        
        const imageEl = viewer.querySelector('.viewer-image');
        const videoEl = viewer.querySelector('.viewer-video');
        const counterEl = viewer.querySelector('.viewer-counter');
        const nameEl = viewer.querySelector('.viewer-name');
        const prevBtn = viewer.querySelector('.viewer-nav-prev');
        const nextBtn = viewer.querySelector('.viewer-nav-next');
        const mediaContainer = viewer.querySelector('.viewer-media-container');
        
        // Mostrar indicador de carga
        if (mediaContainer) {
            mediaContainer.classList.add('loading');
        }
        
        // Ocultar ambos medios primero
        imageEl.classList.remove('viewer-active');
        videoEl.classList.remove('viewer-active');
        imageEl.classList.add('viewer-hidden');
        videoEl.classList.add('viewer-hidden');
        
        if (type === 'photo') {
            // Usar proxy del backend para evitar problemas de CORS/CSP
            const proxyUrl = `/tienda/drive/proxy?file_id=${item.id}&api_id=${apiId}&type=image`;
            
            // Limpiar eventos anteriores y mensajes de error
            imageEl.onload = null;
            imageEl.onerror = null;
            const existingError = mediaContainer?.querySelector('.viewer-error');
            if (existingError) existingError.remove();
            
            // Función para ocultar loading
            const hideLoading = () => {
                if (mediaContainer) {
                    mediaContainer.classList.remove('loading');
                }
            };
            
            // Función para mostrar error
            const showError = (message) => {
                hideLoading();
                if (mediaContainer) {
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'viewer-error';
                    errorMsg.textContent = message;
                    errorMsg.style.cssText = 'color: #fff; padding: 20px; text-align: center; font-size: 1.1rem;';
                    mediaContainer.appendChild(errorMsg);
                }
            };
            
            // Detectar si es móvil para optimizar carga
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            // Preload para mejor compatibilidad móvil
            imageEl.loading = isMobile ? 'eager' : 'lazy';
            imageEl.decoding = 'async';
            
            // Cargar imagen desde el proxy con timestamp para evitar cache en desarrollo
            const cacheBuster = isMobile ? `&t=${Date.now()}` : '';
            imageEl.src = proxyUrl + cacheBuster;
            imageEl.alt = item.name || '';
            imageEl.classList.add('viewer-active');
            imageEl.classList.remove('viewer-hidden');
            
            // Timeout para móviles con conexión lenta
            let loadTimeout;
            if (isMobile) {
                loadTimeout = setTimeout(() => {
                    if (!imageEl.complete) {
                        console.warn('Imagen tardando en cargar, verificando...');
                    }
                }, 10000);
            }
            
            // Cuando la imagen carga exitosamente
            imageEl.onload = () => {
                if (loadTimeout) clearTimeout(loadTimeout);
                hideLoading();
                // Forzar repaint en algunos navegadores móviles
                imageEl.classList.add('viewer-image-fade-in');
            };
            
            // Si falla, intentar con URL directa de Drive como fallback
            imageEl.onerror = function() {
                if (loadTimeout) clearTimeout(loadTimeout);
                this.onerror = null; // Evitar loop infinito
                console.warn('Proxy falló, intentando URL directa de Drive');
                
                // Intentar con URL directa de Drive
                const fallbackUrl = `https://drive.google.com/uc?export=view&id=${item.id}`;
                this.src = fallbackUrl;
                
                // Si también falla, mostrar error
                this.onerror = () => {
                    showError('No se pudo cargar la imagen. Verifica tu conexión.');
                };
            };
        } else {
            // Para videos, usar proxy del backend con mejor compatibilidad móvil
            const proxyUrl = `/tienda/drive/proxy?file_id=${item.id}&api_id=${apiId}&type=video`;
            
            // Limpiar video anterior y mensajes de error
            videoEl.pause();
            videoEl.src = '';
            videoEl.load();
            videoEl.onerror = null;
            videoEl.onloadeddata = null;
            videoEl.oncanplay = null;
            videoEl.onloadedmetadata = null;
            const existingError = mediaContainer?.querySelector('.viewer-error');
            if (existingError) existingError.remove();
            
            // Función para ocultar loading
            const hideLoading = () => {
                if (mediaContainer) {
                    mediaContainer.classList.remove('loading');
                }
            };
            
            // Función para mostrar error
            const showError = (message) => {
                hideLoading();
                if (mediaContainer) {
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'viewer-error viewer-error-message';
                    errorMsg.textContent = message;
                    mediaContainer.appendChild(errorMsg);
                }
            };
            
            // Detectar si es móvil
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            // Configuraciones para mejor compatibilidad móvil
            videoEl.preload = isMobile ? 'metadata' : 'auto';
            videoEl.playsInline = true; // Importante para iOS
            videoEl.controls = true;
            videoEl.muted = false;
            
            // Cargar nuevo video desde el proxy
            videoEl.src = proxyUrl;
            videoEl.classList.add('viewer-active');
            videoEl.classList.remove('viewer-hidden');
            
            // Timeout para móviles
            let loadTimeout;
            if (isMobile) {
                loadTimeout = setTimeout(() => {
                    if (videoEl.readyState < 2) {
                        console.warn('Video tardando en cargar, verificando...');
                    }
                }, 15000);
            }
            
            // Múltiples eventos para mejor compatibilidad
            const handleVideoLoad = () => {
                if (loadTimeout) clearTimeout(loadTimeout);
                hideLoading();
            };
            
            videoEl.onloadedmetadata = handleVideoLoad;
            videoEl.onloadeddata = handleVideoLoad;
            videoEl.oncanplay = handleVideoLoad;
            videoEl.oncanplaythrough = handleVideoLoad;
            
            // Manejar errores de carga de video
            videoEl.onerror = function() {
                if (loadTimeout) clearTimeout(loadTimeout);
                const error = this.error;
                console.error('Error cargando video desde proxy:', item.name, error);
                
                // Limpiar eventos para evitar loops
                this.onerror = null;
                this.onloadeddata = null;
                this.oncanplay = null;
                
                // Intentar con URL directa de Drive como fallback
                console.warn('Proxy falló, intentando URL directa de Drive');
                const fallbackUrl = `https://drive.google.com/uc?export=download&id=${item.id}`;
                this.src = fallbackUrl;
                this.load();
                
                // Si también falla, mostrar error
                this.onerror = () => {
                    showError('No se pudo cargar el video. Verifica tu conexión.');
                };
            };
            
            // Forzar carga del video
            try {
                videoEl.load();
            } catch (e) {
                console.error('Error al cargar video:', e);
                showError('Error al iniciar la carga del video');
            }
        }
        
        // Actualizar información
        counterEl.textContent = `${index + 1} de ${items.length}`;
        nameEl.textContent = item.name || '';
        
        // Habilitar/deshabilitar botones de navegación
        prevBtn.disabled = index === 0;
        nextBtn.disabled = index === items.length - 1;
    }
    
    navigateViewer(direction) {
        if (!this.currentViewer) return;
        const newIndex = this.currentViewer.currentIndex + direction;
        this.showViewerItem(newIndex);
    }
    
    closeViewer() {
        const viewer = document.getElementById('drive-media-viewer');
        if (viewer) {
            viewer.classList.remove('viewer-open');
            document.body.classList.remove('viewer-body-overflow-hidden');
            
            // Pausar video si está reproduciendo
            const videoEl = viewer.querySelector('.viewer-video');
            if (videoEl) {
                videoEl.pause();
                videoEl.src = '';
                videoEl.classList.remove('viewer-active');
            }
            
            // Ocultar imagen
            const imageEl = viewer.querySelector('.viewer-image');
            if (imageEl) {
                imageEl.classList.remove('viewer-active');
                imageEl.classList.add('viewer-hidden');
            }
            
            this.currentViewer = null;
        }
    }
}

// ==================== INICIALIZACIÓN ====================

// Inicializar galería cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    // Solo inicializar si estamos en una página que tiene elementos de Drive Gallery
    if (document.querySelector('[id^="loadPhotosBtn-"]') || document.querySelector('[id^="loadVideosBtn-"]')) {
        window.driveGallery = new DriveGallery();
    }
});
