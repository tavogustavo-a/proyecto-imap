from wtforms import Form, StringField, PasswordField
from wtforms.validators import DataRequired, Length

class LoginForm(Form):
    username = StringField(
        "Usuario",
        validators=[DataRequired(message="Ingresa tu usuario.")]
    )
    password = PasswordField(
        "Contraseña",
        validators=[
            DataRequired(message="Ingresa tu contraseña."),
            Length(min=4, message="La contraseña debe tener al menos 4 caracteres.")
        ]
    )

class ForgotPasswordForm(Form):
    user_input = StringField(
        "Usuario o Correo",
        validators=[DataRequired(message="Por favor ingresa tu usuario o correo.")]
    )
