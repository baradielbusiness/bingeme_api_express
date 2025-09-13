# CloudFront Per-User Caching for Selected GET Routes

This document describes how to enable per-user caching at CloudFront for selected GET endpoints (e.g., `/products*`, `/comments/*`) with configurable TTLs per URL.

## Goals
- Cache only select GET routes at CloudFront.
- Cache variants are unique per user.
- Default TTL is 1 hour; configurable per-route.
- Preserve origin authentication and security posture.

## High-level Design
- **Cache key**: Path + normalized query + header `X-User-Cache-Key`.
- **User variant**: A Lambda@Edge (Viewer Request) function derives a stable user identifier from the JWT and sets `X-User-Cache-Key`.
- **Configurable TTLs**:
  - Option A: Fixed TTLs via CloudFront Cache Policy per behavior.
  - Option B: Use origin cache headers (`Cache-Control: s-maxage`) set per route.
- **Origin headers**: Set `Vary: X-User-Cache-Key, Accept-Encoding` and route-specific `s-maxage`.

## Edge Logic (Lambda@Edge)
Attach a Viewer Request Lambda@Edge to derive a per-user cache key. Prefer RS256 JWTs so the edge verifies with a public key. For HS256, do not place secrets at the edge; you may decode without verify to derive a non-sensitive `sub` for the key.

```javascript
// index.js (Deploy in us-east-1; attach as Viewer Request)
exports.handler = async (event, context, callback) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers || {};

  const authHeader = (headers.authorization && headers.authorization[0]?.value) || '';
  let userKey = 'anon';

  try {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) {
      // Decode payload (base64) without verify. For RS256, you can verify using your public key at edge.
      const payloadPart = token.split('.')[1];
      if (payloadPart) {
        const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString('utf8'));
        if (payload && payload.sub) userKey = String(payload.sub);
      }
    }
  } catch (e) {
    // Keep userKey = 'anon' on errors; avoid edge failures breaking requests
  }

  // Set the per-user cache key header used in the CloudFront cache key
  request.headers['x-user-cache-key'] = [{ key: 'X-User-Cache-Key', value: userKey }];
  return callback(null, request);
};
```

Notes:
- If no token, `X-User-Cache-Key` is `anon` to enable anonymous caching.
- Do not forward the `Authorization` header to the origin for cached behaviors to improve hit ratio.

## CloudFront Configuration
Create/adjust behaviors for paths like `/products*`, `/comments/*`.

1) Cache Policy (Option A: Fixed TTL at CloudFront)
- DefaultTTL: 3600 (1 hour), MinTTL: 60, MaxTTL: 86400 (24 hours).
- Headers in cache key: `X-User-Cache-Key`, `Accept-Encoding`.
- Query strings: Whitelist only parameters that affect the response (e.g., `page`, `sort`).
- Cookies: None, unless required.

2) Cache Policy (Option B: Use origin cache headers)
- Select “Use origin cache headers”.
- Control TTL per-route via origin `Cache-Control: s-maxage=<seconds>`.

3) Origin Request Policy
- Forward headers: `X-User-Cache-Key`.
- Do NOT forward `Authorization` for cached routes.
- Forward query strings: Whitelist per route (e.g., `page`, `sort`).
- Forward cookies: None (unless required).

4) Behaviors
- Add behaviors with patterns and priorities, for example:
  - `/comments/*` → Attach Cache Policy (A or B) and Origin Request Policy (with `X-User-Cache-Key`).
  - `/products*` → Same as above.
- Attach the Viewer Request Lambda@Edge function to the distribution.
- Enable compression (Gzip + Brotli).

## Origin Configuration (Express)
Set response headers per-route to control CDN caching and ensure per-user variants.

Example middleware `src/middleware/edgeCacheHeaders.js`:
```javascript
// src/middleware/edgeCacheHeaders.js
// Adds per-route s-maxage and Vary headers for CloudFront caching
const routeCacheConfig = [
  { pattern: /^\/products(\/.*)?$/, ttlSeconds: 3600, varyUser: true },
  { pattern: /^\/comments\/\d+$/, ttlSeconds: 7200, varyUser: true },
  // Add more routes here as needed
];

module.exports = function setEdgeCacheHeaders(req, res, next) {
  const match = routeCacheConfig.find(r => r.pattern.test(req.path));
  if (!match) return next();

  // Cache at CDN only; keep browser cache disabled for private user data
  res.set('Cache-Control', `private, max-age=0, s-maxage=${match.ttlSeconds}`);

  const varyHeaders = ['Accept-Encoding'];
  if (match.varyUser) varyHeaders.push('X-User-Cache-Key');
  res.set('Vary', varyHeaders.join(', '));

  return next();
};
```

Wire it on selected GET routes in `src/app.js`:
```javascript
// src/app.js (snippet)
const setEdgeCacheHeaders = require('./middleware/edgeCacheHeaders');

app.get('/products', setEdgeCacheHeaders, productsController.list);
app.get('/products/*', setEdgeCacheHeaders, productsController.show);
app.get('/comments/:id', setEdgeCacheHeaders, commentsController.getById);
```

Configuration is per-route (pattern + TTL). Add entries to `routeCacheConfig` as needed.

## Query String Strategy
- Identify which query params affect each route (e.g., `page`, `sort`).
- In the CloudFront Cache Policy, include only those in the cache key.
- Avoid forwarding/caching irrelevant query params to maximize hit ratio.

## Invalidation Workflow
Invalidate affected paths when data changes to purge all user variants:

```bash
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/comments/123*"

aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/products*"
```

## Security Considerations
- Prefer RS256 JWTs so Lambda@Edge can verify tokens using a public key.
- Do not put HMAC secrets at the edge. If using HS256:
  - Decode without verify solely to derive a user key; or
  - Switch to RS256 for verification at the edge.
- Do not include `Authorization` in the cache key or forward it to origin for cached behaviors.

## Cost & Performance
- Per-user caching increases variants. Restrict to critical GET routes.
- Use conservative TTLs and precise query whitelists to improve hit ratio.
- Monitor CloudFront cache hit/miss metrics and origin load; tune TTLs and coverage accordingly.

## Rollout Steps
1. Create the Viewer Request Lambda@Edge in us-east-1 and publish a version.
2. Attach the function to the distribution (Viewer Request association).
3. Create Cache Policy (Option A or B) with header `X-User-Cache-Key` and a query whitelist.
4. Create Origin Request Policy to forward `X-User-Cache-Key` and whitelisted queries.
5. Add/adjust behaviors for `/products*` and `/comments/*` with those policies.
6. Add `edgeCacheHeaders` middleware and wire it to selected GET routes.
7. Test anonymous and authenticated requests for cache behavior.
8. Add invalidation to content update workflows.

## Testing Checklist
- Anonymous: Hit on second request; `X-User-Cache-Key=anon`.
- User A vs User B: Different variants; within-user hits during TTL.
- Queries: Variants only for whitelisted params.
- TTL: Responses expire per `s-maxage`/policy.
- Browser cache: Disabled for private data (`max-age=0`).
