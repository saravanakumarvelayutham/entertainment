/** CommonJS tests must inject a fake worker instead of launching browser inference. */
export function createCaptionWorker(): never {
    throw new Error('Browser caption workers require an injected test factory.');
}
