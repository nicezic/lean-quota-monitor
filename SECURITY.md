# Security

Raw credentials are never intentionally rendered or logged. Local credentials (Codex, Claude, Copilot, AGY, Devin) stay with their existing authorities, extension-owned API keys and tokens use VS Code `SecretStorage`, and Custom Provider credentials stay with their scripts.
