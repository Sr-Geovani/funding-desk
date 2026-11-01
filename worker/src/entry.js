// Cartilha de entrada (mineração BCH solo com hash alugado): a sequência de fatores a cruzar antes de entrar, avaliada a
// cada ciclo. A sorte (qual bloco, quando) não tem padrão; o que tem padrão é a MARGEM (preço do aluguel × quanto o bloco
// paga) e para onde ela vai nas próximas horas. Explicação completa em docs/cartilha-mineracao.md.
import { DARR_REF } from './signals.js';
import { plain } from './brain.js';
const n = (x, d = 1) => Number(x).toFixed(d).replace('.', ',');
const ok = (x) => x !== null && x !== undefined && isFinite(x);
const pctTxt = (x, d = 1) => (x >= 0 ? '+' : '') + n(x, d) + '%';

// nhWeek: 168 baldes [n, somaMargem, somaPreço, somaPH, somaDARR], índice = dia da semana (UTC) × 24 + hora.
function hourOfWeek(nhWeek, now) {
  if (!Array.isArray(nhWeek) || nhWeek.length !== 168) return null;
  const d = new Date(now), i = d.getUTCDay() * 24 + d.getUTCHours(), b = nhWeek[i];
  let N = 0, S = 0, best = null;
  nhWeek.forEach((x, j) => { if (x[0] > 0) { N += x[0]; S += x[1]; const m = x[1] / x[0]; if (x[0] >= 3 && (!best || m > best.edge)) best = { i: j, edge: m }; } });
  return { now: b && b[0] >= 3 ? b[1] / b[0] : null, nowN: b ? b[0] : 0, avg: N ? S / N : null, best, samples: N };
}
const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function entryChecklist({ mkt, darr, mom, ret, win, nhWeek, hashMkts, power, cfg, now, mm, band, bins }) {
  const steps = [], add = (id, title, status, value, why) => steps.push({ n: steps.length + 1, id, title, status, value, why });
  const minEdge = cfg.minEdgePct || 3, fee = cfg.rentFeePct || 3;
  // 1) margem no preço que de fato recebe hash (NiceHash, com a taxa de 3%). O menor preço recebendo pode ter hash para
  // menos de 1 PH/s; a margem que vale é a do menor tamanho que dá para comprar, pela profundidade do livro (potência ideal).
  const nhTop = mkt && mkt.ok ? mkt.edgeAtBidPct : null;
  const cv = power && Array.isArray(power.curve) ? power.curve.filter((r) => !r.overCap) : [];
  const buy = cv.length ? cv.reduce((a, r) => (r.edgePct > a.edgePct ? r : a)) : null;
  const nh = buy ? buy.edgePct : nhTop;
  const thin = buy && ok(nhTop) && nhTop - buy.edgePct >= 0.5;
  add('margem_nh', 'Margem no preço real (NiceHash)', !ok(nh) ? 'na' : nh >= minEdge ? 'ok' : nh >= 0 ? 'warn' : 'bad',
    !ok(nh) ? 'sem dados' : buy ? pctTxt(nh) + ' com ' + buy.ph + ' PH/s no lance ' + n(buy.bidEH, 4) + ' (empate ' + n(mkt.breakEvenEH, 4) + ')' +
      (thin ? ' · no menor preço (' + n(mkt.bidEH, 4) + ') daria ' + pctTxt(nhTop) + ', mas lá não há hash para 1 PH/s' : '') :
      pctTxt(nh) + ' no lance ' + n(mkt.bidEH, 4) + ' (empate ' + n(mkt.breakEvenEH, 4) + ')',
    'É o fator que decide o resultado no longo prazo: lucro médio = margem × gasto. Conta pelo preço em que de fato dá para comprar (profundidade do livro). Verde a partir da sua margem mínima (' + n(minEdge, 0) + '%).');
  // 2) a mesma conta sem a taxa (Braiins, 0% no beta)
  const B = hashMkts && hashMkts.braiins, beNoFee = mkt && mkt.ok ? mkt.breakEvenEH * (1 + fee / 100) : null;
  const br = B && B.matchEH > 0 && ok(beNoFee) ? (beNoFee / (B.matchEH * (1 + (B.feePct || 0) / 100)) - 1) * 100 : null;
  add('margem_braiins', 'Margem sem a taxa (Braiins Hashpower)', !ok(br) ? 'na' : br >= minEdge ? 'ok' : br >= 0 ? 'warn' : 'bad',
    ok(br) ? pctTxt(br) + ' no preço casado ' + n(B.matchEH, 4) : 'sem dados',
    'Sem os 3% da NiceHash o empate cai de DARR ~1,05 para ~1,02: muito mais horas com margem positiva. Precisa de pool com extranonce2 ≥ 7 (botão "Conferir com a Braiins").');
  // 3) DARR e raridade histórica
  const above = DARR_REF.above.filter(([l]) => darr >= l).pop();
  add('darr', 'DARR: quanto o BCH paga por hash × BTC', !ok(darr) ? 'na' : darr >= 1.05 ? 'ok' : darr >= 1.0 ? 'warn' : 'bad',
    ok(darr) ? n(darr, 3) + (above ? ' (acima de ' + n(above[0], 2) + ' em só ' + n(above[1], 1) + '% das horas em 6 meses)' : ' (média de 6 meses: 0,94)') : 'sem dados',
    'A NiceHash cobra pelo preço do BTC; o BCH só paga a conta quando paga mais que o BTC, descontados 3% da NiceHash e 2% do pool: DARR ≥ ~1,05 para empatar.');
  // 4) preço à frente da dificuldade (o ASERT do BCH reage em ~2 dias)
  const m = mom && ok(mom.vsEmaPct) ? mom.vsEmaPct : null;
  add('momento', 'Preço antes da dificuldade (BCH/BTC × média de 2 dias)', !ok(m) ? 'na' : m >= 2 ? 'ok' : m <= -2 ? 'bad' : 'warn',
    ok(m) ? pctTxt(m) + ' sobre a média' + (ok(mom.ret24Pct) ? ' · 24 h ' + pctTxt(mom.ret24Pct) : '') : 'sem dados',
    'Quando o BCH sobe contra o BTC, a dificuldade só alcança em 1–2 dias: é a janela clássica. Negativo = margem tende a piorar.');
  // 5) hash chegando ou saindo do BCH
  const l6 = win ? win.last6h : null;
  add('hash', 'Hash chegando ou saindo (blocos nas últimas 6 h)', !ok(l6) ? 'na' : l6 <= 30 ? 'ok' : l6 >= 42 ? 'bad' : 'warn',
    ok(l6) ? l6 + ' blocos (esperado 36)' + (win.bigShare6h !== null && win.bigShare6h !== undefined ? ' · pools grandes ' + n(win.bigShare6h * 100, 0) + '%' : '') : 'sem dados',
    'Bloco rápido = hash entrando (pools que trocam de moeda): a dificuldade sobe e a janela fecha em horas. Bloco lento = hash saindo: a dificuldade cai e a margem melhora.');
  // 6) reajuste do BTC
  const near = ret && ok(ret.remainingBlocks) && ret.remainingBlocks <= 432;
  add('reajuste', 'Reajuste de dificuldade do BTC', !ret || !ok(ret.changePct) ? 'na' : !near ? 'info' : ret.changePct > 0 ? 'ok' : 'bad',
    ret && ok(ret.changePct) ? pctTxt(ret.changePct) + ' em ' + ret.remainingBlocks + ' blocos' + (ok(ret.darrAfter) ? ' → DARR ~' + n(ret.darrAfter, 3) : '') : 'sem dados',
    'Se a dificuldade do BTC sobe, o hash do BTC paga menos e o DARR sobe na mesma proporção (e vice-versa). Conta só quando está a ≤ 3 dias.');
  // 7) horário do aluguel (mapa próprio hora × dia)
  const H = hourOfWeek(nhWeek, now);
  add('horario', 'Horário do aluguel (mapa hora × dia da semana)', !H || !ok(H.now) || !ok(H.avg) ? 'na' : H.now >= H.avg + 0.5 ? 'ok' : H.now <= H.avg - 0.5 ? 'warn' : 'info',
    H && ok(H.now) && ok(H.avg) ? 'margem média nesta hora ' + pctTxt(H.now) + ' × geral ' + pctTxt(H.avg) + (H.best ? ' · melhor: ' + DAYS[Math.floor(H.best.i / 24)] + ' ' + (H.best.i % 24) + 'h UTC (' + pctTxt(H.best.edge) + ')' : '') : 'juntando dados (' + (H ? H.samples : 0) + ' leituras)',
    'O hash do BCH varia por horário; a receita por hash não. Vantagem por horário só vem do preço da NiceHash, que o painel grava a cada ciclo.');
  // 8) tamanho: potência ideal e capital
  const P = power;
  add('tamanho', 'Tamanho: potência ideal (IA) e capital', !P ? 'na' : P.idealPh > 0 ? 'ok' : 'bad',
    P ? (P.idealPh > 0 ? P.idealPh + ' PH/s, ~+US$' + n(P.idealProfitDay, 0) + '/dia esperado; capital mínimo ~US$' + n(P.bankrollMinUsd || 0, 0) + ' (Kelly)' : '0 PH/s: nenhuma potência tem lucro esperado') : 'sem livro',
    'A potência não muda a margem: muda o tamanho do ganho e da sorte. O capital mínimo (bloco ÷ 2 × margem) evita que a sorte quebre o caixa antes de a média aparecer.');
  // 9) a tentativa: orçamento, chance e desfecho
  const budget = cfg.sessionBudgetUsd > 0 ? cfg.sessionBudgetUsd : 300, cpb = mkt && mkt.ok ? mkt.costPerBlockUsd * (buy && mkt.bidEH > 0 ? buy.bidEH / mkt.bidEH : 1) : null, V = mkt && mkt.ok ? mkt.blockNetUsd : null;
  const ch = ok(cpb) && cpb > 0 ? 1 - Math.exp(-budget / cpb) : null;
  add('tentativa', 'A tentativa: orçamento, chance e desfecho', !ok(ch) ? 'na' : 'info',
    ok(ch) ? 'US$' + n(budget, 0) + ' → ' + n(ch * 100, 0) + '% de chance de achar 1 bloco ou mais · achou: ~' + pctTxt((V / budget - 1) * 100, 0) + ' · não achou: −100%' : 'sem dados',
    'Cada tentativa é tudo ou nada; a média de muitas tentativas é a margem do passo 1. Stop-loss por tentativa e espera depois dele limitam o pior caso.');
  // veredito
  const bad = (id) => (steps.find((s) => s.id === id) || {}).status === 'bad';
  const trendBad = ['momento', 'hash', 'reajuste'].filter(bad).length;
  let verdict, title, text;
  if (ok(nh) && nh >= minEdge && trendBad === 0) { verdict = 'entrar'; title = 'Entrada favorável'; text = 'Margem real acima do mínimo e nenhum sinal de que a janela vai fechar já. Tamanho pelo passo 8; stop-loss pelo passo 9.'; }
  else if (ok(nh) && nh >= minEdge) { verdict = 'cautela'; title = 'Margem boa, mas a janela pode fechar'; text = trendBad + ' sinal(is) de piora (passos 4–6): entrar menor e acompanhar.'; }
  else if ((ok(nh) && nh >= 0) || (ok(br) && br >= minEdge)) { verdict = 'esperar'; title = 'Quase'; text = ok(br) && br >= minEdge ? 'Pela Braiins (sem taxa) a margem já passaria do mínimo; na NiceHash ainda não.' : 'Margem positiva mas abaixo do mínimo: esperar subir.'; }
  else { const Wm = mm && (mm.d7 || mm.h24); verdict = 'nao'; title = 'Fora da faixa boa'; text = 'Margem real negativa agora: em média, cada dólar gasto volta menos de um dólar.' + (band ? ' A IA aprendeu que a chance passa a ser maior a partir de ' + band.from + '% de margem (' + n(band.hit * 100, 0) + '% de acerto nas 2 horas seguintes, margem de erro de ' + n(band.hitLo * 100, 0) + '% a ' + n(band.hitHi * 100, 0) + '%).' : Wm && isFinite(Wm.top10) ? ' Os melhores momentos do período (10% do tempo) tiveram margem maior que ' + n(Wm.top10, 1) + '%.' : '') + (trendBad ? ' ' + trendBad + ' sinal(is) indicam piora.' : ''); }
  const lottery = !ok(nh) ? '' : nh < 0
    ? 'Loteria consciente (aceitando perder o orçamento): hoje cada tentativa custa, em média, ' + n(-nh, 1) + '% do que se gasta; os melhores momentos para isso são os de margem menos negativa.'
    : 'Margem positiva: repetindo tentativas, o resultado tende à margem (' + pctTxt(nh) + ' do gasto); a sorte muda o caminho, não a média.';
  // o mercado no período (margem média), para comparar o momento com o normal e não só com o mínimo
  const ACT = {
    margem_nh: { ok: 'A margem cobre o seu mínimo: é o pré-requisito para entrar.', warn: 'Margem positiva, mas abaixo do mínimo: espere mais alguns pontos ou aceite um lucro médio menor.', bad: 'Margem negativa: cada tentativa perde em média. Não entre, a não ser como loteria consciente.' },
    margem_braiins: { ok: 'Na Braiins a conta já fecha: vale conferir o pool (botão "Conferir com a Braiins") para operar lá.', warn: 'Sem a taxa a margem quase fecha: a Braiins é o caminho para ter mais janelas.', bad: 'Nem sem a taxa a conta fecha agora.' },
    darr: { ok: 'O BCH paga o suficiente acima do BTC.', warn: 'O BCH paga mais que o BTC, mas não o bastante para cobrir os ~5% de taxas.', bad: 'O BCH paga menos que o BTC por hash: o aluguel não tem como compensar.' },
    momento: { ok: 'Preço à frente da dificuldade: a margem tende a melhorar nas próximas horas.', warn: 'Sem tendência clara de preço.', bad: 'Preço caindo contra o BTC: a margem tende a piorar.' },
    hash: { ok: 'Hash saindo do BCH: a dificuldade vai cair e ajudar a margem.', warn: 'Ritmo de blocos normal.', bad: 'Hash chegando: a dificuldade vai subir e fechar a janela em horas.' },
    reajuste: { ok: 'O reajuste do BTC vai ajudar o DARR.', bad: 'O reajuste do BTC vai piorar o DARR: evite entrar perto dele.', info: 'Reajuste ainda longe: não pesa agora.' },
    horario: { ok: 'Esta hora costuma ter aluguel mais barato.', warn: 'Esta hora costuma ser mais cara: se der, espere.', info: 'Hora comum.' },
    tamanho: { ok: 'Existe uma potência com lucro esperado: use a sugerida (o lance sobe para potências maiores).', bad: 'Nenhuma potência tem lucro esperado no livro de agora.' },
    tentativa: { info: 'Defina o stop-loss sabendo que, sem bloco, a tentativa perde tudo o que gastou.' } };
  for (const st of steps) { st.value = plain(st.value); st.why = plain(st.why); const a = ACT[st.id] && ACT[st.id][st.status]; if (a) st.action = plain(a); }
  const W = mm && (mm.d7 || mm.h24), market = W ? { label: W.label || (mm.d7 ? '7 dias' : '24 h'), avg: W.avg, median: W.median, pctPos: W.pctPos, pctMin: W.pctMin, hoursMin: W.hoursMin, rankNow: ok(nh) && W.rankNow !== null ? W.rankNow : null, top10: W.top10, top25: W.top25, bestHours: mm.bestHours || null,
    h24: mm.h24 && mm.d7 && mm.d7.n > mm.h24.n ? mm.h24.avg : null } : null;
  market && band && (market.band = band);
  if (market && bins) market.bins = Object.entries(bins).map(([b, x]) => [+b, +x[0].toFixed(1), x[0] ? +(x[1] / x[0] * 100).toFixed(0) : 0, x[0] ? +(x[2] / x[0]).toFixed(2) : 0]).filter((x) => x[1] >= 3).sort((a, b) => a[0] - b[0]);
  return { market, at: now, verdict, title, text, lottery, steps, okCount: steps.filter((s) => s.status === 'ok').length, scored: steps.filter((s) => s.status !== 'na' && s.status !== 'info').length };
}
