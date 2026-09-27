/* ==========================================================================
   Chunked, resumable uploads to /api/media/uploads (the same pipeline Social
   uses). Files are sent in parallel 1 MB chunks with per-chunk retries; the
   server re-validates the content (WAV/AIFF headers, ZIP directories, image
   dimensions) and stores masters and stems privately.
   ========================================================================== */
(function () {
  const TYPES = { wav: "audio/wav", wave: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff", aifc: "audio/aiff", zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  BF.mimeOf = (file) => TYPES[(file.name.split(".").pop() || "").toLowerCase()] ?? file.type;

  async function putChunk(url, blob, signal) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { method: "PUT", body: blob, signal, credentials: "same-origin", headers: { "x-tunibeat-csrf": "1", "content-type": "application/octet-stream" } });
        if (res.ok) return;
        const body = await res.json().catch(() => null);
        if (res.status < 500 && res.status !== 429) throw new BF.ApiError(res.status, body);
        if (attempt >= 3) throw new BF.ApiError(res.status, body);
      } catch (err) {
        if (signal?.aborted || err instanceof BF.ApiError) throw err;
        if (attempt >= 3) throw new BF.ApiError(0, { error: { code: "network", message: "The upload was interrupted. Check your connection and retry." } });
      }
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
    }
  }

  /**
   * Upload a file for a purpose ("master_audio", "stems_archive", "artwork", …).
   * Returns { promise, cancel }; onProgress(fraction) reports bytes sent.
   */
  BF.uploadFile = (file, purpose, { onProgress } = {}) => {
    const ctl = new AbortController();
    let sessionId = null;
    const promise = (async () => {
      const mime = BF.mimeOf(file);
      const meta = {};
      if (mime.startsWith("image/")) {
        const img = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("That image couldn’t be read.")); }; i.src = u; });
        meta.width = img.naturalWidth; meta.height = img.naturalHeight;
      }
      const { upload } = await BF.http.post("/api/media/uploads", { purpose, mime, bytes: file.size, filename: file.name, ...meta });
      sessionId = upload.id;
      const total = upload.chunks, size = upload.chunk_size;
      let next = 0, sent = 0;
      const worker = async () => {
        while (next < total) {
          const i = next++;
          const blob = file.slice(i * size, Math.min(file.size, (i + 1) * size));
          await putChunk(`/api/media/uploads/${upload.id}/chunks/${i}`, blob, ctl.signal);
          sent += blob.size;
          onProgress?.(sent / file.size);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
      const done = await BF.http.post(`/api/media/uploads/${upload.id}/complete`, {}, { timeout: 120000 });
      return done.media;
    })();
    return { promise, cancel() { ctl.abort(); if (sessionId) BF.http.del(`/api/media/uploads/${sessionId}`).catch(() => {}); } };
  };
})();
