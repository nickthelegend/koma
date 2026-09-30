#!/usr/bin/env bash
# Re-export the Stylus ABIs and diff them against the interfaces in
# contracts/LAUNCHPAD_SPEC.md, compiled to JSON ABI with solc.
#
# Functions: exported ABI must equal the spec ABI (names, input types and
# names, output types, stateMutability). Output parameter *names* are ignored:
# stylus-sdk 0.10.9 does not emit them and they are not part of the ABI
# encoding or selectors.
# Events: stylus-sdk 0.10.9 export-abi does not emit events, so the event
# declarations in royalty-router/src/lib.rs (the ones the contract logs with)
# are compared against the spec instead.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="$HERE/../contracts/LAUNCHPAD_SPEC.md"
SOLC="${SOLC:-$(ls "$HOME/Library/Application Support/svm/0.8.28/solc-0.8.28" 2>/dev/null || command -v solc)}"
[[ -x "$SOLC" ]] || { echo "solc not found; set SOLC=/path/to/solc" >&2; exit 1; }

(cd "$HERE/curve-math" && cargo stylus export-abi --output ../abi/ICurveMath.stylus.sol >/dev/null 2>&1)
(cd "$HERE/royalty-router" && cargo stylus export-abi --output ../abi/IRoyaltyRouter.stylus.sol >/dev/null 2>&1)

python3 - "$SPEC" "$HERE" "$SOLC" <<'PY'
import json, re, subprocess, sys, tempfile, os
spec_path, here, solc = sys.argv[1:4]
spec = open(spec_path).read()

def block(text, name):
    i = text.index(f"interface {name} {{")
    depth = 0
    for j in range(i, len(text)):
        if text[j] == "{": depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0: return text[i:j+1]

def abi_of(src, name):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "I.sol")
        open(p, "w").write("// SPDX-License-Identifier: MIT\npragma solidity ^0.8.23;\n" + src)
        out = subprocess.run([solc, "--combined-json", "abi", p], capture_output=True, text=True, check=True).stdout
        js = json.loads(out)["contracts"]
        return next(v["abi"] for k, v in js.items() if k.endswith(":" + name))

def norm_fn(e):
    return {"name": e["name"], "stateMutability": e["stateMutability"],
            "inputs": [(i["type"], i["name"]) for i in e["inputs"]],
            "outputs": [o["type"] for o in e["outputs"]]}

def norm_ev(e):
    return {"name": e["name"], "anonymous": e["anonymous"],
            "inputs": [(i["type"], i["name"], i["indexed"]) for i in e["inputs"]]}

ok = True
events_rs = "\n".join(re.findall(r"^\s*(event \w+\(.*?\);)", open(os.path.join(here, "royalty-router/src/lib.rs")).read(), re.M))
for name, crate in [("ICurveMath", "curve-math"), ("IRoyaltyRouter", "royalty-router")]:
    spec_abi = abi_of(block(spec, name), name)
    exported_src = open(os.path.join(here, "abi", f"{name}.stylus.sol")).read()
    stylus_abi = abi_of(block(exported_src, name), name)
    sf = sorted((norm_fn(e) for e in spec_abi if e["type"] == "function"), key=lambda x: x["name"])
    xf = sorted((norm_fn(e) for e in stylus_abi if e["type"] == "function"), key=lambda x: x["name"])
    same = sf == xf
    print(f"{name}: functions {'IDENTICAL' if same else 'MISMATCH'} ({len(sf)} spec / {len(xf)} exported)")
    if not same:
        ok = False
        for a in sf:
            if a not in xf: print("  spec only:", a)
        for b in xf:
            if b not in sf: print("  stylus only:", b)
    extra = [e for e in stylus_abi if e["type"] not in ("function",)]
    if extra:
        ok = False; print("  unexpected non-function entries in export:", extra)
    se = sorted((norm_ev(e) for e in spec_abi if e["type"] == "event"), key=lambda x: x["name"])
    if se or name == "IRoyaltyRouter":
        re_abi = abi_of(f"interface {name} {{\n{events_rs}\n}}", name)
        xe = sorted((norm_ev(e) for e in re_abi if e["type"] == "event"), key=lambda x: x["name"])
        same = se == xe
        print(f"{name}: events {'IDENTICAL' if same else 'MISMATCH'} ({len(se)} spec / {len(xe)} in {crate}/src/lib.rs)")
        if not same:
            ok = False; print("  spec:", se); print("  rust:", xe)
sys.exit(0 if ok else 1)
PY
