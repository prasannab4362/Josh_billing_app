"""Read every barcode and QR code in label pictures, to prove printed labels scan.

Usage: python -I scripts/e2e/read-codes.py picture.png [picture2.png ...]
Prints JSON: { "picture.png": { "barcodes": [...], "qr": [...], "code128": [...] } }
Needs OpenCV (pip install opencv-contrib-python). OpenCV reads EAN-13 and QR codes. It does not read Code 128
(what text codes such as 472-00001~1 print as), so Code 128 is read here by measuring the bars along lines across
the picture and decoding them with the standard Code 128 width table, start/stop codes and mod-103 check.
"""
import json
import os
import re
import sys

import cv2


def variants(img):
    """The picture as printed, enlarged, and as clean black-and-white, since detectors like different inputs."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # A small label on a mostly empty A4 page is hard to find: look at the printed area on its own too.
    ys, xs = (gray < 128).nonzero()
    if len(xs):
        m = 40
        gray_crop = gray[max(0, ys.min() - m): ys.max() + m, max(0, xs.min() - m): xs.max() + m]
        if gray_crop.size < gray.size * 0.8:
            for scale in (0.5, 0.75, 1.0, 1.5, 2.0):
                yield gray_crop if scale == 1.0 else cv2.resize(gray_crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # OpenCV's detector works best when bars are a few pixels wide, as a scanner or phone camera sees them,
    # so try the picture at several sizes (large renders are shrunk, small ones enlarged).
    for base in (gray, bw):
        for scale in (0.2, 0.25, 0.3, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0):
            yield base if scale == 1.0 else cv2.resize(base, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)


# ---------- Code 128 ----------

def code128_table():
    """The 107 bar/space width patterns (values 0-106), read from the app's encoder source; values 0-2, the three
    start codes and the stop code were checked against the published standard."""
    here = os.path.dirname(os.path.abspath(__file__))
    src = open(os.path.join(here, '..', '..', 'src', 'shared', 'barcode.ts'), encoding='utf8').read()
    body = re.search(r'CODE128[^=]*=\s*\[(.*?)\]', src, re.S).group(1)
    table = re.findall(r"'(\d{6,7})'", body)
    assert len(table) == 107 and table[103] == '211412' and table[104] == '211214' and table[105] == '211232' and table[106] == '2331112'
    return {p: v for v, p in enumerate(table)}


PATTERNS = code128_table()


def runs(row):
    """Widths of alternating dark/light runs along one line of pixels, starting at the first dark pixel."""
    dark = row < 128
    out, i, n = [], 0, len(row)
    while i < n and not dark[i]:
        i += 1
    while i < n:
        j = i
        while j < n and dark[j] == dark[i]:
            j += 1
        out.append(j - i)
        i = j
    return out


def to_pattern(widths, modules=11):
    """Bar/space widths as module counts: a symbol is 11 modules wide, the stop code 13."""
    unit = sum(widths) / float(modules)
    return ''.join(str(max(1, min(4, round(w / unit)))) for w in widths)


def decode_values(values):
    """Turn Code 128 values (start … check, without stop) into text; None when the check digit is wrong."""
    if len(values) < 3:
        return None
    check = values[-1]
    total = values[0] + sum(i * v for i, v in enumerate(values[1:-1], start=1))
    if total % 103 != check:
        return None
    text, cset = '', {103: 'A', 104: 'B', 105: 'C'}.get(values[0])
    for v in values[1:-1]:
        if v == 99:
            cset = 'C'
        elif v == 100:
            cset = 'B'
        elif v == 101:
            cset = 'A'
        elif cset == 'C':
            text += f'{v:02d}'
        elif cset == 'B':
            text += chr(v + 32)
        elif cset == 'A':
            text += chr(v + 32) if v < 64 else chr(v - 64)
    return text


def read_code128(gray):
    found = set()
    h = gray.shape[0]
    for y in range(0, h, max(1, h // 60)):
        r = runs(gray[y])
        for s in range(0, len(r) - 6, 2):
            if PATTERNS.get(to_pattern(r[s:s + 6])) not in (103, 104, 105):
                continue
            values, k = [], s
            while k + 6 <= len(r):
                if k + 7 <= len(r) and to_pattern(r[k:k + 7], 13) == '2331112':
                    t = decode_values(values)
                    if t:
                        found.add(t)
                    break
                v = PATTERNS.get(to_pattern(r[k:k + 6]))
                if v is None:
                    break
                values.append(v)
                k += 6
    return found


def read(path):
    img = cv2.imread(path)
    found = {"barcodes": set(), "qr": set(), "code128": set()}
    if img is None:
        return {"error": "could not open"}
    bar = cv2.barcode.BarcodeDetector()
    qr = cv2.QRCodeDetectorAruco()
    for v in variants(img):
        try:
            res = bar.detectAndDecodeMulti(v)
            ok, infos = res[0], res[1]
            if ok:
                found["barcodes"].update(t for t in infos if t)
        except cv2.error:
            pass
        try:
            ok, infos, *_ = qr.detectAndDecodeMulti(v)
            if ok:
                found["qr"].update(t for t in infos if t)
        except cv2.error:
            pass
    found["code128"] = read_code128(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    return {k: sorted(v) for k, v in found.items()}


if __name__ == "__main__":
    print(json.dumps({p: read(p) for p in sys.argv[1:]}))
