import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { ArrowLeft, Camera, Check, CheckCircle2, Clock3, KeyRound, LoaderCircle, ScanLine, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { checkInInputSchema, checkInResultSchema, contractJson, defaultScannerBranding, scannerAccentForegroundColor, scannerBrandingGetResponseSchema, scannerSessionSchema, type CheckInResult, type ScannerBranding, type ScannerSession } from "@eventdesk/contracts";
import { ScannerApiError, scannerApiContract } from "./lib/api";

interface RecentScan { id: string; name: string; result: CheckInResult["status"]; at: string }
const MARK = "/scanner/brand-mark.svg";

function ScannerDesk() {
  const { eventId = "" } = useParams();
  const [token, setToken] = useState("");
  const [session, setSession] = useState<ScannerSession | null>(null);
  const [branding, setBranding] = useState<ScannerBranding>(defaultScannerBranding);
  const [sessionError, setSessionError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const busyRef = useRef(false);
  const resumeRef = useRef(false);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  if (!readerRef.current) readerRef.current = new BrowserQRCodeReader();
  const storageKey = `eventdesk:scanner:${eventId}`;

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get("token");
    const savedToken = queryToken || sessionStorage.getItem(storageKey) || "";
    if (queryToken) {
      sessionStorage.setItem(storageKey, queryToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    setToken(savedToken);
  }, [eventId, storageKey]);

  useEffect(() => {
    if (!token) {
      setSessionError("Open the dedicated staff scanner URL shared by your organizer. Staff do not need an organizer username or password; the private URL is the access credential.");
      return;
    }
    let active = true;
    scannerApiContract(`/events/${eventId}/scanner-session`, token, scannerSessionSchema)
      .then(async (value) => {
        let eventBranding: ScannerBranding = defaultScannerBranding;
        try {
          eventBranding = (await scannerApiContract(`/events/${eventId}/scanner-branding`, token, scannerBrandingGetResponseSchema)).branding;
        } catch { /* Keep the safe default theme if branding cannot be read. */ }
        if (active) { setSession(value); setBranding(eventBranding); setSessionError(""); }
      })
      .catch((error: unknown) => {
        if (active) setSessionError(error instanceof ScannerApiError ? error.message : "Could not verify this scanner link.");
      });
    return () => { active = false; };
  }, [eventId, token]);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }, []);

  const processCode = useCallback(async (code: string) => {
    const clean = code.trim();
    if (!clean || !token || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setResult(null);
    setCameraError("");
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
    try {
      const response = await scannerApiContract(`/events/${eventId}/check-ins`, token, checkInResultSchema, {
        method: "POST",
        body: contractJson(checkInInputSchema, { token: clean }),
      });
      setResult(response);
      if (response.attendee) setRecent((old) => [{
        id: response.attendee!.id,
        name: response.attendee!.name,
        result: response.status,
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      }, ...old].slice(0, 5));
      if (response.status === "valid" && "vibrate" in navigator) navigator.vibrate?.(60);
    } catch (error) {
      setResult({ status: "invalid", message: error instanceof ScannerApiError ? error.message : "Check-in could not be recorded. Please retry.", attendee: null });
    } finally {
      setBusy(false);
      busyRef.current = false;
      setManualCode("");
      if (resumeRef.current) window.setTimeout(() => { void startCameraRef.current?.(); }, 1_700);
    }
  }, [eventId, token]);
  const processRef = useRef(processCode);
  processRef.current = processCode;

  const startCamera = useCallback(async () => {
    if (!videoRef.current || !token || busyRef.current) return;
    setCameraError("");
    resumeRef.current = true;
    try {
      const controls = await readerRef.current!.decodeFromVideoDevice(undefined, videoRef.current, (scanResult) => {
        if (scanResult) void processRef.current(scanResult.getText());
      });
      controlsRef.current = controls;
      setCameraOn(true);
    } catch (error) {
      resumeRef.current = false;
      setCameraOn(false);
      setCameraError(error instanceof Error && error.name === "NotAllowedError" ? "Camera access was blocked. Allow camera permissions or use manual code entry." : "No usable camera was found. You can still enter a guest code manually.");
    }
  }, [token]);
  const startCameraRef = useRef(startCamera);
  startCameraRef.current = startCamera;
  useEffect(() => () => { resumeRef.current = false; controlsRef.current?.stop(); }, []);

  if (!eventId) return <Navigate to="/" replace />;
  const resultTone = result?.status === "valid" ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-100" : result?.status === "duplicate" ? "border-amber-300/25 bg-amber-500/10 text-amber-100" : "border-rose-300/25 bg-rose-500/10 text-rose-100";
  const ResultIcon = result?.status === "valid" ? CheckCircle2 : result?.status === "duplicate" ? Clock3 : XCircle;
  const resultMessage = result?.status === "valid" ? "Guest check-in was recorded." : result?.status === "duplicate" ? "This guest was already checked in." : result?.message;
  const themeStyle = {
    "--scanner-background": branding.backgroundColor,
    "--scanner-panel": branding.panelColor,
    "--scanner-text": branding.textColor,
    "--scanner-muted": branding.mutedTextColor,
    "--scanner-accent": branding.accentColor,
    "--scanner-accent-foreground": scannerAccentForegroundColor(branding.accentColor),
  } as CSSProperties;

  return <main className="safe-area scanner-theme min-h-screen px-4 pb-8 pt-5 sm:px-6" style={themeStyle}>
    <div className="mx-auto max-w-[760px]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src={branding.logoDataUrl ?? MARK} className="h-10 w-10 shrink-0 rounded-xl bg-white/5 p-1 object-contain" alt={`${branding.brandName} logo`} />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold tracking-[.12em]">{branding.brandName}</p>
            {branding.brandTagline && <p className="scanner-muted mt-1 truncate font-mono text-[9px] uppercase tracking-[.15em]">{branding.brandTagline}</p>}
          </div>
        </div>
        <div className="scanner-muted inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-[10px] font-semibold"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />Staff access</div>
      </header>

      <section className="pb-5 pt-6 sm:pt-7">
        <p className="scanner-accent font-mono text-[10px] uppercase tracking-[.18em]">Live entrance desk</p>
        <h1 className="mt-2 break-words font-display text-3xl font-semibold tracking-[-.04em] sm:text-4xl">{session?.eventName || "Welcome guests."}</h1>
        <p className="scanner-muted scanner-wrap-anywhere mt-2 text-sm">{session ? `${session.label} · scan each guest’s event QR code` : "Staff access uses the private scanner URL—no organizer login is needed."}</p>
      </section>

      {sessionError ? <section className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-5"><div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" /><div><h2 className="font-semibold">Scanner access unavailable</h2><p className="mt-1 text-sm leading-6 text-rose-100/75">{sessionError}</p></div></div></section> : !session ? <div className="scanner-panel scanner-muted flex items-center gap-3 rounded-2xl border border-white/10 p-5 text-sm"><LoaderCircle className="scanner-accent h-4 w-4 animate-spin" />Verifying event access…</div> : <>
        <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black shadow-2xl shadow-black/20">
            <div className="relative aspect-[4/3] overflow-hidden bg-[#0a101b]">
              <video ref={videoRef} muted playsInline autoPlay className={`h-full w-full object-cover ${cameraOn ? "" : "hidden"}`} />
              {cameraOn ? <div className="pointer-events-none absolute inset-0"><div className="absolute left-1/2 top-[17%] aspect-square w-[74%] max-h-[68%] -translate-x-1/2 border border-white/70"><span className="scanner-accent-border absolute -left-px -top-px h-5 w-5 border-l-[3px] border-t-[3px]" /><span className="scanner-accent-border absolute -right-px -top-px h-5 w-5 border-r-[3px] border-t-[3px]" /><span className="scanner-accent-border absolute -bottom-px -left-px h-5 w-5 border-b-[3px] border-l-[3px]" /><span className="scanner-accent-border absolute -bottom-px -right-px h-5 w-5 border-b-[3px] border-r-[3px]" /><div className="scanline absolute inset-x-0 top-0 h-px" style={{ backgroundColor: branding.accentColor, boxShadow: `0 0 14px 3px ${branding.accentColor}72` }} /></div><p className="absolute bottom-4 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[.17em] text-white/75">Align QR inside the frame</p></div> : <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center"><div className="scanner-accent grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5"><ScanLine className="h-7 w-7" /></div><p className="mt-4 font-display text-lg font-semibold">Camera check-in</p><p className="mt-2 max-w-xs text-xs leading-5 text-white/55">Allow camera access to register arrivals instantly.</p></div>}
            </div>
            <div className="scanner-panel flex items-center justify-between gap-3 border-t border-white/10 p-3.5">
              <p className="scanner-muted min-w-0 truncate font-mono text-[10px]">{cameraOn ? "Camera active · point at guest QR" : cameraError || "Camera paused"}</p>
              {cameraOn ? <button onClick={() => { resumeRef.current = false; stopCamera(); }} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/5">Pause</button> : <button onClick={() => void startCamera()} className="scanner-button inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold"><Camera className="h-3.5 w-3.5" />Start camera</button>}
            </div>
          </div>

          <div className="space-y-4">
            {result ? <div aria-live="polite" className={`rounded-2xl border p-5 ${resultTone}`}><div className="flex items-start gap-3"><ResultIcon className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0"><p className="font-display text-lg font-semibold">{result.status === "valid" ? "Check-in complete" : result.status === "duplicate" ? "Already checked in" : "Not recognized"}</p><p className="mt-1 text-sm leading-5 opacity-80">{resultMessage}</p>{result.attendee && <div className="mt-4 border-t border-current/15 pt-3"><p className="break-words text-sm font-semibold">{result.attendee.name}</p><p className="mt-1 break-words text-xs opacity-75">{result.attendee.ticketType}{result.attendee.email ? ` · ${result.attendee.email}` : ""}</p></div>}</div></div></div> : <div className="scanner-panel rounded-2xl border border-white/10 p-5"><p className="font-display text-lg font-semibold">Ready at the gate</p><p className="scanner-muted mt-2 text-sm leading-6">A successful scan marks one guest as checked in. Duplicate scans are safely identified rather than counted twice.</p><div className="scanner-muted mt-4 flex items-center gap-2 text-xs"><Check className="h-3.5 w-3.5 text-emerald-400" />Changes sync to event analytics</div></div>}
            {busy && <div className="scanner-panel scanner-muted flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-xs"><LoaderCircle className="scanner-accent h-4 w-4 animate-spin" />Recording check-in…</div>}
            {cameraError && <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{cameraError}</div>}
          </div>
        </section>

        <section className="scanner-panel mt-5 rounded-2xl border border-white/10 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2"><KeyRound className="scanner-accent h-4 w-4" /><h2 className="text-sm font-semibold">Manual code entry</h2></div>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void processCode(manualCode); }}>
            <input autoComplete="off" className="scanner-input min-w-0 flex-1 rounded-xl border border-white/10 px-3.5 py-3 font-mono text-sm outline-none placeholder:opacity-55 focus:border-white/30" value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Paste guest QR code" disabled={busy} />
            <button className="scanner-button inline-flex shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-semibold disabled:opacity-50" disabled={busy || !manualCode.trim()}><ScanLine className="h-4 w-4" /><span className="hidden sm:inline">Check in</span></button>
          </form>
        </section>

        {recent.length > 0 && <section className="mt-6"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent scans</h2><span className="scanner-muted font-mono text-[10px]">THIS DEVICE</span></div><div className="scanner-panel divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">{recent.map((item) => <div key={`${item.id}-${item.at}`} className="flex items-center gap-3 px-4 py-3"><div className={`grid h-8 w-8 place-items-center rounded-full ${item.result === "valid" ? "bg-emerald-500/10 text-emerald-300" : item.result === "duplicate" ? "bg-amber-500/10 text-amber-200" : "bg-rose-500/10 text-rose-300"}`}><Check className="h-4 w-4" /></div><p className="flex-1 truncate text-xs font-medium">{item.name}</p><time className="scanner-muted font-mono text-[10px]">{item.at}</time></div>)}</div></section>}

        <footer className="scanner-muted mt-7 flex flex-col gap-1.5 border-t border-white/10 pt-4 text-center text-[10px] sm:flex-row sm:items-center sm:justify-between sm:text-left"><span className="scanner-wrap-anywhere min-w-0">Staff access · {session.label}</span><span className="font-mono">{session.expiresAt ? `LINK ENDS ${new Date(session.expiresAt).toLocaleDateString()}` : "LINK DOES NOT EXPIRE"}</span></footer>
      </>}
      <div className="scanner-muted mt-7 flex items-center justify-center gap-1.5 text-center text-[10px] opacity-70"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />Event-scoped staff access · Scan records stored in the event database</div>
    </div>
  </main>;
}

function ScannerNotFound() { return <main className="grid min-h-screen place-items-center p-6 text-center"><div><ArrowLeft className="mx-auto h-6 w-6 text-primary" /><h1 className="mt-3 font-display text-xl font-semibold">Open a dedicated event scanner link.</h1></div></main>; }
export default function App() { return <Routes><Route path="/:eventId" element={<ScannerDesk />} /><Route path="*" element={<ScannerNotFound />} /></Routes>; }
