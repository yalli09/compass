# Compass

Light glass themed map with real-time syncing and point management.

## Features

### 🗺️ Map & Visualization
- **Glassmorphism UI:** Clean, modern light glass-themed interface optimized for desktop and mobile.
- **Leaflet Integration:** Custom blue-blur markers with smooth map interactions.
- **English Map Tiles:** Uses clean, readable Carto English maps by default.
- **Smart Zoom:** Automatically fits and zooms to show all existing points when the map loads.
- **Color-Coded Categories:** Colorize your markers and points to easily distinguish different types of locations or days.
- **Responsive Layout:** Includes full support for horizontal/landscape mode on mobile devices.

### 📁 Multi-Project & Workspace Management
- **Multiple Project Support:** Seamlessly create, manage, and toggle between completely separate trips  (e.g., USA, japan...) within a single dashboard.
- **Independent Contexts:** Each project maintains its own isolated set of points, custom categories, map layers and task lists.

### 📍 Point Management & Editing
- **Right-Click / Long-Press Shortcuts:** - Right-click anywhere on the map to open a modal and quickly drop a new point.
  - Right-click an existing marker to instantly rename, edit, or delete it.
- **Left-Click View:** Left-click a marker to smoothly display its name, coordinates, attached media, and custom descriptions.
- **Rich Point Details:** Attach full descriptions, external link addresses, linked names, and custom photos directly to your locations.
- **Automated Image Fetching:** Built-in automatic image search integration via ddgs Images (`clens`). *(Note: Not enabled by default; toggle it on via `Plan > Settings`)*.
- **Search & Filter:** Instantly track down specific markers using a high-performance dedicated search filter for points.
- **Multi-Trip Support:** Effortlessly organize, save, and switch between separate lists of trips within the same application dashboard.
- **Fully Customizable Categories:** Create, edit, or delete custom categories tailored precisely to your journey (e.g., Food 🍔, Hotels 🏨, Sightseeing 📸, Transit 🚆).
- **Customizable Color Palette:** Assign personalized colors directly to each custom category to dynamically update map marker styles. *(Configurable under `Plan > Settings`)*.

### 🤖 Smart Trip Organizer (ATOSS)(alpha version)
- **Automated Trip Optimization (ATOSS Engine):** Intelligent algorithmic routing and scheduling that automatically clusters locations by proximity, optimal travel times, and category priority.
- **Smart Itinerary Drafting:** Generates an optimized day-by-day baseline schedule based on your pinned locations, opening hours, and preferred pace.
- **Intelligent Gaps & Overlap Detection:** Automatically flags unrealistic travel times or overlapping schedules and suggests smart buffers or alternative time slots.
### 📅 Trip Planning & Itinerary
- **Calendar Widget:** Filter points by specific days.
- **Customizable Intervals:** Adjust how many days appear in your calendar via the settings menu.
- **Built-in Task List:** Plan your trip items alongside your map data.

### 🔄 Sync, PWA, & Data Portability
- **Real-Time Synchronization:** Powered by Socket.IO—watch your updates propagate instantly across all connected screens.
- **Progressive Web App (PWA):** Save the app to your home screen on iOS and Android for a native, full-screen mobile app experience.
- **Persistent Local Storage:** All map items and tasks are backed up securely on the server via JSON.
- **Import / Export Engine:** Seamlessly backup, share, or upload your data. Supports importing tasks and points via JSON file upload or direct copy-pasting.

## screenshots

<img src="https://github.com/user-attachments/assets/26989c14-cd8c-4ffd-bdab-5553976bb0af"/>
<img src="https://github.com/user-attachments/assets/adb081d0-e4b9-4e3e-940f-523e029ec644"/>

## quick start(demonstrated on macos)
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
