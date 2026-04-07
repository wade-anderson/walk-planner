// --- Configuration ---
const DB_NAME = 'WalkPlannerDB';
const DB_VERSION = 1;
const STORE_NAME = 'walks';

// --- State ---
let db;
let map;
let marker;
let currentLatLng = null; // {lat, lng}
let editingId = null;

// --- DOM Elements ---
const form = document.getElementById('walk-form');
const nameInput = document.getElementById('walk-name');
const descInput = document.getElementById('walk-desc');
const latDisplay = document.getElementById('loc-lat');
const lngDisplay = document.getElementById('loc-lng');
const walksList = document.getElementById('walks-list');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');

// View Elements
const listView = document.getElementById('list-view');
const editorView = document.getElementById('editor-view');
const addWalkBtn = document.getElementById('add-walk-btn');

// --- Initialization ---
async function initApp() {
    initMap();
    await initDB();
    setupEventListeners();
    await renderWalks();
}

// --- Map Logic ---
function initMap() {
    // Default to a central location (London) until geolocation loads
    map = L.map('map', {zoomControl: false}).setView([51.505, -0.09], 13);
    
    // Add Zoom control to bottom right so it doesn't clash with our UI
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Attempt to locate the user and pan the map to their position
    map.locate({setView: true, maxZoom: 14});

    map.on('locationerror', function(e) {
        console.warn('Geolocation access denied or failed. Using default fixed location.');
    });

    map.on('click', function(e) {
        setMapLocation(e.latlng.lat, e.latlng.lng);
    });
}

function setMapLocation(lat, lng, panTo = false) {
    currentLatLng = { lat, lng };
    
    // Update Display
    latDisplay.textContent = `Lat: ${lat.toFixed(4)}`;
    lngDisplay.textContent = `Lng: ${lng.toFixed(4)}`;

    // Manage Marker
    if (marker) {
        marker.setLatLng([lat, lng]);
    } else {
        marker = L.marker([lat, lng]).addTo(map);
    }

    if (panTo) {
        map.panTo([lat, lng]);
    }
}

// --- IndexedDB Logic ---
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (e) => {
            console.error('IndexedDB Error:', e.target.error);
            reject('Could not open IndexedDB');
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };

        request.onupgradeneeded = (e) => {
            let db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

function addWalk(walk) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(walk);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function updateWalk(walk) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(walk);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteWalk(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function getAllWalks() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// --- Weather Logic (Open-Meteo) ---
const wmoCodes = {
    0: 'Clear sky',
    1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    95: 'Thunderstorm'
};

async function fetchInlineWeather(lat, lng, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Weather fetch failed');
        const data = await res.json();

        const current = data.current;
        const temp = `${Math.round(current.temperature_2m)}°F`;
        const code = current.weather_code;
        const desc = wmoCodes[code] || 'Unknown';
        const wind = current.wind_speed_10m;

        el.innerHTML = `
            <span class="temp">${temp}</span>
            <span class="details">${desc} • Wind: ${wind} mph</span>
        `;
    } catch (err) {
        console.error(err);
        el.innerHTML = `<span class="details" style="color:var(--danger-color)">Weather unavailable</span>`;
    }
}

// --- UI & Event Listeners ---
function setupEventListeners() {
    form.addEventListener('submit', handleFormSubmit);
    cancelBtn.addEventListener('click', () => {
        resetForm();
        showListView();
    });
    addWalkBtn.addEventListener('click', () => {
        resetForm();
        showEditorView();
        if (map) {
            map.locate({setView: true, maxZoom: 14});
        }
    });
}

function showListView() {
    editorView.classList.add('hidden');
    listView.classList.remove('hidden');
}

function showEditorView() {
    listView.classList.add('hidden');
    editorView.classList.remove('hidden');
    if (map) {
        setTimeout(() => map.invalidateSize(), 10);
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    if (!currentLatLng) {
        alert("Please click on the map to set a location for your walk.");
        return;
    }

    const walkData = {
        name: nameInput.value.trim(),
        description: descInput.value.trim(),
        lat: currentLatLng.lat,
        lng: currentLatLng.lng,
        updatedAt: Date.now()
    };

    if (editingId) {
        walkData.id = editingId;
        await updateWalk(walkData);
    } else {
        await addWalk(walkData);
    }

    resetForm();
    await renderWalks();
    showListView();
}

function resetForm() {
    form.reset();
    editingId = null;
    currentLatLng = null;
    latDisplay.textContent = 'Lat: --';
    lngDisplay.textContent = 'Lng: --';
    if (marker) {
        map.removeLayer(marker);
        marker = null;
    }
    saveBtn.textContent = 'Save';
}

async function renderWalks() {
    walksList.innerHTML = '';
    const walks = await getAllWalks();

    // Sort by newest first
    walks.sort((a, b) => b.updatedAt - a.updatedAt);

    if (walks.length === 0) {
        walksList.innerHTML = '<li style="color:var(--text-muted);font-size:0.9rem;text-align:center;">No walks saved yet. Click Add New Walk!</li>';
        return;
    }

    walks.forEach(walk => {
        const li = document.createElement('li');
        li.className = 'walk-item';
        
        li.innerHTML = `
            <div class="walk-item-header">
                <span class="walk-title">${escapeHTML(walk.name)}</span>
            </div>
            <div class="walk-desc">${escapeHTML(walk.description)}</div>
            <div class="inline-weather" id="weather-${walk.id}">
                <div class="spinner"></div><span class="details">Loading weather...</span>
            </div>
            <div class="walk-actions">
                <button class="icon-btn edit">Edit</button>
                <button class="icon-btn delete">Delete</button>
            </div>
        `;

        // Action listeners
        const editBtn = li.querySelector('.edit');
        const deleteBtn = li.querySelector('.delete');

        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEditing(walk);
        });

        let deleteConfirm = false;
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!deleteConfirm) {
                deleteBtn.textContent = 'Sure?';
                deleteBtn.style.color = 'var(--danger-hover)';
                deleteConfirm = true;
                
                // Reset back to normal after 3 seconds
                setTimeout(() => {
                    if (deleteBtn.isConnected) { // Only if still in DOM
                        deleteConfirm = false;
                        deleteBtn.textContent = 'Delete';
                        deleteBtn.style.color = '';
                    }
                }, 3000);
            } else {
                await deleteWalk(walk.id);
                if (editingId === walk.id) resetForm();
                await renderWalks();
            }
        });

        walksList.appendChild(li);
        fetchInlineWeather(walk.lat, walk.lng, `weather-${walk.id}`);
    });
}

function startEditing(walk) {
    editingId = walk.id;
    nameInput.value = walk.name;
    descInput.value = walk.description;
    setMapLocation(walk.lat, walk.lng, true);
    
    saveBtn.textContent = 'Save';
    showEditorView();
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
