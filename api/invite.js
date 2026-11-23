// Farha · /api/invite — page d'un lien court (www.invitation-digitale.tn/mariage-ahmed-et-samira).
// vercel.json envoie ces adresses ici. On renvoie la page du site avec :
//  - l'aperçu du partage (WhatsApp, Messenger…) propre à l'invitation : « Mariage de Ahmed et Samira »,
//  - le contenu de l'invitation déjà inscrit dans la page (pas d'attente, pas de page d'accueil visible).
// Variables d'environnement (comme /api/link) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'invitation-links';
const SLUG_RE = /^(mariage|henna|wteya|fiancailles|anniversaire|baby-shower|bridal-party|tahara|soutenance|naissance|fete)-[a-z0-9-]{1,80}$/;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function headers(key) { const h = { apikey: key }; if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; return h; }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// Titre de l'aperçu selon la collection (préfixe du lien) et les prénoms.
function title(kind, d) {
  const b = clean(d.bride, 60), g = clean(d.groom, 60);
  const two = (x, y) => [x, y].filter(Boolean).join(' et ');
  switch (kind) {
    case 'mariage': return 'Mariage de ' + two(g, b);
    case 'fiancailles': return 'Fiançailles de ' + two(b, g);
    case 'wteya': return 'Wtiya de ' + b;
    case 'henna': return 'Henna de ' + b;
    case 'bridal-party': return 'Bridal party de ' + b;
    case 'baby-shower': return 'Baby shower de ' + b;
    case 'anniversaire': return 'Anniversaire de ' + b;
    case 'tahara': return 'Tahara de ' + b;
    case 'soutenance': return 'Soutenance de ' + b;
    case 'naissance': return 'Naissance de ' + b;
    default: return 'Invitation' + (b ? ' · ' + two(b, g) : '');
  }
}
function description(d) {
  const m = String(d.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? (+m[3] === 1 ? '1er' : +m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  const parts = [date, clean(d.place, 120)].filter(Boolean);
  return 'Vous êtes invités ✦ ' + (parts.length ? parts.join(' · ') : 'Ouvrez l’invitation');
}

module.exports = async function handler(req, res) {
  const s = String((req.query && req.query.s) || new URL(req.url, 'https://x').searchParams.get('s') || '');
  const host = String(req.headers.host || 'www.invitation-digitale.tn');
  const site = 'https://' + host;
  let page;
  try {
    const r = await fetch(site + '/index.html');
    page = await r.text();
    if (!r.ok || !/<head>/.test(page)) throw new Error('page ' + r.status);
  } catch (e) { console.error('invite: page', e.message); res.setHeader('Location', '/'); return res.status(302).end(); }

  let code = '', d = {};
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (SLUG_RE.test(s) && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) && key) {
    try {
      const r = await fetch(base + '/storage/v1/object/authenticated/' + BUCKET + '/' + s + '.json', { headers: headers(key) });
      if (r.ok) {
        const j = JSON.parse(await r.text());
        if (j && /^[A-Za-z0-9_-]{10,12000}$/.test(j.i || '')) {
          code = j.i;
          const o = JSON.parse(Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
          d = (o && o.d && typeof o.d === 'object') ? o.d : {};
        }
      }
    } catch (e) { console.error('invite: lecture', e.message); }
  }

  if (code) {
    const t = esc(title(s.split('-')[0] === 'baby' ? 'baby-shower' : s.split('-')[0] === 'bridal' ? 'bridal-party' : s.split('-')[0], d));
    const desc = esc(description(d));
    page = page
      .replace(/<title>[^<]*<\/title>/, '<title>' + t + '</title>')
      .replace(/(<meta property="og:title" content=")[^"]*/, '$1' + t)
      .replace(/(<meta property="og:description" content=")[^"]*/, '$1' + desc)
      .replace(/(<meta name="description" content=")[^"]*/, '$1' + desc)
      .replace(/(<meta name="twitter:title" content=")[^"]*/, '$1' + t)
      .replace(/(<meta name="twitter:description" content=")[^"]*/, '$1' + desc)
      .replace(/(<meta property="og:url" content=")[^"]*/, '$1' + esc(site + '/' + s))
      // le contenu de l'invitation est inscrit tout de suite : la page s'ouvre directement sur l'invitation
      .replace('<head>', '<head><script>history.replaceState(null,"",location.pathname+"#i=' + code + '");document.documentElement.classList.add("farha-guest")</script>');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(code ? 200 : 404).send(page);
};
