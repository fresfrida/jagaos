"""The word cloud on Search (2026-09-25, round 21, A8, DECISIONS #101).

Two layers. `app.wordcloud` is a pure function of strings: what counts as a word, what is filler, how a word is counted, and what
"nearly every document" means. `GET /api/search/terms` decides WHICH strings it is given, and that is the security boundary:
this company's documents only, company documents only (a personal file's text never enters), only what the caller may see.

The endpoint tests write document rows directly, because a noise JPEG has no text and a real upload would call the gateway.
"""

import itertools

import pytest
from fastapi.testclient import TestClient

from app import wordcloud
from app.db import get_conn
from app.main import app
from app.wordcloud import MAX_LETTERS, TOP_TERMS, top_terms, words_in

client = TestClient(app)


def terms(*texts: str, limit: int = TOP_TERMS) -> dict[str, int]:
    return {t["term"]: t["count"] for t in top_terms(texts, limit)}


# --- what is a word ------------------------------------------------------------------------------------


def test_words_are_lowercased_letter_runs_of_four_or_more():
    assert words_in("Toner CARTRIDGE, ink; ok to go") == ["toner", "cartridge"]      # "ink", "ok", "to", "go" are too short


def test_a_three_letter_token_is_dropped_as_an_ocr_fragment_unless_it_is_a_business_abbreviation_worth_keeping():
    assert words_in("ple toa lay meng") == ["meng"]
    assert words_in("Companies Act, CPF and VAT rates") == ["companies", "act", "cpf", "vat", "rates"]


def test_numbers_amounts_dates_and_symbols_are_not_words():
    text = "Invoice INV-2026-0042 S$1,234.50 dated 25/09/2026 (2026-09-25) at 14:30 GST 9% tel +65 6123 4567 #04-01"
    assert words_in(text) == []                # "invoice", "inv", "dated", "gst", "tel" are filler; the rest has no letters


def test_the_names_of_months_and_days_and_their_abbreviations_are_date_format_tokens_not_words():
    assert words_in("Monday 25 September 2026, Tue 26 Sept, Fri Dec Jan") == []


def test_the_apps_domain_filler_is_dropped_and_real_content_kept():
    text = "Straits Print Supplies Pte Ltd Invoice Receipt Page 1 of 2 Document Total Amount Due"
    assert words_in(text) == ["straits", "print", "supplies"]


def test_the_manual_exclusion_list_drops_name_fragments_and_brand_noise_the_algorithm_cannot_catch():
    # Round 4, item 9 (DECISIONS #122): real 4+ letter lowercase runs, not stopwords, that OCR reads
    # consistently off real documents (a signer's name repeated across invoices, a payment-app brand
    # fragment) — nothing else in the pipeline drops these, so they need a manual list.
    text = "Care Boon Deen Keng Paylah transferred insurance"
    assert words_in(text) == ["transferred", "insurance"]


def test_standard_english_function_words_are_dropped():
    assert words_in("the quick brown foxes and the lazy hound are not here") == ["quick", "brown", "foxes", "lazy", "hound"]


def test_one_letter_repeated_is_noise_and_a_very_long_run_is_not_a_word():
    assert words_in("aaaa ooo hello") == ["hello"]
    assert words_in("x" * (MAX_LETTERS + 1) + " " + "abcdefghij" * 3) == []              # over 25 letters, either way
    assert words_in("公司文件" * 10) == []                                                   # unspaced Chinese is one long run: it says nothing here


def test_an_apostrophe_inside_a_word_is_kept_and_a_possessive_s_is_not():
    assert words_in("the tenant's lease, o'brien and don't") == ["tenant", "lease", "o'brien"]


# --- how a word is counted -----------------------------------------------------------------------------


def test_a_word_is_counted_by_documents_not_by_occurrences():
    counts = terms("toner " * 40, "insurance premium", "insurance renewal", "insurance claim", "insurance policy")
    assert counts["insurance"] == 4 and counts["toner"] == 1
    assert list(counts)[0] == "insurance"                                                   # ranks above the word said forty times once


def test_ties_break_on_total_occurrences_then_alphabetically_so_the_order_is_stable():
    result = top_terms(["zebra zebra apple", "zebra apple mango", "apple banana"])
    assert [t["term"] for t in result][:2] == ["apple", "zebra"]                            # apple 3 docs; zebra 2 docs
    tie = top_terms(["cherry", "banana"])
    assert [t["term"] for t in tie] == ["banana", "cherry"]                                 # equal on everything: alphabetical


def _distinct_words(count: int) -> list[str]:
    """`count` different four-letter words made of letters only (so each is one word), none of them a stopword."""
    return ["".join(chr(98 + (n // 26**k) % 24) for k in range(4)) for n in range(count)]


def test_only_the_top_terms_are_returned_and_no_documents_means_no_terms():
    text = " ".join(_distinct_words(300))
    assert len(top_terms([text])) == TOP_TERMS and len(top_terms([text], limit=5)) == 5
    assert top_terms([]) == [] and top_terms(["", "   ", "1234 5678"]) == []


def test_with_few_documents_every_word_counts_including_one_seen_once():
    assert terms("garage lease", "office lease") == {"lease": 2, "garage": 1, "office": 1}


def test_with_enough_documents_a_word_in_only_one_is_not_a_theme():
    n = wordcloud.MIN_DOCUMENTS_FOR_SHARE
    texts = ["insurance"] * 5 + ["filler"] * (n - 5)          # 'insurance' in 5 of 10 documents, 'filler' in the other 5
    texts[0] += " lonely"                                       # 'lonely' in one document only
    counts = terms(*texts)
    assert counts == {"insurance": 5, "filler": 5}              # 'lonely' is dropped, the two real themes stay
    assert terms("garage lease", "office lease")["garage"] == 1  # with few documents a word seen once still counts


def test_a_word_on_nearly_every_document_is_boilerplate_for_that_company_once_there_are_enough_documents_to_tell():
    n = wordcloud.MIN_DOCUMENTS_FOR_SHARE
    texts = [f"acmecorp harbour{'x' * (i % 2)}" for i in range(n)] + ["harbour supplies", "harbour supplies"]
    counts = terms(*texts)
    assert "acmecorp" not in counts                                    # in 10 of 12 documents (83%): above the ceiling
    assert counts.get("supplies") == 2                                 # in 2 of 12: kept
    few = terms("acmecorp lease", "acmecorp office", "acmecorp garage")
    assert few["acmecorp"] == 3                                        # the same share, but too few documents to judge by: kept


def test_the_ceiling_is_a_share_of_the_documents_not_a_fixed_count():
    # 'shared' is in all 31 documents; 'middling' is in 11 of the 31 (35%): the first is boilerplate, the second is a theme
    texts = ["shared"] * 20 + ["shared middling"] * 11
    counts = terms(*texts)
    assert "shared" not in counts and counts == {"middling": 11}


# --- the endpoint: whose words --------------------------------------------------------------------------

_sha = itertools.count(1)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team() -> dict:
    owner = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@cloud.test", "company_name": "Cloud Co", "fye_month": 12, "fye_day": 31},
    ).json()
    tokens, ids = {"owner": owner["token"]}, {"owner": owner["user"]["id"]}
    for name, role in [("admin", "admin"), ("user1", "user"), ("user2", "user"), ("viewer", "viewer")]:
        email = f"{name}@cloud.test"
        assert client.post(
            f"/api/companies/{owner['company']['id']}/members",
            json={"email": email, "role": role}, headers=_headers(owner["token"]),
        ).status_code == 200
        login = client.post("/api/auth/dev-login", json={"email": email}).json()
        tokens[name], ids[name] = login["token"], login["user"]["id"]
    other = client.post(
        "/api/auth/dev-login",
        json={"email": "owner@cloud-other.test", "company_name": "Other Cloud Co", "fye_month": 6, "fye_day": 30},
    ).json()
    return {"tokens": tokens, "ids": ids, "company_id": owner["company"]["id"],
            "other_token": other["token"], "other_company_id": other["company"]["id"]}


def _doc(company_id: int, text: str, *, uploader: int | None = None, status: str = "filed", visibility: str = "company",
         doc_type: str | None = "invoice") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document (company_id, sha256, filename, media_type, bytes, stored_path, source_channel, "
            "uploaded_by_user_id, status, extracted_text, visibility, doc_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (company_id, f"cloud-{next(_sha)}-{company_id}", "x.pdf", "application/pdf", 1, "/nowhere", "web",
             uploader, status, text, visibility, doc_type),
        )
        return cur.lastrowid


def _cloud(token: str | None) -> list[dict]:
    resp = client.get("/api/search/terms", headers=_headers(token) if token else {})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _words(token: str) -> dict[str, int]:
    return {t["term"]: t["count"] for t in _cloud(token)}


def test_the_cloud_needs_a_session():
    assert client.get("/api/search/terms").status_code == 401


def test_every_role_including_a_viewer_gets_the_companys_words_with_document_counts(team):
    _doc(team["company_id"], "zorbulon warranty", uploader=team["ids"]["user1"])
    _doc(team["company_id"], "zorbulon lease", uploader=team["ids"]["user1"])
    for actor in ("owner", "admin", "user1", "user2", "viewer"):
        words = _words(team["tokens"][actor])
        assert words["zorbulon"] == 2 and words["warranty"] == 1, actor


def test_another_companys_words_never_appear_and_yours_never_appear_there(team):
    _doc(team["company_id"], "quixotic ledger", uploader=team["ids"]["owner"])
    _doc(team["other_company_id"], "flibbertigibbet ledger", uploader=None)

    mine, theirs = _words(team["tokens"]["owner"]), _words(team["other_token"])

    assert "quixotic" in mine and "flibbertigibbet" not in mine
    assert "flibbertigibbet" in theirs and "quixotic" not in theirs
    assert mine["ledger"] == 1 and theirs["ledger"] == 1               # each company counts only its own documents


@pytest.mark.parametrize("actor", ["owner", "admin", "user1", "user2", "viewer"])
def test_a_personal_files_words_never_enter_the_cloud_for_anyone_its_uploader_included(team, actor):
    _doc(team["company_id"], "sekrit diary entry", uploader=team["ids"]["user1"], visibility="only_me")
    _doc(team["company_id"], "sekrit passport number", uploader=team["ids"]["owner"], visibility="only_me")
    assert "sekrit" not in _words(team["tokens"][actor])


def test_a_colleagues_upload_waiting_for_review_stays_out_of_the_cloud_for_those_who_cannot_open_it(team):
    _doc(team["company_id"], "pendingword contract", uploader=team["ids"]["user1"], status="needs_review")

    assert "pendingword" in _words(team["tokens"]["user1"])            # their own upload
    assert "pendingword" in _words(team["tokens"]["admin"])            # the people who resolve reviews
    assert "pendingword" in _words(team["tokens"]["owner"])
    assert "pendingword" not in _words(team["tokens"]["user2"])        # another user
    assert "pendingword" not in _words(team["tokens"]["viewer"])


@pytest.mark.parametrize("status", ["archived", "quarantined", "rejected"])
def test_documents_that_are_deleted_quarantined_or_rejected_are_not_read(team, status):
    _doc(team["company_id"], "ghostword", uploader=team["ids"]["user1"], status=status)
    assert "ghostword" not in _words(team["tokens"]["owner"])


def test_the_business_profile_is_a_settings_artifact_and_is_not_read(team):
    _doc(team["company_id"], "profileword", uploader=team["ids"]["owner"], doc_type="business_profile")
    assert "profileword" not in _words(team["tokens"]["owner"])


def test_a_document_with_no_text_contributes_nothing_and_an_empty_company_gets_an_empty_list(team):
    _doc(team["company_id"], "", uploader=team["ids"]["user1"])
    with get_conn() as conn:
        conn.execute("UPDATE document SET extracted_text = NULL WHERE company_id = ?", (team["company_id"],))
    assert _cloud(team["tokens"]["owner"]) == []


def test_only_the_newest_documents_are_read(team, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "MAX_DOCUMENTS_SCANNED", 2)
    for n, word in enumerate(["oldestword", "middleword", "newestword"]):
        _doc(team["company_id"], word, uploader=team["ids"]["owner"])
    words = _words(team["tokens"]["owner"])
    assert "newestword" in words and "middleword" in words and "oldestword" not in words
