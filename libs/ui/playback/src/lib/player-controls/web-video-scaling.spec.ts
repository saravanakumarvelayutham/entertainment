import { WebVideoControlsAdapter } from './web-video-controls.adapter';

describe('shared web player scaling', () => {
    let adapter: WebVideoControlsAdapter;
    let video: HTMLVideoElement;

    beforeEach(() => {
        localStorage.removeItem('web-player-scaling');
        adapter = new WebVideoControlsAdapter();
        video = document.createElement('video');
    });

    afterEach(() => {
        adapter.detach();
        localStorage.removeItem('web-player-scaling');
        jest.restoreAllMocks();
    });

    it('fits the original picture by default and exposes all scaling choices', () => {
        adapter.attach(video);
        expect(adapter.capabilities().aspectRatio).toBe(true);
        expect(adapter.state().aspectRatio).toBe('no');
        expect(adapter.state().aspectPresets.map(({ value }) => value)).toEqual(
            ['no', 'cover', 'fill']
        );
        expect(video.style.objectFit).toBe('contain');
    });

    it.each([
        ['cover', 'cover'],
        ['fill', 'fill'],
        ['no', 'contain'],
    ])(
        'applies %s to the whole viewport and reports the selection',
        (mode, fit) => {
            adapter.attach(video);
            adapter.commands.setAspectRatio(mode);
            expect(video.style.objectFit).toBe(fit);
            expect(video.style.width).toBe('100%');
            expect(video.style.height).toBe('100%');
            expect(adapter.state().aspectRatio).toBe(mode);
            expect(localStorage.getItem('web-player-scaling')).toBe(mode);
        }
    );

    it('remembers fill across episode replacement and a new player host', () => {
        adapter.attach(video);
        adapter.commands.setAspectRatio('cover');
        const next = document.createElement('video');
        adapter.attach(next);
        expect(next.style.objectFit).toBe('cover');
        adapter.detach();
        adapter = new WebVideoControlsAdapter();
        adapter.attach(video);
        expect(video.style.objectFit).toBe('cover');
        expect(adapter.state().aspectRatio).toBe('cover');
    });

    it('restores the old engine styles on rebind and teardown', () => {
        video.style.setProperty('object-fit', 'scale-down', 'important');
        video.style.width = '80%';
        adapter.attach(video);
        adapter.commands.setAspectRatio('fill');
        adapter.attach(document.createElement('video'));
        expect(video.style.objectFit).toBe('scale-down');
        expect(video.style.getPropertyPriority('object-fit')).toBe('important');
        expect(video.style.width).toBe('80%');
        expect(video.style.height).toBe('');
    });

    it('rejects unknown saved values and commands', () => {
        localStorage.setItem('web-player-scaling', '16:9');
        adapter.attach(video);
        adapter.commands.setAspectRatio('unexpected');
        expect(video.style.objectFit).toBe('contain');
        expect(adapter.state().aspectRatio).toBe('no');
    });

    it('continues scaling when preference storage is unavailable', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('Storage denied');
        });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Storage denied');
        });
        adapter.attach(video);
        expect(() => adapter.commands.setAspectRatio('cover')).not.toThrow();
        expect(adapter.state().aspectRatio).toBe('cover');
        expect(video.style.objectFit).toBe('cover');
    });
});
