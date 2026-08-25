# Excluded / experimental backend modules

Several `backend/src/` directories contain **incomplete, unwired modules** that
were merged from parallel contributor branches. They are **not** imported by
`AppModule`, and they do not compile against this repository's current state
because they were written for:

- a **richer Prisma schema** than the one in `backend/prisma/schema.prisma`
  (e.g. a `User` model, `Invoice.ownerId` / `dueDate` / `expiresAt`, a `funding`
  relation, `Decimal` amounts), and/or
- **framework dependencies that are not installed** (`@nestjs/jwt`,
  `@nestjs/passport`, `passport-jwt`, `class-validator`, `@nestjs/swagger`,
  `@nestjs/bull`, `bull`, `@nestjs/websockets`, `socket.io`, `nodemailer`).

Before this was addressed, `npm run build` and `npm test` failed outright
(including a set of committed merge-conflict markers in `src/invoice/`). To keep
the **running application** (the modules actually wired into `AppModule`:
`prisma`, `settlement`, `invoices`, `health`, plus `common`) building and testing
cleanly, these directories are excluded from compilation via
[`backend/tsconfig.json`](../backend/tsconfig.json) and from the test run via
[`backend/jest.config.js`](../backend/jest.config.js).

No code was deleted — the modules remain in the tree for their owners to finish.

## What is excluded and why

| Path | Reason it does not compile |
| --- | --- |
| `src/auth` | Needs `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `class-validator`, `@nestjs/swagger`; references a `User` model (`prisma.user`) that is not in the schema. |
| `src/api` | Scaffold `example.controller`; imports `@nestjs/passport` and `./roles.decorator` / `./roles.guard` (which live under `auth/`, not `api/`). |
| `src/invoice` | Needs `class-validator`, `@nestjs/swagger`; references `Invoice.ownerId` / `dueDate`, a `user` relation, and `Decimal` amounts (richer schema). |
| `src/financing-pool` | Needs `class-validator`, `@nestjs/swagger`; references an invoice `funding` relation, `expiresAt`, `amount`, and a string invoice id (richer schema). |
| `src/invoice-reminder` | Needs `@nestjs/bull` + `bull`; depends on `src/invoice`. |
| `src/notification` | References schema fields not present on the current models. |
| `src/notifications` | Needs `@nestjs/websockets` + `socket.io`. |
| `src/email` | Needs `nodemailer`. |
| `src/settlement/settlement.controller.ts`, `src/settlement/dto/` | Not registered in `SettlementModule` (unwired); depends on `@nestjs/swagger`, the `auth` JWT guard, and a `financing-pool` DTO. The wired settlement providers are unaffected. |

> `src/pool` and `src/soroban` are intentionally **not** excluded — they are
> unwired but compile cleanly, so they stay in the build.

## Re-enabling a module

1. Install the dependencies listed for it above.
2. Add the required models/fields to `backend/prisma/schema.prisma`, create a
   migration, and run `prisma generate`.
3. Fix any remaining type errors and wire the module into `AppModule`.
4. Remove the directory from the `exclude` list in `backend/tsconfig.json` **and**
   from `testPathIgnorePatterns` in `backend/jest.config.js` (keep the two lists
   in sync).
5. Run `npm run build` and `npm test` to confirm it compiles and its tests pass.
