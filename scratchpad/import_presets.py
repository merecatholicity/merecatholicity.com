#!/usr/bin/env python3
"""Carry emoji.gg packs into the repo as avatar presets and (re)write the client
manifest avatars/presets/index.json. One-time/importer tool: the source packs
live under ~/Downloads (each an unzipped emoji.gg pack folder), the committed
output under avatars/presets/ is self-contained. Run from anywhere:

    python3 scratchpad/import_presets.py

Edit PACKS to match the folders you have unzipped. Only *.png / *.webp are
carried (drop animated *.gif first). Display names strip the emoji.gg id prefix
and are used as the gallery tooltip and search text."""
import os, re, json, shutil

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser('~/Downloads')
DST = os.path.join(REPO, 'avatars', 'presets')

# (source folder under ~/Downloads, clean slug, human label) -- gallery tab order.
PACKS = [
    ('44296-crusader-states-emojigg-pack',        'crusades',  'Crusader States'),
    ('285018-cats-emojigg-pack',                  'cats',      'Cats'),
    ('174874-cute-emote-collection-emojigg-pack', 'cute',      'Cute'),
    ('500919-snoopy-emojigg-pack',                'snoopy',    'Snoopy'),
    ('23425-pokemon-emojis-emojigg-pack',         'pokemon',   'Pokémon'),
    ('382227-spongebob-emojigg-pack',             'spongebob', 'SpongeBob'),
    ('464381-minecraft-emojis-emojigg-pack',      'minecraft', 'Minecraft'),
    ('7040-runescape-emojigg-pack',               'runescape', 'RuneScape'),
    ('407645-wow-collection-emojigg-pack',        'wow',       'Warcraft'),
    ('321391-type-shi-emojigg-pack',              'anime',     'Anime'),
    ('829461-pepe-emojigg-pack',                  'pepe',      'Pepe'),
    ('92711-deathnote-emojigg-pack',              'deathnote', 'Death Note'),
]


def clean(fn):
    base = re.sub(r'\.(png|webp)$', '', fn, flags=re.I)
    base = re.sub(r'^\d+[-_]+', '', base)          # drop emoji.gg id prefix
    base = re.sub(r'[_\s]+', '-', base)
    base = re.sub(r'[^A-Za-z0-9-]', '', base)
    base = re.sub(r'-+', '-', base).strip('-').lower()
    return base or 'emoji'


def main():
    if os.path.isdir(DST):
        shutil.rmtree(DST)
    os.makedirs(DST)

    packs_out, grand = [], 0
    for folder, slug, label in PACKS:
        srcdir = os.path.join(SRC, folder)
        if not os.path.isdir(srcdir):
            print('skip (missing): ' + folder)
            continue
        outdir = os.path.join(DST, slug)
        os.makedirs(outdir)
        items = []
        for fn in sorted(os.listdir(srcdir)):
            if not re.search(r'\.(png|webp)$', fn, re.I):
                continue
            shutil.copy2(os.path.join(srcdir, fn), os.path.join(outdir, fn))
            items.append([clean(fn), 'avatars/presets/' + slug + '/' + fn])
        if not items:
            continue
        packs_out.append({'slug': slug, 'label': label, 'items': items})
        grand += len(items)
        print('%-14s %-16s %3d' % (slug, label, len(items)))

    with open(os.path.join(DST, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'packs': packs_out}, f, ensure_ascii=False, separators=(',', ':'))
    print('---\n%d presets across %d packs -> %s' % (grand, len(packs_out), DST))


if __name__ == '__main__':
    main()
