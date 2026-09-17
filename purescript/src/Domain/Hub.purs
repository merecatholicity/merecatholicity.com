-- | The live hub's sharding law (2026-09-17). Every WebSocket on the site —
-- | presence, board events, DM frames, notifications, typing, call signalling —
-- | used to land in ONE Durable Object instance named "board": single-threaded,
-- | a soft thousand requests a second, and every operation walked every socket.
-- | Now the hub is N instances (`HUB_SHARDS`, a wrangler var) and this module is
-- | the one place that says which: a socket is placed by the MEMBER's hash (the
-- | client's `?h=` hint on the upgrade URL; an anonymous socket by a hash of its
-- | address), so every socket of one member lives on one shard and "their last
-- | socket closed" stays a local, exact fact. A private `user:<hash>` event is
-- | routed to that one shard; anything public (a board scope, the feed, a
-- | `presence:` watch) is fanned to all N. Shard 0 keeps the historic name
-- | "board", so N = 1 is bit-for-bit the hub that shipped on 2026-07-30. The
-- | worker (lib.ts, the routing) and the Durable Object itself (durable.ts,
-- | its own index and its siblings) both read these; nothing re-inlines them.
module Domain.Hub
  ( maxShards
  , normalizeShards
  , shardOf
  , shardName
  , shardIndex
  , shardNames
  , scopeHome
  , routeScopes
  ) where

import Prelude

import Data.Array as A
import Data.Int as Int
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..), stripPrefix)
import Data.String.CodeUnits (take, toCharArray)

-- | The most shards the var may ask for. Sixty-four shards is over a million
-- | hibernating sockets at Cloudflare's per-object comfort; past that the
-- | design, not the number, is the question.
maxShards :: Int
maxShards = 64

-- | The var as an integer: a whole number clamped to 1..maxShards; blank or
-- | junk is 1 (the single hub — never zero, never a crash).
normalizeShards :: String -> Int
normalizeShards s = case Int.fromString s of
  Just n | n >= 1 -> min n maxShards
  _ -> 1

isHex :: Char -> Boolean
isHex c = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')

-- | Which of n shards holds a key. The key is a lowercase hex digest (a
-- | member's identity hash, or the worker's sha256 of an address); its first
-- | seven digits (28 bits, well inside Int) modulo n. A key that is not hex
-- | lands on shard 0. Stable for a given n: the same member always dials the
-- | same shard, which is the whole invariant.
shardOf :: Int -> String -> Int
shardOf n key =
  let n' = max 1 n
      head7 = take 7 key
  in if A.length (toCharArray head7) == 7 && A.all isHex (toCharArray head7)
       then fromMaybe 0 (Int.fromStringAs Int.hexadecimal head7) `mod` n'
       else 0

-- | The Durable Object name of shard i. Shard 0 is "board" — the instance every
-- | socket dialled before sharding — so the first deploy moves nobody.
shardName :: Int -> String
shardName i = if i <= 0 then "board" else "board:" <> show i

-- | The inverse: an instance learns its own index from its name
-- | (`ctx.id.name`). Anything unrecognised is 0.
shardIndex :: String -> Int
shardIndex name = case stripPrefix (Pattern "board:") name of
  Just rest -> case Int.fromString rest of
    Just i | i > 0 -> i
    _ -> 0
  Nothing -> 0

-- | Every shard's name for n, in order — the all-shards fan.
shardNames :: Int -> Array String
shardNames n = map shardName (A.range 0 (max 1 n - 1))

-- | The one PRIVATE scope: `user:<hash>` names the member whose home shard
-- | alone holds its sockets. Every other scope is public and lives anywhere.
scopeHome :: String -> Maybe String
scopeHome scope = stripPrefix (Pattern "user:") scope

-- | Where an event goes: `Just` the deduplicated home shards when EVERY scope
-- | is private (a DM, a bell, a call offer — one or a few shards), `Nothing`
-- | when any scope is public (fan to all n). An event with no scopes at all
-- | goes nowhere (`Just []`).
routeScopes :: Int -> Array String -> Maybe (Array Int)
routeScopes n scopes =
  let homes = map scopeHome scopes
  in if A.any (_ == Nothing) homes
       then Nothing
       else Just (A.nub (map (shardOf n <<< fromMaybe "") homes))
