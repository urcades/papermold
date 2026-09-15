"""Batch judgments through the independent Python implementation."""
import json
from pathlib import Path
import sys
# npm may hoist Paperchain beside this package or keep it nested. Search the
# ancestor dependency directories so installed artifact tools remain usable.
reference = next((parent / "node_modules/paperchain/conformance/python"
                  for parent in Path(__file__).resolve().parents
                  if (parent / "node_modules/paperchain/conformance/python/extended_corpus.py").is_file()), None)
if reference is None:
    raise SystemExit("Install a compatible paperchain package to use its Python reference.")
sys.path.insert(0, str(reference))
if len(sys.argv) > 1 and sys.argv[1] == "--corpus":
    from extended_corpus import main
    raise SystemExit(main(sys.argv[2:]))
import papermold
print(json.dumps([papermold.run_case(case) for case in json.load(sys.stdin)], allow_nan=False))
