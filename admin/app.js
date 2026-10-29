// Farha · back-office · socle : authentification, navigation, journal.
// Les modules (modeles.js, …) s'enregistrent via window.FarhaAdmin.
// Toutes les autorisations sont vérifiées par Supabase (RLS + is_admin()) ;
// ce fichier ne fait qu'afficher ce que la base accepte de renvoyer.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.FARHA_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co\/?$/.test(cfg.SUPABASE_URL || '') &&
    cfg.SUPABASE_ANON_KEY && !/VOTRE-/.test(cfg.SUPABASE_ANON_KEY);

  const views = ['loginView', 'resetView', 'configView', 'appView'];
  function showView(id) { views.forEach(v => { $(v).hidden = v !== id; }); }

  if (!configured || !window.supabase) { showView('configView'); return; }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let currentUser = null;
  let loggingIn = false;
  // Lien « mot de passe oublié » : Supabase ajoute type=recovery à l'adresse.
  let recovering = /type=recovery/.test(location.hash + location.search);

  // ---------- Utilitaires ----------
  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') n.className = v; else if (v != null) n.setAttribute(k, v);
    });
    children.flat().forEach(c => n.append(c instanceof Node ? c : document.createTextNode(c == null ? '' : String(c))));
    return n;
  }
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
  const fmtDate = d => d ? dateFmt.format(new Date(d)) : '—';

  // Confirmation avant toute action sensible (utilisée par les modules suivants).
  function confirmAction(title, text, okLabel) {
    const d = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmOk').textContent = okLabel || 'Confirmer';
    return new Promise(resolve => {
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
      d.showModal();
    });
  }
  window.farhaConfirm = confirmAction;

  // Message bref en bas d'écran (succès ou erreur).
  let toastTimer = null;
  function toast(text, kind) {
    let t = $('toast');
    if (!t) { t = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.textContent = text;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
  }

  // ---------- Authentification ----------
  async function isAdmin() {
    const { data, error } = await db.rpc('is_admin');
    return !error && data === true;
  }

  async function enter(session, freshLogin) {
    if (!session) { currentUser = null; showView('loginView'); return; }
    if (!(await isAdmin())) {
      await db.auth.signOut();
      currentUser = null;
      showView('loginView');
      setStatus($('loginStatus'), "Ce compte n'a pas accès à l'administration.", 'error');
      return;
    }
    currentUser = session.user;
    $('whoEmail').textContent = currentUser.email || '';
    if (freshLogin) db.rpc('log_admin_event', { p_action: 'login' }).then(() => {}); // la requête ne part qu'avec .then()
    showView('appView');
    route();
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget, btn = $('loginSubmit'), st = $('loginStatus');
    const email = f.email.value.trim(), password = f.password.value;
    if (!email || !password) { setStatus(st, 'Saisissez votre e-mail et votre mot de passe.', 'error'); return; }
    btn.disabled = true; setStatus(st, 'Connexion…'); loggingIn = true;
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false; loggingIn = false;
    if (error) { setStatus(st, 'E-mail ou mot de passe incorrect.', 'error'); return; }
    f.password.value = '';
    setStatus(st, '');
    await enter(data.session, true);
  });

  $('forgotBtn').addEventListener('click', async () => {
    const st = $('loginStatus'), email = $('loginForm').email.value.trim();
    if (!email) { setStatus(st, "Saisissez d'abord votre e-mail, puis cliquez à nouveau.", 'error'); return; }
    await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/admin/' });
    // Même message que le compte existe ou non, pour ne rien révéler.
    setStatus(st, 'Si ce compte existe, un e-mail de réinitialisation vient de partir.', 'ok');
  });

  $('resetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget, st = $('resetStatus');
    if (f.password.value.length < 10) { setStatus(st, 'Au moins 10 caractères.', 'error'); return; }
    if (f.password.value !== f.confirm.value) { setStatus(st, 'Les deux mots de passe sont différents.', 'error'); return; }
    const { error } = await db.auth.updateUser({ password: f.password.value });
    if (error) { setStatus(st, 'Échec : ' + error.message, 'error'); return; }
    f.reset(); recovering = false;
    setStatus(st, 'Mot de passe enregistré.', 'ok');
    const { data } = await db.auth.getSession();
    setTimeout(() => enter(data.session, true), 800);
  });

  $('logoutBtn').addEventListener('click', async () => {
    await db.rpc('log_admin_event', { p_action: 'logout' });
    await db.auth.signOut();
  });

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; showView('resetView'); return; }
    if (event === 'SIGNED_OUT') { currentUser = null; showView('loginView'); }
    if (event === 'SIGNED_IN' && session && !currentUser && !recovering && !loggingIn) {
      // Session restaurée depuis l'URL (lien e-mail) : contrôle du rôle.
      setTimeout(() => enter(session, false), 0);
    }
  });

  // ---------- Navigation ----------
  const routes = {
    dashboard:   { title: 'Tableau de bord', lead: 'Commandes, chiffre d’affaires confirmé, invitations publiées et derniers avis.', render: placeholder('Le tableau de bord sera activé à l’étape 6, une fois les commandes, avis et invitations enregistrés.') },
    journal:     { title: 'Journal', lead: 'Les 100 dernières actions sensibles, enregistrées automatiquement par la base.', render: renderJournal }
  };

  function placeholder(text) {
    return box => box.append(el('div', { class: 'empty' }, el('strong', {}, 'Bientôt disponible'), text));
  }

  function route() {
    if (!currentUser) return;
    const key = (location.hash.match(/^#\/(\w+)/) || [])[1];
    const name = routes[key] ? key : 'dashboard';
    const r = routes[name];
    document.querySelectorAll('.sidebar a[data-route]').forEach(a => {
      if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const box = $('content');
    box.replaceChildren(el('h1', {}, r.title), el('p', { class: 'lead' }, r.lead));
    document.title = r.title + ' · Farha admin';
    $('sidebar').classList.remove('open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
    r.render(box);
    box.focus();
  }
  window.addEventListener('hashchange', route);
  $('menuBtn').addEventListener('click', () => {
    const open = $('sidebar').classList.toggle('open');
    $('menuBtn').setAttribute('aria-expanded', String(open));
  });

  // ---------- Journal ----------
  const ACTIONS = { insert: 'Création', update: 'Modification', delete: 'Suppression', login: 'Connexion', logout: 'Déconnexion' };
  const ENTITIES = { orders: 'Commande', order_items: 'Ligne de commande', templates: 'Modèle', categories: 'Catégorie',
    feedbacks: 'Avis', invitations: 'Invitation', admin_users: 'Administrateur', session: 'Session' };

  async function renderJournal(box) {
    const wait = el('p', { class: 'lead' }, 'Chargement…');
    box.append(wait);
    const [logs, admins] = await Promise.all([
      db.from('audit_logs').select('id,actor_id,action,entity,entity_id,created_at').order('id', { ascending: false }).limit(100),
      db.from('admin_users').select('user_id,email')
    ]);
    wait.remove();
    if (logs.error) { box.append(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), logs.error.message)); return; }
    if (!logs.data.length) { box.append(el('div', { class: 'empty' }, el('strong', {}, 'Aucune action enregistrée'), 'Les prochaines actions apparaîtront ici.')); return; }
    const who = Object.fromEntries((admins.data || []).map(a => [a.user_id, a.email]));
    const rows = logs.data.map(l => el('tr', {},
      el('td', {}, fmtDate(l.created_at)),
      el('td', {}, l.actor_id ? (who[l.actor_id] || 'Compte ' + l.actor_id.slice(0, 8)) : 'Système'),
      el('td', {}, el('span', { class: 'badge' }, ACTIONS[l.action] || l.action)),
      el('td', {}, ENTITIES[l.entity] || l.entity),
      el('td', { class: 'mono' }, l.entity_id || '')
    ));
    box.append(el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Date', 'Par', 'Action', 'Élément', 'Identifiant'].map(h => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows)
    )));
  }

  // ---------- API pour les modules ----------
  // Un module ajoute une entrée dans routes ; l'ordre du menu reste celui de index.html.
  window.FarhaAdmin = {
    db, el, fmtDate, toast, confirm: confirmAction,
    registerRoute(name, def) { routes[name] = def; },
    rerender: () => route()
  };

  // ---------- Démarrage (après chargement de tous les modules) ----------
  window.addEventListener('DOMContentLoaded', () => {
    db.auth.getSession().then(({ data }) => {
      if (recovering) return;
      enter(data.session, false);
    });
  });
})();
