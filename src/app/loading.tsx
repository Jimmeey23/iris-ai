export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex items-center gap-2 txt-3 text-sm">
        <span className="live-dot inline-block w-2 h-2 rounded-full accent-soft" />
        Loading…
      </div>
    </div>
  );
}
