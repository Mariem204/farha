// Farha · back-office · collections (table categories) : ajout, modification, suppression,
// photo de couverture et choix des modèles de chaque collection.
// Chaque modèle appartient à une seule collection : l'ajouter ici le retire de son ancienne collection.
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, toast, confirm, registerRoute } = window.FarhaAdmin;

  const BUCKET = 'template-previews';
  const MAX_IMAGE = 3 * 1024 * 1024;
  const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const money = v => v == null || v === '' ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' DT';

  const state = { templates: [], collections: [], legacy: false };

  const publicUrl = path => path ? db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
  const coverOf = c => c.cover_path ? publicUrl(c.cover_path) : c.cover_url || null;
  const byId = id => state.collections.find(c => c.id === id);
  const membersOf = id => state.templates.filter(t => t.category_id === id);
  const sortCollections = () => state.collections.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  function errText(error) {
    const m = (error && error.message) || String(error);
    if (/duplicate key|unique/i.test(m)) return 'Une collection porte déjà ce nom.';
    if (/foreign key|violates.*constraint.*templates/i.test(m)) return 'Des modèles utilisent encore cette collection.';
    if (/permission denied|row-level security/i.test(m)) return 'Action refusée : droits insuffisants (exécutez sql/012_collections.sql).';
    if (/violates check constraint/i.test(m)) return 'Valeur refusée par la base : vérifiez les champs (lien photo en https://…).';
    return m;
  }

  // ---------- Chargement ----------
  async function load() {
    const full = 'id,name,default_price_dt,sort_order,is_active,tagline,cover_url,cover_path,is_featured';
    const [t, c0] = await Promise.all([
      db.from('templates').select('id,name,slug,category_id,color,price_dt,preview_path,status,sort_order').order('sort_order').order('name'),
      db.from('categories').select(full).order('sort_order').order('name')
    ]);
    if (t.error) throw t.error;
    let c = c0;
    state.legacy = false;
    // Script 012 pas encore exécuté : on garde la gestion de base (nom, prix, ordre, modèles).
    if (c.error && /column .* does not exist|could not find/i.test(c.error.message || '')) {
      state.legacy = true;
      c = await db.from('categories').select('id,name,default_price_dt,sort_order,is_active').order('sort_order').order('name');
    }
    if (c.error) throw c.error;
    state.templates = t.data;
    state.collections = c.data;
  }

  // ---------- Page ----------
  async function render(box) {
    const area = el('div', {}, el('p', { class: 'lead' }, 'Chargement…'));
    box.append(area);
    try { await load(); } catch (e) {
      area.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), errText(e)));
      return;
    }
    draw(area);
  }

  function draw(area) {
    const add = el('button', { type: 'button', class: 'btn primary' }, '+ Nouvelle collection');
    add.onclick = () => collectionForm(null, area);
    const parts = [el('div', { class: 'toolbar' },
      el('p', { class: 'sub' }, 'Chaque collection devient une carte sur la page « Thèmes » du site. Une collection sans modèle actif n’y apparaît pas.'), add)];
    if (state.legacy) parts.push(el('p', { class: 'note' },
      'Phrase d’accroche, photo de couverture et badge seront disponibles après l’exécution de sql/012_collections.sql dans Supabase.'));
    parts.push(state.collections.length
      ? el('div', { class: 'coll-grid' }, state.collections.map(c => card(c, area)))
      : el('div', { class: 'empty' }, el('strong', {}, 'Aucune collection'), 'Créez une première collection.'));
    area.replaceChildren(...parts);
  }

  function card(c, area) {
    const members = membersOf(c.id).filter(t => t.status !== 'archived');
    const active = members.filter(t => t.status === 'active').length;
    const prices = members.map(t => t.price_dt != null ? Number(t.price_dt) : Number(c.default_price_dt));
    const cover = coverOf(c);
    const edit = el('button', { type: 'button', class: 'btn ghost sm' }, 'Modifier');
    edit.onclick = () => collectionForm(c, area);
    const toggle = el('button', { type: 'button', class: 'btn ghost sm' }, c.is_active ? 'Désactiver' : 'Activer');
    toggle.onclick = async () => {
      const text = c.is_active
        ? `La collection « ${c.name} » et ses modèles ne seront plus proposés sur le site. Rien n’est supprimé et les invitations publiées restent en ligne.`
        : `La collection « ${c.name} » sera de nouveau proposée sur le site.`;
      if (!(await confirm((c.is_active ? 'Désactiver' : 'Activer') + ' cette collection ?', text))) return;
      const { error } = await db.from('categories').update({ is_active: !c.is_active }).eq('id', c.id);
      if (error) { toast(errText(error), 'error'); return; }
      c.is_active = !c.is_active;
      toast('Collection enregistrée.', 'ok');
      draw(area);
    };
    const del = el('button', { type: 'button', class: 'btn ghost sm warn' }, 'Supprimer');
    del.onclick = () => deleteCollection(c, area);
    return el('article', { class: 'coll-card' },
      el('div', { class: 'coll-cover' },
        cover ? el('img', { src: cover, alt: '', loading: 'lazy' }) : el('span', { class: 'coll-empty' }, 'Pas de photo'),
        el('div', { class: 'coll-flags' },
          c.is_featured ? el('span', { class: 'badge coll-featured' }, 'La plus demandée') : '',
          el('span', { class: 'badge status-' + (c.is_active ? 'active' : 'inactive') }, c.is_active ? 'Active' : 'Inactive'))),
      el('div', { class: 'coll-info' },
        el('h3', {}, 'Collection ' + c.name),
        c.tagline ? el('p', { class: 'coll-tagline' }, c.tagline) : '',
        el('p', { class: 'sub' }, members.length + ' modèle' + (members.length > 1 ? 's' : '') + ' (' + active + ' actif' + (active > 1 ? 's' : '') + ')'
          + ' · dès ' + money(prices.length ? Math.min(...prices) : c.default_price_dt) + ' · ordre ' + c.sort_order),
        el('div', { class: 'row-actions' }, edit, toggle, del)));
  }

  // ---------- Formulaire ----------
  function collectionForm(c, area) {
    const isNew = !c;
    const f = el('form', { class: 'sheet-form', novalidate: '' });
    const name = el('input', { required: '', maxlength: '40', value: c ? c.name : '', placeholder: 'Mariage' });
    const tagline = el('input', { maxlength: '80', value: c && c.tagline || '', placeholder: 'Le grand jour, en majesté' });
    const price = el('input', { type: 'number', min: '0', step: '0.001', required: '', value: c ? String(Number(c.default_price_dt)) : '' });
    const sort = el('input', { type: 'number', step: '1', value: c ? String(c.sort_order) : String(state.collections.length + 1) });
    const featured = el('input', { type: 'checkbox' });
    featured.checked = !!(c && c.is_featured);

    // Photo de couverture : fichier déposé ou lien https.
    let removeCover = false;
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    const url = el('input', { type: 'url', maxlength: '500', placeholder: 'https://…', value: c && !c.cover_path && c.cover_url || '' });
    const preview = el('img', { class: 'coll-form-cover', alt: '' });
    const clear = el('button', { type: 'button', class: 'btn ghost sm' }, 'Retirer la photo');
    const showPreview = src => { preview.src = src || ''; preview.hidden = !src; clear.hidden = !src; };
    showPreview(c ? coverOf(c) : null);
    file.onchange = () => {
      const x = file.files[0];
      if (!x) return;
      if (!IMAGE_TYPES[x.type]) { toast('Format accepté : PNG, JPEG ou WebP.', 'error'); file.value = ''; return; }
      if (x.size > MAX_IMAGE) { toast('Image trop lourde : 3 Mo maximum.', 'error'); file.value = ''; return; }
      removeCover = false; url.value = ''; showPreview(URL.createObjectURL(x));
    };
    url.oninput = () => { if (/^https:\/\/\S+$/.test(url.value.trim())) { file.value = ''; removeCover = false; showPreview(url.value.trim()); } };
    clear.onclick = () => { removeCover = true; file.value = ''; url.value = ''; showPreview(null); };

    // Modèles de la collection : cocher = rattacher ; décocher un modèle déjà dedans = le déplacer ailleurs.
    const others = () => state.collections.filter(x => !c || x.id !== c.id);
    const picks = state.templates.filter(t => t.status !== 'archived').map(t => {
      const box = el('input', { type: 'checkbox', value: t.id });
      const inside = !!c && t.category_id === c.id;
      box.checked = inside;
      const from = byId(t.category_id);
      const move = el('select', { class: 'coll-move', 'aria-label': 'Déplacer « ' + t.name + ' » vers' },
        others().map(o => el('option', { value: o.id }, '→ ' + o.name)));
      move.hidden = true;
      box.onchange = () => { move.hidden = !(inside && !box.checked); };
      const thumb = t.preview_path ? el('img', { class: 'thumb', src: publicUrl(t.preview_path), alt: '' })
        : el('span', { class: 'thumb thumb-empty', style: 'background:' + t.color });
      const row = el('label', { class: 'coll-pick' }, box, thumb,
        el('span', { class: 'coll-pick-name' }, el('strong', {}, t.name),
          el('span', { class: 'sub' }, inside ? 'Dans cette collection' : from ? 'Actuellement : ' + from.name : 'Sans collection',
            t.status === 'inactive' ? ' · inactif' : '')),
        move);
      return { t, box, move, inside, row };
    });
    const filter = el('input', { type: 'search', placeholder: 'Filtrer les modèles', 'aria-label': 'Filtrer les modèles' });
    filter.oninput = () => { const q = filter.value.trim().toLowerCase(); picks.forEach(p => { p.row.hidden = !!q && !p.t.name.toLowerCase().includes(q); }); };

    const st = el('p', { class: 'status', role: 'status' });
    const save = el('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Créer la collection' : 'Enregistrer');
    const cancel = el('button', { type: 'button', class: 'btn ghost' }, 'Annuler');
    const extra = state.legacy ? [el('p', { class: 'note' }, 'Exécutez sql/012_collections.sql pour ajouter la phrase, la photo et le badge.')] : [
      el('label', {}, 'Phrase d’accroche', tagline, el('span', { class: 'hint' }, 'Affichée sous le titre : « 3 modèles · Le grand jour, en majesté ».')),
      el('fieldset', { class: 'coll-cover-field' }, el('legend', {}, 'Photo de couverture'),
        el('label', {}, 'Déposer une image (PNG, JPEG ou WebP, 3 Mo max.)', file),
        el('label', {}, 'ou coller un lien d’image', url),
        preview, el('div', { class: 'row-actions' }, clear)),
      el('label', { class: 'check' }, featured, 'Afficher le badge « La plus demandée »')];
    f.append(
      el('h2', {}, isNew ? 'Nouvelle collection' : 'Modifier « ' + c.name + ' »'),
      el('label', {}, 'Nom *', name, el('span', { class: 'hint' }, 'Affiché « Collection ' + (c ? c.name : 'Mariage') + ' » sur le site.')),
      el('div', { class: 'grid2' },
        el('label', {}, 'Prix par défaut (DT) *', price, el('span', { class: 'hint' }, 'Pour les modèles sans prix propre.')),
        el('label', {}, 'Ordre d’affichage', sort)),
      ...extra,
      el('fieldset', { class: 'coll-picks' }, el('legend', {}, 'Modèles de la collection'),
        el('p', { class: 'hint' }, 'Cochez les modèles à ranger dans cette collection. Un modèle n’est que dans une collection : le cocher le retire de l’ancienne. Pour retirer un modèle, choisissez où le déplacer.'),
        picks.length > 6 ? filter : '',
        picks.length ? el('div', { class: 'coll-pick-list' }, picks.map(p => p.row)) : el('p', { class: 'sub' }, 'Aucun modèle pour le moment.')),
      st, el('div', { class: 'actions' }, cancel, save));

    const dlg = el('dialog', { class: 'sheet' }, f);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    cancel.onclick = () => dlg.close();
    dlg.showModal();

    f.onsubmit = async e => {
      e.preventDefault();
      const fail = m => { st.textContent = m; st.className = 'status error'; save.disabled = false; };
      const n = name.value.trim();
      if (n.length < 2) return fail('Le nom doit contenir au moins 2 caractères.');
      if (price.value.trim() === '' || !(Number(price.value) >= 0)) return fail('Indiquez un prix valide.');
      const link = url.value.trim();
      if (link && !/^https:\/\/\S+$/.test(link)) return fail('Le lien de la photo doit commencer par https://');
      const leaving = picks.filter(p => p.inside && !p.box.checked);
      if (leaving.length && !others().length) return fail('Créez d’abord une autre collection pour y déplacer les modèles retirés.');

      save.disabled = true; st.textContent = 'Enregistrement…'; st.className = 'status';
      const row = { name: n, default_price_dt: Number(price.value), sort_order: parseInt(sort.value, 10) || 0 };
      let uploaded = null;
      if (!state.legacy) {
        row.tagline = tagline.value.trim() || null;
        row.is_featured = featured.checked;
        const img = file.files[0];
        if (img) {
          uploaded = 'collections/' + (slug(n) || 'collection') + '/' + Date.now() + '.' + IMAGE_TYPES[img.type];
          const up = await db.storage.from(BUCKET).upload(uploaded, img, { contentType: img.type, upsert: false, cacheControl: '31536000' });
          if (up.error) return fail('Photo non envoyée : ' + errText(up.error));
          row.cover_path = uploaded; row.cover_url = null;
        } else if (link) { row.cover_url = link; row.cover_path = null; }
        else if (removeCover) { row.cover_url = null; row.cover_path = null; }
      }
      const res = isNew
        ? await db.from('categories').insert(row).select().single()
        : await db.from('categories').update(row).eq('id', c.id).select().single();
      if (res.error) {
        if (uploaded) db.storage.from(BUCKET).remove([uploaded]);
        return fail(errText(res.error));
      }
      const saved = res.data;
      // Ancienne photo déposée devenue inutile.
      if (c && c.cover_path && c.cover_path !== saved.cover_path) db.storage.from(BUCKET).remove([c.cover_path]);

      // Rattachements des modèles.
      const joining = picks.filter(p => p.box.checked && p.t.category_id !== saved.id).map(p => p.t.id);
      const moves = {};
      leaving.forEach(p => { (moves[p.move.value] = moves[p.move.value] || []).push(p.t.id); });
      const ops = [];
      if (joining.length) ops.push([saved.id, joining]);
      Object.entries(moves).forEach(([to, ids]) => ops.push([to, ids]));
      for (const [to, ids] of ops) {
        const { error } = await db.from('templates').update({ category_id: to }).in('id', ids);
        if (error) { toast('Collection enregistrée, mais modèles non déplacés : ' + errText(error), 'error'); break; }
        state.templates.forEach(t => { if (ids.includes(t.id)) t.category_id = to; });
      }

      if (isNew) state.collections.push(saved); else Object.assign(c, saved);
      sortCollections();
      dlg.close();
      toast(isNew ? 'Collection créée.' : 'Collection enregistrée.', 'ok');
      draw(area);
    };
  }

  function slug(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }

  // ---------- Suppression ----------
  // Les modèles (y compris archivés) sont d'abord déplacés vers une autre collection, puis la collection est supprimée.
  function deleteCollection(c, area) {
    const members = membersOf(c.id);
    const others = state.collections.filter(x => x.id !== c.id);
    if (members.length && !others.length) { toast('Créez d’abord une autre collection pour y déplacer ses modèles.', 'error'); return; }
    const target = el('select', { 'aria-label': 'Déplacer les modèles vers' }, others.map(o => el('option', { value: o.id }, o.name)));
    const st = el('p', { class: 'status', role: 'status' });
    const ok = el('button', { type: 'submit', class: 'btn danger' }, 'Supprimer la collection');
    const cancel = el('button', { type: 'button', class: 'btn ghost' }, 'Annuler');
    const f = el('form', { class: 'sheet-form' },
      el('h2', {}, 'Supprimer « ' + c.name + ' » ?'),
      el('p', {}, 'La collection sera supprimée définitivement. Les invitations déjà publiées restent en ligne.'),
      members.length ? el('label', {}, 'Ses ' + members.length + ' modèle' + (members.length > 1 ? 's seront déplacés' : ' sera déplacé') + ' vers', target) : '',
      st, el('div', { class: 'actions' }, cancel, ok));
    const dlg = el('dialog', { class: 'sheet' }, f);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    cancel.onclick = () => dlg.close();
    dlg.showModal();
    f.onsubmit = async e => {
      e.preventDefault();
      ok.disabled = true; st.textContent = 'Suppression…'; st.className = 'status';
      if (members.length) {
        const { error } = await db.from('templates').update({ category_id: target.value }).eq('category_id', c.id);
        if (error) { ok.disabled = false; st.textContent = errText(error); st.className = 'status error'; return; }
        members.forEach(t => { t.category_id = target.value; });
      }
      const { error } = await db.from('categories').delete().eq('id', c.id);
      if (error) { ok.disabled = false; st.textContent = errText(error); st.className = 'status error'; return; }
      if (c.cover_path) db.storage.from(BUCKET).remove([c.cover_path]);
      state.collections = state.collections.filter(x => x !== c);
      dlg.close();
      toast('Collection « ' + c.name + ' » supprimée.', 'ok');
      draw(area);
    };
  }

  registerRoute('collections', { title: 'Collections', lead: 'Les cartes de la page « Thèmes » : nom, photo, phrase, badge et modèles de chaque collection.', render });
})();
