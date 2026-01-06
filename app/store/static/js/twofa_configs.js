// app/store/static/js/twofa_configs.js
// Gestión de configuraciones 2FA por correo

(function() {
    'use strict';
    
    // Elementos del DOM
    const twofaForm = document.getElementById('twofa-config-form');
    const twofaConfigsList = document.getElementById('twofa-configs-list');
    const twofaEmailsInput = document.getElementById('twofa-emails-input');
    const twofaConfigId = document.getElementById('twofa-config-id');
    const twofaSecretInput = document.getElementById('twofa-secret-input');
    const twofaQrFile = document.getElementById('twofa-qr-file');
    const twofaSecretDisplay = document.getElementById('twofa-secret-display');
    const twofaSecretDisplayValue = document.getElementById('twofa-secret-display-value');
    const twofaSaveBtn = document.getElementById('twofa-save-btn');
    const twofaCancelBtn = document.getElementById('twofa-cancel-btn');
    const twofaMessage = document.getElementById('twofa-message');
    const twofaUploadQrBtn = document.getElementById('twofa-upload-qr-btn');
    const twofaQrPreview = document.getElementById('twofa-qr-preview');
    
    let currentSecret = null;
    let currentConfigs = [];
    
    // Elementos de búsqueda y paginación
    const searchTwofaInput = document.getElementById('searchTwofaInput');
    const showTwofaCount = document.getElementById('showTwofaCount');
    const prevTwofaPageBtn = document.getElementById('prevTwofaPageBtn');
    const nextTwofaPageBtn = document.getElementById('nextTwofaPageBtn');
    
    let currentTwofaPage = 1;
    let perPage = showTwofaCount ? (parseInt(showTwofaCount.value) || 20) : 20;
    
    // Función para obtener token CSRF
    function getCsrfToken() {
        const metaTag = document.querySelector('meta[name="csrf_token"]');
        return metaTag ? metaTag.getAttribute('content') : '';
    }
    
    // Función para mostrar mensaje
    function showMessage(message, type = 'success') {
        if (!twofaMessage) return;
        twofaMessage.textContent = message;
        twofaMessage.className = `mt-05 text-center text-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'}`;
        setTimeout(() => {
            twofaMessage.textContent = '';
            twofaMessage.className = 'mt-05 text-center';
        }, 5000);
    }
    
    // Función para resetear formulario
    function resetForm() {
        if (twofaEmailsInput) twofaEmailsInput.value = '';
        if (twofaConfigId) twofaConfigId.value = '';
        if (twofaSecretInput) twofaSecretInput.value = '';
        if (twofaQrFile) twofaQrFile.value = '';
        currentSecret = null;
        if (twofaSecretDisplay) twofaSecretDisplay.classList.add('d-none');
        if (twofaSaveBtn) twofaSaveBtn.textContent = 'Agregar';
        if (twofaCancelBtn) twofaCancelBtn.classList.add('d-none');
        if (twofaQrPreview) {
            twofaQrPreview.innerHTML = '';
            twofaQrPreview.classList.add('d-none');
        }
    }
    
    // Manejar click en "Subir QR" - ahora abre el selector de archivo
    if (twofaUploadQrBtn) {
        twofaUploadQrBtn.addEventListener('click', function() {
            if (twofaQrFile) {
                twofaQrFile.click();
            }
        });
    }
    
    // Manejar subida de archivo QR
    if (twofaQrFile) {
        twofaQrFile.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            // Validar que sea una imagen
            if (!file.type.startsWith('image/')) {
                showMessage('Por favor selecciona un archivo de imagen', 'error');
                return;
            }
            
            // Mostrar preview
            const reader = new FileReader();
            reader.onload = function(e) {
                if (twofaQrPreview) {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.alt = 'QR Preview';
                    img.className = 'twofa-qr-preview-img';
                    twofaQrPreview.innerHTML = '';
                    twofaQrPreview.appendChild(img);
                    twofaQrPreview.classList.remove('d-none');
                }
            };
            reader.readAsDataURL(file);
            
            // Leer QR y extraer secreto
            const formData = new FormData();
            formData.append('qr_file', file);
            
            try {
                const response = await fetch('/tienda/admin/twofa-configs/read-qr', {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: formData
                });
                
                const data = await response.json();
                
                if (data.success && data.secret_key) {
                    currentSecret = data.secret_key;
                    // Llenar el campo de código manual con el secreto extraído
                    if (twofaSecretInput) {
                        twofaSecretInput.value = currentSecret;
                    }
                    if (twofaSecretDisplay) {
                        twofaSecretDisplayValue.textContent = currentSecret;
                        twofaSecretDisplay.classList.remove('d-none');
                    }
                    showMessage('QR code leído correctamente', 'success');
                } else {
                    showMessage(data.error || 'Error al leer el código QR', 'error');
                }
            } catch (error) {
                showMessage('Error al procesar el QR: ' + error.message, 'error');
            }
        });
    }
    
    // Manejar entrada manual de secreto
    if (twofaSecretInput) {
        twofaSecretInput.addEventListener('input', function(e) {
            const secret = e.target.value.trim().toUpperCase();
            if (secret && /^[A-Z0-9]{16,}$/.test(secret)) {
                currentSecret = secret;
                if (twofaSecretDisplay) {
                    twofaSecretDisplayValue.textContent = currentSecret;
                    twofaSecretDisplay.classList.remove('d-none');
                }
            } else if (secret.length === 0) {
                currentSecret = null;
                if (twofaSecretDisplay) twofaSecretDisplay.classList.add('d-none');
            }
        });
    }
    
    // Manejar envío del formulario (SOLO PARA CREAR, NO EDITAR)
    if (twofaForm) {
        twofaForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const emails = twofaEmailsInput ? twofaEmailsInput.value.trim() : '';
            
            if (!emails) {
                showMessage('Debes ingresar al menos un correo', 'error');
                return;
            }
            
            // Obtener secreto del campo de código manual o del secreto actual
            const secretFromInput = twofaSecretInput ? twofaSecretInput.value.trim().toUpperCase() : '';
            if (secretFromInput && /^[A-Z0-9]{16,}$/.test(secretFromInput)) {
                currentSecret = secretFromInput;
            }
            
            if (!currentSecret) {
                showMessage('Debes proporcionar un secreto TOTP (ingresa el código manual o sube un QR)', 'error');
                return;
            }
            
            try {
                const response = await fetch('/tienda/admin/twofa-configs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        emails: emails,
                        secret_key: currentSecret
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showMessage(data.message || 'Configuración guardada correctamente', 'success');
                    resetForm();
                    loadConfigs();
                } else {
                    showMessage(data.error || 'Error al guardar la configuración', 'error');
                }
            } catch (error) {
                showMessage('Error al guardar: ' + error.message, 'error');
            }
        });
    }
    
    // Manejar cancelar
    if (twofaCancelBtn) {
        twofaCancelBtn.addEventListener('click', function() {
            resetForm();
        });
    }
    
    // Función para cargar configuraciones
    async function loadConfigs() {
        try {
            const response = await fetch('/tienda/admin/twofa-configs', {
                method: 'GET',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.success && data.configs) {
                currentConfigs = data.configs;
                renderConfigsList(data.configs);
            } else {
                if (twofaConfigsList) {
                    twofaConfigsList.innerHTML = '<p class="text-center text-secondary">No hay configuraciones 2FA.</p>';
                }
            }
        } catch (error) {
            if (twofaConfigsList) {
                twofaConfigsList.innerHTML = '<p class="text-center text-danger">Error al cargar configuraciones.</p>';
            }
        }
    }
    
    // Función para obtener filas filtradas
    function getFilteredConfigs() {
        if (!twofaConfigsList) return [];
        const searchTerm = searchTwofaInput ? searchTwofaInput.value.toLowerCase() : '';
        const configItems = Array.from(twofaConfigsList.querySelectorAll('.regex-item[data-emails]'));
        
        return configItems.filter(item => {
            if (!searchTerm) return true;
            const emails = item.getAttribute('data-emails').toLowerCase();
            return emails.includes(searchTerm);
        });
    }
    
    // Función para renderizar página
    function renderTwofaPage() {
        const filteredConfigs = getFilteredConfigs();
        const totalConfigs = filteredConfigs.length;
        const showCount = showTwofaCount ? showTwofaCount.value : '5';
        const totalPages = showCount === 'all' ? 1 : Math.ceil(totalConfigs / perPage);
        
        let start = showCount === 'all' ? 0 : (currentTwofaPage - 1) * perPage;
        let end = showCount === 'all' ? totalConfigs : start + perPage;
        
        // Ocultar todas las configuraciones
        const allConfigs = Array.from(twofaConfigsList.querySelectorAll('.regex-item[data-emails]'));
        allConfigs.forEach(item => {
            item.style.display = 'none';
        });
        
        // Mostrar solo las configuraciones de la página actual
        filteredConfigs.slice(start, end).forEach(item => {
            item.style.display = '';
        });
        
        // Actualizar estado de botones de paginación
        if (prevTwofaPageBtn) {
            prevTwofaPageBtn.disabled = currentTwofaPage <= 1;
        }
        if (nextTwofaPageBtn) {
            nextTwofaPageBtn.disabled = currentTwofaPage >= totalPages || showCount === 'all';
        }
    }
    
    // Función para filtrar configuraciones
    function filterTwofaConfigs() {
        currentTwofaPage = 1;
        renderTwofaPage();
    }
    
    // Función para renderizar lista de configuraciones
    function renderConfigsList(configs) {
        if (!twofaConfigsList) return;
        
        if (!configs || configs.length === 0) {
            twofaConfigsList.innerHTML = '<p class="text-center text-secondary">No hay configuraciones 2FA. Agrega una nueva configuración arriba.</p>';
            return;
        }
        
        const configsHTML = configs.map(config => {
            const emailsList = config.emails_list || [];
            const emailsDisplay = emailsList.length > 0 ? emailsList.join(', ') : config.emails || '';
            
            return `
                <div class="regex-item d-flex justify-content-between align-items-center p-2" data-emails="${escapeHtml(emailsDisplay.toLowerCase())}">
                    <div class="flex-grow-1">
                        <div class="font-weight-bold">${escapeHtml(emailsDisplay)}</div>
                    </div>
                    <div class="d-flex gap-05 ml-2">
                        <button type="button" class="btn-orange btn-sm edit-twofa-config" data-config-id="${config.id}" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn-red btn-sm delete-twofa-config btn-imap-action btn-imap-small" data-id="${config.id}" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        twofaConfigsList.innerHTML = configsHTML;
        
        // Agregar event listeners para editar y eliminar
        twofaConfigsList.querySelectorAll('.edit-twofa-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = this.getAttribute('data-config-id');
                editConfig(configId);
            });
        });
        
        twofaConfigsList.querySelectorAll('.delete-twofa-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = this.getAttribute('data-id');
                deleteConfig(configId);
            });
        });
        
        // Renderizar página inicial
        renderTwofaPage();
    }
    
    // Función para escapar HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Elementos del modal de edición
    const twofaEditModal = document.getElementById('twofa-edit-modal');
    const twofaEditForm = document.getElementById('twofa-edit-form');
    const editTwofaConfigId = document.getElementById('edit-twofa-config-id');
    const editTwofaEmailsInput = document.getElementById('edit-twofa-emails-input');
    const editTwofaSecretInput = document.getElementById('edit-twofa-secret-input');
    const editTwofaQrFile = document.getElementById('edit-twofa-qr-file');
    const editTwofaQrPreview = document.getElementById('edit-twofa-qr-preview');
    const editTwofaSecretDisplay = document.getElementById('edit-twofa-secret-display');
    const editTwofaSecretDisplayValue = document.getElementById('edit-twofa-secret-display-value');
    const editTwofaUploadQrBtn = document.getElementById('edit-twofa-upload-qr-btn');
    const editTwofaSaveBtn = document.getElementById('edit-twofa-save-btn');
    const editTwofaCancelBtn = document.getElementById('edit-twofa-cancel-btn');
    const editTwofaMessage = document.getElementById('edit-twofa-message');
    const closeEditTwofaModal = document.getElementById('close-edit-twofa-modal');
    
    let currentEditSecret = null;
    
    // Función para mostrar mensaje en el modal
    function showEditMessage(message, type = 'success') {
        if (!editTwofaMessage) return;
        editTwofaMessage.textContent = message;
        editTwofaMessage.className = `mt-05 text-center text-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'}`;
        setTimeout(() => {
            editTwofaMessage.textContent = '';
            editTwofaMessage.className = 'mt-05 text-center';
        }, 5000);
    }
    
    // Función para resetear formulario del modal
    function resetEditForm() {
        if (editTwofaEmailsInput) editTwofaEmailsInput.value = '';
        if (editTwofaConfigId) editTwofaConfigId.value = '';
        if (editTwofaSecretInput) editTwofaSecretInput.value = '';
        if (editTwofaQrFile) editTwofaQrFile.value = '';
        currentEditSecret = null;
        if (editTwofaSecretDisplay) {
            editTwofaSecretDisplay.classList.add('d-none');
            if (editTwofaSecretDisplayValue) editTwofaSecretDisplayValue.textContent = '';
        }
        if (editTwofaQrPreview) {
            editTwofaQrPreview.innerHTML = '';
            editTwofaQrPreview.classList.add('d-none');
        }
    }
    
    // Función para abrir modal de edición
    function openEditModal() {
        if (twofaEditModal) {
            twofaEditModal.classList.remove('d-none');
        }
    }
    
    // Función para cerrar modal de edición
    function closeEditModal() {
        if (twofaEditModal) {
            twofaEditModal.classList.add('d-none');
        }
        resetEditForm();
    }
    
    // Función para editar configuración (abre el modal)
    function editConfig(configId) {
        const config = currentConfigs.find(c => c.id == configId);
        if (!config) {
            showMessage('Configuración no encontrada', 'error');
            return;
        }
        
        // Llenar formulario del modal
        if (editTwofaEmailsInput) {
            const emailsList = config.emails_list || [];
            editTwofaEmailsInput.value = emailsList.length > 0 ? emailsList.join(', ') : config.emails || '';
        }
        if (editTwofaConfigId) editTwofaConfigId.value = config.id;
        currentEditSecret = config.secret_key;
        
        if (editTwofaSecretDisplay && editTwofaSecretDisplayValue) {
            editTwofaSecretDisplayValue.textContent = currentEditSecret;
            editTwofaSecretDisplay.classList.remove('d-none');
        }
        
        if (editTwofaSecretInput) editTwofaSecretInput.value = '';
        
        // Abrir modal
        openEditModal();
    }
    
    // Función para eliminar configuración
    async function deleteConfig(configId) {
        if (!confirm('¿Estás seguro de eliminar esta configuración 2FA?')) {
            return;
        }
        
        try {
            const response = await fetch(`/tienda/admin/twofa-configs/${configId}`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage(data.message || 'Configuración eliminada correctamente', 'success');
                loadConfigs();
            } else {
                showMessage(data.error || 'Error al eliminar la configuración', 'error');
            }
        } catch (error) {
            showMessage('Error al eliminar: ' + error.message, 'error');
        }
    }
    
    // ========== HANDLERS DEL MODAL DE EDICIÓN ==========
    
    // Manejar click en "Subir QR" del modal de edición
    if (editTwofaUploadQrBtn) {
        editTwofaUploadQrBtn.addEventListener('click', function() {
            if (editTwofaQrFile) {
                editTwofaQrFile.click();
            }
        });
    }
    
    // Manejar selección de archivo QR en el modal de edición
    if (editTwofaQrFile) {
        editTwofaQrFile.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            if (!file.type.startsWith('image/')) {
                showEditMessage('El archivo debe ser una imagen', 'error');
                return;
            }
            
            try {
                const formData = new FormData();
                formData.append('qr_file', file);
                
                const response = await fetch('/tienda/admin/twofa-configs/read-qr', {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: formData
                });
                
                const data = await response.json();
                
                if (data.success && data.secret_key) {
                    currentEditSecret = data.secret_key;
                    // Llenar el campo de código manual con el secreto extraído
                    if (editTwofaSecretInput) {
                        editTwofaSecretInput.value = currentEditSecret;
                    }
                    if (editTwofaSecretDisplay && editTwofaSecretDisplayValue) {
                        editTwofaSecretDisplayValue.textContent = currentEditSecret;
                        editTwofaSecretDisplay.classList.remove('d-none');
                    }
                    showEditMessage('QR code leído correctamente', 'success');
                } else {
                    showEditMessage(data.error || 'Error al leer el código QR', 'error');
                }
            } catch (error) {
                showEditMessage('Error al procesar el QR: ' + error.message, 'error');
            }
        });
    }
    
    // Manejar entrada manual de secreto en el modal de edición
    if (editTwofaSecretInput) {
        editTwofaSecretInput.addEventListener('input', function(e) {
            const secret = e.target.value.trim().toUpperCase();
            if (secret && /^[A-Z0-9]{16,}$/.test(secret)) {
                currentEditSecret = secret;
                if (editTwofaSecretDisplay && editTwofaSecretDisplayValue) {
                    editTwofaSecretDisplayValue.textContent = currentEditSecret;
                    editTwofaSecretDisplay.classList.remove('d-none');
                }
            } else if (secret.length === 0) {
                // Si se borra el campo, mantener el secreto actual si existe
                if (!currentEditSecret) {
                    if (editTwofaSecretDisplay) editTwofaSecretDisplay.classList.add('d-none');
                }
            }
        });
    }
    
    // Manejar envío del formulario de edición
    if (twofaEditForm) {
        twofaEditForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const emails = editTwofaEmailsInput ? editTwofaEmailsInput.value.trim() : '';
            const configId = editTwofaConfigId ? editTwofaConfigId.value : '';
            
            if (!emails) {
                showEditMessage('Debes ingresar al menos un correo', 'error');
                return;
            }
            
            if (!configId) {
                showEditMessage('ID de configuración no encontrado', 'error');
                return;
            }
            
            // Obtener secreto del campo de código manual o del secreto actual
            const secretFromInput = editTwofaSecretInput ? editTwofaSecretInput.value.trim().toUpperCase() : '';
            let secretToUse = currentEditSecret; // Por defecto usar el secreto actual
            
            if (secretFromInput && /^[A-Z0-9]{16,}$/.test(secretFromInput)) {
                secretToUse = secretFromInput;
            }
            
            // Si no hay secreto nuevo y no hay secreto actual, error
            if (!secretToUse) {
                showEditMessage('Debes proporcionar un secreto TOTP (ingresa el código manual o sube un QR)', 'error');
                return;
            }
            
            try {
                const response = await fetch(`/tienda/admin/twofa-configs/${configId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        emails: emails,
                        secret_key: secretToUse
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showEditMessage(data.message || 'Configuración actualizada correctamente', 'success');
                    setTimeout(() => {
                        closeEditModal();
                        loadConfigs();
                    }, 1000);
                } else {
                    showEditMessage(data.error || 'Error al actualizar la configuración', 'error');
                }
            } catch (error) {
                showEditMessage('Error al actualizar: ' + error.message, 'error');
            }
        });
    }
    
    // Manejar cerrar modal de edición
    if (closeEditTwofaModal) {
        closeEditTwofaModal.addEventListener('click', function() {
            closeEditModal();
        });
    }
    
    // Manejar cancelar en el modal de edición
    if (editTwofaCancelBtn) {
        editTwofaCancelBtn.addEventListener('click', function() {
            closeEditModal();
        });
    }
    
    // Cerrar modal al hacer click fuera de él
    if (twofaEditModal) {
        twofaEditModal.addEventListener('click', function(e) {
            if (e.target === twofaEditModal) {
                closeEditModal();
            }
        });
    }
    
    // Event listeners para búsqueda y paginación
    if (searchTwofaInput) {
        searchTwofaInput.addEventListener('input', filterTwofaConfigs);
        
        // Manejar el evento de limpiar (cuando se presiona la 'x' nativa)
        searchTwofaInput.addEventListener('search', function() {
            if (this.value === '') {
                filterTwofaConfigs();
            }
        });
    }
    
    if (showTwofaCount) {
        showTwofaCount.addEventListener('change', function() {
            perPage = this.value === 'all' ? 999999 : parseInt(this.value);
            currentTwofaPage = 1;
            renderTwofaPage();
        });
    }
    
    if (prevTwofaPageBtn) {
        prevTwofaPageBtn.addEventListener('click', function() {
            if (currentTwofaPage > 1) {
                currentTwofaPage--;
                renderTwofaPage();
            }
        });
    }
    
    if (nextTwofaPageBtn) {
        nextTwofaPageBtn.addEventListener('click', function() {
            const filteredConfigs = getFilteredConfigs();
            const showCount = showTwofaCount ? showTwofaCount.value : '5';
            const totalPages = showCount === 'all' ? 1 : Math.ceil(filteredConfigs.length / perPage);
            if (currentTwofaPage < totalPages) {
                currentTwofaPage++;
                renderTwofaPage();
            }
        });
    }
    
    // Cargar configuraciones al iniciar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadConfigs);
    } else {
        loadConfigs();
    }
    
})();
