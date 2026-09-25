"""The obligations node is switched off at the graph wiring (DECISIONS #108): nothing is computed from a company's FYE, but
the node and the statutory rules are intact and turning it back on is one switch. No gateway calls; nothing here runs a document."""

from datetime import date

from app.graph.pipeline import DERIVE_OBLIGATIONS_ENABLED, PIPELINE, build_graph
from app.rules.statutory import derive_obligations as statutory_rules


def _shape(compiled):
    graph = compiled.get_graph()
    return set(graph.nodes), {(e.source, e.target) for e in graph.edges}


def test_the_obligations_switch_is_off_by_default():
    assert DERIVE_OBLIGATIONS_ENABLED is False


def test_the_live_pipeline_has_no_obligations_node_and_expectations_go_straight_to_archive():
    nodes, edges = _shape(PIPELINE)
    assert "derive_obligations" not in nodes
    assert ("derive_expectations", "archive") in edges
    assert not any("derive_obligations" in edge for edge in edges)


def test_everything_else_in_the_pipeline_is_unchanged():
    nodes, edges = _shape(PIPELINE)
    assert {"classify", "extract", "verify", "human_review", "derive_events", "derive_expectations", "archive"} <= nodes
    assert {("classify", "extract"), ("extract", "verify"), ("derive_events", "derive_expectations"), ("archive", "__end__")} <= edges


def test_switching_it_on_puts_the_node_back_between_expectations_and_archive():
    nodes, edges = _shape(build_graph(derive_obligations_enabled=True))
    assert "derive_obligations" in nodes
    assert ("derive_expectations", "derive_obligations") in edges
    assert ("derive_obligations", "archive") in edges
    assert ("derive_expectations", "archive") not in edges  # one path, not two


def test_the_statutory_rules_are_untouched_and_still_compute_the_clock():
    rows = statutory_rules(company_id=1, fye=date(2025, 12, 31), event_id=None)
    assert {r["rule_id"] for r in rows} == {"acra_s197_annual_return", "ira_form_c_s_c"}
    assert next(r for r in rows if r["kind"] == "annual_return")["due_on"] == "2026-07-31"  # FYE + 7 months, as before
