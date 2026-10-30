/* Funding Desk — copiloto: transforma números em decisões em linguagem simples.
   Lógica pura (sem DOM). Usado pelo painel (window.FDC) e pelos testes (node --test).
   Todo veredito é projeção sobre um snapshot de mercado: pode mudar em minutos. */
(function (root) {
'use strict';

var TWO32 = 4294967296;
var LEVELS = {
  go: { label: 'Compensa', icon: '✓', cls: 'ok' },
  maybe: { label: 'No limite', icon: '!', cls: 'warn' },
  no: { label: 'Não compensa agora', icon: '✕', cls: 'bad' },
  none: { label: 'Sem dados', icon: '…', cls: '' }
};

/* ---------- formatação pt-BR ---------- */
function nf(x, d) { return Number(x).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
function money(x, d) { return (x < 0 ? '-' : '') + 'US$' + nf(Math.abs(x), d === undefined ? 2 : d); }
function pctTxt(x, d) { return nf(x, d === undefined ? 1 : d) + '%'; }
function daysTxt(d) {
  if (!isFinite(d)) return 'nunca';
  if (d < 1) return nf(d * 24, 0) + ' h';
  return nf(d, 1) + (d < 1.95 ? ' dia' : ' dias');
}
function hoursTxt(h) {
  if (!isFinite(h)) return '—';
  if (h < 1) return nf(h * 60, 0) + ' min';
  if (h < 48) return nf(h, 1) + ' h';
  if (h < 24 * 60) return nf(h / 24, 0) + ' dias';
  if (h < 24 * 730) return nf(h / 24 / 30, 0) + ' meses';
  return nf(h / 24 / 365, 0) + ' anos';
}

/* ---------- funding ---------- */
// Estabilidade do spread pelo histórico pago (seriesStats de core.js com o break-even do ciclo).
function stability(st) {
  if (!st || st.pctAboveBe === null || st.pctAboveBe === undefined || st.n < 6) return null;
  var p = Math.round(st.pctAboveBe);
  if (p >= 70) return { key: 'estavel', label: 'Estável', cls: 'ok', text: 'Nos últimos dias, o spread pago ficou acima do break-even em ' + p + '% das horas.' };
  if (p >= 40) return { key: 'oscila', label: 'Oscila', cls: 'warn', text: 'O spread pago ficou acima do break-even em só ' + p + '% das horas: entra e sai do ponto de lucro.' };
  return { key: 'pico', label: 'Pico', cls: 'bad', text: 'O spread pago ficou acima do break-even em só ' + p + '% das horas: o valor de agora parece um pico, que costuma durar pouco.' };
}

// o: oportunidade de core.js (coin, s, l, spread, m, rs, rl, capped, age). ctx: hold, stab, newDays, src.
function fundingVerdict(o, ctx) {
  ctx = ctx || {};
  var m = o.m, hold = ctx.hold || 3, sp = o.l === 'Spot';
  var title = sp ? 'Compre ' + o.coin + ' à vista e venda o perpétuo na ' + o.s : 'Short na ' + o.s + ', long na ' + o.l;
  var risks = [];
  if (o.capped) risks.push('Spread extremo (acima do teto do cálculo): costuma normalizar em poucas horas.');
  if (o.age !== null && o.age !== undefined && o.age < (ctx.newDays || 30)) risks.push('Listing com ' + nf(Math.max(0, o.age), 0) + ' dias: o teto e o intervalo de funding podem mudar.');
  if (ctx.src && (ctx.src[o.s] === 'via HL' || (!sp && ctx.src[o.l] === 'via HL'))) risks.push('Taxa de uma das pernas veio da Hyperliquid (sem volume): confira na exchange.');
  if (o.rs && o.rs.maxLev && ctx.lev && o.rs.maxLev < ctx.lev) risks.push('A ' + o.s + ' aceita no máximo ' + o.rs.maxLev + 'x nesta moeda.');
  if (ctx.stab && ctx.stab.key === 'pico') risks.push(ctx.stab.text);
  var level, why, action;
  var income = sp ? 'O funding do perpétuo está em ' + pctTxt(o.spread) + ' ao ano' : 'A diferença de funding entre as duas é de ' + pctTxt(o.spread) + ' ao ano';
  // acima do teto, o cálculo usa o teto: picos assim costumam cair em horas
  if (o.capped && ctx.aprCap) income += ' agora; por prudência, a conta usa no máximo ' + pctTxt(ctx.aprCap, 0) + ' ao ano';
  if (m.netOnCap <= 0) {
    level = 'no';
    why = income + ', o que rende ~' + money(m.perDayUsd) + ' por dia com ' + money(m.notional, 0) + ' por perna. Em ' + hold + ' dias isso não cobre as taxas e custos (' + money(m.cost) + ').';
    action = 'Não entre. Um ciclo mais longo ou taxas maker podem mudar a conta.';
  } else {
    var slow = m.be > hold * 0.6;
    level = slow || o.capped || (ctx.stab && ctx.stab.key === 'pico') ? 'maybe' : 'go';
    why = income + ', o que rende ~' + money(m.perDayUsd) + ' por dia com ' + money(m.notional, 0) + ' por perna. As taxas e custos (' + money(m.cost) +
      ') se pagam em ' + daysTxt(m.be) + '; no ciclo de ' + hold + ' dias sobram ~' + money(m.netUsd) + ' (projeção).';
    action = level === 'go'
      ? (sp ? 'Pode entrar: compre o spot e abra o short no perpétuo, mesmo tamanho, ao mesmo tempo.' : 'Pode entrar: abra as duas pernas juntas, mesmo tamanho, margem isolada.') + ' Registre no Diário.'
      : (slow ? 'Margem apertada: os custos levam mais da metade do ciclo para se pagar. ' : '') + 'Entre só com tamanho menor ou espere o histórico confirmar.';
  }
  return { level: level, title: title, why: why, action: action, risks: risks };
}

function fundingSummary(ops, verdicts, ctx) {
  var go = [], maybe = [];
  ops.forEach(function (o, i) { var v = verdicts[i]; if (v.level === 'go') go.push(o); else if (v.level === 'maybe') maybe.push(o); });
  var hold = (ctx && ctx.hold) || 3;
  if (!ops.length) return { level: 'none', title: 'Sem dados de funding', text: 'Nenhuma oportunidade passou pelos filtros (volume mínimo, open interest).' };
  if (go.length) {
    var b = go[0];
    return { level: 'go', count: go.length, best: b, title: go.length + (go.length > 1 ? ' oportunidades compensam' : ' oportunidade compensa'),
      text: 'Melhor agora: ' + b.coin + ' (' + (b.l === 'Spot' ? 'spot + short na ' + b.s : 'short na ' + b.s + ', long na ' + b.l) + '), ~' + money(b.m.netUsd) + ' líquidos em ' + hold + ' dias.' };
  }
  if (maybe.length) {
    var c = maybe[0];
    return { level: 'maybe', count: maybe.length, best: c, title: 'Só oportunidades no limite',
      text: 'A melhor é ' + c.coin + ' (~' + money(c.m.netUsd) + ' em ' + hold + ' dias), mas com margem apertada, spread extremo ou sinal de pico.' };
  }
  return { level: 'no', count: 0, title: 'Nada compensa agora',
    text: 'Nenhuma oportunidade cobre as taxas em ' + hold + ' dias com o seu cenário. O funding muda a cada hora: volte mais tarde.' };
}

/* ---------- mineração ---------- */
// x: coin, revenue (US$/PH·dia já sem a taxa do pool), rent (US$/PH·dia com taxas), rentPriceEH, breakEvenEH,
//    coinUsd, networkPH, avgBlockMin, minEdgePct
function miningVerdict(x) {
  if (!(x.revenue > 0) || !(x.rent > 0)) {
    return { level: 'none', title: 'Sem dados suficientes', why: 'Falta o preço do aluguel ou a receita da rede. Atualize ou digite o preço no Planejar.', action: '', when: '', note: '' };
  }
  var m = (x.minEdgePct || 0) / 100, ratio = x.revenue / x.rent;
  var level = x.rent <= x.revenue * (1 - m) ? 'go' : (x.rent <= x.revenue ? 'maybe' : 'no');
  if (x.thin && level === 'go') level = 'maybe'; // livro raso: preço típico não vale para volume
  var title = { go: 'Compensa alugar hash para ' + x.coin + ' agora', maybe: x.coin + ' está no empate', no: 'Não compensa alugar para ' + x.coin + ' agora' }[level];
  var why = 'Alugar 1 PH/s por um dia custa ' + money(x.rent) + ' (preço típico do mercado, com taxas). Esse hash rende em média ' + money(x.revenue) +
    ' em ' + x.coin + ' (já sem a taxa do pool). ' + (ratio >= 1 ? 'Para cada US$1 pago, espera-se receber US$' + nf(ratio, 2) + '.' : 'Você pagaria US$' + nf(1 / ratio, 2) + ' para cada US$1 esperado.');
  var note = 'Não depende de quantos mineram: a rede ' + x.coin + (x.networkPH ? ' tem ~' + nf(x.networkPH, 0) + ' PH/s' : '') +
    (x.avgBlockMin ? ' e sai um bloco a cada ~' + nf(x.avgBlockMin, 0) + ' min' : '') + '. A sua chance por PH só muda com a dificuldade; o que decide é o preço do aluguel contra o que o hash rende.';
  var when = '';
  if (level !== 'go') {
    var cap = x.breakEvenEH ? x.breakEvenEH * (1 - m) : null;
    var coinNeed = x.coinUsd ? x.coinUsd * x.rent / (x.revenue * (1 - m)) : null;
    when = 'Passa a compensar' + (m ? ' (com sua margem de ' + pctTxt(m * 100, 0) + ')' : '') + ' se o aluguel cair para ' +
      (cap ? nf(cap, 4) + ' BTC/EH/dia' : 'abaixo da receita') + (x.rentPriceEH ? ' ou menos (hoje ' + nf(x.rentPriceEH, 4) + ')' : '') +
      (coinNeed ? ', ou se o ' + x.coin + ' subir para ' + money(coinNeed) + ' (hoje ' + money(x.coinUsd) + ')' : '') + '.';
  }
  var action = {
    go: 'Pode alugar: escolha potência e orçamento no Planejar, crie a ordem com preço até o teto e deixe o robô encerrar no bloco.',
    maybe: 'Só vale comprando no teto. Deixe o robô em Observar com teto: ele só compra quando o preço ficar abaixo do empate.',
    no: 'Não abra ordem agora. Se quiser, deixe o robô em Observar: ele registra quando o preço cair abaixo do teto.'
  }[level];
  if (x.thin) note = 'Livro da NiceHash raso agora (' + x.thin + ' ordens recebendo hash): para comprar volume de verdade o preço tende a subir. ' + note;
  return { level: level, title: title, why: why, note: note, when: when, action: action, edgePct: (ratio - 1) * 100, ratio: ratio };
}

// Compara moedas SHA-256 que o mesmo hash alugado pode minerar.
// list: [{coin, name, D, rewardCoin, coinUsd, notes}]; ctx: rent (US$/PH·dia), poolFeePct, minEdgePct, refPh
function coinCompare(list, ctx) {
  var refPh = ctx.refPh || 10, m = (ctx.minEdgePct || 0) / 100;
  return list.filter(function (c) { return c.D > 0 && c.coinUsd > 0; }).map(function (c) {
    var phDays = c.D * TWO32 / 1e15 / 86400;
    var blockUsd = c.rewardCoin * c.coinUsd * (1 - (ctx.poolFeePct || 0) / 100);
    var revenue = blockUsd / phDays;
    var hoursPerBlock = phDays / refPh * 24;
    var variance = hoursPerBlock > 24 * 365 ? { key: 'loteria', label: 'loteria' } : hoursPerBlock > 24 * 7 ? { key: 'alta', label: 'alta' } :
      hoursPerBlock > 12 ? { key: 'media', label: 'média' } : { key: 'baixa', label: 'baixa' };
    var level = ctx.rent > 0 ? (ctx.rent <= revenue * (1 - m) ? 'go' : (ctx.rent <= revenue ? 'maybe' : 'no')) : 'none';
    if (ctx.thin && level === 'go') level = 'maybe';
    return {
      coin: c.coin, name: c.name, revenue: revenue, edgePct: ctx.rent > 0 ? (revenue / ctx.rent - 1) * 100 : null,
      phDaysPerBlock: phDays, blockUsd: blockUsd, costPerBlock: ctx.rent > 0 ? phDays * ctx.rent : null,
      hoursPerBlock: hoursPerBlock, refPh: refPh, variance: variance, level: level, notes: c.notes || ''
    };
  }).sort(function (a, b) { return b.revenue - a.revenue; });
}

/* ---------- jornadas ---------- */
// status: 'ok' (pronto), 'now' (é aqui), 'wait' (depois), 'info' (lembrete)
function journey(kind, c) {
  c = c || {};
  if (kind === 'funding') {
    return [
      { title: 'Preparar', status: 'info', text: 'Conta em duas exchanges (ex.: Binance e Bybit) com USDT. Margem isolada, até 2x por perna, 30% da margem livre em cada uma.' },
      { title: 'Encontrar', status: c.goCount ? 'now' : 'wait',
        text: 'Procure oportunidades verdes: os custos se pagam em menos da metade do ciclo e o histórico mostra spread estável.',
        detail: c.goCount ? 'Agora: ' + c.goCount + ' verde' + (c.goCount > 1 ? 's' : '') + (c.best ? '. Melhor: ' + c.best : '') + '.' : 'Agora: nenhuma verde. O funding muda a cada hora.' },
      { title: 'Conferir', status: 'info', text: 'Antes de entrar: taxa real da sua conta, volume da moeda, horário do próximo pagamento, se é listing novo e se o spread não é "extremo".' },
      { title: 'Entrar', status: 'info', text: 'Short na exchange de funding mais alto e long na de mais baixo, mesmo tamanho, ao mesmo tempo. Registre a entrada no Diário.' },
      { title: 'Acompanhar', status: c.openPositions ? 'now' : 'wait',
        text: 'O painel recalcula a cada 2 min. Vermelho na posição = spread abaixo do break-even ou invertido.',
        detail: c.openPositions ? c.openPositions + ' posição(ões) aberta(s)' + (c.alerts ? ', ' + c.alerts + ' em alerta.' : ', nenhuma em alerta.') : '' },
      { title: 'Sair', status: c.alerts ? 'now' : 'wait', text: 'Feche as duas pernas juntas quando o ciclo terminar, o spread cair abaixo do break-even ou inverter.' },
      { title: 'Registrar', status: 'info', text: 'Copie do extrato o funding recebido e as taxas, e feche a posição no Diário. É o seu histórico auditável.' }
    ];
  }
  return [
    { title: 'Preparar', status: c.payoutAddress ? 'ok' : 'now',
      text: 'Endereço BCH próprio (Tangem, Trust), conta NiceHash com saldo em BTC e um pool solo que pague direto no seu endereço.',
      detail: c.payoutAddress ? 'Endereço configurado no robô.' : 'Configure o endereço em Mineração → Operar.' },
    { title: 'Decidir', status: c.level === 'go' ? 'now' : 'wait',
      text: 'Compare o preço do aluguel com o que o hash rende. Só entre com sinal verde (aluguel abaixo do teto).',
      detail: c.level ? 'Agora: ' + LEVELS[c.level].label.toLowerCase() + '.' : '' },
    { title: 'Dimensionar', status: 'info', text: 'No Planejar: potência, horas e orçamento. Veja a chance de bloco e a de perder tudo; defina o stop-loss antes.' },
    { title: 'Executar', status: c.orders ? 'ok' : 'wait', text: 'Em Operar, crie a ordem com preço até o teto e marque "robô gerencia".',
      detail: c.orders ? c.orders + ' ordem(ns) ativa(s).' : '' },
    { title: 'Acompanhar', status: c.mode === 'active' ? 'ok' : 'wait',
      text: 'O robô reavalia a cada 3 min: compra no alvo abaixo do teto, pausa acima dele e encerra quando a recompensa cai no seu endereço.',
      detail: c.mode ? 'Robô: ' + ({ off: 'desligado', observe: 'observando', active: 'ativo' }[c.mode]) + '.' : 'Backend não conectado.' },
    { title: 'Encerrar e registrar', status: 'info', text: 'A recompensa fica disponível após 100 blocos (~16 h). Registre a sessão no Diário, com as etiquetas do que você observou.' }
  ];
}

var MOMENTS = {
  funding: [
    'Spread que se mantém por dias (selo "Estável" ou o gráfico do Histórico) vale mais que um pico de minutos.',
    'Entre antes do próximo pagamento da perna short: cada pagamento perdido é renda perdida.',
    'Evite listings recentes e spreads marcados como "extremo": as regras e o preço mudam rápido.',
    'Saia quando o spread cair abaixo do break-even ou inverter, mesmo antes do fim do ciclo.',
    'Ciclos mais longos diluem as taxas: em 1 dia quase nada compensa; em 3 a 5 dias, sim.',
    'Cada perna tem a sua própria margem e pode ser liquidada sozinha: deixe folga nas duas exchanges (o risco mais citado em fóruns, junto com a inversão do funding).',
    'Exchanges pagam em horários diferentes: confira os dois próximos pagamentos antes de entrar e de sair.',
    'Transferir entre exchanges leva tempo: tenha saldo nas duas antes de abrir, para não ficar com uma perna só.'
  ],
  mining: [
    'Quando o aluguel fica abaixo do preço de empate. O gráfico de margem do robô mostra os horários em que isso acontece.',
    'Logo depois de uma alta forte da moeda: a dificuldade leva horas para acompanhar e o hash rende mais nesse intervalo.',
    'Quando a dificuldade está abaixo da média recente.',
    'Não são momentos (não mudam a chance por hash): rede "rápida", esforço ou luck alto, best share "quase", potência de quem achou o último bloco.',
    'Parar no bloco e stop-loss controlam o risco e o caixa; o retorno médio por dólar continua dependendo só do preço pago.',
    'Na NiceHash, um lance maior de outro comprador toma o hash da sua ordem: o preço de mercado muda ao longo do dia.',
    'Redes pequenas parecem render muito por hash, mas o hash alugado derruba a dificuldade e não há onde vender a moeda.'
  ]
};

var GLOSSARY = [
  ['Funding', 'Pagamento periódico entre quem está comprado (long) e vendido (short) num perpétuo. Positivo: o long paga o short.'],
  ['Short / Long', 'Short é a posição vendida (recebe o funding positivo); long é a comprada (paga). Na arbitragem, uma anula o risco de preço da outra.'],
  ['Perna', 'Cada lado da operação. Perp × Perp: short numa exchange e long em outra. Spot + Perp: compra à vista e short no perpétuo.'],
  ['Spread a.a.', 'Diferença de funding entre as pernas, anualizada (APR simples). 36,5% a.a. ≈ 0,1% por dia.'],
  ['Break-even', 'Tempo (ou spread mínimo) para o funding recebido pagar as taxas de entrada e saída.'],
  ['Maker / Taker', 'Maker deixa a ordem no livro e paga menos taxa; taker executa na hora e paga mais.'],
  ['Projeção', 'Conta feita com a taxa de agora supondo que ela não muda. O funding real muda a cada pagamento.'],
  ['PH/s', 'Petahash por segundo: unidade de potência de mineração. 1.000 PH/s = 1 EH/s.'],
  ['Hashprice / receita por PH', 'Quanto 1 PH/s rende em média por dia, em dólares. Padrão do mercado para comparar mineração.'],
  ['Dificuldade', 'Quão difícil é achar um bloco. Mais dificuldade = menos receita por PH. No BCH muda a cada bloco.'],
  ['Preço de empate', 'Preço do aluguel (BTC por EH/s por dia) em que o custo iguala a receita esperada.'],
  ['Teto', 'Preço de empate menos a sua margem mínima. O robô nunca paga acima dele.'],
  ['Lance', 'Preço que o robô oferece: um pouco acima do menor preço que está recebendo hash na NiceHash.'],
  ['Blocos esperados (λ)', 'Quantos blocos sairiam em média com aquela potência e duração. 0,5 = cerca de 39% de chance de ao menos um.'],
  ['Mineração solo', 'Você só recebe se a sua potência achar o bloco inteiro. Paga tudo ou nada: grande variação.'],
  ['Stop-loss', 'Gasto máximo por sessão sem achar bloco. Ao atingir, a ordem é encerrada.'],
  ['Merged mining', 'Minerar duas moedas com o mesmo hash ao mesmo tempo. No Scrypt, Litecoin e Dogecoin pagam juntos.'],
  ['Algoritmo', 'Tipo de cálculo de cada moeda (SHA-256, Scrypt...). Hash alugado de um algoritmo só serve para moedas dele.'],
  ['Sentimento (funding médio)', 'Média do funding de BTC, ETH e SOL. Muito alto: excesso de comprados alavancados; negativo: excesso de vendidos.'],
  ['Alerta de entrada', 'Uma oportunidade compensa e se mantém por duas leituras seguidas ou está estável no histórico de pagamentos.']
];

var FDC = {
  LEVELS: LEVELS, nf: nf, money: money, pctTxt: pctTxt, daysTxt: daysTxt, hoursTxt: hoursTxt,
  stability: stability, fundingVerdict: fundingVerdict, fundingSummary: fundingSummary,
  miningVerdict: miningVerdict, coinCompare: coinCompare, journey: journey, MOMENTS: MOMENTS, GLOSSARY: GLOSSARY
};
if (typeof module !== 'undefined' && module.exports) module.exports = FDC;
else root.FDC = FDC;
})(typeof window !== 'undefined' ? window : globalThis);
