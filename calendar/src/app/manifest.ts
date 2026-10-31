import type { MetadataRoute } from "next";

// Makes Season installable to a phone's home screen (Add to Home Screen /
// Install app) so it opens full-screen like a native app, with long-press
// shortcuts straight into adding a task or the Focus view.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Season",
    short_name: "Season",
    description: "A calm personal OS for your calendar, tasks, and focus time",
    start_url: "/home",
    display: "standalone",
    background_color: "#f7f4ef",
    theme_color: "#f7f4ef",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New task", url: "/tasks?new=1", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Focus", url: "/focus", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Tasks", url: "/tasks", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
