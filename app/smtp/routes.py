# app/smtp/routes.py

from flask import Blueprint, jsonify
from app.smtp.smtp_server import smtp_manager

smtp_routes_bp = Blueprint('smtp_routes', __name__)

@smtp_routes_bp.route('/status', methods=['GET'])
def smtp_status():
    """Endpoint para verificar el estado del servidor SMTP"""
    try:
        # Verificar si el servidor SMTP está corriendo
        if smtp_manager.controller and smtp_manager.controller.server:
            return jsonify({
                'success': True,
                'status': 'SMTP Server Active',
                'port': smtp_manager.port,
                'host': smtp_manager.host,
                'message': 'Servidor SMTP funcionando correctamente en puerto 25 (recepción)'
            })
        else:
            return jsonify({
                'success': False,
                'status': 'SMTP Server Inactive',
                'message': 'Servidor SMTP no está corriendo'
            }), 503
            
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error verificando estado SMTP: {str(e)}'
        }), 500

@smtp_routes_bp.route('/test', methods=['GET', 'POST'])
def smtp_test():
    """Endpoint para probar el servidor SMTP"""
    try:
        if smtp_manager.controller:
            return jsonify({
                'success': True,
                'message': 'Servidor SMTP disponible para recibir emails',
                'port': smtp_manager.port,
                'host': smtp_manager.host
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Servidor SMTP no está disponible'
            }), 503
            
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error en prueba SMTP: {str(e)}'
        }), 500
