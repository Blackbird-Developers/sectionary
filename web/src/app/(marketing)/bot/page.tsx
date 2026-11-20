import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { Contact, LegalPage, type LegalSection } from "@/components/legal-page";
import { CopyButton } from "@/components/copy-button";

export const metadata: Metadata = {
  title: "SectionaryBot",
  description:
    "SectionaryBot is the crawler behind Blimp. What it captures, what it never touches, and how to stop it with one line of robots.txt.",
  alternates: { canonical: "/bot" },
};

// Copy from docs/bot-page.md. Change it there first, then here, so the page
// the crawler links to keeps matching what src/polite.ts actually does.
const ROBOTS = "User-agent: SectionaryBot\nDisallow: /";

const DOES = [
  "Visits public pages once, the way a browser does",
  "At most a handful of pages per store: home, a collection or two, a product or two",
  "Desktop and phone width, one page per second at most",
  "Names itself in every request as SectionaryBot/<version>",
  "Records short silent clips of sections that move, never downloading your videos",
  "May scroll, open the menu, a size guide, a question or the filters, move a slideshow, pick a product option, rest the pointer on a product, press play on a video, and record how the page reacts",
  "Where robots.txt allows it, adds one product to a cart, photographs it and empties it again",
];

const NEVER = [
  "Signs in, goes to checkout or places an order",
  "Captures account, checkout or search pages",
  "Collects personal data",
  "Copies your code, images or files",
  "Types into a field",
];

export default function BotPage() {
  const sections: LegalSection[] = [
    {
      id: "who",
      title: "Who we are",
      body: (
        <p>
          SectionaryBot is the crawler behind Blimp, a reference library of real website and online-store designs,
          built by Blackbird.
        </p>
      ),
    },
    {
      id: "what",
      title: "What it does",
      body: (
        <>
          <p>
            It visits public pages of online stores the way a browser does, once, and takes screenshots of those pages,
            plus short silent screen recordings of the sections that move (slideshows, videos, scrolling text), so
            designers can study how stores are built.
          </p>
          <p>
            It captures at most a handful of pages per store (home, one or two collections, one or two products) at
            desktop and phone width, no more than one page per second, and identifies itself in every request as{" "}
            <code>SectionaryBot/&lt;version&gt;</code> with a link to this page.
          </p>
          <p>
            To show how a page behaves, it may scroll, open the navigation menu, move a slideshow or a product&rsquo;s photos to the next one, select a product option, open a size guide, a product preview, a question in a list of questions or a collection&rsquo;s filters, rest the pointer on a product, press play on a video, and take a screenshot or a short recording of the result. It never applies a filter. Anything it opens, it closes again, and any video it starts, it pauses again. On stores whose robots.txt allows it, it also adds one product to a cart to photograph the cart, then empties the cart again. While it does this it blocks the store&rsquo;s analytics and ad tracking, so it is not counted as a shopper. It never types into a field, and the only form it sends is a product&rsquo;s add to cart.
          </p>
        </>
      ),
    },
    {
      id: "not",
      title: "What it does not do",
      body: (
        <p>
          It never signs in, never goes to checkout or places an order, never enters any details, never captures account, checkout or
          search pages, never collects personal data, and never copies your code, images or files. Recordings are made
          by our own browser as it shows the page; your video files are never downloaded. The only things stored are
          our own screenshots and short screen recordings, plus public facts about the page (its address, the platform
          it runs on, the apps it loads).
        </p>
      ),
    },
    {
      id: "robots",
      title: "It respects robots.txt",
      body: (
        <>
          <p>Add this to yours and it will stop:</p>
          <RobotsSnippet />
        </>
      ),
    },
    {
      id: "removal",
      title: "Opt out or ask for removal",
      body: (
        <p>
          Send the store address to <Contact subject="Removal request" />. We add the store to a block list our crawler
          checks before every run and remove its screenshots and recordings within 48 hours.
        </p>
      ),
    },
    {
      id: "attribution",
      title: "Attribution",
      body: <p>Every screenshot and recording in Blimp names the store and links to the page it came from.</p>,
    },
  ];

  return (
    <LegalPage
      eyebrow="For store owners"
      title="SectionaryBot, the crawler behind Blimp."
      lede={
        <p>
          If you found <code className="rounded-sm bg-muted px-1 font-mono text-[0.88em]">SectionaryBot</code> in your
          logs, this is what it was doing and how to turn it off.
        </p>
      }
      current="/bot"
      aside={<AtAGlance />}
      sections={sections}
    />
  );
}

/** The two things a store owner wants: what it does, and how to stop it. */
function AtAGlance() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
        <FactList title="It does" items={DOES} icon="yes" />
        <FactList title="It never" items={NEVER} icon="no" />
      </div>
      <div className="flex flex-col rounded-xl border bg-card p-5">
        <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Stop it in one step</p>
        <p className="mt-2 text-[15px] leading-relaxed text-pretty">
          Add this to your <code className="rounded-sm bg-muted px-1 font-mono text-[0.88em]">robots.txt</code>. It
          is read again at the start of every run.
        </p>
        <RobotsSnippet className="mt-4" />
      </div>
    </div>
  );
}

function FactList({ title, items, icon }: { title: string; items: string[]; icon: "yes" | "no" }) {
  const Icon = icon === "yes" ? Check : X;
  return (
    <div className="bg-card p-5">
      <p className="font-heading text-[17px] font-semibold">{title}</p>
      <ul className="mt-3 space-y-2.5">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-[14px] leading-snug text-muted-foreground">
            <Icon aria-hidden className={icon === "yes" ? "mt-0.5 size-4 shrink-0 text-link" : "mt-0.5 size-4 shrink-0"} />
            <span className="text-pretty">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RobotsSnippet({ className }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-background dark:border-input ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b py-1 pr-1 pl-3 dark:border-input">
        <span className="font-mono text-[11px] text-muted-foreground">robots.txt</span>
        <CopyButton text={ROBOTS} />
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[13px] leading-relaxed">
        <code>
          <span className="text-link">User-agent:</span> SectionaryBot
          {"\n"}
          <span className="text-link">Disallow:</span> /
        </code>
      </pre>
    </div>
  );
}
