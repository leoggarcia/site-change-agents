from pathlib import Path

from change_agents.rag.chunking import chunk_code, chunk_markdown, summary_context
from change_agents.rag.evaluate import first_correct_rank
from change_agents.tools.repo import RepoSandbox

SUMMARY = {
    "pages": [
        {
            "route": "/",
            "file": "src/pages/index.astro",
            "title": "Home",
            "sections": [{"name": "Testimonials", "component_file": "src/components/Reviews.astro", "description": "Guest quotes."}],
        }
    ],
    "shared_components": [],
    "content_locations": [{"content": "Plans and prices", "file": "src/data/plans.json", "how_to_edit": "Edit the array."}],
}


def make_site(root: Path) -> RepoSandbox:
    (root / "src" / "components").mkdir(parents=True)
    (root / "src" / "pages").mkdir()
    (root / "src" / "data").mkdir()
    (root / "public").mkdir()
    (root / "src" / "components" / "Reviews.astro").write_text("<section>What our guests say</section>")
    (root / "src" / "pages" / "index.astro").write_text("<Reviews />")
    (root / "src" / "data" / "plans.json").write_text('[{"name": "Starter", "price": "$149"}, {"name": "Growth", "price": "$349"}]')
    (root / "public" / "favicon.svg").write_text("<svg/>")
    (root / "package-lock.json").write_text("{}")
    return RepoSandbox(root)


def test_contextual_chunks_carry_the_indexer_description(tmp_path: Path) -> None:
    chunks = chunk_code(make_site(tmp_path), "contextual", SUMMARY)
    reviews = next(c for c in chunks if c.file_path.endswith("Reviews.astro"))

    assert reviews.kind == "component"
    assert 'Section "Testimonials" on /' in reviews.context
    assert "Testimonials" in reviews.embedding_text()


def test_component_strategy_has_no_context(tmp_path: Path) -> None:
    chunks = chunk_code(make_site(tmp_path), "component", SUMMARY)
    assert all(c.context == "" for c in chunks)


def test_json_arrays_become_one_chunk_per_item(tmp_path: Path) -> None:
    plans = [c for c in chunk_code(make_site(tmp_path), "contextual", SUMMARY) if c.file_path.endswith("plans.json")]
    assert [c.title for c in plans] == ["src/data/plans.json item 1: Starter [data]", "src/data/plans.json item 2: Growth [data]"]
    assert all("Plans and prices" in c.context for c in plans)


def test_skips_public_assets_and_lock_files(tmp_path: Path) -> None:
    paths = {c.file_path for c in chunk_code(make_site(tmp_path), "fixed")}
    assert "public/favicon.svg" not in paths and "package-lock.json" not in paths


def test_markdown_is_split_by_section_with_its_source_title() -> None:
    chunks = chunk_markdown("cafe/plan.md", "plan", "# Basic plan\n\nIntro.\n\n## Included\n- Text\n\n## Not included\n- Payments\n")

    assert [(c.heading, c.content) for c in chunks] == [("Overview", "Intro."), ("Included", "- Text"), ("Not included", "- Payments")]
    assert all(c.source_title == "Basic plan" for c in chunks)


def test_summary_context_maps_sections_to_component_files() -> None:
    assert "src/components/Reviews.astro" in summary_context(SUMMARY)


def test_first_correct_rank() -> None:
    assert first_correct_rank(["a", "b", "c"], ["c", "x"]) == 3
    assert first_correct_rank(["a"], ["z"]) is None
