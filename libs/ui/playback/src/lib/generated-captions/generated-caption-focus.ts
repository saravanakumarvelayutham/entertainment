/** Return lost panel focus after asynchronous startup without stealing a new focus. */
export function handoffGeneratedCaptionFocus(
    host: HTMLElement,
    afterRender: (callback: () => void) => void
): void {
    const doc = host.ownerDocument;
    const previousFocus = doc.activeElement;
    if (
        !host
            .querySelector('[data-test-id="player-generated-captions-panel"]')
            ?.contains(previousFocus)
    )
        return;
    afterRender(() => {
        if (
            doc.activeElement === doc.body ||
            doc.activeElement === previousFocus
        ) {
            host.querySelector<HTMLButtonElement>(
                '[data-test-id="player-generated-captions-button"]'
            )?.focus();
        }
    });
}
