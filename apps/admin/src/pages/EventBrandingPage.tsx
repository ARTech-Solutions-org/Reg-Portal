import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Palette, RotateCcw, Save } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { contractJson, defaultEventAdminBranding, eventAdminBrandingGetResponseSchema, eventAdminBrandingPutResponseSchema, eventAdminBrandingSchema, contrastRatio, relativeLuminance, type EventAdminBranding } from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EventTabs } from "@/components/PageHeader";
import { useEventDashboard } from "@/hooks/useEventDashboard";

const MAX_LOGO_BYTES = 256 * 1024;
const colorControls = [
  { key: "accentColor", label: "Primary accent", detail: "Buttons and active states" },
  { key: "backgroundColor", label: "Page background", detail: "Main dashboard surface" },
  { key: "panelColor", label: "Panel surface", detail: "Cards and sidebars" },
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

export function EventBrandingPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const eventQuery = useEventDashboard(eventId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<EventAdminBranding>(defaultEventAdminBranding);
  
  const branding = useQuery({
    queryKey: ["event-admin-branding", eventId],
    queryFn: () => apiContract(`/events/${eventId}/event-admin-branding`, eventAdminBrandingGetResponseSchema),
    enabled: Boolean(eventId),
  });
  
  useEffect(() => { if (branding.data) setForm(branding.data.branding); }, [branding.data]);

  const save = useMutation({
    mutationFn: () => apiContract(`/events/${eventId}/event-admin-branding`, eventAdminBrandingPutResponseSchema, {
      method: "PUT",
      body: contractJson(eventAdminBrandingSchema, form),
    }),
    onSuccess: async (saved) => {
      setForm(saved.branding);
      await queryClient.invalidateQueries({ queryKey: ["event-admin-branding", eventId] });
      toast.success("Event dashboard branding saved.");
      // Force reload to apply new CSS variables globally
      window.location.reload();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save event branding."),
  });

  const dirty = Boolean(branding.data && JSON.stringify(form) !== JSON.stringify(branding.data.branding));
  const update = <K extends keyof EventAdminBranding>(key: K, value: EventAdminBranding[K]) => setForm((current) => ({ ...current, [key]: value }));
  
  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!("image/png" === file.type || file.type === "image/jpeg" || file.type === "image/webp")) {
      toast.error("Choose a PNG, JPEG or WebP logo.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Keep the logo under 256 KB.");
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
    <PageHeader eyebrow="Event settings" title="Event dashboard branding" description={`${eventQuery.data?.event.name ?? "Event"} · customize the look of the dashboard and public links for this event.`} action={<Link to={`/admin/events/${eventId}`}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />Back to event</Button></Link>} />
    <EventTabs eventId={eventId} />
    <div className="grid items-start gap-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="panel-title">Dashboard appearance</h2>
              <p className="text-xs text-muted-foreground">Changes here affect the entire project dashboard.</p>
            </div>
          </div>
          
          {branding.isLoading ? <p className="mt-6 text-sm text-muted-foreground">Loading project branding…</p> : branding.isError ? <div role="alert" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">Could not load project branding. Refresh the page and try again.</div> : <form className="mt-6 space-y-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
            <section className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white p-1.5">
                  {form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo" className="max-h-full max-w-full object-contain" /> : <div className="text-[10px] text-muted-foreground">No Logo</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Custom Logo</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">PNG, JPEG or WebP · maximum 256 KB. Appears on the top left of the dashboard.</p>
                </div>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void selectLogo(event)} aria-label="Upload a logo" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" />Upload</Button>
              </div>
              {form.logoDataUrl && <Button className="mt-3" type="button" variant="ghost" size="sm" onClick={() => update("logoDataUrl", null)}>Remove custom logo</Button>}
            </section>

            <section>
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Color palette</h3>
                <p className="mt-1 text-xs text-muted-foreground">Choose a brand palette for the dashboard.</p>
              </div>
              <div className="divide-y divide-border rounded-2xl border border-border">
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

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button type="submit" disabled={!dirty || save.isPending}>
                <Save className="h-4 w-4" />{save.isPending ? "Saving…" : "Save branding"}
              </Button>
              <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setForm(defaultEventAdminBranding)}>
                <RotateCcw className="h-4 w-4" />Reset to default
              </Button>
              {branding.data?.updatedAt && <span className="self-center text-xs text-muted-foreground">Last saved {new Date(branding.data.updatedAt).toLocaleString()}</span>}
            </div>
          </form>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
