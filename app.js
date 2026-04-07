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
let weatherIntervals = []; // Active polling intervals

// --- DOM Elements ---
const form = document.getElementById('walk-form');
const nameInput = document.getElementById('walk-name');
const isBeachInput = document.getElementById('is-beach');
const latDisplay = document.getElementById('loc-lat');
const lngDisplay = document.getElementById('loc-lng');
const walksList = document.getElementById('walks-list');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');
const editorDeleteBtn = document.getElementById('editor-delete-btn');

// View Elements
const listView = document.getElementById('list-view');
const editorView = document.getElementById('editor-view');
const settingsView = document.getElementById('settings-view');
const addWalkBtn = document.getElementById('add-walk-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');

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
        map.setView([lat, lng], 15); // Enforces a zoom-in behavior
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

function clearAllWalks() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
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

async function fetchInlineWeather(lat, lng, elementId, retries = 3) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Weather fetch failed');
        const data = await res.json();

        const current = data.current;
        const temp = `${Math.round(current.temperature_2m)}°F`;
        const feelsLike = Math.round(current.apparent_temperature);
        const code = current.weather_code;
        const desc = wmoCodes[code] || 'Unknown';
        const wind = current.wind_speed_10m;

        el.innerHTML = `
            <span class="temp">${temp}</span>
            <span class="details">Feels like ${feelsLike}°F • ${desc} • Wind: ${wind} mph</span>
        `;
        
        return { feelsLike, wind, weatherCode: code };
    } catch (err) {
        if (retries > 0) {
            el.innerHTML = `<div class="spinner" style="width:15px; height:15px; margin: 0;"></div><span class="details" style="margin-left: 8px;">...</span>`;
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(fetchInlineWeather(lat, lng, elementId, retries - 1));
                }, 1000);
            });
        } else {
            console.error('Weather retries exhausted:', err);
            el.innerHTML = `<span class="details" style="color:var(--danger-color)">Weather unavailable</span>`;
            return null;
        }
    }
}

async function fetchInlineTide(lat, lng, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    try {
        const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=sea_level_height_msl&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Marine fetch failed');
        const data = await res.json();

        // data.hourly.sea_level might not be available for deeply inland coordinates
        if (!data.hourly || !data.hourly.sea_level_height_msl || data.hourly.sea_level_height_msl.every(v => v === null)) {
             el.innerHTML = `<span class="details" style="color:var(--text-muted)">No tide data (inland location)</span>`;
             return;
        }

        const times = data.hourly.time;
        const levels = data.hourly.sea_level_height_msl;
        
        const now = new Date();
        let nextLowIdx = -1;
        let isTideSafe = false;
        let foundTrend = false;
        
        for (let i = 1; i < times.length - 1; i++) {
            const timeDate = new Date(times[i]);
            if (timeDate > now) {
                if (!foundTrend) {
                    // Safe if sea level is rising (incoming) or perfectly flat bottomed
                    isTideSafe = levels[i] >= levels[i-1];
                    foundTrend = true;
                }

                // Valid lowest point
                if (levels[i] <= levels[i-1] && levels[i] < levels[i+1]) {
                    nextLowIdx = i;
                    break;
                }
            }
        }
        
        if (nextLowIdx !== -1) {
            const lowTime = new Date(times[nextLowIdx]);
            const timeStr = lowTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            el.innerHTML = `
                <span class="temp" style="font-size:1.3rem;">🌊</span>
                <span class="details" style="color: #60a5fa; font-weight: 500;">Next low tide: ${timeStr}</span>
            `;
        } else {
            el.innerHTML = `<span class="details" style="color:var(--text-muted)">Tide data unavailable</span>`;
        }
        
        return { isTideSafe };
    } catch (err) {
        console.error('Tide Error', err);
        el.innerHTML = `<span class="details" style="color:var(--danger-color)">Marine data error</span>`;
        return null;
    }
}

async function evaluateWalkStatus(walk, li) {
    const weatherData = await fetchInlineWeather(walk.lat, walk.lng, `weather-${walk.id}`);
    
    let tideData = null;
    if (walk.isBeach) {
        tideData = await fetchInlineTide(walk.lat, walk.lng, `tide-${walk.id}`);
    }

    // Default unassigned order
    li.style.order = 3;
    li.classList.remove('walk-go', 'walk-nogo');

    if (weatherData) {
        let isGo = true;
        
        // Rule: Feels like temperature is between 68 and 80 degrees F
        if (weatherData.feelsLike < 68 || weatherData.feelsLike > 80) isGo = false;
        
        // Rule: Wind speed is below 15 mph
        if (weatherData.wind >= 15) isGo = false;
        
        // Rule: It should not be raining (Codes 50+ are drizzle, rain, snow, thunder)
        if (weatherData.weatherCode >= 50) isGo = false;

        // Rule: If it's a beach walk, the tide should be low or incoming currently
        if (walk.isBeach) {
            if (!tideData || !tideData.isTideSafe) isGo = false;
        }

        if (isGo) {
            li.classList.add('walk-go');
            li.style.order = 1;
        } else {
            li.classList.add('walk-nogo');
            li.style.order = 2;
        }
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

    let deleteConfirm = false;
    editorDeleteBtn.addEventListener('click', async () => {
        if (!editingId) return; // Should not happen

        if (!deleteConfirm) {
            editorDeleteBtn.textContent = 'Sure?';
            deleteConfirm = true;
            
            // Reset back to normal after 3 seconds
            setTimeout(() => {
                if (editorDeleteBtn.isConnected) {
                    deleteConfirm = false;
                    editorDeleteBtn.textContent = 'Delete';
                }
            }, 3000);
        } else {
            // Confirmed delete
            await deleteWalk(editingId);
            resetForm();
            await renderWalks();
            showListView();
            deleteConfirm = false; // reset for next time
            editorDeleteBtn.textContent = 'Delete';
        }
    });

    // --- Data Management UI Events ---
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFile = document.getElementById('import-file');
    const deleteAllBtn = document.getElementById('delete-all-btn');

    exportBtn.addEventListener('click', async () => {
        const walks = await getAllWalks();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(walks, null, 2));
        const anchor = document.createElement('a');
        anchor.setAttribute("href", dataStr);
        anchor.setAttribute("download", "walk_planner_backup.json");
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    });

    importBtn.addEventListener('click', () => importFile.click());

    importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (Array.isArray(importedData)) {
                    for (const walk of importedData) {
                        delete walk.id; // Force IndexedDB to generate a new clean ID
                        await addWalk(walk);
                    }
                    await renderWalks();
                    alert("Backup data imported successfully!");
                } else {
                    alert("Invalid backup format.");
                }
            } catch (err) {
                alert("Error importing backup data.");
            }
            importFile.value = ''; // reset so we can upload same file again if desired
        };
        reader.readAsText(file);
    });

    let deleteAllConfirm = false;
    deleteAllBtn.addEventListener('click', async () => {
        if (!deleteAllConfirm) {
            deleteAllBtn.textContent = 'Are you sure?';
            deleteAllConfirm = true;
            setTimeout(() => {
                if (deleteAllBtn.isConnected) {
                    deleteAllConfirm = false;
                    deleteAllBtn.textContent = 'Delete All Data';
                }
            }, 3000);
        } else {
            await clearAllWalks();
            await renderWalks();
            deleteAllConfirm = false;
            deleteAllBtn.textContent = 'Delete All Data';
            alert("All walks deleted.");
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
        isBeach: isBeachInput.checked,
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
    isBeachInput.checked = false;
    editingId = null;
    currentLatLng = null;
    latDisplay.textContent = 'Lat: --';
    lngDisplay.textContent = 'Lng: --';
    if (marker) {
        map.removeLayer(marker);
        marker = null;
    }
    saveBtn.textContent = 'Save';
    editorDeleteBtn.classList.add('hidden');
    editorDeleteBtn.textContent = 'Delete';
}

async function renderWalks() {
    weatherIntervals.forEach(clearInterval);
    weatherIntervals = [];
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
        
        let tideHtml = '';
        if (walk.isBeach) {
            tideHtml = `
            <div class="inline-weather" id="tide-${walk.id}" style="margin-top: 4px; padding-top:4px; border:none; min-height:30px;">
                <div class="spinner" style="width:15px; height:15px; margin: 0;"></div><span class="details" style="margin-left: 8px;">Loading tide...</span>
            </div>`;
        }

        li.innerHTML = `
            <div class="walk-item-header">
                <span class="walk-title">${escapeHTML(walk.name)}</span>
            </div>
            <div class="inline-weather" id="weather-${walk.id}">
                <div class="spinner"></div><span class="details">Loading weather...</span>
            </div>
            ${tideHtml}
        `;

        li.addEventListener('click', () => {
            startEditing(walk);
        });

        walksList.appendChild(li);
        
        // Initial fetch and 60-second polling evaluation
        evaluateWalkStatus(walk, li);
        weatherIntervals.push(setInterval(() => {
            evaluateWalkStatus(walk, li);
        }, 60000));
    });
}

function startEditing(walk) {
    editingId = walk.id;
    nameInput.value = walk.name;
    isBeachInput.checked = walk.isBeach || false;
    
    saveBtn.textContent = 'Save';
    editorDeleteBtn.classList.remove('hidden');
    showEditorView();

    // Delay the map targeting until after the view is unhidden to prevent offset bugs
    setTimeout(() => {
        if (map) {
            setMapLocation(walk.lat, walk.lng, true);
        }
    }, 20);
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
