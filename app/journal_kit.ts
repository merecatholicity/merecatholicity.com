/* The journal's teaser (Domain.Journal), behind its own membrane. Imported only by
   the journal view (client/board.ts viewJournal) and only by import(), so its kernel
   code is a chunk of its own: not in comments.js, and not in the app's graph, where
   sharing the PureScript runtime with core.ts would split chunks the cold open loads
   (tests/js/bundle_budget). */
import * as Journal from '../purescript/output/Domain.Journal/index.js';

/* Whole paragraphs to the limit, or a long first one cut at a sentence; `more` when
   it is not the whole body. */
export const journalTeaser = (limit: number, body: unknown): { text: string; more: boolean } =>
  Journal.journalTeaser(limit | 0)(body == null ? '' : String(body));
