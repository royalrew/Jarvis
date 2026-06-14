type Coaching = {
  regression?: string;
  cue?: string;
  ready?: string;
};

/**
 * Adaptiv coaching för en nivå: vad du gör om du inte klarar än, den viktigaste
 * tekniknyckeln, och kvittot på att du är redo att gå vidare. Renderar inget om
 * nivån saknar coaching-innehåll, så den kan strös ut överallt utan villkor.
 */
export function CoachingTips({
  guide,
  className = "",
}: {
  guide: Coaching | null | undefined;
  className?: string;
}) {
  if (!guide || (!guide.regression && !guide.cue && !guide.ready)) return null;

  return (
    <div className={`grid gap-2 ${className}`}>
      {guide.regression && (
        <Tip
          icon="🪜"
          label="Om du inte klarar än"
          text={guide.regression}
          tone="border-ember/25 bg-ember/5"
          labelColor="text-ember"
        />
      )}
      {guide.cue && (
        <Tip
          icon="🎯"
          label="Nyckel-cue"
          text={guide.cue}
          tone="border-gold/25 bg-gold/5"
          labelColor="text-gold"
        />
      )}
      {guide.ready && (
        <Tip
          icon="✅"
          label="Redo när"
          text={guide.ready}
          tone="border-green/30 bg-green/5"
          labelColor="text-green"
        />
      )}
    </div>
  );
}

function Tip({
  icon,
  label,
  text,
  tone,
  labelColor,
}: {
  icon: string;
  label: string;
  text: string;
  tone: string;
  labelColor: string;
}) {
  return (
    <div className={`rounded-[10px] border px-3 py-2 ${tone}`}>
      <p className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-eyebrow ${labelColor}`}>
        <span aria-hidden>{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}
