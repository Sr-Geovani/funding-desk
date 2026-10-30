// Foto do livro de ordens SHA-256 da NiceHash, publicada junto com o site (o navegador não consegue ler a API direto: CORS).
// Uso: node scripts/snapshot-nicehash.js <arquivo-de-saida>
const fs = require('node:fs');
const path = require('node:path');
const FDM = require('../mining.js');

const out = process.argv[2] || '_site/data/nicehash.json';
const url = 'https://api2.nicehash.com/main/api/v2/hashpower/orderBook?algorithm=SHA256';

(async () => {
  let body;
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const markets = FDM.parseNiceHashBook(await r.json());
    body = { at: new Date().toISOString(), source: 'github-actions', url, markets };
  } catch (e) {
    // Sem dado novo não quebra o deploy: o painel mostra o erro e pede preço manual.
    body = { at: new Date().toISOString(), source: 'github-actions', url, markets: [], error: String(e.message || e) };
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(body));
  console.log(out, body.markets.length ? 'ok' : 'sem dados: ' + body.error);
})();
