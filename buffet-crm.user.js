// ==UserScript==
// @name         Buffet CRM — WhatsApp Web
// @namespace    buffet.crm
// @version      1.0.0
// @homepageURL  https://github.com/imwezz/crm
// @updateURL    https://raw.githubusercontent.com/imwezz/crm/main/buffet-crm.user.js
// @downloadURL  https://raw.githubusercontent.com/imwezz/crm/main/buffet-crm.user.js
// @match        https://web.whatsapp.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_info
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      yjrgplznhdcwvrxobfpz.supabase.co
// @connect      wdkmbwwaesoaihaijkon.supabase.co
// ==/UserScript==

(() => {
  'use strict';

  // ================= CONFIGURAÇÃO DO SUPABASE =================
  const BUFFETS = Object.freeze({
    jumboloo: { name: 'Jumboloo', ref: 'yjrgplznhdcwvrxobfpz', key: 'sb_publishable_-rSvy-LzT6BEnd90ApvxTw_yiF1Zb29' },
    gym: { name: 'Gym', ref: 'wdkmbwwaesoaihaijkon', key: 'sb_publishable_qj_9XSjBFqxU9EKW7teNLg_0niSOIcg' },
  });
  const BUFFET_KEY = 'buffet-crm-selected-buffet';
  const savedBuffet = GM_getValue(BUFFET_KEY, 'jumboloo');
  let buffetId = Object.hasOwn(BUFFETS, savedBuffet) ? savedBuffet : 'jumboloo';
  const sessionKey = id => 'buffet-crm-supabase-session-' + BUFFETS[id].ref;
  let SESSION_KEY = sessionKey(buffetId);
  const DEFAULT_COUNTRY_CODE = '55';
  // As chaves acima são públicas. Cada projeto tem sua própria sessão.
  // ===========================================================

  // Seletores dos HTMLs de contatos comuns, não salvos, comerciais e pesquisa.
  // data-testid do subtítulo pode conter mais de um termo.
  const SELECTORS = Object.freeze({
    header: '#main [data-testid="conversation-header"]',
    title: '[data-testid="conversation-info-header-chat-title"]',
    info: '[data-testid="conversation-info-header"]',
    profile: '[role="button"][aria-label="Dados do perfil"]',
    search: '#main [data-testid="conversation-header"] button[aria-label="Pesquisar"]',
    right: '[data-testid="drawer-right"]',
    drawer: '[data-testid="chat-info-drawer"]',
    contactHeader: '[data-testid="contact-info-header"]',
    contactName: '[data-testid~="contact-info-subtitle"]',
    businessName: '[data-testid="business-top-card-name-title"]',
    phoneSection: '[data-testid="section-about-and-phone-number"]',
    phoneRow: '[data-testid="container_with_separator"]',
    phoneText: '[data-testid="selectable-text"]',
    groupHeader: '[data-testid="group-info-header"]',
    groupPicture: '[data-testid="group-chat-profile-picture"]',
    groupRegion: '[aria-label="Dados do grupo"]',
    chatRow: '#pane-side [data-testid="cell-frame-container"]',
    messages: '[data-testid="conversation-panel-body"]',
    navbar: '[data-testid="navbar-primary-section"]',
    metaAI: 'button[aria-label="Meta AI"]',
    screen: '[data-testid="wa-web-main-screen"]',
  });
  const STAGES = Object.freeze({
    NOVO_LEAD: 'Novo lead', ORCAMENTO_ENVIADO: 'Orçamento enviado',
    EM_NEGOCIACAO: 'Em negociação', FECHAMENTO: 'Fechamento', FECHADO: 'Fechado', PERDIDO: 'Perdido',
  });
  const HOST_ID = 'buffet-crm-root';
  if (document.getElementById(HOST_ID)) return;
  const state = {
    current: null, generation: 0, controller: null, header: null, titleNode: null,
    signature: '', syncTimer: null, headerObserver: null, captureQueue: Promise.resolve(),
    panelMode: 'closed', view: 0, editor: null, leavePrompt: null, navigationApproved: 0,
    forceConversation: false, blockedIdentity: null,
    deadlineTimer: null, refreshDeadline: null, nativeClose: null,
    conversationLayout: null, layoutHoldUntil: 0, layoutResumeTimer: null,
  };
  let cache = null;
  let cacheTime = 0;
  let storageQueue = Promise.resolve();
  const CACHE_TTL = 30000;

  // A versão vem do cabeçalho instalado; só há um número para editar a cada release.
  const SCRIPT_VERSION = typeof GM_info === 'object' ? GM_info.script.version : '';
  const SCRIPT_DOWNLOAD_URL = 'https://raw.githubusercontent.com/imwezz/crm/main/buffet-crm.user.js';
  const updates = { status: 'checking', latest: null, work: null, modal: null, next: null };

  function releaseNumbers(version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versão do CRM inválida.');
    const parts = version.split('.').map(Number);
    if (!parts.every(Number.isSafeInteger)) throw new Error('Versão do CRM inválida.');
    return parts;
  }
  function requiresUpdate(installed, latest) {
    const current = releaseNumbers(installed); const published = releaseNumbers(latest);
    return published[0] > current[0] || (published[0] === current[0] && published[1] > current[1]);
  }
  function publishedVersion() {
    return new Promise((resolve, reject) => {
      const unavailable = () => reject(new Error('Não foi possível verificar as atualizações. Confira sua conexão e tente novamente.'));
      GM_xmlhttpRequest({ method: 'GET', url: SCRIPT_DOWNLOAD_URL + '?crm-check=' + Date.now(),
        headers: { 'Cache-Control': 'no-cache' }, timeout: 15000, anonymous: true,
        onload(response) {
          if (response.status !== 200) { unavailable(); return; }
          // Lê apenas metadados. O código remoto nunca é executado pelo CRM.
          const metadata = /^\uFEFF?\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==/m.exec(response.responseText || '')?.[1];
          const version = /^\/\/\s+@version\s+(\S+)\s*$/m.exec(metadata || '')?.[1];
          const namespace = /^\/\/\s+@namespace\s+(\S+)\s*$/m.exec(metadata || '')?.[1];
          try {
            if (namespace !== 'buffet.crm') throw new Error('Metadados do CRM inválidos.');
            releaseNumbers(version || ''); resolve(version);
          } catch { unavailable(); }
        },
        onerror: unavailable, ontimeout: unavailable, onabort: unavailable,
      });
    });
  }
  function checkForUpdates() {
    if (updates.work) return updates.work;
    updates.status = 'checking';
    updates.work = publishedVersion().then(version => {
      updates.latest = version;
      updates.status = requiresUpdate(SCRIPT_VERSION, version) ? 'required' : 'ready';
    }).catch(() => { updates.status = 'error'; }).finally(() => {
      updates.work = null;
      if (updates.status === 'ready') {
        updates.modal?.remove(); updates.modal = null;
        const next = updates.next; updates.next = null; next?.();
      } else if (updates.status === 'required' || updates.modal?.isConnected) showUpdateDialog();
    });
    return updates.work;
  }
  function gateUpdates(work) {
    if (updates.status === 'ready') return false;
    updates.next = work; showUpdateDialog(); return true;
  }
  function showUpdateDialog() {
    const previousFocus = shadow.activeElement;
    updates.modal?.remove();
    const backdrop = el('div', { className: 'modal-backdrop', 'data-crm-update': '' });
    const close = () => {
      backdrop.remove(); updates.modal = null; updates.next = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    const required = updates.status === 'required'; const checking = updates.status === 'checking';
    const content = required
      ? el('p', { text: `A versão ${updates.latest} está disponível. Atualize o CRM para continuar.` })
      : checking ? loadingBox('Verificando atualizações…')
        : statusBox('Não foi possível verificar as atualizações. Confira sua conexão e tente novamente.', 'error');
    const controls = el('div', { className: 'row wrap', style: 'justify-content:flex-end;margin-top:20px' },
      button('Voltar ao WhatsApp', close));
    if (required) {
      controls.append(button('Atualizar', () => {
        try {
          // O instalador oficial pede a confirmação; o CRM não instala código por conta própria.
          const source = SCRIPT_DOWNLOAD_URL + '?crm-update=' + Date.now();
          GM_openInTab('https://www.tampermonkey.net/script_installation.php#url=' + encodeURIComponent(source),
            { active: true, insert: true, setParent: true });
          content.textContent = 'Confirme a atualização na aba do Tampermonkey. Depois, recarregue o WhatsApp Web para usar a nova versão.';
          if (!controls.querySelector('[data-crm-reload]')) controls.append(buttonReload());
        } catch { content.textContent = 'Não foi possível abrir o Tampermonkey. Clique em Atualizar para tentar novamente.'; }
      }, 'primary'));
    } else if (!checking) {
      controls.append(button('Tentar novamente', () => { checkForUpdates(); showUpdateDialog(); }, 'primary'));
    }
    function buttonReload() { return el('button', { type: 'button', 'data-crm-reload': '', text: 'Recarregar WhatsApp', onclick: () => location.reload() }); }
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Atualização do CRM' },
      el('h2', { text: required ? 'Atualização obrigatória' : 'Atualização do CRM' }), content, controls));
    updates.modal = backdrop; shadow.append(backdrop); controls.querySelector('button').focus();
  }

  // 1. Telefones, datas e apresentação.
  function normalizePhone(value) {
    let text = String(value ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (!text || !/^\+?[\d\s().-]+$/.test(text)) return null;
    const international = text.startsWith('+') || text.startsWith('00');
    let digits = text.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!international && (digits.length === 10 || digits.length === 11)) {
      digits = DEFAULT_COUNTRY_CODE + digits;
    }
    return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
  }
  function formatPhone(value) {
    const phone = normalizePhone(value);
    if (!phone) return '—';
    if (phone.startsWith('55') && (phone.length === 12 || phone.length === 13)) {
      const number = phone.slice(4);
      return `+55 (${phone.slice(2, 4)}) ${number.slice(0, -4)}-${number.slice(-4)}`;
    }
    return `+${phone}`;
  }
  function contactLabel(name, phone = null) {
    const text = String(name || '').trim();
    if (text && ((phone && normalizePhone(text) === phone) || /^(?:\+|00)\d/.test(text))) return formatPhone(text);
    return text || (phone ? formatPhone(phone) : 'Lead sem nome');
  }
  function localDate(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && localDate(date) === value;
  }
  function followStatus(follow, now = new Date()) {
    if (!follow?.data || !validDate(follow.data)) return 'none';
    const today = localDate(now);
    if (follow.data < today) return 'late';
    if (follow.data > today) return 'future';
    if (follow.hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(follow.hora)) {
      const due = new Date(`${follow.data}T${follow.hora}:00`);
      if (due.getTime() < now.getTime()) return 'late';
    }
    return 'today';
  }
  function dateLabel(value) {
    return validDate(value || '') ? value.split('-').reverse().join('/') : '—';
  }
  function timestampLabel(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('pt-BR') : '—';
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function abortError() { return new DOMException('Conversa alterada.', 'AbortError'); }
  function errorMessage(error) { return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'; }

  // 2. Supabase: Auth persistido no Tampermonkey e gravação transacional.
  let session = GM_getValue(SESSION_KEY, null);
  let sessionVerified = false;
  let refreshWork = null;
  let refreshTimer = null;
  let loginModal = null;
  let sessionModal = null;
  let restoreWork = null;
  let restoreEpoch = -1;
  let authEpoch = 0;

  function userProfile(user) {
    const meta = user.user_metadata || {};
    const name = [meta.full_name, meta.name, meta.nome].find(value => typeof value === 'string' && value.trim());
    return { id: user.id, email: user.email || '', name: name?.trim() || '' };
  }
  function selectBuffet(id) {
    if (!Object.hasOwn(BUFFETS, id)) throw new Error('Selecione um buffet válido.');
    if (id === buffetId) return;
    authEpoch++; clearTimeout(refreshTimer); clearUserData();
    buffetId = id; SESSION_KEY = sessionKey(id);
    session = GM_getValue(SESSION_KEY, null); sessionVerified = false;
    refreshWork = null; restoreWork = null;
  }

  function apiRequest(method, path, body, token = null) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('Não foi possível iniciar o CRM. Recarregue a página ou peça ajuda ao responsável.')); return;
      }
      const project = BUFFETS[buffetId];
      const headers = { apikey: project.key, 'Content-Type': 'application/json' };
      if (path.startsWith('/rest/v1/')) {
        headers['Accept-Profile'] = 'crm'; headers['Content-Profile'] = 'crm';
      }
      if (token) headers.Authorization = 'Bearer ' + token;
      GM_xmlhttpRequest({ method, url: 'https://' + project.ref + '.supabase.co' + path, headers,
        data: body === undefined ? undefined : JSON.stringify(body), timeout: 20000, anonymous: true,
        onload(response) {
          let result;
          try { result = response.responseText ? JSON.parse(response.responseText) : null; }
          catch { reject(new Error('Não foi possível carregar a resposta. Tente novamente.')); return; }
          if (response.status < 200 || response.status >= 300) {
            const code = result?.code || result?.error_code;
            const error = new Error(response.status === 429 ? 'Muitas solicitações. Aguarde e tente novamente.' :
              code === 'invalid_credentials' ? 'Email ou senha inválidos.' :
              code === 'email_not_confirmed' ? 'Peça ao responsável para confirmar seu email de acesso.' :
              code === 'PT409' || code === '40001' ? 'Esta ficha foi atualizada por outra pessoa. Suas alterações continuam aqui. Descarte a edição e use Atualizar dados para conferir a versão atual.' :
              code === '55P03' || code === '40P01' ? 'Outra alteração está em andamento. Aguarde alguns instantes e tente novamente. Suas alterações continuam aqui.' :
              code === '57014' ? 'A operação demorou mais que o esperado. Use Atualizar dados para conferir o resultado antes de tentar novamente.' :
              code === 'P0002' ? 'Esta ficha foi removida. Atualize os dados para continuar.' :
              code === 'PGRST106' || code === 'PGRST202' || code === '42P01' || code === '42703' ? 'O sistema precisa de uma atualização. Peça ajuda ao responsável.' :
              response.status === 401 ? 'Entre novamente para continuar.' :
              response.status === 403 || code === '42501' ? 'Não foi possível confirmar seu acesso. Entre novamente ou peça ajuda ao responsável.' :
              code === '23505' ? 'Este cadastro já existe. Atualize os dados para conferir.' :
              response.status === 400 || ['22023', '23514', '23502', '22007', '22008', '22P02'].includes(code) ? 'Confira os campos preenchidos e tente novamente.' :
              response.status >= 500 ? 'O sistema está indisponível no momento. Tente novamente em instantes.' :
              'Não foi possível concluir a operação. Tente novamente.');
            error.status = response.status; error.code = code;
            // Diagnóstico disponível no código, sem mostrar respostas técnicas na UI.
            error.details = result;
            reject(error); return;
          }
          resolve(result);
        },
        onerror: () => reject(new Error('Não foi possível conectar. Confira sua internet e tente novamente.')),
        ontimeout: () => reject(new Error('A resposta demorou mais que o esperado. Se estava salvando, use Atualizar dados para conferir se as alterações foram salvas.')),
        onabort: () => reject(new Error('A operação foi interrompida. Tente novamente.')),
      });
    });
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!session?.refresh_token) return;
    const delay = Math.max(1000, Math.min(2147483647, Number(session.expires_at) * 1000 - Date.now() - 60000));
    refreshTimer = setTimeout(() => getSession().catch(() => {
      // Erros de rede não apagam a sessão. Retenta em um minuto.
      if (session?.refresh_token) refreshTimer = setTimeout(() => getSession().catch(() => scheduleRefresh()), 60000);
    }), delay);
  }
  function storeSession(value) {
    if (!value?.access_token || !value.refresh_token || !value.user?.id) throw new Error('Não foi possível entrar. Tente novamente.');
    session = { access_token: value.access_token, refresh_token: value.refresh_token,
      expires_at: Number(value.expires_at) || Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600),
      user: userProfile(value.user) };
    GM_setValue(SESSION_KEY, session); scheduleRefresh();
  }
  function forgetSession() {
    authEpoch++; session = null; sessionVerified = false;
    GM_setValue(SESSION_KEY, null); clearTimeout(refreshTimer);
  }
  async function getSession(force = false) {
    const epoch = authEpoch; const key = SESSION_KEY;
    const stored = GM_getValue(SESSION_KEY, null);
    if (stored?.user?.id !== session?.user?.id) sessionVerified = false;
    session = stored;
    if (!session?.refresh_token) throw new Error('Entre com seu email e senha para acessar o CRM.');
    if (!force && Number(session.expires_at) * 1000 > Date.now() + 60000) { scheduleRefresh(); return session; }
    if (!refreshWork) {
      const requestedToken = session.access_token;
      const renew = async () => {
        if (epoch !== authEpoch) throw new Error('O buffet ou a sessão mudou.');
        // A trava também serializa renovação entre abas do WhatsApp.
        const latest = GM_getValue(key, null);
        if (!latest?.refresh_token) throw new Error('Entre novamente para acessar o CRM.');
        if ((!force || latest.access_token !== requestedToken) && Number(latest.expires_at) * 1000 > Date.now() + 60000) {
          session = latest; scheduleRefresh(); return session;
        }
        try {
          const value = await apiRequest('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: latest.refresh_token });
          if (epoch !== authEpoch || GM_getValue(SESSION_KEY, null)?.refresh_token !== latest.refresh_token) throw new Error('A sessão mudou. Entre novamente.');
          storeSession(value); return session;
        } catch (error) {
          if (epoch === authEpoch && [400, 401, 403].includes(error.status)) forgetSession();
          throw error;
        }
      };
      const work = (navigator.locks ? navigator.locks.request(key, renew) : renew()).finally(() => { if (refreshWork === work) refreshWork = null; });
      refreshWork = work;
    }
    return refreshWork;
  }
  async function supabaseRequest(method, path, body) {
    const epoch = authEpoch;
    let active = await getSession();
    if (epoch !== authEpoch) throw new Error('O buffet ou a sessão mudou.');
    try {
      const value = await apiRequest(method, path, body, active.access_token);
      if (epoch !== authEpoch) throw new Error('A sessão mudou durante a operação.');
      return value;
    } catch (error) {
      if (epoch !== authEpoch) throw new Error('O buffet ou a sessão mudou.');
      if (error.code === '42501') sessionVerified = false;
      if (error.status !== 401) throw error;
      active = await getSession(true);
      if (epoch !== authEpoch) throw new Error('O buffet ou a sessão mudou.');
      const value = await apiRequest(method, path, body, active.access_token);
      if (epoch !== authEpoch) throw new Error('A sessão mudou durante a operação.');
      return value;
    }
  }
  function enqueueStorage(work) {
    const epoch = authEpoch;
    const next = storageQueue.then(() => {
      if (epoch !== authEpoch) throw new Error('A sessão mudou. A operação pendente foi cancelada.');
      return work();
    });
    storageQueue = next.catch(() => {}); return next;
  }
  function remember(record) { cache = clone(record); cacheTime = Date.now(); return clone(record); }
  function loadDatabase(force = false) {
    return enqueueStorage(async () => {
      await getSession();
      if (!force && cache && Date.now() - cacheTime < CACHE_TTL) return clone(cache);
      try {
        const record = await supabaseRequest('POST', '/rest/v1/rpc/crm_carregar', {});
        if (!isObject(record?.leads)) throw new Error('Não foi possível carregar os dados. Tente atualizar novamente.');
        return remember(record);
      } catch (error) { cacheTime = 0; throw error; }
    });
  }
  function saveLead(phone, patch, base = null) {
    return enqueueStorage(async () => {
      try {
        if (base && !Number.isSafeInteger(base.versao)) throw new Error('Atualize os dados do lead antes de salvar.');
        const saved = await supabaseRequest('POST', '/rest/v1/rpc/crm_salvar_lead', {
          p_telefone: phone, p_patch: patch, p_versao: base ? base.versao : null,
        });
        if (!isObject(saved) || saved.telefone !== phone || !Number.isSafeInteger(saved.versao)) throw new Error('Não foi possível confirmar o salvamento. Use Atualizar dados para conferir.');
        if (cache) { cache.leads[phone] = clone(saved); cacheTime = 0; }
        return clone(saved);
      } catch (error) { cacheTime = 0; throw error; }
    });
  }
  function newLead(name) {
    return { nome: name || '', etapa: 'NOVO_LEAD', observacao: '', prioridade: 'NORMAL', tarefas: [] };
  }
  function loadLogs(phone, before = null) {
    const cursor = before === null ? '' : '&id=lt.' + encodeURIComponent(before);
    const columns = 'id,transacao,tabela,operacao,autor_id,autor_email,autor_nome,origem,momento,antes,depois';
    return supabaseRequest('GET', '/rest/v1/logs?select=' + columns + '&lead_telefone=eq.' + encodeURIComponent(phone) + '&order=id.desc&limit=100' + cursor);
  }
  function restoreSession() {
    if (restoreWork && restoreEpoch === authEpoch) return restoreWork;
    if (!session?.refresh_token) return Promise.resolve(false);
    const epoch = authEpoch; restoreEpoch = epoch;
    const work = supabaseRequest('GET', '/auth/v1/user').then(user => {
      if (epoch !== authEpoch) throw new Error('Seu acesso mudou. Tente abrir o CRM novamente.');
      if (!user?.id || user.id !== session?.user?.id) {
        forgetSession(); throw new Error('Entre novamente para continuar.');
      }
      session.user = userProfile(user);
      GM_setValue(SESSION_KEY, session); sessionVerified = true;
      return true;
    }).catch(error => {
      if (epoch === authEpoch && [400, 401, 403].includes(error.status)) forgetSession();
      throw error;
    }).finally(() => { if (restoreWork === work) restoreWork = null; });
    restoreWork = work; return work;
  }

  // 3. Identificação: nunca lê números das mensagens, recados ou participantes.
  function currentIdentity() {
    const header = document.querySelector(SELECTORS.header);
    const titleNode = header?.querySelector(SELECTORS.title);
    const name = titleNode?.textContent.trim();
    if (!header || !titleNode || !name) return null;
    const avatar = header.querySelector(`${SELECTORS.profile} img`);
    const avatarPath = avatar?.getAttribute('src')?.split('?')[0] || '';
    const group = !!header.querySelector(SELECTORS.groupPicture);
    return { header, titleNode, name, signature: `${name}\n${avatarPath}\n${group}`, group };
  }
  function assertCurrent(context) {
    const identity = currentIdentity();
    if (context.signal.aborted || context.generation !== state.generation || !identity ||
        identity.signature !== context.signature || identity.titleNode !== context.titleNode) throw abortError();
  }
  function isGroup(drawer) {
    return !!(drawer?.querySelector(SELECTORS.groupHeader) || drawer?.closest(SELECTORS.groupRegion));
  }
  function identityLabel(value) { return String(value || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim(); }
  function headerPhone(context) {
    // Um título numérico sem prefixo internacional também pode ser um nome salvo.
    const title = identityLabel(context.name);
    return /^(?:\+|00)\d/.test(title) ? normalizePhone(title) : null;
  }
  function currentContactName(phone) {
    const identity = currentIdentity(); const current = state.current;
    if (!identity || current?.phone !== phone || current.signature !== identity.signature || current.titleNode !== identity.titleNode || identity.group || headerPhone(identity)) return null;
    return identityLabel(identity.name) || null;
  }
  function contactPhone(drawer, context) {
    if (isGroup(drawer)) return { group: true };
    if (!drawer?.querySelector(SELECTORS.contactHeader)) return null;
    const business = drawer.querySelector(SELECTORS.businessName);
    const nameNode = business || drawer.querySelector(SELECTORS.contactName);
    const name = identityLabel(nameNode?.textContent);
    if (!nameNode || !name) return null;
    const expectedPhone = headerPhone(context);
    const sameName = name === identityLabel(context.name);
    if (!sameName && !expectedPhone) return null;
    const bindPhone = phone => phone && (!expectedPhone || phone === expectedPhone) ? { phone, drawer } : null;
    const uniquePhones = nodes => [...new Set(nodes.map(node => normalizePhone(node.textContent)).filter(Boolean))];
    if (business) {
      // No cartão comercial, o telefone é um SPAN irmão do nome, sem data-testid.
      const nodes = [...(business.parentElement?.children || [])].filter(node => node !== business);
      const phones = uniquePhones(nodes);
      if (phones.length) return phones.length === 1 ? bindPhone(phones[0]) : null;
      // Alternativa restrita à linha do telefone, sem ler o recado ou a descrição.
      const section = drawer.querySelector(SELECTORS.phoneSection)?.parentElement;
      const rows = section ? [...section.children].filter(node => node.matches(SELECTORS.phoneRow)) : [];
      const fallback = uniquePhones(rows);
      return fallback.length === 1 ? bindPhone(fallback[0]) : null;
    }
    // Campos de telefone da ficha comum ficam ao lado do nome, antes do SECTION.
    for (let block = nameNode.parentElement; block && block !== drawer && block.tagName !== 'SECTION'; block = block.parentElement) {
      const nodes = [...block.querySelectorAll(SELECTORS.phoneText)].filter(node => !node.closest('[data-testid="notes-section"]'));
      const phones = uniquePhones(nodes);
      if (phones.length) return phones.length === 1 ? bindPhone(phones[0]) : null;
    }
    // Em contatos não salvos, o subtítulo é o telefone e o campo ao lado é ~Nome.
    return bindPhone(normalizePhone(name));
  }
  function waitForDOM(context, read, timeout, message) {
    return new Promise((resolve, reject) => {
      let observer; let timer; let settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        observer?.disconnect(); clearTimeout(timer);
        context.signal.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(abortError());
      const check = () => {
        try {
          assertCurrent(context);
          const result = read(); if (result) finish(null, result);
        } catch (error) { finish(error); }
      };
      observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'style'] });
      context.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(new Error(message)), timeout);
      check();
    });
  }
  function waitForContact(context, timeout = 6500) {
    return waitForDOM(context, () => {
      const drawer = document.querySelector(`${SELECTORS.right} ${SELECTORS.drawer}`);
      const result = contactPhone(drawer, context);
      return result ? { ...result, drawer } : null;
    }, timeout, 'Não encontrei o telefone nos dados deste contato. Confira o número manualmente ou tente novamente.');
  }
  function nativePanelHeader() {
    const right = document.querySelector(SELECTORS.right);
    return [...(right?.querySelectorAll('header') || [])].find(header => !header.closest('[hidden], [aria-hidden="true"]') && header.getClientRects().length > 0) || null;
  }
  function nativeSearchOpen() { return identityLabel(nativePanelHeader()?.querySelector('[data-testid="drawer-title-body"]')?.textContent) === 'Pesquisar mensagens'; }
  async function closeNativePanel(context) {
    assertCurrent(context);
    const header = nativePanelHeader(); if (!header) return;
    const close = header.querySelector('button[aria-label="Fechar"]');
    if (!close) throw new Error('Não encontrei o botão de fechar o painel do WhatsApp. Feche esse painel para abrir espaço para a ficha.');
    close.click();
    await waitForDOM(context, () => !nativePanelHeader(), 2500, 'O painel do WhatsApp ainda está aberto. Feche-o para ampliar a ficha do CRM.');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    assertCurrent(context); scheduleLayout();
  }
  function dismissNativeForConversation(current) {
    if (!nativePanelHeader() || state.nativeClose) return;
    const context = { ...current, generation: state.generation, signal: state.controller?.signal || new AbortController().signal };
    const pending = closeNativePanel(context).catch(error => { if (error.name !== 'AbortError') notify(errorMessage(error)); }).finally(() => { if (state.nativeClose === pending) state.nativeClose = null; });
    state.nativeClose = pending;
  }
  async function obtainPhone(context) {
    assertCurrent(context);
    if (context.group) return { group: true };
    const existing = document.querySelector(`${SELECTORS.right} ${SELECTORS.drawer}`);
    let captured = false;
    let userInteracted = false;
    const markInteraction = event => {
      if (event.isTrusted && event.target instanceof Element && event.target.closest(SELECTORS.right)) userInteracted = true;
    };
    document.addEventListener('pointerdown', markInteraction, true);
    document.addEventListener('keydown', markInteraction, true);
    try {
      if (existing) {
        const found = contactPhone(existing, context);
        if (found) { captured = true; return found; }
      }
      // O título +DDI é suficiente para contatos não salvos; não abre informações.
      const phone = headerPhone(context);
      if (phone) { captured = true; return { phone }; }
      // A foto abre dados do contato mesmo quando a pesquisa ocupa o painel direito.
      const profile = context.header.querySelector(SELECTORS.profile);
      const info = context.header.querySelector(SELECTORS.info);
      const trigger = profile || info;
      if (!trigger) throw new Error('Não encontrei o botão de dados deste contato no cabeçalho do WhatsApp.');
      trigger.click();
      let found;
      try { found = await waitForContact(context, profile && info ? 3500 : 6500); }
      catch (error) {
        if (error.name === 'AbortError' || !profile || !info || profile === info || userInteracted) throw error;
        assertCurrent(context); info.click(); found = await waitForContact(context);
      }
      captured = true; return found;
    } finally {
      document.removeEventListener('pointerdown', markInteraction, true);
      document.removeEventListener('keydown', markInteraction, true);
      // O usuário autorizou fechar inclusive dados que já estavam abertos.
      // Se ele voltou a usar o painel durante a captura, não fecha essa nova interação.
      if (captured && !context.signal.aborted && context.generation === state.generation && !userInteracted) {
        try { await closeNativePanel(context); }
        catch (error) { if (error.name === 'AbortError') throw error; notify(errorMessage(error)); }
      }
    }
  }
  function startIdentification(identity) {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const context = { ...identity, generation: ++state.generation, signal: controller.signal };
    state.current = { ...identity, status: 'loading', phone: null, lead: null, error: '' };
    updateTrigger();
    if (state.panelMode === 'conversation') showConversation();
    const job = state.captureQueue.catch(() => {}).then(async () => {
      try {
        assertCurrent(context);
        const result = await obtainPhone(context);
        assertCurrent(context);
        if (result.group) state.current.status = 'group';
        else {
          state.current.phone = result.phone;
          const db = await loadDatabase();
          assertCurrent(context);
          state.current.lead = db.leads[result.phone] || null;
          state.current.status = 'ready';
        }
      } catch (error) {
        if (error.name === 'AbortError' || context.generation !== state.generation) return;
        state.current.status = 'error'; state.current.error = errorMessage(error);
      }
      if (context.generation === state.generation) {
        // Mantém o painel no mesmo tamanho até terminar a animação do WhatsApp.
        state.layoutHoldUntil = Date.now() + 350;
        clearTimeout(state.layoutResumeTimer);
        state.layoutResumeTimer = setTimeout(scheduleLayout, 350);
        updateTrigger();
        if (state.panelMode === 'conversation') showConversation();
      }
    });
    state.captureQueue = job;
  }

  // 4. Área de trabalho: hub integrado à navegação e ficha acoplada à conversa.
  const STAGE_COLORS = {
    NOVO_LEAD: 'slate', ORCAMENTO_ENVIADO: 'blue',
    EM_NEGOCIACAO: 'violet', FECHAMENTO: 'amber', FECHADO: 'green', PERDIDO: 'red',
  };
  const TASK_TYPES = { RETORNO: 'Retorno', RESGATE: 'Resgate', VISITA: 'Visita/Degustação', CONTRATO: 'Contrato', PAGAMENTO: 'Pagamento' };
  const TERMINAL = new Set(['FECHADO', 'PERDIDO']);
  const prefs = { retornoDias: 2, view: GM_getValue('buffet-crm-view-v3', 'kanban') };
  if (!['kanban', 'agenda', 'lista'].includes(prefs.view)) prefs.view = 'kanban';
  const hub = { db: null, view: prefs.view, search: '', filter: '', stage: '', priority: '', sort: 'acao', busy: new Set() };
  Object.assign(state, { record: null, tab: 'lead', layoutFrame: null, dockMain: null, layoutObserver: null, observedScreen: null });

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    return appendChildren(node, ...children);
  }
  function appendChildren(node, ...children) {
    for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }
  function button(text, onclick, className = '') { return el('button', { type: 'button', text, onclick, className }); }
  const ICONS = {
    crm: ['M3 4h18v16H3z', 'M9 4v16M15 4v16M5.5 8h1M11.5 8h1M11.5 12h1M17.5 8h1M17.5 12h1M17.5 16h1'],
    close: ['m6 6 12 12M18 6 6 18'], arrow: ['m9 5 7 7-7 7'], back: ['m14 6-6 6 6 6'],
    plus: ['M12 5v14M5 12h14'], calendar: ['M5 5h14v15H5zM8 3v4M16 3v4M5 10h14M9 14h2M14 14h1'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2'], check: ['m5 12 4 4 10-10'],
    star: ['m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z'],
    people: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5'],
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2'],
    chat: ['M4 4h16v12H9l-5 4zM8 8h8M8 12h5'], phone: ['M6 3 3 6c0 7 8 15 15 15l3-3-5-4-3 2-5-5 2-3z'],
    search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6'], refresh: ['M20 7V3l-4 4M4 17v4l4-4M19 7a8 8 0 0 0-14-2M5 17a8 8 0 0 0 14 2'],
    list: ['M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1'], alert: ['m12 3 10 18H2zM12 9v5M12 17h.01'],
    settings: ['M4 7h16M4 17h16M8 4v6M16 14v6'],
    save: ['M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8'],
    trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
    spinner: ['M12 3a9 9 0 1 1-9 9'],
    cake: ['M4 12h16v9H4zM4 16c2 2 4-2 6 0s4-2 6 0 2 1 4 0M8 8v4M12 8v4M16 8v4M8 4v1M12 4v1M16 4v1'],
    history: ['M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 2'], note: ['M5 3h14v18H5zM8 7h8M8 11h8M8 15h5'],
  };
  function icon(name, size = 20) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    for (const d of ICONS[name] || ICONS.crm) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  }
  function iconButton(name, label, onclick, className = '') {
    const node = button('', onclick, `icon-button ${className}`); node.setAttribute('aria-label', label); node.title = label; node.append(icon(name)); return node;
  }
  function action(name, text, onclick, className = '') { const node = button('', onclick, className); node.append(icon(name, 17), text); return node; }
  function selectControl(name, options, value = '') {
    const node = el('select', { name, 'aria-label': name });
    for (const [key, text] of Object.entries(options)) node.append(el('option', { value: key, text }));
    if (value && !Object.hasOwn(options, value)) node.append(el('option', { value, text: value }));
    node.value = value; return node;
  }
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function openLead(lead) { return !TERMINAL.has(lead.etapa); }
  function color(stage) { return STAGE_COLORS[stage] || 'slate'; }
  function stageBadge(stage) { return el('span', { className: `badge ${color(stage)}`, text: STAGES[stage] || stage || 'Novo lead' }); }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('pt-BR'); }
  function taskTitle(task) { return TASK_TYPES[task.tipo] || 'Ação'; }
  // Traduz fatos persistidos em acontecimentos do atendimento, sem sugerir
  // envio de mensagens ou contato com o cliente que o CRM não comprovou.
  function historyEvents(log) {
    const before = isObject(log.antes) ? log.antes : {};
    const after = isObject(log.depois) ? log.depois : {};
    const snapshot = log.operacao === 'DELETE' ? before : after;
    const changed = key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
    const events = [];
    const add = (title, detail, glyph = 'history', tone = '', rank = 50, comparison = null) =>
      events.push({ title, detail, glyph, tone, rank, comparison });
    const value = text => text === null || text === undefined || text === '' ? 'Não informado' : String(text);
    const schedule = task => `${dateLabel(task.data)}${task.hora ? ` às ${String(task.hora).slice(0, 5)}` : ' · sem horário'}`;
    const note = (title, oldText, newText, rank = 30, context = '') => {
      const text = String(newText || '').trim();
      const preview = text ? (text.length > 160 ? `${text.slice(0, 160)}…` : text) : 'Texto removido.';
      add(title, context ? `${context}\n${preview}` : preview, 'note', '', rank, { before: String(oldText || ''), after: String(newText || '') });
    };
    if (log.tabela === 'leads') {
      if (log.operacao === 'INSERT') {
        add('Lead cadastrado', snapshot.nome && normalizePhone(snapshot.nome) !== snapshot.telefone ? snapshot.nome : '', 'user', '', 100);
        if (snapshot.etapa && snapshot.etapa !== 'NOVO_LEAD') add('Etapa inicial', STAGES[snapshot.etapa] || snapshot.etapa, 'crm', '', 80);
        if (snapshot.prioridade && snapshot.prioridade !== 'NORMAL') add('Prioridade definida', { GATILHO: 'GATILHO', BAIXA: 'Baixa' }[snapshot.prioridade] || snapshot.prioridade, 'star', 'warning', 75);
        if (snapshot.observacao) note('Notas internas adicionadas', '', snapshot.observacao);
      } else if (log.operacao === 'DELETE') {
        add('Lead excluído', snapshot.nome || '', 'trash', 'danger', 100);
      } else {
        if (changed('etapa')) {
          const title = after.etapa === 'FECHADO' ? 'Lead fechado' : after.etapa === 'PERDIDO' ? 'Lead marcado como perdido' :
            TERMINAL.has(before.etapa) && !TERMINAL.has(after.etapa) ? 'Lead reaberto' : 'Etapa alterada';
          add(title, `${STAGES[before.etapa] || value(before.etapa)} → ${STAGES[after.etapa] || value(after.etapa)}`,
            after.etapa === 'FECHADO' ? 'check' : 'crm', after.etapa === 'FECHADO' ? 'success' : after.etapa === 'PERDIDO' ? 'danger' : '', 95);
        }
        if (changed('prioridade')) {
          const labels = { NORMAL: 'Normal', GATILHO: 'GATILHO', BAIXA: 'Baixa' };
          add(after.prioridade === 'GATILHO' ? 'Prioridade marcada como GATILHO' : 'Prioridade alterada',
            `${labels[before.prioridade] || value(before.prioridade)} → ${labels[after.prioridade] || value(after.prioridade)}`, 'star', after.prioridade === 'GATILHO' ? 'warning' : '', 80);
        }
        if (changed('nome')) add('Responsável atualizado', `${before.nome ? contactLabel(before.nome, before.telefone) : 'Não informado'} → ${after.nome ? contactLabel(after.nome, after.telefone) : 'Não informado'}`, 'user', '', 40);
        if (changed('telefone')) add('Telefone atualizado', `${formatPhone(before.telefone)} → ${formatPhone(after.telefone)}`, 'phone', '', 40);
        if (changed('observacao')) note(after.observacao ? (before.observacao ? 'Notas internas atualizadas' : 'Notas internas adicionadas') : 'Notas internas removidas', before.observacao, after.observacao);
      }
    } else if (log.tabela === 'acoes') {
      const title = taskTitle(snapshot);
      const feminine = snapshot.tipo === 'VISITA' || title === 'Ação';
      if (log.operacao === 'INSERT') {
        const status = (feminine ? { CONCLUIDA: 'registrada como concluída', CANCELADA: 'registrada como cancelada' } :
          { CONCLUIDA: 'registrado como concluído', CANCELADA: 'registrado como cancelado' })[snapshot.status] || (feminine ? 'agendada' : 'agendado');
        add(`${title} ${status}`, schedule(snapshot), 'calendar', '', 70);
        if (snapshot.observacao) note(`${title}: observação`, '', snapshot.observacao, 20, schedule(snapshot));
      } else if (log.operacao === 'DELETE') {
        add(`${title} ${feminine ? 'excluída' : 'excluído'}`, schedule(snapshot), 'trash', 'danger', 85);
      } else {
        if (changed('status')) {
          const status = (feminine ? { CONCLUIDA: 'concluída', CANCELADA: 'cancelada', PENDENTE: 'reaberta' } :
            { CONCLUIDA: 'concluído', CANCELADA: 'cancelado', PENDENTE: 'reaberto' })[after.status] || (feminine ? 'atualizada' : 'atualizado');
          add(`${title} ${status}`, schedule(snapshot), after.status === 'CONCLUIDA' ? 'check' : after.status === 'CANCELADA' ? 'close' : 'back',
            after.status === 'CONCLUIDA' ? 'success' : after.status === 'CANCELADA' ? 'danger' : '', 90);
        }
        if (changed('data') || changed('hora')) add(`${title} ${feminine ? 'reagendada' : 'reagendado'}`, `${schedule(before)} → ${schedule(after)}`, 'calendar', 'warning', 85);
        if (changed('tipo')) add('Tipo da ação alterado', `${taskTitle(before)} → ${taskTitle(after)}`, 'calendar', '', 55);
        if (changed('observacao')) note(`${title}: observação ${after.observacao ? 'atualizada' : 'removida'}`, before.observacao, after.observacao, 25, schedule(snapshot));
      }
    }
    return events;
  }
  function dueContact(lead) { return pendingTasks(lead).some(task => ['late', 'today'].includes(followStatus(task))); }
  function highlightText(value, phone = false) {
    const text = String(value ?? ''); const term = hub.search.trim().toLocaleLowerCase('pt-BR');
    const fragment = document.createDocumentFragment(); const matches = [];
    if (phone && /^[+\d\s().-]+$/.test(term) && /\d/.test(term)) {
      // Mapeia dígitos para a posição visual, preservando espaços, DDD e hífen.
      const positions = []; let digits = '';
      for (let index = 0; index < text.length; index++) if (/\d/.test(text[index])) { digits += text[index]; positions.push(index); }
      const needle = term.replace(/\D/g, '');
      for (let index = digits.indexOf(needle); index !== -1; index = digits.indexOf(needle, index + needle.length)) {
        matches.push([positions[index], positions[index + needle.length - 1] + 1]);
      }
    } else if (term) {
      const lowered = text.toLocaleLowerCase('pt-BR');
      for (let index = lowered.indexOf(term); index !== -1; index = lowered.indexOf(term, index + term.length)) matches.push([index, index + term.length]);
    }
    let start = 0;
    for (const [from, to] of matches) { fragment.append(document.createTextNode(text.slice(start, from)), el('u', { className: 'search-match', text: text.slice(from, to) })); start = to; }
    fragment.append(document.createTextNode(text.slice(start))); return fragment;
  }
  function tasksOf(lead) {
    return Array.isArray(lead.tarefas) ? lead.tarefas.filter(isObject).map(clone) : [];
  }
  function pendingTasks(lead) { return tasksOf(lead).filter(task => task.status === 'PENDENTE').sort((a, b) => `${a.data || '9999'}${a.hora || '23:59'}`.localeCompare(`${b.data || '9999'}${b.hora || '23:59'}`)); }
  function nextTask(lead) { return pendingTasks(lead)[0] || null; }
  function dateAfter(days, business = false, from = new Date()) {
    const date = new Date(from); date.setHours(12, 0, 0, 0);
    for (let count = 0; count < days;) { date.setDate(date.getDate() + 1); if (!business || (date.getDay() !== 0 && date.getDay() !== 6)) count++; }
    return localDate(date);
  }
  function taskTone(task) { const status = followStatus(task); return status === 'late' ? 'red' : status === 'today' ? 'amber' : 'slate'; }
  function taskStatusLabel(task) { return { late: 'Vencido', today: 'Hoje', future: 'Agendado', none: 'Sem data' }[followStatus(task)]; }

  const host = el('div', { id: HOST_ID });
  const shadow = host.attachShadow({ mode: 'open' });
  const css = `
    :host { all: initial; --ink: #233633; --muted: #7a8884; --line: #e4eae6; --paper: #fff; --bg: #f5f7f4; --green: #22765d; --accent: #eef5ef; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: var(--ink); }
    * { box-sizing: border-box; } [hidden] { display: none !important; } button, input, select, textarea { font: inherit; } svg { flex-shrink: 0; vertical-align: middle; }
    button { display: inline-flex; gap: 7px; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; color: var(--ink); background: var(--paper); cursor: pointer; transition: background .15s, border-color .15s; }
    button:hover { background: #eef2ef; border-color: #cbd8cf; } button:disabled { opacity: .45; cursor: wait; } .primary { background: var(--green); border-color: var(--green); color: #fff; } .primary:hover { background: #175e48; border-color: #175e48; }
    .ghost { background: transparent; border-color: transparent; } .small { padding: 5px 8px; font-size: 11px; } .icon-button { width: 34px; height: 34px; padding: 6px; flex-shrink: 0; }
    button:focus-visible, a:focus-visible, input:focus, select:focus, textarea:focus, summary:focus-visible { outline: 2px solid #399276; outline-offset: 2px; }
    input, select, textarea { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--paper); } input[readonly] { background: var(--bg); color: #74827c; } textarea { resize: vertical; min-height: 95px; }
    label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: #60726b; } fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
    h1, h2, h3, p { margin: 0; } h1 { font-size: 23px; font-weight: 650; letter-spacing: -.6px; } h2 { font-size: 19px; letter-spacing: -.3px; line-height: 1.3; overflow-wrap: anywhere; } h3 { font-size: 13px; font-weight: 650; }
    a { color: var(--green); text-decoration: none; } small { font-size: 11px; } .muted { color: var(--muted); } .eyebrow { font-size: 10px; letter-spacing: 1.4px; font-weight: 700; text-transform: uppercase; color: var(--muted); } .row { display: flex; align-items: center; gap: 9px; } .between { justify-content: space-between; } .wrap { flex-wrap: wrap; } .grow { flex: 1; min-width: 0; } .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workspace { position: fixed; z-index: 210; display: flex; flex-direction: column; background: var(--bg); pointer-events: auto; overflow: hidden; border-left: 1px solid var(--line); }
    .hub-head { padding: 8px 16px; flex-shrink: 0; background: var(--paper); border-bottom: 1px solid var(--line); } .hub-head h1 { font-size: 18px; line-height: 1.25; } .hub-head .eyebrow { font-size: 9px; letter-spacing: 1px; } .brand { width: 32px; height: 32px; border-radius: 9px; background: #e9f3e9; color: var(--green); display: grid; place-items: center; }
    .metrics { display: grid; flex-shrink: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 8px 16px; }
    .metric { display: flex; flex-direction: row; align-items: center; justify-content: space-between; text-align: left; padding: 8px 12px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; gap: 10px; min-width: 0; } .metric .eyebrow { color: var(--ink); font-size: 13px; font-weight: 600; letter-spacing: 0; text-transform: none; } .metric strong { font-size: 25px; line-height: 1; letter-spacing: -.6px; flex-shrink: 0; } .metric.active { border-color: var(--green); box-shadow: inset 0 0 0 1px var(--green); }
    .hub-content { flex: 1; min-height: 0; display: flex; } .hub-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .hub-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding: 0 16px 8px; flex-shrink: 0; }
    .toolbar { display: flex; flex: 1 1 380px; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; } .segments { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--line); border-radius: 8px; background: #eaf0eb; } .segments button { border: 0; background: transparent; font-size: 12px; padding: 5px 8px; color: #7b8b82; } .segments button.active { background: #fff; color: #244c39; box-shadow: 0 1px 4px #18322412; }
    .search { position: relative; flex: 1; min-width: 140px; max-width: 220px; } .search svg { position: absolute; left: 9px; top: 8px; color: #95a299; } .search input { padding: 7px 9px 7px 31px; font-size: 12px; }
    .filter-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; } .filter-bar label { flex-direction: row; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; } .filter-bar select { width: auto; max-width: 175px; padding: 7px 8px; font-size: 12px; }
    .view-content { flex: 1 1 0; min-height: 0; overflow: auto; padding: 0 16px 8px; overscroll-behavior: contain; } .board { display: flex; align-items: stretch; gap: 12px; height: 100%; min-height: 0; }
    .column { display: flex; flex-direction: column; width: 252px; min-width: 252px; background: #edf1eb; border: 1px solid #e5eae2; border-radius: 12px; overflow: hidden; } .column.drag-over { border-color: var(--green); background: #e3efdf; }
    .column-head { padding: 10px 12px; flex-shrink: 0; border-top: 3px solid var(--tone, #9ba5a3); } .column-head h3 { font-size: 13px; } .column-head .count { border-radius: 5px; background: #fff9; padding: 2px 6px; font-size: 11px; }
    .column-body { padding: 4px 9px 10px; overflow: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 9px; overscroll-behavior: contain; }
    .lead-card { flex-shrink: 0; border: 1px solid #e0e7de; background: var(--paper); border-radius: 10px; padding: 13px; cursor: pointer; box-shadow: 0 2px 4px #27402e04; outline-offset: 2px; } .lead-card:hover { border-color: #b9cabc; box-shadow: 0 3px 10px #27402e0b; } .lead-card[aria-busy="true"] { opacity: .55; pointer-events: none; }
    .lead-card.priority-high { background: #fff8df; border-color: #e1bd5e; } .lead-card.priority-high:hover { background: #fff4ce; border-color: #c79d37; } .priority-star { color: #ac7b14; } .priority-star svg { fill: #f5ce60; }
    .avatar { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 10px; color: #65795e; background: #eff3e9; font-size: 11px; font-weight: 700; } .card-name { font-size: 13px; font-weight: 650; }
    .search-match { text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: var(--green); } .card-notes { display: flex; align-items: flex-start; gap: 7px; border-top: 1px solid #dce3d9; padding-top: 9px; margin-top: 10px; color: #5e7066; } .card-notes svg { margin-top: 2px; } .card-notes p { font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
    .badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 5px; padding: 3px 7px; font-size: 10px; font-weight: 600; white-space: nowrap; } .badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .slate { --tone: #9ba7a3; color: #687b75; background: #edf1ef; } .blue { --tone: #719eb5; color: #39718b; background: #eaf3f8; } .violet { --tone: #a190c0; color: #786397; background: #f0eaf8; } .amber { --tone: #cfb05c; color: #9d782b; background: #faf2db; } .orange { --tone: #c4966f; color: #a17747; background: #f9eee2; } .green { --tone: #70a882; color: #367850; background: #e8f3e9; } .red { --tone: #c68d88; color: #a65750; background: #f9eae7; }
    .column.slate, .column.blue, .column.violet, .column.amber, .column.orange, .column.green, .column.red { background: #edf1eb; color: var(--ink); }
    .task-preview { margin-top: 11px; padding: 9px; border-radius: 7px; font-size: 11px; } .task-preview .row { gap: 5px; } .task-preview strong { font-size: 12px; font-weight: 600; } .task-preview p { margin-top: 4px; color: inherit; overflow-wrap: anywhere; }
    .empty { text-align: center; color: var(--muted); padding: 40px 22px; border: 1px dashed #d4ddd1; border-radius: 12px; } .empty > svg { margin-bottom: 12px; color: #9cafa0; } .empty h3 { color: #597062; margin-bottom: 6px; } .empty p { max-width: 360px; margin: auto; font-size: 12px; } .empty-actions { display: flex; justify-content: center; margin-top: 18px; }
    .hub-inspector { flex: 0 0 410px; width: 410px; border-left: 1px solid var(--line); background: var(--paper); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .drawer { position: fixed; z-index: 205; background: var(--paper); border-left: 1px solid var(--line); pointer-events: auto; display: flex; flex-direction: column; overflow: hidden; box-shadow: -5px 0 16px #23413206; }
    .drawer.full-record { border-left: 0; box-shadow: none; } .drawer.full-record .record-scroll { padding: 20px 24px; } .drawer.full-record .record-head, .drawer.full-record .record-footer { padding-left: 24px; padding-right: 24px; }
    .record-head { padding: 16px 18px; border-bottom: 1px solid var(--line); background: #fcfdfb; flex-shrink: 0; } .record-head .avatar { width: 40px; height: 40px; border-radius: 12px; font-size: 13px; } .record-head .phone-line { font-size: 11px; margin-top: 4px; color: var(--muted); }
    .record-name-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; } .record-name-row h2 { font-size: 17px; min-width: 0; } .record-name-row .badge { flex-shrink: 0; }
    .record-body { display: flex; flex-direction: column; flex: 1; min-height: 0; } .record-form { display: flex; flex-direction: column; flex: 1; min-height: 0; } .record-form > fieldset { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .record-tabs { display: flex; padding: 0 12px; border-bottom: 1px solid var(--line); flex-shrink: 0; } .record-tabs button { flex: 1; border: 0; border-radius: 0; font-size: 11px; padding: 12px 5px; color: #8a978c; border-bottom: 2px solid transparent; } .record-tabs button.active { color: var(--green); border-bottom-color: var(--green); font-weight: 600; }
    .record-scroll { flex: 1; overflow: auto; min-height: 0; padding: 17px 18px; overscroll-behavior: contain; } .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .full { grid-column: 1 / -1; } .section { margin-bottom: 20px; } .section > h3 { margin-bottom: 12px; }
    .record-footer { padding: 11px 18px; border-top: 1px solid var(--line); background: var(--paper); flex-shrink: 0; } .record-footer .status { font-size: 10px; padding: 0 0 8px; background: transparent; margin: 0; } .record-footer .primary { flex: 1; }
    .status { padding: 11px 13px; margin: 12px 0; border-radius: 8px; background: var(--accent); color: #5d7969; font-size: 12px; overflow-wrap: anywhere; } .status.error { color: #ae5d50; background: #faeeea; }
    .completed-actions { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 24px; } .completed-actions > h3 { margin-bottom: 12px; }
    .presets { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; } .presets button { font-size: 10px; padding: 5px 8px; } .composer { padding: 13px; border: 1px solid var(--line); border-radius: 10px; background: #f8faf6; margin-top: 15px; }
    .task-note { font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0; text-align: left; } .composer textarea { min-height: 65px; }
    .task-item { padding: 12px; border: 1px solid var(--line); border-radius: 9px; margin-bottom: 9px; border-left: 3px solid var(--tone, #aab8a4); background: var(--paper); color: var(--ink); } .task-item .task-title { font-size: 12px; font-weight: 600; margin: 7px 0 4px; overflow-wrap: anywhere; }
    .task-item .actions { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 9px; }
    .history-day { font-size: 11px; font-weight: 650; color: var(--muted); padding: 7px 0 12px; }
    .timeline-item { position: relative; border-left: 1px solid var(--line); padding: 0 0 18px 19px; margin-left: 6px; }
    .timeline-item::before { position: absolute; content: ''; width: 9px; height: 9px; background: var(--paper); border: 2px solid var(--green); border-radius: 50%; left: -5px; top: 2px; box-sizing: border-box; }
    .history-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 7px; font-size: 10px; color: var(--muted); padding-bottom: 8px; }
    .history-author { overflow-wrap: anywhere; }
    .history-event + .history-event { margin-top: 13px; }
    .history-event-head { display: flex; align-items: flex-start; gap: 7px; }
    .history-event-head svg { flex: 0 0 auto; margin-top: 1px; color: var(--muted); }
    .history-event-head strong { font-size: 12px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
    .history-event.success .history-event-head svg { color: #3e7954; }
    .history-event.warning .history-event-head svg { color: #a47923; }
    .history-event.danger .history-event-head svg { color: #b45b50; }
    .history-event p { margin: 4px 0 0 24px; font-size: 11px; line-height: 1.6; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .history-details { margin: 6px 0 0 24px; font-size: 11px; }
    .history-details summary { cursor: pointer; width: fit-content; color: var(--green); padding: 3px 0; }
    .history-details .history-value { margin: 7px 0 0; padding: 8px 10px; border-left: 2px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; line-height: 1.6; }
    .history-value span { display: block; font-size: 10px; font-weight: 600; color: var(--muted); margin-bottom: 3px; }
    .agenda-group { margin-bottom: 20px; } .agenda-title { margin: 8px 0 10px; font-size: 12px; color: #72836f; } .agenda-item { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 9px; background: var(--paper); margin-bottom: 7px; } .agenda-item .task-title { font-size: 12px; font-weight: 600; } .agenda-date { min-width: 85px; font-size: 11px; } .agenda-item .grow { cursor: pointer; } .agenda-item .small { white-space: nowrap; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; } th { position: sticky; top: 0; background: #f8faf6; text-align: left; padding: 12px 14px; color: #899782; font-size: 10px; font-weight: 600; z-index: 1; border-bottom: 1px solid var(--line); } td { padding: 13px 14px; border-bottom: 1px solid #edf1e9; vertical-align: middle; } tr:last-child td { border-bottom: 0; } tbody tr { cursor: pointer; } tbody tr:hover { background: #fafcf8; } .table-wrap { min-width: 760px; } td small { display: block; color: var(--muted); margin-top: 4px; font-size: 10px; }
    .modal-backdrop { position: fixed; z-index: 225; inset: 0; background: #1e342445; display: grid; place-items: center; pointer-events: auto; padding: 20px; } .modal { width: min(420px, 100%); border-radius: 14px; padding: 24px; background: var(--paper); box-shadow: 0 20px 80px #15271d33; } .modal h2 { margin-bottom: 7px; } .modal .fields { margin-top: 18px; }
    .toast { position: fixed; z-index: 230; bottom: 20px; right: 20px; max-width: 420px; color: #fff; background: #2d4436; padding: 12px 16px; border-radius: 9px; box-shadow: 0 4px 20px #152d1930; pointer-events: auto; font-size: 12px; }
    .spinner { animation: crm-spin .85s linear infinite; } @keyframes crm-spin { to { transform: rotate(360deg); } }
    .hub-loading { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); } .hub-loading .spinner { color: var(--green); }
    .leave-icon { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 14px; border-radius: 12px; background: var(--accent); color: var(--green); }
    .leave-actions { display: grid; gap: 9px; margin-top: 22px; } .leave-actions button { justify-content: flex-start; padding: 11px 14px; } .discard-exit { color: #a65750; }
    @media(max-width: 1150px) { .hub-inspector { flex-basis: 370px; width: 370px; } }
    @media(max-width: 900px) { .workspace.has-record .hub-main { display: none; } .workspace.has-record .hub-inspector { flex: 1; width: 100%; border: 0; } .metric { padding: 7px 9px; gap: 6px; } .metric .eyebrow { font-size: 12px; } .metric strong { font-size: 23px; } .hub-head .row.wrap { align-items: center; } .agenda-item { flex-wrap: wrap; } }
    @media(prefers-reduced-motion: reduce) { * { transition: none !important; } .spinner { animation-duration: 2s; } }
  `;
  shadow.append(el('style', { text: css }));
  const workspace = el('section', { className: 'workspace', hidden: '', 'aria-label': 'CRM do buffet' });
  const hubHead = el('div', { className: 'hub-head' });
  const hubMain = el('div', { className: 'hub-main' });
  const hubInspector = el('aside', { className: 'hub-inspector', hidden: '', 'aria-label': 'Ficha do lead' });
  workspace.append(hubHead, el('div', { className: 'hub-content' }, hubMain, hubInspector));
  const drawer = el('aside', { className: 'drawer', hidden: '', 'aria-label': 'CRM da conversa' });
  const toast = el('div', { className: 'toast', role: 'status', hidden: '' });
  shadow.append(workspace, drawer, toast); document.body.append(host);
  GM_addStyle(`
    #buffet-crm-nav-wrap { display: flex; align-items: center; justify-content: center; padding: 4px 0; flex: 0 0 auto; }
    #buffet-crm-nav, #buffet-crm-trigger { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 8px; flex: 0 0 auto; border: 0; border-radius: 50%; color: var(--WDS-content-icon-default, #687c72); background: transparent; cursor: pointer; position: relative; }
    #buffet-crm-trigger { margin-inline: 6px; width: 36px; height: 36px; padding: 7px; }
    #buffet-crm-nav:hover, #buffet-crm-trigger:hover, #buffet-crm-nav[aria-pressed="true"], #buffet-crm-trigger[aria-pressed="true"] { background: var(--WDS-background-elevated-hover, #e2ebe1); color: #357959; }
    #buffet-crm-nav:focus-visible, #buffet-crm-trigger:focus-visible { outline: 2px solid #438667; outline-offset: 2px; }
    #buffet-crm-trigger[data-status="error"]::after { content: ''; width: 6px; height: 6px; position: absolute; right: 4px; top: 4px; background: #b06a5c; border-radius: 50%; }
    #main[data-buffet-crm-dock] { box-sizing: border-box !important; padding-inline-end: var(--buffet-crm-dock-width) !important; }
  `);
  let toastTimer;
  function notify(message) { toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5500); }
  function statusBox(text, kind = '') { return el('div', { className: `status ${kind}`, text, role: 'status', 'aria-live': 'polite' }); }
  function showLoading(node, text) { const glyph = icon('spinner', 17); glyph.classList.add('spinner'); node.replaceChildren(glyph, el('span', { text })); }
  function loadingBox(text) { const node = statusBox(''); node.classList.add('row'); showLoading(node, text); return node; }
  function hubLoading() { const glyph = icon('spinner', 30); glyph.classList.add('spinner'); return el('div', { className: 'hub-loading', role: 'status', 'aria-live': 'polite' }, glyph, el('span', { text: 'Carregando' })); }
  function emptyState(title, description, name = 'crm') { return el('div', { className: 'empty' }, icon(name, 28), el('h3', { text: title }), el('p', { text: description })); }
  function clearDeadline() { clearTimeout(state.deadlineTimer); state.deadlineTimer = null; state.refreshDeadline = null; }
  function scheduleDeadline(callback, leads = []) {
    clearDeadline(); state.refreshDeadline = callback;
    const now = Date.now(); const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const due = leads.flatMap(pendingTasks).filter(task => task.data && task.hora).map(task => new Date(`${task.data}T${task.hora}:00`).getTime()).filter(time => time > now);
    state.deadlineTimer = setTimeout(callback, Math.max(1000, Math.min(midnight.getTime(), ...due) - now + 1000));
  }
  function releaseDock() {
    state.dockMain?.removeAttribute('data-buffet-crm-dock'); state.dockMain?.style.removeProperty('--buffet-crm-dock-width'); state.dockMain = null;
  }
  function layout() {
    state.layoutFrame = null;
    const screen = document.querySelector(SELECTORS.screen) || document.getElementById('app');
    const bounds = screen?.getBoundingClientRect();
    const nav = document.querySelector(SELECTORS.navbar);
    const navBounds = nav?.closest('header')?.getBoundingClientRect();
    const left = navBounds && navBounds.width < 150 ? navBounds.right : nav?.getBoundingClientRect().right || bounds?.left || 0;
    const top = Math.max(0, bounds?.top || 0); const right = Math.min(innerWidth, bounds?.right || innerWidth); const bottom = Math.min(innerHeight, bounds?.bottom || innerHeight);
    Object.assign(workspace.style, { left: `${Math.max(bounds?.left || 0, left)}px`, top: `${top}px`, width: `${Math.max(0, right - Math.max(bounds?.left || 0, left))}px`, height: `${Math.max(0, bottom - top)}px` });
    if (screen && screen !== state.observedScreen) { state.layoutObserver?.disconnect(); state.observedScreen = screen; state.layoutObserver = new ResizeObserver(scheduleLayout); state.layoutObserver.observe(screen); if (nav) state.layoutObserver.observe(nav); const main = document.getElementById('main'); if (main) state.layoutObserver.observe(main); }
    if (state.panelMode === 'conversation') {
      const main = document.getElementById('main'); const measured = main?.getBoundingClientRect();
      let rect = measured?.width > 0 && measured.height > 0 ? measured : null;
      workspace.hidden = true; hubInspector.hidden = true; drawer.hidden = false;
      const saved = state.conversationLayout; const identity = currentIdentity();
      const capturing = state.current?.status === 'loading' || state.current?.status === 'idle';
      const changing = !identity || identity.signature !== state.current?.signature || identity.titleNode !== state.current?.titleNode;
      const nativeHeader = nativePanelHeader();
      if (saved && saved.viewportWidth === innerWidth && saved.viewportHeight === innerHeight && (capturing || changing || nativeHeader || Date.now() < state.layoutHoldUntil)) {
        // Abrir dados para capturar o telefone não muda o tamanho da ficha visível.
        drawer.classList.toggle('full-record', saved.full);
        Object.assign(drawer.style, saved.style);
        if (!saved.full && main) {
          if (state.dockMain !== main) { releaseDock(); state.dockMain = main; }
          main.setAttribute('data-buffet-crm-dock', ''); main.style.setProperty('--buffet-crm-dock-width', saved.style.width);
        }
        return;
      }
      if (rect && nativeHeader) {
        // Primeira abertura: considera a largura que volta após fechar o painel nativo.
        const panelRect = document.querySelector(SELECTORS.right)?.getBoundingClientRect();
        if (panelRect && panelRect.width > 0 && panelRect.left >= rect.right - 2) {
          const restoredRight = Math.min(right, panelRect.right);
          rect = { left: rect.left, top: rect.top, width: restoredRight - rect.left, right: restoredRight, height: rect.height };
        }
      }
      const full = !rect || rect.width < 640;
      if (full) {
        releaseDock();
        // Preenche a área da conversa apenas quando a janela é realmente estreita.
        // A ficha continua no mesmo container, preservando edição, abas e rolagem.
        drawer.classList.add('full-record');
        const fallbackLeft = Math.max(bounds?.left || 0, left);
        Object.assign(drawer.style, { left: `${rect?.left ?? fallbackLeft}px`, top: `${rect?.top ?? top}px`, width: `${rect?.width ?? Math.max(0, right - fallbackLeft)}px`, height: `${rect?.height ?? Math.max(0, bottom - top)}px` });
      } else {
        drawer.classList.remove('full-record');
        const width = Math.min(390, Math.max(310, Math.round(rect.width * .43)));
        if (state.dockMain !== main) { releaseDock(); state.dockMain = main; }
        main.setAttribute('data-buffet-crm-dock', ''); main.style.setProperty('--buffet-crm-dock-width', `${width}px`);
        Object.assign(drawer.style, { left: `${rect.right - width}px`, top: `${rect.top}px`, width: `${width}px`, height: `${rect.height}px` });
      }
      state.conversationLayout = { full, viewportWidth: innerWidth, viewportHeight: innerHeight, style: { left: drawer.style.left, top: drawer.style.top, width: drawer.style.width, height: drawer.style.height } };
    }
  }
  function scheduleLayout() { if (state.layoutFrame === null) state.layoutFrame = requestAnimationFrame(layout); }
  function installNav() {
    const section = document.querySelector(SELECTORS.navbar); if (!section) return;
    if (section.querySelector('#buffet-crm-nav')) return;
    document.getElementById('buffet-crm-nav-wrap')?.remove();
    const wrap = el('div', { id: 'buffet-crm-nav-wrap' });
    const trigger = iconButton('crm', 'CRM do buffet', () => state.panelMode === 'hub' || state.panelMode === 'record' ? closePanel() : showHub());
    trigger.id = 'buffet-crm-nav'; trigger.setAttribute('aria-pressed', 'false'); trigger.append(el('span', { className: 'buffet-crm-native-badge', hidden: '' })); wrap.append(trigger);
    const meta = section.querySelector(SELECTORS.metaAI);
    if (meta) {
      let item = meta;
      while (item.parentElement && item.parentElement !== section && !item.parentElement.querySelector('button[aria-label="Conversas"]')) item = item.parentElement;
      item.after(wrap);
    } else {
      const conversations = section.querySelector('button[aria-label="Conversas"]');
      let item = conversations; while (item?.parentElement && item.parentElement !== section && item.parentElement.querySelectorAll('button').length === 1) item = item.parentElement;
      (item?.parentElement || section).append(wrap);
    }
  }
  function updateTrigger() {
    const trigger = document.getElementById('buffet-crm-trigger'); const current = state.current;
    if (trigger) { trigger.dataset.status = current?.status || ''; trigger.setAttribute('aria-pressed', String(state.panelMode === 'conversation')); trigger.title = current?.phone ? `Ficha do lead · ${formatPhone(current.phone)}` : 'CRM desta conversa'; }
    document.getElementById('buffet-crm-nav')?.setAttribute('aria-pressed', String(state.panelMode === 'hub' || state.panelMode === 'record' || !workspace.hidden));
  }
  function installTrigger(identity) {
    let trigger = document.getElementById('buffet-crm-trigger');
    if (trigger && !identity.header.contains(trigger)) { trigger.remove(); trigger = null; }
    if (!trigger) {
      trigger = iconButton('crm', 'Abrir CRM desta conversa', () => state.panelMode === 'conversation' ? closePanel() : showConversation()); trigger.id = 'buffet-crm-trigger';
      const info = identity.header.querySelector(SELECTORS.info); if (info) info.after(trigger); else identity.header.append(trigger);
    }
    updateTrigger();
  }
  function latestLead(lead) {
    const phone = lead.telefone;
    return cache?.leads?.[phone] || hub.db?.leads?.[phone] || lead;
  }
  function approvedNavigation(work) {
    state.navigationApproved++;
    try { return work(); } finally { state.navigationApproved--; }
  }
  function guardNavigation(work, { onCancel } = {}) {
    if (state.navigationApproved) return false;
    const editor = state.editor;
    if (!editor || (!editor.dirty && !editor.saving)) return false;
    if (state.leavePrompt) return true;
    const previousFocus = shadow.activeElement;
    const backdrop = el('div', { className: 'modal-backdrop' });
    let busy = false;
    const close = () => {
      backdrop.remove();
      if (state.leavePrompt?.backdrop === backdrop) state.leavePrompt = null;
    };
    const cancel = () => {
      if (busy) return;
      close(); onCancel?.();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    const continueToDestination = () => {
      close();
      approvedNavigation(() => { editor.refresh(); work(); });
    };
    const keep = action('back', 'Continuar nessa ficha', cancel);
    const discard = action('trash', 'Descartar e sair', () => {
      editor.dirty = false;
      continueToDestination();
    }, 'discard-exit');
    const save = action('save', 'Salvar e continuar', saveAndContinue, 'primary');
    async function saveAndContinue() {
      if (busy) return;
      busy = true; keep.disabled = discard.disabled = save.disabled = true;
      showLoading(save, 'Salvando…');
      try {
        const saved = await editor.save({ refresh: false });
        if (saved) continueToDestination();
        else { close(); onCancel?.(); notify('As alterações continuam abertas. Confira a ficha antes de sair.'); }
      } catch (error) { close(); onCancel?.(); notify(errorMessage(error)); }
    }
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Salvar alterações antes de sair?' },
      el('div', { className: 'leave-icon' }, icon('save', 24)),
      el('h2', { text: 'Salvar alterações antes de sair?' }),
      el('p', { className: 'muted', text: 'Há alterações não salvas nesta ficha' }),
      el('div', { className: 'leave-actions' }, save, keep, discard)));
    state.leavePrompt = { backdrop, cancel };
    shadow.append(backdrop); keep.focus();
    if (editor.saving) saveAndContinue();
    return true;
  }
  function closePanel() {
    if (guardNavigation(closePanel)) return;
    if (state.current?.status === 'loading') { state.controller?.abort(); ++state.generation; Object.assign(state.current, { status: 'idle', phone: null, lead: null, error: '' }); }
    clearTimeout(state.layoutResumeTimer); state.layoutResumeTimer = null; state.layoutHoldUntil = 0; state.conversationLayout = null;
    state.editor = null;
    state.panelMode = 'closed'; state.record = null; ++state.view; workspace.hidden = true; drawer.hidden = true; hubInspector.hidden = true; hubMain.hidden = false;
    clearDeadline(); releaseDock(); updateTrigger();
  }
  function prepareView(mode) {
    clearDeadline(); state.editor = null; ++state.view; state.panelMode = mode;
    if (mode !== 'conversation') { releaseDock(); state.conversationLayout = null; drawer.hidden = true; workspace.hidden = false; hubMain.hidden = false; }
    updateTrigger(); scheduleLayout(); return state.view;
  }
  function recordContainer(mode) { return mode === 'conversation' ? drawer : hubInspector; }
  function retryIdentification() { const identity = currentIdentity(); if (identity) startIdentification(identity); else showConversation(); }
  function showConversation() {
    if (guardNavigation(showConversation)) return;
    if (gateAuth(showConversation)) return;
    const current = state.current;
    if (current?.status === 'idle') { state.panelMode = 'conversation'; startIdentification(current); return; }
    const token = prepareView('conversation'); workspace.hidden = true; drawer.hidden = false; drawer.replaceChildren();
    scheduleLayout();
    if (!current) { drawer.append(messageHeader('CRM da conversa'), emptyState('Abra uma conversa', 'A ficha acompanha somente a conversa selecionada.')); return; }
    if (current.status === 'ready' || current.status === 'group') dismissNativeForConversation(current);
    if (current.status === 'ready' && current.lead) { renderLead(current.lead, 'conversation', token); return; }
    drawer.append(messageHeader(contactLabel(current.name, current.phone)));
    const content = el('div', { className: 'record-scroll' }); drawer.append(content);
    if (current.status === 'loading') { content.append(loadingBox('Identificando este contato…')); return; }
    if (current.status === 'group') { content.append(emptyState('Conversa em grupo', 'Abra uma conversa individual para associar um lead.', 'people')); return; }
    if (current.status === 'error') {
      content.append(statusBox(current.error, 'error'), action('refresh', 'Tentar novamente', retryIdentification));
      const phone = el('input', { type: 'tel', placeholder: '+55 DDD número', required: '' });
      const form = el('form', { className: 'composer' }, el('h3', { text: 'Conferir telefone manualmente' }), el('p', { className: 'muted', text: 'Use o número confirmado nos dados deste contato.' }), el('label', {}, 'Telefone', phone), el('button', { type: 'submit', className: 'primary', text: 'Associar telefone' }));
      form.addEventListener('submit', async event => {
        event.preventDefault(); const number = normalizePhone(phone.value); if (!number) { phone.setCustomValidity('Informe um telefone válido com DDD.'); phone.reportValidity(); return; }
        const submit = form.querySelector('button'); submit.disabled = true; const generation = state.generation;
        try { const db = await loadDatabase(true); if (token !== state.view || generation !== state.generation) return; Object.assign(current, { phone: number, lead: db.leads[number] || null, status: 'ready' }); showConversation(); }
        catch (error) { notify(errorMessage(error)); } finally { submit.disabled = false; }
      }); phone.addEventListener('input', () => phone.setCustomValidity('')); content.append(form); return;
    }
    const unregistered = emptyState('Contato ainda não cadastrado', formatPhone(current.phone), 'people');
    content.append(unregistered);
    const create = action('plus', 'Criar lead', async () => {
      create.disabled = true; showLoading(create, 'Criando lead…'); const generation = state.generation;
      try { const initial = newLead(current.name); const lead = await saveLead(current.phone, initial); if (generation === state.generation) current.lead = lead; notify('Lead cadastrado.'); if (token === state.view) showConversation(); }
      catch (error) { notify(errorMessage(error)); create.disabled = false; create.replaceChildren(icon('plus', 17), 'Criar lead'); }
    }, 'primary'); unregistered.append(el('div', { className: 'empty-actions' }, create));
  }
  function messageHeader(title) { return el('div', { className: 'record-head row between' }, el('h3', { text: title }), iconButton('close', 'Fechar ficha', closePanel, 'ghost')); }
  function closeRecord() {
    if (guardNavigation(closeRecord)) return;
    state.editor = null;
    if (state.panelMode === 'conversation') { closePanel(); return; }
    state.record = null; state.panelMode = 'hub'; ++state.view; hubInspector.hidden = true; hubInspector.replaceChildren(); workspace.classList.remove('has-record'); hubMain.hidden = false; clearDeadline(); renderHub();
  }
  function showRecord(lead, tab = 'lead') {
    if (gateAuth(() => showRecord(lead, tab))) return;
    if (!state.navigationApproved && state.panelMode === 'record' && state.editor?.phone === lead.telefone && state.editor.dirty && !state.editor.saving) { state.editor.selectTab(tab); return; }
    if (guardNavigation(() => showRecord(latestLead(lead), tab))) return;
    const token = prepareView('record'); state.record = lead; state.tab = tab; hubInspector.hidden = false; workspace.classList.add('has-record'); hubInspector.replaceChildren(); renderLead(lead, 'record', token);
  }

  // 5. Uma única ficha em edição; sair exige salvar ou descartar alterações.
  function renderLead(lead, mode, token, fillContactName = true) {
    const target = recordContainer(mode); target.replaceChildren();
    const phone = lead.telefone; let base = clone(lead); const initial = { ...lead };
    let tasks = tasksOf(initial); let baseline = '';
    const headerName = el('h2', { text: contactLabel(initial.nome, phone) }); const avatar = el('div', { className: 'avatar', text: initials(initial.nome) });
    const stageIndicator = stageBadge(initial.etapa || 'NOVO_LEAD');
    const chatLink = el('a', { href: `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`, title: 'Abrir conversa no WhatsApp', 'aria-label': 'Abrir conversa no WhatsApp', className: 'icon-button row' }, icon('chat', 20));
    chatLink.addEventListener('click', event => { if (guardNavigation(() => { window.location.href = chatLink.href; })) event.preventDefault(); });
    target.append(el('div', { className: 'record-head' }, el('div', { className: 'row' }, avatar, el('div', { className: 'grow' }, el('div', { className: 'record-name-row' }, headerName, stageIndicator), el('div', { className: 'phone-line', text: formatPhone(phone) })), chatLink, iconButton('close', 'Fechar ficha', closeRecord, 'ghost'))));
    const tabs = el('div', { className: 'record-tabs', role: 'tablist', 'aria-label': 'Ficha do lead' });
    const scroll = el('div', { className: 'record-scroll' }); const panels = {}; const tabButtons = {};
    for (const [key, label, glyph] of [['lead', 'Lead', 'people'], ['acoes', 'Ações', 'calendar'], ['historico', 'Histórico', 'history']]) {
      const tab = action(glyph, label, () => switchTab(key)); tab.setAttribute('role', 'tab'); tab.id = `tab-${key}-${phone}`; tab.setAttribute('aria-controls', `pane-${key}-${phone}`); tabs.append(tab); tabButtons[key] = tab;
      panels[key] = el('div', { role: 'tabpanel', id: `pane-${key}-${phone}`, 'aria-labelledby': tab.id }); scroll.append(panels[key]);
    }
    function activateTab(key) { state.tab = key; for (const name of Object.keys(panels)) { panels[name].hidden = name !== key; tabButtons[name].classList.toggle('active', name === key); tabButtons[name].setAttribute('aria-selected', String(name === key)); tabButtons[name].tabIndex = name === key ? 0 : -1; } scroll.scrollTop = 0; }
    function switchTab(key) {
      if (key === state.tab) return;
      activateTab(key);
      if (key === 'historico') renderTimeline();
    }
    tabs.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const names = Object.keys(panels); const index = names.indexOf(state.tab); const next = names[(index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length]; switchTab(next); shadow.getElementById(`tab-${state.tab}-${phone}`)?.focus(); event.preventDefault(); });
    const controls = {};
    function field(parent, key, text, type, value, full = false, attrs = {}) {
      const input = type === 'textarea' ? el('textarea', attrs) : el('input', { type, ...attrs }); input.name = key; input.value = value ?? ''; controls[key] = input;
      parent.append(el('label', { className: full ? 'full' : '' }, text, input)); return input;
    }
    function selectField(parent, key, text, options, value, full = false) { const input = selectControl(text, options, value); controls[key] = input; parent.append(el('label', { className: full ? 'full' : '' }, text, input)); return input; }
    function section(parent, title) { const grid = el('div', { className: 'fields' }); parent.append(el('section', { className: 'section' }, el('h3', { text: title }), grid)); return grid; }
    const funnel = section(panels.lead, 'Situação do atendimento');
    selectField(funnel, 'etapa', 'Etapa do funil', STAGES, initial.etapa || 'NOVO_LEAD', true);
    selectField(funnel, 'prioridade', 'Prioridade', { NORMAL: 'Normal', GATILHO: 'GATILHO', BAIXA: 'Baixa prioridade' }, initial.prioridade || 'NORMAL', true);
    const leadFields = section(panels.lead, 'Responsável pela festa');
    field(leadFields, 'nome', 'Nome do responsável', 'text', initial.nome, true, { maxlength: '160' }); field(leadFields, 'telefone', 'Telefone', 'tel', formatPhone(phone), true, { readonly: '' });
    field(leadFields, 'observacao', 'Notas internas do atendimento', 'textarea', initial.observacao, true, { maxlength: '10000', rows: '5' });
    const taskList = el('div'); const completedList = el('div');
    panels.acoes.append(el('h3', { className: 'section', text: 'Próximas ações' }), taskList);
    const taskComposer = el('div', { className: 'composer' }); const taskGrid = el('div', { className: 'fields' });
    const taskType = selectControl('Tipo da próxima ação', { '': 'Selecione o tipo', ...TASK_TYPES }); const taskDate = el('input', { type: 'date', 'aria-label': 'Data da nova ação', value: dateAfter(prefs.retornoDias, true) });
    const taskTime = el('input', { type: 'time', 'aria-label': 'Horário da nova ação' }); const taskText = el('textarea', { maxlength: '500', rows: '2', 'aria-label': 'Observação da nova ação (opcional)' });
    taskGrid.append(el('label', { className: 'full' }, 'Tipo da ação', taskType), el('label', {}, 'Data', taskDate), el('label', {}, 'Horário opcional', taskTime), el('label', { className: 'full' }, 'Observação (opcional)', taskText));
    const composerSnapshot = () => JSON.stringify([taskType.value, taskDate.value, taskTime.value, taskText.value]);
    let composerBaseline = composerSnapshot();
    const hasTaskDraft = () => composerSnapshot() !== composerBaseline;
    taskComposer.append(el('h3', { text: 'Planejar uma próxima ação', style: 'margin-bottom:12px' }), taskGrid, el('div', { className: 'presets' }, button('Hoje 15h', () => { taskDate.value = localDate(); taskTime.value = '15:00'; markDirty(); }, 'small'), button('Amanhã', () => { taskDate.value = dateAfter(1); markDirty(); }, 'small'), button('Em 2 dias', () => { taskDate.value = dateAfter(2); markDirty(); }, 'small'), button('Em uma semana', () => { taskDate.value = dateAfter(7); markDirty(); }, 'small')), action('plus', 'Adicionar à agenda', addTask, 'primary small'));
    panels.acoes.append(taskComposer, el('section', { className: 'completed-actions', 'aria-label': 'Ações concluídas e canceladas' }, el('h3', { text: 'Ações concluídas e canceladas' }), completedList));
    const timeline = el('div', { className: 'history-timeline' }); panels.historico.append(el('h3', { className: 'section', text: 'Linha do tempo' }), timeline);
    const feedback = statusBox('Dados salvos.');
    const save = el('button', { type: 'submit', className: 'primary', text: 'Salvar alterações' });
    const discard = action('back', 'Descartar', () => {
      if (editor.saving || !editor.dirty) return;
      openDialog('Descartar alterações?', 'As alterações feitas nesta ficha serão perdidas.', close => {
        close(); editor.discard();
      }, 'Descartar', 'Manter');
    }, 'small'); discard.title = 'Descartar alterações'; discard.setAttribute('aria-label', 'Descartar alterações');
    const footer = el('div', { className: 'record-footer' }, feedback, el('div', { className: 'row' }, save, discard));
    const fieldset = el('fieldset', {}, tabs, scroll, footer); const form = el('form', { className: 'record-form', novalidate: '' }, fieldset); target.append(el('div', { className: 'record-body' }, form));
    function patch() {
      return { nome: controls.nome.value.trim(), telefone: phone,
        etapa: controls.etapa.value, prioridade: controls.prioridade.value,
        observacao: controls.observacao.value,
        tarefas: clone(tasks) };
    }
    function markDirty() {
      editor.dirty = JSON.stringify(patch()) !== baseline || hasTaskDraft();
      feedback.textContent = editor.dirty ? 'Alterações não salvas.' : 'Dados salvos.'; feedback.className = 'status'; save.disabled = discard.disabled = !editor.dirty;
      headerName.textContent = contactLabel(controls.nome.value, phone); avatar.textContent = initials(controls.nome.value);
    }
    function renderTaskLists() {
      updateStage();
      taskList.replaceChildren(); completedList.replaceChildren();
      const pending = pendingTasks({ tarefas: tasks });
      if (!pending.length) taskList.append(statusBox('Sem próxima ação. Planeje um retorno para não perder o combinado.'));
      for (const task of tasks.slice().sort((a, b) => `${a.data}${a.hora || ''}`.localeCompare(`${b.data}${b.hora || ''}`))) {
        const pending = task.status === 'PENDENTE'; const tone = pending ? taskTone(task) : task.status === 'CONCLUIDA' ? 'green' : 'red'; const box = el('article', { className: `task-item ${tone}` },
          el('span', { className: `badge ${tone}`, text: pending ? taskStatusLabel(task) : task.status === 'CONCLUIDA' ? 'Concluída' : 'Cancelada' }),
          el('p', { className: 'task-title', text: taskTitle(task) }), task.observacao ? el('p', { className: 'task-note', text: task.observacao }) : null, el('small', { className: 'muted', text: `${dateLabel(task.data)}${task.hora ? ` · ${task.hora}` : ''}` }));
        if (pending) box.append(el('div', { className: 'actions' }, action('check', 'Concluir', () => {
          task.status = 'CONCLUIDA'; task.concluidoEm = new Date().toISOString(); markDirty(); renderTaskLists();
        }, 'small'), button('Amanhã', () => postpone(task, 1), 'small'), button('+3 dias', () => postpone(task, 3), 'small'), button('Cancelar', () => { task.status = 'CANCELADA'; markDirty(); renderTaskLists(); }, 'small ghost')));
        else {
          const reopen = button('Reabrir ação', () => { task.status = 'PENDENTE'; delete task.concluidoEm; markDirty(); renderTaskLists(); }, 'small ghost');
          box.append(reopen);
        }
        (pending ? taskList : completedList).append(box);
      }
      if (!completedList.childElementCount) completedList.append(el('p', { className: 'muted', text: 'Nenhuma ação concluída ou cancelada.' }));
      const count = tasks.filter(task => task.status === 'PENDENTE').length; tabButtons.acoes.replaceChildren(icon('calendar', 17), `Ações${count ? ` · ${count}` : ''}`);
      scheduleDeadline(() => { if (token === state.view) renderTaskLists(); }, [{ tarefas: tasks }]);
    }
    function postpone(task, days) { task.data = dateAfter(days); markDirty(); renderTaskLists(); }
    function addTask() {
      taskDate.setCustomValidity(''); taskType.setCustomValidity('');
      if (!validDate(taskDate.value)) { taskDate.setCustomValidity('Escolha uma data válida.'); taskDate.reportValidity(); return false; }
      if (!Object.hasOwn(TASK_TYPES, taskType.value)) { taskType.setCustomValidity('Escolha o tipo da próxima ação.'); taskType.reportValidity(); return false; }
      const task = { id: uid(), data: taskDate.value, hora: taskTime.value, observacao: taskText.value.trim(), tipo: taskType.value, status: 'PENDENTE', criadoEm: new Date().toISOString() };
      tasks.push(task); taskType.value = ''; taskText.value = ''; taskTime.value = ''; taskDate.value = dateAfter(prefs.retornoDias, true); composerBaseline = composerSnapshot(); markDirty(); renderTaskLists(); return true;
    }
    taskDate.addEventListener('input', () => taskDate.setCustomValidity('')); taskType.addEventListener('change', () => taskType.setCustomValidity(''));
    let logItems = []; let logLoaded = false; let logBusy = false; let logMore = false;
    const expandedHistory = new Set();
    function drawTimeline() {
      const scrollTop = scroll.scrollTop;
      timeline.replaceChildren();
      // Um salvamento pode gerar vários logs. Agrupa pela transação e autor,
      // mantendo os acontecimentos importantes juntos, inclusive entre páginas.
      const groups = new Map();
      for (const item of logItems) {
        const events = historyEvents(item);
        if (!events.length) continue;
        const key = `${item.transacao ?? `log-${item.id}`}\n${item.autor_id || 'admin'}\n${item.autor_email || ''}`;
        if (!groups.has(key)) groups.set(key, { item, events: [] });
        groups.get(key).events.push(...events.map((event, index) => ({ ...event, key: `${item.id}-${index}` })));
      }
      if (!groups.size) timeline.append(statusBox('Nenhum acontecimento registrado.'));
      let previousDay = '';
      const now = new Date(); const today = localDate(now);
      const previousDate = new Date(now); previousDate.setDate(previousDate.getDate() - 1);
      const yesterday = localDate(previousDate);
      for (const { item, events } of groups.values()) {
        const date = new Date(item.momento); const valid = !Number.isNaN(date.getTime());
        const day = valid ? localDate(date) : 'sem-data';
        if (day !== previousDay) {
          timeline.append(el('h4', { className: 'history-day', text: day === today ? 'Hoje' : day === yesterday ? 'Ontem' :
            valid ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Data não informada' }));
          previousDay = day;
        }
        const who = (typeof item.autor_nome === 'string' && item.autor_nome.trim()) || item.autor_email || (item.autor_id ? 'Usuário' : 'Admin');
        const article = el('article', { className: 'timeline-item' }, el('div', { className: 'history-meta' },
          el('time', { datetime: item.momento, text: valid ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—', title: timestampLabel(item.momento) }),
          el('span', { className: 'history-author', text: who })));
        for (const event of events.sort((a, b) => b.rank - a.rank)) {
          const box = el('div', { className: `history-event ${event.tone}` },
            el('div', { className: 'history-event-head' }, icon(event.glyph, 16), el('strong', { text: event.title })));
          if (event.detail) box.append(el('p', { text: event.detail }));
          if (event.comparison) {
            const details = el('details', { className: 'history-details' }, el('summary', { text: 'Ver texto completo e alteração' }),
              el('div', { className: 'history-value' }, el('span', { text: 'Antes' }), event.comparison.before || 'Sem texto'),
              el('div', { className: 'history-value' }, el('span', { text: 'Depois' }), event.comparison.after || 'Sem texto'));
            details.open = expandedHistory.has(event.key);
            details.addEventListener('toggle', () => { if (details.open) expandedHistory.add(event.key); else expandedHistory.delete(event.key); });
            box.append(details);
          }
          article.append(box);
        }
        timeline.append(article);
      }
      if (logMore) timeline.append(action('history', 'Carregar anteriores', () => renderTimeline(true), 'small'));
      scroll.scrollTop = scrollTop;
    }
    async function renderTimeline(more = false) {
      if (logBusy || (logLoaded && !more)) return;
      logBusy = true;
      if (!more) timeline.replaceChildren(loadingBox('Carregando histórico…'));
      else timeline.querySelector('button')?.setAttribute('disabled', '');
      try {
        const items = await loadLogs(phone, more ? logItems.at(-1)?.id : null);
        if (token !== state.view) return;
        if (!Array.isArray(items)) throw new Error('Não foi possível carregar o histórico. Tente novamente.');
        logItems.push(...items); logMore = items.length === 100; logLoaded = true; drawTimeline();
      } catch (error) {
        if (token !== state.view) return;
        if (more) drawTimeline(); else timeline.replaceChildren();
        timeline.append(statusBox(errorMessage(error), 'error'), action('refresh', 'Tentar novamente', () => renderTimeline(more)));
      } finally { logBusy = false; }
    }
    function updateStage() {
      stageIndicator.className = `badge ${color(controls.etapa.value)}`; stageIndicator.textContent = STAGES[controls.etapa.value] || controls.etapa.value;
    }
    controls.etapa.addEventListener('change', renderTaskLists);
    // Tipo, data, horário e observação de uma ação em planejamento são alterações pendentes.
    for (const input of Object.values(controls)) { input.addEventListener('input', markDirty); input.addEventListener('change', markDirty); }
    for (const input of [taskType, taskDate, taskTime, taskText]) { input.addEventListener('input', markDirty); input.addEventListener('change', markDirty); }
    // Os compositores não participam da validação do formulário principal.
    for (const input of [taskType, taskDate, taskTime, taskText]) input.setAttribute('form', `buffet-crm-composer-${phone}`);
    async function saveChanges({ refresh = true } = {}) {
      if (editor.saving) return editor.pendingSave;
      if (!editor.dirty) return true;
      updateStage();
      // Salvar inclui a ação em planejamento, mesmo sem observação.
      for (const input of [taskDate, taskType]) input.setCustomValidity('');
      if (hasTaskDraft()) {
        const currentTab = state.tab;
        activateTab('acoes');
        if (!addTask()) return false;
        activateTab(currentTab);
      }
      if (!form.checkValidity()) {
        const invalid = form.querySelector('input:invalid,select:invalid,textarea:invalid'); const pane = invalid?.closest('[role="tabpanel"]'); const key = Object.keys(panels).find(key => panels[key] === pane); if (key) activateTab(key); form.reportValidity(); return false;
      }
      let value = patch();
      hub.busy.add(phone);
      editor.saving = true; fieldset.disabled = true; showLoading(feedback, 'Salvando alterações…'); feedback.className = 'status row';
      editor.pendingSave = (async () => {
        try {
          const saved = await saveLead(phone, value, base); updateCachedLead(saved); base = clone(saved);
          tasks = tasksOf(saved); baseline = JSON.stringify(patch()); editor.dirty = false;
          feedback.textContent = 'Dados salvos.'; save.disabled = discard.disabled = true; notify('Lead atualizado.');
          if (refresh && token === state.view) approvedNavigation(editor.refresh);
          scheduleSync();
          return true;
        } catch (error) { if (token === state.view) { feedback.textContent = errorMessage(error); feedback.className = 'status error'; } else notify(errorMessage(error)); return false; }
        finally { hub.busy.delete(phone); editor.saving = false; fieldset.disabled = false; }
      })();
      return editor.pendingSave;
    }
    const editor = {
      phone, dirty: false, saving: false, pendingSave: null, save: saveChanges,
      refresh() {
        if (token !== state.view) return;
        clearDeadline(); const refreshedToken = ++state.view;
        if (mode !== 'conversation') { state.record = base; renderHubMain(); }
        // Salvar/descartar restaura a ficha; não é uma nova abertura do lead.
        renderLead(base, mode, refreshedToken, false);
      },
      discard() { editor.dirty = false; approvedNavigation(editor.refresh); scheduleSync(); },
      selectTab(tab) { activateTab(tab); },
    };
    state.editor = editor;
    form.addEventListener('submit', event => { event.preventDefault(); saveChanges(); });
    updateStage(); renderTaskLists(); activateTab(state.tab || 'lead'); if (state.tab === 'historico') renderTimeline();
    baseline = JSON.stringify(patch());
    // Primeiro estabelece os dados salvos; preencher o nome do WhatsApp passa
    // pelo mesmo estado de edição de qualquer mudança manual no formulário.
    const contactName = fillContactName ? currentContactName(phone) : null;
    if (contactName && contactName !== controls.nome.value) controls.nome.value = contactName;
    markDirty();
    scheduleLayout();
  }

  // 6. Hub: funil, agenda, lista, filtros e atalhos com gravação explícita.
  function updateCachedLead(lead) { if (state.current?.phone === lead.telefone) state.current.lead = lead; if (hub.db) hub.db.leads[lead.telefone] = clone(lead); if (state.record?.telefone === lead.telefone) state.record = lead; }
  function renderHubHeader() {
    hubHead.replaceChildren(el('div', { className: 'row between wrap' }, el('div', { className: 'row' }, el('div', { className: 'brand' }, icon('crm', 24)), el('h1', { text: `${BUFFETS[buffetId].name} - Festas` })), el('div', { className: 'row wrap' }, action('plus', 'Novo lead', createManualLead, 'primary'), iconButton('refresh', 'Atualizar dados', () => showHub(true), 'ghost'), iconButton('user', 'Usuário', userDialog, 'ghost'), iconButton('close', 'Voltar ao WhatsApp', closePanel, 'ghost'))));
  }
  async function showHub(force = true) {
    if (guardNavigation(() => showHub(force))) return;
    if (gateAuth(() => showHub(force))) return;
    const token = prepareView('hub'); state.record = null; hubInspector.hidden = true; hubInspector.replaceChildren(); workspace.classList.remove('has-record'); renderHubHeader();
    if (!hub.db || force) hubMain.replaceChildren(hubLoading());
    else renderHubMain();
    try { const db = await loadDatabase(force); if (token !== state.view) return; hub.db = db; renderHub(); }
    catch (error) { if (token === state.view) { hubMain.replaceChildren(statusBox(errorMessage(error), 'error'), action('refresh', 'Tentar novamente', () => showHub(true))); } }
  }
  function renderHub() { if (!hub.db) return; renderHubHeader(); renderHubMain(); updateTrigger(); }
  function filteredLeads() {
    const leads = Object.values(hub.db?.leads || {}); const term = hub.search.trim().toLocaleLowerCase('pt-BR'); const digits = term.replace(/\D/g, '');
    return leads.filter(lead => {
      const pending = pendingTasks(lead);
      if (hub.filter === 'abertos' && !openLead(lead)) return false;
      if (hub.filter === 'semacao' && (!openLead(lead) || pending.length)) return false;
      if (hub.filter === 'parahoje' && !dueContact(lead)) return false;
      if (hub.view !== 'kanban' && hub.stage && lead.etapa !== hub.stage) return false;
      if (hub.priority && (lead.prioridade || 'NORMAL') !== hub.priority) return false;
      const haystack = [lead.nome, lead.telefone, lead.observacao].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return !term || haystack.includes(term) || (digits && /^[+\d\s().-]+$/.test(term) && lead.telefone.includes(digits));
    }).sort((a, b) => {
      if (hub.sort === 'atualizacao') return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || ''));
      const priority = { late: 0, today: 1, future: 2, none: 3 }; const at = nextTask(a); const bt = nextTask(b);
      return priority[followStatus(at)] - priority[followStatus(bt)] || (b.prioridade === 'GATILHO') - (a.prioridade === 'GATILHO') || `${at?.data || '9999'}${at?.hora || ''}`.localeCompare(`${bt?.data || '9999'}${bt?.hora || ''}`) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });
  }
  function renderHubMain() {
    if (!hub.db || workspace.hidden) return;
    hubMain.replaceChildren(); const all = Object.values(hub.db.leads); const open = all.filter(openLead);
    const metrics = el('div', { className: 'metrics' });
    for (const [label, value, detail, filter] of [
      ['Oportunidades abertas', open.length, 'no funil de atendimento', 'abertos'],
      ['Ações pra hoje', all.filter(dueContact).length, 'leads com ações vencidas ou para hoje', 'parahoje'],
      ['Sem próxima ação', open.filter(lead => !pendingTasks(lead).length).length, 'defina o próximo passo', 'semacao'],
    ]) {
      const metric = button('', () => { hub.filter = hub.filter === filter ? '' : filter; hub.stage = ''; renderHubMain(); }, `metric ${hub.filter === filter ? 'active' : ''}`);
      metric.setAttribute('aria-pressed', String(hub.filter === filter));
      metric.title = detail; metric.append(el('span', { className: 'eyebrow', text: label }), el('strong', { text: value })); metrics.append(metric);
    }
    const segments = el('div', { className: 'segments', role: 'group', 'aria-label': 'Visualização do CRM' });
    for (const [value, label, glyph] of [['kanban', 'Funil', 'crm'], ['agenda', 'Agenda', 'calendar'], ['lista', 'Lista', 'list']]) {
      const changeView = () => { hub.view = value; prefs.view = value; GM_setValue('buffet-crm-view-v3', value); renderHubMain(); };
      const tab = action(glyph, label, changeView, hub.view === value ? 'active' : ''); tab.setAttribute('aria-pressed', String(hub.view === value)); segments.append(tab);
    }
    const search = el('input', { type: 'search', placeholder: 'Buscar...', 'aria-label': 'Buscar oportunidades', value: hub.search });
    const sort = selectControl('Ordenar oportunidades', { acao: 'Próxima ação', atualizacao: 'Última atualização' }, hub.sort);
    const toolbar = el('div', { className: 'toolbar' }, segments, el('div', { className: 'search' }, icon('search', 17), search));
    const filters = el('div', { className: 'filter-bar' });
    const stage = selectControl('Filtrar por etapa', { '': 'Todas as etapas', ...STAGES }, hub.stage);
    const priority = selectControl('Filtrar por prioridade', { '': 'Todas as prioridades', GATILHO: 'GATILHO', NORMAL: 'Normal', BAIXA: 'Baixa' }, hub.priority);
    if (hub.view !== 'kanban') filters.append(el('label', {}, 'Etapa', stage));
    filters.append(el('label', {}, 'Prioridade', priority), el('label', {}, 'Ordenar por', sort));
    const content = el('div', { className: 'view-content' });
    hubMain.append(metrics, el('div', { className: 'hub-controls' }, toolbar, filters), content);
    function renderContent() {
      const leads = filteredLeads(); content.replaceChildren();
      if (!all.length) { content.append(emptyState('Vamos organizar as próximas festas', 'Cadastre um lead pelo botão Novo lead ou abra a ficha de uma conversa no WhatsApp.', 'cake')); return; }
      if (!leads.length) { content.append(emptyState('Nenhuma oportunidade neste filtro', 'Mude os filtros ou a busca para ampliar a visão.')); return; }
      if (hub.view === 'kanban') renderBoard(content, leads);
      else if (hub.view === 'agenda') renderAgenda(content, leads);
      else renderTable(content, leads);
    }
    search.addEventListener('input', () => { hub.search = search.value; renderContent(); });
    stage.addEventListener('change', () => { hub.stage = stage.value; if (TERMINAL.has(hub.stage)) { hub.filter = ''; renderHubMain(); } else renderContent(); }); priority.addEventListener('change', () => { hub.priority = priority.value; renderContent(); }); sort.addEventListener('change', () => { hub.sort = sort.value; renderContent(); });
    renderContent();
    if (state.panelMode === 'hub') scheduleDeadline(() => { if (state.panelMode === 'hub') renderHubMain(); }, all);
  }
  function renderBoard(parent, leads) {
    const board = el('div', { className: 'board', 'aria-label': 'Funil de oportunidades' });
    const stages = Object.keys(STAGES);
    for (const stage of stages) {
      const members = leads.filter(lead => (lead.etapa || 'NOVO_LEAD') === stage);
      const list = el('div', { className: 'column-body' });
      const column = el('section', { className: `column ${color(stage)}`, 'aria-label': STAGES[stage] || stage }, el('header', { className: 'column-head' }, el('div', { className: 'row between' }, el('h3', { text: STAGES[stage] || stage }), el('span', { className: 'count', text: members.length }))), list);
      for (const lead of members) list.append(leadCard(lead));
      if (!members.length) list.append(el('p', { className: 'muted', text: 'Arraste uma oportunidade para esta etapa.', style: 'font-size:11px;padding:12px 5px' }));
      column.addEventListener('dragover', event => { if (!event.dataTransfer.types.includes('application/x-buffet-crm')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; column.classList.add('drag-over'); });
      column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over'); });
      column.addEventListener('drop', event => { event.preventDefault(); column.classList.remove('drag-over'); const phone = event.dataTransfer.getData('application/x-buffet-crm'); const lead = hub.db.leads[phone]; if (lead) changeStage(lead, stage); });
      board.append(column);
    }
    parent.append(board);
  }
  function leadCard(lead) {
    const busy = hub.busy.has(lead.telefone); const card = el('article', { className: `lead-card${lead.prioridade === 'GATILHO' ? ' priority-high' : ''}`, tabindex: '0', draggable: String(!busy), 'aria-label': `Abrir ${contactLabel(lead.nome, lead.telefone)}`, 'aria-busy': String(busy) });
    const cardHead = el('div', { className: 'row' }, el('div', { className: 'avatar', text: initials(lead.nome) }), el('div', { className: 'grow' }, el('div', { className: 'card-name truncate' }, highlightText(contactLabel(lead.nome, lead.telefone), normalizePhone(lead.nome) === lead.telefone || !lead.nome)), el('small', { className: 'muted' }, highlightText(formatPhone(lead.telefone), true))));
    if (lead.prioridade === 'GATILHO') cardHead.append(el('span', { className: 'priority-star', title: 'GATILHO', 'aria-label': 'GATILHO' }, icon('star', 17)));
    card.append(cardHead);
    const task = nextTask(lead);
    if (task) card.append(el('div', { className: `task-preview ${taskTone(task)}` }, el('div', { className: 'row between' }, el('strong', {}, highlightText(taskTitle(task))), icon('clock', 13)), el('p', { text: `${taskStatusLabel(task)} · ${dateLabel(task.data)}${task.hora ? ` ${task.hora}` : ''}` }), task.observacao ? el('p', { className: 'task-note' }, highlightText(task.observacao)) : null));
    else if (openLead(lead)) card.append(el('div', { className: 'task-preview slate', text: 'Definir próxima ação' }));
    if (lead.observacao?.trim()) card.append(el('div', { className: 'card-notes', title: 'Notas internas do atendimento' }, icon('note', 14), el('p', {}, highlightText(lead.observacao))));
    card.addEventListener('click', event => { if (!event.target.closest('button,select,a,input')) showRecord(lead); });
    card.addEventListener('keydown', event => { if (event.target === card && ['Enter', ' '].includes(event.key)) { showRecord(lead); event.preventDefault(); } });
    card.addEventListener('dragstart', event => { if (event.target.closest('select,button')) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-buffet-crm', lead.telefone); event.dataTransfer.effectAllowed = 'move'; });
    return card;
  }
  async function mutateFromHub(lead, patch) {
    const phone = lead.telefone; if (hub.busy.has(phone)) return;
    if (guardNavigation(() => mutateFromHub(latestLead(lead), patch))) return;
    hub.busy.add(phone); renderHubMain();
    try {
      const saved = await saveLead(phone, patch, lead); updateCachedLead(saved); notify('Atualização salva.');
      if (state.panelMode === 'record' && state.record?.telefone === phone && !state.editor?.dirty) showRecord(saved, state.tab);
    }
    catch (error) { notify(errorMessage(error)); }
    finally { hub.busy.delete(phone); if (!workspace.hidden) renderHubMain(); }
  }
  function changeStage(lead, stage) {
    if (hub.busy.has(lead.telefone)) { notify('Aguarde a gravação deste lead terminar.'); return; }
    if (stage === lead.etapa) return;
    if (guardNavigation(() => changeStage(latestLead(lead), stage))) return;
    mutateFromHub(lead, { etapa: stage });
  }
  function quickTask(lead, id, mode) {
    if (guardNavigation(() => quickTask(latestLead(lead), id, mode))) return;
    const tasks = tasksOf(lead); const task = tasks.find(task => task.id === id); if (!task) return;
    if (mode === 'done') { task.status = 'CONCLUIDA'; task.concluidoEm = new Date().toISOString(); }
    else { task.data = dateAfter(1); }
    mutateFromHub(lead, { tarefas: tasks });
  }
  function renderAgenda(parent, leads) {
    const groups = { Vencidos: [], Hoje: [], 'Próximos dias': [] };
    for (const lead of leads) for (const task of pendingTasks(lead)) { const status = followStatus(task); const group = status === 'late' ? 'Vencidos' : task.data === localDate() ? 'Hoje' : 'Próximos dias'; groups[group].push({ lead, task }); }
    if (!Object.values(groups).some(list => list.length)) { parent.append(emptyState('Agenda sem ações neste filtro', 'Abra uma ficha e planeje a próxima ação.', 'calendar')); return; }
    for (const [name, items] of Object.entries(groups)) {
      if (!items.length) continue; const group = el('section', { className: 'agenda-group' }, el('h3', { className: 'agenda-title', text: `${name} · ${items.length}` }));
      items.sort((a, b) => `${a.task.data}${a.task.hora || ''}`.localeCompare(`${b.task.data}${b.task.hora || ''}`));
      for (const { lead, task } of items) {
        const main = button('', () => showRecord(lead, 'acoes'), 'ghost grow'); main.style.display = 'block'; main.style.textAlign = 'left'; appendChildren(main, el('div', { className: 'task-title' }, highlightText(taskTitle(task))), task.observacao ? el('p', { className: 'task-note' }, highlightText(task.observacao)) : null, el('small', { className: 'muted' }, highlightText(contactLabel(lead.nome, lead.telefone), normalizePhone(lead.nome) === lead.telefone || !lead.nome), ' · ', highlightText(formatPhone(lead.telefone), true)), lead.observacao?.trim() ? el('p', { className: 'task-note' }, highlightText(lead.observacao)) : null);
        const done = action('check', 'Concluir', () => quickTask(lead, task.id, 'done'), 'small'); const tomorrow = button('Amanhã', () => quickTask(lead, task.id, 'tomorrow'), 'small ghost'); done.disabled = tomorrow.disabled = hub.busy.has(lead.telefone);
        group.append(el('article', { className: 'agenda-item' }, el('div', { className: 'agenda-date' }, el('span', { className: `badge ${taskTone(task)}`, text: taskStatusLabel(task) }), el('p', { text: dateLabel(task.data), style: 'margin-top:5px' }), el('small', { className: 'muted', text: task.hora || 'Sem horário' })), main, el('div', { className: 'row' }, done, tomorrow)));
      }
      parent.append(group);
    }
  }
  function renderTable(parent, leads) {
    const tbody = el('tbody'); const table = el('table', { className: 'table-wrap' }, el('thead', {}, el('tr', {}, ['Responsável / telefone', 'Etapa', 'Próxima ação', 'Prioridade'].map(text => el('th', { scope: 'col', text })))), tbody);
    for (const lead of leads) {
      const task = nextTask(lead); const name = button('', () => showRecord(lead), 'ghost small'); name.append(highlightText(contactLabel(lead.nome, lead.telefone), normalizePhone(lead.nome) === lead.telefone || !lead.nome)); name.style.padding = '0'; name.style.fontWeight = '600'; name.style.justifyContent = 'flex-start';
      const row = el('tr', {}, el('td', {}, name, el('small', {}, highlightText(formatPhone(lead.telefone), true)), lead.observacao?.trim() ? el('small', { className: 'task-note' }, highlightText(lead.observacao)) : null), el('td', {}, stageBadge(lead.etapa)),
        el('td', {}, task ? el('strong', {}, highlightText(taskTitle(task))) : null, task ? el('small', {}, el('span', { className: `badge ${taskTone(task)}`, text: `${taskStatusLabel(task)} · ${dateLabel(task.data)}${task.hora ? ` ${task.hora}` : ''}` })) : el('span', { className: 'muted', text: 'Sem ação' }), task?.observacao ? el('small', { className: 'task-note' }, highlightText(task.observacao)) : null),
        el('td', { text: { GATILHO: 'GATILHO', NORMAL: 'Normal', BAIXA: 'Baixa' }[lead.prioridade] || 'Normal' }));
      row.addEventListener('click', event => { if (!event.target.closest('button')) showRecord(lead); }); tbody.append(row);
    }
    parent.append(table);
  }

  // 7. Cadastros independentes da conversa e preferências locais.
  function openDialog(title, description, work, confirmText = 'Confirmar', cancelText = 'Cancelar') {
    const previousFocus = shadow.activeElement;
    const backdrop = el('div', { className: 'modal-backdrop' }); const close = () => { backdrop.remove(); if (previousFocus?.isConnected) previousFocus.focus(); };
    const confirm = button(confirmText, async () => { confirm.disabled = true; try { await work(close); } catch (error) { notify(errorMessage(error)); } finally { confirm.disabled = false; } }, 'primary');
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('h2', { text: title }), el('p', { className: 'muted', text: description }), el('div', { className: 'row', style: 'margin-top:20px;justify-content:flex-end' }, button(cancelText, close), confirm)));
    shadow.append(backdrop); confirm.focus(); return { backdrop, close };
  }
  function createManualLead() {
    if (guardNavigation(createManualLead)) return;
    if (gateAuth(createManualLead)) return;
    const backdrop = el('div', { className: 'modal-backdrop' }); const close = () => backdrop.remove();
    const phone = el('input', { type: 'tel', required: '', placeholder: '+55 DDD número', autocomplete: 'tel' }); const name = el('input', { type: 'text', required: '', maxlength: '160', placeholder: 'Nome de quem está organizando a festa' });
    const submit = el('button', { type: 'submit', className: 'primary', text: 'Criar oportunidade' }); const feedback = statusBox(''); feedback.hidden = true;
    const form = el('form', {}, el('div', { className: 'fields' }, el('label', { className: 'full' }, 'Telefone do cliente', phone), el('label', { className: 'full' }, 'Responsável pela festa', name)), feedback, el('div', { className: 'row', style: 'justify-content:flex-end;margin-top:20px' }, button('Cancelar', close), submit));
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Novo lead' }, el('div', { className: 'row between' }, el('h2', { text: 'Nova oportunidade' }), iconButton('close', 'Fechar cadastro', close, 'ghost')), el('p', { className: 'muted', text: 'Cadastre uma oportunidade para acompanhar o atendimento e as próximas ações.' }), form)); shadow.append(backdrop); phone.focus();
    phone.addEventListener('input', () => phone.setCustomValidity(''));
    form.addEventListener('submit', async event => {
      event.preventDefault(); const number = normalizePhone(phone.value); if (!number) { phone.setCustomValidity('Informe um telefone válido com DDD e código do país.'); phone.reportValidity(); return; }
      submit.disabled = true; showLoading(submit, 'Criando oportunidade…');
      try {
        const db = await loadDatabase(true); let lead = db.leads[number];
        if (!lead) { const initial = newLead(name.value.trim()); lead = await saveLead(number, initial); notify('Oportunidade criada.'); }
        else notify('Este telefone já está cadastrado. Abrindo a ficha existente.');
        hub.db = cache ? clone(cache) : db; hub.db.leads[number] = lead;
        if (!backdrop.isConnected) return;
        close(); if (workspace.hidden) { prepareView('hub'); renderHub(); } else renderHubMain(); showRecord(lead);
      } catch (error) { feedback.hidden = false; feedback.textContent = errorMessage(error); feedback.className = 'status error'; } finally { submit.disabled = false; submit.textContent = 'Criar oportunidade'; }
    });
  }
  function gateAuth(work) {
    if (gateUpdates(work)) return true;
    if (sessionVerified && session?.user?.id) return false;
    if (session?.refresh_token) { showSessionLoading(work); return true; }
    showLogin(work); return true;
  }
  function showSessionLoading(work) {
    if (sessionModal?.backdrop.isConnected) { sessionModal.work = work; return; }
    const backdrop = el('div', { className: 'modal-backdrop' });
    const close = () => { backdrop.remove(); if (sessionModal?.backdrop === backdrop) sessionModal = null; };
    const content = el('div', {}, loadingBox('Preparando seu acesso…'));
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Carregando CRM' },
      el('h2', { text: 'Carregando' }), content,
      el('div', { className: 'row', style: 'justify-content:flex-end;margin-top:20px' }, button('Cancelar', close))));
    const modal = { backdrop, work }; sessionModal = modal; shadow.append(backdrop);
    restoreSession().then(restored => {
      if (!backdrop.isConnected) return;
      const next = modal.work; close();
      if (restored) next(); else showLogin(next);
    }).catch(error => {
      if (!backdrop.isConnected) return;
      if (!session?.refresh_token) { const next = modal.work; close(); showLogin(next); return; }
      content.replaceChildren(statusBox(errorMessage(error), 'error'), action('refresh', 'Tentar novamente', () => {
        const next = modal.work; close(); gateAuth(next);
      }));
    });
  }
  function showLogin(work) {
    if (loginModal?.backdrop.isConnected) { loginModal.work = work; return; }
    const backdrop = el('div', { className: 'modal-backdrop' });
    const close = () => { backdrop.remove(); if (loginModal?.backdrop === backdrop) loginModal = null; };
    const email = el('input', { type: 'email', required: '', autocomplete: 'username' });
    const password = el('input', { type: 'password', required: '', autocomplete: 'current-password' });
    const buffet = el('select', { required: '', 'aria-label': 'Buffet' }, ...Object.entries(BUFFETS).map(([id, config]) => el('option', { value: id, text: config.name })));
    buffet.value = buffetId;
    const submit = el('button', { type: 'submit', className: 'primary', text: 'Entrar' });
    const feedback = statusBox(''); feedback.hidden = true;
    const fieldset = el('fieldset', {}, el('div', { className: 'fields' },
      el('label', { className: 'full' }, 'Buffet', buffet),
      el('label', { className: 'full' }, 'Email', email), el('label', { className: 'full' }, 'Senha', password)),
      el('div', { className: 'row', style: 'justify-content:flex-end;margin-top:20px' }, button('Cancelar', close), submit));
    const form = el('form', {}, fieldset, feedback);
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Entrar no CRM' },
      el('h2', { text: 'Entrar no CRM' }), form)); shadow.append(backdrop);
    const modal = { backdrop, work }; loginModal = modal;
    const finish = () => { if (!backdrop.isConnected) return; const next = modal.work; close(); next(); };
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      selectBuffet(buffet.value);
      fieldset.disabled = true; feedback.hidden = false; showLoading(feedback, 'Entrando…');
      const epoch = authEpoch;
      try {
        const value = await apiRequest('POST', '/auth/v1/token?grant_type=password', { email: email.value.trim(), password: password.value });
        if (epoch !== authEpoch || !backdrop.isConnected) return;
        if (!value?.user?.id) throw new Error('Não foi possível entrar. Tente novamente.');
        if (session?.user?.id !== value.user?.id) { authEpoch++; clearUserData(); }
        storeSession(value); GM_setValue(BUFFET_KEY, buffetId); sessionVerified = true; password.value = ''; finish();
      } catch (error) { feedback.textContent = errorMessage(error); feedback.className = 'status error'; }
      finally { fieldset.disabled = false; }
    });
    email.focus();
  }
  function clearUserData() {
    state.controller?.abort(); ++state.generation;
    cache = null; cacheTime = 0; hub.db = null; state.editor = null; state.record = null;
    if (state.current) Object.assign(state.current, { status: 'idle', phone: null, lead: null, error: '' });
    if (state.leavePrompt) { state.leavePrompt.backdrop.remove(); state.leavePrompt = null; }
    approvedNavigation(closePanel);
    drawer.replaceChildren(); hubMain.replaceChildren(); hubInspector.replaceChildren(); hubHead.replaceChildren();
  }
  function userDialog() {
    if (gateAuth(userDialog)) return;
    const backdrop = el('div', { className: 'modal-backdrop' }); const close = () => backdrop.remove();
    const feedback = statusBox(''); feedback.hidden = true;
    const logout = action('back', 'Sair', () => {
      close();
      if (guardNavigation(signOut)) return;
      signOut();
    });
    backdrop.append(el('section', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Usuário' },
      el('div', { className: 'row between' }, el('h2', { text: 'Usuário' }), iconButton('close', 'Fechar usuário', close, 'ghost')),
      el('p', { text: 'Buffet: ' + BUFFETS[buffetId].name }),
      ...(session.user.name ? [el('p', { text: session.user.name })] : []),
      el('p', { text: session.user.email }), feedback, el('div', { className: 'row', style: 'justify-content:flex-end;margin-top:20px' }, logout)));
    shadow.append(backdrop); logout.focus();
  }
  async function signOut() {
    if (guardNavigation(signOut)) return;
    if (hub.busy.size) { notify('Aguarde a gravação terminar antes de sair.'); return; }
    try {
      await supabaseRequest('POST', '/auth/v1/logout?scope=local');
      forgetSession(); clearUserData(); notify('Você saiu do CRM.');
    } catch (error) {
      // Se a sessão já terminou, sair localmente continua sendo possível.
      if (!session || [400, 401, 403].includes(error.status)) {
        forgetSession(); clearUserData(); notify('Você saiu do CRM.');
      } else notify('Não foi possível encerrar a sessão. ' + errorMessage(error));
    }
  }
  if (typeof GM_addValueChangeListener === 'function') for (const id of Object.keys(BUFFETS)) GM_addValueChangeListener(sessionKey(id), (_key, _old, value, remote) => {
    if (!remote || _key !== SESSION_KEY) return;
    const previousUser = session?.user?.id; session = value;
    if (value?.user?.id !== previousUser) {
      authEpoch++; sessionVerified = false; clearUserData();
      loginModal?.backdrop.remove(); loginModal = null;
      sessionModal?.backdrop.remove(); sessionModal = null;
    }
    scheduleRefresh();
   
    if (session?.refresh_token && !sessionVerified) restoreSession().catch(() => {});
  });
  scheduleRefresh();
  // Recupera o acesso assim que o WhatsApp carrega, sem abrir painéis nem
  // consultar conversas. O clique no CRM reaproveita esta mesma solicitação.
  restoreSession().catch(() => {});

  // 8. SPA: identifica só quando a ficha é pedida, sem varrer mensagens.
  function scheduleSync(force = false) {
    if (force) state.forceConversation = true;
    if (state.syncTimer !== null) return;
    state.syncTimer = setTimeout(() => { state.syncTimer = null; syncConversation(); }, force ? 400 : 180);
  }
  function syncConversation() {
    installNav(); scheduleLayout(); const identity = currentIdentity();
    const changed = state.forceConversation || (identity ? identity.signature !== state.signature || identity.titleNode !== state.titleNode : !!state.current);
    if (changed && state.panelMode === 'conversation' && (state.editor?.dirty || state.editor?.saving)) {
      const blocked = state.blockedIdentity;
      if (!state.forceConversation && blocked && blocked.signature === (identity?.signature || '') && blocked.titleNode === (identity?.titleNode || null)) return;
      if (guardNavigation(syncConversation, { onCancel: () => {
        state.blockedIdentity = { signature: identity?.signature || '', titleNode: identity?.titleNode || null };
        state.forceConversation = false;
      } })) return;
    }
    if (changed) { state.forceConversation = false; state.blockedIdentity = null; }
    if (!identity) {
      if (state.current) { state.controller?.abort(); ++state.generation; state.current = null; state.signature = ''; state.titleNode = null; if (state.panelMode === 'conversation') showConversation(); }
      return;
    }
    installTrigger(identity);
    if (state.header !== identity.header) {
      state.headerObserver?.disconnect(); state.header = identity.header;
      state.headerObserver = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('#buffet-crm-trigger'))) scheduleSync(); });
      state.headerObserver.observe(identity.header, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'title', 'data-testid'] });
    }
    if (changed) {
      state.controller?.abort(); ++state.generation; state.signature = identity.signature; state.titleNode = identity.titleNode;
      state.current = { ...identity, status: 'idle', phone: null, lead: null, error: '' };
      if (state.panelMode === 'conversation') showConversation(); else updateTrigger();
    }
  }
  const appObserver = new MutationObserver(records => {
    // Inclui a pesquisa aberta por atalho de teclado, além do clique na lupa.
    if (state.panelMode === 'conversation' && !state.nativeClose && !['idle', 'loading'].includes(state.current?.status) && nativeSearchOpen()) {
      if (!guardNavigation(closePanel, { onCancel: () => { if (state.current) dismissNativeForConversation(state.current); } })) closePanel();
    }
    if (records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(`#${HOST_ID}, #buffet-crm-trigger, #buffet-crm-nav-wrap, ${SELECTORS.messages}, ${SELECTORS.right}`)) return false;
      if (record.addedNodes.length && [...record.addedNodes].every(node => node instanceof Element && ['buffet-crm-trigger', 'buffet-crm-nav-wrap'].includes(node.id))) return false;
      return true;
    })) scheduleSync();
  }); appObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const chatRow = event.target.closest(SELECTORS.chatRow);
    const nativeNav = event.target.closest(`${SELECTORS.navbar} button, [data-testid="navbar-footer-section"] button`);
    const nativeSection = nativeNav && nativeNav.id !== 'buffet-crm-nav';
    const nativeInfo = event.isTrusted && state.panelMode === 'conversation' && event.target.closest(`${SELECTORS.info}, ${SELECTORS.profile}`);
    const nativeSearch = event.isTrusted && state.panelMode === 'conversation' && event.target.closest(SELECTORS.search);
    const nativePanelTrigger = nativeInfo || nativeSearch;
    if ((chatRow || nativeSection || nativePanelTrigger) && !state.navigationApproved && (state.editor?.dirty || state.editor?.saving)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const target = chatRow || nativeNav || nativePanelTrigger;
      guardNavigation(() => {
        if (nativeSection || nativePanelTrigger) closePanel();
        if (target.isConnected) target.click();
      });
      return;
    }
    if (chatRow) scheduleSync(true);
    if (nativeSection) closePanel();
    // O painel nativo tem preferência quando o usuário pede dados do WhatsApp.
    if (nativePanelTrigger) closePanel();
  }, true);
  document.addEventListener('keydown', event => {
    const chatRow = event.target instanceof Element && event.target.closest(SELECTORS.chatRow);
    if (['Enter', ' '].includes(event.key) && chatRow) {
      if (!state.navigationApproved && (state.editor?.dirty || state.editor?.saving)) {
        event.preventDefault(); event.stopImmediatePropagation();
        guardNavigation(() => { if (chatRow.isConnected) chatRow.click(); });
      } else scheduleSync(true);
    }
    if (event.key === 'Escape' && event.composedPath().includes(host)) {
      event.preventDefault(); event.stopPropagation();
      if (state.leavePrompt) state.leavePrompt.cancel();
      else { const modal = shadow.querySelector('.modal-backdrop'); if (modal) { modal.remove(); if (modal === updates.modal) { updates.modal = null; updates.next = null; } } else if (state.panelMode === 'record') closeRecord(); else closePanel(); }
    }
    if (event.key === 'Tab' && event.composedPath().includes(host)) {
      const modal = shadow.querySelector('.modal-backdrop');
      if (!modal) return;
      const focusable = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(node => !node.disabled && !node.closest('[hidden]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('beforeunload', event => { if (state.editor?.dirty || state.editor?.saving) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (session?.refresh_token) getSession().catch(() => {});
    state.refreshDeadline?.(); scheduleSync(); scheduleLayout();
  });
  checkForUpdates();
  syncConversation();
})();
