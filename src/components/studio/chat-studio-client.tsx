"use client";

import dynamic from "next/dynamic";

// The chat lives in the browser (it resumes from localStorage), so it renders client-only.
export const ChatStudioClient = dynamic(() => import("./chat-studio").then((m) => m.ChatStudio), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
      <p className="masthead text-[20vw] text-kapow md:text-[clamp(96px,9vw,132px)]">Studio</p>
    </div>
  ),
});
