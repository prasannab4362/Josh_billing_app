# End-to-end checks

The unit tests (`npm test`) cover the services and shared code. These scripts check the real app: they drive the
Electron window over the Chrome DevTools Protocol.

## Run

1. Build: `npm run build`
2. Start the app with debugging ports and a separate profile folder, so your real businesses are not touched:

   ```bash
   ./node_modules/electron/dist/electron.exe . --remote-debugging-port=9333 --inspect=9334 --user-data-dir=e2e-profile
   ```

   (On macOS/Linux: `./node_modules/.bin/electron . ...`.) Create a test business in the window the first time.
3. In another terminal: `node scripts/e2e/smoke.mjs e2e-out`
4. Business-type check (ten trades, 64 checks): `node scripts/e2e/business-check.mjs e2e-out`. It creates new test
   businesses in the test profile each run; see `docs/business-guides/`.
5. Shop tour (barcodes, QR, labels, scan billing, bill and invoice for six shops, 69 checks; needs Python with
   `opencv-contrib-python`): `node scripts/e2e/shop-tour.mjs e2e-out`. Screenshots go to `e2e-out/tour`.
6. Logo and signature (21 checks, after the shop tour): `node scripts/e2e/logo-signature.mjs e2e-out`. Pictures go to
   `e2e-out/logo`.

Stop the app afterwards by closing its window (or by killing only the `electron` processes you started).

## Writing a check

```js
import { connect, stubDialogs } from './harness.mjs'
const app = await connect('e2e-out')
await stubDialogs('e2e-out', 'path/to/file-to-open.xlsx') // save/open dialogs answer by themselves
await app.click('Items')
await app.waitFor('+ Add item')
app.check((await app.api('listItems()')).length > 0, 'items exist')
```

Tips learned while building the app:

- Set form values with `setValue` (native setter + event); assigning `.value` alone is not seen by React.
- `innerText` shows CSS `text-transform`, so section titles read in capitals ("MORE DETAILS").
- Placeholder text is not part of `innerText`; wait for visible text instead.
- Screenshots hang while the window is hidden; `stubDialogs` brings it forward, and `shot` gives up after 5 s.
- Use names with a unique suffix (e.g. `Date.now() % 100000`) so reruns do not clash with earlier data.
- To check printed barcodes/QR codes, render the page in an offscreen `BrowserWindow` via `mainEval`,
  save a PNG and read it with OpenCV (`cv2.QRCodeDetectorAruco`, `cv2.barcode.BarcodeDetector`; the latter reads
  EAN-13 but not Code 128).
