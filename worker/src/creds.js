// Credenciais cadastradas pelo painel (NiceHash, Telegram), guardadas cifradas no KV com AES-GCM.
// A chave de cifra é o segredo ENC_KEY do Worker: quem abre o KV no Cloudflare vê só texto cifrado.
// Nada aqui devolve segredo para o painel; o status mostra só se está configurado.
const te = new TextEncoder(), td = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Campos que viram variáveis do backend (e têm prioridade sobre os segredos do Cloudflare).
export const CRED_FIELDS = ['NH_API_KEY', 'NH_API_SECRET', 'NH_ORG_ID', 'NH_ENV', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
const KV_KEY = 'creds';

function needKey(secret) {
  if (!secret || String(secret).length < 24) throw Object.assign(new Error('ENC_KEY não configurado no backend (rode o script de instalação de novo)'), { status: 412 });
}
async function aesKey(secret) {
  needKey(secret);
  const raw = await crypto.subtle.digest('SHA-256', te.encode('funding-desk/creds/v1:' + secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), te.encode(JSON.stringify(obj))));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
export async function unseal(secret, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await aesKey(secret), unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

export async function loadCreds(env) {
  const raw = env.FD_KV ? await env.FD_KV.get(KV_KEY) : null;
  if (!raw) return {};
  if (!env.ENC_KEY) return { _error: 'há credenciais salvas, mas falta o ENC_KEY no backend' };
  try { return await unseal(env.ENC_KEY, JSON.parse(raw)); } catch (e) { return { _error: 'não consegui ler as credenciais salvas (o ENC_KEY mudou?). Cadastre de novo.' }; }
}

// Junta: variáveis do Cloudflare + credenciais do painel (estas vencem). Não altera o env original.
export async function withCreds(env) {
  if (env._creds) return env;
  const c = await loadCreds(env);
  const e = Object.create(env);
  for (const k of CRED_FIELDS) if (c[k]) e[k] = c[k];
  e._creds = { panel: CRED_FIELDS.filter((k) => c[k]), error: c._error || null, updatedAt: c.updatedAt || null, botName: c.botName || null };
  e._raw = env;
  return e;
}
// Relê depois de salvar (parte do env original, não do já mesclado).
export const reloadCreds = (env) => withCreds(env._raw || env);

// patch: { campo: valor } grava; { campo: null } apaga. Devolve o objeto salvo.
export async function saveCreds(env, patch, now) {
  needKey(env.ENC_KEY);
  const cur = await loadCreds(env);
  const next = {};
  for (const [k, v] of Object.entries(cur)) if (k !== '_error') next[k] = v;
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') delete next[k]; else next[k] = v; }
  next.updatedAt = now || Date.now();
  await env.FD_KV.put(KV_KEY, JSON.stringify(await seal(env.ENC_KEY, next)));
  return next;
}

const tail = (s) => (s ? '…' + String(s).slice(-4) : null);

// Status sem segredos: o que está configurado e de onde veio.
export function credStatus(env) {
  const c = env._creds || { panel: [] };
  const nhSet = !!(env.NH_API_KEY && env.NH_API_SECRET && env.NH_ORG_ID);
  const tgSet = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  return {
    encryption: !!(env.ENC_KEY && String(env.ENC_KEY).length >= 24),
    error: c.error,
    updatedAt: c.updatedAt,
    nicehash: { set: nhSet, env: env.NH_BASE ? 'personalizado' : (env.NH_ENV === 'prod' ? 'prod' : 'test'), key: tail(env.NH_API_KEY),
      source: !nhSet ? null : (c.panel.includes('NH_API_KEY') ? 'painel' : 'cloudflare') },
    telegram: { set: tgSet, token: !!env.TELEGRAM_BOT_TOKEN, bot: c.botName,
      source: !tgSet ? null : (c.panel.includes('TELEGRAM_BOT_TOKEN') ? 'painel' : 'cloudflare') }
  };
}

const ID_RE = /^[A-Za-z0-9-]{8,200}$/;
// Valida o que veio do painel. Devolve { patch, errors }.
export function parseNiceHash(body) {
  const key = String(body.key || '').trim(), secret = String(body.secret || '').trim(), org = String(body.org || '').trim();
  const env = body.env === 'prod' ? 'prod' : body.env === 'test' || body.env === undefined ? 'test' : null;
  const errors = [];
  if (!ID_RE.test(key)) errors.push('API Key inválida');
  if (!ID_RE.test(secret)) errors.push('API Secret inválido');
  if (!ID_RE.test(org)) errors.push('Organization ID inválido');
  if (!env) errors.push('ambiente deve ser teste ou produção');
  if (key && key === secret) errors.push('API Key e API Secret são diferentes; confira se colou cada um no lugar certo');
  return { patch: { NH_API_KEY: key, NH_API_SECRET: secret, NH_ORG_ID: org, NH_ENV: env }, errors };
}

export const TG_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
// Acha o chat de quem mandou mensagem para o bot por último (conversa privada tem prioridade).
export function chatFromUpdates(updates) {
  let best = null;
  for (const u of updates || []) {
    const m = u.message || u.edited_message || u.my_chat_member || u.channel_post;
    const chat = m && m.chat;
    if (!chat || chat.id === undefined) continue;
    if (!best || chat.type === 'private' || best.type !== 'private') best = chat;
  }
  return best ? { id: String(best.id), type: best.type, name: best.first_name || best.title || best.username || '' } : null;
}
