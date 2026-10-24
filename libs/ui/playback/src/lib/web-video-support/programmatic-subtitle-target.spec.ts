import type { PlayerSubtitleFile } from '../player-controls/player-controls.model';
import { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { VjsPlayerControlsBridge } from '../vjs-player/vjs-player-controls.bridge';
import type { VideoJsPlayer } from '../vjs-player/vjs-player.types';
import { WebVideoSourceControlsBridge } from './web-video-source-controls.bridge';

const subtitle: PlayerSubtitleFile = {
    name: 'English.srt',
    format: 'srt',
    content: '1\n00:00:01,000 --> 00:00:03,000\nHello\n',
};

class TestCue {
    constructor(
        public startTime: number,
        public endTime: number,
        public text: string
    ) {}
}

function createTrack(label: string) {
    const cues: TestCue[] = [];
    return {
        label,
        kind: 'subtitles',
        mode: 'hidden' as TextTrackMode,
        cues,
        addCue: (cue: TestCue) => cues.push(cue),
        removeCue: (cue: TestCue) => cues.splice(cues.indexOf(cue), 1),
    };
}

describe('source-bound programmatic subtitle targets', () => {
    const originalCue = globalThis.VTTCue;
    beforeEach(() => {
        globalThis.VTTCue = TestCue as unknown as typeof VTTCue;
    });
    afterEach(() => {
        globalThis.VTTCue = originalCue;
    });

    it('loads native web tracks and rejects results after source change, clear, or destroy', () => {
        const video = document.createElement('video');
        const addTextTrack = jest.fn((_kind, label) => createTrack(label));
        Object.defineProperty(video, 'addTextTrack', { value: addTextTrack });
        const adapter = new WebVideoControlsAdapter();
        const bridge = new WebVideoSourceControlsBridge({
            video,
            adapter,
            isLive: () => false,
            showCaptions: () => false,
        });
        bridge.attach();
        expect(adapter.getSubtitleTarget()).toBeNull();
        bridge.setSource({ kind: 'native' });
        const target = adapter.getSubtitleTarget();
        expect(target?.key).toBeDefined();
        expect(adapter.getSubtitleTarget()?.key).toBe(target?.key);
        expect(target?.load(subtitle)).toBe(true);
        expect(adapter.state().subtitleTracks).toEqual([
            { id: 100000, label: 'English.srt', selected: true },
        ]);
        const track = addTextTrack.mock.results[0].value;
        expect(track.cues).toEqual([new TestCue(1, 3, 'Hello')]);
        bridge.setSource({ kind: 'native' });
        expect(track.mode).toBe('disabled');
        expect(track.cues).toEqual([]);
        expect(target?.load(subtitle)).toBe(false);
        const next = adapter.getSubtitleTarget();
        expect(next?.key).not.toBe(target?.key);
        bridge.clearSource();
        expect(next?.load(subtitle)).toBe(false);
        expect(adapter.getSubtitleTarget()).toBeNull();
        bridge.setSource({ kind: 'native' });
        const last = adapter.getSubtitleTarget();
        bridge.destroy();
        expect(last?.load(subtitle)).toBe(false);
        expect(addTextTrack).toHaveBeenCalledTimes(1);
    });

    it('uses the Video.js track renderer, merges engine tracks, and removes stale owned cues', () => {
        const engineTrack = createTrack('Embedded English');
        engineTrack.mode = 'showing';
        const textTracks = Object.assign([engineTrack], {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        });
        const addTextTrack = jest.fn((_kind, label) => {
            const track = createTrack(label);
            textTracks.push(track);
            return track;
        });
        const player = {
            addTextTrack,
            textTracks: () => textTracks,
            audioTracks: () => [],
            duration: () => 120,
            qualityLevels: () => null,
        } as unknown as VideoJsPlayer;
        const video = document.createElement('video');
        const adapter = new WebVideoControlsAdapter();
        const bridge = new VjsPlayerControlsBridge({
            player,
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });
        bridge.attach(video);
        expect(adapter.getSubtitleTarget()).toBeNull();
        bridge.setSource();
        const target = adapter.getSubtitleTarget();
        expect(target?.key).toBeDefined();
        expect(adapter.getSubtitleTarget()?.key).toBe(target?.key);
        expect(target?.load(subtitle)).toBe(true);
        expect(addTextTrack).toHaveBeenCalledWith(
            'subtitles',
            'English.srt',
            undefined
        );
        expect(adapter.state().subtitleTracks).toEqual([
            { id: 0, label: 'Embedded English', selected: false },
            { id: 100000, label: 'English.srt', selected: true },
        ]);
        adapter.commands.setSubtitleDelay(1.5);
        expect(textTracks[1].cues[0].startTime).toBe(2.5);
        adapter.commands.setSubtitleTrack(0);
        expect(textTracks[0].mode).toBe('showing');
        expect(textTracks[1].mode).toBe('hidden');
        adapter.commands.setSubtitleTrack(100000);
        expect(textTracks[1].mode).toBe('showing');
        expect(textTracks[0].mode).toBe('disabled');
        bridge.setSource();
        expect(textTracks[1].cues).toEqual([]);
        expect(target?.load(subtitle)).toBe(false);
        expect(adapter.state().subtitleTracks).toHaveLength(1);
        expect(adapter.state().subtitleDelaySeconds).toBe(0);
        const cleared = adapter.getSubtitleTarget();
        bridge.clearSource();
        expect(cleared?.load(subtitle)).toBe(false);
        bridge.setSource();
        const rebound = adapter.getSubtitleTarget();
        bridge.rebind(document.createElement('video'));
        expect(rebound?.load(subtitle)).toBe(false);
        const destroyed = adapter.getSubtitleTarget();
        bridge.destroy();
        expect(destroyed?.load(subtitle)).toBe(false);
        expect(addTextTrack).toHaveBeenCalledTimes(1);
    });

    it('rejects unusable subtitle content without creating a track', () => {
        const video = document.createElement('video');
        const addTextTrack = jest.fn();
        Object.defineProperty(video, 'addTextTrack', { value: addTextTrack });
        const adapter = new WebVideoControlsAdapter();
        const bridge = new WebVideoSourceControlsBridge({
            video,
            adapter,
            isLive: () => false,
            showCaptions: () => false,
        });
        bridge.attach();
        bridge.setSource({ kind: 'native' });
        expect(
            adapter
                .getSubtitleTarget()
                ?.load({ ...subtitle, content: 'invalid' })
        ).toBe(false);
        expect(addTextTrack).not.toHaveBeenCalled();
        bridge.destroy();
    });
});
