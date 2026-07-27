#!/usr/bin/env python3
"""Whole-corpus driver for John Henry Newman's works from NewmanReader.

Modeled on schaff.py: a WORKS table drives fetch -> convert -> wrapper ->
newman.mk, reusing the NewmanReader HTML->LaTeX engine from dev2tex.py
(the same engine already behind development.html and consulting.html).

Per work it writes <id>-body.tex (the text, with Newman's notes inlined
as LaTeX footnotes at their reference points, and any back-of-book
notes.html appended as a Notes appendix) and a self-contained wrapper
<id>.tex, and after all works a newman.mk that lists NEWMAN_PDFS
(id=Output.pdf) and NEWMAN_HTML (id:tocdepth:"Title") for
resources/Makefile.

NewmanReader is one FrontPage/"arctic"-theme transcription, so every page
shares the dialect dev2tex handles (h2 chapters, h3 sections, {page}
markers, <font size=2> small caps, iso-8859-1). Two things vary across
the corpus and are generalized here:

  * Note references are keyed on the #noteN *anchor*, not the visible
    "[Note N]" text -- some works write a bare "[Note]" with the number
    only in the link (Grammar ch. 7), others "[Note N]" (Grammar ch. 9).
  * A chapter split across files (chapterN-1/-2/-3, part1/part2, ...) is
    detected by the absence of its own <h2>, so no hand-kept continuation
    list is needed; the split file's text simply continues the chapter.

A work's file set is whatever its index.html links in the same directory
(fragments dropped, order preserved), minus any `exclude`d extras (e.g.
appended reviews) and the `notes_appendix` file, which is rendered as a
trailing Notes chapter instead of as inline footnotes.

Run:  python newman.py                 build every work
      python newman.py grammar ...     build only these ids
      python newman.py fetch grammar   (re)download these ids' sources
      python newman.py fetch all       download every work's sources
"""
import os
import re
import sys
import urllib.request

from dev2tex import (blocks, finalize, inline as dev_inline, strip_tags,
                     CHAP, GRP_C, PAR, FN_O, FN_C)

SRCROOT = "newman-src"
BASE = "https://www.newmanreader.org/works/"
UA = "Mozilla/5.0 (compatible; merecatholicity build)"


# --- works table ------------------------------------------------------
# One dict per work. `path` is the NewmanReader directory under works/;
# `id` names our outputs (<id>-body.tex, <id>.tex, <id>.html, the PDF).
# `exclude` drops files the index links but that are not Newman's text
# (appended reviews, etc.); `notes_appendix` names a back-of-book notes
# file rendered as a trailing Notes chapter. `front` pulls the Dedication
# from index.html.

def W(**k):
    k.setdefault("byline", "John Henry Cardinal Newman")
    k.setdefault("author", "John Henry Newman")
    k.setdefault("exclude", [])
    k.setdefault("notes_appendix", None)
    k.setdefault("tocdepth", 2)
    k.setdefault("front", True)
    k.setdefault("blurb", "")
    k.setdefault("page", None)   # single-file work: "dir/file.html"
    k.setdefault("path", None)   # multi-file work: the site directory
    return k


WORKS = [
    # --- Anglican period ---------------------------------------------
    W(id="arians", path="arians", section="Anglican",
      title="The Arians of the Fourth Century",
      pdf="The_Arians_of_the_Fourth_Century.pdf",
      provenance="First published in 1833.",
      blurb="Newman's first book, a history of the Arian controversy and "
            "the Council of Nicaea."),
    W(id="tracts-times", path="times", section="Anglican",
      title="Tracts for the Times", pdf="Tracts_for_the_Times.pdf",
      provenance="Published from 1833 to 1841.",
      blurb="The tracts of the Oxford Movement, Newman's among them, "
            "closing with the famous Tract 90."),
    W(id="british-critic", path="britishcritic", section="Anglican",
      title="Essays from the British Critic",
      pdf="Essays_from_the_British_Critic.pdf",
      provenance="Essays of 1836 to 1842.",
      blurb="Newman's essays and reviews for the British Critic, the "
            "review of the Oxford Movement."),
    W(id="viamedia1", path="viamedia/volume1", section="Anglican",
      title="The Via Media, Volume 1: The Prophetical Office of the Church",
      pdf="Via_Media_Vol_1.pdf", provenance="Lectures of 1837.",
      blurb="The lectures on the prophetical office, the fullest statement "
            "of the Anglican via media Newman later had to retract."),
    W(id="viamedia2", path="viamedia/volume2", section="Anglican",
      title="The Via Media, Volume 2", pdf="Via_Media_Vol_2.pdf",
      provenance="Collected 1883.",
      blurb="Occasional letters and tracts on the Church, including Tract "
            "90 with the preface and notes of Newman's Catholic years."),
    W(id="justification", path="justification", section="Anglican",
      title="Lectures on the Doctrine of Justification",
      pdf="Lectures_on_Justification.pdf", provenance="Lectures of 1838.",
      blurb="Newman's search for a via media between the Lutheran and the "
            "Roman doctrines of justification."),
    W(id="english-saints", path="saints", section="Anglican",
      title="Lives of the English Saints",
      pdf="Lives_of_the_English_Saints.pdf",
      provenance="Published 1843 to 1844.",
      blurb="Lives from the series Newman projected at Littlemore: "
            "Bettelin, Edelwald, and Gundleus."),
    W(id="miracles", path="miracles", section="Anglican",
      title="Two Essays on Biblical and on Ecclesiastical Miracles",
      pdf="Essays_on_Miracles.pdf",
      provenance="The essays of 1826 and 1842.",
      blurb="The essay on the miracles of Scripture and the essay on the "
            "miracles of early ecclesiastical history."),
    W(id="oxford-sermons", path="oxford", section="Anglican",
      title="Fifteen Sermons Preached before the University of Oxford",
      pdf="Oxford_University_Sermons.pdf",
      provenance="Sermons of 1826 to 1843.",
      blurb="The university sermons on faith and reason, Newman's deepest "
            "Anglican thought on the nature of belief."),
    W(id="subjects", path="subjects", section="Anglican",
      title="Sermons Bearing on Subjects of the Day",
      pdf="Sermons_on_Subjects_of_the_Day.pdf",
      provenance="Collected 1843.",
      blurb="The last of the Anglican sermons, on the Church, the world, "
            "and the last things."),

    # --- Catholic period ---------------------------------------------
    W(id="loss-and-gain", path="gain", section="Catholic",
      title="Loss and Gain: The Story of a Convert", pdf="Loss_and_Gain.pdf",
      provenance="First published in 1848.",
      blurb="Newman's first Catholic book, a novel following an Oxford "
            "undergraduate to the Roman Church."),
    W(id="faith-prejudice", path="ninesermons", section="Catholic",
      title="Faith and Prejudice, and Other Sermons",
      pdf="Faith_and_Prejudice.pdf",
      provenance="Catholic sermons, collected 1956.",
      blurb="Nine sermons of the Catholic years, gathered after Newman's "
            "death."),
    W(id="discourses", path="discourses", section="Catholic",
      title="Discourses to Mixed Congregations",
      pdf="Discourses_to_Mixed_Congregations.pdf",
      provenance="Discourses of 1849.",
      blurb="Newman's first Catholic sermons, preached at Birmingham soon "
            "after his ordination in Rome."),
    W(id="anglicans1", path="anglicans/volume1", section="Catholic",
      title="Certain Difficulties Felt by Anglicans in Catholic Teaching, "
            "Volume 1",
      pdf="Difficulties_of_Anglicans_Vol_1.pdf",
      provenance="Lectures of 1850.",
      blurb="The lectures to his fellow converts on the difficulties of "
            "Anglicanism and the note of the one Church."),
    W(id="present-position", path="england", section="Catholic",
      title="The Present Position of Catholics in England",
      pdf="Present_Position_of_Catholics.pdf",
      provenance="Lectures of 1851.",
      blurb="The lectures to the Brothers of the Oratory on the Protestant "
            "tradition against the Catholic Church.",
      notes_appendix="notes.html"),
    W(id="idea", path="idea", section="Catholic",
      title="The Idea of a University", pdf="The_Idea_of_a_University.pdf",
      provenance="Discourses of 1852, with later lectures, collected 1873.",
      blurb="The discourses on university teaching and the lectures on the "
            "place of knowledge, science, and theology in a university."),
    W(id="grammar", path="grammar", section="Catholic",
      title="An Essay in Aid of a Grammar of Assent",
      pdf="Grammar_of_Assent.pdf", provenance="First published in 1870.",
      blurb="Newman's mature account of how the mind reaches real assent "
            "and certitude, and of the illative sense by which it reasons "
            "its way to belief.",
      exclude=["review1.html", "review2.html"], notes_appendix="notes.html"),
    W(id="cathedra", page="miscellaneous/cathedra.html", section="Catholic",
      title="Cathedra Sempiterna", pdf="Cathedra_Sempiterna.pdf",
      provenance="First published in 1853.", front=False,
      blurb="Newman's meditation on the perpetual chair of Peter."),
    W(id="callista", path="callista", section="Catholic",
      title="Callista: A Tale of the Third Century", pdf="Callista.pdf",
      provenance="First published in 1855.",
      blurb="Newman's novel of a Greek girl's conversion and martyrdom in "
            "the Roman Africa of St. Cyprian."),
    W(id="apologia", path="apologia65", section="Catholic",
      title="Apologia Pro Vita Sua", pdf="Apologia_Pro_Vita_Sua.pdf",
      provenance="Text of the 1865 edition.",
      blurb="Newman's history of his religious opinions, written in answer "
            "to Kingsley, one of the great spiritual autobiographies."),
    W(id="pusey", path="anglicans/volume2/pusey", section="Catholic",
      title="A Letter to the Rev. E. B. Pusey on his Recent Eirenicon",
      pdf="Letter_to_Pusey.pdf", provenance="Published in 1865.",
      blurb="Newman's letter on the Blessed Virgin in the faith of the "
            "Fathers, answering Pusey's Eirenicon.",
      notes_appendix="notes.html"),
    W(id="gerontius", page="verses/gerontius.html", section="Catholic",
      title="The Dream of Gerontius", pdf="The_Dream_of_Gerontius.pdf",
      provenance="First published in 1865.", front=False,
      blurb="The poem of a soul's passage through death to judgment and "
            "purgatory."),
    W(id="occasions", path="occasions", section="Catholic",
      title="Sermons Preached on Various Occasions",
      pdf="Sermons_on_Various_Occasions.pdf",
      provenance="Collected 1857 and after.",
      blurb="Catholic sermons for feasts and occasions, including the "
            "sermon on the Second Spring.",
      notes_appendix="notes.html"),
    W(id="norfolk", path="anglicans/volume2/gladstone", section="Catholic",
      title="A Letter to the Duke of Norfolk",
      pdf="Letter_to_the_Duke_of_Norfolk.pdf", provenance="Published 1875.",
      blurb="Newman's answer to Gladstone on the Vatican decrees, "
            "conscience, and the civil allegiance of Catholics."),
    W(id="five-letters", page="miscellaneous/jrmozley.html",
      section="Catholic", title="Five Letters", pdf="Five_Letters.pdf",
      provenance="Written in 1875.", front=False,
      blurb="Five letters on faith, doubt, and the assent of the mind."),
    W(id="sermon-notes", path="sermonnotes", section="Catholic",
      title="Sermon Notes", pdf="Sermon_Notes.pdf",
      provenance="Notes of 1849 to 1878.",
      blurb="Newman's own notes for sermons preached across the Catholic "
            "years.", notes_appendix="notes.html"),
    W(id="meditations", path="meditations", section="Catholic",
      title="Meditations and Devotions",
      pdf="Meditations_and_Devotions.pdf",
      provenance="Edited by Fr. William P. Neville, 1893.",
      blurb="The private meditations, litanies, and prayers, published "
            "after Newman's death."),
    W(id="athanasius1", path="athanasius/volume1", section="Catholic",
      title="Select Treatises of St. Athanasius, Volume 1",
      pdf="Select_Treatises_of_Athanasius_Vol_1.pdf",
      provenance="Newman's translation, revised 1881.",
      blurb="Newman's translation of Athanasius against the Arians, the "
            "orations entire."),
    W(id="athanasius2", path="athanasius/volume2", section="Catholic",
      title="Select Treatises of St. Athanasius, Volume 2",
      pdf="Select_Treatises_of_Athanasius_Vol_2.pdf",
      provenance="Newman's translation, revised 1881.",
      blurb="Newman's notes and essays on the Athanasian theology, the "
            "doctrinal companion to Volume 1."),
    W(id="inspiration", page="miscellaneous/scripture.html",
      section="Catholic", title="On the Inspiration of Scripture",
      pdf="On_the_Inspiration_of_Scripture.pdf", provenance="Published 1884.",
      front=False,
      blurb="Newman's late essay on the inspiration and the inerrancy of "
            "Holy Scripture."),
    W(id="religious-error", path="error", section="Catholic",
      title="The Development of Religious Error",
      pdf="Development_of_Religious_Error.pdf", provenance="Published 1885.",
      exclude=["barry.html", "fairbairn1.html", "fairbairn2.html"],
      blurb="Newman's last published article, on how religious error "
            "grows and spreads."),

    # --- Miscellaneous works -----------------------------------------
    W(id="arguments", path="arguments", section="Miscellaneous",
      title="Discussions and Arguments on Various Subjects",
      pdf="Discussions_and_Arguments.pdf", provenance="Collected 1872.",
      blurb="Essays on the Tamworth Reading Room, ecclesiastical miracles, "
            "and the development of doctrine."),
    W(id="essays1", path="essays/volume1", section="Miscellaneous",
      title="Essays Critical and Historical, Volume 1",
      pdf="Essays_Critical_and_Historical_Vol_1.pdf",
      provenance="Collected 1871.", exclude=["review.html"],
      blurb="Essays of the Anglican years, including the essays on the "
            "Fathers and the prophetical office."),
    W(id="essays2", path="essays/volume2", section="Miscellaneous",
      title="Essays Critical and Historical, Volume 2",
      pdf="Essays_Critical_and_Historical_Vol_2.pdf",
      provenance="Collected 1871.",
      blurb="Further essays, including the essay on the Anglican claim and "
            "the essay on John Keble."),
    W(id="historical1", path="historical/volume1", section="Miscellaneous",
      title="Historical Sketches, Volume 1",
      pdf="Historical_Sketches_Vol_1.pdf", provenance="Collected 1872.",
      blurb="The Turks in their relation to Europe, Cicero, Apollonius of "
            "Tyana, and primitive Christianity."),
    W(id="historical2", path="historical/volume2", section="Miscellaneous",
      title="Historical Sketches, Volume 2",
      pdf="Historical_Sketches_Vol_2.pdf", provenance="Collected 1872.",
      blurb="The Church of the Fathers, and the trials of Theodoret, "
            "St. Chrysostom, and St. Basil."),
    W(id="historical3", path="historical/volume3", section="Miscellaneous",
      title="Historical Sketches, Volume 3",
      pdf="Historical_Sketches_Vol_3.pdf", provenance="Collected 1872.",
      blurb="The rise and progress of universities, and the Benedictine "
            "and mission essays."),
    W(id="addresses", path="addresses", section="Miscellaneous",
      title="Addresses to Cardinal Newman with His Replies",
      pdf="Addresses_to_Cardinal_Newman.pdf",
      provenance="Edited by Fr. William P. Neville, 1905.",
      blurb="The addresses on Newman's cardinalate and his replies, "
            "including the Biglietto Speech against liberalism."),
    W(id="athanasius-tracts", path="athanasius/historical",
      section="Miscellaneous", title="Historical Tracts of St. Athanasius",
      pdf="Historical_Tracts_of_Athanasius.pdf",
      provenance="Newman's translation of 1843.",
      blurb="Newman's translation of the historical writings of Athanasius "
            "on the Arian controversy."),
    W(id="froude-remains", page="miscellaneous/remains.html",
      section="Miscellaneous", title="Froude's Remains",
      pdf="Froudes_Remains.pdf", provenance="Review of 1838.", front=False,
      blurb="Newman's essay on the remains of his friend Hurrell Froude."),
    W(id="hymni", page="miscellaneous/hymni.html", section="Miscellaneous",
      title="Hymni Ecclesiae", pdf="Hymni_Ecclesiae.pdf",
      provenance="Collected 1838 and 1865.", front=False,
      blurb="The hymns of the Roman and Parisian breviaries gathered by "
            "Newman, in the original Latin."),
    W(id="library-fathers", path="fathers", section="Miscellaneous",
      title="The Library of the Fathers", pdf="Library_of_the_Fathers.pdf",
      provenance="Prefaces of 1838 and after.",
      blurb="Newman's prefaces to the Oxford translations of Chrysostom, "
            "Cyprian, and Cyril."),
    W(id="church-empires", page="miscellaneous/wilberforce.html",
      section="Miscellaneous", title="The Church and the Empires",
      pdf="The_Church_and_the_Empires.pdf", provenance="Review of 1873.",
      front=False,
      blurb="Newman's review of the relations of the Church to the "
            "empires of the world."),
    W(id="russian-church", page="miscellaneous/palmer.html",
      section="Miscellaneous", title="Notes of a Visit to the Russian Church",
      pdf="Notes_on_the_Russian_Church.pdf",
      provenance="By William Palmer, edited by Newman, 1882.", front=False,
      blurb="William Palmer's notes of his visits to the Russian Church, "
            "collected and edited by Newman."),
    W(id="sayings", path="sayings", section="Miscellaneous",
      title="Sayings of Cardinal Newman", pdf="Sayings_of_Cardinal_Newman.pdf",
      provenance="Collected 1890.",
      blurb="A gathering of memorable sayings from Newman's works, letters, "
            "and conversation."),
    W(id="tracts-theological", path="tracts", section="Miscellaneous",
      title="Tracts Theological and Ecclesiastical",
      pdf="Tracts_Theological_and_Ecclesiastical.pdf",
      provenance="Collected 1871.",
      blurb="Tracts on the Holy Trinity, the ordinary of the Mass, and "
            "other theological subjects."),
    W(id="verses", path="verses", section="Miscellaneous",
      title="Verses on Various Occasions", pdf="Verses_on_Various_Occasions.pdf",
      provenance="Collected 1868.", exclude=["review.html"],
      blurb="Newman's collected poems, from the Lyra Apostolica to the "
            "Dream of Gerontius."),
]

# Parochial and Plain Sermons: eight volumes, one WORKS entry each.
for _v, _y in {1: 1834, 2: 1835, 3: 1836, 4: 1839, 5: 1840, 6: 1842,
               7: 1842, 8: 1843}.items():
    WORKS.append(W(
        id="parochial%d" % _v, path="parochial/volume%d" % _v,
        section="Anglican",
        title="Parochial and Plain Sermons, Volume %d" % _v,
        pdf="Parochial_and_Plain_Sermons_Vol_%d.pdf" % _v,
        provenance="Published in %d." % _y,
        blurb="Newman's Anglican parish sermons, the largest and most "
              "enduring body of his preaching."))


# --- NewmanReader HTML -> LaTeX, generalized from dev2tex --------------

# A note reference: any [...] bracket carrying a link to #noteN. Keys on
# the anchor so a bare "[Note]" (number only in the href) is caught too.
# A note id is the anchor after '#': plain "note12", margin "mnote12", or
# lettered "noteA" -- some works (Athanasius' tracts) use all three.
NOTE_REF = re.compile(r'\[[^\[\]]*?href="#(m?note[A-Za-z0-9]+)"[^\[\]]*?\]')
NOTE_ANCHOR = re.compile(r'<a\s+name="(m?note[A-Za-z0-9]+)"[^>]*>\s*(?:</a>)?')


def inline(t):
    """dev2tex.inline, but note references are found by their #noteN
    anchor first (before dev2tex strips the <a> tags)."""
    t = NOTE_REF.sub(lambda m: FN_O + m.group(1) + FN_C, t)
    return dev_inline(t)


def parse_notes(html):
    """Endnotes of one file, keyed on the <a name="noteN"> anchors that
    bound them. Tolerates the two NewmanReader shapes: a numbered "N. ...
    Return to text" note, and a bare note with neither number nor
    backlink (the anchor sits inside a "Note"/"Notes" <h3> header)."""
    notes = {}
    anchors = list(NOTE_ANCHOR.finditer(html))
    for i, a in enumerate(anchors):
        n = a.group(1)
        end = anchors[i + 1].start() if i + 1 < len(anchors) else len(html)
        seg = html[a.end():end]
        # a header remnant the anchor lived in (a "Note"/"Notes" label and
        # the closing font/heading tags), leading block tags, page markers
        seg = re.sub(r'^\s*(?:Notes?\b[^<]*)?'
                     r'(?:</?(?:font|h[1-6]|p|a|br)[^>]*>|\{[^}]{0,7}\}|&nbsp;|\s)*',
                     '', seg, count=1, flags=re.I)
        # a redundant leading label: the note's own number/letter (the id
        # minus any "note"/"mnote" prefix), e.g. "1." for note1, "A." for
        # noteA. Keyed to the id so real abbreviations ("St.") are safe.
        label = re.sub(r'^m?note', '', n)
        seg = re.sub(r'^(?:Note\s+)?%s\.\s*' % re.escape(label), '', seg,
                     count=1)
        # the trailing "Return to text" backlink and anything after it
        seg = re.split(r'<a[^>]*href="#return\d+"', seg)[0]
        seg = re.sub(r'(?:<br[^>]*>|\s)+$', '', seg)
        notes[n] = seg.strip()
    return notes


# Known HTML tags that must never reach LaTeX. Used as a final safety net
# after conversion; keyed on real tag names so prose like "a < b" is safe.
_HTML_TAG = re.compile(
    r'</?(?:a|b|i|u|em|strong|sub|sup|span|font|div|dir|ul|ol|li|menu|p|br|'
    r'hr|h[1-6]|blockquote|table|tr|td|th|img|center|pre|code|tt|small|big)'
    r'\b[^>]*>', re.I)


def _prenormalize(h):
    """Map tags dev2tex.inline/blocks don't know onto ones they do, or
    drop them: <em>/<strong> emphasis, <dir>/<ul>/<ol>/<menu>/<li> lists,
    and multi-letter <u> underline (a single-letter <u>x</u> is left for
    the transliteration-macron pass in dev2tex.inline)."""
    h = re.sub(r'<em(?=[\s>])[^>]*>', '<i>', h).replace('</em>', '</i>')
    h = re.sub(r'<strong(?=[\s>])[^>]*>', '<b>', h).replace('</strong>', '</b>')
    h = re.sub(r'</?(?:dir|ul|ol|menu)[^>]*>', '', h)
    h = re.sub(r'<li[^>]*>', '<p>', h).replace('</li>', '')
    h = re.sub(r'</?(?:sub|sup)[^>]*>', '', h)
    # <u>x</u> single letter = transliteration macron (kept for dev2tex);
    # any other <u>...</u> is emphasis/empty cruft -> unwrap to its text
    h = re.sub(r'<u>([^<]*)</u>',
               lambda m: m.group(0) if len(m.group(1)) == 1
               and m.group(1).isalpha() else m.group(1), h)
    return h


def _strip_head(raw):
    h = re.search(r'</head\s*>', raw, re.I)
    raw = raw[h.end():] if h else raw
    return re.sub(r'</?(?:body|html)[^>]*>', '', raw, flags=re.I)


def _notes_start(raw):
    """Offset of the heading that opens the endnotes (the <h3> carrying
    the first note-target anchor), or None."""
    a1 = NOTE_ANCHOR.search(raw)
    if not a1:
        return None
    heads = list(re.finditer(r'<h[234][^>]*>', raw[:a1.start()]))
    return heads[-1].start() if heads else a1.start()


def convert_file(path, heading=None):
    """One chapter/part file to LaTeX. A file with its own <h2> opens a
    chapter; a split-continuation file (no <h2>) just continues. Its
    endnotes are inlined as \\footnote at their reference points."""
    raw = _strip_head(open(path, "rb").read().decode("cp1252")
                      .replace("\r\n", "\n"))

    m2 = re.search(r'<h2[^>]*>(.*?)</h2>', raw, re.S)
    if heading is None and m2:
        heading = re.sub(r'\s+', ' ', strip_tags(m2.group(1))).strip()
    if m2:
        raw = raw[:m2.start()] + raw[m2.end():]
    # a file may pack several chapters (one <h2> heads it, the rest are
    # inner <h2>s): demote the remaining ones to sections
    raw = re.sub(r'<h2[^>]*>', '<h3>', raw).replace('</h2>', '</h3>')

    nstart = _notes_start(raw)
    footer = raw.find("Newman Reader")
    ends = [x for x in (nstart, footer if footer >= 0 else None)
            if x is not None]
    body = raw[:min(ends)] if ends else raw
    notes = parse_notes(raw[nstart: footer if footer >= 0 else len(raw)]) \
        if nstart is not None else {}

    tex = finalize(inline(blocks(_prenormalize(body))))
    if heading:
        tex = finalize(CHAP + heading + GRP_C) + "\n\n" + tex

    missing = []

    def put_note(m):
        n = m.group(1)
        if n not in notes:
            missing.append(n)
            return ""
        return ("\\footnote{"
                + finalize(inline(blocks(_prenormalize(notes[n])))).strip()
                + "}")

    tex = re.sub(FN_O + r"([A-Za-z0-9]+)" + FN_C, put_note, tex)
    if missing:
        print(f"  {os.path.basename(path)}: missing notes {missing}")
    return re.sub(r'\n{3,}', '\n\n', tex).strip()


def convert_appendix(path, title="Notes"):
    """A back-of-book notes file (its own <a name="noteN"> anchors are
    discursive endnotes, not footnote targets) as a plain Notes chapter;
    each note's <h3> title becomes a section."""
    raw = _strip_head(open(path, "rb").read().decode("cp1252")
                      .replace("\r\n", "\n"))
    a1 = NOTE_ANCHOR.search(raw)
    if a1:
        heads = list(re.finditer(r'<h[234][^>]*>', raw[:a1.start()]))
        start = heads[-1].start() if heads else a1.start()
    else:
        start = 0
    footer = raw.find("Newman Reader")
    body = raw[start: footer if footer >= 0 else len(raw)]
    return finalize(CHAP + title + GRP_C) + "\n\n" + \
        finalize(inline(blocks(_prenormalize(body)))).strip()


FRONT = ("dedication", "advertisement", "preface", "introduction")
FRONT_STOP = ("titlepage", "contents", "background")


def front_matter(index_path):
    """Any front matter carried in index.html (Dedication, Advertisement,
    Preface, Introduction), from the earliest front anchor to the content
    boundary. Its own <h3> headings are promoted to front chapters."""
    raw = open(index_path, "rb").read().decode("cp1252").replace("\r\n", "\n")

    def enclosing_h3(pos):
        pre = list(re.finditer(r'<h3[^>]*>', raw[:pos]))
        return pre[-1].start() if pre else pos

    starts = [enclosing_h3(m.start()) for a in FRONT
              if (m := re.search(r'<a\s+name="%s"' % a, raw))]
    if not starts:
        return ""
    start = min(starts)
    stops = [enclosing_h3(m.start()) for a in FRONT_STOP
             if (m := re.search(r'<a\s+name="%s"' % a, raw))
             and m.start() > start]
    seg = raw[start: min(stops) if stops else len(raw)]
    body = finalize(inline(blocks(_prenormalize(seg)))).strip()
    return body.replace("\\devsection{", "\\devchapter{")


# A content link: same-directory or a (possibly nested) subdirectory
# .html, never a parent (../) or absolute URL. Fragments are dropped.
_HREF = re.compile(r'href="((?:[a-z0-9][a-z0-9-]*/)*[a-z0-9][a-z0-9-]*\.html)'
                   r'(?:#[^"]*)?"', re.I)


def _resolve(read, work, rel="index.html", leaves=None, seen_idx=None):
    """Walk index.html (and any nested sub-work index.html it links) to a
    flat, ordered list of leaf content files, relative to the work root.
    `read(rel)` returns the decoded HTML for a relative path. Subdirectory
    content (essay1/section1.html) and nested sub-works (apollonius/
    index.html) both resolve; excluded basenames and parents are skipped."""
    if leaves is None:
        leaves, seen_idx = [], {rel}
    try:
        raw = read(rel)
    except Exception:                       # noqa: BLE001 -- a dead link
        return leaves
    base = rel.rsplit("/", 1)[0] if "/" in rel else ""
    excl = {"index.html", *work["exclude"]}
    if work["notes_appendix"]:
        excl.add(work["notes_appendix"])
    for m in _HREF.finditer(raw):
        full = os.path.normpath(base + "/" + m.group(1) if base
                                else m.group(1)).replace(os.sep, "/")
        if full.startswith(".."):
            continue
        if full.endswith("index.html"):        # a nested sub-work: recurse
            if full != rel and full not in seen_idx and len(seen_idx) < 80:
                seen_idx.add(full)
                _resolve(read, work, full, leaves, seen_idx)
            continue
        name = full.rsplit("/", 1)[-1]
        if name in excl or full in leaves:
            continue
        leaves.append(full)
    return leaves


def content_files(index_path, work):
    d = os.path.dirname(index_path)

    def read(rel):
        return open(os.path.join(d, rel), "rb").read().decode("cp1252")

    return _resolve(read, work)


# --- assembly ---------------------------------------------------------

_TEXTCMDS = ("\\emph{", "\\textbf{", "\\textsc{", "\\textit{", "\\textsl{",
             "\\textgreek{", "\\texthebrew{")


def _heal_emphasis(s):
    """An inline text command may not contain a paragraph break, but the
    transcriptions sometimes wrap a <p> boundary in <i>/<b> (a runaway
    \\emph{ ... \\par ... }). Collapse any paragraph break inside such a
    command's braces to a space; \\footnote (which may hold paragraphs)
    is left alone."""
    out, i, n = [], 0, len(s)
    while i < n:
        hits = [s.find(c, i) for c in _TEXTCMDS]
        hits = [h for h in hits if h != -1]
        if not hits:
            out.append(s[i:])
            break
        j = min(hits)
        out.append(s[i:j])
        cmd = next(c for c in _TEXTCMDS if s.startswith(c, j))
        k, depth, buf = j + len(cmd), 1, []
        while k < n and depth > 0:
            ch = s[k]
            depth += (ch == "{") - (ch == "}")
            if depth > 0:
                buf.append(ch)
            k += 1
        inner = "".join(buf)
        # a block quote environment cannot live inside a text command
        # (malformed <i> wrapping a <blockquote>); flatten it away
        inner = re.sub(r'\\(?:begin|end)\{quote\}', '', inner)
        inner = re.sub(r'\s*\n\s*\n\s*', ' ', inner).strip()
        out.append(cmd + inner + "}")
        i = k
    return "".join(out)


# Characters pdflatex's text fonts cannot set (inputenc/textcomp already
# cover the em-dash, ellipsis, curly quotes, and the Latin-1 fractions).
_SYMBOLS = {
    "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅓": "1/3", "⅔": "2/3",
    "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6",
    "⅐": "1/7", "⅑": "1/9", "⅒": "1/10", "⅟": "1/",
    "∴": "\\ensuremath{\\therefore}", "∵": "\\ensuremath{\\because}",
    "×": "\\ensuremath{\\times}", "÷": "\\ensuremath{\\div}",
    "′": "'", "″": "''", "‴": "'''", "‹": "", "›": "", "‚": ",",
}


def _map_symbols(body):
    for a, b in _SYMBOLS.items():
        body = body.replace(a, b)
    return body


def _cap_quotes(body, limit=5):
    """LaTeX allows only ~6 nested list/quote environments; the sources
    sometimes stack blockquotes deeper (indentation, quotes within
    quotes). Drop begin/end pairs past `limit` -- the text stays, just
    less indented -- keeping the nesting balanced."""
    out, depth = [], 0
    for tok in re.split(r'(\\begin\{quote\}|\\end\{quote\})', body):
        if tok == "\\begin{quote}":
            depth += 1
            if depth <= limit:
                out.append(tok)
        elif tok == "\\end{quote}":
            if depth > 0:                    # a matched close
                if depth <= limit:
                    out.append(tok)
                depth -= 1
            # else: orphan \end{quote} (its \begin was dropped) -> drop
        else:
            out.append(tok)
    return "".join(out)


def convert(work):
    d = os.path.join(SRCROOT, work["id"])
    parts = []
    if work["page"]:
        # single-file work: the page carries its own <h2> title and body
        fn = work["page"].rsplit("/", 1)[-1]
        parts.append(convert_file(os.path.join(d, fn)))
    else:
        idx = os.path.join(d, "index.html")
        if work["front"] and os.path.exists(idx):
            fm = front_matter(idx)
            if fm:
                parts.append(fm)
        for f in content_files(idx, work):
            parts.append(convert_file(os.path.join(d, f)))
        if work["notes_appendix"]:
            ap = os.path.join(d, work["notes_appendix"])
            if os.path.exists(ap):
                parts.append(convert_appendix(ap))

    body = "\n\n".join(p for p in parts if p) + "\n"
    body = (body.replace("\\devchapter{", "\\xchapter{")
                .replace("\\devsection{", "\\xsection{")
                .replace("\\devunit{", "\\xsubsection{"))
    body = _heal_emphasis(body)
    body = _cap_quotes(body)
    body = _map_symbols(body)
    # a line break before a "[" (a verse line, a bracketed lemma) would be
    # read as \\'s optional-length argument; keep them apart
    body = re.sub(r'(\\\\\s*)\[', r'\1{}[', body)
    body = _HTML_TAG.sub('', body)          # safety net for unhandled cruft
    # a note reference in front matter (which has no notes section to
    # resolve against) leaves an unresolved FN sentinel; drop it, then
    # sweep any other stray private-use sentinel so pdflatex never sees one
    body = re.sub(FN_O + r'[A-Za-z0-9]*' + FN_C, '', body)
    body = re.sub('[-]', '', body)
    with open(f'{work["id"]}-body.tex', "w", encoding="utf-8") as fh:
        fh.write(body)

    leftover = sorted(set(re.findall(r'<[a-zA-Z/][^>]*>', body)))
    print(f'{work["id"]}: {body.count(chr(92) + "xchapter{")} chapters, '
          f'{body.count(chr(92) + "xsection{")} sections, '
          f'{body.count(chr(92) + "footnote{")} footnotes '
          f'({len(body) // 1024} KB)'
          + (f'  LEFTOVER {leftover[:6]}' if leftover else ''))


def _tex(s):
    for a, b in (("\\", r"\textbackslash{}"), ("&", r"\&"), ("%", r"\%"),
                 ("#", r"\#"), ("_", r"\_"), ("$", r"\$")):
        s = s.replace(a, b)
    return s


WRAPPER = r"""% @@TITLE@@, John Henry Newman.
% Text from the NewmanReader transcription (newman-src/@@ID@@/, raw
% scrape; re-fetch with `make newman-fetch`). GENERATED by newman.py --
% do not edit by hand. Newman's notes are set as footnotes at their
% points of reference. Preamble mirrors the curated-works house style
% with the LGR/textalpha Greek guard so pdflatex and pandoc both build.
\documentclass[11pt,letterpaper]{article}
\ifdefined\pdfsuppressptexinfo\pdfsuppressptexinfo=-1 \fi
\ifdefined\pdftrailerid\pdftrailerid{}\fi
\usepackage[margin=1in]{geometry}
\IfFileExists{textalpha.sty}{%
  \usepackage[LGR,T1]{fontenc}%
  \usepackage[utf8]{inputenc}%
  \usepackage{textalpha}%
}{%
  \usepackage[T1]{fontenc}%
  \usepackage[utf8]{inputenc}%
}
\ifdefined\ensuregreek
  \newcommand{\textgreek}[1]{\ensuregreek{#1}}
\else
  \newcommand{\textgreek}[1]{\emph{[Greek]}}
\fi
\newcommand{\texthebrew}[1]{{\emph{[Hebrew]}}}
\usepackage{mathpazo}
\usepackage{amssymb}
\usepackage{textcomp}
\usepackage{microtype}
\usepackage{xcolor}
\usepackage{needspace}
\usepackage[colorlinks=true,linkcolor=ink,urlcolor=maroon,citecolor=ink,filecolor=ink]{hyperref}
\urlstyle{same}
\hypersetup{pdftitle={@@TITLE@@},pdfauthor={@@AUTHOR@@}}
\linespread{1.06}
\setlength{\emergencystretch}{1.5em}

\definecolor{ink}{HTML}{2A2521}
\definecolor{heading}{HTML}{8C4A32}
\definecolor{subhead}{HTML}{6E5642}
\definecolor{accent}{HTML}{B0894C}
\definecolor{maroon}{HTML}{7B2E2E}

% Chapters: new page, TOC section level.
\newcommand{\xchapter}[1]{%
  \clearpage\phantomsection\addcontentsline{toc}{section}{#1}%
  {\normalfont\fontsize{14}{17}\selectfont\bfseries\color{heading}%
   \raggedright\emergencystretch=1.5em #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 1pt}\medskip}

% Sections within a chapter: TOC subsection level.
\newcommand{\xsection}[1]{%
  \par\vspace{1.2em}\phantomsection\addcontentsline{toc}{subsection}{#1}%
  \needspace{4\baselineskip}%
  {\normalfont\fontsize{12.5}{15.5}\selectfont\bfseries\color{heading}%
   \raggedright\emergencystretch=1.5em #1\par}%
  \vspace{2pt}{\color{accent}\hrule height 0.6pt}\smallskip}

% Numbered subheads within a section, not in the TOC.
\newcommand{\xsubsection}[1]{%
  \needspace{3\baselineskip}\par\medskip
  {\normalfont\bfseries\color{subhead}\raggedright\emergencystretch=1.5em #1\par}%
  \nobreak\smallskip}

\begin{document}
\color{ink}

\begin{titlepage}
\centering
\vspace*{4em}
{\LARGE\bfseries\color{heading} @@TITLE@@\par}
\vspace{2em}
{\large\bfseries\color{heading} @@BYLINE@@\par}
\vspace{2.5em}
{\itshape\color{subhead}\parbox{0.8\linewidth}{\centering @@BLURB@@\par}}
\vspace{2.5em}
{@@PROVENANCE@@\par}
\vfill
{\small The text is in the public domain. Newman's notes are set as
footnotes at their points of reference.\par}
\vspace{2em}
\end{titlepage}

\tableofcontents

\input{@@ID@@-body.tex}

\end{document}
"""


def write_wrapper(work):
    text = WRAPPER
    subs = {
        "@@ID@@": work["id"],
        "@@TITLE@@": _tex(work["title"]),
        "@@AUTHOR@@": _tex(work["author"]),
        "@@BYLINE@@": _tex(work["byline"]),
        "@@BLURB@@": _tex(work["blurb"]),
        "@@PROVENANCE@@": _tex(work["provenance"]),
    }
    for k, v in subs.items():
        text = text.replace(k, v)
    with open(f'{work["id"]}.tex', "w", encoding="utf-8") as f:
        f.write(text)


def write_makefile():
    """Emit newman.mk: NEWMAN_PDFS (id=Output.pdf) and NEWMAN_HTML
    (id:tocdepth:"Title"), both consumed by resources/Makefile."""
    pdfs = [f'  {w["id"]}={w["pdf"]}' for w in WORKS]
    htmls = [f'  {w["id"]}:{w["tocdepth"]}:"{w["title"]}"' for w in WORKS]

    def block(var, items):
        return f"{var} = \\\n" + " \\\n".join(items) + "\n"

    text = "\n".join([
        "# GENERATED by newman.py -- do not edit by hand.",
        '# The Newman corpus: id=Output.pdf and id:tocdepth:"HTML title".',
        "",
        block("NEWMAN_PDFS", pdfs),
        block("NEWMAN_HTML", htmls),
    ])
    with open("newman.mk", "w", encoding="utf-8") as f:
        f.write(text)


# --- fetch ------------------------------------------------------------

def fetch(work):
    d = os.path.join(SRCROOT, work["id"])
    os.makedirs(d, exist_ok=True)

    def download(rel, url):
        data = urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": UA}),
            timeout=60).read()
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p) or d, exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(data)

    if work["page"]:                        # single-file work
        fn = work["page"].rsplit("/", 1)[-1]
        download(fn, BASE + work["page"])
        print(f'  {work["id"]}: 1 page')
        return

    def read(rel):                          # download-on-miss; used for indexes
        p = os.path.join(d, rel)
        if not os.path.exists(p):
            download(rel, BASE + work["path"] + "/" + rel)
        return open(p, "rb").read().decode("cp1252")

    leaves = _resolve(read, work)           # pulls index.html + every sub-index
    extra = [work["notes_appendix"]] if work["notes_appendix"] else []
    for rel in leaves + extra:
        if os.path.exists(os.path.join(d, rel)):
            continue
        try:
            download(rel, BASE + work["path"] + "/" + rel)
        except Exception as e:              # noqa: BLE001 -- report and go on
            print(f'  FAIL {work["id"]}/{rel}: {e}')
    print(f'  {work["id"]}: {len(leaves)} files')


def main():
    args = sys.argv[1:]
    if args and args[0] == "fetch":
        ids = set(args[1:]) - {"all"}
        for w in WORKS:
            if not ids or w["id"] in ids:
                print(f'fetching {w["id"]}...')
                fetch(w)
        return
    only = set(args)
    for w in WORKS:
        if only and w["id"] not in only:
            continue
        convert(w)
        write_wrapper(w)
    write_makefile()
    print("wrote newman.mk")


if __name__ == "__main__":
    main()
