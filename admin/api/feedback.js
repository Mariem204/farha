// Farha · /api/feedback — enregistre un avis client, toujours « en attente » de modération.
// Mêmes variables d'environnement Vercel que /api/orders : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Un avis n'est visible sur le site qu'après publication dans l'admin.

const MAX_PER_EMAIL_10_MIN = 3;
const TAGS_MAX = 10;

function clean(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function headers(key, extra) {
  const h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}

async function rest(base, key, path, opts) {
  const r = await fetch(base + '/rest/v1/' + path, Object.assign({}, opts, { headers: headers(key, opts && opts.headers) }));
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw Object.assign(new Error((data && data.message) || 'Erreur base de données'), { status: r.status });
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }

  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
    catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }
  }

  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return res.status(503).json({ error: 'Service non configuré' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Requête invalide' });
  if (JSON.stringify(body).length > 10000) return res.status(413).json({ error: 'Requête trop volumineuse' });

  const rating = parseInt(body.rating, 10);
  const name = clean(body.name, 120);
  const email = clean(body.email, 160);
  const message = clean(body.message, 2000);
  const tags = (Array.isArray(body.tags) ? body.tags : []).map(t => clean(t, 40)).filter(Boolean).slice(0, TAGS_MAX);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Note invalide' });
  if (!name || name.length < 2) return res.status(400).json({ error: 'Nom manquant' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail invalide' });

  try {
    if (email) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recent = await rest(base, key, 'feedbacks?select=id&author_email=ilike.' +
        encodeURIComponent(email.replace(/[%_*,()]/g, '')) + '&created_at=gte.' + encodeURIComponent(since));
      if (recent.length >= MAX_PER_EMAIL_10_MIN) return res.status(429).json({ error: 'Trop d’envois, réessayez plus tard.' });
    }
    let templateId = null;
    const slug = clean(body.template_slug, 40);
    if (slug && /^[a-zA-Z0-9-]{2,40}$/.test(slug)) {
      const rows = await rest(base, key, 'templates?select=id&slug=eq.' + encodeURIComponent(slug));
      templateId = rows[0] ? rows[0].id : null;
    }
    await rest(base, key, 'feedbacks', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ author_name: name, author_email: email, rating, tags, message, template_id: templateId, status: 'pending' })
    });
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error('feedback:', e.status || '', e.message);
    return res.status(500).json({ error: 'Enregistrement impossible pour le moment' });
  }
};
