import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "EuroLeague PIR Tracker",
  description: "Live and historical EuroLeague PIR reconstructed from play-by-play, at any moment of any game.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <a href="/" className="brand">
              <span className="brand-mark">PIR</span>
              <span className="brand-name">EuroLeague PIR Tracker</span>
            </a>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
