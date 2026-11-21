// Farha · /api/photo — enregistre une photo de l'invitation (ajoutée par le client dans le formulaire)
// pour qu'elle s'affiche aussi dans le lien envoyé aux invités. Le lien d'invitation ne peut pas contenir
// l'image elle-même (trop lourde) : il contient l'adresse publique renvoyée ici.
// Fonction serveur Vercel (Node.js, sans dépendance). Variables d'environnement (comme /api/orders) :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Stockage : bucket public « invitation-photos » de Supabase Storage (créé automatiquement s'il manque).

const BUCKET = 'invitation-photos';
const MAX_BYTES = 3 * 1024 * 1024;       // photo déjà réduite à 1600 px par le site : quelques centaines de Ko
const MAX_PER_IP_10_MIN = 30;            // limite anti-abus (par instance serveur)
const recent = new Map();
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function headers(key, extra) {
  const h = Object.assign({ apikey: key }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; // ancienne clé JWT service_role
  return h;
}
// Vérifie que le contenu est bien une image du type annoncé (signature du fichier).
function looksLike(buf, mime) {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
  return false;
}
function name(ext) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789', b = require('crypto').randomBytes(16);
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + Array.from(b, x => a[x % a.length]).join('') + '.' + ext;
}
async function upload(base, key, path, buf, mime) {
  return fetch(base + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'POST', headers: headers(key, { 'Content-Type': mime, 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' }), body: buf
  });
}

const PATH_RE = /^\d{4}-\d{2}\/[a-z2-9]{16}\.(jpg|png|webp)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

module.exports = async function handler(req, res) {
  const base0 = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key0 = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  // GET /api/photo?f=2026-11/xxxx.jpg : la photo est servie par le site lui-même (lue dans le stockage avec la clé
  // serveur), elle s'affiche donc quel que soit le réglage public/privé du stockage.
  if (req.method === 'GET') {
    const f = String((req.query && req.query.f) || new URL(req.url, 'https://x').searchParams.get('f') || '');
    const m = f.match(PATH_RE);
    if (!m || !key0) return res.status(404).end();
    try {
      const r = await fetch(base0 + '/storage/v1/object/authenticated/' + BUCKET + '/' + f, { headers: headers(key0) });
      if (!r.ok) { res.setHeader('Cache-Control', 'no-store'); return res.status(r.status === 400 || r.status === 404 ? 404 : 502).end(); }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', MIME[m[1]]);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(buf);
    } catch (e) { console.error('photo: lecture', e.message); res.setHeader('Cache-Control', 'no-store'); return res.status(502).end(); }
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }

  // Uniquement depuis le site lui-même (même domaine).
  const origin = req.headers.origin;
  if (!origin) return res.status(403).json({ error: 'Origine refusée' });
  try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
  catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }

  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return res.status(503).json({ error: 'Service non configuré' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const m = body && typeof body.image === 'string' && body.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Image invalide' });
  const mime = m[1], buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return res.status(413).json({ error: 'Photo trop lourde' });
  if (!looksLike(buf, mime)) return res.status(400).json({ error: 'Image invalide' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu';
  const now = Date.now(), list = (recent.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= MAX_PER_IP_10_MIN) return res.status(429).json({ error: 'Trop de photos envoyées, réessayez plus tard.' });
  list.push(now); recent.set(ip, list);

  const path = name(TYPES[mime]);
  try {
    let r = await upload(base, key, path, buf, mime);
    if (r.status === 404 || r.status === 400) {
      // bucket absent : on le crée (public en lecture, images de 5 Mo au plus), puis on réessaie
      const t = await r.text();
      if (/bucket/i.test(t) && /not.?found/i.test(t)) {
        await fetch(base + '/storage/v1/bucket', { method: 'POST', headers: headers(key, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: Object.keys(TYPES) }) });
        r = await upload(base, key, path, buf, mime);
      } else { console.error('photo: upload', r.status, t.slice(0, 200)); return res.status(502).json({ error: 'Enregistrement de la photo impossible' }); }
    }
    if (!r.ok) { console.error('photo: upload', r.status, (await r.text()).slice(0, 200)); return res.status(502).json({ error: 'Enregistrement de la photo impossible' }); }
  } catch (e) {
    console.error('photo:', e.message);
    return res.status(502).json({ error: 'Enregistrement de la photo impossible' });
  }
  // adresse servie par le site (même domaine que l'invitation)
  return res.status(200).json({ url: 'https://' + req.headers.host + '/api/photo?f=' + path });
};
