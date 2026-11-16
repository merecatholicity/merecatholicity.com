// The press's forms, Contact and the home page's mailing list (join, and leave): the same road
// as merecatholicity.com/contact.html (pagejs/contact.ts there), to the same worker
// (contact-api.merecatholicity.com), which mails the owner a message and keeps a list address.
//
// The challenge never mounts on arrival: Cloudflare's script is loaded only once a reader shows
// intent, the first focus of a field or a press, and then each form's widget is mounted once in
// its own slot, solved for its own action (the worker checks it, so a token earned for one door
// opens no other). A token is single-use, so every answer resets the widget. The listeners are
// the document's, so a page the client draws on a hop needs nothing bound again.

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

/** The forms this binds: the Turnstile action each is solved for, and what each says when the
 *  worker takes it. The list's answers are the same whether or not the address was on it, so
 *  neither form tells anyone who is. */
const FORMS: Record<string, { action?: string; said: string }> = {
  "press-contact": { said: "Sent. Thank you." },
  "press-list": { action: "subscribe", said: "You're on the list. Thank you." },
  "press-unlist": { action: "unsubscribe", said: "Done. That address is off the list." },
};

const widgets = new Map<HTMLFormElement, string>();
const wanted = new Set<HTMLFormElement>();
const token = (f: HTMLFormElement) =>
  f.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value ?? "";

function mount(f: HTMLFormElement) {
  const slot = f.querySelector(".contact-ts");
  if (!slot || !window.turnstile || slot.hasAttribute("data-rendered")) return;
  slot.setAttribute("data-rendered", "1");
  try {
    // Never re-run the challenge on a timer or a loop: a spent token is reset at the press.
    const id = window.turnstile.render(slot, {
      sitekey: SITEKEY, theme: "dark", "refresh-expired": "never", retry: "never",
      ...(FORMS[f.id]?.action ? { action: FORMS[f.id].action } : {}),
    });
    if (id !== undefined) widgets.set(f, id);
  } catch { /* a double render throws: the first stands */ }
}
window.__pressTs = () => { for (const f of wanted) if (f.isConnected) mount(f); };

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

function want(f: HTMLFormElement) {
  wanted.add(f);
  if (window.turnstile) { mount(f); return; }
  if (document.querySelector('script[src^="https://challenges.cloudflare.com/"]')) return;
  const s = document.createElement("script");
  s.src = scriptUrl(API);
  s.async = true;
  document.head.append(s);
}

const fresh = (f: HTMLFormElement) => {
  const id = widgets.get(f);
  try { if (window.turnstile && id !== undefined) window.turnstile.reset(id); }
  catch { /* the next press says so */ }
};

export function bindContact() {
  document.addEventListener("focusin", e => {
    const t = e.target as HTMLInputElement | null;
    if (t?.form && FORMS[t.form.id] && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.name !== "website") want(t.form);
  });
  document.addEventListener("submit", e => {
    const f = e.target as HTMLFormElement;
    const form = FORMS[f.id];
    if (!form) return;
    e.preventDefault();
    const status = f.querySelector<HTMLElement>(".contact-status")!;
    const button = f.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    want(f);
    // No token: the widget was never touched, or its token aged out (five minutes) while the
    // message was written. Earn another rather than send a request that would be refused.
    if (!token(f)) fresh(f);
    status.textContent = token(f) ? "Sending..." : "Verifying...";
    let waited = 0;
    const go = () => {
      if (!token(f)) {
        if (waited >= 15000) {
          status.textContent = "Verification is taking a moment. Complete the check above, then press again.";
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
          if (d.ok) {
            f.reset();
            status.textContent = form.said;
            f.dispatchEvent(new CustomEvent("press-form-ok", { bubbles: true }));
          }
          else status.textContent = d.error || "Something went wrong. Please try again.";
          fresh(f);
        })
        .catch(() => {
          status.textContent = "Could not reach the server. Please try again.";
          fresh(f);
        })
        .finally(() => { button.disabled = false; });
    };
    go();
  });
}
