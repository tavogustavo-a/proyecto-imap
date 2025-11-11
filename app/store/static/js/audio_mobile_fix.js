// ============================================================================
// AUDIO MOBILE FIX - SOLUCIÓN ESPECÍFICA PARA MÓVILES
// ============================================================================

/**
 * Configuración optimizada para grabación de audio en móviles
 */
const MOBILE_AUDIO_CONFIG = {
    // MIME Types priorizados para móviles
    MIME_TYPES_MOBILE: [
        'audio/mp4',           // Mejor soporte en iOS
        'audio/wav',           // Universal
        'audio/webm',          // Android
        'audio/ogg'            // Fallback
    ],
    
    // MIME Types para PC (mantener compatibilidad)
    MIME_TYPES_PC: [
        'audio/webm;codecs=opus',  // Mejor para PC
        'audio/webm',              // Fallback
        'audio/mp4',               // iOS también
        'audio/wav',               // Universal
        'audio/ogg'                // Fallback
    ],
    
    // Configuración de audio simplificada para móviles
    AUDIO_CONSTRAINTS: {
        // Configuración básica que funciona en la mayoría de móviles
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
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
    return 'audio/wav'; // Fallback universal
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
 * Función mejorada de grabación de audio (compatible con PC y móviles)
 */
async function startMobileAudioRecording() {
    try {
        
        // 1. Para móviles, no activar AudioContext automáticamente
        // Se activará cuando el usuario interactúe
        
        // 2. Obtener la mejor configuración para el dispositivo
        const audioConstraints = getBestAudioConstraints();
        
        // 3. Activar AudioContext si está suspendido (solo cuando el usuario interactúa)
        if (window.audioContext && window.audioContext.state === 'suspended') {
            try {
                await window.audioContext.resume();
            } catch (error) {
                // Si falla, crear uno nuevo
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                window.audioContext = new AudioContext();
            }
        }
        
        // 4. Solicitar acceso al micrófono
        const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        
        // 5. Obtener el mejor MIME Type
        const mimeType = getBestMimeType();
        
        // 6. Configurar MediaRecorder
        const options = {
            mimeType: mimeType,
            audioBitsPerSecond: 128000
        };

        const mediaRecorder = new MediaRecorder(stream, options);
        const audioChunks = [];

        // 7. Configurar eventos
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: mimeType });
            
            // Liberar recursos del stream
            stream.getTracks().forEach(track => track.stop());
            
            // Procesar el audio grabado
            if (audioBlob.size > 0) {
                processRecordedAudio(audioBlob);
            } else {
                showError('No se grabó audio. Intenta de nuevo.');
            }
        };
        
        // 8. Iniciar grabación con configuración adaptativa
        const chunkInterval = isMobileDevice() ? 100 : 1000; // Móviles: 100ms, PC: 1000ms
        mediaRecorder.start(chunkInterval);
        
        return {
            mediaRecorder,
            stream,
            mimeType
        };
        
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
 * Procesar audio grabado
 */
function processRecordedAudio(audioBlob) {
    // Verificar que el audio no esté vacío
    if (audioBlob.size < 100) {
        showError('Audio muy corto. Intenta grabar por más tiempo.');
        return;
    }
    
    // Crear URL temporal para previsualización
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // Crear elemento de audio para verificación
    const audio = new Audio(audioUrl);
    audio.addEventListener('loadedmetadata', () => {
        if (audio.duration > 0) {
            // Audio válido, proceder con el envío
            sendAudioMessage(audioBlob);
        } else {
            showError('Audio inválido. Intenta grabar de nuevo.');
        }
        URL.revokeObjectURL(audioUrl);
    });
    
    audio.addEventListener('error', () => {
        showError('Error al procesar audio. Intenta de nuevo.');
        URL.revokeObjectURL(audioUrl);
    });
    
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
function sendAudioMessage(audioBlob) {
    // Usar la función existente si está disponible
    if (typeof window.sendAudioMessage === 'function') {
        window.sendAudioMessage(audioBlob);
    } else {
        // Fallback: enviar por fetch
        const formData = new FormData();
        formData.append('audio', audioBlob, `audio_${Date.now()}.${audioBlob.type.split('/')[1]}`);
        formData.append('message_type', 'audio');
        
        fetch('/tienda/api/chat/send_audio', {
            method: 'POST',
            body: formData
        }).then(response => {
            if (response.ok) {
            } else {
                showError('Error al enviar audio');
            }
        }).catch(error => {
            showError('Error al enviar audio');
        });
    }
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
 * Interceptar eventos de clic en botones de audio para móviles
 */
function interceptAudioButtons() {
    if (!isMobileDevice()) {
        return;
    }
    
    
    // Función para interceptar botones de audio
    const interceptButton = (buttonId) => {
        const button = document.getElementById(buttonId);
        if (button) {
            
            // Remover listeners existentes
            button.replaceWith(button.cloneNode(true));
            const newButton = document.getElementById(buttonId);
            
            // Agregar listener personalizado para móviles
            newButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                    await startMobileAudioRecording();
                } catch (error) {
                    handleAudioError(error);
                }
            }, { passive: false });
            
            // También interceptar touchstart
            newButton.addEventListener('touchstart', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                    await startMobileAudioRecording();
                } catch (error) {
                    handleAudioError(error);
                }
            }, { passive: false });
        } else {
            // Para audioRecordBtnUser, es opcional (solo existe en chat de usuarios)
        }
    };
    
    // Interceptar botones de audio (solo los que existen)
    interceptButton('audioRecordBtn');
    
    // Solo interceptar audioRecordBtnUser si existe (es opcional)
    const userButton = document.getElementById('audioRecordBtnUser');
    if (userButton) {
        interceptButton('audioRecordBtnUser');
    }
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
        
        if (audioRecordBtn) {
            interceptAudioButtons();
        } else if (attempts < maxAttempts) {
            setTimeout(tryIntercept, 500);
        }
    };
    
    tryIntercept();
}

/**
 * Inicializar funcionalidad de audio móvil
 */
function initializeMobileAudio() {
    // Solo proceder si es móvil
    if (!isMobileDevice()) {
        return;
    }
    
    
    // Interceptar botones de audio con reintentos
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
