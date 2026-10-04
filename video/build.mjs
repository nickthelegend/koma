// Builds index.html from edl.json + narration.json + VO durations.
//   node build.mjs cut   → ~5 min edit (slow parts fast-forwarded, VO-paced)
//   node build.mjs full  → ~9 min walkthrough (footage at ~1×, waits fast-forwarded)
// VO: media/vo/<scene>-<i>.wav (+ media/vo/durations.json). Swap the files to change the voice.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const mode = process.argv[2] === "full" ? "full" : "cut";
const N = Object.fromEntries(JSON.parse(readFileSync("narration.json", "utf8")).map((s) => [s.id, s.lines]));
const EDL = JSON.parse(readFileSync("edl.json", "utf8")).filter((s) => !process.env.ONLY || process.env.ONLY.split(",").includes(s.id));
const voExt = existsSync("media/vo/el") ? "el" : "";
const voFile = (id, i) => (voExt ? `media/vo/el/${id}-${i}.mp3` : `media/vo/${id}-${i}.wav`);
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const r3 = (x) => Math.round(x * 1000) / 1000;

const FF = 8; // fast-forward multiplier over the scene's base rate
const LEAD = 0.45, GAP = 0.32, TAIL = 0.7;

let t = 0;
const videos = [], audios = [], caps = [], tl = [], overlays = [];
let uid = 0;

function voBlock(id, start) {
  const lines = N[id] ?? [];
  let c = start + LEAD;
  const out = [];
  lines.forEach((text, i) => {
    const f = voFile(id, i);
    const d = dur(f);
    out.push({ i, text, start: c, d, file: f });
    c += d + GAP;
  });
  return { lines: out, end: lines.length ? c - GAP + TAIL : start + 1.5 };
}

function captions(lines) {
  // Split each VO line into ~8-word chunks; time chunks by word share of the line.
  for (const l of lines) {
    const words = l.text.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; ) {
      let n = Math.min(8, words.length - i);
      if (words.length - i - n > 0 && words.length - i - n < 3) n = Math.ceil((words.length - i) / 2);
      chunks.push(words.slice(i, i + n).join(" "));
      i += n;
    }
    let c = l.start;
    for (const ch of chunks) {
      const d = (l.d * ch.split(/\s+/).length) / words.length;
      caps.push([r3(c), r3(c + d), ch]);
      c += d;
    }
  }
}

for (const sc of EDL) {
  const start = t;
  if (sc.kind === "card") {
    const vo = voBlock(sc.id, start);
    const d = Math.max(sc.min ?? 4, vo.end - start);
    vo.lines.forEach((l) => audios.push(l));
    captions(vo.lines);
    overlays.push({ ...sc, start, d });
    t += d;
    continue;
  }
  const vo = voBlock(sc.id, start);
  if (typeof sc.segs === "string") {
    const extra = existsSync("segs.json") ? JSON.parse(readFileSync("segs.json", "utf8")) : {};
    sc.segs = extra[sc.id] ?? [[0, Math.max(0.5, dur(sc.src) - 0.2)]];
  }
  const segs = sc.segs.map(([a, b, k]) => ({ a, b, k: k ?? "n", len: b - a }));
  const Nn = segs.filter((s) => s.k === "n").reduce((x, s) => x + s.len, 0);
  const Ff = segs.filter((s) => s.k === "ff").reduce((x, s) => x + s.len, 0);
  const voD = vo.end - start;
  let D, r;
  if (mode === "cut") {
    D = Math.max(voD, sc.min ?? 3);
    r = (Nn + Ff / FF) / D;
    r = Math.min(Math.max(r, 0.75), sc.maxRate ?? 3);
    D = Math.max(voD, (Nn + Ff / FF) / r);
  } else {
    r = 1;
    D = Math.max(voD, Nn + Ff / FF);
    if (D > Nn + Ff / FF) r = (Nn + Ff / FF) / D; // footage shorter than the voice: ease it down a touch
    r = Math.max(r, 0.75);
    D = Math.max(voD, (Nn + Ff / FF) / r);
  }
  let c = start;
  for (const s of segs) {
    const rate = s.k === "ff" ? r * FF : r;
    const d = s.len / rate;
    videos.push({ id: `v${uid++}`, src: sc.src, start: c, d, mediaStart: s.a, rate, ff: s.k === "ff", scene: sc.id });
    if (s.k === "ff") overlays.push({ kind: "ff", start: c, d, x: Math.round(rate) });
    c += d;
  }
  // Hold the last frame if the voice runs past the footage.
  if (c < start + D - 0.05) {
    const last = segs[segs.length - 1];
    videos.push({ id: `v${uid++}`, src: sc.src, start: c, d: start + D - c, mediaStart: Math.max(0, last.b - 0.05), rate: 0.01, ff: false, scene: sc.id });
  }
  vo.lines.forEach((l) => audios.push(l));
  captions(vo.lines);
  if (sc.chapter) overlays.push({ kind: "chapter", start, d: Math.min(4.2, D), text: sc.chapter, n: sc.n });
  for (const co of sc.callouts ?? []) {
    const l = vo.lines[co.line ?? 0];
    const at = l ? l.start + (co.delay ?? 0.3) : start + (co.at ?? 1);
    overlays.push({ kind: "callout", start: at, d: co.d ?? 3.2, text: co.text, sub: co.sub, pos: co.pos ?? "tr", tone: co.tone ?? "kapow" });
  }
  for (const z of sc.zooms ?? []) {
    const l = vo.lines[z.line ?? 0];
    const at = l ? l.start + (z.delay ?? 0) : start + (z.at ?? 0);
    tl.push({ kind: "zoom", scene: sc.id, at, d: z.d ?? 3, s: z.s ?? 1.25, x: z.x ?? 50, y: z.y ?? 50 });
  }
  t = start + D;
}
const total = r3(t);

// ———————————————————— HTML ————————————————————
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const vidHTML = videos
  .map(
    (v) => `      <div class="vw" id="w-${v.id}" data-scene="${v.scene}"><video id="${v.id}" class="clip" src="${v.src}" muted playsinline data-start="${r3(v.start)}" data-duration="${r3(v.d)}" data-media-start="${r3(v.mediaStart)}" data-playback-rate="${r3(v.rate)}" data-track-index="1"></video></div>`,
  )
  .join("\n");
const audHTML = audios.map((a, k) => `      <audio id="vo-${k}" src="${a.file}" data-start="${r3(a.start)}" data-duration="${r3(a.d)}" data-track-index="10" data-volume="1"></audio>`).join("\n");

let ovHTML = "";
let ovJS = "";
overlays.forEach((o, k) => {
  const id = `o${k}`;
  if (o.kind === "ff") {
    ovHTML += `      <div id="${id}" class="clip ff" data-start="${r3(o.start)}" data-duration="${r3(o.d)}" data-track-index="4"><span class="ffi">▶▶</span> ${o.x}×</div>\n`;
  } else if (o.kind === "chapter") {
    ovHTML += `      <div id="${id}" class="clip chapter" data-start="${r3(o.start)}" data-duration="${r3(o.d)}" data-track-index="3"><div class="ch-in" id="${id}-in"><span class="ch-n">${esc(o.n ?? "")}</span><span class="ch-t">${esc(o.text)}</span></div></div>\n`;
    ovJS += `tl.fromTo("#${id}-in", { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, ${r3(o.start + 0.05)});\n`;
    ovJS += `tl.to("#${id}-in", { x: -40, opacity: 0, duration: 0.35, ease: "power2.in" }, ${r3(o.start + o.d - 0.45)});\n`;
  } else if (o.kind === "callout") {
    ovHTML += `      <div id="${id}" class="clip callout ${o.pos} ${o.tone}" data-start="${r3(o.start)}" data-duration="${r3(o.d)}" data-track-index="5"><div class="co-in" id="${id}-in"><div class="co-t">${esc(o.text)}</div>${o.sub ? `<div class="co-s">${esc(o.sub)}</div>` : ""}</div></div>\n`;
    ovJS += `tl.fromTo("#${id}-in", { scale: 0.6, rotation: -4, opacity: 0 }, { scale: 1, rotation: -2, opacity: 1, duration: 0.42, ease: "back.out(2.2)" }, ${r3(o.start + 0.02)});\n`;
    ovJS += `tl.to("#${id}-in", { scale: 0.9, opacity: 0, duration: 0.25, ease: "power2.in" }, ${r3(o.start + o.d - 0.3)});\n`;
  } else if (o.kind === "card") {
    ovHTML += `      <div id="${id}" class="clip card card-${o.id}" data-start="${r3(o.start)}" data-duration="${r3(o.d)}" data-track-index="2">${o.html}</div>\n`;
    ovJS += (o.js ?? "").replaceAll("$S", String(r3(o.start))).replaceAll("$E", String(r3(o.start + o.d))).replaceAll("#", `#`) + "\n";
  }
});
const zoomJS = tl
  .map((z) => {
    const target = videos.filter((v) => v.scene === z.scene && v.start <= z.at + z.d && v.start + v.d >= z.at).map((v) => `#w-${v.id}`);
    if (!target.length) return "";
    const sel = JSON.stringify(target.join(","));
    return `tl.to(${sel}, { scale: ${z.s}, transformOrigin: "${z.x}% ${z.y}%", duration: 0.7, ease: "power2.inOut" }, ${r3(z.at)});\ntl.to(${sel}, { scale: 1, duration: 0.6, ease: "power2.inOut" }, ${r3(z.at + z.d)});`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>KOMA — demo</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Anton"; src: url("fonts/Anton-400.woff2") format("woff2"); font-weight: 400; }
      @font-face { font-family: "Schibsted Grotesk"; src: url("fonts/SchibstedGrotesk-700.woff2") format("woff2"); font-weight: 500 800; }
      @font-face { font-family: "JetBrains Mono"; src: url("fonts/JetBrainsMono-700.woff2") format("woff2"); font-weight: 500 800; }
      :root { --ink: #0a0a0a; --stock: #141414; --paper: #f3eee4; --kapow: #ff4a1c; --arb: #28a0f0; --bam: #ffd23f; --mute: #8c877d; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: "Schibsted Grotesk", sans-serif; color: var(--paper); }
      #stage { position: absolute; inset: 0; background: var(--ink); }
      .vw { position: absolute; inset: 0; overflow: hidden; }
      .vw video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      #caps { position: absolute; left: 0; right: 0; bottom: 0; height: 200px; z-index: 60;
        background: linear-gradient(to top, rgba(0,0,0,0.88) 10%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0) 100%); }
      #caps .cue { position: absolute; left: 50%; bottom: 46px; width: 1500px; margin-left: -750px; text-align: center;
        font-weight: 700; font-size: 40px; line-height: 1.22; opacity: 0; letter-spacing: -0.01em;
        text-shadow: 0 3px 0 #000, 0 0 18px rgba(0,0,0,0.9); }
      #caps .cue b { color: var(--bam); font-weight: 800; }
      .ff { position: absolute; right: 64px; top: 56px; left: auto; width: auto; height: auto; z-index: 70; padding: 10px 18px 10px 14px;
        background: var(--bam); color: #000; font-family: "JetBrains Mono", monospace; font-weight: 800; font-size: 26px; transform: rotate(-2deg); }
      .ffi { letter-spacing: -0.12em; margin-right: 6px; }
      .chapter { position: absolute; left: 64px; top: 56px; width: auto; height: auto; z-index: 70; }
      .ch-in { display: flex; align-items: stretch; box-shadow: 8px 8px 0 #000; }
      .ch-n { background: var(--paper); color: #000; font-family: "Anton", sans-serif; font-size: 38px; padding: 6px 16px 2px; }
      .ch-t { background: var(--kapow); color: #000; font-family: "Anton", sans-serif; font-size: 38px; padding: 6px 22px 2px; text-transform: uppercase; letter-spacing: 0.01em; }
      .callout { position: absolute; width: auto; height: auto; z-index: 65; }
      .callout.tr { right: 90px; top: 150px; left: auto; }
      .callout.tl { left: 90px; top: 150px; }
      .callout.br { right: 90px; bottom: 230px; top: auto; left: auto; }
      .callout.bl { left: 90px; bottom: 230px; top: auto; }
      .callout.mr { right: 90px; top: 430px; left: auto; }
      .co-in { background: var(--paper); color: #000; border: 4px solid #000; box-shadow: 10px 10px 0 var(--kapow); padding: 16px 26px 14px; max-width: 640px; }
      .callout.arb .co-in { box-shadow: 10px 10px 0 var(--arb); }
      .callout.bam .co-in { box-shadow: 10px 10px 0 var(--bam); }
      .co-t { font-family: "Anton", sans-serif; font-size: 46px; line-height: 1.02; text-transform: uppercase; }
      .co-s { margin-top: 6px; font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 21px; color: #333; }
      .card { position: absolute; inset: 0; z-index: 30; background: var(--ink); overflow: hidden; }
      .halftone { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,74,28,0.22) 1.6px, transparent 1.7px); background-size: 14px 14px; }
      #vignette { position: absolute; inset: 0; z-index: 55; pointer-events: none; box-shadow: inset 0 0 220px 40px rgba(0,0,0,0.45); }
${EDL.filter((s) => s.css).map((s) => s.css).join("\n")}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${total}">
      <div id="stage"></div>
${vidHTML}
${ovHTML}      <div id="vignette"></div>
      <div id="caps"></div>
${audHTML}
      <audio id="music" src="media/music/bed-long.wav" data-start="0" data-duration="${r3(total)}" data-track-index="11" data-volume="0.16"></audio>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const CAPS = ${JSON.stringify(caps)};
      const HI = /(x402|USDC|Arbitrum Stylus|Arbitrum|Stylus|ERC-6551|ERC-721|EIP-712|Uniswap v4|NFT|gasless|one signature|canon|KOMA|Rust|ten cents|one dollar|on-chain)/gi;
      const host = document.getElementById("caps");
      CAPS.forEach(function (c, i) {
        const p = document.createElement("p");
        p.className = "cue"; p.id = "cue-" + i;
        p.innerHTML = c[2].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(HI, "<b>$1</b>");
        host.appendChild(p);
        tl.fromTo(p, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, c[0]);
        tl.to(p, { opacity: 0, duration: 0.1, ease: "none" }, Math.max(c[0] + 0.2, c[1] - 0.05));
      });
${ovJS}
${zoomJS}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync("index.html", html);
console.log(`${mode}: ${total.toFixed(1)}s (${(total / 60).toFixed(2)} min), ${videos.length} video clips, ${audios.length} VO lines, ${caps.length} captions`);
