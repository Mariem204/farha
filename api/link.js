// Farha · /api/link — liens courts d'invitation : www.invitation-digitale.tn/mariage-souhir-et-skander
// Le contenu de l'invitation (le long code « #i=… » créé par le site) est gardé côté serveur sous un nom lisible.
//   POST { i: "<code>", kind: "Mariage", names: ["Souhir", "Skander"] }  → { slug, url }
//   GET  /api/link?s=mariage-souhir-et-skander                          → { i: "<code>" }
// Stockage : bucket privé « invitation-links » de Supabase Storage (créé automatiquement), un fichier JSON par lien.
// Variables d'environnement (comme /api/orders) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'invitation-links';
const SITE = 'https://www.invitation-digitale.tn/';
const MAX_PER_IP_10_MIN = 20;
const recent = new Map();
// Préfixe du lien selon la collection (les mêmes préfixes sont reconnus par vercel.json et par le site).
const KIND = { 'Mariage': 'mariage', '7enna': 'henna', 'Wteya': 'wteya', 'Fiançailles': 'fiancailles', 'Anniversaire': 'anniversaire',
  'Baby shower': 'baby-shower', 'Bridal party': 'bridal-party', 'Tahara': 'tahara', 'Diplôme': 'soutenance', 'Naissance': 'naissance' };
const SLUG_RE = /^(mariage|henna|wteya|fiancailles|anniversaire|baby-shower|bridal-party|tahara|soutenance|naissance|fete)-[a-z0-9-]{1,80}$/;

function headers(key, extra) {
  const h = Object.assign({ apikey: key }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; // ancienne clé JWT service_role
  return h;
}
function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
}
function config() {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) && key ? { base, key } : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const cfg = config();
  if (!cfg && req.method !== 'OPTIONS') return res.status(503).json({ error: 'Service non configuré' });
  const { base, key } = cfg || {};

  if (req.method === 'GET') {
    const s = String((req.query && req.query.s) || new URL(req.url, 'https://x').searchParams.get('s') || '');
    if (!SLUG_RE.test(s)) return res.status(404).json({ error: 'Lien introuvable' });
    try {
      const r = await fetch(base + '/storage/v1/object/authenticated/' + BUCKET + '/' + s + '.json', { headers: headers(key) });
      if (!r.ok) return res.status(404).json({ error: 'Lien introuvable' });
      const j = JSON.parse(await r.text());
      if (!j || typeof j.i !== 'string' || !/^[A-Za-z0-9_-]{10,12000}$/.test(j.i)) return res.status(404).json({ error: 'Lien introuvable' });
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).json({ i: j.i });
    } catch (e) { console.error('link: lecture', e.message); return res.status(502).json({ error: 'Lecture impossible' }); }
  }

  // Depuis le site lui-même, ou depuis une preview Vercel du projet (qui n'a pas accès à la base) : en-têtes CORS.
  const origin = req.headers.origin;
  const preview = /^https:\/\/farha-[a-z0-9-]+-maryemayadi05-7793s-projects\.vercel\.app$/.test(origin || '') || origin === 'https://farha-bay.vercel.app';
  if (preview) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') return res.status(preview ? 204 : 403).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }
  if (!origin) return res.status(403).json({ error: 'Origine refusée' });
  try { if (new URL(origin).host !== req.headers.host && !preview) return res.status(403).json({ error: 'Origine refusée' }); }
  catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const code = body && typeof body.i === 'string' ? body.i : '';
  if (!/^[A-Za-z0-9_-]{10,12000}$/.test(code)) return res.status(400).json({ error: 'Invitation invalide' });
  // le code doit être une invitation lisible (modèle + données)
  try { const o = JSON.parse(Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); if (!o || typeof o.t !== 'string' || !o.d) throw 0; }
  catch (e) { return res.status(400).json({ error: 'Invitation invalide' }); }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu';
  const now = Date.now(), list = (recent.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= MAX_PER_IP_10_MIN) return res.status(429).json({ error: 'Trop de demandes, réessayez plus tard.' });
  list.push(now); recent.set(ip, list);

  const names = (Array.isArray(body.names) ? body.names : []).map(slugify).filter(Boolean);
  const uniq = names.filter((n, i) => names.indexOf(n) === i).slice(0, 2);
  const start = (KIND[body.kind] || 'fete') + '-' + (uniq.length ? uniq.join('-et-') : 'invitation');
  const file = JSON.stringify({ i: code, created: new Date().toISOString() });

  async function put(slug) {
    return fetch(base + '/storage/v1/object/' + BUCKET + '/' + slug + '.json', {
      method: 'POST', headers: headers(key, { 'Content-Type': 'application/json', 'x-upsert': 'false' }), body: file
    });
  }
  try {
    let created = false;
    for (let n = 1; n <= 12; n++) {
      // nom libre d'abord, puis -2, -3… ; au-delà, un suffixe aléatoire
      const slug = n === 1 ? start : n <= 9 ? start + '-' + n : start + '-' + require('crypto').randomBytes(3).toString('hex');
      let r = await put(slug);
      if (!r.ok) {
        const t = await r.text();
        if (!created && /bucket/i.test(t) && /not.?found/i.test(t)) {
          await fetch(base + '/storage/v1/bucket', { method: 'POST', headers: headers(key, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 64 * 1024 }) });
          created = true; r = await put(slug);
          if (r.ok) return res.status(200).json({ slug, url: SITE + slug });
          const t2 = await r.text(); if (!/exist|duplicate|409/i.test(t2 + r.status)) throw new Error(r.status + ' ' + t2.slice(0, 160));
          continue;
        }
        if (/exist|duplicate/i.test(t) || r.status === 409) continue; // nom déjà pris
        throw new Error(r.status + ' ' + t.slice(0, 160));
      }
      return res.status(200).json({ slug, url: SITE + slug });
    }
    return res.status(409).json({ error: 'Aucun nom libre' });
  } catch (e) {
    console.error('link:', e.message);
    return res.status(502).json({ error: 'Lien court impossible' });
  }
};
