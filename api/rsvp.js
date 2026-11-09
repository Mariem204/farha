// Farha · /api/rsvp — réponse d'un invité (« J'arrive » / « Je ne peux pas » + un mot facultatif).
// 1. retrouve l'invitation par sa clé (slug créé avec la commande, transmis dans le lien invité) ;
// 2. enregistre la réponse dans public.rsvps ;
// 3. envoie au client qui a commandé l'invitation un e-mail avec le tableau de TOUTES les réponses (une ligne par invité).
// Variables d'environnement Vercel : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY, FARHA_SENDER_EMAIL.
// L'adresse du client n'est jamais envoyée au navigateur.

const MAX_PER_IP_10_MIN = 8;
const MAX_PER_INVITATION = 500;
const recent = new Map();

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function headers(key, extra) {
  const h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}
async function rest(base, key, path, opts) {
  const r = await fetch(base + '/rest/v1/' + path, Object.assign({}, opts, { headers: headers(key, opts && opts.headers) }));
  const t = await r.text();
  const data = t ? JSON.parse(t) : null;
  if (!r.ok) throw Object.assign(new Error((data && data.message) || 'Erreur base de données'), { status: r.status });
  return data;
}
function when(iso) {
  try { return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
}

// Mot de baby shower : « Pronostic : une fille 💗 — message »
function prono(r) {
  const m = /^Pronostic : (un garçon 💙|une fille 💗)(?: — ([\s\S]*))?$/.exec(r.message || '');
  return m ? { label: m[1], text: m[2] || '', color: /garçon/.test(m[1]) ? '#3c6690' : '#a3456a' } : null;
}
// E-mail : résumé + tableau (N°, Nom et prénom, Réponse, Mot, Reçu le).
function mail(title, latest, rows) {
  const babyMode = rows.length && rows.every(r => prono(r));
  const yes = rows.filter(r => r.attending).length, no = rows.length - yes;
  const boys = rows.filter(r => prono(r) && /garçon/.test(prono(r).label)).length, girls = rows.filter(r => prono(r) && /fille/.test(prono(r).label)).length;
  const th = s => '<th style="text-align:left;padding:8px 10px;background:#551d30;color:#fff;font-weight:600;font-size:13px">' + s + '</th>';
  const td = (s, extra) => '<td style="padding:8px 10px;border-bottom:1px solid #eadfd6;vertical-align:top;font-size:14px;' + (extra || '') + '">' + s + '</td>';
  const body = rows.map((r, i) => '<tr' + (r === latest ? ' style="background:#fff6e5"' : '') + '>' +
    td(String(i + 1), 'color:#8a7a70') + td(esc(r.guest_name), 'font-weight:600') +
    (prono(r) ? td(esc(prono(r).label), 'white-space:nowrap;color:' + prono(r).color) + td(prono(r).text ? esc(prono(r).text) : '<span style="color:#b8aaa2">—</span>')
      : td(r.attending ? '✅ J’arrive' : '❌ Ne peut pas venir', 'white-space:nowrap;color:' + (r.attending ? '#1e7a3c' : '#a3261e')) +
        td(r.message ? esc(r.message) : '<span style="color:#b8aaa2">—</span>')) + td(esc(when(r.created_at)), 'white-space:nowrap;color:#8a7a70') + '</tr>').join('');
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;background:#faf7f5;padding:24px">' +
    '<div style="max-width:680px;margin:auto;background:#fff;border-radius:14px;padding:26px;border:1px solid #eadfd6">' +
    '<div style="font-size:22px;color:#551d30;font-weight:bold;margin-bottom:6px">Farha ✦</div>' +
    '<h1 style="font-size:19px;color:#551d30;margin:0 0 10px">' + esc(title) + '</h1>' +
    (prono(latest)
      ? '<p style="margin:0 0 6px"><b>' + esc(latest.guest_name) + '</b> vous a laissé un mot · <b>' + esc(prono(latest).label) + '</b></p>'
      : '<p style="margin:0 0 6px"><b>' + esc(latest.guest_name) + '</b> vient de répondre : <b>' + (latest.attending ? 'J’arrive ✅' : 'Je ne peux pas venir ❌') + '</b></p>') +
    (babyMode
      ? '<p style="margin:0 0 16px;color:#6d5f57">Total : ' + rows.length + ' mot' + (rows.length > 1 ? 's' : '') + ' · ' + boys + ' pour un garçon 💙 · ' + girls + ' pour une fille 💗</p>'
      : '<p style="margin:0 0 16px;color:#6d5f57">Total : ' + rows.length + ' réponse' + (rows.length > 1 ? 's' : '') + ' · ' + yes + ' présent' + (yes > 1 ? 's' : '') + ' · ' + no + ' absent' + (no > 1 ? 's' : '') + '</p>') +
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%">' +
    '<tr>' + th('N°') + th('Nom et prénom') + th(babyMode ? 'Pronostic' : 'Réponse') + th('Son mot') + th('Reçu le') + '</tr>' + body + '</table></div>' +
    '<p style="margin:16px 0 0;color:#8a7a70;font-size:13px">Vous recevez cet e-mail à chaque nouvelle réponse, avec la liste complète.</p>' +
    '</div></div>';
  const txt = [title, '', latest.guest_name + ' : ' + (latest.attending ? "J'arrive" : 'Ne peut pas venir'), '',
    ...rows.map((r, i) => (i + 1) + '. ' + r.guest_name + ' — ' + (r.attending ? "J'arrive" : 'Ne peut pas venir') + (r.message ? ' — « ' + r.message + ' »' : ''))].join('\n');
  return { html, txt };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }
  const origin = req.headers.origin;
  if (!origin) return res.status(403).json({ error: 'Origine refusée' });
  try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
  catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu', now = Date.now();
  const hits = (recent.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (hits.length >= MAX_PER_IP_10_MIN) return res.status(429).json({ error: 'Trop de réponses, réessayez plus tard.' });

  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return res.status(503).json({ error: 'Service non configuré' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 4000) return res.status(400).json({ error: 'Requête invalide' });
  const slug = clean(body.key, 80).toLowerCase();
  const name = clean(body.name, 120);
  const guess = body.guess === 'garcon' || body.guess === 'fille' ? body.guess : '';
  // baby shower : le pronostic est rangé au début du mot (« Pronostic : … »)
  const PRONO = { garcon: 'Pronostic : un garçon 💙', fille: 'Pronostic : une fille 💗' };
  const message = (guess ? PRONO[guess] + (clean(body.message, 560) ? ' — ' + clean(body.message, 560) : '') : clean(body.message, 600)).slice(0, 600);
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return res.status(400).json({ error: 'Invitation inconnue' });
  if (name.length < 2) return res.status(400).json({ error: 'Nom et prénom manquants' });
  if (typeof body.attending !== 'boolean') return res.status(400).json({ error: 'Réponse manquante' });

  try {
    const [inv] = await rest(base, key, 'invitations?select=slug,status,order_id,data&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
    if (!inv || inv.status === 'disabled') return res.status(404).json({ error: 'Invitation inconnue' });
    const count = await rest(base, key, 'rsvps?select=id&invitation_slug=eq.' + encodeURIComponent(slug) + '&limit=' + (MAX_PER_INVITATION + 1));
    if (count.length >= MAX_PER_INVITATION) return res.status(429).json({ error: 'Nombre maximum de réponses atteint' });
    hits.push(now); recent.set(ip, hits);
    await rest(base, key, 'rsvps', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ invitation_slug: slug, guest_name: name, attending: body.attending, message: message || null }) });

    // E-mail au client (l'enregistrement reste fait même si l'envoi échoue).
    let mailed = false;
    try {
      const brevo = (process.env.BREVO_API_KEY || '').trim();
      const [order] = inv.order_id ? await rest(base, key, 'orders?select=customer_email,customer_name&id=eq.' + encodeURIComponent(inv.order_id) + '&limit=1') : [];
      const to = order && order.customer_email;
      if (brevo && to && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        const rows = await rest(base, key, 'rsvps?select=guest_name,attending,message,created_at&invitation_slug=eq.' + encodeURIComponent(slug) + '&order=created_at.asc&limit=' + MAX_PER_INVITATION);
        const latest = rows[rows.length - 1] || { guest_name: name, attending: body.attending, message, created_at: new Date().toISOString() };
        const d = inv.data || {}, who = /^\d{1,3}$/.test(String(d.groom || '')) ? d.bride + ' (' + d.groom + ' ans)' : [d.bride, d.groom].filter(Boolean).join(' & ');
        const title = 'Réponses à votre invitation' + (who ? ' · ' + who : '');
        const m = mail(title, latest, rows);
        const sender = (process.env.FARHA_SENDER_EMAIL || 'farhacontact0@gmail.com').trim();
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevo, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender: { name: 'Farha', email: sender }, to: [{ email: to, name: order.customer_name || undefined }],
            subject: 'Farha · ' + name + (guess ? ' vous a laissé un mot (' + (guess === 'garcon' ? 'garçon 💙' : 'fille 💗') + ')' : body.attending ? ' arrive ✅' : ' ne peut pas venir ❌') + ' (' + rows.length + ' réponse' + (rows.length > 1 ? 's' : '') + ')',
            htmlContent: m.html, textContent: m.txt })
        });
        mailed = r.ok;
        if (!r.ok) console.error('rsvp: brevo', r.status, (await r.text()).slice(0, 200));
      }
    } catch (e) { console.error('rsvp: e-mail', e.status || '', e.message); }
    return res.status(201).json({ ok: true, mailed });
  } catch (e) {
    console.error('rsvp:', e.status || '', e.message);
    return res.status(500).json({ error: 'Réponse non enregistrée' });
  }
};
