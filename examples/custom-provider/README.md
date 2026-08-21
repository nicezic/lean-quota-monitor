# Custom Provider Examples

Custom providers are executable files that print **exactly one non-empty logical line** to stdout and exit successfully.

The extension does not parse provider-specific JSON, currency, balance, or authentication. Your executable owns those details.

## Minimal example

`echo-status.sh` demonstrates the complete output contract:

```bash
./echo-status.sh
# $12.30
```

## API template

`api-balance.py` demonstrates a generic API-backed provider without naming or depending on a specific service.

```bash
export CUSTOM_PROVIDER_KEY='...'
export CUSTOM_PROVIDER_URL='https://api.example.com/v1/balance'
./api-balance.py
```

The template expects a response shaped like:

```json
{
  "balance": 12.3
}
```

Adapt only the request URL, authentication headers, and response extraction to your provider. Keep stdout to one display-ready line such as `$12.30`.

## VS Code setting

```json
{
  "leanQuotaMonitor.customProviders": {
    "CUSTOM_PROVIDER_KEY": {
      "label": "CUS",
      "script": "~/.local/bin/custom-provider-status",
      "visible": true
    }
  }
}
```

Install an example or your adapted script somewhere executable, then point `script` to that file. Shell command strings and arguments are intentionally unsupported.