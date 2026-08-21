# Security

Raw credentials are never intentionally rendered or logged. Codex/Claude/AGY credentials stay with their existing local authorities, extension-owned API keys use VS Code `SecretStorage`, and Custom Provider credentials stay with their scripts.
