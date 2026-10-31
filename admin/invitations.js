// Farha · back-office · étape 5 : invitations.
// L'admin publie, désactive ou réactive une invitation (colonne status uniquement, script 002).
// Aucune suppression : une invitation désactivée affiche « non disponible » à ses invités.
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, toast, confirm, fmtDate, registerRoute } = window.FarhaAdmin;

  const PAGE = 25;
  const STATUS = { draft: 'Brouillon', published: 'Publiée', disabled: 'Désactivée' };
  const FIELDS = { bride: 'Prénom 1', groom: 'Prénom 2', date: 'Date', time: 'Heure', place: 'Lieu', map: 'Lien Maps', message: 'Message', color: 'Couleur', music: 'Musique' };
  const state = { q: '', status: '', page: 0 };
  const linkOf = slug => location.origin + '/i/' + slug;
  const errText = e => /permission denied|row-level/i.test((e && e.message) || '') ? 'Action refusée : droits insuffisants.' : ((e && e.message) || String(e));
  const names = d => [d.bride, d.groom].filter(Boolean).join(' & ') || '—';

  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('Lien copié.', 'ok'), () => toast('Copie impossible : sélectionnez le lien.', 'error'));
  }

  async function render(box) {
    const fromHash = (window.FarhaAdmin.hash().match(/[?&]q=([^&]+)/) || [])[1];
    if (fromHash) state.q = decodeURIComponent(fromHash);
    const search = el('input', { type: 'search', placeholder: 'Lien, prénoms, référence de commande', 'aria-label': 'Rechercher une invitation', value: state.q });
    const status = el('select', { 'aria-label': 'Statut' }, el('option', { value: '' }, 'Tous statuts'),
      Object.entries(STATUS).map(([k, v]) => el('option', { value: k }, v)));
    status.value = state.status;
    const list = el('div', {});
    box.append(el('p', { class: 'note' }, 'Seules les invitations « Publiée » s’affichent à leurs invités. Les anciens liens longs (#i=…) créés avant cette étape ne peuvent pas être désactivés.'),
      el('div', { class: 'toolbar' }, search, status), list);
    let timer = null;
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; state.page = 0; load(list); }, 300); };
    status.onchange = () => { state.status = status.value; state.page = 0; load(list); };
    load(list);
  }

  async function load(list) {
    list.replaceChildren(el('p', { class: 'lead' }, 'Chargement…'));
    let q = db.from('invitations')
      .select('id,slug,status,data,created_at,published_at,template:templates(name),order:orders(reference,payment_status,kind)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(state.page * PAGE, state.page * PAGE + PAGE - 1);
    const term = state.q.trim().replace(/[,()*%\\]/g, ' ').trim();
    if (term) {
      if (/^FAR-/i.test(term)) {
        const o = await db.from('orders').select('id').ilike('reference', term + '%').limit(20);
        q = q.in('order_id', (o.data || []).map(x => x.id).concat(['00000000-0000-0000-0000-000000000000']));
      } else {
        q = q.or(['slug.ilike.*' + term + '*', 'data->>bride.ilike.*' + term + '*', 'data->>groom.ilike.*' + term + '*'].join(','));
      }
    }
    if (state.status) q = q.eq('status', state.status);
    const { data, error, count } = await q;
    if (error) { list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), errText(error))); return; }
    if (!data.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Aucune invitation'),
        term || state.status ? 'Aucune invitation ne correspond à ces filtres.' : 'Les invitations créées sur le site apparaîtront ici.'));
      return;
    }
    const rows = data.map(inv => {
      const actions = el('div', { class: 'row-actions' });
      const view = el('button', { type: 'button', class: 'btn ghost sm' }, 'Détails');
      view.onclick = () => detail(inv, () => load(list));
      actions.append(view);
      if (inv.status !== 'published') actions.append(statusBtn(inv, 'published', inv.status === 'draft' ? 'Publier' : 'Réactiver', list));
      if (inv.status === 'published') actions.append(statusBtn(inv, 'disabled', 'Désactiver', list));
      const cp = el('button', { type: 'button', class: 'btn ghost sm' }, 'Copier le lien');
      cp.onclick = () => copy(linkOf(inv.slug));
      actions.append(cp);
      return el('tr', {},
        el('td', {}, el('strong', {}, names(inv.data || {})), el('div', { class: 'sub mono' }, '/i/' + inv.slug)),
        el('td', {}, (inv.template || {}).name || '—', el('div', { class: 'sub' }, (inv.data || {}).date || '')),
        el('td', {}, inv.order ? el('span', { class: 'mono' }, inv.order.reference) : '—',
          inv.order ? el('div', { class: 'sub' }, inv.order.kind === 'test' ? 'test gratuit' : inv.order.payment_status === 'paid' ? 'payée' : 'non payée') : ''),
        el('td', {}, el('span', { class: 'badge inv-' + inv.status }, STATUS[inv.status]),
          el('div', { class: 'sub' }, inv.published_at ? 'publiée le ' + fmtDate(inv.published_at) : 'créée le ' + fmtDate(inv.created_at))),
        el('td', {}, actions));
    });
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const prev = el('button', { type: 'button', class: 'btn ghost sm' }, '‹ Précédente');
    const next = el('button', { type: 'button', class: 'btn ghost sm' }, 'Suivante ›');
    prev.disabled = state.page === 0; next.disabled = state.page >= pages - 1;
    prev.onclick = () => { state.page--; load(list); };
    next.onclick = () => { state.page++; load(list); };
    list.replaceChildren(
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Invitation', 'Modèle', 'Commande', 'Statut', 'Actions'].map(h => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, rows))),
      el('div', { class: 'pager' }, prev, el('span', { class: 'sub' }, count + ' invitation' + (count > 1 ? 's' : '') + ' · page ' + (state.page + 1) + ' / ' + pages), next));
  }

  function statusBtn(inv, to, label, list) {
    const b = el('button', { type: 'button', class: 'btn sm ' + (to === 'disabled' ? 'ghost warn' : 'primary') }, label);
    b.onclick = async () => {
      const who = names(inv.data || {});
      let text = to === 'disabled'
        ? `L’invitation de ${who} ne s’affichera plus : ses invités verront « invitation non disponible ». Vous pourrez la réactiver.`
        : `L’invitation de ${who} sera visible par toute personne ayant le lien ${linkOf(inv.slug)}.`;
      if (to === 'published' && inv.order && inv.order.kind !== 'test' && inv.order.payment_status !== 'paid') text += ' Attention : la commande liée n’est pas encore payée.';
      if (!(await confirm(label + ' cette invitation ?', text, label))) return;
      const { error } = await db.from('invitations').update({ status: to }).eq('id', inv.id);
      if (error) { toast(errText(error), 'error'); return; }
      toast('Invitation ' + STATUS[to].toLowerCase() + '.', 'ok');
      if (to === 'published') copy(linkOf(inv.slug));
      load(list);
    };
    return b;
  }

  function detail(inv, onChange) {
    const d = inv.data || {};
    const link = el('input', { readonly: '', value: linkOf(inv.slug), 'aria-label': 'Lien public' });
    const cp = el('button', { type: 'button', class: 'btn ghost sm' }, 'Copier');
    cp.onclick = () => copy(link.value);
    const open = el('a', { class: 'btn ghost sm', href: link.value, target: '_blank', rel: 'noopener' }, 'Ouvrir ↗');
    const close = el('button', { type: 'button', class: 'btn ghost' }, 'Fermer');
    const body = el('div', { class: 'sheet-form' },
      el('div', { class: 'sheet-head' }, el('h2', {}, names(d)), el('span', { class: 'badge inv-' + inv.status }, STATUS[inv.status])),
      el('label', {}, 'Lien public', el('div', { class: 'inline' }, link, cp, open)),
      inv.status !== 'published' ? el('p', { class: 'sub' }, 'Tant qu’elle n’est pas publiée, ce lien affiche « invitation non disponible ».') : '',
      el('dl', { class: 'kv' },
        el('dt', {}, 'Modèle'), el('dd', {}, (inv.template || {}).name || '—'),
        el('dt', {}, 'Commande'), el('dd', {}, inv.order ? inv.order.reference : '—'),
        el('dt', {}, 'Créée le'), el('dd', {}, fmtDate(inv.created_at)),
        el('dt', {}, 'Publiée le'), el('dd', {}, fmtDate(inv.published_at)),
        Object.entries(FIELDS).filter(([k]) => d[k]).flatMap(([k, label]) => [el('dt', {}, label), el('dd', {}, String(d[k]))])),
      el('div', { class: 'actions' }, close));
    const dlg = el('dialog', { class: 'sheet' }, body);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    close.onclick = () => dlg.close();
    dlg.showModal();
  }

  registerRoute('invitations', { title: 'Invitations', lead: 'Liens publics uniques, brouillons, publiées et désactivées.', render });
})();
