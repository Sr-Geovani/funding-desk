# Funding Desk

Painel web (PWA simples) para acompanhar e operar **manualmente** arbitragem de funding em perpétuos:
Perp × Perp (short onde o funding é mais alto, long onde é mais baixo) e Spot + Perp.

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
| Binance USDⓈ-M | `premiumIndex`, `ticker/24hr`, `fundingInfo`, `exchangeInfo`, `fundingRate` (histórico) | Intervalo padrão 8h; `fundingInfo` lista só símbolos com intervalo/teto ajustado. **Bloqueia IPs dos EUA (HTTP 451).** |
| Bybit v5 linear | `tickers`, `instruments-info` (paginado, `fundingInterval` em minutos), `funding/history` | **Bloqueia IPs dos EUA (HTTP 403, CloudFront).** |
| Hyperliquid | `metaAndAssetCtxs`, `predictedFundings`, `fundingHistory` (POST `/info`) | Funding horário. CORS liberado (`*`). |

Tickers com multiplicador são unificados: `1000PEPE`, `kPEPE`, `SHIB1000`, `1MBABYDOGE` → `PEPE`, `SHIB`, `BABYDOGE`.
Anualização: `% a.a. = taxa por intervalo × 8760 / horas do intervalo × 100` (APR simples, sem juros compostos).

## Rodar local

```bash
python3 -m http.server 8000
```

Abra http://localhost:8000. Abrir o `index.html` direto do disco também funciona, mas sem service worker.

Testes (Node 18+ e nenhuma dependência):

```bash
node --test tests/*.test.js
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

## Proxy opcional (se Binance/Bybit falharem no seu navegador)

`worker/proxy.js` é um Cloudflare Worker que só repassa **GET** de uma lista fechada de endpoints públicos. Ele não usa chaves.

```bash
cd worker
npx wrangler deploy
```

Depois cole a URL do Worker em **Risco → Fonte de dados**. O painel só usa o proxy quando a chamada direta falha.
Restrinja `ALLOWED_ORIGIN` ao domínio do painel. Atenção: o Worker roda no data center da Cloudflare mais próximo
de quem acessa, mas a Binance e a Bybit podem bloquear IPs da Cloudflare. Teste com `diagnostico.html` usando o proxy.

## Conferência manual com os sites (tarefa pendente)

Para 3 moedas (ex.: BTC, ETH, SOL), anote ao mesmo tempo:
1. A taxa de funding e a contagem regressiva no site de cada exchange.
2. A taxa por intervalo e o horário do próximo funding no painel (cartão da moeda, modo Spot + Perp mostra cada exchange).
3. A diferença deve ser só de alguns segundos de defasagem. Se o intervalo divergir (ex.: 4h vs 8h), é bug de normalização.

## Estrutura

```
index.html        interface
core.js           lógica pura (normalização, parsers, cycle(), scanner, histórico, CSV/JSON)
diagnostico.html  teste dos endpoints a partir do navegador
sw.js, manifest.json, icons/   PWA
worker/           proxy opcional (Cloudflare Workers)
tests/            node --test; fixtures reais (Hyperliquid) e sintéticas (Binance/Bybit)
```

## Próximos passos

- Sincronização opcional do diário (Supabase ou Cloudflare KV) para usar em mais de um aparelho, sem chaves no front-end
  além de uma chave pública com regras de acesso por usuário.
- Trocar as fixtures sintéticas de Binance/Bybit por respostas reais capturadas do Brasil.
