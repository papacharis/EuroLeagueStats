"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/live", label: "Live Games" },
  { href: "/games", label: "Historical Games" },
  { href: "/players", label: "Players" },
  { href: "/search", label: "Advanced PIR Search" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.href === "/live" && <span className="dot pulse" style={{ background: "var(--live)", marginRight: 6 }} />}
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
