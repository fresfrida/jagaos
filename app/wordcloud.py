"""The word cloud on Search (2026-09-25, round 21, A8, DECISIONS #101): the most telling words across a company's documents.

Deliberately the simplest thing that works: read-only, no schema change, no index. The caller (main.search_terms) hands over the
extracted text of the documents THIS caller may see in THIS company's Company Files (never a personal file, never another
company's, never a pending colleague's upload); everything here is a pure function of those strings.

What "telling" means, in order:
  1. Words only: runs of letters (an apostrophe inside a word is kept), lowercased. Numbers, amounts, dates, "S$", invoice numbers and
     punctuation are not words. A run longer than 25 letters is not a word either (it is unspaced Chinese, or OCR noise), and a
     run shorter than four letters is not one unless it is on the short list of business abbreviations that matter (SHORT_KEPT):
     three-letter tokens are mostly OCR fragments ("ple", "toa" came out of a badly read photo).
  2. Not a stopword: the standard English function words, then the filler that fills every paperwork document whatever it says
     (company suffixes, "invoice", "receipt", "page", "total", the names of months and days, ...). Tuned against real documents, see
     the lists below.
  3. Counted by DOCUMENT, not by occurrence: a word's count is how many documents contain it, so one invoice that says "toner" forty
     times does not outweigh five that say "insurance" once each. Ties break on total occurrences, then alphabetically, so the
     output is stable.
  4. With enough documents to judge by (MIN_DOCUMENTS_FOR_SHARE), a word must be in at least MIN_DOCUMENTS_PER_WORD, two, of them (one document is not a
     theme, and one document is where OCR noise lives) and in no more than MAX_DOCUMENT_SHARE of them (a word on nearly every
     document is boilerplate for THIS company, its own name included). This is the part no fixed list can do. With fewer documents
     every word counts, or the cloud would be empty.

Tuned by running it over real documents and reading what came out: the repo's demo corpus of eight PDFs (a certificate of
incorporation, a constitution, two notices, three invoices, a lease) plus the demo company's own extracted text. What rose to the top
was mostly meaning (company and supplier names, "incorporation", "shares", "letterhead", "stationery", "lease"); what was boilerplate
("given under my hand", "day", "road", "terms", "inv" from invoice numbers) went into the filler list below.

Limits, on purpose: English only (a Chinese, Malay or Tamil document contributes only its Latin-letter words); no stemming, so
"invoice" and "invoices" are two words; no phrases.
"""

import re
from collections import Counter
from collections.abc import Iterable

TOP_TERMS = 40
# The newest documents a request reads. A company past this has more paperwork than one cloud can say anything new about, and
# the cost of a request stays bounded whatever the size of the archive.
MAX_DOCUMENTS_SCANNED = 500
MIN_LETTERS = 4
MAX_LETTERS = 25
# Three-letter words worth keeping in Singapore business paperwork; every other three-letter token is dropped as a likely OCR fragment.
SHORT_KEPT = frozenset({"act", "cpf", "vat"})
# Only judge a word "in nearly every document" once there are enough documents for that to mean something.
MIN_DOCUMENTS_FOR_SHARE = 10
MAX_DOCUMENT_SHARE = 0.6
# Once there are enough documents to judge by, a word must be in at least this many of them to qualify (one document is not a theme, and
# one document is where OCR noise lives). Named here, beside its sibling thresholds, rather than a bare 2 in the filter (DECISIONS #109).
MIN_DOCUMENTS_PER_WORD = 2

_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)

# Standard English function words (the usual short list; "not", "no" and the like are here on purpose).
_ENGLISH = """
a about above after again against all also am an and any are aren't as at be because been before being below between both but by
can can't cannot could couldn't did didn't do does doesn't doing don't down during each else few for from further had hadn't has
hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into
is isn't it it's its itself just let's me more most mustn't my myself no nor not now of off on once only or other ought our ours
ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them
themselves then there there's these they they'd they'll they're they've this those through to too under until up upon very was
wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with
won't would wouldn't you you'd you'll you're you've your yours yourself yourselves via per etc
"""

# The filler of Singapore business paperwork, whatever a document is about: company suffixes ("pte", "ltd"), the words on every
# invoice and receipt ("invoice", "receipt", "total", "gst", "sgd", the S$ symbol is not a word so it never gets this far), "page",
# "document", the months and days, address words. The lines from "inv" down were added after running the cloud over real documents
# and removing what was boilerplate rather than meaning (see the docstring).
_DOMAIN_FILLER = """
pte ltd limited private company co inc llp bhd sdn
invoice invoices receipt receipts document documents page pages sgd usd
total subtotal amount amounts balance due paid payment date dated number no ref reference
tax gst uen reg registration singapore
qty quantity unit units price description item items
inv doc po
given hand day days name names effect terms conditions note notes remarks details
road street avenue boulevard lane drive blk block level floor tower building postal code
tel fax email mail www http https com sg net org
attn dear sincerely regards thank thanks please kindly yours
authorised authorized signature signed copy original
issued issue bill billed billing statement account
january february march april may june july august september october november december
jan feb mar apr jun jul aug sep sept oct nov dec
monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun
am pm dd mm yyyy yy
"""

STOPWORDS: frozenset[str] = frozenset((_ENGLISH + _DOMAIN_FILLER).split())


def words_in(text: str) -> list[str]:
    """The candidate words of one document, in order, with repeats: lowercased letter runs of 4 to 25 letters (or one of the few
    short business abbreviations) that are not stopwords and are not one letter repeated ("aaaa" is OCR noise)."""
    found = []
    for raw in _WORD.findall(text or ""):
        word = raw.lower().replace("’", "'")
        if word.endswith("'s"):
            word = word[:-2]  # "company's" is "company"
        too_short = len(word) < MIN_LETTERS and word not in SHORT_KEPT
        if too_short or len(word) > MAX_LETTERS or word in STOPWORDS or len(set(word)) < 2:
            continue
        found.append(word)
    return found


def top_terms(texts: Iterable[str], limit: int = TOP_TERMS) -> list[dict]:
    """The `limit` most telling words across `texts` (one string per document), each {"term", "count"} where count is the number of
    documents that contain it. See the module docstring for what is dropped and how ties are broken."""
    documents = 0
    in_documents: Counter[str] = Counter()
    occurrences: Counter[str] = Counter()
    for text in texts:
        documents += 1
        words = words_in(text)
        occurrences.update(words)
        in_documents.update(set(words))
    if documents == 0:
        return []
    judged = documents >= MIN_DOCUMENTS_FOR_SHARE
    ceiling = documents * MAX_DOCUMENT_SHARE
    kept = [w for w, n in in_documents.items() if not judged or MIN_DOCUMENTS_PER_WORD <= n <= ceiling]
    kept.sort(key=lambda w: (-in_documents[w], -occurrences[w], w))
    return [{"term": w, "count": in_documents[w]} for w in kept[:limit]]
