-- | The forum board categories, single-sourced. The display rows were duplicated
-- | byte-for-byte in the worker (`CAT_META`, with `BOARD_CATS` its key list) and
-- | the client (`comments.js` `CATS`, whose comment literally read "Keys must
-- | match BOARD_CATS in the worker"). Both now read this.
-- |
-- | Rows are `[key, label, blurb]` or `[key, label, blurb, linkText, linkHref]`
-- | (only "pub" and "prot" carry the trailing link) — kept as string arrays so
-- | the barrel passes them straight through and every consumer keeps its existing
-- | `cat[0]`..`cat[4]` indexing (a short row's `cat[3]`/`cat[4]` read undefined,
-- | exactly as before).
module Domain.Board (catRows, catKeys, adminCat) where

import Prelude
import Data.Array (head)
import Data.Maybe (fromMaybe)

catRows :: Array (Array String)
catRows =
  [ [ "pub", "Pub", "General discussion, for whatever fits nowhere more specific. New here? ", "Introduce yourself and say hello", "community.html?topic=37" ]
  , [ "news", "News", "News of the Church and of the world." ]
  , [ "offtopic", "Off Topic", "Everything else, cheerfully off the point." ]
  , [ "theology", "Theology", "All genres. Systematic and Dogmatic, Biblical and Exegetical, Historical and Patristic, Philosophical and Natural, etc." ]
  , [ "philosophy", "Philosophy", "From Plato and Aristotle to Kant and Wittgenstein." ]
  , [ "history", "History", "World, church, and national history. All of it." ]
  , [ "indoeuropean", "Indo-European Religion", "Healendry, Germanic and Norse Christianity, pre-Christian Indo-European religion, Japhetic origins, and more." ]
  , [ "rc", "Roman Catholic", "In-house talk for Roman Catholics." ]
  , [ "eo", "Eastern Orthodoxy", "In-house talk for the Eastern Orthodox." ]
  , [ "lutheran", "Confessional Lutheran", "In-house talk for confessional Lutherans." ]
  , [ "anglican", "High Anglican", "In-house talk for high Anglicans." ]
  , [ "presbyterian", "Reformed Presbyterian", "In-house talk for Reformed Presbyterians. Reformed Congregationalists and Reformed Baptists are welcome to coexist here too." ]
  , [ "prot", "Protestantism", "For everyone the rooms above do not quite fit, e.g. ", "the free churches", "free-churches.html" ]
  , [ "adminsonly", "Admins only", "The back room." ]
  ]

-- | The category keys in order (= the worker's BOARD_CATS).
catKeys :: Array String
catKeys = map (fromMaybe "" <<< head) catRows

-- | The back room's board key (the worker's ADMIN_CAT).
adminCat :: String
adminCat = "board:adminsonly"
