/**
 * Serverless API proxy. No token storage and no generic URL proxy.
 * The user must deploy this on their own, trusted Vercel account.
 */
const API_ORIGIN = 'https://discord.com/api/v10';
const ID_PATTERN = /^\d{15,22}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_\-.]{25,250}$/;

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extraHeaders
    }
  });
}

function idValid(id) { return typeof id === 'string' && ID_PATTERN.test(id); }
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}
function cleanEmoji(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const custom = raw.match(/^<a?:([A-Za-z0-9_]{2,32}):(\d{15,22})>$/);
  const normalized = custom ? `${custom[1]}:${custom[2]}` : raw;
  if (!normalized || normalized.length > 100 || /[\/\\?#]/.test(normalized)) return null;
  return encodeURIComponent(normalized);
}
function cleanEmbed(value) {
  if (!value || typeof value !== 'object') return null;
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 256) : '';
  const description = typeof value.description === 'string' ? value.description.trim().slice(0, 4096) : '';
  if (!title && !description) return null;
  const embed = { ...(title ? { title } : {}), ...(description ? { description } : {}) };
  if (typeof value.url === 'string' && value.url) {
    try { const url = new URL(value.url); if (url.protocol === 'https:') embed.url = url.href; } catch { /* omit */ }
  }
  if (typeof value.color === 'string' && /^[0-9a-fA-F]{6}$/.test(value.color.replace(/^#/, ''))) {
    embed.color = Number.parseInt(value.color.replace(/^#/, ''), 16);
  }
  return embed;
}
function cleanFile(value) {
  if (!value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? value.name.replace(/[^\p{L}\p{N}_. -]/gu, '_').slice(0, 120) : '';
  const type = typeof value.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(value.type) ? value.type : 'application/octet-stream';
  const data = typeof value.data === 'string' ? value.data : '';
  if (!name || !data || data.length > 3_500_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  return { name, type, data };
}

export function endpointFor(body) {
  switch (body.action) {
    case 'me':
      return { path: '/users/@me', method: 'GET' };
    case 'guilds':
      return { path: '/users/@me/guilds?limit=200', method: 'GET' };
    case 'guild':
      if (!idValid(body.guildId) || !idValid(body.botId)) return null;
      return {
        batch: [
          `/guilds/${body.guildId}`,
          `/guilds/${body.guildId}/channels`,
          `/guilds/${body.guildId}/members/${body.botId}`,
          `/guilds/${body.guildId}/threads/active`
        ]
      };
    case 'messages': {
      if (!idValid(body.channelId)) return null;
      let path = `/channels/${body.channelId}/messages?limit=50`;
      if (body.before !== undefined) {
        if (!idValid(body.before)) return null;
        path += `&before=${body.before}`;
      }
      return { path, method: 'GET' };
    }
    case 'send': {
      if (!idValid(body.channelId) || typeof body.content !== 'string') return null;
      const content = body.content.trim();
      const embed = body.embed === undefined ? null : cleanEmbed(body.embed);
      const file = body.file === undefined ? null : cleanFile(body.file);
      if ((!content && !embed && !file) || content.length > 2000 || (body.embed !== undefined && !embed) || (body.file !== undefined && !file)) return null;
      if (body.replyTo !== undefined && !idValid(body.replyTo)) return null;
      const data = {
        ...(content ? { content } : {}),
        ...(embed ? { embeds: [embed] } : {}),
        allowed_mentions: { parse: [], replied_user: false },
        ...(body.replyTo ? { message_reference: { message_id: body.replyTo, fail_if_not_exists: false } } : {})
      };
      return {
        path: `/channels/${body.channelId}/messages`, method: 'POST',
        data, ...(file ? { file } : {})
      };
    }
    case 'edit_message': {
      if (!idValid(body.channelId) || !idValid(body.messageId) || typeof body.content !== 'string') return null;
      const content = body.content.trim();
      if (!content || content.length > 2000) return null;
      return {
        path: `/channels/${body.channelId}/messages/${body.messageId}`,
        method: 'PATCH',
        data: { content, allowed_mentions: { parse: [] } }
      };
    }
    case 'delete_message':
      if (!idValid(body.channelId) || !idValid(body.messageId)) return null;
      return { path: `/channels/${body.channelId}/messages/${body.messageId}`, method: 'DELETE' };
    case 'bulk_delete':
      if (!idValid(body.channelId) || !Array.isArray(body.messageIds) || body.messageIds.length < 2 || body.messageIds.length > 100 || !body.messageIds.every(idValid) || new Set(body.messageIds).size !== body.messageIds.length) return null;
      return { path: `/channels/${body.channelId}/messages/bulk-delete`, method: 'POST', data: { messages: body.messageIds } };
    case 'reaction': {
      if (!idValid(body.channelId) || !idValid(body.messageId) || !['add','remove'].includes(body.mode)) return null;
      const emoji = cleanEmoji(body.emoji);
      if (!emoji) return null;
      return { path: `/channels/${body.channelId}/messages/${body.messageId}/reactions/${emoji}/@me`, method: body.mode === 'add' ? 'PUT' : 'DELETE' };
    }
    case 'pins':
      if (!idValid(body.channelId)) return null;
      return { path: `/channels/${body.channelId}/messages/pins?limit=50`, method: 'GET' };
    case 'pin_message':
      if (!idValid(body.channelId) || !idValid(body.messageId) || !['pin','unpin'].includes(body.mode)) return null;
      return { path: `/channels/${body.channelId}/messages/pins/${body.messageId}`, method: body.mode === 'pin' ? 'PUT' : 'DELETE' };
    case 'create_dm':
      if (!idValid(body.userId)) return null;
      return { path: '/users/@me/channels', method: 'POST', data: { recipient_id: body.userId } };
    case 'create_channel': {
      if (!idValid(body.guildId) || typeof body.name !== 'string') return null;
      const name = body.name.trim();
      const type = Number(body.type);
      if (!name || name.length > 100 || ![0, 4].includes(type)) return null;
      if (body.parentId !== undefined && body.parentId !== '' && !idValid(body.parentId)) return null;
      if (body.topic !== undefined && (typeof body.topic !== 'string' || body.topic.length > 1024)) return null;
      return {
        path: `/guilds/${body.guildId}/channels`, method: 'POST',
        data: {
          name, type,
          ...(type === 0 && body.parentId ? { parent_id: body.parentId } : {}),
          ...(type === 0 && body.topic?.trim() ? { topic: body.topic.trim() } : {})
        }
      };
    }
    case 'delete_channel':
      if (!idValid(body.channelId)) return null;
      return { path: `/channels/${body.channelId}`, method: 'DELETE' };
    case 'edit_channel': {
      if (!idValid(body.channelId)) return null;
      const name = cleanText(body.name, 100);
      if (!name || (body.topic !== undefined && (typeof body.topic !== 'string' || body.topic.length > 1024))) return null;
      const slowmode = Number(body.slowmode ?? 0);
      if (!Number.isInteger(slowmode) || slowmode < 0 || slowmode > 21600) return null;
      if (body.parentId !== undefined && body.parentId !== '' && !idValid(body.parentId)) return null;
      return { path: `/channels/${body.channelId}`, method: 'PATCH', data: { name, topic: String(body.topic || '').trim(), rate_limit_per_user: slowmode, nsfw: Boolean(body.nsfw), parent_id: body.parentId || null } };
    }
    case 'create_thread': {
      if (!idValid(body.channelId)) return null;
      const name = cleanText(body.name, 100);
      const duration = Number(body.duration);
      if (!name || ![60,1440,4320,10080].includes(duration)) return null;
      return { path: `/channels/${body.channelId}/threads`, method: 'POST', data: { name, auto_archive_duration: duration, type: 11 } };
    }
    case 'archive_thread':
      if (!idValid(body.channelId)) return null;
      return { path: `/channels/${body.channelId}`, method: 'PATCH', data: { archived: true, locked: Boolean(body.locked) } };
    case 'timeout_member': {
      if (!idValid(body.guildId) || !idValid(body.userId)) return null;
      let until = null;
      if (body.minutes !== 0) {
        const minutes = Number(body.minutes);
        if (![1,5,10,60,1440,10080,40320].includes(minutes)) return null;
        until = new Date(Date.now() + minutes * 60000).toISOString();
      }
      return { path: `/guilds/${body.guildId}/members/${body.userId}`, method: 'PATCH', data: { communication_disabled_until: until } };
    }
    case 'kick_member':
      if (!idValid(body.guildId) || !idValid(body.userId)) return null;
      return { path: `/guilds/${body.guildId}/members/${body.userId}`, method: 'DELETE' };
    case 'ban_member':
      if (!idValid(body.guildId) || !idValid(body.userId)) return null;
      return { path: `/guilds/${body.guildId}/bans/${body.userId}`, method: 'PUT', data: { delete_message_seconds: 0 } };
    default:
      return null;
  }
}

async function discordFetch(token, path, method = 'GET', data, file) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let requestBody;
    if (file) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(data || {}));
      form.append('files[0]', new Blob([Buffer.from(file.data, 'base64')], { type: file.type }), file.name);
      requestBody = form;
    } else if (data) requestBody = JSON.stringify(data);
    const resp = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'Accept': 'application/json',
        ...(data && !file ? { 'Content-Type': 'application/json' } : {})
      },
      ...(requestBody ? { body: requestBody } : {}),
      cache: 'no-store',
      signal: controller.signal
    });
    let payload;
    try { payload = await resp.json(); } catch { payload = null; }
    if (!resp.ok) {
      const errors = {
        401: 'Nieprawidłowy token bota lub token został unieważniony.',
        403: 'Bot nie ma uprawnień do tego zasobu.',
        404: 'Nie znaleziono serwera lub kanału.',
        429: 'Limit zapytań Discorda. Spróbuj ponownie za chwilę.'
      };
      const message = errors[resp.status] ||
        (resp.status >= 500 ? 'Discord API jest chwilowo niedostępne.' :
          (typeof payload?.message === 'string' ? payload.message : 'Błąd API Discorda.'));
      const retryAfter = resp.headers.get('retry-after');
      const headers = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
        ? { 'retry-after': retryAfter } : {};
      return { ok: false, status: resp.status, message, headers };
    }
    return { ok: true, status: resp.status, data: payload };
  } catch (error) {
    return { ok: false, status: 502,
      message: error?.name === 'AbortError' ? 'Discord API nie odpowiedziało na czas.' : 'Nie udało się połączyć z Discord API.' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleDiscord(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Użyj metody POST.' }, 405, { allow: 'POST' });
  }
  // Browser requests must originate from this same deployment.
  const origin = request.headers.get('origin');
  if (origin) {
    let allowed = false;
    try { allowed = new URL(origin).host === new URL(request.url).host; } catch { /* ignore */ }
    if (!allowed) return json({ error: 'Nieprawidłowe źródło żądania.' }, 403);
  }
  const size = Number(request.headers.get('content-length'));
  if (size > 4_000_000) return json({ error: 'Zbyt duże żądanie. Maksymalny plik to około 2,5 MB.' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Niepoprawne dane JSON.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Niepoprawne dane.' }, 400);
  const { token } = body;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return json({ error: 'Wpisz prawidłowy token bota.' }, 400);
  }
  const endpoint = endpointFor(body);
  if (!endpoint) return json({ error: 'Nieznana akcja lub niepoprawne parametry.' }, 400);

  if (endpoint.batch) {
    const responses = await Promise.all(endpoint.batch.map(path => discordFetch(token, path)));
    const failed = responses.find(resp => !resp.ok);
    if (failed) return json({ error: failed.message }, failed.status, failed.headers);
    const [guild, channels, member, activeThreads] = responses.map(resp => resp.data);
    return json({ guild, channels, member, activeThreads });
  }
  const response = await discordFetch(token, endpoint.path, endpoint.method, endpoint.data, endpoint.file);
  return response.ok
    ? json(response.data)
    : json({ error: response.message }, response.status, response.headers);
}

// Vercel Node.js functions: Fetch handler. No resident bot process is required.
export default { fetch: handleDiscord };
