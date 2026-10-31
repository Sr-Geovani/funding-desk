// Copiloto IA: junta todos os sinais (mineração, funding, outras moedas) numa análise e transforma cada sinal numa
// PREVISÃO conferível ("a janela abre em até 6 h", "esse pico some em 24 h"...). Quando o prazo vence, o servidor confere
// com os dados reais: acerto dá XP. A confiança de cada tipo de previsão aprende com o próprio histórico de acertos,
// e a maturidade (nível) sobe com o número de previsões conferidas e a taxa de acerto. Ninguém precisa executar a dica.
export const LEVELS = [
  { n: 1, name: 'Aprendiz', min: 0, hit: 0 }, { n: 2, name: 'Analista', min: 30, hit: 0 },
  { n: 3, name: 'Estrategista', min: 100, hit: 0.55 }, { n: 4, name: 'Mestre', min: 300, hit: 0.6 }
];
export const TYPES = {
  mine_buy: { label: 'Compra de hash (BCH) segue boa por 1 h', h: 1, cool: 3, base: 0.6 },
  mine_wait: { label: 'Janela do BCH abre em até 6 h', h: 6, cool: 6, base: 0.4 },
  mine_close: { label: 'Dificuldade do BCH sobe em 3 h (hash chegando)', h: 3, cool: 6, base: 0.55 },
  mine_avoid: { label: 'Alugar não compensa nas próximas 12 h', h: 12, cool: 12, base: 0.7 },
  btc_retarget: { label: 'DARR depois do reajuste do BTC', h: null, cool: 24 * 12, base: 0.6 },
  fund_go: { label: 'Entrada de funding paga as taxas em 3 dias', h: 72, cool: 24, base: 0.4 },
  fund_spike: { label: 'Pico de funding some em 24 h', h: 24, cool: 24, base: 0.7 },
  algo_go: { label: 'Outra moeda segue compensando por 6 h', h: 6, cool: 12, base: 0.5 }
};
const H = 3600e3;

export function levelOf(ai) {
  const st = Object.values(ai.stats || {}), n = st.reduce((a, s) => a + s.n, 0), hits = st.reduce((a, s) => a + s.hits, 0);
  const rate = n ? hits / n : 0;
  let cur = LEVELS[0];
  for (const L of LEVELS) if (n >= L.min && rate >= L.hit) cur = L;
  const next = LEVELS.find((L) => L.n === cur.n + 1) || null;
  const progress = next ? Math.min(1, n / next.min) * (next.hit ? Math.min(1, rate / next.hit) : 1) : 1;
  return { level: cur, next, resolved: n, hits, rate, progress };
}
export function reliability(ai, type) {
  const s = (ai.stats || {})[type] || { n: 0, hits: 0 };
  const rel = (s.hits + 1) / (s.n + 2), base = TYPES[type].base;
  return { n: s.n, rel, conf: s.n >= 5 ? (base + rel) / 2 : base, trusted: s.n >= 20 && rel >= 0.6 };
}
const spreadOf = (rows, key) => { const [c, s, l] = key.split('|'), r = rows && rows[c]; return r && r[s] && r[l] ? r[s].apr - r[l].apr : null; };

// snap: { now, edge, green, minEdge, darr, D, mom, ret, win, fund:[{key,coin,netUsd}], rows, stable24, algos:[{k,label,edge,level}], scoreDone:[...] }
export function brainStep(prev, snap) {
  const ai = prev && prev.since ? JSON.parse(JSON.stringify(prev)) : { since: snap.now, xp: 0, open: [], done: [], stats: {}, last: {} };
  const events = [], now = snap.now;
  // 1) conferir previsões abertas
  const still = [];
  for (const o of ai.open) {
    if (o.type === 'mine_wait' || o.type === 'mine_avoid') o.maxEdge = Math.max(o.maxEdge === undefined ? -1e9 : o.maxEdge, isFinite(snap.edge) ? snap.edge : -1e9);
    if (now < o.due) { still.push(o); continue; }
    let hit = null, value = null;
    if (o.type === 'mine_buy') { if (isFinite(snap.edge)) { hit = snap.edge >= 0; value = snap.edge; } }
    else if (o.type === 'mine_wait') { hit = o.maxEdge >= o.minEdge; value = o.maxEdge; }
    else if (o.type === 'mine_avoid') { hit = o.maxEdge < o.minEdge; value = o.maxEdge; }
    else if (o.type === 'mine_close') { if (snap.D) { hit = snap.D > o.D0 * 1.005; value = (snap.D / o.D0 - 1) * 100; } }
    else if (o.type === 'btc_retarget') { if (isFinite(snap.darr)) { hit = Math.abs(snap.darr / o.pred - 1) <= 0.03; value = snap.darr; } }
    else if (o.type === 'algo_go') { const a = (snap.algos || []).find((x) => x.k === o.key); if (a && isFinite(a.edge)) { hit = a.edge > 0; value = a.edge; } }
    else if (o.type === 'fund_spike') { const sp = spreadOf(snap.rows, o.key); if (sp !== null) { hit = sp < o.s0 / 2; value = sp; } }
    else if (o.type === 'fund_go') {
      const d = (snap.scoreDone || []).find((x) => x.key === o.key && Math.abs(x.t - o.t) <= 6 * H);
      if (d) { hit = d.hit; value = d.netUsd; } else if (now < o.due + 12 * H) { still.push(o); continue; }
    }
    const r = Object.assign({}, o, { hit, value, resolvedAt: now });
    if (hit !== null) r.check = ({ mine_buy: `margem 1 h depois: ${f(value, 1)}%`, mine_wait: `maior margem no período: ${f(value, 1)}% (precisava ${o.minEdge}%)`,
      mine_avoid: `maior margem no período: ${f(value, 1)}% (mínimo ${o.minEdge}%)`, mine_close: `dificuldade variou ${f(value, 2)}%`, btc_retarget: `DARR depois: ${f(value, 3)} (previsto ${f(o.pred, 3)})`,
      algo_go: `margem 6 h depois: ${f(value, 1)}%`, fund_spike: `diferença 24 h depois: ${f(value, 0)}% a.a. (era ${f(o.s0, 0)}%)`, fund_go: `resultado em 3 dias: US$${f(value, 2)}` })[o.type] || '';
    if (hit !== null) {
      const s = ai.stats[o.type] || (ai.stats[o.type] = { n: 0, hits: 0 });
      s.n++; if (hit) s.hits++;
      r.xp = hit ? Math.round(10 * o.conf) + (o.trusted ? 5 : 0) : 1;
      ai.xp += r.xp;
      events.push(`IA ${hit ? 'acertou' : 'errou'}: ${o.text} (+${r.xp} XP)`);
    }
    ai.done.push(r);
  }
  ai.open = still; ai.done = ai.done.slice(-200);

  // 2) novas previsões a partir dos sinais de agora
  const add = (type, key, text, extra) => {
    const k = type + '|' + key;
    if (ai.last[k] && now - ai.last[k] < TYPES[type].cool * H) return;
    if (ai.open.some((o) => o.type === type && o.key === key)) return;
    const rel = reliability(ai, type);
    ai.last[k] = now;
    ai.open.push(Object.assign({ type, key, text, t: now, due: now + (TYPES[type].h || 24) * H, conf: +rel.conf.toFixed(2), trusted: rel.trusted }, extra));
    events.push(`IA prevê: ${text}`);
  };
  const e = snap.edge, mom = snap.mom ? snap.mom.vsEmaPct : 0;
  if (snap.green) add('mine_buy', 'bch', `comprar hash para o BCH agora (margem ${f(e, 1)}%) continua no positivo daqui a 1 h`, { why: `margem ${f(e, 1)}% ≥ seu mínimo ${snap.minEdge}%; DARR ${isFinite(snap.darr) ? f(snap.darr, 3) : '—'}. Margens assim raramente viram negativas em 1 h.` });
  else if (isFinite(e) && (snap.darr >= 1 || mom >= 2) && e > snap.minEdge - 3) add('mine_wait', 'bch', `a margem do BCH passa de ${snap.minEdge}% em até 6 h (agora ${f(e, 1)}%, DARR ${f((snap.darr || 0), 3)})`, { minEdge: snap.minEdge, maxEdge: e,
    why: `${snap.darr >= 1 ? 'DARR ' + f(snap.darr, 3) + ' ≥ 1 (BCH paga mais que o BTC)' : ''}${snap.darr >= 1 && mom >= 2 ? ' e ' : ''}${mom >= 2 ? 'BCH ' + f(mom, 1) + '% acima da média de 2 dias (preço antes da dificuldade)' : ''}; margem a menos de 3 pontos do mínimo.` });
  if (isFinite(snap.darr) && snap.darr < 0.97 && mom <= 0 && !snap.green) add('mine_avoid', 'bch', `alugar para o BCH não compensa nas próximas 12 h (DARR ${f(snap.darr, 3)})`, { minEdge: snap.minEdge, maxEdge: e, why: `DARR ${f(snap.darr, 3)} abaixo de 0,97 e o BCH não está subindo contra o BTC: sem motor para a margem melhorar logo.` });
  const w = snap.win;
  if (w && snap.D && (w.last6h >= 42 || (w.bigShare6h !== null && w.bigShare24h !== null && w.bigShare6h - w.bigShare24h >= 0.1 && w.last6h >= 30)))
    add('mine_close', 'bch', `a dificuldade do BCH sobe mais de 0,5% em 3 h (${w.last6h} blocos em 6 h; pools grandes chegando)`, { D0: snap.D, why: `${w.last6h} blocos em 6 h (esperado 36) e pools grandes ${w.bigShare6h !== null ? f(w.bigShare6h * 100, 0) + '%' : '—'} (24 h: ${w.bigShare24h !== null ? f(w.bigShare24h * 100, 0) + '%' : '—'}): hash chegando faz o ASERT subir a dificuldade.` });
  const R = snap.ret;
  if (R && R.at && R.remainingBlocks <= 288 && isFinite(R.darrAfter))
    add('btc_retarget', String(Math.round(R.at / 864e5)), `depois do reajuste do BTC (${pctTxt(R.changePct)}), o DARR fica em ~${f(R.darrAfter, 3)} (±3%)`, { pred: R.darrAfter, due: R.at + 2 * H, why: `reajuste do BTC em ${R.remainingBlocks} blocos, estimativa ${pctTxt(R.changePct)}: o BTC passa a pagar ${pctTxt(-R.changePct)} por hash, então o DARR muda na mesma proporção.` });
  for (const f of (snap.fund || []).slice(0, 3)) add('fund_go', f.key, `${f.coin} (${f.key.split('|').slice(1).join(' × ')}) paga as taxas em 3 dias`, { why: 'diferença acima do empate (ordem limite) nas últimas 24 h e a meia-vida indica que paga as taxas; regra validada em 90 dias (39% de acerto).' });
  const spikes = [];
  for (const [c, r] of Object.entries(snap.rows || {})) {
    const v = Object.entries(r).filter(([, x]) => isFinite(x.apr)).sort((a, b) => b[1].apr - a[1].apr);
    if (v.length < 2) continue;
    const key = c + '|' + v[0][0] + '|' + v[v.length - 1][0], sp = v[0][1].apr - v[v.length - 1][1].apr;
    if (sp >= 60 && !(snap.stable24 || {})[key]) spikes.push([key, sp]);
  }
  for (const [key, sp] of spikes.sort((a, b) => b[1] - a[1]).slice(0, 2)) add('fund_spike', key, `o pico de ${key.split('|')[0]} (${f(sp, 0)}% a.a. entre ${key.split('|').slice(1).join(' e ')}) cai pela metade em 24 h`, { s0: sp, why: `${f(sp, 0)}% a.a. é pico (≥ 60%) e não ficou 24 h estável; no histórico, diferenças assim voltam em ~18 h.` });
  for (const a of (snap.algos || []).filter((x) => x.level === 'go' && isFinite(x.edge))) add('algo_go', a.k, `${a.label} segue com margem positiva daqui a 6 h (agora ${f(a.edge, 1)}%)`, { why: `margem ${f(a.edge, 1)}% = receita por hash ÷ aluguel típico − 1, já com taxas; livro com ordens suficientes.` });
  for (const k of Object.keys(ai.last)) if (now - ai.last[k] > 30 * 24 * H) delete ai.last[k];
  return { ai, events };
}
function pctTxt(x) { return (x >= 0 ? '+' : '') + f(x, 1) + '%'; }
function f(x, d) { return Number(x).toFixed(d).replace('.', ','); } // número em pt-BR

// Análise em texto: o que está acontecendo agora e o que fazer, juntando tudo.
export function analysis(snap, ai) {
  const L = levelOf(ai), out = [], recs = [];
  const e = snap.edge, d = snap.darr;
  if (isFinite(e)) {
    out.push(snap.green
      ? `Mineração BCH: janela aberta. Margem de ${f(e, 1)}% no lance (DARR ${d ? f(d, 3) : '—'}). O robô compraria agora.`
      : `Mineração BCH: o robô está pausado. Margem de ${f(e, 1)}% no lance, abaixo do seu mínimo de ${snap.minEdge}%${d ? ` (DARR ${f(d, 3)})` : ''}.`);
    if (snap.green) recs.push({ area: 'mineracao', text: 'Janela aberta: com o robô em Ativo, ele compraria agora e pararia no bloco.', type: 'mine_buy' });
  }
  if (snap.mom && snap.mom.vsEmaPct >= 2) out.push(`BCH subiu ${f(snap.mom.vsEmaPct, 1)}% acima da média de 2 dias contra o BTC: a dificuldade ainda não reagiu, o que costuma melhorar a margem nas próximas horas.`);
  if (snap.ret && isFinite(snap.ret.darrAfter)) out.push(`Reajuste do BTC em ${snap.ret.remainingBlocks} blocos (${pctTxt(snap.ret.changePct)}): o DARR deve ir para ~${f(snap.ret.darrAfter, 3)}.`);
  if (snap.win && snap.win.last6h >= 42) out.push(`Hash grande chegando ao BCH (${snap.win.last6h} blocos em 6 h): a janela tende a fechar em horas.`);
  const nf = (snap.fund || []).length;
  out.push(nf ? `Funding: ${nf} oportunidade${nf > 1 ? 's' : ''} passa${nf > 1 ? 'm' : ''} na regra validada (24 h estável, ordem limite).` : 'Funding: nenhuma oportunidade passa na regra validada agora (24 h estável + ordem limite + meia-vida).');
  for (const fo of (snap.fund || []).slice(0, 2)) recs.push({ area: 'funding', text: `${fo.coin}: short ${fo.key.split('|')[1]}, long ${fo.key.split('|')[2]} com ordem limite (~US$${f((fo.netUsd || 0), 2)} projetado em 3 dias).`, type: 'fund_go' });
  const ag = (snap.algos || []).filter((x) => x.level === 'go');
  if (ag.length) { out.push(`Outras moedas: ${ag.map((a) => a.label + ' ' + f(a.edge, 1) + '%').join(', ')} compensam em pool PPS (ordem manual).`); for (const a of ag.slice(0, 2)) recs.push({ area: 'outras', text: `${a.label}: ordem manual na NiceHash para pool PPS enquanto a margem ficar positiva.`, type: 'algo_go' }); }
  for (const r of recs) { const rel = reliability(ai, r.type); r.conf = rel.conf; r.trusted = rel.trusted; r.n = rel.n; }
  return { level: L, lines: out, recs };
}

// Plano de ação do copiloto: o que fazer agora, com números (potência, preço, orçamento, duração, quando parar)
// e as travas que impedem de operar. ctx: { cfg, limits, mkt, acct:{balanceBtc,pools}, fund:[...], algoMap:[...], capital, pools:{algo:[[nome,url]]} }
export function actionPlan(ctx) {
  const { cfg, limits, mkt, acct } = ctx, out = { mining: null, funding: null, others: [], blockers: [] };
  const n = (x, d) => Number(x).toFixed(d).replace('.', ',');
  // --- mineração BCH (solo) ---
  if (mkt && mkt.ok) {
    const budget = cfg.sessionBudgetUsd > 0 ? cfg.sessionBudgetUsd : 300;
    const perPhDay = mkt.bidEH / 1000 * mkt.btcUsd * (1 + cfg.rentFeePct / 100); // US$ por PH/s por dia no lance
    const hours = 2; // janelas costumam durar ~2 h (pesquisa): gastar o orçamento da sessão nesse tempo
    const book = mkt.bookTotalPH || 0;
    const rawPh = Math.floor(budget / (perPhDay * hours / 24)), liq = book ? Math.floor(book * 0.05) : Infinity;
    let ph = Math.max(1, Math.min(rawPh, limits.maxLimitPh, liq)); // até o teto do servidor e 5% do hash alugado no mercado
    const capBy = ph < rawPh ? (ph === limits.maxLimitPh ? `teto de segurança do servidor (${limits.maxLimitPh} PH/s)` : 'liquidez: 5% do hash alugado no mercado') : null;
    // comparação: o que cada potência faz numa janela típica de ~2 h (mesma média por dólar; muda chance e gasto)
    const alt = [10, 30, ph].filter((x, i, a) => a.indexOf(x) === i).map((x) => { const c = x * perPhDay / 24 * hours, l = x / mkt.phDaysPerBlock * hours / 24; return { ph: x, costUsd: c, chance: 1 - Math.exp(-l) }; });
    const costH = ph * perPhDay / 24, dur = Math.min(24, budget / costH);
    const lam = ph / mkt.phDaysPerBlock * dur / 24, chance = 1 - Math.exp(-lam);
    const amountBtc = Math.max(0.001, Math.min(limits.maxOrderBtc, budget / mkt.btcUsd));
    const green = mkt.green;
    // a sua configuração (o que o robô vai executar) com os mesmos números, para comparar com a sugestão
    const myPh = Math.max(1, Math.min(cfg.targetPh || 1, limits.maxLimitPh)), myCostH = myPh * perPhDay / 24;
    const mine = { ph: myPh, budgetUsd: budget, costPerHourUsd: myCostH, durationH: Math.min(999, budget / myCostH),
      chance2h: 1 - Math.exp(-myPh / mkt.phDaysPerBlock * hours / 24), cost2h: myCostH * hours };
    out.mining = {
      action: green ? 'alugar' : 'esperar', edge: mkt.edgeAtBidPct, price: mkt.bidEH, maxPrice: mkt.capEH, ph, budgetUsd: budget, durationH: dur,
      amountBtc: +amountBtc.toFixed(4), chance, expBlocks: lam, costPerHourUsd: costH, blockUsd: mkt.blockNetUsd, alt, mine,
      chance2h: 1 - Math.exp(-ph / mkt.phDaysPerBlock * hours / 24), cost2h: costH * hours,
      why: [`Orçamento por sessão: US$${n(budget, 0)} (o seu stop-loss). É o máximo que você aceita perder se não sair bloco.`,
        `As janelas boas duram ~2 h (pesquisa de 6 meses). A potência é a que gasta esse orçamento dentro de uma janela: US$${n(budget, 0)} ÷ (US$${n(perPhDay / 24, 2)} por PH/s por hora × 2 h) = ${rawPh} PH/s.`,
        capBy ? `Limitado a ${ph} PH/s pelo ${capBy}.` : `Cabe no teto de segurança (${limits.maxLimitPh} PH/s) e na liquidez do mercado.`,
        'Por dólar gasto, a média é a mesma com qualquer potência. Mais potência = mais chance enquanto a janela está aberta (e o orçamento acaba mais rápido); menos potência = a janela fecha antes de você usar o orçamento.'],
      title: green ? `Alugar agora: ${ph} PH/s a até ${n(mkt.capEH, 4)}` : `Esperar: o aluguel está acima do preço que compensa`,
      text: green
        ? `Margem de ${n(mkt.edgeAtBidPct, 1)}% no lance. Com ${ph} PH/s (~US$${n(costH, 0)}/h), o orçamento de US$${n(budget, 0)} dura ~${n(dur, 1)} h e dá ${n(chance * 100, 0)}% de chance de achar um bloco (~US$${n(mkt.blockNetUsd, 0)}). Parar no bloco; stop-loss em US$${n(budget, 0)}.`
        : `O robô compra sozinho quando o lance ficar em ${n(mkt.capEH, 4)} ou menos (hoje ${n(mkt.bidEH, 4)}, margem ${n(mkt.edgeAtBidPct, 1)}%). Deixe o plano pronto: ${ph} PH/s, orçamento de US$${n(budget, 0)} por sessão, parar no bloco.`,
      apply: { targetPh: ph, sessionBudgetUsd: budget, orderAmountBtc: +amountBtc.toFixed(4), onBlock: 'cancel', autoCreate: true }
    };
    // travas da mineração, com o que fazer
    if (!cfg.payoutAddress) out.blockers.push({ id: 'address', text: 'Falta o seu endereço BCH (onde cai a recompensa).', fix: 'Mineração → Operar → Endereço BCH.' });
    const sha = (acct && acct.pools || []).filter((p) => !p.algorithm || /SHA256/.test(p.algorithm));
    if (!cfg.poolId) out.blockers.push({ id: 'pool', text: 'Nenhum pool escolhido para as ordens do robô.', fix: sha.length ? `Usar "${sha[0].name}"` : 'Cadastre o pool BlockSniper em Operar.', poolId: sha.length ? sha[0].id : null });
    if (acct && isFinite(acct.balanceBtc) && acct.balanceBtc < amountBtc) out.blockers.push({ id: 'balance', text: `Saldo na NiceHash: ${n(acct.balanceBtc, 6)} BTC; o plano precisa de ${n(amountBtc, 4)} BTC (~US$${n(amountBtc * mkt.btcUsd, 0)}).`, fix: 'Depositar BTC na carteira da NiceHash (Carteira → Depositar → BTC).' });
    if (!cfg.autoCreate) out.blockers.push({ id: 'auto', text: 'O robô não cria ordem sozinho: ele só mexe em ordens que você abrir.', fix: 'Aplicar o plano (liga "criar ordem sozinho").' });
    if (cfg.mode !== 'active') out.blockers.push({ id: 'mode', text: cfg.mode === 'observe' ? 'O robô está em Observar: só simula.' : 'O robô está desligado.', fix: 'Ativar depois de resolver as travas acima.' });
  }
  // --- funding ---
  const f = (ctx.fund || [])[0];
  const leg = (ctx.capital || 1000) / 2 * 2;
  out.funding = f
    ? { action: 'entrar', title: `Abrir ${f.coin}: short ${f.s}, long ${f.l}`, text: `US$${n(leg, 0)} por perna (2x, US$${n(ctx.capital || 1000, 0)} de capital), ordem limite nas duas; esperado ~US$${n(f.netUsd || 0, 2)} em 3 dias. Sair quando a diferença ficar ≤ 0 (o painel avisa). Funding é manual: abra nas exchanges e registre no Diário.`,
        why: ['A diferença ficou acima do empate (com ordem limite) nas últimas 24 h seguidas.', 'A meia-vida da diferença indica que ela dura o bastante para pagar as 4 execuções.',
          'Regra validada em 90 dias de dados: 39% de acerto e média de +US$0,11 por operação. É margem pequena: tamanho moderado.', 'Ordem limite porque a taxa a mercado (taker) come quase todo o ganho.'] }
    : { action: 'esperar', title: 'Funding: nenhuma entrada agora', text: 'Nenhuma diferença passou na regra validada (24 h acima do empate, ordem limite, meia-vida que paga as taxas). Não force: nos últimos 90 dias, fora dessa regra, a média foi prejuízo.',
        why: ['Picos de diferença costumam voltar em ~18 h: a entrada (4 execuções) não se paga.', 'Com ordem a mercado, entrar quando a diferença passa do empate perdeu US$1,40 por operação em 90 dias.', 'O servidor só considera estável depois de 24 h de histórico próprio do par.'] };
  // --- outras moedas (pool PPS: resultado sem sorte) ---
  for (const a of (ctx.algoMap || []).filter((x) => x.level === 'go' && x.edgePct > 0 && x.edgePct <= 100).slice(0, 3)) {
    const pools = (ctx.pools || {})[a.algo] || [];
    out.others.push({ algo: a.algo, title: `${a.label} (${(a.coins || []).join('+')}): margem ${n(a.edgePct, 1)}%`,
      text: `Ordem manual na NiceHash (${a.algo}) apontada para um pool PPS${pools.length ? ' como ' + pools.slice(0, 2).map((p) => p[0]).join(' ou ') : ''}; preço até ${a.capBtcPerUnit ? n(a.capBtcPerUnit, 6) + ' BTC/' + (a.unit || 'unid.') + '/dia' : 'o máximo do mapa'}; orçamento sugerido US$100/dia; parar se a margem ficar abaixo de 0.`,
      why: [`Margem ${n(a.edgePct, 1)}% = quanto o hash rende nessa moeda ÷ aluguel típico na NiceHash − 1, já com 3% da NiceHash e 2% do pool.`, 'Pool PPS paga por share: sem sorte de bloco, o resultado diário é o esperado.', 'O livro tem ordens suficientes recebendo hash (preço confiável).', 'Ordem manual: o robô automático hoje só opera o BCH.'] });
  }
  return out;
}
