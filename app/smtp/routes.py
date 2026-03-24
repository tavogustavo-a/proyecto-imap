# app/smtp/routes.py

import socket
from flask import Blueprint, jsonify
from app.smtp.smtp_server import smtp_manager

smtp_routes_bp = Blueprint('smtp_routes', __name__)


def _is_port_25_listening():
    """Comprueba si hay un proceso escuchando en puerto 25 (SMTP)."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(('127.0.0.1', 25))
        sock.close()
        return result == 0
    except Exception:
        return False


@smtp_routes_bp.route('/status', methods=['GET'])
def smtp_status():
    """Endpoint para verificar el estado del servidor SMTP (puerto 25)."""
    try:
        # SMTP puede correr en proyectoimap-smtp (run_smtp.py) mientras la app principal
        # usa Gunicorn. Comprobamos si el puerto 25 está en uso.
        in_process = smtp_manager.controller and smtp_manager.controller.server
        port_listening = _is_port_25_listening()

        if in_process or port_listening:
            return jsonify({
                'success': True,
                'status': 'SMTP Server Active',
                'port': 25,
                'host': '0.0.0.0',
                'message': 'Servidor SMTP funcionando correctamente en puerto 25 (recepción)'
            })
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
        in_process = smtp_manager.controller
        port_listening = _is_port_25_listening()

        if in_process or port_listening:
            return jsonify({
                'success': True,
                'message': 'Servidor SMTP disponible para recibir emails',
                'port': 25,
                'host': '0.0.0.0'
            })
        return jsonify({
            'success': False,
            'message': 'Servidor SMTP no está disponible'
        }), 503

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error en prueba SMTP: {str(e)}'
        }), 500
