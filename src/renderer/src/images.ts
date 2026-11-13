// Read a picture the user picked and shrink it, so logos, signatures and item photos stay small
// inside the business file (and its backups).
import { inkOnly } from '@shared/inkOnly'

export interface ImageOptions {
  maxWidth: number
  maxHeight: number
  /** PNG keeps transparency (logos, signatures); JPEG is smaller for photos. */
  format: 'png' | 'jpeg'
  /** A signature photographed on paper: keep only the ink, the paper becomes transparent. */
  inkOnly?: boolean
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,.jpg,.jpeg,.png,.webp'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

/** The file's bytes as a data URL. (The page only allows data: pictures, so blob: links would be blocked.) */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read'))
    reader.readAsDataURL(file)
  })
}

/** Load a picture from a data URL. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('That picture could not be opened. Use a JPG, PNG or WebP picture.'))
    el.src = src
  })
}

export async function imageToDataUrl(file: File, o: ImageOptions): Promise<string> {
  // Some cameras and phones save JPEGs with an empty or odd type; go by the extension too.
  const okType = /^image\/(png|jpeg|jpg|pjpeg|webp)$/.test(file.type) || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name))
  if (!okType) throw new Error('Choose a PNG, JPEG or WebP picture')
  const img = await loadImage(await fileToDataUrl(file))
  const scale = Math.min(1, o.maxWidth / img.naturalWidth, o.maxHeight / img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  if (o.format === 'jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  if (o.inkOnly && o.format === 'png') {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (inkOnly(data.data)) ctx.putImageData(data, 0, 0)
  }
  return canvas.toDataURL(o.format === 'png' ? 'image/png' : 'image/jpeg', 0.85)
}

/** Pick a picture and return it shrunk, or null if the user cancelled. */
export async function chooseImage(o: ImageOptions): Promise<string | null> {
  const file = await pickImage()
  return file ? imageToDataUrl(file, o) : null
}
