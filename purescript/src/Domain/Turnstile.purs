-- | When a member must solve a Cloudflare challenge, and when they must not be
-- | asked to.
-- |
-- | Born of a live failure (2026-09-08). In the installed iOS app, mounting the
-- | Turnstile widget reliably took the document down: about a second later the
-- | page was replaced by a fresh load of the URL already on screen, with no
-- | `pagehide`, no `beforeunload` and no JavaScript error — the signature of a
-- | web view being destroyed rather than anything navigating. Six fixes moved
-- | WHEN and WHERE the challenge ran (dropping `execute()`, warming on focus,
-- | one widget per document, a container that was actually visible, no mount on
-- | view-open, and finally a same-origin iframe of its own) and the symptom
-- | moved with each one without ever stopping. The last of those proved the
-- | most: the challenge completed happily on a hard-loaded page and killed the
-- | document on a soft-navigated one, sealed in its own browsing context either
-- | way. A challenge that cannot run is not a gate; it is an outage.
-- |
-- | So the gate moved to where it does its actual work. A challenge answers one
-- | question — "is a person here?" — and an identity that has ALREADY answered
-- | it does not need to answer it again on every message. `isEstablished` in the
-- | worker is exactly that record: an identity with a profile row, a comment, or
-- | a wall post has passed a challenge at least once. Everything else that
-- | guards a write is untouched and does the continuous work: the identity key,
-- | the block/lock/ban gate, the per-IP rate limits, the AI screen.
-- |
-- | Single-sourced into the worker (`verifyTurnstile`) and the admin settings
-- | box; the client reads it through `/config` only to know whether to bother
-- | mounting a widget. The SERVER is the authority — a client that guesses wrong
-- | is simply refused, so this rule can never be talked around from a browser.
module Domain.Turnstile
  ( skipEstablishedDefault
  , skipFrom
  , required
  ) where

import Prelude

-- | Established identities are spared the challenge unless an admin says
-- | otherwise. The default is the permissive one deliberately: the alternative
-- | is an app that cannot send a message.
skipEstablishedDefault :: Boolean
skipEstablishedDefault = true

-- | The stored value ('1' | '0' | absent | anything) as the rule. Only a literal
-- | "0" turns the sparing off, so an absent row reads as the default — the same
-- | polarity as `Domain.Wall.enabledFrom`, and for the same reason: the codebase
-- | carries both idioms, and reading this one backwards would put every phone
-- | back in front of the challenge that was taking the page.
skipFrom :: String -> Boolean
skipFrom v = v /= "0"

-- | The whole rule. A challenge is required unless we are sparing established
-- | identities AND this one is established. Note what this does NOT depend on:
-- | not the device, not the browser, not whether the app is installed — a
-- | client cannot describe itself into an exemption.
required :: { established :: Boolean, skipEstablished :: Boolean } -> Boolean
required r = not (r.skipEstablished && r.established)
