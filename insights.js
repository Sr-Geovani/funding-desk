/* Funding Desk — inteligência do copiloto: planos, testes no histórico, previsões e recomendações.
   Lógica pura (sem DOM). Usado pelo painel (window.FDI) e pelos testes (node --test).
   Regra de honestidade: "previsão" aqui é probabilidade calculada (Poisson, histórico, calendário de reajuste),
   nunca palpite. O que não muda a chance (esforço, best share, potência de quem achou o último bloco) não entra. */
(function (root) {
'use strict';

var HOUR = 36e5, MIN = 60e3;
function nf(x, d) { return Number(x).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
function money(x, d) { return (x < 0 ? '-' : '') + 'US$' + nf(Math.abs(x), d === undefined ? 2 : d); }
function pctS(x, d) { return (x >= 0 ? '+' : '-') + nf(Math.abs(x), d === undefined ? 1 : d) + '%'; }
function dur(ms) {
  if (!isFinite(ms)) return '—';
  var m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return m + ' min';
  var h = m / 60;
  if (h < 48) return nf(h, h < 10 ? 1 : 0) + ' h';
  return nf(h / 24, 1) + ' dias';
}

/* ---------- funding: cronograma de pagamentos ---------- */
// o: oportunidade de core.opportunities; opts: now, aprCap
function fundingPlan(o, opts) {
  var now = opts.now, days = opts.hold, end = now + days * 24 * HOUR;
  var scale = opts.aprCap && o.spread > opts.aprCap ? opts.aprCap / o.spread : 1; // mesma prudência da projeção
  var legs = [{ venue: o.s, r: o.rs, sign: 1 }];
  if (o.rl) legs.push({ venue: o.l, r: o.rl, sign: -1 });
  var events = [];
  legs.forEach(function (lg) {
    var h = lg.r.hours || 8, t = lg.r.next || (Math.floor(now / (h * HOUR)) + 1) * h * HOUR;
    var amt = lg.sign * o.m.notional * lg.r.rate / 100 * scale; // short recebe a taxa; long paga
    for (; t <= end; t += h * HOUR) events.push({ t: t, venue: lg.venue, amount: amt });
  });
  events.sort(function (a, b) { return a.t - b.t; });
  var cum = 0, beIdx = null;
  events.forEach(function (e, i) { cum += e.amount; e.cum = cum; if (beIdx === null && cum >= o.m.cost) beIdx = i; });
  var first = events[0] || null;
  var firstPos = events.filter(function (e) { return e.amount > 0; })[0] || null;
  return {
    events: events, count: events.length, first: first, firstIncome: firstPos,
    toBreakEven: beIdx === null ? null : beIdx + 1, timeToBreakEven: beIdx === null ? null : events[beIdx].t - now,
    income: cum, net: cum - o.m.cost, soon: !!(firstPos && firstPos.t - now <= HOUR)
  };
}
function planText(p, o, now) {
  if (!p.first) return 'Sem pagamentos no ciclo.';
  var s = p.firstIncome ? 'Primeiro recebimento: ' + p.firstIncome.venue + ' em ' + dur(p.firstIncome.t - now) + ' (~' + money(p.firstIncome.amount) + '), se as duas pernas estiverem abertas antes.' : 'Nenhum recebimento no ciclo.';
  s += ' ' + p.count + ' pagamentos no ciclo; ' + (p.toBreakEven ? 'empata no ' + p.toBreakEven + 'º (em ' + dur(p.timeToBreakEven) + ').' : 'não empata dentro do ciclo.');
  return s;
}

/* ---------- funding: quanto investir para uma meta ---------- */
// p: lev, hold, slipPct, rebalUsd. Teto de liquidez: cada perna até 0,1% do volume diário da exchange mais fraca.
function capitalForTarget(o, targetUsd, p) {
  var aprNet = o.m.perDayUsd / o.m.notional * 365 * 100;          // % a.a. usado na projeção
  var feePct = o.m.feeUsd / o.m.notional * 100;
  var perCapital = p.lev / 2 * (aprNet / 365 * p.hold - feePct - (p.slipPct || 0)) / 100;
  if (!(perCapital > 0)) return null;
  var capital = (targetUsd + (p.rebalUsd || 0)) / perCapital;
  var maxCapital = o.vol ? o.vol * 0.001 * 2 / p.lev : null;
  return { capital: capital, perLeg: capital / 2 * p.lev, maxCapital: maxCapital, feasible: !maxCapital || capital <= maxCapital, returnPct: targetUsd / capital * 100 };
}

/* ---------- funding: teste no histórico (backtest) ---------- */
// series: spread pago por hora (mais antigo primeiro, {t, apr}); entra só quando o spread estava ≥ break-even.
function backtestFunding(series, opts) {
  var H = Math.round(opts.holdDays * 24), res = [];
  var above = series.filter(function (x) { return x.apr >= opts.beApr; }).length;
  for (var i = 0; i + H <= series.length; i++) {
    if (series[i].apr < opts.beApr) continue;
    var sum = 0;
    for (var j = i; j < i + H; j++) sum += series[j].apr;
    res.push(opts.notional * (sum / H / 365 * opts.holdDays - opts.costPct) / 100);
  }
  if (!res.length) return series.length < H + 1 ? null : { n: 0, hoursAbove: above, hours: series.length };
  var wins = res.filter(function (x) { return x > 0; }).length;
  return { n: res.length, winRate: wins / res.length * 100, avg: res.reduce(function (a, b) { return a + b; }, 0) / res.length,
    worst: Math.min.apply(null, res), best: Math.max.apply(null, res) };
}
function backtestText(b, days) {
  if (!b) return 'Histórico curto demais para testar um ciclo de ' + days + ' dias.';
  if (!b.n) return b.hoursAbove ? 'No histórico, o spread só ficou acima do break-even nas últimas horas (' + b.hoursAbove + ' de ' + b.hours + '): não dá para simular um ciclo completo. Trate como pico.'
    : 'No histórico dos últimos dias, o spread pago nunca ficou acima do break-even: o valor de agora é novo (provável pico).';
  return 'Teste no histórico real: em ' + b.n + ' entradas simuladas (sempre que o spread estava acima do break-even), ' +
    nf(b.winRate, 0) + '% terminaram no lucro; média ' + money(b.avg) + ', pior ' + money(b.worst) + '.';
}

/* ---------- rede: próximo bloco, divisão e último bloco ---------- */
// Chance de a rede achar um bloco nos próximos `mins` minutos. Não depende do tempo desde o último (sem memória).
function nextBlockChance(avgBlockMin, mins) { return avgBlockMin > 0 ? 1 - Math.exp(-mins / avgBlockMin) : null; }
// blocks: mais novo primeiro, com miner/tag (mining.parseBlocks). Agrupa por pool.
function poolOf(b) {
  var t = (b.miner || b.tag || '').toLowerCase();
  if (/blocksniper/.test(t)) return 'BlockSniper (solo)';
  if (/viabtc/.test(t)) return 'ViaBTC';
  if (/antpool/.test(t)) return 'AntPool';
  if (/mining-dutch/.test(t)) return 'Mining-Dutch';
  if (/f2pool/.test(t)) return 'F2Pool';
  if (/2miners/.test(t)) return '2Miners';
  if (/solo/.test(t)) return 'outros solo';
  return b.miner || 'desconhecido';
}
function networkSplit(blocks) {
  var c = {};
  blocks.forEach(function (b) { var p = poolOf(b); c[p] = (c[p] || 0) + 1; });
  return Object.keys(c).map(function (k) { return { name: k, n: c[k], pct: c[k] / blocks.length * 100 }; })
    .sort(function (a, b) { return b.n - a.n; });
}
function lastBlockStory(blocks, now) {
  if (!blocks || blocks.length < 2) return null;
  var b = blocks[0], took = (b.time - blocks[1].time) / MIN;
  return { height: b.height, pool: poolOf(b), took: took, ago: (now - b.time) / MIN, difficulty: b.difficulty,
    text: 'Último bloco: ' + b.height + ', há ' + dur(now - b.time) + ', de ' + poolOf(b) + ', levou ' + (took < 1 ? 'menos de 1 min' : nf(took, 0) + ' min') + '. ' +
      'Copiar a potência de quem achou não muda a sua chance; o que dá para repetir é a condição de preço (aluguel abaixo do teto).' };
}

/* ---------- mineração: previsão e recomendação ---------- */
// x: edgeNow (%), minEdgePct, thin (n ordens) | 0, hist [{t, v}] da margem, bestHour {h, avg}, diffVsAvgPct,
//    price24hPct, btcRetarget {changePct, remainingMs}, rent (US$/PH·dia), budget (US$ por sessão), hours, coin
function miningOutlook(x) {
  var m = x.minEdgePct || 0, pros = [], cons = [], coin = x.coin || 'BCH';
  if (!isFinite(x.edgeNow)) return { action: 'sem-dado', title: 'Sem dados suficientes para recomendar', pros: pros, cons: cons };
  if (x.edgeNow >= m) pros.push('Aluguel ' + nf(x.edgeNow, 1) + '% abaixo do que o hash rende (sua margem mínima é ' + nf(m, 0) + '%).');
  else if (x.edgeNow >= 0) cons.push('Margem de só ' + nf(x.edgeNow, 1) + '%: abaixo da sua margem mínima de ' + nf(m, 0) + '%.');
  else cons.push('Aluguel ' + nf(-x.edgeNow, 1) + '% acima do que o hash rende: cada dólar gasto rende em média US$' + nf(1 + x.edgeNow / 100, 2) + '.');
  if (x.thin) cons.push('Livro da NiceHash raso (' + x.thin + ' ordens recebendo hash): comprar volume tende a sair mais caro.');
  if (isFinite(x.diffVsAvgPct)) {
    if (x.diffVsAvgPct <= -1) pros.push('Dificuldade ' + nf(-x.diffVsAvgPct, 1) + '% abaixo da média recente: cada PH rende um pouco mais.');
    else if (x.diffVsAvgPct >= 1) cons.push('Dificuldade ' + nf(x.diffVsAvgPct, 1) + '% acima da média recente.');
  }
  if (isFinite(x.price24hPct)) {
    if (x.price24hPct >= 3) pros.push(coin + ' ' + pctS(x.price24hPct) + ' em 24 h: a receita por hash subiu e a dificuldade leva horas para acompanhar.');
    else if (x.price24hPct <= -3) cons.push(coin + ' ' + pctS(x.price24hPct) + ' em 24 h: a receita por hash caiu.');
  }
  if (x.btcRetarget && isFinite(x.btcRetarget.changePct) && Math.abs(x.btcRetarget.changePct) >= 1) {
    var r = x.btcRetarget;
    (r.changePct > 0 ? pros : cons).push('O Bitcoin deve reajustar a dificuldade em ' + pctS(r.changePct) + ' em ~' + dur(r.remainingMs) +
      (r.changePct > 0 ? ': a receita do BTC cai e o aluguel SHA-256 costuma baratear depois (tendência, não garantia).' : ': a receita do BTC sobe e o aluguel SHA-256 costuma encarecer depois (tendência, não garantia).'));
  }
  var fav = null;
  if (x.hist && x.hist.length >= 6) fav = x.hist.filter(function (h) { return h.v >= m; }).length / x.hist.length * 100;
  var hourTxt = x.bestHour && x.bestHour.avg !== null ? ' Melhor horário médio: ' + x.bestHour.h + 'h (' + pctS(x.bestHour.avg) + ').' : '';
  var favTxt = fav === null ? '' : ' Nos últimos dias, compensou em ' + nf(fav, 0) + '% das leituras.' + hourTxt;
  var hours = x.hours || 6, budget = x.budget || 300;
  var ph = x.rent > 0 ? budget / (x.rent * hours / 24) : null;
  var action, title, text, plus = '';
  if (x.edgeNow >= m && !x.thin) {
    action = 'entrar';
    title = 'Entre com ~' + nf(ph, 1) + ' PH/s por ' + hours + ' h (' + money(budget, 0) + ')';
    text = 'O preço está favorável agora.' + favTxt;
    plus = 'Se a margem passar de ' + nf(m * 2, 0) + '%, dobre a potência. Se o aluguel passar do teto, o robô pausa sozinho; se a recompensa cair no seu endereço, ele encerra.';
  } else if (x.edgeNow >= -2 || (fav !== null && fav >= 5)) {
    action = 'teto';
    title = 'Deixe uma ordem com teto, não compre a preço de mercado';
    text = (x.edgeNow >= 0 ? 'O preço está no limite.' : x.edgeNow >= -2 ? 'O preço está quase no empate.' : 'Agora não compensa, mas há janelas favoráveis.') + favTxt +
      ' Uma ordem com preço máximo no teto (robô em Observar ou Ativo) só compra nessas janelas.';
    plus = 'Se a margem passar de ' + nf(m, 0) + '% e o livro tiver liquidez, entre com ~' + (ph ? nf(ph, 1) : '—') + ' PH/s.';
  } else {
    action = 'esperar';
    title = 'Espere';
    text = 'O aluguel está acima do que o hash rende e não houve janelas favoráveis recentes.' + (fav === null ? ' O histórico ainda está curto.' : favTxt);
    plus = 'Volta a valer quando o aluguel cair para o teto ou o ' + coin + ' subir; o radar avisa.';
  }
  return { action: action, title: title, text: text, plus: plus, pros: pros, cons: cons, favPct: fav, suggestPh: ph, hours: hours, budget: budget };
}

/* ---------- plano combinado (funding + mineração) ---------- */
// f: { level, netUsd, hold, capital, winRate } da melhor oportunidade; mi: { level, ratio, favPct }; capital total
function allocation(capital, f, mi) {
  var lines = [], fundOk = f && f.level === 'go', mineOk = mi && mi.level === 'go', mineTeto = mi && (mi.level === 'maybe' || (mi.favPct || 0) >= 5);
  var fShare = fundOk ? (mineOk ? 0.7 : (mineTeto ? 0.9 : 1)) : 0;
  var mShare = mineOk ? (fundOk ? 0.3 : 0.5) : (mineTeto ? (fundOk ? 0.1 : 0.2) : 0);
  if (fundOk) {
    var cycles = 30 / f.hold, perCycle = f.netUsd / f.capital * capital * fShare;
    var wr = isFinite(f.winRate) ? f.winRate / 100 : 1;
    lines.push({ name: 'Funding', share: fShare, amount: capital * fShare, monthUsd: perCycle * cycles * wr,
      note: 'Se oportunidades parecidas se repetirem: ~' + money(perCycle) + ' por ciclo de ' + f.hold + ' dias' + (isFinite(f.winRate) ? ', ajustado pela taxa de acerto histórica (' + nf(f.winRate, 0) + '%)' : '') + '. Risco baixo a médio.' });
  }
  if (mShare > 0) {
    var spend = capital * mShare;
    lines.push({ name: 'Mineração', share: mShare, amount: spend, monthUsd: mineOk ? spend * (mi.ratio - 1) : null,
      note: mineOk ? 'Retorno esperado de ' + pctS((mi.ratio - 1) * 100) + ' sobre o gasto, com grande variação (tudo ou nada por bloco).' : 'Só como ordem com teto: compra nas janelas favoráveis; sem retorno garantido.' });
  }
  var cash = 1 - fShare - mShare;
  if (cash > 0.001) lines.push({ name: 'Em caixa', share: cash, amount: capital * cash, monthUsd: 0, note: 'Reserva para margem, rebalanceamento e próximas oportunidades.' });
  var summary = fundOk && mineOk ? 'Os dois compensam agora: funding como base e mineração menor, por ter mais variação.'
    : fundOk ? 'Funding compensa; mineração ' + (mineTeto ? 'só com ordem no teto.' : 'não compensa agora.')
    : mineOk ? 'Mineração compensa e funding não: aposta com variação alta; mantenha o resto em caixa.'
    : 'Nada compensa com folga agora: fique em caixa' + (mineTeto ? ' e, se quiser, deixe uma ordem de mineração com teto.' : '.');
  return { lines: lines, summary: summary };
}

/* ---------- funding: curto prazo ---------- */
// Spread mínimo (% a.a.) para empatar segurando k pagamentos da perna short, em taker e em maker.
// Supõe saldo já nas duas exchanges (sem transferência). fees: tabela de taxas; slipPct: % do nocional.
function legCost(o, fees, kind, slipPct) {
  var fs = fees[o.s] || {}, sp = o.l === 'Spot', fl = sp ? (fees[o.s] || {}) : (fees[o.l] || {});
  var a = kind === 'maker' ? fs.maker : fs.taker, b = sp ? (kind === 'maker' ? fl.spotMaker : fl.spotTaker) : (kind === 'maker' ? fl.maker : fl.taker);
  return 2 * (a || 0) + 2 * (b || 0) + (slipPct || 0);
}
function shortTerm(o, opts) {
  var h = (o.rs && o.rs.hours) || 8, cT = legCost(o, opts.fees, 'taker', opts.slipPct), cM = legCost(o, opts.fees, 'maker', opts.slipPct);
  var rows = [1, 2, 3].map(function (k) {
    var hours = k * h;
    return { k: k, hours: hours, minTaker: cT * 8760 / hours, minMaker: cM * 8760 / hours, okTaker: o.spread >= cT * 8760 / hours, okMaker: o.spread >= cM * 8760 / hours };
  });
  var perPay = o.spread / 8760 * h; // % do nocional por pagamento da perna short
  var need = function (c) { return perPay > 0 ? Math.ceil(c / perPay) : null; };
  var peak = !!(o.capped || (opts.stab && opts.stab.key === 'pico'));
  var nT = need(cT), nM = need(cM);
  var text = 'Curto prazo (sem transferência): empatar em 1 pagamento (' + h + ' h) exige spread de ' + nf(rows[0].minTaker, 0) + '% a.a. em taker ou ' +
    nf(rows[0].minMaker, 0) + '% em maker; em 3 pagamentos, ' + nf(rows[2].minTaker, 0) + '% ou ' + nf(rows[2].minMaker, 0) + '%. ' +
    (nT ? 'Com o spread de agora: ' + nT + ' pagamento' + (nT > 1 ? 's' : '') + ' (' + dur(nT * h * HOUR) + ') em taker, ' + nM + ' (' + dur(nM * h * HOUR) + ') em maker.' : '');
  if (peak) text += ' Atenção: o spread de agora parece pico; operar curto prazo em cima dele costuma virar prejuízo.';
  return { costTaker: cT, costMaker: cM, rows: rows, needTaker: nT, needMaker: nM, peak: peak, text: text };
}

/* ---------- funding: ficar ou sair ---------- */
// pos: posição registrada (negSince = quando o funding ficou ≤ 0); cur: spread atual (% a.a.); hours: intervalo da perna short
function stayAdvice(pos, cur, opts) {
  if (cur === null || cur === undefined) return { action: 'sem-dado', text: 'Sem dado ao vivo desta moeda nas exchanges da posição.' };
  var h = opts.hours || 8, now = opts.now, perDay = pos.notional * cur / 365 / 100;
  if (cur <= 0) {
    var n = pos.negSince ? Math.max(1, Math.floor((now - pos.negSince) / (h * HOUR)) + 1) : 1;
    return { action: 'sair', text: 'Saia: o funding está negativo há ' + (pos.negSince ? 'cerca de ' + n + ' pagamento' + (n > 1 ? 's' : '') + ' (' + dur(now - pos.negSince) + ')' : 'esta leitura') +
      '; manter custa ~' + money(-perDay) + ' por dia. Feche as duas pernas juntas.' };
  }
  if (isFinite(pos.beApr) && cur < pos.beApr) return { action: 'avaliar', text: 'Continue enquanto ficar positivo: a entrada já foi paga e cada pagamento ainda soma (~' + money(perDay) + '/dia). Só vale sair antes se houver algo melhor (veja a troca) ou se virar negativo.' };
  return { action: 'continuar', text: 'Continue: o spread (' + pctS(cur) + ' a.a.) segue acima do break-even, rendendo ~' + money(perDay) + ' por dia. Não precisa fechar no fim do ciclo planejado.' };
}

/* ---------- funding: vale trocar? ---------- */
// Compara ficar na posição (spread atual) com ir para a oportunidade b, no mesmo tamanho, durante `days`.
// A saída da posição atual é paga nos dois casos; a troca soma a entrada e a saída da nova (b.m.costPct).
function switchAdvice(pos, cur, b, opts) {
  if (!b || cur === null || cur === undefined) return null;
  var days = opts.days || 3, n = pos.notional, cap = opts.aprCap || Infinity;
  var stay = n * cur / 365 * days / 100;
  var go = n * Math.min(b.spread, cap) / 365 * days / 100 - n * b.m.costPct / 100;
  var extra = go - stay;
  return { worth: extra > 0, extra: extra, stay: stay, go: go, days: days,
    text: extra > 0 ? 'Vale trocar para ' + b.coin + ' (' + (b.l === 'Spot' ? 'spot + short na ' + b.s : 'short ' + b.s + ', long ' + b.l) + '): ~' + money(extra) + ' a mais em ' + days + ' dias, já descontado o custo da troca. Feche esta e abra a nova juntas.'
      : 'Não vale trocar para ' + b.coin + ' agora: o ganho extra em ' + days + ' dias não cobre o custo da troca (diferença de ' + money(extra) + ').' };
}

/* ---------- funding: recebido pelo histórico público ---------- */
// a, b: séries de pagamentos ({t, rate em %}) da perna short e da long (null no spot). Soma desde a entrada.
function fundingFromHistory(pos, a, b, until) {
  var n = pos.notional, sum = 0, count = 0;
  (a || []).forEach(function (x) { if (x.t > pos.t && x.t <= until) { sum += n * x.rate / 100; count++; } });
  (b || []).forEach(function (x) { if (x.t > pos.t && x.t <= until) { sum -= n * x.rate / 100; count++; } });
  return { usd: sum, payments: count };
}

var FDI = {
  dur: dur, fundingPlan: fundingPlan, planText: planText, capitalForTarget: capitalForTarget,
  backtestFunding: backtestFunding, backtestText: backtestText, nextBlockChance: nextBlockChance,
  poolOf: poolOf, networkSplit: networkSplit, lastBlockStory: lastBlockStory, miningOutlook: miningOutlook, allocation: allocation,
  legCost: legCost, shortTerm: shortTerm, stayAdvice: stayAdvice, switchAdvice: switchAdvice, fundingFromHistory: fundingFromHistory
};
if (typeof module !== 'undefined' && module.exports) module.exports = FDI;
else root.FDI = FDI;
})(typeof window !== 'undefined' ? window : globalThis);
