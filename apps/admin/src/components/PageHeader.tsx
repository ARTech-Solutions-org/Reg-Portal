import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div>{eyebrow && <p className="label-caps text-primary">{eyebrow}</p>}<h1 className="mt-2 font-display text-3xl font-semibold tracking-[-.045em] md:text-[34px]">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}

export function EventTabs({ eventId }: { eventId: string }) {
  const links = [{ to: "", label: "Overview" }, { to: "/attendees", label: "Attendees" }, { to: "/analytics", label: "Analytics" }, { to: "/links", label: "Scanner links" }, { to: "/scanner-branding", label: "Scanner design" }, { to: "/designer", label: "Badge designer" }, { to: "/event-branding", label: "Dashboard branding" }];
  return <nav aria-label="Event sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">{links.map((item) => <NavLink key={item.to} to={`/admin/events/${eventId}${item.to}`} end={!item.to} className={({ isActive }) => cn("whitespace-nowrap border-b-2 px-3 py-3 text-xs font-semibold transition-colors", isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{item.label}</NavLink>)}</nav>;
}
