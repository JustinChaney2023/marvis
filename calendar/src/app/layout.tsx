import type { Metadata } from "next";
import { Instrument_Serif, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import QuickCapture from "./QuickCapture";
import ShortcutsHelp from "./ShortcutsHelp";
import NotificationWatcher from "./NotificationWatcher";
import SyncWatcher from "./SyncWatcher";
import TimezoneSync from "./TimezoneSync";
import MeetingBanner from "./MeetingBanner";
import TopBar from "./TopBar";

// Runs before paint so there's no flash of the wrong theme. Kept as a
// plain string (not a .ts file) since it needs to execute inline, before
// React hydrates and before any stylesheet-driven prefers-color-scheme
// default would otherwise apply.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var isDark = stored === "dark" || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {}
})();
`;

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marvis Calendar",
  description: "Personal calendar and task planner",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-full flex-col overflow-hidden bg-paper text-ink transition-colors duration-200">
        <TopBar />
        <MeetingBanner />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <QuickCapture />
        <ShortcutsHelp />
        <NotificationWatcher />
        <SyncWatcher />
        <TimezoneSync />
      </body>
    </html>
  );
}
