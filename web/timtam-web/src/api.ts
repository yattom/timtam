// Simple API helper for timtam backend
// Bootstrap: use window.API_BASE_URL (from /config.js) to fetch /config first, then switch to server-provided apiBaseUrl
// Falls back to VITE_API_BASE_URL for local development

export type PublicConfig = {
  apiBaseUrl: string;
  defaultRegion: string;
  defaultModelId: string;
  ttsDefaultVoice: string;
};

let API_BASE: string = (window as any).API_BASE_URL ||
                       (import.meta as any).env?.VITE_API_BASE_URL || '';

function u(path: string) {
  if (!API_BASE) throw new Error('API base URL is not set. Check /config.js or define VITE_API_BASE_URL for local dev.');
  return `${API_BASE}${path}`;
}

export async function getConfig(): Promise<PublicConfig> {
  if (!API_BASE) {
    throw new Error('API base URL is required to bootstrap /config fetch. Check /config.js or VITE_API_BASE_URL.');
  }
  const res = await fetch(u('/config'));
  if (!res.ok) {
    throw new Error(`/config failed: ${res.status}`);
  }
  const data = (await res.json()) as PublicConfig;
  if (data?.apiBaseUrl) {
    API_BASE = data.apiBaseUrl; // switch to server-declared base for subsequent calls
  }
  return data;
}

export async function createMeeting(): Promise<any> {
  const res = await fetch(u('/meetings'), { method: 'POST' });
  if (!res.ok) throw new Error(`/meetings failed: ${res.status}`);
  return res.json();
}

export async function addAttendee(meetingId: string): Promise<any> {
  const res = await fetch(u('/attendees'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meetingId }),
  });
  if (!res.ok) throw new Error(`/attendees failed: ${res.status}`);
  return res.json();
}

export async function startTranscription(meetingId: string): Promise<void> {
  const res = await fetch(u(`/meetings/${encodeURIComponent(meetingId)}/transcription/start`), { method: 'POST' });
  if (!res.ok) throw new Error(`transcription start failed: ${res.status}`);
}

export async function stopTranscription(meetingId: string): Promise<void> {
  const res = await fetch(u(`/meetings/${encodeURIComponent(meetingId)}/transcription/stop`), { method: 'POST' });
  if (!res.ok) throw new Error(`transcription stop failed: ${res.status}`);
}
