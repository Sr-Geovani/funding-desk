// Reteste das janelas de estabilidade do funding (2 leituras, 6, 12, 18, 24, 36, 48 h): mesmas fontes do treino (HL, OKX, Bitget, taxas pagas), ordem limite (maker), uma posição por par.
// Uso: NODE_USE_ENV_PROXY=1 node scripts/backtest-janelas-funding.mjs 90 --cache /tmp/fund90.json   (HOLD3=1: fica 3 dias em vez da saída do robô)
// Dados: funding PAGO de Hyperliquid, OKX e Bitget (Binance e Bybit bloqueiam o servidor de treino), 90 dias.
// Teste honesto: treina nos primeiros 2/3 do período e mede só no último 1/3 (com 3 dias de folga entre os dois).
// Uso: NODE_USE_ENV_PROXY=1 node scripts/train-funding-model.mjs [dias] [--cache /tmp/arquivo.json]
// Saídas: worker/src/fundmodel.js (pesos) e docs/modelo-funding.md (relatório).
import fs from 'node:fs';
import { beApr } from '../worker/src/features.js';

const args = process.argv.slice(2), DAYS = +(args.find((a) => /^\d+$/.test(a)) || 90);
const cacheArg = args.indexOf('--cache'), CACHE = cacheArg >= 0 ? args[cacheArg + 1] : null;
const H = 3600e3, NOW = Math.floor(Date.now() / H) * H, T0 = NOW - DAYS * 864e5, HOLD = 72, CAP = 150, SLIP = 0.03;
const FEES = { Hyperliquid: 0.045, OKX: 0.05, Bitget: 0.06 };
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'SUI',
  'SEI', 'TIA', 'INJ', 'WLD', 'WIF', 'ORDI', 'FIL', 'ETC', 'AAVE', 'UNI', 'LDO', 'CRV', 'DYDX', 'JUP', 'ENA', 'ONDO', 'TAO', 'PENDLE',
  'STRK', 'TRX', 'GALA', 'SAND', 'PEOPLE', 'NOT', 'ZRO', 'EIGEN', 'POPCAT', 'MEW', 'TRUMP', 'HYPE', 'VIRTUAL', 'FARTCOIN', 'KAITO'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJ(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, Object.assign({ headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }, opts)); if (r.ok) return await r.json(); if (r.status === 400 || r.status === 404) return null; }
    catch (e) { /* tenta de novo */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}
// Cada exchange → liquidações [{ t, rate (% do tamanho por intervalo), hours }], da mais antiga para a mais nova.
function withHours(list) {
  list.sort((a, b) => a.t - b.t);
  for (let i = 0; i < list.length; i++) if (!list[i].hours) list[i].hours = i ? Math.max(1, Math.round((list[i].t - list[i - 1].t) / H)) : 8;
  return list.filter((x, i) => !i || x.t !== list[i - 1].t);
}
async function hl(coin) {
  const out = []; let start = T0;
  for (let i = 0; i < 8 && start < NOW; i++) {
    const d = await getJ('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin, startTime: start }) });
    if (!Array.isArray(d) || !d.length) break;
    for (const x of d) out.push({ t: x.time, rate: +x.fundingRate * 100, hours: 1 });
    start = d[d.length - 1].time + 1; if (d.length < 500) break; await sleep(1500);
  }
  return out;
}
async function okx(coin) {
  const out = []; let after = '';
  for (let i = 0; i < 12; i++) {
    const d = await getJ(`https://www.okx.com/api/v5/public/funding-rate-history?instId=${coin}-USDT-SWAP&limit=100${after ? '&after=' + after : ''}`);
    const rows = (d && d.data) || []; if (!rows.length) break;
    for (const x of rows) out.push({ t: +x.fundingTime, rate: +(x.realizedRate || x.fundingRate) * 100 });
    after = rows[rows.length - 1].fundingTime; if (+after < T0) break; await sleep(300);
  }
  return withHours(out);
}
async function bitget(coin) {
  const out = [];
  for (let page = 1; page <= 12; page++) {
    const d = await getJ(`https://api.bitget.com/api/v2/mix/market/history-fund-rate?symbol=${coin}USDT&productType=USDT-FUTURES&pageSize=100&pageNo=${page}`);
    const rows = (d && d.data) || []; if (!rows.length) break;
    for (const x of rows) out.push({ t: +x.fundingTime, rate: +x.fundingRate * 100 });
    if (+rows[rows.length - 1].fundingTime < T0) break; await sleep(250);
  }
  return withHours(out);
}

async function download() {
  if (CACHE && fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const raw = {};
  for (const c of COINS) {
    const [a, b, g] = [await hl(c), await okx(c), await bitget(c)];
    raw[c] = { Hyperliquid: a.filter((x) => x.t >= T0), OKX: b.filter((x) => x.t >= T0), Bitget: g.filter((x) => x.t >= T0) };
    console.log(c, 'HL', raw[c].Hyperliquid.length, 'OKX', raw[c].OKX.length, 'Bitget', raw[c].Bitget.length);
  }
  if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(raw));
  return raw;
}

// Série horária em % a.a. com a última taxa JÁ LIQUIDADA (sem olhar o futuro).
function hourly(ev) {
  const n = Math.round((NOW - T0) / H), out = new Array(n).fill(null); let j = -1;
  for (let h = 0; h < n; h++) {
    const t = T0 + h * H;
    while (j + 1 < ev.length && ev[j + 1].t <= t) j++;
    if (j >= 0) out[h] = ev[j].rate * 8760 / ev[j].hours;
  }
  return out;
}

const MAKER = { Hyperliquid: 0.015, OKX: 0.02, Bitget: 0.02 };
const raw = await download();
const WINS = [1, 6, 12, 18, 24, 36, 48], res = {};
for (const W of WINS) res[W] = { n: 0, win: 0, pnl: 0, hours: 0, list: [] };
for (const [coin, v] of Object.entries(raw)) {
  const venues = Object.keys(MAKER), ser = {};
  for (const k of venues) if (v[k] && v[k].length > 20) ser[k] = hourly(v[k]);
  const have = Object.keys(ser);
  for (const A of have) for (const B of have) {
    if (A === B) continue;
    const cost = 2 * (MAKER[A] + MAKER[B]) + SLIP, be = beApr(cost, 3);
    const sp = ser[A].map((x, h) => (x === null || ser[B][h] === null ? null : x - ser[B][h]));
    for (const W of WINS) {
      let h = 48;
      while (h < sp.length - 1) {
        let ok = true; for (let k = 0; k < Math.max(2, W); k++) { const x = sp[h - k]; if (x === null || x < be || x > CAP) { ok = false; break; } }
        if (!ok) { h++; continue; }
        // entra em h; sai quando a diferença fica ≤ 0 em 2 leituras seguidas (robô) ou em 7 dias
        let e = h + 1, neg = 0;
        if (process.env.HOLD3) e = Math.min(sp.length - 1, h + 72); else for (; e < sp.length && e - h < 168; e++) { neg = sp[e] !== null && sp[e] <= 0 ? neg + 1 : 0; if (neg >= 2) break; }
        const t0 = T0 + h * H, t1 = T0 + Math.min(e, sp.length - 1) * H;
        const sum = (ev) => ev.filter((x) => x.t > t0 && x.t <= t1).reduce((s, x) => s + x.rate, 0);
        const pnlPct = sum(v[A]) - sum(v[B]) - cost, usd = pnlPct / 100 * 1000;
        const R = res[W]; R.n++; R.pnl += usd; R.hours += (t1 - t0) / H; if (usd > 0) R.win++;
        h = e + 1; // uma posição por par de cada vez
      }
    }
  }
}
console.log('janela(h) | entradas | acerto | média/op US$ | total US$ | duração média h');
for (const W of WINS) { const R = res[W]; console.log(String(W === 1 ? '2 leituras' : W).padEnd(10), R.n, (R.win / R.n * 100).toFixed(0) + '%', (R.pnl / R.n).toFixed(2), R.pnl.toFixed(0), (R.hours / R.n).toFixed(0)); }
