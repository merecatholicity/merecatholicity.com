I_AM_DONE

The rollout is complete and pushed to main. Summary:

1. Profile offsite links (website + X/Facebook/Instagram/TikTok) with brand icons —
   Domain.Links sanitizes every value (http(s)/normalized-handle only). Commit 1b6ed4d.
2. "Recent Community Posts" (renamed) moved ABOVE the wall, re-collapsible; the
   "🔗 Share profile" link is now a real button (fixes mobile). Commit bb5d15a.
3. Modern Feed posts: whole card clickable → single-post view with comments; image
   lightbox (view large); per-post Share (Copy / X / Facebook / native share sheet for
   IG/TikTok/WhatsApp). Commit bb5d15a.
4. Light "new version available — refresh" detector (event-driven, cache-busted nav.js,
   zero worker cost). Commit 6403f7e.
5. VAPID Web Push MERGED from ../merecatholicity.com-VAPID-temporary-workspace and fully
   activated: a FRESH keypair was generated (the workspace's public key had no recoverable
   private half), VAPID_PRIVATE_KEY set as a worker secret, matching public key committed,
   PUSH_ENABLED on, /api/comments/push/vapid-key verified serving. Commit 2c83a42.

Notes for the owner:
- Rotate secrets that passed through the chat: the Cloudflare API token + R2 key (earlier),
  and consider rotating the VAPID_PRIVATE_KEY at leisure (it never appeared in the transcript
  — it was piped from a scratch file — but was generated this session).
- The scratch VAPID private-key file is under the session scratchpad only (not committed).
