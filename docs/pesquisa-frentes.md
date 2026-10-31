# Pesquisa: novas frentes para monitorar antes de operar (31/10/2026)

Varredura em português, inglês, espanhol, russo, chinês, coreano e japonês (blogs, comunidades, documentação das
plataformas) e, principalmente, **checagem com dados ao vivo das APIs públicas** de cada frente. Fontes de fórum e de
afiliados foram tratadas como fracas: os números abaixo são os medidos aqui, salvo indicação.

**Régua**: CDI 13,65% a.a. (BCB, série 4389, 29/10/2026). Frente em dólar só ganha do CDI se render mais que ele menos
a alta esperada do dólar. Juros do Tesouro americano de 2 anos ~3,8%.

## Ranking
| # | Frente | Exploração | Número medido agora | Encaixe no painel | Veredito |
|---|---|---|---|---|---|
| 1 | **Funding com uma perna em DEX de taxa zero (Lighter)** | muito explorada na Ásia; quase nada no Brasil | Lighter cobra 0% maker e taker (confirmado na API). Empate cai de ~12,2% (HL + Binance, maker) para ~7,3% (Lighter + HL) e 8,5% (Lighter + Binance/Bybit). Agora: 76 pares de 46 moedas cripto (OI ≥ US$300 mil) acima do empate | Alto: mesma regra validada; o endpoint da Lighter traz Binance, Bybit e Hyperliquid juntos (o servidor nos EUA passa a ler Binance/Bybit) | **Monitorar e simular já** (robô simulado ligado) |
| 2 | Câmbio para os aportes (ágio USDT/USDC × PTAX) | conhecida, pouco medida | USDC +0,65% e USDT +2,19% sobre a PTAX no Mercado Bitcoin | Alto | **Monitorar**: economia em cada aporte, sem risco |
| 3 | Emprestar USDT na Bitfinex (margin funding) | muito explorada (bots, ZH/KO/VI/DE); pouco no Brasil | Último 5,1% a.a., FRR 12,5%; média de 90 dias dos empréstimos de 30 dias 7,5% (antes da taxa de 15%). Picos de 15–50% em volatilidade | Médio | **Monitorar** como lugar para dólar parado entre operações |
| 4 | Cash-and-carry BTC (vender o futuro com vencimento) | muito explorada (fundos) | Base ~5,6% a.a. (Deribit, 90 dias); 2026 comprimido (Glassnode: abaixo do Tesouro desde fev/26) | Médio | **Monitorar com gatilho** em 12–15% a.a. (mercado comprado) |
| 5 | Ethena sUSDe e cofre HLP (Hyperliquid) | muito explorada | sUSDe 4,8% (30 dias); HLP 4,4% | Médio | Referência neutra em dólar; não operar agora |
| 6 | Pendle Boros (travar funding fixo) | pouco explorada | não medido (sem API pública conferida) | Médio (complemento da #1) | **Estudar**: elimina o risco de o funding virar |
| 7 | Launchpool / HODLer airdrops com BNB protegido (short no perpétuo) | muito explorada na Ásia | Binance: média de 84% APY nos Launchpools de 2024–1º tri/2025 (dado da própria Binance, preço do 1º dia); HODLer +19,7% no período | Baixo (anúncios; Binance bloqueia o servidor nos EUA) | **Registrar à mão** no Diário quando houver evento |
| 8 | Venda coberta de opções de BTC (prêmio de volatilidade) | explorada | Anchorage: ~5% a.a. sintético com filtros (abr/25–abr/26); blog com testes de 15–27% (sem custos) | Baixo | Observar depois; risco de cauda |

## Mineração: checagem de realidade (o que pagou de fato)
- **Multipool zpool** (API pública com o pago nas últimas 24 h): SHA-256 pagou 0,343 BTC/EH/dia contra ~0,437 do
  aluguel na NiceHash com taxa (**−22%**). Estimativas dos multipools são infladas (o "estimado" do SHA-256 era 0,59).
- **Revender hash da NiceHash na MiningRigRentals**: preço pedido ~43–51% acima, mas só ~29 PH/s alugados de 3 EH/s
  anunciados; as 100 máquinas mais baratas estavam sem aluguel. Oferta sobrando.
- **Moedas extras do merged mining (PEP, DINGO, LKY)**: ~US$1/TH/dia somadas (+0,3% no Scrypt).
- **DOGE bloco a bloco** (1.370 blocos em 24 h): um minerador constante ganhou US$362,8/TH/dia; a conta pela
  dificuldade do momento daria US$509 (+40%, ilusão). Ver `docs/auditoria-ia-e-simulacoes.md`.

## Descartadas
- **Polymarket/Kalshi** (recompensas de liquidez ~US$41 mil/dia só nos 100 mercados de maior volume): proibidas no
  Brasil (CMN 5.298/2026, bloqueio da Anatel); a Polymarket restringe novas posições do Brasil.
- **Surebet em casas de aposta**: não é crime, mas os termos proíbem e as casas limitam a conta (Portaria SPA/MF
  1.231/2024, art. 46). Fora de cripto.
- **Arbitragem à vista entre corretoras / triangular**: dominada por robôs de baixa latência.
- **Comerciante P2P de USDT**: margem de 0,3–1% com risco de golpe e bloqueio judicial no Pix.
- **Ágio de USDT como arbitragem** (comprar dólar no banco e vender USDT): o IOF de câmbio come a margem; vale só como
  economia nos aportes (#2).
- **Depeg de stablecoin (USDe etc.)**: resgate só para participantes aprovados; eventos raros.

## O que o painel passa a acompanhar (Radar → "Frentes em observação")
A cada 15 min, só dados públicos (sem chave): Lighter (funding e contratos em aberto), Bitfinex, Deribit, Ethena,
Hyperliquid (HLP), zpool, Mercado Bitcoin, PTAX e CDI (BCB). Para cada frente passiva, um "papel" de US$1.000 rende a
taxa observada com o CDI ao lado no mesmo período; histórico diário de 60 dias. Funding com Lighter roda como robô
simulado com a regra validada (24 leituras horárias seguidas acima do empate, só cripto, OI ≥ US$300 mil) e entra no
"Resultado financeiro → Simulado" do Início.

## Próximos passos sugeridos
1. Deixar o robô simulado da Lighter rodar 2–4 semanas e comparar com o robô de funding atual (mesma regra, taxas
   diferentes). Se o resultado por operação ficar claramente acima de +US$0,11, testar com US$100–200 reais.
2. Conferir a liquidez real dos pares sugeridos (livro da Lighter) antes de qualquer teste.
3. Gatilhos de alerta: Bitfinex líquido ≥ 12% a.a., base de futuros ≥ 12% a.a., ágio do USDC ≤ 0,3%.

## Fontes
Lighter: API `mainnet.zklighter.elliot.ai/api/v1/funding-rates` e `/orderBooks`; comparativos de taxa:
[cipher-intelligence](https://cipher-intelligence.io/blog/lighter-dex-vs-aster-dex-fees-2026/),
[renesis](https://renesis.fi/articles/best-perp-dex), [KuCoin (Lighter)](https://www.kucoin.com/blog/my-lighter-lit-perpetual-futures-guide-trade-perps-with-zero-fees),
[itiger (ZH, ARC 2.100% a.a.)](https://www.itiger.com/news/2614039264) ·
Bitfinex: API `api-pub.bitfinex.com/v2`, [suporte](https://support.bitfinex.com/hc/en-us/articles/115004554309-Margin-Funding-interest-on-Bitfinex),
[kkinvesting (guias multi-idioma)](https://kkinvesting.io/de/posts/bitfinex-lending-tutorial/) ·
Base: API Deribit, [tftc (2026)](https://www.tftc.io/bitcoin-futures-basis-below-treasury-yields-2026),
[cryptoslate](https://cryptoslate.com/bitcoin-futures-carry-treasury-yield-etf-flows/), [Amberdata](https://blog.amberdata.io/the-carry-trade-that-broke-how-basis-compression-triggered-the-cascade) ·
Ethena: API `ethena.fi/api/yields` · HLP: API Hyperliquid `vaultDetails` ·
Boros: [docs Pendle](https://docs.pendle.finance/boros-academy/advanced-strategies/fixed-return-funding-arbitrage),
[Blockworks](https://blockworks.co/news/boros-pendle-tokenizes-funding-rates) ·
Launchpool: [grenade.tw](https://grenade.tw/blog/binance-hodler-airdrop-launchpool-launchpad/),
[chogia.vn](https://chogia.vn/bitget-chiem-uu-the-launchpool-truoc-bybit-ve-thu-nhap-va-suc-hut-69782/),
[2lambroz](https://2lambroz.substack.com/p/quick-msg-on-funding-rate-arb-yield) ·
Opções: [Anchorage (KuCoin)](https://www.kucoin.com/news/flash/anchorage-rules-based-covered-calls-can-generate-5-synthetic-yield-on-bitcoin),
[cryptovol](https://cryptovol.vercel.app/blog/btc-covered-call-backtest) ·
Mineração: API zpool `zpool.ca/api/status`, API MiningRigRentals, Blockchair (DOGE), [ViaBTC merged](https://support.viabtc.com/hc/en-us/articles/11477430615439-LTC-Merged-Mining-Coins-Mining-Tutorial),
[F2Pool merged](https://f2pool.zendesk.com/hc/en-us/articles/360060018891) ·
Câmbio: API Mercado Bitcoin, PTAX e SGS do BCB ·
Polymarket: [Cointelegraph](https://cointelegraph.com/news/kalshi-polymarket-among-27-prediction-platforms-banned-in-brazil?rand=351),
[BNL Data](https://bnldata.com.br/brasil-e-2o-em-temas-apos-bloqueio-do-governo-federal-e-segue-acessivel/), API gamma ·
Surebet: [Flashscore](https://www.flashscore.com.br/apostas/guia/o-que-e-surebet/), [Lance](https://www.lance.com.br/sites-de-apostas/surebet.html) ·
Delta neutro (riscos): [CoinMarketCap Academy](https://coinmarketcap.com/academy/es/article/crypto-delta-neutral-strategy-2026).
