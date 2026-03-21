# Compass Map

Light glass themed map with real-time syncing and point management.

Features:
- Leaflet map with custom blue-blur markers
- Add/remove points from the sidebar
- Real-time synchronization across devices using Socket.IO
- Persistent storage on the server using json
- Import / export using JSON
 - Right-click on the map to add a new point at that location
 - Right-click on an existing marker to rename or delete it
 - Click a marker to view its name and coordinates
 - Filter points by day using the calendar widget
 - Customize how many days appear in the calendar (settings)
 - Assign each point to a "day" category and filter by it
 - Edit or delete points via a modal popup (click list item or right-click marker)
 - Right-click map to open modal and add new points at that location
- Built in task list for easier trip planning 
- Support an app experience when bookmarking it on the home screen across various devices for Progressive Web Apps (PWA)
Quick start (macOS):

## screenshots

<img src="https://i.imgur.com/za9GpxV.jpeg"/>
<img src="https://i.imgur.com/YUjFz8L.jpeg"/>

## quick start using(demonstrated on macos)
1. Create and activate a virtual environment (optional but recommended):

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run the app:

```bash
python app.py
```

4. Open http://localhost:5030 on multiple devices on the same network (or use your machine's LAN IP) and watch changes propagate automatically.

Notes:
- This is a development server (Flask + eventlet). For production, use proper deployment and secure the socket endpoint.
- To allow external devices on the same LAN, access the machine's local IP (e.g., `http://192.168.1.10:5030`).

## docker installation for linux

1. open a folder and download compass
```bash
git clone https://github.com/yalli09/compass.git
cd compass
```
2.build up the app

```bash
docker-compose up -d
```
3.check if it running
```bash
docker-compose ps
```
## debuging the docker app (if needed)
### view the logs if you have an error 
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

## delete the app
### remove the app
```bash
docker stop compass-app
docker rm compass-app
```
### delete the image
```bash
docker rmi compass_compass
```
