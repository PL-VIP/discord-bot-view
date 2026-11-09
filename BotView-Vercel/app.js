const $ = id => document.getElementById(id);
const state = {
  token: '', me: null, guilds: [], guild: null, guildId: null,
  member: null, channels: [], visible: [], selectedChannel: null,
  messages: [], before: null, hasMore: false, loadingMessages: false,
  loadNumber: 0, busy: false, refreshTimer: null
};
const PERM = {
  ADMINISTRATOR: 1n << 3n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n
};
const MESSAGE_CHANNEL_TYPES = new Set([0, 2, 5, 13, 11, 12]);
const CHANNEL_TYPES = {0:'#',2:'♫',5:'#',13:'◉',15:'▤',16:'▣'};
let toastTimeout;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function validId(s) { return typeof s === 'string' && /^\d{15,22}$/.test(s); }
function safeRemoteUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}
function avatarUrl(user, size = 80) {
  if (!validId(user?.id) || !/^[a-zA-Z0-9_]+$/.test(user?.avatar || '')) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=${size}`;
}
function guildIcon(guild) {
  if (!validId(guild?.id) || !/^[a-zA-Z0-9_]+$/.test(guild?.icon || '')) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp?size=96`;
}
function imgOrInitial(url, text) {
  return url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc((text || '?').slice(0,2).toUpperCase());
}
function showToast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('visible'), 5000);
}
function setLoginError(message) {
  const el = $('loginError');
  el.textContent = message || '';
  el.hidden = !message;
}
function formatDate(value, opts) {
  try { return new Intl.DateTimeFormat('pl-PL', opts).format(new Date(value)); }
  catch { return ''; }
}
function timeFor(iso) { return formatDate(iso, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function compactTime(iso) { return formatDate(iso, {hour:'2-digit', minute:'2-digit'}); }
function linkify(content) {
  // Escape first, then linkify only absolute http(s) URLs.
  return esc(content).replace(/https?:\/\/[^\s<>&"']+/gi, value => {
    const url = safeRemoteUrl(value.replace(/&amp;/g, '&'));
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${value}</a>` : value;
  });
}
async function api(action, fields = {}) {
  if (!state.token) throw new Error('Brak tokenu.');
  let response;
  try {
    response = await fetch('/api/discord', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action, token: state.token, ...fields })
    });
  } catch {
    throw new Error('Nie można połączyć się z API strony. Sprawdź wdrożenie na Vercel.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('Nieprawidłowa odpowiedź funkcji API.'); }
  if (!response.ok) throw new Error(data?.error || `Błąd HTTP ${response.status}`);
  return data;
}

function bigint(v) {
  try { return BigInt(v || '0'); } catch { return 0n; }
}
function has(bitset, flag) { return (bitset & flag) === flag; }
export function permissionsForChannel(guild, member, channel) {
  if (!guild?.id || !Array.isArray(guild.roles) || !Array.isArray(member?.roles)) return null;
  const everyone = guild.roles.find(role => role.id === guild.id);
  if (!everyone) return null;
  const myRoleIds = new Set(member.roles);
  let permissions = bigint(everyone.permissions);
  for (const role of guild.roles) {
    if (myRoleIds.has(role.id)) permissions |= bigint(role.permissions);
  }
  if (member.user?.id === guild.owner_id || has(permissions, PERM.ADMINISTRATOR)) {
    return { view: true, history: true, send: true, admin: true };
  }
  const overwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  function apply(allow, deny) { permissions = (permissions & ~deny) | allow; }
  const everyoneOverwrite = overwrites.find(o => o.id === guild.id && Number(o.type) === 0);
  if (everyoneOverwrite) apply(bigint(everyoneOverwrite.allow), bigint(everyoneOverwrite.deny));
  let roleAllow = 0n, roleDeny = 0n;
  for (const o of overwrites) {
    if (Number(o.type) === 0 && myRoleIds.has(o.id)) {
      roleAllow |= bigint(o.allow); roleDeny |= bigint(o.deny);
    }
  }
  apply(roleAllow, roleDeny);
  const memberId = member.user?.id;
  const memberOverwrite = overwrites.find(o => o.id === memberId && Number(o.type) === 1);
  if (memberOverwrite) apply(bigint(memberOverwrite.allow), bigint(memberOverwrite.deny));
  const view = has(permissions, PERM.VIEW_CHANNEL);
  return {
    view,
    history: view && has(permissions, PERM.READ_MESSAGE_HISTORY),
    send: view && has(permissions, channel.type === 11 || channel.type === 12 ? PERM.SEND_MESSAGES_IN_THREADS : PERM.SEND_MESSAGES),
    admin: false
  };
}

function resetChat() {
  state.selectedChannel = null; state.messages = []; state.before = null; state.hasMore = false;
  $('chatTitle').textContent = 'Wybierz kanał'; $('chatTopic').textContent = '';
  $('headerIcon').textContent = '#'; $('chatView').hidden = true; $('welcomePanel').hidden = false;
  $('refreshMessages').disabled = true;
}
function renderGuilds() {
  $('guildIcons').innerHTML = state.guilds.map(g => {
    const url = guildIcon(g);
    const current = g.id === state.guildId;
    const short = g.name?.split(/\s+/).slice(0,2).map(x => x[0] || '').join('') || '?';
    return `<button class="guild-icon${current ? ' active':''}" data-guild-id="${esc(g.id)}" title="${esc(g.name)}" aria-label="Serwer ${esc(g.name)}" aria-pressed="${current}">${imgOrInitial(url, short)}</button>`;
  }).join('');
}
function renderChannels() {
  const list = $('channelsList');
  const query = $('channelSearch').value.trim().toLocaleLowerCase('pl-PL');
  if (!state.guild) { list.innerHTML = '<p class="sidebar-placeholder">Wybierz serwer po lewej stronie.</p>'; return; }
  const categories = state.visible.filter(ch => ch.type === 4).sort((a,b)=>(a.position||0)-(b.position||0));
  const others = state.visible.filter(ch => ch.type !== 4 && ch.type !== 1 && ch.type !== 3);
  // Show permitted child channels even if the parent category itself is hidden.
  const displayed = others;
  const sorted = (items) => [...items].sort((a,b) => (a.position||0)-(b.position||0) || (a.id < b.id ? -1 : 1));
  const row = (ch) => `<div class="channel-row${state.selectedChannel?.id === ch.id ? ' active' : ''}" data-channel-id="${esc(ch.id)}" role="button" tabindex="0" aria-label="${esc(ch.name)}"><span class="channel-symbol">${CHANNEL_TYPES[ch.type] || '#'}</span><span>${esc(ch.name)}</span></div>`;
  const sections = [];
  const uncategorized = sorted(displayed.filter(ch => !ch.parent_id || !categories.some(cat => cat.id === ch.parent_id)));
  if (uncategorized.length) sections.push(uncategorized.filter(ch => ch.name.toLocaleLowerCase('pl-PL').includes(query)).map(row).join(''));
  for (const cat of categories) {
    const children = sorted(displayed.filter(ch => ch.parent_id === cat.id));
    const catMatch = cat.name.toLocaleLowerCase('pl-PL').includes(query);
    const matching = query && !catMatch ? children.filter(ch => ch.name.toLocaleLowerCase('pl-PL').includes(query)) : children;
    if (query && !catMatch && matching.length === 0) continue;
    sections.push(`<div class="category-row"><span class="arrow">⌄</span><span class="category-title">${esc(cat.name)}</span></div>` + matching.map(row).join(''));
  }
  list.innerHTML = sections.join('') || '<p class="sidebar-placeholder">Brak widocznych kanałów.</p>';
}

async function login(event) {
  event.preventDefault();
  if (state.busy) return;
  const value = $('tokenInput').value.trim();
  setLoginError('');
  if (!value || value.length < 25) { setLoginError('Wklej token swojego bota.'); return; }
  state.busy = true; state.token = value;
  $('loginButton').disabled = true; $('loginButton').textContent = 'Łączenie…';
  try {
    const me = await api('me');
    if (!me?.bot || !validId(me.id)) throw new Error('Ten token nie należy do konta bota.');
    const guilds = await api('guilds');
    if (!Array.isArray(guilds)) throw new Error('Discord nie zwrócił listy serwerów.');
    state.me = me; state.guilds = guilds;
    $('tokenInput').value = '';
    $('botName').textContent = me.global_name || me.username || 'Bot';
    $('botAvatarMini').innerHTML = imgOrInitial(avatarUrl(me, 80), me.username);
    $('loginScreen').hidden = true; $('appShell').hidden = false;
    renderGuilds(); resetChat();
    $('refreshMessages').disabled = true;
    if (guilds.length) await selectGuild(guilds[0].id);
    else showToast('Bot nie znajduje się na żadnym serwerze.');
    state.refreshTimer = setInterval(() => {
      if (!document.hidden && state.selectedChannel && !state.loadingMessages) refreshMessages(true);
    }, 20000);
  } catch (error) {
    if (!$('loginScreen').hidden) setLoginError(error.message);
    else showToast(error.message, true);
    if (!$('loginScreen').hidden) state.token = '';
  } finally {
    state.busy = false; $('loginButton').disabled = false;
    $('loginButton').textContent = 'Połącz z Discord API →';
  }
}
function logout() {
  clearInterval(state.refreshTimer);
  state.token = ''; state.me = null; state.guilds = [];
  state.guild = null; state.member = null; state.channels = [];
  state.visible = []; state.guildId = null; state.loadNumber++;
  state.busy = false;
  $('appShell').hidden = true; $('loginScreen').hidden = false;
  $('tokenInput').value = ''; $('channelSearch').value = '';
  setLoginError(''); resetChat();
}
async function reloadGuilds() {
  try {
    const list = await api('guilds');
    if (!Array.isArray(list)) throw new Error('Błędna lista serwerów.');
    state.guilds = list; renderGuilds();
    showToast('Lista serwerów została odświeżona.');
  } catch(err) { showToast(err.message, true); }
}
async function selectGuild(guildId) {
  const n = ++state.loadNumber;
  state.guildId = guildId;
  state.guild = null; state.channels = []; state.visible = []; state.member = null;
  resetChat(); renderGuilds();
  $('serverTitle').textContent = state.guilds.find(g => g.id === guildId)?.name || 'Wczytywanie...';
  $('channelsList').innerHTML = '<p class="loading-placeholder">Wczytywanie kanałów...</p>';
  try {
    const result = await api('guild', {guildId, botId: state.me.id});
    if (n !== state.loadNumber) return;
    if (!result.guild || !Array.isArray(result.channels) || !result.member) throw new Error('Brak danych uprawnień serwera.');
    state.guild = result.guild; state.member = result.member; state.channels = result.channels;
    const roles = result.guild.roles;
    if (!Array.isArray(roles) || !roles.some(r=>r.id===guildId)) throw new Error('Nie można odczytać uprawnień serwera.');
    state.visible = result.channels.map(channel => ({
      ...channel, calculated: permissionsForChannel(result.guild, result.member, channel)
    })).filter(ch => ch.calculated?.view);
    renderChannels();
    const first = state.visible.find(ch => ch.type === 0 || ch.type === 5) || state.visible.find(ch => ch.type !== 4);
    if (first) await selectChannel(first.id);
    else showToast('Bot nie widzi kanałów na tym serwerze.');
  } catch (error) {
    if (n !== state.loadNumber) return;
    $('channelsList').innerHTML = `<p class="sidebar-placeholder">${esc(error.message)}</p>`;
    showToast(error.message, true);
  }
}
async function selectChannel(channelId) {
  const channel = state.visible.find(ch => ch.id === channelId && ch.calculated?.view);
  if (!channel) return;
  state.selectedChannel = channel;
  state.messages = []; state.before = null; state.hasMore = false;
  const n = ++state.loadNumber;
  $('welcomePanel').hidden = true; $('chatView').hidden = false;
  $('chatTitle').textContent = channel.name;
  $('headerIcon').textContent = CHANNEL_TYPES[channel.type] || '#';
  $('chatTopic').textContent = channel.topic || '';
  $('refreshMessages').disabled = false;
  $('chatInfo').hidden = true;
  $('olderButton').hidden = true;
  $('messageList').innerHTML = '<div class="loading-placeholder">Wczytywanie wiadomości...</div>';
  renderChannels();
  $('channelsPanel').classList.remove('open');
  const hasMessages = MESSAGE_CHANNEL_TYPES.has(channel.type);
  const canRead = channel.calculated?.history && hasMessages;
  const canSend = channel.calculated?.send && hasMessages;
  $('composerInput').disabled = !canSend;
  $('sendButton').disabled = !canSend;
  $('composerInput').placeholder = canSend ? `Napisz na #${channel.name} jako bot...` : 'Nie można pisać na tym kanale';
  if (!canRead) {
    $('messageList').innerHTML = `<div class="channel-unavailable"><h2>${esc(channel.name)}</h2>${!hasMessages ? 'Ten rodzaj kanału nie ma zwykłej osi wiadomości. W tej wersji nie wyświetlamy wpisów forum, wydarzeń ani połączeń głosowych.' : 'Bot widzi kanał, ale nie ma uprawnienia „Czytaj historię wiadomości”.'}</div>`;
    $('refreshMessages').disabled = true;
    $('composerInput').disabled = true; $('sendButton').disabled = true;
    return;
  }
  await loadMessages(n, false);
}
function renderMessage(msg, previous) {
  const author = msg.author || {};
  const displayName = msg.member?.nick || author.global_name || author.username || 'Nieznany użytkownik';
  const avatar = avatarUrl(author, 80);
  const isBot = Boolean(author.bot);
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const embeds = Array.isArray(msg.embeds) ? msg.embeds : [];
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  const attachmentHtml = attachments.map(a => {
    const url = safeRemoteUrl(a.url);
    if (!url) return '';
    const isImage = (a.content_type || '').startsWith('image/') && a.width && a.height;
    return isImage
      ? `<div class="message-attachment"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(a.filename || 'Załączony obraz')}" loading="lazy" referrerpolicy="no-referrer"></a></div>`
      : `<div class="message-attachment"><a class="attachment-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">▤ ${esc(a.filename || 'Załącznik')}</a></div>`;
  }).join('');
  const embedsHtml = embeds.slice(0,4).map(e => {
    if (!e.title && !e.description && !e.author?.name) return '';
    return `<div class="embeds">${e.author?.name ? `<div class="embed-author">${esc(e.author.name)}</div>` : ''}${e.title ? `<div class="embed-title">${esc(e.title)}</div>` : ''}${e.description ? `<div class="embed-desc">${linkify(e.description.slice(0,3000))}</div>` : ''}</div>`;
  }).join('');
  const reactionsHtml = reactions.length ? `<div class="reactions">${reactions.map(r => {
    const e = r.emoji || {};
    const emojiUrl = validId(e.id) ? `https://cdn.discordapp.com/emojis/${e.id}.webp?size=32` : null;
    return `<span class="reaction">${emojiUrl ? `<img src="${esc(emojiUrl)}" alt="${esc(e.name || '')}">` : esc(e.name || '◈')} ${Number(r.count) || 0}</span>`;
  }).join('')}</div>` : '';
  const reply = msg.message_reference?.message_id ? '<div class="msg-reply">↳ Odpowiedź w wątku</div>' : '';
  return `<article class="msg first"><div class="msg-avatar">${imgOrInitial(avatar,displayName)}</div><div class="msg-content"><div class="msg-line"><span class="msg-user">${esc(displayName)}</span>${isBot?'<span class="bot-pill">BOT</span>':''}<time class="msg-time" datetime="${esc(msg.timestamp)}">${esc(timeFor(msg.timestamp))}</time></div>${reply}${msg.content ? `<div class="msg-text">${linkify(msg.content)}</div>` : ''}${attachmentHtml}${embedsHtml}${reactionsHtml}${!msg.content && !attachments.length && !embedsHtml ? '<div class="msg-text msg-empty-text">(brak treści lub treść niedostępna dla bota)</div>' : ''}</div></article>`;
}
function renderMessages(shouldStickToBottom = true) {
  const list = $('messageList');
  if (!state.selectedChannel) return;
  const c = state.selectedChannel;
  const intro = `<div class="channel-intro"><div class="channel-intro-icon">${CHANNEL_TYPES[c.type] || '#'}</div><h2>Witaj na #${esc(c.name)}!</h2><p>To początek historii wiadomości dostępnej dla Twojego bota.</p></div>`;
  list.innerHTML = intro + (state.messages.length
    ? state.messages.map((msg, i) => renderMessage(msg, state.messages[i-1])).join('')
    : '<div class="empty-messages">Brak wiadomości w tym kanale.</div>');
  $('olderButton').hidden = !state.hasMore;
  if (shouldStickToBottom) scrollToBottom();
}
function scrollToBottom() {
  const scroller = $('messagesScroller');
  requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}
async function loadMessages(selectionNumber, older) {
  if (state.loadingMessages && older) return;
  if (!state.selectedChannel || !state.selectedChannel.calculated?.history) return;
  state.loadingMessages = true;
  const channelId = state.selectedChannel.id;
  const scroller = $('messagesScroller');
  const oldHeight = scroller.scrollHeight;
  try {
    const data = await api('messages', {channelId, ...(older && state.before ? {before:state.before} : {})});
    if (selectionNumber !== state.loadNumber || state.selectedChannel?.id !== channelId) return;
    if (!Array.isArray(data)) throw new Error('Niepoprawny format wiadomości.');
    if (older) {
      const ids = new Set(state.messages.map(m => m.id));
      state.messages = [...data.filter(m => !ids.has(m.id)), ...state.messages];
    } else state.messages = data;
    state.messages.sort((a,b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    state.before = state.messages[0]?.id || null;
    state.hasMore = data.length === 50;
    renderMessages(!older);
    if (older) requestAnimationFrame(() => { scroller.scrollTop += scroller.scrollHeight - oldHeight; });
  } catch (error) {
    if (selectionNumber !== state.loadNumber) return;
    if (!older) $('messageList').innerHTML = `<div class="channel-unavailable">${esc(error.message)}</div>`;
    showToast(error.message, true);
  } finally { state.loadingMessages = false; }
}
async function refreshMessages(silent = false) {
  const channel = state.selectedChannel;
  if (!channel || !channel.calculated?.history || !MESSAGE_CHANNEL_TYPES.has(channel.type) || state.loadingMessages) return;
  const loadNumber = state.loadNumber;
  try {
    const messages = await api('messages', {channelId:channel.id});
    if (loadNumber !== state.loadNumber || !Array.isArray(messages)) return;
    const scroller = $('messagesScroller');
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 130;
    const ids = new Set(state.messages.map(m => m.id));
    const fresh = messages.filter(m => !ids.has(m.id));
    const merged = [...state.messages, ...fresh];
    const changed = merged.length !== state.messages.length || messages.some(m => {
      const old = state.messages.find(x => x.id === m.id);
      return old && (old.content !== m.content || old.edited_timestamp !== m.edited_timestamp);
    });
    if (changed) {
      const byId = new Map(merged.map(m => [m.id,m]));
      messages.forEach(m => byId.set(m.id,m));
      state.messages = [...byId.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
      renderMessages(atBottom);
    }
    if (!silent) showToast('Wiadomości odświeżone.');
  } catch(err) { if (!silent) showToast(err.message, true); }
}
async function sendMessage(event) {
  event.preventDefault();
  if (!state.selectedChannel || !$('composerInput').value.trim() || $('sendButton').disabled) return;
  const input = $('composerInput');
  const channelId = state.selectedChannel.id;
  const content = input.value.trim();
  $('sendButton').disabled = true;
  try {
    const message = await api('send', {channelId, content});
    if (state.selectedChannel?.id !== channelId) return;
    input.value = ''; input.style.height = '';
    if (message?.id && !state.messages.some(m => m.id === message.id)) {
      state.messages.push(message);
      state.messages.sort((a,b) => BigInt(a.id)<BigInt(b.id)?-1:1);
      renderMessages(true);
    }
  } catch(error) { showToast(error.message, true); }
  finally { $('sendButton').disabled = !state.selectedChannel?.calculated?.send; }
}
$('loginForm').addEventListener('submit',login);
$('toggleToken').addEventListener('click',()=> {
  const input = $('tokenInput'); input.type = input.type === 'password' ? 'text' : 'password';
});
$('guildIcons').addEventListener('click',event => {
  const button = event.target.closest('[data-guild-id]');
  if (button && button.dataset.guildId !== state.guildId) selectGuild(button.dataset.guildId);
});
$('channelsList').addEventListener('click',event => {
  const row = event.target.closest('[data-channel-id]');
  if (row && row.dataset.channelId !== state.selectedChannel?.id) selectChannel(row.dataset.channelId);
});
$('channelsList').addEventListener('keydown',event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('[data-channel-id]');
  if (row) { event.preventDefault(); selectChannel(row.dataset.channelId); }
});
$('channelSearch').addEventListener('input',renderChannels);
$('logoutButton').addEventListener('click',logout);
$('logoutSide').addEventListener('click',logout);
$('reloadGuilds').addEventListener('click',reloadGuilds);
$('refreshMessages').addEventListener('click',()=>refreshMessages(false));
$('olderButton').addEventListener('click',()=>loadMessages(state.loadNumber,true));
$('composerForm').addEventListener('submit',sendMessage);
$('composerInput').addEventListener('keydown',event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); $('composerForm').requestSubmit();
  }
});
$('composerInput').addEventListener('input',event => {
  event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight,160)+'px';
});
$('mobileMenu').addEventListener('click',()=> $('channelsPanel').classList.toggle('open'));
$('homeButton').addEventListener('click',()=> { resetChat(); $('channelsPanel').classList.remove('open'); });
document.addEventListener('keydown',event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !$('appShell').hidden) {
    event.preventDefault(); $('channelsPanel').classList.add('open'); $('channelSearch').focus();
  }
  if (event.key === 'Escape') $('channelsPanel').classList.remove('open');
});
