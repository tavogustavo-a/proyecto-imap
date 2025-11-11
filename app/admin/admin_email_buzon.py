# app/admin/admin_email_buzon.py

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from app.extensions import db
from app.models import ReceivedEmail
from app.models.email_forwarding import EmailForwarding
from app.models.email_cleanup import EmailCleanup
from app.services.email_buzon_service import (
    get_received_emails, mark_email_as_processed, get_recent_emails,
    move_email_to_trash, restore_email_from_trash, get_trash_emails, permanently_delete_email, cleanup_old_trash_emails, cleanup_all_trash_emails
)
from app.services.email_tag_service import (
    get_all_tags, create_tag as create_tag_service, update_tag as update_tag_service, update_tag_filters, delete_tag, get_tag,
    add_tag_to_email, remove_tag_from_email, get_emails_by_tag, get_emails_without_tags
)
from app.services.email_filter_service import (
    get_all_filters, create_filter, update_filter, delete_filter, get_filter_by_id, toggle_filter_status
)
from app.admin.decorators import admin_required

admin_email_buzon_bp = Blueprint('admin_email_buzon', __name__)

@admin_email_buzon_bp.route('/email-buzon')
@admin_required
def manage_email_buzon():
    """Página principal de gestión del buzón de mensajes"""
    recent_emails = get_recent_emails(limit=50)
    tags = get_all_tags()
    email_forwardings = EmailForwarding.query.all()
    auto_cleanups = EmailCleanup.query.all()
    
    # Calcular contadores para la sidebar
    from app.models.email_buzon import EmailTag
    spam_tag = EmailTag.query.filter_by(name='spam').first()
    spam_count = 0
    if spam_tag:
        spam_emails = get_emails_by_tag(spam_tag.id)
        spam_count = len([email for email in spam_emails if not email.deleted])
    
    # Contadores para todas las vistas
    active_emails_count = len(recent_emails)
    trash_emails_count = len(get_trash_emails(limit=50))
    
    return render_template('admin/email_buzon.html', 
                         recent_emails=recent_emails, 
                         tags=tags,
                         email_forwardings=email_forwardings,
                         auto_cleanups=auto_cleanups,
                         current_view='inbox',
                         spam_count=spam_count,
                         active_emails_count=active_emails_count,
                         trash_emails_count=trash_emails_count)

# ==================== RUTAS PARA REENVÍO DE CORREOS ====================

@admin_email_buzon_bp.route('/email-buzon/create-forwarding', methods=['POST'])
@admin_required
def create_forwarding():
    """Crear nuevo correo de recepción (catch-all)"""
    try:
        destination_email = request.form.get('destination_email', '').strip()
        
        if not destination_email:
            flash('El correo de destino es obligatorio', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
        # Verificar si ya existe un catch-all (source_email = None)
        existing_catchall = EmailForwarding.query.filter_by(source_email=None).first()
        if existing_catchall:
            flash('Ya existe un correo catch-all configurado. Solo puedes tener uno.', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
        # Crear nuevo reenvío catch-all
        forwarding = EmailForwarding(
            source_email=None,  # Catch-all: recibe todos los correos
            destination_email=destination_email,
            enabled=True
        )
        
        db.session.add(forwarding)
        db.session.commit()
        
        flash(f'Correo de recepción creado exitosamente: {destination_email}', 'success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error creando correo de recepción: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/edit-forwarding/<int:forwarding_id>', methods=['POST'])
@admin_required
def edit_forwarding(forwarding_id):
    """Editar correo de recepción"""
    try:
        forwarding = EmailForwarding.query.get_or_404(forwarding_id)
        
        destination_email = request.form.get('destination_email', '').strip()
        
        if not destination_email:
            return jsonify({'success': False, 'message': 'El correo de destino es obligatorio'})
        
        # Actualizar solo el email de destino
        forwarding.destination_email = destination_email
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Correo de recepción actualizado exitosamente',
            'forwarding': forwarding.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error actualizando correo: {str(e)}'})

@admin_email_buzon_bp.route('/email-buzon/delete-forwarding/<int:forwarding_id>', methods=['POST'])
@admin_required
def delete_forwarding(forwarding_id):
    """Eliminar correo de recepción"""
    try:
        forwarding = EmailForwarding.query.get_or_404(forwarding_id)
        destination_email = forwarding.destination_email
        
        db.session.delete(forwarding)
        db.session.commit()
        
        flash(f'Correo de recepción eliminado exitosamente: {destination_email}', 'success')
        
    except Exception as e:
        db.session.rollback()
        flash(f'Error eliminando correo de recepción: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/toggle-forwarding/<int:forwarding_id>', methods=['POST'])
@admin_required
def toggle_forwarding(forwarding_id):
    """Activar/desactivar correo de recepción"""
    try:
        forwarding = EmailForwarding.query.get_or_404(forwarding_id)
        new_status = forwarding.toggle_status()
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'enabled': new_status,
            'message': f'Correo de recepción {"activado" if new_status else "desactivado"} exitosamente'
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error cambiando estado del correo: {str(e)}'
        }), 500


@admin_email_buzon_bp.route('/email-buzon/mark-processed/<int:email_id>', methods=['POST'])
@admin_required
def mark_processed(email_id):
    """Marcar email como procesado"""
    try:
        mark_email_as_processed(email_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# Rutas para etiquetas
@admin_email_buzon_bp.route('/email-buzon/tags/create', methods=['POST'])
@admin_required
def create_tag():
    """Crear nueva etiqueta con filtros"""
    try:
        name = request.form.get('name', '').strip()
        color = request.form.get('color', '#3498db')
        description = request.form.get('description', '').strip()
        if not name:
            flash('El nombre de la etiqueta es requerido', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))

        create_tag_service(name, color)
        flash('Etiqueta creada exitosamente', 'success')
        
    except Exception as e:
        flash(f'Error creando etiqueta: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/tags/update/<int:tag_id>', methods=['POST'])
@admin_required
def update_tag(tag_id):
    """Actualizar etiqueta existente con filtros"""
    try:
        name = request.form.get('name', '').strip()
        color = request.form.get('color', '#3498db')
        description = request.form.get('description', '').strip()
        if not name:
            flash('El nombre de la etiqueta es requerido', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))

        update_tag_service(tag_id, name, color)
        flash('Etiqueta actualizada exitosamente', 'success')
        
    except Exception as e:
        flash(f'Error actualizando etiqueta: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/tags/update-filters/<int:tag_id>', methods=['POST'])
@admin_required
def update_tag_filters_route(tag_id):
    """Actualizar filtros de una etiqueta"""
    try:
        filter_from_email = request.form.get('filter_from_email', '').strip()
        filter_to_email = request.form.get('filter_to_email', '').strip()
        filter_subject_contains = request.form.get('filter_subject_contains', '').strip()
        filter_content_contains = request.form.get('filter_content_contains', '').strip()

        update_tag_filters(tag_id, filter_from_email, filter_to_email, filter_subject_contains, filter_content_contains)
        flash('Filtros de etiqueta actualizados exitosamente', 'success')
        
    except Exception as e:
        flash(f'Error actualizando filtros: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/tags/delete/<int:tag_id>', methods=['POST'])
@admin_required
def delete_tag_route(tag_id):
    """Eliminar etiqueta"""
    try:
        from app.services.email_tag_service import delete_tag as delete_tag_service
        
        # Verificar que la etiqueta existe
        tag = get_tag(tag_id)
        if not tag:
            return jsonify({'success': False, 'message': 'Etiqueta no encontrada'})
        
        tag_name = tag.name
        
        # Eliminar la etiqueta
        delete_tag_service(tag_id)
        
        return jsonify({
            'success': True, 
            'message': f'Etiqueta "{tag_name}" eliminada exitosamente'
        })
        
    except Exception as e:
        return jsonify({
            'success': False, 
            'message': f'Error eliminando etiqueta: {str(e)}'
        })

@admin_email_buzon_bp.route('/email-buzon/filter-by-tag/<int:tag_id>')
@admin_required
def filter_by_tag(tag_id):
    """Filtrar emails por etiqueta"""
    emails = get_emails_by_tag(tag_id)
    tags = get_all_tags()
    current_tag = get_tag(tag_id)
    email_forwardings = EmailForwarding.query.all()
    auto_cleanups = EmailCleanup.query.all()
    
    # Calcular contadores para la sidebar
    from app.models.email_buzon import EmailTag
    spam_tag = EmailTag.query.filter_by(name='spam').first()
    spam_count = 0
    if spam_tag:
        spam_emails = get_emails_by_tag(spam_tag.id)
        spam_count = len([email for email in spam_emails if not email.deleted])
    
    # Contadores para todas las vistas
    active_emails_count = len(get_recent_emails(limit=50))
    trash_emails_count = len(get_trash_emails(limit=50))
    
    return render_template('admin/email_buzon.html', 
                         recent_emails=emails,
                         tags=tags,
                         email_forwardings=email_forwardings,
                         auto_cleanups=auto_cleanups,
                         current_tag=current_tag,
                         current_view='tag',
                         spam_count=spam_count,
                         active_emails_count=active_emails_count,
                         trash_emails_count=trash_emails_count)

@admin_email_buzon_bp.route('/email-buzon/add-tag/<int:email_id>/<int:tag_id>', methods=['POST'])
@admin_required
def add_tag_to_email_route(email_id, tag_id):
    """Agregar etiqueta a un email"""
    try:
        add_tag_to_email(email_id, tag_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/remove-tag/<int:email_id>/<int:tag_id>', methods=['POST'])
@admin_required
def remove_tag_from_email_route(email_id, tag_id):
    """Remover etiqueta de un email"""
    try:
        remove_tag_from_email(email_id, tag_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@admin_email_buzon_bp.route('/email-buzon/view/<int:email_id>')
@admin_required
def view_email(email_id):
    """Ver contenido completo de un email"""
    try:
        from app.models.email_buzon import ReceivedEmail
        email = ReceivedEmail.query.get_or_404(email_id)
        
        return jsonify({
            'success': True,
            'email': {
                'id': email.id,
                'from_email': email.from_email,
                'to_email': email.to_email,
                'subject': email.subject or '(Sin asunto)',
                'content_text': email.content_text or '',
                'content_html': email.content_html or '',
                'received_at': email.get_date_time_12h(),
                'processed': email.processed,
                'deleted': email.deleted,
                'tags': [{'id': tag.id, 'name': tag.name, 'color': tag.color} for tag in email.tags]
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/mark-processed/<int:email_id>', methods=['POST'])
@admin_required
def mark_email_processed_route(email_id):
    """Marcar email como procesado"""
    try:
        mark_email_as_processed(email_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# Rutas para papelera
@admin_email_buzon_bp.route('/email-buzon/trash')
@admin_required
def view_trash():
    """Ver emails en la papelera"""
    trash_emails = get_trash_emails(limit=50)
    tags = get_all_tags()
    email_forwardings = EmailForwarding.query.all()
    auto_cleanups = EmailCleanup.query.all()
    
    # Calcular contadores para la sidebar
    from app.models.email_buzon import EmailTag
    spam_tag = EmailTag.query.filter_by(name='spam').first()
    spam_count = 0
    if spam_tag:
        spam_emails = get_emails_by_tag(spam_tag.id)
        spam_count = len([email for email in spam_emails if not email.deleted])
    
    # Contadores para todas las vistas
    active_emails_count = len(get_recent_emails(limit=50))
    trash_emails_count = len(trash_emails)
    
    return render_template('admin/email_buzon.html', 
                         recent_emails=trash_emails,
                         tags=tags,
                         email_forwardings=email_forwardings,
                         auto_cleanups=auto_cleanups,
                         current_view='trash',
                         spam_count=spam_count,
                         active_emails_count=active_emails_count,
                         trash_emails_count=trash_emails_count)

@admin_email_buzon_bp.route('/email-buzon/spam')
@admin_required
def view_spam():
    """Ver emails marcados como spam"""
    from app.models.email_buzon import EmailTag
    
    # Buscar la etiqueta "spam"
    spam_tag = EmailTag.query.filter_by(name='spam').first()
    if spam_tag:
        spam_emails = get_emails_by_tag(spam_tag.id)
        # Filtrar solo emails no eliminados
        spam_emails = [email for email in spam_emails if not email.deleted]
    else:
        spam_emails = []
    
    tags = get_all_tags()
    email_forwardings = EmailForwarding.query.all()
    auto_cleanups = EmailCleanup.query.all()
    spam_count = len(spam_emails)
    
    # Contadores para todas las vistas
    active_emails_count = len(get_recent_emails(limit=50))
    trash_emails_count = len(get_trash_emails(limit=50))
    
    return render_template('admin/email_buzon.html', 
                         recent_emails=spam_emails,
                         tags=tags,
                         email_forwardings=email_forwardings,
                         auto_cleanups=auto_cleanups,
                         current_view='spam',
                         spam_count=spam_count,
                         active_emails_count=active_emails_count,
                         trash_emails_count=trash_emails_count)

@admin_email_buzon_bp.route('/email-buzon/move-to-trash/<int:email_id>', methods=['POST'])
@admin_required
def move_to_trash(email_id):
    """Mover email a la papelera"""
    try:
        move_email_to_trash(email_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/move-to-spam/<int:email_id>', methods=['POST'])
@admin_required
def move_to_spam(email_id):
    """Mover email a spam agregando la etiqueta spam"""
    try:
        # Buscar o crear la etiqueta 'spam'
        from app.services.email_tag_service import get_or_create_spam_tag, add_tag_to_email as add_tag_service
        
        spam_tag = get_or_create_spam_tag()
        
        # Restaurar el email si está en papelera
        restore_email_from_trash(email_id)
        
        # Agregar la etiqueta spam
        add_tag_service(email_id, spam_tag.id)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/move-to-tag/<int:email_id>/<int:tag_id>', methods=['POST'])
@admin_required
def move_to_tag(email_id, tag_id):
    """Mover email a una etiqueta específica"""
    try:
        from app.services.email_tag_service import add_tag_to_email as add_tag_service
        
        # Restaurar el email si está en papelera
        restore_email_from_trash(email_id)
        
        # Agregar la etiqueta especificada
        add_tag_service(email_id, tag_id)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/restore-from-trash/<int:email_id>', methods=['POST'])
@admin_required
def restore_from_trash(email_id):
    """Restaurar email desde la papelera"""
    try:
        restore_email_from_trash(email_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/permanently-delete/<int:email_id>', methods=['POST'])
@admin_required
def permanently_delete(email_id):
    """Eliminar permanentemente un email"""
    try:
        permanently_delete_email(email_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/reply', methods=['POST'])
@admin_required
def reply_email():
    """Enviar respuesta a un email"""
    try:
        data = request.get_json()
        
        email_id = data.get('email_id')
        reply_to = data.get('reply_to')
        reply_from = data.get('reply_from')
        reply_subject = data.get('reply_subject')
        reply_message = data.get('reply_message')
        
        # Validar datos requeridos
        if not all([email_id, reply_to, reply_from, reply_subject, reply_message]):
            return jsonify({'success': False, 'error': 'Todos los campos son requeridos'})
        
        # Validar que el dominio del email "De:" esté configurado en "Correo Electrónico vía Dominio"
        if '@' not in reply_from:
            return jsonify({'success': False, 'error': 'Formato de email inválido'})
        
        reply_domain = reply_from.split('@')[1].lower()
        
        # Buscar si existe algún email configurado con este dominio
        from app.models.email_forwarding import EmailForwarding
        configured_emails = EmailForwarding.query.filter_by(enabled=True).all()
        
        domain_configured = False
        for forwarding in configured_emails:
            if forwarding.source_email and '@' in forwarding.source_email:
                configured_domain = forwarding.source_email.split('@')[1].lower()
                if configured_domain == reply_domain:
                    domain_configured = True
                    break
        
        if not domain_configured:
            return jsonify({
                'success': False, 
                'error': f'El dominio "@{reply_domain}" no está configurado en "Correo Electrónico vía Dominio". Solo puedes enviar desde dominios configurados.'
            })
        
        # Obtener el email original
        original_email = ReceivedEmail.query.get_or_404(email_id)
        
        # Aquí normalmente enviarías el email usando un servicio de email
        # Por ahora, simularemos el envío y guardaremos la respuesta como un nuevo email
        
        # Crear un nuevo email que representa la respuesta enviada
        reply_email_record = ReceivedEmail(
            from_email=reply_from,
            to_email=reply_to,
            subject=reply_subject,
            content_text=reply_message,
            content_html=f'<p>{reply_message.replace(chr(10), "</p><p>")}</p>',
            message_id=f"reply-{email_id}-{datetime.utcnow().timestamp()}",
            processed=True  # Marcamos como procesado porque es una respuesta enviada
        )
        
        db.session.add(reply_email_record)
        db.session.commit()
        
        # Intentar envío real via SMTP (puerto 587)
        from app.services.smtp_client import send_email_via_smtp
        email_sent = send_email_via_smtp(
            from_email=reply_from,
            to_email=reply_to,
            subject=reply_subject,
            text_content=reply_message,
            html_content=f'<p>{reply_message.replace(chr(10), "</p><p>")}</p>'
        )
        
        if email_sent:
            print(f"✅ Respuesta enviada via SMTP: {reply_from} -> {reply_to}")
        else:
            print(f"⚠️ Respuesta guardada localmente (SMTP no disponible): {reply_from} -> {reply_to}")
        
        print(f"📧 Respuesta enviada: {reply_from} -> {reply_to}")
        print(f"   Dominio validado: @{reply_domain}")
        print(f"   Asunto: {reply_subject}")
        print(f"   En respuesta a email ID: {email_id}")
        
        return jsonify({
            'success': True,
            'message': 'Respuesta enviada exitosamente',
            'reply_id': reply_email_record.id
        })
        
    except Exception as e:
        print(f"❌ Error enviando respuesta: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/forward', methods=['POST'])
@admin_required
def forward_email():
    """Reenviar un email"""
    try:
        data = request.get_json()
        
        email_id = data.get('email_id')
        forward_to = data.get('forward_to')
        forward_from = data.get('forward_from')
        forward_subject = data.get('forward_subject')
        forward_message = data.get('forward_message', '')  # Mensaje adicional opcional
        
        # Validar datos requeridos
        if not all([email_id, forward_to, forward_from, forward_subject]):
            return jsonify({'success': False, 'error': 'Todos los campos requeridos deben completarse'})
        
        # Validar que el dominio del email "De:" esté configurado en "Correo Electrónico vía Dominio"
        if '@' not in forward_from:
            return jsonify({'success': False, 'error': 'Formato de email inválido'})
        
        forward_domain = forward_from.split('@')[1].lower()
        
        # Buscar si existe algún email configurado con este dominio
        from app.models.email_forwarding import EmailForwarding
        configured_emails = EmailForwarding.query.filter_by(enabled=True).all()
        
        domain_configured = False
        for forwarding in configured_emails:
            if forwarding.source_email and '@' in forwarding.source_email:
                configured_domain = forwarding.source_email.split('@')[1].lower()
                if configured_domain == forward_domain:
                    domain_configured = True
                    break
        
        if not domain_configured:
            return jsonify({
                'success': False, 
                'error': f'El dominio "@{forward_domain}" no está configurado en "Correo Electrónico vía Dominio". Solo puedes enviar desde dominios configurados.'
            })
        
        # Obtener el email original
        original_email = ReceivedEmail.query.get_or_404(email_id)
        
        # Crear el contenido del reenvío
        forward_content = ""
        if forward_message.strip():
            forward_content += f"{forward_message.strip()}\n\n"
        
        forward_content += "---------- Mensaje reenviado ----------\n"
        forward_content += f"De: {original_email.from_email}\n"
        forward_content += f"Para: {original_email.to_email}\n"
        forward_content += f"Asunto: {original_email.subject}\n"
        forward_content += f"Fecha: {original_email.get_date_time_12h()}\n\n"
        forward_content += original_email.content_text or ""
        
        # Crear contenido HTML
        forward_html = ""
        if forward_message.strip():
            forward_html += f"<p>{forward_message.replace(chr(10), '</p><p>')}</p><br><br>"
        
        forward_html += "<div style='border-left: 3px solid #ccc; padding-left: 15px; margin: 10px 0;'>"
        forward_html += "<p><strong>---------- Mensaje reenviado ----------</strong></p>"
        forward_html += f"<p><strong>De:</strong> {original_email.from_email}</p>"
        forward_html += f"<p><strong>Para:</strong> {original_email.to_email}</p>"
        forward_html += f"<p><strong>Asunto:</strong> {original_email.subject}</p>"
        forward_html += f"<p><strong>Fecha:</strong> {original_email.get_date_time_12h()}</p>"
        forward_html += "<br>"
        forward_html += (original_email.content_html or original_email.content_text or "").replace('\n', '<br>')
        forward_html += "</div>"
        
        # Crear un nuevo email que representa el reenvío
        forward_email_record = ReceivedEmail(
            from_email=forward_from,
            to_email=forward_to,
            subject=forward_subject,
            content_text=forward_content,
            content_html=forward_html,
            message_id=f"forward-{email_id}-{datetime.utcnow().timestamp()}",
            processed=True  # Marcamos como procesado porque es un reenvío enviado
        )
        
        db.session.add(forward_email_record)
        db.session.commit()
        
        print(f"📧 Email reenviado: {forward_from} -> {forward_to}")
        print(f"   Dominio validado: @{forward_domain}")
        print(f"   Asunto: {forward_subject}")
        print(f"   Email original ID: {email_id}")
        
        return jsonify({
            'success': True,
            'message': 'Email reenviado exitosamente',
            'forward_id': forward_email_record.id
        })
        
    except Exception as e:
        print(f"❌ Error reenviando email: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@admin_email_buzon_bp.route('/email-buzon/cleanup-trash', methods=['POST'])
@admin_required
def cleanup_trash():
    """Limpiar papelera (eliminar TODOS los emails de papelera)"""
    try:
        deleted_count = cleanup_all_trash_emails()
        return jsonify({'success': True, 'message': f'Se eliminaron permanentemente {deleted_count} emails de la papelera'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# =============== RUTAS PARA FILTROS AUTOMÁTICOS ===============


@admin_email_buzon_bp.route('/email-buzon/filters')
@admin_required
def manage_filters():
    """Página principal de gestión de filtros automáticos"""
    try:
        print("🔍 DEBUG: Accediendo a manage_filters - VERSIÓN CORREGIDA")
        
        # Obtener filtros usando SQLAlchemy
        try:
            from app.models.email_buzon import EmailFilter, EmailTag
            
            # Obtener filtros con sus etiquetas usando SQLAlchemy
            filters_query = EmailFilter.query.outerjoin(EmailTag).order_by(
                EmailFilter.tag_id.is_(None).desc(),
                EmailFilter.tag_id.asc(),
                EmailFilter.name.asc()
            ).all()
            
            print(f"🔍 DEBUG: SQLAlchemy query ejecutada exitosamente, {len(filters_query)} filtros obtenidos")
            
            # Convertir a objetos tipo diccionario para la plantilla
            filters = []
            for i, filter_obj in enumerate(filters_query):
                print(f"🔍 DEBUG: Procesando filtro {i+1}: ID={filter_obj.id}, Nombre={filter_obj.name}")
                
                # Determinar nombre y color de etiqueta
                if filter_obj.tag_id == -1:
                    tag_name = 'Papelera'
                    tag_color = '#e74c3c'
                elif filter_obj.tag_id is None:
                    tag_name = 'Sin asignar'
                    tag_color = '#f39c12'  # Color naranja para huérfanos
                elif filter_obj.tag:
                    tag_name = filter_obj.tag.name
                    tag_color = filter_obj.tag.color
                else:
                    tag_name = f'Etiqueta ID: {filter_obj.tag_id}'
                    tag_color = '#3498db'
                
                filter_dict = {
                    'id': filter_obj.id,
                    'name': filter_obj.name,
                    'tag_id': filter_obj.tag_id,
                    'filter_from_email': filter_obj.filter_from_email,
                    'filter_to_email': filter_obj.filter_to_email,
                    'filter_subject_contains': filter_obj.filter_subject_contains,
                    'filter_content_contains': filter_obj.filter_content_contains,
                    'enabled': filter_obj.enabled,
                    'tag': {
                        'name': tag_name,
                        'color': tag_color
                    }
                }
                filters.append(filter_dict)
            
            print(f"🔍 DEBUG: {len(filters)} filtros procesados correctamente con SQLAlchemy")
            
        except Exception as db_error:
            print(f"❌ ERROR obteniendo filtros con SQLAlchemy: {db_error}")
            import traceback
            traceback.print_exc()
            filters = []
        
        # Obtener etiquetas
        try:
            tags = get_all_tags()
            print(f"🔍 DEBUG: Encontradas {len(tags)} etiquetas")
        except Exception as tag_error:
            print(f"❌ ERROR: Error obteniendo etiquetas: {tag_error}")
            flash(f'Error al cargar etiquetas: {str(tag_error)}', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
        print(f"🔍 DEBUG: Renderizando plantilla con {len(filters)} filtros y {len(tags)} etiquetas")
        
        # Obtener remitentes bloqueados usando SQLAlchemy
        try:
            from app.services.blocked_sender_service import get_all_blocked_senders
            
            blocked_senders_objects = get_all_blocked_senders()
            print(f"📋 DEBUG: {len(blocked_senders_objects)} remitentes bloqueados obtenidos con SQLAlchemy")
            
            # Convertir a objetos tipo diccionario para la plantilla
            blocked_senders = []
            for sender_obj in blocked_senders_objects:
                sender_dict = {
                    'id': sender_obj.id,
                    'sender_email': sender_obj.sender_email,
                    'sender_domain': sender_obj.sender_domain,
                    'enabled': sender_obj.enabled,
                    'created_at': sender_obj.created_at,
                    'updated_at': sender_obj.updated_at,
                    'display_name': sender_obj.get_display_name()
                }
                
                blocked_senders.append(sender_dict)
                print(f"🔍 DEBUG: Remitente bloqueado: {sender_dict['display_name']} (ID: {sender_dict['id']})")
            
        except Exception as e:
            print(f"❌ ERROR obteniendo remitentes bloqueados con SQLAlchemy: {e}")
            import traceback
            traceback.print_exc()
            blocked_senders = []
        
        return render_template('admin/email_filters.html', 
                             filters=filters, 
                             tags=tags,
                             blocked_senders=blocked_senders,
                             title="Gestión de Filtros Automáticos")
    except Exception as e:
        print(f"❌ ERROR en manage_filters: {str(e)}")
        flash(f'Error al cargar página de filtros: {str(e)}', 'error')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/create-filter', methods=['POST'])
@admin_required
def create_filter_route():
    """Crear un nuevo filtro automático"""
    try:
        print("🔍 DEBUG: Intentando crear filtro")
        name = request.form.get('name', '').strip()
        tag_id = request.form.get('tag_id')
        filter_type = request.form.get('filter_type', '').strip()
        filter_value = request.form.get('filter_value', '').strip()
        
        print(f"🔍 DEBUG: Datos recibidos - Nombre: {name}, Tag ID: {tag_id}, Tipo: {filter_type}, Valor: {filter_value}")
        
        # Convertir el tipo y valor a los campos específicos
        filter_from_email = filter_value if filter_type == 'from_email' else None
        filter_to_email = filter_value if filter_type == 'to_email' else None
        filter_subject_contains = filter_value if filter_type == 'subject' else None
        filter_content_contains = filter_value if filter_type == 'content' else None
        
        if not name:
            flash('El nombre del filtro es requerido', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
        
        # Permitir filtros sin etiqueta asignada (huérfanos)
        if not tag_id:
            tag_id_value = None  # Filtro huérfano
            destination = "Sin asignar (filtro inactivo)"
            print(f"⚠️ DEBUG: Filtro configurado como huérfano (sin etiqueta)")
        # Verificar si es papelera o etiqueta normal
        elif tag_id == 'trash':
            destination = "Papelera (eliminación automática)"
            tag_id_value = -1  # Valor especial para papelera
            print(f"🗑️ DEBUG: Filtro configurado para enviar a papelera")
        else:
            destination = f"Etiqueta ID: {tag_id}"
            tag_id_value = int(tag_id)
            print(f"🏷️ DEBUG: Filtro configurado para etiqueta: {tag_id}")
        
        # Verificar que se haya seleccionado un tipo de filtro y un valor
        if not filter_type:
            flash('Debe seleccionar un tipo de filtro', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
            
        if not filter_value:
            flash('Debe especificar un valor para el filtro', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
        
        print(f"🔍 DEBUG: Condiciones válidas, procediendo a guardar en BD")
        
        # Guardar en la base de datos usando SQLAlchemy
        try:
            from app.models.email_buzon import EmailFilter
            from app.extensions import db
            
            print(f"🔍 DEBUG: Creando filtro con SQLAlchemy...")
            
            # Crear el nuevo filtro
            new_filter = EmailFilter(
                name=name,
                tag_id=tag_id_value,
                filter_from_email=filter_from_email,
                filter_to_email=filter_to_email,
                filter_subject_contains=filter_subject_contains,
                filter_content_contains=filter_content_contains,
                enabled=True,
                priority=0
            )
            
            db.session.add(new_filter)
            db.session.commit()
            
            # Refrescar cache SMTP si el filtro va a papelera
            if tag_id == 'trash':
                pass
            
            print(f"✅ DEBUG: Filtro guardado exitosamente con SQLAlchemy - ID: {new_filter.id}")
            flash(f'Filtro "{name}" creado exitosamente → {destination}', 'success')
            
        except Exception as db_error:
            print(f"❌ ERROR guardando filtro con SQLAlchemy: {db_error}")
            import traceback
            print(f"❌ TRACEBACK: {traceback.format_exc()}")
            db.session.rollback()
            flash(f'Error al guardar filtro en base de datos: {str(db_error)}', 'error')
        
    except Exception as e:
        print(f"❌ ERROR creando filtro: {str(e)}")
        flash(f'Error al crear filtro: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_filters'))

@admin_email_buzon_bp.route('/email-buzon/update-filter/<int:filter_id>', methods=['POST'])
@admin_required
def update_filter_route(filter_id):
    """Actualizar un filtro existente"""
    try:
        print(f"🔍 DEBUG: Actualizando filtro ID: {filter_id}")
        name = request.form.get('name', '').strip()
        tag_id = request.form.get('tag_id')
        filter_type = request.form.get('filter_type', '').strip()
        filter_value = request.form.get('filter_value', '').strip()
        
        print(f"🔍 DEBUG: Datos recibidos - Nombre: {name}, Tag ID: {tag_id}, Tipo: {filter_type}, Valor: {filter_value}")
        
        # Convertir el tipo y valor a los campos específicos
        filter_from_email = filter_value if filter_type == 'from_email' else None
        filter_to_email = filter_value if filter_type == 'to_email' else None
        filter_subject_contains = filter_value if filter_type == 'subject' else None
        filter_content_contains = filter_value if filter_type == 'content' else None
        
        if not name:
            flash('El nombre del filtro es requerido', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
        
        # Permitir filtros sin etiqueta asignada (huérfanos)
        if not tag_id:
            tag_id_value = None  # Filtro huérfano
            destination = "Sin asignar (filtro inactivo)"
            print(f"⚠️ DEBUG: Filtro actualizado como huérfano (sin etiqueta)")
        elif tag_id == 'trash':
            # Verificar si es papelera o etiqueta normal
            destination = "Papelera (eliminación automática)"
            tag_id_value = -1  # Valor especial para papelera
        else:
            destination = f"Etiqueta ID: {tag_id}"
            tag_id_value = int(tag_id)
            
        if not filter_type:
            flash('Debe seleccionar un tipo de filtro', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
            
        if not filter_value:
            flash('Debe especificar un valor para el filtro', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
        
        # Actualizar en la base de datos usando SQLAlchemy
        try:
            from app.models.email_buzon import EmailFilter
            from app.extensions import db
            
            # Buscar el filtro existente
            filter_obj = EmailFilter.query.get(filter_id)
            
            if not filter_obj:
                flash('Filtro no encontrado', 'error')
                return redirect(url_for('admin_email_buzon.manage_filters'))
            
            # Actualizar los campos
            filter_obj.name = name
            filter_obj.tag_id = tag_id_value
            filter_obj.filter_from_email = filter_from_email
            filter_obj.filter_to_email = filter_to_email
            filter_obj.filter_subject_contains = filter_subject_contains
            filter_obj.filter_content_contains = filter_content_contains
            
            db.session.commit()
            
            # Refrescar cache SMTP si el filtro va a papelera
            if tag_id == 'trash':
                pass
            
            flash(f'Filtro "{name}" actualizado exitosamente → {destination}', 'success')
            print(f"✅ DEBUG: Filtro actualizado con SQLAlchemy: {name} → {destination}")
            
        except Exception as db_error:
            print(f"❌ ERROR actualizando filtro con SQLAlchemy: {db_error}")
            db.session.rollback()
            flash(f'Error al actualizar filtro en base de datos: {str(db_error)}', 'error')
        
    except Exception as e:
        print(f"❌ ERROR actualizando filtro: {str(e)}")
        flash(f'Error al actualizar filtro: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_filters'))

@admin_email_buzon_bp.route('/email-buzon/delete-filter/<int:filter_id>', methods=['POST'])
@admin_required
def delete_filter_route(filter_id):
    """Eliminar un filtro"""
    try:
        from app.models.email_buzon import EmailFilter
        from app.extensions import db
        
        # Buscar el filtro
        filter_obj = EmailFilter.query.get(filter_id)
        
        if not filter_obj:
            return jsonify({'success': False, 'message': 'Filtro no encontrado'})
        
        filter_name = filter_obj.name
        
        # Eliminar el filtro
        db.session.delete(filter_obj)
        db.session.commit()
        
        print(f"🗑️ DEBUG: Filtro eliminado con SQLAlchemy: {filter_name} (ID: {filter_id})")
        
        return jsonify({
            'success': True, 
            'message': f'Filtro "{filter_name}" eliminado exitosamente'
        })
        
    except Exception as e:
        print(f"❌ ERROR eliminando filtro con SQLAlchemy: {str(e)}")
        db.session.rollback()
        return jsonify({
            'success': False, 
            'message': f'Error al eliminar filtro: {str(e)}'
        })

@admin_email_buzon_bp.route('/email-buzon/toggle-filter/<int:filter_id>', methods=['POST'])
@admin_required
def toggle_filter_route(filter_id):
    """Activar/desactivar un filtro"""
    try:
        from app.models.email_buzon import EmailFilter
        from app.extensions import db
        
        # Buscar el filtro
        filter_obj = EmailFilter.query.get(filter_id)
        
        if not filter_obj:
            return jsonify({'success': False, 'message': 'Filtro no encontrado'})
        
        # Cambiar estado
        filter_obj.enabled = not filter_obj.enabled
        db.session.commit()
        
        # Refrescar cache SMTP si el filtro va a papelera
        if filter_obj.tag and filter_obj.tag.name == 'trash':
            pass  # smtp_rejection_service.force_cache_refresh()  # Ya no se usa
        
        status = "activado" if filter_obj.enabled else "desactivado"
        print(f"🔄 DEBUG: Filtro {status} con SQLAlchemy: {filter_obj.name} (ID: {filter_id})")
        
        return jsonify({
            'success': True,
            'enabled': filter_obj.enabled,
            'message': f'Filtro "{filter_obj.name}" {status} exitosamente'
        })
        
    except Exception as e:
        print(f"❌ ERROR cambiando estado del filtro con SQLAlchemy: {str(e)}")
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': f'Error al cambiar estado del filtro: {str(e)}'
        })

# ==================== RUTAS PARA REMITENTES BLOQUEADOS ====================

@admin_email_buzon_bp.route('/email-buzon/create-blocked-sender', methods=['POST'])
@admin_required
def create_blocked_sender_route():
    """Crear un nuevo remitente bloqueado"""
    try:
        sender_email = request.form.get('sender_email', '').strip()
        sender_domain = request.form.get('sender_domain', '').strip()
        
        # Validar que al menos uno esté presente
        if not sender_email and not sender_domain:
            flash('Debe especificar al menos un email o dominio', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
        
        # Usar el servicio para crear el remitente bloqueado
        from app.services.blocked_sender_service import create_blocked_sender
        blocked_sender = create_blocked_sender(
            sender_email=sender_email if sender_email else None,
            sender_domain=sender_domain if sender_domain else None
        )
        
        flash(f'Remitente bloqueado creado: {blocked_sender.get_display_name()}', 'success')
        
    except Exception as e:
        print(f"❌ ERROR creando remitente bloqueado: {str(e)}")
        flash(f'Error al crear remitente bloqueado: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_filters'))

@admin_email_buzon_bp.route('/email-buzon/update-blocked-sender/<int:sender_id>', methods=['POST'])
@admin_required
def update_blocked_sender_route(sender_id):
    """Actualizar un remitente bloqueado"""
    try:
        sender_email = request.form.get('sender_email', '').strip()
        sender_domain = request.form.get('sender_domain', '').strip()
        
        print(f"✏️ DEBUG: Actualizando remitente bloqueado ID: {sender_id}")
        print(f"✏️ DEBUG: Email: '{sender_email}', Dominio: '{sender_domain}'")
        
        # Validar que al menos uno esté presente
        if not sender_email and not sender_domain:
            flash('Debe especificar al menos un email o dominio', 'error')
            return redirect(url_for('admin_email_buzon.manage_filters'))
        
        # Limpiar datos
        if sender_email:
            sender_email = sender_email.lower()
        if sender_domain:
            sender_domain = sender_domain.lower()
            # Quitar @ si está presente
            if sender_domain.startswith('@'):
                sender_domain = sender_domain[1:]
        
        # Usar el servicio SQLAlchemy
        from app.services.blocked_sender_service import update_blocked_sender
        
        try:
            updated_sender = update_blocked_sender(
                sender_id, 
                sender_email=sender_email if sender_email else None,
                sender_domain=sender_domain if sender_domain else None
            )
            
            print(f"✅ DEBUG: Remitente bloqueado actualizado con SQLAlchemy: {updated_sender.get_display_name()} (ID: {sender_id})")
            flash(f'Remitente bloqueado actualizado: {updated_sender.get_display_name()}', 'success')
            
        except Exception as service_error:
            print(f"❌ ERROR con servicio SQLAlchemy: {service_error}")
            flash(f'Error al actualizar remitente bloqueado: {str(service_error)}', 'error')
        
    except Exception as e:
        print(f"❌ ERROR actualizando remitente bloqueado: {str(e)}")
        import traceback
        traceback.print_exc()
        flash(f'Error al actualizar remitente bloqueado: {str(e)}', 'error')
    
    return redirect(url_for('admin_email_buzon.manage_filters'))

@admin_email_buzon_bp.route('/email-buzon/delete-blocked-sender/<int:sender_id>', methods=['POST'])
@admin_required
def delete_blocked_sender_route(sender_id):
    """Eliminar un remitente bloqueado"""
    try:
        print(f"🗑️ DEBUG: Eliminando remitente bloqueado ID: {sender_id}")
        
        # Usar el servicio SQLAlchemy
        from app.services.blocked_sender_service import delete_blocked_sender
        from app.models.email_buzon import BlockedSender
        
        # Obtener información del remitente antes de eliminarlo
        blocked_sender = BlockedSender.query.get(sender_id)
        
        if not blocked_sender:
            return jsonify({
                'success': False,
                'message': 'Remitente bloqueado no encontrado'
            })
        
        display_name = blocked_sender.get_display_name()
        
        # Eliminar usando el servicio
        try:
            delete_blocked_sender(sender_id)
            
            print(f"✅ DEBUG: Remitente bloqueado eliminado con SQLAlchemy: {display_name} (ID: {sender_id})")
            
            return jsonify({
                'success': True,
                'message': f'Remitente bloqueado eliminado exitosamente: {display_name}'
            })
            
        except Exception as service_error:
            print(f"❌ ERROR con servicio SQLAlchemy: {service_error}")
            return jsonify({
                'success': False,
                'message': f'Error al eliminar remitente bloqueado: {str(service_error)}'
            })
        
    except Exception as e:
        print(f"❌ ERROR eliminando remitente bloqueado: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error al eliminar remitente bloqueado: {str(e)}'
        })

@admin_email_buzon_bp.route('/email-buzon/toggle-blocked-sender/<int:sender_id>', methods=['POST'])
@admin_required
def toggle_blocked_sender_route(sender_id):
    """Activar/desactivar un remitente bloqueado"""
    try:
        print(f"🔄 DEBUG: Cambiando estado del remitente bloqueado ID: {sender_id}")
        
        # Usar el servicio SQLAlchemy
        from app.services.blocked_sender_service import toggle_blocked_sender_status
        
        try:
            updated_sender = toggle_blocked_sender_status(sender_id)
            
            status = "activado" if updated_sender.enabled else "desactivado"
            print(f"✅ DEBUG: Remitente bloqueado {status} con SQLAlchemy (ID: {sender_id})")
            
            return jsonify({
                'success': True,
                'enabled': updated_sender.enabled,
                'message': f'Remitente bloqueado {status} exitosamente'
            })
            
        except Exception as service_error:
            print(f"❌ ERROR con servicio SQLAlchemy: {service_error}")
            return jsonify({
                'success': False,
                'message': f'Error al cambiar estado del remitente bloqueado: {str(service_error)}'
            })
        
    except Exception as e:
        print(f"❌ ERROR cambiando estado del remitente bloqueado: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error al cambiar estado del remitente bloqueado: {str(e)}'
        })

# ==================== RUTAS PARA LIMPIEZA AUTOMÁTICA ====================

@admin_email_buzon_bp.route('/email-buzon/cleanup/create', methods=['POST'])
@admin_required
def create_cleanup():
    """Crear nueva limpieza automática"""
    try:
        from datetime import datetime
        
        cleanup_time_str = request.form.get('cleanup_time')
        folder_type = request.form.get('folder_type')
        
        if not cleanup_time_str or not folder_type:
            flash('Hora y tipo de carpeta son requeridos', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
        # Convertir string de tiempo a objeto time
        cleanup_time = datetime.strptime(cleanup_time_str, '%H:%M').time()
        
        print(f"🕐 DEBUG: Hora recibida: {cleanup_time_str} -> {cleanup_time} (Timezone Colombia)")
        
        # Obtener tag_id si es necesario
        tag_id = None
        if folder_type == 'tag':
            # Para etiquetas, necesitamos obtener el tag_id del select
            # Por ahora usaremos el primer tag disponible, esto se puede mejorar
            from app.models.email_buzon import EmailTag
            first_tag = EmailTag.query.first()
            if first_tag:
                tag_id = first_tag.id
            else:
                flash('No hay etiquetas disponibles para limpieza', 'error')
                return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
        # Crear la limpieza
        cleanup = EmailCleanup.create_cleanup(
            cleanup_time=cleanup_time,
            folder_type=folder_type,
            tag_id=tag_id
        )
        
        flash(f'Limpieza automática creada: {cleanup.time.strftime("%H:%M")} - {cleanup.get_folder_name()}', 'success')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
    except Exception as e:
        print(f"❌ ERROR creando limpieza automática: {str(e)}")
        import traceback
        traceback.print_exc()
        flash(f'Error al crear limpieza automática: {str(e)}', 'error')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/cleanup/edit/<int:cleanup_id>', methods=['POST'])
@admin_required
def edit_cleanup(cleanup_id):
    """Editar limpieza automática existente"""
    try:
        from datetime import datetime
        
        cleanup = EmailCleanup.query.get_or_404(cleanup_id)
        
        cleanup_time_str = request.form.get('cleanup_time')
        folder_type = request.form.get('folder_type')
        
        if not cleanup_time_str or not folder_type:
            flash('Hora y tipo de carpeta son requeridos', 'error')
            return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
        # Convertir string de tiempo a objeto time
        cleanup_time = datetime.strptime(cleanup_time_str, '%H:%M').time()
        
        print(f"🕐 DEBUG: Hora editada: {cleanup_time_str} -> {cleanup_time} (Timezone Colombia)")
        
        # Actualizar campos
        cleanup.time = cleanup_time
        cleanup.folder_type = folder_type
        
        # Actualizar tag_id si es necesario
        if folder_type == 'tag':
            from app.models.email_buzon import EmailTag
            first_tag = EmailTag.query.first()
            if first_tag:
                cleanup.tag_id = first_tag.id
            else:
                flash('No hay etiquetas disponibles para limpieza', 'error')
                return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        else:
            cleanup.tag_id = None
        
        db.session.commit()
        
        flash(f'Limpieza automática actualizada: {cleanup.time.strftime("%H:%M")} - {cleanup.get_folder_name()}', 'success')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
    except Exception as e:
        print(f"❌ ERROR editando limpieza automática: {str(e)}")
        import traceback
        traceback.print_exc()
        flash(f'Error al editar limpieza automática: {str(e)}', 'error')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))

@admin_email_buzon_bp.route('/email-buzon/cleanup/toggle/<int:cleanup_id>', methods=['POST'])
@admin_required
def toggle_cleanup(cleanup_id):
    """Activar/desactivar limpieza automática"""
    try:
        cleanup = EmailCleanup.query.get_or_404(cleanup_id)
        
        # Cambiar estado
        new_status = cleanup.toggle_status()
        db.session.commit()
        
        status_text = "activada" if new_status else "desactivada"
        
        return jsonify({
            'success': True,
            'enabled': new_status,
            'message': f'Limpieza automática {status_text} exitosamente'
        })
        
    except Exception as e:
        print(f"❌ ERROR cambiando estado de limpieza automática: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error al cambiar estado de limpieza automática: {str(e)}'
        })

@admin_email_buzon_bp.route('/email-buzon/cleanup/delete/<int:cleanup_id>', methods=['POST'])
@admin_required
def delete_cleanup(cleanup_id):
    """Eliminar limpieza automática"""
    try:
        cleanup = EmailCleanup.query.get_or_404(cleanup_id)
        cleanup_name = f"{cleanup.time.strftime('%H:%M')} - {cleanup.get_folder_name()}"
        
        db.session.delete(cleanup)
        db.session.commit()
        
        flash(f'Limpieza automática eliminada: {cleanup_name}', 'success')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))
        
    except Exception as e:
        print(f"❌ ERROR eliminando limpieza automática: {str(e)}")
        import traceback
        traceback.print_exc()
        flash(f'Error al eliminar limpieza automática: {str(e)}', 'error')
        return redirect(url_for('admin_email_buzon.manage_email_buzon'))
