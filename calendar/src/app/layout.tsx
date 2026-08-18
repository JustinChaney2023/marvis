import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import QuickCapture from "./QuickCapture";
import NotificationWatcher from "./NotificationWatcher";

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
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 transition-colors duration-200 dark:bg-black dark:text-zinc-50">
        {children}
        <QuickCapture />
        <NotificationWatcher />
      </body>
    </html>
  );
}
