// Fotos de mercado publicadas junto com o site (o navegador não lê NiceHash nem WhatToMine direto: CORS).
// Uso: node scripts/snapshot-nicehash.js <pasta-de-saida>   → nicehash.json (SHA-256: mercado SHA256ASICBOOST) e market.json (todos os algoritmos)
const fs = require('node:fs');
const path = require('node:path');
const FDM = require('../mining.js');
const FDR = require('../radar.js');

const outDir = process.argv[2] || '_site/data';
const NH = 'https://api2.nicehash.com/main/api/v2/hashpower/orderBook?size=1000&algorithm='; // sem size: só as 100 mais caras
const get = async (u) => { const r = await fetch(u, { headers: { accept: 'application/json', 'user-agent': 'funding-desk/1.0' } }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); };
// Mantém só o necessário do livro (preço, velocidade aceita, ativa) para o arquivo ficar pequeno.
const slim = (d) => { for (const m of Object.values(d.stats || {})) m.orders = (m.orders || []).map((o) => ({ price: o.price, acceptedSpeed: o.acceptedSpeed, alive: o.alive, type: o.type, rigsCount: o.rigsCount })); return d; };

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const at = new Date().toISOString(), errors = [];
  const books = {};
  for (const a of FDR.ALGOS) {
    try { books[a.nh] = slim(await get(NH + a.nh)); } catch (e) { errors.push(a.nh + ': ' + e.message); }
  }
  let wtm = null;
  try {
    const w = await get('https://whattomine.com/asic.json');
    const keep = ['tag', 'name', 'algorithm', 'block_time', 'block_reward', 'nethash', 'exchange_rate', 'exchange_rate_vol', 'lagging'];
    wtm = { coins: {} };
    for (const [k, c] of Object.entries(w.coins || {})) wtm.coins[k] = Object.fromEntries(keep.map((f) => [f, c[f]]).concat([['name', k]]));
  } catch (e) { errors.push('whattomine: ' + e.message); }
  const sha = books.SHA256ASICBOOST ? FDM.parseNiceHashBook(books.SHA256ASICBOOST) : [];
  fs.writeFileSync(path.join(outDir, 'nicehash.json'), JSON.stringify({ at, source: 'github-actions', markets: sha, error: sha.length ? undefined : errors.join('; ') }));
  fs.writeFileSync(path.join(outDir, 'market.json'), JSON.stringify({ at, source: 'github-actions', books, wtm, errors }));
  console.log(outDir, 'livros:', Object.keys(books).length, 'whattomine:', wtm ? Object.keys(wtm.coins).length : 0, errors.length ? 'erros: ' + errors.join('; ') : '');
})();
