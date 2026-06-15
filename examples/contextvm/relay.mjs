// Minimal Nostr relay for ContextVM end-to-end testing.
// Implements NIP-01 EVENT/REQ/CLOSE + OK/EOSE. Logs every connection, event,
// and subscription. No signature verification (test-only).
//
// Why this exists: free public Nostr relays (damus/primal/nos) unreliably
// deliver gift-wrap events to subscriptions (rate-limiting, NIP-42 auth
// requirements, dropped events). A local relay removes that variable so the
// app↔gateway transport can be tested deterministically.
//
// Run: node relay.mjs   (from a dir with `ws` installed, e.g. the contextvm-sdk checkout)
import { WebSocketServer } from 'ws';

const PORT = 8777;
const events = [];
const clients = new Set();
let connSeq = 0;

function matchesFilters(ev, filters) {
  if (!filters || filters.length === 0) return true;
  for (const f of filters) {
    if (f.ids && !f.ids.includes(ev.id)) continue;
    if (f.authors && !f.authors.includes(ev.pubkey)) continue;
    if (f.kinds && !f.kinds.includes(ev.kind)) continue;
    if (f.since && ev.created_at < f.since) continue;
    if (f.until && ev.created_at > f.until) continue;
    let tagOk = true;
    for (const key of Object.keys(f)) {
      if (!key.startsWith('#') || key.length !== 2) continue;
      const wanted = f[key];
      const have = ev.tags.filter(t => t[0] === key.slice(1)).map(t => t[1]);
      if (!wanted.some(w => have.includes(w))) { tagOk = false; break; }
    }
    if (!tagOk) continue;
    return true;
  }
  return false;
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
console.log(`[relay] listening on ws://0.0.0.0:${PORT}`);

wss.on('connection', (ws, req) => {
  ws._id = `c${++connSeq}(${req.socket.remoteAddress})`;
  ws._subs = {};
  clients.add(ws);
  console.log(`[relay] +${ws._id} (total ${clients.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { ws.send(JSON.stringify(['NOTICE', 'invalid JSON'])); return; }
    const [type] = msg;

    if (type === 'EVENT') {
      const ev = msg[1];
      events.push(ev);
      ws.send(JSON.stringify(['OK', ev.id, true, '']));
      for (const c of clients) {
        for (const [subId, filters] of Object.entries(c._subs || {})) {
          if (matchesFilters(ev, filters)) {
            try { c.send(JSON.stringify(['EVENT', subId, ev])); } catch {}
          }
        }
      }
    } else if (type === 'REQ') {
      const subId = msg[1];
      const filters = msg.slice(2);
      ws._subs[subId] = filters;
      for (const ev of events) if (matchesFilters(ev, filters)) ws.send(JSON.stringify(['EVENT', subId, ev]));
      ws.send(JSON.stringify(['EOSE', subId]));
    } else if (type === 'CLOSE') {
      delete ws._subs[msg[1]];
    }
  });

  ws.on('close', () => { clients.delete(ws); });
  ws.on('error', () => { clients.delete(ws); });
});
