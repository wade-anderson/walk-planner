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

        it('should mark a walk as NOGO when it is too windy and temperature is in the bottom half of range', async () => {
            const walk = { id: 'test', name: 'Windy Walk', isBeach: false, lat: 51.5, lng: -0.1 };
            
            // userSettings.tempMin = 68, tempMax = 80, windMax = 15 (midpoint = 74)
            // apparent_temperature 72 is in the bottom half (<= 74)
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

        it('should mark a walk as GO when it is windy but temperature is in the top half of the range', async () => {
            const walk = { id: 'test', name: 'Warm Windy Walk', isBeach: false, lat: 51.5, lng: -0.1 };
            
            // userSettings.tempMin = 68, tempMax = 80, windMax = 15 (midpoint = 74)
            // apparent_temperature 76 is in the top half (> 74), so max wind speed is not a factor
            window.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    current: { temperature_2m: 76, apparent_temperature: 76, wind_speed_10m: 25, weather_code: 0 },
                    hourly: { time: [], apparent_temperature: [], wind_speed_10m: [], weather_code: [], is_day: [] }
                })
            });

            await evaluateWalkStatus(walk, li);
            expect(li.classList.contains('walk-go')).toBe(true);
            expect(li.classList.contains('walk-nogo')).toBe(false);
        });

        it('should mark a walk as NOGO when wind exceeds safety max (30 mph) even in top half of temperature range', async () => {
            const walk = { id: 'test', name: 'Dangerous Wind Walk', isBeach: false, lat: 51.5, lng: -0.1 };
            
            // userSettings.tempMin = 68, tempMax = 80, windMax = 15 (midpoint = 74)
            // apparent_temperature 76 is in the top half, but wind 35 mph > SAFETY_WIND_MAX (30)
            window.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    current: { temperature_2m: 76, apparent_temperature: 76, wind_speed_10m: 35, weather_code: 0 },
                    hourly: { time: [], apparent_temperature: [], wind_speed_10m: [], weather_code: [], is_day: [] }
                })
            });

            await evaluateWalkStatus(walk, li);
            expect(li.classList.contains('walk-nogo')).toBe(true);
            expect(li.classList.contains('walk-go')).toBe(false);
        });

        it('should mark a walk as GO when wind is at safety max (30 mph) in top half of temperature range', async () => {
            const walk = { id: 'test', name: 'Max Safe Wind Walk', isBeach: false, lat: 51.5, lng: -0.1 };
            
            // userSettings.tempMin = 68, tempMax = 80, windMax = 15 (midpoint = 74)
            // apparent_temperature 76 is in top half, wind 30 mph == SAFETY_WIND_MAX (not over 30)
            window.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    current: { temperature_2m: 76, apparent_temperature: 76, wind_speed_10m: 30, weather_code: 0 },
                    hourly: { time: [], apparent_temperature: [], wind_speed_10m: [], weather_code: [], is_day: [] }
                })
            });

            await evaluateWalkStatus(walk, li);
            expect(li.classList.contains('walk-go')).toBe(true);
            expect(li.classList.contains('walk-nogo')).toBe(false);
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

        it('evaluateHourStatus should correctly evaluate weather and tide constraints', () => {
            const walkBeach = { isBeach: true };
            const walkNormal = { isBeach: false };
            const tideData = {
                lowTideIndices: [16], // low tide at index 16 (16:00 / 4 PM)
                times: Array.from({ length: 24 }, (_, i) => `2026-09-13T${String(i).padStart(2, '0')}:00`)
            };
            const hourly = {
                time: Array.from({ length: 24 }, (_, i) => `2026-09-13T${String(i).padStart(2, '0')}:00`),
                is_day: Array.from({ length: 24 }, (_, i) => (i >= 8 && i <= 19 ? 1 : 0)),
                apparent_temperature: Array(24).fill(74), // within 68-80
                wind_speed_10m: Array(24).fill(5),       // < 15
                weather_code: Array(24).fill(0)          // clear
            };

            // Non-daylight hour (e.g. index 2 = 2 AM)
            expect(evaluateHourStatus(hourly, 2, walkBeach, tideData).isDaylight).toBe(false);

            // Normal walk at daylight hour (index 10 = 10 AM)
            const normalStatus = evaluateHourStatus(hourly, 10, walkNormal, tideData);
            expect(normalStatus.isDaylight).toBe(true);
            expect(normalStatus.isHourGo).toBe(true);

            // Beach walk at 10 AM (index 10: 6 hours from 16:00, outside tide window of +-2)
            const beachMorningStatus = evaluateHourStatus(hourly, 10, walkBeach, tideData);
            expect(beachMorningStatus.isDaylight).toBe(true);
            expect(beachMorningStatus.isHourGo).toBe(false);
            expect(beachMorningStatus.tideDescStr).toContain('High Tide');

            // Beach walk at 4 PM (index 16: exactly low tide)
            const beachLowTideStatus = evaluateHourStatus(hourly, 16, walkBeach, tideData);
            expect(beachLowTideStatus.isDaylight).toBe(true);
            expect(beachLowTideStatus.isHourGo).toBe(true);
            expect(beachLowTideStatus.tideDescStr).toContain('Low Tide');
        });

        it('evaluateHourStatus should only use wind max as a factor when temperature is in bottom half of specified range', () => {
            const walkNormal = { isBeach: false };
            const tideData = null;
            // userSettings: tempMin: 68, tempMax: 80, midpoint: 74, windMax: 15
            const hourly = {
                time: ['2026-09-13T10:00:00'],
                is_day: [1],
                apparent_temperature: [70], // Bottom half (< 74)
                wind_speed_10m: [20],       // Exceeds windMax (15)
                weather_code: [0]
            };

            // 1. Temperature in bottom half (70°F) + excessive wind (20 mph) -> NOGO
            const bottomHalfStatus = evaluateHourStatus(hourly, 0, walkNormal, tideData);
            expect(bottomHalfStatus.isHourGo).toBe(false);

            // 2. Temperature at midpoint (74°F) + excessive wind (20 mph) -> NOGO (bottom half includes midpoint)
            hourly.apparent_temperature = [74];
            const midpointStatus = evaluateHourStatus(hourly, 0, walkNormal, tideData);
            expect(midpointStatus.isHourGo).toBe(false);

            // 3. Temperature in top half (75°F) + excessive wind (20 mph) -> GO (wind is not a factor)
            hourly.apparent_temperature = [75];
            const topHalfStatus = evaluateHourStatus(hourly, 0, walkNormal, tideData);
            expect(topHalfStatus.isHourGo).toBe(true);

            // 4. Temperature in top half (75°F) + light wind (5 mph) -> GO
            hourly.wind_speed_10m = [5];
            expect(evaluateHourStatus(hourly, 0, walkNormal, tideData).isHourGo).toBe(true);

            // 5. Temperature in top half (78°F) + excessive wind over safety max (32 mph) -> NOGO (safety limit applies to full temperature range)
            hourly.apparent_temperature = [78];
            hourly.wind_speed_10m = [32];
            expect(evaluateHourStatus(hourly, 0, walkNormal, tideData).isHourGo).toBe(false);

            // 6. Temperature in top half (78°F) + wind exactly at safety max (30 mph) -> GO
            hourly.wind_speed_10m = [30];
            expect(evaluateHourStatus(hourly, 0, walkNormal, tideData).isHourGo).toBe(true);
        });

        it('should mark daily forecast badge as NOGO if daylight hours fail beach tide constraints', async () => {
            const walk = { id: 'test', name: 'Sunny Beach Walk', isBeach: true, lat: 25.0, lng: -80.0 };
            const times = Array.from({ length: 24 }, (_, i) => `2026-09-13T${String(i).padStart(2, '0')}:00`);

            window.fetch = jest.fn().mockImplementation((url) => {
                if (url.includes('api.open-meteo.com')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            current: { temperature_2m: 72, apparent_temperature: 72, wind_speed_10m: 5, weather_code: 0 },
                            hourly: {
                                time: times,
                                is_day: times.map((_, i) => (i >= 8 && i <= 19 ? 1 : 0)),
                                apparent_temperature: Array(24).fill(72),
                                wind_speed_10m: Array(24).fill(5),
                                weather_code: Array(24).fill(0)
                            }
                        })
                    });
                } else if (url.includes('marine-api.open-meteo.com')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            hourly: {
                                time: times,
                                sea_level_height_msl: times.map((_, i) => (i === 2 ? 0.1 : 3.0)) // low tide only at 2 AM (night)
                            }
                        })
                    });
                }
            });

            await evaluateWalkStatus(walk, li);
            const badge = li.querySelector('.forecast-badge');
            expect(badge).not.toBeNull();
            expect(badge.classList.contains('forecast-nogo')).toBe(true);
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
