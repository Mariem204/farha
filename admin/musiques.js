// Farha · back-office · musiques d'ambiance proposées dans le formulaire du site.
// Lecture et écriture directes dans Supabase ; RLS (script 011) refuse toute action
// d'un compte non administrateur. Les fichiers audio vont dans le bucket public « music ».
(function () {
  'use strict';
  if (!window.FarhaAdmin) return;
  const { db, el, toast, confirm, registerRoute } = window.FarhaAdmin;

  const BUCKET = 'music';
  const MAX_AUDIO = 15 * 1024 * 1024;
  const AUDIO_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm' };
  const CATEGORIES = ['Romantique', 'Mariage', 'Anniversaire', 'Oriental', 'Instrumental'];
  const SOURCES = { file: 'Fichier audio', youtube: 'YouTube', demo: 'Démo intégrée' };

  const state = { q: '', cat: '', status: 'all', tracks: [] };
  let player = null, playingId = null;

  function errText(error) {
    const m = (error && error.message) || String(error);
    if (/relation .*music_tracks.* does not exist|could not find the table/i.test(m)) return 'Table absente : exécutez sql/011_music_tracks.sql dans Supabase.';
    if (/bucket not found/i.test(m)) return 'Bucket « music » absent : exécutez sql/011_music_tracks.sql dans Supabase.';
    if (/permission denied|row-level security/i.test(m)) return 'Action refusée : droits insuffisants.';
    if (/violates check constraint/i.test(m)) return 'Valeur refusée par la base : vérifiez les champs.';
    if (/exceeded the maximum allowed size|payload too large/i.test(m)) return 'Fichier trop lourd : 15 Mo maximum.';
    return m;
  }
  const fileUrl = path => db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // Même analyse des liens YouTube que sur le site (watch, youtu.be, shorts, embed, music…).
  function youtubeId(u) {
    u = String(u || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u;
    let x; try { x = new URL(u); } catch (e) { return ''; }
    if (!/^https?:$/.test(x.protocol)) return '';
    const h = x.hostname.replace(/^(www|m|music)\./, '');
    let id = '';
    if (h === 'youtu.be') id = x.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      id = x.searchParams.get('v') || '';
      const m = x.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  }

  // YouTube oEmbed : 401/403 = intégration désactivée par le propriétaire, 404 = vidéo privée ou supprimée.
  // Une réponse 200 ne garantit pas tout (restrictions d'âge, de pays ou de label) : l'aperçu reste le vrai test.
  async function checkYoutube(id) {
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
      if (r.ok) { const j = await r.json(); return { ok: true, title: j.title || '', author: j.author_name || '' }; }
      if (r.status === 401 || r.status === 403) return { ok: false, blocked: true };
      if (r.status === 404 || r.status === 400) return { ok: false, missing: true };
      return { ok: null };
    } catch (e) { return { ok: null }; }
  }

  // Les 20 mélodies de démonstration du site, regénérées à l'identique pour l'écoute.
  function demoWav(index) {
    const note = [0, 2, 4, 7, 9, 7, 4, 2], rate = 11025, secs = 5, frames = rate * secs;
    const buffer = new ArrayBuffer(44 + frames * 2), dv = new DataView(buffer);
    const str = (off, t) => { for (let j = 0; j < t.length; j++) dv.setUint8(off + j, t.charCodeAt(j)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + frames * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, frames * 2, true);
    const root = 220 * Math.pow(2, (index % 6) / 12), speed = 2.1 + (index % 4) * .23;
    for (let i = 0; i < frames; i++) {
      const t = i / rate, step = Math.floor(t * speed), n = note[(step + index) % 8] + (index % 3) * 2, f = root * Math.pow(2, n / 12);
      const phase = t * f * 6.2831853, env = Math.pow(1 - (t * speed % 1), 1.3), fade = Math.min(1, t * 6, (secs - t) * 3);
      const v = (Math.sin(phase) + .26 * Math.sin(phase * 2) + .14 * Math.sin(phase * .5)) * env * fade * .20;
      dv.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, v * 32767)), true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function stopPlayer() {
    if (player) { player.pause(); if (/^blob:/.test(player.src)) URL.revokeObjectURL(player.src); }
    player = null; playingId = null;
  }

  // ---------- Chargement ----------
  async function load() {
    const { data, error } = await db.from('music_tracks')
      .select('id,title,category,source,file_path,youtube_id,demo_index,is_active,sort_order,updated_at')
      .order('sort_order').order('title');
    if (error) throw error;
    state.tracks = data;
  }

  // ---------- Page ----------
  async function render(box) {
    stopPlayer();
    const note = el('p', { class: 'note' },
      'Les titres actifs sont proposés dans le formulaire du site (supplément musique inchangé). Pour une lecture fiable chez les invités, préférez un fichier MP3 : certaines vidéos YouTube refusent la lecture sur d’autres sites.');
    const area = el('div', {}, el('p', { class: 'lead' }, 'Chargement…'));
    box.append(note, area);
    try { await load(); } catch (e) {
      area.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Lecture impossible'), errText(e)));
      return;
    }
    draw(area);
  }

  function draw(area) {
    const search = el('input', { type: 'search', placeholder: 'Rechercher une musique', 'aria-label': 'Rechercher une musique', value: state.q });
    const cat = el('select', { 'aria-label': 'Catégorie' }, el('option', { value: '' }, 'Toutes les catégories'),
      CATEGORIES.map(c => el('option', { value: c }, c)));
    cat.value = state.cat;
    const status = el('select', { 'aria-label': 'Statut' },
      el('option', { value: 'all' }, 'Actives et inactives'), el('option', { value: 'active' }, 'Actives'), el('option', { value: 'inactive' }, 'Inactives'));
    status.value = state.status;
    const add = el('button', { type: 'button', class: 'btn primary' }, '+ Ajouter une musique');
    add.onclick = () => trackForm(null, area);
    const count = el('p', { class: 'sub' });
    const list = el('div', {});
    area.replaceChildren(el('div', { class: 'toolbar' }, search, cat, status, add), count, list);

    const refresh = () => {
      state.q = search.value; state.cat = cat.value; state.status = status.value;
      const q = state.q.trim().toLowerCase();
      const rows = state.tracks.filter(t =>
        (!q || (t.title + ' ' + t.category).toLowerCase().includes(q)) &&
        (!state.cat || t.category === state.cat) &&
        (state.status === 'all' || (state.status === 'active') === t.is_active));
      const active = state.tracks.filter(t => t.is_active).length;
      count.textContent = active + ' musique' + (active > 1 ? 's' : '') + ' active' + (active > 1 ? 's' : '') + ' sur ' + state.tracks.length +
        (active ? '.' : ' : le site affichera ses 20 démos intégrées tant qu’aucune musique n’est active.');
      list.replaceChildren(rows.length ? tracksTable(rows, area)
        : el('div', { class: 'empty' }, el('strong', {}, 'Aucune musique'), state.tracks.length ? 'Aucune musique ne correspond à ces filtres.' : 'Ajoutez un premier titre (MP3 ou lien YouTube).'));
    };
    search.oninput = refresh; cat.onchange = refresh; status.onchange = refresh;
    refresh();
  }

  function playBtn(t, area) {
    if (t.source === 'youtube') {
      const a = el('a', { class: 'btn ghost sm', href: 'https://www.youtube.com/watch?v=' + t.youtube_id, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube ↗');
      return a;
    }
    const b = el('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Écouter ' + t.title }, playingId === t.id ? '❚❚' : '▶');
    b.onclick = () => {
      if (playingId === t.id) { stopPlayer(); draw(area); return; }
      stopPlayer();
      player = new Audio(t.source === 'file' ? fileUrl(t.file_path) : URL.createObjectURL(demoWav(t.demo_index)));
      playingId = t.id;
      player.onended = () => { stopPlayer(); draw(area); };
      player.play().catch(e => { stopPlayer(); toast('Lecture impossible : ' + e.message, 'error'); draw(area); });
      draw(area);
    };
    return b;
  }

  function tracksTable(rows, area) {
    const tr = t => {
      const edit = el('button', { type: 'button', class: 'btn ghost sm' }, 'Modifier');
      edit.onclick = () => trackForm(t, area);
      const toggle = el('button', { type: 'button', class: 'btn ghost sm' }, t.is_active ? 'Désactiver' : 'Activer');
      toggle.onclick = async () => {
        const { error } = await db.from('music_tracks').update({ is_active: !t.is_active }).eq('id', t.id);
        if (error) { toast(errText(error), 'error'); return; }
        t.is_active = !t.is_active;
        toast('« ' + t.title + ' » : ' + (t.is_active ? 'active' : 'désactivée') + '.', 'ok');
        draw(area);
      };
      const del = el('button', { type: 'button', class: 'btn ghost sm warn' }, 'Supprimer');
      del.onclick = () => removeTrack(t, area);
      const thumb = t.source === 'youtube'
        ? el('img', { class: 'thumb', src: 'https://i.ytimg.com/vi/' + t.youtube_id + '/mqdefault.jpg', alt: '' })
        : el('span', { class: 'thumb thumb-empty music-thumb' }, '♫');
      return el('tr', {},
        el('td', {}, thumb),
        el('td', {}, el('strong', {}, t.title), el('div', { class: 'sub' }, SOURCES[t.source])),
        el('td', {}, t.category),
        el('td', {}, playBtn(t, area)),
        el('td', {}, String(t.sort_order)),
        el('td', {}, el('span', { class: 'badge status-' + (t.is_active ? 'active' : 'inactive') }, t.is_active ? 'Active' : 'Inactive')),
        el('td', {}, el('div', { class: 'row-actions' }, edit, toggle, del)));
    };
    return el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['', 'Titre', 'Catégorie', 'Écoute', 'Ordre', 'Statut', 'Actions'].map(h => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, rows.map(tr))));
  }

  async function removeTrack(t, area) {
    const text = `« ${t.title} » ne sera plus proposée et sera définitivement supprimée` +
      (t.source === 'file' ? ', fichier audio compris. Les invitations déjà publiées avec ce titre n’auront plus de musique.' : '. Pour la masquer sans la supprimer, utilisez « Désactiver ».');
    if (!(await confirm('Supprimer cette musique ?', text, 'Supprimer'))) return;
    if (playingId === t.id) stopPlayer();
    const { error } = await db.from('music_tracks').delete().eq('id', t.id);
    if (error) { toast(errText(error), 'error'); return; }
    if (t.source === 'file') {
      const rm = await db.storage.from(BUCKET).remove([t.file_path]);
      if (rm.error) toast('Musique supprimée, mais le fichier est resté dans le stockage : ' + errText(rm.error), 'error');
    }
    state.tracks = state.tracks.filter(x => x !== t);
    toast('Musique supprimée.', 'ok');
    draw(area);
  }

  // ---------- Formulaire ----------
  function trackForm(t, area) {
    stopPlayer();
    const isNew = !t;
    const f = el('form', { class: 'sheet-form', novalidate: '' });
    const title = el('input', { required: '', maxlength: '80', value: t ? t.title : '' });
    const cat = el('select', {}, CATEGORIES.map(c => el('option', { value: c }, c)));
    cat.value = t ? t.category : 'Mariage';
    const sort = el('input', { type: 'number', step: '1', value: t ? String(t.sort_order) : String(state.tracks.reduce((m, x) => Math.max(m, x.sort_order), 0) + 1) });
    const active = el('input', { type: 'checkbox' });
    active.checked = t ? t.is_active : true;

    // Source : fichier ou YouTube (une démo peut être remplacée par l'une ou l'autre).
    let source = t && t.source !== 'demo' ? t.source : 'file';
    const srcTabs = el('div', { class: 'tabs', role: 'tablist' });
    const filePane = el('div', {}), ytPane = el('div', {});
    const srcBtn = (key, label) => {
      const b = el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(source === key) }, label);
      b.onclick = () => { source = key; srcTabs.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === b))); showPane(); };
      return b;
    };
    srcTabs.append(srcBtn('file', 'Fichier MP3'), srcBtn('youtube', 'Lien YouTube'));
    const showPane = () => { filePane.hidden = source !== 'file'; ytPane.hidden = source !== 'youtube'; };

    // Fichier audio
    const file = el('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.ogg,.wav' });
    const audio = el('audio', { controls: '', preload: 'none', class: 'form-audio' });
    let localUrl = null;
    if (t && t.source === 'file') audio.src = fileUrl(t.file_path); else audio.hidden = true;
    file.onchange = () => {
      const x = file.files[0];
      if (!x) return;
      if (!audioType(x)) { toast('Format accepté : MP3, M4A, AAC, OGG ou WAV.', 'error'); file.value = ''; return; }
      if (x.size > MAX_AUDIO) { toast('Fichier trop lourd : 15 Mo maximum.', 'error'); file.value = ''; return; }
      if (localUrl) URL.revokeObjectURL(localUrl);
      localUrl = URL.createObjectURL(x); audio.src = localUrl; audio.hidden = false;
      if (!title.value.trim()) title.value = x.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80);
    };
    filePane.append(el('label', {}, 'Fichier audio (MP3 conseillé, 15 Mo max.)' + (isNew || (t && t.source !== 'file') ? ' *' : ''), file,
      el('span', { class: 'hint' }, t && t.source === 'file' ? 'Laissez vide pour garder le fichier actuel.' : 'Astuce : un MP3 de 128 kbit/s pèse environ 1 Mo par minute.')), audio);

    // YouTube
    const yt = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://www.youtube.com/watch?v=…',
      value: t && t.source === 'youtube' ? 'https://www.youtube.com/watch?v=' + t.youtube_id : '' });
    const check = el('button', { type: 'button', class: 'btn ghost sm' }, 'Vérifier et prévisualiser');
    const ytStatus = el('p', { class: 'status', role: 'status' });
    const ytPreview = el('div', { class: 'yt-preview' });
    let ytChecked = t && t.source === 'youtube' ? { id: t.youtube_id, ok: true } : null;
    yt.oninput = () => { ytChecked = null; ytStatus.textContent = ''; ytStatus.className = 'status'; ytPreview.replaceChildren(); };
    check.onclick = async () => {
      const id = youtubeId(yt.value);
      ytPreview.replaceChildren();
      if (!id) { ytStatus.textContent = 'Ce lien YouTube n’est pas reconnu.'; ytStatus.className = 'status error'; return; }
      ytStatus.textContent = 'Vérification…'; ytStatus.className = 'status';
      const r = await checkYoutube(id);
      ytChecked = { id, ok: r.ok };
      if (r.blocked) { ytStatus.textContent = 'Le propriétaire de cette vidéo interdit sa lecture sur d’autres sites : YouTube la bloquera. Utilisez plutôt un fichier MP3.'; ytStatus.className = 'status error'; return; }
      if (r.missing) { ytStatus.textContent = 'Vidéo introuvable, privée ou supprimée.'; ytStatus.className = 'status error'; return; }
      if (r.ok && !title.value.trim()) title.value = r.title.slice(0, 80);
      ytStatus.textContent = (r.ok ? '✓ Intégration autorisée' + (r.author ? ' · ' + r.author : '') + '. ' : 'Vérification automatique indisponible. ') +
        'Lancez l’aperçu ci-dessous : s’il affiche « Vidéo non disponible », elle sera aussi bloquée chez les invités.';
      ytStatus.className = 'status' + (r.ok ? ' ok' : '');
      ytPreview.append(el('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1', title: 'Aperçu YouTube',
        allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin', }));
    };
    ytPane.append(el('label', {}, 'Lien de la vidéo YouTube *', yt),
      el('div', { class: 'row-actions' }, check), ytStatus, ytPreview);
    showPane();

    const st = el('p', { class: 'status', role: 'status' });
    const save = el('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Ajouter la musique' : 'Enregistrer');
    const cancel = el('button', { type: 'button', class: 'btn ghost' }, 'Annuler');

    f.append(
      el('h2', {}, isNew ? 'Nouvelle musique' : 'Modifier « ' + t.title + ' »'),
      t && t.source === 'demo' ? el('p', { class: 'note' }, 'Mélodie de démonstration intégrée au site. Choisissez un fichier ou un lien YouTube seulement pour la remplacer ; sinon, seuls le titre, la catégorie, l’ordre et le statut changent.') : '',
      el('label', {}, 'Titre affiché *', title),
      el('div', { class: 'grid2' }, el('label', {}, 'Catégorie', cat), el('label', {}, 'Ordre', sort)),
      el('label', { class: 'check' }, active, ' Proposée sur le site'),
      el('h3', {}, 'Source'), srcTabs, filePane, ytPane,
      st, el('div', { class: 'actions' }, cancel, save));

    const dlg = el('dialog', { class: 'sheet' }, f);
    document.body.append(dlg);
    dlg.addEventListener('close', () => { if (localUrl) URL.revokeObjectURL(localUrl); audio.pause(); dlg.remove(); });
    cancel.onclick = () => dlg.close();
    dlg.showModal();

    f.onsubmit = async e => {
      e.preventDefault();
      const fail = m => { st.textContent = m; st.className = 'status error'; };
      const n = title.value.trim();
      if (n.length < 2) return fail('Le titre doit contenir au moins 2 caractères.');
      const row = { title: n, category: cat.value, sort_order: parseInt(sort.value, 10) || 0, is_active: active.checked };
      const x = file.files[0];
      const keepDemo = t && t.source === 'demo' && !x && !yt.value.trim();
      let uploaded = null;

      if (!keepDemo && source === 'file') {
        if (!x && !(t && t.source === 'file')) return fail('Choisissez un fichier audio.');
        if (x) {
          save.disabled = true; st.textContent = 'Envoi du fichier…'; st.className = 'status';
          const path = new Date().toISOString().slice(0, 7) + '/' + crypto.randomUUID() + '.' + AUDIO_EXT[audioType(x)];
          const up = await db.storage.from(BUCKET).upload(path, x, { contentType: audioType(x), upsert: false, cacheControl: '31536000' });
          if (up.error) { save.disabled = false; return fail('Fichier non envoyé : ' + errText(up.error)); }
          uploaded = path;
          Object.assign(row, { source: 'file', file_path: path, youtube_id: null, demo_index: null });
        }
      } else if (!keepDemo && source === 'youtube') {
        const id = youtubeId(yt.value);
        if (!id) return fail('Ce lien YouTube n’est pas reconnu.');
        if (!ytChecked || ytChecked.id !== id) { check.click(); return fail('Vérifiez d’abord la vidéo avec l’aperçu.'); }
        if (ytChecked.ok === false) return fail('Cette vidéo ne peut pas être lue sur le site : choisissez-en une autre ou un fichier MP3.');
        Object.assign(row, { source: 'youtube', youtube_id: id, file_path: null, demo_index: null });
      }

      save.disabled = true; st.textContent = 'Enregistrement…'; st.className = 'status';
      const res = isNew
        ? await db.from('music_tracks').insert(row).select().single()
        : await db.from('music_tracks').update(row).eq('id', t.id).select().single();
      save.disabled = false;
      if (res.error) {
        if (uploaded) db.storage.from(BUCKET).remove([uploaded]).then(() => {});
        return fail(errText(res.error));
      }
      // L'ancien fichier n'est plus référencé : on le retire du stockage.
      if (t && t.source === 'file' && t.file_path !== res.data.file_path) db.storage.from(BUCKET).remove([t.file_path]).then(() => {});
      if (isNew) state.tracks.push(res.data); else Object.assign(t, res.data);
      state.tracks.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
      dlg.close();
      toast(isNew ? 'Musique ajoutée.' : 'Musique enregistrée.', 'ok');
      draw(area);
    };
  }

  // Type MIME fiable : certains navigateurs laissent file.type vide pour un .mp3.
  function audioType(x) {
    if (AUDIO_EXT[x.type]) return x.type;
    const ext = (x.name.match(/\.([a-z0-9]+)$/i) || [])[1];
    return { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' }[(ext || '').toLowerCase()] || '';
  }

  registerRoute('musiques', { title: 'Musiques', lead: 'Bibliothèque de musiques d’ambiance : ajout par fichier MP3 ou lien YouTube, activation et suppression.', render });
})();
