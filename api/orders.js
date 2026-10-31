// Farha · /api/orders — enregistre une commande envoyée par le site public.
// Fonction serveur Vercel (Node.js, sans dépendance). Variables d'environnement à définir dans Vercel :
//   SUPABASE_URL               https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  clé « service_role » (ou « secret » sb_secret_...) — jamais dans le code.
// Le prix est toujours recalculé ici depuis la base : le montant envoyé par le navigateur est ignoré.
// Étape 5 : chaque commande de modèle crée aussi son invitation (lien /i/<slug>) :
//   test gratuit → publiée tout de suite ; commande payante → brouillon, publiée par l'admin.

const SUR_MESURE_PRICE = 50;          // Création sur mesure, en DT
const MAX_PER_EMAIL_10_MIN = 5;       // Limite anti-abus
const KINDS = ['template', 'test', 'sur_mesure'];

function clean(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// Détails libres (prénoms, date, lieu…) : uniquement des textes courts, 30 champs au plus.
function cleanDetails(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  Object.keys(obj).slice(0, 30).forEach(k => {
    const key = clean(k, 40);
    const val = obj[k];
    if (!key || val == null || typeof val === 'object') return;
    const s = clean(val, 2000);
    if (s && !/^blob:/i.test(s)) out[key] = s;
  });
  return out;
}

// Champs de l'invitation (ceux de readData() dans le site), sans le nom du modèle ajouté pour l'admin.
const INVITATION_FIELDS = ['bride', 'groom', 'date', 'time', 'place', 'map', 'message', 'color', 'music'];

function slugBase(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function randomSuffix() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = require('crypto').randomBytes(6);
  return Array.from(b, x => a[x % a.length]).join('');
}

function headers(key, extra) {
  const h = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, extra || {});
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; // ancienne clé JWT service_role
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

  // Uniquement depuis le site lui-même (même domaine).
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origine refusée' }); }
    catch (e) { return res.status(403).json({ error: 'Origine refusée' }); }
  }

  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) {
    return res.status(503).json({ error: 'Service non configuré' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Requête invalide' });
  if (JSON.stringify(body).length > 20000) return res.status(413).json({ error: 'Requête trop volumineuse' });

  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const c = body.customer || {};
  const customer = {
    name: clean(c.name, 120),
    email: clean(c.email, 160),
    phone: clean(c.phone, 40),
    address: clean(c.address, 300)
  };
  if (!kind) return res.status(400).json({ error: 'Type de commande invalide' });
  if (!customer.name || customer.name.length < 2) return res.status(400).json({ error: 'Nom manquant' });
  if (!customer.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) return res.status(400).json({ error: 'E-mail invalide' });
  const details = cleanDetails(body.details);

  try {
    // Limite : 5 commandes par e-mail sur 10 minutes.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await rest(base, key,
      'orders?select=id&customer_email=ilike.' + encodeURIComponent(customer.email.replace(/[%_*,()]/g, '')) +
      '&created_at=gte.' + encodeURIComponent(since));
    if (recent.length >= MAX_PER_EMAIL_10_MIN) return res.status(429).json({ error: 'Trop de demandes, réessayez plus tard.' });

    // Prix et libellé calculés côté serveur.
    let template = null, unit = 0, label;
    if (kind === 'sur_mesure') {
      unit = SUR_MESURE_PRICE;
      label = 'Création sur mesure';
    } else {
      const slug = clean(body.template_slug, 40);
      if (!slug || !/^[a-zA-Z0-9-]{2,40}$/.test(slug)) return res.status(400).json({ error: 'Modèle invalide' });
      const rows = await rest(base, key,
        'templates?select=id,name,price_dt,status,category:categories(default_price_dt,is_active)&slug=eq.' + encodeURIComponent(slug));
      template = rows[0];
      if (!template || template.status !== 'active' || !template.category || !template.category.is_active) {
        return res.status(400).json({ error: 'Modèle indisponible' });
      }
      unit = kind === 'test' ? 0 : Number(template.price_dt != null ? template.price_dt : template.category.default_price_dt);
      label = template.name + (kind === 'test' ? ' (test gratuit)' : '');
    }

    const [order] = await rest(base, key, 'orders?select=id,reference,total_dt', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        kind,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        customer_address: customer.address,
        total_dt: unit,
        payment_status: 'unpaid',
        processing_status: kind === 'test' ? 'completed' : 'new'
      })
    });
    await rest(base, key, 'order_items', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ order_id: order.id, template_id: template ? template.id : null, label, unit_price_dt: unit, quantity: 1, details })
    });
    let invitation = null;
    if (template) {
      const data = {};
      INVITATION_FIELDS.forEach(k => { if (details[k]) data[k] = details[k]; });
      const status = kind === 'test' ? 'published' : 'draft';
      const slugStart = slugBase([data.bride, data.groom].filter(Boolean).join(' ')) || 'invitation';
      for (let i = 0; i < 3 && !invitation; i++) {
        try {
          [invitation] = await rest(base, key, 'invitations?select=slug,status', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ slug: slugStart + '-' + randomSuffix(), order_id: order.id, template_id: template.id, data, status })
          });
        } catch (e) { if (e.status !== 409) throw e; } // lien déjà pris : nouveau tirage
      }
    }
    return res.status(201).json({
      reference: order.reference,
      total_dt: Number(order.total_dt),
      invitation: invitation ? { slug: invitation.slug, status: invitation.status } : null
    });
  } catch (e) {
    console.error('orders:', e.status || '', e.message);
    return res.status(500).json({ error: 'Enregistrement impossible pour le moment' });
  }
};
