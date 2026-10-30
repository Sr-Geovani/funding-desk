/* Funding Desk — matemática de mineração solo com hashrate alugado. Lógica pura, sem DOM.
   Usado pelo index.html (window.FDM) e pelos testes (node --test).
   Base: cada hash é uma tentativa independente com chance 1/(D·2^32). Blocos encontrados seguem Poisson.
   Nada aqui depende do passado (esforço, best share, tempo desde o último bloco): é sem memória. */
(function (root) {
'use strict';

var TWO32 = 4294967296;
var PH = 1e15, DAY_S = 86400;

/* ---------- probabilidade ---------- */
// Hashes necessários em média para um bloco.
function hashesPerBlock(D) { return D * TWO32; }
// PH/s·dia necessários em média para um bloco.
function phDaysPerBlock(D) { return D * TWO32 / PH / DAY_S; }
// Blocos esperados (λ) com `ph` PH/s durante `hours` horas.
function expectedBlocks(ph, hours, D) { return ph * PH * hours * 3600 / (D * TWO32); }
function poissonPmf(k, lam) {
  var p = Math.exp(-lam);
  for (var i = 1; i <= k; i++) p *= lam / i;
  return p;
}
function poissonCdf(k, lam) {
  var s = 0;
  for (var i = 0; i <= k; i++) s += poissonPmf(i, lam);
  return Math.min(1, s);
}
function probAtLeast(k, lam) { return k <= 0 ? 1 : 1 - poissonCdf(k - 1, lam); }
// Tempo médio entre blocos para quem roda `ph` PH/s (horas).
function hoursPerBlock(ph, D) { return ph > 0 ? phDaysPerBlock(D) / ph * 24 : Infinity; }

/* ---------- economia ---------- */
// Receita esperada por PH/s por dia, em US$ (hashprice), sem taxas.
function hashpriceUsd(D, rewardCoin, coinUsd) { return rewardCoin * coinUsd / phDaysPerBlock(D); }
// Custo do aluguel por PH/s·dia em US$. NiceHash cota em BTC por EH/s por dia.
function rentalUsdPerPhDay(priceBtcPerEhDay, btcUsd, feePct) {
  return priceBtcPerEhDay / 1000 * btcUsd * (1 + (feePct || 0) / 100);
}
// Planejamento de uma sessão. Todas as taxas em %.
// p: ph, hours, D, rewardCoin, coinUsd, priceBtcPerEhDay, btcUsd, rentFeePct, poolFeePct, orderFeeBtc
function plan(p) {
  var lam = expectedBlocks(p.ph, p.hours, p.D);
  var rentPerPhDay = rentalUsdPerPhDay(p.priceBtcPerEhDay, p.btcUsd, p.rentFeePct);
  var orderFeeUsd = (p.orderFeeBtc || 0) * p.btcUsd;
  var cost = rentPerPhDay * p.ph * p.hours / 24 + orderFeeUsd;
  var blockNet = p.rewardCoin * p.coinUsd * (1 - (p.poolFeePct || 0) / 100);
  var ev = lam * blockNet;
  var hp = hashpriceUsd(p.D, p.rewardCoin, p.coinUsd) * (1 - (p.poolFeePct || 0) / 100);
  return {
    lambda: lam, cost: cost, ev: ev, evNet: ev - cost, evRatio: cost > 0 ? ev / cost : null,
    p0: Math.exp(-lam), p1: probAtLeast(1, lam), p2: probAtLeast(2, lam),
    blockNet: blockNet, hashprice: hp, rentPerPhDay: rentPerPhDay,
    edgePct: rentPerPhDay > 0 ? (hp / rentPerPhDay - 1) * 100 : null,
    breakEvenPrice: hp / (1 + (p.rentFeePct || 0) / 100) / p.btcUsd * 1000 // BTC/EH/dia que empata
  };
}
// Orçamento (US$) para ter probabilidade `prob` de ao menos um bloco, ao custo `usdPerPhDay`.
function budgetForProb(prob, D, usdPerPhDay) { return -Math.log(1 - prob) * phDaysPerBlock(D) * usdPerPhDay; }

/* ---------- NiceHash (livro de ordens público) ---------- */
// Preço em BTC/EH/dia. Velocidade aceita em EH/s.
function parseNiceHashBook(d) {
  var out = [];
  Object.keys((d && d.stats) || {}).forEach(function (mk) {
    var s = d.stats[mk], orders = (s.orders || []).filter(function (o) { return o.alive !== false; });
    var act = orders.map(function (o) { return { price: parseFloat(o.price), speed: parseFloat(o.acceptedSpeed) || 0, type: o.type, limit: parseFloat(o.limit) || 0, rigs: +o.rigsCount || 0 }; })
      .filter(function (o) { return isFinite(o.price); });
    var paying = act.filter(function (o) { return o.speed > 0; }).sort(function (a, b) { return a.price - b.price; });
    var tot = paying.reduce(function (a, o) { return a + o.speed; }, 0), acc = 0, med = null;
    for (var i = 0; i < paying.length; i++) { acc += paying[i].speed; if (acc >= tot / 2) { med = paying[i].price; break; } }
    out.push({
      market: mk, totalSpeed: parseFloat(s.totalSpeed) || tot, orders: act.length, activeOrders: paying.length,
      minActive: paying.length ? paying[0].price : null, medianWeighted: med,
      maxActive: paying.length ? paying[paying.length - 1].price : null, rigs: act.reduce(function (a, o) { return a + o.rigs; }, 0),
      updated: s.updatedTs ? Date.parse(s.updatedTs) : null
    });
  });
  return out;
}

/* ---------- rede BCH (Blockchair) ---------- */
// Texto legível do coinbase (ex.: "/Mining-Dutch/-PPS", "BlockSniper.ai ...").
function coinbaseTag(hex) {
  if (!hex) return '';
  var s = '';
  for (var i = 0; i + 1 < hex.length; i += 2) {
    var c = parseInt(hex.substr(i, 2), 16);
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : '\u0000';
  }
  return s.split('\u0000').filter(function (x) { return x.length >= 4 && /[A-Za-z]{3}/.test(x); }).join(' ').trim();
}
function parseUtc(t) { return Date.parse(String(t).replace(' ', 'T') + 'Z'); }
function parseBlocks(d) {
  return ((d && d.data) || []).map(function (b) {
    return {
      height: b.id, time: parseUtc(b.time), difficulty: b.difficulty,
      miner: b.guessed_miner && b.guessed_miner !== 'Unknown' ? b.guessed_miner : null,
      tag: coinbaseTag(b.coinbase_data_hex), txs: b.transaction_count,
      feeUsd: b.fee_total_usd || 0, rewardUsd: b.reward_usd || 0,
      // Cotação implícita no bloco (recompensa em US$ ÷ recompensa em moeda): reserva quando as APIs de preço falham.
      priceUsd: b.reward > 0 && b.reward_usd > 0 ? b.reward_usd / (b.reward / 1e8) : null
    };
  }).sort(function (a, b) { return b.height - a.height; });
}
function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
// blocks: mais novo primeiro. Intervalos em minutos.
function blockStats(blocks, now) {
  if (!blocks.length) return null;
  var iv = [];
  for (var i = 0; i + 1 < blocks.length; i++) iv.push((blocks[i].time - blocks[i + 1].time) / 60000);
  var diffs = blocks.map(function (b) { return b.difficulty; });
  var avgD = mean(diffs);
  return {
    last: blocks[0], sinceLastMin: (now - blocks[0].time) / 60000, intervals: iv,
    avg10: mean(iv.slice(0, 10)), avgAll: mean(iv), n: blocks.length,
    difficulty: blocks[0].difficulty, avgDifficulty: avgD,
    diffVsAvgPct: (blocks[0].difficulty / avgD - 1) * 100,
    feesAvgUsd: mean(blocks.map(function (b) { return b.feeUsd; }))
  };
}

/* ---------- sinal (só o que muda o valor esperado) ---------- */
// level: 'favoravel' | 'neutro' | 'desfavoravel' | 'sem-dado'
function signal(s) {
  if (!isFinite(s.edgePct)) return { level: 'sem-dado', text: 'Sem preço de aluguel' };
  var reasons = [];
  reasons.push((s.edgePct >= 0 ? 'Aluguel abaixo' : 'Aluguel acima') + ' da receita esperada (' + (s.edgePct >= 0 ? '+' : '') + s.edgePct.toFixed(1) + '%)');
  if (isFinite(s.diffVsAvgPct)) reasons.push('Dificuldade ' + (s.diffVsAvgPct <= 0 ? 'abaixo' : 'acima') + ' da média recente (' + (s.diffVsAvgPct >= 0 ? '+' : '') + s.diffVsAvgPct.toFixed(1) + '%)');
  var level = s.edgePct >= 0 ? 'favoravel' : (s.edgePct >= -5 ? 'neutro' : 'desfavoravel');
  return { level: level, text: level === 'favoravel' ? 'Valor esperado positivo' : (level === 'neutro' ? 'Perto do empate' : 'Valor esperado negativo'), reasons: reasons };
}

/* ---------- diário de sessões ---------- */
// sessão: id, t, platform, pool, ph (média), hours, costUsd, D, blocks, rewardUsd, tags [], note
function sessionLambda(s) { return s.D > 0 ? expectedBlocks(s.ph, s.hours, s.D) : 0; }
function summarize(list) {
  var r = { n: list.length, cost: 0, reward: 0, blocks: 0, lambda: 0 };
  list.forEach(function (s) { r.cost += +s.costUsd || 0; r.reward += +s.rewardUsd || 0; r.blocks += +s.blocks || 0; r.lambda += sessionLambda(s); });
  r.net = r.reward - r.cost;
  r.roi = r.cost > 0 ? r.net / r.cost * 100 : null;
  r.luck = r.lambda > 0 ? r.blocks / r.lambda : null; // 1 = exatamente o esperado
  // Chance de um resultado tão bom (ou tão ruim) só por sorte, dado o λ somado.
  r.pAsGood = r.lambda > 0 ? probAtLeast(r.blocks, r.lambda) : null;
  r.pAsBad = r.lambda > 0 ? poissonCdf(r.blocks, r.lambda) : null;
  return r;
}
function byTag(list) {
  var tags = {};
  list.forEach(function (s) { (s.tags || []).forEach(function (t) { (tags[t] = tags[t] || []).push(s); }); });
  return Object.keys(tags).sort().map(function (t) { var r = summarize(tags[t]); r.tag = t; return r; });
}
function ensureSessionId(s) { if (!s.id) s.id = 'm' + s.t; return s; }
var SESSION_COLS = ['id', 'inicio', 'plataforma', 'pool', 'ph_s', 'horas', 'custo_usd', 'dificuldade', 'blocos', 'recompensa_usd', 'tags', 'obs'];
function cell(v) { var s = v === undefined || v === null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function sessionsToCSV(list) {
  return SESSION_COLS.join(',') + '\n' + list.map(function (s) {
    ensureSessionId(s);
    return [s.id, new Date(s.t).toISOString(), s.platform, s.pool, s.ph, s.hours, s.costUsd, s.D, s.blocks, s.rewardUsd, (s.tags || []).join('|'), s.note || ''].map(cell).join(',');
  }).join('\n');
}

var FDM = {
  TWO32: TWO32, hashesPerBlock: hashesPerBlock, phDaysPerBlock: phDaysPerBlock, expectedBlocks: expectedBlocks,
  poissonPmf: poissonPmf, poissonCdf: poissonCdf, probAtLeast: probAtLeast, hoursPerBlock: hoursPerBlock,
  hashpriceUsd: hashpriceUsd, rentalUsdPerPhDay: rentalUsdPerPhDay, plan: plan, budgetForProb: budgetForProb,
  parseNiceHashBook: parseNiceHashBook, coinbaseTag: coinbaseTag, parseBlocks: parseBlocks, blockStats: blockStats,
  signal: signal, sessionLambda: sessionLambda, summarize: summarize, byTag: byTag, ensureSessionId: ensureSessionId,
  SESSION_COLS: SESSION_COLS, sessionsToCSV: sessionsToCSV
};
if (typeof module !== 'undefined' && module.exports) module.exports = FDM;
else root.FDM = FDM;
})(typeof window !== 'undefined' ? window : globalThis);
