FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps for psycopg / pandas wheels are already bundled; keep image lean.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data dir for uploaded letters / CPM files.
RUN mkdir -p /data/uploads

RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

# The entrypoint applies Alembic migrations, then starts uvicorn. It fails the
# container rather than serving against a half-migrated database.
ENTRYPOINT ["/app/entrypoint.sh"]
