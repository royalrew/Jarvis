"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/pass", label: "Pass", icon: "🏋️" },
  { href: "/logg", label: "Logg", icon: "📓" },
  { href: "/kalender", label: "Kalender", icon: "📅" },
  { href: "/nivaer", label: "Nivåer", icon: "🪜" },
  { href: "/kampanj", label: "Kampanj", icon: "🗺️" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    setTarget(null);
    for (const tab of TABS) router.prefetch(tab.href);
  }, [pathname, router]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-app">
        {TABS.map((tab) => {
          const activePath = target ?? pathname;
          const active = activePath === tab.href || activePath.startsWith(tab.href + "/");
          const loading = target === tab.href && pathname !== tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                prefetch
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => router.prefetch(tab.href)}
                onTouchStart={() => router.prefetch(tab.href)}
                onClick={() => setTarget(tab.href)}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                  active ? "text-ember" : "text-faint hover:text-muted"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none ${
                    active ? "bg-surface2" : ""
                  } ${loading ? "animate-pulse" : ""}`}
                  aria-hidden
                >
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
