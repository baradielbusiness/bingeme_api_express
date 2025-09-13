// Middleware to purge CloudFront cache for write requests (POST/PUT/DELETE)
// Derives invalidation paths from the request path and known related patterns.

import { invalidatePaths } from '../utils/cloudfront.js';

// Map write paths to invalidation patterns
function deriveInvalidationPaths(req) {
  const p = req.path || '/';
  const items = new Set();

  // Generic: purge the requested path and parent base
  items.add(p.endsWith('*') ? p : p);

  // Products
  if (p.startsWith('/products') || p.startsWith('/product')) {
    items.add('/products*');
  }

  // Posts & comments
  if (p.startsWith('/posts')) {
    items.add('/posts*');
  }
  if (p.includes('/comment') || p.startsWith('/comments')) {
    const idMatch = p.match(/\/(comments?|comment)\/?(\d+)?/i);
    if (idMatch && idMatch[2]) {
      items.add(`/comments/${idMatch[2]}*`);
    } else {
      items.add('/comments*');
    }
  }

  // Messages
  if (p.startsWith('/messages')) {
    items.add('/messages*');
  }

  // Notifications
  if (p.startsWith('/notifications') || p.startsWith('/notification')) {
    items.add('/notifications*');
  }

  if (p.startsWith('/notification/settings') || p.startsWith('/notifications/settings')) {
    items.add('/notification/settings');
  }

  // User-derived (profile, updates, restrictions)
  if (p.startsWith('/user')) {
    items.add('/user/*');
    items.add('/updates');
    items.add('/posts');
  }

  // Creator
  if (p.startsWith('/creator')) {
    items.add('/creator/*');
  }

  // Sales
  if (p.startsWith('/sales')) {
    items.add('/sales*');
  }

  // Referrals
  if (p.startsWith('/referrals')) {
    items.add('/referrals*');
  }

  // Payout
  if (p.startsWith('/payout')) {
    items.add('/payout*');
  }

  // Verification
  if (p.startsWith('/verification')) {
    items.add('/verification*');
  }

  // Dashboard
  if (p.startsWith('/dashboard')) {
    items.add('/dashboard*');
  }

  // Live
  if (p.startsWith('/live')) {
    items.add('/live*');
  }

  // Privacy
  if (p.startsWith('/privacy')) {
    items.add('/privacy*');
    items.add('/privacy/security');
    items.add('/privacy/account/delete');
    items.add('/privacy/account/retrieve');
  }

  // Pages
  if (p.startsWith('/pages') || p.startsWith('/p/')) {
    items.add('/pages/*');
    items.add('/p/*');
  }

  return Array.from(items);
}

export function purgeCloudfrontOnWrite() {
  return async function purgeMiddleware(req, res, next) {
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();

    res.on('finish', async () => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const paths = deriveInvalidationPaths(req);
          if (paths.length > 0) {
            await invalidatePaths(paths);
          }
        }
      } catch (_) {
        // swallow errors to not affect response
      }
    });

    return next();
  };
}


