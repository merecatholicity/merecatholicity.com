/* comments-worker/src/alerts.ts — the worker's voice (2026-09-16).
   One function, three channels, all Platform settings: `sendAlert` mails the
   address in `alert_email` through the `send_email` binding EMAIL (the exact
   road the contact form takes, contact-worker/src/index.ts) and posts to the
   Discord webhook in `alert_discord_webhook` through the same `sendDiscord`
   the forum hooks use. Which channels speak is `Domain.Ops.channelsFrom`: a
   channel is live when its switch (`alert_email_on` / `alert_discord_on`) is
   on AND its field holds a value the validator accepts — so the owner picks
   email, Discord or both, and empty or off is silent.

   The third channel is the DM (2026-09-19): the same words to every admin in
   `adminRoster`, sent as merecat, an automated notice. It was `runUsageCheck`'s
   alone, which is how an owner who expects a bot DM for a meter past its band
   heard about a dead cron by email only — and the dead cron WAS the usage one,
   so the single DM road was the very thing that had stopped. Its switch is
   `alert_dm_on` and it has no field: the roster is the field. `fanningOut`
   guards the re-entry — a DM writes rows and publishes hub frames, the egress
   scan reads those frames, and a refused frame calls `noteLeak`, which alerts;
   an alert raised while the fan-out is in flight keeps its other channels and
   sends no second round of DMs.

   It never throws: a refused mail (the destination not verified in Email
   Routing, say) or a dead webhook lands in `errors`, is logged as
   `alert_failed`, and reaches the admin's screen through the test door
   (POST /admin/alert-test). The callers are the cron chains (ops.ts), the
   usage monitor (usage.ts) and that test door. */
import * as OpsK from '../../purescript/output/Domain.Ops/index.js';
import { adminRoster, getAppSettings, isDiscordWebhook, sendDiscord, sendSystemDm, MERECAT_BOT } from './lib.ts';
import type { Env } from './env.ts';

export type Alert = { kind: string; subject: string; text: string; embed?: Record<string, unknown> };
export type AlertResult = { email: boolean; discord: boolean; dm: number; channels: string[]; errors: string[] };

/* The sender. Any address on the onboarded domain works without setup; the
   ALERT_FROM var overrides it. */
export const ALERT_FROM_DEFAULT = 'alerts@merecatholicity.com';

/* Discord embed colours: red for trouble, green for a recovery, grey for a test. */
function alertColor(kind: string): number {
  if (kind === 'recovered') return 0x2e8b57;
  if (kind === 'test') return 0x778899;
  return 0xb22222;
}

/* The channels the stored settings open, as tags — the kernel's rule over the
   two validators (the email one is the kernel's own; the webhook one is the
   worker's SSRF gate). */
export function alertChannels(settings: Record<string, string>, admins: number): string[] {
  return OpsK.channelsFrom({
    emailOn: String(settings.alert_email_on || ''),
    emailOk: OpsK.isEmailAddress(String(settings.alert_email || '').trim()),
    discordOn: String(settings.alert_discord_on || ''),
    discordOk: isDiscordWebhook(String(settings.alert_discord_webhook || '')),
    dmOn: String(settings.alert_dm_on || ''),
    dmOk: admins > 0,
  });
}

/* True while a fan-out is in flight in this isolate: see the header. */
let fanningOut = false;

/* The DM's words. A system line is one body, so the subject leads it — and it
   says it is automated, because it arrives in the same inbox a person would
   write to. Never the embed: a DM has no card. */
export function dmBody(alert: Alert): string {
  return 'Automated notice — ' + alert.subject + '\n\n' + alert.text;
}

export async function sendAlert(env: Env, alert: Alert): Promise<AlertResult> {
  const out: AlertResult = { email: false, discord: false, dm: 0, channels: [], errors: [] };
  let settings: Record<string, string>;
  try { settings = await getAppSettings(env); } catch (e) {
    out.errors.push('settings: ' + String(e).slice(0, 200));
    console.log(JSON.stringify({ event: 'alert_failed', kind: alert.kind, errors: out.errors }));
    return out;
  }
  let roster: string[] = [];
  if (!fanningOut) {
    try { roster = await adminRoster(env); } catch (e) { out.errors.push('dm: ' + String(e).slice(0, 200)); }
  }
  out.channels = alertChannels(settings, roster.length);
  const subject = '[merecatholicity] ' + alert.subject;
  if (out.channels.indexOf('email') !== -1) {
    if (!env.EMAIL) out.errors.push('email: the worker has no send_email binding');
    else {
      try {
        await env.EMAIL.send({
          to: String(settings.alert_email).trim(),
          from: { email: env.ALERT_FROM || ALERT_FROM_DEFAULT, name: 'merecatholicity.com' },
          subject,
          text: alert.text,
        });
        out.email = true;
      } catch (e) {
        const err = e as { code?: unknown; message?: unknown } | null;
        const code = err && err.code ? String(err.code) + ' ' : '';
        out.errors.push('email: ' + code + String((err && err.message) || e).slice(0, 300));
      }
    }
  }
  if (out.channels.indexOf('discord') !== -1) {
    const embed = alert.embed || {
      title: alert.subject.slice(0, 256),
      description: alert.text.slice(0, 4000),
      color: alertColor(alert.kind),
    };
    out.discord = await sendDiscord(settings.alert_discord_webhook, embed);
    if (!out.discord) out.errors.push('discord: the webhook did not accept the post');
  }
  if (out.channels.indexOf('dm') !== -1) {
    /* One admin's unreachable seat must not cost the others theirs, so each
       send stands alone; `dm` counts the ones that landed. */
    fanningOut = true;
    try {
      for (const hash of roster) {
        try { if (await sendSystemDm(env, MERECAT_BOT.hash, hash, dmBody(alert))) out.dm++; }
        catch (e) { out.errors.push('dm ' + hash.slice(0, 8) + ': ' + String(e).slice(0, 160)); }
      }
    } finally { fanningOut = false; }
    if (!out.dm) out.errors.push('dm: no admin was reached');
  }
  console.log(JSON.stringify({
    event: out.errors.length ? 'alert_failed' : 'alert_sent',
    kind: alert.kind, channels: out.channels, email: out.email, discord: out.discord, dm: out.dm, errors: out.errors,
  }));
  return out;
}
