# ============================================
# ⭐ SISTEMA UNIFICADO DE HISTORIAL DE CAMBIOS
# ============================================

"""
Módulo para manejar el historial de cambios de worksheets de manera unificada.
Este módulo es compartido entre modo admin y modo compartido para garantizar
que ambos vean el mismo historial combinado.
"""

import json
from datetime import datetime
from typing import Dict, List, Optional, Any

# ⭐ ALMACENAMIENTO GLOBAL UNIFICADO
# Este diccionario es compartido entre todos los endpoints
_global_history_storage: Dict[int, List[Dict[str, Any]]] = {}

# ⭐ CONFIGURACIÓN
MAX_HISTORY_PER_WORKSHEET = 10

def add_change_to_history(worksheet_id: int, change: Dict[str, Any]) -> bool:
    """
    Agrega un cambio al historial global de un worksheet específico.
    
    Args:
        worksheet_id: ID del worksheet
        change: Diccionario con los datos del cambio
        
    Returns:
        bool: True si se agregó correctamente, False en caso contrario
    """
    try:
        # Inicializar historial para este worksheet si no existe
        if worksheet_id not in _global_history_storage:
            _global_history_storage[worksheet_id] = []
        
        # Agregar timestamp si no existe
        if 'timestamp' not in change:
            change['timestamp'] = datetime.now().isoformat()
        
        # Agregar ID único si no existe
        if 'id' not in change:
            change['id'] = f"{datetime.now().timestamp()}_{hash(str(change))}"
        
        # Agregar el cambio al inicio (más reciente primero)
        _global_history_storage[worksheet_id].insert(0, change)
        
        # Mantener solo los últimos MAX_HISTORY_PER_WORKSHEET cambios
        if len(_global_history_storage[worksheet_id]) > MAX_HISTORY_PER_WORKSHEET:
            _global_history_storage[worksheet_id] = _global_history_storage[worksheet_id][:MAX_HISTORY_PER_WORKSHEET]
        

        return True
        
    except Exception as e:
        return False

def get_worksheet_history(worksheet_id: int) -> List[Dict[str, Any]]:
    """
    Obtiene el historial completo de un worksheet específico.
    
    Args:
        worksheet_id: ID del worksheet
        
    Returns:
        List[Dict]: Lista de cambios ordenados por timestamp (más reciente primero)
    """
    try:
        history = _global_history_storage.get(worksheet_id, [])
        
        # Ordenar por timestamp (más reciente primero)
        history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        

        return history
        
    except Exception as e:
        return []

def clear_worksheet_history(worksheet_id: int) -> int:
    """
    Limpia todo el historial de un worksheet específico.
    
    Args:
        worksheet_id: ID del worksheet
        
    Returns:
        int: Número de cambios eliminados
    """
    try:
        if worksheet_id in _global_history_storage:
            deleted_count = len(_global_history_storage[worksheet_id])
            _global_history_storage[worksheet_id] = []
            
    
            return deleted_count
        else:
    
            return 0
            
    except Exception as e:
        return 0

def get_all_worksheets_history() -> Dict[int, List[Dict[str, Any]]]:
    """
    Obtiene el historial de todos los worksheets.
    
    Returns:
        Dict: Diccionario con worksheet_id como clave y lista de cambios como valor
    """
    return _global_history_storage.copy()

def get_history_stats() -> Dict[str, Any]:
    """
    Obtiene estadísticas del historial global.
    
    Returns:
        Dict: Estadísticas del historial
    """
    try:
        total_worksheets = len(_global_history_storage)
        total_changes = sum(len(changes) for changes in _global_history_storage.values())
        
        return {
            'total_worksheets': total_worksheets,
            'total_changes': total_changes,
            'max_changes_per_worksheet': MAX_HISTORY_PER_WORKSHEET,
            'worksheets_with_history': [ws_id for ws_id, changes in _global_history_storage.items() if changes]
        }
        
    except Exception as e:
        return {}

def merge_histories(worksheet_id: int, local_history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Combina el historial local con el historial del servidor.
    
    Args:
        worksheet_id: ID del worksheet
        local_history: Historial local del cliente
        
    Returns:
        List[Dict]: Historial combinado y ordenado
    """
    try:
        # Obtener historial del servidor
        server_history = get_worksheet_history(worksheet_id)
        
        # Combinar historiales
        combined_history = local_history + server_history
        
        # Remover duplicados por ID
        seen_ids = set()
        unique_history = []
        
        for change in combined_history:
            change_id = change.get('id')
            if change_id and change_id not in seen_ids:
                seen_ids.add(change_id)
                unique_history.append(change)
        
        # Ordenar por timestamp (más reciente primero)
        unique_history.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        
        # Mantener solo los últimos MAX_HISTORY_PER_WORKSHEET cambios
        if len(unique_history) > MAX_HISTORY_PER_WORKSHEET:
            unique_history = unique_history[:MAX_HISTORY_PER_WORKSHEET]
        

        return unique_history
        
    except Exception as e:
        return local_history

def validate_change(change: Dict[str, Any]) -> bool:
    """
    Valida que un cambio tenga los campos requeridos.
    
    Args:
        change: Diccionario con los datos del cambio
        
    Returns:
        bool: True si el cambio es válido, False en caso contrario
    """
    required_fields = ['oldValue', 'user', 'cellKey']
    
    for field in required_fields:
        if field not in change:
            return False
    
    # ⭐ NUEVO: Validar campos opcionales pero recomendados
    optional_fields = ['newValue', 'changeType']
    for field in optional_fields:
        if field not in change:
            pass
    
    return True

 