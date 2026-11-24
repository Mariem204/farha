// Farha · /api/reviews — avis clients publiés (page « Vos avis »).
// Seuls les avis « Publiés » dans le back-office sont renvoyés, sans e-mail : prénom + initiale du nom.
// Variables d'environnement (comme /api/feedback) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

function headers(key) { const h = { apikey: key }; if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; return h; }
function shortName(n) {
  const p = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'Client Farha';
  return p[0].charAt(0).toUpperCase() + p[0].slice(1) + (p[1] ? ' ' + p[1].charAt(0).toUpperCase() + '.' : '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Méthode non autorisée' }); }
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return res.status(503).json({ error: 'Service non configuré' });
  try {
    const r = await fetch(base + '/rest/v1/feedbacks?select=author_name,rating,tags,message,created_at,template:templates(name)&status=eq.published&order=created_at.desc&limit=60', { headers: headers(key) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    const reviews = rows.map(f => ({ name: shortName(f.author_name), rating: Math.max(1, Math.min(5, f.rating | 0)), tags: (f.tags || []).slice(0, 4),
      message: String(f.message || '').slice(0, 600), date: f.created_at, model: f.template && f.template.name || '' }));
    const avg = reviews.length ? Math.round(reviews.reduce((s, x) => s + x.rating, 0) / reviews.length * 10) / 10 : 0;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).json({ count: reviews.length, average: avg, reviews });
  } catch (e) {
    console.error('reviews:', e.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Avis indisponibles pour le moment' });
  }
};
