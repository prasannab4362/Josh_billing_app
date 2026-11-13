"""Read every EAN-13 barcode and QR code in label pictures, to prove printed labels scan.

Usage: python -I scripts/e2e/read-codes.py picture.png [picture2.png ...]
Prints JSON: { "picture.png": { "barcodes": [...], "qr": [...] } }
Needs OpenCV (pip install opencv-contrib-python). Code 128 is not read by OpenCV's detector, so labels for
items that only have a text item code are checked as QR codes.
"""
import json
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


def read(path):
    img = cv2.imread(path)
    found = {"barcodes": set(), "qr": set()}
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
    return {k: sorted(v) for k, v in found.items()}


if __name__ == "__main__":
    print(json.dumps({p: read(p) for p in sys.argv[1:]}))
