import { AppShell } from "@/components/app-shell";
import { SiteFooter } from "@/components/site-footer";

/**
 * The landing page (SEC-25) and the legal pages (SEC-29) in the same top bar
 * as Blocks, Flows and Sites (components/app-shell.tsx), so the whole site has
 * one header. The page runs full width under it, and keeps its footer.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell variant="landing" footer={<SiteFooter />}>
      {children}
    </AppShell>
  );
}
