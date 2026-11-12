// Farha · Microsoft Clarity (statistiques de visite : pages, clics, défilement) et gestion des cookies.
// Chargé une seule fois par page, uniquement sur le site en ligne (farha.tn, farha-bay.vercel.app).
// Confidentialité :
//  - jamais sur le back-office (/admin), les previews, ni les invitations ouvertes par les invités (liens #i=…
//    et /i/…, dont l'adresse contient les prénoms, la date et le lieu) ;
//  - tous les champs de saisie, les formulaires de commande / demande / avis, l'aperçu personnalisé
//    et la page de livraison sont masqués dans les enregistrements (data-clarity-mask) ;
//  - sur les anciennes pages d'invitation (invitation-*.html), tout le texte est masqué ;
//  - Clarity n'est chargé qu'après l'accord du visiteur (bandeau « Accepter / Refuser », choix mémorisé
//    dans ce navigateur) ; sans réponse ou en cas de refus, rien n'est chargé ;
//  - le lien « Gestion des cookies » (pied de page, politique de confidentialité) rouvre le bandeau à tout moment :
//    un refus après un accord arrête le suivi et supprime les cookies Clarity.
(function () {
  'use strict';
  var ID = 'z9c8rjwlil';
  if (window.__farhaClarity) return; // déjà chargé
  window.__farhaClarity = true;

  // Suivi autorisé seulement ici (les autres pages gardent le bandeau pour choisir, sans jamais charger Clarity).
  var allowed = /^(www\.)?(farha\.tn|farha-bay\.vercel\.app|invitation-digitale\.tn)$/i.test(location.hostname) &&
    !/^\/admin(\/|$)/.test(location.pathname) && !/^\/i\//.test(location.pathname) && !/^#i=/.test(location.hash);

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
  var queued = false, observer = null;
  function later() { if (queued) return; queued = true; setTimeout(function () { queued = false; mask(); }, 200); }

  // ----- chargement de Clarity (une seule fois) -----
  var loaded = false, running = false;
  function start() {
    mask();
    if (!observer) try { observer = new MutationObserver(later); observer.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    if (!loaded) {
      loaded = true;
      // code de suivi fourni par Microsoft Clarity
      (function (c, l, a, r, i, t, y) {
        c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
        t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
        y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
      })(window, document, 'clarity', 'script', ID);
    } else {
      try { window.clarity('start'); } catch (e) {} // de nouveau accepté après un refus, sans recharger
    }
    try { window.clarity('consent'); } catch (e) {}
    running = true;
  }

  // ----- retrait du consentement : arrêt du suivi + suppression des cookies Clarity -----
  var CLARITY_COOKIES = ['_clck', '_clsk', 'CLID', 'ANONCHK', 'MR', 'MUID', 'SM'];
  function eraseCookies() {
    var host = location.hostname, parts = host.split('.'), domains = ['', host, '.' + host];
    for (var i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
    CLARITY_COOKIES.forEach(function (name) {
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/' + (d ? '; domain=' + d : '');
      });
    });
    // données éventuellement gardées par Clarity dans le navigateur
    [window.localStorage, window.sessionStorage].forEach(function (st) {
      try { Object.keys(st).forEach(function (k) { if (/^_cl/.test(k)) st.removeItem(k); }); } catch (e) {}
    });
  }
  function stop() {
    if (running) {
      try { window.clarity('consent', false); } catch (e) {} // demande à Clarity d'effacer ses cookies et de terminer la session
      try { window.clarity('stop'); } catch (e) {}
      running = false;
    }
    eraseCookies();
  }

  // ----- choix du visiteur -----
  var KEY = 'farha-consent-analytics';
  function getChoice() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setChoice(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function accept() { setChoice('granted'); if (allowed) start(); }
  function refuse() { setChoice('denied'); stop(); }

  // ----- bandeau -----
  var PRIVACY_URL = '/confidentialite.html';
  function closeBanner() { var b = document.getElementById('farhaConsent'), s = document.getElementById('farha-consent-style'); if (b) b.remove(); if (s) s.remove(); }
  function banner(fromLink) {
    if (document.getElementById('farhaConsent')) return;
    var choice = getChoice();
    var css = document.createElement('style'); css.id = 'farha-consent-style';
    css.textContent = '#farhaConsent{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;width:min(420px,calc(100% - 24px));box-sizing:border-box;' +
      'padding:16px 18px 14px;border-radius:20px;background:#fffaf4;border:1px solid #ead9c9;box-shadow:0 18px 44px rgba(74,9,22,.18),0 2px 6px rgba(74,9,22,.06);' +
      'font:400 13.5px/1.5 "DM Sans",system-ui,sans-serif;color:#5b4842;animation:fcIn .45s cubic-bezier(.2,.8,.2,1) both}' +
      '@keyframes fcIn{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '#farhaConsent .fc-title{display:block;margin:0 0 4px;font:600 19px/1.2 "Cormorant Garamond",Georgia,serif;color:#4a0916}' +
      '#farhaConsent p{margin:0}' +
      '#farhaConsent .fc-state{display:block;margin-top:6px;font-size:12px;color:#9a8278}' +
      '#farhaConsent .fc-row{display:flex;justify-content:flex-end;gap:10px;margin-top:12px}' +
      '#farhaConsent .fc-more{white-space:nowrap;color:#4a0916;font-weight:500;text-decoration:underline;text-underline-offset:3px}' +
      '#farhaConsent .fc-more:hover{color:#6a1a2c}' +
      '#farhaConsent button{all:unset;box-sizing:border-box;cursor:pointer;min-width:96px;padding:9px 18px;border-radius:999px;text-align:center;font:600 13px "DM Sans",system-ui,sans-serif;transition:background .2s,color .2s}' +
      '#farhaConsent .fc-no{color:#4a0916;border:1.5px solid #4a0916}#farhaConsent .fc-no:hover{background:#f3e6dc}' +
      '#farhaConsent .fc-yes{background:#4a0916;color:#f6e7d2;border:1.5px solid #4a0916}#farhaConsent .fc-yes:hover{background:#6a1a2c}' +
      '#farhaConsent button:focus-visible,#farhaConsent a:focus-visible{outline:2px solid #b07c34;outline-offset:2px}' +
      '@media(max-width:480px){#farhaConsent{bottom:12px;padding:14px 16px 12px}#farhaConsent button{flex:1}}' +
      '@media(prefers-reduced-motion:reduce){#farhaConsent{animation:none}}';
    var box = document.createElement('div'); box.id = 'farhaConsent'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-labelledby', 'farhaConsentTitle');
    var state = fromLink ? '<span class="fc-state">Votre choix actuel : ' + (choice === 'granted' ? 'cookies acceptés' : choice === 'denied' ? 'cookies refusés' : 'aucun choix') + '.</span>' : '';
    box.innerHTML = '<strong class="fc-title" id="farhaConsentTitle">Une petite touche de douceur ! 💌</strong>' +
      '<p>Nous utilisons des cookies pour mieux comprendre vos visites et améliorer votre expérience sur FARHA. À vous de choisir ! <a class="fc-more" href="' + PRIVACY_URL + '#cookies">En savoir plus</a>' + state + '</p>' +
      '<div class="fc-row">' +
      '<button type="button" class="fc-no">Refuser</button><button type="button" class="fc-yes">Accepter</button></div>';
    box.querySelector('.fc-yes').addEventListener('click', function () { closeBanner(); accept(); });
    box.querySelector('.fc-no').addEventListener('click', function () { closeBanner(); refuse(); });
    document.head.appendChild(css); document.body.appendChild(box);
    if (fromLink) try { box.querySelector(choice === 'granted' ? '.fc-no' : '.fc-yes').focus(); } catch (e) {}
  }

  // API utilisée par le lien « Gestion des cookies »
  window.farhaCookies = {
    open: function () { closeBanner(); banner(true); },
    accept: accept,
    refuse: refuse,
    choice: getChoice
  };
  // lien « Gestion des cookies » : tout élément [data-farha-cookies] (pied de page, politique de confidentialité)
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-farha-cookies]');
    if (t) { e.preventDefault(); window.farhaCookies.open(); }
  });

  function init() {
    var c = getChoice();
    if (c === 'granted') { if (allowed) start(); }
    else if (c !== 'denied' && allowed) banner(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // si un lien d'invitation est ouvert sans recharger la page, on arrête d'enregistrer
  addEventListener('hashchange', function () { if (/^#i=/.test(location.hash) && running) { try { window.clarity('stop'); } catch (e) {} running = false; } });
})();
