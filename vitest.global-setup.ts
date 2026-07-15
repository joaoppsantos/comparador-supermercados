import { execSync } from 'node:child_process'

// Pushes the Prisma schema to the test database before the suite runs.
// Requires a local PostgreSQL server (see README).
export default function setup(): void {
  const url =
    process.env.TEST_DATABASE_URL ??
    `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/comparador_test`
  process.env.TEST_DATABASE_URL = url
  execSync('pnpm --filter @comparador/db exec prisma db push --skip-generate', {
    cwd: import.meta.dirname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
}
