import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vägen till flaggan",
  description: "Gamifierad calisthenics-progression mot elitskills.",
};

export const viewport: Viewport = {
  themeColor: "#14110F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <div className="mx-auto min-h-dvh max-w-app pb-20">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
