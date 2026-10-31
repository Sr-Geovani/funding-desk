# Pesquisa: funding, execução e caso de negócio (out/2026)

Pesquisa feita na web (sem acesso ao texto completo de mdpi.com e blog.pi2.network; números da MDPI vêm dos resumos).
Evidência: **(F)** forte, **(M)** média, **(Fr)** fraca. Onde as fontes divergem, está dito.

## 1. O que decide o lucro é quanto tempo o spread dura (F)
- Tarifas base maker/taker: Hyperliquid 0,015%/0,045%, Binance 0,02%/0,05%, Gate 0,02%/0,05%, Bitget 0,02%/0,06%
  (páginas oficiais [8][14][15]); Bybit 0,02%/0,055% e OKX 0,02%/0,05% (terceiros).
- Ida e volta nas duas pernas HL + Binance: 0,07% com maker e 0,19% com taker.
- Com a duração média que medimos (18 h), o spread só empata acima de **~34% a.a. com maker** ou **~92% a.a. com taker**.
  Ficando 7 dias com maker, o empate cai para ~3,7% a.a.
- Conclusão: o painel deve estimar a **duração esperada** do spread, não só o tamanho. Isso explica o nosso backtest.

## 2. Spreads grandes são comuns, mas poucos dão lucro (M)
- Estudo com 26 corretoras: 17% das observações com spread ≥ 20 bps, mas só ~40% das melhores oportunidades lucraram
  depois de custos e reversão (amostra de 8 dias) [4]. Meia-vida do funding do BTC estimada em 11–18 h (Fr) [20].

## 3. Âncora de juros 0,01%/8 h (M)
- No 3º tri de 2025 o funding ficou positivo > 92% do tempo, agrupado nessa âncora [6]. HL e Binance usam a mesma
  âncora [7][11]: quando as duas estão nela, o spread é zero; o ganho vem do prêmio. A OKX indica juros 0% na fórmula
  (diferença estrutural possível; conferir o campo `interestRate`).

## 4. O que indica persistência
- **Regime de mercado (F):** carry alto quando o varejo persegue tendência e falta capital de arbitragem; antecede quedas
  (BIS [2]). 2026 está comprimido: base CME ~3–5% (era ~17%) [18]; funding do BTC negativo 67 dias seguidos [19].
- **Liquidez (F/M):** desvios maiores em cripto e diminuindo com o tempo; Sharpe 1,8 com custos de varejo, 3,5 para
  market makers [1].
- **Horário (M/F):** volume e spread bid-ask em "U" dentro do ciclo de 8 h; spreads de funding com pico ~2 h após a
  liquidação [3][5].
- **Mudanças de intervalo e teto (F):** Binance passa o contrato para 1 h ao bater o teto (desde mai/2025) [10]; OKX
  encurta um nível por vez (desde abr/2026) [12]; compare sempre por hora.
- **OI, listagens e moedas pequenas (Fr):** OI cresce antes de fundings altos; extremos em altcoins revertem em horas.

## 5. Execução
- Entrar logo antes da liquidação captura um pagamento, mas paga a ida e volta justo quando o bid-ask está mais largo (M).
- Com US$1 mil não há nível VIP: sobra ordem maker, desconto por staking de HYPE (5–40%) e referral (F) [8].
- Risco de cauda (M): em 10/10/2025 houve ~US$19 bi liquidados, ADL na HL e USDe a US$0,65 na Binance [16][17].
  A 2x, uma altcoin que cai ~45% no dia liquida a perna comprada.
- Transferências (M): HL cobra 1 USDC por saque; TRC20 ~1 USDT. Com lucro de ~US$0,11 por operação, um rebalanceamento
  come o lucro de ~10 operações.
- Boros (Pendle) permite travar spread fixo em BTC/ETH entre Binance e HL (M) [21].

## 6. Retornos reais 2024–26 (M/Fr)
- Fundos market-neutral +14,4% até nov/2025 [22]; sUSDe ~11–19% em 2024 e ~7–9% em 2026 [23]; carry simples em 30
  perps da Binance +13,4% em 2024 e +0,6% em 2026 [24]. Referência do cliente brasileiro: Selic 14,25% (jun/2026) [25].

## Sinais calculáveis com APIs públicas
- Hyperliquid `POST /info`: `metaAndAssetCtxs`, `fundingHistory`, `predictedFundings`, `l2Book`.
- Binance: `/fapi/v1/premiumIndex`, `/fundingRate`, `/fundingInfo`, `/futures/data/openInterestHist`, `/depth`.
- Bybit: `/v5/market/tickers` (`fundingIntervalHour`, `fundingCap`, `openInterestValue`), `/funding/history`.
- OKX: `/api/v5/public/funding-rate`, `/funding-rate-history`, `/open-interest`, `/instruments` (`listTime`).
- Conta: taxa por hora = taxa ÷ horas do intervalo; persistência por AR(1) do spread horário
  (meia-vida = ln 0,5 ÷ ln φ; captura esperada em H horas = s₀ × (1 − φ^H) ÷ (1 − φ)).

## Funcionalidades sugeridas
1. Spread líquido com tarifas reais e meia-vida do par. 2. Calculadora de empate maker × taker × permanência.
3. Relógio de liquidação e alerta de mudança de intervalo/teto. 4. Monitor de liquidação/ADL com custo de rebalanceamento.
5. Livro-razão reconciliado com os extratos das corretoras e exportação para a DeCripto. 6. Indicador de regime.

## Caso de negócio
- **Mercado:** Brasil é o 5º em adoção cripto (Chainalysis 2025) [27]; o nicho delta-neutro de varejo é pequeno e o
  CDI alto pesa contra.
- **Concorrentes:** CoinGlass (grátis; API US$29–699/mês) [28]; Laevitas (~US$50/mês) [29]; ArbitrageScanner
  (US$69–795/mês) [30]; Hummingbot (grátis, open source) [31]; bots das próprias corretoras (grátis) [32].
  Nenhuma ferramenta brasileira equivalente encontrada.
- **Monetização:** com ~US$0,11 de lucro por operação, **taxa por operação hoje deixaria o cliente no prejuízo**.
  Caminho sugerido: fase 1 grátis/barata com programas de corretora (Bybit paga até 45% das tarifas a brokers de API
  [33]; Binance Link proíbe repassar rebate [34]); fase 2 assinatura em reais via Pix; taxa por operação só pelo builder
  code da Hyperliquid (aprovado pelo usuário, sem custódia) [9] e só quando o lucro por operação for > 3× a taxa.
  Evitar taxa de performance (parece gestão de carteira).
- **Regulação (consultar advogado):** CVM trata derivativos de cripto como valores mobiliários e já emitiu stop orders
  contra Binance e Bybit [35]; recomendação por algoritmo pode cair nas Res. CVM 19/20/21 [36]. Postura mais segura:
  software em que o usuário define as regras e confirma as ordens. Resoluções do BCB 519–521 valem desde 2/2/2026 [37]
  (software sem custódia provavelmente fora, incerto). Tributação: MP 1303 caducou [38]; Lei 14.754/2023 para exterior
  [39]; DeCripto (IN 2.291/2025) desde 1/7/2026 [40].
- **Track record antes de vender:** 6–12 meses ao vivo, 100+ operações (inclusive perdedoras e um evento de estresse),
  reconciliado com extratos, líquido de custos, comparado com CDI e com o carry do BTC; hash mensal do livro-razão.

## Mineração (do mesmo levantamento)
- NiceHash: 3% sobre o gasto; EasyMining a partir de 5 USDT [41]. MiningRigRentals: 3% [42]. Pools solo: 0,16% a
  1,5% [43]. Como o aluguel acompanha o hashprice, o valor esperado tende a ser levemente negativo pelas tarifas: o painel
  deve mostrar probabilidade e valor esperado, não "ROI".

## Fontes
[1] arxiv.org/abs/2212.06888 [2] bis.org/publ/work1087.htm [3] mdpi.com/2227-7072/14/5/103 [4] mdpi.com/2227-7390/14/2/346
[5] business.cornell.edu/centers/2025/02/18/perpetual-futures-contracts-and-cryptocurrency/ [6] bitmex.com/blog/2025q3-derivatives-report
[7] hyperliquid.gitbook.io/hyperliquid-docs/trading/funding [8] hyperliquid.gitbook.io/hyperliquid-docs/trading/fees
[9] hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes [10] binance.com/en/support/announcement/3243c81a35bd4f0c86a37315c3dc96cc
[11] binance.com/en-AE/support/announcement/detail/c00588a7e8504b3eb28d02a2da00530b [12] web3.okx.com/help/ann-okx-to-adjust-funding-rate-interval-for-certain-perpetual-future
[13] bybit-exchange.github.io/docs/v5/websocket/public/ticker [14] gate.com/announcements/article/101365 [15] bitget.cloud/support/articles/12560603807451
[16] galaxy.com/insights/research/cryptos-flash-crash-liquidation-binance-adl-auto-deleveraging [17] sentora.com/research/articles/structural-shifts-in-crypto-the-black-friday-drawdown-and-hyperliquid-s-bid-to-challenge-cexs
[18] theblock.co/post/396722 [19] theblock.co/post/400182 [20] askrubyai.github.io/blog/posts/2026-02-14-funding-rate-arbitrage
[21] docs.pendle.finance/boros-academy/advanced-strategies/fixed-return-funding-arbitrage [22] investmentnews.com/alternatives/crypto-chaos-jolts-hedge-funds-in-worst-year-since-2022-crash/263643
[23] cryptobriefing.com/ethena-750m-rewards-since-launch/ [24] bryanvine.github.io/alpha-research/paper2.html
[25] investinglive.com/centralbank/brazil-central-bank-cuts-rates-but-warns-fiscal-stimulus-may-blunt-monetary-policy-20260617/
[26] quicknode.com/docs/hyperliquid/info-endpoints/predictedFundings [27] crowdfundinsider.com/2025/10/254132-latam-region-emerges-as-major-crypto-hub-amid-volatile-growth-research/
[28] coinglass.com/pricing [29] nexusfi.com/d/data-providers/laevitas/ [30] coincheckup.com/en/blog/crypto-arbitrage-scanner
[31] hummingbot.org/release-notes/1.27.0 [32] binance.com/en/support/faq/detail/f330e17d6fc04679b9b21d6f9350e787
[33] bybit.nl/en/help-center/article/FAQ-API-Brokers-Program [34] binance.com/en/support/faq/04b2a5c9a8174096b3508f270404508c
[35] infomoney.com.br/mercados/cvm-ordena-suspensao-de-servicos-da-exchange-cripto-bybit-no-brasil/ [36] mattosfilho.com.br/unico/novas-regras-cvm-administradores-fundos/
[37] machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/bancario-seguros-e-financeiro-ij/bcb-regulamenta-o-mercado-de-ativos-virtuais-no-brasil
[38] contabeis.com.br/artigos/73399/ [39] gov.br/fazenda/pt-br/assuntos/noticias/2023/dezembro/qa-lei-14754-offshores2.pdf
[40] mattosfilho.com.br/unico/decripto-receita-federal-ocde/ [41] cryptopotato.com/three-bitcoin-blocks-mined-last-month-with-no-hardware-via-nicehash-easymining/
[42] miningrigrentals.com/faq [43] d-central.tech/solo-mining-services/
