"""Grounding: text a model WRITES about a document may only name things the
document itself names (2026-09-24, round 15, DECISIONS #89).

The bug this exists for: an ACRA-style business profile whose printed text is
headed "BUSINESS PROFILE SUMMARY" — the word "ACRA" appears nowhere on the page
— was described as "ACRA Business Profile for Sunbird Catering Services". The
model supplied an issuing authority from what such documents usually look like.
Nothing checked its output against the text it had just read.

Deterministic — no LLM. Pure functions over strings, so every rule here is unit
tested and nothing can reach a model or the database.

Deliberately NARROW. A check that is too clever rejects correct summaries of
correct documents, which is worse than the bug. So it only ever asks one
question — "does this proper-noun-looking token appear on the page?" — and
gives the model every benefit of the doubt it can cheaply give:
  - only tokens that look like NAMES are checked: acronyms, and capitalised
    words in the middle of a sentence (or starting a multi-word name);
  - ordinary document vocabulary ("Invoice", "Certificate", "Notice"), months,
    currency and tax codes, legal suffixes ("Pte", "Ltd") are never names;
  - a token with a digit is never checked (amounts have their own check,
    verify.py::_check_amounts_in_text);
  - an acronym is grounded if the page SPELLS IT OUT ("Accounting and Corporate
    Regulatory Authority" grounds "ACRA");
  - a name that differs from a word on the page by a typo or two is grounded (the
    model reads OCR text and quietly corrects it);
  - a description written in Title Case is checked for acronyms only, because
    there every word looks like a name;
  - a checked word may be one the page prints in any case.
Anything it lets through is not proof the text is right; it only refuses to let
an entity nobody printed be presented as a fact.
"""

import re
from dataclasses import dataclass

# Words that are the system's own vocabulary or ordinary capitalised nouns, never
# a name. Lower case. This is what keeps "Invoice from Acme" from being a
# problem just because the page said "Invois" or "Tax Invoice".
GENERIC_WORDS: frozenset[str] = frozenset(
    """
    invoice invoices receipt receipts purchase order orders quotation quote quotes delivery contract contracts
    agreement agreements lease leases tenancy licence license policy insurance statement statements report reports
    letter letters notice notices certificate certificates certification form forms return returns register registers
    minutes resolution resolutions constitution memo memorandum proposal photo photos photograph picture image
    document documents file files note notes summary profile business company companies corporation incorporation
    registered registration office address annual financial tax gst vat ppn sst statutory filing filings change
    changes appointment appointments director directors secretary secretaries shareholder shareholders member
    members capital share shares dividend audit audited accounts account payment payments bill bills billing
    estimate expense expenses receivables operations miscellaneous memory lane bucket lane unknown other
    services service supplies supply trading enterprise enterprises holdings group management consulting
    engineering technology technologies solutions systems industries international global
    january february march april may june july august september october november december
    jan feb mar apr jun jul aug sep sept oct nov dec
    monday tuesday wednesday thursday friday saturday sunday
    pte ltd limited private inc llc llp co corp bhd sdn pt plc gmbh sa ag lp
    sgd usd idr myr eur gbp cny rmb aud jpy thb hkd inr php vnd krw nzd cad chf
    sme smes pdf id no ref
    the of and for from to in on at by with a an as or this that its their our
    singapore
    """.split()
)

# Words that are followed by a full stop without ending a sentence.
_ABBREVIATIONS = frozenset("pte ltd co inc corp no st mr mrs ms dr bhd sdn pt vs etc".split())

# Words skipped when forming the initials of a spelled-out name.
_INITIALISM_SKIPS = frozenset("and of the for de at in on".split())

# A Latin-script word. Only these are ever compared: text in Chinese, Tamil or
# Malay-with-Jawi is checked for the Latin names inside it and nothing else, and
# a name printed next to Chinese characters is not fused with them. An internal
# dot is kept ("A.C.R.A", "Pte.Ltd") so an initialism stays one word.
_LATIN = re.compile(r"[A-Za-z](?:[A-Za-z0-9\u2019']|\.(?=[A-Za-z]))*")
_SENTENCE_END = re.compile(r"[.!?:\u3002\uff01\uff1f]")


def _norm(word: str) -> str:
    """A comparison form: lower case, no dots or apostrophes ("A.C.R.A." and
    "Sunbird's" both reduce to what the page would print)."""
    return re.sub(r"[.'\u2019`]", "", word.lower())


def _latin_words(text: str) -> list[str]:
    return [m.group() for m in _LATIN.finditer(text)]


@dataclass(frozen=True)
class Source:
    """The page text, prepared once for repeated lookups."""

    words: tuple[str, ...]
    vocabulary: frozenset[str]

    @classmethod
    def of(cls, text: str) -> "Source":
        words = tuple(_norm(w) for w in _latin_words(text))
        return cls(words=words, vocabulary=frozenset(words))


def _spelled_out(acronym: str, source: Source) -> bool:
    """True if the page contains words whose initials spell `acronym`
    (skipping "and", "of", "the"...): "Accounting and Corporate Regulatory
    Authority" spells ACRA, "Inland Revenue Authority of Singapore" spells IRAS."""
    target = _norm(acronym)
    n = len(target)
    if n < 2:
        return False
    words = source.words
    for start in range(len(words)):
        initials = ""
        for word in words[start:start + n + 4]:
            if word in _INITIALISM_SKIPS:
                continue
            initials += word[0]
            if len(initials) == n:
                break
        if initials == target and words[start] not in _INITIALISM_SKIPS:
            return True
    return False


def _within_edits(a: str, b: str, limit: int) -> bool:
    """Levenshtein distance of `a` and `b` is at most `limit` (insert, delete or
    substitute one letter each)."""
    if abs(len(a) - len(b)) > limit:
        return False
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        if min(current) > limit:
            return False
        previous = current
    return previous[-1] <= limit


def _near_a_source_word(word: str, source: Source) -> bool:
    """One letter off (two for a long word) from a word on the page — an OCR
    slip the model quietly corrected. Only for words of five or more letters: a
    short word one letter off is a different word."""
    if len(word) < 5:
        return False
    limit = 1 if len(word) < 9 else 2
    return any(_within_edits(word, candidate, limit) for candidate in source.vocabulary)


def is_grounded(token: str, source: Source) -> bool:
    """Does this name-like word appear on the page (in any case), as a typo of a
    word that does, or — for an acronym — spelled out there?"""
    word = _norm(token)
    if not word or word in source.vocabulary:
        return True
    for variant in (word.removesuffix("s"), word + "s", word.removesuffix("es")):
        if variant in source.vocabulary:
            return True
    if _is_acronym(token) and _spelled_out(token, source):
        return True
    return _near_a_source_word(word, source)


def _is_acronym(token: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", token)
    return len(letters) >= 2 and letters.isupper() and not any(ch.isdigit() for ch in token)


def _checkable(token: str) -> bool:
    """A word that could be a name: starts with a capital, has no digit, is not
    ordinary vocabulary."""
    if len(token) < 2 or not token[0].isupper() or any(ch.isdigit() for ch in token):
        return False
    return _norm(token) not in GENERIC_WORDS


# Small words that are lower case in a sentence and capitalised in Title Case.
_FUNCTION_WORDS = frozenset("for from with and of the to in on at by as or".split())


def _title_cased(words: list[str]) -> bool:
    """Title Case: a small word ("For", "From", "With") capitalised in the middle
    of the text. There a capital says nothing about being a name, so only
    acronyms are checked. Deliberately NOT a ratio of capitalised words — a
    sentence made mostly of names ("Business Profile for Sunbird Catering
    Services Pte. Ltd.") is mostly capitals and is not Title Case."""
    return any(w[0].isupper() and w.lower() in _FUNCTION_WORDS for w in words[1:])


def ungrounded_names(text: str, source: Source) -> list[str]:
    """The name-like words of a GENERATED SENTENCE that the page does not
    support, in order, without duplicates.

    Which words count: any acronym; any capitalised word after the first of its
    sentence; and the first word of a sentence only when it begins a multi-word
    name (the next word is capitalised too) — "Invoice from Acme" starts with an
    ordinary word, "Sunbird Catering Services business profile" starts with a name."""
    matches = list(_LATIN.finditer(text))
    if not matches:
        return []
    title_case = _title_cased([m.group() for m in matches])
    found: list[str] = []
    for k, m in enumerate(matches):
        word = m.group()
        if k == 0:
            sentence_start = True
        else:
            previous = matches[k - 1]
            gap = text[previous.end():m.start()]
            sentence_start = bool(_SENTENCE_END.search(gap)) and _norm(previous.group()) not in _ABBREVIATIONS
        checked = False
        if _is_acronym(word) and _checkable(word):
            checked = True
        elif not title_case and _checkable(word):
            if not sentence_start:
                checked = True
            elif k + 1 < len(matches):
                nxt = matches[k + 1]
                adjacent = text[m.end():nxt.start()].strip() == ""
                checked = adjacent and nxt.group()[0].isupper() and _norm(nxt.group()) not in GENERIC_WORDS
        if checked and not is_grounded(word, source) and word not in found:
            found.append(word)
    return found


def ungrounded_acronyms(text: str, source: Source) -> list[str]:
    """Only the acronyms of a short label (a statutory doc_type such as
    "ACRA Business Profile") the page does not support. Labels are made of
    ordinary filing vocabulary the generic list cannot fully cover, so only the
    one thing that reliably means a NAMED authority is checked."""
    return [w for w in _latin_words(text) if _is_acronym(w) and _checkable(w) and not is_grounded(w, source)]


def name_is_grounded(name: str, source: Source) -> bool:
    """Whether a vendor or issuer name is supported by the page: at least half of
    its significant words appear there (so "Acme Engineering Technology Pte Ltd"
    survives a page that prints "Acme Engineering"), and at least one does. A
    name with NO word on the page is an invented one."""
    significant = [
        w for w in _latin_words(name)
        if len(w) >= 2 and _norm(w) not in GENERIC_WORDS and not any(ch.isdigit() for ch in w)
    ]
    if not significant:
        return True
    grounded = sum(1 for w in significant if is_grounded(w, source))
    return grounded >= 1 and grounded * 2 >= len(significant)


def drop_ungrounded_acronyms(label: str, source: Source) -> str:
    """The label without the acronyms the page does not support ("ACRA Business
    Profile" -> "Business Profile" when the page never says ACRA). Never returns
    an empty string."""
    bad = {_norm(w) for w in ungrounded_acronyms(label, source)}
    if not bad:
        return label
    kept = [t for t in label.split() if not (set(_norm(w) for w in _latin_words(t)) & bad)]
    return " ".join(kept) or label


# The plain English name of each fixed doc_type value (app/graph/classify.py's
# vocabulary) for a fallback description.
DOC_TYPE_LABELS = {
    "invoice": "Invoice", "receipt": "Receipt", "po": "Purchase order", "quotation": "Quotation",
    "delivery_order": "Delivery order", "contract": "Contract", "photo": "Photo", "other": "Document",
}


def grounded_fallback_description(doc_type: str | None, vendor_name: str | None) -> str:
    """A description built only from things that are safe by construction: the
    document's own type label and, if one survived grounding, its vendor. Used
    when the model's sentence named something the page does not — a dull
    description is better than a confident invented one, and the reviewer can
    edit it."""
    kind = DOC_TYPE_LABELS.get((doc_type or "").lower(), (doc_type or "").strip()) or "Document"
    return f"{kind} from {vendor_name}" if vendor_name else kind


# What is left of a company name once its legal suffix is taken off, so "Bright
# Harbour Pte. Ltd." and "Bright Harbour Private Limited" are one company.
_LEGAL_SUFFIXES = frozenset("pte ltd limited private inc llc llp co corp bhd sdn pt plc".split())


def _entity_key(name: str) -> str:
    return " ".join(w for w in (_norm(x) for x in _latin_words(name)) if w not in _LEGAL_SUFFIXES)


def ground_classification(
    result: dict, source_text: str, *, company_name: str | None, subject_only: bool,
) -> tuple[dict, list[str]]:
    """Apply every grounding rule to one classify result and say what changed.

    `result` is classify's dict (lane, doc_type, description, description_en,
    vendor_name, ...). Returns a corrected COPY and a list of plain-English notes
    (empty when nothing was wrong) for the trace. Nothing here calls a model; a
    corrected field is either dropped, trimmed, or replaced by a description built
    only from safe parts.

    - doc_type (statutory lane, where it is free text): acronyms the page does
      not support are removed ("ACRA Business Profile" -> "Business Profile").
    - vendor_name: blank when the document is the kind that has no vendor
      (`subject_only`: a business profile, which is ABOUT a company); blank when
      it is this company itself on a non-invoice document (a company is never its
      own counterparty); blank when no word of it is on the page. The company a
      document is about is not its vendor, and "the only company name we saw" is
      not evidence.
    - description / description_en: if either names something the page does not,
      both become a grounded fallback (grounded_fallback_description)."""
    out = dict(result)
    notes: list[str] = []
    source = Source.of(source_text)
    lane = out.get("lane")

    doc_type = out.get("doc_type")
    if lane == "statutory" and doc_type:
        cleaned = drop_ungrounded_acronyms(doc_type, source)
        if cleaned != doc_type:
            notes.append(f"doc_type: '{doc_type}' -> '{cleaned}' (the page never names {', '.join(ungrounded_acronyms(doc_type, source))})")
            out["doc_type"] = cleaned

    vendor = out.get("vendor_name")
    if vendor:
        reason = None
        if subject_only:
            reason = "this kind of document is about a company, it has no vendor"
        elif lane != "invoice" and company_name and _entity_key(vendor) == _entity_key(company_name):
            reason = "that is this company itself, not a counterparty"
        elif not name_is_grounded(vendor, source):
            reason = "no word of it appears on the page"
        if reason:
            notes.append(f"vendor_name: removed '{vendor}' ({reason})")
            out["vendor_name"] = None

    english, localised = out.get("description_en"), out.get("description")
    invented_en = ungrounded_names(english, source) if english else []
    invented_local = ungrounded_names(localised, source) if localised else []
    if invented_en:
        # The English sentence is the one every other language and the search
        # index fall back to, so it is repaired first: a leading invented name is
        # trimmed off if what is left is still a sentence and now passes; otherwise
        # the whole thing is replaced by the plain fallback.
        repaired = _trim_leading_names(english, invented_en, source)
        kept = repaired or grounded_fallback_description(out.get("doc_type"), out.get("vendor_name"))
        out["description_en"] = kept
        out["description"] = kept
        how = "trimmed to" if repaired else "replaced with"
        notes.append(f"description: {how} '{kept}' (it named {', '.join(invented_en)}, which the page does not)")
    elif invented_local:
        # Only the translation invented something; drop it and show the English.
        out["description"] = english
        notes.append(f"description: translation dropped (it named {', '.join(invented_local)}, which the page does not)")

    return out, notes


def _trim_leading_names(text: str, invented: list[str], source: Source) -> str | None:
    """`text` without the invented name(s) IF they are all a leading prefix and
    what remains is still a sentence that passes the check ("ACRA Business
    Profile for Sunbird Catering Services" -> "Business Profile for Sunbird
    Catering Services"). None when they are anywhere else: cutting a name out of
    the middle of a sentence leaves a dangling "from" or "for", and a plain
    fallback reads better than broken grammar."""
    wanted = {_norm(w) for w in invented}
    matches = list(_LATIN.finditer(text))
    cut = 0
    removed: set[str] = set()
    for m in matches:
        if _norm(m.group()) in wanted and text[cut:m.start()].strip() == "":
            removed.add(_norm(m.group()))
            cut = m.end()
        else:
            break
    if removed != wanted:
        return None
    rest = text[cut:].lstrip(" ,;:-")
    if len(_latin_words(rest)) < 2 or ungrounded_names(rest, source):
        return None
    return rest[0].upper() + rest[1:]
