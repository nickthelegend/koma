// Scratch/placeholder VO: one wav per narration line via fal Kokoro. node tts-kokoro.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const KEY = readFileSync("/Volumes/Extreme SSD/Projects/okx-ai/koma/.env.local", "utf8").match(/^FAL_KEY=(.*)$/m)[1].trim();
const N = JSON.parse(readFileSync("narration.json", "utf8"));
// Pronunciation spelling for TTS only (captions keep the real text).
const say = (t) => t.replace(/KOMA/g, "Koma").replace(/x402/g, "x four oh two").replace(/\b402\b/g, "four oh two").replace(/USDC/g, "U S D C").replace(/ERC-721/g, "E R C seven twenty one").replace(/ERC-6551/g, "E R C sixty-five fifty-one").replace(/EIP-712/g, "E I P seven twelve").replace(/NFT/g, "N F T").replace(/HTTP/g, "H T T P").replace(/\bAI\b/g, "A I").replace(/v4/g, "v four").replace(/Neo Tokyo/g, "Neo Tokyo");
const jobs = [];
N.forEach((s) => s.lines.forEach((l, i) => jobs.push({ file: `media/vo/${s.id}-${i}.wav`, text: say(l) })));
await Promise.all(jobs.map(async (j, k) => {
  if (existsSync(j.file)) return;
  await new Promise((r) => setTimeout(r, k * 150));
  const res = await fetch("https://fal.run/fal-ai/kokoro/american-english", { method: "POST", headers: { Authorization: `Key ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: j.text, voice: "am_michael", speed: 1.1 }) });
  const out = await res.json();
  if (!out.audio?.url) { console.log("fail", j.file, JSON.stringify(out).slice(0, 200)); return; }
  const buf = Buffer.from(await (await fetch(out.audio.url)).arrayBuffer());
  writeFileSync(j.file + ".src", buf);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", j.file + ".src", "-ar", "48000", "-ac", "1", j.file]);
}));
let total = 0;
const durs = {};
for (const j of jobs) {
  const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", j.file]).toString());
  durs[j.file] = d; total += d;
}
writeFileSync("media/vo/durations.json", JSON.stringify(durs, null, 1));
console.log(jobs.length, "lines,", total.toFixed(1), "s of speech");
