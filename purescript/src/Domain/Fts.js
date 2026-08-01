/* FFI for Domain.Fts: the tokenization regexes only. Running the ACTUAL JS
   RegExp here guarantees byte-identical \S / \s semantics (the full Unicode
   whitespace set) — a hand-rolled PureScript tokenizer could drift on an exotic
   space and silently change a security-critical query. The sanitization (the
   part that makes injection impossible) is pure PureScript in Fts.purs. */

/* Forum search: quoted phrases, or non-whitespace runs. Returns the RAW tokens
   (the capture that matched); PureScript trims / filters / caps / quotes them. */
export const buildMatchTokensImpl = (q) => {
  const re = /"([^"]*)"|(\S+)/g;
  const out = [];
  let m;
  while ((m = re.exec(String(q || '')))) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
};

/* merecat retrieval: quoted phrases (kept verbatim) OR word runs (letters,
   digits, Latin-1/extended letters, apostrophes). Each token is tagged phrase
   vs word so PureScript can lower-case + stopword-filter only the words. */
export const merecatTokensImpl = (q) => {
  const re = /"([^"]*)"|([A-Za-z0-9À-ɏ'’]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(String(q || '')))) {
    if (m[1] !== undefined) out.push({ phrase: true, text: m[1] });
    else out.push({ phrase: false, text: m[2] });
  }
  return out;
};
