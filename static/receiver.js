// Global map variables
let map, marker;
let currentTrackingRef = null;
let trackingInterval = null;

// --- Helper Functions ---
function formatPrice(price) { return (typeof price === 'number' && !isNaN(price)) ? `₹${price.toFixed(2)}` : 'N/A'; }
function formatDocuments(documents) { if (Array.isArray(documents) && documents.length > 0) { return `<ul>${documents.map(doc => `<li>${doc || 'N/A'}</li>`).join('')}</ul>`; } return 'N/A'; }

// --- Map Initialization ---
function initMap(lat, lng) { /* ... (keep as is) ... */
    const mapElement = document.getElementById('map'); if (!mapElement) return;
    const centerLat = lat || 23.5937; const centerLng = lng || 80.9629; const initialZoom = lat ? 13 : 5;
    try { if (!map) { map = L.map('map').setView([centerLat, centerLng], initialZoom); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map); } else { map.setView([centerLat, centerLng], initialZoom); } if (lat && lng) { if (marker) { marker.setLatLng([lat, lng]); } else { marker = L.marker([lat, lng]).addTo(map); } marker.bindPopup("Driver's Live Location").openPopup(); } else if (marker) { map.removeLayer(marker); marker = null; } }
    catch (e) { console.error("Leaflet map failed:", e); if(mapElement) mapElement.innerHTML = "<p style='color:red;'>Error loading map.</p>"; }
}

// --- Update UI with Shipment Data ---
function updateShipmentDetails(data) {
    const detailsSection = document.getElementById('shipmentDetails'); const searchStatus = document.getElementById('searchStatus');
    const payBtn = document.getElementById('payBtn'); const paymentSection = document.getElementById('paymentSection');
    const paymentStatusSpan = document.getElementById('detailsPaymentStatus'); const paymentMessage = document.getElementById('paymentMessage');
    const detailsTruckType = document.getElementById('detailsTruckType'); // Get truck type element

    if (!detailsSection || !searchStatus || !payBtn || !paymentSection || !paymentStatusSpan || !paymentMessage || !detailsTruckType) {
        console.error("Critical Error: Missing detail elements."); if (searchStatus) searchStatus.textContent = "Error displaying details."; return;
    }
    console.log("Updating UI:", data);

    document.getElementById('detailsRef').textContent = data.id || 'N/A';
    document.getElementById('detailsStatus').textContent = data.status ? data.status.replace('_', ' ').toUpperCase() : 'N/A';
    document.getElementById('detailsOrigin').textContent = data.origin || 'N/A';
    document.getElementById('detailsDestination').textContent = data.destination || 'N/A';
    document.getElementById('detailsDate').textContent = data.expected_date || 'N/A';
    detailsTruckType.textContent = data.load_type || 'N/A'; // Update truck type display
    document.getElementById('detailsSender').textContent = data.sender_name || 'N/A';
    document.getElementById('detailsDriver').textContent = data.driver_name || 'N/A';
    document.getElementById('detailsPrice').textContent = formatPrice(data.price);
    const docsElement = document.getElementById('detailsDocs'); if (docsElement) docsElement.innerHTML = formatDocuments(data.documents);

    const currentPaymentStatus = data.payment_status || 'unpaid';
    paymentStatusSpan.textContent = currentPaymentStatus.toUpperCase();
    paymentStatusSpan.className = ''; paymentStatusSpan.classList.add(`${currentPaymentStatus}-status`);
    paymentMessage.textContent = ''; payBtn.style.display = 'inline-block'; // Show button by default

    if (data.status === 'delivered') {
        paymentSection.style.display = 'block';
        if (currentPaymentStatus === 'unpaid') {
            payBtn.disabled = false; payBtn.textContent = 'Mark as Paid (Simulated)';
            paymentMessage.textContent = 'Shipment delivered. Confirm payment.';
        } else {
            payBtn.disabled = true; payBtn.textContent = `Payment Status: ${currentPaymentStatus.toUpperCase()}`;
            paymentMessage.textContent = 'Payment already processed.';
        }
    } else {
        paymentSection.style.display = 'block'; payBtn.style.display = 'none'; // Hide button if not delivered
        paymentMessage.textContent = `Payment available upon delivery. Status: ${data.status?.toUpperCase() || 'N/A'}`;
        payBtn.disabled = true;
    }

    detailsSection.style.display = 'block';
    if (searchStatus) searchStatus.textContent = `Displaying details for ${data.id}.`;

    if (data.driver_lat && data.driver_lng && ['assigned', 'intransit'].includes(data.status)) { initMap(data.driver_lat, data.driver_lng); }
    else { initMap(); }
}

// --- Fetch Tracking Data ---
function fetchTrackingData(ref) { /* ... (Keep as is) ... */
  const searchStatus = document.getElementById('searchStatus'); if (!ref) return;
  if (searchStatus) searchStatus.textContent = `Fetching details for ${ref}...`;
  console.log(`Fetching tracking data for: ${ref}`);
  fetch(`/api/track_shipment?ref=${encodeURIComponent(ref)}`)
    .then(response => { if (!response.ok) { return response.json().then(err => { throw new Error(err.error || `Error ${response.status}`); }); } return response.json(); })
    .then(data => { if (data.error) { throw new Error(data.error); } console.log("Tracking data received:", data); currentTrackingRef = data.id; updateShipmentDetails(data); if ((data.status === 'delivered' && data.payment_status === 'paid') || data.status === 'canceled') { console.log(`Stopping polling for ${ref}.`); if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; } if (searchStatus) searchStatus.textContent = `Shipment ${data.status}. Tracking stopped.`; } })
    .catch(error => { console.error('Tracking Error:', error); if (searchStatus) searchStatus.textContent = `Error: ${error.message}`; const detailsSection = document.getElementById('shipmentDetails'); if(detailsSection) detailsSection.style.display = 'none'; if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; } });
}

// --- Handle Payment Button Click ---
const payBtnElement = document.getElementById('payBtn');
if (payBtnElement) { /* ... (Keep as is) ... */
    payBtnElement.addEventListener('click', function() {
        if (!currentTrackingRef) { alert("No shipment reference loaded."); return; }
        const loadPriceText = document.getElementById('detailsPrice')?.textContent || 'N/A';
        if (!confirm(`Confirm payment simulation for ${currentTrackingRef}?\nAmount: ${loadPriceText}\n(Marks load as paid)`)) { return; }
        this.disabled = true; this.textContent = 'Processing...'; const searchStatus = document.getElementById('searchStatus'); if(searchStatus) searchStatus.textContent = 'Processing payment...';
        fetch('/api/mark_as_paid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref_number: currentTrackingRef }) })
        .then(response => response.json())
        .then(data => { if (data.success) { alert(data.message || 'Payment marked!'); fetchTrackingData(currentTrackingRef); if(searchStatus) searchStatus.textContent = 'Payment successful.'; } else { alert('Payment failed: ' + (data.error || 'Unknown server error.')); console.error("Pay API Error:", data.error || data); this.disabled = false; this.textContent = 'Mark as Paid (Simulated)'; if(searchStatus) searchStatus.textContent = `Payment failed: ${data.error || 'Unknown error.'}`; } })
        .catch(error => { console.error('Payment Network Error:', error); alert('Network error processing payment.'); this.disabled = false; this.textContent = 'Mark as Paid (Simulated)'; if(searchStatus) searchStatus.textContent = `Payment failed: Network error.`; });
    });
} else { console.error("CRITICAL ERROR: Payment button ('payBtn') not found!"); }


// --- Search Button Event Listener ---
const searchBtnReceiver = document.getElementById('searchBtnReceiver');
const trackRefInputReceiver = document.getElementById('trackRefReceiver');
if (searchBtnReceiver && trackRefInputReceiver) { /* ... (Keep as is) ... */
    searchBtnReceiver.addEventListener('click', function() {
        const ref = trackRefInputReceiver.value.trim();
        if (!ref || !ref.toUpperCase().startsWith('UTI-')) { alert("Please enter a valid reference number (e.g., UTI-123)."); return; }
        if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
        currentTrackingRef = ref; fetchTrackingData(ref);
        trackingInterval = setInterval(() => { if (currentTrackingRef === ref) { fetchTrackingData(ref); } else { clearInterval(trackingInterval); trackingInterval = null; } }, 30000); // Poll every 30s
    });
} else { console.error("CRITICAL ERROR: Search elements not found!"); const searchStatus = document.getElementById('searchStatus'); if(searchStatus) searchStatus.textContent = "Page load error."; }

// --- Initial Page Load Setup ---
document.addEventListener('DOMContentLoaded', () => { /* ... (Keep as is) ... */
    console.log("Receiver dashboard DOM loaded."); initMap(); const detailsSection = document.getElementById('shipmentDetails'); if(detailsSection) detailsSection.style.display = 'none'; const searchStatus = document.getElementById('searchStatus'); if(searchStatus) searchStatus.textContent = "Enter a shipment reference number to view details.";
});