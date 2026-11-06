// Farha · Microsoft Clarity (statistiques de visite : pages, clics, défilement).
// Chargé une seule fois par page, uniquement sur le site en ligne (farha.tn, farha-bay.vercel.app).
// Confidentialité :
//  - jamais sur le back-office (/admin) ni sur les invitations ouvertes par les invités (liens #i=…,
//    dont l'adresse contient les prénoms, la date et le lieu) ;
//  - tous les champs de saisie, les formulaires de commande / demande / avis, l'aperçu personnalisé
//    et la page de livraison sont masqués dans les enregistrements (data-clarity-mask) ;
//  - sur les anciennes pages d'invitation (invitation-*.html), tout le texte est masqué.
(function () {
  'use strict';
  var ID = 'z9c8rjwlil';
  if (window.__farhaClarity) return; // déjà chargé
  window.__farhaClarity = true;
  if (!/^(www\.)?(farha\.tn|farha-bay\.vercel\.app)$/i.test(location.hostname)) return;
  if (/^\/admin(\/|$)/.test(location.pathname)) return;
  if (/^#i=/.test(location.hash) || /^\/i\//.test(location.pathname)) return;

  var PRIVATE = [
    'input', 'textarea', 'select', 'iframe',
    '#custom .panel', '#checkout', '#complete', '#request',
    '#clientDialog', '#clientForm', '#feedbackDialog', '#ideaDialog', '#bespokeForm',
    '[data-farha-private]'
  ].join(',');
  var invitationPage = /\/invitation-[^/]*\.html$/i.test(location.pathname);
  function mask() {
    try {
      if (invitationPage && document.body) document.body.setAttribute('data-clarity-mask', 'True');
      document.querySelectorAll(PRIVATE).forEach(function (el) {
        if (el.getAttribute('data-clarity-mask') !== 'True') el.setAttribute('data-clarity-mask', 'True');
      });
    } catch (e) {}
  }
  var queued = false;
  function later() { if (queued) return; queued = true; setTimeout(function () { queued = false; mask(); }, 200); }
  function start() {
    mask();
    try { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    // code de suivi fourni par Microsoft Clarity
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', ID);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // si un lien d'invitation est ouvert sans recharger la page, on arrête d'enregistrer
  addEventListener('hashchange', function () { if (/^#i=/.test(location.hash) && window.clarity) try { window.clarity('stop'); } catch (e) {} });
})();
