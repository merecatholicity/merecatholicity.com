/* Cover-image boot. The click-to-zoom lightbox was removed by request; the
   cover image stays in place, just no longer pops out. Kept as a no-op boot so
   the app shell's per-page registry still has something to call on arrival. */
(function () {
  'use strict';
  function boot() {}
  window.mcIndexBoot = boot;
  boot();
})();
