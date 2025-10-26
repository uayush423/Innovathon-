// --- Global Variables ---
let locationWatchId = null; // Holds the ID for stopping location watch
let activeSharingRef = null; // Holds the ref number being shared

// --- Helper: Format Price ---
function formatPrice(price) {
    if (typeof price === 'number' && !isNaN(price)) {
        return `₹${price.toFixed(2)}`;
    }
    return 'N/A';
}

// --- Helper: Format Document List ---
function formatDocuments(documents) {
    if (Array.isArray(documents) && documents.length > 0) {
        return `<ul>${documents.map(doc => `<li>${doc || 'N/A'}</li>`).join('')}</ul>`;
    }
    return 'N/A';
}


// --- 1. Function to send location to server ---
function updateLocation(position, refNumber, button) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  console.log(`Sharing location for ${refNumber}: Lat ${lat}, Lng ${lng}`);

  fetch("/api/update_location", { // Use direct path
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref_number: refNumber, lat: lat, lng: lng })
  })
  .then(response => {
      if (!response.ok) {
          // Try to parse error from JSON, otherwise use status text
          return response.json().then(err => { throw new Error(err.error || `Server error ${response.status}`); })
                           .catch(() => { throw new Error(`Server error ${response.status}`); });
      }
      return response.json();
  })
  .then(data => {
    if (data.success) {
        // Update button state visually only if it's the correct button and sharing started
        if(button && button.id === 'share-location-btn' && locationWatchId !== null) {
            button.innerText = 'Sharing... (Stop)';
            button.classList.add('btn-sharing');
            button.classList.remove('btn-outline'); // Make sure outline is removed
            button.disabled = false; // Must remain enabled to allow stopping
        }
        // Check if status might have just changed from 'assigned' to 'intransit'
        const confirmedTableBody = document.getElementById('confirmed-jobs-table');
        let statusPotentiallyChanged = false;
        if (confirmedTableBody) {
            const rows = confirmedTableBody.querySelectorAll('tr');
            rows.forEach(row => {
                const refCell = row.cells[0]; const statusCell = row.cells[3];
                if (refCell && statusCell && refCell.textContent.trim() === refNumber && statusCell.textContent.trim().toUpperCase() === 'ASSIGNED') {
                    statusPotentiallyChanged = true;
                }
            });
        }
        // Refresh the job list ONLY if the status might have changed
        if (statusPotentiallyChanged) {
            console.log('Status may have changed to intransit, refreshing job list.');
            loadDriverJobsAndDropdown(); // Update tables and dropdown
        }
    } else {
      console.error('Failed to update location on server:', data.error);
      // Optional: Inform user, maybe stop sharing if server rejects updates
      // alert(`Server error: ${data.error}`);
      // stopSharing(document.getElementById('share-location-btn'), document.getElementById('trip-select'));
    }
  })
  .catch(error => {
      console.error('Network or fetch error sending location:', error);
      // Optional: Inform user
      // alert(`Network error: ${error.message}. Location could not be updated.`);
      // stopSharing(document.getElementById('share-location-btn'), document.getElementById('trip-select'));
  });
}

// --- 2. Function to START sharing location ---
function startSharing(refNumber, button, selectElement) {
  if (!navigator.geolocation) {
    alert('Geolocation API is not available in your browser.'); return;
  }
  if (locationWatchId !== null) {
    alert('Already sharing location for another trip. Please stop that first.'); return;
  }
  if (!refNumber) {
    alert('Please select an active trip from the dropdown.'); return;
  }

  // Check Permissions API (Recommended)
  if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function(permissionStatus) {
          console.log('Geolocation permission state:', permissionStatus.state);
          if (permissionStatus.state === 'denied') {
              alert('Location permission is denied. Please allow it in your browser site settings for this page and reload.');
              return; // Stop if denied
          }
          // If granted or prompt, proceed
          initiateWatchPosition(refNumber, button, selectElement);
      }).catch(error => {
          console.warn('Permission query failed, proceeding anyway:', error);
          initiateWatchPosition(refNumber, button, selectElement); // Try anyway
      });
  } else {
      console.warn("Permissions API not supported, attempting watchPosition directly.");
      initiateWatchPosition(refNumber, button, selectElement); // Fallback
  }
}

// Helper to contain watchPosition logic
function initiateWatchPosition(refNumber, button, selectElement){
    alert(`Starting location sharing for trip ${refNumber}. Browser may ask for permission.`);
    button.disabled = true; button.innerText = 'Starting...';

    locationWatchId = navigator.geolocation.watchPosition(
      // SUCCESS CALLBACK
      (position) => {
          console.log(`watchPosition update received for ${refNumber}`);
          // Update state and UI on first successful position or if ref changed unexpectedly
          if (activeSharingRef !== refNumber) {
               activeSharingRef = refNumber; // Mark this trip as the one being actively shared
               if (selectElement) selectElement.disabled = true; // Disable dropdown
          }
          updateLocation(position, refNumber, button); // Send location update to server
      },
      // ERROR CALLBACK
      (error) => {
        console.error('Geolocation Error:', error.code, error.message);
        let userMessage = 'Could not get location. ';
        switch(error.code) {
            case error.PERMISSION_DENIED: userMessage += "Permission denied. Allow location access in browser/OS settings."; break;
            case error.POSITION_UNAVAILABLE: userMessage += "Location information unavailable. Check GPS/network."; break;
            case error.TIMEOUT: userMessage += "Request timed out getting location."; break;
            default: userMessage += `An unknown error occurred (Code: ${error.code}).`; break;
        }
        alert(userMessage); // Show detailed alert
        stopSharing(button, selectElement); // Reset state on error
      },
      // OPTIONS
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
}


// --- 3. Function to STOP sharing location ---
function stopSharing(button, selectElement) {
    if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
        console.log(`Stopped watching location for ${activeSharingRef}.`);
        activeSharingRef = null; // Clear the actively shared trip reference
    }
    // Reset button appearance and state
    if(button) {
        button.innerText = 'Share My Location';
        button.classList.remove('btn-sharing');
        button.classList.add('btn-outline'); // Re-add outline style
        // Enabling/disabling is handled below based on available trips
    }
    // Re-enable the dropdown
    if(selectElement) {
        selectElement.disabled = false;
    }
    // Refresh the jobs list to update UI state (e.g., enable share button if other active trips exist)
    loadDriverJobsAndDropdown();
}


// --- 4. Function to load jobs/requests AND manage button state ---
function loadDriverJobsAndDropdown() {
  const confirmedTableBody = document.getElementById('confirmed-jobs-table');
  const pendingTableBody = document.getElementById('pending-requests-table');
  const tripSelect = document.getElementById('trip-select');
  const shareButton = document.getElementById('share-location-btn');
  const colSpan = 6; // Number of columns

  if (!confirmedTableBody || !pendingTableBody || !tripSelect || !shareButton) {
      console.error("Critical dashboard elements missing!"); return;
  }

  // Set initial loading states
  confirmedTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading current trips...</td></tr>`;
  pendingTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading pending requests...</td></tr>`;
  // Clear existing options except the first placeholder one
  while (tripSelect.options.length > 1) { tripSelect.remove(1); }
  tripSelect.value = ""; // Reset selection

  // Determine initial button/select state ONLY based on whether sharing is currently active
  if (activeSharingRef) {
      shareButton.innerText = 'Sharing... (Stop)';
      shareButton.classList.add('btn-sharing');
      shareButton.classList.remove('btn-outline');
      shareButton.disabled = false; // Must be enabled to allow stopping
      tripSelect.disabled = true; // Can't change trip while sharing
  } else {
      // If NOT sharing, assume button disabled until we find active trips
      shareButton.disabled = true;
      shareButton.innerText = 'Share My Location';
      shareButton.classList.remove('btn-sharing');
      shareButton.classList.add('btn-outline');
      tripSelect.disabled = false; // Allow selection
  }

  fetch("/api/get_driver_jobs") // Use direct path
    .then(response => {
        if (!response.ok) { return response.json().then(err => { throw new Error(err.error || `Network error: ${response.statusText}`); }); }
        return response.json();
    })
    .then(data => {
      if (data.error) { throw new Error(data.error); }

      confirmedTableBody.innerHTML = ''; // Clear "Loading..."
      let hasActiveTrip = false; // Flag to enable share button if suitable trips exist

      if (data.confirmed_jobs && data.confirmed_jobs.length > 0) {
        data.confirmed_jobs.forEach(job => {
          const row = confirmedTableBody.insertRow();
          row.insertCell(0).textContent = job.ref_number || 'N/A';
          row.insertCell(1).textContent = `${job.origin || 'N/A'} ➜ ${job.destination || 'N/A'}`;
          row.insertCell(2).textContent = job.expected_date || 'N/A';
          const statusCell = row.insertCell(3);
          statusCell.textContent = (job.status || 'UNKNOWN').toUpperCase();
          statusCell.className = `status-${(job.status || 'unknown').toLowerCase()}`;
          const priceCell = row.insertCell(4);
          priceCell.textContent = formatPrice(job.price);
          priceCell.style.textAlign = 'right';
          row.insertCell(5).innerHTML = formatDocuments(job.documents);

          // Add 'assigned' or 'intransit' trips to the dropdown
          if (job.status === 'assigned' || job.status === 'intransit') {
              const option = new Option(`${job.ref_number} (${job.status})`, job.ref_number);
              tripSelect.add(option);
              hasActiveTrip = true; // Mark that there's at least one shareable trip

              // If this is the trip currently being shared, make sure it's selected
              if (activeSharingRef === job.ref_number) { option.selected = true; }
          }
        });
      }
      if (confirmedTableBody.rows.length === 0) {
        confirmedTableBody.innerHTML = `<tr><td colspan="${colSpan}">You have no current trips assigned.</td></tr>`;
      }

      pendingTableBody.innerHTML = ''; // Clear "Loading..."
      if (data.pending_requests && data.pending_requests.length > 0) {
        data.pending_requests.forEach(req => {
          const row = pendingTableBody.insertRow();
          row.insertCell(0).textContent = req.ref_number || 'N/A';
          row.insertCell(1).textContent = `${req.origin || 'N/A'} ➜ ${req.destination || 'N/A'}`;
          row.insertCell(2).textContent = req.expected_date || 'N/A';
          const statusCell = row.insertCell(3);
          statusCell.textContent = (req.status || 'UNKNOWN').toUpperCase(); // Show load's status
          statusCell.className = `status-requested`; // Style as requested
          const priceCell = row.insertCell(4);
          priceCell.textContent = formatPrice(req.price);
          priceCell.style.textAlign = 'right';
          row.insertCell(5).innerHTML = formatDocuments(req.documents);
        });
      }
      if (pendingTableBody.rows.length === 0) {
        pendingTableBody.innerHTML = `<tr><td colspan="${colSpan}">You have no pending load requests.</td></tr>`;
      }

      // *** CRITICAL: Enable the share button ONLY IF there are active trips AND we are not already sharing ***
      if(hasActiveTrip && !activeSharingRef) {
           // Only enable if something is SELECTABLE in the dropdown
           shareButton.disabled = tripSelect.options.length <= 1; // Disabled if only placeholder
      }
      // In other cases (no active trips, or already sharing), the state set at the beginning is correct.

    })
    .catch(err => {
        console.error('Error fetching/processing driver jobs:', err);
        confirmedTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="color: red;">Error: ${err.message}</td></tr>`;
        pendingTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="color: red;">Could not load requests.</td></tr>`;
        shareButton.disabled = true; // Ensure disabled on error
        tripSelect.disabled = true;
    });
}

// --- 5. Function to load driver's history ---
function loadDriverHistory() {
    const historyTableBody = document.getElementById('trip-history-table');
    if (!historyTableBody) { console.warn("History table body element not found."); return; }
    const colSpan = 6;
    historyTableBody.innerHTML = `<tr><td colspan="${colSpan}">Loading trip history...</td></tr>`;

    fetch("/api/get_driver_history") // Use direct path
        .then(response => {
            if (!response.ok) { return response.json().then(err => { throw new Error(err.error || `Network error: ${response.statusText}`); }); }
            return response.json();
        })
        .then(data => {
            if (data.error) { throw new Error(data.error); }
            if (!Array.isArray(data)) { throw new Error("Invalid history data format."); }

            historyTableBody.innerHTML = '';
            if (data.length === 0) {
                historyTableBody.innerHTML = `<tr><td colspan="${colSpan}">No completed trips found.</td></tr>`; return;
            }
            data.forEach(job => {
                const row = historyTableBody.insertRow();
                row.insertCell(0).textContent = job.ref_number || 'N/A';
                row.insertCell(1).textContent = `${job.origin || 'N/A'} ➜ ${job.destination || 'N/A'}`;
                row.insertCell(2).textContent = job.expected_date || 'N/A';
                row.insertCell(3).textContent = job.sender_name || 'Unknown';
                const priceCell = row.insertCell(4);
                priceCell.textContent = formatPrice(job.price); priceCell.style.textAlign = 'right';
                row.insertCell(5).innerHTML = formatDocuments(job.documents);
            });
        })
        .catch(err => {
            console.error('Error fetching driver history:', err);
            historyTableBody.innerHTML = `<tr><td colspan="${colSpan}" style="color: red;">Error: ${err.message}</td></tr>`;
        });
}

// --- 6. Voice Assistant Logic (Keep as is) ---
const voiceAssistantBtn = document.getElementById('voice-assistant-btn');
const voiceStatus = document.getElementById('voice-status');
const voiceInputDisplay = document.getElementById('voice-input');
const voiceOutputDisplay = document.getElementById('voice-output');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
const synthesis = window.speechSynthesis;
let isListening = false;
if (voiceAssistantBtn && voiceStatus && voiceInputDisplay && voiceOutputDisplay) { /* ... (rest of voice assistant setup, speak, processVoiceCommand functions - keep from previous complete version) ... */
    if (!recognition || !synthesis) { voiceAssistantBtn.disabled = true; voiceStatus.textContent = 'Voice features not supported.'; console.warn("Web Speech API not supported."); }
    else {
        recognition.continuous = false; recognition.lang = 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
        voiceAssistantBtn.addEventListener('click', () => { if (!recognition) return; if (isListening) { recognition.stop(); } else { if(synthesis?.speaking){ synthesis.cancel(); } try { recognition.start(); } catch (error) { console.error("Speech start error:", error); voiceStatus.textContent = 'Error starting mic.'; isListening = false; voiceAssistantBtn.textContent = 'Activate'; voiceAssistantBtn.classList.remove('btn-sharing'); } } });
        recognition.onstart = () => { isListening = true; voiceStatus.textContent = '🎤 Listening...'; voiceAssistantBtn.textContent = 'Stop Listening'; voiceAssistantBtn.classList.add('btn-sharing'); voiceInputDisplay.textContent = '...'; voiceOutputDisplay.textContent = '...'; };
        recognition.onresult = (event) => { const transcript = event.results[0][0].transcript.toLowerCase().trim(); voiceInputDisplay.textContent = `"${transcript}"`; processVoiceCommand(transcript); };
        recognition.onerror = (event) => { console.error('Speech error:', event.error, event.message); let errorMsg = `Error: ${event.error}`; if (event.error === 'no-speech') errorMsg = "No speech detected."; else if (event.error === 'audio-capture') errorMsg = "Mic problem."; else if (event.error === 'not-allowed') { errorMsg = "Mic access denied."; voiceAssistantBtn.disabled = true; } else errorMsg = `Recognition error: ${event.error}`; voiceStatus.textContent = errorMsg; };
        recognition.onend = () => { isListening = false; if (!voiceAssistantBtn.disabled) { voiceAssistantBtn.textContent = 'Activate'; voiceAssistantBtn.classList.remove('btn-sharing'); } setTimeout(() => { const currentStatus = voiceStatus.textContent; if (!currentStatus.includes('denied') && !currentStatus.includes('not supported') && !currentStatus.includes('Mic problem')) { voiceStatus.textContent = ''; } }, 4000); };
    }
} else { console.warn("Voice UI elements not found."); }
function speak(text) { if (!synthesis) { console.warn("Speech synthesis not supported."); if (voiceOutputDisplay) voiceOutputDisplay.textContent = text + " (Speech N/A)"; return; } if (synthesis.speaking) { synthesis.cancel(); } const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-IN'; utterance.onstart = () => { if (voiceStatus) voiceStatus.textContent = '🗣️ Speaking...'; }; utterance.onend = () => { if (voiceStatus) voiceStatus.textContent = 'Ready.'; setTimeout(() => { if (voiceStatus?.textContent === 'Ready.') voiceStatus.textContent = ''; }, 2000); }; utterance.onerror = (event) => { console.error('Speech synth error:', event.error); if (voiceOutputDisplay) voiceOutputDisplay.textContent = `Speech error: ${event.error}`; if (voiceStatus) voiceStatus.textContent = 'Speech output error.'; }; if (voiceOutputDisplay) voiceOutputDisplay.textContent = text; synthesis.speak(utterance); }
function processVoiceCommand(command) { if (voiceStatus) voiceStatus.textContent = 'Processing...'; console.log(`Processing command: "${command}"`); if (command.includes("where am i")) { speak("Getting location..."); if (!navigator.geolocation) { speak("Location unavailable."); return; } navigator.geolocation.getCurrentPosition( (pos) => { speak(`Approx. lat ${pos.coords.latitude.toFixed(4)}, long ${pos.coords.longitude.toFixed(4)}.`); }, (err) => { speak(`Location error: ${err.message}.`); }, { timeout: 10000, enableHighAccuracy: true } ); } else if (command.startsWith("navigate to")) { const dest = command.replace("navigate to", "").trim(); speak(dest ? `Planning route to ${dest}. Use Smart Route feature.` : "Please specify destination."); } else if (command.includes("find loads")) { speak("Opening Load Matching page."); window.location.href = "/load_matching"; } else if (command.includes("stop sharing")) { const shareBtn = document.getElementById('share-location-btn'); const selectEl = document.getElementById('trip-select'); if (locationWatchId !== null) { speak("Stopping location sharing."); stopSharing(shareBtn, selectEl); } else { speak("Location sharing not active."); } } else if (command.includes("hello")) { speak("Hello! How can I assist?"); } else { speak("Command not recognized."); } }


// --- Initial Setup & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Driver dashboard DOM loaded.");
    loadDriverJobsAndDropdown(); // Load data and populate dropdown
    loadDriverHistory();

    const shareLocationButton = document.getElementById('share-location-btn');
    const tripSelectElement = document.getElementById('trip-select');

    if (shareLocationButton && tripSelectElement) {
        // Listener for the Share/Stop button
        shareLocationButton.addEventListener('click', function() {
            const selectedRef = tripSelectElement.value;
            if (activeSharingRef) { // If currently sharing -> Stop
                console.log("User clicked Stop sharing button.");
                stopSharing(this, tripSelectElement);
            } else { // Not sharing -> Start
                console.log("User clicked Start sharing button for:", selectedRef);
                startSharing(selectedRef, this, tripSelectElement);
            }
        });

        // *** ADDED: Listener for the dropdown selection change ***
        tripSelectElement.addEventListener('change', function() {
            // Enable the share button only if a valid trip is selected AND not currently sharing
            if (!activeSharingRef) {
                 shareButton.disabled = !this.value; // Disable if placeholder ("") is selected
            }
        });

    } else {
        console.error("CRITICAL ERROR: Share button or Trip select dropdown not found!");
    }
});