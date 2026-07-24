/* Non-fading notice shown on the terms page after a lock or IP ban has logged
   someone out and redirected them here. It reads a one-shot message left in
   localStorage and renders a fixed banner that stays until dismissed by hand.
   Externalized (no inline code) so the strict Content-Security-Policy admits
   it under script-src 'self'. */
(function () {
  'use strict';
  var msg;
  try { msg = localStorage.getItem('mc-flash'); } catch (e) { return; }
  if (!msg) return;
  var bar = document.createElement('div');
  bar.className = 'mc-flash';
  var text = document.createElement('span');
  text.textContent = msg;
  bar.appendChild(text);
  var x = document.createElement('button');
  x.type = 'button';
  x.className = 'mc-flash-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  x.addEventListener('click', function () {
    try { localStorage.removeItem('mc-flash'); } catch (e) {}
    bar.remove();
  });
  bar.appendChild(x);
  function show() { document.body.appendChild(bar); }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
