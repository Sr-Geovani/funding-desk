# Pesquisa global: funding, mineração com hash alugado e players

Levantamento de 30/10/2026 para orientar o copiloto do Funding Desk. Buscas em português, inglês, espanhol, russo,
chinês e coreano, mais checagem técnica direta nas APIs e nos sites. **Ressalva:** os buscadores devolveram sobretudo
material de exchanges, blogs e agregadores; relatos de usuários em fóruns (Reddit, Bitcointalk, Habr) apareceram pouco.
Onde a fonte é promocional, está indicado.

## 1. Arbitragem de funding: o que a pesquisa diz em todos os idiomas

| Ponto | O que as fontes dizem | Como o painel aplica |
|---|---|---|
| Funding que inverte | Modo de falha nº 1 (Sharpe, Ledger, Kraken, guias em PT/ES/RU/ZH/KO) | Selo de estabilidade (72 h de pagamentos), alerta de saída quando a posição fica abaixo do break-even ou inverte |
| Liquidação de uma perna | Cada exchange tem margem própria; um pavio pode liquidar uma perna (fontes em ES e ZH, NDA Trade) | Momentos: deixar folga nas duas exchanges; regra de 2x e 30% de margem livre |
| Horários de pagamento diferentes | Calcular bem os horários de cada plataforma (fontes em ES) | Contagem regressiva por perna; momento "confira os dois próximos pagamentos" |
| Transferência entre exchanges | Atraso expõe uma perna sozinha (fontes em KO) | Momento: ter saldo nas duas antes de abrir |
| Taxa alta e persistente | Escolher moedas com taxa alta e duradoura, não picos (fontes em ZH e RU: decidir pelo histórico) | Alerta de entrada só com persistência (duas leituras) ou histórico estável |
| Liquidez | Em moedas pequenas, o slippage pode comer um dia de funding (Arbitrage Scanner, fontes em ZH) | Filtro de volume e open interest; mapa de funding ignora moedas abaixo do volume mínimo |
| Contraparte | O limite real costuma ser o risco da exchange (Kingfisher) | Diversificar exchanges; registro auditável no Diário |
| Retorno | Guias falam de 10–15% a.a. líquido em mercado favorável e 0–5% em mercado neutro (Arbitrage Scanner) | Retorno sempre mostrado como projeção, com custos |
| Rebalanceamento | Revisar o delta e rebalancear se passar de ±5% do nocional (guia CoinMarketCap Academy) | Custo de rebalanceamento entra no cálculo do ciclo |

**Sentimento:** funding médio muito alto nos majors indica excesso de comprados alavancados (risco de queda em cascata);
negativo indica excesso de vendidos (risco de alta rápida). O Radar mostra isso a partir de BTC, ETH e SOL.

## 2. Mineração com hash alugado

| Ponto | O que as fontes dizem | Como o painel aplica |
|---|---|---|
| Sorte | Cada hash é independente; "a rede está devendo" é a falácia do jogador (Bitcointalk, Hashrate Index) | Copiloto marca esforço, luck e best share como "não decide" |
| Ajuste do BCH (ASERT) | Feito para reduzir as janelas de quem entra e sai (especificação BCH, Ilie et al.) | Padrões por horário medem o efeito real em vez de supor |
| Mercados de hash | NiceHash: livro de ordens com hash de muitos vendedores; MiningRigRentals: máquinas específicas, direto do dono; Braiins: só SHA-256, com entrega garantida | Mapa de players; mapa de mineração usa o livro da NiceHash |
| Lance | Um lance maior de outro comprador toma o seu hash (NiceHash, Braiins) | Robô reavalia a cada 3 min; aviso de livro raso |
| Scrypt | LTC e DOGE são minerados juntos (merged); LiteSolo faz solo mesclado e aceita NiceHash (1% de taxa, MiningBoard) | Mapa soma LTC + DOGE no Scrypt |
| Redes pequenas | Parecem render mais por hash, mas o hash alugado derruba a dificuldade e falta liquidez | Moeda com menos de 10 BTC/dia de volume fica fora da opção principal |
| Dias quentes | Em dias quietos, minerar no pool rende mais; em dias "quentes" o aluguel pode pagar 2–3x (cryptotrade.wiki) | Alertas de cruzamento de margem e de alta de preço |

## 3. Players (mapa no Radar → "Onde operar")

Os sites foram conferidos em 30/10/2026 (responderam, exceto quando indicado no painel). Funding no painel: Binance,
Bybit, OKX, Bitget, Gate e Hyperliquid. Próximos: dYdX (API com CORS), MEXC e KuCoin (precisam do backend).
Hash: NiceHash (no painel), MiningRigRentals e Braiins Hashpower. Pools solo: BlockSniper (BCH), 2Miners Solo BCH, CKPool
Solo e Public Pool (BTC), mkpool, LiteSolo (LTC + DOGE) e Kryptex. Dados: CoinGlass, WhatToMine, Hashrate Index,
mempool.space, MiningPoolStats e MiningBoard.

## 4. Lacunas (não cobertas pela pesquisa)

- Relatos de primeira mão em fóruns, em quantidade suficiente para medir resultados reais.
- Tributação no Brasil e regras locais de cada exchange (KYC, disponibilidade).
- Histórico público de preços da NiceHash por hora: o painel passa a montar o próprio (backend a cada 15 min).

## 5. Roteiro até "lastrear e executar"

1. **Hoje:** o painel lê funding de 6 exchanges e mineração de 9 algoritmos, gera alertas (no aparelho e no backend,
   com Telegram) e executa ordens na NiceHash pelo robô (modos observar/ativo, teto no preço de empate, parada no bloco).
2. **Funding executado:** ordens de entrada e saída nas duas pernas exigem chaves de trade das exchanges no backend.
   Binance e Bybit bloqueiam servidores nos EUA; o executor precisa rodar em servidor no Brasil (ex.: VPS em São Paulo).
   Regras: as duas pernas ao mesmo tempo, mesmo tamanho, cancelamento se uma não executar, limites por moeda e por dia.
3. **Mais fontes:** dYdX, MEXC e KuCoin; MiningRigRentals e Braiins no mapa de hash; pools solo de LTC/DOGE e BSV no robô.

## Fontes

Funding: [CoinMarketCap Academy](https://coinmarketcap.com/academy/article/crypto-delta-neutral-strategy-2026) ·
[Ethena (eco.com)](https://eco.com/support/en/articles/15254002-ethena-usde-and-susde-2026-delta-neutral-yield) ·
[Kraken](https://www.kraken.com/learn/futures-trading-funding-rate-arbitrage) ·
[Kraken (TW)](https://www.kraken.com/tw/learn/futures-trading-funding-rate-arbitrage) ·
[Kraken (IN)](https://www.kraken.com/in/learn/futures-trading-funding-rate-arbitrage) ·
[BJF Trading Group](https://bjftradinggroup.com/funding-rate-arbitrage/) ·
[NDA Trade](https://nda-trade.com/blog/funding-rate-arbitrage-risks) ·
[CryptoMathTools](https://cryptomathtools.com/guides/crypto-funding-rate-explained/) ·
[Arbitrage Scanner](https://arbitragescanner.io/blog/crypto-funding-rate-arbitrage-guide) ·
[Arbiscreen](https://arbiscreen.com/delta-neutral-strategies) ·
[TradingView Hub](https://www.tv-hub.org/guide/market-neutral-strategy-crypto) ·
[OneKey (PT, promocional)](https://onekey.so/blog/pt/ecosystem/no-kyc-funding-rate-strategy/) ·
[OneKey (DE)](https://onekey.so/blog/de/ecosystem/no-kyc-funding-rate-strategy/) ·
[OneKey (ES)](https://onekey.so/blog/es/ecosystem/no-kyc-funding-rate-strategy/) ·
[OneKey (FR)](https://onekey.so/blog/fr/ecosystem/funding-rate-arbitrage-no-kyc/) ·
[OneKey (KO)](https://onekey.so/blog/ko/ecosystem/hyperliquid-funding-rate-arbitrage/) ·
[OneKey (ciclos)](https://onekey.so/blog/ecosystem/long-term-perps-funding-cycles/) ·
[OneKey (Hyperliquid)](https://onekey.so/blog/ecosystem/hyperliquid-delta-neutral-strategies/) ·
[Binance Smart Arbitrage (BR)](https://www.binance.com/br/smart-arbitrage) ·
[Binance Smart Arbitrage (pt-BR)](https://www.binance.com/pt-BR/smart-arbitrage) ·
[ForkLog](https://forklog.com/en/stop-guessing-bitcoins-price-a-guide-to-delta-neutral-strategies/) ·
[ForkLog (notícia)](https://forklog.com/en/news/stop-guessing-bitcoins-price-a-guide-to-delta-neutral-strategies) ·
[ForkLog (p=92881)](https://forklog.com/en/?p=92881) ·
[Athenum](https://athenum.mataroa.blog/blog/funding-rate-arbitrage-how-the-perp-spot-basis-pays-and-when-it-does-not/) ·
[Amberdata](https://blog.amberdata.io/the-ultimate-guide-to-funding-rate-arbitrage-amberdata) ·
[Otomato](https://otomato.xyz/tools/funding-rate-arbitrage) ·
[Teletype (RU)](https://teletype.in/@yung_hodler/arbitrage_crypto_spot_futures) ·
[Teletype (RU, fandinga)](https://teletype.in/@f_vspm/X0XeRKRws4T) ·
[finance.mail.ru](https://finance.mail.ru/card/arbitrazh-69218224/) ·
[Investfuture: arbitragem](https://investfuture.ru/articles/sdelka-arbitra-zh-na-ya) ·
[Investfuture: tipos e riscos](https://investfuture.ru/articles/arbitrazh-chto-eto-takoe-tipy-mekhanizmy-riski-i-primery-iz-praktiki) ·
[Investfuture: operações](https://investfuture.ru/articles/arbitra-zh-nye-operats-ii) ·
[Investfuture: bolsa](https://investfuture.ru/articles/arbitrazh-birzhevoy) ·
[Investfuture: sdelki](https://investfuture.ru/articles/arbitra-zh-nye-sdelki) ·
[SozAI (RU)](https://sozai.app/transcript/futures-arbitrage-500-profit-spread-scanner/index.md) ·
[CoinEx Academy (ZH)](https://www.coinex.com/zh-hans/academy/wiki/4390-funding-rate-arbitrage-tactics-step-by-step-strategies) ·
[Peter Guo (ZH)](https://peterguo.gitbook.io/cryptoresearch/shi-chang-shen-du-fen-xi/zi-jin-feildi-feng-xian-tao-li-shen-du-yan-jiu) ·
[Odaily (ZH)](https://www.odaily.news/post/5202456) ·
[CoinGlass Learn (PT)](https://www.coinglass.com/pt/learn/learn-8) ·
[CoinGlass Learn (ES)](https://www.coinglass.com/es/learn/learn-8) ·
[CoinGlass Learn (KO)](https://www.coinglass.com/ko/learn/learn-8) ·
[CoinGlass Learn (DE)](https://www.coinglass.com/de/learn/learn-8) ·
[CoinGlass Learn (FR)](https://www.coinglass.com/fr/learn/learn-8) ·
[CoinGlass Learn (TR)](https://www.coinglass.com/tr/learn/learn-8) ·
[CoinEx (KO)](https://www.coinex.com/ko/blog/10763-coinex-futures-funding-fee-explained-what-users-should-know) ·
[TokenPost 262635](https://www.tokenpost.kr/news/cryptocurrency/262635) ·
[TokenPost 243120](https://www.tokenpost.kr/news/cryptocurrency/243120) ·
[TokenPost 254344](https://www.tokenpost.kr/news/cryptocurrency/254344) ·
[TokenPost 277524](https://www.tokenpost.kr/news/cryptocurrency/277524) ·
[TokenPost 256186](https://www.tokenpost.kr/news/cryptocurrency/256186) ·
[TokenPost 246029](https://www.tokenpost.kr/news/cryptocurrency/246029) ·
[TokenPost 255649](https://www.tokenpost.kr/news/cryptocurrency/255649) ·
[Decentralised News](https://sites.google.com/view/decentralised-news/home/funding-rate-arbitrage) ·
[Circle: Delta Neutral](https://partners.circle.com/partner/delta-neutral-digital-assets) ·
[LinkedIn: Mark Hussey](https://ch.linkedin.com/in/markhussey) ·
[Ledger Academy](https://www.ledger.com/academy/glossary/funding-rate-arbitrage) ·
[Sharpe](https://www.sharpe.ai/learn/funding-rate-arbitrage) ·
[KuCoin (promocional)](https://www.kucoin.com/blog/how-to-earn-passive-income-in-a-bear-market-funding-rate-arbitrage-explained) ·
[Kingfisher](https://thekingfisher.io/glossary/funding_rate_arbitrage) ·
[cryptotrade.com.de](https://cryptotrade.com.de/%2A%2AHow_to_Exploit_Funding_Rate_Arbitrage_for_Steady_Gains%2A%2A) ·
[Chainscore Labs](https://www.chainscorelabs.com/glossary/defi-yield-farming-and-liquidity-mining/leveraged-yield-strategies/funding-rate-arbitrage)

Mineração: [SourceForge: MRR vs NiceHash](https://sourceforge.net/software/compare/MiningRigRentals.com-vs-NiceHash/) ·
[MiningBoard: mercado de hash](https://miningboard.com/guides/what-is-hashpower-marketplace) ·
[mkpool: alugar hash](https://mkpool.com/rent-hashrate) ·
[SoloFury: NiceHash vs MRR vs Braiins](https://solofury.com/blog/nicehash-vs-mrr-vs-braiins-hashpower/) ·
[cryptotrade.wiki](https://cryptotrade.wiki/en/articles/hashrate-rental) ·
[Fool Investor: NiceHash](https://foolinvestor.com/2025/12/nicehash-review/) ·
[Bitshills](https://bitshills.com/how-to-rent-hash-power/) ·
[NiceHash: suporte](https://www.nicehash.com/support/hash-power-marketplace/general-help/is-nicehash-a-mining-rig-rental-service-as-well) ·
[AlternativeTo: NiceHash](https://alternativeto.net/software/nicehash/?p=2) ·
[HackerNoon (UK)](https://hackernoon.com/lang/uk/how-nicehashs-new-scrypt-firmware-could-change-litecoin-and-dogecoin-mining-forever) ·
[HackerNoon (MK)](https://hackernoon.com/lang/mk/how-nicehashs-new-scrypt-firmware-could-change-litecoin-and-dogecoin-mining-forever) ·
[ITC.ua (2014)](https://itc.ua/articles/naibolee-vyigodnyiy-mayning-kriptovalyut-chto-dlya-etogo-nuzhno-znat/) ·
[Habr (EN)](https://habr.com/en/articles/406377) ·
[Habr (RU)](https://habr.com/ru/post/406377/) ·
[LiteSolo](https://litesolo.org/) ·
[Profinvestment: DOGE](https://profinvestment.com/mining-dogecoin/) ·
[Kryptex + NiceHash (UK)](https://pool.kryptex.com/uk/articles/kryptex-nicehash-rent-ru) ·
[Kryptex + NiceHash (RU)](https://pool.kryptex.com/ru/articles/kryptex-nicehash-rent-ru) ·
[Stacker.News](https://stacker.news/items/73748) ·
[litecoinpool.org](https://www.litecoinpool.org/news?id=89) ·
[MiningBoard: LiteSolo](https://miningboard.com/en/pools/litesolo.org) ·
[MiningBoard: LiteSolo (VI)](https://miningboard.com/vi/pools/litesolo.org) ·
[MiningBoard: LiteSolo (ES)](https://miningboard.com/es/pools/litesolo.org) ·
[Kryptex: LTC](https://pool.kryptex.com/ru/articles/ltc-mining-ru) ·
[r/NiceHash](https://reddit.birdcat.cafe/r/NiceHash/comments/1k4e5ah/some_miners_want_to_get_paid_in_dogecoin_litecoin)

Dados técnicos usados (respostas de API conferidas): OKX `funding-rate?instId=ANY`, Bitget `current-fund-rate`,
Gate `futures/usdt/contracts`, dYdX `perpetualMarkets`, WhatToMine `asic.json`, NiceHash `orderBook` por algoritmo,
WhatsOnChain (BSV).
