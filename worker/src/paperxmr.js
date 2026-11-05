// Operação Monero "como se fosse real" (simulada): aluguel de RandomX na NiceHash apontado para um pool PPS de XMR
// com pagamento na carteira cadastrada (ex.: Kraken). A mesma função roda as outras moedas de pool PPS.
// Ciclo completo, como um operador faria com dinheiro de verdade:
//   carteira em BTC na NiceHash → ordem (taxa de ordem nova paga uma vez) → janela: sobe a potência, minera, baixa ao
//   mínimo → o pool credita XMR → saque a partir de 0,01 XMR para a Kraken → quando a ordem acaba, vende o XMR por BTC na
//   Kraken e manda de volta para a NiceHash (pela Lightning) → abre a próxima ordem.
// A margem vem do mapa: receita do pool PPS ÷ preço típico do livro (mediana das ordens recebendo hash), já com 3% da
// NiceHash, 4% de taxa de pool (conservador) e 2,5% de perdas de share e de venda.
//
// Regras de conta (auditadas em 04/11):
// 1) Tudo em dólar do momento: o gasto de cada intervalo vale o BTC daquele intervalo (antes o gasto inteiro era
//    recalculado pelo BTC de hoje e o resultado mexia sem minerar nada).
// 2) Receita de cada intervalo com a margem média entre a leitura anterior e a atual (antes usava só a do início, o que
//    era otimista quando a margem caía no meio da janela).
// 3) Resultado da janela = receita − aluguel. A taxa de ordem nova é paga uma vez ao abrir a ordem e entra só no
//    acumulado (antes caía inteira na primeira janela, e num estado antigo caiu numa janela que não abriu ordem).
// 4) XMR guardado (pool + Kraken) vale o preço da hora em que foi minerado; a variação do preço até a venda aparece à
//    parte (realizada na venda; a do que ainda está guardado, como "se vendesse hoje").
// 5) Gasto por dia na janela: até budgetUsdDay, sem passar de 10% do que o mercado inteiro do algoritmo gasta por dia.
// 6) Se o servidor ficar parado entre leituras, a ordem continuaria minerando de verdade: conta até 3 h do intervalo.
export const XMR_RULES = { walletBtc: 0.002, enterPct: 2, exitPct: 0, budgetUsdDay: 300, marketShare: 0.1, minOrderBtc: 0.001, newOrderFeeBtc: 0.00001, payoutXmr: 0.01,
  maxGap: 3 * 3600e3, winMin: 30, minExpUsd: 0.05,
  // venda do XMR na Kraken (taxa de quem aceita a oferta) e envio do BTC para a NiceHash pela Lightning: estimativas a confirmar
  sellFeePct: 0.4, btcSendFeeBtc: 0.00001,
  // Meta antes de qualquer dinheiro (regra escrita em 05/11, antes dos dados): 30 janelas com a leitura de 3 min e,
  // juntas, (a) lucro depois da taxa de ordem e da espera, (b) margem que rendeu de pelo menos +1% e (c) 70% das janelas positivas.
  goal: { windows: 30, minRealPct: 1, minPosPct: 70 },
  // Preço da ordem (05/11): a ordem paga o preço que tem, não o do mercado. Se o mercado sobe acima dela (+2%), ela perde o
  // hash para quem paga mais (não paga mais caro); se o mercado cai, o preço dela só desce ~0,65% a cada 10 min (degrau da NiceHash).
  outbidPct: 2, downStepPct: 0.65,
  // potência mínima de uma ordem na NiceHash (H/s, de /public/buy/info em 05/11): entre janelas a ordem fica nela e continua
  // gastando e minerando (RandomX: 100 kH/s ≈ US$3,70 por dia de aluguel)
  minLimitH: { RANDOMXMONERO: 1e5, X11: 1e13, EQUIHASH: 3e6, SCRYPT: 5e10, KAWPOW: 1e9, AUTOLYKOS: 3e9, OCTOPUS: 1e9, NEXAPOW: 3e9, FISHHASH: 1e9, BEAMV3: 600,
    ETCHASH: 1e9, DAGGERHASHIMOTO: 1e9, KHEAVYHASH: 1e14, ALEPHIUM: 5e12, EAGLESONG: 1e14, ZHASH: 1e3, VERUSHASH: 1e8, NEOSCRYPT: 1e7 } };
const usd2 = (x) => (x < 0 ? '−' : '') + 'US$' + Math.abs(x).toFixed(2).replace('.', ',');
const sgn = (x) => (x >= 0 ? '+' : '') + usd2(x);
const pc1 = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1).replace('.', ',') + '%';

// Estado antigo (antes de 04/11) → contas novas. Os valores em dólar do que já foi gasto usam o BTC desta conversão.
function migrate(p, btcUsd, now, isXmr) {
  if (p.orderOpen === undefined && p.orderBtc > 1e-8) p.orderOpen = true;
  if (p.spentUsd !== undefined) return;
  const b = btcUsd || 0;
  p.spentUsd = p.spentBtc * b; p.feesUsd = p.feesBtc * b; p.convFeesUsd = 0; p.fxUsd = 0; p.sold = [];
  p.krakenXmr = p.paidXmr || 0; p.heldBookUsd = p.revUsd; p.coinUsd = isXmr || p.poolXmr > 0 || p.paidXmr > 0 ? 0 : p.revUsd; p.migratedAt = now; // outras moedas: o crédito fica em dólar
  for (const r of p.runs || []) { r.spentUsd = r.spentBtc * b; delete r.feeBtc; }
  if (p.run) { p.run.spentUsd = p.run.spentBtc * b; delete p.run.feeBtc; }
}

export function xmrPaperStep(px, { m, now, btcUsd, xmrUsd, rules = XMR_RULES }) {
  const p = px && px.since ? JSON.parse(JSON.stringify(px)) : { since: now, lastTs: now, walletBtc: rules.walletBtc, startBtc: rules.walletBtc, orderBtc: 0, orderOpen: false,
    spentBtc: 0, feesBtc: 0, revUsd: 0, poolXmr: 0, paidXmr: 0, payouts: [], runs: [], run: null, on: false, edgePct: null, hoursOn: 0, days: {} };
  migrate(p, btcUsd, now, xmrUsd > 0);
  const events = [], tag = 'Monero (simulado)', dt = Math.min(Math.max(0, now - (p.lastTs || now)), rules.maxGap), day = new Date(now).toISOString().slice(0, 10);
  const e = m && isFinite(m.edgePct) && m.edgePct <= 100 ? m.edgePct : null;
  const px2 = xmrUsd > 0 ? xmrUsd : null; // outras moedas PPS: sem preço próprio, o crédito fica em dólar
  const priced = !!(m && m.rentBtcPerH > 0 && m.revBtcPerH > 0 && p.orderPrice > 0);
  const eOur = priced ? (m.revBtcPerH / p.orderPrice - 1) * 100 : e, outbid = priced && m.rentBtcPerH > p.orderPrice * (1 + rules.outbidPct / 100);
  const lower = () => { if (priced && m.rentBtcPerH < p.orderPrice) p.orderPrice = Math.max(m.rentBtcPerH, p.orderPrice * (1 - rules.downStepPct / 100 * dt / 600e3)); };
  if (m && m.fast && !p.fastSince) { p.fastSince = now; p.idleAtFast = (p.idleRevUsd || 0) - (p.idleSpentUsd || 0); } // início da leitura a cada 3 min: começa a contagem das 30 janelas
  // 1) o intervalo que passou, com a decisão anterior
  if (p.on && dt > 0 && btcUsd > 0) {
    // hash recebido no intervalo: inteiro enquanto o preço da ordem cobre o mercado; metade no intervalo em que foi ultrapassada
    const deliv = priced ? ((p.delivPrev === 0 ? 0 : 1) + (outbid ? 0 : 1)) / 2 : 1;
    const rate = p.rateUsdDay || rules.budgetUsdDay, want = rate * dt / 864e5 / btcUsd * deliv, spend = Math.min(want, p.orderBtc), frac = want > 0 ? spend / want * deliv : 0;
    const eEnd = eOur !== null ? eOur : (p.edgePct || 0), eAvg = ((p.edgePct || 0) + eEnd) / 2, spendUsd = spend * btcUsd, revUsd = spendUsd * (1 + eAvg / 100);
    p.orderBtc -= spend; p.spentBtc += spend; p.spentUsd += spendUsd; p.revUsd += revUsd; p.hoursOn += dt * frac / 3600e3; p.heldBookUsd += revUsd;
    if (px2) p.poolXmr += revUsd / px2; else p.coinUsd += revUsd;
    if (p.run) { p.run.spentBtc += spend; p.run.spentUsd += spendUsd; p.run.revUsd += revUsd; }
    const d = p.days[day] || (p.days[day] = { spentUsd: 0, revUsd: 0 }); d.spentUsd += spendUsd; d.revUsd += revUsd;
    if (p.orderBtc < 1e-8) { p.orderBtc = 0; const R0 = p.run; close('acabou o valor da ordem'); p.orderOpen = false; events.push(`${tag}: a ordem acabou o valor e foi encerrada.\n${runText(R0)}\n${totText()}`); }
  }
  // 1b) espera entre janelas: a ordem aberta fica na potência mínima e continua gastando e minerando (com a margem do momento)
  else if (!p.on && p.orderOpen && dt > 0 && btcUsd > 0 && m && m.rentBtcPerH > 0 && rules.minLimitH[m.algo || 'RANDOMXMONERO']) {
    const price = priced ? p.orderPrice : m.rentBtcPerH, want = outbid ? 0 : rules.minLimitH[m.algo || 'RANDOMXMONERO'] * price * dt / 864e5, spend = Math.min(want, p.orderBtc);
    const eI = priced ? eOur : e, e0 = isFinite(p.idleEdge) && p.idleEdge !== null ? p.idleEdge : (eI !== null ? eI : 0), eAvg = eI !== null ? (e0 + eI) / 2 : e0, spendUsd = spend * btcUsd, revUsd = spendUsd * (1 + eAvg / 100);
    p.idleEdge = eI;
    p.orderBtc -= spend; p.spentBtc += spend; p.idleSpentUsd = (p.idleSpentUsd || 0) + spendUsd; p.idleRevUsd = (p.idleRevUsd || 0) + revUsd; p.idleHours = (p.idleHours || 0) + dt / 3600e3; p.heldBookUsd += revUsd;
    if (px2) p.poolXmr += revUsd / px2; else p.coinUsd += revUsd;
    const d = p.days[day] || (p.days[day] = { spentUsd: 0, revUsd: 0 }); d.spentUsd += spendUsd; d.revUsd += revUsd;
    if (p.orderBtc < 1e-8) { p.orderBtc = 0; p.orderOpen = false; events.push(`${tag}: a ordem acabou o valor na potência mínima e foi encerrada. ${totText()}`); }
  }
  // 2) saque do pool para a carteira (Kraken) quando passa do mínimo
  if (px2 && p.poolXmr >= rules.payoutXmr) {
    p.payouts.push({ t: now, xmr: +p.poolXmr.toFixed(6), usd: +(p.poolXmr * px2).toFixed(2) }); p.paidXmr += p.poolXmr; p.krakenXmr += p.poolXmr;
    events.push(`${tag}: saque de ${p.poolXmr.toFixed(4).replace('.', ',')} XMR do pool para a carteira`); p.poolXmr = 0; p.payouts = p.payouts.slice(-30);
  }
  // 3) reabastecer: sem ordem e sem o mínimo na carteira, vende o que foi minerado e manda o BTC de volta para a NiceHash
  const need = rules.minOrderBtc + rules.newOrderFeeBtc;
  if (!p.orderOpen && !p.on && p.walletBtc < need && btcUsd > 0) {
    const heldUsdNow = px2 ? p.krakenXmr * px2 : p.coinUsd, heldBook = px2 ? (p.krakenXmr + p.poolXmr > 0 ? p.heldBookUsd * p.krakenXmr / (p.krakenXmr + p.poolXmr) : 0) : p.coinUsd;
    const netUsd = heldUsdNow * (1 - rules.sellFeePct / 100), gotBtc = netUsd / btcUsd - rules.btcSendFeeBtc;
    if (heldUsdNow > 0 && p.walletBtc + gotBtc >= need) {
      const feeUsd = heldUsdNow - netUsd + rules.btcSendFeeBtc * btcUsd, fx = heldUsdNow - heldBook;
      p.convFeesUsd += feeUsd; p.fxUsd += fx; p.heldBookUsd -= heldBook; p.walletBtc += gotBtc; p.refillBtc = (p.refillBtc || 0) + gotBtc;
      p.sold = (p.sold || []).concat([{ t: now, xmr: px2 ? +p.krakenXmr.toFixed(6) : null, usd: +heldUsdNow.toFixed(2), btc: +gotBtc.toFixed(8), feeUsd: +feeUsd.toFixed(2), fxUsd: +fx.toFixed(2) }]).slice(-20);
      events.push(`${tag}: venderia ${px2 ? p.krakenXmr.toFixed(4).replace('.', ',') + ' XMR' : 'as moedas recebidas'} por ${usd2(heldUsdNow)} e mandaria ${gotBtc.toFixed(6).replace('.', ',')} BTC de volta para a NiceHash (taxas ${usd2(feeUsd)}${px2 ? `; variação do XMR desde a mineração ${sgn(fx)}` : ''})`);
      if (px2) p.krakenXmr = 0; else p.coinUsd = 0; p.noFunds = null;
    }
  }
  // 4) decisão de agora
  // preço para entrar: ordem nova pode ir direto ao preço do mercado; a já aberta só sobe na hora (descer é em degraus)
  const entryPrice = m && m.rentBtcPerH > 0 ? (p.orderOpen && p.orderPrice > 0 ? Math.max(p.orderPrice, m.rentBtcPerH) : m.rentBtcPerH) : null;
  const eIn = entryPrice && m.revBtcPerH > 0 ? (m.revBtcPerH / entryPrice - 1) * 100 : e;
  if (e !== null) {
    if (!p.on && eIn >= rules.enterPct && m && m.thin) { if (!p.thinAt || now - p.thinAt > 6 * 3600e3) { p.thinAt = now; events.push(`${tag}: margem de ${eIn.toFixed(1).replace('.', ',')}%, mas o livro é raso (pouca ordem recebendo hash): não daria para comprar de verdade`); } }
    else if (!p.on && eIn >= rules.enterPct) {
      const mk = m && m.marketUsdDay > 0 ? m.marketUsdDay * rules.marketShare : Infinity;
      p.rateUsdDay = Math.max(1, Math.min(rules.budgetUsdDay, mk));
      // como numa arbitragem: só entra se a janela típica paga a taxa de entrada e sobra lucro
      const ds = p.runs.map((r) => (r.end - r.start) / 60e3).sort((a, b) => a - b), winMin = ds.length >= 3 ? ds[ds.length >> 1] : rules.winMin;
      // a taxa de ordem nova é paga uma vez e se divide pelas janelas que o valor da ordem cobre (a ordem fica aberta)
      const winSpend = p.rateUsdDay / 1440 * winMin, orderUsd = (p.orderOpen ? p.orderBtc : Math.max(0, p.walletBtc - rules.newOrderFeeBtc)) * (btcUsd || 0);
      const nWin = Math.max(1, orderUsd / Math.max(1e-9, winSpend)), feeAll = p.orderOpen ? 0 : rules.newOrderFeeBtc * (btcUsd || 0), feeUsd = feeAll / nWin;
      const expUsd = winSpend * eIn / 100 - feeUsd, beMin = eIn > 0 && feeAll ? feeAll / (p.rateUsdDay / 1440 * eIn / 100) : null;
      if (expUsd < rules.minExpUsd) {
        if (!p.skipAt || now - p.skipAt > 3600e3) { p.skipAt = now; events.push(`${tag}: margem de ${eIn.toFixed(1).replace('.', ',')}%, mas não entra: numa janela típica de ~${Math.round(winMin)} min renderia ~${usd2(expUsd + feeUsd)} (mínimo para valer: ${usd2(rules.minExpUsd + feeUsd)})`); }
      } else {
        p.expect = { usd: expUsd, winMin, beMin };
        let opened = false;
        if (!p.orderOpen) {
          const amt = Math.floor((p.walletBtc - rules.newOrderFeeBtc) * 1e8) / 1e8;
          if (amt >= rules.minOrderBtc) {
            p.walletBtc -= amt + rules.newOrderFeeBtc; p.feesBtc += rules.newOrderFeeBtc; p.feesUsd += rules.newOrderFeeBtc * btcUsd; p.feeLog = (p.feeLog || []).concat([{ t: now, usd: rules.newOrderFeeBtc * btcUsd }]).slice(-50); p.orderBtc = amt; p.orderOpen = true; opened = true;
            events.push(`${tag}: abriria ordem de ${amt.toFixed(6).replace('.', ',')} BTC no RandomX com margem de ${eIn.toFixed(1).replace('.', ',')}% (taxa de ordem nova de ${usd2(rules.newOrderFeeBtc * btcUsd)}, paga uma vez e que serve para as próximas janelas)`);
          } else if (!p.noFunds || now - p.noFunds > 6 * 3600e3) { p.noFunds = now; events.push(`${tag}: margem boa, mas a carteira virtual não tem o mínimo de 0,001 BTC (e o que foi minerado ainda não dá para repor)`); }
        } else events.push(`${tag}: subiria a potência no RandomX com margem de ${eIn.toFixed(1).replace('.', ',')}% (ordem já aberta, sem taxa nova)`);
        if (p.orderOpen) {
          p.on = true; p.edgePct = eIn; if (entryPrice) p.orderPrice = entryPrice;
          p.run = { start: now, edgePct: eIn, price: p.orderPrice || null, path: [+eIn.toFixed(1)], spentBtc: 0, spentUsd: 0, revUsd: 0, opened, orderFeeUsd: opened ? rules.newOrderFeeBtc * btcUsd : 0, orderBtc: p.orderBtc, rateUsdDay: p.rateUsdDay };
          events[events.length - 1] += `. Lucro esperado ~${usd2(expUsd)} se a janela durar ~${Math.round(winMin)} min${beMin ? `; a taxa de ordem nova se paga em ~${Math.round(beMin)} min de mineração` : ''}; gasto de até ${usd2(p.rateUsdDay / 24)} por hora`;
        }
      }
    } else if (p.on && outbid && e >= rules.enterPct && !(m && m.thin)) {
      // mercado subiu, mas ainda paga acima da regra: sobe o preço da ordem para o do mercado e continua
      p.orderPrice = m.rentBtcPerH; p.edgePct = e; if (p.run) { p.run.price = p.orderPrice; (p.run.path || (p.run.path = [])).push(+e.toFixed(1)); }
    } else if (p.on && ((eOur !== null && eOur < rules.exitPct) || outbid || (m && m.thin))) {
      const why = m && m.thin ? 'mercado ficou raso (pouca ordem recebendo hash)' : outbid ? `o preço do aluguel no mercado subiu ${((m.rentBtcPerH / p.orderPrice - 1) * 100).toFixed(0)}% acima do da nossa ordem (margem do mercado ${e.toFixed(1).replace('.', ',')}%): ela deixa de receber hash, sem pagar mais caro` : `margem caiu para ${eOur.toFixed(1).replace('.', ',')}%`;
      if (p.run && p.run.path && outbid) p.run.path.push(+eOur.toFixed(1));
      const R0 = p.run; if (R0 && R0.path && !outbid) R0.path.push(+(eOur !== null ? eOur : e).toFixed(1)); close(why);
      events.push(`${tag}: janela encerrada. ${outbid ? 'A ordem para de receber hash porque ' + why : 'Baixaria a potência para o mínimo porque ' + (m && m.thin ? 'o ' + why : 'a ' + why)}; a ordem continua aberta, sem taxa nova na próxima janela.\n${runText(R0)}\n${totText()}`);
    } else if (p.on) { p.edgePct = eOur; if (p.run) (p.run.path || (p.run.path = [])).push(+eOur.toFixed(1)); }
  }
  if (p.orderOpen) { lower(); if (p.run) p.run.price = p.orderPrice; }
  p.delivPrev = outbid ? 0 : 1;
  for (const k of Object.keys(p.days).sort().slice(0, -30)) delete p.days[k];
  p.lastTs = now; p.edgeNow = e;
  return { px: p, events };

  function close(reason) { // fim da janela: a ordem continua aberta (o saldo dela fica para a próxima janela)
    if (p.run) { p.runs.push(Object.assign(p.run, { end: now, reason })); p.runs = p.runs.slice(-40); }
    p.run = null; p.on = false;
  }
  function runText(R) {
    if (!R) return 'Esta janela: —';
    const res = R.revUsd - R.spentUsd, mins = Math.round((now - R.start) / 60e3), eff = R.spentUsd > 0 ? (R.revUsd / R.spentUsd - 1) * 100 : 0;
    // caminho da margem: leituras repetidas juntas e, em janela longa, só o começo e o fim
    let P = (R.path && R.path.length > 1 ? R.path : [R.edgePct]).filter((x, i, a) => i === 0 || x !== a[i - 1]).map((x) => pc1(x));
    if (P.length > 6) P = P.slice(0, 3).concat(['…'], P.slice(-2));
    const path = P.join(' → ');
    return `Esta janela: gastou ${usd2(R.spentUsd)} de aluguel e recebeu ${usd2(R.revUsd)} em moeda do pool → ${res >= 0 ? 'lucro' : 'prejuízo'} de ${sgn(res)} em ${mins} min.\n` +
      `A margem foi ${path} (lida a cada 3 min); na média, rendeu ${pc1(eff)}.`;
  }
  function totText() {
    const T = totals(p), n = p.runs.length, fee = T.orderFeesUsd + T.convFeesUsd - T.fxUsd;
    const extra = (p.idleSpentUsd ? `; a espera na potência mínima entre janelas deu ${sgn(T.idleUsd)} (aluguel ${usd2(p.idleSpentUsd)} em ${Math.round(p.idleHours || 0)} h)` : '') + (T.convFeesUsd ? `; venda e envio custaram ${usd2(T.convFeesUsd)}` : '') + (T.fxUsd ? `; a variação do XMR vendido deu ${sgn(T.fxUsd)}` : '');
    return `Desde o início: ${n} ${n === 1 ? 'janela soma' : 'janelas somam'} ${sgn(T.windowsUsd)}; abrir a ordem custou ${usd2(T.orderFeesUsd)} (paga uma vez por ordem)${extra}. ` +
      `Saldo: ${sgn(T.resultUsd)}${T.resultUsd < 0 && T.windowsUsd > 0 ? ` (faltam ${usd2(-T.resultUsd)} de lucro nas próximas janelas para pagar a abertura)` : T.resultUsd >= 0 && fee > 0 ? ' (a abertura já se pagou)' : ''}.`;
  }
}

// Contas do acumulado (todas em dólar do momento em que aconteceram).
function totals(p) {
  const windowsUsd = p.revUsd - p.spentUsd, orderFeesUsd = p.feesUsd || 0, convFeesUsd = p.convFeesUsd || 0, fxUsd = p.fxUsd || 0, idleUsd = (p.idleRevUsd || 0) - (p.idleSpentUsd || 0);
  return { windowsUsd, orderFeesUsd, convFeesUsd, fxUsd, idleUsd, resultUsd: windowsUsd + idleUsd - orderFeesUsd - convFeesUsd + fxUsd };
}

const now0 = (p) => p.lastTs || Date.now();
// Resumo para o painel, o Jarbas e o relatório.
export function xmrSummary(p0, btcUsd, xmrUsd) {
  if (!p0) return null;
  const p = JSON.parse(JSON.stringify(p0)); migrate(p, btcUsd, now0(p), xmrUsd > 0);
  const T = totals(p), costUsd = p.spentUsd + T.orderFeesUsd + T.convFeesUsd;
  const days = Math.max(1 / 24, (p.lastTs - p.since) / 864e5);
  // janelas: quantas e quanto duram (para saber se dá para pegar e com que frequência aparecem)
  const R = p.runs.filter((r) => r.end > now0(p) - 7 * 864e5), mins = R.map((r) => (r.end - r.start) / 60e3).sort((a, b) => a - b);
  const obsDays = Math.min(7, (p.lastTs - p.since) / 864e5), rs = R.reduce((a, r) => a + (r.spentUsd || 0), 0);
  const win = { n7d: R.length, perDay: obsDays >= 1 ? R.length / obsDays : null, obsH: obsDays * 24, medMin: mins.length ? mins[mins.length >> 1] : null,
    avgEdgePct: R.length ? R.reduce((a, r) => a + r.edgePct, 0) / R.length : null,
    // margem que de fato rendeu (receita ÷ aluguel) contra a margem lida na entrada
    realEdgePct: rs > 0 ? (R.reduce((a, r) => a + r.revUsd, 0) / rs - 1) * 100 : null,
    posPct: R.length ? Math.round(R.filter((r) => r.revUsd - (r.spentUsd || 0) > 0).length / R.length * 100) : null };
  // Meta das 30 janelas (só as da leitura de 3 min): margem lida × que rendeu e o veredito pela regra escrita antes
  const G = XMR_RULES.goal, GR = p.fastSince ? p.runs.filter((r) => r.start >= p.fastSince) : [], gs = GR.reduce((a, r) => a + (r.spentUsd || 0), 0), gr = GR.reduce((a, r) => a + r.revUsd, 0);
  const fees = (p.feeLog || []).filter((f) => p.fastSince && f.t >= p.fastSince).reduce((a, f) => a + f.usd, 0);
  const goal = { since: p.fastSince || null, n: GR.length, target: G.windows, readPct: GR.length ? GR.reduce((a, r) => a + r.edgePct, 0) / GR.length : null,
    realPct: gs > 0 ? (gr / gs - 1) * 100 : null, posPct: GR.length ? Math.round(GR.filter((r) => r.revUsd > (r.spentUsd || 0)).length / GR.length * 100) : null,
    windowsUsd: gr - gs, feesUsd: fees, idleUsd: p.fastSince ? (p.idleRevUsd || 0) - (p.idleSpentUsd || 0) - (p.idleAtFast || 0) : 0, rules: G };
  goal.resultUsd = goal.windowsUsd + goal.idleUsd - fees;
  goal.gapPp = goal.readPct !== null && goal.realPct !== null ? goal.readPct - goal.realPct : null;
  const okA = goal.resultUsd > 0, okB = goal.realPct !== null && goal.realPct >= G.minRealPct, okC = goal.posPct !== null && goal.posPct >= G.minPosPct;
  goal.checks = { lucro: okA, margem: okB, positivas: okC };
  goal.verdict = goal.n < G.windows ? 'em teste' : okA && okB && okC ? 'aprovada para teste real pequeno' : 'reprovada';
  // XMR guardado (pool + Kraken): pelo preço de quando foi minerado × preço de agora
  const heldXmr = (p.poolXmr || 0) + (p.krakenXmr || 0), heldNowUsd = xmrUsd > 0 ? heldXmr * xmrUsd : null;
  const run = p.run ? Object.assign({}, p.run, { resultUsd: p.run.revUsd - p.run.spentUsd }) : null;
  return { win, since: p.since, on: p.on, edgeNow: p.edgeNow, hoursOn: p.hoursOn, runs: p.runs.length + (p.run ? 1 : 0),
    spentUsd: costUsd + (p.idleSpentUsd || 0), rentUsd: p.spentUsd, idleUsd: T.idleUsd, idleSpentUsd: p.idleSpentUsd || 0, idleRevUsd: p.idleRevUsd || 0, idleHours: p.idleHours || 0, revUsd: p.revUsd, windowsUsd: T.windowsUsd, orderFeesUsd: T.orderFeesUsd, convFeesUsd: T.convFeesUsd, fxUsd: T.fxUsd, resultUsd: T.resultUsd,
    retPct: costUsd + (p.idleSpentUsd || 0) > 0 ? T.resultUsd / (costUsd + (p.idleSpentUsd || 0)) * 100 : null, perDayUsd: days >= 1 ? T.resultUsd / days : null, // média por dia só depois de 1 dia (antes disso extrapola poucas horas)
     walletBtc: p.walletBtc + p.orderBtc, orderBtc: p.orderBtc, orderOpen: !!p.orderOpen,
    poolXmr: p.poolXmr, paidXmr: p.paidXmr, krakenXmr: p.krakenXmr || 0, paidUsd: xmrUsd ? p.paidXmr * xmrUsd : null, payouts: p.payouts.length, sold: (p.sold || []).slice(-5).reverse(),
    heldXmr, heldBookUsd: p.heldBookUsd, heldNowUsd, heldFxUsd: heldNowUsd !== null ? heldNowUsd - p.heldBookUsd : null, coinUsd: p.coinUsd || 0,
    lastRuns: p.runs.slice(-8).reverse().map((r) => Object.assign({}, r, { resultUsd: r.revUsd - (r.spentUsd || 0), realEdgePct: r.spentUsd > 0 ? (r.revUsd / r.spentUsd - 1) * 100 : null })),
    run, expect: p.expect || null, migratedAt: p.migratedAt || null, goal };
}
