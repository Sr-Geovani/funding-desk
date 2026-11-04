// Leitura da rede Bitcoin Cash e cotações, feita pelo servidor.
// REST compatível com a API v2 do Bitcoin.com (padrão: ActorForth). Cotações: CoinGecko, com Kraken e Coinbase de reserva
// (a CoinGecko às vezes bloqueia pedidos vindos do Cloudflare).

export const DEFAULT_BCH_REST = 'https://rest.bch.actorforth.org/v2';
export const DEFAULT_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,bitcoin-cash&vs_currencies=usd';

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : null; };
// Fontes de cotação em ordem; a primeira que trouxer BTC e BCH vale.
export const PRICE_SOURCES = [
  { name: 'CoinGecko', get: async (get) => { const d = await get(DEFAULT_PRICE_URL); return { btcUsd: num(d.bitcoin && d.bitcoin.usd), bchUsd: num(d['bitcoin-cash'] && d['bitcoin-cash'].usd) }; } },
  { name: 'Kraken', get: async (get) => {
    const d = await get('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,BCHUSD'), r = d.result || {};
    const last = (k) => num(r[k] && r[k].c && r[k].c[0]);
    return { btcUsd: last('XXBTZUSD') || last('XBTUSD'), bchUsd: last('BCHUSD') };
  } },
  { name: 'Coinbase', get: async (get) => {
    const [b, c] = await Promise.all(['BTC', 'BCH'].map((x) => get('https://api.coinbase.com/v2/prices/' + x + '-USD/spot')));
    return { btcUsd: num(b.data && b.data.amount), bchUsd: num(c.data && c.data.amount) };
  } }
];

// Texto legível da assinatura do minerador no coinbase (ex.: "solopool.org", "/BlockSniper/").
export function tagFrom(hex) {
  if (!hex) return '';
  let s = '';
  for (let i = 0; i + 1 < hex.length; i += 2) { const c = parseInt(hex.substr(i, 2), 16); s += c >= 32 && c < 127 ? String.fromCharCode(c) : '\u0000'; }
  return s.split('\u0000').filter((x) => x.length >= 4 && /[A-Za-z]{3}/.test(x)).join(' ').trim().slice(0, 60);
}

export function normAddr(a) {
  return String(a || '').trim().toLowerCase().replace(/^bitcoincash:/, '');
}

export const DEFAULT_HASKOIN = ['https://api.haskoin.com/bch', 'https://api.blockchain.info/haskoin-store/bch'];
// Dificuldade a partir do campo "bits" do cabeçalho do bloco (alvo compacto).
export function bitsToDifficulty(bits) {
  const exp = bits >>> 24, mant = bits & 0xffffff;
  return (0xffff * Math.pow(256, 0x1d - 3)) / (mant * Math.pow(256, exp - 3));
}
export function createChain({ base = DEFAULT_BCH_REST, haskoin = null, priceUrl = DEFAULT_PRICE_URL, fetchFn = fetch }) {
  async function get(u) {
    const r = await fetchFn(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + u.replace(/\?.*/, ''));
    return r.json();
  }
  const haskoinList = () => (Array.isArray(haskoin) ? haskoin : haskoin ? [haskoin] : []);
  const srcName = (u) => (/blockchain\.info/.test(u) ? 'blockchain.com' : /haskoin\.com/.test(u) ? 'haskoin' : u.replace(/^https?:\/\//, '').split('/')[0]);
  return {
    // Altura, dificuldade e horário do último bloco. Pergunta ao mesmo tempo a todas as instâncias da Haskoin (pública e
    // do blockchain.com) e fica com o bloco mais novo; a ActorForth fica de reserva (em 04/11 ela atrasou ~2,5 min e deu
    // HTTP 522 por horas). `seen` traz a altura que cada fonte mostrou, para medir qual vê o bloco primeiro.
    info: async () => {
      const fails = [], hs = haskoinList();
      const got = await Promise.all(hs.map(async (u) => {
        try {
          const b = await get(u + '/block/best?notx=true');
          if (b.height > 0 && b.bits) return { height: b.height, difficulty: bitsToDifficulty(b.bits), time: b.time * 1000, src: srcName(u) };
          fails.push(srcName(u) + ': sem dados');
        } catch (e) { fails.push(srcName(u) + ': ' + (e.message || e)); }
        return null;
      }));
      const ok = got.filter(Boolean).sort((a, b) => b.height - a.height);
      if (ok.length) return Object.assign({}, ok[0], { seen: Object.fromEntries(ok.map((x) => [x.src, x.height])) });
      try {
        const d = await get(base + '/blockchain/getBlockchainInfo');
        return { height: d.blocks, difficulty: d.difficulty, src: 'actorforth', seen: { actorforth: d.blocks } };
      } catch (e) { fails.push(e.message || String(e)); throw new Error(fails.join('; ')); }
    },
    mempool: async () => { const d = await get(base + '/blockchain/getMempoolInfo'); return { tx: d.size, bytes: d.bytes }; },
    // Quem recebeu a recompensa do bloco: saídas da transação coinbase.
    coinbase: async (height) => {
      for (const hk of haskoinList()) {
        try {
          const a = await get(hk + '/block/height/' + height + '?notx=false'), b = Array.isArray(a) ? a[0] : a;
          const tx = await get(hk + '/transaction/' + b.tx[0]);
          const outs = (tx.outputs || []).map((o) => ({ value: (o.value || 0) / 1e8, addrs: o.address ? [normAddr(o.address)] : [] }));
          return { height, hash: b.hash, time: b.time * 1000, difficulty: bitsToDifficulty(b.bits), txid: b.tx[0], outs, size: b.size, txs: (b.tx || []).length,
            tag: tagFrom(tx.inputs && tx.inputs[0] && tx.inputs[0].sigscript) };
        } catch (e) { /* tenta a próxima instância e depois a ActorForth */ }
      }
      const b = await get(base + '/block/detailsByHeight/' + height);
      const tx = await get(base + '/transaction/details/' + b.tx[0]);
      const outs = (tx.vout || []).map((o) => ({
        value: parseFloat(o.value),
        addrs: ((o.scriptPubKey && (o.scriptPubKey.cashAddrs || o.scriptPubKey.addresses)) || []).map(normAddr)
      }));
      return { height, hash: b.hash, time: b.time * 1000, difficulty: b.difficulty, txid: b.tx[0], outs,
        size: b.size, txs: b.nTx || (b.tx || []).length, tag: tagFrom(tx.vin && tx.vin[0] && tx.vin[0].coinbase) };
    },
    prices: async () => {
      if (priceUrl !== DEFAULT_PRICE_URL) { // fonte fixa (testes ou configuração própria)
        const d = await get(priceUrl);
        return { btcUsd: d.bitcoin && d.bitcoin.usd, bchUsd: d['bitcoin-cash'] && d['bitcoin-cash'].usd, src: 'personalizada' };
      }
      const fails = [];
      for (const s of PRICE_SOURCES) {
        try {
          const p = await s.get(get);
          if (p.btcUsd && p.bchUsd) return Object.assign(p, { src: s.name });
          fails.push(s.name + ': resposta sem preço');
        } catch (e) { fails.push(s.name + ': ' + (e.message || e)); }
      }
      throw new Error('nenhuma fonte de cotação respondeu (' + fails.join('; ') + ')');
    }
  };
}

// Valor (BCH) pago ao endereço na coinbase; 0 se o bloco não é seu.
export function paidTo(cb, address) {
  const a = normAddr(address);
  if (!a) return 0;
  return cb.outs.filter((o) => o.addrs.includes(a)).reduce((s, o) => s + o.value, 0);
}
