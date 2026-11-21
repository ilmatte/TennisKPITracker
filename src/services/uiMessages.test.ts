import { afterEach, describe, expect, it, vi } from 'vitest';
import { logTechnicalDiagnostic, normalizeUiError } from './uiMessages';

const technicalMessage = 'https://iscbysjawfndadbiwbxt.supabase.co/rest/v1/players token=secret';

afterEach(() => vi.restoreAllMocks());

describe('user-facing cloud messages', () => {
  it('never exposes Supabase URLs or raw error text', () => {
    const auth = normalizeUiError('auth', new Error(technicalMessage));
    const sync = normalizeUiError('sync', new Error(technicalMessage));

    expect(auth).toBe('Accesso a Tennis Tracker Cloud non riuscito.');
    expect(sync).not.toContain('supabase.co');
    expect(sync).not.toContain(technicalMessage);
  });

  it('distinguishes authentication, temporary outage and authorization', () => {
    expect(normalizeUiError('auth', { status: 401 })).toBe('Accesso a Tennis Tracker Cloud non riuscito.');
    expect(normalizeUiError('sync', { status: 503 })).toBe('Tennis Tracker Cloud non è momentaneamente raggiungibile.');
    expect(normalizeUiError('sync', { status: 403 })).toBe('Accesso a Tennis Tracker Cloud non autorizzato.');
  });

  it('distinguishes an offline device from a cloud outage', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(normalizeUiError('sync', { status: 503 })).toBe('Nessuna connessione: le modifiche restano sul dispositivo.');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('uses cloud configuration and conflict messages without technical details', () => {
    expect(normalizeUiError('cloud-config')).toBe('Tennis Tracker Cloud non è disponibile al momento.');
    expect(normalizeUiError('conflict')).toBe('Sono presenti versioni diverse. Scegli quale mantenere.');
  });

  it('logs filtered diagnostic metadata without recording sensitive values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logTechnicalDiagnostic('sync', {
      name: 'PostgrestError',
      status: 403,
      code: '42501',
      requestId: 'req-fake-123',
      message: 'Denied for ada@example.test at https://iscbysjawfndadbiwbxt.supabase.co/rest/v1/players?token=secret&api_key=fake',
    });

    const rendered = JSON.stringify(spy.mock.calls);
    expect(rendered).toContain('PostgrestError');
    expect(rendered).toContain('42501');
    expect(rendered).toContain('req-fake-123');
    expect(rendered).toContain('[email]');
    expect(rendered).toContain('[url]');
    expect(rendered).not.toContain('ada@example.test');
    expect(rendered).not.toContain('secret');
    expect(rendered).not.toContain('iscbysjawfndadbiwbxt.supabase.co');
  });
});
