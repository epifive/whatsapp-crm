/**
 * Cloud API rule: free-form messages are allowed only within 24 hours of the customer's last
 * message; outside that window only approved templates may be sent. QR numbers have no window.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowExpiresAt(lastInboundAt: Date | null | undefined): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS) : null;
}

export function isWindowOpen(lastInboundAt: Date | null | undefined, now = Date.now()): boolean {
  return !!lastInboundAt && now - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}
