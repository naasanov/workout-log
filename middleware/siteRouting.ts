import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const CANONICAL_HOST = 'peakhq.me';
export const WWW_HOST = 'www.peakhq.me';

// Real client-side routes the SPA renders (see client/src/App.tsx). '/' also
// carries `?tab=` query params, which Express route matching ignores.
export const SPA_ROUTES = ['/', '/workout-log', '/sign-in', '/sign-up'];

// Redirects the www host to the bare apex domain, preserving path and query.
// Keyed on the Host header (req.hostname), which Heroku forwards unchanged, so
// every other host (apex, herokuapp.com, localhost) passes through.
export function redirectWwwToApex(req: Request, res: Response, next: NextFunction): void {
    if (req.hostname === WWW_HOST) {
        res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
        return;
    }
    next();
}

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Page not found - Peak</title>
</head>
<body>
<h1>Page not found</h1>
<p><a href="/">Go back to Peak</a></p>
</body>
</html>
`;

// Serves index.html for the SPA's client routes and a real 404 for other
// non-API paths. Unmatched /api/* GETs still fall through to index.html,
// since giving those a real 404 is a separate change.
export function mountSiteRouting(app: import('express').Express, buildDir: string): void {
    const indexHtml = path.join(buildDir, 'index.html');

    app.get(SPA_ROUTES, (req: Request, res: Response) => {
        res.sendFile(indexHtml);
    });

    app.get(/^\/api(\/|$)/, (req: Request, res: Response) => {
        res.sendFile(indexHtml);
    });

    app.use((req: Request, res: Response) => {
        res.status(404).type('html').send(NOT_FOUND_HTML);
    });
}

// True if buildDir has an index.html to serve, false in a checkout where the
// client hasn't been built yet.
export function hasClientBuild(buildDir: string): boolean {
    return fs.existsSync(path.join(buildDir, 'index.html'));
}
