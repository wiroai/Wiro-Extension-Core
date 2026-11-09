// Server-sent events, as the MCP Streamable HTTP transport sends them: events
// separated by a blank line, each `data:` line holding (part of) one JSON-RPC
// message.

export interface SseEvent {
  event?: string;
  id?: string;
  data: string;
}

export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\n+/)) {
    const data: string[] = [];
    let event: string | undefined;
    let id: string | undefined;
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id') id = value;
    }
    if (data.length > 0) events.push({ event, id, data: data.join('\n') });
  }
  return events;
}

/** The JSON-RPC messages inside an SSE body, skipping events that are not JSON. */
export function sseJsonMessages(text: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of parseSse(text)) {
    try {
      messages.push(JSON.parse(event.data));
    } catch {
      // Not a JSON-RPC message (a keep-alive or a priming event).
    }
  }
  return messages;
}
