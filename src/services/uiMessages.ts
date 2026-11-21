export type UiMessageContext =
  | 'auth'
  | 'invitation'
  | 'sync'
  | 'cloud-config'
  | 'local-startup'
  | 'conflict';

interface DiagnosticError {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
  request_id?: unknown;
  id?: unknown;
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as DiagnosticError).status;
  if (typeof value !== 'number') return null;
  return value;
}

export function normalizeUiError(context: UiMessageContext, error?: unknown): string {
  if (context === 'cloud-config') {
    return 'Tennis Tracker Cloud non è disponibile al momento.';
  }
  if (context === 'local-startup') {
    return 'Impossibile inizializzare i dati locali.';
  }
  if (context === 'conflict') {
    return 'Sono presenti versioni diverse. Scegli quale mantenere.';
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (context === 'auth') return 'Nessuna connessione: riprova l’accesso.';
    if (context === 'invitation') return 'Nessuna connessione: invito non verificato.';
    return 'Nessuna connessione: le modifiche restano sul dispositivo.';
  }

  const status = statusOf(error);
  if (context === 'auth') {
    return 'Accesso a Tennis Tracker Cloud non riuscito.';
  }
  if (context === 'invitation') {
    return 'Invito non accettato. Riprova.';
  }
  if (status === 401 || status === 403) {
    return 'Accesso a Tennis Tracker Cloud non autorizzato.';
  }
  if (status === 0 || status === 429 || (status !== null && status >= 500)) {
    return 'Tennis Tracker Cloud non è momentaneamente raggiungibile.';
  }
  if (error instanceof TypeError || error instanceof DOMException ||
    (error instanceof Error && /network|fetch|timeout|connection/i.test(error.message))) {
    return 'Tennis Tracker Cloud non è momentaneamente raggiungibile.';
  }
  return 'Sincronizzazione non riuscita. Riprova.';
}

function safeDiagnosticMessage(message: string): string | undefined {
  let safe = message
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/gi, '[id]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Z0-9._~-]+/gi, '[credential]')
    .replace(/([?&](?:access_token|token|key|api_key|apikey|authorization|jwt|password)=)[^&\s]+/gi, '$1[filtered]')
    .replace(/\b(?:access_token|refresh_token|token|api[_-]?key|authorization|password)\b\s*[:=]\s*[^\s,;}]+/gi, '[credential]')
    .replace(/ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .trim();

  if (!safe) return undefined;
  return safe.slice(0, 240);
}

export function logTechnicalDiagnostic(context: string, error: unknown): void {
  const diagnostic: Record<string, unknown> = { context };
  if (error && typeof error === 'object') {
    const value = error as DiagnosticError;
    if (typeof value.name === 'string') diagnostic.name = value.name;
    if (typeof value.status === 'number') diagnostic.status = value.status;
    if (typeof value.code === 'string') diagnostic.code = value.code;

    const requestId = typeof value.requestId === 'string'
      ? value.requestId
      : typeof value.request_id === 'string'
        ? value.request_id
        : typeof value.id === 'string'
          ? value.id
          : undefined;
    if (requestId) diagnostic.request_id = safeDiagnosticMessage(requestId);

    if (typeof value.message === 'string') {
      const safeMessage = safeDiagnosticMessage(value.message);
      if (safeMessage) diagnostic.message = safeMessage;
    }
  } else if (typeof error === 'string') {
    const safeMessage = safeDiagnosticMessage(error);
    if (safeMessage) diagnostic.message = safeMessage;
  }
  console.error('[Tennis KPI Tracker:diagnostic]', diagnostic);
}
