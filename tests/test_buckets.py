"""The fixed bucket taxonomy has two hand-kept copies — the backend's
BucketName type (app/models.py, which also feeds the classify prompt) and
the frontend's BUCKETS list (web/src/features/ops/opsApi.ts). This is the
guard that they cannot drift apart silently; "Contracts" (2026-09-24,
round 11) is the case that made it worth writing.
"""

import re
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from app.graph.classify import render_system_prompt
from app.models import BucketName, ClassifyResult, DocumentEditRequest

OPS_API = Path(__file__).parent.parent / "web" / "src" / "features" / "ops" / "opsApi.ts"


def _frontend_buckets() -> list[str]:
    source = OPS_API.read_text()
    block = re.search(r"export const BUCKETS = \[(.*?)\] as const", source, re.S)
    assert block, "could not find BUCKETS in opsApi.ts — did its declaration change shape?"
    return re.findall(r"'([^']+)'", block.group(1))


def test_frontend_and_backend_bucket_lists_are_identical_and_in_the_same_order():
    assert _frontend_buckets() == list(get_args(BucketName))


def test_contracts_is_accepted_wherever_the_backend_validates_a_bucket():
    result = ClassifyResult(
        lane="important", doc_type="contract", confidence=0.9,
        description="Office lease", description_en="Office lease", bucket="Contracts",
    )
    assert result.bucket == "Contracts"
    assert DocumentEditRequest(bucket="Contracts").bucket == "Contracts"
    with pytest.raises(ValidationError):
        DocumentEditRequest(bucket="Not A Bucket")


def test_classify_prompt_offers_every_bucket_and_routes_contracts_to_it():
    prompt = render_system_prompt("English")

    for name in get_args(BucketName):
        assert name in prompt, f"{name} is a valid bucket but the model is never told about it"
    assert "Contracts if it is a contract, lease, or agreement" in prompt
    # A bucket name with a space keeps the quoting the prompt always used.
    assert '"Memory Lane"' in prompt
