"""The shape of a project summary. The model must return exactly this (structured output).

Field descriptions are part of the JSON schema sent to the model, so they work as instructions per field.
"""

from pydantic import BaseModel, Field


class Section(BaseModel):
    name: str = Field(description='What a visitor or client would call it, e.g. "Testimonials" or "Opening hours".')
    component_file: str | None = Field(
        description="Repository path of the component that renders it, or null if it is written inline in the page."
    )
    description: str = Field(description="One sentence: what it shows.")


class Page(BaseModel):
    route: str = Field(description='URL path relative to the site root, e.g. "/" or "/menu/".')
    file: str = Field(description="Repository path of the page file.")
    title: str = Field(description="Page title as visitors see it.")
    sections: list[Section] = Field(description="Sections from top to bottom, excluding the shared header and footer.")


class SharedComponent(BaseModel):
    file: str
    purpose: str = Field(description="One sentence.")
    used_on: list[str] = Field(description='Routes that use it, or ["all pages"].')


class ContentLocation(BaseModel):
    content: str = Field(description='The kind of content, e.g. "Phone number, email and address" or "Menu prices".')
    file: str = Field(description="Repository path where it is defined.")
    how_to_edit: str = Field(description="One sentence on how to change it, naming the field, variable or element.")


class Styling(BaseModel):
    approach: str = Field(description='e.g. "Global CSS variables plus scoped <style> blocks in each component".')
    global_stylesheet: str | None
    colors: list[str] = Field(description='Brand colors with where they are defined, e.g. "--color-primary: #6b3e26 (headings)".')
    fonts: list[str]


class ProjectSummary(BaseModel):
    site_name: str
    framework: str = Field(description='Framework and how it builds, e.g. "Astro static site".')
    overview: str = Field(description="Two or three sentences a new developer would need first.")
    pages: list[Page]
    shared_components: list[SharedComponent] = Field(description="Components used on every page, like header and footer.")
    content_locations: list[ContentLocation] = Field(
        description="Where every kind of editable content lives: texts, contact details, prices, lists, images."
    )
    styling: Styling
    notes: list[str] = Field(description="Anything else that matters when changing this site. Empty if nothing.")
