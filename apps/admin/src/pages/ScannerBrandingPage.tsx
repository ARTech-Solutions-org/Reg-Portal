import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Eye, ImagePlus, Palette, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { contractJson, defaultScannerBranding, contrastRatio, relativeLuminance, scannerAccentForegroundColor, scannerBrandingGetResponseSchema, scannerBrandingPutResponseSchema, scannerBrandingSchema, type ScannerBranding } from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { useEventDashboard } from "@/hooks/useEventDashboard";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const MARK = "/scanner/brand-mark.svg";
const MAX_LOGO_BYTES = 256 * 1024;
const colorControls = [
  { key: "accentColor", label: "Accent / actions", detail: "Scan frame, primary actions and active labels" },
  { key: "backgroundColor", label: "Page background", detail: "Main scanner page surface" },
  { key: "panelColor", label: "Panel surface", detail: "Camera controls and secondary cards" },
  { key: "textColor", label: "Main text", detail: "Headings and primary information" },
  { key: "mutedTextColor", label: "Muted text", detail: "Supporting labels and instructions" },
] as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected logo could not be read."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The selected logo could not be read."));
    reader.readAsDataURL(file);
  });
}

function getContrastAdvice(fg: string, bg: string, label: string, bgLabel: string): string | null {
  if (!/^#[\da-fA-F]{6}$/.test(fg) || !/^#[\da-fA-F]{6}$/.test(bg)) return null;
  if (contrastRatio(fg, bg) >= 4.5) return null;
  const isFgLighter = relativeLuminance(fg) > relativeLuminance(bg);
  return `${label} is hard to read on ${bgLabel}. Try a ${isFgLighter ? "lighter" : "darker"} color.`;
}

export function ScannerBrandingPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const eventQuery = useEventDashboard(eventId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ScannerBranding>(defaultScannerBranding);
  const branding = useQuery({
    queryKey: ["scanner-branding", eventId],
    queryFn: () => apiContract(`/events/${eventId}/scanner-branding`, scannerBrandingGetResponseSchema),
    enabled: Boolean(eventId),
  });
  useEffect(() => { if (branding.data) setForm(branding.data.branding); }, [branding.data]);

  const save = useMutation({
    mutationFn: () => apiContract(`/events/${eventId}/scanner-branding`, scannerBrandingPutResponseSchema, {
      method: "PUT",
      body: contractJson(scannerBrandingSchema, form),
    }),
    onSuccess: async (saved) => {
      setForm(saved.branding);
      await queryClient.invalidateQueries({ queryKey: ["scanner-branding", eventId] });
      toast.success("Scanner branding saved for this event.");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save scanner branding."),
  });

  const dirty = Boolean(branding.data && JSON.stringify(form) !== JSON.stringify(branding.data.branding));
  const update = <K extends keyof ScannerBranding>(key: K, value: ScannerBranding[K]) => setForm((current) => ({ ...current, [key]: value }));
  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!("image/png" === file.type || file.type === "image/jpeg" || file.type === "image/webp")) {
      toast.error("Choose a PNG, JPEG or WebP logo.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Keep the logo under 256 KB for fast scanner loading.");
      return;
    }
    try {
      const logoDataUrl = await readFileAsDataUrl(file);
      if (logoDataUrl.length > 350_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logoDataUrl)) { toast.error("That logo file could not be used."); return; }
      setForm((current) => ({ ...current, logoDataUrl }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The selected logo could not be read.");
    }
  };

  return <div className="page-enter">
    <PageHeader eyebrow="Event / scanner appearance" title="Scanner design" description={`${eventQuery.data?.event.name ?? "Event"} · customize the staff-facing scanner without changing attendee data or staff access links.`} action={<Link to={`/admin/events/${eventId}/links`}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />Scanner links</Button></Link>} />
    <EventTabs eventId={eventId} />
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.85fr)]">
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Palette className="h-5 w-5" /></div><div><h2 className="panel-title">Event scanner identity</h2><p className="text-xs text-muted-foreground">Your changes are saved only to this event.</p></div></div>
          {branding.isLoading ? <p className="mt-6 text-sm text-muted-foreground">Loading event branding…</p> : branding.isError ? <div role="alert" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">Could not load scanner branding. Refresh the page and try again.</div> : <form className="mt-6 space-y-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label-caps mb-2 block">Brand name</span><input className="input-control" value={form.brandName} maxLength={60} onChange={(event) => update("brandName", event.currentTarget.value)} required /></label>
              <label className="block"><span className="label-caps mb-2 block">Descriptor</span><input className="input-control" value={form.brandTagline} maxLength={80} onChange={(event) => update("brandTagline", event.currentTarget.value)} placeholder="Event check-in" /></label>
            </div>

            <section className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white p-1.5"><img src={form.logoDataUrl ?? MARK} alt="" className="max-h-full max-w-full object-contain" /></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Logo</p><p className="mt-1 text-xs leading-5 text-muted-foreground">PNG, JPEG or WebP · maximum 256 KB. The logo is stored with this event's theme.</p></div>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void selectLogo(event)} aria-label="Upload a scanner logo" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" />Upload</Button>
              </div>
              {form.logoDataUrl && <Button className="mt-3" type="button" variant="ghost" size="sm" onClick={() => update("logoDataUrl", null)}>Remove custom logo</Button>}
            </section>

            <section><div className="mb-3"><h3 className="text-sm font-semibold">Color palette</h3><p className="mt-1 text-xs text-muted-foreground">Choose a brand palette; scan outcomes remain green, amber and red for clarity.</p></div><div className="divide-y divide-border rounded-2xl border border-border">
              {colorControls.map(({ key, label, detail }) => {
                  const issues: string[] = [];
                  if (key === "textColor") {
                    const i1 = getContrastAdvice(form.textColor, form.backgroundColor, "Main text", "background");
                    const i2 = getContrastAdvice(form.textColor, form.panelColor, "Main text", "panels");
                    if (i1) issues.push(i1);
                    if (i2) issues.push(i2);
                  } else if (key === "mutedTextColor") {
                    const i1 = getContrastAdvice(form.mutedTextColor, form.backgroundColor, "Muted text", "background");
                    const i2 = getContrastAdvice(form.mutedTextColor, form.panelColor, "Muted text", "panels");
                    if (i1) issues.push(i1);
                    if (i2) issues.push(i2);
                  } else if (key === "accentColor") {
                    const i1 = getContrastAdvice(form.accentColor, form.backgroundColor, "Accent", "background");
                    if (i1) issues.push(i1);
                  } else if (key === "backgroundColor") {
                    const i1 = getContrastAdvice(form.textColor, form.backgroundColor, "Main text", "background");
                    const i2 = getContrastAdvice(form.mutedTextColor, form.backgroundColor, "Muted text", "background");
                    const i3 = getContrastAdvice(form.accentColor, form.backgroundColor, "Accent", "background");
                    if (i1) issues.push(i1);
                    if (i2) issues.push(i2);
                    if (i3) issues.push(i3);
                  } else if (key === "panelColor") {
                    const i1 = getContrastAdvice(form.textColor, form.panelColor, "Main text", "panels");
                    const i2 = getContrastAdvice(form.mutedTextColor, form.panelColor, "Muted text", "panels");
                    if (i1) issues.push(i1);
                    if (i2) issues.push(i2);
                  }
                  
                  return <div key={key} className="flex flex-col p-3.5">
                    <label className="flex items-center gap-4">
                      <input type="color" value={form[key]} onChange={(event) => update(key, event.currentTarget.value)} className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-border bg-white p-1" aria-label={label} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span>
                      </span>
                      <code className="font-mono text-[11px] text-muted-foreground">{form[key].toUpperCase()}</code>
                    </label>
                    {issues.length > 0 && <div className="mt-2 ml-14 space-y-1">
                      {issues.map((issue, i) => <p key={i} className="text-xs text-amber-600">{issue}</p>)}
                    </div>}
                  </div>;
                })}
              </div>
            </section>
            
            <div className="flex flex-wrap gap-2 border-t border-border pt-4"><Button type="submit" disabled={!dirty || save.isPending || !form.brandName.trim()}><Save className="h-4 w-4" />{save.isPending ? "Saving…" : "Save scanner design"}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={() => setForm(defaultScannerBranding)}><RotateCcw className="h-4 w-4" />Reset to default</Button>{branding.data?.updatedAt && <span className="self-center text-xs text-muted-foreground">Last saved {new Date(branding.data.updatedAt).toLocaleString()}</span>}</div>
          </form>}
        </CardContent>
      </Card>

      <aside className="xl:sticky xl:top-24">
        <div className="mb-3 flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /><h2 className="panel-title">Staff preview</h2><span className="ml-auto font-mono text-[10px] text-muted-foreground">MOBILE</span></div>
        <div className="mx-auto max-w-[430px] overflow-hidden rounded-[28px] border border-white/10 p-4 shadow-2xl" style={{ backgroundColor: form.backgroundColor, color: form.textColor }}>
          <header className="flex items-center justify-between gap-3 border-b border-white/10 pb-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/10 p-1.5"><img src={form.logoDataUrl ?? MARK} alt="" className="max-h-full max-w-full object-contain" /></div><div className="min-w-0"><p className="truncate text-xs font-bold tracking-[.14em]">{form.brandName || "Brand name"}</p>{form.brandTagline && <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[.12em]" style={{ color: form.mutedTextColor }}>{form.brandTagline}</p>}</div></div><span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2 py-1.5 text-[9px] font-semibold" style={{ color: form.mutedTextColor }}><ShieldCheck className="h-3 w-3 text-emerald-400" />Staff</span></header>
          <section className="pb-4 pt-5"><p className="font-mono text-[9px] uppercase tracking-[.18em]" style={{ color: form.accentColor }}>Live entrance desk</p><h3 className="mt-2 truncate font-display text-2xl font-semibold">{eventQuery.data?.event.name ?? "Sample event"}</h3><p className="mt-1 text-xs" style={{ color: form.mutedTextColor }}>Front gate · scan each guest's event QR code</p></section>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black"><div className="relative grid aspect-[4/3] place-items-center"><div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/5" style={{ color: form.accentColor }}><Camera className="h-6 w-6" /></div><div className="pointer-events-none absolute left-1/2 top-[19%] aspect-square w-[66%] max-h-[62%] -translate-x-1/2 border border-white/70"><span className="absolute -left-px -top-px h-4 w-4 border-l-[3px] border-t-[3px]" style={{ borderColor: form.accentColor }} /><span className="absolute -right-px -top-px h-4 w-4 border-r-[3px] border-t-[3px]" style={{ borderColor: form.accentColor }} /><span className="absolute -bottom-px -left-px h-4 w-4 border-b-[3px] border-l-[3px]" style={{ borderColor: form.accentColor }} /><span className="absolute -bottom-px -right-px h-4 w-4 border-b-[3px] border-r-[3px]" style={{ borderColor: form.accentColor }} /></div></div><div className="flex items-center justify-between gap-2 border-t border-white/10 p-3" style={{ backgroundColor: form.panelColor }}><span className="truncate font-mono text-[9px]" style={{ color: form.mutedTextColor }}>Camera ready · point at guest QR</span><span className="rounded-lg px-3 py-2 text-[10px] font-semibold" style={{ backgroundColor: form.accentColor, color: scannerAccentForegroundColor(form.accentColor) }}>Start</span></div></div>
          <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-500/10 p-4 text-emerald-100"><p className="text-xs font-semibold">Check-in complete</p><p className="mt-1 text-[11px] text-emerald-100/75">A clear result with attendee details appears here.</p></div>
          <p className="mt-4 text-center font-mono text-[9px]" style={{ color: form.mutedTextColor }}>PREVIEW ONLY · SCAN RESULTS KEEP THEIR STATUS COLORS</p>
        </div>
        <p className="mx-auto mt-3 max-w-[430px] text-xs leading-5 text-muted-foreground">Changes appear on the staff scanner after you save. Existing scanner links stay the same.</p>
      </aside>
    </div>
  </div>;
}
