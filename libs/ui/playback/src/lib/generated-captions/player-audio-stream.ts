/** Desktop captures only its own app audio; web retains element capture security. */
export async function capturePlayerAudio(
    video: HTMLVideoElement
): Promise<MediaStream> {
    if (window.electron?.platform && navigator.mediaDevices?.getDisplayMedia) {
        // Main grants only the trusted main frame's own WebContents. Display capture
        // requires a video track; discard it immediately and process audio only.
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 1, width: 1, height: 1 },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                suppressLocalAudioPlayback: false,
            } as MediaTrackConstraints,
        });
        for (const track of stream.getVideoTracks()) {
            track.stop();
            stream.removeTrack(track);
        }
        return stream;
    }
    const capture = (
        video as HTMLVideoElement & {
            captureStream?: () => MediaStream;
        }
    ).captureStream;
    if (!capture)
        throw new Error(
            'This player does not support audio capture for captions.'
        );
    return capture.call(video);
}
