from change_agents.indexer.schema import ProjectSummary


def to_markdown(summary: ProjectSummary) -> str:
    """Renders the summary as the PROJECT.md a person (or another agent's prompt) can read."""
    lines = [f"# {summary.site_name}", "", f"**Framework:** {summary.framework}", "", summary.overview, "", "## Pages"]
    for page in summary.pages:
        lines += ["", f"### {page.title} — `{page.route}`", f"File: `{page.file}`", ""]
        for section in page.sections:
            where = f" (`{section.component_file}`)" if section.component_file else " (inline in the page)"
            lines.append(f"- **{section.name}**{where}: {section.description}")

    lines += ["", "## Shared components", ""]
    lines += [f"- `{c.file}`: {c.purpose} Used on: {', '.join(c.used_on)}." for c in summary.shared_components]

    lines += ["", "## Where the content lives", ""]
    lines += [f"- **{c.content}**: `{c.file}`. {c.how_to_edit}" for c in summary.content_locations]

    styling = summary.styling
    lines += ["", "## Styling", "", styling.approach]
    if styling.global_stylesheet:
        lines.append(f"Global stylesheet: `{styling.global_stylesheet}`")
    lines += [f"- Color: {color}" for color in styling.colors]
    lines += [f"- Font: {font}" for font in styling.fonts]

    if summary.notes:
        lines += ["", "## Notes", ""] + [f"- {note}" for note in summary.notes]
    return "\n".join(lines) + "\n"
