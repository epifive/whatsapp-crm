"use client";

import QRCode from "qrcode";
import { useEffect, useRef } from "react";

/** Renders the WhatsApp pairing QR in the browser (only the short pairing string travels) */
export function QrCanvas({ value, size = 240 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void QRCode.toCanvas(ref.current, value, { width: size, margin: 1, errorCorrectionLevel: "L" });
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} className="rounded-lg border bg-white" aria-label="WhatsApp QR code" />;
}
