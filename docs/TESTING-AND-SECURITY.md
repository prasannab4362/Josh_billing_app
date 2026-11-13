# Running and testing Josh Billing

Reviewed on 13 November 2026 using the current working tree and installed dependencies.

## Run on this computer

Open PowerShell in the project folder and run the following commands.

```powershell
Set-Location 'D:\Projects\billing\Josh_billing_app'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run build
npm.cmd start
```

For development with live reload, use `npm.cmd run dev`.
Using `npm.cmd` avoids this computer's PowerShell restriction on `npm.ps1`.
Clearing `ELECTRON_RUN_AS_NODE` lets Electron start its desktop window.
The build creates the application files in `out/`.
Run `npm.cmd run dist:win` to create the Windows x64 installer in `dist/`.
The installer bundles the runtime and database library and supports installation for the current Windows user.
This test installer is unsigned, so Windows may show an unknown-publisher warning.

## Automated checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit
npm.cmd audit --omit=dev
```

The checked build passed 262 tests in 26 files, TypeScript checking and the production build.
Two regression tests cover the closed-output-pipe crash reported during this review.
The running app also tolerated injected `EPIPE` errors on both standard output streams.

The real-app business suite passed all 64 checks across ten trades, including GST totals, stock, payments and PDF exports.
The screen smoke suite passed all 14 checks.
A separate targeted security run passed 12 checks covering output-pipe recovery, renderer isolation, blocked network requests and popups, owner setup, signed-out access, staff restrictions and failed-login lockout.
Its results are saved in `e2e-out/full-check/security-results.json`.
These runs used the isolated `e2e-profile` folder.
The packaged Windows executable also passed the same 64 business checks, 14 screen checks and 12 security checks using a fresh profile under `dist/packaged-test-profile`.
Packaged-app screenshots and PDFs are in `e2e-out/packaged`.

## Real-app checks

Close the running test app before starting another copy. Use an isolated profile for these checks.
The test harness replaces file dialogs and creates made-up business records.

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& '.\node_modules\electron\dist\electron.exe' . --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333 --inspect=127.0.0.1:9334 --user-data-dir=e2e-profile
```

Keep this terminal open. In another terminal in the project folder, run these scripts sequentially.
Expand the sidebar if it is collapsed because the existing scripts locate navigation by visible text.

```powershell
node scripts/e2e/business-check.mjs e2e-out/full-check
node scripts/e2e/smoke.mjs e2e-out/full-check
node scripts/e2e/shop-tour.mjs e2e-out/full-check
node scripts/e2e/logo-signature.mjs e2e-out/full-check
```

The shop tour requires a `python` command on PATH and `opencv-contrib-python`.
This computer has the Python launcher but has no installed Python interpreter, so the barcode decoding tour and its dependent logo/signature workflow remain pending.
Install Python with PATH enabled, then install its dependency with `python -m pip install opencv-contrib-python`.
The logo/signature workflow requires the clothing business created by the shop tour.
Close the test app after testing to close its debugging ports.

## Security findings

### Dependency advisories require updates

After adding the installer tool, the full npm audit reported twelve affected packages, comprising two critical, one high and nine moderate findings.
These are in the development dependency tree, including the test, build and packaging tools and their dependencies.
The production-only npm audit reported zero findings. That check covers the production dependency tree and has limited coverage of the Electron runtime, which is declared as a development dependency.
Several findings affect development or test servers. Assess and update the toolchain together, then repeat the build and tests.
The audit's suggested patch versions leave some advisory ranges affected, so an automatic patch alone needs follow-up verification.

### CSV exports allow spreadsheet formulas

`src/shared/reportDoc.ts`, function `csvValue`, quotes CSV delimiters but leaves formula-leading strings unchanged.
A party or item name beginning with `=` can become a formula when an exported report is opened in spreadsheet software.
Neutralize formula-leading text while preserving numeric money and quantity cells, and add export regression tests.

### XLSX imports have unbounded decompression

`src/main/xlsx.ts`, function `unzip`, calls synchronous `inflateRawSync` without an output limit or a total decompressed-byte budget.
A highly compressed workbook can exhaust memory or freeze the main process.
Add compressed-file, entry-count, per-entry and total uncompressed limits with understandable import errors.

### URL trust checks use string prefixes

`src/main/security.ts` uses prefix checks for the app file root, development WebSocket addresses and development IPC senders.
These checks can accept sibling paths or addresses sharing the same prefix.
Use parsed URL origins and normalized path containment, with boundary tests for sibling paths and lookalike development addresses.
Exploitation also depends on reaching an affected navigation or request path.

### Local files contain readable business data

Business databases and backups use ordinary SQLite files and filesystem copies.
Owner/staff login controls app access. Anyone able to read or alter those files through the operating system can access business records directly.
Protect the Windows account, database folders and backups using operating-system access controls and disk encryption.

## Manual acceptance checks

Use made-up data in the test profile and record the expected and actual amounts.

- Create a business, close and reopen it, then switch between businesses.
- Buy stock, make cash and credit sales, receive a partial payment, and compare balances with party statements.
- Check intra-state and inter-state GST, inclusive prices, discounts, charges, rounding and returns.
- Check estimates, orders and challans for the expected stock and ledger behaviour.
- Delete a bill, inspect its audit history, restore it and compare stock and balances.
- Preview an import, commit its good rows, and confirm blank update cells preserve saved values.
- Create a backup, restore it in the test profile and compare records and reports.
- Print A4, A5, 80 mm and 58 mm PDFs and confirm actual printer output and barcode scanning on shop hardware.
- Test light and dark themes, keyboard entry, narrow windows and error messages.
- Enable owner/staff login, check restricted actions, failed-password lockout, recovery and idle locking.

Physical printer output, hardware scanner input, clean-machine installation and code signing need separate acceptance runs.
