// DeFi: arbitragem de resgate e cunhagem (08/11). Tokens de rendimento têm um valor de resgate lido no próprio contrato
// (quanto o protocolo devolve) e um preço na DEX. Quando os dois se afastam:
//   prêmio (DEX acima do valor): cunha no protocolo pelo valor (depósito, na hora) e vende na DEX → ganho na hora;
//   desconto (DEX abaixo): compra na DEX e resgata no protocolo → ganho só depois da fila de resgate (dias), comparado
//   com o CDI pelo tempo parado.
// Protocolos: ether.fi (weETH), Lido (wstETH), Rocket Pool (rETH), Ethena (sUSDe), Sky (sUSDS e sDAI) e a conversão
// 1:1 DAI ↔ USDS da Sky. Preço da DEX pelo CoW Swap (Ethereum), já com a taxa e o gás descontados na cotação.
// Valor de resgate lido no contrato por um nó público da Ethereum (só leitura). Só dados públicos; nada é executado.
const W = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const T = {
  weETH: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', rETH: '0xae78736Cd615f374D3085123A210448E74Fc6393',
  USDe: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3', sUSDe: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', USDS: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
  sUSDS: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD', DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F', sDAI: '0x83F20F44975D03b1b09e64809B757c47f942BEeA',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
};
const ONE = '0x07a2d13a' + (10n ** 18n).toString(16).padStart(64, '0'); // convertToAssets(1e18) de cofres ERC-4626
// rate: chamada no contrato que dá o valor de 1 token na moeda base. mintDays/redeemDays: espera para cunhar e resgatar.
export const DEFI_TOKENS = [
  { k: 'weETH', proto: 'ether.fi', base: 'WETH', baseAddr: W, addr: T.weETH, call: '0x679aefce', amt: 5n * 10n ** 18n, redeemDays: 7, note: 'resgate pela fila de saque da ether.fi (dias); cunhar = depositar ETH e embrulhar (na hora)' },
  { k: 'wstETH', proto: 'Lido', base: 'WETH', baseAddr: W, addr: T.wstETH, call: '0x035faf82', amt: 5n * 10n ** 18n, redeemDays: 5, note: 'resgate pela fila da Lido (1 a 5 dias); cunhar = depositar ETH (na hora)' },
  { k: 'rETH', proto: 'Rocket Pool', base: 'WETH', baseAddr: W, addr: T.rETH, call: '0xe6aa216c', amt: 5n * 10n ** 18n, redeemDays: 1, note: 'resgate depende da liquidez do pool de depósito da Rocket Pool; cunhar tem limite de depósito' },
  { k: 'sUSDe', proto: 'Ethena', base: 'USDe', baseAddr: T.USDe, addr: T.sUSDe, call: ONE, amt: 10000n * 10n ** 18n, redeemDays: 7, note: 'resgate: espera de 7 dias da Ethena; cunhar = depositar USDe (na hora). USDe por dólar só para participantes autorizados' },
  { k: 'sUSDS', proto: 'Sky', base: 'USDS', baseAddr: T.USDS, addr: T.sUSDS, call: ONE, amt: 10000n * 10n ** 18n, redeemDays: 0, note: 'cofre de poupança da Sky: depósito e saque na hora' },
  { k: 'sDAI', proto: 'Sky (Maker)', base: 'DAI', baseAddr: T.DAI, addr: T.sDAI, call: ONE, amt: 10000n * 10n ** 18n, redeemDays: 0, note: 'cofre de poupança do DAI: depósito e saque na hora' },
  { k: 'USDS', proto: 'Sky (conversor 1:1)', base: 'DAI', baseAddr: T.DAI, addr: T.USDS, fixed: 1, amt: 10000n * 10n ** 18n, redeemDays: 0, note: 'DAI e USDS se convertem 1:1 no contrato da Sky, na hora' }
];
export const DEFI_RULES = { minInstantPct: 0.1, minAnnualPct: 13.25, keepSeries: 2000 }; // régua do resgate: CDI depois do IR em dólar (lab)

const cowBody = (sell, buy, amt) => ({ sellToken: sell, buyToken: buy, from: '0x0000000000000000000000000000000000000001', receiver: '0x0000000000000000000000000000000000000001', kind: 'sell',
  sellAmountBeforeFee: amt.toString(), appData: '0x' + '0'.repeat(64), signingScheme: 'eip712', partiallyFillable: false });
// Fontes: um pedido em lote ao nó (todas as taxas de resgate) + duas cotações por token (vender e comprar) + USDC/USDT.
export function defiSources() {
  // nós públicos em ordem: se um recusar (limite por IP, comum na Cloudflare), tenta o próximo
  const rpc = { k: 'rpc', url: 'https://ethereum-rpc.publicnode.com', urls: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth', 'https://rpc.mevblocker.io', 'https://eth-mainnet.public.blastapi.io', 'https://mainnet.gateway.tenderly.co'], body: DEFI_TOKENS.filter((t) => t.call).map((t, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: t.addr, data: t.call }, 'latest'] })) };
  const cow = [];
  for (const t of DEFI_TOKENS) { cow.push({ k: t.k + ':sell', url: 'https://api.cow.fi/mainnet/api/v1/quote', body: cowBody(t.addr, t.baseAddr, t.amt) }); cow.push({ k: t.k + ':buy', url: 'https://api.cow.fi/mainnet/api/v1/quote', body: cowBody(t.baseAddr, t.addr, t.amt) }); }
  cow.push({ k: 'USDC:sell', url: 'https://api.cow.fi/mainnet/api/v1/quote', body: cowBody(T.USDC, T.USDT, 10000n * 10n ** 6n) }, { k: 'USDC:buy', url: 'https://api.cow.fi/mainnet/api/v1/quote', body: cowBody(T.USDT, T.USDC, 10000n * 10n ** 6n) });
  return [rpc].concat(cow);
}

// Junta: valor de resgate × preço de venda e de compra na DEX → prêmio/desconto, ação e ganho líquido.
export function defiRead(results, { rules = DEFI_RULES, now = Date.now() } = {}) {
  const by = Object.fromEntries((results || []).filter((r) => r && r.ok).map((r) => [r.src.k, r.json])), rows = [];
  const rates = {}; const rp = by.rpc;
  if (Array.isArray(rp)) DEFI_TOKENS.filter((t) => t.call).forEach((t, i) => { const x = rp.find((y) => y.id === i); if (x && x.result && x.result !== '0x') rates[t.k] = Number(BigInt(x.result)) / 1e18; });
  const out = (k) => { const q = by[k] && by[k].quote; return q ? Number(BigInt(q.buyAmount)) : null; };
  for (const t of DEFI_TOKENS) {
    const nav = t.fixed || rates[t.k], amt = Number(t.amt), sell = out(t.k + ':sell'), buy = out(t.k + ':buy');
    if (!(nav > 0) || !(sell > 0) || !(buy > 0)) { rows.push({ k: t.k, proto: t.proto, base: t.base, err: !(nav > 0) ? 'valor de resgate sem leitura' : 'sem cotação na DEX' }); continue; }
    const sellPx = sell / amt, buyPx = amt / buy; // em moeda base por token, já com taxa e gás da cotação
    const prem = (sellPx / nav - 1) * 100, disc = (1 - buyPx / nav) * 100; // prêmio: vende acima do valor; desconto: compra abaixo
    const days = t.redeemDays, annual = days > 0 ? disc * 365 / days : null;
    const act = prem >= rules.minInstantPct ? 'cunhar e vender agora' : disc > 0 && (days === 0 ? disc >= rules.minInstantPct : annual >= rules.minAnnualPct) ? (days ? `comprar e resgatar (${days} dias)` : 'comprar e resgatar agora') : null;
    rows.push({ k: t.k, proto: t.proto, base: t.base, nav: +nav.toFixed(6), sellPx: +sellPx.toFixed(6), buyPx: +buyPx.toFixed(6), premPct: +prem.toFixed(4), discPct: +disc.toFixed(4), days, annualPct: annual !== null ? +annual.toFixed(2) : null, act, note: t.note });
  }
  const s = out('USDC:sell'), b = out('USDC:buy'); // USDC/USDT na Ethereum pelo CoW (entra no mapa de stablecoins)
  const quote = s > 0 && b > 0 && 1e10 / b >= s / 1e10 ? { v: 'cow', pair: 'USDC/USDT', bid: s / 1e10, ask: 1e10 / b, bq: 10000, aq: 10000, dex: true, gasUsd: 0, at: now } : null;
  return { rows, quote };
}

export function defiStep(prev, { now, results, errs = {}, rules = DEFI_RULES }) {
  const D = prev && prev.since ? JSON.parse(JSON.stringify(prev)) : { since: now, scans: 0, counts: {}, series: [], paper: { trades: 0, netUsd: 0, last: [] } };
  const { rows, quote } = defiRead(results, { rules, now }), events = [];
  if (!(D.repairs || []).includes('cap-1110')) { // tira do papel o que passou do plausível antes da trava
    const bad = (D.paper.last || []).filter((x) => x.pct > 1);
    for (const x of bad) { D.paper.trades--; D.paper.netUsd -= x.usd; }
    D.paper.last = (D.paper.last || []).filter((x) => !(x.pct > 1));
    for (const c of Object.values(D.counts)) { c.maxPrem = Math.min(c.maxPrem, 3); c.maxDisc = Math.min(c.maxDisc, 3); }
    D.repairs = (D.repairs || []).concat(['cap-1110']); if (bad.length) D.repaired = { at: now, removed: bad };
  }
  D.scans++;
  // Plausível (10/11): stable contra stable não se afasta mais de 1% do valor de resgate sem notícia; token de ETH, 3%.
  // Acima disso é cotação com defeito (08/11: o CoW cotou USDS 4% acima do DAI, que se converte 1:1, e o papel contou
  // +US$401,73). Confirmação = a leitura anterior do mesmo token perto do mesmo valor (até 0,25 ponto), não só "positiva".
  const prevVals = D.lastVals || {}; D.lastVals = {};
  for (const r of rows) {
    if (r.err) continue;
    const cap = r.base === 'WETH' ? 3 : 1, dev = Math.max(r.premPct, r.discPct);
    if (dev > cap) { r.suspect = true; r.act = null; }
    D.lastVals[r.k] = dev;
    const c = D.counts[r.k] || (D.counts[r.k] = { n: 0, prem: 0, disc: 0, maxPrem: -Infinity, maxDisc: -Infinity, suspect: 0 });
    if (r.suspect) { c.suspect = (c.suspect || 0) + 1; continue; }
    c.n++; if (r.premPct >= rules.minInstantPct) c.prem++; if (r.act && r.act.startsWith('comprar')) c.disc++;
    c.maxPrem = Math.max(c.maxPrem, r.premPct); c.maxDisc = Math.max(c.maxDisc, r.discPct);
    // papel: só o ganho na hora (cunhar e vender, ou comprar e resgatar sem espera), US$10.000 por vez, confirmado na leitura anterior
    const instant = r.premPct >= rules.minInstantPct ? r.premPct : r.days === 0 && r.discPct >= rules.minInstantPct ? r.discPct : null;
    if (instant !== null && (D.lastAct || []).includes(r.k) && prevVals[r.k] !== undefined && Math.abs(prevVals[r.k] - dev) <= 0.25) {
      const usd = 10000 * instant / 100; D.paper.trades++; D.paper.netUsd += usd;
      D.paper.last = [{ t: now, k: r.k, act: r.act, pct: instant, usd: +usd.toFixed(2) }].concat(D.paper.last).slice(0, 30);
      events.push(`DeFi (papel): ${r.k} (${r.proto}) — ${r.act}: ${instant.toFixed(3).replace('.', ',')}% em US$10.000 → +US$${usd.toFixed(2).replace('.', ',')}`);
    }
  }
  D.lastAct = rows.filter((r) => r.act).map((r) => r.k);
  D.series.push([now].concat(rows.map((r) => (r.err ? null : Math.max(r.premPct, r.discPct)))));
  if (D.series.length > rules.keepSeries) D.series.splice(0, D.series.length - rules.keepSeries);
  D.now = { at: now, rows, errs, quote };
  D.lastTs = now;
  return { defi: D, events };
}
