import { capturePlayerAudio } from './player-audio-stream';

describe('capturePlayerAudio', () => {
    const originalElectron = window.electron;
    const originalDevices = Object.getOwnPropertyDescriptor(
        navigator,
        'mediaDevices'
    );
    const audioTrack = { stop: jest.fn() };
    const videoTrack = { stop: jest.fn() };
    const stream = {
        getAudioTracks: () => [audioTrack],
        getVideoTracks: () => [videoTrack],
        removeTrack: jest.fn(),
    };
    const getDisplayMedia = jest.fn();
    const captureStream = jest.fn();
    const video = { captureStream } as unknown as HTMLVideoElement;

    beforeEach(() => {
        jest.clearAllMocks();
        window.electron = { platform: 'win32' } as typeof window.electron;
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getDisplayMedia },
        });
        getDisplayMedia.mockResolvedValue(stream);
        captureStream.mockReturnValue(stream);
    });
    afterEach(() => {
        window.electron = originalElectron;
        if (originalDevices)
            Object.defineProperty(navigator, 'mediaDevices', originalDevices);
        else delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
    });

    it('captures app audio on desktop without touching the cross-origin video', async () => {
        captureStream.mockImplementation(() => {
            throw new DOMException('Cross-origin', 'SecurityError');
        });
        expect(await capturePlayerAudio(video)).toBe(stream);
        expect(captureStream).not.toHaveBeenCalled();
        expect(getDisplayMedia).toHaveBeenCalledWith({
            video: { frameRate: 1, width: 1, height: 1 },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                suppressLocalAudioPlayback: false,
            },
        });
        expect(videoTrack.stop).toHaveBeenCalledTimes(1);
        expect(stream.removeTrack).toHaveBeenCalledWith(videoTrack);
        expect(audioTrack.stop).not.toHaveBeenCalled();
    });

    it('retains native video capture in the browser without requesting display media', async () => {
        delete (window as { electron?: unknown }).electron;
        captureStream.mockReturnValue(stream);
        expect(await capturePlayerAudio(video)).toBe(stream);
        expect(captureStream).toHaveBeenCalledTimes(1);
        expect(getDisplayMedia).not.toHaveBeenCalled();
    });

    it('propagates a denied desktop request without requesting another source', async () => {
        getDisplayMedia.mockRejectedValue(
            new DOMException('Denied', 'NotAllowedError')
        );
        await expect(capturePlayerAudio(video)).rejects.toMatchObject({
            name: 'NotAllowedError',
        });
        expect(captureStream).not.toHaveBeenCalled();
    });
});
