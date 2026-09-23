# ==========================================================
# Production Dockerfile for emato® TILES Order Manager
# Supports Render, Railway, Fly.io, or any Cloud VPS
# ==========================================================
FROM ruby:3.2-slim

# Install system dependencies (build tools for sqlite3 gem)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      build-essential \
      libsqlite3-dev \
      sqlite3 \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy Gemfile and lockfile
COPY Gemfile Gemfile.lock ./

# Install Ruby gems
RUN bundle config set --local without 'development test' && \
    bundle install --jobs 4 --retry 3

# Copy application code
COPY . .

# Ensure bin scripts are executable
RUN chmod +x bin/setup_db.rb start.sh

# Create persistent data directory
RUN mkdir -p /data

# Default environment variables
ENV PORT=10000 \
    DATABASE_PATH=/data/eod.db \
    RACK_ENV=production

# Expose port
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:10000/healthz || exit 1

# Initialize DB and start server
CMD ["bundle", "exec", "ruby", "server.rb"]
