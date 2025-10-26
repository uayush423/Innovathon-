// Global map variables
let map, marker;
let trackingInterval = null;

// --- Helper Functions ---
function formatPrice(price) {
    return (typeof price === 'number' && !isNaN(price)) ? `₹${price.toFixed(2)}` : 'N/A';
}

function formatDocuments(documents) {
    if (Array.isArray(documents) && documents.length > 0) {
        return `<ul>${documents.map(doc => `<li>${doc || 'N/A'}</li>`).join('')}</ul>`;
    }
    return 'N/A';
}

// --- Function to populate owner dashboard tables ---
function populateOwnerTable(tableBody, loads, columns) {
    if (!tableBody) {
        console.error("populateOwnerTable: Provided tableBody element is invalid.");
        return;
    }
    tableBody.innerHTML = ''; // Clear previous content

    if (!Array.isArray(loads) || loads.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="${columns}">No loads found matching this criteria.</td></tr>`;
        return;
    }

    loads.forEach(load => {
        const row = tableBody.insertRow();
        row.insertCell(0).textContent = load.ref_number || 'N/A';
        row.insertCell(1).textContent = `${load.origin || 'N/A'} ➜ ${load.destination || 'N/A'}`;
        row.insertCell(2).textContent = load.expected_date || 'N/A';
        const statusCell = row.insertCell(3);
        statusCell.textContent = (load.status || 'UNKNOWN').toUpperCase();
        statusCell.className = `status-${(load.status || 'unknown').toLowerCase()}`; // Apply status class
        row.insertCell(4).textContent = load.driver_name || 'N/A';
        row.insertCell(5).textContent = load.sender_name || 'N/A';
        const priceCell = row.insertCell(6);
        priceCell.textContent = formatPrice(load.price);
        priceCell.classList.add('price-col'); // Apply price styling class
        row.insertCell(7).innerHTML = formatDocuments(load.documents); // Use innerHTML for list
        // Add more cells if needed
    });
}


// --- Function to Load Owner Overview Data ---
function loadOwnerOverview() {
    const activeTableBody = document.getElementById('activeLoadsTableBody');
    const completedTableBody = document.getElementById('completedLoadsTableBody');
    const colSpan = 8; // Number of columns in the overview tables

    if (!activeTableBody || !completedTableBody) {
        console.error("Cannot load owner overview: Table body elements not found.");
        return;
    }

    activeTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading active loads...</td></tr>`;
    completedTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading completed loads...</td></tr>`;

    // Fetch data from the new owner API endpoint
    fetch('/api/get_owner_overview') // Use direct path
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || `Network error: ${response.statusText}`); });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) { throw new Error(data.error); }

            console.log("Owner overview data received:", data);
            populateOwnerTable(activeTableBody, data.active_loads, colSpan);
            populateOwnerTable(completedTableBody, data.completed_loads, colSpan);
        })
        .catch(error => {
            console.error('Error fetching owner overview:', error);
            if(activeTableBody) activeTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="color: red;">Error loading active loads: ${error.message}</td></tr>`;
            if(completedTableBody) completedTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="color: red;">Error loading completed loads.</td></tr>`;
        });
}


// --- Map Initialization ---
function initMap(lat, lng) {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error("Map container element ('map') not found.");
        return; // Don't proceed if map div doesn't exist
    }

    const centerLat = lat || 23.5937; // Default center (India approx)
    const centerLng = lng || 80.9629;
    const initialZoom = lat ? 12 : 5; // Zoom in if specific coords provided

    try {
        if (!map) { // Initialize map only once
            map = L.map('map').setView([centerLat, centerLng], initialZoom);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
            console.log("Map initialized.");
        } else { // Just update view and marker if map already exists
            map.setView([centerLat, centerLng], initialZoom);
        }

        // Add or move the marker
        if (lat && lng) {
            if (marker) {
                marker.setLatLng([lat, lng]);
            } else {
                marker = L.marker([lat, lng]).addTo(map);
            }
            marker.bindPopup("Driver's Live Location").openPopup();
        } else if (marker) {
            // Remove marker if no valid coordinates are provided
            map.removeLayer(marker);
            marker = null;
        }
    } catch (e) {
        console.error("Leaflet map initialization/update failed:", e);
        mapElement.innerHTML = "<p style='color:red;'>Error loading map. Leaflet library might be missing or configuration is incorrect.</p>";
    }
}


// --- Track Shipment Logic ---
const trackBtn = document.getElementById("trackBtn");
const trackRefInput = document.getElementById("trackRef");

if (trackBtn && trackRefInput) {
    trackBtn.addEventListener("click", function() {
        const ref = trackRefInput.value.trim();
        if (!ref) {
            alert("Please enter a shipment reference number (e.g., UTI-123).");
            return;
        }
        if (!ref.toUpperCase().startsWith('UTI-')) {
             alert("Invalid format. Reference number should start with 'UTI-'.");
            return;
        }

        // Stop previous tracking if any
        if (trackingInterval) {
            clearInterval(trackingInterval);
            trackingInterval = null;
            console.log("Stopped previous tracking interval.");
        }

        // Clear previous info and map marker immediately
        const infoDiv = document.getElementById('trackInfo');
        if (infoDiv) infoDiv.style.display = 'none';
        if (marker) { map?.removeLayer(marker); marker = null; }
        map?.setView([23.5937, 80.9629], 5); // Reset map view

        fetchTrackingData(ref); // Fetch immediately
        // Start polling for updates
        trackingInterval = setInterval(() => fetchTrackingData(ref), 20000); // Poll every 20 seconds
    });
} else {
    console.warn("Tracking button or input field not found. Tracking feature disabled.");
}

function fetchTrackingData(ref) {
  console.log('Polling tracking data for:', ref);

  // Use the direct API endpoint path
  fetch(`/api/track_shipment?ref=${encodeURIComponent(ref)}`)
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.error || `Error ${response.status}`); });
        }
        return response.json();
    })
    .then(data => {
      if (data.error) { // Handle application errors from API
          throw new Error(data.error);
      }
      console.log("Tracking data received:", data);

      // Update Tracking Info Display
      const infoDiv = document.getElementById('trackInfo');
      const trackStatus = document.getElementById('trackStatus');
      const trackDriver = document.getElementById('trackDriver');
      const trackSender = document.getElementById('trackSender'); // Added sender info
      const trackPrice = document.getElementById('trackPrice');
      const trackDocs = document.getElementById('trackDocs');

      if(trackStatus) trackStatus.textContent = data.status || '--';
      if(trackDriver) trackDriver.textContent = data.driver_name || '--';
      if(trackSender) trackSender.textContent = data.sender_name || '--'; // Assuming API provides sender_name
      if(trackPrice) trackPrice.textContent = formatPrice(data.price);
      if(trackDocs) trackDocs.textContent = Array.isArray(data.documents) ? data.documents.join(', ') : 'N/A';
      if(infoDiv) infoDiv.style.display = 'block'; // Show the info div

      // Update Map
      if (data.driver_lat && data.driver_lng) {
        initMap(data.driver_lat, data.driver_lng); // Update map with new coordinates
      } else {
        initMap(); // Reset map if no location data
        if (data.status === 'intransit') { console.warn(`Shipment ${ref} is 'intransit' but no location data received.`); }
      }

      // Stop polling if delivered or canceled
      if (data.status === 'delivered' || data.status === 'canceled') {
        alert(`Shipment ${ref} is now marked as ${data.status}. Stopping live tracking.`);
        if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
      }
    })
    .catch(error => {
      console.error('Tracking Error:', error);
      alert("Error tracking shipment: " + error.message);
      // Stop polling on error
      if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
      const infoDiv = document.getElementById('trackInfo');
      if(infoDiv) infoDiv.style.display = 'none'; // Hide info display on error
    });
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Truck Owner dashboard DOM loaded.");
    initMap(); // Initialize the map on page load with default view
    loadOwnerOverview(); // Load the overview tables
});