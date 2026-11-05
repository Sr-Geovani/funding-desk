/* Funding Desk — radar: mapas de mercado, padrões e alertas. Lógica pura (sem DOM).
   Usado pelo painel (window.FDR), pelo backend e pelos testes (node --test). */
(function (root) {
'use strict';

var TWO32 = 4294967296, HOUR = 36e5;
var MAJORS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'LINK', 'AVAX', 'SUI'];

/* ---------- mapa de funding ---------- */
// Linhas = moedas (majors + as de maior diferença entre exchanges), colunas = exchanges. APR em % a.a.
function fundingMatrix(rows, venues, opts) {
  opts = opts || {};
  var minVol = opts.minVol || 0;
  function ok(r) { return r && (r.vol === null || r.vol === undefined || r.vol >= minVol); }
  var coins = (opts.coins || MAJORS).filter(function (c) { return rows[c]; });
  if (opts.extra) {
    var cand = Object.keys(rows).filter(function (c) { return coins.indexOf(c) < 0; }).map(function (c) {
      var a = venues.filter(function (v) { return ok(rows[c][v]); }).map(function (v) { return rows[c][v].apr; });
      return a.length >= 2 ? { c: c, spread: Math.max.apply(null, a) - Math.min.apply(null, a) } : null;
    }).filter(Boolean).sort(function (x, y) { return y.spread - x.spread; }).slice(0, opts.extra);
    coins = coins.concat(cand.map(function (x) { return x.c; }));
  }
  return coins.map(function (c) {
    var cells = venues.map(function (v) {
      var r = rows[c][v];
      return r && ok(r) ? { venue: v, apr: r.apr, hours: r.hours, src: r.src } : null;
    });
    var have = cells.filter(Boolean), hi = null, lo = null;
    have.forEach(function (x) { if (!hi || x.apr > hi.apr) hi = x; if (!lo || x.apr < lo.apr) lo = x; });
    return { coin: c, major: MAJORS.indexOf(c) >= 0, cells: cells, hi: hi, lo: lo, spread: hi && lo && hi !== lo ? hi.apr - lo.apr : 0 };
  });
}

// Sentimento dos majors pelo funding médio (BTC, ETH, SOL). ~11% a.a. é o neutro padrão (0,01% a cada 8 h).
function sentiment(rows, venues) {
  var v = [];
  ['BTC', 'ETH', 'SOL'].forEach(function (c) { venues.forEach(function (x) { if (rows[c] && rows[c][x] && isFinite(rows[c][x].apr)) v.push(rows[c][x].apr); }); });
  if (!v.length) return null;
  var avg = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
  var lv = avg > 30 ? { key: 'euforia', label: 'Comprado demais', cls: 'bad', text: 'Muitos alavancados comprados: o funding alto paga bem quem está vendido no perpétuo, mas quedas rápidas e liquidações em cascata ficam mais prováveis.' }
    : avg > 15 ? { key: 'comprado', label: 'Comprado', cls: 'warn', text: 'Mercado pagando acima do normal para ficar comprado: bom para Spot + Perp; atenção a reversões.' }
    : avg >= 0 ? { key: 'neutro', label: 'Neutro', cls: 'ok', text: 'Funding perto do padrão: oportunidades vêm mais de diferenças entre exchanges do que do nível do mercado.' }
    : { key: 'vendido', label: 'Vendido demais', cls: 'bad', text: 'Funding negativo nos majors: muitos vendidos alavancados. Altas rápidas (short squeeze) ficam mais prováveis; Spot + Perp não funciona.' };
  return Object.assign({ avg: avg, n: v.length }, lv);
}

/* ---------- mapa de mineração por algoritmo ---------- */
// nh: nome do algoritmo na NiceHash; wtm: nome na WhatToMine; merged: moedas mineradas juntas (merged mining).
var ALGOS = [
  { nh: 'SHA256ASICBOOST', wtm: 'SHA-256', label: 'SHA-256', merged: null, where: 'BTC, BCH, BSV: pools solo por moeda (mercado SHA256ASICBOOST da NiceHash)' },
  { nh: 'SCRYPT', wtm: 'Scrypt', label: 'Scrypt', merged: ['LTC', 'DOGE'], where: 'LTC + DOGE juntos (merged mining), ex.: LiteSolo' },
  { nh: 'KHEAVYHASH', wtm: 'kHeavyHash', label: 'kHeavyHash', merged: null, where: 'Kaspa (blocos a cada 0,1 s: pouca variação)' },
  { nh: 'X11', wtm: 'X11', label: 'X11', merged: null, where: 'Dash' },
  { nh: 'EQUIHASH', wtm: 'Equihash', label: 'Equihash', merged: null, where: 'Zcash e outras' },
  { nh: 'EAGLESONG', wtm: 'Eaglesong', label: 'Eaglesong', merged: null, where: 'Nervos (CKB)' },
  { nh: 'ALEPHIUM', wtm: 'Blake3', label: 'Blake3', merged: null, where: 'Alephium' },
  { nh: 'RANDOMXMONERO', wtm: 'RandomX', label: 'RandomX', merged: null, where: 'Monero (CPU)' },
  { nh: 'ETCHASH', wtm: 'Etchash', label: 'Etchash', merged: null, where: 'Ethereum Classic' }
];

// Receita em BTC por H/s por dia de uma moeda da WhatToMine (exchange_rate em BTC; para o próprio BTC é US$).
// A WhatToMine usa a dificuldade DO MOMENTO. Moedas que reajustam a cada bloco (DOGE, DASH) oscilam muito: num vale a
// conta mostra +20% ou +100% que não dá para capturar (o vale dura minutos e o pool PPS paga pela média). Quando a
// dificuldade de agora está abaixo da média de 24 h, usa a média (conservador). Receita ∝ 1 ÷ dificuldade.
function coinRevenueBtc(c) {
  var rate = c.tag === 'BTC' ? 1 : +c.exchange_rate;
  if (!(c.block_time > 0 && c.nethash > 0 && rate > 0)) return null;
  var r = 86400 / c.block_time * c.block_reward * rate / c.nethash, d = +c.difficulty, d24 = +c.difficulty24;
  return d > 0 && d24 > d ? r * d / d24 : r;
}
// Receita sem a correção (como a WhatToMine mostra), para comparar.
function coinRevenueRaw(c) {
  var rate = c.tag === 'BTC' ? 1 : +c.exchange_rate;
  return c.block_time > 0 && c.nethash > 0 && rate > 0 ? 86400 / c.block_time * c.block_reward * rate / c.nethash : null;
}
function wtmCoins(wtm) {
  return Object.keys((wtm && wtm.coins) || {}).map(function (k) { return wtm.coins[k]; })
    .filter(function (c) { return c.tag !== 'NICEHASH' && !c.lagging; });
}
function btcUsdFrom(wtm) {
  var b = wtmCoins(wtm).filter(function (c) { return c.tag === 'BTC'; })[0];
  return b ? +b.exchange_rate : null;
}
// Livro da NiceHash de qualquer algoritmo → preço em BTC por H/s por dia.
function bookPerHash(d) {
  var mk = Object.keys((d && d.stats) || {})[0];
  if (!mk) return null;
  var s = d.stats[mk], pf = parseFloat(s.priceFactor) || 1;
  // recebendo agora = velocidade aceita e máquinas trabalhando (a velocidade é média e demora a zerar)
  var live = function (o) { return o.alive !== false && parseFloat(o.acceptedSpeed) > 0; };
  var withRigs = (s.orders || []).some(function (o) { return live(o) && +o.rigsCount > 0; });
  var paying = (s.orders || []).filter(function (o) { return live(o) && (!withRigs || +o.rigsCount > 0); })
    .map(function (o) { return { p: parseFloat(o.price), v: parseFloat(o.acceptedSpeed) }; }).sort(function (a, b) { return a.p - b.p; });
  // preço absurdo (abaixo da metade da mediana) fica de fora: não é hash que dá para comprar
  var t0 = paying.reduce(function (a, o) { return a + o.v; }, 0), a0 = 0, m0 = null;
  paying.forEach(function (o) { if (m0 === null) { a0 += o.v; if (a0 >= t0 / 2) m0 = o.p; } });
  if (m0) paying = paying.filter(function (o) { return o.p >= m0 * 0.5; });
  var tot = paying.reduce(function (a, o) { return a + o.v; }, 0), acc = 0, med = null;
  paying.forEach(function (o) { if (med === null) { acc += o.v; if (acc >= tot / 2) med = o.p; } });
  // btcDay: quanto o mercado inteiro gasta por dia (BTC) nas ordens recebendo hash; mede se cabe uma ordem nossa.
  var mf = parseFloat(s.marketFactor) || pf; // velocidade vem em marketFactor (ex.: PH) e preço em priceFactor (ex.: EH)
  var btcDay = paying.reduce(function (a, o) { return a + o.v * mf / pf * o.p; }, 0);
  return { unit: s.displayPriceFactor || '', factor: pf, fill: paying.length ? paying[0].p / pf : null, median: med !== null ? med / pf : null, paying: paying.length, btcDay: btcDay };
}
// books: { SHA256ASICBOOST: <livro>, SCRYPT: <livro>, ... }; extra: moedas fora da WhatToMine (ex.: BSV).
// Custos reais: SHA-256 vai para pool solo (taxa do pool configurada). Os outros algoritmos vão para pool PPS, que cobra
// mais (ppsFeePct, padrão 4%), e perdem shares rejeitados/atrasados entre NiceHash e pool + a venda das moedas
// recebidas (lossPct, padrão 2,5%). rawEdgePct = margem como a WhatToMine mostraria (dificuldade do momento, sem perdas).
// Só entram como opção principal moedas com liquidez (volume 24 h ≥ minVolBtc). Redes pequenas ficam em `small`:
// a conta por hash engana nelas (o hash alugado derruba a dificuldade e não há onde vender).
function miningMap(wtm, books, opts) {
  opts = opts || {};
  var btcUsd = opts.btcUsd || btcUsdFrom(wtm), fee = (opts.rentFeePct === undefined ? 3 : opts.rentFeePct) / 100;
  var solo = (opts.poolFeePct === undefined ? 2 : opts.poolFeePct) / 100, m = (opts.minEdgePct || 0) / 100;
  var pps = (opts.ppsFeePct === undefined ? 4 : opts.ppsFeePct) / 100, loss = (opts.lossPct === undefined ? 2.5 : opts.lossPct) / 100;
  var coins = wtmCoins(wtm).concat(opts.extra || []), minVol = opts.minVolBtc === undefined ? 10 : opts.minVolBtc;
  function liquid(c) { return c.exchange_rate_vol === undefined || c.exchange_rate_vol === null || +c.exchange_rate_vol >= minVol; }
  return (opts.algos || ALGOS).map(function (a) {
    var all = coins.filter(function (c) { return c.algorithm === a.wtm; })
      .map(function (c) { return { coin: c.tag, name: c.name || c.tag, rev: coinRevenueBtc(c), raw: coinRevenueRaw(c), liquid: liquid(c) }; })
      .filter(function (c) { return c.rev > 0; }).sort(function (x, y) { return y.rev - x.rev; });
    var list = all.filter(function (c) { return c.liquid; });
    if (!list.length) return null;
    var best = list[0], option = { coins: [best.coin], rev: best.rev, raw: best.raw };
    if (a.merged) {
      var mc = list.filter(function (c) { return a.merged.indexOf(c.coin) >= 0; });
      var mrev = mc.reduce(function (s, c) { return s + c.rev; }, 0);
      if (mc.length > 1 && mrev > option.rev) option = { coins: mc.map(function (c) { return c.coin; }), rev: mrev, raw: mc.reduce(function (s, c) { return s + (c.raw || 0); }, 0) };
    }
    var b = bookPerHash(books && books[a.nh]), isSolo = a.nh === 'SHA256ASICBOOST';
    var keep = isSolo ? 1 - solo : (1 - pps) * (1 - loss);
    var rev = option.rev * keep;
    var rent = b && b.median ? b.median * (1 + fee) : (b && b.fill ? b.fill * (1 + fee) : null);
    var level = rent ? (rent <= rev * (1 - m) ? 'go' : (rent <= rev ? 'maybe' : 'no')) : 'none';
    // Livro raso: poucas ordens recebendo hash, ou o mercado inteiro gasta tão pouco por dia que a nossa ordem de
    // teste (US$100/dia) seria mais de 10% dele (ex.: X11 com ~US$80/dia): o preço típico não vale para o nosso volume.
    var mktUsd = b && btcUsd ? b.btcDay * btcUsd : null;
    var thin = !!b && (b.paying < (opts.minPaying || 5) || (mktUsd !== null && mktUsd < (opts.minMarketUsdDay || 1000)));
    if (thin && level === 'go') level = 'maybe';
    var unitF = b ? b.factor : null;
    return {
      algo: a.nh, label: a.label, where: a.where, coins: option.coins, merged: option.coins.length > 1, all: list.slice(0, 4).map(function (c) { return c.coin; }),
      small: all.filter(function (c) { return !c.liquid && c.rev > option.rev; }).slice(0, 3).map(function (c) { return c.coin; }),
      revBtcPerH: rev, rentBtcPerH: rent, edgePct: rent ? (rev / rent - 1) * 100 : null, level: level,
      rawEdgePct: rent && option.raw ? (option.raw * (1 - solo) / rent - 1) * 100 : null, pps: !isSolo, keepPct: keep * 100,
      unitFactor: unitF, capBtcPerUnit: unitF ? rev * unitF / (1 + fee) * (1 - m) : null, fillBtcPerUnit: b && b.fill ? b.fill * unitF : null,
      unit: b ? b.unit : '', revUsdPerUnit: unitF && btcUsd ? rev * unitF * btcUsd : null, rentUsdPerUnit: unitF && rent && btcUsd ? rent * unitF * btcUsd : null,
      paying: b ? b.paying : 0, thin: thin, marketUsdDay: mktUsd
    };
  }).filter(Boolean).sort(function (x, y) { return (y.edgePct === null ? -1e9 : y.edgePct) - (x.edgePct === null ? -1e9 : x.edgePct); });
}

/* ---------- padrões (histórico local de snapshots) ---------- */
// snapshot: { t, sent, edges: { 'BCH': %, 'SCRYPT': % ... }, prices: { BCH: us$ }, best: [{ key, level, coin, title, net }] }
function pushHistory(hist, snap, opts) {
  opts = opts || {};
  var minGap = opts.minGapMs || 10 * 60e3, maxAge = opts.maxAgeMs || 7 * 864e5;
  var h = (hist || []).slice();
  if (h.length && snap.t - h[h.length - 1].t < minGap) h[h.length - 1] = snap; else h.push(snap);
  return h.filter(function (x) { return snap.t - x.t <= maxAge; });
}
// Média por hora do dia (fuso local via offsetMin) de um campo de edges. Mostra horários baratos/caros.
function hourProfile(hist, field, offsetMin) {
  var b = [];
  for (var i = 0; i < 24; i++) b.push({ h: i, sum: 0, n: 0 });
  (hist || []).forEach(function (x) {
    var v = x.edges && x.edges[field];
    if (!isFinite(v)) return;
    var hh = new Date(x.t + (offsetMin || 0) * 60e3).getUTCHours();
    b[hh].sum += v; b[hh].n++;
  });
  return b.map(function (x) { return { h: x.h, avg: x.n ? x.sum / x.n : null, n: x.n }; });
}
// Variação (%) de um preço contra o snapshot mais próximo de `mins` minutos atrás.
function priceMove(hist, coin, now, mins) {
  var target = now - mins * 60e3, ref = null;
  (hist || []).forEach(function (x) {
    if (x.prices && x.prices[coin] > 0 && x.t <= target + 5 * 60e3 && (!ref || Math.abs(x.t - target) < Math.abs(ref.t - target))) ref = x;
  });
  var last = (hist || []).filter(function (x) { return x.prices && x.prices[coin] > 0; }).pop();
  if (!ref || !last || ref === last || target - ref.t > 30 * 60e3) return null;
  return (last.prices[coin] / ref.prices[coin] - 1) * 100;
}

/* ---------- alertas ---------- */
var SHA_COINS = { BCH: 1, BSV: 1, BTC: 1 }; // moedas da aba "Agora" (SHA-256); o resto abre em "Algoritmos"
var COOLDOWN = { fe: 6 * HOUR, fs: 2 * HOUR, sent: 12 * HOUR, me: 3 * HOUR, ms: 3 * HOUR, pm: 6 * HOUR };
// c: { snap, prev, hist, positions: [{ id, coin, s, l, level, text }], mem: { key: tAlerted }, now, minEdgePct }
function evaluateAlerts(c) {
  var now = c.now, mem = Object.assign({}, c.mem || {}), out = [], s = c.snap || {}, p = c.prev || {};
  function fire(type, key, a) {
    var k = type + ':' + key;
    if (mem[k] && now - mem[k] < COOLDOWN[type]) return;
    mem[k] = now;
    out.push(Object.assign({ id: k + ':' + now, t: now, key: k }, a));
  }
  var prevGo = {};
  (p.best || []).forEach(function (b) { if (b.level === 'go') prevGo[b.key] = true; });
  (s.best || []).forEach(function (b) {
    if (b.level !== 'go') return;
    var stable = b.stab === 'estavel', persist = prevGo[b.key];
    if (stable || persist) fire('fe', b.key, { kind: 'entrada', area: 'funding', go: 'fund',
      title: 'Entrada: ' + b.coin + ' (' + b.title + ')',
      text: (stable ? 'Compensa e o spread pago está estável nos últimos dias. ' : 'Compensa há pelo menos dois ciclos de leitura. ') + 'Projeção: ' + b.netTxt + '.' });
  });
  (c.positions || []).forEach(function (x) {
    if (x.level === 'bad') fire('fs', x.id, { kind: 'saida', area: 'funding', go: 'diary',
      title: 'Saída: ' + x.coin + ' (' + x.s + ' / ' + x.l + ')', text: x.text + '. Avalie fechar as duas pernas juntas.' });
  });
  if (s.sent && (!p.sent || p.sent.key !== s.sent.key) && (s.sent.key === 'euforia' || s.sent.key === 'vendido'))
    fire('sent', s.sent.key, { kind: 'risco', area: 'mercado', go: 'radar', title: 'Mercado: ' + s.sent.label.toLowerCase(), text: s.sent.text });
  var m = c.minEdgePct || 0;
  Object.keys(s.edges || {}).forEach(function (f) {
    var v = s.edges[f], pv = p.edges ? p.edges[f] : undefined;
    if (!isFinite(v)) return;
    var dest = SHA_COINS[f] ? 'mine' : 'mine:algos';
    if (v >= m && isFinite(pv) && pv < m) fire('me', f, { kind: 'entrada', area: 'mineracao', go: dest, focus: f,
      title: 'Mineração: ' + f + ' passou a compensar (' + (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%)',
      text: 'O aluguel ficou abaixo do que o hash rende, com a sua margem. Confira no Planejar antes de abrir ordem.' });
    if (v < 0 && isFinite(pv) && pv >= 0) fire('ms', f, { kind: 'saida', area: 'mineracao', go: dest, focus: f,
      title: 'Mineração: ' + f + ' deixou de compensar (' + v.toFixed(1).replace('.', ',') + '%)',
      text: 'O aluguel passou a custar mais do que o hash rende. Pause ou reduza ordens dessa moeda.' });
  });
  ['BCH', 'LTC', 'DOGE', 'BSV', 'KAS'].forEach(function (coin) {
    var mv = priceMove(c.hist, coin, now, 60);
    if (mv !== null && mv >= 5) fire('pm', coin, { kind: 'oportunidade', area: 'mineracao', go: 'mine',
      title: coin + ' subiu ' + mv.toFixed(1).replace('.', ',') + '% em 1 h',
      text: 'A dificuldade leva horas para acompanhar o preço: o hash pode render mais nesse intervalo. Confira se o aluguel ficou abaixo do teto.' });
  });
  return { alerts: out, mem: mem };
}

/* ---------- alertas: "agora" e histórico ----------
   Agora = condições verdadeiras neste momento (recalculadas a cada leitura; somem sozinhas quando deixam de valer).
   Histórico = eventos disparados (entrou, saiu, mudou), guardados por 7 dias. */
var PRIO = { saida: 0, risco: 1, atencao: 2, entrada: 3, oportunidade: 4 };
function activeConditions(c) {
  var out = [], s = c.snap || {}, m = c.minEdgePct || 0;
  (c.positions || []).forEach(function (x) {
    if (x.level === 'bad') out.push({ key: 'fs:' + x.id, kind: 'saida', area: 'funding', go: 'diary', title: 'Saída: ' + x.coin + ' (' + x.s + ' / ' + x.l + ')', text: x.text + '. Feche as duas pernas juntas.' });
    else if (x.level === 'warn') out.push({ key: 'fw:' + x.id, kind: 'atencao', area: 'funding', go: 'diary', title: 'Atenção: ' + x.coin + ' (' + x.s + ' / ' + x.l + ')', text: x.text + '. Veja no Diário se vale continuar ou trocar.' });
  });
  if (s.sent && (s.sent.key === 'euforia' || s.sent.key === 'vendido'))
    out.push({ key: 'sent:' + s.sent.key, kind: 'risco', area: 'mercado', go: 'radar', title: 'Mercado: ' + s.sent.label.toLowerCase(), text: s.sent.text });
  (s.best || []).forEach(function (b) {
    if (b.level === 'go') out.push({ key: 'fe:' + b.key, kind: 'entrada', area: 'funding', go: 'fund', coin: b.coin,
      title: 'Entrada: ' + b.coin + ' (' + b.title + ')', text: (b.stab === 'estavel' ? 'Estável no histórico. ' : '') + 'Projeção: ' + b.netTxt + '.' });
  });
  Object.keys(s.edges || {}).forEach(function (f) {
    var v = s.edges[f];
    if (isFinite(v) && v >= m && !(s.thin && s.thin[f])) out.push({ key: 'me:' + f, kind: 'entrada', area: 'mineracao', go: SHA_COINS[f] ? 'mine' : 'mine:algos', focus: f, coin: f,
      title: 'Mineração: ' + f + ' compensa (' + (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%)', text: 'O aluguel está abaixo do que o hash rende, com a sua margem.' });
  });
  return out.sort(function (a, b) { return PRIO[a.kind] - PRIO[b.kind] || (a.title < b.title ? -1 : 1); });
}
// Junta várias entradas da mesma área num item só ("4 entradas de funding: ENA, WLD...").
function groupConditions(list) {
  var out = [], groups = {};
  list.forEach(function (a) {
    if (a.kind !== 'entrada') { out.push(a); return; }
    var g = groups[a.area];
    if (!g) { g = groups[a.area] = { key: 'grupo:' + a.area, kind: 'entrada', area: a.area, go: a.go, items: [] }; out.push(g); }
    g.items.push(a);
  });
  return out.map(function (a) {
    if (!a.items) return a;
    if (a.items.length === 1) return a.items[0];
    var names = a.items.map(function (x) { return x.coin; });
    return Object.assign(a, { title: a.items.length + ' entradas de ' + (a.area === 'funding' ? 'funding' : 'mineração') + ': ' + names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : ''),
      text: 'Toque para ver cada uma.' });
  });
}
// Desde quando cada condição está ativa: entra quando aparece, sai quando deixa de valer.
function trackSince(since, activeKeys, now) {
  var out = {};
  activeKeys.forEach(function (k) { out[k] = (since && since[k]) || now; });
  return out;
}
// Marca nos eventos do histórico quando a condição acabou (o evento de entrada deixa de valer).
function markEnded(events, activeKeys, now) {
  return (events || []).map(function (a) {
    var k = a.key ? a.key.replace(/^(fe|me|fs|sent):/, '$1:') : null;
    if (!a.endedAt && /^(fe|me|fs|sent):/.test(k || '') && activeKeys.indexOf(k) < 0) return Object.assign({}, a, { endedAt: now });
    return a;
  });
}
// Mantém o histórico de eventos em até `days` dias e `max` itens.
function pruneHistory(list, now, days, max) {
  var lim = now - (days || 7) * 864e5;
  return (list || []).filter(function (a) { return a.t >= lim; }).slice(-(max || 200));
}
// Silenciados (até uma data) e dispensados (até a condição deixar de valer).
function isMuted(key, prefs, now) {
  prefs = prefs || {};
  return !!((prefs.snooze && prefs.snooze[key] > now) || (prefs.dismissed && prefs.dismissed[key]));
}
// Remove dispensas de condições que já não valem (se voltarem, avisam de novo).
function cleanDismissed(prefs, activeKeys) {
  var d = {}, src = (prefs && prefs.dismissed) || {};
  Object.keys(src).forEach(function (k) { if (activeKeys.indexOf(k) >= 0) d[k] = src[k]; });
  return Object.assign({}, prefs, { dismissed: d });
}

/* ---------- mapa de players (onde operar) ----------
   Conferido em 30/10/2026: o site respondeu, exceto quando indicado. Taxas citadas vêm das fontes indicadas no README;
   confirme sempre na sua conta. api: 'leitura' = o painel já lê dados públicos; 'ordens' = tem API para executar. */
var PLAYERS = [
  { cat: 'funding', name: 'Binance', url: 'https://www.binance.com', what: 'Perpétuos USDT; funding a cada 4 h ou 8 h.', api: 'leitura + ordens', panel: true },
  { cat: 'funding', name: 'Bybit', url: 'https://www.bybit.com', what: 'Perpétuos USDT; intervalos de 1 h a 8 h.', api: 'leitura + ordens', panel: true },
  { cat: 'funding', name: 'OKX', url: 'https://www.okx.com', what: 'Perpétuos USDT; funding em geral a cada 8 h.', api: 'leitura + ordens', panel: true },
  { cat: 'funding', name: 'Bitget', url: 'https://www.bitget.com', what: 'Perpétuos USDT; intervalo informado por moeda.', api: 'leitura + ordens', panel: true },
  { cat: 'funding', name: 'Gate', url: 'https://www.gate.com', what: 'Perpétuos USDT; muitas moedas pequenas (cuidado com liquidez).', api: 'leitura + ordens', panel: true, note: 'site bloqueia acessos automáticos; a API pública respondeu' },
  { cat: 'funding', name: 'Hyperliquid', url: 'https://app.hyperliquid.xyz', what: 'Corretora descentralizada; funding a cada hora; sem KYC.', api: 'leitura + ordens', panel: true },
  { cat: 'funding', name: 'dYdX', url: 'https://dydx.trade', what: 'Corretora descentralizada; funding a cada hora.', api: 'leitura + ordens', panel: false, note: 'próxima a entrar no painel (API com CORS liberado)' },
  { cat: 'funding', name: 'MEXC', url: 'https://www.mexc.com', what: 'Perpétuos com muitas moedas novas.', api: 'leitura + ordens', panel: false, note: 'API sem CORS: precisa do backend' },
  { cat: 'funding', name: 'KuCoin', url: 'https://www.kucoin.com', what: 'Perpétuos USDT.', api: 'leitura + ordens', panel: false, note: 'API sem CORS: precisa do backend' },
  { cat: 'hash', name: 'NiceHash', url: 'https://www.nicehash.com', what: 'Livro de ordens de hash de muitos vendedores; 21 algoritmos (SHA-256, Scrypt, Equihash, kHeavyHash...). Taxa de 3% sobre o gasto; exige KYC.', api: 'leitura + ordens', panel: true },
  { cat: 'hash', name: 'MiningRigRentals', url: 'https://www.miningrigrentals.com', what: 'Aluguel de máquinas específicas, direto do dono, por hora; muitos algoritmos. Bom para solo: você configura a máquina.', api: 'ordens', panel: false },
  { cat: 'hash', name: 'Braiins Hashpower', url: 'https://hashpower.braiins.com', what: 'Só SHA-256, hash próprio da Braiins, com contratos de entrega garantida.', api: 'ordens', panel: false },
  { cat: 'pool', name: 'BlockSniper (BCH solo)', url: 'https://blocksniper.ai', what: 'Pool solo de BCH, paga direto no seu endereço; taxa de 2% (citada na live).', api: 'leitura', panel: false },
  { cat: 'pool', name: '2Miners Solo BCH', url: 'https://solo-bch.2miners.com', what: 'Pool solo de BCH da 2Miners.', api: 'leitura', panel: false },
  { cat: 'pool', name: 'CKPool Solo (BTC)', url: 'https://solo.ckpool.org', what: 'Pool solo de BTC usado em blocos achados com hash alugado.', api: 'leitura', panel: false },
  { cat: 'pool', name: 'Public Pool (BTC)', url: 'https://web.public-pool.io', what: 'Pool solo de BTC, código aberto.', api: 'leitura', panel: false },
  { cat: 'pool', name: 'mkpool (solo)', url: 'https://mkpool.com', what: 'Pool solo SHA-256; taxa de 2% segundo o próprio site.', api: 'leitura', panel: false },
  { cat: 'pool', name: 'LiteSolo (LTC + DOGE)', url: 'https://litesolo.org', what: 'Solo mesclado de Litecoin e Dogecoin; aceita NiceHash; taxa de 1% (MiningBoard).', api: 'leitura', panel: false },
  { cat: 'pool', name: 'Kryptex Pool', url: 'https://pool.kryptex.com', what: 'Pool multimoeda com guia para hash da NiceHash.', api: 'leitura', panel: false },
  { cat: 'dados', name: 'CoinGlass', url: 'https://www.coinglass.com', what: 'Funding, open interest e liquidações de várias exchanges.', api: 'paga', panel: false },
  { cat: 'dados', name: 'WhatToMine', url: 'https://whattomine.com', what: 'Rendimento por moeda e algoritmo. Fonte do mapa de mineração.', api: 'leitura', panel: true },
  { cat: 'dados', name: 'Hashrate Index', url: 'https://hashrateindex.com', what: 'Hashprice (receita por hash) e calculadoras de mineração de BTC.', api: 'paga', panel: false },
  { cat: 'dados', name: 'mempool.space', url: 'https://mempool.space', what: 'Rede Bitcoin: dificuldade, blocos, taxas.', api: 'leitura', panel: true },
  { cat: 'dados', name: 'MiningPoolStats', url: 'https://miningpoolstats.stream', what: 'Pools e potência por moeda.', api: 'leitura', panel: false },
  { cat: 'dados', name: 'MiningBoard', url: 'https://miningboard.com', what: 'Compara pools solo com o custo de alugar na NiceHash.', api: 'leitura', panel: false, note: 'não respondeu do servidor de teste; citado por várias fontes' }
];
// Pools por algoritmo para minerar com hash alugado (em pool, o pagamento é proporcional: pouca variação).
var POOLS = {
  SHA256ASICBOOST: [['BlockSniper (BCH solo)', 'https://blocksniper.ai'], ['2Miners Solo BCH', 'https://solo-bch.2miners.com'], ['CKPool Solo (BTC)', 'https://solo.ckpool.org']],
  SCRYPT: [['LiteSolo (LTC + DOGE solo)', 'https://litesolo.org'], ['litecoinpool.org (LTC + DOGE)', 'https://www.litecoinpool.org'], ['ViaBTC', 'https://www.viabtc.com']],
  RANDOMXMONERO: [['P2Pool (sem taxa, descentralizado)', 'https://p2pool.io'], ['SupportXMR', 'https://supportxmr.com'], ['MoneroOcean', 'https://moneroocean.stream']],
  EQUIHASH: [['2Miners ZEC', 'https://zec.2miners.com'], ['F2Pool', 'https://www.f2pool.com']],
  ETCHASH: [['2Miners ETC', 'https://etc.2miners.com'], ['F2Pool', 'https://www.f2pool.com']],
  KHEAVYHASH: [['2Miners KAS', 'https://kas.2miners.com'], ['F2Pool', 'https://www.f2pool.com']],
  X11: [['F2Pool', 'https://www.f2pool.com'], ['ViaBTC', 'https://www.viabtc.com']],
  EAGLESONG: [['F2Pool', 'https://www.f2pool.com'], ['ViaBTC', 'https://www.viabtc.com']],
  ALEPHIUM: [['F2Pool', 'https://www.f2pool.com']]
};
var PLAYER_CATS = { funding: 'Operar funding (perpétuos)', hash: 'Comprar potência (hash)', pool: 'Entregar a potência (pools solo)', dados: 'Dados e referências' };

var FDR = {
  MAJORS: MAJORS, ALGOS: ALGOS, fundingMatrix: fundingMatrix, sentiment: sentiment,
  coinRevenueBtc: coinRevenueBtc, coinRevenueRaw: coinRevenueRaw, wtmCoins: wtmCoins, btcUsdFrom: btcUsdFrom, bookPerHash: bookPerHash, miningMap: miningMap,
  pushHistory: pushHistory, hourProfile: hourProfile, priceMove: priceMove, evaluateAlerts: evaluateAlerts, COOLDOWN: COOLDOWN,
  PLAYERS: PLAYERS, PLAYER_CATS: PLAYER_CATS,
  POOLS: POOLS, SHA_COINS: SHA_COINS, trackSince: trackSince, markEnded: markEnded,
  PRIO: PRIO, activeConditions: activeConditions, groupConditions: groupConditions, pruneHistory: pruneHistory, isMuted: isMuted, cleanDismissed: cleanDismissed
};
if (typeof module !== 'undefined' && module.exports) module.exports = FDR;
else root.FDR = FDR;
})(typeof window !== 'undefined' ? window : globalThis);
