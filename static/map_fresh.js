// Compass Map Application - Complete Polish Edition
// Real-time sync via Socket.IO, address-based geocoding, no lat/lng UI clutter

let map;
let markers = [];
let points = [];
let filteredPoints = [];
let tasks = [];

let maxDays = localStorage.getItem('maxDays') ? parseInt(localStorage.getItem('maxDays')) : 7;
let selectedOffset = null; // null = show all
let socket = null;
let currentEditing = null;
let editingPointOriginal = null; // store original coords when editing
let searchQuery = ''; // search filter query
let currentOpenMenu = null; // track which menu is currently open
let currentTab = 'mapPoints'; // track current tab

// ============ MAP INIT ============
function initMap() {
    map = L.map('map', { 
        zoomControl: false, 
        maxBounds: [[-90, -180], [90, 180]],
        maxBoundsViscosity: 1.0
    }).setView([37.7749, -122.4194], 13);
          
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        noWrap: true 
    }).addTo(map);

    if (window.io) {
        socket = io();
        socket.on('points_updated', (data) => {
            points = (data || []).map(convertPoint);
            applyFilter();
        });
        socket.on('tasks_updated', (data) => {
            tasks = data || [];
            updateTasksList();
        });
        socket.on('settings_updated', (s) => {
            if (s && typeof s.maxDays === 'number') {
                maxDays = s.maxDays;
                localStorage.setItem('maxDays', maxDays);
                renderCalendar();
                applyFilter();
            }
        });
    }

    fetch('/api/points').then(r => r.json()).then(data => {
        points = (data || []).map(convertPoint);
        applyFilter();
        // Smart map initialization: fit all points in view if they exist
        fitMapToBounds();
    }).catch(err => console.error('Failed to load points', err));

    // load global settings from server
    fetch('/api/settings').then(r => r.json()).then(s => {
        if (s && typeof s.maxDays === 'number') {
            maxDays = s.maxDays;
            localStorage.setItem('maxDays', maxDays);
            renderCalendar();
        }
    }).catch(err => console.error('Failed to load settings', err));

    // load tasks from server
    fetch('/api/tasks').then(r => r.json()).then(data => {
        tasks = data || [];
        updateTasksList();
    }).catch(err => console.error('Failed to load tasks', err));

    map.on('contextmenu', onMapContextMenu);
}

// ============ HELPERS ============
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function convertPoint(p) {
    const newp = Object.assign({}, p);
    if (newp.created) newp.createdMs = newp.created * 1000;
    else newp.createdMs = Date.now();
    return newp;
}

// ============ GEOCODING ============
async function geocodeAddress(query) {
    if (!query.trim()) return null;
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            { headers: { 'User-Agent': 'Compass-App' } }
        );
        if (!response.ok) throw new Error('Geocoding failed');
        const results = await response.json();
        if (results.length === 0) return null;
        const first = results[0];
        return {
            lat: parseFloat(first.lat),
            lng: parseFloat(first.lon),
            address: first.display_name
        };
    } catch (err) {
        console.error('Geocoding error:', err);
        return null;
    }
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { 'User-Agent': 'Compass-App' } });
        if (!res.ok) return null;
        const data = await res.json();
        return data.display_name || null;
    } catch (err) {
        console.error('Reverse geocode error', err);
        return null;
    }
}

// ============ RENDERING ============
function createCustomMarker() {
    const markerDiv = document.createElement('div');
    markerDiv.className = 'map-marker';
    return L.divIcon({
        html: markerDiv.outerHTML,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });
}

function clearMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
}

function renderPoints(list) {
    clearMarkers();
    list.forEach(point => {
        const photoHtml = point.photo ? `<div style="margin-top:8px;"><img src="${point.photo}" alt="photo" style="max-width:180px;max-height:120px;border-radius:6px;object-fit:cover;" onerror="this.style.display='none'"></div>` : '';
        const descHtml = point.description ? `<div style="margin-top:8px;font-size:0.9rem;color:var(--text-2);max-width:200px;line-height:1.4;">${escapeHtml(point.description)}</div>` : '';
        const dayHtml = (point.day === null || point.day === undefined) ? 'Unscheduled' : `Day ${point.day}`;
        const popupHtml = `<div style="min-width:200px;"><b style="font-size:1.1rem;">${escapeHtml(point.name)}</b><div style="font-size:0.85rem;color:var(--text-3);margin-top:4px;">${dayHtml}</div>${descHtml}${photoHtml}</div>`;
        const marker = L.marker([point.lat, point.lng], { icon: createCustomMarker() })
            .bindPopup(popupHtml)
            .addTo(map);
        marker.pointId = point.id;
        marker.on('contextmenu', onMarkerContextMenu);
        markers.push(marker);
    });
}

function updatePointsList() {
    const pointsList = document.getElementById('pointsList');
    const pointCount = document.getElementById('pointCount');
    pointsList.innerHTML = '';
    pointCount.textContent = filteredPoints.length;
    filteredPoints.forEach(point => {
        const li = document.createElement('li');
        const info = document.createElement('div');
        info.className = 'point-info';
        const dayText = (point.day === null || point.day === undefined) ? 'Unscheduled' : `Day ${point.day}`;
        const desc = point.description ? `<div class="point-desc" style="font-size:0.85rem;color:var(--text-2);margin-top:4px;">${escapeHtml(point.description.substring(0, 50))}</div>` : '';
        const thumb = point.photo ? `<img src="${point.photo}" alt="photo" style="width:48px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.style.display='none'">` : '';
        info.innerHTML = `<div style="display:flex;align-items:flex-start;gap:10px;flex:1"><div>${thumb}</div><div style="flex:1"><div class="point-name" style="font-weight:500;">${escapeHtml(point.name)}</div><div class="point-day" style="font-size:0.85rem;color:var(--text-3);">${dayText}</div>${desc}</div></div>`;
        const btn = document.createElement('button');
        btn.className = 'remove-btn';
        btn.textContent = '×';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removePoint(point.id);
        });
        li.appendChild(info);
        li.appendChild(btn);
        li.style.cursor = 'pointer';
        
        // Left click: center map on point and show popup
        li.addEventListener('click', (e) => {
            e.stopPropagation();
            // Center map on the point
            if (map) {
                map.setView([point.lat, point.lng], 16);
            }
            // Find and show the marker popup
            const marker = markers.find(m => m.pointId === point.id);
            if (marker) {
                marker.openPopup();
            }
        });
        
        // Right click: open edit modal
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showEditModal(point);
        });
        
        pointsList.appendChild(li);
    });
}

function renderCalendar() {
    const container = document.getElementById('calendarDays');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 1; i <= maxDays; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        dayDiv.textContent = i;
        if (points.some(p => p.day === i)) dayDiv.classList.add('has-points');
        if (i === selectedOffset) dayDiv.classList.add('selected');
        dayDiv.addEventListener('click', () => {
            selectedOffset = (selectedOffset === i ? null : i);
            applyFilter();
        });
        container.appendChild(dayDiv);
    }
}

function applyFilter() {
    let filtered = (selectedOffset === null || selectedOffset <= 0) ? points.slice() : points.filter(p => p.day === selectedOffset);
    
    // Apply search filter
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(p => {
            const name = (p.name || '').toLowerCase();
            const description = (p.description || '').toLowerCase();
            const streetAddress = (p.address || '').toLowerCase();
            const id = (p.id || '').toString().toLowerCase();
            return name.includes(query) || description.includes(query) || streetAddress.includes(query) || id.includes(query);
        });
    }
    
    filteredPoints = filtered;
    renderPoints(filteredPoints);
    updatePointsList();
    renderCalendar();
}

// ============ MODAL LOGIC ============
function openModal(title) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('pointModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('pointModal').classList.add('hidden');
    currentEditing = null;
}

function showAddModal() {
    openModal('Add Point');
    document.getElementById('modalName').value = '';
    document.getElementById('modalAddress').value = '';
    document.getElementById('modalDay').value = '';
    document.getElementById('modalDescription').value = '';
    document.getElementById('modalPhoto').value = '';
    document.getElementById('modalDelete').style.display = 'none';
    currentEditing = null;
}

function showEditModal(point) {
    openModal('Edit Point');
    currentEditing = point.id;
    editingPointOriginal = { lat: point.lat, lng: point.lng }; // store originals
    document.getElementById('modalName').value = point.name || '';
    document.getElementById('modalAddress').value = '';
    document.getElementById('modalDay').value = point.day || '';
    document.getElementById('modalDescription').value = point.description || '';
    document.getElementById('modalPhoto').value = point.photo || '';
    document.getElementById('modalDelete').style.display = 'inline-block';
    reverseGeocode(point.lat, point.lng).then(addr => {
        if (addr) document.getElementById('modalAddress').value = addr;
    });
}

// ============ POINT OPERATIONS ============
async function addPointFromForm() {
    const name = document.getElementById('pointName').value.trim();
    const address = document.getElementById('pointAddress').value.trim();
    const dayVal = document.getElementById('pointDay').value.trim();
    const description = document.getElementById('pointDescription').value.trim();
    const photo = document.getElementById('pointPhoto').value.trim();

    if (!name || !address) {
        alert('Please enter a point name and address');
        return;
    }

    const addBtn = document.getElementById('addPointBtn');
    addBtn.disabled = true;
    addBtn.textContent = 'Geocoding...';

    try {
        const geocoded = await geocodeAddress(address);
        if (!geocoded) {
            alert('Could not find address. Please try a different one.');
            return;
        }

        const day = dayVal ? parseInt(dayVal, 10) : null;
        const payload = {
            name,
            lat: geocoded.lat,
            lng: geocoded.lng,
            day,
            description,
            photo
        };

        const res = await fetch('/api/points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to add point');

        document.getElementById('pointName').value = '';
        document.getElementById('pointAddress').value = '';
        document.getElementById('pointDay').value = '';
        document.getElementById('pointDescription').value = '';
        document.getElementById('pointPhoto').value = '';
        alert('Point added!');
    } catch (err) {
        console.error(err);
        alert('Error adding point');
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = '+ Add Point';
    }
}

function removePoint(id) {
    fetch(`/api/points/${id}`, { method: 'DELETE' })
        .catch(err => console.error('Error removing point', err));
}

async function saveModalPoint() {
    const saveBtn = document.getElementById('modalSave');
    const name = document.getElementById('modalName').value.trim();
    const address = document.getElementById('modalAddress').value.trim();
    const dayVal = document.getElementById('modalDay').value.trim();
    const description = document.getElementById('modalDescription').value.trim();
    const photo = document.getElementById('modalPhoto').value.trim();

    if (!name || !address) {
        alert('Please enter a name and address');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Processing...';

    try {
        let lat, lng;
        
        // When editing: use original coords if address hasn't changed significantly
        if (currentEditing && editingPointOriginal) {
            lat = editingPointOriginal.lat;
            lng = editingPointOriginal.lng;
            // But allow re-geocoding if user explicitly changed address
            // Check if address looks like a full reverse-geocoded string or a new short address
            if (address.length < 30 || address.includes(',') === false) {
                // Looks like user entered a new address, geocode it
                saveBtn.textContent = 'Geocoding...';
                const geocoded = await geocodeAddress(address);
                if (geocoded) {
                    lat = geocoded.lat;
                    lng = geocoded.lng;
                }
            }
        } else {
            // New point: must geocode address
            saveBtn.textContent = 'Geocoding...';
            const geocoded = await geocodeAddress(address);
            if (!geocoded) {
                alert('Could not find address. Please try a different one.');
                return;
            }
            lat = geocoded.lat;
            lng = geocoded.lng;
        }

        const day = dayVal ? parseInt(dayVal, 10) : null;
        const payload = { name, lat, lng, day, description, photo };

        const method = currentEditing ? 'PUT' : 'POST';
        const url = currentEditing ? `/api/points/${currentEditing}` : '/api/points';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Save failed');
        closeModal();
    } catch (err) {
        console.error(err);
        alert('Error saving point');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

function deleteModalPoint() {
    if (!currentEditing) return;
    if (!confirm('Delete this point?')) return;
    removePoint(currentEditing);
    closeModal();
}

// ============ MAP INTERACTION ============
function onMarkerContextMenu(e) {
    const marker = this;
    const pid = marker.pointId;
    const pt = points.find(p => p.id === pid);
    if (!pt) return;
    showEditModal(pt);
}

function onMapContextMenu(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    showAddModal();
    reverseGeocode(lat, lng).then(addr => {
        if (addr) document.getElementById('modalAddress').value = addr;
    });
}

// ============ FILE OPERATIONS ============
function downloadJSON() {
    const data = JSON.stringify(points, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compass-points.json';
    a.click();
    URL.revokeObjectURL(url);
    closeAllMenus();
}

function importJSON() {
    const text = document.getElementById('importJsonText').value.trim();
    if (!text) {
        alert('Paste some JSON');
        return;
    }
    try {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('Expected an array');
        Promise.all(arr.map(p => fetch('/api/points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: p.name || 'Imported', lat: p.lat, lng: p.lng, day: p.day || null, description: p.description || '', photo: p.photo || '' })
        })))
            .then(() => {
                alert('Import complete!');
                closeImportModal();
            })
            .catch(err => {
                console.error(err);
                alert('Import failed');
            });
    } catch (err) {
        alert('Invalid JSON');
    }
}

function clearAllPoints() {
    if (!confirm('Clear all points? This cannot be undone.')) return;
    const ids = points.map(p => p.id);
    Promise.all(ids.map(id => fetch(`/api/points/${id}`, { method: 'DELETE' })))
        .catch(err => console.error('Error clearing points', err));
    closeAllMenus();
}

function organizeDays() {
    const unscheduled = points.filter(p => p.day === null || p.day === undefined);
    if (unscheduled.length === 0) {
        alert('All points are already scheduled!');
        closeAllMenus();
        return;
    }
    if (!confirm(`Smart plan: group ${unscheduled.length} point(s) into ~${maxDays} clusters by location?`)) return;

    fetch('/api/organize-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDays })
    })
        .then(res => {
            if (!res.ok) throw new Error('Organization failed');
            return res.json();
        })
        .then(data => {
            alert(`Smart planning complete!\nGrouped ${data.points} point(s) into ${data.clusters} cluster(s) based on location`);
        })
        .catch(err => {
            console.error('organizeDays error:', err);
            alert('Failed to organize points');
        })
        .finally(() => closeAllMenus());
}

// ============ SETTINGS ============
function openModalSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('settingsMaxDays').value = maxDays;
    closeAllMenus();
}

function closeModalSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
    const v = parseInt(document.getElementById('settingsMaxDays').value, 10) || 7;
    // send updated setting to server, which will broadcast to other clients
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDays: v })
    }).then(r => r.json()).then(data => {
        if (data.settings && typeof data.settings.maxDays === 'number') {
            maxDays = data.settings.maxDays;
            localStorage.setItem('maxDays', maxDays);
            renderCalendar();
            applyFilter();
        }
    }).catch(err => console.error('saveSettings error', err));
    closeModalSettings();
}

function openImportModal() {
    document.getElementById('importModal').classList.remove('hidden');
    document.getElementById('importJsonText').value = '';
    closeAllMenus();
}

function closeImportModal() {
    document.getElementById('importModal').classList.add('hidden');
}

// ============ MENU POPUPS ============
function closeAllMenus() {
    document.querySelectorAll('.menu-popup').forEach(f => f.classList.add('hidden'));
    currentOpenMenu = null;
}

function fitMapToBounds() {
    if (!map || filteredPoints.length === 0) return;
    
    // Create bounds from all filtered points
    const bounds = L.latLngBounds(filteredPoints.map(p => [p.lat, p.lng]));
    
    // Fit map to bounds with padding
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
}

// ============ TAB SYSTEM ============
function switchTab(tabName) {
    currentTab = tabName;
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
        if (tab.classList.contains('active')) tab.classList.remove('active');
    });
    // Show selected tab
    const selectedTab = document.getElementById(tabName);
    if (selectedTab) {
        selectedTab.classList.remove('hidden');
        selectedTab.classList.add('active');
    }
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = 'var(--text-2)';
        btn.style.borderBottom = '2px solid transparent';
    });
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.color = 'var(--text-1)';
        activeBtn.style.borderBottom = '2px solid var(--accent-color)';
    }
    
    // Invalidate map size if switching from hidden state
    if (tabName === 'mapPoints' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// ============ TASK LIST FUNCTIONS ============
async function addTaskFromForm() {
    const title = document.getElementById('taskTitle').value.trim();
    const dueDate = document.getElementById('taskDueDate').value;

    if (!title) {
        alert('Please enter a task title');
        return;
    }

    const payload = {
        title,
        dueDate: dueDate || null
    };

    try {
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to add task');

        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDueDate').value = '';
    } catch (err) {
        console.error(err);
        alert('Error adding task');
    }
}

function removeTask(id) {
    fetch(`/api/tasks/${id}`, { method: 'DELETE' })
        .catch(err => console.error('Error removing task', err));
}

function toggleTaskComplete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const payload = { completed: !task.completed };
    fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .catch(err => console.error('Error updating task', err));
}

function updateTasksList() {
    const tasksList = document.getElementById('tasksList');
    const taskCount = document.getElementById('taskCount');
    tasksList.innerHTML = '';
    taskCount.textContent = tasks.length;

    tasks.forEach(task => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.justifyContent = 'space-between';
        li.style.padding = '12px';
        li.style.backgroundColor = task.completed ? 'var(--input-bg)' : 'transparent';
        li.style.borderRadius = '8px';
        li.style.marginBottom = '8px';

        const content = document.createElement('div');
        content.style.flex = '1';
        content.style.display = 'flex';
        content.style.alignItems = 'center';
        content.style.gap = '12px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.style.width = '18px';
        checkbox.style.height = '18px';
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => toggleTaskComplete(task.id));

        const info = document.createElement('div');
        info.style.flex = '1';

        const title = document.createElement('div');
        title.textContent = task.title;
        title.style.fontWeight = '500';
        title.style.color = task.completed ? 'var(--text-3)' : 'var(--text-1)';
        title.style.textDecoration = task.completed ? 'line-through' : 'none';

        const dueDate = document.createElement('div');
        if (task.dueDate) {
            const date = new Date(task.dueDate);
            dueDate.textContent = date.toLocaleDateString();
            dueDate.style.fontSize = '0.85rem';
            dueDate.style.color = 'var(--text-3)';
            dueDate.style.marginTop = '4px';
        }

        info.appendChild(title);
        if (task.dueDate) info.appendChild(dueDate);

        const btn = document.createElement('button');
        btn.className = 'remove-btn';
        btn.textContent = '×';
        btn.style.padding = '4px 8px';
        btn.addEventListener('click', () => removeTask(task.id));

        content.appendChild(checkbox);
        content.appendChild(info);
        li.appendChild(content);
        li.appendChild(btn);
        tasksList.appendChild(li);
    });
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    renderCalendar();
    applyFilter();
    updateTasksList();

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(btn.dataset.tab);
        });
    });

    // Sidebar add button
    const addBtn = document.getElementById('addPointBtn');
    if (addBtn) addBtn.addEventListener('click', addPointFromForm);

    // Task list add button
    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) addTaskBtn.addEventListener('click', addTaskFromForm);
    
    // Search filter
    const searchFilter = document.getElementById('searchFilter');
    if (searchFilter) {
        searchFilter.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            applyFilter();
        });
    }

    // Modal buttons
    const modalSave = document.getElementById('modalSave');
    const modalDelete = document.getElementById('modalDelete');
    const modalCancel = document.getElementById('modalCancel');
    if (modalSave) modalSave.addEventListener('click', saveModalPoint);
    if (modalDelete) modalDelete.addEventListener('click', deleteModalPoint);
    if (modalCancel) modalCancel.addEventListener('click', closeModal);

    // Settings modal
    const settingsSave = document.getElementById('settingsSave');
    const settingsCancel = document.getElementById('settingsCancel');
    if (settingsSave) settingsSave.addEventListener('click', saveSettings);
    if (settingsCancel) settingsCancel.addEventListener('click', closeModalSettings);

    // Import modal
    const importSave = document.getElementById('importSave');
    const importCancel = document.getElementById('importCancel');
    if (importSave) importSave.addEventListener('click', importJSON);
    if (importCancel) importCancel.addEventListener('click', closeImportModal);

    // Menu items (from top menu bar)
    const fileMenu = document.getElementById('fileMenu');
    const toolsMenu = document.getElementById('toolsMenu');
    const organizeMenu = document.getElementById('organizeMenu');
    
    if (fileMenu) fileMenu.addEventListener('click', (e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        const filePopup = document.getElementById('fileMenuPopup');
        if (currentOpenMenu === 'file' && !filePopup.classList.contains('hidden')) {
            filePopup.classList.add('hidden');
            currentOpenMenu = null;
        } else {
            closeAllMenus();
            filePopup.classList.remove('hidden');
            currentOpenMenu = 'file';
        }
    });
    if (toolsMenu) toolsMenu.addEventListener('click', (e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        const toolsPopup = document.getElementById('toolsMenuPopup');
        if (currentOpenMenu === 'tools' && !toolsPopup.classList.contains('hidden')) {
            toolsPopup.classList.add('hidden');
            currentOpenMenu = null;
        } else {
            closeAllMenus();
            toolsPopup.classList.remove('hidden');
            currentOpenMenu = 'tools';
        }
    });
    if (organizeMenu) organizeMenu.addEventListener('click', (e) => { 
        e.preventDefault(); 
        e.stopPropagation();
        const organizePopup = document.getElementById('organizeMenuPopup');
        if (currentOpenMenu === 'organize' && !organizePopup.classList.contains('hidden')) {
            organizePopup.classList.add('hidden');
            currentOpenMenu = null;
        } else {
            closeAllMenus();
            organizePopup.classList.remove('hidden');
            currentOpenMenu = 'organize';
        }
    });

    const exportJsonItem = document.getElementById('exportJsonItem');
    const importJsonItem = document.getElementById('importJsonItem');
    const clearAllItem = document.getElementById('clearAllItem');
    const mapPointsTab = document.getElementById('mapPointsTab');
    const taskListTab = document.getElementById('taskListTab');
    const organizeDaysItem = document.getElementById('organizeDaysItem');
    const settingsItem = document.getElementById('settingsItem');

    if (exportJsonItem) exportJsonItem.addEventListener('click', downloadJSON);
    if (importJsonItem) importJsonItem.addEventListener('click', openImportModal);
    if (clearAllItem) clearAllItem.addEventListener('click', clearAllPoints);
    if (mapPointsTab) mapPointsTab.addEventListener('click', () => { switchTab('mapPoints'); closeAllMenus(); });
    if (taskListTab) taskListTab.addEventListener('click', () => { switchTab('taskList'); closeAllMenus(); });
    if (organizeDaysItem) organizeDaysItem.addEventListener('click', organizeDays);
    if (settingsItem) settingsItem.addEventListener('click', openModalSettings);

    // Close menus when clicking elsewhere
    document.addEventListener('click', closeAllMenus);
    document.querySelectorAll('.menu-popup').forEach(f => {
        f.addEventListener('click', e => e.stopPropagation());
    });

    // Mobile sidebar toggle
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('hidden-mobile');
            // Notify the map that its container size has changed
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 300);
        });
    }
});

window.removePoint = removePoint;
