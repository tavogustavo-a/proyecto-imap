/**
 * WhatsApp Manager - JavaScript para configuración de WhatsApp
 * Maneja: configuración, tabla, modal y acciones de WhatsApp
 */

// ==================== CONFIGURACIÓN DE WHATSAPP ====================

document.addEventListener('DOMContentLoaded', function() {
    const whatsappForm = document.getElementById('whatsapp-config-form');
    const testWhatsAppBtn = document.getElementById('test-whatsapp-connection');
    const whatsappStatusDiv = document.getElementById('whatsapp-status');
    
    if (!whatsappForm || !testWhatsAppBtn || !whatsappStatusDiv) {
        console.error('Elementos del formulario WhatsApp no encontrados');
        return;
    }
    
    // Manejar envío del formulario
    whatsappForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = new FormData(whatsappForm);
        
        try {
            showWhatsAppStatus('Guardando configuración...', 'info');
            
            const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
            
            const response = await fetch('/tienda/admin/whatsapp_configs', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showWhatsAppStatus(result.message, 'success');
                whatsappForm.reset();
                loadWhatsAppConfigsTable();
            } else {
                showWhatsAppStatus(result.error || 'Error desconocido', 'error');
            }
            
        } catch (error) {
            console.error('Error:', error);
            showWhatsAppStatus('Error de conexión', 'error');
        }
    });
    
    // Manejar prueba de conexión
    testWhatsAppBtn.addEventListener('click', async function() {
        const apiKey = document.getElementById('whatsapp-api-key').value;
        const phoneNumber = document.getElementById('whatsapp-phone-number').value;
        
        if (!apiKey.trim() || !phoneNumber.trim()) {
            showWhatsAppStatus('Por favor ingresa la API Key y número de teléfono', 'error');
            return;
        }
        
        try {
            showWhatsAppStatus('Probando conexión...', 'info');
            
            const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
            const formData = new FormData();
            formData.append('whatsapp_api_key', apiKey);
            formData.append('whatsapp_phone_number', phoneNumber);
            
            const response = await fetch('/tienda/admin/whatsapp_configs/test', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showWhatsAppStatus(result.message, 'success');
            } else {
                showWhatsAppStatus(result.error || 'Error de conexión', 'error');
            }
            
        } catch (error) {
            console.error('Error:', error);
            showWhatsAppStatus('Error de conexión', 'error');
        }
    });
    
    // Cargar configuraciones existentes al cargar la página
    loadWhatsAppConfigsTable();
    
    // Configurar modal de edición
    setupWhatsAppModal();
    
    // Función para mostrar estado
    function showWhatsAppStatus(message, type) {
        whatsappStatusDiv.innerHTML = `<div class="alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'}">${message}</div>`;
        
        // Auto-ocultar después de 5 segundos para mensajes de éxito
        if (type === 'success') {
            setTimeout(() => {
                whatsappStatusDiv.innerHTML = '';
            }, 5000);
        }
    }
});

// ==================== FUNCIONES GLOBALES PARA WHATSAPP ====================

// Función global para cargar la tabla de configuraciones de WhatsApp
async function loadWhatsAppConfigsTable() {
    try {
        const response = await fetch('/tienda/admin/whatsapp_configs');
        const result = await response.json();
        
        const tableContainer = document.getElementById('whatsapp-configs-table-container');
        
        if (result.configs && result.configs.length > 0) {
            const tableHtml = `
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>Número</th>
                                <th>Hora</th>
                                <th>Estado</th>
                                <th>Último envío</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${result.configs.map(config => `
                                <tr>
                                    <td>${config.phone_number}</td>
                                    <td>${config.notification_time || '--:--'}</td>
                                    <td>
                                        <button class="action-btn ${config.is_enabled ? 'action-red' : 'action-green'}" 
                                                onclick="toggleWhatsAppConfig(${config.id})">
                                            ${config.is_enabled ? 'OFF' : 'ON'}
                                        </button>
                                    </td>
                                    <td>${config.last_sent ? new Date(config.last_sent).toLocaleString() : 'Nunca'}</td>
                                    <td>
                                        <button class="btn-panel btn-blue btn-table-action" onclick="testWhatsAppConnection(${config.id})" title="Probar conexión">
                                            <i class="fas fa-plug"></i>
                                        </button>
                                        <button class="btn-panel btn-orange btn-table-action" onclick="editWhatsAppConfig(${config.id})" title="Editar">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn-panel btn-red btn-table-action" onclick="deleteWhatsAppConfig(${config.id})" title="Eliminar">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            tableContainer.innerHTML = tableHtml;
        } else {
            tableContainer.innerHTML = '<div class="text-center my-3">No hay configuraciones de WhatsApp.</div>';
        }
        
    } catch (error) {
        console.error('Error cargando tabla de WhatsApp:', error);
        document.getElementById('whatsapp-configs-table-container').innerHTML = 
            '<div class="text-danger text-center my-3">Error al cargar las configuraciones.</div>';
    }
}

// Función para alternar ON/OFF de WhatsApp
async function toggleWhatsAppConfig(configId) {
    try {
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const response = await fetch(`/tienda/admin/whatsapp_configs/${configId}/toggle`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showWhatsAppStatus(result.message, 'success');
            loadWhatsAppConfigsTable();
        } else {
            showWhatsAppStatus(result.error || 'Error al cambiar estado', 'error');
        }
        
    } catch (error) {
        console.error('Error:', error);
        showWhatsAppStatus('Error de conexión', 'error');
    }
}

// Función para probar conexión de WhatsApp
async function testWhatsAppConnection(configId) {
    try {
        showWhatsAppStatus('Probando conexión...', 'info');
        
        const response = await fetch(`/tienda/admin/whatsapp_configs`);
        const result = await response.json();
        
        const config = result.configs.find(c => c.id === configId);
        if (!config) {
            showWhatsAppStatus('Configuración no encontrada', 'error');
            return;
        }
        
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const formData = new FormData();
        formData.append('whatsapp_api_key', config.api_key);
        formData.append('whatsapp_phone_number', config.phone_number);
        
        const testResponse = await fetch('/tienda/admin/whatsapp_configs/test', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken
            },
            body: formData
        });
        
        const testResult = await testResponse.json();
        
        if (testResult.success) {
            showWhatsAppStatus(`Conexión exitosa para WhatsApp ${configId}`, 'success');
        } else {
            showWhatsAppStatus(`Error de conexión para WhatsApp ${configId}: ${testResult.error}`, 'error');
        }
        
    } catch (error) {
        console.error('Error:', error);
        showWhatsAppStatus('Error de conexión', 'error');
    }
}

// Función para editar configuración de WhatsApp
async function editWhatsAppConfig(configId) {
    try {
        const response = await fetch(`/tienda/admin/whatsapp_configs`);
        const result = await response.json();
        
        const config = result.configs.find(c => c.id === configId);
        if (!config) {
            showWhatsAppStatus('Configuración no encontrada', 'error');
            return;
        }
        
        // Llenar el modal
        document.getElementById('edit-whatsapp-id').value = config.id;
        document.getElementById('edit-whatsapp-api-key').value = config.api_key || '';
        document.getElementById('edit-whatsapp-phone-number').value = config.phone_number || '';
        document.getElementById('edit-whatsapp-webhook-verify-token').value = config.webhook_verify_token || '';
        document.getElementById('edit-whatsapp-template-message').value = config.template_message || '';
        document.getElementById('edit-whatsapp-notification-time').value = config.notification_time || '';
        document.getElementById('edit-whatsapp-enabled').checked = config.is_enabled;
        
        // Mostrar modal
        document.getElementById('whatsapp-edit-modal').classList.remove('d-none');
        
    } catch (error) {
        console.error('Error:', error);
        showWhatsAppStatus('Error al cargar configuración', 'error');
    }
}

// Función para eliminar configuración de WhatsApp
async function deleteWhatsAppConfig(configId) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta configuración de WhatsApp?')) {
        return;
    }
    
    try {
        const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
        const response = await fetch(`/tienda/admin/whatsapp_configs/${configId}`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': csrfToken
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showWhatsAppStatus(result.message, 'success');
            loadWhatsAppConfigsTable();
        } else {
            showWhatsAppStatus(result.error || 'Error al eliminar', 'error');
        }
        
    } catch (error) {
        console.error('Error:', error);
        showWhatsAppStatus('Error de conexión', 'error');
    }
}

// Función para mostrar estado (específica para WhatsApp)
function showWhatsAppStatus(message, type) {
    const statusDiv = document.getElementById('whatsapp-status');
    if (statusDiv) {
        statusDiv.innerHTML = `<div class="alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'}">${message}</div>`;
        
        // Auto-ocultar después de 5 segundos para mensajes de éxito
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }
    }
}

// Configurar modal de edición de WhatsApp
function setupWhatsAppModal() {
    const modal = document.getElementById('whatsapp-edit-modal');
    const closeBtn = document.getElementById('close-whatsapp-edit-modal');
    const editForm = document.getElementById('whatsapp-edit-form');
    
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
        const configId = data.edit_whatsapp_id;
        
        try {
            showWhatsAppStatus('Actualizando configuración...', 'info');
            
            const csrfToken = document.querySelector('meta[name="csrf_token"]')?.content || '';
            
            const response = await fetch(`/tienda/admin/whatsapp_configs/${configId}`, {
                method: 'PUT',
                headers: {
                    'X-CSRFToken': csrfToken
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showWhatsAppStatus(result.message, 'success');
                modal.classList.add('d-none');
                loadWhatsAppConfigsTable();
            } else {
                showWhatsAppStatus(result.error || 'Error al actualizar', 'error');
            }
            
        } catch (error) {
            console.error('Error:', error);
            showWhatsAppStatus('Error de conexión', 'error');
        }
    });
}
