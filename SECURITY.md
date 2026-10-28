# Security policy

## Reporting a vulnerability

Do not report vulnerabilities in public issues. Use GitHub's private vulnerability reporting for this repository. If private reporting is unavailable, contact the repository maintainers through a verified private channel listed on the repository profile. Do not include API keys, subscriber records, or personal data in the report.

Include the affected version or commit, the impact, reproduction steps that do not expose real customer data, and any mitigation you identified. Give maintainers reasonable time to investigate before public disclosure.

## Credential handling

Never commit ManyChat API keys, OAuth credentials, access tokens, or production subscriber data. HTTP clients must send `X-ManyChat-API-Key` on each request to `/mcp`; the server does not use an environment-key fallback for HTTP. Redact secrets in logs and diagnostic output. Rotate any credential that may have been exposed.

## Scope

This policy covers security issues in this repository and its documented runtime. It does not promise a response time or security guarantee for the upstream ManyChat service.
