// Varredura de oportunidades (a cada 15 min, num minuto só dela, para não estourar o limite de chamadas do ciclo):
// 1) mais algoritmos que dá para alugar na NiceHash (moedas de GPU da WhatToMine), com o livro de cada um;
// 2) preço da MiningRigRentals para todos os algoritmos (aluguel por máquina, mínimo de algumas horas);
// O resultado vai para o armazenamento ('scan') e o ciclo usa nas operações PPS e nas oportunidades.
import FDR from '../../radar.js';

export const EXTRA_ALGOS = [
  { nh: 'KAWPOW', wtm: 'KawPow', label: 'KawPow', merged: null, where: 'Ravencoin, Neoxa e outras (GPU)' },
  { nh: 'AUTOLYKOS', wtm: 'Autolykos', label: 'Autolykos', merged: null, where: 'Ergo (GPU)' },
  { nh: 'OCTOPUS', wtm: 'Octopus', label: 'Octopus', merged: null, where: 'Conflux (GPU)' },
  { nh: 'NEXAPOW', wtm: 'NexaPow', label: 'NexaPow', merged: null, where: 'Nexa (GPU)' },
  { nh: 'FISHHASH', wtm: 'FishHash', label: 'FishHash', merged: null, where: 'Iron Fish (GPU)' },
  { nh: 'BEAMV3', wtm: 'BeamHashIII', label: 'BeamHash III', merged: null, where: 'Beam (GPU)' },
  { nh: 'DAGGERHASHIMOTO', wtm: 'Ethash', label: 'Ethash', merged: null, where: 'EthereumPoW e outras (GPU)' }
];
// nomes dos algoritmos na MiningRigRentals
export const MRR_NAMES = { SHA256ASICBOOST: 'sha256ab', SCRYPT: 'scrypt', X11: 'x11', EQUIHASH: 'equihash', KHEAVYHASH: 'kheavyhash', RANDOMXMONERO: 'randomx',
  EAGLESONG: 'eaglesong', ALEPHIUM: 'blake3aleph', ETCHASH: 'etchash', KAWPOW: 'kawpow', AUTOLYKOS: 'autolykosv2', OCTOPUS: 'octopus', NEXAPOW: 'nexapow', FISHHASH: 'fishhash' };
const UNIT = { h: 1, kh: 1e3, mh: 1e6, gh: 1e9, th: 1e12, ph: 1e15, eh: 1e18, sol: 1, ksol: 1e3, msol: 1e6 };
const perH = (x) => { if (!x || !isFinite(+x.amount)) return null; const u = String(x.unit || '').toLowerCase().replace('*day', ''); return UNIT[u] ? +x.amount / UNIT[u] : null; };
const hashH = (h) => { if (!h || !isFinite(+h.hash)) return null; const u = String(h.unit || '').toLowerCase(); return UNIT[u] ? +h.hash * UNIT[u] : null; };

// WhatToMine traz a própria NiceHash como "moeda" (taxa que ela paga): não é moeda, sai da conta
function mergeWtm(asic, gpu) {
  const coins = {};
  for (const src of [asic, gpu]) for (const [k, c] of Object.entries((src && src.coins) || {})) if (c && c.tag !== 'NICEHASH') coins[k] = c;
  return Object.assign({}, asic || gpu || {}, { coins });
}

// MRR: margem por algoritmo = receita do pool PPS por hash ÷ preço sugerido por hash − 1 (a MRR cobra do dono da máquina).
export function mrrMap(info, revByAlgo) {
  const rows = {};
  for (const a of (info && info.data) || []) {
    const nh = Object.keys(MRR_NAMES).find((k) => MRR_NAMES[k] === a.name);
    if (!nh || !revByAlgo[nh]) continue;
    const sug = perH(a.suggested_price), low = perH(a.stats && a.stats.prices && a.stats.prices.lowest), rev = revByAlgo[nh];
    rows[nh] = { name: a.display || a.name, sugEdgePct: sug ? (rev / sug - 1) * 100 : null, lowEdgePct: low ? (rev / low - 1) * 100 : null,
      availRigs: +((a.stats && a.stats.available && a.stats.available.rigs) || 0), availH: hashH(a.stats && a.stats.available && a.stats.available.hash), rentedH: hashH(a.stats && a.stats.rented && a.stats.rented.hash) };
  }
  return rows;
}

export async function runScan({ env, fetchFn, now, cfg, btcUsd }) {
  const f = fetchFn || fetch, getJ = (u) => f(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const S = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e.message || e) }));
  const pub = (env.NH_BASE || 'https://api2.nicehash.com').replace(/\/$/, '');
  const [asic, gpu, mrr, ...books] = await Promise.all([getJ(env.WTM_URL || 'https://whattomine.com/asic.json'), getJ(env.WTM_GPU_URL || 'https://whattomine.com/coins.json'),
    getJ((env.MRR_URL || 'https://www.miningrigrentals.com').replace(/\/$/, '') + '/api/v2/info/algos')].concat(EXTRA_ALGOS.map((a) => getJ(pub + '/main/api/v2/hashpower/orderBook?algorithm=' + a.nh + '&size=1000'))).map(S));
  const err = [asic, gpu, mrr].filter((r) => !r.ok).map((r) => r.e);
  const W = mergeWtm(asic.ok ? asic.v : null, gpu.ok ? gpu.v : null), bk = {};
  EXTRA_ALGOS.forEach((a, i) => { if (books[i].ok) bk[a.nh] = books[i].v; });
  const opts = { btcUsd, minEdgePct: cfg.minEdgeRel ? cfg.minEdgeBase : cfg.minEdgePct, rentFeePct: cfg.rentFeePct, poolFeePct: cfg.poolFeePct };
  // moedas de GPU negociam menos que as de ASIC: liquidez mínima de 0,5 BTC por dia (nosso volume é pequeno)
  const extra = (asic.ok || gpu.ok) ? FDR.miningMap(W, bk, Object.assign({ algos: EXTRA_ALGOS, minVolBtc: 0.5 }, opts)) : [];
  const base = (asic.ok || gpu.ok) ? FDR.miningMap(W, {}, opts) : []; // só a receita por hash dos algoritmos de sempre
  const rev = {}; for (const m of base.concat(extra)) if (m.revBtcPerH > 0) rev[m.algo] = m.revBtcPerH;
  return { at: now, extra: extra.map((m) => ({ algo: m.algo, label: m.label, coins: m.coins, edgePct: m.edgePct, level: m.level, thin: !!m.thin, marketUsdDay: m.marketUsdDay, pps: true, unit: m.unit, revBtcPerH: m.revBtcPerH, rentBtcPerH: m.rentBtcPerH })),
    mrr: mrr.ok ? mrrMap(mrr.v, rev) : {}, err };
}
