import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import QuickCapture from "./QuickCapture";
import NotificationWatcher from "./NotificationWatcher";
import ThemeToggle from "./ThemeToggle";
import SettingsButton from "./SettingsButton";

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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 transition-colors duration-200 dark:bg-black dark:text-zinc-50">
        {children}
        <QuickCapture />
        <NotificationWatcher />
        <ThemeToggle />
        <SettingsButton />
      </body>
    </html>
  );
}
