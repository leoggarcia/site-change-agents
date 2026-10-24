"""Deterministic checks on a branch's changes. No model involved: what code can verify, code verifies.

Blocking checks reject the change on their own, before the Reviewer Agent spends a model call.
Warnings don't reject; they go to the reviewer as facts to weigh.
"""

import re
from dataclasses import asdict, dataclass, field
from typing import Literal, Protocol
from urllib.parse import urlparse

from change_agents.coder.policy import ChangeLimits, path_problem
from change_agents.coder.workspace import BuildResult, DiffStat

# Common credential formats. A dedicated scanner such as gitleaks knows hundreds more;
# these cover what a site repo is likely to leak.
SECRET_PATTERNS = {
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "AWS access key": r"\bAKIA[0-9A-Z]{16}\b",
    "Google API key": r"\bAIza[0-9A-Za-z_\-]{35}\b",
    "GitHub token": r"\bgh[pousr]_[A-Za-z0-9]{36,}\b",
    "Slack token": r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b",
    "Stripe key": r"\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b",
    "secret assigned in code": r"(?i)\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*['\"][^'\"\s]{12,}['\"]",
}

# Things that run code or load other sites into the page.
ACTIVE_CONTENT = {
    "<script> tag": r"(?i)<script\b",
    "<iframe> or embed": r"(?i)<(?:iframe|embed|object)\b",
    "javascript: link": r"(?i)javascript:",
    "inline event handler": r"(?i)\son[a-z]+\s*=\s*['\"{]",
}

URL_PATTERN = re.compile(r"https?://[^\s\"'<>)]+")


@dataclass
class CheckResult:
    name: str
    passed: bool
    level: Literal["blocking", "warning"]
    details: str = ""
    findings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


class BranchLike(Protocol):
    def branch_diff(self) -> str: ...
    def branch_files(self) -> list[tuple[str, str]]: ...
    def branch_stat(self) -> DiffStat: ...
    def build(self) -> BuildResult: ...


def added_lines(diff: str) -> list[tuple[str, str]]:
    """(file, line) for every line the diff adds."""
    lines, current = [], ""
    for line in diff.splitlines():
        if line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and not line.startswith("+++") and current:
            lines.append((current, line[1:]))
    return lines


def removed_lines(diff: str) -> list[str]:
    return [line[1:] for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")]


def check_paths(files: list[tuple[str, str]]) -> CheckResult:
    problems = [problem for _, path in files if (problem := path_problem(path))]
    return CheckResult("Allowed files", not problems, "blocking", "Only content, components, styles and static files.", problems)


def check_size(stat: DiffStat, limits: ChangeLimits = ChangeLimits()) -> CheckResult:
    findings = []
    if len(stat.files) > limits.max_files:
        findings.append(f"{len(stat.files)} files changed; the limit is {limits.max_files}.")
    if stat.changed_lines > limits.max_changed_lines:
        findings.append(f"{stat.changed_lines} lines changed; the limit is {limits.max_changed_lines}.")
    details = f"{len(stat.files)} file(s), +{stat.insertions} −{stat.deletions}"
    return CheckResult("Change size", not findings, "blocking", details, findings)


def check_secrets(added: list[tuple[str, str]]) -> CheckResult:
    findings = [
        f"Possible {kind} in {path}"
        for path, line in added
        for kind, pattern in SECRET_PATTERNS.items()
        if re.search(pattern, line)
    ]
    return CheckResult("No secrets", not findings, "blocking", "Credentials must never be committed.", findings)


def check_active_content(added: list[tuple[str, str]]) -> CheckResult:
    findings = [
        f"{kind} added in {path}: {line.strip()[:120]}"
        for path, line in added
        for kind, pattern in ACTIVE_CONTENT.items()
        if re.search(pattern, line)
    ]
    return CheckResult("No scripts or embeds", not findings, "blocking", "Agents may not add code that runs in the browser.", findings)


def check_new_links(diff: str) -> CheckResult:
    """Links to sites the page didn't link to before. Not always wrong, so a warning for the reviewer."""
    before = {urlparse(url).netloc for url in URL_PATTERN.findall("\n".join(removed_lines(diff)))}
    new_domains = sorted(
        {urlparse(url).netloc for _, line in added_lines(diff) for url in URL_PATTERN.findall(line)} - before
    )
    findings = [f"New link to {domain}" for domain in new_domains]
    return CheckResult("New external links", not findings, "warning", "Links to sites the change adds.", findings)


def check_build(build: BuildResult) -> CheckResult:
    return CheckResult("Build", build.passed, "blocking", "npm run build", [] if build.passed else [build.output[-1500:]])


def run_checks(branch: BranchLike) -> list[CheckResult]:
    diff = branch.branch_diff()
    added = added_lines(diff)
    checks = [
        check_paths(branch.branch_files()),
        check_size(branch.branch_stat()),
        check_secrets(added),
        check_active_content(added),
        check_new_links(diff),
    ]
    # The build is the slowest check: only run it when nothing cheaper has already failed.
    if all(check.passed for check in checks if check.level == "blocking"):
        checks.append(check_build(branch.build()))
    return checks

