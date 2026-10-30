// Cloudflare Worker: proxy mínimo, só GET, só dados públicos de mercado. Sem chaves, sem segredos, sem logs de usuário.
// Rotas: /binance/fapi/v1/<endpoint>?...  e  /bybit/v5/market/<endpoint>?...
const UPSTREAM = { binance: 'https://fapi.binance.com', bybit: 'https://api.bybit.com' };
const ALLOW = {
  binance: /^\/fapi\/v1\/(premiumIndex|ticker\/24hr|fundingInfo|fundingRate|exchangeInfo)$/,
  bybit: /^\/v5\/market\/(tickers|instruments-info|funding\/history)$/
};
// Restrinja ao domínio do seu painel (ex.: 'https://seu-usuario.github.io'). '*' aceita qualquer origem.
const ALLOWED_ORIGIN = '*';

export default {
  async fetch(req) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors });
    const url = new URL(req.url);
    const m = /^\/(binance|bybit)(\/.*)$/.exec(url.pathname);
    if (!m || !ALLOW[m[1]].test(m[2])) return new Response('not found', { status: 404, headers: cors });
    const up = await fetch(UPSTREAM[m[1]] + m[2] + url.search, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 15, cacheEverything: true } // 15 s de cache na borda poupa o limite de requisições
    });
    const h = new Headers(cors);
    h.set('content-type', up.headers.get('content-type') || 'application/json');
    h.set('cache-control', 'public, max-age=15');
    return new Response(up.body, { status: up.status, headers: h });
  }
};
