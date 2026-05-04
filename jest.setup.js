const fs = require('fs');
const path = require('path');
require('fake-indexeddb/auto');

// Polyfill structuredClone for JSDOM if missing
if (typeof structuredClone === 'undefined') {
    global.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}

// Read app.js
const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// Inject a full dummy DOM structure for app.js to attach to
document.body.innerHTML = `
    <div id="list-view" class="view-container">
        <ul id="walks-list"></ul>
        <button id="add-walk-btn"></button>
        <div id="global-fetch-tracker"></div>
    </div>
    <div id="editor-view" class="view-container hidden">
        <form id="walk-form">
            <input type="text" id="walk-name">
            <input type="checkbox" id="is-beach">
            <span id="loc-lat"></span>
            <span id="loc-lng"></span>
            <button id="save-btn"></button>
            <button id="cancel-btn"></button>
            <button id="editor-delete-btn" class="hidden"></button>
        </form>
        <div id="map"></div>
    </div>
    <div id="settings-view" class="view-container hidden">
        <input type="number" id="set-temp-min">
        <input type="number" id="set-temp-max">
        <input type="number" id="set-wind-max">
        <input type="number" id="set-tide-window">
        <input type="checkbox" id="set-no-rain">
        <input type="checkbox" id="set-notifications">
        <button id="settings-back-btn"></button>
        <button id="manage-data-btn"></button>
        <div id="app-version"></div>
    </div>
    <div id="data-view" class="view-container hidden">
        <button id="export-btn"></button>
        <button id="import-btn"></button>
        <input type="file" id="import-file">
        <button id="delete-all-btn"></button>
        <button id="data-back-btn"></button>
    </div>
    <div id="info-view" class="view-container hidden">
        <h1 id="info-title"></h1>
        <div id="info-current-body"></div>
        <div id="forecast-log"></div>
        <button id="info-back-btn"></button>
        <button id="info-edit-btn"></button>
    </div>
`;

// Mock Leaflet
window.L = {
    map: jest.fn().mockReturnValue({
        setView: jest.fn().mockReturnThis(),
        locate: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(),
        removeLayer: jest.fn().mockReturnThis(),
        invalidateSize: jest.fn().mockReturnThis(),
        addControl: jest.fn().mockReturnThis()
    }),
    control: {
        zoom: jest.fn().mockReturnValue({ addTo: jest.fn() })
    },
    tileLayer: jest.fn().mockReturnValue({ addTo: jest.fn() }),
    marker: jest.fn().mockReturnValue({
        addTo: jest.fn().mockReturnThis(),
        setLatLng: jest.fn().mockReturnThis()
    })
};

// Mock Notification API
window.Notification = jest.fn();
window.Notification.permission = 'granted';
window.Notification.requestPermission = jest.fn().mockResolvedValue('granted');

// Mock localStorage
const localStorageMock = (function() {
    let store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value.toString(); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock alert
window.alert = jest.fn();

// Execute app.js in the context of JSDOM
// We use eval here to ensure variables like `escapeHTML` and `fetchInlineWeather` become global
// We explicitly attach let/const variables to window so they are accessible in tests
window.eval(appCode + "\n; window.userSettings = userSettings; window.db = db; window.initApp = initApp; window.initMap = initMap;");

// Ensure globals are shared with Node's global for easy access in tests
global.escapeHTML = window.escapeHTML;
global.fetchInlineWeather = window.fetchInlineWeather;
global.evaluateWalkStatus = window.evaluateWalkStatus;
global.initDB = window.initDB;
global.addWalk = window.addWalk;
global.updateWalk = window.updateWalk;
global.deleteWalk = window.deleteWalk;
global.getAllWalks = window.getAllWalks;
global.clearAllWalks = window.clearAllWalks;
global.saveSettings = window.saveSettings;
global.loadSettings = window.loadSettings;
global.userSettings = window.userSettings;
