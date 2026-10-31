// NiceHash + REST BCH + cotações + Telegram FALSOS, para testar o backend inteiro sem dinheiro e sem chaves reais.
// A assinatura de cada pedido privado é conferida com o algoritmo do cliente oficial (node:crypto, independente do Worker).
import http from 'node:http';
import crypto from 'node:crypto';

export const MOCK_KEYS = { key: 'mock-key', secret: 'mock-secret-0123456789', org: 'mock-org' };

export function createMock() {
  const s = {
    height: 900000, difficulty: 530e9, bchUsd: 285, btcUsd: 77000,
    book: [{ price: 0.40, speed: 0.0006 }, { price: 0.42, speed: 0.0004 }, { price: 0.50, speed: 0.0002 }],
    blocks: {}, orders: {}, pools: [{ id: 'pool-1', name: 'BlockSniper solo', stratumHostname: 'solo.blocksniper.ai', stratumPort: 3333, username: 'bitcoincash:qtest', password: 'x' }],
    calls: [], authFails: 0, balance: 0.05, nextId: 1, tgUpdates: [], tgSent: []
  };
  const addCoinbase = (h, addr, value) => { s.blocks[h] = { addr, value }; };
  for (let h = s.height - 60; h <= s.height; h++) addCoinbase(h, 'qpoolxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 3.126);

  function verify(req, path, query, body) {
    const [key, sig] = String(req.headers['x-auth'] || '').split(':');
    const parts = [key, req.headers['x-time'], req.headers['x-nonce'], '', req.headers['x-organization-id'], '', req.method, path, query || ''];
    let msg = parts.join('\0');
    if (body) msg += '\0' + body;
    const want = crypto.createHmac('sha256', MOCK_KEYS.secret).update(msg).digest('hex');
    const skew = Math.abs(Date.now() - Number(req.headers['x-time']));
    return key === MOCK_KEYS.key && req.headers['x-organization-id'] === MOCK_KEYS.org && sig === want && skew < 300000;
  }
  const ord = (o) => ({ id: o.id, alive: o.alive, status: { code: o.alive ? 'ACTIVE' : 'CANCELLED' }, market: 'BTC', type: { code: 'STANDARD' },
    price: o.price, limit: o.limit, acceptedCurrentSpeed: o.alive ? o.limit : '0', amount: o.amount, payedAmount: String(o.paid),
    availableAmount: String(Math.max(0, +o.amount - o.paid)), pool: { id: o.poolId, name: 'pool' }, creationTs: new Date(o.created).toISOString() });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
    const p = u.pathname, q = u.search.slice(1);
    s.calls.push(req.method + ' ' + p);
    // ---- controle do teste ----
    if (p === '/_state') return send(200, { orders: s.orders, height: s.height, authFails: s.authFails, calls: s.calls.length, tgSent: s.tgSent });
    if (p === '/_mine') { const b = JSON.parse(body || '{}'); s.height++; addCoinbase(s.height, String(b.address || '').replace(/^bitcoincash:/, ''), b.value || 3.126); return send(200, { height: s.height }); }
    if (p === '/_spend') { const b = JSON.parse(body || '{}'); s.orders[b.id].paid += b.btc; return send(200, s.orders[b.id]); }
    if (p === '/_set') { Object.assign(s, JSON.parse(body || '{}')); return send(200, { ok: true }); }
    // ---- Telegram (TG_BASE=<mock>/tg) ----
    let tg = /^\/tg\/bot(\d+:[\w-]+)\/(\w+)$/.exec(p);
    if (tg) {
      if (tg[2] === 'getMe') return send(200, { ok: true, result: { id: 1, is_bot: true, username: 'fd_teste_bot' } });
      if (tg[2] === 'getUpdates') return send(200, { ok: true, result: s.tgUpdates });
      if (tg[2] === 'sendMessage') { s.tgSent.push(JSON.parse(body || '{}')); return send(200, { ok: true, result: {} }); }
      return send(404, { ok: false, description: 'Not Found' });
    }
    // ---- WhatToMine (WTM_URL=<mock>/wtm/asic.json): uma moeda Scrypt e uma SHA-256 ----
    if (p === '/wtm/asic.json') return send(200, s.wtm || { coins: {
      Litecoin: { tag: 'LTC', algorithm: 'Scrypt', block_time: '150', block_reward: 6.25, nethash: 2e15, exchange_rate: 0.0008, exchange_rate_vol: 500 },
      BitcoinCash: { tag: 'BCH', algorithm: 'SHA-256', block_time: '600', block_reward: 3.125, nethash: 4e18, exchange_rate: 0.0037, exchange_rate_vol: 300 } } });
    // ---- cotações e BCH ----
    if (p.startsWith('/cg/')) return send(200, { bitcoin: { usd: s.btcUsd }, 'bitcoin-cash': { usd: s.bchUsd } });
    // previsto de funding da Hyperliquid: ENA com 0,1%/8 h na Bybit e 0,00125%/h na HL (≈ 98% a.a. de diferença)
    if (p === '/hl/info') return send(200, s.predicted || [
      ['ENA', [['BybitPerp', { fundingRate: '0.001', nextFundingTime: Date.now() + 3600e3, fundingIntervalHours: 8 }], ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: Date.now() + 600e3, fundingIntervalHours: 1 }]]],
      ['BTC', [['BinPerp', { fundingRate: '0.0001', nextFundingTime: Date.now() + 3600e3, fundingIntervalHours: 8 }], ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: Date.now() + 600e3, fundingIntervalHours: 1 }]]]
    ]);
    if (p === '/bch/blockchain/getBlockchainInfo') return send(200, { blocks: s.height, difficulty: s.difficulty });
    let m = /^\/bch\/block\/detailsByHeight\/(\d+)$/.exec(p);
    if (m) return send(200, { height: +m[1], hash: (s.hashes && s.hashes[m[1]]) || crypto.createHash('sha256').update('bloco' + m[1]).digest('hex'), time: Math.floor(Date.now() / 1000), difficulty: s.difficulty, size: 20000 + (+m[1] % 1000), nTx: 40, tx: ['cb' + m[1]] });
    m = /^\/bch\/transaction\/details\/cb(\d+)$/.exec(p);
    if (m) { const b = s.blocks[+m[1]] || { addr: 'qx', value: 3.125 }; return send(200, { vin: [{ coinbase: Buffer.from(b.addr.startsWith('qpool') ? '\u0003abc/ViaBTC/Mined by x' : '\u0003abc/mock solo pool/').toString('hex') }], vout: [{ value: b.value, scriptPubKey: { cashAddrs: ['bitcoincash:' + b.addr] } }] }); }
    // ---- NiceHash público ----
    if (p === '/nh/api/v2/time') return send(200, { serverTime: Date.now() });
    if (p === '/nh/main/api/v2/mining/algorithms') return send(200, { miningAlgorithms: ['SHA256', 'SHA256ASICBOOST'].map((algorithm) => ({ algorithm, marketFactor: '1000000000000000000.00000000', displayMarketFactor: 'EH', priceFactor: '1000000000000000000.00000000', minSpeedLimit: '0.00010000', maxSpeedLimit: '50.00000000', priceDownStep: '-0.01000000', minimalOrderAmount: '0.00100000', enabledMarketsNewOrder: 'BTC' })) });
    if (p === '/nh/main/api/v2/hashpower/orderBook') return send(200, { stats: { BTC: { priceFactor: '1000000000000000000', marketFactor: '1000000000000000000', totalSpeed: '0.0012',
      orders: s.book.map((o) => ({ price: String(o.price), acceptedSpeed: String(o.speed), type: 'STANDARD', alive: true, limit: '1', rigsCount: 10 })) } } });
    // ---- NiceHash privado (assinado) ----
    if (p.startsWith('/nh/')) {
      const path = p.slice(3);
      if (!verify(req, path, q, body)) { s.authFails++; return send(401, { error_id: 'auth', errors: [{ code: 2000, message: 'Invalid signature' }] }); }
      if (path === '/main/api/v2/accounting/account2/BTC') return send(200, { currency: 'BTC', available: String(s.balance), totalBalance: String(s.balance) });
      if (path === '/main/api/v2/pools') return send(200, { list: s.pools });
      if (path === '/main/api/v2/pool' && req.method === 'POST') { const b = JSON.parse(body); const pool = Object.assign({ id: 'pool-' + (s.pools.length + 1) }, b); s.pools.push(pool); return send(200, pool); }
      if (path === '/main/api/v2/hashpower/myOrders') return send(200, { list: Object.values(s.orders).filter((o) => o.alive).map(ord) });
      if (path === '/main/api/v2/hashpower/order' && req.method === 'POST') {
        const b = JSON.parse(body); const id = 'ord-' + s.nextId++;
        s.orders[id] = { id, alive: true, price: b.price, limit: b.limit, amount: b.amount, paid: 0, poolId: b.poolId, created: Date.now(), updates: [] };
        s.balance -= +b.amount;
        return send(200, ord(s.orders[id]));
      }
      m = /^\/main\/api\/v2\/hashpower\/order\/([\w-]+)(\/updatePriceAndLimit|\/refill)?$/.exec(path);
      if (m && s.orders[m[1]]) {
        const o = s.orders[m[1]];
        if (m[2] === '/updatePriceAndLimit') {
          const b = JSON.parse(body);
          if (b.price !== undefined && +b.price < +o.price - 0.01 - 1e-9) return send(400, { errors: [{ message: 'price decrease too large' }] });
          if (b.price !== undefined) o.price = b.price; if (b.limit !== undefined) o.limit = b.limit;
          o.updates.push(b); return send(200, ord(o));
        }
        if (m[2] === '/refill') { o.amount = String(+o.amount + +JSON.parse(body).amount); return send(200, ord(o)); }
        if (req.method === 'DELETE') { o.alive = false; s.balance += Math.max(0, +o.amount - o.paid); return send(200, ord(o)); }
      }
      return send(404, { error: 'mock: rota ' + req.method + ' ' + path });
    }
    send(404, { error: 'mock: ' + p });
  });
  return { server, state: s };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +(process.env.MOCK_PORT || 9100);
  createMock().server.listen(port, () => console.log('mock em http://localhost:' + port));
}
