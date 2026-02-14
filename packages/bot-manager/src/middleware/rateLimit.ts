import { Request, Response, NextFunction } from "express";
import { createLogger } from "@/utils/logger";

const log = createLogger("RateLimit");

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting
// For production with multiple instances, use Redis instead
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Simple in-memory rate limiter
 * @param maxRequests - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Use IP address as identifier
    const identifier = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    // Clean up expired entries periodically
    if (Math.random() < 0.01) {
      // 1% chance on each request
      cleanupExpiredEntries(now);
    }

    const entry = rateLimitStore.get(identifier);

    if (!entry) {
      // First request from this identifier
      rateLimitStore.set(identifier, {
        count: 1,
        resetAt: now + windowMs,
      });
      setRateLimitHeaders(res, maxRequests, maxRequests - 1, windowMs);
      next();
      return;
    }

    if (now > entry.resetAt) {
      // Window has expired, reset
      entry.count = 1;
      entry.resetAt = now + windowMs;
      rateLimitStore.set(identifier, entry);
      setRateLimitHeaders(res, maxRequests, maxRequests - 1, windowMs);
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      log.warn(`Rate limit exceeded: identifier=${identifier} count=${entry.count}`);

      res.status(429).json({
        error: "Too many requests",
        retryAfter,
      });
      return;
    }

    // Increment count
    entry.count++;
    rateLimitStore.set(identifier, entry);
    setRateLimitHeaders(res, maxRequests, maxRequests - entry.count, entry.resetAt - now);
    next();
  };
}

/**
 * Set rate limit headers for client information
 */
function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetMs: number
): void {
  res.setHeader("X-RateLimit-Limit", limit.toString());
  res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining).toString());
  res.setHeader("X-RateLimit-Reset", new Date(Date.now() + resetMs).toISOString());
}

/**
 * Clean up expired entries from the rate limit store
 */
function cleanupExpiredEntries(now: number): void {
  let cleaned = 0;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug(`Cleaned up ${cleaned} expired rate limit entries`);
  }
}
