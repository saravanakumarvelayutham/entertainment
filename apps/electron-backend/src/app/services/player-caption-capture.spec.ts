import type { BrowserWindow } from 'electron';
import { installPlayerCaptionCapture } from './player-caption-capture';

describe('player caption capture authorization', () => {
    function setup() {
        const frame = {
            url: 'file:///app/index.html',
            detached: false,
            isDestroyed: jest.fn(() => false),
        };
        const setHandler = jest.fn();
        const window = {
            isDestroyed: jest.fn(() => false),
            webContents: {
                isDestroyed: jest.fn(() => false),
                mainFrame: frame,
                session: { setDisplayMediaRequestHandler: setHandler },
            },
        };
        installPlayerCaptionCapture(window as unknown as BrowserWindow);
        const handler = setHandler.mock.calls[0][0] as (
            request: Electron.DisplayMediaRequestHandlerHandlerRequest,
            callback: (streams: Electron.Streams) => void
        ) => void;
        const request = {
            frame,
            securityOrigin: 'file://',
            audioRequested: true,
            videoRequested: true,
            userGesture: true,
        } as unknown as Electron.DisplayMediaRequestHandlerHandlerRequest;
        const callback = jest.fn();
        return { frame, window, handler, request, callback };
    }

    it('captures only the requesting main frame and keeps local playback audible', () => {
        const { frame, handler, request, callback } = setup();
        handler(request, callback);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            video: frame,
            audio: frame,
            enableLocalEcho: true,
        });
    });

    it('accepts the same main frame after an Angular SPA route change', () => {
        const { frame, handler, request, callback } = setup();
        frame.url = 'file:///app/workspace/playlists/123/movies/456';
        handler(request, callback);
        expect(callback).toHaveBeenCalledWith({
            video: frame,
            audio: frame,
            enableLocalEcho: true,
        });
    });

    it.each(['audioRequested', 'videoRequested', 'userGesture'] as const)(
        'denies requests without %s',
        (flag) => {
            const { handler, request, callback } = setup();
            handler({ ...request, [flag]: false }, callback);
            expect(callback).toHaveBeenCalledWith({});
        }
    );

    it('denies requests from a different frame even with the same URL', () => {
        const { handler, request, callback, frame } = setup();
        handler({ ...request, frame: { ...frame } as never }, callback);
        expect(callback).toHaveBeenCalledWith({});
    });

    it('denies untrusted child frames', () => {
        const { handler, request, callback, frame } = setup();
        handler({
            ...request,
            frame: { ...frame, url: 'https://untrusted.example' } as never,
        }, callback);
        expect(callback).toHaveBeenCalledWith({});
    });

    it.each(['null', 'detached', 'destroyed', 'window', 'contents'])(
        'denies a %s request',
        (condition) => {
            const { handler, request, callback, frame, window } = setup();
            if (condition === 'null') request.frame = null;
            if (condition === 'detached') frame.detached = true;
            if (condition === 'destroyed') frame.isDestroyed.mockReturnValue(true);
            if (condition === 'window') window.isDestroyed.mockReturnValue(true);
            if (condition === 'contents') {
                window.webContents.isDestroyed.mockReturnValue(true);
            }
            handler(request, callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith({});
        }
    );

    it('denies safely when navigation invalidates a frame getter', () => {
        const { handler, request, callback, window } = setup();
        Object.defineProperty(window.webContents, 'mainFrame', {
            get: () => {
                throw new Error('Frame was disposed');
            },
        });
        handler(request, callback);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({});
    });
});
