export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_LABEL = "5MB";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

export function getImageUploadError(file: File, label = "Image") {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `${label} must be a JPG, JPEG, or PNG image.`;
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `${label} must be ${IMAGE_UPLOAD_MAX_LABEL} or smaller.`;
  }

  return "";
}

export function getFileSizeError(file: File, label = "File") {
  return file.size > MAX_IMAGE_UPLOAD_BYTES ? `${label} must be ${IMAGE_UPLOAD_MAX_LABEL} or smaller.` : "";
}
