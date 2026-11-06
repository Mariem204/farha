// Farha · /api/idea — demande « Personnaliser mon invitation » : envoie le récapitulatif à l'équipe Farha par e-mail
// (Brevo), avec les images d'inspiration en pièces jointes. Le WhatsApp de l'équipe est ouvert côté navigateur.
// Variables d'environnement Vercel : BREVO_API_KEY, FARHA_SENDER_EMAIL, FARHA_ADMIN_EMAIL (comme /api/payment-email).

const MAX_PER_IP_10_MIN = 5;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1200 * 1024;
const recent = new Map();

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  if (hits.length >= MAX_PER_IP_10_MIN) return res.status(429).json({ error: 'Trop de demandes, réessayez plus tard.' });

  const key = (process.env.BREVO_API_KEY || '').trim();
  if (!key) return res.status(503).json({ error: 'Service non configuré' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Requête invalide' });

  const f = {
    client: clean(body.client, 80), email: clean(body.email, 120), whatsapp: clean(body.whatsapp, 30),
    event: clean(body.event, 60), names: clean(body.names, 120), date: clean(body.date, 20), place: clean(body.place, 150),
    colors: clean(body.colors, 300), ambiance: clean(body.ambiance, 40), idea: clean(String(body.idea || '').replace(/\r/g, ''), 2000)
  };
  const missing = Object.keys(f).filter(k => !f[k]);
  if (missing.length) return res.status(400).json({ error: 'Champs manquants', champs: missing });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return res.status(400).json({ error: 'E-mail invalide' });
  if (!/^[0-9+ ().-]{8,30}$/.test(f.whatsapp)) return res.status(400).json({ error: 'Numéro WhatsApp invalide' });

  // images d'inspiration (facultatives) : JPEG / PNG / WebP déjà réduites par le navigateur
  const attachment = [];
  for (const im of (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(im && im.data || ''));
    if (!m) continue;
    if (m[2].length * 0.75 > MAX_IMAGE_BYTES) continue;
    const name = clean(im.name, 80).replace(/[^\w.\- ]/g, '_') || 'inspiration';
    attachment.push({ name: name.replace(/\.[a-z0-9]+$/i, '') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), content: m[2] });
  }

  const rows = [
    ['Nom', f.client], ['E-mail', f.email], ['WhatsApp', f.whatsapp], ['Événement', f.event], ['Prénoms', f.names],
    ['Date', f.date], ['Lieu', f.place], ['Couleurs', f.colors], ['Ambiance', f.ambiance],
    ['Images d’inspiration', attachment.length ? attachment.length + ' en pièce jointe' : 'aucune']
  ];
  const wa = 'https://wa.me/' + f.whatsapp.replace(/\D/g, '');
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;background:#faf7f5;padding:24px">' +
    '<div style="max-width:600px;margin:auto;background:#fff;border-radius:14px;padding:26px;border:1px solid #eadfd6">' +
    '<div style="font-size:22px;color:#551d30;font-weight:bold;margin-bottom:6px">Farha ✦</div>' +
    '<h1 style="font-size:19px;color:#551d30;margin:0 0 14px">Nouvelle demande · Personnaliser mon invitation</h1>' +
    '<table style="border-collapse:collapse;margin:0 0 16px">' + rows.map(([k, v]) =>
      '<tr><td style="padding:6px 14px 6px 0;color:#8a7a70;white-space:nowrap;vertical-align:top">' + esc(k) + '</td><td style="padding:6px 0;color:#29252c">' + esc(v) + '</td></tr>').join('') + '</table>' +
    '<div style="padding:14px 16px;background:#faf3ec;border-radius:10px;white-space:pre-wrap">' + esc(f.idea) + '</div>' +
    '<p style="margin:16px 0 0"><a href="' + esc(wa) + '" style="color:#8d4565">Répondre sur WhatsApp</a> · <a href="mailto:' + esc(f.email) + '" style="color:#8d4565">Répondre par e-mail</a></p>' +
    '</div></div>';
  const txt = ['Nouvelle demande · Personnaliser mon invitation', '', ...rows.map(([k, v]) => k + ' : ' + v), '', 'Idée :', f.idea].join('\n');

  try {
    hits.push(now); recent.set(ip, hits);
    const sender = (process.env.FARHA_SENDER_EMAIL || 'farhacontact0@gmail.com').trim();
    const admin = (process.env.FARHA_ADMIN_EMAIL || 'farhacontact0@gmail.com').trim();
    const payload = { sender: { name: 'Farha', email: sender }, to: [{ email: admin }], replyTo: { email: f.email, name: f.client },
      subject: 'Farha · Nouvelle demande — ' + f.names + ' (' + f.event + ')', htmlContent: html, textContent: txt };
    if (attachment.length) payload.attachment = attachment;
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload)
    });
    if (!r.ok) { console.error('idea: brevo', r.status, (await r.text()).slice(0, 200)); return res.status(502).json({ error: 'Envoi impossible' }); }
    return res.status(201).json({ ok: true, images: attachment.length });
  } catch (e) {
    console.error('idea:', e.message);
    return res.status(500).json({ error: 'Envoi impossible' });
  }
};
