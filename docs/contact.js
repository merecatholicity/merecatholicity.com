/* Contact form submit handler. Externalized from contact.html so the site
   can run under a strict Content-Security-Policy with no inline scripts.
   Swap-aware: booting binds the CURRENT form (a fresh element each soft
   navigation) and re-renders the Turnstile widget, whose api.js script tag
   arrives inert in swapped content. */
(function () {
  'use strict';
  function boot() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    if (form.hasAttribute('data-mc-bound')) return;
    form.setAttribute('data-mc-bound', '1');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('contact-status');
      var button = form.querySelector('.btn-send');
      button.disabled = true;
      status.textContent = 'Sending...';
      fetch(form.action, { method: 'POST', body: new FormData(form) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) {
            form.reset();
            status.textContent = 'Sent. Thank you.';
          } else {
            status.textContent = d.error || 'Something went wrong. Please try again.';
            if (window.turnstile) window.turnstile.reset();
          }
        })
        .catch(function () {
          status.textContent = 'Could not reach the server. Please try again.';
          if (window.turnstile) window.turnstile.reset();
        })
        .finally(function () { button.disabled = false; });
    });
    /* Turnstile: on a hard load its api.js scans and renders the widget by
       itself; on a soft arrival the script tag came in inert, so render (or
       load) explicitly against the fresh container. */
    var slot = document.querySelector('.cf-turnstile');
    if (slot && !slot.hasAttribute('data-mc-rendered')) {
      if (window.turnstile) {
        slot.setAttribute('data-mc-rendered', '1');
        try { window.turnstile.render(slot, { sitekey: slot.getAttribute('data-sitekey') }); } catch (e) { /* already */ }
      } else if (!document.querySelector('script[src*="challenges.cloudflare.com"]')) {
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        s.async = true;
        document.head.appendChild(s);
      }
    }
  }
  window.mcContactBoot = boot;
  boot();
})();
