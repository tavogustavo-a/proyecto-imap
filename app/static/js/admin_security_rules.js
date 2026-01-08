document.addEventListener('DOMContentLoaded', function () {
    const csrfToken = document.querySelector('meta[name="csrf_token"]')?.getAttribute('content');
    const rulesListContainer = document.getElementById('security-rules-list');
    const searchForm = document.getElementById('securityRuleSearchForm');
    const searchInput = document.getElementById('securityRuleSearchInput');
    const clearBtn = document.getElementById('clearSecurityRuleSearchBtn');
    
    // Formulario de creación (el POST sigue siendo tradicional por ahora)

    function renderSecurityRules(rules) {
        if (!rulesListContainer) return;
        if (!rules || rules.length === 0) {
            rulesListContainer.innerHTML = '<p>No hay reglas de seguridad creadas.</p>';
            return;
        }

        let html = '';
        rules.forEach(rule => {
            html += `
            <div class="regex-item mb-1">
                <div><strong>Remitente:</strong> ${escapeHTML(rule.sender) || '(Cualquiera)'}</div>
                <div><strong>Descripción:</strong> ${escapeHTML(rule.description) || '(Sin descripción)'}</div>
                <div><strong>Patrón Activador:</strong> <code>${escapeHTML(rule.trigger_pattern)}</code></div>
                <div><strong>Patrón Observador:</strong> <code>${escapeHTML(rule.observer_pattern)}</code></div>
                <div>
                    ${rule.enabled
                        ? `<button class="btn btn-red toggle-security-rule" data-id="${rule.id}" data-enabled="true">Off</button>`
                        : `<button class="btn btn-green toggle-security-rule" data-id="${rule.id}" data-enabled="false">On</button>`
                    }
                    <a href="/admin/edit_security_rule/${rule.id}" class="btn-panel btn-orange btn-sm btn-edit-security-rule">Editar</a>
                    <button class="btn-panel btn-red btn-sm delete-security-rule" data-id="${rule.id}" title="Eliminar">
                      <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            `;
        });
        rulesListContainer.innerHTML = html;
    }

    function fetchRules(query = "") {
        if (!rulesListContainer) return;
        rulesListContainer.innerHTML = '<p>Cargando reglas...</p>';

        fetch(`/admin/security_rules?search_query=${encodeURIComponent(query)}`, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrfToken 
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'ok') {
                renderSecurityRules(data.rules);
            } else {
                rulesListContainer.innerHTML = `<p style="color:red;">Error: ${data.message || 'No se pudieron cargar las reglas.'}</p>`;
            }
        })
        .catch(error => {
            rulesListContainer.innerHTML = `<p style="color:red;">Error de red al cargar las reglas.</p>`;
        });
    }

    fetchRules(); // Carga inicial

    if (searchForm) {
        searchForm.addEventListener('submit', function(event) {
            event.preventDefault();
            const query = searchInput ? searchInput.value.trim() : "";
            fetchRules(query);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const query = searchInput.value.trim();
            fetchRules(query);
        });
    }

    if (rulesListContainer && !rulesListContainer.hasAttribute('data-listener-attached')) {
        // Marcar como que ya tiene listener para evitar duplicados
        rulesListContainer.setAttribute('data-listener-attached', 'true');
        
        let isProcessing = false;
        
        rulesListContainer.addEventListener('click', function(event) {
            const target = event.target;
            
            if (isProcessing) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (target.classList.contains('delete-security-rule') || target.closest('.delete-security-rule')) {
                event.preventDefault();
                event.stopPropagation();
                
                const button = target.classList.contains('delete-security-rule') ? target : target.closest('.delete-security-rule');
                
                if (!confirm('¿Deseas eliminar esta regla de seguridad?')) {
                    return;
                }
                
                isProcessing = true;
                button.disabled = true;
                
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                
                const ruleId = button.dataset.id;
                fetch('/admin/delete_security_rule_ajax', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrfToken},
                    body: JSON.stringify({ rule_id: ruleId })
                })
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    }
                    return res.json();
                })
                .then(data => {
                    if (data.status === 'ok') {
                        // Actualizar inmediatamente sin requestAnimationFrame
                        renderSecurityRules(data.rules);
                    } else {
                        alert('Error al eliminar: ' + (data.message || 'Error desconocido'));
                    }
                })
                .catch(err => {
                    alert('Error al eliminar: ' + err.message);
                })
                .finally(() => {
                    // Resetear estado más rápido
                    setTimeout(() => {
                        button.disabled = false;
                        button.innerHTML = originalText;
                        isProcessing = false;
                    }, 100); // Solo 100ms de delay
                });
            }

            if (target.classList.contains('toggle-security-rule')) {
                event.preventDefault();
                event.stopPropagation();
                
                isProcessing = true;
                target.disabled = true;
                
                // Feedback visual inmediato
                const originalText = target.innerHTML;
                target.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                
                const ruleId = target.dataset.id;
                fetch('/admin/toggle_security_rule_ajax', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrfToken},
                    body: JSON.stringify({ rule_id: ruleId })
                })
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    }
                    return res.json();
                })
                .then(data => {
                    if (data.status === 'ok') {
                        // Actualizar inmediatamente sin requestAnimationFrame
                        renderSecurityRules(data.rules);
                    } else {
                        alert('❌ Error al cambiar estado: ' + (data.message || 'Error desconocido'));
                    }
                })
                .catch(err => {
                    alert('Error al cambiar estado: ' + err.message);
                })
                .finally(() => {
                    // Resetear estado más rápido
                    setTimeout(() => {
                        target.disabled = false;
                        target.innerHTML = originalText;
                        isProcessing = false;
                    }, 100); // Solo 100ms de delay
                });
            }
        });
    }
    
    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', function() {
            searchInput.value = '';
            fetchRules('');
        });
    }

    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[match];
        });
    }

    // ===============================================
    // MANEJO DE SERVIDORES IMAP
    // ===============================================
    
    // Botones Editar
    const editButtons = document.querySelectorAll('.edit-observer-imap');
    editButtons.forEach(button => {
        button.addEventListener('click', function() {
            const url = this.getAttribute('data-url');
            if (url) {
                window.location.href = url;
            }
        });
    });

    // Botones Eliminar
    const deleteButtons = document.querySelectorAll('.delete-observer-imap');
    deleteButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // Prevenir múltiples clicks rápidos
            if (this.disabled) return;
            this.disabled = true;
            
            const id = this.getAttribute('data-id');
            if (id && confirm('¿Estás seguro de que quieres eliminar este servidor IMAP?')) {
                fetch('/admin/observer_delete_imap_ajax', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf_token"]').getAttribute('content')
                    },
                    body: JSON.stringify({ server_id: parseInt(id) })
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.status === "ok") {
                        // Mostrar mensaje de éxito antes de recargar
                        alert('✅ ' + (data.message || 'Servidor eliminado correctamente'));
                        location.reload();
                    } else {
                        alert('❌ Error al eliminar: ' + (data.message || 'Error desconocido'));
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    if (error.message.includes("Unexpected token")) {
                        alert('Error: El servidor devolvió una respuesta inesperada. Recarga la página e intenta nuevamente.');
                    } else {
                        alert('Error al eliminar: ' + error.message);
                    }
                })
                .finally(() => {
                    this.disabled = false;
                });
            } else {
                this.disabled = false;
            }
        });
    });
}); 