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
  [/bitdeer/i, 'Bitdeer', false], [/solo/i, 'Solo (outro)', true]
];
export function poolOf(tag) {
  for (const [re, name, solo] of POOLS) if (re.test(tag || '')) return { pool: name, solo };
  return { pool: tag ? tag.slice(0, 24) : 'desconhecido', solo: false };
}

// b: bloco do REST (com outs, size, txs, tag); ctx: mercado e simulação naquele ciclo.
export function blockRecord(b, { prevT, mkt, book, sim, mineBch }) {
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
  if (mineBch > 0) r.mine = mineBch;
  return r;
}

// Resumo para padrões: por pool, solo × não solo, intervalos, taxas, tamanho, horário (UTC) e margem do aluguel.
export function blockSummary(list) {
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
