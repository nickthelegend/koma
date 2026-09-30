import type { Genre } from "@/lib/types";

// Studio configuration: genres, the ready-made cast, and art styles.
export const GENRES: Genre[] = ["Manga", "Superhero", "Noir", "Sci-fi", "Horror", "Comedy", "Fantasy"];
export const genres = ["All", ...GENRES] as const;

export const cast = [
  { id: "kuro-yami", name: "Kuro Yami", role: "Masked drifter", look: "a lean young man with messy black hair, sharp grey eyes, a black cloth mask over his nose and mouth, and a high-collared black long coat", img: "/cast/kuro-yami.jpg" },
  { id: "rei-shirogane", name: "Rei Shirogane", role: "Shrine guardian", look: "a calm young woman with very long straight silver-white hair, white shrine-maiden robes with red cords, always with a small red fox", img: "/cast/rei-shirogane.jpg" },
  { id: "aoi-kaze", name: "Aoi Kaze", role: "Wind swordswoman", look: "a young swordswoman with a short messy ponytail, aviator goggles on her head, a long pink scarf and a grey utility jacket", img: "/cast/aoi-kaze.jpg" },
  { id: "bolt-arai", name: "Bolt Arai", role: "Street racer", look: "a cheerful teen racer with spiky blond hair, goggles on his forehead, and a red racing jacket with a white lightning bolt", img: "/cast/bolt-arai.jpg" },
  { id: "hana-fujimoto", name: "Hana Fujimoto", role: "Botanist", look: "a friendly young botanist with a short bob, a patterned bandana headband and a white work apron with soil stains", img: "/cast/hana-fujimoto.jpg" },
  { id: "captain-varga", name: "Captain Varga", role: "Sky pirate", look: "a grinning sky pirate with a wild mane of red hair, an eyepatch, a red beard and a white double-breasted captain's coat", img: "/cast/captain-varga.jpg" },
];

export const styles = [
  { id: "neon-anime", label: "Neon anime", prompt: "anime comic art, cel-shaded, neon cyberpunk palette of magenta and cyan, rain, crisp ink lines", tone: "#ff2e88", thumb: "/styles/neon-anime.jpg" },
  { id: "pop-art", label: "Pop-art", prompt: "bold pop-art comic art, Ben-Day dots, thick black outlines, flat saturated primary colors", tone: "#ffd400", thumb: "/styles/pop-art.jpg" },
  { id: "noir", label: "Noir", prompt: "film noir comic art, high-contrast black and white ink with a single blood-red accent, heavy shadows, rain", tone: "#b3001b", thumb: "/styles/noir.jpg" },
  { id: "superhero", label: "Modern superhero", prompt: "modern American superhero comic art, dynamic foreshortening, glossy digital coloring, dramatic rim light", tone: "#2ea3f2", thumb: "/styles/superhero.jpg" },
  { id: "gothic", label: "Gothic", prompt: "gothic dark-fantasy comic art, candlelight, ornate detail, painterly inks, deep purples and golds", tone: "#6b2fa3", thumb: "/styles/gothic.jpg" },
  { id: "retro-sf", label: "Retro sci-fi", prompt: "1960s retro science-fiction comic art, halftone print texture, teal and orange palette, clean lines", tone: "#1aa39a", thumb: "/styles/retro-sf.jpg" },
];
