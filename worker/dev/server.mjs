// Roda o Worker no Node (sem Cloudflare) para testes locais.
// Uso: PANEL_TOKEN=... NH_BASE=http://localhost:9100/nh BCH_REST=http://localhost:9100/bch PRICE_URL=http://localhost:9100/cg/x node worker/dev/server.mjs
import http from 'node:http';
import worker from '../src/index.js';

export function memoryKV() {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, _map: m };
}

export function serve(env, port) {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const r = await worker.fetch(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body }), env, { waitUntil() {} });
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
  });
  return server.listen(port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +(process.env.PORT || 8787);
  const env = Object.assign({}, process.env, { FD_KV: memoryKV() });
  serve(env, port);
  console.log('backend local em http://localhost:' + port);
  if (process.env.DEV_CRON) setInterval(() => worker.scheduled({}, env, { waitUntil: (p) => p.catch(console.error) }), +process.env.DEV_CRON * 1000);
}
