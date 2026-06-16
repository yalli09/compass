FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy application files (copy entire project to avoid missing files)
# `.dockerignore` controls what is excluded from the build context.
COPY . .

# Expose port
EXPOSE 5030

# Run the application
CMD ["python", "app.py"]
