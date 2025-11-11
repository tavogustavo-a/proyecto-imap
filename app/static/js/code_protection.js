// app/static/js/code_protection.js
// Sistema de protección contra copia de código

(function() {
    'use strict';
    
    // ===== DETECCIÓN DE MODO DESARROLLO =====
    // Verificar si estamos en desarrollo (localhost/127.0.0.1)
    const isDevelopment = (function() {
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
        const isDebugMode = document.body.getAttribute('data-debug-mode') === 'true';
        const port = window.location.port;
        const isDevPort = port === '5000' || port === '8000' || port === '3000';
        
        // Si está en localhost O tiene data-debug-mode="true" O está en puerto de desarrollo
        return isLocalhost || isDebugMode || isDevPort;
    })();
    
    // Si estamos en desarrollo, NO activar protecciones
    if (isDevelopment) {
        console.log('🔧 Modo desarrollo detectado - Protecciones desactivadas');
        return; // Salir sin activar ninguna protección
    }
    
    // ===== PROTECCIONES (solo en producción) =====
    
    // Protección 1: Deshabilitar clic derecho (solo en elementos sensibles)
    document.addEventListener('contextmenu', function(e) {
        // Permitir clic derecho en inputs y textareas para usuarios normales
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return true;
        }
        e.preventDefault();
        return false;
    });
    
    // Protección 2: Deshabilitar atajos de teclado para ver código
    document.addEventListener('keydown', function(e) {
        // Deshabilitar F12 (DevTools)
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+Shift+I (DevTools)
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+Shift+J (Console)
        if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+U (Ver código fuente)
        if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+Shift+C (Selector de elementos)
        if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
            e.preventDefault();
            return false;
        }
    });
    
    // Protección 3: Detectar apertura de DevTools (advertencia, no bloqueo total)
    let devtoolsDetected = false;
    const threshold = 160;
    
    setInterval(function() {
        if (window.outerHeight - window.innerHeight > threshold || 
            window.outerWidth - window.innerWidth > threshold) {
            if (!devtoolsDetected) {
                devtoolsDetected = true;
                // Solo advertir, no bloquear completamente
                console.warn('Herramientas de desarrollo detectadas');
            }
        } else {
            devtoolsDetected = false;
        }
    }, 1000);
    
    // Protección 4: Limitar selección de texto (solo en código/scripts)
    document.addEventListener('selectstart', function(e) {
        const target = e.target;
        // Permitir selección en inputs, textareas y contenido editable
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return true;
        }
        // Bloquear selección en scripts y elementos con clase 'no-select'
        if (target.tagName === 'SCRIPT' || target.closest('script') || target.classList.contains('no-select')) {
            e.preventDefault();
            return false;
        }
    });
    
    // Protección 5: Bloquear copiar código JavaScript
    document.addEventListener('copy', function(e) {
        const selection = window.getSelection().toString();
        // Si intentan copiar código JavaScript o HTML, bloquearlo
        if (selection.includes('function') || selection.includes('document.') || 
            selection.includes('window.') || selection.includes('<script')) {
            e.clipboardData.setData('text/plain', '');
            e.preventDefault();
            return false;
        }
    });
    
    // Protección 6: Ofuscar código en inspección (hacer más difícil)
    (function() {
        // Agregar atributos que dificultan la inspección
        const scripts = document.querySelectorAll('script[src]');
        scripts.forEach(function(script) {
            script.setAttribute('data-protected', 'true');
        });
    })();
    
    // Protección 7: Detectar intentos de scraping automatizado
    (function() {
        let mouseMovements = 0;
        document.addEventListener('mousemove', function() {
            mouseMovements++;
        });
        
        // Si no hay movimiento del mouse pero hay actividad, puede ser un bot
        setTimeout(function() {
            if (mouseMovements < 3 && document.visibilityState === 'visible') {
                // Posible bot o scraper - registrar pero no bloquear
                console.warn('Actividad sospechosa detectada');
            }
        }, 5000);
    })();
    
    // Protección 8: Bloquear acceso a funciones sensibles desde consola
    (function() {
        const originalConsole = window.console;
        const protectedMethods = ['log', 'debug', 'info'];
        
        protectedMethods.forEach(function(method) {
            if (originalConsole[method]) {
                originalConsole[method] = function() {
                    // Permitir algunos logs pero dificultar el debugging
                    if (arguments.length > 0 && typeof arguments[0] === 'string' && 
                        (arguments[0].includes('password') || arguments[0].includes('token'))) {
                        return; // Bloquear logs sensibles
                    }
                };
            }
        });
    })();
    
})();

