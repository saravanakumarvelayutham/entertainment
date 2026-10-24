import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import {
    channelItemByTitle,
    closeElectronApp,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    packagedRendererIndexPath,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

/** Repeat a bounded local speech/tone fixture so first-use model loading cannot end it. */
function wav(samples: number[]): Buffer {
    const count = samples.length * 12;
    const bytes = Buffer.alloc(44 + count * 2);
    bytes.write('RIFF');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16000, 24);
    bytes.writeUInt32LE(32000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(count * 2, 40);
    for (let index = 0; index < count; index++) {
        bytes.writeInt16LE(
            Math.round(
                Math.max(-1, Math.min(1, samples[index % samples.length])) *
                    32767
            ),
            44 + index * 2
        );
    }
    return bytes;
}

test('@electron generated captions render inside the player and stop cleanly', async ({
    dataDir,
}, testInfo) => {
    test.setTimeout(240_000);
    const realModel = process.env['IPTVNATOR_E2E_REAL_CAPTIONS'] === '1';
    const app = await launchElectronApp(dataDir);
    let audioBytes = Buffer.alloc(0);
    // Deliberately omit CORS headers, as many native provider VOD endpoints do.
    const audioServer = createServer((_request, response) => {
        response.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': audioBytes.length,
        });
        response.end(audioBytes);
    });
    try {
        if (!realModel) {
            await app.mainWindow.addInitScript(() => {
                const NativeWorker = window.Worker;
                window.Worker = new Proxy(NativeWorker, {
                    construct(target, args) {
                        if (!String(args[0]).includes('worker-'))
                            return Reflect.construct(target, args);
                        const fake = {
                            onmessage: null as
                                ((event: { data: unknown }) => void) | null,
                            stopped: false,
                            postMessage(message: { id: number; type: string }) {
                                setTimeout(() => {
                                    if (!fake.stopped)
                                        fake.onmessage?.({
                                            data:
                                                message.type === 'load'
                                                    ? {
                                                          id: message.id,
                                                          type: 'ready',
                                                      }
                                                    : {
                                                          id: message.id,
                                                          type: 'result',
                                                          text: 'Captions from this video, inside the player.',
                                                      },
                                        });
                                }, 10);
                            },
                            terminate() {
                                fake.stopped = true;
                            },
                        };
                        return fake;
                    },
                });
            });
            await app.mainWindow.goto(
                pathToFileURL(packagedRendererIndexPath).href
            );
        }
        const samples = realModel
            ? await app.mainWindow.evaluate(async () => {
                  // Public-domain US presidential speech used by the model's official example.
                  const context = new AudioContext({ sampleRate: 16000 });
                  try {
                      const response = await fetch(
                          'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav'
                      );
                      if (!response.ok)
                          throw new Error('Speech fixture unavailable');
                      const audio = await context.decodeAudioData(
                          await response.arrayBuffer()
                      );
                      return Array.from(audio.getChannelData(0));
                  } finally {
                      await context.close();
                  }
              })
            : Array.from(
                  { length: 80_000 },
                  (_, index) => Math.sin((index * Math.PI) / 40) * 0.1
              );
        audioBytes = wav(samples);
        await new Promise<void>((resolve) =>
            audioServer.listen(0, '127.0.0.1', resolve)
        );
        const address = audioServer.address();
        if (!address || typeof address === 'string')
            throw new Error('Audio fixture failed to listen');
        const playlist = writeTemporaryM3uFile(
            dataDir,
            'generated-captions.m3u',
            [
                {
                    name: 'Caption Sample',
                    groupTitle: 'Caption test',
                    url: `http://127.0.0.1:${address.port}/caption-speech.wav`,
                },
            ]
        );
        await importM3uPlaylistFromNativeDialog(app, playlist);
        await waitForM3uCatalog(app.mainWindow);
        await channelItemByTitle(app.mainWindow, 'Caption Sample')
            .first()
            .click();
        const video = app.mainWindow.locator('.vjs-player-shell video');
        await expect
            .poll(() =>
                video.evaluate(
                    (element) => (element as HTMLVideoElement).currentTime
                )
            )
            .toBeGreaterThan(0);
        // Electron's file-origin policy can allow element capture for this fixture.
        // Explicitly reject that API to cover provider/codec capture failures while
        // retaining real remote playback and real app-scoped audio acquisition.
        await video.evaluate((element) => {
            Object.defineProperty(element, 'captureStream', {
                value: () => {
                    throw new DOMException(
                        'Element capture blocked',
                        'SecurityError'
                    );
                },
            });
        });
        expect(
            await video.evaluate((element) => {
                try {
                    const stream = (
                        element as HTMLVideoElement & {
                            captureStream(): MediaStream;
                        }
                    ).captureStream();
                    const count = stream.getAudioTracks().length;
                    stream.getTracks().forEach((track) => track.stop());
                    return count === 0 ? 'NoAudio' : 'Captured';
                } catch (error) {
                    return (error as DOMException).name;
                }
            })
        ).toMatch(/SecurityError|NoAudio/);
        await app.mainWindow.evaluate(() => {
            const nativeCapture = navigator.mediaDevices.getDisplayMedia.bind(
                navigator.mediaDevices
            );
            const state = window as typeof window & {
                captionCapture?: { stream?: MediaStream; error?: string };
            };
            navigator.mediaDevices.getDisplayMedia = async (options) => {
                try {
                    const stream = await nativeCapture(options);
                    state.captionCapture = { stream };
                    return stream;
                } catch (error) {
                    state.captionCapture = {
                        error: `${(error as Error).name}: ${(error as Error).message}`,
                    };
                    throw error;
                }
            };
        });
        const button = app.mainWindow.getByTestId(
            'player-generated-captions-button'
        );
        await expect(button).toBeVisible();
        await button.click();
        await app.mainWindow
            .getByTestId('player-generated-captions-start')
            .click();
        await expect
            .poll(() =>
                app.mainWindow.evaluate(() => {
                    const state = (
                        window as typeof window & {
                            captionCapture?: {
                                stream?: MediaStream;
                                error?: string;
                            };
                        }
                    ).captionCapture;
                    return (
                        state?.error ?? (state?.stream ? 'captured' : 'pending')
                    );
                })
            )
            .toBe('captured');
        const caption = app.mainWindow.getByTestId('player-generated-caption');
        await expect(caption).toBeVisible({
            timeout: realModel ? 180_000 : 30_000,
        });
        if (realModel)
            await expect(caption).toContainText(
                /fellow|Americans|country|ask|you/i
            );
        else
            await expect(caption).toHaveText(
                'Captions from this video, inside the player.'
            );
        await expect(
            app.mainWindow
                .locator('app-player-controls')
                .filter({ has: caption })
        ).toHaveCount(1);
        await expect(
            app.mainWindow.getByTestId('player-generated-captions-panel')
        ).toHaveCount(0);
        await app.mainWindow.screenshot({
            path: testInfo.outputPath('in-player-captions.png'),
        });
        await app.mainWindow.locator('.vjs-player-shell').hover();
        await app.mainWindow
            .getByRole('button', { name: 'Enter fullscreen', exact: true })
            .click();
        await expect(caption).toBeVisible();
        expect(
            await caption.evaluate((element) =>
                document.fullscreenElement?.contains(element)
            )
        ).toBe(true);
        await app.mainWindow.screenshot({
            path: testInfo.outputPath('fullscreen-captions.png'),
        });
        await app.mainWindow.locator('.vjs-player-shell').hover();
        await app.mainWindow
            .getByRole('button', { name: 'Exit fullscreen', exact: true })
            .click();
        await app.mainWindow.locator('.vjs-player-shell').hover();
        await button.click();
        await app.mainWindow
            .getByTestId('player-generated-captions-stop')
            .click();
        await expect(caption).toHaveCount(0);
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(
            await app.mainWindow.evaluate(() => {
                const stream = (
                    window as typeof window & {
                        captionCapture?: { stream?: MediaStream };
                    }
                ).captionCapture?.stream;
                return stream
                    ?.getTracks()
                    .every((track) => track.readyState === 'ended');
            })
        ).toBe(true);
    } finally {
        await closeElectronApp(app);
        audioServer.closeAllConnections();
        if (audioServer.listening)
            await new Promise<void>((resolve, reject) =>
                audioServer.close((error) =>
                    error ? reject(error) : resolve()
                )
            );
    }
});
