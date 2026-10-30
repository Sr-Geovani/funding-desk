#!/usr/bin/env bash
# Instala ou atualiza o backend no Cloudflare usando só um token de API.
#
#   CLOUDFLARE_API_TOKEN=... bash scripts/deploy-backend.sh
#
# Opcionais: CLOUDFLARE_ACCOUNT_ID (descoberto sozinho se o token enxergar uma conta só),
#            ROTATE_PANEL_TOKEN=1 (gera um token do painel novo), PANEL_URL (endereço do painel).
#
# Passos: confere o token → acha a conta → cria o subdomínio workers.dev se faltar → cria/acha o KV →
# publica o Worker → cria os segredos PANEL_TOKEN e ENC_KEY só se faltarem → testa /health.
# No fim imprime o endereço e, quando gera token novo, um link que abre o painel já conectado.
# Chaves da NiceHash e do Telegram NÃO passam por aqui: são cadastradas no painel e ficam cifradas no backend.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?defina CLOUDFLARE_API_TOKEN}"
CF=https://api.cloudflare.com/client/v4
NAME=funding-desk-api
KV_TITLE=funding-desk-kv
PANEL_URL=${PANEL_URL:-https://sr-geovani.github.io/funding-desk/}
WRANGLER=wrangler@4.149.0
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export WRANGLER_SEND_METRICS=false

cf() { # método caminho [json]
  if [ -n "${3:-}" ]; then curl -sS -X "$1" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' --data "$3" "$CF$2"
  else curl -sS -X "$1" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$CF$2"; fi
}
ok() { jq -e '.success == true' >/dev/null 2>&1; }
err() { jq -r '[.errors[]? | "\(.code): \(.message)"] | join("; ")' 2>/dev/null || true; }

echo "1/7 Conferindo o token..."
R=$(cf GET /user/tokens/verify)
echo "$R" | ok || { echo "Token recusado: $(echo "$R" | err)"; exit 1; }

echo "2/7 Conta..."
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  R=$(cf GET "/accounts?per_page=50")
  N=$(echo "$R" | jq '.result | length' 2>/dev/null || echo 0)
  if [ "$N" != "1" ]; then
    echo "O token enxerga $N contas; defina CLOUDFLARE_ACCOUNT_ID. $(echo "$R" | err)"
    echo "$R" | jq -r '.result[]? | "  \(.id)  \(.name)"' 2>/dev/null || true
    exit 1
  fi
  CLOUDFLARE_ACCOUNT_ID=$(echo "$R" | jq -r '.result[0].id')
fi
export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN
A="/accounts/$CLOUDFLARE_ACCOUNT_ID"
echo "  conta $CLOUDFLARE_ACCOUNT_ID"

echo "3/7 Subdomínio workers.dev..."
SUB=$(cf GET "$A/workers/subdomain" | jq -r '.result.subdomain // empty' 2>/dev/null || true)
if [ -z "$SUB" ]; then
  for _ in 1 2 3; do
    TRY="funding-desk-$(openssl rand -hex 3)"
    R=$(cf PUT "$A/workers/subdomain" "{\"subdomain\":\"$TRY\"}")
    if echo "$R" | ok; then SUB=$TRY; echo "  criado: $SUB.workers.dev"; break; fi
    echo "  não deu ($TRY): $(echo "$R" | err)"
  done
  [ -n "$SUB" ] || { echo "Não consegui criar o subdomínio. Abra Workers & Pages no Cloudflare uma vez e rode de novo."; exit 1; }
else
  echo "  já existe: $SUB.workers.dev"
fi

echo "4/7 Armazenamento (KV)..."
KV=$(cf GET "$A/storage/kv/namespaces?per_page=100" | jq -r ".result[]? | select(.title==\"$KV_TITLE\") | .id" 2>/dev/null | head -1 || true)
if [ -z "$KV" ]; then
  R=$(cf POST "$A/storage/kv/namespaces" "{\"title\":\"$KV_TITLE\"}")
  echo "$R" | ok || { echo "Falha ao criar o KV: $(echo "$R" | err)"; exit 1; }
  KV=$(echo "$R" | jq -r '.result.id')
  echo "  criado: $KV"
else
  echo "  já existe: $KV"
fi

echo "5/7 Publicando o backend (1 a 2 min)..."
CFG="$ROOT/worker/.wrangler-deploy.local.toml"
LOG=$(mktemp)
trap 'rm -f "$CFG" "$LOG"' EXIT
sed "s/__KV_ID__/$KV/" "$ROOT/worker/wrangler.toml" > "$CFG"
if ! (cd "$ROOT/worker" && npx --yes "$WRANGLER" deploy -c "$CFG") > "$LOG" 2>&1; then
  tail -30 "$LOG"; echo "Falha no deploy."; exit 1
fi
grep -E 'Uploaded|Deployed|workers.dev|schedule|Current Version' "$LOG" | sed 's/^/  /' || true
URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' "$LOG" | head -1 || true)
[ -n "$URL" ] || URL="https://$NAME.$SUB.workers.dev"

echo "6/7 Segredos do backend..."
HAVE=$(cf GET "$A/workers/scripts/$NAME/secrets" | jq -r '.result[]?.name' 2>/dev/null || true)
put_secret() {
  local R
  R=$(cf PUT "$A/workers/scripts/$NAME/secrets" "$(jq -n --arg n "$1" --arg v "$2" '{name:$n,text:$v,type:"secret_text"}')")
  echo "$R" | ok || { echo "Falha ao gravar $1: $(echo "$R" | err)"; exit 1; }
}
if grep -qx ENC_KEY <<<"$HAVE"; then echo "  ENC_KEY já existe (mantido: trocar apagaria as chaves cadastradas)"
else put_secret ENC_KEY "$(openssl rand -hex 32)"; echo "  ENC_KEY criado (cifra das chaves cadastradas no painel)"; fi
NEW_TOKEN=""
if grep -qx PANEL_TOKEN <<<"$HAVE" && [ "${ROTATE_PANEL_TOKEN:-}" != 1 ]; then echo "  PANEL_TOKEN já existe (mantido; ROTATE_PANEL_TOKEN=1 gera outro)"
else NEW_TOKEN=$(openssl rand -hex 20); put_secret PANEL_TOKEN "$NEW_TOKEN"; echo "  PANEL_TOKEN criado"; fi

echo "7/7 Testando $URL ..."
H=""
for _ in $(seq 1 36); do
  H=$(curl -s -m 10 "$URL/health" || true)
  echo "$H" | jq -e '.ok == true' >/dev/null 2>&1 && break
  sleep 5
done
echo "  saúde: ${H:-sem resposta (subdomínio novo pode levar alguns minutos)}"
if [ -n "$NEW_TOKEN" ]; then
  C=$(curl -s -m 15 -H "Authorization: Bearer $NEW_TOKEN" "$URL/api/credentials" || true)
  echo "  login com o token novo: $(echo "$C" | jq -c '{cifra: .encryption, nicehash: .nicehash.set, telegram: .telegram.set}' 2>/dev/null || echo "$C")"
fi

echo
echo "================ PRONTO ================"
echo "Backend: $URL"
if [ -n "$NEW_TOKEN" ]; then
  echo "Token do painel: $NEW_TOKEN"
  echo "Link para abrir no celular (conecta o painel sozinho):"
  echo "${PANEL_URL}#api=${URL}&tok=${NEW_TOKEN}"
else
  echo "Token do painel: o mesmo de antes (já salvo no seu celular)."
fi
