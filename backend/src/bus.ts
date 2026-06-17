// ── Bus de eventos ────────────────────────────────────────────────────
// Publicación/suscripción en memoria para las notificaciones en vivo (SSE).
// En producción se sustituye por Redis pub/sub (multi-instancia) manteniendo
// esta misma interfaz: publish(channel, data) y subscribe(channel, cb).
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const bus = {
  publish(channel: string, data: unknown) {
    emitter.emit(channel, data);
  },
  subscribe(channel: string, cb: (data: unknown) => void): () => void {
    emitter.on(channel, cb);
    return () => emitter.off(channel, cb);
  },
};

// Canales
export const chQueue = (specialty: string) => `queue:${specialty}`;
export const chConsultation = (id: string) => `consultation:${id}`;
