# 🚶 Walk Planner

A modern, high-performance Progressive Web App (PWA) designed to help you find the perfect time for your walks based on real-time weather and tidal conditions.

![Walk Planner Icon](icon.png)

## 🌟 Overview

Walk Planner is a clean, glassmorphism-inspired application that automates the "Is it a good time for a walk?" decision. By combining high-resolution climatic data with marine tidal forecasts, it provides a simple "Go" or "No-Go" status for all your favorite walking routes.

## ✨ Key Features

-   **🌡️ Weather-Aware Logic**: Automatically evaluates walking conditions based on your custom thresholds:
    *   "Feels Like" Temperature (Min/Max)
    *   Maximum Wind Speed
    *   Rain/Precipitation status
-   **🌊 Coastal Tide Tracking**: Specialized logic for beach walks.
    *   Uses Open-Meteo Marine API for live tide trends.
    *   Calculates a configurable safety window (e.g., ±2 hours of low tide).
-   **📅 7-Day Matrix Forecast**:
    *   Visualizes daylight hour "Go/No-Go" status for the next week.
    *   Compact, color-coded interface for quick scanning.
-   **📍 Interactive Map**: Easily set walk locations using an integrated Leaflet.js map with OpenStreetMap data.
-   **📱 PWA & Offline-First**:
    *   Installable on iOS, Android, and Desktop.
    *   Service Worker caching for offline access to UI and map assets.
-   **🔔 background Notifications**: Opt-in to receive daily alerts when your walks transition to "Go" status.
-   **💾 Data Management**: 
    *   Local persistence via IndexedDB and LocalStorage.
    *   Full backup/restore functionality via JSON export/import.

## 🛠️ Tech Stack

-   **Frontend**: Vanilla JavaScript (ES6+), HTML5, Native CSS3.
-   **Maps**: Leaflet.js & OpenStreetMap.
-   **Weather Data**: [Open-Meteo API](https://open-meteo.com/).
-   **Storage**: IndexedDB (Walks & Notifications), LocalStorage (Settings).
-   **Architecture**: Service Workers for PWA capabilities and Notification API for alerts.

## 🚀 Getting Started

### Prerequisites
None! The app is built with zero dependencies beyond the external CDNs for Leaflet and Google Fonts.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/walk-planner.git
   ```
2. Open `index.html` in any modern web browser.
3. (Optional) For the best PWA experience, serve the directory using a simple HTTP server (like `npx serve`) and "Add to Home Screen" on your mobile device.

## 🏗️ Architecture

The application follows a modular, single-page architecture:
-   **State Management**: Asynchronous polling loop (every 60 minutes) to refresh climatic conditions.
-   **Routing**: Overlay-based layer routing for List, Editor, Info, and Settings views.
-   **Sorting**: Dynamic DOM reordering using CSS Flexbox `order` based on walk status.
-   **Persistence**: Unified backup logic utilizing the FileReader API and Blob serialization.

## 📄 License
This project is open-source and available under the MIT License.
