# Configurar o backend

O backend é um Cloudflare Worker na **sua** conta (plano grátis). Ele roda o robô de mineração a cada 3 min, lê o livro
da NiceHash em tempo real, guarda as chaves da NiceHash e do Telegram **cifradas** e manda alertas 24 h.
O painel nunca guarda essas chaves.

## Jeito fácil (você só cria um token)

1. **Conta no Cloudflare**: <https://dash.cloudflare.com/sign-up>, confirme o e-mail.
2. **Token**: <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → modelo **Edit Cloudflare Workers** →
   **Use template** → em *Account Resources* escolha a sua conta e em *Zone Resources* "All zones" →
   **Continue to summary** → **Create Token**. Copie o token (aparece uma vez só).
3. **Instalar**: mande o token para o Claude, ou rode você mesmo:
   ```bash
   CLOUDFLARE_API_TOKEN=... bash scripts/deploy-backend.sh
   ```
   O script confere o token, acha a conta (Account ID), cria o subdomínio `*.workers.dev` e o KV se faltarem,
   publica o Worker, cria os segredos `PANEL_TOKEN` e `ENC_KEY` (só se faltarem) e testa `/health`.
   No fim imprime um **link** que abre o painel já conectado.
4. **Abrir o link no celular**: o painel pede confirmação e guarda o endereço e o token neste aparelho.
5. **Ajustes → Conectar contas**:
   - **NiceHash**: use a sua conta normal (nicehash.com) com Ambiente **Produção**. É seguro: o robô começa em
     **Observar** (só registra, não compra nada) e o servidor impõe tetos de gasto. A conta de teste
     (<https://test.nicehash.com>) é opcional: é um site separado, sem login pelo Google, com e-mail e senha próprios, e
     nele a criação de ordens SHA-256 costuma estar desligada.
     Ligue a verificação em duas etapas (Configurações → Segurança), depois Configurações → Chaves de API → criar chave
     com permissão só para **ver saldos** e, no marketplace de hashpower, **ver e gerenciar pedidos** e **pools**.
     **Nunca** marque saque (withdraw) nem endereços de saque. Confirme a chave no e-mail da NiceHash. Cole API Key,
     API Secret e Organization ID → **Salvar e conferir**. O backend testa a chave lendo o saldo antes de salvar e, se
     ela for do outro ambiente, avisa e troca a escolha.
   - **Telegram**: no Telegram, **@BotFather** → `/newbot` → copie o token → cole → **Conectar**. Ele pede para você
     mandar "oi" para o seu bot; mande e toque em **Conectar** de novo. O backend acha o seu chat e manda uma
     mensagem de teste.
6. **Mineração → Operar**: endereço BCH (sua carteira), pool (ex.: `solo.blocksniper.ai:3333`, usuário = endereço) e
   robô em **Observar** por alguns dias, lendo o log.
7. **Operar de verdade**: depois de alguns dias em Observar, mude o robô para **Ativo**. Se usou a conta de teste antes,
   troque para Produção em Conectar contas: o robô volta para Observar e esquece ordens e pool do teste. Ajuste os tetos
   (`MAX_ORDER_BTC`, `MAX_LIMIT_PH`, `MAX_DAILY_USD` em `worker/wrangler.toml`) ao seu risco antes do modo **Ativo**.

Depois de instalado, o token do Cloudflare pode ser revogado (o backend continua rodando). Para atualizar o backend
no futuro: crie outro token e rode o script de novo, ou cadastre `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` nos
segredos do GitHub para publicar sozinho a cada push (seção abaixo). Rodar o script de novo mantém o `PANEL_TOKEN` e
o `ENC_KEY`; `ROTATE_PANEL_TOKEN=1` gera um token do painel novo (e um link novo).

### Como as chaves ficam guardadas
- O formulário envia as chaves por HTTPS direto para o **seu** backend. O painel não grava nada delas no aparelho.
- O backend cifra com AES-GCM usando o segredo `ENC_KEY` do Worker e grava no KV. No painel do Cloudflare, o KV
  mostra só texto cifrado; o `ENC_KEY` não pode ser lido de volta.
- Nenhuma rota devolve as chaves: o status mostra só "conectada", o ambiente e os 4 últimos caracteres da API Key.
- Chaves cadastradas pelo painel têm prioridade sobre segredos `NH_*`/`TELEGRAM_*` cadastrados direto no Cloudflare.
- Nunca troque o `ENC_KEY`: as contas salvas ficariam ilegíveis (bastaria cadastrar de novo).

## Jeito manual (GitHub Actions)

1. Conta no Cloudflare e abra **Workers & Pages** uma vez para escolher o subdomínio `*.workers.dev`.
2. Token como no passo 2 acima; copie também o **Account ID** (lateral de Workers & Pages).
3. Segredos no GitHub (<https://github.com/Sr-Geovani/funding-desk/settings/secrets/actions/new>):
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `PANEL_TOKEN` (senha aleatória com 24+ caracteres).
4. <https://github.com/Sr-Geovani/funding-desk/actions/workflows/worker.yml> → **Run workflow**. O workflow roda os testes,
   cria o KV, publica, cria o `ENC_KEY` se faltar e mostra no resumo o endereço e se ele respondeu.
   Cada push em `worker/`, `core.js`, `radar.js` ou `copilot.js` publica de novo.
5. Painel: Ajustes → **Backend (operação)** → endereço e token → **Salvar e testar**. Depois siga do passo 5 do jeito fácil.

Observação: no ambiente de teste da NiceHash, a criação de ordens SHA-256 pode estar desligada. Saldo, ordens e pools
servem para validar a conexão; a criação de ordens fica validada pelos testes automáticos e, depois, na conta real.

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| Script: "Token recusado" | Token copiado pela metade, ou revogado |
| Script: "O token enxerga N contas" | Defina `CLOUDFLARE_ACCOUNT_ID` com uma das contas listadas |
| Saúde "sem resposta" logo após instalar | Subdomínio `workers.dev` novo leva alguns minutos para responder |
| Painel diz "token inválido" | Token do aparelho diferente do `PANEL_TOKEN` do backend: abra o link de novo |
| Painel diz "origem não permitida" | Painel aberto fora de `https://sr-geovani.github.io` (ajuste `ALLOWED_ORIGIN`) |
| "A NiceHash não aceitou as chaves" | Chave não confirmada pelo e-mail, campos trocados, ou sem permissão de ver saldo |
| test.nicehash.com pede senha | É outro site, sem login pelo Google: use a conta real em Observar (recomendado) ou crie conta de teste com e-mail e senha |
| Telegram: "falta mandar oi" | Mande qualquer mensagem para o seu bot e toque em Conectar de novo |
| "Falta a chave de cifra (ENC_KEY)" | Backend publicado antes desta versão: rode o script ou o workflow de novo |
