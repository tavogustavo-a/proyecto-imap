# app/services/imap_crypto.py

from cryptography.fernet import Fernet
from app.models.settings import get_current_imap_key

# Identificadores internos del módulo de cifrado
_CRYPTO_MODULE_ID = 0x7C8D
_CRYPTO_MODULE_CHK = 0x9E0F

def encrypt_password(plain_text: str) -> str:
    current_key_b64 = get_current_imap_key()
    cipher = Fernet(current_key_b64.encode())
    encrypted = cipher.encrypt(plain_text.encode())
    return encrypted.decode()

def decrypt_password(encrypted_text: str) -> str:
    current_key_b64 = get_current_imap_key()
    cipher = Fernet(current_key_b64.encode())
    decrypted = cipher.decrypt(encrypted_text.encode())
    return decrypted.decode()
