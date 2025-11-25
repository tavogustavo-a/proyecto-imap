// ============================================================================
// CHAT ENHANCEMENTS - FUNCIONALIDADES MEJORADAS COMPARTIDAS
// ============================================================================

// Verificar si ya se cargó para evitar duplicados
if (window.ChatEnhancementsLoaded) {
    // No hacer nada si ya está cargado
} else {
    // Marcar como cargado
    window.ChatEnhancementsLoaded = true;

// 1. Lazy Loading de Mensajes
// 2. Debouncing para Typing  
// 3. Memoización de Componentes
// 4. Notificaciones Push
// 5. Rate Limiting (45 msg/min)
// 6. Validación de Archivos Mejorada

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const CHAT_ENHANCEMENTS_CONFIG = {
    MESSAGES_PER_PAGE: 50,
    TYPING_DEBOUNCE_DELAY: 300,
    RATE_LIMIT: 45, // mensajes por minuto
    RATE_WINDOW: 60000, // 1 minuto en ms
    MAX_FILE_SIZE: 200 * 1024 * 1024, // 200MB
    ALLOWED_FILE_TYPES: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm', 'video/ogg',
        'audio/mp3', 'audio/wav', 'audio/webm',
        'application/pdf', 'text/plain'
    ]
};

// ============================================================================
// IMPLEMENTACIÓN DE FUNCIONES
// ============================================================================

// ============================================================================
// 1. LAZY LOADING DE MENSAJES
// ============================================================================

let currentPage = 1;
let isLoadingMessages = false;
let hasMoreMessages = true;

/**
 * Cargar más mensajes (lazy loading)
 */
function loadMessages() {
    if (isLoadingMessages || !hasMoreMessages) return;
    
    isLoadingMessages = true;
    
    // Simular carga (aquí iría la llamada real al servidor)
    setTimeout(() => {
        // En una implementación real, aquí harías fetch('/api/chat/messages', { page: currentPage + 1 })
        currentPage++;
        isLoadingMessages = false;
        
        // Si no hay más mensajes, ocultar el botón
        if (currentPage >= 5) { // Simular que solo hay 5 páginas
            hasMoreMessages = false;
            const loadBtn = document.getElementById('loadMoreMessagesBtn');
            if (loadBtn) loadBtn.style.display = 'none';
        }
    }, 1000);
}

/**
 * Configurar lazy loading
 */
function initializeLazyLoading() {
    // Crear botón de cargar más mensajes
    const chatArea = document.querySelector('#chatMessagesArea, #chatMessagesAreaUser');
    if (!chatArea) return;
    
    const loadBtn = document.createElement('button');
    loadBtn.id = 'loadMoreMessagesBtn';
    loadBtn.className = 'load-more-messages-btn';
    loadBtn.textContent = 'Cargar más mensajes';
    loadBtn.addEventListener('click', loadMessages);
    
    // Insertar al inicio del área de mensajes
    chatArea.insertBefore(loadBtn, chatArea.firstChild);
}

// ============================================================================
// 2. DEBOUNCING PARA TYPING
// ============================================================================

// Usar namespace global para evitar conflictos con otros archivos
if (!window.ChatEnhancementsNamespace) {
    window.ChatEnhancementsNamespace = {
        typingTimeout: null,
        isTyping: false
    };
}

/**
 * Debounce para indicador de "escribiendo"
 */
function debounceTyping(callback, delay = CHAT_ENHANCEMENTS_CONFIG.TYPING_DEBOUNCE_DELAY) {
    return function(...args) {
        clearTimeout(window.ChatEnhancementsNamespace.typingTimeout);
        window.ChatEnhancementsNamespace.typingTimeout = setTimeout(() => callback.apply(this, args), delay);
    };
}

/**
 * Configurar debouncing para typing
 */
function setupTypingDebounce() {
    const inputField = document.querySelector('#messageInput, #messageInputUser');
    if (!inputField) return;
    
    const debouncedTyping = debounceTyping(() => {
        if (!window.ChatEnhancementsNamespace.isTyping) {
            window.ChatEnhancementsNamespace.isTyping = true;
            // Emitir evento de typing
            if (window.socket) {
                window.socket.emit('typing_start');
            }
        }
    });
    
    inputField.addEventListener('input', debouncedTyping);
    
    // Detener typing cuando se envía el mensaje
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (window.ChatEnhancementsNamespace.isTyping) {
                window.ChatEnhancementsNamespace.isTyping = false;
                if (window.socket) {
                    window.socket.emit('typing_stop');
                }
            }
        }
    });
}

// ============================================================================
// 3. MEMOIZACIÓN DE COMPONENTES
// ============================================================================

const messageCache = new Map();

/**
 * Renderizar mensaje con memoización
 */
function renderMessage(messageData) {
    const cacheKey = `msg_${messageData.id}`;
    
    // Verificar caché
    if (messageCache.has(cacheKey)) {
        return messageCache.get(cacheKey);
    }
    
    // Crear elemento de mensaje
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageData.sender_id === 'user' ? 'own-message' : 'other-message'}`;
    messageElement.innerHTML = `
        <div class="message-content">
            <p>${messageData.message}</p>
            <span class="message-time">${new Date(messageData.created_at).toLocaleTimeString()}</span>
        </div>
    `;
    
    // Guardar en caché
    messageCache.set(cacheKey, messageElement);
    
    return messageElement;
}

// ============================================================================
// 4. NOTIFICACIONES PUSH
// ============================================================================

/**
 * Solicitar permiso para notificaciones
 */
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        return false;
    }
    
    if (Notification.permission === 'granted') {
        return true;
    }
    
    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }
    
    return false;
}

/**
 * Mostrar notificación
 */
function showNotification(title, body, icon = null) {
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: icon || '/static/images/chat-icon.png',
            badge: '/static/images/badge-icon.png',
            tag: 'chat-message',
            requireInteraction: false,
            silent: false
        });
        
        // Cerrar automáticamente después de 5 segundos
        setTimeout(() => {
            notification.close();
        }, 5000);
        
        return notification;
    }
}

/**
 * Configurar notificaciones
 */
function initializeNotifications() {
    // Mostrar banner de permiso si es necesario
    if (Notification.permission === 'default') {
        const banner = document.createElement('div');
        banner.className = 'notification-permission-banner';
        banner.innerHTML = `
            <p>¿Permitir notificaciones para recibir mensajes nuevos?</p>
            <button class="request-notification-permission-btn" data-action="request-notification-permission">Permitir</button>
        `;
        document.body.appendChild(banner);
    }
}

// ============================================================================
// 5. RATE LIMITING (45 MENSAJES POR MINUTO)
// ============================================================================

const messageTimestamps = [];

/**
 * Verificar rate limit
 */
function checkRateLimit() {
    const now = Date.now();
    const oneMinuteAgo = now - CHAT_ENHANCEMENTS_CONFIG.RATE_WINDOW;
    
    // Filtrar mensajes del último minuto
    const recentMessages = messageTimestamps.filter(timestamp => timestamp > oneMinuteAgo);
    
    if (recentMessages.length >= CHAT_ENHANCEMENTS_CONFIG.RATE_LIMIT) {
        const timeUntilReset = Math.ceil((recentMessages[0] + CHAT_ENHANCEMENTS_CONFIG.RATE_WINDOW - now) / 1000);
        
        // Mostrar advertencia
        const warning = document.createElement('div');
        warning.className = 'rate-limit-warning';
        warning.innerHTML = `
            <h4>⚠️ Límite de mensajes alcanzado</h4>
            <p>Has enviado ${CHAT_ENHANCEMENTS_CONFIG.RATE_LIMIT} mensajes en el último minuto. 
            Espera ${timeUntilReset} segundos antes de enviar otro mensaje.</p>
        `;
        
        document.body.appendChild(warning);
        
        // Remover advertencia después de 5 segundos
        setTimeout(() => {
            if (warning.parentNode) {
                warning.parentNode.removeChild(warning);
            }
        }, 5000);
        
        return false;
    }
    
    // Agregar timestamp del mensaje actual
    messageTimestamps.push(now);
    return true;
}

/**
 * Configurar rate limiting
 */
function setupRateLimiting() {
    const sendButton = document.querySelector('#sendButton, #sendButtonUser');
    const inputField = document.querySelector('#messageInput, #messageInputUser');
    
    if (sendButton && inputField) {
        sendButton.addEventListener('click', (e) => {
            if (!checkRateLimit()) {
                e.preventDefault();
                return false;
            }
        });
        
        inputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !checkRateLimit()) {
                e.preventDefault();
                return false;
            }
        });
    }
}

// ============================================================================
// 6. VALIDACIÓN DE ARCHIVOS MEJORADA
// ============================================================================

/**
 * Validar archivo individual
 */
function validateFile(file) {
    const errors = [];
    
    // Verificar tamaño
    if (file.size > CHAT_ENHANCEMENTS_CONFIG.MAX_FILE_SIZE) {
        errors.push(`El archivo es demasiado grande. Máximo: ${Math.round(CHAT_ENHANCEMENTS_CONFIG.MAX_FILE_SIZE / 1024 / 1024)}MB`);
    }
    
    // Verificar tipo
    if (!CHAT_ENHANCEMENTS_CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
        errors.push(`Tipo de archivo no permitido: ${file.type}`);
    }
    
    // Verificar nombre
    if (file.name.length > 255) {
        errors.push('El nombre del archivo es demasiado largo');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Validar múltiples archivos
 */
function validateFiles(files) {
    const results = [];
    let allValid = true;
    
    for (let i = 0; i < files.length; i++) {
        const validation = validateFile(files[i]);
        results.push({
            file: files[i],
            ...validation
        });
        
        if (!validation.isValid) {
            allValid = false;
        }
    }
    
    return {
        allValid: allValid,
        results: results
    };
}

/**
 * Configurar validación de archivos
 */
function setupFileValidation() {
    const fileInput = document.querySelector('#fileInput, #fileInputUser');
    if (!fileInput) return;
    
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        const validation = validateFiles(files);
        
        // Remover mensajes de validación anteriores
        const existingErrors = document.querySelectorAll('.file-validation-error, .file-validation-success');
        existingErrors.forEach(error => error.remove());
        
        if (!validation.allValid) {
            // Mostrar errores
            const errorContainer = document.createElement('div');
            errorContainer.className = 'file-validation-error';
            
            const errorMessages = validation.results
                .filter(result => !result.isValid)
                .map(result => `${result.file.name}: ${result.errors.join(', ')}`)
                .join('<br>');
            
            errorContainer.innerHTML = errorMessages;
            fileInput.parentNode.appendChild(errorContainer);
            
            // Limpiar input
            fileInput.value = '';
        } else {
            // Mostrar éxito
            const successContainer = document.createElement('div');
            successContainer.className = 'file-validation-success';
            successContainer.textContent = `${files.length} archivo(s) válido(s) seleccionado(s)`;
            fileInput.parentNode.appendChild(successContainer);
        }
    });
}

// ============================================================================
// INICIALIZACIÓN
// ============================================================================

/**
 * Inicializar todas las funcionalidades
 */
function initializeChatEnhancements() {
    try {
        // 1. Lazy Loading
        // Se configurará cuando se cargue un chat específico
        
        // 2. Debouncing para Typing
        setupTypingDebounce();
        
        // 3. Memoización
        // Se activa automáticamente en renderMessage()
        
        // 4. Notificaciones Push
        requestNotificationPermission();
        
        // 5. Búsqueda de Mensajes - REMOVIDO
        
        // 6. Rate Limiting
        setupRateLimiting();
        
        // 7. Validación de Archivos
        setupFileValidation();
        
    } catch (error) {
    }
}

// ============================================================================
// FUNCIONES PÚBLICAS PARA INTEGRACIÓN
// ============================================================================

// Hacer funciones disponibles globalmente
window.ChatEnhancements = {
    loadMessages,
    debounceTyping,
    renderMessage,
    showNotification,
    checkRateLimit,
    validateFile,
    validateFiles,
    initializeChatEnhancements
};

// ============================================================================
// AUTO-INICIALIZACIÓN
// ============================================================================

// Auto-inicializar cuando se carga el DOM
document.addEventListener('DOMContentLoaded', initializeChatEnhancements);

} // Cerrar el bloque else

// ============================================================================
// EVENT LISTENERS DELEGADOS PARA CSP COMPLIANCE
// ============================================================================

// Event listener delegado para solicitar permisos de notificación (CSP compliant)
document.addEventListener('click', function(e) {
    const target = e.target.closest('[data-action="request-notification-permission"]');
    if (!target) return;
    
    if (typeof requestNotificationPermission === 'function') {
        requestNotificationPermission().then(permission => {
            if (permission) {
                const banner = target.closest('.notification-permission-banner');
                if (banner) {
                    banner.style.display = 'none';
                }
            }
        });
    }
});