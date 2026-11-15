import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { IMAGE_ORIGIN } from "@/lib/data-source";
import "./globals.css";

// Blimp's two faces: Manrope carries the wordmark, titles and UI; Geist Mono
// the ids and counts.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Absolute URLs for the OG images. Set NEXT_PUBLIC_SITE_URL to the chosen
  // domain (SEC-33) when it exists; until then, the Vercel URL.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sectionary-pink.vercel.app"),
  title: { default: "Blimp", template: "%s · Blimp" },
  description: "Real online stores, cut into blocks. Browse hero, buy box, reviews, FAQ and cart patterns at desktop and phone width.",
  applicationName: "Blimp",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
    { media: "(prefers-color-scheme: light)", color: "#f3f6fb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        {/* React lifts this into <head>. */}
        {IMAGE_ORIGIN && <link rel="preconnect" href={IMAGE_ORIGIN} />}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
