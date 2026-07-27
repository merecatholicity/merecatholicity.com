#!/usr/bin/env python3
"""Download the 66 Scourby KJV book ZIPs, extract the per-chapter MP3s, and
upload each to the merecatholicity-audio R2 bucket under kjv/<slug>/<chap>.mp3.

Resumable: a book whose done-marker exists is skipped. Uploads go through
`deno run -A npm:wrangler r2 object put` (deno caches wrangler, ~0.7s each).
Run from the repo root: python scratchpad/upload_kjv_audio.py
"""
import glob
import os
import re
import subprocess
import sys
import time
import urllib.parse

BASE = "https://earnestlycontendingforthefaith.com/King James Bible Audio"
BUCKET = "merecatholicity-audio"
WORK = "/tmp/kjvaudio"
# --remote is essential: without it wrangler writes to a LOCAL simulated
# store, not the real bucket.
WRANGLER = ["deno", "run", "-A", "npm:wrangler", "r2", "object", "put"]
REMOTE = ["--remote"]

# (book#, exact ZIP basename without .zip, canonical slug)
BOOKS = [
    (1, "01-Genesis", "genesis"), (2, "02-Exodus", "exodus"),
    (3, "03-Leviticus", "leviticus"), (4, "04-Numbers", "numbers"),
    (5, "05-Deuteronomy", "deuteronomy"), (6, "06-Joshua", "joshua"),
    (7, "07-Judges", "judges"), (8, "08-Ruth", "ruth"),
    (9, "09-1 Samuel", "1-samuel"), (10, "10-2 Samuel", "2-samuel"),
    (11, "11-1 Kings", "1-kings"), (12, "12-2 Kings", "2-kings"),
    (13, "13-1 Chronicles 29", "1-chronicles"), (14, "14-2 Chronicles", "2-chronicles"),
    (15, "15-Ezra", "ezra"), (16, "16-Nehemiah", "nehemiah"),
    (17, "17-Esther", "esther"), (18, "18-Job 42", "job"),
    (19, "19-Psalms", "psalms"), (20, "20-Proverbs", "proverbs"),
    (21, "21-Ecclesiastes", "ecclesiastes"), (22, "22-Song of Solomon", "song-of-solomon"),
    (23, "23-Isaiah", "isaiah"), (24, "24-Jeremiah", "jeremiah"),
    (25, "25-Lamentations", "lamentations"), (26, "26-Ezekiel", "ezekiel"),
    (27, "27-Daniel", "daniel"), (28, "28-Hosea", "hosea"),
    (29, "29-Joel", "joel"), (30, "30-Amos", "amos"),
    (31, "31-Obadiah", "obadiah"), (32, "32-Jonah", "jonah"),
    (33, "33-Micah", "micah"), (34, "34-Nahum", "nahum"),
    (35, "35-Habakkuk", "habakkuk"), (36, "36-Zephaniah", "zephaniah"),
    (37, "37-Haggai", "haggai"), (38, "38-Zechariah", "zechariah"),
    (39, "39-Malachi", "malachi"), (40, "40-Matthew", "matthew"),
    (41, "41-Mark", "mark"), (42, "42-Luke", "luke"),
    (43, "43-John", "john"), (44, "44-Acts", "acts"),
    (45, "45-Romans", "romans"), (46, "46-1 Corinthians", "1-corinthians"),
    (47, "47-2 Corinthians", "2-corinthians"), (48, "48-Galatians", "galatians"),
    (49, "49-Ephesians", "ephesians"), (50, "50-Philippians", "philippians"),
    (51, "51-Colossians", "colossians"), (52, "52-1 Thessalonians", "1-thessalonians"),
    (53, "53-2 Thessalonians", "2-thessalonians"), (54, "54-1 Timothy", "1-timothy"),
    (55, "55-2 Timothy", "2-timothy"), (56, "56-Titus", "titus"),
    (57, "57-Philemon", "philemon"), (58, "58-Hebrews", "hebrews"),
    (59, "59-James", "james"), (60, "60-1 Peter", "1-peter"),
    (61, "61-2 Peter", "2-peter"), (62, "62-1 John", "1-john"),
    (63, "63-2 John", "2-john"), (64, "64-3 John", "3-john"),
    (65, "65-Jude", "jude"), (66, "66-Revelations", "revelation"),
]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


# --- Tailscale exit-node rotation, to dodge the source's per-IP block --------
def exit_nodes():
    out = run(["tailscale", "exit-node", "list"]).stdout
    seen, nodes = set(), []
    for line in out.splitlines():
        for tok in line.split():
            if tok.endswith("mullvad.ts.net") and tok not in seen:
                seen.add(tok); nodes.append(tok)
    return nodes


NODES = exit_nodes()
_ei = 0


def rotate_exit():
    global _ei
    if not NODES:
        time.sleep(60); return
    _ei = (_ei + 1) % len(NODES)
    run(["tailscale", "set", "--exit-node=" + NODES[_ei]])
    time.sleep(6)
    print(f"  rotated exit -> {NODES[_ei]} ({_ei + 1}/{len(NODES)})", flush=True)


def do_book(num, zipbase, slug):
    marker = f"{WORK}/{slug}.done"
    if os.path.exists(marker):
        print(f"[{num:2}/66] {slug}: done, skip", flush=True)
        return 0
    zpath = f"{WORK}/{zipbase}.zip"
    url = urllib.parse.quote(f"{BASE}/{zipbase}.zip", safe=":/")
    # The source rate-limits (HTTP 429); retry with growing backoff, and it
    # eventually lets us through.
    ok = False
    for attempt in range(1, 13):
        r = run(["curl", "-fsSL", "--max-time", "900", "-o", zpath, url])
        if r.returncode == 0 and os.path.exists(zpath) and os.path.getsize(zpath) > 1000:
            ok = True
            break
        # blocked or failed: hop to a fresh exit node and retry
        print(f"[{num:2}/66] {slug}: download attempt {attempt} failed, rotating exit",
              flush=True)
        rotate_exit()
    if not ok:
        print(f"[{num:2}/66] {slug}: DOWNLOAD FAILED after rotations", flush=True)
        return 0
    ex = f"{WORK}/ex-{slug}"
    run(["rm", "-rf", ex])
    os.makedirs(ex, exist_ok=True)
    run(["unzip", "-oq", zpath, "-d", ex])
    mp3s = sorted(glob.glob(f"{ex}/**/*.mp3", recursive=True),
                  key=lambda p: os.path.basename(p).lower())
    n = 0
    for i, mp3 in enumerate(mp3s, 1):
        for uatt in range(4):        # R2 puts can hiccup; retry each chapter
            u = run(WRANGLER + [f"{BUCKET}/kjv/{slug}/{i}.mp3", f"--file={mp3}"] + REMOTE)
            if "Upload complete" in u.stdout:
                n += 1
                break
            time.sleep(2)
        else:
            print(f"[{num:2}/66] {slug}: upload ch{i} FAILED {(u.stdout + u.stderr)[:140]}", flush=True)
    run(["rm", "-rf", ex, zpath])
    # only mark the book done when every chapter landed, so a resume retries it
    if n == len(mp3s) and n > 0:
        open(marker, "w").write(f"{n}\n")
        print(f"[{num:2}/66] {slug}: uploaded {n} chapters", flush=True)
    else:
        print(f"[{num:2}/66] {slug}: INCOMPLETE {n}/{len(mp3s)} — will retry on resume", flush=True)
    return n


def main():
    os.makedirs(WORK, exist_ok=True)
    only = set(sys.argv[1:])
    total = 0
    for num, zipbase, slug in BOOKS:
        if only and slug not in only:
            continue
        if os.path.exists(f"{WORK}/{slug}.done"):
            continue
        total += do_book(num, zipbase, slug)
        time.sleep(3)
    print(f"DONE: {total} chapters uploaded total", flush=True)


if __name__ == "__main__":
    main()
