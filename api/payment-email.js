// Farha · /api/payment-email — e-mails envoyés quand le client clique sur « Cliquer pour payer ».
// Fonction serveur Vercel (Node.js, sans dépendance), envoi via l'API Brevo. Variables d'environnement Vercel :
//   BREVO_API_KEY       clé API Brevo (xkeysib-...) — jamais dans le code.
//   FARHA_SENDER_EMAIL  expéditeur validé dans Brevo (par défaut farhacontact0@gmail.com)
//   FARHA_ADMIN_EMAIL   destinataire des commandes (par défaut farhacontact0@gmail.com)
// Deux e-mails : le client reçoit le prix et les coordonnées bancaires ; l'admin reçoit la commande et le lien
// non flouté de l'invitation, à envoyer au client après réception du virement.
// Le texte des e-mails est construit ici : le navigateur n'envoie que des champs courts, jamais de contenu libre.

// COORDONNÉES DE TEST : à remplacer par le vrai compte avant la mise en production.
const BANK = {
  titulaire: 'FARHA · compte de test',
  banque: 'Banque de test',
  rib: '00 000 0000000000000 00 (RIB de test, ne pas utiliser)'
};
// NUMÉRO DE TEST : téléphone et WhatsApp de l'équipe, affichés en signature de l'e-mail client.
const PHONE = '00 000 000';
const MAX_PER_IP_10_MIN = 5; // limite anti-abus (par instance serveur)
const recent = new Map();

function clean(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 1000) / 1000 : null;
}

// Mise en page commune : un titre, des lignes « libellé : valeur », puis un paragraphe de fin.
function page(title, intro, rows, outro, box) {
  const lines = rows.filter(r => r[1] !== '' && r[1] != null).map(([k, v, link]) =>
    '<tr><td style="padding:6px 12px 6px 0;color:#8a7a70;white-space:nowrap;vertical-align:top">' + esc(k) + '</td><td style="padding:6px 0;color:#29252c">' +
    (link ? '<a href="' + esc(v) + '" style="color:#8d4565;word-break:break-all">' + esc(v) + '</a>' : esc(v)) + '</td></tr>').join('');
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;background:#faf7f5;padding:24px">' +
    '<div style="max-width:560px;margin:auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #eadfd6">' +
    '<div style="font-size:22px;color:#551d30;font-weight:bold;margin-bottom:6px">Farha ✦</div>' +
    '<h1 style="font-size:20px;color:#551d30;margin:0 0 14px">' + esc(title) + '</h1>' +
    intro.map(p => '<p style="margin:0 0 12px">' + esc(p) + '</p>').join('') +
    '<table style="border-collapse:collapse;margin:8px 0 16px">' + lines + '</table>' +
    (box ? '<div style="margin:4px 0 18px;padding:14px 16px;border-radius:10px;background:#fbf1e6;border:1px dashed #c9a27a">' +
      '<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#8d4565;margin-bottom:6px">' + esc(box.title) + '</div>' +
      (box.ok ? '<a href="' + esc(box.value) + '" style="color:#8d4565;word-break:break-all">' + esc(box.value) + '</a>' : '<span style="color:#29252c">' + esc(box.value) + '</span>') + '</div>' : '') +
    outro.map(p => '<p style="margin:0 0 12px">' + esc(p) + '</p>').join('') +
    '</div></div>';
}
function text(title, intro, rows, outro, box) {
  return [title, '', ...intro, '', ...rows.filter(r => r[1] !== '' && r[1] != null).map(([k, v]) => k + ' : ' + v), '', ...(box ? [box.title + ' : ' + box.value, ''] : []), ...outro].join('\n');
}

async function send(key, sender, to, replyTo, subject, html, txt) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Farha', email: sender }, to: [to], replyTo, subject, htmlContent: html, textContent: txt })
  });
  if (!r.ok) {
    const t = await r.text();
    let code = null, message = null; try { const j = JSON.parse(t); code = j.code || null; message = String(j.message || '').slice(0, 160) || null; } catch (e) {}
    throw Object.assign(new Error('Brevo ' + r.status + ' ' + t.slice(0, 200)), { status: r.status, code, brevoMessage: message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }); }

  // Uniquement depuis le site lui-même (même domaine).
  const origin = req.headers.origin;
  if (!origin) return res.status(403).json({ error: 'Origine refusée' });
  try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
  catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }

  const key = process.env.BREVO_API_KEY || '';
  const sender = process.env.FARHA_SENDER_EMAIL || 'farhacontact0@gmail.com';
  const admin = process.env.FARHA_ADMIN_EMAIL || 'farhacontact0@gmail.com';
  if (!key) return res.status(503).json({ error: 'Envoi d’e-mails non configuré' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Requête invalide' });
  if (JSON.stringify(body).length > 12000) return res.status(413).json({ error: 'Requête trop volumineuse' });

  const c = body.customer || {}, o = body.order || {};
  const customer = { name: clean(c.name, 120), email: clean(c.email, 160), phone: clean(c.phone, 40), address: clean(c.address, 300) };
  if (customer.name.length < 2) return res.status(400).json({ error: 'Nom manquant' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) return res.status(400).json({ error: 'E-mail invalide' });
  const order = {
    reference: clean(body.reference, 40), model: clean(o.model, 120), names: clean(o.names, 160), date: clean(o.date, 80), eventDate: clean(o.event_date, 60),
    place: clean(o.place, 200), music: clean(o.music, 120), base: money(o.base), musicPrice: money(o.music_price), total: money(o.total)
  };
  if (!order.model || order.total == null || order.base == null) return res.status(400).json({ error: 'Commande invalide' });
  // Le lien doit ouvrir une invitation de ce site (ou du site principal).
  const link = clean(body.link, 8000);
  let linkOk = false;
  try { const u = new URL(link); linkOk = u.protocol === 'https:' && (u.host === req.headers.host || u.host === 'farha-bay.vercel.app') && /^#i=[A-Za-z0-9_-]+$/.test(u.hash); } catch (e) {}

  // Limite comptée uniquement sur les demandes valides.
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu';
  const now = Date.now(), list = (recent.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= MAX_PER_IP_10_MIN) return res.status(429).json({ error: 'Trop de demandes, réessayez plus tard.' });
  list.push(now); recent.set(ip, list);

  // Date et heure de la commande (heure de Tunis).
  const placedAt = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Tunis', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ref = order.reference || 'en attente';
  // Motif du virement : référence + nom du client + date de l'événement.
  const motif = [order.reference || 'Farha', customer.name, order.eventDate].filter(Boolean).join(' · ');
  const recap = [['Commande passée le', placedAt], ['Modèle', order.model], ['Invitation', order.names], ['Date de l’événement', order.date], ['Lieu', order.place],
    ['Musique', order.music], ['Prix de l’invitation', order.base + ' DT'], ...(order.musicPrice ? [['Prix de la musique', order.musicPrice + ' DT']] : []),
    ['Total à régler', order.total + ' DT']];

  // E-mail client : prix et virement.
  const cTitle = 'Votre invitation est prête ✦';
  const cIntro = ['Bonjour ' + customer.name + ',', 'Merci pour votre commande sur Farha ! Voici le récapitulatif et les informations pour le règlement.'];
  const cRows = [['Référence de la commande', ref], ...recap,
    ['Titulaire du compte', BANK.titulaire], ['Banque', BANK.banque], ['RIB', BANK.rib], ['Motif du virement', motif]];
  const cOutro = ['Pour confirmer votre commande, effectuez un virement de ' + order.total + ' DT avec le motif ci-dessus.',
    'Dès réception du virement, l’équipe Farha vous envoie le lien de votre invitation, prêt à partager avec vos invités.',
    'Une question ? Répondez simplement à cet e-mail.', 'L’équipe Farha ✦ · Téléphone et WhatsApp : ' + PHONE];

  // E-mail admin : commande complète et lien non flouté.
  const aTitle = 'Nouvelle commande' + (order.reference ? ' ' + order.reference : '') + ' — ' + (order.names || customer.name);
  const aRows = [['Référence back-office', order.reference || 'Non enregistrée dans le back-office (vérifier la configuration Supabase)'], ['Client', customer.name], ['E-mail', customer.email], ['Téléphone', customer.phone],
    ['Adresse', customer.address], ...recap, ['Motif attendu', motif]];
  // Lien réservé à Farha : hors du récapitulatif client, dans un encadré à part.
  const aBox = { title: 'Réservé à Farha · lien de l’invitation (à envoyer au client après le virement)', value: linkOk ? link : 'Lien non valide, à recréer depuis le back-office', ok: linkOk };
  const aIntro = ['Un client vient de cliquer sur « Payer ». Il a reçu le RIB par e-mail.'];
  const aOutro = ['Cet e-mail est interne : le client ne l’a pas reçu. Après réception du virement, envoyez-lui le lien encadré ci-dessus.'];

  try {
    await send(key, sender, { email: customer.email, name: customer.name }, { email: admin, name: 'Farha' },
      'Farha · Votre commande' + (order.reference ? ' ' + order.reference : '') + ' et les détails du paiement', page(cTitle, cIntro, cRows, cOutro), text(cTitle, cIntro, cRows, cOutro));
  } catch (e) {
    console.error('payment-email: client', e.message);
    // Diagnostic sans révéler la clé : son type (préfixe) et sa longueur.
    const kind = /^xkeysib-/.test(key) ? 'api' : /^xsmtpsib-/.test(key) ? 'smtp' : 'inconnu';
    return res.status(502).json({ error: 'E-mail client non envoyé', status: e.status || null, brevo: e.code || null, message: e.brevoMessage || null,
      cle: { type: kind, longueur: key.length, espaces: key !== key.trim() } });
  }
  try {
    await send(key, sender, { email: admin, name: 'Farha' }, { email: customer.email, name: customer.name },
      '[Interne] Farha · ' + aTitle, page(aTitle, aIntro, aRows, aOutro, aBox), text(aTitle, aIntro, aRows, aOutro, aBox));
  } catch (e) {
    console.error('payment-email: admin', e.message);
    return res.status(207).json({ client: true, admin: false });
  }
  return res.status(200).json({ client: true, admin: true });
};
