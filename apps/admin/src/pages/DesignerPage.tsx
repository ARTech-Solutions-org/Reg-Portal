import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import QRCode from "qrcode";
import { Rnd } from "react-rnd";
import { ArrowDownToLine, ArrowLeft, ArrowLeftRight, FileImage, FileText, ImagePlus, LoaderCircle, LockKeyhole, Minus, MousePointer2, Plus, QrCode, Save, Trash2, Type, UploadCloud } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { apiErrorResponseSchema, attendeeFieldListSchema, attendeeListSchema, badgeLayoutGetResponseSchema, badgeLayoutPutResponseSchema, badgeLayoutSchema, badgeTemplateGetResponseSchema, badgeTemplatePutResponseSchema, badgeTemplateUploadMetadataSchema, contractJson, eventSummarySchema, qrDataResponseSchema, type Attendee, type BadgeElement, type BadgeLayout, type BadgeLayoutGetResponse, type BadgeTemplateGetResponse, type EventSummary } from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const DRAG_TYPE = "application/x-eventdesk-badge-element";
const initialElements: BadgeElement[] = [
  { id: "starter-name", kind: "text", field: "name", x: 0.06, y: 0.1, width: 0.58, height: 0.08, fontSize: 24, color: "#132035" },
  { id: "starter-type", kind: "text", field: "ticketType", x: 0.06, y: 0.2, width: 0.48, height: 0.05, fontSize: 11, color: "#506079" },
  { id: "starter-qr", kind: "qr", x: 0.69, y: 0.1, width: 0.24, height: 0.24 },
];
const freshLayout = (): BadgeLayout => ({ pageIndex: 0, pageWidth: 612, pageHeight: 792, elements: initialElements.map((item) => ({ ...item })) });
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const fieldLabels: Record<string, string> = { name: "Guest name", email: "Email address", ticketType: "Ticket type", eventName: "Event name", custom: "Custom text", static: "Static text" };

type FieldSpec = { kind: BadgeElement["kind"]; field?: BadgeElement["field"]; text?: string };
function labelForField(field: BadgeElement["field"]): string {
  if (field?.startsWith("custom:")) return field.slice("custom:".length);
  return fieldLabels[field ?? ""] ?? "Text";
}
function valueForField(field: BadgeElement["field"], attendee: Attendee | undefined, eventName: string | undefined, text?: string): string {
  if (!field) return text ?? "Text";
  if (field.startsWith("custom:")) {
    const key = field.slice("custom:".length);
    return attendee?.customFields[key] || `[${key}]`;
  }
  if (field === "custom" || field === "static") return text ?? (field === "custom" ? "Your text" : "Static text");
  if (field === "name") return attendee?.name ?? "Alex Morgan";
  if (field === "email") return attendee?.email ?? "alex@example.com";
  if (field === "ticketType") return attendee?.ticketType ?? "General admission";
  return eventName ?? "Event name";
}
function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Image data is invalid.");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function DesignerPage() {
  const { eventId = "" } = useParams();
  const client = useQueryClient();
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [renderError, setRenderError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [layout, setLayout] = useState<BadgeLayout>(freshLayout);
  const [selectedId, setSelectedId] = useState<string | null>("starter-name");
  const [attendeeId, setAttendeeId] = useState("");
  const [saving, setSaving] = useState(false);
  const savedLayout = useQuery<BadgeLayoutGetResponse>({ queryKey: ["badge-layout", eventId], queryFn: () => apiContract(`/events/${eventId}/badge-layout`, badgeLayoutGetResponseSchema), enabled: Boolean(eventId) });
  const templateQuery = useQuery<BadgeTemplateGetResponse>({ queryKey: ["badge-template", eventId], queryFn: () => apiContract(`/events/${eventId}/badge-template`, badgeTemplateGetResponseSchema), enabled: Boolean(eventId) });
  const fieldsQuery = useQuery<string[]>({ queryKey: ["attendee-fields", eventId], queryFn: () => apiContract(`/events/${eventId}/attendees/fields`, attendeeFieldListSchema), enabled: Boolean(eventId) });
  const attendees = useQuery<Attendee[]>({ queryKey: ["attendees", eventId, "designer"], queryFn: () => apiContract(`/events/${eventId}/attendees`, attendeeListSchema), enabled: Boolean(eventId) });
  const eventQuery = useQuery<EventSummary>({ queryKey: ["event", eventId], queryFn: () => apiContract(`/events/${eventId}`, eventSummarySchema), enabled: Boolean(eventId) });
  const savedTemplate = templateQuery.data?.template ?? null;
  const selected = useMemo(() => attendees.data?.find((attendee) => attendee.id === attendeeId), [attendees.data, attendeeId]);
  const customKeys = useMemo(() => [...new Set([...(fieldsQuery.data ?? []), ...(attendees.data?.flatMap((attendee) => Object.keys(attendee.customFields)) ?? [])])].sort((left, right) => left.localeCompare(right)), [fieldsQuery.data, attendees.data]);
  const selectedElement = layout.elements.find((element) => element.id === selectedId) ?? null;

  useEffect(() => {
    if (savedLayout.data?.layout) {
      setLayout(savedLayout.data.layout);
      setSelectedId(savedLayout.data.layout.elements[0]?.id ?? null);
    }
  }, [savedLayout.data]);

  useEffect(() => {
    setTemplateBytes(null);
    setFileName("");
    setPageCount(1);
    setTemplateError("");
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    if (!savedTemplate) {
      setTemplateBytes(null);
      setFileName("");
      setPageCount(1);
      setTemplateError("");
      return;
    }
    setTemplateBytes(null);
    setFileName(savedTemplate.fileName);
    setPageCount(savedTemplate.pageCount);
    setTemplateError("");
    const restore = async () => {
      const response = await fetch(`/api/events/${eventId}/badge-template/file`, {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = apiErrorResponseSchema.safeParse(payload);
        throw new Error(parsed.success ? parsed.data.error : "The saved PDF template could not be downloaded.");
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("The template service did not return a PDF file.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("The saved file is not a supported PDF template.");
      }
      if (!cancelled) setTemplateBytes(bytes);
    };
    void restore().catch((error: unknown) => {
      if (!cancelled) setTemplateError(error instanceof Error ? error.message : "Could not restore the saved PDF template.");
    });
    return () => { cancelled = true; };
  }, [savedTemplate?.fileName, savedTemplate?.pageCount, eventId]);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setDisplaySize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!templateBytes || !canvasRef.current) {
      setRenderError("");
      setRendering(false);
      return;
    }
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let renderTask: RenderTask | undefined;
    setRendering(true);
    setRenderError("");
    const render = async () => {
      try {
        loadingTask = getDocument({ data: templateBytes.slice() });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const pageNumber = Math.min(layout.pageIndex + 1, pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1.45 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("Could not draw this PDF page.");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setLayout((current) => ({ ...current, pageIndex: pageNumber - 1, pageWidth: natural.width, pageHeight: natural.height }));
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled) setRenderError(error instanceof Error ? error.message : "Could not render the PDF.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    };
    void render();
    return () => { cancelled = true; renderTask?.cancel(); void loadingTask?.destroy(); };
  }, [templateBytes, layout.pageIndex]);

  const updateElement = useCallback((id: string, patch: Partial<BadgeElement>) => {
    setLayout((current) => ({ ...current, elements: current.elements.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }, []);

  const addElement = useCallback((spec: FieldSpec, x = 0.12, y = 0.36) => {
    const isQr = spec.kind === "qr";
    const size = isQr ? { width: 0.24, height: 0.24 } : spec.kind === "image" ? { width: 0.22, height: 0.17 } : { width: 0.5, height: 0.07 };
    const element: BadgeElement = {
      id: crypto.randomUUID(), kind: spec.kind, field: spec.field,
      text: spec.text ?? (spec.field === "custom" || spec.field === "static" ? "Your text" : undefined),
      x: clamp(x), y: clamp(y), ...size,
      fontSize: 16, color: "#132035",
    };
    setLayout((current) => ({ ...current, elements: [...current.elements, element] }));
    setSelectedId(element.id);
  }, []);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Support dragging and dropping image files from the OS directly onto the canvas
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file && (file.type === "image/png" || file.type === "image/jpeg")) {
        const dropX = clamp((event.clientX - rect.left) / rect.width - 0.11);
        const dropY = clamp((event.clientY - rect.top) / rect.height - 0.085);
        if (file.size > 1_000_000) { toast.error("Badge images must be under 1 MB."); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          const element: BadgeElement = { id: crypto.randomUUID(), kind: "image", field: "static", text: "Image", x: dropX, y: dropY, width: 0.22, height: 0.17, imageDataUrl: dataUrl };
          setLayout((current) => ({ ...current, elements: [...current.elements, element] }));
          setSelectedId(element.id);
        };
        reader.readAsDataURL(file);
        return;
      } else {
        toast.error("Please drop a valid PNG or JPG image.");
        return;
      }
    }

    // Support dragging elements from the palette
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    try {
      const spec = JSON.parse(raw) as FieldSpec;
      const size = spec.kind === "qr" ? 0.24 : 0.5;
      addElement(spec, clamp((event.clientX - rect.left) / rect.width - size / 2), clamp((event.clientY - rect.top) / rect.height - size / 2));
    } catch { toast.error("That design element could not be added."); }
  };

  const setTemplate = async (candidate: File | undefined) => {
    if (!candidate) return;
    if (candidate.type !== "application/pdf" && !candidate.name.toLowerCase().endsWith(".pdf")) { toast.error("Choose a PDF template file."); return; }
    if (candidate.size > 20 * 1024 * 1024) { toast.error("PDF templates must be under 20 MB."); return; }
    setUploadingTemplate(true);
    let loadingTask: PDFDocumentLoadingTask | undefined;
    try {
      const bytes = new Uint8Array(await candidate.arrayBuffer());
      loadingTask = getDocument({ data: bytes.slice() });
      const pdf = await loadingTask.promise;
      const firstPage = await pdf.getPage(1);
      const pageSize = firstPage.getViewport({ scale: 1 });
      const metadata = badgeTemplateUploadMetadataSchema.parse({ fileName: candidate.name, pageCount: pdf.numPages, pageWidth: pageSize.width, pageHeight: pageSize.height });
      setTemplateBytes(bytes);
      setFileName(metadata.fileName);
      setPageCount(metadata.pageCount);
      setTemplateError("");
      setLayout((current) => ({ ...current, pageIndex: 0, pageWidth: metadata.pageWidth, pageHeight: metadata.pageHeight }));
      const result = await apiContract(`/events/${eventId}/badge-template`, badgeTemplatePutResponseSchema, {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "X-File-Name": encodeURIComponent(metadata.fileName),
          "X-Pdf-Page-Count": String(metadata.pageCount),
          "X-Pdf-Page-Width": String(metadata.pageWidth),
          "X-Pdf-Page-Height": String(metadata.pageHeight),
        },
        body: bytes,
      });
      client.setQueryData<BadgeTemplateGetResponse>(["badge-template", eventId], { template: result.template });
      toast.success("PDF template saved for this event.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Could not save the PDF template.";
      setTemplateError(message);
      toast.error(message);
    } finally {
      await loadingTask?.destroy().catch(() => undefined);
      setUploadingTemplate(false);
    }
  };

  const addImage = (candidate: File | undefined) => {
    if (!candidate) return;
    if (candidate.type !== "image/png" && candidate.type !== "image/jpeg") { toast.error("Choose a PNG or JPG image."); return; }
    if (candidate.size > 1_000_000) { toast.error("Badge images must be under 1 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const element: BadgeElement = { id: crypto.randomUUID(), kind: "image", field: "static", text: "Image", x: 0.12, y: 0.36, width: 0.22, height: 0.17, imageDataUrl: dataUrl };
      setLayout((current) => ({ ...current, elements: [...current.elements, element] }));
      setSelectedId(element.id);
    };
    reader.readAsDataURL(candidate);
  };

  const saveLayout = useMutation({
    mutationFn: () => apiContract(`/events/${eventId}/badge-layout`, badgeLayoutPutResponseSchema, { method: "PUT", body: contractJson(badgeLayoutSchema, layout) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["badge-layout", eventId] }); toast.success("Badge layout saved to this event."); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save layout."),
  });

  const exportPdf = async () => {
    setSaving(true);
    try {
      let pdf: PDFDocument;
      if (templateBytes) pdf = await PDFDocument.load(templateBytes);
      else { pdf = await PDFDocument.create(); pdf.addPage([layout.pageWidth, layout.pageHeight]); }
      const page = pdf.getPages()[Math.min(layout.pageIndex, pdf.getPageCount() - 1)] ?? pdf.getPages()[0]!;
      const width = page.getWidth();
      const height = page.getHeight();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const attendee = selected;
      const sampleQr = attendee
        ? (await apiContract(`/events/${eventId}/attendees/${attendee.id}/qr`, qrDataResponseSchema)).qrDataUrl
        : await QRCode.toDataURL("EVENTDESK-DESIGN-PREVIEW", { errorCorrectionLevel: "M", margin: 1, width: 400, color: { dark: "#132035", light: "#FFFFFF" } });
      for (const element of layout.elements) {
        const x = element.x * width;
        const y = height - (element.y + element.height) * height;
        const drawWidth = element.width * width;
        const drawHeight = element.height * height;
        if (element.kind === "qr") {
          const image = await pdf.embedPng(bytesFromDataUrl(sampleQr));
          page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
        } else if (element.kind === "image" && element.imageDataUrl) {
          const bytes = bytesFromDataUrl(element.imageDataUrl);
          const image = element.imageDataUrl.startsWith("data:image/jpeg") || element.imageDataUrl.startsWith("data:image/jpg") ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
          page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
        } else if (element.kind === "text") {
          const content = valueForField(element.field, attendee, eventQuery.data?.name, element.text);
          const color = element.color ?? "#132035";
          const pdfColor = rgb(parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255);
          page.drawText(content, { x, y: y + Math.max(0, drawHeight - (element.fontSize ?? 16)), size: element.fontSize ?? 16, font, color: pdfColor, maxWidth: drawWidth, lineHeight: (element.fontSize ?? 16) * 1.2 });
        }
      }
      const bytes = await pdf.save();
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${attendee ? attendee.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : "eventdesk-badge-preview"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(attendee ? `Badge exported for ${attendee.name}.` : "Badge preview PDF exported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export this badge PDF.");
    } finally { setSaving(false); }
  };

  const palette: Array<{ key: string; label: string; spec: FieldSpec; icon: typeof Type }> = [
    { key: "qr", label: "QR code", spec: { kind: "qr" }, icon: QrCode },
    { key: "name", label: "Guest name", spec: { kind: "text", field: "name" }, icon: Type },
    { key: "email", label: "Email", spec: { kind: "text", field: "email" }, icon: Type },
    { key: "ticketType", label: "Ticket type", spec: { kind: "text", field: "ticketType" }, icon: Type },
    { key: "eventName", label: "Event name", spec: { kind: "text", field: "eventName" }, icon: Type },
    { key: "custom", label: "Custom text", spec: { kind: "text", field: "custom", text: "Your text" }, icon: Type },
    ...customKeys.map((key) => ({ key: `custom:${key}`, label: key, spec: { kind: "text" as const, field: `custom:${key}` as BadgeElement["field"] }, icon: Type })),
  ];

  return <div className="page-enter"><PageHeader eyebrow="Design studio / event badge" title="Badge designer" description="Map built-in or custom attendee data onto a PDF badge and export a guest-specific copy." action={<div className="flex gap-2"><Link to={`/admin/events/${eventId}`}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />Event</Button></Link><Button onClick={() => saveLayout.mutate()} disabled={saveLayout.isPending || uploadingTemplate}><Save className="h-4 w-4" />{saveLayout.isPending ? "Saving…" : "Save layout"}</Button></div>} /><EventTabs eventId={eventId} />
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white px-4 py-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5 text-emerald-600" />Layout saves to this event</div><span className="hidden h-4 w-px bg-border sm:block" /><div className="flex items-center gap-2 text-xs text-muted-foreground"><FileImage className="h-3.5 w-3.5 text-primary" />{templateQuery.isLoading ? "Checking saved PDF…" : savedTemplate ? "PDF template restored from durable storage" : "PDF template saved durably per event"}</div>{templateError && <span role="status" className="max-w-xs truncate text-[10px] text-destructive" title={templateError}>{templateError}</span>}<div className="ml-auto flex items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"><UploadCloud className="h-4 w-4" />{uploadingTemplate ? "Saving PDF…" : fileName ? "Replace PDF" : "Upload PDF template"}<input hidden disabled={uploadingTemplate} type="file" accept="application/pdf,.pdf" onChange={(event) => { void setTemplate(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><Button size="sm" onClick={() => void exportPdf()} disabled={saving || uploadingTemplate || templateQuery.isLoading || Boolean(savedTemplate && !templateBytes)}>{saving ? <><LoaderCircle className="h-4 w-4 animate-spin" />Exporting…</> : <><ArrowDownToLine className="h-4 w-4" />Export badge PDF</>}</Button></div></div>
    <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_250px]">
      <Card className="h-fit"><CardContent className="p-4"><p className="label-caps">Drag onto badge</p><div className="mt-3 space-y-2">{palette.map((item) => <button key={item.key} draggable onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item.spec)); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addElement(item.spec)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-white p-3 text-left text-xs font-semibold transition hover:border-primary/40 hover:bg-accent/50"><span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-primary"><item.icon className="h-4 w-4" /></span>{item.label}<Plus className="ml-auto h-3.5 w-3.5 text-muted-foreground" /></button>)}</div><label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-3 text-xs font-semibold hover:border-primary/50"><span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-primary"><ImagePlus className="h-4 w-4" /></span>Add image<input hidden type="file" accept="image/png,image/jpeg" onChange={(event) => addImage(event.target.files?.[0])} /></label><p className="mt-4 text-[10px] leading-5 text-muted-foreground">Click to add or drag an item to the canvas. Custom fields appear after they are added or imported for this event.</p></CardContent></Card>

      <Card className="min-w-0 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-4 py-3"><div className="flex items-center gap-3"><p className="text-xs font-semibold">Page {layout.pageIndex + 1} <span className="font-normal text-muted-foreground">of {pageCount}</span></p><Badge tone={templateBytes ? "success" : "neutral"}>{fileName || "Blank badge"}</Badge></div><div className="flex items-center gap-2"><button className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-40" disabled={layout.pageIndex <= 0} onClick={() => setLayout((current) => ({ ...current, pageIndex: current.pageIndex - 1 }))} aria-label="Previous page"><ArrowLeft className="h-3.5 w-3.5" /></button><button className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-40" disabled={layout.pageIndex >= pageCount - 1} onClick={() => setLayout((current) => ({ ...current, pageIndex: current.pageIndex + 1 }))} aria-label="Next page"><ArrowLeftRight className="h-3.5 w-3.5" /></button><span className="mx-1 h-5 w-px bg-border" /><button className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-40" disabled={zoom <= 0.65} onClick={() => setZoom((current) => Math.max(0.65, Math.round((current - 0.1) * 10) / 10))} aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button><span className="w-10 text-center font-mono text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span><button className="grid h-8 w-8 place-items-center rounded-lg border border-border disabled:opacity-40" disabled={zoom >= 1.5} onClick={() => setZoom((current) => Math.min(1.5, Math.round((current + 0.1) * 10) / 10))} aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button></div></div><div className="surface-grid min-h-[650px] overflow-auto p-5 sm:p-8"><div ref={previewRef} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={handleDrop} className="relative mx-auto overflow-hidden bg-white shadow-[0_14px_50px_rgba(21,36,58,.17)]" style={{ aspectRatio: `${layout.pageWidth}/${layout.pageHeight}`, width: `${Math.round(680 * zoom)}px`, maxWidth: zoom <= 1 ? "100%" : "none" }}>
        {templateBytes ? <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" /> : <div className="absolute inset-0 bg-white"><div className="absolute inset-4 border border-dashed border-slate-100" /><div className="absolute left-7 top-7 font-mono text-[9px] uppercase tracking-[.15em] text-slate-300">Badge preview</div></div>}
        {layout.elements.map((element) => <Rnd key={element.id} bounds="parent" position={{ x: element.x * displaySize.width, y: element.y * displaySize.height }} size={{ width: Math.max(26, element.width * displaySize.width), height: Math.max(22, element.height * displaySize.height) }} minWidth={28} minHeight={24} onDragStart={() => setSelectedId(element.id)} onDragStop={(_event, position) => updateElement(element.id, { x: clamp(position.x / Math.max(1, displaySize.width)), y: clamp(position.y / Math.max(1, displaySize.height)) })} onResizeStop={(_event, _direction, ref, _delta, position) => updateElement(element.id, { x: clamp(position.x / Math.max(1, displaySize.width)), y: clamp(position.y / Math.max(1, displaySize.height)), width: clamp(ref.offsetWidth / Math.max(1, displaySize.width)), height: clamp(ref.offsetHeight / Math.max(1, displaySize.height)) })} onClick={() => setSelectedId(element.id)} style={{ zIndex: selectedId === element.id ? 20 : 10, border: selectedId === element.id ? "1px solid #3468dc" : "1px dashed rgba(52,104,220,.38)", background: selectedId === element.id ? "rgba(233,241,255,.15)" : "rgba(255,255,255,.01)" }}>
          <div className="flex h-full w-full items-center justify-center overflow-hidden text-center" style={{ color: element.color ?? "#132035", fontSize: `${Math.max(8, element.fontSize ?? 16)}px`, fontWeight: element.field === "name" ? 700 : 500 }}>
            {element.kind === "qr" ? <div className="flex h-full w-full flex-col items-center justify-center bg-white/90 text-primary"><QrCode className="h-2/3 w-2/3" /><span className="font-mono text-[8px]">QR CODE</span></div> : element.kind === "image" ? element.imageDataUrl ? <img alt="Badge image" src={element.imageDataUrl} className="h-full w-full object-contain" /> : <div className="flex h-full items-center gap-1 text-[10px]"><FileImage className="h-4 w-4" /> Image</div> : <span className="truncate px-1.5">{valueForField(element.field, selected, eventQuery.data?.name, element.text)}</span>}
          </div>
        </Rnd>)}
        {!layout.elements.length && <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-slate-400">Drop a field here to begin</div>}
        {rendering && <div className="absolute inset-0 grid place-items-center bg-white/75"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></div>}
        {renderError && <div className="absolute inset-x-4 bottom-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{renderError}</div>}
      </div></div><div className="flex items-center justify-between border-t border-border px-4 py-2.5"><span className="mono-label">{Math.round(layout.pageWidth)} × {Math.round(layout.pageHeight)} pt · normalized placement</span><span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><MousePointer2 className="h-3 w-3" />Drag to position</span></div></Card>

      <Card className="h-fit"><CardContent className="p-4"><p className="label-caps">Selected field</p>{selectedElement ? <div className="mt-3 space-y-3"><div className="flex items-center justify-between"><div className="min-w-0"><p className="truncate text-sm font-semibold">{selectedElement.kind === "qr" ? "QR code" : selectedElement.kind === "image" ? "Image" : labelForField(selectedElement.field)}</p><p className="mono-label mt-1">X {Math.round(selectedElement.x * 100)}% · Y {Math.round(selectedElement.y * 100)}%</p></div><button aria-label="Delete field" onClick={() => { setLayout((current) => ({ ...current, elements: current.elements.filter((item) => item.id !== selectedElement.id) })); setSelectedId(null); }} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>
        {selectedElement.kind === "text" && <><label className="block"><span className="label-caps mb-1.5 block">Attendee data field</span><select className="input-control h-9" value={selectedElement.field ?? "static"} onChange={(event) => updateElement(selectedElement.id, { field: event.target.value as BadgeElement["field"] })}><option value="name">Guest name</option><option value="email">Email</option><option value="ticketType">Ticket type</option><option value="eventName">Event name</option>{selectedElement.field?.startsWith("custom:") && !customKeys.includes(selectedElement.field.slice("custom:".length)) && <option value={selectedElement.field}>{labelForField(selectedElement.field)}</option>}{customKeys.map((key) => <option key={key} value={`custom:${key}`}>{key}</option>)}<option value="custom">Custom text</option><option value="static">Static text</option></select></label>{(selectedElement.field === "custom" || selectedElement.field === "static" || !selectedElement.field) && <label className="block"><span className="label-caps mb-1.5 block">Text</span><input className="input-control h-9" value={selectedElement.text ?? ""} onChange={(event) => updateElement(selectedElement.id, { text: event.target.value })} /></label>}<div className="grid grid-cols-2 gap-2"><label><span className="label-caps mb-1.5 block">Font size</span><input className="input-control h-9" type="number" min={6} max={96} value={selectedElement.fontSize ?? 16} onChange={(event) => updateElement(selectedElement.id, { fontSize: Math.max(6, Math.min(96, Number(event.target.value))) })} /></label><label><span className="label-caps mb-1.5 block">Color</span><input className="h-9 w-full cursor-pointer rounded-lg border border-input bg-white p-1" type="color" value={selectedElement.color ?? "#132035"} onChange={(event) => updateElement(selectedElement.id, { color: event.target.value })} /></label></div></>}
        {selectedElement.kind === "qr" && <p className="rounded-lg bg-muted/70 p-3 text-[11px] leading-5 text-muted-foreground">The exported badge uses the selected attendee’s private QR token. Choose an attendee below; otherwise a sample QR is used.</p>}
        {selectedElement.kind === "image" && <p className="rounded-lg bg-muted/70 p-3 text-[11px] leading-5 text-muted-foreground">Image files are included in the saved event layout.</p>}
        <div className="rounded-lg bg-muted/60 p-3"><p className="label-caps">Badge record</p><select className="input-control mt-2 h-9" value={attendeeId} onChange={(event) => setAttendeeId(event.target.value)}><option value="">Sample guest</option>{attendees.data?.map((attendee) => <option key={attendee.id} value={attendee.id}>{attendee.name} · {attendee.ticketType}</option>)}</select></div>
        <Button variant="outline" className="w-full" size="sm" onClick={() => saveLayout.mutate()} disabled={saveLayout.isPending}><Save className="h-3.5 w-3.5" />Save layout</Button>
      </div> : <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-center"><MousePointer2 className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-xs text-muted-foreground">Select an element on the badge to edit its field and style.</p></div>}
        <div className="mt-5 border-t border-border pt-4"><p className="label-caps">Template</p><p className="mt-2 text-xs font-medium">{fileName || "Blank badge page"}</p><div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground"><FileText className="h-3 w-3" />{fileName ? `${pageCount} PDF page${pageCount === 1 ? "" : "s"}` : "6 × 8 in canvas"}</div>{uploadingTemplate && <p className="mt-2 text-[10px] text-primary">Saving PDF to durable event storage…</p>}{templateError && <p role="alert" className="mt-2 text-[10px] leading-4 text-destructive">{templateError}</p>}{templateQuery.isError && !templateError && <p role="alert" className="mt-2 text-[10px] leading-4 text-destructive">Could not load the saved template metadata.</p>}</div>
      </CardContent></Card>
    </div>
  </div>;
}
