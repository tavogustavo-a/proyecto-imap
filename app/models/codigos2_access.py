# app/models/codigos2_access.py

from app.extensions import db
from sqlalchemy import select, insert, delete

# Tabla de asociación para usuarios con acceso a Códigos 2
codigos2_users = db.Table('codigos2_users',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column('granted_at', db.DateTime, default=db.func.current_timestamp())
)

class Codigos2Access:
    """
    Clase helper para gestionar accesos a Códigos 2.
    No es un modelo real, solo usa la tabla de asociación codigos2_users.
    """
    
    @staticmethod
    def user_has_access(user):
        """Verifica si un usuario tiene acceso a Códigos 2."""
        if not user:
            return False
        from flask import current_app
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        # El admin siempre tiene acceso
        if user.username == admin_username:
            return True
        # Verificar si el usuario está en la tabla de accesos
        result = db.session.execute(
            select(codigos2_users.c.user_id).where(codigos2_users.c.user_id == user.id)
        ).first()
        return result is not None
    
    @staticmethod
    def get_users_with_access():
        """Obtiene todos los usuarios que tienen acceso a Códigos 2."""
        from app.models.user import User
        return db.session.query(User).join(codigos2_users).all()
    
    @staticmethod
    def grant_access(user):
        """Otorga acceso a Códigos 2 a un usuario."""
        if not user:
            return False
        from flask import current_app
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        # No agregar al admin a la tabla, ya tiene acceso por defecto
        if user.username == admin_username:
            return True
        # Verificar si ya tiene acceso
        if Codigos2Access.user_has_access(user):
            return True
        # Insertar en la tabla
        db.session.execute(
            insert(codigos2_users).values(user_id=user.id)
        )
        db.session.commit()
        return True
    
    @staticmethod
    def revoke_access(user):
        """Revoca el acceso a Códigos 2 de un usuario."""
        if not user:
            return False
        from flask import current_app
        admin_username = current_app.config.get("ADMIN_USER", "admin")
        # No remover al admin
        if user.username == admin_username:
            return False
        # Eliminar de la tabla
        db.session.execute(
            delete(codigos2_users).where(codigos2_users.c.user_id == user.id)
        )
        db.session.commit()
        return True

