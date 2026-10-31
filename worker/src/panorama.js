// Panorama do mercado (copiloto IA): junta todas as frentes observadas e escreve o que elas dizem sobre o momento.
// Não opera nada. Três partes: (1) regime (apetite por alavancagem, demanda local, mineração, juros); (2) ranking de
// tudo que tem retorno anual medido, lado a lado com o CDI e o T-bill; (3) o que mudou em 7 dias (histórico diário).
const n = (x, d = 1) => Number(x).toFixed(d).replace('.', ',');
const ok = (x) => x !== null && x !== undefined && isFinite(x);

// macro: Selic, IPCA 12 meses, expectativa de IPCA (Focus) e T-bill de 13 semanas.
export function macroOf({ selic, ipca12, focus, tbillCsv }) {
  const last = (a) => (Array.isArray(a) && a.length ? +String(a[a.length - 1].valor).replace(',', '.') : null);
  const f = focus && Array.isArray(focus.value) ? focus.value : [];
  const yr = String(new Date().getUTCFullYear() + 1), fx = f.find((x) => x.DataReferencia === yr) || f[0];
  let tbill = null;
  if (typeof tbillCsv === 'string') {
    const L = tbillCsv.split(/\r?\n/).filter(Boolean), head = (L[0] || '').split(','), row = (L[1] || '').split(',');
    const i = head.findIndex((h) => /13 WEEKS COUPON EQUIVALENT/i.test(h));
    if (i >= 0 && isFinite(+row[i])) tbill = +row[i];
  }
  return { selic: last(selic), ipca12: last(ipca12), ipcaExp: fx ? +fx.Mediana : null, ipcaExpYear: fx ? fx.DataReferencia : null, tbill };
}

export function marketPanorama({ fronts, market2, mkt, darr, sentiment, now }) {
  const F = fronts || {}, M = market2 || {}, mac = M.macro || {}, Y = M.yields || {}, P = M.prem || {}, H = F.hist || {};
  const cdi = F.cdi, lines = [], regime = {};
  // 1) apetite por alavancagem: base de futuros, empréstimo de USDT, dólar sintético e funding dos majors
  const base = F.basis && F.basis.basisApr, frr = F.bfx && F.bfx.frrApr, eth = F.ethena && F.ethena.apr30, fund = sentiment && sentiment.avg;
  const heat = [base >= 12, frr >= 20, eth >= 12, fund >= 20].filter(Boolean).length, cold = [base <= 6, frr <= 10, eth <= 6, fund !== undefined && fund <= 8].filter(Boolean).length;
  regime.leverage = heat >= 2 ? 'quente' : cold >= 3 ? 'frio' : 'neutro';
  lines.push(`Alavancagem em cripto: ${regime.leverage === 'quente' ? 'QUENTE (muita gente comprada pagando caro)' : regime.leverage === 'frio' ? 'FRIA (pouca demanda por alavancagem)' : 'NEUTRA'} — base de futuros ${ok(base) ? n(base) + '%' : '—'}, empréstimo de USDT (FRR) ${ok(frr) ? n(frr) + '%' : '—'}, sUSDe ${ok(eth) ? n(eth) + '%' : '—'}${ok(fund) ? ', funding dos majors ' + n(fund) + '%' : ''} a.a. ${regime.leverage === 'frio' ? 'Nesse regime as frentes de carry (base, empréstimo, Ethena) pagam pouco; o funding vem de diferenças entre corretoras, não do nível.' : regime.leverage === 'quente' ? 'Nesse regime carry e empréstimo pagam mais; historicamente antecede correções.' : ''}`);
  // 2) demanda local por cripto (ágio)
  const kr = P.kr && P.kr.btcPct, br = P.br && P.br.usdtPct, ar = P.ar && P.ar.usdtPct;
  if (ok(kr) || ok(br) || ok(ar)) lines.push(`Demanda local (ágio sobre o dólar): Coreia BTC ${ok(kr) ? n(kr, 2) + '%' : '—'}, Brasil USDT ${ok(br) ? n(br, 2) + '%' : '—'}, Argentina USDT ${ok(ar) ? n(ar, 2) + '%' : '—'}. ${ok(kr) && kr >= 3 ? 'Prêmio coreano alto costuma aparecer em euforia de varejo. ' : ''}${ok(ar) && ar >= 5 ? 'Na Argentina o dólar cripto segue acima do oficial (controle de câmbio).' : ''}`);
  // 3) mineração
  const A = F.asic;
  if (A || (mkt && mkt.ok)) lines.push(`Mineração: hashprice do BTC ${A ? 'US$' + n(A.hashpriceUsdPh, 2) + '/PH/dia (ASIC atual empata com energia a US$' + n(A.breakEvenKwh, 3) + '/kWh)' : '—'}; BCH ${ok(darr) ? 'paga ' + n((darr - 1) * 100, 1) + '% ' + (darr >= 1 ? 'a mais' : 'a menos') + ' que o BTC por hash (DARR ' + n(darr, 3) + ')' : '—'}${mkt && mkt.ok ? ', margem no aluguel ' + n(mkt.edgeAtBidPct, 1) + '%' : ''}.`);
  // 4) juros: CDI, juro real, carry real × dólar
  if (ok(cdi)) {
    const real = ok(mac.ipcaExp) ? ((1 + cdi / 100) / (1 + mac.ipcaExp / 100) - 1) * 100 : null;
    lines.push(`Juros: CDI ${n(cdi, 2)}%${ok(mac.ipcaExp) ? ', IPCA esperado ' + n(mac.ipcaExp, 2) + '% (' + mac.ipcaExpYear + ') → juro real ~' + n(real, 1) + '%' : ''}${ok(mac.tbill) ? '; T-bill dos EUA ' + n(mac.tbill, 2) + '% → CDI paga ' + n(cdi - mac.tbill, 1) + ' pts a mais que o juro em dólar' : ''}. Qualquer frente em dólar precisa render isso a mais para empatar com ficar em reais (sem contar a variação do dólar).`);
  }
  // 5) ranking de retorno anual medido
  const R = [];
  const add = (name, apr, kind, note) => { if (ok(apr)) R.push({ name, apr, kind, note: note || '', vsCdi: ok(cdi) ? apr - cdi : null }); };
  add('CDI (reais)', cdi, 'referência'); add('T-bill 3 meses (dólar)', mac.tbill, 'referência');
  add('Empréstimo de USDT na Bitfinex (líquido)', F.bfx && F.bfx.netApr, 'dólar', 'último empréstimo fechado');
  add('Cash-and-carry BTC (líquido)', F.basis && F.basis.netApr, 'dólar', F.basis ? 'travado até ' + F.basis.contract : '');
  add('Ethena sUSDe (30 dias)', eth, 'dólar'); add('Cofre HLP', F.hlp && F.hlp.apr, 'dólar');
  [['stEth', 'Staking ETH (Lido)', 'ETH'], ['jitoSol', 'Staking SOL (Jito)', 'SOL'], ['aaveUsdc', 'Emprestar USDC (Aave)', 'dólar'], ['aaveUsdt', 'Emprestar USDT (Aave)', 'dólar'], ['sUsds', 'Sky sUSDS', 'dólar']]
    .forEach(([k, name, kind]) => add(name, Y[k] && Y[k].apy, kind));
  const lt = F.lt && F.lt.top && F.lt.top.find((p) => p.hours >= 24);
  if (lt) add('Funding com Lighter: melhor par estável 24 h', lt.spread - lt.be, 'dólar', lt.coin + ': diferença acima do empate, taxa do momento (spreads duram em média ~18 h)');
  R.sort((a, b) => b.apr - a.apr);
  // tetos teóricos (não são retorno medido): ficam fora do ranking
  const ceil = [], pm = M.poly && M.poly.top && M.poly.top[0];
  if (pm) ceil.push({ name: 'Polymarket: recompensa ÷ liquidez no livro', apr: pm.aprMax, note: 'se toda a liquidez dividisse o prêmio; quem fica perto do meio leva mais; seleção adversa; acesso restrito no Brasil' });
  // 6) o que mudou em 7 dias
  const days = Object.keys(H).sort(), d0 = days[days.length - 1], d7 = days.find((d) => Date.parse(d) >= Date.parse(d0) - 7 * 864e5);
  const ch = [];
  if (d0 && d7 && d0 !== d7) {
    const a = H[d7], b = H[d0], lab = { bfx: 'Bitfinex', basis: 'base de futuros', ethena: 'sUSDe', hlp: 'HLP', usdt: 'ágio do USDT no Brasil', zSha: 'multipool × aluguel', ltAbove: 'pares Lighter acima do empate' };
    for (const k of Object.keys(lab)) if (ok(a[k]) && ok(b[k]) && Math.abs(b[k] - a[k]) >= (k === 'ltAbove' ? 5 : 0.5)) ch.push(`${lab[k]} ${b[k] > a[k] ? '↑' : '↓'} ${n(a[k], 1)} → ${n(b[k], 1)}`);
  }
  if (ch.length) lines.push(`Em 7 dias: ${ch.join('; ')}.`);
  return { at: now, regime, lines, rank: R, ceilings: ceil, changes: ch };
}
