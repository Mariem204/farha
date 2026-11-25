// Farha · /api/order-custom — commandes personnalisées (invitations en lien externe, prix fixé par l'admin) depuis le back-office.
//   POST { action: 'create', event, name, email, phone, link, price } → { id, reference }
//   POST { action: 'price', id, price }                                → { ok }  (commandes « sur mesure » uniquement)
// Réservé aux administrateurs : même vérification que /api/order-delete (jeton du back-office + is_admin()).
// Variables d'environnement (comme /api/orders) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

function svc(key, extra) {
  const h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const priceOf = v => { const n = Math.round(Number(String(v).replace(',', '.')) * 1000) / 1000; return isFinite(n) && n >= 0 && n <= 100000 ? n : null; };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }
  const origin = req.headers.origin;
  if (!origin) return res.status(403).json({ error: 'Origine refusée' });
  try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
  catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }

  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anon = String(req.headers['x-farha-anon'] || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return res.status(503).json({ error: 'Service non configuré' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!/^[A-Za-z0-9._-]{20,4000}$/.test(token) || !/^[A-Za-z0-9._-]{20,4000}$/.test(anon)) return res.status(401).json({ error: 'Connexion requise' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  body = body || {};

  try {
    const u = await fetch(base + '/auth/v1/user', { headers: { apikey: anon, Authorization: 'Bearer ' + token } });
    if (!u.ok) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
    const a = await fetch(base + '/rest/v1/rpc/is_admin', { method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
    if (!a.ok || (await a.json()) !== true) return res.status(403).json({ error: 'Réservé aux administrateurs' });

    // rattrapage : anciennes commandes de modèle dont le total ne comptait pas la musique (+5 DT)
    if (body.action === 'fix-totals') {
      const r = await fetch(base + '/rest/v1/orders?select=id,total_dt,order_items(label,details)&kind=eq.template&limit=2000', { headers: svc(key) });
      if (!r.ok) return res.status(502).json({ error: 'Lecture impossible' });
      let fixed = 0;
      for (const o of await r.json()) {
        const items = o.order_items || [];
        if (items.some(i => /^Musique/.test(i.label || ''))) continue;
        const d = (items[0] && items[0].details) || {};
        const sup = Number(d.supplement_musique || 0), modele = Number(d.prix_modele);
        if (!(sup > 0) || !isFinite(modele) || Math.abs(Number(o.total_dt) - modele) > 0.001) continue;
        const enc = encodeURIComponent(o.id);
        const u = await fetch(base + '/rest/v1/orders?id=eq.' + enc, { method: 'PATCH', headers: svc(key), body: JSON.stringify({ total_dt: modele + sup }) });
        if (!u.ok) continue;
        await fetch(base + '/rest/v1/order_items', { method: 'POST', headers: svc(key, { Prefer: 'return=minimal' }),
          body: JSON.stringify({ order_id: o.id, template_id: null, label: 'Musique d’ambiance', unit_price_dt: sup, quantity: 1, details: { music_type: d.music_type || 'oui' } }) });
        fixed++;
      }
      return res.status(200).json({ ok: true, fixed });
    }

    const price = priceOf(body.price);
    if (price === null) return res.status(400).json({ error: 'Prix invalide' });

    if (body.action === 'price') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{8,40}$/i.test(id)) return res.status(400).json({ error: 'Commande invalide' });
      const enc = encodeURIComponent(id);
      const r = await fetch(base + '/rest/v1/orders?kind=eq.sur_mesure&id=eq.' + enc, { method: 'PATCH', headers: svc(key, { Prefer: 'return=representation' }), body: JSON.stringify({ total_dt: price }) });
      const rows = r.ok ? await r.json() : null;
      if (!r.ok) { console.error('order-custom: prix', r.status); return res.status(502).json({ error: 'Modification impossible' }); }
      if (!rows.length) return res.status(404).json({ error: 'Seules les commandes sur mesure ont un prix modifiable' });
      await fetch(base + '/rest/v1/order_items?order_id=eq.' + enc, { method: 'PATCH', headers: svc(key), body: JSON.stringify({ unit_price_dt: price }) });
      return res.status(200).json({ ok: true });
    }

    if (body.action !== 'create') return res.status(400).json({ error: 'Action inconnue' });
    const event = clean(body.event, 120), name = clean(body.name, 120), email = clean(body.email, 160), phone = clean(body.phone, 40), link = clean(body.link, 300);
    if (event.length < 2 || name.length < 2) return res.status(400).json({ error: 'Événement et nom du client requis' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail invalide' });
    if (link && !/^https:\/\/[^\s]+$/.test(link)) return res.status(400).json({ error: 'Lien invalide (https://…)' });

    const o = await fetch(base + '/rest/v1/orders?select=id,reference', { method: 'POST', headers: svc(key, { Prefer: 'return=representation' }),
      body: JSON.stringify({ kind: 'sur_mesure', customer_name: name, customer_email: email || 'farhacontact0@gmail.com', customer_phone: phone || null,
        total_dt: price, payment_status: 'unpaid', processing_status: 'completed' }) });
    const ot = await o.text();
    if (!o.ok) { console.error('order-custom: commande', o.status, ot.slice(0, 200)); return res.status(502).json({ error: 'Création impossible : ' + (JSON.parse(ot || '{}').message || o.status) }); }
    const order = JSON.parse(ot)[0];
    const details = { evenement: event, lien: link || undefined, personnalisee: 'Oui (lien externe)' };
    const it = await fetch(base + '/rest/v1/order_items', { method: 'POST', headers: svc(key, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ order_id: order.id, template_id: null, label: 'Personnalisée · ' + event, unit_price_dt: price, quantity: 1, details }) });
    if (!it.ok) console.error('order-custom: article', it.status, (await it.text()).slice(0, 200));
    return res.status(201).json({ id: order.id, reference: order.reference });
  } catch (e) {
    console.error('order-custom:', e.message);
    return res.status(502).json({ error: 'Action impossible pour le moment' });
  }
};
