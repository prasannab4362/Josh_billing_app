// Pictures from the database (logo, signature, item photos) go into printed pages as data URLs. A doctored backup
// file could hold something else in those columns, so only a genuine base64 PNG, JPEG or WebP is let through.

const IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** The picture if it is a plain base64 image, else '' (nothing is drawn). */
export function safeImage(src: string | null | undefined): string {
  return typeof src === 'string' && src.length < 3_000_000 && IMAGE.test(src) ? src : ''
}
