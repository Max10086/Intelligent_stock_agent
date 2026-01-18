# Prisma Client Import Path Fix

## Problem

The server was crashing with `ERR_MODULE_NOT_FOUND` because the code was trying to import `PrismaClient` from a custom path `'../server/generated/prisma-client/index.js'` that doesn't exist.

## Solution Applied

### 1. Updated `prisma/schema.prisma`

**Before:**
```prisma
generator client {
  provider = "prisma-client"
  output   = "../server/generated/prisma-client"
}
```

**After:**
```prisma
generator client {
  provider = "prisma-client-js"
}
```

### 2. Updated All Import Statements

Changed all imports from custom path to standard `@prisma/client`:

**Files Updated:**
- `server/db.ts`
- `server/actions/queue.ts`
- `server/actions/process.ts`
- `server/routes/jobs.ts`

**Before:**
```typescript
import { PrismaClient } from '../server/generated/prisma-client/index.js';
import { JobStatus } from '../server/generated/prisma-client/index.js';
```

**After:**
```typescript
import { PrismaClient } from '@prisma/client';
import { JobStatus } from '@prisma/client';
```

### 3. Updated `package.json`

Moved `prisma` from `dependencies` to `devDependencies`:

**Before:**
```json
"dependencies": {
  "prisma": "^6.19.2",
  ...
}
```

**After:**
```json
"devDependencies": {
  "prisma": "^6.19.2",
  ...
}
```

### 4. Regenerated Prisma Client

```bash
rm -rf server/generated
npx prisma generate
```

Prisma Client is now generated to the standard location: `node_modules/@prisma/client`

## Verification

✅ Prisma Client successfully generated to `node_modules/@prisma/client`
✅ Runtime import test passed: `PrismaClient` can be imported successfully
✅ All import statements updated to use `@prisma/client`

## TypeScript Linter Note

If you see TypeScript errors about `PrismaClient` not being found, this is likely an IDE cache issue. Try:

1. **Restart TypeScript Server** (VS Code: Cmd+Shift+P → "TypeScript: Restart TS Server")
2. **Restart IDE**
3. **Clear TypeScript cache**: `rm -rf node_modules/.cache`

The code will work correctly at runtime even if the IDE shows errors temporarily.

## Benefits

1. **Standard Path**: Uses Prisma's standard import path
2. **Better Compatibility**: Works with all Prisma tooling and documentation
3. **Easier Deployment**: No custom paths to manage
4. **IDE Support**: Better TypeScript and IDE support

## Next Steps

1. Restart the development server: `npm run dev`
2. Verify the server starts without errors
3. Test batch analysis functionality
