// Registro dos blocos da rede BCH com o contexto do momento, para achar padrões e coincidências.
// Da blockchain: altura, hora, intervalo, tamanho, transações, recompensa, taxas, dificuldade, pool (assinatura).
// Do momento: hash total da rede, hash alugado na NiceHash (SHA256ASICBOOST), preço, empate e margem, cotação,
// e a simulação (sua potência, chance e sorteio). A potência de quem achou o bloco NÃO fica na blockchain.
const SUBSIDY = 3.125, TWO32 = 4294967296;
const POOLS = [
  [/blocksniper/i, 'BlockSniper', true], [/molepool/i, 'MolePool', true], [/solopool/i, 'SoloPool.org', true],
  [/ckpool|solo\.ck/i, 'CKPool Solo', true], [/easymining|nicehash/i, 'NiceHash EasyMining', true], [/2miners/i, '2Miners', false],
  [/viabtc/i, 'ViaBTC', false], [/antpool/i, 'AntPool', false], [/f2pool/i, 'F2Pool', false], [/mining-dutch/i, 'Mining-Dutch', false],
  [/btc\.com/i, 'BTC.com', false], [/binance/i, 'Binance Pool', false], [/poolin/i, 'Poolin', false], [/foundry/i, 'Foundry', false],
  [/kryptex/i, 'Kryptex', false], [/zergpool/i, 'Zergpool', false], [/prohashing/i, 'Prohashing', false], [/emcd/i, 'EMCD', false],
  [/bitdeer/i, 'Bitdeer', false], [/jcbch/i, 'JCBCH', false], [/lsoftware/i, 'LSoftware DMCC', false], [/harshy/i, "Harshy's Pool", false],
  [/kardan/i, 'KardanPool', false], [/k1pool/i, 'K1Pool', false], [/solo/i, 'Solo (outro)', true]
];
export function poolOf(tag) {
  // pools comuns com modo solo marcam na assinatura (ex.: /Mining-Dutch/-SOLO): conta como solo
  for (const [re, name, solo] of POOLS) if (re.test(tag || '')) return { pool: name, solo: solo || /solo/i.test(tag) };
  if (!tag) return { pool: 'desconhecido', solo: false };
  // assinatura desconhecida: o nome entre barras (/nome/) ou as primeiras palavras com letras
  const m = /\/([^/]{3,30})\//.exec(tag);
  if (m) return { pool: m[1].trim(), solo: false };
  const words = []; for (const w of tag.split(/\s+/)) { if (!/[A-Za-z]{3,}/.test(w) || /^[0-9a-f]{6,}$/i.test(w)) { if (words.length) break; continue; } words.push(w); }
  return { pool: (words.join(' ') || tag).slice(0, 24), solo: false };
}

// b: bloco do REST (com outs, size, txs, tag); ctx: mercado e simulação naquele ciclo.
export function blockRecord(b, { prevT, mkt, book, sim, mineBch, realPH }) {
  const reward = b.outs.reduce((s, o) => s + o.value, 0), outs = b.outs.map((o) => o.value).sort((x, y) => y - x);
  const p = poolOf(b.tag);
  const r = {
    h: b.height, hash: String(b.hash || '').slice(-12), t: b.time, dt: prevT ? Math.round((b.time - prevT) / 1000) : null,
    size: b.size || null, txs: b.txs || null, reward: +reward.toFixed(8), fees: +Math.max(0, reward - SUBSIDY).toFixed(8),
    D: b.difficulty || null, netPH: b.difficulty ? +(b.difficulty * TWO32 / 600 / 1e15).toFixed(0) : null,
    tag: b.tag || '', pool: p.pool, solo: p.solo, outs: outs.length,
    poolFeePct: outs.length >= 2 && p.solo ? +(outs[outs.length - 1] / reward * 100).toFixed(2) : null
  };
  if (mkt && mkt.ok) Object.assign(r, { usd: +(reward * mkt.bchUsd).toFixed(2), bchUsd: mkt.bchUsd, nhBid: mkt.bidEH, nhMedian: mkt.medianEH, be: +mkt.breakEvenEH.toFixed(4), edge: +mkt.edgeAtBidPct.toFixed(2) });
  if (book) r.nhPH = +book.totalPH.toFixed(1);
  if (sim) Object.assign(r, { simPH: sim.ph || 0, simProb: sim.prob ? +sim.prob.toFixed(5) : 0, simWon: !!sim.won });
  // preço e margem em que a simulação estava comprando (decididos no ciclo anterior; a margem acima é a do registro)
  if (sim && sim.priceEH > 0 && mkt && mkt.ok) Object.assign(r, { simBid: sim.priceEH, simEdge: +((mkt.breakEvenEH / sim.priceEH - 1) * 100).toFixed(2) });
  if (mineBch > 0) r.mine = mineBch;
  if (realPH > 0 && b.difficulty) { r.realPH = +realPH.toFixed(2); r.realProb = +(realPH * 1e15 / (b.difficulty * TWO32 / 600 + realPH * 1e15)).toFixed(5); } // suas ordens reais (modo Ativo)
  return r;
}

// Resumo para padrões: por pool, solo × não solo, intervalos, taxas, tamanho, horário (UTC) e margem do aluguel.
export function blockSummary(list, { fixAt } = {}) {
  // margem gravada antes da correção do preço (31/10) era otimista: corrige o lance em +5,8%
  if (fixAt) list = list.map((b) => (b.t < fixAt && isFinite(b.edge) && b.edge !== null ? Object.assign({}, b, { edge: ((1 + b.edge / 100) / 1.058 - 1) * 100 }) : b));
  const n = list.length, avg = (f, a = list) => { const v = a.map(f).filter((x) => x !== null && x !== undefined && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const byPool = {};
  for (const b of list) { const e = byPool[b.pool] || (byPool[b.pool] = { n: 0, solo: b.solo }); e.n++; }
  const solo = list.filter((b) => b.solo), other = list.filter((b) => !b.solo);
  const hours = new Array(24).fill(0); for (const b of solo) hours[new Date(b.t).getUTCHours()]++;
  return { n, from: n ? Math.min(...list.map((b) => b.t)) : null, to: n ? Math.max(...list.map((b) => b.t)) : null,
    byPool: Object.entries(byPool).map(([pool, e]) => ({ pool, n: e.n, solo: e.solo })).sort((a, b) => b.n - a.n),
    solo: { n: solo.length, edge: avg((b) => b.edge, solo), dtBefore: avg((b) => b.dt, solo), hoursUtc: hours },
    other: { n: other.length, edge: avg((b) => b.edge, other) },
    dt: avg((b) => b.dt), fees: avg((b) => b.fees), size: avg((b) => b.size), txs: avg((b) => b.txs), edge: avg((b) => b.edge),
    slow: list.filter((b) => b.dt > 1800).length, fast: list.filter((b) => b.dt !== null && b.dt < 120).length };
}

/* ---------- placar da sorte: quem estava com X PH/s ligado o tempo todo ---------- */
// Potência mínima (PH/s) para o bloco ter sido seu no sorteio da simulação: número tirado do hash (últimos 8 hex ÷ 2³²)
// × hash da rede (D·2³²/600). Não prevê o próximo bloco (cada hash é independente): serve de placar e de prova de acaso.
export const LUCK_PH = [10, 30, 50, 100, 200, 500];
export function needPH(r) {
  if (!r || !r.hash || !(r.D > 0)) return null;
  const u = parseInt(String(r.hash).slice(-8), 16) / TWO32;
  return isFinite(u) ? u * r.D * TWO32 / 600 / 1e15 : null;
}
// list: registro de blocos; priceEH/btcUsd/blockUsd: valores de agora (usados quando o bloco não tem os do momento).
export function luckBoard(list, { now, priceEH, btcUsd, blockUsd, rentFeePct = 3, poolFeePct = 2, windows = [6, 24, 72] }) {
  const L = (list || []).filter((r) => r && r.t && needPH(r) !== null).sort((a, b) => a.t - b.t);
  const out = { windows: [], tests: null, recent: L.slice(-12).reverse().map((r) => ({ h: r.h, t: r.t, needPH: needPH(r), pool: r.pool || '' })) };
  if (!L.length || !(btcUsd > 0)) return out;
  for (const hrs of windows) {
    const sel = L.filter((r) => r.t >= now - hrs * 3600e3);
    if (sel.length < 3) continue;
    const val = (r) => (r.usd > 0 ? r.usd * (1 - poolFeePct / 100) : blockUsd || 0);
    const secs = (r) => (r.dt > 0 && r.dt < 4 * 3600 ? r.dt : 600);
    const rows = LUCK_PH.map((ph) => {
      let won = 0, rev = 0, lam = 0, expRev = 0, cost = 0;
      for (const r of sel) {
        const p = ph * 1e15 * 600 / (r.D * TWO32); // chance deste bloco ser seu (= potência ÷ rede)
        lam += p; expRev += p * val(r);
        if (needPH(r) <= ph) { won++; rev += val(r); }
        cost += ph / 1000 * (r.nhMedian || priceEH || 0) * btcUsd * (1 + rentFeePct / 100) * secs(r) / 86400;
      }
      return { ph, won, expected: lam, costUsd: cost, revUsd: rev, profitUsd: rev - cost, pct: cost > 0 ? (rev / cost - 1) * 100 : null, expPct: cost > 0 ? (expRev / cost - 1) * 100 : null };
    });
    out.windows.push({ hours: hrs, blocks: sel.length, expectedBlocks: hrs * 6, minNeedPH: Math.min(...sel.map(needPH)), rows });
  }
  // testes de padrão em todo o registro: o sorteio de um bloco ajuda a prever o próximo? a hora do dia importa?
  const u = L.map((r) => needPH(r) / (r.D * TWO32 / 600 / 1e15)), n = u.length;
  if (n >= 30) {
    const m = u.reduce((a, x) => a + x, 0) / n, sd = Math.sqrt(u.reduce((a, x) => a + (x - m) ** 2, 0));
    let cov = 0; for (let i = 1; i < n; i++) cov += (u[i - 1] - m) * (u[i] - m);
    const ac = sd > 0 ? cov / (sd * sd) : 0;
    const easy = (r) => needPH(r) <= 100, base = L.filter(easy).length / n;
    const after = []; for (let i = 0; i + 1 < n; i++) if (easy(L[i])) after.push(easy(L[i + 1]));
    const hours = [0, 6, 12, 18].map((a) => { const g = L.filter((r) => { const h = new Date(r.t).getUTCHours(); return h >= a && h < a + 6; }).map((r) => needPH(r) / (r.D * TWO32 / 600 / 1e15));
      const mean = g.length ? g.reduce((x, y) => x + y, 0) / g.length : null; return { from: a, n: g.length, mean, z: g.length ? (mean - 0.5) / (1 / Math.sqrt(12 * g.length)) : null }; });
    const dec = Array(10).fill(0); u.forEach((x) => { dec[Math.min(9, Math.floor(x * 10))]++; });
    const chi2 = dec.reduce((a, d) => a + (d - n / 10) ** 2 / (n / 10), 0);
    const pattern = Math.abs(ac) > 3 / Math.sqrt(n) || hours.some((h) => h.z !== null && Math.abs(h.z) > 3) || chi2 > 21.67;
    out.tests = { n, autocorr: ac, autocorrLimit: 2 / Math.sqrt(n), easyBase: base, easyAfterEasy: after.length ? after.filter(Boolean).length / after.length : null, easyAfterN: after.length, hours, chi2, pattern };
  }
  return out;
}
