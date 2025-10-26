// Global variables
let map, marker;
let trackingInterval = null;

// --- Helper: Format Price ---
function formatPrice(price) {
    return price ? `₹${price.toFixed(2)}` : 'N/A';
}

// --- Helper: Format Document List ---
function formatDocuments(documents) {
    if (documents && documents.length > 0) {
        return `<ul>${documents.map(doc => `<li>${doc || 'N/A'}</li>`).join('')}</ul>`;
    }
    return 'N/A';
}

// --- 1. "Upload Goods" Form ---
document.getElementById("goodsForm")?.addEventListener("submit", function(e) { // Add null check
  e.preventDefault();
  const loadData = {
    origin: document.getElementById('origin').value, destination: document.getElementById('destination').value,
    load_type: document.getElementById('loadType').value, weight: document.getElementById('weight').value,
    expected_date: document.getElementById('expectedDate').value };
  if (!loadData.origin || !loadData.destination || !loadData.load_type || !loadData.weight || !loadData.expected_date) {
      alert("Please fill out all fields."); return;
  }
  const submitButton = this.querySelector('button[type="submit"]');
  submitButton.disabled = true; submitButton.innerText = 'Uploading...';
  const refDisplay = document.getElementById("refDisplay");
  const priceDisplay = document.getElementById("priceDisplay");
  if(refDisplay) refDisplay.style.display = "none";
  if(priceDisplay) priceDisplay.style.display = "none";

  // Use the direct API endpoint path
  fetch('/api/post_load', { // <<< CORRECTED PATH
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loadData),
  })
  .then(response => {
      if (!response.ok) { return response.json().then(err => { throw new Error(err.error || `HTTP error ${response.status}`); }).catch(() => { throw new Error(`HTTP error ${response.status}`); }); }
      return response.json();
  })
  .then(data => {
    if (data.ref_number) {
      document.getElementById("refNumber").innerText = data.ref_number;
      if(refDisplay) refDisplay.style.display = "block";

      const priceText = formatPrice(data.estimated_price); // Use helper
      document.getElementById("estPrice").innerText = priceText;
      if(priceDisplay) priceDisplay.style.display = "block";

      alert(`Goods registered!\nRef: ${data.ref_number}\nPrice: ${priceText}`);
      document.getElementById("goodsForm").reset();
      loadDriverRequests(); // Refresh requests list after posting a new load
    } else {
      alert('Upload successful, but no reference number received.');
    }
  })
  .catch((error) => {
    console.error('Error during upload:', error);
    alert('Upload failed: ' + error.message);
  })
  .finally(() => {
      submitButton.disabled = false;
      submitButton.innerText = 'Upload Data';
  });
});


// --- 2. Leaflet Autocomplete (OpenStreetMap) ---
if (typeof L !== 'undefined' && typeof L.GeoSearch !== 'undefined') {
  const { OpenStreetMapProvider } = L.GeoSearch;
  const provider = new OpenStreetMapProvider({ params: { countrycodes: 'in', limit: 5 } });
  async function onInputType(event) {
    const datalist = document.getElementById(event.target.getAttribute('list'));
    if (!datalist || event.target.value.length < 3) { if(datalist) datalist.innerHTML = ''; return; }
    try {
        const results = await provider.search({ query: event.target.value });
        datalist.innerHTML = '';
        if (results?.length > 0) {
            results.forEach(result => { const option = document.createElement('option'); option.value = result.label; datalist.appendChild(option); });
        }
    } catch (error) { console.error("Geosearch Autocomplete Error:", error); }
  }
  const originInput = document.getElementById('origin');
  const destinationInput = document.getElementById('destination');
  if (originInput) originInput.addEventListener('input', onInputType);
  if (destinationInput) destinationInput.addEventListener('input', onInputType);

} else { console.warn("Leaflet/Geosearch library not loaded. Autocomplete disabled."); }


// --- 3. Leaflet Tracking Map ---
function initMap(lat, lng) {
    const centerLat = lat || 22.5726; const centerLng = lng || 88.3639; // Default: Near Kolkata
    try {
        if (!map) {
          map = L.map('map').setView([centerLat, centerLng], 6);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
        } else { map.setView([centerLat, centerLng], lat ? 12 : 6); }
        if (lat && lng) {
          if (marker) { marker.setLatLng([lat, lng]); }
          else { marker = L.marker([lat, lng]).addTo(map); }
          marker.bindPopup("Driver's Live Location").openPopup();
        } else if (marker) { map.removeLayer(marker); marker = null; }
    } catch (e) {
        console.error("Map initialization failed:", e);
        const mapDiv = document.getElementById('map');
        if (mapDiv) mapDiv.innerHTML = "<p style='color:red;'>Map failed to load. Please check console.</p>";
    }
}


// --- 4. "Track Driver" Button Logic (Live Polling) ---
const trackBtn = document.getElementById("trackBtn");
if (trackBtn) {
    trackBtn.addEventListener("click", function() {
      const refInput = document.getElementById("trackRef");
      const ref = refInput ? refInput.value.trim() : null;
      if (!ref) { alert("Please enter a reference number!"); return; }
      if (trackingInterval) { clearInterval(trackingInterval); }

      // Clear previous info and map marker
      document.getElementById('trackInfo').style.display = 'none';
      if(marker) { map.removeLayer(marker); marker = null; }
      map?.setView([22.5726, 88.3639], 6); // Reset map view

      fetchTrackingData(ref); // Initial fetch
      trackingInterval = setInterval(() => fetchTrackingData(ref), 15000); // Poll every 15s
    });
}

function fetchTrackingData(ref) {
  console.log('Polling location for:', ref);
  // Use the direct API endpoint path
  fetch(`/api/track_shipment?ref=${encodeURIComponent(ref)}`) // <<< CORRECTED PATH
    .then(response => {
        if (!response.ok) { return response.json().then(err => { throw new Error(err.error || `HTTP ${response.status}`); }); }
        return response.json();
    })
    .then(data => {
      if (data.error) { // Handle application errors from API
          throw new Error(data.error);
      }
      // Update Tracking Info Display
      const infoDiv = document.getElementById('trackInfo');
      const trackStatus = document.getElementById('trackStatus');
      const trackDriver = document.getElementById('trackDriver');
      const trackPrice = document.getElementById('trackPrice');
      const trackDocs = document.getElementById('trackDocs');

      if(trackStatus) trackStatus.textContent = data.status || '--';
      if(trackDriver) trackDriver.textContent = data.driver_name || '--';
      if(trackPrice) trackPrice.textContent = formatPrice(data.price);
      if(trackDocs) trackDocs.textContent = Array.isArray(data.documents) ? data.documents.join(', ') : 'N/A';
      if(infoDiv) infoDiv.style.display = 'block';

      // Update Map
      if (data.driver_lat && data.driver_lng) {
        initMap(data.driver_lat, data.driver_lng);
      } else {
        initMap(); // Show default map view if no location
        if (data.status === 'intransit') { console.warn(`Shipment ${ref} is 'intransit' but no location data received.`); }
      }

      // Stop polling if delivered
      if (data.status === 'delivered') {
        alert('Shipment has been delivered! Stopping live tracking.');
        if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
      }
    })
    .catch(error => {
      console.error('Tracking Error:', error);
      alert("Error tracking shipment: " + error.message);
      if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
      const infoDiv = document.getElementById('trackInfo');
      if(infoDiv) infoDiv.style.display = 'none'; // Hide info on error
    });
}


// --- 5. SENDER CONFIRMATION LOGIC ---
function loadDriverRequests() {
    const tableBody = document.getElementById('driverRequestsTableBody');
    if (!tableBody) { console.warn("Driver requests table body not found."); return; }
    const colSpan = 6; // *** Number of columns ***
    tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading requests...</td></tr>`;

    // Use the direct API endpoint path
    fetch('/api/get_sender_requests') // <<< CORRECTED PATH
        .then(response => {
            if (!response.ok) { throw new Error(`Network response error: ${response.statusText}`); }
            return response.json();
        })
        .then(data => {
            if (data.error) { throw new Error(data.error); }
            if (!Array.isArray(data)) { throw new Error("Invalid requests data format."); }

            tableBody.innerHTML = ''; // Clear loading
            if (data.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${colSpan}">No pending driver requests found.</td></tr>`;
                return;
            }

            data.forEach(req => {
                const row = tableBody.insertRow();
                row.insertCell(0).textContent = `UTI-${req.load_id}`;
                row.insertCell(1).textContent = `${req.load_origin || 'N/A'} ➜ ${req.load_destination || 'N/A'}`;
                row.insertCell(2).textContent = req.driver_name || 'Unknown Driver';
                const priceCell = row.insertCell(3);
                priceCell.textContent = formatPrice(req.price);
                priceCell.style.textAlign = 'right';
                row.insertCell(4).innerHTML = formatDocuments(req.documents);
                const actionCell = row.insertCell(5);
                actionCell.innerHTML = `<button class="btn btn-confirm" data-requestid="${req.request_id}">Confirm</button>`;
            });
        })
        .catch(error => {
             console.error('Error fetching sender requests:', error);
             tableBody.innerHTML = `<tr><td colspan="${colSpan}">Could not load requests: ${error.message}</td></tr>`;
        });
}

// Event listener for "Confirm" button (using event delegation)
document.body.addEventListener('click', function(event) {
    if (event.target.classList.contains('btn-confirm')) {
        const button = event.target;
        const requestId = button.dataset.requestid;
        const priceText = button.closest('tr')?.cells[3]?.textContent || 'N/A'; // Get price for confirmation

        if (!confirm(`Assign this load to the driver?\nEstimated Price: ${priceText}\n(Please verify driver meets all requirements)`)) { return; }

        button.disabled = true; button.innerText = 'Confirming...';

        // Use the direct API endpoint path
        fetch('/api/confirm_request', { // <<< CORRECTED PATH
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: requestId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Load assigned successfully!');
                loadDriverRequests(); // Reload the list of pending requests
            } else {
                alert('Error confirming request: ' + (data.error || 'Unknown error'));
                button.disabled = false; button.innerText = 'Confirm'; // Reset button on error
            }
        })
        .catch(error => {
            console.error('Error confirming request:', error);
            alert('A network or server error occurred during confirmation.');
            button.disabled = false; button.innerText = 'Confirm'; // Reset button on error
        });
    }
});

// --- 6. Shipment History Logic ---
function loadShipmentHistory() {
    const tableBody = document.getElementById('shipmentHistoryTableBody');
    if (!tableBody) { console.warn("Shipment history table body not found."); return; }
    const colSpan = 7; // *** Number of columns ***
    tableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading history...</td></tr>`;

    // Use the direct API endpoint path
    fetch('/api/get_sender_history') // <<< CORRECTED PATH
        .then(response => {
            if (!response.ok) { throw new Error(`Network response error: ${response.statusText}`); }
            return response.json();
        })
        .then(data => {
            if (data.error) { throw new Error(data.error); }
            if (!Array.isArray(data)) { throw new Error("Invalid history data format."); }

            tableBody.innerHTML = '';
            if (data.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${colSpan}">No shipment history found.</td></tr>`;
                return;
            }

            data.forEach(load => {
                const row = tableBody.insertRow();
                row.insertCell(0).textContent = load.ref_number || 'N/A';
                row.insertCell(1).textContent = `${load.origin || 'N/A'} ➜ ${load.destination || 'N/A'}`;
                row.insertCell(2).textContent = load.expected_date || 'N/A';
                row.insertCell(3).textContent = load.status || 'N/A';
                row.insertCell(4).textContent = load.driver_name || 'N/A';
                const priceCell = row.insertCell(5);
                priceCell.textContent = formatPrice(load.price);
                priceCell.style.textAlign = 'right';
                row.insertCell(6).innerHTML = formatDocuments(load.documents);
            });
        })
        .catch(error => {
            console.error('Error fetching shipment history:', error);
            tableBody.innerHTML = `<tr><td colspan="${colSpan}">Could not load history: ${error.message}</td></tr>`;
        });
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Sender dashboard DOM loaded.");
    initMap(); // Initialize map on page load (shows default view)
    loadDriverRequests(); // Load pending requests
    loadShipmentHistory(); // Load shipment history
});
const instruction = document.getElementById("instruction").value;

fetch("/api/post_load", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    origin,
    destination,
    truck_type,
    weight,
    date,
    price,
    instruction  // ✅ new field
  })
});

