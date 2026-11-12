// Read a picture the user picked and shrink it, so logos, signatures and item photos stay small
// inside the business file (and its backups).

export interface ImageOptions {
  maxWidth: number
  maxHeight: number
  /** PNG keeps transparency (logos, signatures); JPEG is smaller for photos. */
  format: 'png' | 'jpeg'
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

export async function imageToDataUrl(file: File, o: ImageOptions): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That picture could not be opened'))
      el.src = url
    })
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
    return canvas.toDataURL(o.format === 'png' ? 'image/png' : 'image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Pick a picture and return it shrunk, or null if the user cancelled. */
export async function chooseImage(o: ImageOptions): Promise<string | null> {
  const file = await pickImage()
  return file ? imageToDataUrl(file, o) : null
}
