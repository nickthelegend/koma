import json, os, subprocess, sys, urllib.request

MATH_STYLUS, MATH_SOL, BENCH, ROUTER_STYLUS, ROUTER_SOL = sys.argv[1:6]
RPC, KF, DEV, HERE = os.environ["RPC"], os.environ["KF"], os.environ["DEV"], os.environ["STYLUS_DIR"]
NS = [0, 1, 10, 100]

def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request(RPC, body, {"Content-Type": "application/json"})))
    if "error" in r: raise RuntimeError(r["error"])
    return r["result"]

def calldata(sig, *args):
    return subprocess.check_output(["cast", "calldata", sig, *map(str, args)], text=True).strip()

def estimate(to, data):
    return int(rpc("eth_estimateGas", [{"from": DEV, "to": to, "data": data}]), 16)

def call(to, data):
    return rpc("eth_call", [{"from": DEV, "to": to, "data": data}, "latest"])

def send(to, sig, *args):
    out = subprocess.check_output(["cast", "send", "-r", RPC, "--private-key", open(KF).read().strip(),
                                   to, sig, *map(str, args), "--json"], text=True)
    return int(json.loads(out)["gasUsed"], 16)

ARB_WASM_CACHE = "0x0000000000000000000000000000000000000072"

def is_cached(addr):
    code = rpc("eth_getCode", [addr, "latest"])
    h = subprocess.check_output(["cast", "keccak", code], text=True).strip()
    return int(call(ARB_WASM_CACHE, calldata("codehashIsCached(bytes32)", h)), 16) == 1

def cache(addr):
    """Cache the program in ArbOS. The devnode's CacheManager is a stub (so
    `cargo stylus cache bid` is a no-op there); the dev account is chain owner,
    which may call ArbWasmCache.cacheProgram directly. Verified with
    codehashIsCached."""
    send(ARB_WASM_CACHE, "cacheProgram(address)", addr)
    assert is_cached(addr), f"{addr} not cached"

def curve_suite(math):
    loop = {}
    for n in NS:
        d = calldata("run(address,uint256)", math, n)
        loop[str(n)] = {"estimateGas": estimate(BENCH, d), "result": int(call(BENCH, d), 16)}
    direct = {
        "quoteBuy(1e9,1e27,1e6)": estimate(math, calldata("quoteBuy(uint256,uint256,uint256)", 10**9, 10**27, 10**6)),
        "quoteSell(1e9+1e6,~1e27,1e21)": estimate(math, calldata("quoteSell(uint256,uint256,uint256)", 10**9 + 10**6, 999000999000999000999000999, 10**21)),
    }
    return {"benchLoop": loop, "directTx": direct}

res = {"cache": "stylus_cached = after ArbWasmCache.cacheProgram (codehashIsCached == true)", "node": "offchainlabs/nitro-node:v3.7.1-926f1ab --dev (L1 price 0)", "rpc": RPC,
       "method": "eth_estimateGas (total tx gas incl. 21000 intrinsic + calldata) unless noted",
       "bench": "stylus/bench/CurveBench.sol run(math, n): n x (quoteBuy + quoteSell) external calls",
       "solidity": "contracts/src/CurveMathReference.sol / RoyaltyRouterReference.sol, solc 0.8.28 --optimize-runs 500 --evm-version cancun"}
print("addresses:", dict(mathStylus=MATH_STYLUS, mathSolidity=MATH_SOL, bench=BENCH, routerStylus=ROUTER_STYLUS, routerSolidity=ROUTER_SOL), file=sys.stderr)
for a in (MATH_STYLUS, ROUTER_STYLUS):
    assert not is_cached(a), f"{a}: codehash already cached on this node; restart the devnode (./devnode.sh stop && ./devnode.sh start) for an uncached baseline"
res["curveMath"] = {"stylus_uncached": curve_suite(MATH_STYLUS), "solidity": curve_suite(MATH_SOL)}
for n in NS:
    a, b = res["curveMath"]["stylus_uncached"]["benchLoop"][str(n)]["result"], res["curveMath"]["solidity"]["benchLoop"][str(n)]["result"]
    assert a == b, f"bench results differ at n={n}: {a} vs {b}"

route = calldata("route(uint256,uint256)", 4, 1_000_000)
res["royaltyRouter"] = {}
for name, r in [("stylus_uncached", ROUTER_STYLUS), ("solidity", ROUTER_SOL)]:
    first_est = estimate(r, route)
    first_used = send(r, "route(uint256,uint256)", 4, 1_000_000)
    second_used = send(r, "route(uint256,uint256)", 4, 1_000_000)
    res["royaltyRouter"][name] = {"route(4,1e6) depth3 5 transfers": {
        "firstRoute_estimateGas(cold recipients)": first_est, "firstRoute_gasUsed": first_used,
        "secondRoute_gasUsed(warm recipients)": second_used}}

cache(MATH_STYLUS); cache(ROUTER_STYLUS)
res["curveMath"]["stylus_cached"] = curve_suite(MATH_STYLUS)
res["royaltyRouter"]["stylus_cached"] = {"route(4,1e6) depth3 5 transfers": {
    "thirdRoute_estimateGas(warm recipients)": estimate(ROUTER_STYLUS, route),
    "thirdRoute_gasUsed(warm recipients)": send(ROUTER_STYLUS, "route(uint256,uint256)", 4, 1_000_000)}}
res["royaltyRouter"]["solidity"]["route(4,1e6) depth3 5 transfers"]["thirdRoute_estimateGas(warm recipients)"] = estimate(ROUTER_SOL, route)
res["royaltyRouter"]["solidity"]["route(4,1e6) depth3 5 transfers"]["thirdRoute_gasUsed(warm recipients)"] = \
    send(ROUTER_SOL, "route(uint256,uint256)", 4, 1_000_000)

out = os.path.join(HERE, "bench", "results.json")
json.dump(res, open(out, "w"), indent=2)
print(json.dumps(res, indent=2))
