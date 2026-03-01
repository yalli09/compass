# Docker Deployment Guide for Compass App

## Changes Made for Docker/Linux Compatibility

### 1. **Updated app.py**
   - Changed `debug=True` to environment-based mode (`FLASK_ENV=production` by default)
   - Added `allow_unsafe_werkzeug=True` for eventlet compatibility
   - The app now listens on `0.0.0.0:5000` which works in Docker containers

### 2. **Updated requirements.txt**
   - Pinned specific versions for consistency across environments
   - Added `python-socketio` and `python-engineio` for better websocket support

### 3. **Created Dockerfile**
   - Uses Python 3.11 slim image (lightweight)
   - Sets up the app in `/app` directory inside the container
   - Installs dependencies without cache to keep image small
   - Exposes port 5000

### 4. **Created docker-compose.yml**
   - Easy one-command deployment
   - Creates a `data` volume for persistent storage (`points.json`)
   - Auto-restarts the container on failure
   - Sets production environment

### 5. **Created .dockerignore**
   - Prevents unnecessary files from being copied into the image

---

## How to Upload & Run on Your Linux Server

### Option 1: Using Git (Recommended)

#### Step 1: Push to GitHub/GitLab
```bash
cd /Users/yallialon/Desktop/compass
git init
git add .
git commit -m "Add Docker support"
git remote add origin <your-repo-url>
git push -u origin main
```

#### Step 2: On Your Linux Server
```bash
# SSH into your server
ssh user@your-server-ip

# Clone your repository
git clone <your-repo-url>
cd compass

# Run with Docker Compose
docker-compose up -d
```

---

### Option 2: Using SCP (Without Git)

#### Step 1: Copy Files from Mac
```bash
# From your Mac terminal
scp -r /Users/yallialon/Desktop/compass user@your-server-ip:/home/user/compass
```

#### Step 2: On Your Linux Server
```bash
# SSH into your server
ssh user@your-server-ip

# Navigate to the app directory
cd /home/user/compass

# Run with Docker Compose
docker-compose up -d
```

---

### Option 3: Manual File Transfer (SFTP)
```bash
# Connect via SFTP
sftp user@your-server-ip

# Upload the entire folder
put -r /Users/yallialon/Desktop/compass /home/user/

# Then SSH and run
ssh user@your-server-ip
cd /home/user/compass
docker-compose up -d
```

---

## Docker Commands (On Your Linux Server)

### Start the app
```bash
docker-compose up -d
```

### Check if it's running
```bash
docker-compose ps
```

### View logs
```bash
docker-compose logs -f
```

### Stop the app
```bash
docker-compose down
```

### Rebuild if you make changes
```bash
docker-compose up -d --build
```

---

## Access Your App

After running `docker-compose up -d`:

- **Local access on server**: `http://localhost:5000`
- **From other devices on your network**: `http://your-server-ip:5000`
- **If behind a domain/reverse proxy**: `https://yourdomain.com`

---

## Persistent Data

Your `points.json` file is stored in a Docker volume at:
```
./data/points.json
```

This means your data persists even if you stop/restart the container.

---

## Prerequisites on Linux Server

Make sure your server has:

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version
```

---

## Troubleshooting

### Port 5000 already in use
```bash
# Use a different port in docker-compose.yml
# Change: "5000:5000" to "8000:5000"
docker-compose up -d
```

### Permission denied errors
```bash
# Add your user to the docker group
sudo usermod -aG docker $USER
newgrp docker
```

### Check for errors
```bash
docker-compose logs compass-app
```

---

## Production Notes

- The app runs in **production mode** by default (no debug)
- All changes to the app require: `docker-compose up -d --build`
- For SSL/HTTPS, use a reverse proxy like **Nginx** in front of Docker
- Socket.IO is configured for real-time updates across devices

