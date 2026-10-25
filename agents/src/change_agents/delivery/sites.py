"""Publishes built sites into the folder the web server serves, one folder per site or preview."""

import io
import shutil
import uuid
import zipfile
from pathlib import Path

from change_agents.config import get_settings


class PublishError(Exception):
    pass


def _target(path: str) -> Path:
    root = get_settings().sites_dir.resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or target == root:
        raise PublishError(f"Refusing to publish outside the sites folder: {path}")
    return target


def install(archive: bytes, path: str) -> Path:
    """Unpacks a build next to the live folder, then swaps it in with renames, so visitors never see
    a half-copied site."""
    target = _target(path)
    staging = target.parent / f".incoming-{uuid.uuid4().hex[:8]}"
    staging.mkdir(parents=True)
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            for member in zipped.namelist():
                # A file from the archive may not land outside the staging folder ("zip slip").
                if not (staging / member).resolve().is_relative_to(staging.resolve()):
                    raise PublishError(f"Unsafe path in the build: {member}")
            zipped.extractall(staging)
        if not (staging / "index.html").exists():
            raise PublishError("The build has no index.html.")
        old = target.parent / f".old-{uuid.uuid4().hex[:8]}"
        if target.exists():
            target.rename(old)
        staging.rename(target)
        shutil.rmtree(old, ignore_errors=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return target


def remove(path: str) -> None:
    shutil.rmtree(_target(path), ignore_errors=True)
