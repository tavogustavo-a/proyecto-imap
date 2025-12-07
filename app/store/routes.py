from flask import render_template, request, redirect, url_for, flash, jsonify, current_app, session, Response, stream_template, send_file
from datetime import datetime
from app.utils.timezone import get_colombia_now, colombia_strftime, utc_to_colombia, get_colombia_datetime, timesince
# Importa tus modelos y db. Asumo nombres comunes, ajústalos si es necesario.
from .models import Product, Sale, Coupon, coupon_products, Role, role_products, role_users, ProductionLink, ApiInfo, WorksheetTemplate, WorksheetData, WorksheetPermission, DriveTransfer, WhatsAppConfig, GSheetsLink, SMSConfig, SMSMessage, AllowedSMSNumber, SMSRegex

# Identificadores internos del módulo store
_STORE_MODULE_IDENTIFIER = 0x7C8D
_STORE_MODULE_CHECKSUM = 0x9E0F
from app import db
from . import store_bp  # Importa el blueprint ya creado en __init__.py

# Importar CSRF para excluir APIs compartidas
def csrf_exempt_route(func):
    """Decorator para excluir rutas del CSRF"""
    # Marcar la función para exención de CSRF
    func._csrf_exempt = True
    return func
from app.models.user import User
from sqlalchemy.orm import joinedload, selectinload
from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, StoreSetting
import requests
import time
import secrets
import os

import json
from datetime import datetime, timedelta

# ✅ NUEVO: Importar función para emitir eventos de chat eliminado
try:
    from app.store.socketio_events import emit_chat_deleted_event
except ImportError:
    # Si no se puede importar, definir función dummy
    def emit_chat_deleted_event(*args, **kwargs):
        return False

def user_has_worksheet_access(user):
    """
    Verifica si un usuario tiene acceso a hojas de cálculo.
    Solo usuarios normales (no sub-usuarios) pueden tener acceso.
    """
    if not user or user.parent_id is not None:
        return False
    
    # Verificar si el usuario tiene permisos de worksheet
    try:
        from app.store.models import WorksheetPermission
        worksheet_permissions = WorksheetPermission.query.filter_by(access_type='users').all()
        for permission in worksheet_permissions:
            if user in permission.users.all():
                return True
        return False
    except Exception as e:
        return False

def get_current_user():
    """
    Obtiene el usuario actual de la sesión de forma robusta
    """
    username = session.get('username')
    user_id = session.get('user_id')
    
    if username:
        return User.query.filter_by(username=username).first()
    elif user_id:
        return User.query.get(user_id)
    
    return None

# Decorador de ejemplo para proteger rutas (ajústalo a tu implementación real)
from functools import wraps
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get("logged_in"):
            flash("Inicia sesión para acceder.", "danger")
            return redirect(url_for("auth_bp.login"))
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        if session.get("username") != admin_user:
            flash("Solo el administrador puede acceder a la tienda.", "danger")
            return redirect(url_for("auth_bp.login"))
        return f(*args, **kwargs)
    return decorated_function

# Decorador para controlar acceso a la tienda
# ✅ PERMISOS CORREGIDOS:
# - Admin: Acceso completo sin restricciones
# - Usuarios de Soporte: Acceso completo SOLO si NO están en lista bloqueados
# - Usuarios bloqueados: "soporte", "soporte1", "soporte2", "soporte3" (NO acceso)
# - Usuarios normales: Requieren rol o permisos específicos
# - Subusuarios: Requieren can_access_store
def store_access_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if not session.get("logged_in"):
            flash("Debes iniciar sesión para acceder a la tienda.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        if user_obj and user_obj.username == admin_username:
            # El admin nunca debe ser bloqueado ni redirigido
            return f(*args, **kwargs)
        blocked_users = ["soporte", "soporte1", "soporte2", "soporte3"]
        if user_obj and user_obj.username.lower() in blocked_users:
            flash("No tienes permiso para acceder a la tienda.", "danger")
            return redirect(url_for("main_bp.home"))
        # Permitir subusuarios con can_access_store
        if user_obj and user_obj.parent_id is not None:
            if not user_obj.can_access_store:
                flash("No tienes permiso para acceder a la tienda. Solicita acceso a tu usuario principal.", "danger")
                return redirect(url_for("main_bp.home"))
            # Validar estado del rol del padre
            parent = User.query.get(user_obj.parent_id)
            if parent and hasattr(parent, 'roles_tienda') and parent.roles_tienda and not parent.roles_tienda[0].enabled:
                flash("Tu rol está desactivado. Solicita acceso a un administrador.", "danger")
                return redirect(url_for("main_bp.home"))
            return f(*args, **kwargs)
        # Solo usuarios principales requieren rol O permisos específicos
        if user_obj and user_obj.username != admin_username:
            # Verificar si tiene permisos de hojas de cálculo
            has_worksheet_access = user_has_worksheet_access(user_obj)
            
            # Si no tiene rol pero tiene permisos de hojas de cálculo, permitir acceso
            if has_worksheet_access:
                return f(*args, **kwargs)
            
            # Si no tiene rol ni permisos específicos, requerir rol
            if (not hasattr(user_obj, 'roles_tienda') or not user_obj.roles_tienda or len(user_obj.roles_tienda) == 0):
                flash("Debes estar vinculado a un rol para acceder a la tienda. Solicita a un administrador que te asigne un rol.", "danger")
                return redirect(url_for("main_bp.home"))
            # Validar estado del rol
            if user_obj.roles_tienda and not user_obj.roles_tienda[0].enabled:
                flash("Tu rol está desactivado. Solicita acceso a un administrador.", "danger")
                return redirect(url_for("main_bp.home"))
        return f(*args, **kwargs)
    return decorated_function

# Decorador específico para hojas de cálculo (más restrictivo)
def worksheet_access_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        user_obj = User.query.get(user_id) if user_id else None
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        
        if not session.get("logged_in"):
            flash("Debes iniciar sesión para acceder a las hojas de cálculo.", "warning")
            return redirect(url_for("user_auth_bp.login"))
        
        # Solo admin puede acceder sin restricciones
        if user_obj and user_obj.username == admin_username:
            return f(*args, **kwargs)
        
        # Sub-usuarios no pueden acceder
        if user_obj and user_obj.parent_id is not None:
            flash("Los sub-usuarios no tienen acceso a las hojas de cálculo.", "warning")
            return redirect(url_for("main_bp.home"))
        
        # Usuarios normales deben tener permisos específicos
        if user_obj and user_obj.username != admin_username:
            if not user_has_worksheet_access(user_obj):
                flash("No tienes acceso a ninguna hoja de cálculo. Contacta al administrador.", "warning")
                return redirect(url_for("main_bp.home"))
        
        return f(*args, **kwargs)
    return decorated_function

@store_bp.route('/admin', endpoint='admin_store')
@admin_required
def admin_store():
    products = Product.query.order_by(Product.id.desc()).all()
    return render_template('admin_store.html', products=products, title="Admin Licencias")

@store_bp.route('/admin/archivados')
@admin_required
def admin_archivados():
    """Página de licencias archivadas"""
    return render_template('admin_archivados.html')

@store_bp.route('/admin/productos', methods=['GET', 'POST'])
@admin_required
def admin_productos():
    if request.method == 'POST':
        try:
            name = request.form.get('name')
            price_cop = float(request.form.get('price_cop'))
            price_usd = float(request.form.get('price_usd'))
            stock = int(request.form.get('stock'))
            image_url = request.form.get('image_url')
            description = request.form.get('description')
            category = request.form.get('category')
            is_active = request.form.get('is_active') == 'on'

            product = Product(
                name=name,
                price_cop=price_cop,
                price_usd=price_usd,
                stock=stock,
                image_url=image_url,
                description=description,
                category=category,
                is_active=is_active
            )
            db.session.add(product)
            db.session.commit()
            return jsonify({'success': True})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': str(e)})

    products = Product.query.order_by(Product.id.desc()).all()
    return render_template('productos.html', products=products)

@store_bp.route('/admin/productos/new', methods=['GET', 'POST'])
@admin_required
def create_product():
    if request.method == 'POST':
        name = request.form.get('name')
        price_cop_str = request.form.get('price_cop', '0')
        price_usd_str = request.form.get('price_usd', '0')
        image_filename = request.form.get('image_filename')
        if not name:
            flash('El nombre es obligatorio.', 'danger')
            return redirect(url_for('store_bp.admin_productos'))
        if not image_filename or image_filename == 'none':
            flash('Debes seleccionar una imagen para el producto.', 'danger')
            return redirect(url_for('store_bp.admin_productos'))
        try:
            price_cop = float(price_cop_str) if price_cop_str else 0.0
            price_usd = float(price_usd_str) if price_usd_str else 0.0
        except ValueError:
            flash('Los precios deben ser números válidos.', 'danger')
            return redirect(url_for('store_bp.admin_productos'))
        new_product = Product(name=name, price_cop=price_cop, price_usd=price_usd, image_filename=image_filename, enabled=True, description=request.form.get('description'))
        db.session.add(new_product)
        try:
            db.session.commit()
            flash('Producto creado exitosamente.', 'success')
        except Exception as e:
            db.session.rollback()
            if 'NOT NULL constraint failed: store_products.image_filename' in str(e):
                flash('Debes seleccionar una imagen para el producto.', 'danger')
            else:
                flash('Ocurrió un error inesperado al crear el producto. Intenta de nuevo o contacta al administrador.', 'danger')
        return redirect(url_for('store_bp.admin_productos'))
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/admin/productos/<int:prod_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_product(prod_id):
    product = Product.query.get_or_404(prod_id)
    if request.method == 'POST':
        if not product.is_preset:
            product.name = request.form.get('name')
        price_cop_str = request.form.get('price_cop', '0')
        price_usd_str = request.form.get('price_usd', '0')
        product.image_filename = request.form.get('image_filename')
        product.enabled = 'enabled' in request.form
        product.description = request.form.get('description')
        if not product.name:
            flash('El nombre es obligatorio.', 'danger')
        else:
            try:
                product.price_cop = float(price_cop_str) if price_cop_str else 0.0
                product.price_usd = float(price_usd_str) if price_usd_str else 0.0
            except ValueError:
                flash('Los precios deben ser números válidos.', 'danger')
                return render_template('edit_product.html', product=product, title="Editar Producto")
            if product.image_filename == 'none':
                product.image_filename = None
            try:
                db.session.commit()
                flash('Producto actualizado.', 'success')
                return redirect(url_for('store_bp.admin_productos'))
            except Exception as e:
                db.session.rollback()
                current_app.logger.error(f"Error al actualizar producto: {str(e)}")
                flash(f'Error al actualizar producto: {str(e)}', 'danger')
    return render_template('edit_product.html', product=product, title="Editar Producto")

@store_bp.route('/admin/productos/<int:prod_id>/toggle', methods=['POST'])
@admin_required
def toggle_product(prod_id):
    product = Product.query.get_or_404(prod_id)
    product.enabled = not product.enabled
    try:
        db.session.commit()
        flash(f'Producto {product.name} ahora {"visible" if product.enabled else "oculto"}.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al cambiar visibilidad: {str(e)}', 'danger')
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/admin/productos/<int:prod_id>/delete', methods=['POST'])
@admin_required
def delete_product(prod_id):
    product = Product.query.get_or_404(prod_id)
    try:
        db.session.delete(product)
        db.session.commit()
        flash(f'Producto {product.name} eliminado.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al eliminar producto: {str(e)}', 'danger')
    return redirect(url_for('store_bp.admin_productos'))

@store_bp.route('/toggle-product/<int:product_id>', methods=['POST'])
@admin_required
def toggle_product_ajax(product_id):
    product = Product.query.get_or_404(product_id)
    product.enabled = not product.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if product.enabled else 'ON',
        'new_class': 'action-red' if product.enabled else 'action-green',
        'message': f'Producto ahora {'visible' if product.enabled else 'oculto'}.'
    })

@store_bp.route('/admin/productos/<int:prod_id>/delete_ajax', methods=['POST'], endpoint='delete_product_ajax')
@admin_required
def delete_product_ajax(prod_id):
    product = Product.query.get_or_404(prod_id)
    if not product:
        return jsonify({'success': False, 'error': 'Producto no encontrado.'}), 404
    try:
        db.session.delete(product)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Producto eliminado exitosamente.'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error en delete_product_ajax para prod_id {prod_id}: {str(e)}")
        return jsonify({'success': False, 'error': 'Error interno al eliminar el producto.'}), 500

# Ruta para la tienda de cara al público (ejemplo)
@store_bp.route('/')
@store_access_required
def store_front():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    admin_user = current_app.config.get("ADMIN_USER", "admin")

    # Filtrar productos según el rol del usuario o del padre si es sub-usuario
    if username == admin_user:
        products = Product.query.filter_by(enabled=True).order_by(Product.name).all()
    elif user:
        # Si es sub-usuario, usar el rol del padre
        if user.parent_id:
            parent = User.query.get(user.parent_id)
            if parent and parent.roles_tienda and parent.roles_tienda[0].enabled:
                rol = parent.roles_tienda[0]
                products = [p for p in rol.productos_permitidos if p.enabled]
            else:
                products = []
        elif hasattr(user, 'roles_tienda') and user.roles_tienda and user.roles_tienda[0].enabled:
            rol = user.roles_tienda[0]
            products = [p for p in rol.productos_permitidos if p.enabled]
        else:
            products = []
    else:
        products = []

    coupons = Coupon.query.filter_by(enabled=True, show_public=True).order_by(Coupon.id.desc()).all()
    saldo_usd = user.saldo_usd if user else 0
    saldo_cop = user.saldo_cop if user else 0
    return render_template('store_front.html', products=products, coupons=coupons, ADMIN_USER=admin_user, current_user=user, username=username, saldo_usd=saldo_usd, saldo_cop=saldo_cop)




@store_bp.route('/users')
@store_access_required
def users():
    return render_template('store_users.html', title='Usuarios Tienda')

@store_bp.route('/admin/coupons/list', methods=['GET'])
@admin_required
def list_coupons():
    coupons = Coupon.query.options(joinedload(Coupon.products)).order_by(Coupon.id.desc()).all()
    data = []
    for c in coupons:
        data.append({
            'id': c.id,
            'name': c.name,
            'discount_cop': float(c.discount_cop),
            'discount_usd': float(c.discount_usd),
            'products': [{'id': p.id, 'name': p.name} for p in c.products],
            'duration_days': c.duration_days,
            'max_uses_per_user': c.max_uses_per_user,
            'enabled': c.enabled
        })
    return jsonify({'coupons': data})

@store_bp.route('/admin/coupons/create', methods=['POST'])
@admin_required
def create_coupon():
    data = request.json
    name = data.get('coupon_name', '').strip()
    discount_cop = data.get('discount_cop', 0)
    discount_usd = data.get('discount_usd', 0)
    product_ids = data.get('products', [])
    duration_days = data.get('duration_days', 1)
    max_uses_per_user = data.get('max_uses_per_user')
    if max_uses_per_user in (None, '', 'null'):
        max_uses_per_user = None
    description = data.get('description', '')
    min_amount = data.get('min_amount', None)
    if min_amount in (None, '', 'null'):
        min_amount = None
    if not name or not product_ids:
        return jsonify({'success': False, 'error': 'Nombre y productos requeridos.'}), 400
    if Coupon.query.filter_by(name=name).first():
        return jsonify({'success': False, 'error': 'Ya existe un cupón con ese nombre.'}), 400
    # Obtener la fecha actual en zona horaria de Colombia
    # Usar módulo centralizado de timezone
    colombia_now = get_colombia_datetime()
    
    coupon = Coupon(
        name=name,
        discount_cop=discount_cop,
        discount_usd=discount_usd,
        duration_days=duration_days,
        max_uses_per_user=max_uses_per_user,
        description=description,
        min_amount=min_amount,
        enabled=True,
        created_at=colombia_now,
        updated_at=colombia_now
    )
    coupon.products = Product.query.filter(Product.id.in_(product_ids)).all()
    db.session.add(coupon)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/coupons/toggle/<int:coupon_id>', methods=['POST'])
@admin_required
def toggle_coupon(coupon_id):
    coupon = Coupon.query.get_or_404(coupon_id)
    coupon.enabled = not coupon.enabled
    db.session.commit()
    return jsonify({'success': True, 'new_state': 'ON' if coupon.enabled else 'OFF', 'new_class': 'action-green' if coupon.enabled else 'action-red'})

@store_bp.route('/admin/coupons/delete/<int:coupon_id>', methods=['POST'])
@admin_required
def delete_coupon(coupon_id):
    coupon = Coupon.query.get_or_404(coupon_id)
    db.session.delete(coupon)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/coupons/edit/<int:coupon_id>', methods=['POST'])
@admin_required
def edit_coupon(coupon_id):
    # Estructura base para editar (puedes expandir luego)
    return jsonify({'success': True, 'message': 'Edición no implementada aún.'})

@store_bp.route('/admin/roles/list', methods=['GET'])
@admin_required
def list_roles():
    roles = Role.query.order_by(Role.id.desc()).all()
    data = []
    for r in roles:
        data.append({
            'id': r.id,
            'name': r.name,
            'enabled': r.enabled,
            'productos': [{'id': p.id, 'name': p.name} for p in r.productos_permitidos],
            'usuarios': [{'id': u.id, 'username': u.username} for u in r.usuarios_vinculados],
            'descuentos': r.descuentos or {}
        })
    return jsonify({'roles': data})

@store_bp.route('/admin/roles/create', methods=['POST'])
@admin_required
def create_role():
    data = request.json
    name = data.get('name', '').strip()
    productos = data.get('productos', [])
    usuarios = data.get('usuarios', [])
    descuentos = data.get('descuentos', {})
    # Permitir tanto lista de IDs como lista de objetos con 'id'
    if productos and isinstance(productos[0], dict) and 'id' in productos[0]:
        productos = [int(p['id']) for p in productos if 'id' in p]
    if not name or not productos:
        return jsonify({'success': False, 'error': 'Nombre y productos requeridos.'}), 400
    if Role.query.filter_by(name=name).first():
        return jsonify({'success': False, 'error': 'Ya existe un rol con ese nombre.'}), 400
    role = Role(
        name=name,
        enabled=True,
        descuentos=descuentos
    )
    role.productos_permitidos = Product.query.filter(Product.id.in_(productos)).all()
    from app.models.user import User
    role.usuarios_vinculados = User.query.filter(User.id.in_(usuarios)).all() if usuarios else []
    db.session.add(role)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/roles/toggle/<int:role_id>', methods=['POST'])
@admin_required
def toggle_role(role_id):
    role = Role.query.get_or_404(role_id)
    role.enabled = not role.enabled
    db.session.commit()
    return jsonify({'success': True, 'new_state': 'ON' if role.enabled else 'OFF', 'new_class': 'action-green' if role.enabled else 'action-red'})

@store_bp.route('/admin/roles/delete/<int:role_id>', methods=['POST'])
@admin_required
def delete_role(role_id):
    role = Role.query.get_or_404(role_id)
    db.session.delete(role)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/roles/edit/<int:role_id>', methods=['GET', 'POST'])
@admin_required
def edit_role(role_id):
    role = Role.query.get_or_404(role_id)
    productos = Product.query.all()
    productos_ids = [p.id for p in role.productos_permitidos] if role.productos_permitidos else []

    if request.method == 'POST':
        if request.is_json:
            data = request.get_json()
            name = data.get('name')
            tipo_precio = data.get('tipo_precio')
            descuentos = data.get('descuentos', {})
            productos_data = data.get('productos', [])

            if not name:
                return jsonify({'success': False, 'error': 'El nombre del rol es requerido'}), 400
            if not tipo_precio:
                return jsonify({'success': False, 'error': 'El tipo de precio es requerido'}), 400

            # Verificar si el tipo de precio cambió
            tipo_precio_cambio = role.tipo_precio != tipo_precio
            tipo_precio_anterior = role.tipo_precio

            # Guardar descuentos generales y por producto
            role.name = name
            role.tipo_precio = tipo_precio
            role.descuentos = {
                'cop': float(descuentos.get('cop', 0) or 0),
                'usd': float(descuentos.get('usd', 0) or 0),
                'productos': descuentos.get('productos', {})
            }

            # Procesar productos seleccionados
            role.productos_permitidos.clear()
            db.session.flush()
            productos_ids = [int(prod['id']) for prod in productos_data]
            role.productos_permitidos = Product.query.filter(Product.id.in_(productos_ids)).all()

            # Validar que el precio final de cada producto sea mayor a 1 en COP y USD
            productos_objs = Product.query.filter(Product.id.in_(productos_ids)).all()
            descuentos_productos = descuentos.get('productos', {})
            errores = []
            for prod in productos_objs:
                cop = float(prod.price_cop)
                usd = float(prod.price_usd)
                d_cop = float(descuentos.get('cop', 0) or 0)
                d_usd = float(descuentos.get('usd', 0) or 0)
                d_extra = descuentos_productos.get(str(prod.id)) or descuentos_productos.get(int(prod.id)) or {}
                d_cop_extra = float(d_extra.get('cop', 0) or 0)
                d_usd_extra = float(d_extra.get('usd', 0) or 0)
                if tipo_precio == 'COP':
                    final_cop = cop - d_cop - d_cop_extra
                    if final_cop <= 0:
                        errores.append(f"El precio final en COP para '{prod.name}' debe ser mayor a 0 (actual: {final_cop})")
                else:
                    final_usd = usd - d_usd - d_usd_extra
                    if final_usd < 0.1:
                        errores.append(f"El precio final en USD para '{prod.name}' debe ser mayor a 0.1 (actual: {final_usd})")
            if errores:
                return jsonify({'success': False, 'error': ' | '.join(errores)}), 400

            # Si el tipo de precio cambió, actualizar usuarios vinculados
            usuarios_afectados = []
            if tipo_precio_cambio:
                from app.models.user import User
                usuarios_vinculados = role.usuarios_vinculados
                for usuario in usuarios_vinculados:
                    usuarios_afectados.append(usuario.username)
                    # Limpiar el saldo de la moneda anterior
                    if tipo_precio_anterior == 'USD':
                        usuario.saldo_usd = 0.0
                    elif tipo_precio_anterior == 'COP':
                        usuario.saldo_cop = 0.0

            try:
                db.session.commit()
                
                # Preparar respuesta con información sobre el cambio
                response_data = {'success': True}
                if tipo_precio_cambio and usuarios_afectados:
                    response_data['warning'] = {
                        'message': f'El tipo de precio cambió de {tipo_precio_anterior} a {tipo_precio}.',
                        'affected_users': usuarios_afectados,
                        'details': f'Se limpió el saldo en {tipo_precio_anterior} de {len(usuarios_afectados)} usuario(s) vinculado(s).'
                    }
                
                return jsonify(response_data)
            except Exception as e:
                db.session.rollback()
                return jsonify({'success': False, 'error': str(e)}), 500

        return jsonify({'success': False, 'error': 'Petición inválida'}), 400

    # --- Al cargar la edición, pasar descuentos individuales a los productos ---
    descuentos_productos = role.descuentos.get('productos', {}) if role.descuentos else {}
    for p in productos:
        d = descuentos_productos.get(str(p.id)) or descuentos_productos.get(int(p.id)) or {}
        p.discount_cop_extra = d.get('cop', 0)
        p.discount_usd_extra = d.get('usd', 0)

    return render_template('edit_role.html', role=role, productos=productos, productos_ids=productos_ids)

@store_bp.route('/admin/cupones', endpoint='admin_coupons')
@admin_required
def admin_coupons():
    products = Product.query.order_by(Product.id.desc()).all()
    return render_template('cupones.html', products=products, title="Cupones de Descuento")

@store_bp.route('/admin/cupones/<int:coupon_id>/editar', methods=['GET', 'POST'])
@admin_required
def editar_cupon(coupon_id):
    from .models import Coupon, Product
    coupon = Coupon.query.get_or_404(coupon_id)
    products = Product.query.order_by(Product.id.desc()).all()
    coupon_product_ids = [p.id for p in coupon.products]
    # Convertir la fecha de creación a zona horaria de Colombia
    created_at_col = None
    if coupon.created_at:
        # Usar módulo centralizado de timezone
        created_at_col = utc_to_colombia(coupon.created_at)
    if request.method == 'POST':
        coupon.name = request.form.get('coupon_name', '').strip()
        coupon.discount_cop = request.form.get('discount_cop', 0)
        coupon.discount_usd = request.form.get('discount_usd', 0)
        coupon.duration_days = request.form.get('duration_days', 1)
        coupon.max_uses_per_user = request.form.get('max_uses_per_user', 1)
        coupon.description = request.form.get('description', '')
        coupon.min_amount = request.form.get('min_amount') or None
        selected_products = request.form.getlist('products')
        coupon.products = Product.query.filter(Product.id.in_(selected_products)).all() if selected_products else []
        try:
            db.session.commit()
            flash('Cupón actualizado correctamente.', 'success')
            return redirect(url_for('store_bp.admin_coupons'))
        except Exception as e:
            db.session.rollback()
            flash('Error al actualizar cupón: ' + str(e), 'danger')
    return render_template('editar_cupon.html', coupon=coupon, products=products, coupon_product_ids=coupon_product_ids, created_at_col=created_at_col)

@store_bp.route('/admin/coupons/update', methods=['POST'])
def update_coupon():
    data = request.get_json()
    coupon_id = data.get('coupon_id')
    coupon = Coupon.query.get_or_404(coupon_id)
    coupon.name = data.get('coupon_name', coupon.name)
    coupon.discount_cop = data.get('discount_cop', coupon.discount_cop)
    coupon.discount_usd = data.get('discount_usd', coupon.discount_usd)
    coupon.duration_days = data.get('duration_days', coupon.duration_days)
    coupon.max_uses_per_user = data.get('max_uses_per_user', coupon.max_uses_per_user)
    coupon.description = data.get('description', coupon.description)
    coupon.min_amount = data.get('min_amount', coupon.min_amount)
    coupon.show_public = bool(data.get('show_public', False))
    # Actualizar productos asociados si es necesario
    product_ids = data.get('products', [])
    if product_ids:
        coupon.products = Product.query.filter(Product.id.in_(product_ids)).all()
    try:
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)})


@store_bp.route('/admin/roles', endpoint='admin_roles')
@admin_required
def admin_roles():
    products = Product.query.order_by(Product.name).all()
    return render_template('roles.html', title="Roles", products=products)

@store_bp.route('/admin/roles/vincular_usuario_ajax', methods=['POST'])
@admin_required
def vincular_usuario_ajax():
    data = request.get_json()
    user_id = data.get('user_id')
    role_id = data.get('role_id')
    vincular = data.get('vincular')
    from app.models.user import User
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado.'}), 404
    role = Role.query.get(role_id)
    if not role:
        return jsonify({'success': False, 'error': 'Rol no encontrado.'}), 404
    # Verificar si el usuario ya está vinculado a algún rol
    roles_actuales = user.roles_tienda if hasattr(user, 'roles_tienda') else []
    if vincular:
        if roles_actuales and roles_actuales[0].id != role.id:
            return jsonify({'success': False, 'error': 'Desvincúlate del otro rol para vincularte aquí.'}), 400
        if role not in user.roles_tienda:
            user.roles_tienda.append(role)
    else:
        if role in user.roles_tienda:
            user.roles_tienda.remove(role)
    try:
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/herramientas')
@admin_required
def admin_tools():
    tools = ToolInfo.query.order_by(ToolInfo.id.desc()).all()
    htmls = HtmlInfo.query.order_by(HtmlInfo.id.desc()).all()
    youtube_listings = YouTubeListing.query.order_by(YouTubeListing.id.desc()).all()
    apis = ApiInfo.query.order_by(ApiInfo.id.desc()).all()
    
    # Limpiar valores "None" string en youtube_listings
    for listing in youtube_listings:
        if listing.content and str(listing.content).strip().lower() == 'none':
            listing.content = None
    try:
        db.session.commit()
    except:
        db.session.rollback()
    
    return render_template('herramientas.html', 
                           tools=tools, 
                           htmls=htmls, 
                           youtube_listings=youtube_listings,
                           apis=apis)

# --- Rutas para Importar/Exportar Configuración de Herramientas ---

def allowed_file(filename):
    """Verifica si el archivo tiene una extensión permitida."""
    ALLOWED_EXTENSIONS = {'json'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@store_bp.route('/admin/herramientas/export_config')
@admin_required
def export_tools_config():
    """Exporta la configuración de herramientas admin a un archivo JSON."""
    submitted_code = request.args.get('security_code')
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE', 'tu_codigo_secreto_aqui')
    
    if not submitted_code or submitted_code != actual_security_code:
        return jsonify({"error": "Código de seguridad incorrecto"}), 401
    
    try:
        # Obtener todos los datos de herramientas
        # No usar selectinload porque las relaciones están definidas con lazy='dynamic'
        tools = ToolInfo.query.all()
        htmls = HtmlInfo.query.all()
        youtube_listings = YouTubeListing.query.all()
        apis = ApiInfo.query.all()
        
        # Convertir a formato serializable
        config_data = {
            "tools": [],
            "htmls": [],
            "youtube_listings": [],
            "apis": []
        }
        
        # Exportar ToolInfo
        for tool in tools:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in tool.usuarios_vinculados.all()]
            tool_dict = {
                "title": tool.title,
                "text": tool.text,
                "percent": tool.percent,
                "enabled": tool.enabled,
                "user_usernames": user_usernames
            }
            config_data["tools"].append(tool_dict)
        
        # Exportar HtmlInfo
        for html in htmls:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in html.users.all()]
            html_dict = {
                "title": html.title,
                "text": html.text,
                "enabled": html.enabled,
                "user_usernames": user_usernames
            }
            config_data["htmls"].append(html_dict)
        
        # Exportar YouTubeListing
        for listing in youtube_listings:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in listing.users.all()]
            # Cargar production_links usando la relación lazy='dynamic'
            production_links = [
                {
                    "url": link.url,
                    "title": link.title
                }
                for link in listing.production_links.all()
            ]
            listing_dict = {
                "title": listing.title,
                "content": listing.content if listing.content else None,
                "enabled": listing.enabled,
                "user_usernames": user_usernames,
                "production_links": production_links
            }
            config_data["youtube_listings"].append(listing_dict)
        
        # Exportar ApiInfo
        for api in apis:
            # Cargar usuarios usando la relación lazy='dynamic'
            user_usernames = [u.username for u in api.users.all()]
            api_dict = {
                "title": api.title,
                "api_key": api.api_key,
                "api_type": api.api_type,
                "api_url": api.api_url,
                "enabled": api.enabled,
                "drive_subtitle_photos": api.drive_subtitle_photos,
                "drive_subtitle_videos": api.drive_subtitle_videos,
                "user_usernames": user_usernames
            }
            config_data["apis"].append(api_dict)
        
        # Convertir a JSON
        def default_serializer(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            raise TypeError(f"Object of type {obj.__class__.__name__} is not JSON serializable")
        
        json_data = json.dumps(config_data, indent=2, ensure_ascii=False, default=default_serializer)
        
        # Crear la respuesta Flask
        response = Response(json_data, mimetype='application/json')
        response.headers['Content-Disposition'] = 'attachment; filename=herramientas_configuracion_exportada.json'
        return response
        
    except Exception as e:
        current_app.logger.error(f"Error al exportar configuración de herramientas: {e}")
        flash('Error al generar el archivo de configuración.', 'danger')
        return jsonify({"error": "Error interno al generar el archivo"}), 500

@store_bp.route('/admin/herramientas/import_config', methods=['POST'])
@admin_required
def import_tools_config():
    """Importa configuración de herramientas desde un archivo JSON."""
    # 1. Verificar código de seguridad
    submitted_code = request.form.get('security_code', '').strip()
    actual_security_code = current_app.config.get('ADMIN_CONFIG_SECURITY_CODE')
    
    if not actual_security_code or actual_security_code == 'tu_codigo_secreto_aqui':
        current_app.logger.error("¡El código de seguridad ADMIN_CONFIG_SECURITY_CODE no está configurado correctamente en config.py!")
        flash('Error de configuración interna del servidor (código de seguridad).', 'danger')
        return redirect(url_for('store_bp.admin_tools'))
    
    if submitted_code != str(actual_security_code):
        flash('Código de seguridad incorrecto.', 'danger')
        return redirect(url_for('store_bp.admin_tools'))
    
    # 2. Verificar archivo
    if 'config_file' not in request.files:
        flash('No se seleccionó ningún archivo.', 'warning')
        return redirect(url_for('store_bp.admin_tools'))
    file = request.files['config_file']
    if file.filename == '' or not allowed_file(file.filename):
        flash('Archivo no válido o tipo incorrecto (solo .json).', 'warning')
        return redirect(url_for('store_bp.admin_tools'))
    
    try:
        file_content = file.read().decode('utf-8')
        config_data = json.loads(file_content)
        
        # --- BORRAR DATOS EXISTENTES ANTES DE IMPORTAR ---
        # Importar tablas de asociación
        from app.store.models import toolinfo_users, htmlinfo_users, youtube_listing_users, apiinfo_users, ProductionLink
        
        # Borrar tablas de asociación primero
        db.session.execute(toolinfo_users.delete())
        db.session.execute(htmlinfo_users.delete())
        db.session.execute(youtube_listing_users.delete())
        db.session.execute(apiinfo_users.delete())
        
        # Borrar ProductionLink (tiene FK a YouTubeListing)
        ProductionLink.query.delete()
        
        # Borrar registros principales
        from app.store.models import ToolInfo, HtmlInfo, YouTubeListing, ApiInfo
        ToolInfo.query.delete()
        HtmlInfo.query.delete()
        YouTubeListing.query.delete()
        ApiInfo.query.delete()
        
        db.session.flush()  # Aplicar borrados antes de crear nuevos
        
        # Obtener todos los usuarios existentes por username para mapeo
        existing_users = {u.username: u for u in User.query.all()}
        
        # 3. Importar ToolInfo (siempre procesar, incluso si está vacío)
        tools_data = config_data.get('tools', [])
        if tools_data:
            for tool_data in tools_data:
                new_tool = ToolInfo(
                    title=tool_data.get('title'),
                    text=tool_data.get('text'),
                    percent=tool_data.get('percent', 0),
                    enabled=tool_data.get('enabled', True)
                )
                db.session.add(new_tool)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = tool_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_tool.usuarios_vinculados.append(existing_users[username])
        
        # 4. Importar HtmlInfo (siempre procesar, incluso si está vacío)
        htmls_data = config_data.get('htmls', [])
        if htmls_data:
            for html_data in htmls_data:
                new_html = HtmlInfo(
                    title=html_data.get('title'),
                    text=html_data.get('text'),
                    enabled=html_data.get('enabled', True)
                )
                db.session.add(new_html)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = html_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_html.users.append(existing_users[username])
        
        # 5. Importar YouTubeListing (siempre procesar, incluso si está vacío)
        youtube_listings_data = config_data.get('youtube_listings', [])
        if youtube_listings_data:
            for listing_data in youtube_listings_data:
                new_listing = YouTubeListing(
                    title=listing_data.get('title'),
                    content=listing_data.get('content'),
                    enabled=listing_data.get('enabled', True)
                )
                db.session.add(new_listing)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = listing_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_listing.users.append(existing_users[username])
                
                # Importar production_links
                production_links = listing_data.get('production_links', [])
                for link_data in production_links:
                    new_link = ProductionLink(
                        url=link_data.get('url'),
                        title=link_data.get('title'),
                        youtube_listing_id=new_listing.id
                    )
                    db.session.add(new_link)
        
        # 6. Importar ApiInfo (siempre procesar, incluso si está vacío)
        apis_data = config_data.get('apis', [])
        if apis_data:
            for api_data in apis_data:
                new_api = ApiInfo(
                    title=api_data.get('title'),
                    api_key=api_data.get('api_key'),
                    api_type=api_data.get('api_type'),
                    api_url=api_data.get('api_url'),
                    enabled=api_data.get('enabled', True),
                    drive_subtitle_photos=api_data.get('drive_subtitle_photos'),
                    drive_subtitle_videos=api_data.get('drive_subtitle_videos')
                )
                db.session.add(new_api)
                db.session.flush()
                
                # Vincular usuarios solo si existen y son los mismos
                user_usernames = api_data.get('user_usernames', [])
                for username in user_usernames:
                    if username in existing_users:
                        new_api.users.append(existing_users[username])
        
        db.session.commit()
        flash('Configuración de herramientas importada correctamente.', 'success')
        
    except json.JSONDecodeError:
        db.session.rollback()
        flash('Error: El archivo no es un JSON válido.', 'danger')
    except KeyError as e:
        db.session.rollback()
        flash(f'Error: Falta la clave "{e}" en el archivo JSON.', 'danger')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al importar configuración de herramientas: {e}", exc_info=True)
        flash(f'Error al importar configuración: {e}', 'danger')
    
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/herramientas', methods=['POST'], endpoint='create_tool')
@admin_required
def create_tool():
    title = request.form.get('title')
    text = request.form.get('text')
    try:
        percent = float(request.form.get('percent', 0))
    except Exception:
        percent = 0
    if not title or not text:
        flash('Todos los campos son requeridos.', 'error')
        return redirect(url_for('store_bp.admin_tools'))
    tool = ToolInfo(title=title, text=text, percent=percent, enabled=True)
    db.session.add(tool)
    try:
        db.session.commit()
        flash('Herramienta creada correctamente.', 'success')
    except Exception as e:
        db.session.rollback()
        flash('Error al crear la herramienta: ' + str(e), 'error')
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/api/create', methods=['POST'])
@admin_required
def create_api():
    title = request.form.get('title')
    api_key = request.form.get('api_key')
    api_type = request.form.get('api_type')

    if not title or not api_key:
        flash('El título y la clave de API son obligatorios.', 'danger')
        return redirect(url_for('store_bp.admin_tools'))

    # Guardar el ID de carpeta y subtítulos solo si es Drive
    api_url = None
    drive_subtitle_photos = None
    drive_subtitle_videos = None
    if api_type == 'Drive':
        api_url = request.form.get('api_url', '').strip()
        drive_subtitle_photos = request.form.get('drive_subtitle_photos', '').strip()
        drive_subtitle_videos = request.form.get('drive_subtitle_videos', '').strip()

    new_api = ApiInfo(
        title=title,
        api_key=api_key,
        api_type=api_type,
        api_url=api_url,
        drive_subtitle_photos=drive_subtitle_photos,
        drive_subtitle_videos=drive_subtitle_videos
    )
    db.session.add(new_api)
    db.session.commit()

    flash('API creada correctamente.', 'success')
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/api/<int:api_id>/edit', methods=['GET'])
@admin_required
def edit_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    return render_template('edit_api.html', api=api)

@store_bp.route('/admin/api/<int:api_id>/edit', methods=['POST'])
@admin_required
def update_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    title = request.form.get('title')
    api_key = request.form.get('api_key')
    api_type = request.form.get('api_type')  # Obtener el nuevo campo

    if not title or not api_key:
        flash('El título y la clave de API son obligatorios.', 'danger')
        return render_template('edit_api.html', api=api)

    api.title = title
    api.api_key = api_key
    api.api_type = api_type  # Guardar el nuevo campo
    
    # Guardar el ID de carpeta y subtítulos solo si es Drive
    if api_type == 'Drive':
        api.api_url = request.form.get('api_url', '').strip()
        api.drive_subtitle_photos = request.form.get('drive_subtitle_photos', '').strip()
        api.drive_subtitle_videos = request.form.get('drive_subtitle_videos', '').strip()
    else:
        api.api_url = None
        api.drive_subtitle_photos = None
        api.drive_subtitle_videos = None
    
    # Vincular usuarios
    user_ids = request.form.getlist('user_ids')
    if user_ids:
        users_to_link = User.query.filter(User.id.in_(user_ids)).all()
        api.users = users_to_link
    else:
        api.users = []

    db.session.commit()

    flash('API actualizada correctamente.', 'success')
    return redirect(url_for('store_bp.edit_api', api_id=api.id))

@store_bp.route('/admin/api/<int:api_id>/users', methods=['GET'])
@admin_required
def get_api_users(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_str = request.args.get('per_page', '5')
    per_page = None if per_page_str == 'all' else int(per_page_str)
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    if per_page:
        pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
        users_for_page = pagination.items
        total_pages = pagination.pages
        has_next = pagination.has_next
        has_prev = pagination.has_prev
    else:
        users_for_page = users_query.all()
        total_pages = 1
        has_next = False
        has_prev = False

    users_data = [{
            'id': user.id,
            'username': user.username,
        'name': user.full_name or '',
    } for user in users_for_page]
    
    linked_user_ids = {user.id for user in api.users}

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': len(users_data),
            'pages': total_pages,
            'has_prev': has_prev,
            'has_next': has_next,
        },
        'linked_user_ids': list(linked_user_ids)
    })

@store_bp.route('/admin/api/<int:api_id>/toggle', methods=['POST'])
@admin_required
def toggle_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    api.enabled = not api.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if api.enabled else 'ON',
        'new_class': 'action-red' if api.enabled else 'action-green'
    })

@store_bp.route('/admin/api/<int:api_id>/delete', methods=['POST'])
@admin_required
def delete_api(api_id):
    api = ApiInfo.query.get_or_404(api_id)
    db.session.delete(api)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/youtube_listing', methods=['POST'])
@admin_required
def create_youtube_listing():
    title = request.form.get('title')
    content = request.form.get('youtube_content', '').strip() or None
    if not title:
        flash('El título es requerido.', 'error')
        return redirect(url_for('store_bp.admin_tools'))
    
    new_listing = YouTubeListing(title=title, content=content, enabled=True)
    db.session.add(new_listing)
    try:
        db.session.commit()
        flash('Listado de YouTube creado correctamente.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al crear el listado de YouTube: {e}', 'error')
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/youtube_listing/<int:listing_id>/toggle', methods=['POST'])
@admin_required
def toggle_youtube_listing(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    listing.enabled = not listing.enabled
    db.session.commit()
    return jsonify({
        'success': True,
        'new_state': 'OFF' if listing.enabled else 'ON',
        'new_class': 'action-red' if listing.enabled else 'action-green'
    })

@store_bp.route('/admin/youtube_listing/<int:listing_id>/delete', methods=['POST'])
@admin_required
def delete_youtube_listing(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    db.session.delete(listing)
    db.session.commit()
    return jsonify({'success': True})

@store_bp.route('/admin/youtube_listing/<int:listing_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_youtube_listing(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    if request.method == 'POST':
        listing.title = request.form.get('title', listing.title)
        # Si el campo content viene en el formulario, actualizarlo (incluso si está vacío)
        if 'content' in request.form:
            content = request.form.get('content', '').strip()
            # Limpiar cualquier valor "None" como string y convertir a None si está vacío
            if content.lower() == 'none' or not content:
                listing.content = None
            else:
                listing.content = content
        # Preservar el estado enabled: si viene en el formulario, usar ese valor; si no, mantener el actual
        enabled_value = request.form.get('enabled')
        if enabled_value is not None:
            # Si viene 'on', 'true', '1' o 'yes', es True; cualquier otra cosa es False
            listing.enabled = enabled_value.lower() in ('on', 'true', '1', 'yes')
        # Si no viene el campo, mantener el estado actual (no cambiar nada)
        
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str if uid.isdigit()]
        
        listing.users = User.query.filter(User.id.in_(user_ids)).all() if user_ids else []

        try:
            db.session.commit()
            flash('Listado de YouTube actualizado correctamente.', 'success')
            return redirect(url_for('store_bp.admin_tools'))
        except Exception as e:
            db.session.rollback()
            flash(f'Error al actualizar el listado: {str(e)}', 'danger')
    
    return render_template('edit_youtube_listing.html', listing=listing, title="Editar Listado de YouTube")

@store_bp.route('/admin/youtube_listing/<int:listing_id>/links', methods=['GET'])
@admin_required
def get_youtube_listing_links(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    links = [{'id': link.id, 'url': link.url, 'title': link.title} for link in listing.production_links]
    return jsonify(links)

@store_bp.route('/admin/youtube_listing/<int:listing_id>/add_link', methods=['POST'])
@admin_required
def add_youtube_listing_link(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    url = request.json.get('url')
    title = request.json.get('title') # Puede ser None
    if not url:
        return jsonify({'success': False, 'error': 'URL requerida'}), 400
    
    # Simplemente guardamos el link, con o sin título.
    link = ProductionLink(url=url, title=title, youtube_listing_id=listing.id)
    db.session.add(link)
    db.session.commit()
    
    return jsonify({'success': True, 'link_id': link.id})

@store_bp.route('/admin/youtube_listing/link/<int:link_id>', methods=['DELETE', 'PUT'])
@admin_required
def manage_youtube_listing_link(link_id):
    link = ProductionLink.query.get_or_404(link_id)

    if request.method == 'DELETE':
        db.session.delete(link)
        db.session.commit()
        return jsonify({'success': True})

    if request.method == 'PUT':
        new_url = request.json.get('url')
        new_title = request.json.get('title') # Puede ser None
        if not new_url:
            return jsonify({'success': False, 'error': 'URL requerida'}), 400
        link.url = new_url
        link.title = new_title
        db.session.commit()
        return jsonify({'success': True})

@store_bp.route('/admin/youtube_listing/<int:listing_id>/users', methods=['GET'])
@admin_required
def get_youtube_listing_users(listing_id):
    listing = YouTubeListing.query.get_or_404(listing_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Manejar el caso especial de "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        linked_user_ids = [user.id for user in listing.users]

        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
            },
            'linked_user_ids': linked_user_ids
        })
    else:
        per_page = int(per_page_param)
        pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    linked_user_ids = [user.id for user in listing.users]

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
        },
        'linked_user_ids': linked_user_ids
    })

@store_bp.route('/admin/pagos', endpoint='admin_payments')
@admin_required
def admin_payments():
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    # Solo usuarios principales (no admin, no sub-usuarios) y que tengan al menos un rol vinculado
    users = User.query.filter(
        User.username != admin_user,
        User.parent_id == None,
        User.roles_tienda.any()
    ).order_by(User.username.desc()).all()
    users_with_tipo_precio = []
    for u in users:
        tipo_precio = 'usd'
        if hasattr(u, 'roles_tienda') and u.roles_tienda and len(u.roles_tienda) > 0:
            raw_tipo_precio = u.roles_tienda[0].tipo_precio
            if raw_tipo_precio and raw_tipo_precio.strip().lower() in ['usd', 'cop']:
                tipo_precio = raw_tipo_precio.strip().lower()
            elif raw_tipo_precio and raw_tipo_precio.strip().upper() in ['USD', 'COP']:
                tipo_precio = raw_tipo_precio.strip().lower()
        users_with_tipo_precio.append({
            'id': u.id,
            'username': u.username,
            'full_name': u.full_name or '',
            'saldo_usd': u.saldo_usd or 0,
            'saldo_cop': u.saldo_cop or 0,
            'tipo_precio': tipo_precio
        })
    return render_template('pagos.html', title="Pagos", users=users_with_tipo_precio)

@store_bp.route('/herramientas-public', endpoint='tools_public')
def tools_public():
    user = None
    username = session.get("username") # Para admin
    user_id = session.get("user_id") # Para usuarios normales

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username

    if not user:
        flash("Debes iniciar sesión para ver esta página.", "warning")
        return redirect(url_for("user_auth_bp.login"))

    admin_user = current_app.config.get("ADMIN_USER", "admin")
    if username == admin_user:
        tools = ToolInfo.query.filter_by(enabled=True).order_by(ToolInfo.id.desc()).all()
    else:
        tools = ToolInfo.query.join(ToolInfo.usuarios_vinculados).filter(
            User.id == user.id, 
            ToolInfo.enabled == True
        ).order_by(ToolInfo.id.desc()).all()

    # Cargar contenidos HTML según los permisos del usuario
    if username == admin_user:
        html_contents = HtmlInfo.query.filter_by(enabled=True).order_by(HtmlInfo.id.desc()).all()
    else:
        html_contents = HtmlInfo.query.join(HtmlInfo.users).filter(
            User.id == user.id,
            HtmlInfo.enabled == True
        ).order_by(HtmlInfo.id.desc()).all()

    # Cargar APIs según los permisos del usuario
    if username == admin_user:
        apis = ApiInfo.query.filter_by(enabled=True).order_by(ApiInfo.id.desc()).all()
        drive_apis = ApiInfo.query.filter_by(api_type="Drive", enabled=True).order_by(ApiInfo.id.desc()).all()
    else:
        apis = ApiInfo.query.join(ApiInfo.users).filter(
            User.id == user.id,
            ApiInfo.enabled == True
        ).order_by(ApiInfo.id.desc()).all()
        drive_apis = ApiInfo.query.join(ApiInfo.users).filter(
            User.id == user.id,
            ApiInfo.api_type == "Drive",
            ApiInfo.enabled == True
        ).order_by(ApiInfo.id.desc()).all()

    # Cargar videos de producción según los permisos del usuario
    if username == admin_user:
        youtube_listings = YouTubeListing.query.filter_by(enabled=True).order_by(YouTubeListing.id.desc()).all()
    else:
        youtube_listings = YouTubeListing.query.join(YouTubeListing.users).filter(
            User.id == user.id,
            YouTubeListing.enabled == True
        ).order_by(YouTubeListing.id.desc()).all()

    return render_template('herramientas_public.html',
                           tools=tools,
                           html_contents=html_contents,
                           apis=apis,
                           youtube_listings=youtube_listings,
                           drive_apis=drive_apis,
                           title="Consulta de Códigos",
                           ADMIN_USER=admin_user,
                           current_user=user,
                           username=username)

@store_bp.route('/admin/herramientas/toggle/<int:tool_id>', methods=['POST'], endpoint='toggle_tool')
@admin_required
def toggle_tool(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    if not hasattr(tool, 'enabled'):
        tool.enabled = True
    tool.enabled = not tool.enabled
    db.session.commit()
    flash(f"Estado de '{tool.title}' cambiado.", "success")
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/herramientas/delete/<int:tool_id>', methods=['POST'], endpoint='delete_tool')
@admin_required
def delete_tool(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    db.session.delete(tool)
    db.session.commit()
    flash(f"'{tool.title}' eliminado.", "success")
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/herramientas/editar/<int:tool_id>', methods=['GET', 'POST'], endpoint='edit_tool')
@admin_required
def edit_tool(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    admin_username = current_app.config.get('ADMIN_USER')

    if request.method == 'POST':
        tool.title = request.form.get('title', tool.title)
        tool.text = request.form.get('text', tool.text)
        try:
            tool.percent = float(request.form.get('percent', tool.percent))
        except Exception:
            pass
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str]

        # Desvincular usuarios que ya no están seleccionados
        current_linked_users = tool.usuarios_vinculados.all()
        for user in current_linked_users:
            if user.id not in user_ids and user.username != admin_username:
                tool.usuarios_vinculados.remove(user)

        # Vincular nuevos usuarios
        for user_id in user_ids:
            user = User.query.get(user_id)
            if user and user not in current_linked_users and user.username != admin_username:
                tool.usuarios_vinculados.append(user)
        
        db.session.commit()
        flash('Herramienta actualizada y usuarios vinculados.', 'success')
        return redirect(url_for('store_bp.admin_tools'))

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 5, type=int)
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    users = pagination.items

    return render_template('editar_herramienta.html',
                           tool=tool,
                           users=users,
                           pagination=pagination,
                           search_query=search_query,
                           per_page=per_page)

@store_bp.route('/admin/herramientas/<int:tool_id>/usuarios', methods=['GET'], endpoint='get_tool_users')
@admin_required
def get_tool_users(tool_id):
    tool = ToolInfo.query.get_or_404(tool_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Manejar el caso cuando per_page es "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        linked_user_ids = [user.id for user in tool.usuarios_vinculados.all()]
        
        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
                'prev_num': None,
                'next_num': None
            },
            'linked_user_ids': linked_user_ids
        })
    
    # Caso normal con paginación
    per_page = int(per_page_param)
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    linked_user_ids = [user.id for user in tool.usuarios_vinculados.all()]

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
            'prev_num': pagination.prev_num,
            'next_num': pagination.next_num
        },
        'linked_user_ids': linked_user_ids
    })

@store_bp.route('/admin/html', methods=['POST'])
@admin_required
def add_html():
    if not request.form.get('title') or not request.form.get('text'):
        flash('Todos los campos son requeridos.', 'error')
        return redirect(url_for('store_bp.admin_tools'))
    
    html = HtmlInfo(
        title=request.form.get('title'),
        text=request.form.get('text')
    )
    db.session.add(html)
    try:
        db.session.commit()
        flash('HTML agregado correctamente.', 'success')
    except:
        db.session.rollback()
        flash('Error al agregar el HTML.', 'error')
    
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/html/<int:html_id>/toggle', methods=['POST'])
@admin_required
def toggle_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    html.enabled = not html.enabled
    try:
        db.session.commit()
        return jsonify({
            'success': True,
            'new_state': 'OFF' if html.enabled else 'ON',
            'new_class': 'action-red' if html.enabled else 'action-green',
            'message': 'Estado actualizado correctamente.'
        })
    except:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error al actualizar el estado.'})

@store_bp.route('/admin/html/<int:html_id>/delete', methods=['POST'])
@admin_required
def delete_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    try:
        db.session.delete(html)
        db.session.commit()
        return jsonify({'success': True, 'message': 'HTML eliminado correctamente.'})
    except:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error al eliminar el HTML.'})

@store_bp.route('/admin/html/<int:html_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    admin_username = current_app.config.get('ADMIN_USER')

    if request.method == 'POST':
        html.title = request.form.get('title', html.title)
        html.text = request.form.get('text', html.text)
        
        user_ids_str = request.form.getlist('user_ids')
        user_ids = [int(uid) for uid in user_ids_str]

        # Desvincular y vincular usuarios
        if user_ids:
            new_users = User.query.filter(User.id.in_(user_ids)).all()
            html.users = new_users
        else:
            html.users = [] # Desvincula a todos si no se selecciona ninguno
        
        db.session.commit()
        flash('HTML actualizado y usuarios vinculados.', 'success')
        return redirect(url_for('store_bp.admin_tools'))

    # Lógica para GET
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 5, type=int)
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    users = pagination.items

    return render_template('edit_html.html',
                           html=html,
                           users=users,
                           pagination=pagination,
                           search_query=search_query,
                           per_page=per_page)

@store_bp.route('/admin/html/<int:html_id>/update', methods=['POST'])
@admin_required
def update_html(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    if not request.form.get('title') or not request.form.get('text'):
        flash('Todos los campos son requeridos.', 'error')
        return redirect(url_for('store_bp.edit_html', html_id=html_id))
    
    html.title = request.form.get('title')
    html.text = request.form.get('text')
    try:
        db.session.commit()
        flash('HTML actualizado correctamente.', 'success')
    except:
        db.session.rollback()
        flash('Error al actualizar el HTML.', 'error')
    
    return redirect(url_for('store_bp.admin_tools'))

@store_bp.route('/admin/html/<int:html_id>/users', methods=['GET'])
@admin_required
def get_html_users(html_id):
    html = HtmlInfo.query.get_or_404(html_id)
    admin_username = current_app.config.get('ADMIN_USER')

    page = request.args.get('page', 1, type=int)
    per_page_param = request.args.get('per_page', '5')
    search_query = request.args.get('search', '')

    users_query = User.query.filter(User.username != admin_username, User.parent_id == None)
    if search_query:
        users_query = users_query.filter(User.username.ilike(f'%{search_query}%'))
    
    # Manejar el caso cuando per_page es "all"
    if per_page_param == 'all':
        users = users_query.all()
        users_data = [{
            'id': user.id,
            'username': user.username,
            'full_name': user.full_name or ''
        } for user in users]
        
        linked_user_ids = [user.id for user in html.users]
        
        return jsonify({
            'users': users_data,
            'pagination': {
                'page': 1,
                'per_page': len(users),
                'total': len(users),
                'pages': 1,
                'has_prev': False,
                'has_next': False,
                'prev_num': None,
                'next_num': None
            },
            'linked_user_ids': linked_user_ids
        })
    
    # Caso normal con paginación
    per_page = int(per_page_param)
    pagination = users_query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name or ''
    } for user in pagination.items]
    
    linked_user_ids = [user.id for user in html.users]

    return jsonify({
        'users': users_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next,
            'prev_num': pagination.prev_num,
            'next_num': pagination.next_num
        },
        'linked_user_ids': linked_user_ids
    }) 

@store_bp.route('/tools/find-media', methods=['POST'])
def find_media():
    try:
        user = None
        username = session.get("username")
        user_id = session.get("user_id")

        if username:
            user = User.query.filter_by(username=username).first()
        elif user_id:
            user = User.query.get(user_id)

        if not user:
            return jsonify({'error': 'No autorizado'}), 401

        api = ApiInfo.query.filter_by(api_type="Búsqueda de Medios", enabled=True).first()
        if not api:
            return jsonify({'error': 'No hay ninguna API de "Búsqueda de Medios" configurada o habilitada.'}), 500

        query = request.json.get('query')
        country = request.json.get('country', 'CO')
        if not query:
            return jsonify({'error': 'Se requiere una consulta de búsqueda.'}), 400

        claves = {}
        for parte in api.api_key.split(','):
            if ':' in parte:
                k, v = parte.split(':', 1)
                claves[k.strip().lower()] = v.strip()

        # Definir qué APIs soportan qué países
        tmdb_supported_countries = {
            'CO', 'US', 'ES', 'MX', 'AR', 'BR', 'FR', 'DE', 'IT', 'GB', 'CA', 'AU', 'NZ', 
            'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'RO', 'BG', 
            'HR', 'SI', 'SK', 'EE', 'LV', 'LT', 'PT', 'IE', 'GR', 'CY', 'MT', 'LU', 'IS',
            'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'GT', 'SV', 'HN', 'NI',
            'DO', 'PR', 'CU', 'JM', 'TT', 'GY', 'SR', 'GF', 'FK', 'ZA', 'EG', 'MA', 'TN',
            'DZ', 'LY', 'SD', 'ET', 'KE', 'NG', 'GH', 'CI', 'SN', 'ML', 'BF', 'NE', 'TD',
            'CM', 'CF', 'CG', 'CD', 'GA', 'GQ', 'ST', 'AO', 'ZM', 'ZW', 'BW', 'NA', 'LS',
            'SZ', 'MG', 'MU', 'SC', 'KM', 'DJ', 'SO', 'ER', 'SS', 'UG', 'RW', 'BI', 'TZ',
            'MZ', 'MW'
        }

        results = []
        errors = []
        apis_consultadas = []

        # TMDb - Solo si el país está soportado
        if 'tmdb' in claves and claves['tmdb'] and country in tmdb_supported_countries:
            try:
                api_key = claves['tmdb']
                # Mapeo de países a idiomas para TMDb
                language_map = {
                    'CO': 'es-CO', 'ES': 'es-ES', 'MX': 'es-MX', 'AR': 'es-AR', 'VE': 'es-VE',
                    'PE': 'es-PE', 'CL': 'es-CL', 'EC': 'es-EC', 'BO': 'es-BO', 'PY': 'es-PY',
                    'UY': 'es-UY', 'CR': 'es-CR', 'PA': 'es-PA', 'GT': 'es-GT', 'SV': 'es-SV',
                    'HN': 'es-HN', 'NI': 'es-NI', 'DO': 'es-DO', 'PR': 'es-PR', 'CU': 'es-CU',
                    'US': 'en-US', 'GB': 'en-GB', 'CA': 'en-CA', 'AU': 'en-AU', 'NZ': 'en-NZ',
                    'IE': 'en-IE', 'FR': 'fr-FR', 'BE': 'fr-BE', 'CH': 'fr-CH', 'LU': 'fr-LU',
                    'DE': 'de-DE', 'AT': 'de-AT', 'IT': 'it-IT', 'PT': 'pt-PT', 'BR': 'pt-BR',
                    'NL': 'nl-NL', 'SE': 'sv-SE', 'NO': 'no-NO', 'DK': 'da-DK', 'FI': 'fi-FI',
                    'PL': 'pl-PL', 'CZ': 'cs-CZ', 'HU': 'hu-HU', 'RO': 'ro-RO', 'BG': 'bg-BG',
                    'HR': 'hr-HR', 'SI': 'sl-SI', 'SK': 'sk-SK', 'EE': 'et-EE', 'LV': 'lv-LV',
                    'LT': 'lt-LT', 'GR': 'el-GR', 'CY': 'el-CY', 'MT': 'mt-MT', 'IS': 'is-IS'
                }
                language = language_map.get(country, 'en-US')
                
                search_url = f"https://api.themoviedb.org/3/search/multi?api_key={api_key}&language={language}&query={query}"
                search_response = requests.get(search_url)
                search_response.raise_for_status()
                search_results = search_response.json().get('results', [])
                
                if search_results:
                    media = search_results[0]
                    media_id = media.get('id')
                    media_type = media.get('media_type')
                    if media_id and media_type in ['movie', 'tv']:
                        details_url = f"https://api.themoviedb.org/3/{media_type}/{media_id}?api_key={api_key}&language={language}&append_to_response=watch/providers"
                        details_response = requests.get(details_url)
                        details_response.raise_for_status()
                        details = details_response.json()
                        providers = details.get('watch/providers', {}).get('results', {}).get(country, {}).get('flatrate', [])
                        results.append({
                            'title': details.get('title') or details.get('name'),
                            'overview': details.get('overview'),
                            'poster_path': f"https://image.tmdb.org/t/p/w500{details.get('poster_path')}" if details.get('poster_path') else None,
                            'providers': [{'name': p['provider_name'], 'logo_path': f"https://image.tmdb.org/t/p/w92{p['logo_path']}"} for p in providers],
                            'source': 'TMDb'
                        })
                        apis_consultadas.append('TMDb')
            except Exception as e:
                errors.append(f"TMDb: {str(e)}")

        # Si no hay resultados, devolver mensaje simple (200 en lugar de 404 para que el JS lo maneje correctamente)
        if not results:
            return jsonify({
                'error': 'No se encontraron resultados o esta mal escrito el nombre.',
                'results': [],
                'errors': errors,
                'apis_consultadas': apis_consultadas,
                'pais_seleccionado': country
            }), 200

        return jsonify({
            'results': results, 
            'errors': errors, 
            'apis_consultadas': apis_consultadas,
            'pais_seleccionado': country
        })
    except Exception as e:
        import traceback
        return jsonify({'error': f'Error interno: {str(e)}'}), 500

@store_bp.route('/tools/http-request', methods=['POST'])
def http_request():
    import requests
    from flask import request, jsonify, session
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify({'error': 'Se requiere una URL.'}), 400

    try:
        response = requests.get(url, timeout=7)
        result = {
            'status_code': response.status_code,
            'headers': dict(response.headers),
            'body': response.text[:2000]  # Limitar tamaño de respuesta
        }
        return jsonify({'result': result})
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la URL: {str(e)}'}), 500 

@store_bp.route('/tools/db-query', methods=['POST'])
def db_query():
    from flask import request, jsonify, session, current_app
    from sqlalchemy import text
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    admin_username = current_app.config.get("ADMIN_USER", "admin")
    data = request.get_json()
    sql = data.get('sql')
    api_id = data.get('api_id')
    if not sql or not sql.strip().lower().startswith('select'):
        return jsonify({'error': 'Solo se permiten consultas SELECT.'}), 400

    # Permitir solo admin o usuarios principales vinculados a la API
    if not user:
        return jsonify({'error': 'No autorizado'}), 401
    if user.username == admin_username:
        pass  # admin siempre puede
    else:
        # Sub-usuarios no pueden
        if getattr(user, 'parent_id', None):
            return jsonify({'error': 'No autorizado para sub-usuarios.'}), 403
        # Debe estar vinculado a la API
        from app.store.models import ApiInfo
        api = ApiInfo.query.get(api_id)
        if not api or api.api_type != 'APIs de Base de Datos' or user not in api.users:
            return jsonify({'error': 'No autorizado para esta API.'}), 403

    try:
        result = db.session.execute(text(sql))
        columns = result.keys()
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        return jsonify({'columns': list(columns), 'rows': rows})
    except Exception as e:
        return jsonify({'error': f'Error al ejecutar la consulta: {str(e)}'}), 500

@store_bp.route('/tools/weather', methods=['POST'])
def get_weather():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de OpenWeatherMap de la base de datos
    weather_api_info = ApiInfo.query.filter_by(api_type="Clima", enabled=True).first()
    if not weather_api_info:
        return jsonify({'error': 'No hay una API de "Clima" configurada o habilitada.'}), 500
    
    api_key = weather_api_info.api_key
    
    data = request.get_json()
    city = data.get('city')
    if not city:
        return jsonify({'error': 'Se requiere una ciudad.'}), 400

    try:
        # Consultar la API de OpenWeatherMap
        url = f"http://api.openweathermap.org/data/2.5/weather"
        params = {
            'q': city,
            'appid': api_key,
            'units': 'metric',  # Para obtener temperatura en Celsius
            'lang': 'es'  # Para obtener descripción en español
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        weather_data = response.json()

        # Extraer información relevante
        result = {
            'city': weather_data.get('name'),
            'country': weather_data.get('sys', {}).get('country'),
            'temperature': round(weather_data.get('main', {}).get('temp', 0)),
            'feels_like': round(weather_data.get('main', {}).get('feels_like', 0)),
            'humidity': weather_data.get('main', {}).get('humidity', 0),
            'pressure': weather_data.get('main', {}).get('pressure', 0),
            'description': weather_data.get('weather', [{}])[0].get('description', ''),
            'icon': weather_data.get('weather', [{}])[0].get('icon', ''),
            'wind_speed': round(weather_data.get('wind', {}).get('speed', 0) * 3.6, 1),  # Convertir m/s a km/h
            'visibility': weather_data.get('visibility', 0) / 1000 if weather_data.get('visibility') else 0  # Convertir metros a km
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API del clima: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/currency', methods=['POST'])
def convert_currency():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de ExchangeRate-API de la base de datos
    currency_api_info = ApiInfo.query.filter_by(api_type="Moneda", enabled=True).first()
    if not currency_api_info:
        return jsonify({'error': 'No hay una API de "Moneda" configurada o habilitada.'}), 500
    
    api_key = currency_api_info.api_key
    
    data = request.get_json()
    amount = data.get('amount')
    from_currency = data.get('from_currency')
    to_currency = data.get('to_currency')
    
    if not amount or not from_currency or not to_currency:
        return jsonify({'error': 'Se requiere cantidad, moneda origen y moneda destino.'}), 400

    try:
        # Consultar la API de ExchangeRate-API
        url = f"https://v6.exchangerate-api.com/v6/{api_key}/pair/{from_currency.upper()}/{to_currency.upper()}"
        
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        currency_data = response.json()

        if currency_data.get('result') != 'success':
            return jsonify({'error': 'Error en la conversión de moneda.'}), 500

        # Calcular la conversión
        conversion_rate = currency_data.get('conversion_rate', 0)
        converted_amount = float(amount) * conversion_rate

        result = {
            'from_currency': from_currency.upper(),
            'to_currency': to_currency.upper(),
            'amount': float(amount),
            'conversion_rate': conversion_rate,
            'converted_amount': round(converted_amount, 2),
            'last_update': currency_data.get('time_last_update_utc', '')
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de monedas: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/translate', methods=['POST'])
def translate_text():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de LibreTranslate de la base de datos
    translate_api_info = ApiInfo.query.filter_by(api_type="Traducción", enabled=True).first()
    if not translate_api_info:
        return jsonify({'error': 'No hay una API de "Traducción" configurada o habilitada.'}), 500
    
    api_key = translate_api_info.api_key
    
    data = request.get_json()
    text = data.get('text')
    target_lang = data.get('target_lang')
    
    if not text or not target_lang:
        return jsonify({'error': 'Se requiere texto y idioma destino.'}), 400

    try:
        # Detectar idioma automáticamente
        detect_url = "https://libretranslate.de/detect"
        detect_data = {
            'q': text[:100]  # Solo los primeros 100 caracteres para detección
        }
        
        detect_response = requests.post(detect_url, json=detect_data, timeout=10)
        detect_response.raise_for_status()
        detect_result = detect_response.json()
        
        if not detect_result or 'confidence' not in detect_result[0]:
            return jsonify({'error': 'No se pudo detectar el idioma del texto.'}), 500
            
        source_lang = detect_result[0]['language']
        
        # Traducir el texto
        translate_url = "https://libretranslate.de/translate"
        translate_data = {
            'q': text,
            'source': source_lang,
            'target': target_lang,
            'api_key': api_key
        }
        
        translate_response = requests.post(translate_url, json=translate_data, timeout=15)
        translate_response.raise_for_status()
        translate_result = translate_response.json()

        if 'translatedText' not in translate_result:
            return jsonify({'error': 'Error en la traducción.'}), 500

        result = {
            'original_text': text,
            'translated_text': translate_result['translatedText'],
            'source_language': source_lang,
            'target_language': target_lang,
            'confidence': round(detect_result[0]['confidence'] * 100, 1)
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de traducción: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/geolocation', methods=['POST'])
def get_geolocation():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de OpenCage de la base de datos
    geo_api_info = ApiInfo.query.filter_by(api_type="Geolocalización", enabled=True).first()
    if not geo_api_info:
        return jsonify({'error': 'No hay una API de "Geolocalización" configurada o habilitada.'}), 500
    
    api_key = geo_api_info.api_key
    
    data = request.get_json()
    address = data.get('address')
    
    if not address:
        return jsonify({'error': 'Se requiere una dirección.'}), 400

    try:
        # Consultar la API de OpenCage Geocoder
        url = "https://api.opencagedata.com/geocode/v1/json"
        params = {
            'q': address,
            'key': api_key,
            'language': 'es',
            'limit': 1,
            'no_annotations': 1
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        geo_data = response.json()

        if not geo_data.get('results'):
            return jsonify({'error': 'No se encontró la ubicación especificada.'}), 404

        result_data = geo_data['results'][0]
        geometry = result_data.get('geometry', {})
        components = result_data.get('components', {})
        
        # Extraer información relevante
        result = {
            'formatted_address': result_data.get('formatted', ''),
            'latitude': geometry.get('lat', 0),
            'longitude': geometry.get('lng', 0),
            'country': components.get('country', ''),
            'state': components.get('state', ''),
            'city': components.get('city', '') or components.get('town', '') or components.get('village', ''),
            'postcode': components.get('postcode', ''),
            'road': components.get('road', ''),
            'house_number': components.get('house_number', ''),
            'confidence': result_data.get('confidence', 0),
            'timezone': result_data.get('annotations', {}).get('timezone', {}).get('name', ''),
            'currency': result_data.get('annotations', {}).get('currency', {}).get('name', ''),
            'flag': result_data.get('annotations', {}).get('flag', '')
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de geolocalización: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/news', methods=['POST'])
def get_news():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de NewsAPI de la base de datos
    news_api_info = ApiInfo.query.filter_by(api_type="Noticias", enabled=True).first()
    if not news_api_info:
        return jsonify({'error': 'No hay una API de "Noticias" configurada o habilitada.'}), 500
    
    api_key = news_api_info.api_key
    
    data = request.get_json()
    category = data.get('category', 'general')
    
    # Mapear categorías a códigos de NewsAPI
    category_mapping = {
        'general': 'general',
        'tecnologia': 'technology',
        'negocios': 'business',
        'entretenimiento': 'entertainment',
        'salud': 'health',
        'ciencia': 'science',
        'deportes': 'sports'
    }
    
    news_category = category_mapping.get(category.lower(), 'general')

    try:
        # Consultar la API de NewsAPI
        url = "https://newsapi.org/v2/top-headlines"
        params = {
            'country': 'co',  # Colombia por defecto
            'category': news_category,
            'apiKey': api_key,
            'pageSize': 10,
            'language': 'es'
        }
        
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        news_data = response.json()

        if news_data.get('status') != 'ok':
            return jsonify({'error': 'Error al obtener noticias.'}), 500

        articles = news_data.get('articles', [])
        
        # Procesar artículos
        processed_articles = []
        for article in articles[:8]:  # Limitar a 8 artículos
            processed_articles.append({
                'title': article.get('title', 'Sin título'),
                'description': article.get('description', 'Sin descripción'),
                'url': article.get('url', ''),
                'image_url': article.get('urlToImage', ''),
                'source': article.get('source', {}).get('name', 'Fuente desconocida'),
                'published_at': article.get('publishedAt', ''),
                'content': article.get('content', '')[:200] + '...' if article.get('content') else ''
            })

        result = {
            'category': category,
            'total_results': news_data.get('totalResults', 0),
            'articles': processed_articles
        }

        return jsonify({'result': result})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al contactar la API de noticias: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/email', methods=['POST'])
def send_email():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de SendGrid de la base de datos
    email_api_info = ApiInfo.query.filter_by(api_type="Correo", enabled=True).first()
    if not email_api_info:
        return jsonify({'error': 'No hay una API de "Correo" configurada o habilitada.'}), 500
    
    api_key = email_api_info.api_key
    
    data = request.get_json()
    to_email = data.get('to_email')
    subject = data.get('subject')
    message = data.get('message')
    
    if not to_email or not subject or not message:
        return jsonify({'error': 'Se requiere destinatario, asunto y mensaje.'}), 400

    try:
        # Validar formato de email
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, to_email):
            return jsonify({'error': 'Formato de email inválido.'}), 400

        # Para demostración, simulamos el envío (en producción usarías SendGrid real)
        # En un entorno real, aquí iría la integración con SendGrid
        
        # Simular respuesta exitosa
        result = {
            'to_email': to_email,
            'subject': subject,
            'message_preview': message[:100] + '...' if len(message) > 100 else message,
            'status': 'sent',
            'message_id': f'msg_{int(get_colombia_now().timestamp())}_{len(to_email)}',
            'sent_at': colombia_strftime('%Y-%m-%d %H:%M:%S'),
            'from_email': 'noreply@tusitio.com'
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/social-media', methods=['POST'])
def post_social_media():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de Twitter de la base de datos
    social_api_info = ApiInfo.query.filter_by(api_type="Redes Sociales", enabled=True).first()
    if not social_api_info:
        return jsonify({'error': 'No hay una API de "Redes Sociales" configurada o habilitada.'}), 500
    
    api_key = social_api_info.api_key
    
    data = request.get_json()
    platform = data.get('platform')
    content = data.get('content')
    
    if not platform or not content:
        return jsonify({'error': 'Se requiere plataforma y contenido.'}), 400

    try:
        # Para demostración, simulamos la publicación
        # En un entorno real, aquí iría la integración con las APIs de redes sociales
        
        # Simular respuesta exitosa
        result = {
            'platform': platform,
            'content': content,
            'status': 'posted',
            'post_id': f'post_{int(time.time())}_{len(content)}',
            'posted_at': colombia_strftime('%Y-%m-%d %H:%M:%S'),
            'views': 0,
            'likes': 0,
            'shares': 0,
            'url': f'https://{platform.lower()}.com/post/{int(time.time())}'
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/image-recognition', methods=['POST'])
def analyze_image():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de Google Cloud Vision de la base de datos
    vision_api_info = ApiInfo.query.filter_by(api_type="Reconocimiento de Imágenes", enabled=True).first()
    if not vision_api_info:
        return jsonify({'error': 'No hay una API de "Reconocimiento de Imágenes" configurada o habilitada.'}), 500
    
    api_key = vision_api_info.api_key
    
    data = request.get_json()
    image_url = data.get('image_url')
    
    if not image_url:
        return jsonify({'error': 'Se requiere una URL de imagen.'}), 400

    try:
        # Validar que sea una URL válida
        if not image_url.startswith(('http://', 'https://')):
            return jsonify({'error': 'La URL debe comenzar con http:// o https://'}), 400

        # Para demostración, simulamos el análisis de imagen
        # En un entorno real, aquí iría la integración con Google Cloud Vision
        
        # Simular respuesta exitosa con datos realistas
        import random
        
        # Listas de objetos, emociones y colores para simular detección
        objetos = ['persona', 'gato', 'perro', 'coche', 'árbol', 'edificio', 'flor', 'libro', 'teléfono', 'computadora', 'mesa', 'silla', 'ventana', 'puerta', 'coche', 'bicicleta', 'árbol', 'césped', 'cielo', 'nube']
        emociones = ['feliz', 'sorprendido', 'pensativo', 'contento', 'emocionado', 'triste', 'enojado', 'neutral', 'confundido', 'asustado']
        colores = ['rojo', 'azul', 'verde', 'amarillo', 'naranja', 'morado', 'rosa', 'negro', 'blanco', 'gris', 'marrón']
        
        # Simular detección de objetos (3-5 objetos aleatorios)
        objetos_detectados = random.sample(objetos, random.randint(3, 5))
        
        # Simular análisis facial
        emocion_detectada = random.choice(emociones)
        confianza_emocion = random.randint(70, 95)
        
        # Simular colores principales
        colores_principales = random.sample(colores, random.randint(2, 4))
        
        # Simular texto detectado (OCR)
        textos_detectados = [
            "Hola mundo",
            "Bienvenido",
            "123456",
            "OpenAI",
            "Google",
            "Microsoft"
        ]
        texto_detectado = random.choice(textos_detectados) if random.random() > 0.5 else ""
        
        result = {
            'image_url': image_url,
            'objects_detected': objetos_detectados,
            'emotion_analysis': {
                'emotion': emocion_detectada,
                'confidence': confianza_emocion
            },
            'color_analysis': {
                'primary_colors': colores_principales,
                'dominant_color': colores_principales[0]
            },
            'text_detection': {
                'detected_text': texto_detectado,
                'has_text': bool(texto_detectado)
            },
            'image_properties': {
                'width': random.randint(800, 1920),
                'height': random.randint(600, 1080),
                'format': random.choice(['JPEG', 'PNG', 'GIF']),
                'size_kb': random.randint(50, 500)
            },
            'analysis_confidence': random.randint(85, 98),
            'processed_at': colombia_strftime('%Y-%m-%d %H:%M:%S')
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500 

@store_bp.route('/tools/chatbot', methods=['POST'])
def chat_with_ai():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")

    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)

    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    # Obtener la API Key de OpenAI de la base de datos
    chatbot_api_info = ApiInfo.query.filter_by(api_type="Chatbot/IA", enabled=True).first()
    if not chatbot_api_info:
        return jsonify({'error': 'No hay una API de "Chatbot/IA" configurada o habilitada.'}), 500
    
    api_key = chatbot_api_info.api_key
    
    data = request.get_json()
    message = data.get('message')
    
    if not message:
        return jsonify({'error': 'Se requiere un mensaje.'}), 400

    try:
        # Para demostración, simulamos la respuesta de IA
        # En un entorno real, aquí iría la integración con OpenAI
        
        # Simular respuesta inteligente basada en el mensaje
        import random
        
        # Respuestas contextuales basadas en palabras clave
        responses = {
            'hola': [
                "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy? 😊",
                "¡Saludos! Estoy aquí para asistirte con cualquier consulta que tengas. 🤖",
                "¡Hola! ¿Cómo puedo ser útil para ti en este momento? ✨"
            ],
            'ayuda': [
                "¡Por supuesto! Estoy aquí para ayudarte. ¿Qué necesitas saber? 🤝",
                "Te ayudo con gusto. ¿En qué tema específico necesitas asistencia? 💡",
                "¡Claro! Soy tu asistente personal. ¿Qué te gustaría consultar? 🎯"
            ],
            'gracias': [
                "¡De nada! Es un placer poder ayudarte. 😊",
                "¡No hay de qué! Estoy aquí para eso. ¿Hay algo más en lo que pueda asistirte? 🤖",
                "¡Encantado de ayudar! Si necesitas algo más, no dudes en preguntar. ✨"
            ],
            'default': [
                "¡Excelente pregunta! Como IA, puedo ayudarte con eso. 🤖",
                "Interesante consulta. Déjame procesar esa información... ⚡",
                "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy? 😊",
                "Procesando tu solicitud... ¡Aquí tienes la respuesta que necesitas! 💡",
                "Como inteligencia artificial, puedo analizar y responder a tu consulta. 🧠",
                "¡Buena pregunta! Déjame pensar en la mejor respuesta para ti. 🤔",
                "Interesante punto. Como IA, puedo ofrecerte diferentes perspectivas. 🌟"
            ]
        }
        
        # Detectar tipo de mensaje
        message_lower = message.lower()
        if 'hola' in message_lower or 'buenos' in message_lower:
            response_type = 'hola'
        elif 'ayuda' in message_lower or 'ayudar' in message_lower:
            response_type = 'ayuda'
        elif 'gracias' in message_lower or 'gracia' in message_lower:
            response_type = 'gracias'
        else:
            response_type = 'default'
        
        # Seleccionar respuesta aleatoria del tipo correspondiente
        possible_responses = responses.get(response_type, responses['default'])
        ai_response = random.choice(possible_responses)
        
        # Simular tiempo de procesamiento
        processing_time = random.randint(100, 800)
        accuracy = random.randint(80, 95)
        
        result = {
            'user_message': message,
            'ai_response': ai_response,
            'processing_time_ms': processing_time,
            'accuracy_percentage': accuracy,
            'model_used': 'GPT-3.5-turbo',
            'tokens_used': random.randint(50, 200),
            'response_timestamp': colombia_strftime('%Y-%m-%d %H:%M:%S'),
            'conversation_id': f'conv_{int(get_colombia_now().timestamp())}_{len(message)}'
        }

        return jsonify({'result': result})

    except Exception as e:
        return jsonify({'error': f'Ocurrió un error inesperado: {str(e)}'}), 500

from flask import jsonify, stream_with_context, request as flask_request
import json
import io
from google.oauth2 import service_account
from googleapiclient.discovery import build
import mimetypes

@store_bp.route('/api/drive-files')
def api_drive_files():
    api_id = request.args.get('id')
    if api_id:
        api = ApiInfo.query.get(api_id)
        if not api or api.api_type != "Drive" or not api.enabled:
            return jsonify({'error': 'API de Drive no encontrada o no habilitada.'}), 404
    else:
        api = ApiInfo.query.filter_by(api_type="Drive", enabled=True).first()
        if not api:
            return jsonify({'error': 'No hay API de Drive configurada.'}), 500

    cred_json_str = api.api_key  # JSON de credenciales pegado en el campo de API
    folder_id = api.api_url      # ID de la carpeta pegado en el campo URL de la API
    if not cred_json_str or not folder_id:
        return jsonify({'error': 'Faltan credenciales o ID de carpeta.'}), 400

    try:
        cred_dict = json.loads(cred_json_str)
        SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        creds = service_account.Credentials.from_service_account_info(
            cred_dict, scopes=SCOPES
        )
        service = build('drive', 'v3', credentials=creds)
        results = service.files().list(
            q=f"'{folder_id}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false",
            fields="files(id, name, mimeType)",
            pageSize=1000
        ).execute()
        files = results.get('files', [])
        return jsonify(files)
    except Exception as e:
        import traceback
        return jsonify({'error': f'Error al consultar Drive: {str(e)}'}), 500

@store_bp.route('/drive/proxy', methods=['GET', 'HEAD', 'OPTIONS'])
def api_drive_media():
    """Proxy mejorado para servir imágenes y videos de Google Drive con streaming y compatibilidad móvil/SSL"""
    # Manejar CORS preflight (OPTIONS)
    if flask_request.method == 'OPTIONS':
        response = Response()
        origin = flask_request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Accept, Authorization'
            response.headers['Access-Control-Max-Age'] = '3600'
        return response
    
    file_id = flask_request.args.get('file_id')
    api_id = flask_request.args.get('api_id')
    media_type = flask_request.args.get('type', 'image')  # 'image' o 'video'
    
    if not file_id:
        return jsonify({'error': 'Falta file_id'}), 400
    
    if api_id:
        api = ApiInfo.query.get(api_id)
        if not api or api.api_type != "Drive" or not api.enabled:
            return jsonify({'error': 'API no encontrada'}), 404
    else:
        api = ApiInfo.query.filter_by(api_type="Drive", enabled=True).first()
        if not api:
            return jsonify({'error': 'API no configurada'}), 500
    
    try:
        import google.auth.transport.requests
        import requests
        
        cred_json_str = api.api_key
        cred_dict = json.loads(cred_json_str)
        SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
        creds = service_account.Credentials.from_service_account_info(
            cred_dict, scopes=SCOPES
        )
        
        # Refrescar token de acceso
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)
        access_token = creds.token
        
        # URL directa a la API de Drive
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # Soporte para Range requests (necesario para streaming de video en móviles)
        range_header = flask_request.headers.get('Range')
        if range_header:
            headers['Range'] = range_header
        
        # Request con streaming habilitado y timeout aumentado para móviles
        req = requests.get(url, headers=headers, stream=True, timeout=(10, 300))
        
        if req.status_code not in [200, 206]:  # 206 = Partial Content (Range request)
            return jsonify({'error': f'Drive error: {req.status_code}'}), req.status_code
        
        # Detectar Content-Type si no viene en headers
        content_type = req.headers.get('Content-Type')
        if not content_type:
            # Intentar detectar por tipo de media
            if media_type == 'video':
                content_type = 'video/mp4'  # Default para videos
            else:
                content_type = 'image/jpeg'  # Default para imágenes
        
        # Asegurar Content-Type correcto para compatibilidad móvil
        if media_type == 'video' and 'video' not in content_type:
            content_type = 'video/mp4'
        elif media_type == 'image' and 'image' not in content_type:
            content_type = 'image/jpeg'
        
        def generate():
            try:
                for chunk in req.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            except Exception as e:
                current_app.logger.error(f'Error streaming chunk: {str(e)}')
                raise
        
        # Crear respuesta streaming
        response = Response(
            stream_with_context(generate()),
            status=req.status_code,
            content_type=content_type,
            direct_passthrough=False
        )
        
        # Headers esenciales para SSL estricto y compatibilidad móvil
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        
        # Headers para CORS (necesario para algunos móviles)
        origin = flask_request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Accept'
            response.headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'
        
        # Headers para streaming y cache
        headers_to_copy = ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']
        for header in headers_to_copy:
            if header in req.headers:
                response.headers[header] = req.headers[header]
        
        # Cache control optimizado para móviles
        if 'Cache-Control' not in response.headers:
            if media_type == 'video':
                # Videos: cache más largo pero permitir revalidación
                response.headers['Cache-Control'] = 'public, max-age=7200, must-revalidate'
            else:
                # Imágenes: cache largo
                response.headers['Cache-Control'] = 'public, max-age=86400'
        
        # Headers adicionales para compatibilidad móvil
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Content-Disposition'] = 'inline'  # Mostrar en lugar de descargar
        
        # Para SSL estricto: asegurar que no haya contenido mixto
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
        return response
        
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Timeout al conectar con Google Drive'}), 504
    except requests.exceptions.RequestException as e:
        current_app.logger.error(f'Error en request a Drive: {str(e)}')
        return jsonify({'error': f'Error de conexión: {str(e)}'}), 502
    except Exception as e:
        current_app.logger.error(f'Error inesperado en proxy: {str(e)}')
        return jsonify({'error': str(e)}), 500

@store_bp.route('/admin/work_sheets')
@admin_required
def admin_work_sheets():
    from flask import current_app, session
    from app.models.user import User
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    username = session.get("username")
    user = User.query.filter_by(username=username).first() if username else None
    return render_template(
        'work_sheets.html',
        title="Hojas de Trabajo",
        ADMIN_USER=admin_user,
        current_user=user,
        username=username
    )

@store_bp.route('/work_sheets')
@worksheet_access_required
def user_work_sheets():
    """Ruta para usuarios con permisos específicos de hojas de cálculo"""
    from flask import current_app, session
    from app.models.user import User
    
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    user = get_current_user()
    username = user.username
    
    return render_template(
        'work_sheets.html',
        title="Hojas de Trabajo",
        ADMIN_USER=admin_user,
        current_user=user,
        username=username
    )

@store_bp.route('/api/user/worksheets')
@worksheet_access_required
def get_user_worksheets():
    """API para obtener solo las hojas de cálculo permitidas para el usuario"""
    from flask import current_app, session, jsonify
    from app.models.user import User
    from app.store.models import WorksheetTemplate, WorksheetPermission
    
    user = get_current_user()
    
    # Obtener solo las hojas de cálculo a las que el usuario tiene acceso específico
    user_worksheets = []
    
    # Buscar permisos donde el usuario está incluido
    permissions = WorksheetPermission.query.filter_by(access_type='users').all()
    for permission in permissions:
        if user in permission.users.all():
            # Obtener la plantilla asociada al permiso
            worksheet = WorksheetTemplate.query.get(permission.worksheet_id)
            if worksheet:
                user_worksheets.append({
                    'id': worksheet.id,
                    'title': worksheet.title,
                    'fields': worksheet.fields,
                    'order': worksheet.order,
                    'created_at': worksheet.created_at.isoformat() if worksheet.created_at else None
                })
    
    # Ordenar por el campo 'order'
    user_worksheets.sort(key=lambda w: w['order'])
    
    return jsonify(user_worksheets)

@store_bp.route('/admin/configurations')
@admin_required
def admin_configurations():
    return render_template('configurations.html', title="Configuraciones")

@store_bp.route('/admin/sms')
@admin_required
def admin_sms():
    """Página para consultar mensajes SMS recibidos"""
    return render_template('sms.html', title="Consulta de Códigos SMS")

@store_bp.route('/admin/support')
@admin_required
def admin_support():
    # Obtener todos los usuarios para la tabla de gestión
    current_user = get_current_user()
    users = User.query.order_by(User.username).all()
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    return render_template('chatsoporte.html', title="Chat Soporte", users=users, current_user=current_user, user_has_worksheet_access=user_has_worksheet_access, ADMIN_USER=admin_user, User=User, is_support_user=False)

@store_bp.route('/support/dashboard')
@store_access_required
def support_dashboard():
    """Dashboard de chat de soporte para usuarios con is_support=True"""
    current_user = get_current_user()
    
    if not current_user or not current_user.is_support:
        flash("No tienes permisos de soporte.", "danger")
        return redirect(url_for('store_bp.store_front'))
    
    # Obtener todos los usuarios para la tabla de gestión (solo para soporte)
    users = User.query.order_by(User.username).all()
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    return render_template('chatsoporte.html', title="Dashboard de Chat de Soporte", users=users, is_support_user=True, current_user=current_user, user_has_worksheet_access=user_has_worksheet_access, ADMIN_USER=admin_user, User=User)

@store_bp.route('/admin/update_chat_permission', methods=['POST'])
@admin_required
def update_chat_permission():
    """Actualiza el permiso de chat de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        can_chat = data.get('can_chat')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Actualizar el permiso de chat
        # Si se activa chat, desactivar soporte
        if can_chat:
            user.is_support = False
        
        user.can_chat = can_chat
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': 'Permiso de chat actualizado correctamente'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al actualizar permiso: {str(e)}'}), 500

@store_bp.route('/admin/update_subusers_permission', methods=['POST'])
@admin_required
def update_subusers_permission():
    """Actualiza el permiso de gestión de sub-usuarios de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        can_manage_subusers = data.get('can_manage_subusers')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Si se activa gestión de sub-usuarios, desactivar soporte
        if can_manage_subusers:
            user.is_support = False
        
        # Actualizar el permiso de gestión de sub-usuarios
        user.can_manage_subusers = can_manage_subusers
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': 'Permiso de gestión de sub-usuarios actualizado correctamente'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al actualizar permiso: {str(e)}'}), 500

@store_bp.route('/admin/deactivate_chat_for_subusers', methods=['POST'])
@admin_required
def deactivate_chat_for_subusers():
    """Desactiva el chat para todos los sub-usuarios de un usuario padre"""
    try:
        data = request.get_json()
        parent_user_id = data.get('parent_user_id')
        
        if not parent_user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario padre requerido'}), 400
        
        # Buscar todos los sub-usuarios del usuario padre
        subusers = User.query.filter_by(parent_id=parent_user_id).all()
        updated_subusers = []
        
        for subuser in subusers:
            if subuser.can_chat:  # Solo actualizar si actualmente tiene chat activado
                subuser.can_chat = False
                updated_subusers.append(subuser.id)
        
        if updated_subusers:
            db.session.commit()
            return jsonify({
                'status': 'success', 
                'message': f'Chat desactivado para {len(updated_subusers)} sub-usuarios',
                'updated_subusers': updated_subusers
            })
        else:
            return jsonify({
                'status': 'success', 
                'message': 'No hay sub-usuarios con chat activado para desactivar',
                'updated_subusers': []
            })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al desactivar chat: {str(e)}'}), 500

@store_bp.route('/admin/update_soporte_permission', methods=['POST'])
@admin_required
def update_soporte_permission():
    """Actualiza el permiso de soporte de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        is_support = data.get('is_support')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Si se activa soporte, desactivar chat y sub-usuarios
        if is_support:
            user.can_chat = False
            user.can_manage_subusers = False
            
            # Eliminar todo el chat del usuario en cascada
            try:
                # Importar modelos
                from app.models.chat import ChatMessage, ChatSession
                
                # Verificar cuántos mensajes existen antes de eliminar
                messages_before = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user_id,
                        ChatMessage.recipient_id == user_id
                    )
                ).count()
                
                # Verificar cuántas sesiones existen antes de eliminar
                sessions_before = ChatSession.query.filter_by(user_id=user_id).count()
                
                # Eliminar mensajes del usuario
                deleted_messages = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user_id,
                        ChatMessage.recipient_id == user_id
                    )
                ).delete()
                
                # Eliminar sesiones de chat del usuario
                deleted_sessions = ChatSession.query.filter_by(user_id=user_id).delete()
                
                # Verificar que realmente se eliminaron
                messages_after = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user_id,
                        ChatMessage.recipient_id == user_id
                    )
                ).count()
                
                sessions_after = ChatSession.query.filter_by(user_id=user_id).count()
                
                # Si no se eliminaron todos, forzar commit y reintentar
                if messages_after > 0 or sessions_after > 0:
                    db.session.commit()
                    db.session.rollback()
                    
                    # Reintentar eliminación
                    ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == user_id,
                            ChatMessage.recipient_id == user_id
                        )
                    ).delete()
                    
                    ChatSession.query.filter_by(user_id=user_id).delete()
                
            except Exception as e:
                # Continuar con la actualización del permiso aunque falle la eliminación del chat
                pass
        
        user.is_support = is_support
        db.session.commit()
        
        return jsonify({'status': 'success', 'message': 'Permiso de soporte actualizado correctamente'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al actualizar permiso: {str(e)}'}), 500

@store_bp.route('/chat_soporte')
@store_access_required
def user_chat_soporte():
    """Página de chat de soporte para usuarios"""
    current_user = get_current_user()
    
    if not current_user:
        flash("No tienes permiso para acceder al chat de soporte.", "danger")
        return redirect(url_for('store_bp.store_front'))
    
    # Obtener admin_user para la plantilla
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    
    # Si el usuario es soporte, mostrar el dashboard de soporte
    if current_user.is_support:
        return render_template('chatsoporte.html', title="Dashboard de Chat de Soporte", users=[], is_support_user=True, current_user=current_user, user_has_worksheet_access=user_has_worksheet_access, ADMIN_USER=admin_user, User=User)
    
    # Si no es soporte, verificar que tenga permiso de chat
    if not current_user.can_chat:
        flash("No tienes permiso para acceder al chat de soporte.", "danger")
        return redirect(url_for('store_bp.store_front'))
    
    return render_template('user_chat_soporte.html', title="Chat de Soporte", current_user=current_user, ADMIN_USER=admin_user)

@store_bp.route('/admin/purchase_history')
@admin_required
def admin_purchase_history():
    return render_template('purchase_history.html', title="Historial de Compra")

@store_bp.route('/admin/pagos/add_balance', methods=['POST'])
@admin_required
def add_balance():
    data = request.get_json()
    username = data.get('username')
    amount_usd = data.get('amount_usd')
    amount_cop = data.get('amount_cop')
    if not username or (not amount_usd and not amount_cop):
        return jsonify({'success': False, 'error': 'Faltan datos'}), 400
    try:
        amount_usd = float(amount_usd) if amount_usd else 0.0
        amount_cop = float(amount_cop) if amount_cop else 0.0
    except Exception:
        return jsonify({'success': False, 'error': 'Monto inválido'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no encontrado'}), 404
    # Solo permitir añadir saldo en la moneda correspondiente al tipo_precio del rol
    tipo_precio = None
    if hasattr(user, 'roles_tienda') and user.roles_tienda and len(user.roles_tienda) > 0:
        tipo_precio = user.roles_tienda[0].tipo_precio.lower() if user.roles_tienda[0].tipo_precio else 'usd'
    if tipo_precio == 'usd':
        user.saldo_usd = (user.saldo_usd or 0) + amount_usd
    elif tipo_precio == 'cop':
        user.saldo_cop = (user.saldo_cop or 0) + amount_cop
    else:
        return jsonify({'success': False, 'error': 'El usuario no tiene tipo de saldo definido por rol.'}), 400
    from app import db
    db.session.commit()
    return jsonify({'success': True, 'new_saldo_usd': user.saldo_usd, 'new_saldo_cop': user.saldo_cop})


# Validación de cupones
@store_bp.route('/validate_coupon', methods=['POST'])
def validate_coupon():
    """Validar un cupón para la tienda pública"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Datos no válidos'})
            
        coupon_code = data.get('coupon_code', '').strip().upper()
        products = data.get('products', [])  # Lista de IDs de productos en el carrito
        
        if not coupon_code:
            return jsonify({'success': False, 'error': 'Código de cupón requerido'})
        
        # Buscar el cupón (buscar por name que es el código del cupón)
        coupon = Coupon.query.filter_by(name=coupon_code, enabled=True).first()
        
        if not coupon:
            return jsonify({'success': False, 'error': 'Cupón no válido o expirado'})
        
        # Verificar si el cupón ha expirado usando zona horaria de Colombia
        if coupon.duration_days and coupon.created_at:
            from datetime import datetime, timedelta
            # Usar módulo centralizado de timezone
            colombia_now = get_colombia_datetime()
            
            # Convertir created_at a zona horaria de Colombia usando módulo centralizado
            created_at_col = utc_to_colombia(coupon.created_at)
            
            expiration_date = created_at_col + timedelta(days=coupon.duration_days)
            if colombia_now > expiration_date:
                return jsonify({'success': False, 'error': 'Cupón expirado'})
        
        # Verificar si hay productos en el carrito
        if not products:
            return jsonify({'success': False, 'error': 'No hay productos en el carrito'})
        
        # Verificar si el cupón aplica a los productos del carrito
        if coupon.products:
            coupon_product_ids = [p.id for p in coupon.products]
            if not any(int(pid) in coupon_product_ids for pid in products):
                return jsonify({'success': False, 'error': 'Este cupón no aplica a los productos seleccionados'})
        
        # Verificar monto mínimo si está configurado
        if coupon.min_amount and coupon.min_amount > 0:
            # Calcular total del carrito (esto debería venir del frontend)
            total_amount = data.get('total_amount', 0)
            if total_amount < float(coupon.min_amount):
                return jsonify({'success': False, 'error': f'El cupón requiere un monto mínimo de ${coupon.min_amount} COP'})
        
        # Obtener productos elegibles para el descuento
        eligible_products = []
        if coupon.products:
            coupon_product_ids = [p.id for p in coupon.products]
            for pid in products:
                if int(pid) in coupon_product_ids:
                    # Buscar el producto para obtener su información
                    product = Product.query.get(int(pid))
                    if product:
                        eligible_products.append({
                            'id': product.id,
                            'name': product.name,
                            'discount_cop': float(coupon.discount_cop) if coupon.discount_cop else 0,
                            'discount_usd': float(coupon.discount_usd) if coupon.discount_usd else 0
                        })
        else:
            # Si no hay productos específicos, el cupón aplica a todos
            for pid in products:
                product = Product.query.get(int(pid))
                if product:
                    eligible_products.append({
                        'id': product.id,
                        'name': product.name,
                        'discount_cop': float(coupon.discount_cop) if coupon.discount_cop else 0,
                        'discount_usd': float(coupon.discount_usd) if coupon.discount_usd else 0
                    })
        
        # Retornar información del cupón válido con productos elegibles
        return jsonify({
            'success': True,
            'coupon': {
                'id': coupon.id,
                'name': coupon.name,
                'discount_cop': coupon.discount_cop,
                'discount_usd': coupon.discount_usd,
                'description': coupon.description,
                'min_amount': coupon.min_amount
            },
            'eligible_products': eligible_products
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error interno: {str(e)}'})

@store_bp.route('/')
@store_access_required
def tienda_alias():
    products = Product.query.filter_by(enabled=True).order_by(Product.name).all()
    coupons = Coupon.query.filter_by(enabled=True, show_public=True).order_by(Coupon.id.desc()).all()
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    return render_template('store_front.html', products=products, coupons=coupons, ADMIN_USER=admin_user, current_user=user, username=username)

@store_bp.route('/store_front')
@store_access_required
def store_front_alias():
    products = Product.query.filter_by(enabled=True).order_by(Product.name).all()
    coupons = Coupon.query.filter_by(enabled=True, show_public=True).order_by(Coupon.id.desc()).all()
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    return render_template('store_front.html', products=products, coupons=coupons, ADMIN_USER=admin_user, current_user=user, username=username)

# --- Al dar acceso a la tienda a un subusuario, solo actualizar can_access_store, sin roles ---
from app.models.user import User
@store_bp.route('/subusers/update_access', methods=['POST'])
def update_subuser_access():
    data = request.get_json()
    subuser_id = data.get('subuser_id')
    can_access_store = data.get('can_access_store', False)
    subuser = User.query.get(subuser_id)
    if not subuser:
        return jsonify({'success': False, 'error': 'Subusuario no encontrado.'}), 404
    subuser.can_access_store = bool(can_access_store)
    db.session.commit()
    return jsonify({'success': True, 'can_access_store': subuser.can_access_store})


@store_bp.route('/procesar_pago', methods=['POST'])
@store_access_required
def procesar_pago():
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Usuario no autenticado'}), 401
    data = request.get_json()
    productos = data.get('productos', [])
    if not productos:
        return jsonify({'success': False, 'error': 'No hay productos'}), 400
    total_cop = 0
    total_usd = 0
    for p in productos:
        if p.get('moneda') == 'COP':
            total_cop += p.get('cantidad', 1) * p.get('precio_unitario', 0)
        elif p.get('moneda') == 'USD':
            total_usd += p.get('cantidad', 1) * p.get('precio_unitario', 0)
    if user.saldo_cop is None:
        user.saldo_cop = 0
    if user.saldo_usd is None:
        user.saldo_usd = 0
    if total_cop > user.saldo_cop:
        return jsonify({'success': False, 'error': 'Saldo COP insuficiente'}), 400
    if total_usd > user.saldo_usd:
        return jsonify({'success': False, 'error': 'Saldo USD insuficiente'}), 400
    # Descontar saldo
    user.saldo_cop -= total_cop
    user.saldo_usd -= total_usd
    # Registrar compras y asignar licencias automáticamente
    from app.store.models import Product, Sale, License, LicenseAccount
    from app import db
    from datetime import datetime, timedelta
    
    cuentas_asignadas = []
    
    for p in productos:
        producto = Product.query.get(p.get('id'))
        if not producto:
            continue
        
        cantidad = p.get('cantidad', 1)
        
        # Registrar la venta
        venta = Sale(
            user_id=user.id,
            product_id=producto.id,
            quantity=cantidad,
            total_price=cantidad * p.get('precio_unitario', 0)
        )
        db.session.add(venta)
        
        # Buscar licencias disponibles para este producto
        licenses = License.query.filter_by(product_id=producto.id, enabled=True).all()
        
        # Contar cuántas cuentas necesitamos asignar
        cuentas_necesarias = cantidad
        cuentas_asignadas_producto = 0
        
        # Iterar sobre todas las licencias hasta tener suficientes cuentas
        for license in licenses:
            if cuentas_asignadas_producto >= cuentas_necesarias:
                break
                
            # Buscar cuentas disponibles (no vendidas) de esta licencia
            cuentas_faltantes = cuentas_necesarias - cuentas_asignadas_producto
            accounts = LicenseAccount.query.filter_by(
                license_id=license.id,
                status='available'
            ).limit(cuentas_faltantes).all()
            
            # Asignar las cuentas al usuario
            for account in accounts:
                account.status = 'assigned'
                account.assigned_to_user_id = user.id
                account.assigned_at = datetime.utcnow()
                account.expires_at = datetime.utcnow() + timedelta(days=30)  # 1 mes de expiración
                
                cuentas_asignadas.append({
                    'producto': producto.name,
                    'email': account.email,
                    'password': account.password,
                    'identifier': account.account_identifier
                })
                cuentas_asignadas_producto += 1
    
    db.session.commit()
    
    return jsonify({
        'success': True, 
        'new_saldo_cop': user.saldo_cop, 
        'new_saldo_usd': user.saldo_usd,
        'cuentas_asignadas': cuentas_asignadas
    })

@store_bp.route('/historial_compras')
@store_access_required
def historial_compras_usuario():
    """Mostrar el historial de compras del usuario"""
    user = None
    username = session.get("username")
    user_id = session.get("user_id")
    
    if username:
        user = User.query.filter_by(username=username).first()
    elif user_id:
        user = User.query.get(user_id)
        if user:
            username = user.username
    
    if not user:
        flash('Debes iniciar sesión para ver tu historial de compras', 'warning')
        return redirect(url_for('user_auth_bp.login'))
    
    # Obtener todas las compras del usuario, ordenadas por fecha más reciente
    from app.store.models import Sale, Product
    
    # Obtener compras con información del producto
    compras = db.session.query(Sale, Product).join(
        Product, Sale.product_id == Product.id
    ).filter(
        Sale.user_id == user.id
    ).order_by(Sale.created_at.desc()).all()
    
    compras_info = []
    for sale, product in compras:
        # Formatear fecha en zona horaria de Colombia
        fecha_colombia = sale.created_at
        if fecha_colombia:
            # Convertir a zona horaria de Colombia usando módulo centralizado
            fecha_colombia = utc_to_colombia(fecha_colombia)
            fecha_str = fecha_colombia.strftime('%Y-%m-%d %H:%M:%S')
        else:
            fecha_str = 'Fecha no disponible'
        
        compras_info.append({
            'id': sale.id,
            'fecha': fecha_str,
            'producto': product.name,
            'cantidad': sale.quantity,
            'total': float(sale.total_price),
            'product_id': product.id
        })
    
    admin_user = current_app.config.get("ADMIN_USER", "admin")
    return render_template('purchase_history_user.html', 
                         compras=compras_info,
                         current_user=user,
                         username=username,
                         ADMIN_USER=admin_user)

# ================== RUTAS PARA LICENCIAS ==================

@store_bp.route('/api/licenses')
@admin_required
def api_get_licenses():
    """Obtener todas las licencias con sus cuentas"""
    try:
        from app.store.models import License, LicenseAccount, Product
        
        # Obtener todas las licencias con sus productos y cuentas
        licenses = License.query.join(Product).all()
        
        licenses_data = []
        for license in licenses:
            license_data = {
                'id': license.id,
                'product_id': license.product_id,
                'product_name': license.product.name,
                'position': license.position,
                'enabled': license.enabled,
                'created_at': license.created_at.isoformat() if license.created_at else None,
                'accounts': []
            }
            
            # Agregar cuentas de la licencia
            for account in license.accounts:
                account_data = {
                    'id': account.id,
                    'account_identifier': account.account_identifier,
                    'email': account.email,
                    'password': account.password,
                    'status': account.status,
                    'assigned_to_user_id': account.assigned_to_user_id,
                    'assigned_at': account.assigned_at.isoformat() if account.assigned_at else None,
                    'expires_at': account.expires_at.isoformat() if account.expires_at else None,
                    'is_expired': account.is_expired,
                    'days_until_expiry': account.days_until_expiry
                }
                license_data['accounts'].append(account_data)
            
            licenses_data.append(license_data)
        
        return jsonify({'success': True, 'licenses': licenses_data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/archived', methods=['GET'])
@admin_required
def api_get_archived_licenses():
    """Obtener solo las licencias archivadas"""
    try:
        from app.store.models import License, LicenseAccount, Product
        from app import db
        
        licenses = License.query.filter_by(enabled=False).options(joinedload(License.accounts)).all()
        
        licenses_data = []
        for license in licenses:
            accounts_data = []
            for account in license.accounts:
                accounts_data.append({
                    'id': account.id,
                    'account_identifier': account.account_identifier,
                    'email': account.email,
                    'password': account.password,
                    'status': account.status,
                    'assigned_to_user_id': account.assigned_to_user_id,
                    'assigned_at': account.assigned_at.isoformat() if account.assigned_at else None,
                    'expires_at': account.expires_at.isoformat() if account.expires_at else None,
                    'created_at': account.created_at.isoformat(),
                    'is_expired': account.is_expired,
                    'days_until_expiry': account.days_until_expiry
                })
            
            licenses_data.append({
                'id': license.id,
                'product_id': license.product_id,
                'product_name': license.product.name if license.product else 'Producto eliminado',
                'position': license.position,
                'enabled': license.enabled,
                'created_at': license.created_at.isoformat(),
                'updated_at': license.updated_at.isoformat(),
                'accounts': accounts_data
            })
        
        return jsonify({'success': True, 'licenses': licenses_data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/<int:license_id>/archive', methods=['PUT'])
@admin_required
def api_archive_license(license_id):
    """Archivar una licencia (deshabilitarla)"""
    try:
        license = License.query.get_or_404(license_id)
        license.enabled = False
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Licencia archivada correctamente'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@store_bp.route('/api/licenses/<int:license_id>/restore', methods=['PUT'])
@admin_required
def api_restore_license(license_id):
    """Restaurar una licencia archivada (habilitarla)"""
    try:
        license = License.query.get_or_404(license_id)
        license.enabled = True
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Licencia restaurada correctamente'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@store_bp.route('/api/licenses/<int:license_id>', methods=['DELETE'])
@admin_required
def api_delete_license(license_id):
    """Eliminar permanentemente una licencia"""
    try:
        license = License.query.get_or_404(license_id)
        db.session.delete(license)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Licencia eliminada correctamente'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@store_bp.route('/api/licenses/<int:license_id>/position', methods=['PUT'])
@admin_required
def api_update_license_position(license_id):
    """Actualizar posición de una licencia con reorganización automática"""
    try:
        from app.store.models import License
        from app import db
        
        data = request.get_json()
        new_position = data.get('position')
        reorganize = data.get('reorganize', False)
        
        if not new_position or new_position < 1:
            return jsonify({'success': False, 'error': 'Posición inválida'}), 400
        
        license = License.query.get(license_id)
        if not license:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404
        
        old_position = license.position
        
        if reorganize:
            # Siempre reorganizar todo para evitar duplicados
            # Primero, mover temporalmente la licencia actual a una posición muy alta
            license.position = 9999
            db.session.add(license)
            db.session.flush()  # Asegurar que se guarde el cambio temporal
            
            # Obtener todas las licencias habilitadas (excluyendo la que estamos moviendo)
            other_licenses = License.query.filter(
                License.enabled == True,
                License.id != license_id
            ).order_by(License.position.asc()).all()
            
            # Reorganizar todas las posiciones secuencialmente
            current_pos = 1
            for lic in other_licenses:
                if current_pos == new_position:
                    current_pos += 1  # Saltar la posición que queremos para nuestra licencia
                lic.position = current_pos
                db.session.add(lic)
                current_pos += 1
            
            # Ahora asignar la posición deseada a nuestra licencia
            license.position = new_position
            db.session.add(license)
        else:
            # Si no se solicita reorganización, solo actualizar
            license.position = new_position
            db.session.add(license)
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'position': license.position,
            'reorganized': reorganize
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/reorganize-all', methods=['POST'])
@admin_required
def api_reorganize_all_licenses():
    """Reorganizar todas las licencias para eliminar duplicados y huecos"""
    try:
        from app.store.models import License
        from app import db
        
        # Obtener todas las licencias habilitadas ordenadas por posición actual
        all_licenses = License.query.filter(
            License.enabled == True
        ).order_by(License.position.asc()).all()
        
        # Reorganizar todas las posiciones secuencialmente
        for index, license in enumerate(all_licenses, 1):
            license.position = index
            db.session.add(license)
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'message': f'Se reorganizaron {len(all_licenses)} licencias',
            'count': len(all_licenses)
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/products/<int:product_id>/stock', methods=['GET'])
def api_get_product_stock(product_id):
    """Obtener el conteo de licencias disponibles para un producto"""
    try:
        from app.store.models import License, LicenseAccount
        
        # Buscar todas las licencias del producto
        licenses = License.query.filter_by(product_id=product_id, enabled=True).all()
        
        if not licenses:
            return jsonify({'success': True, 'stock': 0})
        
        # Contar todas las cuentas disponibles (no vendidas) de todas las licencias del producto
        # Status 'available' y 'assigned' se consideran disponibles
        total_stock = 0
        for license in licenses:
            available_accounts = LicenseAccount.query.filter(
                LicenseAccount.license_id == license.id,
                LicenseAccount.status.in_(['available', 'assigned'])
            ).count()
            total_stock += available_accounts
        
        return jsonify({'success': True, 'stock': total_stock})
        
    except Exception as e:
        current_app.logger.error(f'Error al obtener stock del producto {product_id}: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/products/stock', methods=['GET'])
def api_get_all_products_stock():
    """Obtener el conteo de licencias disponibles para todos los productos"""
    try:
        from app.store.models import License, LicenseAccount, Product
        
        # Obtener todos los productos habilitados
        products = Product.query.filter_by(enabled=True).all()
        
        stock_data = {}
        for product in products:
            # Buscar todas las licencias del producto
            licenses = License.query.filter_by(product_id=product.id, enabled=True).all()
            
            total_stock = 0
            for license in licenses:
                # Status 'available' y 'assigned' se consideran disponibles
                available_accounts = LicenseAccount.query.filter(
                    LicenseAccount.license_id == license.id,
                    LicenseAccount.status.in_(['available', 'assigned'])
                ).count()
                total_stock += available_accounts
            
            stock_data[product.id] = total_stock
        
        return jsonify({'success': True, 'stock': stock_data})
        
    except Exception as e:
        current_app.logger.error(f'Error al obtener stock de productos: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/<int:license_id>/toggle', methods=['PUT'])
@admin_required
def api_toggle_license(license_id):
    """Activar/desactivar licencia"""
    try:
        from app.store.models import License
        from app import db
        
        license = License.query.get(license_id)
        if not license:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404
        
        license.enabled = not license.enabled
        db.session.commit()
        
        return jsonify({'success': True, 'enabled': license.enabled})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/<int:license_id>/accounts', methods=['POST'])
@admin_required
def api_add_license_account(license_id):
    """Agregar cuenta a una licencia"""
    try:
        from app.store.models import License, LicenseAccount
        from app import db
        from datetime import datetime, timedelta
        
        data = request.get_json()
        account_identifier = data.get('account_identifier')
        email = data.get('email')
        password = data.get('password')
        
        if not all([account_identifier, email, password]):
            return jsonify({'success': False, 'error': 'Faltan datos requeridos'}), 400
        
        license = License.query.get(license_id)
        if not license:
            return jsonify({'success': False, 'error': 'Licencia no encontrada'}), 404
        
        # Crear nueva cuenta con expiración de 1 mes
        expires_at = datetime.utcnow() + timedelta(days=30)
        
        new_account = LicenseAccount(
            license_id=license_id,
            account_identifier=account_identifier,
            email=email,
            password=password,
            status='available',
            expires_at=expires_at
        )
        
        db.session.add(new_account)
        db.session.commit()
        
        return jsonify({'success': True, 'account_id': new_account.id})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/accounts/<int:account_id>', methods=['DELETE', 'PUT', 'OPTIONS'])
@admin_required
def api_update_license_account(account_id):
    """Actualizar o eliminar cuenta de licencia"""
    # Manejar preflight requests
    if request.method == 'OPTIONS':
        response = jsonify({'success': True})
        response.headers.add('Access-Control-Allow-Methods', 'PUT, DELETE, OPTIONS')
        return response
    
    try:
        from app.store.models import LicenseAccount
        from app import db
        
        account = LicenseAccount.query.get(account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Cuenta no encontrada'}), 404
        
        if request.method == 'DELETE':
            db.session.delete(account)
            db.session.commit()
            return jsonify({'success': True})
        
        elif request.method == 'PUT':
            # Verificar que hay datos JSON
            if not request.is_json:
                return jsonify({'success': False, 'error': 'Content-Type debe ser application/json'}), 400
            
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': 'No se recibieron datos'}), 400
            
            email = data.get('email')
            password = data.get('password')
            account_identifier = data.get('account_identifier')
            
            # Validar que al menos hay un campo para actualizar
            if not email and not password and not account_identifier:
                return jsonify({'success': False, 'error': 'Debe proporcionar al menos un campo para actualizar'}), 400
            
            if email:
                account.email = email
            if password:
                account.password = password
            if account_identifier:
                account.account_identifier = account_identifier
            
            db.session.commit()
            return jsonify({'success': True})
        
        else:
            return jsonify({'success': False, 'error': 'Método no permitido'}), 405
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Error en api_update_license_account: {str(e)}')
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/accounts/<int:account_id>/mark-sold', methods=['PUT'])
@admin_required
def api_mark_account_sold(account_id):
    """Marcar cuenta como vendida con fecha"""
    try:
        from app.store.models import LicenseAccount
        from app import db
        from datetime import datetime
        
        account = LicenseAccount.query.get(account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Cuenta no encontrada'}), 404
        
        data = request.get_json()
        sold_date_str = data.get('sold_date')
        
        if sold_date_str:
            sold_date = datetime.fromisoformat(sold_date_str.replace('Z', '+00:00'))
            account.assigned_at = sold_date
        else:
            account.assigned_at = datetime.utcnow()
        
        account.status = 'sold'
        db.session.commit()
        
        return jsonify({'success': True})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/api/licenses/initialize', methods=['POST'])
@admin_required
def api_initialize_licenses():
    """Inicializar licencias basadas en productos existentes"""
    try:
        from app.store.models import License, Product
        from app import db
        
        # Obtener todos los productos habilitados
        products = Product.query.filter_by(enabled=True).all()
        
        created_licenses = []
        for i, product in enumerate(products, 1):
            # Verificar si ya existe una licencia para este producto
            existing_license = License.query.filter_by(product_id=product.id).first()
            
            if not existing_license:
                new_license = License(
                    product_id=product.id,
                    position=i,
                    enabled=True
                )
                db.session.add(new_license)
                created_licenses.append({
                    'id': new_license.id,
                    'product_name': product.name,
                    'position': i
                })
        
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'message': f'Se crearon {len(created_licenses)} licencias',
            'licenses': created_licenses
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

from app.store.models import StoreSetting
import json
from flask import request, jsonify
import gspread
from google.oauth2.service_account import Credentials

@store_bp.route('/admin/gsheets_config', methods=['POST'])
@admin_required
def save_gsheets_config():
    credentials_json = request.form.get('gsheets_credentials_json')
    sheet_id = request.form.get('gsheets_sheet_id')
    tab_name = request.form.get('gsheets_tab_name')
    if not credentials_json or not sheet_id or not tab_name:
        return jsonify({'success': False, 'error': 'Faltan datos'}), 400
    # Guardar o actualizar en la base de datos
    for key, value in [
        ('gsheets_credentials_json', credentials_json),
        ('gsheets_sheet_id', sheet_id),
        ('gsheets_tab_name', tab_name)
    ]:
        setting = StoreSetting.query.filter_by(key=key).first()
        if setting:
            setting.value = value
        else:
            setting = StoreSetting(key=key, value=value)
            db.session.add(setting)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración guardada correctamente.'})

@store_bp.route('/admin/gsheets_test', methods=['POST'])
@admin_required
def test_gsheets_connection():
    # Leer de la base de datos
    cred_setting = StoreSetting.query.filter_by(key='gsheets_credentials_json').first()
    id_setting = StoreSetting.query.filter_by(key='gsheets_sheet_id').first()
    tab_setting = StoreSetting.query.filter_by(key='gsheets_tab_name').first()
    if not cred_setting or not id_setting or not tab_setting:
        return jsonify({'success': False, 'error': 'Faltan credenciales, ID de hoja o nombre de tab.'}), 400
    try:
        credentials_dict = json.loads(cred_setting.value)
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        credentials = Credentials.from_service_account_info(credentials_dict, scopes=scope)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key(id_setting.value)
        worksheet = sh.worksheet(tab_setting.value)
        # Leer la primera celda como prueba
        value = worksheet.cell(1, 1).value
        return jsonify({'success': True, 'message': f'Conexión exitosa. Primera celda de "{tab_setting.value}": {value}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@store_bp.route('/admin/gsheets_test_direct', methods=['POST'])
@admin_required
def test_gsheets_connection_direct():
    """Prueba la conexión directamente con los datos del formulario"""
    try:
        data = request.json
        
        if not data:
            return jsonify({'success': False, 'error': 'No se recibieron datos JSON'}), 400
            
        credentials_json = data.get('gsheets_credentials_json')
        sheet_id = data.get('gsheets_sheet_id')
        tab_name = data.get('gsheets_tab_name')
        
        if not credentials_json or not sheet_id or not tab_name:
            return jsonify({'success': False, 'error': 'Faltan credenciales, ID de hoja o nombre de tab.'}), 400
        
        # Validar que el JSON sea válido
        try:
            credentials_dict = json.loads(credentials_json)
        except json.JSONDecodeError as e:
            return jsonify({'success': False, 'error': f'JSON de credenciales inválido: {str(e)}'}), 400
        
        # Probar conexión
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        credentials = Credentials.from_service_account_info(credentials_dict, scopes=scope)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key(sheet_id)
        worksheet = sh.worksheet(tab_name)
        
        # Leer la primera celda como prueba
        value = worksheet.cell(1, 1).value
        return jsonify({'success': True, 'message': f'Conexión exitosa. Primera celda de "{tab_name}": {value or "(vacía)"}'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error interno: {str(e)}'}), 500

# ... existing code ...


@store_bp.route('/admin/gsheets_links', methods=['GET'])
@admin_required
def list_gsheets_links():
    links = GSheetsLink.query.order_by(GSheetsLink.updated_at.desc()).all()
    return jsonify({
        'success': True,
        'links': [
            {
                'id': l.id,
                'template_type': l.plantilla,  # para que coincida con el JS
                'credentials_json': l.credentials_json,
                'sheet_id': l.sheet_id,
                'tab_name': l.tab_name,
                'updated_at': l.updated_at.strftime('%Y-%m-%d %H:%M')
            } for l in links
        ]
    })

@store_bp.route('/admin/gsheets_links', methods=['POST'])
@admin_required
def create_gsheets_link():
    data = request.form if request.form else request.json
    plantilla = data.get('gsheets_template')
    credentials_json = data.get('gsheets_credentials_json')
    sheet_id = data.get('gsheets_sheet_id')
    tab_name = data.get('gsheets_tab_name')
    if not plantilla or not credentials_json or not sheet_id or not tab_name:
        return jsonify({'success': False, 'error': 'Faltan datos'}), 400
    # Si ya existe una vinculación para esa plantilla, actualiza
    link = GSheetsLink.query.filter_by(plantilla=plantilla).first()
    if link:
        link.credentials_json = credentials_json
        link.sheet_id = sheet_id
        link.tab_name = tab_name
    else:
        link = GSheetsLink(
            plantilla=plantilla,
            credentials_json=credentials_json,
            sheet_id=sheet_id,
            tab_name=tab_name
        )
        db.session.add(link)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vinculación guardada correctamente.'})

@store_bp.route('/admin/gsheets_links/<int:link_id>', methods=['PUT', 'PATCH'])
@admin_required
def edit_gsheets_link(link_id):
    data = request.form if request.form else request.json
    link = GSheetsLink.query.get_or_404(link_id)
    link.plantilla = data.get('gsheets_template', link.plantilla)
    link.credentials_json = data.get('gsheets_credentials_json', link.credentials_json)
    link.sheet_id = data.get('gsheets_sheet_id', link.sheet_id)
    link.tab_name = data.get('gsheets_tab_name', link.tab_name)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vinculación actualizada.'})

@store_bp.route('/admin/gsheets_links/<int:link_id>', methods=['DELETE'])
@admin_required
def delete_gsheets_link(link_id):
    link = GSheetsLink.query.get_or_404(link_id)
    db.session.delete(link)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vinculación eliminada.'})

@store_bp.route('/admin/gsheets_links/<int:link_id>/test', methods=['POST'])
@admin_required
def test_gsheets_link(link_id):
    link = GSheetsLink.query.get_or_404(link_id)
    try:
        credentials_dict = json.loads(link.credentials_json)
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        credentials = Credentials.from_service_account_info(credentials_dict, scopes=scope)
        gc = gspread.authorize(credentials)
        sh = gc.open_by_key(link.sheet_id)
        try:
            worksheet = sh.worksheet(link.tab_name)
        except Exception as e:
            return jsonify({'success': False, 'error': f'No se encontró la hoja/tab "{link.tab_name}": {str(e)}'}), 400
        value = worksheet.cell(1, 1).value
        return jsonify({'success': True, 'message': f'Conexión exitosa. Primera celda de "{link.tab_name}": {value or "(vacía)"}'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error general: {str(e)}'}), 500

@store_bp.route('/admin/gsheets_links/<int:link_id>', methods=['GET'])
@admin_required
def get_gsheets_link(link_id):
    link = GSheetsLink.query.get_or_404(link_id)
    return jsonify({
        'success': True,
        'link': {
            'id': link.id,
            'template_type': link.plantilla,
            'credentials_json': link.credentials_json,
            'sheet_id': link.sheet_id,
            'tab_name': link.tab_name,
            'updated_at': link.updated_at.strftime('%Y-%m-%d %H:%M')
        }
    })

@store_bp.route('/share/worksheet/<int:worksheet_id>')
def shared_worksheet_access(worksheet_id):
    """Acceso compartido a worksheets con token"""
    try:
        # Obtener parámetros de la URL
        access_type = request.args.get('access', 'readonly')
        token = request.args.get('token')
        
        if not token:
            return "Enlace inválido - Token requerido", 400
        
        if len(token) < 10:
            return "Enlace inválido - Token malformado", 400
        
        # Buscar la plantilla
        worksheet = WorksheetTemplate.query.get(worksheet_id)
        if not worksheet:
            return "Worksheet no encontrada", 404
        
        # Buscar el permiso correspondiente
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return "Enlace no válido - Token no encontrado", 400
        
        
        # Verificar que el permiso esté activo
        if permission.access_type == 'users':
            try:
                user_count = permission.users.count() if hasattr(permission, 'users') and permission.users else 0
                # Los tokens de 'users' pueden funcionar sin usuarios específicos asignados
                # El token en sí es válido para acceso compartido, independientemente de usuarios específicos
            except Exception as e:
                # Continuar - el token público sigue siendo válido
                pass
        
        
        # ⭐ CORREGIDO: Verificar que el tipo de acceso coincida correctamente
        # Para access_type 'readonly' acepta permisos 'view' y 'users'
        # Para access_type 'edit' acepta permisos 'edit' y 'users'
        if access_type == 'readonly' and permission.access_type not in ['view', 'users']:
            return "Tipo de acceso no válido", 400
        elif access_type == 'edit' and permission.access_type not in ['edit', 'users']:
            return "Tipo de acceso no válido", 400
        
        # Obtener datos de la worksheet
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        data = worksheet_data.data if worksheet_data else []
        formato = worksheet_data.formato if worksheet_data else {}
        
        # Limitar datos para evitar bloqueos del navegador
        original_data_length = len(data)
        if len(data) > 50:
            data = data[:50]  # Solo primeras 50 filas
        
        # Pasar información del total para mostrar al usuario
        data_info = {
            'shown': len(data),
            'total': original_data_length,
            'limited': original_data_length > 50
        }
        
        # Determinar si es solo lectura
        is_readonly = access_type == 'readonly'
        
        # ⭐ NUEVO: Obtener IP del usuario para el historial
        user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'IP desconocida'))
        if ',' in user_ip:
            user_ip = user_ip.split(',')[0].strip()  # Tomar la primera IP si hay múltiples
        
        # ⭐ NUEVO: Obtener información del usuario logueado
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        is_logged_in = session.get('logged_in', False)
        
        
        try:
            result = render_template(
                'shared_worksheet.html',
                worksheet=worksheet,
                data=data,
                formato=formato,
                is_readonly=is_readonly,
                access_type=access_type,
                token=token,
                user_ip=user_ip,
                current_username=current_username,
                is_admin=is_admin,
                is_logged_in=is_logged_in,
                admin_user=admin_user_config
            )
            return result
        except Exception as template_error:
            return f"Error renderizando template: {str(template_error)}", 500
        
    except Exception as e:
        return f"Error: {str(e)}", 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/data', methods=['GET'])
def get_shared_worksheet_data(worksheet_id):
    """API para obtener datos de worksheet compartida (exenta de CSRF)"""
    try:
        token = request.args.get('token')
        access_type = request.args.get('access', 'readonly')
        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Verificar que el permiso esté activo (API datos)
        if permission.access_type == 'users':
            try:
                user_count = permission.users.count() if hasattr(permission, 'users') and permission.users else 0
                # Los tokens de 'users' pueden funcionar sin usuarios específicos asignados
            except Exception as e:
                # Continuar - el token público sigue siendo válido
                pass
        
        # ⭐ CORREGIDO: Verificar tipo de acceso correctamente
        # Para access_type 'readonly' acepta permisos 'view' y 'users'
        # Para access_type 'edit' acepta permisos 'edit' y 'users'
        if access_type == 'readonly' and permission.access_type not in ['view', 'users']:
            return jsonify({'error': 'Acceso no autorizado'}), 403
        elif access_type == 'edit' and permission.access_type not in ['edit', 'users']:
            return jsonify({'error': 'Acceso no autorizado'}), 403
        
        
        # Obtener datos
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        if not worksheet_data:
            return jsonify({'data': [], 'formato': {}})
        
        return jsonify({
            'data': worksheet_data.data,
            'formato': worksheet_data.formato or {}
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/save', methods=['POST'])
def save_shared_worksheet_data(worksheet_id):
    """API para guardar datos de worksheet compartida (solo si es editable)"""
    try:
        token = request.args.get('token')
        access_type = request.args.get('access', 'edit')  # ⭐ CORREGIDO: Obtener access_type del request
        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        # ⭐ CORREGIDO: Simplificar validación de permisos de edición
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
            
        # Solo permitir edición si el permiso lo permite
        if permission.access_type not in ['edit', 'users']:
            return jsonify({'error': 'No tienes permisos de edición'}), 403
        
        # Verificar que el permiso esté activo (API guardado)
        if permission.access_type == 'users':
            try:
                user_count = permission.users.count() if hasattr(permission, 'users') and permission.users else 0
                # Los tokens de 'users' pueden funcionar sin usuarios específicos asignados
            except Exception as e:
                # Continuar - el token público sigue siendo válido
                pass
        
        # Obtener datos del request
        data = request.get_json()
        rows = data.get('data')
        formato = data.get('formato', {})
        
        if not isinstance(rows, list):
            return jsonify({'error': 'Datos inválidos'}), 400
        
        # ⭐ NUEVO: Registrar información del editor para el historial
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        
        if current_username and session.get('logged_in'):
            if is_admin:
                editor_info = f"admin ({current_username})"
            else:
                editor_info = current_username
        else:
            # Usuario anónimo
            user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'IP desconocida'))
            if ',' in user_ip:
                user_ip = user_ip.split(',')[0].strip()
            editor_info = f'Anónimo [{user_ip}]'
        

        
        # Guardar datos
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        new_timestamp = datetime.utcnow()
        
        if worksheet_data:
            worksheet_data.data = rows
            worksheet_data.formato = formato
            worksheet_data.last_editor = editor_info
            worksheet_data.last_edit_time = new_timestamp
        else:
            worksheet_data = WorksheetData(
                template_id=worksheet_id, 
                data=rows, 
                formato=formato,
                last_editor=editor_info,
                last_edit_time=new_timestamp
            )
            db.session.add(worksheet_data)
        
        db.session.commit()
        return jsonify({
            'success': True,
            'editor_info': editor_info,
            'timestamp': new_timestamp.isoformat()  # ⭐ NUEVO: Incluir timestamp en respuesta
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: SISTEMA DE SINCRONIZACIÓN EN TIEMPO REAL
# ============================================

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/changes', methods=['GET'])
def check_shared_worksheet_changes(worksheet_id):
    """API para verificar si hay cambios en worksheet compartida"""
    try:
        token = request.args.get('token')
        last_known_time = request.args.get('last_time')
        

        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 403
        
        # Obtener datos actuales
        worksheet_data = WorksheetData.query.filter_by(template_id=worksheet_id).first()
        
        if not worksheet_data:
            return jsonify({
                'has_changes': False,
                'last_edit_time': None,
                'last_editor': None
            })
        
        current_time = worksheet_data.last_edit_time
        
        # Convertir timestamps para comparación
        if current_time:
            current_timestamp = current_time.isoformat()
        else:
            current_timestamp = None
        
        # ⭐ MEJORADO: Verificación más robusta de cambios
        has_changes = False
        change_reason = "sin_cambios"
        
        if not last_known_time:
            if current_timestamp:
                has_changes = True
                change_reason = "primera_carga"
        elif not current_timestamp:
            pass
        else:
            # Comparación de timestamps
            if current_timestamp != last_known_time:
                has_changes = True
                change_reason = "timestamp_diferente"
        
        result = {
            'has_changes': has_changes,
            'last_edit_time': current_timestamp,
            'last_editor': worksheet_data.last_editor,
            'data': worksheet_data.data if has_changes else None,
            'formato': worksheet_data.formato if has_changes else None,
        }
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: SISTEMA DE PRESENCIA EN TIEMPO REAL
# ============================================

# ELIMINADO: Imports de viewers (código muerto)
# from app.store.presence import add_viewer, remove_viewer, get_active_viewers, cleanup_inactive_viewers

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/presence', methods=['POST'])
def update_presence(worksheet_id):
    """Actualizar presencia de usuario en worksheet"""
    try:
        token = request.args.get('token')
        data = request.get_json()
        
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Obtener información del usuario/IP
        user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'IP desconocida'))
        if ',' in user_ip:
            user_ip = user_ip.split(',')[0].strip()
        
        session_id = data.get('session_id') or f"anon_{user_ip}_{int(time.time())}"
        action = data.get('action', 'viewing')  # 'viewing' o 'left'
        
        # ⭐ NUEVO: Verificar si el usuario está logueado
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        

        
        if action == 'viewing':
            # ⭐ NUEVO: Determinar el nombre del usuario
            if current_username and session.get('logged_in'):
                if is_admin:
                    user_display_name = f"admin ({current_username})"
                else:
                    user_display_name = current_username
            else:
                # Usuario anónimo
                user_display_name = f'Anónimo [{user_ip}]'
            
            user_info = {
                'user': user_display_name,
                'ip': user_ip,
                'access_type': permission.access_type,
                'is_logged_user': session.get('logged_in', False)
            }
        # ELIMINADO: Llamadas a funciones de viewers (código muerto)
        # if action == 'viewing':
        #     add_viewer(worksheet_id, session_id, user_info)
        # elif action == 'left':
        #     remove_viewer(worksheet_id, session_id, is_real_disconnect=True)
        # 
        # cleanup_inactive_viewers(worksheet_id, timeout=600)
        
        return jsonify({'success': True, 'session_id': session_id})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ELIMINADO: Ruta de viewers compartidos (código muerto)
# @store_bp.route('/api/shared/worksheet/<int:worksheet_id>/viewers', methods=['GET'])

# ⭐ NUEVO: Endpoint para registrar actividad específica del usuario en modo compartido
@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/activity', methods=['POST'])
def register_shared_user_activity(worksheet_id):
    """API para registrar actividad específica del usuario compartido"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 403
        
        data = request.get_json()
        activity_type = data.get('activity_type', 'interaction')
        
        # Importar función de presencia
        from app.store.presence import update_user_activity
        
        # ⭐ NUEVO: Verificar si el usuario está logueado
        current_username = session.get('username')
        admin_user_config = current_app.config.get("ADMIN_USER", "admin")
        is_admin = current_username == admin_user_config
        
        if current_username and session.get('logged_in'):
            if is_admin:
                user_identifier = f"admin ({current_username})"
            else:
                user_identifier = current_username
        else:
            # Usuario anónimo
            user_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
            if ',' in user_ip:
                user_ip = user_ip.split(',')[0].strip()
            user_identifier = f"Anónimo [{user_ip}]"
        
        # Registrar actividad
        update_user_activity(worksheet_id, user_identifier)
        
        return jsonify({
            'success': True,
            'activity_type': activity_type,
            'user': user_identifier
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================
# ⭐ NUEVO: ENDPOINTS PARA HISTORIAL DE CAMBIOS (SISTEMA UNIFICADO)
# ============================================

# ⭐ NUEVO: Importar el sistema unificado de historial
from app.store.history_manager import (
    add_change_to_history, 
    get_worksheet_history, 
    clear_worksheet_history,
    merge_histories,
    validate_change
)

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/history', methods=['POST'])
def save_shared_worksheet_history(worksheet_id):
    """API para guardar historial de cambios de un worksheet (modo compartido) - SISTEMA UNIFICADO"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        data = request.get_json()
        change = data.get('change')
        full_history = data.get('full_history', [])
        
        if not change:
            return jsonify({'error': 'Datos de cambio requeridos'}), 400
        
        # Validar el cambio
        if not validate_change(change):
            return jsonify({'error': 'Datos de cambio inválidos'}), 400
        
        # Agregar el cambio al historial unificado
        success = add_change_to_history(worksheet_id, change)
        
        if success:
            # Obtener el historial actualizado
            current_history = get_worksheet_history(worksheet_id)
            

            
            return jsonify({
                'success': True,
                'message': 'Historial guardado correctamente',
                'total_changes': len(current_history),
                'history': current_history  # Devolver historial actualizado
            })
        else:
            return jsonify({'error': 'Error guardando el cambio'}), 500
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/history', methods=['GET'])
def get_shared_worksheet_history(worksheet_id):
    """API para obtener historial de cambios de un worksheet (modo compartido) - SISTEMA UNIFICADO"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Obtener historial del sistema unificado
        history = get_worksheet_history(worksheet_id)
        

        
        return jsonify({
            'success': True,
            'history': history,
            'total_changes': len(history)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@csrf_exempt_route
@store_bp.route('/api/shared/worksheet/<int:worksheet_id>/history', methods=['DELETE'])
def clear_shared_worksheet_history(worksheet_id):
    """API para limpiar historial de cambios de un worksheet (modo compartido) - ACCESO DENEGADO"""
    # ⭐ SEGURIDAD: Denegar acceso para limpiar historial en modo compartido
    
    return jsonify({
        'error': 'Acceso denegado',
        'message': 'Solo el administrador puede limpiar el historial de cambios'
    }), 403


# ============================================================================
# RUTAS PARA EL SISTEMA DE CHAT DE SOPORTE
# ============================================================================

from app.models.chat import ChatMessage, ChatSession
from app.models.user import User

@store_bp.route('/api/chat/send_message', methods=['POST'])
@store_access_required
def send_chat_message():
    """Enviar mensaje de chat con soporte para archivos"""
    
    
    # Procesar mensaje de chat
    try:
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        
        # Verificar el Content-Type para determinar cómo procesar la petición
        content_type = request.headers.get('Content-Type', '')
        
        # Verificar si la request excede el límite
        if 'Content-Length' in request.headers:
            content_length = int(request.headers['Content-Length'])
            max_content_length = current_app.config.get('MAX_CONTENT_LENGTH', 16 * 1024 * 1024)  # 16MB por defecto
            
            if content_length > max_content_length:
                # Request excede MAX_CONTENT_LENGTH
                return jsonify({
                    'status': 'error',
                    'message': f'El archivo es demasiado grande. Máximo permitido: {max_content_length // (1024*1024)}MB'
                }), 413

        
        if 'multipart/form-data' in content_type:
            # Es FormData (con o sin archivos)
            message = request.form.get('message', '').strip()
            recipient_id = request.form.get('recipient_id')
            

            
            # Obtener todos los archivos (file_0, file_1, file_2, etc.)
            files = []
            index = 0
            while f'file_{index}' in request.files:
                file = request.files[f'file_{index}']
                if file and file.filename:
                    # Verificar que el archivo tenga contenido real
                    # Flask puede reportar content_length = 0, pero el archivo puede tener contenido
                    file.seek(0, 2)  # Ir al final del archivo
                    actual_size = file.tell()
                    file.seek(0)  # Volver al inicio
                    
                    # Solo agregar archivos con contenido real
                    if actual_size > 0:

                        files.append(file)
                    else:
                        pass
                else:
                    pass
                index += 1
            
            # Verificar que haya archivos válidos si se enviaron
            if 'file_0' in request.files and len(files) == 0:
                return jsonify({
                    'status': 'error', 
                    'message': 'Error: Los archivos se corrompieron durante la transmisión. Intenta de nuevo.'
                }), 500
            
            # Permitir mensajes vacíos si hay archivos
            if not files and not message:
                return jsonify({'status': 'error', 'message': 'El mensaje o archivo no puede estar vacío'}), 400
            
            # Si hay archivos, el mensaje puede estar vacío
            if files and not message:
                message = ""  # Asegurar que el mensaje esté vacío, no None
        else:
            # Es JSON
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
            message = data.get('message', '').strip()
            recipient_id = data.get('recipient_id')
            files = []
            
            if not message:
                return jsonify({'status': 'error', 'message': 'El mensaje no puede estar vacío'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Determinar el tipo de mensaje
        message_type = 'user'
        if current_user.username == current_app.config.get('ADMIN_USER', 'admin'):
            message_type = 'admin'
        elif current_user.is_support:
            message_type = 'support'
        
        # Si es admin o soporte, el recipient_id es obligatorio
        if message_type in ['admin', 'support'] and not recipient_id:
            return jsonify({'status': 'error', 'message': 'ID de destinatario requerido'}), 400
        
        # Si es usuario normal, usar el recipient_id enviado por el frontend
        if message_type == 'user':
            # Si el frontend NO envió recipient_id, usar el admin por defecto
            if not recipient_id:
                admin_user = User.query.filter_by(username=current_app.config.get('ADMIN_USER', 'admin')).first()
                if not admin_user:
                    return jsonify({'status': 'error', 'message': 'Admin no disponible'}), 503
                recipient_id = admin_user.id
                pass
            else:
                pass
        elif not recipient_id:
            return jsonify({'status': 'error', 'message': 'ID de destinatario requerido'}), 400
        
        # Solo crear chat_message si hay mensaje de texto O si no hay archivos
        chat_message = None
        if message or not files:
            chat_message = ChatMessage(
                sender_id=current_user.id,
                recipient_id=recipient_id,
                message=message or "Mensaje sin texto",
                message_type=message_type
            )
            db.session.add(chat_message)
        else:
            pass
        
        # Procesar archivos si existen
        if files:
            import os
            from werkzeug.utils import secure_filename
            
            # Crear directorio de uploads si no existe
            upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')


            
            # Verificar si el directorio existe y tiene permisos
            if os.path.exists(upload_dir):

                # Verificar permisos
                try:
                    test_file = os.path.join(upload_dir, 'test_permissions.tmp')
                    with open(test_file, 'w') as f:
                        f.write('test')
                    os.remove(test_file)

                except Exception as perm_error:
                    # Error de permisos en directorio
                    return jsonify({
                        'status': 'error',
                        'message': f'Error de permisos en el directorio de uploads: {str(perm_error)}'
                    }), 500
            else:

                try:
                    os.makedirs(upload_dir, exist_ok=True)
                except Exception as dir_error:
                    # Error al crear directorio
                    return jsonify({
                        'status': 'error',
                        'message': f'Error al crear directorio de uploads: {str(dir_error)}'
                    }), 500
            
            # Procesar cada archivo
            for file in files:
                if file and file.filename:
                    # Verificar que el archivo tenga contenido REAL (no confiar en content_length)
                    file.seek(0, 2)  # Ir al final del archivo
                    file_size = file.tell()
                    file.seek(0)  # Volver al inicio
                    
                    # Solo verificar el tamaño real, no content_length
                    if file_size == 0:
                        continue
                    
                    # Generar nombre seguro
                    filename = secure_filename(file.filename)
                    timestamp = get_colombia_now().strftime('%Y%m%d_%H%M%S')
                    unique_filename = f"{timestamp}_{filename}"
                    
                    # Determinar tipo de archivo
                    if file.content_type.startswith('image/'):
                        file_type = 'image'
                    elif file.content_type.startswith('video/'):
                        file_type = 'video'
                    elif file.content_type.startswith('audio/'):
                        file_type = 'audio'
                    elif file.content_type == 'application/pdf':
                        file_type = 'application/pdf'
                    else:
                        file_type = 'unknown'
                    
                    # Verificar que el directorio existe antes de guardar
                    if not os.path.exists(upload_dir):
                        os.makedirs(upload_dir, exist_ok=True)
                    
                    # Guardar archivo
                    file_path = os.path.join(upload_dir, unique_filename)
                    
                    try:
                        # ✅ NUEVO: Verificar que el archivo tenga contenido antes de guardar
                        file.seek(0, 2)  # Ir al final
                        file_size_before = file.tell()
                        file.seek(0)  # Volver al inicio
                        
                        if file_size_before == 0:
                            continue
                        
                        # Guardar archivo
                        file.save(file_path)
                        
                        # Verificar inmediatamente después de guardar
                        if os.path.exists(file_path):
                            saved_size = os.path.getsize(file_path)
                            
                            # Verificar que el tamaño coincida
                            if saved_size != file_size_before:
                                # Intentar eliminar el archivo corrupto
                                try:
                                    os.remove(file_path)
                                except Exception as del_error:
                                    pass
                                continue
                        else:
                            continue
                            
                    except Exception as save_error:
                        # Error al guardar archivo
                        continue
                    
                    # Verificar que el archivo se guardó y tiene contenido
                    if os.path.exists(file_path):
                        saved_size = os.path.getsize(file_path)
                        
                        # Verificar que el archivo guardado no esté vacío
                        if saved_size == 0:
                            # Intentar eliminar el archivo vacío
                            try:
                                os.remove(file_path)
                            except Exception as del_error:
                                pass
                            continue
                    else:
                        continue
                    
                    # Crear mensaje para el archivo
                    file_message = ChatMessage(
                        sender_id=current_user.id,
                        recipient_id=recipient_id,
                        message=f"Archivo: {filename}",
                        message_type=message_type,
                        has_attachment=True,
                        attachment_type=file_type,
                        attachment_filename=filename,
                        attachment_path=unique_filename,
                        attachment_size=saved_size
                    )
                    
                    db.session.add(file_message)
                    
                    # Emitir evento SocketIO para archivos en tiempo real
                    try:
                        # Llamar al endpoint interno para emitir SocketIO
                        import requests
                        file_message_data = file_message.to_dict()
                        socketio_data = {
                            'message_data': file_message_data,
                            'sender_id': current_user.id,
                            'recipient_id': recipient_id
                        }
                        
                        # Llamada interna al endpoint SocketIO
                        response = requests.post(
                            'http://127.0.0.1:5002/api/chat/socketio_emit',
                            json=socketio_data,
                            headers={'Content-Type': 'application/json'}
                        )
                        
                        if response.status_code != 200:
                            pass
                        
                    except Exception as socket_error:
                        # No fallar si falla SocketIO
                        pass
        
        # Solo hacer commit si hay mensajes para guardar
        if chat_message or files:
            db.session.commit()
        else:
            pass
        
        # Actualizar sesión de chat solo si recipient_id es válido
        if recipient_id:
            try:
                session = ChatSession.get_or_create_session(recipient_id)
                session.update_activity()
            except Exception as e:
                # Si hay error con la sesión, continuar sin fallar
                pass
        
        # Solo almacenar en historial local si hay chat_message
        if chat_message:
            try:
                message_data = chat_message.to_dict()
                
                # Almacenar mensaje en historial local para ambos usuarios
                if message_type == 'user':
                    # Usuario normal enviando al soporte
                    # store_message no existe, saltamos esta parte por ahora
                    pass
                    
                elif message_type in ['admin', 'support']:
                    # Admin/soporte enviando a un usuario
                    # store_message no existe, saltamos esta parte por ahora
                    pass
                
                # Emitir evento SocketIO para actualización en tiempo real
                try:
                    # Llamar al endpoint interno para emitir SocketIO
                    import requests
                    socketio_data = {
                        'message_data': message_data,
                        'sender_id': current_user.id,
                        'recipient_id': recipient_id
                    }
                    
                    # Llamada interna al endpoint SocketIO
                    response = requests.post(
                        'http://127.0.0.1:5002/api/chat/socketio_emit',
                        json=socketio_data,
                        headers={'Content-Type': 'application/json'}
                    )
                    
                    if response.status_code != 200:
                        pass
                    
                except Exception as socket_error:
                    # No fallar si falla SocketIO
                    pass
            
            except Exception as e:
                # No fallar si falla el historial local
                pass
        else:
            pass
        
        # Verificar que todos los archivos se guardaron correctamente
        if files:
    
            corrupted_files = []
            
            for i, file in enumerate(files):
                if f'file_{i}' in request.files:
                    file_obj = request.files[f'file_{i}']
                    if file_obj and file_obj.filename:
                        filename = secure_filename(file_obj.filename)
                        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
                        unique_filename = f"{timestamp}_{filename}"
                        file_path = os.path.join(upload_dir, unique_filename)
                        
                        if os.path.exists(file_path):
                            final_size = os.path.getsize(file_path)
            
                            
                            # Verificar que el archivo no esté corrupto
                            if final_size == 0:
                                corrupted_files.append(unique_filename)
                        else:
                            corrupted_files.append(unique_filename)
            
            # Si hay archivos corruptos, no enviar el mensaje
            if corrupted_files:
                # Intentar limpiar archivos corruptos
                for corrupted_file in corrupted_files:
                    try:
                        corrupted_path = os.path.join(upload_dir, corrupted_file)
                        if os.path.exists(corrupted_path):
                            os.remove(corrupted_path)
                    except Exception as e:
                        pass
                
                return jsonify({
                    'status': 'error',
                    'message': 'Error: Los archivos se corrompieron durante el envío. Intenta de nuevo.'
                }), 500
        
        # Respuesta exitosa que maneja tanto mensajes como archivos
        if chat_message and files:
            # Hay tanto mensaje como archivos
            response_data = chat_message.to_dict()
            response_data['has_attachment'] = True
            response_data['attachment_count'] = len(files)
            response_message = 'Mensaje con archivos enviado correctamente'
        elif chat_message and not files:
            # Solo mensaje de texto
            response_data = chat_message.to_dict()
            response_message = 'Mensaje enviado correctamente'
        elif not chat_message and files:
            # Solo archivos (sin mensaje de texto) - incluir TODOS los archivos enviados
            # Obtener información de TODOS los archivos procesados exitosamente
            all_file_messages = []
            if files and len(files) > 0:
                # Buscar TODOS los archivos procesados en esta sesión
                recent_messages = db.session.query(ChatMessage).filter_by(
                    sender_id=current_user.id,
                    recipient_id=recipient_id,
                    has_attachment=True
                ).order_by(ChatMessage.created_at.desc()).limit(len(files)).all()
                
                # Invertir para mantener el orden original
                recent_messages.reverse()
                
                for file_message in recent_messages:
                    file_info = file_message.to_dict()
                    all_file_messages.append(file_info)
                
                if all_file_messages:
                    # Devolver ARRAY con todos los archivos
                    response_data = all_file_messages
                    response_message = f'{len(all_file_messages)} archivos enviados correctamente'
                else:
                    # Fallback si no se encuentran los archivos
                    response_data = {
                        'id': 'files_only',
                        'message': 'Archivos enviados',
                        'has_attachment': True,
                        'attachment_count': len(files),
                        'sender_id': current_user.id,
                        'recipient_id': recipient_id,
                        'message_type': message_type,
                        'created_at': get_colombia_now().isoformat(),
                        'attachment_type': 'unknown',
                        'attachment_filename': 'Archivo enviado',
                        'attachment_path': 'unknown'
                    }
                    response_message = 'Archivos enviados correctamente'
            else:
                # No hay archivos
                response_data = {'error': 'No hay archivos para enviar'}
                response_message = 'Error: No hay archivos para enviar'
        else:
            # No debería llegar aquí, pero por seguridad
            response_data = {'error': 'No hay mensaje ni archivos'}
            response_message = 'Error: No hay contenido para enviar'
        
        return jsonify({
            'status': 'success',
            'message': response_message,
            'data': response_data
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Error interno del servidor. Intenta de nuevo.'}), 500

# Limpiar archivos corruptos
@store_bp.route('/api/chat/cleanup_corrupted_files', methods=['POST'])
@store_access_required
def cleanup_corrupted_files():
    """Limpiar archivos corruptos o vacíos del chat"""
    try:
        import os
        
        # Directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        if not os.path.exists(upload_dir):
            return jsonify({'status': 'error', 'message': 'Directorio de uploads no encontrado'}), 404
        
        # Buscar archivos corruptos
        corrupted_files = []
        total_files = 0
        
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if os.path.isfile(file_path):
                total_files += 1
                file_size = os.path.getsize(file_path)
                
                if file_size == 0:
                    corrupted_files.append(filename)
        
        # Eliminar archivos corruptos
        deleted_count = 0
        for filename in corrupted_files:
            try:
                file_path = os.path.join(upload_dir, filename)
                os.remove(file_path)
                deleted_count += 1
            except Exception as e:
                pass
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza completada. {deleted_count} archivos corruptos eliminados de {total_files} total.',
            'deleted_count': deleted_count,
            'total_files': total_files
        })
        
    except Exception as e:
        # Error en limpieza de archivos
        return jsonify({'status': 'error', 'message': 'Error al limpiar archivos corruptos'}), 500


# Regenerar lista de archivos
@store_bp.route('/api/chat/regenerate_files', methods=['POST'])
@store_access_required
def regenerate_files():
    """Regenerar lista de archivos disponibles"""
    try:
        import os
        
        # Directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        if not os.path.exists(upload_dir):
            return jsonify({'status': 'error', 'message': 'Directorio de uploads no encontrado'}), 404
        
        # Listar todos los archivos válidos
        valid_files = []
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if os.path.isfile(file_path):
                file_size = os.path.getsize(file_path)
                if file_size > 0:
                    valid_files.append({
                        'filename': filename,
                        'size': file_size,
                        'path': file_path
                    })
        
        return jsonify({
            'status': 'success',
            'message': f'Lista regenerada. {len(valid_files)} archivos válidos encontrados.',
            'files': valid_files
        })
        
    except Exception as e:
        # Error al regenerar lista de archivos
        return jsonify({'status': 'error', 'message': 'Error al regenerar lista de archivos'}), 500

# Verificar archivo específico
@store_bp.route('/api/chat/check_file/<filename>', methods=['GET'])
@store_access_required
def check_file(filename):
    """Verificar si un archivo específico existe y es accesible"""
    try:
        import os
        
        # Directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        file_path = os.path.join(upload_dir, filename)
        
        if not os.path.exists(upload_dir):
            return jsonify({
                'status': 'error',
                'message': 'Directorio de uploads no encontrado',
                'exists': False
            }), 404
        
        if not os.path.exists(file_path):
            return jsonify({
                'status': 'error',
                'message': 'Archivo no encontrado',
                'exists': False,
                'filename': filename,
                'upload_dir': upload_dir
            }), 404
        
        if not os.path.isfile(file_path):
            return jsonify({
                'status': 'error',
                'message': 'No es un archivo válido',
                'exists': False
            }), 400
        
        file_size = os.path.getsize(file_path)
        
        return jsonify({
            'status': 'success',
            'message': 'Archivo encontrado',
            'exists': True,
            'filename': filename,
            'size': file_size,
            'path': file_path
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al verificar archivo: {str(e)}'}), 500

# Forzar estado finished para testing
@store_bp.route('/api/chat/force_finished_status', methods=['POST'])
@store_access_required
def force_finished_status():
    """Forzar estado finished para testing (solo admin)"""
    try:
        # Procesar petición para forzar estado finished
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
        
        user_id = data.get('user_id')
        if not user_id:
            return jsonify({'status': 'error', 'message': 'user_id es requerido'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin puede forzar estados
        if current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'Solo el administrador puede forzar estados'}), 403
        
        # Forzar estado finished
        try:
            from app.models.chat import ChatSession
            
            chat_session = ChatSession.query.filter_by(user_id=user_id).first()
            if not chat_session:
                # Crear nueva sesión si no existe
                chat_session = ChatSession(user_id=user_id)
                db.session.add(chat_session)
            
            # Forzar estado finished
            chat_session.update_chat_status('finished')
            
            # Estado forzado a finished
            
            return jsonify({
                'status': 'success',
                'message': 'Estado forced a finished correctamente',
                'data': {
                    'user_id': user_id,
                    'status': 'finished',
                    'forced_by': current_user.username
                }
            })
            
        except Exception as e:
            # Error al forzar estado finished
            db.session.rollback()
            return jsonify({'status': 'error', 'message': 'Error al forzar estado'}), 500
        
    except Exception as e:
        # Error al forzar estado finished
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500

# Enviar mensaje del sistema (para chat finalizado)
@store_bp.route('/api/chat/send_system_message', methods=['POST'])
@store_access_required
def send_system_message():
    """Enviar mensaje del sistema (para chat finalizado)"""
    try:
        # Procesar petición para enviar mensaje del sistema
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
        
        user_id = data.get('user_id')
        message = data.get('message')
        message_type = data.get('message_type', 'system')
        
        if not user_id or not message:
            return jsonify({'status': 'error', 'message': 'user_id y message son requeridos'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin y usuarios de soporte pueden enviar mensajes del sistema
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'No tienes permisos para enviar mensajes del sistema'}), 403
        
        # Crear y guardar el mensaje del sistema en la base de datos
        try:
            from app.models.chat import ChatMessage
            from app.models.user import User
            
            # Crear el mensaje del sistema
            system_message = ChatMessage(
                sender_id=current_user.id,  # El admin/soporte es el "remitente"
                recipient_id=user_id,
                message=message,
                message_type='system'  # Usar message_type='system' en lugar de is_system
            )
            
            db.session.add(system_message)
            db.session.commit()
            
            # Mensaje del sistema guardado correctamente
            
            return jsonify({
                'status': 'success',
                'message': 'Mensaje del sistema enviado correctamente',
                'data': {
                    'message_id': system_message.id,
                    'user_id': user_id,
                    'message': message,
                    'message_type': 'system',  # Siempre 'system'
                    'created_at': system_message.created_at.isoformat() if system_message.created_at else None
                }
            })
            
        except Exception as e:
            # Error al guardar mensaje del sistema
            db.session.rollback()
            return jsonify({'status': 'error', 'message': 'Error al guardar mensaje del sistema'}), 500
        
    except Exception as e:
        # Error al enviar mensaje del sistema
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500

# Limpiar estados obsoletos del chat
@store_bp.route('/api/chat/cleanup_obsolete_statuses', methods=['POST'])
@store_access_required
def cleanup_obsolete_chat_statuses():
    """Limpiar estados obsoletos del chat (finished cuando hay mensajes nuevos)"""
    try:
        # Iniciar limpieza de estados obsoletos
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin y usuarios de soporte pueden limpiar estados
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'No tienes permisos para limpiar estados'}), 403
        
        from app.models.chat import ChatSession, ChatMessage
        
        # Buscar sesiones con estado 'finished' que tengan mensajes nuevos
        finished_sessions = ChatSession.query.filter_by(status='finished').all()
        cleaned_count = 0
        
        for session in finished_sessions:
            if session.last_activity:
                # Verificar si hay mensajes más recientes
                newer_messages = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == session.user_id,
                        ChatMessage.recipient_id == session.user_id
                    ),
                    ChatMessage.created_at > session.last_activity
                ).count()
                
                if newer_messages > 0:
                    # Hay mensajes nuevos, recalcular estado
                    last_message = ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == session.user_id,
                            ChatMessage.recipient_id == session.user_id
                        )
                    ).order_by(ChatMessage.created_at.desc()).first()
                    
                    if last_message:
                        # Determinar nuevo estado basándose en el último mensaje
                        admin_username = current_app.config.get('ADMIN_USER', 'admin')
                        admin_user = User.query.filter_by(username=admin_username).first()
                        support_users = User.query.filter_by(is_support=True).all()
                        support_user_ids = [u.id for u in support_users]
                        
                        if last_message.sender_id == session.user_id:
                            new_status = 'new_message'  # 🟢 Verde
                        elif last_message.sender_id != session.user_id and (last_message.sender_id == admin_user.id or last_message.sender_id in support_user_ids):
                            new_status = 'responded'  # 🔵 Azul
                        else:
                            new_status = 'pending'  # ⚪ Gris
                        
                        # Actualizar estado
                        session.update_chat_status(new_status)
                        cleaned_count += 1
                        # Sesión limpiada correctamente
        
        # Limpieza completada
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza completada. {cleaned_count} estados obsoletos actualizados',
            'data': {
                'cleaned_count': cleaned_count,
                'updated_by': current_user.username
            }
        })
        
    except Exception as e:
        # Error al limpiar estados obsoletos
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500

# Actualizar estado del chat (finalizado, respondido, etc.)
@store_bp.route('/api/chat/update_chat_status', methods=['POST'])
@store_access_required
def update_chat_status():
    """Actualizar estado del chat (finalizado, respondido, etc.)"""
    try:
        # Procesar petición para actualizar estado del chat
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos JSON requeridos'}), 400
        
        user_id = data.get('user_id')
        new_status = data.get('status')
        
        if not user_id or not new_status:
            return jsonify({'status': 'error', 'message': 'user_id y status son requeridos'}), 400
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Solo admin y usuarios de soporte pueden actualizar estados
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            return jsonify({'status': 'error', 'message': 'No tienes permisos para actualizar estados'}), 403
        
        # Almacenar el estado del chat en la base de datos
        try:
            from app.models.chat import ChatSession
            chat_session = ChatSession.get_or_create_session(user_id)
            chat_session.update_chat_status(new_status)
            # Estado del chat actualizado correctamente
        except Exception as e:
            # Error al actualizar sesión de chat
            # Si falla, continuar sin afectar la respuesta
            pass
        
        return jsonify({
            'status': 'success',
            'message': 'Estado del chat actualizado correctamente',
            'data': {
                'user_id': user_id,
                'status': new_status,
                'updated_by': current_user.username
            }
        })
        
    except Exception as e:
        # Error al actualizar estado del chat
        return jsonify({'status': 'error', 'message': 'Error interno del servidor'}), 500



@store_bp.route('/api/chat/get_messages', methods=['GET'])
@store_access_required
def get_chat_messages():
    """Obtener mensajes de chat"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Para usuarios normales, obtener conversación con soporte
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            # Obtener TODOS los mensajes donde el usuario esté involucrado
            messages = ChatMessage.query.filter(
                db.or_(
                    ChatMessage.sender_id == current_user.id,
                    ChatMessage.recipient_id == current_user.id
                )
            ).order_by(ChatMessage.created_at.asc()).limit(100).all()
        else:
            # Para admin/soporte, obtener conversación normal
            messages = ChatMessage.get_conversation(current_user.id, limit=100)
        
        # Marcar mensajes como leídos
        ChatMessage.mark_as_read(current_user.id)
        
        # Convertir a formato JSON
        messages_data = [msg.to_dict() for msg in messages]
        
        return jsonify({
            'status': 'success',
            'data': messages_data
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/get_user_messages', methods=['GET'])
@store_access_required
def get_user_chat_messages():
    """Obtener mensajes de chat para usuarios normales (con restricciones de tienda)"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        # El decorador @store_access_required ya verifica la autenticación
        # Usar get_current_user() que es más robusto
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        

        
        # Obtener TODOS los mensajes donde el usuario esté involucrado
        # Esto incluye mensajes enviados POR el usuario y mensajes enviados AL usuario
        messages = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == current_user.id,
                ChatMessage.recipient_id == current_user.id
            )
        ).order_by(ChatMessage.created_at.asc()).limit(100).all()
        
        # Marcar mensajes como leídos
        ChatMessage.mark_as_read(current_user.id)
        
        # Convertir a formato JSON
        messages_data = [msg.to_dict() for msg in messages]
        
        return jsonify({
            'status': 'success',
            'data': messages_data
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/get_all_conversations', methods=['GET'])
@store_access_required
def get_all_chat_conversations():
    """Obtener todas las conversaciones y estadísticas (solo admin/soporte)"""
    try:
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que solo admin o soporte puedan acceder
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if not current_user.is_support and current_user.username != admin_username:
            return jsonify({'status': 'error', 'message': 'No tienes permisos para acceder a esta información'}), 403
        
        # Obtener TODOS los usuarios (excluyendo al admin) para mostrar en la lista
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        users_with_chat = User.query.filter(
            User.username != admin_user
        ).all()
        
        # Obtener sesiones activas
        active_sessions = ChatSession.get_active_sessions()
        
        # Obtener estadísticas
        total_messages = ChatMessage.query.count()
        unread_messages = ChatMessage.query.filter_by(is_read=False).count()
        
        # Preparar lista de usuarios con información de mensajes no leídos y último mensaje
        users_list = []
        for user in users_with_chat:
            # Excluir usuarios de soporte de la lista de chats
            if user.is_support:
                continue
                
            # Verificar si el usuario realmente tiene mensajes en la base de datos
            message_count = ChatMessage.query.filter(
                db.or_(
                    ChatMessage.sender_id == user.id,
                    ChatMessage.recipient_id == user.id
                )
            ).count()
            
            # Solo incluir usuarios que tengan mensajes (conversaciones activas)
            if message_count > 0:
                # Para el admin, usar la lógica correcta de unread_count
                unread_count = ChatMessage.get_unread_count_for_admin(user.id)
                
                # Obtener último mensaje del usuario
                last_message = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user.id,
                        ChatMessage.recipient_id == user.id
                    )
                ).order_by(ChatMessage.created_at.desc()).first()
                
                if last_message:
                    # Formatear mensaje para mostrar solo extensión si es archivo
                    message_text = last_message.message
                    if last_message.has_attachment and last_message.attachment_filename:
                        # Extraer extensión del archivo
                        import os
                        file_extension = os.path.splitext(last_message.attachment_filename)[1]
                        if file_extension:
                            message_text = f"[Archivo{file_extension}]"
                        else:
                            message_text = "[Archivo]"
                    elif len(last_message.message) > 50:
                        message_text = last_message.message[:50] + '...'
                    
                    last_message_data = {
                        'message': message_text,
                        'time': last_message.created_at.isoformat() if last_message.created_at else None
                    }
                    
                    users_list.append({
                        'id': user.id,
                        'username': user.username,
                        'parent_id': user.parent_id,
                        'can_chat': user.can_chat,  # Agregar estado del chat
                        'unread_count': unread_count,
                        'last_message': last_message_data['message'],
                        'last_message_time': last_message_data['time']
                    })
        
        # Ordenar usuarios por último mensaje (más reciente primero)
        users_list.sort(key=lambda x: x['last_message_time'] or '', reverse=True)
        
        # Obtener todas las conversaciones
        messages = ChatMessage.get_all_conversations_for_support(limit=200)
        
        # Devolver TODOS los mensajes en orden cronológico, NO agrupados por usuario
        all_messages = []
        for msg in messages:
            all_messages.append(msg.to_dict())
        
        # Ordenar por fecha (más antiguo primero para el frontend)
        all_messages.sort(key=lambda x: x.get('created_at', ''))
        
        return jsonify({
            'status': 'success',
            'data': all_messages,  # Lista plana de mensajes
            'users_with_chat': users_list,
            'stats': {
                'total_messages': total_messages,
                'unread_messages': unread_messages,
                'users_with_chat': len(users_with_chat),
                'active_sessions': len(active_sessions)
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener conversaciones: {str(e)}'}), 500

@store_bp.route('/api/chat/get_users_with_chat', methods=['GET'])
@store_access_required
def get_users_with_chat():
    """Obtener lista de usuarios con chat activo (solo admin/soporte)"""
    try:
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que solo admin o soporte puedan acceder
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if not current_user.is_support and current_user.username != admin_username:
            return jsonify({'status': 'error', 'message': 'No tienes permisos para acceder a esta información'}), 403
        
        # Obtener usuarios que tengan mensajes de chat (excluyendo admin y soporte)
        admin_user = current_app.config.get("ADMIN_USER", "admin")
        users_with_chat = User.query.filter(
            User.username != admin_user,
            User.is_support == False
        ).all()
        
        
        
        # Preparar lista de usuarios con información de chat
        users_list = []
        for user in users_with_chat:
            try:
                # Verificar si el usuario tiene mensajes
                from app.models.chat import ChatMessage
                message_count = ChatMessage.query.filter(
                    db.or_(
                        ChatMessage.sender_id == user.id,
                        ChatMessage.recipient_id == user.id
                    )
                ).count()
                
                # Solo incluir usuarios que tengan mensajes
                if message_count > 0:
                    # Obtener mensajes no leídos para el admin
                    unread_count = ChatMessage.get_unread_count_for_admin(user.id)
                    
                    # Obtener último mensaje
                    last_message = ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == user.id,
                            ChatMessage.recipient_id == user.id
                        )
                    ).order_by(ChatMessage.created_at.desc()).first()
                    
                    if last_message:
                        # Formatear mensaje para mostrar solo extensión si es archivo
                        message_text = last_message.message
                        if last_message.has_attachment and last_message.attachment_filename:
                            # Extraer extensión del archivo
                            import os
                            file_extension = os.path.splitext(last_message.attachment_filename)[1]
                            if file_extension:
                                message_text = f"[Archivo{file_extension}]"
                            else:
                                message_text = "[Archivo]"
                        elif len(last_message.message) > 50:
                            message_text = last_message.message[:50] + '...'
                        
                        last_message_data = {
                            'message': message_text,
                            'time': last_message.created_at.isoformat() if last_message.created_at else None
                        }
                        
                        # Lógica simplificada y más robusta para determinar el estado del chat
                        chat_status = 'pending'  # Estado por defecto
                        
                        try:
                            # Verificar si el chat está finalizado por mensaje del sistema
                            if last_message and 'Chat finalizado, gracias por contactarnos' in last_message.message:
                                chat_status = 'finished'
                            elif last_message.message_type == 'system':
                                chat_status = 'finished'
                            elif last_message.sender_id == user.id:
                                # Si el último mensaje es del usuario normal, es NEW_MESSAGE (verde)
                                chat_status = 'new_message'
                            else:
                                # Si el último mensaje es de admin/soporte, es RESPONDED (azul)
                                chat_status = 'responded'
                        except Exception as e:
                            # Si hay error, usar pending por defecto
                            chat_status = 'pending'
                        
                        users_list.append({
                            'id': user.id,
                            'username': user.username,
                            'parent_id': user.parent_id,
                            'can_chat': getattr(user, 'can_chat', True),
                            'unread_count': unread_count,
                            'last_message': last_message_data['message'],
                            'last_message_time': last_message_data['time'],
                            'chat_status': chat_status
                        })
            except Exception as user_error:
                # Si hay error procesando un usuario específico, continuar con el siguiente
                continue
        
        # Ordenar por último mensaje (más reciente primero)
        users_list.sort(key=lambda x: x['last_message_time'] or '', reverse=True)
        
        # Usuarios con chat activo
        
        # Si no hay usuarios con chat, devolver lista vacía pero exitosa
        if not users_list:
            # No hay usuarios con chat activo
            return jsonify({
                'status': 'success',
                'data': [],
                'message': 'No hay usuarios con chat activo'
            })
        
        return jsonify({
            'status': 'success',
            'data': users_list
        })
        
    except Exception as e:
        # Error en get_users_with_chat
        # Error en get_users_with_chat
        return jsonify({'status': 'error', 'message': f'Error al obtener usuarios: {str(e)}'}), 500



@store_bp.route('/api/chat/get_user_conversation/<int:user_id>', methods=['GET'])
@store_access_required
def get_user_chat_conversation(user_id):
    """Obtener conversación específica de un usuario (solo admin/soporte)"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que solo admin o soporte puedan acceder
        admin_username = current_app.config.get('ADMIN_USER', 'admin')
        if not current_user.is_support and current_user.username != admin_username:
            return jsonify({'status': 'error', 'message': 'No tienes permisos para acceder a esta conversación'}), 403
        
        # Verificar que el usuario existe
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        

        messages = ChatMessage.get_conversation(user_id, limit=100)
        messages_data = [msg.to_dict() for msg in messages]
        
        # Marcar mensajes como leídos desde la perspectiva del admin
        ChatMessage.mark_as_read_for_admin(user_id)
        
        return jsonify({
            'status': 'success',
            'data': messages_data,
            'user_info': {
                'id': user.id,
                'username': user.username,
                'is_support': user.is_support
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener conversación: {str(e)}'}), 500

@store_bp.route('/api/chat/get_unread_count', methods=['GET'])
@store_access_required
def get_unread_chat_count():
    """Obtener cantidad de mensajes no leídos"""
    try:
        # Importar modelo
        from app.models.chat import ChatMessage
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        unread_count = ChatMessage.get_unread_count(current_user.id)
        
        return jsonify({
            'status': 'success',
            'data': {'unread_count': unread_count}
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al obtener conteo: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_old_messages', methods=['POST'])
@admin_required
def cleanup_old_chat_messages():
    """Limpiar mensajes antiguos con días personalizables"""
    try:
        from app.models.chat import ChatMessage
        
        # Obtener días desde el request
        data = request.get_json()
        days = 7  # Valor por defecto
        
        if data and 'days' in data:
            try:
                days = int(data['days'])
                # Validar rango de días (1-365)
                if days < 1 or days > 365:
                    return jsonify({'status': 'error', 'message': 'Días deben estar entre 1 y 365'}), 400
            except (ValueError, TypeError) as e:
                return jsonify({'status': 'error', 'message': 'Días debe ser un número válido'}), 400
        else:
            pass
        
        # Ejecutar limpieza con días personalizados
        result = ChatMessage.cleanup_old_messages(days=days)
        
        return jsonify({
            'status': 'success',
            'message': f'Se eliminaron {result["messages_deleted"]} mensajes antiguos (más de {days} días), {result["sessions_deleted"]} sesiones, {result["files_deleted"]} archivos y {result["orphaned_files_deleted"]} archivos huérfanos. También se limpiaron chats de {result["support_users_cleaned"]} usuarios de soporte.',
            'data': {
                'deleted_count': result["messages_deleted"],
                'sessions_deleted': result["sessions_deleted"],
                'files_deleted': result["files_deleted"],
                'orphaned_files_deleted': result["orphaned_files_deleted"],
                'support_users_cleaned': result["support_users_cleaned"],
                'days_used': days
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al limpiar mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_all_messages', methods=['POST'])
@admin_required
def cleanup_all_chat_messages():
    """Limpiar TODOS los mensajes del chat (función agresiva)"""
    try:
        from app.models.chat import ChatMessage
        
        # Ejecutar limpieza completa
        result = ChatMessage.cleanup_all_messages()
        
        return jsonify({
            'status': 'success',
            'message': f'✅ LIMPIEZA COMPLETA FINALIZADA!\n\nSe eliminaron:\n• {result["messages_deleted"]} mensajes\n• {result["sessions_deleted"]} sesiones\n• {result["files_deleted"]} archivos\n• {result["orphaned_files_deleted"]} archivos huérfanos\n\nTotal: {result["total_cleaned"]} elementos eliminados',
            'data': {
                'messages_deleted': result['messages_deleted'],
                'sessions_deleted': result['sessions_deleted'],
                'files_deleted': result['files_deleted'],
                'orphaned_files_deleted': result['orphaned_files_deleted'],
                'total_cleaned': result['total_cleaned']
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al limpiar todos los mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_orphaned_files', methods=['POST'])
@admin_required
def cleanup_orphaned_files():
    """Limpiar solo archivos huérfanos (archivos sin mensaje asociado)"""
    try:
        from app.models.chat import ChatMessage
        
        # Ejecutar limpieza de archivos huérfanos
        result = ChatMessage.cleanup_orphaned_files()
        
        return jsonify({
            'status': 'success',
            'message': f'✅ LIMPIEZA DE ARCHIVOS HUÉRFANOS COMPLETADA!\n\nSe eliminaron {result["orphaned_files_deleted"]} archivos huérfanos.',
            'data': {
                'orphaned_files_deleted': result['orphaned_files_deleted']
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al limpiar archivos huérfanos: {str(e)}'}), 500




    """API para obtener historial unificado (modo compartido)"""
    try:
        token = request.args.get('token')
        if not token:
            return jsonify({'error': 'Token requerido'}), 400
        
        # Verificar permiso
        permission = WorksheetPermission.query.filter_by(
            worksheet_id=worksheet_id,
            public_token=token
        ).first()
        
        if not permission:
            return jsonify({'error': 'Token inválido'}), 400
        
        # Obtener estadísticas del historial
        from app.store.history_manager import get_history_stats
        stats = get_history_stats()
        
        # Obtener estadísticas
        from app.store.history_manager import get_history_stats
        stats = get_history_stats()
        
        # Obtener historial actual
        history = get_worksheet_history(worksheet_id)
        
        return jsonify({
            'success': True,
            'worksheet_id': worksheet_id,
            'history_count': len(history),
            'history': history,
            'stats': stats,
            'message': f'Historial obtenido para worksheet {worksheet_id}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500




@store_bp.route('/store/static/uploads/chat/<filename>')
def serve_chat_file(filename):
    """Servir archivos de chat (imágenes, videos, audio)"""
    try:
        # Verificar que el archivo existe
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        file_path = os.path.join(upload_dir, filename)
        
        # Verificar que el directorio existe
        if not os.path.exists(upload_dir):
            return jsonify({'error': 'Directorio de archivos no encontrado'}), 404
        
        # Verificar que el archivo existe
        if not os.path.exists(file_path):
            return jsonify({'error': 'Archivo no encontrado'}), 404
        
        # Verificar que es un archivo válido
        if not os.path.isfile(file_path):
            return jsonify({'error': 'No es un archivo válido'}), 400
        
        # Determinar el tipo MIME basado en la extensión
        import mimetypes
        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = 'application/octet-stream'
        
        # Usar send_file con parámetros correctos para streaming
        if mime_type and mime_type.startswith('audio/'):
            # Para audio, usar send_file con as_attachment=False para streaming
            return send_file(
                file_path, 
                mimetype=mime_type,
                as_attachment=False,
                conditional=True  # Soporte para range requests
            )
        else:
            # Para archivos que no son audio, usar send_file normal
            return send_file(file_path, mimetype=mime_type)
            
    except Exception as e:
        return jsonify({'error': f'Error al servir archivo: {str(e)}'}), 500

@store_bp.route('/api/chat/sync_messages', methods=['GET'])
@store_access_required
def sync_messages():
    """Sincronizar mensajes perdidos desde una fecha específica"""
    try:
        from app.models.chat import ChatMessage
        from datetime import datetime, timedelta
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Obtener parámetros
        since_id = request.args.get('since')
        since_time = request.args.get('since_time')
        limit = int(request.args.get('limit', 50))
        
        # Construir consulta base
        query = ChatMessage.query
        
        # Filtrar por usuario
        if not current_user.is_support and current_user.username != current_app.config.get('ADMIN_USER', 'admin'):
            # Usuario normal: obtener mensajes donde esté involucrado
            query = query.filter(
                db.or_(
                    ChatMessage.sender_id == current_user.id,
                    ChatMessage.recipient_id == current_user.id
                )
            )
        else:
            # Admin/soporte: obtener todos los mensajes
            pass
        
        # Aplicar filtros de tiempo
        if since_id:
            # Filtrar por ID de mensaje
            since_message = ChatMessage.query.get(since_id)
            if since_message:
                query = query.filter(ChatMessage.created_at > since_message.created_at)
        elif since_time:
            # Filtrar por timestamp
            try:
                since_datetime = datetime.fromisoformat(since_time.replace('Z', '+00:00'))
                query = query.filter(ChatMessage.created_at > since_datetime)
            except ValueError:
                return jsonify({'status': 'error', 'message': 'Formato de fecha inválido'}), 400
        else:
            # Si no se especifica, obtener mensajes de las últimas 24 horas
            since_datetime = datetime.utcnow() - timedelta(hours=24)
            query = query.filter(ChatMessage.created_at > since_datetime)
        
        # Ordenar y limitar
        messages = query.order_by(ChatMessage.created_at.asc()).limit(limit).all()
        
        # Convertir a formato JSON
        messages_data = [msg.to_dict() for msg in messages]
        
        return jsonify({
            'status': 'success',
            'data': messages_data,
            'count': len(messages_data),
            'sync_time': get_colombia_now().isoformat()
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al sincronizar mensajes: {str(e)}'}), 500

@store_bp.route('/api/chat/send_audio', methods=['POST'])
@store_access_required
def send_audio_message():
    """Enviar mensaje de audio grabado"""
    try:
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        # Verificar que se haya enviado un archivo de audio
        if 'audio' not in request.files:
            return jsonify({'status': 'error', 'message': 'No se envió archivo de audio'}), 400
        
        audio_file = request.files['audio']
        recipient_id = request.form.get('recipient_id')
        
        if not audio_file or not audio_file.filename:
            return jsonify({'status': 'error', 'message': 'Archivo de audio inválido'}), 400
        
        if not recipient_id:
            return jsonify({'status': 'error', 'message': 'ID de destinatario requerido'}), 400
        
        # Determinar tipo de mensaje
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        if current_user.username == admin_username:
            message_type = 'admin'
        elif current_user.username in ['soporte', 'soporte1', 'soporte2', 'soporte3']:
            message_type = 'support'
        else:
            message_type = 'user'
        
        # Procesar archivo de audio
        import os
        from werkzeug.utils import secure_filename
        
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        os.makedirs(upload_dir, exist_ok=True)
        
        # Crear nombre único para el archivo con extensión correcta
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        
        # Determinar extensión basada en el tipo MIME del archivo
        content_type = audio_file.content_type
        if content_type:
            if 'webm' in content_type:
                extension = '.webm'
            elif 'mp4' in content_type:
                extension = '.mp4'
            elif 'ogg' in content_type:
                extension = '.ogg'
            else:
                extension = '.wav'
        else:
            # Fallback: usar extensión del nombre original
            original_name = audio_file.filename
            if '.' in original_name:
                extension = '.' + original_name.split('.')[-1]
            else:
                extension = '.wav'
        
        filename = f"audio_{timestamp}_{current_user.username}{extension}"
        file_path = os.path.join(upload_dir, filename)
        
        # Guardar archivo de audio
        audio_file.save(file_path)
        
        # Crear mensaje de chat
        chat_message = ChatMessage(
            sender_id=current_user.id,
            recipient_id=recipient_id,
            message="",  # Sin texto para audios
            message_type=message_type,
            has_attachment=True,
            attachment_type='audio',
            attachment_filename=filename,
            attachment_path=filename,
            attachment_size=os.path.getsize(file_path)
        )
        
        db.session.add(chat_message)
        db.session.commit()
        
        # Actualizar sesión de chat
        session = ChatSession.get_or_create_session(recipient_id)
        session.update_activity()
        
        # Forzar commit para asegurar que el audio esté disponible inmediatamente
        db.session.commit()
        
        # Emitir mensaje de audio por SocketIO en tiempo real
        try:
            # Preparar datos para SocketIO
            message_dict = chat_message.to_dict()
            
            socketio_data = {
                'message_data': message_dict,
                'sender_id': current_user.id,
                'recipient_id': str(recipient_id)
            }
            
            # Llamar al servidor SocketIO para emitir en tiempo real
            socketio_response = requests.post(
                'http://127.0.0.1:5002/api/chat/socketio_emit',
                json=socketio_data,
                timeout=5
            )
            
            if socketio_response.status_code != 200:
                pass
                
        except Exception as socketio_error:
            pass
        
        return jsonify({
            'status': 'success',
            'message': 'Audio enviado correctamente',
            'data': chat_message.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'status': 'error', 'message': f'Error al enviar audio: {str(e)}'}), 500


@store_bp.route('/api/chat/audio/<int:message_id>')
@store_access_required
def get_audio_file(message_id):
    """Servir archivo de audio por ID de mensaje"""
    try:
        from app.models.chat import ChatMessage
        
        # Buscar el mensaje
        chat_message = ChatMessage.query.get(message_id)
        if not chat_message:
            return jsonify({'status': 'error', 'message': 'Mensaje no encontrado'}), 404
        
        # Verificar que sea un mensaje de audio
        if not chat_message.has_attachment or chat_message.attachment_type != 'audio':
            return jsonify({'status': 'error', 'message': 'No es un mensaje de audio'}), 400
        
        # Construir ruta del archivo
        import os
        # Usar attachment_path en lugar de attachment_filename
        file_path = os.path.join(
            current_app.root_path, 
            'store', 
            'static', 
            'uploads', 
            'chat', 
            chat_message.attachment_path or chat_message.attachment_filename
        )
        
        # Verificar que el archivo existe
        if not os.path.exists(file_path):
            return jsonify({'status': 'error', 'message': 'Archivo de audio no encontrado'}), 404
        
        # Usar send_file directamente sin manejo complejo de rangos
        filename = chat_message.attachment_path or chat_message.attachment_filename
        
        # Determinar MIME type basado en la extensión del archivo
        if filename.endswith('.webm'):
            mimetype = 'audio/webm'
        elif filename.endswith('.mp4'):
            mimetype = 'audio/mp4'
        elif filename.endswith('.ogg'):
            mimetype = 'audio/ogg'
        else:
            mimetype = 'audio/wav'
        
        # Usar send_file con soporte para rangos automático
        return send_file(
            file_path,
            mimetype=mimetype,
            as_attachment=False,
            conditional=True  # Soporte automático para range requests
        )
        
    except Exception as e:
        # Error general
        return jsonify({'status': 'error', 'message': f'Error al servir audio: {str(e)}'}), 500



@store_bp.route('/api/chat/typing_status', methods=['POST'])
@admin_required
def update_typing_status():
    """Actualizar estado de escritura de un usuario"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        typing = data.get('typing', False)
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        # Aquí podrías almacenar el estado de escritura en la base de datos
        # Por ahora, solo retornamos éxito
        return jsonify({
            'status': 'success',
            'typing': typing,
            'user_id': user_id
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error al actualizar estado de escritura: {str(e)}'}), 500



@store_bp.route('/api/chat/delete_user_chat', methods=['DELETE'])
@admin_required
def delete_user_chat():
    """Eliminar todo el chat de un usuario específico (solo admin)"""
    # Inicializar todas las variables por defecto para evitar errores
    deleted_count = 0
    deleted_sessions = 0
    files_deleted = 0
    files_errors = 0
    orphaned_files = 0
    messages_before = 0
    sessions_before = 0
    messages_after = 0
    sessions_after = 0
    user = None
    
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'status': 'error', 'message': 'ID de usuario requerido'}), 400
        
        # Verificar que el usuario existe
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'Usuario no encontrado'}), 404
        
        # Importar modelos
        from app.models.chat import ChatMessage, ChatSession
        import os
        
        # Definir directorio de uploads ANTES de usarlo
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        # Verificar que el directorio existe
        if not os.path.exists(upload_dir):
            try:
                os.makedirs(upload_dir, exist_ok=True)
            except Exception as e:
                pass  # Continuar sin el directorio, solo eliminar de la base de datos
        
        # Obtener mensajes con archivos antes de eliminarlos
        messages_with_files = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            ),
            ChatMessage.has_attachment == True
        ).all()
        
        # Eliminar archivos físicos del servidor
        files_deleted = 0
        files_errors = 0
        
        # Solo intentar eliminar archivos si el directorio existe
        if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
            for message in messages_with_files:
                if message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_path)
                    
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
                        else:
                            pass  # Archivo no encontrado, continuar
                    except Exception as e:
                        files_errors += 1
        else:
            pass  # Directorio no existe, continuar solo con eliminación de base de datos
        
        # Verificar cuántos mensajes existen antes de eliminar
        messages_before = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).count()
        
        # Verificar cuántas sesiones existen antes de eliminar
        sessions_before = ChatSession.query.filter_by(user_id=user_id).count()
        
        # Eliminar mensajes de la base de datos
        deleted_count = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).delete()
        
        # Eliminar sesiones de chat del usuario
        deleted_sessions = ChatSession.query.filter_by(user_id=user_id).delete()
        
        # Verificar que realmente se eliminaron
        messages_after = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).count()
        
        sessions_after = ChatSession.query.filter_by(user_id=user_id).count()
        
        db.session.commit()
        
        # ✅ NUEVO: Emitir evento SocketIO para actualizar en tiempo real
        try:
            
            # Emitir evento de chat eliminado a todos los usuarios conectados
            success = emit_chat_deleted_event(
                user_id=user_id,
                username=user.username,
                messages_deleted=deleted_count,
                sessions_deleted=deleted_sessions,
                files_deleted=files_deleted
            )
            
        except Exception as socketio_error:
            import traceback
            traceback.print_exc()
        
        # Verificar que no queden archivos huérfanos
        orphaned_files = 0
        try:
            if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
                for filename in os.listdir(upload_dir):
                    file_path = os.path.join(upload_dir, filename)
                    
                    # Verificar si el archivo es válido
                    if not os.path.isfile(file_path):
                        continue
                    
                    # Verificar si el archivo pertenece a algún mensaje existente
                    existing_message = ChatMessage.query.filter_by(attachment_path=filename).first()
                    if not existing_message:
                        try:
                            os.remove(file_path)
                            orphaned_files += 1
                        except Exception as e:
                            pass
                
                # Limpieza adicional: eliminar archivos temporales y caché
                temp_files = 0
                if os.path.exists(upload_dir) and os.path.isdir(upload_dir):
                    for filename in os.listdir(upload_dir):
                        if filename.startswith('temp_') or filename.startswith('cache_') or filename.endswith('.tmp'):
                            file_path = os.path.join(upload_dir, filename)
                            try:
                                if os.path.isfile(file_path):
                                    os.remove(file_path)
                                    temp_files += 1
                            except Exception as e:
                                pass
                
                orphaned_files += temp_files  # Incluir archivos temporales en el total
                    
        except Exception as e:
            pass
        return jsonify({
            'status': 'success',
            'message': f'Chat del usuario {user.username} eliminado exitosamente. {deleted_count} mensajes eliminados, {deleted_sessions} sesiones eliminadas, {files_deleted} archivos eliminados, {orphaned_files} archivos huérfanos y temporales eliminados.',
            'data': {
                'user_id': user_id,
                'username': user.username,
                'messages_deleted': deleted_count,
                'sessions_deleted': deleted_sessions,
                'files_deleted': files_deleted,
                'files_errors': files_errors,
                'orphaned_files_deleted': orphaned_files,
                'verification': {
                    'messages_before': messages_before,
                    'messages_after': messages_after,
                    'sessions_before': sessions_before,
                    'sessions_after': sessions_after,
                    'deletion_successful': messages_after == 0 and sessions_after == 0
                }
            }
        })
        
    except Exception as e:
        db.session.rollback()
        # Error interno
        
        # Las variables ya están inicializadas, solo verificar si se eliminó algo
        if deleted_count > 0:
            # La eliminación fue parcialmente exitosa
            return jsonify({
                'status': 'partial_success',
                'message': f'Chat del usuario {user.username if user else "desconocido"} eliminado parcialmente. {deleted_count} mensajes eliminados, pero hubo algunos errores menores.',
                'data': {
                    'user_id': user_id if 'user_id' in locals() else None,
                    'username': user.username if user else 'desconocido',
                    'messages_deleted': deleted_count,
                    'error_details': str(e)
                }
            })
        else:
            # Error real en la eliminación
            return jsonify({'status': 'error', 'message': f'Error al eliminar chat del usuario: {str(e)}'}), 500


@store_bp.route('/api/chat/auto_cleanup_inactive_users', methods=['POST'])
@admin_required
def auto_cleanup_inactive_users():
    """Limpieza automática: eliminar chats de usuarios inactivos por días personalizables"""
    try:
        from app.models.user import User
        from app.models.chat import ChatMessage, ChatSession
        import os
        from datetime import datetime, timedelta
        
        # Obtener días desde el request
        data = request.get_json()
        INACTIVITY_DAYS = 5  # Valor por defecto
        
        if data and 'days' in data:
            try:
                INACTIVITY_DAYS = int(data['days'])
                # Validar rango de días (1-365)
                if INACTIVITY_DAYS < 1 or INACTIVITY_DAYS > 365:
                    return jsonify({'status': 'error', 'message': 'Días deben estar entre 1 y 365'}), 400
            except (ValueError, TypeError) as e:
                return jsonify({'status': 'error', 'message': 'Días debe ser un número válido'}), 400
        else:
            pass
        
        # Configuración de inactividad personalizada
        cutoff_date = datetime.utcnow() - timedelta(days=INACTIVITY_DAYS)
        
        # Buscar usuarios inactivos (sin actividad de chat reciente)
        inactive_users = []
        total_cleanup_stats = {
            'users_processed': 0,
            'users_cleaned': 0,
            'total_messages_deleted': 0,
            'total_sessions_deleted': 0,
            'total_files_deleted': 0,
            'total_orphaned_files_deleted': 0,
            'errors': []
        }
        
        # Obtener todos los usuarios
        all_users = User.query.all()
        
        for user in all_users:
            # Verificar si el usuario es inactivo
            last_activity = get_user_last_chat_activity(user.id)
            
            if last_activity and last_activity < cutoff_date:
                inactive_users.append({
                    'user': user,
                    'last_activity': last_activity,
                    'days_inactive': (datetime.utcnow() - last_activity).days
                })
        
        # Ordenar por días de inactividad (más inactivos primero)
        inactive_users.sort(key=lambda x: x['days_inactive'], reverse=True)
        
        # Procesar cada usuario inactivo
        for user_info in inactive_users:
            user = user_info['user']
            days_inactive = user_info['days_inactive']
            
            try:
                # Limpiar chat del usuario inactivo
                cleanup_result = cleanup_inactive_user_chat(user.id)
                
                # VERIFICAR que la limpieza fue completa
                verification = verify_cleanup_completeness(user.id)
                
                total_cleanup_stats['users_processed'] += 1
                total_cleanup_stats['users_cleaned'] += 1
                total_cleanup_stats['total_messages_deleted'] += cleanup_result['messages_deleted']
                total_cleanup_stats['total_sessions_deleted'] += cleanup_result['sessions_deleted']
                total_cleanup_stats['total_files_deleted'] += cleanup_result['files_deleted']
                total_cleanup_stats['total_orphaned_files_deleted'] += cleanup_result['orphaned_files_deleted']
                
                if verification['cleanup_complete']:
                    pass
                else:
                    pass
                
            except Exception as e:
                error_msg = f"Error limpiando usuario {user.username}: {str(e)}"
                total_cleanup_stats['errors'].append(error_msg)
        
        # Limpieza final de archivos huérfanos
        final_cleanup = cleanup_orphaned_files()
        total_cleanup_stats['total_orphaned_files_deleted'] += final_cleanup
        
        # Log del resultado
        
        return jsonify({
            'status': 'success',
            'message': f'Limpieza automática completada: {total_cleanup_stats["users_cleaned"]} usuarios inactivos por {INACTIVITY_DAYS}+ días limpiados',
            'data': {
                **total_cleanup_stats,
                'days_used': INACTIVITY_DAYS
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error en limpieza automática: {str(e)}'}), 500

@store_bp.route('/api/chat/schedule_weekly_cleanup', methods=['POST'])
@admin_required
def schedule_weekly_cleanup():
    """Programar limpieza automática semanal (para ser llamada por cron job)"""
    try:
        from datetime import datetime
        
        # Ejecutar limpieza automática
        cleanup_result = auto_cleanup_inactive_users()
        
        # Tarea programada ejecutada

        
        return cleanup_result
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error en limpieza semanal: {str(e)}'}), 500

@store_bp.route('/api/chat/cleanup_status', methods=['GET'])
@admin_required
def get_cleanup_status():
    """Obtener estado de la limpieza automática y estadísticas"""
    try:
        from app.models.user import User
        from app.models.chat import ChatMessage, ChatSession
        from datetime import datetime, timedelta
        
        # Configuración
        INACTIVITY_DAYS = 5
        cutoff_date = datetime.utcnow() - timedelta(days=INACTIVITY_DAYS)
        
        # Estadísticas generales
        total_users = User.query.count()
        total_messages = ChatMessage.query.count()
        total_sessions = ChatSession.query.count()
        
        # Usuarios inactivos
        inactive_users = []
        all_users = User.query.all()
        
        for user in all_users:
            last_activity = get_user_last_chat_activity(user.id)
            if last_activity and last_activity < cutoff_date:
                days_inactive = (datetime.utcnow() - last_activity).days
                inactive_users.append({
                    'username': user.username,
                    'days_inactive': days_inactive,
                    'last_activity': last_activity.isoformat()
                })
        
        # Ordenar por días de inactividad
        inactive_users.sort(key=lambda x: x['days_inactive'], reverse=True)
        
        # Próxima limpieza automática
        next_cleanup = datetime.utcnow() + timedelta(days=7)
        
        return jsonify({
            'status': 'success',
            'data': {
                'total_users': total_users,
                'total_messages': total_messages,
                'total_sessions': total_sessions,
                'inactive_users_count': len(inactive_users),
                'inactive_users': inactive_users[:10],  # Top 10 más inactivos
                'next_cleanup': next_cleanup.isoformat(),
                'cleanup_config': {
                    'inactivity_days': INACTIVITY_DAYS,
                    'frequency': 'weekly',
                    'auto_execution': True
                }
            }
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Error: {str(e)}'}), 500

def get_user_last_chat_activity(user_id):
    """Obtener la última actividad de chat de un usuario"""
    try:
        from app.models.chat import ChatMessage, ChatSession
        
        # Último mensaje enviado
        last_message_sent = ChatMessage.query.filter_by(sender_id=user_id).order_by(ChatMessage.created_at.desc()).first()
        
        # Último mensaje recibido
        last_message_received = ChatMessage.query.filter_by(recipient_id=user_id).order_by(ChatMessage.created_at.desc()).first()
        
        # Última sesión de chat
        last_session = ChatSession.query.filter_by(user_id=user_id).order_by(ChatSession.last_activity.desc()).first()
        
        # Encontrar la fecha más reciente
        dates = []
        if last_message_sent:
            dates.append(last_message_sent.created_at)
        if last_message_received:
            dates.append(last_message_received.created_at)
        if last_session:
            dates.append(last_session.last_activity)
        
        if dates:
            return max(dates)
        return None
        
    except Exception as e:
        return None

def cleanup_inactive_user_chat(user_id):
    """Limpiar chat de un usuario inactivo específico - ELIMINACIÓN COMPLETA"""
    try:
        from app.models.chat import ChatMessage, ChatSession
        import os
        
        # Definir directorio de uploads
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        
        # Obtener TODOS los mensajes del usuario (con y sin archivos)
        all_user_messages = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).all()
        
        # Eliminar TODOS los archivos físicos del servidor
        files_deleted = 0
        if all_user_messages and os.path.exists(upload_dir):
            for message in all_user_messages:
                # Verificar attachment_path
                if message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_path)
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
            
                    except Exception as e:
                        pass
                
                # Verificar attachment_filename (por si acaso)
                if message.attachment_filename and message.attachment_filename != message.attachment_path:
                    file_path = os.path.join(upload_dir, message.attachment_filename)
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            files_deleted += 1
            
                    except Exception as e:
                        pass
        
        # Eliminar mensajes de la base de datos
        messages_deleted = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).delete()
        
        # Eliminar sesiones de chat
        sessions_deleted = ChatSession.query.filter_by(user_id=user_id).delete()
        
        # Commit de cambios
        db.session.commit()
        

        
        return {
            'messages_deleted': messages_deleted,
            'sessions_deleted': sessions_deleted,
            'files_deleted': files_deleted,
            'orphaned_files_deleted': 0
        }
        
    except Exception as e:
        db.session.rollback()
        raise e

def cleanup_orphaned_files():
    """Limpiar archivos huérfanos después de la limpieza - ELIMINACIÓN AGRESIVA"""
    try:
        import os
        from app.models.chat import ChatMessage
        
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        if not os.path.exists(upload_dir):
            return 0
        
        orphaned_files_deleted = 0
        
        # Verificar archivos huérfanos por attachment_path
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            
            if not os.path.isfile(file_path):
                continue
            
            # Verificar si el archivo pertenece a algún mensaje existente
            existing_message_path = ChatMessage.query.filter_by(attachment_path=filename).first()
            existing_message_filename = ChatMessage.query.filter_by(attachment_filename=filename).first()
            
            if not existing_message_path and not existing_message_filename:
                try:
                    os.remove(file_path)
                    orphaned_files_deleted += 1
    
                except Exception as e:
                    pass
        
        # Limpiar archivos temporales y caché
        temp_files = 0
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            
            # Patrones de archivos temporales
            is_temp = (
                filename.startswith('temp_') or 
                filename.startswith('cache_') or 
                filename.startswith('tmp_') or
                filename.endswith('.tmp') or
                filename.endswith('.cache') or
                filename.endswith('.temp') or
                '~' in filename or
                filename.startswith('.DS_Store') or
                filename.startswith('Thumbs.db')
            )
            
            if is_temp and os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    temp_files += 1
    
                except Exception as e:
                    pass
        
        orphaned_files_deleted += temp_files
        
        # Limpiar archivos con nombres sospechosos
        suspicious_files = 0
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            
            # Archivos con nombres sospechosos
            is_suspicious = (
                len(filename) > 100 or  # Nombres muy largos
                filename.count('.') > 5 or  # Muchos puntos
                any(char in filename for char in ['<', '>', ':', '"', '|', '?', '*']) or  # Caracteres inválidos
                filename.startswith('._') or  # Archivos del sistema
                filename.endswith('.part') or  # Archivos parciales
                filename.endswith('.crdownload')  # Descargas incompletas
            )
            
            if is_suspicious and os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    suspicious_files += 1
    
                except Exception as e:
                    pass
        
        orphaned_files_deleted += suspicious_files
        

        
        return orphaned_files_deleted
        
    except Exception as e:
        return 0

def verify_cleanup_completeness(user_id):
    """Verificar que la limpieza fue completa para un usuario"""
    try:
        from app.models.chat import ChatMessage, ChatSession
        import os
        
        # Verificar que no queden mensajes
        remaining_messages = ChatMessage.query.filter(
            db.or_(
                ChatMessage.sender_id == user_id,
                ChatMessage.recipient_id == user_id
            )
        ).count()
        
        # Verificar que no queden sesiones
        remaining_sessions = ChatSession.query.filter_by(user_id=user_id).count()
        
        # Verificar que no queden archivos físicos
        upload_dir = os.path.join(current_app.root_path, 'store', 'static', 'uploads', 'chat')
        remaining_files = 0
        
        if os.path.exists(upload_dir):
            for filename in os.listdir(upload_dir):
                file_path = os.path.join(upload_dir, filename)
                
                if os.path.isfile(file_path):
                    # Verificar si el archivo pertenece a algún mensaje del usuario
                    message_with_file = ChatMessage.query.filter(
                        db.or_(
                            ChatMessage.sender_id == user_id,
                            ChatMessage.recipient_id == user_id
                        ),
                        db.or_(
                            ChatMessage.attachment_path == filename,
                            ChatMessage.attachment_filename == filename
                        )
                    ).first()
                    
                    if message_with_file:
                        remaining_files += 1
        
        verification_result = {
            'messages_remaining': remaining_messages,
            'sessions_remaining': remaining_sessions,
            'files_remaining': remaining_files,
            'cleanup_complete': remaining_messages == 0 and remaining_sessions == 0 and remaining_files == 0
        }
        
        if verification_result['cleanup_complete']:
            pass
        else:
            pass
        
        return verification_result
        
    except Exception as e:
        return {'error': str(e), 'cleanup_complete': False}

@store_bp.route('/api/chat/get_current_user')
def get_current_user_api():
    """Endpoint para obtener información del usuario actual del chat"""
    try:
        current_user = get_current_user()
        if not current_user:
            return jsonify({'status': 'error', 'message': 'Usuario no autenticado'}), 401
        
        user_data = {
            'id': current_user.id,
            'username': current_user.username,
            'is_admin': current_user.is_admin,
            'is_support': current_user.is_support
        }
        
        return jsonify({'status': 'success', 'data': user_data})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Endpoint para SocketIO emitir mensajes
@store_bp.route('/api/chat/socketio_emit', methods=['POST'])
@store_access_required
def socketio_emit_message():
    """Endpoint para que SocketIO emita mensajes en tiempo real"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Datos requeridos'}), 400
        
        message_data = data.get('message_data')
        recipient_id = data.get('recipient_id')
        sender_id = data.get('sender_id')
        
        if not message_data or not recipient_id or not sender_id:
            return jsonify({'status': 'error', 'message': 'Datos incompletos'}), 400
        
        # Llamar al servidor SocketIO para emitir el evento
        try:
            import requests
            
            # Llamar al endpoint del servidor SocketIO
            socketio_data = {
                'message_data': message_data,
                'sender_id': sender_id,
                'recipient_id': recipient_id
            }
            
            response = requests.post(
                'http://127.0.0.1:5002/api/chat/socketio_emit',
                json=socketio_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code != 200:
                pass
                
        except Exception as socket_error:
            # No fallar si falla SocketIO
            pass
        
        return jsonify({'status': 'success', 'message': 'Mensaje emitido por SocketIO'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Ruta para favicon.ico para evitar error 404
@store_bp.route('/favicon.ico')
def favicon():
    """Servir favicon.svg directamente con tipo MIME correcto"""
    from flask import send_from_directory
    import os
    favicon_path = os.path.join(current_app.static_folder, 'images', 'favicon.svg')
    if os.path.exists(favicon_path):
        return send_from_directory(
            os.path.join(current_app.static_folder, 'images'),
            'favicon.svg',
            mimetype='image/svg+xml'
        )
    return '', 404

@store_bp.route('/api/chat/push-subscription', methods=['POST'])
def save_push_subscription():
    """Guardar suscripción push del usuario"""
    try:
        data = request.get_json()
        subscription = data.get('subscription')
        user_id = data.get('user_id')
        
        if not subscription or not user_id:
            return jsonify({
                'status': 'error',
                'message': 'Datos de suscripción incompletos'
            }), 400
        
        # Aquí podrías guardar la suscripción en la base de datos
        # Por ahora solo retornamos éxito

        
        return jsonify({
            'status': 'success',
            'message': 'Suscripción push guardada correctamente'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Error guardando suscripción push: {str(e)}'
        }), 500

# ✅ RUTAS EXISTENTES: Usar las rutas ya implementadas para actualizar permisos de usuario

# ==================== RUTAS PARA DRIVE TRANSFER ====================

@store_bp.route('/admin/drive_transfers', methods=['GET'])
@admin_required
def list_drive_transfers():
    from app.utils.timezone import get_colombia_datetime
    server_time = get_colombia_datetime()
    
    transfers = DriveTransfer.query.all()
    return jsonify({
            'server_time_colombia': server_time.strftime('%I:%M %p'),
            'transfers': [
                {
                    'id': t.id,
                    'credentials_json': t.credentials_json,
                    'drive_original_id': t.drive_original_id,
                    'drive_processed_id': t.drive_processed_id,
                    'drive_deleted_id': t.drive_deleted_id,  # Campo opcional
                    'processing_time': t.processing_time if isinstance(t.processing_time, str) else (t.processing_time.strftime('%I:%M %p') if t.processing_time else None),  # Soporta ambos formatos (legacy y nuevo)
                    'is_active': t.is_active,
                    'last_processed': t.last_processed.isoformat() if t.last_processed else None,
                    'activated_at': t.activated_at.isoformat() if t.activated_at else None,
                    'created_at': t.created_at.isoformat()
                } for t in transfers
            ]
        })

@store_bp.route('/admin/drive_transfers', methods=['POST'])
@admin_required
def create_drive_transfer():
    data = request.form if request.form else request.json
    credentials_json = data.get('drive_credentials_json')
    drive_original_id = data.get('drive_original_id')
    drive_processed_id = data.get('drive_destination')  # Corregido: el campo se llama 'drive_destination'
    drive_deleted_id = data.get('drive_deleted')  # Campo opcional
    processing_time_str = data.get('drive_processing_time')
    
    if not all([credentials_json, drive_original_id, drive_processed_id, processing_time_str]):
        return jsonify({'success': False, 'error': 'Faltan datos requeridos'}), 400
    
    # Validar formato de IDs de Drive (deben ser strings alfanuméricos)
    if not drive_original_id.replace('-', '').replace('_', '').isalnum():
        return jsonify({'success': False, 'error': 'ID de carpeta original inválido'}), 400
    
    if not drive_processed_id.replace('-', '').replace('_', '').isalnum():
        return jsonify({'success': False, 'error': 'ID de carpeta procesada inválido'}), 400
    
    # Validar JSON de credenciales
    try:
        creds = json.loads(credentials_json)
        # Validar campos obligatorios en las credenciales
        required_fields = ['type', 'project_id', 'private_key', 'client_email']
        for field in required_fields:
            if field not in creds:
                return jsonify({'success': False, 'error': f'Campo obligatorio faltante en credenciales: {field}'}), 400
    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Credenciales JSON inválidas'}), 400
    
    try:
        # Validar formato de intervalo (5h, 10m, 5H, 10M, etc.)
        from app.store.drive_manager import parse_interval
        interval = parse_interval(processing_time_str)
        if not interval:
            return jsonify({'success': False, 'error': 'Formato de intervalo inválido. Use formato "5h" (horas) o "10m" (minutos). Ejemplos: 1h, 2h, 30m, 60m'}), 400
        
        # Crear nueva configuración (Drive Transfer permite múltiples configuraciones)
        transfer = DriveTransfer(
            credentials_json=credentials_json,
            drive_original_id=drive_original_id,
            drive_processed_id=drive_processed_id,
            drive_deleted_id=drive_deleted_id,  # Campo opcional
            processing_time=processing_time_str.upper(),  # Guardar como string (ej: "5H", "10M")
            activated_at=datetime.utcnow(),  # Establecer activated_at al crear
            consecutive_errors=0,  # Valor por defecto para el campo NOT NULL
            last_error=None  # Valor por defecto para el campo nullable
        )
        db.session.add(transfer)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración de Drive guardada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al guardar: {str(e)}'}), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>', methods=['DELETE'])
@admin_required
def delete_drive_transfer(transfer_id):
    transfer = DriveTransfer.query.get_or_404(transfer_id)
    db.session.delete(transfer)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración de Drive eliminada correctamente.'})

@store_bp.route('/admin/drive_transfers/<int:transfer_id>', methods=['PUT'])
@admin_required
def update_drive_transfer(transfer_id):
    data = request.form if request.form else request.json
    transfer = DriveTransfer.query.get_or_404(transfer_id)
    
    try:
        # Actualizar campos
        if 'drive_credentials_json' in data:
            transfer.credentials_json = data['drive_credentials_json']
        if 'drive_original_id' in data:
            transfer.drive_original_id = data['drive_original_id']
        if 'drive_destination' in data:
            transfer.drive_processed_id = data['drive_destination']
        if 'drive_deleted' in data:
            transfer.drive_deleted_id = data['drive_deleted']  # Campo opcional
        if 'drive_processing_time' in data:
            from app.store.drive_manager import parse_interval
            processing_time_str = data['drive_processing_time']
            # Validar formato de intervalo (5h, 10m, 5H, 10M, etc.)
            interval = parse_interval(processing_time_str)
            if not interval:
                return jsonify({'success': False, 'error': 'Formato de intervalo inválido. Use formato "5h" (horas) o "10m" (minutos). Ejemplos: 1h, 2h, 30m, 60m'}), 400
            
            transfer.processing_time = processing_time_str.upper()  # Guardar como string (ej: "5H", "10M")
            
            # Si se cambia el intervalo y está activo, resetear activated_at para que empiece desde ahora
            if transfer.is_active:
                transfer.activated_at = datetime.utcnow()
        
        transfer.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración de Drive actualizada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>/execute_now', methods=['POST'])
@admin_required
def execute_drive_transfer_now(transfer_id):
    """Ejecuta una transferencia de Drive manualmente (para pruebas)"""
    try:
        transfer = DriveTransfer.query.get_or_404(transfer_id)
        
        if not transfer.is_active:
            return jsonify({'success': False, 'error': 'La transferencia no está activa'}), 400
        
        from .drive_manager import execute_transfer_simple
        from app import create_app
        from .api import format_colombia_time
        
        app = create_app()
        
        # Ejecutar transferencia (ahora maneja errores internamente y no lanza excepciones)
        result = execute_transfer_simple(transfer, app)
        
        # Recargar el objeto desde la base de datos para obtener los valores actualizados
        db.session.refresh(transfer)
        
        # Verificar si la ejecución fue exitosa
        if result and isinstance(result, dict):
            success = result.get('success', False)
            files_moved = result.get('files_moved', 0)
            files_failed = result.get('files_failed', 0)
            files_processed = result.get('files_processed', 0)
            result_message = result.get('message', 'Sin mensaje')
            
            if success:
                message = f'✅ Transferencia ejecutada exitosamente. '
            else:
                message = f'⚠️ Transferencia ejecutada con errores. '
            
            message += f'Archivos procesados: {files_processed}, Movidos: {files_moved}, Fallidos: {files_failed}. '
            
            if files_failed > 0:
                message += f'Detalles: {result_message}'
        else:
            # Si no hay resultado válido, usar información del objeto transfer
            success = False
            message = '⚠️ Transferencia ejecutada pero no se obtuvo resultado válido. '
            files_moved = 0
            files_failed = 0
        
        # Formatear hora en formato 12 horas (AM/PM) en hora de Colombia
        last_execution_formatted = format_colombia_time(transfer.last_processed) if transfer.last_processed else "N/A"
        message += f' Última ejecución: {last_execution_formatted}'
        
        # Si hay errores consecutivos, agregar advertencia
        if transfer.consecutive_errors and transfer.consecutive_errors > 0:
            message += f' (Errores consecutivos: {transfer.consecutive_errors})'
        
        # Si fue desactivada por errores, informar
        if not transfer.is_active and transfer.consecutive_errors and transfer.consecutive_errors >= 5:
            message += ' ⚠️ Transferencia desactivada automáticamente por múltiples errores.'
        
        return jsonify({
            'success': success, 
            'message': message,
            'last_processed': transfer.last_processed.isoformat() if transfer.last_processed else None,
            'result': result if result and isinstance(result, dict) else None,
            'consecutive_errors': transfer.consecutive_errors or 0,
            'is_active': transfer.is_active
        })
        
    except Exception as e:
        # Capturar cualquier error inesperado y devolver información útil
        error_msg = str(e)[:500]
        return jsonify({
            'success': False, 
            'error': f'Error al ejecutar transferencia: {error_msg}',
            'error_type': type(e).__name__
        }), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>/toggle', methods=['POST'])
@admin_required
def toggle_drive_transfer(transfer_id):
    transfer = DriveTransfer.query.get_or_404(transfer_id)
    transfer.is_active = not transfer.is_active
    db.session.commit()
    
    status = 'activada' if transfer.is_active else 'desactivada'
    return jsonify({'success': True, 'message': f'Configuración de Drive {status}.', 'is_active': transfer.is_active})

@store_bp.route('/admin/drive_transfers/test', methods=['POST'])
@admin_required
def test_drive_connection():
    data = request.form if request.form else request.json
    credentials_json = data.get('drive_credentials_json')
    
    if not credentials_json:
        return jsonify({'success': False, 'error': 'Faltan credenciales'}), 400
    
    # Validar JSON de credenciales
    try:
        json.loads(credentials_json)
    except json.JSONDecodeError as e:
        return jsonify({'success': False, 'error': f'JSON de credenciales inválido: {str(e)}'}), 400
    
    try:
        from .drive_manager import DriveTransferService
        
        service = DriveTransferService(credentials_json)
        result = service.test_connection()
        
        if result['success']:
            return jsonify({'success': True, 'message': result['message']})
        else:
            return jsonify({'success': False, 'error': result['message']}), 500
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error de conexión: {str(e)}'}), 500

@store_bp.route('/admin/drive_transfers/<int:transfer_id>/cleanup', methods=['POST'])
@admin_required
def cleanup_drive_files(transfer_id):
    """Ejecuta limpieza de archivos antiguos en el Drive procesado"""
    data = request.form if request.form else request.json
    days_old = data.get('cleanup_days')
    schedule_time = data.get('cleanup_schedule_time')
    
    if not days_old:
        return jsonify({'success': False, 'error': 'Faltan días especificados'}), 400
    
    try:
        days_old = int(days_old)
        transfer = DriveTransfer.query.get_or_404(transfer_id)
        
        from .drive_manager import DriveTransferService
        
        service = DriveTransferService(transfer.credentials_json)
        
        if schedule_time:
            # Programar limpieza para hora específica
            from datetime import datetime, time as dt_time
            from .drive_manager import schedule_cleanup_task
            
            # Parsear hora
            time_parts = schedule_time.split(':')
            hour = int(time_parts[0])
            minute = int(time_parts[1])
            scheduled_time = dt_time(hour, minute)
            
            # Programar limpieza usando el scheduler
            task_id = schedule_cleanup_task(transfer.id, days_old, scheduled_time)
            
            if task_id:
                return jsonify({
                    'success': True, 
                    'message': f'✅ Limpieza programada para {schedule_time}. Se ejecutará automáticamente.',
                    'task_id': task_id,
                    'scheduled_time': schedule_time
                })
            else:
                return jsonify({'success': False, 'error': 'Error al programar la limpieza'}), 500
        else:
            # Ejecutar limpieza inmediata
            result = service.cleanup_old_files(transfer.drive_processed_id, days_old, transfer.drive_deleted_id)
            
            if result['success']:
                return jsonify({
                    'success': True, 
                    'message': result['message'],
                    'files_deleted': result['files_deleted'],
                    'files_failed': result['files_failed'],
                    'files_processed': result.get('files_processed', result['files_deleted'] + result['files_failed'])
                })
            else:
                return jsonify({'success': False, 'error': result['message']}), 500
        
    except ValueError:
        return jsonify({'success': False, 'error': 'Días inválidos'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error en limpieza: {str(e)}'}), 500

# ==================== RUTAS PARA WHATSAPP ====================

@store_bp.route('/admin/whatsapp_configs', methods=['GET'])
@admin_required
def list_whatsapp_configs():
    configs = WhatsAppConfig.query.all()
    return jsonify({
        'configs': [
            {
                'id': c.id,
                'api_key': c.api_key,
                'phone_number': c.phone_number,
                'webhook_verify_token': c.webhook_verify_token,
                'template_message': c.template_message,
                'notification_time': c.notification_time.strftime('%H:%M') if c.notification_time else None,
                'is_enabled': c.is_enabled,
                'last_sent': c.last_sent.isoformat() if c.last_sent else None,
                'created_at': c.created_at.isoformat()
            } for c in configs
        ]
    })

@store_bp.route('/admin/whatsapp_configs', methods=['POST'])
@admin_required
def create_whatsapp_config():
    data = request.form if request.form else request.json
    api_key = data.get('whatsapp_api_key')
    phone_number = data.get('whatsapp_phone_number')
    webhook_verify_token = data.get('whatsapp_webhook_verify_token')
    template_message = data.get('whatsapp_template_message')
    notification_time_str = data.get('whatsapp_notification_time')
    is_enabled = data.get('whatsapp_enabled', 'on') == 'on'
    
    if not all([api_key, phone_number, webhook_verify_token, template_message, notification_time_str]):
        return jsonify({'success': False, 'error': 'Faltan datos requeridos'}), 400
    
    try:
        # Convertir string de tiempo a objeto Time
        from datetime import time
        if ':' in notification_time_str:
            time_parts = notification_time_str.split(':')
            if len(time_parts) >= 2:
                hour = int(time_parts[0])
                minute = int(time_parts[1])
                notification_time = time(hour, minute)
            else:
                raise ValueError("Formato de tiempo inválido")
        else:
            raise ValueError("Formato de tiempo inválido")
        
        config = WhatsAppConfig(
            api_key=api_key,
            phone_number=phone_number,
            webhook_verify_token=webhook_verify_token,
            template_message=template_message,
            notification_time=notification_time,
            is_enabled=is_enabled
        )
        db.session.add(config)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Configuración de WhatsApp guardada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al guardar: {str(e)}'}), 500

@store_bp.route('/admin/whatsapp_configs/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_whatsapp_config(config_id):
    config = WhatsAppConfig.query.get_or_404(config_id)
    db.session.delete(config)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Configuración de WhatsApp eliminada.'})

@store_bp.route('/admin/whatsapp_configs/<int:config_id>', methods=['PUT'])
@admin_required
def update_whatsapp_config(config_id):
    data = request.form if request.form else request.json
    config = WhatsAppConfig.query.get_or_404(config_id)
    
    try:
        # Actualizar campos
        if 'whatsapp_api_key' in data:
            config.api_key = data['whatsapp_api_key']
        if 'whatsapp_phone_number' in data:
            config.phone_number = data['whatsapp_phone_number']
        if 'whatsapp_webhook_verify_token' in data:
            config.webhook_verify_token = data['whatsapp_webhook_verify_token']
        if 'whatsapp_template_message' in data:
            config.template_message = data['whatsapp_template_message']
        if 'whatsapp_notification_time' in data:
            from datetime import time
            notification_time_str = data['whatsapp_notification_time']
            if ':' in notification_time_str:
                time_parts = notification_time_str.split(':')
                if len(time_parts) >= 2:
                    hour = int(time_parts[0])
                    minute = int(time_parts[1])
                    config.notification_time = time(hour, minute)
                else:
                    raise ValueError("Formato de tiempo inválido")
            else:
                raise ValueError("Formato de tiempo inválido")
        if 'whatsapp_enabled' in data:
            config.is_enabled = data['whatsapp_enabled'] == 'on'
        
        config.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración de WhatsApp actualizada correctamente.'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500

@store_bp.route('/admin/whatsapp_configs/<int:config_id>/toggle', methods=['POST'])
@admin_required
def toggle_whatsapp_config(config_id):
    config = WhatsAppConfig.query.get_or_404(config_id)
    config.is_enabled = not config.is_enabled
    db.session.commit()
    
    status = 'activada' if config.is_enabled else 'desactivada'
    return jsonify({'success': True, 'message': f'Configuración de WhatsApp {status}.', 'is_enabled': config.is_enabled})

@store_bp.route('/admin/whatsapp_configs/test', methods=['POST'])
@admin_required
def test_whatsapp_connection():
    data = request.form if request.form else request.json
    api_key = data.get('whatsapp_api_key')
    phone_number = data.get('whatsapp_phone_number')
    
    if not api_key or not phone_number:
        return jsonify({'success': False, 'error': 'Faltan API Key o número de teléfono'}), 400
    
    try:
        # Simular prueba de conexión (en el futuro se implementará la conexión real)
        # Por ahora solo validamos el formato
        if len(api_key) < 10:
            return jsonify({'success': False, 'error': 'API Key muy corta'}), 400
        
        if not phone_number.isdigit() or len(phone_number) < 10:
            return jsonify({'success': False, 'error': 'Número de teléfono inválido'}), 400
        
        return jsonify({
            'success': True, 
            'message': f'Conexión de prueba exitosa. API Key válida para número {phone_number}'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error de conexión: {str(e)}'}), 500


# ==================== RUTAS PARA SMS (TWILIO) ====================

def check_twilio_number_type(phone_number, account_sid, auth_token):
    """Consulta la API de Twilio para determinar si un número es temporal o comprado"""
    try:
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException
        
        if not account_sid or not auth_token:
            return 'desconocido'
        
        client = Client(account_sid, auth_token)
        
        # Buscar el número en la lista de números activos de Twilio
        incoming_phone_numbers = client.incoming_phone_numbers.list(phone_number=phone_number)
        
        if incoming_phone_numbers and len(incoming_phone_numbers) > 0:
            return 'comprado'
        else:
            # Intentar buscar sin el + si tiene
            if phone_number.startswith('+'):
                alt_phone = phone_number[1:]
                incoming_phone_numbers = client.incoming_phone_numbers.list(phone_number=alt_phone)
                if incoming_phone_numbers and len(incoming_phone_numbers) > 0:
                    return 'comprado'
            
            return 'temporal'
            
    except Exception as e:
        # Solo loguear si es un error crítico, para evitar ruido en la consola por errores de conexión ocasionales
        # current_app.logger.error(f"Error consultando tipo de número Twilio: {e}")
        return 'desconocido'

@store_bp.route('/admin/sms_configs', methods=['GET'])
@admin_required
def list_sms_configs():
    """
    Lista todas las configuraciones SMS. Asegura que todos los números estén habilitados.
    También devuelve el último número seleccionado por el usuario desde la base de datos.
    """
    configs = SMSConfig.query.order_by(SMSConfig.created_at.desc()).all()
    
    # Asegurar que todos los números estén habilitados (siempre deben estar habilitados)
    needs_commit = False
    for config in configs:
        if not config.is_enabled:
            config.is_enabled = True
            needs_commit = True
    
    # Guardar cambios si hubo alguno
    if needs_commit:
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
    
    # Optimizar: obtener conteos de mensajes en una sola consulta
    from sqlalchemy import func
    messages_counts = db.session.query(
        SMSMessage.sms_config_id,
        func.count(SMSMessage.id).label('count')
    ).group_by(SMSMessage.sms_config_id).all()
    
    messages_dict = {config_id: count for config_id, count in messages_counts}
    
    configs_data = []
    for config in configs:
        # Usar conteo optimizado en lugar de config.messages.count()
        messages_count = messages_dict.get(config.id, 0)
        
        # Usar el tipo de número guardado en la base de datos
        number_type = getattr(config, 'number_type', 'desconocido') or 'desconocido'
        
        configs_data.append({
            'id': config.id,
            'name': config.name,
            'phone_number': config.phone_number,
            'twilio_account_sid': config.twilio_account_sid,
            'is_enabled': True,  # Siempre True
            'description': config.description,
            'created_at': colombia_strftime('%Y-%m-%d %H:%M:%S') if config.created_at else None,
            'messages_count': messages_count,
            'number_type': number_type
        })
    
    # Obtener el último número seleccionado por el usuario desde la base de datos
    current_user = get_current_user()
    last_selected_id = None
    if current_user and current_user.last_selected_sms_config_id:
        # Verificar que el número seleccionado aún existe
        selected_config = SMSConfig.query.get(current_user.last_selected_sms_config_id)
        if selected_config:
            last_selected_id = current_user.last_selected_sms_config_id
        else:
            # Si el número ya no existe, limpiar la referencia
            current_user.last_selected_sms_config_id = None
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
    
    # También verificar si hay uno guardado en la sesión (prioridad más alta)
    session_selected_id = session.get('selected_sms_config_id')
    if session_selected_id:
        # Validar que existe
        if SMSConfig.query.get(session_selected_id):
            last_selected_id = session_selected_id
            # Sincronizar con la base de datos
            if current_user and current_user.last_selected_sms_config_id != session_selected_id:
                current_user.last_selected_sms_config_id = session_selected_id
                try:
                    db.session.commit()
                except Exception:
                    db.session.rollback()
        
    return jsonify({
        'success': True, 
        'configs': configs_data,
        'last_selected_id': last_selected_id  # ID del último número seleccionado
    })

@store_bp.route('/admin/sms_configs', methods=['POST'])
@admin_required
def create_sms_config():
    """Crea una nueva configuración SMS"""
    data = request.form if request.form else request.json
    
    name = data.get('name')
    twilio_account_sid = data.get('twilio_account_sid')
    twilio_auth_token = data.get('twilio_auth_token')
    phone_number = data.get('phone_number')
    description = data.get('description', '')
    # Los números SMS siempre deben estar habilitados
    is_enabled = True
    
    if not all([name, twilio_account_sid, twilio_auth_token, phone_number]):
        return jsonify({'success': False, 'error': 'Faltan campos requeridos'}), 400
    
    try:
        if not phone_number.startswith('+'):
            return jsonify({'success': False, 'error': 'El número debe incluir código de país (ej: +12672441170)'}), 400
        
        config = SMSConfig(
            name=name,
            twilio_account_sid=twilio_account_sid,
            twilio_auth_token=twilio_auth_token,
            phone_number=phone_number,
            description=description,
            is_enabled=is_enabled
        )
        
        db.session.add(config)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración SMS creada correctamente.', 'config_id': config.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al crear: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>', methods=['PUT'])
@admin_required
def update_sms_config(config_id):
    """Actualiza una configuración SMS existente"""
    config = SMSConfig.query.get_or_404(config_id)
    data = request.form if request.form else request.json
    
    name = data.get('name')
    twilio_account_sid = data.get('twilio_account_sid')
    twilio_auth_token = data.get('twilio_auth_token')
    phone_number = data.get('phone_number')
    description = data.get('description', '')
    # Los números SMS siempre deben estar habilitados
    is_enabled = True
    
    if not all([name, twilio_account_sid, phone_number]):
        return jsonify({'success': False, 'error': 'Faltan campos requeridos'}), 400
    
    try:
        if not phone_number.startswith('+'):
            return jsonify({'success': False, 'error': 'El número debe incluir código de país (ej: +12672441170)'}), 400
        
        # Verificar si el número ya existe en otra configuración
        existing = SMSConfig.query.filter(
            SMSConfig.phone_number == phone_number,
            SMSConfig.id != config_id
        ).first()
        if existing:
            return jsonify({'success': False, 'error': 'Este número ya está configurado en otra cuenta'}), 400
        
        config.name = name
        config.twilio_account_sid = twilio_account_sid
        # Solo actualizar el token si se proporciona uno nuevo
        if twilio_auth_token:
            config.twilio_auth_token = twilio_auth_token
        config.phone_number = phone_number
        config.description = description
        config.is_enabled = is_enabled
        
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Configuración SMS actualizada correctamente.'})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_sms_config(config_id):
    """Elimina una configuración SMS. Los correos permitidos, mensajes y regex huérfanos se eliminan automáticamente en cascada."""
    config = SMSConfig.query.get_or_404(config_id)
    
    try:
        # Contar correos permitidos y mensajes que se eliminarán en cascada
        allowed_count = AllowedSMSNumber.query.filter_by(sms_config_id=config_id).count()
        messages_count = SMSMessage.query.filter_by(sms_config_id=config_id).count()
        
        # Obtener regex asociados a este SMSConfig (uno-a-muchos: cada regex pertenece a un solo SMSConfig)
        associated_regexes = SMSRegex.query.filter_by(sms_config_id=config_id).all()
        regex_associations_count = len(associated_regexes)
        
        # Eliminar explícitamente los regex primero para evitar problemas con SQLAlchemy
        # Aunque hay cascade='all, delete-orphan' y ondelete='CASCADE', eliminarlos explícitamente
        # asegura que SQLAlchemy no intente hacer UPDATE con NULL
        for regex in associated_regexes:
            db.session.delete(regex)
        
        # Eliminar la configuración (los AllowedSMSNumber y SMSMessage se eliminarán en cascada)
        # Esto funciona por:
        # 1. Foreign key con ondelete='CASCADE' en la base de datos
        # 2. Relación SQLAlchemy con cascade='all, delete-orphan' para AllowedSMSNumber y SMSMessage
        db.session.delete(config)
        
        db.session.commit()
        
        message = 'Configuración SMS eliminada correctamente.'
        details = []
        if allowed_count > 0:
            details.append(f'{allowed_count} correo(s) permitido(s)')
        if messages_count > 0:
            details.append(f'{messages_count} mensaje(s)')
        if regex_associations_count > 0:
            details.append(f'{regex_associations_count} regex asociado(s)')
        if details:
            message += f' También se eliminaron: {", ".join(details)}.'
        
        return jsonify({'success': True, 'message': message})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al eliminar: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex', methods=['GET'])
@admin_required
def list_sms_regex():
    """Lista todos los regex específicos de SMS de un número específico"""
    try:
        config_id = request.args.get('config_id', type=int)
        if config_id:
            # Listar solo los regexes del número SMS especificado
            regexes = SMSRegex.query.filter_by(sms_config_id=config_id).order_by(SMSRegex.name.asc()).all()
        else:
            # Si no se especifica config_id, devolver lista vacía
            regexes = []
        regex_data = [{
            'id': regex.id,
            'name': regex.name or '',
            'pattern': regex.pattern or '',
            'enabled': regex.enabled,
            'sms_config_id': regex.sms_config_id
        } for regex in regexes]
        return jsonify({'success': True, 'regexes': regex_data})
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error al listar regex: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex', methods=['POST'])
@admin_required
def create_sms_regex():
    """Crea un nuevo regex específico para SMS - Cada regex pertenece a un solo SMSConfig"""
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        pattern = data.get('pattern', '').strip()
        sms_config_id = data.get('sms_config_id')  # ID del SMSConfig al que pertenece el regex
        
        if not name or not pattern:
            return jsonify({'success': False, 'error': 'Nombre y patrón son requeridos'}), 400
        
        if not sms_config_id:
            return jsonify({'success': False, 'error': 'sms_config_id es requerido'}), 400
        
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'sms_config_id debe ser un número válido'}), 400
        
        # Verificar que el SMSConfig existe
        config = SMSConfig.query.get(sms_config_id)
        if not config:
            return jsonify({'success': False, 'error': 'SMSConfig no encontrado'}), 404
        
        # Crear el regex asociado directamente al SMSConfig
        new_regex = SMSRegex(
            name=name,
            pattern=pattern,
            enabled=True,
            sms_config_id=sms_config_id
        )
        db.session.add(new_regex)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Regex creado correctamente',
            'regex': {
                'id': new_regex.id,
                'name': new_regex.name,
                'pattern': new_regex.pattern,
                'enabled': new_regex.enabled,
                'sms_config_id': new_regex.sms_config_id
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al crear regex: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex/<int:regex_id>', methods=['PUT'])
@admin_required
def update_sms_regex(regex_id):
    """Actualiza un regex específico de SMS"""
    try:
        regex = SMSRegex.query.get_or_404(regex_id)
        data = request.get_json()
        
        name = data.get('name', '').strip()
        pattern = data.get('pattern', '').strip()
        
        if not name or not pattern:
            return jsonify({'success': False, 'error': 'Nombre y patrón son requeridos'}), 400
        
        regex.name = name
        regex.pattern = pattern
        regex.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Regex actualizado correctamente',
            'regex': {
                'id': regex.id,
                'name': regex.name,
                'pattern': regex.pattern,
                'enabled': regex.enabled
            }
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar regex: {str(e)}'}), 500

@store_bp.route('/admin/sms/regex/<int:regex_id>', methods=['DELETE'])
@admin_required
def delete_sms_regex(regex_id):
    """Elimina un regex específico de SMS (uno-a-muchos: cada regex pertenece a un solo SMSConfig)"""
    try:
        regex = SMSRegex.query.get_or_404(regex_id)
        
        # Con la nueva relación uno-a-muchos, el regex pertenece a un solo SMSConfig
        # Se elimina directamente sin necesidad de manejar asociaciones
        db.session.delete(regex)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Regex eliminado correctamente.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al eliminar regex: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>/regex', methods=['GET'])
@admin_required
def get_sms_config_regex(config_id):
    """Obtiene los IDs de los regex asociados a un SMS config"""
    try:
        config = SMSConfig.query.get_or_404(config_id)
        # Intentar obtener regex asociados, si la tabla no existe aún devolver lista vacía
        try:
            regex_ids = [regex.id for regex in config.regexes]
        except Exception:
            # Si la tabla no existe aún, devolver lista vacía
            regex_ids = []
        return jsonify({'success': True, 'regex_ids': regex_ids})
    except Exception as e:
        # Si hay error, devolver lista vacía en lugar de error 500
        return jsonify({'success': True, 'regex_ids': []})

@store_bp.route('/admin/sms_configs/<int:config_id>/regex', methods=['POST'])
@admin_required
def add_sms_config_regex(config_id):
    """Agrega un regex SMS a un SMS config"""
    data = request.get_json()
    regex_id = data.get('regex_id')
    
    if not regex_id:
        return jsonify({'success': False, 'error': 'regex_id es requerido'}), 400
    
    config = SMSConfig.query.get_or_404(config_id)
    regex = SMSRegex.query.get(regex_id)
    
    if not regex:
        return jsonify({'success': False, 'error': 'Regex no encontrado'}), 404
    
    # Verificar si ya está asociado usando la relación
    existing_regexes = [r.id for r in config.regexes]
    if regex_id not in existing_regexes:
        config.regexes.append(regex)
        try:
            db.session.commit()
            return jsonify({'success': True, 'message': 'Regex agregado correctamente'})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': f'Error al agregar regex: {str(e)}'}), 500
    
    return jsonify({'success': True, 'message': 'Regex ya estaba asociado'})

@store_bp.route('/admin/sms_configs/<int:config_id>/regex', methods=['DELETE'])
@admin_required
def remove_sms_config_regex(config_id):
    """Elimina un regex SMS de un SMS config"""
    data = request.get_json()
    regex_id = data.get('regex_id')
    
    if not regex_id:
        return jsonify({'success': False, 'error': 'regex_id es requerido'}), 400
    
    config = SMSConfig.query.get_or_404(config_id)
    regex = SMSRegex.query.get(regex_id)
    
    if not regex:
        return jsonify({'success': False, 'error': 'Regex no encontrado'}), 404
    
    # Verificar si está asociado usando la relación
    existing_regexes = [r.id for r in config.regexes]
    if regex_id in existing_regexes:
        config.regexes.remove(regex)
        try:
            db.session.commit()
            return jsonify({'success': True, 'message': 'Regex eliminado correctamente'})
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'error': f'Error al eliminar regex: {str(e)}'}), 500
    
    return jsonify({'success': True, 'message': 'Regex no estaba asociado'})

@store_bp.route('/admin/sms_configs/<int:config_id>/toggle', methods=['POST'])
@admin_required
def toggle_sms_config(config_id):
    """Los números SMS siempre deben estar habilitados. Esta ruta mantiene el estado habilitado."""
    config = SMSConfig.query.get_or_404(config_id)
    
    try:
        # Siempre mantener habilitado
        config.is_enabled = True
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Los números SMS siempre están habilitados.', 'is_enabled': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al actualizar estado: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/test-number-states', methods=['POST'])
@admin_required
def test_sms_number_states():
    """Prueba y actualiza el estado (comprado/temporal) de todos los números SMS"""
    try:
        # Obtener todos los SMSConfig
        configs = SMSConfig.query.all()
        
        if not configs:
            return jsonify({'success': True, 'message': 'No hay números SMS configurados', 'updated': 0}), 200
        
        updated_count = 0
        results = []
        
        for config in configs:
            try:
                # Consultar Twilio para obtener el tipo de número
                number_type = check_twilio_number_type(
                    config.phone_number,
                    config.twilio_account_sid,
                    config.twilio_auth_token
                )
                
                # Actualizar en la base de datos
                config.number_type = number_type
                updated_count += 1
                
                type_labels = {
                    'comprado': 'Comprado',
                    'temporal': 'Temporal',
                    'desconocido': 'Desconocido'
                }
                
                results.append({
                    'phone_number': config.phone_number,
                    'name': config.name,
                    'number_type': number_type,
                    'label': type_labels.get(number_type, 'Desconocido')
                })
                
            except Exception as e:
                results.append({
                    'phone_number': config.phone_number,
                    'name': config.name,
                    'number_type': 'desconocido',
                    'label': 'Error al verificar',
                    'error': str(e)
                })
        
        # Guardar todos los cambios
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Estados actualizados correctamente. {updated_count} número(s) verificados.',
            'updated': updated_count,
            'results': results
        })
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f'Error al probar estados: {str(e)}'}), 500

@store_bp.route('/admin/sms_configs/<int:config_id>/messages', methods=['GET'])
@admin_required
def list_sms_messages(config_id):
    """Lista los mensajes recibidos para una configuración SMS (sin filtrar por regex - los regex solo se aplican en la plantilla de búsqueda)"""
    try:
        config = SMSConfig.query.get_or_404(config_id)
        
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        
        # Obtener todos los mensajes del config (sin filtrar por regex en admin)
        query = SMSMessage.query.filter_by(sms_config_id=config_id)
        
        # Devolver todos los mensajes normalmente (los regex solo se aplican en la plantilla de búsqueda para usuarios)
        messages = query.order_by(SMSMessage.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
        
        messages_data = [{
            'id': msg.id,
            'from_number': msg.from_number,
            'to_number': msg.to_number,
            'message_body': msg.message_body,
            'twilio_status': msg.twilio_status,
            'processed': msg.processed,
            'created_at': utc_to_colombia(msg.created_at).strftime('%d/%m/%Y|%I:%M %p') if msg.created_at else None,
        } for msg in messages.items]
        
        return jsonify({
            'success': True,
            'messages': messages_data,
            'total': messages.total,
            'pages': messages.pages,
            'current_page': page
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'Error al listar mensajes: {str(e)}'}), 500

@store_bp.route('/admin/sms/all-messages', methods=['GET'])
@admin_required
def get_all_sms_messages():
    """Obtiene todos los mensajes SMS de todos los números configurados (ordenados del más reciente al más antiguo)"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 100, type=int)
    
    # Siempre ordenar del más reciente al más antiguo
    messages = SMSMessage.query.order_by(SMSMessage.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    messages_data = [{
        'id': msg.id,
        'sms_config_id': msg.sms_config_id,
        'from_number': msg.from_number,
        'to_number': msg.to_number,
        'message_body': msg.message_body,
        'twilio_status': msg.twilio_status,
        'processed': msg.processed,
        'created_at': utc_to_colombia(msg.created_at).strftime('%m/%d %I:%M %p') if msg.created_at else None,
    } for msg in messages.items]
    
    return jsonify({
        'success': True,
        'messages': messages_data,
        'total': messages.total,
        'pages': messages.pages,
        'current_page': page
    })

@store_bp.route('/admin/sms/message/<int:message_id>', methods=['GET'])
@admin_required
def get_sms_message_by_id(message_id):
    """Obtiene un mensaje SMS por su ID (sin necesidad de config_id)"""
    message = SMSMessage.query.get_or_404(message_id)
    
    return jsonify({
        'success': True,
        'message': {
            'id': message.id,
            'sms_config_id': message.sms_config_id,
            'from_number': message.from_number,
            'to_number': message.to_number,
            'message_body': message.message_body,
            'twilio_message_sid': message.twilio_message_sid,
            'twilio_status': message.twilio_status,
            'processed': message.processed,
            'raw_data': message.raw_data,
            'created_at': utc_to_colombia(message.created_at).strftime('%d/%m/%Y|%I:%M %p') if message.created_at else None,
            'processed_at': utc_to_colombia(message.processed_at).strftime('%d/%m/%Y|%I:%M %p') if message.processed_at else None
        }
    })

@store_bp.route('/admin/sms/set-selected-number', methods=['POST'])
@admin_required
def set_selected_sms_number():
    """Guarda el número SMS seleccionado en la sesión y en la base de datos del usuario"""
    data = request.get_json()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if sms_config_id:
        # Validar que el sms_config_id existe
        sms_config = SMSConfig.query.get(sms_config_id)
        if not sms_config:
            return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
        
        # Guardar en sesión (para uso inmediato)
        session['selected_sms_config_id'] = sms_config_id
        
        # Guardar en base de datos (para persistencia entre sesiones)
        current_user = get_current_user()
        if current_user:
            try:
                current_user.last_selected_sms_config_id = sms_config_id
                db.session.commit()
            except Exception as e:
                db.session.rollback()
    else:
        # Limpiar selección
        session.pop('selected_sms_config_id', None)
        
        # Limpiar también en base de datos
        current_user = get_current_user()
        if current_user:
            try:
                current_user.last_selected_sms_config_id = None
                db.session.commit()
            except Exception as e:
                db.session.rollback()
    
    return jsonify({'success': True, 'message': 'Número seleccionado guardado.'})

@store_bp.route('/admin/sms/allowed-numbers/paginated', methods=['GET'])
@admin_required
def list_allowed_sms_numbers_paginated():
    """Devuelve una lista paginada de números permitidos para SMS filtrados por sms_config_id"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    sms_config_id = request.args.get('sms_config_id', type=int)
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Validar que el sms_config_id existe
    sms_config = SMSConfig.query.get(sms_config_id)
    if not sms_config:
        return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
    
    # Validar per_page, si se pide "Todos", usar un número muy grande
    query = AllowedSMSNumber.query.filter_by(sms_config_id=sms_config_id)
    if per_page == -1:
        total_count = query.count()
        per_page = total_count + 1 if total_count > 0 else 10
    
    # Consulta paginada filtrada por sms_config_id
    pagination = query.order_by(AllowedSMSNumber.phone_number.asc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    numbers_data = [num.phone_number for num in pagination.items]
    
    return jsonify({
        'success': True,
        'numbers': numbers_data,
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page if per_page > 0 else -1,
            'total_pages': pagination.pages,
            'total_items': pagination.total,
            'has_prev': pagination.has_prev,
            'has_next': pagination.has_next
        }
    })

@store_bp.route('/admin/sms/allowed-numbers/search', methods=['POST'])
@admin_required
def search_allowed_sms_numbers():
    """Busca correos/números dentro de AllowedSMSNumber filtrados por sms_config_id, aceptando múltiples términos"""
    import re
    from sqlalchemy import or_, func
    
    data = request.get_json()
    search_text = data.get('search_text', '').strip()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Validar que el sms_config_id existe
    sms_config = SMSConfig.query.get(sms_config_id)
    if not sms_config:
        return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
    
    # Procesar el texto de búsqueda para obtener una lista de términos no vacíos
    search_terms = [t.strip().lower() for t in re.split(r'[,\n\r\s]+', search_text) if t.strip()]
    
    # Base query filtrada por sms_config_id
    base_query = AllowedSMSNumber.query.filter_by(sms_config_id=sms_config_id)
    
    if not search_terms:
        numbers_query = base_query.filter(db.false()).order_by(AllowedSMSNumber.phone_number.asc())
    else:
        # Construir una condición OR con ILIKE para cada término (normalizado a minúsculas)
        # Usar LOWER() para comparar en minúsculas ya que los correos se guardan en minúsculas
        conditions = []
        for term in search_terms:
            conditions.append(func.lower(AllowedSMSNumber.phone_number).like(f'%{term}%'))
        # Aplicar el filtro OR a la consulta
        numbers_query = base_query.filter(or_(*conditions)).order_by(AllowedSMSNumber.phone_number.asc())
    
    found_numbers = [num.phone_number for num in numbers_query.all()]
    
    return jsonify({'success': True, 'numbers': found_numbers})

@store_bp.route('/admin/sms/allowed-numbers/delete', methods=['POST'])
@admin_required
def delete_allowed_sms_number():
    """Elimina un correo/número específico de AllowedSMSNumber filtrado por sms_config_id"""
    import re
    data = request.get_json()
    phone_number = data.get('phone_number', '').strip()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not phone_number:
        return jsonify({'success': False, 'message': 'Falta el correo o número.'}), 400
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Normalizar: si es correo, convertir a minúsculas; si es número, agregar +
    phone_number_normalized = phone_number.lower()
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, phone_number_normalized):
        # No es correo, tratar como número
        if not phone_number_normalized.startswith('+'):
            phone_number_normalized = '+' + phone_number_normalized
    
    # Buscar tanto con el valor original como con el normalizado, filtrado por sms_config_id
    deleted_count = AllowedSMSNumber.query.filter(
        AllowedSMSNumber.sms_config_id == sms_config_id,
        db.or_(
            AllowedSMSNumber.phone_number == phone_number,
            AllowedSMSNumber.phone_number == phone_number_normalized
        )
    ).delete()
    
    try:
        db.session.commit()
        if deleted_count > 0:
            return jsonify({'success': True, 'message': 'Correo eliminado correctamente.'})
        else:
            return jsonify({'success': False, 'message': 'Correo no encontrado.'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error al eliminar el correo.'}), 500

@store_bp.route('/admin/sms/allowed-numbers/delete-many', methods=['POST'])
@admin_required
def delete_many_allowed_sms_numbers():
    """Elimina varios correos/números a la vez de AllowedSMSNumber filtrados por sms_config_id"""
    import re
    data = request.get_json()
    phone_numbers = data.get('phone_numbers', [])
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not phone_numbers:
        return jsonify({'success': False, 'message': 'No se proporcionaron correos o números.'}), 400
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Normalizar: correos a minúsculas, números con +
    normalized_numbers = []
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    
    for num in phone_numbers:
        if isinstance(num, str) and num.strip():
            normalized = num.strip().lower()
            # Si no es correo, tratar como número
            if not re.match(email_pattern, normalized):
                if not normalized.startswith('+'):
                    normalized = '+' + normalized
            normalized_numbers.append(normalized)
    
    # También incluir los valores originales por si acaso
    all_numbers = list(set(normalized_numbers + [n.strip() for n in phone_numbers if isinstance(n, str) and n.strip()]))
    
    if not all_numbers:
        return jsonify({'success': False, 'message': 'No hay correos o números válidos para eliminar.'}), 400
    
    deleted_count = AllowedSMSNumber.query.filter(
        AllowedSMSNumber.sms_config_id == sms_config_id,
        AllowedSMSNumber.phone_number.in_(all_numbers)
    ).delete(synchronize_session=False)
    
    try:
        db.session.commit()
        return jsonify({'success': True, 'message': f'{deleted_count} correo(s) eliminado(s).'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error al eliminar los correos.'}), 500

@store_bp.route('/admin/sms/allowed-numbers/delete-all', methods=['POST'])
@admin_required
def delete_all_allowed_sms_numbers():
    """Elimina TODOS los números permitidos de un sms_config_id específico"""
    data = request.get_json()
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    try:
        deleted_count = AllowedSMSNumber.query.filter_by(sms_config_id=sms_config_id).delete()
        db.session.commit()
        return jsonify({'success': True, 'message': f'{deleted_count} número(s) eliminado(s).'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error interno al eliminar todos los números.'}), 500

@store_bp.route('/admin/sms/allowed-numbers/add', methods=['POST'])
@admin_required
def add_allowed_sms_numbers():
    """Añade una lista de nuevos números permitidos vinculados a un sms_config_id específico. Evita añadir duplicados."""
    import re
    
    data = request.get_json()
    phone_numbers = data.get('phone_numbers', [])
    sms_config_id = data.get('sms_config_id')
    if sms_config_id is not None:
        try:
            sms_config_id = int(sms_config_id)
        except (ValueError, TypeError):
            sms_config_id = None
    
    if not sms_config_id:
        return jsonify({'success': False, 'message': 'Debe seleccionar un número SMS primero.'}), 400
    
    # Validar que el sms_config_id existe
    sms_config = SMSConfig.query.get(sms_config_id)
    if not sms_config:
        return jsonify({'success': False, 'message': 'Número SMS no encontrado.'}), 404
    
    if not phone_numbers:
        return jsonify({'success': False, 'message': 'No se proporcionaron números.'}), 400
    
    # Normalizar y asegurar unicidad en la lista de entrada
    # Aceptar tanto números de teléfono como correos electrónicos
    normalized_new_numbers = []
    
    for num in phone_numbers:
        if isinstance(num, str) and num.strip():
            normalized = num.strip().lower()  # Normalizar a minúsculas para correos
            
            # Verificar si es un correo electrónico
            email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            if re.match(email_pattern, normalized):
                normalized_new_numbers.append(normalized)
            else:
                # Si no es correo, tratar como número de teléfono
                # Agregar + si no lo tiene
                if not normalized.startswith('+'):
                    normalized = '+' + normalized
                # Validar formato básico (al menos 10 caracteres después del +)
                if len(normalized) >= 11 and normalized[1:].replace(' ', '').isdigit():
                    normalized_new_numbers.append(normalized)
    
    # Eliminar duplicados de la lista de entrada
    normalized_new_numbers = list(set(normalized_new_numbers))
    
    if not normalized_new_numbers:
        return jsonify({'success': False, 'message': 'No hay correos o números válidos para añadir.'}), 400
    
    # 1. Verificar si alguno de los correos YA existe en CUALQUIER número (Unicidad Global)
    existing_records = AllowedSMSNumber.query.filter(
        AllowedSMSNumber.phone_number.in_(normalized_new_numbers)
    ).all()
    
    existing_emails = {record.phone_number for record in existing_records}
    
    # 2. Filtrar los que NO existen para agregarlos
    to_add = [num for num in normalized_new_numbers if num not in existing_emails]
    
    # 3. Si no hay ninguno para agregar (todos ya existen)
    if not to_add:
        error_messages = []
        processed_emails = []  # Correos que se procesaron (ya en este número)
        remaining_emails = []  # Correos que quedan pendientes (en otros números)
        
        for record in existing_records:
            if record.sms_config_id == sms_config_id:
                # Ya existe en ESTE mismo número (azul) - se procesó
                error_messages.append(f'<span class="text-info">• {record.phone_number} (ya agregado a este número)</span>')
                processed_emails.append(record.phone_number)
            else:
                # Existe en OTRO número (rojo) - queda pendiente
                config = SMSConfig.query.get(record.sms_config_id)
                config_info = f"{config.name} ({config.phone_number})" if config else f"ID {record.sms_config_id}"
                error_messages.append(f'<span class="text-danger">• {record.phone_number} (ya está en {config_info})</span>')
                remaining_emails.append(record.phone_number)
            
        msg_html = '<div class="mb-1">Detalle de los correos no agregados:<br>' + '<br>'.join(error_messages) + '</div>'
        return jsonify({
            'success': False, 
            'message': msg_html,
            'is_html': True,
            'added_count': 0,
            'processed_emails': processed_emails,  # Correos que se procesaron y deben eliminarse del input
            'remaining_emails': remaining_emails  # Correos que quedan pendientes
        }), 200

    # 4. Agregar los nuevos
    new_number_objects = []
    for number in to_add:
        new_number_objects.append(AllowedSMSNumber(phone_number=number, sms_config_id=sms_config_id))
    
    db.session.bulk_save_objects(new_number_objects)
    actually_added_count = len(new_number_objects)
    
    try:
        db.session.commit()
        
        # Construir mensaje de respuesta
        if existing_records:
            # Éxito parcial
            error_messages = []
            processed_emails = []  # Correos que se procesaron (agregados o ya en este número)
            remaining_emails = []  # Correos que quedan pendientes (en otros números)
            
            for record in existing_records:
                if record.sms_config_id == sms_config_id:
                    # Ya existe en ESTE mismo número (azul) - se procesó
                    error_messages.append(f'<span class="text-info">• {record.phone_number} (ya agregado a este número)</span>')
                    processed_emails.append(record.phone_number)
                else:
                    # Existe en OTRO número (rojo) - queda pendiente
                    config = SMSConfig.query.get(record.sms_config_id)
                    config_info = f"{config.name} ({config.phone_number})" if config else f"ID {record.sms_config_id}"
                    error_messages.append(f'<span class="text-danger">• {record.phone_number} (ya está en {config_info})</span>')
                    remaining_emails.append(record.phone_number)
            
            # Agregar los correos que se agregaron exitosamente a la lista de procesados
            processed_emails.extend(to_add)
            
            # Construir mensaje HTML
            msg_html = ""
            if actually_added_count > 0:
                msg_html += f'<div class="text-success mb-2">✔ Se agregaron {actually_added_count} correos correctamente.</div>'
            
            msg_html += '<div class="mb-1">Detalle de los no agregados:<br>' + '<br>'.join(error_messages) + '</div>'
            
            return jsonify({
                'success': False, # Para no limpiar el input automáticamente
                'message': msg_html,
                'added_count': actually_added_count,
                'is_html': True,
                'processed_emails': processed_emails,  # Correos que se procesaron y deben eliminarse del input
                'remaining_emails': remaining_emails  # Correos que quedan pendientes
            }), 200
        else:
            # Éxito total - todos los correos se agregaron
            return jsonify({
                'success': True, 
                'added_count': actually_added_count, 
                'message': f'Se agregaron {actually_added_count} correos correctamente.',
                'processed_emails': to_add,  # Todos los correos se procesaron
                'remaining_emails': []
            })
            
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': 'Error al guardar los nuevos números.'}), 500

@csrf_exempt_route
@store_bp.route('/sms/webhook', methods=['POST'])
def sms_webhook():
    """Webhook público para recibir SMS de Twilio"""
    from app.services.sms_service import receive_sms_webhook
    
    try:
        twiml_response = receive_sms_webhook()
        return twiml_response, 200, {'Content-Type': 'text/xml'}
    
    except Exception as e:
        from twilio.twiml.messaging_response import MessagingResponse
        response = MessagingResponse()
        return str(response), 200, {'Content-Type': 'text/xml'}

@store_bp.route('/admin/sms/cleanup', methods=['POST'])
@admin_required
def cleanup_sms_messages():
    """Elimina mensajes SMS antiguos (más de 15 minutos) y huérfanos manualmente"""
    try:
        from datetime import datetime, timedelta
        
        # Calcular la fecha límite: mensajes mayores a 15 minutos
        time_limit = datetime.utcnow() - timedelta(minutes=15)
        
        # Buscar mensajes antiguos
        old_messages = SMSMessage.query.filter(
            SMSMessage.created_at < time_limit
        ).all()
        
        # Buscar mensajes huérfanos (sin sms_config asociado)
        # Usar LEFT JOIN para encontrar mensajes cuyo sms_config_id no existe en sms_configs
        from sqlalchemy import and_
        orphan_messages = db.session.query(SMSMessage).outerjoin(
            SMSConfig, SMSMessage.sms_config_id == SMSConfig.id
        ).filter(
            SMSConfig.id.is_(None)
        ).all()
        
        # Combinar ambos tipos de mensajes a eliminar (sin duplicados)
        messages_to_delete = list(set(old_messages + orphan_messages))
        
        deleted_count = 0
        orphan_count = 0
        
        if messages_to_delete:
            for msg in messages_to_delete:
                # Verificar si es huérfano
                if msg not in old_messages:
                    orphan_count += 1
                db.session.delete(msg)
                deleted_count += 1
            
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': f'Se eliminaron {deleted_count} mensajes SMS ({len(old_messages)} antiguos, {orphan_count} huérfanos).',
                'deleted_count': deleted_count,
                'old_count': len(old_messages),
                'orphan_count': orphan_count
            }), 200
        else:
            return jsonify({
                'success': True,
                'message': 'No hay mensajes SMS antiguos o huérfanos para eliminar.',
                'deleted_count': 0,
                'old_count': 0,
                'orphan_count': 0
            }), 200
            
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error al limpiar mensajes SMS: {str(e)}'
        }), 500

@store_bp.route('/sms/my-messages', methods=['GET'])
def get_my_sms_messages():
    """
    Obtiene los últimos 15 mensajes SMS permitidos para el usuario logueado.
    Verifica si el correo del usuario está en AllowedSMSNumber.
    Filtra por regex si están configurados para cada SMS config.
    """
    import re
    current_user = get_current_user()
    if not current_user:
        return jsonify({'success': False, 'error': 'Usuario no autenticado'}), 401
    
    # Normalizar correo del usuario
    user_email = current_user.username.lower() if '@' in current_user.username else None
    
    if not user_email:
        # Si el username no es un email, intentar buscar el email asociado si existe un campo email
        user_email = current_user.username.lower()

    # Buscar configuraciones SMS permitidas para este correo
    # Buscar en AllowedSMSNumber
    from sqlalchemy import func
    allowed_configs = db.session.query(AllowedSMSNumber.sms_config_id).filter(
        func.lower(AllowedSMSNumber.phone_number) == user_email
    ).all()
    
    if not allowed_configs:
        return jsonify({'success': True, 'messages': [], 'message': 'No tienes acceso a ningún número SMS.'})
    
    allowed_config_ids = [r[0] for r in allowed_configs]
    
    # Obtener todos los mensajes de los números permitidos
    all_messages = SMSMessage.query.filter(
        SMSMessage.sms_config_id.in_(allowed_config_ids)
    ).order_by(
        SMSMessage.created_at.desc()
    ).all()
    
    # Filtrar por regex SMS si están configurados
    filtered_messages = []
    for msg in all_messages:
        config = SMSConfig.query.get(msg.sms_config_id)
        if config:
            try:
                regex_count = config.regexes.count()
            except Exception:
                regex_count = 0
            
            if regex_count > 0:
                # Si hay regex SMS configurados, filtrar
                try:
                    regexes = list(config.regexes.filter_by(enabled=True).all())
                except Exception:
                    regexes = []
                
                matches_regex = False
                for regex_obj in regexes:
                    try:
                        # Buscar en el cuerpo del mensaje y en el número de origen
                        if regex_obj.pattern:
                            if re.search(regex_obj.pattern, msg.message_body, re.IGNORECASE) or \
                               re.search(regex_obj.pattern, msg.from_number, re.IGNORECASE):
                                matches_regex = True
                                break
                    except re.error:
                        continue
                if matches_regex:
                    filtered_messages.append(msg)
            else:
                # Si no hay regex configurados, incluir todos los mensajes
                filtered_messages.append(msg)
        else:
            # Si no hay config, incluir el mensaje
            filtered_messages.append(msg)
    
    # Ordenar por fecha descendente y limitar a 15
    filtered_messages.sort(key=lambda x: x.created_at, reverse=True)
    filtered_messages = filtered_messages[:15]
    
    messages_data = [{
        'id': msg.id,
        'from_number': msg.from_number,
        'message_body': msg.message_body,
        'created_at': utc_to_colombia(msg.created_at).strftime('%m/%d %I:%M %p') if msg.created_at else None,
        'ago': timesince(msg.created_at) if msg.created_at else ''
    } for msg in filtered_messages]
    
    return jsonify({
        'success': True, 
        'messages': messages_data,
        'count': len(messages_data)
    })

