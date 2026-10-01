import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const tones = { default: "bg-primary/10 text-primary", success: "bg-emerald-50 text-emerald-700", warning: "bg-amber-50 text-amber-800", danger: "bg-rose-50 text-rose-700", neutral: "bg-muted text-muted-foreground" } as const;
export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none", tones[tone], className)} {...props} />;
}
