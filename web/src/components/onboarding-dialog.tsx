"use client";

import { useState, useTransition, type ComponentType } from "react";
import {
  BookOpen,
  Briefcase,
  Building2,
  Check,
  Code,
  CreditCard,
  GraduationCap,
  House,
  LayoutGrid,
  Megaphone,
  MoreHorizontal,
  Palette,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  UserRound,
} from "lucide-react";
import { saveOnboardingAction } from "@/app/(app)/account/actions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PAGES, ROLES } from "@/lib/sign-in";
import { INDUSTRY_LABEL } from "@/lib/stores";
import { cn } from "@/lib/utils";
import showcase from "@/app/(marketing)/welcome/showcase.json";

type Icon = ComponentType<{ className?: string }>;

const ROLE_ICON: Record<(typeof ROLES)[number]["value"], Icon> = {
  designer: Palette,
  developer: Code,
  agency: Building2,
  "store-owner": Store,
  marketer: Megaphone,
  freelancer: Briefcase,
  product: UserRound,
  student: GraduationCap,
  other: MoreHorizontal,
};

const PAGE_ICON: Record<(typeof PAGES)[number]["value"], Icon> = {
  home: House,
  collection: LayoutGrid,
  product: Tag,
  cart: ShoppingCart,
  checkout: CreditCard,
  blog: BookOpen,
};

/** "Other" reads oddly as something to want to see. */
const INDUSTRIES = Object.entries(INDUSTRY_LABEL).filter(([value]) => value !== "other");

/** The fan of screenshots at the top: the landing page's showcase blocks, on the image CDN. */
const FAN = ["d-02-featured-video", "d-03-list-collections", "m-02-featured-video", "d-05-hero", "d-02-product"]
  .map((name) => showcase.blocks.find((b) => b.src.includes(`/${name}.`)))
  .filter((b): b is (typeof showcase.blocks)[number] => Boolean(b));

/**
 * Two questions after the first sign-in, like Pixlpin's welcome: "What do you
 * do?" (one role) and "What do you want to see?" (page types and industries).
 * Asked once per account: Skip and the last Continue both mark it done.
 * Stored for picking designs later; nothing reads the answers for access.
 */
export function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();

  const finish = (answers: { role: string | null; pages: string[]; industries: string[] }) =>
    startSaving(async () => {
      // A failed save only means the questions come back next visit; never trap anyone here.
      await saveOnboardingAction(answers).catch(() => null);
      onDone();
    });
  const skip = () => finish({ role: null, pages: [], industries: [] });
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const picked = pages.length + industries.length;

  return (
    <Dialog open onClose={skip} dismissable={false} label="Welcome to Blimp" className="max-w-[720px]">
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 sm:px-8">
          {step === 1 ? (
            <>
              <Fan />
              <p className="mt-5 text-center text-[13px] text-muted-foreground">Welcome to Blimp</p>
              <h2 className="mt-1 text-center font-heading text-[22px] font-extrabold tracking-[-0.03em]">What do you do?</h2>
              <p className="mt-1 text-center text-[14px] text-muted-foreground">This helps us pick designs for you.</p>
              <fieldset className="mt-6">
                <legend className="sr-only">What do you do?</legend>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {ROLES.map(({ value, label }) => {
                    const RoleIcon = ROLE_ICON[value];
                    const on = role === value;
                    return (
                      <label
                        key={value}
                        className={cn(
                          "relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                          on ? "border-foreground bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <input type="radio" name="role" value={value} checked={on} onChange={() => setRole(value)} className="peer sr-only" />
                        <RoleIcon className="size-5" />
                        <span className="text-[14px]">{label}</span>
                        <span
                          aria-hidden
                          className={cn(
                            "absolute top-3.5 right-3.5 flex size-5 items-center justify-center rounded-full border",
                            on ? "border-foreground" : "border-muted-foreground/40",
                          )}
                        >
                          {on && <span className="size-2.5 rounded-full bg-foreground" />}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <h2 className="text-center font-heading text-[22px] font-extrabold tracking-[-0.03em]">What do you want to see?</h2>
              <p className="mt-1 text-center text-[14px] text-muted-foreground">Pick as many as you like.</p>
              <fieldset className="mt-6">
                <legend className="mb-2.5 text-[13px] text-muted-foreground">Pages</legend>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {PAGES.map(({ value, label }) => {
                    const PageIcon = PAGE_ICON[value];
                    const on = pages.includes(value);
                    return (
                      <label
                        key={value}
                        className={cn(
                          "relative flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                          on ? "border-foreground bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <input type="checkbox" checked={on} onChange={() => setPages((p) => toggle(p, value))} className="sr-only" />
                        <PageIcon className="size-5 shrink-0" />
                        <span className="text-[14px]">{label}</span>
                        <Tick on={on} />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="mt-6">
                <legend className="mb-2.5 text-[13px] text-muted-foreground">Industries</legend>
                <div className="flex flex-wrap gap-2">
                  {INDUSTRIES.map(([value, label]) => {
                    const on = industries.includes(value);
                    return (
                      <label
                        key={value}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring touch:py-2.5",
                          on ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70",
                        )}
                      >
                        <input type="checkbox" checked={on} onChange={() => setIndustries((l) => toggle(l, value))} className="sr-only" />
                        {on && <Check className="size-3.5" />}
                        {label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}
        </div>

        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t px-5 py-4 sm:px-8">
          <div>
            <Button variant="ghost" size="lg" disabled={saving} onClick={step === 1 ? skip : () => setStep(1)} className="text-muted-foreground">
              {step === 1 ? "Skip" : "Back"}
            </Button>
          </div>
          <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 2`} role="img">
            <span className={cn("h-1.5 rounded-full transition-all", step === 1 ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30")} />
            <span className={cn("h-1.5 rounded-full transition-all", step === 2 ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30")} />
          </div>
          <div className="flex justify-end">
            {step === 1 ? (
              <Button size="lg" disabled={!role} onClick={() => setStep(2)} className="rounded-full px-5 text-[14px] font-semibold">
                Continue
              </Button>
            ) : (
              <Button
                size="lg"
                disabled={picked === 0 || saving}
                onClick={() => finish({ role, pages, industries })}
                className="rounded-full px-5 text-[14px] font-semibold"
              >
                {saving ? "Saving…" : picked === 0 ? "Pick 1 or more" : "Continue"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border",
        on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40",
      )}
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/** Five screenshots fanned out like cards in a hand. Decoration only. */
function Fan() {
  const turns = [-14, -7, 0, 7, 14];
  return (
    <div aria-hidden className="relative mx-auto flex h-32 w-full max-w-[420px] items-end justify-center">
      {FAN.length === 0 && <ShoppingBag className="size-10 text-muted-foreground" />}
      {FAN.map((b, i) => {
        const turn = turns[i] ?? 0;
        return (
          <div
            key={b.src}
            className="-mx-3 h-28 w-24 shrink-0 overflow-hidden rounded-xl border-2 border-background bg-muted shadow-lg"
            style={{ rotate: `${turn}deg`, translate: `0 ${Math.abs(turn) * 0.8}px`, zIndex: i === 2 ? 2 : i === 1 || i === 3 ? 1 : 0 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- decoration from the image CDN, as the landing page shows it */}
            <img src={b.src} alt="" loading="lazy" className="size-full object-cover object-top" />
          </div>
        );
      })}
    </div>
  );
}
