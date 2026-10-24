import type { PlayerPreset } from './player-controls.model';

type ScalingMode = 'no' | 'cover' | 'fill';
const STORAGE_KEY = 'web-player-scaling';
const FIT = { no: 'contain', cover: 'cover', fill: 'fill' } as const;
const PROPERTIES = ['object-fit', 'width', 'height'] as const;

export const WEB_VIDEO_SCALING_PRESETS: ReadonlyArray<PlayerPreset<string>> = [
    { value: 'no', label: 'EMBEDDED_MPV.PLAYER.SCALING_FIT' },
    { value: 'cover', label: 'EMBEDDED_MPV.PLAYER.SCALING_COVER' },
    { value: 'fill', label: 'EMBEDDED_MPV.PLAYER.SCALING_STRETCH' },
];

/** Shared web engines use the same saved scaling choice and restore vendor styles. */
export class WebVideoScaling {
    mode: ScalingMode = 'no';
    private video: HTMLVideoElement | null = null;
    private restore: (() => void) | null = null;

    attach(video: HTMLVideoElement): void {
        this.detach();
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            this.mode = isScalingMode(saved) ? saved : 'no';
        } catch {
            // Storage is optional; scaling still works for this player session.
        }
        const previous = PROPERTIES.map((name) => ({
            name,
            value: video.style.getPropertyValue(name),
            priority: video.style.getPropertyPriority(name),
        }));
        this.restore = () => {
            for (const { name, value, priority } of previous) {
                if (value) video.style.setProperty(name, value, priority);
                else video.style.removeProperty(name);
            }
        };
        this.video = video;
        this.apply();
    }

    select(value: string): void {
        if (!this.video || !isScalingMode(value)) return;
        this.mode = value;
        this.apply();
        try {
            localStorage.setItem(STORAGE_KEY, value);
        } catch {
            // A denied write must not prevent changing the current picture.
        }
    }

    detach(): void {
        this.restore?.();
        this.restore = null;
        this.video = null;
    }

    private apply(): void {
        // Fit against the whole viewport, including fullscreen, rather than
        // an engine's intrinsic/aspect-constrained video box.
        this.video?.style.setProperty('width', '100%', 'important');
        this.video?.style.setProperty('height', '100%', 'important');
        this.video?.style.setProperty(
            'object-fit',
            FIT[this.mode],
            'important'
        );
    }
}

function isScalingMode(value: string | null): value is ScalingMode {
    return value === 'no' || value === 'cover' || value === 'fill';
}
