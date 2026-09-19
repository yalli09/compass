<div align="center">

# <img src="static/favicon.ico" width="36" height="36" alt="Compass Icon" style="vertical-align: -6px;" /> Compass

**A real-time, interactive trip planning platform featuring a light glassmorphism interface, smart algorithmic itinerary routing, and multi-device synchronization.**

[![build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![Python](https://img.shields.io/badge/Python-3.x-blue.svg)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-blue)](https://www.docker.com/)

[Quick Start](#-quick-start-demonstrated-on-macos) • [Docker Setup](#-docker-installation-for-linux) • [Features](#-features) • [Screenshots](#-screenshots)

</div>

---

## 📌 Executive Summary

**Compass** is a high-performance web application designed for interactive visual map planning and real-time collaboration. Built with a modern glassmorphism interface and integrated with Leaflet maps, Compass allows users to manage multiple travel projects, organize custom point categories, and automate day-by-day itineraries using the **ATOSS Engine**. Powered by Socket.IO, updates sync seamlessly across all connected devices and browsers, making it an ideal choice for both personal trip planning and real-time multi-user collaboration.

---

## 📋 Table of Contents

- [Screenshots](#-screenshots)
- [Features](#-features)
  - [🗺️ Map \& Visualization](#️-map--visualization)
  - [📁 Multi-Project \& Workspace Management](#-multi-project--workspace-management)
  - [📍 Point Management \& Editing](#-point-management--editing)
  - [🤖 Smart Trip Organizer (ATOSS)(alpha version)](#-smart-trip-organizer-atossalpha-version)
  - [📅 Trip Planning \& Itinerary](#-trip-planning--itinerary)
  - [🔄 Sync, PWA, \& Data Portability](#-sync-pwa--data-portability)
- [Quick Start](#-quick-start-demonstrated-on-macos)
- [Docker Installation](#-docker-installation-for-linux)
- [Debugging Docker](#-debugging-the-docker-app-if-needed)
- [Delete the App](#-delete-the-app)

---

## 📸 Screenshots

<p align="center">
  <img src="https://github.com/user-attachments/assets/26989c14-cd8c-4ffd-bdab-5553976bb0af" width="100%" alt="Compass Screenshot 1" />
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/adb081d0-e4b9-4e3e-940f-523e029ec644" width="100%" alt="Compass Screenshot 2" />
</p>

---

## ✨ Features

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
- **Right-Click / Long-Press Shortcuts:**
  - Right-click anywhere on the map to open a modal and quickly drop a new point.
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
- **Planning System Choice:** Choose Calendar dates or Legacy trip days from Settings at any time. Switching only changes the active planning view; it does not rewrite or delete either data set.
- **Calendar:** Plan all-day or timed events in a month view with a selected-day agenda.
- **Linked Events:** Calendar events can reference an existing map point and/or task without duplicating either record.
- **Date-Based Itinerary:** Calendar-linked visits, travel blocks, tasks, breaks, and custom activities are the source of truth for daily trip planning.
- **Morning-to-Evening Planning:** Configure trip start date, day start/end, and default visit length. Preview a point order before committing it to the calendar.
- **Reversible Mode Conversion:** Switching to Calendar uses the trip start date to convert Day 1/Day 2 assignments. Switching back finds the earliest calendar date as Day 1 and counts forward.
- **Calendar Widget:** Filter map points by their real calendar date.
- **Customizable Planning Settings:** Configure the daily time window and default visit duration from the settings menu.
- **Built-in Task List:** Plan your trip items alongside your map data.

> [!NOTE]
> Calendar events are stored in `json/<trip>-calendar.json`. Dates and times are kept as explicit strings (`YYYY-MM-DD` and `HH:MM`) so date-only events do not shift with the browser timezone. Legacy numeric `day` values remain preserved for compatibility and are never converted without a user-provided trip start date. Recurrence, reminders, drag-and-drop scheduling, and external calendar synchronization are not included yet.

### 🔄 Sync, PWA, & Data Portability
- **Real-Time Synchronization:** Powered by Socket.IO—watch your updates propagate instantly across all connected screens.
- **Progressive Web App (PWA):** Save the app to your home screen on iOS and Android for a native, full-screen mobile app experience.
- **Persistent Local Storage:** All map items and tasks are backed up securely on the server via JSON.
- **Import / Export Engine:** Seamlessly backup, share, or upload your data. Supports importing tasks and points via JSON file upload or direct copy-pasting.

---

## 🚀 Quick Start (demonstrated on macos)

1. **Create and activate a virtual environment (optional but recommended):**
  ```bash
   python3 -m venv .venv
   source .venv/bin/activate
```

2. **Install dependencies:**
```bash
pip install -r requirements.txt
```


3. **Run the app:**
```bash
python app.py
```


4. **Access the Application:**
Open `http://localhost:5030` on multiple devices on the same network (or use your machine's LAN IP) and watch changes propagate automatically.

> [!WARNING]
> This is a development server (Flask + eventlet). For production, use proper deployment and secure the socket endpoint.
> To allow external devices on the same LAN, access the machine's local IP (e.g., `http://192.168.1.10:5030`).

---

## 🐳 Docker Installation for Linux

1. **Clone the repository:**
```bash
git clone https://github.com/yalli09/compass.git
cd compass
```


2. **Build and start the application:**
```bash
docker-compose up -d
```


3. **Verify the container is running:**
```bash
docker-compose ps
```



---

## 🔍 Debugging the Docker App (if needed)

* **View real-time application logs:**
```bash
docker-compose logs -f
```


* **Stop the application:**
```bash
docker-compose down
```


* **Rebuild containers after making changes:**
```bash
docker-compose up -d --build
```



---

## 🗑️ Delete the App

* **Stop and remove the container:**
```bash
docker stop compass-app
docker rm compass-app
```


* **Delete the Docker image:**
```bash
docker rmi compass_compass
```