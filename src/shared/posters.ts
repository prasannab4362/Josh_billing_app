// Marketing posters made from the business's own details: greetings, festivals, offers and
// product cards. Each template is plain HTML and CSS (shapes and gradients, no pictures), drawn
// at a fixed pixel size and saved as a PNG by the main process.

import { qrSvg } from './qr'

export type PosterCategory = 'greetings' | 'festivals' | 'offers' | 'product'
export type PosterSize = 'square' | 'story'
export type PosterLang = 'en' | 'hi' | 'ta'

export const POSTER_SIZES: Record<PosterSize, { name: string; width: number; height: number }> = {
  square: { name: 'Square (WhatsApp, Instagram post)', width: 1080, height: 1080 },
  story: { name: 'Tall (WhatsApp status, story)', width: 1080, height: 1920 }
}
export const POSTER_CATEGORIES: Record<PosterCategory, string> = {
  greetings: 'Greetings', festivals: 'Festivals', offers: 'Offers', product: 'Product'
}
export const POSTER_LANGS: Record<PosterLang, string> = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்' }

type Art = 'sun' | 'diya' | 'kolam' | 'colours' | 'moon' | 'star' | 'fireworks' | 'flag' | 'burst' | 'tag' | 'box' | 'leaf' | 'heart'

export interface PosterTemplate {
  id: string
  category: PosterCategory
  name: string
  /** Background, two colours for the gradient, and the text colour. */
  bg: [string, string]
  ink: string
  accent: string
  art: Art
  headline: Record<PosterLang, string>
  subline: Record<PosterLang, string>
}

const t = (
  id: string, category: PosterCategory, name: string, bg: [string, string], ink: string, accent: string, art: Art,
  headline: [string, string, string], subline: [string, string, string]
): PosterTemplate => ({
  id, category, name, bg, ink, accent, art,
  headline: { en: headline[0], hi: headline[1], ta: headline[2] },
  subline: { en: subline[0], hi: subline[1], ta: subline[2] }
})

export const POSTER_TEMPLATES: PosterTemplate[] = [
  t('good-morning', 'greetings', 'Good morning', ['#fff4d6', '#ffd27a'], '#5a3200', '#e8590c', 'sun',
    ['Good Morning', 'सुप्रभात', 'காலை வணக்கம்'], ['A fresh day, fresh offers', 'नया दिन, नई उम्मीदें', 'புதிய நாள், புதிய வாய்ப்புகள்']),
  t('thank-you', 'greetings', 'Thank you', ['#e7f5ff', '#a5d8ff'], '#0b3d63', '#1971c2', 'heart',
    ['Thank You', 'धन्यवाद', 'நன்றி'], ['for shopping with us', 'हमारे साथ खरीदारी करने के लिए', 'எங்களிடம் வாங்கியதற்கு']),
  t('weekend', 'greetings', 'Happy weekend', ['#f3f0ff', '#c5b5ff'], '#2b1a6b', '#7048e8', 'star',
    ['Happy Weekend', 'शुभ सप्ताहांत', 'இனிய வார இறுதி'], ['Visit us this weekend', 'इस सप्ताहांत ज़रूर आएँ', 'இந்த வார இறுதியில் வாருங்கள்']),
  t('diwali', 'festivals', 'Diwali', ['#3b0a45', '#a61e4d'], '#fff3bf', '#ffd43b', 'diya',
    ['Happy Diwali', 'शुभ दीपावली', 'தீபாவளி நல்வாழ்த்துகள்'], ['May your home shine with joy', 'आपका घर खुशियों से जगमगाए', 'உங்கள் இல்லம் ஒளிரட்டும்']),
  t('pongal', 'festivals', 'Pongal', ['#fff9db', '#ffe066'], '#5c3d00', '#e67700', 'kolam',
    ['Happy Pongal', 'पोंगल की शुभकामनाएँ', 'இனிய பொங்கல் நல்வாழ்த்துகள்'], ['A sweet harvest to all', 'सबके लिए मीठी फ़सल', 'அனைவருக்கும் இனிய அறுவடை']),
  t('holi', 'festivals', 'Holi', ['#fff0f6', '#d0bfff'], '#4a1060', '#e64980', 'colours',
    ['Happy Holi', 'होली की शुभकामनाएँ', 'இனிய ஹோலி'], ['Colours of joy for you', 'रंगों भरी खुशियाँ', 'வண்ணமயமான மகிழ்ச்சி']),
  t('eid', 'festivals', 'Eid', ['#0b3d2e', '#2b8a3e'], '#f4fce3', '#fab005', 'moon',
    ['Eid Mubarak', 'ईद मुबारक', 'ஈத் முபாரக்'], ['Peace and blessings to you', 'आपको अमन और बरकत', 'அமைதியும் ஆசியும் பெருகட்டும்']),
  t('christmas', 'festivals', 'Christmas', ['#7a0e14', '#c92a2a'], '#fff5f5', '#ffe066', 'star',
    ['Merry Christmas', 'क्रिसमस की शुभकामनाएँ', 'கிறிஸ்துமஸ் நல்வாழ்த்துகள்'], ['Joy, peace and love', 'खुशी, शांति और प्रेम', 'மகிழ்ச்சி, அமைதி, அன்பு']),
  t('new-year', 'festivals', 'New Year', ['#0c1340', '#364fc7'], '#e7f5ff', '#fcc419', 'fireworks',
    ['Happy New Year', 'नव वर्ष की शुभकामनाएँ', 'புத்தாண்டு நல்வாழ்த்துகள்'], ['Thank you for a wonderful year', 'शानदार साल के लिए धन्यवाद', 'அருமையான ஆண்டுக்கு நன்றி']),
  t('independence', 'festivals', 'Independence Day', ['#ffffff', '#fff4e6'], '#1c2a5e', '#ff922b', 'flag',
    ['Happy Independence Day', 'स्वतंत्रता दिवस की शुभकामनाएँ', 'இனிய சுதந்திர தின வாழ்த்துகள்'], ['Proud to be Indian', 'गर्व है हम भारतीय हैं', 'இந்தியர் என்பதில் பெருமை']),
  t('onam', 'festivals', 'Onam', ['#ebfbee', '#b2f2bb'], '#1b4332', '#f08c00', 'leaf',
    ['Happy Onam', 'ओणम की शुभकामनाएँ', 'இனிய ஓணம் நல்வாழ்த்துகள்'], ['Prosperity and happiness', 'समृद्धि और खुशहाली', 'வளமும் மகிழ்ச்சியும்']),
  t('review-us', 'greetings', 'Review us on Google', ['#ffffff', '#e7f5ff'], '#1c2a5e', '#1971c2', 'star',
    ['Loved shopping with us?', 'हमारी सेवा पसंद आई?', 'எங்கள் சேவை பிடித்ததா?'], ['Scan to rate us on Google', 'स्कैन करके Google पर रेटिंग दें', 'ஸ்கேன் செய்து Google-இல் மதிப்பிடுங்கள்']),
  t('sale', 'offers', 'Big sale', ['#c92a2a', '#f76707'], '#fff9db', '#ffe066', 'burst',
    ['Big Sale', 'बड़ी सेल', 'மாபெரும் தள்ளுபடி'], ['Up to 50% off. Limited time!', '50% तक की छूट। सीमित समय!', '50% வரை தள்ளுபடி. குறுகிய காலம்!']),
  t('new-arrivals', 'offers', 'New arrivals', ['#212529', '#495057'], '#f8f9fa', '#20c997', 'tag',
    ['New Arrivals', 'नया स्टॉक आ गया', 'புதிய வரவுகள்'], ['Fresh stock in store now', 'अभी दुकान पर उपलब्ध', 'இப்போது கடையில் கிடைக்கும்']),
  t('free-delivery', 'offers', 'Free delivery', ['#e6fcf5', '#96f2d7'], '#08433a', '#0ca678', 'box',
    ['Free Home Delivery', 'मुफ़्त होम डिलीवरी', 'இலவச வீட்டு டெலிவரி'], ['Order on WhatsApp', 'व्हाट्सऐप पर ऑर्डर करें', 'வாட்ஸ்அப்பில் ஆர்டர் செய்யுங்கள்']),
  t('product', 'product', 'Product card', ['#f8f9fa', '#e9ecef'], '#212529', '#e8590c', 'tag',
    ['', '', ''], ['Available now', 'अभी उपलब्ध', 'இப்போது கிடைக்கும்']),
  t('product-dark', 'product', 'Product card, dark', ['#1b1f3b', '#3b3f6b'], '#f1f3f5', '#ffd43b', 'burst',
    ['', '', ''], ['Best price in town', 'सबसे अच्छी कीमत', 'சிறந்த விலை'])
]

export interface PosterData {
  businessName: string
  /** Data URL, or ''. */
  logo: string
  phone: string
  contact: string
  address: string
  headline: string
  subline: string
  /** Ribbon text, e.g. "Flat 10% off on Sundays"; '' to leave off. */
  offer: string
  /** A link to show as a QR code under the words (e.g. the Google review link); '' for none. */
  qr?: string
  /** Product templates. Prices in paise. */
  itemName?: string
  itemPhoto?: string
  price?: number | null
  mrp?: number | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** Decorative shapes for each template, drawn with CSS only. */
function artHtml(art: Art, accent: string, ink: string): string {
  const dots = (n: number, colours: string[], size: [number, number]) =>
    Array.from({ length: n }, (_, i) => {
      // Spread pseudo-randomly but the same every time, so a poster looks the same each time it is made.
      const x = (i * 37 + 11) % 100
      const y = (i * 53 + 7) % 100
      const s = size[0] + ((i * 29) % (size[1] - size[0]))
      return `<i style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;background:${colours[i % colours.length]}"></i>`
    }).join('')
  switch (art) {
    case 'sun': return `<div class="art sun" style="--a:${accent}"></div>`
    case 'heart': return `<div class="art confetti">${dots(18, [accent, '#ffffff', '#74c0fc'], [10, 26])}</div>`
    case 'star': return `<div class="art confetti">${dots(26, [accent, '#ffffff'], [6, 16])}</div>`
    case 'diya': return `<div class="art confetti">${dots(30, [accent, '#ffa94d'], [4, 12])}</div>`
    case 'kolam': return `<div class="art kolam" style="--a:${accent}"></div>`
    case 'colours': return `<div class="art splash">${dots(14, ['#f06595', '#cc5de8', '#5c7cfa', '#22b8cf', '#fcc419', '#51cf66'], [80, 220])}</div>`
    case 'moon': return `<div class="art moon" style="--a:${accent}"></div><div class="art confetti">${dots(22, [accent, '#ffffff'], [4, 10])}</div>`
    case 'fireworks': return `<div class="art fireworks" style="--a:${accent}"><b></b><b></b><b></b></div><div class="art confetti">${dots(30, [accent, '#ffffff', '#74c0fc'], [4, 10])}</div>`
    case 'flag': return `<div class="art flag"><b></b><b></b><b></b></div>`
    case 'burst': return `<div class="art burst" style="--a:${accent}"></div>`
    case 'tag': return `<div class="art rings" style="--a:${accent}"></div>`
    case 'box': return `<div class="art rings" style="--a:${accent}"></div>`
    case 'leaf': return `<div class="art leaves" style="--a:${accent}"><b></b><b></b><b></b><b></b></div>`
  }
  void ink
  return ''
}

/** The poster as a page exactly the size of the image. */
export function posterHtml(tpl: PosterTemplate, d: PosterData, size: PosterSize): string {
  const { width, height } = POSTER_SIZES[size]
  const product = tpl.category === 'product'
  const saving = product && d.mrp && d.price && d.mrp > d.price ? Math.round(((d.mrp - d.price) / d.mrp) * 100) : 0
  // The heading shrinks so its longest word fits the width (Tamil and Hindi words run long).
  const longest = Math.max(1, ...d.headline.split(/\s+/).map((w) => [...w].length))
  const headSize = Math.round(Math.min(size === 'story' ? 150 : 128, (width - 160) / (longest * 0.62), d.headline.length > 28 ? 96 : 999))
  const centre = product
    ? `<div class="product">
        ${d.itemPhoto ? `<div class="photo"><img src="${d.itemPhoto}" alt=""></div>` : `<div class="photo none">${esc((d.itemName || '?').slice(0, 1))}</div>`}
        <div class="pname">${esc(d.itemName || d.headline || 'Product')}</div>
        <div class="prices">${d.price ? `<span class="price">${rupees(d.price)}</span>` : ''}${d.mrp && d.price && d.mrp > d.price ? `<s>MRP ${rupees(d.mrp)}</s>` : ''}</div>
        ${saving ? `<div class="save">Save ${saving}%</div>` : ''}
        ${d.subline ? `<div class="sub">${esc(d.subline)}</div>` : ''}
      </div>`
    : `<div class="words"><h1 style="font-size:${headSize}px">${esc(d.headline)}</h1>${d.subline ? `<div class="sub">${esc(d.subline)}</div>` : ''}${d.qr ? `<div class="qr">${qrSvg(d.qr)}</div>` : ''}${tpl.art === 'diya' ? `<div class="diyas" style="--a:${tpl.accent}"><b></b><b></b><b></b></div>` : ''}</div>`
  const who = [d.contact && `<div>${esc(d.contact)}</div>`, d.address && `<div class="addr">${esc(d.address)}</div>`].filter(Boolean).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
body { font-family: 'Segoe UI', 'Nirmala UI', 'Noto Sans', Arial, sans-serif; color: ${tpl.ink};
  background: linear-gradient(160deg, ${tpl.bg[0]}, ${tpl.bg[1]}); position: relative; }
.poster { position: absolute; inset: 0; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: 22px; padding: 44px 56px 0; position: relative; z-index: 2; }
.head img { width: 120px; height: 120px; object-fit: contain; background: #fff; border-radius: 22px; padding: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.15); }
.head .name { font-size: 50px; font-weight: 800; letter-spacing: .5px; }
.middle { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; z-index: 2; padding: 0 70px; text-align: center; }
.words h1 { font-size: ${size === 'story' ? 150 : 128}px; line-height: 1.08; font-weight: 900; text-shadow: 0 4px 18px rgba(0,0,0,.12); }
.sub { margin-top: 26px; font-size: 48px; font-weight: 500; opacity: .9; }
.offer { position: relative; z-index: 2; margin: 0 auto 34px; background: ${tpl.accent}; color: ${tpl.bg[0] === '#ffffff' ? '#fff' : tpl.bg[0]};
  font-size: 46px; font-weight: 800; padding: 18px 46px; border-radius: 60px; box-shadow: 0 8px 24px rgba(0,0,0,.18); max-width: 88%; text-align: center; }
.foot { position: relative; z-index: 2; display: flex; justify-content: space-between; gap: 20px; background: rgba(255,255,255,.88); color: #212529;
  font-size: 40px; font-weight: 600; padding: 28px 56px; }
.foot .addr { font-size: 30px; font-weight: 400; color: #495057; }
.foot .phone { white-space: nowrap; align-self: center; }
.foot .who { min-width: 0; }
.qr { margin: 30px auto 0; width: 380px; background: #fff; padding: 18px; border-radius: 26px; box-shadow: 0 10px 30px rgba(0,0,0,.15); }
.qr svg { width: 100%; height: auto; display: block; fill: #000; }
.product { display: flex; flex-direction: column; align-items: center; gap: 18px; }
.photo { width: ${size === 'story' ? 760 : 560}px; height: ${size === 'story' ? 760 : 520}px; background: #fff; border-radius: 40px; overflow: hidden;
  box-shadow: 0 14px 40px rgba(0,0,0,.18); display: flex; align-items: center; justify-content: center; }
.photo img { width: 100%; height: 100%; object-fit: contain; }
.photo.none { height: 300px; width: 300px; font-size: 200px; font-weight: 900; color: ${tpl.accent}; }
.pname { font-size: 64px; font-weight: 800; }
.prices { display: flex; gap: 26px; align-items: baseline; }
.price { font-size: 88px; font-weight: 900; color: ${tpl.accent}; }
.prices s { font-size: 44px; opacity: .7; }
.save { background: ${tpl.accent}; color: #fff; font-size: 40px; font-weight: 800; padding: 8px 30px; border-radius: 40px; }
.art { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.confetti i { position: absolute; border-radius: 50%; opacity: .55; }
.splash i { position: absolute; border-radius: 50%; opacity: .35; filter: blur(2px); transform: translate(-50%, -50%); }
.sun { background: radial-gradient(circle at 80% 18%, var(--a) 0 120px, transparent 121px),
  repeating-conic-gradient(from 0deg at 80% 18%, rgba(255,255,255,.35) 0 6deg, transparent 6deg 18deg); opacity: .55; }
.diyas { display: flex; justify-content: center; gap: 80px; margin-top: 90px; }
.diyas b { width: 130px; height: 60px; background: #e8590c; border-radius: 0 0 80px 80px; position: relative; opacity: .9; }
.diyas b::before { content: ''; position: absolute; left: 50%; top: -86px; width: 46px; height: 80px; transform: translateX(-50%);
  background: radial-gradient(ellipse at 50% 70%, #fff 0 20%, var(--a) 40%, transparent 72%); border-radius: 50% 50% 50% 50% / 70% 70% 30% 30%; }
.kolam { background: radial-gradient(circle, transparent 0 60px, var(--a) 61px 66px, transparent 67px 120px, var(--a) 121px 126px, transparent 127px) center/360px 360px,
  radial-gradient(circle, var(--a) 0 10px, transparent 11px) 0 0/90px 90px; opacity: .25; }
.moon::before { content: ''; position: absolute; right: 120px; top: 170px; width: 240px; height: 240px; border-radius: 50%; box-shadow: -50px 30px 0 0 var(--a); }
.fireworks b { position: absolute; width: 300px; height: 300px; border-radius: 50%;
  background: repeating-conic-gradient(var(--a) 0 3deg, transparent 3deg 20deg); -webkit-mask: radial-gradient(circle, transparent 0 40px, #000 41px 150px, transparent 151px); opacity: .7; }
.fireworks b:nth-child(1) { left: 60px; top: 220px; } .fireworks b:nth-child(2) { right: 80px; top: 140px; width: 220px; height: 220px; } .fireworks b:nth-child(3) { right: 260px; bottom: 260px; width: 180px; height: 180px; }
.flag { display: flex; flex-direction: column; justify-content: center; opacity: .9; }
.flag b { height: 34px; margin: 0 0 0 auto; width: 46%; border-radius: 20px 0 0 20px; }
.flag b:nth-child(1) { background: #ff9933; } .flag b:nth-child(2) { background: #f1f3f5; border: 2px solid #dee2e6; } .flag b:nth-child(3) { background: #138808; }
.flag { justify-content: flex-start; padding-top: 230px; gap: 10px; }
.burst { background: repeating-conic-gradient(from 0deg at 50% 52%, rgba(255,255,255,.14) 0 8deg, transparent 8deg 16deg); }
.rings { background: radial-gradient(circle at 88% 14%, transparent 0 90px, var(--a) 91px 100px, transparent 101px 150px, var(--a) 151px 156px, transparent 157px),
  radial-gradient(circle at 10% 88%, var(--a) 0 70px, transparent 71px); opacity: .35; }
.leaves b { position: absolute; width: 220px; height: 90px; background: var(--a); border-radius: 0 100% 0 100%; opacity: .35; }
.leaves b:nth-child(1) { left: 40px; top: 260px; transform: rotate(-20deg); } .leaves b:nth-child(2) { right: 40px; top: 300px; transform: rotate(200deg); }
.leaves b:nth-child(3) { left: 90px; bottom: 260px; transform: rotate(25deg); background: #2f9e44; } .leaves b:nth-child(4) { right: 90px; bottom: 300px; transform: rotate(160deg); background: #2f9e44; }
</style></head><body><div class="poster">
${artHtml(tpl.art, tpl.accent, tpl.ink)}
<div class="head">${d.logo ? `<img src="${d.logo}" alt="">` : ''}<div class="name">${esc(d.businessName)}</div></div>
<div class="middle">${centre}</div>
${d.offer.trim() ? `<div class="offer">${esc(d.offer.trim())}</div>` : ''}
<div class="foot"><div class="who">${who || '&nbsp;'}</div>${d.phone ? `<div class="phone">☎ ${esc(d.phone)}</div>` : ''}</div>
</div></body></html>`
}

/** A file name for the poster image. */
export function posterFileName(tpl: PosterTemplate, d: PosterData): string {
  const base = `${d.businessName} ${tpl.category === 'product' ? d.itemName || 'product' : tpl.name}`
  return base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
}
