export const PRODUCT_MARK = "/brand-mark.svg";

export function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <div className={`flex items-center gap-3 ${light ? "text-white" : "text-foreground"}`}>
    <img src={PRODUCT_MARK} alt="" className="h-10 w-10 rounded-xl border border-white/10 object-cover" />
    {!compact && <div className="leading-tight">
      <div className="font-display text-sm font-bold tracking-[.19em]">ALMIRA</div>
      <div className={`mt-1 font-mono text-[9px] uppercase tracking-[.16em] ${light ? "text-white/45" : "text-muted-foreground"}`}>AUREA / event ops</div>
    </div>}
  </div>;
}
