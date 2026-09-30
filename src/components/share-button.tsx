"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconClose, IconCopy, IconShare, IconX } from "./icons";
import { copyText } from "@/lib/clipboard";

export function ShareButton({ title, path, variant = "ghost" }: { title: string; path: string; variant?: "ghost" | "icon" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const dialog = useRef<HTMLDialogElement>(null);
  // The sheet only renders its URL after a click, so reading location here never runs on the server.
  const url = open ? new URL(path, window.location.origin).toString() : path;
  const text = `I'm reading “${title}” on KOMA, an AI comic minted on Arbitrum.`;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function onShare() {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title, text, url: new URL(path, window.location.origin).toString() });
        return;
      } catch {
        /* fall through to the sheet */
      }
    }
    setOpen(true);
  }

  async function copy() {
    setCopied((await copyText(url)) ? "done" : "failed");
    setTimeout(() => setCopied("idle"), 2400);
  }

  return (
    <>
      <button
        onClick={onShare}
        aria-label="Share"
        className={
          variant === "icon"
            ? "grid h-10 w-10 place-items-center text-paper hover:text-kapow"
            : "flex h-12 items-center gap-2 border-2 border-paper/80 px-4 font-display text-[16px] uppercase text-paper hover:bg-paper hover:text-ink"
        }
      >
        <IconShare width={18} height={18} />
        {variant === "ghost" && "Share"}
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        className="m-auto w-[min(92vw,420px)] bg-transparent p-0 text-paper backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="border border-rule bg-stock p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-2xl uppercase leading-none">Share this issue</p>
              <p className="mt-1.5 text-[13px] text-mute">Anyone with the link can read it free. No wallet needed.</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="-mr-1 -mt-1 p-1 text-mute hover:text-paper">
              <IconClose width={18} height={18} />
            </button>
          </div>
          <div className="mt-5 flex items-center border border-rule bg-ink">
            <span className="min-w-0 flex-1 select-all truncate px-3 font-mono text-[12px] text-soft">{url}</span>
            <button onClick={copy} className="flex h-10 items-center gap-1.5 border-l border-rule px-3 text-[13px] font-semibold hover:bg-paper hover:text-ink">
              {copied === "done" ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
              {copied === "done" ? "Copied" : copied === "failed" ? "Select & copy" : "Copy"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center justify-center gap-2 bg-paper text-[14px] font-semibold text-ink hover:bg-white"
            >
              <IconX width={15} height={15} /> Post on X
            </a>
            <a
              href={`https://farcaster.xyz/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center justify-center gap-2 bg-[#855dcd] text-[14px] font-semibold text-white hover:brightness-110"
            >
              Cast on Farcaster
            </a>
          </div>
        </div>
      </dialog>
    </>
  );
}
