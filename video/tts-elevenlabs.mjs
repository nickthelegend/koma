// ElevenLabs VO: ELEVENLABS_API_KEY=... node tts-elevenlabs.mjs [voiceId]
// Writes media/vo/el/<scene>-<i>.mp3; build.mjs uses media/vo/el automatically when it exists.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("set ELEVENLABS_API_KEY");
const VOICE = process.argv[2] ?? "TX3LPaxmHKxFdv7VOQHJ"; // "Liam" — energetic young narrator
const N = JSON.parse(readFileSync("narration.json", "utf8"));
const say = (t) => t.replace(/KOMA/g, "Koma").replace(/x402/g, "x four oh two").replace(/\b402\b/g, "four oh two").replace(/ERC-721/g, "E R C seven twenty-one").replace(/ERC-6551/g, "E R C sixty-five fifty-one").replace(/EIP-712/g, "E I P seven twelve");
mkdirSync("media/vo/el", { recursive: true });
const jobs = [];
N.forEach((s) => s.lines.forEach((l, i) => jobs.push({ file: `media/vo/el/${s.id}-${i}.mp3`, text: say(l) })));
let prev = "";
for (const j of jobs) {
  if (existsSync(j.file)) { prev = j.text; continue; }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: j.text, model_id: "eleven_multilingual_v2", previous_text: prev, voice_settings: { stability: 0.32, similarity_boost: 0.8, style: 0.7, use_speaker_boost: true, speed: 1.12 } }),
  });
  if (!res.ok) { console.log("fail", j.file, res.status, (await res.text()).slice(0, 200)); process.exit(1); }
  writeFileSync(j.file, Buffer.from(await res.arrayBuffer()));
  prev = j.text;
  process.stdout.write(".");
}
console.log(`\n${jobs.length} lines`);
