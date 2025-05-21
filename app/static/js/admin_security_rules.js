document.addEventListener('DOMContentLoaded', function () {
    const csrfToken = document.querySelector('meta[name="csrf_token"]')?.getAttribute('content');
    const rulesListContainer = document.getElementById('security-rules-list');
    const searchForm = document.getElementById('securityRuleSearchForm');
    const searchInput = document.getElementById('securityRuleSearchInput');
    
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
                <div class="mt-05 d-flex flex-wrap gap-05">
                    <a href="/admin/edit_security_rule/${rule.id}" class="btn btn-orange">Editar</a>
                    <button class="btn btn-red delete-security-rule" data-id="${rule.id}">Eliminar</button>
                    ${rule.enabled
                        ? `<button class="btn btn-red toggle-security-rule" data-id="${rule.id}" data-enabled="true">Off</button>`
                        : `<button class="btn btn-green toggle-security-rule" data-id="${rule.id}" data-enabled="false">On</button>`
                    }
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
            console.error('Error fetching security rules:', error);
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

    if (rulesListContainer) {
        rulesListContainer.addEventListener('click', function(event) {
            const target = event.target;

            if (target.classList.contains('delete-security-rule')) {
                if (!confirm('¿Deseas eliminar esta regla de seguridad?')) return;
                const ruleId = target.dataset.id;
                fetch('/admin/delete_security_rule_ajax', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrfToken},
                    body: JSON.stringify({ rule_id: ruleId })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'ok') {
                        renderSecurityRules(data.rules);
                    } else {
                        alert('Error al eliminar: ' + (data.message || 'Error desconocido'));
                    }
                })
                .catch(err => alert('Error de red al eliminar: ' + err));
            }

            if (target.classList.contains('toggle-security-rule')) {
                const ruleId = target.dataset.id;
                fetch('/admin/toggle_security_rule_ajax', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrfToken},
                    body: JSON.stringify({ rule_id: ruleId })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'ok') {
                         renderSecurityRules(data.rules);
                    } else {
                        alert('Error al cambiar estado: ' + (data.message || 'Error desconocido'));
                    }
                })
                .catch(err => alert('Error de red al cambiar estado: ' + err));
            }
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
}); 