// Robô de arbitragem (08/11): executa só a arbitragem DIRETA (duas pernas, mesma dupla, duas corretoras com saldo
// nas duas) quando a oportunidade continuou positiva por duas leituras. Nasce DESLIGADO.
//   off: não faz nada · ensaio: confere saldo pela API, monta e assina as duas ordens, NÃO envia · real: envia as duas.
// Ordens limite IOC (executa na hora no preço visto ou cancela): sem perna esquecida no livro. Se só uma perna executar,
// o robô se desliga (kill switch) e avisa: a outra perna fica para conferir à mão.
// Chaves: só permissão de negociar (nunca saque); guardadas cifradas no backend; nada disso vai para o painel.
// Adaptadores escritos pela documentação pública de cada API; só foram testados sem chave. Por isso o primeiro uso
// é o ensaio, que mostra exatamente o que seria enviado.
const te = new TextEncoder();
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
export async function hmac(secret, msg, enc = 'hex') {
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, te.encode(msg));
  return enc === 'b64' ? b64(s) : hex(s);
}
const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const fmt = (x, d) => String(+(+x).toFixed(d));

// símbolo de cada dupla em cada corretora
const SYM = {
  binance: { 'USDC/USDT': 'USDCUSDT', 'USDT/BRL': 'USDTBRL', 'USDC/BRL': 'USDCBRL' },
  okx: { 'USDC/USDT': 'USDC-USDT', 'USDT/BRL': 'USDT-BRL', 'USDC/BRL': 'USDC-BRL' },
  bybit: { 'USDC/USDT': 'USDCUSDT', 'USDT/BRL': 'USDTBRL' },
  kucoin: { 'USDC/USDT': 'USDC-USDT' },
  foxbit: { 'USDT/BRL': 'usdtbrl', 'USDC/BRL': 'usdcbrl' }
};
export const EXEC_VENUES = Object.keys(SYM);

// Monta a requisição assinada (sem enviar). k = { key, secret, passphrase }.
export const ADAPTERS = {
  binance: {
    needPass: false, host: 'https://api.binance.com',
    async order(k, { pair, side, price, qty }, now) {
      const p = { symbol: SYM.binance[pair], side: side.toUpperCase(), type: 'LIMIT', timeInForce: 'IOC', quantity: fmt(qty, 2), price: fmt(price, pair.endsWith('BRL') ? 4 : 5), recvWindow: 5000, timestamp: now };
      const s = qs(p); return { method: 'POST', url: this.host + '/api/v3/order?' + s + '&signature=' + (await hmac(k.secret, s)), headers: { 'X-MBX-APIKEY': k.key } };
    },
    async balances(k, now) { const s = qs({ recvWindow: 5000, timestamp: now }); return { method: 'GET', url: this.host + '/api/v3/account?' + s + '&signature=' + (await hmac(k.secret, s)), headers: { 'X-MBX-APIKEY': k.key } }; },
    parseBal: (j) => Object.fromEntries(((j && j.balances) || []).map((b) => [b.asset, +b.free])),
    async perms(k, now) { const s = qs({ recvWindow: 5000, timestamp: now }); return { method: 'GET', url: this.host + '/sapi/v1/account/apiRestrictions?' + s + '&signature=' + (await hmac(k.secret, s)), headers: { 'X-MBX-APIKEY': k.key } }; },
    parseOrder: (j) => ({ ok: !!(j && j.orderId), filled: +(j && j.executedQty) || 0, status: j && (j.status || j.msg), id: j && j.orderId }),
    canWithdraw: (j) => (j && typeof j.enableWithdrawals === 'boolean' ? j.enableWithdrawals : null)
  },
  okx: {
    needPass: true, host: 'https://www.okx.com',
    async sign(k, method, path, body, now) {
      const ts = new Date(now).toISOString(), sig = await hmac(k.secret, ts + method + path + (body || ''), 'b64');
      return { 'OK-ACCESS-KEY': k.key, 'OK-ACCESS-SIGN': sig, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': k.passphrase, 'content-type': 'application/json' };
    },
    async order(k, { pair, side, price, qty }, now) {
      const body = JSON.stringify({ instId: SYM.okx[pair], tdMode: 'cash', side, ordType: 'ioc', px: fmt(price, pair.endsWith('BRL') ? 4 : 5), sz: fmt(qty, 2) });
      return { method: 'POST', url: this.host + '/api/v5/trade/order', body, headers: await this.sign(k, 'POST', '/api/v5/trade/order', body, now) };
    },
    async balances(k, now) { const path = '/api/v5/account/balance?ccy=USDT,USDC,BRL'; return { method: 'GET', url: this.host + path, headers: await this.sign(k, 'GET', path, '', now) }; },
    async perms(k, now) { const path = '/api/v5/account/config'; return { method: 'GET', url: this.host + path, headers: await this.sign(k, 'GET', path, '', now) }; },
    parseBal: (j) => Object.fromEntries((((j && j.data && j.data[0]) || {}).details || []).map((d) => [d.ccy, +d.availBal])),
    parseOrder: (j) => { const d = j && j.data && j.data[0]; return { ok: !!(j && j.code === '0' && d && d.ordId), filled: null, status: d ? d.sMsg || 'aceita' : j && j.msg, id: d && d.ordId }; },
    canWithdraw: (j) => { const p = j && j.data && j.data[0] && j.data[0].perm; return p ? /withdraw/.test(p) : null; }
  },
  bybit: {
    needPass: false, host: 'https://api.bybit.com',
    async sign(k, payload, now) { return { 'X-BAPI-API-KEY': k.key, 'X-BAPI-TIMESTAMP': String(now), 'X-BAPI-RECV-WINDOW': '5000', 'X-BAPI-SIGN': await hmac(k.secret, now + k.key + '5000' + payload), 'content-type': 'application/json' }; },
    async order(k, { pair, side, price, qty }, now) {
      const body = JSON.stringify({ category: 'spot', symbol: SYM.bybit[pair], side: side === 'buy' ? 'Buy' : 'Sell', orderType: 'Limit', qty: fmt(qty, 2), price: fmt(price, pair.endsWith('BRL') ? 4 : 5), timeInForce: 'IOC' });
      return { method: 'POST', url: this.host + '/v5/order/create', body, headers: await this.sign(k, body, now) };
    },
    async balances(k, now) { const s = 'accountType=UNIFIED'; return { method: 'GET', url: this.host + '/v5/account/wallet-balance?' + s, headers: await this.sign(k, s, now) }; },
    async perms(k, now) { return { method: 'GET', url: this.host + '/v5/user/query-api', headers: await this.sign(k, '', now) }; },
    parseBal: (j) => Object.fromEntries((((j && j.result && j.result.list && j.result.list[0]) || {}).coin || []).map((c) => [c.coin, +c.walletBalance - (+c.locked || 0)])),
    parseOrder: (j) => ({ ok: !!(j && j.retCode === 0), filled: null, status: j && j.retMsg, id: j && j.result && j.result.orderId }),
    canWithdraw: (j) => { const w = j && j.result && j.result.permissions && j.result.permissions.Wallet; return Array.isArray(w) ? w.some((x) => /withdraw/i.test(x)) : null; }
  },
  kucoin: {
    needPass: true, host: 'https://api.kucoin.com',
    async sign(k, method, path, body, now) {
      return { 'KC-API-KEY': k.key, 'KC-API-SIGN': await hmac(k.secret, now + method + path + (body || ''), 'b64'), 'KC-API-TIMESTAMP': String(now),
        'KC-API-PASSPHRASE': await hmac(k.secret, k.passphrase, 'b64'), 'KC-API-KEY-VERSION': '2', 'content-type': 'application/json' };
    },
    async order(k, { pair, side, price, qty }, now) {
      const body = JSON.stringify({ clientOid: 'fd' + now, side, symbol: SYM.kucoin[pair], type: 'limit', price: fmt(price, 5), size: fmt(qty, 2), timeInForce: 'IOC' });
      return { method: 'POST', url: this.host + '/api/v1/orders', body, headers: await this.sign(k, 'POST', '/api/v1/orders', body, now) };
    },
    async balances(k, now) { const path = '/api/v1/accounts?type=trade'; return { method: 'GET', url: this.host + path, headers: await this.sign(k, 'GET', path, '', now) }; },
    async perms(k, now) { const path = '/api/v1/user/api-key'; return { method: 'GET', url: this.host + path, headers: await this.sign(k, 'GET', path, '', now) }; },
    parseBal: (j) => Object.fromEntries(((j && j.data) || []).map((a) => [a.currency, +a.available])),
    parseOrder: (j) => ({ ok: !!(j && j.code === '200000' && j.data && j.data.orderId), filled: null, status: j && (j.msg || j.code), id: j && j.data && j.data.orderId }),
    canWithdraw: (j) => { const p = j && j.data && j.data.permission; return p ? /withdraw/i.test(p) : null; }
  },
  foxbit: {
    needPass: false, host: 'https://api.foxbit.com.br',
    async sign(k, method, path, query, body, now) { return { 'X-FB-ACCESS-KEY': k.key, 'X-FB-ACCESS-TIMESTAMP': String(now), 'X-FB-ACCESS-SIGNATURE': await hmac(k.secret, now + method + path + (query || '') + (body || '')), 'content-type': 'application/json' }; },
    async order(k, { pair, side, price, qty }, now) {
      const body = JSON.stringify({ market_symbol: SYM.foxbit[pair], side: side.toUpperCase(), type: 'LIMIT', price: fmt(price, 4), quantity: fmt(qty, 2), time_in_force: 'IOC' });
      return { method: 'POST', url: this.host + '/rest/v3/orders', body, headers: await this.sign(k, 'POST', '/rest/v3/orders', '', body, now) };
    },
    async balances(k, now) { return { method: 'GET', url: this.host + '/rest/v3/accounts', headers: await this.sign(k, 'GET', '/rest/v3/accounts', '', '', now) }; },
    parseBal: (j) => Object.fromEntries(((j && j.data) || []).map((a) => [String(a.currency_symbol || '').toUpperCase(), +a.balance_available])),
    parseOrder: (j) => ({ ok: !!(j && (j.id || j.sn)), filled: null, status: j && (j.message || 'aceita'), id: j && (j.id || j.sn) }),
    canWithdraw: () => null
  }
};

const send = async (fetchFn, r) => { const x = await fetchFn(r.url, { method: r.method, headers: r.headers, body: r.body }); let j = null; try { j = await x.json(); } catch (e) { /* sem corpo */ } return { status: x.status, ok: x.ok, json: j }; };
const shown = (r) => ({ method: r.method, url: r.url.replace(/signature=[0-9a-f]+/, 'signature=…'), body: r.body || null }); // o que vai, sem cabeçalho de chave

// Confere uma chave: lê o saldo e, onde a API informa, recusa chave com permissão de saque.
export async function checkKey(venue, k, fetchFn, now = Date.now()) {
  const A = ADAPTERS[venue]; if (!A) return { ok: false, error: 'corretora sem robô' };
  if (!k || !k.key || !k.secret || (A.needPass && !k.passphrase)) return { ok: false, error: A.needPass ? 'informe chave, segredo e senha da API' : 'informe chave e segredo' };
  if (A.perms) { const pr = await send(fetchFn, await A.perms(k, now)).catch((e) => ({ ok: false, json: { msg: String(e.message || e) } })); const w = pr.ok ? A.canWithdraw(pr.json) : null; if (w === true) return { ok: false, error: 'esta chave tem permissão de SAQUE: crie outra só com negociação' }; }
  const r = await send(fetchFn, await A.balances(k, now)).catch((e) => ({ ok: false, status: 0, json: { msg: String(e.message || e) } }));
  if (!r.ok) return { ok: false, error: `a ${venue} recusou (${r.status}${r.json && (r.json.msg || r.json.retMsg || r.json.message) ? ': ' + (r.json.msg || r.json.retMsg || r.json.message) : ''})` };
  return { ok: true, bal: A.parseBal(r.json) };
}

// Um passo do robô. opp: a melhor oportunidade direta confirmada (duas leituras). Devolve o novo estado e as mensagens.
export async function execStep(S0, { opp, cfg, keys, fetchFn, now }) {
  const S = Object.assign({ day: null, usedUsd: 0, runs: [], halted: null }, S0 || {}), events = [], day = new Date(now).toISOString().slice(0, 10);
  if (S.day !== day) { S.day = day; S.usedUsd = 0; }
  const mode = cfg.arbMode || 'off';
  if (mode === 'off' || !opp) return { exec: S, events };
  if (S.halted) return { exec: S, events };
  const skip = (why) => { S.lastSkip = { t: now, why, id: opp.id }; return { exec: S, events }; };
  if (opp.type !== 'direta' || opp.dex) return skip('o robô executa só a arbitragem direta entre corretoras');
  if (!(opp.netPct >= cfg.arbMinNetPct)) return skip('margem abaixo da mínima do robô');
  const A = ADAPTERS[opp.buy], B = ADAPTERS[opp.sell], ka = keys && keys[opp.buy], kb = keys && keys[opp.sell];
  if (!A || !B || !SYM[opp.buy][opp.pair] || !SYM[opp.sell][opp.pair]) return skip('uma das corretoras não tem robô para essa dupla');
  if (!ka || !kb) return skip('falta a chave de ' + (!ka ? opp.buy : opp.sell));
  const usd = Math.min(cfg.arbMaxTradeUsd, opp.liqUsd || cfg.arbMaxTradeUsd, cfg.arbMaxDayUsd - S.usedUsd);
  if (!(usd >= 10)) return skip('limite do dia atingido');
  const [base, quote] = opp.pair.split('/'), brl = quote === 'BRL';
  const qty = Math.floor(brl ? usd : usd / opp.buyPx); // em unidades da moeda comprada (stable ≈ US$1)
  // saldo das duas corretoras: a compra precisa da moeda de cotação, a venda precisa da moeda comprada
  const [ba, bb] = await Promise.all([send(fetchFn, await A.balances(ka, now)), send(fetchFn, await B.balances(kb, now))].map((p) => p.catch((e) => ({ ok: false, json: { msg: String(e.message || e) } }))));
  if (!ba.ok || !bb.ok) return skip(`não consegui ler o saldo (${!ba.ok ? opp.buy : opp.sell})`);
  const sa = A.parseBal(ba.json), sb = B.parseBal(bb.json);
  if (!((sa[quote] || 0) >= qty * opp.buyPx)) return skip(`saldo de ${quote} insuficiente na ${opp.buy}`);
  if (!((sb[base] || 0) >= qty)) return skip(`saldo de ${base} insuficiente na ${opp.sell}`);
  const ra = await A.order(ka, { pair: opp.pair, side: 'buy', price: opp.buyPx, qty }, now), rb = await B.order(kb, { pair: opp.pair, side: 'sell', price: opp.sellPx, qty }, now);
  const run = { t: now, mode, id: opp.id, pair: opp.pair, buy: opp.buy, sell: opp.sell, qty, netPct: opp.netPct, req: [shown(ra), shown(rb)] };
  if (mode === 'ensaio') {
    run.result = 'ensaio: saldo conferido, ordens montadas e assinadas, nada enviado';
    events.push(`Arbitragem (ensaio): compraria ${qty} ${base} na ${opp.buy} a ${opp.buyPx} e venderia na ${opp.sell} a ${opp.sellPx} (${opp.netPct.toFixed(3).replace('.', ',')}% líquido). Saldo conferido; nada foi enviado.`);
  } else {
    const [xa, xb] = await Promise.all([send(fetchFn, ra), send(fetchFn, rb)].map((p) => p.catch((e) => ({ ok: false, json: { msg: String(e.message || e) } }))));
    const oa = A.parseOrder(xa.json), ob = B.parseOrder(xb.json);
    run.result = { buy: oa, sell: ob }; S.usedUsd += usd;
    if (oa.ok !== ob.ok) { S.halted = { t: now, why: `só uma perna foi aceita (${oa.ok ? 'compra' : 'venda'}); confira à mão na ${oa.ok ? opp.sell : opp.buy}` }; }
    events.push(`Arbitragem (REAL): ${qty} ${base} — compra na ${opp.buy}: ${oa.ok ? 'aceita' : 'recusada (' + oa.status + ')'}; venda na ${opp.sell}: ${ob.ok ? 'aceita' : 'recusada (' + ob.status + ')'}.${S.halted ? ' ROBÔ DESLIGADO: ' + S.halted.why : ''}`);
  }
  S.runs = [run].concat(S.runs).slice(0, 30);
  return { exec: S, events };
}
