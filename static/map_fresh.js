let map;
let markers = [];
let points = [];
let filteredPoints = [];
let tasks = [];
let calendarEvents = [];
let calendarCursor = new Date();
let calendarSelectedDate = formatCalendarDate(new Date());
let calendarAgendaAllDates = false;
let editingCalendarEvent = null;
let itineraryPreviewData = null;
let selectedCalendarDateFilter = null;
let planningMode = 'calendar';
let tripStartDate = null;

let maxDays = localStorage.getItem('maxDays') ? parseInt(localStorage.getItem('maxDays')) : 7;
let selectedOffset = null; // null = show all
let selectedCategoryFilter = null; // null = show all categories
let categories = [];
let socket = null;
let currentEditing = null;
let editingPointOriginal = null; // store original coords when editing
let searchQuery = ''; // search filter query
let currentOpenMenu = null; // track which menu is currently open
let currentTab = 'mapPoints'; // track current tab
let autoFetchImage = false; // whether to auto-fetch image when none provided
let currentTrip = null; // selected trip name, null = no project selected
let projects = [];
let routeStart = null;
let routeEnd = null;
let routePickTarget = null;
let routeLayers = [];
const routeSearchRequestIds = { start: 0, end: 0 };

// ============ TOAST NOTIFICATIONS ============
function showToast(message, type = 'info', duration = 1000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 300); // Wait for transition
    }, duration);
}

function buildUrl(path) {
    if (!currentTrip) return path;
    return path + (path.includes('?') ? '&' : '?') + 'trip=' + encodeURIComponent(currentTrip);
}

function ensureProjectSelected() {
    if (currentTrip) return true;
    showToast('Select a project first from File > Project', 'error', 2000);
    openProjectModal(true);
    return false;
}

async function loadTrips() {
    try {
        const res = await fetch('/api/trips');
        const list = await res.json();
        projects = Array.isArray(list) ? list : [];
        const stored = localStorage.getItem('currentTrip');
        if (stored) {
            const normalizedStored = sanitizeProjectName(stored);
            const matched = projects.find(t => sanitizeProjectName(t.name) === normalizedStored);
            if (matched) {
                currentTrip = matched.name;
            } else {
                currentTrip = null;
            }
        } else {
            currentTrip = null;
        }
        refreshProjectMenu(projects);
        if (!projects.length) {
            openProjectModal(true);
        } else if (!currentTrip) {
            showToast('Open a project from File > Project', 'info', 1200);
        }
        return projects;
    } catch (err) {
        console.error('loadTrips error', err);
        return [];
    }
}

function refreshProjectMenu(list) {
    const listEl = document.getElementById('projectList');
    const currentLabel = document.getElementById('currentProjectLabel');
    const deleteBtn = document.getElementById('deleteProjectItem');

    if (currentLabel) {
        currentLabel.textContent = currentTrip ? `Current project: ${currentTrip}` : 'Current project: none';
    }
    if (listEl) {
        listEl.innerHTML = '';
        if (!list.length) {
            const item = document.createElement('div');
            item.className = 'menu-item';
            item.style.cursor = 'default';
            item.style.opacity = '0.7';
            item.textContent = 'No projects yet.';
            listEl.appendChild(item);
        } else {
            list.forEach((t) => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.style.padding = '0.65rem 1rem';
                item.style.borderRadius = '6px';
                item.style.margin = '0 0.5rem 0.35rem 0.5rem';
                item.style.background = t.name === currentTrip ? 'hsl(205, 100%, 93%)' : 'transparent';
                item.style.fontWeight = t.name === currentTrip ? '700' : '500';
                item.style.color = t.name === currentTrip ? 'var(--accent-color)' : 'var(--text-1)';
                item.textContent = t.name;
                item.onclick = () => selectProject(t.name);
                listEl.appendChild(item);
            });
        }
    }
    if (deleteBtn) {
        deleteBtn.style.opacity = currentTrip ? '1' : '0.4';
        deleteBtn.style.pointerEvents = currentTrip ? 'auto' : 'none';
    }
}

function sanitizeProjectName(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function validateProjectName(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name);
}

function openProjectModal(focus = false) {
    const modal = document.getElementById('projectModal');
    const input = document.getElementById('projectNameInput');
    if (!modal || !input) return;
    refreshProjectMenu(projects);
    modal.classList.remove('hidden');
    input.value = '';
    if (focus) {
        setTimeout(() => input.focus(), 100);
    }
}

function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    if (!modal) return;
    modal.classList.add('hidden');
}

async function selectProject(name) {
    if (!name || name === currentTrip) return;
    currentTrip = name;
    localStorage.setItem('currentTrip', currentTrip);
    refreshProjectMenu(projects);
    await reloadData();
}

async function createProject() {
    const input = document.getElementById('projectNameInput');
    const button = document.getElementById('createProjectSave');
    if (!input || !button) return;
    const name = input.value.trim();
    if (!validateProjectName(name)) {
        showToast('Project name is invalid. Use letters, numbers, hyphen, underscore.', 'error', 1800);
        return;
    }
    button.disabled = true;
    button.textContent = 'Creating...';
    try {
        const res = await fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!res.ok) {
            throw new Error('create failed');
        }
        const result = await res.json();
        currentTrip = result.name || sanitizeProjectName(name);
        localStorage.setItem('currentTrip', currentTrip);
        await loadTrips();
        await reloadData();
        closeProjectModal();
        showToast('Project created', 'success');
    } catch (err) {
        console.error('createProject error', err);
        showToast('Could not create project', 'error', 1800);
    } finally {
        button.disabled = false;
        button.textContent = 'Create';
    }
}

async function deleteCurrentProject() {
    if (!currentTrip) {
        showToast('No project selected', 'info');
        return;
    }
    showConfirmation(`Delete project "${currentTrip}" and its files? This cannot be undone.`, async () => {
        try {
            const res = await fetch(`/api/trips/${encodeURIComponent(currentTrip)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('delete failed');
            localStorage.removeItem('currentTrip');
            currentTrip = null;
            await loadTrips();
            if (!projects.length) {
                openProjectModal(true);
            }
            showToast('Project deleted', 'success');
        } catch (err) {
            console.error('deleteCurrentProject error', err);
            showToast('Failed to delete project', 'error');
        }
    });
}

async function reloadData() {
    try {
        // settings first so categories exist before initial point render
        const sres = await fetch(buildUrl('/api/settings'));
        const s = await sres.json();
        if (s) {
            if (typeof s.maxDays === 'number') {
                maxDays = s.maxDays;
                localStorage.setItem('maxDays', maxDays);
            }
            if (typeof s.autoFetchImage !== 'undefined') {
                autoFetchImage = !!s.autoFetchImage;
                const cb = document.getElementById('settingsAutoFetch');
                if (cb) cb.checked = autoFetchImage;
            }
            planningMode = s.planningMode === 'legacy' ? 'legacy' : 'calendar';
            tripStartDate = s.tripStartDate || null;
            setCalendarFocusDate(tripStartDate);
            updatePlanningModeUI();
            if (Array.isArray(s.categories)) {
                categories = s.categories;
            }
            document.getElementById('settingsTripStartDate').value = s.tripStartDate || '';
            document.getElementById('settingsDayStartTime').value = s.dayStartTime || '08:00';
            document.getElementById('settingsDayEndTime').value = s.dayEndTime || '22:00';
            document.getElementById('settingsVisitMinutes').value = s.defaultVisitMinutes || 60;
            renderCategoryFilters();
            populateCategorySelects();
        }

        // points
        const ptsRes = await fetch(buildUrl('/api/points'));
        const pts = await ptsRes.json();
        points = (pts || []).map(convertPoint);
        populateRoutePointSelects();
        renderCategoryFilters();
        populateCategorySelects();
        applyFilter();
        fitMapToBounds();

        renderCalendar();

        // tasks
        const tres = await fetch(buildUrl('/api/tasks'));
        const ts = await tres.json();
        tasks = ts || [];
        updateTasksList();

        const cres = await fetch(buildUrl('/api/calendar'));
        const events = await cres.json();
        calendarEvents = Array.isArray(events) ? events : [];
        await syncMissingCalendarEventsForPoints();
        renderCalendarMonth();
        applyFilter();
    } catch (err) {
        console.error('reloadData error', err);
    }
}

async function syncMissingCalendarEventsForPoints() {
    if (!tripStartDate) return;
    const existingVisitPointIds = new Set(
        calendarEvents.filter(e => e && e.pointId !== null && e.pointId !== undefined && e.kind === 'visit').map(e => e.pointId)
    );
    for (const pt of points) {
        if (pt && pt.day !== null && pt.day !== undefined && pt.day !== '' && !existingVisitPointIds.has(pt.id)) {
            const dayNum = parseInt(pt.day, 10);
            if (!isNaN(dayNum) && dayNum >= 1) {
                const targetDate = calculateDateStringFromDay(dayNum);
                if (targetDate) {
                    try {
                        await syncPointSchedule(pt, targetDate);
                        existingVisitPointIds.add(pt.id);
                    } catch (e) {
                        console.error('Error auto-syncing point calendar event:', e);
                    }
                }
            }
        }
    }
}

// ============ CONFIRMATION MODAL ============
let confirmationCallback = null;

function showConfirmation(message, onYes, onNo = null) {
    const modal = document.getElementById('confirmationModal');
    const msgEl = document.getElementById('confirmationMessage');
    const yesBtn = document.getElementById('confirmationYes');
    const noBtn = document.getElementById('confirmationNo');

    msgEl.textContent = message;
    confirmationCallback = onYes;

    const handleYes = () => {
        if (confirmationCallback) confirmationCallback();
        hideConfirmation();
    };

    const handleNo = () => {
        if (onNo) onNo();
        hideConfirmation();
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleYes();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleNo();
        }
    };

    yesBtn.onclick = handleYes;
    noBtn.onclick = handleNo;
    document.addEventListener('keydown', handleKeydown);

    modal.classList.remove('hidden');

    // Focus the no button for accessibility
    noBtn.focus();
}

function hideConfirmation() {
    const modal = document.getElementById('confirmationModal');
    modal.classList.add('hidden');
    confirmationCallback = null;
    document.removeEventListener('keydown', () => {});
}

// ============ MAP INIT ============
async function getEnglishMapStyle() {
    const response = await fetch('https://tiles.openfreemap.org/styles/positron');
    if (!response.ok) throw new Error('OpenFreeMap style failed to load');
    const style = await response.json();
    style.layers = (style.layers || []).map(layer => {
        if (layer.type !== 'symbol' || !layer.layout) return layer;
        const minZoomByLayer = {
            'highway-name-path': 16,
            'highway-name-minor': 15,
            'waterway_line_label': 14,
            'water_name_line_label': 13,
            'label_other': 14,
            'label_village': 12,
            'label_town': 10
        };
        const minZoom = minZoomByLayer[layer.id];
        const layout = { ...layer.layout };
        delete layout['icon-image'];
        if (minZoom !== undefined) layout.visibility = 'visible';
        const paint = layer.paint ? { ...layer.paint } : undefined;
        if (paint && layer.layout['text-field']) {
            paint['text-halo-width'] = 1.5;
            paint['text-halo-blur'] = 0.3;
        }
        if (!layer.layout['text-field']) return { ...layer, layout, ...(paint ? { paint } : {}) , ...(minZoom !== undefined ? { minzoom: minZoom } : {}) };
        const originalFont = Array.isArray(layer.layout['text-font']) ? layer.layout['text-font'].join(' ') : '';
        const fontName = originalFont.includes('Bold') ? 'Noto Sans Bold' : originalFont.includes('Italic') ? 'Noto Sans Italic' : 'Noto Sans Regular';
        return {
            ...layer,
            minzoom: minZoom !== undefined ? minZoom : layer.minzoom,
            layout: {
                ...layout,
                'text-font': [fontName],
                'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']],
                'text-allow-overlap': false,
                'icon-allow-overlap': false,
                'text-padding': 3,
                'text-letter-spacing': 0.01,
                'text-max-angle': 30
            },
            ...(paint ? { paint } : {})
        };
    });
    return style;
}

async function initMap() {
    map = L.map('map', { 
        zoomControl: false, 
        maxBounds: [[-90, -180], [90, 180]],
        maxBoundsViscosity: 1.0
    }).setView([37.7749, -122.4194], 13);
          
    try {
        const style = await getEnglishMapStyle();
        L.maplibreGL({
            style,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://openfreemap.org">OpenFreeMap</a>'
        }).addTo(map);
    } catch (error) {
        console.error('OpenFreeMap unavailable, using OSM fallback', error);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            noWrap: true
        }).addTo(map);
    }

    if (window.io) {
        socket = io();
        socket.on('points_updated', (data) => {
            // data may be {trip, points} or legacy array
            if (!data) return;
            if (Array.isArray(data)) {
                // legacy
                points = (data || []).map(convertPoint);
                applyFilter();
                renderCalendarMonth();
                return;
            }
            const trip = data.trip || null;
            if (trip !== currentTrip) return; // ignore updates for other trips
            points = (data.points || []).map(convertPoint);
            applyFilter();
            renderCalendarMonth();
        });
        socket.on('tasks_updated', (data) => {
            if (!data) return;
            if (Array.isArray(data)) {
                tasks = data || [];
                updateTasksList();
                renderCalendarMonth();
                return;
            }
            const trip = data.trip || null;
            if (trip !== currentTrip) return;
            tasks = data.tasks || [];
            updateTasksList();
            renderCalendarMonth();
        });
        socket.on('calendar_updated', (data) => {
            if (!data) return;
            if (Array.isArray(data)) {
                calendarEvents = data;
                renderCalendarMonth();
                applyFilter();
                return;
            }
            const trip = data.trip || null;
            if (trip !== currentTrip) return;
            calendarEvents = Array.isArray(data.events) ? data.events : [];
            renderCalendarMonth();
            applyFilter();
        });
        socket.on('settings_updated', (s) => {
            // payload may be {trip, settings} or legacy settings object
            if (!s) return;
            let payload = s;
            let trip = null;
            if (s.trip !== undefined && s.settings !== undefined) {
                trip = s.trip || null;
                payload = s.settings;
            }
            if (trip !== currentTrip) return;
            if (payload && typeof payload.maxDays === 'number') {
                maxDays = payload.maxDays;
                localStorage.setItem('maxDays', maxDays);
                applyFilter();
            }
            if (payload && typeof payload.autoFetchImage !== 'undefined') {
                autoFetchImage = !!payload.autoFetchImage;
                const cb = document.getElementById('settingsAutoFetch');
                if (cb) cb.checked = autoFetchImage;
            }
            if (payload && (payload.planningMode === 'legacy' || payload.planningMode === 'calendar')) {
                planningMode = payload.planningMode;
                tripStartDate = payload.tripStartDate || tripStartDate;
                updatePlanningModeUI();
            }
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'tripStartDate')) {
                tripStartDate = payload.tripStartDate || null;
                setCalendarFocusDate(tripStartDate);
                renderCalendar();
                renderCalendarMonth();
                renderPoints(filteredPoints);
                updatePointsList();
            }
            if (payload && Array.isArray(payload.categories)) {
                categories = payload.categories;
                renderCategoryFilters();
                populateCategorySelects();
                renderCategorySettings();
            }
        });
    }
    // load available trips and then load data for the selected trip
    const trips = await loadTrips();
    if (currentTrip) {
        await reloadData();
    } else {
        openProjectModal(true);
    }

    map.on('contextmenu', onMapContextMenu);
    map.on('click', onRouteMapClick);
}

// ============ HELPERS ============
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCategoryById(id) {
    const normalizedId = normalizeCategoryId(id);
    return categories.find(c => normalizeCategoryId(c.id) === normalizedId) || categories.find(c => normalizeCategoryId(c.id) === 'point') || { id: 'point', name: 'Point', color: '#1788f7' };
}

function resolveCategoryColor(id) {
    return getCategoryById(id).color || '#1788f7';
}

function normalizeCategoryId(value) {
    if (!value) return 'point';
    const normalized = String(value).trim().toLowerCase();
    return normalized || 'point';
}

function convertPoint(p) {
    const newp = Object.assign({}, p);
    if (newp.created) newp.createdMs = newp.created * 1000;
    else newp.createdMs = Date.now();
    newp.categoryId = normalizeCategoryId(newp.categoryId || 'point');
    return newp;
}

// ============ GEOCODING ============
async function geocodeAddress(query) {
    const results = await geocodeAddressResults(query, 1);
    return results[0] || null;
}

async function geocodeAddressResults(query, limit = 5) {
    if (!query.trim()) return [];
    try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=${limit}`);
        if (!response.ok) throw new Error('Geocoding failed');
        const results = await response.json();
        if (!Array.isArray(results)) return [];
        return results;
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

// ============ ROUTE PLANNER ============
function populateRoutePointSelects() {
    ['routeStartPoint', 'routeEndPoint'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const selected = select.value;
        select.innerHTML = '<option value="">Choose a saved point</option>';
        points.forEach(point => {
            const option = document.createElement('option');
            option.value = point.id;
            option.textContent = point.name;
            select.appendChild(option);
        });
        select.value = selected;
    });
}

function setRouteEndpoint(target, location) {
    routeSearchRequestIds[target] += 1;
    const endpoint = { lat: Number(location.lat), lng: Number(location.lng), name: location.name || 'Map pin' };
    if (target === 'start') routeStart = endpoint;
    if (target === 'end') routeEnd = endpoint;
    const search = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Search`);
    if (search) search.value = endpoint.name;
    const results = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Results`);
    if (results) results.classList.add('hidden');
    const select = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Point`);
    if (select) select.value = '';
    routePickTarget = null;
    updateRouteStatus();
}

function selectSavedRoutePoint(target, value) {
    const point = points.find(item => String(item.id) === String(value));
    if (point) setRouteEndpoint(target, point);
}

function updateRouteStatus(message) {
    const status = document.getElementById('routeStatus');
    if (!status) return;
    if (message) {
        status.textContent = message;
    } else if (routePickTarget) {
        status.textContent = `Click the map to choose the ${routePickTarget}.`;
    } else if (!routeStart || !routeEnd) {
        status.textContent = 'Choose two endpoints to begin.';
    } else {
        status.textContent = 'Ready to calculate a driving route.';
    }
}

function clearRouteLayers() {
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
}

function clearRoute() {
    clearRouteLayers();
    routeStart = null;
    routeEnd = null;
    routePickTarget = null;
    ['routeStartSearch', 'routeEndSearch'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    ['routeStartPoint', 'routeEndPoint'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.value = '';
    });
    ['routeStartResults', 'routeEndResults'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });
    const results = document.getElementById('routeResults');
    if (results) results.classList.add('hidden');
    updateRouteStatus();
}

function formatRouteDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatRouteDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function drawRoute(route) {
    clearRouteLayers();
    route.routes.forEach((candidate, index) => {
        const layer = L.polyline(candidate.path, {
            color: index === 0 ? '#1769aa' : '#7b8794',
            weight: index === 0 ? 6 : 4,
            opacity: index === 0 ? 0.9 : 0.45,
            dashArray: index === 0 ? null : '8 8'
        }).addTo(map);
        routeLayers.push(layer);
    });
    const primary = route.routes[0];
    const results = document.getElementById('routeResults');
    results.innerHTML = `<strong>${formatRouteDuration(primary.duration)} · ${formatRouteDistance(primary.distance)}</strong><small>Driving route from ${escapeHtml(routeStart.name)} to ${escapeHtml(routeEnd.name)}</small>`;
    results.classList.remove('hidden');
    map.fitBounds(routeLayers[0].getBounds(), { padding: [60, 60], maxZoom: 16 });
    updateRouteStatus('Route calculated. The solid line is the recommended route.');
}

async function calculateRoute() {
    const startSearch = document.getElementById('routeStartSearch');
    const endSearch = document.getElementById('routeEndSearch');
    if (!routeStart && startSearch?.value.trim()) await resolveRouteSearch('start');
    if (!routeEnd && endSearch?.value.trim()) await resolveRouteSearch('end');
    if (!routeStart || !routeEnd) {
        updateRouteStatus('Choose both a start and a destination first.');
        return;
    }
    const button = document.getElementById('calculateRouteBtn');
    button.disabled = true;
    updateRouteStatus('Calculating road route...');
    try {
        const response = await fetch('/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start: routeStart, end: routeEnd, mode: document.getElementById('routeMode').value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Route calculation failed');
        drawRoute(data);
    } catch (error) {
        console.error('calculateRoute error', error);
        updateRouteStatus(error.message);
    } finally {
        button.disabled = false;
    }
}

function onRouteMapClick(event) {
    if (routePickTarget) {
        const target = routePickTarget;
        setRouteEndpoint(target, { lat: event.latlng.lat, lng: event.latlng.lng, name: 'Map pin' });
        openMobileSidebar();
        switchTab('routePlanner');
    }
}

function closeMobileSidebar() {
    if (window.innerWidth > 768) return;
    const sidebar = document.querySelector('.sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar) return;
    sidebar.classList.add('hidden-mobile');
    document.body.classList.remove('menu-open');
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '☰';
        toggle.classList.remove('open');
    }
    if (map) setTimeout(() => map.invalidateSize(true), 120);
}

function openMobileSidebar() {
    if (window.innerWidth > 768) return;
    const sidebar = document.querySelector('.sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar) return;
    sidebar.classList.remove('hidden-mobile');
    document.body.classList.add('menu-open');
    if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.textContent = '×';
        toggle.classList.add('open');
    }
    if (map) setTimeout(() => map.invalidateSize(true), 120);
}

async function searchRouteEndpoint(target) {
    const input = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Search`);
    if (!input || !input.value.trim()) return;
    const requestId = ++routeSearchRequestIds[target];
    updateRouteStatus('Searching for location...');
    const locations = await geocodeAddressResults(input.value.trim(), 5);
    if (requestId !== routeSearchRequestIds[target]) return;
    if (!locations || !locations.length) {
        updateRouteStatus('Location not found. Try a more specific address.');
        return;
    }
    renderRouteSearchResults(target, locations);
}

function renderRouteSearchResults(target, locations) {
    const container = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Results`);
    if (!container) return;
    container.innerHTML = '';
    locations.forEach(location => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'route-search-result';
        button.textContent = location.address;
        const detail = document.createElement('small');
        detail.textContent = location.type ? location.type.replace(/_/g, ' ') : 'OpenStreetMap result';
        button.appendChild(detail);
        button.addEventListener('click', () => setRouteEndpoint(target, { ...location, name: location.address }));
        container.appendChild(button);
    });
    container.classList.toggle('hidden', locations.length === 0);
}

async function resolveRouteSearch(target) {
    const input = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Search`);
    if (!input || !input.value.trim()) return false;
    updateRouteStatus('Finding location...');
    const locations = await geocodeAddressResults(input.value.trim(), 5);
    if (!locations || !locations.length) return false;
    setRouteEndpoint(target, { ...locations[0], name: locations[0].address });
    return true;
}

// ============ RENDERING ============
function createCustomMarker(categoryId) {
    const markerDiv = document.createElement('div');
    markerDiv.className = 'map-marker';
    markerDiv.style.background = resolveCategoryColor(categoryId);
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
        const dayHtml = pointScheduleLabel(point);
        const category = getCategoryById(point.categoryId);
        const categoryHtml = `<div style="margin-top:6px;display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:50%;background:${category.color};display:inline-block;"></span><span style="font-size:0.85rem;color:var(--text-3);">${escapeHtml(category.name)}</span></div>`;
        const popupHtml = `<div style="min-width:200px; word-wrap: break-word; white-space: pre-wrap;"><b style="font-size:1.1rem;">${escapeHtml(point.name)}</b><div style="font-size:0.85rem;color:var(--text-3);margin-top:4px;">${dayHtml}</div>${categoryHtml}${descHtml}${photoHtml}</div>`;
        const marker = L.marker([point.lat, point.lng], { icon: createCustomMarker(point.categoryId) })
            .bindPopup(popupHtml)
            .addTo(map);
        marker.pointId = point.id;
        marker.on('click', (event) => {
            if (!routePickTarget) return;
            L.DomEvent.stopPropagation(event);
            const target = routePickTarget;
            setRouteEndpoint(target, point);
            openMobileSidebar();
            switchTab('routePlanner');
        });
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
        const category = getCategoryById(point.categoryId);
        li.style.borderLeft = `4px solid ${category.color}`;
        const info = document.createElement('div');
        info.className = 'point-info';
        const dayText = pointScheduleLabel(point);
        const desc = point.description ? `<div class="point-desc" style="font-size:0.85rem;color:var(--text-2);margin-top:4px;">${escapeHtml(point.description.substring(0, 50))}</div>` : '';
        const thumb = point.photo ? `<img src="${point.photo}" alt="photo" style="width:48px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.style.display='none'">` : '';
        info.innerHTML = `<div style="display:flex;align-items:flex-start;gap:10px;flex:1"><div>${thumb}</div><div style="flex:1"><div class="point-name" style="font-weight:500;">${escapeHtml(point.name)}</div><div style="display:flex;align-items:center;gap:0.5rem;margin-top:4px;"><span class="point-day" style="font-size:0.85rem;color:var(--text-3);">${dayText}</span><span style="font-size:0.75rem;color:${category.color};font-weight:600;">${escapeHtml(category.name)}</span></div>${desc}</div></div>`;
        const btn = document.createElement('button');
        btn.className = 'remove-btn';
        btn.textContent = '×';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteListPoint(point.id, point.name);
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
            // On mobile, close the sidebar once the point is selected so the map is fully visible
            const mobileSidebar = document.querySelector('.sidebar');
            if (window.innerWidth <= 768 && mobileSidebar && !mobileSidebar.classList.contains('hidden-mobile')) {
                const toggle = document.getElementById('sidebarToggle');
                mobileSidebar.classList.add('hidden-mobile');
                document.body.classList.remove('menu-open');
                if (toggle) {
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.textContent = '☰';
                    toggle.classList.remove('open');
                }
                adjustMapHeight();
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

function setCalendarFocusDate(dateString) {
    if (dateString) {
        calendarCursor = parseCalendarDate(dateString);
        calendarSelectedDate = dateString;
    } else {
        calendarCursor = new Date();
        calendarSelectedDate = formatCalendarDate(new Date());
    }
}

function getTripStartDateObj() {
    if (!tripStartDate) return null;
    const parts = String(tripStartDate).split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function calculateDayFromDateString(dateStr) {
    if (!dateStr || !tripStartDate) return null;
    const tripStart = getTripStartDateObj();
    if (!tripStart) return null;
    const parts = String(dateStr).split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;

    const startUtc = Date.UTC(tripStart.getFullYear(), tripStart.getMonth(), tripStart.getDate());
    const dateUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const diffDays = Math.round((dateUtc - startUtc) / 86400000);
    return diffDays + 1;
}

function calculateDateStringFromDay(dayNum) {
    const day = parseInt(dayNum, 10);
    if (isNaN(day) || day < 1 || !tripStartDate) return null;
    const tripStart = getTripStartDateObj();
    if (!tripStart) return null;

    const targetDate = new Date(tripStart.getFullYear(), tripStart.getMonth(), tripStart.getDate() + (day - 1));
    return formatCalendarDate(targetDate);
}

let isSyncingDateDay = false;

function syncDateToDay(dateInput, dayInput) {
    if (isSyncingDateDay || !dateInput || !dayInput) return;
    isSyncingDateDay = true;
    try {
        const val = dateInput.value;
        if (!val) {
            dayInput.value = '';
            return;
        }
        if (!tripStartDate) {
            dayInput.value = '';
            return;
        }
        const day = calculateDayFromDateString(val);
        if (day === null) {
            dayInput.value = '';
            return;
        }
        if (day < 1) {
            dayInput.value = '';
            showToast(`Selected date is before the trip start date (${tripStartDate}).`, 'warning', 2500);
            return;
        }
        dayInput.value = day;
    } finally {
        isSyncingDateDay = false;
    }
}

function syncDayToDate(dayInput, dateInput) {
    if (isSyncingDateDay || !dayInput || !dateInput) return;
    isSyncingDateDay = true;
    try {
        const val = String(dayInput.value || '').trim();
        if (!val) {
            dateInput.value = '';
            return;
        }
        if (!tripStartDate) {
            dateInput.value = '';
            showToast('No trip start date set. Set a start date in Settings to calculate calendar dates.', 'info', 3000);
            return;
        }
        const dayNum = parseInt(val, 10);
        if (isNaN(dayNum) || dayNum < 1) {
            dateInput.value = '';
            return;
        }
        const calculatedDate = calculateDateStringFromDay(dayNum);
        if (calculatedDate) {
            dateInput.value = calculatedDate;
        }
    } finally {
        isSyncingDateDay = false;
    }
}

function pointScheduleLabel(point) {
    const scheduled = calendarEvents
        .filter(event => event.pointId === point.id)
        .sort((a, b) => `${a.date}${a.startTime || ''}`.localeCompare(`${b.date}${b.startTime || ''}`))[0];

    if (planningMode === 'legacy') {
        if (point.day !== null && point.day !== undefined && point.day !== '') {
            const start = tripStartDate ? parseCalendarDate(tripStartDate) : null;
            if (start && Number.isInteger(Number(point.day)) && Number(point.day) > 0) {
                const scheduledDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Number(point.day) - 1);
                return `Day ${point.day} (${formatCalendarDate(scheduledDate)})`;
            }
            return `Day ${point.day}`;
        }
        if (scheduled) {
            if (tripStartDate) {
                const day = calculateDayFromDateString(scheduled.date);
                if (day && day >= 1) return `Day ${day} (${scheduled.date})`;
            }
            return scheduled.date;
        }
        return 'Unscheduled';
    }

    if (scheduled) {
        let label = `${scheduled.date}${scheduled.allDay ? '' : ` at ${scheduled.startTime}`}`;
        if (tripStartDate) {
            const day = calculateDayFromDateString(scheduled.date);
            if (day && day >= 1) label += ` (Day ${day})`;
        }
        return label;
    }
    if (point.day !== null && point.day !== undefined && point.day !== '') {
        if (tripStartDate) {
            const calcDate = calculateDateStringFromDay(point.day);
            if (calcDate) return `${calcDate} (Day ${point.day})`;
        }
        return `Day ${point.day}`;
    }
    return 'Unscheduled';
}

function renderCalendar() {
    const container = document.getElementById('calendarDays');
    if (!container) return;
    container.innerHTML = '';
    if (planningMode === 'legacy') {
        for (let day = 1; day <= maxDays; day += 1) {
            const dayButton = document.createElement('button');
            dayButton.type = 'button';
            dayButton.className = 'calendar-day';
            const pointCount = points.filter(point => point.day === day).length;
            dayButton.textContent = day;
            if (pointCount) dayButton.classList.add('has-points');
            if (day === selectedOffset) dayButton.classList.add('selected');
            dayButton.addEventListener('click', () => {
                selectedOffset = selectedOffset === day ? null : day;
                syncPointEntryDefaults();
                applyFilter();
            });
            container.appendChild(dayButton);
        }
        return;
    }
    const monthHeader = document.createElement('div');
    monthHeader.className = 'calendar-filter-header';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'calendar-filter-nav';
    previous.textContent = '<';
    previous.setAttribute('aria-label', 'Previous month');
    previous.addEventListener('click', () => {
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
        renderCalendar();
        renderCalendarMonth();
    });
    const monthLabel = document.createElement('strong');
    monthLabel.textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'calendar-filter-nav';
    next.textContent = '>';
    next.setAttribute('aria-label', 'Next month');
    next.addEventListener('click', () => {
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
        renderCalendar();
        renderCalendarMonth();
    });
    monthHeader.append(previous, monthLabel, next);
    container.appendChild(monthHeader);
    const firstDay = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1).getDay();
    const daysInMonth = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0).getDate();
    for (let index = 0; index < firstDay; index += 1) {
        const empty = document.createElement('span');
        empty.className = 'calendar-filter-empty';
        container.appendChild(empty);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = formatCalendarDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), day));
        const dayButton = document.createElement('button');
        dayButton.type = 'button';
        dayButton.className = 'calendar-day';
        const eventCount = calendarEvents.filter(event => event.date === date).length;
        dayButton.textContent = day;
        if (date === selectedCalendarDateFilter) dayButton.classList.add('selected');
        if (eventCount) dayButton.classList.add('has-points');
        dayButton.addEventListener('click', () => {
            selectedCalendarDateFilter = selectedCalendarDateFilter === date ? null : date;
            calendarSelectedDate = date;
            syncPointEntryDefaults();
            renderCalendar();
            renderCalendarMonth();
            applyFilter();
        });
        container.appendChild(dayButton);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'calendar-clear-filter';
    clear.textContent = selectedCalendarDateFilter ? 'Show all dates' : 'Showing all dates';
    clear.disabled = !selectedCalendarDateFilter;
    clear.addEventListener('click', () => {
        selectedCalendarDateFilter = null;
        renderCalendar();
        applyFilter();
    });
    container.appendChild(clear);
}

function updatePlanningModeUI() {
    const legacy = planningMode === 'legacy';
    document.getElementById('settingsPlanningMode')?.setAttribute('value', planningMode);
    const modeSelect = document.getElementById('settingsPlanningMode');
    if (modeSelect) modeSelect.value = planningMode;
    document.getElementById('pointScheduleDate')?.classList.remove('hidden');
    document.getElementById('pointLegacyDay')?.classList.remove('hidden');
    document.getElementById('pointLegacyDayLabel')?.classList.remove('hidden');
    document.getElementById('pointScheduleHint')?.classList.remove('hidden');
    document.getElementById('modalScheduleDate')?.classList.remove('hidden');
    document.getElementById('modalScheduleDateLabel')?.classList.remove('hidden');
    document.getElementById('modalLegacyDayLabel')?.classList.remove('hidden');
    const mapHeading = document.querySelector('#mapPoints .form-section h2');
    if (mapHeading) mapHeading.textContent = legacy ? 'Filter by day' : 'Filter by date';
    updateDatePickerAnchors();
    syncPointEntryDefaults();
    renderCalendar();
    applyFilter();
}

function setDatePickerAnchor(inputId, tripStartDateValue, clear = true) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const start = tripStartDateValue ? String(tripStartDateValue).split('T')[0] : '';
    if (clear) input.value = '';
    if (start) input.min = start;
    else input.removeAttribute('min');
}

function updateDatePickerAnchors(clear = false) {
    ['pointScheduleDate', 'modalScheduleDate', 'taskDueDate', 'calendarEventDate'].forEach(inputId => {
        setDatePickerAnchor(inputId, tripStartDate, clear);
    });
}

function syncPointEntryDefaults() {
    const dateInput = document.getElementById('pointScheduleDate');
    const dayInput = document.getElementById('pointLegacyDay');
    if (!dateInput || !dayInput) return;

    setDatePickerAnchor('pointScheduleDate', tripStartDate);
    dayInput.value = '';
}

function formatCalendarDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseCalendarDate(value) {
    const parts = String(value || '').split('-').map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

function calendarEventsForDate(date) {
    return calendarEvents
        .filter(event => event.date === date)
        .sort((a, b) => {
            if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
            return (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title);
        });
}

function sortedCalendarEvents(events) {
    return events.slice().sort((a, b) => {
        if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title);
    });
}

function renderCalendarMonth() {
    const grid = document.getElementById('calendarMonthGrid');
    const label = document.getElementById('calendarMonthLabel');
    const selectedLabel = document.getElementById('calendarSelectedLabel');
    const agenda = document.getElementById('calendarAgendaList');
    if (!grid || !label || !selectedLabel || !agenda) return;

    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    label.textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    grid.innerHTML = '';
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = formatCalendarDate(new Date());
    for (let index = 0; index < firstDay; index += 1) {
        const empty = document.createElement('div');
        empty.className = 'calendar-month-cell calendar-month-cell-empty';
        grid.appendChild(empty);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = formatCalendarDate(new Date(year, month, day));
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendar-month-cell';
        if (date === today) cell.classList.add('today');
        if (!calendarAgendaAllDates && date === calendarSelectedDate) cell.classList.add('selected');
        const number = document.createElement('span');
        number.className = 'calendar-date-number';
        number.textContent = day;
        cell.appendChild(number);
        const events = calendarEventsForDate(date);
        if (events.length) {
            const markers = document.createElement('span');
            markers.className = 'calendar-event-markers';
            events.slice(0, 3).forEach(event => {
                const marker = document.createElement('i');
                marker.style.backgroundColor = event.color || 'var(--accent-400)';
                markers.appendChild(marker);
            });
            cell.appendChild(markers);
        }
        cell.addEventListener('click', () => {
            calendarAgendaAllDates = !calendarAgendaAllDates
                && calendarSelectedDate === date
                && selectedCalendarDateFilter === date;
            calendarSelectedDate = date;
            selectedCalendarDateFilter = calendarAgendaAllDates ? null : date;
            renderCalendarMonth();
            renderCalendar();
            applyFilter();
        });
        grid.appendChild(cell);
    }

    const selectedDateObject = parseCalendarDate(calendarSelectedDate);
    selectedLabel.textContent = calendarAgendaAllDates
        ? 'All days'
        : selectedDateObject.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const selectedEvents = calendarAgendaAllDates ? sortedCalendarEvents(calendarEvents) : calendarEventsForDate(calendarSelectedDate);
    const count = document.getElementById('calendarEventCount');
    if (count) count.textContent = `${selectedEvents.length} ${selectedEvents.length === 1 ? 'event' : 'events'}`;
    agenda.innerHTML = '';
    if (!selectedEvents.length) {
        agenda.innerHTML = '<div class="calendar-empty">Nothing scheduled yet.</div>';
        renderCalendarTimeline(selectedEvents);
        populateItineraryPointSelect();
        return;
    }
    selectedEvents.forEach(event => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'calendar-agenda-item';
        item.style.borderLeftColor = event.color || 'var(--accent-400)';
        const time = event.allDay ? 'All day' : `${event.startTime || ''}${event.endTime ? ` - ${event.endTime}` : ''}`;
        const links = [];
        if (event.pointId) {
            const point = points.find(itemPoint => itemPoint.id === event.pointId);
            if (point) links.push(`Point: ${escapeHtml(point.name)}`);
        }
        if (event.taskId) {
            const task = tasks.find(itemTask => itemTask.id === event.taskId);
            if (task) links.push(`Task: ${escapeHtml(task.title)}`);
        }
        item.innerHTML = `<span class="calendar-agenda-time">${escapeHtml(time)}</span><span class="calendar-agenda-title">${escapeHtml(event.title)}</span>${event.description ? `<span class="calendar-agenda-description">${escapeHtml(event.description)}</span>` : ''}${links.length ? `<span class="calendar-agenda-links">${links.join(' &middot; ')}</span>` : ''}`;
        item.addEventListener('click', () => openCalendarEventModal(event));
        agenda.appendChild(item);
    });
    renderCalendarTimeline(selectedEvents);
    populateItineraryPointSelect();
}

function renderCalendarTimeline(events) {
    const timeline = document.getElementById('calendarTimeline');
    if (!timeline) return;
    timeline.innerHTML = '';
    const timedEvents = events.filter(event => !event.allDay && event.startTime);
    if (!timedEvents.length) return;
    const heading = document.createElement('div');
    heading.className = 'calendar-timeline-heading';
    heading.textContent = 'Day timeline';
    timeline.appendChild(heading);
    timedEvents.forEach(event => {
        const block = document.createElement('div');
        block.className = `calendar-timeline-block ${event.kind || 'custom'}`;
        block.style.borderLeftColor = event.color || 'var(--accent-400)';
        block.innerHTML = `<span>${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime || '')}</span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.kind || 'custom')}</small>`;
        block.addEventListener('click', () => openCalendarEventModal(event));
        timeline.appendChild(block);
    });
}

function populateItineraryPointSelect() {
    const select = document.getElementById('itineraryPointSelect');
    if (!select) return;
    const scheduledIds = new Set(calendarEvents.filter(event => event.date === calendarSelectedDate && event.pointId).map(event => event.pointId));
    select.innerHTML = '';
    points.filter(point => !scheduledIds.has(point.id)).forEach(point => {
        const option = new Option(point.name, String(point.id));
        select.appendChild(option);
    });
}

function renderItineraryPreview(preview) {
    const container = document.getElementById('itineraryPreview');
    const commitButton = document.getElementById('commitItineraryBtn');
    if (!container || !commitButton) return;
    itineraryPreviewData = preview;
    container.classList.remove('hidden');
    const conflictHtml = preview.conflicts?.length ? `<div class="itinerary-conflicts">${preview.conflicts.map(conflict => `<div>${escapeHtml(conflict)}</div>`).join('')}</div>` : '<div class="itinerary-ready">Ready to schedule.</div>';
    const eventHtml = preview.events.map(event => `<div><strong>${escapeHtml(event.startTime)} - ${escapeHtml(event.endTime)}</strong> ${escapeHtml(event.title)}</div>`).join('');
    container.innerHTML = `${conflictHtml}<div class="itinerary-preview-events">${eventHtml || 'No points selected.'}</div>`;
    commitButton.classList.toggle('hidden', !!preview.conflicts?.length || !preview.events.length);
}

async function previewItinerary() {
    if (!ensureProjectSelected()) return;
    const select = document.getElementById('itineraryPointSelect');
    const pointIds = Array.from(select?.selectedOptions || []).map(option => Number(option.value));
    if (!pointIds.length) {
        showToast('Select at least one unscheduled point', 'error');
        return;
    }
    try {
        const response = await fetch(buildUrl('/api/itinerary/plan'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: calendarSelectedDate, pointIds })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not plan itinerary');
        renderItineraryPreview(result);
    } catch (error) {
        showToast(error.message, 'error', 1800);
    }
}

async function commitItineraryPreview() {
    if (!itineraryPreviewData || !ensureProjectSelected()) return;
    try {
        const response = await fetch(buildUrl('/api/itinerary/plan'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: itineraryPreviewData.date, pointIds: itineraryPreviewData.scheduledPointIds, commit: true })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not commit itinerary');
        calendarEvents = result.calendar || calendarEvents.concat(result.events || []);
        itineraryPreviewData = null;
        document.getElementById('itineraryPreview')?.classList.add('hidden');
        document.getElementById('commitItineraryBtn')?.classList.add('hidden');
        renderCalendarMonth();
        populateItineraryPointSelect();
        showToast('Itinerary added to calendar', 'success');
    } catch (error) {
        showToast(error.message, 'error', 1800);
    }
}

async function migrateLegacyDays() {
    if (!ensureProjectSelected()) return;
    const tripStartDate = document.getElementById('settingsTripStartDate')?.value;
    if (!tripStartDate) {
        showToast('Choose a trip start date first', 'error');
        return;
    }
    try {
        const response = await fetch(buildUrl('/api/itinerary/migrate-days'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tripStartDate })
        });
        const preview = await response.json();
        if (!response.ok) throw new Error(preview.error || 'Migration preview failed');
        if (!preview.events.length) {
            showToast('No legacy numeric days need migration', 'info');
            return;
        }
        const unmigrated = preview.unmigratedPointIds?.length || 0;
        showConfirmation(`Create ${preview.events.length} all-day calendar visits from legacy days?${unmigrated ? ` ${unmigrated} point(s) will remain unscheduled.` : ''}`, async () => {
            const commitResponse = await fetch(buildUrl('/api/itinerary/migrate-days'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tripStartDate, commit: true })
            });
            const result = await commitResponse.json();
            if (!commitResponse.ok) throw new Error(result.error || 'Migration failed');
            calendarEvents = result.calendar || calendarEvents;
            renderCalendarMonth();
            applyFilter();
            showToast('Legacy days migrated to calendar dates', 'success');
        });
    } catch (error) {
        showToast(error.message, 'error', 1800);
    }
}

function populateCalendarLinkSelects(event = null) {
    const pointSelect = document.getElementById('calendarEventPoint');
    const taskSelect = document.getElementById('calendarEventTask');
    if (!pointSelect || !taskSelect) return;
    pointSelect.innerHTML = '<option value="">None</option>';
    points.forEach(point => {
        pointSelect.appendChild(new Option(point.name, String(point.id)));
    });
    taskSelect.innerHTML = '<option value="">None</option>';
    tasks.forEach(task => {
        taskSelect.appendChild(new Option(task.title, String(task.id)));
    });
    pointSelect.value = event?.pointId ? String(event.pointId) : '';
    taskSelect.value = event?.taskId ? String(event.taskId) : '';
}

function openCalendarEventModal(event = null) {
    if (!ensureProjectSelected()) return;
    editingCalendarEvent = event;
    const modal = document.getElementById('calendarEventModal');
    document.getElementById('calendarEventModalTitle').textContent = event ? 'Edit event' : 'Add event';
    document.getElementById('calendarEventTitle').value = event?.title || '';
    if (event) {
        document.getElementById('calendarEventDate').value = event.date || '';
    } else {
        setDatePickerAnchor('calendarEventDate', tripStartDate);
    }
    document.getElementById('calendarEventAllDay').checked = event ? event.allDay !== false : true;
    document.getElementById('calendarEventStartTime').value = event?.startTime || '';
    document.getElementById('calendarEventEndTime').value = event?.endTime || '';
    document.getElementById('calendarEventDescription').value = event?.description || '';
    document.getElementById('calendarEventColor').value = event?.color || '#1788f7';
    document.getElementById('calendarEventDelete').style.display = event ? 'block' : 'none';
    populateCalendarLinkSelects(event);
    updateCalendarTimeFields();
    modal.classList.remove('hidden');
    document.getElementById('calendarEventTitle').focus();
}

function closeCalendarEventModal() {
    document.getElementById('calendarEventModal')?.classList.add('hidden');
    editingCalendarEvent = null;
}

function updateCalendarTimeFields() {
    const allDay = document.getElementById('calendarEventAllDay')?.checked;
    document.getElementById('calendarTimeFields')?.classList.toggle('hidden', allDay);
}

async function saveCalendarEvent() {
    if (!ensureProjectSelected()) return;
    const title = document.getElementById('calendarEventTitle').value.trim();
    const date = document.getElementById('calendarEventDate').value;
    const allDay = document.getElementById('calendarEventAllDay').checked;
    if (!title || !date || (!allDay && !document.getElementById('calendarEventStartTime').value)) {
        showToast('Add a title, date, and start time for timed events', 'error', 1800);
        return;
    }
    const payload = {
        title,
        date,
        allDay,
        startTime: allDay ? null : document.getElementById('calendarEventStartTime').value,
        endTime: allDay ? null : (document.getElementById('calendarEventEndTime').value || null),
        description: document.getElementById('calendarEventDescription').value.trim(),
        color: document.getElementById('calendarEventColor').value,
        pointId: document.getElementById('calendarEventPoint').value || null,
        taskId: document.getElementById('calendarEventTask').value || null
    };
    const path = editingCalendarEvent ? `/api/calendar/${editingCalendarEvent.id}` : '/api/calendar';
    try {
        const response = await fetch(buildUrl(path), {
            method: editingCalendarEvent ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'calendar save failed');
        }
        calendarSelectedDate = date;
        calendarCursor = parseCalendarDate(date);
        closeCalendarEventModal();
        showToast(editingCalendarEvent ? 'Event updated' : 'Event added', 'success');
    } catch (error) {
        showToast(error.message || 'Could not save event', 'error', 1800);
    }
}

async function deleteCalendarEvent() {
    if (!editingCalendarEvent || !ensureProjectSelected()) return;
    try {
        const response = await fetch(buildUrl(`/api/calendar/${editingCalendarEvent.id}`), { method: 'DELETE' });
        if (!response.ok) throw new Error('delete failed');
        closeCalendarEventModal();
        showToast('Event deleted', 'success');
    } catch (error) {
        showToast('Could not delete event', 'error');
    }
}

function applyFilter() {
    let filtered;
    if (planningMode === 'legacy') {
        filtered = selectedOffset === null ? points.slice() : points.filter(point => point.day === selectedOffset);
    } else {
        filtered = selectedCalendarDateFilter ? points.filter(point => calendarEvents.some(event => event.pointId === point.id && event.date === selectedCalendarDateFilter)) : points.slice();
    }
    if (selectedCategoryFilter) {
        filtered = filtered.filter(p => normalizeCategoryId(p.categoryId) === selectedCategoryFilter);
    }
    
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

function renderCategoryFilters() {
    const container = document.getElementById('categoryFilters');
    if (!container) return;
    container.innerHTML = '';
    if (!categories.length) {
        categories = [
            { id: 'point', name: 'Point', color: '#1788f7' },
            { id: 'hotel', name: 'Hotel', color: '#ff6b6b' },
            { id: 'food', name: 'Food', color: '#f1c40f' }
        ];
    }
    if (selectedCategoryFilter && !categories.some(c => c.id === selectedCategoryFilter)) {
        selectedCategoryFilter = null;
    }
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = 'All';
    allBtn.className = 'category-chip';
    if (selectedCategoryFilter === null) {
        allBtn.classList.add('selected');
    }
    allBtn.addEventListener('click', () => {
        selectedCategoryFilter = null;
        renderCategoryFilters();
        applyFilter();
    });
    container.appendChild(allBtn);
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = cat.name;
        btn.className = 'category-chip';
        btn.style.borderColor = cat.color;
        btn.style.color = cat.color;
        btn.style.background = selectedCategoryFilter === cat.id ? `${cat.color}22` : 'transparent';
        if (selectedCategoryFilter === cat.id) {
            btn.classList.add('selected');
        }
        btn.addEventListener('click', () => {
            selectedCategoryFilter = (selectedCategoryFilter === cat.id ? null : cat.id);
            renderCategoryFilters();
            applyFilter();
        });
        container.appendChild(btn);
    });
}

function populateCategorySelects() {
    const selects = [document.getElementById('pointCategory'), document.getElementById('modalCategory')].filter(Boolean);
    if (!categories.length) {
        categories = [
            { id: 'point', name: 'Point', color: '#1788f7' },
            { id: 'hotel', name: 'Hotel', color: '#ff6b6b' },
            { id: 'food', name: 'Food', color: '#f1c40f' }
        ];
    }
    selects.forEach(select => {
        const current = normalizeCategoryId(select.value);
        select.innerHTML = '';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            if (cat.id === current) option.selected = true;
            select.appendChild(option);
        });
        if (!select.value) {
            select.value = 'point';
        }
    });
}

function renderCategorySettings() {
    const list = document.getElementById('categoryList');
    if (!list) return;
    list.innerHTML = '';
    if (!categories.length) {
        categories = [
            { id: 'point', name: 'Point', color: '#1788f7' },
            { id: 'hotel', name: 'Hotel', color: '#ff6b6b' },
            { id: 'food', name: 'Food', color: '#f1c40f' }
        ];
    }
    categories.forEach(cat => addCategoryRow(cat));
}

function addCategoryRow(category) {
    const list = document.getElementById('categoryList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'category-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.alignItems = 'center';
    row.style.marginBottom = '0.5rem';
    row.style.flexWrap = 'wrap';
    row.innerHTML = `
        <input type="hidden" class="category-id" value="${escapeHtml(category.id)}">
        <input type="text" class="input-field category-name" value="${escapeHtml(category.name)}" placeholder="Category name" style="flex:1; min-width:120px;">
        <input type="color" class="category-color" value="${escapeHtml(category.color)}" title="Category color" style="width:56px; height:44px; border:none; padding:0; background:none; cursor:pointer;">
        <button type="button" class="action-btn" style="flex:0 0 auto; width:auto; padding:0.65rem 0.9rem;">Remove</button>
    `;
    const removeBtn = row.querySelector('button');
    removeBtn.addEventListener('click', () => {
        if (list.children.length <= 1) {
            showToast('At least one category is required', 'error');
            return;
        }
        list.removeChild(row);
    });
    list.appendChild(row);
}

function syncCategoryDataFromSettings() {
    const rows = Array.from(document.querySelectorAll('#categoryList .category-row'));
    categories = rows.map(row => {
        const idInput = row.querySelector('.category-id');
        const nameInput = row.querySelector('.category-name');
        const colorInput = row.querySelector('.category-color');
        const name = nameInput ? nameInput.value.trim() : 'Point';
        const color = colorInput ? colorInput.value.trim() : '#1788f7';
        const rawId = idInput ? idInput.value.trim() : '';
        const id = rawId || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
        return { id: id || 'point', name: name || 'Point', color: color || '#1788f7' };
    }).filter(c => c.id);
}

// ============ MODAL LOGIC ============
function openModal(title) {
    document.getElementById('modalTitle').textContent = title;
    const modal = document.getElementById('pointModal');
    modal.classList.remove('hidden');

    const handleKeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // Prevent Enter from submitting if user is in textarea and holding shift
            const activeElement = document.activeElement;
            if (activeElement.tagName === 'TEXTAREA' && e.shiftKey) return;
            e.preventDefault();
            saveModalPoint();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    };

    document.addEventListener('keydown', handleKeydown);
    modal._keydownHandler = handleKeydown; // Store for cleanup
}

function closeModal() {
    const modal = document.getElementById('pointModal');
    modal.classList.add('hidden');
    if (modal._keydownHandler) {
        document.removeEventListener('keydown', modal._keydownHandler);
        modal._keydownHandler = null;
    }
    currentEditing = null;
}

function showAddModal() {
    openModal('Add Point');
    document.getElementById('modalName').value = '';
    document.getElementById('modalAddress').value = '';
    setDatePickerAnchor('modalScheduleDate', tripStartDate);
    document.getElementById('modalLegacyDay').value = '';
    document.getElementById('modalCategory').value = 'point';
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
    const linkedEvent = calendarEvents.find(event => event.pointId === point.id && event.kind === 'visit');
    let schedDate = linkedEvent?.date || '';
    let legDay = (point.day !== null && point.day !== undefined && point.day !== '') ? point.day : '';

    if (schedDate && !legDay && tripStartDate) {
        const calcDay = calculateDayFromDateString(schedDate);
        if (calcDay && calcDay >= 1) legDay = calcDay;
    } else if (legDay && !schedDate && tripStartDate) {
        const calcDate = calculateDateStringFromDay(legDay);
        if (calcDate) schedDate = calcDate;
    }

    document.getElementById('modalScheduleDate').value = schedDate;
    document.getElementById('modalLegacyDay').value = legDay;
    document.getElementById('modalCategory').value = normalizeCategoryId(point.categoryId);
    document.getElementById('modalDescription').value = point.description || '';
    document.getElementById('modalPhoto').value = point.photo || '';
    document.getElementById('modalDelete').style.display = 'inline-block';
    reverseGeocode(point.lat, point.lng).then(addr => {
        if (addr) document.getElementById('modalAddress').value = addr;
    });
}

// ============ POINT OPERATIONS ============
async function addPointFromForm() {
    if (!ensureProjectSelected()) return;
    const name = document.getElementById('pointName').value.trim();
    let address = document.getElementById('pointAddress').value.trim();
    let scheduleDate = document.getElementById('pointScheduleDate').value;
    let legacyDay = String(document.getElementById('pointLegacyDay').value || '').trim();
    const description = document.getElementById('pointDescription').value.trim();
    const photo = document.getElementById('pointPhoto').value.trim();

    // If the address field is empty, use the point name as the address
    if (!name) {
        showToast('Please enter a point name', 'error');
        return;
    }
    if (!address) {
        address = name;
    }

    if (legacyDay) {
        const dayNum = parseInt(legacyDay, 10);
        if (isNaN(dayNum) || dayNum < 1) {
            showToast('Day number must be 1 or greater.', 'error', 2500);
            return;
        }
        if (!scheduleDate && tripStartDate) {
            scheduleDate = calculateDateStringFromDay(dayNum) || '';
        }
    } else if (scheduleDate && tripStartDate) {
        const calcDay = calculateDayFromDateString(scheduleDate);
        if (calcDay && calcDay >= 1) {
            legacyDay = String(calcDay);
        }
    }

    const addBtn = document.getElementById('addPointBtn');
    addBtn.disabled = true;
    addBtn.textContent = 'Geocoding...';

    try {
        const geocoded = await geocodeAddress(address);
        if (!geocoded) {
            showToast('Could not find address. Please try a different one.', 'error');
            return;
        }

        const payload = {
            name,
            lat: geocoded.lat,
            lng: geocoded.lng,
            day: legacyDay ? parseInt(legacyDay, 10) : null,
            description,
            photo,
            categoryId: normalizeCategoryId(document.getElementById('pointCategory')?.value)
        };

        const res = await fetch(buildUrl('/api/points'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to add point');
        }
        const createdPoint = await res.json();
        await syncPointSchedule(createdPoint, scheduleDate);

        document.getElementById('pointName').value = '';
        document.getElementById('pointAddress').value = '';
        document.getElementById('pointScheduleDate').value = '';
        document.getElementById('pointLegacyDay').value = '';
        document.getElementById('pointDescription').value = '';
        document.getElementById('pointPhoto').value = '';
        syncPointEntryDefaults();
        showToast('Point added!', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Error adding point', 'error');
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = '+ Add Point';
    }
}

function removePoint(id) {
    fetch(buildUrl(`/api/points/${id}`), { method: 'DELETE' })
        .catch(err => console.error('Error removing point', err));
}

function deleteListPoint(id, name) {
    showConfirmation(`Do you want to delete this point? (${escapeHtml(name)})`, () => {
        removePoint(id);
    });
}

async function saveModalPoint() {
    if (!ensureProjectSelected()) return;
    const saveBtn = document.getElementById('modalSave');
    const name = document.getElementById('modalName').value.trim();
    let address = document.getElementById('modalAddress').value.trim();
    let scheduleDate = document.getElementById('modalScheduleDate').value;
    let legacyDay = String(document.getElementById('modalLegacyDay').value || '').trim();
    const description = document.getElementById('modalDescription').value.trim();
    const photo = document.getElementById('modalPhoto').value.trim();

    // If the address field is empty, use the point name as address
    if (!name) {
        showToast('Please enter a name', 'error');
        return;
    }
    if (!address) {
        address = name;
    }

    if (legacyDay) {
        const dayNum = parseInt(legacyDay, 10);
        if (isNaN(dayNum) || dayNum < 1) {
            showToast('Day number must be 1 or greater.', 'error', 2500);
            return;
        }
        if (!scheduleDate && tripStartDate) {
            scheduleDate = calculateDateStringFromDay(dayNum) || '';
        }
    } else if (scheduleDate && tripStartDate) {
        const calcDay = calculateDayFromDateString(scheduleDate);
        if (calcDay && calcDay >= 1) {
            legacyDay = String(calcDay);
        }
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
                showToast('Could not find address. Please try a different one.', 'error');
                return;
            }
            lat = geocoded.lat;
            lng = geocoded.lng;
        }

        const payload = {
            name,
            lat,
            lng,
            day: legacyDay ? parseInt(legacyDay, 10) : null,
            description,
            photo,
            categoryId: normalizeCategoryId(document.getElementById('modalCategory')?.value)
        };

        const method = currentEditing ? 'PUT' : 'POST';
        const url = currentEditing ? buildUrl(`/api/points/${currentEditing}`) : buildUrl('/api/points');

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || 'Save failed');
        }
        const savedPoint = currentEditing ? { id: currentEditing, name } : await res.json();
        await syncPointSchedule(savedPoint, scheduleDate);
        closeModal();
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Error saving point', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
    }
}

async function syncPointSchedule(point, scheduleDate) {
    const linked = calendarEvents.find(event => event.pointId === point.id && event.kind === 'visit');
    if (!scheduleDate && linked) {
        const response = await fetch(buildUrl(`/api/calendar/${linked.id}`), { method: 'DELETE' });
        if (!response.ok) throw new Error('Could not unschedule point');
        calendarEvents = calendarEvents.filter(event => event.id !== linked.id);
        renderCalendarMonth();
        return;
    }
    if (!scheduleDate) return;
    const payload = {
        title: point.name || 'Point visit',
        date: scheduleDate,
        allDay: true,
        kind: 'visit',
        pointId: point.id,
        color: '#1788f7'
    };
    const response = await fetch(buildUrl(linked ? `/api/calendar/${linked.id}` : '/api/calendar'), {
        method: linked ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Could not schedule point');
    const event = await response.json();
    if (linked) {
        Object.assign(linked, event);
    } else {
        calendarEvents = calendarEvents.filter(existing => existing.id !== event.id);
        calendarEvents.push(event);
    }
    calendarSelectedDate = scheduleDate;
    renderCalendarMonth();
}

function deleteModalPoint() {
    if (!currentEditing) return;
    showConfirmation('Do you wish to delete this point?', () => {
        removePoint(currentEditing);
        closeModal();
    });
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
    if (!ensureProjectSelected()) return;
    // Let the server return the actual stored file, including settings.
    window.location.href = buildUrl('/api/download/points');
    closeAllMenus();
}

function importJSON() {
    if (!ensureProjectSelected()) return;
    if (document.getElementById('importModal')?.dataset.importMode === 'calendar') {
        return importCalendarJSON();
    }
    const text = document.getElementById('importJsonText').value.trim();
    if (!text) {
        showToast('Paste some JSON', 'error');
        return;
    }
    try {
        const payload = JSON.parse(text);
        const imported = Array.isArray(payload) ? payload : payload.points;
        if (!Array.isArray(imported)) throw new Error('Expected an array of points or an exported points file');
        fetch(buildUrl('/api/import/points'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points: imported })
        }).then(async response => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.details?.join(' ') || result.error || 'Import failed');
            await reloadData();
            showToast(`Imported ${result.count} point(s)`, 'success');
            closeImportModal();
        }).catch(err => {
            console.error(err);
            showToast(err.message || 'Import failed', 'error', 2200);
        });
    } catch (err) {
        showToast('Invalid JSON', 'error');
    }
}

async function importCalendarJSON() {
    if (!ensureProjectSelected()) return;
    const text = document.getElementById('importJsonText').value.trim();
    if (!text) {
        showToast('Paste some calendar JSON', 'error');
        return;
    }
    try {
        const payload = JSON.parse(text);
        const imported = Array.isArray(payload) ? payload : payload.events;
        if (!Array.isArray(imported)) throw new Error('Expected an array of calendar events or an exported calendar file');
        const response = await fetch(buildUrl('/api/import/calendar'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: imported })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.details?.join(' ') || result.error || 'Calendar import failed');
        calendarEvents = result.events ? calendarEvents.concat(result.events) : calendarEvents;
        renderCalendarMonth();
        applyFilter();
        showToast(`Imported ${result.count} calendar event(s)`, 'success');
        closeImportModal();
    } catch (error) {
        showToast(error.message || 'Calendar import failed', 'error', 2200);
    }
}

function exportCalendar() {
    if (!ensureProjectSelected()) return;
    window.location.href = buildUrl('/api/download/calendar');
    closeAllMenus();
}

function importCalendar() {
    if (!ensureProjectSelected()) return;
    const modal = document.getElementById('importModal');
    const textarea = document.getElementById('importJsonText');
    modal.classList.remove('hidden');
    textarea.value = '';
    modal.dataset.importMode = 'calendar';
    textarea.placeholder = 'Paste an exported calendar JSON file here';
    closeAllMenus();
}

function clearAllPoints() {
    if (!ensureProjectSelected()) return;
    showConfirmation('Clear all points? This cannot be undone.', () => {
        const ids = points.map(p => p.id);
        Promise.all(ids.map(id => fetch(buildUrl(`/api/points/${id}`), { method: 'DELETE' })))
            .catch(err => console.error('Error clearing points', err));
        closeAllMenus();
    });
    closeAllMenus();
}

function clearAllTasks() {
    if (!ensureProjectSelected()) return;
    showConfirmation('Clear all tasks? This cannot be undone.', () => {
    const ids = (tasks || []).map(t => t.id);
    if (!ids.length) {
      showToast('No tasks to clear', 'info');
      closeAllMenus();
      return;
    }

    Promise.all(
            ids.map(id =>
                fetch(buildUrl(`/api/tasks/${id}`), { method: 'DELETE' })
                    .then(res => {
                        if (!res.ok) throw new Error(`/api/tasks/${id} failed: ${res.status}`);
                        return res;
                    })
            )
    )
    .then(() => {
      showToast('All tasks cleared', 'success');
      // Optionally clear local array:
      // tasks = [];
      closeAllMenus();
    })
    .catch(err => {
      console.error('Error clearing tasks', err);
      showToast('Error clearing some tasks', 'error');
      closeAllMenus();
    });
  });
}


function atoss() {
    if (!ensureProjectSelected()) return;
    if (planningMode === 'calendar') {
        showToast('Calendar mode uses calendar events. Add or import events from the Calendar tab.', 'info', 2200);
        closeAllMenus();
        return;
    }
    const scheduledPointIds = new Set(calendarEvents.filter(event => event.pointId).map(event => event.pointId));
    const unscheduled = points.filter(point => !scheduledPointIds.has(point.id));
    if (unscheduled.length === 0) {
        showToast('All points are already scheduled on the calendar.', 'info');
        closeAllMenus();
        return;
    }
    switchTab('calendar');
    calendarSelectedDate = calendarSelectedDate || tripStartDate || formatCalendarDate(new Date());
    calendarCursor = parseCalendarDate(calendarSelectedDate);
    renderCalendarMonth();
    const select = document.getElementById('itineraryPointSelect');
    if (select) {
        Array.from(select.options).forEach(option => {
            option.selected = unscheduled.some(point => String(point.id) === option.value);
        });
    }
    previewItinerary();
    closeAllMenus();
}

// ============ SETTINGS ============
function openModalSettings() {
    if (!ensureProjectSelected()) return;
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    document.getElementById('settingsMaxDays').value = maxDays;
    document.getElementById('settingsPlanningMode').value = planningMode;
    fetch(buildUrl('/api/settings')).then(response => response.json()).then(settings => {
        document.getElementById('settingsTripStartDate').value = settings.tripStartDate || '';
        tripStartDate = settings.tripStartDate || null;
        updateDatePickerAnchors();
        document.getElementById('settingsDayStartTime').value = settings.dayStartTime || '08:00';
        document.getElementById('settingsDayEndTime').value = settings.dayEndTime || '22:00';
        document.getElementById('settingsVisitMinutes').value = settings.defaultVisitMinutes || 60;
    }).catch(() => {});
    const cb = document.getElementById('settingsAutoFetch');
    if (cb) cb.checked = !!autoFetchImage;
    renderCategorySettings();
    closeAllMenus();

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveSettings();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModalSettings();
        }
    };

    document.addEventListener('keydown', handleKeydown);
    modal._keydownHandler = handleKeydown;
}

function closeModalSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    if (modal._keydownHandler) {
        document.removeEventListener('keydown', modal._keydownHandler);
        modal._keydownHandler = null;
    }
}

function clearAllCalendar() {
    if (!ensureProjectSelected()) return;
    const eventCount = calendarEvents.length;
    if (!eventCount) {
        showToast('Calendar is already empty', 'info');
        return;
    }
    showConfirmation(`Clear all ${eventCount} calendar event(s)? This cannot be undone. Points and tasks will stay.`, async () => {
        try {
            const response = await fetch(buildUrl('/api/calendar'), { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not clear calendar');
            calendarEvents = [];
            itineraryPreviewData = null;
            renderCalendarMonth();
            applyFilter();
            showToast('Calendar cleared', 'success');
        } catch (error) {
            showToast(error.message || 'Could not clear calendar', 'error', 1800);
        }
    });
}

async function saveSettings() {
    const v = parseInt(document.getElementById('settingsMaxDays').value, 10) || 7;
    const selectedPlanningMode = document.getElementById('settingsPlanningMode').value === 'legacy' ? 'legacy' : 'calendar';
    const selectedTripStartDate = document.getElementById('settingsTripStartDate').value || null;
    const dayStartTime = document.getElementById('settingsDayStartTime').value || '08:00';
    const dayEndTime = document.getElementById('settingsDayEndTime').value || '22:00';
    const defaultVisitMinutes = parseInt(document.getElementById('settingsVisitMinutes').value, 10) || 60;
    const auto = !!(document.getElementById('settingsAutoFetch') && document.getElementById('settingsAutoFetch').checked);
    const categoriesFromUI = Array.from(document.querySelectorAll('#categoryList .category-row')).map(row => {
        const nameInput = row.querySelector('.category-name');
        const colorInput = row.querySelector('.category-color');
        const idInput = row.querySelector('.category-id');
        const name = nameInput ? nameInput.value.trim() : '';
        const color = colorInput ? colorInput.value.trim() : '#1788f7';
        let id = idInput ? idInput.value.trim() : '';
        if (!id && name) {
            id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
        }
        return {
            id: id || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, ''),
            name: name || 'Point',
            color: color || '#1788f7'
        };
    }).filter(c => c.id);
    syncCategoryDataFromSettings();
    if (!categories.length) {
        categories = [{ id: 'point', name: 'Point', color: '#1788f7' }];
    }
    renderCategoryFilters();
    populateCategorySelects();
    try {
        if (selectedPlanningMode !== planningMode) {
            const switchResponse = await fetch(buildUrl('/api/planning/switch'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planningMode: selectedPlanningMode, tripStartDate: selectedTripStartDate })
            });
            const switchData = await switchResponse.json();
            if (!switchResponse.ok) throw new Error(switchData.error || 'Could not switch planning system');
            points = switchData.points || points;
            calendarEvents = switchData.events || calendarEvents;
            planningMode = selectedPlanningMode;
        }
        const response = await fetch(buildUrl('/api/settings'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planningMode: selectedPlanningMode, maxDays: v, autoFetchImage: auto, categories: categoriesFromUI, tripStartDate: selectedTripStartDate, dayStartTime, dayEndTime, defaultVisitMinutes })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not save settings');
        if (data.settings) {
            tripStartDate = data.settings.tripStartDate || null;
            setCalendarFocusDate(tripStartDate);
            if (typeof data.settings.maxDays === 'number') {
                maxDays = data.settings.maxDays;
                localStorage.setItem('maxDays', maxDays);
            }
            renderCalendar();
            renderCalendarMonth();
            applyFilter();
            planningMode = data.settings.planningMode === 'legacy' ? 'legacy' : 'calendar';
            updatePlanningModeUI();
            if (typeof data.settings.autoFetchImage !== 'undefined') {
                autoFetchImage = !!data.settings.autoFetchImage;
            }
            if (Array.isArray(data.settings.categories)) {
                categories = data.settings.categories;
                renderCategoryFilters();
                populateCategorySelects();
                renderCategorySettings();
            }
        }
        showToast('Settings saved', 'success');
        closeModalSettings();
    } catch (err) {
        console.error('saveSettings error', err);
        showToast(err.message || 'Could not save settings', 'error', 2200);
    }
}

function openImportModal() {
    if (!ensureProjectSelected()) return;
    const modal = document.getElementById('importModal');
    modal.classList.remove('hidden');
    const textarea = document.getElementById('importJsonText'); 
    textarea.value = '';
    modal.dataset.importMode = 'points';
    textarea.placeholder = 'Paste exported points JSON here';
    closeAllMenus();

    // Add "Choose file" button if not already present
    let chooseBtn = document.getElementById('importChooseFileBtn');
    if (!chooseBtn) {
      chooseBtn = document.createElement('button');
      chooseBtn.id = 'importChooseFileBtn';
      chooseBtn.type = 'button';
      chooseBtn.textContent = 'Choose file...';
      // place button next to textarea (adjust to your markup)
      textarea.parentNode.insertBefore(chooseBtn, textarea.nextSibling);
      chooseBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = ev => {
            textarea.value = ev.target.result;
            // Optionally auto-import:
            // importTasksFromJson(textarea.value);
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }

    const handleKeydown = (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            // Ctrl+Enter to import (since textarea might have multiple lines)
            importJSON();
        } else if (e.key === 'Escape') {
            closeImportModal();
        }
    };

    document.addEventListener('keydown', handleKeydown);
    modal._keydownHandler = handleKeydown;
}

function closeImportModal() {
    const modal = document.getElementById('importModal');
    modal.classList.add('hidden');
    modal.dataset.importMode = 'points';
    if (modal._keydownHandler) {
        document.removeEventListener('keydown', modal._keydownHandler);
        modal._keydownHandler = null;
    }
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
    });
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // Invalidate map size if switching from hidden state
    if (tabName === 'mapPoints' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// ============ TASK LIST FUNCTIONS ============
async function addTaskFromForm() {
    if (!ensureProjectSelected()) return;
    const title = document.getElementById('taskTitle').value.trim();
    const dueDate = document.getElementById('taskDueDate').value;

    if (!title) {
        showToast('Please enter a task title', 'error');
        return;
    }

    const payload = {
        title,
        dueDate: dueDate || null
    };

    try {
        const res = await fetch(buildUrl('/api/tasks'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to add task');

        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDueDate').value = '';
    } catch (err) {
        console.error(err);
        showToast('Error adding task', 'error');
    }
}

function removeTask(id) {
    if (!ensureProjectSelected()) return;
    fetch(buildUrl(`/api/tasks/${id}`), { method: 'DELETE' })
        .catch(err => console.error('Error removing task', err));
}

function toggleTaskComplete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const payload = { completed: !task.completed };
    fetch(buildUrl(`/api/tasks/${id}`), {
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
        btn.addEventListener('click', () => {
            showConfirmation('Do you wish to delete this task?', () => removeTask(task.id));
        });

        content.appendChild(checkbox);
        content.appendChild(info);
        li.appendChild(content);
        li.appendChild(btn);
        tasksList.appendChild(li);
    });
}

function importTasks() {
  const modal = document.getElementById('importModal');
  modal.classList.remove('hidden');
  
  const textarea = document.getElementById('importJsonText'); 
  textarea.value = '';
  closeAllMenus();

  // Get existing "Choose file" button or create it if it doesn't exist
  let chooseBtn = document.getElementById('importChooseFileBtn');
  if (!chooseBtn) {
    chooseBtn = document.createElement('button');
    chooseBtn.id = 'importChooseFileBtn';
    chooseBtn.type = 'button';
    chooseBtn.textContent = 'Choose file...';
    textarea.parentNode.insertBefore(chooseBtn, textarea.nextSibling);

    chooseBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = ev => {
          textarea.value = ev.target.result;
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  // Set up event listener for the existing "Import" button
  const importBtn = document.getElementById('importSave');
  importBtn.onclick = () => {
    handleJsonImport(textarea.value);  // Manually trigger import
  };

  // Set up event listener for the existing "Cancel" button
  const cancelBtn = document.getElementById('importCancel');
  cancelBtn.onclick = () => {
    const modal = document.getElementById('importModal');
    if (modal) modal.classList.add('hidden'); // Close modal on cancel
  };
}

function handleJsonImport(content) {
  let importedTasks;

  // Attempt to parse the JSON content
  try {
    importedTasks = JSON.parse(content);
  } catch (err) {
    console.error(err);
    return showToast('Invalid JSON format', 'error');
  }

    // Send to server
    fetch(buildUrl('/api/tasks/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(importedTasks)
  })
  .then(res => {
    if (!res.ok) throw new Error('Failed to import tasks');
    showToast('Tasks imported successfully!', 'success');
    const modal = document.getElementById('importModal');
    if (modal) modal.classList.add('hidden'); // Close modal on success
  })
  .catch(err => {
    console.error(err);
    showToast('Error importing tasks', 'error');
  });
}

function exportTasks() {
    if (!ensureProjectSelected()) return;
    // Let the server return the actual stored tasks file.
    window.location.href = buildUrl('/api/download/tasks');
    closeAllMenus();
    showToast('Tasks exported!', 'success');
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    renderCalendar();
    applyFilter();
    updateTasksList();

    // Keep the mobile viewport unit updated for the map container
    function refreshViewportHeight() {
        document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }

    // Ensure map height and Leaflet sizing behave properly on mobile/resizes
    function adjustMapHeight() {
        refreshViewportHeight();
        const header = document.querySelector('.menu');
        const mapWrapper = document.querySelector('.map-wrapper');
        const headerH = header ? header.offsetHeight : 0;
        if (!mapWrapper) return;

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            mapWrapper.style.position = 'fixed';
            mapWrapper.style.top = `${headerH}px`;
            mapWrapper.style.left = '0';
            mapWrapper.style.right = '0';
            mapWrapper.style.bottom = '0';
            mapWrapper.style.width = '100%';
            mapWrapper.style.maxWidth = '100vw';
            mapWrapper.style.minWidth = '100vw';
            mapWrapper.style.height = `${window.innerHeight - headerH}px`;
            mapWrapper.style.minHeight = `${window.innerHeight - headerH}px`;
            mapWrapper.style.overflow = 'hidden';
            mapWrapper.style.overflowX = 'hidden';
            mapWrapper.style.overflowY = 'hidden';

            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            document.body.style.maxWidth = '100vw';
        } else {
            mapWrapper.style.position = '';
            mapWrapper.style.top = '';
            mapWrapper.style.left = '';
            mapWrapper.style.right = '';
            mapWrapper.style.bottom = '';
            mapWrapper.style.width = '';
            mapWrapper.style.maxWidth = '';
            mapWrapper.style.minWidth = '';
            mapWrapper.style.height = '';
            mapWrapper.style.minHeight = '';
            mapWrapper.style.overflow = '';
            mapWrapper.style.overflowX = '';
            mapWrapper.style.overflowY = '';

            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.maxWidth = '';
        }

        if (map) {
            setTimeout(() => map.invalidateSize(true), 120);
        }
    }

    // initial adjustment
    adjustMapHeight();
    // update on resize / orientation change
    window.addEventListener('resize', adjustMapHeight);
    window.addEventListener('orientationchange', adjustMapHeight);

    // Mobile menu open/close behavior
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');

    const closeSidebar = () => {
        if (!sidebar) return;
        sidebar.classList.add('hidden-mobile');
        document.body.classList.remove('menu-open');
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.textContent = '☰';
            toggleBtn.classList.remove('open');
        }
        adjustMapHeight();
    };

    const openSidebar = () => {
        if (!sidebar) return;
        sidebar.classList.remove('hidden-mobile');
        document.body.classList.add('menu-open');
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.textContent = '×';
            toggleBtn.classList.add('open');
        }
        adjustMapHeight();
    };

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar.classList.contains('hidden-mobile')) {
                openSidebar();
            } else {
                closeSidebar();
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar && !sidebar.classList.contains('hidden-mobile')) {
            if (!sidebar.contains(e.target) && e.target !== toggleBtn) {
                closeSidebar();
            }
        }
    });

    // Global keyboard handler for menus
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault(); // Prevent browser default behavior (focus outlines, etc.)
            // Close any open menus
            if (currentOpenMenu) {
                closeAllMenus();
                return;
            }
            // Close any open modals
            const openModals = document.querySelectorAll('.modal:not(.hidden)');
            if (openModals.length > 0) {
                openModals.forEach(modal => {
                    if (modal.id === 'pointModal') closeModal();
                        else if (modal.id === 'calendarEventModal') closeCalendarEventModal();
                    else if (modal.id === 'settingsModal') closeModalSettings();
                    else if (modal.id === 'importModal') closeImportModal();
                    else if (modal.id === 'confirmationModal') hideConfirmation();
                });
                return;
            }
        }
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(btn.dataset.tab);
        });
    });

    populateRoutePointSelects();
    const routeStartSelect = document.getElementById('routeStartPoint');
    const routeEndSelect = document.getElementById('routeEndPoint');
    if (routeStartSelect) routeStartSelect.addEventListener('change', () => selectSavedRoutePoint('start', routeStartSelect.value));
    if (routeEndSelect) routeEndSelect.addEventListener('change', () => selectSavedRoutePoint('end', routeEndSelect.value));
    document.getElementById('routeStartPin')?.addEventListener('click', () => {
        routePickTarget = 'start';
        closeMobileSidebar();
        updateRouteStatus();
    });
    document.getElementById('routeEndPin')?.addEventListener('click', () => {
        routePickTarget = 'end';
        closeMobileSidebar();
        updateRouteStatus();
    });
    document.getElementById('calculateRouteBtn')?.addEventListener('click', calculateRoute);
    document.getElementById('clearRouteBtn')?.addEventListener('click', clearRoute);
    document.getElementById('routeStartSearch')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') searchRouteEndpoint('start');
    });
    document.getElementById('routeEndSearch')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') searchRouteEndpoint('end');
    });
    ['start', 'end'].forEach(target => {
        const input = document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Search`);
        let searchTimer;
        input?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            routeSearchRequestIds[target] += 1;
            if (target === 'start') routeStart = null;
            if (target === 'end') routeEnd = null;
            if (input.value.trim().length < 3) {
                document.getElementById(`route${target === 'start' ? 'Start' : 'End'}Results`)?.classList.add('hidden');
                return;
            }
            searchTimer = setTimeout(() => searchRouteEndpoint(target), 500);
        });
    });

    // Sidebar add button
    const addBtn = document.getElementById('addPointBtn');
    if (addBtn) addBtn.addEventListener('click', addPointFromForm);

    // Synchronize Date and Day inputs in sidebar
    const pointScheduleDateEl = document.getElementById('pointScheduleDate');
    const pointLegacyDayEl = document.getElementById('pointLegacyDay');
    if (pointScheduleDateEl && pointLegacyDayEl) {
        pointScheduleDateEl.addEventListener('input', () => {
            syncDateToDay(pointScheduleDateEl, pointLegacyDayEl);
        });
        pointLegacyDayEl.addEventListener('input', () => {
            syncDayToDate(pointLegacyDayEl, pointScheduleDateEl);
        });
    }

    // Synchronize Date and Day inputs in modal
    const modalScheduleDateEl = document.getElementById('modalScheduleDate');
    const modalLegacyDayEl = document.getElementById('modalLegacyDay');
    if (modalScheduleDateEl && modalLegacyDayEl) {
        modalScheduleDateEl.addEventListener('input', () => {
            syncDateToDay(modalScheduleDateEl, modalLegacyDayEl);
        });
        modalLegacyDayEl.addEventListener('input', () => {
            syncDayToDate(modalLegacyDayEl, modalScheduleDateEl);
        });
    }

    // Add keyboard support for point form
    const pointNameInput = document.getElementById('pointName');
    const pointAddressInput = document.getElementById('pointAddress');
    const pointDescriptionTextarea = document.getElementById('pointDescription');
    const pointPhotoInput = document.getElementById('pointPhoto');

    const handlePointFormKeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // Allow Shift+Enter in textarea for new lines
            if (e.target === pointDescriptionTextarea && e.shiftKey) return;
            e.preventDefault();
            addPointFromForm();
        }
    };

    if (pointNameInput) pointNameInput.addEventListener('keydown', handlePointFormKeydown);
    if (pointAddressInput) pointAddressInput.addEventListener('keydown', handlePointFormKeydown);
    if (pointScheduleDateEl) pointScheduleDateEl.addEventListener('keydown', handlePointFormKeydown);
    if (pointLegacyDayEl) pointLegacyDayEl.addEventListener('keydown', handlePointFormKeydown);
    if (pointDescriptionTextarea) pointDescriptionTextarea.addEventListener('keydown', handlePointFormKeydown);
    if (pointPhotoInput) pointPhotoInput.addEventListener('keydown', handlePointFormKeydown);

    // Task list add button
    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) addTaskBtn.addEventListener('click', addTaskFromForm);

    document.getElementById('addCalendarEventBtn')?.addEventListener('click', () => openCalendarEventModal());
    document.getElementById('calendarPrevious')?.addEventListener('click', () => {
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
        renderCalendarMonth();
        renderCalendar();
    });
    document.getElementById('calendarNext')?.addEventListener('click', () => {
        calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
        renderCalendarMonth();
        renderCalendar();
    });
    document.getElementById('calendarToday')?.addEventListener('click', () => {
        const today = new Date();
        calendarCursor = today;
        calendarSelectedDate = formatCalendarDate(today);
        calendarAgendaAllDates = false;
        selectedCalendarDateFilter = calendarSelectedDate;
        renderCalendarMonth();
        renderCalendar();
        applyFilter();
    });
    document.getElementById('calendarShowAll')?.addEventListener('click', () => {
        calendarAgendaAllDates = true;
        selectedCalendarDateFilter = null;
        renderCalendarMonth();
        renderCalendar();
        applyFilter();
    });
    document.getElementById('calendarEventAllDay')?.addEventListener('change', updateCalendarTimeFields);
    document.getElementById('calendarEventSave')?.addEventListener('click', saveCalendarEvent);
    document.getElementById('calendarEventDelete')?.addEventListener('click', deleteCalendarEvent);
    document.getElementById('calendarEventCancel')?.addEventListener('click', closeCalendarEventModal);
    document.getElementById('planItineraryBtn')?.addEventListener('click', previewItinerary);
    document.getElementById('commitItineraryBtn')?.addEventListener('click', commitItineraryPreview);

    // Add keyboard support for task form
    const taskTitleInput = document.getElementById('taskTitle');
    const taskDueDateInput = document.getElementById('taskDueDate');

    const handleTaskFormKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTaskFromForm();
        }
    };

    if (taskTitleInput) taskTitleInput.addEventListener('keydown', handleTaskFormKeydown);
    if (taskDueDateInput) taskDueDateInput.addEventListener('keydown', handleTaskFormKeydown);
    
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
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => addCategoryRow({ id: '', name: 'New Category', color: '#9b59b6' }));
    document.getElementById('clearCalendarBtn')?.addEventListener('click', clearAllCalendar);
    document.getElementById('clearPointsSettingsBtn')?.addEventListener('click', clearAllPoints);
    document.getElementById('clearTasksSettingsBtn')?.addEventListener('click', clearAllTasks);

    // Import modal
    const importSave = document.getElementById('importSave');
    const importCancel = document.getElementById('importCancel');
    if (importSave) importSave.addEventListener('click', importJSON);
    if (importCancel) importCancel.addEventListener('click', closeImportModal);

    // Menu items (from top menu bar)
    const fileMenu = document.getElementById('fileMenu');
    const openProjectManagerItem = document.getElementById('openProjectManagerItem');
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
    if (openProjectManagerItem) openProjectManagerItem.addEventListener('click', () => {
        openProjectModal(true);
        closeAllMenus();
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


    // AI Skill Pre-load
    let aiSkillContent = '';

    fetch('/AIskill.md')
      .then(res => res.text())
      .then(text => { aiSkillContent = text; })
      .catch(err => console.error('Failed to pre-load AIskill.md:', err));

    // Cross-Platform Copy Helper (Supports Mobile, Safari, and Desktop)
    async function copyToClipboard(textToCopy) {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(textToCopy);
          return true;
        } catch (err) {
          console.warn('Clipboard API failed, falling back:', err);
        }
      }

      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', '');

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, 999999);

      let success = false;
      try {
        success = document.execCommand('copy');
      } catch (err) {
        console.error('execCommand copy failed:', err);
      }

      document.body.removeChild(textArea);
      return success;
    }

    // DOM Elements
    const deleteProjectItem = document.getElementById('deleteProjectItem');
    const exportJsonItem = document.getElementById('exportJsonItem');
    const importJsonItem = document.getElementById('importJsonItem');
    const importCalendarItem = document.getElementById('importCalendarItem');
    const exportCalendarItem = document.getElementById('exportCalendarItem');
    const importTasksItem = document.getElementById('importTasksItem');
    const exportTasksItem = document.getElementById('exportTasksItem');
    const mapPointsTab = document.getElementById('mapPointsTab');
    const routePlannerTab = document.getElementById('routePlannerTab');
    const taskListTab = document.getElementById('taskListTab');
    const calendarTab = document.getElementById('calendarTab');
    const organizeDaysItem = document.getElementById('organizeDaysItem');
    const aiskillcopy = document.getElementById('aiskillcopy');
    const settingsItem = document.getElementById('settingsItem');
    const createProjectSave = document.getElementById('createProjectSave');
    const createProjectCancel = document.getElementById('createProjectCancel');

    // Event Listeners
    if (deleteProjectItem) deleteProjectItem.addEventListener('click', () => { deleteCurrentProject(); closeAllMenus(); });
    if (exportJsonItem) exportJsonItem.addEventListener('click', downloadJSON);
    if (importJsonItem) importJsonItem.addEventListener('click', openImportModal);
    if (importCalendarItem) importCalendarItem.addEventListener('click', importCalendar);
    if (exportCalendarItem) exportCalendarItem.addEventListener('click', exportCalendar);
    if (importTasksItem) importTasksItem.addEventListener('click', importTasks);
    if (exportTasksItem) exportTasksItem.addEventListener('click', exportTasks);
    if (mapPointsTab) mapPointsTab.addEventListener('click', () => { switchTab('mapPoints'); closeAllMenus(); });
    if (routePlannerTab) routePlannerTab.addEventListener('click', () => { switchTab('routePlanner'); closeAllMenus(); });
    if (taskListTab) taskListTab.addEventListener('click', () => { switchTab('taskList'); closeAllMenus(); });
    if (calendarTab) calendarTab.addEventListener('click', () => { switchTab('calendar'); closeAllMenus(); });
    if (organizeDaysItem) organizeDaysItem.addEventListener('click', atoss);

    if (aiskillcopy) {
      aiskillcopy.addEventListener('click', () => {
        if (aiSkillContent) {
          copyToClipboard(aiSkillContent);
        }
        closeAllMenus();
      });
    }

    if (settingsItem) settingsItem.addEventListener('click', openModalSettings);
    if (createProjectSave) createProjectSave.addEventListener('click', createProject);
    if (createProjectCancel) createProjectCancel.addEventListener('click', closeProjectModal);

    // Close menus when clicking elsewhere
    document.addEventListener('click', closeAllMenus);
    document.querySelectorAll('.menu-popup').forEach(f => {
      f.addEventListener('click', e => e.stopPropagation());
    });

});

window.removePoint = removePoint;