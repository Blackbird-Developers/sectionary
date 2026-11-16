"use client";

import { useActionState, useId } from "react";
import { KeyRound } from "lucide-react";
import { createApiKeyAction, revokeApiKeyAction, type ApiKeyState } from "@/app/(app)/account/actions";
import type { ApiKeyInfo } from "@/server/api-keys";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { field } from "@/components/sign-in-form";
import { cn } from "@/lib/utils";

const idle: ApiKeyState = { status: "idle" };

type Props = {
  keys: ApiKeyInfo[];
  /** This site's /api/mcp, for the setup line. */
  endpoint: string;
  /** The account's plan includes the MCP server. */
  allowed: boolean;
  max: number;
};

/** API keys for the Blimp MCP server (SEC-31): make one, copy it once, revoke it. */
export function ApiKeysCard({ keys, endpoint, allowed, max }: Props) {
  const [state, create, pending] = useActionState(createApiKeyAction, idle);
  const id = useId();
  const error = state.status === "error" ? state.message : null;
  return (
    <section aria-label="MCP API keys" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-heading text-[15px] font-semibold">MCP API keys</p>
        <p className="text-[13px] text-muted-foreground">Let Claude, Cursor and other AI tools search the library.</p>
      </div>

      {state.status === "created" && <NewKey name={state.name} keyValue={state.key} endpoint={endpoint} />}

      {keys.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[14px]">{k.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  <code className="font-mono">{k.prefix}…</code> · made {day(k.createdAt)} · {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "not used yet"}
                </p>
              </div>
              <form action={revokeApiKeyAction}>
                <input type="hidden" name="id" value={k.id} />
                <Button type="submit" variant="ghost">Revoke</Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {!allowed ? (
        <p className="rounded-lg border border-dashed p-3 text-[13px] text-muted-foreground">The MCP server comes with Pro.</p>
      ) : keys.length >= max ? (
        <p className="text-[13px] text-muted-foreground">You have {max} keys, the most an account can hold. Revoke one to make another.</p>
      ) : (
        <form action={create} className="flex flex-col gap-2" noValidate>
          <label htmlFor={`${id}-name`} className="sr-only">Key name</label>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <input
              id={`${id}-name`}
              name="name"
              maxLength={60}
              placeholder="Name, e.g. Claude Code on my laptop"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={cn(field, "min-[420px]:flex-1")}
            />
            <Button type="submit" size="lg" variant="outline" disabled={pending} className="h-11">
              {pending ? "Making…" : "New key"}
            </Button>
          </div>
          <p id={`${id}-error`} aria-live="polite" className={cn("text-[13px] text-destructive", !error && "sr-only")}>{error}</p>
        </form>
      )}
    </section>
  );
}

function NewKey({ name, keyValue, endpoint }: { name: string; keyValue: string; endpoint: string }) {
  const command = `claude mcp add --transport http blimp ${endpoint} --header "Authorization: Bearer ${keyValue}"`;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-link/40 bg-muted/40 p-3">
      <p className="inline-flex items-center gap-1.5 text-[13px]">
        <KeyRound aria-hidden className="size-3.5 text-link" /> Your new key &ldquo;{name}&rdquo;. Copy it now: it won&apos;t be shown again.
      </p>
      <span className="flex flex-wrap items-center gap-1">
        <code className="rounded-md bg-background px-2 py-1 font-mono text-[12px] break-all">{keyValue}</code>
        <CopyButton text={keyValue} label="Copy key" />
      </span>
      <p className="text-[13px] text-muted-foreground">To add it to Claude Code, run:</p>
      <span className="flex flex-wrap items-center gap-1">
        <code className="rounded-md bg-background px-2 py-1 font-mono text-[12px] break-all">{command}</code>
        <CopyButton text={command} label="Copy command" />
      </span>
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
