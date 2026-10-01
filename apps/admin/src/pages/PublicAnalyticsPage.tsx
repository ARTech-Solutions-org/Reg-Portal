import { useParams } from "react-router-dom";
import { CircleCheck, TimerReset, UsersRound } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { eventDashboardSchema } from "@eventdesk/contracts";
import { apiContract } from "@/lib/api";

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function getForegroundHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * (r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4) +
                    0.7152 * (g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4) +
                    0.0722 * (b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4);
  return luminance > 0.179 ? "0 0% 0%" : "0 0% 100%";
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PublicAnalyticsPage() {
  const { token = "" } = useParams();
  
  const query = useQuery({
    queryKey: ["public-event-dashboard", token],
    queryFn: () => apiContract(`/events/public/share?token=${token}`, eventDashboardSchema),
    enabled: Boolean(token),
    refetchInterval: 20_000
  });

  const event = query.data?.event;
  const summary = query.data?.summary;
  const branding = query.data?.branding;
  
  useEffect(() => {
    const root = document.documentElement;
    if (branding) {
      root.style.setProperty("--primary", hexToHsl(branding.accentColor));
      root.style.setProperty("--primary-foreground", getForegroundHsl(branding.accentColor));
      root.style.setProperty("--background", hexToHsl(branding.backgroundColor));
      root.style.setProperty("--card", hexToHsl(branding.panelColor));
      root.style.setProperty("--foreground", hexToHsl(branding.textColor));
      root.style.setProperty("--muted-foreground", hexToHsl(branding.mutedTextColor));
    } else {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--background");
      root.style.removeProperty("--card");
      root.style.removeProperty("--foreground");
      root.style.removeProperty("--muted-foreground");
    }
  }, [branding]);
  
  if (!event || !summary) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center bg-gray-50/50">
        <Card className="w-full max-w-sm">
          <CardContent className="p-8 text-sm text-muted-foreground">
            {query.isLoading ? "Loading analytics…" : "Invalid or expired share link."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = [
    { label: "Registered attendees", value: summary.total, icon: UsersRound },
    { label: "Checked in", value: summary.checkedIn, icon: CircleCheck },
    { label: "Remaining", value: summary.remaining, icon: TimerReset }
  ];

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="page-enter max-w-5xl mx-auto p-6 md:p-12">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold">{event.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Live attendance performance</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.label}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary">
                  <row.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="label-caps">{row.label}</p>
                  <p className="mt-1 font-display text-2xl font-semibold">{row.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Arrival rhythm</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Hourly counts over the trailing twelve-hour window.</p>
          </CardHeader>
          <CardContent>
            <div className="h-[340px]">
              {summary.checkedIn > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.hourly} margin={{ top: 12, right: 18, bottom: 0, left: -12 }}>
                    <defs>
                      <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3468dc" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#3468dc" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf3" />
                    <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#7d8797" }} />
                    <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#7d8797" }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" name="Check-ins" stroke="#3468dc" fill="url(#analyticsFill)" strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                  No check-ins have been recorded for this event.
                </div>
              )}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {summary.rate}% of registered guests are checked in.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
