/* Contact form submit handler. Externalized from contact.html so the site
   can run under a strict Content-Security-Policy with no inline scripts. */
document.getElementById('contact-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var form = e.target;
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
        if (window.turnstile) turnstile.reset();
      }
    })
    .catch(function () {
      status.textContent = 'Could not reach the server. Please try again.';
      if (window.turnstile) turnstile.reset();
    })
    .finally(function () { button.disabled = false; });
});
