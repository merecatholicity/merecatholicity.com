"use strict";
(function() {
  "use strict";
  var MC_EPOCH = 0;
  var mcDown = null;
  function mcBoot() {
    if (mcDown) {
      try {
        mcDown();
      } catch (e) {
      }
      mcDown = null;
    }
    var epoch = ++MC_EPOCH;
    var bootCtl = new AbortController();
    var bootSig = bootCtl.signal;
    var liveStreams = [];
    function stale() {
      return epoch !== MC_EPOCH;
    }
    mcDown = function() {
      MC_EPOCH++;
      try {
        bootCtl.abort();
      } catch (e) {
      }
      liveStreams.forEach(function(c) {
        try {
          c.abort();
        } catch (e) {
        }
      });
      liveStreams.length = 0;
    };
    var API = "/api/comments";
    var SITEKEY = "0x4AAAAAAD8IYH9_xQ0HE0yB";
    var STORAGE = "mc-comment-key";
    var FAITH_STORE = "mc-faith";
    function faithLabel(code) {
      return window.mcCore.faithLabel(code) || "";
    }
    function faithCodes() {
      return window.mcCore.faiths.map(function(f) {
        return f.code;
      });
    }
    function rankFor(n) {
      return window.mcCore.rankFor(n);
    }
    function rankLine(posts) {
      return window.mcCore.rankLine(posts);
    }
    var ADMIN_HASHES = [
      "d1915a05c2583f437b1316971563b3c4c404cff016a016770d91af1f2645f7f6",
      "c83c2b4d105771aafa662a26745ddd2172213ddf5b39d64dfb91f579b5e18b03"
    ];
    var EMOJI_PACKS = window.mcCore.emojiPacks;
    var CUSTOM_EMOJI = {};
    Object.keys(EMOJI_PACKS).forEach(function(k) {
      EMOJI_PACKS[k].forEach(function(e) {
        CUSTOM_EMOJI[e[0]] = e[1];
      });
    });
    var STANDARD_EMOJI = "\u{1F600} \u{1F603} \u{1F604} \u{1F601} \u{1F606} \u{1F605} \u{1F602} \u{1F923} \u{1F642} \u{1F643} \u{1F609} \u{1F60A} \u{1F607} \u{1F970} \u{1F60D} \u{1F929} \u{1F618} \u{1F617} \u{1F61A} \u{1F619} \u{1F60B} \u{1F61B} \u{1F61C} \u{1F92A} \u{1F61D} \u{1F917} \u{1F92D} \u{1F92B} \u{1F914} \u{1F910} \u{1F928} \u{1F610} \u{1F611} \u{1F636} \u{1F60F} \u{1F612} \u{1F644} \u{1F62C} \u{1F60C} \u{1F614} \u{1F62A} \u{1F924} \u{1F634} \u{1F637} \u{1F912} \u{1F915} \u{1F922} \u{1F92E} \u{1F927} \u{1F975} \u{1F976} \u{1F974} \u{1F635} \u{1F92F} \u{1F920} \u{1F973} \u{1F60E} \u{1F913} \u{1F9D0} \u{1F615} \u{1F61F} \u{1F641} \u{1F62E} \u{1F62F} \u{1F632} \u{1F633} \u{1F97A} \u{1F626} \u{1F627} \u{1F628} \u{1F630} \u{1F625} \u{1F622} \u{1F62D} \u{1F631} \u{1F616} \u{1F623} \u{1F61E} \u{1F613} \u{1F629} \u{1F62B} \u{1F971} \u{1F624} \u{1F621} \u{1F620} \u{1F92C} \u{1F608} \u{1F47F} \u{1F480} \u{1F4A9} \u{1F921} \u{1F47B} \u{1F47D} \u{1F916} \u{1F63A} \u{1F638} \u{1F639} \u{1F63B} \u{1F63C} \u{1F63D} \u{1F640} \u{1F63F} \u{1F63E} \u{1F44B} \u{1F91A} \u270B \u{1F596} \u{1F44C} \u{1F90C} \u{1F90F} \u270C\uFE0F \u{1F91E} \u{1F91F} \u{1F918} \u{1F919} \u{1F448} \u{1F449} \u{1F446} \u{1F447} \u261D\uFE0F \u{1F44D} \u{1F44E} \u270A \u{1F44A} \u{1F91B} \u{1F91C} \u{1F44F} \u{1F64C} \u{1F450} \u{1F932} \u{1F64F} \u{1F91D} \u{1F4AA} \u{1F595} \u2764\uFE0F \u{1F9E1} \u{1F49B} \u{1F49A} \u{1F499} \u{1F49C} \u{1F5A4} \u{1F90D} \u{1F90E} \u{1F494} \u{1F495} \u{1F49E} \u{1F493} \u{1F497} \u{1F496} \u{1F498} \u{1F49D} \u{1F4AF} \u{1F4A2} \u{1F4A5} \u{1F4AB} \u{1F4A6} \u{1F4A8} \u{1F4AC} \u{1F4AD} \u{1F4A4} \u{1F525} \u2B50 \u{1F31F} \u2728 \u26A1 \u{1F4A7} \u{1F308} \u2600\uFE0F \u{1F389} \u{1F38A} \u{1F381} \u{1F3C6} \u{1F947} \u{1F3AF} \u2705 \u274C \u2B55 \u2757 \u2753 \u26A0\uFE0F \u{1F514} \u{1F4A1} \u{1F511} \u{1F512} \u{1F436} \u{1F431} \u{1F42D} \u{1F439} \u{1F430} \u{1F98A} \u{1F43B} \u{1F43C} \u{1F428} \u{1F42F} \u{1F981} \u{1F42E} \u{1F437} \u{1F438} \u{1F435} \u{1F648} \u{1F649} \u{1F64A} \u{1F414} \u{1F427} \u{1F426} \u{1F986} \u{1F989} \u{1F43A} \u{1F417} \u{1F434} \u{1F984} \u{1F41D} \u{1F41B} \u{1F98B} \u{1F40C} \u{1F422} \u{1F40D} \u{1F419} \u{1F980} \u{1F41F} \u{1F42C} \u{1F433} \u{1F34E} \u{1F34C} \u{1F349} \u{1F347} \u{1F353} \u{1F352} \u{1F351} \u{1F34D} \u{1F95D} \u{1F345} \u{1F951} \u{1F33D} \u{1F344} \u{1F35E} \u{1F9C0} \u{1F354} \u{1F35F} \u{1F355} \u{1F32D} \u{1F32E} \u{1F37F} \u{1F369} \u{1F36A} \u{1F382} \u{1F370} \u{1F36B} \u{1F36C} \u{1F36D} \u{1F37A} \u{1F37B} \u{1F942} \u{1F377} \u2615 \u{1F375}".split(" ");
    var NAMED_EMOJI = {};
    window.mcCore.emojiNamedTokens.trim().split(/\s+/).forEach(function(tok, i, a) {
      if (i % 2 === 0) NAMED_EMOJI[tok] = a[i + 1];
    });
    function displayName(hash) {
      return window.mcCore.displayName(hash);
    }
    function pagePath() {
      var p = location.pathname;
      if (p.slice(-1) === "/") p += "index.html";
      if (p.slice(-5) !== ".html") p += ".html";
      return p;
    }
    function el(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    }
    var BIBLE = function() {
      var spec = [
        ["genesis", "genesis|gen|ge|gn"],
        ["exodus", "exodus|exod|exo|ex"],
        ["leviticus", "leviticus|lev|lv"],
        ["numbers", "numbers|num|nm|nb"],
        ["deuteronomy", "deuteronomy|deut|deu|dt"],
        ["joshua", "joshua|josh|jos|jsh"],
        ["judges", "judges|judg|jdg|jg"],
        ["ruth", "ruth|rth|ru"],
        ["1-samuel", "1 samuel|1samuel|1 sam|1sam|1 sa|i samuel|i sam|first samuel"],
        ["2-samuel", "2 samuel|2samuel|2 sam|2sam|2 sa|ii samuel|ii sam|second samuel"],
        ["1-kings", "1 kings|1kings|1 kgs|1kgs|1 ki|i kings|i kgs|first kings"],
        ["2-kings", "2 kings|2kings|2 kgs|2kgs|2 ki|ii kings|ii kgs|second kings"],
        ["1-chronicles", "1 chronicles|1 chron|1 chr|1chr|1 ch|i chronicles|i chron|first chronicles"],
        ["2-chronicles", "2 chronicles|2 chron|2 chr|2chr|2 ch|ii chronicles|ii chron|second chronicles"],
        ["ezra", "ezra|ezr|ez"],
        ["nehemiah", "nehemiah|neh|ne"],
        ["esther", "esther|esth|est|es"],
        ["job", "job|jb"],
        ["psalms", "psalms|psalm|pslm|psa|ps|pss|psm"],
        ["proverbs", "proverbs|prov|pro|prv|pr"],
        ["ecclesiastes", "ecclesiastes|eccles|eccl|ecc|ec|qoh"],
        ["song-of-solomon", "song of solomon|song of songs|song|sos|canticles|cant"],
        ["isaiah", "isaiah|isa|isai"],
        ["jeremiah", "jeremiah|jer|je|jr"],
        ["lamentations", "lamentations|lam|la"],
        ["ezekiel", "ezekiel|ezek|eze|ezk"],
        ["daniel", "daniel|dan|da|dn"],
        ["hosea", "hosea|hos|ho"],
        ["joel", "joel|joe|jl"],
        ["amos", "amos|amo"],
        ["obadiah", "obadiah|obad|oba|ob"],
        ["jonah", "jonah|jon|jnh"],
        ["micah", "micah|mic|mc"],
        ["nahum", "nahum|nah|na"],
        ["habakkuk", "habakkuk|hab|hb"],
        ["zephaniah", "zephaniah|zeph|zep|zp"],
        ["haggai", "haggai|hag|hg"],
        ["zechariah", "zechariah|zech|zec|zc"],
        ["malachi", "malachi|mal|ml"],
        ["matthew", "matthew|matt|mat|mt"],
        ["mark", "mark|mrk|mar|mk|mr"],
        ["luke", "luke|luk|lk"],
        ["john", "john|jhn|joh|jn"],
        ["acts", "acts|act|ac"],
        ["romans", "romans|rom|ro|rm"],
        ["1-corinthians", "1 corinthians|1 cor|1cor|1 co|i corinthians|i cor|first corinthians"],
        ["2-corinthians", "2 corinthians|2 cor|2cor|2 co|ii corinthians|ii cor|second corinthians"],
        ["galatians", "galatians|gal|ga"],
        ["ephesians", "ephesians|ephes|eph"],
        ["philippians", "philippians|phil|php|pp"],
        ["colossians", "colossians|col"],
        ["1-thessalonians", "1 thessalonians|1 thess|1thess|1 thes|1 th|i thessalonians|i thess|first thessalonians"],
        ["2-thessalonians", "2 thessalonians|2 thess|2thess|2 thes|2 th|ii thessalonians|ii thess|second thessalonians"],
        ["1-timothy", "1 timothy|1 tim|1tim|1 ti|i timothy|i tim|first timothy"],
        ["2-timothy", "2 timothy|2 tim|2tim|2 ti|ii timothy|ii tim|second timothy"],
        ["titus", "titus|tit|ti"],
        ["philemon", "philemon|philem|phlm|phm|pm"],
        ["hebrews", "hebrews|heb|hb"],
        ["james", "james|jas|jm"],
        ["1-peter", "1 peter|1 pet|1pet|1 pe|1 pt|i peter|i pet|first peter"],
        ["2-peter", "2 peter|2 pet|2pet|2 pe|2 pt|ii peter|ii pet|second peter"],
        ["1-john", "1 john|1 jhn|1 jn|1jn|i john|i jn|first john"],
        ["2-john", "2 john|2 jhn|2 jn|2jn|ii john|ii jn|second john"],
        ["3-john", "3 john|3 jhn|3 jn|3jn|iii john|iii jn|third john"],
        ["jude", "jude|jud|jd"],
        ["revelation", "revelation|revelations|rev|apocalypse|apoc"]
      ];
      var map = {}, forms = [];
      spec.forEach(function(row) {
        row[1].split("|").forEach(function(f) {
          f = f.trim();
          if (!f) return;
          map[f] = row[0];
          forms.push(f);
        });
      });
      forms.sort(function(a, b) {
        return b.length - a.length;
      });
      var alt = forms.map(function(f) {
        return f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
      }).join("|");
      return { map, src: "(" + alt + ")\\.?[ \\t]+(\\d+):(\\d+)(?:[\\-\\u2013](\\d+))?" };
    }();
    function scriptureDecor(a, url) {
      if (window.mcRich) return window.mcRich.scriptureDecor(a, url);
      var m = /(?:^|\/)kjv\.html#([a-z0-9-]+)-(\d+)-(\d+)$/.exec(String(url || ""));
      var dr = null;
      if (!m) {
        dr = /(?:^|\/)douay-rheims\.html#([a-z0-9-]+)-(\d+)-(\d+)$/.exec(String(url || ""));
        m = dr;
      }
      if (!m) return;
      a.className += " scripture-link";
      if (dr) a.setAttribute("data-bible", "dr");
      a.setAttribute("data-slug", m[1]);
      a.setAttribute("data-ch", m[2]);
      a.setAttribute("data-v1", m[3]);
      var r = /:(\d+)\s*[-\u2013]\s*(\d+)\s*$/.exec(a.textContent || "");
      a.setAttribute("data-v2", r && r[1] === m[3] ? r[2] : m[3]);
    }
    var INLINE_BASE = /\*\*([^\n]+?)\*\*|\*(\S[^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"')]+)\)|https?:\/\/[^\s<>"']+|:([a-z0-9_+-]{1,40}):/gi;
    var INLINE_MD = new RegExp(INLINE_BASE.source + "|" + BIBLE.src, "gi");
    function appendRich(target, str, plain) {
      if (window.mcRich) return window.mcRich.appendRich(target, str, plain);
      var s = String(str == null ? "" : str);
      var re = new RegExp(INLINE_MD.source, "gi");
      var last = 0, m;
      while (m = re.exec(s)) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        if (m.index > last) target.appendChild(document.createTextNode(s.slice(last, m.index)));
        if (m[1] !== void 0) {
          if (plain) {
            appendRich(target, m[1], plain);
          } else {
            var strong = el("strong");
            appendRich(strong, m[1]);
            target.appendChild(strong);
          }
        } else if (m[2] !== void 0) {
          if (plain) {
            appendRich(target, m[2], plain);
          } else {
            var em = el("em");
            appendRich(em, m[2]);
            target.appendChild(em);
          }
        } else if (m[5] !== void 0) {
          target.appendChild(emojiToken(m[5], m[0]));
        } else if (m[6] !== void 0) {
          var slug = BIBLE.map[m[6].toLowerCase().replace(/\s+/g, " ")];
          if (slug) {
            var sa = el("a", "body-link scripture-link");
            sa.href = "kjv.html#" + slug + "-" + m[7] + "-" + m[8];
            sa.setAttribute("data-slug", slug);
            sa.setAttribute("data-ch", m[7]);
            sa.setAttribute("data-v1", m[8]);
            sa.setAttribute("data-v2", m[9] || m[8]);
            sa.appendChild(document.createTextNode(m[0]));
            target.appendChild(sa);
          } else {
            target.appendChild(document.createTextNode(m[0]));
          }
        } else {
          var url = m[3] !== void 0 ? m[4] : m[0];
          var a = el("a", "body-link", m[3] !== void 0 ? m[3] : m[0]);
          if (/^https?:\/\/(?:www\.)?merecatholicity\.com(?:[\/?#]|$)/i.test(url)) {
            a.href = url;
            scriptureDecor(a, url);
          } else {
            a.href = "away.html?url=" + encodeURIComponent(url);
            a.rel = "nofollow ugc noopener";
          }
          target.appendChild(a);
        }
        last = m.index + m[0].length;
      }
      if (last < s.length) target.appendChild(document.createTextNode(s.slice(last)));
    }
    function fillBody(node, text, plain) {
      if (window.mcRich) return window.mcRich.fillBody(node, text, plain);
      node.textContent = "";
      var lines = String(text == null ? "" : text).split("\n");
      var i = 0;
      while (i < lines.length) {
        if (/^>/.test(lines[i])) {
          var quoted = [];
          while (i < lines.length && /^>/.test(lines[i])) {
            quoted.push(lines[i].replace(/^>\s?/, ""));
            i++;
          }
          if (plain) {
            var qp = el("p");
            appendRich(qp, quoted.join("\n"), plain);
            node.appendChild(qp);
          } else {
            var bq = el("blockquote", "comment-quote");
            appendRich(bq, quoted.join("\n"));
            node.appendChild(bq);
          }
        } else if (/^[-*] /.test(lines[i])) {
          if (plain) {
            var items = [];
            while (i < lines.length && /^[-*] /.test(lines[i])) {
              items.push(lines[i].replace(/^[-*] +/, ""));
              i++;
            }
            var lp = el("p");
            appendRich(lp, items.join("\n"), plain);
            node.appendChild(lp);
          } else {
            var ul = el("ul", "comment-list");
            while (i < lines.length && /^[-*] /.test(lines[i])) {
              var li = el("li");
              appendRich(li, lines[i].replace(/^[-*] +/, ""));
              ul.appendChild(li);
              i++;
            }
            node.appendChild(ul);
          }
        } else if (/^#{1,5} /.test(lines[i])) {
          var hm = /^(#{1,5}) +(.*)$/.exec(lines[i]);
          if (plain) {
            var hp = el("p");
            appendRich(hp, hm[2], plain);
            node.appendChild(hp);
          } else {
            ensureEmojiStyles();
            var hd = el("p", "mc-hd mc-hd" + hm[1].length);
            appendRich(hd, hm[2]);
            node.appendChild(hd);
          }
          i++;
        } else {
          var run = [];
          while (i < lines.length && !/^>/.test(lines[i]) && !/^[-*] /.test(lines[i]) && !/^#{1,5} /.test(lines[i])) {
            run.push(lines[i]);
            i++;
          }
          appendRich(node, run.join("\n"), plain);
        }
      }
      return node;
    }
    function profileHref(hash) {
      return "profile.html?u=" + hash;
    }
    function authorNode(hash, nick, withSub, faith, posts) {
      if (!hash) return el("span", "comment-author", "Anonymous");
      var wrap = el("span", "comment-author");
      var primary = el("a", "comment-author-link", nick || displayName(hash));
      primary.href = profileHref(hash);
      wrap.appendChild(primary);
      if (withSub && nick) {
        var sub = el("a", "comment-author-sub", displayName(hash));
        sub.href = profileHref(hash);
        wrap.appendChild(sub);
      }
      var fl = faith && faithLabel(faith);
      if (fl) wrap.appendChild(el("span", "comment-faith", fl));
      if (posts != null) wrap.appendChild(el("span", "comment-faith comment-rank", rankLine(Number(posts) || 0)));
      return wrap;
    }
    function getFaith() {
      try {
        var v = localStorage.getItem(FAITH_STORE);
        return faithLabel(v) ? v : "";
      } catch (e) {
        return "";
      }
    }
    function setFaith(code) {
      try {
        if (faithLabel(code)) localStorage.setItem(FAITH_STORE, code);
      } catch (e) {
      }
    }
    var MUTED_STORE = "mc-muted";
    function getMuted() {
      try {
        var a = JSON.parse(localStorage.getItem(MUTED_STORE));
        return Array.isArray(a) ? a : [];
      } catch (e) {
        return [];
      }
    }
    function isMuted(hash) {
      if (window.mcCore) return window.mcCore.isMuted(MERECAT_BOT_HASH, hash, getMuted());
      if (hash === MERECAT_BOT_HASH) return false;
      return !!hash && getMuted().indexOf(hash) !== -1;
    }
    function toggleMute(hash) {
      if (!hash) return false;
      if (window.mcCore) {
        var r = window.mcCore.toggleMute(hash, getMuted());
        try {
          localStorage.setItem(MUTED_STORE, JSON.stringify(r.list));
        } catch (e) {
        }
        return r.added;
      }
      var a = getMuted(), i = a.indexOf(hash);
      if (i === -1) a.push(hash);
      else a.splice(i, 1);
      try {
        localStorage.setItem(MUTED_STORE, JSON.stringify(a));
      } catch (e) {
      }
      return i === -1;
    }
    function faithRadios(current, onChange) {
      var wrap = el("div", "faith-radios");
      wrap.appendChild(el("div", "faith-legend", "I hold to:"));
      faithCodes().forEach(function(code) {
        var lab = el("label", "faith-option");
        var r = el("input");
        r.type = "radio";
        r.name = "mc-faith-choice";
        r.value = code;
        if (code === current) r.checked = true;
        r.addEventListener("change", function() {
          if (r.checked && onChange) onChange(code);
        });
        lab.appendChild(r);
        lab.appendChild(document.createTextNode(" " + faithLabel(code)));
        wrap.appendChild(lab);
      });
      return wrap;
    }
    function browserTz() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      } catch (e) {
        return "";
      }
    }
    function collectAltIps() {
      ["ipv4", "ipv6"].forEach(function(fam) {
        var ctl = "AbortController" in window ? new AbortController() : null;
        var timer = ctl ? setTimeout(function() {
          ctl.abort();
        }, 2e3) : null;
        fetch("https://" + fam + ".icanhazip.com", ctl ? { signal: ctl.signal } : {}).then(function(r) {
          return r.ok ? r.text() : "";
        }).then(function(txt) {
          var ip = String(txt || "").trim();
          if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) state.altIps[fam] = ip;
        }).catch(function() {
        }).finally(function() {
          if (timer) clearTimeout(timer);
        });
      });
    }
    function isSharedV4Client(ip) {
      var m = /^(\d{1,3})\.(\d{1,3})\./.exec(ip || "");
      return !!m && +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127;
    }
    var FETCH_TIMEOUT = 15e3;
    function fetchRetry(url, opts, delays, onRetry) {
      function attempt(i) {
        var init = opts;
        var timer = 0;
        if (typeof AbortController === "function" && !(opts && opts.signal)) {
          var ctrl = new AbortController();
          init = Object.assign({}, opts, { signal: ctrl.signal });
          timer = window.setTimeout(function() {
            ctrl.abort();
          }, FETCH_TIMEOUT);
        }
        return fetch(url, init).then(function(res) {
          if (timer) clearTimeout(timer);
          return res;
        }, function(err) {
          if (timer) clearTimeout(timer);
          if (i >= delays.length) throw new Error("Network error. Check your connection and try again.");
          if (onRetry) onRetry();
          return new Promise(function(resolve) {
            setTimeout(resolve, delays[i]);
          }).then(function() {
            return attempt(i + 1);
          });
        });
      }
      return attempt(0);
    }
    var READ_CEIL = 120;
    var readStamps = [];
    var readEaseUntil = 0;
    function readTrim(now) {
      while (readStamps.length && readStamps[0] <= now - 6e4) readStamps.shift();
    }
    function readMark() {
      var now = Date.now();
      readTrim(now);
      readStamps.push(now);
    }
    function readEase() {
      readEaseUntil = Date.now() + 15e3;
    }
    function readThrottled(d) {
      return !!(d && d.error && /too many|slow down/i.test(String(d.error)));
    }
    function readPace(base) {
      var now = Date.now();
      readTrim(now);
      var gap = base;
      if (now < readEaseUntil) gap = Math.max(gap, readEaseUntil - now, 8e3);
      if (readStamps.length >= READ_CEIL - 2) gap = Math.max(gap, 12e3);
      return gap;
    }
    function fmtDateTime(epoch2) {
      return new Date(epoch2 * 1e3).toLocaleString(
        "en-US",
        { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }
      );
    }
    function authSig() {
      return {
        hasKey: state.key,
        hasHash: state.myHash,
        profileLoaded: state.profileLoaded,
        myAdmin: state.myAdmin,
        hint: ADMIN_HASHES.indexOf(state.myHash) !== -1
      };
    }
    function isAdmin() {
      if (window.mcCore) return window.mcCore.authIsAdmin(authSig());
      if (!state.key) return false;
      if (state.profileLoaded) return state.myAdmin;
      return state.myAdmin || ADMIN_HASHES.indexOf(state.myHash) !== -1;
    }
    function isMember() {
      if (window.mcCore) return window.mcCore.authIsMember(authSig());
      return !!(state.key && state.myHash);
    }
    var profileWaiters = [];
    function adminGate(rerender) {
      var g = window.mcCore ? window.mcCore.authGate(authSig()) : isAdmin() ? "pass" : !state.key || state.profileLoaded ? "deny" : "wait";
      if (g === "pass") return false;
      if (g === "deny") {
        section.appendChild(el("p", "comments-status", "This page is for the admins."));
        return true;
      }
      section.appendChild(el("p", "comments-status", "Loading..."));
      if (rerender) profileWaiters.push(function() {
        section.textContent = "";
        rerender();
      });
      return true;
    }
    function sha256hex(text) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function(buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function(x) {
          return ("0" + x.toString(16)).slice(-2);
        }).join("");
      });
    }
    function getKey() {
      try {
        return localStorage.getItem(STORAGE) || "";
      } catch (e) {
        return "";
      }
    }
    function setKey(key) {
      if (window.mcStore) window.mcStore.invalidate();
      try {
        localStorage.setItem(STORAGE, key);
      } catch (e) {
      }
    }
    function clearKey() {
      try {
        localStorage.removeItem(STORAGE);
      } catch (e) {
      }
      try {
        localStorage.removeItem("mc-admin");
      } catch (e) {
      }
    }
    function makeKey() {
      var bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    var NACL_SRC = "tweetnacl.min.js?v=1";
    var _naclP = null;
    function ensureNacl() {
      if (window.nacl) return Promise.resolve(window.nacl);
      if (_naclP) return _naclP;
      _naclP = new Promise(function(resolve, reject) {
        var s = document.createElement("script");
        s.src = NACL_SRC;
        s.async = true;
        s.onload = function() {
          if (window.nacl) resolve(window.nacl);
          else {
            _naclP = null;
            reject(new Error("nacl"));
          }
        };
        s.onerror = function() {
          _naclP = null;
          reject(new Error("nacl load failed"));
        };
        document.head.appendChild(s);
      });
      return _naclP;
    }
    function dmB64uEnc(bytes) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function dmB64uDec(str) {
      var s = String(str).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      var bin = atob(s);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    var _dmKP = null, _dmKPFor = null;
    function myDmKeypair() {
      if (_dmKP && _dmKPFor === state.key) return _dmKP;
      var seed = nacl.hash(new TextEncoder().encode("mc/dm/x25519/v1|" + state.key)).subarray(0, 32);
      _dmKP = nacl.box.keyPair.fromSecretKey(new Uint8Array(seed));
      _dmKPFor = state.key;
      return _dmKP;
    }
    function dmEncrypt(plaintext, otherPubB64) {
      var kp = myDmKeypair();
      var nonce = nacl.randomBytes(24);
      var ct = nacl.box(new TextEncoder().encode(plaintext), nonce, dmB64uDec(otherPubB64), kp.secretKey);
      return "E1." + dmB64uEnc(nonce) + "." + dmB64uEnc(ct);
    }
    function dmDecrypt(blob, otherPubB64) {
      if (typeof blob !== "string" || blob.slice(0, 3) !== "E1." || !otherPubB64) return null;
      var parts = blob.split(".");
      if (parts.length !== 3) return null;
      try {
        var pt = nacl.box.open(dmB64uDec(parts[2]), dmB64uDec(parts[1]), dmB64uDec(otherPubB64), myDmKeypair().secretKey);
        return pt ? new TextDecoder().decode(pt) : null;
      } catch (e) {
        return null;
      }
    }
    function dmSafetyNumber(otherPubB64) {
      try {
        var mineBytes = myDmKeypair().publicKey;
        var mineB64 = dmB64uEnc(mineBytes);
        var theirBytes = dmB64uDec(otherPubB64);
        var mineFirst = mineB64 < otherPubB64;
        var f = mineFirst ? mineBytes : theirBytes;
        var s = mineFirst ? theirBytes : mineBytes;
        var cat = new Uint8Array(f.length + s.length);
        cat.set(f, 0);
        cat.set(s, f.length);
        var h = nacl.hash(cat);
        var hex = "";
        for (var i = 0; i < 10; i++) hex += ("0" + h[i].toString(16)).slice(-2);
        return hex.toUpperCase().replace(/(.{4})/g, "$1 ").trim();
      } catch (e) {
        return "";
      }
    }
    var _pubkeyFor = null;
    function ensureMyPubkey() {
      if (!state.key || !state.myHash || _pubkeyFor === state.key) return;
      var forKey = state.key;
      _pubkeyFor = forKey;
      ensureNacl().then(function() {
        return fetch(API + "/dm/pubkey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: forKey, pubkey: dmB64uEnc(myDmKeypair().publicKey) })
        });
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d || !d.ok) {
          if (_pubkeyFor === forKey) _pubkeyFor = null;
        }
      }).catch(function() {
        if (_pubkeyFor === forKey) _pubkeyFor = null;
      });
    }
    var DM_VERIFIED = "mc-dm-verified";
    function dmVerifiedSet() {
      try {
        var a = JSON.parse(localStorage.getItem(DM_VERIFIED));
        return Array.isArray(a) ? a : [];
      } catch (e) {
        return [];
      }
    }
    function dmVerified(other) {
      return dmVerifiedSet().indexOf(other) !== -1;
    }
    function dmMarkVerified(other) {
      var a = dmVerifiedSet();
      if (a.indexOf(other) === -1) {
        a.push(other);
        try {
          localStorage.setItem(DM_VERIFIED, JSON.stringify(a));
        } catch (e) {
        }
      }
    }
    function dmE2eExplainer() {
      appConfirm(
        "End-to-end encrypted. Your messages are encrypted on your own device before they are sent. We store them only as ciphertext, we do not hold the keys, and we cannot read your inbox \u2014 only you and the person you are writing to can open them. The encryption is standard, open X25519 + XSalsa20-Poly1305 (NaCl), and the code that runs it is public in our repository. To be sure no one is in the middle, compare the safety number at the top of a conversation. One thing to keep in mind: because only you hold your key, a lost key means the encrypted history cannot be recovered \u2014 not even by us.",
        { okLabel: "Got it", cancelLabel: "Close" },
        function() {
        }
      );
    }
    function dmVerifyPanel(other, otherPubB64, link) {
      appConfirm(
        "Safety number: " + dmSafetyNumber(otherPubB64) + ".  Read this aloud with the person you are messaging. If it matches on both sides, no one is intercepting this conversation. This is optional \u2014 your messages are encrypted either way.",
        { okLabel: "Mark verified", cancelLabel: "Close" },
        function(ok) {
          if (ok) {
            dmMarkVerified(other);
            if (link) link.textContent = "\u2713 verified";
          }
        }
      );
    }
    function dmE2eBadge(other, otherPubB64) {
      var e2e = el("p", "dm-e2e");
      e2e.appendChild(document.createTextNode("\u{1F512} End-to-end encrypted \xB7 "));
      var how = el("a", null, "how it works");
      how.href = "#";
      how.addEventListener("click", function(ev) {
        ev.preventDefault();
        dmE2eExplainer();
      });
      e2e.appendChild(how);
      if (other && otherPubB64) {
        e2e.appendChild(document.createTextNode(" \xB7 "));
        var v = el("a", null, dmVerified(other) ? "\u2713 verified" : "verify");
        v.href = "#";
        v.addEventListener("click", function(ev) {
          ev.preventDefault();
          dmVerifyPanel(other, otherPubB64, v);
        });
        e2e.appendChild(v);
      }
      return e2e;
    }
    function dmTtlLabel(ttl) {
      if (window.mcCore) return window.mcCore.dmTtlLabel(ttl);
      ttl = Number(ttl) || 2592e3;
      if (ttl <= 86400) return "24 hours";
      if (ttl >= 2592e3) return "30 days";
      return "7 days";
    }
    function dmTtlChoices() {
      return window.mcCore && window.mcCore.dmTtlOptions ? window.mcCore.dmTtlOptions.map(function(o) {
        return [o.secs, o.label];
      }) : [[86400, "24 hours"], [604800, "7 days"], [2592e3, "30 days"]];
    }
    function dmExpiryNode(other, ttl, isNew) {
      var p = el("p", "dm-expiry");
      var cur = Number(ttl) || 2592e3;
      function paint() {
        p.textContent = "";
        p.appendChild(document.createTextNode("\u23F3 " + (isNew ? "Messages here disappear " : "Disappears ") + dmTtlLabel(cur) + " after they are opened. "));
        var change = el("a", null, "change");
        change.href = "#";
        change.addEventListener("click", function(ev) {
          ev.preventDefault();
          chooser();
        });
        p.appendChild(change);
      }
      function chooser() {
        p.textContent = "Disappears after opening: ";
        dmTtlChoices().forEach(function(opt, i) {
          if (i) p.appendChild(document.createTextNode(" \xB7 "));
          var a = el("a", null, opt[1] + (cur === opt[0] ? " \u2713" : ""));
          a.href = "#";
          a.addEventListener("click", function(ev) {
            ev.preventDefault();
            fetch(API + "/dm/ttl", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, with: other, ttl: opt[0] })
            }).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (d && d.ok) {
                cur = opt[0];
                isNew = false;
                paint();
              }
            }).catch(function() {
            });
          });
          p.appendChild(a);
        });
        p.appendChild(document.createTextNode(" \xB7 "));
        var cancel = el("a", null, "cancel");
        cancel.href = "#";
        cancel.addEventListener("click", function(ev) {
          ev.preventDefault();
          paint();
        });
        p.appendChild(cancel);
      }
      p.mcSetTtl = function(t) {
        cur = Number(t) || cur;
        isNew = false;
        paint();
      };
      paint();
      return p;
    }
    function dmSaveControl(m, other) {
      if (!m || !m.id) return null;
      var a = el("a", "dm-save", m.saved ? "\u2605 saved" : "\u2606 save");
      a.href = "#";
      a.addEventListener("click", function(ev) {
        ev.preventDefault();
        var want = m.saved ? 0 : 1;
        fetch(API + "/dm/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, with: other, id: m.id, saved: !!want })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (d && d.ok) {
            m.saved = want;
            a.textContent = want ? "\u2605 saved" : "\u2606 save";
          }
        }).catch(function() {
        });
      });
      return a;
    }
    function fmtBytes(n) {
      n = Number(n) || 0;
      if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
      if (n >= 1024) return Math.round(n / 1024) + " KB";
      return n + " B";
    }
    function dmMediaEncryptFile(file) {
      return file.arrayBuffer().then(function(buf) {
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]).then(function(k) {
          return crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, buf).then(function(ctBuf) {
            return crypto.subtle.exportKey("raw", k).then(function(rawK) {
              return { ct: new Uint8Array(ctBuf), env: {
                k: dmB64uEnc(new Uint8Array(rawK)),
                iv: dmB64uEnc(iv),
                name: String(file.name || "file").slice(0, 120),
                mime: file.type || "application/octet-stream",
                size: file.size
              } };
            });
          });
        });
      });
    }
    function dmMediaDecrypt(ct, envInfo) {
      return crypto.subtle.importKey("raw", dmB64uDec(envInfo.k), { name: "AES-GCM" }, false, ["decrypt"]).then(function(k) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: dmB64uDec(envInfo.iv) }, k, ct);
      }).then(function(buf) {
        return new Uint8Array(buf);
      });
    }
    var _mediaCache = {};
    function loadDmMedia(mediaKey, envInfo) {
      if (_mediaCache[mediaKey]) return Promise.resolve(_mediaCache[mediaKey]);
      return fetch(API + "/dm/media/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, media_key: mediaKey })
      }).then(function(r) {
        if (!r.ok) throw new Error("media " + r.status);
        return r.arrayBuffer();
      }).then(function(buf) {
        return dmMediaDecrypt(new Uint8Array(buf), envInfo);
      }).then(function(bytes) {
        var url = URL.createObjectURL(new Blob([bytes], { type: envInfo && envInfo.mime || "application/octet-stream" }));
        _mediaCache[mediaKey] = url;
        return url;
      });
    }
    function dmMediaNode(m, otherLabel, other, envInfo) {
      var mine = m.sender_hash === state.myHash;
      var node = el("div", "dm-msg" + (mine ? " dm-mine" : ""));
      var head = el("div", "comment-head");
      head.appendChild(el("span", "comment-author", mine ? "You" : otherLabel));
      head.appendChild(el("span", "comment-date", " " + fmtDateTime(m.created_at)));
      node.appendChild(head);
      var bodyEl = el("div", "comment-body dm-media-body");
      var holder = el("div", "dm-media");
      holder.appendChild(el("p", "dm-media-status", "Loading " + (envInfo && envInfo.name || "media") + "\u2026"));
      bodyEl.appendChild(holder);
      if (envInfo && envInfo.caption) bodyEl.appendChild(fillBody(el("div", "dm-media-caption"), envInfo.caption));
      node.appendChild(bodyEl);
      loadDmMedia(m.media_key, envInfo).then(function(url) {
        holder.textContent = "";
        var mime = envInfo && envInfo.mime || "";
        var mel;
        var isFile = false;
        if (/^image\//.test(mime)) {
          mel = el("img", "dm-media-img");
          mel.src = url;
          mel.alt = envInfo.name || "image";
          mel.loading = "lazy";
        } else if (/^video\//.test(mime)) {
          mel = el("video", "dm-media-vid");
          mel.src = url;
          mel.controls = true;
        } else if (/^audio\//.test(mime)) {
          mel = el("audio", "dm-media-aud");
          mel.src = url;
          mel.controls = true;
        } else {
          isFile = true;
          mel = el("a", "dm-media-file", (envInfo.name || "download") + " \xB7 " + fmtBytes(envInfo.size));
          mel.href = url;
          mel.download = envInfo.name || "file";
        }
        holder.appendChild(mel);
        if (!isFile) {
          var dlRow = el("div", "dm-media-dl");
          dlRow.appendChild(mediaDownloadLink(url, envInfo.name || "download", "Download", "wall-act wall-act-dl dm-dl"));
          holder.appendChild(dlRow);
        }
      }).catch(function() {
        holder.textContent = "";
        holder.appendChild(el("span", "dm-media-status", "\u26A0\uFE0F media unavailable (it may have expired)"));
      });
      return node;
    }
    function dmMediaExpiredNode(m, otherLabel, caption) {
      var mine = m.sender_hash === state.myHash;
      var node = el("div", "dm-msg" + (mine ? " dm-mine" : ""));
      var head = el("div", "comment-head");
      head.appendChild(el("span", "comment-author", mine ? "You" : otherLabel));
      head.appendChild(el("span", "comment-date", " " + fmtDateTime(m.created_at)));
      node.appendChild(head);
      var bodyEl = el("div", "comment-body dm-media-body");
      var ph = el("div", "dm-media-expired");
      ph.appendChild(el("span", "dm-media-expired-icon", "\u{1F5BC}\uFE0F"));
      ph.appendChild(el("span", "dm-media-expired-text", "Attachment expired"));
      bodyEl.appendChild(ph);
      if (caption) bodyEl.appendChild(fillBody(el("div", "dm-media-caption"), caption));
      node.appendChild(bodyEl);
      return node;
    }
    function dmRenderMsg(m, otherPub, shortName, other) {
      if (m.redacted) return dmRedactedNode(m, shortName);
      var e = Number(m.enc || 0);
      var lbl = shortName;
      var node;
      if (m.media_key) {
        var envInfo = null;
        if (e === 1) {
          try {
            envInfo = JSON.parse(dmDecrypt(m.body, otherPub) || "null");
          } catch (x) {
            envInfo = null;
          }
        }
        if (envInfo) node = dmMediaNode(m, lbl, other, envInfo);
        else {
          m.body = "\u26A0\uFE0F could not open media";
          node = dmMsgNode(m, lbl);
        }
      } else if (m.media_expired) {
        var cap = "";
        if (e === 1) {
          try {
            var ev = JSON.parse(dmDecrypt(m.body, otherPub) || "null");
            cap = ev && ev.caption || "";
          } catch (x2) {
            cap = "";
          }
        }
        node = dmMediaExpiredNode(m, lbl, cap);
      } else {
        if (e === 1) m.body = dmDecrypt(m.body, otherPub) || "\u26A0\uFE0F could not decrypt";
        else if (e === 2) lbl = "\u2699\uFE0F Automated notice";
        node = dmMsgNode(m, lbl);
      }
      dmAppendControls(m, node, otherPub, shortName, other);
      return node;
    }
    function dmAppendControls(m, node, otherPub, shortName, other) {
      var sv = dmSaveControl(m, other);
      if (sv) node.appendChild(sv);
      var mine = m.sender_hash === state.myHash;
      if (!mine || m.redacted || Number(m.enc || 0) === 2 || !m.id) return;
      var row = el("div", "dm-msg-actions");
      if (!m.media_key) {
        var ed = el("a", null, "edit");
        ed.href = "#";
        ed.addEventListener("click", function(e) {
          e.preventDefault();
          dmStartEdit(m, node, otherPub, shortName, other);
        });
        row.appendChild(ed);
      }
      var del = el("a", "dm-del", "delete");
      del.href = "#";
      del.addEventListener("click", function(e) {
        e.preventDefault();
        appConfirm("Delete this message? A \u201C<redacted>\u201D note stands in its place for both of you until it would have disappeared anyway.", { okLabel: "Delete", danger: true }, function(ok) {
          if (!ok) return;
          fetch(API + "/dm/redact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, with: other, id: m.id })
          }).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (blockedOut(d)) return;
            if (d && d.ok) {
              m.redacted = 1;
              dmMakeRedacted(node, true);
            }
          }).catch(function() {
          });
        });
      });
      row.appendChild(del);
      node.appendChild(row);
    }
    function dmStartEdit(m, node, otherPub, shortName, other) {
      if (node.querySelector(".dm-edit-box")) return;
      var bodyEl = node.querySelector(".comment-body");
      var actions = node.querySelector(".dm-msg-actions");
      if (bodyEl) bodyEl.style.display = "none";
      if (actions) actions.style.display = "none";
      var box = el("div", "dm-edit-box");
      var ta = el("textarea", "comment-text");
      ta.rows = 3;
      ta.maxLength = 4e3;
      ta.value = m.body || "";
      box.appendChild(ta);
      var btns = el("div", "comment-buttons");
      var save = el("button", "btn btn-send", "Save");
      save.type = "button";
      var cancel = el("button", "btn", "Cancel");
      cancel.type = "button";
      btns.appendChild(save);
      btns.appendChild(cancel);
      box.appendChild(btns);
      var st = el("p", "form-status");
      box.appendChild(st);
      node.appendChild(box);
      ta.focus();
      function done() {
        box.remove();
        if (bodyEl) bodyEl.style.display = "";
        if (actions) actions.style.display = "";
      }
      cancel.addEventListener("click", done);
      save.addEventListener("click", function() {
        var nv = ta.value.replace(/\s+$/, "");
        if (!nv.trim()) {
          ta.focus();
          return;
        }
        if (nv === (m.body || "")) {
          done();
          return;
        }
        save.disabled = true;
        st.textContent = "Saving\u2026";
        fetch(API + "/dm/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, with: other, id: m.id, body: dmEncrypt(nv, otherPub), enc: 1 })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (blockedOut(d)) return;
          if (!d || !d.ok) {
            st.textContent = d && d.error || "Could not save.";
            save.disabled = false;
            return;
          }
          m.body = nv;
          m.edited_at = d.edited_at || Math.floor(Date.now() / 1e3);
          if (bodyEl) {
            bodyEl.textContent = "";
            fillBody(bodyEl, nv);
          }
          var head = node.querySelector(".comment-head");
          if (head && !head.querySelector(".dm-edited")) head.appendChild(el("span", "dm-edited", " (edited)"));
          done();
        }).catch(function() {
          st.textContent = "Network error. Try again.";
          save.disabled = false;
        });
      });
    }
    function dmMakeRedacted(node, mine) {
      node.classList.add("dm-redacted-msg");
      var body = node.querySelector(".comment-body");
      if (body) {
        body.textContent = "";
        body.className = "comment-body";
        body.appendChild(el("span", "dm-redacted", mine ? "<redacted> \u2014 you deleted this message" : "<redacted>"));
      }
      [".dm-msg-actions", ".dm-save", ".dm-edit-box", ".dm-receipt"].forEach(function(sel) {
        var n = node.querySelector(sel);
        if (n) n.remove();
      });
    }
    function ensureDmStyles() {
      if (document.getElementById("mc-dm-css")) return;
      var css = ".dm-expiry{font-size:0.85em;opacity:0.72;margin:0.15em 0 0.5em}.dm-expiry a{cursor:pointer}.dm-save{font-size:0.78em;opacity:0.55;margin-left:10px;cursor:pointer;white-space:nowrap}.dm-save:hover{opacity:0.9}.dm-attach-chip{display:inline-block;font-size:0.85em;opacity:0.85;margin:0.3em 0}.btn-attach{margin-left:6px}.dm-media{margin:0.1em 0}.dm-media-status{opacity:0.6;font-size:0.9em}.dm-media-img,.dm-media-vid{max-width:100%;max-height:60vh;border-radius:8px;display:block}.dm-media-aud{width:100%;max-width:320px}.dm-media-caption{margin-top:0.35em}.dm-media-expired{display:flex;align-items:center;gap:8px;padding:12px 14px;border:1px dashed var(--rule,#cbb);border-radius:10px;opacity:0.78}.dm-media-expired-icon{font-size:1.25em;filter:grayscale(1);opacity:0.7}.dm-media-expired-text{font-size:0.9em;font-style:italic;opacity:0.85}.dm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle;background:#c8c8c8}.dm-dot-on{background:#3ba55d;box-shadow:0 0 0 2px rgba(59,165,93,0.22)}.dm-dot-off{background:#c0c0c0}.dm-dot-unknown{background:#dcdcdc}.dm-typing{font-size:0.85em;opacity:0.7;font-style:italic;margin:0.25em 0.2em}.dm-receipt{display:block;font-size:0.72em;opacity:0.5;margin-top:2px}.dm-receipt-seen{opacity:0.8;color:var(--maroon,#8b1a1a)}.mc-inbox-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#3ba55d}.wall-media{margin:0.45em 0}.wall-media-el{max-width:100%;max-height:62vh;border-radius:8px;display:block}.wall-post-detail .wall-media-el{max-height:85vh}.wall-share{position:relative;display:inline-flex;align-items:center}.wall-share-menu{display:inline-flex;flex-wrap:wrap;gap:0.7em;margin-left:0.7em}.wall-media-gone{opacity:0.6;font-size:0.9em;font-style:italic}.wall-foot{margin-top:0.45em;font-size:0.9em}.wall-comments-toggle{cursor:pointer;opacity:0.78}.wall-comments-toggle:hover{opacity:1}.wall-comments{margin:0.55em 0 0.2em 0.9em;border-left:2px solid var(--rule,#e6e0d5);padding-left:0.85em}.wall-comment{margin:0.45em 0}.wall-newpill{display:inline-block;margin:0.4em 0;padding:0.3em 0.85em;border-radius:14px;background:var(--maroon,#8b1a1a);color:#fff;font-size:0.85em;cursor:pointer;text-decoration:none}.wall-composer{margin:0.6em 0 1.1em}.wall-del{color:var(--maroon,#8b1a1a);opacity:0.7}.wall-sentinel{height:1px}.dm-edited{font-size:0.72em;opacity:0.5;font-style:italic}.dm-redacted{font-style:italic;opacity:0.6}.dm-redacted-msg .comment-body{opacity:0.9}.dm-msg-actions{margin-top:2px}.dm-msg-actions a{font-size:0.78em;opacity:0.5;margin-right:10px;cursor:pointer;white-space:nowrap}.dm-msg-actions a:hover{opacity:0.9}.dm-del{color:var(--maroon,#8b1a1a)}.dm-edit-box textarea{width:100%;box-sizing:border-box}.dm-edit-box{margin-top:3px}.admin-set-row{margin:0.6em 0}.admin-set-row input[type=number]{width:6em}.mc-media-row{margin:0.5em 0}.mc-media-note{font-size:0.85em;opacity:0.75;margin-left:8px}.mc-rec-row{display:flex;align-items:center;gap:10px;margin:0.5em 0;flex-wrap:wrap}.mc-rec-dot{width:10px;height:10px;border-radius:50%;background:#c0392b;animation:mc-rec-pulse 1.1s ease-in-out infinite}@keyframes mc-rec-pulse{0%,100%{opacity:1}50%{opacity:0.25}}.mc-rec-time{font-variant-numeric:tabular-nums;font-size:0.9em;opacity:0.85}.mc-rec-audio{max-width:280px}";
      var st = el("style");
      st.id = "mc-dm-css";
      st.textContent = css;
      document.head.appendChild(st);
    }
    var _mediaCfgP = null;
    function mediaCfgFallback() {
      var core = window.mcCore;
      var d = core.mediaDefaults;
      return {
        enabled: true,
        kinds: { dm: core.mediaParseKinds(d.kindsDm), wall: core.mediaParseKinds(d.kindsWall), board: core.mediaParseKinds(d.kindsBoard) },
        max_bytes: { image: Number(d.imageMaxBytes), video: Number(d.videoMaxBytes), audio: Number(d.audioMaxBytes) },
        audio_max_seconds: Number(d.audioMaxSeconds),
        autocompress: true
      };
    }
    function mediaCfg() {
      if (_mediaCfgP) return _mediaCfgP;
      _mediaCfgP = cachedJson(API + "/config", void 0, 3e5).then(function(d) {
        if (d && d.ok && d.media && d.media.kinds && d.media.max_bytes) return d.media;
        return mediaCfgFallback();
      }).catch(function() {
        return mediaCfgFallback();
      });
      return _mediaCfgP;
    }
    function mkFile(parts, name, type) {
      var F = window.File;
      try {
        return new F(parts, name, { type });
      } catch (e) {
        var b = new Blob(parts, { type });
        b.name = name;
        return b;
      }
    }
    function compressImage(file, cfg) {
      if (!/^image\//.test(String(file.type || ""))) return Promise.resolve(file);
      if (!cfg || cfg.autocompress === false) return Promise.resolve(file);
      if (file.size <= 524288 && file.type === "image/jpeg") return Promise.resolve(file);
      var cib = window.createImageBitmap;
      if (typeof cib !== "function") return Promise.resolve(file);
      var limit = Number(cfg.max_bytes && cfg.max_bytes.image) || 10485760;
      return cib(file).then(function(bmp) {
        var scale = Math.min(1, 2048 / Math.max(bmp.width || 1, bmp.height || 1));
        if (scale === 1 && file.type === "image/jpeg" && file.size <= limit) {
          try {
            bmp.close();
          } catch (e) {
          }
          return file;
        }
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bmp.width * scale));
        canvas.height = Math.max(1, Math.round(bmp.height * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) {
          try {
            bmp.close();
          } catch (e) {
          }
          return file;
        }
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        try {
          bmp.close();
        } catch (e) {
        }
        function encode(q) {
          return new Promise(function(resolve) {
            canvas.toBlob(resolve, "image/jpeg", q);
          });
        }
        return encode(0.8).then(function(blob) {
          if (blob && blob.size > limit) return encode(0.65);
          return blob;
        }).then(function(blob) {
          if (!blob) return file;
          var name = String(file.name || "image").replace(/\.[A-Za-z0-9]+$/, "") + ".jpg";
          return mkFile([blob], name, "image/jpeg");
        });
      }, function() {
        return null;
      });
    }
    function mediaGateFile(f, cfg, kinds, statusEl) {
      var core = window.mcCore;
      var kind = core ? core.mediaKindOfMime(String(f.type || "")) : null;
      if (!cfg.enabled) {
        statusEl.textContent = "Media sharing is turned off.";
        return Promise.resolve(null);
      }
      if (!kind || (kinds || []).indexOf(kind) === -1) {
        statusEl.textContent = "That file type cannot be shared here" + (kinds && kinds.length ? " \u2014 only " + kinds.join(", ") + "." : ".");
        return Promise.resolve(null);
      }
      var p = kind === "image" ? compressImage(f, cfg) : Promise.resolve(f);
      return p.then(function(out) {
        if (!out) {
          statusEl.textContent = "That image could not be read.";
          return null;
        }
        var limit = Number(cfg.max_bytes && cfg.max_bytes[kind]) || 0;
        if (limit && out.size > limit) {
          statusEl.textContent = "That " + kind + " is too large \u2014 the limit is " + Math.round(limit / 1048576) + " MB.";
          return null;
        }
        return out;
      });
    }
    var LAME_SRC = "lamejs.min.js?v=1";
    var _lameP = null;
    function ensureLame() {
      var w = window;
      if (w.lamejs) return Promise.resolve(w.lamejs);
      if (_lameP) return _lameP;
      _lameP = new Promise(function(resolve, reject) {
        var s = document.createElement("script");
        s.src = LAME_SRC;
        s.async = true;
        s.onload = function() {
          if (w.lamejs) resolve(w.lamejs);
          else {
            _lameP = null;
            reject(new Error("lamejs"));
          }
        };
        s.onerror = function() {
          _lameP = null;
          reject(new Error("lamejs load failed"));
        };
        document.head.appendChild(s);
      });
      return _lameP;
    }
    function voiceSupported() {
      var w = window;
      var nav = navigator;
      return !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && w.MediaRecorder && w.MediaRecorder.isTypeSupported);
    }
    function voiceMime() {
      var MR = window.MediaRecorder;
      var list = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", ""];
      for (var i = 0; i < list.length; i++) {
        if (list[i] === "" || MR.isTypeSupported(list[i])) return list[i];
      }
      return "";
    }
    function fmtSecs(s) {
      s = Math.max(0, Math.floor(Number(s) || 0));
      return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2);
    }
    function voiceRawFile(blob) {
      var t = String(blob.type || "");
      var ext = t.indexOf("mp4") !== -1 ? "m4a" : t.indexOf("ogg") !== -1 ? "ogg" : "webm";
      return mkFile([blob], "voice-note." + ext, t || "audio/webm");
    }
    function voiceMp3Encode(blob) {
      return ensureLame().then(function(lame) {
        return blob.arrayBuffer().then(function(buf) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) throw new Error("no audio context");
          var ctx = new AC();
          return new Promise(function(resolve, reject) {
            ctx.decodeAudioData(buf, resolve, reject);
          }).then(function(audio) {
            try {
              ctx.close();
            } catch (e) {
            }
            var chs = audio.numberOfChannels || 1;
            var len = audio.length;
            var mono = new Float32Array(len);
            for (var c = 0; c < chs; c++) {
              var data = audio.getChannelData(c);
              for (var i = 0; i < len; i++) mono[i] += data[i];
            }
            if (chs > 1) for (var j = 0; j < len; j++) mono[j] /= chs;
            var pcm = new Int16Array(len);
            for (var k = 0; k < len; k++) {
              var v = Math.max(-1, Math.min(1, mono[k]));
              pcm[k] = Math.round(v * 32767);
            }
            var enc = new lame.Mp3Encoder(1, audio.sampleRate, 64);
            var parts = [];
            var pos = 0;
            function step() {
              var n = 0;
              while (pos < len && n < 64) {
                var out = enc.encodeBuffer(pcm.subarray(pos, Math.min(pos + 1152, len)));
                if (out && out.length) parts.push(out);
                pos += 1152;
                n++;
              }
              if (pos < len) return new Promise(function(r) {
                setTimeout(r, 0);
              }).then(step);
              var tail = enc.flush();
              if (tail && tail.length) parts.push(tail);
              return mkFile(parts, "voice-note.mp3", "audio/mpeg");
            }
            return step();
          });
        });
      });
    }
    function startVoiceRecorder(form, cfg, statusEl, takeFile) {
      if (form.querySelector(".mc-rec-row")) return;
      var maxSecs = Number(cfg.audio_max_seconds) || 180;
      var maxBytes = Number(cfg.max_bytes && cfg.max_bytes.audio) || 5242880;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        var MR = window.MediaRecorder;
        var mt = voiceMime();
        var opts = { audioBitsPerSecond: 64e3 };
        if (mt) opts.mimeType = mt;
        var rec;
        try {
          rec = new MR(stream, opts);
        } catch (e) {
          stream.getTracks().forEach(function(t) {
            t.stop();
          });
          statusEl.textContent = "Recording is not available in this browser.";
          return;
        }
        var row = el("div", "mc-rec-row");
        row.appendChild(el("span", "mc-rec-dot"));
        var time = el("span", "mc-rec-time", "0:00 / " + fmtSecs(maxSecs));
        row.appendChild(time);
        var stopBtn = el("button", "btn", "Stop");
        stopBtn.type = "button";
        row.appendChild(stopBtn);
        form.appendChild(row);
        var chunks = [];
        var bytes = 0;
        var startedAt = Date.now();
        var stopped = false;
        function stopNow() {
          if (stopped) return;
          stopped = true;
          clearInterval(tick);
          try {
            rec.stop();
          } catch (e) {
          }
        }
        var tick = setInterval(function() {
          var s = Math.floor((Date.now() - startedAt) / 1e3);
          time.textContent = fmtSecs(Math.min(s, maxSecs)) + " / " + fmtSecs(maxSecs);
          if (s >= maxSecs) stopNow();
        }, 250);
        stopBtn.addEventListener("click", stopNow);
        rec.ondataavailable = function(ev) {
          if (ev.data && ev.data.size) {
            chunks.push(ev.data);
            bytes += ev.data.size;
            if (bytes > maxBytes) stopNow();
          }
        };
        rec.onstop = function() {
          stream.getTracks().forEach(function(t) {
            t.stop();
          });
          row.remove();
          var blob = new Blob(chunks, { type: rec.mimeType || mt || "audio/webm" });
          if (!blob.size) {
            statusEl.textContent = "Nothing was recorded.";
            return;
          }
          voicePreview(form, cfg, statusEl, blob, takeFile);
        };
        try {
          rec.start(1e3);
        } catch (e) {
          stopNow();
        }
      }).catch(function() {
        statusEl.textContent = "Microphone access was refused.";
      });
    }
    function voicePreview(form, cfg, statusEl, blob, takeFile) {
      var row = el("div", "mc-rec-row mc-rec-preview");
      var url = URL.createObjectURL(blob);
      var player = el("audio", "mc-rec-audio");
      player.src = url;
      player.controls = true;
      row.appendChild(player);
      var use = el("button", "btn btn-send", "Use this");
      use.type = "button";
      var redo = el("button", "btn", "Re-record");
      redo.type = "button";
      var drop = el("button", "btn", "Discard");
      drop.type = "button";
      row.appendChild(use);
      row.appendChild(redo);
      row.appendChild(drop);
      form.appendChild(row);
      function cleanup() {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
        }
        row.remove();
      }
      drop.addEventListener("click", function() {
        cleanup();
      });
      redo.addEventListener("click", function() {
        cleanup();
        startVoiceRecorder(form, cfg, statusEl, takeFile);
      });
      use.addEventListener("click", function() {
        use.disabled = true;
        redo.disabled = true;
        drop.disabled = true;
        statusEl.textContent = "Preparing\u2026";
        voiceMp3Encode(blob).catch(function() {
          return voiceRawFile(blob);
        }).then(function(f) {
          statusEl.textContent = "";
          cleanup();
          takeFile(f);
        });
      });
    }
    function voiceControl(form, cfg, statusEl, takeFile) {
      var btn = el("button", "btn btn-attach mc-voice-btn", "\u{1F399} Voice");
      btn.type = "button";
      if (!voiceSupported()) {
        var fi = el("input", "mc-voice-input");
        fi.type = "file";
        fi.accept = "audio/*";
        fi.setAttribute("capture", "");
        fi.style.display = "none";
        fi.addEventListener("change", function() {
          var f = fi.files && fi.files[0];
          if (f) takeFile(f);
          fi.value = "";
        });
        form.appendChild(fi);
        btn.addEventListener("click", function() {
          fi.click();
        });
        return btn;
      }
      btn.addEventListener("click", function() {
        startVoiceRecorder(form, cfg, statusEl, takeFile);
      });
      return btn;
    }
    var section = document.querySelector("section[data-comments], section[data-board]");
    if (!section) return;
    var BOARD = section.hasAttribute("data-board");
    var CATS = window.mcCore.boardCatRows;
    function catDescNode(tag, cat) {
      var node = el(tag, "board-cat-desc", cat[2]);
      if (cat[3]) {
        var a = el("a", null, cat[3]);
        a.href = cat[4];
        node.appendChild(a);
        node.appendChild(document.createTextNode("."));
      }
      return node;
    }
    function catByKey(key) {
      for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === key) return CATS[i];
      return null;
    }
    var state = {
      key: getKey(),
      myHash: "",
      myNick: "",
      myAdmin: false,
      profileLoaded: false,
      started: false,
      widgetId: null,
      tokenWait: null,
      anonAllowed: false,
      altIps: { ipv4: "", ipv6: "" },
      dmView: null
      // set by viewDm: the open thread's live drop-in hook
    };
    var rdnsCache = {};
    function renderTurnstileWidget() {
      if (!window.turnstile) return;
      var slot = section.querySelector(".ts-slot");
      if (!slot) return;
      if (state.widgetId !== null && slot.querySelector("iframe")) return;
      try {
        state.widgetId = turnstile.render(slot, {
          sitekey: SITEKEY,
          execution: "execute",
          appearance: "interaction-only",
          callback: function(token) {
            if (state.tokenWait) {
              state.tokenWait.resolve(token);
              state.tokenWait = null;
            }
          },
          "error-callback": function() {
            if (state.tokenWait) {
              state.tokenWait.reject(new Error("challenge failed"));
              state.tokenWait = null;
            }
            return true;
          },
          "expired-callback": function() {
          }
        });
      } catch (e) {
      }
    }
    function loadTurnstile() {
      if (window.turnstile) {
        renderTurnstileWidget();
        return;
      }
      if (document.getElementById("mc-ts-script")) return;
      window.__mcCommentsTs = function() {
        renderTurnstileWidget();
      };
      var script = document.createElement("script");
      script.id = "mc-ts-script";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__mcCommentsTs&render=explicit";
      script.async = true;
      script.onerror = function() {
        state.tsError = true;
      };
      document.head.appendChild(script);
    }
    function getToken() {
      return new Promise(function(resolve, reject) {
        loadTurnstile();
        var waited = 0;
        var STEP = 150, MAX = 1e4;
        function run() {
          if (state.tsError) {
            reject(new Error("Verification could not load. Check your connection and reload the page."));
            return;
          }
          if (window.turnstile && state.widgetId === null) renderTurnstileWidget();
          if (!window.turnstile || state.widgetId === null) {
            if (waited >= MAX) {
              reject(new Error("Verification is taking a moment to load. Give it a few seconds and press the button again."));
              return;
            }
            waited += STEP;
            setTimeout(run, STEP);
            return;
          }
          state.tokenWait = { resolve, reject };
          try {
            turnstile.execute(state.widgetId);
          } catch (e) {
            state.tokenWait = null;
            reject(e);
          }
        }
        run();
      });
    }
    var quotedSelection = "";
    function selectionInPost(c) {
      try {
        var sel = window.getSelection && window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
        var post2 = document.getElementById("comment-" + c.id);
        var bodyEl = post2 && post2.querySelector(".comment-body");
        if (!bodyEl) return "";
        if (!bodyEl.contains(sel.getRangeAt(0).commonAncestorContainer)) return "";
        return sel.toString().replace(/^\s+|\s+$/g, "").slice(0, 1e3);
      } catch (e) {
        return "";
      }
    }
    function truncate(s, n) {
      s = String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
      if (s.length <= n) return s;
      var cut = s.slice(0, n);
      var sp = cut.lastIndexOf(" ");
      if (sp > n * 0.6) cut = cut.slice(0, sp);
      return cut.replace(/\s+$/, "") + "\u2026";
    }
    function permalinkFor(c, ctx) {
      var origin = "https://merecatholicity.com";
      if (ctx && ctx.topicId) {
        return origin + "/community.html?topic=" + ctx.topicId + "#comment-" + c.id;
      }
      return origin + (ctx && ctx.page || pagePath()) + "#comment-" + c.id;
    }
    function quoteInto(c, excerpt, url) {
      var ta = section.querySelector(".comment-form .comment-text");
      if (!ta) return;
      if (ta.mcPreview && ta.mcPreview.active) ta.mcPreview.off();
      var name = (c.nick || (c.author_hash ? displayName(c.author_hash) : "Anonymous")).replace(/[\[\]()\r\n]/g, "");
      var quoted = String(excerpt == null ? "" : excerpt).split("\n").map(function(ln) {
        return "> " + ln;
      }).join("\n");
      var block = "> [" + name + " wrote:](" + url + ")\n" + quoted + "\n\n";
      var existing = ta.value;
      var sep = !existing ? "" : /\n\n$/.test(existing) ? "" : /\n$/.test(existing) ? "\n" : "\n\n";
      var addition = sep + block;
      var room = 4e3 - existing.length;
      if (room <= 0) {
        ta.focus();
        return;
      }
      if (addition.length > room) addition = addition.slice(0, room);
      ta.value = existing + addition;
      try {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch (e) {
      }
      afterEdit(ta);
      ta.scrollIntoView({ block: "center" });
    }
    function afterEdit(ta) {
      ta.focus();
      try {
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
      }
    }
    function wrapSel(ta, before, after) {
      var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b);
      if (sel) {
        ta.value = s.slice(0, a) + before + sel + after + s.slice(b);
        try {
          ta.setSelectionRange(a + before.length, a + before.length + sel.length);
        } catch (e) {
        }
      } else {
        ta.value = s.slice(0, a) + before + after + s.slice(a);
        var caret = a + before.length;
        try {
          ta.setSelectionRange(caret, caret);
        } catch (e) {
        }
      }
      afterEdit(ta);
    }
    function linePrefix(ta, prefix) {
      var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      var start2 = s.lastIndexOf("\n", a - 1) + 1;
      var end = s.indexOf("\n", b);
      if (end === -1) end = s.length;
      var block = s.slice(start2, end).split("\n").map(function(ln) {
        return prefix + ln;
      }).join("\n");
      ta.value = s.slice(0, start2) + block + s.slice(end);
      try {
        ta.setSelectionRange(start2, start2 + block.length);
      } catch (e) {
      }
      afterEdit(ta);
    }
    function insertLink(ta) {
      var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b) || "text";
      var url = "https://merecatholicity.com/";
      ta.value = s.slice(0, a) + "[" + sel + "](" + url + ")" + s.slice(b);
      var urlStart = a + sel.length + 3;
      try {
        ta.setSelectionRange(urlStart, urlStart + url.length);
      } catch (e) {
      }
      afterEdit(ta);
    }
    function mdButton(label, title, cls, handler) {
      var btn = el("button", "md-btn" + (cls ? " " + cls : ""), label);
      btn.type = "button";
      btn.title = title;
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        handler();
      });
      return btn;
    }
    function emojiToken(code, raw) {
      var c = code.toLowerCase();
      if (CUSTOM_EMOJI[c]) return emojiImg(CUSTOM_EMOJI[c], c);
      if (NAMED_EMOJI[c]) return document.createTextNode(NAMED_EMOJI[c]);
      return document.createTextNode(raw);
    }
    function emojiImg(path, code) {
      ensureEmojiStyles();
      var img = el("img", "mc-emoji");
      img.src = path;
      img.alt = ":" + code + ":";
      img.title = ":" + code + ":";
      img.loading = "lazy";
      img.decoding = "async";
      return img;
    }
    var emojiData = null, emojiDataPromise = null;
    function loadEmojiData() {
      if (emojiDataPromise) return emojiDataPromise;
      emojiDataPromise = fetch("emoji/emoji-data.json").then(function(r) {
        return r.json();
      }).then(function(d) {
        var flat = [];
        (d.groups || []).forEach(function(g) {
          g.e.forEach(function(e) {
            flat.push({ c: e[0], a: e[1], k: e[2] });
          });
        });
        emojiData = { groups: d.groups || [], flat };
        return emojiData;
      }).catch(function() {
        emojiData = { groups: [], flat: [] };
        return emojiData;
      });
      return emojiDataPromise;
    }
    function prefetchEmoji() {
      loadEmojiData();
    }
    var avatarPresetsPromise = null;
    function loadAvatarPresets() {
      if (avatarPresetsPromise) return avatarPresetsPromise;
      avatarPresetsPromise = fetch("avatars/presets/index.json").then(function(r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      }).then(function(d) {
        return d && d.packs || [];
      }).catch(function(e) {
        avatarPresetsPromise = null;
        throw e;
      });
      return avatarPresetsPromise;
    }
    function emojiSearch(q, limit) {
      q = String(q).toLowerCase();
      if (!q) return [];
      var pre = [], sub = [], seen = {};
      Object.keys(EMOJI_PACKS).forEach(function(pk) {
        EMOJI_PACKS[pk].forEach(function(e) {
          var i = e[0].indexOf(q);
          if (i === 0) pre.push({ kind: "img", code: e[0], path: e[1] });
          else if (i > 0) sub.push({ kind: "img", code: e[0], path: e[1] });
        });
      });
      if (emojiData && emojiData.flat.length) {
        emojiData.flat.forEach(function(e) {
          if (e.a.indexOf(q) === 0 || (" " + e.k).indexOf(" " + q) > -1) pre.push({ kind: "char", char: e.c, label: e.a });
          else if (e.k.indexOf(q) > -1) sub.push({ kind: "char", char: e.c, label: e.a });
        });
      } else {
        Object.keys(NAMED_EMOJI).forEach(function(n) {
          var i = n.indexOf(q);
          if (i === 0) pre.push({ kind: "char", char: NAMED_EMOJI[n], label: n });
          else if (i > 0) sub.push({ kind: "char", char: NAMED_EMOJI[n], label: n });
        });
      }
      var out = [];
      pre.concat(sub).forEach(function(it) {
        var key = it.kind === "img" ? "i" + it.code : "c" + it.char;
        if (seen[key] || out.length >= limit) return;
        seen[key] = 1;
        out.push(it);
      });
      return out;
    }
    function insertAtCaret(ta, text) {
      var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      ta.value = s.slice(0, a) + text + s.slice(b);
      var np = a + text.length;
      try {
        ta.setSelectionRange(np, np);
      } catch (e) {
      }
      afterEdit(ta);
    }
    function insertEmojiItem(ta, it) {
      insertAtCaret(ta, it.kind === "img" ? ":" + it.code + ":" : it.char);
    }
    function attachEmoji(textarea) {
      if (!textarea || textarea.dataset.emojiac) return;
      textarea.dataset.emojiac = "1";
      var sug = el("div", "mention-suggest emoji-suggest");
      sug.hidden = true;
      textarea.parentNode.insertBefore(sug, textarea.nextSibling);
      var current = [], sel = 0, at = -1, timer = null;
      function render() {
        sug.textContent = "";
        if (!current.length) {
          sug.hidden = true;
          return;
        }
        current.forEach(function(it, i) {
          var r = el("a", "dm-suggest-row emoji-suggest-row" + (i === sel ? " dm-suggest-sel" : ""));
          r.href = "#";
          var g = el("span", "emoji-suggest-glyph");
          if (it.kind === "img") g.appendChild(emojiImg(it.path, it.code));
          else g.textContent = it.char;
          r.appendChild(g);
          r.appendChild(el("span", null, ":" + (it.kind === "img" ? it.code : it.label) + ":"));
          r.addEventListener("mousedown", function(e) {
            e.preventDefault();
            pick(it);
          });
          sug.appendChild(r);
        });
        sug.hidden = false;
      }
      function scan() {
        var caret = textarea.selectionStart;
        var m = /(^|\s):([a-z0-9][a-z0-9_+-]{0,39})$/i.exec(textarea.value.slice(0, caret));
        if (!m) {
          current = [];
          at = -1;
          sug.hidden = true;
          return;
        }
        at = caret - m[2].length - 1;
        var q = m[2].toLowerCase();
        current = emojiSearch(q, 30);
        sel = 0;
        render();
        if (!emojiData) loadEmojiData().then(function() {
          if (at > -1) {
            current = emojiSearch(q, 30);
            render();
          }
        });
      }
      function pick(it) {
        if (at < 0) return;
        var caret = textarea.selectionStart, v = textarea.value;
        var ins = it.kind === "img" ? ":" + it.code + ":" : it.char;
        textarea.value = v.slice(0, at) + ins + " " + v.slice(caret);
        var np = at + ins.length + 1;
        try {
          textarea.setSelectionRange(np, np);
        } catch (e) {
        }
        current = [];
        at = -1;
        sug.hidden = true;
        afterEdit(textarea);
      }
      textarea.addEventListener("input", function() {
        clearTimeout(timer);
        timer = setTimeout(scan, 100);
      });
      textarea.addEventListener("keydown", function(e) {
        if (sug.hidden || !current.length) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          sel = Math.min(sel + 1, current.length - 1);
          render();
          scrollSel();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          sel = Math.max(sel - 1, 0);
          render();
          scrollSel();
        } else if (e.key === "Enter" || e.key === "Tab") {
          if (current[sel]) {
            e.preventDefault();
            pick(current[sel]);
          }
        } else if (e.key === "Escape") {
          current = [];
          sug.hidden = true;
        }
      });
      function scrollSel() {
        var s = sug.querySelector(".dm-suggest-sel");
        if (s && s.scrollIntoView) s.scrollIntoView({ block: "nearest" });
      }
      textarea.addEventListener("blur", function() {
        setTimeout(function() {
          sug.hidden = true;
        }, 200);
      });
    }
    function buildEmojiPanel(textarea) {
      ensureEmojiStyles();
      var panel = el("div", "emoji-panel");
      panel.hidden = true;
      var search = el("input", "emoji-search");
      search.type = "search";
      search.placeholder = "Search emoji...";
      var srow = el("div", "emoji-search-row");
      srow.appendChild(search);
      panel.appendChild(srow);
      var tabs = el("div", "emoji-tabs"), body = el("div", "emoji-body");
      var TABS = [["standard", "Emoji"], ["memes", "Memes"], ["pepe", "Pepe"]];
      var active = "standard", tabBtns = {};
      TABS.forEach(function(t) {
        var b = el("button", "emoji-tab", t[1]);
        b.type = "button";
        b.addEventListener("click", function() {
          active = t[0];
          search.value = "";
          mark();
          draw();
        });
        tabBtns[t[0]] = b;
        tabs.appendChild(b);
      });
      panel.appendChild(tabs);
      panel.appendChild(body);
      function mark() {
        TABS.forEach(function(t) {
          tabBtns[t[0]].className = "emoji-tab" + (t[0] === active ? " emoji-tab-on" : "");
        });
      }
      function put(it) {
        insertEmojiItem(textarea, it);
        textarea.focus();
      }
      function cellChar(ch, label) {
        var b = el("button", "emoji-cell");
        b.type = "button";
        b.textContent = ch;
        b.title = ":" + label + ":";
        b.addEventListener("click", function() {
          put({ kind: "char", char: ch });
        });
        return b;
      }
      function cellImg(code, path) {
        var b = el("button", "emoji-cell");
        b.type = "button";
        b.title = ":" + code + ":";
        b.appendChild(emojiImg(path, code));
        b.addEventListener("click", function() {
          put({ kind: "img", code });
        });
        return b;
      }
      function gridImgs(pairs) {
        var g = el("div", "emoji-grid");
        pairs.forEach(function(e) {
          g.appendChild(cellImg(e[0], e[1]));
        });
        return g;
      }
      function draw() {
        body.textContent = "";
        var q = search.value.trim();
        if (q) {
          var res = emojiSearch(q, 250);
          if (!res.length) {
            body.appendChild(el("p", "emoji-empty", "No matches."));
            return;
          }
          var g = el("div", "emoji-grid");
          res.forEach(function(it) {
            g.appendChild(it.kind === "img" ? cellImg(it.code, it.path) : cellChar(it.char, it.label));
          });
          body.appendChild(g);
          return;
        }
        if (active === "memes") {
          body.appendChild(gridImgs(EMOJI_PACKS.memes));
          return;
        }
        if (active === "pepe") {
          body.appendChild(gridImgs(EMOJI_PACKS.pepe));
          return;
        }
        if (emojiData && emojiData.groups.length) {
          emojiData.groups.forEach(function(grp) {
            body.appendChild(el("div", "emoji-group-head", grp.g));
            var g3 = el("div", "emoji-grid");
            grp.e.forEach(function(e) {
              g3.appendChild(cellChar(e[0], e[1]));
            });
            body.appendChild(g3);
          });
        } else {
          var g2 = el("div", "emoji-grid");
          STANDARD_EMOJI.forEach(function(ch) {
            g2.appendChild(cellChar(ch, ch));
          });
          body.appendChild(g2);
          loadEmojiData().then(function() {
            if (active === "standard" && !search.value.trim() && !panel.hidden) draw();
          });
        }
      }
      search.addEventListener("input", draw);
      panel.openPanel = function() {
        panel.hidden = false;
        mark();
        draw();
        loadEmojiData();
        try {
          if (window.matchMedia && window.matchMedia("(hover: none)").matches) search.focus();
        } catch (e) {
        }
      };
      panel.closePanel = function() {
        panel.hidden = true;
      };
      panel.toggle = function() {
        if (panel.hidden) panel.openPanel();
        else panel.closePanel();
      };
      return panel;
    }
    var kjvData = null, kjvPromise = null;
    function loadKjv() {
      if (kjvPromise) return kjvPromise;
      kjvPromise = fetch("kjv.json").then(function(r) {
        return r.json();
      }).then(function(d) {
        kjvData = d;
        return d;
      }).catch(function() {
        kjvData = { books: [] };
        return kjvData;
      });
      return kjvPromise;
    }
    var drData = null, drPromise = null;
    function loadDr() {
      if (drPromise) return drPromise;
      drPromise = fetch("dr.json").then(function(r) {
        return r.json();
      }).then(function(d) {
        drData = d;
        return d;
      }).catch(function() {
        drData = { books: [] };
        return drData;
      });
      return drPromise;
    }
    function buildScripturePanel(textarea) {
      ensureEmojiStyles();
      var panel = el("div", "emoji-panel scripture-panel");
      panel.hidden = true;
      var row = el("div", "scripture-row");
      var bookSel = el("select", "scripture-sel");
      var chapSel = el("select", "scripture-sel scripture-sel-sm");
      var v1Sel = el("select", "scripture-sel scripture-sel-sm");
      var dash = el("span", "scripture-dash", "\u2013");
      var v2Sel = el("select", "scripture-sel scripture-sel-sm");
      row.appendChild(bookSel);
      row.appendChild(el("span", "scripture-sp", " "));
      row.appendChild(chapSel);
      row.appendChild(el("span", "scripture-colon", ":"));
      row.appendChild(v1Sel);
      row.appendChild(dash);
      row.appendChild(v2Sel);
      panel.appendChild(row);
      var status = el("div", "scripture-status", "Loading the King James text\u2026");
      panel.appendChild(status);
      var preview = el("blockquote", "scripture-preview");
      preview.hidden = true;
      panel.appendChild(preview);
      var insert = el("button", "scripture-insert", "Insert passage");
      insert.type = "button";
      panel.appendChild(insert);
      function opts(sel, n, label) {
        sel.textContent = "";
        for (var i = 1; i <= n; i++) {
          var o = el("option");
          o.value = i;
          o.textContent = label ? label + " " + i : i;
          sel.appendChild(o);
        }
      }
      function curBook() {
        return kjvData.books[bookSel.value ? +bookSel.value - 1 : 0];
      }
      function fillBooks() {
        bookSel.textContent = "";
        kjvData.books.forEach(function(b, i) {
          var o = el("option");
          o.value = i + 1;
          o.textContent = b.name;
          bookSel.appendChild(o);
        });
        fillChapters();
      }
      function fillChapters() {
        opts(chapSel, curBook().chapters.length, "Chapter");
        fillVerses();
      }
      function fillVerses() {
        var ch = curBook().chapters[+chapSel.value - 1] || [];
        opts(v1Sel, ch.length);
        opts(v2Sel, ch.length);
        drawPreview();
      }
      function drawPreview() {
        var a = +v1Sel.value || 1, z = +v2Sel.value || a;
        if (z < a) {
          z = a;
          v2Sel.value = a;
        }
        var ch = curBook().chapters[+chapSel.value - 1] || [], parts = [];
        for (var v = a; v <= z; v++) if (ch[v - 1]) parts.push(ch[v - 1]);
        fillBody(preview, parts.join(" "));
        preview.hidden = !parts.length;
      }
      function passage() {
        var b = curBook(), c = +chapSel.value, a = +v1Sel.value, z = +v2Sel.value;
        if (z < a) z = a;
        var ch = b.chapters[c - 1] || [], parts = [];
        for (var v = a; v <= z; v++) if (ch[v - 1]) parts.push(ch[v - 1]);
        var ref = b.name + " " + c + ":" + a + (z > a ? "-" + z : "");
        return "> " + parts.join(" ") + " (" + ref + ")\n";
      }
      function enhSel(sel, label) {
        sel.setAttribute("aria-label", label);
        if (window.mcSelectSheet) {
          var h = window.mcSelectSheet(sel);
          if (h) h.refresh();
        }
      }
      function enhAll() {
        enhSel(bookSel, "Book");
        enhSel(chapSel, "Chapter");
        enhSel(v1Sel, "From verse");
        enhSel(v2Sel, "To verse");
      }
      bookSel.addEventListener("change", function() {
        fillChapters();
        enhAll();
      });
      chapSel.addEventListener("change", function() {
        fillVerses();
        enhAll();
      });
      v1Sel.addEventListener("change", function() {
        drawPreview();
        enhAll();
      });
      v2Sel.addEventListener("change", function() {
        drawPreview();
        enhAll();
      });
      insert.addEventListener("click", function() {
        insertAtCaret(textarea, passage());
        textarea.focus();
        panel.closePanel();
      });
      panel.openPanel = function() {
        panel.hidden = false;
        if (kjvData) {
          status.hidden = true;
          fillBooks();
          enhAll();
        } else {
          status.hidden = false;
          loadKjv().then(function() {
            if (kjvData.books.length) {
              status.hidden = true;
              fillBooks();
              enhAll();
            } else status.textContent = "Could not load the Bible text.";
          });
        }
      };
      panel.closePanel = function() {
        panel.hidden = true;
      };
      panel.toggle = function() {
        if (panel.hidden) panel.openPanel();
        else panel.closePanel();
      };
      return panel;
    }
    if (window.mcRich) {
      window.mcRich.initScriptureHover(bootSig);
    } else (function scriptureHover() {
      try {
        if (!window.matchMedia || !window.matchMedia("(hover: hover)").matches) return;
      } catch (e) {
        return;
      }
      var tip = null, maps = {}, hideTimer = null, CAP = 30;
      function bySlug(which, data, slug) {
        if (!maps[which] && data) {
          maps[which] = {};
          data.books.forEach(function(b) {
            maps[which][b.slug] = b;
          });
        }
        return maps[which] ? maps[which][slug] : null;
      }
      function place(a, ex, ey) {
        var r = a.getBoundingClientRect();
        var rs = a.getClientRects();
        if (rs && rs.length) {
          r = rs[0];
          if (ey != null) {
            for (var i = 0; i < rs.length; i++) {
              if (ey >= rs[i].top - 2 && ey <= rs[i].bottom + 2) {
                r = rs[i];
                break;
              }
            }
          }
        }
        tip.style.left = Math.max(6, Math.min(r.left, window.innerWidth - tip.offsetWidth - 10)) + "px";
        var below = r.bottom + 8;
        var top = below;
        if (below + tip.offsetHeight > window.innerHeight) {
          var above = r.top - tip.offsetHeight - 8;
          top = above > 6 ? above : Math.max(6, window.innerHeight - tip.offsetHeight - 6);
        }
        tip.style.top = top + "px";
      }
      function show(a, ex, ey) {
        var dr = a.getAttribute("data-bible") === "dr";
        (dr ? loadDr() : loadKjv()).then(function() {
          var b = bySlug(dr ? "dr" : "kjv", dr ? drData : kjvData, a.getAttribute("data-slug"));
          if (!b) return;
          var c = +a.getAttribute("data-ch"), ch = b.chapters[c - 1];
          if (!ch) return;
          var v1 = +a.getAttribute("data-v1"), v2 = +a.getAttribute("data-v2");
          if (!tip) {
            ensureEmojiStyles();
            tip = el("div", "scripture-tip");
            document.body.appendChild(tip);
          }
          tip.textContent = "";
          var h = el("strong", "scripture-tip-ref", b.name + " " + c + ":" + v1 + (v2 > v1 ? "-" + v2 : ""));
          tip.appendChild(h);
          var body = el("div"), n = 0;
          for (var v = v1; v <= v2 && n < CAP; v++, n++) {
            if (!ch[v - 1]) continue;
            if (v2 > v1) {
              var vn = el("sup", "scripture-tip-v", v + " ");
              body.appendChild(vn);
            }
            body.appendChild(document.createTextNode(ch[v - 1] + " "));
          }
          if (v2 - v1 + 1 > CAP) body.appendChild(document.createTextNode("\u2026"));
          tip.appendChild(body);
          tip.hidden = false;
          place(a, ex, ey);
        });
      }
      document.addEventListener("mouseover", function(e) {
        var a = e.target && e.target.closest && e.target.closest("a.scripture-link");
        if (!a) return;
        clearTimeout(hideTimer);
        show(a, e.clientX, e.clientY);
      }, { signal: bootSig });
      document.addEventListener("mouseout", function(e) {
        var a = e.target && e.target.closest && e.target.closest("a.scripture-link");
        if (!a) return;
        hideTimer = setTimeout(function() {
          if (tip) tip.hidden = true;
        }, 160);
      }, { signal: bootSig });
    })();
    function buildAvatarGallery(onPick) {
      ensureEmojiStyles();
      var panel = el("div", "emoji-panel av-panel");
      panel.hidden = true;
      var search = el("input", "emoji-search");
      search.type = "search";
      search.placeholder = "Search avatars...";
      var srow = el("div", "emoji-search-row");
      srow.appendChild(search);
      panel.appendChild(srow);
      var tabs = el("div", "emoji-tabs"), body = el("div", "emoji-body av-body");
      panel.appendChild(tabs);
      panel.appendChild(body);
      var packs = null, active = null, tabBtns = {};
      function tile(name, path) {
        var b = el("button", "emoji-cell av-cell");
        b.type = "button";
        b.title = name;
        var im = el("img");
        im.src = path;
        im.alt = name;
        im.loading = "lazy";
        b.appendChild(im);
        b.addEventListener("click", function() {
          onPick(path, name);
        });
        return b;
      }
      function grid(items) {
        var g = el("div", "emoji-grid av-grid");
        items.forEach(function(it) {
          g.appendChild(tile(it[0], it[1]));
        });
        return g;
      }
      function mark() {
        if (packs) packs.forEach(function(p) {
          tabBtns[p.slug].className = "emoji-tab" + (p.slug === active ? " emoji-tab-on" : "");
        });
      }
      function draw() {
        body.textContent = "";
        if (!packs) {
          body.appendChild(el("p", "emoji-empty", "Loading gallery..."));
          return;
        }
        var q = search.value.trim().toLowerCase();
        if (q) {
          var res = [];
          packs.forEach(function(p) {
            p.items.forEach(function(it) {
              if (it[0].indexOf(q) !== -1) res.push(it);
            });
          });
          if (!res.length) {
            body.appendChild(el("p", "emoji-empty", "No matches."));
            return;
          }
          body.appendChild(grid(res.slice(0, 300)));
          return;
        }
        var pack = null;
        packs.forEach(function(p) {
          if (p.slug === active) pack = p;
        });
        if (pack) body.appendChild(grid(pack.items));
      }
      function build() {
        tabs.textContent = "";
        packs.forEach(function(p) {
          var b = el("button", "emoji-tab", p.label);
          b.type = "button";
          b.addEventListener("click", function() {
            active = p.slug;
            search.value = "";
            mark();
            draw();
          });
          tabBtns[p.slug] = b;
          tabs.appendChild(b);
        });
        if (!active && packs.length) active = packs[0].slug;
        mark();
        draw();
      }
      search.addEventListener("input", draw);
      panel.openPanel = function() {
        panel.hidden = false;
        if (packs) {
          mark();
          draw();
        } else {
          draw();
          loadAvatarPresets().then(function(pk) {
            packs = pk;
            build();
          }).catch(function() {
            body.textContent = "";
            body.appendChild(el("p", "emoji-empty", "The gallery could not be loaded. Try again in a moment."));
          });
        }
        try {
          if (window.matchMedia && window.matchMedia("(hover: none)").matches) search.focus();
        } catch (e) {
        }
      };
      panel.closePanel = function() {
        panel.hidden = true;
      };
      panel.toggle = function() {
        if (panel.hidden) panel.openPanel();
        else panel.closePanel();
      };
      return panel;
    }
    function ensureEmojiStyles() {
      if (window.mcRich) return window.mcRich.ensureEmojiStyles();
      if (document.getElementById("mc-emoji-css")) return;
      var css = ".mc-hd{font-weight:bold;color:var(--maroon,#8b1a1a);margin:0.65em 0 0.3em;line-height:1.25}.mc-hd:first-child{margin-top:0.1em}.mc-hd1{font-size:1.28em}.mc-hd2{font-size:1.18em}.mc-hd3{font-size:1.09em}.mc-hd4{font-size:1em}.mc-hd5{font-size:0.92em}.mc-emoji{display:inline-block;height:1.35em;width:auto;vertical-align:-0.28em;margin:0 .04em}.emoji-suggest{max-height:15em;overflow-y:auto}a.emoji-suggest-row{align-items:center}.emoji-suggest-glyph{display:inline-flex;align-items:center;justify-content:center;min-width:1.6em;font-size:1.15rem}.emoji-suggest-glyph .mc-emoji{height:1.4em}.emoji-panel{margin:.45em 0 0;border:1px solid var(--rule);border-radius:8px;background:var(--surface,#fff);box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden}.emoji-search-row{padding:.5em;border-bottom:1px solid var(--rule)}.emoji-search{width:100%;box-sizing:border-box;padding:.4em .6em;border:1px solid var(--rule);border-radius:6px;font:inherit;background:var(--surface,#fff);color:var(--ink,#1a1a1a)}.emoji-search:focus,.scripture-sel:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}.emoji-tabs{display:flex;gap:.3em;flex-wrap:wrap;padding:.45em .5em 0}.emoji-tab{font:inherit;font-size:.92rem;padding:.25em .8em;border:1px solid var(--rule);border-bottom:none;border-radius:6px 6px 0 0;background:var(--cream,#f7f1e3);color:var(--faint);cursor:pointer}.emoji-tab-on{background:var(--surface,#fff);color:var(--maroon);font-weight:600}.emoji-body{max-height:15em;overflow-y:auto;padding:.4em .5em .6em}.emoji-group-head{position:sticky;top:0;background:var(--surface,#fff);color:var(--faint);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;padding:.4em .15em .2em}.emoji-grid{display:flex;flex-wrap:wrap;gap:.1em}.emoji-cell{width:2em;height:2em;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;border-radius:6px;cursor:pointer;font-size:1.25rem;line-height:1;padding:0}.emoji-cell:hover{background:var(--cream,#f9f3e6)}.emoji-cell .mc-emoji{height:1.5em}.emoji-empty{color:var(--faint);padding:.5em;margin:0}.av-body{max-height:17em}.av-grid{gap:.35em}.av-cell{width:3em;height:3em;padding:2px;border:1px solid var(--rule);background:var(--cream-2,#faf6ee);border-radius:8px}.av-cell:hover{background:var(--cream,#f2e7d0);border-color:var(--maroon)}.av-cell img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;margin:0}.btn-gallery{display:inline-block;margin:.15em 0 .1em}.scripture-panel{padding:.6em}.scripture-row{display:flex;flex-wrap:wrap;align-items:center;gap:.25em}.scripture-sel{font:inherit;font-size:.95rem;padding:.15em .3em;border:1px solid var(--rule);border-radius:5px;background:var(--cream-2,#faf6ee);color:var(--ink);max-width:14em}.scripture-sel-sm{max-width:6em}.scripture-colon,.scripture-dash{color:var(--faint);padding:0 .05em}.scripture-status{color:var(--faint);font-size:.9rem;padding:.4em 0}.scripture-preview{margin:.6em 0;padding:.4em .7em;border-left:3px solid var(--rule);color:var(--ink-soft);font-size:.95rem;max-height:9em;overflow:auto}.scripture-insert{font:inherit;cursor:pointer;margin-top:.3em;padding:.3em .8em;border:1px solid var(--maroon);border-radius:6px;background:var(--maroon);color:var(--bg,#faf6ee)}.scripture-insert:hover{background:var(--maroon-dark)}.scripture-link{white-space:nowrap}.scripture-tip{position:fixed;z-index:1200;max-width:30rem;max-height:60vh;overflow:auto;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--rule);border-radius:6px;box-shadow:0 3px 14px rgba(0,0,0,.22);padding:.55em .7em;font-size:.92rem;line-height:1.5;pointer-events:none}.scripture-tip-ref{display:block;color:var(--maroon);margin-bottom:.25em}.scripture-tip-v{color:var(--faint);font-size:.72em;margin-right:.1em}.md-editor.md-previewing>:not(.md-preview){display:none}.md-preview{border:1px dashed var(--rule);border-radius:8px;padding:.55em .8em;min-height:5em}.md-preview-title{font-weight:700}.md-preview-empty{color:var(--faint);margin:0}.btn-preview{background:transparent;border-color:var(--maroon);color:var(--maroon);font:inherit;cursor:pointer}.btn-preview:hover{background:var(--maroon);color:var(--bg,#fff)}.btn-preview:disabled{opacity:.6;cursor:default}@media (max-width:620px){.emoji-body,.emoji-suggest{max-height:40vh}.emoji-cell{width:2.4em;height:2.4em;font-size:1.45rem}.av-cell{width:3.4em;height:3.4em}.scripture-sel{max-width:9em}}";
      var st = el("style");
      st.id = "mc-emoji-css";
      st.textContent = css;
      document.head.appendChild(st);
    }
    var DRAFT_NS = "mc-draft:";
    var DRAFT_KEEP_MS = 30 * 86400 * 1e3;
    function draftRead(ctx) {
      try {
        var d = JSON.parse(localStorage.getItem(DRAFT_NS + ctx));
        return d && typeof d.body === "string" ? d : null;
      } catch (e) {
        return null;
      }
    }
    function draftClear(ctx) {
      try {
        localStorage.removeItem(DRAFT_NS + ctx);
      } catch (e) {
      }
    }
    (function pruneDrafts() {
      try {
        var cut = Date.now() - DRAFT_KEEP_MS;
        var dead = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf(DRAFT_NS) !== 0) continue;
          var d = null;
          try {
            d = JSON.parse(localStorage.getItem(k));
          } catch (e2) {
          }
          if (!d || !(d.at > cut)) dead.push(k);
        }
        dead.forEach(function(k2) {
          localStorage.removeItem(k2);
        });
      } catch (e) {
      }
    })();
    function attachDraft(ta, ctx, titleInput, overwrite) {
      var muted = false;
      var timer = null;
      var d = draftRead(ctx);
      if (d) {
        if (d.body && (overwrite ? d.body !== ta.value : !ta.value)) ta.value = d.body;
        if (titleInput && d.title && !titleInput.value) titleInput.value = d.title;
      }
      function save() {
        if (muted || !ta.isConnected) return;
        var body = ta.value;
        var title = titleInput ? titleInput.value : "";
        try {
          if (!body.trim() && !title.trim()) localStorage.removeItem(DRAFT_NS + ctx);
          else localStorage.setItem(
            DRAFT_NS + ctx,
            JSON.stringify({ body, title: title || void 0, at: Date.now() })
          );
        } catch (e) {
        }
      }
      function later() {
        muted = false;
        clearTimeout(timer);
        timer = setTimeout(save, 400);
      }
      ta.addEventListener("input", later);
      ta.addEventListener("blur", save);
      if (titleInput) {
        titleInput.addEventListener("input", later);
        titleInput.addEventListener("blur", save);
      }
      document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === "hidden") save();
      }, { signal: bootSig });
      addEventListener("pagehide", save, { signal: bootSig });
      ta.mcDraftDone = function() {
        muted = true;
        clearTimeout(timer);
        draftClear(ctx);
      };
    }
    function mdEditor(textarea, titleInput) {
      var wrap = el("div", "md-editor");
      var bar = el("div", "md-toolbar");
      bar.appendChild(mdButton("B", "Bold  **text**", "md-b", function() {
        wrapSel(textarea, "**", "**");
      }));
      bar.appendChild(mdButton("I", "Italic  *text*", "md-i", function() {
        wrapSel(textarea, "*", "*");
      }));
      bar.appendChild(mdButton("\u201D Quote", "Blockquote  > line", null, function() {
        linePrefix(textarea, "> ");
      }));
      bar.appendChild(mdButton("\u2022 List", "Bulleted list  - item", null, function() {
        linePrefix(textarea, "- ");
      }));
      bar.appendChild(mdButton("Link", "Link  [text](url) \u2014 merecatholicity.com only", null, function() {
        insertLink(textarea);
      }));
      var panel = buildEmojiPanel(textarea);
      var scripture = buildScripturePanel(textarea);
      bar.appendChild(mdButton("\u{1F60A} Emoji", "Insert an emoji", "md-emoji", function() {
        scripture.closePanel();
        panel.toggle();
      }));
      bar.appendChild(mdButton("\u271D Scripture", "Insert a Bible passage", "md-scripture", function() {
        panel.closePanel();
        scripture.toggle();
      }));
      wrap.appendChild(bar);
      wrap.appendChild(textarea);
      wrap.appendChild(panel);
      wrap.appendChild(scripture);
      var pvBox = null;
      var pvBtns = [];
      textarea.mcPreview = {
        active: false,
        bind: function(btn) {
          pvBtns.push(btn);
          btn.textContent = this.active ? "Edit" : "Preview";
        },
        toggle: function() {
          this.set(!this.active);
        },
        off: function() {
          this.set(false);
        },
        set: function(on) {
          if (on === this.active) return;
          this.active = on;
          if (on) {
            panel.closePanel();
            scripture.closePanel();
            pvBox = el("div", "comment-body md-preview");
            if (textarea.value.trim()) fillBody(pvBox, textarea.value);
            else pvBox.appendChild(el("p", "md-preview-empty", "Nothing to preview yet."));
            var t = titleInput ? titleInput.value.replace(/\s+/g, " ").trim() : "";
            if (t) pvBox.insertBefore(el("p", "md-preview-title", t), pvBox.firstChild);
            wrap.appendChild(pvBox);
            wrap.classList.add("md-previewing");
          } else {
            if (pvBox) pvBox.remove();
            pvBox = null;
            wrap.classList.remove("md-previewing");
            textarea.focus();
          }
          if (titleInput) titleInput.style.display = on ? "none" : "";
          pvBtns = pvBtns.filter(function(b) {
            return b.isConnected;
          });
          pvBtns.forEach(function(b) {
            b.textContent = on ? "Edit" : "Preview";
          });
        }
      };
      attachEmoji(textarea);
      textarea.addEventListener("focus", prefetchEmoji, { once: true });
      return wrap;
    }
    function previewButton(ta) {
      if (!ta || !ta.mcPreview) return null;
      var btn = el("button", "btn btn-preview", "Preview");
      btn.type = "button";
      btn.title = "Read the post as it will look";
      btn.addEventListener("click", function() {
        ta.mcPreview.toggle();
      });
      ta.mcPreview.bind(btn);
      return btn;
    }
    function commentNode(c, pending, quoteCtx, reveal) {
      if (window.mcViews && window.mcViews.commentNode) return window.mcViews.commentNode(window.mcKit, c, pending, quoteCtx, reveal);
      if (!reveal && c.author_hash && c.author_hash !== state.myHash && isMuted(c.author_hash)) {
        var ph = el("div", "board-intro comment-muted");
        ph.id = "comment-" + c.id;
        ph.appendChild(document.createTextNode("A muted member posted here. "));
        var show = el("a", "comment-quote-link", "show");
        show.href = "#";
        show.addEventListener("click", function(e) {
          e.preventDefault();
          var full = commentNode(c, pending, quoteCtx, true);
          if (ph.parentNode) ph.parentNode.replaceChild(full, ph);
        });
        ph.appendChild(show);
        return ph;
      }
      var article = el("article", "comment" + (pending ? " comment-pending" : ""));
      article.id = "comment-" + c.id;
      article.setAttribute("itemscope", "");
      article.setAttribute("itemtype", "https://schema.org/Comment");
      var head = el("div", "comment-head");
      if (c.avatar && c.author_hash) {
        var avLink = el("a", "comment-avatar-link");
        avLink.href = profileHref(c.author_hash);
        var av = el("img", "comment-avatar");
        av.src = API + "/avatar?hash=" + c.author_hash + "&v=" + encodeURIComponent(c.avatar);
        av.alt = "";
        av.width = 32;
        av.height = 32;
        avLink.appendChild(av);
        head.appendChild(avLink);
      }
      var author = authorNode(c.author_hash, c.nick, true, c.faith, c.posts);
      author.setAttribute("itemprop", "author");
      head.appendChild(author);
      if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) {
        head.appendChild(el("span", "comment-admin", "(admin)"));
      }
      if (c.author_hash && state.myHash && c.author_hash !== state.myHash && c.author_hash !== MERECAT_BOT_HASH) {
        var dm = el("a", "comment-dm", "Direct Message");
        dm.href = "messages.html?dm=" + c.author_hash;
        dm.title = "Send a direct message";
        head.appendChild(dm);
        var muteLink = el("a", "comment-quote-link", isMuted(c.author_hash) ? "unmute" : "mute");
        muteLink.href = "#";
        muteLink.title = "Hide this member\u2019s posts, for you only";
        muteLink.addEventListener("click", function(e) {
          e.preventDefault();
          toggleMute(c.author_hash);
          location.reload();
        });
        head.appendChild(muteLink);
        if (!isAdmin()) {
          var reportLink = el("a", "comment-quote-link", "report");
          reportLink.href = "#";
          reportLink.title = "Report this post to the moderators";
          reportLink.addEventListener("click", function(e) {
            e.preventDefault();
            var reason = prompt("Report this post to the moderators.\nOptionally, a short reason:");
            if (reason === null) return;
            fetch(API + "/report", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, id: c.id, reason })
            }).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (blockedOut(d)) return;
              reportLink.textContent = d.ok ? "reported" : "report";
              reportLink.title = d.ok ? "Reported to the moderators. Thank you." : d.error || "Could not report.";
            }).catch(function() {
            });
          });
          head.appendChild(reportLink);
        }
      }
      var date = el("a", "comment-date", fmtDateTime(c.created_at));
      date.href = "#comment-" + c.id;
      head.appendChild(date);
      var quote = el("a", "comment-quote-link", "quote");
      quote.href = "#";
      quote.addEventListener("mousedown", function() {
        quotedSelection = selectionInPost(c);
      });
      quote.addEventListener("click", function(e) {
        e.preventDefault();
        var excerpt = quotedSelection || truncate(c.body, 400);
        quotedSelection = "";
        quoteInto(c, excerpt, permalinkFor(c, quoteCtx));
      });
      head.appendChild(quote);
      if (c.edited_at) head.appendChild(el("span", "comment-edited", "edited"));
      if (c.author_hash && c.author_hash === state.myHash) {
        var ed = el("a", "comment-edit", "edit");
        ed.href = "#";
        ed.addEventListener("click", function(e) {
          e.preventDefault();
          startEdit(c, article);
        });
        head.appendChild(ed);
      }
      if (state.myHash && (c.author_hash === state.myHash || isAdmin())) {
        var del = el("a", "comment-delete", "delete");
        del.href = "#";
        del.addEventListener("click", function(e) {
          e.preventDefault();
          appConfirm("Delete this comment?", { okLabel: "Delete", danger: true }, function(ok) {
            if (!ok) return;
            fetchRetry(API + "/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: c.id, key: state.key })
            }, [1500]).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (d.ok) {
                article.remove();
                try {
                  localStorage.setItem("mc-posted-at", String(Date.now()));
                } catch (e2) {
                }
              } else setStatus(d.error || "Could not delete the comment.");
            }).catch(function() {
              setStatus("Network error. The comment was not deleted.");
            });
          });
        });
        head.appendChild(del);
      }
      article.appendChild(head);
      var body = fillBody(
        el("div", "comment-body"),
        c.body,
        c.author_hash === MERECAT_BOT_HASH
      );
      body.setAttribute("itemprop", "text");
      article.appendChild(body);
      if (c.signature) article.appendChild(fillBody(
        el("div", "comment-sig"),
        c.signature,
        c.author_hash === MERECAT_BOT_HASH
      ));
      if (c.media_key) {
        ensureDmStyles();
        var media = wallMediaNode(c.media_key, null);
        if (media) article.appendChild(media);
      } else if (c.media_expired) {
        ensureDmStyles();
        article.appendChild(el("p", "comment-note wall-media-gone", "The attachment expired."));
      }
      if (pending) {
        article.appendChild(el(
          "p",
          "comment-note",
          "Held for review. It will appear here once approved."
        ));
      }
      return article;
    }
    function setStatus(text) {
      section.querySelector(".comments-status").textContent = text;
    }
    function startEdit(c, article) {
      if (article.querySelector(".comment-editor")) return;
      var bodyDiv = article.querySelector(".comment-body");
      var editor = el("div", "comment-editor");
      var ta = el("textarea", "comment-text");
      ta.maxLength = 4e3;
      ta.rows = 5;
      ta.value = c.body;
      editor.appendChild(mdEditor(ta));
      attachDraft(ta, "edit:" + c.id, null, true);
      var row = el("div", "comment-buttons");
      var save = el("button", "btn btn-send key-copy", "Save");
      save.type = "button";
      row.appendChild(save);
      var pv = previewButton(ta);
      if (pv) row.appendChild(pv);
      editor.appendChild(row);
      var note = el("div", "comment-note");
      editor.appendChild(note);
      editor.appendChild(identityAction("Cancel", function() {
        if (ta.mcDraftDone) ta.mcDraftDone();
        editor.remove();
        bodyDiv.hidden = false;
      }));
      save.addEventListener("click", function() {
        var newBody = ta.value.replace(/\s+$/, "");
        if (!newBody.trim()) {
          if (ta.mcPreview) ta.mcPreview.off();
          ta.focus();
          return;
        }
        save.disabled = true;
        note.textContent = "Saving...";
        fetchRetry(API + "/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: c.id, key: state.key, body: newBody })
        }, [1500], function() {
          note.textContent = "Network hiccup, retrying...";
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) throw new Error(d.error || "Could not save the edit.");
          try {
            localStorage.setItem("mc-posted-at", String(Date.now()));
          } catch (e) {
          }
          c.body = newBody;
          c.edited_at = d.edited_at;
          if (ta.mcDraftDone) ta.mcDraftDone();
          editor.remove();
          fillBody(bodyDiv, newBody);
          bodyDiv.hidden = false;
          var head = article.querySelector(".comment-head");
          if (!head.querySelector(".comment-edited")) {
            head.insertBefore(
              el("span", "comment-edited", "edited"),
              head.querySelector(".comment-edit")
            );
          }
          if (d.status === "pending" && !article.querySelector(".comment-note")) {
            article.className += " comment-pending";
            article.appendChild(el(
              "p",
              "comment-note",
              "Edit held for review. It will reappear here once approved."
            ));
          }
        }).catch(function(err) {
          note.textContent = err.message || "Network error. Try again in a moment.";
          save.disabled = false;
        });
      });
      bodyDiv.hidden = true;
      article.insertBefore(editor, bodyDiv.nextSibling);
      ta.focus();
    }
    function freshOpts() {
      var posted = 0;
      try {
        posted = Number(localStorage.getItem("mc-posted-at")) || 0;
      } catch (e) {
      }
      return Date.now() - posted < 9e4 ? { cache: "no-store" } : void 0;
    }
    function stampFresh() {
      try {
        localStorage.setItem("mc-posted-at", String(Date.now()));
      } catch (e) {
      }
      if (window.mcStore) window.mcStore.invalidate();
    }
    function freshParam(sep) {
      return state.key ? sep + "fresh=1" : "";
    }
    function cachedJson(url, init, ttl) {
      if (window.mcStore) {
        return window.mcStore.fetchJson(
          function(u, i) {
            return fetchRetry(u, i, [1e3, 3e3]);
          },
          url,
          init,
          { ttl, bypass: !!freshOpts() }
        );
      }
      return fetchRetry(url, init, [1e3, 3e3]).then(function(r) {
        return r.json();
      });
    }
    function load() {
      var list = section.querySelector(".comments-list");
      fetchRetry(
        API + "?page=" + encodeURIComponent(pagePath()) + freshParam("&"),
        freshOpts(),
        [1e3, 3e3],
        function() {
          setStatus("Network hiccup, retrying...");
        }
      ).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        state.anonAllowed = !!d.anon;
        renderIdentity();
        list.textContent = "";
        d.comments.forEach(function(c) {
          list.appendChild(commentNode(c, false, { page: pagePath() }));
        });
        section.querySelector(".comments-title-text").textContent = d.comments.length ? "Comments (" + d.comments.length + ")" : "Comments";
        setStatus(d.comments.length ? "" : "No comments yet. Yours can be the first.");
        if (/^#comment-\d+$/.test(location.hash)) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
        annotateMeta();
      }).catch(function() {
        setStatus("Comments could not be loaded. Check your connection and reload the page.");
      });
    }
    function buildFingerprint(m, identities) {
      var details = el("details", "comment-meta");
      details.appendChild(el("summary", null, "user-fingerprint"));
      details.appendChild(el(
        "div",
        null,
        (m.ip ? (m.ip.indexOf(":") !== -1 ? "IPv6 " : "IPv4 ") + m.ip : "ip?") + (m.os ? " \xB7 " + m.os : "") + (m.tz ? " \xB7 " + m.tz : "") + (m.lang ? " \xB7 " + m.lang : "")
      ));
      if (m.ua) details.appendChild(el("div", null, m.ua));
      if (m.author_hash) {
        var line = el("div", "trust-line");
        line.setAttribute("data-hash", m.author_hash);
        renderTrustLine(line, m.author_hash, !!m.trusted);
        details.appendChild(line);
        details.appendChild(modLockLine(m.author_hash, !!m.locked));
        details.appendChild(modShadowLine(m.author_hash, !!m.shadowbanned));
        var ips = identities && identities[m.author_hash] || [];
        if (!ips.length && m.ip) ips = [{
          ip_display: m.ip,
          ip_key: m.ip,
          family: m.ip.indexOf(":") !== -1 ? 6 : 4,
          source: "seen",
          banned: !!m.ipbanned
        }];
        details.appendChild(modIpBlock(ips));
        wireRdns(details, ips);
        details.appendChild(modDeleteUserLine(m.author_hash));
        details.appendChild(modHelpNote());
      }
      return details;
    }
    function annotateMeta(pageKey) {
      if (!isAdmin()) return;
      fetch(API + "/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: pageKey || pagePath(), key: state.key })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) return;
        d.meta.forEach(function(m) {
          var node = document.getElementById("comment-" + m.id);
          if (!node || node.querySelector(".comment-meta")) return;
          node.appendChild(buildFingerprint(m, d.identities));
        });
      }).catch(function() {
      });
    }
    function annotateProfileMeta(hash, card) {
      if (!isAdmin()) return;
      if (card.querySelector(".comment-meta")) return;
      fetch(API + "/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash, key: state.key })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok || !d.meta || !d.meta.length || card.querySelector(".comment-meta")) return;
        card.appendChild(buildFingerprint(d.meta[0], d.identities));
      }).catch(function() {
      });
    }
    function renderTrustLine(line, hash, trusted) {
      line.textContent = "";
      line.appendChild(document.createTextNode(trusted ? "Trusted. Posts skip the AI spam screen. " : "Untrusted. Posts are AI-screened for spam. "));
      var a = el("a", "trust-toggle", trusted ? "(toggle-untrusted)" : "(toggle-trusted)");
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        fetch(API + "/trust", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, hash, trusted: !trusted })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) return;
          section.querySelectorAll('.trust-line[data-hash="' + hash + '"]').forEach(function(l) {
            renderTrustLine(l, hash, d.trusted);
          });
        }).catch(function() {
        });
      });
      line.appendChild(a);
    }
    function modLockLine(hash, locked) {
      var line = el("div", "trust-line");
      line.appendChild(document.createTextNode(locked ? "Locked. " : "Unlocked. "));
      var a = el("a", "trust-toggle", locked ? "(toggle-unlocked)" : "(toggle-locked)");
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        var doLock = function() {
          fetch(API + "/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, hash, locked: !locked })
          }).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (d.ok) location.reload();
          }).catch(function() {
          });
        };
        if (locked) doLock();
        else appConfirm("Lock this identity? They will be logged out and unable to interact until you unlock them.", { okLabel: "Lock", danger: true }, function(ok) {
          if (ok) doLock();
        });
      });
      line.appendChild(a);
      return line;
    }
    function modShadowLine(hash, shadowbanned) {
      var line = el("div", "trust-line");
      function render(on) {
        line.textContent = "";
        line.appendChild(document.createTextNode(on ? "Shadow banned. Their posts are muted globally \u2014 hidden from everyone else, and they are not told. " : "Not shadow banned. "));
        var a = el("a", "trust-toggle", on ? "(un-shadowban)" : "(shadow ban)");
        a.href = "#";
        a.addEventListener("click", function(e) {
          e.preventDefault();
          var doShadow = function() {
            fetch(API + "/shadowban", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, hash, on: !on })
            }).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (d && d.ok) render(!!d.shadowbanned);
            }).catch(function() {
            });
          };
          if (on) doShadow();
          else appConfirm("Shadow ban this identity? Their posts will be hidden from everyone else site-wide, but they can keep posting and will not be told. Undo it here any time.", { okLabel: "Shadow ban", danger: true }, function(ok) {
            if (ok) doShadow();
          });
        });
        line.appendChild(a);
      }
      render(shadowbanned);
      return line;
    }
    function modIpBlock(rows) {
      var wrap = el("div", "ip-block");
      if (!rows.length) {
        wrap.appendChild(el("div", "trust-line", "No IP on record."));
        return wrap;
      }
      if (rows.length > 1) {
        var allBanned = rows.every(function(r) {
          return r.banned;
        });
        var head = el("div", "trust-line");
        head.appendChild(document.createTextNode("Known IPs (" + rows.length + "). "));
        var all = el("a", "trust-toggle", allBanned ? "(unban all)" : "(ban all IPs)");
        all.href = "#";
        all.addEventListener("click", function(e) {
          e.preventDefault();
          var doBan = function() {
            ipbanRequest(rows.map(function(r) {
              return r.ip_key;
            }), !allBanned);
          };
          if (allBanned) doBan();
          else appConfirm(banAllPrompt(rows), { okLabel: "Ban all", danger: true }, function(ok) {
            if (ok) doBan();
          });
        });
        head.appendChild(all);
        wrap.appendChild(head);
      }
      rows.forEach(function(r) {
        wrap.appendChild(ipRow(r));
      });
      return wrap;
    }
    function ipRow(r) {
      var line = el("div", "trust-line");
      line.appendChild(document.createTextNode((r.banned ? "Banned. " : "Not banned. ") + (r.family === 6 ? "IPv6 " : "IPv4 ") + r.ip_display + (r.source === "claimed" ? " \xB7 claimed" : "") + " "));
      var rd = el("span", "ip-rdns");
      rd.setAttribute("data-ip", r.ip_display);
      if (rdnsCache[r.ip_display]) rd.textContent = rdnsCache[r.ip_display] + " ";
      line.appendChild(rd);
      var a = el("a", "trust-toggle", r.banned ? "(unban)" : "(ban)");
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        var doBan = function() {
          ipbanRequest([r.ip_key], !r.banned);
        };
        if (r.banned) {
          doBan();
          return;
        }
        appConfirm(
          "Ban " + r.ip_display + "?" + (isSharedV4Client(r.ip_display) ? " This looks like carrier-grade NAT, shared by many users; banning it may block innocents." : "") + "\n\nLogged-in users from it will be blocked and sent to the terms page.",
          { okLabel: "Ban", danger: true },
          function(ok) {
            if (ok) doBan();
          }
        );
      });
      line.appendChild(a);
      return line;
    }
    function banAllPrompt(rows) {
      var shared = rows.filter(function(r) {
        return isSharedV4Client(r.ip_display);
      });
      return "Ban all " + rows.length + " IPs for this identity?\n\n" + rows.map(function(r) {
        return (r.family === 6 ? "IPv6 " : "IPv4 ") + r.ip_display;
      }).join("\n") + (shared.length ? "\n\nWARNING: " + shared.map(function(r) {
        return r.ip_display;
      }).join(", ") + " looks like carrier-grade NAT (shared by many users); banning may block innocents." : "") + "\n\nLogged-in users from any of them will be blocked and sent to the terms page.";
    }
    function ipbanRequest(keys, banned) {
      fetch(API + "/ipban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, ips: keys, banned })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (d.ok) location.reload();
      }).catch(function() {
      });
    }
    function wireRdns(details, rows) {
      if (!rows.length) return;
      details.addEventListener("toggle", function() {
        if (!details.open || details.__rdnsDone) return;
        details.__rdnsDone = true;
        var want = rows.map(function(r) {
          return r.ip_display;
        }).filter(function(ip) {
          return !(ip in rdnsCache);
        });
        if (!want.length) return fillRdns(details);
        fetch(API + "/rdns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, ips: want })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (d.ok && d.rdns) Object.keys(d.rdns).forEach(function(ip) {
            rdnsCache[ip] = d.rdns[ip] || "";
          });
          fillRdns(details);
        }).catch(function() {
        });
      });
    }
    function fillRdns(details) {
      details.querySelectorAll(".ip-rdns").forEach(function(span) {
        var host = rdnsCache[span.getAttribute("data-ip")];
        if (host) span.textContent = host + " ";
      });
    }
    function modHelpNote() {
      return el(
        "p",
        "mod-help",
        "Handling a troublesome user: an identity is only a key in a browser, so a locked or deleted one can be remade in a click. To actually keep someone out, ban the IP first, while it still shows above, then lock or delete the identity. IP bans reach signed-in users only, never anonymous cached reading, and a determined person can switch networks. Lean on bans sparingly, and reserve deletion for the worst."
      );
    }
    function modDeleteUserLine(hash) {
      var line = el("div", "trust-line");
      var a = el("a", "trust-toggle danger", "Delete user and all posts");
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        appConfirm("DELETE THIS USER? This permanently deletes ALL of their posts, their profile, and their avatar, and locks the identity so they cannot post again. This cannot be undone. Continue?", { okLabel: "Continue", danger: true }, function(ok1) {
          if (!ok1) return;
          appConfirm("Are you sure? There is no undo.", { okLabel: "Delete user", danger: true }, function(ok2) {
            if (!ok2) return;
            fetch(API + "/deleteuser", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, hash })
            }).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (d.ok) location.reload();
            }).catch(function() {
            });
          });
        });
      });
      line.appendChild(a);
      return line;
    }
    var DM_CACHE = "mc-dm-unread";
    function dmCacheGet() {
      try {
        return JSON.parse(localStorage.getItem(DM_CACHE)) || null;
      } catch (e) {
        return null;
      }
    }
    function dmCacheSet(n) {
      try {
        localStorage.setItem(DM_CACHE, JSON.stringify({ n, at: Date.now() }));
      } catch (e) {
      }
      renderIdentity();
      badgeChanged();
    }
    function dmUnreadCheck(force) {
      if (!state.key) return;
      var c = dmCacheGet();
      if (!force && c && Date.now() - c.at < 9e4) return;
      try {
        localStorage.setItem(DM_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() }));
      } catch (e) {
      }
      readMark();
      fetch(API + "/dm/unread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (blockedOut(d)) return;
        if (readThrottled(d)) readEase();
        if (d.ok) dmCacheSet(d.unread);
      }).catch(function() {
      });
    }
    var NOTIF_CACHE = "mc-notif-unread";
    function notifCacheGet() {
      try {
        return JSON.parse(localStorage.getItem(NOTIF_CACHE)) || null;
      } catch (e) {
        return null;
      }
    }
    function notifCacheSet(n) {
      try {
        localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n, at: Date.now() }));
      } catch (e) {
      }
      renderIdentity();
      badgeChanged();
    }
    function badgeChanged() {
      try {
        document.dispatchEvent(new CustomEvent("mc-badge"));
      } catch (e) {
      }
    }
    function appConfirm(msg, opts, cb) {
      if (window.mcConfirm) window.mcConfirm(msg, opts || {}).then(cb);
      else cb(window.confirm(msg));
    }
    var _readMarks = {};
    function markThreadRead(topicId) {
      if (!state.key || !topicId) return;
      var now = Date.now();
      if (_readMarks[topicId] && now - _readMarks[topicId] < 6e4) return;
      _readMarks[topicId] = now;
      fetch(API + "/board/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, topic: topicId })
      }).then(function(r) {
        return r.json();
      }).then(function(rd) {
        if (rd && rd.ok && typeof rd.notif_unread === "number") notifCacheSet(rd.notif_unread);
      }).catch(function() {
      });
    }
    function notifUnreadCheck(force) {
      if (!state.key) return;
      var c = notifCacheGet();
      if (!force && c && Date.now() - c.at < 9e4) return;
      try {
        localStorage.setItem(NOTIF_CACHE, JSON.stringify({ n: c ? c.n : 0, at: Date.now() }));
      } catch (e) {
      }
      readMark();
      fetch(API + "/notifications/unread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (blockedOut(d)) return;
        if (readThrottled(d)) readEase();
        if (d.ok) notifCacheSet(d.unread);
      }).catch(function() {
      });
    }
    var dmBadgeT = 0, notifBadgeT = 0;
    function liveDmBadge() {
      clearTimeout(dmBadgeT);
      dmBadgeT = setTimeout(function() {
        dmUnreadCheck(true);
      }, 300);
    }
    function liveNotifBadge() {
      clearTimeout(notifBadgeT);
      notifBadgeT = setTimeout(function() {
        notifUnreadCheck(true);
      }, 300);
    }
    function onLiveDm(m) {
      var openDm = new URLSearchParams(location.search).get("dm");
      if (state.dmView && openDm && openDm === m.from && m.message) {
        state.dmView.append(m.message);
      } else {
        liveDmBadge();
      }
    }
    function onLiveDmTtl(m) {
      var openDm = new URLSearchParams(location.search).get("dm");
      if (state.dmView && openDm && openDm === m.from && state.dmView.setTtl) state.dmView.setTtl(m.ttl);
    }
    function onLiveDmEdit(m) {
      var openDm = new URLSearchParams(location.search).get("dm");
      if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.editMsg) state.dmView.editMsg(m.message);
    }
    function onLiveDmRedact(m) {
      var openDm = new URLSearchParams(location.search).get("dm");
      if (state.dmView && openDm && openDm === m.from && m.message && state.dmView.redactMsg) state.dmView.redactMsg(m.message.id);
    }
    function onLiveNotif() {
      if (new URLSearchParams(location.search).get("notifications") === "1") return;
      liveNotifBadge();
    }
    function onLiveDmRead(m) {
      var openDm = new URLSearchParams(location.search).get("dm");
      if (state.dmView && openDm && openDm === m.reader && state.dmView.markRead) state.dmView.markRead(m.at);
    }
    function onLiveTyping(m) {
      var openDm = new URLSearchParams(location.search).get("dm");
      if (state.dmView && openDm && openDm === m.from && state.dmView.setTyping) state.dmView.setTyping(m.state !== "stop");
    }
    function onLivePresence(m) {
      if (state.dmView && state.dmView.other === m.hash && state.dmView.setPresence) state.dmView.setPresence(!!m.online);
      if (state.inboxPresence) state.inboxPresence(m.hash, !!m.online);
    }
    function enableMemberLive() {
      ensureMyPubkey();
      if (isMember() && window.mcLive && window.mcLive.member) {
        window.mcLive.member.enable(state.key, state.myHash);
      }
      loadPrefs();
    }
    function loadPrefs() {
      if (!state.key) return;
      fetch(API + "/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: state.key }) }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (d && d.ok) {
          state.prefs = d.prefs;
          window.mcPrefs = d.prefs;
        }
      }).catch(function() {
      });
    }
    document.addEventListener("mc-live", function(ev) {
      var m = ev.detail;
      if (!m) return;
      if (m.t === "dm") onLiveDm(m);
      else if (m.t === "dm-ttl") onLiveDmTtl(m);
      else if (m.t === "dm-edit") onLiveDmEdit(m);
      else if (m.t === "dm-redact") onLiveDmRedact(m);
      else if (m.t === "dm-read") onLiveDmRead(m);
      else if (m.t === "typing") onLiveTyping(m);
      else if (m.t === "presence") onLivePresence(m);
      else if (m.t === "notification") onLiveNotif();
      else if (m.t === "wall-post" || m.t === "wall-comment") {
        if (state.onLiveWall) state.onLiveWall(m);
      }
    }, { signal: bootSig });
    function blockedOut(d) {
      if (!d || !d.blocked) return false;
      try {
        localStorage.setItem("mc-flash", window.mcCore ? window.mcCore.blockedMessage(d.blocked) : d.blocked === "ipban" ? "Your network is banned from merecatholicity.com for violating the Terms and Conditions." : "This identity has been locked by the moderators for violating the Terms and Conditions.");
      } catch (e) {
      }
      clearKey();
      state.key = "";
      state.myHash = "";
      try {
        localStorage.removeItem(DM_CACHE);
      } catch (e) {
      }
      try {
        localStorage.removeItem(NOTIF_CACHE);
      } catch (e) {
      }
      location.href = "terms.html";
      return true;
    }
    function renderIdentity() {
      var box = section.querySelector(".comment-identity");
      if (!box) return;
      box.textContent = "";
      var loggedIn = !!isMember();
      var line = el("p", "identity-line " + (loggedIn ? "identity-line-in" : "identity-line-out"));
      if (loggedIn) {
        var notifLink = el("a", "identity-action", "Notifications");
        notifLink.href = "community.html?notifications=1";
        line.appendChild(notifLink);
        var nc = notifCacheGet();
        if (nc && nc.n > 0) line.appendChild(el("span", "dm-unread", " (" + nc.n + ")"));
        line.appendChild(document.createTextNode(" \xB7 "));
        var inboxLink = el("a", "identity-action", "Inbox");
        inboxLink.href = "messages.html";
        line.appendChild(inboxLink);
        var dmc = dmCacheGet();
        if (dmc && dmc.n > 0) line.appendChild(el("span", "dm-unread", " (" + dmc.n + ")"));
        line.appendChild(document.createTextNode(" \xB7 "));
        var viewProfileLink = el("a", "identity-action", "View My Profile");
        viewProfileLink.href = profileHref(state.myHash);
        line.appendChild(viewProfileLink);
        line.appendChild(document.createTextNode(" \xB7 "));
        var usersLink = el("a", "identity-action", "User List");
        usersLink.href = "community.html?users=1";
        line.appendChild(usersLink);
        line.appendChild(document.createTextNode(" \xB7 "));
        var searchLink = el("a", "identity-action", "Search");
        searchLink.href = "community.html?q=";
        line.appendChild(searchLink);
      } else {
        line.appendChild(document.createTextNode(state.anonAllowed ? "Commenting anonymously. " : "To comment, create an identity. One click, no signup. "));
        line.appendChild(identityAction("Create an identity", function() {
          if (window.mcOnboard) window.mcOnboard();
          else showAgreeBox();
        }));
        line.appendChild(document.createTextNode(" \xB7 "));
        line.appendChild(identityAction("I have a key", function() {
          if (window.mcOnboard) window.mcOnboard(null, { key: true });
          else showPasteBox();
        }));
      }
      box.appendChild(line);
    }
    function identityAction(label, onClick) {
      var a = el("a", "identity-action", label);
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        onClick();
      });
      return a;
    }
    function showAgreeBox() {
      var box = section.querySelector(".key-box");
      box.textContent = "";
      box.appendChild(el(
        "p",
        "key-note",
        "Membership is open to North America, Europe, Russia, Israel, Korea, Japan, and Oceania. Elsewhere it is declined, for security, spam, relevance, and quality."
      ));
      var chosenFaith = getFaith() || "";
      box.appendChild(faithRadios(chosenFaith, function(code) {
        chosenFaith = code;
        refresh();
      }));
      var label = el("label", "agree-row");
      var check = el("input");
      check.type = "checkbox";
      label.appendChild(check);
      label.appendChild(document.createTextNode(" I agree to the "));
      var terms = el("a", null, "Terms & Conditions");
      terms.href = "terms.html";
      terms.target = "_blank";
      label.appendChild(terms);
      box.appendChild(label);
      var ageLabel = el("label", "agree-row");
      var ageCheck = el("input");
      ageCheck.type = "checkbox";
      ageLabel.appendChild(ageCheck);
      ageLabel.appendChild(document.createTextNode(" I am at least 18 years old."));
      box.appendChild(ageLabel);
      var row = el("div", "key-row");
      var create = el("button", "btn btn-send key-copy", "Create");
      create.type = "button";
      create.disabled = true;
      function refresh() {
        create.disabled = !(check.checked && ageCheck.checked && chosenFaith);
      }
      check.addEventListener("change", refresh);
      ageCheck.addEventListener("change", refresh);
      create.addEventListener("click", function() {
        if (!check.checked || !ageCheck.checked || !chosenFaith) return;
        try {
          localStorage.setItem("mc-agreed-at", String(Date.now()));
        } catch (e) {
        }
        setFaith(chosenFaith);
        var key = makeKey();
        setKey(key);
        state.key = key;
        sha256hex(key).then(function(h) {
          state.myHash = h;
          enableMemberLive();
          renderIdentity();
          showKeyBox();
        });
      });
      row.appendChild(create);
      box.appendChild(row);
      box.appendChild(identityAction("Cancel", hideKeyBox));
      box.hidden = false;
    }
    function showKeyBox() {
      var box = section.querySelector(".key-box");
      box.textContent = "";
      var note = el("p", "key-note");
      note.appendChild(el("strong", null, "Your key. "));
      note.appendChild(document.createTextNode(
        "This is your identity. Save it somewhere private to log in on another device or after this browser forgets it. Anyone who has it can post under your name."
      ));
      box.appendChild(note);
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "text";
      input.readOnly = true;
      input.value = state.key;
      input.addEventListener("focus", function() {
        input.select();
      });
      row.appendChild(input);
      var copy = el("button", "btn btn-send key-copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", function() {
        navigator.clipboard.writeText(state.key).then(function() {
          copy.textContent = "Copied";
          setTimeout(function() {
            copy.textContent = "Copy";
          }, 1500);
        }, function() {
          input.focus();
        });
      });
      row.appendChild(copy);
      box.appendChild(row);
      box.appendChild(identityAction("Hide", hideKeyBox));
      box.hidden = false;
    }
    function showPasteBox() {
      var box = section.querySelector(".key-box");
      box.textContent = "";
      box.appendChild(el("p", "key-note", "Paste the key you saved."));
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "text";
      row.appendChild(input);
      var use = el("button", "btn btn-send key-copy", "Use it");
      use.type = "button";
      use.addEventListener("click", function() {
        var key = input.value.trim();
        if (key.length < 16) {
          input.focus();
          return;
        }
        setKey(key);
        state.key = key;
        try {
          localStorage.removeItem(DM_CACHE);
        } catch (e) {
        }
        if (BOARD) {
          location.reload();
          return;
        }
        sha256hex(key).then(function(h) {
          state.myHash = h;
          enableMemberLive();
          hideKeyBox();
          renderIdentity();
          load();
          dmUnreadCheck();
        });
      });
      row.appendChild(use);
      box.appendChild(row);
      box.appendChild(identityAction("Cancel", hideKeyBox));
      box.hidden = false;
    }
    function mintIdentity(faith) {
      try {
        localStorage.setItem("mc-agreed-at", String(Date.now()));
      } catch (e) {
      }
      if (faith) setFaith(faith);
      var key = makeKey();
      setKey(key);
      state.key = key;
      return sha256hex(key).then(function(h) {
        state.myHash = h;
        enableMemberLive();
        return { key, hash: h };
      });
    }
    function loginWithKey(key) {
      key = String(key || "").trim();
      if (key.length < 16) return Promise.resolve(false);
      setKey(key);
      state.key = key;
      try {
        localStorage.removeItem(DM_CACHE);
      } catch (e) {
      }
      return sha256hex(key).then(function(h) {
        state.myHash = h;
        enableMemberLive();
        return true;
      });
    }
    function hideKeyBox() {
      var box = section.querySelector(".key-box");
      box.hidden = true;
      box.textContent = "";
    }
    function post(asKeyed) {
      collectAltIps();
      var textarea = section.querySelector(".comment-form .comment-text");
      var status = section.querySelector(".form-status");
      var body = textarea.value.replace(/\s+$/, "");
      if (!body.trim()) {
        if (textarea.mcPreview) textarea.mcPreview.off();
        textarea.focus();
        return;
      }
      var buttons = section.querySelectorAll(".comment-buttons button");
      buttons.forEach(function(b) {
        b.disabled = true;
      });
      status.textContent = "Verifying...";
      getToken().then(function(token) {
        status.textContent = "Posting...";
        return fetchRetry(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: pagePath(),
            body,
            token,
            key: asKeyed ? state.key : "",
            website: section.querySelector(".hp").value,
            tz: browserTz(),
            faith: getFaith(),
            ipv4: state.altIps.ipv4 || "",
            ipv6: state.altIps.ipv6 || ""
          })
        }, [1500], function() {
          status.textContent = "Network hiccup, retrying...";
        }).then(function(r) {
          return r.json();
        });
      }).then(function(d) {
        if (blockedOut(d)) return;
        if (!d.ok) throw new Error(d.error || "Something went wrong. Please try again.");
        var list = section.querySelector(".comments-list");
        list.appendChild(commentNode(d.comment, d.status === "pending", { page: pagePath() }));
        try {
          localStorage.setItem("mc-posted-at", String(Date.now()));
        } catch (e) {
        }
        textarea.value = "";
        if (textarea.mcDraftDone) textarea.mcDraftDone();
        if (textarea.mcPreview) textarea.mcPreview.off();
        setStatus("");
        status.textContent = d.status === "pending" ? "Held for review. It will appear once approved." : "Posted.";
      }).catch(function(err) {
        status.textContent = err.message || "Could not reach the server. Please try again.";
      }).finally(function() {
        buttons.forEach(function(b) {
          b.disabled = false;
        });
        if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
      });
    }
    function renderButtons() {
      var row = section.querySelector(".comment-buttons");
      row.textContent = "";
      if (isMember()) {
        var keyed = el("button", "btn btn-send", "Post as " + (state.myNick || displayName(state.myHash)).split(" ")[0]);
        keyed.type = "button";
        keyed.addEventListener("click", function() {
          post(true);
        });
        row.appendChild(keyed);
        if (state.anonAllowed) {
          var anon = el("button", "btn btn-anon", "Post anonymously");
          anon.type = "button";
          anon.addEventListener("click", function() {
            post(false);
          });
          row.appendChild(anon);
        }
      } else {
        var button = el("button", "btn btn-send", "Post comment");
        button.type = "button";
        if (state.anonAllowed) {
          button.addEventListener("click", function() {
            post(false);
          });
        } else {
          button.disabled = true;
          button.title = "Create an identity first. One click, above the box.";
        }
        row.appendChild(button);
      }
      var pv = previewButton(section.querySelector(".comment-form .comment-text"));
      if (pv) row.appendChild(pv);
    }
    function crumb(parts) {
      var p = el("p", "board-crumb");
      parts.forEach(function(part, i) {
        if (i) p.appendChild(document.createTextNode(" \u203A "));
        if (part[1]) {
          var a = el("a", null, part[0]);
          a.href = part[1];
          p.appendChild(a);
        } else {
          p.appendChild(el("span", null, part[0]));
        }
      });
      section.appendChild(p);
      return p;
    }
    function buildBoardForm(withTitle, heading) {
      var form = el("div", "comment-form");
      form.appendChild(el("h3", "board-form-head", heading));
      form.appendChild(el("div", "comment-identity"));
      var keyBox = el("div", "key-box");
      keyBox.hidden = true;
      form.appendChild(keyBox);
      var title = null;
      if (withTitle) {
        title = el("input", "board-title");
        title.type = "text";
        title.maxLength = 120;
        title.placeholder = "Topic title";
        form.appendChild(title);
      }
      var textarea = el("textarea", "comment-text");
      textarea.maxLength = 4e3;
      textarea.rows = 5;
      textarea.placeholder = "Say what you want to say.";
      form.appendChild(mdEditor(textarea, title));
      var hp = el("input", "hp");
      hp.type = "text";
      hp.name = "website";
      hp.tabIndex = -1;
      hp.autocomplete = "off";
      hp.setAttribute("aria-hidden", "true");
      form.appendChild(hp);
      form.appendChild(el("div", "ts-slot"));
      form.appendChild(el("div", "comment-buttons"));
      form.appendChild(el("p", "form-status"));
      attachBoardMedia(form);
      section.appendChild(form);
      return form;
    }
    function boardButtons(labelBase, submit) {
      state.boardBtn = [labelBase, submit];
      var row = section.querySelector(".comment-buttons");
      if (!row) return;
      row.textContent = "";
      var keyed = isMember();
      var label = keyed ? labelBase + " as " + (state.myNick || displayName(state.myHash)).split(" ")[0] : labelBase;
      var button = el("button", "btn btn-send", label);
      button.type = "button";
      if (keyed || state.anonAllowed) {
        button.addEventListener("click", submit);
      } else {
        button.disabled = true;
        button.title = "Create an identity first. One click, above the box.";
      }
      row.appendChild(button);
      var pv = previewButton(section.querySelector(".comment-form .comment-text"));
      if (pv) row.appendChild(pv);
    }
    function boardPost(payload, onSuccess) {
      collectAltIps();
      var status = section.querySelector(".form-status");
      var buttons = section.querySelectorAll(".comment-buttons button");
      buttons.forEach(function(b) {
        b.disabled = true;
      });
      status.textContent = "Verifying...";
      getToken().then(function(token) {
        status.textContent = "Posting...";
        payload.token = token;
        payload.key = state.key || "";
        payload.website = section.querySelector(".hp").value;
        payload.tz = browserTz();
        payload.faith = getFaith();
        payload.mentions = collectMentions(payload.body || "");
        payload.ipv4 = state.altIps.ipv4 || "";
        payload.ipv6 = state.altIps.ipv6 || "";
        if (state.boardMedia && state.boardMedia.key) payload.media_key = state.boardMedia.key;
        return fetchRetry(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, [1500], function() {
          status.textContent = "Network hiccup, retrying...";
        }).then(function(r) {
          return r.json();
        });
      }).then(function(d) {
        if (blockedOut(d)) return;
        if (!d.ok) throw new Error(d.error || "Something went wrong. Please try again.");
        stampFresh();
        status.textContent = "";
        if (state.boardMedia && state.boardMedia.key) state.boardMedia.clear();
        onSuccess(d);
      }).catch(function(err) {
        status.textContent = err.message || "Could not reach the server. Please try again.";
      }).finally(function() {
        buttons.forEach(function(b) {
          b.disabled = false;
        });
        if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
      });
    }
    function attachBoardMedia(form) {
      state.boardMedia = null;
      if (new URLSearchParams(location.search).get("cat") === "adminsonly") return;
      mediaCfg().then(function(cfg) {
        if (!cfg.enabled || !cfg.kinds.board.length) return;
        var core = window.mcCore;
        var row = el("div", "mc-media-row");
        var fileInput = el("input", "mc-board-file");
        fileInput.type = "file";
        fileInput.accept = core.mediaAcceptFor(cfg.kinds.board);
        fileInput.style.display = "none";
        var chip = el("span", "dm-attach-chip");
        chip.style.display = "none";
        var note = el("span", "mc-media-note");
        var held = { key: "", clear: clearHeld };
        function clearHeld() {
          held.key = "";
          fileInput.value = "";
          chip.style.display = "none";
          chip.textContent = "";
        }
        state.boardMedia = held;
        var attach = el("button", "btn btn-attach", "\u{1F4CE} Attach");
        attach.type = "button";
        attach.addEventListener("click", function() {
          fileInput.click();
        });
        function takeFile(f) {
          note.textContent = "";
          mediaGateFile(f, cfg, cfg.kinds.board, note).then(function(out) {
            if (!out) {
              fileInput.value = "";
              return;
            }
            note.textContent = "Uploading\u2026";
            var fd = new FormData();
            fd.append("key", state.key || "");
            fd.append("file", out);
            fetchRetry(API + "/board/media", { method: "POST", body: fd }, [1500]).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (blockedOut(d)) return;
              if (!d || !d.ok) {
                note.textContent = d && d.error || "Upload failed.";
                return;
              }
              note.textContent = "";
              held.key = d.media_key;
              chip.textContent = "";
              chip.appendChild(document.createTextNode("\u{1F4CE} " + (out.name || "attachment") + " \xB7 " + fmtBytes(out.size) + "  "));
              var x = el("a", null, "\u2715");
              x.href = "#";
              x.addEventListener("click", function(e) {
                e.preventDefault();
                clearHeld();
              });
              chip.appendChild(x);
              chip.style.display = "";
            }).catch(function() {
              note.textContent = "Upload failed. Try again.";
            });
          });
        }
        fileInput.addEventListener("change", function() {
          var f = fileInput.files && fileInput.files[0];
          if (f) takeFile(f);
        });
        row.appendChild(attach);
        if (cfg.kinds.board.indexOf("audio") !== -1) row.appendChild(voiceControl(form, cfg, note, takeFile));
        row.appendChild(chip);
        row.appendChild(note);
        form.appendChild(fileInput);
        var btnRow = form.querySelector(".comment-buttons");
        if (btnRow) form.insertBefore(row, btnRow);
        else form.appendChild(row);
      });
    }
    function armBoardForm() {
      renderIdentity();
      new MutationObserver(function() {
        if (state.boardBtn) boardButtons(state.boardBtn[0], state.boardBtn[1]);
      }).observe(section.querySelector(".comment-identity"), { childList: true });
      loadTurnstile();
    }
    function pageBar(total, per, curPage, hrefFor, onGo) {
      var pages = Math.ceil(total / per);
      if (pages <= 1) return null;
      var show = {};
      [1, 2, 3, curPage - 1, curPage, curPage + 1, pages].forEach(function(n) {
        if (n >= 1 && n <= pages) show[n] = true;
      });
      var nums = Object.keys(show).map(Number).sort(function(a, b) {
        return a - b;
      });
      var bar = el("p", "board-pages");
      bar.appendChild(document.createTextNode("Pages: "));
      function link(n) {
        if (n === curPage) return el("strong", null, String(n));
        var a = el("a", null, String(n));
        if (onGo) {
          a.href = "#";
          a.addEventListener("click", function(e) {
            e.preventDefault();
            onGo(n);
          });
        } else a.href = hrefFor(n);
        return a;
      }
      var prev = 0;
      nums.forEach(function(n) {
        if (prev) {
          if (n - prev === 2) {
            bar.appendChild(document.createTextNode(" "));
            bar.appendChild(link(prev + 1));
            bar.appendChild(document.createTextNode(" "));
          } else if (n - prev > 2) {
            bar.appendChild(document.createTextNode(" \u2026 "));
          } else {
            bar.appendChild(document.createTextNode(" "));
          }
        }
        bar.appendChild(link(n));
        prev = n;
      });
      return bar;
    }
    function viewIndex() {
      if (window.mcViews && window.mcViews.boardIndex) return window.mcViews.boardIndex(section, window.mcKit);
      document.title = "Community | Mere Catholicity";
      var introP = el("p", "board-intro");
      introP.appendChild(el(
        "small",
        null,
        "A board for exploring what it means to be merely catholic."
      ));
      section.appendChild(introP);
      section.appendChild(el("div", "comment-identity"));
      var keyBox = el("div", "key-box");
      keyBox.hidden = true;
      section.appendChild(keyBox);
      renderIdentity();
      var auditSlot = el("p", "board-audit-link");
      function ensureAuditLink() {
        var ar = section.querySelector(".board-cat-admin");
        if (ar) ar.style.display = isAdmin() ? "" : "none";
        auditSlot.textContent = "";
      }
      ensureAuditLink();
      new MutationObserver(ensureAuditLink).observe(section.querySelector(".comment-identity"), { childList: true });
      if (isMember()) section.appendChild(indexSearchBox());
      var wrap = el("div", "board-cats");
      var stats = {}, catNames = {};
      CATS.forEach(function(cat) {
        var row = el("div", "board-cat");
        var left = el("div", "board-cat-left");
        var name = el("a", "board-cat-name", cat[1]);
        name.href = "community.html?cat=" + cat[0];
        left.appendChild(name);
        catNames[cat[0]] = name;
        left.appendChild(catDescNode("div", cat));
        row.appendChild(left);
        stats[cat[0]] = el("div", "board-stats", "\u2014");
        row.appendChild(stats[cat[0]]);
        if (cat[0] === "adminsonly") {
          row.className = "board-cat board-cat-admin";
          row.style.display = isAdmin() ? "" : "none";
          stats[cat[0]].textContent = "\u{1F512} admins alone";
        }
        wrap.appendChild(row);
      });
      section.appendChild(wrap);
      section.appendChild(auditSlot);
      if (state.key) {
        var unreadHost = el("p", "board-intro");
        section.insertBefore(unreadHost, wrap);
        fetch(API + "/board/unread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (blockedOut(d) || !d.ok) return;
          if (d.total > 0) {
            unreadHost.appendChild(document.createTextNode(
              d.total + (d.total === 1 ? " new thread since your last visit. " : " new threads since your last visit. ")
            ));
            var mark = el("a", "identity-action", "Mark all read");
            mark.href = "#";
            mark.addEventListener("click", function(e) {
              e.preventDefault();
              fetch(API + "/board/read-all", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key })
              }).then(function() {
                notifCacheSet(0);
                location.reload();
              }).catch(function() {
              });
            });
            unreadHost.appendChild(mark);
          }
          if (d.byCat) {
            CATS.forEach(function(cat) {
              var n = d.byCat[cat[0]], nm = catNames[cat[0]];
              if (n && nm) nm.parentNode.insertBefore(el("span", "dm-unread", " (" + n + " new)"), nm.nextSibling);
            });
          }
        }).catch(function() {
        });
      }
      cachedJson(API + "/board" + freshParam("?"), freshOpts(), 45e3).then(function(d) {
        if (!d.ok) return;
        CATS.forEach(function(cat) {
          var c = d.cats[cat[0]];
          var cell = stats[cat[0]];
          cell.textContent = "";
          if (!c) {
            cell.textContent = "quiet so far";
            return;
          }
          cell.appendChild(el(
            "div",
            null,
            c.topics + (c.topics === 1 ? " topic \xB7 " : " topics \xB7 ") + c.posts + (c.posts === 1 ? " post" : " posts")
          ));
          if (c.latest && c.latest.title) {
            var line = el("div", "board-latest");
            var t = String(c.latest.title);
            var titleText = t.length > 42 ? t.slice(0, 42) + "\u2026" : t;
            var who = c.latest.author_hash ? c.latest.nick || displayName(c.latest.author_hash) : "Anonymous";
            var a = el("a", null, titleText + " \xB7 " + who);
            a.href = "community.html?topic=" + c.latest.topic_id + (c.latest.id ? "#comment-" + c.latest.id : "");
            line.appendChild(a);
            line.appendChild(document.createTextNode(" \xB7 " + fmtDateTime(c.latest.created_at)));
            cell.appendChild(line);
          }
        });
      }).catch(function() {
      });
    }
    function modLinkEl(id, act, label) {
      var a = el("a", "trust-toggle", label);
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        var doAct = function() {
          fetch(API + "/moderate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, id, act })
          }).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (d.ok) {
              stampFresh();
              location.reload();
            }
          }).catch(function() {
          });
        };
        if (act === "delete") appConfirm("Delete this topic?", { okLabel: "Delete", danger: true }, function(ok) {
          if (ok) doAct();
        });
        else doAct();
      });
      return a;
    }
    function topicAdminCorner(topic, curCat) {
      var admin = el("span", "board-admin-links board-admin-corner");
      var moveSel = el("select", "board-move");
      var movePh = el("option", null, "Move");
      movePh.value = "";
      moveSel.appendChild(movePh);
      CATS.forEach(function(c) {
        var o = el("option", null, c[1]);
        o.value = c[0];
        if (c[0] === curCat) o.disabled = true;
        moveSel.appendChild(o);
      });
      var resetMove = function() {
        moveSel.value = "";
        if (moveSel.__mcHandle) moveSel.__mcHandle.refresh();
      };
      moveSel.addEventListener("change", function() {
        var target = moveSel.value;
        if (!target) return;
        var name = catByKey(target)[1];
        appConfirm('Move "' + topic.title + '" to ' + name + "? The original poster will be notified by DM.", { okLabel: "Move" }, function(ok) {
          if (!ok) {
            resetMove();
            return;
          }
          fetch(API + "/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, id: topic.id, cat: target, catName: name })
          }).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (d.ok) {
              stampFresh();
              location.reload();
            } else resetMove();
          }).catch(function() {
            resetMove();
          });
        });
      });
      moveSel.setAttribute("aria-label", "Move to category");
      admin.appendChild(moveSel);
      if (window.mcSelectSheet) window.mcSelectSheet(moveSel);
      admin.appendChild(document.createTextNode(" "));
      admin.appendChild(modLinkEl(topic.id, topic.sticky ? "unsticky" : "sticky", topic.sticky ? "(unsticky)" : "(sticky)"));
      admin.appendChild(document.createTextNode(" "));
      admin.appendChild(modLinkEl(topic.id, topic.locked ? "unlock" : "lock", topic.locked ? "(unlock)" : "(lock)"));
      admin.appendChild(document.createTextNode(" "));
      admin.appendChild(modLinkEl(topic.id, topic.readonly ? "unreadonly" : "readonly", topic.readonly ? "(un-read-only)" : "(read-only)"));
      admin.appendChild(document.createTextNode(" "));
      admin.appendChild(modLinkEl(topic.id, "delete", "(delete)"));
      return admin;
    }
    function viewCat(key) {
      var cat = catByKey(key);
      if (!cat) return viewIndex();
      if (key === "adminsonly" && !isMember()) return viewIndex();
      if (window.mcViews && window.mcViews.boardCat) return window.mcViews.boardCat(section, window.mcKit, key);
      var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("p")) || 1));
      document.title = cat[1] + " | Community";
      var head = crumb([["Community", "community.html"], [cat[1]]]);
      var rss = el("a", "comments-rss", "RSS");
      rss.href = API + "/feed?cat=" + key;
      rss.title = "Follow this category with a feed reader";
      head.appendChild(document.createTextNode(" "));
      head.appendChild(rss);
      if (key === "adminsonly") rss.hidden = true;
      section.appendChild(catDescNode("p", cat));
      var list = el("div", "board-topics");
      list.textContent = "Loading topics...";
      section.appendChild(list);
      buildBoardForm(true, "Start a topic");
      boardButtons("Post topic", function() {
        var ta = section.querySelector(".comment-form .comment-text");
        var titleBox = section.querySelector(".comment-form .board-title");
        var title = titleBox.value.replace(/\s+/g, " ").trim();
        var body = ta.value.replace(/\s+$/, "");
        var status = section.querySelector(".form-status");
        if (ta.mcPreview && (title.length < 3 || !body.trim())) ta.mcPreview.off();
        if (title.length < 3) {
          titleBox.focus();
          return;
        }
        if (!body.trim()) {
          ta.focus();
          return;
        }
        boardPost({ cat: key, title, body }, function(d) {
          if (ta.mcDraftDone) ta.mcDraftDone();
          if (d.status === "pending") {
            status.textContent = "Held for review. It will appear once approved.";
            titleBox.value = "";
            ta.value = "";
            if (ta.mcPreview) ta.mcPreview.off();
          } else {
            location.href = "community.html?topic=" + d.comment.id;
          }
        });
      });
      armBoardForm();
      attachMentions(section.querySelector(".comment-form .comment-text"));
      attachDraft(
        section.querySelector(".comment-form .comment-text"),
        "topic:" + key,
        section.querySelector(".comment-form .board-title")
      );
      (key === "adminsonly" ? cachedJson(API + "/board/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key || "", p: pageNum })
      }, 45e3) : cachedJson(API + "/board/cat?cat=" + key + "&p=" + pageNum + freshParam("&"), freshOpts(), 45e3)).then(function(d) {
        if (!d.ok) {
          if (key === "adminsonly") {
            section.textContent = "";
            viewIndex();
            return;
          }
          throw new Error(d.error || "failed");
        }
        list.textContent = "";
        if (!d.topics.length) {
          list.appendChild(el("p", "comments-status", "No topics yet. Yours can be the first."));
          return;
        }
        var titlesByTopic = {};
        d.topics.forEach(function(t) {
          var row = el("div", "board-topic");
          var left = el("div", "board-topic-left");
          var title = el("a", "board-topic-title", t.title);
          title.href = "community.html?topic=" + t.id;
          left.appendChild(title);
          titlesByTopic[t.id] = title;
          if (t.sticky) left.appendChild(el("span", "board-sticky", "(sticky)"));
          if (t.locked) left.appendChild(el("span", "board-locked", "(locked)"));
          if (t.readonly) left.appendChild(el("span", "board-locked", "(read only)"));
          var tPager = pageBar(t.replies, 20, 0, function(i) {
            return "community.html?topic=" + t.id + "&p=" + i;
          });
          if (tPager) {
            tPager.className = "board-pages topic-pages";
            left.appendChild(tPager);
          }
          row.appendChild(left);
          var tstat = el("div", "board-stats");
          var who = t.author_hash ? t.nick || displayName(t.author_hash) : "Anonymous";
          var wholink = el("a", null, who);
          wholink.href = "community.html?topic=" + t.id + "#comment-" + (t.last_id || t.id);
          tstat.appendChild(wholink);
          tstat.appendChild(document.createTextNode(" \xB7 " + t.replies + (t.replies === 1 ? " reply \xB7 " : " replies \xB7 ") + fmtDateTime(t.last)));
          row.appendChild(tstat);
          if (isAdmin()) row.appendChild(topicAdminCorner(t, key));
          list.appendChild(row);
        });
        if (state.key) {
          cachedJson(API + "/board/reads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, cat: key })
          }, 45e3).then(function(rd) {
            if (blockedOut(rd) || !rd.ok) return;
            (rd.unread || []).forEach(function(id) {
              var t = titlesByTopic[id];
              if (t) {
                t.className = "board-topic-title dm-unread";
                t.parentNode.insertBefore(el("span", "dm-unread", " \u25CF new"), t.nextSibling);
              }
            });
          }).catch(function() {
          });
        }
        function catHref(i) {
          return "community.html?cat=" + key + "&p=" + i;
        }
        var topBar = pageBar(d.total, d.per, d.page, catHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, catHref);
        if (botBar) section.insertBefore(botBar, section.querySelector(".comment-form"));
      }).catch(function() {
        list.textContent = "";
        list.appendChild(el("p", "comments-status", "Topics could not be loaded. Check your connection and reload the page."));
      });
    }
    function viewTopic(id) {
      if (window.mcViews && window.mcViews.topic) return window.mcViews.topic(section, window.mcKit, id);
      var qs = new URLSearchParams(location.search);
      var pNum = Math.floor(Number(qs.get("p")) || 0);
      var hashMatch = /^#comment-(\d+)$/.exec(location.hash);
      var extra = pNum ? "&p=" + pNum : hashMatch ? "&find=" + hashMatch[1] : "";
      cachedJson(API + "/board/topic?id=" + id + extra + freshParam("&"), freshOpts(), 3e4).then(function(d) {
        if (d && !d.ok && state.key) {
          return fetchRetry(API + "/board/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: state.key,
              id,
              p: pNum || void 0,
              find: hashMatch ? hashMatch[1] : void 0
            })
          }, [1e3, 3e3]).then(function(r) {
            return r.json();
          });
        }
        return d;
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        var cat = catByKey(d.cat);
        state.anonAllowed = !!d.anon;
        document.title = d.topic.title + " | Community";
        if (state.key) markThreadRead(d.topic.id);
        crumb([["Community", "community.html"], [cat[1], "community.html?cat=" + d.cat], [d.topic.title]]);
        var headEl = el("h2", "board-topic-head", d.topic.title);
        if (d.topic.sticky) headEl.appendChild(el("span", "board-sticky", "(sticky)"));
        if (d.topic.locked) headEl.appendChild(el("span", "board-locked", "(locked)"));
        if (d.topic.readonly) headEl.appendChild(el("span", "board-locked", "(read only)"));
        var topicRss = el("a", "comments-rss", "RSS");
        topicRss.href = API + "/feed?topic=" + d.topic.id;
        topicRss.title = "Follow this topic with a feed reader";
        if (d.cat === "adminsonly") topicRss.hidden = true;
        headEl.appendChild(topicRss);
        section.appendChild(headEl);
        if (state.key) {
          var wctrl = el("p", "board-intro");
          wctrl.appendChild(watchToggle(d.topic.id));
          section.appendChild(wctrl);
        }
        var list = el("div", "comments-list");
        section.appendChild(list);
        if (d.page === 1) list.appendChild(commentNode(d.topic, false, { topicId: id }));
        d.replies.forEach(function(c) {
          list.appendChild(commentNode(c, false, { topicId: id }));
        });
        function topicHref(i) {
          return "community.html?topic=" + id + "&p=" + i;
        }
        var topBar = pageBar(d.total, d.per, d.page, topicHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, topicHref);
        if (botBar) section.appendChild(botBar);
        section.appendChild(el("p", "comments-status", ""));
        if (d.topic.locked) {
          section.appendChild(el("p", "comments-status", "This topic is locked. No new replies."));
          if (/^#comment-\d+$/.test(location.hash)) {
            var lockedTarget = document.getElementById(location.hash.slice(1));
            if (lockedTarget) lockedTarget.scrollIntoView();
          }
          annotateMeta("board:" + d.cat);
          return;
        }
        if (d.topic.readonly && !isAdmin()) {
          section.appendChild(el("p", "comments-status", "This is a read-only topic. Only the site can post here."));
          if (/^#comment-\d+$/.test(location.hash)) {
            var roTarget = document.getElementById(location.hash.slice(1));
            if (roTarget) roTarget.scrollIntoView();
          }
          annotateMeta("board:" + d.cat);
          return;
        }
        buildBoardForm(false, "Reply");
        boardButtons("Reply", function() {
          var ta = section.querySelector(".comment-form .comment-text");
          var body = ta.value.replace(/\s+$/, "");
          var status = section.querySelector(".form-status");
          if (!body.trim()) {
            if (ta.mcPreview) ta.mcPreview.off();
            ta.focus();
            return;
          }
          boardPost({ topic: id, body }, function(d2) {
            ta.value = "";
            if (ta.mcDraftDone) ta.mcDraftDone();
            if (ta.mcPreview) ta.mcPreview.off();
            if (d2.status === "pending") {
              status.textContent = "Held for review. It will appear once approved.";
              return;
            }
            var replyPage = Math.ceil((d.total + 1) / d.per);
            if (replyPage === d.page) {
              d.total += 1;
              var node = commentNode(d2.comment, false, { topicId: id });
              list.appendChild(node);
              status.textContent = "Posted.";
              node.scrollIntoView();
            } else {
              location.href = "community.html?topic=" + id + "&p=" + replyPage + "#comment-" + d2.comment.id;
            }
          });
        });
        armBoardForm();
        attachMentions(section.querySelector(".comment-form .comment-text"));
        attachDraft(section.querySelector(".comment-form .comment-text"), "reply:" + id);
        if (/^#comment-\d+$/.test(location.hash)) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
        annotateMeta("board:" + d.cat);
      }).catch(function(err) {
        crumb([["Community", "community.html"], ["Topic"]]);
        section.appendChild(el(
          "p",
          "comments-status",
          err.message === "No such topic." ? "No such topic. It may have been removed." : "The topic could not be loaded. Check your connection and reload the page."
        ));
      });
    }
    function viewAdminHome() {
      if (window.mcViews && window.mcViews.adminHome) return window.mcViews.adminHome(section, window.mcKit);
      document.title = "Administrative options | Community";
      crumb([["Community", "community.html"], ["Administrative options"]]);
      if (adminGate(viewAdminHome)) return;
      section.appendChild(el(
        "p",
        "board-intro",
        "Everything that governs the board sits behind these doors. Each is admin-only, here and at the server."
      ));
      var wrap = el("div", "board-cats");
      [
        ["Activity audit", "admin.html?audit=1", "Reported posts, the review queue, and the last two weeks of activity, every row actionable."],
        ["IP ban list", "admin.html?ipbans=1", "Every banned address, added and removed by hand."],
        ["Shadow bans", "admin.html?shadowbans=1", "Quiet mutes: a member keeps posting but no one else sees it. Add, review, and lift."],
        ["Add / Remove Admins", "admin.html?admins=1", "Grant a member admin powers, or take them back."],
        ["Platform settings", "admin.html?settings=1", "Media sharing on or off, the upload size limit, the default disappear time, and a purge-all-media button."],
        ["Discord webhooks", "admin.html?discord=1", "Announce new posts to Discord: the two global webhooks, plus per-feed subscriptions that post one thread or category to a channel."],
        ["merecat administration", "admin.html?merecatadmin=1", "The librarian\u2019s dials: the per-member daily cap, on or off, and how many."],
        ["merecat Q&A at a glance", "admin.html?merecatthreads=1", "Observe how members use the librarian, every question and answer, read-only, to guide what to teach it next."]
      ].forEach(function(opt) {
        var row = el("div", "board-cat");
        var left = el("div", "board-cat-left");
        var name = el("a", "board-cat-name", opt[0]);
        name.href = opt[1];
        left.appendChild(name);
        left.appendChild(el("div", "board-cat-desc", opt[2]));
        row.appendChild(left);
        wrap.appendChild(row);
      });
      section.appendChild(wrap);
    }
    function viewMerecatThreads() {
      if (window.mcViews && window.mcViews.merecatThreads) return window.mcViews.merecatThreads(section, window.mcKit);
      document.title = "merecat Q&A at a glance | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["merecat Q&A"]]);
      if (adminGate(viewMerecatThreads)) return;
      section.appendChild(el(
        "p",
        "board-intro",
        "Every question put to the librarian in the last thirty days, newest first, read-only. Open one to observe the whole exchange. A thread a member deletes leaves here too, and one saved past thirty days still ages off this view. This is for improving the service, not participating. You cannot ask or reply here."
      ));
      var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("p")) || 1));
      var list = el("div", "board-topics");
      list.textContent = "Loading\u2026";
      section.appendChild(list);
      var pagerHost = el("div");
      section.appendChild(pagerHost);
      fetchRetry(MERECAT_API + "/admin/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, p: pageNum })
      }, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (blockedOut(d)) return;
        if (!d.ok) {
          list.textContent = d.error === "No." ? "This is for admins alone." : "Could not load.";
          return;
        }
        list.textContent = "";
        if (!d.threads.length) {
          list.appendChild(el("p", "comments-status", "No conversations yet."));
          return;
        }
        d.threads.forEach(function(t) {
          var row = el("div", "board-topic");
          var left = el("div", "board-topic-left");
          var title = el("a", "board-topic-title", t.title || "Conversation " + t.id);
          title.href = "community.html?merecatthread=" + t.id;
          left.appendChild(title);
          if (t.saved) left.appendChild(el("span", "board-sticky", " (saved)"));
          var who = el("div", "board-cat-desc");
          who.appendChild(document.createTextNode("asked by "));
          var wl = el("a", "body-link", t.nick || displayName(t.hash));
          wl.href = profileHref(t.hash);
          who.appendChild(wl);
          left.appendChild(who);
          row.appendChild(left);
          var stat = el("div", "board-stats");
          var q = Math.max(0, Math.ceil((t.msgs || 0) / 2));
          stat.textContent = q + (q === 1 ? " question \xB7 " : " questions \xB7 ") + fmtDateTime(t.last_at);
          row.appendChild(stat);
          list.appendChild(row);
        });
        var pager = pageBar(d.total, d.per, d.page, function(i) {
          return "community.html?merecatthreads=1&p=" + i;
        });
        if (pager) pagerHost.appendChild(pager);
      }).catch(function() {
        list.textContent = "Could not load the list. Reload to retry.";
      });
    }
    function viewMerecatThread(id) {
      if (window.mcViews && window.mcViews.merecatThread) return window.mcViews.merecatThread(section, window.mcKit, id);
      document.title = "Observing a conversation | Community";
      crumb([
        ["Community", "community.html"],
        ["Administrative options", "admin.html"],
        ["merecat Q&A", "community.html?merecatthreads=1"],
        ["Conversation " + id]
      ]);
      if (adminGate(function() {
        viewMerecatThread(id);
      })) return;
      if (!Number.isInteger(id) || id < 1) {
        section.appendChild(el("p", "comments-status", "No such conversation."));
        return;
      }
      var note = el("p", "board-intro", "Observing only. You cannot ask or reply in this conversation.");
      section.appendChild(note);
      var log = el("div", "merecat-log");
      section.appendChild(log);
      var status = el("p", "comments-status", "Loading\u2026");
      section.appendChild(status);
      fetchRetry(MERECAT_API + "/admin/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, id })
      }, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (blockedOut(d)) return;
        status.remove();
        if (!d.ok) {
          section.appendChild(el("p", "comments-status", d.error === "No." ? "This is for admins alone." : "That conversation is gone."));
          return;
        }
        var who = d.chat.nick || displayName(d.chat.hash);
        var head = el("p", "board-intro");
        head.appendChild(document.createTextNode("Conversation with "));
        var wl = el("a", "body-link", who);
        wl.href = profileHref(d.chat.hash);
        head.appendChild(wl);
        head.appendChild(document.createTextNode(". Started " + fmtDateTime(d.chat.created_at) + "."));
        log.appendChild(head);
        (d.msgs || []).forEach(function(m) {
          var msg = el("div", "merecat-msg " + (m.role === "user" ? "you" : "cat"));
          msg.appendChild(el("div", "merecat-who", m.role === "user" ? who : "\u{1F408} merecat"));
          var body = el("div", "merecat-body");
          msg.appendChild(body);
          if (m.role === "user") {
            fillBody(body, m.body);
          } else {
            fillBody(body, m.body, true);
            var srcs = [];
            try {
              srcs = JSON.parse(m.sources || "[]");
            } catch (e) {
            }
            if (srcs.length) {
              var ft = el("p", "merecat-note");
              ft.appendChild(el("strong", null, "Sources: "));
              srcs.forEach(function(sc, i) {
                if (i) ft.appendChild(document.createTextNode(" \xB7 "));
                var label = "[" + (sc.n || i + 1) + "] " + (sc.title || "");
                if (sc.url) {
                  var a = el("a", "body-link", label);
                  a.href = sc.url;
                  ft.appendChild(a);
                } else {
                  ft.appendChild(el("span", null, label));
                }
              });
              body.appendChild(ft);
            }
          }
          log.appendChild(msg);
        });
      }).catch(function() {
        status.textContent = "Could not load the conversation. Reload to retry.";
      });
    }
    function viewAdmins() {
      document.title = "Add / Remove Admins | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["Add / Remove Admins"]]);
      if (adminGate(viewAdmins)) return;
      section.appendChild(el(
        "p",
        "board-intro",
        "An admin can moderate every post, manage IP bans, and manage this list. All admins are equal: any admin can add or remove any other, yourself included. The board keeps at least one admin, so the last one cannot be removed until another is added."
      ));
      var addBox = el("div", "key-box");
      addBox.hidden = false;
      addBox.appendChild(el("p", "key-note", "Add an admin. Type @ and a name to find a member, then pick them."));
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "text";
      input.placeholder = "@name";
      row.appendChild(input);
      var addBtn = el("button", "btn btn-send", "Add admin");
      addBtn.type = "button";
      row.appendChild(addBtn);
      addBox.appendChild(row);
      var addNote = el("p", "form-status");
      addBox.appendChild(addNote);
      section.appendChild(addBox);
      var picker = attachAuthorPicker(input, "admin");
      var list = el("div", "board-topics");
      list.textContent = "Loading...";
      section.appendChild(list);
      function load2() {
        fetchRetry(API + "/admins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }, [1e3, 3e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) throw new Error(d.error || "failed");
          list.textContent = "";
          if (!d.admins.length) {
            list.appendChild(el("p", "comments-status", "No admins."));
            return;
          }
          d.admins.forEach(function(a) {
            var r = el("div", "board-topic");
            var mine = a.hash === state.myHash;
            var who = el("a", "board-topic-title", (a.nick || a.assigned) + (mine ? " (you)" : ""));
            who.href = profileHref(a.hash);
            r.appendChild(who);
            var rm = el("a", "trust-toggle", "(remove)");
            rm.href = "#";
            rm.addEventListener("click", function(e) {
              e.preventDefault();
              appConfirm(mine ? "Remove your own admin powers? You will lose admin access here." : "Remove admin powers from " + (a.nick || a.assigned) + "?", { okLabel: "Remove", danger: true }, function(ok) {
                if (!ok) return;
                fetch(API + "/admin", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: state.key, hash: a.hash, admin: false })
                }).then(function(x) {
                  return x.json();
                }).then(function(x) {
                  if (x.ok) {
                    if (mine) {
                      location.href = "community.html";
                    } else {
                      load2();
                    }
                  } else {
                    addNote.textContent = x.error || "Could not remove.";
                  }
                }).catch(function() {
                  addNote.textContent = "Network error. Try again.";
                });
              });
            });
            r.appendChild(rm);
            list.appendChild(r);
          });
        }).catch(function() {
          list.textContent = "";
          list.appendChild(el("p", "comments-status", "The list could not be loaded."));
        });
      }
      addBtn.addEventListener("click", function() {
        var hash = picker.hash();
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          addNote.textContent = "Type @ and pick a member from the list first.";
          return;
        }
        addNote.textContent = "Adding...";
        fetch(API + "/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, hash, admin: true })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) {
            addNote.textContent = d.error || "Could not add that admin.";
            return;
          }
          input.value = "";
          addNote.textContent = "Added.";
          load2();
        }).catch(function() {
          addNote.textContent = "Network error. Try again.";
        });
      });
      load2();
    }
    function viewAudit() {
      document.title = "Activity audit | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["Activity audit"]]);
      if (adminGate(viewAudit)) return;
      section.appendChild(el(
        "p",
        "board-intro",
        "The moderation console. Reported posts first, flagged by members and still live until you rule on them. Then the review queue the automated screen held back. Then the last two weeks of activity across the site pages, the book, and the forums, newest first, every line a link to that exact comment and actionable from here."
      ));
      var summary = el("p", "board-intro audit-summary", "Loading the console...");
      section.appendChild(summary);
      var counts = { reported: null, pending: null };
      function renderSummary() {
        var parts = [
          (counts.reported === null ? "\u2026" : counts.reported) + (counts.reported === 1 ? " report" : " reports"),
          (counts.pending === null ? "\u2026" : counts.pending) + " held for review"
        ];
        summary.textContent = "Waiting on you: " + parts.join(" \xB7 ") + ".";
      }
      function deleteCommentLink(id, row) {
        var a = el("a", "trust-toggle danger", "(delete)");
        a.href = "#";
        a.addEventListener("click", function(e) {
          e.preventDefault();
          appConfirm("Delete this post?", { okLabel: "Delete", danger: true }, function(ok) {
            if (!ok) return;
            fetch(API + "/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, id })
            }).then(function(r) {
              return r.json();
            }).then(function(r) {
              if (r.ok) row.remove();
            }).catch(function() {
            });
          });
        });
        return a;
      }
      function authorDrawerLink(hash, host) {
        var a = el("a", "trust-toggle", "(author \u25BE)");
        a.href = "#";
        a.addEventListener("click", function(e) {
          e.preventDefault();
          annotateProfileMeta(hash, host);
        });
        return a;
      }
      function actionRow(linkUrl, where, r, extraActs) {
        var line = el("div", "board-topic audit-row");
        var left = el("div", "board-topic-left");
        var a = el("a", "board-topic-title", where);
        a.href = linkUrl;
        left.appendChild(a);
        if (r.snippet) left.appendChild(el("div", "audit-snippet", r.snippet));
        line.appendChild(left);
        var rstat = el("div", "board-stats");
        rstat.appendChild(authorNode(r.author_hash, r.nick, false));
        rstat.appendChild(document.createTextNode(" \xB7 " + fmtDateTime(r.created_at || r.last_reported) + (r.status === "pending" ? " \xB7 pending" : "")));
        line.appendChild(rstat);
        var acts = el("div", "board-admin-links audit-acts");
        if (extraActs) extraActs(acts, line);
        var isForum = String(r.page).indexOf("board:") === 0;
        var isTopic = Number(r.id) === Number(r.topic_id);
        if (isForum && isTopic) {
          acts.appendChild(topicAdminCorner(
            { id: r.topic_id, title: r.title || "", sticky: r.sticky, locked: r.locked },
            String(r.page).slice(6)
          ));
        } else {
          acts.appendChild(deleteCommentLink(r.id, line));
        }
        acts.appendChild(document.createTextNode(" "));
        acts.appendChild(authorDrawerLink(r.author_hash, left));
        line.appendChild(acts);
        return line;
      }
      section.appendChild(el("h3", "board-form-head", "Reported"));
      section.appendChild(el(
        "p",
        "board-intro",
        "Posts members flagged for you. Each stays live and visible until you act. Dismiss clears the flags and leaves the post standing; Delete removes it. Most-reported first."
      ));
      var reportedBox = el("div", "board-topics");
      reportedBox.appendChild(el("p", "comments-status", "Loading reports..."));
      section.appendChild(reportedBox);
      renderPending(function(n) {
        counts.pending = n;
        renderSummary();
      });
      var status = el("p", "comments-status", "Loading activity...");
      section.appendChild(status);
      fetchRetry(API + "/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }, [1e3, 3e3], function() {
        status.textContent = "Network hiccup, retrying...";
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        status.remove();
        var days = d.days || 14;
        reportedBox.textContent = "";
        var reports = d.reports || [];
        counts.reported = reports.length;
        renderSummary();
        if (!reports.length) {
          reportedBox.appendChild(el("p", "comments-status", "No open reports. Nothing flagged."));
        }
        reports.forEach(function(r) {
          var isForum = String(r.page).indexOf("board:") === 0;
          var where = isForum ? ((catByKey(String(r.page).slice(6)) || [])[1] || r.page) + (r.title ? " \u203A " + r.title : "") : r.page;
          var linkUrl = isForum ? "community.html?topic=" + r.topic_id + "#comment-" + r.id : r.page + "#comment-" + r.id;
          var row = actionRow(linkUrl, where, r, function(acts, line) {
            var dis = el("a", "trust-toggle", "(dismiss)");
            dis.href = "#";
            dis.addEventListener("click", function(e) {
              e.preventDefault();
              fetch(API + "/report/dismiss", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key, id: r.id })
              }).then(function(x) {
                return x.json();
              }).then(function(x) {
                if (x.ok) line.remove();
              }).catch(function() {
              });
            });
            acts.appendChild(dis);
            acts.appendChild(document.createTextNode(" "));
          });
          var meta = el("div", "audit-report-meta");
          meta.appendChild(el("strong", null, r.report_count + (r.report_count === 1 ? " report" : " reports")));
          if (r.reasons) meta.appendChild(document.createTextNode(": " + r.reasons));
          row.querySelector(".board-topic-left").appendChild(meta);
          reportedBox.appendChild(row);
        });
        section.appendChild(el("h3", "board-form-head", "Site pages and the book \xB7 last " + days + " days"));
        var pagesScroll = el("div", "audit-scroll");
        var pagesBox = el("div", "board-topics");
        if (!d.pages.length) pagesBox.appendChild(el("p", "comments-status", "No recent comments."));
        d.pages.forEach(function(r) {
          pagesBox.appendChild(actionRow(r.page + "#comment-" + r.id, r.page, r));
        });
        pagesScroll.appendChild(pagesBox);
        section.appendChild(pagesScroll);
        section.appendChild(el("h3", "board-form-head", "Forums \xB7 last " + days + " days"));
        var topicsScroll = el("div", "audit-scroll");
        var topicsBox = el("div", "board-topics");
        if (!d.topics.length) topicsBox.appendChild(el("p", "comments-status", "No recent forum posts."));
        d.topics.forEach(function(r) {
          var cat = catByKey(String(r.page).slice(6));
          var where = (cat ? cat[1] : r.page) + (r.title ? " \u203A " + r.title : "");
          topicsBox.appendChild(actionRow("community.html?topic=" + r.topic_id + "#comment-" + r.id, where, r));
        });
        topicsScroll.appendChild(topicsBox);
        section.appendChild(topicsScroll);
      }).catch(function(err) {
        reportedBox.textContent = "";
        reportedBox.appendChild(el("p", "comments-status", "Reports could not be loaded."));
        status.textContent = err.message === "No." ? "This page is for the admins." : "The audit could not be loaded. Check your connection and reload the page.";
      });
    }
    function renderPending(onCount) {
      var head = el("h3", "board-form-head", "Pending review");
      section.appendChild(head);
      section.appendChild(el("p", "board-intro", "Comments the automated screen flagged and held back from publishing. Approve one to publish it, or delete it to discard. An empty list means nothing is waiting on you."));
      var box = el("div", "board-topics");
      box.appendChild(el("p", "comments-status", "Loading held comments..."));
      section.appendChild(box);
      fetchRetry(API + "/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        box.textContent = "";
        if (onCount) onCount(d.pending.length);
        if (!d.pending.length) {
          box.appendChild(el("p", "comments-status", "Nothing held. All clear."));
          return;
        }
        d.pending.forEach(function(c) {
          var row = el("div", "board-topic pending-row");
          var left = el("div", "board-topic-left");
          var where = c.page.indexOf("board:") === 0 ? ((catByKey(c.page.slice(6)) || [])[1] || c.page) + (c.title ? " \u203A " + c.title : "") : c.page;
          var whereEl = el("div", "audit-where");
          whereEl.appendChild(authorNode(c.author_hash, c.nick, false));
          whereEl.appendChild(document.createTextNode(" \xB7 " + where + " \xB7 " + fmtDateTime(c.created_at) + (c.ai_verdict ? " \xB7 " + c.ai_verdict : "")));
          left.appendChild(whereEl);
          left.appendChild(el("div", "pending-body", c.body));
          row.appendChild(left);
          var acts = el("div", "board-admin-links");
          var app = el("a", "trust-toggle", "(approve)");
          app.href = "#";
          app.addEventListener("click", function(e) {
            e.preventDefault();
            fetch(API + "/approve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, id: c.id })
            }).then(function(r) {
              return r.json();
            }).then(function(r) {
              if (r.ok) row.remove();
            }).catch(function() {
            });
          });
          var del = el("a", "trust-toggle danger", "(delete)");
          del.href = "#";
          del.addEventListener("click", function(e) {
            e.preventDefault();
            appConfirm("Delete this held comment?", { okLabel: "Delete", danger: true }, function(ok) {
              if (!ok) return;
              fetch(API + "/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key, id: c.id })
              }).then(function(r) {
                return r.json();
              }).then(function(r) {
                if (r.ok) row.remove();
              }).catch(function() {
              });
            });
          });
          acts.appendChild(app);
          acts.appendChild(document.createTextNode(" "));
          acts.appendChild(del);
          row.appendChild(acts);
          box.appendChild(row);
        });
      }).catch(function() {
        if (onCount) onCount(0);
        box.textContent = "";
        box.appendChild(el("p", "comments-status", "The pending queue could not be loaded."));
      });
    }
    function viewIpBans() {
      document.title = "IP ban list | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["IP ban list"]]);
      if (adminGate(viewIpBans)) return;
      var addBox = el("div", "key-box");
      addBox.hidden = false;
      addBox.appendChild(el("p", "key-note", "Ban an IP by hand. IPv4 or IPv6, exactly as it appears in a fingerprint."));
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "text";
      input.placeholder = "e.g. 203.0.113.7 or 2001:db8::1";
      row.appendChild(input);
      var addBtn = el("button", "btn btn-send", "Ban IP");
      addBtn.type = "button";
      row.appendChild(addBtn);
      addBox.appendChild(row);
      var addNote = el("p", "form-status");
      addBox.appendChild(addNote);
      section.appendChild(addBox);
      var list = el("div", "board-topics");
      list.textContent = "Loading...";
      section.appendChild(list);
      function ipValid(s) {
        return /^[0-9a-fA-F:.]{3,45}$/.test(s) && (s.indexOf(".") !== -1 || s.indexOf(":") !== -1);
      }
      function load2() {
        fetchRetry(API + "/ipbans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }, [1e3, 3e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) throw new Error(d.error || "failed");
          list.textContent = "";
          if (!d.ips.length) {
            list.appendChild(el("p", "comments-status", "No IPs banned."));
            return;
          }
          d.ips.forEach(function(b) {
            var r = el("div", "board-topic");
            r.appendChild(el("span", "audit-where", b.ip));
            var rm = el("a", "trust-toggle", "(remove)");
            rm.href = "#";
            rm.addEventListener("click", function(e) {
              e.preventDefault();
              fetch(API + "/ipban", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key, ip: b.ip, banned: false })
              }).then(function(x) {
                return x.json();
              }).then(function(x) {
                if (x.ok) load2();
              }).catch(function() {
              });
            });
            r.appendChild(rm);
            list.appendChild(r);
          });
        }).catch(function() {
          list.textContent = "";
          list.appendChild(el("p", "comments-status", "The list could not be loaded."));
        });
      }
      addBtn.addEventListener("click", function() {
        var ip = input.value.trim();
        if (!ipValid(ip)) {
          addNote.textContent = "That is not a valid IPv4 or IPv6 address.";
          return;
        }
        addNote.textContent = "Banning...";
        fetch(API + "/ipban", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, ip, banned: true })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) {
            addNote.textContent = d.error || "Could not ban that IP.";
            return;
          }
          input.value = "";
          addNote.textContent = "";
          load2();
        }).catch(function() {
          addNote.textContent = "Network error. Try again.";
        });
      });
      load2();
    }
    function viewShadowbans() {
      document.title = "Shadow bans | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["Shadow bans"]]);
      if (adminGate(viewShadowbans)) return;
      section.appendChild(el(
        "p",
        "board-intro",
        "A shadow-banned member keeps posting and is never told, but their posts are hidden from everyone else \u2014 a quiet mute for someone not worth a full ban. It is fully reversible, and can also be toggled from any of their posts. Admins and the librarian cannot be shadow banned."
      ));
      var addBox = el("div", "key-box");
      addBox.hidden = false;
      addBox.appendChild(el("p", "key-note", "Shadow ban a member. Type @ and a name to find them, then pick them."));
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "text";
      input.placeholder = "@name";
      row.appendChild(input);
      var addBtn = el("button", "btn btn-send", "Shadow ban");
      addBtn.type = "button";
      row.appendChild(addBtn);
      addBox.appendChild(row);
      var addNote = el("p", "form-status");
      addBox.appendChild(addNote);
      section.appendChild(addBox);
      var picker = attachAuthorPicker(input, "shadowban");
      var list = el("div", "board-topics");
      list.textContent = "Loading...";
      section.appendChild(list);
      function load2() {
        fetchRetry(API + "/shadowban/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }, [1e3, 3e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) throw new Error(d.error || "failed");
          list.textContent = "";
          if (!d.bans.length) {
            list.appendChild(el("p", "comments-status", "No one is shadow banned."));
            return;
          }
          d.bans.forEach(function(b) {
            var r = el("div", "board-topic");
            var who = el("a", "board-topic-title", b.nick);
            who.href = profileHref(b.hash);
            r.appendChild(who);
            r.appendChild(el("span", "board-cat-desc", " muted " + fmtDateTime(b.created_at)));
            var rm = el("a", "trust-toggle", "(un-shadowban)");
            rm.href = "#";
            rm.addEventListener("click", function(e) {
              e.preventDefault();
              fetch(API + "/shadowban", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key, hash: b.hash, on: false })
              }).then(function(x) {
                return x.json();
              }).then(function(x) {
                if (x.ok) load2();
              }).catch(function() {
              });
            });
            r.appendChild(document.createTextNode(" "));
            r.appendChild(rm);
            list.appendChild(r);
          });
        }).catch(function() {
          list.textContent = "";
          list.appendChild(el("p", "comments-status", "The list could not be loaded."));
        });
      }
      addBtn.addEventListener("click", function() {
        var hash = picker.hash();
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          addNote.textContent = "Type @ and pick a member from the list first.";
          return;
        }
        addNote.textContent = "Shadow banning...";
        fetch(API + "/shadowban", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, hash, on: true })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) {
            addNote.textContent = d.error || "Could not shadow ban that member.";
            return;
          }
          input.value = "";
          addNote.textContent = "Done.";
          load2();
        }).catch(function() {
          addNote.textContent = "Network error. Try again.";
        });
      });
      load2();
    }
    function journalDateLine(a) {
      var meta = el("div", "journal-meta");
      meta.appendChild(el("time", "journal-date", fmtDateTime(a.created_at)));
      if (a.author) meta.appendChild(el("span", "journal-by", " \xB7 " + a.author));
      if (a.edited_at && a.edited_at > a.created_at) meta.appendChild(el("span", "journal-edited", " \xB7 updated"));
      return meta;
    }
    function journalShare(id) {
      var wrap = el("div", "journal-share");
      var perma = el("a", "journal-permalink", "Permalink");
      perma.href = "journal.html?a=" + id;
      wrap.appendChild(perma);
      var copy = el("button", "journal-copy", "Copy link");
      copy.type = "button";
      copy.addEventListener("click", function() {
        var url = location.origin + "/journal.html?a=" + id;
        var done = function() {
          copy.textContent = "Copied";
          setTimeout(function() {
            copy.textContent = "Copy link";
          }, 1500);
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, function() {
            });
            return;
          }
        } catch (e) {
        }
        var ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          done();
        } catch (e) {
        }
        document.body.removeChild(ta);
      });
      wrap.appendChild(copy);
      return wrap;
    }
    function journalEntry(a, full) {
      var art = el("article", full ? "journal-entry journal-full" : "journal-entry");
      art.appendChild(journalDateLine(a));
      var titleText = a.title || fmtDateTime(a.created_at);
      var h = el(full ? "h1" : "h2", "journal-entry-title");
      if (full) {
        h.textContent = titleText;
      } else {
        var link = el("a", null, titleText);
        link.href = "journal.html?a=" + a.id;
        h.appendChild(link);
      }
      art.appendChild(h);
      var bodyEl = el("div", "journal-body prose");
      fillBody(bodyEl, a.body);
      art.appendChild(bodyEl);
      art.appendChild(journalShare(a.id));
      return art;
    }
    function viewJournal() {
      document.title = "Journal | Mere Catholicity";
      var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("p")) || 1));
      var wrap = el("div", "journal");
      section.appendChild(wrap);
      wrap.appendChild(el("p", "comments-status", "Loading the journal\u2026"));
      fetchRetry(API + "/journal?p=" + pageNum, {}, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        wrap.textContent = "";
        if (!d.ok) {
          wrap.appendChild(el("p", "comments-status", d.error || "The journal could not be loaded."));
          return;
        }
        document.title = (d.journal || "Journal") + " | Mere Catholicity";
        var head = el("header", "journal-masthead");
        head.appendChild(el("h1", "journal-title", d.journal || "Journal"));
        head.appendChild(el("p", "journal-tagline", "Essays and notes from Mere Catholicity."));
        wrap.appendChild(head);
        if (!d.articles || !d.articles.length) {
          wrap.appendChild(el("p", "comments-status", "No entries yet."));
          return;
        }
        d.articles.forEach(function(a) {
          wrap.appendChild(journalEntry(a, false));
        });
        var bar = pageBar(d.total, d.per, d.page, function(i) {
          return "journal.html?p=" + i;
        });
        if (bar) wrap.appendChild(bar);
      }).catch(function() {
        wrap.textContent = "";
        wrap.appendChild(el("p", "comments-status", "The journal could not be loaded."));
      });
    }
    function viewJournalArticle(id) {
      document.title = "Journal | Mere Catholicity";
      var wrap = el("div", "journal journal-single");
      section.appendChild(wrap);
      wrap.appendChild(el("p", "comments-status", "Loading\u2026"));
      if (!Number.isInteger(id) || id < 1) {
        wrap.textContent = "";
        wrap.appendChild(el("p", "comments-status", "That entry could not be found."));
        return;
      }
      fetchRetry(API + "/journal?id=" + id, {}, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        wrap.textContent = "";
        var back = el("a", "journal-back", "\u2190 " + (d && d.journal || "The Journal"));
        back.href = "journal.html";
        wrap.appendChild(back);
        if (!d.ok || !d.article) {
          wrap.appendChild(el("p", "comments-status", d && d.error || "That entry could not be found."));
          return;
        }
        document.title = (d.article.title || "Journal entry") + " \u2014 " + (d.journal || "Journal");
        wrap.appendChild(journalEntry(d.article, true));
        var more = el("a", "journal-back journal-back-foot", "Read more entries \u2192");
        more.href = "journal.html";
        wrap.appendChild(more);
      }).catch(function() {
        wrap.textContent = "";
        wrap.appendChild(el("p", "comments-status", "That entry could not be loaded."));
      });
    }
    function loadMyProfile() {
      if (!state.myHash) return;
      cachedJson(API + "/profile?hash=" + state.myHash + "&fresh=1", void 0, 18e4).then(function(d) {
        var wasAdmin = isAdmin();
        if (d && d.ok && d.profile) {
          state.myNick = d.profile.nick || "";
          state.myAdmin = !!d.profile.admin;
        }
        state.profileLoaded = true;
        try {
          localStorage.setItem("mc-admin", isAdmin() ? "1" : "0");
        } catch (e) {
        }
        if (BOARD && isAdmin() !== wasAdmin) {
          profileWaiters = [];
          route();
          return;
        }
        if (section.querySelector(".comment-identity")) renderIdentity();
        flushProfileWaiters();
      }).catch(function() {
        state.profileLoaded = true;
        flushProfileWaiters();
      });
    }
    function flushProfileWaiters() {
      var ws = profileWaiters;
      profileWaiters = [];
      ws.forEach(function(cb) {
        cb();
      });
    }
    function viewProfileByHandle(handle) {
      crumb([["Community", "community.html"], ["Profile"]]);
      var status = el("p", "comments-status", "Loading profile...");
      section.appendChild(status);
      fetchRetry(API + "/profile?handle=" + encodeURIComponent(handle) + freshParam("&"), freshOpts(), [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        section.textContent = "";
        if (!d.ok || !d.profile || !d.profile.hash) {
          section.appendChild(el("p", "comments-status", "No such profile."));
          return;
        }
        viewProfile(d.profile.hash);
      }).catch(function() {
        status.textContent = "The profile could not be loaded. Check your connection and reload the page.";
      });
    }
    function viewProfile(hash) {
      if (window.mcViews && window.mcViews.profile) return window.mcViews.profile(section, window.mcKit, hash);
      document.title = "Profile | Community";
      crumb([["Community", "community.html"], ["Profile"]]);
      if (!/^[0-9a-f]{64}$/.test(String(hash))) {
        section.appendChild(el("p", "comments-status", "No such profile."));
        return;
      }
      var editable = !!state.key && hash === state.myHash;
      var card = el("div", "profile");
      section.appendChild(card);
      var status = el("p", "comments-status", "Loading profile...");
      section.appendChild(status);
      if (editable) {
        section.appendChild(el("div", "ts-slot"));
        loadTurnstile();
      }
      fetchRetry(API + "/profile?hash=" + hash + freshParam("&"), freshOpts(), [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        status.remove();
        renderProfile(card, d.profile, editable);
        if (!editable && isAdmin()) adminProfileEditor(card, hash, d.profile || {});
      }).catch(function() {
        status.textContent = "The profile could not be loaded. Check your connection and reload the page.";
      });
    }
    function profileLimits() {
      return window.mcCore && window.mcCore.profileLimits || { nick: 40, bio: 500, sig: 200 };
    }
    function adminProfileEditor(card, hash, prof) {
      var slot = el("div", "profile-admin-edit");
      var open = el("a", "identity-action", "Edit this profile (admin)");
      open.href = "#";
      slot.appendChild(open);
      card.appendChild(slot);
      open.addEventListener("click", function(e) {
        e.preventDefault();
        slot.textContent = "";
        function field(label, value, max, tag) {
          slot.appendChild(el("div", "profile-label", label));
          var inp = el(tag || "input", "key-input");
          if (!tag) inp.type = "text";
          inp.value = value || "";
          inp.maxLength = max;
          slot.appendChild(inp);
          return inp;
        }
        var PLIM = profileLimits();
        var nick = field("Nickname", prof.nick, PLIM.nick);
        var bio = field("Bio", prof.bio, PLIM.bio, "textarea");
        var sig = field("Signature", prof.signature, PLIM.sig, "textarea");
        var avRow = el("label", "profile-label");
        var avChk = el("input");
        avChk.type = "checkbox";
        avRow.appendChild(avChk);
        avRow.appendChild(document.createTextNode(" Remove their avatar"));
        slot.appendChild(avRow);
        var note = el("p", "comments-status", "");
        var save = el("button", "btn btn-send", "Save (admin)");
        var cancel = el("a", "identity-action", "Cancel");
        cancel.href = "#";
        slot.appendChild(save);
        slot.appendChild(document.createTextNode(" "));
        slot.appendChild(cancel);
        slot.appendChild(note);
        cancel.addEventListener("click", function(ev) {
          ev.preventDefault();
          location.reload();
        });
        save.addEventListener("click", function() {
          save.disabled = true;
          note.textContent = "Saving\u2026";
          fetchRetry(API + "/profile/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: state.key,
              hash,
              nick: nick.value,
              bio: bio.value,
              signature: sig.value,
              clear_avatar: avChk.checked
            })
          }, [1e3]).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (d.ok) {
              location.reload();
              return;
            }
            save.disabled = false;
            note.textContent = "Could not save: " + (d.error || "try again.");
          }).catch(function() {
            save.disabled = false;
            note.textContent = "Network hiccup. Try again.";
          });
        });
      });
    }
    function renderProfilePosts(card, hash) {
      card.appendChild(el("h3", "profile-label", "Recent Community Posts"));
      var wrap = el("div", "profile-posts");
      card.appendChild(wrap);
      var toggle = el("button", "btn btn-anon profile-posts-toggle", "Show recent posts");
      toggle.type = "button";
      wrap.appendChild(toggle);
      var panel = el("div", "profile-posts-panel");
      panel.style.display = "none";
      wrap.appendChild(panel);
      var loaded = false;
      var list, pagerHost;
      var st = { page: 1 };
      function draw() {
        list.textContent = "Loading...";
        pagerHost.textContent = "";
        fetchRetry(API + "/board/author?hash=" + hash + "&p=" + st.page + freshParam("&"), freshOpts(), [1e3, 3e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) throw new Error("failed");
          list.textContent = "";
          if (!d.items.length) {
            list.appendChild(el("p", "comments-status", st.page > 1 ? "No more posts." : "No forum posts yet."));
            return;
          }
          d.items.forEach(function(it) {
            var row = el("div", "board-topic");
            var left = el("div", "board-topic-left");
            var a = el("a", "board-topic-title", it.title || "a thread");
            a.href = "community.html?topic=" + it.topic_id + "#comment-" + it.comment_id;
            left.appendChild(a);
            if (it.snippet) left.appendChild(el("div", "board-intro", it.snippet));
            row.appendChild(left);
            var ce = catByKey(it.cat);
            row.appendChild(el("div", "board-stats", (ce ? ce[1] : it.cat) + " \xB7 " + fmtDateTime(it.created_at)));
            list.appendChild(row);
          });
          var bar = pageBar(d.total, d.per, d.page, null, function(n) {
            st.page = n;
            draw();
            window.scrollTo(0, 0);
          });
          if (bar) pagerHost.appendChild(bar);
        }).catch(function() {
          list.textContent = "";
          list.appendChild(el("p", "comments-status", "Recent posts could not be loaded."));
        });
      }
      toggle.addEventListener("click", function(e) {
        e.preventDefault();
        if (panel.style.display === "none") {
          panel.style.display = "";
          toggle.textContent = "Hide recent posts";
          if (!loaded) {
            loaded = true;
            list = el("div", "board-topics");
            panel.appendChild(list);
            pagerHost = el("div");
            panel.appendChild(pagerHost);
            draw();
          }
        } else {
          panel.style.display = "none";
          toggle.textContent = "Show recent posts";
        }
      });
    }
    var SOCIAL_SVG = {
      website: "M3.9 12a4.1 4.1 0 014.1-4.1h3v1.9h-3a2.2 2.2 0 000 4.4h3v1.9h-3A4.1 4.1 0 013.9 12zm5.6 1h5v-2h-5v2zm3.5-5.1h3a4.1 4.1 0 010 8.2h-3v-1.9h3a2.2 2.2 0 000-4.4h-3v-1.9z",
      x: "M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932zm-1.29 19.49h2.039L6.486 3.24H4.298z",
      facebook: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
      instagram: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
      tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
    };
    function ensureSocialStyles() {
      if (document.getElementById("mc-social-css")) return;
      var s = el("style");
      s.id = "mc-social-css";
      s.textContent = ".profile-socials{display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.5rem 0 0.3rem}.profile-social{display:inline-flex;align-items:center;justify-content:center;width:2.3rem;height:2.3rem;border-radius:50%;border:1px solid var(--rule);color:var(--maroon);text-decoration:none;transition:background .12s,border-color .12s}.profile-social:hover{background:var(--cream);border-color:var(--maroon)}.mc-social-svg{display:block}.profile-link-row{margin:0 0 0.55rem}.profile-link-plat{display:inline-flex;align-items:center;gap:0.35rem;font-size:0.85rem;color:var(--muted);margin:0 0 0.15rem}.profile-link-plat .mc-social-svg{width:1rem;height:1rem}";
      document.head.appendChild(s);
    }
    function mcSocialIcon(name) {
      ensureSocialStyles();
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", "mc-social-svg");
      var path = document.createElementNS(NS, "path");
      path.setAttribute("d", SOCIAL_SVG[name] || SOCIAL_SVG.website);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
      return svg;
    }
    var SOCIAL_ORDER = ["website", "x", "facebook", "instagram", "tiktok"];
    var SOCIAL_LABEL = { website: "Website", x: "X (Twitter)", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };
    function renderProfile(card, p, editable) {
      card.textContent = "";
      var headRow = el("div", "profile-head");
      var avatar = el("div", "profile-avatar");
      if (p.avatar) {
        var img = el("img");
        img.src = API + "/avatar?hash=" + p.hash + "&v=" + encodeURIComponent(p.avatar);
        img.alt = "";
        img.width = 72;
        img.height = 72;
        avatar.appendChild(img);
      }
      headRow.appendChild(avatar);
      var names = el("div", "profile-names");
      names.appendChild(el("div", "profile-name", p.nick || p.assigned));
      if (p.nick) names.appendChild(el("div", "profile-assigned", p.assigned));
      if (p.handle) names.appendChild(el("div", "profile-assigned profile-handle", "@" + p.handle));
      if (p.admin) names.appendChild(el("span", "comment-admin", "(admin)"));
      var faithCode = p.faith || (p.hash === state.myHash ? getFaith() : "");
      var pfl = faithCode && faithLabel(faithCode);
      if (pfl) names.appendChild(el("div", "profile-faith", "I hold to: " + pfl));
      if (p.posts != null) names.appendChild(el("div", "profile-faith profile-rank", rankLine(Number(p.posts) || 0)));
      headRow.appendChild(names);
      card.appendChild(headRow);
      var shareUrl = location.origin + (p.handle ? "/@" + p.handle : "/" + profileHref(p.hash));
      var shareLink = el("button", "btn btn-anon profile-share", "\u{1F517} Share profile");
      shareLink.type = "button";
      shareLink.addEventListener("click", function(e) {
        e.preventDefault();
        var done = function() {
          var was = shareLink.textContent;
          shareLink.textContent = "\u2713 Link copied";
          setTimeout(function() {
            shareLink.textContent = was;
          }, 2e3);
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(done).catch(function() {
              window.prompt("Copy this link:", shareUrl);
            });
          } else {
            window.prompt("Copy this link:", shareUrl);
          }
        } catch (err) {
          window.prompt("Copy this link:", shareUrl);
        }
      });
      card.appendChild(shareLink);
      if (p.links && typeof p.links === "object") {
        var socials = el("div", "profile-socials");
        SOCIAL_ORDER.forEach(function(plat) {
          var url = p.links[plat];
          if (!url || typeof url !== "string") return;
          var a = el("a", "profile-social");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener nofollow noreferrer";
          a.title = SOCIAL_LABEL[plat] || plat;
          a.appendChild(mcSocialIcon(plat));
          socials.appendChild(a);
        });
        if (socials.firstChild) card.appendChild(socials);
      }
      if (p.bio) {
        card.appendChild(el("h3", "profile-label", "Bio"));
        card.appendChild(el("p", "profile-bio", p.bio));
      } else if (!editable) {
        card.appendChild(el("p", "profile-bio profile-empty", "No bio yet."));
      }
      if (p.signature) {
        card.appendChild(el("h3", "profile-label", "Signature"));
        card.appendChild(el("div", "comment-sig", p.signature));
      }
      if (editable) {
        var edit = el("button", "btn btn-send", "Edit profile");
        edit.type = "button";
        edit.addEventListener("click", function() {
          editProfile(card, p);
        });
        card.appendChild(edit);
      } else if (isMember() && p.hash !== state.myHash) {
        if (p.hash !== MERECAT_BOT_HASH) {
          var dmBtn = el("button", "btn btn-send", "Send a Direct Message");
          dmBtn.type = "button";
          dmBtn.addEventListener("click", function() {
            location.href = "messages.html?dm=" + p.hash;
          });
          card.appendChild(dmBtn);
          var muteBtn = el("button", "btn btn-anon", isMuted(p.hash) ? "Unmute this member" : "Mute this member");
          muteBtn.type = "button";
          muteBtn.addEventListener("click", function() {
            toggleMute(p.hash);
            muteBtn.textContent = isMuted(p.hash) ? "Unmute this member" : "Mute this member";
          });
          card.appendChild(muteBtn);
        }
      }
      renderProfilePosts(card, p.hash);
      renderProfileWall(card, p.hash, editable);
      annotateProfileMeta(p.hash, card);
    }
    function editProfile(card, p) {
      card.textContent = "";
      card.appendChild(el(
        "p",
        "key-note",
        "Your assigned name " + p.assigned + " always stays as your identifier. A custom nickname simply shows first."
      ));
      var chosenFaith = p.faith || (p.hash === state.myHash ? getFaith() : "") || "";
      card.appendChild(faithRadios(chosenFaith, function(code) {
        chosenFaith = code;
      }));
      var PLIM = profileLimits();
      card.appendChild(el("label", "profile-label", "Nickname (up to " + PLIM.nick + " characters)"));
      var nickIn = el("input", "key-input");
      nickIn.type = "text";
      nickIn.maxLength = PLIM.nick;
      nickIn.placeholder = p.assigned;
      nickIn.value = p.nick || "";
      card.appendChild(nickIn);
      card.appendChild(el("label", "profile-label", "Bio (up to " + PLIM.bio + " characters)"));
      var bioIn = el("textarea", "comment-text");
      bioIn.maxLength = PLIM.bio;
      bioIn.rows = 4;
      bioIn.value = p.bio || "";
      card.appendChild(bioIn);
      card.appendChild(el("label", "profile-label", "Signature (up to " + PLIM.sig + " characters)"));
      var sigIn = el("textarea", "comment-text");
      sigIn.maxLength = PLIM.sig;
      sigIn.rows = 2;
      sigIn.value = p.signature || "";
      card.appendChild(sigIn);
      function handleErrText(tag) {
        switch (tag) {
          case "too_short":
            return "Too short \u2014 3 to 30 characters.";
          case "too_long":
            return "Too long \u2014 3 to 30 characters.";
          case "bad_chars":
            return "Use only lowercase letters, numbers, and underscore.";
          case "bad_start":
            return "Must start with a letter.";
          case "bad_underscore":
            return "Cannot end with, or repeat, an underscore.";
          case "reserved":
            return "That handle is reserved.";
          default:
            return "That handle is not allowed.";
        }
      }
      card.appendChild(el("label", "profile-label", "Profile link \u2014 your @handle (optional)"));
      var handleIn = el("input", "key-input");
      handleIn.type = "text";
      handleIn.maxLength = window.mcCore && window.mcCore.handleMax || 30;
      handleIn.placeholder = "e.g. john_smith";
      handleIn.value = p.handle || "";
      handleIn.autocapitalize = "none";
      handleIn.autocomplete = "off";
      handleIn.spellcheck = false;
      card.appendChild(handleIn);
      var handleHint = el("p", "profile-empty");
      card.appendChild(handleHint);
      function updateHandleHint() {
        var raw = handleIn.value.trim();
        handleHint.style.color = "";
        if (!raw) {
          handleHint.textContent = "No handle set \u2014 your link stays the default.";
          return;
        }
        if (window.mcCore && window.mcCore.handleValidate) {
          var v = window.mcCore.handleValidate(raw);
          if (v.ok) {
            handleHint.textContent = "Your link: merecatholicity.com/@" + v.handle;
          } else {
            handleHint.textContent = handleErrText(v.error);
            handleHint.style.color = "#a3324a";
          }
        } else {
          handleHint.textContent = "Your link: merecatholicity.com/@" + raw.toLowerCase();
        }
      }
      handleIn.addEventListener("input", updateHandleHint);
      updateHandleHint();
      card.appendChild(el("label", "profile-label", "Links (optional) \u2014 your website and socials"));
      var linkInputs = {};
      SOCIAL_ORDER.forEach(function(plat) {
        var row2 = el("div", "profile-link-row");
        var lab = el("span", "profile-link-plat");
        lab.appendChild(mcSocialIcon(plat));
        lab.appendChild(document.createTextNode(" " + (SOCIAL_LABEL[plat] || plat)));
        row2.appendChild(lab);
        var inp = el("input", "key-input");
        inp.type = "text";
        inp.autocapitalize = "none";
        inp.autocomplete = "off";
        inp.spellcheck = false;
        inp.placeholder = plat === "website" ? "https://your-site.com" : "your handle, or a full URL";
        inp.value = p.links && p.links[plat] || "";
        row2.appendChild(inp);
        var lhint = el("p", "profile-empty");
        row2.appendChild(lhint);
        function updLink() {
          var raw = inp.value.trim();
          lhint.style.color = "";
          if (!raw) {
            lhint.textContent = "";
            return;
          }
          if (window.mcCore && window.mcCore.linkNormalize) {
            var n = window.mcCore.linkNormalize(plat, raw);
            if (n.ok && n.url) {
              lhint.textContent = "\u2192 " + n.url;
            } else {
              lhint.textContent = "Use a handle or an https:// link.";
              lhint.style.color = "#a3324a";
            }
          }
        }
        inp.addEventListener("input", updLink);
        updLink();
        linkInputs[plat] = inp;
        card.appendChild(row2);
      });
      card.appendChild(el("label", "profile-label", "Avatar"));
      var avNote = el("p", "profile-empty", "");
      function pushAvatar(img, mode) {
        var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        if (!iw || !ih) {
          avNote.textContent = "That image could not be read. Try another.";
          return;
        }
        var AV = 512;
        var c = document.createElement("canvas");
        c.width = AV;
        c.height = AV;
        var ctx = c.getContext("2d");
        if (mode === "contain") {
          ctx.fillStyle = "#faf6ee";
          ctx.fillRect(0, 0, AV, AV);
          var box = AV * 0.82;
          var s = Math.min(box / iw, box / ih);
          var cw = iw * s, ch = ih * s;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, (AV - cw) / 2, (AV - ch) / 2, cw, ch);
        } else {
          var scale = Math.max(AV / iw, AV / ih);
          var w = iw * scale, h = ih * scale;
          ctx.drawImage(img, (AV - w) / 2, (AV - h) / 2, w, h);
        }
        var send = function(blob) {
          if (!blob || blob.size > 1024 * 1024) {
            avNote.textContent = "The image could not be brought under 1 MB. Try another.";
            return;
          }
          avNote.textContent = "Verifying...";
          getToken().then(function(token) {
            avNote.textContent = "Checking image...";
            var fd = new FormData();
            fd.append("key", state.key);
            fd.append("token", token);
            fd.append("avatar", blob, "avatar");
            return fetchRetry(API + "/avatar", { method: "POST", body: fd }, [1500]).then(function(r) {
              return r.json();
            });
          }).then(function(d) {
            if (!d.ok) throw new Error(d.error || "Could not upload the avatar.");
            stampFresh();
            p.avatar = d.avatar;
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
            editProfile(card, p);
          }).catch(function(err) {
            avNote.textContent = err.message || "Network error. Try again in a moment.";
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        };
        c.toBlob(function(blob) {
          if (blob && blob.size <= 1024 * 1024) return send(blob);
          c.toBlob(send, "image/jpeg", 0.7);
        }, "image/jpeg", 0.85);
      }
      var avRow = el("div", "key-row");
      var avPick = el("input");
      avPick.type = "file";
      avPick.accept = ".jpg,.jpeg,image/jpeg";
      avRow.appendChild(avPick);
      card.appendChild(avRow);
      avPick.addEventListener("change", function() {
        var file = avPick.files && avPick.files[0];
        if (!file) return;
        avNote.textContent = "Preparing image...";
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onerror = function() {
          URL.revokeObjectURL(url);
          avNote.textContent = "That file is not a usable image.";
        };
        img.onload = function() {
          URL.revokeObjectURL(url);
          pushAvatar(img, "cover");
        };
        img.src = url;
      });
      var galBtn = el("button", "btn btn-anon btn-gallery", "Choose from the gallery");
      galBtn.type = "button";
      var gallery = buildAvatarGallery(function(path) {
        gallery.closePanel();
        galBtn.textContent = "Choose from the gallery";
        avNote.textContent = "Preparing image...";
        var pim = new Image();
        pim.onerror = function() {
          avNote.textContent = "That gallery image could not be loaded. Try another.";
        };
        pim.onload = function() {
          pushAvatar(pim, "contain");
        };
        pim.src = path;
      });
      galBtn.addEventListener("click", function() {
        gallery.toggle();
        galBtn.textContent = gallery.hidden ? "Choose from the gallery" : "Hide the gallery";
      });
      card.appendChild(galBtn);
      card.appendChild(gallery);
      card.appendChild(el(
        "p",
        "profile-empty",
        "Upload a JPEG (cropped to a square, 1 MB at most) or pick a ready-made from the gallery. " + (p.avatar ? "Either choice replaces your current avatar." : "")
      ));
      card.appendChild(avNote);
      if (p.avatar) {
        var avPrev = el("div", "profile-avatar");
        var avPrevImg = el("img");
        avPrevImg.src = API + "/avatar?hash=" + p.hash + "&v=" + encodeURIComponent(p.avatar);
        avPrevImg.alt = "";
        avPrev.appendChild(avPrevImg);
        card.appendChild(avPrev);
        var avDel = el("a", "identity-action", "Remove avatar");
        avDel.href = "#";
        avDel.addEventListener("click", function(e) {
          e.preventDefault();
          appConfirm("Remove your avatar?", { okLabel: "Remove", danger: true }, function(ok) {
            if (!ok) return;
            fetchRetry(API + "/avatar/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key })
            }, [1500]).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (!d.ok) throw new Error(d.error || "Could not remove it.");
              stampFresh();
              p.avatar = null;
              editProfile(card, p);
            }).catch(function(err) {
              avNote.textContent = err.message;
            });
          });
        });
        card.appendChild(avDel);
      }
      var row = el("div", "comment-buttons");
      var save = el("button", "btn btn-send", "Save");
      save.type = "button";
      row.appendChild(save);
      card.appendChild(row);
      var note = el("p", "form-status");
      card.appendChild(note);
      card.appendChild(identityAction("Cancel", function() {
        renderProfile(card, p, true);
      }));
      save.addEventListener("click", function() {
        save.disabled = true;
        note.textContent = "Verifying...";
        getToken().then(function(token) {
          note.textContent = "Saving...";
          return fetchRetry(API + "/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: state.key,
              nick: nickIn.value,
              bio: bioIn.value,
              signature: sigIn.value,
              faith: chosenFaith,
              handle: handleIn.value,
              links: { website: linkInputs.website.value, x: linkInputs.x.value, facebook: linkInputs.facebook.value, instagram: linkInputs.instagram.value, tiktok: linkInputs.tiktok.value },
              token
            })
          }, [1500], function() {
            note.textContent = "Network hiccup, retrying...";
          }).then(function(r) {
            return r.json();
          });
        }).then(function(d) {
          if (!d.ok) throw new Error(d.error || "Could not save.");
          stampFresh();
          state.myNick = d.profile.nick || "";
          if (d.profile.faith) setFaith(d.profile.faith);
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          renderProfile(card, d.profile, true);
        }).catch(function(err) {
          note.textContent = err.message || "Network error. Try again in a moment.";
          save.disabled = false;
          if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
        });
      });
    }
    function dmLabel(hash, nick) {
      var assigned = displayName(hash);
      return nick ? nick + " (" + assigned + ")" : assigned;
    }
    function dmScore(q, name) {
      if (!name) return 0;
      var n = String(name).toLowerCase();
      if (n.indexOf(q) === 0) return 100;
      var words = n.split(/[\s-]+/);
      for (var i = 0; i < words.length; i++) if (words[i].indexOf(q) === 0) return 80;
      if (n.indexOf(q) !== -1) return 60;
      var j = 0;
      for (var k = 0; k < n.length && j < q.length; k++) if (n[k] === q[j]) j++;
      return j === q.length ? 30 : 0;
    }
    function dmSearchBox() {
      var box = el("div", "key-box dm-search");
      box.hidden = false;
      box.appendChild(el("p", "key-note", "Send a direct message. Type a nickname or an assigned name, then click the member below to open the conversation."));
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "text";
      input.placeholder = "e.g. Constant-Almond, or a nickname";
      row.appendChild(input);
      box.appendChild(row);
      var sug = el("div", "dm-suggest");
      sug.hidden = true;
      box.appendChild(sug);
      var note = el("p", "form-status");
      box.appendChild(note);
      var dir = null;
      var loading = false;
      var current = [];
      var sel = 0;
      var timer = null;
      function ensureDir(cb) {
        if (dir) return cb();
        if (loading) return;
        loading = true;
        fetch(API + "/dm/directory" + freshParam("?")).then(function(r) {
          return r.json();
        }).then(function(d) {
          loading = false;
          if (d.ok) {
            dir = d.users;
            cb();
          }
        }).catch(function() {
          loading = false;
          note.textContent = "The member list could not be loaded.";
        });
      }
      function renderSug() {
        sug.textContent = "";
        if (!current.length) {
          sug.hidden = true;
          return;
        }
        current.forEach(function(u, i) {
          var r = el("a", "dm-suggest-row" + (i === sel ? " dm-suggest-sel" : ""));
          r.href = "messages.html?dm=" + u.hash;
          r.title = "Open the conversation";
          r.appendChild(el("span", null, dmLabel(u.hash, u.nick)));
          r.appendChild(el("span", "dm-suggest-go", "message \u2192"));
          r.addEventListener("mousedown", function(e) {
            e.preventDefault();
            location.href = "messages.html?dm=" + u.hash;
          });
          sug.appendChild(r);
        });
        sug.hidden = false;
      }
      function suggest() {
        var q = input.value.trim().toLowerCase();
        if (q.length < 3) {
          current = [];
          renderSug();
          return;
        }
        ensureDir(function() {
          current = dir.filter(function(u) {
            return u.hash !== state.myHash;
          }).map(function(u) {
            var s = Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash)));
            return { u, s, label: dmLabel(u.hash, u.nick) };
          }).filter(function(x) {
            return x.s > 0;
          }).sort(function(x, y) {
            return y.s - x.s || (x.label < y.label ? -1 : 1);
          }).slice(0, 8).map(function(x) {
            return x.u;
          });
          sel = 0;
          note.textContent = current.length ? "" : "No member matches that. Pick from the suggestions.";
          renderSug();
        });
      }
      input.addEventListener("input", function() {
        clearTimeout(timer);
        timer = setTimeout(suggest, 150);
      });
      input.addEventListener("keydown", function(e) {
        if (sug.hidden) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          sel = Math.min(sel + 1, current.length - 1);
          renderSug();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          sel = Math.max(sel - 1, 0);
          renderSug();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (current[sel]) location.href = "messages.html?dm=" + current[sel].hash;
        } else if (e.key === "Escape") {
          current = [];
          renderSug();
        }
      });
      input.addEventListener("blur", function() {
        setTimeout(function() {
          current = [];
          renderSug();
        }, 200);
      });
      return box;
    }
    var mentionDir = null, mentionDirLoading = false;
    var pendingMentions = [];
    function ensureMentionDir(cb) {
      if (mentionDir) return cb();
      if (mentionDirLoading) return;
      mentionDirLoading = true;
      fetch(API + "/dm/directory" + freshParam("?")).then(function(r) {
        return r.json();
      }).then(function(d) {
        mentionDirLoading = false;
        if (d.ok) {
          mentionDir = d.users;
          cb();
        }
      }).catch(function() {
        mentionDirLoading = false;
      });
    }
    function collectMentions(text) {
      if (window.mcCore) return window.mcCore.mentionsIn(text, pendingMentions);
      var out = [];
      for (var i = 0; i < pendingMentions.length; i++) {
        var m = pendingMentions[i];
        if (text.indexOf(m.token) > -1 && out.indexOf(m.hash) === -1) out.push(m.hash);
      }
      return out;
    }
    function attachMentions(textarea) {
      if (!textarea || textarea.dataset.mentions) return;
      textarea.dataset.mentions = "1";
      pendingMentions = [];
      var sug = el("div", "mention-suggest");
      sug.hidden = true;
      textarea.parentNode.insertBefore(sug, textarea.nextSibling);
      var current = [], sel = 0, at = -1, timer = null;
      function scan() {
        var caret = textarea.selectionStart;
        var m = /(^|\s)@([^\s@]{1,30})$/.exec(textarea.value.slice(0, caret));
        if (!m) {
          current = [];
          at = -1;
          sug.hidden = true;
          return;
        }
        at = caret - m[2].length - 1;
        var q = m[2].toLowerCase();
        ensureMentionDir(function() {
          current = mentionDir.filter(function(u) {
            return u.hash !== state.myHash;
          }).map(function(u) {
            return { u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) };
          }).filter(function(x) {
            return x.s > 0;
          }).sort(function(x, y) {
            return y.s - x.s || (x.label < y.label ? -1 : 1);
          }).slice(0, 8).map(function(x) {
            return x.u;
          });
          if (dmScore(q, "merecat") > 0) {
            current = [{ bot: true, nick: "merecat" }].concat(current).slice(0, 8);
          }
          sel = 0;
          render();
        });
      }
      function render() {
        sug.textContent = "";
        if (!current.length) {
          sug.hidden = true;
          return;
        }
        current.forEach(function(u, i) {
          var r = el("a", "dm-suggest-row" + (i === sel ? " dm-suggest-sel" : ""));
          r.href = "#";
          r.appendChild(el("span", null, u.bot ? "merecat \xB7 AI BOT \u{1F408}" : dmLabel(u.hash, u.nick)));
          r.appendChild(el("span", "dm-suggest-go", u.bot ? "ask the librarian" : "mention"));
          r.addEventListener("mousedown", function(e) {
            e.preventDefault();
            pick(u);
          });
          sug.appendChild(r);
        });
        sug.hidden = false;
      }
      function pick(u) {
        if (at < 0) return;
        var caret = textarea.selectionStart;
        var token = u.bot ? "@merecat" : "@" + (u.nick || displayName(u.hash));
        var v = textarea.value;
        textarea.value = v.slice(0, at) + token + " " + v.slice(caret);
        var np = at + token.length + 1;
        try {
          textarea.setSelectionRange(np, np);
        } catch (e) {
        }
        if (!u.bot && !pendingMentions.some(function(m) {
          return m.hash === u.hash && m.token === token;
        })) {
          pendingMentions.push({ hash: u.hash, token });
        }
        current = [];
        at = -1;
        sug.hidden = true;
        afterEdit(textarea);
      }
      textarea.addEventListener("input", function() {
        clearTimeout(timer);
        timer = setTimeout(scan, 120);
      });
      textarea.addEventListener("keydown", function(e) {
        if (sug.hidden || !current.length) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          sel = Math.min(sel + 1, current.length - 1);
          render();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          sel = Math.max(sel - 1, 0);
          render();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (current[sel]) pick(current[sel]);
        } else if (e.key === "Escape") {
          current = [];
          sug.hidden = true;
        }
      });
      textarea.addEventListener("blur", function() {
        setTimeout(function() {
          sug.hidden = true;
        }, 200);
      });
    }
    function viewUsers() {
      if (window.mcViews && window.mcViews.users) return window.mcViews.users(section, window.mcKit);
      document.title = "Members | Community";
      crumb([["Community", "community.html"], ["Members"]]);
      section.appendChild(el(
        "p",
        "board-intro",
        "Everyone on the board, newest first. Search by nickname or assigned name to find who is who, then open a profile."
      ));
      var searchRow = el("div", "key-row");
      var search = el("input", "key-input");
      search.type = "text";
      search.placeholder = "Search members by name...";
      searchRow.appendChild(search);
      section.appendChild(searchRow);
      var count = el("p", "comments-status", "Loading members...");
      section.appendChild(count);
      var list = el("div", "user-list");
      section.appendChild(list);
      var pagerHost = el("div");
      section.appendChild(pagerHost);
      var roster = null;
      var st = { q: "", page: 1 };
      var PER = 20;
      function visible() {
        if (!st.q) return roster;
        var q = st.q.toLowerCase();
        return roster.map(function(u) {
          return { u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))) };
        }).filter(function(x) {
          return x.s > 0;
        }).sort(function(x, y) {
          return y.s - x.s;
        }).map(function(x) {
          return x.u;
        });
      }
      function draw() {
        var items = visible();
        var total = items.length;
        var pages = Math.max(1, Math.ceil(total / PER));
        if (st.page > pages) st.page = pages;
        list.textContent = "";
        if (!total) {
          count.textContent = st.q ? "No member matches that." : "No members yet.";
        } else {
          count.textContent = st.q ? total + (total === 1 ? " match" : " matches") : total + (total === 1 ? " member" : " members");
          items.slice((st.page - 1) * PER, st.page * PER).forEach(function(u) {
            var row = el("a", "user-row");
            row.href = profileHref(u.hash);
            var names = el("span", "user-names");
            if (u.nick) {
              names.appendChild(el("span", "user-nick", u.nick));
              names.appendChild(el("span", "user-assigned", displayName(u.hash)));
            } else {
              names.appendChild(el("span", "user-nick", displayName(u.hash)));
            }
            row.appendChild(names);
            row.appendChild(el("span", "user-go", "profile \u2192"));
            list.appendChild(row);
          });
        }
        pagerHost.textContent = "";
        var bar = pageBar(total, PER, st.page, null, function(n) {
          st.page = n;
          draw();
          window.scrollTo(0, 0);
        });
        if (bar) pagerHost.appendChild(bar);
      }
      var timer = null;
      search.addEventListener("input", function() {
        clearTimeout(timer);
        timer = setTimeout(function() {
          st.q = search.value.trim();
          st.page = 1;
          draw();
        }, 120);
      });
      fetchRetry(API + "/dm/directory" + freshParam("?"), freshOpts(), [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        roster = d.users || [];
        st.page = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("p")) || 1));
        draw();
      }).catch(function() {
        count.textContent = "The member list could not be loaded. Check your connection and reload the page.";
      });
    }
    function wallAvatarInto(head, hash, avatar) {
      if (!avatar || !hash) return;
      var link = el("a", "comment-avatar-link");
      link.href = profileHref(hash);
      var img = el("img", "comment-avatar");
      img.src = API + "/avatar?hash=" + hash + "&v=" + encodeURIComponent(avatar);
      img.alt = "";
      img.width = 32;
      img.height = 32;
      link.appendChild(img);
      head.appendChild(link);
    }
    function mcIcon(name) {
      var P = {
        heart: "M12 20.5S3.5 15 3.5 8.9C3.5 6.3 5.5 4.5 7.9 4.5c1.6 0 3.1.9 3.8 2.3l.3.6.3-.6c.7-1.4 2.2-2.3 3.8-2.3 2.4 0 4.4 1.8 4.4 4.4C20.5 15 12 20.5 12 20.5z",
        comment: "M20 4H4a1 1 0 00-1 1v11a1 1 0 001 1h3v4l5-4h8a1 1 0 001-1V5a1 1 0 00-1-1z",
        share: "M18 8a2.5 2.5 0 10-2.4-3.2L9 8.2a2.5 2.5 0 100 4.6l6.6 3.4A2.5 2.5 0 1018 15l-6.6-3.4a2.5 2.5 0 000-1.6L18 6.6A2.5 2.5 0 0018 8z",
        download: "M12 3v11m0 0l4.5-4.5M12 14l-4.5-4.5M4.5 19.5h15",
        copy: "M15.5 8.5v-2a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2M10.5 8.5h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2v-7a2 2 0 012-2z",
        expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
        close: "M6 6l12 12M18 6L6 18",
        x: "M18.9 2.5H22l-7.6 8.6L23 21.5h-6.9l-5.4-7-6.2 7H1.4l8.1-9.2L1 2.5h7l4.9 6.4L18.9 2.5z",
        facebook: "M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.8 3.7-3.8 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0022 12z"
      };
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("class", "mc-ic mc-ic-" + name);
      svg.setAttribute("aria-hidden", "true");
      var pth = document.createElementNS(ns, "path");
      pth.setAttribute("d", P[name] || "");
      if (name === "x" || name === "facebook") {
        pth.setAttribute("fill", "currentColor");
      } else {
        pth.setAttribute("fill", "none");
        pth.setAttribute("stroke", "currentColor");
        pth.setAttribute("stroke-width", "2");
        pth.setAttribute("stroke-linecap", "round");
        pth.setAttribute("stroke-linejoin", "round");
      }
      svg.appendChild(pth);
      return svg;
    }
    function mediaFilename(mediaKey) {
      var k = String(mediaKey).split("/")[1];
      var ext = k === "v" ? "mp4" : k === "a" ? "mp3" : "jpg";
      return "merecatholicity-" + String(mediaKey).replace(/[^a-z0-9]/gi, "").slice(-8) + "." + ext;
    }
    function mediaDownloadLink(url, filename, label, cls) {
      var a = el("a", cls || "wall-act wall-act-dl");
      a.href = url;
      a.download = filename || "download";
      a.title = "Download";
      a.setAttribute("aria-label", "Download");
      a.appendChild(mcIcon("download"));
      if (label) a.appendChild(el("span", "wall-act-lbl", label));
      a.addEventListener("click", function(e) {
        e.stopPropagation();
      });
      return a;
    }
    var mcPop = null;
    function closePop() {
      if (mcPop && mcPop.parentNode) mcPop.parentNode.removeChild(mcPop);
      mcPop = null;
      document.removeEventListener("click", popOutside, true);
      window.removeEventListener("scroll", closePop, true);
    }
    function popOutside(e) {
      if (mcPop && !mcPop.contains(e.target)) closePop();
    }
    function placePop(pop, anchor) {
      var r = anchor.getBoundingClientRect();
      pop.style.position = "absolute";
      pop.style.left = Math.max(8, Math.min(window.innerWidth - 244, r.left)) + "px";
      pop.style.top = window.scrollY + r.bottom + 6 + "px";
    }
    function showLikers(anchor, params) {
      closePop();
      var pop = el("div", "wall-pop wall-likers-pop");
      pop.appendChild(el("div", "wall-pop-load", "Loading\u2026"));
      document.body.appendChild(pop);
      mcPop = pop;
      placePop(pop, anchor);
      setTimeout(function() {
        document.addEventListener("click", popOutside, true);
        window.addEventListener("scroll", closePop, true);
      }, 0);
      fetch(API + "/wall/likers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (mcPop !== pop) return;
        pop.textContent = "";
        if (!d || !d.ok || !(d.likers && d.likers.length)) {
          pop.appendChild(el("div", "wall-pop-empty", "No likes yet"));
          return;
        }
        pop.appendChild(el("div", "wall-pop-title", "Liked by"));
        d.likers.forEach(function(u) {
          var row = el("a", "wall-likers-row");
          row.href = profileHref(u.hash);
          wallAvatarInto(row, u.hash, u.avatar);
          row.appendChild(el("span", "wall-likers-name", u.nick));
          pop.appendChild(row);
        });
        if (d.more) pop.appendChild(el("div", "wall-pop-more", "and more\u2026"));
        placePop(pop, anchor);
      }).catch(function() {
        if (mcPop === pop) {
          pop.textContent = "";
          pop.appendChild(el("div", "wall-pop-empty", "Could not load"));
        }
      });
    }
    function attachLikers(anchor, getParams) {
      var lpT = 0, hoverT = 0;
      anchor.addEventListener("mouseenter", function() {
        clearTimeout(hoverT);
        hoverT = setTimeout(function() {
          showLikers(anchor, getParams());
        }, 320);
      });
      anchor.addEventListener("mouseleave", function() {
        clearTimeout(hoverT);
      });
      anchor.addEventListener("touchstart", function() {
        clearTimeout(lpT);
        lpT = setTimeout(function() {
          showLikers(anchor, getParams());
        }, 450);
      }, { passive: true });
      anchor.addEventListener("touchend", function() {
        clearTimeout(lpT);
      }, { passive: true });
      anchor.addEventListener("touchmove", function() {
        clearTimeout(lpT);
      }, { passive: true });
      anchor.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        showLikers(anchor, getParams());
      });
    }
    function showShareMenu(anchor, shareUrl, mediaDl) {
      closePop();
      var pop = el("div", "wall-pop wall-share-pop");
      var copy = el("button", "wall-share-item");
      copy.type = "button";
      copy.appendChild(mcIcon("copy"));
      var cl = el("span", null, "Copy link");
      copy.appendChild(cl);
      copy.addEventListener("click", function(e) {
        e.stopPropagation();
        var done = function() {
          cl.textContent = "Copied \u2713";
          setTimeout(function() {
            cl.textContent = "Copy link";
          }, 1400);
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareUrl).then(done).catch(function() {
            window.prompt("Copy this link:", shareUrl);
          });
          else window.prompt("Copy this link:", shareUrl);
        } catch (err) {
          window.prompt("Copy this link:", shareUrl);
        }
      });
      pop.appendChild(copy);
      if (mediaDl) {
        pop.appendChild(mediaDownloadLink(mediaDl.url, mediaDl.filename, "Download", "wall-share-item"));
      }
      var xa = el("a", "wall-share-item");
      xa.href = "https://twitter.com/intent/tweet?url=" + encodeURIComponent(shareUrl);
      xa.target = "_blank";
      xa.rel = "noopener noreferrer";
      xa.appendChild(mcIcon("x"));
      xa.appendChild(el("span", null, "X"));
      xa.addEventListener("click", function(e) {
        e.stopPropagation();
      });
      pop.appendChild(xa);
      var fb = el("a", "wall-share-item");
      fb.href = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(shareUrl);
      fb.target = "_blank";
      fb.rel = "noopener noreferrer";
      fb.appendChild(mcIcon("facebook"));
      fb.appendChild(el("span", null, "Facebook"));
      fb.addEventListener("click", function(e) {
        e.stopPropagation();
      });
      pop.appendChild(fb);
      if (navigator.share) {
        var na = el("button", "wall-share-item");
        na.type = "button";
        na.appendChild(mcIcon("share"));
        na.appendChild(el("span", null, "More\u2026"));
        na.addEventListener("click", function(e) {
          e.stopPropagation();
          navigator.share({ url: shareUrl, title: "A post on Mere Catholicity" }).catch(function() {
          });
          closePop();
        });
        pop.appendChild(na);
      }
      document.body.appendChild(pop);
      mcPop = pop;
      placePop(pop, anchor);
      setTimeout(function() {
        document.addEventListener("click", popOutside, true);
        window.addEventListener("scroll", closePop, true);
      }, 0);
    }
    function wallActions(post2) {
      var likeN = Number(post2.likes) || 0, liked = !!post2.liked, gen = 0, cn = Number(post2.comments) || 0;
      var box = el("div", "wall-actions");
      var summary = el("div", "wall-summary");
      var likeSum = el("button", "wall-sum-likes");
      likeSum.type = "button";
      likeSum.appendChild(mcIcon("heart"));
      var likeSumN = el("span", "wall-sum-n");
      likeSum.appendChild(likeSumN);
      var cmtSum = el("button", "wall-sum-comments");
      cmtSum.type = "button";
      summary.appendChild(likeSum);
      summary.appendChild(cmtSum);
      attachLikers(likeSum, function() {
        return { post: post2.id };
      });
      var btns = el("div", "wall-btnrow");
      var likeBtn = el("button", "wall-act wall-like");
      likeBtn.type = "button";
      likeBtn.appendChild(mcIcon("heart"));
      likeBtn.appendChild(el("span", "wall-act-lbl", "Like"));
      var cmtBtn = el("button", "wall-act");
      cmtBtn.type = "button";
      cmtBtn.appendChild(mcIcon("comment"));
      cmtBtn.appendChild(el("span", "wall-act-lbl", "Comment"));
      var shareBtn = el("button", "wall-act");
      shareBtn.type = "button";
      shareBtn.appendChild(mcIcon("share"));
      shareBtn.appendChild(el("span", "wall-act-lbl", "Share"));
      btns.appendChild(likeBtn);
      btns.appendChild(cmtBtn);
      btns.appendChild(shareBtn);
      function render() {
        likeBtn.classList.toggle("on", liked);
        likeBtn.title = liked ? "Unlike" : "Like";
        likeSum.classList.toggle("on", liked);
        likeSumN.textContent = likeN > 0 ? String(likeN) : "";
        likeSum.style.display = likeN > 0 ? "" : "none";
        cmtSum.textContent = cn > 0 ? cn === 1 ? "1 comment" : cn + " comments" : "";
        cmtSum.style.display = cn > 0 ? "" : "none";
        summary.style.display = likeN > 0 || cn > 0 ? "" : "none";
      }
      likeBtn.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!state.myHash) {
          if (window.mcOnboard) window.mcOnboard();
          return;
        }
        var want = !liked, myGen = ++gen;
        liked = want;
        likeN = Math.max(0, likeN + (want ? 1 : -1));
        render();
        fetch(API + "/wall/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: state.key, post: post2.id, like: want }) }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (myGen !== gen) return;
          if (d && d.ok) {
            liked = !!d.liked;
            likeN = Number(d.likes) || 0;
          } else {
            liked = !want;
            likeN = Math.max(0, likeN + (want ? -1 : 1));
          }
          render();
        }).catch(function() {
          if (myGen !== gen) return;
          liked = !want;
          likeN = Math.max(0, likeN + (want ? -1 : 1));
          render();
        });
      });
      box.appendChild(summary);
      box.appendChild(btns);
      render();
      return { el: box, likeBtn, cmtBtn, shareBtn, cmtSum, bumpComment: function(d) {
        cn = Math.max(0, cn + d);
        render();
      } };
    }
    function wallCommentsSection(post2, onCount) {
      var wrap = el("div", "wall-comments");
      var list = el("div", "wall-comment-list");
      wrap.appendChild(list);
      var loaded = false;
      function load2() {
        if (loaded) return;
        loaded = true;
        list.appendChild(el("p", "comments-status", "Loading\u2026"));
        fetch(API + "/wall/post/get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: state.key || "", id: post2.id }) }).then(function(r) {
          return r.json();
        }).then(function(d) {
          list.textContent = "";
          if (!d || !d.ok) {
            list.appendChild(el("p", "comments-status", "Could not load comments."));
            return;
          }
          (d.comments || []).forEach(function(c) {
            list.appendChild(wallCommentNode(c, post2));
          });
          if (state.myHash) wrap.appendChild(wallComposer("comment", { post: post2.id }, function(added) {
            if (added) {
              list.appendChild(wallCommentNode(added, post2));
              if (onCount) onCount(1);
            }
          }));
          else wrap.appendChild(loginToInteract("comment on this post"));
        }).catch(function() {
          list.textContent = "";
          list.appendChild(el("p", "comments-status", "Could not load comments."));
        });
      }
      return { wrap, load: load2 };
    }
    function openMedia(mediaKey, kind, post2) {
      closePop();
      var src = API + "/wall/media?key=" + encodeURIComponent(mediaKey);
      var ov = el("div", "wall-lightbox" + (post2 ? "" : " wall-lightbox-bare"));
      var inner = el("div", "wall-lb-inner");
      var stage = el("div", "wall-lb-stage");
      var mel;
      if (kind === "v") {
        mel = el("video", "wall-lb-media");
        mel.src = src;
        mel.controls = true;
        mel.autoplay = true;
        mel.playsInline = true;
      } else if (kind === "a") {
        mel = el("audio", "wall-lb-media wall-lb-audio");
        mel.src = src;
        mel.controls = true;
        mel.autoplay = true;
      } else {
        mel = el("img", "wall-lb-media");
        mel.src = src;
        mel.alt = "";
      }
      stage.appendChild(mel);
      inner.appendChild(stage);
      var rail = el("div", "wall-lb-rail");
      if (post2) {
        var head = el("div", "comment-head");
        wallAvatarInto(head, post2.author_hash, post2.avatar);
        head.appendChild(authorNode(post2.author_hash, post2.nick, true, post2.faith, post2.posts));
        head.appendChild(el("span", "comment-date", " " + fmtDateTime(post2.created_at)));
        rail.appendChild(head);
        if (post2.body) rail.appendChild(fillBody(el("div", "comment-body"), post2.body));
        var acts = wallActions(post2);
        rail.appendChild(acts.el);
        var cs = wallCommentsSection(post2, acts.bumpComment);
        rail.appendChild(cs.wrap);
        cs.load();
        var focusComposer = function() {
          var ta = cs.wrap.querySelector(".comment-form .comment-text");
          if (ta) ta.focus();
        };
        acts.cmtBtn.addEventListener("click", focusComposer);
        acts.cmtSum.addEventListener("click", focusComposer);
        acts.shareBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          showShareMenu(acts.shareBtn, location.origin + "/feed.html?post=" + post2.id, { url: src, filename: mediaFilename(mediaKey) });
        });
      } else {
        var mini = el("div", "wall-lb-mini");
        mini.appendChild(mediaDownloadLink(src, mediaFilename(mediaKey), "Download", "btn btn-anon"));
        rail.appendChild(mini);
      }
      inner.appendChild(rail);
      ov.appendChild(inner);
      var x = el("button", "wall-lb-x");
      x.type = "button";
      x.appendChild(mcIcon("close"));
      x.title = "Close";
      ov.appendChild(x);
      function close() {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        document.removeEventListener("keydown", onKey);
        try {
          if (mel.pause) mel.pause();
        } catch (e) {
        }
      }
      function onKey(e) {
        if (e.key === "Escape") close();
      }
      ov.addEventListener("click", function(e) {
        if (e.target === ov || e.target === inner || e.target === stage) close();
      });
      x.addEventListener("click", function(e) {
        e.stopPropagation();
        close();
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(ov);
    }
    function wallMediaNode(mediaKey, post2) {
      if (!mediaKey) return null;
      ensureDmStyles();
      var kind = String(mediaKey).split("/")[1];
      var src = API + "/wall/media?key=" + encodeURIComponent(mediaKey);
      var holder = el("div", "wall-media wall-media-" + (kind === "v" ? "video" : kind === "a" ? "audio" : "img"));
      var mel;
      var open = function(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        openMedia(mediaKey, kind, post2);
      };
      if (kind === "v") {
        mel = el("video", "wall-media-el");
        mel.src = src;
        mel.controls = true;
        mel.preload = "metadata";
        mel.playsInline = true;
      } else if (kind === "a") {
        mel = el("audio", "wall-media-el");
        mel.src = src;
        mel.controls = true;
        mel.preload = "metadata";
      } else {
        mel = el("img", "wall-media-el");
        mel.src = src;
        mel.alt = "";
        mel.loading = "lazy";
        mel.style.cursor = "pointer";
        mel.addEventListener("click", open);
      }
      mel.addEventListener("error", function() {
        holder.textContent = "";
        holder.appendChild(el("span", "wall-media-gone", "\u{1F5BC}\uFE0F media unavailable"));
      });
      holder.appendChild(mel);
      if (kind !== "a") {
        var exp = el("button", "wall-media-expand");
        exp.type = "button";
        exp.title = "Open";
        exp.setAttribute("aria-label", "Open");
        exp.appendChild(mcIcon("expand"));
        exp.addEventListener("click", open);
        holder.appendChild(exp);
      }
      return holder;
    }
    function wallCanDelete(authorHash) {
      if (window.mcCore) return window.mcCore.canDelete(authorHash, state.myHash, isAdmin());
      return isAdmin() || !!state.myHash && authorHash === state.myHash;
    }
    function wallDeleteLink(id, kind, node) {
      var a = el("a", "comment-quote-link wall-del", "delete");
      a.href = "#";
      a.addEventListener("click", function(e) {
        e.preventDefault();
        appConfirm("Delete this " + (kind === "comment" ? "comment" : "post") + "? This cannot be undone.", { okLabel: "Delete", danger: true }, function(ok) {
          if (!ok) return;
          fetch(API + "/wall/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, id, kind })
          }).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (d && d.ok && node && node.parentNode) node.parentNode.removeChild(node);
          }).catch(function() {
          });
        });
      });
      return a;
    }
    function wallCommentLike(c) {
      var wrap = el("span", "wall-clike-wrap");
      var n = Number(c.likes) || 0, on = !!c.liked, gen = 0;
      var btn = el("button", "wall-clike");
      btn.type = "button";
      var cnt = el("button", "wall-clike-count");
      cnt.type = "button";
      function render() {
        btn.textContent = on ? "Liked" : "Like";
        btn.classList.toggle("on", on);
        if (n > 0) {
          cnt.textContent = "\u2665 " + n;
          cnt.style.display = "";
        } else {
          cnt.style.display = "none";
        }
      }
      render();
      attachLikers(cnt, function() {
        return { comment: c.id };
      });
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!state.myHash) {
          if (window.mcOnboard) window.mcOnboard();
          return;
        }
        var want = !on, myGen = ++gen;
        on = want;
        n = Math.max(0, n + (want ? 1 : -1));
        render();
        fetch(API + "/wall/comment/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: state.key, comment: c.id, like: want }) }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (myGen !== gen) return;
          if (d && d.ok) {
            on = !!d.liked;
            n = Number(d.likes) || 0;
          } else {
            on = !want;
            n = Math.max(0, n + (want ? -1 : 1));
          }
          render();
        }).catch(function() {
          if (myGen !== gen) return;
          on = !want;
          n = Math.max(0, n + (want ? -1 : 1));
          render();
        });
      });
      wrap.appendChild(btn);
      wrap.appendChild(cnt);
      return wrap;
    }
    function wallCommentNode(c, post2) {
      var node = el("article", "comment wall-comment");
      var head = el("div", "comment-head");
      wallAvatarInto(head, c.author_hash, c.avatar);
      head.appendChild(authorNode(c.author_hash, c.nick, true, c.faith, c.posts));
      if (c.author_hash && ADMIN_HASHES.indexOf(c.author_hash) !== -1) head.appendChild(el("span", "comment-admin", "(admin)"));
      head.appendChild(el("span", "comment-date", " " + fmtDateTime(c.created_at)));
      if (wallCanDelete(c.author_hash)) head.appendChild(wallDeleteLink(c.id, "comment", node));
      node.appendChild(head);
      node.appendChild(fillBody(el("div", "comment-body"), c.body));
      if (c.media_key) {
        var m = wallMediaNode(c.media_key, null);
        if (m) node.appendChild(m);
      }
      var actRow = el("div", "wall-comment-actions");
      actRow.appendChild(wallCommentLike(c));
      node.appendChild(actRow);
      return node;
    }
    function loginToInteract(what) {
      var p = el("p", "comments-status");
      var a = identityAction("Create an identity", function() {
        if (window.mcOnboard) window.mcOnboard();
      });
      p.appendChild(document.createTextNode("Sign in to " + what + ". "));
      p.appendChild(a);
      return p;
    }
    function clampBody(bodyEl, lines) {
      bodyEl.classList.add("wall-clamp");
      bodyEl.style.setProperty("--wall-lines", String(lines));
      var more = el("button", "wall-seemore", "See more");
      more.type = "button";
      more.style.display = "none";
      more.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        bodyEl.classList.remove("wall-clamp");
        more.style.display = "none";
      });
      requestAnimationFrame(function() {
        if (bodyEl.scrollHeight > bodyEl.clientHeight + 4) more.style.display = "";
        else bodyEl.classList.remove("wall-clamp");
      });
      return more;
    }
    function wallPostNode(p, expand) {
      ensureDmStyles();
      var node = el("article", "comment wall-post" + (expand ? " wall-post-detail" : "") + (p.media_key ? " wall-post-media" : ""));
      node.id = "post-" + p.id;
      if (!expand) {
        node.style.cursor = "pointer";
        node.addEventListener("click", function(e) {
          if (e.target.closest("a, button, video, audio, input, textarea, label, .wall-comments, .wall-media, .wall-actions")) return;
          if (window.getSelection && String(window.getSelection())) return;
          location.href = "feed.html?post=" + p.id;
        });
      }
      var head = el("div", "comment-head");
      wallAvatarInto(head, p.author_hash, p.avatar);
      head.appendChild(authorNode(p.author_hash, p.nick, true, p.faith, p.posts));
      if (p.author_hash && ADMIN_HASHES.indexOf(p.author_hash) !== -1) head.appendChild(el("span", "comment-admin", "(admin)"));
      var permalink = el("a", "comment-date", " " + fmtDateTime(p.created_at));
      permalink.href = "feed.html?post=" + p.id;
      head.appendChild(permalink);
      if (p.author_hash && state.myHash && p.author_hash !== state.myHash && p.author_hash !== MERECAT_BOT_HASH) {
        var dm = el("a", "comment-dm", "Direct Message");
        dm.href = "messages.html?dm=" + p.author_hash;
        head.appendChild(dm);
      }
      if (wallCanDelete(p.author_hash)) head.appendChild(wallDeleteLink(p.id, "post", node));
      node.appendChild(head);
      if (p.body) {
        var bodyEl = fillBody(el("div", "comment-body"), p.body);
        node.appendChild(bodyEl);
        if (!expand) node.appendChild(clampBody(bodyEl, p.media_key ? 3 : 9));
      }
      if (p.media_key) {
        var mm = wallMediaNode(p.media_key, p);
        if (mm) node.appendChild(mm);
      }
      var acts = wallActions(p);
      node.appendChild(acts.el);
      var cs = wallCommentsSection(p, acts.bumpComment);
      cs.wrap.style.display = expand ? "" : "none";
      node.appendChild(cs.wrap);
      var openComments = function() {
        cs.wrap.style.display = "";
        cs.load();
        var ta = cs.wrap.querySelector(".comment-form .comment-text");
        if (ta) ta.focus();
      };
      acts.cmtBtn.addEventListener("click", function() {
        if (cs.wrap.style.display === "none") openComments();
        else cs.wrap.style.display = "none";
      });
      acts.cmtSum.addEventListener("click", openComments);
      acts.shareBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        showShareMenu(
          acts.shareBtn,
          location.origin + "/feed.html?post=" + p.id,
          p.media_key ? { url: API + "/wall/media?key=" + encodeURIComponent(p.media_key), filename: mediaFilename(p.media_key) } : null
        );
      });
      if (expand) cs.load();
      return node;
    }
    function wallComposer(kind, extra, onDone) {
      var form = el("div", "comment-form wall-composer");
      var ta = el("textarea", "comment-text");
      ta.maxLength = 4e3;
      ta.rows = kind === "comment" ? 2 : 3;
      ta.placeholder = kind === "comment" ? "Write a comment\u2026" : "Share something with the community\u2026";
      form.appendChild(mdEditor(ta));
      attachMentions(ta);
      form.appendChild(el("div", "ts-slot"));
      var btnRow = el("div", "comment-buttons");
      var send = el("button", "btn btn-send", kind === "comment" ? "Comment" : "Post");
      send.type = "button";
      btnRow.appendChild(send);
      var pv = previewButton(ta);
      if (pv) btnRow.appendChild(pv);
      var pendingFile = null;
      var fileInput = el("input");
      fileInput.type = "file";
      fileInput.accept = "image/*,video/*,audio/*";
      fileInput.style.display = "none";
      var attach = el("button", "btn btn-attach", "\u{1F4CE} Attach");
      attach.type = "button";
      var chip = el("span", "dm-attach-chip");
      chip.style.display = "none";
      function clearAttach() {
        pendingFile = null;
        fileInput.value = "";
        chip.style.display = "none";
        chip.textContent = "";
      }
      attach.addEventListener("click", function() {
        fileInput.click();
      });
      function takeWallFile(f) {
        mediaCfg().then(function(cfg) {
          mediaGateFile(f, cfg, cfg.kinds.wall, status).then(function(out) {
            if (!out) {
              fileInput.value = "";
              return;
            }
            pendingFile = out;
            status.textContent = "";
            chip.textContent = "";
            chip.appendChild(document.createTextNode("\u{1F4CE} " + (out.name || "attachment") + " \xB7 " + fmtBytes(out.size) + "  "));
            var x = el("a", null, "\u2715");
            x.href = "#";
            x.addEventListener("click", function(e) {
              e.preventDefault();
              clearAttach();
            });
            chip.appendChild(x);
            chip.style.display = "";
          });
        });
      }
      fileInput.addEventListener("change", function() {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        takeWallFile(f);
      });
      btnRow.appendChild(attach);
      mediaCfg().then(function(cfg) {
        if (cfg.enabled && cfg.kinds.wall.indexOf("audio") !== -1) btnRow.appendChild(voiceControl(form, cfg, status, takeWallFile));
      });
      form.appendChild(chip);
      form.appendChild(fileInput);
      form.appendChild(btnRow);
      var status = el("p", "form-status");
      form.appendChild(status);
      ensureDmStyles();
      loadTurnstile();
      send.addEventListener("click", function() {
        var body = ta.value.replace(/\s+$/, "");
        if (!pendingFile && !body.trim()) {
          if (ta.mcPreview) ta.mcPreview.off();
          ta.focus();
          return;
        }
        send.disabled = true;
        status.textContent = "Verifying\u2026";
        var file = pendingFile;
        getToken().then(function(token) {
          function post2(mediaKey) {
            status.textContent = "Posting\u2026";
            var payload = { key: state.key, body, token, mentions: collectMentions(body) };
            if (mediaKey) payload.media_key = mediaKey;
            var url = API + "/wall/post";
            if (kind === "comment") {
              payload.post = extra.post;
              url = API + "/wall/comment";
            }
            return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(function(r) {
              return r.json();
            }).then(function(d) {
              send.disabled = false;
              if (blockedOut(d)) return;
              if (!d || !d.ok) {
                status.textContent = d && d.error || "Could not post.";
                if (window.turnstile) try {
                  turnstile.reset();
                } catch (e) {
                }
                return;
              }
              ta.value = "";
              if (ta.mcDraftDone) ta.mcDraftDone();
              clearAttach();
              if (ta.mcPreview) ta.mcPreview.off();
              if (window.turnstile) try {
                turnstile.reset();
              } catch (e) {
              }
              if (d.status === "pending") {
                status.textContent = "Held for review. It will appear once approved.";
                return;
              }
              status.textContent = "";
              var row = {
                id: d.id,
                author_hash: state.myHash,
                nick: myNick(),
                avatar: myAvatar(),
                faith: getFaith(),
                body,
                created_at: Math.floor(Date.now() / 1e3),
                media_key: mediaKey || null,
                comments: 0,
                likes: 0,
                liked: false,
                posts: myPostCount()
              };
              if (onDone) onDone(row);
            });
          }
          if (file) {
            status.textContent = "Uploading\u2026";
            var fd = new FormData();
            fd.append("key", state.key);
            fd.append("file", file);
            return fetch(API + "/wall/media", { method: "POST", body: fd }).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (!d || !d.ok) {
                send.disabled = false;
                status.textContent = d && d.error || "Upload failed.";
                return;
              }
              return post2(d.media_key);
            });
          }
          return post2(null);
        }).catch(function() {
          send.disabled = false;
          status.textContent = "Could not post. Try again.";
        });
      });
      return form;
    }
    function myNick() {
      try {
        return state.profile && state.profile.nick || "";
      } catch (e) {
        return "";
      }
    }
    function myAvatar() {
      try {
        return state.profile && state.profile.avatar || "";
      } catch (e) {
        return "";
      }
    }
    function myPostCount() {
      try {
        return state.profile && state.profile.posts || 0;
      } catch (e) {
        return 0;
      }
    }
    function wallInfiniteList(fetcher, opts) {
      opts = opts || {};
      var wrap = el("div", "wall-list");
      var status = el("p", "comments-status");
      var sentinel = el("div", "wall-sentinel");
      wrap.appendChild(sentinel);
      wrap.appendChild(status);
      var next = 0, loading = false, done = false, any = false;
      var MAX_NODES = 80;
      function count() {
        return wrap.querySelectorAll(".wall-post").length;
      }
      function fills() {
        return wrap.scrollHeight > window.innerHeight * 1.3;
      }
      function prune() {
        if (!opts.loop) return;
        while (count() > MAX_NODES) {
          var first = wrap.firstElementChild;
          if (!first || first === sentinel || first === status) break;
          if (first.getBoundingClientRect().bottom > 0) break;
          var before = document.documentElement.scrollHeight;
          wrap.removeChild(first);
          window.scrollBy(0, document.documentElement.scrollHeight - before);
        }
      }
      function load2() {
        if (loading || done) return;
        loading = true;
        status.textContent = "Loading\u2026";
        fetcher(next).then(function(d) {
          loading = false;
          status.textContent = "";
          if (blockedOut(d)) return;
          if (!d || !d.ok) {
            status.textContent = "Could not load. Reload the page.";
            return;
          }
          (d.posts || []).forEach(function(p) {
            any = true;
            wrap.insertBefore(wallPostNode(p), sentinel);
          });
          next = Number(d.next) || 0;
          if (!next) {
            if (!any) {
              done = true;
              status.textContent = "Nothing here yet. Be the first to post.";
            } else if (opts.loop && fills()) {
              wrap.insertBefore(el("div", "wall-loopmark", "\xB7 You\u2019re all caught up \u2014 earlier posts follow \xB7"), sentinel);
              next = 0;
            } else {
              done = true;
            }
          }
          prune();
        }).catch(function() {
          loading = false;
          status.textContent = "Could not load. Reload the page.";
        });
      }
      if ("IntersectionObserver" in window) {
        var io2 = new IntersectionObserver(function(ents) {
          if (ents.some(function(e) {
            return e.isIntersecting;
          })) load2();
        }, { rootMargin: "600px" });
        io2.observe(sentinel);
      } else {
        var more = el("button", "btn", "Load more");
        more.type = "button";
        more.addEventListener("click", load2);
        wrap.appendChild(more);
      }
      load2();
      return {
        wrap,
        prepend: function(row, live) {
          any = true;
          var node = wallPostNode(row);
          if (wrap.querySelector("#post-" + row.id)) return;
          if (live) node.classList.add("wall-live-new");
          var before = document.documentElement.scrollHeight;
          wrap.insertBefore(node, wrap.firstChild);
          if (live && window.scrollY > 240) window.scrollBy(0, document.documentElement.scrollHeight - before);
          if (live) setTimeout(function() {
            node.classList.remove("wall-live-new");
          }, 2200);
        }
      };
    }
    function viewFeed() {
      document.title = "Feed | Community";
      crumb([["Community", "community.html"], ["Feed"]]);
      if (!isMember()) {
        viewJoin("see and post to the community feed");
        return;
      }
      section.appendChild(el("p", "board-intro", "Everything the community is sharing. Your posts appear here and on your profile."));
      section.appendChild(wallComposer("post", {}, function(row) {
        if (row && list) list.prepend(row);
      }));
      var list = wallInfiniteList(function(cursor) {
        return fetch(API + "/wall/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, cursor })
        }).then(function(r) {
          return r.json();
        });
      }, { loop: true });
      section.appendChild(list.wrap);
      var seenLive = {};
      state.onLiveWall = function(m) {
        if (!m || m.t !== "wall-post" || !m.id || seenLive[m.id]) return;
        seenLive[m.id] = true;
        if (list.wrap.querySelector("#post-" + m.id)) return;
        fetch(API + "/wall/post/get", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key || "", id: m.id })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (d && d.ok && d.post) list.prepend(d.post, true);
        }).catch(function() {
        });
      };
    }
    function viewPost(id) {
      if (!(id > 0)) {
        crumb([["Community", "community.html"], ["Feed", "feed.html"]]);
        section.appendChild(el("p", "comments-status", "No such post."));
        return;
      }
      document.title = "Post | Community";
      crumb([["Community", "community.html"], ["Feed", "feed.html"], ["Post"]]);
      var holder = el("div", "wall-list");
      section.appendChild(holder);
      holder.appendChild(el("p", "comments-status", "Loading\u2026"));
      fetch(API + "/wall/post/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key || "", id })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        holder.textContent = "";
        if (blockedOut(d)) return;
        if (!d || !d.ok) {
          holder.appendChild(el("p", "comments-status", d && d.error ? d.error : "That post is gone."));
          return;
        }
        holder.appendChild(wallPostNode(d.post, true));
      }).catch(function() {
        holder.textContent = "";
        holder.appendChild(el("p", "comments-status", "Could not load the post."));
      });
    }
    function renderProfileWall(card, hash, editable) {
      if (!isMember()) return;
      card.appendChild(el("h3", null, editable ? "Your wall" : "Wall"));
      if (editable) {
        card.appendChild(wallComposer("post", {}, function(row) {
          if (row) wrap.wrap.insertBefore(wallPostNode(row), wrap.wrap.firstChild);
        }));
      }
      var wrap = wallInfiniteList(function(cursor) {
        return fetch(API + "/wall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, hash, cursor })
        }).then(function(r) {
          return r.json();
        });
      });
      card.appendChild(wrap.wrap);
    }
    function viewInbox() {
      if (window.mcViews && window.mcViews.inbox) {
        section.appendChild(dmE2eBadge());
        return window.mcViews.inbox(section, window.mcKit);
      }
      document.title = "Inbox | Community";
      crumb([["Community", "community.html"], ["Inbox"]]);
      if (!state.key) {
        section.appendChild(el("p", "comments-status", "Messages need an identity. Create one on the board front page."));
        return;
      }
      section.appendChild(dmSearchBox());
      section.appendChild(dmE2eBadge());
      var list = el("div", "board-topics");
      list.textContent = "Loading messages...";
      section.appendChild(list);
      var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("p")) || 1));
      fetchRetry(API + "/dm/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, p: pageNum })
      }, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        dmCacheSet(d.unread_total);
        list.textContent = "";
        if (!d.threads.length) {
          list.appendChild(el("p", "comments-status", "No messages yet. Find a member above, or press Direct Message on any post."));
          return;
        }
        var presDots = {};
        d.threads.forEach(function(t) {
          var row = el("div", "board-topic");
          var left = el("div", "board-topic-left");
          var dot = el("span", "mc-inbox-dot");
          dot.style.display = "none";
          dot.title = "Online";
          left.appendChild(dot);
          presDots[t.other_hash] = dot;
          var a = el("a", "board-topic-title" + (t.unread ? " dm-unread" : ""), dmLabel(t.other_hash, t.nick));
          a.href = "messages.html?dm=" + t.other_hash;
          left.appendChild(a);
          if (t.unread) left.appendChild(el("span", "dm-unread", " \u25CF new"));
          row.appendChild(left);
          row.appendChild(el(
            "div",
            "board-stats",
            t.msgs + (t.msgs === 1 ? " message \xB7 " : " messages \xB7 ") + fmtDateTime(t.last_at)
          ));
          var delWrap = el("div", "board-admin-corner");
          var del = el("a", "trust-toggle", "Delete");
          del.href = "#";
          del.addEventListener("click", /* @__PURE__ */ function(other, rowEl) {
            return function(e) {
              e.preventDefault();
              appConfirm("Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.", { okLabel: "Delete", danger: true }, function(ok) {
                if (!ok) return;
                fetch(API + "/dm/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: state.key, with: other })
                }).then(function(r) {
                  return r.json();
                }).then(function(d2) {
                  if (d2.ok) {
                    rowEl.remove();
                    try {
                      localStorage.removeItem(DM_CACHE);
                    } catch (e2) {
                    }
                    dmUnreadCheck();
                  }
                }).catch(function() {
                });
              });
            };
          }(t.other_hash, row));
          delWrap.appendChild(del);
          row.appendChild(delWrap);
          list.appendChild(row);
        });
        var presHashes = d.threads.map(function(t) {
          return t.other_hash;
        });
        if (presHashes.length) {
          fetch(API + "/dm/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, hashes: presHashes })
          }).then(function(r) {
            return r.json();
          }).then(function(pd) {
            if (pd && pd.ok && Array.isArray(pd.online)) pd.online.forEach(function(h) {
              if (presDots[h]) presDots[h].style.display = "";
            });
          }).catch(function() {
          });
        }
        state.inboxPresence = function(h, on) {
          if (presDots[h]) presDots[h].style.display = on ? "" : "none";
        };
        function inboxHref(i) {
          return "messages.html&p=" + i;
        }
        var topBar = pageBar(d.total, d.per, d.page, inboxHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, inboxHref);
        if (botBar) section.appendChild(botBar);
      }).catch(function() {
        list.textContent = "";
        list.appendChild(el("p", "comments-status", "The inbox could not be loaded. Check your connection and reload the page."));
      });
    }
    function viewNotifications() {
      if (window.mcViews && window.mcViews.notifications) return window.mcViews.notifications(section, window.mcKit);
      document.title = "Notifications | Community";
      crumb([["Community", "community.html"], ["Notifications"]]);
      if (!state.key) {
        section.appendChild(el("p", "comments-status", "Notifications need an identity. Create one on the board front page."));
        return;
      }
      var list = el("div", "board-topics");
      list.textContent = "Loading notifications...";
      section.appendChild(list);
      var pageNum = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("p")) || 1));
      fetchRetry(API + "/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key, p: pageNum })
      }, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (blockedOut(d)) return;
        if (!d.ok) throw new Error(d.error || "failed");
        fetch(API + "/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }).then(function() {
          try {
            localStorage.removeItem(NOTIF_CACHE);
          } catch (e) {
          }
          notifUnreadCheck();
        }).catch(function() {
        });
        list.textContent = "";
        if (!d.items.length) {
          list.appendChild(el("p", "comments-status", "No notifications yet. Post in a thread to follow it; you will hear when someone replies or names you."));
          return;
        }
        d.items.forEach(function(it) {
          var row = el("div", "board-topic");
          var left = el("div", "board-topic-left");
          var who = it.actor_nick || (it.actor_hash ? displayName(it.actor_hash) : "Someone");
          var isDm = it.kind === "dm";
          var isWall = it.kind === "wall";
          var isLike = it.kind === "wall-like";
          var label = isDm ? who + " sent you a message" : isLike ? who + " liked your post" : isWall ? who + (it.topic_id === 1 ? " commented on your post" : " mentioned you in a post") : who + (it.kind === "mention" ? " mentioned you in " : " replied in ") + (it.topic_title || "a thread");
          var a = el("a", "board-topic-title" + (it.read_at ? "" : " dm-unread"), label);
          a.href = isDm ? "messages.html?dm=" + it.actor_hash : isWall || isLike ? "feed.html?post=" + it.comment_id : "community.html?topic=" + it.topic_id + "#comment-" + it.comment_id;
          left.appendChild(a);
          if (!it.read_at) left.appendChild(el("span", "dm-unread", " \u25CF new"));
          if (it.snippet && !isDm) left.appendChild(el("div", "board-intro", it.snippet));
          row.appendChild(left);
          row.appendChild(el("div", "board-stats", fmtDateTime(it.created_at)));
          list.appendChild(row);
        });
        function notifHref(i) {
          return "community.html?notifications=1&p=" + i;
        }
        var topBar = pageBar(d.total, d.per, d.page, notifHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, notifHref);
        if (botBar) section.appendChild(botBar);
      }).catch(function() {
        list.textContent = "";
        list.appendChild(el("p", "comments-status", "Notifications could not be loaded. Check your connection and reload the page."));
      });
    }
    function watchToggle(topicId) {
      var a = el("a", "trust-toggle board-watch", "Watch");
      a.href = "#";
      a.title = "Get a notification when someone replies here";
      function setLabel(w) {
        a.textContent = w ? "Unwatch" : "Watch";
        a.setAttribute("data-w", w ? "1" : "0");
      }
      function call(act) {
        return fetch(API + "/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, topic: topicId, act })
        }).then(function(r) {
          return r.json();
        });
      }
      call("status").then(function(d) {
        if (blockedOut(d)) return;
        if (d.ok) setLabel(d.watching);
      }).catch(function() {
      });
      a.addEventListener("click", function(e) {
        e.preventDefault();
        call(a.getAttribute("data-w") === "1" ? "unwatch" : "watch").then(function(d) {
          if (blockedOut(d)) return;
          if (d.ok) setLabel(d.watching);
        }).catch(function() {
        });
      });
      return a;
    }
    function dmMsgNode(m, otherLabel) {
      var mine = m.sender_hash === state.myHash;
      var node = el("div", "dm-msg" + (mine ? " dm-mine" : ""));
      if (m.id) node.setAttribute("data-dmid", String(m.id));
      var head = el("div", "comment-head");
      head.appendChild(el("span", "comment-author", mine ? "You" : otherLabel));
      head.appendChild(el("span", "comment-date", " " + fmtDateTime(m.created_at)));
      if (m.edited_at) head.appendChild(el("span", "dm-edited", " (edited)"));
      node.appendChild(head);
      node.appendChild(fillBody(el("div", "comment-body"), m.body));
      return node;
    }
    function dmRedactedNode(m, otherLabel) {
      var mine = m.sender_hash === state.myHash;
      var node = el("div", "dm-msg dm-redacted-msg" + (mine ? " dm-mine" : ""));
      if (m.id) node.setAttribute("data-dmid", String(m.id));
      var head = el("div", "comment-head");
      head.appendChild(el("span", "comment-author", mine ? "You" : otherLabel));
      head.appendChild(el("span", "comment-date", " " + fmtDateTime(m.created_at)));
      node.appendChild(head);
      var body = el("div", "comment-body");
      body.appendChild(el("span", "dm-redacted", mine ? "<redacted> \u2014 you deleted this message" : "<redacted>"));
      node.appendChild(body);
      return node;
    }
    function viewDm(other) {
      if (!/^[0-9a-f]{64}$/.test(String(other))) {
        crumb([["Community", "community.html"], ["Messages"]]);
        section.appendChild(el("p", "comments-status", "No such member."));
        return;
      }
      if (!state.key) {
        crumb([["Community", "community.html"], ["Messages"]]);
        section.appendChild(el("p", "comments-status", "Messages need an identity. Create one on the board front page."));
        return;
      }
      if (other === state.myHash) {
        crumb([["Community", "community.html"], ["Messages"]]);
        section.appendChild(el("p", "comments-status", "That would be a soliloquy. Pick another member."));
        return;
      }
      var qs = new URLSearchParams(location.search);
      var pNum = Math.floor(Number(qs.get("p")) || 0);
      var payload = { key: state.key, with: other };
      if (pNum > 0) payload.p = pNum;
      Promise.all([
        ensureNacl(),
        fetchRetry(API + "/dm/thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, [1e3, 3e3]).then(function(r) {
          return r.json();
        })
      ]).then(function(res) {
        var d = res[1];
        if (!d.ok) throw new Error(d.error || "failed");
        var otherPub = d.other && d.other.pubkey || null;
        var label = dmLabel(other, d.other.nick);
        var shortName = d.other.nick || displayName(other);
        document.title = shortName + " | Inbox";
        crumb([["Community", "community.html"], ["Inbox", "messages.html"], [shortName]]);
        var headEl = el("h2", "board-topic-head");
        var presDot = el("span", "dm-dot dm-dot-unknown");
        headEl.appendChild(presDot);
        var nameLink = el("a", null, label);
        nameLink.href = profileHref(other);
        headEl.appendChild(nameLink);
        section.appendChild(headEl);
        ensureDmStyles();
        section.appendChild(dmE2eBadge(other, otherPub));
        var expiryNote = dmExpiryNode(other, d.ttl, !d.messages.length);
        section.appendChild(expiryNote);
        try {
          localStorage.removeItem(DM_CACHE);
        } catch (e) {
        }
        dmUnreadCheck();
        var list = el("div", "comments-list");
        section.appendChild(list);
        if (!d.messages.length) {
          list.appendChild(el("p", "comments-status", "No messages yet. Say the first word."));
        }
        var receipts = [];
        function addReceipt(node, m) {
          if (String(m.sender_hash) !== state.myHash) return;
          if (state.prefs && state.prefs.receipts === "off") return;
          var seen = !!m.opened_at;
          var r = el("span", "dm-receipt" + (seen ? " dm-receipt-seen" : ""), seen ? "\u2713\u2713 Seen" : "\u2713 Delivered");
          node.appendChild(r);
          receipts.push({ created: Number(m.created_at) || 0, span: r });
        }
        function renderMsg(m) {
          var n = dmRenderMsg(m, otherPub, shortName, other);
          addReceipt(n, m);
          return n;
        }
        d.messages.forEach(function(m) {
          list.appendChild(renderMsg(m));
        });
        var typingLine = el("p", "dm-typing", shortName + " is typing\u2026");
        typingLine.style.display = "none";
        var typingHideT = 0;
        state.dmView = {
          other,
          setTtl: function(t) {
            if (expiryNote && expiryNote.mcSetTtl) expiryNote.mcSetTtl(t);
          },
          setPresence: function(on) {
            presDot.className = "dm-dot " + (on ? "dm-dot-on" : "dm-dot-off");
            presDot.title = on ? "Online" : "Offline";
          },
          setTyping: function(on) {
            clearTimeout(typingHideT);
            if (on) {
              typingLine.style.display = "";
              typingHideT = setTimeout(function() {
                typingLine.style.display = "none";
              }, 6e3);
            } else {
              typingLine.style.display = "none";
            }
          },
          markRead: function(at) {
            var t = Number(at) || 0;
            receipts.forEach(function(rc) {
              if (rc.created <= t) {
                rc.span.textContent = "\u2713\u2713 Seen";
                rc.span.className = "dm-receipt dm-receipt-seen";
              }
            });
          },
          append: function(msg) {
            if (!msg || String(msg.sender_hash) === state.myHash) return;
            clearTimeout(typingHideT);
            typingLine.style.display = "none";
            var newMsgPage = Math.max(1, Math.ceil((d.total + 1) / d.per));
            d.total += 1;
            if (d.page === newMsgPage) {
              var node = renderMsg(msg);
              list.appendChild(node);
              node.scrollIntoView();
            } else {
              liveDmBadge();
            }
          },
          /* The other party edited a message they sent me: re-render its body
             (decrypting) and mark it "(edited)". Only its text body changes. */
          editMsg: function(msg) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, "") + '"]');
            if (!bubble || bubble.classList.contains("dm-redacted-msg") || bubble.querySelector(".dm-media")) return;
            var body = bubble.querySelector(".comment-body");
            if (body) {
              var text = Number(msg.enc || 0) === 1 ? dmDecrypt(msg.body, otherPub) || "\u26A0\uFE0F could not decrypt" : msg.body || "";
              body.textContent = "";
              fillBody(body, text);
            }
            var head = bubble.querySelector(".comment-head");
            if (head && !head.querySelector(".dm-edited")) head.appendChild(el("span", "dm-edited", " (edited)"));
          },
          /* The other party deleted a message they sent me: show "<redacted>". */
          redactMsg: function(id) {
            if (!id) return;
            var bubble = list.querySelector('[data-dmid="' + String(id).replace(/"/g, "") + '"]');
            if (bubble) dmMakeRedacted(bubble, false);
          }
        };
        if (window.mcLive && window.mcLive.board) window.mcLive.board.sub(["presence:" + other]);
        var dmPages = Math.max(1, Math.ceil(d.total / d.per));
        function dmHref(i) {
          return "messages.html?dm=" + other + "&p=" + i;
        }
        var topBar = pageBar(d.total, d.per, d.page, dmHref);
        if (topBar) section.insertBefore(topBar, list);
        var botBar = pageBar(d.total, d.per, d.page, dmHref);
        if (botBar) section.appendChild(botBar);
        section.appendChild(typingLine);
        var form = el("div", "comment-form");
        var ta = el("textarea", "comment-text");
        ta.maxLength = 4e3;
        ta.rows = 3;
        ta.placeholder = "Write your message.";
        form.appendChild(mdEditor(ta));
        attachDraft(ta, "dm:" + other);
        var typingLastSent = 0, typingStopT = 0;
        ta.addEventListener("input", function() {
          if (!(window.mcLive && window.mcLive.member)) return;
          var now = Date.now();
          if (now - typingLastSent > 3e3) {
            window.mcLive.member.typing(other, "start");
            typingLastSent = now;
          }
          clearTimeout(typingStopT);
          typingStopT = setTimeout(function() {
            window.mcLive.member.typing(other, "stop");
            typingLastSent = 0;
          }, 4e3);
        });
        form.appendChild(el("div", "ts-slot"));
        var btnRow = el("div", "comment-buttons");
        var send = el("button", "btn btn-send", "Send");
        send.type = "button";
        btnRow.appendChild(send);
        var pv = previewButton(ta);
        if (pv) btnRow.appendChild(pv);
        var pendingFile = null;
        var fileInput = el("input", "dm-file-input");
        fileInput.type = "file";
        fileInput.accept = "image/*,video/*,audio/*";
        fileInput.style.display = "none";
        var attach = el("button", "btn btn-attach", "\u{1F4CE} Attach");
        attach.type = "button";
        var mediaChip = el("span", "dm-attach-chip");
        mediaChip.style.display = "none";
        function clearAttach() {
          pendingFile = null;
          fileInput.value = "";
          mediaChip.style.display = "none";
          mediaChip.textContent = "";
        }
        attach.addEventListener("click", function() {
          fileInput.click();
        });
        function takeDmFile(f) {
          mediaCfg().then(function(cfg) {
            mediaGateFile(f, cfg, cfg.kinds.dm, status).then(function(out) {
              if (!out) {
                fileInput.value = "";
                return;
              }
              pendingFile = out;
              status.textContent = "";
              mediaChip.textContent = "";
              mediaChip.appendChild(document.createTextNode("\u{1F4CE} " + (out.name || "attachment") + " \xB7 " + fmtBytes(out.size) + "  "));
              var x = el("a", null, "\u2715");
              x.href = "#";
              x.addEventListener("click", function(ev) {
                ev.preventDefault();
                clearAttach();
              });
              mediaChip.appendChild(x);
              mediaChip.style.display = "";
            });
          });
        }
        fileInput.addEventListener("change", function() {
          var f = fileInput.files && fileInput.files[0];
          if (!f) return;
          takeDmFile(f);
        });
        btnRow.appendChild(attach);
        mediaCfg().then(function(cfg) {
          if (cfg.enabled && cfg.kinds.dm.indexOf("audio") !== -1) btnRow.appendChild(voiceControl(form, cfg, status, takeDmFile));
        });
        form.appendChild(mediaChip);
        form.appendChild(fileInput);
        form.appendChild(btnRow);
        var status = el("p", "form-status");
        form.appendChild(status);
        section.appendChild(form);
        loadTurnstile();
        if (!otherPub) {
          send.disabled = true;
          ta.disabled = true;
          ta.placeholder = "Waiting for this member to sign in once to set up encryption.";
          status.textContent = "You can message them privately once they have signed in to set up their encryption key.";
        }
        send.addEventListener("click", function() {
          var body = ta.value.replace(/\s+$/, "");
          if (!pendingFile && !body.trim()) {
            if (ta.mcPreview) ta.mcPreview.off();
            ta.focus();
            return;
          }
          send.disabled = true;
          status.textContent = "Verifying...";
          var sending = pendingFile;
          getToken().then(function(token) {
            if (sending) {
              status.textContent = "Encrypting...";
              return dmMediaEncryptFile(sending).then(function(mm) {
                status.textContent = "Uploading...";
                var fd = new FormData();
                fd.append("key", state.key);
                fd.append("file", new Blob([mm.ct]), "blob");
                return fetch(API + "/dm/media", { method: "POST", body: fd }).then(function(r) {
                  return r.json();
                }).then(function(u) {
                  if (!u.ok) throw new Error(u.error || "The file could not be uploaded.");
                  status.textContent = "Sending...";
                  if (body.trim()) mm.env.caption = body;
                  return fetchRetry(API + "/dm/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: state.key, to: other, body: dmEncrypt(JSON.stringify(mm.env), otherPub), enc: 1, media_key: u.media_key, token })
                  }, [1500]).then(function(r) {
                    return r.json();
                  }).then(function(d2) {
                    d2._env = mm.env;
                    d2._media_key = u.media_key;
                    return d2;
                  });
                });
              });
            }
            status.textContent = "Sending...";
            return fetchRetry(API + "/dm/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, to: other, body: dmEncrypt(body, otherPub), enc: 1, token })
            }, [1500], function() {
              status.textContent = "Network hiccup, retrying...";
            }).then(function(r) {
              return r.json();
            });
          }).then(function(d2) {
            if (blockedOut(d2)) return;
            if (!d2.ok) throw new Error(d2.error || "The message could not be sent.");
            ta.value = "";
            if (ta.mcDraftDone) ta.mcDraftDone();
            if (ta.mcPreview) ta.mcPreview.off();
            if (sending && d2._media_key) {
              try {
                _mediaCache[d2._media_key] = URL.createObjectURL(sending);
              } catch (e) {
              }
            }
            clearAttach();
            var msgPage = Math.ceil((d.total + 1) / d.per);
            if (msgPage === d.page) {
              d.total += 1;
              var node;
              if (sending && d2._media_key) {
                var mecho = { id: d2.id, sender_hash: state.myHash, media_key: d2._media_key, created_at: d2.created_at, saved: 0, enc: 1 };
                node = dmMediaNode(mecho, shortName, other, d2._env);
                dmAppendControls(mecho, node, otherPub, shortName, other);
              } else {
                var echo = { id: d2.id, sender_hash: state.myHash, body, created_at: d2.created_at, saved: 0, enc: 0 };
                node = dmRenderMsg(echo, otherPub, shortName, other);
              }
              list.appendChild(node);
              status.textContent = "Sent.";
              node.scrollIntoView();
            } else {
              location.href = "messages.html?dm=" + other + "&p=" + msgPage;
            }
          }).catch(function(err) {
            status.textContent = err.message || "Network error. Try again in a moment.";
          }).finally(function() {
            send.disabled = false;
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        });
        var blockLine = el("p", "board-audit-link");
        blockLine.appendChild(identityAction(d.blocked ? "Unblock this member" : "Block this member", function() {
          var blocking = !d.blocked;
          var doBlock = function() {
            fetch(API + "/dm/block", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, hash: other, blocked: blocking })
            }).then(function(r) {
              return r.json();
            }).then(function(d3) {
              if (d3.ok) location.reload();
            }).catch(function() {
            });
          };
          if (blocking) appConfirm("Block this member? Their future messages will be held out of your sight, and they will never be told. Unblocking delivers everything they wrote meanwhile.", { okLabel: "Block", danger: true }, function(ok) {
            if (ok) doBlock();
          });
          else doBlock();
        }));
        blockLine.appendChild(document.createTextNode(" \xB7 "));
        blockLine.appendChild(identityAction("Delete conversation", function() {
          appConfirm("Delete this conversation? It is cleared from your inbox; the other member keeps their copy until they delete it too.", { okLabel: "Delete", danger: true }, function(ok) {
            if (!ok) return;
            fetch(API + "/dm/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, with: other })
            }).then(function(r) {
              return r.json();
            }).then(function(d3) {
              if (d3.ok) {
                try {
                  localStorage.removeItem(DM_CACHE);
                } catch (e) {
                }
                location.href = "messages.html";
              }
            }).catch(function() {
            });
          });
        }));
        section.appendChild(blockLine);
        if (d.messages.length && d.page >= dmPages && list.lastChild) {
          list.lastChild.scrollIntoView();
        }
      }).catch(function() {
        crumb([["Community", "community.html"], ["Messages"]]);
        section.appendChild(el("p", "comments-status", "The conversation could not be loaded. Check your connection and reload the page."));
      });
    }
    function searchSnippet(snip) {
      var wrap = el("div", "board-intro");
      String(snip == null ? "" : snip).split(/[\u0002\u0003]/).forEach(function(seg, i) {
        if (!seg) return;
        if (i % 2 === 1) wrap.appendChild(el("mark", null, seg));
        else wrap.appendChild(document.createTextNode(seg));
      });
      return wrap;
    }
    function attachAuthorPicker(input, actionLabel) {
      var chosen = "", chosenText = "";
      var sug = el("div", "mention-suggest");
      sug.hidden = true;
      input.parentNode.insertBefore(sug, input.nextSibling);
      var current = [], sel = 0, timer = null;
      function render() {
        sug.textContent = "";
        if (!current.length) {
          sug.hidden = true;
          return;
        }
        current.forEach(function(u, i) {
          var r = el("a", "dm-suggest-row" + (i === sel ? " dm-suggest-sel" : ""));
          r.href = "#";
          r.appendChild(el("span", null, dmLabel(u.hash, u.nick)));
          r.appendChild(el("span", "dm-suggest-go", actionLabel || "filter"));
          r.addEventListener("mousedown", function(e) {
            e.preventDefault();
            pick(u);
          });
          sug.appendChild(r);
        });
        sug.hidden = false;
      }
      function pick(u) {
        chosen = u.hash;
        chosenText = "@" + (u.nick || displayName(u.hash));
        input.value = chosenText;
        current = [];
        sug.hidden = true;
      }
      function scan() {
        if (input.value !== chosenText) chosen = "";
        var q = input.value.trim().replace(/^@/, "").toLowerCase();
        if (q.length < 1) {
          current = [];
          sug.hidden = true;
          return;
        }
        ensureMentionDir(function() {
          current = mentionDir.map(function(u) {
            return { u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) };
          }).filter(function(x) {
            return x.s > 0;
          }).sort(function(x, y) {
            return y.s - x.s || (x.label < y.label ? -1 : 1);
          }).slice(0, 8).map(function(x) {
            return x.u;
          });
          sel = 0;
          render();
        });
      }
      input.addEventListener("input", function() {
        clearTimeout(timer);
        timer = setTimeout(scan, 120);
      });
      input.addEventListener("keydown", function(e) {
        if (sug.hidden || !current.length) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          sel = Math.min(sel + 1, current.length - 1);
          render();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          sel = Math.max(sel - 1, 0);
          render();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (current[sel]) pick(current[sel]);
        } else if (e.key === "Escape") {
          current = [];
          sug.hidden = true;
        }
      });
      input.addEventListener("blur", function() {
        setTimeout(function() {
          sug.hidden = true;
        }, 200);
      });
      return {
        hash: function() {
          return chosen;
        },
        set: function(hash, label) {
          chosen = hash;
          chosenText = "@" + label;
          input.value = chosenText;
        }
      };
    }
    function indexSearchBox() {
      var form = el("form", "board-search");
      var row = el("div", "key-row");
      var input = el("input", "key-input");
      input.type = "search";
      input.placeholder = "Search the board...";
      row.appendChild(input);
      var btn = el("button", "btn btn-send", "Search");
      btn.type = "submit";
      row.appendChild(btn);
      form.appendChild(row);
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        location.href = "community.html?q=" + encodeURIComponent(input.value.trim());
      });
      return form;
    }
    function viewSearch() {
      if (window.mcViews && window.mcViews.search) return window.mcViews.search(section, window.mcKit);
      var qs = new URLSearchParams(location.search);
      var q = qs.get("q") || "";
      var cat0 = qs.get("cat") || "";
      var author0 = qs.get("author") || "";
      var sort0 = qs.get("sort") || "";
      document.title = "Search | Community";
      crumb([["Community", "community.html"], ["Search"]]);
      if (!isMember()) {
        section.appendChild(el(
          "p",
          "comments-status",
          "Search is for logged-in members. Create an identity or paste your key above, then search the board."
        ));
        return;
      }
      var form = el("form", "board-search");
      var row1 = el("div", "key-row");
      var qInput = el("input", "key-input");
      qInput.type = "search";
      qInput.value = q;
      qInput.placeholder = 'Search the board... "quotes" for an exact phrase';
      row1.appendChild(qInput);
      var goBtn = el("button", "btn btn-send", "Search");
      goBtn.type = "submit";
      row1.appendChild(goBtn);
      form.appendChild(row1);
      var row2 = el("div", "key-row");
      var catSel = el("select", "board-move");
      var allOpt = el("option", null, "All categories");
      allOpt.value = "";
      catSel.appendChild(allOpt);
      CATS.forEach(function(c) {
        if (c[0] === "adminsonly") return;
        var o = el("option", null, c[1]);
        o.value = c[0];
        if (c[0] === cat0) o.selected = true;
        catSel.appendChild(o);
      });
      row2.appendChild(catSel);
      var authorInput = el("input", "key-input");
      authorInput.type = "text";
      authorInput.placeholder = "@author (optional)";
      row2.appendChild(authorInput);
      var sortSel = el("select", "board-move");
      [["", "Most relevant"], ["new", "Newest first"]].forEach(function(s) {
        var o = el("option", null, s[1]);
        o.value = s[0];
        if (s[0] === sort0) o.selected = true;
        sortSel.appendChild(o);
      });
      row2.appendChild(sortSel);
      form.appendChild(row2);
      section.appendChild(form);
      var authorPicker = attachAuthorPicker(authorInput);
      if (/^[0-9a-f]{64}$/.test(author0)) authorPicker.set(author0, displayName(author0));
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        var u = "community.html?q=" + encodeURIComponent(qInput.value.trim());
        if (catSel.value) u += "&cat=" + catSel.value;
        if (authorPicker.hash()) u += "&author=" + authorPicker.hash();
        if (sortSel.value) u += "&sort=" + sortSel.value;
        location.href = u;
      });
      var count = el("p", "comments-status", "");
      section.appendChild(count);
      var list = el("div", "board-topics");
      section.appendChild(list);
      if (!q.trim()) {
        count.textContent = 'Type a search above. Put "quotes" around an exact phrase.';
        return;
      }
      count.textContent = "Searching...";
      var page = Math.max(1, Math.floor(Number(qs.get("p")) || 1));
      function apiUrl(pg) {
        var u = API + "/search?q=" + encodeURIComponent(q);
        if (cat0) u += "&cat=" + encodeURIComponent(cat0);
        if (author0) u += "&author=" + encodeURIComponent(author0);
        if (sort0) u += "&sort=" + encodeURIComponent(sort0);
        return u + "&p=" + pg;
      }
      function pageHref(i) {
        var u = "community.html?q=" + encodeURIComponent(q);
        if (cat0) u += "&cat=" + encodeURIComponent(cat0);
        if (author0) u += "&author=" + encodeURIComponent(author0);
        if (sort0) u += "&sort=" + encodeURIComponent(sort0);
        return u + "&p=" + i;
      }
      fetchRetry(apiUrl(page) + freshParam("&"), freshOpts(), [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        list.textContent = "";
        if (!d.items.length) {
          count.textContent = "Nothing found for that search.";
          return;
        }
        count.textContent = d.total + (d.total === 1 ? " result." : " results.");
        d.items.forEach(function(it) {
          var rowEl = el("div", "board-topic");
          var left = el("div", "board-topic-left");
          var a = el("a", "board-topic-title", it.title || "a thread");
          a.href = "community.html?topic=" + it.topic_id + "#comment-" + it.comment_id;
          left.appendChild(a);
          if (it.snip) left.appendChild(searchSnippet(it.snip));
          rowEl.appendChild(left);
          var who = it.nick || (it.author_hash ? displayName(it.author_hash) : "Anonymous");
          var ce = catByKey(it.cat);
          rowEl.appendChild(el("div", "board-stats", who + " \xB7 " + (ce ? ce[1] : it.cat) + " \xB7 " + fmtDateTime(it.created_at)));
          list.appendChild(rowEl);
        });
        var top = pageBar(d.total, d.per, d.page, pageHref);
        if (top) section.insertBefore(top, list);
        var bot = pageBar(d.total, d.per, d.page, pageHref);
        if (bot) section.appendChild(bot);
      }).catch(function() {
        count.textContent = "";
        list.textContent = "";
        list.appendChild(el("p", "comments-status", "Search could not be run. Check your connection and reload the page."));
      });
    }
    var MERECAT_API = "/api/merecat";
    var MERECAT_BOT_HASH = "efb94d8de69dc537e2bba1facbd9db3f849f3927593488d19c07629ce35f54cc";
    function merecatResetLocal() {
      var d = /* @__PURE__ */ new Date();
      var next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
      try {
        return next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } catch (e) {
        return "midnight UTC";
      }
    }
    function ensureMerecatStyles() {
      if (document.getElementById("mc-merecat-css")) return;
      var css = ".merecat-intro{display:flex;gap:.65rem;align-items:flex-start;border:1px solid var(--rule);background:var(--surface);border-radius:6px;padding:.7rem .9rem;margin:1rem 0}.merecat-cat{font-size:1.7rem;line-height:1.1}.merecat-intro p{margin:.15rem 0;font-size:.92rem}.merecat-log{margin:.8rem 0}.merecat-msg{border:1px solid var(--rule);border-radius:6px;padding:.55rem .8rem;margin:.55rem 0;max-width:92%}.merecat-msg.you{margin-left:auto;background:var(--cream)}.merecat-msg.cat{background:var(--surface)}.merecat-who{font-size:.78rem;color:var(--faint);margin-bottom:.3rem}.merecat-body{white-space:pre-wrap;overflow-wrap:break-word}.merecat-body blockquote{margin:.5em 0 .5em .8em;padding-left:.6em;border-left:3px solid var(--rule);color:var(--ink-soft);white-space:normal}.merecat-wait{color:var(--faint);font-style:italic}.merecat-note{color:var(--maroon)}.merecat-srcs{margin-top:.55rem;padding-top:.45rem;border-top:1px dashed var(--rule);font-size:.84rem}.merecat-srcs a{display:block;margin:.15rem 0}.merecat-about{border:1px solid var(--rule);border-radius:6px;background:color-mix(in srgb,var(--surface) 80%,transparent);margin:.6rem 0;padding:.1rem .9rem}.merecat-about>summary{cursor:pointer;padding:.5rem 0;color:var(--maroon);font-size:.92rem}.merecat-about-body{padding:.1rem 0 .8rem}.merecat-about-body h3{margin:1em 0 .3em;font-size:1rem}.merecat-about-body p{margin:.4em 0;font-size:.92rem}.merecat-about-body ul{margin:.4em 0 .4em 1.3em;padding:0;font-size:.9rem}.merecat-about-body li{margin:.15em 0}.merecat-shelf{margin:.4em 0}.merecat-shelf>summary{cursor:pointer;color:var(--maroon);font-size:.9rem}.merecat-persona{white-space:pre-wrap;overflow-wrap:break-word;font-size:.85rem;color:var(--ink-soft);border-left:3px solid var(--rule);padding:.4em .8em;margin:.5em 0}.merecat-form{display:flex;gap:.5rem;align-items:flex-end;margin:.8rem 0 .2rem}.merecat-q{flex:1;min-height:3.1em;resize:vertical;font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.5rem .65rem}.merecat-q:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}.merecat-quota{color:var(--faint);font-size:.85rem;margin:.15rem 0 .9rem}.merecat-persona-edit{width:100%;min-height:26em;font:inherit;font-size:.9rem;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:.6rem .7rem;margin:.4rem 0;resize:vertical;white-space:pre-wrap}.merecat-persona-edit:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}.merecat-quota strong{color:var(--maroon)}.merecat-working{display:inline-flex;align-items:center;gap:.5em;color:var(--faint);font-style:italic}.merecat-working .mc-cat-work{font-style:normal;display:inline-block;font-size:1.15em;animation:mc-bob 1s ease-in-out infinite}.merecat-working .mc-spin{display:inline-block;width:.85em;height:.85em;border:2px solid var(--rule);border-top-color:var(--maroon);border-radius:50%;animation:mc-spin .8s linear infinite}.merecat-working .mc-secs{font-style:normal;font-variant-numeric:tabular-nums;color:var(--ink-soft);min-width:2.4em}@keyframes mc-spin{to{transform:rotate(360deg)}}@keyframes mc-bob{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-3px) rotate(6deg)}}.mc-fwd{margin:.45rem 0 .3rem;border:1px solid var(--rule);border-radius:6px;background:var(--cream);padding:.55rem .65rem;font-size:.9rem;color:var(--ink)}.mc-fwd-head{display:flex;justify-content:space-between;align-items:baseline;gap:.6rem}.mc-fwd-crumb{margin:.3rem 0 .1rem;font-size:.85rem;color:var(--ink-soft)}.mc-fwd input{width:100%;box-sizing:border-box;font:inherit;font-size:max(16px,.95rem);color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:.45rem .55rem;margin:.3rem 0 .4rem}.mc-fwd input:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}.mc-fwd-list{max-height:min(45vh,19rem);overflow-y:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--rule);border-radius:4px;background:var(--surface)}.mc-fwd-row{display:block;width:100%;text-align:left;font:inherit;font-size:.9rem;color:var(--ink);background:none;border:0;border-bottom:1px solid var(--rule);padding:.55rem .6rem;cursor:pointer}.mc-fwd-row:last-child{border-bottom:0}.mc-fwd-row:hover,.mc-fwd-row:focus{background:var(--cream)}.mc-fwd-meta{color:var(--faint);font-size:.82rem}.mc-fwd-locked{opacity:.55;cursor:default}.mc-fwd-locked:hover{background:none}.mc-fwd-more{color:var(--maroon)}.mc-fwd-empty{padding:.55rem .6rem;color:var(--faint)}.mc-fwd-note{color:var(--maroon);font-size:.85rem;margin:.25rem 0 0}.mc-fwd-sure{margin:.35rem 0 .5rem}.mc-fwd-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.9rem}.mc-fwd-go{font:inherit;font-size:.9rem;padding:.4rem .9rem;cursor:pointer}@media (max-width:620px){.merecat-msg{max-width:100%}.merecat-form{flex-direction:column;align-items:stretch}.mc-fwd-list{max-height:50vh}}";
      var st = el("style");
      st.id = "mc-merecat-css";
      st.textContent = css;
      document.head.appendChild(st);
    }
    function viewMerecat() {
      document.title = "Ask Merecat AI | Mere Catholicity";
      var crumbP = crumb([["Community", "community.html"], ["merecat"]]);
      function setCrumb(tail) {
        crumbP.textContent = "";
        var short = tail ? tail.length > 48 ? tail.slice(0, 48) + "\u2026" : tail : "";
        var parts = [["Community", "community.html"]];
        if (short) {
          parts.push(["merecat", "merecat-ai.html"]);
          parts.push([short]);
        } else parts.push(["merecat"]);
        parts.forEach(function(part, i) {
          if (i) crumbP.appendChild(document.createTextNode(" \u203A "));
          if (part[1]) {
            var a = el("a", null, part[0]);
            a.href = part[1];
            crumbP.appendChild(a);
          } else {
            crumbP.appendChild(el("span", null, part[0]));
          }
        });
        document.title = (short ? short + " | " : "") + "Ask Merecat AI | Mere Catholicity";
      }
      var loggedIn = !!isMember();
      ensureMerecatStyles();
      var intro = el("div", "merecat-intro");
      intro.appendChild(el("span", "merecat-cat", "\u{1F408}"));
      var ib = el("div");
      var p1 = el("p");
      p1.appendChild(el("strong", null, "merecat"));
      p1.appendChild(document.createTextNode(
        " is the community\u2019s AI librarian, trained to be well-versed within the exact contents of our "
      ));
      var libLink = el("a", "body-link", "Library page");
      libLink.href = "library.html";
      p1.appendChild(libLink);
      p1.appendChild(document.createTextNode(". "));
      var more = el("span", "merecat-intro-more");
      more.appendChild(document.createTextNode(
        "It answers Orthodox, Roman Catholic, and Protestant questions alike from a merely catholic ground. merecat specializes in theology and the contents of our Library. Anything off-topic will be of a substantially lower quality. "
      ));
      var moreTgl = el("a", "merecat-intro-toggle", "read more");
      moreTgl.href = "#";
      moreTgl.addEventListener("click", function(e) {
        e.preventDefault();
        var open = more.style.display === "inline";
        more.style.display = open ? "none" : "inline";
        moreTgl.textContent = open ? "read more" : "read less";
      });
      p1.appendChild(more);
      p1.appendChild(moreTgl);
      ib.appendChild(p1);
      intro.appendChild(ib);
      section.appendChild(intro);
      var chatId = Number(new URLSearchParams(location.search).get("chat")) || 0;
      if (chatId) setCrumb("Conversation " + chatId);
      var past = el("details", "merecat-about");
      if (!loggedIn) past.hidden = true;
      past.appendChild(el("summary", null, "Past conversations"));
      var pastBody = el("div", "merecat-about-body");
      past.appendChild(pastBody);
      var actNote = el("p", "comments-status");
      actNote.hidden = true;
      past.appendChild(actNote);
      function actSay(msg) {
        actNote.textContent = msg;
        actNote.hidden = !msg;
        if (msg) setTimeout(function() {
          actNote.hidden = true;
        }, 7e3);
      }
      var pastLoaded = false;
      function loadList(attempt) {
        pastBody.textContent = attempt ? "The desk is busy for a moment \u2014 retrying\u2026" : "Loading\u2026";
        fetchRetry(MERECAT_API + "/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }, [1e3, 3e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (blockedOut(d)) return;
          if (!d.ok || !d.chats) {
            if (readThrottled(d) && attempt < 2) {
              readEase();
              setTimeout(function() {
                loadList(attempt + 1);
              }, 6e3);
              return;
            }
            pastBody.textContent = "";
            pastBody.appendChild(el("p", null, "Could not load the list. Reopen to retry."));
            pastLoaded = false;
            return;
          }
          var chats = d.chats;
          function resyncChats() {
            return fetchRetry(MERECAT_API + "/chats", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key })
            }, [1e3]).then(function(r) {
              return r.json();
            }).then(function(d2) {
              if (d2.ok && d2.chats) {
                chats = d2.chats;
                renderChats();
              }
            }).catch(function() {
            });
          }
          function chatRow(c) {
            var row = el("div", "board-topic mc-cardnav");
            var left = el("div", "board-topic-left");
            var a = el("a", "board-topic-title", c.title || "Conversation " + c.id);
            a.href = "merecat-ai.html?chat=" + c.id;
            left.appendChild(a);
            row.appendChild(left);
            row.appendChild(el(
              "div",
              "board-stats",
              c.msgs + (c.msgs === 1 ? " message \xB7 " : " messages \xB7 ") + new Date(c.last_at * 1e3).toLocaleDateString()
            ));
            var corner = el("div", "board-admin-corner");
            var sv = el("a", "trust-toggle", c.saved ? "unsave" : "save");
            sv.href = "#";
            sv.title = c.saved ? "Return this conversation to the thirty-day keeping" : "Keep this conversation permanently";
            sv.addEventListener("click", function(e) {
              e.preventDefault();
              var proceed = function() {
                var want = c.saved ? 0 : 1;
                c.saved = want;
                renderChats();
                fetchRetry(MERECAT_API + "/chat/save", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: state.key, id: c.id, save: want })
                }, [1e3]).then(function(r) {
                  return r.json();
                }).then(function(dd) {
                  if (!dd.ok) {
                    c.saved = want ? 0 : 1;
                    renderChats();
                    actSay((want ? "Could not save: " : "Could not unsave: ") + (dd.error || "try again in a moment."));
                  }
                }).catch(function() {
                  resyncChats().then(function() {
                    actSay("Connection hiccup \u2014 the list was refreshed from the server.");
                  });
                });
              };
              var expired = c.saved && c.last_at < Math.floor(Date.now() / 1e3) - 30 * 86400;
              if (expired) appConfirm("This conversation is older than thirty days. Unsaving lets it expire, and it may be removed at once. Continue?", { okLabel: "Unsave" }, function(ok) {
                if (ok) proceed();
              });
              else proceed();
            });
            corner.appendChild(sv);
            corner.appendChild(document.createTextNode(" \xB7 "));
            var del = el("a", "trust-toggle danger", "delete");
            del.href = "#";
            del.addEventListener("click", function(e) {
              e.preventDefault();
              appConfirm("Delete this conversation outright? There is no undo.", { okLabel: "Delete", danger: true }, function(ok) {
                if (!ok) return;
                fetchRetry(MERECAT_API + "/chat/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: state.key, id: c.id })
                }, [1e3]).then(function(r) {
                  return r.json();
                }).then(function(dd) {
                  if (dd.ok) {
                    chats = chats.filter(function(x) {
                      return x !== c;
                    });
                    renderChats();
                    if (c.id === chatId) location.href = "merecat-ai.html";
                  } else {
                    actSay("Could not delete: " + (dd.error || "try again in a moment."));
                  }
                }).catch(function() {
                  resyncChats().then(function() {
                    actSay("Connection hiccup \u2014 the list was refreshed from the server. Try the delete again if it still stands.");
                  });
                });
              });
            });
            corner.appendChild(del);
            row.appendChild(corner);
            row.addEventListener("click", function(e) {
              if (e.target.closest("a, button")) return;
              if (window.getSelection && String(window.getSelection()).length) return;
              a.click();
            });
            return row;
          }
          function renderChats() {
            pastBody.textContent = "";
            if (!chats.length) {
              pastBody.appendChild(el("p", "comments-status", "No conversations yet. Threads appear here as you ask, and expire thirty days after their last message unless you save them."));
              return;
            }
            var saved = chats.filter(function(c) {
              return c.saved;
            });
            var recent = chats.filter(function(c) {
              return !c.saved;
            });
            function group(label, list) {
              if (!list.length) return;
              var h = el("p", "mc-past-head");
              h.appendChild(el("strong", null, label));
              pastBody.appendChild(h);
              var wrap = el("div", "board-topics");
              list.forEach(function(c) {
                wrap.appendChild(chatRow(c));
              });
              pastBody.appendChild(wrap);
            }
            group("Saved conversations (kept permanently)", saved);
            group("Kept thirty days", recent);
          }
          renderChats();
        }).catch(function() {
          pastBody.textContent = "Could not load the list. Reopen to retry.";
          pastLoaded = false;
        });
      }
      past.addEventListener("toggle", function() {
        if (!past.open || pastLoaded) return;
        pastLoaded = true;
        loadList(0);
      });
      var log = el("div", "merecat-log");
      section.appendChild(log);
      if (!loggedIn) {
        var join = el("div", "merecat-intro");
        var jb = el("div");
        var jp = el("p");
        jp.appendChild(el("strong", null, "Asking takes one click. "));
        jp.appendChild(document.createTextNode(
          "Create a free identity, no email and no forms, and the question box below opens. "
        ));
        jb.appendChild(jp);
        join.appendChild(jb);
        section.appendChild(join);
        section.appendChild(el("div", "comment-identity"));
        var mkKeyBox = el("div", "key-box");
        mkKeyBox.hidden = true;
        section.appendChild(mkKeyBox);
        renderIdentity();
      }
      var form = el("form", "merecat-form");
      var q = el("textarea", "merecat-q");
      q.placeholder = "Ask the librarian\u2026 say, what do the Fathers make of John 6:53?";
      q.setAttribute("aria-label", "Your question");
      form.appendChild(q);
      var send = el("button", "btn btn-send", "Ask");
      send.type = "submit";
      form.appendChild(send);
      section.appendChild(form);
      section.appendChild(past);
      if (loggedIn && !chatId) {
        past.open = true;
        pastLoaded = true;
        loadList(0);
      }
      if (loggedIn && !chatId) {
        var starter = el("div", "mc-cat-starter");
        starter.appendChild(el("span", "mc-cat-starter-ico", "\u{1F408}"));
        starter.appendChild(el("h3", null, "Ask the librarian"));
        starter.appendChild(el(
          "p",
          null,
          "A question about the Fathers, the councils, Newman, or anything in our Library."
        ));
        var chips = el("div", "mc-cat-chips");
        [
          "What do the Fathers make of John 6:53?",
          "How does Newman describe the development of doctrine?",
          "What did the Council of Nicaea settle?"
        ].forEach(function(ex) {
          var chip = el("button", "mc-cat-chip", ex);
          chip.type = "button";
          chip.addEventListener("click", function() {
            q.value = ex;
            q.dispatchEvent(new Event("input", { bubbles: true }));
            try {
              q.focus();
            } catch (e2) {
            }
          });
          chips.appendChild(chip);
        });
        starter.appendChild(chips);
        log.appendChild(starter);
        form.addEventListener("submit", function() {
          if (starter.parentNode) starter.remove();
        }, { once: true });
      }
      if (!loggedIn) {
        var askPlaceholder = q.placeholder;
        q.disabled = true;
        send.disabled = true;
        q.placeholder = "Create your free identity above, and ask away\u2026";
        var mkIdBox = section.querySelector(".comment-identity");
        if (mkIdBox) {
          new MutationObserver(function() {
            if (!isMember()) return;
            q.disabled = false;
            send.disabled = false;
            q.placeholder = askPlaceholder;
            if (typeof past !== "undefined" && past) past.hidden = false;
            if (typeof join !== "undefined" && join && join.parentNode) join.remove();
            q.focus();
          }).observe(mkIdBox, { childList: true });
        }
      }
      var quota = el("p", "merecat-quota");
      section.appendChild(quota);
      var MC_MODES = [
        ["instant", "Instant (Cloudflare, no wait)"],
        ["off", "Local \xB7 thinking off"],
        ["low", "Local \xB7 thinking: Low"],
        ["medium", "Local \xB7 thinking: Medium"],
        ["high", "Local \xB7 thinking: High"],
        ["xhigh", "Local \xB7 thinking: Extra high"],
        ["max", "Local \xB7 thinking: Max"]
      ];
      var modeRow = el("p", "merecat-quota");
      modeRow.hidden = true;
      modeRow.appendChild(document.createTextNode("Reasoning: "));
      var modeSel = el("select", "scripture-sel");
      MC_MODES.forEach(function(m) {
        var o = el("option", null, m[1]);
        o.value = m[0];
        modeSel.appendChild(o);
      });
      try {
        modeSel.value = localStorage.getItem("mc-merecat-mode") || "high";
      } catch (e) {
      }
      if (!modeSel.value) modeSel.value = "high";
      modeSel.addEventListener("change", function() {
        try {
          localStorage.setItem("mc-merecat-mode", modeSel.value);
        } catch (e) {
        }
      });
      modeSel.setAttribute("aria-label", "Reasoning");
      modeRow.appendChild(modeSel);
      section.appendChild(modeRow);
      if (window.mcSelectSheet) window.mcSelectSheet(modeSel);
      function renderQuota(u) {
        if (!u) return;
        if (u.backend) modeRow.hidden = u.backend !== "local";
        if (u.backend === "local") {
          quota.hidden = true;
          quota.textContent = "";
          return;
        }
        quota.hidden = false;
        quota.textContent = "";
        if (u.cap_on) {
          quota.appendChild(document.createTextNode("You have used "));
          quota.appendChild(el("strong", null, u.you + " of " + u.cap));
          quota.appendChild(document.createTextNode(
            " questions today" + (u.admin ? " (admin: the cap does not stop you, your use still counts)" : "") + " \xB7 the community " + u.today + " of " + u.gcap + " \xB7 counters renew at " + merecatResetLocal() + " your time"
          ));
        } else {
          quota.appendChild(document.createTextNode("The community has used "));
          quota.appendChild(el("strong", null, u.today + " of " + u.gcap));
          quota.appendChild(document.createTextNode(
            " shared questions today \xB7 you have asked " + u.you + " \xB7 counters renew at " + merecatResetLocal() + " your time"
          ));
        }
      }
      if (loggedIn) {
        fetchRetry(MERECAT_API + "/usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }, [1e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (d.ok) renderQuota(d);
        }).catch(function() {
        });
      }
      function nearPageBottom() {
        return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
      }
      function bubble(who) {
        var m = el("div", "merecat-msg " + (who === "you" ? "you" : "cat"));
        m.appendChild(el("div", "merecat-who", who === "you" ? state.myNick || displayName(state.myHash) : "\u{1F408} merecat"));
        var body = el("div", "merecat-body");
        m.appendChild(body);
        var follow = nearPageBottom();
        log.appendChild(m);
        if (follow) m.scrollIntoView({ block: "nearest" });
        return { msg: m, body };
      }
      function citeRenumber(text, sources) {
        text = String(text || "");
        if (!sources || !sources.length) return { text, sources: [] };
        var firstAt = {};
        text.replace(/\[(\d+)\]/g, function(m, n, at) {
          var num = Number(n);
          var known = sources.some(function(s) {
            return s.n === num;
          });
          if (known && firstAt[num] === void 0) firstAt[num] = at;
          return m;
        });
        var order = Object.keys(firstAt).map(Number).sort(function(a, b) {
          return firstAt[a] - firstAt[b];
        });
        if (!order.length) return { text, sources: [] };
        var renum = {};
        order.forEach(function(n, i) {
          renum[n] = i + 1;
        });
        var out = text.replace(/\[(\d+)\]/g, function(m, n) {
          return renum[Number(n)] ? "[" + renum[Number(n)] + "]" : m;
        });
        var used = sources.filter(function(s) {
          return renum[s.n];
        }).map(function(s) {
          return { n: renum[s.n], title: s.title, heading: s.heading, url: s.url };
        }).sort(function(a, b) {
          return a.n - b.n;
        });
        return { text: out, sources: used };
      }
      function attachForward(bubbleMsg, msgSel) {
        if (!state.key) return;
        var whoDiv = bubbleMsg.querySelector(".merecat-who");
        if (!whoDiv) return;
        whoDiv.appendChild(document.createTextNode(" \xB7 "));
        var f = el("a", "identity-action", "forward to the board");
        f.href = "#";
        var open = null;
        f.addEventListener("click", function(e) {
          e.preventDefault();
          if (!chatId) return;
          if (open && open.isConnected) {
            open.remove();
            open = null;
            return;
          }
          open = forwardPicker(whoDiv, f, msgSel);
          whoDiv.parentNode.insertBefore(open, whoDiv.nextSibling);
        });
        whoDiv.appendChild(f);
      }
      function forwardPicker(whoDiv, f, msgSel) {
        var panel = el("div", "mc-fwd");
        var pickedCat = null;
        var pickedTopic = null;
        var seq = 0;
        var lastQ = "", lastP = 1;
        var debounce = null;
        var deskTop = window.matchMedia && window.matchMedia("(hover: hover)").matches;
        var head = el("div", "mc-fwd-head");
        head.appendChild(el("strong", null, "Forward to the board"));
        var close = el("a", "identity-action", "cancel");
        close.href = "#";
        close.addEventListener("click", function(e) {
          e.preventDefault();
          panel.remove();
        });
        head.appendChild(close);
        panel.appendChild(head);
        var crumbLine = el("div", "mc-fwd-crumb");
        panel.appendChild(crumbLine);
        var input = el("input");
        input.type = "search";
        panel.appendChild(input);
        var listBox = el("div", "mc-fwd-list");
        panel.appendChild(listBox);
        var confirmBox = el("div", "mc-fwd-confirm");
        confirmBox.hidden = true;
        panel.appendChild(confirmBox);
        var note = el("div", "mc-fwd-note");
        panel.appendChild(note);
        function allowedCats() {
          return CATS.filter(function(c) {
            return c[0] !== "adminsonly" || isAdmin();
          });
        }
        function stepCats() {
          pickedCat = null;
          pickedTopic = null;
          crumbLine.textContent = "Pick a category:";
          input.value = "";
          input.placeholder = "type to narrow the categories\u2026";
          input.hidden = false;
          listBox.hidden = false;
          confirmBox.hidden = true;
          note.textContent = "";
          renderCats("");
          if (deskTop) input.focus();
        }
        function renderCats(q2) {
          var ql = q2.replace(/\s+/g, " ").trim().toLowerCase();
          listBox.textContent = "";
          var shown = allowedCats().filter(function(c) {
            return !ql || c[1].toLowerCase().indexOf(ql) !== -1 || c[0].indexOf(ql) !== -1;
          });
          if (!shown.length) {
            listBox.appendChild(el("div", "mc-fwd-empty", "No category matches."));
            return;
          }
          shown.forEach(function(c) {
            var b = el("button", "mc-fwd-row");
            b.type = "button";
            b.appendChild(el("strong", null, c[1]));
            if (c[0] === "adminsonly") b.appendChild(el("span", "mc-fwd-meta", " \xB7 the back room"));
            b.addEventListener("click", function() {
              pickedCat = c;
              stepTopics();
            });
            listBox.appendChild(b);
          });
        }
        function stepTopics() {
          pickedTopic = null;
          crumbLine.textContent = "";
          var back = el("a", "identity-action", "\u2039 categories");
          back.href = "#";
          back.addEventListener("click", function(e) {
            e.preventDefault();
            stepCats();
          });
          crumbLine.appendChild(back);
          crumbLine.appendChild(document.createTextNode(" \xB7 " + pickedCat[1] + " \u2014 pick the topic:"));
          input.value = "";
          input.placeholder = "scroll, or type to narrow the topics\u2026";
          input.hidden = false;
          listBox.hidden = false;
          confirmBox.hidden = true;
          note.textContent = "";
          lastQ = "";
          lastP = 1;
          loadTopics("", 1, false);
          if (deskTop) input.focus();
        }
        function fetchTopics(q2, p) {
          return (pickedCat[0] === "adminsonly" ? fetchRetry(API + "/board/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key || "", p, q: q2 })
          }, [1e3]) : fetchRetry(API + "/board/cat?cat=" + pickedCat[0] + "&p=" + p + (q2 ? "&q=" + encodeURIComponent(q2) : "") + freshParam("&"), freshOpts(), [1e3])).then(function(r) {
            return r.json();
          });
        }
        function loadTopics(q2, p, append) {
          var mySeq = ++seq;
          if (!append) {
            listBox.textContent = "";
            listBox.appendChild(el("div", "mc-fwd-empty", "Loading\u2026"));
          }
          fetchTopics(q2, p).then(function(d) {
            if (mySeq !== seq) return;
            if (!d.ok) throw new Error(d.error || "failed");
            if (append) {
              var oldMore = listBox.querySelector(".mc-fwd-more");
              if (oldMore) oldMore.remove();
            } else {
              listBox.textContent = "";
            }
            lastQ = q2;
            lastP = p;
            if (!d.topics.length && p === 1) {
              listBox.appendChild(el(
                "div",
                "mc-fwd-empty",
                q2 ? "No topic matches." : "No topics here yet."
              ));
              return;
            }
            d.topics.forEach(function(t) {
              var b = el("button", "mc-fwd-row" + (t.locked ? " mc-fwd-locked" : ""));
              b.type = "button";
              b.appendChild(el("strong", null, t.title));
              b.appendChild(el("span", "mc-fwd-meta", " \xB7 " + t.replies + (t.replies === 1 ? " reply" : " replies") + (t.sticky ? " \xB7 sticky" : "") + (t.locked ? " \xB7 locked" : "")));
              if (t.locked) b.disabled = true;
              else {
                b.addEventListener("click", function() {
                  pickedTopic = { id: t.id, title: t.title };
                  stepConfirm();
                });
              }
              listBox.appendChild(b);
            });
            var left = d.total - d.page * d.per;
            if (left > 0) {
              var more2 = el(
                "button",
                "mc-fwd-row mc-fwd-more",
                "show more (" + left + " more)"
              );
              more2.type = "button";
              more2.addEventListener("click", function() {
                more2.disabled = true;
                more2.textContent = "loading\u2026";
                loadTopics(lastQ, lastP + 1, true);
              });
              listBox.appendChild(more2);
            }
          }).catch(function() {
            if (mySeq !== seq) return;
            if (!append) listBox.textContent = "";
            var oldMore = listBox.querySelector(".mc-fwd-more");
            if (oldMore) oldMore.remove();
            listBox.appendChild(el("div", "mc-fwd-empty", "Could not load the topics. Type to retry."));
          });
        }
        listBox.addEventListener("scroll", function() {
          if (listBox.scrollTop + listBox.clientHeight < listBox.scrollHeight - 60) return;
          var more2 = listBox.querySelector(".mc-fwd-more");
          if (more2 && !more2.disabled) more2.click();
        });
        input.addEventListener("input", function() {
          if (!pickedCat) {
            renderCats(input.value);
            return;
          }
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(function() {
            var q2 = input.value.replace(/\s+/g, " ").trim();
            if (q2 === lastQ) return;
            loadTopics(q2, 1, false);
          }, 300);
        });
        function stepConfirm() {
          input.hidden = true;
          listBox.hidden = true;
          note.textContent = "";
          confirmBox.textContent = "";
          confirmBox.hidden = false;
          confirmBox.appendChild(el(
            "p",
            "mc-fwd-sure",
            (pickedCat[0] === "adminsonly" ? "Post this answer into the admins-only back room, to \u201C" + pickedTopic.title + "\u201D" : "Post this answer publicly to \u201C" + pickedTopic.title + "\u201D in " + pickedCat[1]) + ", under the librarian\u2019s name, marked as forwarded by you?"
          ));
          var go = el("button", "mc-fwd-go", "Forward it");
          go.type = "button";
          go.addEventListener("click", function() {
            go.disabled = true;
            note.textContent = "forwarding\u2026";
            fetchRetry(MERECAT_API + "/forward", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, chat: chatId, msg: msgSel, topic: pickedTopic.id })
            }, [1e3]).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (d.ok) {
                var v = el("a", "identity-action", "forwarded \u2713 view it");
                v.href = "community.html?topic=" + d.topic + "#comment-" + d.id;
                whoDiv.replaceChild(v, f);
                panel.remove();
              } else {
                go.disabled = false;
                note.textContent = d.error || "Forward failed.";
              }
            }).catch(function() {
              go.disabled = false;
              note.textContent = "Network hiccup. Try again.";
            });
          });
          var back = el("a", "identity-action", "back to the topics");
          back.href = "#";
          back.addEventListener("click", function(e) {
            e.preventDefault();
            pickedTopic = null;
            confirmBox.hidden = true;
            input.hidden = false;
            listBox.hidden = false;
            note.textContent = "";
          });
          var row = el("div", "mc-fwd-actions");
          row.appendChild(go);
          row.appendChild(back);
          confirmBox.appendChild(row);
        }
        stepCats();
        return panel;
      }
      function mcScrubLabel(t) {
        return String(t || "").replace(/<\/?[a-zA-Z][^>]{0,300}?>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      }
      function srcFooter(node, sources) {
        if (!sources || !sources.length) return;
        var f = el("div", "merecat-srcs");
        f.appendChild(el("strong", null, "Sources: "));
        sources.forEach(function(s) {
          var t = "[" + s.n + "] " + mcScrubLabel(s.title) + (s.heading ? " \u2014 " + mcScrubLabel(s.heading) : "");
          if (s.url) {
            var a = el("a", "body-link", t);
            a.href = s.url;
            scriptureDecor(a, s.url);
            f.appendChild(a);
          } else {
            f.appendChild(el("span", "merecat-src-plain", t));
          }
        });
        node.appendChild(f);
      }
      var pendingBox = el("p", "merecat-quota");
      pendingBox.hidden = true;
      section.appendChild(pendingBox);
      var askQueue = [];
      var busy = false;
      var liveChat = null;
      if (typeof bootSig !== "undefined" && bootSig) {
        bootSig.addEventListener("abort", function() {
          if (liveChat) {
            try {
              liveChat.close();
            } catch (e) {
            }
            liveChat = null;
          }
        });
      }
      var unloadGuard = null;
      function syncUnloadGuard() {
        if (askQueue.length && !unloadGuard) {
          unloadGuard = function(e) {
            e.preventDefault();
            e.returnValue = "";
          };
          window.addEventListener("beforeunload", unloadGuard, { signal: bootSig });
        } else if (!askQueue.length && unloadGuard) {
          window.removeEventListener("beforeunload", unloadGuard);
          unloadGuard = null;
        }
      }
      function renderPending2() {
        syncUnloadGuard();
        pendingBox.textContent = "";
        if (!askQueue.length) {
          pendingBox.hidden = true;
          return;
        }
        pendingBox.hidden = false;
        pendingBox.appendChild(el(
          "strong",
          null,
          askQueue.length + (askQueue.length === 1 ? " question" : " questions") + " queued (waiting to be asked): "
        ));
        askQueue.forEach(function(it, i) {
          if (i) pendingBox.appendChild(document.createTextNode(" \xB7 "));
          pendingBox.appendChild(document.createTextNode(
            it.text.slice(0, 40) + (it.text.length > 40 ? "\u2026" : "") + " "
          ));
          var x = el("a", "body-link", "\u2715");
          x.href = "#";
          x.title = "Cancel this question";
          x.addEventListener("click", function(e) {
            e.preventDefault();
            var idx = askQueue.indexOf(it);
            if (idx !== -1) {
              askQueue.splice(idx, 1);
              renderPending2();
            }
          });
          pendingBox.appendChild(x);
        });
      }
      function enqueue(text) {
        askQueue.push({ text });
        renderPending2();
        drain();
      }
      function drain() {
        if (stale()) return;
        if (busy || !askQueue.length) return;
        busy = true;
        var item = askQueue.shift();
        renderPending2();
        askWs(item.text);
      }
      function startWorking(body, startMs) {
        body.textContent = "";
        var wrap = el("div", "merecat-working");
        wrap.appendChild(el("span", "mc-cat-work", "\u{1F408}"));
        wrap.appendChild(el("span", "mc-spin"));
        var status = el("span", "mc-status", "merecat is working\u2026");
        var start2 = startMs || Date.now();
        var secs = el("span", "mc-secs", Math.max(0, Math.round((Date.now() - start2) / 1e3)) + "s");
        wrap.appendChild(status);
        wrap.appendChild(secs);
        body.appendChild(wrap);
        var timer = setInterval(function() {
          secs.textContent = Math.round((Date.now() - start2) / 1e3) + "s";
        }, 250);
        return {
          setStatus: function(t) {
            status.textContent = t;
          },
          stop: function() {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      }
      function stickyFollow() {
        var follow = nearPageBottom();
        var followY = window.scrollY;
        var touchY = 0;
        function onScroll() {
          var y = window.scrollY;
          if (y > followY + 2 && nearPageBottom()) follow = true;
          else if (y < followY - 2 && !nearPageBottom()) follow = false;
          followY = y;
        }
        function onWheel(e) {
          if (e.deltaY < 0) follow = false;
        }
        function onTouchStart(e) {
          if (e.touches && e.touches.length) touchY = e.touches[0].clientY;
        }
        function onTouchMove(e) {
          if (!(e.touches && e.touches.length)) return;
          var y = e.touches[0].clientY;
          if (y > touchY + 8) follow = false;
          touchY = y;
        }
        window.addEventListener("scroll", onScroll, { passive: true, signal: bootSig });
        window.addEventListener("wheel", onWheel, { passive: true, signal: bootSig });
        window.addEventListener("touchstart", onTouchStart, { passive: true, signal: bootSig });
        window.addEventListener("touchmove", onTouchMove, { passive: true, signal: bootSig });
        return {
          bottom: function() {
            if (follow) window.scrollTo(0, document.documentElement.scrollHeight);
          },
          stop: function() {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("wheel", onWheel);
            window.removeEventListener("touchstart", onTouchStart);
            window.removeEventListener("touchmove", onTouchMove);
          }
        };
      }
      function resumeWs(userRow, partialRow) {
        if (!window.WebSocket || !window.mcLive || !window.mcLive.chat) {
          var cno = bubble("cat");
          cno.body.appendChild(el(
            "span",
            "merecat-note",
            "The librarian is still finishing this answer, but this browser blocked the live connection. Reopen the conversation shortly to read it."
          ));
          return;
        }
        var cat = bubble("cat");
        var sticky = stickyFollow();
        var startMs = Number(userRow.created_at) * 1e3 || Date.now();
        var acc = partialRow && partialRow.body ? String(partialRow.body) : "";
        var shown = 0, flowTimer = null, painted = false, settled = false, streamDone = false;
        var sources = null, handle = null, idleChecked = false;
        var working = startWorking(cat.body, startMs);
        working.setStatus("rejoining the librarian\u2026");
        function endTurn() {
          if (settled) return;
          settled = true;
          working.stop();
          if (flowTimer) {
            clearInterval(flowTimer);
            flowTimer = null;
          }
          sticky.stop();
          if (handle) {
            try {
              handle.close();
            } catch (e) {
            }
            if (liveChat === handle) liveChat = null;
            handle = null;
          }
        }
        function paint(finalBody, finalSources, fwdId) {
          if (painted) return;
          painted = true;
          var body = (finalBody != null ? finalBody : acc).replace(/\s+$/, "");
          var srcs = finalSources != null ? finalSources : sources || [];
          cat.body.textContent = "";
          if (!body) {
            cat.body.appendChild(el("span", "merecat-note", "\u2014 this answer never finished. Ask again when you like."));
          } else {
            var rr = citeRenumber(body, srcs);
            fillBody(cat.body, rr.text, true);
            srcFooter(cat.body, rr.sources);
            if (fwdId) attachForward(cat.msg, fwdId);
          }
          sticky.bottom();
          endTurn();
        }
        function tick() {
          if (painted) {
            if (flowTimer) {
              clearInterval(flowTimer);
              flowTimer = null;
            }
            return;
          }
          var backlog = acc.length - shown;
          if (backlog > 0) {
            shown = Math.min(acc.length, shown + Math.max(2, Math.ceil(backlog / 15)));
            cat.body.textContent = acc.slice(0, shown);
            sticky.bottom();
          } else if (streamDone) {
            clearInterval(flowTimer);
            flowTimer = null;
            paint(null, null, "last");
          }
        }
        function ensureFlow() {
          if (!flowTimer) flowTimer = setInterval(tick, 40);
        }
        function idleCheck() {
          if (idleChecked || painted) return;
          idleChecked = true;
          readMark();
          fetchRetry(MERECAT_API + "/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, id: chatId })
          }, [1e3]).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (painted) return;
            var rows = d && d.msgs || [], fin = null;
            for (var i = 0; i < rows.length; i++) {
              var m = rows[i];
              if (m.id <= userRow.id) continue;
              if (m.role === "user") break;
              if (m.role === "assistant" && m.done !== 0) {
                fin = m;
                break;
              }
            }
            if (fin) {
              var s = [];
              try {
                s = JSON.parse(fin.sources || "[]");
              } catch (e) {
              }
              paint(fin.body, s, fin.id);
            } else {
              paint();
            }
          }).catch(function() {
            if (!painted) paint();
          });
        }
        function onFrame(m) {
          if (settled || painted || !m) return;
          if (m.t === "hello") {
            if (m.sources && m.sources.length) sources = m.sources;
            if (m.answer && m.answer.length > acc.length) {
              acc = m.answer;
              working.stop();
              ensureFlow();
            }
            if (m.phase === "done") {
              streamDone = true;
              ensureFlow();
            } else if (m.phase === "idle") {
              idleCheck();
            } else {
              working.setStatus("the librarian is still writing\u2026");
              if (acc) ensureFlow();
            }
          } else if (m.t === "state") {
            if (m.phase === "thinking") working.setStatus("the librarian is reasoning\u2026");
            else if (m.phase === "done") {
              streamDone = true;
              ensureFlow();
            } else if (m.phase === "error") {
              paint();
            }
          } else if (m.t === "meta") {
            sources = m.sources || [];
          } else if (m.t === "tokens") {
            acc += m.d || "";
            if (acc.indexOf("") !== -1) acc = acc.replace(/\u0002/g, "");
            var mk = acc.indexOf("");
            if (mk !== -1) acc = acc.slice(0, mk);
            if (acc) {
              working.stop();
              ensureFlow();
            }
          }
        }
        if (acc) {
          working.stop();
          ensureFlow();
        }
        handle = window.mcLive.chat(chatId, state.key, onFrame);
        liveChat = handle;
        return true;
      }
      function askWs(text) {
        var youB = bubble("you");
        fillBody(youB.body, text);
        if (!chatId) setCrumb(text);
        var cat = bubble("cat");
        var working = startWorking(cat.body);
        var sticky = stickyFollow();
        var acc = "", shown = 0, flowTimer = null, sources = null;
        var streamDone = false, painted = false, settled = false, asked = false, fellBack = false;
        var handle = null, openTimer = null;
        var mode = modeSel.value || "high";
        function endTurn() {
          if (settled) return;
          settled = true;
          working.stop();
          if (flowTimer) {
            clearInterval(flowTimer);
            flowTimer = null;
          }
          sticky.stop();
          if (openTimer) {
            clearTimeout(openTimer);
            openTimer = null;
          }
          if (handle) {
            try {
              handle.close();
            } catch (e) {
            }
            if (liveChat === handle) liveChat = null;
            handle = null;
          }
          busy = false;
          if (askQueue.length) {
            setTimeout(drain, 900);
          } else {
            try {
              q.focus({ preventScroll: true });
            } catch (e) {
              q.focus();
            }
          }
        }
        function tick() {
          if (painted) {
            if (flowTimer) {
              clearInterval(flowTimer);
              flowTimer = null;
            }
            return;
          }
          var backlog = acc.length - shown;
          if (backlog > 0) {
            shown = Math.min(acc.length, shown + Math.max(2, Math.ceil(backlog / 15)));
            cat.body.textContent = acc.slice(0, shown);
            sticky.bottom();
          } else if (streamDone) {
            clearInterval(flowTimer);
            flowTimer = null;
            paint();
          }
        }
        function ensureFlow() {
          if (!flowTimer) flowTimer = setInterval(tick, 40);
        }
        function paint() {
          if (painted) return;
          painted = true;
          acc = acc.replace(/\s+$/, "");
          if (!acc) {
            cat.body.textContent = "";
            cat.body.appendChild(el("span", "merecat-note", "merecat had nothing to say. Try rephrasing."));
          } else {
            var rr = citeRenumber(acc, sources || []);
            cat.body.textContent = "";
            fillBody(cat.body, rr.text, true);
            srcFooter(cat.body, rr.sources);
            attachForward(cat.msg, "last");
          }
          sticky.bottom();
          endTurn();
        }
        function refuse(d) {
          working.stop();
          if (blockedOut(d)) {
            endTurn();
            return;
          }
          cat.body.textContent = "";
          cat.body.appendChild(el(
            "span",
            "merecat-note",
            (d.resting ? "\u{1F408} " : "") + (d.error || "merecat could not answer. Try again shortly.") + (d.resting || d.capped ? " That is " + merecatResetLocal() + " your time." : "")
          ));
          endTurn();
        }
        function giveUpLive(msg) {
          if (fellBack || painted || settled) return;
          fellBack = true;
          if (openTimer) {
            clearTimeout(openTimer);
            openTimer = null;
          }
          if (handle) {
            try {
              handle.close();
            } catch (e) {
            }
            if (liveChat === handle) liveChat = null;
            handle = null;
          }
          working.stop();
          cat.body.textContent = "";
          cat.body.appendChild(el("span", "merecat-note", msg));
          endTurn();
        }
        function onFrame(m) {
          if (settled || fellBack || !m) return;
          if (openTimer) {
            clearTimeout(openTimer);
            openTimer = null;
          }
          if (m.t === "hello") {
            if (m.phase === "idle") {
              if (!asked) {
                asked = true;
                var a = { t: "ask", q: text };
                if (mode === "instant") a.instant = true;
                else a.effort = mode;
                handle.send(a);
              }
            } else {
              asked = true;
              if (m.used) renderQuota(m.used);
              if (m.sources && m.sources.length) sources = m.sources;
              if (m.answer && m.answer.length > acc.length) {
                acc = m.answer;
                working.stop();
                ensureFlow();
              }
              if (m.phase === "done") {
                streamDone = true;
                ensureFlow();
              }
            }
          } else if (m.t === "state") {
            if (m.phase === "queued") {
              var wait = m.place > 0 ? m.place + (m.place === 1 ? " question" : " questions") + " ahead of you in line, please wait" : "no one else is in line, answering you now";
              if (mode === "high") wait += " \u2014 on High this usually takes about a minute";
              else if (mode === "xhigh") wait += " \u2014 at Extra-high this can take a minute or two";
              else if (mode === "max") wait += " \u2014 at Max this can take a couple of minutes";
              working.setStatus(wait);
            } else if (m.phase === "thinking") {
              if (m.used) renderQuota(m.used);
              working.setStatus("sources gathered, the librarian is reasoning\u2026");
            } else if (m.phase === "done") {
              streamDone = true;
              ensureFlow();
            } else if (m.phase === "error") {
              refuse(m);
            }
          } else if (m.t === "meta") {
            sources = m.sources || [];
            if (m.used) renderQuota(m.used);
            working.setStatus("sources gathered, the librarian is reasoning\u2026");
          } else if (m.t === "tokens") {
            acc += m.d || "";
            if (acc.indexOf("") !== -1) acc = acc.replace(/\u0002/g, "");
            var mk = acc.indexOf("");
            if (mk !== -1) acc = acc.slice(0, mk);
            if (acc) {
              working.stop();
              ensureFlow();
            }
          }
        }
        if (!window.WebSocket || !window.mcLive || !window.mcLive.chat) {
          working.stop();
          cat.body.textContent = "";
          cat.body.appendChild(el(
            "span",
            "merecat-note",
            "This browser blocked the live connection to the librarian (WebSocket). Try a different browser or network."
          ));
          endTurn();
          return;
        }
        fetchRetry(MERECAT_API + "/ask-init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, chat: chatId || 0, q: text })
        }, [1e3]).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (settled || fellBack) return;
          if (!d.ok) {
            refuse(d);
            return;
          }
          if (d.chatId && d.chatId !== chatId) {
            chatId = d.chatId;
            if (history.replaceState) history.replaceState(null, "", location.pathname + "?merecat=1&chat=" + chatId);
            setCrumb(text);
          }
          if (d.used) renderQuota(d.used);
          handle = window.mcLive.chat(chatId, state.key, onFrame);
          liveChat = handle;
          openTimer = setTimeout(function() {
            if (!asked && !painted && !settled) giveUpLive("Could not reach the live librarian. Please try again in a moment.");
          }, 12e3);
        }).catch(function() {
          if (settled || fellBack || painted) return;
          giveUpLive("Network hiccup. Ask again.");
        });
      }
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        var text = q.value.trim();
        if (!text) return;
        q.value = "";
        enqueue(text);
      });
      q.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          form.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      });
      if (chatId && loggedIn) {
        var loadNote = el("p", "comments-status", "Reopening the conversation\u2026");
        log.appendChild(loadNote);
        var reopenTries = 0;
        var reopenGo = function() {
          fetchRetry(MERECAT_API + "/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, id: chatId })
          }, [1e3, 3e3]).then(function(r) {
            return r.json();
          }).then(function(d) {
            if (blockedOut(d)) return;
            if (!d.ok) {
              if (/no such conversation/i.test(String(d.error || ""))) {
                loadNote.remove();
                chatId = 0;
                setCrumb("");
                if (history.replaceState) history.replaceState(null, "", location.pathname + "?merecat=1");
                log.appendChild(el("p", "comments-status", "That conversation is gone (expired or deleted). This is a fresh one."));
                return;
              }
              if (readThrottled(d)) readEase();
              throw new Error(d.error || "transient");
            }
            loadNote.remove();
            setCrumb(d.chat && d.chat.title || "Conversation " + chatId);
            var rows = d.msgs || [];
            var lastUser = null;
            for (var ri = rows.length - 1; ri >= 0; ri--) {
              if (rows[ri].role === "user") {
                lastUser = rows[ri];
                break;
              }
            }
            var tailDone = false, tailPartial = null;
            if (lastUser) {
              for (var rj = 0; rj < rows.length; rj++) {
                var rr0 = rows[rj];
                if (rr0.id <= lastUser.id || rr0.role !== "assistant") continue;
                if (rr0.done === 0) tailPartial = rr0;
                else {
                  tailDone = true;
                  break;
                }
              }
            }
            rows.forEach(function(m) {
              if (m.role !== "user" && m.done === 0) return;
              var b = bubble(m.role === "user" ? "you" : "cat");
              if (m.role === "user") {
                fillBody(b.body, m.body);
              } else {
                var srcs = [];
                try {
                  srcs = JSON.parse(m.sources || "[]");
                } catch (e) {
                }
                var rr = citeRenumber(m.body, srcs);
                fillBody(b.body, rr.text, true);
                srcFooter(b.body, rr.sources);
                if (m.id) attachForward(b.msg, m.id);
              }
            });
            if (lastUser && !tailDone) resumeWs(lastUser, tailPartial);
            q.focus();
          }).catch(function() {
            reopenTries += 1;
            if (!stale() && reopenTries < 5) {
              loadNote.textContent = "Reopening the conversation\u2026 (takes a moment)";
              setTimeout(reopenGo, 6e3);
            } else {
              loadNote.textContent = "Could not reopen the conversation. Reload to retry.";
            }
          });
        };
        reopenGo();
      } else {
        if (loggedIn && state.key) {
          var noticeTried = false;
          var noticeGo = function() {
            fetchRetry(MERECAT_API + "/chats", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key })
            }, [1e3]).then(function(r) {
              return r.json();
            }).then(function(d) {
              if (blockedOut(d)) return;
              if (!d.ok) throw new Error("transient");
              if (!d.chats || !d.chats.length) return;
              var newest = d.chats[0];
              if (!newest || newest.last_at < Math.floor(Date.now() / 1e3) - 600) return;
              return fetchRetry(MERECAT_API + "/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key, id: newest.id })
              }, [1e3]).then(function(r2) {
                return r2.json();
              }).then(function(t) {
                if (!t.ok) throw new Error("transient");
                if (!t.msgs || !t.msgs.length) return;
                var rows = t.msgs;
                var lastUser = null;
                for (var i = rows.length - 1; i >= 0; i--) {
                  if (rows[i].role === "user") {
                    lastUser = rows[i];
                    break;
                  }
                }
                if (!lastUser) return;
                for (var j = 0; j < rows.length; j++) {
                  var m = rows[j];
                  if (m.id > lastUser.id && m.role === "assistant" && m.done !== 0) return;
                }
                var note = el("p", "merecat-quota");
                note.appendChild(document.createTextNode("\u{1F408} The librarian is still working on your last question \u2014 "));
                var back = el("a", "body-link", "rejoin it");
                back.href = "merecat-ai.html?chat=" + newest.id;
                note.appendChild(back);
                note.appendChild(document.createTextNode("."));
                log.insertBefore(note, log.firstChild);
              });
            }).catch(function() {
              if (!stale() && !noticeTried) {
                noticeTried = true;
                setTimeout(noticeGo, 8e3);
              }
            });
          };
          noticeGo();
        }
        q.focus();
      }
    }
    function renderBackendSwitch(body) {
      body.appendChild(el("h3", null, "Which librarian answers"));
      var wrap = el("div", "merecat-backends");
      wrap.appendChild(el("p", "comments-status", "Checking the backends\u2026"));
      body.appendChild(wrap);
      function save(val) {
        var note = el("p", "comments-status", "Switching\u2026");
        wrap.appendChild(note);
        fetchRetry(MERECAT_API + "/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, config: { backend: val } })
        }, [1e3]).then(function(r) {
          return r.json();
        }).then(function(dd) {
          note.textContent = dd.ok ? "Now routing to " + (val === "local" ? "this machine (local)" : "Cloudflare") + ". Live across the edge within about five minutes." : dd.error || "Could not switch.";
        }).catch(function() {
          note.textContent = "Could not switch.";
        });
      }
      function saveCfg(obj, label) {
        var note = el("p", "comments-status", "Saving\u2026");
        wrap.appendChild(note);
        fetchRetry(MERECAT_API + "/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, config: obj })
        }, [1e3]).then(function(r) {
          return r.json();
        }).then(function(dd) {
          note.textContent = dd.ok ? label + " saved. Live across the edge within about five minutes." : dd.error || "Could not save.";
        }).catch(function() {
          note.textContent = "Could not save.";
        });
      }
      function draw() {
        fetchRetry(MERECAT_API + "/backends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }, [1e3]).then(function(r) {
          return r.json();
        }).then(function(b) {
          wrap.textContent = "";
          if (!b.ok) {
            wrap.appendChild(el("p", "comments-status", "Could not read backend status."));
            return;
          }
          var cf = b.cloudflare || {}, lo = b.local || {};
          var loLine;
          if (!lo.online) {
            loLine = "offline right now \u2014 the machine, Tailscale, or the satellite link";
          } else {
            loLine = "online \xB7 " + (lo.ms != null ? lo.ms + " ms \xB7 " : "") + (lo.chunks || 0).toLocaleString() + " passages";
            if (lo.tries > 1) loLine += " \xB7 woke on try " + lo.tries;
            if (lo.rerank === "degraded") loLine += " \xB7 reranker degraded, salvage active";
            else if (lo.rerank === "down") loLine += " \xB7 reranker DOWN";
            if (lo.ready === false) loLine += " \xB7 NOT READY: " + (lo.why || "engine fault \u2014 asks go to the cloud");
          }
          [
            [
              "cloudflare",
              "Cloudflare (always on)",
              true,
              "online \xB7 " + (cf.today || 0) + "/" + (cf.gcap || 0) + " questions used today"
            ],
            ["local", "This machine, over Tailscale", !!lo.online, loLine]
          ].forEach(function(o) {
            var row = el("label");
            row.style.display = "block";
            row.style.margin = ".35em 0";
            var radio = el("input");
            radio.type = "radio";
            radio.name = "mc-backend";
            radio.value = o[0];
            radio.checked = b.backend === o[0];
            radio.addEventListener("change", function() {
              if (radio.checked) {
                applyGate(o[0] === "local");
                save(o[0]);
              }
            });
            row.appendChild(radio);
            row.appendChild(el("strong", null, " " + o[1] + "  "));
            var dot = el("span", null, o[2] ? "\u25CF " : "\u25CB ");
            dot.style.color = o[2] ? "#2e7d32" : "#b00";
            row.appendChild(dot);
            row.appendChild(el("span", "comments-status", o[3]));
            wrap.appendChild(row);
          });
          var rp = el("p", "comments-status");
          var refresh = el("a", "body-link", "refresh status");
          refresh.href = "#";
          refresh.addEventListener("click", function(e) {
            e.preventDefault();
            wrap.textContent = "";
            wrap.appendChild(el("p", "comments-status", "Checking\u2026"));
            draw();
          });
          rp.appendChild(refresh);
          wrap.appendChild(rp);
          var frow = el("p");
          var fchk = el("input");
          fchk.type = "checkbox";
          fchk.id = "mc-failover";
          fchk.checked = !!b.failover;
          fchk.addEventListener("change", function() {
            saveCfg({ failover: fchk.checked ? 1 : 0 }, "Failover " + (fchk.checked ? "on" : "off"));
          });
          frow.appendChild(fchk);
          var flbl = el("label", null, " Fail over to Cloudflare if the local librarian is offline");
          flbl.htmlFor = "mc-failover";
          frow.appendChild(flbl);
          wrap.appendChild(frow);
          var mrow = el("p");
          mrow.appendChild(document.createTextNode("@merecat mention reasoning: "));
          var msel = el("select", "scripture-sel");
          [
            ["instant", "Instant (Cloudflare)"],
            ["off", "Off"],
            ["low", "Low"],
            ["medium", "Medium"],
            ["high", "High"],
            ["xhigh", "Extra high"],
            ["max", "Max"]
          ].forEach(function(o) {
            var op = el("option", null, o[1]);
            op.value = o[0];
            msel.appendChild(op);
          });
          msel.value = b.mention_effort || "high";
          msel.addEventListener("change", function() {
            saveCfg({ mention_effort: msel.value }, "Mention reasoning");
          });
          mrow.appendChild(msel);
          wrap.appendChild(mrow);
          var gateNote = el("p", "comments-status", "");
          wrap.appendChild(gateNote);
          function applyGate(isLocal) {
            fchk.disabled = !isLocal;
            msel.disabled = !isLocal;
            frow.style.opacity = isLocal ? "" : "0.45";
            mrow.style.opacity = isLocal ? "" : "0.45";
            gateNote.textContent = isLocal ? "Local is the active backend. The settings below apply." : "Cloudflare is the active backend \u2014 the site behaves exactly as before, and the settings below do not apply.";
          }
          applyGate(b.backend === "local");
          if (!b.configured) wrap.appendChild(el("p", "comments-status", "No local URL is configured on the worker yet."));
        }).catch(function() {
          wrap.textContent = "";
          wrap.appendChild(el("p", "comments-status", "Could not reach the status endpoint."));
        });
      }
      draw();
    }
    function dangerBox(title, explain, btnLabel, run) {
      var box = el("div", "admin-danger");
      box.appendChild(el("div", "admin-danger-title", title));
      box.appendChild(el("p", "admin-danger-explain", explain));
      var btn = el("button", "btn admin-danger-btn", btnLabel);
      btn.type = "button";
      var note = el("span", "form-status admin-danger-note");
      btn.addEventListener("click", function() {
        run(btn, note);
      });
      box.appendChild(btn);
      box.appendChild(note);
      return box;
    }
    function viewPlatformSettings() {
      document.title = "Platform settings | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["Platform settings"]]);
      if (adminGate(viewPlatformSettings)) return;
      ensureDmStyles();
      var wrap = el("div", "admin-settings");
      wrap.textContent = "Loading\u2026";
      section.appendChild(wrap);
      fetch(API + "/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        wrap.textContent = "";
        var s = d.settings || {};
        var cap = Number(d.cap_bytes) || 10 * 1024 * 1024 * 1024;
        wrap.appendChild(el("p", "board-intro", "Each area below is self-contained: its settings and any one-time cleanup for it sit together. Private direct-message media and the public feed are two separate stores \u2014 a control in one never touches the other."));
        wrap.appendChild(el("h3", null, "Direct messages"));
        wrap.appendChild(el("p", "board-cat-desc", "Private, end-to-end encrypted messages between members, and the photos, audio, and video attached to them. These controls affect DM attachments only \u2014 the public feed is a separate store, further down."));
        var used = Number(s.dm_media_bytes) || 0;
        wrap.appendChild(el("p", "board-cat-desc", "Attachment storage in use: " + fmtBytes(used) + " of " + fmtBytes(cap) + " (" + Math.round(used / cap * 100) + "%)."));
        var enRow = el("p", "admin-set-row");
        var enCb = el("input");
        enCb.type = "checkbox";
        enCb.checked = s.media_enabled === "1";
        enRow.appendChild(enCb);
        enRow.appendChild(document.createTextNode(" Let members attach photos, audio, and video to DMs"));
        wrap.appendChild(enRow);
        var szRow = el("p", "admin-set-row");
        szRow.appendChild(document.createTextNode("Largest attachment (MB): "));
        var szInp = el("input");
        szInp.type = "number";
        szInp.min = "1";
        szInp.max = "100";
        szInp.value = String(Math.round((Number(s.media_max_bytes) || 26214400) / 1048576));
        szRow.appendChild(szInp);
        wrap.appendChild(szRow);
        var ttlRow = el("p", "admin-set-row");
        ttlRow.appendChild(document.createTextNode("Default disappear time for new conversations: "));
        var ttlSel = el("select");
        dmTtlChoices().forEach(function(o) {
          var opt = el("option", null, o[1]);
          opt.value = String(o[0]);
          if (Number(s.dm_default_ttl) === o[0]) opt.selected = true;
          ttlSel.appendChild(opt);
        });
        ttlRow.appendChild(ttlSel);
        wrap.appendChild(ttlRow);
        wrap.appendChild(el("p", "board-cat-desc", "Messages disappear this long after the recipient first opens them. A member can change it per conversation or save a single message from disappearing."));
        var bsRow = el("p", "admin-set-row");
        bsRow.appendChild(document.createTextNode("Backstop for unopened messages (days): "));
        var bsInp = el("input");
        bsInp.type = "number";
        bsInp.min = "1";
        bsInp.max = "365";
        bsInp.value = String(Number(s.dm_backstop_days) || 30);
        bsRow.appendChild(bsInp);
        wrap.appendChild(bsRow);
        wrap.appendChild(el("p", "board-cat-desc", "A never-opened message is deleted after this many days regardless, so nothing lingers forever."));
        wrap.appendChild(dangerBox(
          "Purge all DM attachments now",
          "Immediately and permanently delete every photo, audio, and video from every private conversation, of any age (opened, unopened, and saved alike). Message text is kept. This is a one-time cleanup \u2014 it does not change the settings above \u2014 and cannot be undone.",
          "Purge all DM attachments",
          function(btn, note) {
            appConfirm("Delete EVERY attachment from ALL private conversations, of any age? Message text is kept. This cannot be undone.", { okLabel: "Purge all", danger: true }, function(ok) {
              if (!ok) return;
              btn.disabled = true;
              note.textContent = " Purging\u2026";
              fetch(API + "/dm/media/purge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key })
              }).then(function(r) {
                return r.json();
              }).then(function(d3) {
                btn.disabled = false;
                note.textContent = d3 && d3.ok ? " Purged " + d3.deleted + " files." : " Purge failed.";
              }).catch(function() {
                btn.disabled = false;
                note.textContent = " Purge failed.";
              });
            });
          }
        ));
        wrap.appendChild(el("h3", null, "Public feed & member walls"));
        wrap.appendChild(el("p", "board-cat-desc", "The public posts anyone can see \u2014 the community feed and members\u2019 own walls \u2014 together with any images attached to them. Separate from the private DM store above. (Forum topics are kept permanently and are not affected here.)"));
        var wpEnRow = el("p", "admin-set-row");
        var wpEn = el("input");
        wpEn.type = "checkbox";
        wpEn.checked = s.wall_prune_enabled === "1";
        wpEnRow.appendChild(wpEn);
        wpEnRow.appendChild(document.createTextNode(" Automatically delete old public posts (off = keep forever)"));
        wrap.appendChild(wpEnRow);
        var wpRow = el("p", "admin-set-row");
        wpRow.appendChild(document.createTextNode("Retention \u2014 delete public posts older than: "));
        var wpSel = el("select");
        (d.wall_prune_options || [90, 180, 365]).forEach(function(n) {
          var label = n === 365 ? "1 year" : n === 180 ? "6 months" : n === 90 ? "3 months" : n + " days";
          var o = el("option", null, label);
          o.value = String(n);
          if (Number(s.wall_prune_days) === n) o.selected = true;
          wpSel.appendChild(o);
        });
        wpRow.appendChild(wpSel);
        wrap.appendChild(wpRow);
        wrap.appendChild(el("p", "board-cat-desc", "This retention drives both the automatic sweep above and the button below. Save your choice first if you changed it and want the sweep to use it."));
        wrap.appendChild(dangerBox(
          "Prune old public posts now",
          "Delete public feed and wall posts \u2014 and their images \u2014 older than the retention chosen just above, right now. Posts newer than that stay. This runs once; it does not require the automatic sweep to be on. Cannot be undone.",
          "Prune old public posts",
          function(btn, note) {
            var days = Number(wpSel.value) || 365;
            var human = days === 365 ? "a year" : days === 180 ? "6 months" : days === 90 ? "3 months" : days + " days";
            appConfirm("Delete public feed and wall posts (and their images) older than " + human + " right now? Newer posts stay. This cannot be undone.", { okLabel: "Prune now", danger: true }, function(ok) {
              if (!ok) return;
              btn.disabled = true;
              note.textContent = " Pruning\u2026";
              fetch(API + "/wall/prune", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: state.key, days })
              }).then(function(r) {
                return r.json();
              }).then(function(d4) {
                btn.disabled = false;
                note.textContent = d4 && d4.ok ? " Deleted " + d4.deleted + " posts." : " Prune failed.";
              }).catch(function() {
                btn.disabled = false;
                note.textContent = " Prune failed.";
              });
            });
          }
        ));
        wrap.appendChild(el("h3", null, "The Mere Catholicity Journal"));
        wrap.appendChild(el("p", "board-cat-desc", "The public Journal page turns the posts of one forum topic into journal articles. Point it at a topic here, then open that topic and mark it read-only (from its admin controls) so only the site can post into it."));
        var jEnRow = el("p", "admin-set-row");
        var jEn = el("input");
        jEn.type = "checkbox";
        jEn.checked = s.journal_enabled !== "0";
        jEnRow.appendChild(jEn);
        jEnRow.appendChild(document.createTextNode(" Journal page is live"));
        wrap.appendChild(jEnRow);
        var jRow = el("p", "admin-set-row");
        jRow.appendChild(document.createTextNode("Journal source topic (its numeric id): "));
        var jInp = el("input");
        jInp.type = "number";
        jInp.min = "1";
        jInp.value = String(Number(s.journal_topic) || 219);
        jRow.appendChild(jInp);
        wrap.appendChild(jRow);
        var jLinkP = el("p", "board-cat-desc");
        jLinkP.appendChild(document.createTextNode("View it at "));
        var jLink = el("a", "body-link", "the Journal");
        jLink.href = "journal.html";
        jLinkP.appendChild(jLink);
        jLinkP.appendChild(document.createTextNode("."));
        wrap.appendChild(jLinkP);
        wrap.appendChild(el("h3", null, "Media & uploads"));
        wrap.appendChild(el(
          "p",
          "board-cat-desc",
          "What members may attach and how large, everywhere media is allowed. The \u201CLargest attachment\u201D above is the overall ceiling \u2014 a per-kind limit never rises past it."
        ));
        var mdefs = window.mcCore.mediaDefaults;
        function mediaMbRow(label, key, defBytes) {
          var r = el("p", "admin-set-row");
          r.appendChild(document.createTextNode(label + " (MB): "));
          var inp = el("input");
          inp.type = "number";
          inp.min = "1";
          inp.max = "100";
          inp.value = String(Math.round((Number(s[key]) || defBytes) / 1048576));
          r.appendChild(inp);
          wrap.appendChild(r);
          return inp;
        }
        var miImg = mediaMbRow("Largest image", "media_image_max_bytes", Number(mdefs.imageMaxBytes));
        var miVid = mediaMbRow("Largest video", "media_video_max_bytes", Number(mdefs.videoMaxBytes));
        var miAud = mediaMbRow("Largest audio", "media_audio_max_bytes", Number(mdefs.audioMaxBytes));
        var vsRow = el("p", "admin-set-row");
        vsRow.appendChild(document.createTextNode("Voice note limit (seconds): "));
        var vsInp = el("input");
        vsInp.type = "number";
        vsInp.min = "30";
        vsInp.max = "600";
        vsInp.value = String(Number(s.media_audio_max_seconds) || Number(mdefs.audioMaxSeconds));
        vsRow.appendChild(vsInp);
        wrap.appendChild(vsRow);
        var acRow = el("p", "admin-set-row");
        var acCb = el("input");
        acCb.type = "checkbox";
        acCb.checked = s.media_image_autocompress == null ? true : s.media_image_autocompress === "1";
        acRow.appendChild(acCb);
        acRow.appendChild(document.createTextNode(" Auto-compress images in the browser before upload"));
        wrap.appendChild(acRow);
        wrap.appendChild(el("p", "board-cat-desc", "What each surface accepts. Unticking everything turns that surface\u2019s uploads off."));
        function mediaKindsRow(label, key, defMask) {
          var r = el("p", "admin-set-row");
          r.appendChild(document.createTextNode(label + ": "));
          var cur = window.mcCore.mediaParseKinds(s[key] == null ? defMask : s[key]);
          var boxes = [];
          ["image", "video", "audio"].forEach(function(kn) {
            var cb = el("input");
            cb.type = "checkbox";
            cb.checked = cur.indexOf(kn) !== -1;
            cb.value = kn;
            r.appendChild(cb);
            r.appendChild(document.createTextNode(" " + kn + "  "));
            boxes.push(cb);
          });
          wrap.appendChild(r);
          return { csv: function() {
            return boxes.filter(function(b) {
              return b.checked;
            }).map(function(b) {
              return b.value;
            }).join(",");
          } };
        }
        var mkDm = mediaKindsRow("Direct messages", "media_kinds_dm", mdefs.kindsDm);
        var mkWall = mediaKindsRow("Feed & walls", "media_kinds_wall", mdefs.kindsWall);
        var mkBoard = mediaKindsRow("Forum board", "media_kinds_board", mdefs.kindsBoard);
        function mediaGbRow(label, key, defBytes, usedBytes) {
          var r = el("p", "admin-set-row");
          r.appendChild(document.createTextNode(label + " (GB): "));
          var inp = el("input");
          inp.type = "number";
          inp.min = "1";
          inp.max = "9";
          inp.step = "0.5";
          var curB = Number(s[key]) || defBytes;
          inp.value = String(Math.round(curB / 1073741824 * 10) / 10);
          r.appendChild(inp);
          r.appendChild(document.createTextNode("  \u2014 " + fmtBytes(usedBytes) + " of " + fmtBytes(curB) + " used"));
          wrap.appendChild(r);
          return inp;
        }
        var mcDm = mediaGbRow("Direct-message media budget", "media_cap_dm_bytes", Number(mdefs.capDmBytes), Number(s.dm_media_bytes) || 0);
        var mcWall = mediaGbRow("Feed, wall & board media budget", "media_cap_wall_bytes", Number(mdefs.capWallBytes), Number(s.wall_media_bytes) || 0);
        var saveBtn = el("button", "btn btn-send", "Save settings");
        saveBtn.type = "button";
        var saveStatus = el("p", "form-status");
        saveBtn.addEventListener("click", function() {
          saveBtn.disabled = true;
          saveStatus.textContent = "Saving\u2026";
          fetch(API + "/admin/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, set: {
              media_enabled: enCb.checked ? "1" : "0",
              media_max_bytes: String(Math.round((Number(szInp.value) || 25) * 1048576)),
              dm_default_ttl: ttlSel.value,
              dm_backstop_days: bsInp.value,
              wall_prune_enabled: wpEn.checked ? "1" : "0",
              wall_prune_days: wpSel.value,
              journal_enabled: jEn.checked ? "1" : "0",
              journal_topic: jInp.value,
              media_image_max_bytes: String(Math.round((Number(miImg.value) || Number(mdefs.imageMaxBytes) / 1048576) * 1048576)),
              media_video_max_bytes: String(Math.round((Number(miVid.value) || Number(mdefs.videoMaxBytes) / 1048576) * 1048576)),
              media_audio_max_bytes: String(Math.round((Number(miAud.value) || Number(mdefs.audioMaxBytes) / 1048576) * 1048576)),
              media_audio_max_seconds: String(Math.floor(Number(vsInp.value) || Number(mdefs.audioMaxSeconds))),
              media_image_autocompress: acCb.checked ? "1" : "0",
              media_kinds_dm: mkDm.csv(),
              media_kinds_wall: mkWall.csv(),
              media_kinds_board: mkBoard.csv(),
              media_cap_dm_bytes: String(Math.round((Number(mcDm.value) || Number(mdefs.capDmBytes) / 1073741824) * 1073741824)),
              media_cap_wall_bytes: String(Math.round((Number(mcWall.value) || Number(mdefs.capWallBytes) / 1073741824) * 1073741824))
            } })
          }).then(function(r) {
            return r.json();
          }).then(function(d2) {
            saveBtn.disabled = false;
            saveStatus.textContent = d2 && d2.ok ? "Saved." : d2 && d2.error || "Save failed.";
          }).catch(function() {
            saveBtn.disabled = false;
            saveStatus.textContent = "Save failed.";
          });
        });
        wrap.appendChild(el("hr", "admin-set-rule"));
        wrap.appendChild(saveBtn);
        wrap.appendChild(saveStatus);
      }).catch(function() {
        wrap.textContent = "The settings could not be loaded.";
      });
    }
    function viewDiscordHooks() {
      document.title = "Discord webhooks | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["Discord webhooks"]]);
      if (adminGate(viewDiscordHooks)) return;
      var wrap = el("div", "admin-settings");
      section.appendChild(wrap);
      wrap.appendChild(el(
        "p",
        "board-intro",
        "Announce community activity to Discord. Create a channel webhook in Discord under Server Settings \u2192 Integrations \u2192 Webhooks, then paste it here."
      ));
      wrap.appendChild(el("h3", null, "Global webhooks"));
      wrap.appendChild(el("p", "board-cat-desc", "Fire on EVERY new post. Leave a box empty to turn that one off."));
      var gBox = el("div");
      gBox.textContent = "Loading\u2026";
      wrap.appendChild(gBox);
      fetch(API + "/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        gBox.textContent = "";
        var s = d.settings || {};
        var dfRow = el("p", "admin-set-row mc-set-key");
        dfRow.appendChild(el("label", null, "Forum posts webhook (new topics & replies):"));
        var dfInp = el("input");
        dfInp.type = "url";
        dfInp.placeholder = "https://discord.com/api/webhooks/\u2026";
        dfInp.value = String(s.discord_forum_webhook || "");
        dfRow.appendChild(dfInp);
        gBox.appendChild(dfRow);
        var dgRow = el("p", "admin-set-row mc-set-key");
        dgRow.appendChild(el("label", null, "Feed posts webhook:"));
        var dgInp = el("input");
        dgInp.type = "url";
        dgInp.placeholder = "https://discord.com/api/webhooks/\u2026";
        dgInp.value = String(s.discord_feed_webhook || "");
        dgRow.appendChild(dgInp);
        gBox.appendChild(dgRow);
        var fcRow = el("p", "admin-set-row");
        var fcCb = el("input");
        fcCb.type = "checkbox";
        fcCb.checked = s.discord_feed_comments === "1";
        fcRow.appendChild(fcCb);
        fcRow.appendChild(document.createTextNode(" Also notify on comments to feed posts (noisier as the community grows)"));
        gBox.appendChild(fcRow);
        var gSave = el("button", "btn btn-send", "Save global webhooks");
        gSave.type = "button";
        var gStatus = el("p", "form-status");
        gSave.addEventListener("click", function() {
          gSave.disabled = true;
          gStatus.textContent = "Saving\u2026";
          fetch(API + "/admin/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, set: {
              discord_forum_webhook: dfInp.value.trim(),
              discord_feed_webhook: dgInp.value.trim(),
              discord_feed_comments: fcCb.checked ? "1" : "0"
            } })
          }).then(function(r) {
            return r.json();
          }).then(function(d2) {
            gSave.disabled = false;
            gStatus.textContent = d2 && d2.ok ? "Saved." : d2 && d2.error || "Save failed.";
          }).catch(function() {
            gSave.disabled = false;
            gStatus.textContent = "Save failed.";
          });
        });
        gBox.appendChild(gSave);
        gBox.appendChild(gStatus);
      }).catch(function() {
        gBox.textContent = "The global webhooks could not be loaded.";
      });
      wrap.appendChild(el("h3", null, "Per-feed subscriptions"));
      wrap.appendChild(el(
        "p",
        "board-cat-desc",
        "Post one feed to one Discord channel. Paste one of our feed URLs \u2014 for example https://merecatholicity.com/api/comments/feed?topic=219 for a single thread, ?cat=general for a whole category, or ?page=/credo.html for a page\u2019s comments \u2014 and the channel\u2019s webhook. Every new post in that feed is posted to the channel automatically."
      ));
      var listBox = el("div", "discord-hooks-list");
      wrap.appendChild(listBox);
      var form = el("div", "admin-settings");
      var fRow = el("p", "admin-set-row mc-set-key");
      fRow.appendChild(el("label", null, "Feed URL:"));
      var feedInp = el("input");
      feedInp.type = "url";
      feedInp.placeholder = "https://merecatholicity.com/api/comments/feed?topic=219";
      fRow.appendChild(feedInp);
      form.appendChild(fRow);
      var hRow = el("p", "admin-set-row mc-set-key");
      hRow.appendChild(el("label", null, "Discord webhook URL:"));
      var hookInp = el("input");
      hookInp.type = "url";
      hookInp.placeholder = "https://discord.com/api/webhooks/\u2026";
      hRow.appendChild(hookInp);
      form.appendChild(hRow);
      var lRow = el("p", "admin-set-row mc-set-key");
      lRow.appendChild(el("label", null, "Label (optional):"));
      var labelInp = el("input");
      labelInp.type = "text";
      labelInp.placeholder = "e.g. #announcements";
      lRow.appendChild(labelInp);
      form.appendChild(lRow);
      var addBtn = el("button", "btn btn-send", "Add subscription");
      addBtn.type = "button";
      var addStatus = el("p", "form-status");
      addBtn.addEventListener("click", function() {
        var feed = feedInp.value.trim(), hook = hookInp.value.trim();
        if (!feed || !hook) {
          addStatus.textContent = "Both a feed URL and a Discord webhook are required.";
          return;
        }
        addBtn.disabled = true;
        addStatus.textContent = "Adding\u2026";
        fetch(API + "/admin/discord/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key, feed_url: feed, hook_url: hook, label: labelInp.value.trim() })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          addBtn.disabled = false;
          if (d && d.ok) {
            addStatus.textContent = "Added: " + (d.scope_label || d.scope) + ".";
            feedInp.value = "";
            hookInp.value = "";
            labelInp.value = "";
            loadHooks();
          } else {
            addStatus.textContent = d && d.error || "Could not add.";
          }
        }).catch(function() {
          addBtn.disabled = false;
          addStatus.textContent = "Could not add.";
        });
      });
      form.appendChild(addBtn);
      form.appendChild(addStatus);
      wrap.appendChild(form);
      function loadHooks() {
        listBox.textContent = "Loading subscriptions\u2026";
        fetch(API + "/admin/discord/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: state.key })
        }).then(function(r) {
          return r.json();
        }).then(function(d) {
          if (!d.ok) throw new Error(d.error || "failed");
          listBox.textContent = "";
          var hooks = d.hooks || [];
          if (!hooks.length) {
            listBox.appendChild(el("p", "board-cat-desc", "No per-feed subscriptions yet."));
            return;
          }
          hooks.forEach(function(h) {
            var row = el("div", "board-cat");
            var left = el("div", "board-cat-left");
            left.appendChild(el("div", "board-cat-name", (h.label ? h.label + " \u2014 " : "") + (h.scope_label || h.scope)));
            left.appendChild(el("div", "board-cat-desc", "Feed: " + h.feed_url));
            left.appendChild(el("div", "board-cat-desc", "Channel: " + (h.hook_hint || "webhook")));
            row.appendChild(left);
            var rm = el("button", "btn btn-plain", "Remove");
            rm.type = "button";
            rm.addEventListener("click", function() {
              appConfirm("Stop posting this feed to Discord?", { okLabel: "Remove", danger: true }, function(ok) {
                if (!ok) return;
                rm.disabled = true;
                fetch(API + "/admin/discord/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: state.key, id: h.id })
                }).then(function(r) {
                  return r.json();
                }).then(function() {
                  loadHooks();
                }).catch(function() {
                  rm.disabled = false;
                });
              });
            });
            row.appendChild(rm);
            listBox.appendChild(row);
          });
        }).catch(function() {
          listBox.textContent = "The subscriptions could not be loaded.";
        });
      }
      loadHooks();
    }
    function viewMerecatAdmin() {
      document.title = "merecat administration | Community";
      crumb([["Community", "community.html"], ["Administrative options", "admin.html"], ["merecat"]]);
      if (adminGate(viewMerecatAdmin)) return;
      ensureMerecatStyles();
      var box = el("div", "merecat-about");
      box.setAttribute("open", "");
      var body = el("div", "merecat-about-body");
      box.appendChild(body);
      section.appendChild(box);
      body.textContent = "Loading the librarian\u2019s dials\u2026";
      fetchRetry(MERECAT_API + "/about", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: state.key })
      }, [1e3, 3e3]).then(function(r) {
        return r.json();
      }).then(function(d) {
        if (!d.ok) throw new Error(d.error || "failed");
        body.textContent = "";
        renderBackendSwitch(body);
        body.appendChild(el("h3", null, "Usage today"));
        body.appendChild(el(
          "p",
          null,
          "The community has used " + d.today + " of its " + d.global_daily + " shared questions. Counters renew at " + merecatResetLocal() + " your time."
        ));
        body.appendChild(el("h3", null, "The per-member daily cap"));
        var row = el("p");
        var chk = el("input");
        chk.type = "checkbox";
        chk.id = "mc-cap-on";
        chk.checked = !!d.user_cap_on;
        row.appendChild(chk);
        var lbl = el("label", null, " Limit each member to ");
        lbl.htmlFor = "mc-cap-on";
        row.appendChild(lbl);
        var num = el("input", "key-input");
        num.type = "number";
        num.min = "1";
        num.max = "500";
        num.value = d.user_daily;
        num.style.width = "5em";
        row.appendChild(num);
        row.appendChild(document.createTextNode(" questions per day. Unchecked, members draw freely until the community budget is spent. Admins are never capped either way. These caps guard the Cloudflare budget and apply only when Cloudflare answers; questions answered by the local librarian are never capped."));
        body.appendChild(row);
        var save = el("button", "btn btn-send", "Save");
        save.type = "button";
        var note = el("p", "comments-status", "");
        save.addEventListener("click", function() {
          var n = Math.max(1, Math.min(500, Math.floor(Number(num.value) || 10)));
          num.value = n;
          save.disabled = true;
          note.textContent = "Saving\u2026";
          fetchRetry(MERECAT_API + "/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: state.key, config: { user_cap_on: chk.checked ? 1 : 0, user_daily: n } })
          }, [1e3]).then(function(r) {
            return r.json();
          }).then(function(dd) {
            note.textContent = dd.ok ? "Saved. The change reaches every corner of the edge within about five minutes." : dd.error || "Could not save.";
          }).catch(function() {
            note.textContent = "Could not save. Try again.";
          }).then(function() {
            save.disabled = false;
          });
        });
        body.appendChild(save);
        body.appendChild(note);
        if (d.backend === "local") {
          chk.disabled = true;
          num.disabled = true;
          save.disabled = true;
          row.style.opacity = "0.5";
          note.textContent = "Local mode is active \u2014 these Cloudflare caps and the community quota do not apply. They govern strict Cloudflare mode only.";
        }
        body.appendChild(el(
          "p",
          "comments-status",
          "Note: caps changed here also govern @merecat mentions in threads. The librarian\u2019s open-book panel updates itself to match."
        ));
        body.appendChild(el("h3", null, "The standing instructions, verbatim, as the model receives them"));
        body.appendChild(el(
          "p",
          null,
          "Edit and save, and the librarian answers under the new instructions within about five minutes, everywhere at once. A save here stands until librarian/persona.md in the repo is next edited, whose push then replaces it. The open-book panel always shows whatever stands."
        ));
        var pTa = el("textarea", "merecat-persona-edit");
        pTa.value = d.persona || "";
        body.appendChild(pTa);
        var pSave = el("button", "btn btn-send", "Save the instructions");
        pSave.type = "button";
        var pNote = el("p", "comments-status", "");
        pSave.addEventListener("click", function() {
          var text = pTa.value.trim();
          if (!text) {
            pNote.textContent = "The instructions cannot be empty.";
            return;
          }
          var doSave = function() {
            pSave.disabled = true;
            pNote.textContent = "Saving\u2026";
            fetchRetry(MERECAT_API + "/config", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: state.key, persona: text })
            }, [1e3]).then(function(r) {
              return r.json();
            }).then(function(dd) {
              pNote.textContent = dd.ok ? "Saved. The librarian answers under these instructions within about five minutes." : dd.error || "Could not save.";
            }).catch(function() {
              pNote.textContent = "Could not save. Try again.";
            }).then(function() {
              pSave.disabled = false;
            });
          };
          if (text.length < 200) appConfirm("These instructions are very short. Replace the librarian\u2019s whole standing instructions with them?", { okLabel: "Replace", danger: true }, function(ok) {
            if (ok) doSave();
          });
          else doSave();
        });
        body.appendChild(pSave);
        body.appendChild(pNote);
      }).catch(function() {
        body.textContent = "Could not load the dials. Reload to retry.";
      });
    }
    function classicRoute(params) {
      if (params.get("ipbans")) return { tag: "IpBans" };
      if (params.get("settings")) return { tag: "Settings" };
      if (params.get("admins")) return { tag: "Admins" };
      if (params.get("admin")) return { tag: "AdminHome" };
      if (params.get("discord")) return { tag: "Discord" };
      if (params.get("shadowbans")) return { tag: "Shadowbans" };
      if (params.get("merecatadmin")) return { tag: "MerecatAdmin" };
      if (params.get("merecatthread")) return { tag: "MerecatThread", s: params.get("merecatthread") };
      if (params.get("merecatthreads") !== null) return { tag: "MerecatThreads" };
      if (params.get("merecat")) return { tag: "Merecat" };
      if (params.get("feed")) return { tag: "Feed" };
      if (params.get("notifications")) return { tag: "Notifications" };
      if (params.get("inbox")) return { tag: "Inbox" };
      if (params.get("users")) return { tag: "Users" };
      if (params.get("q") !== null) return { tag: "Search" };
      if (params.get("dm")) return { tag: "Dm", s: params.get("dm") };
      if (params.get("me")) return { tag: "Me" };
      if (params.get("profile")) return { tag: "Profile", s: params.get("profile") };
      if (params.get("post")) return { tag: "Post", s: params.get("post") };
      if (params.get("audit")) return { tag: "Audit" };
      var topic = Number(params.get("topic"));
      if (Number.isInteger(topic) && topic > 0) return { tag: "Topic", n: topic };
      if (params.get("cat")) return { tag: "Cat", s: params.get("cat") };
      return { tag: "Index" };
    }
    function viewJoin(what) {
      var wrap = el("div", "mc-join");
      wrap.appendChild(el("p", "comments-status", "Create an identity to " + what + ". One tap, no email, no signup."));
      var btn = el("button", "btn btn-send", "Create an identity");
      btn.type = "button";
      btn.addEventListener("click", function() {
        if (window.mcOnboard) window.mcOnboard();
        else location.href = "community.html";
      });
      wrap.appendChild(btn);
      var have = el("p", "mc-join-havekey");
      have.appendChild(identityAction("I already have a key", function() {
        if (window.mcOnboard) window.mcOnboard(null, { key: true });
        else location.href = "community.html";
      }));
      wrap.appendChild(have);
      section.appendChild(wrap);
    }
    function route() {
      section.textContent = "";
      var params = new URLSearchParams(location.search);
      var page = location.pathname.split("/").pop() || "index.html";
      var atMatch = location.pathname.match(/^\/@([A-Za-z0-9_]+)\/?$/);
      if (atMatch) {
        if (!isMember()) return viewJoin("view members' profiles");
        return viewProfileByHandle(atMatch[1].toLowerCase());
      }
      if (page === "messages.html") {
        if (!isMember()) return viewJoin("read and send messages");
        var dmh = params.get("dm");
        return dmh ? viewDm(dmh) : viewInbox();
      }
      if (page === "profile.html") {
        var u = params.get("u") || params.get("profile");
        if (!isMember()) return viewJoin(u ? "view members' profiles" : "set up your profile");
        if (u && !/^[0-9a-f]{64}$/.test(u)) return viewProfileByHandle(u);
        return viewProfile(u || state.myHash);
      }
      if (page === "merecat-ai.html") {
        if (!isMember()) return viewJoin("ask the librarian");
        return viewMerecat();
      }
      if (page === "feed.html") {
        var fpost = params.get("post");
        if (fpost) return viewPost(Number(fpost));
        if (!isMember()) return viewJoin("see and post to the community feed");
        return viewFeed();
      }
      if (page === "journal.html") {
        var jart = params.get("a");
        return jart ? viewJournalArticle(Number(jart)) : viewJournal();
      }
      var r = window.mcCore ? window.mcCore.parseRoute(function(k) {
        return params.get(k);
      }) : classicRoute(params);
      if (page === "admin.html" && r.tag === "Index") r = { tag: "AdminHome" };
      switch (r.tag) {
        case "Dm":
          location.replace("messages.html?dm=" + encodeURIComponent(r.s) + location.hash);
          return;
        case "Inbox":
          location.replace("messages.html");
          return;
        case "Me":
          location.replace("profile.html");
          return;
        case "Profile":
          location.replace("profile.html?u=" + encodeURIComponent(r.s));
          return;
        case "Merecat":
          location.replace("merecat-ai.html" + (params.get("chat") ? "?chat=" + encodeURIComponent(params.get("chat")) : ""));
          return;
        case "IpBans":
          return viewIpBans();
        case "Settings":
          return viewPlatformSettings();
        case "Admins":
          return viewAdmins();
        case "AdminHome":
          return viewAdminHome();
        case "Discord":
          return viewDiscordHooks();
        case "Shadowbans":
          return viewShadowbans();
        case "MerecatAdmin":
          return viewMerecatAdmin();
        case "MerecatThread":
          return viewMerecatThread(Number(r.s));
        case "MerecatThreads":
          return viewMerecatThreads();
        case "Notifications":
          return viewNotifications();
        case "Users":
          return viewUsers();
        case "Search":
          return viewSearch();
        case "Audit":
          return viewAudit();
        case "Feed":
          location.replace("feed.html" + location.hash);
          return;
        case "Post":
          location.replace("feed.html?post=" + encodeURIComponent(r.s) + location.hash);
          return;
        case "Topic":
          return viewTopic(r.n);
        case "Cat":
          return viewCat(r.s);
        default:
          return viewIndex();
      }
    }
    function routeSafe() {
      try {
        route();
      } catch (e) {
        section.textContent = "";
        var p = document.createElement("p");
        p.appendChild(document.createTextNode("This page could not be shown. "));
        var again = document.createElement("a");
        again.href = location.href;
        again.textContent = "Try again";
        again.addEventListener("click", function(ev) {
          ev.preventDefault();
          routeSafe();
        });
        p.appendChild(again);
        p.appendChild(document.createTextNode("."));
        section.appendChild(p);
      }
    }
    function startBoard() {
      section.setAttribute("data-nosnippet", "");
      collectAltIps();
      var ready = state.key ? sha256hex(state.key) : Promise.resolve("");
      ready.then(function(h) {
        state.myHash = h;
        enableMemberLive();
        loadMyProfile();
        dmUnreadCheck();
        notifUnreadCheck();
        routeSafe();
      });
    }
    function start() {
      if (state.started) return;
      state.started = true;
      collectAltIps();
      section.setAttribute("data-nosnippet", "");
      var feedUrl = API + "/feed?page=" + encodeURIComponent(pagePath());
      var discover = document.createElement("link");
      discover.rel = "alternate";
      discover.type = "application/rss+xml";
      discover.title = "Comments feed";
      discover.href = feedUrl;
      document.head.appendChild(discover);
      var title = el("h2", "comments-title");
      title.appendChild(el("span", "comments-title-text", "Comments"));
      var rss = el("a", "comments-rss", "RSS");
      rss.href = feedUrl;
      rss.title = "Follow these comments with a feed reader";
      title.appendChild(rss);
      section.appendChild(title);
      section.appendChild(el("div", "comments-list"));
      section.appendChild(el("p", "comments-status", "Loading comments..."));
      var form = el("div", "comment-form");
      form.appendChild(el("div", "comment-identity"));
      var keyBox = el("div", "key-box");
      keyBox.hidden = true;
      form.appendChild(keyBox);
      var textarea = el("textarea", "comment-text");
      textarea.maxLength = 4e3;
      textarea.rows = 5;
      textarea.placeholder = "Say what you want to say.";
      form.appendChild(mdEditor(textarea));
      attachDraft(textarea, "page:" + pagePath());
      var hp = el("input", "hp");
      hp.type = "text";
      hp.name = "website";
      hp.tabIndex = -1;
      hp.autocomplete = "off";
      hp.setAttribute("aria-hidden", "true");
      form.appendChild(hp);
      form.appendChild(el("div", "ts-slot"));
      form.appendChild(el("div", "comment-buttons"));
      form.appendChild(el("p", "form-status"));
      section.appendChild(form);
      var ready = state.key ? sha256hex(state.key) : Promise.resolve("");
      ready.then(function(h) {
        state.myHash = h;
        enableMemberLive();
        renderIdentity();
        renderButtons();
        load();
        loadMyProfile();
        dmUnreadCheck();
        notifUnreadCheck();
      });
      new MutationObserver(function() {
        renderButtons();
      }).observe(form.querySelector(".comment-identity"), { childList: true });
      loadTurnstile();
    }
    window.mcKit = {
      state,
      API,
      CATS,
      isAdmin,
      catByKey,
      cachedJson,
      freshParam,
      freshOpts,
      blockedOut,
      renderIdentity,
      indexSearchBox,
      displayName,
      fmtDateTime,
      notifCacheSet,
      topicAdminCorner,
      buildBoardForm,
      boardButtons,
      armBoardForm,
      attachMentions,
      attachDraft,
      boardPost,
      stampFresh,
      goIndex: function() {
        section.textContent = "";
        viewIndex();
      },
      /* the post renderer's organs (Wave B3b) */
      fetchRetry,
      isMuted,
      toggleMute,
      authorNode,
      profileHref,
      ADMIN_HASHES,
      MERECAT_BOT_HASH,
      setStatus,
      startEdit,
      quoteGrab: function(c) {
        quotedSelection = selectionInPost(c);
      },
      quoteTake: function(c, quoteCtx) {
        var excerpt = quotedSelection || truncate(c.body, 400);
        quotedSelection = "";
        quoteInto(c, excerpt, permalinkFor(c, quoteCtx));
      },
      /* topic + search views (Wave B4/B5) */
      commentNode,
      wallMediaNode,
      // board attachments in the Lit post renderer
      watchToggle,
      annotateMeta,
      searchSnippet,
      attachAuthorPicker,
      /* member read views (Wave C-reads) */
      dmScore,
      notifClear: function() {
        try {
          localStorage.removeItem(NOTIF_CACHE);
        } catch (e) {
        }
        notifUnreadCheck();
      },
      /* profile + inbox read views (Wave C-reads 2) */
      el,
      renderProfile,
      adminProfileEditor,
      loadTurnstile,
      dmSearchBox,
      dmLabel,
      dmCacheSet,
      dmUnreadCheck,
      markThreadRead,
      mintIdentity,
      loginWithKey,
      /* admin read/observe cluster (Wave C-reads 3) */
      MERECAT_API,
      onProfile: function(cb) {
        profileWaiters.push(cb);
      }
    };
    if (BOARD) {
      startBoard();
    } else if (/^#comment-\d+$/.test(location.hash)) {
      start();
    } else if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            io.disconnect();
            start();
          }
        });
      }, { rootMargin: "400px" });
      io.observe(section);
    } else {
      start();
    }
  }
  window.mcCommentsBoot = mcBoot;
  window.mcCommentsTeardown = function() {
    if (mcDown) {
      var d = mcDown;
      mcDown = null;
      try {
        d();
      } catch (e) {
      }
    }
  };
  (function() {
    var shellComing = false;
    try {
      shellComing = localStorage.getItem("mc-app") !== "0";
    } catch (e) {
      shellComing = false;
    }
    if (!shellComing || window.__mcShellReady || window.mcViews) {
      mcBoot();
      return;
    }
    var booted = false;
    var attempts = 0;
    function go() {
      if (booted || !window.mcCore || attempts >= 3) return;
      attempts += 1;
      try {
        mcBoot();
        booted = true;
      } catch (e) {
      }
    }
    document.addEventListener("mc-shell-ready", go);
    var waited = 0;
    var reinjected = false;
    var tick = setInterval(function() {
      waited += 250;
      if (!booted && window.mcCore) go();
      if (booted || attempts >= 3) {
        clearInterval(tick);
        noteIfBlank();
        return;
      }
      if (waited >= 8e3 && !reinjected && !window.mcCore) {
        reinjected = true;
        var prior = document.querySelector('script[src*="app.js"]');
        if (prior && prior.getAttribute("src")) {
          var again = document.createElement("script");
          again.src = prior.getAttribute("src");
          again.defer = true;
          document.head.appendChild(again);
        }
      }
      if (waited >= 45e3) {
        clearInterval(tick);
        noteIfBlank();
      }
    }, 250);
    function noteIfBlank() {
      if (booted) return;
      var sec = document.querySelector(".comments");
      if (sec && !sec.firstChild) {
        var p = document.createElement("p");
        p.textContent = "The app could not load. Check your connection and reload the page.";
        sec.appendChild(p);
      }
    }
  })();
})();
