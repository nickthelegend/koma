import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your shelf",
  description: "Every KOMA issue minted to your wallet on Arbitrum.",
};

export default function ShelfLayout({ children }: LayoutProps<"/shelf">) {
  return children;
}
