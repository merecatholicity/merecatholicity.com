/* Cover-image lightbox. Externalized from index.html so the site can run
   under a strict Content-Security-Policy with no inline scripts. */
document.querySelector('.amazon img').addEventListener('click', function () {
  var box = document.createElement('div');
  box.className = 'lightbox';
  var img = document.createElement('img');
  img.src = this.src;
  img.alt = this.alt;
  box.appendChild(img);
  function close() { box.remove(); document.onkeydown = null; }
  box.onclick = close;
  document.onkeydown = function (e) { if (e.key === 'Escape') close(); };
  document.body.appendChild(box);
});
