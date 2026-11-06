// Farha · Microsoft Clarity (statistiques de visite : pages, clics, défilement).
// Chargé une seule fois par page, uniquement sur le site en ligne (farha.tn, farha-bay.vercel.app).
// Confidentialité :
//  - jamais sur le back-office (/admin) ni sur les invitations ouvertes par les invités (liens #i=…,
//    dont l'adresse contient les prénoms, la date et le lieu) ;
//  - tous les champs de saisie, les formulaires de commande / demande / avis, l'aperçu personnalisé
//    et la page de livraison sont masqués dans les enregistrements (data-clarity-mask) ;
//  - sur les anciennes pages d'invitation (invitation-*.html), tout le texte est masqué ;
//  - Clarity n'est chargé qu'après l'accord du visiteur (bandeau « Accepter / Refuser », choix mémorisé
//    dans ce navigateur) ; sans réponse ou en cas de refus, rien n'est chargé.
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
  // ----- consentement -----
  var KEY = 'farha-consent-analytics', started = false;
  function getChoice() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setChoice(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function go() { if (started) return; started = true; start(); try { window.clarity('consent'); } catch (e) {} }
  function banner() {
    if (document.getElementById('farhaConsent')) return;
    var css = document.createElement('style'); css.id = 'farha-consent-style';
    css.textContent = '#farhaConsent{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483646;width:min(560px,calc(100% - 32px));box-sizing:border-box;' +
      'display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:14px 16px;border-radius:16px;background:#fffaf4;border:1px solid #e5d8cb;' +
      'box-shadow:0 14px 40px rgba(74,9,22,.18);font:400 13.5px/1.45 "DM Sans",system-ui,sans-serif;color:#4a3b36}' +
      '#farhaConsent p{margin:0;flex:1 1 260px}#farhaConsent b{color:#4a0916}' +
      '#farhaConsent .fc-btns{display:flex;gap:8px;margin-left:auto}' +
      '#farhaConsent button{all:unset;cursor:pointer;padding:9px 16px;border-radius:999px;font:600 13px "DM Sans",system-ui,sans-serif;letter-spacing:.01em}' +
      '#farhaConsent .fc-no{color:#4a0916;border:1px solid #d8c3b4}#farhaConsent .fc-yes{background:#4a0916;color:#f6e7d2}' +
      '#farhaConsent button:focus-visible{outline:2px solid #b07c34;outline-offset:2px}' +
      '@media(max-width:520px){#farhaConsent{bottom:10px}#farhaConsent .fc-btns{width:100%}#farhaConsent button{flex:1;text-align:center}}';
    var box = document.createElement('div'); box.id = 'farhaConsent'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-label', 'Statistiques de visite');
    box.innerHTML = '<p><b>Statistiques de visite</b> · Nous utilisons Microsoft Clarity (cookies) pour comprendre comment le site est utilisé et l’améliorer. ' +
      'Vos saisies et vos informations de commande ne sont jamais enregistrées.</p>' +
      '<div class="fc-btns"><button type="button" class="fc-no">Refuser</button><button type="button" class="fc-yes">Accepter</button></div>';
    function close() { box.remove(); css.remove(); }
    box.querySelector('.fc-yes').addEventListener('click', function () { setChoice('granted'); close(); go(); });
    box.querySelector('.fc-no').addEventListener('click', function () { setChoice('denied'); close(); });
    document.head.appendChild(css); document.body.appendChild(box);
  }
  function init() { var c = getChoice(); if (c === 'granted') go(); else if (c !== 'denied') banner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // si un lien d'invitation est ouvert sans recharger la page, on arrête d'enregistrer
  addEventListener('hashchange', function () { if (/^#i=/.test(location.hash) && window.clarity) try { window.clarity('stop'); } catch (e) {} });
})();
