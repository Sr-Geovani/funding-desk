// Outros fornecedores de hash SHA-256 além da NiceHash (pesquisa em docs/fornecedores-hash.md), só leitura.
// - Braiins Hashpower: livro de ofertas por preço (BTC/EH/dia), taxa 0% durante o beta, paga por hora o hash entregue.
//   Exige pool com extranonce2_size ≥ 7: a maioria dos pools de BCH usa 4 (conferir com stratumCheck).
// - MiningRigRentals: aluguel de máquinas com preço do dono; preço sugerido do SHA-256 bem acima do hashprice.
export const BRAIINS_FEE_PCT = 0; // beta; a Braiins avisa que pode mudar ao sair do beta

// Livro da Braiins → preço para receber hash agora (o menor lance que está recebendo), oferta e hash casado.
export function braiinsOf(book, stats) {
  const bids = (book && book.bids) || [], asks = (book && book.asks) || [];
  const matched = bids.filter((b) => b.hr_matched_ph > 0);
  if (!matched.length && !asks.length) return null;
  const sat = 1e8;
  return {
    matchEH: matched.length ? Math.min(...matched.map((b) => b.price_sat)) / sat : null, // BTC/EH/dia
    bestAskEH: asks.length ? Math.min(...asks.map((a) => a.price_sat)) / sat : null,
    availPH: stats && isFinite(stats.hash_rate_available_10m_ph) ? stats.hash_rate_available_10m_ph : asks.reduce((a, x) => a + (x.hr_available_ph || 0), 0),
    matchedPH: stats && isFinite(stats.hash_rate_matched_10m_ph) ? stats.hash_rate_matched_10m_ph : matched.reduce((a, x) => a + x.hr_matched_ph, 0),
    avgEH: stats && isFinite(stats.last_avg_price_sat) ? stats.last_avg_price_sat / sat : null,
    feePct: BRAIINS_FEE_PCT
  };
}

// MiningRigRentals /api/v2/info/algos/sha256 → BTC/EH/dia (a API dá BTC por PH por dia).
export function mrrOf(info) {
  const d = info && info.data, st = d && d.stats;
  if (!st) return null;
  const eh = (x) => (x && isFinite(+x.amount) ? +x.amount * (/ph/i.test(x.unit || '') ? 1000 : /th/i.test(x.unit || '') ? 1e6 : 1) : null);
  const ph = (h) => (h && isFinite(+h.hash) ? +h.hash * (/^eh/i.test(h.unit) ? 1000 : /^th/i.test(h.unit) ? 1e-3 : 1) : null);
  return { suggestedEH: eh(d.suggested_price), lowestEH: eh(st.prices && st.prices.lowest), lastEH: eh(st.prices && st.prices.last),
    availPH: ph(st.available && st.available.hash), rentedPH: ph(st.rented && st.rented.hash) };
}

// Confere se um pool aceita hash da Braiins: o mining.subscribe do Stratum devolve o extranonce2_size (precisa ≥ 7).
// Só lê: não envia usuário, senha nem shares. connectFn: connect() do Cloudflare (cloudflare:sockets) ou um falso nos testes.
export async function stratumCheck(host, port, connectFn, timeoutMs = 7000) {
  const connect = connectFn || (await import('cloudflare:sockets')).connect;
  let sock = null, timer = null;
  try {
    sock = connect({ hostname: host, port });
    const w = sock.writable.getWriter();
    await w.write(new TextEncoder().encode(JSON.stringify({ id: 1, method: 'mining.subscribe', params: ['funding-desk/1.0'] }) + '\n'));
    const rd = sock.readable.getReader(), dec = new TextDecoder();
    const read = (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) { let m; try { m = JSON.parse(line); } catch { continue; } if (m && m.id === 1) return m; }
        if (buf.length > 20000) break;
      }
      throw new Error('o pool fechou a conexão sem responder');
    })();
    const msg = await Promise.race([read, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`o pool não respondeu em ${timeoutMs / 1000} s`)), timeoutMs); })]);
    if (msg.error) throw new Error('o pool recusou: ' + JSON.stringify(msg.error).slice(0, 120));
    const res = msg.result || [], en2 = +res[2];
    if (!isFinite(en2)) throw new Error('resposta do pool sem extranonce2_size');
    return { ok: true, host, port, extranonce2Size: en2, extranonce1Bytes: typeof res[1] === 'string' ? res[1].length / 2 : null, braiins: en2 >= 7 };
  } finally {
    if (timer) clearTimeout(timer);
    try { if (sock) sock.close(); } catch { /* já fechado */ }
  }
}
