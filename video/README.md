# Demo video

How the submission video was made — real app footage, no mockups.

1. `seed-demo.mjs` launches a few named series on a local Arbitrum Sepolia fork, using real KOMA character art.
2. A Playwright recorder (not checked in) drove the running app in headless Chrome with a test wallet that signs (EIP-1193 bridge), captures 1080p frames over CDP and writes one mp4 per scene. Comics, the character sheet and the canon episode are generated live by fal during the recording.
3. `narration.json` is the script; `tts-elevenlabs.mjs` voices it line by line (`ELEVENLABS_API_KEY` in a local, untracked `.env.local`).
4. `build.mjs cut` turns `edl.json` + `segs.json` (which footage ranges play at normal speed and which fast-forward) into a [HyperFrames](https://hyperframes.heygen.com) composition paced to the voice, with chapter cards, callouts, zooms and burned-in captions. `npx hyperframes render` produces the mp4.
