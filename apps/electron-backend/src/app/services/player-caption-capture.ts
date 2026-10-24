import type { BrowserWindow } from 'electron';

/** Grants explicit caption capture of this renderer only, never system audio. */
export function installPlayerCaptionCapture(
    window: BrowserWindow
): void {
    window.webContents.session.setDisplayMediaRequestHandler(
        (request, callback) => {
            let streams: Electron.Streams = {};
            try {
                const frame = request.frame;
                if (
                    !window.isDestroyed() &&
                    !window.webContents.isDestroyed() &&
                    frame &&
                    !frame.isDestroyed() &&
                    !frame.detached &&
                    frame === window.webContents.mainFrame &&
                    request.userGesture &&
                    request.audioRequested &&
                    request.videoRequested
                ) {
                    // The window already guards navigation. SPA routes change the
                    // file URL, so trust frame provenance rather than index.html.
                    // Keep playback audible while capturing the app's own frame.
                    streams = { video: frame, audio: frame, enableLocalEcho: true };
                }
            } catch {
                // Navigation or destruction may invalidate frame getters mid-request.
            }
            callback(streams);
        }
    );
}
