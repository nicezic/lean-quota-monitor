# Changelog

## 0.1.3 - 2026-09-13

- Add DeepSeek credit balance provider and currency formatting.
- Add Devin (Cognition) provider with live Connect-RPC and local cache fallback (1w / 1d windows).
- Compact single-line display for credit and custom providers in Hover.
- Add positive-only random jitter (+0s ~ +15s) to distribute background refresh requests.
- Refresh interval UI minimums (30s) and defaults (180s) without 1-hour cap.
- Secondary quota windows separated by middle dot (` · `) for clearer visual grouping.
- Refine Hover footer links with consistent spacing and clarity (`🎚️ Quick Configure`, `🔄 Refresh All`).
- Built-in and custom provider rename inputs show default name hints and clearer prompts.

## 0.1.2 - 2026-08-24

- Add OpenCode Go provider ($10/month quota: 5h / weekly / monthly windows).
- Add Refresh Interval picker to Configure.
- Show key setup results in Quick Pick; Troubleshoot auto-closes after the last fix.
- Classify custom script failures with stable SCRIPT_* codes.
- Verify release tag matches package.json version before publishing.

## 0.1.1 - 2026-08-22

- Add GitHub Actions CI.

## 0.1.0 - 2026-08-22

- Initial public release.

## 0.0.1 - 2026-08-19

- Initial internal development version.
