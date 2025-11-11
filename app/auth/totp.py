import pyotp
from app.models import User

def verify_totp_code(username, code):
    user = User.query.filter_by(username=username).first()
    if not user or not user.twofa_secret:
        return False
    totp = pyotp.TOTP(user.twofa_secret)
    return totp.verify(code)
