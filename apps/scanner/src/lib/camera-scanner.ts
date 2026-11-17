import { BrowserQRCodeReader } from "@zxing/browser";

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface NativeDetectorConstructor {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}
export interface CameraScanner {
  ready: Promise<void>;
  stop(): void;
}
export function startCameraScanner(video: HTMLVideoElement, onCode: (code: string) => void): CameraScanner {
  let stopped = false;
  let stream: MediaStream | undefined;
  let stopDecoder: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stopDecoder?.();
    stream?.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  };
  const ready = (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      });
      if (stopped) { stop(); return; }
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.srcObject = stream;
      await video.play();
      if (stopped) { stop(); return; }
      try {
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
        if (capabilities?.focusMode?.includes("continuous")) {
          void track?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        }
      } catch { /* Camera capability queries are optional on older Safari versions. */ }
      const fallback = async () => {
        if (stopped || !stream) return;
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 100 });
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!stopped && result) onCode(result.getText());
        });
        stopDecoder = () => controls.stop();
        if (stopped) controls.stop();
      };
      const Detector = (globalThis as typeof globalThis & { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector;
      let detector: NativeDetector | undefined;
      try {
        if (Detector && (await Detector.getSupportedFormats()).includes("qr_code")) detector = new Detector({ formats: ["qr_code"] });
      } catch { /* Native detection is optional. */ }
      if (stopped) { stop(); return; }
      if (!detector) { await fallback(); return; }
      const detect = async () => {
        if (stopped) return;
        try {
          if (!document.hidden && video.readyState >= 2) {
            const codes = await detector!.detect(video);
            if (!stopped && codes[0]) onCode(codes[0].rawValue);
          }
        } catch {
          try { await fallback(); } catch { stop(); }
          return;
        }
        if (!stopped) timer = setTimeout(() => { void detect(); }, 100);
      };
      void detect();
    } catch (error) {
      stop();
      throw error;
    }
  })();
  return { ready, stop };
}

export class ScanGate {
  private lastCode = "";
  private lastSeen = 0;
  private blockedUntil = 0;
  accept(code: string, now: number): boolean {
    const stillVisible = code === this.lastCode && now - this.lastSeen < 900;
    if (code === this.lastCode) this.lastSeen = now;
    if (now < this.blockedUntil || stillVisible) return false;
    this.lastSeen = now;
    this.lastCode = code;
    return true;
  }
  observe(code: string, now: number) {
    if (code === this.lastCode) this.lastSeen = now;
  }
  retryAfter(now: number) {
    this.blockedUntil = now + 1500;
  }
  reset() {
    this.lastCode = "";
    this.lastSeen = 0;
    this.blockedUntil = 0;
  }
}
