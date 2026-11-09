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
          `/guilds/${body.guildId}/members/${body.botId}`
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
      if (!content || content.length > 2000) return null;
      return {
        path: `/channels/${body.channelId}/messages`, method: 'POST',
        data: { content, allowed_mentions: { parse: [] } }
      };
    }
    default:
      return null;
  }
}

async function discordFetch(token, path, method = 'GET', data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'Accept': 'application/json',
        ...(data ? { 'Content-Type': 'application/json' } : {})
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
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
  if (size > 4096) return json({ error: 'Zbyt duże żądanie.' }, 413);
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
    const [guild, channels, member] = responses.map(resp => resp.data);
    return json({ guild, channels, member });
  }
  const response = await discordFetch(token, endpoint.path, endpoint.method, endpoint.data);
  return response.ok
    ? json(response.data)
    : json({ error: response.message }, response.status, response.headers);
}

// Vercel Node.js functions: Fetch handler. No resident bot process is required.
export default { fetch: handleDiscord };
