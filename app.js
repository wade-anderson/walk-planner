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
const weatherCache = {};
const tideCache = {};

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
const infoView = document.getElementById('info-view');

const addWalkBtn = document.getElementById('add-walk-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const infoBackBtn = document.getElementById('info-back-btn');
const infoEditBtn = document.getElementById('info-edit-btn');
const infoTitle = document.getElementById('info-title');
const infoCurrentBody = document.getElementById('info-current-body');
const forecastLog = document.getElementById('forecast-log');

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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code&hourly=apparent_temperature,wind_speed_10m,weather_code,is_day&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph`;
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
        
        return { feelsLike, wind, weatherCode: code, hourly: data.hourly };
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
        
        const lowTideIndices = [];
        for (let i = 1; i < times.length - 1; i++) {
            if (levels[i] <= levels[i-1] && levels[i] <= levels[i+1]) {
                lowTideIndices.push(i);
            }
        }
        
        let currentHourIdx = -1;
        for (let i = 0; i < times.length; i++) {
            if (new Date(times[i]) > now) {
                currentHourIdx = i - 1;
                if (currentHourIdx < 0) currentHourIdx = 0;
                break;
            }
        }
        
        if (currentHourIdx !== -1) {
            isTideSafe = lowTideIndices.some(lowIdx => Math.abs(currentHourIdx - lowIdx) <= 2);
            
            const futureLows = lowTideIndices.filter(idx => idx > currentHourIdx);
            if (futureLows.length > 0) {
                nextLowIdx = futureLows[0];
            }
        }
        
        if (nextLowIdx !== -1) {
            const lowTime = new Date(times[nextLowIdx]);
            let prettyTime = lowTime.toLocaleTimeString([], {hour: 'numeric'});
            el.innerHTML = `
                <span class="temp" style="font-size:1.3rem;">🌊</span>
                <span class="details" style="color: #60a5fa; font-weight: 500;">Next low tide: ${prettyTime}</span>
            `;
        } else {
            el.innerHTML = `<span class="details" style="color:var(--text-muted)">Tide data unavailable</span>`;
        }
        
        return { isTideSafe, lowTideIndices, times };
    } catch (err) {
        console.error('Tide Error', err);
        el.innerHTML = `<span class="details" style="color:var(--danger-color)">Marine data error</span>`;
        return null;
    }
}

async function evaluateWalkStatus(walk, li) {
    const weatherData = await fetchInlineWeather(walk.lat, walk.lng, `weather-${walk.id}`);
    if (weatherData) weatherCache[walk.id] = weatherData;
    
    let tideData = null;
    if (walk.isBeach) {
        tideData = await fetchInlineTide(walk.lat, walk.lng, `tide-${walk.id}`);
        if (tideData) tideCache[walk.id] = tideData;
    }

    if (!weatherData) return false;

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

        if (weatherData.hourly && weatherData.hourly.time) {
            const hourly = weatherData.hourly;
            const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            
            const dayStatusMap = {};
            const orderedDates = [];
            
            for (let i = 0; i < hourly.time.length; i++) {
                const timeStr = hourly.time[i];
                const dateStr = timeStr.substring(0, 10);
                
                if (!dayStatusMap.hasOwnProperty(dateStr)) {
                    dayStatusMap[dateStr] = false;
                    orderedDates.push(dateStr);
                }
                
                if (dayStatusMap[dateStr]) continue;
                
                const isDaylight = hourly.is_day[i] === 1;
                if (!isDaylight) continue;
                
                const temp = hourly.apparent_temperature[i];
                const wind = hourly.wind_speed_10m[i];
                const wCode = hourly.weather_code[i];
                
                if (temp >= 68 && temp <= 80 && wind < 15 && wCode < 50) {
                    dayStatusMap[dateStr] = true;
                }
            }
            
            let forecastHtml = `<div class="forecast-row">`;
            const renderDays = Math.min(7, orderedDates.length);
            for (let j = 0; j < renderDays; j++) {
                const dateStr = orderedDates[j];
                const dateObj = new Date(dateStr + "T00:00:00");
                const dayName = daysOfWeek[dateObj.getDay()];
                const tintClass = dayStatusMap[dateStr] ? 'forecast-go' : 'forecast-nogo';
                forecastHtml += `<div class="forecast-badge ${tintClass}">${dayName}</div>`;
            }
            forecastHtml += `</div>`;
            
            let forecastContainer = li.querySelector('.forecast-container');
            if (!forecastContainer) {
                forecastContainer = document.createElement('div');
                forecastContainer.className = 'forecast-container';
                li.appendChild(forecastContainer);
            }
            forecastContainer.innerHTML = forecastHtml;
        }
        
        return true;
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

    infoBackBtn.addEventListener('click', () => {
        infoView.classList.add('hidden');
        listView.classList.remove('hidden');
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

        li.addEventListener('click', (e) => {
            // Prevent interference if we click inside something heavily nested
            e.stopPropagation();
            openInformationView(walk);
        });

        walksList.appendChild(li);
        
        let failCount = 0;
        let intervalId = null;

        const executeTick = async () => {
            const success = await evaluateWalkStatus(walk, li);
            if (!success) {
                failCount++;
                if (failCount >= 3) {
                    clearInterval(intervalId);
                    const el = document.getElementById(`weather-${walk.id}`);
                    if (el) el.innerHTML = `<span class="details" style="color:var(--danger-color)">API Blocked (3 Failures)</span>`;
                }
            } else {
                failCount = 0;
            }
        };

        // Initial fetch and throttled 15-minute polling evaluation
        executeTick();
        intervalId = setInterval(executeTick, 900000);
        weatherIntervals.push(intervalId);
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

function openInformationView(walk) {
    listView.classList.add('hidden');
    infoView.classList.remove('hidden');
    
    infoTitle.textContent = walk.name;
    infoEditBtn.onclick = () => {
        infoView.classList.add('hidden');
        startEditing(walk);
    };

    const wData = weatherCache[walk.id];
    const tData = tideCache[walk.id];
    
    if (wData) {
        const desc = wmoCodes[wData.weatherCode] || 'Unknown';
        let tideStr = walk.isBeach ? (tData && tData.isTideSafe !== undefined ? `<br>Tide constraint: ${tData.isTideSafe ? 'Safe' : 'Unfavorable'}` : `<br>Tide pending...`) : '';
        infoCurrentBody.innerHTML = `
            <div style="font-size: 1.1rem; font-weight: 600;">Feels like ${wData.feelsLike}°F</div>
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">Wind: ${wData.wind} mph • ${desc} ${tideStr}</div>
        `;

        if (wData.hourly && wData.hourly.time) {
            const hourly = wData.hourly;
            const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            let currentDayStr = "";
            let htmlAssembler = "";
            let currentDayDetailsHtml = "";
            
            for (let i = 0; i < hourly.time.length; i++) {
                const isDaylight = hourly.is_day[i] === 1;
                if (!isDaylight) continue; // Skip non-daylight hours entirely
                
                const timeStr = hourly.time[i]; 
                const dateStr = timeStr.substring(0, 10);
                
                if (dateStr !== currentDayStr) {
                    if (currentDayStr !== "") {
                        htmlAssembler += `</div>`;
                        htmlAssembler += `<button class="detail-btn" onclick="toggleDailyDetails(this)">Detail</button>`;
                        htmlAssembler += `<div class="daily-detailed-list hidden">${currentDayDetailsHtml}</div>`;
                        htmlAssembler += `</div>`;
                        currentDayDetailsHtml = "";
                    } 
                    const dateObj = new Date(dateStr + "T00:00:00");
                    const fullDayName = `${daysOfWeek[dateObj.getDay()]}, ${dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                    
                    let tideLabelHtml = '';
                    if (walk.isBeach && tData && tData.lowTideIndices) {
                        const dayLowTides = [];
                        tData.lowTideIndices.forEach(idx => {
                            const tStr = tData.times[idx];
                            if (tStr.startsWith(dateStr)) {
                                const wIdx = hourly.time.indexOf(tStr);
                                if (wIdx !== -1 && hourly.is_day[wIdx] === 1) {
                                    const tideTime = new Date(tStr);
                                    let prettyTide = tideTime.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
                                    dayLowTides.push(prettyTide);
                                }
                            }
                        });
                        
                        if (dayLowTides.length > 0) {
                            tideLabelHtml = `<span class="day-tide-label">Low Tide: ${dayLowTides.join(', ')}</span>`;
                        } else {
                            tideLabelHtml = `<span class="day-tide-label">No Daylight Low Tide</span>`;
                        }
                    }
                    
                    htmlAssembler += `<div class="day-group"><h3><span>${fullDayName}</span>${tideLabelHtml}</h3><div class="hour-pill-container">`;
                    currentDayStr = dateStr;
                }
                
                const temp = hourly.apparent_temperature[i];
                const wind = hourly.wind_speed_10m[i];
                const wCode = hourly.weather_code[i];
                
                const isTempOk = temp >= 68 && temp <= 80;
                const isWindOk = wind < 15;
                const isWeatherOk = wCode < 50;
                
                let isHourGo = isTempOk && isWindOk && isWeatherOk; 
                let tideDescStr = "";
                
                if (walk.isBeach && tData && tData.lowTideIndices) {
                    const tideIdx = tData.times.indexOf(timeStr);
                    if (tideIdx !== -1) {
                         const isTideValid = tData.lowTideIndices.some(lowIdx => Math.abs(tideIdx - lowIdx) <= 2);
                         if (!isTideValid) {
                             isHourGo = false;
                             tideDescStr = " • High Tide/Dangerous";
                         } else {
                             tideDescStr = " • Safe Low Tide bounds";
                         }
                    }
                }
                
                const tintClass = isHourGo ? 'hour-go' : 'hour-nogo';

                const hourDateObj = new Date(timeStr);
                let hourNum = hourDateObj.getHours() % 12;
                if (hourNum === 0) hourNum = 12;
                const compactTime = hourNum.toString();
                
                htmlAssembler += `<div class="hour-pill ${tintClass}">${compactTime}</div>`;
                
                const codeDesc = wmoCodes[wCode] || 'Clear';
                const prettyStr = hourDateObj.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
                const statusLabel = isHourGo ? 'GO' : 'NO';
                
                currentDayDetailsHtml += `
                    <div class="hour-record ${tintClass}">
                        <div class="hour-time">${prettyStr}</div>
                        <div class="hour-details" style="font-weight:800; margin-right: 15px;">[${statusLabel}]</div>
                        <div class="hour-details">${Math.round(temp)}°F • ${Math.round(wind)} mph • ${codeDesc}${tideDescStr}</div>
                    </div>
                `;
            }
            if (currentDayStr !== "") {
                htmlAssembler += `</div>`;
                htmlAssembler += `<button class="detail-btn" onclick="toggleDailyDetails(this)">Detail</button>`;
                htmlAssembler += `<div class="daily-detailed-list hidden">${currentDayDetailsHtml}</div>`;
                htmlAssembler += `</div>`;
            }
            forecastLog.innerHTML = htmlAssembler;
        } else {
            forecastLog.innerHTML = `<p style="color:var(--text-muted);">Forecast calculating...</p>`;
        }
    } else {
        infoCurrentBody.innerHTML = `<p style="color:var(--text-muted);">Calculating live conditions...</p>`;
        forecastLog.innerHTML = `<p style="color:var(--text-muted);">Calculating live forecasts...</p>`;
    }
}

// UI details accordion handler
function toggleDailyDetails(btn) {
    const targetList = btn.nextElementSibling;
    const isCurrentlyHidden = targetList.classList.contains('hidden');
    
    // Auto collapse all other days explicitly
    document.querySelectorAll('.daily-detailed-list').forEach(list => list.classList.add('hidden'));
    document.querySelectorAll('.detail-btn').forEach(b => b.textContent = 'Detail');
    
    if (isCurrentlyHidden) {
        targetList.classList.remove('hidden');
        btn.textContent = 'Hide Details';
    }
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
