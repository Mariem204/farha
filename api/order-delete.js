// Farha · /api/order-delete — suppression définitive d'une commande depuis le back-office.
// Réservé aux administrateurs : le jeton de la session du back-office est vérifié auprès de Supabase
// (utilisateur connecté + fonction is_admin()), puis la commande et ce qui en dépend sont supprimés avec la clé serveur.
// Variables d'environnement (comme /api/orders) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

function svc(key, extra) {
  const h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}

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
  const id = body && String(body.id || '');
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) return res.status(400).json({ error: 'Commande invalide' });

  try {
    // 1. la personne est connectée et administratrice (vérifié par Supabase avec SON jeton)
    const u = await fetch(base + '/auth/v1/user', { headers: { apikey: anon, Authorization: 'Bearer ' + token } });
    if (!u.ok) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
    const a = await fetch(base + '/rest/v1/rpc/is_admin', { method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
    if (!a.ok || (await a.json()) !== true) return res.status(403).json({ error: 'Réservé aux administrateurs' });

    // 2. suppression : réponses des invités et invitation liées, articles, puis la commande
    const enc = encodeURIComponent(id);
    const r0 = await fetch(base + '/rest/v1/invitations?select=slug&order_id=eq.' + enc, { headers: svc(key) });
    const invs = r0.ok ? await r0.json() : [];
    for (const i of invs) {
      await fetch(base + '/rest/v1/rsvps?invitation_slug=eq.' + encodeURIComponent(i.slug), { method: 'DELETE', headers: svc(key) });
    }
    await fetch(base + '/rest/v1/invitations?order_id=eq.' + enc, { method: 'DELETE', headers: svc(key) });
    await fetch(base + '/rest/v1/order_items?order_id=eq.' + enc, { method: 'DELETE', headers: svc(key) });
    const d = await fetch(base + '/rest/v1/orders?id=eq.' + enc, { method: 'DELETE', headers: svc(key, { Prefer: 'return=representation' }) });
    const t = await d.text();
    if (!d.ok) { console.error('order-delete:', d.status, t.slice(0, 200)); return res.status(502).json({ error: 'Suppression impossible : ' + (JSON.parse(t || '{}').message || d.status) }); }
    const rows = t ? JSON.parse(t) : [];
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    return res.status(200).json({ ok: true, reference: rows[0].reference });
  } catch (e) {
    console.error('order-delete:', e.message);
    return res.status(502).json({ error: 'Suppression impossible pour le moment' });
  }
};
