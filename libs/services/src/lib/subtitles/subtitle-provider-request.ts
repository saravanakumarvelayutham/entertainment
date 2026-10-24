const REQUEST_TIMEOUT = 20_000;

/** Bounds both downloaded bytes and total fetch/body time, including slow bodies. */
export async function subtitleProviderRequest(
    url: string,
    maxBytes: number,
    signal?: AbortSignal
): Promise<string> {
    if (signal?.aborted) throw new Error('Subtitle request cancelled.');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
            controller.abort();
            reject(new Error('Subtitle request cancelled.'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Subtitle request timed out.'));
        }, REQUEST_TIMEOUT);
        if (signal?.aborted) onAbort();
    });
    try {
        return await Promise.race([
            interrupted,
            (async () => {
                const response = await fetch(url, {
                    signal: controller.signal,
                    credentials: 'omit',
                    redirect: 'error',
                    referrerPolicy: 'no-referrer',
                    cache: 'no-store',
                });
                if (!response.ok)
                    throw new Error('Subtitle provider request failed.');
                if (new URL(response.url).origin !== new URL(url).origin) {
                    throw new Error(
                        'Subtitle provider returned an unexpected origin.'
                    );
                }
                const length = response.headers.get('content-length');
                if (length && Number(length) > maxBytes) {
                    throw new Error('Subtitle response is too large.');
                }
                if (!response.body)
                    throw new Error('Subtitle response is empty.');
                const reader = response.body.getReader();
                const cancelReader = () => {
                    void reader.cancel().catch(() => undefined);
                };
                controller.signal.addEventListener('abort', cancelReader, {
                    once: true,
                });
                if (controller.signal.aborted) cancelReader();
                const decoder = new TextDecoder('utf-8', { fatal: true });
                let total = 0;
                let content = '';
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        total += value.byteLength;
                        if (total > maxBytes)
                            throw new Error('Subtitle response is too large.');
                        content += decoder.decode(value, { stream: true });
                    }
                    return content + decoder.decode();
                } finally {
                    controller.signal.removeEventListener(
                        'abort',
                        cancelReader
                    );
                    await reader.cancel().catch(() => undefined);
                    reader.releaseLock();
                }
            })(),
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        controller.abort();
    }
}
