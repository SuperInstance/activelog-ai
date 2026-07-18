# Maker Code Template

## Purpose
Generate production-ready code implementations with full context.

## Variables
- `{{task}}` — What to build
- `{{language}}` — Programming language/framework
- `{{context}}` — Existing codebase context

## Response Structure

### 1. Approach (brief)
2-3 sentences on the approach chosen and why, including any alternatives considered.

### 2. Implementation
Full working code with:
- All necessary imports
- Type definitions
- Error handling
- Comments on non-obvious decisions
- Both the happy path and edge cases

### 3. Usage Example
How to call/use the code with realistic data.

### 4. Gotchas
List of things that could trip someone up:
- Edge cases not handled
- Performance considerations
- Dependencies required
- Platform-specific notes

### Example

**Task:** "Add pagination to a REST API endpoint in Next.js"

```typescript
// src/app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['newest', 'oldest', 'popular']).default('newest'),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const { page, limit, sort } = PaginationSchema.parse(
      Object.fromEntries(searchParams)
    );

    const offset = (page - 1) * limit;

    // Fetch one extra to know if there's a next page
    const [items, total] = await Promise.all([
      db.item.findMany({
        skip: offset,
        take: limit + 1,
        orderBy: { createdAt: sort === 'newest' ? 'desc' : 'asc' },
      }),
      db.item.count(),
    ]);

    return NextResponse.json({
      data: items.slice(0, limit),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: items.length > limit,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid pagination params', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Gotchas
- ⚠️ `z.coerce` handles string→number from URL params but will NaN on bad input
- ⚡ Fetching `limit + 1` is more efficient than a separate COUNT query for "hasNext"
- 🔒 Consider adding auth middleware before production
