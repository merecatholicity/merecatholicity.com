/* The DM stylesheet, injected once (it wins over main.css by design — CLAUDE.md's law).
   Split out of client/dm.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installDmStyles(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let section: HTMLElement;
  let state: Record<string, any>;

  /* One injected style block for the disappearing/media/settings UI — kept out of
     the shared stylesheets (like the emoji CSS) so it never collides. */
  function ensureDmStyles() {
    if (document.getElementById('mc-dm-css')) return;
    var css = '' +
      '.dm-expiry{font-size:0.85em;opacity:0.72;margin:0.15em 0 0.5em}' +
      '.dm-expiry a{cursor:pointer}' +
      /* The WhatsApp-shaped bubble (2026-09-10): a meta row at the foot, the
         saved ring, the quote block, the reaction pill hanging off the corner,
         the hover ⌄, the day chips, and the press-and-hold surface. The bubble's
         base card (border, fill, radius, position:relative) is main.css's. */
      '.dm-msg{--dm-saved:#d9a520;transition:transform .18s ease}' +
      '.dm-sys-label{font-size:.78em;color:var(--faint);margin-bottom:.2em}' +
      /* the small "Forwarded" line (2026-09-13), and the picker behind the act */
      '.dm-fwd{font-size:.72em;font-style:italic;color:var(--faint);margin-bottom:.15em}' +
      '.dm-fwd-pick{display:flex;flex-direction:column;gap:.5em}' +
      '.dm-fwd-list{max-height:50vh;overflow:auto;overscroll-behavior:contain}' +
      '.dm-fwd-row{display:flex;align-items:center;gap:.6em;padding:.45em .2em;border-bottom:1px solid var(--rule);cursor:pointer}' +
      '.dm-fwd-row input{flex:none;margin:0}' +
      '.dm-fwd-text{display:flex;flex-direction:column;min-width:0;flex:1 1 0}' +
      '.dm-fwd-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dm-fwd-sub{font-size:.8em;color:var(--faint)}' +
      '.dm-fwd-send{align-self:flex-end}' +
      /* a group (2026-09-13): the author line in the member's colour, the membership lines, the collage, the members in the sheet, the tally pill */
      '.dm-author{font-size:.78em;font-weight:600;margin-bottom:.15em;line-height:1.2}' +
      '.dm-hue-0{color:#8b1a1a}.dm-hue-1{color:#1a5e8b}.dm-hue-2{color:#2e7d32}.dm-hue-3{color:#8b5a1a}.dm-hue-4{color:#6a1b9a}.dm-hue-5{color:#00695c}.dm-hue-6{color:#ad1457}.dm-hue-7{color:#4e342e}' +
      '.dm-sys-line .dm-call-text{font-style:italic}' +
      '.dm-collage{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--rule)}' +
      '.dm-collage-1{grid-template-columns:1fr}' +
      '.dm-collage-cell{overflow:hidden;background:var(--cream-2,#faf6ee);display:flex;align-items:center;justify-content:center;font-size:.6em;font-weight:600;color:var(--maroon,#8b1a1a);min-width:0;min-height:0}' +
      '.dm-collage-cell .dm-head-img{width:100%;height:100%;object-fit:cover}' +
      '.dm-collage-initial{line-height:1}' +
      '.dm-members{display:flex;flex-direction:column;gap:.4rem;margin:.3rem 0 .6rem}' +
      '.dm-member-row{display:flex;align-items:center;gap:.6rem;min-width:0}' +
      '.dm-member-av{flex:none;width:1.75rem;height:1.75rem;border-radius:50%;overflow:hidden;background:var(--cream-2,#faf6ee);display:inline-flex;align-items:center;justify-content:center;font-size:.8em;font-weight:600;color:var(--maroon,#8b1a1a)}' +
      '.dm-member-av .dm-head-img{width:100%;height:100%;object-fit:cover;display:block;margin:0}' +
      '.dm-member-name{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dm-member-acts{flex:none;display:inline-flex;gap:.6rem;font-size:.85em}' +
      '.dm-member-row .dm-row-dot[hidden]{display:none}' +
      /* who has read (2026-09-15): the faces under the last word each member read, the tappable tick, the info rows */
      '.dm-seen-row{display:flex;justify-content:flex-end;align-items:center;gap:.15rem;margin:-.15rem .4rem .4rem 0}' +
      '.dm-seen-av{width:1.1rem;height:1.1rem;border-radius:50%;overflow:hidden;background:var(--cream-2,#faf6ee);display:inline-flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:600;color:var(--maroon,#8b1a1a);border:1px solid var(--surface,#fff)}' +
      '.dm-seen-av .dm-head-img{width:100%;height:100%;object-fit:cover;display:block;margin:0}' +
      '.dm-seen-more{font-size:.65rem;color:var(--faint);margin-left:.1rem}' +
      '.dm-receipt-tap{cursor:pointer}' +
      '.dm-readby-state{font-size:.85em;color:var(--faint)}' +
      '.dm-readby-state.dm-receipt-seen{color:var(--maroon,#8b1a1a)}' +
      '.dm-group-name{margin-bottom:.4em}' +
      '.dm-msg > .dm-react-many{padding:.1em .25em;gap:.15em;margin:0}' +
      '.dm-msg > .dm-react-many .mc-react-chip{font:inherit;font-size:.9em;line-height:1;padding:.1em .3em;border:0;background:none;cursor:pointer;display:inline-flex;align-items:center;gap:.15em;border-radius:999px}' +
      '.dm-msg > .dm-react-many .mc-react-chip.on{background:color-mix(in srgb,var(--maroon,#8b1a1a) 12%,transparent)}' +
      '.dm-msg > .dm-react-many .mc-react-n{font-size:.85em;color:var(--faint)}' +
      '.dm-meta{display:flex;justify-content:flex-end;align-items:center;gap:.45em;margin-top:.2em;font-size:.72em;line-height:1.2;color:var(--faint);white-space:nowrap}' +
      '.dm-meta .comment-date{font-size:1em;color:inherit;margin:0}' +
      '.dm-edited{font-style:italic;opacity:.85}' +
      '.dm-receipt{opacity:.85;letter-spacing:-.08em}' +
      '.dm-receipt-seen{color:var(--maroon,#8b1a1a);opacity:1}' +
      /* The saved mark, settled after two looks (2026-09-11): the ring shouted
         and a faint-ink star whispered — a gold star in the meta row and the
         bubble's own 1px border tinted the same gold; no ring, no shadow. */
      '.dm-savedmark{color:var(--dm-saved);font-size:1.05em;line-height:1}' +
      '.dm-msg.dm-saved{border-color:color-mix(in srgb,var(--dm-saved) 70%,var(--rule))}' +
      /* An element toggled by its hidden attribute must not be revived by its
         own display rule (author display beats the UA's [hidden]). */
      '.dm-reply-bar[hidden],.dm-act-bar[hidden],.dm-act-menu[hidden],.dm-c-btn[hidden],.dm-c-send[hidden],.dm-attach-chip[hidden]{display:none!important}' +
      '.dm-quote{display:block;border-left:3px solid var(--maroon,#8b1a1a);background:color-mix(in srgb,var(--ink,#000) 7%,transparent);border-radius:6px;padding:.3em .6em;margin:0 0 .35em;cursor:pointer;font-size:.9em;max-width:100%;overflow:hidden}' +
      '.dm-quote:focus-visible{outline:2px solid var(--maroon,#8b1a1a);outline-offset:1px}' +
      '.dm-quote-who{display:block;font-weight:600;color:var(--maroon,#8b1a1a);font-size:.85em}' +
      '.dm-quote-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:var(--ink-soft,#333);opacity:.85;white-space:normal;overflow-wrap:anywhere}' +
      '.dm-flash{animation:dm-flash 1.2s ease}' +
      '@keyframes dm-flash{0%,55%{box-shadow:0 0 0 3px color-mix(in srgb,var(--maroon,#8b1a1a) 60%,transparent)}100%{box-shadow:none}}' +
      '.dm-react-pill{position:absolute;bottom:-.9em;right:.6em;display:inline-flex;align-items:center;gap:.15em;font:inherit;font-size:.82em;line-height:1;padding:.2em .45em;border:1px solid var(--rule);border-radius:999px;background:var(--surface,#fff);color:var(--ink);box-shadow:var(--shadow-1);cursor:pointer;z-index:1}' +
      '.dm-msg:not(.dm-mine) .dm-react-pill{right:auto;left:.6em}' +
      '.dm-react-pill .mc-emoji{height:1.25em;vertical-align:-.2em;margin:0}' +
      '.dm-react-n{font-size:.85em;color:var(--faint);margin-left:.1em}' +
      '.dm-msg.dm-has-react{margin-bottom:1.3rem}' +
      '.dm-more{position:absolute;top:.2em;right:.3em;font:inherit;line-height:1;background:var(--surface,#fff);border:1px solid var(--rule);border-radius:999px;width:1.5em;height:1.5em;padding:0 0 .15em;cursor:pointer;color:var(--faint);opacity:0;transition:opacity .12s;z-index:1}' +
      '.dm-msg:hover .dm-more,.dm-more:focus-visible{opacity:1}' +
      '.dm-day{width:max-content;max-width:90%;margin:.9em auto .35em;font-size:.72em;color:var(--faint);background:var(--surface,#fff);border:1px solid var(--rule);border-radius:999px;padding:.15em .75em;text-align:center}' +
      /* reading back (2026-09-11): the unread line, the jump button with its count, the typing bubble */
      '.dm-unread-line{display:flex;align-items:center;gap:.6em;margin:.9em 0 .5em;font-size:.72em;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--maroon,#8b1a1a)}' +
      '.dm-unread-line::before,.dm-unread-line::after{content:"";flex:1;border-top:1px solid color-mix(in srgb,var(--maroon,#8b1a1a) 45%,transparent)}' +
      '.dm-jump{position:absolute;right:.7rem;bottom:calc(100% + .6rem);width:2.6rem;height:2.6rem;display:flex;align-items:center;justify-content:center;border-radius:999px;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--rule);box-shadow:var(--shadow-2);font:inherit;font-size:1.5rem;line-height:1;cursor:pointer;padding:0 0 .3rem;z-index:1}' +
      '.dm-jump[hidden]{display:none}' +
      '.dm-jump-n{position:absolute;top:-.5rem;right:-.35rem;min-width:1.35rem;height:1.35rem;padding:0 .35rem;border-radius:999px;background:var(--maroon,#8b1a1a);color:#fff;font-size:.72rem;font-weight:700;line-height:1.35rem;text-align:center}' +
      '.dm-jump-n[hidden]{display:none}' +
      '.dm-typing-bubble{display:inline-flex;gap:.3em;align-items:center;padding:.75em .95em;width:max-content}' +
      '.dm-typing-dot{width:.5em;height:.5em;border-radius:50%;background:var(--faint);animation:dm-typing 1.2s infinite ease-in-out}' +
      '.dm-typing-dot:nth-child(2){animation-delay:.2s}.dm-typing-dot:nth-child(3){animation-delay:.4s}' +
      '@keyframes dm-typing{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-.25em)}}' +
      '.dm-sub-typing{animation:dm-typing-pulse 1.2s infinite ease-in-out}@keyframes dm-typing-pulse{50%{opacity:.55}}' +
      '@media (hover:none){.dm-more{display:none}.dm-screen{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}.dm-screen textarea,.dm-screen input{-webkit-user-select:text;user-select:text}.dm-msg{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:pan-y pinch-zoom}.dm-msg textarea{-webkit-user-select:text;user-select:text}}' +
      /* the reply strip above the composer */
      '.dm-reply-bar{display:flex;align-items:center;gap:.5em;margin:0 0 .4em;padding:.35em .5em .35em .7em;border-left:3px solid var(--maroon,#8b1a1a);background:color-mix(in srgb,var(--ink,#000) 6%,transparent);border-radius:8px}' +
      '.dm-reply-body{flex:1;min-width:0;font-size:.9em}' +
      '.dm-reply-body .dm-quote-text{-webkit-line-clamp:2}' +
      '.dm-reply-x{flex:none;font:inherit;background:none;border:0;cursor:pointer;color:var(--faint);font-size:1.1em;padding:.2em .45em;border-radius:6px}' +
      '.dm-reply-x:hover{color:var(--maroon,#8b1a1a)}' +
      '.dm-edit-bar{border-left-color:var(--dm-saved,#d9a520)}' +
      /* a call's event line (the log): centred, muted, a pill of its own; a miss for this reader is tinted */
      '.dm-call-line{display:flex;width:fit-content;max-width:92%;align-items:center;gap:.4em;margin:.45em auto;padding:.3em .8em;border:1px solid var(--rule);border-radius:999px;background:color-mix(in srgb,var(--ink,#000) 5%,transparent);color:var(--faint);font-size:.85em;line-height:1.2}' +
      '.dm-call-line .dm-call-ico{font-size:.9em;letter-spacing:-.15em;margin-right:.15em}' +
      '.dm-call-line .dm-call-text{color:var(--faint)}' +
      '.dm-call-line .dm-call-time{opacity:.8}' +
      '.dm-call-line.dm-call-missed .dm-call-text{color:var(--maroon,#8b1a1a)}' +
      /* the chat screen: a sticky header over the words, a sticky composer under them */
      '.dm-head{position:sticky;top:0;z-index:38;display:flex;align-items:center;gap:.65rem;padding:.45rem 0;margin:0 0 .3rem;background:var(--surface,#fff);border-bottom:1px solid var(--rule)}' +
      'body.mc-app .dm-head{top:var(--mc-deskbar-h,0px)}' +
      '.dm-head-avatar{flex:none;width:2.5rem;height:2.5rem;border-radius:50%;overflow:hidden;background:var(--cream-2,#faf6ee);display:inline-flex;align-items:center;justify-content:center;color:var(--maroon,#8b1a1a);font-weight:700;text-decoration:none}' +
      '.dm-head-img{width:100%;height:100%;object-fit:cover;display:block;margin:0}' +
      '.dm-head-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:.12em;background:none;border:0;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}' +
      '.dm-head-name{font-weight:600;font-size:1.02rem;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
      '.dm-head-sub{font-size:.8rem;color:var(--faint);display:inline-flex;align-items:center;gap:.3em;white-space:nowrap;max-width:100%;overflow:hidden}' +
      '.dm-head-sub .dm-dot{margin-right:0}' +
      '.dm-sub-typing{color:#3ba55d;font-style:italic}' +
      '.dm-head-acts{flex:none;display:inline-flex;gap:.1rem}' +
      '.dm-head-btn,.dm-c-btn,.dm-c-send,.dm-c-emoji{font:inherit;line-height:1;background:none;border:0;cursor:pointer;color:var(--maroon,#8b1a1a);width:2.6rem;height:2.6rem;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none}' +
      '.dm-head-btn:hover,.dm-c-btn:hover,.dm-c-emoji:hover{background:color-mix(in srgb,var(--maroon,#8b1a1a) 8%,transparent)}' +
      '.dm-head-btn .mc-ic,.dm-c-btn .mc-ic,.dm-c-send .mc-ic{width:1.45rem;height:1.45rem;vertical-align:0}' +
      '.dm-c-emoji .mc-ic{width:1.35rem;height:1.35rem;vertical-align:0}' +
      '.dm-note{display:block;width:max-content;max-width:92%;margin:.6em auto .4em;font:inherit;font-size:.74em;color:var(--faint);background:var(--surface,#fff);border:1px solid var(--rule);border-radius:999px;padding:.25em .8em;text-align:center;cursor:pointer}' +
      /* FIXED, never sticky: a thread opens at the document's end, where a
         sticky bar sits in its natural place — above the body's tab-bar
         reservation and the footer — and floated a gap over the tab bar until
         a scroll re-stuck it (the owner's report, 2026-09-11). The spacer
         reserves its height under the last bubble; on desktop the view aligns
         it to the content column by measurement. */
      '.dm-composer{position:fixed;left:0;right:0;bottom:0;z-index:37;margin:0;padding:.45rem 0 .3rem;background:var(--bg,#fff);border-top:1px solid var(--rule)}' +
      '.dm-c-space{height:0}' +
      '.dm-c-row{display:flex;align-items:flex-end;gap:.3rem}' +
      '.dm-c-field{flex:1;min-width:0;display:flex;align-items:flex-end;background:var(--surface,#fff);border:1px solid var(--rule);border-radius:22px;padding:.15rem .15rem .15rem .9rem}' +
      '.dm-c-field:focus-within{border-color:var(--maroon,#8b1a1a)}' +
      '.dm-c-ta{flex:1;min-width:0;width:auto;border:0;background:none;padding:.55rem 0;margin:0;font:inherit;color:var(--ink);resize:none;line-height:1.35;max-height:168px;outline:none;border-radius:0;box-shadow:none}' +
      '.dm-c-ta:disabled{color:var(--faint)}' +
      '.dm-c-emoji{width:2.3rem;height:2.3rem;color:var(--faint)}' +
      '.dm-c-send{background:var(--accent-fill,#8b1a1a);color:var(--accent-on,#fff)}' +
      '.dm-c-send:hover{filter:brightness(1.07)}' +
      '.dm-c-send.dm-c-idle{opacity:.45}' +
      '.dm-c-send:disabled{opacity:.4;cursor:not-allowed;filter:none}' +
      '.dm-c-emoji-panel{margin:0 0 .4rem}' +
      '.dm-c-status{margin:.2rem .2rem 0;font-size:.85rem;min-height:0}' +
      '.dm-c-status:empty{display:none}' +
      '.dm-composer .dm-attach-chip{margin:.1rem 0 .35rem}' +
      '.dm-composer .mc-rec-row{margin:.4rem 0 .1rem}' +
      '@media (max-width:600px){' +
        /* The chat screen begins where the app bar ends (2026-09-12): the
           board section's 1rem top margin was a hole between the bar and the
           header at the TRUE top — invisible while the thread is scrolled
           (the sticky header hides it), bared by a fling that reaches 0. */
        'body.mc-app section.comments.board.dm-screen{margin-top:0}' +
        'body.mc-app .dm-head{top:calc(var(--mc-appbar-h,3rem) + env(safe-area-inset-top,0px));margin-left:calc(-1 * var(--page-pad,.8rem));margin-right:calc(-1 * var(--page-pad,.8rem));padding-left:var(--page-pad,.8rem);padding-right:var(--page-pad,.8rem)}' +
        'body.mc-app .dm-head-name{display:none}' +   /* the app bar carries the name on phones */
        '.dm-composer{padding-left:var(--page-pad,.8rem);padding-right:var(--page-pad,.8rem)}' +
        'body.mc-app .dm-composer{bottom:calc(var(--mc-tabbar-h,3.6rem) + env(safe-area-inset-bottom,0px))}' +
        'body.mc-app.mc-kb-open .dm-composer{bottom:var(--mc-kb,0px);transition:bottom .18s ease}' +
        '.dm-c-ta{font-size:16px}' +   /* zoom-proof, as every phone text control here */
      '}' +
      /* conversation info (the ⓘ sheet) */
      '.dm-info-card{text-align:center;padding:.4rem 0 .9rem}' +
      '.dm-info-avatar{width:4.5rem;height:4.5rem;border-radius:50%;margin:0 auto .5rem;overflow:hidden;background:var(--cream-2,#faf6ee);display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;color:var(--maroon,#8b1a1a)}' +
      '.dm-info-avatar .dm-head-img{width:100%;height:100%}' +
      '.dm-info-name{font-weight:600;font-size:1.1rem}' +
      '.dm-info-link{font-size:.9rem}' +
      '.dm-info-row{padding:.75rem 0;border-top:1px solid var(--rule)}' +
      '.dm-info-row-title{font-weight:600;margin-bottom:.3rem}' +
      '.dm-info-row-text{margin:0;font-size:.92rem;color:var(--ink-soft,#333)}' +
      '.dm-info-row .dm-expiry{margin:0;font-size:.92rem;opacity:.9}' +
      '.dm-info-danger .identity-action{display:block;padding:.45rem 0;color:var(--maroon,#8b1a1a)}' +
      '.dm-info-inline{margin:0 0 .8rem;padding:0 .2rem;border-bottom:1px solid var(--rule)}' +
      '.dm-attach-chip{display:inline-block;font-size:0.85em;opacity:0.85;margin:0.3em 0}' +
      '.btn-attach{margin-left:6px}' +
      '.dm-media{margin:0.1em 0}' +
      '.dm-media-status{opacity:0.6;font-size:0.9em}' +
      '.dm-media-img,.dm-media-vid{max-width:100%;max-height:60vh;border-radius:8px;display:block}' +
      '.dm-media-aud{width:100%;max-width:320px}' +
      '.dm-media-caption{margin-top:0.35em}' +
      '.dm-media-expired{display:flex;align-items:center;gap:8px;padding:12px 14px;border:1px dashed var(--rule,#cbb);border-radius:10px;opacity:0.78}' +
      '.dm-media-expired-icon{font-size:1.25em;filter:grayscale(1);opacity:0.7}' +
      '.dm-media-expired-text{font-size:0.9em;font-style:italic;opacity:0.85}' +
      '.dm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle;background:#c8c8c8}' +
      '.dm-dot-on{background:#3ba55d;box-shadow:0 0 0 2px rgba(59,165,93,0.22)}' +
      '.dm-dot-off{background:#c0c0c0}.dm-dot-unknown{background:#dcdcdc}' +
      '.dm-typing{font-size:0.85em;opacity:0.7;font-style:italic;margin:0.25em 0.2em}' +
      '.profile-presence{display:flex;align-items:center;gap:.35em;font-size:.86rem;color:var(--faint);margin:.1rem 0 .2rem}' +
      '.profile-presence .dm-dot{margin-right:0}' +
      '.mc-inbox-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#3ba55d}' +
      '.wall-media{margin:0.45em 0}' +
      '.wall-media-el{max-width:100%;max-height:62vh;border-radius:8px;display:block}' +
      '.wall-post-detail .wall-media-el{max-height:85vh}' +
      '.wall-share{position:relative;display:inline-flex;align-items:center}.wall-share-menu{display:inline-flex;flex-wrap:wrap;gap:0.7em;margin-left:0.7em}' +
      '.wall-media-gone{opacity:0.6;font-size:0.9em;font-style:italic}' +
      '.wall-foot{margin-top:0.45em;font-size:0.9em}' +
      '.wall-comments-toggle{cursor:pointer;opacity:0.78}.wall-comments-toggle:hover{opacity:1}' +
      '.wall-comments{margin:0.55em 0 0.2em 0.9em;border-left:2px solid var(--rule,#e6e0d5);padding-left:0.85em}' +
      '.wall-comment{margin:0.45em 0}' +
      '.wall-newpill{display:inline-block;margin:0.4em 0;padding:0.3em 0.85em;border-radius:14px;background:var(--maroon,#8b1a1a);color:#fff;font-size:0.85em;cursor:pointer;text-decoration:none}' +
      '.wall-composer{margin:0.6em 0 1.1em}.wall-del{color:var(--maroon,#8b1a1a);opacity:0.7}' +
      '.wall-sentinel{height:1px}' +
      '.dm-redacted{font-style:italic;opacity:0.6}' +
      '.dm-redacted-msg .comment-body{opacity:0.9}' +
      '.dm-edit-box textarea{width:100%;box-sizing:border-box}' +
      '.dm-edit-box{margin-top:3px}' +
      '.admin-set-row{margin:0.6em 0}' +
      '.admin-set-row input[type=number]{width:6em}' +
      '.admin-health-beats{margin:0.4em 0 0.6em 1.2em;padding:0;font-size:0.92rem;color:var(--muted-b)}' +
      '.admin-health-stale{color:#b23b3b;font-weight:600}' +
      '.mc-media-row{margin:0.5em 0}' +
      '.mc-media-note{font-size:0.85em;opacity:0.75;margin-left:8px}' +
      '.mc-rec-row{display:flex;align-items:center;gap:10px;margin:0.5em 0;flex-wrap:wrap}' +
      '.mc-rec-dot{width:10px;height:10px;border-radius:50%;background:#c0392b;animation:mc-rec-pulse 1.1s ease-in-out infinite}' +
      '@keyframes mc-rec-pulse{0%,100%{opacity:1}50%{opacity:0.25}}' +
      '.mc-rec-time{font-variant-numeric:tabular-nums;font-size:0.9em;opacity:0.85}' +
      '.mc-rec-audio{max-width:280px}';
    var st = el('style');
    st.id = 'mc-dm-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function bind() {
    el = B.el;
    section = B.section;
    state = B.state;
  }
  function run() { /* nothing of this module ran at the boot's top level */ }
  return { bind, run, exports: { ensureDmStyles } };
}
