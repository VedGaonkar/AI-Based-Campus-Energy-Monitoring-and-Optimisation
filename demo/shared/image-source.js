// Shared bounded getUserMedia image transport; purpose/auth stay in each app.
export function captureJpeg(video, maximum = 640, quality = .72) {
  if (!video.videoWidth || !video.videoHeight) throw new Error("Waiting for a usable camera frame");
  const canvas = document.createElement("canvas"), scale = Math.min(1, maximum / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL("image/jpeg", quality).split(",")[1];
  if (image.length > 340000) throw new Error("Image exceeds 250KB; lower resolution or reduce scene detail");
  return { mime: "image/jpeg", image };
}
