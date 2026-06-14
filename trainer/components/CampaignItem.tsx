"use client";

import { useState } from "react";
import { setCampaignCleared } from "@/app/kampanj/actions";

interface CampaignItemProps {
  id: string;
  title: string;
  label: string;
  body: string;
  criteria: string[];
  done: boolean;
  active: boolean;
  available: boolean;
  isBoss?: boolean;
}

export function CampaignItem({
  id,
  title,
  label,
  body,
  criteria,
  done,
  active,
  available,
  isBoss = false,
}: CampaignItemProps) {
  // Active items are expanded by default; others are collapsed.
  const [isOpen, setIsOpen] = useState(active);

  return (
    <div
      className={`relative pl-14 pr-4 py-3.5 transition-all duration-300 ${
        active
          ? "bg-surface2/30 shadow-[inset_4px_0_0_0_#2563EB]"
          : "hover:bg-surface2/10"
      } ${!available ? "opacity-60" : ""}`}
    >
      {/* Timeline Node */}
      <div className="absolute left-[20px] top-[18px] z-10 flex items-center justify-center">
        {done ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green text-[10px] font-bold text-white shadow-sm ring-4 ring-green/10">
            ✓
          </div>
        ) : active ? (
          <div className="relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-ember bg-white ring-4 ring-ember/15">
            <span className="absolute h-2.5 w-2.5 rounded-full bg-ember animate-pulse" />
          </div>
        ) : (
          <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 bg-white ${
            available ? "border-muted" : "border-line"
          }`}>
            {!available && (
              <span className="text-[9px] text-faint">🔒</span>
            )}
          </div>
        )}
      </div>

      {/* Main Item Content */}
      <div className="cursor-pointer" onClick={() => available && setIsOpen(!isOpen)}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="eyebrow">{label}</span>
              {active && (
                <span className="rounded-full bg-ember/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-ember animate-pulse">
                  Aktiv
                </span>
              )}
              {isBoss && (
                <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-gold">
                  Boss-strid ⚔️
                </span>
              )}
            </div>
            <p className={`mt-1 font-black text-sm md:text-base leading-tight ${
              isBoss ? "text-gold font-extrabold" : "text-text"
            }`}>
              {title}
            </p>
          </div>

          {available && (
            <button
              aria-label={isOpen ? "Stäng detaljer" : "Visa detaljer"}
              className="text-muted hover:text-text transition-colors p-1"
            >
              <svg
                className={`h-4 w-4 transform transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Collapsible Section */}
        {available && (
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              isOpen ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden space-y-3">
              <p className="text-xs md:text-sm leading-relaxed text-muted">{body}</p>
              
              <div className="rounded-[10px] bg-bg p-3 border border-line/40">
                <p className="text-[10px] font-bold uppercase tracking-wide text-faint mb-1.5">
                  Krav för avklarande
                </p>
                <ul className="space-y-1">
                  {criteria.map((criterion, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted leading-relaxed">
                      <span className="text-ember mt-0.5">⚡</span>
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-end pt-1">
                <form
                  action={setCampaignCleared}
                  onClick={(e) => e.stopPropagation()} // Prevent closing on button click
                >
                  <input type="hidden" name="itemId" value={id} />
                  <input type="hidden" name="cleared" value={done ? "false" : "true"} />
                  <button
                    type="submit"
                    className={`rounded-[10px] border px-4 py-2 text-xs font-black shadow-sm transition-all ${
                      done
                        ? "border-green bg-green/5 text-green hover:bg-green/10"
                        : "border-ember bg-ember text-white hover:bg-gold hover:border-gold"
                    }`}
                  >
                    {done ? "Klar ✓" : "Klarmarkera"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
