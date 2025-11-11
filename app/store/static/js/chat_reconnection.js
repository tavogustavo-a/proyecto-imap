// ============================================================================
// CHAT RECONNECTION & MESSAGE SYNC - SISTEMA ROBUSTO DE RECONEXIÓN
// ============================================================================

/**
 * Sistema avanzado de reconexión y sincronización de mensajes
 * Maneja desconexiones, reconexiones y sincronización de mensajes perdidos
 */

class ChatReconnectionManager {
    constructor() {
        this.isReconnecting = false;
        this.lastMessageId = null;
        this.lastSyncTime = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // 1 segundo inicial
        this.maxReconnectDelay = 30000; // 30 segundos máximo
        this.offlineMessages = [];
        this.isOnline = navigator.onLine;
        this.syncInProgress = false;
        
        // ✅ NUEVO: Detectar tipo de usuario y estrategia de reconexión
        this.userType = this.detectUserType();
        this.connectionQuality = 'good'; // good, poor, critical
        this.lastConnectionCheck = Date.now();
        this.connectionFailures = 0;
        this.maxConnectionFailures = 3;
        
        // ✅ NUEVO: Sistema de sincronización entre múltiples conexiones mejorado
        this.connectionId = this.generateConnectionId();
        this.broadcastChannel = null;
        this.crossTabSync = true;
        this.processedMessages = new Set();
        this.activeConnections = new Map(); // Mapear conexiones activas
        this.messageQueue = []; // Cola de mensajes para sincronización
        
        // ✅ NUEVO: Sistema de throttling optimizado para mejor rendimiento
        this.messageThrottling = false;
        this.throttleTimeout = null;
        this.pendingMessages = [];
        this.maxMessagesPerSecond = 20; // Aumentar límite para mejor rendimiento
        this.messageCount = 0;
        this.lastResetTime = Date.now();
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupErrorListeners();
        this.setupCrossTabSync();
        this.startHeartbeat();
        this.startOfflineDetection();
        this.startConnectionQualityMonitoring();
        this.restorePendingMessages();
    }
    
    /**
     * ✅ NUEVO: Detectar tipo de usuario para estrategia de reconexión
     */
    detectUserType() {
        // Verificar si es admin/soporte
        const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
        const isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';
        const currentUserId = document.querySelector('meta[name="current-user-id"]')?.content;
        
        // Verificar por URL también
        const isAdminChat = window.location.pathname.includes('/admin/support') || 
                           window.location.pathname.includes('/tienda/admin');
        const isUserChat = window.location.pathname.includes('/chat_soporte') && !isAdminChat;
        
        if (isSupportUser || isAdminUser || isAdminChat) {
            return 'admin';
        } else if (isUserChat) {
            return 'user';
        } else {
            return 'unknown';
        }
    }
    
    /**
     * ✅ NUEVO: Monitorear calidad de conexión
     */
    startConnectionQualityMonitoring() {
        setInterval(() => {
            this.checkConnectionQuality();
        }, 5000); // Cada 5 segundos
    }
    
    /**
     * ✅ MEJORADO: Verificar calidad de conexión con detección de errores específicos
     */
    checkConnectionQuality() {
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastConnectionCheck;
        
        // Verificar si el socket está conectado
        const socketConnected = window.socket && window.socket.connected;
        const networkOnline = navigator.onLine;
        
        // ✅ NUEVO: Detectar errores específicos de conexión
        const hasConnectionError = this.detectConnectionErrors();
        
        if (!socketConnected || !networkOnline || hasConnectionError) {
            this.connectionFailures++;
            this.lastConnectionCheck = now;
            
            // ✅ NUEVO: Ajustar umbral según tipo de error
            const failureThreshold = hasConnectionError ? 2 : this.maxConnectionFailures;
            
            if (this.connectionFailures >= failureThreshold) {
                this.connectionQuality = 'critical';
            } else {
                this.connectionQuality = 'poor';
            }
        } else {
            // Conexión estable, resetear contadores
            this.connectionFailures = 0;
            this.connectionQuality = 'good';
            this.lastConnectionCheck = now;
        }
        
    }
    
    /**
     * ✅ MEJORADO: Detectar errores específicos de conexión
     */
    detectConnectionErrors() {
        // Verificar si hay errores de conexión en la consola
        if (window.connectionErrorCount && window.connectionErrorCount > 0) {
            return true;
        }
        
        // Verificar si el socket tiene errores
        if (window.socket && window.socket.io && window.socket.io.engine) {
            const engine = window.socket.io.engine;
            if (engine.transport && engine.transport.name === 'polling') {
                // Verificar si hay problemas con polling
                return engine.readyState !== 'open';
            }
        }
        
        // Verificar si hay errores de red recientes
        if (window.lastNetworkError && Date.now() - window.lastNetworkError < 10000) {
            return true;
        }
        
        // ✅ NUEVO: Verificar errores específicos de ConnectionResetError
        if (window.connectionResetError && Date.now() - window.connectionResetError < 15000) {
            return true;
        }
        
        // ✅ NUEVO: Verificar si hay problemas de timeout
        if (window.connectionTimeout && Date.now() - window.connectionTimeout < 10000) {
            return true;
        }
        
    return false;
}

    /**
     * ✅ NUEVO: Generar ID único de conexión
     */
    generateConnectionId() {
        return 'conn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * ✅ NUEVO: Configurar sincronización entre pestañas
     */
    setupCrossTabSync() {
    try {
        // Usar BroadcastChannel para comunicación entre pestañas
        if (typeof BroadcastChannel !== 'undefined') {
            this.broadcastChannel = new BroadcastChannel('chat_sync_' + this.getUserIdentifier());
            this.broadcastChannel.onmessage = (event) => {
                this.handleCrossTabMessage(event.data);
            };
        } else {
            // Fallback a localStorage para navegadores sin BroadcastChannel
            this.setupLocalStorageSync();
        }
        
        // Registrar esta conexión
        this.registerConnection();
        
        // Limpiar conexiones inactivas periódicamente (optimizado)
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, 60000); // Cada 60 segundos para mejor rendimiento
        
    } catch (error) {
    }
};

    /**
     * ✅ NUEVO: Obtener identificador único del usuario
     */
    getUserIdentifier() {
        const userId = document.querySelector('meta[name="current-user-id"]')?.content;
        const username = document.querySelector('meta[name="current-username"]')?.content;
        return userId || username || 'anonymous';
    }
    
    /**
     * ✅ NUEVO: Configurar sincronización por localStorage (optimizado)
     */
    setupLocalStorageSync() {
        // Polling de localStorage para sincronización (reducido para mejor rendimiento)
        setInterval(() => {
            this.checkLocalStorageMessages();
        }, 2000); // Cada 2 segundos para mejor rendimiento
    }
    
    /**
     * ✅ NUEVO: Verificar mensajes de localStorage
     */
    checkLocalStorageMessages() {
        try {
            const key = 'chat_sync_' + this.getUserIdentifier();
            const messages = localStorage.getItem(key);
            if (messages) {
                const messageData = JSON.parse(messages);
                if (messageData.connectionId !== this.connectionId) {
                    this.handleCrossTabMessage(messageData);
                }
            }
        } catch (error) {
        }
    }
    
    /**
     * ✅ NUEVO: Manejar mensajes de otras pestañas
     */
    handleCrossTabMessage(data) {
        if (data.connectionId === this.connectionId) {
            return; // Ignorar mensajes propios
        }
        
        // Evitar procesar mensajes duplicados
        const messageKey = data.type + '_' + data.timestamp + '_' + data.connectionId;
        if (this.processedMessages.has(messageKey)) {
            return;
        }
        this.processedMessages.add(messageKey);
        
        
        switch (data.type) {
            case 'message_sent':
                this.handleMessageFromOtherTab(data);
                break;
            case 'connection_status':
                this.handleConnectionStatusFromOtherTab(data);
                break;
            case 'typing_status':
                this.handleTypingStatusFromOtherTab(data);
                break;
            case 'reconnection':
                this.handleReconnectionFromOtherTab(data);
                break;
        }
    }
    
    /**
     * ✅ NUEVO: Manejar mensaje enviado desde otra pestaña
     */
    handleMessageFromOtherTab(data) {
        // Si otra pestaña envió un mensaje, no duplicarlo
        
        // Actualizar estado de conexión si es necesario
        if (data.connectionStatus) {
            this.updateConnectionStatus(data.connectionStatus);
        }
    }
    
    /**
     * ✅ NUEVO: Manejar estado de conexión de otra pestaña
     */
    handleConnectionStatusFromOtherTab(data) {
        // Sincronizar estado de conexión entre pestañas
        if (data.isConnected && !this.isSocketConnected()) {
            this.syncWithOtherTabs();
        }
    }
    
    /**
     * ✅ NUEVO: Manejar estado de escritura de otra pestaña
     */
    handleTypingStatusFromOtherTab(data) {
        // Sincronizar estado de escritura entre pestañas
        if (typeof window.updateTypingStatus === 'function') {
            window.updateTypingStatus(data.typing, data.userId);
        }
    }
    
    /**
     * ✅ NUEVO: Manejar reconexión de otra pestaña
     */
    handleReconnectionFromOtherTab(data) {
        // Si otra pestaña se reconectó exitosamente, sincronizar
        if (data.success) {
            this.syncWithOtherTabs();
        }
    }
    
    /**
     * ✅ NUEVO: Enviar mensaje a otras pestañas con throttling
     */
    broadcastToOtherTabs(type, data) {
        const message = {
            type: type,
            connectionId: this.connectionId,
            timestamp: Date.now(),
            userType: this.userType,
            ...data
        };
        
        // ✅ NUEVO: Verificar throttling optimizado
        if (!this.canSendMessage()) {
            this.pendingMessages.push(message);
            return;
        }
        
        // Incrementar contador de mensajes
        this.incrementMessageCount();
        
        try {
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage(message);
            } else {
                // Fallback a localStorage
                const key = 'chat_sync_' + this.getUserIdentifier();
                localStorage.setItem(key, JSON.stringify(message));
                // Limpiar después de un tiempo
                setTimeout(() => {
                    localStorage.removeItem(key);
                }, 5000);
            }
        } catch (error) {
            
            // Si falla, agregar a cola de pendientes
            this.pendingMessages.push(message);
        }
    }
    
    /**
     * ✅ NUEVO: Registrar conexión
     */
    registerConnection() {
        const connectionInfo = {
            id: this.connectionId,
            timestamp: Date.now(),
            userType: this.userType,
            isActive: true
        };
        
        this.activeConnections.set(this.connectionId, connectionInfo);
        
        // Notificar a otras pestañas sobre esta nueva conexión
        this.broadcastToOtherTabs('connection_registered', {
            connectionId: this.connectionId,
            userType: this.userType
        });
        
    }
    
    /**
     * ✅ NUEVO: Limpiar conexiones inactivas
     */
    cleanupInactiveConnections() {
        const now = Date.now();
        const timeout = 60000; // 1 minuto
        
        for (const [connectionId, info] of this.activeConnections) {
            if (now - info.timestamp > timeout) {
                this.activeConnections.delete(connectionId);
            }
        }
    }
    
    /**
     * ✅ NUEVO: Sincronizar con otras pestañas
     */
    syncWithOtherTabs() {
        // Sincronizar estado con otras pestañas activas
        this.broadcastToOtherTabs('sync_request', {
            connectionStatus: this.isSocketConnected(),
            lastMessageId: this.lastMessageId,
            offlineMessages: this.offlineMessages.length
        });
    }
    
    /**
     * ✅ NUEVO: Verificar si el socket está conectado
     */
    isSocketConnected() {
        return window.socket && window.socket.connected;
    }
    
    /**
     * ✅ NUEVO: Actualizar estado de conexión
     */
    updateConnectionStatus(status) {
        // Actualizar estado de conexión y notificar a otras pestañas
        this.broadcastToOtherTabs('connection_status', {
            isConnected: status,
            connectionId: this.connectionId,
            timestamp: Date.now()
        });
    }
    
    /**
     * ✅ NUEVO: Obtener número de conexiones activas
     */
    getActiveConnectionsCount() {
        return this.activeConnections.size;
    }
    
    /**
     * ✅ NUEVO: Mostrar estado de conexiones
     */
    showConnectionStatus() {
        const count = this.getActiveConnectionsCount();
        if (count > 1) {
            
            // Mostrar indicador visual si hay múltiples conexiones
            if (document.body) {
                const indicator = document.createElement('div');
                indicator.className = 'multi-connection-indicator';
                indicator.innerHTML = `
                    <div class="indicator-content">
                        <i class="fas fa-mobile-alt"></i>
                        <span>${count} pestañas activas</span>
                    </div>
                `;
                
                try {
                    document.body.appendChild(indicator);
                    
                    // Remover después de 3 segundos
                    setTimeout(() => {
                        if (indicator.parentNode) {
                            indicator.parentNode.removeChild(indicator);
                        }
                    }, 3000);
                } catch (error) {
                }
            }
        }
    }
    
    /**
     * ✅ NUEVO: Habilitar throttling de mensajes
     */
    enableThrottling() {
        this.messageThrottling = true;
        
        // Deshabilitar throttling después de 30 segundos
        if (this.throttleTimeout) {
            clearTimeout(this.throttleTimeout);
        }
        this.throttleTimeout = setTimeout(() => {
            this.disableThrottling();
        }, 30000);
    }
    
    /**
     * ✅ NUEVO: Deshabilitar throttling de mensajes
     */
    disableThrottling() {
        this.messageThrottling = false;
        
        // Procesar mensajes pendientes
        this.processPendingMessages();
    }
    
    /**
     * ✅ NUEVO: Procesar mensajes pendientes
     */
    processPendingMessages() {
        if (this.pendingMessages.length > 0) {
            
            // Procesar en lotes para evitar sobrecarga
            const batchSize = 5;
            const batches = [];
            for (let i = 0; i < this.pendingMessages.length; i += batchSize) {
                batches.push(this.pendingMessages.slice(i, i + batchSize));
            }
            
            batches.forEach((batch, index) => {
                setTimeout(() => {
                    batch.forEach(message => {
                        this.broadcastToOtherTabs(message.type, message.data);
                    });
                }, index * 100); // 100ms entre lotes
            });
            
            this.pendingMessages = [];
        }
    }
    
    /**
     * ✅ NUEVO: Verificar si se puede enviar mensaje (optimizado)
     */
    canSendMessage() {
        if (!this.messageThrottling) {
            return true;
        }
        
        const now = Date.now();
        
        // Resetear contador cada segundo
        if (now - this.lastResetTime >= 1000) {
            this.messageCount = 0;
            this.lastResetTime = now;
        }
        
        // Verificar límite de mensajes por segundo
        return this.messageCount < this.maxMessagesPerSecond;
    }
    
    /**
     * ✅ NUEVO: Incrementar contador de mensajes
     */
    incrementMessageCount() {
        this.messageCount++;
    }
    
    /**
     * ✅ NUEVO: Configurar listeners para errores específicos
     */
    setupErrorListeners() {
        // Interceptar errores de conexión
        const originalConsoleError = console.error;
        console.error = (...args) => {
            const errorMessage = args.join(' ');
            
            // Detectar errores específicos
            if (errorMessage.includes('ConnectionResetError') || 
                errorMessage.includes('WinError 10054') ||
                errorMessage.includes('forzado la interrupción') ||
                errorMessage.includes('Se ha forzado la interrupción')) {
                window.connectionResetError = Date.now();
                
                // ✅ NUEVO: Estrategia más robusta para ConnectionResetError
                if (window.ChatReconnectionManager) {
                    // Reducir la frecuencia de mensajes temporalmente
                    window.ChatReconnectionManager.enableThrottling();
                    
                    // Intentar reconexión con backoff exponencial
                    setTimeout(() => {
                        window.ChatReconnectionManager.forceReconnection();
                    }, 2000); // Aumentar delay para dar tiempo al servidor
                }
            }
            
            if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
                window.connectionTimeout = Date.now();
            }
            
            if (errorMessage.includes('socket') || errorMessage.includes('connection')) {
                window.connectionErrorCount = (window.connectionErrorCount || 0) + 1;
                window.lastNetworkError = Date.now();
            }
            
            // Llamar al console.error original
            originalConsoleError.apply(console, args);
        };
    }
    
    /**
     * Configurar event listeners para reconexión
     */
    setupEventListeners() {
        // Detectar cambios en el estado de conexión
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.handleReconnection();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.handleDisconnection();
        });
        
        // Detectar cuando la página se vuelve visible
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkConnectionStatus();
                if (this.isOnline) {
                    this.checkForMissedMessages();
                }
            }
        });
        
        // Detectar cuando la página se enfoca
        window.addEventListener('focus', () => {
            this.checkConnectionStatus();
            if (this.isOnline) {
                this.checkForMissedMessages();
            }
        });
        
        // Agregar botón de reconexión manual cuando el DOM esté listo
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.addReconnectionButton();
            });
        } else {
            this.addReconnectionButton();
        }
    }
    
    /**
     * Iniciar heartbeat para detectar desconexiones
     */
    startHeartbeat() {
        setInterval(() => {
            if (this.isOnline && window.socket && window.socket.connected) {
                // Verificar que el socket esté realmente conectado
                this.verifyConnection();
            }
        }, 10000); // Cada 10 segundos
    }
    
    /**
     * Iniciar detección de estado offline
     */
    startOfflineDetection() {
        setInterval(() => {
            if (navigator.onLine !== this.isOnline) {
                this.isOnline = navigator.onLine;
                if (this.isOnline) {
                    this.handleReconnection();
                } else {
                    this.handleDisconnection();
                }
            }
        }, 5000); // Cada 5 segundos
    }
    
    /**
     * Verificar conexión real del socket
     */
    async verifyConnection() {
        try {
            if (window.socket && window.socket.connected) {
                // Enviar ping para verificar conexión
                window.socket.emit('ping');
                
                // Si no hay respuesta en 5 segundos, considerar desconectado
                setTimeout(() => {
                    if (window.socket && !window.socket.connected) {
                        this.handleDisconnection();
                    }
                }, 5000);
            }
        } catch (error) {
            this.handleDisconnection();
        }
    }
    
    /**
     * ✅ MEJORADO: Manejar reconexión con estrategias específicas por tipo de usuario
     */
    async handleReconnection() {
        if (this.isReconnecting) {
            return;
        }
        
        this.isReconnecting = true;
        this.reconnectAttempts = 0;
        
        this.showReconnectingIndicator();
        
        try {
            // ✅ NUEVO: Estrategia diferente según tipo de usuario
            if (this.userType === 'user') {
                await this.handleUserChatReconnection();
            } else if (this.userType === 'admin') {
                await this.handleAdminChatReconnection();
            } else {
                await this.handleGenericReconnection();
            }
            
            this.hideConnectionIndicators();
            
            // Ocultar botón de reconexión
            if (this.hideReconnectionButton) {
                this.hideReconnectionButton();
            }
            
        } catch (error) {
            this.scheduleReconnect();
        } finally {
            this.isReconnecting = false;
        }
    }
    
    /**
     * ✅ MEJORADO: Reconexión para chat de usuarios normales (solo reconexión del socket, sin recargar página)
     */
    async handleUserChatReconnection() {
        // ✅ MEJORADO: Siempre intentar reconexión del socket sin recargar la página
        // Socket.IO maneja la reconexión automáticamente, solo necesitamos asegurarnos de que esté conectado
        
        // Intentar reconexión estándar (solo socket, no recarga de página)
        await this.performStandardReconnection();
        
        // Si después de varios intentos aún no se conecta, mostrar opción manual de recarga
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showManualReloadOption();
        }
    }
    
    /**
     * ✅ NUEVO: Guardar mensajes pendientes antes de recargar
     */
    savePendingMessages() {
        try {
            const pendingMessages = [];
            
            // Buscar mensajes temporales en el chat
            const tempMessages = document.querySelectorAll('[data-message-id^="temp_"]');
            tempMessages.forEach(msg => {
                const messageText = msg.querySelector('.message-text');
                if (messageText) {
                    pendingMessages.push({
                        type: 'text',
                        content: messageText.textContent.trim(),
                        timestamp: new Date()
                    });
                }
            });
            
            // Guardar en localStorage
            if (pendingMessages.length > 0) {
                localStorage.setItem('chat_pending_messages', JSON.stringify(pendingMessages));
            }
        } catch (error) {
        }
    }
    
    /**
     * ✅ NUEVO: Restaurar mensajes pendientes después de recarga
     */
    restorePendingMessages() {
        try {
            const savedMessages = localStorage.getItem('chat_pending_messages');
            if (savedMessages) {
                const pendingMessages = JSON.parse(savedMessages);
                
                // Agregar mensajes a la cola offline
                pendingMessages.forEach(msg => {
                    this.addOfflineMessage(msg);
                });
                
                // Limpiar mensajes guardados
                localStorage.removeItem('chat_pending_messages');
                
                // Mostrar notificación
                this.showPendingMessagesRestored(pendingMessages.length);
            }
        } catch (error) {
        }
    }
    
    /**
     * ✅ NUEVO: Mostrar notificación de mensajes restaurados
     */
    showPendingMessagesRestored(count) {
        if (!document.body) return;
        
        const notification = document.createElement('div');
        notification.className = 'pending-messages-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-sync-alt"></i>
                <span>${count} mensaje(s) pendiente(s) restaurado(s)</span>
            </div>
        `;
        
        try {
            document.body.appendChild(notification);
            
            // Remover después de 3 segundos
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 3000);
        } catch (error) {
        }
    }
    
    /**
     * ✅ NUEVO: Reconexión para chat admin (mantener estado)
     */
    async handleAdminChatReconnection() {
        
        // Para admin, siempre intentar reconexión sin recargar
        await this.performStandardReconnection();
        
        // Si falla múltiples veces, mostrar opción de recarga manual
        if (this.reconnectAttempts >= 5) {
            this.showManualReloadOption();
        }
    }
    
    /**
     * ✅ NUEVO: Reconexión genérica
     */
    async handleGenericReconnection() {
        await this.performStandardReconnection();
    }
    
    /**
     * ✅ MEJORADO: Realizar reconexión estándar (solo socket, sin recargar página)
     */
    async performStandardReconnection() {
        // ✅ MEJORADO: Intentar usar el socket existente primero
        if (window.socket) {
            // Si el socket existe pero no está conectado, intentar reconectar
            if (!window.socket.connected) {
                try {
                    window.socket.connect();
                } catch (error) {
                    // Si falla, crear uno nuevo
                    await this.createNewSocket();
                }
            } else {
                // Ya está conectado, solo sincronizar mensajes
                await this.syncMissedMessages();
                await this.resendOfflineMessages();
                return;
            }
        } else {
            // Si no existe socket, intentar inicializarlo usando la función del chat
            if (typeof initializeSocketIO === 'function') {
                // ✅ MEJORADO: Inicializar socket y esperar a que se conecte
                initializeSocketIO();
                // Esperar a que el socket se inicialice y conecte
                await this.waitForSocketInitialization();
            } else {
                // Fallback: crear uno nuevo
                await this.createNewSocket();
            }
        }
        
        // Esperar a que se conecte
        await this.waitForConnection();
        
        // Sincronizar mensajes perdidos
        await this.syncMissedMessages();
        
        // Reenviar mensajes offline
        await this.resendOfflineMessages();
    }
    
    /**
     * ✅ MEJORADO: Crear nuevo socket si no existe y reestablecer event listeners
     */
    async createNewSocket() {
        return new Promise((resolve, reject) => {
            try {
                // Detectar si es móvil
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const baseUrl = isMobile ? 
                    `${window.location.protocol}//${window.location.hostname}:5002` : 
                    'http://127.0.0.1:5002';
                
                // Crear nuevo socket
                window.socket = io(baseUrl, {
                    transports: ['polling'],
                    timeout: 30000,
                    forceNew: true,
                    reconnection: true,
                    reconnectionDelay: 3000,
                    reconnectionAttempts: 5,
                    maxReconnectionAttempts: 5,
                    upgrade: false,
                    rememberUpgrade: false,
                    autoConnect: true
                });
                
                // ✅ NUEVO: Reestablecer event listeners del chat si están disponibles
                if (typeof setupSocketIOEventListeners === 'function') {
                    setupSocketIOEventListeners();
                }
                
                // ✅ NUEVO: Reestablecer función join_chat si está disponible
                if (typeof joinChatRoom === 'function') {
                    window.socket.on('connect', () => {
                        joinChatRoom();
                        resolve();
                    });
                } else {
                    window.socket.on('connect', () => {
                        resolve();
                    });
                }
                
                window.socket.on('connect_error', (error) => {
                    reject(error);
                });
                
                // Timeout después de 10 segundos
                setTimeout(() => {
                    reject(new Error('Timeout creando socket'));
                }, 10000);
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Manejar desconexión
     */
    handleDisconnection() {
        this.isOnline = false;
        
        // Mostrar indicador de desconexión
        this.showDisconnectionIndicator();
        
        // Mostrar botón de reconexión
        if (this.showReconnectionButton) {
            this.showReconnectionButton();
        }
    }
    
    /**
     * Esperar a que se establezca la conexión
     */
    waitForConnection(timeout = 15000) {
        return new Promise((resolve, reject) => {
            if (window.socket && window.socket.connected) {
                resolve();
                return;
            }
            
            const startTime = Date.now();
            let checkCount = 0;
            
            const checkConnection = () => {
                checkCount++;
                
                if (window.socket && window.socket.connected) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Timeout esperando conexión'));
                } else {
                    setTimeout(checkConnection, 500); // Verificar cada 500ms
                }
            };
            
            checkConnection();
        });
    }
    
    /**
     * ✅ NUEVO: Esperar a que el socket se inicialice y conecte
     */
    waitForSocketInitialization(timeout = 15000) {
        return new Promise((resolve, reject) => {
            // Verificar si el socket ya existe y está conectado
            if (window.socket && window.socket.connected) {
                resolve();
                return;
            }
            
            // Esperar a que se cree el socket
            let socketCheckCount = 0;
            const checkSocket = () => {
                socketCheckCount++;
                
                if (window.socket) {
                    // Socket creado, ahora esperar conexión
                    if (window.socket.connected) {
                        resolve();
                    } else {
                        // Esperar evento de conexión
                        const connectHandler = () => {
                            window.socket.off('connect', connectHandler);
                            resolve();
                        };
                        window.socket.on('connect', connectHandler);
                        
                        // Timeout
                        setTimeout(() => {
                            window.socket.off('connect', connectHandler);
                            reject(new Error('Timeout esperando conexión del socket'));
                        }, timeout);
                    }
                } else if (socketCheckCount > 20) {
                    // Después de 10 segundos de esperar, rechazar
                    reject(new Error('Timeout esperando inicialización del socket'));
                } else {
                    // Continuar verificando
                    setTimeout(checkSocket, 500);
                }
            };
            
            checkSocket();
        });
    }
    
    /**
     * Sincronizar mensajes perdidos
     */
    async syncMissedMessages() {
        if (this.syncInProgress) {
            return;
        }
        
        this.syncInProgress = true;
        
        try {
            
            // Obtener último mensaje local
            const lastMessage = this.getLastLocalMessage();
            const lastMessageId = lastMessage ? lastMessage.id : null;
            
            // Sincronizar con el servidor
            const missedMessages = await this.fetchMissedMessages(lastMessageId);
            
            if (missedMessages && missedMessages.length > 0) {
                
                // Agregar mensajes perdidos al chat
                this.addMissedMessagesToChat(missedMessages);
                
                // Actualizar último mensaje
                this.lastMessageId = missedMessages[missedMessages.length - 1].id;
            }
            
            this.lastSyncTime = new Date();
            
        } catch (error) {
        } finally {
            this.syncInProgress = false;
        }
    }
    
    /**
     * Obtener último mensaje local
     */
    getLastLocalMessage() {
        const messages = document.querySelectorAll('[data-message-id]');
        if (messages.length === 0) return null;
        
        const lastMessage = messages[messages.length - 1];
        const messageId = lastMessage.getAttribute('data-message-id');
        
        return {
            id: messageId,
            timestamp: lastMessage.getAttribute('data-timestamp')
        };
    }
    
    /**
     * Obtener mensajes perdidos del servidor
     */
    async fetchMissedMessages(lastMessageId) {
        try {
            const url = lastMessageId ? 
                `/tienda/api/chat/sync_messages?since=${lastMessageId}` :
                `/tienda/api/chat/sync_messages`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                return data.data || [];
            }
            
            return [];
            
        } catch (error) {
            return [];
        }
    }
    
    /**
     * Agregar mensajes perdidos al chat
     */
    addMissedMessagesToChat(messages) {
        messages.forEach(message => {
            // Verificar si el mensaje ya existe
            const existingMessage = document.querySelector(`[data-message-id="${message.id}"]`);
            if (existingMessage) {
                return; // Ya existe, no agregar
            }
            
            // Agregar mensaje al chat
            if (typeof addMessageToChat === 'function') {
                addMessageToChat(message, true);
            } else if (typeof addUserMessage === 'function') {
                addUserMessage(message);
            }
        });
        
        // Scroll al final
        const chatArea = document.querySelector('#chatMessagesArea, #chatMessagesAreaUser');
        if (chatArea) {
            chatArea.scrollTop = chatArea.scrollHeight;
        }
    }
    
    /**
     * Reenviar mensajes offline
     */
    async resendOfflineMessages() {
        if (this.offlineMessages.length === 0) {
            return;
        }
        
        
        const messagesToResend = [...this.offlineMessages];
        this.offlineMessages = [];
        
        for (const message of messagesToResend) {
            try {
                await this.resendMessage(message);
            } catch (error) {
                // Volver a agregar a la cola si falla
                this.offlineMessages.push(message);
            }
        }
    }
    
    /**
     * Reenviar un mensaje específico
     */
    async resendMessage(message) {
        if (message.type === 'text') {
            if (typeof sendMessage === 'function') {
                await sendMessage(message.content);
            }
        } else if (message.type === 'audio') {
            if (typeof sendAudioMessage === 'function') {
                await sendAudioMessage(message.blob);
            }
        }
        // Agregar más tipos de mensaje según sea necesario
    }
    
    /**
     * Programar reconexión
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showReconnectionFailed();
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
        
        
        // Actualizar indicador con contador
        this.updateReconnectingIndicator(this.reconnectAttempts, delay);
        
        setTimeout(() => {
            this.handleReconnection();
        }, delay);
    }
    
    /**
     * Actualizar indicador de reconexión con contador
     */
    updateReconnectingIndicator(attempt, delay) {
        const indicator = document.querySelector('.connection-indicator');
        if (indicator) {
            const seconds = Math.ceil(delay / 1000);
            indicator.innerHTML = `
                <div class="connection-status">
                    <i class="fas fa-sync-alt"></i>
                </div>
            `;
        }
    }
    
    /**
     * Verificar mensajes perdidos
     */
    async checkForMissedMessages() {
        if (!this.isOnline || this.syncInProgress) {
            return;
        }
        
        try {
            await this.syncMissedMessages();
        } catch (error) {
        }
    }
    
    /**
     * Mostrar indicador de desconexión
     */
    showDisconnectionIndicator() {
        // Verificar que el DOM esté listo
        if (!document.body) {
            return;
        }
        
        // Remover indicador existente
        const existingIndicator = document.querySelector('.connection-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Crear nuevo indicador
        const indicator = document.createElement('div');
        indicator.className = 'connection-indicator offline';
        indicator.innerHTML = `
            <div class="connection-status">
                <i class="fas fa-wifi"></i>
            </div>
        `;
        
        try {
            document.body.appendChild(indicator);
        } catch (error) {
        }
    }
    
    /**
     * Mostrar indicador de reconexión
     */
    showReconnectingIndicator() {
        // Verificar que el DOM esté listo
        if (!document.body) {
            return;
        }
        
        // Remover indicador existente
        const existingIndicator = document.querySelector('.connection-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Crear nuevo indicador
        const indicator = document.createElement('div');
        indicator.className = 'connection-indicator connecting';
        indicator.innerHTML = `
            <div class="connection-status">
                <i class="fas fa-sync-alt"></i>
            </div>
        `;
        
        try {
            document.body.appendChild(indicator);
        } catch (error) {
        }
    }
    
    /**
     * Ocultar todos los indicadores de conexión
     */
    hideConnectionIndicators() {
        const indicators = document.querySelectorAll('.connection-indicator');
        indicators.forEach(indicator => {
            indicator.remove();
        });
    }
    
    /**
     * Mostrar indicador de reconexión fallida
     */
    showReconnectionFailed() {
        const existingIndicator = document.querySelector('.connection-indicator');
        if (existingIndicator) {
            existingIndicator.className = 'connection-indicator failed';
            existingIndicator.innerHTML = `
                <div class="connection-status">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
            `;
        }
    }
    
    /**
     * Obtener token CSRF
     */
    getCsrfToken() {
        const metaTag = document.querySelector('meta[name="csrf_token"]');
        return metaTag ? metaTag.content : '';
    }
    
    /**
     * ✅ MODIFICADO: Mostrar indicador de reconexión (sin recarga de página)
     */
    showReloadIndicator() {
        // ✅ MEJORADO: Mostrar indicador de reconexión, no de recarga
        if (!document.body) {
            return;
        }
        
        const existingIndicator = document.querySelector('.connection-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        const indicator = document.createElement('div');
        indicator.className = 'connection-indicator connecting';
        indicator.innerHTML = `
            <div class="connection-status">
                <i class="fas fa-sync-alt fa-spin"></i>
            </div>
        `;
        
        try {
            document.body.appendChild(indicator);
        } catch (error) {
        }
    }
    
    /**
     * ✅ NUEVO: Mostrar opción de recarga manual para admin
     */
    showManualReloadOption() {
        if (!document.body) {
            return;
        }
        
        const existingIndicator = document.querySelector('.connection-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        const indicator = document.createElement('div');
        indicator.className = 'connection-indicator manual-reload';
        indicator.innerHTML = `
            <div class="connection-status">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
        `;
        
        try {
            document.body.appendChild(indicator);
        } catch (error) {
        }
    }
    
    /**
     * Agregar mensaje a la cola offline
     */
    addOfflineMessage(message) {
        this.offlineMessages.push(message);
    }
    
    /**
     * Limpiar cola offline
     */
    clearOfflineMessages() {
        this.offlineMessages = [];
    }
    
    /**
     * Forzar reconexión manual
     */
    forceReconnection() {
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.handleReconnection();
    }
    
    /**
     * Verificar estado de conexión actual
     */
    checkConnectionStatus() {
        const isOnline = navigator.onLine;
        const socketConnected = window.socket && window.socket.connected;
        
        
        if (!isOnline) {
            this.handleDisconnection();
        } else if (!socketConnected) {
            this.handleReconnection();
        } else {
            this.hideConnectionIndicators();
        }
        
        return { isOnline, socketConnected };
    }
    
    /**
     * Agregar botón de reconexión manual
     */
    addReconnectionButton() {
        // Verificar que el DOM esté listo
        if (!document.body) {
            setTimeout(() => this.addReconnectionButton(), 100);
            return;
        }
        
        // Crear botón de reconexión
        const button = document.createElement('button');
        button.className = 'reconnect-button hidden';
        button.innerHTML = '<i class="fas fa-redo"></i> Reconectar';
        button.onclick = () => this.forceReconnection();
        
        try {
            document.body.appendChild(button);
        } catch (error) {
            return;
        }
        
        // Mostrar botón cuando hay problemas de conexión
        this.showReconnectionButton = () => {
            if (button && button.parentNode) {
                button.classList.remove('hidden');
            }
        };
        
        // Ocultar botón cuando se conecta
        this.hideReconnectionButton = () => {
            if (button && button.parentNode) {
                button.classList.add('hidden');
            }
        };
    }
}

// Inicializar el manager de reconexión de forma segura
let chatReconnectionManager = null;

// Función para inicializar de forma segura
function initializeChatReconnection() {
    try {
        chatReconnectionManager = new ChatReconnectionManager();
    } catch (error) {
        // Crear un manager dummy para evitar errores
        chatReconnectionManager = {
            handleReconnection: () => {},
            handleDisconnection: () => {},
            addOfflineMessage: () => {},
            checkConnectionStatus: () => ({ isOnline: true, socketConnected: true })
        };
    }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeChatReconnection);
} else {
    initializeChatReconnection();
}

// Exportar para uso global
window.ChatReconnectionManager = chatReconnectionManager;
