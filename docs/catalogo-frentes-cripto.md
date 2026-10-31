# Catálogo global: todas as frentes de ganho em cripto (31/10/2026)

Varredura em PT, EN, ES, RU, ZH, KO, JA (blogs, comunidades, documentação) + **números medidos nas APIs públicas**
neste dia. "Relatado" = fonte de terceiros, muitas vezes promocional. Régua: CDI 13,65% a.a.; hashprice do BTC
US$33/PH/dia; BTC ~US$77 mil.

Legenda — **Esforço**: P (passivo), O (operacional), H (habilidade técnica). **Para nós**: ★★★ encaixa já
(software, pouco capital, dado público), ★★ com capital/equipamento, ★ só com habilidade específica, ✕ evitar.

## A. Mineração e outros "hashes" (prova de trabalho e de recursos)
| Frente | Como ganha | Número | Esforço | Risco principal | Para nós |
|---|---|---|---|---|---|
| Hash alugado → pool solo (BCH) | bloco inteiro quando acerta | empate estrutural; vantagem só com DARR > ~1,05 (0,1% das horas) | O | sorte; DARR | ★★★ (já temos) |
| Hash alugado → PPS/multipool | paga por share | zpool pagou −22% no SHA-256 (24 h reais); Scrypt real −9% | O | margem negativa | ★★ monitor (já temos) |
| Revender hash NiceHash → MRR | aluguel mais caro na MRR | AsicBoost 0,47–0,51 vs 0,437 (+8–16% bruto); 620 PH/s alugados, 43,8 EH/s parados | O | concorrência, reembolso por queda de hash | ★★ observar |
| Hash na Braiins (0% no beta) | mesmo hash 0,5% mais barato | precisa pool com extranonce2 ≥ 7 | O | compatibilidade do pool | ★★★ (botão no painel) |
| ASIC próprio em casa (Brasil) | minera BTC | S21 XP: −US$4,4/dia a US$0,15/kWh (empate em US$0,10/kWh) | O | energia cara | ✕ |
| ASIC hospedado (Paraguai, Etiópia) | minera BTC com energia barata | S21 XP: +US$3,0/dia (US$0,065) e +US$4,1 (US$0,053), sem a máquina | P/O | hashprice; Etiópia racionou a 23% (set/26); contrato do Paraguai até 2027 | ★★ |
| Energia excedente do Nordeste (curtailment) | minerar energia que seria cortada | R$6,5 bi perdidos pelos geradores em 2025; US$320 mi em projetos | H/negócio | capital alto, contrato com gerador | ★ (B2B) |
| GPU: moedas novas | minera moeda recém-lançada | Pearl US$3,73/dia por placa, Quantus 3,68 (WhatToMine); Ravencoin 0,38 | O | moeda nova cai rápido; precisa da placa | ★★ |
| CPU (Qubic, Monero + Tari) | prova de trabalho "útil" / RandomX | ~US$3/dia por Ryzen 9 (relatado pelo projeto, 2025) | O | token volátil | ★ |
| ASIC de altcoin (Kaspa, Aleo, Alephium) | moedas com ASIC próprio | relatos de US$5–34/dia, dados velhos | O | ASIC nova derruba | ★ |
| Moedas extras do merged mining | PEP, DINGO, LKY junto com LTC | +0,3% no Scrypt | P | — | ✕ |
| Prova de espaço/armazenamento (Chia, Filecoin, Storj, Arweave) | aluga disco | Chia ~US$1/TB/mês, Storj ~US$3,8/TB usado (relatado) | P | retorno baixo | ✕ |
| Provas ZK com GPU (Boundless, Succinct) | gera provas e recebe por elas | sem dado independente; Succinct diz que não garante retorno | H | mercado novo | ★ observar |
| IA descentralizada (Bittensor subnets) | minerador de modelo ganha TAO | top 10–20% ficam com 60–80% das emissões; 1–3 meses sem lucro (relatado) | H | competição de ML | ★ |
| Aluguel de GPU para IA (Vast.ai, RunPod, Clore, Akash, io.net) | aluga a placa | RTX 4090 US$0,27–0,50/h; H100 US$0,90–1,87/h; ocupação incerta | O | ocupação, energia | ★★ |
| DePIN físico (Helium, GEODNET, Hivemapper, WeatherXM) | equipamento que presta serviço | GEODNET ~US$54/mês estimado; Helium US$16,6 mi/ano de receita na rede | P | token caiu ~50% | ★ |
| Banda (Grass, Mysterium) | vende internet ociosa | Grass ~US$50/mês (fonte fraca); Mysterium ~0 | P | diluição | ✕ |
| Nó Lightning (roteamento) | taxa de roteamento | ~0–1%/ano típico; ~10% só para nós grandes | O | capital parado | ✕ |
| Pool de mineração próprio | cobra 1–2% de taxa | modelo BlockSniper | H/negócio | volume | ★ (futuro) |
| Mineração em nuvem (contratos) | promete renda fixa | maioria pirâmide (Faraó, Atlas: CVM) | — | golpe | ✕ |

## B. Validação e infraestrutura
| Frente | Número | Para nós |
|---|---|---|
| Staking ETH (Lido) / SOL (Jito, Marinade) / TAO | 3,2% / 4,8–5,4% / ~5% | ★ referência (abaixo do CDI) |
| Validador próprio (Solana, Cosmos) | custo fixo alto; precisa delegação | ✕ |
| Venda de nós (node sales) | especulativo | ✕ |

## C. DeFi e rendimento
| Frente | Número (medido) | Para nós |
|---|---|---|
| Emprestar stablecoin (Bitfinex) | 5,1% agora, FRR 12,5%, média de 90 dias 7,5% antes de 15% de taxa | ★★★ (monitor ligado) |
| Stablecoin em DeFi (Aave, Morpho, Fluid) | mediana 4,9%; melhores 8–15% com mais risco (DefiLlama, TVL ≥ US$50 mi) | ★★ |
| Delta neutro pronto (Ethena sUSDe, HLP) | 4,8% / 4,4% | ★ referência |
| Renda fixa tokenizada no Brasil (CDI+) | média de 132% do CDI em 2025 no Mercado Bitcoin (relatado); sem FGC | ★★ (em reais, bate o CDI com risco de crédito) |
| Pendle (taxa fixa) e Boros (travar funding) | Boros elimina o risco de o funding virar | ★★ estudar |
| Prover liquidez (Uniswap v3/v4) | só 18% das posições < US$1.000 ganharam de segurar (Bitquery) | ✕ |

## D. Trading e arbitragem
| Frente | Número | Para nós |
|---|---|---|
| Funding entre corretoras (temos) | +US$0,11/operação na regra validada | ★★★ |
| Funding com perna na Lighter (taxa zero) | empate 7–8,5% vs 12%; 76 pares agora | ★★★ (robô simulado ligado) |
| Cash-and-carry (base de futuros) | 5,6% a.a. | ★★ gatilho em 12–15% |
| Venda coberta de opções BTC | ~5% a.a. com filtros (Anchorage) | ★ |
| Arbitragem entre corretoras / triangular | tomada por robôs | ✕ |
| MEV e liquidações | profissional; na Hyperliquid o HLP fica com as liquidações | ✕ |
| Market making com rebate | precisa volume alto | ★ futuro |
| Sniping de memecoin / pré-mercado | loteria; maioria perde | ✕ |
| Mercados de previsão | proibidos no Brasil (CMN 5.298/2026) | ✕ |
| Copy trading / grid | sem vantagem estrutural | ✕ |

## E. Eventos de distribuição de tokens
| Frente | Número | Para nós |
|---|---|---|
| Binance Launchpool / HODLer (BNB protegido com short) | média 84% APY nos Launchpools 2024–1º tri/25 (dado da Binance, preço do 1º dia) | ★★ registrar eventos |
| Binance Alpha / Wallet TGE | média de US$1.076 por usuário em 2025 (bruto); custa pontos (volume) | ★★ |
| Airdrops por pontos (Paradex S3, Extended, Pacifica) | soma ao funding em DEX | ★★ (opcional com a Lighter/Paradex) |
| Vendas públicas (Legion, Echo/Sonar, Buidlpad, CoinList) | viés de sobrevivência; Buidlpad reembolsa se cair em 30 dias | ★ |

## F. Serviços e negócios (renda ativa)
| Frente | Número | Para nós |
|---|---|---|
| Código de construtor da Hyperliquid (front-end cobra taxa) | Phantom US$20,6 mi; programa US$40–90 mi acumulados | ★★★ (o painel pode virar front-end) |
| Afiliado/indicação de corretoras | 20–50% das taxas dos indicados | ★★ |
| Bug bounty / auditoria (Immunefi, Sherlock) | US$134–140 mi pagos no total; mediana ~US$2 mil; Code4rena fechou (mai/26) | ★ (habilidade) |
| Recompensas e bolsas (bounties, grants, hackathons) | variável | ★ |
| Comerciante P2P de USDT | 0,3–1% com risco de golpe e bloqueio no Pix | ✕ |
| Vender a ferramenta (assinatura) | ver docs/pesquisa-funding-negocio.md | ★★ |

## Onde investir tempo primeiro (nossa ordem)
1. **Funding com a Lighter** (robô simulado rodando) e **Braiins** (testar o pool) — mesmo motor que já temos, custo menor.
2. **Dinheiro parado rendendo**: Bitfinex (dólar) e renda fixa tokenizada (reais) — monitor + decisão simples.
3. **Eventos de tokens** (Launchpool/HODLer/Alpha): registrar cada evento no Diário e medir o resultado real.
4. **Código de construtor da Hyperliquid**: transformar o painel em front-end que ganha uma taxa pequena por ordem.
5. Com capital para equipamento: **ASIC hospedado** (só com BTC subindo) ou **GPU em moeda nova** (curto prazo).

## O painel acompanha (Radar → Frentes em observação)
Funding com Lighter; Bitfinex; cash-and-carry; Ethena/HLP; multipool zpool (pago de fato); revenda na MRR
(AsicBoost); câmbio (ágio × PTAX); **ASIC próprio** (hashprice e lucro/dia por preço de energia); **GPU** (moedas que
mais pagam por placa). Detalhes em `docs/pesquisa-frentes.md`.

## Fontes (além das já listadas em docs/pesquisa-frentes.md)
GPU: [MinerCompare](https://minercompare.com/articles/is-gpu-mining-profitable-again-pearl-quantus-epic-cash-2026), [Coinspeaker](https://www.coinspeaker.com/guides/best-crypto-to-mine/), API WhatToMine ·
Qubic: [The Defiant](https://thedefiant.io/news/defi/qubic-just-mined-monero-and-redefined-what-proof-of-work-can-be), [Club386](https://www.club386.com/qubic-crypto-miners-target-amd-ryzen-9-7950x-cpus/) ·
Bittensor: [misar.blog](https://www.misar.blog/@synor/articles/bittensor-subnet-mining), [ownyourmind](https://ownyourmind.ai/tokenomics/bittensor-dtao-subnet-economics/), [Pine Analytics](https://x.com/PineAnalytics/status/2036156766736601117) ·
DePIN: [BlockEden](https://blockeden.xyz/blog/2026/03/21/depin-march-2026-reality-check-650-projects-19b-market-cap-revenue/), [solanareport](https://solanareport.com/2026/01/31/top-revenue-generating-solana-depin-projects-helium-io-net-geodnet-breakdown) ·
GPU para IA: [miningboard](https://miningboard.com/guides/rent-gpu-for-ai-earnings), [fast.io](https://www.fast.io/resources/vast-ai-review-2026.md) ·
ASIC/hospedagem: [Hashrate Index LatAm](https://hashrateindex.com/blog/the-state-of-bitcoin-mining-in-latin-america-2026/), [OneMiners](https://oneminers.com/blogs/news/what-it-really-costs-to-mine-bitcoin-2026-hosting-rate-card), API mempool.space ·
Curtailment Brasil: [Movimento Econômico](https://movimentoeconomico.com.br/tecnologia/2026/03/12/com-energia-excedente-ne-atrai-us-320-mi-em-projetos-de-mineracao-de-bitcoin/), [Hashrate Index Brasil](https://hashrateindex.com/blog/the-state-of-bitcoin-mining-in-brazil-2026/), [Cenário Energia](https://cenarioenergia.com.br/2025/08/20/geradoras-de-energia-no-brasil-avaliam-mineracao-de-bitcoin-para-mitigar-perdas-e-otimizar-geracao/) ·
Armazenamento: [KuCoin](https://www.kucoin.com/blog/ai-storage-demand-hits-crypto-why-filecoin-and-storj-are-surging-as-us-equities-rally), [Storj forum](https://forum.storj.io/t/i-will-no-longer-leave-storj/15547) ·
ZK: [Boundless](https://boundless.network/blog/proving-is-the-new-mining), [Succinct docs](https://docs.succinct.xyz/docs/provers/introduction) ·
Lightning: [Spark](https://www.spark.money/research/lightning-node-profitability-routing-analysis) ·
Banda: [Weiss](https://weissratings.com/en/weiss-crypto-daily/earn-income-with-crypto-s-airbnb-for-idle-bandwidth) ·
Airdrops/pontos: [BTC-Echo](https://www.btc-echo.de/news/airdrop-farming-2026-wo-sich-aufwand-lohnt-225720/), [BeInCrypto](https://beincrypto.com/perp-dexs-airdrops-farming-pacifica-lighter-paradex) ·
Binance Alpha: [CoinMarketCap Academy](https://coinmarketcap.com/academy/uk/article/binance-alpha-2025-crypto-airdrops-token-launches) ·
Vendas de tokens: [Tiger Research](https://reports.tiger-research.com/p/public-launchpad-boom-eng), [Sablier](https://blog.sablier.com/the-state-of-token-sale-platforms-in-2025) ·
Builder codes: [CoinGecko](https://www.coingecko.com/research/publications/top-hyperliquid-builders), [Crypto Briefing](https://cryptobriefing.com/phantom-20m-builder-code-revenue-hyperliquid/) ·
Bug bounty: [The Block](https://www.theblock.co/post/401179/immufefi-absorb-code4rena-bug-bounty-customers-shutdown-decision), [Sherlock](https://sherlock.xyz/post/best-web3-bug-bounties-in-2026-the-highest-paying-programs-on-every-platform) ·
Afiliados: [Bitget Academy](https://www.bitget.cloud/academy/crypto-affiliate-commission-structures) ·
LP: [Swiss Economics](https://swiss-economics.ch/blog/items/uniswap-and-the-lp-problem.html) ·
Renda fixa tokenizada: [InfoMoney](https://www.infomoney.com.br/onde-investir/30-do-nosso-resultado-vem-de-tokenizacao-de-ativos-diz-cfo-do-mercado-bitcoin/), [InvestNews](https://investnews.com.br/investimentos/tokenizacao-avanca-no-brasil-e-oferece-renda-fixa-pagando-20-ao-ano-quais-os-riscos/amp/) ·
Golpes: [BP Money (CVM, Atlas)](https://bpmoney.com.br/mercado/cvm-multa-em-r-558-mi-envolvidos-em-piramide-cripto-de-r-7-bi) ·
Panorama ZH/RU: [KuCoin PoW × staking](https://www.kucoin.com/blog/en-2026-pow-mining-vs-staking-which-is-more-profitable-and-suitable-for-you), [profinvestment](https://profinvestment.com/how-earn-crypto/).
