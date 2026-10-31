# Catálogo global de frentes de ganho em cripto — lastro para comparação (31/10/2026)

Inventário neutro: todas as frentes encontradas, sem filtro por país, regulação, garantia ou risco. Cada linha traz o
mecanismo, o número (**medido** = lido por nós nas APIs públicas neste dia; **relatado** = fonte de terceiros, muitas
vezes promocional), o que é preciso para operar, as variáveis que mexem no resultado e o acesso/regulação como
informação. Coluna **Ao vivo**: se o painel lê a frente (Radar → Frentes em observação). Referências do dia: CDI
13,65% a.a.; hashprice do BTC US$33/PH/dia; BTC ~US$77,4 mil; dólar R$5,43.

Esforço: P = passivo, O = operacional, H = técnico/especializado.

## A. Mineração e outros "hashes" (trabalho, espaço, computação, banda, sensores)
| Frente | Mecanismo | Número | Precisa | Variáveis | Acesso | Ao vivo |
|---|---|---|---|---|---|---|
| Hash alugado → pool solo BCH | ganha o bloco inteiro quando acerta | **medido**: margem de −2% a +6% conforme o DARR; DARR > 1,05 em 0,1% das horas (6 meses) | conta NiceHash/Braiins, BTC | sorte (Poisson), DARR, preço do aluguel | KYC na NiceHash | sim (robô) |
| Hash alugado → PPS/multipool | pool paga por share | **medido**: zpool pagou −22% no SHA-256 (24 h); Scrypt −9% (DOGE bloco a bloco) | conta NiceHash, pool PPS | dificuldade, preço das moedas, taxa do pool | — | sim |
| Hash na Braiins Hashpower | mesmo hash, 0% de taxa no beta | **medido**: −0,5% vs NiceHash com taxa | pool com extranonce2 ≥ 7 | compatibilidade do pool, fim do beta | Telegram + e-mail | sim |
| Revenda de hash NiceHash → MRR | compra num lugar, aluga em outro | **medido**: MRR AsicBoost 0,47–0,51 vs 0,437 BTC/EH/dia (+8–16%); 620 PH/s alugados, 43,8 EH/s ofertados | contas nas duas, BTC | ocupação, reembolso por queda de hash | e-mail | sim |
| ASIC BTC em casa | minera com a própria energia | **medido**: S21 XP −US$4,4/dia a US$0,15/kWh; empate US$0,10/kWh | máquina (~milhares de US$) | hashprice, energia, preço da máquina | — | sim |
| ASIC BTC hospedado | energia barata de terceiro | **medido**: S21 XP +US$3,0/dia (Paraguai US$0,065) e +US$4,1 (Etiópia US$0,053), sem a máquina | máquina + contrato | hashprice; racionamento na Etiópia (23% em set/26); contrato do Paraguai até 2027 | contrato no exterior | sim |
| Energia cortada (curtailment) no Nordeste | mineração em usina com energia sobrando | **relatado**: R$6,5 bi perdidos por geradores em 2025; US$320 mi em projetos | parceria com gerador, capital | contrato, hashprice, regulação (MME 140/2026) | B2B | não |
| ASIC de altcoin (Kaspa, Aleo, Alephium, LTC/DOGE) | minera moeda com ASIC próprio | **relatado**: US$5–34/dia por máquina (dados de 2024–25) | ASIC específico | nova geração de ASIC, preço | — | parcial (mapa) |
| GPU: moedas novas | minera moeda recém-lançada | **medido**: Pearl US$3,73/dia, Quantus 3,68 por placa de referência; Ravencoin 0,38 | placas de vídeo | emissão, dificuldade, liquidez | — | sim |
| CPU (Qubic, Monero/P2Pool + Tari) | prova de trabalho em CPU | **relatado**: ~US$3/dia por Ryzen 9 (Qubic, 2025) | CPU forte | preço do token | — | não |
| Merged mining extra (PEP, DINGO, LKY) | moedas a mais com o mesmo hash Scrypt | **medido**: +0,3% | pool que paga as auxiliares | preço das auxiliares | — | não |
| Armazenamento (Filecoin, Chia, Storj, Arweave, Autonomys) | aluga disco/prova espaço | **relatado**: Chia ~US$1/TB/mês; Storj ~US$3,8/TB usado; Filecoin cliente paga US$0,2–2/TB/mês | discos, uptime | preço do token, ocupação | — | não |
| Provas ZK com GPU (Boundless, Succinct) | gera provas por pagamento | **relatado**: US$3–112/dia conforme GPU (fonte promocional); Succinct não garante retorno | GPUs, stake | competição, emissões | — | não |
| IA descentralizada (Bittensor subnets) | minerador de modelo recebe TAO | **relatado**: top 10–20% ficam com 60–80% das emissões; registro 0,1–3 TAO (ou centenas, conforme demanda); TAO US$234 | engenharia de ML, GPU | ranking no subnet, preço do TAO | — | não |
| Aluguel de GPU para IA (Vast.ai, RunPod, Clore, Akash, io.net, Render) | aluga a placa por hora | **relatado**: RTX 4090 US$0,27–0,50/h; H100 US$0,90–1,87/h; Akash >80% de uso | placas, internet, energia | ocupação, comissão (7–20%) | — | não |
| DePIN físico (Helium, GEODNET, Hivemapper, WeatherXM, DIMO, Natix) | equipamento que presta serviço | **relatado**: GEODNET ~US$54/mês por estação; Helium US$16,6 mi/ano de receita da rede; setor US$82 mi/ano de receita | equipamento, local | preço do token, cobertura | — | não |
| Banda (Grass, Mysterium) | vende internet ociosa | **relatado**: Grass ~US$50/mês (fonte fraca); Mysterium ~0 (modelo) | computador ligado | diluição, preço do token | — | não |
| Nó Lightning | taxa de roteamento | **relatado**: ~1%/ano (10 BTC → 30 mil sats/dia); ~10% em nós grandes | BTC em canais | demanda de rotas | — | não |
| Pool de mineração próprio | cobra 1–2% do que os mineradores ganham | **relatado**: modelo BlockSniper (2% na coinbase) | software de pool, mineradores | volume de hash | — | não |
| Serviços de mineração (hospedagem, reparo e revenda de ASIC, reaproveitar calor) | negócio físico | sem número público consolidado | espaço, energia, técnicos | ciclo do hashprice | — | não |
| Mineração em nuvem (contratos) | paga renda prometida por contrato | **relatado**: casos de pirâmide julgados pela CVM (Faraó R$102 mi de multa; Atlas R$55,8 mi) | dinheiro | contraparte | — | não |

## B. Validação e infraestrutura
| Frente | Número | Precisa | Variáveis | Ao vivo |
|---|---|---|---|---|
| Staking ETH (Lido, Rocket, solo 32 ETH) | **medido**: Lido 3,2% a.a.; Rocket 2,2% | ETH | preço do ETH, MEV | sim |
| Staking SOL (Jito, Marinade, Jupiter) | **medido**: 4,8–5,4% a.a. | SOL | preço do SOL | sim (Jito) |
| Staking TAO / outras PoS | **relatado**: TAO ~5,3% | token | preço | não |
| Restaking (EigenLayer, Symbiotic) | **relatado**: base do LST + pontos | LST | slashing, pontos | não |
| Validador próprio (Solana, Cosmos, novas redes) | custo fixo de servidor e voto; receita depende de delegações | servidor, stake | delegação | não |
| Venda de nós / nós de rede nova | compra licença de nó que recebe tokens | dinheiro | preço do token | não |
| Incentivos de testnet | tokens por rodar nó em rede de teste | servidor, tempo | se haverá token | não |

## C. DeFi e rendimento
| Frente | Número | Precisa | Variáveis | Acesso | Ao vivo |
|---|---|---|---|---|---|
| Emprestar USDT/USD na Bitfinex | **medido**: 5,1% agora, FRR 12,5%, média de 90 dias 7,5% (antes de 15% de taxa); picos 15–50% | USDT na Bitfinex | demanda de alavancagem | KYC | sim |
| Emprestar stablecoin em DeFi (Aave, Morpho, Fluid, Spark) | **medido**: Aave USDC/USDT ~4–6%; mediana 4,9%; maiores 8–15% (pools ≥ US$50 mi) | carteira, stablecoin | uso dos pools, contrato | — | sim (Aave) |
| Poupança em dólar on-chain (Sky sUSDS, títulos tokenizados) | **medido**: sUSDS ~3,8% | stablecoin | juros dos EUA | — | sim |
| Dólar sintético (Ethena sUSDe), cofre HLP | **medido**: 4,8% / 4,4% | stablecoin | funding, liquidações | — | sim |
| Alavancar rendimento (loop: depositar, tomar emprestado, depositar de novo) | rende o spread × alavancagem | colateral | diferença de juros, liquidação | — | não |
| Pendle (PT taxa fixa, YT) e Boros (funding fixo) | **relatado**: PT de stablecoin com taxa travada; Boros trava o funding (ex.: 9,5% em ETH) | carteira | vencimento, taxa implícita | — | não |
| Prover liquidez (Uniswap v3/v4, Aerodrome, Curve) | **relatado**: 18% das posições < US$1.000 ganharam de segurar (Bitquery) | par de tokens | perda impermanente, faixa | — | não |
| LP delta neutro / cofres (Neutral, etc.) | **relatado**: ~7,6% líquido (JLP neutro) | depósito | estratégia do cofre | — | não |
| Renda fixa tokenizada no Brasil (CCB, CRI, debêntures) | **relatado**: média de 132% do CDI em 2025 (Mercado Bitcoin); ofertas de CDI+7% a CDI+10% | reais | crédito do emissor; sem FGC | plataformas BR | não |
| CeFi earn e duplo investimento (Binance, Bybit, OKX, Nexo) | **relatado**: USDT 2% a 15% em promoções com teto; duplo investimento = venda de opção com APR alto | conta | teto, opção embutida | KYC | não |

## D. Trading, arbitragem e estrutura de mercado
| Frente | Número | Precisa | Variáveis | Acesso | Ao vivo |
|---|---|---|---|---|---|
| Funding entre corretoras | **medido**: +US$0,11/operação na regra validada (90 dias) | contas, margem | duração do spread, execução | KYC | sim (robô) |
| Funding com perna em DEX de taxa zero (Lighter, Paradex) | **medido**: empate 7–8,5% vs 12%; 76 pares acima agora | USDC na DEX | liquidez, contrato | sem KYC | sim (robô) |
| Cash-and-carry (base de futuros) | **medido**: 5,6% a.a. (Deribit, 90 dias) | BTC + futuro | base | KYC | sim |
| Venda de opções (coberta, put) | **relatado**: ~5% a.a. com filtros (Anchorage); 15–27% em teste sem custos (blog) | BTC/opções | alta forte limita ganho; queda | KYC | não |
| Ágio local (Coreia "kimchi", Brasil, Argentina) | **medido**: Coreia BTC +1,1%, USDT +1,0%; Brasil USDT +1,3%; Argentina USDT +5% sobre o oficial | contas locais, câmbio | controle de capital, IOF, transferência | depende do país | sim |
| Arbitragem do mesmo ativo entre corretoras | **medido**: BTC 0,05% (USDT) a 0,2% (USD) de diferença; ida e volta ~0,2% | saldo nas duas | latência, transferência | KYC | sim |
| Triangular / estatística / pares | spreads de milissegundos | infraestrutura rápida | latência | — | não |
| MEV (backrun, arbitragem on-chain, liquidações) | **relatado**: parte grande vai ao construtor do bloco; na Hyperliquid o HLP fica com as liquidações | código, capital | competição | — | não |
| Market making com rebate (CEX/DEX) | rebate de maker em faixas de volume | volume | seleção adversa | — | não |
| Anúncio de listagem (Upbit/Binance), pré-mercado, unlocks com hedge | movimento após o anúncio | velocidade | notícia | — | não |
| Sniping de tokens novos (memecoins, pump.fun) | compra no lançamento | bot | maioria dos tokens zera | — | não |
| Mercados de previsão (Polymarket, Kalshi) | **medido**: Polymarket paga recompensa de liquidez (20 mercados de maior volume: milhares de US$/dia; rendimento bruto máx. de 44% a 2.500% a.a. por mercado) | USDC | seleção adversa, resolução | Polymarket restrita no Brasil (CMN 5.298/2026); Kalshi só EUA | sim |
| Arbitragem esportiva (surebet) e apostas casadas | **relatado**: diferença de odds entre casas; contas limitadas | contas em casas | limitação de conta | legal no Brasil; termos das casas proíbem | não |
| Copy trading (seguir ou ser seguido) e grid | taxa de desempenho para quem é seguido | histórico | regime de mercado | KYC | não |

## E. Distribuição de tokens
| Frente | Número | Precisa | Variáveis | Ao vivo |
|---|---|---|---|---|
| Binance Launchpool / HODLer (BNB, com ou sem hedge) | **relatado**: 84% APY médio nos Launchpools 2024–1º tri/25; HODLer +19,7% (dados da Binance, preço do 1º dia) | BNB | preço do BNB, ritmo de eventos | não |
| Binance Alpha / Wallet TGE / Booster | **relatado**: US$1.076 médio por usuário em 2025 (bruto) | pontos (volume e saldo) | custo dos pontos | não |
| Launchpools de outras (Bybit, Bitget, OKX, MEXC) | **relatado**: Bitget 47,5% médio, Bybit 16,2% (3 meses, não datado) | token da corretora ou USDT | teto por usuário | não |
| Airdrops por pontos (Paradex S3, Extended, Pacifica) | **relatado**: alguns usuários US$5–6 dígitos por ano; programas mudam sem aviso | capital, volume, tempo | anti-sybil | não |
| Vendas públicas (Legion, Echo/Sonar, Buidlpad, CoinList, Kraken Launch) | **relatado**: US$341 mi captados em 2 meses (fim de 2025); casos de 30x; Buidlpad reembolsa se cair em 30 dias | dinheiro, reputação | alocação, desbloqueio | não |
| NFT, play-to-earn, tap-to-earn, faucets | sem número consolidado | tempo | preço do ativo | não |

## F. Serviços e negócios (renda ativa)
| Frente | Número | Precisa | Ao vivo |
|---|---|---|---|
| Código de construtor da Hyperliquid (front-end cobra taxa) | **relatado**: Phantom US$20,6 mi; programa US$40–90 mi acumulados | 100 USDC + interface com usuários | não |
| Afiliado/indicação de corretoras | **relatado**: 20–50% das taxas dos indicados; US$30–200 por usuário | audiência | não |
| Broker de API (corretora paga parte das taxas) | **relatado**: Bybit até 45% | produto com volume | não |
| Bug bounty e concursos de auditoria (Immunefi, Sherlock, Cantina) | **relatado**: Immunefi US$134–140 mi pagos; US$7,87 mi no 1º tri/26; mediana ~US$2 mil | segurança de contratos | não |
| Recompensas de construção (Superteam, Gitcoin, hackathons, grants) | variável por tarefa | código/design/conteúdo | não |
| Comerciante P2P de USDT | **relatado**: 0,3–1% por giro | capital, reputação | não |
| Mesa OTC, caixa eletrônico cripto, pagamentos | margem sobre câmbio | licença/capital | não |
| Conteúdo, comunidade, consultoria, trabalho pago em cripto | variável | audiência/habilidade | não |
| Vender a própria ferramenta (assinatura) | ver `docs/pesquisa-funding-negocio.md` | produto | não |

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
Lastro de mercado (APIs lidas ao vivo): Upbit, Mercado Bitcoin, Kraken, Coinbase, Bitfinex, OKX, Gate, Bitget,
Frankfurter (câmbio do BCE), CriptoYa (Argentina), Polymarket (gamma), DefiLlama (pools), Lido.
