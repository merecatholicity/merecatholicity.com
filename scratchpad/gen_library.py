#!/usr/bin/env python3
"""Generate the body content of library.html (a master catalog of every work
we host). Emits <h2>/<ul> sections; the caller splices it into the page
skeleton. Schaff volumes come from resources/schaff.py so they never drift."""
import sys
sys.path.insert(0, "resources")
from schaff import VOLUMES, SERIES, ROMAN, pdf_name, ANTE, NPNF1, NPNF2  # noqa


def ent(s):
    for a, b in (("&", "&amp;"), ("æ", "&aelig;"), ("Æ", "&AElig;"),
                 ("é", "&eacute;"), ("É", "&Eacute;"), ("'", "&rsquo;"),
                 ("í", "&iacute;")):
        s = s.replace(a, b)
    return s


def item(title, html, pdf=None):
    links = '<a href="%s">Read online (HTML)</a>' % html
    if pdf:
        links += ' &middot; <a href="%s">Download (PDF)</a>' % pdf
    return "<li><strong>%s</strong> %s</li>" % (ent(title), links)


def section(hid, heading, intro, items):
    out = ['<h2 id="%s">%s</h2>' % (hid, ent(heading))]
    if intro:
        out.append("<p>%s</p>" % intro)
    out.append('<ul class="library">')
    out.extend(items)
    out.append("</ul>")
    return "\n".join(out)


# (title, html, pdf)  -- pdf None means an online page only
SCRIPTURE = [
    ("The Holy Bible, Douay-Rheims (Challoner)", "douay-rheims.html", "Douay-Rheims_Bible.pdf"),
    ("The Holy Bible, King James Version", "kjv.html", "King_James_Bible.pdf"),
    ("Catena Aurea on St. Matthew", "catena-matthew.html", "Catena_Aurea_Matthew.pdf"),
    ("Catena Aurea on St. Mark", "catena-mark.html", "Catena_Aurea_Mark.pdf"),
    ("Catena Aurea on St. Luke", "catena-luke.html", "Catena_Aurea_Luke.pdf"),
    ("Catena Aurea on St. John", "catena-john.html", "Catena_Aurea_John.pdf"),
]

SUMMA = [
    ("The First Part", "summa-fp.html", "Summa_Theologica_1_First_Part.pdf"),
    ("The First Part of the Second Part", "summa-fs.html", "Summa_Theologica_2_First_Part_of_the_Second_Part.pdf"),
    ("The Second Part of the Second Part", "summa-ss.html", "Summa_Theologica_3_Second_Part_of_the_Second_Part.pdf"),
    ("The Third Part", "summa-tp.html", "Summa_Theologica_4_Third_Part.pdf"),
    ("The Supplement", "summa-xp.html", "Summa_Theologica_5_Supplement.pdf"),
]

FATHERS = [
    ("The Commonitory, by Vincent of Lérins", "commonitory.html", "The_Commonitory.pdf"),
    ("The Epistles of St. Ignatius of Antioch", "ignatius.html", "Epistles_of_Ignatius.pdf"),
    ("The First Epistle of Clement to the Corinthians", "clement.html", "First_Epistle_of_Clement.pdf"),
    ("The First Apology of St. Justin Martyr", "justin.html", "First_Apology_of_Justin_Martyr.pdf"),
    ("The Didache", "didache.html", "Didache.pdf"),
    ("Against Heresies, Book III, by St. Irenaeus", "irenaeus3.html", "Against_Heresies_Book_III.pdf"),
    ("On Baptism, by Tertullian", "baptism.html", "On_Baptism.pdf"),
    ("On the Unity of the Church, by St. Cyprian", "unity.html", "On_the_Unity_of_the_Church.pdf"),
    ("The Catechetical Lectures of St. Cyril of Jerusalem", "cyril.html", "Catechetical_Lectures.pdf"),
    ("The Great Catechism of St. Gregory of Nyssa", "gregory.html", "Great_Catechism.pdf"),
    ("On the Soul and the Resurrection, by St. Gregory of Nyssa", "soulres.html", "On_the_Soul_and_the_Resurrection.pdf"),
    ("The Thirty-Ninth Festal Letter of St. Athanasius", "festal39.html", "Festal_Letter_39.pdf"),
    ("The Tome of St. Leo", "tome.html", "Tome_of_St_Leo.pdf"),
    ("The Enchiridion on Faith, Hope, and Love, by St. Augustine", "enchiridion.html", "Enchiridion.pdf"),
    ("On Baptism, Against the Donatists, by St. Augustine", "onbaptism.html", "On_Baptism_Against_the_Donatists.pdf"),
    ("The Conferences on Prayer, by St. John Cassian", "cassian-prayer.html", "Conferences_on_Prayer.pdf"),
    ("The Holy Rule of St. Benedict", "benedict-rule.html", "Rule_of_St_Benedict.pdf"),
    ("Letters of St. Gregory the Great on the Title Universal Bishop", "gregory-letters.html", "Letters_on_the_Title_Universal_Bishop.pdf"),
]

COUNCILS = [
    ("The Seven Ecumenical Councils of the Undivided Church", "councils.html", "Seven_Ecumenical_Councils.pdf"),
    ("The Ravenna Document", "ravenna.html", "The_Ravenna_Document.pdf"),
    ("The Chieti Document", "chieti.html", "The_Chieti_Document.pdf"),
    ("Encyclical of the Eastern Patriarchs, 1848", "encyclical1848.html", "Encyclical_of_the_Eastern_Patriarchs.pdf"),
    ("The Declaration of Scranton", "scranton.html", "Declaration_of_Scranton.pdf"),
    ("Joint Declaration on the Doctrine of Justification", "jddj.html", "Joint_Declaration_on_Justification.pdf"),
    ("The Bishop of Rome, both roads in their own voices", "bishop-of-rome.html", "The_Bishop_of_Rome.pdf"),
]

NEWMAN = [
    ("An Essay on the Development of Christian Doctrine", "development.html", "Development_of_Christian_Doctrine.pdf"),
    ("On Consulting the Faithful in Matters of Doctrine", "consulting.html", "On_Consulting_the_Faithful.pdf"),
]

PRAYER = [
    ("Worship at the altar", "altar.html", None),
    ("The hours of prayer", "hours.html", None),
    ("The Jesus Prayer", "jesus-prayer.html", None),
    ("Lectio divina", "lectio-divina.html", None),
    ("Confession and fasting", "confession-fasting.html", None),
    ("Mary the Theotokos", "theotokos.html", None),
    ("The Mother of God", "mary.html", None),
    ("The Rosary", "rosary.html", None),
    ("A rule of life from St. Benedict", "rule-of-benedict.html", None),
    ("The Treatise on Law, by St. Thomas Aquinas", "law.html", "Treatise_on_Law.pdf"),
]

OURS = [
    ("Mere Catholicity (the book)", "book.html", "Mere_Catholicity.pdf"),
    ("The bishop and the presbyter", "bishop-presbyter.html", "The_Bishop_and_the_Presbyter.pdf"),
    ("Charting, part 1: the historic communions", "charting-communions.html", "Charting_Historic_Communions.pdf"),
    ("Charting, part 2: the free churches", "free-churches.html", "Charting_Free_Churches.pdf"),
    ("Charting, part 3: fifty objections", "objections.html", "Fifty_Objections.pdf"),
]


def schaff_section():
    groups = [("Ante-Nicene Fathers", ANTE), ("Nicene and Post-Nicene Fathers, First Series", NPNF1), ("Nicene and Post-Nicene Fathers, Second Series", NPNF2)]
    out = ['<h2 id="schaff">The complete library of the Fathers</h2>',
           '<p>The whole standard English set, the Ante-Nicene and both series of the Nicene and Post-Nicene Fathers, edited by Philip Schaff.</p>']
    for disp, series in groups:
        out.append("<h3>%s</h3>" % ent(disp))
        out.append('<ul class="library">')
        for vid, s, vol, title, _c in VOLUMES:
            if s != series:
                continue
            out.append(item("Vol. %s. %s" % (ROMAN[vol], title), vid + ".html", pdf_name(series, vol)))
        if series == NPNF2:
            out.append(item("Vol. XIV. The Seven Ecumenical Councils", "councils.html", "Seven_Ecumenical_Councils.pdf"))
        out.append("</ul>")
    return "\n".join(out)


parts = [
    '<p>The whole shelf in one place: every text we host, to read online or download. '
    'The Scriptures and the Fathers, the councils and the schoolmen, the roads of the '
    'schism in their own voices, the rule of prayer, and our own papers.</p>',
    section("scripture", "Holy Scripture", "The Bible in two editions, and the Fathers read straight down the Gospel in Aquinas&rsquo; Golden Chain.", [item(*x) for x in SCRIPTURE]),
    section("summa", "The Summa Theologica of St. Thomas Aquinas", "The whole Summa, in its five parts, the Benziger 1947 English Dominican translation.", [item(*x) for x in SUMMA]),
    section("fathers", "The consensus of the Fathers", "The individual patristic works, gathered one by one.", [item(*x) for x in FATHERS]),
    schaff_section(),
    section("councils", "The councils, and the roads of the schism", "", [item(*x) for x in COUNCILS]),
    section("newman", "Newman on doctrine", "", [item(*x) for x in NEWMAN]),
    section("prayer", "The rule of prayer, and the devotional life", "", [item(*x) for x in PRAYER]),
    section("papers", "Our own papers", "", [item(*x) for x in OURS]),
]
print("\n\n".join(parts))
