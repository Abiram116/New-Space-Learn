from app.services import rag

SRC = [
    "Dropout randomly zeroes activations during training, which reduces overfitting in large networks.",
    "Residual connections add the block input to its output, easing optimisation of very deep networks.",
]


def test_backed_and_shaky_claims_are_told_apart():
    text = (
        "Dropout randomly zeroes activations during training to reduce overfitting [[1]]. "
        "Residual connections add the block input to the output so deep networks optimise easily [[2]]. "
        "Dropout was invented in 1850 by a French clockmaker named Henri [[1]]."
    )
    g = rag.grounding(text, SRC)
    assert g["checked"] == 3 and g["backed"] == 2
    assert len(g["shaky"]) == 1 and "clockmaker" in g["shaky"][0]


def test_uncited_text_and_fragments_are_not_claims():
    g = rag.grounding("Sure! Here you go.\n\nShort [[1]].\n\nThis has no citation at all but is long enough.", SRC)
    assert g["checked"] == 0
    assert rag.grounding("", SRC) == {"checked": 0, "backed": 0, "shaky": []}


def test_an_out_of_range_marker_checks_nothing():
    assert rag.grounding("Dropout randomly zeroes activations during training [[9]].", SRC)["checked"] == 0


def test_a_swapped_number_is_never_ticked():
    src = ["We trained the base models for 100,000 steps on 8 GPUs. Each step took about 0.4 seconds."]
    ok = rag.grounding("The base models were trained for 100,000 steps on 8 GPUs [[1]].", src)
    assert ok["backed"] == 1
    for bad in (
        "The base models were trained for 900,000 steps on 8 GPUs [[1]].",
        "Each step took about 4 seconds on 8 GPUs and 100,000 steps [[1]].",
    ):
        g = rag.grounding(bad, src)
        assert g["checked"] == 1 and g["backed"] == 0 and g["shaky"], bad


def test_only_cited_sources_are_kept_and_keep_their_numbers():
    from app.routers.subspace_chat import _used_sources

    retrieved = [{"marker": n, "document_name": f"f{n}.pdf"} for n in range(1, 7)]
    assert _used_sources(retrieved, {1, 3}) == [retrieved[0], retrieved[2]]
    # A refusal cites nothing, so it must not say "answered from 6 sources".
    assert _used_sources(retrieved, set()) == []


def test_tighten_drops_a_weak_extra_marker_and_moves_a_marker_to_the_source_that_holds_the_sentence():
    full = "Gradient descent was first suggested by Cauchy in 1847 and applied to astronomical orbits."
    unrelated = "Photosynthesis converts light energy into chemical energy inside the chloroplast."
    part = "The retina has rods and cones."
    # Two markers, one source holds the sentence and the other is about something else.
    text = "Gradient descent was first suggested by Cauchy in 1847 [[1]] [[2]]."
    out, n = rag.tighten_citations(text, [full, unrelated])
    assert out == "Gradient descent was first suggested by Cauchy in 1847 [[1]]." and n == 1
    # Cited source holds only part of the sentence; another holds all of it.
    partial = "Gradient descent was first suggested by Cauchy."
    text = "Gradient descent was first suggested by Cauchy in 1847 and applied to astronomical orbits [[1]]."
    out, n = rag.tighten_citations(text, [partial, full])
    assert out.endswith("orbits [[2]].") and n == 1
    # A tie is never moved: both sources hold every word.
    out, n = rag.tighten_citations("Dropout reduces overfitting [[1]].", ["Dropout reduces overfitting.", "Dropout reduces overfitting."])
    assert n == 0 and out == "Dropout reduces overfitting [[1]]."
    # Nothing to do on a correct citation, a refusal or an empty answer.
    assert rag.tighten_citations("Sorry, not in your files.", [full]) == ("Sorry, not in your files.", 0)
    assert rag.tighten_citations("", [full]) == ("", 0)
    assert part not in out


def test_a_paraphrase_citing_two_sources_keeps_both_markers():
    """Faithful but reworded: low overlap with every source, so neither is 'weak' next to a strong one."""
    a = "Dropout randomly zeroes a fraction of the activations during training, which reduces overfitting."
    b = "Early stopping halts training once the validation loss begins to climb."
    text = "Switching off random neurons while learning and halting when validation worsens both stop memorisation [[1]] [[2]]."
    assert rag.tighten_citations(text, [a, b]) == (text, 0)
