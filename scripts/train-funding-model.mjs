// Treina a camada de IA do funding (modo sombra): probabilidade de uma entrada pagar as taxas em 3 dias.
// Dados: funding PAGO de Hyperliquid, OKX e Bitget (Binance e Bybit bloqueiam o servidor de treino), 90 dias.
// Teste honesto: treina nos primeiros 2/3 do período e mede só no último 1/3 (com 3 dias de folga entre os dois).
// Uso: NODE_USE_ENV_PROXY=1 node scripts/train-funding-model.mjs [dias] [--cache /tmp/arquivo.json]
// Saídas: worker/src/fundmodel.js (pesos) e docs/modelo-funding.md (relatório).
import fs from 'node:fs';
import { pairFeatures, beApr, score, FEATURES } from '../worker/src/features.js';

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
// Pagamentos de cada liquidação em (t, t + 72 h]: short recebe a taxa de A, long paga a de B.
function realized(evA, evB, t) {
  const sum = (ev) => ev.filter((x) => x.t > t && x.t <= t + HOLD * H).reduce((s, x) => s + x.rate, 0);
  return sum(evA) - sum(evB);
}

function dataset(raw) {
  const rows = [], venues = Object.keys(FEES);
  for (const [coin, v] of Object.entries(raw)) {
    const ser = {}; for (const k of venues) if (v[k] && v[k].length > 20) ser[k] = hourly(v[k]);
    const have = Object.keys(ser);
    for (let i = 0; i < have.length; i++) for (let j = 0; j < have.length; j++) {
      if (i === j) continue;
      const A = have[i], B = have[j], cost = 2 * (FEES[A] + FEES[B]) + SLIP, be = beApr(cost, 3);
      const sp = ser[A].map((x, h) => (x === null || ser[B][h] === null ? null : x - ser[B][h]));
      for (let h = 72; h < sp.length - HOLD; h += 2) { // a cada 2 h: menos amostras quase iguais
        const s0 = sp[h], s1 = sp[h - 1];
        if (s0 === null || s1 === null || s0 < be || s1 < be || s0 > CAP) continue; // mesma regra do robô: "Compensa" em 2 leituras
        const win = sp.slice(h - 71, h + 1); if (win.some((x) => x === null)) continue;
        const t = T0 + h * H, pnl = realized(v[A], v[B], t) - cost;
        rows.push({ coin, A, B, t, x: pairFeatures(win, be), y: pnl > 0 ? 1 : 0, pnl });
      }
    }
  }
  return rows;
}

function train(rows, l2 = 0.01, iters = 3000, lr = 0.1) {
  const k = FEATURES.length, mean = new Array(k).fill(0), std = new Array(k).fill(0);
  for (const r of rows) r.x.forEach((v, i) => { mean[i] += v / rows.length; });
  for (const r of rows) r.x.forEach((v, i) => { std[i] += (v - mean[i]) ** 2 / rows.length; });
  for (let i = 0; i < k; i++) std[i] = Math.sqrt(std[i]) || 1;
  const Z = rows.map((r) => r.x.map((v, i) => (v - mean[i]) / std[i]));
  let w = new Array(k).fill(0), b = 0;
  const pos = rows.filter((r) => r.y).length / rows.length; b = Math.log(pos / (1 - pos));
  for (let it = 0; it < iters; it++) {
    const gw = new Array(k).fill(0); let gb = 0;
    for (let n = 0; n < rows.length; n++) {
      let z = b; for (let i = 0; i < k; i++) z += w[i] * Z[n][i];
      const e = 1 / (1 + Math.exp(-z)) - rows[n].y; gb += e; for (let i = 0; i < k; i++) gw[i] += e * Z[n][i];
    }
    b -= lr * gb / rows.length; for (let i = 0; i < k; i++) w[i] -= lr * (gw[i] / rows.length + l2 * w[i]);
  }
  return { mean, std, weights: w, bias: b };
}
function auc(ps, ys) {
  const idx = ps.map((p, i) => [p, ys[i]]).sort((a, b) => a[0] - b[0]); let r = 0, np = 0, nn = 0;
  idx.forEach((x, i) => { if (x[1]) { r += i + 1; np++; } else nn++; });
  return np && nn ? (r - np * (np + 1) / 2) / (np * nn) : null;
}
const stat = (rs) => ({ n: rs.length, hit: rs.length ? rs.filter((r) => r.y).length / rs.length : null, pnl: rs.length ? rs.reduce((s, r) => s + r.pnl, 0) / rs.length : null });

(async () => {
  const raw = await download();
  const rows = dataset(raw);
  const cut = T0 + (NOW - T0 - HOLD * H) * 2 / 3;
  const tr = rows.filter((r) => r.t < cut - HOLD * H), te = rows.filter((r) => r.t >= cut);
  if (tr.length < 200 || te.length < 50) { console.error('poucos dados', tr.length, te.length); process.exit(1); }
  const m = train(tr);
  const model = Object.assign({ features: FEATURES }, m);
  // limiar: o que dá o maior resultado médio no treino, mantendo ao menos 20% das entradas
  let best = { th: 0.5, v: -1e9 };
  for (let th = 0.3; th <= 0.8; th += 0.05) {
    const kept = tr.filter((r) => score(model, r.x) >= th);
    if (kept.length < tr.length * 0.2) continue;
    const v = stat(kept).pnl; if (v > best.v) best = { th: +th.toFixed(2), v };
  }
  model.threshold = best.th;
  const pTe = te.map((r) => score(model, r.x));
  const keep = te.filter((r, i) => pTe[i] >= model.threshold), drop = te.filter((r, i) => pTe[i] < model.threshold);
  const buckets = [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 1.01]].map(([a, b]) => {
    const s = te.filter((r, i) => pTe[i] >= a && pTe[i] < b); return { faixa: `${a}–${Math.min(b, 1)}`, n: s.length, previsto: s.length ? s.reduce((x, r) => x + score(model, r.x), 0) / s.length : null, real: stat(s).hit };
  });
  model.report = { trainedAt: new Date(NOW).toISOString(), days: DAYS, coins: Object.keys(raw).length, train: stat(tr), test: stat(te),
    testKept: stat(keep), testDropped: stat(drop), auc: auc(pTe, te.map((r) => r.y)), buckets, threshold: model.threshold };
  const js = `// Gerado por scripts/train-funding-model.mjs em ${model.report.trainedAt}. Não edite à mão.\n` +
    `// Modelo logístico: probabilidade de uma entrada de funding pagar as taxas em 3 dias (modo sombra).\nexport const FUND_MODEL = ${JSON.stringify(model, null, 1)};\n`;
  fs.writeFileSync(new URL('../worker/src/fundmodel.js', import.meta.url), js);
  const f = (x, d = 1) => (x === null || x === undefined ? '—' : (x * (d === 'p' ? 100 : 1)).toFixed(d === 'p' ? 0 : 3));
  const R = model.report, pct = (x) => (x === null ? '—' : Math.round(x * 100) + '%'), usd = (x) => (x === null ? '—' : (x * 10 >= 0 ? '+' : '−') + 'US$' + Math.abs(x * 10).toFixed(2));
  const md = `# Modelo de funding (IA em modo sombra)

Gerado em ${R.trainedAt} com ${R.days} dias de funding **pago** de Hyperliquid, OKX e Bitget (${R.coins} moedas).
Binance e Bybit bloqueiam o servidor de treino; o modelo aprende o comportamento do *spread*, que vale para os outros pares.

**Pergunta que o modelo responde:** quando a regra diz "Compensa" (spread acima do empate em 2 leituras), qual a chance
de a entrada pagar as 4 execuções e o deslize nos 3 dias seguintes?

**Teste honesto:** treinado nos primeiros 2/3 do período e medido só no último 1/3, que ele não viu (com 3 dias de folga).
Valores em US$ por operação de US$1.000 por perna.

| Conjunto | Entradas | Acerto | Resultado médio |
|---|---|---|---|
| Treino (regras) | ${R.train.n} | ${pct(R.train.hit)} | ${usd(R.train.pnl)} |
| Teste: todas as entradas das regras | ${R.test.n} | ${pct(R.test.hit)} | ${usd(R.test.pnl)} |
| Teste: só as que a IA aprova (p ≥ ${R.threshold}) | ${R.testKept.n} | ${pct(R.testKept.hit)} | ${usd(R.testKept.pnl)} |
| Teste: as que a IA vetaria | ${R.testDropped.n} | ${pct(R.testDropped.hit)} | ${usd(R.testDropped.pnl)} |

AUC no teste: ${R.auc === null ? '—' : R.auc.toFixed(2)} (0,5 = acaso; 1 = perfeito).

**Calibração no teste** (a chance prevista bate com o que aconteceu?):

| Faixa prevista | Entradas | Previsto | Real |
|---|---|---|---|
${R.buckets.map((b) => `| ${b.faixa} | ${b.n} | ${pct(b.previsto)} | ${pct(b.real)} |`).join('\n')}

**Características usadas** (todas do passado): excesso do spread sobre o empate agora e nas médias de 8, 24 e 72 h,
oscilação em 24 h, fração de horas positivas em 24 h, horas seguidas acima do empate e tamanho do pico em relação à média.

Pesos: ${FEATURES.map((n, i) => n + ' ' + model.weights[i].toFixed(2)).join(', ')}.

**Como entra no robô:** em modo sombra. O robô simulado de funding roda duas versões lado a lado, "Regras" e
"Regras + IA" (só entra se p ≥ ${R.threshold}). Vira oficial só se ganhar por semanas no placar real.
`;
  fs.writeFileSync(new URL('../docs/modelo-funding.md', import.meta.url), md);
  console.log(JSON.stringify(model.report, null, 1));
})();
