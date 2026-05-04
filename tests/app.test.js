describe('Walk Planner', () => {
    
    describe('Security & Sanitization', () => {
        it('escapeHTML should safely encode HTML characters', () => {
            const maliciousPayload = `<script>alert("XSS & 'pwned'")</script>`;
            const escaped = escapeHTML(maliciousPayload);
            
            expect(escaped).not.toContain('<script>');
            expect(escaped).toContain('&lt;script&gt;');
            expect(escaped).toContain('&quot;XSS');
            expect(escaped).toContain('&#039;pwned&#039;');
            expect(escaped).toContain('&amp;');

            const nonStringPayload = 12345;
            const escapedNonString = escapeHTML(nonStringPayload);
            expect(escapedNonString).toBe('');
        });

        it('fetchInlineWeather should prevent parameter injection by casting to Number', async () => {
            const originalFetch = window.fetch;
            let lastFetchUrl = '';
            
            window.fetch = jest.fn().mockImplementation(async (url) => {
                lastFetchUrl = url;
                return { ok: true, json: async () => ({ current: {}, hourly: {} }) };
            });

            const maliciousLat = "51.5&malicious=true";
            const maliciousLng = "0.1";

            const el = document.createElement('div');
            el.id = 'weather-test-123';
            document.body.appendChild(el);

            await fetchInlineWeather(maliciousLat, maliciousLng, 'weather-test-123');

            expect(lastFetchUrl).toContain('latitude=0');
            expect(lastFetchUrl).not.toContain('&malicious=true&');

            window.fetch = originalFetch;
            el.remove();
        });
    });

    describe('Database (IndexedDB)', () => {
        beforeEach(async () => {
            if (!window.db) await initDB();
            await clearAllWalks();
        });

        it('should add and retrieve walks', async () => {
            const walk = { name: 'Morning Walk', isBeach: false, lat: 51.5, lng: -0.1, updatedAt: Date.now() };
            await addWalk(walk);
            
            const allWalks = await getAllWalks();
            expect(allWalks.length).toBe(1);
            expect(allWalks[0].name).toBe('Morning Walk');
        });
    });

    describe('Evaluation Logic', () => {
        let li, weatherEl, tideEl;

        beforeEach(() => {
            // Reset settings to defaults
            userSettings.tempMin = 68;
            userSettings.tempMax = 80;
            userSettings.windMax = 15;
            userSettings.noRain = true;
            userSettings.tideWindow = 2;

            li = document.createElement('li');
            li.id = 'walk-item-test';
            document.body.appendChild(li);

            weatherEl = document.createElement('div');
            weatherEl.id = 'weather-test';
            document.body.appendChild(weatherEl);

            tideEl = document.createElement('div');
            tideEl.id = 'tide-test';
            document.body.appendChild(tideEl);
        });

        afterEach(() => {
            li.remove();
            weatherEl.remove();
            tideEl.remove();
        });

        it('should mark a walk as GO when conditions are perfect', async () => {
            const walk = { id: 'test', name: 'Perfect Walk', isBeach: false, lat: 51.5, lng: -0.1 };
            
            window.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    current: { temperature_2m: 72, apparent_temperature: 72, wind_speed_10m: 5, weather_code: 0 },
                    hourly: { time: [], apparent_temperature: [], wind_speed_10m: [], weather_code: [], is_day: [] }
                })
            });

            await evaluateWalkStatus(walk, li);
            expect(li.classList.contains('walk-go')).toBe(true);
        });

        it('should mark a walk as NOGO when it is too windy', async () => {
            const walk = { id: 'test', name: 'Windy Walk', isBeach: false, lat: 51.5, lng: -0.1 };
            
            window.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    current: { temperature_2m: 72, apparent_temperature: 72, wind_speed_10m: 25, weather_code: 0 },
                    hourly: { time: [], apparent_temperature: [], wind_speed_10m: [], weather_code: [], is_day: [] }
                })
            });

            await evaluateWalkStatus(walk, li);
            expect(li.classList.contains('walk-nogo')).toBe(true);
        });

        it('should mark a beach walk as NOGO during high tide', async () => {
            const walk = { id: 'test', name: 'High Tide Walk', isBeach: true, lat: 51.5, lng: -0.1 };
            
            window.fetch = jest.fn().mockImplementation((url) => {
                if (url.includes('api.open-meteo.com')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            current: { temperature_2m: 72, apparent_temperature: 72, wind_speed_10m: 5, weather_code: 0 },
                            hourly: { time: [], apparent_temperature: [], wind_speed_10m: [], weather_code: [], is_day: [] }
                        })
                    });
                } else if (url.includes('marine-api.open-meteo.com')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            hourly: {
                                time: [new Date().toISOString()],
                                sea_level_height_msl: [5.0] // High level
                            }
                        })
                    });
                }
            });

            await evaluateWalkStatus(walk, li);
            expect(li.classList.contains('walk-nogo')).toBe(true);
        });
    });

    describe('UI Navigation', () => {
        it('should switch to editor view when Add New Walk is clicked', () => {
            const addBtn = document.getElementById('add-walk-btn');
            const listView = document.getElementById('list-view');
            const editorView = document.getElementById('editor-view');
            
            addBtn.click();
            
            expect(listView.classList.contains('hidden')).toBe(true);
            expect(editorView.classList.contains('hidden')).toBe(false);
        });
    });

    describe('Settings', () => {
        it('should save settings to localStorage', () => {
            const tempMinInput = document.getElementById('set-temp-min');
            tempMinInput.value = '75';
            
            saveSettings();
            
            const stored = JSON.parse(window.localStorage.getItem('walkSettings'));
            expect(stored.tempMin).toBe(75);
        });
    });
});
