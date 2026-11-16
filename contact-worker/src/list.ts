/* Lérins Press's mailing list (2026-11-16): the two doors of press.merecatholicity.com's
   signup box, /subscribe and /unsubscribe, on the contact worker beside its contact form.
   Write-only: an address goes in or comes out, and no road reads the list back.

   The list tells no one who is on it. That is the whole design of these doors:
   - ONE ANSWER. Every request that passes the gates gets the same status, the same body and
     the same headers, whether the address was new, already there, never there, or already
     gone. A join of a listed address and a leave of an unlisted one look like any other.
   - ONE STATEMENT. Each door runs exactly one SQL statement whatever the list holds (an upsert,
     a delete), so the database does the same work either way.
   - ONE TIME. Every answer, refusals included, is held until a fixed time after the request
     arrived (FLOOR_MS), so nothing about the list shows in how long the answer took.
   - NO MAIL. Nothing is sent to the address, so the doors cannot be used to mail or probe a
     stranger's inbox, and nothing about the address is logged.
   The gates before the statement turn only on the request itself (its origin, its form, its
   challenge, its sender's rate), never on the list. */

/** The consent wording each address agreed to, by key: the line beside the box (press
 *  src/views.ts `signup`). A change to that wording is a new key here, so every address keeps
 *  the words it agreed to. */
export const CONSENT: Record<string, string> = {
  'press-2026-11': 'Email me about new books and news from Lérins Press. Unsubscribe anytime.',
};
const CURRENT = 'press-2026-11';

/** Every answer leaves no sooner than this after the request arrived. Turnstile's verify call
 *  (well under a second) and the one statement fit inside it. */
export const FLOOR_MS = 1500;

/** The Turnstile action each door's widget is solved for (press src/contact.ts FORMS): a token
 *  earned for one door opens no other. */
export const ACTIONS = { '/subscribe': 'subscribe', '/unsubscribe': 'unsubscribe' } as const;
export type Door = keyof typeof ACTIONS;

/** A plausible address, as the browser's own type="email" field takes it; lower-cased so one
 *  address is one row (the column is NOCASE too). */
export function normalEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  if (e.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(e)) return null;
  return e;
}

interface ListDb {
  prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } };
}

/** The one statement a door runs. A join of a listed address refreshes its consent key and
 *  keeps its first day; a leave deletes the row if there is one. */
export async function apply(db: ListDb, door: Door, email: string, now: Date): Promise<void> {
  if (door === '/subscribe') {
    await db.prepare(
      'INSERT INTO list (email, consent, joined_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(email) DO UPDATE SET consent = excluded.consent',
    ).bind(email, CURRENT, now.toISOString()).run();
  } else {
    await db.prepare('DELETE FROM list WHERE email = ?').bind(email).run();
  }
}

/** The worker's clock: the unit suite swaps in its own, so it can watch the floor held. */
export const clock = {
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
};

/** Hold an answer until FLOOR_MS after `start`. */
export async function atFloor<T>(start: number, value: T): Promise<T> {
  const left = start + FLOOR_MS - clock.now();
  if (left > 0) await clock.sleep(left);
  return value;
}
