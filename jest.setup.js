const fs = require('fs');
const path = require('path');

// Read app.js
const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// We need to inject a dummy DOM structure for app.js to attach to without errors
document.body.innerHTML = `
    <form id="walk-form"></form>
    <input type="text" id="walk-name">
    <input type="checkbox" id="is-beach">
    <span id="loc-lat"></span>
    <span id="loc-lng"></span>
    <ul id="walks-list"></ul>
    <button id="cancel-btn"></button>
    <button id="save-btn"></button>
    <button id="editor-delete-btn"></button>
    <div id="list-view"></div>
    <div id="editor-view"></div>
    <div id="settings-view"></div>
    <div id="data-view"></div>
    <div id="info-view"></div>
    <button id="add-walk-btn"></button>
    <button id="settings-back-btn"></button>
    <button id="manage-data-btn"></button>
    <button id="data-back-btn"></button>
    <button id="info-back-btn"></button>
    <button id="info-edit-btn"></button>
    <h1 id="info-title"></h1>
    <div id="info-current-body"></div>
    <div id="forecast-log"></div>
    <button id="export-btn"></button>
    <button id="import-btn"></button>
    <input type="file" id="import-file">
    <button id="delete-all-btn"></button>
    <input type="number" id="set-temp-min">
    <input type="number" id="set-temp-max">
    <input type="number" id="set-wind-max">
    <input type="number" id="set-tide-window">
    <input type="checkbox" id="set-no-rain">
    <input type="checkbox" id="set-notifications">
    <div id="app-version"></div>
    <div id="map"></div>
    <div id="global-fetch-tracker"></div>
`;

// Mock Leaflet
window.L = {
    map: () => ({ setView: () => ({ locate: () => {}, on: () => {} }), locate: () => {}, on: () => {}, removeLayer: () => {}, invalidateSize: () => {} }),
    control: { zoom: () => ({ addTo: () => {} }) },
    tileLayer: () => ({ addTo: () => {} }),
    marker: () => ({ addTo: () => {}, setLatLng: () => {} })
};

// Mock IndexedDB
window.indexedDB = { 
    open: () => ({ 
        onupgradeneeded: null, 
        onsuccess: null, 
        onerror: null,
        result: {
            transaction: () => ({ objectStore: () => ({ getAll: () => ({onsuccess: null}) }) })
        }
    }) 
};

// Execute app.js in the context of JSDOM
// We use eval here to ensure variables like `escapeHTML` and `fetchInlineWeather` become global
window.eval(appCode);
