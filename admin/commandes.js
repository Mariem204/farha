// Farha · back-office · étape 4 : commandes.
// L'admin consulte les commandes et change uniquement les statuts, le moyen de paiement et les notes
// (privilèges par colonne, script 002). Chaque changement est écrit au journal par la base.
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, toast, confirm, fmtDate, registerRoute } = window.FarhaAdmin;

  const PAGE = 25;
  const KIND = { template: 'Modèle', sur_mesure: 'Sur mesure', test: 'Test gratuit' };
  const PAY = { unpaid: 'Non payée', pending: 'En attente', paid: 'Payée', failed: 'Échouée', refunded: 'Remboursée' };
  const PROC = { new: 'Nouvelle', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée' };
  const PROC_FILTER = Object.assign({ todo: 'À traiter (nouvelles et en cours)' }, PROC);
  const METHODS = { d17: 'D17', virement: 'Virement', especes: 'Espèces', konnect: 'Konnect', flouci: 'Flouci', clictopay: 'ClicToPay', autre: 'Autre' };
  const DETAIL_LABELS = { modele: 'Modèle', bride: 'Prénom 1', groom: 'Prénom 2', date: 'Date', time: 'Heure', place: 'Lieu',
    map: 'Lien Maps', message: 'Message', color: 'Couleur', music: 'Musique', evenement: 'Événement', noms: 'Nom(s)',
    lieu: 'Lieu', reseaux: 'Réseaux sociaux', description: 'Description', autres: 'Autres détails' };
  const PERIODS = { all: 'Toute période', '7': '7 derniers jours', '30': '30 derniers jours', '90': '90 derniers jours' };

  const money = v => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' DT';
  const state = { q: '', pay: '', proc: '', kind: '', period: 'all', page: 0 };

  function select(options, value, label, empty) {
    const s = el('select', { 'aria-label': label },
      empty ? el('option', { value: '' }, empty) : [],
      Object.entries(options).map(([k, v]) => el('option', { value: k }, v)));
    s.value = value;
    return s;
  }
  const errText = e => /permission denied|row-level/i.test((e && e.message) || '') ? 'Action refusée : droits insuffisants.' : ((e && e.message) || String(e));

  // ---------- Liste ----------
  async function render(box) {
    // Filtres reçus du tableau de bord : #/commandes?pay=unpaid ou ?proc=todo
    const hash = new URLSearchParams((window.FarhaAdmin.hash().split('?')[1]) || '');
    if (hash.has('pay') || hash.has('proc')) {
      Object.assign(state, { q: '', kind: '', period: 'all', page: 0, pay: PAY[hash.get('pay')] ? hash.get('pay') : '', proc: PROC_FILTER[hash.get('proc')] ? hash.get('proc') : '' });
      history.replaceState(null, '', '#/commandes');
    }
    const search = el('input', { type: 'search', placeholder: 'Référence, nom, e-mail, téléphone', 'aria-label': 'Rechercher une commande', value: state.q });
    const pay = select(PAY, state.pay, 'Paiement', 'Tous paiements');
    const proc = select(PROC_FILTER, state.proc, 'Traitement', 'Tous traitements');
    const kind = select(KIND, state.kind, 'Type', 'Tous types');
    const period = select(PERIODS, state.period, 'Période');
    const list = el('div', {});
    box.append(el('div', { class: 'toolbar' }, search, pay, proc, kind, period), list);

    let timer = null;
    const reload = () => {
      Object.assign(state, { q: search.value, pay: pay.value, proc: proc.value, kind: kind.value, period: period.value });
      load(list);
    };
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { state.page = 0; reload(); }, 300); };
    [pay, proc, kind, period].forEach(s => { s.onchange = () => { state.page = 0; reload(); }; });
    reload();
  }

  async function load(list) {
    list.replaceChildren(el('p', { class: 'lead' }, 'Chargement…'));
    let q = db.from('orders')
      .select('id,reference,kind,customer_name,customer_email,customer_phone,total_dt,payment_status,processing_status,created_at,order_items(label)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(state.page * PAGE, state.page * PAGE + PAGE - 1);
    const term = state.q.trim().replace(/[,()*%\\]/g, ' ').trim();
    if (term) q = q.or(['reference', 'customer_name', 'customer_email', 'customer_phone'].map(c => c + '.ilike.*' + term + '*').join(','));
    if (state.pay) q = q.eq('payment_status', state.pay);
    if (state.proc === 'todo') q = q.in('processing_status', ['new', 'in_progress']);
    else if (state.proc) q = q.eq('processing_status', state.proc);
    if (state.kind) q = q.eq('kind', state.kind);
    if (state.period !== 'all') q = q.gte('created_at', new Date(Date.now() - Number(state.period) * 864e5).toISOString());
    const { data, error, count } = await q;
    if (error) { list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), errText(error))); return; }
    if (!data.length) {
      const filtered = term || state.pay || state.proc || state.kind || state.period !== 'all';
      list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Aucune commande'),
        filtered ? 'Aucune commande ne correspond à ces filtres.' : 'Les commandes passées sur le site apparaîtront ici.'));
      return;
    }
    const rows = data.map(o => {
      const open = el('button', { type: 'button', class: 'btn ghost sm' }, 'Ouvrir');
      open.onclick = () => detail(o.id, () => load(list));
      return el('tr', {},
        el('td', {}, el('strong', { class: 'mono' }, o.reference), el('div', { class: 'sub' }, fmtDate(o.created_at))),
        el('td', {}, o.customer_name, el('div', { class: 'sub' }, o.customer_email)),
        el('td', {}, (o.order_items[0] || {}).label || '—', el('div', { class: 'sub' }, KIND[o.kind])),
        el('td', {}, money(o.total_dt)),
        el('td', {}, el('span', { class: 'badge pay-' + o.payment_status }, PAY[o.payment_status])),
        el('td', {}, el('span', { class: 'badge proc-' + o.processing_status }, PROC[o.processing_status])),
        el('td', {}, open));
    });
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const prev = el('button', { type: 'button', class: 'btn ghost sm' }, '‹ Précédente');
    const next = el('button', { type: 'button', class: 'btn ghost sm' }, 'Suivante ›');
    prev.disabled = state.page === 0; next.disabled = state.page >= pages - 1;
    prev.onclick = () => { state.page--; load(list); };
    next.onclick = () => { state.page++; load(list); };
    list.replaceChildren(
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Commande', 'Client', 'Modèle', 'Montant', 'Paiement', 'Traitement', ''].map(h => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, rows))),
      el('div', { class: 'pager' }, prev, el('span', { class: 'sub' }, count + ' commande' + (count > 1 ? 's' : '') + ' · page ' + (state.page + 1) + ' / ' + pages), next));
  }

  // ---------- Détail ----------
  async function detail(id, onChange) {
    const body = el('div', { class: 'sheet-form' }, el('p', { class: 'lead' }, 'Chargement…'));
    const dlg = el('dialog', { class: 'sheet wide' }, body);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();

    const [o, h, admins, inv] = await Promise.all([
      db.from('orders').select('*,order_items(label,unit_price_dt,quantity,details)').eq('id', id).single(),
      db.from('invitations').select('slug,status').eq('order_id', id).limit(1),
      db.from('audit_logs').select('id,actor_id,action,before,after,created_at').eq('entity', 'orders').eq('entity_id', id).order('id'),
      db.from('admin_users').select('user_id,email')
    ]);
    const invitation = ((inv && inv.data) || [])[0];
    if (o.error) { body.replaceChildren(el('p', { class: 'status error' }, errText(o.error))); return; }
    const order = o.data;
    const who = Object.fromEntries((admins.data || []).map(a => [a.user_id, a.email]));
    const close = el('button', { type: 'button', class: 'btn ghost' }, 'Fermer');
    close.onclick = () => dlg.close();

    async function save(patch, okText) {
      const { data, error } = await db.from('orders').update(patch).eq('id', id).select('*,order_items(label,unit_price_dt,quantity,details)').single();
      if (error) { toast(errText(error), 'error'); return false; }
      Object.assign(order, data);
      toast(okText, 'ok');
      onChange();
      dlg.close();
      detail(id, onChange);
      return true;
    }

    // Client
    const phone = order.customer_phone;
    const client = el('section', { class: 'card' }, el('h3', {}, 'Client'),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Nom'), el('dd', {}, order.customer_name),
        el('dt', {}, 'E-mail'), el('dd', {}, el('a', { href: 'mailto:' + order.customer_email }, order.customer_email)),
        el('dt', {}, 'Téléphone'), el('dd', {}, phone ? [el('a', { href: 'tel:' + phone.replace(/[^\d+]/g, '') }, phone), ' · ',
          el('a', { href: 'https://wa.me/' + phone.replace(/\D/g, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp')] : '—'),
        el('dt', {}, 'Adresse'), el('dd', {}, order.customer_address || '—')));

    // Contenu
    const items = order.order_items.map(it => el('div', { class: 'item' },
      el('p', {}, el('strong', {}, it.label), ' · ', money(it.unit_price_dt), it.quantity > 1 ? ' × ' + it.quantity : ''),
      el('dl', { class: 'kv' }, Object.entries(it.details || {}).filter(([, v]) => v).flatMap(([k, v]) =>
        [el('dt', {}, DETAIL_LABELS[k] || k), el('dd', {}, k === 'color' ? [el('span', { class: 'swatch', style: 'background:' + (/^#[0-9a-f]{6}$/i.test(v) ? v : '#fff') }), ' ', v] : v)]))));
    const INV = { draft: 'Brouillon', published: 'Publiée', disabled: 'Désactivée' };
    const invLine = invitation ? el('p', { class: 'sub' }, 'Invitation : ',
      el('a', { href: '#/invitations?q=' + encodeURIComponent(invitation.slug), onclick: 'this.closest("dialog").close()' }, '/i/' + invitation.slug),
      ' · ', el('span', { class: 'badge inv-' + invitation.status }, INV[invitation.status])) : '';
    const content = el('section', { class: 'card' }, el('h3', {}, 'Commande · ' + KIND[order.kind]), items.length ? items : el('p', { class: 'sub' }, 'Aucune ligne.'), invLine,
      el('p', { class: 'total' }, 'Total : ', el('strong', {}, money(order.total_dt))));

    // Paiement
    const method = select(METHODS, order.payment_method || 'd17', 'Moyen de paiement');
    const ref = el('input', { placeholder: 'Référence (facultatif)', maxlength: '120', value: order.payment_reference || '' });
    const payActions = el('div', { class: 'row-actions' });
    if (order.kind !== 'test' && order.payment_status !== 'paid') {
      const markPaid = el('button', { type: 'button', class: 'btn primary sm' }, 'Marquer comme payée');
      markPaid.onclick = async () => {
        if (!(await confirm('Marquer comme payée ?', `${order.reference} · ${money(order.total_dt)} réglée par ${METHODS[method.value]}. Le montant sera compté dans le chiffre d’affaires. L’action est inscrite au journal.`, 'Confirmer le paiement'))) return;
        save({ payment_status: 'paid', payment_method: method.value, payment_reference: ref.value.trim() || null }, 'Paiement enregistré.');
      };
      payActions.append(markPaid);
    }
    if (order.payment_status === 'paid') {
      const refund = el('button', { type: 'button', class: 'btn ghost sm warn' }, 'Marquer remboursée');
      refund.onclick = async () => {
        if (!(await confirm('Marquer comme remboursée ?', `${order.reference} sera retirée du chiffre d’affaires.`, 'Confirmer'))) return;
        save({ payment_status: 'refunded' }, 'Commande marquée remboursée.');
      };
      const undo = el('button', { type: 'button', class: 'btn ghost sm' }, 'Annuler le paiement');
      undo.onclick = async () => {
        if (!(await confirm('Annuler le paiement ?', `${order.reference} repassera en « Non payée » (erreur de saisie).`, 'Confirmer'))) return;
        save({ payment_status: 'unpaid', payment_method: null, payment_reference: null }, 'Paiement annulé.');
      };
      payActions.append(refund, undo);
    }
    const payment = el('section', { class: 'card' }, el('h3', {}, 'Paiement'),
      el('p', {}, el('span', { class: 'badge pay-' + order.payment_status }, PAY[order.payment_status]),
        order.paid_at ? el('span', { class: 'sub' }, '  le ' + fmtDate(order.paid_at) + ' · ' + (METHODS[order.payment_method] || '—') + (order.payment_reference ? ' · ' + order.payment_reference : '')) : ''),
      order.kind === 'test' ? el('p', { class: 'sub' }, 'Commande de test : hors chiffre d’affaires.')
        : order.payment_status !== 'paid' ? el('div', { class: 'grid2' }, el('label', {}, 'Moyen de paiement', method), el('label', {}, 'Référence', ref)) : '',
      payActions);

    // Traitement
    const proc = select(PROC, order.processing_status, 'Statut de traitement');
    const procSave = el('button', { type: 'button', class: 'btn primary sm' }, 'Enregistrer le statut');
    procSave.onclick = async () => {
      if (proc.value === order.processing_status) return;
      if (proc.value === 'cancelled' && !(await confirm('Annuler cette commande ?', `${order.reference} passera en « Annulée ». Rien n’est supprimé.`, 'Annuler la commande'))) return;
      save({ processing_status: proc.value }, 'Statut enregistré.');
    };
    const notes = el('textarea', { rows: '3', maxlength: '2000', placeholder: 'Notes internes (non visibles par le client)' }, order.admin_notes || '');
    const notesSave = el('button', { type: 'button', class: 'btn ghost sm' }, 'Enregistrer la note');
    notesSave.onclick = () => save({ admin_notes: notes.value.trim() || null }, 'Note enregistrée.');
    const processing = el('section', { class: 'card' }, el('h3', {}, 'Traitement'),
      el('div', { class: 'inline' }, proc, procSave), notes, el('div', { class: 'row-actions' }, notesSave));

    // Historique
    const TRACKED = { payment_status: ['Paiement', PAY], processing_status: ['Traitement', PROC], payment_method: ['Moyen', METHODS], admin_notes: ['Note', null] };
    const events = (h.data || []).map(l => {
      let text;
      if (l.action === 'insert') text = 'Commande créée';
      else {
        const changes = Object.entries(TRACKED).filter(([k]) => (l.before || {})[k] !== (l.after || {})[k]).map(([k, [label, map]]) => {
          const f = v => v == null ? '—' : map ? (map[v] || v) : 'modifiée';
          return label + ' : ' + (map ? f(l.before[k]) + ' → ' + f(l.after[k]) : 'modifiée');
        });
        if (!changes.length) return null;
        text = changes.join(' · ');
      }
      return el('li', {}, el('span', { class: 'sub' }, fmtDate(l.created_at) + ' · ' + (l.actor_id ? (who[l.actor_id] || 'admin') : 'site')), el('div', {}, text));
    }).filter(Boolean);
    const history = el('section', { class: 'card' }, el('h3', {}, 'Historique'),
      events.length ? el('ol', { class: 'timeline' }, events) : el('p', { class: 'sub' }, 'Aucun événement.'));

    body.replaceChildren(
      el('div', { class: 'sheet-head' }, el('h2', {}, order.reference), el('span', { class: 'sub' }, 'Reçue le ' + fmtDate(order.created_at))),
      el('div', { class: 'cards' }, client, content, payment, processing, history),
      el('div', { class: 'actions' }, close));
  }

  registerRoute('commandes', { title: 'Commandes', lead: 'Recherche, filtres, paiement et traitement séparés, historique.', render });
})();
