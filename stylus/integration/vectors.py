"""Replays test-vectors/curve.json against a deployed ICurveMath via batched
eth_call. Usage: vectors.py <rpc> <address> <label>"""
import json, os, sys, urllib.request

rpc, addr, label = sys.argv[1:4]
here = os.path.dirname(os.path.abspath(__file__))
vec = json.load(open(os.path.join(here, "..", "test-vectors", "curve.json")))
def sel(sig):
    import subprocess
    return subprocess.check_output(["cast", "sig", sig], text=True).strip()[2:]
SEL = {
    "quoteBuy": sel("quoteBuy(uint256,uint256,uint256)"),
    "quoteSell": sel("quoteSell(uint256,uint256,uint256)"),
    "usdcToReach": sel("usdcToReach(uint256,uint256,uint256)"),
    "spotPrice": sel("spotPrice(uint256,uint256)"),
}
w = lambda x: format(int(x), "064x")
def data(fn, *args):
    return "0x" + SEL[fn] + "".join(w(a) for a in args)

calls, expect = [], []
for c in vec["cases"]:
    for fn, args, out in [
        ("quoteBuy", (c["vU"], c["vC"], c["usdcIn"]), c["quoteBuy"]),
        ("quoteSell", (c["vU"], c["vC"], c["coinIn"]), c["quoteSell"]),
        ("usdcToReach", (c["vU"], c["vC"], c["targetVU"]), c["usdcToReach"]),
        ("spotPrice", (c["vU"], c["vC"]), c["spotPrice"]),
    ]:
        calls.append(data(fn, *args)); expect.append(("ok", int(out)))
for r in vec["reverts"]:
    args = (r["vU"], r["vC"]) if r["fn"] == "spotPrice" else (r["vU"], r["vC"], r["x"])
    calls.append(data(r["fn"], *args)); expect.append(("revert", r["revertData"]))

def batch(chunk, base):
    body = [{"jsonrpc": "2.0", "id": base + i, "method": "eth_call",
             "params": [{"to": addr, "data": d}, "latest"]} for i, d in enumerate(chunk)]
    req = urllib.request.Request(rpc, json.dumps(body).encode(), {"Content-Type": "application/json"})
    res = json.load(urllib.request.urlopen(req, timeout=120))
    return sorted(res, key=lambda r: r["id"])

ok_n = rev_n = rev_exact = 0
bad = []
for s in range(0, len(calls), 200):
    for r in batch(calls[s:s + 200], s):
        kind, want = expect[r["id"]]
        if kind == "ok":
            if "result" in r and int(r["result"], 16) == want: ok_n += 1
            else: bad.append((r["id"], calls[r["id"]][:10], want, r))
        else:
            if "error" in r:
                rev_n += 1
                d = r["error"].get("data")
                if isinstance(d, str) and d.lower() == want.lower(): rev_exact += 1
                else: bad.append((r["id"], "revertData", want, r["error"]))
            else: bad.append((r["id"], "no revert", want, r))
print(f"{label}: {ok_n}/{sum(1 for e in expect if e[0]=='ok')} outputs match, "
      f"{rev_n}/{sum(1 for e in expect if e[0]=='revert')} reverts, {rev_exact} with identical revert data")
for b in bad[:5]: print("  MISMATCH", b)
sys.exit(1 if bad else 0)
