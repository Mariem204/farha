// Farha · back-office · étape 2 : modèles et catégories.
// Lecture et écriture directes dans Supabase ; RLS et privilèges par colonne
// (scripts 002 et 006) refusent toute action d'un compte non administrateur.
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, toast, confirm, registerRoute } = window.FarhaAdmin;

  const BUCKET = 'template-previews';
  const MAX_IMAGE = 2 * 1024 * 1024;
  const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const MAX_HTML = 1024 * 1024;
  // Moteurs de rendu existants dans le code du site (champ « base » de la v19).
  const RENDERERS = {
    royal: 'Royal · romance classique',
    editorial: 'Éditorial · moderne',
    lake: 'Lake Como · enveloppe interactive',
    sidi: 'Sidi Bou Saïd · portes bleues',
    sarah: 'Jardin des Oliviers · pétales'
  };
  const STATUS = { active: 'Actif', inactive: 'Inactif', archived: 'Archivé' };
  const money = v => v == null || v === '' ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' DT';

  const state = { tab: 'modeles', q: '', cat: '', status: 'current', templates: [], categories: [] };

  function previewUrl(path) {
    return path ? db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
  }
  function errText(error) {
    const m = (error && error.message) || String(error);
    if (/duplicate key|unique/i.test(m)) return 'Ce nom ou cet identifiant existe déjà.';
    if (/permission denied|row-level security/i.test(m)) return 'Action refusée : droits insuffisants.';
    if (/violates check constraint/i.test(m)) return 'Valeur refusée par la base : vérifiez les champs.';
    return m;
  }

  // ---------- Chargement ----------
  async function load() {
    const [t, c] = await Promise.all([
      db.from('templates').select('id,slug,name,description,category_id,renderer,color,price_dt,preview_path,status,sort_order,updated_at')
        .order('sort_order').order('name'),
      db.from('categories').select('id,name,default_price_dt,sort_order,is_active').order('sort_order').order('name')
    ]);
    if (t.error || c.error) throw (t.error || c.error);
    state.templates = t.data;
    state.categories = c.data;
  }
  const catById = id => state.categories.find(c => c.id === id);
  const effectivePrice = t => t.price_dt != null ? Number(t.price_dt) : Number((catById(t.category_id) || {}).default_price_dt);

  // ---------- Page ----------
  async function render(box) {
    const tabs = el('div', { class: 'tabs', role: 'tablist' },
      tabBtn('modeles', 'Modèles'), tabBtn('categories', 'Catégories'));
    const note = el('p', { class: 'note' },
      'Les modifications sont enregistrées immédiatement. Elles apparaîtront sur le site public après l’étape 3 (synchronisation du catalogue).');
    const area = el('div', {}, el('p', { class: 'lead' }, 'Chargement…'));
    box.append(tabs, note, area);
    try { await load(); } catch (e) {
      area.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), errText(e)));
      return;
    }
    draw(area);

    function tabBtn(key, label) {
      const b = el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(state.tab === key) }, label);
      b.onclick = () => { state.tab = key; tabs.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === b))); draw(area); };
      return b;
    }
  }

  function draw(area) {
    area.replaceChildren(state.tab === 'modeles' ? templatesView(area) : categoriesView(area));
  }

  // ---------- Modèles ----------
  function templatesView(area) {
    const wrap = el('div', {});
    const search = el('input', { type: 'search', placeholder: 'Rechercher un modèle', 'aria-label': 'Rechercher un modèle', value: state.q });
    const cat = el('select', { 'aria-label': 'Catégorie' }, el('option', { value: '' }, 'Toutes les catégories'),
      state.categories.map(c => el('option', { value: c.id }, c.name)));
    cat.value = state.cat;
    const status = el('select', { 'aria-label': 'Statut' },
      el('option', { value: 'current' }, 'Actifs et inactifs'), el('option', { value: 'active' }, 'Actifs'),
      el('option', { value: 'inactive' }, 'Inactifs'), el('option', { value: 'archived' }, 'Archivés'),
      el('option', { value: 'all' }, 'Tous'));
    status.value = state.status;
    const add = el('button', { type: 'button', class: 'btn primary' }, '+ Nouveau modèle');
    add.onclick = () => templateForm(null, area);
    const list = el('div', {});
    wrap.append(el('div', { class: 'toolbar' }, search, cat, status, add), list);

    const refresh = () => {
      state.q = search.value; state.cat = cat.value; state.status = status.value;
      const q = state.q.trim().toLowerCase();
      const rows = state.templates.filter(t =>
        (!q || (t.name + ' ' + t.slug + ' ' + (catById(t.category_id) || {}).name).toLowerCase().includes(q)) &&
        (!state.cat || t.category_id === state.cat) &&
        (state.status === 'all' || (state.status === 'current' ? t.status !== 'archived' : t.status === state.status)));
      list.replaceChildren(rows.length ? templatesTable(rows, area)
        : el('div', { class: 'empty' }, el('strong', {}, 'Aucun modèle'), 'Aucun modèle ne correspond à ces filtres.'));
    };
    search.oninput = refresh; cat.onchange = refresh; status.onchange = refresh;
    refresh();
    return wrap;
  }

  function templatesTable(rows, area) {
    const tr = t => {
      const c = catById(t.category_id) || {};
      const img = previewUrl(t.preview_path);
      const actions = el('div', { class: 'row-actions' });
      const edit = el('button', { type: 'button', class: 'btn ghost sm' }, 'Modifier');
      edit.onclick = () => templateForm(t, area);
      actions.append(edit);
      if (t.status === 'active') actions.append(statusBtn(t, 'inactive', 'Désactiver', area));
      if (t.status === 'inactive') actions.append(statusBtn(t, 'active', 'Activer', area));
      // Archivage désactivé : seuls les modèles déjà archivés peuvent être restaurés.
      if (t.status === 'archived') actions.append(statusBtn(t, 'inactive', 'Restaurer', area));
      return el('tr', {},
        el('td', {}, img ? el('img', { class: 'thumb', src: img, alt: '' })
          : el('span', { class: 'thumb thumb-empty', style: 'background:' + t.color, title: 'Image intégrée au site' })),
        el('td', {}, el('strong', {}, t.name), el('div', { class: 'sub mono' }, t.slug)),
        el('td', {}, c.name || '—'),
        el('td', {}, money(effectivePrice(t)), t.price_dt == null ? el('div', { class: 'sub' }, 'prix de la catégorie') : ''),
        el('td', {}, el('span', { class: 'badge status-' + t.status }, STATUS[t.status])),
        el('td', {}, actions));
    };
    return el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Aperçu', 'Modèle', 'Catégorie', 'Prix', 'Statut', 'Actions'].map(h => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows.map(tr))));
  }

  function statusBtn(t, to, label, area) {
    const b = el('button', { type: 'button', class: 'btn ghost sm' + (to === 'archived' ? ' warn' : '') }, label);
    b.onclick = async () => {
      const texts = {
        inactive: t.status === 'archived'
          ? `« ${t.name} » repassera dans la liste des modèles, toujours masqué du catalogue.`
          : `« ${t.name} » ne sera plus proposé dans le catalogue. Les invitations déjà publiées avec ce modèle restent en ligne.`,
        active: `« ${t.name} » sera de nouveau proposé dans le catalogue.`,
        archived: `« ${t.name} » sera retiré du catalogue et rangé dans les archives. Rien n’est supprimé et les invitations publiées restent en ligne.`
      };
      if (!(await confirm(label + ' ce modèle ?', texts[to], label))) return;
      const { error } = await db.from('templates').update({ status: to }).eq('id', t.id);
      if (error) { toast(errText(error), 'error'); return; }
      t.status = to;
      toast('Modèle « ' + t.name + ' » : ' + STATUS[to].toLowerCase() + '.', 'ok');
      draw(area);
    };
    return b;
  }

  // Aperçu du code HTML dans un téléphone, comme sur le site. Le code tourne dans une iframe
  // isolée (sandbox sans allow-same-origin) : il n'a accès ni à la session ni à Supabase.
  // Résout true si l'admin confirme, false s'il revient au formulaire.
  function phonePreview(html, title, confirmLabel) {
    return new Promise(resolve => {
      const frame = el('iframe', { title: 'Aperçu mobile', sandbox: 'allow-scripts allow-popups', allow: 'autoplay' });
      frame.srcdoc = html;
      const replay = el('button', { type: 'button', class: 'btn ghost sm' }, '↻ Rejouer');
      replay.onclick = () => { frame.srcdoc = html + '\n<!-- ' + Date.now() + ' -->'; };
      const back = el('button', { type: 'button', class: 'btn ghost' }, confirmLabel ? 'Retour au formulaire' : 'Fermer');
      const ok = confirmLabel ? el('button', { type: 'button', class: 'btn primary' }, confirmLabel) : null;
      let result = false;
      const dlg = el('dialog', { class: 'sheet phone-sheet' }, el('div', { class: 'sheet-form' },
        el('div', { class: 'sheet-head' }, el('h2', {}, 'Aperçu · ' + title), replay),
        el('p', { class: 'sub' }, 'Faites défiler l’écran du téléphone pour vérifier tout le modèle.'),
        el('div', { class: 'iphone-device' }, el('span', { class: 'iphone-island' }), frame, el('span', { class: 'iphone-home' })),
        el('div', { class: 'actions' }, back, ok || [])));
      document.body.append(dlg);
      dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
      back.onclick = () => dlg.close();
      if (ok) ok.onclick = () => { result = true; dlg.close(); };
      dlg.showModal();
    });
  }

  function slugify(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }

  function templateForm(t, area) {
    const isNew = !t;
    const f = el('form', { class: 'sheet-form', novalidate: '' });
    const name = el('input', { name: 'name', required: '', maxlength: '120', value: t ? t.name : '' });
    const slug = el('input', { name: 'slug', required: '', maxlength: '40', pattern: '[a-z0-9-]{2,40}', value: t ? t.slug : '' });
    if (!isNew) slug.disabled = true;
    else name.oninput = () => { if (!slug.dataset.touched) slug.value = slugify(name.value); };
    slug.oninput = () => { slug.dataset.touched = '1'; };
    const desc = el('textarea', { name: 'description', maxlength: '300', rows: '2' }, t ? t.description || '' : '');
    const cat = el('select', { name: 'category_id', required: '' }, el('option', { value: '' }, 'Choisir…'),
      state.categories.map(c => el('option', { value: c.id }, c.name + (c.is_active ? '' : ' (inactive)'))));
    cat.value = t ? t.category_id : '';
    const renderer = el('select', { name: 'renderer', required: '' },
      Object.entries(RENDERERS).map(([k, v]) => el('option', { value: k }, v)));
    renderer.value = t ? t.renderer : 'royal';
    if (!isNew) renderer.disabled = true;
    const color = el('input', { name: 'color', type: 'color', value: t ? t.color : '#b48a43' });
    const price = el('input', { name: 'price', type: 'number', min: '0', step: '0.001', inputmode: 'decimal',
      placeholder: 'Prix de la catégorie', value: t && t.price_dt != null ? String(Number(t.price_dt)) : '' });
    const sort = el('input', { name: 'sort', type: 'number', step: '1', value: t ? String(t.sort_order) : String(state.templates.length + 1) });
    const status = el('select', { name: 'status' }, Object.entries(STATUS)
      .filter(([k]) => k !== 'archived' || (t && t.status === 'archived'))
      .map(([k, v]) => el('option', { value: k }, v)));
    status.value = t ? t.status : 'inactive';
    const file = el('input', { name: 'image', type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    const current = t && previewUrl(t.preview_path);
    const preview = el('img', { class: 'form-preview', alt: '', src: current || '' });
    preview.hidden = !current;
    file.onchange = () => {
      const x = file.files[0];
      if (!x) return;
      if (!IMAGE_TYPES[x.type]) { toast('Format accepté : PNG, JPEG ou WebP.', 'error'); file.value = ''; return; }
      if (x.size > MAX_IMAGE) { toast('Image trop lourde : 2 Mo maximum.', 'error'); file.value = ''; return; }
      preview.src = URL.createObjectURL(x); preview.hidden = false;
    };
    // Code HTML du modèle (page complète de l'invitation).
    const html = el('textarea', { name: 'html', rows: '10', spellcheck: 'false', class: 'code',
      placeholder: '<!doctype html>\n<html>…</html>' });
    let htmlInitial = '';
    if (!isNew) {
      html.disabled = true; html.placeholder = 'Chargement…';
      db.from('templates').select('html').eq('id', t.id).single().then(({ data, error }) => {
        html.disabled = false; html.placeholder = '<!doctype html>\n<html>…</html>';
        if (!error && data && data.html) html.value = htmlInitial = data.html;
      });
    }
    const htmlFile = el('input', { type: 'file', accept: '.html,.htm,text/html' });
    htmlFile.onchange = async () => {
      const x = htmlFile.files[0];
      if (!x) return;
      if (x.size > MAX_HTML) { toast('Fichier trop lourd : 1 Mo maximum.', 'error'); htmlFile.value = ''; return; }
      html.value = await x.text();
      htmlFile.value = '';
    };
    const showHtml = el('button', { type: 'button', class: 'btn ghost sm' }, 'Voir l’aperçu téléphone');
    showHtml.onclick = () => {
      if (!html.value.trim()) { toast('Collez ou importez d’abord le code HTML.', 'error'); return; }
      phonePreview(html.value, name.value.trim() || 'nouveau modèle');
    };

    const st = el('p', { class: 'status', role: 'status' });
    const save = el('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Créer le modèle' : 'Enregistrer');
    const cancel = el('button', { type: 'button', class: 'btn ghost' }, 'Annuler');

    f.append(
      el('h2', {}, isNew ? 'Nouveau modèle' : 'Modifier « ' + t.name + ' »'),
      el('label', {}, 'Nom affiché *', name),
      el('label', {}, 'Identifiant (lettres minuscules, chiffres, tirets) *', slug,
        el('span', { class: 'hint' }, isNew ? 'Ne pourra plus être modifié.' : 'Fixé à la création.')),
      el('label', {}, 'Description courte', desc),
      el('div', { class: 'grid2' },
        el('label', {}, 'Catégorie *', cat),
        el('label', {}, 'Mise en page *', renderer,
          el('span', { class: 'hint' }, isNew ? 'Reprend une mise en page existante du site.' : 'Fixée à la création.'))),
      el('div', { class: 'grid3' },
        el('label', {}, 'Prix (DT)', price, el('span', { class: 'hint' }, 'Vide = prix de la catégorie')),
        el('label', {}, 'Couleur', color),
        el('label', {}, 'Ordre', sort)),
      el('label', {}, 'Statut', status),
      el('label', {}, 'Code HTML du modèle' + (isNew ? ' *' : ''), html,
        el('span', { class: 'hint' }, 'Collez le code complet de la page, ou importez un fichier .html (1 Mo max.). Un aperçu téléphone s’affiche avant la confirmation.')),
      el('div', { class: 'row-actions' }, el('label', { class: 'file-inline' }, 'Importer un fichier .html', htmlFile), showHtml),
      el('label', {}, 'Image d’aperçu (PNG, JPEG ou WebP, 2 Mo max.)', file, preview),
      st,
      el('div', { class: 'actions' }, cancel, save));

    const dlg = el('dialog', { class: 'sheet' }, f);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    cancel.onclick = () => dlg.close();
    dlg.showModal();

    f.onsubmit = async e => {
      e.preventDefault();
      const fail = m => { st.textContent = m; st.className = 'status error'; };
      const n = name.value.trim(), s = slug.value.trim();
      if (n.length < 2) return fail('Le nom doit contenir au moins 2 caractères.');
      if (isNew && !/^[a-z0-9-]{2,40}$/.test(s)) return fail('Identifiant : 2 à 40 caractères, minuscules, chiffres ou tirets.');
      if (!cat.value) return fail('Choisissez une catégorie.');
      const p = price.value.trim();
      if (p !== '' && !(Number(p) >= 0)) return fail('Prix invalide.');
      const code = html.value.trim();
      if (isNew && !code) return fail('Ajoutez le code HTML du modèle.');
      if (code && !/<(html|body|div|section|main)\b/i.test(code)) return fail('Le code HTML ne semble pas valide.');
      if (new Blob([code]).size > MAX_HTML) return fail('Code HTML trop lourd : 1 Mo maximum.');
      const htmlChanged = code !== htmlInitial.trim();
      if (code && (isNew || htmlChanged)) {
        st.textContent = ''; st.className = 'status';
        if (!(await phonePreview(code, n, isNew ? 'Confirmer la création' : 'Confirmer l’enregistrement'))) return;
      }
      save.disabled = true; st.textContent = 'Enregistrement…'; st.className = 'status';

      const row = {
        name: n, description: desc.value.trim() || null, category_id: cat.value, color: color.value,
        price_dt: p === '' ? null : Number(p), sort_order: parseInt(sort.value, 10) || 0, status: status.value
      };
      if (isNew || htmlChanged) row.html = code || null;
      const img = file.files[0];
      if (img) {
        const path = (isNew ? s : t.slug) + '/' + Date.now() + '.' + IMAGE_TYPES[img.type];
        const up = await db.storage.from(BUCKET).upload(path, img, { contentType: img.type, upsert: false, cacheControl: '31536000' });
        if (up.error) { save.disabled = false; return fail('Image non envoyée : ' + errText(up.error)); }
        row.preview_path = path;
      }
      const res = isNew
        ? await db.from('templates').insert(Object.assign({ slug: s, renderer: renderer.value }, row)).select().single()
        : await db.from('templates').update(row).eq('id', t.id).select().single();
      save.disabled = false;
      if (res.error) return fail(errText(res.error));
      if (isNew) state.templates.push(res.data); else Object.assign(t, res.data);
      state.templates.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      dlg.close();
      toast(isNew ? 'Modèle créé.' : 'Modèle enregistré.', 'ok');
      draw(area);
    };
  }

  // ---------- Catégories ----------
  function categoriesView(area) {
    const add = el('button', { type: 'button', class: 'btn primary' }, '+ Nouvelle catégorie');
    add.onclick = () => categoryForm(null, area);
    const count = id => state.templates.filter(t => t.category_id === id && t.status !== 'archived').length;
    const rows = state.categories.map(c => {
      const edit = el('button', { type: 'button', class: 'btn ghost sm' }, 'Modifier');
      edit.onclick = () => categoryForm(c, area);
      const toggle = el('button', { type: 'button', class: 'btn ghost sm' }, c.is_active ? 'Désactiver' : 'Activer');
      toggle.onclick = async () => {
        const text = c.is_active
          ? `La catégorie « ${c.name} » et ses modèles ne seront plus proposés dans le catalogue. Rien n’est supprimé et les invitations publiées restent en ligne.`
          : `La catégorie « ${c.name} » sera de nouveau proposée.`;
        if (!(await confirm((c.is_active ? 'Désactiver' : 'Activer') + ' cette catégorie ?', text))) return;
        const { error } = await db.from('categories').update({ is_active: !c.is_active }).eq('id', c.id);
        if (error) { toast(errText(error), 'error'); return; }
        c.is_active = !c.is_active;
        toast('Catégorie enregistrée.', 'ok');
        draw(area);
      };
      return el('tr', {},
        el('td', {}, el('strong', {}, c.name)),
        el('td', {}, money(c.default_price_dt)),
        el('td', {}, String(count(c.id))),
        el('td', {}, String(c.sort_order)),
        el('td', {}, el('span', { class: 'badge status-' + (c.is_active ? 'active' : 'inactive') }, c.is_active ? 'Active' : 'Inactive')),
        el('td', {}, el('div', { class: 'row-actions' }, edit, toggle)));
    });
    return el('div', {},
      el('div', { class: 'toolbar' }, el('p', { class: 'sub' }, 'Le prix par défaut s’applique aux modèles sans prix propre.'), add),
      rows.length ? el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Catégorie', 'Prix par défaut', 'Modèles', 'Ordre', 'Statut', 'Actions'].map(h => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, rows)))
        : el('div', { class: 'empty' }, el('strong', {}, 'Aucune catégorie'), 'Créez une première catégorie.'));
  }

  function categoryForm(c, area) {
    const isNew = !c;
    const f = el('form', { class: 'sheet-form', novalidate: '' });
    const name = el('input', { required: '', maxlength: '40', value: c ? c.name : '' });
    const price = el('input', { type: 'number', min: '0', step: '0.001', required: '', value: c ? String(Number(c.default_price_dt)) : '' });
    const sort = el('input', { type: 'number', step: '1', value: c ? String(c.sort_order) : String(state.categories.length + 1) });
    const st = el('p', { class: 'status', role: 'status' });
    const save = el('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Créer' : 'Enregistrer');
    const cancel = el('button', { type: 'button', class: 'btn ghost' }, 'Annuler');
    f.append(el('h2', {}, isNew ? 'Nouvelle catégorie' : 'Modifier « ' + c.name + ' »'),
      el('label', {}, 'Nom *', name),
      el('div', { class: 'grid2' }, el('label', {}, 'Prix par défaut (DT) *', price), el('label', {}, 'Ordre', sort)),
      st, el('div', { class: 'actions' }, cancel, save));
    const dlg = el('dialog', { class: 'sheet' }, f);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    cancel.onclick = () => dlg.close();
    dlg.showModal();
    f.onsubmit = async e => {
      e.preventDefault();
      const fail = m => { st.textContent = m; st.className = 'status error'; };
      const n = name.value.trim();
      if (n.length < 2) return fail('Le nom doit contenir au moins 2 caractères.');
      if (price.value.trim() === '' || !(Number(price.value) >= 0)) return fail('Indiquez un prix valide.');
      const row = { name: n, default_price_dt: Number(price.value), sort_order: parseInt(sort.value, 10) || 0 };
      save.disabled = true;
      const res = isNew
        ? await db.from('categories').insert(row).select().single()
        : await db.from('categories').update(row).eq('id', c.id).select().single();
      save.disabled = false;
      if (res.error) return fail(errText(res.error));
      if (isNew) state.categories.push(res.data); else Object.assign(c, res.data);
      state.categories.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      dlg.close();
      toast(isNew ? 'Catégorie créée.' : 'Catégorie enregistrée.', 'ok');
      draw(area);
    };
  }

  registerRoute('modeles', { title: 'Modèles', lead: 'Catalogue, catégories, images et prix.', render });
})();
