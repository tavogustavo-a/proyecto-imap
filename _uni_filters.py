import sqlite3
c = sqlite3.connect(r"d:\proyectos\1. proyecto imap\instance\dev.db")
c.row_factory = sqlite3.Row
for r in c.execute(
    "SELECT id, description, sender, keyword, cut_before_html, cut_after_html, enabled FROM filters WHERE lower(sender) LIKE '%universal%' OR lower(description) LIKE '%universal%' OR lower(keyword) LIKE '%universal%' OR lower(keyword) LIKE '%on demand%'"
).fetchall():
    print(dict(r))
