# Configurar o backend (passo a passo)

O backend é um Cloudflare Worker na **sua** conta. Ele guarda as chaves da NiceHash (o painel nunca vê), roda o robô
de mineração a cada 3 min, lê o livro da NiceHash em tempo real e manda alertas no Telegram 24 h. Plano grátis.
O mesmo passo a passo está no painel: **Ajustes → Configurar o backend**. Tudo dá para fazer pelo celular.

## 1. Conta no Cloudflare
1. Crie em <https://dash.cloudflare.com/sign-up> e confirme o e-mail.
2. Abra **Workers & Pages** (<https://dash.cloudflare.com/?to=/:account/workers-and-pages>) uma vez e escolha o
   subdomínio `*.workers.dev`. Sem isso o deploy falha.

## 2. Token do Cloudflare
1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → modelo **Edit Cloudflare Workers** →
   **Use template** → **Continue to summary** → **Create Token**.
2. Copie o token (aparece uma vez só).
3. Copie o **Account ID** (lateral direita de Workers & Pages, ou na página inicial da conta).

## 3. Token do painel
No painel: Ajustes → Configurar o backend → **Gerar token do painel** → Copiar. Ele já fica salvo no aparelho.
(Ou qualquer senha aleatória com 24+ caracteres.)

## 4. Segredos no GitHub
<https://github.com/Sr-Geovani/funding-desk/settings/secrets/actions/new>, um por vez:

| Nome | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token do passo 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID do passo 2 |
| `PANEL_TOKEN` | token do passo 3 |

Segredos do GitHub ficam cifrados, não aparecem no código e não são visíveis depois de salvos.

## 5. Publicar
<https://github.com/Sr-Geovani/funding-desk/actions/workflows/worker.yml> → **Run workflow** → **Run workflow**.
Em ~2 min, abra a execução: o **resumo** mostra o endereço (`https://funding-desk-api.<subdominio>.workers.dev`),
se ele respondeu e o que ainda falta. Cada push em `worker/`, `core.js`, `radar.js` ou `copilot.js` publica de novo.

## 6. Conectar o painel
Ajustes → **Backend (operação)** → cole o endereço → **Salvar e testar**. Deve aparecer "Conectado. NiceHash: teste".

## 7. NiceHash de teste (sem dinheiro real)
1. Conta em <https://test.nicehash.com>.
2. Configurações → **Chaves de API** → nova chave com permissão para **ver saldos** e **gerenciar ordens de hashpower**.
   **Nunca** marque saque/retirada.
3. Copie a chave, o segredo e o **Organization ID** (mesma página).
4. Segredos no GitHub: `NH_API_KEY`, `NH_API_SECRET`, `NH_ORG_ID`. Rode o passo 5 de novo.

Alternativa: cadastrar as chaves direto no Cloudflare (Workers → funding-desk-api → Settings → Variables and Secrets →
Add → tipo Secret). Assim elas ficam só no Cloudflare.

Observação: no ambiente de teste da NiceHash, a criação de ordens SHA-256 pode estar desligada. Saldo, ordens e pools
servem para validar a conexão; a criação de ordens fica validada pelos testes automáticos e, depois, na conta real.

## 8. Telegram
1. No Telegram, fale com **@BotFather** → `/newbot` → escolha nome → copie o token.
2. Mande "oi" para o seu bot.
3. Abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e copie o número em `"chat":{"id":...}`.
4. Segredos `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. Rode o passo 5.

Saída e risco chegam na hora; entradas e oportunidades chegam em resumo a cada 30 min.

## 9. Validar e ir para produção
1. Mineração → Operar: endereço BCH (sua carteira), pool (ex.: `solo.blocksniper.ai:3333`, usuário = endereço) e
   robô em **Observar**. Deixe alguns dias e leia o log: ele registra o que faria.
2. Produção: em `worker/wrangler.toml`, troque `NH_ENV = "test"` por `NH_ENV = "prod"`, ajuste os tetos
   (`MAX_ORDER_BTC`, `MAX_LIMIT_PH`, `MAX_DAILY_USD`) ao seu risco e troque os segredos NH_* pelos da conta real.
3. Robô em **Ativo** só depois disso. O botão de emergência (Operar) desliga o robô e cancela as ordens dele.

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| Resumo diz "Backend não publicado" | Faltam `CLOUDFLARE_API_TOKEN` ou `CLOUDFLARE_ACCOUNT_ID` |
| Deploy falha com "workers.dev subdomain" | Passo 1.2 não feito |
| Painel diz "token inválido" | `PANEL_TOKEN` do GitHub diferente do salvo no aparelho, ou com menos de 24 caracteres |
| Painel diz "origem não permitida" | Painel aberto fora de `https://sr-geovani.github.io` (ajuste `ALLOWED_ORIGIN`) |
| "Chaves da NiceHash não configuradas" | Passo 7 não feito ou workflow não rodado depois |
