const reads = new Map(), listeners = new Set();
function publish() { const rows = [...reads.values()]; for (const listener of listeners) listener({ pending: rows.some(row => row.pending), failed: rows.some(row => row.error) }); }
export function setReadState(key, value) { if (value) reads.set(key, value); else reads.delete(key); publish(); }
export function subscribeReadState(listener) { listeners.add(listener); publish(); return () => listeners.delete(listener); }
