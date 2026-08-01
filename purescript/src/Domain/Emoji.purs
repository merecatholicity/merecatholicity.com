-- | The custom emoji packs and the named-alias token string, single-sourced.
-- | Both were duplicated byte-for-byte in the worker (served via /config) and the
-- | client (comments.js EMOJI_PACKS + the NAMED_EMOJI builder). This module is the
-- | one source; the trivial building code (derive the CUSTOM_EMOJI whitelist, pair
-- | the alias tokens) stays in each consumer — only the DATA is single-sourced.
-- |
-- | GENERATED from the worker data (scratchpad/gen was a one-off); edit here and
-- | both sides follow. The standard ~250-emoji set stays client-only (never on the
-- | wire), so it is deliberately not here.
module Domain.Emoji (packs, namedTokens) where

-- | { memes: [[code, webpPath], ...], pepe: [...] } — the two image packs. Kept as
-- | string arrays so the barrel passes the object straight through and consumers
-- | keep their `EMOJI_PACKS[pack]` / `e[0]`,`e[1]` indexing.
packs :: { memes :: Array (Array String), pepe :: Array (Array String) }
packs =
  { memes:
    [     [ "cry", "emoji/memes/cry.webp" ]
  ,     [ "pogging", "emoji/memes/pogging.webp" ]
  ,     [ "bonk", "emoji/memes/bonk.webp" ]
  ,     [ "catkiss", "emoji/memes/catkiss.webp" ]
  ,     [ "crythumbsup", "emoji/memes/crythumbsup.webp" ]
  ,     [ "catjam", "emoji/memes/catjam.webp" ]
  ,     [ "megareverse-1", "emoji/memes/megareverse-1.webp" ]
  ,     [ "shrug", "emoji/memes/shrug.webp" ]
  ,     [ "kekw", "emoji/memes/kekw.webp" ]
  ,     [ "boohoo", "emoji/memes/boohoo.webp" ]
  ,     [ "laughing-hard", "emoji/memes/laughing-hard.webp" ]
  ,     [ "bruh", "emoji/memes/bruh.webp" ]
  ,     [ "pepecringe", "emoji/memes/pepecringe.webp" ]
  ,     [ "kitty-happy", "emoji/memes/kitty-happy.webp" ]
  ,     [ "catsneeze", "emoji/memes/catsneeze.webp" ]
  ,     [ "cutecatstare", "emoji/memes/cutecatstare.webp" ]
  ,     [ "catsmile", "emoji/memes/catsmile.webp" ]
  ,     [ "catstare", "emoji/memes/catstare.webp" ]
  ,     [ "cat-laughing", "emoji/memes/cat-laughing.webp" ]
  ,     [ "soldjacat", "emoji/memes/soldjacat.webp" ]
  ,     [ "crycat", "emoji/memes/crycat.webp" ]
  ,     [ "bingus-shush", "emoji/memes/bingus-shush.webp" ]
  ,     [ "huhcat", "emoji/memes/huhcat.webp" ]
  ,     [ "catno", "emoji/memes/catno.webp" ]
  ,     [ "seriously", "emoji/memes/seriously.webp" ]
  ,     [ "cat-sleep", "emoji/memes/cat-sleep.webp" ]
  ,     [ "crisiscat", "emoji/memes/crisiscat.webp" ]
  ,     [ "huhcat-2", "emoji/memes/huhcat-2.webp" ]
  ,     [ "cat-kiss", "emoji/memes/cat-kiss.webp" ]
  ,     [ "catfunny", "emoji/memes/catfunny.webp" ]
  ,     [ "happy", "emoji/memes/happy.webp" ]
  ,     [ "laughing-cat", "emoji/memes/laughing-cat.webp" ]
  ,     [ "kitty-sad", "emoji/memes/kitty-sad.webp" ]
    ]
  , pepe:
    [     [ "pepecross", "emoji/pepe/pepecross.webp" ]
  ,     [ "pepetyping", "emoji/pepe/pepetyping.webp" ]
  ,     [ "pepeheart", "emoji/pepe/pepeheart.webp" ]
  ,     [ "pepelaugh", "emoji/pepe/pepelaugh.webp" ]
  ,     [ "pepeperfect", "emoji/pepe/pepeperfect.webp" ]
  ,     [ "strongpepe", "emoji/pepe/strongpepe.webp" ]
  ,     [ "pepebanger", "emoji/pepe/pepebanger.webp" ]
  ,     [ "pepeclap", "emoji/pepe/pepeclap.webp" ]
  ,     [ "pepetorchfire", "emoji/pepe/pepetorchfire.webp" ]
  ,     [ "pepeblink", "emoji/pepe/pepeblink.webp" ]
  ,     [ "pepeuwu", "emoji/pepe/pepeuwu.webp" ]
  ,     [ "pepeokay", "emoji/pepe/pepeokay.webp" ]
  ,     [ "pepepug", "emoji/pepe/pepepug.webp" ]
  ,     [ "kingpepe", "emoji/pepe/kingpepe.webp" ]
  ,     [ "kingpepe-2", "emoji/pepe/kingpepe-2.webp" ]
  ,     [ "nou", "emoji/pepe/nou.webp" ]
  ,     [ "peperain", "emoji/pepe/peperain.webp" ]
  ,     [ "peperich", "emoji/pepe/peperich.webp" ]
  ,     [ "pepehacker", "emoji/pepe/pepehacker.webp" ]
  ,     [ "pepeclap-2", "emoji/pepe/pepeclap-2.webp" ]
  ,     [ "pepe-blushy", "emoji/pepe/pepe-blushy.webp" ]
  ,     [ "pepe-sad", "emoji/pepe/pepe-sad.webp" ]
  ,     [ "pepehug", "emoji/pepe/pepehug.webp" ]
  ,     [ "pepe-hehe", "emoji/pepe/pepe-hehe.webp" ]
  ,     [ "pepes", "emoji/pepe/pepes.webp" ]
  ,     [ "sleepypepe", "emoji/pepe/sleepypepe.webp" ]
  ,     [ "pepohappy", "emoji/pepe/pepohappy.webp" ]
    ]
  }

-- | The named-alias source: space-separated `name emoji name emoji …` pairs, split
-- | and paired identically by each consumer (byte-for-byte the former inline string).
namedTokens :: String
namedTokens = "smile 😄 smiley 😃 grin 😁 laughing 😆 joy 😂 rofl 🤣 sweat_smile 😅 slight_smile 🙂 upside_down 🙃 wink 😉 blush 😊 innocent 😇 heart_eyes 😍 star_struck 🤩 kissing_heart 😘 yum 😋 stuck_out_tongue 😛 zany 🤪 thinking 🤔 shush 🤫 hand_over_mouth 🤭 neutral 😐 expressionless 😑 no_mouth 😶 smirk 😏 unamused 😒 rolling_eyes 🙄 relieved 😌 pensive 😔 sleepy 😪 sleeping 😴 mask 😷 nauseated 🤢 vomiting 🤮 sneeze 🤧 hot 🥵 cold 🥶 dizzy_face 😵 exploding_head 🤯 cowboy 🤠 partying 🥳 sunglasses 😎 nerd 🤓 monocle 🧐 confused 😕 worried 😟 frowning 🙁 open_mouth 😮 astonished 😲 flushed 😳 pleading 🥺 fearful 😨 cold_sweat 😰 cry 😢 sob 😭 scream 😱 confounded 😖 disappointed 😞 weary 😩 tired 😫 yawn 🥱 triumph 😤 rage 😡 angry 😠 cursing 🤬 smiling_imp 😈 imp 👿 skull 💀 poop 💩 clown 🤡 ghost 👻 alien 👽 robot 🤖 wave 👋 ok_hand 👌 v ✌️ crossed_fingers 🤞 love_you 🤟 call_me 🤙 point_up ☝️ thumbsup 👍 thumbsdown 👎 fist ✊ punch 👊 clap 👏 raised_hands 🙌 pray 🙏 handshake 🤝 muscle 💪 middle_finger 🖕 heart ❤️ orange_heart 🧡 yellow_heart 💛 green_heart 💚 blue_heart 💙 purple_heart 💜 black_heart 🖤 broken_heart 💔 two_hearts 💕 sparkling_heart 💖 100 💯 anger 💢 boom 💥 sweat_drops 💦 dash 💨 fire 🔥 star ⭐ star2 🌟 sparkles ✨ zap ⚡ rainbow 🌈 sunny ☀️ tada 🎉 confetti 🎊 gift 🎁 trophy 🏆 dart 🎯 white_check_mark ✅ x ❌ o ⭕ exclamation ❗ question ❓ warning ⚠️ bell 🔔 bulb 💡 key 🔑 lock 🔒 dog 🐶 cat 🐱 mouse 🐭 hamster 🐹 rabbit 🐰 fox 🦊 bear 🐻 panda 🐼 koala 🐨 tiger 🐯 lion 🦁 cow 🐮 pig 🐷 frog 🐸 monkey 🐵 chicken 🐔 penguin 🐧 bird 🐦 unicorn 🦄 bee 🐝 butterfly 🦋 snail 🐌 turtle 🐢 snake 🐍 octopus 🐙 whale 🐳 apple 🍎 banana 🍌 watermelon 🍉 grapes 🍇 strawberry 🍓 cherries 🍒 peach 🍑 avocado 🥑 corn 🌽 mushroom 🍄 bread 🍞 cheese 🧀 hamburger 🍔 fries 🍟 pizza 🍕 hotdog 🌭 taco 🌮 popcorn 🍿 doughnut 🍩 cookie 🍪 cake 🍰 chocolate 🍫 candy 🍬 lollipop 🍭 beer 🍺 beers 🍻 wine 🍷 coffee ☕ tea 🍵"
