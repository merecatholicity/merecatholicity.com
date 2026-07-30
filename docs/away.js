/* The off-site warning interstitial. A post's off-site link points here as
   away.html?url=<encoded>; this reads that target, shows it plainly, and hands
   the reader a Continue button they must click. Only an http(s) target is ever
   offered as a link; anything else (javascript:, data:, relative, missing) is
   refused. Externalized (no inline code) so the strict Content-Security-Policy
   admits it under script-src 'self'. Built from createElement + textContent
   only, so a hostile URL can never inject markup. */
(function () {
  'use strict';
  var main = document.querySelector('.away');
  if (!main) return;

  var raw = '';
  try { raw = new URLSearchParams(location.search).get('url') || ''; } catch (e) { raw = ''; }

  /* Parse and keep it only if it is a real web address. new URL throws on a
     relative or malformed value; a non-web scheme is dropped. */
  var safe = null;
  try {
    var u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') safe = u.href;
  } catch (e) { safe = null; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function goBack() {
    if (history.length > 1) history.back();
    else location.href = 'community.html';
  }

  main.textContent = '';
  var actions = el('div', 'away-actions');

  if (!safe) {
    main.appendChild(el('h1', 'away-head', 'That link is missing or not a valid web address.'));
    main.appendChild(el('p', 'away-note', 'Only ordinary web links (http or https) are followed from here.'));
    var backOnly = el('button', 'btn btn-anon', 'Go back');
    backOnly.type = 'button';
    backOnly.addEventListener('click', goBack);
    actions.appendChild(backOnly);
    main.appendChild(actions);
    return;
  }

  main.appendChild(el('h1', 'away-head', 'You are leaving merecatholicity.com'));
  main.appendChild(el('p', 'away-note', "This link goes to an off-site resource we don't control:"));
  main.appendChild(el('p', 'away-url', safe));

  var cont = el('a', 'btn btn-send', 'Continue to site');
  cont.href = safe;
  cont.rel = 'nofollow noopener noreferrer external';
  actions.appendChild(cont);

  var back = el('button', 'btn btn-anon', 'Go back');
  back.type = 'button';
  back.addEventListener('click', goBack);
  actions.appendChild(back);

  main.appendChild(actions);
})();
