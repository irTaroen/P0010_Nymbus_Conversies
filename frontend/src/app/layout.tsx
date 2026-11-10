import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { AuthProvider } from "@/components/AuthProvider";
import { LocaleRestorer } from "@/components/LocaleToggle";
import { RunWatchProvider } from "@/components/RunWatchProvider";
import { THEME_SCRIPT } from "@/lib/theme-script";

// Poppins for everything — UI, headings and numbers (with `tabular-nums`); Geist
// Mono only for code-like strings (field codes, connector names). nymbus-styling.md §4.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nymbus Conversies",
  description: "Excel inlezen, controleren en uploaden naar AFAS",
};

// `cover` lets the page reach under a phone's notch and home indicator, which
// globals.css then pads back out with the safe-area insets — so the background
// runs edge to edge in landscape and nothing tappable sits under the indicator.
// `resizes-content` makes Android shrink the layout (and `dvh`) for the keyboard,
// so the fixed shell keeps the focused field in view; iOS ignores it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      // The theme script below sets data-theme before React hydrates, so the
      // attribute differs from the server's HTML on purpose.
      suppressHydrationWarning
      className={`${poppins.variable} ${geistMono.variable} h-full font-sans antialiased`}
    >
      <head>
        {/* Applies the remembered (or OS) theme before the first paint — see lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* `h-dvh`, not `h-screen`: on a phone `100vh` is the height with the browser's
          toolbars hidden, so a fixed shell sized by it puts its bottom edge under them. */}
      <body className="flex h-dvh overflow-hidden bg-k-bg text-k-text-primary">
        {/* Starfield — fixed behind everything; CSS paints stars only in dark mode. */}
        <div className="starfield" aria-hidden="true" />
        {/* Stacking context so the app sits above the starfield. */}
        <div className="relative z-[1] flex min-h-0 min-w-0 flex-1">
          <AuthProvider>
            <LocaleRestorer />
            {/* Above every project, so a send still reports its end after you've
                switched to another one. */}
            <RunWatchProvider>
              <AuthGate>{children}</AuthGate>
            </RunWatchProvider>
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}
