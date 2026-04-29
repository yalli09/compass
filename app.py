from flask import Flask, render_template, jsonify, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room  # type: ignore
import threading
import time
import json
import os
import math
import uuid
from llm_model import query_llm

app = Flask(__name__)
app.config['SECRET_KEY'] = 'ljgdmglhdhdbdbfbdbfdbdgpdkgp'
socketio = SocketIO(app, cors_allowed_origins='*')

# Session-based chat history storage (in-memory)
# Format: {session_id: [{"role": "user|assistant", "content": "..."}, ...]}
chat_sessions = {}

POINTS_FILE = os.path.join(os.path.dirname(__file__), 'points.json')
TASKS_FILE = os.path.join(os.path.dirname(__file__), 'tasks.json')
lock = threading.Lock()

def load_points():
    data = load_storage()
    return data.get('points', [])

def save_points(points):
    cur = load_storage()
    save_storage(points, cur.get('settings'))


def load_storage():
    """Load the raw storage object from disk.

    The file may be missing, or could contain an old list of points.  We
    normalize it to a dict of the form ``{'points': [...], 'settings': {...}}``.
    """

    if not os.path.exists(POINTS_FILE):
        return {'points': [], 'settings': {'maxDays': 7}}
    with open(POINTS_FILE, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception:
            return {'points': [], 'settings': {'maxDays': 7}}
    if isinstance(data, list):
        # legacy file containing just points
        return {'points': data, 'settings': {'maxDays': 7}}
    elif isinstance(data, dict):
        pts = data.get('points', [])
        settings = data.get('settings', {})
        # ensure default maxDays
        if 'maxDays' not in settings:
            settings['maxDays'] = 7
        return {'points': pts, 'settings': settings}
    else:
        return {'points': [], 'settings': {'maxDays': 7}}


def save_storage(points, settings=None):
    payload = {'points': points}
    if settings is not None:
        payload['settings'] = settings
    else:
        # preserve existing
        payload['settings'] = load_storage().get('settings', {'maxDays': 7})
    with open(POINTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)


def load_settings():
    return load_storage().get('settings', {'maxDays': 7})


def save_settings(settings):
    pts = load_storage().get('points', [])
    save_storage(pts, settings)


# ============ TASKS MANAGEMENT ============
def load_tasks():
    """Load tasks from disk. Returns a list of task objects."""
    if not os.path.exists(TASKS_FILE):
        return []
    with open(TASKS_FILE, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
            return data if isinstance(data, list) else []
        except Exception:
            return []


def save_tasks(tasks):
    """Save tasks to disk."""
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, indent=2)


def _distance(a, b):
    return math.hypot(a['lat'] - b['lat'], a['lng'] - b['lng'])


def _centroid(cluster):
    lat = sum(p['lat'] for p in cluster) / len(cluster)
    lng = sum(p['lng'] for p in cluster) / len(cluster)
    return {'lat': lat, 'lng': lng}


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


def _normalize_intensity(value):
    if value is None:
        return 'medium'
    text = str(value).strip().lower()
    if text in ('low', 'l'):
        return 'low'
    if text in ('high', 'h'):
        return 'high'
    return 'medium'


def _cluster_radius(cluster):
    if len(cluster) <= 1:
        return 0.0
    center = _centroid(cluster)
    return max(_distance(p, center) for p in cluster)


def score_day_cluster(cluster):
    if not cluster:
        return {
            'score': 0,
            'geographic': 1,
            'variety': 1,
            'energy': 1,
            'timing': 1,
            'memorability': 1,
            'anchor': False,
            'activity_types': [],
            'dominant_activity_type': 'unknown',
            'day_type': 'easy'
        }

    activity_types = [str(p.get('activity_type') or 'other').strip().lower() for p in cluster]
    unique_types = set(activity_types)
    variety = min(max(len(unique_types), 1), 5)
    variety_score = variety

    intensities = [_normalize_intensity(p.get('intensity')) for p in cluster]
    high_count = intensities.count('high')
    low_count = intensities.count('low')
    if high_count > 0 and low_count > 0:
        energy_score = 5
    elif low_count >= len(cluster) * 0.6:
        energy_score = 3
    elif high_count >= len(cluster) * 0.6:
        energy_score = 4
    else:
        energy_score = 4

    anchor = any(str(p.get('anchor')).lower() in ('true', '1', 'yes') for p in cluster)
    memorability_score = 5 if anchor else 2

    radius = _cluster_radius(cluster)
    if radius <= 0.005:
        geographic_score = 5
    elif radius <= 0.015:
        geographic_score = 4
    elif radius <= 0.03:
        geographic_score = 3
    else:
        geographic_score = 2

    timing_score = 5
    base = (
        geographic_score * 0.25 +
        variety_score * 0.2 +
        energy_score * 0.2 +
        timing_score * 0.2 +
        memorability_score * 0.15
    )
    score = int(round(base * 20))
    score = max(0, min(score, 100))

    dominant_type = max(unique_types, key=lambda t: activity_types.count(t)) if unique_types else 'other'

    if anchor:
        day_type = 'peak'
    elif low_count >= len(cluster) * 0.6:
        day_type = 'rest'
    elif high_count >= len(cluster) * 0.6:
        day_type = 'build'
    elif variety >= 3:
        day_type = 'easy'
    else:
        day_type = 'easy'

    return {
        'score': score,
        'geographic': geographic_score,
        'variety': variety_score,
        'energy': energy_score,
        'timing': timing_score,
        'memorability': memorability_score,
        'anchor': anchor,
        'activity_types': sorted(unique_types),
        'dominant_activity_type': dominant_type,
        'day_type': day_type,
        'point_count': len(cluster),
        'spontaneity_hours': 2
    }


def sort_clusters_for_trip(clusters):
    priority = {'easy': 0, 'build': 1, 'rest': 2, 'peak': 3, 'winddown': 4}
    scored_clusters = [(cluster, score_day_cluster(cluster)) for cluster in clusters]
    scored_clusters.sort(key=lambda item: (priority.get(item[1]['day_type'], 0), -item[1]['score']))
    return [cluster for cluster, _summary in scored_clusters]


def create_day_plan(cluster, day_number):
    summary = score_day_cluster(cluster)
    return {
        'day': day_number,
        'points': [p for p in cluster],
        'score': summary['score'],
        'day_type': summary['day_type'],
        'anchor': summary['anchor'],
        'activity_types': summary['activity_types'],
        'dominant_activity_type': summary['dominant_activity_type'],
        'point_count': summary['point_count'],
        'spontaneity_hours': summary['spontaneity_hours']
    }


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
    settings = load_settings()
    return jsonify(settings)

@app.route('/api/settings', methods=['POST'])
def api_update_settings():
    data = request.get_json() or {}
    settings = load_settings()
    if 'maxDays' in data:
        try:
            settings['maxDays'] = int(data['maxDays'])
        except Exception:
            pass
    save_settings(settings)
    # broadcast to all clients so their calendars update
    socketio.emit('settings_updated', settings)
    return jsonify({'status': 'updated', 'settings': settings})

@app.route('/api/points', methods=['GET'])
def api_get_points():
    points = load_points()
    return jsonify(points)

@app.route('/api/points', methods=['POST'])
def api_add_point():
    data = request.get_json() or {}
    name = data.get('name')
    lat = data.get('lat')
    lng = data.get('lng')
    if name is None or lat is None or lng is None:
        return jsonify({'error': 'missing fields'}), 400

    with lock:
        points = load_points()
        day = data.get('day')
        if day == '' or day is None:
            day = None
        else:
            try:
                day = int(day)
            except:
                day = None
        
        anchor_value = data.get('anchor')
        if isinstance(anchor_value, str):
            anchor = anchor_value.strip().lower() in ('true', '1', 'yes', 'on')
        else:
            anchor = bool(anchor_value)

        point = {
            'id': int(time.time() * 1000),
            'name': name,
            'lat': float(lat),
            'lng': float(lng),
            'day': day,
            'activity_type': data.get('activity_type'),
            'intensity': data.get('intensity'),
            'duration': int(data.get('duration')) if data.get('duration') is not None and data.get('duration') != '' else None,
            'anchor': anchor,
            'description': data.get('description', ''),
            'photo': data.get('photo', ''),
            'created': time.time()
        }
        points.append(point)
        # if the user specified a day explicitly, propagate to nearby
        # unscheduled points so clusters form around manually scheduled
        # locations rather than being left behind.
        if point['day'] is not None:
            propagate_day(point, point['day'], points)
        save_points(points)

    # broadcast updated list (emit to all clients)
    socketio.emit('points_updated', points)
    return jsonify(point), 201

@app.route('/api/points/<int:pid>', methods=['DELETE'])
def api_delete_point(pid):
    with lock:
        points = load_points()
        new_points = [p for p in points if p.get('id') != pid]
        if len(new_points) == len(points):
            return jsonify({'error': 'not found'}), 404
        save_points(new_points)

    socketio.emit('points_updated', new_points)
    return jsonify({'status': 'deleted'})


@app.route('/api/points/<int:pid>', methods=['PUT'])
def api_update_point(pid):
    data = request.get_json() or {}
    with lock:
        points = load_points()
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
                if 'activity_type' in data:
                    p['activity_type'] = data['activity_type']
                if 'intensity' in data:
                    p['intensity'] = data['intensity']
                if 'duration' in data:
                    duration = data['duration']
                    if duration == '' or duration is None:
                        p['duration'] = None
                    else:
                        try:
                            p['duration'] = int(duration)
                        except:
                            p['duration'] = None
                if 'anchor' in data:
                    anchor_value = data['anchor']
                    if isinstance(anchor_value, str):
                        p['anchor'] = anchor_value.strip().lower() in ('true', '1', 'yes', 'on')
                    else:
                        p['anchor'] = bool(anchor_value)
                if 'description' in data:
                    p['description'] = data['description']
                if 'photo' in data:
                    p['photo'] = data['photo']
                # if the day has been set or changed to a non-null value,
                # propagate to nearby unscheduled points as above
                if 'day' in data and p.get('day') is not None:
                    propagate_day(p, p['day'], points)
                updated = True
                break
        if not updated:
            return jsonify({'error': 'not found'}), 404
        save_points(points)

    socketio.emit('points_updated', points)
    return jsonify({'status': 'updated'})

@app.route('/api/organize-days', methods=['POST'])
def api_organize_days():
    """Smart clustering: group unscheduled points by distance into N clusters (N = max_days setting)."""
    with lock:
        points = load_points()
        unscheduled = [p for p in points if p.get('day') is None or p.get('day') == '']
        
        if not unscheduled:
            return jsonify({'status': 'all_scheduled'})
        
        data = request.get_json() or {}
        max_days = data.get('maxDays')
        if max_days is None:
            max_days = load_settings().get('maxDays', 7)
        num_clusters = min(max_days, len(unscheduled))
        
        clusters = cluster_points_by_distance(unscheduled, num_clusters)
        for cluster in clusters:
            cluster.sort(key=lambda p: (p.get('name') or '').lower())
        sorted_clusters = sort_clusters_for_trip(clusters)
        for day_index, cluster in enumerate(sorted_clusters, start=1):
            for p in cluster:
                p['day'] = day_index
        save_points(points)

        day_plans = [create_day_plan(cluster, index + 1) for index, cluster in enumerate(sorted_clusters)]
    socketio.emit('points_updated', points)
    return jsonify({'status': 'organized', 'clusters': num_clusters, 'points': len(unscheduled), 'dayPlans': day_plans})


@app.route('/api/day-plans', methods=['GET'])
def api_day_plans():
    points = load_points()
    days = {}
    for p in points:
        day = p.get('day')
        if day is None or day == '':
            continue
        days.setdefault(int(day), []).append(p)
    day_plans = []
    for day in sorted(days):
        day_plans.append(create_day_plan(days[day], day))
    unscheduled_count = len([p for p in points if p.get('day') is None or p.get('day') == ''])
    return jsonify({'dayPlans': day_plans, 'unscheduled': unscheduled_count})

# ============ TASKS API ENDPOINTS ============
@app.route('/api/tasks', methods=['GET'])
def api_get_tasks():
    """Retrieve all tasks."""
    tasks = load_tasks()
    return jsonify(tasks)

@app.route('/api/tasks', methods=['POST'])
def api_add_task():
    """Create a new task."""
    data = request.get_json() or {}
    title = data.get('title')
    
    if not title:
        return jsonify({'error': 'title is required'}), 400
    
    with lock:
        tasks = load_tasks()
        task = {
            'id': int(time.time() * 1000),
            'title': title,
            'dueDate': data.get('dueDate'),
            'completed': False,
            'created': time.time()
        }
        tasks.append(task)
        save_tasks(tasks)
    
    socketio.emit('tasks_updated', tasks)
    return jsonify(task), 201

@app.route('/api/tasks/<int:tid>', methods=['PUT'])
def api_update_task(tid):
    """Update a task."""
    data = request.get_json() or {}
    
    with lock:
        tasks = load_tasks()
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
        
        save_tasks(tasks)
    
    socketio.emit('tasks_updated', tasks)
    return jsonify({'status': 'updated'})

@app.route('/api/tasks/<int:tid>', methods=['DELETE'])
def api_delete_task(tid):
    """Delete a task."""
    with lock:
        tasks = load_tasks()
        new_tasks = [t for t in tasks if t.get('id') != tid]
        
        if len(new_tasks) == len(tasks):
            return jsonify({'error': 'not found'}), 404
        
        save_tasks(new_tasks)
    
    socketio.emit('tasks_updated', new_tasks)
    return jsonify({'status': 'deleted'})

@app.route('/api/tasks/import', methods=['POST'])
def api_import_tasks():
    """Import a list of tasks."""
    imported_tasks = request.get_json() or []
    
    if not isinstance(imported_tasks, list):
        return jsonify({'error': 'invalid format, expected a list of tasks'}), 400

    with lock:
        tasks = load_tasks()
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
        save_tasks(tasks)
    
    socketio.emit('tasks_updated', tasks)
    return jsonify({'status': 'imported', 'count': len(new_tasks)}), 201

@socketio.on('connect')
def handle_connect():
    # Generate a unique session ID for this connection
    session_id = str(uuid.uuid4())
    chat_sessions[session_id] = []
    emit('session_id', {'session_id': session_id})
    
    # send current points and tasks to newly connected client
    points = load_points()
    tasks = load_tasks()
    socketio.emit('points_updated', points)
    socketio.emit('tasks_updated', tasks)


@socketio.on('chat_message')
def handle_chat_message(data):
    """Handle incoming chat messages from the client."""
    session_id = data.get('session_id')
    user_message = data.get('message', '').strip()
    
    if not session_id or not user_message:
        emit('error', {'message': 'Invalid session or message'})
        return
    
    # Initialize session if not exists
    if session_id not in chat_sessions:
        chat_sessions[session_id] = []
    
    # Add user message to history
    chat_sessions[session_id].append({
        'role': 'user',
        'content': user_message
    })
    
    # Emit the user message to the client
    emit('chat_response', {
        'role': 'user',
        'content': user_message
    }, broadcast=False)
    
    # Build context from chat history
    context_messages = []
    for msg in chat_sessions[session_id][:-1]:  # Exclude the latest user message
        if msg['role'] == 'assistant':
            context_messages.append(f"Previous assistant response: {msg['content']}")
    
    context = "\n".join(context_messages) if context_messages else None
    
    try:
        # Query the LLM
        assistant_response = query_llm(user_message, context=context)
        
        # Add assistant response to history
        chat_sessions[session_id].append({
            'role': 'assistant',
            'content': assistant_response
        })
        
        # Emit the assistant response to the client
        emit('chat_response', {
            'role': 'assistant',
            'content': assistant_response
        }, broadcast=False)
        
    except Exception as e:
        error_message = f"Error querying LLM: {str(e)}"
        emit('error', {'message': error_message})


@socketio.on('disconnect')
def handle_disconnect():
    """Clean up when a client disconnects."""
    # Note: session cleanup could happen here if needed
    pass

if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_ENV', 'production') == 'development'
    socketio.run(app, debug=debug_mode, host='0.0.0.0', port=5030, allow_unsafe_werkzeug=True)
