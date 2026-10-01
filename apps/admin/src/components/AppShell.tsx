import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Activity, ArrowUpRight, ChevronDown, CircleHelp, LayoutDashboard, LogOut, Palette, Settings2, TicketCheck, Users2 } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { useEventBranding } from "@/hooks/useEventBranding";
import { cn } from "@/lib/cn";

const mainNav = [{ to: "/admin", label: "Overview", icon: LayoutDashboard }];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams();
  const { branding } = useEventBranding();
  const isEvent = Boolean(eventId);
  const doLogout = async () => { await logout(); navigate("/login", { replace: true }); };

  return <div className="min-h-screen bg-background md:flex" style={{ transition: "background-color 0.3s ease" }}>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-6 pb-7 pt-6">
        {branding?.logoDataUrl ? (
          <img src={branding.logoDataUrl} alt="Logo" className="max-h-8 object-contain" />
        ) : (
          <Brand light />
        )}
      </div>
      <div className="px-4">
        <p className="label-caps px-3 pb-2 text-white/40">Workspace</p>
        {mainNav.map((item) => <NavLink key={item.to} to={item.to} end className={({ isActive }) => cn("mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", isActive ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white")}><item.icon className="h-4 w-4" />{item.label}</NavLink>)}
        <NavLink to="/admin" className={({ isActive }) => cn("mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", location.pathname.startsWith("/admin/projects") ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white")}><TicketCheck className="h-4 w-4" />Projects & events</NavLink>
      </div>
      {isEvent && <div className="mt-6 px-4">
        <p className="label-caps px-3 pb-2 text-white/40">Selected event</p>
        {[{ path: "", label: "Event overview", icon: Activity }, { path: "/attendees", label: "Attendees", icon: Users2 }, { path: "/analytics", label: "Analytics", icon: LayoutDashboard }, { path: "/links", label: "Scanner links", icon: ArrowUpRight }, { path: "/scanner-branding", label: "Scanner design", icon: Palette }, { path: "/designer", label: "Badge designer", icon: Settings2 }].map((item) => <NavLink key={item.path} to={`/admin/events/${eventId}${item.path}`} end={!item.path} className={({ isActive }) => cn("mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", isActive ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white")}><item.icon className="h-4 w-4" />{item.label}</NavLink>)}
      </div>}
      <div className="mt-auto border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-3 px-2 py-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">{user?.username?.slice(0, 1).toUpperCase() ?? "A"}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{user?.displayName || "Event organizer"}</div><div className="truncate text-[10px] text-white/45">@{user?.username}</div></div><ChevronDown className="h-3 w-3 text-white/40" /></div>
        <button onClick={() => void doLogout()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" />Sign out</button>
      </div>
    </aside>
    <div className="min-h-screen w-full md:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-xl md:px-9">
        <div className="flex items-center gap-3 md:hidden">
          {branding?.logoDataUrl ? (
            <img src={branding.logoDataUrl} alt="Logo" className="max-h-6 object-contain" />
          ) : (
            <><Brand compact /><span className="font-display text-xs font-bold tracking-[.13em]">ALMIRA AUREA</span></>
          )}
        </div>
        <div className="hidden md:block"><p className="label-caps">Event operations · live workspace</p><p className="mt-1 text-xs text-muted-foreground">A clear view of every arrival.</p></div>
        <div className="flex items-center gap-3"><span className="hidden items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />System ready</span><a href="https://help.manus.im" target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-white" aria-label="Help"><CircleHelp className="h-4 w-4" /></a><Button variant="ghost" size="sm" className="md:hidden" onClick={() => void doLogout()}><LogOut className="h-4 w-4" /></Button></div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-7 md:px-9 md:py-9"><Outlet /></main>
    </div>
  </div>;
}
