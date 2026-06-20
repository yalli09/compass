from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO  # type: ignore
import threading
import time
import json
import os
import math
from clens import get_best_image

app = Flask(__name__)
app.config['SECRET_KEY'] = 'ljgdmglhdhdbdbfbdbfdbdgpdkgp'
socketio = SocketIO(app, cors_allowed_origins='*')
JSON_DIR = os.path.join(os.path.dirname(__file__), 'json')
if not os.path.exists(JSON_DIR):
    try:
        os.makedirs(JSON_DIR)
    except Exception:
        pass

# Default files at repository root for single-project compatibility
POINTS_FILE = os.path.join(os.path.dirname(__file__), 'points.json')
TASKS_FILE = os.path.join(os.path.dirname(__file__), 'tasks.json')


def _sanitize_trip_name(name: str) -> str:
    # allow letters, numbers, hyphen and underscore
    return ''.join(c for c in (name or '') if (c.isalnum() or c in ('-', '_')))


def resolve_points_file(trip: str | None):
    if not trip:
        return POINTS_FILE
    name = _sanitize_trip_name(trip)
    return os.path.join(JSON_DIR, f"{name}-points.json")


def resolve_tasks_file(trip: str | None):
    if not trip:
        return TASKS_FILE
    name = _sanitize_trip_name(trip)
    return os.path.join(JSON_DIR, f"{name}-tasks.json")
lock = threading.Lock()

def load_points(trip: str | None = None):
    data = load_storage(trip)
    return data.get('points', [])

def save_points(points, trip: str | None = None):
    cur = load_storage(trip)
    save_storage(points, cur.get('settings'), trip)


def load_storage(trip: str | None = None):
    """Load the raw storage object from disk.

    The file may be missing, or could contain an old list of points.  We
    normalize it to a dict of the form ``{'points': [...], 'settings': {...}}``.
    """

    points_path = resolve_points_file(trip)
    if not os.path.exists(points_path):
        return {'points': [], 'settings': {'maxDays': 7, 'autoFetchImage': False}}
    with open(points_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception:
            return {'points': [], 'settings': {'maxDays': 7}}
    if isinstance(data, list):
        # legacy file containing just points
        return {'points': data, 'settings': {'maxDays': 7, 'autoFetchImage': False}}
    elif isinstance(data, dict):
        pts = data.get('points', [])
        settings = data.get('settings', {})
        # ensure default maxDays
        if 'maxDays' not in settings:
            settings['maxDays'] = 7
        # ensure default for auto-fetch image setting
        if 'autoFetchImage' not in settings:
            settings['autoFetchImage'] = False
        return {'points': pts, 'settings': settings}
    else:
        return {'points': [], 'settings': {'maxDays': 7}}


def save_storage(points, settings=None, trip: str | None = None):
    payload = {'points': points}
    if settings is not None:
        payload['settings'] = settings
    else:
        # preserve existing
        payload['settings'] = load_storage(trip).get('settings', {'maxDays': 7})
    points_path = resolve_points_file(trip)
    # ensure containing dir exists
    d = os.path.dirname(points_path)
    if d and not os.path.exists(d):
        try:
            os.makedirs(d)
        except Exception:
            pass
    with open(points_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)


def load_settings(trip: str | None = None):
    return load_storage(trip).get('settings', {'maxDays': 7})


def save_settings(settings, trip: str | None = None):
    pts = load_storage(trip).get('points', [])
    save_storage(pts, settings, trip)


def require_trip_param():
    raw = request.args.get('trip', '') or ''
    raw = raw.strip()
    if not raw:
        return None, jsonify({'error': 'trip parameter required'}), 400
    clean = _sanitize_trip_name(raw)
    if not clean or clean != raw:
        return None, jsonify({'error': 'invalid trip parameter'}), 400
    return clean, None, None


# ============ TASKS MANAGEMENT ============
def load_tasks(trip: str | None = None):
    """Load tasks from disk. Returns a list of task objects."""
    tasks_path = resolve_tasks_file(trip)
    if not os.path.exists(tasks_path):
        return []
    with open(tasks_path, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
            return data if isinstance(data, list) else []
        except Exception:
            return []


def save_tasks(tasks, trip: str | None = None):
    """Save tasks to disk."""
    tasks_path = resolve_tasks_file(trip)
    d = os.path.dirname(tasks_path)
    if d and not os.path.exists(d):
        try:
            os.makedirs(d)
        except Exception:
            pass
    with open(tasks_path, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, indent=2)


def cluster_points_by_distance(points, num_clusters):
    """Partition `points` (list of dicts with lat/lng) into at most
    ``num_clusters`` geographically coherent groups.

    This uses a simple hierarchical agglomerative algorithm: start
    with each point as its own cluster, repeatedly merge the two
    closest cluster centroids until the desired count is reached.  The
    clusters are then sorted by centroid position (lat then lng) to
    give a stable day ordering.  The function mutates ``points`` and
    assigns a ``day`` attribute beginning at 1.

    Returns the list of clusters (each cluster is a list of point
    dicts) for convenience/testing.
    """


    def _distance(a, b):
        return math.hypot(a['lat'] - b['lat'], a['lng'] - b['lng'])

    def _centroid(cluster):
        lat = sum(p['lat'] for p in cluster) / len(cluster)
        lng = sum(p['lng'] for p in cluster) / len(cluster)
        return {'lat': lat, 'lng': lng}

    # make initial singleton clusters
    clusters = [[p] for p in points]

    # only merge if we need fewer clusters than points
    if num_clusters < len(clusters):
        while len(clusters) > num_clusters:
            best_i, best_j = 0, 1
            best_dist = float('inf')
            for i in range(len(clusters)):
                for j in range(i + 1, len(clusters)):
                    d = _distance(_centroid(clusters[i]), _centroid(clusters[j]))
                    if d < best_dist:
                        best_dist = d
                        best_i, best_j = i, j
            # merge j into i
            clusters[best_i].extend(clusters[best_j])
            del clusters[best_j]

    # sort clusters lexicographically by centroid so day numbers feel
    # north-to-south/left-to-right rather than arbitrary
    clusters.sort(key=lambda c: (_centroid(c)['lat'], _centroid(c)['lng']))

    # assign sequential day numbers
    for day_index, cluster in enumerate(clusters, start=1):
        for p in cluster:
            p['day'] = day_index

    return clusters


def _euclidean_distance(a, b):
    # simple flat distance on degrees; accuracy is sufficient for small
    # neighbourhoods (our clustering radius is small).
    return ((a['lat'] - b['lat']) ** 2 + (a['lng'] - b['lng']) ** 2) ** 0.5


def propagate_day(center_point, day, points, radius=0.01):
    """Assign ``day`` to any point in ``points`` whose lat/lng is within
    ``radius`` (degrees) of ``center_point`` and that is currently
    unscheduled.  This is called when the user manually tags a point with
    a day so that nearby locations stick to the same day automatically.

    The function mutates ``points`` in-place and returns the list of
    affected points for convenience.
    """

    affected = []
    for p in points:
        if p.get('day') is None:
            if _euclidean_distance(center_point, p) <= radius:
                p['day'] = day
                affected.append(p)
    return affected


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/help')
def help_page():
    return render_template('help.html')
    
@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    """Return the global settings (currently only maxDays)."""
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    settings = load_settings(trip)
    return jsonify(settings)

@app.route('/api/settings', methods=['POST'])
def api_update_settings():
    data = request.get_json() or {}
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    settings = load_settings(trip)
    if 'maxDays' in data:
        try:
            settings['maxDays'] = int(data['maxDays'])
        except Exception:
            pass
    if 'autoFetchImage' in data:
        val = data['autoFetchImage']
        if isinstance(val, bool):
            settings['autoFetchImage'] = val
        else:
            try:
                settings['autoFetchImage'] = str(val).lower() in ('1', 'true', 'yes', 'on')
            except Exception:
                settings['autoFetchImage'] = False
    save_settings(settings, trip)
    # broadcast to all clients so their calendars update
    socketio.emit('settings_updated', {'trip': trip, 'settings': settings})
    return jsonify({'status': 'updated', 'settings': settings})

@app.route('/api/points', methods=['GET'])
def api_get_points():
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    points = load_points(trip)
    return jsonify(points)

@app.route('/api/points', methods=['POST'])
def api_add_point():
    data = request.get_json() or {}
    name = data.get('name')
    lat = data.get('lat')
    lng = data.get('lng')
    if name is None or lat is None or lng is None:
        return jsonify({'error': 'missing fields'}), 400

    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        points = load_points(trip)
        day = data.get('day')
        if day == '' or day is None:
            day = None
        else:
            try:
                day = int(day)
            except:
                day = None
        
        point = {
            'id': int(time.time() * 1000),
            'name': name,
            'lat': float(lat),
            'lng': float(lng),
            'day': day,
            'description': data.get('description', ''),
            'photo': data.get('photo', ''),
            'created': time.time()
        }
        # If photo is empty and auto-fetch is enabled for this trip, attempt to fetch
        settings = load_settings(trip)
        try:
            if (not point.get('photo')) and settings.get('autoFetchImage'):
                try:
                    img = get_best_image(point.get('name') or '')
                    if img:
                        point['photo'] = img
                except Exception:
                    # ignore errors from the image fetch
                    pass
        except Exception:
            # defensive: don't let settings lookup crash point creation
            pass

        points.append(point)
        # if the user specified a day explicitly, propagate to nearby
        # unscheduled points so clusters form around manually scheduled
        # locations rather than being left behind.
        if point['day'] is not None:
            propagate_day(point, point['day'], points)
        save_points(points, trip)

    # broadcast updated list (emit to all clients) with trip info
    socketio.emit('points_updated', {'trip': trip, 'points': points})
    return jsonify(point), 201

@app.route('/api/points/<int:pid>', methods=['DELETE'])
def api_delete_point(pid):
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        points = load_points(trip)
        new_points = [p for p in points if p.get('id') != pid]
        if len(new_points) == len(points):
            return jsonify({'error': 'not found'}), 404
        save_points(new_points, trip)

    socketio.emit('points_updated', {'trip': trip, 'points': new_points})
    return jsonify({'status': 'deleted'})


@app.route('/api/points/<int:pid>', methods=['PUT'])
def api_update_point(pid):
    data = request.get_json() or {}
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        points = load_points(trip)
        updated = False
        for p in points:
            if p.get('id') == pid:
                # allow updating name, lat, lng
                if 'name' in data:
                    p['name'] = data['name']
                if 'lat' in data:
                    p['lat'] = float(data['lat'])
                if 'lng' in data:
                    p['lng'] = float(data['lng'])
                if 'day' in data:
                    day = data['day']
                    if day == '' or day is None:
                        p['day'] = None
                    else:
                        try:
                            p['day'] = int(day)
                        except:
                            p['day'] = None
                if 'description' in data:
                    p['description'] = data['description']
                if 'photo' in data:
                    p['photo'] = data['photo']
                # If photo is blank and auto-fetch is enabled for this trip,
                # try to obtain an image automatically.
                settings = load_settings(trip)
                if (not p.get('photo')) and settings.get('autoFetchImage'):
                    try:
                        img = get_best_image(p.get('name') or '')
                        if img:
                            p['photo'] = img
                    except Exception:
                        pass
                # if the day has been set or changed to a non-null value,
                # propagate to nearby unscheduled points as above
                if 'day' in data and p.get('day') is not None:
                    propagate_day(p, p['day'], points)
                updated = True
                break
        if not updated:
            return jsonify({'error': 'not found'}), 404
        save_points(points, trip)

    socketio.emit('points_updated', {'trip': trip, 'points': points})
    return jsonify({'status': 'updated'})

@app.route('/api/organize-days', methods=['POST'])
def api_organize_days():
    """Smart clustering: group unscheduled points by distance into N clusters (N = max_days setting)."""
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        points = load_points(trip)
        unscheduled = [p for p in points if p.get('day') is None or p.get('day') == '']
        
        if not unscheduled:
            return jsonify({'status': 'all_scheduled'})
        
        # Get max days from request or default to 7
        data = request.get_json() or {}
        # override with trip-specific setting if not provided
        max_days = data.get('maxDays')
        if max_days is None:
            max_days = load_settings(trip).get('maxDays', 7)
        num_clusters = min(max_days, len(unscheduled))
        
        # run clustering helper which mutates the points in-place
        clusters = cluster_points_by_distance(unscheduled, num_clusters)
        # cluster_points_by_distance already assigns day numbers
        
        save_points(points, trip)
    socketio.emit('points_updated', {'trip': trip, 'points': points})
    return jsonify({'status': 'organized', 'clusters': num_clusters, 'points': len(unscheduled)})

# ============ TASKS API ENDPOINTS ============
@app.route('/api/tasks', methods=['GET'])
def api_get_tasks():
    """Retrieve all tasks."""
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    tasks = load_tasks(trip)
    return jsonify(tasks)

@app.route('/api/tasks', methods=['POST'])
def api_add_task():
    """Create a new task."""
    data = request.get_json() or {}
    title = data.get('title')
    
    if not title:
        return jsonify({'error': 'title is required'}), 400

    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        tasks = load_tasks(trip)
        task = {
            'id': int(time.time() * 1000),
            'title': title,
            'dueDate': data.get('dueDate'),
            'completed': False,
            'created': time.time()
        }
        tasks.append(task)
        save_tasks(tasks, trip)

    socketio.emit('tasks_updated', {'trip': trip, 'tasks': tasks})
    return jsonify(task), 201

@app.route('/api/tasks/<int:tid>', methods=['PUT'])
def api_update_task(tid):
    """Update a task."""
    data = request.get_json() or {}
    
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        tasks = load_tasks(trip)
        updated = False
        for t in tasks:
            if t.get('id') == tid:
                if 'title' in data:
                    t['title'] = data['title']
                if 'dueDate' in data:
                    t['dueDate'] = data['dueDate']
                if 'completed' in data:
                    t['completed'] = bool(data['completed'])
                updated = True
                break
        
        if not updated:
            return jsonify({'error': 'not found'}), 404
        
        save_tasks(tasks, trip)
    
    socketio.emit('tasks_updated', {'trip': trip, 'tasks': tasks})
    return jsonify({'status': 'updated'})

@app.route('/api/tasks/<int:tid>', methods=['DELETE'])
def api_delete_task(tid):
    """Delete a task."""
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    with lock:
        tasks = load_tasks(trip)
        new_tasks = [t for t in tasks if t.get('id') != tid]
        
        if len(new_tasks) == len(tasks):
            return jsonify({'error': 'not found'}), 404
        
        save_tasks(new_tasks, trip)
    
    socketio.emit('tasks_updated', {'trip': trip, 'tasks': new_tasks})
    return jsonify({'status': 'deleted'})

@app.route('/api/tasks/import', methods=['POST'])
def api_import_tasks():
    """Import a list of tasks."""
    trip, error_resp, status = require_trip_param()
    if error_resp:
        return error_resp, status
    imported_tasks = request.get_json() or []
    
    if not isinstance(imported_tasks, list):
        return jsonify({'error': 'invalid format, expected a list of tasks'}), 400

    with lock:
        tasks = load_tasks(trip)
        new_tasks = []
        for task_data in imported_tasks:
            title = task_data.get('title')
            if not title:
                continue # Skip tasks without a title

            task = {
                'id': int(time.time() * 1000) + len(new_tasks), # Simple unique ID
                'title': title,
                'dueDate': task_data.get('dueDate'),
                'completed': task_data.get('completed', False),
                'created': task_data.get('created', time.time())
            }
            new_tasks.append(task)
        
        tasks.extend(new_tasks)
        save_tasks(tasks, trip)
    
    socketio.emit('tasks_updated', {'trip': trip, 'tasks': tasks})
    return jsonify({'status': 'imported', 'count': len(new_tasks)}), 201


@app.route('/api/trips', methods=['GET'])
def api_list_trips():
    """List available trips by scanning the `json/` folder for *-points.json files."""
    trips = []
    try:
        if os.path.exists(JSON_DIR):
            for fn in os.listdir(JSON_DIR):
                if fn.endswith('-points.json'):
                    name = fn[:-len('-points.json')]
                    path = os.path.join(JSON_DIR, fn)
                    mtime = os.path.getmtime(path)
                    trips.append({'name': name, 'modified': mtime})
    except Exception:
        pass
    return jsonify(trips)


@app.route('/api/trips', methods=['POST'])
def api_create_trip():
    data = request.get_json() or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'name required'}), 400
    clean = _sanitize_trip_name(name)
    if not clean:
        return jsonify({'error': 'invalid name'}), 400
    points_path = resolve_points_file(clean)
    tasks_path = resolve_tasks_file(clean)
    # create empty files if not exist
    try:
        if not os.path.exists(points_path):
            with open(points_path, 'w', encoding='utf-8') as f:
                json.dump({'points': [] , 'settings': {'maxDays': 7, 'autoFetchImage': False}}, f, indent=2)
        if not os.path.exists(tasks_path):
            with open(tasks_path, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2)
    except Exception as e:
        return jsonify({'error': 'could not create files', 'detail': str(e)}), 500
    return jsonify({'status': 'created', 'name': clean}), 201


@app.route('/api/trips/<trip_name>', methods=['DELETE'])
def api_delete_trip(trip_name):
    clean = _sanitize_trip_name(trip_name)
    if not clean:
        return jsonify({'error': 'invalid name'}), 400
    points_path = resolve_points_file(clean)
    tasks_path = resolve_tasks_file(clean)
    errors = []
    try:
        if os.path.exists(points_path):
            os.remove(points_path)
    except Exception as e:
        errors.append(str(e))
    try:
        if os.path.exists(tasks_path):
            os.remove(tasks_path)
    except Exception as e:
        errors.append(str(e))
    if errors:
        return jsonify({'error': 'failed', 'detail': errors}), 500
    return jsonify({'status': 'deleted', 'name': clean})

@socketio.on('connect')
def handle_connect():
    # send current points and tasks to newly connected client
    points = load_points()
    tasks = load_tasks()
    socketio.emit('points_updated', {'trip': None, 'points': points})
    socketio.emit('tasks_updated', {'trip': None, 'tasks': tasks})

if __name__ == '__main__':
    # Use socketio.run for real-time support
    # For production: debug=False, allow_unsafe_werkzeug=True for compatibility
    debug_mode = os.environ.get('FLASK_ENV', 'production') == 'development'
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=5030, allow_unsafe_werkzeug=True)
