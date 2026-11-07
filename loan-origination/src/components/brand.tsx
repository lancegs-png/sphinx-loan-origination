/* eslint-disable @next/next/no-img-element */
/**
 * Sphinx Capital brand assets — official logo files in /public/brand.
 *   - sphinx-logo.png  — full gold lockup (winged sphinx + "Sphinx Capital"), transparent
 *   - sphinx-tile.png  — gold winged sphinx on a navy tile (favicon / compact mark)
 * Do not recreate the mark.
 */

export function SphinxLogo({
  height = 48,
  fluid = false,
  className,
  alt = "Sphinx Capital",
}: {
  height?: number;
  fluid?: boolean;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/brand/sphinx-logo.png"
      alt={alt}
      className={className}
      style={fluid ? { width: "100%", height: "auto" } : { height, width: "auto" }}
    />
  );
}

/** Self-contained navy tile with the gold sphinx — for compact chrome and avatars. */
export function SphinxTile({
  size = 36,
  className,
  rounded = 10,
  alt = "Sphinx Capital",
}: {
  size?: number;
  className?: string;
  rounded?: number;
  alt?: string;
}) {
  return (
    <img
      src="/brand/sphinx-tile.png"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ height: size, width: size, borderRadius: rounded }}
    />
  );
}
