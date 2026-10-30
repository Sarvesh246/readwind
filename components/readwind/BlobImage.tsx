"use client";
import {useEffect,useState} from "react";
export function BlobImage({
  id,
  loadBlob,
  alt = "",
  className,
}: {
  id: string;
  loadBlob: (id: string) => Promise<Blob | undefined>;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true,
      url = "";
    loadBlob(id)
      .then((b) => {
        if (b && alive) {
          url = URL.createObjectURL(b);
          setUrl(url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, loadBlob]);
  return url ? (
    <img src={url} alt={alt} className={className} />
  ) : (
    <span className="image-loading">Image · connect to download</span>
  );
}
