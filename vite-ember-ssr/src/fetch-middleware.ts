/**
 * Fetch middleware pipeline used during SSR rendering.
 *
 * The render path installs a single `fetchWithMiddleware` function as
 * `globalThis.fetch`. That function dispatches each call through a
 * Koa-style onion of middlewares, each of which may inspect/modify the
 * request, await `next(req)`, and inspect/modify the response.
 *
 * Three middlewares ship with the library:
 *  - `forwardCookieMiddleware` — injects the incoming request's `Cookie`
 *    header into outbound fetches whose host appears in `allowedHosts`,
 *    so SSR can make authenticated calls on behalf of the user without
 *    leaking the session cookie to third-party hosts.
 *  - `shoeboxMiddleware` — captures GET responses into a per-render
 *    Map so they can be serialized into the HTML for the client to
 *    replay during rehydration.
 *  - `abortSignalMiddleware` — ties outbound fetches to a per-render
 *    AbortSignal so requests still in flight when a render finishes are
 *    aborted instead of lingering into later renders.
 *
 * Worker mode installs the pipeline once at startup and swaps per-render
 * state via getters; dev mode rebuilds the pipeline per request with
 * closure-captured state.
 */

import type { ShoeboxEntry, ForwardedCookie } from './server.js';

export type FetchMiddleware = (
  request: Request,
  next: (request: Request) => Promise<Response>,
) => Promise<Response>;

/**
 * Composes middlewares into a single fetch-compatible function.
 *
 * Middlewares run in array order on the way in and reverse order on the
 * way out (Koa onion). The terminal function is what runs at the centre
 * of the onion — typically the real, unintercepted `fetch`.
 */
export function compose(
  middlewares: FetchMiddleware[],
  terminal: (request: Request) => Promise<Response>,
): typeof fetch {
  return async (input, init) => {
    const initialRequest = new Request(input, init);
    const dispatch = (idx: number, req: Request): Promise<Response> => {
      const mw = middlewares[idx];
      if (!mw) return terminal(req);
      return mw(req, (nextReq) => dispatch(idx + 1, nextReq));
    };
    return dispatch(0, initialRequest);
  };
}

/**
 * Middleware that injects the incoming request's `Cookie` header into
 * outbound fetches. The cookie is only added when `URL.host` exactly
 * matches one of `allowedHosts`. A cookie header already set on the
 * request (by app code) is not overwritten.
 *
 * Applies to all HTTP methods — auth cookies must flow on POST/PUT too.
 *
 * @param getCookie Function returning the active per-render cookie
 *   config, or `null` when forwarding is disabled for this render.
 */
export function forwardCookieMiddleware(
  getCookie: () => ForwardedCookie | null,
): FetchMiddleware {
  return (request, next) => {
    const cookie = getCookie();
    if (!cookie) return next(request);

    const url = new URL(request.url);
    if (!cookie.allowedHosts.includes(url.host)) return next(request);

    // Don't overwrite a cookie explicitly set by app code.
    if (request.headers.has('cookie')) return next(request);

    const merged = new Headers(request.headers);
    merged.set('cookie', cookie.value);
    return next(new Request(request, { headers: merged }));
  };
}

/**
 * Middleware that ties outbound fetches to a per-render AbortSignal, so
 * requests still in flight when the render finishes (typically after a
 * `settled()` timeout) are aborted instead of lingering into later
 * renders on the same worker.
 *
 * @param getSignal Function returning the active per-render signal, or
 *   `null` when no render-scoped abort is configured.
 */
export function abortSignalMiddleware(
  getSignal: () => AbortSignal | null,
): FetchMiddleware {
  return (request, next) => {
    const signal = getSignal();
    if (!signal) return next(request);

    // Preserve any signal app code attached to its own request.
    const combined = request.signal
      ? AbortSignal.any([request.signal, signal])
      : signal;
    const result = next(new Request(request, { signal: combined }));

    // A render-scoped abort fires after the app that issued the fetch has
    // been torn down, so its rejection may have nothing left awaiting it.
    // Pre-attach a no-op handler to keep such late rejections from crashing
    // the worker as unhandled; the caller still receives the rejection.
    result.catch(() => {});
    return result;
  };
}

/**
 * Middleware that captures GET response bodies into a per-render Map so
 * they can be serialized into the HTML for client-side replay. Non-GET
 * methods are passed through unchanged.
 *
 * @param getEntries Function returning the active per-render Map, or
 *   `null` when shoebox is disabled for this render.
 */
export function shoeboxMiddleware(
  getEntries: () => Map<string, ShoeboxEntry> | null,
): FetchMiddleware {
  return async (request, next) => {
    const response = await next(request);
    const entries = getEntries();
    if (!entries) return response;
    if (request.method.toUpperCase() !== 'GET') return response;

    try {
      const clone = response.clone();
      const body = await clone.text();
      const headers: Record<string, string> = {};
      clone.headers.forEach((v, k) => {
        headers[k] = v;
      });
      entries.set(request.url, {
        url: request.url,
        status: clone.status,
        statusText: clone.statusText,
        headers,
        body,
      });
    } catch {
      /* skip */
    }

    return response;
  };
}
