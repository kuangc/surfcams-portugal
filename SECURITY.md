# Security Policy

## Supported Versions

This is a personal static web app. Security fixes are handled on the default branch.

## Reporting a Vulnerability

Open a private advisory or contact the repository owner directly if you find a vulnerability.

## Security Notes

- Camera metadata is crawled from external pages and should be treated as untrusted input.
- Do not commit private credentials, cookies, or authenticated stream tokens.
- The app stores favorites only in browser `localStorage`.

