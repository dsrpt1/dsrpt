# DSRPT Risk Engine Dockerfile
FROM python:3.11-slim

LABEL maintainer="DSRPT Protocol"
LABEL description="DSRPT Risk Engine - Off-chain risk monitoring and oracle updates"

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Install the package
RUN pip install --no-cache-dir -e .

# Create log directory
RUN mkdir -p /var/log/dsrpt

# Create non-root user for security
RUN useradd -m -u 1000 dsrpt && \
    chown -R dsrpt:dsrpt /app /var/log/dsrpt

USER dsrpt

# Default environment variables
ENV PYTHONUNBUFFERED=1
ENV LOG_LEVEL=INFO

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import dsrpt_risk; print('healthy')" || exit 1

# Default command - run daemon
CMD ["python", "-m", "dsrpt_risk.daemon", "--config", "config.base.yaml"]
