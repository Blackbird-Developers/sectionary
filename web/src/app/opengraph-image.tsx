import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The share card for every page (SEC-25). Same ground, blue and faces as
// the app's dark theme. Fonts are static cuts committed in web/assets/og (both SIL OFL),
// because the image renderer cannot read variable fonts.
export const alt = "Blimp: see every store from above";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/og/manrope-800.woff")),
  readFile(join(process.cwd(), "assets/og/geist-mono-400.ttf")),
]);

const INK = "#0f0f0f";
const SURFACE = "#1b1b1b";
const BLUE = "#2f6bff";
const ON_BLUE = "#ffffff";
const MUTED = "#a1a1a1";

// A page pulled apart at its seams: [height, label, highlighted].
const PAGE: [number, string, boolean][] = [
  [36, "header", false],
  [150, "hero", false],
  [112, "buy box", true],
  [70, "reviews", false],
  [96, "faq", false],
  [36, "footer", false],
];

export default async function Image() {
  const [manrope, mono] = await fonts;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: INK, padding: "64px 72px", color: "#e8e8e8" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg viewBox="0 0 100 100" width="52" height="52">
              <rect width="100" height="100" rx="25" fill={BLUE} />
              <g fill={ON_BLUE} stroke={ON_BLUE} transform="translate(11.5 10.5) scale(.77) rotate(-10 50 50)">
                <path stroke="none" d="M97 50 C97 33 78 25 58 25 C36 25 16 40 5 50 C16 60 36 75 58 75 C78 75 97 67 97 50 Z" />
                <path strokeWidth="3" strokeLinejoin="round" d="M9 27 L25 24 L36 37 L17 45 Z M9 73 L25 76 L36 63 L17 55 Z" />
                <rect stroke="none" x="50" y="78" width="22" height="8" rx="4" />
              </g>
            </svg>
            <div style={{ fontFamily: "Manrope", fontSize: 44, letterSpacing: "-0.045em" }}>blimp</div>
          </div>
          <div style={{ display: "flex", fontFamily: "Manrope", fontSize: 84, lineHeight: 1.0, letterSpacing: "-0.045em" }}>
            See every store from above.
          </div>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 22, color: MUTED }}>
            Real stores / desktop and phone / theme and apps
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginLeft: "auto", width: 330, justifyContent: "center" }}>
          {PAGE.map(([h, label, on]) => (
            <div
              key={label}
              style={{
                display: "flex",
                height: h,
                borderRadius: 8,
                background: on ? BLUE : SURFACE,
                border: on ? "none" : "1px solid rgba(255,255,255,0.09)",
                padding: "8px 10px",
                fontFamily: "Mono",
                fontSize: 15,
                color: on ? ON_BLUE : MUTED,
                marginLeft: on ? -28 : 0,
                marginRight: on ? 28 : 0,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Manrope", data: manrope, weight: 800, style: "normal" },
        { name: "Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
