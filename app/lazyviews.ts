/* app/lazyviews.ts — the on-demand view modules' registry stubs, and the hold
   that lets a late mount land only for the route that asked for it.

   Four of the six view modules load on demand (app/shell.ts LAZY_VIEWS says
   which, and why). Each registry entry starts as a stub that fetches its
   module. The module overwrites its own entry as it evaluates, and the stub
   then calls THAT. If it somehow failed to register, the stub returns rather
   than calling itself for ever. Nothing upstream changes shape — the classic
   client already reaches these through `lazyView` (client/comments.ts), which
   returns a promise and resolves it in the router, so an entry answering with
   a promise is exactly what that road expects.

   ONE MOUNT PER ROUTE (2026-11-04). A stub mounts a round trip after it was
   called, and the router can run again inside that window, clearing the
   section and calling once more. It did on every admin's boot: the profile
   landed, the admin answer differed from the pre-load hint, and the board was
   redrawn. When the chunk arrived BOTH calls mounted, and the thread showed
   twice: two heads, two opening posts, two reply forms, and the fingerprint
   drawer on the first copy only (getElementById finds the first of two equal
   ids). A refresh repeated it, because the profile answer comes off disk
   before the chunk does. Leaving and coming back cured it, because by then the
   chunk was in, the mount was immediate, and the second route cleared the
   first.

   An immediate mount followed by that second route would have been cleared
   away, so a late one must end the same way. Each call leaves a mark in its
   section and mounts only if the mark is still there when the chunk lands. A
   route that clears the section takes the mark with it, whatever it draws
   next. The mark is a comment node: it is invisible, and `:empty` ignores it,
   so the section's loading ring (styles/main.css) still shows while it waits.
   The classic client's lazy road takes the same hold, through
   `window.mcHoldSection`. tests/js/lazy_mount.test.ts runs the stubs through
   the race and keeps the classic road on the hold. */

type View = (...args: unknown[]) => unknown;

/* Hold `section` for a render that will land later. The answer, called when
   it lands, says whether the section is still the caller's (nothing has
   cleared it since) and lets the hold go either way. A call with no section
   to hold has nothing to lose, and is always answered yes. */
export function holdSection(section: unknown, doc: Pick<Document, 'createComment'>): () => boolean {
  const host = section as Node | null;
  if (!host || typeof host.appendChild !== 'function') return function () { return true; };
  const mark = doc.createComment('');
  host.appendChild(mark);
  return function stillHeld() {
    const held = mark.parentNode === host;
    mark.remove();
    return held;
  };
}

/* Stand a stub in `views` for each loader. Every view these serve takes its
   section first: (section, kit, …). */
export function installLazyViews(
  views: Record<string, View>,
  loaders: Record<string, () => Promise<unknown>>,
  doc: Pick<Document, 'createComment'>,
): void {
  for (const key of Object.keys(loaders)) {
    let pending: Promise<unknown> | null = null;
    const stub: View = function (...args: unknown[]) {
      const held = holdSection(args[0], doc);
      pending = pending || loaders[key]();
      return pending.then(function () {
        if (!held()) return undefined;   // a newer route owns the section now
        const fn = views[key];
        if (fn === stub) return undefined;
        return fn.apply(null, args);
      });
    };
    views[key] = stub;
  }
}
