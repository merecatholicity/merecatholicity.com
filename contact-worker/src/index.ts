/* Contact form handler. POST only. Verifies a Turnstile token, then emails
   the submission to the owner's verified destination address, which is free on
   every Cloudflare plan. Both secrets, TURNSTILE_SECRET and CONTACT_TO (the
   recipient address, kept out of this public repository), live as Worker
   secrets set with `wrangler secret put`. The allowed origins and the From
   address are overridable per deployment (ALLOWED_ORIGINS / CONTACT_FROM vars),
   falling back to the production values so prod is unchanged. */

interface Env {
  ALLOWED_ORIGINS?: string;
  CONTACT_FROM?: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_HOSTNAMES?: string;
  CONTACT_TO?: string;
  SEND_LIMIT: { limit(o: { key: string }): Promise<{ success: boolean }> };
  EMAIL: { send(msg: unknown): Promise<void> };
  [k: string]: unknown;
}

const DEFAULT_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
const DEFAULT_FROM = { email: 'contact-form@merecatholicity.com', name: 'merecatholicity.com contact form' };

function allowedOrigins(env: Env): string[] {
  const v = env && env.ALLOWED_ORIGINS;
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}
function fromAddress(env: Env) {
  return { email: (env && env.CONTACT_FROM) || DEFAULT_FROM.email, name: DEFAULT_FROM.name };
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin as string) ? origin as string : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body: unknown, status: number, request: Request, env: Env) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, 405, request, env);
    }

    /* Enforce the origin allow-list server-side; CORS only advises browsers. */
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins(env).includes(origin)) {
      return json({ ok: false, error: 'Bad origin.' }, 403, request, env);
    }

    /* Rate limit before the Turnstile call and the send, so a flood cannot
       burn the verify or email quotas. Turnstile alone is not a throttle. */
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const limit = await env.SEND_LIMIT.limit({ key: ip });
    if (!limit.success) {
      return json({ ok: false, error: 'Too many messages. Wait a minute and try again.' }, 429, request, env);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: 'Bad request.' }, 400, request, env);
    }

    /* Honeypot field. Bots fill it, people never see it. Pretend success. */
    if (form.get('website')) {
      return json({ ok: true }, 200, request, env);
    }

    const name = String(form.get('name') || '').replace(/[\r\n\t]+/g, ' ').slice(0, 200).trim();
    const email = String(form.get('email') || '').slice(0, 200).trim();
    const message = String(form.get('message') || '').slice(0, 5000).trim();
    if (!message) {
      return json({ ok: false, error: 'The message is empty.' }, 400, request, env);
    }

    const token = String(form.get('cf-turnstile-response') || '');
    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip,
      }),
    });
    const verdict = await verifyResponse.json() as { success?: boolean; hostname?: string };
    /* Defense in depth on top of the sitekey's own domain lock. */
    const allowedHosts = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h: string) => h.trim()).filter(Boolean);
    if (!verdict.success || (allowedHosts.length && !allowedHosts.includes(verdict.hostname as string))) {
      return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403, request, env);
    }

    const to = String(env.CONTACT_TO || '').trim();
    if (!to) {
      console.log(JSON.stringify({ event: 'contact_to_unset' }));
      return json({ ok: false, error: 'Could not deliver the message. Please try again later.' }, 502, request, env);
    }
    const send: {
      to: string; from: { email: string; name: string }; subject: string; text: string;
      replyTo?: { email: string; name: string | undefined };
    } = {
      to: to,
      from: fromAddress(env),
      subject: 'merecatholicity.com: message from ' + (name || 'anonymous'),
      text:
        'Name: ' + (name || '(none given)') + '\n' +
        'Email: ' + (email || '(none given)') + '\n\n' +
        message + '\n',
    };
    /* Reply-to the sender when they left a plausible address, so answering
       is one click. A bad address must not block the send. */
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      send.replyTo = { email: email, name: name || undefined };
    }

    try {
      await env.EMAIL.send(send);
    } catch (err) {
      console.log(JSON.stringify({ event: 'send_failed', error: String(err) }));
      return json({ ok: false, error: 'Could not deliver the message. Please try again later.' }, 502, request, env);
    }

    return json({ ok: true }, 200, request, env);
  },
};
