This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Local verification

Use Node.js 24 or later for the tests that import TypeScript source directly.
Install the lockfile-pinned dependencies without running package lifecycle scripts:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm test
NEXT_TELEMETRY_DISABLED=1 npm run build
```

These checks do not deploy the app or validate real guide login, SMS delivery,
WeChat integration, or production database/storage access. The guide phone
authentication and receipt acknowledgement services currently use injected
persistence/delivery contracts; their live routes and adapters are not connected.

### Staff session configuration

Set `STAFF_SESSION_SECRET` to an unpredictable value of at least 32 characters.
It is used only on the server to sign the staff login cookie. Changing it signs
out every existing staff and owner session.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
