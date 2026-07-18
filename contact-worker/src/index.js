/* Contact form handler. POST only. Verifies a Turnstile token, then emails
   the submission to the site owner's verified destination address, which is
   free on every Cloudflare plan. The Turnstile secret lives in a Worker
   secret named TURNSTILE_SECRET, never in this repository. */

const ALLOWED_ORIGINS = ['https://merecatholicity.com', 'https://www.merecatholicity.com'];
const TO = 'adam.schaefers@icloud.com';
const FROM = { email: 'contact-form@merecatholicity.com', name: 'merecatholicity.com contact form' };

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, 405, request);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: 'Bad request.' }, 400, request);
    }

    /* Honeypot field. Bots fill it, people never see it. Pretend success. */
    if (form.get('website')) {
      return json({ ok: true }, 200, request);
    }

    const name = String(form.get('name') || '').slice(0, 200).trim();
    const email = String(form.get('email') || '').slice(0, 200).trim();
    const message = String(form.get('message') || '').slice(0, 5000).trim();
    if (!message) {
      return json({ ok: false, error: 'The message is empty.' }, 400, request);
    }

    const token = String(form.get('cf-turnstile-response') || '');
    const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || '',
      }),
    });
    const verdict = await verifyResponse.json();
    if (!verdict.success) {
      return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403, request);
    }

    const send = {
      to: TO,
      from: FROM,
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
      return json({ ok: false, error: 'Could not deliver the message. Please try again later.' }, 502, request);
    }

    return json({ ok: true }, 200, request);
  },
};
