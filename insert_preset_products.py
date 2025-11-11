from app import create_app
from app.extensions import db
from app.store.models import Product

PRESET_PRODUCTS = [
    # (id, image, name, price_cop, price_usd)
    (1,  'stream1.png',  'Netflix 1 Pantalla',      8000, 2.5),
    (2,  'stream1.png',  'Netflix 2 Pantallas',     16000, 4),
    (3,  'stream1.png',  'Netflix 4 Pantallas',     29000, 8),
    (4,  'stream16.png', 'Crunchyroll',             4000, 1.2),
    (5,  'stream15.png', 'Vix+',                    4000, 1.2),
    (6,  'stream20.png', 'Deezer',                  4000, 1.2),
    (7,  'stream10.png', 'Canva',                   5000, 1.5),
    (8,  'stream13.png', 'Max',                     5000, 1.5),
    (9,  'stream17.png', 'Disney Standard',         5000, 1.5),
    (10, 'stream17.png', 'Disney Premium',         16000, 4),
    (11, 'stream14.png', 'Paramount',               8000, 2.5),
    (12, 'stream11.png', 'Amazon Prime',            9000, 2.5),
    (13, 'stream12.png', 'Spotify',                 5000, 1.5),
    (14, 'stream2.png',  'Apple TV',                5000, 1.5),
    (15, 'stream9.png',  'ViKi Rakuten',            5000, 1.5),
    (16, 'stream3.png',  'Youtube Premium',         5000, 1),
    (17, 'stream22.png', 'Mubi',                    1500, 0.42),
    (18, 'stream7.png',  'Plex',                    5000, 1),
    (19, 'stream8.png',  'iptv',                    5000, 1),
    (20, 'stream23.png', 'Office 365',              5000, 1),
    (21, 'stream24.png', 'Game Pass Ultimate',      5000, 1),
    (22, 'stream25.png', 'Win Sport',               5000, 1),
    (23, 'stream26.png', 'Hulu',                    5000, 1),
    (24, 'stream27.png', 'Directv Go',              5000, 1),
    (25, 'stream28.png', 'Universal',               5000, 1),
    (26, 'stream29.png', 'Pornhub',                 5000, 1),
]

def main():
    app = create_app()
    with app.app_context():
        for prod in PRESET_PRODUCTS:
            prod_id, image, name, price_cop, price_usd = prod
            # Eliminar si existe un producto con ese ID
            existing = Product.query.get(prod_id)
            if existing:
                db.session.delete(existing)
                db.session.commit()
            # Insertar solo si no existe uno con ese nombre
            if not Product.query.filter_by(name=name).first():
                p = Product(id=prod_id, name=name, price_cop=price_cop, price_usd=price_usd, image_filename=image, enabled=True, is_preset=True)
                db.session.add(p)
        db.session.commit()
        print('Productos predefinidos insertados correctamente.')

if __name__ == '__main__':
    main() 