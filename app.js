const $ = id => document.getElementById(id);
const state = {
  token: '', me: null, guilds: [], guild: null, guildId: null,
  member: null, channels: [], visible: [], selectedChannel: null,
  mode: 'guild', dms: [], canManageChannels: false, guildPermissions: 0n,
  messages: [], before: null, hasMore: false, loadingMessages: false,
  loadNumber: 0, busy: false, refreshTimer: null,
  composerMode: 'send', composerTarget: null, pendingFile: null,
  drafts: new Map(), selectedMessages: new Set(), unread: new Map(),
  searchQuery: '', authorFilter: '', contextMessage: null, selectedUser: null
};
const PERM = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
  PIN_MESSAGES: 1n << 51n
};
const MESSAGE_CHANNEL_TYPES = new Set([0, 1, 2, 5, 10, 11, 12, 13]);
const THREAD_TYPES = new Set([10, 11, 12]);
const CHANNEL_TYPES = {0:'#',1:'✉',2:'♫',5:'#',10:'◫',11:'◫',12:'◫',13:'◉',15:'▤',16:'▣'};
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
function basePermissions(guild, member) {
  if (!guild?.id || !Array.isArray(guild.roles) || !Array.isArray(member?.roles)) return 0n;
  const everyone = guild.roles.find(role => role.id === guild.id);
  if (!everyone) return 0n;
  const myRoleIds = new Set(member.roles);
  let permissions = bigint(everyone.permissions);
  for (const role of guild.roles) if (myRoleIds.has(role.id)) permissions |= bigint(role.permissions);
  return permissions;
}
export function permissionsForChannel(guild, member, channel) {
  if (!guild?.id || !Array.isArray(guild.roles) || !Array.isArray(member?.roles)) return null;
  const everyone = guild.roles.find(role => role.id === guild.id);
  if (!everyone) return null;
  const myRoleIds = new Set(member.roles);
  let permissions = basePermissions(guild, member);
  if (member.user?.id === guild.owner_id || has(permissions, PERM.ADMINISTRATOR)) {
    return { view: true, history: true, send: true, manageMessages: true, manageChannels: true, manageThreads:true, addReactions:true, createThreads:true, pinMessages:true, kick:true, ban:true, moderate:true, admin: true };
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
    send: view && has(permissions, THREAD_TYPES.has(channel.type) ? PERM.SEND_MESSAGES_IN_THREADS : PERM.SEND_MESSAGES),
    manageMessages: view && has(permissions, PERM.MANAGE_MESSAGES),
    manageChannels: has(permissions, PERM.MANAGE_CHANNELS),
    manageThreads: has(permissions, PERM.MANAGE_THREADS),
    addReactions: view && has(permissions, PERM.ADD_REACTIONS),
    createThreads: view && has(permissions, PERM.CREATE_PUBLIC_THREADS),
    pinMessages: view && has(permissions, PERM.PIN_MESSAGES),
    kick: has(permissions, PERM.KICK_MEMBERS),
    ban: has(permissions, PERM.BAN_MEMBERS),
    moderate: has(permissions, PERM.MODERATE_MEMBERS),
    admin: false
  };
}

function resetComposerContext(clearInput = false) {
  state.composerMode = 'send'; state.composerTarget = null;
  $('composerContext').hidden = true;
  if (clearInput) $('composerInput').value = '';
  updateComposerPlaceholder();
}
function saveDraft() {
  const id = state.selectedChannel?.id;
  if (!id || state.composerMode === 'edit') return;
  const value = $('composerInput').value;
  if (value) state.drafts.set(id, value); else state.drafts.delete(id);
}
function loadDraft(channelId) {
  $('composerInput').value = state.drafts.get(channelId) || '';
  $('composerInput').style.height = '';
}
function clearAttachment() {
  state.pendingFile = null; $('fileInput').value = '';
  $('attachmentPreview').hidden = true;
}
function updateComposerPlaceholder() {
  const input = $('composerInput');
  const channel = state.selectedChannel;
  if (!channel?.calculated?.send) { input.placeholder = 'Nie można pisać na tym kanale'; return; }
  const name = channel.type === 1 ? (channel.name || 'DM') : `#${channel.name}`;
  input.placeholder = state.composerMode === 'edit' ? 'Edytuj wiadomość…' : `Napisz na ${name} jako bot...`;
}

function resetChat() {
  saveDraft();
  state.selectedChannel = null; state.messages = []; state.before = null; state.hasMore = false;
  state.selectedMessages.clear(); state.searchQuery = ''; state.authorFilter = '';
  clearAttachment();
  resetComposerContext(true);
  $('chatTitle').textContent = 'Wybierz kanał'; $('chatTopic').textContent = '';
  $('headerIcon').textContent = '#'; $('chatView').hidden = true; $('welcomePanel').hidden = false;
  $('refreshMessages').disabled = true;
  $('deleteChannelButton').hidden = true;
  ['searchMessagesButton','pinsButton','permissionsButton','threadButton','editChannelButton','archiveThreadButton'].forEach(id => $(id).hidden = true);
  $('messageSearchBar').hidden = true; $('bulkBar').hidden = true; $('newMessagesButton').hidden = true;
  $('messageSearchInput').value=''; $('messageAuthorFilter').value='';
}
function renderGuilds() {
  $('guildIcons').innerHTML = state.guilds.map(g => {
    const url = guildIcon(g);
    const current = g.id === state.guildId;
    const short = g.name?.split(/\s+/).slice(0,2).map(x => x[0] || '').join('') || '?';
    return `<button class="guild-icon${current ? ' active':''}" data-guild-id="${esc(g.id)}" title="${esc(g.name)}" aria-label="Serwer ${esc(g.name)}" aria-pressed="${current}">${imgOrInitial(url, short)}</button>`;
  }).join('');
  $('dmButton').classList.toggle('active', state.mode === 'dm');
}
function renderChannels() {
  const list = $('channelsList');
  const query = $('channelSearch').value.trim().toLocaleLowerCase('pl-PL');
  if (state.mode === 'dm') {
    const matching = state.dms.filter(ch => (ch.name || '').toLocaleLowerCase('pl-PL').includes(query));
    list.innerHTML = matching.map(ch => `<div class="channel-row${state.selectedChannel?.id === ch.id ? ' active' : ''}" data-channel-id="${esc(ch.id)}" role="button" tabindex="0" aria-label="${esc(ch.name)}"><span class="channel-symbol">✉</span><span>${esc(ch.name)}</span>${state.unread.get(ch.id) ? `<b class="unread-badge">${state.unread.get(ch.id)}</b>` : ''}</div>`).join('') || '<p class="sidebar-placeholder">Nie masz jeszcze otwartych DM w tej sesji. Kliknij ✉ i podaj ID użytkownika.</p>';
    return;
  }
  if (!state.guild) { list.innerHTML = '<p class="sidebar-placeholder">Wybierz serwer po lewej stronie.</p>'; return; }
  const categories = state.visible.filter(ch => ch.type === 4).sort((a,b)=>(a.position||0)-(b.position||0));
  const others = state.visible.filter(ch => ch.type !== 4 && ch.type !== 1 && ch.type !== 3);
  // Show permitted child channels even if the parent category itself is hidden.
  const displayed = others;
  const sorted = (items) => [...items].sort((a,b) => (a.position||0)-(b.position||0) || (a.id < b.id ? -1 : 1));
  const row = (ch) => `<div class="channel-row${state.selectedChannel?.id === ch.id ? ' active' : ''}" data-channel-id="${esc(ch.id)}" role="button" tabindex="0" aria-label="${esc(ch.name)}"><span class="channel-symbol">${CHANNEL_TYPES[ch.type] || '#'}</span><span>${esc(ch.name)}</span>${state.unread.get(ch.id) ? `<b class="unread-badge">${state.unread.get(ch.id)}</b>` : ''}</div>`;
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
  state.visible = []; state.guildId = null; state.dms = []; state.mode = 'guild'; state.selectedChannel=null;
  state.canManageChannels = false; state.guildPermissions=0n; state.loadNumber++;
  state.drafts.clear();state.selectedMessages.clear();state.unread.clear();clearAttachment();
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
async function selectGuild(guildId, preferredChannelId = null) {
  const n = ++state.loadNumber;
  state.mode = 'guild';
  state.guildId = guildId;
  state.guild = null; state.channels = []; state.visible = []; state.member = null;
  resetChat(); renderGuilds();
  $('createChannelButton').hidden = true;
  $('serverTitle').textContent = state.guilds.find(g => g.id === guildId)?.name || 'Wczytywanie...';
  $('channelsList').innerHTML = '<p class="loading-placeholder">Wczytywanie kanałów...</p>';
  try {
    const result = await api('guild', {guildId, botId: state.me.id});
    if (n !== state.loadNumber) return;
    if (!result.guild || !Array.isArray(result.channels) || !result.member) throw new Error('Brak danych uprawnień serwera.');
    const threads = Array.isArray(result.activeThreads?.threads) ? result.activeThreads.threads : [];
    state.guild = result.guild; state.member = result.member; state.channels = [...result.channels, ...threads];
    const roles = result.guild.roles;
    if (!Array.isArray(roles) || !roles.some(r=>r.id===guildId)) throw new Error('Nie można odczytać uprawnień serwera.');
    state.visible = state.channels.map(channel => {
      const parent = THREAD_TYPES.has(channel.type) ? result.channels.find(item => item.id === channel.parent_id) : null;
      const target = parent ? {...channel, permission_overwrites:parent.permission_overwrites} : channel;
      return {
      ...channel, calculated: permissionsForChannel(result.guild, result.member, target)
    }}).filter(ch => ch.calculated?.view);
    const base = basePermissions(result.guild, result.member);
    state.guildPermissions = base;
    state.canManageChannels = result.member.user?.id === result.guild.owner_id || has(base, PERM.ADMINISTRATOR) || has(base, PERM.MANAGE_CHANNELS);
    $('createChannelButton').hidden = !state.canManageChannels;
    renderChannels();
    const first = state.visible.find(ch => ch.id === preferredChannelId) || state.visible.find(ch => ch.type === 0 || ch.type === 5) || state.visible.find(ch => ch.type !== 4);
    if (first) await selectChannel(first.id);
    else showToast('Bot nie widzi kanałów na tym serwerze.');
  } catch (error) {
    if (n !== state.loadNumber) return;
    $('channelsList').innerHTML = `<p class="sidebar-placeholder">${esc(error.message)}</p>`;
    showToast(error.message, true);
  }
}
function dmDisplayName(channel) {
  const recipient = Array.isArray(channel?.recipients) ? channel.recipients[0] : null;
  return recipient?.global_name || recipient?.username || `DM ${channel?.id || ''}`;
}
function showDmView() {
  state.mode = 'dm'; state.guildId = null; state.guild = null; state.member = null;
  state.channels = []; state.visible = state.dms;
  state.canManageChannels = false;
  $('serverTitle').textContent = 'Wiadomości prywatne';
  $('createChannelButton').hidden = true;
  resetChat(); renderGuilds(); renderChannels();
}
function openDmDialog() {
  $('dmUserId').value = '';
  $('dmDialog').showModal();
  requestAnimationFrame(() => $('dmUserId').focus());
}
async function createDm(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { $('dmDialog').close(); return; }
  const userId = $('dmUserId').value.trim();
  if (!validId(userId) || state.busy) return;
  state.busy = true; $('openDmSubmit').disabled = true;
  try {
    const channel = await api('create_dm', {userId});
    if (!channel?.id || Number(channel.type) !== 1) throw new Error('Discord nie zwrócił prawidłowego kanału DM.');
    const dm = { ...channel, name: dmDisplayName(channel), calculated: {view:true, history:true, send:true, manageMessages:false, manageChannels:false, manageThreads:false, addReactions:true, createThreads:false, pinMessages:false, kick:false, ban:false, moderate:false, admin:false} };
    state.dms = [dm, ...state.dms.filter(item => item.id !== dm.id)];
    $('dmDialog').close(); showDmView();
    await selectChannel(dm.id);
  } catch (error) { showToast(error.message, true); }
  finally { state.busy = false; $('openDmSubmit').disabled = false; }
}
async function selectChannel(channelId) {
  const channel = state.visible.find(ch => ch.id === channelId && ch.calculated?.view);
  if (!channel) return;
  saveDraft();
  state.selectedChannel = channel;
  state.messages = []; state.before = null; state.hasMore = false;
  state.unread.delete(channelId); state.selectedMessages.clear(); clearAttachment();
  resetComposerContext(true); loadDraft(channelId);
  const n = ++state.loadNumber;
  $('welcomePanel').hidden = true; $('chatView').hidden = false;
  $('chatTitle').textContent = channel.name;
  $('headerIcon').textContent = CHANNEL_TYPES[channel.type] || '#';
  $('chatTopic').textContent = channel.topic || '';
  $('refreshMessages').disabled = false;
  $('deleteChannelButton').hidden = state.mode !== 'guild' || !state.canManageChannels || channel.type === 11 || channel.type === 12;
  $('searchMessagesButton').hidden = false;
  $('pinsButton').hidden = !channel.calculated?.history;
  $('permissionsButton').hidden = false;
  $('editChannelButton').hidden = state.mode !== 'guild' || !channel.calculated?.manageChannels || THREAD_TYPES.has(channel.type);
  $('threadButton').hidden = state.mode !== 'guild' || ![0,5].includes(channel.type) || !channel.calculated?.createThreads;
  $('archiveThreadButton').hidden = state.mode !== 'guild' || !THREAD_TYPES.has(channel.type) || !(channel.owner_id === state.me?.id || channel.calculated?.manageThreads);
  $('deleteChannelButton').hidden = state.mode !== 'guild' || !state.canManageChannels || THREAD_TYPES.has(channel.type);
  $('messageSearchBar').hidden = true; $('bulkBar').hidden = true; $('newMessagesButton').hidden = true;
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
  $('attachButton').disabled = !canSend; $('embedButton').disabled = !canSend;
  updateComposerPlaceholder();
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
    const value = e.id ? `<:${e.name}:${e.id}>` : (e.name || '');
    return `<button type="button" class="reaction${r.me ? ' mine' : ''}" data-reaction-emoji="${esc(value)}" data-message-id="${esc(msg.id)}" title="${r.me ? 'Usuń swoją reakcję' : 'Dodaj reakcję'}">${emojiUrl ? `<img src="${esc(emojiUrl)}" alt="${esc(e.name || '')}">` : esc(e.name || '◈')} ${Number(r.count) || 0}</button>`;
  }).join('')}</div>` : '';
  const referenced = msg.referenced_message;
  const replyName = referenced?.member?.nick || referenced?.author?.global_name || referenced?.author?.username;
  const replyText = referenced?.content?.trim();
  const reply = msg.message_reference?.message_id
    ? `<div class="msg-reply">↳ ${replyName ? `<strong>${esc(replyName)}</strong> ` : ''}${esc(replyText ? replyText.slice(0,120) : 'Odpowiedź na wiadomość')}</div>` : '';
  const own = author.id === state.me?.id;
  const canDelete = own || state.selectedChannel?.calculated?.manageMessages;
  const canReply = state.selectedChannel?.calculated?.send;
  const canPin = state.selectedChannel?.calculated?.pinMessages;
  const actionButtons = `${canReply ? `<button type="button" data-message-action="reply" data-message-id="${esc(msg.id)}" title="Odpowiedz" aria-label="Odpowiedz">↩</button>` : ''}${state.selectedChannel?.calculated?.addReactions ? `<button type="button" data-message-action="react" data-message-id="${esc(msg.id)}" title="Dodaj reakcję" aria-label="Dodaj reakcję">☺</button>` : ''}${canPin ? `<button type="button" data-message-action="pin" data-message-id="${esc(msg.id)}" title="${msg.pinned ? 'Odepnij' : 'Przypnij'}" aria-label="${msg.pinned ? 'Odepnij' : 'Przypnij'}">⌖</button>` : ''}${state.selectedChannel?.calculated?.manageMessages ? `<button type="button" data-message-action="select" data-message-id="${esc(msg.id)}" title="Zaznacz" aria-label="Zaznacz">☐</button>` : ''}${own && msg.content ? `<button type="button" data-message-action="edit" data-message-id="${esc(msg.id)}" title="Edytuj" aria-label="Edytuj">✎</button>` : ''}${canDelete ? `<button type="button" class="danger" data-message-action="delete" data-message-id="${esc(msg.id)}" title="Usuń" aria-label="Usuń">⌫</button>` : ''}`;
  const actions = actionButtons ? `<div class="msg-actions">${actionButtons}</div>` : '';
  const selected = state.selectedMessages.has(msg.id);
  return `<article class="msg first${selected ? ' selected' : ''}" data-message-id="${esc(msg.id)}">${actions}${state.selectedChannel?.calculated?.manageMessages ? `<button class="message-select${selected ? ' checked' : ''}" type="button" data-message-action="select" data-message-id="${esc(msg.id)}" aria-label="Zaznacz wiadomość">${selected ? '☑' : '☐'}</button>` : ''}<button class="msg-avatar" data-user-id="${esc(author.id || '')}" aria-label="Pokaż profil ${esc(displayName)}">${imgOrInitial(avatar,displayName)}</button><div class="msg-content"><div class="msg-line"><button class="msg-user" data-user-id="${esc(author.id || '')}">${esc(displayName)}</button>${isBot?'<span class="bot-pill">BOT</span>':''}${msg.pinned ? '<span class="pin-pill">⌖ PRZYPIĘTA</span>' : ''}<time class="msg-time" datetime="${esc(msg.timestamp)}">${esc(timeFor(msg.timestamp))}</time>${msg.edited_timestamp ? '<span class="msg-edited">(edytowano)</span>' : ''}</div>${reply}${msg.content ? `<div class="msg-text">${linkify(msg.content)}</div>` : ''}${attachmentHtml}${embedsHtml}${reactionsHtml}${!msg.content && !attachments.length && !embedsHtml ? '<div class="msg-text msg-empty-text">(brak treści lub treść niedostępna dla bota)</div>' : ''}</div></article>`;
}
function renderMessages(shouldStickToBottom = true) {
  const list = $('messageList');
  if (!state.selectedChannel) return;
  const c = state.selectedChannel;
  const intro = `<div class="channel-intro"><div class="channel-intro-icon">${CHANNEL_TYPES[c.type] || '#'}</div><h2>Witaj na #${esc(c.name)}!</h2><p>To początek historii wiadomości dostępnej dla Twojego bota.</p></div>`;
  const authors = new Map();
  state.messages.forEach(msg => { if (msg.author?.id) authors.set(msg.author.id, msg.member?.nick || msg.author.global_name || msg.author.username || msg.author.id); });
  const authorSelect = $('messageAuthorFilter');
  const currentAuthor = state.authorFilter;
  authorSelect.innerHTML = '<option value="">Wszyscy autorzy</option>' + [...authors].map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
  authorSelect.value = currentAuthor;
  const query = state.searchQuery.toLocaleLowerCase('pl-PL');
  const filtered = state.messages.filter(msg => (!query || (msg.content || '').toLocaleLowerCase('pl-PL').includes(query)) && (!state.authorFilter || msg.author?.id === state.authorFilter));
  list.innerHTML = intro + (filtered.length
    ? filtered.map((msg, i) => renderMessage(msg, filtered[i-1])).join('')
    : state.messages.length && (query || state.authorFilter) ? '<div class="empty-messages">Brak wiadomości pasujących do filtrów.</div>'
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
      return old && (old.content !== m.content || old.edited_timestamp !== m.edited_timestamp || old.pinned !== m.pinned || JSON.stringify(old.reactions || []) !== JSON.stringify(m.reactions || []));
    });
    if (changed) {
      const byId = new Map(merged.map(m => [m.id,m]));
      messages.forEach(m => byId.set(m.id,m));
      state.messages = [...byId.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
      renderMessages(atBottom);
      if (fresh.length && !atBottom) {
        const count = (state.unread.get(channel.id) || 0) + fresh.length;
        state.unread.set(channel.id, count); $('newMessagesCount').textContent = count;
        $('newMessagesButton').hidden = false; renderChannels();
      } else if (atBottom) {
        state.unread.delete(channel.id); $('newMessagesButton').hidden = true; renderChannels();
      }
    }
    if (!silent) showToast('Wiadomości odświeżone.');
  } catch(err) { if (!silent) showToast(err.message, true); }
}
async function sendMessage(event) {
  event.preventDefault();
  if (!state.selectedChannel || (!$('composerInput').value.trim() && !state.pendingFile) || $('sendButton').disabled) return;
  const input = $('composerInput');
  const channelId = state.selectedChannel.id;
  const content = input.value.trim();
  const mode = state.composerMode;
  const target = state.composerTarget;
  if (mode === 'edit' && !content) return;
  $('sendButton').disabled = true;
  try {
    const message = mode === 'edit'
      ? await api('edit_message', {channelId, messageId: target?.id, content})
      : await api('send', {channelId, content, ...(state.pendingFile ? {file:state.pendingFile} : {}), ...(mode === 'reply' ? {replyTo:target?.id} : {})});
    if (state.selectedChannel?.id !== channelId) return;
    input.value = ''; input.style.height = ''; state.drafts.delete(channelId); clearAttachment();
    resetComposerContext(false);
    if (message?.id) {
      const index = state.messages.findIndex(m => m.id === message.id);
      if (index >= 0) state.messages[index] = message;
      else state.messages.push(message);
      state.messages.sort((a,b) => BigInt(a.id)<BigInt(b.id)?-1:1);
      renderMessages(true);
    }
  } catch(error) { showToast(error.message, true); }
  finally { $('sendButton').disabled = !state.selectedChannel?.calculated?.send; }
}
function setComposerContext(mode, message) {
  if (!message || !state.selectedChannel?.calculated?.send) return;
  state.composerMode = mode; state.composerTarget = message;
  const name = message.member?.nick || message.author?.global_name || message.author?.username || 'użytkownik';
  $('composerContextTitle').textContent = mode === 'edit' ? 'Edytujesz wiadomość' : `Odpowiadasz: ${name}`;
  $('composerContextText').textContent = (message.content || '(wiadomość bez tekstu)').slice(0,180);
  $('composerContext').hidden = false;
  if (mode === 'edit') $('composerInput').value = message.content || '';
  updateComposerPlaceholder();
  $('composerInput').focus();
}
async function handleMessageAction(event) {
  const button = event.target.closest('[data-message-action]');
  if (!button || !state.selectedChannel) return;
  const message = state.messages.find(item => item.id === button.dataset.messageId);
  if (!message) return;
  if (button.dataset.messageAction === 'reply') { setComposerContext('reply', message); return; }
  if (button.dataset.messageAction === 'edit') { setComposerContext('edit', message); return; }
  if (button.dataset.messageAction === 'react') { openReactionDialog(message); return; }
  if (button.dataset.messageAction === 'pin') { await togglePin(message); return; }
  if (button.dataset.messageAction === 'select') { toggleMessageSelection(message.id); return; }
  if (button.dataset.messageAction !== 'delete') return;
  const canDelete = message.author?.id === state.me?.id || state.selectedChannel.calculated?.manageMessages;
  if (!canDelete || !confirm('Usunąć tę wiadomość? Tej operacji nie można cofnąć.')) return;
  button.disabled = true;
  try {
    await api('delete_message', {channelId:state.selectedChannel.id, messageId:message.id});
    state.messages = state.messages.filter(item => item.id !== message.id);
    if (state.composerTarget?.id === message.id) resetComposerContext(true);
    renderMessages(false); showToast('Wiadomość została usunięta.');
  } catch (error) { button.disabled = false; showToast(error.message, true); }
}
function toggleMessageSelection(messageId) {
  if (state.selectedMessages.has(messageId)) state.selectedMessages.delete(messageId);
  else state.selectedMessages.add(messageId);
  $('bulkCount').textContent = state.selectedMessages.size;
  $('bulkBar').hidden = state.selectedMessages.size === 0;
  renderMessages(false);
}
async function deleteSelectedMessages() {
  const ids = [...state.selectedMessages];
  if (!ids.length || !state.selectedChannel?.calculated?.manageMessages) return;
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = ids.filter(id => Number((BigInt(id) >> 22n) + 1420070400000n) > cutoff);
  if (recent.length !== ids.length) { showToast('Usuń z zaznaczenia wiadomości starsze niż 14 dni.', true); return; }
  if (!confirm(`Usunąć ${ids.length} zaznaczonych wiadomości?`)) return;
  $('deleteBulk').disabled = true;
  try {
    if (ids.length === 1) await api('delete_message', {channelId:state.selectedChannel.id, messageId:ids[0]});
    else await api('bulk_delete', {channelId:state.selectedChannel.id, messageIds:ids});
    state.messages = state.messages.filter(msg => !state.selectedMessages.has(msg.id));
    state.selectedMessages.clear(); $('bulkBar').hidden = true; renderMessages(false);
    showToast('Zaznaczone wiadomości zostały usunięte.');
  } catch (error) { showToast(error.message, true); }
  finally { $('deleteBulk').disabled = false; }
}
function openReactionDialog(message) {
  if (!state.selectedChannel?.calculated?.addReactions) return;
  state.contextMessage = message; $('reactionEmoji').value = '';
  $('reactionDialog').showModal(); requestAnimationFrame(()=>$('reactionEmoji').focus());
}
async function submitReaction(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { $('reactionDialog').close(); return; }
  const message = state.contextMessage, emoji = $('reactionEmoji').value.trim();
  if (!message || !emoji) return;
  try {
    await api('reaction', {channelId:state.selectedChannel.id, messageId:message.id, emoji, mode:'add'});
    $('reactionDialog').close(); await refreshMessages(true); showToast('Reakcja została dodana.');
  } catch (error) { showToast(error.message, true); }
}
async function toggleExistingReaction(button) {
  const message = state.messages.find(msg => msg.id === button.dataset.messageId);
  if (!message) return;
  const mode = button.classList.contains('mine') ? 'remove' : 'add';
  try {
    await api('reaction', {channelId:state.selectedChannel.id, messageId:message.id, emoji:button.dataset.reactionEmoji, mode});
    await refreshMessages(true);
  } catch (error) { showToast(error.message, true); }
}
async function togglePin(message) {
  if (!state.selectedChannel?.calculated?.pinMessages) return;
  try {
    await api('pin_message', {channelId:state.selectedChannel.id, messageId:message.id, mode:message.pinned ? 'unpin' : 'pin'});
    message.pinned = !message.pinned; renderMessages(false);
    showToast(message.pinned ? 'Wiadomość przypięta.' : 'Wiadomość odpięta.');
  } catch (error) { showToast(error.message, true); }
}
async function showPins() {
  if (!state.selectedChannel) return;
  $('pinsList').innerHTML = '<div class="loading-placeholder">Wczytywanie…</div>'; $('pinsDialog').showModal();
  try {
    const result = await api('pins', {channelId:state.selectedChannel.id});
    const items = Array.isArray(result?.items) ? result.items : [];
    $('pinsList').innerHTML = items.length ? items.map(item => {
      const msg = item.message || item;
      const name = msg.member?.nick || msg.author?.global_name || msg.author?.username || 'Użytkownik';
      return `<div class="pin-item"><strong>${esc(name)}</strong><time>${esc(timeFor(msg.timestamp))}</time><p>${esc(msg.content || '(wiadomość bez tekstu)')}</p></div>`;
    }).join('') : '<div class="empty-messages">Brak przypiętych wiadomości.</div>';
  } catch (error) { $('pinsList').innerHTML = `<div class="channel-unavailable">${esc(error.message)}</div>`; }
}
function showPermissions() {
  const p = state.selectedChannel?.calculated;
  if (!p) return;
  const entries = [['Widok kanału',p.view],['Historia wiadomości',p.history],['Wysyłanie wiadomości',p.send],['Dodawanie reakcji',p.addReactions],['Zarządzanie wiadomościami',p.manageMessages],['Przypinanie wiadomości',p.pinMessages],['Tworzenie wątków',p.createThreads],['Zarządzanie wątkami',p.manageThreads],['Zarządzanie kanałem',p.manageChannels],['Timeout użytkowników',p.moderate],['Wyrzucanie',p.kick],['Banowanie',p.ban]];
  $('permissionChannelName').textContent = state.selectedChannel.name;
  $('permissionsList').innerHTML = entries.map(([name,ok])=>`<div><span>${esc(name)}</span><b class="${ok?'permission-yes':'permission-no'}">${ok?'✓':'—'}</b></div>`).join('');
  $('permissionsDialog').showModal();
}
function openUserPanel(userId) {
  const msg = state.messages.find(item => item.author?.id === userId);
  if (!msg?.author || !validId(userId)) return;
  const user = msg.author, member = msg.member || {};
  state.selectedUser = {user, member};
  const name = member.nick || user.global_name || user.username || user.id;
  const roles = Array.isArray(member.roles) ? member.roles.map(id=>state.guild?.roles?.find(role=>role.id===id)?.name).filter(Boolean) : [];
  $('userPanel').innerHTML = `<div class="user-panel-head"><div class="user-panel-avatar">${imgOrInitial(avatarUrl(user,128),name)}</div><div><h2>${esc(name)} ${user.bot?'<span class="bot-pill">BOT</span>':''}</h2><p>${esc(user.username || '')}</p></div></div><div class="user-panel-id"><span>ID</span><code>${esc(user.id)}</code></div><div class="role-list">${roles.length?roles.map(role=>`<span>${esc(role)}</span>`).join(''):'<small>Brak ról w danych wiadomości</small>'}</div>`;
  const own = user.id === state.me?.id || state.mode !== 'guild';
  $('userTimeoutButton').hidden = own || !state.selectedChannel?.calculated?.moderate;
  $('userKickButton').hidden = own || !state.selectedChannel?.calculated?.kick;
  $('userBanButton').hidden = own || !state.selectedChannel?.calculated?.ban;
  $('userDmButton').hidden = user.bot || user.id === state.me?.id;
  $('userDialog').showModal();
}
async function moderateUser(action) {
  const userId = state.selectedUser?.user?.id, guildId = state.guildId;
  if (!userId || !guildId) return;
  try {
    if (action === 'timeout') {
      const choice = prompt('Czas timeoutu w minutach: 1, 5, 10, 60, 1440, 10080 lub 40320. Wpisz 0, aby zdjąć timeout.', '10');
      if (choice === null) return;
      await api('timeout_member', {guildId,userId,minutes:Number(choice)});
      showToast(Number(choice) === 0 ? 'Timeout został zdjęty.' : 'Użytkownik otrzymał timeout.');
    } else {
      const label = action === 'kick' ? 'wyrzucić' : 'zbanować';
      if (!confirm(`Czy na pewno ${label} tego użytkownika?`)) return;
      await api(action === 'kick' ? 'kick_member' : 'ban_member',{guildId,userId});
      showToast(action === 'kick' ? 'Użytkownik został wyrzucony.' : 'Użytkownik został zbanowany.');
    }
    $('userDialog').close();
  } catch (error) { showToast(error.message, true); }
}
function openContextMenu(event) {
  const article = event.target.closest('[data-message-id]');
  if (!article) return;
  const message = state.messages.find(msg=>msg.id===article.dataset.messageId);
  if (!message) return;
  event.preventDefault(); state.contextMessage = message;
  const menu = $('contextMenu');
  const own = message.author?.id === state.me?.id;
  menu.querySelector('[data-context-action="edit"]').hidden = !own || !message.content;
  menu.querySelector('[data-context-action="delete"]').hidden = !(own || state.selectedChannel?.calculated?.manageMessages);
  menu.querySelector('[data-context-action="pin"]').hidden = !state.selectedChannel?.calculated?.pinMessages;
  menu.querySelector('[data-context-action="select"]').hidden = !state.selectedChannel?.calculated?.manageMessages;
  menu.querySelector('[data-context-action="react"]').hidden = !state.selectedChannel?.calculated?.addReactions;
  menu.style.left = `${Math.min(event.clientX, innerWidth-210)}px`; menu.style.top = `${Math.min(event.clientY, innerHeight-330)}px`; menu.hidden = false;
}
async function handleContextAction(event) {
  const action = event.target.closest('[data-context-action]')?.dataset.contextAction, msg = state.contextMessage;
  $('contextMenu').hidden = true; if (!action || !msg) return;
  if (action === 'reply' || action === 'edit') setComposerContext(action, msg);
  else if (action === 'react') openReactionDialog(msg);
  else if (action === 'pin') await togglePin(msg);
  else if (action === 'select') toggleMessageSelection(msg.id);
  else if (action === 'delete') {
    const fake = {target:{closest:()=>({dataset:{messageAction:'delete',messageId:msg.id},disabled:false})}};
    await handleMessageAction(fake);
  } else {
    const value = action === 'copy-id' ? msg.id : action === 'copy-link' ? `https://discord.com/channels/${state.guildId || '@me'}/${state.selectedChannel.id}/${msg.id}` : (msg.content || '');
    try { await navigator.clipboard.writeText(value); showToast('Skopiowano do schowka.'); } catch { showToast('Nie udało się skopiować.', true); }
  }
}
async function chooseAttachment(file) {
  if (!file) return;
  if (file.size > 2_500_000) { showToast('Plik jest za duży. Limit BotView to 2,5 MB.', true); return; }
  const dataUrl = await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('Nie udało się odczytać pliku.')); reader.readAsDataURL(file); });
  state.pendingFile = {name:file.name,type:file.type||'application/octet-stream',data:String(dataUrl).split(',')[1]||''};
  $('attachmentName').textContent = file.name; $('attachmentSize').textContent = `${(file.size/1024).toFixed(1)} KB`; $('attachmentPreview').hidden = false;
}
function updateEmbedPreview() {
  const title=$('embedTitle').value, description=$('embedDescription').value;
  $('embedPreview').style.borderColor=$('embedColor').value;
  $('embedPreview').innerHTML=`${title?`<strong>${esc(title)}</strong>`:''}${description?`<p>${esc(description)}</p>`:'<small>Podgląd embedu</small>'}`;
}
async function sendEmbed(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { $('embedDialog').close(); return; }
  const embed={title:$('embedTitle').value,description:$('embedDescription').value,color:$('embedColor').value,url:$('embedUrl').value};
  if (!embed.title.trim() && !embed.description.trim()) { showToast('Dodaj tytuł lub opis embedu.',true); return; }
  try {
    const message=await api('send',{channelId:state.selectedChannel.id,content:'',embed});
    $('embedDialog').close(); if(message?.id){state.messages.push(message);state.messages.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);renderMessages(true);} showToast('Embed został wysłany.');
  } catch(error){showToast(error.message,true);}
}
function prepareChannelDialog() {
  if (!state.guild || !state.canManageChannels) return;
  $('channelName').value = ''; $('channelType').value = '0'; $('channelTopicInput').value = '';
  $('channelParent').innerHTML = '<option value="">Bez kategorii</option>' + state.channels.filter(ch => ch.type === 4).sort((a,b)=>(a.position||0)-(b.position||0)).map(ch => `<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join('');
  updateChannelFormType(); $('channelDialog').showModal();
  requestAnimationFrame(() => $('channelName').focus());
}
function updateChannelFormType() {
  const isText = $('channelType').value === '0';
  $('channelParentField').hidden = !isText; $('channelTopicField').hidden = !isText;
}
async function createChannel(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { $('channelDialog').close(); return; }
  if (!state.guildId || !state.canManageChannels || state.busy) return;
  const guildId = state.guildId;
  const name = $('channelName').value.trim();
  const type = Number($('channelType').value);
  if (!name || ![0,4].includes(type)) return;
  state.busy = true; $('createChannelSubmit').disabled = true;
  try {
    const channel = await api('create_channel', {guildId, name, type, parentId:$('channelParent').value, topic:$('channelTopicInput').value});
    if (!channel?.id) throw new Error('Discord nie zwrócił utworzonego kanału.');
    $('channelDialog').close(); showToast(type === 4 ? 'Kategoria została utworzona.' : 'Kanał został utworzony.');
    await selectGuild(guildId, type === 0 ? channel.id : null);
  } catch (error) { showToast(error.message, true); }
  finally { state.busy = false; $('createChannelSubmit').disabled = false; }
}
async function deleteCurrentChannel() {
  const channel = state.selectedChannel;
  if (state.mode !== 'guild' || !channel || !state.canManageChannels) return;
  if (!confirm(`Usunąć kanał #${channel.name}? Kanał i jego wiadomości znikną bez możliwości przywrócenia.`)) return;
  $('deleteChannelButton').disabled = true;
  try {
    await api('delete_channel', {channelId:channel.id});
    const guildId = state.guildId;
    showToast('Kanał został usunięty.');
    await selectGuild(guildId);
  } catch (error) { showToast(error.message, true); }
  finally { $('deleteChannelButton').disabled = false; }
}
function prepareEditChannel() {
  const channel=state.selectedChannel;
  if (!channel || !channel.calculated?.manageChannels || THREAD_TYPES.has(channel.type)) return;
  $('editChannelName').value=channel.name||''; $('editChannelTopic').value=channel.topic||'';
  $('editChannelParent').innerHTML='<option value="">Bez kategorii</option>'+state.channels.filter(ch=>ch.type===4).map(ch=>`<option value="${esc(ch.id)}">${esc(ch.name)}</option>`).join('');
  $('editChannelParent').value=channel.parent_id||''; $('editChannelSlowmode').value=String(channel.rate_limit_per_user||0);
  if (!$('editChannelSlowmode').value) $('editChannelSlowmode').value='0';
  $('editChannelNsfw').checked=Boolean(channel.nsfw); $('editChannelDialog').showModal();
}
async function editCurrentChannel(event) {
  event.preventDefault(); if(event.submitter?.value==='cancel'){$('editChannelDialog').close();return;}
  const channel=state.selectedChannel; if(!channel)return;
  try{
    const updated=await api('edit_channel',{channelId:channel.id,name:$('editChannelName').value,topic:$('editChannelTopic').value,parentId:$('editChannelParent').value,slowmode:Number($('editChannelSlowmode').value),nsfw:$('editChannelNsfw').checked});
    Object.assign(channel,updated); $('editChannelDialog').close(); $('chatTitle').textContent=channel.name; $('chatTopic').textContent=channel.topic||''; renderChannels(); showToast('Ustawienia kanału zapisane.');
  }catch(error){showToast(error.message,true);}
}
function prepareThreadDialog(){if(!state.selectedChannel?.calculated?.createThreads)return;$('threadName').value='';$('threadDuration').value='1440';$('threadDialog').showModal();requestAnimationFrame(()=>$('threadName').focus());}
async function createThread(event){
  event.preventDefault();if(event.submitter?.value==='cancel'){$('threadDialog').close();return;}
  const parent=state.selectedChannel;if(!parent)return;
  try{
    const thread=await api('create_thread',{channelId:parent.id,name:$('threadName').value,duration:Number($('threadDuration').value)});
    if(!thread?.id)throw new Error('Discord nie zwrócił utworzonego wątku.');
    const target={...thread,permission_overwrites:parent.permission_overwrites};thread.calculated=permissionsForChannel(state.guild,state.member,target);
    state.channels.push(thread);state.visible.push(thread);$('threadDialog').close();renderChannels();await selectChannel(thread.id);showToast('Wątek został utworzony.');
  }catch(error){showToast(error.message,true);}
}
async function archiveThread(){
  const channel=state.selectedChannel;if(!channel||!THREAD_TYPES.has(channel.type))return;
  if(!confirm(`Zarchiwizować wątek ${channel.name}?`))return;
  try{await api('archive_thread',{channelId:channel.id,locked:Boolean(channel.calculated?.manageThreads)});const guildId=state.guildId;showToast('Wątek został zarchiwizowany.');await selectGuild(guildId);}catch(error){showToast(error.message,true);}
}
function toggleMessageSearch(){
  $('messageSearchBar').hidden=!$('messageSearchBar').hidden;
  if(!$('messageSearchBar').hidden)$('messageSearchInput').focus();
  else{state.searchQuery='';state.authorFilter='';$('messageSearchInput').value='';renderMessages(false);}
}
function showEmbedDialog(){
  if(!state.selectedChannel?.calculated?.send)return;
  $('embedTitle').value='';$('embedDescription').value='';$('embedColor').value='#5865f2';$('embedUrl').value='';updateEmbedPreview();$('embedDialog').showModal();
}
document.querySelectorAll('button[value="cancel"]').forEach(button=>{button.formNoValidate=true;});
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
$('messageList').addEventListener('click',handleMessageAction);
$('messageList').addEventListener('click',event=>{
  const reaction=event.target.closest('[data-reaction-emoji]');if(reaction)toggleExistingReaction(reaction);
  const user=event.target.closest('[data-user-id]');if(user?.dataset.userId)openUserPanel(user.dataset.userId);
});
$('messageList').addEventListener('contextmenu',openContextMenu);
$('channelSearch').addEventListener('input',renderChannels);
$('logoutButton').addEventListener('click',logout);
$('logoutSide').addEventListener('click',logout);
$('reloadGuilds').addEventListener('click',reloadGuilds);
$('refreshMessages').addEventListener('click',()=>refreshMessages(false));
$('olderButton').addEventListener('click',()=>loadMessages(state.loadNumber,true));
$('composerForm').addEventListener('submit',sendMessage);
$('cancelComposerContext').addEventListener('click',()=>resetComposerContext(state.composerMode === 'edit'));
$('composerInput').addEventListener('keydown',event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); $('composerForm').requestSubmit();
  }
});
$('composerInput').addEventListener('input',event => {
  event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight,160)+'px';
  saveDraft();
});
$('mobileMenu').addEventListener('click',()=> $('channelsPanel').classList.toggle('open'));
$('homeButton').addEventListener('click',()=> { resetChat(); $('channelsPanel').classList.remove('open'); });
$('dmButton').addEventListener('click',()=> { if (state.dms.length) showDmView(); else openDmDialog(); });
$('openDmButton').addEventListener('click',openDmDialog);
$('dmForm').addEventListener('submit',createDm);
$('createChannelButton').addEventListener('click',prepareChannelDialog);
$('channelType').addEventListener('change',updateChannelFormType);
$('channelForm').addEventListener('submit',createChannel);
$('deleteChannelButton').addEventListener('click',deleteCurrentChannel);
$('editChannelButton').addEventListener('click',prepareEditChannel);
$('editChannelForm').addEventListener('submit',editCurrentChannel);
$('threadButton').addEventListener('click',prepareThreadDialog);
$('threadForm').addEventListener('submit',createThread);
$('archiveThreadButton').addEventListener('click',archiveThread);
$('permissionsButton').addEventListener('click',showPermissions);
$('closePermissions').addEventListener('click',()=>$('permissionsDialog').close());
$('pinsButton').addEventListener('click',showPins);
$('closePins').addEventListener('click',()=>$('pinsDialog').close());
$('searchMessagesButton').addEventListener('click',toggleMessageSearch);
$('closeMessageSearch').addEventListener('click',toggleMessageSearch);
$('messageSearchInput').addEventListener('input',event=>{state.searchQuery=event.target.value.trim();renderMessages(false);});
$('messageAuthorFilter').addEventListener('change',event=>{state.authorFilter=event.target.value;renderMessages(false);});
$('attachButton').addEventListener('click',()=>$('fileInput').click());
$('fileInput').addEventListener('change',event=>chooseAttachment(event.target.files?.[0]).catch(error=>showToast(error.message,true)));
$('removeAttachment').addEventListener('click',clearAttachment);
$('embedButton').addEventListener('click',showEmbedDialog);
$('embedForm').addEventListener('submit',sendEmbed);
['embedTitle','embedDescription','embedColor'].forEach(id=>$(id).addEventListener('input',updateEmbedPreview));
$('reactionForm').addEventListener('submit',submitReaction);
$('bulkBar').addEventListener('click',event=>{if(event.target.id==='cancelBulk'){state.selectedMessages.clear();$('bulkBar').hidden=true;renderMessages(false);}});
$('deleteBulk').addEventListener('click',deleteSelectedMessages);
$('newMessagesButton').addEventListener('click',()=>{state.unread.delete(state.selectedChannel?.id);$('newMessagesButton').hidden=true;renderChannels();scrollToBottom();});
$('contextMenu').addEventListener('click',handleContextAction);
$('closeUser').addEventListener('click',()=>$('userDialog').close());
$('userDmButton').addEventListener('click',()=>{const id=state.selectedUser?.user?.id;if(!id)return;$('userDialog').close();openDmDialog();$('dmUserId').value=id;});
$('userTimeoutButton').addEventListener('click',()=>moderateUser('timeout'));
$('userKickButton').addEventListener('click',()=>moderateUser('kick'));
$('userBanButton').addEventListener('click',()=>moderateUser('ban'));
document.addEventListener('click',event=>{if(!event.target.closest('#contextMenu'))$('contextMenu').hidden=true;});
document.addEventListener('keydown',event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !$('appShell').hidden) {
    event.preventDefault(); $('channelsPanel').classList.add('open'); $('channelSearch').focus();
  }
  if (event.key === 'Escape') $('channelsPanel').classList.remove('open');
});
