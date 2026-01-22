# app/services/imap_crypto.py

from cryptography.fernet import Fernet, InvalidToken
from app.models.settings import get_current_imap_key, get_next_imap_key, AppSecrets
from flask import current_app

# Identificadores internos del módulo de cifrado
_CRYPTO_MODULE_ID = 0x7C8D
_CRYPTO_MODULE_CHK = 0x9E0F

def encrypt_password(plain_text: str) -> str:
    """Encripta una contraseña usando la clave IMAP actual."""
    current_key_b64 = get_current_imap_key()
    cipher = Fernet(current_key_b64.encode())
    encrypted = cipher.encrypt(plain_text.encode())
    return encrypted.decode()

def decrypt_password(encrypted_text: str) -> str:
    """Descifra una contraseña usando la clave IMAP actual.
    Si falla, intenta con la clave siguiente (NEXT_IMAP_KEY) para manejar transiciones."""
    current_key_b64 = get_current_imap_key()
    
    # Intentar con la clave actual primero
    try:
        cipher = Fernet(current_key_b64.encode())
        decrypted = cipher.decrypt(encrypted_text.encode())
        return decrypted.decode()
    except InvalidToken:
        # Si falla, intentar con la clave siguiente (útil durante rotaciones)
        next_key_b64 = get_next_imap_key()
        if next_key_b64:
            try:
                cipher = Fernet(next_key_b64.encode())
                decrypted = cipher.decrypt(encrypted_text.encode())
                return decrypted.decode()
            except InvalidToken:
                pass
        
        # Si ambas fallan, relanzar la excepción original
        raise

def decrypt_password_with_key(encrypted_text: str, key_b64: str) -> str:
    """Descifra una contraseña usando una clave específica."""
    cipher = Fernet(key_b64.encode())
    decrypted = cipher.decrypt(encrypted_text.encode())
    return decrypted.decode()

def encrypt_password_with_key(plain_text: str, key_b64: str) -> str:
    """Encripta una contraseña usando una clave específica."""
    cipher = Fernet(key_b64.encode())
    encrypted = cipher.encrypt(plain_text.encode())
    return encrypted.decode()
