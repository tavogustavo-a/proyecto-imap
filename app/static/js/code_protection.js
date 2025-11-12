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
    
    // ===== DETECCIÓN DE PÁGINAS QUE DEBEN TENER PROTECCIONES =====
    // Solo estas páginas específicas tendrán protecciones activas
    const shouldHaveProtection = (function() {
        const path = window.location.pathname.toLowerCase();
        
        // Páginas que SÍ deben tener protecciones:
        const isHerramientasPublic = path.includes('/herramientas-public') || path.includes('/tools_public');
        const isCodigos = path === '/search' || path === '/codigos' || path.includes('/search?');
        const isCodigos2 = path === '/search2' || path === '/codigos2' || path.includes('/search2?');
        const isSubusuarios = path.includes('/subusers') || path.includes('/sub-usuarios') || path.includes('/manage_subusers');
        
        return isHerramientasPublic || isCodigos || isCodigos2 || isSubusuarios;
    })();
    
    // ===== DETECCIÓN DE PÁGINAS QUE NO DEBEN TENER PROTECCIONES =====
    // Todas las páginas admin y funcionales NO tendrán protecciones
    const shouldNotHaveProtection = (function() {
        const path = window.location.pathname.toLowerCase();
        
        // TODAS las páginas admin están excluidas
        const isAdmin = path.includes('/admin') || path.includes('/usuarios') || path.includes('/filters') || 
                       path.includes('/regex') || path.includes('/services') || path.includes('/parrafos') ||
                       path.includes('/security') || path.includes('/email') || path.includes('/imap') ||
                       path.includes('/dashboard') || path.includes('/login') || path.includes('/twofa') ||
                       path.includes('/disable_2fa') || path.includes('/change_creds') || path.includes('/verify_2fa');
        
        // Páginas funcionales que necesitan funcionalidad completa
        const isWorksheet = path.includes('/work_sheets') || path.includes('/hojas') || path.includes('worksheet') || path.includes('shared_worksheet');
        const isChat = path.includes('/chat') || path.includes('/soporte') || path.includes('/support') || path.includes('chatsoporte');
        const isConfig = path.includes('/configurations') || path.includes('/configuracion');
        const isStore = path.includes('/store') || path.includes('/tienda');
        const isForgotPassword = path.includes('/forgot_password') || path.includes('/reset_password');
        
        const hasNoProtectionFlag = document.body.getAttribute('data-no-protection') === 'true';
        
        // También verificar si hay elementos que requieren funcionalidad completa
        const hasDragDropElements = document.querySelectorAll('[draggable="true"]').length > 0;
        const hasComplexTextareas = document.querySelectorAll('textarea[rows]').length > 5;
        
        return isAdmin || isWorksheet || isChat || isConfig || isStore || isForgotPassword || 
               hasNoProtectionFlag || hasDragDropElements || hasComplexTextareas;
    })();
    
    // Si estamos en desarrollo O NO debemos tener protecciones, NO activar protecciones
    if (isDevelopment || shouldNotHaveProtection || !shouldHaveProtection) {
        if (isDevelopment) {
            console.log('🔧 Modo desarrollo detectado - Protecciones desactivadas');
        } else if (shouldNotHaveProtection) {
            console.log('🔧 Página admin/funcional detectada - Protecciones desactivadas');
        } else {
            console.log('🔧 Página no requiere protecciones - Protecciones desactivadas');
        }
        return; // Salir sin activar ninguna protección
    }
    
    // ===== PROTECCIONES (solo en producción) =====
    
    // Protección 1: Deshabilitar clic derecho (solo en elementos sensibles)
    document.addEventListener('contextmenu', function(e) {
        // Permitir clic derecho en inputs, textareas, tablas y contenido editable
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable ||
            target.tagName === 'TD' || target.tagName === 'TH' || target.tagName === 'TABLE' ||
            target.tagName === 'LI' || target.tagName === 'P' || target.tagName === 'DIV' ||
            target.tagName === 'SPAN' || target.tagName === 'STRONG' || target.tagName === 'EM' ||
            target.tagName === 'B' || target.tagName === 'BUTTON' || target.tagName === 'A' ||
            target.tagName === 'LABEL' || target.tagName === 'SELECT' || target.tagName === 'OPTION' ||
            target.tagName === 'FORM' || target.tagName === 'I' || target.tagName === 'HR' ||
            target.tagName === 'IMG' || target.tagName === 'IMAGE' || // Permitir clic derecho en imágenes
            target.closest('table') || target.closest('.user-item') || 
            target.closest('.admin-card') || target.closest('.result-card') ||
            target.closest('.regex-result') || target.closest('.regex-result-container') ||
            target.closest('.service-btn') || target.closest('.service-btn-container') ||
            target.closest('.search-form-container') || target.closest('.search-results') || 
            target.closest('.search-results-display') || target.closest('.search-page-container') ||
            target.closest('.mobile-menu-store') || target.closest('.form-container-wide') ||
            target.closest('.public-tools-container') || target.closest('.subusersContainer') ||
            target.closest('.main-message-wrapper') || target.closest('form')) {
            return true;
        }
        e.preventDefault();
        return false;
    });
    
    // Protección 2: Deshabilitar atajos de teclado para ver código
    document.addEventListener('keydown', function(e) {
        // NO bloquear si el usuario está escribiendo en un input o textarea
        // Esto permite que todos los atajos funcionen normalmente al escribir
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            return true; // Permitir todos los atajos cuando se está escribiendo
        }
        
        // Soporte para Mac (metaKey) y Windows/Linux (ctrlKey)
        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        
        // Deshabilitar F12 (DevTools)
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+Shift+I / Cmd+Shift+I (DevTools)
        if (isCtrlOrCmd && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+Shift+J / Cmd+Shift+J (Console)
        if (isCtrlOrCmd && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+U / Cmd+U (Ver código fuente)
        if (isCtrlOrCmd && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            return false;
        }
        
        // Deshabilitar Ctrl+Shift+C / Cmd+Shift+C (Selector de elementos)
        // NOTA: Esto NO afecta Ctrl+C / Cmd+C (copiar), solo Ctrl+Shift+C / Cmd+Shift+C
        if (isCtrlOrCmd && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
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
        // Permitir selección en inputs, textareas, tablas, listas y contenido editable
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable ||
            target.tagName === 'TD' || target.tagName === 'TH' || target.tagName === 'TABLE' ||
            target.tagName === 'LI' || target.tagName === 'P' || target.tagName === 'DIV' ||
            target.tagName === 'SPAN' || target.tagName === 'STRONG' || target.tagName === 'EM' ||
            target.tagName === 'B' || target.tagName === 'BUTTON' || target.tagName === 'A' ||
            target.tagName === 'LABEL' || target.tagName === 'SELECT' || target.tagName === 'OPTION' ||
            target.tagName === 'FORM' || target.tagName === 'I' || target.tagName === 'HR' ||
            target.tagName === 'IMG' || target.tagName === 'IMAGE' || // Permitir selección alrededor de imágenes
            target.closest('table') || target.closest('.user-item') || 
            target.closest('.admin-card') || target.closest('.result-card') ||
            target.closest('.regex-result') || target.closest('.regex-result-container') ||
            target.closest('.service-btn') || target.closest('.service-btn-container') ||
            target.closest('.search-form-container') || target.closest('.search-results') ||
            target.closest('.search-results-display') || target.closest('.search-page-container') ||
            target.closest('.mobile-menu-store') || target.closest('.form-container-wide') ||
            target.closest('.public-tools-container') || target.closest('.subusersContainer') ||
            target.closest('.main-message-wrapper') || target.closest('form')) {
            return true;
        }
        // Bloquear selección solo en scripts y elementos con clase 'no-select'
        if (target.tagName === 'SCRIPT' || target.closest('script') || target.classList.contains('no-select')) {
            e.preventDefault();
            return false;
        }
        // Permitir selección en todo lo demás
        return true;
    });
    
    // Protección 5: Bloquear copiar código JavaScript (MUY PERMISIVA - solo código obvio)
    document.addEventListener('copy', function(e) {
        const selection = window.getSelection().toString();
        const target = e.target;
        
        // Permitir copiar desde inputs, textareas y contenido editable SIEMPRE
        // (incluye textareas ocultos usados por fallback de execCommand)
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return true;
        }
        
        // Permitir copiar desde botones (los botones de copiar usan programáticamente el clipboard)
        // También verificar si el evento viene de un botón cercano (para copias programáticas)
        if (target.tagName === 'BUTTON' || target.closest('button') || 
            target.closest('.regex-result-copy-btn') || target.closest('.btn-copy-link')) {
            return true; // Permitir que los botones de copiar funcionen
        }
        
        // Permitir copias programáticas desde textareas ocultos (fallback de execCommand)
        // Estos textareas tienen posición fixed y están fuera de la vista
        if (target.tagName === 'TEXTAREA') {
            const style = window.getComputedStyle(target);
            // Verificar si es un textarea oculto usado para copia programática
            if (style.position === 'fixed' && 
                (style.left === '-999999px' || style.left === '-9999px' || 
                 style.top === '-999999px' || style.top === '-9999px' ||
                 style.opacity === '0' || style.visibility === 'hidden')) {
                return true; // Es un textarea oculto para copia programática
            }
        }
        
        // Permitir copias programáticas cuando se usa navigator.clipboard.writeText()
        // Si no hay selección visible pero hay un evento copy, probablemente es programático
        if (!selection || selection.length === 0) {
            return true; // Permitir copias programáticas sin selección visible
        }
        
        // Permitir copiar desde tablas, listas y contenido de datos
        if (target.tagName === 'TD' || target.tagName === 'TH' || target.tagName === 'LI' || 
            target.tagName === 'P' || target.tagName === 'DIV' || target.tagName === 'SPAN' ||
            target.tagName === 'STRONG' || target.tagName === 'EM' || target.tagName === 'B' ||
            target.tagName === 'A' || target.tagName === 'LABEL' || target.tagName === 'SELECT' ||
            target.tagName === 'OPTION' || target.tagName === 'FORM' || target.tagName === 'I' ||
            target.tagName === 'IMG' || target.tagName === 'IMAGE' || // Permitir copiar URLs de imágenes
            target.closest('.result-card') || target.closest('.regex-result') || 
            target.closest('.regex-result-container') || target.closest('.regex-result-code') ||
            target.closest('.regex-result-copy-btn') || target.closest('.service-btn') || 
            target.closest('.service-btn-container') || target.closest('.admin-card') || 
            target.closest('.search-results') || target.closest('.search-results-display') || 
            target.closest('.search-form-container') || target.closest('.search-page-container') ||
            target.closest('.mobile-menu-store') || target.closest('.form-container-wide') ||
            target.closest('.public-tools-container') || target.closest('.subusersContainer') ||
            target.closest('.main-message-wrapper') || target.closest('form')) {
            return true; // Permitir copiar datos de tablas, listas y resultados
        }
        
        // Solo bloquear código JavaScript muy obvio (etiquetas script completas)
        // Y solo si NO es un resultado de búsqueda o código legítimo del usuario
        const hasScriptTag = (selection.includes('<script') || selection.includes('</script>')) && 
                            selection.includes('>') && selection.length > 100;
        
        // Verificar si es código legítimo (resultados de búsqueda, códigos, etc.)
        const isLegitimateCode = target.closest('.result-card') || 
                                 target.closest('.regex-result') ||
                                 target.closest('.regex-result-container') ||
                                 target.closest('.regex-result-code') ||
                                 target.closest('.code-result') ||
                                 target.closest('.search-results') ||
                                 target.closest('.search-results-display') ||
                                 target.closest('.search-page-container') ||
                                 target.closest('.public-tools-container') ||
                                 target.closest('.form-container-wide') ||
                                 target.closest('.subusersContainer') ||
                                 target.closest('[data-valor]') ||
                                 target.closest('form') ||
                                 selection.match(/^[A-Z0-9]{4,}$/); // Códigos alfanuméricos
        
        // Solo bloquear si es claramente código HTML/JS completo Y no es código legítimo
        if (hasScriptTag && !isLegitimateCode) {
            e.clipboardData.setData('text/plain', '');
            e.preventDefault();
            return false;
        }
        
        // Permitir todo lo demás (incluyendo texto que contenga palabras como "function", "document", etc.)
        return true;
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

