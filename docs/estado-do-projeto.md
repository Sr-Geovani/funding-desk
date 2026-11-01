# Estado do projeto (para continuar em outra conversa)

Atualizado em 30/10/2026. Em uma conversa nova, peça: "leia docs/estado-do-projeto.md e o README e continue".

## O que é
Funding Desk: painel web (PWA, HTML/JS sem build) em https://sr-geovani.github.io/funding-desk/ para operar
**arbitragem de funding** (manual) e **mineração com hash alugado** (manual + robô para BCH), com copiloto em PT-BR.
Dono: Geovani. Regras: sem chaves no front-end nem no repositório; textos em português; dado real vs projeção
sempre identificado; nada de prometer previsão de sorte (Poisson é sem memória).

## Arquitetura
| Arquivo | Papel |
|---|---|
| `core.js` | funding: parsers de 6 exchanges (Binance, Bybit, Hyperliquid, OKX, Bitget, Gate), `cycle()`, oportunidades, filtro só cripto, diário CSV/JSON |
| `mining.js` | mineração: Poisson, hashprice, aluguel, livro NiceHash, blocos BCH, diário de sessões |
| `copilot.js` | vereditos em linguagem simples, jornadas, momentos, glossário |
| `radar.js` | mapas de funding e mineração (9 algoritmos, WhatToMine), sentimento, alertas (agora/histórico), pools e players |
| `insights.js` | plano do ciclo, curto prazo, ficar/sair/trocar, backtest, meta, previsão de mineração, plano combinado |
| `app.js` / `index.html` | interface: Início, Radar, Funding, Mineração (Agora, Jornada, Planejar, Algoritmos, Operar, Rede), Diário, Ajustes |
| `worker/` | backend Cloudflare: API com token, contas (NiceHash/Telegram) cifradas no KV via painel (`creds.js`), robô (cron 3 min), alertas + Telegram, proxy |
| `scripts/deploy-backend.sh` | instala/atualiza o backend só com um token do Cloudflare e imprime o link de conexão do painel |
| `tests/` | `node --test tests/*.test.js tests/*.test.mjs` (NiceHash e Telegram falsos em `worker/dev/mock.mjs`) |
| `.github/workflows/` | `pages.yml` (testes + Pages + fotos de mercado), `worker.yml` (testes + deploy do backend + resumo) |

## Decisões importantes
- Funding: o painel **não executa** ordens; recomenda e registra. Regra de permanência: ficar enquanto o funding for
  positivo (entrada já paga), sair quando negativo; trocar só se o ganho extra cobrir a nova entrada e saída.
- Mineração: veredito = aluguel (mediana NiceHash + 3%) vs receita (após 2% do pool). Livro com < 5 ordens pagando
  = "raso" (no máximo "no limite"). Moedas com < 10 BTC/dia de volume ficam fora do mapa principal.
- Robô (backend): só SHA-256/BCH solo; modos off/observe/active; teto = empate − margem; encerra quando a coinbase
  paga o endereço; stop-loss, limite diário, emergência. Outros algoritmos: ordem manual (aba Algoritmos guia).
- Alertas: "Agora" = condições ativas (somem sozinhas); histórico 7 dias com começo/fim; Telegram: saída/risco na hora,
  entradas em resumo de 30 min.

- NiceHash: o mercado SHA-256 líquido é o **SHA256ASICBOOST** (≈ 19 EH/s, centenas de ordens). O "SHA256" puro
  tem poucas ordens; painel, robô, radar e fotos usam ASICBOOST (`NH_ALGO` no Worker troca, se preciso).
  Unidades: mínimo 1 PH/s, preço só desce 0,002 BTC/EH a cada ~10 min. Pools da ordem precisam ser do mesmo algoritmo.
- Cotações no backend: CoinGecko → Kraken → Coinbase (a CoinGecko bloqueia o Cloudflare).
- Simulação (modo Observar, `worker/src/paper.js`): a cada ciclo soma o que o robô teria gasto, a receita média
  esperada (λ × valor do bloco) e a chance de ≥1 bloco; não sorteia blocos. Resultado real (Ativo): gasto pago nas
  ordens gerenciadas + blocos no endereço. Ambos por dia (30 dias), em Operar.
- Alertas do servidor entram no histórico do Radar de cada aparelho (Safari, atalho e outros ficam iguais).
- Diário → Robô (simulado): operações simuladas com regras fixas, registradas na hora (sem olhar o futuro).
  Funding (`worker/src/paperfund.js`): entra após 2 leituras "Compensa" (até 3, uma por moeda, US$1.000, 2x),
  recebe/paga nos horários de cada exchange com a taxa prevista, sai com diferença ≤ 0 em 2 leituras; taxas taker
  nas 4 execuções + 0,03%. Mineração: cada "compraria → pausaria" vira uma operação (gasto, receita média, chance).
- Placar dos alertas de funding (`alertScoreStep`): cada alerta de entrada vira posição hipotética pelo prazo projetado
  (3 dias), sem saída antecipada; realizado = pagamentos − taxas; acerto = positivo. Em Diário → Robô e resumo no Radar.
- Mineração simulada com sorteio honesto: cada bloco real da rede BCH achado enquanto o robô estaria comprando seria
  "seu" com chance = potência ÷ (rede + potência); o número sorteado são os últimos 32 bits do hash do bloco (ninguém
  controla). Bloco encerra a operação (como o robô real) e ela reabre se o mercado seguir favorável.
- Mineração simulada mostra os desfechos reais: sem bloco (o mais provável) perde o aluguel; com bloco, bloco − aluguel;
  a média de longo prazo é separada. Simulação (Operar) e Diário usam os mesmos totais.
- Outras moedas (`worker/src/paperalgo.js`): a cada 15 min o servidor monta o mesmo mapa de mineração do painel
  (WhatToMine + livros da NiceHash) e simula pool PPS com orçamento igual por algoritmo (US$100/dia enquanto
  "Compensa"); PPS não tem sorte de bloco, então o resultado é o esperado. Margem > 100% é ignorada (dado suspeito).
- Horários: cabeçalho com hora local e UTC; diário e log mostram as duas; dias das tabelas são UTC.
- IA do funding em modo sombra: `scripts/train-funding-model.mjs` treina um modelo logístico (90 dias de funding pago de
  Hyperliquid, OKX e Bitget; teste fora da amostra) e grava `worker/src/fundmodel.js` + `docs/modelo-funding.md`.
  O servidor guarda o previsto de hora em hora (KV `fhist`, 72 h), dá nota aos pares (`fundai.js`) e roda o robô
  "Regras + IA" ao lado do "Regras"; o placar registra a nota da IA em cada alerta. Retreinar: rodar o script e publicar.
- Mineração: variante "rajada" (50 PH/s, para no bloco, método do vídeo) ao lado da contínua, mesmos blocos e sorteio.
- Registro dos blocos da rede BCH (`worker/src/blocks.js`, KV `blocks`, até 600): pool pela assinatura do coinbase
  (solo ou não), intervalo, tamanho, transações, recompensa, taxas, taxa do pool solo, hash da rede e, ao vivo, hash
  alugado na NiceHash, preço, empate, margem e a simulação (potência, chance, sorteio). `/api/blocks` + resumo de
  padrões; `/api/blocks/backfill` busca blocos anteriores (só blockchain). Tela: Mineração → Rede, com CSV.
- Funding (regra validada, 31/10): "Compensa" exige diferença acima do empate nas últimas 24 h seguidas; execução padrão
  maker (ordem limite). Painel: histórico pago de 72 h (`stable24` em `ensureStability`). Servidor: `stablePairs` sobre o
  histórico horário próprio (`fhist`), precisa de 24 h; `fundStable24` na config desliga. Simulações e placar com taxa maker.
  Enquanto o servidor não tem 24 h, o painel envia os pares que conferiu (`POST /api/funding/verified`, válidos 6 h,
  só com esperado positivo) e o robô de funding usa essa conferência.
- Mineração: abas em grade 3 × 2; Rede com uma lista só de blocos (servidor; Blockchair sem backend) e cartão de padrões.
- iPhone: barra inferior reancorada pelo visualViewport ao voltar do segundo plano.
- Sinais além da sorte (`worker/src/signals.js`, pesquisa em `docs/pesquisa-mineracao.md`): DARR (BCH paga por hash ÷
  BTC paga) a cada ciclo, com dificuldade e taxas do BTC (mempool.space) e BCH/BTC horário (Kraken) a cada 15 min;
  reajuste do BTC com DARR previsto; BCH/BTC contra a média de 2 dias; medidor "janela fechando" (blocos/hora e fatia
  dos pools que trocam de moeda); gravador do livro da NiceHash por hora da semana (`nhWeek`) e preço FIXED.
  Tela: Mineração → Agora ("Janela do BCH"); Rede: mapa hora × dia e auditoria dos pools solo.
- Funding: meia-vida (AR(1)) da diferença no histórico de 72 h; "Compensa" exige também esperado positivo pela meia-vida.
  Servidor guarda `pairStats` dos pares acompanhados.
- Copiloto IA (`worker/src/brain.js`): a cada ciclo junta todos os sinais e cria previsões conferíveis (8 tipos:
  compra BCH, janela abre, dificuldade sobe, evitar alugar, DARR pós-reajuste, funding paga as taxas, pico some,
  outra moeda segue). No prazo, confere com dados reais: acerto dá XP (até 15), erro 1. Confiança por tipo aprende com
  o histórico (Laplace); tipos com 20+ conferidas e 60%+ viram "confiáveis". Níveis: Aprendiz → Analista (30) →
  Estrategista (100, ≥55%) → Mestre (300, ≥60%). Tela: barra no topo + cartão no Início. Log com eventos "ia".
- Rede: cartão "Próximo bloco" (tempo desde o último, média, mempool, dificuldade exata do próximo, hash da rede);
  confirmações nos detalhes de cada bloco.
- Plano de ação (`actionPlan`): potência = orçamento da sessão (stop-loss) ÷ (custo por PH/s/h × 2 h), até o teto e 5% do
  mercado; recalculado na hora ao salvar a configuração; mostra "sua configuração × sugestão". Ajustes do operador ficam
  em `opLog` (e no log como "operador"). Simulação roda 3 cenários com os mesmos blocos: sua config, copiloto, rajada 50.
- Painel (31/10): atualiza ao voltar do segundo plano e em qualquer aba (`freshen`: servidor 60 s, mineração 5 min,
  funding 2 min); leitura presa (iPhone congela o fetch em segundo plano) destrava em 45 s; barra da IA mostra a hora
  dos dados do servidor e avisa se ele parou. Antes, Robô/Rede/IA só recarregavam ao abrir o app ou entrar em Operar.
- IA, XP v2 (31/10): previsões fáceis (o que está aí continua: compra segue boa, evitar alugar, pico some, outra moeda
  segue) valem 2 XP; difíceis (janela abre, dificuldade sobe, DARR pós-reajuste, funding paga) valem 10 (+5 se o tipo é
  confiável); erro 0. Nível exige difíceis conferidas e acerto nelas. XP antigo refeito com o peso novo.
- Outras moedas, margem realista (31/10): a WhatToMine usa a dificuldade do momento; DOGE e DASH reajustam a cada bloco
  e num vale mostravam +20% (Scrypt) e +130% (X11). Agora: dificuldade média de 24 h quando a do momento está abaixo,
  pool PPS 4%, shares perdidos e venda 2,5%; mercado que gasta < US$1.000/dia é "livro raso". `rawEdgePct` guarda a
  conta bruta. Simulação de outras moedas recomeçou (v2).
- Mineração: cenário "sempre ligado" (sua potência, sem pausar nem stop-loss, mesmos blocos); simulação baixa o preço
  só um degrau a cada 10 min, como a NiceHash e o robô real.
- Auditoria 100% (31/10, `docs/auditoria-ia-e-simulacoes.md`): stop-loss por tentativa com espera (`stopCooldownH`,
  robô e simulação); IA confere com a régua do robô, reajuste só depois de acontecer, funding acompanhado pela própria
  IA, grupo de controle (vantagem sobre o acaso; nível 3+ exige > 0), calibração (Brier) e "não conferidas"; sorteio
  só no trecho cobrado e chance = h ÷ rede; funding mostra "se 1 perna fosse a mercado".
- Fornecedores (`docs/fornecedores-hash.md`, `worker/src/hashmarkets.js`): Braiins Hashpower e MiningRigRentals lidos a
  cada 15 min (`hashMkts`); `POST /api/pool/check` confere extranonce2 do pool (Braiins exige ≥ 7) via Stratum.
- Início → "Resultado financeiro" (31/10): Simulado × Real. Simulado soma as simulações do servidor (mineração BCH,
  outras moedas, funding) com "sem sorte" (média esperada); Real soma o robô na NiceHash (`real`), as sessões e posições
  do Diário e os aportes/retiradas que o usuário registra (`fd_cash`, só no aparelho). Gráfico do resultado acumulado
  por dia (UTC), tabela por dia. Servidor: `algoPaper.days` e totais de funding (`fundingUsd`, `feesUsd`, `capitalUsd`).
- Frentes em observação (31/10, `docs/pesquisa-frentes.md`, `worker/src/fronts.js`): a cada 15 min, fora do ciclo do
  mapa de mineração, lê Lighter (funding de Binance/Bybit/HL/Lighter normalizado por 8 h e contratos em aberto),
  Bitfinex (empréstimo de USDT), Deribit (base de futuros), Ethena, HLP, zpool (pago de fato), Mercado Bitcoin + PTAX
  (ágio) e CDI. `frontsPaper`: US$1.000 por frente passiva com o CDI ao lado; `fronts.hist` 60 dias. `fundPaperLT`:
  robô simulado de funding com uma perna na Lighter (taxa zero), regra de 24 h acima do empate (`ltStreak`), só
  cripto e OI ≥ US$300 mil. Tela: Radar → "Frentes em observação"; Início → Simulado inclui o robô da Lighter.
- Catálogo global de frentes (31/10, `docs/catalogo-frentes-cripto.md`): ~45 frentes em 6 grupos (mineração e outros
  "hashes", validação, DeFi, trading, eventos de tokens, serviços) com número medido, risco e prioridade. O monitor das
  frentes ganhou ASIC próprio (`asicOf`: hashprice e lucro/dia por preço de energia) e GPU (`gpuOf`: moedas que mais
  pagam por placa, WhatToMine `coins.json`). MiningRigRentals passou a ler o SHA-256 AsicBoost (`sha256ab`), o mercado
  certo (o simples é pequeno e mais caro).
- Lastro neutro (31/10): catálogo sem veredito nem filtro (`docs/catalogo-frentes-cripto.md`, ~70 frentes com número,
  requisitos, variáveis e acesso como informação). `market2` (a cada 30 min, num ciclo livre): ágio local (Coreia/Upbit,
  Brasil/Mercado Bitcoin, Argentina/CriptoYa) sobre BTC/USD da Kraken e câmbio do BCE (Frankfurter); BTC entre 7
  cotações (Kraken, Coinbase, Bitfinex, OKX, Gate, Bitget); Polymarket (recompensa de liquidez, 20 mercados de maior
  volume); rendimentos de referência da DefiLlama (stETH, jitoSOL, Aave USDC/USDT, sUSDS). O cartão das frentes não dá
  veredito: mostra os números e a distância até o CDI.
- Panorama do mercado (copiloto, 31/10, `worker/src/panorama.js`): a cada ciclo junta frentes + lastro e escreve regime
  (alavancagem quente/neutra/fria pela base, FRR, sUSDe e funding dos majors), demanda local (ágios), mineração (hashprice,
  DARR) e juros (CDI, juro real pelo Focus, CDI − T-bill); ranking do retorno anual medido de tudo, com o CDI ao lado;
  tetos teóricos (Polymarket) separados; mudanças em 7 dias. `market2.macro`: Selic, IPCA 12 m, Focus, T-bill 13 semanas.
  Telas: Início (cartão do copiloto) e Radar (topo das frentes). Catálogo ganhou o grupo G (fora de cripto).
- Preço real do hash (31/10): o livro só conta ordens com máquinas (`rigsCount > 0`) em `parseBook`, `bookPerHash` e
  `parseNiceHashBook`; antes, ordens sem máquinas com velocidade média > 0 baixavam o "menor preço recebendo" de ~0,4254
  para 0,40 e a simulação comprava ~6% barato demais. Simulações de mineração arquivadas (`paperArchive`, `paperPriceV: 2`)
  e recomeçadas. Potência ideal (IA, `powerPlan`): lucro esperado por dia em cada potência com lance pela profundidade
  do livro (`book.depth`), sorte de 1 dia e capital mínimo pelo critério de Kelly (bloco ÷ 2 × margem); o plano nunca
  passa da potência que mais lucra e mostra 0 PH/s quando nenhuma tem lucro esperado.
- Placar da sorte (31/10, `luckBoard` em `worker/src/blocks.js`, `/api/blocks` → `luck`): para 6 h, 24 h e 3 dias, quem
  estivesse ligado o tempo todo com 10–500 PH/s: blocos que seriam seus (potência mínima de cada bloco = sorteio × hash da
  rede), esperado, custo no preço de cada momento (mediana registrada do livro), receita, lucro e %. Testes de padrão
  em todo o registro (correlação entre blocos seguidos, "fácil depois de fácil", hora do dia, qui² dos sorteios): com
  1.039 blocos reais de 7 dias, tudo dentro do acaso. Tela: Mineração → Rede.
- Cartilha de entrada (mineração): `worker/src/entry.js` avalia a cada ciclo os 9 fatores em sequência (margem real na NiceHash, margem sem taxa na Braiins, DARR, BCH/BTC × média de 2 dias, blocos em 6 h, reajuste do BTC, horário, potência ideal e capital, a tentativa) e dá o veredito (entrar, cautela, esperar, não entrar); fica em `entryCheck` no status e aparece em Mineração → Agora. Explicação do ecossistema e da sequência: `docs/cartilha-mineracao.md`.
- Cenários (01/11): Diário → Robô mostra uma tabela só, uma linha por cenário (blocos, custo, lucro com sorte, média). Em cima os 4 acompanhados ao vivo (Sua, Copiloto, Rajada, Sempre ligado); embaixo os 5 que teriam dado mais lucro em dólar e os 5 com mais lucro por dólar gasto ("Eficiente", sem repetir os primeiros) na mesma janela, calculados pelo servidor a cada 15 min (`bestScenarios` em `worker/src/replay.js`, `state.bestScen`): 112 combinações de potência (10–500 PH/s) × entrada (sempre, margem ≥ −1%, ≥ 0, ≥ mínimo) × stop-loss (sem, US$150, o seu, US$600), com os mesmos blocos e o mesmo sorteio e o preço gravado em cada bloco (antes da correção de 31/10: +5,8%). São retrovisor: mostram o que teria ganhado mais, não o que vai ganhar.
- Preço pelo tamanho (01/11, `sizeMarket` em `worker/src/bot.js`): o lance passa a ser o do nível do livro em que o hash acumulado chega na potência alvo, não o da ordem mais barata recebendo (que às vezes tem só 1–2 máquinas). Antes, uma ordem minúscula deixava o sinal verde por alguns minutos (ex.: bloco 975490: compra a ~0,404 no ciclo anterior, registro a 0,4262 com margem −2,3%). Rajada e Copiloto usam o preço da própria potência. O registro de cada bloco guarda o preço e a margem em que o cenário Sua estava comprando (`simBid`, `simEdge`).
- Margem do mercado (01/11, `marginStats` em `worker/src/signals.js`, `state.mktMargin`): média, mediana, % do tempo com margem ≥ 0 e ≥ o mínimo, e posição da margem de agora, em 24 h e 7 dias (leituras de antes de 31/10 com preço corrigido). Aparece na cartilha (Mineração → Agora) e na análise da IA, que compara o momento com o mercado e, quando o mínimo quase nunca acontece, explica que o caminho é custo menor, não baixar o mínimo.
- Código só de leitura (01/11): Ajustes → "Acesso só leitura (suporte)" gera um código derivado do token do painel (HMAC) que só abre GET `/api/status` e `/api/blocks`, sem endereço, chaves e Telegram. Para revogar, trocar o PANEL_TOKEN.
- IA e cartilha "onde a chance é maior" (01/11): em vez de só dizer para não entrar, mostram a faixa de margem dos 10% e 25% melhores momentos, os horários (Brasília) com melhor margem média e o DARR nesses momentos (`marginStats`: `top10`, `top25`, `bestHours`, `darrTop`).
- IA que aprende a faixa (01/11, `bandStep`/`bandThreshold` em `worker/src/brain.js`, `ai.band`): a cada leitura de margem (15 min) confere se a média das 2 horas seguintes ficou positiva, agrupa por faixa de 1 ponto (peso cai à metade em ~1 semana) e define a faixa boa (a partir de onde mais de 60% deu positivo, mínimo 8 casos). Guarda o próprio placar (vezes em que disse "faixa boa" e acertou). A análise diz o motivo da pausa com a média do mercado, sugere a margem mínima (aumentar, manter ou ajustar), os horários e os limites do usuário; texto sem símbolos (`plain`). Tabela por faixa na cartilha.
- Funding simulado: saída só quando a diferença fica negativa ou zero por 1 h (antes eram 2 leituras de 3 min: 4 operações em 31/10–01/11 saíram em 4,7 h em média, pagando taxa à toa).
- Margem de erro e lucro esperado (01/11): a faixa aprendida só vale se o lucro esperado das 2 h seguintes, já descontado 0,5 ponto de execução, ficar positivo no limite de baixo do intervalo (80%) e o acerto ficar acima de 50% no limite de baixo (Wilson). Placar da faixa com intervalo.
- Teste fora da amostra (01/11): os melhores cenários escolhidos na 1ª metade da janela são conferidos na 2ª metade (`bestScen.oos`), pela sorte e pela média.
- Limite de perda semanal (01/11, `weeklyLossUsd`, padrão US$1.000): perda real em 7 dias (gasto − recebido) acima do limite encerra as ordens, bloqueia novas e avisa no Telegram; a simulação segue a mesma regra.
- Previsão ASERT (01/11, `asertForecast` em `worker/src/signals.js`): dificuldade em 1, 6 e 24 h pelo ritmo de blocos (fator 2^((600·b·H − 3600·H)/172800)) e a margem depois disso.
- Registro de execução (01/11, `execStep`/`execSummary` em `worker/src/paper.js`, modo Ativo): por ordem do robô, tempo até o hash chegar, entrega média e preço efetivo; cartão "Execução real (calibração)" em Mineração → Operar.
- Relatório do copiloto (01/11, `worker/src/report.js`, `state.aiReport`): padrão de nota de mercado (manchete com selo, números do momento, por que está assim, o que esperar, níveis de decisão concretos, o que fazer, ajustes sugeridos, riscos, confiança da IA, funding e outras moedas). Cartilha: cada passo com "Leitura" (o que o valor de agora significa) e "Por que importa". Referências: notas matinais de mesa e Hashrate Index (Luxor), em `docs/pesquisa-metodos.md`.
- Ciclo do servidor: 3 min. Mínimo do Cloudflare é 1 min, mas o KV grátis aceita 1.000 gravações/dia e propaga em até
  60 s; abaixo de 3 min exige plano pago + Durable Objects. Atraso de 3 min custa < US$1 com 10 PH/s.

## Estado e pendências
- [x] Painel publicado; dados ao vivo validados do Brasil (Binance/Bybit diretos no iPhone).
- [x] **Backend no Cloudflare** publicado pelo workflow em `https://funding-desk-api.<subdomínio>.workers.dev` (KV e ENC_KEY criados).
      Obs.: o segredo `CLOUDFLARE_ACCOUNT_ID` do GitHub guarda o comando de teste (curl), não o ID; o script descobre a conta pelo token.
- [ ] `PANEL_TOKEN`: segredo no GitHub (o workflow grava no Worker) e link de conexão no celular.
- [ ] NiceHash (teste, sem saque) e Telegram em Ajustes → Conectar contas (nunca no chat).
- [ ] Proxy da Binance pelo Worker responde 403 (bloqueio de região do Cloudflare/EUA); o painel usa chamada direta do Brasil.
- [ ] Validar robô em Observar (NiceHash de teste), depois ambiente Produção em Conectar contas.
- [ ] Funding automático: exige servidor no Brasil (Binance/Bybit bloqueiam EUA), chaves de trade sem saque.
- [ ] Robô multi-algoritmo (pool PPS) para Scrypt/RandomX/Equihash etc.
- [ ] Mais exchanges: dYdX (CORS ok), MEXC e KuCoin (via backend).
