/** Kept separate so CommonJS UI tests can substitute only the browser boundary. */
export function createCaptionWorker(): Worker {
    return new Worker(new URL('./caption-inference.worker', import.meta.url), {
        type: 'module',
    });
}
