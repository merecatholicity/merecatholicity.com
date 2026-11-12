-- | The journal's teaser: what the overview shows of an entry (2026-11-11). Its own
-- | module, apart from Domain.Comments, because only the journal view needs it: the
-- | journal view loads it lazily (`client/board.ts` imports `app/journal_kit.ts`),
-- | so it never rides the app's cold open or comments.js (tests/js/bundle_budget).
module Domain.Journal
  ( journalTeaser
  ) where

import Prelude
import Data.Array as Array
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..), joinWith, split, trim)
import Data.String.CodeUnits as CU
import Data.String.Regex as Re
import Data.String.Regex.Flags (noFlags)
import Data.String.Regex.Unsafe (unsafeRegex)

-- | The journal's overview shows each entry as a teaser and the entry's own page
-- | shows it whole (2026-11-11, the owner: "I was expecting only excerpts unless
-- | I click in"). A body is markdown whose paragraphs are blank-line separated,
-- | so the teaser is whole paragraphs from the top while they fit `limit`
-- | characters. A first paragraph longer than a third again over the limit is
-- | cut instead: at the last sentence end past half the limit, else the last
-- | space, and never inside a link (`[text](url)`, `<https://…>`) or a `**` run,
-- | which would show its markup raw. Whole paragraphs that come to less than half
-- | the limit (a one-line opening) are followed by the next one, cut the same way.
-- | `more` says the teaser is not the whole
-- | body, so the overview offers "Continue reading".
journalTeaser :: Int -> String -> { text :: String, more :: Boolean }
journalTeaser limit body =
  let
    paras = Array.filter (_ /= "") (map trim (Re.split paraRe (trim body)))
    whole = joinWith "\n\n" paras
  in
    case Array.uncons paras of
      Nothing -> { text: "", more: false }
      Just { head, tail }
        | CU.length head > limit + limit / 3 -> { text: cutProse limit head, more: true }
        | otherwise ->
            let
              kept = keepParas limit [ head ] tail
              text = joinWith "\n\n" kept
              used = CU.length text
            in
              case Array.index paras (Array.length kept) of
                Just next | used < limit / 2 -> { text: text <> "\n\n" <> cutProse (limit - used - 2) next, more: true }
                _ -> { text, more: text /= whole }

paraRe :: Re.Regex
paraRe = unsafeRegex "\\n[ \\t]*\\n\\s*" noFlags

keepParas :: Int -> Array String -> Array String -> Array String
keepParas limit acc rest = case Array.uncons rest of
  Just { head, tail }
    | CU.length (joinWith "\n\n" (Array.snoc acc head)) <= limit -> keepParas limit (Array.snoc acc head) tail
  _ -> acc

-- | One long paragraph cut near `n`. A cut at a sentence end stands as it is; a
-- | cut mid-sentence takes an ellipsis.
cutProse :: Int -> String -> String
cutProse n s =
  let
    c = CU.take n s
    stop = Array.foldl max (-1) (map (\p -> maybe (-1) (_ + 1) (CU.lastIndexOf (Pattern p) c)) [ ". ", "? ", "! ", ".\n", "?\n", "!\n" ])
    sp = maybe (-1) identity (CU.lastIndexOf (Pattern " ") c)
    at = if stop > n / 2 then stop else if sp > (n * 3) / 5 then sp else n
    cut = trimEnd (unopened (CU.take at c))
  in
    if stop > n / 2 && CU.length cut >= stop - 1 then cut else Re.replace trailRe "" cut <> "…"

-- | Back off to before whatever markup the cut left open.
unopened :: String -> String
unopened s =
  let
    link = case CU.lastIndexOf (Pattern "[") s of
      Just i | not (Re.test linkRe (CU.drop i s)) -> CU.take i s
      _ -> s
    angle = case CU.lastIndexOf (Pattern "<") link of
      Just i | CU.indexOf (Pattern ">") (CU.drop i link) == Nothing -> CU.take i link
      _ -> link
    stars = Array.length (split (Pattern "**") angle) - 1
  in
    if stars `mod` 2 == 1 then maybe angle (\i -> CU.take i angle) (CU.lastIndexOf (Pattern "**") angle) else angle

linkRe :: Re.Regex
linkRe = unsafeRegex "^\\[[^\\]]*\\]\\([^)]*\\)" noFlags

trimEnd :: String -> String
trimEnd = Re.replace (unsafeRegex "\\s+$" noFlags) ""

trailRe :: Re.Regex
trailRe = unsafeRegex "[\\s,;:\\u2014\\u2013-]+$" noFlags
