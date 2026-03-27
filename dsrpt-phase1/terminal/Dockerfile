FROM python:3.11-slim

WORKDIR /app

# Copy the entire dsrpt-phase1 tree (runner imports from src/)
COPY . /app/dsrpt-phase1/

# Install Python deps
COPY terminal/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app/dsrpt-phase1

# runner.py is the entrypoint — polls every 15 min, relays on transitions
CMD ["python", "-m", "terminal.runner"]
