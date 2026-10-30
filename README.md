# Funding Desk

Painel web (PWA simples) para acompanhar e operar **manualmente**:

- **Funding:** arbitragem de funding em perpétuos, Perp × Perp (short onde o funding é mais alto, long onde é mais baixo) e Spot + Perp.
- **Mineração:** mineração solo de Bitcoin Cash com hashrate alugado (NiceHash, MRR), com sinal de valor esperado, planejador de sessão e diário que testa hipóteses.

Abas: Início (copiloto) · **Radar** (alertas, mapas, padrões, players) · Funding (oportunidades, jornada, calculadora) ·
Mineração (agora, jornada, planejar, operar, rede) · Diário · Ajustes.

**Radar** (`radar.js`, testado):
- **Mapa de funding:** moedas × 6 exchanges (Binance, Bybit, Hyperliquid, OKX, Bitget, Gate), com cor por sinal e intensidade e o número sempre visível; mostra o melhor par por moeda e o sentimento dos majors (funding médio de BTC, ETH e SOL).
- **Mapa de mineração:** 9 algoritmos da NiceHash contra a receita da melhor moeda líquida de cada um (WhatToMine). O Scrypt soma LTC + DOGE (merged). Redes com menos de 10 BTC/dia de volume ficam fora; livro com menos de 5 ordens pagando é marcado como raso.
- **Padrões:** margem média do aluguel por hora do dia (histórico do aparelho + servidor).
- **Alertas:** entrada (oportunidade que se mantém ou é estável no histórico), saída (posição abaixo do break-even, mineração que deixa de compensar), risco (sentimento extremo) e oportunidade (alta forte de preço). No aparelho com o painel aberto; no backend a cada 3 min, com Telegram.
- **Players:** onde operar funding, comprar hash, entregar (pools solo) e dados de referência, com links conferidos.

Pesquisa global (6 idiomas), lacunas e roteiro até a execução automática: [`docs/pesquisa-global.md`](docs/pesquisa-global.md).

**Copiloto** (`copilot.js`, testado): cada operação mostra o veredito (Compensa / No limite / Não compensa agora), o porquê
em uma frase, quando passa a compensar e o que fazer. Os números técnicos ficam em "Números" / "Entender os números",
com glossário no Início. Funding ganha o selo de estabilidade (estável, oscila, pico) pelo histórico pago de 72 h.
Mineração compara BTC, BCH e BSV (mesmo hash SHA-256): receita por PH·dia, margem contra o aluguel e variação.

- **Só lê dados públicos.** Não executa ordens e não guarda chaves de API. Não coloque segredos neste repositório.
- HTML/CSS/JS sem build. Lógica pura em `core.js` (testada); interface em `index.html`.
- Diário de posições no `localStorage` do navegador, com exportar/importar CSV e JSON.

## O que é dado real e o que é projeção

| Número | Natureza |
|---|---|
| Funding por exchange e "spread previsto" no scanner | **Dado real, snapshot**: taxa do período corrente, liquidada no próximo pagamento. Muda a cada minuto e pode inverter. |
| Histórico (gráfico), "último pago" | **Dado real**: pagamentos já liquidados. |
| Retorno líquido do ciclo, break-even, "melhor par" | **Projeção**: supõe o spread constante no ciclo, com taxas de tabela editáveis. |
| Fonte "via HL" | Previsto de Binance/Bybit publicado pela Hyperliquid (`predictedFundings`), usado só quando a API direta falha. Sem volume. |
| "Spread agora" nas posições | Snapshot do previsto. O funding recebido de verdade vem do extrato da exchange. |

## Fontes de dados

| Exchange | Endpoints | Observações |
|---|---|---|
| Binance USDⓈ-M | `premiumIndex`, `ticker/24hr`, `fundingInfo`, `exchangeInfo`, `fundingRate` (histórico) | Intervalo padrão 8h; `fundingInfo` lista só símbolos com intervalo/teto ajustado. **Bloqueia IPs dos EUA (HTTP 451).** Do Brasil, direto do navegador: ok (testado em 30/10/2026). |
| Bybit v5 linear | `tickers`, `instruments-info` (paginado, `fundingInterval` em minutos), `funding/history` | **Bloqueia IPs dos EUA (HTTP 403, CloudFront).** Do Brasil, direto do navegador: ok (testado em 30/10/2026). |
| Hyperliquid | `metaAndAssetCtxs`, `predictedFundings`, `fundingHistory` (POST `/info`) | Funding horário. CORS liberado (`*`). |
| OKX | `public/funding-rate?instId=ANY`, `market/tickers?instType=SWAP`, `funding-rate-history` | Intervalo = fundingTime − prevFundingTime. CORS liberado. |
| Bitget | `mix/market/current-fund-rate`, `mix/market/tickers`, `history-fund-rate` (USDT-FUTURES) | Intervalo informado por moeda. CORS liberado. |
| Gate | `futures/usdt/contracts`, `futures/usdt/tickers`, `futures/usdt/funding_rate` | Intervalo em segundos; contratos em delisting ficam fora. CORS liberado. |

Tickers com multiplicador são unificados: `1000PEPE`, `kPEPE`, `SHIB1000`, `1MBABYDOGE` → `PEPE`, `SHIB`, `BABYDOGE`.
Anualização: `% a.a. = taxa por intervalo × 8760 / horas do intervalo × 100` (APR simples, sem juros compostos).

## Mineração: o que o painel calcula

| Número | Como |
|---|---|
| Receita esperada por PH/s·dia (hashprice) | `recompensa × preço ÷ (D × 2^32 / 10^15 / 86400)` |
| Blocos esperados (λ) | `PH/s × 10^15 × segundos ÷ (D × 2^32)`; chances por Poisson |
| Aluguel | preço NiceHash (BTC/EH/dia) ÷ 1000 × BTC × (1 + 3%) + 0,00001 BTC por ordem |
| Sinal | só o aluguel com taxas vs a receita esperada após a taxa do pool. Verde = valor esperado positivo |
| Sorte real (diário) | blocos achados ÷ λ somado, com a chance de o resultado ser só acaso |

Não entram no sinal, porque não mudam a chance de um hash (cada hash é independente): esforço/luck, best share,
tempo desde o último bloco, blocos rápidos/lentos, potência de quem achou o último. Para testar essas teses com dados,
registre as sessões com etiquetas: o diário compara blocos reais com os esperados por etiqueta.

Fontes: WhatsOnChain (BSV), Blockchair (dificuldade, blocos e cotação do BCH; grátis tem limite por IP, por isso a leitura é a cada 5 min),
mempool.space e CoinGecko (BTC), NiceHash (livro de ordens). A NiceHash não aceita chamadas do navegador (CORS):
o workflow publica `data/nicehash.json` a cada ~10 min (o GitHub pode atrasar) ou use o proxy em tempo real.

## Rodar local

```bash
python3 -m http.server 8000
```

Abra http://localhost:8000. Para ter a foto da NiceHash localmente: `node scripts/snapshot-nicehash.js data/nicehash.json`.
Abrir o `index.html` direto do disco funciona, mas sem service worker. Não abra pelo visualizador de arquivos de apps de mensagem: ele bloqueia a rede.

Testes (Node 18+ e nenhuma dependência):

```bash
node --test tests/*.test.js tests/*.test.mjs
```

`diagnostico.html` chama cada endpoint do navegador atual e mostra status, CORS e campos. Use para checar se a sua rede ou região é atendida.

## Publicar (GitHub Pages)

1. Crie o repositório e envie:
   ```bash
   gh repo create funding-desk --public --source . --push
   ```
2. Uma vez só: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. O workflow `.github/workflows/pages.yml` roda os testes e publica a cada push em `main`.
4. Endereço: `https://sr-geovani.github.io/funding-desk/`.

No iPhone: abra no Safari → Compartilhar → **Adicionar à Tela de Início**. Abre em tela cheia, com ícone próprio.

## Atualizar

Edite, rode os testes e faça push em `main`. O deploy leva cerca de 1 minuto. O service worker busca na rede primeiro;
se o app aberto no celular parecer antigo, feche e abra de novo. Ao mudar a lista de arquivos do app, suba `CACHE` em `sw.js`.

## Backend: operação na NiceHash e robô de mineração

O painel continua sem chaves. As chaves da NiceHash ficam **só** no servidor (segredos do Cloudflare Worker).
O painel fala com o backend usando um token seu, guardado apenas no aparelho.

O que o backend faz (`worker/`):
- **Proxy público** de dados de mercado (Binance, Bybit, NiceHash), só leitura, rotas fixas.
- **API** (`/api/*`, exige token): saldo, ordens (criar, preço/potência, reabastecer, cancelar), pools, configuração do robô, log, emergência.
- **Robô** (a cada 3 min):
  - preço máximo = preço de empate − margem mínima, recalculado com dificuldade e cotação do momento;
  - com o mercado no teto ou abaixo: lance logo acima do menor preço ativo, na potência alvo; acima do teto: potência de pausa
    (a NiceHash só deixa baixar o preço 0,01 BTC/EH a cada ~10 min; o robô respeita isso);
  - **bloco pago no seu endereço** (confere a coinbase de cada bloco novo): encerra a ordem, reduz ou continua, conforme escolhido;
  - stop-loss por sessão, limite diário e botão de emergência; avisos no Telegram (opcional).
- Modos: **desligado**, **observar** (calcula e registra, não executa; padrão) e **ativo**.
- Tetos que o servidor impõe a qualquer pedido: `MAX_ORDER_BTC`, `MAX_LIMIT_PH`, `MAX_DAILY_USD` (`worker/wrangler.toml`).
- Começa no **ambiente de teste da NiceHash** (`NH_ENV = "test"`, api-test.nicehash.com). Produção só trocando para `"prod"`.

### Instalar (dá para fazer tudo pelo celular)

1. **Cloudflare** (grátis): crie a conta em dash.cloudflare.com e abra *Workers & Pages* uma vez para escolher o subdomínio `*.workers.dev`.
2. **Token do Cloudflare**: *My Profile → API Tokens → Create Token → modelo "Edit Cloudflare Workers"*. Copie o token
   e o *Account ID* (aparece na página inicial da conta).
3. **GitHub**: no repositório, *Settings → Secrets and variables → Actions → New repository secret*:
   `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
4. **Deploy**: *Actions → "Deploy do backend (Cloudflare Worker)" → Run workflow*. O workflow roda os testes, cria o KV
   `funding-desk-kv` e publica `funding-desk-api`. O endereço fica `https://funding-desk-api.<seu-subdominio>.workers.dev`.
5. **Segredos do Worker**: no Cloudflare, *Workers → funding-desk-api → Settings → Variables and Secrets → Add (tipo Secret)*:
   - `PANEL_TOKEN`: uma senha longa e aleatória (mínimo 24 caracteres), que você vai digitar no painel;
   - `NH_API_KEY`, `NH_API_SECRET`, `NH_ORG_ID`: chave da NiceHash. Crie primeiro em **test.nicehash.com** (conta separada).
     Permissões: ver saldo e gerenciar ordens de hashpower. **Nunca** marque saque/retirada;
   - opcional: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` para avisos.
   (Alternativa: cadastrar esses mesmos nomes como segredos no GitHub; o workflow copia para o Worker.)
6. **Painel**: *Ajustes → Backend*: cole o endereço e o `PANEL_TOKEN` → *Salvar e testar*.
7. **Mineração → Operar**: cadastre o pool (ex.: `solo.blocksniper.ai:3333`, usuário = seu endereço BCH), informe o
   endereço da recompensa, deixe o robô em **Observar** por alguns dias e leia o log. Só depois mude para **Ativo**.
8. Para produção: troque `NH_ENV = "prod"` em `worker/wrangler.toml` (o push publica sozinho) e cadastre as chaves da conta real.

### Testar localmente (sem dinheiro e sem chaves)

`worker/dev/mock.mjs` é uma NiceHash falsa que confere a assinatura de cada pedido com o algoritmo do cliente oficial,
e simula a rede BCH (incluindo "minerar um bloco para o seu endereço"). `worker/dev/server.mjs` roda o Worker no Node.

```bash
node worker/dev/mock.mjs
```

```bash
PANEL_TOKEN=um-token-local-com-mais-de-24-caracteres ALLOWED_ORIGIN=http://localhost:8000 NH_BASE=http://127.0.0.1:9100/nh BCH_REST=http://127.0.0.1:9100/bch PRICE_URL=http://127.0.0.1:9100/cg/x NH_API_KEY=mock-key NH_API_SECRET=mock-secret-0123456789 NH_ORG_ID=mock-org node worker/dev/server.mjs
```

No painel local (`python3 -m http.server 8000`), use o backend `http://localhost:8787` e o mesmo token.
Para simular um bloco: `curl -X POST localhost:9100/_mine -d '{"address":"bitcoincash:q..."}'`.

## Conferência manual com os sites (tarefa pendente)

Para 3 moedas (ex.: BTC, ETH, SOL), anote ao mesmo tempo:
1. A taxa de funding e a contagem regressiva no site de cada exchange.
2. A taxa por intervalo e o horário do próximo funding no painel (cartão da moeda, modo Spot + Perp mostra cada exchange).
3. A diferença deve ser só de alguns segundos de defasagem. Se o intervalo divergir (ex.: 4h vs 8h), é bug de normalização.

## Estrutura

```
index.html        marcação e estilos
app.js            interface (abas, renderização, coleta de dados)
core.js           lógica pura de funding (normalização, parsers, cycle(), scanner, histórico, CSV/JSON)
copilot.js        vereditos, jornadas, momentos e glossário em linguagem simples
radar.js          mapas de funding e mineração, sentimento, padrões, alertas e players
mining.js         lógica pura de mineração (Poisson, hashprice, aluguel, livro NiceHash, blocos BCH, diário)
scripts/          foto do livro da NiceHash (rodada pelo workflow)
diagnostico.html  teste dos endpoints a partir do navegador
sw.js, manifest.json, icons/   PWA
worker/           backend: API, robô, proxy (Cloudflare Workers); worker/dev: NiceHash falsa e servidor local
tests/            node --test; fixtures reais (Hyperliquid, Blockchair, NiceHash) e sintéticas (Binance/Bybit)
```

## Próximos passos

- Sincronização opcional do diário (Supabase ou Cloudflare KV) para usar em mais de um aparelho, sem chaves no front-end
  além de uma chave pública com regras de acesso por usuário.
- Trocar as fixtures sintéticas de Binance/Bybit por respostas reais capturadas do Brasil.
