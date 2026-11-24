// Farha · /api/perso-message — message d'un invité depuis une invitation personnalisée (/invitation/<nom>),
// envoyé par e-mail (Brevo) à l'adresse prévue pour cette invitation.
// Variables d'environnement Vercel : BREVO_API_KEY, FARHA_SENDER_EMAIL.

// invitation → destinataire et titre
const PAGES = {
  'oussema-et-nesrine': { to: 'Nesrinetahari5@gmail.com', title: 'Mariage de Oussema & Nesrine' },
  'wtiya-nesrine': { to: 'Nesrinetahari5@gmail.com', title: 'Wtiya de Nesrine', rsvp: true }
};
const MAX_PER_IP_10_MIN = 6;
const recent = new Map();
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }
  const origin = req.headers.origin;
  if (!origin) return res.status(403).json({ error: 'Origine refusée' });
  try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
  catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const page = PAGES[clean(body && body.page, 80)];
  const name = clean(body && body.name, 120), message = clean(body && body.message, 1200);
  if (!page) return res.status(404).json({ error: 'Invitation inconnue' });
  const att = typeof (body && body.attending) === 'boolean' ? body.attending : null;
  if (name.length < 2 || (!message && att === null)) return res.status(400).json({ error: 'Nom et message requis' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu';
  const now = Date.now(), hits = (recent.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (hits.length >= MAX_PER_IP_10_MIN) return res.status(429).json({ error: 'Trop de messages, réessayez plus tard.' });
  hits.push(now); recent.set(ip, hits);

  const key = (process.env.BREVO_API_KEY || '').trim();
  const sender = (process.env.FARHA_SENDER_EMAIL || 'farhacontact0@gmail.com').trim();
  if (!key) return res.status(503).json({ error: 'Envoi non configuré' });
  const answer = att === null ? '' : att ? 'Présent(e) ✅' : 'Absent(e) ❌';
  const subject = page.rsvp ? 'Farha · ' + name + ' — ' + (answer || 'réponse') + ' — ' + page.title : 'Farha · Un mot pour les mariés de ' + name + ' — ' + page.title;
  const html = '<div style="font-family:Georgia,serif;max-width:560px;margin:auto;padding:24px;background:#f6f0e6;color:#3d2f2b">' +
    '<p style="margin:0 0 6px;font:600 12px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#4a0916">' + esc(page.title) + '</p>' +
    '<h1 style="margin:0 0 16px;font-weight:400;font-size:26px">' + (page.rsvp ? 'Réponse de ' : 'Un mot de ') + esc(name) + '</h1>' + (answer ? '<p style="margin:0 0 14px;font:600 16px Arial,sans-serif">' + answer + '</p>' : '') +
    (message ? '<blockquote style="margin:0;padding:16px 18px;background:#fffaf4;border-left:3px solid #a57e5a;border-radius:6px;font-size:17px;line-height:1.6;white-space:pre-wrap">' + esc(message) + '</blockquote>' : '') +
    '<p style="margin:18px 0 0;font:12px Arial,sans-serif;color:#7d6760">Envoyé depuis l’invitation digitale Farha.</p></div>';
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'Farha', email: sender }, to: [{ email: page.to }], subject, htmlContent: html, textContent: page.title + '\n\n' + name + (answer ? ' — ' + answer : '') + (message ? '\n' + message : '') }) });
    if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()).slice(0, 160));
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('perso-message:', e.message); return res.status(502).json({ error: 'Votre message n’a pas pu être envoyé. Réessayez.' }); }
};
