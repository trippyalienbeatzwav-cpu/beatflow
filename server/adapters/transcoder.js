// Video transcoding adapter. When ffmpeg is on PATH, uploaded videos get a 720p H.264/AAC MP4
// rendition with a faststart moov atom. Without ffmpeg, the original (already validated) file is
// served as-is and the media row records that no renditions exist. Adaptive streaming (HLS ladders)
// belongs in a managed pipeline (e.g. Mux or AWS MediaConvert); see docs/SOCIAL.md.
import { spawn, spawnSync } from "node:child_process";

export function createTranscoder() {
  let available = false;
  try { available = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 }).status === 0; } catch { available = false; }
  return {
    name: available ? "ffmpeg" : "none",
    available,
    /** Returns a Promise<boolean>: true when output was written. Not run in this environment (no ffmpeg). */
    rendition720(input, output) {
      if (!available) return Promise.resolve(false);
      return new Promise((resolve) => {
        const p = spawn("ffmpeg", ["-y", "-i", input, "-vf", "scale='min(720,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output], { stdio: "ignore" });
        p.on("close", (code) => resolve(code === 0));
        p.on("error", () => resolve(false));
      });
    },
  };
}
