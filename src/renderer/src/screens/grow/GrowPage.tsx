import { useEffect, useMemo, useState } from 'react'
import type { Business, Item } from '@shared/models'
import {
  POSTER_CATEGORIES, POSTER_LANGS, POSTER_SIZES, POSTER_TEMPLATES, posterFileName, posterHtml,
  type PosterCategory, type PosterData, type PosterLang, type PosterSize, type PosterTemplate
} from '@shared/posters'
import { catalogueHtml, DEFAULT_CATALOGUE, GOOGLE_BUSINESS_URL, googleProfileFields, type CatalogueOptions } from '@shared/share'
import { formatINR } from '@shared/money'
import { api, errorMessage } from '../../api'
import { Banner, Toggle } from '../../components/Field'

type Tab = 'posters' | 'catalogue' | 'google'
type Message = { kind: 'error' | 'success'; text: string } | null

/** A fixed-size page shown smaller: an iframe at full size, scaled down to fit `boxWidth`. */
function Scaled({ html, width, height, boxWidth, title }: { html: string; width: number; height: number; boxWidth: number; title: string }) {
  const k = boxWidth / width
  return (
    <div className="scaled" style={{ width: boxWidth, height: height * k }}>
      <iframe title={title} sandbox="" srcDoc={html} style={{ width, height, transform: `scale(${k})` }} />
    </div>
  )
}

export function GrowPage({ business }: { business: Business }) {
  const [tab, setTab] = useState<Tab>('posters')
  const [reviewMode, setReviewMode] = useState(0)
  return (
    <div>
      <h1>Grow your business</h1>
      <nav className="tabs">
        {([['posters', 'Posters'], ['catalogue', 'Catalogue'], ['google', 'Google profile']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{label}</button>
        ))}
      </nav>
      {tab === 'posters' && <Posters business={business} startWith={reviewMode ? 'review-us' : undefined} key={reviewMode} />}
      {tab === 'catalogue' && <Catalogue business={business} />}
      {tab === 'google' && <GoogleProfile business={business} onReviewPoster={() => { setReviewMode((n) => n + 1); setTab('posters') }} />}
    </div>
  )
}

// ---------- Posters ----------

function Posters({ business, startWith }: { business: Business; startWith?: string }) {
  const [category, setCategory] = useState<PosterCategory>(startWith ? 'greetings' : 'festivals')
  const [tpl, setTpl] = useState<PosterTemplate>(() => POSTER_TEMPLATES.find((t) => t.id === (startWith ?? 'diwali'))!)
  const [lang, setLang] = useState<PosterLang>('en')
  const [size, setSize] = useState<PosterSize>('square')
  const [headline, setHeadline] = useState(tpl.headline.en)
  const [subline, setSubline] = useState(tpl.subline.en)
  const [offer, setOffer] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState(business.phone)
  const [showLogo, setShowLogo] = useState(true)
  const [showAddress, setShowAddress] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [itemId, setItemId] = useState('')
  const [item, setItem] = useState<{ name: string; photo: string | null; price: number; mrp: number | null } | null>(null)
  const [reviewLink, setReviewLink] = useState('')
  const [message, setMessage] = useState<Message>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.listItems().then((l) => setItems(l.filter((i) => i.isActive)), () => setItems([]))
    api.getFeatures().then((f) => setReviewLink(f.reviewLink), () => undefined)
  }, [])
  useEffect(() => {
    if (!itemId) return setItem(null)
    api.catalogueItems([itemId]).then(([i]) => setItem(i ? { name: i.name, photo: i.photo, price: i.price, mrp: i.mrp } : null), () => setItem(null))
  }, [itemId])

  const pick = (t: PosterTemplate) => {
    setTpl(t)
    setHeadline(t.headline[lang])
    setSubline(t.subline[lang])
  }
  const chooseLang = (l: PosterLang) => {
    setLang(l)
    setHeadline(tpl.headline[l])
    setSubline(tpl.subline[l])
  }
  const data: PosterData = {
    businessName: business.name,
    logo: showLogo ? business.logo : '',
    phone,
    contact,
    address: showAddress ? [business.address, business.city].filter(Boolean).join(', ') : '',
    headline,
    subline,
    offer,
    qr: tpl.id === 'review-us' ? reviewLink : '',
    itemName: item?.name,
    itemPhoto: item?.photo ?? undefined,
    price: item?.price ?? null,
    mrp: item?.mrp ?? null
  }
  const html = posterHtml(tpl, data, size)
  const { width, height } = POSTER_SIZES[size]
  const needsItem = tpl.category === 'product' && !item
  const needsLink = tpl.id === 'review-us' && !reviewLink

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await f()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const save = () => run(async () => {
    const path = await api.savePoster(html, size, posterFileName(tpl, data))
    if (path) setMessage({ kind: 'success', text: `Saved ${path}` })
  })
  const copy = () => run(async () => {
    await api.copyPoster(html, size)
    setMessage({ kind: 'success', text: 'Poster copied. Paste it (Ctrl+V) into a WhatsApp chat or status.' })
  })
  const whatsapp = () => run(async () => {
    await api.copyPoster(html, size)
    await api.openWhatsApp('', [headline, offer, `${business.name}${phone ? ` · ${phone}` : ''}`].filter(Boolean).join('\n'))
    setMessage({ kind: 'success', text: 'WhatsApp opened with your message, and the poster is copied: choose a chat, then paste it (Ctrl+V).' })
  })

  return (
    <div className="poster-layout">
      <div>
        <div className="chips" style={{ marginTop: 0 }}>
          {(Object.keys(POSTER_CATEGORIES) as PosterCategory[]).map((c) => (
            <button key={c} className={category === c ? 'chip on' : 'chip'} onClick={() => setCategory(c)}>{POSTER_CATEGORIES[c]}</button>
          ))}
        </div>
        <div className="poster-tiles">
          {POSTER_TEMPLATES.filter((t) => t.category === category).map((t) => (
            <button key={t.id} className={tpl.id === t.id ? 'poster-tile on' : 'poster-tile'} onClick={() => pick(t)}
              style={{ background: `linear-gradient(160deg, ${t.bg[0]}, ${t.bg[1]})`, color: t.ink }}>
              <b>{t.category === 'product' ? 'Your item' : t.headline[lang]}</b>
              <span>{t.name}</span>
            </button>
          ))}
        </div>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <label className="field"><span className="field-label">Language</span>
            <select className="input" value={lang} onChange={(e) => chooseLang(e.target.value as PosterLang)}>
              {(Object.keys(POSTER_LANGS) as PosterLang[]).map((l) => <option key={l} value={l}>{POSTER_LANGS[l]}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Size</span>
            <select className="input" value={size} onChange={(e) => setSize(e.target.value as PosterSize)}>
              {(Object.keys(POSTER_SIZES) as PosterSize[]).map((s) => <option key={s} value={s}>{POSTER_SIZES[s].name}</option>)}
            </select>
          </label>
          {tpl.category === 'product' && (
            <label className="field span-2"><span className="field-label">Item</span>
              <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Item for the poster">
                <option value="">Choose an item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {formatINR(i.salePrice)}{i.hasImage ? ' · photo' : ''}</option>)}
              </select>
            </label>
          )}
          {tpl.category !== 'product' && (
            <label className="field span-2"><span className="field-label">Heading</span>
              <input className="input" value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} aria-label="Heading" />
            </label>
          )}
          <label className="field span-2"><span className="field-label">Line under it</span>
            <input className="input" value={subline} maxLength={90} onChange={(e) => setSubline(e.target.value)} aria-label="Line under the heading" />
          </label>
          <label className="field span-2"><span className="field-label">Offer ribbon (optional)</span>
            <input className="input" value={offer} maxLength={60} placeholder="e.g. Flat 10% off on Sundays" onChange={(e) => setOffer(e.target.value)} aria-label="Offer" />
          </label>
          <label className="field"><span className="field-label">Contact person</span>
            <input className="input" value={contact} maxLength={40} onChange={(e) => setContact(e.target.value)} />
          </label>
          <label className="field"><span className="field-label">Phone</span>
            <input className="input" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <div className="row-flex" style={{ gap: 18, flexWrap: 'wrap' }}>
          <Toggle checked={showLogo} onChange={setShowLogo} label={business.logo ? 'Logo' : 'Logo (add one in Settings › Business)'} />
          <Toggle checked={showAddress} onChange={setShowAddress} label="Address" />
        </div>
        {needsLink && <p className="field-error">Add your Google review link in the Google profile tab first.</p>}
      </div>

      <div className="poster-preview">
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        <Scaled html={html} width={width} height={height} boxWidth={size === 'story' ? 260 : 420} title="Poster preview" />
        <div className="row-flex" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn" onClick={save} disabled={busy || needsItem}>Save image</button>
          <button className="btn" onClick={copy} disabled={busy || needsItem}>Copy image</button>
          <button className="btn primary" onClick={whatsapp} disabled={busy || needsItem}>Share on WhatsApp</button>
        </div>
        <p className="muted small" style={{ textAlign: 'center' }}>Images are {width} × {height} px. Made on this computer; nothing is uploaded.</p>
      </div>
    </div>
  )
}

// ---------- Catalogue ----------

function Catalogue({ business }: { business: Business }) {
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [o, setO] = useState<CatalogueOptions>(DEFAULT_CATALOGUE)
  const [preview, setPreview] = useState('')
  const [message, setMessage] = useState<Message>(null)

  useEffect(() => {
    api.listItems().then((l) => {
      const active = l.filter((i) => i.isActive)
      setItems(active)
      setPicked(new Set(active.filter((i) => i.kind === 'goods').map((i) => i.id)))
    }, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [])
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items])
  const shown = items.filter((i) => (!category || i.category === category) && (!search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase())))
  const chosen = items.filter((i) => picked.has(i.id)).map((i) => i.id)
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  // The preview is built in the main process from the same data as the PDF.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const list = await api.catalogueItems(chosen.slice(0, 24))
        setPreview(catalogueHtml(list, o, business))
      } catch (e) {
        setMessage({ kind: 'error', text: errorMessage(e) })
      }
    }, 300)
    return () => clearTimeout(t)
  }, [chosen.join(','), JSON.stringify(o)])

  const save = async () => {
    setMessage(null)
    try {
      const path = await api.saveCatalogue(chosen, o)
      if (path) setMessage({ kind: 'success', text: `Saved ${path}. Attach it in WhatsApp to send it.` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const whatsapp = async () => {
    try {
      await api.openWhatsApp('', `Hello! Here is the latest catalogue from ${business.name}. Reply with the items you need${business.phone ? ` or call ${business.phone}` : ''}.`)
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <div className="catalogue-layout">
      <div>
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        <div className="toolbar">
          <input className="input search" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" style={{ width: 170 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn small" onClick={() => setPicked((s) => new Set([...s, ...shown.map((i) => i.id)]))}>Select shown</button>
          <button className="btn small" onClick={() => setPicked((s) => new Set([...s].filter((id) => !shown.some((i) => i.id === id))))}>Clear shown</button>
        </div>
        <div className="catalogue-items">
          {shown.map((i) => (
            <label key={i.id} className={picked.has(i.id) ? 'cat-item on' : 'cat-item'}>
              <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
              <span>{i.name}</span>
              <span className="muted small">{formatINR(i.salePrice)}{i.hasImage ? ' · photo' : ''}</span>
            </label>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field"><span className="field-label">Title</span>
            <input className="input" value={o.title} maxLength={60} onChange={(e) => setO({ ...o, title: e.target.value })} />
          </label>
          <label className="field"><span className="field-label">Items per row</span>
            <select className="input" value={o.columns} onChange={(e) => setO({ ...o, columns: Number(e.target.value) as 2 | 3 | 4 })}>
              <option value={2}>2 (big photos)</option><option value={3}>3</option><option value={4}>4 (more per page)</option>
            </select>
          </label>
          <label className="field span-2"><span className="field-label">Note under the title</span>
            <input className="input" value={o.note} maxLength={120} placeholder="e.g. Prices valid till 30 November" onChange={(e) => setO({ ...o, note: e.target.value })} />
          </label>
        </div>
        <div className="row-flex" style={{ gap: 18, flexWrap: 'wrap' }}>
          <Toggle checked={o.showPrice} onChange={(v) => setO({ ...o, showPrice: v })} label="Price (with GST)" />
          <Toggle checked={o.showMrp} onChange={(v) => setO({ ...o, showMrp: v })} label="MRP and % off" />
          <Toggle checked={o.showDescription} onChange={(v) => setO({ ...o, showDescription: v })} label="Description" />
          <Toggle checked={o.byCategory} onChange={(v) => setO({ ...o, byCategory: v })} label="Group by category" />
        </div>
        <div className="row-flex" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn primary" onClick={save} disabled={!chosen.length}>Save catalogue PDF ({chosen.length} items)</button>
          <button className="btn" onClick={whatsapp}>Open WhatsApp with a message</button>
        </div>
        <p className="muted small">Add item photos in Items › Edit to show them in the catalogue.</p>
      </div>
      <div className="catalogue-preview">
        <div className="field-label">Preview{chosen.length > 24 ? ' (first 24 items)' : ''}</div>
        {preview && <Scaled html={preview} width={794} height={1123} boxWidth={420} title="Catalogue preview" />}
      </div>
    </div>
  )
}

// ---------- Google profile ----------

function GoogleProfile({ business, onReviewPoster }: { business: Business; onReviewPoster: () => void }) {
  const [link, setLink] = useState('')
  const [saved, setSaved] = useState('')
  const [message, setMessage] = useState<Message>(null)
  useEffect(() => {
    api.getFeatures().then((f) => {
      setLink(f.reviewLink)
      setSaved(f.reviewLink)
    }, () => undefined)
  }, [])
  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v)
    setMessage({ kind: 'success', text: `Copied: ${v}` })
  }
  const saveLink = async () => {
    try {
      const f = await api.getFeatures()
      const out = await api.saveFeatures({ ...f, reviewLink: link.trim() })
      setSaved(out.reviewLink)
      setLink(out.reviewLink)
      setMessage(out.reviewLink ? { kind: 'success', text: 'Review link saved.' } : { kind: 'error', text: 'Enter a link that starts with https://' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const open = (url: string) => api.openWeb(url).catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))

  return (
    <div className="google-layout">
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Show your shop on Google Search and Maps</h3>
        <ol className="steps">
          <li>Open Google Business Profile and sign in with your Google account (in your browser, not in this app).</li>
          <li>Add your business: copy each detail below and paste it there.</li>
          <li>Verify it the way Google asks (postcard, phone or a short video).</li>
          <li>Copy your review link from the profile ("Ask for reviews") and paste it here, to make a review poster.</li>
        </ol>
        <button className="btn primary" onClick={() => open(GOOGLE_BUSINESS_URL)}>Open Google Business Profile</button>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Your details to copy</h3>
        <table className="table compact">
          <tbody>
            {googleProfileFields(business).map((f) => (
              <tr key={f.label}>
                <td style={{ width: 140 }} className="muted">{f.label}</td>
                <td>{f.value || <span className="muted">not set (Settings › Business)</span>}{f.hint && <div className="muted small">{f.hint}</div>}</td>
                <td style={{ width: 80 }}>{f.value && <button className="btn small" onClick={() => copy(f.value)}>Copy</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Google review link</h3>
        <div className="row-flex" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} value={link} placeholder="https://g.page/r/..." onChange={(e) => setLink(e.target.value)} aria-label="Google review link" />
          <button className="btn" onClick={saveLink} disabled={link.trim() === saved}>Save</button>
        </div>
        <div className="row-flex" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={onReviewPoster} disabled={!saved}>Make a "Review us" poster with a QR code</button>
          <button className="btn" onClick={() => open(saved)} disabled={!saved}>Open the link</button>
        </div>
      </div>
    </div>
  )
}
