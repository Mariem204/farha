// Farha · back-office · étape 6 : tableau de bord.
// Les indicateurs sont calculés dans la base par admin_dashboard (script 009), avec les droits de l'admin.
// Chiffre d'affaires confirmé = commandes payées hors tests gratuits, selon la date de paiement.
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, fmtDate, registerRoute } = window.FarhaAdmin;

  const PERIODS = { '7': '7 jours', '30': '30 jours', month: 'Ce mois', year: 'Cette année', all: 'Tout' };
  const PAY = { unpaid: 'Non payée', pending: 'En attente', paid: 'Payée', failed: 'Échouée', refunded: 'Remboursée' };
  const PROC = { new: 'Nouvelle', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée' };
  const KIND = { template: 'Modèle', sur_mesure: 'Sur mesure', test: 'Test gratuit' };
  const SVG = 'http://www.w3.org/2000/svg';
  const state = { period: '30' };

  const money = v => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' DT';
  const int = v => Number(v || 0).toLocaleString('fr-FR');
  const plural = (n, one, many) => int(n) + ' ' + (Number(n) > 1 ? many : one);
  const errText = e => /permission denied|Accès refusé/i.test((e && e.message) || '') ? 'Accès refusé : droits insuffisants.'
    : /admin_dashboard/i.test((e && e.message) || '') ? 'Le script 009 n’a pas encore été exécuté dans Supabase.' : ((e && e.message) || String(e));

  function range(p) {
    const now = new Date();
    if (p === 'all') return { from: null, to: now };
    if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    if (p === 'year') return { from: new Date(now.getFullYear(), 0, 1), to: now };
    return { from: new Date(now.getTime() - Number(p) * 864e5), to: now };
  }

  function render(box) {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Période' });
    const body = el('div', { class: 'dash' });
    Object.entries(PERIODS).forEach(([k, v]) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(k === state.period) }, v);
      b.onclick = () => {
        state.period = k;
        seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        load(body);
      };
      seg.append(b);
    });
    box.append(el('div', { class: 'toolbar' }, seg), body);
    load(body);
  }

  async function load(body) {
    body.replaceChildren(el('p', { class: 'lead' }, 'Chargement…'));
    const { from, to } = range(state.period);
    const [stats, orders, reviews] = await Promise.all([
      db.rpc('admin_dashboard', { p_from: from && from.toISOString(), p_to: to.toISOString() }),
      db.from('orders').select('id,reference,kind,customer_name,total_dt,payment_status,processing_status,created_at')
        .order('created_at', { ascending: false }).limit(5),
      db.from('feedbacks').select('id,author_name,rating,message,created_at').eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(3)
    ]);
    if (stats.error) { body.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Tableau de bord indisponible'), errText(stats.error))); return; }
    const s = stats.data || {};
    const inv = s.invitations || {};
    const periodLabel = state.period === 'all' ? 'depuis le début' : state.period === 'month' ? 'ce mois-ci'
      : state.period === 'year' ? 'cette année' : 'sur ' + PERIODS[state.period];

    const hero = el('section', { class: 'dash-hero' },
      el('p', { class: 'tile-label' }, 'Chiffre d’affaires confirmé ' + periodLabel),
      el('p', { class: 'hero-value' }, money(s.revenue)),
      el('p', { class: 'sub' }, plural(s.paid_count, 'commande payée', 'commandes payées') + ' · hors tests gratuits et remboursements'));

    const tiles = el('div', { class: 'tiles' },
      tile('Commandes reçues', int(s.orders_count), 'hors tests gratuits, ' + periodLabel, '#/commandes'),
      tile('En attente de paiement', money(s.unpaid_amount), plural(s.unpaid_count, 'commande', 'commandes') + ' ' + periodLabel, '#/commandes?pay=unpaid'),
      tile('Commandes à traiter', int(s.to_process), 'nouvelles ou en cours, toutes périodes', '#/commandes?proc=todo'),
      tile('Invitations publiées', int(inv.published), [plural(inv.draft || 0, 'brouillon', 'brouillons'), plural(inv.disabled || 0, 'désactivée', 'désactivées')].join(' · '), '#/invitations'),
      tile('Avis à modérer', int(s.feedback_pending), plural(s.feedback_published, 'avis publié', 'avis publiés'), '#/avis'),
      tile('Note moyenne', s.rating_avg != null ? String(s.rating_avg).replace('.', ',') + ' / 5' : '—', s.rating_avg != null ? 'sur les avis publiés' : 'aucun avis publié', null));

    const breakdown = el('div', { class: 'cards' },
      split('Paiement des commandes ' + periodLabel, s.by_payment, PAY, 'pay-'),
      split('Traitement des commandes ' + periodLabel, s.by_processing, PROC, 'proc-'),
      split('Types de commandes ' + periodLabel, s.by_kind, KIND, ''));

    body.replaceChildren(hero, tiles, chart(s.series || [], s.bucket), breakdown,
      el('div', { class: 'cards' }, latestOrders(orders), pendingReviews(reviews)));
  }

  function tile(label, value, sub, href) {
    const inner = [el('span', { class: 'tile-label' }, label), el('span', { class: 'tile-value' }, value), el('span', { class: 'sub' }, sub)];
    return href ? el('a', { class: 'tile', href }, inner) : el('div', { class: 'tile' }, inner);
  }

  function split(title, counts, labels, prefix) {
    const entries = Object.keys(labels).filter(k => counts && counts[k]).map(k => [k, counts[k]]);
    return el('section', { class: 'card' }, el('h3', {}, title),
      entries.length
        ? el('ul', { class: 'split' }, entries.map(([k, n]) => el('li', {}, el('span', { class: 'badge ' + (prefix ? prefix + k : '') }, labels[k]), el('strong', {}, int(n)))))
        : el('p', { class: 'sub' }, 'Aucune commande sur cette période.'));
  }

  // Barres du chiffre d'affaires confirmé : une seule série, survol = valeur exacte, tableau pour l'accessibilité.
  function chart(series, bucket) {
    const byMonth = bucket === 'month';
    const label = d => {
      const [y, m, day] = d.split('-').map(Number);
      const dt = new Date(y, m - 1, day);
      return byMonth ? dt.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    };
    const title = 'Chiffre d’affaires confirmé par ' + (byMonth ? 'mois' : 'jour');
    const box = el('section', { class: 'card chart-card' }, el('h3', {}, title));
    const total = series.reduce((a, p) => a + Number(p.revenue), 0);
    if (!total) { box.append(el('p', { class: 'sub' }, 'Aucun paiement confirmé sur cette période.')); return box; }

    // Largeur réelle de la zone : texte lisible et barres proportionnées, du mobile au grand écran.
    const content = document.getElementById('content');
    const W = Math.max(280, Math.min(1100, ((content && content.clientWidth) || 760) - 80)), H = 220, L = 8, R = 8, T = 18, B = 26;
    const max = Math.max(...series.map(p => Number(p.revenue)));
    const step = (W - L - R) / series.length;
    const bw = Math.max(2, Math.min(36, step - 2));
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'bars');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title + ' : ' + money(total) + ' au total. Détail dans le tableau ci-dessous.');
    const add = (tag, attrs) => { const n = document.createElementNS(SVG, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); svg.append(n); return n; };
    add('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'axis' });
    const tip = el('div', { class: 'chart-tip', hidden: '' });
    const every = Math.ceil(series.length / Math.max(2, Math.floor(W / 90)));
    series.forEach((p, i) => {
      const v = Number(p.revenue);
      const x = L + i * step + (step - bw) / 2;
      const h = v ? Math.max(3, (H - T - B) * v / max) : 0;
      if (h) {
        const r = Math.min(4, bw / 2, h);
        const y = H - B - h;
        add('path', { class: 'bar', d: `M${x},${H - B}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H - B}Z` });
      }
      if (i % every === 0 || i === series.length - 1) {
        const t = add('text', { x: x + bw / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle' });
        t.textContent = label(p.d);
      }
      const hit = add('rect', { x: L + i * step, y: T, width: step, height: H - T - B, class: 'hit' });
      hit.addEventListener('mouseenter', () => {
        tip.replaceChildren(el('strong', {}, label(p.d)), el('span', {}, money(v)), el('span', { class: 'sub' }, plural(p.n, 'commande payée', 'commandes payées')));
        tip.hidden = false;
        const pct = (L + i * step + step / 2) / W * 100;
        tip.style.left = Math.min(85, Math.max(15, pct)) + '%';
        hit.classList.add('on');
      });
      hit.addEventListener('mouseleave', () => { tip.hidden = true; hit.classList.remove('on'); });
    });
    const maxLabel = el('span', { class: 'sub' }, 'Maximum : ' + money(max) + ' · total : ' + money(total));
    const rows = series.filter(p => Number(p.revenue)).map(p => el('tr', {}, el('td', {}, label(p.d)), el('td', {}, money(p.revenue)), el('td', {}, int(p.n))));
    const table = el('details', { class: 'chart-table' }, el('summary', {}, 'Voir les chiffres'),
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, [byMonth ? 'Mois' : 'Jour', 'Montant', 'Commandes payées'].map(h => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, rows))));
    box.append(maxLabel, el('div', { class: 'chart-wrap' }, svg, tip), table);
    return box;
  }

  function latestOrders(res) {
    const box = el('section', { class: 'card' }, el('h3', {}, 'Dernières commandes'));
    if (res.error) { box.append(el('p', { class: 'sub' }, errText(res.error))); return box; }
    if (!res.data.length) { box.append(el('p', { class: 'sub' }, 'Aucune commande pour le moment.')); return box; }
    box.append(el('ul', { class: 'mini-list' }, res.data.map(o => el('li', {},
      el('div', {}, el('strong', { class: 'mono' }, o.reference), el('div', { class: 'sub' }, o.customer_name + ' · ' + fmtDate(o.created_at))),
      el('div', { class: 'mini-right' },
        el('span', {}, o.kind === 'test' ? 'Test gratuit' : money(o.total_dt)),
        o.kind === 'test' ? '' : el('span', { class: 'badge pay-' + o.payment_status }, PAY[o.payment_status]))))),
      el('a', { class: 'link', href: '#/commandes' }, 'Toutes les commandes →'));
    return box;
  }

  function pendingReviews(res) {
    const box = el('section', { class: 'card' }, el('h3', {}, 'Avis en attente'));
    if (res.error) { box.append(el('p', { class: 'sub' }, errText(res.error))); return box; }
    if (!res.data.length) { box.append(el('p', { class: 'sub' }, 'Aucun avis à modérer.')); return box; }
    box.append(el('ul', { class: 'mini-list' }, res.data.map(f => el('li', {},
      el('div', {}, el('strong', {}, f.author_name), el('div', { class: 'sub' }, f.message ? '« ' + (f.message.length > 90 ? f.message.slice(0, 90) + '…' : f.message) + ' »' : 'Pas de commentaire.')),
      el('div', { class: 'mini-right' }, el('span', { class: 'stars', 'aria-label': f.rating + ' sur 5' }, '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating)))))),
      el('a', { class: 'link', href: '#/avis' }, 'Modérer les avis →'));
    return box;
  }

  registerRoute('dashboard', { title: 'Tableau de bord', lead: 'Commandes, chiffre d’affaires confirmé, invitations et avis.', render });
})();
