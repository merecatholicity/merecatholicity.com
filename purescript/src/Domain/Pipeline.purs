-- | Who the librarian's pipeline is (2026-09-17). Until this day the
-- | pipeline — merecat.yml, the ops watchdog — proved itself with a static
-- | key, MERECAT_INGEST_KEY, and the env disclosure published it: whoever
-- | held it could rewrite merecat's library, its persona and its dials. Now a
-- | GitHub Actions job proves itself with the short-lived OIDC token GitHub
-- | signs for that one run, and the worker checks the signature
-- | (`comments-worker/src/oidc.ts`) and then THIS policy over the token's
-- | claims. There is no key left to leak.
-- |
-- | A door is what the token is for:
-- |  * "ingest" — the corpus: `/api/merecat/works` and `/api/merecat/ingest`,
-- |    from merecat.yml;
-- |  * "config" — merecat's persona and dials: `/api/merecat/config`, from a
-- |    merecat.yml job that ran in the `librarian-config` environment, which
-- |    waits for a required reviewer (terraform/github.tf);
-- |  * "probe" — the watchdog's health read: `/api/comments/ops/report`, from
-- |    ops-watch.yml.
-- | Every door wants the same repository (by its immutable ids), main, a
-- | GitHub-hosted runner, a push, schedule or dispatch (never a pull
-- | request's event), the door's own workflow file, and a token inside its
-- | lifetime. The signature is checked before any of this is asked.
module Domain.Pipeline
  ( issuer
  , audience
  , repositoryId
  , ownerId
  , Claims
  , refusal
  , allows
  , workflowOf
  , environmentOf
  , skew
  , events
  ) where

import Prelude

import Data.Array as A
import Data.Maybe (Maybe(..))

issuer :: String
issuer = "https://token.actions.githubusercontent.com"

-- | The audience every workflow asks GitHub for, so a token minted for
-- | another service is refused here.
audience :: String
audience = "merecatholicity-comments"

-- | merecatholicity/merecatholicity.com, by the ids a rename cannot change.
repositoryId :: String
repositoryId = "1303720165"

ownerId :: String
ownerId = "306126219"

-- | Seconds of clock difference forgiven at either end of a token's life.
skew :: Int
skew = 60

-- | The events the pipeline's workflows run on. Never a pull request's, of
-- | any kind: a fork's code must never hold a door's token.
events :: Array String
events = [ "push", "schedule", "workflow_dispatch" ]

-- | The claims the policy reads, as the membrane coerces them: strings as
-- | they came ("" when absent), times as whole seconds (0 when absent).
type Claims =
  { iss :: String
  , aud :: String
  , repositoryId :: String
  , ownerId :: String
  , ref :: String
  , refType :: String
  , eventName :: String
  , runner :: String
  , workflowRef :: String
  , environment :: String
  , exp :: Int
  , nbf :: Int
  , iat :: Int
  }

-- | The workflow a door takes its tokens from.
workflowOf :: String -> Maybe String
workflowOf door = case door of
  "ingest" -> Just "merecat.yml"
  "config" -> Just "merecat.yml"
  "probe" -> Just "ops-watch.yml"
  _ -> Nothing

-- | The environment a door's job must have run in ("" = any).
environmentOf :: String -> String
environmentOf door = case door of
  "config" -> "librarian-config"
  _ -> ""

-- | Why a token may NOT open a door at `now` — "" when it may. A reason is a
-- | short phrase for the log; it never repeats a claim's value beyond the
-- | policy's own constants.
refusal :: String -> Claims -> Int -> String
refusal door c now = case workflowOf door of
  Nothing -> "no such door"
  Just wf
    | c.iss /= issuer -> "another issuer"
    | c.aud /= audience -> "another audience"
    | c.repositoryId /= repositoryId || c.ownerId /= ownerId -> "another repository"
    | c.ref /= "refs/heads/main" || c.refType /= "branch" -> "not main"
    | not (A.elem c.eventName events) -> "not a push, a schedule or a dispatch"
    | c.runner /= "github-hosted" -> "not a GitHub-hosted runner"
    | c.workflowRef /= "merecatholicity/merecatholicity.com/.github/workflows/" <> wf <> "@refs/heads/main" -> "another workflow"
    | environmentOf door /= "" && c.environment /= environmentOf door -> "not the " <> environmentOf door <> " environment"
    | c.exp <= 0 || now > c.exp + skew -> "expired"
    | c.nbf > 0 && now + skew < c.nbf -> "not yet valid"
    | c.iat > 0 && c.iat > now + skew -> "issued in the future"
    | otherwise -> ""

allows :: String -> Claims -> Int -> Boolean
allows door c now = refusal door c now == ""
