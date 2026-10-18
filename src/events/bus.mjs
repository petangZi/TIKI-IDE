// src/events/bus.mjs
// Event-sourced bus: assigns stable sequence numbers + event IDs, persists
// durable events through a store, and streams to SSE clients with replay.
import { makeEnvelope, validateEvent, isEphemeral, SCHEMA_VERSION } from "./schema.mjs";

const DEFAULT_BUFFER = 2000;
const DEFAULT_HEARTBEAT_MS = 15_000;

export function createEventBus({ store = null, logger = console, bufferSize = DEFAULT_BUFFER, heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
  const clients = new Set();
  const buffer = [];
  let sequence = 0;
  let closed = false;

  if (store?.listEvents) {
    // Resume sequence after restart so IDs stay monotonic across sessions.
    try {
      const recent = store.listEvents({ limit: 1, order: "desc" });
      if (recent.length) sequence = recent[0].sequence || 0;
    } catch { /* fresh store */ }
  }

  function assign(envelope) {
    sequence += 1;
    envelope.sequence = sequence;
    envelope.event_id = envelope.event_id || crypto.randomUUID();
    envelope.timestamp = envelope.timestamp || new Date().toISOString();
    envelope.schema_version = SCHEMA_VERSION;
    return envelope;
  }

  function broadcast(envelope) {
    const frame = `id: ${envelope.sequence}\nevent: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`;
    for (const client of clients) {
      try { client.write(frame); } catch { clients.delete(client); }
    }
  }

  function remember(envelope) {
    buffer.push(envelope);
    if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
  }

  /**
   * Emit an event. Returns the persisted envelope.
   * `partial` may be a full envelope or a `{type, ...}` fragment.
   */
  function emit(partial) {
    if (closed) return null;
    const envelope = partial.schema_version === SCHEMA_VERSION && partial.sequence === null
      ? { ...partial }
      : makeEnvelope(partial);
    validateEvent(envelope);
    assign(envelope);
    const ephemeral = isEphemeral(envelope.type);
    if (!ephemeral) {
      remember(envelope);
      if (store?.appendEvent) {
        try { store.appendEvent(envelope); } catch (error) { logger.warn?.("event persist failed", { error: error.message }); }
      }
    } else {
      remember(envelope);
    }
    broadcast(envelope);
    return envelope;
  }

  /** Emit without throwing into caller paths that must not fail. */
  function emitSafe(partial) {
    try { return emit(partial); }
    catch (error) { logger.warn?.("event emit failed", { error: error.message, type: partial?.type }); return null; }
  }

  /** Replay buffered events with sequence > afterSequence. */
  function replay(afterSequence = 0) {
    return buffer.filter((e) => e.sequence > afterSequence);
  }

  function attach(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    const lastId = Number(req.headers["last-event-id"] || 0);
    const missed = replay(lastId);
    // Control frame first, then any missed events, then live.
    res.write(`event: connected\ndata: ${JSON.stringify({ type: "connected", schema_version: SCHEMA_VERSION, replayed: missed.length, sequence, at: new Date().toISOString() })}\n\n`);
    for (const event of missed) {
      res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    clients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(`: keepalive ${Date.now()}\n\n`); } catch { cleanup(); }
    }, heartbeatMs);
    const cleanup = () => { clearInterval(heartbeat); clients.delete(res); };
    req.on("close", cleanup);
    req.on("error", cleanup);
    return cleanup;
  }

  function stats() {
    return { clients: clients.size, buffered: buffer.length, sequence, closed };
  }

  function close() {
    closed = true;
    for (const client of clients) { try { client.end?.(); } catch {} }
    clients.clear();
  }

  return { emit, emitSafe, replay, attach, stats, close, get sequence() { return sequence; } };
}
