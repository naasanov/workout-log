import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const CANONICAL_HOST = 'peakhq.me';
export const WWW_HOST = 'www.peakhq.me';

// Real client-side routes the SPA renders (see client/src/App.tsx). '/' also
// carries `?tab=` query params, which Express route matching ignores.
export const SPA_ROUTES = ['/', '/workout-log', '/sign-in', '/sign-up'];

// Redirects the www host to the bare apex domain, preserving path and query.
// Keyed on the Host header (req.hostname), which Heroku forwards unchanged.
// Any other host (peakhq.me itself, the herokuapp.com URL, localhost) passes
// through untouched.
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

// Mounts the SPA's index.html for its known client routes, and a real 404
// (not a soft 200) for everything else outside /api. Unmatched /api/* GET
// requests keep today's behavior -- falling through to index.html -- since
// giving those a real 404 is a separate, deliberate change (#392).
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

// True if buildDir has an index.html to serve -- false in a checkout where
// the client hasn't been built yet.
export function hasClientBuild(buildDir: string): boolean {
    return fs.existsSync(path.join(buildDir, 'index.html'));
}
