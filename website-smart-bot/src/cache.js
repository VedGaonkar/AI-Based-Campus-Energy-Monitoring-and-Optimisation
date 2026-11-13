// Small in-memory TTL cache with a size bound, plus in-flight deduplication.
export function createCache({ ttlMs, max = 300, now = () => Date.now() }) {
  const map = new Map();
  const inflight = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now()) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, ttl = ttlMs) {
      if (map.size >= max) map.delete(map.keys().next().value);
      map.set(key, { value, expires: now() + ttl });
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    deleteWhere(predicate) {
      for (const key of map.keys()) if (predicate(key)) map.delete(key);
    },
    // Concurrent callers with the same key share one execution of `fn`.
    async once(key, fn) {
      if (inflight.has(key)) return inflight.get(key);
      const p = Promise.resolve()
        .then(fn)
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    get size() {
      return map.size;
    },
  };
}
