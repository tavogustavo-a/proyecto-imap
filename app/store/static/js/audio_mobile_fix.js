// ============================================================================
// AUDIO MOBILE FIX - SOLUCIÓN ESPECÍFICA PARA MÓVILES
// ============================================================================

/**
 * Configuración optimizada para grabación de audio en móviles
 */
const MOBILE_AUDIO_CONFIG = {
    MIME_TYPES_MOBILE: [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/wav'
    ],
    
    // MIME Types para PC (mantener compatibilidad)
    MIME_TYPES_PC: [
        'audio/webm;codecs=opus',  // Mejor para PC
        'audio/webm',              // Fallback
        'audio/mp4',               // iOS también
        'audio/wav',               // Universal
        'audio/ogg'                // Fallback
    ],
    
    AUDIO_CONSTRAINTS: {
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
        }
    },
    
    // Configuración avanzada para PC (mantener funcionalidad original)
    AUDIO_CONSTRAINTS_PC: {
        audio: {
            sampleRate: 44100,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            latency: 0.1,
            // Opciones específicas de Chrome para PC
            googEchoCancellation: true,
            googAutoGainControl: true,
            googNoiseSuppression: true,
            googHighpassFilter: true
        }
    }
};

/**
 * Detectar si es un dispositivo móvil
 */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
}

/**
 * Obtener el mejor MIME Type para el dispositivo actual
 */
function getBestMimeType() {
    const mimeTypes = isMobileDevice() ? 
        MOBILE_AUDIO_CONFIG.MIME_TYPES_MOBILE : 
        MOBILE_AUDIO_CONFIG.MIME_TYPES_PC;
    
    for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
    return 'audio/webm';
}

/**
 * Obtener la mejor configuración de audio para el dispositivo
 */
function getBestAudioConstraints() {
    if (isMobileDevice()) {
        // Para móviles, usar configuración simplificada
        return MOBILE_AUDIO_CONFIG.AUDIO_CONSTRAINTS;
    } else {
        // Para PC, usar configuración avanzada (mantener funcionalidad original)
        return MOBILE_AUDIO_CONFIG.AUDIO_CONSTRAINTS_PC;
    }
}

/**
 * Activar AudioContext en móviles (requerido para iOS)
 */
async function activateAudioContext() {
    if (window.AudioContext || window.webkitAudioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContext();
        
        // Solo intentar activar si ya está en estado 'running'
        // No forzar la activación automática
        if (audioContext.state === 'running') {
            return audioContext;
        }
        
        // Si está suspendido, no intentar activar automáticamente
        // Se activará cuando el usuario interactúe con el micrófono
        return audioContext;
    }
    return null;
}

/**
 * Grabación de audio optimizada para navegadores web (PC y móviles)
 * Basado en: MDN MediaRecorder, Chrome Developers, prácticas conocidas
 */
async function startMobileAudioRecording() {
    try {
        if (!window.isSecureContext) {
            const url = window.location.origin;
            showError('Micrófono bloqueado: esta página no usa HTTPS. Para activarlo en móvil: Chrome → chrome://flags → busca "Insecure origins" → agrega ' + url + ' → reinicia.');
            throw new Error('Contexto no seguro');
        }
        const audioConstraints = getBestAudioConstraints();
        
        if (window.audioContext && window.audioContext.state === 'suspended') {
            try {
                await window.audioContext.resume();
            } catch (e) {
                const AC = window.AudioContext || window.webkitAudioContext;
                window.audioContext = new AC();
            }
        }
        
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        } catch (e) {
            if (e.name === 'OverconstrainedError' && isMobileDevice()) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } else {
                throw e;
            }
        }
        
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) {
            stream.getTracks().forEach(t => t.stop());
            showError('No se detectó micrófono. Verifica permisos en ajustes del navegador.');
            throw new Error('Sin pista de audio');
        }
        audioTracks[0].enabled = true;
        
        let mimeType = getBestMimeType();
        let options = { audioBitsPerSecond: 128000 };
        
        if (MediaRecorder.isTypeSupported(mimeType)) {
            options.mimeType = mimeType;
        } else {
            delete options.mimeType;
        }

        let mediaRecorder;
        try {
            mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            mediaRecorder = new MediaRecorder(stream);
        }
        
        const audioChunks = [];
        const recordingStartTime = Date.now();
        mimeType = options.mimeType || mediaRecorder.mimeType || 'audio/webm';

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const chunks = [...audioChunks];
            const durationMs = Date.now() - recordingStartTime;
            stream.getTracks().forEach(track => track.stop());
            
            const processChunks = () => {
                const validChunks = chunks.filter(c => c && c.size > 0);
                if (validChunks.length === 0) {
                    showError('No se capturó audio. Graba al menos 1 segundo e intenta de nuevo.');
                    return;
                }
                if (durationMs < 800 && isMobileDevice()) {
                    showError('Graba al menos 1 segundo.');
                    return;
                }
                const audioBlob = new Blob(validChunks, { type: mimeType });
                if (audioBlob.size < 50) {
                    showError('Audio muy corto. Graba al menos 1 segundo.');
                    return;
                }
                processRecordedAudio(audioBlob);
            };
            
            if (isMobileDevice()) {
                setTimeout(processChunks, 500);
            } else {
                processChunks();
            }
        };
        
        mediaRecorder.onerror = (e) => {
            stream.getTracks().forEach(track => track.stop());
            showError('Error de grabación: ' + (e.error?.message || 'Desconocido'));
        };
        
        if (isMobileDevice()) {
            mediaRecorder.start(250);
        } else {
            mediaRecorder.start(1000);
        }
        
        return { mediaRecorder, stream, mimeType, recordingStartTime };
        
    } catch (error) {
        handleAudioError(error);
        throw error;
    }
}

/**
 * Manejar errores específicos de audio en móviles
 */
function handleAudioError(error) {
    let message = 'Error al acceder al micrófono: ';
    
    switch (error.name) {
        case 'NotAllowedError':
            message += 'Permiso denegado. Por favor, permite el acceso al micrófono y recarga la página.';
            break;
        case 'NotFoundError':
            message += 'No se encontró micrófono. Verifica que tu dispositivo tenga uno.';
            break;
        case 'NotSupportedError':
            message += 'Tu navegador no soporta grabación de audio.';
            break;
        case 'NotReadableError':
            message += 'El micrófono está siendo usado por otra aplicación.';
            break;
        case 'OverconstrainedError':
            message += 'Configuración de audio no compatible. Intenta con otro navegador.';
            break;
        default:
            message += error.message || 'Error desconocido.';
    }
    
    showError(message);
}

/**
 * Procesar audio grabado - en móvil evita verificación con Audio que falla en Chrome
 */
function processRecordedAudio(audioBlob) {
    if (audioBlob.size < 100) {
        showError('Audio muy corto. Intenta grabar por más tiempo.');
        return;
    }
    
    const showPreview = () => {
        const tempMessageId = 'temp_audio_' + Date.now();
        if (typeof window.showAudioPreviewModal === 'function') {
            const input = document.getElementById('chatInputField') || document.getElementById('chatInputFieldUser');
            if (input) input.value = '';
            window.showAudioPreviewModal(audioBlob, tempMessageId);
            const chatArea = document.querySelector('#chatMessagesArea') || document.querySelector('#chatMessagesAreaUser');
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        } else {
            sendAudioMessage(audioBlob);
        }
    };
    
    if (isMobileDevice()) {
        showPreview();
        return;
    }
    
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio();
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    
    const onMetadataLoaded = () => {
        const duration = audio.duration;
        URL.revokeObjectURL(audioUrl);
        if (!duration || !isFinite(duration)) {
            showError('Audio inválido. Intenta grabar de nuevo.');
            return;
        }
        if (duration < 1) {
            showError('El audio debe ser de al menos 1 segundo.');
            return;
        }
        showPreview();
    };
    
    audio.addEventListener('loadedmetadata', onMetadataLoaded);
    audio.addEventListener('error', () => {
        URL.revokeObjectURL(audioUrl);
        showPreview();
    });
    
    audio.src = audioUrl;
    audio.load();
}

/**
 * Mostrar error al usuario
 */
function showError(message) {
    // Crear notificación de error
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #dc3545;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        z-index: 10000;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remover después de 5 segundos
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

/**
 * Función de envío de audio (compatible con el sistema existente)
 */
function sendAudioMessage(audioBlob, tempMessageId = null) {
    const ext = (audioBlob.type && audioBlob.type.includes('mp4')) ? 'mp4' :
        (audioBlob.type && audioBlob.type.includes('ogg')) ? 'ogg' : 'webm';
    const filename = `audio_${Date.now()}.${ext}`;
    const audioFile = new File([audioBlob], filename, { type: audioBlob.type || 'audio/webm' });
    
    if (typeof window.sendAudioMessage === 'function') {
        return window.sendAudioMessage(audioFile, tempMessageId);
    }
    
    const formData = new FormData();
    formData.append('audio', audioFile, filename);
    formData.append('recipient_id', (typeof window.getCurrentChatUserId === 'function' && window.getCurrentChatUserId()) || 
        window.dashboardCurrentUserId || '1');
    formData.append('message_type', 'audio');
    
    const csrfMeta = document.querySelector('meta[name="csrf_token"]');
    const headers = {};
    const csrfToken = csrfMeta ? (csrfMeta.content || csrfMeta.getAttribute('content')) : '';
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;
    
    return fetch('/tienda/api/chat/send_audio', {
        method: 'POST',
        headers: headers,
        body: formData
    }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.status === 'success') return true;
        showError(data.message || 'Error al enviar audio');
        return false;
    }).catch(() => {
        showError('Error al enviar audio. Verifica tu conexión.');
        return false;
    });
}

/**
 * Mejorar la función de grabación existente para móviles (enfoque conservador)
 */
function enhanceExistingAudioRecording() {
    // Solo mejorar si es un dispositivo móvil
    if (!isMobileDevice()) {
        return; // No hacer nada en PC
    }
    
    
    // Guardar la función original si existe
    const originalStartAudioRecording = window.startAudioRecording;
    
    if (originalStartAudioRecording) {
        
        // Crear una función mejorada SOLO para móviles
        window.startAudioRecording = async function() {
            try {
                // Para móviles, usar la configuración optimizada
                return await startMobileAudioRecording();
            } catch (error) {
                // Si falla la optimizada, usar la original como fallback
                try {
                    return await originalStartAudioRecording();
                } catch (originalError) {
                    throw originalError;
                }
            }
        };
    }
}

/**
 * Estado de grabación por botón (para toggle: tap iniciar, tap detener)
 */
const mobileRecordingState = new Map(); // buttonId -> { mediaRecorder, stream, mimeType }

/**
 * Interceptar eventos de clic en botones de audio para móviles
 * Toggle: primer tap = iniciar grabación, segundo tap = detener y enviar
 */
function interceptAudioButtons() {
    if (!isMobileDevice()) {
        return;
    }
    
    const interceptButton = (buttonId) => {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        button.replaceWith(button.cloneNode(true));
        const newButton = document.getElementById(buttonId);
        
        newButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const state = mobileRecordingState.get(buttonId);
            
            if (state && state.mediaRecorder && state.mediaRecorder.state === 'recording') {
                try {
                    state.mediaRecorder.requestData();
                    state.mediaRecorder.stop();
                    mobileRecordingState.delete(buttonId);
                    newButton.innerHTML = '<i class="fas fa-microphone"></i>';
                    newButton.style.background = '';
                    newButton.title = 'Toca para grabar audio';
                } catch (err) {
                    mobileRecordingState.delete(buttonId);
                    handleAudioError(err);
                }
            } else {
                // Primer tap: iniciar grabación
                try {
                    const result = await startMobileAudioRecording();
                    mobileRecordingState.set(buttonId, result);
                    newButton.innerHTML = '<i class="fas fa-stop"></i>';
                    newButton.style.background = '#dc3545';
                    newButton.title = 'Toca de nuevo para detener y enviar';
                } catch (error) {
                    handleAudioError(error);
                }
            }
        }, { passive: false });
    };
    
    interceptButton('audioRecordBtn');
    const userButton = document.getElementById('audioRecordBtnUser');
    if (userButton) interceptButton('audioRecordBtnUser');
}

/**
 * Interceptar botones de audio con reintentos
 */
function interceptAudioButtonsWithRetry() {
    if (!isMobileDevice()) {
        return;
    }
    
    let attempts = 0;
    const maxAttempts = 20;
    
    const tryIntercept = () => {
        attempts++;
        const audioRecordBtn = document.getElementById('audioRecordBtn');
        const audioRecordBtnUser = document.getElementById('audioRecordBtnUser');
        if (audioRecordBtn || audioRecordBtnUser) {
            interceptAudioButtons();
        } else if (attempts < maxAttempts) {
            setTimeout(tryIntercept, 500);
        }
    };
    
    tryIntercept();
}

/**
 * Inicializar funcionalidad de audio móvil
 * El permiso de micrófono se solicita al presionar el botón de grabar por primera vez
 */
function initializeMobileAudio() {
    if (!isMobileDevice()) {
        return;
    }
    interceptAudioButtonsWithRetry();
    
    // Esperar a que la función startAudioRecording esté disponible
    const waitForAudioFunction = () => {
        if (typeof window.startAudioRecording === 'function') {
            enhanceExistingAudioRecording();
        } else {
            setTimeout(waitForAudioFunction, 100);
        }
    };
    
    // Iniciar la espera
    waitForAudioFunction();
    
    // Agregar listener para activar AudioContext en el primer toque
    let audioContextActivated = false;
    const activateOnFirstTouch = async () => {
        if (!audioContextActivated) {
            // Solo crear el AudioContext, no intentar activarlo automáticamente
            if (window.AudioContext || window.webkitAudioContext) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                window.audioContext = new AudioContext();
            }
            audioContextActivated = true;
            document.removeEventListener('touchstart', activateOnFirstTouch);
            document.removeEventListener('click', activateOnFirstTouch);
        }
    };
    
    document.addEventListener('touchstart', activateOnFirstTouch, { passive: true });
    document.addEventListener('click', activateOnFirstTouch, { passive: true });
}

// Auto-inicializar cuando se carga el DOM
document.addEventListener('DOMContentLoaded', initializeMobileAudio);

// También intentar inicializar después de un delay adicional
setTimeout(initializeMobileAudio, 1000);

// Intentar inicializar cuando la ventana esté completamente cargada
window.addEventListener('load', initializeMobileAudio);

// Intentar inicializar cada 2 segundos hasta que funcione (máximo 10 intentos)
let initAttempts = 0;
const maxAttempts = 10;
const initInterval = setInterval(() => {
    initAttempts++;
    if (initAttempts >= maxAttempts) {
        clearInterval(initInterval);
        return;
    }
    
    if (isMobileDevice() && typeof window.startAudioRecording === 'function') {
        enhanceExistingAudioRecording();
        clearInterval(initInterval);
    }
}, 2000);

// Exportar funciones para uso global
window.MobileAudioFix = {
    startMobileAudioRecording,
    isMobileDevice,
    getBestMimeType,
    getBestAudioConstraints,
    activateAudioContext
};
