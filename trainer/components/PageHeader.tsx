export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="px-4 pb-3 pt-6">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight">{title}</h1>
      {children}
    </header>
  );
}

export function ComingSoon({ note }: { note: string }) {
  return (
    <div className="mx-4 mt-4 card p-5 text-sm text-muted">
      <p className="font-bold text-text">Byggs härnäst</p>
      <p className="mt-1">{note}</p>
    </div>
  );
}
