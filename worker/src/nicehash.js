// Cliente da API privada da NiceHash (v2), com assinatura HMAC-SHA256 igual à do cliente oficial
// (github.com/nicehash/rest-clients-demo). Roda no Cloudflare Workers e no Node 18+ (WebCrypto).

export const NH_HOSTS = { test: 'https://api-test.nicehash.com', prod: 'https://api2.nicehash.com' };
const enc = new TextEncoder();

// Mensagem assinada: key \0 time \0 nonce \0 \0 org \0 \0 METHOD \0 path \0 query [\0 body]
export function authMessage({ key, time, nonce, org, method, path, query, body }) {
  let s = key + '\0' + time + '\0' + nonce + '\0' + '\0' + (org || '') + '\0' + '\0' + method + '\0' + path + '\0' + (query || '');
  if (body) s += '\0' + body;
  return enc.encode(s);
}

export async function hmacHex(secret, bytes) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Unidades do algoritmo variam por ambiente (produção cota SHA-256 em EH, teste em PH).
// Internamente o painel usa preço em BTC/EH/dia e velocidade em PH/s.
export function algoUnits(a) {
  const mf = parseFloat(a.marketFactor), pf = parseFloat(a.priceFactor);
  return {
    marketFactor: a.marketFactor, displayMarketFactor: a.displayMarketFactor,
    priceToEH: 1e18 / pf,                     // preço da API × isto = BTC/EH/dia
    limitToPH: mf / 1e15,                     // limite da API × isto = PH/s
    minLimitPH: parseFloat(a.minSpeedLimit) * mf / 1e15,
    maxLimitPH: parseFloat(a.maxSpeedLimit) * mf / 1e15,
    priceDownStepEH: Math.abs(parseFloat(a.priceDownStep)) * 1e18 / pf,
    minOrderBtc: parseFloat(a.minimalOrderAmount),
    markets: String(a.enabledMarketsNewOrder || a.enabledMarkets || '').split(',').filter(Boolean)
  };
}

export function createClient({ base, key, secret, org, fetchFn = fetch, now = () => Date.now(), uuid = () => crypto.randomUUID() }) {
  let offset = null;
  async function serverOffset() {
    if (offset === null) {
      const r = await fetchFn(base + '/api/v2/time');
      const j = await r.json();
      offset = j.serverTime - now();
    }
    return offset;
  }
  async function publicGet(path, query) {
    const r = await fetchFn(base + path + (query ? '?' + query : ''));
    if (!r.ok) throw new Error('NiceHash ' + r.status + ' em ' + path);
    return r.json();
  }
  async function call(method, path, query = '', body = null) {
    if (!key || !secret || !org) throw new Error('Chaves da NiceHash não configuradas no servidor');
    const time = String(now() + (await serverOffset()));
    const nonce = uuid();
    const bodyStr = body ? JSON.stringify(body) : '';
    const sig = await hmacHex(secret, authMessage({ key, time, nonce, org, method, path, query, body: bodyStr }));
    const r = await fetchFn(base + path + (query ? '?' + query : ''), {
      method,
      headers: {
        'X-Time': time, 'X-Nonce': nonce, 'X-Organization-Id': org, 'X-Request-Id': uuid(),
        'X-Auth': key + ':' + sig, 'Content-Type': 'application/json', Accept: 'application/json'
      },
      body: body ? bodyStr : undefined
    });
    const text = await r.text();
    if (!r.ok) throw new Error('NiceHash ' + r.status + ': ' + text.slice(0, 300));
    return text ? JSON.parse(text) : null;
  }
  let algo = null;
  async function units() {
    if (!algo) {
      const d = await publicGet('/main/api/v2/mining/algorithms');
      const a = d.miningAlgorithms.find((x) => x.algorithm === 'SHA256');
      if (!a) throw new Error('SHA256 não encontrado na NiceHash');
      algo = algoUnits(a);
    }
    return algo;
  }
  // Ordem normalizada: preço em BTC/EH/dia, velocidades em PH/s.
  function normOrder(o, u) {
    return {
      id: o.id, alive: o.alive !== false, status: (o.status && o.status.code) || o.status || '',
      market: o.market, type: (o.type && o.type.code) || o.type,
      priceEH: parseFloat(o.price) * u.priceToEH, limitPH: parseFloat(o.limit) * u.limitToPH,
      speedPH: parseFloat(o.acceptedCurrentSpeed || 0) * u.limitToPH,
      amountBtc: parseFloat(o.amount || 0), paidBtc: parseFloat(o.payedAmount || 0), availableBtc: parseFloat(o.availableAmount || 0),
      poolId: o.pool && o.pool.id, poolName: o.pool && o.pool.name,
      createdTs: o.creationTs ? Date.parse(o.creationTs) : null
    };
  }
  const fmt8 = (x) => (Math.round(x * 1e8) / 1e8).toFixed(8);
  return {
    call, units, publicGet,
    serverTime: async () => now() + (await serverOffset()),
    orderBook: () => publicGet('/main/api/v2/hashpower/orderBook', 'algorithm=SHA256'),
    balance: () => call('GET', '/main/api/v2/accounting/account2/BTC'),
    pools: () => call('GET', '/main/api/v2/pools', 'size=100&page=0'),
    createPool: (p) => call('POST', '/main/api/v2/pool', '', {
      name: p.name, algorithm: 'SHA256', stratumHostname: p.host, stratumPort: +p.port, username: p.username, password: p.password || 'x'
    }),
    myOrders: async (market) => {
      const u = await units();
      const ts = now() + (await serverOffset());
      const d = await call('GET', '/main/api/v2/hashpower/myOrders', 'algorithm=SHA256&market=' + encodeURIComponent(market) + '&ts=' + ts + '&op=LT&limit=100&active=true');
      return ((d && d.list) || []).map((o) => normOrder(o, u));
    },
    createOrder: async ({ market, priceEH, limitPH, amountBtc, poolId }) => {
      const u = await units();
      const o = await call('POST', '/main/api/v2/hashpower/order', '', {
        market, algorithm: 'SHA256', type: 'STANDARD', poolId,
        amount: fmt8(amountBtc), price: fmt8(priceEH / u.priceToEH), limit: fmt8(limitPH / u.limitToPH),
        marketFactor: u.marketFactor, displayMarketFactor: u.displayMarketFactor
      });
      return normOrder(o, u);
    },
    updateOrder: async (id, { priceEH, limitPH }) => {
      const u = await units();
      const body = { marketFactor: u.marketFactor, displayMarketFactor: u.displayMarketFactor };
      if (priceEH !== undefined) body.price = fmt8(priceEH / u.priceToEH);
      if (limitPH !== undefined) body.limit = fmt8(limitPH / u.limitToPH);
      return call('POST', '/main/api/v2/hashpower/order/' + encodeURIComponent(id) + '/updatePriceAndLimit', '', body);
    },
    cancelOrder: (id) => call('DELETE', '/main/api/v2/hashpower/order/' + encodeURIComponent(id)),
    refillOrder: (id, amountBtc) => call('POST', '/main/api/v2/hashpower/order/' + encodeURIComponent(id) + '/refill', '', { amount: fmt8(amountBtc) })
  };
}
