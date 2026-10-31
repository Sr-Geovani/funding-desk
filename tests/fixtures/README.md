# Fixtures

- `*.real.json`: respostas reais (Hyperliquid, Blockchair BCH, livro de ordens NiceHash SHA-256) (recortadas para poucas moedas), capturadas em 2026-10-30 12:00 UTC.
- `binance-*.synthetic.json` e `bybit-*.synthetic.json`: **sintéticos**, montados a partir do formato documentado das APIs.
  Binance e Bybit bloqueiam IPs dos EUA (HTTP 451 e 403), de onde os testes foram escritos. Substitua por respostas
  reais quando possível. Em 2026-10-30 o `diagnostico.html` rodado num iPhone no Brasil confirmou que todos os campos usados
  existem nas respostas reais (premiumIndex, ticker/24hr, fundingInfo com `fundingIntervalHours`, fundingRate; tickers,
  instruments-info com `fundingInterval` em uma página só, funding/history) e que o CORS libera o navegador.
- `braiins-orderbook.real.json`, `braiins-stats.real.json`: Braiins Hashpower `/v1/spot/orderbook` e `/v1/spot/stats` (31/10/2026).
- `mrr-sha256.real.json`: MiningRigRentals `/api/v2/info/algos/sha256?currency=BTC` (31/10/2026).
- Frentes (31/10/2026): `lighter-funding.real.json` (recortado), `bitfinex-funding-tickers.real.json`, `deribit-btc-futures.real.json`,
  `ethena-yield.real.json`, `zpool-status.real.json` (sha256 e scrypt), `mercadobitcoin-tickers.real.json`, `bcb-ptax.real.json`.
- `wtm-gpu.real.json`: WhatToMine `coins.json` (GPU), recortado (31/10/2026).
- Lastro de mercado (31/10/2026): `upbit-ticker.real.json`, `mercadobitcoin-btc.real.json`, `kraken-ticker.real.json`,
  `frankfurter-usd.real.json`, `criptoya-dolar.real.json`, `polymarket-gamma.real.json` (6 mercados, campos usados),
  `defillama-steth.real.json`.
- Fora de cripto (31/10/2026): `bcb-focus-ipca.real.json` (Focus, IPCA anual), `ust-tbill.real.csv` (T-bills, 3 linhas).
