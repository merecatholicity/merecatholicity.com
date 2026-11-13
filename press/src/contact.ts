// The footer's contact form: the same road as merecatholicity.com/contact.html (pagejs/contact.ts
// there), to the same worker (contact-api.merecatholicity.com), which mails the owner.
//
// The challenge never mounts on arrival: Cloudflare's script is loaded only once a reader shows
// intent, the first focus of a field or the Send press, and then mounted once. A token is
// single-use, so every answer resets the widget. The listeners are the document's, so a page the
// client draws on a hop needs nothing bound again.

const API = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__pressTs";
/** The contact widget's sitekey (public by design), and Cloudflare's always-pass test key on
 *  this machine, whose host the real one refuses. */
const SITEKEY = /^(127\.0\.0\.1|localhost)$/.test(location.hostname)
  ? "1x00000000000000000000AA" : "0x4AAAAAAD4gH6kfaUH2IRSI";

interface Turnstile {
  render(el: Element, o: Record<string, unknown>): string | undefined;
  reset(id?: string): void;
}
declare global {
  interface Window { turnstile?: Turnstile; __pressTs?: () => void }
}

let widgetId: string | undefined;
let wanted = false;

const form = () => document.getElementById("press-contact") as HTMLFormElement | null;
const token = (f: HTMLFormElement) =>
  f.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value ?? "";

function mount() {
  const slot = form()?.querySelector(".contact-ts");
  if (!slot || !window.turnstile || slot.hasAttribute("data-rendered")) return;
  slot.setAttribute("data-rendered", "1");
  try {
    // Never re-run the challenge on a timer or a loop: a spent token is reset at the press.
    widgetId = window.turnstile.render(slot, {
      sitekey: SITEKEY, theme: "dark", "refresh-expired": "never", retry: "never",
    });
  } catch { /* a double render throws: the first stands */ }
}
window.__pressTs = () => { if (wanted) mount(); };

/** The zone's CSP reports any script URL set without a Trusted Type (report-only), so the one
 *  script this page ever adds by hand goes through a policy that passes Cloudflare's alone. */
let scriptUrl: (u: string) => string = u => u;
const tt = (window as unknown as { trustedTypes?: { createPolicy(n: string, o: object): {
  createScriptURL(u: string): string } } }).trustedTypes;
if (tt) {
  try {
    const policy = tt.createPolicy("default", {
      createScriptURL: (u: string) => u.startsWith("https://challenges.cloudflare.com/") ? u : null,
    });
    scriptUrl = u => policy.createScriptURL(u);
  } catch { /* a policy of that name already stands */ }
}

function want() {
  wanted = true;
  if (window.turnstile) { mount(); return; }
  if (document.querySelector('script[src^="https://challenges.cloudflare.com/"]')) return;
  const s = document.createElement("script");
  s.src = scriptUrl(API);
  s.async = true;
  document.head.append(s);
}

const fresh = () => {
  try { if (window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId); }
  catch { /* the next press says so */ }
};

export function bindContact() {
  document.addEventListener("focusin", e => {
    const t = e.target as HTMLInputElement | null;
    if (t?.form?.id === "press-contact" && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.name !== "website") want();
  });
  document.addEventListener("submit", e => {
    const f = e.target as HTMLFormElement;
    if (f.id !== "press-contact") return;
    e.preventDefault();
    const status = f.querySelector<HTMLElement>(".contact-status")!;
    const button = f.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    want();
    // No token: the widget was never touched, or its token aged out (five minutes) while the
    // message was written. Earn another rather than send a request that would be refused.
    if (!token(f) && widgetId !== undefined) fresh();
    status.textContent = token(f) ? "Sending..." : "Verifying...";
    let waited = 0;
    const go = () => {
      if (!token(f)) {
        if (waited >= 15000) {
          status.textContent = "Verification is taking a moment. Complete the check above, then press Send again.";
          button.disabled = false;
          return;
        }
        waited += 250;
        setTimeout(go, 250);
        return;
      }
      status.textContent = "Sending...";
      fetch(f.action, { method: "POST", body: new FormData(f) })
        .then(r => r.json() as Promise<{ ok?: boolean; error?: string }>)
        .then(d => {
          if (d.ok) { f.reset(); status.textContent = "Sent. Thank you."; }
          else status.textContent = d.error || "Something went wrong. Please try again.";
          fresh();
        })
        .catch(() => {
          status.textContent = "Could not reach the server. Please try again.";
          fresh();
        })
        .finally(() => { button.disabled = false; });
    };
    go();
  });
}
