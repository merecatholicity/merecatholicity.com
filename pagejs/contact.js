/* Contact form: the submit handler and the challenge, which mounts only on
   intent. Externalized from contact.html so the site can run under a strict
   Content-Security-Policy with no inline scripts.

   THE CHALLENGE NEVER MOUNTS ON ARRIVAL (2026-09-09). This page used to carry
   Cloudflare's api.js in its markup — the implicit render, which mounts the
   widget the moment the page opens — and on a soft arrival this file rendered
   it again on boot. That is the exact pattern that takes the installed app
   down (the Turnstile postmortem in docs/architecture/INFRASTRUCTURE.md): the
   owner's report was "a white flash and a reload on the contact page", the
   document being replaced a second after the widget mounted. Now:
     - Cloudflare's script is loaded by THIS file, explicitly, and only once a
       reader shows intent: the first focus of a field, or the Send press.
     - The page is a full document load from the app (app/shell.ts treats
       contact.html as a document page): the challenge completes on a
       hard-loaded document and killed soft-navigated ones, and there is no
       identity here to spare the way the platform spares its members.
     - The widget stays visible (default appearance): on a contact form the
       reader should see the check happen.
   Swap-aware still: booting binds the CURRENT form. */
(function () {
  'use strict';
  var API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__mcContactTs';
  var widgetId = null;
  var wanted = false;

  function crumb(msg) { try { if (window.mcCrumb) window.mcCrumb(msg); } catch (e) { /* diagnosis only */ } }
  function slot() { return document.querySelector('.contact-ts'); }
  function tokenOf(form) {
    var i = form.querySelector('input[name="cf-turnstile-response"]');
    return i ? i.value : '';
  }

  /* The mount IS the challenge, so it is the moment worth naming. */
  function mount() {
    var s = slot();
    if (!s || !window.turnstile || s.hasAttribute('data-mc-rendered')) return;
    s.setAttribute('data-mc-rendered', '1');
    crumb('turnstile(contact): mounting the widget');
    try {
      widgetId = window.turnstile.render(s, {
        sitekey: s.getAttribute('data-sitekey'),
        /* Never re-run the challenge on a timer, never retry on a loop: a
           spent or expired token is replaced by reset() at the press. */
        'refresh-expired': 'never',
        retry: 'never',
      });
    } catch (e) { /* a double render throws; the first one stands */ }
  }
  window.__mcContactTs = function () { if (wanted) mount(); };

  /* Intent: load the script if it is not here yet, mount when it is. */
  function want() {
    wanted = true;
    if (window.turnstile) { mount(); return; }
    if (document.querySelector('script[src*="challenges.cloudflare.com"]')) return;   // arriving; onload mounts
    crumb('turnstile(contact): loading the script on intent');
    var s = document.createElement('script');
    s.src = API;
    s.async = true;
    document.head.appendChild(s);
  }
  function fresh() {
    try { if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); } catch (e) { /* the press will say so */ }
  }

  function boot() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    if (form.hasAttribute('data-mc-bound')) return;
    form.setAttribute('data-mc-bound', '1');
    /* The first touch of a real field is the earliest honest sign of intent
       (the honeypot is not one). */
    form.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.name === 'website') return;
      want();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('contact-status');
      var button = form.querySelector('.btn-send');
      button.disabled = true;
      want();
      /* A press with no token: the widget was never touched, or its token
         aged out (five minutes) while the message was being written — earn
         another rather than send a request that would be refused. */
      if (!tokenOf(form) && widgetId !== null) fresh();
      status.textContent = tokenOf(form) ? 'Sending...' : 'Verifying...';
      var waited = 0;
      (function go() {
        if (!tokenOf(form)) {
          if (waited >= 15000) {
            status.textContent = 'Verification is taking a moment. Complete the check above, then press Send again.';
            button.disabled = false;
            return;
          }
          waited += 250;
          setTimeout(go, 250);
          return;
        }
        status.textContent = 'Sending...';
        fetch(form.action, { method: 'POST', body: new FormData(form) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              form.reset();
              status.textContent = 'Sent. Thank you.';
            } else {
              status.textContent = d.error || 'Something went wrong. Please try again.';
            }
            fresh();   // a token is single-use either way
          })
          .catch(function () {
            status.textContent = 'Could not reach the server. Please try again.';
            fresh();
          })
          .finally(function () { button.disabled = false; });
      })();
    });
  }
  window.mcContactBoot = boot;
  boot();
})();
