"use client";

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { getMediaSrc } from "@/lib/media";

type MediaImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  fallback?: ReactNode;
  fallbackClassName?: string;
  fallbackLabel?: string;
  source?: string | null;
};

export default function MediaImage({ fallback, fallbackClassName = "", fallbackLabel, onError, source, ...imageProps }: MediaImageProps) {
  const sourceUrl = getMediaSrc(source);
  const [hasFailed, setHasFailed] = useState(!sourceUrl);

  useEffect(() => {
    setHasFailed(!sourceUrl);
  }, [sourceUrl]);

  if (hasFailed) {
    return fallback || (
      <span aria-label={fallbackLabel || imageProps.alt || "Image unavailable"} className={fallbackClassName} role="img">
        Image unavailable
      </span>
    );
  }

  return (
    <img
      {...imageProps}
      onError={(event) => {
        setHasFailed(true);
        onError?.(event);
      }}
      src={sourceUrl}
    />
  );
}
