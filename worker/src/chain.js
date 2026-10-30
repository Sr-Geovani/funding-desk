// Leitura da rede Bitcoin Cash e cotações, feita pelo servidor.
// REST compatível com a API v2 do Bitcoin.com (padrão: ActorForth). Cotações: CoinGecko.

export const DEFAULT_BCH_REST = 'https://rest.bch.actorforth.org/v2';
export const DEFAULT_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,bitcoin-cash&vs_currencies=usd';

export function normAddr(a) {
  return String(a || '').trim().toLowerCase().replace(/^bitcoincash:/, '');
}

export function createChain({ base = DEFAULT_BCH_REST, priceUrl = DEFAULT_PRICE_URL, fetchFn = fetch }) {
  async function get(u) {
    const r = await fetchFn(u, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + u.replace(/\?.*/, ''));
    return r.json();
  }
  return {
    info: async () => {
      const d = await get(base + '/blockchain/getBlockchainInfo');
      return { height: d.blocks, difficulty: d.difficulty };
    },
    // Quem recebeu a recompensa do bloco: saídas da transação coinbase.
    coinbase: async (height) => {
      const b = await get(base + '/block/detailsByHeight/' + height);
      const tx = await get(base + '/transaction/details/' + b.tx[0]);
      const outs = (tx.vout || []).map((o) => ({
        value: parseFloat(o.value),
        addrs: ((o.scriptPubKey && (o.scriptPubKey.cashAddrs || o.scriptPubKey.addresses)) || []).map(normAddr)
      }));
      return { height, time: b.time * 1000, difficulty: b.difficulty, txid: b.tx[0], outs };
    },
    prices: async () => {
      const d = await get(priceUrl);
      return { btcUsd: d.bitcoin && d.bitcoin.usd, bchUsd: d['bitcoin-cash'] && d['bitcoin-cash'].usd };
    }
  };
}

// Valor (BCH) pago ao endereço na coinbase; 0 se o bloco não é seu.
export function paidTo(cb, address) {
  const a = normAddr(address);
  if (!a) return 0;
  return cb.outs.filter((o) => o.addrs.includes(a)).reduce((s, o) => s + o.value, 0);
}
