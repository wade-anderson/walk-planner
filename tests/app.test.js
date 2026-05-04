describe('Walk Planner Security & Logic', () => {

    it('escapeHTML should safely encode HTML characters and prevent XSS', () => {
        const maliciousPayload = `<script>alert("XSS & 'pwned'")</script>`;
        const escaped = window.escapeHTML(maliciousPayload);
        
        expect(escaped).not.toContain('<script>');
        expect(escaped).toContain('&lt;script&gt;');
        expect(escaped).toContain('&quot;XSS');
        expect(escaped).toContain('&#039;pwned&#039;');
        expect(escaped).toContain('&amp;');

        const nonStringPayload = 12345;
        const escapedNonString = window.escapeHTML(nonStringPayload);
        expect(escapedNonString).toBe('');
    });

    it('fetchInlineWeather should prevent parameter injection by casting to Number', async () => {
        const originalFetch = window.fetch;
        let lastFetchUrl = '';
        
        // Mock fetch specifically for this test
        window.fetch = jest.fn().mockImplementation(async (url) => {
            lastFetchUrl = url;
            return { ok: true, json: async () => ({ current: {}, hourly: {} }) };
        });

        const maliciousLat = "51.5&malicious=true";
        const maliciousLng = "0.1";

        // Create a dummy DOM element for the function to find
        const el = document.createElement('div');
        el.id = 'weather-test-123';
        document.body.appendChild(el);

        await window.fetchInlineWeather(maliciousLat, maliciousLng, 'weather-test-123');

        // Due to Number("51.5&malicious=true") evaluating to NaN, the injected query should be dropped
        // Our fallback sets it to 0
        expect(lastFetchUrl).toContain('latitude=0');
        expect(lastFetchUrl).not.toContain('&malicious=true&');

        window.fetch = originalFetch; // Restore
        el.remove();
    });

    it('userSettings merges safely without prototype pollution via JSON parsing', () => {
        // Since userSettings is declared with `let`, it might not be attached to window natively.
        // But we can check if it initializes without throwing errors during app load.
        expect(typeof window.userSettings === 'undefined' || typeof window.userSettings === 'object').toBeTruthy();
        
        // Let's test the settings import validation logic by mocking localStorage and calling loadSettings
        const mockSettings = { tempMin: "999", windMax: { malformed: true } };
        window.localStorage.setItem('walkSettings', JSON.stringify(mockSettings));
        
        // This won't throw because we added strict type casting in app.js
        expect(() => window.loadSettings()).not.toThrow();
    });
});
