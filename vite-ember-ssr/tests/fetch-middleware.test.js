import { describe, it, expect, vi } from 'vitest';
import {
  compose,
  forwardHeadersMiddleware,
  shoeboxMiddleware,
} from '../src/fetch-middleware.ts';

// ─── compose() ───────────────────────────────────────────────────────

describe('compose', () => {
  it('calls the terminal directly when no middlewares are configured', async () => {
    const terminal = vi.fn(async (req) => new Response('ok'));
    const fn = compose([], terminal);

    const res = await fn('https://api.example.com/x');

    expect(terminal).toHaveBeenCalledOnce();
    expect(terminal.mock.calls[0][0]).toBeInstanceOf(Request);
    expect(terminal.mock.calls[0][0].url).toBe('https://api.example.com/x');
    expect(await res.text()).toBe('ok');
  });

  it('runs middlewares in array order on the way in', async () => {
    const trace = [];
    const a = async (req, next) => {
      trace.push('a-in');
      const r = await next(req);
      trace.push('a-out');
      return r;
    };
    const b = async (req, next) => {
      trace.push('b-in');
      const r = await next(req);
      trace.push('b-out');
      return r;
    };
    const terminal = async () => {
      trace.push('terminal');
      return new Response('ok');
    };

    await compose([a, b], terminal)('https://x.test');

    expect(trace).toEqual(['a-in', 'b-in', 'terminal', 'b-out', 'a-out']);
  });
});

// ─── forwardHeadersMiddleware ────────────────────────────────────────

describe('forwardHeadersMiddleware', () => {
  function runWith(scopes, request) {
    const captured = { request: null };
    const terminal = async (req) => {
      captured.request = req;
      return new Response('ok');
    };
    const fn = compose([forwardHeadersMiddleware(() => scopes)], terminal);
    return fn(request).then(() => captured.request);
  }

  it('passes through unchanged when no scopes are configured', async () => {
    const req = await runWith(null, 'https://api.example.com/x');

    expect(req.headers.has('cookie')).toBe(false);
  });

  it('injects a header when the request host matches allowedHosts', async () => {
    const req = await runWith(
      {
        cookie: { value: 'session=abc', allowedHosts: ['api.example.com'] },
      },
      'https://api.example.com/x',
    );

    expect(req.headers.get('cookie')).toBe('session=abc');
  });

  it('does NOT inject a header when the host is not in allowedHosts', async () => {
    const req = await runWith(
      {
        cookie: { value: 'session=abc', allowedHosts: ['api.example.com'] },
      },
      'https://pokeapi.co/api/v2/pokemon/pikachu',
    );

    expect(req.headers.has('cookie')).toBe(false);
  });

  it('matches host with port (URL.host semantics)', async () => {
    const matched = await runWith(
      {
        cookie: { value: 'v', allowedHosts: ['api.example.com:8080'] },
      },
      'https://api.example.com:8080/x',
    );
    expect(matched.headers.get('cookie')).toBe('v');

    // Different port → no match
    const notMatched = await runWith(
      {
        cookie: { value: 'v', allowedHosts: ['api.example.com:8080'] },
      },
      'https://api.example.com/x',
    );
    expect(notMatched.headers.has('cookie')).toBe(false);
  });

  it('does NOT do suffix matching (subdomain attacker scenario)', async () => {
    // 'evil-api.example.com' must not satisfy a rule for 'example.com'
    const req = await runWith(
      {
        cookie: { value: 'v', allowedHosts: ['example.com'] },
      },
      'https://evil-api.example.com/x',
    );

    expect(req.headers.has('cookie')).toBe(false);
  });

  it('does not overwrite a header explicitly set on the request', async () => {
    const captured = { request: null };
    const terminal = async (req) => {
      captured.request = req;
      return new Response('ok');
    };
    const scopes = {
      cookie: { value: 'forwarded', allowedHosts: ['api.example.com'] },
    };
    const fn = compose([forwardHeadersMiddleware(() => scopes)], terminal);

    await fn('https://api.example.com/x', {
      headers: { cookie: 'app-set' },
    });

    expect(captured.request.headers.get('cookie')).toBe('app-set');
  });

  it('scopes each header independently (per-header allowedHosts)', async () => {
    const scopes = {
      cookie: { value: 'session=abc', allowedHosts: ['api.example.com'] },
      authorization: {
        value: 'Bearer xyz',
        allowedHosts: ['auth.example.com'],
      },
    };

    const apiReq = await runWith(scopes, 'https://api.example.com/x');
    expect(apiReq.headers.get('cookie')).toBe('session=abc');
    expect(apiReq.headers.has('authorization')).toBe(false);

    const authReq = await runWith(scopes, 'https://auth.example.com/x');
    expect(authReq.headers.has('cookie')).toBe(false);
    expect(authReq.headers.get('authorization')).toBe('Bearer xyz');
  });

  it('forwards headers on non-GET methods too', async () => {
    const captured = { request: null };
    const terminal = async (req) => {
      captured.request = req;
      return new Response('ok');
    };
    const scopes = {
      authorization: {
        value: 'Bearer xyz',
        allowedHosts: ['api.example.com'],
      },
    };
    const fn = compose([forwardHeadersMiddleware(() => scopes)], terminal);

    await fn('https://api.example.com/submit', {
      method: 'POST',
      body: 'payload',
    });

    expect(captured.request.method).toBe('POST');
    expect(captured.request.headers.get('authorization')).toBe('Bearer xyz');
  });
});

// ─── shoeboxMiddleware ───────────────────────────────────────────────

describe('shoeboxMiddleware', () => {
  it('captures GET responses into the entries map', async () => {
    const entries = new Map();
    const terminal = async () =>
      new Response('hello', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
      });

    await compose(
      [shoeboxMiddleware(() => entries)],
      terminal,
    )('https://api.example.com/x');

    expect(entries.size).toBe(1);
    const entry = entries.get('https://api.example.com/x');
    expect(entry.body).toBe('hello');
    expect(entry.status).toBe(200);
    expect(entry.headers['content-type']).toBe('text/plain');
  });

  it('does NOT capture when entries map is null', async () => {
    const terminal = async () => new Response('hello');
    const result = await compose(
      [shoeboxMiddleware(() => null)],
      terminal,
    )('https://api.example.com/x');

    expect(await result.text()).toBe('hello');
  });

  it('does NOT capture non-GET responses', async () => {
    const entries = new Map();
    const terminal = async () => new Response('ok');

    await compose([shoeboxMiddleware(() => entries)], terminal)(
      'https://api.example.com/x',
      { method: 'POST', body: 'data' },
    );

    expect(entries.size).toBe(0);
  });
});

// ─── Pipeline order ──────────────────────────────────────────────────

describe('pipeline ordering', () => {
  it('shoebox captures the request as modified by forwardHeaders', async () => {
    // forwardHeaders runs first, so the shoebox sees the request with
    // forwarded headers attached. This matches what the real fetch will see.
    const entries = new Map();
    let observedHeaderInTerminal;
    const terminal = async (req) => {
      observedHeaderInTerminal = req.headers.get('cookie');
      return new Response('body');
    };
    const fn = compose(
      [
        forwardHeadersMiddleware(() => ({
          cookie: { value: 'forwarded', allowedHosts: ['api.example.com'] },
        })),
        shoeboxMiddleware(() => entries),
      ],
      terminal,
    );

    await fn('https://api.example.com/x');

    expect(observedHeaderInTerminal).toBe('forwarded');
    expect(entries.size).toBe(1);
  });
});
