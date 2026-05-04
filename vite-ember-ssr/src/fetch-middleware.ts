/**
 * Fetch middleware pipeline used during SSR rendering.
 *
 * The render path installs a single `fetchWithMiddleware` function as
 * `globalThis.fetch`. That function dispatches each call through a
 * Koa-style onion of middlewares, each of which may inspect/modify the
 * request, await `next(req)`, and inspect/modify the response.
 *
 * Two middlewares ship with the library:
 *  - `forwardHeadersMiddleware` — injects per-host-scoped request headers
 *    (e.g., cookies, authorization) into outbound fetches, so SSR can
 *    make authenticated calls on behalf of the user without leaking
 *    credentials to third-party hosts.
 *  - `shoeboxMiddleware` — captures GET responses into a per-render
 *    Map so they can be serialized into the HTML for the client to
 *    replay during rehydration.
 *
 * Worker mode installs the pipeline once at startup and swaps per-render
 * state via getters; dev mode rebuilds the pipeline per request with
 * closure-captured state.
 */

import type { ShoeboxEntry, ForwardedHeader } from './server.js';

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
 * Middleware that injects per-host-scoped request headers into outbound
 * fetches. Headers are only added when `URL.host` exactly matches one of
 * the header's `allowedHosts`. Headers already set on the request (by
 * app code) are not overwritten.
 *
 * Applies to all HTTP methods — auth headers must flow on POST/PUT too.
 *
 * @param getScopes Function returning the active per-render header map,
 *   or `null` when no headers are configured for this render.
 */
export function forwardHeadersMiddleware(
  getScopes: () => Record<string, ForwardedHeader> | null,
): FetchMiddleware {
  return (request, next) => {
    const scopes = getScopes();
    if (!scopes) return next(request);

    const url = new URL(request.url);
    const merged = new Headers(request.headers);
    let modified = false;

    for (const [name, { value, allowedHosts }] of Object.entries(scopes)) {
      if (!allowedHosts.includes(url.host)) continue;
      // Don't overwrite headers explicitly set by app code.
      if (merged.has(name)) continue;
      merged.set(name, value);
      modified = true;
    }

    if (!modified) return next(request);
    return next(new Request(request, { headers: merged }));
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
