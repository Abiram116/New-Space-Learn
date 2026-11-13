from app.services.llm import loads_lenient


def test_latex_with_single_backslashes_still_parses():
    assert loads_lenient(r'{"q": "\(\int x\,dx\)"}')["q"] == r"\(\int x\,dx\)"


def test_doubled_backslashes_and_real_escapes_are_untouched():
    assert loads_lenient(r'{"q": "\\(x\\)\n"}')["q"] == "\\(x\\)\n"
