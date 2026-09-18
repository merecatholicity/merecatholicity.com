/* app/artwarm.ts — the sacred art, in the cache before the finger arrives
   (2026-09-18).

   Nineteen pages carry a faded background painting, set as body[data-art="…"]
   by appchrome.ts and drawn by styles/main.css (`body[data-art]::before`).
   That is a LAZY load by construction, and it stays one: a painting is fetched
   only when its rule matches, so a reader who opens nothing but the Library
   never pays for the Pietà, and the six -m/-d pairs a phone will never want are
   never asked for.

   What lazy costs is the FIRST arrival. The download starts at the moment the
   page is shown, so Profile and Inbox fade their art in a beat late — and on a
   phone every one of the six tabs is ONE TAP away from wherever the reader is
   standing. So once the page in hand is completely done, and only then, the
   rest are walked into the browser's cache at the lowest priority the platform
   offers. The tap afterwards finds them already there; the CSS rule still does
   the actual showing, unchanged.

   The rules this keeps:
     · The page in hand always wins. The walk begins after `load` — the current
       painting is a CSS background of a matched element, so it is part of that
       event — and then only when the main thread goes idle.
     · One walk per document. installChrome() runs once per document, but
       mcBoot re-runs on every soft navigation (CLAUDE.md), and a warm per hop
       would be a slow leak of requests; the latch is here, not in the caller.
     · A reader who turned the art OFF (Settings → Appearance → Background
       images) downloads nothing at all — the setting is read when the walk
       fires, not when it is scheduled.
     · Save-Data and a 2g link are refusals, not slowdowns. 1.2 MB (phone) or
       3.1 MB (desktop) is a kindness on a fast link and a rudeness on a slow
       one.
     · Only the variant the viewport will actually use: -m below the
       stylesheet's 900px breakpoint, -d at or above it.

   The list below is the stylesheet's own, and `tests/js/art_warm.test.mjs`
   sweeps styles/main.css both ways so a new painting cannot be added to one
   and forgotten in the other. */

/* The six features, each one tap away on every page of the app — so these are
   walked first, in the order the tab bar shows them. */
export const TAB_ART: string[] = ['home', 'merecat', 'feed', 'community', 'inbox', 'profile'];
/* The paintings only a link reaches: the four content-page accents, and the
   four halves of the two-image pages (communions = peter + hagia,
   freechurches = geneva + stgiles; geneva also stands alone on the bishop
   paper). Walked after the six, because a tap cannot reach them. */
export const PAGE_ART: string[] = ['credo', 'lexorandi', 'geneva', 'luther', 'peter', 'hagia', 'stgiles'];
/* styles/main.css switches every -m to its -d here. One number, two readers. */
export const WIDE_AT = 900;

/* The walk, in order, minus whatever the page in hand is already showing (that
   one is in flight or in the cache; asking again would cost nothing, but it
   would also say nothing). `showing` is the body's data-art key: on the two
   two-image pages it names neither file, so both halves are simply warmed. */
export function artUrls(wide: boolean, showing?: string): string[] {
  const tail = wide ? '-d.webp' : '-m.webp';
  return TAB_ART.concat(PAGE_ART)
    .filter((name) => name !== showing)
    .map((name) => '/theme/' + name + tail);
}

export interface WarmEnv {
  /* read at fire time, never at schedule time: a reader may have turned the
     art off in the seconds between */
  on: () => boolean;
  wide: () => boolean;
  showing: () => string;
  /* a link the reader is paying for, or one too slow to spend on art */
  sparing: () => boolean;
  /* "the page in hand is done, and nothing else wants the main thread" */
  ready: (go: () => void) => void;
  fetchOne: (url: string) => Promise<void>;
}

/* Walk the list one at a time. Sequential on purpose: the reader's own next
   navigation must never queue behind thirteen paintings, and a low-priority
   image that is already downloading is easier for the browser to deprioritize
   than twelve of them at once. A refusal (404, offline) ends that one file and
   nothing else — the art is decoration, and a missing painting is a page that
   simply has none. */
export function warmArt(env: WarmEnv): Promise<void> {
  return new Promise((done) => {
    env.ready(() => {
      if (!env.on() || env.sparing()) { done(); return; }
      const urls = artUrls(env.wide(), env.showing());
      const step = (i: number): Promise<void> => {
        if (i >= urls.length) return Promise.resolve();
        return env.fetchOne(urls[i]).catch(() => { /* one painting, not the walk */ })
          .then(() => step(i + 1));
      };
      step(0).then(() => done(), () => done());
    });
  });
}

/* ---- the browser's own answers to the six questions above ---- */
export function browserWarmEnv(on: () => boolean): WarmEnv {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
  };
  const conn = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return {
    on: on,
    wide: () => {
      try { return window.matchMedia('(min-width: ' + WIDE_AT + 'px)').matches; } catch (e) { return false; }
    },
    showing: () => {
      try { return document.body.dataset.art || ''; } catch (e) { return ''; }
    },
    sparing: () => {
      if (!conn) return false;
      /* 'slow-2g' and '2g'; a 3g phone still gets its art warmed */
      return !!conn.saveData || /2g$/.test(conn.effectiveType || '');
    },
    ready: (go) => {
      const idle = () => {
        if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 8000 });
        else setTimeout(go, 3000);
      };
      if (document.readyState === 'complete') idle();
      else window.addEventListener('load', idle, { once: true });
    },
    fetchOne: (url) => new Promise((settle) => {
      const img = new Image();
      (img as unknown as { fetchPriority?: string }).fetchPriority = 'low';
      img.decoding = 'async';
      img.onload = () => settle();
      img.onerror = () => settle();
      img.src = url;
    }),
  };
}

/* One walk per document. installChrome() calls this; it runs once per document
   today, and the latch keeps that true if it ever stops being. */
let walked = false;
export function installArtWarm(on: () => boolean): void {
  if (walked) return;
  walked = true;
  warmArt(browserWarmEnv(on)).catch(() => { /* never in the reader's way */ });
}
