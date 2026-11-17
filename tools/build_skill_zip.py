#!/usr/bin/env python3
"""Pack an agent skill folder into the zip a skills marketplace takes.

    python3 tools/build_skill_zip.py skills/schedule-feasibility-check [--out FILE]

SKILL.md sits at the root of the zip, with the folder's other files beside it.
The zip is reproducible: entries are sorted, every timestamp is 1980-01-01 and
every mode is 0644, so the same files always give the same bytes and the same
SHA-256, which this prints. Hidden files and anything named .DS_Store are left
out. It refuses a folder with no SKILL.md, or one whose frontmatter `name`
differs from the folder's name.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
import zipfile
from pathlib import Path

EPOCH = (1980, 1, 1, 0, 0, 0)


def frontmatter_name(text: str) -> str | None:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    n = re.search(r"^name:\s*(\S+)\s*$", m[1], re.M)
    return n[1] if n else None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("folder", type=Path)
    ap.add_argument("--out", type=Path, help="default: target/skills/<folder name>.zip")
    a = ap.parse_args(argv)
    folder = a.folder.resolve()
    skill = folder / "SKILL.md"
    if not skill.is_file():
        print(f"no SKILL.md in {folder}", file=sys.stderr)
        return 1
    name = frontmatter_name(skill.read_text(encoding="utf-8"))
    if name != folder.name:
        print(f"SKILL.md names '{name}', but the folder is '{folder.name}'", file=sys.stderr)
        return 1
    files = sorted(p for p in folder.rglob("*")
                   if p.is_file() and not any(part.startswith(".") for part in p.relative_to(folder).parts))
    out = a.out or Path("target") / "skills" / f"{folder.name}.zip"
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for p in files:
            info = zipfile.ZipInfo(p.relative_to(folder).as_posix(), EPOCH)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"{out}  ({len(files)} files)\nSHA-256  {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
