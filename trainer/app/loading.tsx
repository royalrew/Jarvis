export default function Loading() {
  return (
    <main className="px-4 pb-6 pt-6">
      <div className="h-3 w-24 rounded-full bg-surface2" />
      <div className="mt-3 h-8 w-40 rounded-full bg-surface2" />
      <div className="mt-5 grid grid-cols-3 gap-2">
        <SkeletonBox />
        <SkeletonBox />
        <SkeletonBox />
      </div>
      <div className="mt-5 space-y-3">
        <div className="card h-28 animate-pulse" />
        <div className="card h-40 animate-pulse" />
        <div className="card h-32 animate-pulse" />
      </div>
    </main>
  );
}

function SkeletonBox() {
  return <div className="h-14 rounded-[10px] border border-line bg-surface animate-pulse" />;
}
