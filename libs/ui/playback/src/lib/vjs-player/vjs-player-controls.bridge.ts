import type { WebVideoControlsOptions } from '../player-controls/web-video-controls.adapter';
import type { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { VjsAudioTracks } from './vjs-audio-tracks';
import type { VideoJsPlayer } from './vjs-player.types';
import { VjsQualityLevels } from './vjs-quality-levels';
import { VjsTextTracks } from './vjs-text-tracks';
import type { PlayerSubtitleTarget } from '../player-controls/player-controls.model';
import {
    WebVideoExternalSubtitles,
    pickExternalSubtitleFile,
} from '../web-video-support/web-video-external-subtitles';

export interface VjsPlayerControlsBridgeConfig {
    player: VideoJsPlayer;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}

export class VjsPlayerControlsBridge {
    private readonly audioTracks: VjsAudioTracks;
    private readonly textTracks: VjsTextTracks;
    private readonly qualityLevels: VjsQualityLevels;
    private readonly externalSubtitles: WebVideoExternalSubtitles;
    private video: HTMLVideoElement | null = null;
    private sourceActive = false;
    private sourceGeneration = 0;
    private destroyed = false;

    private readonly adapterOptions: WebVideoControlsOptions = {
        isLive: () => this.config.isLive(),
        getDuration: () => this.readDuration(),
        getAudioTracks: () => this.audioTracks.getAudioTracks(),
        setAudioTrack: (id) => this.audioTracks.setAudioTrack(id),
        getSubtitleTracks: () => [
            ...this.textTracks.getSubtitleTracks(),
            ...this.externalSubtitles.getTracks(),
        ],
        setSubtitleTrack: (id) => this.selectSubtitleTrack(id),
        addExternalSubtitleFile: () => this.pickExternalSubtitle(),
        getSubtitleTarget: () => this.getSubtitleTarget(),
        getSubtitleDelay: () => this.externalSubtitles.getDelay(),
        setSubtitleDelay: (seconds) => {
            this.externalSubtitles.setDelay(seconds);
            // Emulated tracks do not emit cuechange for timing edits while paused.
            this.config.player.getChild('textTrackDisplay')?.updateDisplay?.();
        },
        canAdjustSubtitleDelay: () => this.externalSubtitles.hasSelectedTrack(),
        getQualityLevels: () => this.qualityLevels.getQualityLevels(),
        setQualityLevel: (id) => this.qualityLevels.setQualityLevel(id),
        isAutoQualityEnabled: () => this.qualityLevels.isAutoQualityEnabled(),
        getEngineStats: () => this.qualityLevels.getActiveLevelStats(),
    };

    constructor(private readonly config: VjsPlayerControlsBridgeConfig) {
        const refresh = () => this.config.adapter.refresh();
        // Video.js owns its TextTrack renderer, which may emulate tracks instead
        // of exposing the Tech video's native tracks. Attach through its API.
        this.externalSubtitles = new WebVideoExternalSubtitles({
            getVideo: () =>
                this.video
                    ? {
                          addTextTrack: (kind, label, language) =>
                              config.player.addTextTrack(
                                  kind,
                                  label,
                                  language
                              ) as TextTrack,
                      }
                    : null,
            deselectEngineSubtitles: () => this.textTracks.setSubtitleTrack(-1),
            refresh,
        });
        this.audioTracks = new VjsAudioTracks({
            player: config.player,
            refresh,
        });
        this.textTracks = new VjsTextTracks({
            player: config.player,
            showCaptions: config.showCaptions,
            refresh,
            excludeTrack: (track) =>
                this.externalSubtitles.ownsTrack(track as TextTrack),
        });
        this.qualityLevels = new VjsQualityLevels({
            player: config.player,
            refresh,
        });
    }

    attach(video: HTMLVideoElement): void {
        if (this.destroyed || this.video === video) {
            return;
        }

        if (this.video) {
            this.sourceGeneration += 1;
            this.externalSubtitles.clear();
        }
        this.video = video;
        this.config.adapter.attach(video, this.adapterOptions);
        if (this.sourceActive) {
            this.bindTrackLists();
        }
    }

    rebind(video: HTMLVideoElement): void {
        this.attach(video);
    }

    setSource(): void {
        if (this.destroyed) {
            return;
        }

        this.sourceGeneration += 1;
        this.externalSubtitles.clear();
        this.audioTracks.resetSource();
        this.textTracks.resetSource();
        this.qualityLevels.resetSource();
        this.sourceActive = true;
        this.bindTrackLists();
        this.config.adapter.refresh();
    }

    refreshInputs(): void {
        if (this.destroyed) {
            return;
        }

        if (this.sourceActive) {
            this.bindTrackLists();
            this.textTracks.refreshInputs();
        }
        this.config.adapter.refresh();
    }

    clearSource(): void {
        if (this.destroyed) {
            return;
        }

        this.sourceGeneration += 1;
        this.externalSubtitles.clear();
        this.audioTracks.clear();
        this.textTracks.clear();
        this.qualityLevels.clear();
        this.sourceActive = false;
        this.config.adapter.refresh();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.sourceGeneration += 1;
        this.externalSubtitles.clear();
        this.audioTracks.clear();
        this.textTracks.clear();
        this.qualityLevels.clear();
        if (this.video) {
            this.config.adapter.detach();
        }
        this.video = null;
        this.sourceActive = false;
        this.destroyed = true;
    }

    private getSubtitleTarget(): PlayerSubtitleTarget | null {
        if (this.destroyed || !this.sourceActive || !this.video) return null;
        const generation = this.sourceGeneration;
        return {
            key: String(generation),
            load: (file) => {
                if (this.destroyed || generation !== this.sourceGeneration)
                    return false;
                const loaded = this.externalSubtitles.addFromFile(file);
                this.config.adapter.refresh();
                return loaded;
            },
        };
    }

    private pickExternalSubtitle(): void {
        const target = this.getSubtitleTarget();
        if (!target || !this.video) return;
        pickExternalSubtitleFile(this.video.ownerDocument, (file) =>
            target.load(file)
        );
    }

    private selectSubtitleTrack(id: number): void {
        if (this.externalSubtitles.ownsTrackId(id)) {
            this.externalSubtitles.select(id);
        } else {
            this.externalSubtitles.deselectAll();
            this.textTracks.setSubtitleTrack(id);
        }
    }

    private bindTrackLists(): void {
        this.audioTracks.bind();
        this.textTracks.bind();
        this.qualityLevels.bind();
    }

    private readDuration(): number {
        try {
            const duration = this.config.player.duration();
            return typeof duration === 'number' ? duration : NaN;
        } catch {
            return NaN;
        }
    }
}
