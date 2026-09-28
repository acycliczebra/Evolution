import { useEffect, useState } from "react";
import { md5 } from "../md5";

/** Direct Wikimedia Commons thumbnail URL (path is derived from the MD5 of the file name). */
export function commonsThumb(file: string, width: number): string {
  const f = file.replace(/ /g, "_");
  if (/\.tiff?$/i.test(f)) return filePath(file, width);
  const h = md5(f);
  const enc = encodeURIComponent(f);
  const suffix = /\.(svg|xcf)$/i.test(f) ? ".png" : "";
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${enc}/${width}px-${enc}${suffix}`;
}

/** Special:FilePath resolves both Commons and local enwiki files, and small originals. */
const filePath = (file: string, width: number) =>
  `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=${width}`;

interface Props {
  file?: string;
  width: number;
  className?: string;
  glyph?: string;
}

/** Wikimedia image with fallbacks: Commons thumb → Special:FilePath → placeholder glyph. */
export function Img({ file, width, className = "", glyph = "🧬" }: Props) {
  const [stage, setStage] = useState(0);
  useEffect(() => setStage(0), [file]);
  if (!file || stage > 1) return <div className={`noimg ${className}`}>{glyph}</div>;
  const src = stage === 0 ? commonsThumb(file, width) : filePath(file, width);
  return <img className={className} loading="lazy" src={src} alt="" onError={() => setStage(s => s + 1)} />;
}
