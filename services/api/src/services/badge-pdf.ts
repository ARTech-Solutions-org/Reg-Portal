import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { centeredBadgeText, type BadgeElement, type BadgeLayout } from "@eventdesk/contracts";

export interface BadgePdfAttendee {
  name: string | null;
  email: string | null;
  ticketType: string | null;
  customFields: Record<string, string>;
}

export interface BadgePdfOptions {
  layout: BadgeLayout;
  attendees: BadgePdfAttendee[];
  eventName: string;
  qrTokens: string[];
  templateBytes?: Uint8Array;
  templatePdf?: PDFDocument;
}

function valueForField(element: BadgeElement, attendee: BadgePdfAttendee, eventName: string): string {
  const field = element.field;
  if (!field) return element.text ?? "";
  if (field.startsWith("custom:")) {
    const key = field.slice("custom:".length);
    return Object.hasOwn(attendee.customFields, key) ? attendee.customFields[key] ?? "" : "";
  }
  if (field === "custom" || field === "static") return element.text ?? (field === "custom" ? "Your text" : "Static text");
  if (field === "name") return attendee.name ?? "";
  if (field === "email") return attendee.email ?? "";
  if (field === "ticketType") return attendee.ticketType ?? "";
  return eventName;
}

function imageFromDataUrl(dataUrl: string): { bytes: Uint8Array; format: "png" | "jpg" } {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("A saved badge image has an unsupported format.");
  return { bytes: Buffer.from(match[2]!, "base64"), format: match[1] === "png" ? "png" : "jpg" };
}

export async function buildBadgePdf({ layout, attendees, eventName, qrTokens, templateBytes, templatePdf: loadedTemplate }: BadgePdfOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const templatePdf = loadedTemplate ?? (templateBytes ? await PDFDocument.load(templateBytes) : undefined);
  let templatePageIndex = 0;
  
  if (templatePdf) {
    const pages = templatePdf.getPages();
    if (!pages.length) throw new Error("The saved badge template does not contain a PDF page.");
    templatePageIndex = Math.min(layout.pageIndex, pages.length - 1);
  }

  let font: Awaited<ReturnType<typeof pdf.embedFont>> | undefined;

  for (let i = 0; i < attendees.length; i++) {
    const attendee = attendees[i]!;
    const qrToken = qrTokens[i]!;
    
    let page;
    if (templatePdf) {
      const [copiedPage] = await pdf.copyPages(templatePdf, [templatePageIndex]);
      page = pdf.addPage(copiedPage!);
    } else {
      page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
    }

    const width = page.getWidth();
    const height = page.getHeight();
    const qrBytes = await QRCode.toBuffer(qrToken, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 400,
      color: { dark: "#132035", light: "#FFFFFF" },
    });
    const qrImage = await pdf.embedPng(qrBytes);

    for (const element of layout.elements) {
      const x = element.x * width;
      const y = height - (element.y + element.height) * height;
      const drawWidth = element.width * width;
      const drawHeight = element.height * height;
      if (element.kind === "qr") {
        page.drawImage(qrImage, { x, y, width: drawWidth, height: drawHeight });
        continue;
      }
      if (element.kind === "image") {
        if (!element.imageDataUrl) continue;
        const image = imageFromDataUrl(element.imageDataUrl);
        const embedded = image.format === "jpg" ? await pdf.embedJpg(image.bytes) : await pdf.embedPng(image.bytes);
        page.drawImage(embedded, { x, y, width: drawWidth, height: drawHeight });
        continue;
      }

      const content = valueForField(element, attendee, eventName);
      if (!content) continue;
      font ??= await pdf.embedFont(StandardFonts.Helvetica);
      const color = element.color ?? "#132035";
      const pdfColor = rgb(
        Number.parseInt(color.slice(1, 3), 16) / 255,
        Number.parseInt(color.slice(3, 5), 16) / 255,
        Number.parseInt(color.slice(5, 7), 16) / 255,
      );
      const fontSize = element.fontSize ?? 16;
      const centered = centeredBadgeText(content, font, { x, y, width: drawWidth, height: drawHeight, fontSize });
      page.drawText(centered.content, {
        x: centered.x,
        y: centered.y,
        size: centered.size,
        font,
        color: pdfColor,
      });
    }
  }

  return pdf.save();
}
