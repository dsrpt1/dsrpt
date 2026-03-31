FROM python:3.11-slim

WORKDIR /app

# Cache bust: 2026-03-31
ARG CACHEBUST=2

# Install Python deps (web3 + psycopg2 for chain relay and database)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy everything (build context = dsrpt-phase1/)
COPY . /app/

# runner.py is the entrypoint — polls every 15 min, relays on transitions
CMD ["python", "-m", "terminal.runner"]
