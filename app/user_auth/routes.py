# app/user_auth/routes.py

from flask import render_template, request, flash, redirect, url_for, session, current_app
from werkzeug.security import check_password_hash
from datetime import datetime
from app.models import User
from app.extensions import db
from config import Config
from functools import wraps

# Importar el blueprint desde el módulo actual
from . import user_auth_bp
from app.auth.security import (
    record_login_attempt, 
    is_blocked, 
    reset_failed_attempts, 
    block_user
)

# Importar el decorador de control de acceso a la tienda
from app.store.routes import store_access_required

# Decorador para excluir rutas del CSRF
def csrf_exempt_route(func):
    """Decorator para excluir rutas del CSRF"""
    func._csrf_exempt = True
    return func

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            flash('Por favor inicie sesión para acceder a esta página.', 'danger')
            return redirect(url_for('user_auth_bp.login'))
        return f(*args, **kwargs)
    return decorated_function

@user_auth_bp.before_app_request
def check_session_revocation_user():
    """
    Verifica si el usuario principal o sub-usuario sigue habilitado o existe.
    Si no, fuerza cierre de sesión y redirige a login.
    Además, fuerza cierre de sesión si el contador user_session_rev_count cambió (revocación individual).
    NOTA: La verificación global session_revocation_count ahora se maneja en app/__init__.py
    """
    if "logged_in" in session and "is_user" in session:
        user_id = session.get("user_id")
        if user_id:
            user_obj = User.query.get(user_id)
            if not user_obj:
                session.clear()
                flash("El usuario fue eliminado.", "danger")
                return redirect(url_for("user_auth_bp.login"))
            if not user_obj.enabled:
                session.clear()
                flash("Este usuario está deshabilitado (OFF).", "danger")
                return redirect(url_for("user_auth_bp.login"))
            # Revocación individual por cambio en user_session_rev_count
            if user_obj.user_session_rev_count > session.get("user_session_rev_count_local", 0):
                session.clear()
                flash("Tu sesión se ha cerrado por un cambio en tu configuración de usuario.", "info")
                return redirect(url_for("user_auth_bp.login"))

@user_auth_bp.route("/login", methods=["GET", "POST"])
@csrf_exempt_route
def login():
    """
    Pantalla de login para usuarios normales (o sub-usuarios).
    """
    # Si ya está logueado, redirigir al home
    if "logged_in" in session and "is_user" in session:
        return redirect(url_for("main_bp.home"))

    if request.method == "GET":
        return render_template("user_login.html")

    # --- INICIO PROCESO POST --- 
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    # 1. Verificar si el usuario está bloqueado
    if is_blocked(username):
        user_temp = User.query.filter_by(username=username).first()
        if user_temp and user_temp.blocked_until:
             tiempo_restante = user_temp.blocked_until - datetime.utcnow()
             # Asegurarse que tiempo_restante sea positivo
             mins_restantes = max(0, tiempo_restante.seconds // 60)
             flash(f"Cuenta bloqueada. Intenta de nuevo en {mins_restantes} min.", "warning")
        else:
             flash("Cuenta bloqueada temporalmente.", "warning")
        return render_template("user_login.html")

    # 2. Obtener usuario
    user = User.query.filter_by(username=username).first()

    # ✅ SEGURIDAD: El admin no puede loguearse en la plantilla de usuarios
    if user and username == current_app.config.get("ADMIN_USER"):
        flash("Acceso denegado.", "danger")
        return render_template("user_login.html")

    # 3. Validar contraseña y estado
    if user and user.enabled and check_password_hash(user.password, password):
        # --- LOGIN EXITOSO --- 
        # a) Resetear contadores (antes de commit)
        reset_failed_attempts(user) 
        # b) Configurar sesión
        from app.auth.session_tokens import generate_session_token
        
        # ✅ SEGURIDAD: Generar token de sesión único para prevenir duplicaciones
        session_token = generate_session_token(user.id, is_admin=False)
        
        session.clear()
        session["logged_in"] = True
        session["user_id"] = user.id
        session["is_user"] = True
        session["session_token"] = session_token  # ✅ Token único de sesión
        session.permanent = True
        session["user_session_rev_count_local"] = user.user_session_rev_count
        session["login_time"] = datetime.utcnow().isoformat()  # ✅ SEGURIDAD: Timestamp de login
        
        # ✅ AGREGADO: Asignar contador global de revocación para "cerrar sesión de todos"
        from app.admin.site_settings import get_site_setting
        rev_str = get_site_setting("session_revocation_count", "0")
        session["session_revocation_count"] = int(rev_str)
        # c) Commit final para guardar reseteo de contadores
        try:
            db.session.commit()
            flash("Login exitoso (usuario).", "success")
            return redirect(url_for("main_bp.home"))
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error al hacer commit en login de usuario {username}: {e}", exc_info=True)
            flash("Error interno al iniciar sesión.", "danger")
            return render_template("user_login.html")

    else:
        # --- LOGIN FALLIDO --- 
        flash_message = "Credenciales inválidas." 
        if user and not user.enabled:
             flash_message = "Este usuario está deshabilitado (OFF)."
        
        # a) Registrar intento fallido (antes de commit)
        # Solo registrar si el usuario existe
        if user:
             record_login_attempt(user.username, success=False)
             # b) Commit para guardar intento fallido y posible bloqueo
             try:
                 db.session.commit()
                 # c) Verificar si AHORA está bloqueado y mostrar mensaje correcto
                 if is_blocked(username): 
                      tiempo_restante = user.blocked_until - datetime.utcnow()
                      mins_restantes = max(0, tiempo_restante.seconds // 60)
                      flash(f"Has superado los intentos permitidos. Cuenta bloqueada por {mins_restantes} min.", "danger")
                 else:
                      flash(flash_message, "danger") # Mostrar mensaje original si no se bloqueó
             except Exception as e:
                  db.session.rollback()
                  current_app.logger.error(f"Error al hacer commit en login fallido de usuario {username}: {e}", exc_info=True)
                  flash("Error interno al procesar el intento de login.", "danger")
        else:
             # Usuario no existe
             flash(flash_message, "danger") 
        
        return render_template("user_login.html")

@user_auth_bp.route("/logout")
def logout():
    if "logged_in" in session and "is_user" in session:
        # ✅ SEGURIDAD: Revocar token de sesión antes de limpiar
        from app.auth.session_tokens import revoke_session_token
        session_token = session.get("session_token")
        if session_token:
            revoke_session_token(session_token)
        
        session.clear()
        flash("Sesión de usuario cerrada.", "info")
    return redirect(url_for("user_auth_bp.login"))

@user_auth_bp.route("/estadisticas")
@store_access_required
def estadisticas():
    """Página de estadísticas para usuarios normales."""
    # Obtener usuario
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    
    if not user:
        flash("Usuario no encontrado.", "danger")
        return redirect(url_for("main_bp.home"))
    
    # Calcular fecha límite (3 meses hacia atrás desde hoy)
    from datetime import timedelta
    
    from app.utils.timezone import get_colombia_now, utc_to_colombia
    fecha_hoy = get_colombia_now()
    fecha_limite = fecha_hoy - timedelta(days=90)  # 3 meses = aproximadamente 90 días
    
    # Obtener compras de los últimos 3 meses
    from app.store.models import Sale, Product
    from sqlalchemy import func, desc
    from app import db
    
    compras = db.session.query(Sale, Product).join(
        Product, Sale.product_id == Product.id
    ).filter(
        Sale.user_id == user.id,
        Sale.created_at >= fecha_limite
    ).order_by(Sale.created_at.desc()).all()
    
    # ============ ESTADÍSTICAS RESUMEN ============
    # Total gastado
    total_gastado = db.session.query(func.sum(Sale.total_price)).filter(
        Sale.user_id == user.id,
        Sale.created_at >= fecha_limite
    ).scalar() or 0
    total_gastado = float(total_gastado)
    
    # Total de compras
    total_compras = len(compras)
    
    # Promedio por compra
    promedio_compra = total_gastado / total_compras if total_compras > 0 else 0
    
    # Productos más comprados (top 5)
    productos_top = db.session.query(
        Product.name,
        func.sum(Sale.quantity).label('total_cantidad'),
        func.sum(Sale.total_price).label('total_gastado')
    ).join(
        Sale, Product.id == Sale.product_id
    ).filter(
        Sale.user_id == user.id,
        Sale.created_at >= fecha_limite
    ).group_by(Product.name).order_by(desc('total_cantidad')).limit(5).all()
    
    # Gasto por mes (últimos 3 meses)
    gasto_por_mes = []
    
    # Calcular los 3 meses hacia atrás desde hoy
    for i in range(3):
        # Mes actual (i=0), hace 1 mes (i=1), hace 2 meses (i=2)
        if i == 0:
            # Mes actual
            mes_fecha = fecha_hoy.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            # Meses anteriores
            mes = fecha_hoy.month - i
            año = fecha_hoy.year
            while mes <= 0:
                mes += 12
                año -= 1
            mes_fecha = fecha_hoy.replace(year=año, month=mes, day=1, hour=0, minute=0, second=0, microsecond=0)
        
        # Primer día del mes siguiente
        if mes_fecha.month == 12:
            mes_siguiente = mes_fecha.replace(year=mes_fecha.year + 1, month=1, day=1)
        else:
            mes_siguiente = mes_fecha.replace(month=mes_fecha.month + 1, day=1)
        
        gasto_mes = db.session.query(func.sum(Sale.total_price)).filter(
            Sale.user_id == user.id,
            Sale.created_at >= mes_fecha,
            Sale.created_at < mes_siguiente
        ).scalar() or 0
        
        gasto_por_mes.append({
            'mes': mes_fecha.strftime('%B %Y'),
            'mes_corto': mes_fecha.strftime('%b %Y'),
            'gasto': float(gasto_mes)
        })
    
    # Revertir para mostrar del más antiguo al más reciente
    gasto_por_mes.reverse()
    
    # Calcular porcentajes después de obtener el total
    total_para_porcentaje = sum(m['gasto'] for m in gasto_por_mes) if gasto_por_mes else 0
    for mes_data in gasto_por_mes:
        if total_para_porcentaje > 0:
            mes_data['porcentaje'] = round((mes_data['gasto'] / total_para_porcentaje * 100), 1)
        else:
            mes_data['porcentaje'] = 0
    
    # ============ ESTADÍSTICAS LISTA ============
    # Lista detallada de compras
    compras_detalladas = []
    for sale, product in compras:
        fecha_colombia = sale.created_at
        if fecha_colombia:
            # Convertir a zona horaria de Colombia usando módulo centralizado
            fecha_colombia = utc_to_colombia(fecha_colombia)
            fecha_str = fecha_colombia.strftime('%Y-%m-%d %H:%M:%S')
            fecha_corta = fecha_colombia.strftime('%d/%m/%Y')
        else:
            fecha_str = 'Fecha no disponible'
            fecha_corta = 'N/A'
        
        compras_detalladas.append({
            'id': sale.id,
            'fecha': fecha_str,
            'fecha_corta': fecha_corta,
            'producto': product.name,
            'cantidad': sale.quantity,
            'total': float(sale.total_price),
            'product_id': product.id
        })
    
    return render_template("estadisticas.html", 
                         current_user=user,
                         total_gastado=total_gastado,
                         total_compras=total_compras,
                         promedio_compra=promedio_compra,
                         productos_top=productos_top,
                         gasto_por_mes=gasto_por_mes,
                         compras_detalladas=compras_detalladas)
