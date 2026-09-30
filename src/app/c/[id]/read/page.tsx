import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { countRead, findComic } from "@/lib/catalog";
import { ComicPage } from "@/components/comic-page";
import { ReaderChrome } from "@/components/reader-chrome";
import { ChainProof } from "@/components/chain-proof";
import { IconRemix, IconPen } from "@/components/icons";

export async function generateMetadata({ params }: PageProps<"/c/[id]/read">): Promise<Metadata> {
  const c = await findComic((await params).id);
  return c ? { title: `Reading ${c.title}`, description: c.logline } : {};
}

export const dynamic = "force-dynamic";

export default async function Reader({ params }: PageProps<"/c/[id]/read">) {
  const comic = await findComic((await params).id);
  if (!comic?.pages) notFound();
  await countRead(comic.id);

  return (
    <div className="min-h-dvh bg-[#0a0a0a]">
      <ReaderChrome id={comic.id} title={comic.title} pages={comic.pages.length} />

      <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-2 pb-16 pt-4 md:gap-12 md:px-4 md:pt-10">
        {comic.pages.map((p, i) => (
          <div key={i} id={`p${i + 1}`} data-page={i + 1} className="scroll-mt-20">
            <ComicPage page={p} number={i + 1} priority={i === 0} />
          </div>
        ))}

        {/* End card */}
        <section className="mt-6 px-2 text-center md:mt-10">
          <p className="masthead text-[22vw] text-kapow md:text-[150px]">The end</p>
          <p className="mx-auto mt-3 max-w-[40ch] text-[15px] text-soft">
            {comic.title} was made by {comic.creator.name} for {comic.chain.paidUsdc} USDC and is token #{comic.chain.tokenId} on
            Arbitrum.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href={`/create?remix=${comic.id}`} className="slant h-12 px-7 text-[19px]">
              <IconRemix width={18} height={18} /> Remix this issue
            </Link>
            <Link
              href="/create"
              className="flex h-12 items-center gap-2 border-2 border-paper/80 px-4 font-display text-[16px] uppercase text-paper hover:bg-paper hover:text-ink"
            >
              <IconPen width={16} height={16} /> Make your own
            </Link>
          </div>
          <div className="mx-auto mt-12 max-w-[560px] text-left">
            <ChainProof chain={comic.chain} />
          </div>
        </section>
      </div>
    </div>
  );
}
