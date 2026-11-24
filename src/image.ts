// Resize photos on the phone before sending: smaller uploads, faster answers, lower cost.

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through (e.g. HEIC on some browsers)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(src: ImageBitmap | HTMLImageElement, maxSide: number, quality: number): string {
  const w = src.width;
  const h = src.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareImage(file: File): Promise<{ base64: string; preview: string; thumb: string }> {
  const img = await loadImage(file);
  const full = toJpeg(img, 1280, 0.85);
  const preview = toJpeg(img, 720, 0.8);
  const thumb = toJpeg(img, 160, 0.7);
  if ("close" in img) img.close();
  return { base64: full.slice(full.indexOf(",") + 1), preview, thumb };
}
