import os
import requests
from flask import Flask, render_template, request, redirect, url_for, jsonify, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_bcrypt import Bcrypt
from sqlalchemy.orm import joinedload

# --- APP CONFIGURATION ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a_very_secret_key_needs_to_be_set_properly') # Use environment variable
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- INITIALIZE EXTENSIONS ---
db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

# --- CONSTANTS ---
RATE_PER_KM = 15.0

# --- DATABASE MODELS ---

class User(db.Model, UserMixin):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), nullable=False, unique=True)
    password = db.Column(db.String(150), nullable=False)
    role = db.Column(db.String(50), nullable=False)
    # FUTURE: Add owner_id FK for drivers

class Load(db.Model):
    __tablename__ = 'load'
    id = db.Column(db.Integer, primary_key=True)
    origin = db.Column(db.String(150), nullable=False)
    destination = db.Column(db.String(150), nullable=False)
    load_type = db.Column(db.String(100))
    weight = db.Column(db.Float)
    expected_date = db.Column(db.String(50))
    status = db.Column(db.String(50), default='pending') # pending, requested, assigned, intransit, delivered, canceled
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    driver_lat = db.Column(db.Float, nullable=True)
    driver_lng = db.Column(db.Float, nullable=True)
    price = db.Column(db.Float, nullable=True)
    # --- ADDED PAYMENT STATUS ---
    payment_status = db.Column(db.String(50), default='unpaid') # unpaid, paid, processing, failed

    # Relationships
    sender = db.relationship('User', foreign_keys=[sender_id], backref='loads_sent')
    driver = db.relationship('User', foreign_keys=[driver_id], backref='loads_driven')

class LoadRequest(db.Model):
    __tablename__ = 'load_request'
    id = db.Column(db.Integer, primary_key=True)
    load_id = db.Column(db.Integer, db.ForeignKey('load.id'), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(50), default='pending')

    load = db.relationship('Load', backref=db.backref('requests', lazy='dynamic'))
    driver = db.relationship('User', backref=db.backref('load_requests', lazy=True))


# --- FLASK-LOGIN SETUP ---
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# --- HELPER FUNCTIONS ---
def get_coordinates(address):
    headers = {'User-Agent': 'UTI_Logistics_Project/1.0 (your_email@example.com)'} # <<< CHANGE EMAIL
    geocode_url = f"https://nominatim.openstreetmap.org/search?q={requests.utils.quote(address)}, India&format=json&limit=1"
    try:
        response = requests.get(geocode_url, headers=headers, timeout=10); response.raise_for_status()
        data = response.json(); return float(data[0]['lon']), float(data[0]['lat']) if data else (None, None)
    except Exception as e: print(f"ERROR: Geocoding {address}: {e}"); return None, None

def get_route_distance(lon1, lat1, lon2, lat2):
    route_url = f"http://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
    try:
        response = requests.get(route_url, timeout=15); response.raise_for_status()
        data = response.json(); return data['routes'][0]['distance'] / 1000.0 if data.get('code') == 'Ok' else None
    except Exception as e: print(f"ERROR: OSRM Routing: {e}"); return None

STATE_DOCUMENTS_EXAMPLE = { 'DEFAULT': ['e-Way Bill', 'PUC'], 'DELHI': ['Permit'], 'UTTAR PRADESH': ['Form 38/39'] } # Simplified
def get_example_documents(origin, destination):
    origin_key = origin.split(',')[-1].strip().upper() if ',' in origin else origin.strip().upper()
    dest_key = destination.split(',')[-1].strip().upper() if ',' in destination else destination.strip().upper()
    docs = set(STATE_DOCUMENTS_EXAMPLE.get('DEFAULT', [])); docs.update(STATE_DOCUMENTS_EXAMPLE.get(origin_key, [])); docs.update(STATE_DOCUMENTS_EXAMPLE.get(dest_key, []))
    return sorted(list(docs))

# --- BASIC PAGE ROUTES ---
@app.route('/')
def home(): return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        if current_user.role == 'driver': return redirect(url_for('driver_dashboard'))
        if current_user.role == 'sender': return redirect(url_for('sender_dashboard'))
        if current_user.role == 'truck_owner': return redirect(url_for('truck_owner_dashboard'))
        if current_user.role == 'receiver': return redirect(url_for('receiver_dashboard')) # Added receiver
        return redirect(url_for('home'))
    if request.method == 'POST':
        username = request.form.get('username'); password = request.form.get('password')
        print(f"--- Attempting login: '{username}' ---")
        user = User.query.filter_by(username=username).first()
        if user and bcrypt.check_password_hash(user.password, password):
            login_user(user); flash(f'Welcome back, {username}!', 'success')
            print(f"Login SUCCESS: '{username}' ({user.role})")
            if user.role == 'driver': return redirect(url_for('driver_dashboard'))
            if user.role == 'sender': return redirect(url_for('sender_dashboard'))
            if user.role == 'truck_owner': return redirect(url_for('truck_owner_dashboard'))
            if user.role == 'receiver': return redirect(url_for('receiver_dashboard')) # Added receiver
            return redirect(url_for('home'))
        else:
            flash('Invalid username or password.', 'danger'); print(f"Login FAILED: '{username}'")
            return render_template('login.html')
    return render_template('login.html')

@app.route('/register_page')
def register_page(): return render_template('register.html')

@app.route('/register', methods=['POST'])
def register():
    if current_user.is_authenticated: flash('Log out to register.'); return redirect(url_for('home'))
    username = request.form.get('username'); password = request.form.get('password'); role = request.form.get('role')
    if not username or not password or not role: flash('All fields required.'); return render_template('register.html', username=username, role=role)
    if role not in ['driver', 'sender', 'truck_owner', 'receiver']: flash('Invalid role.'); return render_template('register.html', username=username, role=role)
    if User.query.filter_by(username=username).first(): flash('Username exists.'); return render_template('register.html', username=username, role=role)
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password=hashed_password, role=role)
    try:
        db.session.add(new_user); db.session.commit(); print(f"User '{username}' registered ({role})."); flash('Registered! Please log in.'); return redirect(url_for('login'))
    except Exception as e: db.session.rollback(); print(f"ERROR: Registering '{username}': {e}"); flash('Server error during registration.'); return render_template('register.html', username=username, role=role)

@app.route('/logout')
@login_required
def logout(): logout_user(); flash('Logged out.'); return redirect(url_for('home'))

@app.route('/contact')
def contact(): return render_template('contact.html')

# --- DASHBOARD ROUTES ---
@app.route('/driver_dashboard')
@login_required
def driver_dashboard():
    if current_user.role not in ['driver', 'truck_owner']: flash('Access denied.'); return redirect(url_for('home'))
    return render_template('driver.html')

@app.route('/sender_dashboard')
@login_required
def sender_dashboard():
    if current_user.role != 'sender': flash('Access denied.'); return redirect(url_for('home'))
    return render_template('sender.html')

@app.route('/truck_owner_dashboard')
@login_required
def truck_owner_dashboard():
    if current_user.role != 'truck_owner': flash('Access denied.'); return redirect(url_for('home'))
    return render_template('truck_owner.html')

# --- RECEIVER DASHBOARD ROUTE ---
@app.route('/receiver_dashboard')
@login_required
def receiver_dashboard():
    """Serves the receiver dashboard."""
    if current_user.role != 'receiver':
         flash('Access denied. Only receivers can view this page.', 'warning')
         return redirect(url_for('home'))
    # Assumes you create templates/receiver.html
    return render_template('receiver.html')
# --- END RECEIVER DASHBOARD ROUTE ---

# --- FEATURE ROUTES ---
@app.route('/load_matching')
@login_required
def load_matching():
    if current_user.role not in ['driver', 'truck_owner']: flash('Access denied.'); return redirect(url_for('home'))
    return render_template('load.html')

@app.route('/smart_route')
@login_required
def smart_route():
    if current_user.role not in ['driver', 'truck_owner']: flash('Access denied.'); return redirect(url_for('home'))
    return render_template('route.html')

# --- API ENDPOINTS ---

@app.route('/api/post_load', methods=['POST'])
@login_required
def api_post_load():
    if current_user.role != 'sender': return jsonify({'error': 'Unauthorized'}), 403
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); required = ['origin', 'destination', 'load_type', 'weight', 'expected_date']
    if not all(field in data and data[field] for field in required): return jsonify({'error': 'Missing fields'}), 400
    try: weight = float(data['weight'])
    except: return jsonify({'error': 'Invalid weight'}), 400
    origin_lon, origin_lat = get_coordinates(data['origin']); dest_lon, dest_lat = get_coordinates(data['destination'])
    calculated_price = None
    if origin_lon is not None and dest_lon is not None:
        distance_km = get_route_distance(origin_lon, origin_lat, dest_lon, dest_lat)
        if distance_km is not None: calculated_price = round(distance_km * RATE_PER_KM, 2)
    # --- Set payment_status on creation ---
    new_load = Load( origin=data['origin'], destination=data['destination'], load_type=data['load_type'], weight=weight, expected_date=data['expected_date'], sender_id=current_user.id, status='pending', price=calculated_price, payment_status='unpaid' )
    try: db.session.add(new_load); db.session.commit(); return jsonify({'message': 'Load posted!', 'ref_number': f"UTI-{new_load.id}", 'estimated_price': calculated_price }), 201
    except Exception as e: db.session.rollback(); print(f"ERROR: Saving load: {e}"); return jsonify({'error': 'DB error'}), 500

@app.route('/api/get_loads', methods=['GET'])
@login_required
def api_get_loads():
    # ... (Keep as is) ...
    if current_user.role not in ['driver', 'truck_owner']: return jsonify({'error': 'Unauthorized'}), 403
    search_date = request.args.get('date')
    try:
        base_query = Load.query.filter_by(status='pending')
        if not search_date: all_loads = base_query.order_by(Load.expected_date.desc(), Load.id.desc()).all(); exact_matches = []; other_loads = all_loads
        else: exact_matches = base_query.filter_by(expected_date=search_date).order_by(Load.id.desc()).all(); other_loads = base_query.filter(Load.expected_date != search_date).order_by(Load.expected_date.desc(), Load.id.desc()).all()
        def serialize_loads(loads): return [{'id': l.id, 'origin': l.origin, 'destination': l.destination,'load_type': l.load_type, 'weight': l.weight, 'expected_date': l.expected_date,'price': l.price, 'documents': get_example_documents(l.origin, l.destination)} for l in loads]
        return jsonify({'exact_matches': serialize_loads(exact_matches), 'other_loads': serialize_loads(other_loads)})
    except Exception as e: print(f"ERROR: Fetching loads: {e}"); return jsonify({'error': 'Failed to fetch loads'}), 500


@app.route('/api/request_load', methods=['POST'])
@login_required
def api_request_load():
    # ... (Keep as is) ...
    if current_user.role not in ['driver', 'truck_owner']: return jsonify({'error': 'Unauthorized'}), 403
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); load_id = data.get('load_id');
    if load_id is None: return jsonify({'error': 'Missing load_id'}), 400
    load = db.session.get(Load, load_id)
    if not load: return jsonify({'error': 'Load not found'}), 404
    if load.status != 'pending': return jsonify({'error': 'Load not available'}), 400
    if load.sender_id == current_user.id: return jsonify({'error': 'Cannot request own load'}), 403
    if LoadRequest.query.filter_by(load_id=load_id, driver_id=current_user.id).first(): return jsonify({'error': 'Already requested'}), 400
    try: new_request = LoadRequest(load_id=load_id, driver_id=current_user.id, status='pending'); db.session.add(new_request); load.status = 'requested'; db.session.commit(); return jsonify({'success': True, 'message': 'Request submitted'})
    except Exception as e: db.session.rollback(); print(f"ERROR: Creating request: {e}"); return jsonify({'error': 'DB error'}), 500


@app.route('/api/get_sender_requests', methods=['GET'])
@login_required
def api_get_sender_requests():
    # ... (Keep as is) ...
    if current_user.role != 'sender': return jsonify({'error': 'Unauthorized'}), 403
    try:
        loads = Load.query.filter_by(sender_id=current_user.id, status='requested').order_by(Load.id.desc()).all(); requests_list = []
        for load in loads:
            reqs = load.requests.filter_by(status='pending').options(joinedload(LoadRequest.driver)).all()
            for req in reqs: requests_list.append({'request_id': req.id, 'load_id': load.id, 'load_origin': load.origin, 'load_destination': load.destination, 'driver_id': req.driver.id, 'driver_name': req.driver.username, 'price': load.price, 'documents': get_example_documents(load.origin, load.destination)})
        return jsonify(requests_list)
    except Exception as e: print(f"ERROR: Fetching sender reqs: {e}"); return jsonify({'error': 'Failed to fetch requests'}), 500


@app.route('/api/confirm_request', methods=['POST'])
@login_required
def api_confirm_request():
    # ... (Keep as is) ...
    if current_user.role != 'sender': return jsonify({'error': 'Unauthorized'}), 403
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); request_id = data.get('request_id')
    if request_id is None: return jsonify({'error': 'Missing request_id'}), 400
    req = db.session.query(LoadRequest).options(joinedload(LoadRequest.load), joinedload(LoadRequest.driver)).get(request_id)
    if not req or req.status != 'pending': return jsonify({'error': 'Request not found/processed'}), 404
    load = req.load
    if not load or load.sender_id != current_user.id: return jsonify({'error': 'Load not found/owned'}), 404
    if load.status != 'requested': return jsonify({'error': 'Load not requested state'}), 400
    try: load.status = 'assigned'; load.driver_id = req.driver_id; req.status = 'confirmed'; LoadRequest.query.filter(LoadRequest.load_id == load.id, LoadRequest.id != req.id, LoadRequest.status == 'pending').update({'status': 'rejected'}, synchronize_session=False); db.session.commit(); print(f"INFO: Load UTI-{load.id} assigned"); return jsonify({'success': True, 'message': f'Load UTI-{load.id} assigned'})
    except Exception as e: db.session.rollback(); print(f"ERROR: Confirming request {request_id}: {e}"); return jsonify({'error': 'DB error'}), 500

@app.route('/api/get_driver_jobs', methods=['GET'])
@login_required
def api_get_driver_jobs():
    # ... (Keep as is) ...
    if current_user.role not in ['driver', 'truck_owner']: return jsonify({'error': 'Unauthorized'}), 403
    try:
        confirmed = Load.query.filter(Load.driver_id == current_user.id, Load.status.in_(['assigned', 'intransit'])).order_by(Load.expected_date).all()
        pending = LoadRequest.query.join(Load, LoadRequest.load_id == Load.id).filter(LoadRequest.driver_id == current_user.id, LoadRequest.status == 'pending', Load.status == 'requested').options(db.contains_eager(LoadRequest.load)).order_by(Load.expected_date).all()
        confirmed_list = [{'ref_number': f"UTI-{l.id}", 'origin': l.origin, 'destination': l.destination,'status': l.status, 'expected_date': l.expected_date, 'price': l.price,'documents': get_example_documents(l.origin, l.destination)} for l in confirmed]
        pending_list = [{'ref_number': f"UTI-{req.load.id}", 'origin': req.load.origin, 'destination': req.load.destination, 'status': req.load.status, 'expected_date': req.load.expected_date, 'price': req.load.price, 'documents': get_example_documents(req.load.origin, req.load.destination)} for req in pending]
        return jsonify({'confirmed_jobs': confirmed_list, 'pending_requests': pending_list})
    except Exception as e: print(f"ERROR: Fetching driver jobs: {e}"); return jsonify({'error': 'Failed to fetch jobs'}), 500


@app.route('/api/get_driver_history', methods=['GET'])
@login_required
def api_get_driver_history():
    # ... (Keep as is) ...
     if current_user.role not in ['driver', 'truck_owner']: return jsonify({'error': 'Unauthorized'}), 403
     try: loads = Load.query.options(joinedload(Load.sender)).filter(Load.driver_id == current_user.id, Load.status == 'delivered').order_by(Load.id.desc()).limit(50).all(); history = [{'ref_number': f"UTI-{l.id}", 'origin': l.origin, 'destination': l.destination, 'status': l.status, 'expected_date': l.expected_date, 'sender_name': l.sender.username if l.sender else "N/A", 'price': l.price, 'documents': get_example_documents(l.origin, l.destination)} for l in loads]; return jsonify(history)
     except Exception as e: print(f"ERROR: Fetching driver history: {e}"); return jsonify({'error': 'Failed to fetch history'}), 500


@app.route('/api/get_sender_history', methods=['GET'])
@login_required
def api_get_sender_history():
    # ... (Keep as is) ...
    if current_user.role != 'sender': return jsonify({'error': 'Unauthorized'}), 403
    try: loads = Load.query.options(joinedload(Load.driver)).filter(Load.sender_id == current_user.id, Load.status.in_(['delivered', 'canceled'])).order_by(Load.id.desc()).limit(50).all(); history = [{'ref_number': f"UTI-{l.id}", 'origin': l.origin, 'destination': l.destination, 'status': l.status, 'expected_date': l.expected_date, 'driver_name': l.driver.username if l.driver else "N/A", 'price': l.price, 'documents': get_example_documents(l.origin, l.destination)} for l in loads]; return jsonify(history)
    except Exception as e: print(f"ERROR: Fetching sender history: {e}"); return jsonify({'error': 'Failed to fetch history'}), 500


@app.route('/api/update_location', methods=['POST'])
@login_required
def api_update_location():
    """API: Drivers update their location."""
    if current_user.role not in ['driver', 'truck_owner']: return jsonify({'error': 'Unauthorized'}), 403
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(); ref_num = data.get('ref_number'); lat = data.get('lat'); lng = data.get('lng')
    if not ref_num or lat is None or lng is None: return jsonify({'error': 'Missing data'}), 400
    try:
        load_id = int(ref_num.split('-')[1]); lat = float(lat); lng = float(lng)
    except (ValueError, IndexError, TypeError): return jsonify({'error': 'Invalid ref or coordinates'}), 400

    load = db.session.get(Load, load_id)
    if not load: return jsonify({'error': 'Load not found'}), 404
    if load.driver_id != current_user.id: return jsonify({'error': 'Not authorized'}), 403
    if load.status not in ['assigned', 'intransit']: return jsonify({'error': f'Cannot update location for status: {load.status}'}), 400
    try:
        load.driver_lat = lat; load.driver_lng = lng
        if load.status == 'assigned':
            load.status = 'intransit'
            print(f"INFO: Load UTI-{load_id} now 'intransit'")
        db.session.commit()
        return jsonify({'success': True, 'message': 'Location updated'})
    except Exception as e:
        db.session.rollback(); print(f"ERROR: DB Error updating location {load_id}: {e}")
        return jsonify({'error': 'DB error during location update'}), 500

# --- UPDATED TRACK SHIPMENT API ---
@app.route('/api/track_shipment', methods=['GET'])
@login_required
def api_track_shipment():
    """API: Get tracking info for a load (used by Sender, Owner, Receiver)."""
    ref_num = request.args.get('ref')
    if not ref_num or not ref_num.startswith('UTI-'): return jsonify({'error': 'Invalid ref format'}), 400
    try: load_id = int(ref_num.split('-')[1])
    except: return jsonify({'error': 'Invalid ref ID'}), 400

    load = db.session.query(Load).options(joinedload(Load.driver), joinedload(Load.sender)).get(load_id)
    if not load: return jsonify({'error': 'Shipment not found'}), 404

    # Permission Check
    can_track = False
    if current_user.role == 'sender' and load.sender_id == current_user.id: can_track = True
    elif current_user.role == 'driver' and load.driver_id == current_user.id: can_track = True
    elif current_user.role == 'receiver': can_track = True # Receivers can track any load by ref#
    elif current_user.role == 'truck_owner':
        # FUTURE: if load.driver and load.driver.owner_id == current_user.id: can_track = True
        if load.driver_id: can_track = True # Temp allow owner

    if not can_track: return jsonify({'error': 'Unauthorized to track this shipment'}), 403

    driver_name = load.driver.username if load.driver else "Not Assigned Yet"
    sender_name = load.sender.username if load.sender else "N/A" # Added sender name

    return jsonify({
        'id': f"UTI-{load.id}", 'origin': load.origin, 'destination': load.destination,
        'status': load.status, 'expected_date': load.expected_date,
        'driver_name': driver_name, 'sender_name': sender_name, # Include sender name
        'driver_lat': load.driver_lat, 'driver_lng': load.driver_lng,
        'price': load.price,
        'payment_status': load.payment_status, # Include payment status
        'documents': get_example_documents(load.origin, load.destination)
    })
# --- END UPDATED TRACK SHIPMENT API ---

@app.route('/api/get_owner_overview', methods=['GET'])
@login_required
def api_get_owner_overview():
    """API: Truck Owners get overview."""
    if current_user.role != 'truck_owner': return jsonify({'error': 'Unauthorized'}), 403
    try:
        active_loads = Load.query.options(joinedload(Load.driver), joinedload(Load.sender)).filter(Load.status.in_(['assigned', 'intransit'])).order_by(Load.expected_date).all()
        completed_loads = Load.query.options(joinedload(Load.driver), joinedload(Load.sender)).filter(Load.status.in_(['delivered', 'canceled'])).order_by(Load.id.desc()).limit(50).all()
        def serialize_load_details(loads):
            # *** ADD payment_status to serialization ***
            return [{'ref_number': f"UTI-{l.id}",'origin': l.origin, 'destination': l.destination, 'status': l.status,'expected_date': l.expected_date,'price': l.price,'driver_name': l.driver.username if l.driver else "N/A",'sender_name': l.sender.username if l.sender else "N/A",'documents': get_example_documents(l.origin, l.destination),'driver_lat': l.driver_lat,'driver_lng': l.driver_lng, 'payment_status': l.payment_status} for l in loads]
        return jsonify({'active_loads': serialize_load_details(active_loads), 'completed_loads': serialize_load_details(completed_loads)})
    except Exception as e: print(f"ERROR: Fetching owner overview: {e}"); return jsonify({'error': 'Failed to fetch overview'}), 500

# --- RECEIVER PAYMENT API ENDPOINT ---
@app.route('/api/mark_as_paid', methods=['POST'])
@login_required
def api_mark_as_paid():
    """API: Receiver marks a delivered load as paid (simulation)."""
    if current_user.role != 'receiver': return jsonify({'error': 'Only receivers can mark payments'}), 403
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); ref_num = data.get('ref_number')
    if not ref_num: return jsonify({'error': 'Missing ref_number'}), 400
    try: load_id = int(ref_num.split('-')[1])
    except: return jsonify({'error': 'Invalid ref format'}), 400

    load = db.session.get(Load, load_id)
    if not load: return jsonify({'error': 'Load not found'}), 404
    if load.status != 'delivered': return jsonify({'error': f'Payment only for delivered loads. Status: {load.status}'}), 400
    if load.payment_status == 'paid': return jsonify({'error': 'Already marked as paid.'}), 400
    try:
        load.payment_status = 'paid'; db.session.commit()
        # --- Payment Simulation Log ---
        driver_user = db.session.get(User, load.driver_id) if load.driver_id else None
        # Placeholder for finding owner - replace with actual logic when implemented
        owner_info = f"owner of driver '{driver_user.username}' (ID: {load.driver_id})" if driver_user else "the responsible party (owner not linked)"
        print(f"SIMULATION: Payment of approx ₹{load.price} for Load UTI-{load.id} marked as received by {owner_info}.")
        # --- End Simulation ---
        return jsonify({'success': True, 'message': f'Load UTI-{load.id} marked as paid.'})
    except Exception as e:
        db.session.rollback(); print(f"ERROR: Marking load {load_id} as paid: {e}")
        return jsonify({'error': 'DB error updating payment status.'}), 500
# --- END RECEIVER PAYMENT API ENDPOINT ---


# --- RUN THE APP ---
if __name__ == '__main__':
    with app.app_context():
        # db.drop_all() # Uncomment only if you need to completely reset the DB structure
        db.create_all() # Creates tables if they don't exist based on models
        print("Database tables checked/created.")
    # Set host='0.0.0.0' to make it accessible on your local network
    # Set debug=False for production deployment
    app.run(debug=True, host='0.0.0.0', port=5000)

@app.route("/api/make_payment", methods=["POST"])
def make_payment():
    data = request.get_json()
    amount = data.get("amount")
    print(f"Payment of ₹{amount} received.")
    return jsonify({"success": True})
