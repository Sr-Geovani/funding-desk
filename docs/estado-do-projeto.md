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
