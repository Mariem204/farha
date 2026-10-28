// Farha · back-office · étape 5 : avis clients.
// Tout avis arrive « En attente » ; il n'apparaît sur l'accueil qu'une fois publié ici.
// Qui a modéré et quand : posé par la base (trigger feedbacks_moderation), inscrit au journal.
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, toast, confirm, fmtDate, registerRoute } = window.FarhaAdmin;

  const PAGE = 25;
  const STATUS = { pending: 'En attente', published: 'Publié', hidden: 'Masqué' };
  const state = { q: '', status: 'pending', rating: '', page: 0 };
  const errText = e => /permission denied|row-level/i.test((e && e.message) || '') ? 'Action refusée : droits insuffisants.' : ((e && e.message) || String(e));
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

  async function render(box) {
    const search = el('input', { type: 'search', placeholder: 'Nom, e-mail ou texte de l’avis', 'aria-label': 'Rechercher un avis', value: state.q });
    const status = el('select', { 'aria-label': 'Statut' }, el('option', { value: '' }, 'Tous statuts'),
      Object.entries(STATUS).map(([k, v]) => el('option', { value: k }, v)));
    status.value = state.status;
    const rating = el('select', { 'aria-label': 'Note' }, el('option', { value: '' }, 'Toutes notes'),
      [5, 4, 3, 2, 1].map(n => el('option', { value: String(n) }, stars(n))));
    rating.value = state.rating;
    const list = el('div', {});
    box.append(el('p', { class: 'note' }, 'Les avis publiés s’affichent dans la section « Ce que disent nos clients » de l’accueil (12 plus récents). Sans avis publié, la section est masquée.'),
      el('div', { class: 'toolbar' }, search, status, rating), list);
    let timer = null;
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; state.page = 0; load(list); }, 300); };
    status.onchange = () => { state.status = status.value; state.page = 0; load(list); };
    rating.onchange = () => { state.rating = rating.value; state.page = 0; load(list); };
    load(list);
  }

  async function load(list) {
    list.replaceChildren(el('p', { class: 'lead' }, 'Chargement…'));
    let q = db.from('feedbacks')
      .select('id,author_name,author_email,city,rating,tags,message,status,created_at,moderated_at,template:templates(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(state.page * PAGE, state.page * PAGE + PAGE - 1);
    const term = state.q.trim().replace(/[,()*%\\]/g, ' ').trim();
    if (term) q = q.or(['author_name', 'author_email', 'message'].map(c => c + '.ilike.*' + term + '*').join(','));
    if (state.status) q = q.eq('status', state.status);
    if (state.rating) q = q.eq('rating', Number(state.rating));
    const { data, error, count } = await q;
    if (error) { list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), errText(error))); return; }
    if (!data.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Aucun avis'),
        term || state.rating || state.status ? 'Aucun avis ne correspond à ces filtres.' : 'Les avis envoyés depuis le site apparaîtront ici.'));
      return;
    }
    const cards = data.map(f => {
      const actions = el('div', { class: 'row-actions' });
      if (f.status !== 'published') actions.append(act(f, 'Publier', 'btn primary sm', { status: 'published' },
        'Publier cet avis ?', `L’avis de ${f.author_name} apparaîtra sur la page d’accueil sous la forme « prénom + initiale du nom » (ex. « Amira B. »), avec la note, le texte et le modèle ; jamais l’e-mail.`, list));
      if (f.status !== 'hidden') actions.append(act(f, 'Masquer', 'btn ghost sm', { status: 'hidden' },
        'Masquer cet avis ?', `L’avis de ${f.author_name} ne sera plus affiché sur le site. Il reste dans l’admin.`, list));
      actions.append(del(f, list));
      return el('article', { class: 'review-admin' },
        el('div', { class: 'review-head' },
          el('span', { class: 'stars', 'aria-label': f.rating + ' sur 5' }, stars(f.rating)),
          el('strong', {}, f.author_name),
          el('span', { class: 'sub' }, [f.author_email, f.city, (f.template || {}).name, fmtDate(f.created_at)].filter(Boolean).join(' · ')),
          el('span', { class: 'badge fb-' + f.status }, STATUS[f.status])),
        f.message ? el('blockquote', {}, f.message) : el('p', { class: 'sub' }, 'Pas de commentaire.'),
        f.tags && f.tags.length ? el('div', { class: 'tags' }, f.tags.map(t => el('span', { class: 'badge' }, t))) : '',
        actions);
    });
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const prev = el('button', { type: 'button', class: 'btn ghost sm' }, '‹ Précédente');
    const next = el('button', { type: 'button', class: 'btn ghost sm' }, 'Suivante ›');
    prev.disabled = state.page === 0; next.disabled = state.page >= pages - 1;
    prev.onclick = () => { state.page--; load(list); };
    next.onclick = () => { state.page++; load(list); };
    list.replaceChildren(el('div', { class: 'review-list' }, cards),
      el('div', { class: 'pager' }, prev, el('span', { class: 'sub' }, count + ' avis · page ' + (state.page + 1) + ' / ' + pages), next));
  }

  function act(f, label, cls, patch, title, text, list) {
    const b = el('button', { type: 'button', class: cls }, label);
    b.onclick = async () => {
      if (!(await confirm(title, text, label))) return;
      const { error } = await db.from('feedbacks').update(patch).eq('id', f.id);
      if (error) { toast(errText(error), 'error'); return; }
      toast('Avis ' + STATUS[patch.status].toLowerCase() + '.', 'ok');
      load(list);
    };
    return b;
  }

  function del(f, list) {
    const b = el('button', { type: 'button', class: 'btn ghost sm warn' }, 'Supprimer');
    b.onclick = async () => {
      if (!(await confirm('Supprimer définitivement cet avis ?', `L’avis de ${f.author_name} sera effacé. Cette action est irréversible ; son contenu reste consigné dans le journal. Pour seulement le retirer du site, choisissez « Masquer ».`, 'Supprimer'))) return;
      const { error } = await db.from('feedbacks').delete().eq('id', f.id);
      if (error) { toast(errText(error), 'error'); return; }
      toast('Avis supprimé.', 'ok');
      load(list);
    };
    return b;
  }

  registerRoute('avis', { title: 'Avis clients', lead: 'Modération avant publication sur le site.', render });
})();
