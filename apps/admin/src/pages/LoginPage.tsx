import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, LockKeyhole, UserRound } from "lucide-react";
import { ApiError, apiContract } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { setupStatusSchema } from "@eventdesk/contracts";

export function LoginPage() {
  const { user, loading, login, setup } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const setupStatus = useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: () => apiContract("/auth/setup-status", setupStatusSchema),
    retry: false,
    staleTime: 30_000,
  });
  const setupRequired = setupStatus.data?.setupRequired === true;
  const setupBlocked = setupStatus.data?.setupBlocked === true;
  const mutation = useMutation({
    mutationFn: async () => setupRequired ? setup(username, password) : login(username, password),
  });

  if (loading || setupStatus.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Checking organizer access…</div>;
  if (user) return <Navigate to="/admin" replace />;
  const statusError = setupStatus.isError
    ? setupStatus.error instanceof ApiError ? setupStatus.error.message : "The organizer setup service could not be reached."
    : null;
  const submitError = mutation.error instanceof ApiError ? mutation.error.message : mutation.error ? "Could not complete sign-in. Please try again." : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return <main className="surface-grid relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
    <div className="pointer-events-none absolute -right-36 -top-40 h-[520px] w-[520px] rounded-full bg-blue-200/30 blur-3xl" />
    <div className="relative grid w-full max-w-[1000px] overflow-hidden rounded-[28px] border border-border bg-white shadow-lift md:grid-cols-[1.02fr_.98fr]">
      <section className="hidden flex-col justify-between bg-sidebar p-10 text-white md:flex">
        <Brand light />
        <div><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[.16em] text-white/70"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Gatepass / operations</div><h1 className="font-display text-[46px] font-semibold leading-[1.02] tracking-[-.045em]">Move the line.<br /><span className="text-blue-300">Keep the signal.</span></h1><p className="mt-6 max-w-sm text-sm leading-6 text-white/60">A composed view of arrivals, attendance and the moments that make an event feel effortless.</p></div>
        <div className="flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[9px] uppercase tracking-[.16em] text-white/40"><span>ALMIRA AUREA</span><span>Event ops / 01</span></div>
      </section>
      <section className="flex min-h-[580px] flex-col justify-center p-7 sm:p-12">
        <div className="mb-9 md:hidden"><Brand /></div>
        <div className="mb-8"><p className="label-caps text-primary">Organizer access</p><h2 className="mt-3 font-display text-3xl font-semibold tracking-[-.04em]">{setupRequired ? "Set up local sign-in." : "Welcome to Eventdesk."}</h2><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{setupRequired ? "Choose the username and password for the first organizer. If one legacy organizer exists, setup keeps that account's project ownership." : "Sign in with your Eventdesk username and password to manage projects, events, attendance and staff scanners."}</p></div>
        <div className="rounded-xl border border-border bg-muted/40 p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-primary shadow-sm"><KeyRound className="h-4 w-4" /></span><div><p className="text-xs font-semibold">Private organizer sign-in</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Passwords are stored as salted scrypt hashes and are never displayed after submission.</p></div></div></div>
        {statusError ? <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Could not check organizer setup: {statusError}</div> : setupBlocked ? <div role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Local sign-in has not been initialized, and multiple legacy organizer records exist. Automatic setup is disabled to protect their project access; an administrator must resolve the accounts before enabling local sign-in.</div> : <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block"><span className="mb-1.5 block text-xs font-medium">Username</span><span className="relative block"><UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" value={username} onChange={(event) => setUsername(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-white pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder="yourname" /></span></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium">Password</span><span className="relative block"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input autoComplete={setupRequired ? "new-password" : "current-password"} required minLength={setupRequired ? 12 : 1} maxLength={128} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-white pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" placeholder={setupRequired ? "At least 12 characters" : "Your password"} /></span></label>
          {setupRequired && <p className="text-[11px] leading-5 text-muted-foreground">Use at least 12 characters. There are no default credentials; the password is selected here and its hash is stored in Neon.</p>}
          {submitError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{submitError}</div>}
          <Button size="lg" className="w-full justify-center" disabled={mutation.isPending || setupStatus.isError}>{mutation.isPending ? "Please wait…" : setupRequired ? "Create organizer account" : "Sign in"}</Button>
        </form>}
        <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />Organizer access is checked by the API on every request. Initial setup closes after the first local account is created.</p>
      </section>
    </div>
  </main>;
}
