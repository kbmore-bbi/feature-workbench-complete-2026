#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "infra/snowflake/agents/agent_spec_manifest.json"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text())
    agents = manifest.get("agents") or {}
    failures: list[str] = []
    for agent_name, contract in agents.items():
        path = MANIFEST.parent / str(contract["file"])
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        expected = str(contract["sha256"])
        if actual != expected:
            failures.append(f"{agent_name}: expected {expected}, found {actual}")
    if failures:
        raise SystemExit("Agent specification manifest mismatch:\n" + "\n".join(failures))
    print("Mapping agent specification manifest verified.")


if __name__ == "__main__":
    main()
