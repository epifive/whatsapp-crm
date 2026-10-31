"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** One shared Socket.IO connection per tab (authenticated by the session cookie) */
export function getSocket(): Socket {
  if (!socket) {
    // NEXT_PUBLIC_REALTIME=off (hosts without the Socket.IO server, e.g. a Vercel preview): no connection attempts
    const enabled = process.env.NEXT_PUBLIC_REALTIME !== "off";
    socket = io({ path: "/socket.io", transports: ["websocket", "polling"], withCredentials: true, autoConnect: enabled });
  }
  return socket;
}

/** Subscribe to a realtime event for the component's lifetime; the handler may change freely */
export function useRealtime<T = Record<string, unknown>>(event: string, handler: (data: T) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const s = getSocket();
    const listener = (data: T) => ref.current(data);
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event]);
}

/** Runs `fn` at most once per `ms`, trailing call included (for refetch storms) */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
