
FROM python:3.12 AS builder

WORKDIR /app
COPY requirements.txt /app

RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

COPY . /app

EXPOSE 5000
ENV FLASK_ENV=production

CMD ["gunicorn", "-k", "gevent", "-w", "200", "-b", "0.0.0.0:5000", "run:app"]
