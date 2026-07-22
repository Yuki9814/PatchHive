# Contributing

PatchHive accepts focused changes that improve evidence quality, approval safety,
workspace portability, or maintainer handoffs while preserving the local-first boundary.

## Development

```bash
npm install
npm run check
npx playwright install chromium
npm run test:e2e
```

Pull requests should explain the maintainer impact, include focused tests, and
call out any workspace schema change. Do not add a backend, OAuth, external
posting, or model execution without first discussing a new product boundary.
