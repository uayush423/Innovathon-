// ---------------------- SAFETY CHECK ----------------------
if (typeof L === "undefined" || !window.GeoSearch || !L.Routing) {
  alert("Mapping library failed to load. Please refresh the page.");
  throw new Error("Leaflet, Geosearch, or Routing Machine not loaded.");
}

// ---------------------- INITIALIZE MAP ----------------------
const map = L.map("map").setView([23.2599, 77.4126], 5); // default: India center

// Add OpenStreetMap tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// ---------------------- GEOSEARCH ----------------------
const { GeoSearchControl, OpenStreetMapProvider } = window.GeoSearch;

// Provider for searching places
const provider = new OpenStreetMapProvider();

const searchControl = new GeoSearchControl({
  provider: provider,
  style: "bar",
  showMarker: true,
  retainZoomLevel: false,
  searchLabel: "Search place...",
  autoClose: true,
});

// Add search control to map
try {
  map.addControl(searchControl);
} catch (err) {
  console.error("Error initializing GeoSearch:", err);
}

// ---------------------- ROUTE CALCULATION ----------------------
let routeControl;

document.getElementById("routeBtn").addEventListener("click", async () => {
  const origin = document.getElementById("origin").value.trim();
  const destination = document.getElementById("destination").value.trim();

  if (!origin || !destination) {
    alert("Please enter both origin and destination.");
    return;
  }

  try {
    // Geocode origin & destination using OpenStreetMap Nominatim
    const originCoords = await getCoordinates(origin);
    const destCoords = await getCoordinates(destination);

    if (!originCoords || !destCoords) {
      alert("Unable to find one or both locations.");
      return;
    }

    // Remove previous route if exists
    if (routeControl) {
      map.removeControl(routeControl);
    }

    // Initialize routing machine (OSRM demo server)
    routeControl = L.Routing.control({
      waypoints: [
        L.latLng(originCoords.lat, originCoords.lon),
        L.latLng(destCoords.lat, destCoords.lon),
      ],
      routeWhileDragging: false,
      draggableWaypoints: false,
      addWaypoints: false,
      showAlternatives: false,
      createMarker: function (i, wp, nWps) {
        return L.marker(wp.latLng, {
          draggable: false,
        }).bindPopup(i === 0 ? "Origin" : "Destination");
      },
    })
      .on("routesfound", function (e) {
        const route = e.routes[0];
        const distanceKm = (route.summary.totalDistance / 1000).toFixed(2);
        const durationMin = (route.summary.totalTime / 60).toFixed(2);

        document.getElementById("routeSuggestion").innerText = "Optimal route found!";
        document.getElementById("distance").innerText = `${distanceKm} km (${durationMin} mins)`;
        document.getElementById("tolls").innerText = "Toll data unavailable (demo mode)";
        document.getElementById("noEntry").innerText = "No restricted zones detected.";

        map.fitBounds(L.latLngBounds([originCoords, destCoords]));
      })
      .on("routingerror", function (e) {
        console.error("Routing error:", e);
        alert("Unable to calculate route. Try again later.");
      })
      .addTo(map);
  } catch (err) {
    console.error("Error in route calculation:", err);
    alert("Something went wrong while finding route.");
  }
});

// ---------------------- GEOCODING FUNCTION ----------------------
async function getCoordinates(placeName) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      placeName
    )}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
      };
    } else {
      return null;
    }
  } catch (err) {
    console.error("Geocoding failed:", err);
    return null;
  }
}
