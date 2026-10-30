const MAX_COVER_WIDTH = 1200;
const MAX_COVER_HEIGHT = 1800;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("That image could not be opened. Try a JPG or PNG."));
    image.src = url;
  });
}

/**
 * Normalises an uploaded cover to a print-sized JPEG so a phone photo does
 * not bloat the local database or the sync queue.
 */
export async function prepareCoverImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/"))
    throw new Error("Choose an image file such as JPG, PNG, or WebP.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Choose a cover image under 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight)
      throw new Error("That image could not be read. Try another file.");
    const scale = Math.min(
      1,
      MAX_COVER_WIDTH / sourceWidth,
      MAX_COVER_HEIGHT / sourceHeight,
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this cover image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) throw new Error("Could not prepare this cover image.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
