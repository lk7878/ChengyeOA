const MAX_ENTRIES = 50;
export class SearchCache {
    map = new Map();
    buildKey(query, maxResults, timeRangeLabel, preferred) {
        return [query, maxResults, timeRangeLabel, preferred].join('\0');
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }
    set(key, value, ttlMs) {
        this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
        if (this.map.size > MAX_ENTRIES) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined)
                this.map.delete(oldest);
        }
    }
}
