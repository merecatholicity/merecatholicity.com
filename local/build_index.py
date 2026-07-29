#!/usr/bin/env python3
"""Build the local retrieval index from the SAME sources the Cloudflare bot uses.

It imports librarian/ingest.py and calls its build() per work, so the chunks,
anchors, and packing are byte-identical to what the worker stores. Then it
writes them to a sqlite file (+ an FTS5 mirror for the BM25 legs) and embeds
EVERY chunk with bge-m3 into a numpy array — the whole corpus, not the ~4,880
that fit Cloudflare's free Vectorize budget.

    python local/build_index.py            # full rebuild
    python local/build_index.py --limit 5  # first 5 works (smoke test)
"""
import argparse
import json
import os
import sqlite3
import sys
import time

import numpy as np
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import llm  # noqa: E402


def load_cfg():
    with open(os.path.join(HERE, "mc_config.yml")) as f:
        return yaml.safe_load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only the first N works")
    ap.add_argument("--batch", type=int, default=64, help="embed batch size")
    args = ap.parse_args()

    cfg = load_cfg()
    lib = os.path.normpath(os.path.join(HERE, cfg["librarian"]))
    sys.path.insert(0, lib)
    import ingest  # the shared chunker; HERE inside it resolves srcs correctly

    data = os.path.join(HERE, cfg["data_dir"])
    os.makedirs(data, exist_ok=True)
    db_path = os.path.join(data, "chunks.sqlite")
    vec_path = os.path.join(data, "vectors.npy")
    meta_path = os.path.join(data, "meta.json")

    manifest = yaml.safe_load(open(os.path.join(lib, "works.yml")))["works"]
    items = list(manifest.items())
    if args.limit:
        items = items[:args.limit]

    # ---- Pass 1: build every work's chunks and write the sqlite rows -------
    if os.path.exists(db_path):
        os.remove(db_path)
    db = sqlite3.connect(db_path)
    db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE chunks (
          rowid INTEGER PRIMARY KEY,
          cid TEXT UNIQUE, work_id TEXT, seq INTEGER,
          tier INTEGER, url TEXT, kind TEXT,
          heading TEXT, anchor TEXT, text TEXT, title TEXT);
        CREATE INDEX chunks_work ON chunks(work_id);
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          heading, text, content='chunks', content_rowid='rowid',
          tokenize='porter unicode61');
    """)

    n = 0
    skipped = []
    t0 = time.time()
    for wid, entry in items:
        src = os.path.join(lib, entry["src"])
        if not os.path.exists(src):
            skipped.append((wid, "source missing"))
            continue
        chunks, bad = ingest.build(entry)
        if bad:
            skipped.append((wid, f"{len(bad)} bad anchors"))
            continue
        rows = []
        for seq, c in enumerate(chunks):
            rows.append((
                f"{wid}#{seq}", wid, seq,
                int(entry.get("tier", 5)), entry.get("url", ""), entry["kind"],
                c["heading"], c["anchor"], c["text"], entry["title"]))
        db.executemany(
            "INSERT INTO chunks (cid,work_id,seq,tier,url,kind,heading,anchor,text,title) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        n += len(rows)
        print(f"  {wid}: {len(rows)} chunks (total {n})", flush=True)
    db.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
    db.commit()
    print(f"built {n} chunks from {len(items)-len(skipped)} works in "
          f"{time.time()-t0:.0f}s", flush=True)
    for wid, why in skipped:
        print(f"  skipped {wid}: {why}")

    # ---- Pass 2: embed every chunk (rowid order) into a preallocated array -
    dim = int(cfg["embed_dim"])
    vecs = np.zeros((n, dim), dtype=np.float32)
    t0 = time.time()
    done = 0
    cur = db.execute("SELECT rowid, heading, text FROM chunks ORDER BY rowid")
    buf_ids, buf_txt = [], []

    def flush():
        nonlocal done
        if not buf_txt:
            return
        embs = llm.embed(cfg, buf_txt)
        arr = np.asarray(embs, dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        arr /= norms
        for rid, v in zip(buf_ids, arr):
            vecs[rid - 1] = v          # rowid is 1-based, array is 0-based
        done += len(buf_txt)
        if done % 2048 < args.batch:
            rate = done / max(1e-9, time.time() - t0)
            print(f"  embedded {done}/{n}  ({rate:.0f}/s)", flush=True)
        buf_ids.clear()
        buf_txt.clear()

    for rid, heading, text in cur:
        buf_ids.append(rid)
        buf_txt.append((heading + ": " if heading else "") + (text or ""))
        if len(buf_txt) >= args.batch:
            flush()
    flush()
    np.save(vec_path, vecs)
    print(f"embedded {done} chunks in {time.time()-t0:.0f}s -> {vec_path} "
          f"({vecs.nbytes/1e6:.0f} MB)", flush=True)

    json.dump({
        "count": n, "dim": dim, "embed_model": cfg["embed_model"],
        "chat_model": cfg["chat_model"], "built_unix": int(t0),
        "skipped": skipped,
    }, open(meta_path, "w"), indent=1)
    db.close()
    print("done.")


if __name__ == "__main__":
    main()
