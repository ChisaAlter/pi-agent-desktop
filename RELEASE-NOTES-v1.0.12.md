# Pi Desktop v1.0.12

Pi Desktop v1.0.12 closes the GitHub updater loop for Windows releases.

## Included in this release

- GitHub Releases based updater state model shared across main, preload, and renderer
- Settings > About update card with:
  - check for updates
  - download update
  - restart to install
  - progress display
  - visible disabled and error states
  - GitHub Releases fallback button
- Dedicated updater IPC handlers and renderer store
- Packaged updater error normalization so production errors stay readable
- Release workflow signing guard and corrected artifact upload paths
- CI and release `pnpm` version alignment with the repository `packageManager`
- Installer naming aligned with `latest.yml`

## Expected release assets

- `Pi-Desktop-1.0.12-setup.exe`
- `Pi-Desktop-1.0.12-setup.exe.blockmap`
- `latest.yml`

## Verification

- `pnpm -r typecheck`
- `pnpm -r lint`
- `pnpm -r test`
- `PI_DESKTOP_ENABLE_AUTO_UPDATE=1 pnpm --filter @pi-desktop/desktop build`
- `PI_DESKTOP_ENABLE_AUTO_UPDATE=1 pnpm --filter @pi-desktop/desktop package`

## Notes

This release requires a signed Windows build and a populated GitHub Release for the in-app updater to discover metadata successfully.
